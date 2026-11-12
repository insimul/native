// traversal_corpus.cpp — core's P9e traversal corpora, driven through
// libinsimulcore's `traversal.*` rows.
//
// PL.native-traversal-rows (rulings U106(1), U107 and U36). Slice 1, core's P9e
// kernels (P9e.core: src/traversal/traversal.ts with its graph facts, vehicles.ts
// with vehicle-facts.ts, fast-travel.ts with fast-travel-facts.ts, and
// src/ground-seating/ground-seat.ts), and slice 2, its stateful layers
// (TraversalPlanner, VehicleRegistry and FastTravelDirector as one session,
// src/traversal/personal-vehicles.ts, mode-lending.ts and traversal-save.ts), are rows
// of corebridge/js/entry.js. This gate holds them to core's own corpora, COPIED byte
// for byte into corebridge/vendor/core/conformance/traversal/ at the pin and
// sha256-checked by the `core_vendor` ctest:
//
//   traversal/affordances.json     area traversal-affordances  (core's traversal-corpus test)
//   traversal/vehicles.json        area traversal-vehicles     (the same test)
//   traversal/fast-travel.json     area traversal-fast-travel  (the same test)
//   traversal/ground-seating.json  area traversal, file traversal/ground-seating
//                                  ops tuning, footprint, ground, target, stand, moved, settle
//                                  (core's runner src/traversal/systems-corpus.ts)
//   traversal/session.json         file traversal/session, op run (the same runner)
//   traversal/mounts.json          file traversal/mounts, ops tuning, pace, modes, run
//   traversal/save.json            file traversal/save, ops block, read, restore
//
// Nothing here re-writes a case or computes an answer: every answer comes out of a
// row. How each case is driven (core's own corpus test, which composes a case's
// record from core's functions, and core's systems-corpus runner are the
// references; this one composes the same record from the rows):
//
//   affordances {input, best, route}: traversal.affordances.resolve with `input` →
//   `affordances`; traversal.affordances.best {affordances, to: best} unless `best`
//   is null; traversal.affordances.route {...input, ...route} unless `route` is null;
//   traversal.affordances.graphFacts {links, tuning} → `graphFacts`. The record
//   `{ affordances, best, route, graphFacts }` is compared with `expected` whole, and
//   the case is driven AGAIN with `links`, `modes` and `blocked` reversed: its
//   affordances, best and route must not move (core's order guard).
//   vehicles {vehicle, state, actor, at, verb}: traversal.vehicles.resolve, then
//   .apply with that resolution → `next`; .actions, .seats, .modeFact {vehicle};
//   .stateFacts {state}; .stateDelta {before: state, after: next} (the empty delta
//   when `next` is null, core's test's own rule: a refused verb has no facts);
//   .anothers {state, actor}. Driven AGAIN with the occupants reversed: the
//   resolution and `next` must not move.
//   fast-travel {input}: traversal.affordances.route over the input's graph and its
//   `graphTuning`; when there is a route, traversal.fastTravel.plan over it, and
//   .arrival, .discovery {known: false} and {known: true}; the record `{ route, plan,
//   arrival, discovery, discoveryWhenAlreadyKnown }` (nulls when there is no route).
//   Each planned case also asks traversal.fastTravel.ceiling and .hours (with the
//   pinned route's cost), which must answer the PINNED plan's `ceiling` and `hours`.
//   Driven AGAIN with `links`, `modes` and `blocked` reversed: nothing may move.
//   ground-seating tuning/footprint/ground/target/stand/moved: the case's `input` is
//   traversal.groundSeating.<op>'s args AS IS and its answer is compared whole.
//   settle {params?, steps}: the state starts as traversal.groundSeating.initial
//   answers it; then per step `target` → .retarget {params, state, wantMm, at} and
//   .offsetAt {params, state, at}, recorded `{ do, state, offsetMm }`; `at` →
//   .offsetAt, recorded `{ do, offsetMm }`; `unseat` → .unseat, recorded `{ do,
//   state, offsetMm: 0 }` (core's runner records the 0 as written).
//   session run {links, tuning, vehicles, fastTravel, seed, stamina, probe, locomotion,
//   personal, steps}: ONE traversal.session.create with those (seed 'corpus' when the
//   case states none, as core's runner plays), then each step one
//   traversal.session.apply whose ops' answers compose core's runner's record: register
//   → register, locationOf, modesOf `{ location, modes }`; modes → setModes, modesOf;
//   affordances, route, destinations → that op; can → canTraverse `{ decision }`;
//   traverse → traverse, meter, roster `{ report, meter: current or null, orders,
//   vehicles, events }`; block/unblock → that op, isBlocked `{ delta, blocked }`;
//   board/drive/disembark → that op, modesOf `{ report, modes, events }`; discover →
//   discover, discoveries; fastTravel → fastTravel, locationOf, roster `{ report, clock,
//   location, orders, vehicles, events }`; mount/dismount/cycle → that op, modesOf
//   `{ ok, refusal?, detail?, kind, pace, label, modes, mountEvents, events }` (the op's
//   result; `mountEvents` its events); save → save `{ block }`; load → load with the
//   step's block, else the last save's (null before any), `{ ok:false, keys }` or `{ ok,
//   dropped, planner, vehicles, fastTravel, riding, events }` (the four from the view).
//   Every op answers what the hosts recorded while it ran; like core's runner, this one
//   keeps them pending and hands `events`, `orders` and `clock` to the next step that
//   records them. The session is disposed at the case's end.
//   mounts tuning {params} → traversal.personal.tuning; pace {kind, params} → .pace and
//   .label `{ pace, label }`; modes → .modes with the input as is; run {riding?, params,
//   steps}: the state starts as .initial (or .fromSave of `riding`), then mount, dismount,
//   cycle → that row with the state, recorded as its answer without `state` plus
//   `riding` (.saveRows); save → `{ riding }`; load → .fromSave `{ riding, dropped }`.
//   save block → traversal.save.block's `block`; read → traversal.save.read as is;
//   restore {block, vehicles, params} → a session created with `vehicles` and `personal:
//   params`, one `load` op: `{ ok:false, keys }`, or `{ ok, planner, vehicles,
//   fastTravel, riding, dropped }` from the view (a load that records anything fails).
//
// A step this runner does not know fails its case (never a skip). The run FAILS on a
// file whose area is not one of these, on a systems-corpus file's header (file, catalog,
// op list and steps) not being core's (TRAVERSAL_SYSTEMS_CORPUS_*), on a part or a
// header step no case drives (each file's line prints every part's count), on a row missing from the
// method table, on a session left open, and when its comparator or its reversal
// cannot fail (a self-test on every start). Comparison is the corpora's own rule:
// exact, object key sets included (the files carry no tolerance; a key core leaves
// undefined is absent).
//
// --negative perturbs EVERY case's expectation (its last leaf: a number +1, a string
// + "!", a boolean flipped, null → 0, an empty array or object given an element) and
// requires every case to be refused, the way Unreal's traversal_corpus_negative does
// (ctest traversal_corpus_negative).
//
// A pure consumer of insimulcore.h (no quickjs.h, no insimul.h). The JSON reader is
// tests/radiant/json_value.{h,cpp}, used as is.
//
// usage: insimulcore_traversal_corpus [--negative] <corpus.json>...

#include "insimulcore.h"
#include "radiant/json_value.h"

#include <algorithm>
#include <chrono>
#include <cmath>
#include <cstdio>
#include <fstream>
#include <functional>
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

