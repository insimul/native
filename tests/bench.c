/*
 * bench.c — the MEASUREMENT harness (US-3 of tasklist 250, decision D20).
 *
 * Not a test: this binary produces the numbers docs/SWIPL_MEASUREMENT.md
 * publishes. It is a pure consumer of include/insimul.h, so the SAME source
 * measures both engines — a difference in the output is a difference in the
 * engine, not in the harness (that is the whole point of building two engines
 * behind one ABI in US-1).
 *
 *   insimul_bench [--json <file>] [--queries <file>] [--label <s>] <world.pl>...
 *
 * WHAT IS MEASURED, and why it is one process per run:
 *
 *   create   insimul_kb_create() — bringing the engine up COLD (Trealla:
 *            pl_create + the bootstrap; SWI: PL_initialise, boot.prc, the
 *            library, then the bootstrap) plus consulting src/insimul_boot.pl.
 *            Both engines do this once per PROCESS, so measuring a second
 *            create in the same process would measure a warm cache and flatter
 *            whichever engine has the bigger one. scripts/measure.sh therefore
 *            runs this binary N times and reports the distribution.
 *   consult  insimul_kb_consult() over the world's .pl set, in the manifest's
 *            order (bench/world/MANIFEST.json). The caller passes the files, so
 *            the manifest stays the one place the world's scale is stated.
 *   query    every goal in bench/world/QUERIES.txt, each exhausted to its last
 *            solution. The total solution count is printed: two engines that
 *            report different totals are not holding the same world, and no
 *            timing below that line would mean anything.
 *
 * MEMORY. `rss` is the process's resident set at each stage boundary (darwin:
 * mach_task_basic_info.resident_size; linux: /proc/self/statm) and `peak` is
 * getrusage(RUSAGE_SELF).ru_maxrss normalised to bytes. Both are whole-process
 * figures — for an embedded engine that is the honest unit, because the engine's
 * runtime (SWI's home tree is read from disk at boot; Trealla's library is
 * already in .text) is exactly the cost a host pays.
 */

#include "insimul.h"

#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <time.h>
#include <sys/resource.h>

#if defined(__APPLE__)
#include <mach/mach.h>
#elif defined(__linux__)
#include <unistd.h>
#endif

static double now_ms(void) {
    struct timespec ts;
    clock_gettime(CLOCK_MONOTONIC, &ts);
    return (double)ts.tv_sec * 1000.0 + (double)ts.tv_nsec / 1.0e6;
}

/* Current resident set, in bytes. 0 when the platform has no cheap answer —
 * printed as 0 rather than guessed, so a missing figure is visible. */
static unsigned long long rss_bytes(void) {
#if defined(__APPLE__)
    mach_task_basic_info_data_t info;
    mach_msg_type_number_t count = MACH_TASK_BASIC_INFO_COUNT;
    if (task_info(mach_task_self(), MACH_TASK_BASIC_INFO, (task_info_t)&info, &count) == KERN_SUCCESS)
        return (unsigned long long)info.resident_size;
    return 0;
#elif defined(__linux__)
    FILE *f = fopen("/proc/self/statm", "r");
    if (!f) return 0;
    unsigned long long total = 0, resident = 0;
    int n = fscanf(f, "%llu %llu", &total, &resident);
    fclose(f);
    if (n != 2) return 0;
    return resident * (unsigned long long)sysconf(_SC_PAGESIZE);
#else
    return 0;
#endif
}

/* Peak resident set, in bytes. ru_maxrss is bytes on darwin and kilobytes on
 * linux — normalised here so one column means one thing. */
static unsigned long long peak_rss_bytes(void) {
    struct rusage ru;
    if (getrusage(RUSAGE_SELF, &ru) != 0) return 0;
#if defined(__APPLE__)
    return (unsigned long long)ru.ru_maxrss;
#else
    return (unsigned long long)ru.ru_maxrss * 1024ULL;
#endif
}

static char *read_file(const char *path, long *len_out) {
    FILE *f = fopen(path, "rb");
    if (!f) return NULL;
    fseek(f, 0, SEEK_END);
    long len = ftell(f);
    fseek(f, 0, SEEK_SET);
    char *buf = malloc((size_t)len + 1);
    if (!buf) { fclose(f); return NULL; }
    size_t got = fread(buf, 1, (size_t)len, f);
    fclose(f);
    buf[got] = '\0';
    if (len_out) *len_out = (long)got;
    return buf;
}

/* One goal per line; '#' comments and blank lines ignored. Returns a NULL-
 * terminated array of owned strings. */
static char **read_queries(const char *path, int *count) {
    char *text = read_file(path, NULL);
    if (!text) return NULL;
    int cap = 32, n = 0;
    char **out = malloc((size_t)cap * sizeof *out);
    for (char *line = strtok(text, "\n"); line; line = strtok(NULL, "\n")) {
        while (*line == ' ' || *line == '\t') line++;
        size_t l = strlen(line);
        while (l && (line[l - 1] == '\r' || line[l - 1] == ' ')) line[--l] = '\0';
        if (!*line || *line == '#') continue;
        if (n == cap) { cap *= 2; out = realloc(out, (size_t)cap * sizeof *out); }
        out[n++] = strdup(line);
    }
    free(text);
    *count = n;
    return out;
}

