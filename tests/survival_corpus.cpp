// survival_corpus.cpp — core's P9c survival corpora, driven through
// libinsimulcore's `survival.*` rows.
//
// PL.native-survival-rows (rulings U106(1) and U36). Core's P9c logic (P9c.core and
// PL.core-survival-rules: src/survival/needs.ts, survival-hud.ts,
// survival-systems.ts, src/stamina/stamina.ts and game-engine/logic/StaminaPool.ts)
// is a set of rows of corebridge/js/entry.js. This gate holds them to core's own
// corpora, COPIED byte for byte into corebridge/vendor/core/conformance/survival/ at
// the pin and sha256-checked by the `core_vendor` ctest:
//
//   survival/needs.json    area survival-needs    tuning, initial, run, save, load
//   survival/hud.json      area survival-hud      view, run, systems
//   survival/stamina.json  area survival-stamina  tuning, bands, spend, regen, pool, clock
//
// Nothing here re-writes a case or computes an answer: every answer comes out of a
// row. How each op is driven (core's runner, src/survival/systems-corpus.ts
// `runSurvivalOp`, is the reference, and this one drives the rows the way it drives
// core's functions):
//
//   needs tuning/initial/save/load, hud view, stamina tuning/spend/regen: the case's
//   `input` is the row's args AS IS (`survival.needs.<op>`, `survival.hud.view`,
//   `survival.stamina.<op>`), and the row's answer (`{ ok, value }`, or `{ ok: false,
//   refusal }`) is compared whole.
//   hud systems {request}: `survival.hud.systems` with the case's input and core's
//   pack catalog beside it (`catalog: { index, manifests }`, read from the vendored
//   catalog `conformance/packs/composition.json` names, as packs_corpus sends it).
//   needs run / hud run {survival?, params?, start?, stamina?, visible?,
//   staminaConfig?, steps}: the state starts as `survival.needs.initial {survival,
//   params, at: start}` answers it and the HUD's as `survival.hud.initial` does;
//   then ONE row per step, each sent the state the last answer carried:
//     advance → survival.needs.advance; restore → .restore; action → .action;
//     consume → .consume; use_item → .useItem; set_temperature → .setTemperature;
//     modifier → .modifier (`modifier` is the step's `preset`, else its `modifier`);
//     remove_modifier → .removeModifier; enable → .enable; save → .save;
//     stamina → survival.hud.stamina, with survival.stamina.state for the meter's
//     band; view → survival.hud.view (now = the step's `at`).
//   Every needs answer's `events` go through survival.hud.reduce, as core's runner
//   reduces them (a refused change's are not). Each step is recorded in core's
//   runner's shape (`{ do, … }`), taken from the rows' answers and the step's own
//   fields, and the run answers `{ ok: true, value: { steps } }`.
//   stamina bands {readings, staminaConfig?}: `survival.stamina.state` per reading →
//   `{ ...reading, state }`.
//   stamina clock {start?, readings, tickMs?}: `survival.stamina.clock {lastTickAt,
//   now, tickMs}` per reading, `lastTickAt` carried from the last answer →
//   `{ now, ticks, lastTickAt }`.
//   stamina pool {staminaConfig?, costs?, actions?, actors?, survivalActorId?,
//   start?, steps}: `survival.stamina.pool.create` with the input less `steps`, then
//   ONE `survival.stamina.pool.apply` per step (`do` sent as `op`), recorded in core's
//   shape → `{ ok: true, value: { tuning: <the session's view>, steps } }`.
//
// A step this runner does not know fails its case (never a skip), as does an op that
// is not one of the area's. The run FAILS on a file whose area, catalog or op list is
// not core's (`SURVIVAL_CORPUS_OPS`, `SURVIVAL_CORPUS_CATALOG`), on an op no case
// drives, on a row missing from the method table, on a session left open, and when
// its comparator cannot fail (a self-test on every start). Comparison is the
// corpora's own rule: exact, object key sets included (the files carry no
// tolerance; a key core leaves undefined is absent).
//
// --negative perturbs EVERY case's expectation (the last leaf of its `value`, or of
// its `refusal`; a number +1, a string + "!", a boolean flipped, null → 0, an empty
// array or object given an element) and requires every case to be refused, the way
// Unreal's survival_corpus_negative does (ctest survival_corpus_negative).
//
// A pure consumer of insimulcore.h (no quickjs.h, no insimul.h). The JSON reader is
// tests/radiant/json_value.{h,cpp}, used as is.
//
// usage: insimulcore_survival_corpus [--negative] <core-root> <corpus.json>...
//   <core-root> is the vendored core directory (corebridge/vendor/core): the pack
//   catalog is the one its conformance/packs/composition.json names.

