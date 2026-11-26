// build_log_redaction_corpus.cpp — core's build-log redaction corpus, driven through
// libinsimulcore's `build.redactLogLine` and `build.redactLog` rows.
//
// PL.native-build-redact-rows (rulings U120, U115(11), U49(3) and U36). Core states
// what a headless build log redacts (PL.core-build-log-redaction:
// src/build/build-log-redaction.ts, docs/headless-build.md § "What a build log
// redacts"); the two rows of corebridge/js/entry.js run core's own functions. This
// gate holds them to core's own corpus, COPIED byte for byte into
// corebridge/vendor/core/conformance/headless-build/log-redaction.json at the pin
// (beside headless.json, one folder over from core's build/; sha256-checked by the
// `core_vendor` ctest; area build-log-redaction; ops redactLine, redactLog).
//
// Nothing here re-writes a case or computes an answer: every answer comes out of a
// row. Core's runner, src/build/build-log-redaction-corpus.ts, is the reference:
//
//   Every `<<secret:NAME>>` marker in a case's `input` (keys and values) is replaced
//   by the file's own `contract.secretFixtures[NAME]`, its parts joined with nothing
//   between them (core's expandSecretFixtures); then every `<<local:NAME>>` marker in
//   the input AND in the expectation by `contract.localFixtures[NAME]` joined (core's
//   expandLocalFixtures: the start of a home path, kept out of the file). An unknown
//   NAME fails the case. Then:
//   redactLine {line, context?}  → build.redactLogLine {line, context?}; `{ line }`.
//   redactLog  {lines, context?} → build.redactLog {log: lines, context?}; its
//                                  `{ log }` answered as the corpus's `{ lines }`.
//
// Three checks beside the cases, each answered by rows:
//
//   carried    every redactLog case is ALSO driven line by line through
//              build.redactLogLine with `state` carried from each answer to the next
//              line (what an engine runner streaming its tools' output does; the
//              corpus's rule "a runner carrying the state from line to line"), and
//              must answer the case's expected lines.
//   contract   `contract.secretKeyStandIn` is `build.contract`'s; every other stand-in
//              the contract names (homeStandIn, userStandIn, projectStandIn) is
//              counted in the expected lines (each must be pinned by at least one).
//   leaks      no line any row answers holds a credential: neither a fixture's joined
//              value nor a shape `build.looksLikeSecret` names (core's doc: "no line
//              that comes out holds a credential by looksLikeSecret's shapes").
//
// The order core states (credentials before paths; the usual home forms before the
// user-name segment) is pinned by the corpus's cases; tests/build_log_redaction_order.mjs
// swaps each order in the vendored bundle and requires this corpus to refuse it.
//
// A case op this runner does not know fails its case (never a skip). The run FAILS on
// a file whose area or op list is not core's (BUILD_LOG_REDACTION_CORPUS_OPS), on an op
// no case drives, on a row missing from the method table, on a session left open, and
// when its comparator, perturbation or marker expansion cannot fail (a self-test on
// every start). Comparison is the corpus's own rule: exact (tolerance 0), object key
// sets included.
//
// --negative perturbs EVERY case's expectation (its last leaf: a string + "!", an
// empty array given an element) and requires every case refused. It also perturbs on
// purpose, each required refused:
//   - a credential shown: a case whose input carries a credential, its expectation
//     replaced by its own (expanded) input, nothing redacted;
//   - a home path shown: a case whose input carries a local marker and whose answer
//     changes it, its expectation replaced by its own input;
//   - a private-key block let through: a redactLog case's withheld lines put back.
//
// A pure consumer of insimulcore.h (no quickjs.h, no insimul.h). The JSON reader is
// tests/radiant/json_value.{h,cpp}, used as is.
//
// usage: insimulcore_build_log_redaction_corpus [--negative] <log-redaction.json>

#include "insimulcore.h"
#include "radiant/json_value.h"

#include <chrono>
#include <cmath>
#include <cstdio>
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

// ── writing JSON (the rows' args) ─────────────────────────────────────────────

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

