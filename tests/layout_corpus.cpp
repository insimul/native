// layout_corpus.cpp — core's village-layout corpus, run through libinsimulcore.
//
// L.native-layout (ruling U36). Core's layout rules (`src/editor/layout/`, and
// its composition rules under `composition/`) are adopted by libinsimulcore as
// the `layout.*` rows of corebridge/js/entry.js. This gate holds them to the
// corpus core itself is held to: `conformance/layout/*.json` and
// `conformance/layout-composition/*.json`, COPIED byte for byte into
// corebridge/vendor/core/conformance/ at the pin and sha256-checked by the
// `core_vendor` ctest. Nothing here re-writes a case.
//
// For every case of every file: resolve `{"$fixture": name}` from the file's
// fixtures (a fixture may name another), send the resolved `input` as the
// args of `layout.<op>` through insimulcore.h, and compare the answer with
// `expected` by the corpus's rule (core's `compareLayout`, implemented here
// independently): numbers within the case's `tolerance` or else the file's, a
// number under a key in the file's `angleKeys` compared round the circle,
// everything else exactly, objects with exactly the same keys.
//
// The surface, when every file of both corpora is run (no --only):
//   - the `layout.*` rows (less `layout.ops`) are exactly `layout.` + core's
//     LAYOUT_OPS and COMPOSITION_OPS, as `layout.ops` reports them;
//   - every op a case names is a row, and every row is named by some case.
//
// A pure consumer of insimulcore.h (no quickjs.h, no insimul.h). The JSON
// reader is tests/radiant/json_value.{h,cpp}, used as is.
//
// usage: insimulcore_layout [--only <file-substring>] <corpus-dir>...

#include "insimulcore.h"
#include "radiant/json_value.h"

#include <algorithm>
#include <chrono>
#include <cmath>
#include <cstdio>
#include <cstring>
#include <dirent.h>
#include <fstream>
#include <map>
#include <set>
#include <sstream>
#include <string>
#include <vector>

using insimul::JsonType;
using insimul::JsonValue;
using insimul::JsonValuePtr;

namespace {

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

std::vector<std::string> json_files(const std::string &dir) {
	std::vector<std::string> out;
	DIR *d = opendir(dir.c_str());
	if (!d) return out;
	while (dirent *e = readdir(d)) {
		std::string n = e->d_name;
		if (n.size() > 5 && n.compare(n.size() - 5, 5, ".json") == 0) out.push_back(dir + "/" + n);
	}
	closedir(d);
	std::sort(out.begin(), out.end());
	return out;
}

// ── writing JSON (the resolved input) ─────────────────────────────────────────

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

// `v` with every {"$fixture": name} replaced by that fixture, resolved again
// (a fixture may name another). `depth` stops a fixture that names itself.
bool write_resolved(std::string &out, const JsonValue &v, const JsonValue *fixtures, std::string &why, int depth = 0) {
	if (depth > 32) {
		why = "fixtures nest more than 32 deep (a fixture names itself?)";
		return false;
	}
	switch (v.type) {
	case JsonType::Null: out += "null"; return true;
	case JsonType::Bool: out += v.bool_value ? "true" : "false"; return true;
	case JsonType::Number: out += v.raw_number; return true;
	case JsonType::String: write_string(out, v.string_value); return true;
	case JsonType::Array:
		out += '[';
		for (std::size_t i = 0; i < v.array_items.size(); i++) {
			if (i) out += ',';
			if (!write_resolved(out, *v.array_items[i], fixtures, why, depth)) return false;
		}
		out += ']';
		return true;
	case JsonType::Object:
		if (v.object_items.size() == 1 && v.object_items[0].first == "$fixture") {
			const std::string name = v.object_items[0].second->as_string();
			const JsonValue *f = fixtures ? fixtures->find(name) : nullptr;
			if (!f) {
				why = "unknown fixture '" + name + "'";
				return false;
			}
			return write_resolved(out, *f, fixtures, why, depth + 1);
		}
		out += '{';
		for (std::size_t i = 0; i < v.object_items.size(); i++) {
			if (i) out += ',';
			write_string(out, v.object_items[i].first);
			out += ':';
			if (!write_resolved(out, *v.object_items[i].second, fixtures, why, depth)) return false;
		}
		out += '}';
		return true;
	}
	return true;
}

// ── comparing (the corpus's rule) ─────────────────────────────────────────────

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

std::string num_text(double d) {
	char buf[40];
	std::snprintf(buf, sizeof buf, "%.17g", d);
	return buf;
}

// Empty when `actual` agrees with `expected`; otherwise where and how it differs.
std::string compare(const JsonValue &expected, const JsonValue &actual, double tol, const std::set<std::string> &angle_keys,
                    const std::string &path, bool angle) {
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
	case JsonType::Number: {
		double d = actual.number_value - expected.number_value;
		if (angle) d -= 2.0 * M_PI * std::round(d / (2.0 * M_PI));
		// A NaN difference fails here (NaN <= tol is false), as it does in core's compareLayout.
		if (std::fabs(d) <= tol) return {};
		return path + ": " + expected.raw_number + " != " + num_text(actual.number_value) + " (tolerance " + num_text(tol) +
		       (angle ? ", round the circle)" : ")");
	}
	case JsonType::Array: {
		if (expected.array_items.size() != actual.array_items.size()) {
			return path + ": length " + std::to_string(expected.array_items.size()) + " != " +
			       std::to_string(actual.array_items.size());
		}
		for (std::size_t k = 0; k < expected.array_items.size(); k++) {
			std::string why = compare(*expected.array_items[k], *actual.array_items[k], tol, angle_keys,
			                          path + "[" + std::to_string(k) + "]", angle);
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
			std::string why = compare(*kv.second, *a, tol, angle_keys, path + "." + kv.first, angle_keys.count(kv.first) > 0);
			if (!why.empty()) return why;
		}
		return {};
	}
	}
	return {};
}

