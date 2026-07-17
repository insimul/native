/*
 * insimul.c — libinsimul implementation.
 *
 * US-LI1 skeleton: the insimul C ABI itself lands in US-LI2. For now this unit
 * provides the two globals that Trealla normally defines in its CLI main
 * (tpl.c), which we do not compile into a library. Without these, linking any
 * program against the embedded Trealla objects fails with undefined symbols
 * (g_envp is read by process_create/3 in bif_os.c; g_sigfn is the SIGINT
 * handler installed by the toplevel).
 */

#include "insimul.h"
#include <stddef.h>

/* An empty, NULL-terminated environment: process/3 iterates until the NULL,
 * so this is safe even though libinsimul consumers never spawn processes. */
static char *insimul_empty_env[] = { NULL };
char **g_envp = insimul_empty_env;

/* No interactive toplevel in library builds — nothing to interrupt. */
void g_sigfn(int s) { (void)s; }