std::string json_of(const JsonValue &v) {
	std::string out;
	write_json(out, v);
	return out;
}

// ── building values ───────────────────────────────────────────────────────────

using Items = std::vector<std::pair<std::string, JsonValuePtr>>;

JsonValuePtr make_object(Items items) {
	auto v = std::make_shared<JsonValue>();
	v->type = JsonType::Object;
	v->object_items = std::move(items);
	return v;
}

JsonValuePtr make_array(std::vector<JsonValuePtr> items) {
	auto v = std::make_shared<JsonValue>();
	v->type = JsonType::Array;
	v->array_items = std::move(items);
	return v;
}

JsonValuePtr make_bool(bool b) {
	auto v = std::make_shared<JsonValue>();
	v->type = JsonType::Bool;
	v->bool_value = b;
	return v;
}

JsonValuePtr make_string(const std::string &s) {
	auto v = std::make_shared<JsonValue>();
	v->type = JsonType::String;
	v->string_value = s;
	return v;
}

JsonValuePtr copy_of(const JsonValue &v) { return std::make_shared<JsonValue>(v); }

// A deep copy (the parser's values share children through shared_ptr).
JsonValuePtr deep_copy(const JsonValue &v) {
	auto c = std::make_shared<JsonValue>(v);
	for (auto &item : c->array_items) item = deep_copy(*item);
	for (auto &kv : c->object_items) kv.second = deep_copy(*kv.second);
	return c;
}

// ── comparing (exact; object key sets included) ───────────────────────────────

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

// Empty when `actual` matches `expected`; otherwise where and how it differs.
std::string compare(const JsonValue &expected, const JsonValue &actual, double tol, const std::string &path) {
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
		return std::fabs(expected.number_value - actual.number_value) <= tol
		           ? std::string()
		           : path + ": " + expected.raw_number + " != " + actual.raw_number;
	case JsonType::Array: {
		if (expected.array_items.size() != actual.array_items.size()) {
			return path + ": length " + std::to_string(expected.array_items.size()) + " != " +
			       std::to_string(actual.array_items.size());
		}
		for (std::size_t k = 0; k < expected.array_items.size(); k++) {
			std::string why =
			    compare(*expected.array_items[k], *actual.array_items[k], tol, path + "[" + std::to_string(k) + "]");
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
			std::string why = compare(*kv.second, *a, tol, path + "." + kv.first);
			if (!why.empty()) return why;
		}
		return {};
	}
	}
	return {};
}

// ── the negative pass's perturbation ──────────────────────────────────────────

// Perturb the LAST leaf of `v` (depth first, last element first), in place; false
// when nothing could be perturbed.
bool sabotage_last(JsonValue &v) {
	switch (v.type) {
	case JsonType::Number: {
		v.number_value += 1.0;
		char buf[64];
		std::snprintf(buf, sizeof buf, "%.17g", v.number_value);
		v.raw_number = buf;
		return true;
	}
	case JsonType::String: v.string_value += "!"; return true;
	case JsonType::Bool: v.bool_value = !v.bool_value; return true;
	case JsonType::Null:
		v.type = JsonType::Number;
		v.number_value = 0;
		v.raw_number = "0";
		return true;
	case JsonType::Array:
		for (auto it = v.array_items.rbegin(); it != v.array_items.rend(); ++it) {
			if (sabotage_last(**it)) return true;
		}
		v.array_items.push_back(make_string("sabotage"));
		return true;
	case JsonType::Object:
		for (auto it = v.object_items.rbegin(); it != v.object_items.rend(); ++it) {
			if (sabotage_last(*it->second)) return true;
		}
		v.object_items.emplace_back("sabotage", make_bool(true));
		return true;
	}
	return false;
}

JsonValuePtr perturbed(const JsonValue &expected) {
	JsonValuePtr bad = deep_copy(expected);
	sabotage_last(*bad);
	return bad;
}

// ── the corpus's markers (core's expandSecretFixtures and expandLocalFixtures) ─

