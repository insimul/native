/*
 * snapshot.c — ctest for KB snapshot/restore (US-LI4).
 *
 * Includes ONLY <insimul.h> (never trealla.h), like the abi/conformance tests, so
 * it exercises the opaque ABI exactly as the engine wrappers will.
 *
 * Covers:
 *   - determinism: two snapshots of the same state are byte-identical;
 *   - golden: the snapshot of a fixed KB equals the committed fixture
 *     (conformance/snapshots/basic.snapshot.pl — the same bytes the TS-parser
 *     cross-check in the `snapshot_parse` ctest parses);
 *   - round-trip: consult base + assert -> snapshot -> fresh KB + consult base +
 *     restore reproduces identical query results across a battery of queries, and
 *     re-snapshots to the identical image;
 *   - restore REPLACES state (a stray fact is wiped) and rejects a malformed image
 *     without mutating the KB (last_error set, state preserved).
 *
 * No keepalive KB is needed: libinsimul holds its own engine instance open, so
 * KBs may be created and destroyed in any order (US-2, leak L-01).
 */

#include "insimul.h"
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#ifndef INSIMUL_SNAPSHOT_FIXTURE
#define INSIMUL_SNAPSHOT_FIXTURE "conformance/snapshots/basic.snapshot.pl"
#endif

static int failures = 0;

#define CHECK(cond, msg) do { \
    if (cond) { printf("  ok   %s\n", msg); } \
    else { printf("  FAIL %s\n", msg); failures++; } \
} while (0)

/* The base program + asserted facts whose snapshot is the golden fixture. The
 * exact order matters: clause order within a predicate is preserved, and the
 * fixture pins it byte-for-byte. */
static const char *BASE_PROGRAM =
    "person(alice).\n"
    "person(bob).\n"
    "likes(alice, bob).\n"
    "knows(X, Y) :- likes(X, Y).\n"
    "knows(X, Y) :- likes(X, Z), knows(Z, Y).\n";

static const char *ASSERTED[] = {
    "age(alice, 30)",
    "inventory(bob, [sword, shield, 3])",
    "score(carol, 4.5)",
    "friend(alice, pet(dog))",
    "title(alice, 'Grand Duchess')",
};
static const int ASSERTED_N = (int)(sizeof ASSERTED / sizeof ASSERTED[0]);

/* Build the fixture KB (base + asserts, in the fixed order). */
static int build_fixture_kb(insimul_kb *kb)
{
    if (insimul_kb_consult(kb, BASE_PROGRAM) != 0) return -1;
    for (int i = 0; i < ASSERTED_N; i++)
        if (insimul_kb_assert(kb, ASSERTED[i]) != 0) return -1;
    return 0;
}

/* Read a whole file into a malloc'd NUL-terminated buffer (NULL on failure). */
static char *slurp(const char *path)
{
    FILE *fp = fopen(path, "rb");
    if (!fp) return NULL;
    fseek(fp, 0, SEEK_END);
    long sz = ftell(fp);
    if (sz < 0) { fclose(fp); return NULL; }
    rewind(fp);
    char *buf = malloc((size_t)sz + 1);
    if (!buf) { fclose(fp); return NULL; }
    size_t got = fread(buf, 1, (size_t)sz, fp);
    fclose(fp);
    buf[got] = '\0';
    return buf;
}

/* Concatenate all solutions of `goal` (in order, one per line) into `out`.
 * Returns 0 on success, -1 if the query failed to start. */
static int collect_str(insimul_kb *kb, const char *goal, char *out, size_t n)
{
    out[0] = '\0';
    insimul_query *q = insimul_query_start(kb, goal);
    if (!q) return -1;
    const char *s;
    while ((s = insimul_query_next(q)) != NULL) {
        strncat(out, s, n - strlen(out) - 1);
        strncat(out, "\n", n - strlen(out) - 1);
    }
    insimul_query_stop(q);
    return 0;
}

/* A battery of queries that must give identical results on two equal KBs. */
static const char *BATTERY[] = {
    "person(P)",
    "knows(alice, X)",       /* exercises the recursive rule */
    "age(A, N)",
    "inventory(I, L)",
    "title(T, X)",
    "score(S, V)",
    "likes(X, Y)",
};
static const int BATTERY_N = (int)(sizeof BATTERY / sizeof BATTERY[0]);

static void compare_kbs(insimul_kb *a, insimul_kb *b)
{
    for (int i = 0; i < BATTERY_N; i++) {
        char ra[4096], rb[4096];
        int oka = collect_str(a, BATTERY[i], ra, sizeof ra);
        int okb = collect_str(b, BATTERY[i], rb, sizeof rb);
        char msg[128];
        snprintf(msg, sizeof msg, "battery query identical: %s", BATTERY[i]);
        CHECK(oka == 0 && okb == 0 && strcmp(ra, rb) == 0, msg);
    }
}

