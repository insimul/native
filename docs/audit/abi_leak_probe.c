/*
 * abi_leak_probe.c — the evidence behind docs/ABI_ENGINE_LEAK_AUDIT.md.
 *
 * This is NOT a gate. It is a *witness*: it drives include/insimul.h exactly as
 * a consumer does (it includes only that header) and prints the raw strings the
 * ABI hands back, so every "the engine leaks here" claim in the audit is a line
 * of recorded output rather than an assertion. Re-run it after a Trealla bump to
 * see which leaks moved; the audit records the output of the pinned engine.
 *
 * Build and run (from the repo root, after `cmake -B build && cmake --build build`):
 *
 *   cc -I include -o /tmp/abi_leak_probe docs/audit/abi_leak_probe.c \
 *      build/libinsimul.a -lm
 *   /tmp/abi_leak_probe
 *
 * The teardown-cycle probe is behind an argument because it does not return —
 * it spins forever, which is the finding (L-01):
 *
 *   /tmp/abi_leak_probe cycle       # expect: no "SURVIVED", burns CPU
 */

#include "insimul.h"

#include <stdio.h>
#include <string.h>

static insimul_kb *KB;

/* Run a goal and print every solution's raw binding-set JSON, or the raw error. */
static void q(const char *label, const char *goal)
{
    printf("%-30s | ", label);
    insimul_query *qq = insimul_query_start(KB, goal);
    if (!qq) { printf("<START-FAIL> err=%s\n", insimul_last_error(KB)); return; }
    const char *s;
    int n = 0;
    while ((s = insimul_query_next(qq)) != NULL) {
        if (n++) printf(" ; ");
        printf("%s", s);
        if (n > 6) { printf(" ..."); break; }
    }
    if (!n) printf("<no solutions>");
    printf("\n");
    insimul_query_stop(qq);
}

/* L-01: create -> destroy(the last KB) -> create -> destroy. Never returns. */
static int cycle_probe(void)
{
    printf("cycle 1 create\n");                       fflush(stdout);
    insimul_kb *a = insimul_kb_create();
    printf("cycle 1 destroy (last KB -> global teardown)\n"); fflush(stdout);
    insimul_kb_destroy(a);
    printf("cycle 2 create\n");                       fflush(stdout);
    insimul_kb *b = insimul_kb_create();
    printf("cycle 2 destroy\n");                      fflush(stdout);
    insimul_kb_destroy(b);
    printf("SURVIVED both cycles\n");
    return 0;
}

int main(int argc, char **argv)
{
    if (argc > 1 && !strcmp(argv[1], "cycle")) return cycle_probe();

    printf("== L-02 insimul_version ==\n%s\n\n", insimul_version());

    KB = insimul_kb_create();
    if (!KB) { printf("insimul_kb_create failed\n"); return 1; }

    printf("== L-03/L-04/L-05 engine flags visible through the ABI ==\n");
    q("double_quotes", "current_prolog_flag(double_quotes, F)");
    q("unknown", "current_prolog_flag(unknown, F)");
    q("bounded", "current_prolog_flag(bounded, F)");
    q("occurs_check", "current_prolog_flag(occurs_check, F)");
    q("double-quoted literal", "X = \"abc\"");

    printf("\n== L-06 number marshalling ==\n");
    q("integral float", "X is 1.0");
    q("int/int exact", "X is 8/2");
    q("int/int inexact", "X is 7/2");
    q("unbounded integer", "X is 12345678901234567890 * 987654321");
    q("power overflows to float", "X is 2**200");
    q("negative zero", "X is -0.0");
    q("float overflow", "X is 1.0e308 * 10");

    printf("\n== L-07 standard order of terms ==\n");
    q("sort mixed types", "sort([b, 1, f(x), 2.0, a], L)");
    q("compare(O, 1.0, 0)", "compare(O, 1.0, 0)");
    q("compare(O, 2, 1.5)", "compare(O, 2, 1.5)");

    printf("\n== L-08..L-12 error terms (raw insimul_last_error text) ==\n");
    q("undefined procedure", "no_such_pred(_)");
    q("type error", "X is foo + 1");
    q("syntax error in a goal", "foo(bar");
    printf("%-30s | ", "asserta over a builtin name");
    printf("rc=%d err=%s\n", insimul_kb_assert(KB, "log(1)"), insimul_last_error(KB));
    q("asserta(log(0))", "catch(asserta(log(0)), E, (E = error(F, _), X = F))");
    printf("%-30s | ", "consult syntax error");
    printf("rc=%d err=%s\n", insimul_kb_consult(KB, "ok(1).\nbroken(2.\n"), insimul_last_error(KB));
    printf("%-30s | ", "consult unknown directive");
    printf("rc=%d err=%s\n", insimul_kb_consult(KB, ":- no_such_directive.\nfine(1).\n"),
           insimul_last_error(KB));

    printf("\n== L-13/L-14 JSON well-formedness (control chars, cons functor, sharing) ==\n");
    q("atom holding U+000B", "atom_codes(X, [97,11,98])");
    q("atom holding U+0000", "catch(atom_codes(X, [97,0,98]), _, X = raised)");
    q("partial list [a|Y]", "X = [a|Y]");
    q("aliased variables", "X = Y");

    printf("\n== L-15 the bridge's own predicates are in the KB namespace ==\n");
    q("boot pred is visible", "(current_predicate('$insimul_query'/2) -> X = yes ; X = no)");
    q("boot pred is callable", "catch('$ij_str'(user_output, hi), E, X = E)");

    printf("\n== L-18 module-qualified goals resolve ==\n");
    q("lists:append/3", "catch(lists:append([a],[b],X), E, X = E)");

    printf("\n== L-16 snapshot image rendering (this text reaches save files) ==\n");
    insimul_kb_consult(KB,
        "neg(-1).\n"
        "big(1267650600228229401496703205376).\n"
        "fl(1.0).\n"
        "sci(1.0e10).\n"
        "curly({a,b}).\n"
        "opterm(1+2*3).\n"
        "quoted('hello world').\n"
        "emptyatom('').\n"
        "dq(\"dq\").\n"
        "listy([a|B]).\n"
        "esc('a\\nb').\n"
        "rule(X) :- neg(X), \\+ fl(X).\n");
    const char *img = insimul_kb_snapshot(KB);
    printf("--- image ---\n%s--- end ---\n", img ? img : "(NULL)");

    insimul_kb_destroy(KB);
    return 0;
}
