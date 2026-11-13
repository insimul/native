// progression_corpus.cpp — core's P9i progression corpora and its skill-tree
// corpora, driven through libinsimulcore's `progression.*` and `skill.*` rows.
//
// PL.native-progression-rows (rulings U106(7) and U36). Core's P9i logic (P9i.core:
// src/progression/gamification.ts, feature-modules.ts, progression-save.ts) and core's
// skill trees (src/skills/, game-engine/logic/SkillProgression.ts) are rows of
// corebridge/js/entry.js. This gate holds them to core's own corpora, COPIED byte for
// byte into corebridge/vendor/core/conformance/ at the pin and sha256-checked by the
// `core_vendor` ctest:
//
//   progression/gamification.json  levels, table, achievements, daily, run (14 step kinds)
//   progression/modules.json       definitions, resolve, genre, proficiency, difficulty,
//                                  performance, adjust, records
//   progression/skills.json        domain, restore
//   progression/save.json          block, read, restore
//   skills/advancement.json        what a level prices and whether it may be taken
//   skills/unlocks.json            what a node costs, asks, and whether core refuses it
//   skills/effects.json            what a taken node does to a snapshot
//   skills/trees.json              the tree a panel draws
//   skills/effect-terms.json       a take's skill_node_unlocked event and the effect facts
//   prolog/mechanic-skill.json     the skill pack's KB corpus: its can_unlock/2 cases are
//                                  replayed through a KB-backed `skill.unlock` (U106(7))
//
// Nothing here re-writes a case or computes an answer: every answer comes out of a
// row. Each corpus op's record is composed from the rows exactly as core's runner
// (src/progression/systems-corpus.ts `runProgressionSystemsOp`; for skills/, core's
// src/conformance/__tests__/skills-corpus.test.ts) composes it from core's functions:
//
//   gamification levels: per total, .levelForXp, .nextLevelXp, .progressPermille and
//     .tier (the case's config's thresholds and labels); table, achievements: the row
//     with the input as is; daily: .dailyIndex, .previousDate and .dailyChallenge per
//     date, .streakTenths and .streakXp per streak and reward; run: the state from
//     progression.save.read (a saved block) or .initial, then ONE
//     progression.gamification.step per step (its `at` taken out of the step and sent
//     beside it), recorded `{ do, events, signals, refusal? }`; then the block
//     (progression.save.build → .write) and .view.
//   modules: definitions, records, the genre op (progression.modules.genre per genre):
//     the row; resolve: .bundleModules (when the case names no ids) and .resolve;
//     proficiency/difficulty: the bundle's labels from .configs, then .proficiencyTiers
//     + .proficiency, .difficultyTiers + .difficulty; performance: per window; adjust:
//     .adjust then .applyAdjustment (3 objectives and 10 minutes unless stated).
//   skills domain: progression.skills.domain read by skill.ir.{trees,skills,tuning},
//     then skill.trees.view per actor; restore: progression.save.read, a skill.create
//     session over the domain world, skill.restore, skill.serialize, skill.effectsOf
//     and skill.modifiersOf per actor.
//   save block/read/restore: progression.save.build, .read and .write (and the
//     gamification rows for a block built from steps).
//   skills/*: skill.advancement.{maxLevel,xpForLevel,resolve}, skill.unlocks.
//     {resolve,requirements,cost}, skill.effects.{modifiers,unlocks,permits,apply,
//     modifierOf}, skill.trees.{depth,view,funded}; effect terms: a skill.create session
//     over the case's tree, skill.register, skill.unlock (its one skill_node_unlocked
//     event), and skill.trees.facts.
//   mechanic-skill can_unlock(A, N): the case's KB facts read into the session's trees
//     and roster (skill_tree, skill_node, skill_node_cost, skill_node_requires,
//     skill_node_effect; skill_points, skill_unlocked, has_skill, skill_xp), then
//     skill.create { kb: <the case's kb, whole>, trees, state } and skill.unlock { actor:
//     A, node: N }: performed is the query's one empty solution, refused its none. The
//     node's authored goals are answered by core's skill_goal_met/2 in the native KB.
//     The pack's other queries (can_learn_skill, can_advance, skill_capped,
//     skill_effect) are no unlock and no row's; they are counted, not driven. Control:
//     every case the KB lets through is asked again with NO KB, and must stay locked
//     (refusal `requires`): core's no-KB rule, so the KB is what opened it.
//
// An op or a step this runner does not know fails its case (never a skip); the
// refusal probes prove it on every start (an unknown op of each file, an unknown run
// step, an unknown area and a query that is no unlock), and that the rows refuse what
// core refuses: progression.gamification.step { do: <unknown> } answers core's
// `unknown_event` as a value, and an unknown row is the method table's error. The run
// FAILS on a progression file whose catalog, op list or step list is not core's, on a
// skills file whose area is not one of the five, on an op no case drives, on a row
// missing from the method table, on a session left open, and when its comparator
// cannot fail (a self-test on every start). Comparison is the corpora's own rule:
// exact, object key sets included.
//
// --negative perturbs EVERY driven case's expectation (its last leaf) and requires
// every one to be refused.
//
// A pure consumer of insimulcore.h (no quickjs.h, no insimul.h). The JSON reader is
// tests/radiant/json_value.{h,cpp}, used as is.
//
// usage: insimulcore_progression_corpus [--negative] <corpus.json>...

#include "insimulcore.h"
#include "radiant/json_value.h"

#include <chrono>
#include <cmath>
#include <cstdio>
#include <fstream>
#include <map>
#include <set>
#include <sstream>
#include <stdexcept>
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

bool self_test() {
	auto parse = [](const char *t) { return insimul::parse_json(t).root; };
	struct Probe {
		const char *expected, *actual;
		bool agree;
	} probes[] = {
	    {"{\"a\":1,\"b\":[true,\"x\"]}", "{\"b\":[true,\"x\"],\"a\":1.0}", true},
	    {"{\"a\":1}", "{\"a\":2}", false},
	    {"{\"a\":1}", "{\"a\":1,\"b\":null}", false},
	    {"{\"a\":1,\"b\":null}", "{\"a\":1}", false},
	    {"[1,2]", "[2,1]", false},
	    {"[{}]", "[]", false},
	    {"false", "0", false},
	    {"null", "{}", false},
	    {"\"unlocks(x)\"", "\"unlocks(y)\"", false},
	};
	bool ok = true;
	for (const Probe &p : probes) {
		const bool agree = compare(*parse(p.expected), *parse(p.actual), 0.0, "$").empty();
		if (agree != p.agree) {
			std::printf("  [FAIL] self-test: %s vs %s %s\n", p.expected, p.actual, agree ? "agreed" : "differed");
			ok = false;
		}
	}
	const char *sources[] = {"[{}]", "[]", "{\"steps\":[{\"do\":\"day\",\"events\":[],\"signals\":[]}],\"date\":null}",
	                         "{\"ok\":false,\"keys\":[\"gamification\"]}", "[1,2]"};
	for (const char *s : sources) {
		auto src = parse(s);
		auto bad = deep_copy(*src);
		sabotage_last(*bad);
		if (compare(*src, *bad, 0.0, "$").empty() || json_of(*src) != json_of(*parse(s))) {
			std::printf("  [FAIL] self-test: perturbing %s gave no difference, or changed the source\n", s);
			ok = false;
		}
	}
	return ok;
}

