// p9a_corpus.cpp — core's P9a corpora, run through libinsimulcore.
//
// P9a.native (rulings U84, U79(4)). Three of core's P9a corpus runners are rows of
// corebridge/js/entry.js:
//
//   genre-hud    conformance/ui/genre-hud-cases.json     ui.genreHud    runGenreHudOp
//   rules-panel  conformance/ui/rules-panel-cases.json   ui.rulesPanel  runRulesPanelOp
//   mechanics    conformance/modules/mechanic-runtime.json  mechanics.run  runMechanicRuntimeCase
//
// This gate holds each row to the corpus core itself is held to, COPIED byte for
// byte into corebridge/vendor/core/conformance/ at the pin and sha256-checked by
// the `core_vendor` ctest. Nothing here re-writes a case.
//
// For every case: build the row's args from the case — `{ "op": <op>, ...input }`
// for the two UI corpora (`{ name, op, input, expected }`), the case's `input`
// (`{ ir, seed, steps }`) for the mechanic runtime — call the row through
// insimulcore.h, and compare by the corpora's own rule: exactly the `expected`
// JSON (objects with exactly the same keys, arrays in order, numbers equal as
// doubles, strings byte for byte). The corpora pin core's domain refusals as
// VALUES (`{ ok: false, refusal: { code, field } }`), so no case expects an error.
//
// It also fails when the method table lacks one of the rows a file needs, when a
// file holds no case or is not the corpus its kind names, when a UI corpus
// declares an op (`ops`) no case exercises, when a UI case's input already has an
// `op` key, and when its comparator cannot tell a wrong answer from a right one
// (a self-test on every start).
//
// A pure consumer of insimulcore.h (no quickjs.h, no insimul.h). The JSON reader
// is tests/radiant/json_value.{h,cpp}, used as is.
//
// usage: insimulcore_p9a <kind>=<corpus.json>...
//   kind is genre-hud, rules-panel or mechanics.

#include "insimulcore.h"
#include "radiant/json_value.h"

#include <chrono>
#include <cstdio>
#include <cstring>
#include <fstream>
#include <set>
#include <sstream>
#include <string>
#include <vector>

using insimul::JsonType;
using insimul::JsonValue;