// The comparator is the gate; it must be able to fail. Run on every start.
bool comparator_self_test() {
	auto parse = [](const char *t) { return insimul::parse_json(t).root; };
	const std::set<std::string> angles = {"heading"};
	struct Probe {
		const char *expected, *actual;
		double tol;
		bool agree;
	} probes[] = {
	    {"{\"x\":1}", "{\"x\":1.0000005}", 1e-6, true},
	    {"{\"x\":1}", "{\"x\":1.000002}", 1e-6, false},
	    {"{\"heading\":3.14159}", "{\"heading\":-3.1415953071795862}", 1e-6, true},
	    {"{\"x\":3.14159}", "{\"x\":-3.1415953071795862}", 1e-6, false},
	    {"{\"heading\":{\"x\":3.14159}}", "{\"heading\":{\"x\":-3.1415953071795862}}", 1e-6, false},
	    {"{\"heading\":[3.14159]}", "{\"heading\":[-3.1415953071795862]}", 1e-6, true},
	    {"{\"a\":1}", "{\"a\":1,\"b\":2}", 1e-6, false},
	    {"{\"a\":1,\"b\":2}", "{\"a\":1}", 1e-6, false},
	    {"[1,2]", "[1,2,3]", 1e-6, false},
	    {"\"a\"", "\"b\"", 1e-6, false},
	    {"false", "0", 1e-6, false},
	    {"null", "null", 1e-6, true},
	    {"true", "false", 1e-6, false},
	};
	bool ok = true;
	for (const Probe &p : probes) {
		auto e = parse(p.expected);
		auto a = parse(p.actual);
		bool agree = e && a && compare(*e, *a, p.tol, angles, "$", false).empty();
		if (agree != p.agree) {
			std::printf("  [FAIL] comparator self-test: %s vs %s should %s\n", p.expected, p.actual, p.agree ? "agree" : "differ");
			ok = false;
		}
	}
	return ok;
}

std::vector<std::string> string_list(const JsonValue *v) {
	std::vector<std::string> out;
	if (v && v->is_array()) {
		for (const auto &x : v->array_items) out.push_back(x->as_string());
	}
	return out;
}

} // namespace