// ── calling the rows ──────────────────────────────────────────────────────────

struct DriveError : std::runtime_error {
	using std::runtime_error::runtime_error;
};

JsonValuePtr parse_or_throw(const std::string &text) {
	auto p = insimul::parse_json(text);
	if (!p.ok) throw DriveError("unparsable JSON: " + p.error);
	return p.root;
}

JsonValuePtr make_raw_number(const std::string &raw) { return parse_or_throw(raw); }

JsonValuePtr make_int(long long n) { return make_raw_number(std::to_string(n)); }

JsonValuePtr null_value() { return std::make_shared<JsonValue>(); }

struct Caller {
	insimul_core *core;
	std::map<std::string, int> rows_called;

	// The whole answer; throws with the row's error.
	JsonValuePtr answer(const std::string &method, const Items &args) {
		rows_called[method]++;
		const std::string text = json_of(*make_object(args));
		const char *raw = insimul_core_call(core, method.c_str(), text.c_str());
		if (!raw) throw DriveError(method + " failed: " + insimul_core_last_error(core));
		auto parsed = insimul::parse_json(raw);
		if (!parsed.ok || !parsed.root->is_object()) throw DriveError(method + " answered something that is not a JSON object");
		return parsed.root;
	}

	// The `value` of a `{ ok: true, value }` answer; throws otherwise.
	JsonValuePtr value(const std::string &method, const Items &args) {
		auto a = answer(method, args);
		const JsonValue *ok = a->find("ok");
		const JsonValue *v = a->find("value");
		if (!ok || ok->type != JsonType::Bool || !ok->bool_value || !v) {
			throw DriveError(method + " answered no { ok: true, value }: " + json_of(*a));
		}
		return copy_of(*v);
	}

	void dispose(const JsonValue &session) {
		const std::string args = "{\"session\":" + json_of(session) + "}";
		insimul_core_call(core, "session.dispose", args.c_str());
	}
};

// `key` of `v`, or nullptr (absent); a JSON null counts as absent where core reads `?? default`.
const JsonValue *present(const JsonValue &v, const char *key) {
	const JsonValue *x = v.find(key);
	return (x && !x->is_null()) ? x : nullptr;
}

const JsonValue &need(const JsonValue &v, const char *key) {
	const JsonValue *x = v.find(key);
	if (!x) throw DriveError(std::string("the input has no '") + key + "'");
	return *x;
}

const JsonValue &need_array(const JsonValue &v, const char *key) {
	const JsonValue &x = need(v, key);
	if (!x.is_array()) throw DriveError(std::string("'") + key + "' is not a list");
	return x;
}

// JavaScript's String(x) for a number or a string (what `${…}` and `join` print).
std::string js_string(const JsonValue &v) {
	if (v.is_string()) return v.string_value;
	if (v.is_number()) return v.raw_number;
	if (v.type == JsonType::Bool) return v.bool_value ? "true" : "false";
	if (v.is_null()) return "null";
	throw DriveError("a value JavaScript's String would print as an object: " + json_of(v));
}

// ── the files ─────────────────────────────────────────────────────────────────

// core's PROGRESSION_SYSTEMS_CORPUS_OPS / _CATALOG / _STEPS (src/progression/systems-corpus.ts).
struct ProgressionFile {
	std::string file;
	std::vector<std::string> catalog;
	std::vector<std::string> ops;
	std::vector<std::string> run_steps;  // gamification's `run` op only
};

const std::vector<ProgressionFile> &progression_files() {
	static const std::vector<ProgressionFile> list = {
	    {"progression/gamification",
	     {"progression-xp-levels-achievements"},
	     {"levels", "table", "achievements", "daily", "run"},
	     {"day", "conversation", "word", "mastered", "grammar", "pattern", "quest", "skillRewards", "category", "article",
	      "award", "listening", "event", "stats"}},
	    {"progression/modules",
	     {"progression-feature-modules", "progression-performance-scoring-world-lore"},
	     {"definitions", "resolve", "genre", "proficiency", "difficulty", "performance", "adjust", "records"},
	     {}},
	    {"progression/skills", {"progression-skill-trees"}, {"domain", "restore"}, {}},
	    {"progression/save", {"progression-xp-levels-achievements", "progression-skill-trees"}, {"block", "read", "restore"}, {}},
	};
	return list;
}

const std::vector<std::string> &skills_areas() {
	static const std::vector<std::string> list = {"skills-advancement", "skills-unlocks", "skills-effects", "skills-trees",
	                                              "skills-effect-terms"};
	return list;
}

// Every row this runner drives; the method table must hold each.
const std::vector<std::string> &rows_driven() {
	static const std::vector<std::string> list = {
	    "progression.gamification.levelForXp", "progression.gamification.nextLevelXp",
	    "progression.gamification.progressPermille", "progression.gamification.tier", "progression.gamification.table",
	    "progression.gamification.achievements", "progression.gamification.dailyIndex",
	    "progression.gamification.previousDate", "progression.gamification.dailyChallenge",
	    "progression.gamification.streakTenths", "progression.gamification.streakXp", "progression.gamification.initial",
	    "progression.gamification.step", "progression.gamification.view", "progression.modules.definitions",
	    "progression.modules.bundleModules", "progression.modules.resolve", "progression.modules.genre",
	    "progression.modules.configs", "progression.modules.proficiencyTiers", "progression.modules.proficiency",
	    "progression.modules.difficultyTiers", "progression.modules.difficulty", "progression.modules.performance",
	    "progression.modules.adjust", "progression.modules.applyAdjustment", "progression.modules.records",
	    "progression.skills.domain", "progression.save.build", "progression.save.read", "progression.save.write",
	    "skill.ir.tuning", "skill.ir.skills", "skill.ir.trees", "skill.advancement.resolve",
	    "skill.advancement.xpForLevel", "skill.advancement.maxLevel", "skill.unlocks.resolve",
	    "skill.unlocks.requirements", "skill.unlocks.cost", "skill.effects.modifiers", "skill.effects.unlocks",
	    "skill.effects.permits", "skill.effects.apply", "skill.effects.modifierOf", "skill.trees.view",
	    "skill.trees.funded", "skill.trees.depth", "skill.trees.facts", "skill.create", "skill.register",
	    "skill.unlock", "skill.restore", "skill.serialize", "skill.effectsOf", "skill.modifiersOf",
	};
	return list;
}

