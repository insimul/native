/*
 * corebridge_cases.c — the C leg of libinsimulcore's method gate (Features Round C0).
 *
 * A pure consumer of corebridge/include/insimulcore.h: it includes neither
 * quickjs.h nor insimul.h. Every case in the two case directories is run on a
 * FRESH insimul_core handle, step by step, through insimul_core_call() — so every
 * method of the table is exercised exactly as Unity's P/Invoke, Unreal's
 * ThirdParty module and Godot's GDExtension will call it: a method name, a JSON
 * argument string, a JSON result string or NULL plus last_error.
 *
 *   insimulcore_cases <generated-case-dir> <hand-written-case-dir>
 *
 * The case format and the matcher rules are corebridge/tests/README.md; the JS
 * leg (tests/corebridge_cases.mjs) implements the same rules over the same files
 * in Node, and the two legs' raw results are diffed by the corebridge_cases_parity
 * ctest (INSIMUL_CORE_CASES_JSON=<path> makes this leg write one JSON-Lines record
 * per step: file, case, step, method, ok, raw).
 *
 * Also asserted here, because only a C consumer can see it: every method
 * `core.methods` lists is called by at least one case, and every called method
 * exists — the table cannot grow a row nobody calls from C.
 *
 * Non-vacuity: a missing or empty case directory, a file with no cases, an
 * unparseable file or a run with no step is exit 2, never a pass.
 */

#include <ctype.h>
#include <dirent.h>
#include <math.h>
#include <stdarg.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#include "insimulcore.h"

/* ── a small JSON value (test support; parses UTF-8 JSON text) ───────────── */

typedef enum { J_NULL, J_BOOL, J_NUM, J_STR, J_ARR, J_OBJ } jtype;

typedef struct jval {
	jtype t;
	int b;
	double n;
	char *s; /* J_STR: bytes (may hold NUL), length slen */
	size_t slen;
	struct jval **items; /* J_ARR elements / J_OBJ values */
	char **keys;         /* J_OBJ keys (NUL-terminated) */
	size_t len, cap;
} jval;

static void *xmalloc(size_t n) {
	void *p = malloc(n ? n : 1);
	if (!p) {
		fprintf(stderr, "corebridge_cases: out of memory\n");
		exit(2);
	}
	return p;
}

static void *xrealloc(void *p, size_t n) {
	void *q = realloc(p, n ? n : 1);
	if (!q) {
		fprintf(stderr, "corebridge_cases: out of memory\n");
		exit(2);
	}
	return q;
}

static jval *jnew(jtype t) {
	jval *v = (jval *)xmalloc(sizeof(jval));
	memset(v, 0, sizeof(*v));
	v->t = t;
	return v;
}

static void jfree(jval *v) {
	if (!v) return;
	for (size_t i = 0; i < v->len; i++) {
		jfree(v->items[i]);
		if (v->keys) free(v->keys[i]);
	}
	free(v->items);
	free(v->keys);
	free(v->s);
	free(v);
}

static void jpush(jval *v, char *key, jval *item) {
	if (v->len == v->cap) {
		v->cap = v->cap ? v->cap * 2 : 4;
		v->items = (jval **)xrealloc(v->items, v->cap * sizeof(jval *));
		if (v->t == J_OBJ) v->keys = (char **)xrealloc(v->keys, v->cap * sizeof(char *));
	}
	v->items[v->len] = item;
	if (v->t == J_OBJ) v->keys[v->len] = key;
	v->len++;
}

static jval *jget(const jval *v, const char *key) {
	if (!v || v->t != J_OBJ) return NULL;
	for (size_t i = 0; i < v->len; i++)
		if (strcmp(v->keys[i], key) == 0) return v->items[i];
	return NULL;
}

typedef struct {
	const char *p;
	const char *end;
	const char *err;
} jparser;

static void skip_ws(jparser *ps) {
	while (ps->p < ps->end && (*ps->p == ' ' || *ps->p == '\t' || *ps->p == '\n' || *ps->p == '\r')) ps->p++;
}

