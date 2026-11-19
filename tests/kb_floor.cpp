// kb_floor.cpp — the `kb_floor` ctest (PL.native-consult-floor-leak).
//
// Replays tests/kb-floor/cases.json against libinsimul's C ABI and measures the
// process heap the allocator reports in use (macOS: the default malloc zone;
// glibc: mallinfo2's uordblks) across N cycles, after W warm-up cycles. The
// first KB a process creates also opens libinsimul's engine keepalive (leak
// L-01, src/engine_trealla.c), which is deliberately never freed: the warm-up
// runs first, so the keepalive and every one-time engine initialisation are
// outside the measured window. Each case states a per-cycle bound.
//
// Two modes, chosen by the case:
//   cycle mode  (no `ops`):  insimul_kb_create -> insimul_kb_consult(program)
//                            -> insimul_kb_destroy, per cycle;
//   held mode   (`ops`):     one KB, created and consulted before the warm-up,
//                            and per cycle each op (`assert`, `retract`,
//                            `query`) on it.
// Templates expand `{i}` (clause index) and `{cycle}` (cycle number, counted
// from 0 across warm-up and measured cycles alike, so a `{cycle}` program never
// repeats an atom).
//
// A case with `perNewAtom` is a DECLARED upstream residue, not a native one: its
// program mints `newAtomsPerCycle` atoms the process has never seen, and the
// bound is stated per new atom — with a floor (`min`), so the declaration fails
// loudly the day the engine stops keeping them and has to be rewritten.
//
// usage: insimul_kb_floor <cases.json>
#include "insimul.h"
#include "radiant/json_value.h"

#include <cstdio>
#include <fstream>
#include <sstream>
#include <string>

#if defined(__APPLE__)
#include <malloc/malloc.h>
static long long heap_in_use() {
	malloc_statistics_t s;
	malloc_zone_statistics(nullptr, &s);
	return (long long)s.size_in_use;
}
static const char *kHeapSource = "malloc_zone_statistics(default zone).size_in_use";
#elif defined(__GLIBC__)
#include <malloc.h>
static long long heap_in_use() { return (long long)mallinfo2().uordblks; }
static const char *kHeapSource = "mallinfo2().uordblks";
#else
#error "kb_floor needs an allocator that reports bytes in use (CMakeLists.txt registers it only where one does)"
#endif

using insimul::JsonValue;

static std::string replace_all(std::string s, const std::string &from, const std::string &to) {
	for (size_t at = s.find(from); at != std::string::npos; at = s.find(from, at + to.size())) s.replace(at, from.size(), to);
	return s;
}

static std::string expand(const JsonValue *spec, long cycle) {
	if (!spec) return "";
	if (spec->is_string()) return replace_all(spec->string_value, "{cycle}", std::to_string(cycle));
	std::string tpl = spec->get_string("template");
	long long count = spec->get_int("count");
	std::string out;
	for (long long i = 0; i < count; i++) {
		std::string line = replace_all(replace_all(tpl, "{i}", std::to_string(i)), "{cycle}", std::to_string(cycle));
		out += line;
		out += '\n';
	}
	return out;
}

static bool run_ops(insimul_kb *kb, const JsonValue *ops, long cycle, std::string &err) {
	for (const auto &op : ops->array_items) {
		std::string text;
		if (const JsonValue *a = op->find("assert")) {
			text = replace_all(a->string_value, "{i}", std::to_string(cycle));
			if (insimul_kb_assert(kb, text.c_str()) != 0) { err = "assert " + text + ": " + insimul_last_error(kb); return false; }
		} else if (const JsonValue *r = op->find("retract")) {
			text = replace_all(r->string_value, "{i}", std::to_string(cycle));
			if (insimul_kb_retract(kb, text.c_str()) < 0) { err = "retract " + text + ": " + insimul_last_error(kb); return false; }
		} else if (const JsonValue *q = op->find("query")) {
			text = replace_all(q->string_value, "{i}", std::to_string(cycle));
			insimul_query *it = insimul_query_start(kb, text.c_str());
			if (!it) { err = "query " + text + ": " + insimul_last_error(kb); return false; }
			while (insimul_query_next(it)) {
			}
			insimul_query_stop(it);
		} else {
			err = "an op names none of assert / retract / query";
			return false;
		}
	}
	return true;
}