std::map<std::string, int> g_steps;

// ── progression/gamification ──────────────────────────────────────────────────

struct Run {
	JsonValuePtr run;  // { state, date }
	Items steps_out;
};

// Items with `key` only when `v` is present (JavaScript drops an undefined member).
void put(Items &items, const std::string &key, const JsonValue *v) {
	if (v) items.emplace_back(key, copy_of(*v));
}

JsonValuePtr gamification_run(Caller &c, const JsonValue &input, JsonValuePtr &state_out) {
	const ProgressionFile &pf = progression_files()[0];
	const JsonValue *config = present(input, "config");
	const JsonValue *tuning = present(input, "tuning");
	JsonValuePtr state;
	if (input.find("state")) {
		auto read = c.value("progression.save.read", {{"block", make_object({{"gamification", copy_of(*input.find("state"))}})}});
		const JsonValue *ok = read->find("ok");
		const JsonValue *v = read->find("value");
		const JsonValue *g = v && v->is_object() ? v->find("gamification") : nullptr;
		if (!ok || !ok->bool_value || !g) throw DriveError("unreadable state " + json_of(*read));
		state = copy_of(*g);
	} else {
		state = c.value("progression.gamification.initial", {});
	}
	const JsonValue *date_in = input.find("date");
	JsonValuePtr run = make_object({{"state", state}, {"date", date_in && date_in->is_string() ? copy_of(*date_in) : null_value()}});
	std::vector<JsonValuePtr> steps;
	for (const auto &raw : need_array(input, "steps").array_items) {
		const std::string d = raw->get_string("do");
		bool known = false;
		for (const auto &s : pf.run_steps) known = known || s == d;
		if (!known) throw DriveError("unknown progression/gamification:run step '" + d + "'");
		Items step;
		for (const auto &kv : raw->object_items) {
			if (kv.first != "at") step.push_back(kv);
		}
		const JsonValue *at = raw->find("at");
		Items args = {{"run", run}, {"step", make_object(step)}};
		put(args, "tuning", tuning);
		put(args, "config", config);
		if (at && at->is_number()) args.emplace_back("at", copy_of(*at));
		auto r = c.value("progression.gamification.step", args);
		g_steps[d]++;
		run = copy_of(need(*r, "run"));
		Items rec = {{"do", make_string(d)}, {"events", copy_of(need(*r, "events"))}, {"signals", copy_of(need(*r, "signals"))}};
		put(rec, "refusal", r->find("refusal"));
		steps.push_back(make_object(rec));
	}
	state_out = copy_of(need(*run, "state"));
	auto built = c.value("progression.save.build", {{"gamification", state_out}});
	auto block = c.value("progression.save.write", {{"block", built}});
	Items view_args = {{"state", state_out}};
	put(view_args, "config", config);
	auto view = c.value("progression.gamification.view", view_args);
	return make_object({{"steps", make_array(steps)},
	                    {"block", copy_of(need(*block, "gamification"))},
	                    {"date", copy_of(need(*run, "date"))},
	                    {"view", view}});
}

JsonValuePtr drive_gamification(Caller &c, const std::string &op, const JsonValue &input) {
	if (op == "levels") {
		const JsonValue *config = present(input, "config");
		const JsonValue *th = config ? present(*config, "levelThresholds") : nullptr;
		const JsonValue *labels = config ? present(*config, "tierLabels") : nullptr;
		std::vector<JsonValuePtr> out;
		for (const auto &total : need_array(input, "totals").array_items) {
			Items a = {{"total", total}};
			put(a, "thresholds", th);
			auto level = c.value("progression.gamification.levelForXp", a);
			Items b = {{"level", level}};
			put(b, "thresholds", th);
			auto next = c.value("progression.gamification.nextLevelXp", b);
			auto progress = c.value("progression.gamification.progressPermille", a);
			Items t = {{"level", level}};
			put(t, "labels", labels);
			auto tier = c.value("progression.gamification.tier", t);
			out.push_back(make_object({{"total", total}, {"level", level}, {"next", next}, {"progressPermille", progress}, {"tier", tier}}));
		}
		return make_array(out);
	}
	if (op == "table") return c.value("progression.gamification.table", input.object_items);
	if (op == "achievements") return c.value("progression.gamification.achievements", {});
	if (op == "daily") {
		const JsonValue *tuning = present(input, "tuning");
		std::vector<JsonValuePtr> days, streaks;
		for (const auto &date : need_array(input, "dates").array_items) {
			auto daily = make_object({{"dateKey", date}, {"progress", make_int(0)}, {"completed", make_bool(false)}});
			days.push_back(make_object({{"date", date},
			                            {"index", c.value("progression.gamification.dailyIndex", {{"date", date}})},
			                            {"previous", c.value("progression.gamification.previousDate", {{"date", date}})},
			                            {"challenge", c.value("progression.gamification.dailyChallenge", {{"daily", daily}})}}));
		}
		const JsonValue &rewards = need_array(input, "rewards");
		for (const auto &streak : need_array(input, "streaks").array_items) {
			Items a = {{"streak", streak}};
			put(a, "tuning", tuning);
			Items xp;
			for (const auto &r : rewards.array_items) {
				Items b = {{"reward", r}, {"streak", streak}};
				put(b, "tuning", tuning);
				xp.emplace_back(js_string(*r), c.value("progression.gamification.streakXp", b));
			}
			streaks.push_back(make_object({{"streak", streak}, {"tenths", c.value("progression.gamification.streakTenths", a)}, {"xp", make_object(xp)}}));
		}
		return make_object({{"days", make_array(days)}, {"streaks", make_array(streaks)}});
	}
	if (op == "run") {
		JsonValuePtr state;
		return gamification_run(c, input, state);
	}
	throw DriveError("unknown progression/gamification op '" + op + "'");
}

// ── progression/modules ───────────────────────────────────────────────────────

// A bundle's `<module>.tierLabels`, read out of progression.modules.configs (core's bundleModuleConfigs).
const JsonValue *bundle_labels(Caller &c, const JsonValue &bundle, const char *module, JsonValuePtr &hold) {
	hold = c.value("progression.modules.configs", {{"bundle", copy_of(bundle)}});
	const JsonValue *m = hold->find(module);
	return m ? present(*m, "tierLabels") : nullptr;
}

bool truthy(const JsonValue *v) {
	if (!v || v->is_null()) return false;
	if (v->type == JsonType::Bool) return v->bool_value;
	if (v->is_string()) return !v->string_value.empty();
	if (v->is_number()) return v->number_value != 0;
	return true;
}