static void put_utf8(char **buf, size_t *len, size_t *cap, unsigned cp) {
	char tmp[4];
	size_t n;
	if (cp < 0x80) {
		tmp[0] = (char)cp;
		n = 1;
	} else if (cp < 0x800) {
		tmp[0] = (char)(0xc0 | (cp >> 6));
		tmp[1] = (char)(0x80 | (cp & 0x3f));
		n = 2;
	} else if (cp < 0x10000) {
		tmp[0] = (char)(0xe0 | (cp >> 12));
		tmp[1] = (char)(0x80 | ((cp >> 6) & 0x3f));
		tmp[2] = (char)(0x80 | (cp & 0x3f));
		n = 3;
	} else {
		tmp[0] = (char)(0xf0 | (cp >> 18));
		tmp[1] = (char)(0x80 | ((cp >> 12) & 0x3f));
		tmp[2] = (char)(0x80 | ((cp >> 6) & 0x3f));
		tmp[3] = (char)(0x80 | (cp & 0x3f));
		n = 4;
	}
	if (*len + n + 1 > *cap) {
		*cap = (*len + n + 1) * 2;
		*buf = (char *)xrealloc(*buf, *cap);
	}
	memcpy(*buf + *len, tmp, n);
	*len += n;
}

static int hex4(const char *p, unsigned *out) {
	unsigned v = 0;
	for (int i = 0; i < 4; i++) {
		char c = p[i];
		v <<= 4;
		if (c >= '0' && c <= '9') v |= (unsigned)(c - '0');
		else if (c >= 'a' && c <= 'f') v |= (unsigned)(c - 'a' + 10);
		else if (c >= 'A' && c <= 'F') v |= (unsigned)(c - 'A' + 10);
		else return 0;
	}
	*out = v;
	return 1;
}

static char *parse_string_raw(jparser *ps, size_t *out_len) {
	if (ps->p >= ps->end || *ps->p != '"') {
		ps->err = "expected a string";
		return NULL;
	}
	ps->p++;
	size_t cap = 16, len = 0;
	char *buf = (char *)xmalloc(cap);
	while (ps->p < ps->end && *ps->p != '"') {
		unsigned char c = (unsigned char)*ps->p;
		if (c == '\\') {
			ps->p++;
			if (ps->p >= ps->end) break;
			char e = *ps->p++;
			unsigned cp = 0;
			switch (e) {
			case '"': cp = '"'; break;
			case '\\': cp = '\\'; break;
			case '/': cp = '/'; break;
			case 'b': cp = '\b'; break;
			case 'f': cp = '\f'; break;
			case 'n': cp = '\n'; break;
			case 'r': cp = '\r'; break;
			case 't': cp = '\t'; break;
			case 'u':
				if (ps->end - ps->p < 4 || !hex4(ps->p, &cp)) {
					ps->err = "bad \\u escape";
					free(buf);
					return NULL;
				}
				ps->p += 4;
				if (cp >= 0xd800 && cp <= 0xdbff && ps->end - ps->p >= 6 && ps->p[0] == '\\' && ps->p[1] == 'u') {
					unsigned lo;
					if (hex4(ps->p + 2, &lo) && lo >= 0xdc00 && lo <= 0xdfff) {
						cp = 0x10000 + ((cp - 0xd800) << 10) + (lo - 0xdc00);
						ps->p += 6;
					}
				}
				break;
			default:
				ps->err = "bad escape";
				free(buf);
				return NULL;
			}
			put_utf8(&buf, &len, &cap, cp);
		} else {
			if (len + 2 > cap) {
				cap *= 2;
				buf = (char *)xrealloc(buf, cap);
			}
			buf[len++] = (char)c;
			ps->p++;
		}
	}
	if (ps->p >= ps->end) {
		ps->err = "unterminated string";
		free(buf);
		return NULL;
	}
	ps->p++;
	buf[len] = '\0';
	*out_len = len;
	return buf;
}

static jval *parse_value(jparser *ps, int depth);

