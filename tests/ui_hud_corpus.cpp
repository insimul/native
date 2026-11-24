// ui_hud_corpus.cpp — core's HUD shell corpora, driven through libinsimulcore's
// `ui.notifications.*`, `ui.compass.*` and `ui.minimap.*` rows.
//
// PL.native-hud-rows (rulings U143(2), U128, U85(3), U36). Core's three HUD view-models
// (src/ui/notifications.ts with the history log src/game-engine/logic/NotificationStore.ts,
// src/ui/compass-model.ts, src/ui/minimap-model.ts; P2.core and P2.core-north) are rows of
// corebridge/js/entry.js. This gate holds them to core's own corpora,
// conformance/ui/{notifications,compass,minimap}-cases.json, COPIED byte for byte into
// corebridge/vendor/core/conformance/ui/ at the pin (the P2 HUD set) and sha256-checked by the
// `core_vendor` ctest. Nothing here re-writes a case or computes an answer: every answer comes
// out of the rows.
//
// Each case is answered as core's reference runner (src/ui/hud-corpus.ts, `runHudOp`) answers
// it, through the rows, in the file's case order:
//
//   ui-compass        view, heading, cardinal, north, world_view
//                       -> ONE call of ui.compass.view / .heading / .cardinal / .north / .worldView
//                          with the case's whole input; a refusal's `message` (core's, for a log
//                          only) is left out as core's runner leaves it out
//   ui-minimap        project, toneFor, sizeFor -> ONE call of that row
//                     session -> ui.minimap.create { worldSize? }, ONE ui.minimap.apply of the
//                          steps as ops (and `placed` last when the case reads it), the answer
//                          assembled from the results and the view as core's runner pins it
//   ui-notifications  toasts -> ui.notifications.create, ONE apply of the steps as ops
//                     history -> the same session's history ops: a step's `at` sets the log's
//                          clock (on its push, else as a historyClock op), pushMany is `count`
//                          historyPush ops titled "<title> <k>", recent/all answer items (or
//                          their ids with ids: true)
//
// Comparison is the corpora's own rule (core's `compareHudValue`): numbers within the file's
// `tolerance`, everything else exactly, object key sets included. The run also counts the cases
// whose answer is identical to the corpus's to the last bit. Each file's `contract` block is held
// WHOLE: every key is either a value its contract row states (compared exactly, key sets both
// ways), a behaviour this run measures (the refusal codes and north sources the rows answered,
// the feed's id prefixes, the first ids, the categories carried), or a rule the file's cases pin,
// named here; a contract key this runner does not know fails the run, as does a missing one.
//
// An op this runner does not know fails its case (never a skip); the refusal probes prove it on
// every start, and prove that the rows refuse what core cannot read ([invalid-input]) while what
// core refuses itself (a null yaw, a facing given twice) comes back as core's VALUE. The run FAILS
// on a file that is not a HUD corpus or holds no case, on an op of core's runner no case drives,
// on a row missing from the method table, on a contract key that differs, on a session left open,
// and when its comparator, its perturbation or its contract check cannot fail (self-tests on every
// start).
//
// --negative perturbs EVERY driven case's expectation (its last leaf) and requires every one to be
// refused.
//
// A pure consumer of insimulcore.h (no quickjs.h, no insimul.h). The JSON reader is
// tests/radiant/json_value.{h,cpp}, used as is.
//
// usage: insimulcore_ui_hud_corpus [--negative] <conformance/ui/<hud>-cases.json>...

#include "insimulcore.h"
#include "radiant/json_value.h"

#include <chrono>
#include <cmath>
#include <cstdio>
#include <fstream>
#include <map>
#include <regex>
#include <set>
#include <sstream>
#include <stdexcept>
#include <string>
#include <vector>

using insimul::JsonType;
using insimul::JsonValue;
using insimul::JsonValuePtr;

