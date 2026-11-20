// genre_systems_corpus.cpp — core's P9j genre systems corpora, driven through
// libinsimulcore's `genre.*` and `puzzle.*` rows.
//
// PL.native-genre-rows, slice 1: the puzzle (rulings U128, U115, U101(1), U49(3),
// U36). Core's puzzle module (src/puzzle/puzzle.ts: the definition a world gives,
// authored or generated, its facts, the world facts its riddles are answered from, the
// answer key and the choices), its decision layer (src/game-engine/logic/
// PuzzleDirector.ts, over a KB module activation builds: GamePrologEngine with genre
// `puzzle`) and its save block (src/puzzle/puzzle-save.ts) are rows of
// corebridge/js/entry.js. This gate holds them to core's own corpora,
// conformance/puzzle/{definition,run,save}.json, COPIED byte for byte into
// corebridge/vendor/core/conformance/puzzle/ at the pin with the world slice they name
// (conformance/genre-mechanics/thistlecombe.world-slice.json) and sha256-checked by the
// `core_vendor` ctest. Nothing here re-writes a case or computes an answer: every answer
// comes out of the rows; this file only composes them per op, as core's reference runner
// (src/genre-systems/systems-corpus.ts, `runGenreSystemsOp`) composes core's functions,
// and builds the answer in the corpus's shape from what the rows answered.
//
//   puzzle/definition generate genre.world.of (the case's world over the slices), then
//                              puzzle.forWorld (puzzle ?? null; maxAttempts when the
//                              input has the key, null included), puzzle.facts,
//                              puzzle.worldFacts and puzzle.answerKey
//                     authored puzzle.issues, then puzzle.fromIR (maxAttempts as above)
//                              when there are none, else a null definition
//                     choices  genre.world.of, puzzle.forWorld (puzzle ?? null), then
//                              puzzle.choices per riddle (count 4 unless given)
//   puzzle/run        run      puzzle.director.create (the definition, worldFacts ?? []:
//                              the published count), then per step: restore, clue
//                              (findClue), answer, unlock, take, view (null when no
//                              riddle), progress, complete (isComplete), state
//                              (serialize); then serialize; then session.dispose
//   puzzle/save       block    puzzle.save.block, then puzzle.save.blockOf
//                     read     puzzle.save.read, then puzzle.save.blockOf of a value
//                     restore  puzzle.save.read; an unreadable block is the read alone, no
//                              block is a null value; otherwise the read's value through
//                              puzzle.save.blockOf, and the run (as run's, with the READ
//                              value restored first, as core's runner restores it)
//
// The step's actor is `player` unless the step names one. Comparison is the corpora's
// own rule: exact, object key sets included. Each file's declared `ops` (and the run
// and save files' `steps`) must be exactly the ones this runner drives (core's
// GENRE_SYSTEMS_CORPUS_OPS and _STEPS), so an op or step core adds is a failure here,
// never a skip; an unknown op or step fails its case. The refusal probes show on every
// start that an unknown op, an unknown step and a step with no name fail their case, that
// core's refusals are VALUES (a director outcome's `refusal`, a save read's `keys`), and
// that an argument outside core's declared types is the `[invalid-input]` ERROR. The run
// FAILS on a file that is not a genre systems corpus or holds no case, on an op of a file
// that no case drives, on a row missing from the method table or named here and never
// called, on a session left open, and when its comparator or its perturbation cannot fail
// (a self-test on every start).
//
// --negative perturbs EVERY driven case's expectation (its last leaf) and requires
// every one to be refused.
//
// A pure consumer of insimulcore.h (no quickjs.h, no insimul.h). The JSON reader is
// tests/radiant/json_value.{h,cpp}, used as is.
//
// usage: insimulcore_genre_systems_corpus [--negative] --slice <name.world-slice.json>...
//          <conformance/<genre>/<file>.json>...

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
#include <stdexcept>
#include <string>
#include <vector>

using insimul::JsonType;
using insimul::JsonValue;
using insimul::JsonValuePtr;

