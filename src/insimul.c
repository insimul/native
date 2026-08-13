/*
 * insimul.c — libinsimul implementation, engine-agnostic.
 *
 * Design: the C layer never walks Prolog term structures and never names an
 * engine. Each KB opens ONE instance of the internal engine port
 * (src/insimul_engine.h) with a fixed bootstrap program consulted into it
 * (src/insimul_boot.pl, embedded as insimul_boot_pl[]), which exposes
 * '$insimul_query'/2, '$insimul_assert'/2, '$insimul_retract'/2,
 * '$insimul_consult'/2, '$insimul_snapshot'/1 and '$insimul_restore'/2. We hand
 * those helpers the caller's goal/source as text and a temp result-file path;
 * they run the operation and write records to the file (SOL/ERR/OK/NONE — see
 * insimul_boot.pl). We read the file back and turn it into the ABI's return
 * values / JSON solution strings.
 *
 * This keeps everything per-KB (no process stdout/stderr redirection, no global
 * mutable state) so a host can run one KB per thread, and it is why swapping the
 * Prolog engine is one new file under src/ — engine_trealla.c or engine_swipl.c
 * — rather than a rewrite of this one.
 */

#include "insimul.h"
#include "insimul_engine.h"

#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#ifdef _WIN32
#include <windows.h>
#include <io.h>
#else
#include <unistd.h>
#endif

struct insimul_kb {
    insimul_engine *eng;
    char   *last_error;   /* NULL when the last op succeeded */
    char   *error_class;  /* ISO class of last_error, NULL when it is NULL */
    char   *snapshot;     /* last insimul_kb_snapshot image (owned by the KB) */
};

struct insimul_query {
    char  **sols;         /* strdup'd JSON binding sets */
    size_t  count;
    size_t  idx;
};

/* ------------------------------------------------------------------ errors */

/*
 * Record an error. `cls` is the ISO error class the bootstrap classified it as
 * (see '$err_class'/2), or NULL when the failure is the ABI's own (out of
 * memory, temp file) rather than a Prolog exception — those get "system_error",
 * because to a host they are exactly that.
 */
static void set_error_class(insimul_kb *kb, const char *msg, const char *cls)
{
    free(kb->last_error);
    free(kb->error_class);
    kb->last_error = msg ? strdup(msg) : NULL;
    kb->error_class = msg ? strdup(cls ? cls : "system_error") : NULL;
}

static void set_error(insimul_kb *kb, const char *msg)
{
    set_error_class(kb, msg, NULL);
}

/*
 * Split an "ERR" record's text — "<class> <term>" as written by '$err_lines'/3 —
 * into its class (copied into `cls`) and the term text (returned). A record
 * without a class token is reported as-is with a system_error class; that can
 * only happen if the bootstrap and this file disagree, which the abi/neutrality
 * tests would catch first.
 */
static const char *split_err(const char *text, char *cls, size_t clssz)
{
    cls[0] = '\0';
    if (!text) return NULL;
    const char *sp = strchr(text, ' ');
    if (!sp) return text;
    size_t n = (size_t)(sp - text);
    if (n >= clssz) n = clssz - 1;
    memcpy(cls, text, n);
    cls[n] = '\0';
    return sp + 1;
}

/* Record an ERR record's text (class + term) on the KB. */
static void set_error_record(insimul_kb *kb, const char *text)
{
    char cls[32];
    const char *msg = split_err(text, cls, sizeof cls);
    set_error_class(kb, msg && *msg ? msg : "insimul: operation failed",
                    cls[0] ? cls : NULL);
}

const char *insimul_last_error(insimul_kb *kb)
{
    return kb ? kb->last_error : NULL;
}

const char *insimul_last_error_class(insimul_kb *kb)
{
    return kb ? kb->error_class : NULL;
}

/* ----------------------------------------------------------------- version */

/*
 * Version stamp assembled at compile time from CMake-provided macros. Fallbacks
 * keep the build honest if the header is compiled outside CMake (e.g. a quick
 * standalone check): the string is still well-formed, just less specific.
 */
#ifndef INSIMUL_VERSION
#define INSIMUL_VERSION "0.0.0"
#endif
#ifndef INSIMUL_GIT_SHA
#define INSIMUL_GIT_SHA "unknown"
#endif
/*
 * The engine's identity is a VALUE here, never part of the schema: the stamp
 * reads "engine <name>/<version>/<commit>" whatever engine is underneath, so
 * swapping it changes what the field says and not what consumers parse (leak
 * L-02). scripts/package.sh writes the same three fields into a package's
 * VERSION file under engine_name / engine_version / engine_commit.
 */
