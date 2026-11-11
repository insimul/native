// title_corpus.cpp — core's P8 corpora and its tutorial progress corpus,
// driven through libinsimulcore's `ui.titleFlow.*`, `ui.tutorial.*` and
// `ui.onboarding.*` rows.
//
// PL.native-title-rows (rulings U92(1) and U36). Core's P8 logic (P8.core:
// src/ui/title-flow.ts, game-engine/logic/TutorialQuestSystem.ts and
// game-engine/logic/OnboardingManager.ts) is a set of rows of
// corebridge/js/entry.js. This gate holds them to core's own corpora, COPIED byte
// for byte into corebridge/vendor/core/conformance/ at the pin and sha256-checked
// by the `core_vendor` ctest:
//
//   ui/title-flow.json            area ui-title-flow            menu, choose, session
//   quests/tutorial.json          area quests-tutorial          objectives, run, onboarding
//   saves/tutorial-progress.json  area saves-tutorial-progress  tutorial, onboarding
//     (PL.native-tutorial-save, U99(1); core's PL.tutorial-progress-save, U97(4))
//
// Nothing here re-writes a case or computes an answer: every answer comes out of
// a row. How each op is driven (core's runners, src/ui/title-flow-corpus.ts and
// src/quests/tutorial-corpus.ts, are the reference):
//
//   menu {menu}: `ui.titleFlow.create { menu }` → `{view}` (its `view`).
//   choose {menu, entry}: `ui.titleFlow.create { menu }`, then ONE
//   `ui.titleFlow.apply` op `choose { entry }` → `{choice}` (its result; `entry`
//   absent stays absent).
//   session {init, menu, steps}: `saves.slots.create` with `init`'s fields as its
//   args, then `ui.titleFlow.create { menu, savesSession }` linking that session →
//   `start` (its view). A `choose` step is one `ui.titleFlow.apply` op; any other
//   step is ONE `saves.slots.apply` op (the save-slots corpus's step → op mapping,
//   as tests/saves_slots_corpus.cpp has it), after which `ui.titleFlow.apply`
//   with no ops reads the menu. Each step records `{result, menu}`.
//   objectives {options}: `ui.tutorial.objectives` with `options` as its args →
//   `{objectives}`.
//   run {config, steps}: `ui.tutorial.create { config, now: <contract.t0> }` →
//   `start` = `{title, description, objectives, events, state: <view>}`; then ONE
//   `ui.tutorial.apply` op per step (`{start}` `{event: type}` → `{op: event,
//   type}` · `{complete}` · `{completeById: id}` → `{op, id}` · `{skip}` ·
//   `{skipNonAssessment}` · `{tick: ms}` → `{op, ms}` · `{dispose}`), each
//   recording `{result, events, state: <view>}` from the op's `{result, events}`.
//   onboarding {definition, options, steps}: `ui.onboarding.create { definition,
//   options, now: <contract.t0> }`, then ONE `ui.onboarding.apply` op per step
//   (`{start}` `{complete}` `{skip}` `{event: type}` `{tick: ms}` `{inspect}`),
//   each recording `{result, calls, state: <view>}`; `totalSteps` is the last
//   answer's (the create's when there is no step).
//
// saves-tutorial-progress (core's runner: src/quests/tutorial-progress-corpus.ts).
// `stored` is a save's `currentState.extensions.tutorial` (absent: no key):
//   read: `ui.tutorial.readProgress { stored }` (`stored` absent stays absent) →
//   `read`, `{ok: true, progress}` or `{ok: false, keys}`. When it is not ok the
//   case answers `{read}` alone, and the create row must REFUSE that same block
//   as `[invalid-input]` (checked; a create that takes it fails the case).
//   tutorial {config, stored?, steps}: `ui.tutorial.create { config: {...config,
//   progress: stored}, now: <contract.clockStart> }`, then ONE `ui.tutorial.apply`
//   op `save` → `start` = `{events, state: <create's view>, saved: <save's
//   result>}` (that read raises nothing, checked); then ONE op per step (`{start}`
//   `{event: type}` `{complete}` `{skip}` `{skipNonAssessment}` `{tick: ms}`
//   `{save}`), each recording `{result, events, state: <view>}` → `{read, start,
//   steps}`.
//   onboarding {definition, options, stored?, steps}: `ui.onboarding.create {
//   definition, options: {...options, progress: stored}, now }`, then ONE
//   `ui.onboarding.apply` op per step (`{start}` `{complete}` `{skip}` `{event:
//   type}` `{tick: ms}` `{save}`), each recording `{result, calls, state}` →
//   `{read, totalSteps, steps}`.
//   The file's `ops`, `tutorialSteps` and `onboardingSteps` are held to the
//   lists this runner maps (a step core adds is a red run, not a silent skip).
//
// The clock: core's corpus clock starts at the file's `contract.t0` (the
// progress file's `contract.clockStart`) and moves only on a tick, so the rows'
// sessions are opened with `now` = that string (a host clock), never the wall
// clock.
//
// Each file's `contract` data tables are held to its contract row's answer for
// its area (`ui.titleFlow.contract`, `ui.tutorial.contract`): every table the row
// states must equal the file's, and each table listed here must be stated. The
// run FAILS on a case whose op is not one of its area's, on a case it cannot
// drive (reported per file as `undriven`), on an op of the area no case drives,
// on a row missing from the method table, on a session left open, on a file of
// an unknown area, and when its comparator cannot fail (a self-test on every
// start). Comparison is the corpora's own rule (core's `compareVillageState`):
// numbers within the file's `tolerance`, everything else exactly, object key sets
// included.
//
// A pure consumer of insimulcore.h (no quickjs.h, no insimul.h). The JSON reader
// is tests/radiant/json_value.{h,cpp}, used as is.
//
// usage: insimulcore_title_corpus <corpus.json>...

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