// `s` with every `<<KIND:NAME>>` (`open` is "<<KIND:") replaced by `fixtures[NAME]`;
// false (with `why`) on an unknown NAME. `hit` is set when a marker was replaced.
bool expand_string(const std::string &s, const std::string &open, const std::map<std::string, std::string> &fixtures,
                   std::string &out, bool &hit, std::string &why) {
	out.clear();
	std::size_t i = 0;
	while (i < s.size()) {
		const std::size_t at = s.find(open, i);
		if (at == std::string::npos) break;
		std::size_t j = at + open.size();
		while (j < s.size() && ((s[j] >= 'a' && s[j] <= 'z') || s[j] == '-')) j++;
		if (j > at + open.size() && j + 1 < s.size() && s[j] == '>' && s[j + 1] == '>') {
			const std::string name = s.substr(at + open.size(), j - at - open.size());
			auto f = fixtures.find(name);
			if (f == fixtures.end()) {
				why = "unknown fixture \"" + name + "\" (" + open + ")";
				return false;
			}
			out += s.substr(i, at - i) + f->second;
			hit = true;
			i = j + 2;
		} else {
			out += s.substr(i, at + 1 - i);
			i = at + 1;
		}
	}
	out += s.substr(i);
	return true;
}

JsonValuePtr expand(const JsonValue &v, const std::string &open, const std::map<std::string, std::string> &fixtures, bool &hit,
                    std::string &why) {
	std::string s;
	switch (v.type) {
	case JsonType::String:
		if (!expand_string(v.string_value, open, fixtures, s, hit, why)) return nullptr;
		return make_string(s);
	case JsonType::Array: {
		std::vector<JsonValuePtr> items;
		for (const auto &x : v.array_items) {
			JsonValuePtr e = expand(*x, open, fixtures, hit, why);
			if (!e) return nullptr;
			items.push_back(e);
		}
		return make_array(items);
	}
	case JsonType::Object: {
		Items items;
		for (const auto &kv : v.object_items) {
			if (!expand_string(kv.first, open, fixtures, s, hit, why)) return nullptr;
			JsonValuePtr e = expand(*kv.second, open, fixtures, hit, why);
			if (!e) return nullptr;
			items.emplace_back(s, e);
		}
		return make_object(items);
	}
	default: return copy_of(v);
	}
}

const std::string kSecretOpen = "<<secret:";
const std::string kLocalOpen = "<<local:";

// The lines of an answer or an expectation in the corpus's shape (`line`, or each of `lines`).
std::vector<std::string> lines_of(const JsonValue &v) {
	std::vector<std::string> out;
	if (const JsonValue *l = v.find("line")) {
		if (l->is_string()) out.push_back(l->string_value);
	}
	if (const JsonValue *ls = v.find("lines")) {
		for (const auto &x : ls->array_items) {
			if (x->is_string()) out.push_back(x->string_value);
		}
	}
	return out;
}

// The first credential (a fixture's joined value) found in `lines`, or "".
std::string leaked(const std::vector<std::string> &lines, const std::map<std::string, std::string> &fixtures) {
	for (const std::string &w : lines) {
		for (const auto &f : fixtures) {
			if (!f.second.empty() && w.find(f.second) != std::string::npos) return f.first;
		}
	}
	return {};
}