// Append `key: value` when `value` is present (JavaScript's `{ key: x.key }` drops
// an undefined `x.key`; a null stays).
void add_if(Items &items, const std::string &key, const JsonValue *value) {
	if (value) items.emplace_back(key, copy_of(*value));
}

// `{ ...over }` keys copied into `items` (a later key replaces an earlier one).
void spread_into(Items &items, const JsonValue &over) {
	for (const auto &kv : over.object_items) {
		bool replaced = false;
		for (auto &it : items) {
			if (it.first == kv.first) {
				it.second = kv.second;
				replaced = true;
			}
		}
		if (!replaced) items.push_back(kv);
	}
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

// A case's expectation with its last leaf perturbed (the corpora carry no `{ ok, value }` envelope).
JsonValuePtr perturbed(const JsonValue &expected) {
	JsonValuePtr bad = deep_copy(expected);
	sabotage_last(*bad);
	return bad;
}

// `v` with each named member's array reversed (members absent or not arrays kept).
JsonValuePtr with_reversed(const JsonValue &v, const std::vector<std::string> &members) {
	JsonValuePtr out = deep_copy(v);
	for (auto &kv : out->object_items) {
		for (const std::string &m : members) {
			if (kv.first == m && kv.second->is_array()) {
				std::reverse(kv.second->array_items.begin(), kv.second->array_items.end());
			}
		}
	}
	return out;
}

bool self_test() {
	auto parse = [](const char *t) { return insimul::parse_json(t).root; };
	struct Probe {
		const char *expected, *actual;
		bool agree;
	} probes[] = {
	    {"{\"a\":1,\"b\":[true,\"x\"]}", "{\"b\":[true,\"x\"],\"a\":1.0}", true},
	    {"{\"a\":1}", "{\"a\":1.000001}", false},
	    {"{\"refusal\":\"mode\"}", "{\"refusal\":\"blocked\"}", false},
	    {"{\"a\":1}", "{\"a\":1,\"b\":null}", false},
	    {"{\"a\":1,\"b\":null}", "{\"a\":1}", false},
	    {"[1,2]", "[2,1]", false},
	    {"[1,2]", "[1,2,3]", false},
	    {"false", "0", false},
	    {"null", "0", false},
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
	    "{\"affordances\":[],\"best\":null,\"route\":null,\"graphFacts\":[\"traversal_link(a, b, walk).\"]}",
	    "{\"resolution\":{\"available\":true},\"next\":null,\"anothers\":false}",
	    "{\"route\":null,\"plan\":null,\"arrival\":null,\"discovery\":null,\"discoveryWhenAlreadyKnown\":null}",
	    "{\"retract\":[],\"assert\":[]}",
	    "[{\"do\":\"at\",\"offsetMm\":0}]",
	};
	for (const char *s : sources) {
		auto src = parse(s);
		auto bad = perturbed(*src);
		if (compare(*src, *bad, 0.0, "$").empty() || json_of(*src) != json_of(*parse(s))) {
			std::printf("  [FAIL] self-test: perturbing %s gave no difference, or changed the source\n", s);
			ok = false;
		}
	}
	// The order re-run reverses exactly the named members, and never its source.
	{
		auto src = parse("{\"links\":[1,2,3],\"modes\":[\"a\",\"b\"],\"from\":\"x\",\"blocked\":[]}");
		auto rev = with_reversed(*src, {"links", "modes", "blocked"});
		if (json_of(*rev) != "{\"links\":[3,2,1],\"modes\":[\"b\",\"a\"],\"from\":\"x\",\"blocked\":[]}" ||
		    json_of(*src) != "{\"links\":[1,2,3],\"modes\":[\"a\",\"b\"],\"from\":\"x\",\"blocked\":[]}") {
			std::printf("  [FAIL] self-test: the order re-run does not reverse exactly the named lists\n");
			ok = false;
		}
	}
	// The record helpers: an absent field stays absent, a null stays, a spread replaces.
	{
		auto step = parse("{\"do\":\"at\",\"params\":null}");
		Items items;
		add_if(items, "params", step->find("params"));
		add_if(items, "at", step->find("at"));
		Items spread = {{"to", parse("\"a\"")}, {"links", parse("[]")}};
		spread_into(spread, *parse("{\"to\":\"b\",\"maxSteps\":1}"));
		if (items.size() != 1 || !items[0].second->is_null() || spread.size() != 3 || spread[0].second->as_string() != "b") {
			std::printf("  [FAIL] self-test: the record helpers do not keep JavaScript's absent/null/spread rules\n");
			ok = false;
		}
	}
	return ok;
}

// ── calling the rows ──────────────────────────────────────────────────────────

struct Caller {
	insimul_core *core;
	std::string error;
	std::map<std::string, int> rows_called;

	// The parsed answer, or nullptr with `error` set.
	JsonValuePtr call(const std::string &method, const std::string &args) {
		rows_called[method]++;
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

	void dispose(const std::string &session) {
		insimul_core_call(core, "session.dispose", ("{\"session\":" + session + "}").c_str());
	}
};

// `key` of `v`, which must be present; sets `why` otherwise.
const JsonValue *need(const JsonValue &v, const char *key, const std::string &row, std::string &why) {
	const JsonValue *x = v.find(key);
	if (!x && why.empty()) why = row + " answered no '" + key + "'";
	return x;
}


// ── the areas ─────────────────────────────────────────────────────────────────

struct Area {
	std::string key;                // the file's `file` when it names one, else its `area`
	std::string area;               // the file's `area`
	std::vector<std::string> parts; // what each case drives, all of which some case must drive
	std::vector<std::string> rows;  // the rows driving it, which the method table must hold
	bool case_ops = false;          // cases carry an `op` (one of `parts`), core's systems-corpus shape
	// A systems-corpus file's header, core's TRAVERSAL_SYSTEMS_CORPUS_CATALOG and _STEPS for it.
	std::vector<std::string> catalog;
	std::map<std::string, std::vector<std::string>> steps;
};

const std::vector<Area> &areas() {
	static const std::vector<Area> list = {
	    {"traversal-affordances", "traversal-affordances", {"resolve", "best", "route", "graphFacts", "order"},
	     {"traversal.affordances.resolve", "traversal.affordances.best", "traversal.affordances.route",
	      "traversal.affordances.graphFacts"}},
	    {"traversal-vehicles", "traversal-vehicles",
	     {"resolve", "apply", "actions", "seats", "modeFact", "stateFacts", "stateDelta", "anothers", "order"},
	     {"traversal.vehicles.resolve", "traversal.vehicles.apply", "traversal.vehicles.actions", "traversal.vehicles.seats",
	      "traversal.vehicles.modeFact", "traversal.vehicles.stateFacts", "traversal.vehicles.stateDelta",
	      "traversal.vehicles.anothers"}},
	    {"traversal-fast-travel", "traversal-fast-travel", {"route", "plan", "ceiling", "hours", "arrival", "discovery", "order"},
	     {"traversal.affordances.route", "traversal.fastTravel.plan", "traversal.fastTravel.ceiling",
	      "traversal.fastTravel.hours", "traversal.fastTravel.arrival", "traversal.fastTravel.discovery"}},
	    // core's TRAVERSAL_SYSTEMS_CORPUS_OPS['traversal/ground-seating'], in order.
	    {"traversal/ground-seating", "traversal", {"tuning", "footprint", "ground", "target", "stand", "moved", "settle"},
	     {"traversal.groundSeating.tuning", "traversal.groundSeating.footprint", "traversal.groundSeating.ground",
	      "traversal.groundSeating.target", "traversal.groundSeating.stand", "traversal.groundSeating.moved",
	      "traversal.groundSeating.initial", "traversal.groundSeating.retarget", "traversal.groundSeating.offsetAt",
	      "traversal.groundSeating.unseat"},
	     true,
	     {"traversal-ground-seating"},
	     {{"settle", {"target", "at", "unseat"}}}},
	    // Slice 2: the stateful layers. core's TRAVERSAL_SYSTEMS_CORPUS_* for each file.
	    {"traversal/session", "traversal", {"run"},
	     {"traversal.session.create", "traversal.session.apply"},
	     true,
	     {"traversal-planner", "traversal-vehicles", "traversal-fast-travel"},
	     {{"run", {"register", "modes", "affordances", "route", "can", "traverse", "block", "unblock", "board", "drive", "disembark",
	               "discover", "destinations", "fastTravel", "mount", "dismount", "cycle", "save", "load"}}}},
	    {"traversal/mounts", "traversal", {"tuning", "pace", "modes", "run"},
	     {"traversal.personal.tuning", "traversal.personal.pace", "traversal.personal.label", "traversal.personal.modes",
	      "traversal.personal.initial", "traversal.personal.mount", "traversal.personal.dismount", "traversal.personal.cycle",
	      "traversal.personal.saveRows", "traversal.personal.fromSave"},
	     true,
	     {"traversal-vehicles"},
	     {{"run", {"mount", "dismount", "cycle", "save", "load"}}}},
	    {"traversal/save", "traversal", {"block", "read", "restore"},
	     {"traversal.save.block", "traversal.save.read", "traversal.session.create", "traversal.session.apply"},
	     true,
	     {"traversal-planner", "traversal-vehicles", "traversal-fast-travel"},
	     {}},
	};
	return list;
}

const Area *area_of(const JsonValue &doc) {
	const std::string key = doc.find("file") ? doc.get_string("file") : doc.get_string("area");
	for (const Area &a : areas()) {
		if (a.key == key && a.area == doc.get_string("area")) return &a;
	}
	return nullptr;
}

std::vector<std::string> strings_of(const JsonValue *v) {
	std::vector<std::string> out;
	if (v && v->is_array()) {
		for (const auto &x : v->array_items) out.push_back(x->as_string());
	}
	return out;
}

// Steps driven, per kind, across the run (printed per file).
std::map<std::string, int> g_steps;

// `answer[key]` of a row's answer, or nullptr with `why` set.
JsonValuePtr member(const JsonValuePtr &answer, const char *key, const std::string &row, std::string &why) {
	if (!answer) return nullptr;
	const JsonValue *x = need(*answer, key, row, why);
	return x ? copy_of(*x) : nullptr;
}

// Each part a case drove (for the file's driven line).
using Driven = std::map<std::string, int>;

// ── affordances ───────────────────────────────────────────────────────────────

// The record core's corpus test builds from core's functions: { affordances, best, route, graphFacts }.
JsonValuePtr affordance_record(Caller &c, const JsonValue &cs, const JsonValue &input, Driven *driven, std::string &why) {
	JsonValuePtr affordances = member(c.call("traversal.affordances.resolve", json_of(input)), "affordances",
	                                  "traversal.affordances.resolve", why);
	if (!affordances) return why.empty() ? (why = c.error, nullptr) : nullptr;
	if (driven) (*driven)["resolve"]++;
	const JsonValue *best_to = cs.find("best");
	const JsonValue *route_spec = cs.find("route");
	if (!best_to || !route_spec) return why = "the case states no `best` or no `route` (each may be null, not absent)", nullptr;
	JsonValuePtr best = std::make_shared<JsonValue>();
	if (!best_to->is_null()) {
		best = member(c.call("traversal.affordances.best", Items{{"affordances", affordances}, {"to", copy_of(*best_to)}}), "best",
		              "traversal.affordances.best", why);
		if (!best) return why.empty() ? (why = c.error, nullptr) : nullptr;
		if (driven) (*driven)["best"]++;
	}
	JsonValuePtr route = std::make_shared<JsonValue>();
	if (!route_spec->is_null()) {
		if (!route_spec->is_object()) return why = "the case's `route` is neither null nor an object", nullptr;
		Items args = input.object_items;
		spread_into(args, *route_spec);
		route = member(c.call("traversal.affordances.route", args), "route", "traversal.affordances.route", why);
		if (!route) return why.empty() ? (why = c.error, nullptr) : nullptr;
		if (driven) (*driven)["route"]++;
	}
	Items gargs;
	add_if(gargs, "links", input.find("links"));
	add_if(gargs, "tuning", input.find("tuning"));
	JsonValuePtr facts = member(c.call("traversal.affordances.graphFacts", gargs), "facts", "traversal.affordances.graphFacts", why);
	if (!facts) return why.empty() ? (why = c.error, nullptr) : nullptr;
	if (driven) (*driven)["graphFacts"]++;
	return make_object({{"affordances", affordances}, {"best", best}, {"route", route}, {"graphFacts", facts}});
}

bool drive_affordances(Caller &c, const JsonValue &cs, const JsonValue &expected, JsonValuePtr &out, Driven &driven,
                       std::string &why) {
	const JsonValue *input = cs.find("input");
	if (!input || !input->is_object()) return why = "the case has no input object", false;
	out = affordance_record(c, cs, *input, &driven, why);
	if (!out) return false;
	// The order guard: links, modes and closures reversed must not move a byte.
	JsonValuePtr flipped = affordance_record(c, cs, *with_reversed(*input, {"links", "modes", "blocked"}), nullptr, why);
	if (!flipped) return false;
	for (const char *k : {"affordances", "best", "route"}) {
		const JsonValue *e = expected.find(k);
		const JsonValue *a = flipped->find(k);
		const std::string diff = e && a ? compare(*e, *a, 0.0, std::string("$reversed.") + k) : std::string("$reversed: no ") + k;
		if (!diff.empty()) return why = "with links, modes and blocked reversed: " + diff, false;
	}
	driven["order"]++;
	return true;
}

// ── vehicles ──────────────────────────────────────────────────────────────────

bool vehicle_verb(Caller &c, const JsonValue &cs, const JsonValue &state, JsonValuePtr &resolution, JsonValuePtr &next,
                  std::string &why) {
	Items args;
	for (const char *k : {"vehicle", "actor", "at", "verb"}) add_if(args, k, cs.find(k));
	args.emplace_back("state", copy_of(state));
	resolution = member(c.call("traversal.vehicles.resolve", args), "resolution", "traversal.vehicles.resolve", why);
	if (!resolution) return why.empty() ? (why = c.error, false) : false;
	Items aargs = {{"state", copy_of(state)}};
	add_if(aargs, "actor", cs.find("actor"));
	add_if(aargs, "verb", cs.find("verb"));
	aargs.emplace_back("resolution", resolution);
	next = member(c.call("traversal.vehicles.apply", aargs), "next", "traversal.vehicles.apply", why);
	if (!next) return why.empty() ? (why = c.error, false) : false;
	return true;
}

bool drive_vehicles(Caller &c, const JsonValue &cs, const JsonValue &expected, JsonValuePtr &out, Driven &driven,
                    std::string &why) {
	const JsonValue *vehicle = cs.find("vehicle");
	const JsonValue *state = cs.find("state");
	if (!vehicle || !state || !state->is_object()) return why = "the case has no vehicle or no state", false;
	JsonValuePtr resolution, next;
	if (!vehicle_verb(c, cs, *state, resolution, next, why)) return false;
	driven["resolve"]++;
	driven["apply"]++;
	auto one = [&](const char *row, Items args, const char *key, const char *part) -> JsonValuePtr {
		JsonValuePtr v = member(c.call(row, args), key, row, why);
		if (!v && why.empty()) why = c.error;
		if (v) driven[part]++;
		return v;
	};
	JsonValuePtr actions = one("traversal.vehicles.actions", {{"vehicle", copy_of(*vehicle)}}, "actions", "actions");
	JsonValuePtr seats = actions ? one("traversal.vehicles.seats", {{"vehicle", copy_of(*vehicle)}}, "seats", "seats") : nullptr;
	JsonValuePtr mode = seats ? one("traversal.vehicles.modeFact", {{"vehicle", copy_of(*vehicle)}}, "fact", "modeFact") : nullptr;
	JsonValuePtr facts = mode ? one("traversal.vehicles.stateFacts", {{"state", copy_of(*state)}}, "facts", "stateFacts") : nullptr;
	if (!facts) return false;
	JsonValuePtr delta;
	if (next->is_null()) {
		// core's test: a refused verb produces no state and no facts.
		delta = make_object({{"retract", make_array({})}, {"assert", make_array({})}});
	} else {
		delta = one("traversal.vehicles.stateDelta", {{"before", copy_of(*state)}, {"after", next}}, "delta", "stateDelta");
		if (!delta) return false;
	}
	Items oargs = {{"state", copy_of(*state)}};
	add_if(oargs, "actor", cs.find("actor"));
	JsonValuePtr anothers = one("traversal.vehicles.anothers", oargs, "anothers", "anothers");
	if (!anothers) return false;
	out = make_object({{"resolution", resolution}, {"next", next}, {"actions", actions}, {"seats", seats}, {"modeFact", mode},
	                   {"stateFacts", facts}, {"delta", delta}, {"anothers", anothers}});
	// The order guard: the occupant list reversed must not move the resolution or the next state.
	JsonValuePtr flipped_resolution, flipped_next;
	if (!vehicle_verb(c, cs, *with_reversed(*state, {"occupants"}), flipped_resolution, flipped_next, why)) return false;
	const JsonValue *er = expected.find("resolution");
	const JsonValue *en = expected.find("next");
	std::string diff = er ? compare(*er, *flipped_resolution, 0.0, "$reversed.resolution") : "$reversed: no resolution";
	if (diff.empty()) diff = en ? compare(*en, *flipped_next, 0.0, "$reversed.next") : "$reversed: no next";
	if (!diff.empty()) return why = "with the occupants reversed: " + diff, false;
	driven["order"]++;
	return true;
}

// ── fast travel ───────────────────────────────────────────────────────────────

// The record core's corpus test builds: route first, then the plan priced from it.
JsonValuePtr fast_travel_record(Caller &c, const JsonValue &input, Driven *driven, std::string &why) {
	Items rargs;
	for (const char *k : {"actor", "from", "to", "links", "modes", "blocked"}) add_if(rargs, k, input.find(k));
	add_if(rargs, "tuning", input.find("graphTuning"));
	JsonValuePtr route = member(c.call("traversal.affordances.route", rargs), "route", "traversal.affordances.route", why);
	if (!route) return why.empty() ? (why = c.error, nullptr) : nullptr;
	if (driven) (*driven)["route"]++;
	auto null = [] { return std::make_shared<JsonValue>(); };
	if (route->is_null()) {
		return make_object({{"route", route}, {"plan", null()}, {"arrival", null()}, {"discovery", null()},
		                    {"discoveryWhenAlreadyKnown", null()}});
	}
	Items pargs;
	for (const char *k : {"seed", "actor", "from", "to", "journey"}) add_if(pargs, k, input.find(k));
	pargs.emplace_back("route", route);
	add_if(pargs, "tuning", input.find("tuning"));
	JsonValuePtr plan = member(c.call("traversal.fastTravel.plan", pargs), "plan", "traversal.fastTravel.plan", why);
	if (!plan) return why.empty() ? (why = c.error, nullptr) : nullptr;
	if (driven) (*driven)["plan"]++;
	Items aargs;
	for (const char *k : {"actor", "from", "to"}) add_if(aargs, k, input.find(k));
	JsonValuePtr arrival = member(c.call("traversal.fastTravel.arrival", aargs), "delta", "traversal.fastTravel.arrival", why);
	if (!arrival) return why.empty() ? (why = c.error, nullptr) : nullptr;
	if (driven) (*driven)["arrival"]++;
	JsonValuePtr disc[2];
	for (int known = 0; known < 2; known++) {
		Items dargs;
		add_if(dargs, "location", input.find("to"));
		dargs.emplace_back("known", make_bool(known == 1));
		disc[known] = member(c.call("traversal.fastTravel.discovery", dargs), "delta", "traversal.fastTravel.discovery", why);
		if (!disc[known]) return why.empty() ? (why = c.error, nullptr) : nullptr;
		if (driven) (*driven)["discovery"]++;
	}
	return make_object({{"route", route}, {"plan", plan}, {"arrival", arrival}, {"discovery", disc[0]},
	                    {"discoveryWhenAlreadyKnown", disc[1]}});
}

bool drive_fast_travel(Caller &c, const JsonValue &cs, const JsonValue &expected, JsonValuePtr &out, Driven &driven,
                       std::string &why) {
	const JsonValue *input = cs.find("input");
	if (!input || !input->is_object()) return why = "the case has no input object", false;
	out = fast_travel_record(c, *input, &driven, why);
	if (!out) return false;
	// The ceiling and the hours, each one row, held to the PINNED plan.
	const JsonValue *plan = expected.find("plan");
	if (plan && plan->is_object()) {
		Items targs;
		add_if(targs, "tuning", input->find("tuning"));
		JsonValuePtr ceiling = member(c.call("traversal.fastTravel.ceiling", targs), "ceiling", "traversal.fastTravel.ceiling", why);
		if (!ceiling) return why.empty() ? (why = c.error, false) : false;
		const JsonValue *route = plan->find("route");
		Items hargs = targs;
		hargs.emplace_back("routeCost", route && route->find("cost") ? copy_of(*route->find("cost")) : std::make_shared<JsonValue>());
		JsonValuePtr hours = member(c.call("traversal.fastTravel.hours", hargs), "hours", "traversal.fastTravel.hours", why);
		if (!hours) return why.empty() ? (why = c.error, false) : false;
		const JsonValue *pc = plan->find("ceiling");
		const JsonValue *ph = plan->find("hours");
		std::string diff = pc ? compare(*pc, *ceiling, 0.0, "$.plan.ceiling (traversal.fastTravel.ceiling)") : "$.plan: no ceiling";
		if (diff.empty()) diff = ph ? compare(*ph, *hours, 0.0, "$.plan.hours (traversal.fastTravel.hours)") : "$.plan: no hours";
		if (!diff.empty()) return why = diff, false;
		driven["ceiling"]++;
		driven["hours"]++;
	}
	// The order guard: the graph reversed must not move anything.
	JsonValuePtr flipped = fast_travel_record(c, *with_reversed(*input, {"links", "modes", "blocked"}), nullptr, why);
	if (!flipped) return false;
	const std::string diff = compare(expected, *flipped, 0.0, "$reversed");
	if (!diff.empty()) return why = "with links, modes and blocked reversed: " + diff, false;
	driven["order"]++;
	return true;
}

// ── ground seating ────────────────────────────────────────────────────────────

bool drive_settle(Caller &c, const JsonValue &input, JsonValuePtr &out, std::string &why) {
	const JsonValue *steps = input.find("steps");
	if (!steps || !steps->is_array()) return why = "a settle needs steps", false;
	JsonValuePtr state = member(c.call("traversal.groundSeating.initial", "{}"), "state", "traversal.groundSeating.initial", why);
	if (!state) return why.empty() ? (why = c.error, false) : false;
	const JsonValue *params = input.find("params");
	auto offset_at = [&](const JsonValue *at) -> JsonValuePtr {
		Items args;
		add_if(args, "params", params);
		args.emplace_back("state", state);
		add_if(args, "at", at);
		JsonValuePtr v = member(c.call("traversal.groundSeating.offsetAt", args), "offsetMm", "traversal.groundSeating.offsetAt", why);
		if (!v && why.empty()) why = c.error;
		return v;
	};
	std::vector<JsonValuePtr> record;
	for (const auto &sp : steps->array_items) {
		const JsonValue &step = *sp;
		const std::string d = step.get_string("do");
		if (d == "target") {
			Items args;
			add_if(args, "params", params);
			args.emplace_back("state", state);
			add_if(args, "wantMm", step.find("wantMm"));
			add_if(args, "at", step.find("at"));
			state = member(c.call("traversal.groundSeating.retarget", args), "state", "traversal.groundSeating.retarget", why);
			if (!state) return why.empty() ? (why = c.error, false) : false;
			JsonValuePtr off = offset_at(step.find("at"));
			if (!off) return false;
			record.push_back(make_object({{"do", make_string(d)}, {"state", state}, {"offsetMm", off}}));
		} else if (d == "at") {
			JsonValuePtr off = offset_at(step.find("at"));
			if (!off) return false;
			record.push_back(make_object({{"do", make_string(d)}, {"offsetMm", off}}));
		} else if (d == "unseat") {
			state = member(c.call("traversal.groundSeating.unseat", "{}"), "state", "traversal.groundSeating.unseat", why);
			if (!state) return why.empty() ? (why = c.error, false) : false;
			// core's runner records the unseated offset as the literal 0.
			record.push_back(make_object({{"do", make_string(d)}, {"state", state}, {"offsetMm", insimul::parse_json("0").root}}));
		} else {
			return why = "unknown settle step '" + d + "'", false;
		}
		g_steps[d]++;
	}
	out = make_array(record);
	return true;
}

bool drive_seating(Caller &c, const std::string &op, const JsonValue &input, JsonValuePtr &out, std::string &why) {
	if (op == "settle") return drive_settle(c, input, out, why);
	out = c.call("traversal.groundSeating." + op, json_of(input));
	if (!out) return why = c.error, false;
	return true;
}

// ── the stateful layers (slice 2) ─────────────────────────────────────────────

JsonValuePtr json_null() { return std::make_shared<JsonValue>(); }

// `{ op: name, ...the named fields of src that are present }`.
JsonValuePtr op_of(const char *name, const JsonValue &src, std::initializer_list<const char *> keys) {
	Items items = {{"op", make_string(name)}};
	for (const char *k : keys) add_if(items, k, src.find(k));
	return make_object(items);
}

// What the session's hosts recorded and no step has taken yet (core's runner keeps one
// list of each and takes it on the steps that record it).
struct Pending {
	std::vector<JsonValuePtr> events, orders, clock;
};

JsonValuePtr take(std::vector<JsonValuePtr> &list) {
	JsonValuePtr out = make_array(list);
	list.clear();
	return out;
}

// One traversal.session.apply; each result's recorded events, orders and clock join `p`.
bool session_apply(Caller &c, const JsonValuePtr &handle, const std::vector<JsonValuePtr> &ops, Pending &p,
                   std::vector<JsonValuePtr> &results, JsonValuePtr *view, std::string &why) {
	JsonValuePtr ans = c.call("traversal.session.apply", Items{{"session", handle}, {"ops", make_array(ops)}});
	if (!ans) return why = c.error, false;
	const JsonValue *rs = ans->find("results");
	if (!rs || !rs->is_array() || rs->size() != ops.size()) return why = "traversal.session.apply answered no result per op", false;
	results.clear();
	for (const auto &r : rs->array_items) {
		if (!r->is_object()) return why = "traversal.session.apply answered a result that is not an object", false;
		std::vector<JsonValuePtr> *into[3] = {&p.events, &p.orders, &p.clock};
		const char *keys[3] = {"events", "orders", "clock"};
		for (int k = 0; k < 3; k++) {
			const JsonValue *x = r->find(keys[k]);
			if (!x || !x->is_array()) return why = std::string("traversal.session.apply answered an op with no '") + keys[k] + "'", false;
			for (const auto &item : x->array_items) into[k]->push_back(item);
		}
		results.push_back(r);
	}
	if (view) {
		const JsonValue *v = ans->find("view");
		if (!v || !v->is_object()) return why = "traversal.session.apply answered no view", false;
		*view = copy_of(*v);
	}
	return true;
}

// Opens a session from `args`; disposes it when the scope ends.
struct SessionScope {
	Caller &c;
	JsonValuePtr handle;
	~SessionScope() {
		if (handle) c.dispose(json_of(*handle));
	}
};

bool open_session(Caller &c, const Items &args, SessionScope &scope, std::string &why) {
	JsonValuePtr ans = c.call("traversal.session.create", args);
	if (!ans) return why = c.error, false;
	const JsonValue *h = ans->find("session");
	if (!h || !h->is_number()) return why = "traversal.session.create answered no session handle", false;
	scope.handle = copy_of(*h);
	return true;
}

// `{ do, ...each (key, value) }`.
JsonValuePtr record_of(const std::string &d, Items items) {
	items.insert(items.begin(), {"do", make_string(d)});
	return make_object(items);
}

// session {links, tuning, vehicles, fastTravel, seed, stamina, probe, locomotion, personal, steps}: one
// traversal.session.create per case, then each step as core's runner records it, composed from the ops'
// answers (core's runner calls the same core functions; see the file header).
bool drive_session(Caller &c, const JsonValue &input, JsonValuePtr &out, std::string &why) {
	const JsonValue *steps = input.find("steps");
	if (!steps || !steps->is_array()) return why = "a run needs steps", false;
	Items cargs;
	for (const char *k : {"links", "tuning", "vehicles", "fastTravel", "stamina", "probe", "locomotion", "personal"}) {
		add_if(cargs, k, input.find(k));
	}
	// core's runner plays with seed 'corpus' when the case states none.
	cargs.emplace_back("seed", input.find("seed") ? copy_of(*input.find("seed")) : make_string("corpus"));
	SessionScope scope{c, nullptr};
	if (!open_session(c, cargs, scope, why)) return false;
	Pending p;
	JsonValuePtr last_save = json_null();
	std::vector<JsonValuePtr> rec, rs;
	auto res = [&](std::size_t i, const char *key) -> JsonValuePtr {
		const JsonValue *x = i < rs.size() ? rs[i]->find(key) : nullptr;
		if (!x) {
			if (why.empty()) why = std::string("traversal.session.apply answered no '") + key + "'";
			return nullptr;
		}
		return copy_of(*x);
	};
	for (const auto &sp : steps->array_items) {
		const JsonValue &step = *sp;
		const std::string d = step.get_string("do");
		const char *dn = d.c_str();
		JsonValuePtr view;
		if (d == "register") {
			if (!session_apply(c, scope.handle, {op_of("register", step, {"actor", "location", "modes"}), op_of("locationOf", step, {"actor"}),
			                                     op_of("modesOf", step, {"actor"})},
			                   p, rs, nullptr, why))
				return false;
			JsonValuePtr loc = res(1, "location"), modes = res(2, "modes");
			if (!loc || !modes) return false;
			Items items;
			if (!loc->is_null()) items.emplace_back("location", loc);  // core's undefined location is absent
			items.emplace_back("modes", modes);
			rec.push_back(record_of(d, items));
		} else if (d == "modes") {
			if (!session_apply(c, scope.handle, {op_of("setModes", step, {"actor", "modes"}), op_of("modesOf", step, {"actor"})}, p, rs, nullptr, why))
				return false;
			JsonValuePtr modes = res(1, "modes");
			if (!modes) return false;
			rec.push_back(record_of(d, {{"modes", modes}}));
		} else if (d == "affordances" || d == "route" || d == "destinations") {
			const char *op = d == "affordances" ? "affordances" : d == "route" ? "route" : "destinations";
			if (!session_apply(c, scope.handle, {d == "route" ? op_of(op, step, {"actor", "to"}) : op_of(op, step, {"actor"})}, p, rs, nullptr, why))
				return false;
			JsonValuePtr v = res(0, op);
			if (!v) return false;
			rec.push_back(record_of(d, {{op, v}}));
		} else if (d == "can") {
			if (!session_apply(c, scope.handle, {op_of("canTraverse", step, {"actor", "to"})}, p, rs, nullptr, why)) return false;
			JsonValuePtr v = res(0, "decision");
			if (!v) return false;
			rec.push_back(record_of(d, {{"decision", v}}));
		} else if (d == "traverse") {
			if (!session_apply(c, scope.handle, {op_of("traverse", step, {"actor", "to"}), op_of("meter", step, {"actor"}), op_of("roster", step, {})},
			                   p, rs, nullptr, why))
				return false;
			JsonValuePtr report = res(0, "report"), meter = res(1, "meter"), vehicles = res(2, "vehicles");
			if (!report || !meter || !vehicles) return false;
			// core's runner: stamina.get(actor)?.current ?? null.
			const JsonValue *current = meter->is_object() ? meter->find("current") : nullptr;
			rec.push_back(record_of(d, {{"report", report}, {"meter", current ? copy_of(*current) : json_null()}, {"orders", take(p.orders)},
			                            {"vehicles", vehicles}, {"events", take(p.events)}}));
		} else if (d == "block" || d == "unblock") {
			if (!session_apply(c, scope.handle, {op_of(dn, step, {"from", "to"}), op_of("isBlocked", step, {"from", "to"})}, p, rs, nullptr, why))
				return false;
			JsonValuePtr delta = res(0, "delta"), blocked = res(1, "blocked");
			if (!delta || !blocked) return false;
			rec.push_back(record_of(d, {{"delta", delta}, {"blocked", blocked}}));
		} else if (d == "board" || d == "drive" || d == "disembark") {
			if (!session_apply(c, scope.handle, {op_of(dn, step, {"actor", "vehicle"}), op_of("modesOf", step, {"actor"})}, p, rs, nullptr, why))
				return false;
			JsonValuePtr report = res(0, "report"), modes = res(1, "modes");
			if (!report || !modes) return false;
			rec.push_back(record_of(d, {{"report", report}, {"modes", modes}, {"events", take(p.events)}}));
		} else if (d == "discover") {
			if (!session_apply(c, scope.handle, {op_of("discover", step, {"location"}), op_of("discoveries", step, {})}, p, rs, nullptr, why))
				return false;
			JsonValuePtr delta = res(0, "delta"), discovered = res(1, "discovered");
			if (!delta || !discovered) return false;
			rec.push_back(record_of(d, {{"delta", delta}, {"discovered", discovered}}));
		} else if (d == "fastTravel") {
			if (!session_apply(c, scope.handle,
			                   {op_of("fastTravel", step, {"actor", "to"}), op_of("locationOf", step, {"actor"}), op_of("roster", step, {})}, p, rs,
			                   nullptr, why))
				return false;
			JsonValuePtr report = res(0, "report"), loc = res(1, "location"), vehicles = res(2, "vehicles");
			if (!report || !loc || !vehicles) return false;
			rec.push_back(record_of(d, {{"report", report}, {"clock", take(p.clock)}, {"location", loc}, {"orders", take(p.orders)},
			                            {"vehicles", vehicles}, {"events", take(p.events)}}));
		} else if (d == "mount" || d == "dismount" || d == "cycle") {
			if (!session_apply(c, scope.handle, {op_of(dn, step, {"actor", "kind"}), op_of("modesOf", step, {"actor"})}, p, rs, nullptr, why))
				return false;
			JsonValuePtr result = res(0, "result"), modes = res(1, "modes");
			if (!result || !modes || !result->is_object()) return why.empty() ? (why = "a personal op answered no result object", false) : false;
			Items items;
			for (const char *k : {"ok", "refusal", "detail", "kind", "pace", "label"}) add_if(items, k, result->find(k));
			items.emplace_back("modes", modes);
			const JsonValue *mount_events = result->find("events");
			if (!mount_events) return why = "a personal op's result has no events", false;
			items.emplace_back("mountEvents", copy_of(*mount_events));
			items.emplace_back("events", take(p.events));
			rec.push_back(record_of(d, items));
		} else if (d == "save") {
			if (!session_apply(c, scope.handle, {op_of("save", step, {})}, p, rs, nullptr, why)) return false;
			JsonValuePtr block = res(0, "block");
			if (!block) return false;
			last_save = block;
			rec.push_back(record_of(d, {{"block", block}}));
		} else if (d == "load") {
			// core's runner: a load with no block loads what the last save step wrote.
			Items op = {{"op", make_string("load")}, {"block", step.find("block") ? copy_of(*step.find("block")) : last_save}};
			if (!session_apply(c, scope.handle, {make_object(op)}, p, rs, &view, why)) return false;
			JsonValuePtr ok = res(0, "ok");
			if (!ok) return false;
			if (ok->type != JsonType::Bool || !ok->bool_value) {
				JsonValuePtr keys = res(0, "keys");
				if (!keys) return false;
				rec.push_back(record_of(d, {{"ok", ok}, {"keys", keys}}));
			} else {
				JsonValuePtr dropped = res(0, "dropped");
				if (!dropped) return false;
				Items items = {{"ok", ok}, {"dropped", dropped}};
				for (const char *k : {"planner", "vehicles", "fastTravel", "riding"}) {
					const JsonValue *x = view->find(k);
					if (!x) return why = std::string("the session's view has no '") + k + "'", false;
					items.emplace_back(k, copy_of(*x));
				}
				items.emplace_back("events", take(p.events));
				rec.push_back(record_of(d, items));
			}
		} else {
			return why = "unknown session step '" + d + "'", false;
		}
		g_steps[d]++;
	}
	out = make_array(rec);
	return true;
}

// mounts tuning/pace/modes/run through the traversal.personal.* rows (core's runner: pure functions).
bool drive_mounts(Caller &c, const std::string &op, const JsonValue &input, JsonValuePtr &out, std::string &why) {
	auto row = [&](const char *method, const Items &args) -> JsonValuePtr {
		JsonValuePtr v = c.call(method, args);
		if (!v) why = c.error;
		return v;
	};
	const JsonValue *params = input.find("params");
	auto with_params = [&](Items items) {
		add_if(items, "params", params);
		return items;
	};
	if (op == "tuning") {
		out = member(row("traversal.personal.tuning", with_params({})), "tuning", "traversal.personal.tuning", why);
		return out != nullptr;
	}
	if (op == "pace") {
		Items args = with_params({});
		add_if(args, "kind", input.find("kind"));
		JsonValuePtr pace = member(row("traversal.personal.pace", args), "pace", "traversal.personal.pace", why);
		JsonValuePtr label = pace ? member(row("traversal.personal.label", args), "label", "traversal.personal.label", why) : nullptr;
		if (!label) return false;
		out = make_object({{"pace", pace}, {"label", label}});
		return true;
	}
	if (op == "modes") {
		Items args = with_params({});
		for (const char *k : {"modes", "lent", "from", "to"}) add_if(args, k, input.find(k));
		out = row("traversal.personal.modes", args);
		return out != nullptr;
	}
	// run
	const JsonValue *steps = input.find("steps");
	if (!steps || !steps->is_array()) return why = "a run needs steps", false;
	JsonValuePtr state;
	if (input.find("riding")) {
		state = member(row("traversal.personal.fromSave", with_params({{"riding", copy_of(*input.find("riding"))}})), "state",
		               "traversal.personal.fromSave", why);
	} else {
		state = member(row("traversal.personal.initial", Items{}), "state", "traversal.personal.initial", why);
	}
	if (!state) return false;
	auto rows_of = [&](const JsonValuePtr &st) {
		return member(row("traversal.personal.saveRows", Items{{"state", st}}), "riding", "traversal.personal.saveRows", why);
	};
	std::vector<JsonValuePtr> rec;
	for (const auto &sp : steps->array_items) {
		const JsonValue &step = *sp;
		const std::string d = step.get_string("do");
		if (d == "mount" || d == "dismount" || d == "cycle") {
			Items args = with_params({{"state", state}});
			add_if(args, "actor", step.find("actor"));
			if (d == "mount") add_if(args, "kind", step.find("kind"));
			add_if(args, "inVehicle", step.find("inVehicle"));
			JsonValuePtr r = row(("traversal.personal." + d).c_str(), args);
			if (!r) return false;
			const JsonValue *next = r->find("state");
			if (!next) return why = "traversal.personal." + d + " answered no state", false;
			state = copy_of(*next);
			JsonValuePtr riding = rows_of(state);
			if (!riding) return false;
			Items items;
			for (const auto &kv : r->object_items) {
				if (kv.first != "state") items.push_back(kv);  // core's runner: `...r, state: undefined`
			}
			items.emplace_back("riding", riding);
			rec.push_back(record_of(d, items));
		} else if (d == "save") {
			JsonValuePtr riding = rows_of(state);
			if (!riding) return false;
			rec.push_back(record_of(d, {{"riding", riding}}));
		} else if (d == "load") {
			Items args = with_params({});
			add_if(args, "riding", step.find("riding"));
			JsonValuePtr back = row("traversal.personal.fromSave", args);
			if (!back) return false;
			JsonValuePtr dropped = member(back, "dropped", "traversal.personal.fromSave", why);
			JsonValuePtr next = member(back, "state", "traversal.personal.fromSave", why);
			if (!dropped || !next) return false;
			state = next;
			JsonValuePtr riding = rows_of(state);
			if (!riding) return false;
			rec.push_back(record_of(d, {{"riding", riding}, {"dropped", dropped}}));
		} else {
			return why = "unknown mounts step '" + d + "'", false;
		}
		g_steps[d]++;
	}
	out = make_array(rec);
	return true;
}

// save block/read through the traversal.save.* rows; restore through a session's `load` (each layer's
// restore(), then the view: each layer's serialize(), core's runner's restore op).
bool drive_save(Caller &c, const std::string &op, const JsonValue &input, JsonValuePtr &out, std::string &why) {
	if (op == "block") {
		Items args;
		for (const char *k : {"planner", "vehicles", "fastTravel", "riding"}) add_if(args, k, input.find(k));
		out = member(c.call("traversal.save.block", args), "block", "traversal.save.block", why);
		if (!out && why.empty()) why = c.error;
		return out != nullptr;
	}
	if (op == "read") {
		Items args;
		add_if(args, "block", input.find("block"));
		out = c.call("traversal.save.read", args);
		if (!out) why = c.error;
		return out != nullptr;
	}
	// restore
	Items cargs;
	add_if(cargs, "vehicles", input.find("vehicles"));
	add_if(cargs, "personal", input.find("params"));
	SessionScope scope{c, nullptr};
	if (!open_session(c, cargs, scope, why)) return false;
	Items op_items = {{"op", make_string("load")}};
	add_if(op_items, "block", input.find("block"));
	Pending p;
	std::vector<JsonValuePtr> rs;
	JsonValuePtr view;
	if (!session_apply(c, scope.handle, {make_object(op_items)}, p, rs, &view, why)) return false;
	if (!p.events.empty() || !p.orders.empty() || !p.clock.empty()) return why = "a load raised events, orders or clock advances", false;
	const JsonValue *ok = rs[0]->find("ok");
	if (!ok) return why = "the load answered no ok", false;
	if (ok->type != JsonType::Bool || !ok->bool_value) {
		const JsonValue *keys = rs[0]->find("keys");
		if (!keys) return why = "the refused load answered no keys", false;
		out = make_object({{"ok", copy_of(*ok)}, {"keys", copy_of(*keys)}});
		return true;
	}
	Items items = {{"ok", copy_of(*ok)}};
	for (const char *k : {"planner", "vehicles", "fastTravel", "riding"}) {
		const JsonValue *x = view->find(k);
		if (!x) return why = std::string("the session's view has no '") + k + "'", false;
		items.emplace_back(k, copy_of(*x));
	}
	const JsonValue *dropped = rs[0]->find("dropped");
	if (!dropped) return why = "the load answered no dropped", false;
	items.emplace_back("dropped", copy_of(*dropped));
	out = make_object(items);
	return true;
}

}  // namespace

int main(int argc, char **argv) {
	bool negative = false;
	std::vector<std::string> files;
	for (int i = 1; i < argc; i++) {
		const std::string a = argv[i];
		if (a == "--negative") negative = true;
		else files.push_back(a);
	}
	if (files.empty()) {
		std::fprintf(stderr, "usage: insimulcore_traversal_corpus [--negative] <corpus.json>...\n");
		return 2;
	}
	if (!self_test()) {
		std::fprintf(stderr, "traversal_corpus: the comparator, the perturbation or the reversal cannot tell a wrong answer from a right one\n");
		return 2;
	}
	insimul_core *core = insimul_core_create();
	if (!core) {
		std::fprintf(stderr, "traversal_corpus: insimul_core_create() failed\n");
		return 2;
	}
	std::printf("traversal_corpus%s: %s\n", negative ? " --negative" : "", insimul_core_version());
	Caller c{core, {}, {}};

	int failed = 0, total_driven = 0, total_cases = 0, refused = 0, accepted = 0;
	std::set<std::string> table;
	{
		auto m = c.call("core.methods", "{}");
		const JsonValue *list = m ? m->find("methods") : nullptr;
		if (list && list->is_array()) {
			for (const auto &x : list->array_items) table.insert(x->as_string());
		}
	}

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
		const Area *area = area_of(doc);
		if (!area) {
			std::printf("  [FAIL] %s — area '%s' (file '%s') is not one this runner drives\n", file.c_str(),
			            doc.get_string("area").c_str(), doc.get_string("file").c_str());
			failed++;
			continue;
		}
		const JsonValue *case_list = doc.find("cases");
		if (!case_list || !case_list->is_array() || case_list->size() == 0) {
			std::printf("  [FAIL] %s — holds no case\n", file.c_str());
			failed++;
			continue;
		}
		const JsonValue *tol_v = doc.find("tolerance");
		const double tol = tol_v && tol_v->is_number() ? tol_v->number_value : 0.0;
		std::printf("── %s (%s, %zu case(s))\n", file.c_str(), area->key.c_str(), case_list->size());

		// A systems-corpus file's header is core's: its catalog, its op list and its steps, in order.
		if (area->case_ops) {
			const JsonValue *steps = doc.find("steps");
			const bool same_ops = strings_of(doc.find("ops")) == area->parts;
			const bool same_catalog = strings_of(doc.find("catalog")) == area->catalog;
			bool same_steps = steps && steps->is_object() && steps->object_items.size() == area->steps.size();
			std::size_t step_count = 0;
			for (const auto &kv : area->steps) {
				same_steps = same_steps && strings_of(steps->find(kv.first)) == kv.second;
				step_count += kv.second.size();
			}
			if (!same_ops || !same_catalog || !same_steps) {
				std::printf("  [FAIL] header: the file's catalog, ops or steps are not core's (catalog %s; ops %s; steps %s)\n",
				            same_catalog ? "agree" : "differ", same_ops ? "agree" : "differ", same_steps ? "agree" : "differ");
				failed++;
			} else {
				std::string cat;
				for (const std::string &x : area->catalog) cat += (cat.empty() ? "" : ", ") + x;
				std::printf("  header: catalog %s, %zu op(s) and %zu step(s), core's\n", cat.c_str(), area->parts.size(), step_count);
			}
		}

		// The surface: a missing row would otherwise show only as every case failing.
		for (const std::string &row : area->rows) {
			if (!table.count(row)) {
				std::printf("  [FAIL] surface: the method table has no %s row\n", row.c_str());
				failed++;
			}
		}

		g_steps.clear();
		Driven driven;
		int file_undriven = 0, file_refused = 0, file_accepted = 0;
		for (const auto &cp : case_list->array_items) {
			const JsonValue &cs = *cp;
			const std::string name = cs.get_string("name");
			const JsonValue *expected = cs.find("expected");
			total_cases++;
			if (!expected) {
				std::printf("  [FAIL] %s — has no expected answer\n", name.c_str());
				failed++;
				file_undriven++;
				continue;
			}
			JsonValuePtr actual;
			std::string why_case;
			Driven case_driven;
			bool ok = false;
			if (area->case_ops) {
				const std::string op = cs.get_string("op");
				const JsonValue *input = cs.find("input");
				bool known = false;
				for (const std::string &o : area->parts) known = known || o == op;
				if (!known) why_case = "op '" + op + "' is not one of " + area->key + "'s";
				else if (!input || !input->is_object()) why_case = "the case has no input object";
				else {
					if (area->key == "traversal/ground-seating") ok = drive_seating(c, op, *input, actual, why_case);
					else if (area->key == "traversal/session") ok = drive_session(c, *input, actual, why_case);
					else if (area->key == "traversal/mounts") ok = drive_mounts(c, op, *input, actual, why_case);
					else ok = drive_save(c, op, *input, actual, why_case);
					if (ok) case_driven[op]++;
				}
			} else if (area->key == "traversal-affordances") {
				ok = drive_affordances(c, cs, *expected, actual, case_driven, why_case);
			} else if (area->key == "traversal-vehicles") {
				ok = drive_vehicles(c, cs, *expected, actual, case_driven, why_case);
			} else {
				ok = drive_fast_travel(c, cs, *expected, actual, case_driven, why_case);
			}
			if (!ok) {
				std::printf("  [FAIL] %s — not driven: %s\n", name.c_str(), why_case.c_str());
				failed++;
				file_undriven++;
				continue;
			}
			if (negative) {
				JsonValuePtr bad = perturbed(*expected);
				const std::string diff = compare(*bad, *actual, tol, "$");
				if (diff.empty()) {
					std::printf("  [FAIL] %s — a perturbed expectation was accepted\n", name.c_str());
					failed++;
					file_accepted++;
				} else {
					file_refused++;
				}
			} else {
				const std::string diff = compare(*expected, *actual, tol, "$");
				if (!diff.empty()) {
					std::printf("  [FAIL] %s — %s\n", name.c_str(), diff.c_str());
					failed++;
					continue;
				}
			}
			for (const auto &kv : case_driven) driven[kv.first] += kv.second;
			total_driven++;
		}
		std::string by_part;
		for (const std::string &p : area->parts) {
			if (!driven.count(p)) {
				std::printf("  [FAIL] %s of %s: no case drove it\n", p.c_str(), area->key.c_str());
				failed++;
			}
			by_part += (by_part.empty() ? "" : ", ") + p + " " + std::to_string(driven.count(p) ? driven[p] : 0);
		}
		std::printf("  %s: %zu case(s), driven %s; %d undriven\n", area->key.c_str(), case_list->size(), by_part.c_str(),
		            file_undriven);
		// Every step the header declares, driven at least once.
		for (const auto &kv : area->steps) {
			for (const std::string &s : kv.second) {
				if (!g_steps.count(s)) {
					std::printf("  [FAIL] %s step '%s' of %s: no case drove it\n", kv.first.c_str(), s.c_str(), area->key.c_str());
					failed++;
				}
			}
		}
		if (!g_steps.empty()) {
			std::string by_step;
			for (const auto &kv : g_steps) by_step += (by_step.empty() ? "" : ", ") + kv.first + " " + std::to_string(kv.second);
			std::printf("  steps through the rows: %s\n", by_step.c_str());
		}
		if (negative) {
			std::printf("  negative: %d of %zu perturbed expectation(s) refused, %d accepted\n", file_refused, case_list->size(),
			            file_accepted);
			refused += file_refused;
			accepted += file_accepted;
		}
	}

	// Rows called, for the record.
	{
		std::string calls;
		for (const auto &kv : c.rows_called) {
			if (kv.first.rfind("traversal.", 0) == 0) calls += (calls.empty() ? "" : ", ") + kv.first + " " + std::to_string(kv.second);
		}
		std::printf("rows called: %s\n", calls.c_str());
	}

	// No session left open.
	{
		auto l = c.call("session.list", "{}");
		const JsonValue *open = l ? l->find("sessions") : nullptr;
		if (!open || !open->is_array() || open->size() != 0) {
			std::printf("  [FAIL] sessions left open: %s\n", open ? json_of(*open).c_str() : "(session.list failed)");
			failed++;
		}
	}
	insimul_core_destroy(core);

	const double ms = std::chrono::duration<double, std::milli>(std::chrono::steady_clock::now() - t0).count();
	if (negative) {
		std::printf("traversal_corpus --negative: %d of %d perturbed case(s) refused, %d accepted, %d failure(s), %.0f ms\n", refused,
		            total_cases, accepted, failed, ms);
		if (failed || refused != total_cases || total_cases == 0) {
			std::printf("traversal_corpus --negative: FAIL\n");
			return 1;
		}
		std::printf("traversal_corpus --negative: PASS\n");
		return 0;
	}
	std::printf("traversal_corpus: %d of %d case(s) driven through the rows, %d failed, %.0f ms\n", total_driven, total_cases, failed, ms);
	if (failed || total_driven == 0 || total_driven != total_cases) {
		std::printf("traversal_corpus: FAIL\n");
		return 1;
	}
	std::printf("traversal_corpus: PASS\n");
	return 0;
}
