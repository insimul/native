/*
 * engine_trealla.c — the Trealla implementation of the internal engine port
 * (src/insimul_engine.h). This is the ONLY translation unit in the library that
 * includes trealla.h; src/insimul.c does not name an engine at all.
 *
 * Selected by `-DINSIMUL_ENGINE=trealla` (the default). Its counterpart is
 * src/engine_swipl.c.
 */

#include "insimul_engine.h"

#include "trealla.h"

#include <stdio.h>
#include <stdlib.h>

#ifdef _WIN32
#include <windows.h>
#else
#include <pthread.h>
#endif

/* The bootstrap Prolog, embedded by cmake/gen_boot.cmake. */
extern const unsigned char insimul_boot_pl[];
extern const unsigned long insimul_boot_pl_len;

/*
 * Two globals Trealla normally defines in its CLI main (tpl.c), which we do not
 * compile into a library. Without them, linking against the embedded Trealla
 * objects fails: g_envp is read by process_create/3 (bif_os.c); g_sigfn is the
 * toplevel's SIGINT handler. A library has no interactive toplevel and its
 * consumers never spawn processes, so an empty env and a no-op handler suffice.
 */
static char *insimul_empty_env[] = { NULL };
char **g_envp = insimul_empty_env;
void g_sigfn(int s) { (void)s; }

struct insimul_engine {
    prolog *pl;
};

/* Consult the embedded bootstrap into `pl`. Returns 1 on success. */
static int consult_boot(prolog *pl)
{
    FILE *fp = fmemopen((void *)insimul_boot_pl, (size_t)insimul_boot_pl_len, "r");
    if (!fp) return 0;
    int ok = pl_consult_fp(pl, fp, "insimul_boot") ? 1 : 0;
    fclose(fp);
    return ok;
}

/*
 * The engine keepalive (leak L-01).
 *
 * Trealla keeps PROCESS-GLOBAL state (its symbol table) and tears it down when
 * the last engine instance is destroyed; bringing it back up and tearing it down
 * a second time never returns — it spins, so it does not even show as a blocked
 * thread. That made insimul_kb_destroy's real contract "never destroy your last
 * KB", and seven places across five repositories discovered that by hand and
 * each opened a hidden KB of their own.
 *
 * It belongs here. libinsimul opens one engine instance the first time a KB is
 * created and never closes it, so the global refcount never returns to zero and
 * insimul_kb_destroy means exactly what insimul.h says it means. It costs one
 * empty engine instance per process, is created once (thread-safe), and is
 * deliberately leaked: there is no ABI call after which it would be safe to free.
 *
 * A host that never creates a KB never pays for it.
 */
static prolog *g_keepalive = NULL;

static void keepalive_init(void)
{
    g_keepalive = pl_create();
    if (!g_keepalive) return;
    set_quiet(g_keepalive);
    /* Bootstrapped exactly like a real KB: the first instance to load a program
     * initializes engine state the later ones then share, so a bare pl_create()
     * here is not equivalent (it leaves the process crashing on the third KB). */
    consult_boot(g_keepalive);
}

#ifdef _WIN32
static INIT_ONCE g_keepalive_once = INIT_ONCE_STATIC_INIT;
static BOOL CALLBACK keepalive_once_cb(PINIT_ONCE o, PVOID p, PVOID *c)
{
    (void)o; (void)p; (void)c;
    keepalive_init();
    return TRUE;
}
static void ensure_keepalive(void)
{
    InitOnceExecuteOnce(&g_keepalive_once, keepalive_once_cb, NULL, NULL);
}
#else
static pthread_once_t g_keepalive_once = PTHREAD_ONCE_INIT;
static void ensure_keepalive(void)
{
    pthread_once(&g_keepalive_once, keepalive_init);
}
#endif

insimul_engine *insimul_engine_open(void)
{
    insimul_engine *e = calloc(1, sizeof *e);
    if (!e) return NULL;

    ensure_keepalive();   /* before the first pl_create, and only once */

    e->pl = pl_create();
    if (!e->pl) { free(e); return NULL; }
    set_quiet(e->pl);   /* no interactive toplevel banners */

    if (!consult_boot(e->pl)) {
        pl_destroy(e->pl);
        free(e);
        return NULL;
    }
    return e;
}

void insimul_engine_close(insimul_engine *e)
{
    if (!e) return;
    pl_destroy(e->pl);
    free(e);
}

int insimul_engine_run(insimul_engine *e, const char *goal)
{
    if (!e) return -1;
    pl_sub_query *q = NULL;
    int ok = pl_query(e->pl, goal, &q, 0);
    /* Drive backtracking to exhaustion; pl_redo frees the sub-query when done. */
    if (q) while (pl_redo(q)) { }
    return ok ? 0 : -1;
}