std::string quoted(const std::string &s) {
	std::string out;
	write_string(out, s);
	return out;
}

// An object writer: `{"k":<raw json>,…}` from (key, raw JSON text) pairs.
struct ObjectText {
	std::string text = "{";
	void add(const std::string &key, const std::string &raw) {
		if (text.size() > 1) text += ',';
		write_string(text, key);
		text += ':';
		text += raw;
	}
	void add(const std::string &key, const JsonValue &v) { add(key, json_of(v)); }
	std::string done() const { return text + "}"; }
};

JsonValuePtr make_object(std::vector<std::pair<std::string, JsonValuePtr>> items) {
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

JsonValuePtr copy_of(const JsonValue &v) { return std::make_shared<JsonValue>(v); }

// ── comparing (the corpora's rule: numbers within tolerance, the rest exact) ──

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

std::string op_of_saves_step(const std::string &k, const JsonValue &v, std::string &why);
std::string op_of_progress_step(const std::string &k, const JsonValue &v, bool onboarding, std::string &why);

// The comparator and the step mapping are the gate; they must be able to fail.
bool self_test() {
	auto parse = [](const char *t) { return insimul::parse_json(t).root; };
	struct Probe {
		const char *expected, *actual;
		bool agree;
	} probes[] = {
	    {"{\"a\":1,\"b\":[true,\"x\"]}", "{\"b\":[true,\"x\"],\"a\":1.0}", true},
	    {"{\"a\":0.3}", "{\"a\":0.30000000000000004}", true},
	    {"{\"a\":1}", "{\"a\":1.000001}", false},
	    {"{\"ok\":false,\"refusal\":\"busy\",\"action\":null}", "{\"ok\":false,\"refusal\":\"no_saves\",\"action\":null}", false},
	    {"{\"a\":1}", "{\"a\":1,\"b\":null}", false},
	    {"{\"a\":1,\"b\":null}", "{\"a\":1}", false},
	    {"[1,2]", "[2,1]", false},
	    {"[1,2]", "[1,2,3]", false},
	    {"\"a\"", "\"b\"", false},
	    {"false", "0", false},
	    {"null", "0", false},
	    {"null", "{}", false},
	    {"{\"x\":{\"y\":true}}", "{\"x\":{\"y\":false}}", false},
	};
	bool ok = true;
	for (const Probe &p : probes) {
		auto e = parse(p.expected);
		auto a = parse(p.actual);
		bool agree = e && a && compare(*e, *a, 1e-9, "$").empty();
		if (agree != p.agree) {
			std::printf("  [FAIL] comparator self-test: %s vs %s should %s\n", p.expected, p.actual, p.agree ? "agree" : "differ");
			ok = false;
		}
	}
	// The save-slots step mapping: each step to its op, an unknown step refused.
	struct Step {
		const char *key, *value, *op;
	} steps[] = {
	    {"save", "1", "{\"op\":\"save\",\"slot\":1}"},
	    {"key", "\"F5\"", "{\"op\":\"key\",\"code\":\"F5\"}"},
	    {"tick", "2.5", "{\"op\":\"tick\",\"delta\":2.5}"},
	    {"continue", "true", "{\"op\":\"continue\"}"},
	    {"finished", "{\"ok\":true}", "{\"op\":\"finished\",\"ok\":true}"},
	    {"disk_changed", "null", "{\"op\":\"disk_changed\",\"slots\":null}"},
	    {"rename", "1", ""},
	};
	for (const Step &s : steps) {
		std::string why;
		auto v = parse(s.value);
		const std::string got = v ? op_of_saves_step(s.key, *v, why) : std::string();
		if (got != s.op) {
			std::printf("  [FAIL] step self-test: {%s: %s} should map to %s, got %s\n", s.key, s.value,
			            *s.op ? s.op : "(refused)", got.empty() ? "(refused)" : got.c_str());
			ok = false;
		}
	}
	// The tutorial progress step mapping (tutorial, then onboarding): each listed
	// step to its op, any other step refused.
	struct ProgressStep {
		bool onboarding;
		const char *key, *value, *op;
	} progress_steps[] = {
	    {false, "save", "true", "{\"op\":\"save\"}"},
	    {false, "event", "\"settlement_entered\"", "{\"op\":\"event\",\"type\":\"settlement_entered\"}"},
	    {false, "tick", "1500", "{\"op\":\"tick\",\"ms\":1500}"},
	    {false, "skipNonAssessment", "true", "{\"op\":\"skipNonAssessment\"}"},
	    {false, "completeById", "\"tut_camera\"", ""},
	    {false, "dispose", "true", ""},
	    {true, "save", "true", "{\"op\":\"save\"}"},
	    {true, "complete", "true", "{\"op\":\"complete\"}"},
	    {true, "skipNonAssessment", "true", ""},
	    {true, "inspect", "true", ""},
	};
	for (const ProgressStep &s : progress_steps) {
		std::string why;
		auto v = parse(s.value);
		const std::string got = v ? op_of_progress_step(s.key, *v, s.onboarding, why) : std::string();
		if (got != s.op) {
			std::printf("  [FAIL] progress step self-test: %s {%s: %s} should map to %s, got %s\n",
			            s.onboarding ? "onboarding" : "tutorial", s.key, s.value, *s.op ? s.op : "(refused)",
			            got.empty() ? "(refused)" : got.c_str());
			ok = false;
		}
	}
	return ok;
}

// ── the areas: their ops and the rows each op is driven through ───────────────

struct Area {
	const char *name;
	std::vector<std::string> ops;     // core's corpus runner's ops for the area
	std::vector<std::string> rows;    // the rows its cases go through
	const char *contract_row;         // the row that states its contract tables
	std::vector<std::string> tables;  // the data tables of its contract that row must state
	const char *clock;                // the contract table holding the corpus clock's start
	// Contract tables the row does not state but this runner's own mapping must
	// equal (the file's corpus-runner lists): name → the list this runner maps.
	std::vector<std::pair<std::string, std::vector<std::string>>> runner_tables;
};

// The steps op_of_progress_step maps (core's TUTORIAL_PROGRESS_STEPS and
// TUTORIAL_PROGRESS_ONBOARDING_STEPS, held to the file's contract below).
const std::vector<std::string> kProgressTutorialSteps = {"start", "event", "complete", "skip", "skipNonAssessment", "tick", "save"};
const std::vector<std::string> kProgressOnboardingSteps = {"start", "complete", "skip", "event", "tick", "save"};

const std::vector<Area> &areas() {
	static const std::vector<Area> all = {
	    {"ui-title-flow",
	     {"menu", "choose", "session"},
	     {"ui.titleFlow.create", "ui.titleFlow.apply", "ui.titleFlow.contract", "saves.slots.create", "saves.slots.apply"},
	     "ui.titleFlow.contract",
	     {"entries", "labels", "messages", "slotMessages", "defaultTitle", "defaultSlotCount", "ops", "steps"},
	     "t0",
	     {}},
	    {"quests-tutorial",
	     {"objectives", "run", "onboarding"},
	     {"ui.tutorial.objectives", "ui.tutorial.create", "ui.tutorial.apply", "ui.onboarding.create",
	      "ui.onboarding.apply", "ui.tutorial.contract"},
	     "ui.tutorial.contract",
	     {"objectives", "assessmentObjective", "flows", "ops", "runSteps", "onboardingSteps", "t0"},
	     "t0",
	     {}},
	    {"saves-tutorial-progress",
	     {"tutorial", "onboarding"},
	     {"ui.tutorial.readProgress", "ui.tutorial.create", "ui.tutorial.apply", "ui.onboarding.create",
	      "ui.onboarding.apply", "ui.tutorial.contract"},
	     "ui.tutorial.contract",
	     {"clockStart", "extensionKey", "blockMembers"},
	     "clockStart",
	     {{"ops", {"tutorial", "onboarding"}},
	      {"tutorialSteps", kProgressTutorialSteps},
	      {"onboardingSteps", kProgressOnboardingSteps}}},
	};
	return all;
}

const Area *area_named(const std::string &name) {
	for (const Area &a : areas()) {
		if (name == a.name) return &a;
	}
	return nullptr;
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

	// `<area>.apply` with `ops` (raw JSON array text): `{ results: [r…], view }`.
	JsonValuePtr apply(const std::string &method, const std::string &session, const std::string &ops, std::size_t n) {
		ObjectText args;
		args.add("session", session);
		args.add("ops", ops);
		auto r = call(method, args.done());
		if (!r) return nullptr;
		const JsonValue *results = r->find("results");
		if (!results || !results->is_array() || results->size() != n || !r->find("view")) {
			error = method + " answered no " + std::to_string(n) + " result(s) and view";
			return nullptr;
		}
		return r;
	}

	// ONE op: the answer, its single result in `result`.
	JsonValuePtr apply1(const std::string &method, const std::string &session, const std::string &op, JsonValuePtr &result) {
		auto r = apply(method, session, "[" + op + "]", 1);
		if (r) result = r->find("results")->array_items[0];
		return r;
	}

	// A session handle from a create answer, or "" with `error` set.
	std::string handle_of(const std::string &method, const JsonValue &r) {
		const JsonValue *h = r.find("session");
		if (!h || !h->is_number() || !r.find("view")) {
			error = method + " answered no session and view";
			return {};
		}
		return h->raw_number;
	}

	void dispose(const std::string &session) {
		if (!session.empty()) insimul_core_call(core, "session.dispose", ("{\"session\":" + session + "}").c_str());
	}
};

// A save-slots corpus step `{k: v}` as a `saves.slots.apply` op, or "" with `why`
// set (tests/saves_slots_corpus.cpp's mapping: core's runSaveSlotsStep).
std::string op_of_saves_step(const std::string &k, const JsonValue &v, std::string &why) {
	ObjectText op;
	op.add("op", quoted(k));
	if (k == "save" || k == "load" || k == "delete" || k == "ask_delete") {
		op.add("slot", v);
	} else if (k == "key") {
		op.add("code", v);
	} else if (k == "tick") {
		op.add("delta", v);
	} else if (k == "disk_changed") {
		// The new listing (core's `diskChanged`; null lists none) as the op's `slots`.
		op.add("slots", v);
	} else if (k == "continue" || k == "confirm_delete" || k == "cancel_delete") {
		// core's runner reads no value for these steps; the op has no field.
	} else if (k == "finished") {
		if (!v.is_object() || !v.find("ok") || v.find("ok")->type != JsonType::Bool || v.find("op")) {
			why = "a finished step the row cannot take (not an object with a boolean ok)";
			return {};
		}
		for (const auto &kv : v.object_items) op.add(kv.first, *kv.second);
	} else {
		why = "a save-slots step this runner does not know: " + k;
		return {};
	}
	return op.done();
}

// The one key of a step object, or "" with `why` set.
std::string step_key(const JsonValue &step, std::string &why) {
	if (!step.is_object() || step.object_items.size() != 1) {
		why = "a step names exactly one step: " + json_of(step);
		return {};
	}
	return step.object_items[0].first;
}

// ── ui-title-flow ─────────────────────────────────────────────────────────────

// `ui.titleFlow.create` args: the case's `menu` (as it stands; absent stays absent).
std::string title_create_args(const JsonValue &input, const std::string &saves) {
	ObjectText args;
	if (const JsonValue *menu = input.find("menu")) args.add("menu", *menu);
	if (!saves.empty()) args.add("savesSession", saves);
	return args.done();
}

bool drive_title(Caller &c, const std::string &op, const JsonValue &input, JsonValuePtr &out, std::string &why) {
	if (op == "menu" || op == "choose") {
		auto r = c.call("ui.titleFlow.create", title_create_args(input, ""));
		if (!r) return why = c.error, false;
		const std::string session = c.handle_of("ui.titleFlow.create", *r);
		if (session.empty()) return why = c.error, false;
		if (op == "menu") {
			c.dispose(session);
			out = make_object({{"view", copy_of(*r->find("view"))}});
			return true;
		}
		ObjectText choose;
		choose.add("op", "\"choose\"");
		if (const JsonValue *entry = input.find("entry")) choose.add("entry", *entry);
		JsonValuePtr result;
		auto a = c.apply1("ui.titleFlow.apply", session, choose.done(), result);
		c.dispose(session);
		if (!a) return why = c.error, false;
		out = make_object({{"choice", result}});
		return true;
	}
	// session {init, menu, steps}
	const JsonValue *steps = input.find("steps");
	if (!steps || !steps->is_array()) return why = "a session case needs steps", false;
	ObjectText init;
	if (const JsonValue *i = input.find("init")) {
		if (!i->is_object()) return why = "init is not an object", false;
		for (const auto &kv : i->object_items) init.add(kv.first, *kv.second);
	}
	auto sr = c.call("saves.slots.create", init.done());
	if (!sr) return why = c.error, false;
	const std::string saves = c.handle_of("saves.slots.create", *sr);
	if (saves.empty()) return why = c.error, false;
	auto r = c.call("ui.titleFlow.create", title_create_args(input, saves));
	if (!r) {
		c.dispose(saves);
		return why = c.error, false;
	}
	const std::string title = c.handle_of("ui.titleFlow.create", *r);
	if (title.empty()) {
		c.dispose(saves);
		return why = c.error, false;
	}
	auto fail = [&](const std::string &w) {
		c.dispose(title);
		c.dispose(saves);
		why = w;
		return false;
	};
	JsonValuePtr start = copy_of(*r->find("view"));
	std::vector<JsonValuePtr> answers;
	for (const auto &st : steps->array_items) {
		const std::string k = step_key(*st, why);
		if (k.empty()) return fail(why);
		const JsonValue &v = *st->object_items[0].second;
		JsonValuePtr result, menu;
		if (k == "choose") {
			ObjectText choose;
			choose.add("op", "\"choose\"");
			choose.add("entry", v);
			auto a = c.apply1("ui.titleFlow.apply", title, choose.done(), result);
			if (!a) return fail(c.error);
			menu = copy_of(*a->find("view"));
		} else {
			const std::string op = op_of_saves_step(k, v, why);
			if (op.empty()) return fail(why);
			if (!c.apply1("saves.slots.apply", saves, op, result)) return fail(c.error);
			auto a = c.apply("ui.titleFlow.apply", title, "[]", 0);
			if (!a) return fail(c.error);
			menu = copy_of(*a->find("view"));
		}
		answers.push_back(make_object({{"result", result}, {"menu", menu}}));
	}
	c.dispose(title);
	c.dispose(saves);
	out = make_object({{"start", start}, {"steps", make_array(std::move(answers))}});
	return true;
}

// ── quests-tutorial ───────────────────────────────────────────────────────────

// A tutorial run step `{k: v}` as a `ui.tutorial.apply` op, or "" with `why` set.
std::string op_of_run_step(const std::string &k, const JsonValue &v, std::string &why) {
	ObjectText op;
	op.add("op", quoted(k));
	if (k == "event") {
		op.add("type", v);
	} else if (k == "completeById") {
		op.add("id", v);
	} else if (k == "tick") {
		op.add("ms", v);
	} else if (k != "start" && k != "complete" && k != "skip" && k != "skipNonAssessment" && k != "dispose") {
		why = "a run step this runner does not know: " + k;
		return {};
	}
	return op.done();
}

// An onboarding step `{k: v}` as a `ui.onboarding.apply` op, or "" with `why` set.
std::string op_of_onboarding_step(const std::string &k, const JsonValue &v, std::string &why) {
	ObjectText op;
	op.add("op", quoted(k));
	if (k == "event") {
		op.add("type", v);
	} else if (k == "tick") {
		op.add("ms", v);
	} else if (k != "start" && k != "complete" && k != "skip" && k != "inspect") {
		why = "an onboarding step this runner does not know: " + k;
		return {};
	}
	return op.done();
}

bool drive_tutorial(Caller &c, const std::string &op, const JsonValue &input, const std::string &t0, JsonValuePtr &out,
                    std::string &why) {
	if (op == "objectives") {
		const JsonValue *options = input.find("options");
		auto r = c.call("ui.tutorial.objectives", options ? json_of(*options) : std::string("{}"));
		if (!r) return why = c.error, false;
		out = r;
		return true;
	}
	if (t0.empty()) return why = "the file's contract states no t0, so no session clock can start where core's does", false;
	const JsonValue *steps = input.find("steps");
	if (!steps || !steps->is_array()) return why = "a " + op + " case needs steps", false;
	const bool run = op == "run";
	const std::string create = run ? "ui.tutorial.create" : "ui.onboarding.create";
	const std::string apply = run ? "ui.tutorial.apply" : "ui.onboarding.apply";
	ObjectText args;
	for (const char *k : run ? std::vector<const char *>{"config"} : std::vector<const char *>{"definition", "options"}) {
		if (const JsonValue *v = input.find(k)) args.add(k, *v);
	}
	args.add("now", quoted(t0));
	auto r = c.call(create, args.done());
	if (!r) return why = c.error, false;
	const std::string session = c.handle_of(create, *r);
	if (session.empty()) return why = c.error, false;
	JsonValuePtr start;
	JsonValuePtr total;
	if (run) {
		std::vector<std::pair<std::string, JsonValuePtr>> s;
		for (const char *k : {"title", "description", "objectives", "events"}) {
			const JsonValue *v = r->find(k);
			if (!v) {
				c.dispose(session);
				return why = create + " answered no " + k, false;
			}
			s.emplace_back(k, copy_of(*v));
		}
		s.emplace_back("state", copy_of(*r->find("view")));
		start = make_object(std::move(s));
	} else {
		const JsonValue *t = r->find("totalSteps");
		if (!t) {
			c.dispose(session);
			return why = create + " answered no totalSteps", false;
		}
		total = copy_of(*t);
	}
	std::vector<JsonValuePtr> answers;
	for (const auto &st : steps->array_items) {
		const std::string k = step_key(*st, why);
		const std::string o = k.empty() ? std::string()
		                      : run    ? op_of_run_step(k, *st->object_items[0].second, why)
		                               : op_of_onboarding_step(k, *st->object_items[0].second, why);
		if (o.empty()) {
			c.dispose(session);
			return false;
		}
		JsonValuePtr result;
		auto a = c.apply1(apply, session, o, result);
		if (!a) {
			c.dispose(session);
			return why = c.error, false;
		}
		const char *side = run ? "events" : "calls";
		const JsonValue *res = result->find("result");
		const JsonValue *sv = result->find(side);
		if (!result->is_object() || !res || !sv) {
			c.dispose(session);
			return why = apply + " answered an op result with no result and " + side, false;
		}
		answers.push_back(make_object({{"result", copy_of(*res)}, {side, copy_of(*sv)}, {"state", copy_of(*a->find("view"))}}));
		if (!run) {
			const JsonValue *t = a->find("totalSteps");
			if (!t) {
				c.dispose(session);
				return why = apply + " answered no totalSteps", false;
			}
			total = copy_of(*t);
		}
	}
	c.dispose(session);
	out = run ? make_object({{"start", start}, {"steps", make_array(std::move(answers))}})
	          : make_object({{"totalSteps", total}, {"steps", make_array(std::move(answers))}});
	return true;
}

// ── saves-tutorial-progress ───────────────────────────────────────────────────

// A tutorial progress step `{k: v}` as a `ui.tutorial.apply` (or, `onboarding`,
// `ui.onboarding.apply`) op, or "" with `why` set. Only the steps core's runner
// takes for that op (kProgressTutorialSteps / kProgressOnboardingSteps).
std::string op_of_progress_step(const std::string &k, const JsonValue &v, bool onboarding, std::string &why) {
	const std::vector<std::string> &known = onboarding ? kProgressOnboardingSteps : kProgressTutorialSteps;
	bool listed = false;
	for (const std::string &s : known) listed = listed || s == k;
	if (!listed) {
		why = std::string("a ") + (onboarding ? "onboarding" : "tutorial") + " progress step this runner does not know: " + k;
		return {};
	}
	ObjectText op;
	op.add("op", quoted(k));
	if (k == "event") {
		op.add("type", v);
	} else if (k == "tick") {
		op.add("ms", v);
	}
	return op.done();
}

// `src` (an object or absent) with `progress` = the case's `stored` added when the
// case states one; "" with `why` set when `src` is not an object or already
// names a progress.
std::string with_progress(const JsonValue *src, const JsonValue *stored, const char *name, std::string &why) {
	ObjectText out;
	if (src) {
		if (!src->is_object()) {
			why = std::string(name) + " is not an object";
			return {};
		}
		for (const auto &kv : src->object_items) {
			if (kv.first == "progress") {
				why = std::string(name) + " already names a progress; the case's stored is the progress";
				return {};
			}
			out.add(kv.first, *kv.second);
		}
	}
	if (stored) out.add("progress", *stored);
	return out.done();
}

bool drive_progress(Caller &c, const std::string &op, const JsonValue &input, const std::string &clock, JsonValuePtr &out,
                    std::string &why) {
	if (clock.empty()) return why = "the file's contract states no clockStart, so no session clock can start where core's does", false;
	const JsonValue *steps = input.find("steps");
	if (!steps || !steps->is_array()) return why = "a " + op + " case needs steps", false;
	const bool tut = op == "tutorial";
	const JsonValue *stored = input.find("stored");

	ObjectText read_args;
	if (stored) read_args.add("stored", *stored);
	auto read = c.call("ui.tutorial.readProgress", read_args.done());
	if (!read) return why = c.error, false;
	const JsonValue *ok = read->find("ok");
	if (!ok || ok->type != JsonType::Bool) return why = "ui.tutorial.readProgress answered no boolean ok", false;

	const std::string create = tut ? "ui.tutorial.create" : "ui.onboarding.create";
	const std::string apply = tut ? "ui.tutorial.apply" : "ui.onboarding.apply";
	ObjectText args;
	if (tut) {
		const std::string config = with_progress(input.find("config"), stored, "config", why);
		if (config.empty()) return false;
		args.add("config", config);
	} else {
		if (const JsonValue *d = input.find("definition")) args.add("definition", *d);
		const std::string options = with_progress(input.find("options"), stored, "options", why);
		if (options.empty()) return false;
		args.add("options", options);
	}
	args.add("now", quoted(clock));

	if (!ok->bool_value) {
		// Unreadable: the case answers `{read}` alone, and the create row must refuse
		// the very block readProgress refused, with the row's [invalid-input].
		const char *raw = insimul_core_call(c.core, create.c_str(), args.done().c_str());
		if (raw) {
			auto r = insimul::parse_json(raw);
			if (r.ok && r.root->is_object()) {
				if (const JsonValue *h = r.root->find("session")) c.dispose(h->raw_number);
			}
			return why = create + " took a progress ui.tutorial.readProgress refuses", false;
		}
		const std::string err = insimul_core_last_error(c.core);
		if (err.find("[invalid-input]") == std::string::npos) {
			return why = create + " refused the unreadable progress without [invalid-input]: " + err, false;
		}
		out = make_object({{"read", copy_of(*read)}});
		return true;
	}

	auto r = c.call(create, args.done());
	if (!r) return why = c.error, false;
	const std::string session = c.handle_of(create, *r);
	if (session.empty()) return why = c.error, false;
	auto fail = [&](const std::string &w) {
		c.dispose(session);
		why = w;
		return false;
	};
	JsonValuePtr start;
	JsonValuePtr total;
	if (tut) {
		const JsonValue *events = r->find("events");
		if (!events) return fail(create + " answered no events");
		JsonValuePtr saved;
		auto a = c.apply1(apply, session, "{\"op\":\"save\"}", saved);
		if (!a) return fail(c.error);
		const JsonValue *res = saved->find("result");
		const JsonValue *ev = saved->find("events");
		if (!saved->is_object() || !res || !ev || !ev->is_array()) return fail(apply + " answered a save with no result and events");
		if (ev->size() != 0) return fail(apply + "'s save raised " + json_of(*ev) + "; a save reads without acting");
		start = make_object({{"events", copy_of(*events)}, {"state", copy_of(*r->find("view"))}, {"saved", copy_of(*res)}});
	} else {
		const JsonValue *t = r->find("totalSteps");
		if (!t) return fail(create + " answered no totalSteps");
		total = copy_of(*t);
	}
	std::vector<JsonValuePtr> answers;
	for (const auto &st : steps->array_items) {
		const std::string k = step_key(*st, why);
		const std::string o = k.empty() ? std::string() : op_of_progress_step(k, *st->object_items[0].second, !tut, why);
		if (o.empty()) return fail(why);
		JsonValuePtr result;
		auto a = c.apply1(apply, session, o, result);
		if (!a) return fail(c.error);
		const char *side = tut ? "events" : "calls";
		const JsonValue *res = result->find("result");
		const JsonValue *sv = result->find(side);
		if (!result->is_object() || !res || !sv) return fail(apply + " answered an op result with no result and " + side);
		answers.push_back(make_object({{"result", copy_of(*res)}, {side, copy_of(*sv)}, {"state", copy_of(*a->find("view"))}}));
		if (!tut) {
			const JsonValue *t = a->find("totalSteps");
			if (!t) return fail(apply + " answered no totalSteps");
			total = copy_of(*t);
		}
	}
	c.dispose(session);
	out = tut ? make_object({{"read", copy_of(*read)}, {"start", start}, {"steps", make_array(std::move(answers))}})
	          : make_object({{"read", copy_of(*read)}, {"totalSteps", total}, {"steps", make_array(std::move(answers))}});
	return true;
}

} // namespace

