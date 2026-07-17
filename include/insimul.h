#ifndef INSIMUL_H
#define INSIMUL_H

/*
 * insimul.h — the stable C ABI for libinsimul, the shared native Prolog core
 * used by the Unreal, Unity, and Godot engine plugins.
 *
 * INVARIANT: this header includes no Trealla (or any other engine) headers and
 * leaks no engine types. The Prolog engine is an implementation detail behind
 * this opaque, extern "C" boundary, so the engine can be swapped later without
 * breaking the wrappers that parse this contract.
 *
 * THREAD MODEL: one insimul_kb is owned by one thread. There is no global
 * mutable state shared across KBs, so a host may run N independent KBs on N
 * threads (required for Unity/Unreal). A single KB, its queries, and its error
 * string must not be touched concurrently from more than one thread.
 *
 * OWNERSHIP / STRINGS: every `const char *` returned by this ABI is owned by the
 * object it came from (the kb for insimul_last_error, the query for
 * insimul_query_next) and stays valid until that object is destroyed/stopped or
 * a later call on the same object replaces it (see each function). Callers copy
 * anything they need to keep; they never free a returned pointer.
 *
 * ERROR REPORTING: mutating calls return an int status (see each function).
 * Whenever a call reports failure, insimul_last_error(kb) returns a human/machine
 * readable message (the caught Prolog exception term, quoted). A successful call
 * clears it back to NULL.
 */

#ifdef __cplusplus
extern "C" {
#endif

/* Opaque handles. */
typedef struct insimul_kb insimul_kb;
typedef struct insimul_query insimul_query;

/*
 * Create / destroy a knowledge base. insimul_kb_create() returns NULL only if
 * the engine or its bootstrap failed to initialize (out of memory). Every KB
 * starts with the standard library available and an empty user program.
 * insimul_kb_destroy(NULL) is a no-op; after it returns the handle is invalid.
 */
insimul_kb *insimul_kb_create(void);
void        insimul_kb_destroy(insimul_kb *kb);

/*
 * Load Prolog program text (`source`, one or more clauses/directives) into the
 * KB. Directives (`:- Goal`, including `:- op/3`) are executed as they are read,
 * so operator definitions affect the rest of the source. Returns 0 on success;
 * on a syntax error nothing from `source` is loaded, the call returns -1, and
 * insimul_last_error(kb) describes the error.
 */
int insimul_kb_consult(insimul_kb *kb, const char *source);

/*
 * Assert one clause (a fact or `Head :- Body`) given as Prolog term text WITHOUT
 * a trailing full stop, e.g. "likes(alice, wine)" or "adult(X) :- age(X, A), A >= 18".
 * Undefined predicates are auto-created dynamic. Returns 0 on success, -1 on
 * error (e.g. asserting into a predicate the program defined as static — see
 * insimul_last_error).
 */
int insimul_kb_assert(insimul_kb *kb, const char *fact);

/*
 * Retract the first clause unifying with `fact` (term text, no trailing stop).
 * Returns 0 if a clause was removed, 1 if none matched (not an error, error
 * string stays clear), -1 on error.
 */
int insimul_kb_retract(insimul_kb *kb, const char *fact);

/*
 * Start a query. `goal` is Prolog goal text WITHOUT a trailing full stop, e.g.
 * "grandparent(tom, X)" or "member(X, [a,b,c])". Solutions are computed eagerly
 * at start (this suits finite goals — conformance cases and save-file rules) and
 * then streamed out by insimul_query_next.
 *
 * Returns a query handle on success — even when the goal has zero solutions, in
 * which case the first insimul_query_next returns NULL immediately. Returns NULL
 * if the goal raised an error (syntax/type/etc.); insimul_last_error(kb) then
 * holds the reason. The handle must be released with insimul_query_stop.
 */
insimul_query *insimul_query_start(insimul_kb *kb, const char *goal);

/*
 * Return the next solution's binding set as a JSON object string, or NULL when
 * the solutions are exhausted. The returned pointer is owned by the query and
 * valid until insimul_query_stop(q).
 *
 * Binding-set JSON format (the exact shape the engine wrappers parse):
 *   { "Var": <value>, ... }   — one entry per named goal variable
 * with Prolog terms mapped as:
 *   atom            -> JSON string        ("foo")
 *   integer / float -> JSON number        (42, 3.14)
 *   list            -> JSON array         ([1, "a", ...])   ([] stays "[]")
 *   compound f(A..) -> {"functor":"f","args":[ <value>, ... ]}
 *   unbound var     -> null
 * A goal with no (named) variables that succeeds yields "{}". Variables whose
 * source name begins with '_' are omitted.
 */
const char *insimul_query_next(insimul_query *q);

/* Release a query handle (NULL is a no-op). */
void insimul_query_stop(insimul_query *q);

/*
 * Snapshot the KB's dynamic state — every fact and rule the host consulted or
 * asserted — as canonical Prolog program text, the bridge to a save file's
 * currentState.prologFacts. Returns a NUL-terminated image string, or NULL on
 * error (see insimul_last_error). The returned pointer is owned by the KB and
 * valid until the next insimul_kb_snapshot on the same KB or its destruction;
 * copy it to keep it.
 *
 * The image is DETERMINISTIC: the same logical state always serializes to
 * byte-identical text (predicates in standard Name/Arity order, clauses in assert
 * order), so two equal states produce equal snapshots. It is both re-readable by
 * insimul_kb_restore and parseable by the wrappers' Prolog fact parser (one clause
 * per line, single-quoted atoms, A/B/C variables). The bootstrap's own predicates
 * are never included.
 */
const char *insimul_kb_snapshot(insimul_kb *kb);

/*
 * Restore a KB's dynamic state from a snapshot `image` (as produced by
 * insimul_kb_snapshot). This REPLACES the current dynamic state: the image is
 * parsed first (a malformed image is rejected with -1 and the KB left unchanged),
 * then all existing dynamic user clauses are removed and the image's clauses
 * loaded in order. Returns 0 on success, -1 on error (see insimul_last_error).
 * A round-trip (snapshot then restore into a fresh KB) reproduces identical query
 * results.
 */
int insimul_kb_restore(insimul_kb *kb, const char *image);

/*
 * The last error message for this KB, or NULL if the most recent operation
 * succeeded. Owned by the KB; valid until the next ABI call on the KB.
 */
const char *insimul_last_error(insimul_kb *kb);

/*
 * A stable version stamp for this build of libinsimul. Returns a static,
 * NUL-terminated string (never NULL, never freed) of the form:
 *
 *   "insimul <semver> (git <sha>, trealla <tag>/<commit>)"
 *
 * where <semver> is the library's own version (VERSION file), <sha> is the
 * short git commit it was built from ("unknown" if git was unavailable at
 * configure time), and <tag>/<commit> is the pinned Trealla engine. This is
 * the same information written to a package's VERSION file (see scripts/
 * package.sh); the three engine wrappers surface it for diagnostics. No KB is
 * required to call it.
 */
const char *insimul_version(void);

#ifdef __cplusplus
} /* extern "C" */
#endif

#endif /* INSIMUL_H */
