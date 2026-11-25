// runtime_save_corpus.cpp — core's runtime save and interior save corpora, driven through
// libinsimulcore's `save.runtime.*` and `save.interior.*` rows.
//
// PL.native-runtime-save-rows (rulings U131, U128, U118(5), U124, U126(3), U101(1), U49(3), U36).
// Core's runtime save (src/runtime-save.ts: PL.core-load-refused-message, PL.core-load-refusal-codes)
// and its rules for a save written inside an interior (src/props/interior-save.ts:
// PL.core-interior-save-state) are rows of corebridge/js/entry.js. This gate holds them to core's own
// corpora, conformance/saves/runtime-save.json and conformance/saves/interior-state.json, COPIED byte
// for byte into corebridge/vendor/core/conformance/saves/ at the pin and sha256-checked by the
// `core_vendor` ctest. Nothing here re-writes a case or computes an answer: every answer comes out of
// the rows.
//
// One runner, two files (told apart by `area`). Each op is driven as core's reference runner composes
// it (src/runtime-save-corpus.ts `runRuntimeSaveOp`; src/interior-save-corpus.ts `runInteriorSaveOp`):
//
//   runtime-save.json (area saves-runtime)
//     run         save.runtime.create { fresh } → start { runtimeSave, fresh }; then per step one
//                 save.runtime.apply { session, ops: [op] }: { new_game: true } → { op: new_game },
//                 { load: doc } → { op: load, save: doc, options: readOptions }, { save: gs } →
//                 { op: save, gameState: gs, options: writeOptions }; each step records { result,
//                 runtimeSave, fresh }. A result is pinned as the corpus pins it: { ok: true } (an accepted
//                 Load's gameState must be an object, an accepted Save's `save` must BE the runtime save the
//                 step reports), or a refusal as { code, field } (its `message`, core's sentence for a log,
//                 must be a string and is then set aside, as core's runner sets it aside), with a refused
//                 Load's `outcome` and `message`.
//   interior-state.json (area saves-interior-state)
//     read        save.interior.read { interiorState }; null → layout null, else save.interior.layoutOf
//     load        save.interior.loadOf { interiorState, position, rotation, buildings } (player's)
//     round_trip  save.runtime.create { fresh }, apply save (writeOptions); a second create { fresh },
//                 apply load of the written save (readOptions); then save.interior.loadOf over the loaded
//                 game state. A refusal at either step answers { refused: { code, field } }.
//     controls    each `controls` entry is one case's answer with one thing changed: the runner drives
//                 that case and must REFUSE the control's answer (core's checkInteriorSaveControl).
//
// The rows' `save.runtime.contract` / `save.interior.contract` are held to the file's `contract` key
// for key; every other contract key is accounted for by name: the ops and steps must be exactly this
// runner's (a new op at a re-pin fails here, not silently); the refusal outcome table, the unstated
// outcome and the interior file's refusal codes are answered through the `ui.loadRefusal` row; the rest
// are prose rules the cases pin. An unknown key fails.
//
// The run FAILS on a file that is neither corpus or holds no case, an op no case drives, a row missing
// from the method table, a contract key that differs or is unknown, a control accepted, a session left
// open, and when its comparator or its perturbation cannot fail (a self-test on every start). Refusal
// probes prove on every start that an unknown op fails its case, that the rows answer core's refusals
// as VALUES (another world's save on a Load, and nothing changes) and what core would dereference
// unread as the `[invalid-input]` ERROR, and that an unknown row is the method table's error.
// Comparison is the corpora's own rule (core's `compareVillageState`): numbers within the file's
// `tolerance`, everything else exactly, object key sets included.
//
// --negative perturbs EVERY driven case's expectation (its last leaf) and requires every one refused.
//
// A pure consumer of insimulcore.h (no quickjs.h, no insimul.h). The JSON reader is
// tests/radiant/json_value.{h,cpp}, used as is.
//
// usage: insimulcore_runtime_save_corpus [--negative] <conformance/saves/{runtime-save,interior-state}.json>

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

