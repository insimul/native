/*
 * insimulcore.c — the reference implementation of insimulcore.h: `@insimul/core`
 * running as TypeScript-compiled-to-JS inside an embedded QuickJS, with its
 * Prolog seam wired to the NATIVE libinsimul this plugin already links.
 *
 * The whole stack (RUNTIME_CORE_ADOPTION.md §5.4):
 *
 *     GDScript            addons/insimul/runtime/radiant_source.gd
 *        |                        (the only place Godot types are translated)
 *     InsimulCore         gdextension/src/insimul_core.cpp   [RefCounted]
 *        |  C ABI          insimul_core_call(h, "radiant.generate", json)
 *     THIS FILE           QuickJS + the vendored core bundle
 *        |  JS -> C        __insimul_prolog_{create,consult,query,destroy}
 *     libinsimul          Trealla, natively linked (vendor/insimul/insimul.h)
 *
 * Two deliberate choices worth knowing before editing:
 *
 *  1. NO wasm. Core's own `createPrologEngine()` loads a wasm build of Trealla.
 *     The bundler resolves that import to js/host-prolog-engine.js instead, so
 *     core's algorithm runs on the same interpreter the rest of this plugin
 *     uses. QuickJS has no WebAssembly, and even if it did, wrapping a wasm
 *     Trealla inside a process that links a native one would be absurd.
 *
 *  2. The call is SYNCHRONOUS to the host even though core is promise-based.
 *     `insimul_core_call` drains QuickJS's job queue until the returned promise
 *     settles. That works because every promise in the adopted surface is
 *     resolved by JS or by a synchronous C call — nothing awaits external I/O.
 *     If a future slice needs real async, this is the function that has to grow
 *     a pump driven from the host's frame loop, and the ABI does not change.
 */

#include "insimulcore.h"

#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#include "quickjs.h"

#include "insimul.h"            /* libinsimul C ABI (vendor/insimul/insimul.h) */
#include "insimul_core_bundle.h" /* generated: tools/vendor-core-bundle.mjs */

#ifndef INSIMULCORE_ABI_VERSION
#define INSIMULCORE_ABI_VERSION "0.1.0"
#endif
#ifndef CONFIG_VERSION
#define CONFIG_VERSION "unknown"
#endif

/* Hard cap on JS heap. A radiant tick allocates a few hundred KB; anything
 * approaching this is a runaway, and dying with a JS OOM beats taking the game
 * process down. */
#define INSIMULCORE_JS_MEMORY_LIMIT (64u * 1024u * 1024u)

/* ── small growable string buffer ─────────────────────────────────────────── */

typedef struct {
	char *data;
	size_t len;
	size_t cap;
	int failed; /* sticky: an allocation failed, `data` is unusable */
} strbuf;

static void sb_init(strbuf *sb) {
	sb->data = NULL;
	sb->len = 0;
	sb->cap = 0;
	sb->failed = 0;
}

static void sb_free(strbuf *sb) {
	free(sb->data);
	sb_init(sb);
}

static void sb_append(strbuf *sb, const char *s, size_t n) {
	if (sb->failed) return;
	if (sb->len + n + 1 > sb->cap) {
		size_t cap = sb->cap ? sb->cap : 256;
		while (cap < sb->len + n + 1) cap *= 2;
		char *next = (char *)realloc(sb->data, cap);
		if (!next) {
			sb->failed = 1;
			return;
		}
		sb->data = next;
		sb->cap = cap;
	}
	memcpy(sb->data + sb->len, s, n);
	sb->len += n;
	sb->data[sb->len] = '\0';
}

static void sb_puts(strbuf *sb, const char *s) { sb_append(sb, s, strlen(s)); }

/* ── the handle ───────────────────────────────────────────────────────────── */

struct insimul_core {
	JSRuntime *rt;
	JSContext *ctx;