#ifndef INSIMUL_ENGINE_NAME
#define INSIMUL_ENGINE_NAME "unknown"
#endif
#ifndef INSIMUL_ENGINE_VERSION
#define INSIMUL_ENGINE_VERSION "unknown"
#endif
#ifndef INSIMUL_ENGINE_COMMIT
#define INSIMUL_ENGINE_COMMIT "unknown"
#endif

const char *insimul_version(void)
{
    return "insimul " INSIMUL_VERSION
           " (git " INSIMUL_GIT_SHA
           ", engine " INSIMUL_ENGINE_NAME "/" INSIMUL_ENGINE_VERSION
           "/" INSIMUL_ENGINE_COMMIT ")";
}

/* --------------------------------------------------------------- temp files */

/*
 * Create a fresh temp file and return its path in `out` (caller-sized buffer).
 * Returns 0 on success. The file exists and is empty; Prolog reopens it by path.
 */
static int make_temp(char *out, size_t n)
{
#ifdef _WIN32
    char dir[MAX_PATH];
    if (!GetTempPathA((DWORD)sizeof(dir), dir)) return -1;
    char path[MAX_PATH];
    if (!GetTempFileNameA(dir, "ins", 0, path)) return -1; /* creates the file */
    if (strlen(path) + 1 > n) return -1;
    strcpy(out, path);
    return 0;
#else
    const char *dir = getenv("TMPDIR");
    if (!dir || !*dir) dir = "/tmp";
    if (snprintf(out, n, "%s/insimul_XXXXXX", dir) >= (int)n) return -1;
    int fd = mkstemp(out);
    if (fd < 0) return -1;
    close(fd);
    return 0;
#endif
}