// core's RUNTIME_SAVE_OPS / RUNTIME_SAVE_STEPS (src/runtime-save-corpus.ts) and INTERIOR_SAVE_OPS
// (src/interior-save-corpus.ts), in their order.
const std::vector<std::string> kRuntimeOps = {"run"};
const std::vector<std::string> kRuntimeSteps = {"new_game", "load", "save"};
const std::vector<std::string> kInteriorOps = {"read", "load", "round_trip"};

// Every row this runner calls.
const char *const kRows[] = {"save.runtime.contract",  "save.runtime.create",       "save.runtime.apply",
                             "save.interior.contract", "save.interior.read",        "save.interior.layoutOf",
                             "save.interior.loadOf",   "ui.loadRefusal",            "session.dispose",
                             "session.list"};

// The contract keys each file states as prose (rules the cases pin), by name.
const std::set<std::string> kRuntimeProse = {"newGameRule", "loadRule", "ownershipRule", "refusedLoadRule", "saveRule", "freshRule"};
const std::set<std::string> kInteriorProse = {"shape",          "layoutSeedRule", "positionFrameRule",       "writerRule",
                                              "readerRule",     "loadRule",       "framePointRule",          "loadNotesAreNotRefusals"};

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
	// `key` from `input` when `input` has it (an absent key stays absent, as core's runner hands it).
	void copy(const JsonValue &input, const char *from, const char *to = nullptr) {
		if (const JsonValue *v = input.find(from)) add(to ? to : from, *v);
	}
	std::string done() const { return text + "}"; }
};