int main(int argc, char **argv) {
	std::string only;
	std::vector<std::string> dirs;
	for (int i = 1; i < argc; i++) {
		if (std::strcmp(argv[i], "--only") == 0 && i + 1 < argc) {
			only = argv[++i];
		} else {
			dirs.push_back(argv[i]);
		}
	}
	if (dirs.empty()) {
		std::fprintf(stderr, "usage: insimulcore_layout [--only <file-substring>] <corpus-dir>...\n");
		return 2;
	}
	if (!comparator_self_test()) {
		std::fprintf(stderr, "layout_corpus: the comparator cannot tell a wrong answer from a right one\n");
		return 2;
	}

	insimul_core *core = insimul_core_create();
	if (!core) {
		std::fprintf(stderr, "layout_corpus: insimul_core_create() failed\n");
		return 2;
	}
	std::printf("layout_corpus: %s\n", insimul_core_version());

	// The surface: the table's layout.* rows and core's own op lists.
	std::set<std::string> rows;
	{
		const char *m = insimul_core_call(core, "core.methods", nullptr);
		auto doc = m ? insimul::parse_json(m).root : nullptr;
		for (const std::string &name : string_list(doc ? doc->find("methods") : nullptr)) {
			if (name.rfind("layout.", 0) == 0 && name != "layout.ops") rows.insert(name);
		}
	}
	std::set<std::string> core_ops;
	{
		const char *o = insimul_core_call(core, "layout.ops", nullptr);
		auto doc = o ? insimul::parse_json(o).root : nullptr;
		if (!doc) {
			std::fprintf(stderr, "layout_corpus: layout.ops failed: %s\n", insimul_core_last_error(core));
			return 2;
		}
		for (const char *list : {"layout", "composition"}) {
			for (const std::string &op : string_list(doc->find(list))) {
				if (!core_ops.insert("layout." + op).second) {
					std::printf("  [FAIL] surface: core names op %s twice across its two lists\n", op.c_str());
					return 1;
				}
			}
		}
	}

	int files = 0, cases = 0, failed = 0;
	std::set<std::string> named;
	std::map<std::string, int> per_dir;
	for (const std::string &dir : dirs) {
		std::vector<std::string> list = json_files(dir);
		if (list.empty()) {
			std::fprintf(stderr, "layout_corpus: %s holds no corpus file\n", dir.c_str());
			return 2;
		}
		for (const std::string &file : list) {
			if (!only.empty() && file.find(only) == std::string::npos) continue;
			bool ok = false;
			const std::string text = read_file(file, ok);
			auto parsed = insimul::parse_json(text);
			if (!ok || !parsed.ok || !parsed.root->is_object()) {
				std::fprintf(stderr, "layout_corpus: cannot read %s: %s\n", file.c_str(), parsed.error.c_str());
				return 2;
			}
			const JsonValue &doc = *parsed.root;
			const JsonValue *tol_v = doc.find("tolerance");
			const JsonValue *case_list = doc.find("cases");
			if (!tol_v || !tol_v->is_number() || !case_list || !case_list->is_array() || case_list->size() == 0) {
				std::fprintf(stderr, "layout_corpus: %s has no tolerance or no cases\n", file.c_str());
				return 2;
			}
			const double file_tol = tol_v->number_value;
			std::set<std::string> angle_keys;
			for (const std::string &k : string_list(doc.find("angleKeys"))) angle_keys.insert(k);
			const JsonValue *fixtures = doc.find("fixtures");
			files++;
			per_dir[dir]++;
			int file_failed = 0;
			const auto t0 = std::chrono::steady_clock::now();
			for (const auto &cp : case_list->array_items) {
				const JsonValue &c = *cp;
				const std::string name = c.get_string("name");
				const std::string method = "layout." + c.get_string("op");
				named.insert(method);
				cases++;
				const JsonValue *tol_c = c.find("tolerance");
				const double tol = tol_c && tol_c->is_number() ? tol_c->number_value : file_tol;
				if (tol > file_tol) {
					std::printf("  [FAIL] %s :: %s — states a tolerance looser than its file's\n", file.c_str(), name.c_str());
					file_failed++;
					continue;
				}
				const JsonValue *input = c.find("input");
				const JsonValue *expected = c.find("expected");
				if (!input || !expected) {
					std::printf("  [FAIL] %s :: %s — no input or no expected\n", file.c_str(), name.c_str());
					file_failed++;
					continue;
				}
				std::string args, why;
				if (!write_resolved(args, *input, fixtures, why)) {
					std::printf("  [FAIL] %s :: %s — %s\n", file.c_str(), name.c_str(), why.c_str());
					file_failed++;
					continue;
				}
				const char *raw = insimul_core_call(core, method.c_str(), args.c_str());
				if (!raw) {
					std::printf("  [FAIL] %s :: %s — %s failed: %s\n", file.c_str(), name.c_str(), method.c_str(),
					            insimul_core_last_error(core));
					file_failed++;
					continue;
				}
				auto actual = insimul::parse_json(raw);
				if (!actual.ok) {
					std::printf("  [FAIL] %s :: %s — %s answered unparseable JSON\n", file.c_str(), name.c_str(), method.c_str());
					file_failed++;
					continue;
				}
				why = compare(*expected, *actual.root, tol, angle_keys, "$", false);
				if (!why.empty()) {
					std::printf("  [FAIL] %s :: %s — %s\n", file.c_str(), name.c_str(), why.c_str());
					file_failed++;
				}
			}
			const double ms =
			    std::chrono::duration<double, std::milli>(std::chrono::steady_clock::now() - t0).count();
			std::printf("  %s %s: %zu case(s), %d failed, %.0f ms\n", file_failed ? "[FAIL]" : "[ ok ]", file.c_str(),
			            case_list->size(), file_failed, ms);
			failed += file_failed;
		}
	}

	int surface_bad = 0;
	if (!only.empty()) {
		std::printf("layout_corpus: --only %s, so the surface (rows against cases) was NOT checked\n", only.c_str());
	} else {
		for (const std::string &r : rows) {
			if (!core_ops.count(r)) {
				std::printf("  [FAIL] surface: row %s answers no op core declares\n", r.c_str());
				surface_bad++;
			}
			if (!named.count(r)) {
				std::printf("  [FAIL] surface: row %s is named by no case\n", r.c_str());
				surface_bad++;
			}
		}
		for (const std::string &op : core_ops) {
			if (!rows.count(op)) {
				std::printf("  [FAIL] surface: core declares %s, which is not a row\n", op.c_str());
				surface_bad++;
			}
		}
		for (const std::string &n : named) {
			if (!rows.count(n)) {
				std::printf("  [FAIL] surface: a case names %s, which is not a row\n", n.c_str());
				surface_bad++;
			}
		}
	}
	insimul_core_destroy(core);

	if (cases == 0) {
		std::fprintf(stderr, "layout_corpus: executed no case\n");
		return 2;
	}
	std::printf("layout_corpus: %d file(s), %d case(s), %d failed; %zu layout row(s), %d surface problem(s)\n", files, cases,
	            failed, rows.size(), surface_bad);
	if (failed || surface_bad) {
		std::printf("layout_corpus: FAIL\n");
		return 1;
	}
	std::printf("layout_corpus: PASS\n");
	return 0;
}
