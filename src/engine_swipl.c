/*
 * engine_swipl.c — the SWI-Prolog implementation of the internal engine port
 * (src/insimul_engine.h), built for the D20 spike (tasklist 250). This is the
 * ONLY translation unit that includes SWI-Prolog.h; src/insimul.c does not name
 * an engine at all.
 *
 * Selected by `-DINSIMUL_ENGINE=swipl`. Its counterpart is
 * src/engine_trealla.c. Read docs/SWIPL_SPIKE.md, section "Named gaps", alongside this
 * file: SWI's embedding model differs from Trealla's in ways this port has to
 * paper over, and each place it does is a recorded gap, not a silent fix.
 *
 * THE TWO STRUCTURAL DIFFERENCES, and what this file does about them:
 *
 *  1. SWI has ONE Prolog database per process. Trealla's pl_create() gives an
 *     independent engine per call; SWI's PL_initialise() may be called once and
 *     there is no "second database". So an insimul_kb here is a MODULE, not an
 *     instance: each KB gets a fresh module `insimul_kb_<n>`, the bootstrap is
 *     loaded into it, and every dispatch goal is called with that module as the
 *     context module — which is what makes assertz/retract/current_predicate in
 *     insimul_boot.pl land in the right KB without the bootstrap knowing. This
 *     is isolation by naming, not by construction (gap G-01).
 *
 *  2. SWI needs its home tree on disk. Trealla embeds its whole Prolog library
 *     in the binary (EMBED=1); SWI resolves boot.prc plus its compiled library at
 *     runtime from $SWI_HOME_DIR. libinsimul therefore stops being a single
 *     redistributable file (gap G-02). The path is baked in at build time as
 *     INSIMUL_SWIPL_HOME and can be overridden at run time with SWI_HOME_DIR.
 */

#include "insimul_engine.h"

#include <SWI-Prolog.h>

#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <pthread.h>
#include <unistd.h>

/* The bootstrap Prolog, embedded by cmake/gen_boot.cmake. */
extern const unsigned char insimul_boot_pl[];
extern const unsigned long insimul_boot_pl_len;

#ifndef INSIMUL_SWIPL_HOME
#define INSIMUL_SWIPL_HOME ""
#endif

struct insimul_engine {
    module_t mod;         /* this KB's module (see gap G-01) */
    atom_t   mod_name;
};

static int call_in_module(module_t mod, const char *goal);

/* ------------------------------------------------------- process-wide init */

static int g_init_ok = 0;
static pthread_once_t g_init_once = PTHREAD_ONCE_INIT;

/*
 * PL_initialise once. -q and --no-signals are the embedding profile: no banner,
 * no informational messages on the process's stderr (the ABI's error channel is
 * the per-KB result file), and no stealing of the host's signal handlers — a
 * game engine installs its own. --no-tty keeps SWI from probing a terminal it
 * does not have, and `-g true -t halt` means "no toplevel".
 */
static void init_once(void)
{
    const char *home = getenv("SWI_HOME_DIR");
    if (!home || !*home) home = INSIMUL_SWIPL_HOME;

    static char home_arg[4096];
    snprintf(home_arg, sizeof home_arg, "--home=%s", home);

    static char a0[] = "libinsimul";
    static char a_q[] = "-q";
    static char a_nosig[] = "--no-signals";
    static char a_notty[] = "--no-tty";
    static char a_g[] = "-g";
    static char a_true[] = "true";
    static char a_t[] = "-t";
    static char a_halt[] = "halt";
    char *argv[] = { a0, home_arg, a_q, a_nosig, a_notty, a_g, a_true,
                     a_t, a_halt, NULL };
    int argc = (int)(sizeof argv / sizeof argv[0]) - 1;

    g_init_ok = PL_initialise(argc, argv) ? 1 : 0;
    if (!g_init_ok) return;

    /*
     * Pin the ABI's flags PROCESS-WIDE, not just in each KB's module (gap G-04).
     *
     * insimul_boot.pl sets double_quotes/unknown at load, and on Trealla that is
     * the whole story. On SWI those two are MODULE-SENSITIVE flags, and the
     * predicate that turns a host's goal text into a term (read_term_from_atom/3)
     * runs in the system module, not in the KB's — so a per-module pin does not
     * reach the reader, and "abc" came back as a string instead of the char list
     * insimul.h promises. Pinning globally here does reach it. It is only sound
     * because SWI has one database per process anyway (gap G-01): there is no
     * second KB with a different opinion to trample.
     */
    module_t user = PL_new_module(PL_new_atom("user"));
    (void)call_in_module(user, "set_prolog_flag(double_quotes, chars)");
    (void)call_in_module(user, "set_prolog_flag(unknown, error)");
}