JsonValuePtr make_object(std::vector<std::pair<std::string, JsonValuePtr>> items) {
	auto v = std::make_shared<JsonValue>();
	v->type = JsonType::Object;
	v->object_items = std::move(items);
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

JsonValuePtr deep_copy(const JsonValue &v) {
	auto c = std::make_shared<JsonValue>(v);
	for (auto &item : c->array_items) item = deep_copy(*item);
	for (auto &kv : c->object_items) kv.second = deep_copy(*kv.second);
	return c;
}

// ── comparing (the corpus's rule: numbers within tolerance, the rest exact) ───

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

// The comparator and the perturbation are the gate; they must be able to fail.
bool self_test() {
	auto parse = [](const char *t) { return insimul::parse_json(t).root; };
	struct Probe {
		const char *expected, *actual;
		bool agree;
	} probes[] = {
	    {"{\"a\":1,\"b\":[true,\"x\"]}", "{\"b\":[true,\"x\"],\"a\":1.0}", true},
	    {"{\"a\":0.3}", "{\"a\":0.30000000000000004}", true},
	    {"{\"a\":1}", "{\"a\":1.000001}", false},
	    {"{\"ok\":false,\"refusal\":{\"code\":\"wrong_world\"}}", "{\"ok\":false,\"refusal\":{\"code\":\"wrong_runtime\"}}", false},
	    {"{\"a\":1}", "{\"a\":1,\"b\":null}", false},
	    {"{\"a\":1,\"b\":null}", "{\"a\":1}", false},
	    {"[1,2]", "[2,1]", false},
	    {"[{}]", "[]", false},
	    {"false", "0", false},
	    {"null", "{}", false},
	    {"\"2026-11-19T10:00:00.000Z\"", "\"2026-11-19T10:00:00Z\"", false},
	};
	bool ok = true;
	for (const Probe &p : probes) {
		auto e = parse(p.expected);
		auto a = parse(p.actual);
		const bool agree = e && a && compare(*e, *a, 1e-9, "$").empty();
		if (agree != p.agree) {
			std::printf("  [FAIL] self-test: %s vs %s should %s\n", p.expected, p.actual, p.agree ? "agree" : "differ");
			ok = false;
		}
	}
	const char *sources[] = {"[{}]", "[]", "{\"ok\":true,\"gameState\":{\"npcs\":[]}}", "{\"timestamp\":null}",
	                         "{\"ok\":false,\"refusal\":{\"code\":\"wrong_version\",\"found\":null}}"};
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
};


const JsonValue &need(const JsonValue &input, const char *key) {
	const JsonValue *v = input.find(key);
	if (!v) throw DriveError(std::string("the case's input has no ") + key);
	return *v;
}

// The first (only) result of an apply's answer.
const JsonValue &only_result(const JsonValue &answer) {
	const JsonValue *results = answer.find("results");
	if (!results || !results->is_array() || results->size() != 1) {
		throw DriveError("save.runtime.apply answered no single result for one op");
	}
	return *results->array_items[0];
}

// A refusal as the corpora pin it, `{ code, field }`, after checking the row's `message` (core's
// sentence for a log) is a non-empty string, as core's runners set it aside.
JsonValuePtr pinned_refusal(const char *what, const JsonValue &refusal) {
	if (!refusal.is_object()) throw DriveError(std::string(what) + " refused with no refusal object");
	const JsonValue *message = refusal.find("message");
	if (!message || !message->is_string() || message->string_value.empty()) {
		throw DriveError(std::string(what) + " refused with no message (core's sentence for a log)");
	}
	const JsonValue *code = refusal.find("code");
	const JsonValue *field = refusal.find("field");
	if (!code || !field) throw DriveError(std::string(what) + " refused with no code or no field");
	return make_object({{"code", deep_copy(*code)}, {"field", deep_copy(*field)}});
}

struct Session {
	Caller &c;
	long long id = 0;
	Session(Caller &caller, const JsonValue &fresh, JsonValuePtr *view) : c(caller) {
		ObjectText a;
		a.add("fresh", fresh);
		auto r = c.call("save.runtime.create", a.done());
		const JsonValue *s = r->find("session");
		if (!s || !s->is_number()) throw DriveError("save.runtime.create answered no session");
		id = static_cast<long long>(s->number_value);
		if (view) *view = r;
	}
	~Session() { c.try_call("session.dispose", "{\"session\":" + std::to_string(id) + "}"); }
	// One op: the apply's whole answer.
	JsonValuePtr apply(const std::string &op_json) {
		return c.call("save.runtime.apply", "{\"session\":" + std::to_string(id) + ",\"ops\":[" + op_json + "]}");
	}
};

// The view `{ runtimeSave, fresh }` from a create or apply answer.
JsonValuePtr view_of(const JsonValue &answer, const char *what) {
	const JsonValue *rs = answer.find("runtimeSave");
	const JsonValue *fresh = answer.find("fresh");
	if (!rs || !fresh || fresh->type != JsonType::Bool) throw DriveError(std::string(what) + " answered no runtimeSave and fresh");
	return make_object({{"runtimeSave", deep_copy(*rs)}, {"fresh", deep_copy(*fresh)}});
}

// runtime-save.json's `run`.
JsonValuePtr drive_run(Caller &c, const JsonValue &input) {
	JsonValuePtr created;
	Session s(c, need(input, "fresh"), &created);
	const JsonValue &steps = need(input, "steps");
	if (!steps.is_array()) throw DriveError("the case's steps are not a list");
	auto out_steps = std::make_shared<JsonValue>();
	out_steps->type = JsonType::Array;
	for (const auto &stp : steps.array_items) {
		if (!stp->is_object() || stp->object_items.size() != 1) throw DriveError("a step names exactly one of new_game, load, save");
		const std::string kind = stp->object_items[0].first;
		const JsonValue &v = *stp->object_items[0].second;
		ObjectText op;
		op.add("op", "\"" + kind + "\"");
		if (kind == "load") {
			op.add("save", v);
			op.copy(input, "readOptions", "options");
		} else if (kind == "save") {
			op.add("gameState", v);
			op.copy(input, "writeOptions", "options");
		} else if (kind != "new_game") {
			throw DriveError("step " + kind + " is not one of core's runtime-save steps (runtime-save-corpus.ts)");
		}
		auto answer = s.apply(op.done());
		const JsonValue &res = only_result(*answer);
		auto view = view_of(*answer, "save.runtime.apply");
		const JsonValue *ok = res.find("ok");
		if (!ok || ok->type != JsonType::Bool) throw DriveError("a step answered no boolean ok");
		JsonValuePtr result;
		if (kind == "new_game") {
			result = deep_copy(res);
		} else if (ok->bool_value) {
			if (kind == "load") {
				const JsonValue *gs = res.find("gameState");
				if (!gs || !gs->is_object()) throw DriveError("an accepted Load answered no game state");
			} else {
				const JsonValue *saved = res.find("save");
				if (!saved || !compare(*saved, *view->find("runtimeSave"), 0.0, "$").empty()) {
					throw DriveError("an accepted Save's written document is not the runtime save the step reports");
				}
			}
			result = make_object({{"ok", make_bool(true)}});
		} else {
			std::vector<std::pair<std::string, JsonValuePtr>> items = {{"ok", make_bool(false)},
			                                                           {"refusal", pinned_refusal("a step", need(res, "refusal"))}};
			if (kind == "load") {
				items.emplace_back("outcome", deep_copy(need(res, "outcome")));
				items.emplace_back("message", deep_copy(need(res, "message")));
			}
			result = make_object(std::move(items));
		}
		out_steps->array_items.push_back(make_object({{"result", result},
		                                              {"runtimeSave", deep_copy(*view->find("runtimeSave"))},
		                                              {"fresh", deep_copy(*view->find("fresh"))}}));
	}
	return make_object({{"start", view_of(*created, "save.runtime.create")}, {"steps", out_steps}});
}

JsonValuePtr json_null() { return std::make_shared<JsonValue>(); }

// `v[key]`, or null when `v` is not an object or has no such key (core's `?? null`).
JsonValuePtr member_or_null(const JsonValue *v, const char *key) {
	if (!v || !v->is_object()) return json_null();
	const JsonValue *m = v->find(key);
	return m ? deep_copy(*m) : json_null();
}

// interior-state.json's three ops.
JsonValuePtr drive_interior(Caller &c, const std::string &op, const JsonValue &input) {
	if (op == "read") {
		ObjectText a;
		a.copy(input, "interiorState");
		auto r = c.call("save.interior.read", a.done());
		const JsonValue *s = r->find("interiorState");
		if (!s) throw DriveError("save.interior.read answered no interiorState");
		JsonValuePtr layout = json_null();
		if (!s->is_null()) {
			ObjectText l;
			l.add("interiorState", *s);
			auto lo = c.call("save.interior.layoutOf", l.done());
			const JsonValue *v = lo->find("layout");
			if (!v) throw DriveError("save.interior.layoutOf answered no layout");
			layout = deep_copy(*v);
		}
		return make_object({{"interiorState", deep_copy(*s)}, {"layout", layout}});
	}
	if (op == "load") {
		ObjectText a;
		a.copy(input, "interiorState");
		const JsonValue *player = input.find("player");
		if (player && player->is_object()) {
			a.copy(*player, "position");
			a.copy(*player, "rotation");
		}
		a.copy(input, "buildings");
		return c.call("save.interior.loadOf", a.done());
	}
	if (op == "round_trip") {
		Session w(c, need(input, "fresh"), nullptr);
		ObjectText so;
		so.add("op", "\"save\"");
		so.copy(input, "gameState");
		so.copy(input, "writeOptions", "options");
		auto saved_answer = w.apply(so.done());
		const JsonValue &saved = only_result(*saved_answer);
		if (!saved.get_bool("ok")) return make_object({{"refused", pinned_refusal("the save", need(saved, "refusal"))}});
		const JsonValue &doc = need(saved, "save");
		Session r(c, need(input, "fresh"), nullptr);
		ObjectText lo;
		lo.add("op", "\"load\"");
		lo.add("save", doc);
		lo.copy(input, "readOptions", "options");
		auto loaded_answer = r.apply(lo.done());
		const JsonValue &loaded = only_result(*loaded_answer);
		if (!loaded.get_bool("ok")) return make_object({{"refused", pinned_refusal("the load", need(loaded, "refusal"))}});
		const JsonValue &gs = need(loaded, "gameState");
		const JsonValue *cs = doc.find("currentState");
		const JsonValue *cs_player = cs && cs->is_object() ? cs->find("player") : nullptr;
		const JsonValue &gs_player = need(gs, "player");
		JsonValuePtr loaded_state = member_or_null(&gs, "interiorState");
		ObjectText p;
		p.add("interiorState", *loaded_state);
		p.copy(gs_player, "position");
		p.copy(gs_player, "rotation");
		p.copy(input, "buildings");
		auto placement = c.call("save.interior.loadOf", p.done());
		return make_object({{"written", member_or_null(cs, "interiorState")},
		                    {"writtenPosition", member_or_null(cs_player, "position")},
		                    {"loaded", loaded_state},
		                    {"loadedPosition", deep_copy(need(gs_player, "position"))},
		                    {"placement", placement}});
	}
	throw DriveError("op " + op + " is not one of core's interior-save ops (interior-save-corpus.ts)");
}

JsonValuePtr drive(Caller &c, bool interior, const std::string &op, const JsonValue &input) {
	if (interior) return drive_interior(c, op, input);
	if (op == "run") return drive_run(c, input);
	throw DriveError("op " + op + " is not one of core's runtime-save ops (runtime-save-corpus.ts)");
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

std::string refusal_code(const JsonValue *answer) {
	const JsonValue *r = answer ? answer->find("refusal") : nullptr;
	return r && r->is_object() ? r->get_string("code") : std::string();
}

void refusal_probes(Caller &c, Probes &p) {
	const std::string W = "\"0123456789abcdef01234567\"";
	const std::string fresh = "{\"worldId\":" + W + ",\"version\":3,\"currentState\":{\"extensions\":{}},\"conversations\":[]}";
	// 1. An op this runner does not know fails its case, on either file.
	for (const bool interior : {false, true}) {
		bool refused = false;
		try {
			drive(c, interior, "fly", *insimul::parse_json("{}").root);
		} catch (const DriveError &) {
			refused = true;
		}
		p.check(refused, std::string("an unknown op (fly) was driven on the ") + (interior ? "interior" : "runtime") + " file");
	}
	// 2. Another world's save on a Load is core's wrong_world VALUE, with invalid_format's message, and the
	//    runtime save is unchanged (still the fresh document).
	{
		auto created = c.try_call("save.runtime.create", "{\"fresh\":" + fresh + "}");
		const JsonValue *sid = created ? created->find("session") : nullptr;
		p.check(sid && sid->is_number(), "save.runtime.create opened no session");
		if (sid && sid->is_number()) {
			const std::string id = std::to_string(static_cast<long long>(sid->number_value));
			auto r = c.try_call("save.runtime.apply",
			                    "{\"session\":" + id + ",\"ops\":[{\"op\":\"load\",\"save\":{\"worldId\":\"fedcba9876543210fedcba98\",\"version\":3,\"currentState\":{}},\"options\":{\"worldId\":" + W + "}}]}");
			const JsonValue *res = r ? r->find("results") : nullptr;
			const JsonValue *first = res && res->is_array() && res->size() == 1 ? res->array_items[0].get() : nullptr;
			p.check(refusal_code(first) == "wrong_world" && first->get_string("outcome") == "invalid_format",
			        "another world's save on a Load was not the wrong_world value with the invalid_format outcome");
			p.check(r && r->get_bool("fresh"), "a refused Load changed the runtime save");
			// 3. What core would dereference unread is the [invalid-input] ERROR.
			auto bad = c.try_call("save.runtime.apply", "{\"session\":" + id + ",\"ops\":[{\"op\":\"load\",\"save\":null,\"options\":{\"worldId\":" + W + "}}]}");
			p.check(!bad && c.last_error.find("[invalid-input]") != std::string::npos, "a null save on a Load was not [invalid-input]");
			c.try_call("session.dispose", "{\"session\":" + id + "}");
		}
		auto none = c.try_call("save.runtime.create", "{\"fresh\":null}");
		p.check(!none && c.last_error.find("[invalid-input]") != std::string::npos, "a null fresh document was not [invalid-input]");
		auto lo = c.try_call("save.interior.loadOf", "{\"interiorState\":null,\"position\":{\"x\":0,\"y\":0,\"z\":0},\"buildings\":{}}");
		p.check(!lo && c.last_error.find("[invalid-input]") != std::string::npos, "buildings that are not a list were not [invalid-input]");
	}
	// 4. An unknown row is the method table's error.
	{
		auto r = c.try_call("save.runtime.fly", "{}");
		p.check(!r && c.last_error.find("unknown method") != std::string::npos, "an unknown row was answered");
	}
}

// ── the contract ──────────────────────────────────────────────────────────────

// The list `v` holds exactly `want`, in order.
bool same_list(const JsonValue &v, const std::vector<std::string> &want) {
	if (!v.is_array() || v.size() != want.size()) return false;
	for (std::size_t i = 0; i < want.size(); i++) {
		if (!v.array_items[i]->is_string() || v.array_items[i]->string_value != want[i]) return false;
	}
	return true;
}

// ui.loadRefusal over `code`: { outcome, message }.
JsonValuePtr load_refusal(Caller &c, const std::string &code) {
	std::string arg;
	write_string(arg, code);
	return c.call("ui.loadRefusal", "{\"refusal\":" + arg + "}");
}

int check_contract(Caller &c, bool interior, const JsonValue &contract) {
	int failed = 0;
	const char *row = interior ? "save.interior.contract" : "save.runtime.contract";
	std::set<std::string> stated;
	int agree = 0;
	JsonValuePtr answer;
	try {
		answer = c.call(row, "{}");
	} catch (const DriveError &e) {
		std::printf("  [FAIL] contract: %s\n", e.what());
		return 1;
	}
	for (const auto &kv : answer->object_items) {
		stated.insert(kv.first);
		const JsonValue *want = contract.find(kv.first);
		if (!want) {
			std::printf("  [FAIL] contract: %s states %s, which the corpus's contract does not\n", row, kv.first.c_str());
			failed++;
			continue;
		}
		const std::string diff = compare(*want, *kv.second, 0.0, "contract." + kv.first);
		if (!diff.empty()) {
			std::printf("  [FAIL] %s\n", diff.c_str());
			failed++;
			continue;
		}
		agree++;
	}
	// Every other key, by name.
	const std::set<std::string> &prose = interior ? kInteriorProse : kRuntimeProse;
	int prose_n = 0, held = 0;
	const std::string message = interior ? std::string() : contract.get_string("refusedLoadMessage");
	for (const auto &kv : contract.object_items) {
		const std::string &k = kv.first;
		const JsonValue &v = *kv.second;
		if (stated.count(k)) continue;
		if (prose.count(k)) {
			if (!v.is_string() || v.string_value.empty()) {
				std::printf("  [FAIL] contract: the prose rule %s is not a sentence\n", k.c_str());
				failed++;
			}
			prose_n++;
			continue;
		}
		bool ok = true;
		if (k == "ops") {
			ok = same_list(v, interior ? kInteriorOps : kRuntimeOps);
		} else if (k == "steps" && !interior) {
			ok = same_list(v, kRuntimeSteps);
		} else if (k == "loadRefusalOutcomes" && !interior) {
			ok = v.is_object() && !v.object_items.empty();
			for (const auto &code : v.object_items) {
				auto r = load_refusal(c, code.first);
				if (r->get_string("outcome") != code.second->as_string() || r->get_string("message") != message) {
					std::printf("  [FAIL] contract: ui.loadRefusal answers %s for %s, not %s with refusedLoadMessage\n",
					            json_of(*r).c_str(), code.first.c_str(), json_of(*code.second).c_str());
					ok = false;
				}
			}
		} else if (k == "unstatedRefusalOutcome" && !interior) {
			auto r = load_refusal(c, "a_code_core_does_not_state");
			ok = r->get_string("outcome") == v.as_string() && r->get_string("message") == message;
		} else if (k == "loadRefusalCodes" && interior) {
			ok = v.is_array() && v.size() > 0;
			for (const auto &code : v.array_items) {
				auto r = load_refusal(c, code->as_string());
				if (!code->is_string() || r->get_string("outcome") != "invalid_format") {
					std::printf("  [FAIL] contract: ui.loadRefusal answers %s for %s, not invalid_format\n", json_of(*r).c_str(),
					            json_of(*code).c_str());
					ok = false;
				}
			}
		} else {
			std::printf("  [FAIL] contract: key %s is neither stated by %s, held by this runner, nor a prose rule it names\n", k.c_str(), row);
			failed++;
			continue;
		}
		if (!ok) {
			std::printf("  [FAIL] contract: %s is not what the rows answer (%s)\n", k.c_str(), json_of(v).substr(0, 160).c_str());
			failed++;
			continue;
		}
		held++;
	}
	std::printf("contract: %d key(s) %s states agree with the corpus's, %d held through the rows and this runner's op list, "
	            "%d prose rule(s) named\n",
	            agree, row, held, prose_n);
	return failed;
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
	if (files.size() != 1) {
		std::fprintf(stderr, "usage: insimulcore_runtime_save_corpus [--negative] <conformance/saves/{runtime-save,interior-state}.json>\n");
		return 2;
	}
	const char *tag = negative ? "runtime_save_corpus --negative" : "runtime_save_corpus";
	if (!self_test()) {
		std::fprintf(stderr, "%s: the comparator or the perturbation cannot tell a wrong answer from a right one\n", tag);
		return 2;
	}
	const std::string &file = files[0];
	bool read_ok = false;
	const std::string text = read_file(file, read_ok);
	auto parsed = insimul::parse_json(text);
	if (!read_ok || !parsed.ok || !parsed.root->is_object()) {
		std::fprintf(stderr, "%s: cannot read %s: %s\n", tag, file.c_str(), parsed.error.c_str());
		return 2;
	}
	const JsonValue &doc = *parsed.root;
	const std::string area = doc.get_string("area");
	const bool interior = area == "saves-interior-state";
	const JsonValue *case_list = doc.find("cases");
	const JsonValue *contract = doc.find("contract");
	if ((area != "saves-runtime" && !interior) || !contract || !contract->is_object()) {
		std::fprintf(stderr, "%s: %s is neither the runtime save corpus (area saves-runtime) nor the interior save corpus "
		                     "(area saves-interior-state), with a contract\n",
		             tag, file.c_str());
		return 2;
	}
	if (!case_list || !case_list->is_array() || case_list->size() == 0) {
		std::fprintf(stderr, "%s: %s holds no case\n", tag, file.c_str());
		return 2;
	}
	const JsonValue *tol_v = doc.find("tolerance");
	const double tol = tol_v && tol_v->is_number() ? tol_v->number_value : 0.0;

	insimul_core *core = insimul_core_create();
	if (!core) {
		std::fprintf(stderr, "%s: insimul_core_create() failed\n", tag);
		return 2;
	}
	std::printf("%s: %s (%s)\n", tag, insimul_core_version(), area.c_str());
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
	std::printf("refusals: %d of %d probe(s) refused as core refuses (values: wrong_world on a Load, the runtime save "
	            "unchanged; errors: [invalid-input], an unknown row; an unknown op fails its case)\n",
	            probes.passed, probes.total);

	failed += check_contract(c, interior, *contract);

	std::map<std::string, int> driven;
	std::map<std::string, int> step_kinds;
	std::map<std::string, JsonValuePtr> answers;
	int refused = 0, accepted = 0, total = 0;
	const auto t0 = std::chrono::steady_clock::now();
	for (const auto &cp : case_list->array_items) {
		const JsonValue &cs = *cp;
		const std::string name = cs.get_string("name");
		const std::string op = cs.get_string("op");
		const JsonValue *input = cs.find("input");
		const JsonValue *expected = cs.find("expected");
		total++;
		if (!input || !input->is_object() || !expected) {
			std::printf("  [FAIL] %s — needs an input object and an expected answer\n", name.c_str());
			failed++;
			continue;
		}
		JsonValuePtr actual;
		try {
			actual = drive(c, interior, op, *input);
		} catch (const std::exception &e) {
			std::printf("  [FAIL] %s — not driven: %s\n", name.c_str(), e.what());
			failed++;
			continue;
		}
		answers[name] = actual;
		if (negative) {
			JsonValuePtr bad = deep_copy(*expected);
			sabotage_last(*bad);
			if (compare(*bad, *actual, tol, "$").empty()) {
				std::printf("  [FAIL] %s — a perturbed expectation was accepted\n", name.c_str());
				failed++;
				accepted++;
				continue;
			}
			refused++;
		} else {
			const std::string diff = compare(*expected, *actual, tol, "$");
			if (!diff.empty()) {
				std::printf("  [FAIL] %s — %s\n", name.c_str(), diff.c_str());
				failed++;
				continue;
			}
		}
		driven[op]++;
		if (!interior) {
			for (const auto &stp : need(*input, "steps").array_items) {
				if (stp->is_object() && !stp->object_items.empty()) step_kinds[stp->object_items[0].first]++;
			}
		}
	}

	// The interior file's controls: each answer with one thing changed must be refused.
	int controls_refused = 0, controls_total = 0;
	if (interior) {
		const JsonValue *controls = doc.find("controls");
		if (!controls || !controls->is_array() || controls->size() == 0) {
			std::printf("  [FAIL] the interior save corpus states no controls\n");
			failed++;
		} else {
			for (const auto &ctl : controls->array_items) {
				controls_total++;
				const std::string name = ctl->get_string("name");
				const std::string of = ctl->get_string("case");
				const JsonValue *answer = ctl->find("answer");
				auto it = answers.find(of);
				// core's checkInteriorSaveControl: a control naming no case is refused (nothing answers it).
				if (it == answers.end() || !answer || !compare(*answer, *it->second, tol, "$").empty()) {
					controls_refused++;
					continue;
				}
				std::printf("  [FAIL] control %s — the rows answer case \"%s\" as the control claims (%s)\n", name.c_str(), of.c_str(),
				            ctl->get_string("change").c_str());
				failed++;
			}
		}
	}

	// Every op of core's runner, and for the runtime save every step, is driven by at least one case.
	std::string by_op;
	int undriven = 0;
	for (const std::string &op : interior ? kInteriorOps : kRuntimeOps) {
		const int n = driven.count(op) ? driven[op] : 0;
		by_op += (by_op.empty() ? "" : ", ") + op + " " + std::to_string(n);
		if (n == 0) {
			std::printf("  [FAIL] op %s: no case of it was driven through the rows\n", op.c_str());
			failed++;
			undriven++;
		}
	}
	if (!interior) {
		by_op += " (steps";
		for (const std::string &st : kRuntimeSteps) {
			const int n = step_kinds.count(st) ? step_kinds[st] : 0;
			by_op += " " + st + " " + std::to_string(n);
			if (n == 0) {
				std::printf("  [FAIL] step %s: no case drives it\n", st.c_str());
				failed++;
				undriven++;
			}
		}
		by_op += ")";
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
	int total_driven = 0;
	for (const auto &kv : driven) total_driven += kv.second;
	std::printf("%s: driven %s. %d undriven\n", area.c_str(), by_op.c_str(), undriven);
	if (interior) std::printf("controls: %d of %d refused\n", controls_refused, controls_total);
	if (negative) {
		std::printf("%s: %d of %d perturbed case(s) refused, %d accepted, %d failure(s), %.0f ms\n", tag, refused, total, accepted,
		            failed, ms);
	} else {
		std::printf("%s: %d of %d case(s) driven through the rows, %d failed, %.0f ms\n", tag, total_driven, total, failed, ms);
	}
	if (failed || total_driven == 0 || total_driven != total) {
		std::printf("%s: FAIL\n", tag);
		return 1;
	}
	std::printf("%s: PASS\n", tag);
	return 0;
}