static void json_escape(FILE *f, const char *s) {
    for (const unsigned char *p = (const unsigned char *)s; *p; p++) {
        if (*p == '"' || *p == '\\') fprintf(f, "\\%c", *p);
        else if (*p < 0x20) fprintf(f, "\\u%04x", *p);
        else fputc((char)*p, f);
    }
}

int main(int argc, char **argv) {
    const char *json_path = NULL;
    const char *queries_path = NULL;
    const char *label = "native";
    const char *files[64];
    int nfiles = 0;

    for (int i = 1; i < argc; i++) {
        if (!strcmp(argv[i], "--json") && i + 1 < argc)          json_path = argv[++i];
        else if (!strcmp(argv[i], "--queries") && i + 1 < argc)  queries_path = argv[++i];
        else if (!strcmp(argv[i], "--label") && i + 1 < argc)    label = argv[++i];
        else if (!strncmp(argv[i], "--", 2)) {
            fprintf(stderr, "bench: unknown option %s\n", argv[i]);
            return 2;
        } else {
            if (nfiles == (int)(sizeof files / sizeof files[0])) {
                fprintf(stderr, "bench: too many world files\n");
                return 2;
            }
            files[nfiles++] = argv[i];
        }
    }
    if (nfiles == 0) {
        fprintf(stderr,
                "usage: insimul_bench [--json f] [--queries f] [--label s] <world.pl>...\n"
                "  The world files are passed in bench/world/MANIFEST.json's consultOrder.\n");
        return 2;
    }

    /* Read every input BEFORE the clock starts: this measures the engine, not
     * the file system. The bytes consulted are reported so the figure carries
     * its scale. */
    char *sources[64];
    long source_len[64];
    long total_bytes = 0;
    for (int i = 0; i < nfiles; i++) {
        sources[i] = read_file(files[i], &source_len[i]);
        if (!sources[i]) {
            fprintf(stderr, "bench: cannot read %s\n", files[i]);
            return 1;
        }
        total_bytes += source_len[i];
    }
    int nqueries = 0;
    char **queries = NULL;
    if (queries_path) {
        queries = read_queries(queries_path, &nqueries);
        if (!queries) { fprintf(stderr, "bench: cannot read %s\n", queries_path); return 1; }
    }

    unsigned long long rss_start = rss_bytes();

    double t0 = now_ms();
    insimul_kb *kb = insimul_kb_create();
    double t_create = now_ms() - t0;
    if (!kb) { fprintf(stderr, "bench: insimul_kb_create() failed\n"); return 1; }
    unsigned long long rss_created = rss_bytes();

    double t1 = now_ms();
    for (int i = 0; i < nfiles; i++) {
        if (insimul_kb_consult(kb, sources[i]) != 0) {
            fprintf(stderr, "bench: consult of %s FAILED: %s (%s)\n", files[i],
                    insimul_last_error(kb), insimul_last_error_class(kb));
            return 1;
        }
    }
    double t_consult = now_ms() - t1;
    unsigned long long rss_consulted = rss_bytes();

    /* Every goal, exhausted. The solution total is a cross-engine equality
     * check, not decoration — see the header comment. */
    double t2 = now_ms();
    long solutions = 0;
    for (int i = 0; i < nqueries; i++) {
        insimul_query *q = insimul_query_start(kb, queries[i]);
        if (!q) {
            fprintf(stderr, "bench: query_start(%s) FAILED: %s\n", queries[i],
                    insimul_last_error(kb));
            return 1;
        }
        while (insimul_query_next(q) != NULL) solutions++;
        const char *err = insimul_last_error(kb);
        if (err && *err) {
            fprintf(stderr, "bench: query %s raised: %s (%s)\n", queries[i], err,
                    insimul_last_error_class(kb));
            insimul_query_stop(q);
            return 1;
        }
        insimul_query_stop(q);
    }
    double t_query = now_ms() - t2;
    unsigned long long rss_queried = rss_bytes();
    unsigned long long peak = peak_rss_bytes();

    /* The KB is still alive at this point ON PURPOSE: "resident memory holding a
     * real world's KB" is the figure the decision needs. */
    printf("bench[%s]: create %.2f ms, consult %.2f ms (%ld bytes, %d files), "
           "query %.2f ms (%ld solutions), rss %llu -> %llu -> %llu (peak %llu)\n",
           label, t_create, t_consult, total_bytes, nfiles, t_query, solutions,
           rss_start, rss_created, rss_consulted, peak);

    if (json_path) {
        FILE *jf = strcmp(json_path, "-") ? fopen(json_path, "a") : stdout;
        if (!jf) { fprintf(stderr, "bench: cannot write %s\n", json_path); return 1; }
        fprintf(jf, "{\"leg\":\"%s\",\"version\":\"", label);
        json_escape(jf, insimul_version());
        fprintf(jf,
                "\",\"ms\":{\"create\":%.3f,\"consult\":%.3f,\"query\":%.3f},"
                "\"rss\":{\"start\":%llu,\"created\":%llu,\"consulted\":%llu,"
                "\"queried\":%llu,\"peak\":%llu},"
                "\"world\":{\"files\":%d,\"bytes\":%ld},\"solutions\":%ld}\n",
                t_create, t_consult, t_query, rss_start, rss_created, rss_consulted,
                rss_queried, peak, nfiles, total_bytes, solutions);
        if (jf != stdout) fclose(jf);
    }

    insimul_kb_destroy(kb);
    return 0;
}
