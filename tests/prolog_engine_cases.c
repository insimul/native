/*
 * prolog_engine_cases.c — the `prolog_engine_cases` ctest (PL.native-consult-floor-leak).
 *
 * Replays corebridge/tests/prolog-engine/*.json against
 * corebridge/js/host-prolog-engine.js — the adapter that implements core's
 * PrologEngine seam over libinsimul — and corebridge/tests/prolog-engine/driver.js,
 * evaluated together as ONE module inside a real libinsimulcore runtime. The engine
 * under test therefore talks to the real __insimul_prolog_* globals and the native
 * engine; the driver compares it, step by step and probe by probe, with the same
 * file's rebuild-only oracle, checks each step's stated `expect` and `cost`, and
 * runs the seeded differential. Case format: the driver's header comment.
 *
 * Not a pure consumer of insimulcore.h: it needs the handle's QuickJS context and
 * KB table, which corebridge/src/insimulcore_testing.h exposes to this repository's
 * tests only.
 *
 * A KB must not print (PL.native-kb-instantiation-error): each case file runs
 * under tests/stdout_guard.h, and a file during which the library wrote anything
 * to stdout FAILS with those bytes shown, even when every answer held.
 *
 * usage: insimulcore_prolog_engine <host-prolog-engine.js> <driver.js> <case.json>...
 * Exit 0 when every case and the fuzz block hold, nothing reached stdout, and at
 * least one step ran.
 */
#include "insimulcore.h"
#include "insimulcore_testing.h"
#include "stdout_guard.h"

#include <stdio.h>
#include <stdlib.h>
#include <string.h>

static char *slurp(const char *path, size_t *len) {
	FILE *fp = fopen(path, "rb");
	if (!fp) return NULL;
	fseek(fp, 0, SEEK_END);
	long n = ftell(fp);
	rewind(fp);
	char *buf = (char *)malloc((size_t)n + 1);
	if (!buf) {
		fclose(fp);
		return NULL;
	}
	size_t got = fread(buf, 1, (size_t)n, fp);
	fclose(fp);
	buf[got] = '\0';
	if (len) *len = got;
	return buf;
}

static insimul_core *g_core;

static JSValue js_kb_slots(JSContext *ctx, JSValueConst this_val, int argc, JSValueConst *argv) {
	(void)this_val;
	(void)argc;
	(void)argv;
	return JS_NewInt32(ctx, insimulcore_testing_kb_slots(g_core));
}

/* Drive the job queue until `promise` settles; returns 0 on fulfilment. */
static int settle(JSContext *ctx, JSValue promise, JSValue *out) {
	JSRuntime *rt = JS_GetRuntime(ctx);
	for (;;) {
		JSPromiseStateEnum st = JS_PromiseState(ctx, promise);
		if (st == JS_PROMISE_FULFILLED || st == JS_PROMISE_REJECTED) break;
		if (st != JS_PROMISE_PENDING) {
			*out = JS_DupValue(ctx, promise);
			return 0; /* not a promise: the value itself */
		}
		JSContext *job = NULL;
		int pending = JS_ExecutePendingJob(rt, &job);
		if (pending < 0) {
			*out = JS_GetException(ctx);
			return -1;
		}
		if (pending == 0) {
			*out = JS_NewString(ctx, "the promise never settled and no jobs remain");
			return -1;
		}
	}
	*out = JS_PromiseResult(ctx, promise);
	return JS_PromiseState(ctx, promise) == JS_PROMISE_REJECTED ? -1 : 0;
}

static void print_value(JSContext *ctx, const char *prefix, JSValue v) {
	const char *s = JS_ToCString(ctx, v);
	fprintf(stderr, "%s%s\n", prefix, s ? s : "(unprintable)");
	if (s) JS_FreeCString(ctx, s);
	if (JS_IsError(ctx, v)) {
		JSValue stack = JS_GetPropertyStr(ctx, v, "stack");
		const char *st = JS_ToCString(ctx, stack);
		if (st) {
			fprintf(stderr, "%s\n", st);
			JS_FreeCString(ctx, st);
		}
		JS_FreeValue(ctx, stack);
	}
}

