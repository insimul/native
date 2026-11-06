// packs_corpus.cpp — core's pack-composition corpus, run through libinsimulcore.
//
// SP.composer-native (SP.composer-unreal part 1; rulings U62(1), U79(4)). Core's
// composer (`src/system-packs/composer.ts`, `resolveComposition(request,
// catalog)`) is adopted by libinsimulcore as the `packs.compose` row of
// corebridge/js/entry.js. This gate holds that row to the corpus core itself is
// held to: `conformance/packs/composition.json`, and the pack catalog its
// `catalog` names (`packs/index.json` and each `packs/<id>/pack.json`), all
// COPIED byte for byte into corebridge/vendor/core/ at the pin and sha256-checked
// by the `core_vendor` ctest. Nothing here re-writes a case.
//
// For every case: send the case's `input` with the catalog beside it
// (`{ ...input, "catalog": { "index": …, "manifests": [ … ] } }`) to
// `packs.compose` through insimulcore.h, and compare by the rule core's own
// replay test uses (`composition.test.ts`, "replays"): an `expected` case must
// answer exactly that JSON (objects with exactly the same keys, arrays in order,
// numbers equal as doubles, strings byte for byte); an `expectedError` case must
// FAIL, and last_error must carry core's code the way the bridge writes it —
// `insimulcore: CompositionError: [<code>] …` or
// `insimulcore: GenreResolutionError: [<code>] …` (the two error classes the
// corpus's description names).
//
// It also fails when the method table has no `packs.compose` row, when a file
// holds no case, when a case has neither or both of `expected` and
// `expectedError`, and when its comparator cannot tell a wrong answer from a
// right one (a self-test on every start).
//
// A pure consumer of insimulcore.h (no quickjs.h, no insimul.h). The JSON reader
// is tests/radiant/json_value.{h,cpp}, used as is.
//
// usage: insimulcore_packs <catalog-root> <composition.json>...
//   <catalog-root> is the directory the corpus's `catalog` paths are relative to
//   (corebridge/vendor/core, where the copies sit at core's own paths).

#include "insimulcore.h"
#include "radiant/json_value.h"

#include <chrono>
#include <cstdio>
#include <cstring>
#include <fstream>
#include <sstream>
#include <string>
#include <vector>

using insimul::JsonType;
using insimul::JsonValue;