	/*
	 * A KB that exists only to keep libinsimul's live-KB count above zero.
	 *
	 * WORKAROUND for a libinsimul defect found by tasklist 100 US-2, the first
	 * story to link the library rather than syntax-gate against it: once every
	 * KB has been destroyed, the NEXT insimul_kb_create() returns a handle that
	 * crashes on use (SIGTRAP inside the engine). Reproduced in 20 lines with no
	 * Godot, no QuickJS and no core involved — create, use, destroy, create, use.
	 * It looks like a global engine bootstrap that is torn down with the last KB
	 * and does not survive re-initialisation.
	 *
	 * It matters here because a radiant tick builds a THROWAWAY KB and releases
	 * it (packages/core/src/radiant/radiant-engine.ts), so a game that ticks the
	 * director would hit this on its second tick. Holding one KB open for the
	 * lifetime of the handle costs a few KB and makes the pattern safe.
	 *
	 * Remove this once libinsimul is fixed — see RUNTIME_CORE_ADOPTION.md §6.7.
	 */
	insimul_kb *keepalive;

	/* Prolog KBs owned by this runtime; the JS side addresses them by index. */
	insimul_kb **kbs;
	int kb_count;
	int kb_cap;

	char *last_error;  /* never NULL after create() */
	char *last_result; /* NULL until the first successful call */
};

static void set_last_error(insimul_core *core, const char *msg) {
	if (!core) return;
	char *copy = NULL;
	if (msg) {
		size_t n = strlen(msg) + 1;
		copy = (char *)malloc(n);
		if (copy) memcpy(copy, msg, n);
	}
	free(core->last_error);
	core->last_error = copy;
}

/* Move the pending JS exception (if any) into last_error. */
static void capture_exception(insimul_core *core, const char *prefix) {
	JSContext *ctx = core->ctx;
	JSValue exc = JS_GetException(ctx);
	const char *text = JS_ToCString(ctx, exc);
	strbuf sb;
	sb_init(&sb);
	if (prefix) {
		sb_puts(&sb, prefix);
		sb_puts(&sb, ": ");
	}
	sb_puts(&sb, text ? text : "unknown JS error");
	set_last_error(core, sb.failed ? "insimulcore: out of memory" : sb.data);
	sb_free(&sb);
	if (text) JS_FreeCString(ctx, text);
	JS_FreeValue(ctx, exc);
}

/* ── the Prolog bridge exposed to JS ──────────────────────────────────────── */

static insimul_kb *kb_for(insimul_core *core, int id) {
	if (!core || id < 0 || id >= core->kb_count) return NULL;
	return core->kbs[id];
}

/* libinsimul's last_error is documented as "" when clear, but a fresh KB can
 * return NULL; never hand NULL to a string API. */
static const char *kb_error(insimul_kb *kb) {
	const char *e = insimul_last_error(kb);
	return (e && *e) ? e : "unknown libinsimul error";
}

/* __insimul_prolog_create() -> int id, or -1 */
static JSValue js_prolog_create(JSContext *ctx, JSValueConst this_val, int argc, JSValueConst *argv) {
	(void)this_val;
	(void)argc;
	(void)argv;
	insimul_core *core = (insimul_core *)JS_GetContextOpaque(ctx);
	insimul_kb *kb = insimul_kb_create();
	if (!kb) return JS_NewInt32(ctx, -1);

	if (core->kb_count == core->kb_cap) {
		int cap = core->kb_cap ? core->kb_cap * 2 : 4;
		insimul_kb **next = (insimul_kb **)realloc(core->kbs, (size_t)cap * sizeof(*next));
		if (!next) {
			insimul_kb_destroy(kb);
			return JS_NewInt32(ctx, -1);
		}
		core->kbs = next;
		core->kb_cap = cap;
	}
	core->kbs[core->kb_count] = kb;
	return JS_NewInt32(ctx, core->kb_count++);
}