int main(int argc, char **argv) {
	if (argc < 4) {
		fprintf(stderr, "usage: %s <host-prolog-engine.js> <driver.js> <case.json>...\n", argv[0]);
		return 2;
	}
	size_t elen = 0, dlen = 0;
	char *engine = slurp(argv[1], &elen);
	char *driver = slurp(argv[2], &dlen);
	if (!engine || !driver) {
		fprintf(stderr, "prolog_engine_cases: cannot read %s or %s\n", argv[1], argv[2]);
		return 2;
	}
	char *module = (char *)malloc(elen + dlen + 2);
	memcpy(module, engine, elen);
	module[elen] = '\n';
	memcpy(module + elen + 1, driver, dlen + 1);

	g_core = insimul_core_create();
	if (!g_core) {
		fprintf(stderr, "prolog_engine_cases: insimul_core_create failed\n");
		return 1;
	}
	JSContext *ctx = insimulcore_testing_context(g_core);
	JSValue global = JS_GetGlobalObject(ctx);
	JS_SetPropertyStr(ctx, global, "__pe_kb_slots", JS_NewCFunction(ctx, js_kb_slots, "__pe_kb_slots", 0));

	JSValue ev = JS_Eval(ctx, module, strlen(module), "host-prolog-engine+driver.js", JS_EVAL_TYPE_MODULE);
	if (JS_IsException(ev)) {
		JSValue exc = JS_GetException(ctx);
		print_value(ctx, "prolog_engine_cases: the module failed to evaluate: ", exc);
		return 1;
	}
	JSValue evd;
	if (settle(ctx, ev, &evd) != 0) {
		print_value(ctx, "prolog_engine_cases: the module rejected: ", evd);
		return 1;
	}
	JS_FreeValue(ctx, evd);
	JS_FreeValue(ctx, ev);

	JSValue run = JS_GetPropertyStr(ctx, global, "__pe_run");
	int failed = 0, cases = 0, steps = 0;
	for (int f = 3; f < argc; f++) {
		char *text = slurp(argv[f], NULL);
		if (!text) {
			fprintf(stderr, "prolog_engine_cases: cannot read %s\n", argv[f]);
			return 2;
		}
		JSValue arg = JS_NewString(ctx, text);
		free(text);
		stdout_guard guard;
		if (stdout_guard_begin(&guard) != 0) {
			fprintf(stderr, "prolog_engine_cases: cannot watch stdout for %s\n", argv[f]);
			return 2;
		}
		JSValue p = JS_Call(ctx, run, global, 1, (JSValueConst *)&arg);
		JS_FreeValue(ctx, arg);
		JSValue res;
		int threw = JS_IsException(p) || settle(ctx, p, &res) != 0;
		size_t stray_len = 0;
		char *stray = stdout_guard_end(&guard, &stray_len);
		if (!stray || stray_len) {
			printf("[FAIL] %s: the library wrote %zu byte(s) to stdout while its cases ran (a KB must not print):\n%s\n",
			       argv[f], stray_len, stray ? stray : "(could not read them back)");
			failed++;
		}
		free(stray);
		if (threw) {
			if (JS_IsException(p)) res = JS_GetException(ctx);
			print_value(ctx, "prolog_engine_cases: the driver threw: ", res);
			return 1;
		}
		JS_FreeValue(ctx, p);
		/* The report is a JSON array of { name, problems[], stats }; walk it in JS terms. */
		const char *rtext = JS_ToCString(ctx, res);
		JSValue report = JS_ParseJSON(ctx, rtext ? rtext : "[]", rtext ? strlen(rtext) : 2, "report");
		if (rtext) JS_FreeCString(ctx, rtext);
		JSValue lenv = JS_GetPropertyStr(ctx, report, "length");
		int32_t n = 0;
		JS_ToInt32(ctx, &n, lenv);
		for (int32_t i = 0; i < n; i++) {
			JSValue item = JS_GetPropertyUint32(ctx, report, (uint32_t)i);
			JSValue name = JS_GetPropertyStr(ctx, item, "name");
			JSValue probs = JS_GetPropertyStr(ctx, item, "problems");
			JSValue stats = JS_GetPropertyStr(ctx, item, "stats");
			JSValue sjson = JS_JSONStringify(ctx, stats, JS_UNDEFINED, JS_UNDEFINED);
			JSValue sv = JS_GetPropertyStr(ctx, stats, "steps");
			int32_t ns = 0, np = 0;
			JS_ToInt32(ctx, &ns, sv);
			JSValue plen = JS_GetPropertyStr(ctx, probs, "length");
			JS_ToInt32(ctx, &np, plen);
			const char *nm = JS_ToCString(ctx, name);
			const char *sj = JS_ToCString(ctx, sjson);
			printf("[%s] %s — %s\n", np ? "FAIL" : "PASS", nm ? nm : "?", sj ? sj : "");
			for (int32_t k = 0; k < np; k++) {
				JSValue pr = JS_GetPropertyUint32(ctx, probs, (uint32_t)k);
				const char *ps = JS_ToCString(ctx, pr);
				printf("    %s\n", ps ? ps : "?");
				if (ps) JS_FreeCString(ctx, ps);
				JS_FreeValue(ctx, pr);
			}
			if (np) failed++;
			cases++;
			steps += ns;
			if (nm) JS_FreeCString(ctx, nm);
			if (sj) JS_FreeCString(ctx, sj);
			JS_FreeValue(ctx, plen);
			JS_FreeValue(ctx, sv);
			JS_FreeValue(ctx, sjson);
			JS_FreeValue(ctx, stats);
			JS_FreeValue(ctx, probs);
			JS_FreeValue(ctx, name);
			JS_FreeValue(ctx, item);
		}
		JS_FreeValue(ctx, lenv);
		JS_FreeValue(ctx, report);
		JS_FreeValue(ctx, res);
	}
	JS_FreeValue(ctx, run);
	JS_FreeValue(ctx, global);
	printf("prolog_engine_cases: %d case(s), %d step(s), %d failed\n", cases, steps, failed);
	insimul_core_destroy(g_core);
	free(module);
	free(engine);
	free(driver);
	if (cases == 0 || steps == 0) {
		fprintf(stderr, "prolog_engine_cases: nothing ran — an empty corpus is a failure, not a pass\n");
		return 1;
	}
	return failed ? 1 : 0;
}
