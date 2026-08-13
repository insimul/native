/*
 * neutrality.c — ctest `abi_neutral_runtime` (US-2).
 *
 * The runtime half of "the ABI speaks ISO Prolog, not Trealla". It includes ONLY
 * <insimul.h>, like every wrapper, and asserts the behaviours US-2 moved from
 * "whatever the engine happens to do" to "what this ABI promises". Each block
 * names the audit finding it pins down (docs/ABI_ENGINE_LEAK_AUDIT.md).
 *
 * The source half — the header names no vendor, and a vendor-shaped include does
 * not compile — is tests/run_abi_neutrality.sh (ctest `abi_neutrality`), which
 * also proves both of its checks can fail.
 */

#include "insimul.h"
#include <stdio.h>
#include <string.h>

/*
 * THE ENGINE ROWS ARE DECLARED BY THE BUILD, NOT BY THIS FILE.
 *
 * insimul.h's "NOT PROMISED" list names behaviours a swap is allowed to change.
 * A test cannot assert one without knowing which engine it got — and it must not
 * learn that by naming a vendor (that was leak L-02: a test that asserts the
 * vendor's name turns an engine swap into a red test in someone else's repo).
 * So the build states the BEHAVIOUR, as a property, next to the engine selection
 * that decides it (CMakeLists.txt, INSIMUL_ENGINE_ROWS). This file only reads it.
 *
 * A gate is still a gate: if the selected engine changes one of these without
 * CMakeLists.txt being updated in the same commit, this test goes red — which is
 * exactly what these rows exist for. The defaults below are for a non-CMake
 * compile only.
 */
#ifndef INSIMUL_ENGINE_TYPE_FIRST_ORDER
#define INSIMUL_ENGINE_TYPE_FIRST_ORDER 1
#endif
#ifndef INSIMUL_ENGINE_ARITH_NAMES_ARE_STATIC
#define INSIMUL_ENGINE_ARITH_NAMES_ARE_STATIC 1
#endif

static int failures = 0;

#define CHECK(cond, msg) do { \
    if (cond) { printf("  ok   %s\n", msg); } \
    else { printf("  FAIL %s\n", msg); failures++; } \
} while (0)

static void check_eq(const char *got, const char *want, const char *msg)
{
    if (got && strcmp(got, want) == 0) { printf("  ok   %s\n", msg); return; }
    printf("  FAIL %s\n         got:  %s\n         want: %s\n", msg, got ? got : "(null)", want);
    failures++;
}

/* First solution of `goal` into `out`, or NULL if the query did not start. */
static const char *first(insimul_kb *kb, const char *goal, char *out, size_t n)
{
    insimul_query *q = insimul_query_start(kb, goal);
    if (!q) return NULL;
    const char *s = insimul_query_next(q);
    if (s) snprintf(out, n, "%s", s); else out[0] = '\0';
    insimul_query_stop(q);
    return out;
}

/* Run a goal expected to raise; return its error class (NULL if it succeeded). */
static const char *raises(insimul_kb *kb, const char *goal)
{
    insimul_query *q = insimul_query_start(kb, goal);
    if (q) { insimul_query_stop(q); return NULL; }
    return insimul_last_error_class(kb);
}

static int mentions(const char *s, const char *needle)
{
    return s && strstr(s, needle) != NULL;
}