namespace {

struct Kind {
	const char *name;    // the command-line kind
	const char *method;  // the row
	const char *area;    // the corpus file's `area`, or nullptr (mechanic-runtime.json has none)
	bool op_cases;       // `{ name, op, input, expected }` cases, sent as `{ op, ...input }`
};

const Kind kKinds[] = {
    {"genre-hud", "ui.genreHud", "ui-genre-hud", true},
    {"rules-panel", "ui.rulesPanel", "ui-rules-panel", true},
    {"mechanics", "mechanics.run", nullptr, false},
};

std::string read_file(const std::string &path, bool &ok) {
	std::ifstream in(path, std::ios::binary);
	if (!in) {
		ok = false;
		return {};
	}
	std::ostringstream ss;
	ss << in.rdbuf();
	ok = true;
	return ss.str();
}

// ── writing JSON (the case's input, sent as the row's args) ───────────────────

void write_string(std::string &out, const std::string &s) {
	out += '"';
	for (unsigned char c : s) {
		switch (c) {
		case '"': out += "\\\""; break;
		case '\\': out += "\\\\"; break;
		case '\b': out += "\\b"; break;
		case '\f': out += "\\f"; break;
		case '\n': out += "\\n"; break;
		case '\r': out += "\\r"; break;
		case '\t': out += "\\t"; break;
		default:
			if (c < 0x20) {
				char buf[8];
				std::snprintf(buf, sizeof buf, "\\u%04x", c);
				out += buf;
			} else {
				out += static_cast<char>(c);
			}
		}
	}
	out += '"';
}

void write_json(std::string &out, const JsonValue &v) {
	switch (v.type) {
	case JsonType::Null: out += "null"; return;
	case JsonType::Bool: out += v.bool_value ? "true" : "false"; return;
	case JsonType::Number: out += v.raw_number; return;
	case JsonType::String: write_string(out, v.string_value); return;
	case JsonType::Array:
		out += '[';
		for (std::size_t i = 0; i < v.array_items.size(); i++) {
			if (i) out += ',';
			write_json(out, *v.array_items[i]);
		}
		out += ']';
		return;
	case JsonType::Object:
		out += '{';
		for (std::size_t i = 0; i < v.object_items.size(); i++) {
			if (i) out += ',';
			write_string(out, v.object_items[i].first);
			out += ':';
			write_json(out, *v.object_items[i].second);
		}
		out += '}';
		return;
	}
}

// ── comparing (the corpora's rule: exact, key sets included) ──────────────────

const char *kind_of(const JsonValue &v) {
	switch (v.type) {
	case JsonType::Null: return "null";
	case JsonType::Bool: return "boolean";
	case JsonType::Number: return "number";
	case JsonType::String: return "string";
	case JsonType::Array: return "array";
	case JsonType::Object: return "object";
	}
	return "?";
}

// Empty when `actual` is exactly `expected`; otherwise where and how it differs.
std::string compare(const JsonValue &expected, const JsonValue &actual, const std::string &path) {
	if (expected.type != actual.type) {
		return path + ": expected a " + kind_of(expected) + ", got a " + kind_of(actual);
	}
	switch (expected.type) {
	case JsonType::Null: return {};
	case JsonType::Bool:
		return expected.bool_value == actual.bool_value ? std::string() : path + ": boolean differs";
	case JsonType::String:
		return expected.string_value == actual.string_value
		           ? std::string()
		           : path + ": \"" + expected.string_value + "\" != \"" + actual.string_value + "\"";
	case JsonType::Number:
		return expected.number_value == actual.number_value ? std::string()
		                                                    : path + ": " + expected.raw_number + " != " + actual.raw_number;
	case JsonType::Array: {
		if (expected.array_items.size() != actual.array_items.size()) {
			return path + ": length " + std::to_string(expected.array_items.size()) + " != " +
			       std::to_string(actual.array_items.size());
		}
		for (std::size_t k = 0; k < expected.array_items.size(); k++) {
			std::string why = compare(*expected.array_items[k], *actual.array_items[k], path + "[" + std::to_string(k) + "]");
			if (!why.empty()) return why;
		}
		return {};
	}
	case JsonType::Object: {
		for (const auto &kv : actual.object_items) {
			if (!expected.find(kv.first)) return path + ": unexpected key '" + kv.first + "'";
		}
		for (const auto &kv : expected.object_items) {
			const JsonValue *a = actual.find(kv.first);
			if (!a) return path + ": missing key '" + kv.first + "'";
			std::string why = compare(*kv.second, *a, path + "." + kv.first);
			if (!why.empty()) return why;
		}
		return {};
	}
	}
	return {};
}

// The comparator is the gate; it must be able to fail.
bool self_test() {
	auto parse = [](const char *t) { return insimul::parse_json(t).root; };
	struct Probe {
		const char *expected, *actual;
		bool agree;
	} probes[] = {
	    {"{\"a\":1,\"b\":[true,\"x\"]}", "{\"b\":[true,\"x\"],\"a\":1.0}", true},
	    {"{\"ok\":false,\"refusal\":{\"code\":\"unknown_genre\",\"field\":\"genre\"}}",
	     "{\"ok\":false,\"refusal\":{\"code\":\"unknown_layout\",\"field\":\"genre\"}}", false},
	    {"{\"a\":1}", "{\"a\":1.0000001}", false},
	    {"{\"a\":1}", "{\"a\":1,\"b\":null}", false},
	    {"{\"a\":1,\"b\":null}", "{\"a\":1}", false},
	    {"[1,2]", "[2,1]", false},
	    {"[1,2]", "[1,2,3]", false},
	    {"\"a\"", "\"b\"", false},
	    {"false", "0", false},
	    {"true", "false", false},
	    {"null", "{}", false},
	    {"{\"x\":{\"y\":true}}", "{\"x\":{\"y\":false}}", false},
	};
	bool ok = true;
	for (const Probe &p : probes) {
		auto e = parse(p.expected);
		auto a = parse(p.actual);
		bool agree = e && a && compare(*e, *a, "$").empty();
		if (agree != p.agree) {
			std::printf("  [FAIL] comparator self-test: %s vs %s should %s\n", p.expected, p.actual, p.agree ? "agree" : "differ");
			ok = false;
		}
	}
	return ok;
}

const Kind *kind_named(const std::string &name) {
	for (const Kind &k : kKinds) {
		if (name == k.name) return &k;
	}
	return nullptr;
}

} // namespace