/* __insimul_prolog_consult(id, program) -> null on success | error string */
static JSValue js_prolog_consult(JSContext *ctx, JSValueConst this_val, int argc, JSValueConst *argv) {
	(void)this_val;
	insimul_core *core = (insimul_core *)JS_GetContextOpaque(ctx);
	int32_t id = -1;
	if (argc < 2 || JS_ToInt32(ctx, &id, argv[0]) < 0) {
		return JS_ThrowTypeError(ctx, "__insimul_prolog_consult(id, program)");
	}
	insimul_kb *kb = kb_for(core, id);
	if (!kb) return JS_NewString(ctx, "insimulcore: no such Prolog KB");

	const char *program = JS_ToCString(ctx, argv[1]);
	if (!program) return JS_EXCEPTION;
	/* libinsimul returns 0 on success, -1 on error — NOT the 1/0 convention. */
	int rc = insimul_kb_consult(kb, program);
	JS_FreeCString(ctx, program);
	return rc == 0 ? JS_NULL : JS_NewString(ctx, kb_error(kb));
}

/*
 * __insimul_prolog_query(id, goal, max) -> JSON array of binding-set objects.
 *
 * The solutions are libinsimul's own binding JSON, concatenated verbatim — the
 * bridge never re-encodes a term, so there is no second marshalling layer to
 * drift from the one the conformance corpus pins (see prolog_value.h). Throws
 * if the goal will not start; a goal that simply fails yields `[]`.
 */
static JSValue js_prolog_query(JSContext *ctx, JSValueConst this_val, int argc, JSValueConst *argv) {
	(void)this_val;
	insimul_core *core = (insimul_core *)JS_GetContextOpaque(ctx);
	int32_t id = -1;
	int32_t max = 1000;
	if (argc < 2 || JS_ToInt32(ctx, &id, argv[0]) < 0) {
		return JS_ThrowTypeError(ctx, "__insimul_prolog_query(id, goal, max)");
	}
	if (argc >= 3 && !JS_IsUndefined(argv[2]) && JS_ToInt32(ctx, &max, argv[2]) < 0) {
		return JS_EXCEPTION;
	}
	insimul_kb *kb = kb_for(core, id);
	if (!kb) return JS_ThrowInternalError(ctx, "insimulcore: no such Prolog KB");

	const char *goal = JS_ToCString(ctx, argv[1]);
	if (!goal) return JS_EXCEPTION;

	insimul_query *q = insimul_query_start(kb, goal);
	if (!q) {
		JSValue err = JS_ThrowInternalError(ctx, "%s", kb_error(kb));
		JS_FreeCString(ctx, goal);
		return err;
	}
	JS_FreeCString(ctx, goal);

	strbuf sb;
	sb_init(&sb);
	sb_puts(&sb, "[");
	int32_t emitted = 0;
	while (emitted < max) {
		const char *sol = insimul_query_next(q);
		if (!sol) break;
		if (emitted > 0) sb_puts(&sb, ",");
		sb_puts(&sb, sol);
		emitted++;
	}
	sb_puts(&sb, "]");
	insimul_query_stop(q);

	if (sb.failed) {
		sb_free(&sb);
		return JS_ThrowOutOfMemory(ctx);
	}
	JSValue out = JS_NewStringLen(ctx, sb.data, sb.len);
	sb_free(&sb);
	return out;
}

/* __insimul_prolog_destroy(id) -> undefined */
static JSValue js_prolog_destroy(JSContext *ctx, JSValueConst this_val, int argc, JSValueConst *argv) {
	(void)this_val;
	insimul_core *core = (insimul_core *)JS_GetContextOpaque(ctx);
	int32_t id = -1;
	if (argc < 1 || JS_ToInt32(ctx, &id, argv[0]) < 0) return JS_UNDEFINED;
	insimul_kb *kb = kb_for(core, id);
	if (kb) {
		insimul_kb_destroy(kb);
		core->kbs[id] = NULL;
	}
	return JS_UNDEFINED;
}

/* ── lifecycle ────────────────────────────────────────────────────────────── */

