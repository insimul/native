/*
 * stdout_guard.h — catch anything the library writes to the process's stdout
 * while a test drives it (PL.native-kb-instantiation-error).
 *
 * A KB must never print: every answer, error and diagnostic crosses the ABI as
 * a return value or insimul_last_error(). The pinned engine prints to stdout
 * when a goal raises outside the bootstrap's catch, so a stray line on stdout is
 * a seam fault even when every answer still matches. This guard points fd 1 at a
 * temporary file for the span of the calls under test and hands back whatever
 * landed there. It does NOT hide output: a caller that gets bytes back FAILS and
 * prints them, after stdout is restored.
 *
 * Header-only, C and C++. Usage:
 *     stdout_guard g;
 *     if (stdout_guard_begin(&g) != 0) ... (the guard could not start: fail)
 *     ... calls into the library ...
 *     size_t n = 0; char *text = stdout_guard_end(&g, &n);   (malloc'd, NUL-ended)
 *     if (!text || n) ... FAIL, print text ...
 *     free(text);
 * The test's own messages must not be printed between begin and end.
 */
#ifndef INSIMUL_TESTS_STDOUT_GUARD_H
#define INSIMUL_TESTS_STDOUT_GUARD_H

#include <stdio.h>
#include <stdlib.h>

#ifdef _WIN32
#include <io.h>
#define SG_DUP _dup
#define SG_DUP2 _dup2
#define SG_CLOSE _close
#define SG_FILENO _fileno
#else
#include <unistd.h>
#define SG_DUP dup
#define SG_DUP2 dup2
#define SG_CLOSE close
#define SG_FILENO fileno
#endif

typedef struct {
	int saved;
	FILE *tmp;
} stdout_guard;

static int stdout_guard_begin(stdout_guard *g) {
	g->saved = -1;
	g->tmp = tmpfile();
	if (!g->tmp) return -1;
	fflush(stdout);
	g->saved = SG_DUP(SG_FILENO(stdout));
	if (g->saved < 0 || SG_DUP2(SG_FILENO(g->tmp), SG_FILENO(stdout)) < 0) {
		if (g->saved >= 0) SG_CLOSE(g->saved);
		fclose(g->tmp);
		g->tmp = NULL;
		g->saved = -1;
		return -1;
	}
	return 0;
}

/* Restores stdout; returns what was written meanwhile (NULL if it cannot be read). */
static char *stdout_guard_end(stdout_guard *g, size_t *len) {
	if (len) *len = 0;
	if (!g->tmp) return NULL;
	fflush(stdout);
	SG_DUP2(g->saved, SG_FILENO(stdout));
	SG_CLOSE(g->saved);
	g->saved = -1;
	char *text = NULL;
	if (fseek(g->tmp, 0, SEEK_END) == 0) {
		long n = ftell(g->tmp);
		if (n >= 0 && fseek(g->tmp, 0, SEEK_SET) == 0) {
			text = (char *)malloc((size_t)n + 1);
			if (text) {
				size_t got = fread(text, 1, (size_t)n, g->tmp);
				text[got] = '\0';
				if (len) *len = got;
			}
		}
	}
	fclose(g->tmp);
	g->tmp = NULL;
	return text;
}

#endif