#include "insimulcore.h"
#include "radiant/json_value.h"

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

// A case's expectation, perturbed inside its `value` (or `refusal`), else anywhere.
JsonValuePtr perturbed(const JsonValue &expected) {
	JsonValuePtr bad = deep_copy(expected);
	for (auto &kv : bad->object_items) {
		if (kv.first == "value" || kv.first == "refusal") {
			sabotage_last(*kv.second);
			return bad;
		}
	}
	sabotage_last(*bad);
	return bad;
}

bool self_test() {
	auto parse = [](const char *t) { return insimul::parse_json(t).root; };
	struct Probe {
		const char *expected, *actual;
		bool agree;
	} probes[] = {
	    {"{\"a\":1,\"b\":[true,\"x\"]}", "{\"b\":[true,\"x\"],\"a\":1.0}", true},
	    {"{\"a\":1}", "{\"a\":1.000001}", false},
	    {"{\"ok\":false,\"refusal\":{\"code\":\"x\",\"field\":\"block\"}}", "{\"ok\":false,\"refusal\":{\"code\":\"y\",\"field\":\"block\"}}", false},
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
	    "{\"ok\":true,\"value\":{\"steps\":[{\"do\":\"advance\",\"needs\":[{\"band\":\"ok\"}],\"damageOwed\":0}]}}",
	    "{\"ok\":false,\"refusal\":{\"code\":\"unreadable_survival\",\"field\":\"block\",\"keys\":[]}}",
	    "{\"ok\":true,\"value\":[]}",
	    "{\"ok\":true,\"value\":{\"hurt\":null}}",
	    "{\"ok\":true,\"value\":{\"enabled\":false}}",
	};
	for (const char *s : sources) {
		auto src = parse(s);
		auto bad = perturbed(*src);
		if (compare(*src, *bad, 0.0, "$").empty() || json_of(*src) != json_of(*parse(s))) {
			std::printf("  [FAIL] self-test: perturbing %s gave no difference, or changed the source\n", s);
			ok = false;
		}
	}
	// The record helpers: an absent field stays absent, a null stays, a spread replaces.
	{
		auto step = parse("{\"do\":\"band\",\"actor\":null}");
		Items items;
		add_if(items, "actor", step->find("actor"));
		add_if(items, "at", step->find("at"));
		Items spread = {{"current", parse("1")}, {"state", parse("\"x\"")}};
		spread_into(spread, *parse("{\"state\":\"fresh\"}"));
		if (items.size() != 1 || !items[0].second->is_null() || spread.size() != 2 || spread[1].second->as_string() != "fresh") {
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

// The `value` of a `{ ok: true, value }` answer, or nullptr with `why` set.
const JsonValue *ok_value(const JsonValue &answer, const std::string &row, std::string &why) {
	const JsonValue *ok = answer.find("ok");
	const JsonValue *value = answer.find("value");
	if (!ok || ok->type != JsonType::Bool || !ok->bool_value || !value) {
		why = row + " answered no { ok: true, value }: " + json_of(answer);
		return nullptr;
	}
	return value;
}

JsonValuePtr ok_of(JsonValuePtr value) { return make_object({{"ok", make_bool(true)}, {"value", std::move(value)}}); }

// ── the areas ─────────────────────────────────────────────────────────────────

struct Area {
	std::string name;     // the file's `area`
	std::string catalog;  // the file's `catalog` (core's SURVIVAL_CORPUS_CATALOG)
	std::vector<std::string> ops;  // core's SURVIVAL_CORPUS_OPS for the file, in order
	std::vector<std::string> rows; // the rows driving it, which the method table must hold
};

const std::vector<Area> &areas() {
	static const std::vector<std::string> needs_rows = {
	    "survival.needs.tuning",   "survival.needs.initial",        "survival.needs.advance",
	    "survival.needs.restore",  "survival.needs.action",         "survival.needs.consume",
	    "survival.needs.useItem",  "survival.needs.setTemperature", "survival.needs.modifier",
	    "survival.needs.removeModifier", "survival.needs.enable",   "survival.needs.save",
	    "survival.needs.load",     "survival.hud.initial",          "survival.hud.reduce",
	    "survival.hud.stamina",    "survival.hud.view",             "survival.stamina.state",
	};
	static const std::vector<Area> list = {
	    {"survival-needs", "survival-needs", {"tuning", "initial", "run", "save", "load"}, needs_rows},
	    {"survival-hud", "survival-needs", {"view", "run", "systems"}, [] {
		     auto r = needs_rows;
		     r.push_back("survival.hud.systems");
		     return r;
	     }()},
	    {"survival-stamina", "survival-stamina", {"tuning", "bands", "spend", "regen", "pool", "clock"},
	     {"survival.stamina.tuning", "survival.stamina.state", "survival.stamina.spend", "survival.stamina.regen",
	      "survival.stamina.clock", "survival.stamina.pool.create", "survival.stamina.pool.apply"}},
	};
	return list;
}

const Area *area_named(const std::string &name) {
	for (const Area &a : areas()) {
		if (a.name == name) return &a;
	}
	return nullptr;
}

// Steps driven, per kind, across the run (printed per file).
std::map<std::string, int> g_steps;

// ── needs:run and hud:run ─────────────────────────────────────────────────────

bool drive_needs_run(Caller &c, const JsonValue &input, JsonValuePtr &out, std::string &why) {
	const JsonValue *steps = input.find("steps");
	if (!steps || !steps->is_array()) return why = "steps is not an array", false;
	// What every needs row reads the tuning from, and the stamina rows theirs.
	Items tuning;
	add_if(tuning, "survival", input.find("survival"));
	add_if(tuning, "params", input.find("params"));
	Items stamina_tuning;
	add_if(stamina_tuning, "staminaConfig", input.find("staminaConfig"));

	Items init = tuning;
	add_if(init, "at", input.find("start"));
	auto initial = c.call("survival.needs.initial", init);
	if (!initial) return why = c.error, false;
	const JsonValue *s0 = ok_value(*initial, "survival.needs.initial", why);
	if (!s0) return false;
	JsonValuePtr state = copy_of(*s0);
	auto hud0 = c.call("survival.hud.initial", Items{});
	if (!hud0) return why = c.error, false;
	const JsonValue *h0 = need(*hud0, "hud", "survival.hud.initial", why);
	if (!h0) return false;
	JsonValuePtr hud = copy_of(*h0);
	JsonValuePtr stamina;  // the last stamina reading, { current, max }, or none
	if (const JsonValue *st = input.find("stamina")) {
		if (!st->is_null()) stamina = copy_of(*st);
	}

	// The HUD takes a needs answer's events.
	auto reduce = [&](const JsonValue &events) -> bool {
		auto r = c.call("survival.hud.reduce", Items{{"hud", hud}, {"events", copy_of(events)}});
		if (!r) return why = c.error, false;
		const JsonValue *h = need(*r, "hud", "survival.hud.reduce", why);
		if (!h) return false;
		hud = copy_of(*h);
		return true;
	};
	// One needs row over the state: `extra` are the step's own fields.
	auto needs_row = [&](const std::string &row, Items extra) -> JsonValuePtr {
		Items args = tuning;
		args.emplace_back("state", state);
		for (auto &kv : extra) args.push_back(std::move(kv));
		auto r = c.call(row, args);
		if (!r) {
			why = c.error;
			return nullptr;
		}
		return r;
	};
	auto needs_of = [&](Items &rec) {
		if (const JsonValue *n = state->find("needs")) rec.emplace_back("needs", copy_of(*n));
	};
	// core's `change`: a SurvivalChange, `extra` the state fields its record carries.
	auto change = [&](const JsonValue &step, const std::string &row, Items fields,
	                  const std::vector<std::string> &extra, Items &rec) -> bool {
		auto r = needs_row(row, std::move(fields));
		if (!r) return false;
		const JsonValue *ok = need(*r, "ok", row, why);
		const JsonValue *st = need(*r, "state", row, why);
		if (!ok || !st) return false;
		state = copy_of(*st);
		add_if(rec, "do", step.find("do"));
		if (ok->type != JsonType::Bool || !ok->bool_value) {
			rec.emplace_back("ok", make_bool(false));
			add_if(rec, "reason", r->find("reason"));
		} else {
			const JsonValue *events = need(*r, "events", row, why);
			if (!events || !reduce(*events)) return false;
			rec.emplace_back("ok", make_bool(true));
			rec.emplace_back("events", copy_of(*events));
		}
		for (const std::string &k : extra) add_if(rec, k, state->find(k));
		return true;
	};

	std::vector<JsonValuePtr> records;
	for (const auto &sp : steps->array_items) {
		const JsonValue &step = *sp;
		const std::string kind = step.get_string("do");
		const JsonValue *at = step.find("at");
		auto field = [&](const char *key) -> Items {
			Items it;
			add_if(it, key, step.find(key));
			return it;
		};
		auto with_at = [&](Items it) {
			add_if(it, "at", at);
			return it;
		};
		Items rec;
		if (kind == "advance") {
			auto r = needs_row("survival.needs.advance", with_at({}));
			if (!r) return false;
			const JsonValue *st = need(*r, "state", "survival.needs.advance", why);
			const JsonValue *events = need(*r, "events", "survival.needs.advance", why);
			if (!st || !events) return false;
			state = copy_of(*st);
			if (!reduce(*events)) return false;
			rec.emplace_back("do", make_string("advance"));
			add_if(rec, "at", at);
			for (const char *k : {"ticks", "skipped", "events", "expired", "hurt"}) add_if(rec, k, r->find(k));
			needs_of(rec);
			add_if(rec, "damageOwed", state->find("damageOwed"));
		} else if (kind == "restore") {
			Items f = field("need");
			add_if(f, "amount", step.find("amount"));
			if (!change(step, "survival.needs.restore", with_at(f), {"needs"}, rec)) return false;
		} else if (kind == "action") {
			Items f = field("action");
			add_if(f, "amount", step.find("amount"));
			if (!change(step, "survival.needs.action", with_at(f), {"needs"}, rec)) return false;
		} else if (kind == "set_temperature") {
			if (!change(step, "survival.needs.setTemperature", with_at(field("value")), {"environmentTemperature", "needs"}, rec)) return false;
		} else if (kind == "modifier") {
			// core's runner: `step.preset ?? step.modifier`.
			const JsonValue *preset = step.find("preset");
			Items f;
			if (preset && !preset->is_null()) f.emplace_back("modifier", copy_of(*preset));
			else add_if(f, "modifier", step.find("modifier"));
			if (!change(step, "survival.needs.modifier", with_at(f), {"modifiers"}, rec)) return false;
		} else if (kind == "consume") {
			auto r = needs_row("survival.needs.consume", with_at(field("effects")));
			if (!r) return false;
			const JsonValue *st = need(*r, "state", "survival.needs.consume", why);
			const JsonValue *events = need(*r, "events", "survival.needs.consume", why);
			if (!st || !events) return false;
			state = copy_of(*st);
			if (!reduce(*events)) return false;
			rec.emplace_back("do", make_string("consume"));
			add_if(rec, "applied", r->find("applied"));
			add_if(rec, "events", events);
			needs_of(rec);
		} else if (kind == "use_item") {
			auto r = needs_row("survival.needs.useItem", with_at(field("item")));
			if (!r) return false;
			const JsonValue *ok = need(*r, "ok", "survival.needs.useItem", why);
			const JsonValue *st = need(*r, "state", "survival.needs.useItem", why);
			if (!ok || !st) return false;
			state = copy_of(*st);
			rec.emplace_back("do", make_string("use_item"));
			if (ok->type != JsonType::Bool || !ok->bool_value) {
				rec.emplace_back("ok", make_bool(false));
				add_if(rec, "reason", r->find("reason"));
			} else {
				const JsonValue *events = need(*r, "events", "survival.needs.useItem", why);
				if (!events || !reduce(*events)) return false;
				rec.emplace_back("ok", make_bool(true));
				for (const char *k : {"consumed", "remaining", "applied", "action", "events"}) add_if(rec, k, r->find(k));
			}
			needs_of(rec);
		} else if (kind == "remove_modifier") {
			auto r = c.call("survival.needs.removeModifier", [&] {
				Items a{{"state", state}};
				add_if(a, "id", step.find("id"));
				return a;
			}());
			if (!r) return why = c.error, false;
			const JsonValue *st = need(*r, "state", "survival.needs.removeModifier", why);
			if (!st) return false;
			state = copy_of(*st);
			rec.emplace_back("do", make_string("remove_modifier"));
			add_if(rec, "modifiers", state->find("modifiers"));
		} else if (kind == "enable") {
			auto r = c.call("survival.needs.enable", [&] {
				Items a{{"state", state}};
				add_if(a, "enabled", step.find("enabled"));
				return a;
			}());
			if (!r) return why = c.error, false;
			const JsonValue *st = need(*r, "state", "survival.needs.enable", why);
			if (!st) return false;
			state = copy_of(*st);
			rec.emplace_back("do", make_string("enable"));
			add_if(rec, "enabled", state->find("enabled"));
		} else if (kind == "save") {
			Items a{{"state", state}};
			add_if(a, "at", at);
			auto r = c.call("survival.needs.save", a);
			if (!r) return why = c.error, false;
			const JsonValue *block = ok_value(*r, "survival.needs.save", why);
			if (!block) return false;
			rec.emplace_back("do", make_string("save"));
			add_if(rec, "at", at);
			rec.emplace_back("block", copy_of(*block));
		} else if (kind == "stamina") {
			Items reading;
			add_if(reading, "current", step.find("current"));
			add_if(reading, "max", step.find("max"));
			Items a = stamina_tuning;
			a.emplace_back("hud", hud);
			a.emplace_back("stamina", make_object(reading));
			add_if(a, "at", at);
			auto r = c.call("survival.hud.stamina", a);
			if (!r) return why = c.error, false;
			Items sa = stamina_tuning;
			for (const auto &kv : reading) sa.push_back(kv);
			auto s = c.call("survival.stamina.state", sa);
			if (!s) return why = c.error, false;
			const JsonValue *h = need(*r, "hud", "survival.hud.stamina", why);
			const JsonValue *band_state = need(*s, "state", "survival.stamina.state", why);
			if (!h || !band_state) return false;
			hud = copy_of(*h);
			stamina = make_object(reading);
			rec.emplace_back("do", make_string("stamina"));
			rec.emplace_back("state", copy_of(*band_state));
			add_if(rec, "band", r->find("band"));
			add_if(rec, "events", r->find("events"));
		} else if (kind == "view") {
			Items a = tuning;
			a.emplace_back("state", state);
			a.emplace_back("hud", hud);
			add_if(a, "now", at);
			add_if(a, "visible", input.find("visible"));
			if (stamina) a.emplace_back("stamina", stamina);
			for (const auto &kv : stamina_tuning) a.push_back(kv);
			auto r = c.call("survival.hud.view", a);
			if (!r) return why = c.error, false;
			const JsonValue *view = ok_value(*r, "survival.hud.view", why);
			if (!view || !view->is_object()) return why = why.empty() ? "survival.hud.view answered no view object" : why, false;
			rec.emplace_back("do", make_string("view"));
			add_if(rec, "at", at);
			spread_into(rec, *view);
		} else {
			return why = "unknown step " + json_of(step), false;
		}
		g_steps[kind]++;
		records.push_back(make_object(std::move(rec)));
	}
	out = ok_of(make_object({{"steps", make_array(std::move(records))}}));
	return true;
}

// ── stamina:pool ──────────────────────────────────────────────────────────────

bool drive_pool(Caller &c, const JsonValue &input, JsonValuePtr &out, std::string &why) {
	const JsonValue *steps = input.find("steps");
	if (!steps || !steps->is_array()) return why = "steps is not an array", false;
	Items create;
	for (const auto &kv : input.object_items) {
		if (kv.first != "steps") create.push_back(kv);
	}
	auto r = c.call("survival.stamina.pool.create", create);
	if (!r) return why = c.error, false;
	const JsonValue *handle = r->find("session");
	const JsonValue *view = r->find("view");
	const JsonValue *tuning = view ? view->find("tuning") : nullptr;
	if (!handle || !handle->is_number() || !tuning) return why = "survival.stamina.pool.create answered no session and view.tuning", false;
	const std::string session = handle->raw_number;
	JsonValuePtr tuning_copy = copy_of(*tuning);

	std::vector<JsonValuePtr> records;
	for (const auto &sp : steps->array_items) {
		const JsonValue &step = *sp;
		const std::string kind = step.get_string("do");
		static const std::set<std::string> known = {"cost", "afford", "spend", "rest", "play", "band", "save"};
		if (!known.count(kind)) {
			c.dispose(session);
			return why = "unknown step " + json_of(step), false;
		}
		Items op{{"op", make_string(kind)}};
		for (const auto &kv : step.object_items) {
			if (kv.first != "do") op.push_back(kv);
		}
		// The session handle goes as the raw number the create row answered.
		std::string args = "{\"session\":" + session + ",\"ops\":[" + json_of(*make_object(op)) + "]}";
		auto ans = c.call("survival.stamina.pool.apply", args);
		if (!ans) {
			c.dispose(session);
			return why = c.error, false;
		}
		const JsonValue *results = ans->find("results");
		if (!results || !results->is_array() || results->size() != 1 || !results->array_items[0]->is_object()) {
			c.dispose(session);
			return why = "survival.stamina.pool.apply answered no single result", false;
		}
		const JsonValue &res = *results->array_items[0];
		Items rec{{"do", make_string(kind)}};
		if (kind == "cost") {
			add_if(rec, "action", step.find("action"));
			add_if(rec, "cost", res.find("cost"));
		} else if (kind == "afford") {
			add_if(rec, "actor", step.find("actor"));
			add_if(rec, "action", step.find("action"));
			add_if(rec, "affordable", res.find("affordable"));
		} else if (kind == "spend") {
			add_if(rec, "actor", step.find("actor"));
			for (const char *k : {"action", "spend", "facts", "host"}) add_if(rec, k, res.find(k));
		} else if (kind == "rest") {
			add_if(rec, "actor", step.find("actor"));
			for (const char *k : {"regen", "facts", "host"}) add_if(rec, k, res.find(k));
		} else if (kind == "play") {
			add_if(rec, "actor", step.find("actor"));
			add_if(rec, "at", step.find("at"));
			for (const char *k : {"ticks", "lastTickAt", "regen", "host"}) add_if(rec, k, res.find(k));
		} else if (kind == "band") {
			add_if(rec, "actor", step.find("actor"));
			add_if(rec, "state", res.find("state"));
		} else {  // save
			add_if(rec, "state", res.find("state"));
		}
		g_steps["pool." + kind]++;
		records.push_back(make_object(std::move(rec)));
	}
	c.dispose(session);
	out = ok_of(make_object({{"tuning", tuning_copy}, {"steps", make_array(std::move(records))}}));
	return true;
}

// ── one case ──────────────────────────────────────────────────────────────────

bool drive(Caller &c, const std::string &area, const std::string &op, const JsonValue &input, const std::string &catalog,
           JsonValuePtr &out, std::string &why) {
	auto whole = [&](const std::string &row) {
		out = c.call(row, json_of(input));
		if (!out) why = c.error;
		return out != nullptr;
	};
	if (area == "survival-needs" || area == "survival-hud") {
		if (op == "run") return drive_needs_run(c, input, out, why);
		if (area == "survival-hud") {
			if (op == "view") return whole("survival.hud.view");
			if (op == "systems") {
				if (input.find("catalog")) return why = "the input already has a `catalog` key", false;
				std::string args = json_of(input);
				args.pop_back();
				args += std::string(input.object_items.empty() ? "" : ",") + "\"catalog\":" + catalog + "}";
				out = c.call("survival.hud.systems", args);
				if (!out) why = c.error;
				return out != nullptr;
			}
		} else {
			return whole("survival.needs." + op);
		}
	}
	if (area == "survival-stamina") {
		if (op == "tuning" || op == "spend" || op == "regen") return whole("survival.stamina." + op);
		if (op == "pool") return drive_pool(c, input, out, why);
		if (op == "bands") {
			const JsonValue *readings = input.find("readings");
			if (!readings || !readings->is_array()) return why = "readings is not an array", false;
			std::vector<JsonValuePtr> list;
			for (const auto &rp : readings->array_items) {
				if (!rp->is_object()) return why = "a reading is not an object", false;
				Items a;
				add_if(a, "current", rp->find("current"));
				add_if(a, "max", rp->find("max"));
				add_if(a, "staminaConfig", input.find("staminaConfig"));
				auto r = c.call("survival.stamina.state", a);
				if (!r) return why = c.error, false;
				const JsonValue *st = need(*r, "state", "survival.stamina.state", why);
				if (!st) return false;
				Items rec = rp->object_items;  // `{ ...r, state }`
				spread_into(rec, *make_object({{"state", copy_of(*st)}}));
				list.push_back(make_object(std::move(rec)));
			}
			out = ok_of(make_array(std::move(list)));
			return true;
		}
		if (op == "clock") {
			const JsonValue *readings = input.find("readings");
			if (!readings || !readings->is_array()) return why = "readings is not an array", false;
			// core's runner: `let last = input.start ?? 0`.
			const JsonValue *start = input.find("start");
			JsonValuePtr last = start && !start->is_null() ? copy_of(*start) : insimul::parse_json("0").root;
			std::vector<JsonValuePtr> list;
			for (const auto &now : readings->array_items) {
				Items a{{"lastTickAt", last}, {"now", now}};
				add_if(a, "tickMs", input.find("tickMs"));
				auto r = c.call("survival.stamina.clock", a);
				if (!r) return why = c.error, false;
				const JsonValue *ticks = need(*r, "ticks", "survival.stamina.clock", why);
				const JsonValue *lt = need(*r, "lastTickAt", "survival.stamina.clock", why);
				if (!ticks || !lt) return false;
				last = copy_of(*lt);
				list.push_back(make_object({{"now", now}, {"ticks", copy_of(*ticks)}, {"lastTickAt", copy_of(*lt)}}));
			}
			out = ok_of(make_array(std::move(list)));
			return true;
		}
	}
	why = "op '" + op + "' of area " + area + " has no driver";
	return false;
}

// The pack catalog `<root>/conformance/packs/composition.json` names, as the JSON
// object the systems row takes: `{ "index": …, "manifests": [ … ] }`.
std::string catalog_json(const std::string &root, std::string &why) {
	bool ok = false;
	const std::string text = read_file(root + "/conformance/packs/composition.json", ok);
	auto doc = insimul::parse_json(text);
	if (!ok || !doc.ok || !doc.root->is_object()) return why = "cannot read " + root + "/conformance/packs/composition.json", "";
	const JsonValue *cat = doc.root->find("catalog");
	const JsonValue *index = cat ? cat->find("index") : nullptr;
	const JsonValue *manifests = cat ? cat->find("manifests") : nullptr;
	if (!index || !index->is_string() || !manifests || !manifests->is_array()) {
		return why = "composition.json names no catalog { index, manifests }", "";
	}
	auto file = [&](const std::string &rel, std::string &body) {
		if (rel.empty() || rel[0] == '/' || rel.find("..") != std::string::npos) return why = "catalog path '" + rel + "' is not a plain relative path", false;
		bool read_ok = false;
		body = read_file(root + "/" + rel, read_ok);
		if (!read_ok) return why = "cannot read catalog file " + root + "/" + rel, false;
		return true;
	};
	std::string body;
	if (!file(index->as_string(), body)) return "";
	std::string out = "{\"index\":" + body + ",\"manifests\":[";
	for (std::size_t i = 0; i < manifests->size(); i++) {
		if (!file(manifests->array_items[i]->as_string(), body)) return "";
		out += (i ? "," : "") + body;
	}
	return out + "]}";
}

}  // namespace

int main(int argc, char **argv) {
	bool negative = false;
	std::vector<std::string> args;
	for (int i = 1; i < argc; i++) {
		const std::string a = argv[i];
		if (a == "--negative") negative = true;
		else args.push_back(a);
	}
	if (args.size() < 2) {
		std::fprintf(stderr, "usage: insimulcore_survival_corpus [--negative] <core-root> <corpus.json>...\n");
		return 2;
	}
	if (!self_test()) {
		std::fprintf(stderr, "survival_corpus: the comparator or the perturbation cannot tell a wrong answer from a right one\n");
		return 2;
	}
	std::string why;
	const std::string catalog = catalog_json(args[0], why);
	if (catalog.empty()) {
		std::fprintf(stderr, "survival_corpus: %s\n", why.c_str());
		return 2;
	}
	insimul_core *core = insimul_core_create();
	if (!core) {
		std::fprintf(stderr, "survival_corpus: insimul_core_create() failed\n");
		return 2;
	}
	std::printf("survival_corpus%s: %s\n", negative ? " --negative" : "", insimul_core_version());
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
	for (std::size_t f = 1; f < args.size(); f++) {
		const std::string file = args[f];
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
		const Area *area = area_named(area_name);
		if (!area) {
			std::printf("  [FAIL] %s — area '%s' is not one this runner drives\n", file.c_str(), area_name.c_str());
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
		std::printf("── %s (area %s, %zu case(s))\n", file.c_str(), area_name.c_str(), case_list->size());

		// The file's header is core's: its catalog system and its op list, in order.
		{
			std::vector<std::string> declared;
			if (const JsonValue *ops = doc.find("ops")) {
				for (const auto &o : ops->array_items) declared.push_back(o->as_string());
			}
			const bool same_ops = declared == area->ops;
			const bool same_catalog = doc.get_string("catalog") == area->catalog;
			if (!same_ops || !same_catalog) {
				std::printf("  [FAIL] header: the file's catalog '%s' and ops are not core's (%s; ops %s)\n",
				            doc.get_string("catalog").c_str(), area->catalog.c_str(), same_ops ? "agree" : "differ");
				failed++;
			} else {
				std::printf("  header: catalog %s and %zu op(s), core's\n", area->catalog.c_str(), area->ops.size());
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
		std::map<std::string, int> driven;
		int file_undriven = 0, file_refused = 0, file_accepted = 0;
		for (const auto &cp : case_list->array_items) {
			const JsonValue &cs = *cp;
			const std::string name = cs.get_string("name");
			const std::string op = cs.get_string("op");
			const JsonValue *input = cs.find("input");
			const JsonValue *expected = cs.find("expected");
			total_cases++;
			if (!input || !input->is_object() || !expected) {
				std::printf("  [FAIL] %s — needs an input object and an expected answer\n", name.c_str());
				failed++;
				file_undriven++;
				continue;
			}
			bool known = false;
			for (const std::string &o : area->ops) known = known || o == op;
			if (!known) {
				std::printf("  [FAIL] %s — op '%s' is not one of area %s's\n", name.c_str(), op.c_str(), area_name.c_str());
				failed++;
				file_undriven++;
				continue;
			}
			JsonValuePtr actual;
			std::string why_case;
			if (!drive(c, area_name, op, *input, catalog, actual, why_case)) {
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
			driven[op]++;
			total_driven++;
		}
		std::string by_op;
		for (const std::string &o : area->ops) {
			if (!driven.count(o)) {
				std::printf("  [FAIL] op %s of area %s: no case of it was driven\n", o.c_str(), area_name.c_str());
				failed++;
			}
			by_op += (by_op.empty() ? "" : ", ") + o + " " + std::to_string(driven.count(o) ? driven[o] : 0);
		}
		std::printf("  %s: %zu case(s), driven %s; %d undriven\n", area_name.c_str(), case_list->size(), by_op.c_str(),
		            file_undriven);
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
		std::printf("survival_corpus --negative: %d of %d perturbed case(s) refused, %d accepted, %d failure(s), %.0f ms\n", refused,
		            total_cases, accepted, failed, ms);
		if (failed || refused != total_cases || total_cases == 0) {
			std::printf("survival_corpus --negative: FAIL\n");
			return 1;
		}
		std::printf("survival_corpus --negative: PASS\n");
		return 0;
	}
	std::printf("survival_corpus: %d of %d case(s) driven through the rows, %d failed, %.0f ms\n", total_driven, total_cases, failed, ms);
	if (failed || total_driven == 0 || total_driven != total_cases) {
		std::printf("survival_corpus: FAIL\n");
		return 1;
	}
	std::printf("survival_corpus: PASS\n");
	return 0;
}