JsonValuePtr drive_modules(Caller &c, const std::string &op, const JsonValue &input) {
	bool known = false;
	for (const auto &o : progression_files()[1].ops) known = known || o == op;
	if (!known) throw DriveError("unknown progression/modules op '" + op + "'");
	if (op == "definitions") return c.value("progression.modules.definitions", {});
	if (op == "records") return c.value("progression.modules.records", {{"quests", copy_of(need_array(input, "quests"))}});
	if (op == "genre") {
		std::vector<JsonValuePtr> out;
		for (const auto &g : need_array(input, "genres").array_items) out.push_back(c.value("progression.modules.genre", {{"genre", g}}));
		return make_array(out);
	}
	if (op == "performance") {
		std::vector<JsonValuePtr> out;
		for (const auto &w : need_array(input, "windows").array_items) out.push_back(c.value("progression.modules.performance", {{"records", w}}));
		return make_array(out);
	}
	std::vector<JsonValuePtr> out;
	for (const auto &cp : need_array(input, "cases").array_items) {
		const JsonValue &cs = *cp;
		if (op == "resolve") {
			const JsonValue *b = present(cs, "bundle");
			JsonValuePtr bundle = b ? copy_of(*b) : null_value();
			JsonValuePtr ids = cs.find("ids") ? copy_of(*cs.find("ids"))
			                                  : c.value("progression.modules.bundleModules", {{"bundle", b ? copy_of(*b) : make_string("")}});
			auto res = c.value("progression.modules.resolve", {{"ids", ids}, {"bundle", bundle}});
			Items rec = {{"bundle", bundle}, {"ids", ids}};
			spread_into(rec, *res);
			out.push_back(make_object(rec));
		} else if (op == "proficiency") {
			JsonValuePtr hold;
			const JsonValue *labels = present(cs, "tierLabels");
			if (!labels && truthy(cs.find("bundle"))) labels = bundle_labels(c, *cs.find("bundle"), "proficiency", hold);
			Items ta;
			put(ta, "tierLabels", labels);
			auto tiers = c.value("progression.modules.proficiencyTiers", ta);
			std::vector<JsonValuePtr> fmt;
			for (const auto &t : tiers->array_items) {
				fmt.push_back(make_string(js_string(need(*t, "id")) + ":" + js_string(need(*t, "label")) + ":" + js_string(need(*t, "minScore"))));
			}
			const JsonValue *scores = present(cs, "scores");
			Items pa = {{"scores", scores ? copy_of(*scores) : make_array({})}, {"tiers", tiers}};
			const JsonValue *scale = cs.find("scale");
			if (scale && scale->is_number()) pa.emplace_back("scale", copy_of(*scale));
			auto prof = c.value("progression.modules.proficiency", pa);
			Items rec;
			if (truthy(cs.find("bundle"))) rec.emplace_back("bundle", copy_of(*cs.find("bundle")));
			rec.emplace_back("tiers", make_array(fmt));
			spread_into(rec, *prof);
			out.push_back(make_object(rec));
		} else if (op == "difficulty") {
			JsonValuePtr hold;
			const JsonValue *labels = truthy(cs.find("bundle")) ? bundle_labels(c, *cs.find("bundle"), "adaptive-difficulty", hold) : nullptr;
			Items ta;
			put(ta, "tierLabels", labels);
			auto tiers = c.value("progression.modules.difficultyTiers", ta);
			auto params = c.value("progression.modules.difficulty", {{"score", copy_of(need(cs, "score"))}, {"tiers", tiers}});
			Items rec;
			if (truthy(cs.find("bundle"))) rec.emplace_back("bundle", copy_of(*cs.find("bundle")));
			rec.emplace_back("score", copy_of(need(cs, "score")));
			spread_into(rec, *params);
			out.push_back(make_object(rec));
		} else if (op == "adjust") {
			auto a = c.value("progression.modules.adjust", {{"records", copy_of(need(cs, "records"))}, {"current", copy_of(need(cs, "current"))}});
			const JsonValue *oc = present(cs, "objectiveCount");
			const JsonValue *em = present(cs, "estimatedMinutes");
			auto applied = c.value("progression.modules.applyAdjustment",
			                       {{"adjustment", a}, {"objectiveCount", oc ? copy_of(*oc) : make_int(3)}, {"estimatedMinutes", em ? copy_of(*em) : make_int(10)}});
			Items rec = a->object_items;
			spread_into(rec, *make_object({{"applied", applied}}));
			out.push_back(make_object(rec));
		} else {
			throw DriveError("unknown progression/modules op '" + op + "'");
		}
	}
	return make_array(out);
}

// ── progression/skills ────────────────────────────────────────────────────────

struct World {
	JsonValuePtr trees, skills, tuning;
};

World domain_world(Caller &c) {
	auto ir = c.value("progression.skills.domain", {});
	return {c.value("skill.ir.trees", {{"ir", ir}}), c.value("skill.ir.skills", {{"ir", ir}}), c.value("skill.ir.tuning", {{"ir", ir}})};
}

JsonValuePtr drive_skills(Caller &c, const std::string &op, const JsonValue &input) {
	const World w = domain_world(c);
	if (op == "domain") {
		std::vector<JsonValuePtr> out;
		for (const auto &actor : need_array(input, "actors").array_items) {
			auto trees = c.value("skill.trees.view", {{"trees", w.trees}, {"skills", w.skills}, {"tuning", w.tuning}, {"actor", actor}});
			out.push_back(make_object({{"actor", copy_of(need(*actor, "id"))}, {"trees", trees}}));
		}
		return make_array(out);
	}
	if (op == "restore") {
		Items block;
		put(block, "skills", input.find("skills"));
		auto r = c.value("progression.save.read", {{"block", make_object(block)}});
		const JsonValue *ok = r->find("ok");
		if (!ok || !ok->bool_value) return make_object({{"ok", make_bool(false)}, {"keys", copy_of(need(*r, "keys"))}});
		auto created = c.answer("skill.create", {{"skills", w.skills}, {"trees", w.trees}, {"tuning", w.tuning}});
		JsonValuePtr session = copy_of(need(*created, "session"));
		JsonValuePtr result;
		try {
			const JsonValue *v = r->find("value");
			const JsonValue *saved = v && v->is_object() ? present(*v, "skills") : nullptr;
			if (saved) c.value("skill.restore", {{"session", session}, {"state", copy_of(*saved)}});
			auto ser = c.value("skill.serialize", {{"session", session}});
			std::vector<JsonValuePtr> actors;
			for (const auto &a : need_array(*ser, "actors").array_items) {
				auto id = copy_of(need(*a, "id"));
				auto effects = c.value("skill.effectsOf", {{"session", session}, {"actor", id}});
				std::vector<JsonValuePtr> terms;
				for (const auto &e : effects->array_items) {
					std::string t = js_string(need(*e, "kind")) + "(";
					bool first = true;
					for (const auto &arg : need_array(*e, "args").array_items) {
						t += (first ? "" : ",") + js_string(*arg);
						first = false;
					}
					terms.push_back(make_string(t + ")"));
				}
				auto modifiers = c.value("skill.modifiersOf", {{"session", session}, {"actor", id}});
				actors.push_back(make_object({{"id", id}, {"effects", make_array(terms)}, {"modifiers", modifiers}}));
			}
			result = make_object({{"ok", make_bool(true)}, {"serialize", ser}, {"actors", make_array(actors)}});
		} catch (...) {
			c.dispose(*session);
			throw;
		}
		c.dispose(*session);
		return result;
	}
	throw DriveError("unknown progression/skills op '" + op + "'");
}