static jval *parse_value(jparser *ps, int depth) {
	if (depth > 200) {
		ps->err = "nesting too deep";
		return NULL;
	}
	skip_ws(ps);
	if (ps->p >= ps->end) {
		ps->err = "unexpected end";
		return NULL;
	}
	char c = *ps->p;
	if (c == '{') {
		ps->p++;
		jval *o = jnew(J_OBJ);
		skip_ws(ps);
		if (ps->p < ps->end && *ps->p == '}') {
			ps->p++;
			return o;
		}
		for (;;) {
			skip_ws(ps);
			size_t klen;
			char *key = parse_string_raw(ps, &klen);
			if (!key) {
				jfree(o);
				return NULL;
			}
			skip_ws(ps);
			if (ps->p >= ps->end || *ps->p != ':') {
				ps->err = "expected ':'";
				free(key);
				jfree(o);
				return NULL;
			}
			ps->p++;
			jval *v = parse_value(ps, depth + 1);
			if (!v) {
				free(key);
				jfree(o);
				return NULL;
			}
			jpush(o, key, v);
			skip_ws(ps);
			if (ps->p < ps->end && *ps->p == ',') {
				ps->p++;
				continue;
			}
			if (ps->p < ps->end && *ps->p == '}') {
				ps->p++;
				return o;
			}
			ps->err = "expected ',' or '}'";
			jfree(o);
			return NULL;
		}
	}
	if (c == '[') {
		ps->p++;
		jval *a = jnew(J_ARR);
		skip_ws(ps);
		if (ps->p < ps->end && *ps->p == ']') {
			ps->p++;
			return a;
		}
		for (;;) {
			jval *v = parse_value(ps, depth + 1);
			if (!v) {
				jfree(a);
				return NULL;
			}
			jpush(a, NULL, v);
			skip_ws(ps);
			if (ps->p < ps->end && *ps->p == ',') {
				ps->p++;
				continue;
			}
			if (ps->p < ps->end && *ps->p == ']') {
				ps->p++;
				return a;
			}
			ps->err = "expected ',' or ']'";
			jfree(a);
			return NULL;
		}
	}
	if (c == '"') {
		jval *s = jnew(J_STR);
		s->s = parse_string_raw(ps, &s->slen);
		if (!s->s) {
			free(s);
			return NULL;
		}
		return s;
	}
	if (ps->end - ps->p >= 4 && strncmp(ps->p, "true", 4) == 0) {
		ps->p += 4;
		jval *v = jnew(J_BOOL);
		v->b = 1;
		return v;
	}
	if (ps->end - ps->p >= 5 && strncmp(ps->p, "false", 5) == 0) {
		ps->p += 5;
		return jnew(J_BOOL);
	}
	if (ps->end - ps->p >= 4 && strncmp(ps->p, "null", 4) == 0) {
		ps->p += 4;
		return jnew(J_NULL);
	}
	if (c == '-' || (c >= '0' && c <= '9')) {
		char *endp = NULL;
		double d = strtod(ps->p, &endp);
		if (endp == ps->p) {
			ps->err = "bad number";
			return NULL;
		}
		ps->p = endp;
		jval *v = jnew(J_NUM);
		v->n = d;
		return v;
	}
	ps->err = "unexpected character";
	return NULL;
}

static jval *jparse(const char *text, size_t len, const char **err) {
	jparser ps = {text, text + len, NULL};
	jval *v = parse_value(&ps, 0);
	if (v) {
		skip_ws(&ps);
		if (ps.p != ps.end) {
			jfree(v);
			v = NULL;
			ps.err = "trailing characters";
		}
	}
	if (err) *err = ps.err;
	return v;
}

/* ── writer ─────────────────────────────────────────────────────────────── */

typedef struct {
	char *d;
	size_t len, cap;
} sbuf;

static void sb_add(sbuf *b, const char *s, size_t n) {
	if (b->len + n + 1 > b->cap) {
		b->cap = (b->len + n + 1) * 2;
		b->d = (char *)xrealloc(b->d, b->cap);
	}
	memcpy(b->d + b->len, s, n);
	b->len += n;
	b->d[b->len] = '\0';
}

static void sb_str(sbuf *b, const char *s) { sb_add(b, s, strlen(s)); }

static void sb_quoted(sbuf *b, const char *s, size_t n) {
	sb_add(b, "\"", 1);
	for (size_t i = 0; i < n; i++) {
		unsigned char c = (unsigned char)s[i];
		char tmp[8];
		if (c == '"') sb_add(b, "\\\"", 2);
		else if (c == '\\') sb_add(b, "\\\\", 2);
		else if (c < 0x20) {
			snprintf(tmp, sizeof(tmp), "\\u%04x", c);
			sb_str(b, tmp);
		} else sb_add(b, (const char *)&s[i], 1);
	}
	sb_add(b, "\"", 1);
}

static void jwrite(sbuf *b, const jval *v) {
	char tmp[64];
	switch (v->t) {
	case J_NULL: sb_str(b, "null"); break;
	case J_BOOL: sb_str(b, v->b ? "true" : "false"); break;
	case J_NUM:
		if (v->n == floor(v->n) && fabs(v->n) < 1e15) snprintf(tmp, sizeof(tmp), "%.0f", v->n);
		else snprintf(tmp, sizeof(tmp), "%.17g", v->n);
		sb_str(b, tmp);
		break;
	case J_STR: sb_quoted(b, v->s, v->slen); break;
	case J_ARR:
		sb_str(b, "[");
		for (size_t i = 0; i < v->len; i++) {
			if (i) sb_str(b, ",");
			jwrite(b, v->items[i]);
		}
		sb_str(b, "]");
		break;
	case J_OBJ:
		sb_str(b, "{");
		for (size_t i = 0; i < v->len; i++) {
			if (i) sb_str(b, ",");
			sb_quoted(b, v->keys[i], strlen(v->keys[i]));
			sb_str(b, ":");
			jwrite(b, v->items[i]);
		}
		sb_str(b, "}");
		break;
	}
}