int main(void)
{
    char buf[512];

    /* --- L-01: the lifecycle contract the header states -------------------
     * A KB may be created after EVERY other KB has been destroyed. This block
     * runs first, and holds no other handle, precisely so the last destroy of
     * each round is the one that used to tear down the engine's process-global
     * state — cycle 2's destroy then never returned (it spins, so the ctest
     * TIMEOUT rather than a crash is what catches a regression).
     *
     * Verified to fail without the fix: stubbing out ensure_keepalive() in
     * src/insimul.c makes this binary hang at cycle 2 exactly as the audit's
     * probe did. */
    printf("L-01 create/destroy cycles (no other KB alive)\n");
    for (int i = 0; i < 3; i++) {
        insimul_kb *tmp = insimul_kb_create();
        CHECK(tmp != NULL, "create a KB with no other KB alive");
        if (tmp) {
            CHECK(insimul_kb_consult(tmp, "cycled(1).\n") == 0, "the cycled KB works");
            insimul_kb_destroy(tmp);       /* the LAST KB: the teardown that spun */
        }
    }

    insimul_kb *kb = insimul_kb_create();
    CHECK(kb != NULL, "insimul_kb_create after the cycles");
    if (!kb) return 1;
    CHECK(insimul_kb_consult(kb, "still_here(1).\n") == 0, "and it is a working KB");

    /* --- L-03/L-04: the flags are OURS, pinned, not the engine's defaults -- */
    printf("L-03/L-04 pinned flags\n");
    check_eq(first(kb, "current_prolog_flag(double_quotes, F)", buf, sizeof buf),
             "{\"F\":\"chars\"}", "double_quotes is pinned to chars");
    check_eq(first(kb, "current_prolog_flag(unknown, F)", buf, sizeof buf),
             "{\"F\":\"error\"}", "unknown is pinned to error");
    check_eq(first(kb, "X = \"ab\"", buf, sizeof buf),
             "{\"X\":[\"a\",\"b\"]}", "a double-quoted literal is a char list");

    /* --- L-08/L-09/L-10: the error surface is a CLASS, not vendor text ----- */
    printf("L-08/L-09/L-10 classified errors\n");
    check_eq(raises(kb, "no_such_pred(1)"), "existence_error", "undefined procedure -> existence_error");
    check_eq(raises(kb, "X is foo + 1"), "type_error", "bad evaluable -> type_error");
    check_eq(raises(kb, "X is _Y + 1"), "instantiation_error", "unbound arithmetic -> instantiation_error");
    check_eq(raises(kb, "X is 1 // 0"), "evaluation_error", "division by zero -> evaluation_error");
    check_eq(raises(kb, "foo(bar"), "syntax_error", "unbalanced goal -> syntax_error");
    check_eq(raises(kb, "throw(a_ball)"), "unknown", "a non-error/2 throw -> unknown");
    /* A type error raised by a BUILTIN (not by is/2) still arrives classified.
     * The culprit is a compound where text is required, which is a type error on
     * any conforming engine — `atom_length(1, _)` is NOT, because engines differ
     * on whether a number counts as text, and that difference is the engine's
     * (tasklist 250 found this checking leniency rather than classification). */
    check_eq(raises(kb, "atom_length(f(x), _X)"), "type_error", "type_error from a builtin");

    /* The class must be cleared by a successful call, exactly like the text. */
    (void)first(kb, "still_here(1)", buf, sizeof buf);
    CHECK(insimul_last_error(kb) == NULL && insimul_last_error_class(kb) == NULL,
          "success clears both the message and the class");

    /* L-10: the detail may name the engine's own vocabulary, but never OURS.
     * The bootstrap's reader used to be blamed for the host's syntax error. */
    insimul_query *q = insimul_query_start(kb, "foo(bar");
    CHECK(q == NULL, "syntax-error goal still fails the start");
    printf("       detail: %s\n", insimul_last_error(kb));
    CHECK(!mentions(insimul_last_error(kb), "read_term"),
          "the error names no bootstrap predicate (read_term_from_atom/3)");
    CHECK(mentions(insimul_last_error(kb), "insimul_query_start"),
          "the error context is the ABI call that raised");

    /* --- L-13: RFC 8259 — every C0 control is escaped --------------------- */
    printf("L-13 JSON escaping\n");
    check_eq(first(kb, "atom_codes(X, [97,11,98])", buf, sizeof buf),
             "{\"X\":\"a\\u000bb\"}", "U+000B is escaped, not emitted raw");
    check_eq(first(kb, "atom_codes(X, [8,12,31])", buf, sizeof buf),
             "{\"X\":\"\\b\\f\\u001f\"}", "backspace/formfeed/unit-separator escape");
    check_eq(first(kb, "atom_codes(X, [34,92,10])", buf, sizeof buf),
             "{\"X\":\"\\\"\\\\\\n\"}", "quote/backslash/newline still escape");

    /* --- L-06: numbers cross the ABI losslessly --------------------------- */
    printf("L-06 number mapping\n");
    check_eq(first(kb, "X = 9007199254740991", buf, sizeof buf),
             "{\"X\":9007199254740991}", "2^53-1 is still a JSON number");
    check_eq(first(kb, "X = 1267650600228229401496703205376", buf, sizeof buf),
             "{\"X\":{\"bigint\":\"1267650600228229401496703205376\"}}",
             "a big integer is lossless, not a rounded double");
    check_eq(first(kb, "X is -(9007199254740993)", buf, sizeof buf),
             "{\"X\":{\"bigint\":\"-9007199254740993\"}}",
             "a big NEGATIVE integer too");
    check_eq(first(kb, "X = 3.5", buf, sizeof buf), "{\"X\":3.5}", "an ordinary float is a JSON number");

    /* --- L-14: the cons functor a host sees is insimul's, not the engine's - */
    printf("L-14 partial list\n");
    check_eq(first(kb, "X = [a|Y]", buf, sizeof buf),
             "{\"X\":{\"functor\":\".\",\"args\":[\"a\",null]},\"Y\":null}",
             "a partial list reports the functor \".\"");

    /* --- L-15: the bridge namespace is a boundary, not a convention ------- */
    printf("L-15 reserved names\n");
    check_eq(raises(kb, "'$snap_wipe'"), "permission_error",
             "calling a bootstrap predicate is refused");
    check_eq(raises(kb, "'$ij_str'(user_output, hi)"), "permission_error",
             "the stdout-writing helper is refused (it used to print)");
    check_eq(raises(kb, "atom_length(a, _X), '$snap_wipe'"), "permission_error",
             "a reserved name nested inside a goal is refused");
    CHECK(insimul_kb_assert(kb, "'$insimul_query'(a, b)") == -1,
          "asserting over a bootstrap predicate is refused");
    check_eq(insimul_last_error_class(kb), "permission_error", "…with permission_error");
    CHECK(insimul_kb_retract(kb, "'$snap_preds'(_)") == -1, "retracting one is refused");
    CHECK(insimul_kb_consult(kb, "'$sneaky'(1).\n") == -1, "consulting one is refused");
    CHECK(insimul_kb_consult(kb, ":- '$snap_wipe'.\n") == -1, "a directive calling one is refused");
    /* The wipe must never have run: the KB still holds its clauses. */
    CHECK(first(kb, "still_here(1)", buf, sizeof buf) != NULL && buf[0] == '{',
          "the KB survived every refused attempt");

    /* --- L-12: a directive that raises or fails FAILS THE LOAD ------------ */
    printf("L-12 directive policy\n");
    CHECK(insimul_kb_consult(kb, ":- no_such_directive.\nafter_bad_directive(1).\n") == -1,
          "a raising directive fails the consult");
    check_eq(insimul_last_error_class(kb), "existence_error", "…with the directive's own class");
    CHECK(first(kb, "catch(after_bad_directive(_), _, fail)", buf, sizeof buf) != NULL
          && strcmp(buf, "") == 0,
          "…and nothing from that source was loaded");
    CHECK(insimul_kb_consult(kb, ":- fail.\nafter_failed_directive(1).\n") == -1,
          "a merely FAILING directive fails the consult too");
    CHECK(insimul_kb_consult(kb, ":- true.\nafter_good_directive(1).\n") == 0,
          "a succeeding directive still loads normally");

    /* --- the ENGINE rows: gated so a swap fails LOUDLY --------------------
     *
     * These assert behaviour that is NOT promised by insimul.h — the header
     * lists each of them under "NOT PROMISED". They are here for the opposite
     * reason to everything above: not to pin a contract, but so that swapping
     * the engine turns them RED instead of silently changing answers. If you
     * are reading this because one failed, that is the gate working: check the
     * header's NOT PROMISED list, decide whether the new behaviour is
     * acceptable, and update both together.
     *
     * The corpus cannot carry these — conformance/prolog is a vendored mirror
     * of @insimul/core's, and a case added here would fork it. */
    printf("ENGINE rows (not promised; gated so a swap is loud)\n");

    /* L-07: is the standard order of terms TYPE-first, or ISO 7.2.1's by-value?
     * This is the one that silently reorders answers — sort/2, msort/2, setof/3
     * and @</2 over mixed numerics all inherit it. */
    if (INSIMUL_ENGINE_TYPE_FIRST_ORDER) {
        check_eq(first(kb, "compare(O, 1.0, 0)", buf, sizeof buf), "{\"O\":\"<\"}",
                 "compare(O, 1.0, 0) is `<` (type-first ordering, contra ISO 7.2.1)");
        check_eq(first(kb, "msort([1, 2.0, a], L)", buf, sizeof buf),
                 "{\"L\":[2.0,1,\"a\"]}",
                 "msort puts every float before every integer");
    } else {
        check_eq(first(kb, "compare(O, 1.0, 0)", buf, sizeof buf), "{\"O\":\">\"}",
                 "compare(O, 1.0, 0) is `>` (by-value ordering, ISO 7.2.1)");
        check_eq(first(kb, "msort([1, 2.0, a], L)", buf, sizeof buf),
                 "{\"L\":[1,2.0,\"a\"]}",
                 "msort orders mixed numerics by value");
    }

    /* L-05: integers are unbounded here. A bounded engine raises on the same
     * goal instead of answering — which changes which programs RUN. */
    check_eq(first(kb, "current_prolog_flag(bounded, F)", buf, sizeof buf),
             "{\"F\":\"false\"}", "integers are unbounded");

    /* L-11: is an arithmetic functor name ALSO a static predicate? Where it is,
     * a KB cannot use log/1 as a dynamic predicate. ISO reserves those names
     * only as evaluable functors; this is the corpus's one documented AMENDMENT
     * (tests/conformance.c AMENDMENTS), which an engine that allows it does not
     * need. */
    if (INSIMUL_ENGINE_ARITH_NAMES_ARE_STATIC) {
        check_eq(raises(kb, "asserta(log(0))"), "permission_error",
                 "asserta over the arithmetic functor name log/1 is refused");
    } else {
        CHECK(insimul_kb_assert(kb, "log(0)") == 0,
              "asserta over the arithmetic functor name log/1 is allowed");
        (void)insimul_kb_retract(kb, "log(0)");
    }

    /* --- L-02: the version stamp's schema names no vendor ----------------- */
    printf("L-02 version schema\n");
    printf("       stamp: %s\n", insimul_version());
    CHECK(mentions(insimul_version(), "engine "), "the stamp has an `engine` field");
    CHECK(!mentions(insimul_version(), ", trealla "),
          "the vendor is a value, not a field name");

    insimul_kb_destroy(kb);

    if (failures == 0) { printf("neutrality: PASS\n"); return 0; }
    printf("neutrality: FAIL (%d)\n", failures);
    return 1;
}