// ── progression/save ──────────────────────────────────────────────────────────

JsonValuePtr drive_save(Caller &c, const std::string &op, const JsonValue &input) {
	if (op == "block") {
		JsonValuePtr gamification = null_value();
		const JsonValue *steps = input.find("steps");
		if (steps && steps->is_array()) gamification_run(c, input, gamification);
		const JsonValue *skills = present(input, "skills");
		auto built = c.value("progression.save.build", {{"gamification", gamification}, {"skills", skills ? copy_of(*skills) : null_value()}});
		return c.value("progression.save.write", {{"block", built}});
	}
	Items read_args;
	put(read_args, "block", input.find("block"));
	auto r = c.value("progression.save.read", read_args);
	const JsonValue *ok = r->find("ok");
	const bool readable = ok && ok->type == JsonType::Bool && ok->bool_value;
	if (op == "read") {
		if (!readable) return r;
		const JsonValue *v = r->find("value");
		JsonValuePtr written = v && !v->is_null() ? c.value("progression.save.write", {{"block", copy_of(*v)}}) : null_value();
		return make_object({{"ok", make_bool(true)}, {"value", written}});
	}
	if (op == "restore") {
		if (!readable) return make_object({{"ok", make_bool(false)}, {"keys", copy_of(need(*r, "keys"))}});
		const JsonValue *v = r->find("value");
		JsonValuePtr b = v && !v->is_null() ? copy_of(*v) : c.value("progression.save.build", {});
		auto block = c.value("progression.save.write", {{"block", b}});
		const JsonValue *g = present(*b, "gamification");
		JsonValuePtr view = g ? c.value("progression.gamification.view", {{"state", copy_of(*g)}}) : null_value();
		return make_object({{"ok", make_bool(true)}, {"block", block}, {"view", view}});
	}
	throw DriveError("unknown progression/save op '" + op + "'");
}

// ── skills/*.json ─────────────────────────────────────────────────────────────

JsonValuePtr drive_skill_area(Caller &c, const std::string &area, const JsonValue &input) {
	if (area == "skills-advancement") {
		const JsonValue &skill = need(input, "skill");
		const JsonValue &tuning = need(input, "tuning");
		auto max = c.value("skill.advancement.maxLevel", {{"skill", copy_of(skill)}, {"tuning", copy_of(tuning)}});
		std::vector<JsonValuePtr> curve;
		for (long long level = 0; level <= max->as_int() + 1; level++) {
			curve.push_back(c.value("skill.advancement.xpForLevel", {{"skill", copy_of(skill)}, {"level", make_int(level)}, {"tuning", copy_of(tuning)}}));
		}
		auto resolution = c.value("skill.advancement.resolve", input.object_items);
		return make_object({{"resolution", resolution}, {"curve", make_array(curve)}, {"maxLevel", max}});
	}
	if (area == "skills-unlocks") {
		const JsonValue &node = need(input, "node");
		auto resolution = c.value("skill.unlocks.resolve", input.object_items);
		JsonValuePtr requirements = node.is_null() ? make_array({}) : c.value("skill.unlocks.requirements", {{"node", copy_of(node)}});
		JsonValuePtr cost = node.is_null() ? make_int(0) : c.value("skill.unlocks.cost", {{"node", copy_of(node)}, {"tuning", copy_of(need(input, "tuning"))}});
		return make_object({{"resolution", resolution}, {"requirements", requirements}, {"cost", cost}});
	}
	if (area == "skills-effects") {
		auto effects = copy_of(need_array(input, "effects"));
		return make_object({{"modifiers", c.value("skill.effects.modifiers", {{"effects", effects}})},
		                    {"unlocks", c.value("skill.effects.unlocks", {{"effects", effects}})},
		                    {"permits", c.value("skill.effects.permits", {{"effects", effects}})},
		                    {"modified", c.value("skill.effects.apply", {{"snapshot", copy_of(need(input, "snapshot"))}, {"effects", effects}})},
		                    {"modifierOf", c.value("skill.effects.modifierOf", {{"effects", effects}, {"parameter", copy_of(need(input, "parameter"))}})}});
	}
	if (area == "skills-trees") {
		const JsonValue &trees = need_array(input, "trees");
		Items depths;
		for (const auto &tree : trees.array_items) {
			for (const auto &n : need_array(*tree, "nodes").array_items) {
				const std::string id = need(*n, "id").as_string();
				auto d = c.value("skill.trees.depth", {{"tree", tree}, {"node", make_string(id)}});
				bool replaced = false;
				for (auto &kv : depths) {
					if (kv.first == id) {
						kv.second = d;
						replaced = true;
					}
				}
				if (!replaced) depths.emplace_back(id, d);
			}
		}
		auto view = c.value("skill.trees.view", input.object_items);
		const JsonValue *first_skill = trees.size() ? trees.array_items[0]->find("skill") : nullptr;
		auto funded = c.value("skill.trees.funded", {{"trees", copy_of(trees)}, {"skill", first_skill ? copy_of(*first_skill) : make_string("")}});
		return make_object({{"view", view}, {"funded", funded}, {"depths", make_object(depths)}});
	}
	if (area == "skills-effect-terms") {
		const JsonValue &tree = need(input, "tree");
		auto created = c.answer("skill.create", {{"tuning", copy_of(need(input, "tuning"))}, {"trees", make_array({copy_of(tree)})}});
		JsonValuePtr session = copy_of(need(*created, "session"));
		JsonValuePtr result;
		try {
			c.value("skill.register", {{"session", session},
			                           {"actor", make_object({{"id", copy_of(need(input, "actor"))},
			                                                  {"points", make_object({{need(tree, "id").as_string(), copy_of(need(input, "points"))}})}})}});
			auto taken = c.answer("skill.unlock", {{"session", session}, {"actor", copy_of(need(input, "actor"))}, {"node", copy_of(need(input, "node"))}});
			std::vector<JsonValuePtr> raised;
			for (const auto &e : need_array(*taken, "events").array_items) {
				if (e->get_string("type") == "skill_node_unlocked") raised.push_back(e);
			}
			if (raised.size() != 1) throw DriveError("one take raised " + std::to_string(raised.size()) + " skill_node_unlocked event(s), not exactly one");
			auto facts = c.value("skill.trees.facts", {{"trees", make_array({copy_of(tree)})}, {"tuning", copy_of(need(input, "tuning"))}});
			std::vector<JsonValuePtr> effect_facts;
			for (const auto &f : facts->array_items) {
				if (f->as_string().rfind("skill_node_effect(", 0) == 0) effect_facts.push_back(f);
			}
			result = make_object({{"event", raised[0]}, {"facts", make_array(effect_facts)}});
		} catch (...) {
			c.dispose(*session);
			throw;
		}
		c.dispose(*session);
		return result;
	}
	throw DriveError("area '" + area + "' is not one this runner drives");
}

