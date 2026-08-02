// test_radiant_bridge.cpp — the radiant slice's host gate (US-2/US-3 of 100).
//
// Drives every case in conformance/radiant/*.json through the FULL adopted
// stack — libinsimulcore (QuickJS + the vendored @insimul/core bundle) over the
// natively linked libinsimul — and compares against the corpus's `expected`.
// These are the same vectors packages/core's own runner
// (src/conformance/__tests__/radiant-corpus.test.ts) executes, unreduced, and
// this file mirrors that runner's comparison rules exactly:
//
//   program        = kb ++ templates, joined with '\n'
//   quest order    = as emitted (deterministic sorted-TplId order)
//   content        = split on '\n', trimmed, blanks dropped, SORTED
//   factsToAssert  = SORTED
//   factsToRetract = SORTED
//
// A conforming engine may emit clauses within a quest in any order; it may NOT
// reorder the quests themselves.
//
// SELECTABLE IMPLEMENTATION (US-2's "the old one stays reachable"): `--source`
// picks which implementation answers.
//   --source core   the adopted implementation (default). Must match the corpus
//                   exactly; any difference is a failure.
//   --source none   this plugin's PRE-ADOPTION behaviour — it generated no
//                   radiant quests at all, so every case yields zero quests.
// The `none` leg is not a straw man: it is literally what shipped before this
// tasklist, and running it over the same vectors is how US-3 shows the adoption
// is a capability GAIN with no reachable regression. It mirrors
// InsimulRadiantSource.SOURCE_NONE in addons/insimul/runtime/radiant_source.gd.
//
// US-3's CLASSIFICATION (`--source none`). The `none` leg is expected NOT to
// match the corpus — that is the whole point — so instead of counting failures
// it classifies every case and asserts the classification:
//   AGREE  the corpus expects zero quests, and `none` produces zero
//   GAIN   the corpus expects quests, `none` produces none — pure new capability
//   REGRESSION  `none` produced a quest core does not, or a DIFFERENT one
// A regression is not constructible from an implementation that emits nothing,
// which is exactly why it is worth asserting rather than asserting by argument:
// the assertion is what will still be true after somebody edits this file.
//
// THE COUNT IS ASSERTED, NOT REPORTED. A corpus runner that silently executes
// nothing must fail — this repo has shipped gates that could not fail. So the
// gate requires the corpus files to be found, the case count to be non-zero and
// at least MIN_CASES, all five area files to be present, and case names to be
// unique. Then it compares.

#include "canonical_json.h"
#include "json_value.h"

extern "C" {
#include "insimulcore.h"
}

#include <algorithm>
#include <cstdio>
#include <cstring>
#include <dirent.h>
#include <fstream>
#include <set>
#include <sstream>
#include <string>
#include <vector>

using insimul::JsonValue;

// The corpus as vendored at adoption time: 5 files / 11 cases. Growing the
// corpus should not break the gate, shrinking it must.
static const int MIN_CASES = 11;
static const char *REQUIRED_AREAS[] = {
	"radiant-single-slot",
	"radiant-multi-slot",
	"radiant-exclusion-cooldown",
	"radiant-empty",
	"radiant-maxquests",
};