int main(void)
{
    /* --- build the fixture KB and snapshot it ----------------------------- */
    insimul_kb *kb = insimul_kb_create();
    CHECK(kb != NULL, "create source KB");
    if (!kb) return 1;
    CHECK(build_fixture_kb(kb) == 0, "consult base + assert facts");

    const char *snap = insimul_kb_snapshot(kb);
    CHECK(snap != NULL, "snapshot returns an image");
    CHECK(insimul_last_error(kb) == NULL, "no error after snapshot");
    if (!snap) return 1;
    char *snap1 = strdup(snap);   /* keep it: the next snapshot call frees the KB's copy */

    /* --- determinism: a second snapshot of the same state is identical ---- */
    const char *snap_again = insimul_kb_snapshot(kb);
    CHECK(snap_again != NULL && strcmp(snap_again, snap1) == 0,
          "two snapshots of the same state are byte-identical (determinism)");

    /* --- golden: matches the committed fixture (what the TS parser parses) - */
    if (getenv("INSIMUL_SNAPSHOT_UPDATE")) {
        FILE *fp = fopen(INSIMUL_SNAPSHOT_FIXTURE, "wb");
        if (fp) { fwrite(snap1, 1, strlen(snap1), fp); fclose(fp);
                  printf("  [UPDATE] wrote %s\n", INSIMUL_SNAPSHOT_FIXTURE); }
    }
    char *fixture = slurp(INSIMUL_SNAPSHOT_FIXTURE);
    CHECK(fixture != NULL, "read committed snapshot fixture");
    CHECK(fixture != NULL && strcmp(fixture, snap1) == 0,
          "snapshot byte-identical to committed fixture (golden)");

    /* --- round-trip into a fresh KB --------------------------------------- */
    insimul_kb *kb2 = insimul_kb_create();
    CHECK(kb2 != NULL, "create destination KB");
    /* The AC flow: fresh KB + consult base + restore. Restore REPLACES state, so
     * the base consult is redundant here — proving restore is authoritative. */
    CHECK(insimul_kb_consult(kb2, BASE_PROGRAM) == 0, "dest KB consult base");
    CHECK(insimul_kb_restore(kb2, snap1) == 0, "restore snapshot into dest KB");
    CHECK(insimul_last_error(kb2) == NULL, "no error after restore");

    compare_kbs(kb, kb2);

    const char *snap3 = insimul_kb_snapshot(kb2);
    CHECK(snap3 != NULL && strcmp(snap3, snap1) == 0,
          "re-snapshot after restore is identical (round-trip stable)");

    /* --- restore REPLACES (a stray fact is wiped) ------------------------- */
    CHECK(insimul_kb_assert(kb2, "person(zoe)") == 0, "add a stray fact to dest KB");
    const char *snap_dirty = insimul_kb_snapshot(kb2);
    CHECK(snap_dirty != NULL && strcmp(snap_dirty, snap1) != 0,
          "snapshot changes once state diverges");
    CHECK(insimul_kb_restore(kb2, snap1) == 0, "restore again");
    const char *snap_clean = insimul_kb_snapshot(kb2);
    CHECK(snap_clean != NULL && strcmp(snap_clean, snap1) == 0,
          "restore replaced the diverged state (stray fact gone)");

    /* --- malformed image is rejected without mutating the KB -------------- */
    int rc = insimul_kb_restore(kb2, "person(alice).\nbroken(oops.\n");
    CHECK(rc == -1, "restore of a malformed image returns -1");
    CHECK(insimul_last_error(kb2) != NULL, "malformed restore sets last_error");
    const char *snap_after_bad = insimul_kb_snapshot(kb2);
    CHECK(snap_after_bad != NULL && strcmp(snap_after_bad, snap1) == 0,
          "KB state unchanged after a rejected restore");

    /* --- snapshot of an empty KB is the empty string ---------------------- */
    insimul_kb *empty = insimul_kb_create();
    const char *snap_empty = insimul_kb_snapshot(empty);
    CHECK(snap_empty != NULL && snap_empty[0] == '\0',
          "snapshot of an empty KB is the empty string");
    insimul_kb_destroy(empty);

    free(snap1);
    free(fixture);
    insimul_kb_destroy(kb2);
    insimul_kb_destroy(kb);

    /* NULL-safety of the new entry points. */
    CHECK(insimul_kb_snapshot(NULL) == NULL, "snapshot(NULL) is NULL-safe");
    CHECK(insimul_kb_restore(NULL, "x") == -1, "restore(NULL,...) is NULL-safe");

    if (failures == 0) { printf("snapshot: PASS\n"); return 0; }
    printf("snapshot: FAIL (%d)\n", failures);
    return 1;
}