// ── prolog/mechanic-skill.json: the KB-backed unlocks ─────────────────────────

// A Prolog term's top-level arguments, split at depth-0 commas (quotes respected), trimmed.
std::vector<std::string> split_args(const std::string &s) {
	std::vector<std::string> out;
	int depth = 0;
	std::string cur;
	char quote = 0;
	for (std::size_t i = 0; i < s.size(); i++) {
		const char ch = s[i];
		if (quote) {
			cur += ch;
			if (ch == '\\' && i + 1 < s.size()) cur += s[++i];
			else if (ch == quote) quote = 0;
			continue;
		}
		if (ch == '\'' || ch == '"') quote = ch;
		if (ch == '(' || ch == '[') depth++;
		if (ch == ')' || ch == ']') depth--;
		if (ch == ',' && depth == 0) {
			out.push_back(cur);
			cur.clear();
			continue;
		}
		cur += ch;
	}
	out.push_back(cur);
	for (auto &a : out) {
		const auto b = a.find_first_not_of(' ');
		const auto e = a.find_last_not_of(' ');
		a = b == std::string::npos ? std::string() : a.substr(b, e - b + 1);
	}
	return out;
}

// `name(args…)` (a trailing `.` dropped) → name and its arguments; a bare atom has none.
bool parse_term(std::string t, std::string &name, std::vector<std::string> &args) {
	while (!t.empty() && (t.back() == '.' || t.back() == ' ')) t.pop_back();
	const auto open = t.find('(');
	args.clear();
	if (open == std::string::npos) {
		name = t;
		return !name.empty();
	}
	if (t.back() != ')') return false;
	name = t.substr(0, open);
	args = split_args(t.substr(open + 1, t.size() - open - 2));
	return true;
}

JsonValuePtr atom_or_number(const std::string &a) {
	auto p = insimul::parse_json(a);
	if (p.ok && p.root->is_number()) return p.root;
	return make_string(a);
}

// An authored effect term as core's SkillEffect: `kind(args…)`, numbers as numbers.
JsonValuePtr effect_of(const std::string &term) {
	std::string kind;
	std::vector<std::string> args;
	if (!parse_term(term, kind, args)) throw DriveError("an effect term this runner cannot read: " + term);
	std::vector<JsonValuePtr> a;
	for (const auto &x : args) a.push_back(atom_or_number(x));
	return make_object({{"kind", make_string(kind)}, {"args", make_array(a)}});
}

struct KbWorld {
	JsonValuePtr trees, state;
};

// The case KB's skill facts read as the session's authored trees and saved roster.
KbWorld world_of_kb(const JsonValue &kb) {
	struct Node {
		std::string id, tree;
		JsonValuePtr cost;
		std::vector<JsonValuePtr> requires, effects;
	};
	std::vector<std::pair<std::string, std::string>> trees;  // id → skill, in order
	std::vector<Node> nodes;
	struct Actor {
		Items levels, xp, points;
		std::vector<JsonValuePtr> unlocked;
	};
	std::vector<std::pair<std::string, Actor>> actors;
	auto actor = [&](const std::string &id) -> Actor & {
		for (auto &a : actors) {
			if (a.first == id) return a.second;
		}
		actors.emplace_back(id, Actor{});
		return actors.back().second;
	};
	auto node = [&](const std::string &id) -> Node & {
		for (auto &n : nodes) {
			if (n.id == id) return n;
		}
		throw DriveError("a fact about node " + id + " before its skill_node/2");
	};
	for (const auto &clause : kb.array_items) {
		const std::string text = clause->as_string();
		if (text.find(":-") != std::string::npos) continue;  // directives and rules
		std::string name;
		std::vector<std::string> a;
		if (!parse_term(text, name, a)) throw DriveError("a KB fact this runner cannot read: " + text);
		if (name == "skill_tree" && a.size() == 2) trees.emplace_back(a[0], a[1]);
		else if (name == "skill_node" && a.size() == 2) nodes.push_back({a[0], a[1], nullptr, {}, {}});
		else if (name == "skill_node_cost" && a.size() == 2) node(a[0]).cost = atom_or_number(a[1]);
		else if (name == "skill_node_requires" && a.size() == 2) node(a[0]).requires.push_back(make_string(a[1]));
		else if (name == "skill_node_effect" && a.size() == 2) node(a[0]).effects.push_back(effect_of(a[1]));
		else if (name == "skill_points" && a.size() == 3) actor(a[0]).points.emplace_back(a[1], atom_or_number(a[2]));
		else if (name == "skill_unlocked" && a.size() == 2) actor(a[0]).unlocked.push_back(make_string(a[1]));
		else if (name == "has_skill" && a.size() == 3) actor(a[0]).levels.emplace_back(a[1], atom_or_number(a[2]));
		else if (name == "skill_xp" && a.size() == 3) actor(a[0]).xp.emplace_back(a[1], atom_or_number(a[2]));
	}
	std::vector<JsonValuePtr> tree_list;
	for (const auto &t : trees) {
		std::vector<JsonValuePtr> ns;
		for (const auto &n : nodes) {
			if (n.tree != t.first) continue;
			Items item = {{"id", make_string(n.id)}, {"tree", make_string(n.tree)}, {"parents", make_array({})},
			              {"requires", make_array(n.requires)}, {"effects", make_array(n.effects)}};
			if (n.cost) item.emplace_back("cost", n.cost);
			ns.push_back(make_object(item));
		}
		tree_list.push_back(make_object({{"id", make_string(t.first)}, {"skill", make_string(t.second)}, {"nodes", make_array(ns)}}));
	}
	std::vector<JsonValuePtr> roster;
	for (const auto &a : actors) {
		roster.push_back(make_object({{"id", make_string(a.first)},
		                              {"levels", make_object(a.second.levels)},
		                              {"xp", make_object(a.second.xp)},
		                              {"points", make_object(a.second.points)},
		                              {"unlocked", make_array(a.second.unlocked)}}));
	}
	return {make_array(tree_list), make_object({{"actors", make_array(roster)}})};
}

int g_kb_controls = 0;