/* ------------------------------------------------------------- goal running */

/*
 * Call `goal` (text, no trailing full stop) in module `mod`. Returns 1 if the
 * goal succeeded. Exceptions are cleared rather than reported: every goal this
 * port runs is a bootstrap helper that catches its own, so an exception here is
 * an internal invariant break and the caller only needs "did it run".
 */
static int call_in_module(module_t mod, const char *goal)
{
    fid_t fid = PL_open_foreign_frame();
    if (!fid) return 0;

    size_t n = strlen(goal) + 4;
    char *text = malloc(n);
    if (!text) { PL_discard_foreign_frame(fid); return 0; }
    snprintf(text, n, "%s .", goal);   /* PL_chars_to_term wants a full stop */

    term_t t = PL_new_term_ref();
    int ok = PL_chars_to_term(text, t) && PL_call(t, mod);
    free(text);

    /* PL_call leaves a pending exception on a rethrow; drop it (see above). */
    { term_t ex = PL_exception(0); if (ex) PL_clear_exception(); }

    PL_discard_foreign_frame(fid);
    return ok;
}

/* --------------------------------------------------------------- temp files */

static int make_temp(char *out, size_t n)
{
    const char *dir = getenv("TMPDIR");
    if (!dir || !*dir) dir = "/tmp";
    if (snprintf(out, n, "%s/insimul_boot_XXXXXX", dir) >= (int)n) return -1;
    int fd = mkstemp(out);
    if (fd < 0) return -1;
    close(fd);
    return 0;
}

/*
 * Write the embedded bootstrap to a FRESH file per KB. SWI keeps a source-file
 * registry: loading one path a second time is a RELOAD, which would retract the
 * clauses the previous KB's module got from it. A distinct path per KB is the
 * cheapest way to make each load a first load. (Trealla has no such registry —
 * it consults a FILE* straight into the instance.)
 */
static int write_boot(char *path, size_t n)
{
    if (make_temp(path, n) != 0) return 0;
    FILE *fp = fopen(path, "wb");
    if (!fp) return 0;
    size_t wrote = fwrite(insimul_boot_pl, 1, (size_t)insimul_boot_pl_len, fp);
    fclose(fp);
    return wrote == (size_t)insimul_boot_pl_len;
}

/* ------------------------------------------------------------- open / close */

static pthread_mutex_t g_counter_lock = PTHREAD_MUTEX_INITIALIZER;
static unsigned long   g_counter = 0;

insimul_engine *insimul_engine_open(void)
{
    pthread_once(&g_init_once, init_once);
    if (!g_init_ok) return NULL;

    insimul_engine *e = calloc(1, sizeof *e);
    if (!e) return NULL;

    pthread_mutex_lock(&g_counter_lock);
    unsigned long id = ++g_counter;
    pthread_mutex_unlock(&g_counter_lock);

    char modname[64];
    snprintf(modname, sizeof modname, "insimul_kb_%lu", id);
    e->mod_name = PL_new_atom(modname);
    e->mod = PL_new_module(e->mod_name);
    if (!e->mod) { free(e); return NULL; }

    char boot[1024];
    if (!write_boot(boot, sizeof boot)) { free(e); return NULL; }

    /* silent(true): loading must not write to the process's stderr. */
    size_t gn = strlen(boot) * 2 + 128;
    char *goal = malloc(gn);
    int ok = 0;
    if (goal) {
        snprintf(goal, gn, "load_files('%s', [silent(true), must_be_module(false)])", boot);
        ok = call_in_module(e->mod, goal);
        free(goal);
    }
    remove(boot);

    if (!ok) { free(e); return NULL; }
    return e;
}

/*
 * Close a KB. SWI publishes no way to destroy a module, so this abolishes every
 * predicate the module owns and leaves the (now empty) module record behind —
 * a small, permanent, per-KB leak of module records and atoms (gap G-03).
 * Trealla's pl_destroy() frees the whole instance.
 */
void insimul_engine_close(insimul_engine *e)
{
    if (!e) return;
    char goal[512];
    const char *mod = PL_atom_chars(e->mod_name);
    snprintf(goal, sizeof goal,
             "forall((current_predicate(%s:N/A), functor(H,N,A),"
             " \\+ predicate_property(%s:H, imported_from(_)),"
             " \\+ predicate_property(%s:H, foreign)),"
             " catch(abolish(%s:N/A), _, true))",
             mod, mod, mod, mod);
    call_in_module(e->mod, goal);
    free(e);
}

int insimul_engine_run(insimul_engine *e, const char *goal)
{
    if (!e) return -1;
    return call_in_module(e->mod, goal) ? 0 : -1;
}