insimul_core *insimul_core_create(void) {
	insimul_core *core = (insimul_core *)calloc(1, sizeof(*core));
	if (!core) return NULL;
	set_last_error(core, "");

	/* Open before anything else, closed last — see the `keepalive` comment. */
	core->keepalive = insimul_kb_create();
	if (!core->keepalive) {
		insimul_core_destroy(core);
		return NULL;
	}

	core->rt = JS_NewRuntime();
	if (!core->rt) {
		insimul_core_destroy(core);
		return NULL;
	}
	JS_SetMemoryLimit(core->rt, INSIMULCORE_JS_MEMORY_LIMIT);
	core->ctx = JS_NewContext(core->rt);
	if (!core->ctx) {
		insimul_core_destroy(core);
		return NULL;
	}
	JS_SetContextOpaque(core->ctx, core);

	JSValue global = JS_GetGlobalObject(core->ctx);
	JS_SetPropertyStr(core->ctx, global, "__insimul_prolog_create",
			JS_NewCFunction(core->ctx, js_prolog_create, "__insimul_prolog_create", 0));
	JS_SetPropertyStr(core->ctx, global, "__insimul_prolog_consult",
			JS_NewCFunction(core->ctx, js_prolog_consult, "__insimul_prolog_consult", 2));
	JS_SetPropertyStr(core->ctx, global, "__insimul_prolog_query",
			JS_NewCFunction(core->ctx, js_prolog_query, "__insimul_prolog_query", 3));
	JS_SetPropertyStr(core->ctx, global, "__insimul_prolog_destroy",
			JS_NewCFunction(core->ctx, js_prolog_destroy, "__insimul_prolog_destroy", 1));
	JS_FreeValue(core->ctx, global);

	JSValue res = JS_Eval(core->ctx, insimul_core_bundle_js, (size_t)insimul_core_bundle_js_len,
			"insimul-core-bundle.js", JS_EVAL_TYPE_GLOBAL);
	if (JS_IsException(res)) {
		/* create() reports failure as NULL, so there is no handle left to carry
		 * last_error(). A bundle that will not evaluate is a build-time defect,
		 * not a runtime condition a game can handle — say so on stderr, the way
		 * a failed dynamic link would. */
		capture_exception(core, "insimulcore: core bundle failed to evaluate");
		fprintf(stderr, "%s\n", core->last_error ? core->last_error : "");
		JS_FreeValue(core->ctx, res);
		insimul_core_destroy(core);
		return NULL;
	}
	JS_FreeValue(core->ctx, res);
	return core;
}

void insimul_core_destroy(insimul_core *core) {
	if (!core) return;
	for (int i = 0; i < core->kb_count; i++) {
		if (core->kbs[i]) insimul_kb_destroy(core->kbs[i]);
	}
	free(core->kbs);
	if (core->keepalive) insimul_kb_destroy(core->keepalive);
	if (core->ctx) JS_FreeContext(core->ctx);
	if (core->rt) JS_FreeRuntime(core->rt);
	free(core->last_error);
	free(core->last_result);
	free(core);
}

/* ── the call ─────────────────────────────────────────────────────────────── */

/* Store `json` (owned by ctx) as the handle's result buffer. */
static const char *store_result(insimul_core *core, JSValueConst json) {
	const char *text = JS_ToCString(core->ctx, json);
	if (!text) {
		set_last_error(core, "insimulcore: result could not be read as a string");
		return NULL;
	}
	size_t n = strlen(text) + 1;
	char *copy = (char *)malloc(n);
	if (!copy) {
		JS_FreeCString(core->ctx, text);
		set_last_error(core, "insimulcore: out of memory");
		return NULL;
	}
	memcpy(copy, text, n);
	JS_FreeCString(core->ctx, text);
	free(core->last_result);
	core->last_result = copy;
	return core->last_result;
}

