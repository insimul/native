#ifndef INSIMUL_H
#define INSIMUL_H

/*
 * insimul.h — the stable C ABI for libinsimul, the shared native Prolog core
 * used by the Unreal, Unity, and Godot engine plugins.
 *
 * INVARIANT: this header includes no engine headers, leaks no engine types, and
 * names no engine VENDOR — not in a type, not in a macro, not in a format
 * string. The Prolog engine is an implementation detail behind this opaque,
 * extern "C" boundary, so the engine can be swapped without breaking the
 * wrappers that parse this contract. `ctest -R abi_neutrality` enforces the
 * naming half of that invariant on this file (and proves it can fail); the `abi`
 * ctest, which includes only this header, enforces the type half.
 *
 * WHAT THIS ABI PROMISES (the semantics a swap must reproduce), and what it
 * deliberately does not — see docs/ABI_ENGINE_LEAK_AUDIT.md for the evidence
 * behind every line of this list:
 *
 *   PROMISED
 *   - ISO/IEC 13211-1 Prolog semantics for everything the corpus in
 *     conformance/prolog covers: unification, backtracking order, arithmetic,
 *     negation as failure, assert/retract, findall/bagof/setof, lists.
 *   - double_quotes is `chars` and unknown is `error`. These are insimul's
 *     choices, pinned by the bootstrap, NOT whatever the engine defaults to: a
 *     double-quoted literal is a list of one-char atoms, and calling an
 *     undefined procedure raises existence_error rather than failing. ("Raised"
 *     is not a synonym for "undefined": other classes raise too — branch on
 *     insimul_last_error_class(), never on "did it raise".)
 *   - the binding-set JSON below, byte for byte, including how a big integer,
 *     an unbound variable and a partial list are shaped.
 *   - an ISO error class on every failure (insimul_last_error_class).
 *   - names beginning with '$' are reserved to this library: a goal, clause or
 *     directive that mentions one is refused with permission_error.
 *
 *   NOT PROMISED (engine-visible; a swap changes these and no wrapper should
 *   depend on them)
 *   - the standard order of terms across NUMERIC TYPES. The pinned engine
 *     orders by type before value, so sort/2 puts every float before every
 *     integer and compare(O, 1.0, 0) answers `<`, where ISO 7.2.1 orders by
 *     value. A KB that sorts mixed integers and floats gets a different answer
 *     ORDER on a different engine, and the JSON still looks well formed.
 *   - whether integers are bounded. Here they are not, so a KB can compute an
 *     integer no double can hold (which is why the JSON has a bigint shape).
 *   - which library predicates exist beyond ISO's builtins. Module-qualified
 *     goals resolve, and between/3, msort/2, succ/2, format/3 are all present.
 *     Only what the conformance corpus exercises is guaranteed to survive a
 *     swap.
 *   - whether an arithmetic functor name (log, sin, max, gcd, …) may ALSO be
 *     used as a predicate name. Here it may not: asserta(log(0)) raises
 *     permission_error(modify, static_procedure, log/1), which ISO does not
 *     require.
 *   - the exact text of insimul_last_error(); the CLASS is the contract.
 *
 * THREAD MODEL: one insimul_kb is owned by one thread. A single KB, its
 * queries, and its error string must not be touched concurrently from more than
 * one thread. Running N KBs on N threads is UNPROVEN, not promised: the engine
 * keeps process-global state (an interned symbol table), no test here exercises
 * concurrent KBs under a race detector, and the Rust server deliberately runs a
 * single engine thread for that reason. Treat multi-threaded use as a host's
 * own risk until a race-detector gate exists.
 *
 * OWNERSHIP / STRINGS: every `const char *` returned by this ABI is owned by the
 * object it came from (the kb for insimul_last_error, the query for
 * insimul_query_next) and stays valid until that object is destroyed/stopped or
 * a later call on the same object replaces it (see each function). Callers copy
 * anything they need to keep; they never free a returned pointer.
 *
 * ERROR REPORTING: mutating calls return an int status (see each function).
 * Whenever a call reports failure, insimul_last_error_class(kb) returns the ISO
 * error class to BRANCH on and insimul_last_error(kb) the exception term's text
 * as human-readable DETAIL. A successful call clears both back to NULL. Never
 * pattern-match the text: it is the engine's own rendering and three engines
 * write the same ISO error three different ways.
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
 * starts with ISO's builtins available and an empty user program.
 * insimul_kb_destroy(NULL) is a no-op; after it returns the handle is invalid.
 *
 * KBs may be created and destroyed in any order, any number of times, including
 * destroying every KB and then creating another. (libinsimul holds one internal
 * engine instance open for the life of the process to make that true; hosts do
 * not need — and should not add — a keepalive KB of their own.)
 */