static bool one_cycle(const JsonValue &c, insimul_kb *held, long cycle, std::string &err) {
	if (held) return run_ops(held, c.find("ops"), cycle, err);
	insimul_kb *kb = insimul_kb_create();
	if (!kb) { err = "insimul_kb_create failed"; return false; }
	std::string program = expand(c.find("program"), cycle);
	bool ok = program.empty() || insimul_kb_consult(kb, program.c_str()) == 0;
	if (!ok) err = std::string("consult: ") + insimul_last_error(kb);
	insimul_kb_destroy(kb);
	return ok;
}

int main(int argc, char **argv) {
	if (argc != 2) {
		std::fprintf(stderr, "usage: %s <cases.json>\n", argv[0]);
		return 2;
	}
	std::ifstream in(argv[1], std::ios::binary);
	std::stringstream buf;
	buf << in.rdbuf();
	insimul::JsonParseResult parsed = insimul::parse_json(buf.str());
	if (!in || !parsed.ok) {
		std::fprintf(stderr, "kb_floor: cannot read %s: %s\n", argv[1], parsed.error.c_str());
		return 2;
	}
	const JsonValue *cases = parsed.root->find("cases");
	if (!cases || cases->size() == 0) {
		std::fprintf(stderr, "kb_floor: %s holds no cases — an empty corpus is a failure, not a pass\n", argv[1]);
		return 1;
	}
	std::printf("kb_floor: heap measured as %s\n", kHeapSource);
	int failed = 0;
	for (const auto &cp : cases->array_items) {
		const JsonValue &c = *cp;
		const std::string name = c.get_string("name");
		const long warmup = (long)c.get_int("warmup", 3);
		const long cycles = (long)c.get_int("cycles");
		std::string err;
		insimul_kb *held = nullptr;
		if (c.find("ops")) {
			held = insimul_kb_create();
			std::string program = expand(c.find("program"), 0);
			if (!held || (!program.empty() && insimul_kb_consult(held, program.c_str()) != 0)) {
				std::printf("[FAIL] %s — the held KB did not load\n", name.c_str());
				failed++;
				continue;
			}
		}
		long cycle = 0;
		bool ok = true;
		for (long w = 0; ok && w < warmup; w++) ok = one_cycle(c, held, cycle++, err);
		const long long before = heap_in_use();
		for (long n = 0; ok && n < cycles; n++) ok = one_cycle(c, held, cycle++, err);
		const long long after = heap_in_use();
		if (held) insimul_kb_destroy(held);
		if (!ok || cycles <= 0) {
			std::printf("[FAIL] %s — %s\n", name.c_str(), cycles <= 0 ? "no measured cycles" : err.c_str());
			failed++;
			continue;
		}
		const double per_cycle = (double)(after - before) / (double)cycles;
		std::string verdict;
		bool pass = true;
		if (const JsonValue *bound = c.find("maxBytesPerCycle")) {
			pass = per_cycle <= bound->as_number();
			char line[256];
			std::snprintf(line, sizeof line, "%.1f B per cycle over %ld cycle(s), bound %.0f", per_cycle, cycles, bound->as_number());
			verdict = line;
		}
		if (const JsonValue *atom = c.find("perNewAtom")) {
			const double atoms = (double)c.get_int("newAtomsPerCycle");
			const double per_atom = atoms > 0 ? per_cycle / atoms : -1;
			const double lo = atom->find("min") ? atom->find("min")->as_number() : 0;
			const double hi = atom->find("max") ? atom->find("max")->as_number() : 0;
			pass = atoms > 0 && per_atom >= lo && per_atom <= hi;
			char line[256];
			std::snprintf(line, sizeof line, "%.1f B per new atom (%.1f B per cycle, %.0f new atoms each), stated %.0f..%.0f",
					per_atom, per_cycle, atoms, lo, hi);
			verdict = line;
		}
		if (verdict.empty()) {
			pass = false;
			verdict = "the case states no bound (maxBytesPerCycle or perNewAtom)";
		}
		std::printf("[%s] %s — %s%s%s\n", pass ? "PASS" : "FAIL", name.c_str(), verdict.c_str(),
				c.find("declared") ? "; declared: " : "", c.find("declared") ? c.get_string("declared").c_str() : "");
		if (!pass) failed++;
	}
	std::printf("kb_floor: %zu case(s), %d failed\n", cases->size(), failed);
	return failed ? 1 : 0;
}