static jval *jclone(const jval *v) {
	jval *c = jnew(v->t);
	c->b = v->b;
	c->n = v->n;
	if (v->s) {
		c->s = (char *)xmalloc(v->slen + 1);
		memcpy(c->s, v->s, v->slen + 1);
		c->slen = v->slen;
	}
	for (size_t i = 0; i < v->len; i++) {
		char *k = NULL;
		if (v->t == J_OBJ) {
			k = (char *)xmalloc(strlen(v->keys[i]) + 1);
			strcpy(k, v->keys[i]);
		}
		jpush(c, k, jclone(v->items[i]));
	}
	return c;
}

/* ── the matcher (corebridge/tests/README.md; lockstep with tests/corebridge_cases.mjs) ── */

static int problems_printed;
static int problems_total;

static void problem(const char *where, const char *fmt, ...) {
	problems_total++;
	if (problems_printed >= 8) return;
	problems_printed++;
	va_list ap;
	va_start(ap, fmt);
	printf("         %s: ", where[0] ? where : "<root>");
	vprintf(fmt, ap);
	printf("\n");
	va_end(ap);
}

static const char *type_name(const jval *v) {
	if (!v) return "nothing";
	switch (v->t) {
	case J_NULL: return "null";
	case J_BOOL: return "boolean";
	case J_NUM: return "number";
	case J_STR: return "string";
	case J_ARR: return "array";
	case J_OBJ: return "object";
	}
	return "?";
}

static int is_operator(const jval *e) {
	if (!e || e->t != J_OBJ || e->len == 0) return 0;
	for (size_t i = 0; i < e->len; i++)
		if (e->keys[i][0] != '$') return 0;
	return 1;
}

/* Returns the number of mismatches; prints the first few when `report`. */
static int match(const jval *e, const jval *a, const char *where, int report);

static int deep_equal(const jval *e, const jval *a) {
	int saved_p = problems_printed, saved_t = problems_total;
	int n = match(e, a, "", 0);
	problems_printed = saved_p;
	problems_total = saved_t;
	return n == 0;
}

#define MISMATCH(...)                                \
	do {                                             \
		if (report) problem(where, __VA_ARGS__);     \
		return 1;                                    \
	} while (0)

static void child_path(char *out, size_t cap, const char *where, const char *key, long index) {
	if (key) snprintf(out, cap, "%s.%s", where[0] ? where : "<root>", key);
	else snprintf(out, cap, "%s[%ld]", where[0] ? where : "<root>", index);
}