insimul_kb *insimul_kb_create(void);
void        insimul_kb_destroy(insimul_kb *kb);

/*
 * Load Prolog program text (`source`, one or more clauses/directives) into the
 * KB. Directives (`:- Goal`, including `:- op/3`) are executed as they are read,
 * so operator definitions affect the rest of the source. Returns 0 on success;
 * on a syntax error nothing from `source` is loaded, the call returns -1, and
 * insimul_last_error(kb) describes the error.
 *
 * A DIRECTIVE THAT RAISES OR FAILS FAILS THE WHOLE LOAD (-1, with the reason) —
 * a misspelled `:- set_prolog_flag(...)` is an error, not a silent no-op. The
 * load is transactional, so a rejected source adds no clauses; directives that
 * already ran are not undone, which for the operator/flag setup directives are
 * for is the useful behaviour.
 *
 * Clauses and directives that mention a '$'-prefixed name are refused with
 * permission_error: those names are reserved to this library.
 */
int insimul_kb_consult(insimul_kb *kb, const char *source);

/*
 * Assert one clause (a fact or `Head :- Body`) given as Prolog term text WITHOUT
 * a trailing full stop, e.g. "likes(alice, wine)" or "adult(X) :- age(X, A), A >= 18".
 * Undefined predicates are auto-created dynamic. Returns 0 on success, -1 on
 * error (e.g. asserting into a predicate the program defined as static, or a
 * term mentioning a reserved '$'-prefixed name — see insimul_last_error_class).
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
 * if the goal raised an error (syntax/type/etc.); insimul_last_error_class(kb)
 * then holds its ISO class and insimul_last_error(kb) the detail. A goal that
 * mentions a reserved '$'-prefixed name is refused the same way
 * (permission_error). The handle must be released with insimul_query_stop.
 */
insimul_query *insimul_query_start(insimul_kb *kb, const char *goal);

/*
 * Return the next solution's binding set as a JSON object string, or NULL when
 * the solutions are exhausted. The returned pointer is owned by the query and
 * valid until insimul_query_stop(q).
 *
 * Binding-set JSON format (the exact shape the engine wrappers parse). It is
 * RFC 8259 JSON — every control character is escaped — and it is produced by
 * this library, not by the engine's term writer:
 *   { "Var": <value>, ... }   — one entry per named goal variable
 * with Prolog terms mapped as:
 *   atom            -> JSON string        ("foo")
 *   integer / float -> JSON number        (42, 3.14)
 *   integer whose magnitude exceeds 2^53-1
 *                   -> {"bigint":"<decimal digits>"}   (lossless; a JSON number
 *                      is a double to every consumer, so it could not hold one)
 *   float inf / nan -> {"float":"inf"|"-inf"|"nan"}    (JSON has no such number;
 *                      the pinned engine raises instead of producing them)
 *   list            -> JSON array         ([1, "a", ...])   ([] stays "[]")
 *   compound f(A..) -> {"functor":"f","args":[ <value>, ... ]}
 *   unbound var     -> null
 * A goal with no (named) variables that succeeds yields "{}". Variables whose
 * source name begins with '_' are omitted — including a NAMED one like _Y.
 *
 * A partial list [a|Y] is a compound and is always reported with the functor
 * "." whatever the engine calls its cons cell internally (ISO says '.'; some
 * engines use another name); the cons name in this JSON is insimul's.
 *
 * A NUL byte inside an atom does not survive: the channel is C strings, so the
 * value is truncated there. Prolog text handed to this ABI is likewise NUL-
 * terminated. This is a property of the ABI, not of the engine.
 */
