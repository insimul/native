/*
 * insimul_engine.h — the INTERNAL engine port.
 *
 * NOT a public header: it is never installed and never included by
 * include/insimul.h. It exists so `src/insimul.c` — which holds every ABI-level
 * decision (records, JSON, error classes, ownership) — can be compiled against
 * an engine it does not name, and so a second engine is a second .c file rather
 * than a second library.
 *
 * The port is deliberately TINY. All Prolog term work lives in
 * src/insimul_boot.pl (see CLAUDE.md, "The C layer does not walk Prolog terms"),
 * so an engine only has to do four things: come up, take a bootstrap program,
 * run a ground goal quietly, and go away. Everything a host sees — the binding
 * set JSON, the ISO error class, the snapshot bytes — is produced by the
 * bootstrap on top of these four, which is what makes an engine swap a
 * measurable experiment instead of a rewrite.
 *
 * ONE IMPLEMENTATION IS LINKED PER BUILD, chosen by the CMake cache variable
 * INSIMUL_ENGINE (trealla | swipl). See docs/SWIPL_SPIKE.md.
 */
#ifndef INSIMUL_ENGINE_H
#define INSIMUL_ENGINE_H

/* One engine instance backing one insimul_kb. Opaque to insimul.c. */
typedef struct insimul_engine insimul_engine;

/*
 * Open an instance with src/insimul_boot.pl already consulted into it, or NULL
 * on failure. Implementations do whatever process-wide initialisation they need
 * here, once and thread-safely (Trealla's keepalive, SWI's PL_initialise).
 */
insimul_engine *insimul_engine_open(void);

/* Close an instance (NULL is a no-op). */
void insimul_engine_close(insimul_engine *e);

/*
 * Run one self-contained dispatch goal — "'$insimul_query'('/tmp/x','foo(X)')"
 * — as TEXT, without a trailing full stop and with no free top-level variables.
 * The bootstrap helpers always succeed and report through the result file, so
 * this returns 0 when the goal RAN and -1 only on a hard engine failure (which
 * means the bootstrap is missing: an internal invariant break, not a user
 * error). Nothing may be written to the process's stdout/stderr.
 */
int insimul_engine_run(insimul_engine *e, const char *goal);

#endif /* INSIMUL_ENGINE_H */