int main(int argc, char **argv) {
	if (argc < 2) {
		std::fprintf(stderr, "usage: insimulcore_title_corpus <corpus.json>...\n");
		return 2;
	}
	if (!self_test()) {
		std::fprintf(stderr, "title_corpus: the comparator or the step mapping cannot tell a wrong answer from a right one\n");
		return 2;
	}
	insimul_core *core = insimul_core_create();
	if (!core) {
		std::fprintf(stderr, "title_corpus: insimul_core_create() failed\n");
		return 2;
	}
	std::printf("title_corpus: %s\n", insimul_core_version());
	Caller c{core, {}};

	int failed = 0, total_driven = 0;
	std::set<std::string> table;
	{
		auto m = c.call("core.methods", "{}");
		const JsonValue *list = m ? m->find("methods") : nullptr;
		if (list && list->is_array()) {
			for (const auto &x : list->array_items) table.insert(x->as_string());
		}
	}

	const auto t_start = std::chrono::steady_clock::now();
	for (int f = 1; f < argc; f++) {
		const std::string file = argv[f];
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
			std::printf("  [FAIL] %s — area '%s' is not one of the P8 or tutorial progress corpora\n", file.c_str(), area_name.c_str());
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
		const JsonValue *theirs = doc.find("contract");
		const JsonValue *t0_v = theirs ? theirs->find(area->clock) : nullptr;
		const std::string t0 = t0_v && t0_v->type == JsonType::String ? t0_v->string_value : std::string();
		std::printf("── %s (area %s, %zu case(s))\n", file.c_str(), area_name.c_str(), case_list->size());
		int file_failed = 0;

		// The surface: a missing row would otherwise show only as every case failing.
		for (const std::string &row : area->rows) {
			if (!table.count(row)) {
				std::printf("  [FAIL] surface: the method table has no %s row\n", row.c_str());
				file_failed++;
			}
		}

		// The contract tables: every table the area's contract row states is the file's.
		{
			JsonValuePtr answer = c.call(area->contract_row, "{}");
			const JsonValue *mine = answer ? answer->find(area_name) : nullptr;
			if (!mine || !mine->is_object() || mine->object_items.empty()) {
				std::printf("  [FAIL] contract: %s states no table for %s%s%s\n", area->contract_row, area_name.c_str(),
				            answer ? "" : ": ", answer ? "" : c.error.c_str());
				file_failed++;
			} else {
				int bad = 0;
				for (const std::string &t : area->tables) {
					if (!mine->find(t)) {
						std::printf("  [FAIL] contract.%s: %s states no such table\n", t.c_str(), area->contract_row);
						bad++;
					}
				}
				for (const auto &kv : mine->object_items) {
					const JsonValue *t = theirs ? theirs->find(kv.first) : nullptr;
					const std::string diff = t ? compare(*t, *kv.second, 0.0, "contract." + kv.first)
					                           : "contract." + kv.first + ": the file states no such table";
					if (!diff.empty()) {
						std::printf("  [FAIL] %s\n", diff.c_str());
						bad++;
					}
				}
				file_failed += bad;
				std::printf("  contract: %zu table(s) %s\n", mine->object_items.size(), bad ? "DIFFER" : ("are " + std::string(area->contract_row) + "'s").c_str());
			}
			// The file's corpus-runner lists: each must be exactly what this runner maps.
			for (const auto &rt : area->runner_tables) {
				const JsonValue *t = theirs ? theirs->find(rt.first) : nullptr;
				std::vector<JsonValuePtr> items;
				for (const std::string &x : rt.second) {
					auto v = std::make_shared<JsonValue>();
					v->type = JsonType::String;
					v->string_value = x;
					items.push_back(v);
				}
				auto mine_list = make_array(std::move(items));
				const std::string diff = t ? compare(*t, *mine_list, 0.0, "contract." + rt.first)
				                           : "contract." + rt.first + ": the file states no such table";
				if (!diff.empty()) {
					std::printf("  [FAIL] %s (the runner maps %s)\n", diff.c_str(), json_of(*mine_list).c_str());
					file_failed++;
				}
			}
		}

		std::map<std::string, int> driven;
		int undriven = 0, file_driven = 0;
		for (const auto &cp : case_list->array_items) {
			const JsonValue &cs = *cp;
			const std::string name = cs.get_string("name");
			const std::string op = cs.get_string("op");
			const JsonValue *input = cs.find("input");
			const JsonValue *expected = cs.find("expected");
			if (!input || !input->is_object() || !expected) {
				std::printf("  [FAIL] %s — needs an input object and an expected answer\n", name.c_str());
				undriven++;
				continue;
			}
			bool known = false;
			for (const std::string &o : area->ops) known = known || o == op;
			if (!known) {
				std::printf("  [FAIL] %s — op '%s' is not one of area %s's\n", name.c_str(), op.c_str(), area_name.c_str());
				undriven++;
				continue;
			}
			JsonValuePtr actual;
			std::string why;
			const bool ok = area_name == "ui-title-flow"     ? drive_title(c, op, *input, actual, why)
			                : area_name == "quests-tutorial" ? drive_tutorial(c, op, *input, t0, actual, why)
			                                                 : drive_progress(c, op, *input, t0, actual, why);
			if (!ok) {
				std::printf("  [FAIL] %s — not driven: %s\n", name.c_str(), why.c_str());
				undriven++;
				continue;
			}
			driven[op]++;
			file_driven++;
			const std::string diff = compare(*expected, *actual, tol, "$");
			if (!diff.empty()) {
				std::printf("  [FAIL] %s — %s\n", name.c_str(), diff.c_str());
				file_failed++;
			}
		}
		std::string by_op;
		for (const std::string &o : area->ops) {
			if (!driven.count(o)) {
				std::printf("  [FAIL] op %s of area %s: no case of it was driven\n", o.c_str(), area_name.c_str());
				file_failed++;
			}
			by_op += (by_op.empty() ? "" : ", ") + o + " " + std::to_string(driven.count(o) ? driven[o] : 0);
		}
		if (undriven) std::printf("  [FAIL] %s — %d case(s) undriven\n", file.c_str(), undriven);
		file_failed += undriven;
		std::printf("  %s %s: %zu case(s), driven %d (%s), %d undriven, %d failed\n", file_failed ? "[FAIL]" : "[ ok ]",
		            area_name.c_str(), case_list->size(), file_driven, by_op.c_str(), undriven, file_failed);
		failed += file_failed;
		total_driven += file_driven;
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

	const double ms = std::chrono::duration<double, std::milli>(std::chrono::steady_clock::now() - t_start).count();
	std::printf("title_corpus: %d case(s) driven through the rows, %d failed, %.0f ms\n", total_driven, failed, ms);
	if (failed || total_driven == 0) {
		std::printf("title_corpus: FAIL\n");
		return 1;
	}
	std::printf("title_corpus: PASS\n");
	return 0;
}
