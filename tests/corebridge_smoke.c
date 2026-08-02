/*
 * corebridge_smoke.c — libinsimulcore's build-and-boot test (tasklist 104, US-1).
 *
 * A pure consumer of corebridge/include/insimulcore.h: it includes neither
 * quickjs.h nor insimul.h, which is what proves the promoted bridge's ABI is as
 * opaque here as it was in the Godot plugin. Three things it asserts, all of
 * which fail loudly rather than degrading:
 *
 *   1. the runtime CREATES — QuickJS instantiates and the vendored
 *      `@insimul/core` bundle evaluates without throwing;
 *   2. the ADOPTED SURFACE is present — `core.methods` enumerates the method
 *      table, and `radiant.generate` is in it. A bundle that lost the adopted
 *      method must fail here, not silently return nothing to a caller;
 *   3. the VERSION STAMP names both pins — the QuickJS version CMake read from
 *      vendor/quickjs/VERSION (EXPECT_QUICKJS) and the core commit the vendored
 *      bundle was built from (EXPECT_CORE_COMMIT, read from VENDORED.json). That
 *      is what makes shipping a stale bundle a hard error instead of a mystery
 *      in a bug report.
 *
 * The corpus-level proof — every radiant vector through core's real TypeScript —
 * is US-2's gate, not this one. This test exists so `cmake --build` failing to
 * produce a *usable* libinsimulcore cannot pass as a green build.
 */

#include <stdio.h>
#include <string.h>

#include "insimulcore.h"

#ifndef EXPECT_QUICKJS
#define EXPECT_QUICKJS ""
#endif
#ifndef EXPECT_CORE_COMMIT
#define EXPECT_CORE_COMMIT ""
#endif

static int has(const char *hay, const char *needle) {
    return needle && *needle && strstr(hay, needle) != NULL;
}

int main(void) {
    int ok = 1;

    const char *v = insimul_core_version();
    if (!v || !*v) {
        fprintf(stderr, "corebridge: insimul_core_version() returned NULL/empty\n");
        return 1;
    }
    printf("corebridge: insimul_core_version() = \"%s\"\n", v);

    /* The pins CMake read out of the vendored tree must be the ones compiled in.
     * An empty expectation means the build did not pass one, which is itself a
     * regression in corebridge/CMakeLists.txt. */
    if (!*EXPECT_QUICKJS) {
        fprintf(stderr, "corebridge: EXPECT_QUICKJS was not passed by the build\n");
        ok = 0;
    } else if (!has(v, EXPECT_QUICKJS)) {
        fprintf(stderr, "corebridge: version stamp lacks the QuickJS pin %s\n", EXPECT_QUICKJS);
        ok = 0;
    }
    if (!*EXPECT_CORE_COMMIT) {
        fprintf(stderr, "corebridge: EXPECT_CORE_COMMIT was not passed by the build\n");
        ok = 0;
    } else if (!has(v, EXPECT_CORE_COMMIT)) {
        fprintf(stderr, "corebridge: version stamp lacks the vendored core commit %s\n",
                EXPECT_CORE_COMMIT);
        ok = 0;
    }

    insimul_core *core = insimul_core_create();
    if (!core) {
        fprintf(stderr, "corebridge: insimul_core_create() failed — the bridge did not boot\n");
        return 1;
    }

    const char *methods = insimul_core_call(core, "core.methods", NULL);
    if (!methods) {
        fprintf(stderr, "corebridge: core.methods failed: %s\n", insimul_core_last_error(core));
        insimul_core_destroy(core);
        return 1;
    }
    printf("corebridge: adopted surface = %s\n", methods);
    if (!strstr(methods, "radiant.generate")) {
        fprintf(stderr, "corebridge: the bundle does not expose radiant.generate\n");
        ok = 0;
    }

    /* A failing call must REPORT, not crash or return a plausible answer. */
    if (insimul_core_call(core, "no.such.method", NULL) != NULL) {
        fprintf(stderr, "corebridge: an unknown method returned a result instead of NULL\n");
        ok = 0;
    } else if (!*insimul_core_last_error(core)) {
        fprintf(stderr, "corebridge: an unknown method failed without setting last_error\n");
        ok = 0;
    } else {
        printf("corebridge: unknown method rejected: %s\n", insimul_core_last_error(core));
    }

    insimul_core_destroy(core);

    if (ok) {
        printf("corebridge: PASS\n");
        return 0;
    }
    fprintf(stderr, "corebridge: FAIL\n");
    return 1;
}