bool self_test() {
	auto parse = [](const char *t) { return insimul::parse_json(t).root; };
	struct Probe {
		const char *expected, *actual;
		bool agree;
	} probes[] = {
	    {"{\"line\":\"a\"}", "{\"line\":\"a\"}", true},
	    {"{\"line\":\"a\"}", "{\"line\":\"a \"}", false},
	    {"{\"line\":\"a\\r\"}", "{\"line\":\"a\"}", false},
	    {"{\"lines\":[\"a\",\"b\"]}", "{\"lines\":[\"b\",\"a\"]}", false},
	    {"{\"lines\":[]}", "{\"lines\":[\"\"]}", false},
	    {"{\"line\":\"a\"}", "{\"line\":\"a\",\"state\":null}", false},
	    {"{\"line\":\"\\u212a\"}", "{\"line\":\"K\"}", false},
	};
	bool ok = true;
	for (const Probe &p : probes) {
		const bool agree = compare(*parse(p.expected), *parse(p.actual), 0.0, "$").empty();
		if (agree != p.agree) {
			std::printf("  [FAIL] self-test: %s vs %s %s\n", p.expected, p.actual, agree ? "agreed" : "differed");
			ok = false;
		}
	}
	// The perturbation always yields a difference, and never touches its source.
	for (const char *s : {"{\"line\":\"\"}", "{\"lines\":[]}", "{\"lines\":[\"a\",\"<credential>\"]}"}) {
		auto src = parse(s);
		auto bad = perturbed(*src);
		if (compare(*src, *bad, 0.0, "$").empty() || json_of(*src) != json_of(*parse(s))) {
			std::printf("  [FAIL] self-test: perturbing %s gave no difference, or changed the source\n", s);
			ok = false;
		}
	}
	// Marker expansion: keys and values, adjacent text kept, an unknown name refused,
	// text that only looks like a marker left alone; secret and local markers apart.
	{
		const std::map<std::string, std::string> fx = {{"jwt", "J.W.T"}, {"users", "/U/"}};
		bool hit = false;
		std::string why;
		auto v = expand(*parse("{\"a<<secret:jwt>>\":[\"x<<secret:jwt>>y\",\"<<secret:\",\"<<secret:jwt>\",\"<<local:users>>r\"]}"), kSecretOpen, fx,
		                hit, why);
		bool hit2 = false;
		std::string why2;
		auto u = expand(*parse("{\"a\":\"<<local:nope>>\"}"), kLocalOpen, fx, hit2, why2);
		bool hit3 = false;
		std::string why3;
		auto w = expand(*parse("[\"<<local:users>>rowan\",\"<<secret:jwt>>\"]"), kLocalOpen, fx, hit3, why3);
		if (!v || !hit || json_of(*v) != "{\"aJ.W.T\":[\"xJ.W.Ty\",\"<<secret:\",\"<<secret:jwt>\",\"<<local:users>>r\"]}" || u ||
		    why2.empty() || !w || !hit3 || json_of(*w) != "[\"/U/rowan\",\"<<secret:jwt>>\"]") {
			std::printf("  [FAIL] self-test: the markers do not expand as core's expandSecretFixtures / expandLocalFixtures do\n");
			ok = false;
		}
	}
	// The leak check sees a fixture's value in a line, and nothing else.
	{
		const std::map<std::string, std::string> fx = {{"jwt", "J.W.T"}};
		if (!leaked({"fine", "<credential>"}, fx).empty() || leaked({"fine", "a J.W.T b"}, fx).empty()) {
			std::printf("  [FAIL] self-test: the leak check cannot tell a hidden credential from a shown one\n");
			ok = false;
		}
	}
	return ok;
}

// ── calling the rows ──────────────────────────────────────────────────────────

struct Caller {
	insimul_core *core;
	std::string error;

	// The parsed answer, or nullptr with `error` set.
	JsonValuePtr call(const std::string &method, const std::string &args) {
		const char *raw = insimul_core_call(core, method.c_str(), args.c_str());
		if (!raw) {
			error = method + " failed: " + insimul_core_last_error(core);
			return nullptr;
		}
		auto parsed = insimul::parse_json(raw);
		if (!parsed.ok || !parsed.root->is_object()) {
			error = method + " answered something that is not a JSON object";
			return nullptr;
		}
		return parsed.root;
	}

	JsonValuePtr call(const std::string &method, const Items &args) { return call(method, json_of(*make_object(args))); }
};

const std::vector<std::string> kOps = {"redactLine", "redactLog"};
const std::vector<std::string> kRows = {"build.redactLogLine", "build.redactLog", "build.contract", "build.looksLikeSecret"};

