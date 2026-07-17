/*
 * version.c — US-LI5 version-stamp test.
 *
 * A pure consumer of include/insimul.h (never includes trealla.h). Proves
 * insimul_version():
 *   - returns a non-NULL, non-empty static string,
 *   - carries the semver CMake read from the VERSION file (EXPECT_SEMVER), and
 *   - is well-formed: it names insimul, a git sha, and the pinned Trealla engine.
 * This is the same stamp scripts/package.sh writes into a package's VERSION file,
 * so keeping it green keeps the ABI and the packaging in agreement.
 */

#include <stdio.h>
#include <string.h>
#include "insimul.h"

#ifndef EXPECT_SEMVER
#define EXPECT_SEMVER "0.1.0"
#endif

static int has(const char *hay, const char *needle) {
    return strstr(hay, needle) != NULL;
}

int main(void) {
    const char *v = insimul_version();

    if (!v || !*v) {
        fprintf(stderr, "version: insimul_version() returned NULL/empty\n");
        return 1;
    }
    printf("version: insimul_version() = \"%s\"\n", v);

    int ok = 1;
    if (!has(v, "insimul "))   { fprintf(stderr, "version: missing product name\n"); ok = 0; }
    if (!has(v, EXPECT_SEMVER)) { fprintf(stderr, "version: missing semver %s\n", EXPECT_SEMVER); ok = 0; }
    if (!has(v, "git "))       { fprintf(stderr, "version: missing git sha field\n"); ok = 0; }
    if (!has(v, "trealla "))   { fprintf(stderr, "version: missing trealla pin\n"); ok = 0; }
    /* The git sha must be resolved, not the "unknown" fallback, in a checkout. */
    if (has(v, "git unknown")) {
        fprintf(stderr, "version: WARNING git sha unresolved (unknown)\n");
        /* Not a hard failure: a tarball build legitimately has no sha. */
    }

    if (ok) {
        printf("version: PASS\n");
        return 0;
    }
    fprintf(stderr, "version: FAIL\n");
    return 1;
}