namespace {

struct Area {
	const char *area;
	const char *contract_row;
	std::vector<std::string> ops;        // core's HUD_CORPUS_OPS for the area, in its order
	std::vector<std::string> row_keys;   // the contract keys the contract row states
	std::vector<std::string> measured;   // the contract keys this run measures
	std::vector<std::string> by_cases;   // the contract keys the file's cases pin (rules in words, orders)
};

const std::vector<Area> kAreas = {
    {"ui-notifications", "ui.notifications.contract", {"toasts", "history"},
     {"kinds", "kindColor", "defaultLifetimeSeconds", "historyMax"},
     {"toastFirstId", "historyFirstId", "categories"},
     {"toastExpiry", "historyOrder"}},
    {"ui-compass", "ui.compass.contract", {"view", "heading", "cardinal", "north", "world_view"},
     {"points", "defaultSpanDegrees", "minDistanceM", "defaultNorthYaw"},
     {"refusalCodes", "worldRefusalCodes", "northSources"},
     {"spanNull", "headingRange", "relativeRange", "relativeRule", "visibleRule", "refusalOrder", "northRule",
      "worldRefusalOrder", "mirroredLevel"}},
    {"ui-minimap", "ui.minimap.contract", {"project", "toneFor", "sizeFor", "session"},
     {"markerTypes", "tones", "unknownTypeTone", "sizesPx", "unknownTypeSizePx", "defaultWorldSize", "feedOwnedIds"},
     {"feedIdPrefixes"},
     {"projection", "projectionNote", "projectionNorthUp", "projectionMirrored"}},
};

// Every row this runner calls.
const char *const kRows[] = {
    "ui.notifications.create", "ui.notifications.apply", "ui.notifications.contract", "ui.compass.contract",
    "ui.compass.view",         "ui.compass.worldView",   "ui.compass.north",          "ui.compass.heading",
    "ui.compass.cardinal",     "ui.minimap.contract",    "ui.minimap.project",        "ui.minimap.toneFor",
    "ui.minimap.sizeFor",      "ui.minimap.create",      "ui.minimap.apply",
};

const Area *area_of(const std::string &name) {
	for (const Area &a : kAreas) {
		if (name == a.area) return &a;
	}
	return nullptr;
}

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

std::string quoted(const std::string &s) {
	std::string out;
	write_string(out, s);
	return out;
}

JsonValuePtr parse(const std::string &text) {
	auto r = insimul::parse_json(text);
	if (!r.ok) throw std::runtime_error("internal JSON error: " + r.error + " in " + text);
	return r.root;
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

JsonValuePtr deep_copy(const JsonValue &v) {
	auto c = std::make_shared<JsonValue>(v);
	for (auto &item : c->array_items) item = deep_copy(*item);
	for (auto &kv : c->object_items) kv.second = deep_copy(*kv.second);
	return c;
}

// ── comparing (core's compareHudValue: numbers within tolerance, the rest exact) ──

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

// Perturb the LAST leaf of `v` (depth first, last element first), in place.
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

// The comparator and the perturbation are the gate; they must be able to fail.
bool self_test() {
	struct Probe {
		const char *expected, *actual;
		bool agree;
	} probes[] = {
	    {"{\"a\":1,\"b\":[true,\"x\"]}", "{\"b\":[true,\"x\"],\"a\":1.0}", true},
	    {"{\"x\":-100}", "{\"x\":-100.00000000000001}", true},
	    {"{\"x\":90}", "{\"x\":90.000001}", false},
	    {"{\"ok\":false,\"refusal\":{\"code\":\"not_finite\",\"field\":\"yaw\"}}",
	     "{\"ok\":false,\"refusal\":{\"code\":\"not_finite\",\"field\":\"northYaw\"}}", false},
	    {"{\"player\":null}", "{\"player\":{}}", false},
	    {"{\"a\":1}", "{\"a\":1,\"b\":null}", false},
	    {"{\"a\":1,\"b\":null}", "{\"a\":1}", false},
	    {"[1,2]", "[2,1]", false},
	    {"[{}]", "[]", false},
	    {"false", "0", false},
	    {"null", "{}", false},
	};
	bool ok = true;
	for (const Probe &p : probes) {
		auto e = parse(p.expected);
		auto a = parse(p.actual);
		const bool agree = compare(*e, *a, 1e-9, "$").empty();
		if (agree != p.agree) {
			std::printf("  [FAIL] self-test: %s vs %s should %s\n", p.expected, p.actual, p.agree ? "agree" : "differ");
			ok = false;
		}
	}
	const char *sources[] = {"[{}]", "[]", "{\"x\":0,\"y\":-50}", "{\"cardinal\":\"N\"}",
	                         "{\"results\":[{}],\"visible\":false,\"player\":null}"};
	for (const char *s : sources) {
		auto src = parse(s);
		auto bad = deep_copy(*src);
		sabotage_last(*bad);
		if (compare(*src, *bad, 1e-9, "$").empty() || json_of(*src) != json_of(*parse(s))) {
			std::printf("  [FAIL] self-test: perturbing %s gave no difference, or changed the source\n", s);
			ok = false;
		}
	}
	return ok;
}

// ── the contract check ────────────────────────────────────────────────────────

bool listed(const std::vector<std::string> &v, const std::string &k) {
	for (const std::string &x : v) {
		if (x == k) return true;
	}
	return false;
}

// What is wrong with the contract row's answer `row` against the file's `contract`, for `a`: every key the
// row states equal (exactly) to the contract's, the row stating no other key, and every key of the contract
// accounted for (stated by the row, measured by this run, or pinned by the cases). `agree` counts the
// row-stated keys that hold.
std::vector<std::string> contract_problems(const Area &a, const JsonValue &contract, const JsonValue &row, int &agree) {
	std::vector<std::string> out;
	agree = 0;
	for (const std::string &k : a.row_keys) {
		const JsonValue *want = contract.find(k);
		const JsonValue *got = row.find(k);
		if (!want) {
			out.push_back(std::string("the file's contract has no ") + k + ", which " + a.contract_row + " states");
			continue;
		}
		if (!got) {
			out.push_back(std::string(a.contract_row) + " does not state " + k);
			continue;
		}
		const std::string diff = compare(*want, *got, 0.0, k);
		if (!diff.empty()) {
			out.push_back(diff);
			continue;
		}
		agree++;
	}
	for (const auto &kv : row.object_items) {
		if (!listed(a.row_keys, kv.first)) out.push_back(std::string(a.contract_row) + " states " + kv.first + ", which this runner does not hold");
	}
	for (const auto &kv : contract.object_items) {
		if (!listed(a.row_keys, kv.first) && !listed(a.measured, kv.first) && !listed(a.by_cases, kv.first)) {
			out.push_back("the file's contract key " + kv.first + " is not one this runner holds (stated, measured or pinned by the cases)");
		}
	}
	for (const std::vector<std::string> *list : {&a.measured, &a.by_cases}) {
		for (const std::string &k : *list) {
			if (!contract.find(k)) out.push_back("the file's contract has no " + k);
		}
	}
	return out;
}

// The contract check is a gate too: each doctored answer must be named, the sound one must not.
bool contract_self_test() {
	const Area &a = kAreas[1]; // ui-compass
	std::string contract = "{\"points\":[\"N\",\"E\"],\"defaultSpanDegrees\":150,\"minDistanceM\":1e-9,\"defaultNorthYaw\":0";
	for (const std::vector<std::string> *list : {&a.measured, &a.by_cases}) {
		for (const std::string &k : *list) contract += ",\"" + k + "\":\"x\"";
	}
	const std::string doc = contract + "}";
	const std::string sound = "\"points\":[\"N\",\"E\"],\"defaultSpanDegrees\":150,\"minDistanceM\":1e-9,\"defaultNorthYaw\":0";
	struct Probe {
		std::string contract, row;
		bool sound;
	} probes[] = {
	    {doc, "{" + sound + "}", true},
	    {doc, "{\"points\":[\"E\",\"N\"],\"defaultSpanDegrees\":150,\"minDistanceM\":1e-9,\"defaultNorthYaw\":0}", false},
	    {doc, "{\"points\":[\"N\",\"E\"],\"defaultSpanDegrees\":150.0000001,\"minDistanceM\":1e-9,\"defaultNorthYaw\":0}", false},
	    {doc, "{\"points\":[\"N\",\"E\"],\"minDistanceM\":1e-9,\"defaultNorthYaw\":0}", false},
	    {doc, "{" + sound + ",\"extra\":1}", false},
	    {contract + ",\"newRule\":\"y\"}", "{" + sound + "}", false},
	    {"{\"points\":[\"N\",\"E\"],\"defaultSpanDegrees\":150,\"minDistanceM\":1e-9,\"defaultNorthYaw\":0}", "{" + sound + "}", false},
	};
	bool ok = true;
	for (const Probe &p : probes) {
		auto c = parse(p.contract);
		auto r = parse(p.row);
		int agree = 0;
		const bool sound_seen = contract_problems(a, *c, *r, agree).empty();
		if (sound_seen != p.sound) {
			std::printf("  [FAIL] self-test: the contract check %s %s against %s\n", p.sound ? "refused" : "accepted", p.row.c_str(),
			            p.contract.c_str());
			ok = false;
		}
	}
	return ok;
}

// ── calling the rows ──────────────────────────────────────────────────────────

struct DriveError : std::runtime_error {
	using std::runtime_error::runtime_error;
};

struct Caller {
	insimul_core *core;
	std::string last_error;

	// The parsed answer, or nullptr with `last_error` set (the row's error).
	JsonValuePtr try_call(const char *method, const std::string &args) {
		const char *raw = insimul_core_call(core, method, args.c_str());
		if (!raw) {
			last_error = insimul_core_last_error(core);
			return nullptr;
		}
		auto parsed = insimul::parse_json(raw);
		if (!parsed.ok || !parsed.root->is_object()) {
			last_error = std::string(method) + " answered something that is not a JSON object";
			return nullptr;
		}
		return parsed.root;
	}

	// The parsed answer; a row's error is a DriveError.
	JsonValuePtr call(const char *method, const std::string &args) {
		auto r = try_call(method, args);
		if (!r) throw DriveError(std::string(method) + " failed: " + last_error);
		return r;
	}

	void dispose(long long session) { try_call("session.dispose", "{\"session\":" + std::to_string(session) + "}"); }
};

long long session_of(const JsonValuePtr &created, const char *row) {
	const JsonValue *s = created->find("session");
	if (!s || !s->is_number()) throw DriveError(std::string(row) + " answered no session handle");
	return s->as_int();
}

// ── one case, as core's runner answers it ─────────────────────────────────────

// A compass answer as core's runner reports it: a refusal is { ok: false, refusal: { code, field } }. The row also
// states core's `message` (for a log only), which must be a string and is left out here, as core's runner leaves it.
JsonValuePtr compass_answer(const JsonValuePtr &r) {
	const JsonValue *ok = r->find("ok");
	if (!ok || ok->type != JsonType::Bool || ok->bool_value) return r;
	const JsonValue *refusal = r->find("refusal");
	if (!refusal || !refusal->is_object() || refusal->object_items.size() != 3 || !refusal->find("message") ||
	    !refusal->find("message")->is_string() || !refusal->find("code") || !refusal->find("field")) {
		throw DriveError("a compass refusal is not { code, field, message: string }: " + json_of(*r));
	}
	return parse("{\"ok\":false,\"refusal\":{\"code\":" + json_of(*refusal->find("code")) +
	             ",\"field\":" + json_of(*refusal->find("field")) + "}}");
}

// The step results core's runner reports, from the row's bare results: `{}` for a void op, else { <key>: result }.
std::string wrap(const char *key, const JsonValue &result) {
	return key ? std::string("{\"") + key + "\":" + json_of(result) + "}" : std::string("{}");
}

// toasts: { results, visible, count }.
JsonValuePtr drive_toasts(Caller &c, const JsonValue &input) {
	const JsonValue *steps = input.find("steps");
	if (!steps || !steps->is_array()) throw DriveError("toasts needs steps");
	std::string ops;
	std::vector<const char *> keys;
	for (std::size_t i = 0; i < steps->array_items.size(); i++) {
		const JsonValue &s = *steps->array_items[i];
		std::string op;
		if (const JsonValue *p = s.find("push")) {
			if (!p->is_object()) throw DriveError("a push step's push is not an object");
			std::string inner = json_of(*p);
			op = "{\"op\":\"push\"" + (inner.size() > 2 ? "," + inner.substr(1) : std::string("}"));
			keys.push_back("id");
		} else if (const JsonValue *t = s.find("tick")) {
			op = "{\"op\":\"tick\",\"delta\":" + json_of(*t) + "}";
			keys.push_back("changed");
		} else if (const JsonValue *d = s.find("dismiss")) {
			op = "{\"op\":\"dismiss\",\"id\":" + json_of(*d) + "}";
			keys.push_back("removed");
		} else if (s.find("clear") && s.find("clear")->type == JsonType::Bool && s.find("clear")->bool_value) {
			op = "{\"op\":\"clear\"}";
			keys.push_back(nullptr);
		} else {
			throw DriveError("a toast step this runner does not know: " + json_of(s));
		}
		ops += (ops.empty() ? "" : ",") + op;
	}
	auto created = c.call("ui.notifications.create", "{}");
	const long long sid = session_of(created, "ui.notifications.create");
	JsonValuePtr applied;
	try {
		applied = c.call("ui.notifications.apply", "{\"session\":" + std::to_string(sid) + ",\"ops\":[" + ops + "]}");
	} catch (...) {
		c.dispose(sid);
		throw;
	}
	c.dispose(sid);
	const JsonValue *results = applied->find("results");
	const JsonValue *view = applied->find("view");
	if (!results || !results->is_array() || results->size() != keys.size() || !view || !view->is_object()) {
		throw DriveError("ui.notifications.apply answered no results per op or no view");
	}
	std::string out;
	for (std::size_t i = 0; i < keys.size(); i++) out += (i ? "," : "") + wrap(keys[i], *results->array_items[i]);
	const JsonValue *visible = view->find("visible");
	const JsonValue *count = view->find("count");
	if (!visible || !count || view->object_items.size() != 2) throw DriveError("the toast view is not { visible, count }");
	return parse("{\"results\":[" + out + "],\"visible\":" + json_of(*visible) + ",\"count\":" + json_of(*count) + "}");
}

// history: { results }.
JsonValuePtr drive_history(Caller &c, const JsonValue &input) {
	const JsonValue *steps = input.find("steps");
	if (!steps || !steps->is_array()) throw DriveError("history needs steps");
	struct Want {
		enum Kind { Id, Many, Items, Ids, Length, Void } kind;
		std::size_t first, count; // the op indices this step's result reads
	};
	std::string ops;
	std::size_t n = 0;
	std::vector<Want> wants;
	auto add = [&](const std::string &op) {
		ops += (ops.empty() ? "" : ",") + op;
		return n++;
	};
	for (std::size_t i = 0; i < steps->array_items.size(); i++) {
		const JsonValue &s = *steps->array_items[i];
		const JsonValue *at = s.find("at");
		const bool has_at = at && at->is_number();
		const std::string at_member = has_at ? ",\"at\":" + json_of(*at) : std::string();
		auto flag = [&](const char *k) { return s.find(k) && s.find(k)->type == JsonType::Bool && s.find(k)->bool_value; };
		if (const JsonValue *p = s.find("push")) {
			if (!p->is_object()) throw DriveError("a push step's push is not an object");
			std::string inner = json_of(*p);
			wants.push_back({Want::Id, add("{\"op\":\"historyPush\"" + at_member + (inner.size() > 2 ? "," + inner.substr(1) : std::string("}"))), 1});
			continue;
		}
		if (const JsonValue *m = s.find("pushMany")) {
			const JsonValue *count = m->find("count");
			const JsonValue *title = m->find("title");
			const JsonValue *category = m->find("category");
			if (!count || !count->is_number() || !title || !title->is_string()) throw DriveError("pushMany needs count and title");
			const long long k_count = count->as_int();
			std::size_t first = n;
			for (long long k = 0; k < k_count; k++) {
				add("{\"op\":\"historyPush\"" + (k == 0 ? at_member : std::string()) + ",\"title\":" +
				    quoted(title->string_value + " " + std::to_string(k)) + (category ? ",\"category\":" + json_of(*category) : std::string()) + "}");
			}
			wants.push_back({Want::Many, first, static_cast<std::size_t>(k_count)});
			continue;
		}
		if (has_at) add("{\"op\":\"historyClock\"" + at_member + "}");
		if (const JsonValue *r = s.find("recent")) {
			wants.push_back({flag("ids") ? Want::Ids : Want::Items, add("{\"op\":\"historyRecent\",\"count\":" + json_of(*r) + "}"), 1});
		} else if (flag("all")) {
			wants.push_back({flag("ids") ? Want::Ids : Want::Items, add("{\"op\":\"historyAll\"}"), 1});
		} else if (flag("length")) {
			wants.push_back({Want::Length, add("{\"op\":\"historyLength\"}"), 1});
		} else if (flag("clear")) {
			wants.push_back({Want::Void, add("{\"op\":\"historyClear\"}"), 1});
		} else {
			throw DriveError("a history step this runner does not know: " + json_of(s));
		}
	}
	auto created = c.call("ui.notifications.create", "{}");
	const long long sid = session_of(created, "ui.notifications.create");
	JsonValuePtr applied;
	try {
		applied = c.call("ui.notifications.apply", "{\"session\":" + std::to_string(sid) + ",\"ops\":[" + ops + "]}");
	} catch (...) {
		c.dispose(sid);
		throw;
	}
	c.dispose(sid);
	const JsonValue *results = applied->find("results");
	if (!results || !results->is_array() || results->size() != n) throw DriveError("ui.notifications.apply answered no result per op");
	std::string out;
	for (std::size_t i = 0; i < wants.size(); i++) {
		const Want &w = wants[i];
		const JsonValue &r = *results->array_items[w.first];
		std::string one;
		switch (w.kind) {
		case Want::Id: one = wrap("id", r); break;
		case Want::Length: one = wrap("length", r); break;
		case Want::Void: one = wrap(nullptr, r); break;
		case Want::Items: one = wrap("items", r); break;
		case Want::Ids: {
			if (!r.is_array()) throw DriveError("a history read answered no list");
			std::string ids;
			for (const auto &item : r.array_items) {
				const JsonValue *id = item->find("id");
				if (!id) throw DriveError("a history item has no id");
				ids += (ids.empty() ? "" : ",") + json_of(*id);
			}
			one = "{\"ids\":[" + ids + "]}";
			break;
		}
		case Want::Many: {
			const std::string first = w.count ? json_of(*results->array_items[w.first]) : "null";
			const std::string last = w.count ? json_of(*results->array_items[w.first + w.count - 1]) : "null";
			one = "{\"firstId\":" + first + ",\"lastId\":" + last + "}";
			break;
		}
		}
		out += (i ? "," : "") + one;
	}
	return parse("{\"results\":[" + out + "]}");
}

// session: { results, worldSize, visible, markerCount, markers, player, placed? }.
JsonValuePtr drive_minimap_session(Caller &c, const JsonValue &input) {
	const JsonValue *steps = input.find("steps");
	if (!steps || !steps->is_array()) throw DriveError("session needs steps");
	std::string ops;
	std::vector<const char *> keys;
	for (std::size_t i = 0; i < steps->array_items.size(); i++) {
		const JsonValue &s = *steps->array_items[i];
		std::string op;
		if (const JsonValue *v = s.find("setWorldSize")) {
			op = "{\"op\":\"setWorldSize\",\"size\":" + json_of(*v) + "}";
			keys.push_back(nullptr);
		} else if (const JsonValue *a = s.find("add")) {
			op = "{\"op\":\"add\",\"marker\":" + json_of(*a) + "}";
			keys.push_back(nullptr);
		} else if (const JsonValue *r = s.find("remove")) {
			op = "{\"op\":\"remove\",\"id\":" + json_of(*r) + "}";
			keys.push_back("removed");
		} else if (s.find("clear") && s.find("clear")->type == JsonType::Bool && s.find("clear")->bool_value) {
			op = "{\"op\":\"clear\"}";
			keys.push_back(nullptr);
		} else if (const JsonValue *f = s.find("ingest")) {
			op = "{\"op\":\"ingest\",\"feed\":" + json_of(*f) + "}";
			keys.push_back(nullptr);
		} else if (const JsonValue *v2 = s.find("setVisible")) {
			op = "{\"op\":\"setVisible\",\"visible\":" + json_of(*v2) + "}";
			keys.push_back(nullptr);
		} else {
			throw DriveError("a minimap session step this runner does not know: " + json_of(s));
		}
		ops += (ops.empty() ? "" : ",") + op;
	}
	const JsonValue *placed = input.find("placed");
	if (placed) {
		if (!placed->is_object()) throw DriveError("placed is not an object");
		std::string inner = json_of(*placed);
		ops += std::string(ops.empty() ? "" : ",") + "{\"op\":\"placed\"" + (inner.size() > 2 ? "," + inner.substr(1) : std::string("}"));
	}
	const JsonValue *world = input.find("worldSize");
	auto created = c.call("ui.minimap.create", world ? "{\"worldSize\":" + json_of(*world) + "}" : std::string("{}"));
	const long long sid = session_of(created, "ui.minimap.create");
	JsonValuePtr applied;
	try {
		applied = c.call("ui.minimap.apply", "{\"session\":" + std::to_string(sid) + ",\"ops\":[" + ops + "]}");
	} catch (...) {
		c.dispose(sid);
		throw;
	}
	c.dispose(sid);
	const JsonValue *results = applied->find("results");
	const JsonValue *view = applied->find("view");
	if (!results || !results->is_array() || results->size() != keys.size() + (placed ? 1 : 0) || !view || !view->is_object()) {
		throw DriveError("ui.minimap.apply answered no result per op or no view");
	}
	std::string out = "{\"results\":[";
	for (std::size_t i = 0; i < keys.size(); i++) out += (i ? "," : "") + wrap(keys[i], *results->array_items[i]);
	out += "]";
	for (const char *k : {"worldSize", "visible", "markerCount", "markers", "player"}) {
		const JsonValue *v = view->find(k);
		if (!v) throw DriveError(std::string("the minimap view has no ") + k);
		out += std::string(",\"") + k + "\":" + json_of(*v);
	}
	if (view->object_items.size() != 5) throw DriveError("the minimap view holds a key core's runner does not pin");
	if (placed) out += ",\"placed\":" + json_of(*results->array_items[keys.size()]);
	return parse(out + "}");
}

// One case's answer, in its `expected` shape. A DriveError when it cannot be driven.
JsonValuePtr drive(Caller &c, const std::string &area, const std::string &op, const JsonValue &input) {
	if (area == "ui-compass") {
		const char *row = op == "view" ? "ui.compass.view"
		                  : op == "heading" ? "ui.compass.heading"
		                  : op == "cardinal" ? "ui.compass.cardinal"
		                  : op == "north" ? "ui.compass.north"
		                  : op == "world_view" ? "ui.compass.worldView"
		                                       : nullptr;
		if (!row) throw DriveError("op " + op + " is not one of core's ui-compass ops (hud-corpus.ts HUD_CORPUS_OPS)");
		return compass_answer(c.call(row, json_of(input)));
	}
	if (area == "ui-minimap") {
		if (op == "project") return c.call("ui.minimap.project", json_of(input));
		if (op == "toneFor") return c.call("ui.minimap.toneFor", json_of(input));
		if (op == "sizeFor") return c.call("ui.minimap.sizeFor", json_of(input));
		if (op == "session") return drive_minimap_session(c, input);
		throw DriveError("op " + op + " is not one of core's ui-minimap ops (hud-corpus.ts HUD_CORPUS_OPS)");
	}
	if (area == "ui-notifications") {
		if (op == "toasts") return drive_toasts(c, input);
		if (op == "history") return drive_history(c, input);
		throw DriveError("op " + op + " is not one of core's ui-notifications ops (hud-corpus.ts HUD_CORPUS_OPS)");
	}
	throw DriveError("area " + area + " is not a HUD corpus");
}

// ── the measured contract keys ────────────────────────────────────────────────

// What the run saw the rows answer, for the contract keys it measures.
struct Seen {
	std::set<std::string> view_codes, world_codes, north_sources;
};

void note(Seen &seen, const std::string &op, const JsonValue &answer) {
	const JsonValue *refusal = answer.find("refusal");
	if (refusal && refusal->find("code")) {
		if (op == "view") seen.view_codes.insert(refusal->get_string("code"));
		if (op == "world_view" || op == "north") seen.world_codes.insert(refusal->get_string("code"));
	}
	const JsonValue *north = op == "north" ? answer.find("value") : op == "world_view" ? answer.find("north") : nullptr;
	if (north && north->find("source")) seen.north_sources.insert(north->get_string("source"));
}

std::set<std::string> string_set(const JsonValue *list) {
	std::set<std::string> out;
	if (list && list->is_array()) {
		for (const auto &x : list->array_items) out.insert(x->as_string());
	}
	return out;
}

std::string joined(const std::set<std::string> &s) {
	std::string out;
	for (const std::string &x : s) out += (out.empty() ? "" : ", ") + x;
	return out;
}

// The measured contract keys of `a`, held to what the rows do. Problems are returned; `held` counts the keys that hold.
std::vector<std::string> measured_problems(Caller &c, const Area &a, const JsonValue &contract, const Seen &seen, int &held) {
	std::vector<std::string> out;
	held = 0;
	auto same_set = [&](const char *key, const std::set<std::string> &answered, const char *what) {
		const std::set<std::string> stated = string_set(contract.find(key));
		if (stated.empty() || stated != answered) {
			out.push_back(std::string(key) + ": the contract states [" + joined(stated) + "] but the rows answered [" + joined(answered) + "] " + what);
		} else {
			held++;
		}
	};
	const std::string area = a.area;
	if (area == "ui-compass") {
		same_set("refusalCodes", seen.view_codes, "over the file's view cases");
		same_set("worldRefusalCodes", seen.world_codes, "over the file's north and world_view cases");
		same_set("northSources", seen.north_sources, "over the file's north and world_view cases");
		return out;
	}
	if (area == "ui-notifications") {
		// The first toast id and the first history id: one push each on a new session.
		auto created = c.call("ui.notifications.create", "{}");
		const long long sid = session_of(created, "ui.notifications.create");
		std::string ops = "{\"op\":\"push\",\"text\":\"probe\"},{\"op\":\"historyPush\",\"title\":\"probe\"}";
		const JsonValue *categories = contract.find("categories");
		const std::set<std::string> cats = string_set(categories);
		if (categories && categories->is_array()) {
			for (const auto &cat : categories->array_items) ops += ",{\"op\":\"historyPush\",\"title\":\"c\",\"category\":" + json_of(*cat) + "}";
		}
		ops += ",{\"op\":\"historyAll\"}";
		JsonValuePtr r;
		try {
			r = c.call("ui.notifications.apply", "{\"session\":" + std::to_string(sid) + ",\"ops\":[" + ops + "]}");
		} catch (...) {
			c.dispose(sid);
			throw;
		}
		c.dispose(sid);
		const JsonValue *results = r->find("results");
		const JsonValue *toast_first = contract.find("toastFirstId");
		const JsonValue *history_first = contract.find("historyFirstId");
		if (!toast_first || compare(*toast_first, *results->array_items[0], 0.0, "toastFirstId").size()) {
			out.push_back("toastFirstId: a new session's first toast is " + json_of(*results->array_items[0]));
		} else {
			held++;
		}
		if (!history_first || compare(*history_first, *results->array_items[1], 0.0, "historyFirstId").size()) {
			out.push_back("historyFirstId: a new session's first history push is " + json_of(*results->array_items[1]));
		} else {
			held++;
		}
		// Every category is carried as given (newest first, so the list reads backwards).
		const JsonValue &all = *results->array_items.back();
		std::vector<std::string> carried;
		for (const auto &item : all.array_items) {
			if (item->find("category")) carried.insert(carried.begin(), item->get_string("category"));
		}
		std::vector<std::string> stated;
		if (categories && categories->is_array()) {
			for (const auto &cat : categories->array_items) stated.push_back(cat->as_string());
		}
		if (stated.empty() || carried != stated) {
			out.push_back("categories: pushed [" + joined(cats) + "], the log carried " + std::to_string(carried.size()));
		} else {
			held++;
		}
		return out;
	}
	if (area == "ui-minimap") {
		// Each feed list's id prefix: ingest one entry of that list on a new map; the one marker's id starts with
		// the stated prefix (the player's IS its prefix) and is one the feed owns (feedOwnedIds); the next empty
		// ingest retires it.
		const JsonValue *prefixes = contract.find("feedIdPrefixes");
		const JsonValue *owned = contract.find("feedOwnedIds");
		if (!prefixes || !prefixes->is_object() || prefixes->object_items.empty() || !owned || !owned->is_string()) {
			out.push_back("feedIdPrefixes: the contract states no prefixes or no feedOwnedIds");
			return out;
		}
		std::regex owns;
		try {
			owns = std::regex(owned->string_value, std::regex::ECMAScript);
		} catch (const std::regex_error &) {
			out.push_back("feedOwnedIds: not a pattern this runner can read");
			return out;
		}
		const std::map<std::string, std::string> entries = {
		    {"playerPosition", "{\"x\":1,\"z\":2}"},
		    {"settlements", "[{\"id\":\"p\",\"position\":{\"x\":1,\"z\":2}}]"},
		    {"npcPositions", "[{\"id\":\"p\",\"position\":{\"x\":1,\"z\":2}}]"},
		    {"questMarkers", "[{\"id\":\"p\",\"position\":{\"x\":1,\"z\":2}}]"},
		    {"questObjectiveMarkers", "[{\"id\":\"p\",\"position\":{\"x\":1,\"z\":2}}]"},
		    {"questItemMarkers", "[{\"id\":\"p\",\"position\":{\"x\":1,\"z\":2}}]"},
		    {"noticeBoards", "[{\"id\":\"p\",\"position\":{\"x\":1,\"z\":2},\"questCount\":1}]"},
		};
		int agree = 0;
		for (const auto &kv : prefixes->object_items) {
			auto e = entries.find(kv.first);
			if (e == entries.end()) {
				out.push_back("feedIdPrefixes: the feed list " + kv.first + " is not one this runner can probe");
				continue;
			}
			auto created = c.call("ui.minimap.create", "{}");
			const long long sid = session_of(created, "ui.minimap.create");
			const std::string head = "{\"session\":" + std::to_string(sid) + ",\"ops\":[{\"op\":\"ingest\",\"feed\":";
			JsonValuePtr r1, r;
			try {
				r1 = c.call("ui.minimap.apply", head + "{\"" + kv.first + "\":" + e->second + "}}]}");
				r = c.call("ui.minimap.apply", head + "{}}]}");
			} catch (...) {
				c.dispose(sid);
				throw;
			}
			c.dispose(sid);
			const JsonValue *markers = r1->find("view") ? r1->find("view")->find("markers") : nullptr;
			const JsonValue *after = r->find("view") ? r->find("view")->find("markers") : nullptr;
			const std::string prefix = kv.second->as_string();
			const std::string id = markers && markers->size() == 1 ? markers->array_items[0]->get_string("id") : std::string();
			if (id.empty() || id.rfind(prefix, 0) != 0 || !std::regex_search(id, owns) || !after || after->size() != 0) {
				out.push_back("feedIdPrefixes." + kv.first + ": stated " + prefix + ", ingested as " + (id.empty() ? "(no one marker)" : id) +
				              (after && after->size() == 0 ? "" : ", not retired by an empty feed"));
				continue;
			}
			agree++;
		}
		if (agree == static_cast<int>(prefixes->object_items.size())) held++;
		return out;
	}
	return out;
}

// ── the refusal probes ────────────────────────────────────────────────────────

struct Probes {
	int passed = 0, total = 0;
	void check(bool ok, const std::string &what) {
		total++;
		if (ok) passed++;
		else std::printf("  [FAIL] refusal probe: %s\n", what.c_str());
	}
};

bool invalid_input(Caller &c, const char *method, const std::string &args) {
	auto r = c.try_call(method, args);
	return !r && c.last_error.find("[invalid-input]") != std::string::npos;
}

// { ok: false, refusal: { code, field } } with this code and field.
bool refused_with(const JsonValuePtr &r, const char *code, const char *field) {
	const JsonValue *ok = r ? r->find("ok") : nullptr;
	const JsonValue *refusal = r ? r->find("refusal") : nullptr;
	return ok && ok->type == JsonType::Bool && !ok->bool_value && refusal && refusal->get_string("code") == code &&
	       refusal->get_string("field") == field;
}

void refusal_probes(Caller &c, Probes &p) {
	const std::string here = "\"position\":{\"x\":0,\"z\":0}";
	// 1. An op this runner does not know fails its case.
	for (const char *area : {"ui-compass", "ui-minimap", "ui-notifications"}) {
		bool refused = false;
		try {
			drive(c, area, "rotate", *parse("{}"));
		} catch (const DriveError &) {
			refused = true;
		}
		p.check(refused, std::string("an unknown op (rotate) was driven in ") + area);
	}
	// 2. What core refuses itself is core's VALUE, never a row error.
	p.check(refused_with(c.try_call("ui.compass.view", "{\"yaw\":\"0\",\"northYaw\":0," + here + ",\"markers\":[]}"), "not_finite", "yaw"),
	        "a yaw that is a string was not core's not_finite value");
	p.check(refused_with(c.try_call("ui.compass.worldView", "{\"yaw\":0,\"facing\":{\"x\":0,\"z\":1}," + here + ",\"markers\":[]}"), "facing_twice", "facing"),
	        "a facing given twice was not core's facing_twice value");
	p.check(refused_with(c.try_call("ui.compass.north", "{\"geography\":{\"georeference\":{\"rotationRad\":\"1\"}}}"), "not_finite",
	                     "georeference.rotationRad"),
	        "a rotation that is a string was not core's not_finite value");
	// 3. What core cannot read is the [invalid-input] ERROR.
	p.check(invalid_input(c, "ui.compass.view", "{\"yaw\":0,\"northYaw\":0,\"markers\":[]}"), "a view with no position was not [invalid-input]");
	p.check(invalid_input(c, "ui.compass.view", "{\"yaw\":0,\"northYaw\":0," + here + ",\"markers\":{}}"), "markers that are an object were not [invalid-input]");
	p.check(invalid_input(c, "ui.compass.worldView", "{\"facing\":[0,1]," + here + ",\"markers\":[]}"), "a facing that is an array was not [invalid-input]");
	p.check(invalid_input(c, "ui.compass.heading", "{\"yaw\":null,\"northYaw\":0}"), "a heading of a null yaw was not [invalid-input]");
	p.check(invalid_input(c, "ui.minimap.project", "{\"position\":{\"x\":1,\"z\":2},\"sizePx\":100}"), "a projected position with no y was not [invalid-input]");
	p.check(invalid_input(c, "ui.minimap.toneFor", "{\"type\":7}"), "a marker type that is a number was not [invalid-input]");
	// 4. An unknown row is the method table's error.
	{
		auto r = c.try_call("ui.compass.rotate", "{}");
		p.check(!r && c.last_error.find("unknown method") != std::string::npos, "an unknown row was answered");
	}
}

} // namespace

int main(int argc, char **argv) {
	bool negative = false;
	std::vector<std::string> files;
	for (int i = 1; i < argc; i++) {
		const std::string a = argv[i];
		if (a == "--negative") negative = true;
		else files.push_back(a);
	}
	if (files.empty()) {
		std::fprintf(stderr, "usage: insimulcore_ui_hud_corpus [--negative] <conformance/ui/<hud>-cases.json>...\n");
		return 2;
	}
	const char *tag = negative ? "ui_hud_corpus --negative" : "ui_hud_corpus";
	try {
		if (!self_test() || !contract_self_test()) {
			std::fprintf(stderr, "%s: the comparator, the perturbation or the contract check cannot tell a wrong answer from a right one\n", tag);
			return 2;
		}
	} catch (const std::exception &e) {
		std::fprintf(stderr, "%s: self-test: %s\n", tag, e.what());
		return 2;
	}

	insimul_core *core = insimul_core_create();
	if (!core) {
		std::fprintf(stderr, "%s: insimul_core_create() failed\n", tag);
		return 2;
	}
	std::printf("%s: %s\n", tag, insimul_core_version());
	Caller c{core, {}};
	int failed = 0;

	// The surface: a missing row would otherwise show only as every case failing.
	{
		std::set<std::string> table;
		auto m = c.try_call("core.methods", "{}");
		const JsonValue *list = m ? m->find("methods") : nullptr;
		if (list && list->is_array()) {
			for (const auto &x : list->array_items) table.insert(x->as_string());
		}
		for (const char *row : kRows) {
			if (!table.count(row)) {
				std::printf("  [FAIL] surface: the method table has no %s row\n", row);
				failed++;
			}
		}
	}

	Probes probes;
	refusal_probes(c, probes);
	if (probes.passed != probes.total) failed++;
	std::printf("refusals: %d of %d probe(s) refused as core refuses (values: not_finite, facing_twice; errors: [invalid-input], an "
	            "unknown row; an unknown op fails its case)\n",
	            probes.passed, probes.total);

	int total_all = 0, driven_all = 0, failed_cases = 0;
	const auto t0 = std::chrono::steady_clock::now();
	for (const std::string &file : files) {
		bool read_ok = false;
		const std::string text = read_file(file, read_ok);
		auto parsed = insimul::parse_json(text);
		if (!read_ok || !parsed.ok || !parsed.root->is_object()) {
			std::printf("  [FAIL] cannot read %s: %s\n", file.c_str(), parsed.error.c_str());
			failed++;
			continue;
		}
		const JsonValue &doc = *parsed.root;
		const std::string area_name = doc.get_string("area");
		const Area *a = area_of(area_name);
		const JsonValue *case_list = doc.find("cases");
		const JsonValue *contract = doc.find("contract");
		const JsonValue *tol_v = doc.find("tolerance");
		if (!a || !contract || !contract->is_object() || !tol_v || !tol_v->is_number()) {
			std::printf("  [FAIL] %s is not a HUD corpus (area ui-notifications, ui-compass or ui-minimap, a contract, a tolerance)\n", file.c_str());
			failed++;
			continue;
		}
		if (!case_list || !case_list->is_array() || case_list->size() == 0) {
			std::printf("  [FAIL] %s holds no case\n", file.c_str());
			failed++;
			continue;
		}
		const double tol = tol_v->number_value;
		std::printf("%s: tolerance %g, as the file states\n", a->area, tol);

		// The contract row: the keys it states.
		int row_agree = 0;
		{
			JsonValuePtr row;
			try {
				row = c.call(a->contract_row, "{}");
			} catch (const DriveError &e) {
				std::printf("  [FAIL] %s contract: %s\n", a->area, e.what());
				failed++;
			}
			if (row) {
				const std::vector<std::string> problems = contract_problems(*a, *contract, *row, row_agree);
				for (const std::string &why : problems) std::printf("  [FAIL] %s contract: %s\n", a->area, why.c_str());
				if (!problems.empty()) failed++;
			}
		}

		std::map<std::string, int> driven;
		int refused = 0, accepted = 0, total = 0, bit_exact = 0, case_failed = 0;
		Seen seen;
		for (const auto &cp : case_list->array_items) {
			const JsonValue &cs = *cp;
			const std::string name = cs.get_string("name");
			const std::string op = cs.get_string("op");
			const JsonValue *input = cs.find("input");
			const JsonValue *expected = cs.find("expected");
			total++;
			if (!input || !input->is_object() || !expected) {
				std::printf("  [FAIL] %s — needs an input object and an expected answer\n", name.c_str());
				case_failed++;
				continue;
			}
			JsonValuePtr actual;
			try {
				actual = drive(c, area_name, op, *input);
			} catch (const std::exception &e) {
				std::printf("  [FAIL] %s — not driven: %s\n", name.c_str(), e.what());
				case_failed++;
				continue;
			}
			note(seen, op, *actual);
			if (negative) {
				JsonValuePtr bad = deep_copy(*expected);
				sabotage_last(*bad);
				if (compare(*bad, *actual, tol, "$").empty()) {
					std::printf("  [FAIL] %s — a perturbed expectation was accepted\n", name.c_str());
					case_failed++;
					accepted++;
					continue;
				}
				refused++;
			} else {
				const std::string diff = compare(*expected, *actual, tol, "$");
				if (!diff.empty()) {
					std::printf("  [FAIL] %s — %s\n", name.c_str(), diff.c_str());
					case_failed++;
					continue;
				}
				if (compare(*expected, *actual, 0.0, "$").empty()) bit_exact++;
			}
			driven[op]++;
		}
		failed += case_failed;
		failed_cases += case_failed;

		// The contract keys this run measures.
		int measured_held = 0;
		try {
			const std::vector<std::string> problems = measured_problems(c, *a, *contract, seen, measured_held);
			for (const std::string &why : problems) std::printf("  [FAIL] %s contract: %s\n", a->area, why.c_str());
			if (!problems.empty()) failed++;
		} catch (const std::exception &e) {
			std::printf("  [FAIL] %s contract: measuring it failed: %s\n", a->area, e.what());
			failed++;
		}
		std::string by_cases;
		for (const std::string &k : a->by_cases) by_cases += (by_cases.empty() ? "" : ", ") + k;
		std::printf("%s contract: %zu key(s), whole: %d of %zu stated by %s agree; %d of %zu measured hold; pinned by the cases: %s\n",
		            a->area, contract->object_items.size(), row_agree, a->row_keys.size(), a->contract_row, measured_held,
		            a->measured.size(), by_cases.c_str());

		// Every op of core's runner is driven by at least one case.
		std::string by_op;
		int undriven = 0;
		int file_driven = 0;
		for (const std::string &o : a->ops) {
			const int n = driven.count(o) ? driven[o] : 0;
			file_driven += n;
			by_op += (by_op.empty() ? "" : ", ") + o + " " + std::to_string(n);
			if (n == 0) {
				std::printf("  [FAIL] %s op %s: no case of it was driven\n", a->area, o.c_str());
				failed++;
				undriven++;
			}
		}
		std::printf("%s: driven %s. %d undriven\n", a->area, by_op.c_str(), undriven);
		if (negative) {
			std::printf("%s: %d of %d perturbed case(s) refused, %d accepted\n", a->area, refused, total, accepted);
		} else {
			std::printf("%s: %d of %d case(s) driven through the rows, %d failed (within the file's tolerance %g; %d of them identical to "
			            "the last bit)\n",
			            a->area, file_driven, total, case_failed, tol, bit_exact);
		}
		total_all += total;
		driven_all += file_driven;
	}

	// No session left open.
	{
		auto l = c.try_call("session.list", "{}");
		const JsonValue *open = l ? l->find("sessions") : nullptr;
		if (!open || !open->is_array() || open->size() != 0) {
			std::printf("  [FAIL] sessions left open: %s\n", open ? json_of(*open).c_str() : "(session.list failed)");
			failed++;
		}
	}
	insimul_core_destroy(core);

	const double ms = std::chrono::duration<double, std::milli>(std::chrono::steady_clock::now() - t0).count();
	std::printf("%s: %zu file(s), %d of %d case(s) driven, %d case(s) failed, %d failure(s), %.0f ms\n", tag, files.size(), driven_all,
	            total_all, failed_cases, failed, ms);
	if (failed || driven_all == 0 || driven_all != total_all) {
		std::printf("%s: FAIL\n", tag);
		return 1;
	}
	std::printf("%s: PASS\n", tag);
	return 0;
}