namespace {

int failures = 0;
int cases_run = 0;
int agree = 0, gain = 0, regression = 0;

void fail(const std::string &case_name, const std::string &what) {
	failures++;
	std::printf("  ✗ %s\n      %s\n", case_name.c_str(), what.c_str());
}

std::string read_file(const std::string &path, bool &ok) {
	std::ifstream in(path, std::ios::binary);
	if (!in) {
		ok = false;
		return std::string();
	}
	std::ostringstream ss;
	ss << in.rdbuf();
	ok = true;
	return ss.str();
}

std::vector<std::string> list_json_files(const std::string &dir) {
	std::vector<std::string> files;
	DIR *d = opendir(dir.c_str());
	if (!d) return files;
	while (struct dirent *e = readdir(d)) {
		std::string name(e->d_name);
		if (name.size() > 5 && name.compare(name.size() - 5, 5, ".json") == 0) {
			files.push_back(name);
		}
	}
	closedir(d);
	std::sort(files.begin(), files.end());
	return files;
}

std::string trim(const std::string &s) {
	size_t b = s.find_first_not_of(" \t\r\n");
	if (b == std::string::npos) return std::string();
	size_t e = s.find_last_not_of(" \t\r\n");
	return s.substr(b, e - b + 1);
}

/** Split quest content into clause lines, trimmed, blanks dropped, sorted. */
std::vector<std::string> norm_content(const std::string &content) {
	std::vector<std::string> lines;
	std::istringstream in(content);
	std::string line;
	while (std::getline(in, line)) {
		std::string t = trim(line);
		if (!t.empty()) lines.push_back(t);
	}
	std::sort(lines.begin(), lines.end());
	return lines;
}

/** Read a JSON string array into a sorted vector. */
std::vector<std::string> sorted_strings(const JsonValue *arr) {
	std::vector<std::string> out;
	if (arr && arr->is_array()) {
		for (const auto &item : arr->array_items) out.push_back(item->as_string());
	}
	std::sort(out.begin(), out.end());
	return out;
}

std::string join(const std::vector<std::string> &xs, const char *sep) {
	std::string out;
	for (size_t i = 0; i < xs.size(); i++) {
		if (i) out += sep;
		out += xs[i];
	}
	return out;
}

/**
 * Build the `radiant.generate` argument document.
 *
 * This is the whole of the "no engine type crosses into core" rule at the C
 * level: what goes across is a JSON object of strings and numbers. `seed` is
 * copied through with its corpus type intact (core accepts string OR number and
 * hashes a string), which is why the raw number lexeme is used rather than a
 * reformat.
 */
std::string build_args(const JsonValue &c) {
	const JsonValue *kb = c.find("kb");
	const JsonValue *templates = c.find("templates");
	std::vector<std::string> program;
	if (kb && kb->is_array()) {
		for (const auto &l : kb->array_items) program.push_back(l->as_string());
	}
	if (templates && templates->is_array()) {
		for (const auto &l : templates->array_items) program.push_back(l->as_string());
	}

	std::string args = "{\"kb\":";
	args += insimul::canonical_json_string(join(program, "\n"));
	args += ",\"options\":{\"seed\":";
	const JsonValue *seed = c.find("seed");
	if (seed && seed->is_number()) {
		args += insimul::canonical_number(seed->number_value, seed->raw_number);
	} else {
		args += insimul::canonical_json_string(seed ? seed->as_string() : std::string());
	}
	args += ",\"now\":";
	const JsonValue *now = c.find("now");
	args += now ? insimul::canonical_number(now->number_value, now->raw_number) : "0";
	const JsonValue *max_quests = c.find("maxQuests");
	if (max_quests && max_quests->is_number()) {
		args += ",\"maxQuests\":";
		args += insimul::canonical_number(max_quests->number_value, max_quests->raw_number);
	}
	args += "}}";
	return args;
}

/** One quest reduced to the corpus's comparable shape. */
struct Quest {
	std::string quest_id;
	std::string template_id;
	std::vector<std::string> content;
	std::vector<std::string> assert_facts;
	std::vector<std::string> retract_facts;

	bool operator==(const Quest &o) const {
		return quest_id == o.quest_id && template_id == o.template_id && content == o.content &&
				assert_facts == o.assert_facts && retract_facts == o.retract_facts;
	}