int main(int argc, char **argv) {
	if (argc < 2) {
		std::fprintf(stderr, "usage: insimulcore_p9a <genre-hud|rules-panel|mechanics>=<corpus.json>...\n");
		return 2;
	}
	if (!self_test()) {
		std::fprintf(stderr, "p9a_corpus: the comparator cannot tell a wrong answer from a right one\n");
		return 2;
	}

	insimul_core *core = insimul_core_create();
	if (!core) {
		std::fprintf(stderr, "p9a_corpus: insimul_core_create() failed\n");
		return 2;
	}
	std::printf("p9a_corpus: %s\n", insimul_core_version());

	// The surface: the rows the files need must be in the table (a missing row
	// would otherwise show only as every case failing with "unknown method").
	std::set<std::string> table;
	{
		const char *m = insimul_core_call(core, "core.methods", nullptr);
		auto doc = m ? insimul::parse_json(m).root : nullptr;
		const JsonValue *list = doc ? doc->find("methods") : nullptr;
		if (list && list->is_array()) {
			for (const auto &x : list->array_items) table.insert(x->as_string());
		}
	}

	int files = 0, cases = 0, failed = 0;
	std::set<std::string> missing_rows;
	for (int ai = 1; ai < argc; ai++) {
		const std::string arg = argv[ai];
		const std::size_t eq = arg.find('=');
		const Kind *kind = eq == std::string::npos ? nullptr : kind_named(arg.substr(0, eq));
		if (!kind) {
			std::fprintf(stderr, "p9a_corpus: '%s' is not <genre-hud|rules-panel|mechanics>=<file>\n", arg.c_str());
			return 2;
		}
		const std::string file = arg.substr(eq + 1);
		bool ok = false;
		const std::string text = read_file(file, ok);
		auto parsed = insimul::parse_json(text);
		if (!ok || !parsed.ok || !parsed.root->is_object()) {
			std::fprintf(stderr, "p9a_corpus: cannot read %s: %s\n", file.c_str(), parsed.error.c_str());
			return 2;
		}
		const JsonValue &doc = *parsed.root;
		// The file must be the corpus its kind names: a UI corpus by its `area`, the
		// mechanic runtime's by its `caseFormat` 1 (it has no `area`).
		if (kind->area ? doc.get_string("area") != kind->area
		               : !(doc.find("caseFormat") && doc.find("caseFormat")->number_value == 1 && !doc.find("area"))) {
			std::fprintf(stderr, "p9a_corpus: %s is not the %s corpus\n", file.c_str(), kind->name);
			return 2;
		}
		const JsonValue *case_list = doc.find("cases");
		if (!case_list || !case_list->is_array() || case_list->size() == 0) {
			std::fprintf(stderr, "p9a_corpus: %s holds no case\n", file.c_str());
			return 2;
		}
		const bool has_row = table.count(kind->method) > 0;
		if (!has_row && missing_rows.insert(kind->method).second) {
			std::printf("  [FAIL] surface: the method table has no %s row\n", kind->method);
		}
		files++;
		int file_failed = 0;
		std::set<std::string> ops_seen;
		const auto t0 = std::chrono::steady_clock::now();
		for (const auto &cp : case_list->array_items) {
			const JsonValue &c = *cp;
			const std::string name = c.get_string("name");
			cases++;
			const JsonValue *input = c.find("input");
			const JsonValue *expected = c.find("expected");
			if (!input || !input->is_object() || !expected) {
				std::printf("  [FAIL] %s :: %s — needs an input object and an expected answer\n", file.c_str(), name.c_str());
				file_failed++;
				continue;
			}
			std::string args;
			if (kind->op_cases) {
				const JsonValue *op = c.find("op");
				if (!op || !op->is_string() || input->find("op")) {
					std::printf("  [FAIL] %s :: %s — needs a string op and an input with no `op` key\n", file.c_str(),
					            name.c_str());
					file_failed++;
					continue;
				}
				ops_seen.insert(op->as_string());
				args = "{\"op\":";
				write_string(args, op->as_string());
				std::string rest;
				write_json(rest, *input); // "{…}"
				if (rest.size() > 2) args += "," + rest.substr(1);
				else args += "}";
			} else {
				write_json(args, *input);
			}

			const char *raw = insimul_core_call(core, kind->method, args.c_str());
			if (!raw) {
				std::printf("  [FAIL] %s :: %s — %s failed: %s\n", file.c_str(), name.c_str(), kind->method,
				            insimul_core_last_error(core));
				file_failed++;
				continue;
			}
			auto actual = insimul::parse_json(raw);
			if (!actual.ok) {
				std::printf("  [FAIL] %s :: %s — %s answered unparseable JSON\n", file.c_str(), name.c_str(), kind->method);
				file_failed++;
				continue;
			}
			const std::string why = compare(*expected, *actual.root, "$");
			if (!why.empty()) {
				std::printf("  [FAIL] %s :: %s — %s\n", file.c_str(), name.c_str(), why.c_str());
				file_failed++;
			}
		}
		// A UI corpus declares its ops; every one must be exercised, or the row
		// could drop an op and stay green.
		if (kind->op_cases) {
			const JsonValue *ops = doc.find("ops");
			if (!ops || !ops->is_array() || ops->size() == 0) {
				std::printf("  [FAIL] %s — declares no `ops`\n", file.c_str());
				file_failed++;
			} else {
				for (const auto &o : ops->array_items) {
					if (!ops_seen.count(o->as_string())) {
						std::printf("  [FAIL] %s — op %s is declared but no case exercises it\n", file.c_str(),
						            o->as_string().c_str());
						file_failed++;
					}
				}
			}
		}
		const double ms = std::chrono::duration<double, std::milli>(std::chrono::steady_clock::now() - t0).count();
		std::printf("  %s %s via %s: %zu case(s), %d failed, %.0f ms\n", file_failed ? "[FAIL]" : "[ ok ]", file.c_str(),
		            kind->method, case_list->size(), file_failed, ms);
		failed += file_failed;
	}
	insimul_core_destroy(core);

	if (cases == 0) {
		std::fprintf(stderr, "p9a_corpus: executed no case\n");
		return 2;
	}
	std::printf("p9a_corpus: %d file(s), %d case(s), %d failed; %zu row(s) missing\n", files, cases, failed,
	            missing_rows.size());
	if (failed || !missing_rows.empty()) {
		std::printf("p9a_corpus: FAIL\n");
		return 1;
	}
	std::printf("p9a_corpus: PASS\n");
	return 0;
}