const char *insimul_query_next(insimul_query *q);

/* Release a query handle (NULL is a no-op). */
void insimul_query_stop(insimul_query *q);

/*
 * Snapshot the KB's dynamic state — every fact and rule the host consulted or
 * asserted — as canonical Prolog program text. Returns a NUL-terminated image
 * string, or NULL on error (see insimul_last_error). The returned pointer is
 * owned by the KB and valid until the next insimul_kb_snapshot on the same KB
 * or its destruction; copy it to keep it.
 *
 * THIS IMAGE IS AN INTERCHANGE / DEBUG FORMAT, NOT A SAVE FORMAT. Do not
 * persist it in a user's save file. The persisted form is the structured fact
 * list a host builds from query results (a save file's
 * currentState.prologFacts: {predicate, args} records of ground terms), which
 * any Prolog can write and read. The image, by contrast, is program TEXT: while
 * the clause order and the option set used to write it are pinned here,
 * operator spacing and how a float is re-rendered are the engine's, and an
 * unbounded integer inside it cannot be read back by a bounded engine. Writing
 * it into a save would make an engine swap a save-file migration.
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
 *
 * This is human-readable DETAIL — the caught exception term as the engine
 * renders it. Its wording, its predicate-indicator notation and which goal it
 * blames all change with the engine. Branch on insimul_last_error_class().
 */
const char *insimul_last_error(insimul_kb *kb);

/*
 * The ISO error class of that message, or NULL if the most recent operation
 * succeeded. Owned by the KB, valid for the same span as insimul_last_error.
 * One of ISO/IEC 13211-1 7.12.2's fixed names:
 *
 *   "instantiation_error"  "type_error"        "domain_error"
 *   "existence_error"      "permission_error"  "representation_error"
 *   "evaluation_error"     "resource_error"    "syntax_error"
 *   "system_error"
 *
 * plus "unknown" when a program threw something that is not an error/2 term.
 * "system_error" also covers this library's own infrastructure failures (out of
 * memory, temp file), which is what they are to a host.
 *
 * This is the value to branch on: it is drawn from a standard vocabulary, so it
 * is the same token on any conforming engine, whereas the message text is not.
 * The class of a syntax error is "syntax_error" on every engine; the ATOM
 * inside that term is the engine's own vocabulary and appears only in the text.
 */
const char *insimul_last_error_class(insimul_kb *kb);

/*
 * A stable version stamp for this build of libinsimul. Returns a static,
 * NUL-terminated string (never NULL, never freed) of the form:
 *
 *   "insimul <semver> (git <sha>, engine <name>/<version>/<commit>)"
 *
 * where <semver> is the library's own version (VERSION file), <sha> is the
 * short git commit it was built from ("unknown" if git was unavailable at
 * configure time), and <name>/<version>/<commit> identifies the Prolog engine
 * this build embeds. The engine's identity is a VALUE, never part of the
 * schema: swapping the engine changes what those three fields say and nothing
 * about how they are parsed. This is the same information written to a
 * package's VERSION file under engine_name / engine_version / engine_commit
 * (see scripts/package.sh); the three engine wrappers surface it for
 * diagnostics. No KB is required to call it.
 */
const char *insimul_version(void);

#ifdef __cplusplus
} /* extern "C" */
#endif

#endif /* INSIMUL_H */