	std::string describe() const {
		std::string s = quest_id + " [" + template_id + "]";
		s += "\n        content:  " + join(content, " | ");
		s += "\n        assert:   " + join(assert_facts, " | ");
		s += "\n        retract:  " + join(retract_facts, " | ");
		return s;
	}
};

std::vector<Quest> expected_quests(const JsonValue &c) {
	std::vector<Quest> out;
	const JsonValue *expected = c.find("expected");
	const JsonValue *quests = expected ? expected->find("quests") : nullptr;
	if (!quests || !quests->is_array()) return out;
	for (const auto &q : quests->array_items) {
		Quest quest;
		quest.quest_id = q->get_string("questId");
		quest.template_id = q->get_string("templateId");
		quest.content = sorted_strings(q->find("content"));
		quest.assert_facts = sorted_strings(q->find("factsToAssert"));
		quest.retract_facts = sorted_strings(q->find("factsToRetract"));
		out.push_back(quest);
	}
	return out;
}

/** Decode `{"quests":[...]}` as returned by core across the ABI. */
bool decode_result(const std::string &json, std::vector<Quest> &out, std::string &error) {
	insimul::JsonParseResult parsed = insimul::parse_json(json);
	if (!parsed.ok || !parsed.root) {
		error = "core returned malformed JSON: " + parsed.error;
		return false;
	}
	const JsonValue *quests = parsed.root->find("quests");
	if (!quests || !quests->is_array()) {
		error = "core result has no `quests` array";
		return false;
	}
	for (const auto &q : quests->array_items) {
		Quest quest;
		quest.quest_id = q->get_string("questId");
		quest.template_id = q->get_string("templateId");
		quest.content = norm_content(q->get_string("questContent"));
		quest.assert_facts = sorted_strings(q->find("factsToAssert"));
		quest.retract_facts = sorted_strings(q->find("factsToRetract"));
		out.push_back(quest);
	}
	return true;
}

void compare(const std::string &name, const std::vector<Quest> &actual, const std::vector<Quest> &expected) {
	if (actual.size() != expected.size()) {
		std::string msg = "expected " + std::to_string(expected.size()) + " quest(s), got " +
				std::to_string(actual.size());
		for (const auto &q : actual) msg += "\n      actual:   " + q.describe();
		for (const auto &q : expected) msg += "\n      expected: " + q.describe();
		fail(name, msg);
		return;
	}
	for (size_t i = 0; i < actual.size(); i++) {
		if (!(actual[i] == expected[i])) {
			fail(name, "quest " + std::to_string(i) + " differs\n      actual:   " + actual[i].describe() +
							"\n      expected: " + expected[i].describe());
			return;
		}
	}
	std::printf("  ✓ %s (%zu quest(s))\n", name.c_str(), actual.size());
}

/**
 * Classify one case for the pre-adoption (`none`) leg instead of failing it.
 *
 * The claim being machine-checked is "the adoption is a strict capability gain":
 * the pre-adoption implementation must produce NOTHING wherever core produces
 * something, and must never produce a quest of its own.
 */
void classify_none(const std::string &name, const std::vector<Quest> &actual,
		const std::vector<Quest> &expected) {
	if (!actual.empty()) {
		regression++;
		failures++;
		std::printf("  ✗ %s  REGRESSION — the pre-adoption leg produced %zu quest(s)\n", name.c_str(),
				actual.size());
		return;
	}
	if (expected.empty()) {
		agree++;
		std::printf("  = %s  AGREE (corpus expects no quests)\n", name.c_str());
		return;
	}
	gain++;
	std::printf("  + %s  GAIN — core produces %zu quest(s) where this engine produced none\n",
			name.c_str(), expected.size());
}

} // namespace