// Answer one case's op through the rows, in the corpus's shape (core's runBuildLogRedactionOp).
bool drive(Caller &c, const std::string &op, const JsonValue &input, JsonValuePtr &out, std::string &why) {
	Items args;
	const JsonValue *context = input.find("context");
	if (op == "redactLine") {
		const JsonValue *line = input.find("line");
		if (!line) {
			why = "redactLine needs input.line";
			return false;
		}
		args.emplace_back("line", copy_of(*line));
		if (context) args.emplace_back("context", copy_of(*context));
		JsonValuePtr a = c.call("build.redactLogLine", args);
		if (!a) {
			why = c.error;
			return false;
		}
		const JsonValue *l = a->find("line");
		if (!l || a->object_items.size() != 1) {
			why = "build.redactLogLine without state answered something other than { line }: " + json_of(*a);
			return false;
		}
		out = make_object({{"line", copy_of(*l)}});
		return true;
	}
	const JsonValue *lines = input.find("lines");
	if (!lines) {
		why = "redactLog needs input.lines";
		return false;
	}
	args.emplace_back("log", copy_of(*lines));
	if (context) args.emplace_back("context", copy_of(*context));
	JsonValuePtr a = c.call("build.redactLog", args);
	if (!a) {
		why = c.error;
		return false;
	}
	const JsonValue *log = a->find("log");
	if (!log || !log->is_array() || a->object_items.size() != 1) {
		why = "build.redactLog answered something other than { log }: " + json_of(*a);
		return false;
	}
	out = make_object({{"lines", copy_of(*log)}});
	return true;
}

// A redactLog case driven line by line through build.redactLogLine, the state carried.
bool drive_carried(Caller &c, const JsonValue &input, JsonValuePtr &out, std::string &why) {
	const JsonValue *lines = input.find("lines");
	const JsonValue *context = input.find("context");
	if (!lines || !lines->is_array()) {
		why = "redactLog needs input.lines";
		return false;
	}
	JsonValuePtr state = make_object({{"inPrivateKey", make_bool(false)}});
	std::vector<JsonValuePtr> answered;
	for (const auto &l : lines->array_items) {
		Items args{{"line", copy_of(*l)}};
		if (context) args.emplace_back("context", copy_of(*context));
		args.emplace_back("state", state);
		JsonValuePtr a = c.call("build.redactLogLine", args);
		if (!a) {
			why = c.error;
			return false;
		}
		const JsonValue *line = a->find("line");
		const JsonValue *next = a->find("state");
		if (!line || !next || !next->is_object() || !next->find("inPrivateKey")) {
			why = "build.redactLogLine with state answered no { line, state: { inPrivateKey } }: " + json_of(*a);
			return false;
		}
		answered.push_back(copy_of(*line));
		state = copy_of(*next);
	}
	out = make_object({{"lines", make_array(answered)}});
	return true;
}

} // namespace

