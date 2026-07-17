/*
 * abi.c — ctest for the insimul C ABI (US-LI2).
 *
 * This test includes ONLY <insimul.h> (never trealla.h): it exercises the ABI
 * exactly as the C#/C++/GDScript engine wrappers will, which also proves the
 * opaque boundary — no Trealla type is reachable from a consumer.
 *
 * Covers: create/destroy, consult (incl. custom operators + syntax error),
 * assert/retract (incl. no-match), the query iterator start/next/stop over
 * zero/one/many solutions and every JSON value kind, ground success ("{}"),
 * and error reporting via insimul_last_error.
 */

#include "insimul.h"
#include <stdio.h>
#include <string.h>

static int failures = 0;

#define CHECK(cond, msg) do { \
    if (cond) { printf("  ok   %s\n", msg); } \
    else { printf("  FAIL %s\n", msg); failures++; } \
} while (0)

/* Collect all solutions of a query into `out` (up to `max`), return the count,
 * or -1 if the query failed to start. */
static int collect(insimul_kb *kb, const char *goal, char out[][256], int max)
{
    insimul_query *q = insimul_query_start(kb, goal);
    if (!q) return -1;
    int n = 0;
    const char *s;
    while ((s = insimul_query_next(q)) != NULL && n < max) {
        snprintf(out[n], 256, "%s", s);
        n++;
    }
    insimul_query_stop(q);
    return n;
}

int main(void)
{
    char sols[16][256];

    insimul_kb *kb = insimul_kb_create();
    CHECK(kb != NULL, "insimul_kb_create");
    if (!kb) return 1;

    /* --- consult ---------------------------------------------------------- */
    int rc = insimul_kb_consult(kb,
        "parent(tom, bob).\n"
        "parent(bob, ann).\n"
        "grandparent(X, Z) :- parent(X, Y), parent(Y, Z).\n");
    CHECK(rc == 0, "consult a valid program");
    CHECK(insimul_last_error(kb) == NULL, "no error after good consult");

    /* Custom operator defined by a directive must affect later clauses. */
    rc = insimul_kb_consult(kb,
        ":- op(700, xfx, ===).\n"
        "same(X === X).\n");
    CHECK(rc == 0, "consult with :- op/3 directive");
    CHECK(collect(kb, "same(a === a)", sols, 16) == 1, "custom operator query succeeds");

    /* Syntax error: reported, and nothing from that source is loaded. */
    rc = insimul_kb_consult(kb, "ok_before(1).\nbroken(2.\n");
    CHECK(rc == -1, "consult syntax error returns -1");
    CHECK(insimul_last_error(kb) != NULL, "syntax error sets last_error");
    /* ok_before/1 is now undefined (rolled back); the catch makes an undefined
     * predicate fail instead of raising, so zero solutions proves the rollback. */
    CHECK(collect(kb, "catch(ok_before(_), _, fail)", sols, 16) == 0,
          "failed consult loads nothing (rollback)");

    /* --- query: one / many / zero / ground -------------------------------- */
    int n = collect(kb, "grandparent(tom, X)", sols, 16);
    CHECK(n == 1, "one-solution query");
    CHECK(n == 1 && strcmp(sols[0], "{\"X\":\"ann\"}") == 0, "binding set {\"X\":\"ann\"}");

    n = collect(kb, "parent(P, C)", sols, 16);
    CHECK(n == 2, "multi-solution query yields 2");
    CHECK(n == 2 && strcmp(sols[0], "{\"P\":\"tom\",\"C\":\"bob\"}") == 0
                 && strcmp(sols[1], "{\"P\":\"bob\",\"C\":\"ann\"}") == 0,
          "both solutions in order");

    n = collect(kb, "grandparent(tom, ann)", sols, 16);
    CHECK(n == 1 && strcmp(sols[0], "{}") == 0, "ground success yields {}");

    n = collect(kb, "grandparent(tom, tom)", sols, 16);
    CHECK(n == 0, "failing goal yields zero solutions");
    CHECK(insimul_last_error(kb) == NULL, "a plain failure is not an error");

    /* --- assert / value mapping ------------------------------------------- */
    rc = insimul_kb_assert(kb, "likes(alice, [wine, chess(fast), 3, 4.5])");
    CHECK(rc == 0, "assert a dynamic fact");
    n = collect(kb, "likes(Who, What)", sols, 16);
    CHECK(n == 1 && strcmp(sols[0],
            "{\"Who\":\"alice\",\"What\":[\"wine\",{\"functor\":\"chess\",\"args\":[\"fast\"]},3,4.5]}") == 0,
          "atoms/lists/compounds/ints/floats map correctly");

    /* --- retract ---------------------------------------------------------- */
    rc = insimul_kb_retract(kb, "likes(alice, _)");
    CHECK(rc == 0, "retract an existing clause");
    CHECK(collect(kb, "likes(_, _)", sols, 16) == 0, "clause is gone after retract");
    rc = insimul_kb_retract(kb, "likes(nobody, nothing)");
    CHECK(rc == 1, "retract with no match returns 1");
    CHECK(insimul_last_error(kb) == NULL, "no-match retract is not an error");

    /* --- query error path ------------------------------------------------- */
    insimul_query *q = insimul_query_start(kb, "foo(bar");   /* unbalanced */
    CHECK(q == NULL, "syntax-error goal returns NULL query");
    CHECK(insimul_last_error(kb) != NULL, "syntax-error goal sets last_error");

    q = insimul_query_start(kb, "X is foo + 1");             /* type error */
    CHECK(q == NULL, "type-error goal returns NULL query");
    CHECK(insimul_last_error(kb) != NULL, "type-error goal sets last_error");

    /* A good call clears the error again. */
    n = collect(kb, "parent(tom, bob)", sols, 16);
    CHECK(n == 1 && insimul_last_error(kb) == NULL, "success clears last_error");

    insimul_kb_destroy(kb);
    insimul_query_stop(NULL);   /* NULL-safe */
    insimul_kb_destroy(NULL);   /* NULL-safe */

    if (failures == 0) { printf("abi: PASS\n"); return 0; }
    printf("abi: FAIL (%d)\n", failures);
    return 1;
}
