// build_corpus.cpp — core's P10 headless build corpus, driven through
// libinsimulcore's `build.*` rows.
//
// PL.native-headless-build (rulings U106(1), U107 and U36). Core's headless build
// contract (P10.core: src/build/headless-build.ts, docs/headless-build.md) is a set of
// rows of corebridge/js/entry.js. This gate holds them to core's own corpus, COPIED
// byte for byte into corebridge/vendor/core/conformance/headless-build/headless.json
// at the pin (one folder over from core's build/, which every build/ rule here reads as
// build output) and sha256-checked by the `core_vendor` ctest (area headless-build; ops plan,
// checkResult, checkProgress, size).
//
// Nothing here re-writes a case or computes an answer: every answer comes out of a
// row. How each op is driven (core's runner, src/build/headless-build-corpus.ts
// `runBuildOp`, is the reference, and this one drives the rows the way it drives
// core's functions):
//
//   Every `<<secret:NAME>>` marker in a case's `input` (in keys and values) is first
//   replaced by the file's own `contract.secretFixtures[NAME]`, its parts joined with
//   nothing between them (core's `expandSecretFixtures`); an unknown NAME fails the
//   case. Then:
//   plan {request, context?}           → build.plan with the input AS IS; answered
//                                        `{ ok, refusals, notes, plan }`, refusals and
//                                        notes cut to `{ code, field }` (details are
//                                        creator sentences, which the corpus does not
//                                        pin).
//   checkResult {request, result, context?} → build.checkResult; `{ ok, issues, summary }`,
//                                        issues cut to `{ code, field }`.
//   checkProgress {request, events}    → build.checkProgress; the same.
//   size {bytes}                       → build.size; `{ text }`.
//
// Three checks beside the cases, each answered by rows:
//
//   contract   `build.contract` equals the file's `contract` less the corpus's own
//              `secretFixtures` and `rules` and `schemas.jsonSchemas` (core's file
//              names): every code list in its order, the stand-in a credential key
//              takes in a field path (`secretKeyStandIn`) and the words a hidden detail
//              becomes (`hiddenDetail`).
//   credentials  in every case whose input carries a credential, no detail the row
//              answers (refusals, notes, issues) and no summary line repeats one (core:
//              "a detail never repeats the value"; "A detail that holds a credential is
//              not shown").
//   folds      every out-dir refusal a plan case expects is asked of the fold rows: an
//              `out-dir-holds-inputs` input path must be inside `target.outDir` under
//              `build.insideDirFolded`, and under `build.foldMacos` or `build.foldWindows`
//              then `build.insideDir` (which says which fold catches it); an
//              `out-dir-reserved` build folder the same against the engine's reserved
//              folders (`build.contract`). Every plan core accepts has no input inside
//              its build folder and no build folder inside a reserved one. The corpus's
//              fold-only cases (one only the macOS fold catches, one only the Windows
//              fold) are counted, and the ctest demands at least one of each.
//
// A case op this runner does not know fails its case (never a skip). The run FAILS on
// a file whose area or op list is not core's (`BUILD_CORPUS_OPS`), on an op no case
// drives, on a row missing from the method table, on a session left open, and when its
// comparator, perturbation, marker expansion or leak check cannot fail (a self-test on
// every start). Comparison is the corpus's own rule: exact, object key sets included
// (tolerance 0).
//
// --negative perturbs EVERY case's expectation (its last leaf: a number +1, a string +
// "!", a boolean flipped, null → 0, an empty array or object given an element) and
// requires every case to be refused, as Unreal's headless_build_corpus_negative does.
// It also perturbs on purpose, each required refused:
//   - a credential not caught: a case's `secret-in-request` / `-result` / `-progress`
//     entries dropped from its expectation;
//   - a credential not hidden: a hidden summary line with the engine's own words (the
//     credential) put back, both as an expectation and as a planted answer the leak
//     check must catch;
//   - a path that escapes the build folder: a plan case's `out-dir-holds-inputs` and
//     `out-dir-reserved` entries dropped, counted by the fold that catches it (the
//     ctest demands a macOS-only and a Windows-only one); `artefact-outside-out-dir`
//     and `path-outside-project` dropped the same way.
//
// A pure consumer of insimulcore.h (no quickjs.h, no insimul.h). The JSON reader is
// tests/radiant/json_value.{h,cpp}, used as is.
//
// usage: insimulcore_build_corpus [--negative] <headless.json>

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