namespace {

// core's GENRE_SYSTEMS_CORPUS_OPS and GENRE_SYSTEMS_CORPUS_STEPS
// (src/genre-systems/systems-corpus.ts) for the files this slice binds.
struct FileSpec {
	const char *file;
	std::vector<std::string> ops;
	std::vector<std::string> steps; // the file's `steps` (empty: the file declares none)
};
const std::vector<std::string> kPuzzleSteps = {"restore", "clue", "answer", "unlock", "take", "view", "progress", "complete", "state"};
const std::vector<FileSpec> kFiles = {
    {"puzzle/definition", {"generate", "authored", "choices"}, {}},
    {"puzzle/run", {"run"}, kPuzzleSteps},
    {"puzzle/save", {"block", "read", "restore"}, kPuzzleSteps},
};

// Every row this runner calls.
const char *const kRows[] = {
    "genre.world.of",          "puzzle.forWorld",        "puzzle.facts",           "puzzle.worldFacts",
    "puzzle.answerKey",        "puzzle.issues",          "puzzle.fromIR",          "puzzle.choices",
    "puzzle.director.create",  "puzzle.director.findClue", "puzzle.director.answer", "puzzle.director.unlock",
    "puzzle.director.take",    "puzzle.director.view",   "puzzle.director.progress", "puzzle.director.isComplete",
    "puzzle.director.serialize", "puzzle.director.restore", "puzzle.save.read",     "puzzle.save.block",
    "puzzle.save.blockOf",     "session.dispose"};

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

JsonValuePtr deep_copy(const JsonValue &v) {
	auto c = std::make_shared<JsonValue>(v);
	for (auto &item : c->array_items) item = deep_copy(*item);
	for (auto &kv : c->object_items) kv.second = deep_copy(*kv.second);
	return c;
}

JsonValuePtr make_null() { return std::make_shared<JsonValue>(); }

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

JsonValuePtr make_number(double d) {
	auto v = std::make_shared<JsonValue>();
	v->type = JsonType::Number;
	v->number_value = d;
	char buf[64];
	std::snprintf(buf, sizeof buf, "%.17g", d);
	v->raw_number = buf;
	return v;
}

JsonValuePtr make_array(std::vector<JsonValuePtr> items = {}) {
	auto v = std::make_shared<JsonValue>();
	v->type = JsonType::Array;
	v->array_items = std::move(items);
	return v;
}

// An object built in the order given; `put` replaces a key or appends it.
struct Obj {
	JsonValuePtr v;
	Obj() : v(std::make_shared<JsonValue>()) { v->type = JsonType::Object; }
	explicit Obj(const JsonValue &from) : v(deep_copy(from)) {}
	Obj &put(const std::string &k, JsonValuePtr x) {
		for (auto &kv : v->object_items) {
			if (kv.first == k) {
				kv.second = std::move(x);
				return *this;
			}
		}
		v->object_items.emplace_back(k, std::move(x));
		return *this;
	}
	Obj &put(const std::string &k, const JsonValue &x) { return put(k, deep_copy(x)); }
	Obj &put(const std::string &k, const std::string &s) { return put(k, make_string(s)); }
	Obj &put(const std::string &k, const char *s) { return put(k, make_string(s)); }
	Obj &copy(const JsonValue &from, const char *key, const char *as = nullptr) {
		if (const JsonValue *x = from.find(key)) put(as ? as : key, *x);
		return *this;
	}
	std::string text() const { return json_of(*v); }
};

// ── comparing (the corpora's rule: exact, object key sets included) ───────────

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

std::string compare(const JsonValue &expected, const JsonValue &actual, const std::string &path) {
	if (expected.type != actual.type) return path + ": expected a " + kind_of(expected) + ", got a " + kind_of(actual);
	switch (expected.type) {
	case JsonType::Null: return {};
	case JsonType::Bool: return expected.bool_value == actual.bool_value ? std::string() : path + ": boolean differs";
	case JsonType::String:
		return expected.string_value == actual.string_value ? std::string()
		                                                    : path + ": \"" + expected.string_value + "\" != \"" + actual.string_value + "\"";
	case JsonType::Number:
		return expected.number_value == actual.number_value ? std::string() : path + ": " + expected.raw_number + " != " + actual.raw_number;
	case JsonType::Array: {
		if (expected.array_items.size() != actual.array_items.size()) {
			return path + ": length " + std::to_string(expected.array_items.size()) + " != " + std::to_string(actual.array_items.size());
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

// ── the negative pass's perturbation ──────────────────────────────────────────

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
	    {"{\"a\":0.3}", "{\"a\":0.30000000000000004}", false},
	    {"{\"ok\":false,\"refusal\":\"unknown_riddle\"}", "{\"ok\":false,\"refusal\":\"clue_missing\"}", false},
	    {"{\"a\":1}", "{\"a\":1,\"b\":null}", false},
	    {"{\"a\":1,\"b\":null}", "{\"a\":1}", false},
	    {"[1,2]", "[2,1]", false},
	    {"[{}]", "[]", false},
	    {"false", "0", false},
	    {"null", "{}", false},
	    {"\"pain\"", "\"Pain\"", false},
	};
	bool ok = true;
	for (const Probe &p : probes) {
		auto e = parse(p.expected);
		auto a = parse(p.actual);
		const bool agree = e && a && compare(*e, *a, "$").empty();
		if (agree != p.agree) {
			std::printf("  [FAIL] self-test: %s vs %s should %s\n", p.expected, p.actual, p.agree ? "agree" : "differ");
			ok = false;
		}
	}
	const char *sources[] = {"[{}]", "[]", "{\"view\":null,\"unmet\":[]}", "[{\"step\":\"view\",\"view\":null}]", "{\"ok\":false,\"keys\":[]}"};
	for (const char *s : sources) {
		auto src = parse(s);
		auto bad = deep_copy(*src);
		sabotage_last(*bad);
		if (compare(*src, *bad, "$").empty() || json_of(*src) != json_of(*parse(s))) {
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
	std::map<std::string, int> calls;

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

	JsonValuePtr call(const char *method, const Obj &args) {
		auto r = try_call(method, args.text());
		if (!r) throw DriveError(std::string(method) + " failed: " + last_error);
		calls[method]++;
		return r;
	}
};

const JsonValue &need(const JsonValue &v, const char *key, const char *what) {
	const JsonValue *x = v.find(key);
	if (!x) throw DriveError(std::string(what) + " has no " + key);
	return *x;
}

JsonValuePtr member(const JsonValuePtr &answer, const char *key, const char *method) {
	const JsonValue *x = answer->find(key);
	if (!x) throw DriveError(std::string(method) + " answered no " + key);
	return deep_copy(*x);
}

bool ok_of(const JsonValuePtr &answer, const char *method) {
	const JsonValue *ok = answer->find("ok");
	if (!ok || ok->type != JsonType::Bool) throw DriveError(std::string(method) + " answered no boolean ok");
	return ok->bool_value;
}

const std::vector<JsonValuePtr> &items(const JsonValue &v, const char *what) {
	if (!v.is_array()) throw DriveError(std::string(what) + " is not a list");
	return v.array_items;
}

// The `key` member of each object of a list (`list.map((x) => x[key])`).
JsonValuePtr pluck(const JsonValue &list, const char *key, const char *what) {
	std::vector<JsonValuePtr> out;
	for (const auto &x : items(list, what)) out.push_back(deep_copy(need(*x, key, what)));
	return make_array(out);
}


// ── the runner's own reading of a case (core's `list`/`str` guards) ────────────

const JsonValue *opt(const JsonValue &v, const char *key) { return v.find(key); }

std::string str_of(const JsonValue &v, const char *key) {
	const JsonValue *x = v.find(key);
	if (!x || !x->is_string()) throw DriveError(std::string("genre corpus: ") + key + " must be a string");
	return x->string_value;
}

const std::vector<JsonValuePtr> &list_or_empty(const JsonValue &v, const char *key, std::vector<JsonValuePtr> &empty) {
	const JsonValue *x = v.find(key);
	if (!x || x->is_null()) return empty;
	if (!x->is_array()) throw DriveError(std::string("genre corpus: ") + key + " must be a list");
	return x->array_items;
}

struct Run {
	Caller &c;
	std::map<std::string, int> &steps_driven;
	const FileSpec &spec;
	const JsonValuePtr &slices;

	// core's `worldOf(input.world, slices)`, through the row.
	JsonValuePtr world_of(const JsonValue &input) {
		Obj a;
		a.put("world", need(input, "world", "the input")).put("slices", slices);
		return member(c.call("genre.world.of", a), "world", "genre.world.of");
	}

	void step_known(const std::string &s) {
		for (const auto &k : spec.steps) {
			if (k == s) {
				steps_driven[s]++;
				return;
			}
		}
		throw DriveError("genre corpus: unknown puzzle step " + s);
	}
};

// `maxAttempts` when the input has the key (null included): core's `input.maxAttempts === undefined ? {} : {...}`.
void put_max_attempts(Obj &a, const JsonValue &input) {
	if (const JsonValue *m = input.find("maxAttempts")) a.put("maxAttempts", *m);
}

// `input.puzzle ?? null`.
JsonValuePtr puzzle_or_null(const JsonValue &input) {
	const JsonValue *p = input.find("puzzle");
	return p ? deep_copy(*p) : make_null();
}

JsonValuePtr puzzle_definition(Run &r, const std::string &op, const JsonValue &input) {
	Caller &c = r.c;
	if (op == "generate") {
		JsonValuePtr world = r.world_of(input);
		Obj a;
		a.put("world", world).put("puzzle", puzzle_or_null(input));
		put_max_attempts(a, input);
		JsonValuePtr def = member(c.call("puzzle.forWorld", a), "definition", "puzzle.forWorld");
		return Obj()
		    .put("definition", def)
		    .put("facts", member(c.call("puzzle.facts", Obj().put("definition", def)), "facts", "puzzle.facts"))
		    .put("worldFacts", member(c.call("puzzle.worldFacts", Obj().put("world", world).put("definition", def)), "facts", "puzzle.worldFacts"))
		    .put("answerKey", member(c.call("puzzle.answerKey", Obj().put("world", world).put("definition", def)), "answerKey", "puzzle.answerKey"))
		    .v;
	}
	if (op == "authored") {
		Obj a;
		if (const JsonValue *p = input.find("puzzle")) a.put("puzzle", *p);
		JsonValuePtr issues = member(c.call("puzzle.issues", a), "issues", "puzzle.issues");
		JsonValuePtr def = make_null();
		if (items(*issues, "issues").empty()) {
			Obj f;
			if (const JsonValue *p = input.find("puzzle")) f.put("puzzle", *p);
			put_max_attempts(f, input);
			def = member(c.call("puzzle.fromIR", f), "definition", "puzzle.fromIR");
		}
		return Obj().put("issues", issues).put("definition", def).v;
	}
	if (op == "choices") {
		JsonValuePtr world = r.world_of(input);
		JsonValuePtr def = member(c.call("puzzle.forWorld", Obj().put("world", world).put("puzzle", puzzle_or_null(input))), "definition", "puzzle.forWorld");
		const JsonValue *count = input.find("count");
		Obj out;
		for (const auto &riddle : items(need(*def, "riddles", "the definition"), "riddles")) {
			Obj a;
			a.put("world", world).put("riddle", *riddle).put("count", count ? deep_copy(*count) : make_number(4));
			out.put(str_of(*riddle, "id"), member(c.call("puzzle.choices", a), "choices", "puzzle.choices"));
		}
		return out.v;
	}
	throw DriveError("genre corpus: unknown op " + op + " for puzzle/definition");
}

// `{ step, ...outcome }`: the step's name, then every member of the row's answer.
JsonValuePtr stepped(const char *step, const JsonValuePtr &outcome) {
	Obj o;
	o.put("step", step);
	for (const auto &kv : outcome->object_items) o.put(kv.first, *kv.second);
	return o.v;
}

// core's `puzzleRun(input, steps, restoreFrom?)`: a fresh director over the case's
// definition and world facts, published, then the steps; the session always disposed.
JsonValuePtr puzzle_run(Run &r, const JsonValue &input, const JsonValuePtr &restore_from) {
	Caller &c = r.c;
	std::vector<JsonValuePtr> none;
	Obj create;
	create.put("definition", need(input, "definition", "the input")).put("worldFacts", make_array(list_or_empty(input, "worldFacts", none)));
	auto created = c.call("puzzle.director.create", create);
	JsonValuePtr session = member(created, "session", "puzzle.director.create");
	struct Dispose {
		Caller &c;
		JsonValuePtr session;
		~Dispose() { c.try_call("session.dispose", Obj().put("session", session).text()), c.calls["session.dispose"]++; }
	} dispose{c, session};
	auto with = [&](const char *key, const std::string &value) { return Obj().put("session", session).put(key, value); };
	std::vector<JsonValuePtr> results;
	if (restore_from) {
		results.push_back(stepped("restore", c.call("puzzle.director.restore", Obj().put("session", session).put("state", restore_from))));
	}
	for (const auto &raw : list_or_empty(input, "steps", none)) {
		const JsonValue &s = *raw;
		const JsonValue *name = s.find("step");
		if (!s.is_object() || !name || !name->is_string()) throw DriveError("genre corpus: puzzle step has no step");
		const std::string step = name->string_value;
		r.step_known(step);
		const JsonValue *actor_v = s.find("actor");
		const std::string actor = actor_v ? str_of(s, "actor") : "player";
		if (step == "restore") {
			results.push_back(stepped("restore", c.call("puzzle.director.restore", Obj().put("session", session).put("state", need(s, "state", "a restore step")))));
		} else if (step == "clue") {
			results.push_back(stepped("clue", c.call("puzzle.director.findClue", with("actor", actor).put("text", str_of(s, "text")))));
		} else if (step == "answer") {
			results.push_back(stepped("answer", c.call("puzzle.director.answer", with("actor", actor).put("riddle", str_of(s, "riddle")).put("given", str_of(s, "given")))));
		} else if (step == "unlock") {
			results.push_back(stepped("unlock", c.call("puzzle.director.unlock", with("actor", actor).put("lock", str_of(s, "lock")))));
		} else if (step == "take") {
			results.push_back(stepped("take", c.call("puzzle.director.take", with("actor", actor).put("item", str_of(s, "item")))));
		} else if (step == "view") {
			auto v = c.call("puzzle.director.view", with("actor", actor).put("riddle", str_of(s, "riddle")));
			results.push_back(Obj().put("step", "view").put("view", member(v, "view", "puzzle.director.view")).v);
		} else if (step == "progress") {
			auto v = c.call("puzzle.director.progress", Obj().put("session", session).put("actor", actor));
			results.push_back(Obj().put("step", "progress").put("progress", member(v, "progress", "puzzle.director.progress")).v);
		} else if (step == "complete") {
			auto v = c.call("puzzle.director.isComplete", Obj().put("session", session).put("actor", actor));
			results.push_back(Obj().put("step", "complete").put("complete", member(v, "complete", "puzzle.director.isComplete")).v);
		} else if (step == "state") {
			auto v = c.call("puzzle.director.serialize", Obj().put("session", session));
			results.push_back(Obj().put("step", "state").put("state", member(v, "state", "puzzle.director.serialize")).v);
		} else {
			throw DriveError("genre corpus: puzzle step " + step + " has no drive");
		}
	}
	auto st = c.call("puzzle.director.serialize", Obj().put("session", session));
	return Obj().put("published", member(created, "published", "puzzle.director.create")).put("steps", make_array(results)).put("state", member(st, "state", "puzzle.director.serialize")).v;
}

JsonValuePtr block_of(Caller &c, const JsonValuePtr &block) {
	return member(c.call("puzzle.save.blockOf", Obj().put("block", block)), "block", "puzzle.save.blockOf");
}

JsonValuePtr puzzle_save(Run &r, const std::string &op, const JsonValue &input) {
	Caller &c = r.c;
	if (op == "block") {
		Obj a;
		if (const JsonValue *s = input.find("state")) a.put("state", *s);
		JsonValuePtr block = member(c.call("puzzle.save.block", a), "block", "puzzle.save.block");
		if (block->is_null()) throw DriveError("genre corpus: puzzleSaveBlock gave no block to write");
		return block_of(c, block);
	}
	if (op != "read" && op != "restore") throw DriveError("genre corpus: unknown op " + op + " for puzzle/save");
	Obj a;
	if (const JsonValue *b = input.find("block")) a.put("block", *b);
	JsonValuePtr read = c.call("puzzle.save.read", a);
	const bool ok = ok_of(read, "puzzle.save.read");
	JsonValuePtr value = ok ? member(read, "value", "puzzle.save.read") : nullptr;
	if (op == "read") {
		if (!ok) return read;
		return Obj().put("ok", make_bool(true)).put("value", value->is_null() ? make_null() : block_of(c, value)).v;
	}
	if (!ok) return Obj().put("read", read).v;
	if (value->is_null()) return Obj().put("read", Obj().put("ok", make_bool(true)).put("value", make_null()).v).v;
	JsonValuePtr shown = Obj().put("ok", make_bool(true)).put("value", block_of(c, value)).v;
	return Obj().put("read", shown).put("run", puzzle_run(r, input, value)).v;
}

JsonValuePtr drive(Run &r, const std::string &op, const JsonValue &input) {
	bool known = false;
	for (const auto &o : r.spec.ops) known = known || o == op;
	if (!known) throw DriveError("genre corpus: unknown op " + op + " for " + r.spec.file);
	const std::string file = r.spec.file;
	if (file == "puzzle/definition") return puzzle_definition(r, op, input);
	if (file == "puzzle/run") return puzzle_run(r, input, nullptr);
	if (file == "puzzle/save") return puzzle_save(r, op, input);
	throw DriveError("genre corpus: unknown file " + file);
}

// ── refusal probes (every start) ──────────────────────────────────────────────

struct Probes {
	int passed = 0, total = 0;
};

void probe(Probes &p, bool ok, const std::string &what) {
	p.total++;
	if (ok) p.passed++;
	else std::printf("  [FAIL] refusal probe: %s\n", what.c_str());
}

bool fails_as(Caller &c, const char *method, const std::string &args, const char *text) {
	if (c.try_call(method, args)) return false;
	return c.last_error.find(text) != std::string::npos;
}

void refusal_probes(Caller &c, const JsonValuePtr &slices, std::map<std::string, int> &sink, Probes &p) {
	// An unknown op, an unknown step and a nameless step fail their case: an error, never a skip.
	auto fails_drive = [&](const FileSpec &spec, const std::string &op, const char *input_text) {
		auto input = insimul::parse_json(input_text).root;
		try {
			Run r{c, sink, spec, slices};
			drive(r, op, *input);
		} catch (const DriveError &) {
			return true;
		}
		return false;
	};
	const char *def = "{\"riddles\":[],\"locks\":[],\"finalLock\":null,\"maxAttempts\":3,\"clueTexts\":[],\"source\":\"empty\",\"notes\":[]}";
	probe(p, fails_drive(kFiles[0], "nope", "{}"), "an unknown definition op is driven");
	probe(p, fails_drive(kFiles[2], "nope", "{}"), "an unknown save op is driven");
	probe(p, fails_drive(kFiles[1], "run", (std::string("{\"definition\":") + def + ",\"steps\":[{\"step\":\"nope\"}]}").c_str()), "an unknown run step is driven");
	probe(p, fails_drive(kFiles[1], "run", (std::string("{\"definition\":") + def + ",\"steps\":[{\"riddle\":\"r\"}]}").c_str()), "a run step with no name is driven");
	// core's refusals are values: an unknown riddle, lock and clue; an unreadable block's keys.
	{
		auto s = c.try_call("puzzle.director.create", std::string("{\"definition\":") + def + "}");
		const JsonValue *h = s ? s->find("session") : nullptr;
		if (h) {
			const std::string sess = json_of(*h);
			auto a = c.try_call("puzzle.director.answer", "{\"session\":" + sess + ",\"actor\":\"player\",\"riddle\":\"r\",\"given\":\"x\"}");
			probe(p, a && a->get_string("refusal") == "unknown_riddle", "an unknown riddle is not the value refusal unknown_riddle");
			auto u = c.try_call("puzzle.director.unlock", "{\"session\":" + sess + ",\"actor\":\"player\",\"lock\":\"l\"}");
			probe(p, u && u->get_string("refusal") == "unknown_lock", "an unknown lock is not the value refusal unknown_lock");
			auto k = c.try_call("puzzle.director.findClue", "{\"session\":" + sess + ",\"actor\":\"player\",\"text\":\"t\"}");
			probe(p, k && k->get_string("refusal") == "unknown_clue", "an unknown clue is not the value refusal unknown_clue");
			c.try_call("session.dispose", "{\"session\":" + sess + "}");
		} else {
			probe(p, false, "puzzle.director.create refused an empty definition: " + c.last_error);
		}
	}
	{
		auto rd = c.try_call("puzzle.save.read", "{\"block\":{\"actors\":\"player\"}}");
		probe(p, rd && !rd->get_bool("ok", true) && rd->find("keys") && json_of(*rd->find("keys")) == "[\"actors\"]", "an unreadable block is not the value { ok: false, keys: [actors] }");
	}
	// An argument outside core's declared types is the [invalid-input] error.
	probe(p, fails_as(c, "puzzle.forWorld", "{\"world\":5}", "[invalid-input]"), "a world that is not an object is not [invalid-input]");
	probe(p, fails_as(c, "genre.world.of", "{\"world\":\"constructor\",\"slices\":{}}", "[invalid-input]"), "a slice name that is no own key is not [invalid-input]");
	probe(p, fails_as(c, "puzzle.director.create", "{\"definition\":{\"riddles\":[]}}", "[invalid-input]"), "a definition missing its members is not [invalid-input]");
	probe(p, fails_as(c, "puzzle.save.blockOf", "{\"block\":{\"actors\":[{\"actor\":\"p\"}]}}", "[invalid-input]"), "a state row missing its lists is not [invalid-input]");
	probe(p, fails_as(c, "puzzle.no.such.row", "{}", "unknown method"), "an unknown row is not the method table's error");
}

} // namespace

int main(int argc, char **argv) {
	bool negative = false;
	std::vector<std::string> paths, slice_paths;
	for (int i = 1; i < argc; i++) {
		const std::string a = argv[i];
		if (a == "--negative") negative = true;
		else if (a == "--slice" && i + 1 < argc) slice_paths.push_back(argv[++i]);
		else paths.push_back(a);
	}
	if (paths.empty() || slice_paths.empty()) {
		std::fprintf(stderr, "usage: insimulcore_genre_systems_corpus [--negative] --slice <name.world-slice.json>... <conformance/<genre>/<file>.json>...\n");
		return 2;
	}
	const char *tag = negative ? "genre_systems_corpus --negative" : "genre_systems_corpus";
	if (!self_test()) {
		std::fprintf(stderr, "%s: the comparator or the perturbation cannot tell a wrong answer from a right one\n", tag);
		return 2;
	}
	// The committed world slices by name (`<name>.world-slice.json` → `world`), as core's runner is given them.
	Obj slices;
	for (const std::string &sp : slice_paths) {
		bool ok = false;
		const std::string text = read_file(sp, ok);
		auto parsed = insimul::parse_json(text);
		const std::string base = sp.substr(sp.find_last_of('/') + 1);
		const std::string suffix = ".world-slice.json";
		const JsonValue *w = parsed.ok && parsed.root->is_object() ? parsed.root->find("world") : nullptr;
		if (!ok || !w || !w->is_object() || base.size() <= suffix.size() || base.compare(base.size() - suffix.size(), suffix.size(), suffix) != 0) {
			std::fprintf(stderr, "%s: %s is not a <name>.world-slice.json with a world\n", tag, sp.c_str());
			return 2;
		}
		slices.put(base.substr(0, base.size() - suffix.size()), *w);
	}
	insimul_core *core = insimul_core_create();
	if (!core) {
		std::fprintf(stderr, "%s: insimul_core_create() failed\n", tag);
		return 2;
	}
	std::printf("%s: %s\n", tag, insimul_core_version());
	Caller c{core, {}, {}};
	int failed = 0;

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

	std::map<std::string, int> probe_steps;
	Probes probes;
	refusal_probes(c, slices.v, probe_steps, probes);
	if (probes.passed != probes.total) failed++;
	std::printf("refusals: %d of %d probe(s) as core answers (an unknown op, an unknown step and a nameless step fail their case; "
	            "values: unknown_riddle, unknown_lock, unknown_clue, an unreadable block's keys; errors: [invalid-input] for a "
	            "world that is not an object, a slice name that is no own key, a definition and a state row missing members; an "
	            "unknown row)\n",
	            probes.passed, probes.total);

	int total_cases = 0, total_driven = 0, refused = 0, accepted = 0;
	std::set<std::string> seen_files;
	const auto t0 = std::chrono::steady_clock::now();
	for (const std::string &path : paths) {
		bool read_ok = false;
		const std::string text = read_file(path, read_ok);
		auto parsed = insimul::parse_json(text);
		if (!read_ok || !parsed.ok || !parsed.root->is_object()) {
			std::printf("  [FAIL] cannot read %s\n", path.c_str());
			failed++;
			continue;
		}
		const JsonValue &doc = *parsed.root;
		const std::string file = doc.get_string("file");
		const FileSpec *spec = nullptr;
		for (const auto &s : kFiles) {
			if (file == s.file) spec = &s;
		}
		const JsonValue *case_list = doc.find("cases");
		if (doc.get_string("schema") != "insimul.conformance.genre-systems/1" || !spec || !case_list || !case_list->is_array() || case_list->size() == 0) {
			std::printf("  [FAIL] %s is not a genre systems corpus this runner drives, or holds no case\n", path.c_str());
			failed++;
			continue;
		}
		seen_files.insert(file);
		{
			std::vector<std::string> ops, steps;
			if (const JsonValue *o = doc.find("ops")) {
				for (const auto &x : o->array_items) ops.push_back(x->as_string());
			}
			if (const JsonValue *s = doc.find("steps")) {
				for (const auto &x : s->array_items) steps.push_back(x->as_string());
			}
			if (ops != spec->ops || steps != spec->steps) {
				std::printf("  [FAIL] %s: its ops or steps are not the ones this runner drives (core's GENRE_SYSTEMS_CORPUS_OPS/_STEPS)\n", file.c_str());
				failed++;
			}
		}
		std::map<std::string, int> driven;
		std::map<std::string, int> steps_driven;
		int file_failed = 0;
		for (const auto &cp : case_list->array_items) {
			const JsonValue &cs = *cp;
			const std::string name = cs.get_string("name");
			const std::string op = cs.get_string("op");
			const JsonValue *input = cs.find("input");
			const JsonValue *expected = cs.find("expected");
			total_cases++;
			if (!input || !input->is_object() || !expected) {
				std::printf("  [FAIL] %s — needs an input object and an expected answer\n", name.c_str());
				file_failed++;
				continue;
			}
			JsonValuePtr actual;
			try {
				Run r{c, steps_driven, *spec, slices.v};
				actual = drive(r, op, *input);
			} catch (const std::exception &e) {
				std::printf("  [FAIL] %s — not driven: %s\n", name.c_str(), e.what());
				file_failed++;
				continue;
			}
			if (negative) {
				JsonValuePtr bad = deep_copy(*expected);
				sabotage_last(*bad);
				if (compare(*bad, *actual, "$").empty()) {
					std::printf("  [FAIL] %s — a perturbed expectation was accepted\n", name.c_str());
					file_failed++;
					accepted++;
					continue;
				}
				refused++;
			} else {
				const std::string diff = compare(*expected, *actual, "$");
				if (!diff.empty()) {
					std::printf("  [FAIL] %s — %s\n", name.c_str(), diff.c_str());
					file_failed++;
					continue;
				}
			}
			driven[op]++;
			total_driven++;
		}
		std::string by_op, by_step;
		int undriven = 0;
		for (const auto &op : spec->ops) {
			const int n = driven.count(op) ? driven[op] : 0;
			by_op += (by_op.empty() ? "" : ", ") + op + " " + std::to_string(n);
			if (n == 0) {
				std::printf("  [FAIL] %s op %s: no case of it was driven through the rows\n", file.c_str(), op.c_str());
				file_failed++;
				undriven++;
			}
		}
		// Every step the run file declares is driven by one of its cases (the save file's
		// restore runs drive a subset; the run file is where each step is held).
		if (file == "puzzle/run") {
			for (const auto &s : spec->steps) {
				const int n = steps_driven.count(s) ? steps_driven[s] : 0;
				by_step += (by_step.empty() ? "" : ", ") + s + " " + std::to_string(n);
				if (n == 0) {
					std::printf("  [FAIL] %s step %s: no case drove it\n", file.c_str(), s.c_str());
					file_failed++;
				}
			}
		}
		failed += file_failed;
		std::printf("%s: %d case(s), driven %s. %d undriven%s%s\n", file.c_str(), static_cast<int>(case_list->size()), by_op.c_str(), undriven,
		            by_step.empty() ? "" : "; steps ", by_step.c_str());
	}
	for (const auto &s : kFiles) {
		if (!seen_files.count(s.file)) {
			std::printf("  [FAIL] %s: not given, so its cases ran nowhere\n", s.file);
			failed++;
		}
	}
	{
		auto l = c.try_call("session.list", "{}");
		const JsonValue *open = l ? l->find("sessions") : nullptr;
		if (!open || !open->is_array() || open->size() != 0) {
			std::printf("  [FAIL] sessions left open: %s\n", open ? json_of(*open).c_str() : "(session.list failed)");
			failed++;
		}
	}
	std::string rows_unused;
	int rows_called = 0;
	for (const char *row : kRows) {
		if (c.calls.count(row)) rows_called++;
		else rows_unused += (rows_unused.empty() ? "" : ", ") + std::string(row);
	}
	insimul_core_destroy(core);
	if (!rows_unused.empty()) {
		std::printf("  [FAIL] rows this runner names that no case called: %s\n", rows_unused.c_str());
		failed++;
	}
	const double ms = std::chrono::duration<double, std::milli>(std::chrono::steady_clock::now() - t0).count();
	std::printf("rows: %d of %d called by the corpora's cases\n", rows_called, static_cast<int>(sizeof kRows / sizeof kRows[0]));
	if (negative) {
		std::printf("%s: %d of %d perturbed case(s) refused, %d accepted, %d failure(s), %.0f ms\n", tag, refused, total_cases, accepted, failed, ms);
	} else {
		std::printf("%s: %d of %d case(s) driven through the rows, %d failed, %.0f ms\n", tag, total_driven, total_cases, failed, ms);
	}
	if (failed || total_driven == 0 || total_driven != total_cases) {
		std::printf("%s: FAIL\n", tag);
		return 1;
	}
	std::printf("%s: PASS\n", tag);
	return 0;
}