static int match(const jval *e, const jval *a, const char *where, int report) {
	char path[1024];
	if (is_operator(e)) {
		const jval *op;
		if ((op = jget(e, "$subset"))) {
			if (!a || a->t != J_OBJ) MISMATCH("expected an object, got %s", type_name(a));
			int n = 0;
			for (size_t i = 0; i < op->len; i++) {
				const jval *sub = op->items[i];
				const jval *got = jget(a, op->keys[i]);
				child_path(path, sizeof(path), where, op->keys[i], 0);
				if (!got && !(is_operator(sub) && jget(sub, "$stacks"))) {
					if (report) problem(path, "missing");
					n++;
					continue;
				}
				n += match(sub, got, path, report);
			}
			return n;
		}
		if ((op = jget(e, "$approx"))) {
			const jval *tolv = jget(e, "$tol");
			double tol = tolv ? tolv->n : 1e-9;
			if (!a || a->t != J_NUM) MISMATCH("expected a number, got %s", type_name(a));
			if (fabs(a->n - op->n) > tol) MISMATCH("%.17g is not within %g of %.17g", a->n, tol, op->n);
			return 0;
		}
		if (jget(e, "$any")) {
			if (!a) MISMATCH("missing");
			return 0;
		}
		if ((op = jget(e, "$type"))) {
			if (strcmp(type_name(a), op->s) != 0) MISMATCH("expected type %s, got %s", op->s, type_name(a));
			return 0;
		}
		if ((op = jget(e, "$len"))) {
			long n = -1;
			if (a && a->t == J_ARR) n = (long)a->len;
			/* A string's length is counted in UTF-16 units by the JS leg; the
			 * corpus only takes $len of arrays, so a string here is refused. */
			if (n != (long)op->n) MISMATCH("expected length %g, got %ld (%s)", op->n, n, type_name(a));
			return 0;
		}
		if ((op = jget(e, "$ids"))) {
			const jval *keyv = jget(e, "$key");
			const char *key = keyv ? keyv->s : "id";
			if (!a || a->t != J_ARR) MISMATCH("expected an array, got %s", type_name(a));
			jval *ids = jnew(J_ARR);
			for (size_t i = 0; i < a->len; i++) {
				const jval *x = jget(a->items[i], key);
				jpush(ids, NULL, x ? jclone(x) : jnew(J_NULL));
			}
			int ok = deep_equal(op, ids);
			if (!ok && report) {
				sbuf b = {0};
				jwrite(&b, ids);
				problem(where, "%ss %s are not the expected list", key, b.d);
				free(b.d);
			}
			jfree(ids);
			return ok ? 0 : 1;
		}
		if ((op = jget(e, "$multiset"))) {
			if (!a || a->t != J_ARR) MISMATCH("expected an array, got %s", type_name(a));
			if (a->len != op->len) MISMATCH("expected %zu element(s) in any order, got %zu", op->len, a->len);
			char *used = (char *)xmalloc(a->len + 1);
			memset(used, 0, a->len + 1);
			for (size_t i = 0; i < op->len; i++) {
				size_t j;
				for (j = 0; j < a->len; j++)
					if (!used[j] && deep_equal(op->items[i], a->items[j])) break;
				if (j == a->len) {
					free(used);
					MISMATCH("no element matches expected element %zu", i);
				}
				used[j] = 1;
			}
			free(used);
			return 0;
		}
		if ((op = jget(e, "$stacks"))) {
			if (a && a->t != J_ARR) MISMATCH("expected an item array, got %s", type_name(a));
			jval *census = jnew(J_OBJ);
			for (size_t i = 0; a && i < a->len; i++) {
				const jval *id = jget(a->items[i], "itemId");
				const jval *q = jget(a->items[i], "quantity");
				if (!id || id->t != J_STR || !q || q->t != J_NUM) continue;
				jval *slot = jget(census, id->s);
				if (slot) slot->n += q->n;
				else {
					char *k = (char *)xmalloc(id->slen + 1);
					memcpy(k, id->s, id->slen + 1);
					jval *num = jnew(J_NUM);
					num->n = q->n;
					jpush(census, k, num);
				}
			}
			int ok = deep_equal(op, census);
			jfree(census);
			if (!ok) MISMATCH("item census differs from the expected stacks");
			return 0;
		}
		fprintf(stderr, "corebridge_cases: bad case — unknown matcher %s at %s\n", e->keys[0], where);
		exit(2);
	}
	if (e->t == J_ARR) {
		if (!a || a->t != J_ARR) MISMATCH("expected an array, got %s", type_name(a));
		if (a->len != e->len) MISMATCH("expected %zu element(s), got %zu", e->len, a->len);
		int n = 0;
		for (size_t i = 0; i < e->len; i++) {
			child_path(path, sizeof(path), where, NULL, (long)i);
			n += match(e->items[i], a->items[i], path, report);
		}
		return n;
	}
	if (e->t == J_OBJ) {
		if (!a || a->t != J_OBJ) MISMATCH("expected an object, got %s", type_name(a));
		int n = 0;
		for (size_t i = 0; i < a->len; i++) {
			if (!jget(e, a->keys[i])) {
				child_path(path, sizeof(path), where, a->keys[i], 0);
				if (report) problem(path, "unexpected key");
				n++;
			}
		}
		for (size_t i = 0; i < e->len; i++) {
			const jval *got = jget(a, e->keys[i]);
			child_path(path, sizeof(path), where, e->keys[i], 0);
			if (!got) {
				if (report) problem(path, "missing");
				n++;
				continue;
			}
			n += match(e->items[i], got, path, report);
		}
		return n;
	}
	if (!a || a->t != e->t) MISMATCH("expected %s, got %s", type_name(e), type_name(a));
	switch (e->t) {
	case J_NULL: return 0;
	case J_BOOL:
		if (e->b != a->b) MISMATCH("expected %s", e->b ? "true" : "false");
		return 0;
	case J_NUM:
		if (e->n != a->n) MISMATCH("expected %.17g, got %.17g", e->n, a->n);
		return 0;
	case J_STR:
		if (e->slen != a->slen || memcmp(e->s, a->s, e->slen) != 0) {
			MISMATCH("expected \"%.120s\", got \"%.120s\"", e->s, a->s);
		}
		return 0;
	default: return 0;
	}
}

/* ── $ref / $set ────────────────────────────────────────────────────────── */

typedef struct {
	char *name;
	jval *value;
} binding;

static binding bound[64];
static int nbound;

static void clear_bound(void) {
	for (int i = 0; i < nbound; i++) {
		free(bound[i].name);
		jfree(bound[i].value);
	}
	nbound = 0;
}

