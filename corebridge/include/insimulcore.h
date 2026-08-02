/*
 * insimulcore.h — the C ABI for `@insimul/core`.
 *
 * This header IS Decision 1 of the unification program
 * (RUNTIME_CORE_ADOPTION.md §4.5): *adapters bind to a C ABI, not to a
 * language*. Godot, Unity and Unreal all consume core through these five
 * functions; what runs behind them (TypeScript in an embedded QuickJS today, a
 * Rust port later) is invisible to every adapter, so the implementation can be
 * replaced without touching a line of engine code.
 *
 * It is shaped deliberately like libinsimul's ABI (vendor/insimul/insimul.h),
 * which this plugin, Unity and Unreal already consume successfully:
 *   - opaque handle, no engine or JS types leaked;
 *   - one handle is owned by one thread, no global state;
 *   - returned strings are owned by the handle and valid until the next call on
 *     that handle that returns a string, or its destruction;
 *   - a failing call reports why through insimul_core_last_error().
 *
 * THE ONE HARD RULE (RUNTIME_CORE_ADOPTION.md §4.5): nothing on a per-frame
 * path crosses this boundary. Every call marshals JSON in and JSON out, which
 * is fine at gameplay-event rate and fatal per frame. Core is the DECISION
 * layer; rendering, input, animation and physics stay engine-side.
 *
 * WHERE THIS SHOULD EVENTUALLY LIVE: `native/` beside libinsimul, built and
 * packaged as `libinsimulcore` by the same CMake, so all three engines link one
 * artifact instead of three. It lives here for now because tasklist 100's
 * worktree is this repository; the header is the part that must not fork when
 * it moves. See gdextension/corebridge/README.md.
 */

#ifndef INSIMULCORE_H
#define INSIMULCORE_H

#ifdef __cplusplus
extern "C" {
#endif

/* Opaque handle. One handle owns one JS runtime and its Prolog KBs. */
typedef struct insimul_core insimul_core;

/*
 * Create a core runtime: instantiate the JS engine and evaluate the vendored
 * `@insimul/core` bundle. Returns NULL if the runtime could not be created or
 * the bundle failed to evaluate. Creation is the expensive call (a few ms) —
 * create ONE per game and keep it, as you would a libinsimul KB.
 */
insimul_core *insimul_core_create(void);

/* Destroy a runtime and everything it owns (JS heap, Prolog KBs). NULL-safe. */
void insimul_core_destroy(insimul_core *core);

/*
 * Call an adopted core method.
 *
 * `method`    — a name from the bundle's method table (gdextension/corebridge/
 *               js/entry.js), e.g. "radiant.generate". Call "core.methods" to
 *               enumerate them.
 * `args_json` — the arguments as a JSON object string. NULL means `{}`.
 *
 * Returns the result as a JSON string owned by `core`, valid until the next
 * insimul_core_call() on the same handle or its destruction. Returns NULL on
 * error; insimul_core_last_error(core) then holds the reason (a JS exception
 * message, including a stack-free `Error.message`, when the failure came from
 * core).
 *
 * ASYNC: core is promise-based. This call drives the JS job queue until the
 * returned promise settles, so it is synchronous from the host's point of view.
 * A method whose promise can only settle on external I/O would therefore
 * deadlock; the adopted surface deliberately contains no such method, and the
 * attempt is reported as an error rather than hanging.
 */
const char *insimul_core_call(insimul_core *core, const char *method, const char *args_json);

/*
 * Human-readable message for the most recent failure on this handle, or "" if
 * none. Owned by the handle. Never NULL, including for a NULL handle.
 */
const char *insimul_core_last_error(const insimul_core *core);

/*
 * Library version: "<abi-version> (quickjs <pin>, core <source-commit>)".
 * The core commit is the one the vendored bundle was built from — that is the
 * string to quote in a bug report about core behaviour.
 */
const char *insimul_core_version(void);

#ifdef __cplusplus
} /* extern "C" */
#endif

#endif /* INSIMULCORE_H */