JsonValuePtr make_null() { return std::make_shared<JsonValue>(); }

JsonValuePtr copy_of(const JsonValue &v) { return std::make_shared<JsonValue>(v); }

// A deep copy (the parser's values share children through shared_ptr).
JsonValuePtr deep_copy(const JsonValue &v) {
	auto c = std::make_shared<JsonValue>(v);
	for (auto &item : c->array_items) item = deep_copy(*item);
	for (auto &kv : c->object_items) kv.second = deep_copy(*kv.second);
	return c;
}

// `v`'s member at a dotted path (`world.file`, `packs.lock.file`), or nullptr.
const JsonValue *at_path(const JsonValue &v, const std::string &dotted) {
	const JsonValue *cur = &v;
	std::size_t start = 0;
	while (cur) {
		const std::size_t dot = dotted.find('.', start);
		const std::string key = dotted.substr(start, dot == std::string::npos ? std::string::npos : dot - start);
		cur = cur->is_object() ? cur->find(key) : nullptr;
		if (dot == std::string::npos) return cur;
		start = dot + 1;
	}
	return nullptr;
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

// ── the negative pass's perturbations ─────────────────────────────────────────

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

// Whether `code` is one of `prefixes` (an entry ending in '*' is a prefix).
bool code_in(const std::string &code, const std::vector<std::string> &codes) {
	for (const std::string &c : codes) {
		if (!c.empty() && c.back() == '*' ? code.compare(0, c.size() - 1, c, 0, c.size() - 1) == 0 : code == c) return true;
	}
	return false;
}

// The expectation with every `refusals` / `issues` entry whose code is in `codes`
// dropped, or nullptr when it holds none.
JsonValuePtr dropped(const JsonValue &expected, const std::vector<std::string> &codes) {
	JsonValuePtr bad = deep_copy(expected);
	bool any = false;
	for (auto &kv : bad->object_items) {
		if ((kv.first != "refusals" && kv.first != "issues") || !kv.second->is_array()) continue;
		std::vector<JsonValuePtr> kept;
		for (const auto &x : kv.second->array_items) {
			if (code_in(x->get_string("code"), codes)) any = true;
			else kept.push_back(x);
		}
		kv.second->array_items = kept;
	}
	return any ? bad : nullptr;
}

// ── the corpus's credential markers (core's expandSecretFixtures) ─────────────

// `s` with every `<<secret:NAME>>` replaced by `fixtures[NAME]`; false (with `why`)
// on an unknown NAME. `hit` is set when a marker was replaced.
bool expand_string(const std::string &s, const std::map<std::string, std::string> &fixtures, std::string &out, bool &hit,
                   std::string &why) {
	static const std::string open = "<<secret:";
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
				why = "unknown secret fixture \"" + name + "\"";
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

JsonValuePtr expand(const JsonValue &v, const std::map<std::string, std::string> &fixtures, bool &hit, std::string &why) {
	std::string s;
	switch (v.type) {
	case JsonType::String:
		if (!expand_string(v.string_value, fixtures, s, hit, why)) return nullptr;
		return make_string(s);
	case JsonType::Array: {
		std::vector<JsonValuePtr> items;
		for (const auto &x : v.array_items) {
			JsonValuePtr e = expand(*x, fixtures, hit, why);
			if (!e) return nullptr;
			items.push_back(e);
		}
		return make_array(items);
	}
	case JsonType::Object: {
		Items items;
		for (const auto &kv : v.object_items) {
			if (!expand_string(kv.first, fixtures, s, hit, why)) return nullptr;
			JsonValuePtr e = expand(*kv.second, fixtures, hit, why);
			if (!e) return nullptr;
			items.emplace_back(s, e);
		}
		return make_object(items);
	}
	default: return copy_of(v);
	}
}

// The words of a row's answer a credential must never be in: every refusal's,
// note's and issue's `detail`, and the summary's `line`.
std::vector<std::string> answer_words(const JsonValue &answer) {
	std::vector<std::string> out;
	for (const char *list : {"refusals", "notes", "issues"}) {
		if (const JsonValue *xs = answer.find(list)) {
			for (const auto &x : xs->array_items) out.push_back(x->get_string("detail"));
		}
	}
	if (const JsonValue *s = answer.find("summary")) {
		if (s->is_object()) out.push_back(s->get_string("line"));
	}
	return out;
}

// The first credential (a fixture's joined value) found in the answer's words, or "".
std::string leaked(const JsonValue &answer, const std::map<std::string, std::string> &fixtures) {
	for (const std::string &w : answer_words(answer)) {
		for (const auto &f : fixtures) {
			if (!f.second.empty() && w.find(f.second) != std::string::npos) return f.first;
		}
	}
	return {};
}

// A copy of `answer` whose summary line says `line`.
JsonValuePtr with_line(const JsonValue &answer, const std::string &line) {
	JsonValuePtr a = deep_copy(answer);
	for (auto &kv : a->object_items) {
		if (kv.first != "summary" || !kv.second->is_object()) continue;
		for (auto &s : kv.second->object_items) {
			if (s.first == "line") s.second = make_string(line);
		}
	}
	return a;
}

bool self_test() {
	auto parse = [](const char *t) { return insimul::parse_json(t).root; };
	struct Probe {
		const char *expected, *actual;
		bool agree;
	} probes[] = {
	    {"{\"a\":1,\"b\":[true,\"x\"]}", "{\"b\":[true,\"x\"],\"a\":1.0}", true},
	    {"{\"a\":1}", "{\"a\":1.000001}", false},
	    {"{\"ok\":false,\"refusals\":[{\"code\":\"x\",\"field\":null}]}", "{\"ok\":false,\"refusals\":[{\"code\":\"x\",\"field\":\"\"}]}", false},
	    {"{\"a\":1}", "{\"a\":1,\"b\":null}", false},
	    {"{\"a\":1,\"b\":null}", "{\"a\":1}", false},
	    {"[1,2]", "[2,1]", false},
	    {"false", "0", false},
	    {"null", "{}", false},
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
	const char *sources[] = {
	    "{\"ok\":true,\"refusals\":[],\"notes\":[],\"plan\":{\"primary\":{\"open\":\"browser\"}}}",
	    "{\"ok\":false,\"refusals\":[{\"code\":\"x\",\"field\":null}],\"notes\":[],\"plan\":null}",
	    "{\"text\":\"1 kB\"}",
	};
	for (const char *s : sources) {
		auto src = parse(s);
		auto bad = perturbed(*src);
		if (compare(*src, *bad, 0.0, "$").empty() || json_of(*src) != json_of(*parse(s))) {
			std::printf("  [FAIL] self-test: perturbing %s gave no difference, or changed the source\n", s);
			ok = false;
		}
	}
	// Dropping codes: only the named ones (a prefix with '*'), in refusals and issues.
	{
		auto e = parse("{\"ok\":false,\"refusals\":[{\"code\":\"secret-in-request\",\"field\":\"a\"},{\"code\":\"invalid-request\",\"field\":null}]}");
		auto d = dropped(*e, {"secret-in-*"});
		if (!d || d->find("refusals")->size() != 1 || d->find("refusals")->array_items[0]->get_string("code") != "invalid-request" ||
		    dropped(*e, {"out-dir-reserved"}) != nullptr || e->find("refusals")->size() != 2) {
			std::printf("  [FAIL] self-test: dropping codes from an expectation\n");
			ok = false;
		}
	}
	// Marker expansion: keys and values, adjacent text kept, an unknown name refused,
	// text that only looks like a marker left alone.
	{
		const std::map<std::string, std::string> fx = {{"jwt", "J.W.T"}, {"model-key", "MK"}};
		bool hit = false;
		std::string why;
		auto v = expand(*parse("{\"a<<secret:jwt>>\":[\"x<<secret:model-key>>y\",\"<<secret:\",\"<<secret:jwt>\"]}"), fx, hit, why);
		bool hit2 = false;
		std::string why2;
		auto u = expand(*parse("{\"a\":\"<<secret:nope>>\"}"), fx, hit2, why2);
		if (!v || !hit || json_of(*v) != "{\"aJ.W.T\":[\"xMKy\",\"<<secret:\",\"<<secret:jwt>\"]}" || u || why2.empty()) {
			std::printf("  [FAIL] self-test: the secret markers do not expand as core's expandSecretFixtures does\n");
			ok = false;
		}
	}
	// The leak check sees a credential in a detail or a line, and nowhere else.
	{
		const std::map<std::string, std::string> fx = {{"jwt", "J.W.T"}};
		auto clean = parse("{\"ok\":false,\"issues\":[{\"code\":\"x\",\"field\":\"J.W.T\",\"detail\":\"words\"}],\"summary\":{\"line\":\"fine\"}}");
		auto in_detail = parse("{\"ok\":false,\"refusals\":[{\"code\":\"x\",\"field\":null,\"detail\":\"see J.W.T\"}]}");
		if (!leaked(*clean, fx).empty() || leaked(*in_detail, fx).empty() || leaked(*with_line(*clean, "a J.W.T b"), fx).empty()) {
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

	// A row answering `{ key: <boolean> }`; false with `ok` cleared when it fails.
	bool yes(const std::string &method, const Items &args, const char *key, bool &ok) {
		auto a = call(method, args);
		const JsonValue *v = a ? a->find(key) : nullptr;
		if (!v || v->type != JsonType::Bool) {
			ok = false;
			if (error.empty()) error = method + " answered no boolean `" + key + "`";
			return false;
		}
		return v->bool_value;
	}

	// A row answering `{ key: <string> }`.
	std::string text(const std::string &method, const Items &args, const char *key, bool &ok) {
		auto a = call(method, args);
		const JsonValue *v = a ? a->find(key) : nullptr;
		if (!v || !v->is_string()) {
			ok = false;
			if (error.empty()) error = method + " answered no string `" + key + "`";
			return {};
		}
		return v->string_value;
	}
};

const std::vector<std::string> kOps = {"plan", "checkResult", "checkProgress", "size"};
const std::vector<std::string> kRows = {"build.contract",  "build.plan",       "build.checkResult", "build.checkProgress",
                                        "build.size",      "build.foldMacos",  "build.foldWindows", "build.insideDir",
                                        "build.insideDirFolded"};

// `{ code, field }` of every entry of `answer[list]`.
JsonValuePtr codes_of(const JsonValue &answer, const char *list, std::string &why) {
	const JsonValue *xs = answer.find(list);
	if (!xs || !xs->is_array()) {
		why = std::string("the answer has no `") + list + "` list";
		return nullptr;
	}
	std::vector<JsonValuePtr> out;
	for (const auto &x : xs->array_items) {
		const JsonValue *code = x->find("code");
		const JsonValue *field = x->find("field");
		if (!code || !field) {
			why = std::string("an entry of `") + list + "` has no code or field";
			return nullptr;
		}
		out.push_back(make_object({{"code", copy_of(*code)}, {"field", copy_of(*field)}}));
	}
	return make_array(out);
}

// Answer one case's op through the rows, in the corpus's shape (core's runBuildOp).
// `raw` is the row's whole answer (details included).
bool drive(Caller &c, const std::string &op, const JsonValue &input, JsonValuePtr &out, JsonValuePtr &raw, std::string &why) {
	Items args;
	for (const char *k : {"request", "result", "events", "context", "bytes"}) {
		if (const JsonValue *v = input.find(k)) args.emplace_back(k, copy_of(*v));
	}
	const std::string row = "build." + op;
	raw = c.call(row, args);
	if (!raw) {
		why = c.error;
		return false;
	}
	const JsonValue &a = *raw;
	const JsonValue *ok = a.find("ok");
	if (op == "size") {
		const JsonValue *text = a.find("text");
		if (!text) {
			why = "build.size answered no text";
			return false;
		}
		out = make_object({{"text", copy_of(*text)}});
		return true;
	}
	if (!ok) {
		why = row + " answered no ok";
		return false;
	}
	if (op == "plan") {
		JsonValuePtr refusals = codes_of(a, "refusals", why), notes = refusals ? codes_of(a, "notes", why) : nullptr;
		const JsonValue *plan = a.find("plan");
		if (!refusals || !notes || !plan) {
			if (why.empty()) why = "build.plan answered no plan";
			return false;
		}
		out = make_object({{"ok", copy_of(*ok)}, {"refusals", refusals}, {"notes", notes}, {"plan", copy_of(*plan)}});
		return true;
	}
	JsonValuePtr issues = codes_of(a, "issues", why);
	const JsonValue *summary = a.find("summary");
	if (!issues || !summary) {
		if (why.empty()) why = row + " answered no summary";
		return false;
	}
	out = make_object({{"ok", copy_of(*ok)}, {"issues", issues}, {"summary", copy_of(*summary)}});
	return true;
}

// Which fold puts `path` inside `dir`: "macos", "windows", "both" or "none", from the
// fold rows (each fold, then `build.insideDir` on the folded strings).
std::string fold_class(Caller &c, const std::string &path, const std::string &dir, bool &ok) {
	auto inside_under = [&](const char *row) {
		const std::string p = c.text(row, {{"path", make_string(path)}}, "folded", ok);
		const std::string d = c.text(row, {{"path", make_string(dir)}}, "folded", ok);
		return c.yes("build.insideDir", {{"path", make_string(p)}, {"dir", make_string(d)}}, "inside", ok);
	};
	const bool mac = inside_under("build.foldMacos");
	const bool win = inside_under("build.foldWindows");
	return mac && win ? "both" : mac ? "macos" : win ? "windows" : "none";
}

bool folded_inside(Caller &c, const std::string &path, const std::string &dir, bool &ok) {
	return c.yes("build.insideDirFolded", {{"path", make_string(path)}, {"dir", make_string(dir)}}, "inside", ok);
}

struct FoldTally {
	std::map<std::string, int> holds, reserved;
	int clear = 0;
};

const char *const kInputFields[] = {"world.file", "recipe.file", "packs.lock.file"};

// The fold check of one plan case (see the header). Each expected out-dir refusal's
// fold class is appended to `classes`; false with `why` on a disagreement.
bool check_folds(Caller &c, const JsonValue &request, const JsonValue &expected, const JsonValue &contract, FoldTally &t,
                 std::vector<std::string> &classes, std::string &why) {
	const JsonValue *out_dir = at_path(request, "target.outDir");
	if (!out_dir || !out_dir->is_string()) return true; // a request whose shape core refuses: no folder to ask about
	const std::string dir = out_dir->string_value;
	const JsonValue *reserved_all = contract.find("engineReservedDirs");
	const JsonValue *reserved = reserved_all ? reserved_all->find(request.get_string("engine")) : nullptr;
	bool ok = true;
	const JsonValue *refusals = expected.find("refusals");
	if (refusals) {
		for (const auto &r : refusals->array_items) {
			const std::string code = r->get_string("code");
			if (code == "out-dir-holds-inputs") {
				const JsonValue *p = at_path(request, r->get_string("field"));
				if (!p || !p->is_string()) {
					why = "out-dir-holds-inputs at " + r->get_string("field") + " names no path";
					return false;
				}
				if (!folded_inside(c, p->string_value, dir, ok) && ok) {
					why = "build.insideDirFolded says " + r->get_string("field") + " is not inside the build folder";
					return false;
				}
				const std::string k = fold_class(c, p->string_value, dir, ok);
				if (k == "none" && ok) {
					why = "neither fold row puts " + r->get_string("field") + " inside the build folder";
					return false;
				}
				t.holds[k]++;
				classes.push_back(k);
			} else if (code == "out-dir-reserved") {
				std::string k = "none";
				bool any = false;
				for (const auto &d : reserved ? reserved->array_items : std::vector<JsonValuePtr>{}) {
					if (!folded_inside(c, dir, d->as_string(), ok)) continue;
					any = true;
					const std::string kd = fold_class(c, dir, d->as_string(), ok);
					if (k == "none" || kd == "both") k = kd;
				}
				if ((!any || k == "none") && ok) {
					why = "no reserved folder of the engine holds the build folder under the fold rows";
					return false;
				}
				t.reserved[k]++;
				classes.push_back(k);
			}
		}
	}
	const JsonValue *accepted = expected.find("ok");
	if (accepted && accepted->type == JsonType::Bool && accepted->bool_value) {
		for (const char *f : kInputFields) {
			const JsonValue *p = at_path(request, f);
			if (p && p->is_string() && folded_inside(c, p->string_value, dir, ok)) {
				why = std::string("an accepted plan's ") + f + " is inside its build folder under build.insideDirFolded";
				return false;
			}
		}
		for (const auto &d : reserved ? reserved->array_items : std::vector<JsonValuePtr>{}) {
			if (folded_inside(c, dir, d->as_string(), ok)) {
				why = "an accepted plan's build folder is inside a reserved folder under build.insideDirFolded";
				return false;
			}
		}
		t.clear++;
	}
	if (!ok) {
		why = c.error;
		return false;
	}
	return true;
}

std::string tally_line(const std::map<std::string, int> &m) {
	auto n = [&](const char *k) { return std::to_string(m.count(k) ? m.at(k) : 0); };
	int total = 0;
	for (const auto &kv : m) total += kv.second;
	return std::to_string(total) + " (macOS only " + n("macos") + ", Windows only " + n("windows") + ", both " + n("both") + ")";
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
		std::fprintf(stderr, "usage: insimulcore_build_corpus [--negative] <headless.json>\n");
		return 2;
	}
	if (!self_test()) {
		std::fprintf(stderr, "build_corpus: the comparator, the perturbation, the markers or the leak check cannot tell a wrong answer from a right one\n");
		return 2;
	}
	bool read_ok = false;
	const std::string text = read_file(args[0], read_ok);
	auto parsed = insimul::parse_json(text);
	if (!read_ok || !parsed.ok || !parsed.root->is_object()) {
		std::printf("build_corpus: cannot read %s: %s\nbuild_corpus: FAIL\n", args[0].c_str(), parsed.error.c_str());
		return 1;
	}
	const JsonValue &doc = *parsed.root;
	insimul_core *core = insimul_core_create();
	if (!core) {
		std::fprintf(stderr, "build_corpus: insimul_core_create() failed\n");
		return 2;
	}
	std::printf("build_corpus%s: %s\n", negative ? " --negative" : "", insimul_core_version());
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
	if (area != "headless-build") fail("area '" + area + "' is not headless-build");
	if (!case_list || !case_list->is_array() || case_list->size() == 0) fail("the file holds no case");
	if (!contract || !contract->is_object()) fail("the file holds no contract");
	if (failed) {
		insimul_core_destroy(core);
		std::printf("build_corpus: FAIL\n");
		return 1;
	}
	const JsonValue *tol_v = doc.find("tolerance");
	const double tol = tol_v && tol_v->is_number() ? tol_v->number_value : 0.0;
	std::printf("── %s (area %s, %zu case(s))\n", args[0].c_str(), area.c_str(), case_list->size());

	// The fixtures the markers stand for (the file's own, as core's runner reads them).
	std::map<std::string, std::string> fixtures;
	if (const JsonValue *fx = contract->find("secretFixtures")) {
		for (const auto &kv : fx->object_items) {
			std::string joined;
			for (const auto &part : kv.second->array_items) joined += part->as_string();
			fixtures[kv.first] = joined;
		}
	}
	if (fixtures.empty()) fail("contract: the file states no secretFixtures");

	// The contract: build.contract is the file's, less the corpus's own parts.
	JsonValuePtr row_contract = c.call("build.contract", "{}");
	{
		Items want;
		for (const auto &kv : contract->object_items) {
			if (kv.first == "secretFixtures" || kv.first == "rules") continue;
			if (kv.first == "schemas") {
				Items schemas;
				for (const auto &s : kv.second->object_items) {
					if (s.first != "jsonSchemas") schemas.push_back(s);
				}
				want.emplace_back(kv.first, make_object(schemas));
			} else {
				want.push_back(kv);
			}
		}
		if (!row_contract) {
			fail("contract: " + c.error);
		} else {
			const std::string diff = compare(*make_object(want), *row_contract, 0.0, "contract");
			if (!diff.empty()) fail("contract: build.contract is not the file's: " + diff);
			else std::printf("  contract: build.contract states the file's %zu table(s) (secretKeyStandIn \"%s\", hiddenDetail stated)\n", want.size(),
			                 row_contract->get_string("secretKeyStandIn").c_str());
		}
	}
	const std::string hidden_detail = contract->get_string("hiddenDetail");

	std::map<std::string, int> driven;
	int undriven = 0, refused = 0, accepted = 0, with_secret = 0, hidden_lines = 0;
	FoldTally folds;
	// --negative's purposeful perturbations: [kind] → {refused, accepted}.
	std::map<std::string, std::pair<int, int>> targeted;
	std::map<std::string, int> escape_by_fold;
	auto target = [&](const std::string &kind, const JsonValue &bad, const JsonValue &actual, const std::string &name) {
		if (compare(bad, actual, tol, "$").empty()) {
			fail(name + " — a perturbed expectation (" + kind + ") was accepted");
			targeted[kind].second++;
			return false;
		}
		targeted[kind].first++;
		return true;
	};

	const auto t0 = std::chrono::steady_clock::now();
	for (const auto &cp : case_list->array_items) {
		const JsonValue &cs = *cp;
		const std::string name = cs.get_string("name");
		const std::string op = cs.get_string("op");
		const JsonValue *input = cs.find("input");
		const JsonValue *expected = cs.find("expected");
		if (!input || !input->is_object() || !expected) {
			fail(name + " — needs an input object and an expected answer");
			undriven++;
			continue;
		}
		bool known = false;
		for (const std::string &o : kOps) known = known || o == op;
		if (!known) {
			fail(name + " — op '" + op + "' is not one of core's BUILD_CORPUS_OPS");
			undriven++;
			continue;
		}
		bool has_secret = false;
		std::string why;
		JsonValuePtr in = expand(*input, fixtures, has_secret, why);
		if (!in) {
			fail(name + " — " + why);
			undriven++;
			continue;
		}
		JsonValuePtr actual, raw;
		if (!drive(c, op, *in, actual, raw, why)) {
			fail(name + " — not driven: " + why);
			undriven++;
			continue;
		}
		if (has_secret) {
			with_secret++;
			const std::string which = leaked(*raw, fixtures);
			if (!which.empty()) fail(name + " — the answer repeats the " + which + " credential in a detail or its line");
			const JsonValue *summary = raw->find("summary");
			if (summary && summary->is_object() && summary->get_string("line").find(hidden_detail) != std::string::npos) hidden_lines++;
		}
		std::vector<std::string> classes;
		if (op == "plan") {
			const JsonValue *request = in->find("request");
			if (request && request->is_object() && row_contract && !check_folds(c, *request, *expected, *row_contract, folds, classes, why)) {
				fail(name + " — folds: " + why);
			}
		}
		if (negative) {
			if (compare(*perturbed(*expected), *actual, tol, "$").empty()) {
				fail(name + " — a perturbed expectation was accepted");
				accepted++;
			} else {
				refused++;
			}
			if (JsonValuePtr bad = dropped(*expected, {"secret-in-*"})) target("credential not caught", *bad, *actual, name);
			if (JsonValuePtr bad = dropped(*expected, {"out-dir-holds-inputs", "out-dir-reserved"})) {
				if (target("escape under a fold", *bad, *actual, name)) {
					for (const std::string &k : classes) escape_by_fold[k]++;
				}
			}
			if (JsonValuePtr bad = dropped(*expected, {"artefact-outside-out-dir"})) target("artefact outside outDir", *bad, *actual, name);
			if (JsonValuePtr bad = dropped(*expected, {"path-outside-project"})) target("path outside project", *bad, *actual, name);
			// A hidden line with the engine's own words put back: the credential shown.
			const JsonValue *summary = expected->find("summary");
			const std::string line = summary && summary->is_object() ? summary->get_string("line") : std::string();
			const std::size_t at = hidden_detail.empty() ? std::string::npos : line.find(hidden_detail);
			if (at != std::string::npos) {
				const JsonValue *result = in->find("result");
				const JsonValue *err = result ? at_path(*result, "error.detail") : nullptr;
				const JsonValue *refusals = result ? result->find("refusals") : nullptr;
				std::string words = err && err->is_string() ? err->string_value : std::string();
				if (words.empty() && refusals && refusals->size() > 0) words = refusals->array_items[0]->get_string("detail");
				const std::string shown = line.substr(0, at) + words + line.substr(at + hidden_detail.size());
				target("credential shown", *with_line(*expected, shown), *actual, name);
				// The same line planted in the row's answer: the leak check must catch it.
				if (leaked(*with_line(*raw, shown), fixtures).empty()) {
					fail(name + " — a planted answer showing the credential passed the leak check");
					targeted["credential shown (planted)"].second++;
				} else {
					targeted["credential shown (planted)"].first++;
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
	std::printf("  %s: %zu case(s), driven %s; %d undriven\n", area.c_str(), case_list->size(), by_op.c_str(), undriven);
	std::printf("  credentials: %d case(s) carry one, none repeated in a detail or a line, %d line(s) hidden\n", with_secret,
	            hidden_lines);
	std::printf("  folds: holds-inputs %s, reserved %s, %d accepted plan(s) clear of both\n", tally_line(folds.holds).c_str(),
	            tally_line(folds.reserved).c_str(), folds.clear);
	if (with_secret == 0 || hidden_lines == 0) fail("credentials: the corpus drove no case carrying a credential, or no hidden line");

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
		for (const char *k : {"credential not caught", "credential shown", "credential shown (planted)", "escape under a fold",
		                      "artefact outside outDir", "path outside project"}) {
			const auto &rv = targeted[k];
			line += (line.empty() ? "" : ", ") + std::string(k) + " " + std::to_string(rv.first) + "/" +
			        std::to_string(rv.first + rv.second);
			every_kind = every_kind && rv.first > 0 && rv.second == 0;
		}
		std::printf("  targeted: %s refused\n", line.c_str());
		auto n = [&](const char *k) { return escape_by_fold.count(k) ? escape_by_fold[k] : 0; };
		std::printf("  escapes refused by fold: macOS only %d, Windows only %d, both %d\n", n("macos"), n("windows"), n("both"));
		if (!every_kind) fail("targeted: a kind of purposeful perturbation was never made, or one was accepted");
		if (n("macos") == 0 || n("windows") == 0) fail("targeted: no escape only one fold catches was refused (macOS only and Windows only)");
		std::printf("build_corpus --negative: %d of %d perturbed case(s) refused, %d accepted, %d failure(s), %.0f ms\n", refused, cases,
		            accepted, failed, ms);
		if (failed || refused != cases || cases == 0) {
			std::printf("build_corpus --negative: FAIL\n");
			return 1;
		}
		std::printf("build_corpus --negative: PASS\n");
		return 0;
	}
	std::printf("build_corpus: %d of %zu case(s) driven through the rows, %d failed, %.0f ms\n", total_driven, case_list->size(), failed,
	            ms);
	if (failed || total_driven == 0 || total_driven != static_cast<int>(case_list->size())) {
		std::printf("build_corpus: FAIL\n");
		return 1;
	}
	std::printf("build_corpus: PASS\n");
	return 0;
}