static jval *path_get(jval *v, const char *dotted) {
	char seg[256];
	const char *p = dotted;
	while (v && *p) {
		size_t n = strcspn(p, ".");
		if (n >= sizeof(seg)) return NULL;
		memcpy(seg, p, n);
		seg[n] = '\0';
		p += n;
		if (*p == '.') p++;
		if (v->t == J_OBJ) v = jget(v, seg);
		else if (v->t == J_ARR) {
			char *end;
			long i = strtol(seg, &end, 10);
			v = (*end == '\0' && i >= 0 && (size_t)i < v->len) ? v->items[i] : NULL;
		} else v = NULL;
	}
	return v;
}

static void bad_case(const char *where, const char *what) {
	fprintf(stderr, "corebridge_cases: bad case %s — %s\n", where, what);
	exit(2);
}

static jval *resolve_refs(const jval *v, const char *where) {
	if (v->t == J_OBJ) {
		const jval *ref = jget(v, "$ref");
		if (ref && ref->t == J_STR) {
			char name[256];
			size_t n = strcspn(ref->s, ".");
			if (n >= sizeof(name)) bad_case(where, "$ref name too long");
			memcpy(name, ref->s, n);
			name[n] = '\0';
			jval *base = NULL;
			for (int i = 0; i < nbound; i++)
				if (strcmp(bound[i].name, name) == 0) base = bound[i].value;
			if (!base) bad_case(where, "$ref names nothing bound");
			jval *target = ref->s[n] == '.' ? path_get(base, ref->s + n + 1) : base;
			if (!target) bad_case(where, "$ref path does not resolve");
			jval *out = jclone(target);
			const jval *set = jget(v, "$set");
			for (size_t i = 0; set && i < set->len; i++) {
				const char *dotted = set->keys[i];
				const char *last = strrchr(dotted, '.');
				jval *parent = out;
				char leaf[256];
				if (last) {
					char head[512];
					size_t hn = (size_t)(last - dotted);
					if (hn >= sizeof(head)) bad_case(where, "$set path too long");
					memcpy(head, dotted, hn);
					head[hn] = '\0';
					parent = path_get(out, head);
					snprintf(leaf, sizeof(leaf), "%s", last + 1);
				} else snprintf(leaf, sizeof(leaf), "%s", dotted);
				if (!parent || parent->t != J_OBJ) bad_case(where, "$set path does not resolve");
				int replaced = 0;
				for (size_t k = 0; k < parent->len; k++) {
					if (strcmp(parent->keys[k], leaf) == 0) {
						jfree(parent->items[k]);
						parent->items[k] = jclone(set->items[i]);
						replaced = 1;
					}
				}
				if (!replaced) {
					char *k = (char *)xmalloc(strlen(leaf) + 1);
					strcpy(k, leaf);
					jpush(parent, k, jclone(set->items[i]));
				}
			}
			return out;
		}
		jval *o = jnew(J_OBJ);
		for (size_t i = 0; i < v->len; i++) {
			char *k = (char *)xmalloc(strlen(v->keys[i]) + 1);
			strcpy(k, v->keys[i]);
			jpush(o, k, resolve_refs(v->items[i], where));
		}
		return o;
	}
	if (v->t == J_ARR) {
		jval *a = jnew(J_ARR);
		for (size_t i = 0; i < v->len; i++) jpush(a, NULL, resolve_refs(v->items[i], where));
		return a;
	}
	return jclone(v);
}

/* ── the run ────────────────────────────────────────────────────────────── */

static char *read_file(const char *path, size_t *len) {
	FILE *f = fopen(path, "rb");
	if (!f) return NULL;
	fseek(f, 0, SEEK_END);
	long n = ftell(f);
	fseek(f, 0, SEEK_SET);
	char *buf = (char *)xmalloc((size_t)n + 1);
	size_t got = fread(buf, 1, (size_t)n, f);
	fclose(f);
	buf[got] = '\0';
	*len = got;
	return buf;
}

static int cmp_str(const void *a, const void *b) { return strcmp(*(char *const *)a, *(char *const *)b); }

typedef struct {
	char **v;
	size_t n, cap;
} strlist;

static void sl_add(strlist *l, const char *s) {
	for (size_t i = 0; i < l->n; i++)
		if (strcmp(l->v[i], s) == 0) return;
	if (l->n == l->cap) {
		l->cap = l->cap ? l->cap * 2 : 16;
		l->v = (char **)xrealloc(l->v, l->cap * sizeof(char *));
	}
	l->v[l->n] = (char *)xmalloc(strlen(s) + 1);
	strcpy(l->v[l->n++], s);
}