namespace {

const char *const kSchema = "insimul.pack-composition-cases/1";
const char *const kMethod = "packs.compose";

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

// ── comparing (core's replay rule: toEqual after a JSON round trip) ───────────

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

// The error rule: last_error names one of core's two coded error classes and
// carries exactly `code` in brackets right after it. Empty when it does.
std::string error_differs(const std::string &code, const std::string &last_error) {
	for (const char *name : {"CompositionError", "GenreResolutionError"}) {
		const std::string want = std::string("insimulcore: ") + name + ": [" + code + "] ";
		if (last_error.compare(0, want.size(), want) == 0) return {};
	}
	return "wanted core's [" + code + "] refusal, got: " + last_error;
}

// The comparator and the error rule are the gate; they must be able to fail.
bool self_test() {
	auto parse = [](const char *t) { return insimul::parse_json(t).root; };
	struct Probe {
		const char *expected, *actual;
		bool agree;
	} probes[] = {
	    {"{\"a\":1,\"b\":[true,\"x\"]}", "{\"b\":[true,\"x\"],\"a\":1.0}", true},
	    {"{\"a\":1}", "{\"a\":1.0000001}", false},
	    {"{\"a\":1}", "{\"a\":1,\"b\":null}", false},
	    {"{\"a\":1,\"b\":null}", "{\"a\":1}", false},
	    {"[1,2]", "[2,1]", false},
	    {"[1,2]", "[1,2,3]", false},
	    {"\"a\"", "\"b\"", false},
	    {"false", "0", false},
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
	struct ErrProbe {
		const char *code, *last_error;
		bool agree;
	} errs[] = {
	    {"unknown-engine", "insimulcore: CompositionError: [unknown-engine] 'x' is not one of", true},
	    {"unknown-recipe", "insimulcore: GenreResolutionError: [unknown-recipe] unknown-recipe: x", true},
	    {"unknown-recipe", "insimulcore: CompositionError: [unknown-engine] 'x'", false},
	    {"unknown", "insimulcore: CompositionError: [unknown-engine] 'x'", false},
	    {"unknown-engine", "insimulcore: Error: insimulcore: packs.compose: [unknown-engine] ", false},
	    {"unknown-engine", "insimulcore: unknown method \"packs.compose\"", false},
	};
	for (const ErrProbe &p : errs) {
		if (error_differs(p.code, p.last_error).empty() != p.agree) {
			std::printf("  [FAIL] error-rule self-test: [%s] vs \"%s\" should %s\n", p.code, p.last_error,
			            p.agree ? "agree" : "differ");
			ok = false;
		}
	}
	return ok;
}

// The corpus's `catalog` as the JSON object the row takes: { index, manifests },
// each file's text read from <root>/<its path> and parsed (so it is sent as
// JSON, not as a string). Empty and `why` set when it cannot be read.
std::string catalog_json(const JsonValue &doc, const std::string &root, std::string &why) {
	const JsonValue *cat = doc.find("catalog");
	const JsonValue *index = cat ? cat->find("index") : nullptr;
	const JsonValue *manifests = cat ? cat->find("manifests") : nullptr;
	if (!index || !index->is_string() || !manifests || !manifests->is_array() || manifests->size() == 0) {
		why = "no catalog { index, manifests } naming its files";
		return {};
	}
	auto one = [&](const std::string &rel, std::string &out) {
		if (rel.empty() || rel[0] == '/' || rel.find("..") != std::string::npos) {
			why = "catalog path '" + rel + "' is not a plain relative path";
			return false;
		}
		bool ok = false;
		const std::string text = read_file(root + "/" + rel, ok);
		auto parsed = insimul::parse_json(text);
		if (!ok || !parsed.ok || !parsed.root->is_object()) {
			why = "cannot read catalog file " + root + "/" + rel;
			return false;
		}
		write_json(out, *parsed.root);
		return true;
	};
	std::string out = "{\"index\":";
	if (!one(index->as_string(), out)) return {};
	out += ",\"manifests\":[";
	for (std::size_t i = 0; i < manifests->array_items.size(); i++) {
		if (i) out += ',';
		if (!one(manifests->array_items[i]->as_string(), out)) return {};
	}
	out += "]}";
	return out;
}

} // namespace

int main(int argc, char **argv) {
	if (argc < 3) {
		std::fprintf(stderr, "usage: insimulcore_packs <catalog-root> <composition.json>...\n");
		return 2;
	}
	const std::string root = argv[1];
	if (!self_test()) {
		std::fprintf(stderr, "packs_corpus: the comparator cannot tell a wrong answer from a right one\n");
		return 2;
	}

	insimul_core *core = insimul_core_create();
	if (!core) {
		std::fprintf(stderr, "packs_corpus: insimul_core_create() failed\n");
		return 2;
	}
	std::printf("packs_corpus: %s\n", insimul_core_version());

	// The surface: the row must be in the table (a missing row would otherwise
	// show only as every case failing with "unknown method").
	bool has_row = false;
	{
		const char *m = insimul_core_call(core, "core.methods", nullptr);
		auto doc = m ? insimul::parse_json(m).root : nullptr;
		const JsonValue *list = doc ? doc->find("methods") : nullptr;
		if (list && list->is_array()) {
			for (const auto &x : list->array_items) has_row = has_row || x->as_string() == kMethod;
		}
	}
	if (!has_row) std::printf("  [FAIL] surface: the method table has no %s row\n", kMethod);

	int files = 0, cases = 0, failed = 0;
	for (int fi = 2; fi < argc; fi++) {
		const std::string file = argv[fi];
		bool ok = false;
		const std::string text = read_file(file, ok);
		auto parsed = insimul::parse_json(text);
		if (!ok || !parsed.ok || !parsed.root->is_object()) {
			std::fprintf(stderr, "packs_corpus: cannot read %s: %s\n", file.c_str(), parsed.error.c_str());
			return 2;
		}
		const JsonValue &doc = *parsed.root;
		if (doc.get_string("schema") != kSchema) {
			std::fprintf(stderr, "packs_corpus: %s is not %s (schema '%s')\n", file.c_str(), kSchema,
			             doc.get_string("schema").c_str());
			return 2;
		}
		const JsonValue *case_list = doc.find("cases");
		if (!case_list || !case_list->is_array() || case_list->size() == 0) {
			std::fprintf(stderr, "packs_corpus: %s holds no case\n", file.c_str());
			return 2;
		}
		std::string why;
		const std::string catalog = catalog_json(doc, root, why);
		if (catalog.empty()) {
			std::fprintf(stderr, "packs_corpus: %s: %s\n", file.c_str(), why.c_str());
			return 2;
		}
		files++;
		int file_failed = 0;
		const auto t0 = std::chrono::steady_clock::now();
		for (const auto &cp : case_list->array_items) {
			const JsonValue &c = *cp;
			const std::string name = c.get_string("name");
			cases++;
			const JsonValue *input = c.find("input");
			const JsonValue *expected = c.find("expected");
			const JsonValue *expected_error = c.find("expectedError");
			if (!input || !input->is_object() || (expected == nullptr) == (expected_error == nullptr)) {
				std::printf("  [FAIL] %s :: %s — needs an input object and exactly one of expected, expectedError\n",
				            file.c_str(), name.c_str());
				file_failed++;
				continue;
			}
			if (input->find("catalog")) {
				std::printf("  [FAIL] %s :: %s — the input already has a `catalog` key\n", file.c_str(), name.c_str());
				file_failed++;
				continue;
			}
			std::string args;
			write_json(args, *input);
			args.pop_back(); // the closing '}'
			if (!input->object_items.empty()) args += ',';
			args += "\"catalog\":" + catalog + "}";

			const char *raw = insimul_core_call(core, kMethod, args.c_str());
			if (expected_error) {
				const std::string code = expected_error->get_string("code");
				if (raw) {
					std::printf("  [FAIL] %s :: %s — expected core's [%s] refusal, but the call answered\n", file.c_str(),
					            name.c_str(), code.c_str());
					file_failed++;
					continue;
				}
				why = error_differs(code, insimul_core_last_error(core));
				if (!why.empty()) {
					std::printf("  [FAIL] %s :: %s — %s\n", file.c_str(), name.c_str(), why.c_str());
					file_failed++;
				}
				continue;
			}
			if (!raw) {
				std::printf("  [FAIL] %s :: %s — %s failed: %s\n", file.c_str(), name.c_str(), kMethod,
				            insimul_core_last_error(core));
				file_failed++;
				continue;
			}
			auto actual = insimul::parse_json(raw);
			if (!actual.ok) {
				std::printf("  [FAIL] %s :: %s — %s answered unparseable JSON\n", file.c_str(), name.c_str(), kMethod);
				file_failed++;
				continue;
			}
			why = compare(*expected, *actual.root, "$");
			if (!why.empty()) {
				std::printf("  [FAIL] %s :: %s — %s\n", file.c_str(), name.c_str(), why.c_str());
				file_failed++;
			}
		}
		const double ms = std::chrono::duration<double, std::milli>(std::chrono::steady_clock::now() - t0).count();
		std::printf("  %s %s: %zu case(s), %d failed, %.0f ms\n", file_failed ? "[FAIL]" : "[ ok ]", file.c_str(),
		            case_list->size(), file_failed, ms);
		failed += file_failed;
	}
	insimul_core_destroy(core);

	if (cases == 0) {
		std::fprintf(stderr, "packs_corpus: executed no case\n");
		return 2;
	}
	std::printf("packs_corpus: %d file(s), %d case(s), %d failed; %s row %s\n", files, cases, failed, kMethod,
	            has_row ? "present" : "MISSING");
	if (failed || !has_row) {
		std::printf("packs_corpus: FAIL\n");
		return 1;
	}
	std::printf("packs_corpus: PASS\n");
	return 0;
}