int main(int argc, char **argv) {
	bool negative = false;
	std::vector<std::string> args;
	for (int i = 1; i < argc; i++) {
		const std::string a = argv[i];
		if (a == "--negative") negative = true;
		else args.push_back(a);
	}
	if (args.size() != 1) {
		std::fprintf(stderr, "usage: insimulcore_build_log_redaction_corpus [--negative] <log-redaction.json>\n");
		return 2;
	}
	if (!self_test()) {
		std::fprintf(stderr, "build_log_redaction_corpus: the comparator, the perturbation, the markers or the leak check cannot tell a wrong answer from a right one\n");
		return 2;
	}
	bool read_ok = false;
	const std::string text = read_file(args[0], read_ok);
	auto parsed = insimul::parse_json(text);
	if (!read_ok || !parsed.ok || !parsed.root->is_object()) {
		std::printf("build_log_redaction_corpus: cannot read %s: %s\nbuild_log_redaction_corpus: FAIL\n", args[0].c_str(), parsed.error.c_str());
		return 1;
	}
	const JsonValue &doc = *parsed.root;
	insimul_core *core = insimul_core_create();
	if (!core) {
		std::fprintf(stderr, "build_log_redaction_corpus: insimul_core_create() failed\n");
		return 2;
	}
	std::printf("build_log_redaction_corpus%s: %s\n", negative ? " --negative" : "", insimul_core_version());
	Caller c{core, {}};
	int failed = 0;
	auto fail = [&](const std::string &what) {
		std::printf("  [FAIL] %s\n", what.c_str());
		failed++;
	};

	// The surface: a missing row would otherwise show only as every case failing.
	{
		std::set<std::string> table;
		auto m = c.call("core.methods", "{}");
		const JsonValue *list = m ? m->find("methods") : nullptr;
		if (list && list->is_array()) {
			for (const auto &x : list->array_items) table.insert(x->as_string());
		}
		for (const std::string &row : kRows) {
			if (!table.count(row)) fail("surface: the method table has no " + row + " row");
		}
	}

	const std::string area = doc.get_string("area");
	const JsonValue *case_list = doc.find("cases");
	const JsonValue *contract = doc.find("contract");
	if (area != "build-log-redaction") fail("area '" + area + "' is not build-log-redaction");
	if (!case_list || !case_list->is_array() || case_list->size() == 0) fail("the file holds no case");
	if (!contract || !contract->is_object()) fail("the file holds no contract");
	if (failed) {
		insimul_core_destroy(core);
		std::printf("build_log_redaction_corpus: FAIL\n");
		return 1;
	}
	const JsonValue *tol_v = doc.find("tolerance");
	const double tol = tol_v && tol_v->is_number() ? tol_v->number_value : 0.0;
	std::printf("── %s (area %s, %zu case(s))\n", args[0].c_str(), area.c_str(), case_list->size());

	// The fixtures the markers stand for (the file's own, as core's runner reads them).
	auto fixtures_of = [&](const char *key) {
		std::map<std::string, std::string> out;
		if (const JsonValue *fx = contract->find(key)) {
			for (const auto &kv : fx->object_items) {
				std::string joined;
				for (const auto &part : kv.second->array_items) joined += part->as_string();
				out[kv.first] = joined;
			}
		}
		return out;
	};
	const std::map<std::string, std::string> secrets = fixtures_of("secretFixtures");
	const std::map<std::string, std::string> locals = fixtures_of("localFixtures");
	if (secrets.empty()) fail("contract: the file states no secretFixtures");
	if (locals.empty()) fail("contract: the file states no localFixtures");

	// The contract: the credential stand-in is build.contract's; the others are counted below.
	const std::string stand_in = contract->get_string("secretKeyStandIn");
	{
		JsonValuePtr row_contract = c.call("build.contract", "{}");
		if (!row_contract) fail("contract: " + c.error);
		else if (stand_in.empty() || row_contract->get_string("secretKeyStandIn") != stand_in)
			fail("contract: secretKeyStandIn \"" + stand_in + "\" is not build.contract's \"" + row_contract->get_string("secretKeyStandIn") + "\"");
	}
	std::map<std::string, int> stand_in_pins;
	const std::vector<std::string> other_stand_ins = {"homeStandIn", "userStandIn", "projectStandIn"};

	std::map<std::string, int> driven;
	int undriven = 0, refused = 0, accepted = 0, with_secret = 0, with_local = 0, kept = 0, carried = 0, carried_lines = 0,
	    lines_out = 0, shaped = 0;
	std::map<std::string, std::pair<int, int>> targeted; // kind → {refused, accepted}
	auto target = [&](const std::string &kind, const JsonValue &bad, const JsonValue &actual, const std::string &name) {
		if (compare(bad, actual, tol, "$").empty()) {
			fail(name + " — a perturbed expectation (" + kind + ") was accepted");
			targeted[kind].second++;
			return;
		}
		targeted[kind].first++;
	};

	const auto t0 = std::chrono::steady_clock::now();
	for (const auto &cp : case_list->array_items) {
		const JsonValue &cs = *cp;
		const std::string name = cs.get_string("name");
		const std::string op = cs.get_string("op");
		const JsonValue *input = cs.find("input");
		const JsonValue *expected_raw = cs.find("expected");
		if (!input || !input->is_object() || !expected_raw) {
			fail(name + " — needs an input object and an expected answer");
			undriven++;
			continue;
		}
		bool known = false;
		for (const std::string &o : kOps) known = known || o == op;
		if (!known) {
			fail(name + " — op '" + op + "' is not one of core's BUILD_LOG_REDACTION_CORPUS_OPS");
			undriven++;
			continue;
		}
		bool has_secret = false, has_local = false, local_in_expected = false;
		std::string why;
		JsonValuePtr half = expand(*input, kSecretOpen, secrets, has_secret, why);
		JsonValuePtr in = half ? expand(*half, kLocalOpen, locals, has_local, why) : nullptr;
		JsonValuePtr expected = in ? expand(*expected_raw, kLocalOpen, locals, local_in_expected, why) : nullptr;
		if (!in || !expected) {
			fail(name + " — " + why);
			undriven++;
			continue;
		}
		if (json_of(*expected_raw).find(kSecretOpen) != std::string::npos) fail(name + " — an expected line holds a secret marker (core: none does)");
		JsonValuePtr actual;
		if (!drive(c, op, *in, actual, why)) {
			fail(name + " — not driven: " + why);
			undriven++;
			continue;
		}
		const std::vector<std::string> out_lines = lines_of(*actual);
		const std::vector<std::string> in_lines = lines_of(*in);
		lines_out += static_cast<int>(out_lines.size());
		if (has_secret) with_secret++;
		if (has_local) with_local++;
		if (in_lines == lines_of(*expected)) kept++;
		for (const std::string &so : other_stand_ins) {
			const std::string s = contract->get_string(so);
			for (const std::string &l : lines_of(*expected)) {
				if (!s.empty() && l.find(s) != std::string::npos) stand_in_pins[so]++;
			}
		}
		// Leaks: no fixture's value, and no shape build.looksLikeSecret names, in any line answered.
		{
			const std::string which = leaked(out_lines, secrets);
			if (!which.empty()) fail(name + " — a line answered repeats the " + which + " credential");
			for (const std::string &l : out_lines) {
				auto a = c.call("build.looksLikeSecret", Items{{"value", make_string(l)}});
				const JsonValue *s = a ? a->find("secret") : nullptr;
				if (!s || s->type != JsonType::Bool) fail(name + " — build.looksLikeSecret: " + c.error);
				else if (s->bool_value) fail(name + " — a line answered still looks like a credential: " + l);
				else shaped++;
			}
		}
		// Carried: a log driven line by line, the state carried, answers the same.
		JsonValuePtr streamed;
		if (op == "redactLog") {
			if (!drive_carried(c, *in, streamed, why)) {
				fail(name + " — not driven line by line: " + why);
			} else {
				const std::string diff = compare(*expected, *streamed, tol, "$(carried)");
				if (!diff.empty() && !negative) fail(name + " — " + diff);
				else {
					carried++;
					carried_lines += static_cast<int>(lines_of(*streamed).size());
				}
			}
		}
		if (negative) {
			if (compare(*perturbed(*expected), *actual, tol, "$").empty()) {
				fail(name + " — a perturbed expectation was accepted");
				accepted++;
			} else {
				refused++;
			}
			// The input itself as the answer: a credential or a home path shown.
			if (in_lines != lines_of(*expected)) {
				JsonValuePtr as_input = op == "redactLine" ? make_object({{"line", make_string(in_lines.empty() ? "" : in_lines[0])}})
				                                           : make_object({{"lines", copy_of(*in->find("lines"))}});
				if (has_secret) target("credential shown", *as_input, *actual, name);
				if (has_local) target("home path shown", *as_input, *actual, name);
			}
			// A private-key block let through: each withheld line put back, alone.
			if (op == "redactLog") {
				const std::vector<std::string> want = lines_of(*expected);
				for (std::size_t k = 0; k < want.size() && k < in_lines.size(); k++) {
					if (want[k] != stand_in || in_lines[k] == stand_in) continue;
					JsonValuePtr bad = deep_copy(*expected);
					for (auto &kv : bad->object_items) {
						if (kv.first == "lines") kv.second->array_items[k] = make_string(in_lines[k]);
					}
					target("private-key line shown", *bad, *actual, name);
					if (streamed) target("private-key line shown (carried)", *bad, *streamed, name);
				}
			}
		} else {
			const std::string diff = compare(*expected, *actual, tol, "$");
			if (!diff.empty()) {
				fail(name + " — " + diff);
				continue;
			}
		}
		driven[op]++;
	}

	std::string by_op;
	int total_driven = 0;
	for (const std::string &o : kOps) {
		if (!driven.count(o)) fail("op " + o + ": no case of it was driven");
		by_op += (by_op.empty() ? "" : ", ") + o + " " + std::to_string(driven.count(o) ? driven[o] : 0);
		total_driven += driven.count(o) ? driven[o] : 0;
	}
	std::string pins;
	for (const std::string &so : other_stand_ins) {
		const int n = stand_in_pins.count(so) ? stand_in_pins[so] : 0;
		pins += (pins.empty() ? "" : ", ") + so + " " + std::to_string(n);
		if (n == 0) fail("contract: no expected line pins " + so + " \"" + contract->get_string(so) + "\"");
	}
	std::printf("  %s: %zu case(s), driven %s; %d undriven\n", area.c_str(), case_list->size(), by_op.c_str(), undriven);
	std::printf("  contract: secretKeyStandIn \"%s\" is build.contract's; expected lines pinning %s\n", stand_in.c_str(), pins.c_str());
	std::printf("  markers: %d case(s) carry a credential, %d a home path; %d case(s) kept byte for byte\n", with_secret, with_local, kept);
	std::printf("  carried: %d log case(s), %d line(s), driven line by line with the state carried, agree\n", carried, carried_lines);
	std::printf("  leaks: %d line(s) answered, none repeats a credential, %d of them clear of build.looksLikeSecret's shapes\n", lines_out,
	            shaped);
	if (with_secret == 0 || with_local == 0) fail("markers: the corpus drove no case carrying a credential, or none carrying a home path");
	if (carried == 0 || carried != (driven.count("redactLog") ? driven["redactLog"] : -1)) fail("carried: not every log case was driven line by line");
	if (shaped != lines_out) fail("leaks: not every line answered was asked of build.looksLikeSecret");

	// No session left open.
	{
		auto l = c.call("session.list", "{}");
		const JsonValue *open = l ? l->find("sessions") : nullptr;
		if (!open || !open->is_array() || open->size() != 0) fail("sessions left open");
	}
	insimul_core_destroy(core);
	const double ms = std::chrono::duration<double, std::milli>(std::chrono::steady_clock::now() - t0).count();

	if (negative) {
		const int cases = static_cast<int>(case_list->size());
		std::printf("  negative: %d of %d perturbed expectation(s) refused, %d accepted\n", refused, cases, accepted);
		std::string line;
		bool every_kind = true;
		for (const char *k : {"credential shown", "home path shown", "private-key line shown", "private-key line shown (carried)"}) {
			const auto &rv = targeted[k];
			line += (line.empty() ? "" : ", ") + std::string(k) + " " + std::to_string(rv.first) + "/" + std::to_string(rv.first + rv.second);
			every_kind = every_kind && rv.first > 0 && rv.second == 0;
		}
		std::printf("  targeted: %s refused\n", line.c_str());
		if (!every_kind) fail("targeted: a kind of purposeful perturbation was never made, or one was accepted");
		std::printf("build_log_redaction_corpus --negative: %d of %d perturbed case(s) refused, %d accepted, %d failure(s), %.0f ms\n", refused,
		            cases, accepted, failed, ms);
		if (failed || refused != cases || cases == 0) {
			std::printf("build_log_redaction_corpus --negative: FAIL\n");
			return 1;
		}
		std::printf("build_log_redaction_corpus --negative: PASS\n");
		return 0;
	}
	std::printf("build_log_redaction_corpus: %d of %zu case(s) driven through the rows, %d failed, %.0f ms\n", total_driven,
	            case_list->size(), failed, ms);
	if (failed || total_driven == 0 || total_driven != static_cast<int>(case_list->size())) {
		std::printf("build_log_redaction_corpus: FAIL\n");
		return 1;
	}
	std::printf("build_log_redaction_corpus: PASS\n");
	return 0;
}