static int sl_has(const strlist *l, const char *s) {
	for (size_t i = 0; i < l->n; i++)
		if (strcmp(l->v[i], s) == 0) return 1;
	return 0;
}

static int list_dir(const char *dir, strlist *out) {
	DIR *d = opendir(dir);
	if (!d) return -1;
	struct dirent *ent;
	size_t before = out->n;
	char path[4096];
	while ((ent = readdir(d))) {
		size_t n = strlen(ent->d_name);
		if (n > 5 && strcmp(ent->d_name + n - 5, ".json") == 0) {
			snprintf(path, sizeof(path), "%s/%s", dir, ent->d_name);
			sl_add(out, path);
		}
	}
	closedir(d);
	qsort(out->v + before, out->n - before, sizeof(char *), cmp_str);
	return (int)(out->n - before);
}

/* The repo-relative label the JS leg uses for a file (for parity records). */
static const char *label_of(const char *path) {
	const char *p = strstr(path, "corebridge/");
	return p ? p : path;
}

int main(int argc, char **argv) {
	if (argc < 3) {
		fprintf(stderr, "usage: insimulcore_cases <generated-case-dir> <hand-written-case-dir>\n");
		return 2;
	}
	strlist files = {0};
	for (int i = 1; i < argc; i++) {
		int n = list_dir(argv[i], &files);
		if (n < 0) {
			fprintf(stderr, "corebridge_cases: case directory missing: %s\n", argv[i]);
			return 2;
		}
		if (n == 0) {
			fprintf(stderr, "corebridge_cases: case directory holds no *.json: %s\n", argv[i]);
			return 2;
		}
	}
	const char *records_path = getenv("INSIMUL_CORE_CASES_JSON");
	FILE *records = NULL;
	if (records_path && *records_path) {
		records = fopen(records_path, "wb");
		if (!records) {
			fprintf(stderr, "corebridge_cases: cannot write %s\n", records_path);
			return 2;
		}
	}

	strlist called = {0};
	int n_cases = 0, n_steps = 0, failed = 0, js_only = 0;
	for (size_t fi = 0; fi < files.n; fi++) {
		size_t len;
		char *text = read_file(files.v[fi], &len);
		const char *err = NULL;
		jval *doc = text ? jparse(text, len, &err) : NULL;
		free(text);
		const jval *cases = doc ? jget(doc, "cases") : NULL;
		if (!cases || cases->t != J_ARR || cases->len == 0) {
			fprintf(stderr, "corebridge_cases: %s has no cases (%s)\n", files.v[fi], err ? err : "no `cases` array");
			return 2;
		}
		const char *rel = label_of(files.v[fi]);
		for (size_t ci = 0; ci < cases->len; ci++) {
			const jval *c = cases->items[ci];
			const jval *name = jget(c, "name");
			const jval *steps = jget(c, "steps");
			const jval *legs = jget(c, "legs");
			n_cases++;
			if (legs && legs->t == J_ARR) {
				int mine = 0;
				for (size_t k = 0; k < legs->len; k++)
					if (legs->items[k]->t == J_STR && strcmp(legs->items[k]->s, "c") == 0) mine = 1;
				if (!mine) {
					printf("  [JS-ONLY] %s :: %s\n", rel, name ? name->s : "?");
					js_only++;
					for (size_t si = 0; steps && si < steps->len; si++) {
						const jval *call = jget(steps->items[si], "call");
						if (call && call->t == J_STR) sl_add(&called, call->s);
					}
					continue;
				}
			}
			insimul_core *core = insimul_core_create();
			if (!core) {
				fprintf(stderr, "corebridge_cases: insimul_core_create() failed\n");
				return 2;
			}
			int case_failed = 0;
			for (size_t si = 0; steps && si < steps->len; si++) {
				const jval *step = steps->items[si];
				const jval *call = jget(step, "call");
				if (!call || call->t != J_STR) bad_case(rel, "a step without `call`");
				n_steps++;
				sl_add(&called, call->s);
				char where[1024];
				snprintf(where, sizeof(where), "%s :: %s :: step %zu (%s)", rel, name ? name->s : "?", si, call->s);

				sbuf args = {0};
				const jval *args_text = jget(step, "argsText");
				if (args_text && args_text->t == J_STR) {
					sb_add(&args, args_text->s, args_text->slen);
				} else {
					const jval *a = jget(step, "args");
					if (a) {
						jval *resolved = resolve_refs(a, where);
						jwrite(&args, resolved);
						jfree(resolved);
					} else sb_str(&args, "{}");
				}
				const char *res = insimul_core_call(core, call->s, args.d ? args.d : "");
				free(args.d);
				const char *last = insimul_core_last_error(core);

				if (records) {
					sbuf r = {0};
					sb_str(&r, "{\"file\":");
					sb_quoted(&r, rel, strlen(rel));
					sb_str(&r, ",\"case\":");
					sb_quoted(&r, name ? name->s : "", name ? name->slen : 0);
					char num[32];
					snprintf(num, sizeof(num), ",\"step\":%zu", si);
					sb_str(&r, num);
					sb_str(&r, ",\"method\":");
					sb_quoted(&r, call->s, call->slen);
					sb_str(&r, res ? ",\"ok\":true,\"raw\":" : ",\"ok\":false");
					if (res) sb_quoted(&r, res, strlen(res));
					sb_str(&r, "}\n");
					fwrite(r.d, 1, r.len, records);
					free(r.d);
				}

				const jval *expect_error = jget(step, "expectError");
				const jval *expect = jget(step, "expect");
				const jval *bind = jget(step, "bind");
				problems_printed = 0;
				problems_total = 0;
				int bad = 0;
				if (expect_error) {
					if (res) {
						printf("  [FAIL] %s\n         expected an error containing \"%s\", got %.200s\n", where, expect_error->s, res);
						bad = 1;
					} else if (!strstr(last, expect_error->s)) {
						printf("  [FAIL] %s\n         error \"%s\" lacks \"%s\"\n", where, last, expect_error->s);
						bad = 1;
					}
				} else if (!res) {
					printf("  [FAIL] %s\n         call failed: %s\n", where, last);
					bad = 1;
				} else {
					const char *perr = NULL;
					jval *value = jparse(res, strlen(res), &perr);
					if (!value) {
						printf("  [FAIL] %s\n         result is not JSON (%s)\n", where, perr ? perr : "?");
						bad = 1;
					} else {
						if (expect) {
							int saved_printed = problems_printed;
							(void)saved_printed;
							if (match(expect, value, "", 0) != 0) {
								printf("  [FAIL] %s\n", where);
								problems_printed = 0;
								problems_total = 0;
								match(expect, value, "", 1);
								if (problems_total > problems_printed)
									printf("         … %d more\n", problems_total - problems_printed);
								bad = 1;
							}
						}
						if (bind && bind->t == J_STR && nbound < 64) {
							bound[nbound].name = (char *)xmalloc(bind->slen + 1);
							memcpy(bound[nbound].name, bind->s, bind->slen + 1);
							bound[nbound].value = value;
							nbound++;
							value = NULL;
						}
						jfree(value);
					}
				}
				if (bad) case_failed = 1;
			}
			clear_bound();
			insimul_core_destroy(core);
			if (case_failed) failed++;
		}
		jfree(doc);
	}
	if (records) fclose(records);
	if (n_steps == 0) {
		fprintf(stderr, "corebridge_cases: executed no step\n");
		return 2;
	}

	/* The table against the corpus, from C. */
	int surface_bad = 0;
	insimul_core *core = insimul_core_create();
	const char *methods_json = core ? insimul_core_call(core, "core.methods", NULL) : NULL;
	jval *methods_doc = methods_json ? jparse(methods_json, strlen(methods_json), NULL) : NULL;
	const jval *methods = methods_doc ? jget(methods_doc, "methods") : NULL;
	if (!methods || methods->t != J_ARR || methods->len == 0) {
		fprintf(stderr, "corebridge_cases: core.methods returned no table\n");
		return 2;
	}
	strlist table = {0};
	for (size_t i = 0; i < methods->len; i++) {
		sl_add(&table, methods->items[i]->s);
		if (!sl_has(&called, methods->items[i]->s)) {
			printf("  [FAIL] surface: method %s is called by no case\n", methods->items[i]->s);
			surface_bad++;
		}
	}
	for (size_t i = 0; i < called.n; i++) {
		if (!sl_has(&table, called.v[i]) && strcmp(called.v[i], "no.such.method") != 0) {
			printf("  [FAIL] surface: a case calls %s, which is not in the table\n", called.v[i]);
			surface_bad++;
		}
	}
	size_t n_methods = methods->len;
	jfree(methods_doc);
	insimul_core_destroy(core);

	printf("corebridge_cases(c): %zu files, %d cases, %d steps, %d passed, %d failed, %d JS-only; %zu methods, all covered: %s\n",
			files.n, n_cases, n_steps, n_cases - failed - js_only, failed, js_only, n_methods, surface_bad ? "NO" : "yes");
	return failed == 0 && surface_bad == 0 ? 0 : 1;
}