// `can_unlock(A, N)` replayed through skill.unlock with the case's KB behind the session.
JsonValuePtr drive_kb_unlock(Caller &c, const JsonValue &cs) {
	std::string name;
	std::vector<std::string> a;
	if (!parse_term(need(cs, "query").as_string(), name, a) || name != "can_unlock" || a.size() != 2) {
		throw DriveError("not a can_unlock(Actor, Node) query");
	}
	const KbWorld w = world_of_kb(need_array(cs, "kb"));
	auto unlock_in = [&](bool with_kb) {
		Items create = {{"trees", w.trees}, {"state", w.state}};
		if (with_kb) create.emplace_back("kb", copy_of(need(cs, "kb")));
		auto created = c.answer("skill.create", create);
		JsonValuePtr session = copy_of(need(*created, "session"));
		const JsonValue *view = created->find("view");
		const JsonValue *kb = view ? view->find("kb") : nullptr;
		if (!kb || kb->type != JsonType::Bool || kb->bool_value != with_kb) {
			c.dispose(*session);
			throw DriveError("skill.create's view does not say whether a KB is behind it");
		}
		JsonValuePtr report;
		try {
			report = c.value("skill.unlock", {{"session", session}, {"actor", make_string(a[0])}, {"node", make_string(a[1])}});
		} catch (...) {
			c.dispose(*session);
			throw;
		}
		c.dispose(*session);
		return report;
	};
	auto report = unlock_in(true);
	const JsonValue *performed = report->find("performed");
	if (!performed || performed->type != JsonType::Bool) throw DriveError("skill.unlock answered no `performed`");
	if (performed->bool_value) {
		// Control: core's no-KB rule. The node the KB opened stays locked without one.
		auto bare = unlock_in(false);
		const JsonValue *p = bare->find("performed");
		if (!p || p->bool_value || bare->get_string("refusal") != "requires") {
			throw DriveError("with NO KB the node was not refused `requires`: " + json_of(*bare));
		}
		g_kb_controls++;
	}
	return performed->bool_value ? make_array({make_object({})}) : make_array({});
}