const char *insimul_core_call(insimul_core *core, const char *method, const char *args_json) {
	if (!core) return NULL;
	set_last_error(core, "");
	if (!method) {
		set_last_error(core, "insimulcore: method is NULL");
		return NULL;
	}

	JSContext *ctx = core->ctx;
	JSValue global = JS_GetGlobalObject(ctx);
	JSValue dispatch = JS_GetPropertyStr(ctx, global, "__insimul_core_dispatch");
	if (!JS_IsFunction(ctx, dispatch)) {
		set_last_error(core, "insimulcore: the bundle did not install __insimul_core_dispatch");
		JS_FreeValue(ctx, dispatch);
		JS_FreeValue(ctx, global);
		return NULL;
	}

	JSValue argv[2];
	argv[0] = JS_NewString(ctx, method);
	argv[1] = args_json ? JS_NewString(ctx, args_json) : JS_NULL;
	JSValue promise = JS_Call(ctx, dispatch, global, 2, (JSValueConst *)argv);
	JS_FreeValue(ctx, argv[0]);
	JS_FreeValue(ctx, argv[1]);
	JS_FreeValue(ctx, dispatch);
	JS_FreeValue(ctx, global);

	if (JS_IsException(promise)) {
		capture_exception(core, "insimulcore");
		JS_FreeValue(ctx, promise);
		return NULL;
	}

	/* Drive the job queue until the promise settles. Every await in the adopted
	 * surface is resolved by JS or by a synchronous C call, so this terminates;
	 * if it ever does not, we report that instead of hanging. */
	const char *result = NULL;
	for (;;) {
		JSPromiseStateEnum state = JS_PromiseState(ctx, promise);
		if (state == JS_PROMISE_FULFILLED || state == JS_PROMISE_REJECTED) break;
		if (state != JS_PROMISE_PENDING) {
			set_last_error(core, "insimulcore: __insimul_core_dispatch did not return a promise");
			JS_FreeValue(ctx, promise);
			return NULL;
		}
		JSContext *job_ctx = NULL;
		int pending = JS_ExecutePendingJob(core->rt, &job_ctx);
		if (pending < 0) {
			capture_exception(core, "insimulcore: a queued job threw");
			JS_FreeValue(ctx, promise);
			return NULL;
		}
		if (pending == 0) {
			set_last_error(core,
					"insimulcore: the call never settled and no jobs remain — the method awaits "
					"something this bridge cannot drive (see insimulcore.h, ASYNC)");
			JS_FreeValue(ctx, promise);
			return NULL;
		}
	}

	JSValue settled = JS_PromiseResult(ctx, promise);
	if (JS_PromiseState(ctx, promise) == JS_PROMISE_REJECTED) {
		const char *text = JS_ToCString(ctx, settled);
		strbuf sb;
		sb_init(&sb);
		sb_puts(&sb, "insimulcore: ");
		sb_puts(&sb, text ? text : "core rejected without a message");
		set_last_error(core, sb.failed ? "insimulcore: out of memory" : sb.data);
		sb_free(&sb);
		if (text) JS_FreeCString(ctx, text);
	} else {
		JSValue json = JS_JSONStringify(ctx, settled, JS_UNDEFINED, JS_UNDEFINED);
		if (JS_IsException(json)) {
			capture_exception(core, "insimulcore: result is not JSON-serialisable");
		} else if (JS_IsUndefined(json)) {
			/* JSON.stringify(undefined) is undefined — report it as JSON null so
			 * a void method still returns a valid document rather than NULL,
			 * which the ABI reserves for errors. */
			JSValue null_literal = JS_NewString(ctx, "null");
			result = store_result(core, null_literal);
			JS_FreeValue(ctx, null_literal);
		} else {
			result = store_result(core, json);
		}
		JS_FreeValue(ctx, json);
	}
	JS_FreeValue(ctx, settled);
	JS_FreeValue(ctx, promise);
	return result;
}

const char *insimul_core_last_error(const insimul_core *core) {
	if (!core) return "insimulcore: NULL handle";
	return core->last_error ? core->last_error : "";
}

const char *insimul_core_version(void) {
	static char buf[256];
	if (buf[0] == '\0') {
		snprintf(buf, sizeof(buf), "%s (quickjs %s, core %s)", INSIMULCORE_ABI_VERSION,
				CONFIG_VERSION, insimul_core_bundle_source_commit);
	}
	return buf;
}