/* Read an entire file into a malloc'd NUL-terminated buffer (NULL on failure). */
static char *read_all(const char *path)
{
    FILE *fp = fopen(path, "rb");
    if (!fp) return NULL;
    if (fseek(fp, 0, SEEK_END) != 0) { fclose(fp); return NULL; }
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

/* ----------------------------------------------------------- Prolog escaping */

/*
 * Wrap `s` as a single-quoted Prolog atom into `dst` (which must hold at least
 * 2 + 2*len + 1 bytes). Backslash, single quote and the common control chars are
 * escaped so the atom round-trips exactly through the engine's reader.
 */
static void quote_atom(char *dst, const char *s)
{
    char *d = dst;
    *d++ = '\'';
    for (; *s; s++) {
        unsigned char c = (unsigned char)*s;
        switch (c) {
            case '\\': *d++ = '\\'; *d++ = '\\'; break;
            case '\'': *d++ = '\\'; *d++ = '\''; break;
            case '\n': *d++ = '\\'; *d++ = 'n';  break;
            case '\r': *d++ = '\\'; *d++ = 'r';  break;
            case '\t': *d++ = '\\'; *d++ = 't';  break;
            default:   *d++ = (char)c;           break;
        }
    }
    *d++ = '\'';
    *d = '\0';
}

/* --------------------------------------------------------------- run a goal */

/*
 * Running a dispatch goal is the ONE thing this file asks of the engine (see
 * src/insimul_engine.h): the helpers always succeed and report through the
 * result file, so a -1 here means the bootstrap is missing, not that the user's
 * goal failed.
 */

/*
 * Build "'<pred>'('<resfile>','<arg>')", run it, and return the result file
 * contents (malloc'd, caller frees) with the temp file removed. On infrastructure
 * failure sets kb error and returns NULL.
 */
static char *dispatch(insimul_kb *kb, const char *pred, const char *arg)
{
    char res[1024];
    if (make_temp(res, sizeof res) != 0) {
        set_error(kb, "insimul: could not create temp file");
        return NULL;
    }

    size_t need = strlen(pred) + 2                    /* '<pred>' */
                + 2 + 2 * strlen(res)                 /* quoted res path */
                + 2 + 2 * strlen(arg)                 /* quoted arg */
                + 8;                                  /* ( , ) . NUL slack */
    char *qres = malloc(2 + 2 * strlen(res) + 1);
    char *qarg = malloc(2 + 2 * strlen(arg) + 1);
    char *goal = malloc(need + 4);
    char *out = NULL;

    if (qres && qarg && goal) {
        quote_atom(qres, res);
        quote_atom(qarg, arg);
        /* pred is a literal like "$insimul_query"; quote it as an atom too. */
        snprintf(goal, need + 4, "'%s'(%s,%s)", pred, qres, qarg);
        if (insimul_engine_run(kb->eng, goal) == 0) {
            out = read_all(res);
            if (!out) set_error(kb, "insimul: could not read result file");
        } else {
            set_error(kb, "insimul: engine failed to run dispatch goal");
        }
    } else {
        set_error(kb, "insimul: out of memory");
    }

    remove(res);
    free(qres);
    free(qarg);
    free(goal);
    return out;
}

/*
 * Split the result buffer into lines and, for the first line, return its tag
 * ("SOL"/"ERR"/"OK"/"NONE") via `tag` and the text after the tag+space via the
 * return value. Used by the single-record ops (assert/retract/consult).
 */
static const char *first_record(char *buf, char *tag, size_t tagsz)
{
    tag[0] = '\0';
    if (!buf) return NULL;
    char *nl = strchr(buf, '\n');
    if (nl) *nl = '\0';
    char *sp = strchr(buf, ' ');
    if (sp) {
        size_t tl = (size_t)(sp - buf);
        if (tl >= tagsz) tl = tagsz - 1;
        memcpy(tag, buf, tl);
        tag[tl] = '\0';
        return sp + 1;
    }
    /* No space: the whole line is the tag (OK / NONE with empty text). */
    snprintf(tag, tagsz, "%s", buf);
    return "";
}

/* ------------------------------------------------------------- KB lifecycle */

insimul_kb *insimul_kb_create(void)
{
    insimul_kb *kb = calloc(1, sizeof *kb);
    if (!kb) return NULL;

    /* The port brings the engine up (once, process-wide, however that engine
     * needs it) and hands back an instance with insimul_boot.pl consulted. */
    kb->eng = insimul_engine_open();
    if (!kb->eng) { free(kb); return NULL; }
    return kb;
}

void insimul_kb_destroy(insimul_kb *kb)
{
    if (!kb) return;
    insimul_engine_close(kb->eng);
    free(kb->last_error);
    free(kb->error_class);
    free(kb->snapshot);
    free(kb);
}

/* ----------------------------------------------------------------- consult */

int insimul_kb_consult(insimul_kb *kb, const char *source)
{
    if (!kb) return -1;
    set_error(kb, NULL);

    /* Source is a whole program; hand it to '$insimul_consult' via a temp file. */
    char src[1024];
    if (make_temp(src, sizeof src) != 0) {
        set_error(kb, "insimul: could not create temp file");
        return -1;
    }
    int rc = -1;
    FILE *fp = fopen(src, "wb");
    if (fp) {
        if (source) fwrite(source, 1, strlen(source), fp);
        fclose(fp);
        char *out = dispatch(kb, "$insimul_consult", src);
        if (out) {
            char tag[16];
            const char *text = first_record(out, tag, sizeof tag);
            if (strcmp(tag, "OK") == 0) rc = 0;
            else { set_error_record(kb, text); rc = -1; }
            free(out);
        }
    } else {
        set_error(kb, "insimul: could not write temp file");
    }
    remove(src);
    return rc;
}

/* ------------------------------------------------------------ assert/retract */

int insimul_kb_assert(insimul_kb *kb, const char *fact)
{
    if (!kb) return -1;
    set_error(kb, NULL);
    char *out = dispatch(kb, "$insimul_assert", fact ? fact : "");
    if (!out) return -1;
    char tag[16];
    const char *text = first_record(out, tag, sizeof tag);
    int rc = (strcmp(tag, "OK") == 0) ? 0
           : (set_error_record(kb, text), -1);
    free(out);
    return rc;
}

int insimul_kb_retract(insimul_kb *kb, const char *fact)
{
    if (!kb) return -1;
    set_error(kb, NULL);
    char *out = dispatch(kb, "$insimul_retract", fact ? fact : "");
    if (!out) return -1;
    char tag[16];
    const char *text = first_record(out, tag, sizeof tag);
    int rc;
    if (strcmp(tag, "OK") == 0)        rc = 0;
    else if (strcmp(tag, "NONE") == 0) rc = 1;
    else { set_error_record(kb, text); rc = -1; }
    free(out);
    return rc;
}

/* ------------------------------------------------------------------ queries */

insimul_query *insimul_query_start(insimul_kb *kb, const char *goal)
{
    if (!kb) return NULL;
    set_error(kb, NULL);

    char *out = dispatch(kb, "$insimul_query", goal ? goal : "");
    if (!out) return NULL;

    /* Parse SOL/ERR lines. An ERR anywhere means the goal raised — fail the start. */
    size_t cap = 8, count = 0;
    char **sols = malloc(cap * sizeof *sols);
    if (!sols) { free(out); set_error(kb, "insimul: out of memory"); return NULL; }

    int had_err = 0;
    char *line = out;
    while (line && *line) {
        char *nl = strchr(line, '\n');
        if (nl) *nl = '\0';
        if (strncmp(line, "SOL ", 4) == 0) {
            if (count == cap) {
                cap *= 2;
                char **grown = realloc(sols, cap * sizeof *sols);
                if (!grown) { had_err = 1; break; }
                sols = grown;
            }
            sols[count] = strdup(line + 4);
            if (!sols[count]) { had_err = 1; break; }
            count++;
        } else if (strncmp(line, "ERR ", 4) == 0) {
            set_error_record(kb, line + 4);
            had_err = 1;
            break;
        }
        line = nl ? nl + 1 : NULL;
    }
    free(out);

    if (had_err) {
        for (size_t i = 0; i < count; i++) free(sols[i]);
        free(sols);
        if (!kb->last_error) set_error(kb, "insimul: query failed");
        return NULL;
    }

    insimul_query *q = calloc(1, sizeof *q);
    if (!q) {
        for (size_t i = 0; i < count; i++) free(sols[i]);
        free(sols);
        set_error(kb, "insimul: out of memory");
        return NULL;
    }
    q->sols = sols;
    q->count = count;
    q->idx = 0;
    return q;
}

const char *insimul_query_next(insimul_query *q)
{
    if (!q || q->idx >= q->count) return NULL;
    return q->sols[q->idx++];
}

void insimul_query_stop(insimul_query *q)
{
    if (!q) return;
    for (size_t i = 0; i < q->count; i++) free(q->sols[i]);
    free(q->sols);
    free(q);
}

/* ------------------------------------------------------------ snapshot/restore */

const char *insimul_kb_snapshot(insimul_kb *kb)
{
    if (!kb) return NULL;
    set_error(kb, NULL);
    free(kb->snapshot);
    kb->snapshot = NULL;

    /* Snapshot takes only a result-file path (no user arg), so it does not go
     * through dispatch(); it drives '$insimul_snapshot'/1 directly. */
    char res[1024];
    if (make_temp(res, sizeof res) != 0) {
        set_error(kb, "insimul: could not create temp file");
        return NULL;
    }
    char *qres = malloc(2 + 2 * strlen(res) + 1);
    size_t goalsz = strlen(res) * 2 + 64;
    char *goal = malloc(goalsz);
    char *out = NULL;

    if (qres && goal) {
        quote_atom(qres, res);
        snprintf(goal, goalsz, "'$insimul_snapshot'(%s)", qres);
        if (insimul_engine_run(kb->eng, goal) == 0) {
            out = read_all(res);
            if (!out) set_error(kb, "insimul: could not read result file");
        } else {
            set_error(kb, "insimul: engine failed to run snapshot goal");
        }
    } else {
        set_error(kb, "insimul: out of memory");
    }
    remove(res);
    free(qres);
    free(goal);

    const char *ret = NULL;
    if (out) {
        /* Line 1 is the status: "OK" (image follows from line 2) or "ERR <term>". */
        char *nl = strchr(out, '\n');
        const char *body = nl ? nl + 1 : "";
        if (nl) *nl = '\0';
        if (strcmp(out, "OK") == 0) {
            kb->snapshot = strdup(body);
            if (kb->snapshot) ret = kb->snapshot;
            else set_error(kb, "insimul: out of memory");
        } else if (strncmp(out, "ERR ", 4) == 0) {
            set_error_record(kb, out + 4);
        } else {
            set_error(kb, out[0] ? out : "insimul: snapshot failed");
        }
        free(out);
    }
    return ret;
}

int insimul_kb_restore(insimul_kb *kb, const char *image)
{
    if (!kb) return -1;
    set_error(kb, NULL);

    /* Hand the image to '$insimul_restore' via a temp file, exactly like consult. */
    char src[1024];
    if (make_temp(src, sizeof src) != 0) {
        set_error(kb, "insimul: could not create temp file");
        return -1;
    }
    int rc = -1;
    FILE *fp = fopen(src, "wb");
    if (fp) {
        if (image) fwrite(image, 1, strlen(image), fp);
        fclose(fp);
        char *out = dispatch(kb, "$insimul_restore", src);
        if (out) {
            char tag[16];
            const char *text = first_record(out, tag, sizeof tag);
            if (strcmp(tag, "OK") == 0) rc = 0;
            else { set_error_record(kb, text); rc = -1; }
            free(out);
        }
    } else {
        set_error(kb, "insimul: could not write temp file");
    }
    remove(src);
    return rc;
}