// The refusal probes: an op or a step this runner does not know is REFUSED (the case
// fails), never skipped or answered by a default; and the rows refuse what core
// refuses — an unknown step kind is core's `unknown_event` VALUE through
// progression.gamification.step, an unknown row is the method table's error.
// Returns how many probes were refused as they should be; prints each that was not.
int refusal_probes(Caller &c, int &total) {
	int refused = 0;
	auto expect_throw = [&](const char *what, auto fn) {
		total++;
		try {
			fn();
			std::printf("  [FAIL] probe: %s was not refused\n", what);
		} catch (const DriveError &) {
			refused++;
		}
	};
	auto empty = make_object({});
	auto with_cases = make_object({{"cases", make_array({make_object({})})}});
	expect_throw("an unknown progression/gamification op", [&] { drive_gamification(c, "fly", *empty); });
	expect_throw("an unknown progression/modules op", [&] { drive_modules(c, "fly", *with_cases); });
	expect_throw("an unknown progression/skills op", [&] { drive_skills(c, "fly", *empty); });
	expect_throw("an unknown progression/save op", [&] { drive_save(c, "fly", *make_object({{"block", make_object({})}})); });
	expect_throw("an unknown skills area", [&] { drive_skill_area(c, "skills-fly", *empty); });
	expect_throw("an unknown progression/gamification:run step", [&] {
		auto in = make_object({{"steps", make_array({make_object({{"do", make_string("fly")}})})}});
		JsonValuePtr state;
		gamification_run(c, *in, state);
	});
	expect_throw("a mechanic-skill query that is not can_unlock(A, N)", [&] {
		drive_kb_unlock(c, *make_object({{"query", make_string("can_fly(smith)")}, {"kb", make_array({})}}));
	});
	// The row: core's tracker answers an unknown step kind with its `unknown_event` refusal, as a value.
	total++;
	{
		auto run = make_object({{"state", c.value("progression.gamification.initial", {})}, {"date", null_value()}});
		auto r = c.value("progression.gamification.step", {{"run", run}, {"step", make_object({{"do", make_string("fly")}})}});
		if (r->get_string("refusal") == "unknown_event") refused++;
		else std::printf("  [FAIL] probe: progression.gamification.step { do: fly } answered %s, not core's unknown_event\n", json_of(*r).c_str());
	}
	// The method table: a row nobody wrote is an error, not an empty answer.
	total++;
	if (!insimul_core_call(c.core, "progression.gamification.fly", "{}") &&
	    std::string(insimul_core_last_error(c.core)).find("unknown method") != std::string::npos) {
		refused++;
	} else {
		std::printf("  [FAIL] probe: progression.gamification.fly was not refused as an unknown method\n");
	}
	return refused;
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
		std::fprintf(stderr, "usage: insimulcore_progression_corpus [--negative] <corpus.json>...\n");
		return 2;
	}
	if (!self_test()) {
		std::fprintf(stderr, "progression_corpus: the comparator or the perturbation cannot tell a wrong answer from a right one\n");
		return 2;
	}
	insimul_core *core = insimul_core_create();
	if (!core) {
		std::fprintf(stderr, "progression_corpus: insimul_core_create() failed\n");
		return 2;
	}
	std::printf("progression_corpus%s: %s\n", negative ? " --negative" : "", insimul_core_version());
	Caller c{core, {}};

	int failed = 0, total_driven = 0, total_cases = 0, refused = 0, accepted = 0;
	std::set<std::string> table;
	{
		const char *raw = insimul_core_call(core, "core.methods", "{}");
		auto m = raw ? insimul::parse_json(raw).root : nullptr;
		const JsonValue *list = m ? m->find("methods") : nullptr;
		if (list && list->is_array()) {
			for (const auto &x : list->array_items) table.insert(x->as_string());
		}
	}
	for (const std::string &row : rows_driven()) {
		if (!table.count(row)) {
			std::printf("  [FAIL] surface: the method table has no %s row\n", row.c_str());
			failed++;
		}
	}

	{
		int probes = 0;
		const int probes_refused = refusal_probes(c, probes);
		std::printf("refusals: %d of %d unknown op(s), step(s), area(s) and row(s) refused\n", probes_refused, probes);
		if (probes_refused != probes) failed++;
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
		const std::string area = doc.get_string("area");
		const JsonValue *case_list = doc.find("cases");
		if (!case_list || !case_list->is_array() || case_list->size() == 0) {
			std::printf("  [FAIL] %s — holds no case\n", file.c_str());
			failed++;
			continue;
		}

		// What the file is, and the ops it declares (a skills file has one kind of case).
		const ProgressionFile *pf = nullptr;
		bool skills = false, mechanic = false;
		std::vector<std::string> ops;
		std::string label;
		if (area == "progression") {
			const std::string name = doc.get_string("file");
			for (const auto &p : progression_files()) {
				if (p.file == name) pf = &p;
			}
			if (!pf) {
				std::printf("  [FAIL] %s — progression file '%s' is not one of core's\n", file.c_str(), name.c_str());
				failed++;
				continue;
			}
			label = pf->file;
			ops = pf->ops;
			// The header is core's: catalog, ops and (gamification) the run's steps, in order.
			auto strings = [](const JsonValue *v) {
				std::vector<std::string> out;
				if (v && v->is_array()) {
					for (const auto &x : v->array_items) out.push_back(x->as_string());
				}
				return out;
			};
			const JsonValue *steps = doc.find("steps");
			const bool same = strings(doc.find("catalog")) == pf->catalog && strings(doc.find("ops")) == pf->ops &&
			                  strings(steps ? steps->find("run") : nullptr) == pf->run_steps;
			if (!same) {
				std::printf("  [FAIL] %s — header: the catalog, ops or steps are not core's\n", file.c_str());
				failed++;
			} else {
				std::printf("── %s (%zu case(s)); header: catalog, %zu op(s) and %zu step kind(s), core's\n", label.c_str(),
				            case_list->size(), pf->ops.size(), pf->run_steps.size());
			}
		} else if (area == "mechanic-skill") {
			mechanic = true;
			label = area;
			ops = {"can_unlock"};
			std::printf("── %s (%zu case(s))\n", label.c_str(), case_list->size());
		} else {
			for (const auto &s : skills_areas()) skills = skills || s == area;
			if (!skills) {
				std::printf("  [FAIL] %s — area '%s' is not one this runner drives\n", file.c_str(), area.c_str());
				failed++;
				continue;
			}
			label = area;
			ops = {"case"};
			std::printf("── %s (%zu case(s))\n", label.c_str(), case_list->size());
		}

		g_steps.clear();
		g_kb_controls = 0;
		std::map<std::string, int> driven;
		int undriven = 0, other_queries = 0, file_refused = 0, file_accepted = 0;
		for (const auto &cp : case_list->array_items) {
			const JsonValue &cs = *cp;
			const std::string name = cs.get_string("name");
			std::string op = pf ? cs.get_string("op") : (mechanic ? "can_unlock" : "case");
			const JsonValue *expected = cs.find("expected");
			if (mechanic && cs.get_string("query").rfind("can_unlock(", 0) != 0) {
				other_queries++;
				continue;
			}
			total_cases++;
			const JsonValue *input = mechanic ? &cs : cs.find("input");
			if (!input || !input->is_object() || !expected) {
				std::printf("  [FAIL] %s — needs an input object and an expected answer\n", name.c_str());
				failed++;
				undriven++;
				continue;
			}
			bool known = false;
			for (const auto &o : ops) known = known || o == op;
			if (!known) {
				std::printf("  [FAIL] %s — op '%s' is not one of %s's\n", name.c_str(), op.c_str(), label.c_str());
				failed++;
				undriven++;
				continue;
			}
			JsonValuePtr actual;
			try {
				if (mechanic) actual = drive_kb_unlock(c, cs);
				else if (skills) actual = drive_skill_area(c, area, *input);
				else if (pf->file == "progression/gamification") actual = drive_gamification(c, op, *input);
				else if (pf->file == "progression/modules") actual = drive_modules(c, op, *input);
				else if (pf->file == "progression/skills") actual = drive_skills(c, op, *input);
				else actual = drive_save(c, op, *input);
			} catch (const std::exception &e) {
				std::printf("  [FAIL] %s — not driven: %s\n", name.c_str(), e.what());
				failed++;
				undriven++;
				continue;
			}
			if (negative) {
				JsonValuePtr bad = deep_copy(*expected);
				sabotage_last(*bad);
				if (compare(*bad, *actual, 0.0, "$").empty()) {
					std::printf("  [FAIL] %s — a perturbed expectation was accepted\n", name.c_str());
					failed++;
					file_accepted++;
				} else {
					file_refused++;
				}
			} else {
				const std::string diff = compare(*expected, *actual, 0.0, "$");
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
		for (const auto &o : ops) {
			if (!driven.count(o)) {
				std::printf("  [FAIL] op %s of %s: no case of it was driven\n", o.c_str(), label.c_str());
				failed++;
			}
			by_op += (by_op.empty() ? "" : ", ") + o + " " + std::to_string(driven.count(o) ? driven[o] : 0);
		}
		if (mechanic) {
			std::printf("  %s: %zu case(s), driven %s (through skill.unlock with the case's KB), %d other KB quer(ies) no row "
			            "answers; %d undriven\n",
			            label.c_str(), case_list->size(), by_op.c_str(), other_queries, undriven);
			std::printf("  no-KB control: %d node(s) the KB opened stay locked (requires) without it\n", g_kb_controls);
			if (!negative && g_kb_controls == 0) {
				std::printf("  [FAIL] no can_unlock case let a node through, so nothing shows the KB opened it\n");
				failed++;
			}
		} else {
			std::printf("  %s: %zu case(s), driven %s; %d undriven\n", label.c_str(), case_list->size(), by_op.c_str(), undriven);
		}
		if (pf && !pf->run_steps.empty()) {
			std::string by_step;
			for (const auto &s : pf->run_steps) {
				if (!g_steps.count(s)) {
					std::printf("  [FAIL] step %s of %s:run: no step of it was driven\n", s.c_str(), label.c_str());
					failed++;
				}
				by_step += (by_step.empty() ? "" : ", ") + s + " " + std::to_string(g_steps.count(s) ? g_steps[s] : 0);
			}
			std::printf("  steps through progression.gamification.step: %s\n", by_step.c_str());
		}
		if (negative) {
			std::printf("  negative: %d of %d perturbed expectation(s) refused, %d accepted\n", file_refused,
			            file_refused + file_accepted, file_accepted);
			refused += file_refused;
			accepted += file_accepted;
		}
	}

	// No session left open.
	{
		const char *raw = insimul_core_call(core, "session.list", "{}");
		auto l = raw ? insimul::parse_json(raw).root : nullptr;
		const JsonValue *open = l ? l->find("sessions") : nullptr;
		if (!open || !open->is_array() || open->size() != 0) {
			std::printf("  [FAIL] sessions left open: %s\n", open ? json_of(*open).c_str() : "(session.list failed)");
			failed++;
		}
	}
	insimul_core_destroy(core);

	const double ms = std::chrono::duration<double, std::milli>(std::chrono::steady_clock::now() - t0).count();
	if (negative) {
		std::printf("progression_corpus --negative: %d of %d perturbed case(s) refused, %d accepted, %d failure(s), %.0f ms\n", refused,
		            total_cases, accepted, failed, ms);
		if (failed || refused != total_cases || total_cases == 0) {
			std::printf("progression_corpus --negative: FAIL\n");
			return 1;
		}
		std::printf("progression_corpus --negative: PASS\n");
		return 0;
	}
	std::printf("progression_corpus: %d of %d case(s) driven through the rows, %d failed, %.0f ms\n", total_driven, total_cases, failed, ms);
	if (failed || total_driven == 0 || total_driven != total_cases) {
		std::printf("progression_corpus: FAIL\n");
		return 1;
	}
	std::printf("progression_corpus: PASS\n");
	return 0;
}
