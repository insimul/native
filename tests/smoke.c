/*
 * smoke.c — US-LI1 smoke test.
 *
 * Proves the vendored engine is a REAL Prolog: consult a tiny KB with a rule,
 * then run a query that only succeeds via unification + backtracking through
 * that rule (grandparent/2). A substring fact-store — the fake engines these
 * plugins ship today — cannot answer this. We also assert a query that must
 * FAIL, so a always-true stub can't pass the test.
 *
 * The insimul C ABI arrives in US-LI2; this test drives Trealla's C API
 * (trealla.h) directly. Note: pl_query()'s bool means "ran without a hard
 * error", NOT goal success — solution truth is read from get_status(pl).
 */

#include <stdio.h>
#include <string.h>
#include "trealla.h"

static int goal_succeeds(prolog *pl, const char *goal) {
  pl_sub_query *q = NULL;
  if (!pl_query(pl, goal, &q, 0)) {
    pl_done(q);
    return -1; /* hard error running the goal */
  }
  int status = get_status(pl) ? 1 : 0;
  pl_done(q);
  return status;
}

int main(void) {
  prolog *pl = pl_create();
  if (!pl) {
    fprintf(stderr, "smoke: pl_create() failed\n");
    return 2;
  }

  static const char *kb =
      "parent(tom, bob).\n"
      "parent(bob, ann).\n"
      "grandparent(X, Z) :- parent(X, Y), parent(Y, Z).\n";

  FILE *fp = fmemopen((void *)kb, strlen(kb), "r");
  if (!fp || !pl_consult_fp(pl, fp, "smoke_kb")) {
    fprintf(stderr, "smoke: consult failed\n");
    return 3;
  }
  fclose(fp);

  int t = goal_succeeds(pl, "grandparent(tom, ann)"); /* must succeed */
  int f = goal_succeeds(pl, "grandparent(tom, tom)"); /* must fail    */
  pl_destroy(pl);

  printf("smoke: grandparent(tom,ann)=%d (want 1)  grandparent(tom,tom)=%d (want 0)\n",
         t, f);

  if (t == 1 && f == 0) {
    printf("smoke: PASS — real unification/backtracking through a rule\n");
    return 0;
  }
  fprintf(stderr, "smoke: FAIL\n");
  return 1;
}
