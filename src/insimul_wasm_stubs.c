/*
 * insimul_wasm_stubs.c — the one host facility Emscripten's libc does not
 * provide that Trealla references. Compiled into the wasm target only (see
 * cmake/wasm.cmake); it is a no-op translation unit everywhere else.
 *
 * Trealla's src/bif_os.c implements the `process_create/3` family with
 * posix_spawnp(). Emscripten declares it in <spawn.h> but has no
 * implementation, since a wasm module cannot fork a process — so the link
 * fails on that single symbol.
 *
 * We stub it rather than pass -sERROR_ON_UNDEFINED_SYMBOLS=0: that flag would
 * silently turn EVERY future missing symbol into a runtime abort, and the whole
 * point of this target is that it behaves the same as the native one. A real,
 * failing implementation keeps the link honest. Prolog code that calls
 * process_create/3 in the browser gets a clean error instead of a trap;
 * nothing in src/insimul_boot.pl or the conformance corpus uses it.
 */

#if defined(__EMSCRIPTEN__)

#include <errno.h>
#include <spawn.h>

/* POSIX contract: return an errno value (not -1) and do not set errno. */
int posix_spawnp(pid_t *pid, const char *file,
                 const posix_spawn_file_actions_t *file_actions,
                 const posix_spawnattr_t *attrp,
                 char *const argv[], char *const envp[])
{
    (void)pid; (void)file; (void)file_actions;
    (void)attrp; (void)argv; (void)envp;
    return ENOSYS; /* "spawning processes is not supported in WebAssembly" */
}

#else

/* Keep the translation unit non-empty for compilers that reject an empty one. */
typedef int insimul_wasm_stubs_unused;

#endif /* __EMSCRIPTEN__ */