int main(int argc, char **argv) {
	std::string corpus_dir;
	std::string source = "core";
	for (int i = 1; i < argc; i++) {
		if (std::strcmp(argv[i], "--source") == 0 && i + 1 < argc) {
			source = argv[++i];
		} else if (corpus_dir.empty()) {
			corpus_dir = argv[i];
		}
	}
#ifdef INSIMUL_RADIANT_DIR
	if (corpus_dir.empty()) corpus_dir = INSIMUL_RADIANT_DIR;
#endif
	if (corpus_dir.empty()) {
		std::fprintf(stderr, "usage: test_radiant_bridge [--source core|none] <conformance/radiant dir>\n");
		return 2;
	}
	if (source != "core" && source != "none") {
		std::fprintf(stderr, "error: --source must be 'core' or 'none', got '%s'\n", source.c_str());
		return 2;
	}

	std::vector<std::string> files = list_json_files(corpus_dir);
	if (files.empty()) {
		std::fprintf(stderr, "error: no corpus files under %s — the gate executed NOTHING\n", corpus_dir.c_str());
		return 1;
	}

	insimul_core *core = nullptr;
	if (source == "core") {
		core = insimul_core_create();
		if (!core) {
			std::fprintf(stderr, "error: insimul_core_create() failed — the core bridge could not start\n");
			return 1;
		}
		std::printf("libinsimulcore %s\n", insimul_core_version());

		// The adopted surface, asserted rather than assumed: a bundle that lost
		// radiant.generate must fail here, not silently return zero quests.
		const char *methods = insimul_core_call(core, "core.methods", nullptr);
		if (!methods) {
			std::fprintf(stderr, "error: core.methods failed: %s\n", insimul_core_last_error(core));
			insimul_core_destroy(core);
			return 1;
		}
		std::printf("adopted surface: %s\n", methods);
		if (std::string(methods).find("radiant.generate") == std::string::npos) {
			std::fprintf(stderr, "error: the bundle does not expose radiant.generate\n");
			insimul_core_destroy(core);
			return 1;
		}
	}

	std::printf("Radiant conformance corpus (%s) — source=%s\n", corpus_dir.c_str(), source.c_str());

	std::set<std::string> areas;
	std::set<std::string> names;
	for (const std::string &file : files) {
		bool ok = false;
		std::string text = read_file(corpus_dir + "/" + file, ok);
		if (!ok) {
			std::fprintf(stderr, "error: could not read %s\n", file.c_str());
			failures++;
			continue;
		}
		insimul::JsonParseResult parsed = insimul::parse_json(text);
		if (!parsed.ok || !parsed.root) {
			std::fprintf(stderr, "error: %s is not valid JSON: %s\n", file.c_str(), parsed.error.c_str());
			failures++;
			continue;
		}
		areas.insert(parsed.root->get_string("area"));
		const JsonValue *cases = parsed.root->find("cases");
		if (!cases || !cases->is_array()) {
			std::fprintf(stderr, "error: %s has no `cases` array\n", file.c_str());
			failures++;
			continue;
		}
		std::printf("%s (%s)\n", file.c_str(), parsed.root->get_string("area").c_str());
		for (const auto &c : cases->array_items) {
			const std::string name = c->get_string("name");
			if (!names.insert(name).second) {
				std::fprintf(stderr, "error: duplicate case name '%s'\n", name.c_str());
				failures++;
			}
			cases_run++;

			std::vector<Quest> actual;
			if (source == "core") {
				const std::string args = build_args(*c);
				const char *result = insimul_core_call(core, "radiant.generate", args.c_str());
				if (!result) {
					fail(name, std::string("radiant.generate failed: ") + insimul_core_last_error(core));
					continue;
				}
				std::string error;
				if (!decode_result(result, actual, error)) {
					fail(name, error);
					continue;
				}
			}
			// source == "none": actual stays empty — the pre-adoption behaviour.
			if (source == "none") {
				classify_none(name, actual, expected_quests(*c));
			} else {
				compare(name, actual, expected_quests(*c));
			}
		}
	}

	if (core) insimul_core_destroy(core);

	// ── the gate cannot pass without having executed something ───────────────
	std::printf("\n%d case(s) executed from %zu corpus file(s)\n", cases_run, files.size());
	if (cases_run == 0) {
		std::fprintf(stderr, "error: the gate executed ZERO cases\n");
		return 1;
	}
	if (cases_run < MIN_CASES) {
		std::fprintf(stderr, "error: only %d case(s) executed, expected at least %d — the corpus shrank\n",
				cases_run, MIN_CASES);
		failures++;
	}
	for (const char *required : REQUIRED_AREAS) {
		if (areas.find(required) == areas.end()) {
			std::fprintf(stderr, "error: missing corpus area '%s'\n", required);
			failures++;
		}
	}

	if (source == "none") {
		const int classified = agree + gain + regression;
		std::printf("classification: %d AGREE, %d GAIN, %d REGRESSION\n", agree, gain, regression);
		if (classified != cases_run) {
			std::fprintf(stderr, "error: %d case(s) executed but only %d classified\n", cases_run,
					classified);
			failures++;
		}
		if (gain == 0) {
			std::fprintf(stderr,
					"error: ZERO cases classified as GAIN — either the corpus expects nothing anywhere "
					"or this leg is not comparing what it claims to\n");
			failures++;
		}
	}

	if (failures > 0) {
		std::printf("FAILED: %d\n", failures);
		return 1;
	}
	std::printf("PASSED: %d case(s), all %zu areas\n", cases_run, areas.size());
	return 0;
}
