// quests_lifecycle_corpus.cpp — core's quest lifecycle corpus, driven through libinsimulcore's
// `quest.lifecycle.*` rows.
//
// PL.native-quest-lifecycle-rows (rulings U143(2), U128, U101(1), U36). Core's quest lifecycle host contract
// (src/quests/quest-lifecycle.ts, P3.core: offer -> accept -> events -> complete -> reward, as fact deltas, over the
// reported events talk_to, reach, pick_up, deliver, read, find_clue, find_text, read_sign, use_word, pronounce,
// identify, answer_listening and use_grammar) is rows of corebridge/js/entry.js. This gate holds them to core's own
// corpus, conformance/quests/lifecycle.json, COPIED byte for byte into
// corebridge/vendor/core/conformance/quests/ at the pin (the quest lifecycle set) and sha256-checked by the
// `core_vendor` ctest. Nothing here re-writes a case or computes an answer: every answer comes out of the rows.
//
// Each case is answered as core's reference runner (src/quests/quest-corpus.ts, `runQuestOp`, op `session`) answers
// it, through the rows, in the file's case order:
//
//   session -> quest.lifecycle.create with the case's input but its steps: a refused set is core's answer as it
//              stands ({ ok: false, refusal }); an accepted one's state and facts are the answer's `initial`;
//              then ONE quest.lifecycle.apply per step ({ session, ops: [step] }, the step exactly as the file gives
//              it): the op's result and the state after it are the answer's `steps[i]`
//
// Comparison is the corpus's own rule (core's `compareHudValue`, which `checkQuestCase` uses): numbers within the
// file's `tolerance`, everything else exactly, object key sets included. The run also counts the cases whose answer is
// identical to the corpus's to the last bit. The file's `contract` block is held WHOLE: every key is a value
// `quest.lifecycle.contract` states (compared exactly, key sets both ways), the rule this run measures (`deltaRule`:
// after every accepted session, `quest.lifecycle.facts` is the initial fact set with each step's retractions removed
// and assertions added), or a rule the file's cases pin, named here; a contract key this runner does not know fails
// the run, as does a missing one. The stated tables are also held to what the rows ANSWERED over the file's cases:
// every refusal code, fact predicate, status and step op the contract states is answered, seen or driven, and nothing
// else is. After every accepted session `quest.lifecycle.quests` must agree with the state (each quest's status and
// completedAtMs).
//
// An op this runner does not know fails its case (never a skip); the refusal probes prove it on every start, and
// prove that what core refuses (a malformed set, a step it will not take) comes back as core's VALUE, while the
// members of a quest core reads unchecked are the rows' [invalid-input] ERROR, unless core refuses that same set
// itself. The run FAILS on a file that is not the lifecycle corpus or holds no case, on a row missing from the method
// table, on a contract key that differs, on a session left open, and when its comparator, its perturbation or its
// contract check cannot fail (self-tests on every start).
//
// --negative perturbs EVERY driven case's expectation (its last leaf) and requires every one to be refused.
//
// A pure consumer of insimulcore.h (no quickjs.h, no insimul.h). The JSON reader is tests/radiant/json_value.{h,cpp},
// used as is.
//
// usage: insimulcore_quests_lifecycle_corpus [--negative] <conformance/quests/lifecycle.json>...

#include "insimulcore.h"
#include "radiant/json_value.h"

#include <algorithm>
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

struct Area {
	const char *area;
	const char *contract_row;
	std::vector<std::string> ops;        // core's QUEST_CORPUS_OPS for the area
	std::vector<std::string> row_keys;   // the contract keys the contract row states
	std::vector<std::string> measured;   // the contract keys this run measures
	std::vector<std::string> by_cases;   // the contract keys the file's cases pin (rules in words, orders)
};

const Area kLifecycle = {
    "quests-lifecycle",
    "quest.lifecycle.contract",
    {"session"},
    {"statuses", "ops", "hostEventDispatch", "refusalCodes", "defaultPlayer", "predicates", "criteriaTypes"},
    {"deltaRule"},
    {"sessionRefusalOrder", "stepRefusalOrder", "facts", "factOrder", "eventRule", "pickUpRule", "collectRule", "readRule",
     "clueRule", "findTextRule", "signRule", "languageRule", "talkRule", "typeRule", "grammarRule", "completionRule",
     "criteriaRule", "acceptRule", "timeRule", "experienceRule"},
};

// Every row this runner calls.
const char *const kRows[] = {
    "quest.lifecycle.contract", "quest.lifecycle.create", "quest.lifecycle.apply",
    "quest.lifecycle.facts",    "quest.lifecycle.quests",
};

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
	const Area &a = kLifecycle;
	const std::string sound =
	    "\"statuses\":[\"active\"],\"ops\":[\"talk_to\"],\"hostEventDispatch\":{\"talk_to\":[\"npc_talked\"]},\"refusalCodes\":[\"bad_time\"],"
	    "\"defaultPlayer\":\"player\",\"predicates\":[\"quest_status\"],\"criteriaTypes\":[\"all_objectives\"]";
	std::string contract = "{" + sound;
	for (const std::vector<std::string> *list : {&a.measured, &a.by_cases}) {
		for (const std::string &k : *list) contract += ",\"" + k + "\":\"x\"";
	}
	const std::string doc = contract + "}";
	struct Probe {
		std::string contract, row;
		bool sound;
	} probes[] = {
	    {doc, "{" + sound + "}", true},
	    {doc, "{" + std::string(sound).replace(sound.find("\"player\""), 8, "\"hero\"") + "}", false},
	    {doc, "{" + std::string(sound).replace(sound.find("[\"npc_talked\"]"), 14, "[\"npc_talked\",\"npc_conversation\"]") + "}", false},
	    {doc, "{" + sound.substr(0, sound.find(",\"criteriaTypes\"")) + "}", false},
	    {doc, "{" + sound + ",\"extra\":1}", false},
	    {contract + ",\"newRule\":\"y\"}", "{" + sound + "}", false},
	    {"{" + sound + "}", "{" + sound + "}", false},
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

// What the run saw the rows answer over the file's cases, and what it checked after each accepted session.
struct Seen {
	std::set<std::string> codes, predicates, statuses, ops;
	int delta_sessions = 0, quests_sessions = 0;
	std::vector<std::string> problems;
};

const JsonValue *member(const JsonValue &v, const char *key, const std::string &what) {
	const JsonValue *m = v.find(key);
	if (!m) throw DriveError(what + " has no " + key);
	return m;
}

std::string fact_key(const JsonValue &f) {
	const JsonValue *p = f.find("predicate");
	const JsonValue *a = f.find("args");
	if (!p || !p->is_string() || !a || !a->is_array()) throw DriveError("a fact that is not { predicate, args }: " + json_of(f));
	return json_of(*p) + json_of(*a);
}

void note_facts(Seen &seen, const JsonValue &facts) {
	for (const auto &f : facts.array_items) {
		if (const JsonValue *p = f->find("predicate")) seen.predicates.insert(p->as_string());
	}
}

void note_state(Seen &seen, const JsonValue &state) {
	for (const auto &kv : state.object_items) {
		if (const JsonValue *s = kv.second->find("status")) seen.statuses.insert(s->as_string());
	}
}

// The step's result, noted: a refusal's code, the predicates its deltas name.
void note_result(Seen &seen, const JsonValue &step, const JsonValue &result) {
	const JsonValue *refusal = result.find("refusal");
	const std::string code = refusal ? refusal->get_string("code") : std::string();
	if (!code.empty()) seen.codes.insert(code);
	if (code != "unknown_op" && step.find("op") && step.find("op")->is_string()) seen.ops.insert(step.get_string("op"));
	if (const JsonValue *deltas = result.find("deltas")) note_facts(seen, *deltas);
}

// deltaRule, measured: the initial facts, each accepted step's retractions removed and assertions added, are the facts
// row's answer (as a set; the order is the cases' factOrder). And the quests row agrees with the state.
void check_after(Caller &c, Seen &seen, long long sid, const std::string &name, const JsonValue &initial_facts,
                 const std::vector<JsonValuePtr> &results, const JsonValue &state) {
	std::vector<std::string> facts;
	for (const auto &f : initial_facts.array_items) facts.push_back(fact_key(*f));
	bool held = true;
	for (const auto &r : results) {
		const JsonValue *deltas = r->find("deltas");
		if (!deltas) continue;
		for (const auto &d : deltas->array_items) {
			const std::string key = fact_key(*d);
			auto it = std::find(facts.begin(), facts.end(), key);
			const std::string op = d->get_string("op");
			if (op == "retract" && it != facts.end()) facts.erase(it);
			else if (op == "assert" && it == facts.end()) facts.push_back(key);
			else {
				seen.problems.push_back(name + ": a delta " + op + " of " + key + (op == "retract" ? " not in" : " already in") + " the fact set");
				held = false;
			}
		}
	}
	auto now = c.call("quest.lifecycle.facts", "{\"session\":" + std::to_string(sid) + "}");
	const JsonValue *list = member(*now, "facts", "quest.lifecycle.facts");
	std::vector<std::string> row;
	for (const auto &f : list->array_items) row.push_back(fact_key(*f));
	std::sort(facts.begin(), facts.end());
	std::sort(row.begin(), row.end());
	if (facts != row) {
		seen.problems.push_back(name + ": quest.lifecycle.facts is not the initial facts with the steps' deltas applied");
		held = false;
	}
	if (held) seen.delta_sessions++;

	auto q = c.call("quest.lifecycle.quests", "{\"session\":" + std::to_string(sid) + "}");
	const JsonValue *quests = member(*q, "quests", "quest.lifecycle.quests");
	bool agree = quests->is_array() && quests->size() == state.object_items.size();
	for (const auto &qp : quests->array_items) {
		const JsonValue *s = state.find(qp->get_string("id"));
		const JsonValue *at = qp->find("completedAtMs");
		const JsonValue *sat = s ? s->find("completedAtMs") : nullptr;
		if (!s || s->get_string("status") != qp->get_string("status") || !at != !sat ||
		    (at && sat && compare(*sat, *at, 0.0, "completedAtMs").size())) {
			agree = false;
		}
	}
	if (agree) seen.quests_sessions++;
	else seen.problems.push_back(name + ": quest.lifecycle.quests does not agree with the state (status, completedAtMs)");
}

// session: { ok: false, refusal } or { ok: true, initial: { state, facts }, steps: [{ result, state }] }.
JsonValuePtr drive_session(Caller &c, Seen &seen, const std::string &name, const JsonValue &input) {
	const JsonValue *steps = input.find("steps");
	if (steps && !steps->is_array()) throw DriveError("a session's steps are not a list");
	std::string args = "{";
	for (const auto &kv : input.object_items) {
		if (kv.first == "steps") continue;
		args += (args.size() > 1 ? "," : "") + quoted(kv.first) + ":" + json_of(*kv.second);
	}
	args += "}";
	auto created = c.call("quest.lifecycle.create", args);
	const JsonValue *ok = member(*created, "ok", "quest.lifecycle.create");
	if (ok->type != JsonType::Bool) throw DriveError("quest.lifecycle.create answered an ok that is not a boolean");
	if (!ok->bool_value) {
		const JsonValue *refusal = member(*created, "refusal", "a refused quest.lifecycle.create");
		if (created->object_items.size() != 2 || created->find("session")) throw DriveError("a refused create is not { ok, refusal }: " + json_of(*created));
		seen.codes.insert(refusal->get_string("code"));
		return created;
	}
	const long long sid = session_of(created, "quest.lifecycle.create");
	const JsonValue *state0 = member(*created, "state", "quest.lifecycle.create");
	const JsonValue *facts0 = member(*created, "facts", "quest.lifecycle.create");
	if (created->object_items.size() != 4) {
		c.dispose(sid);
		throw DriveError("quest.lifecycle.create answered a key core's runner does not pin: " + json_of(*created));
	}
	note_facts(seen, *facts0);
	note_state(seen, *state0);
	std::string out = "{\"ok\":true,\"initial\":{\"state\":" + json_of(*state0) + ",\"facts\":" + json_of(*facts0) + "},\"steps\":[";
	std::vector<JsonValuePtr> results;
	try {
		const std::size_t n = steps ? steps->size() : 0;
		for (std::size_t i = 0; i < n; i++) {
			const JsonValue &step = *steps->array_items[i];
			auto applied = c.call("quest.lifecycle.apply", "{\"session\":" + std::to_string(sid) + ",\"ops\":[" + json_of(step) + "]}");
			const JsonValue *rs = member(*applied, "results", "quest.lifecycle.apply");
			const JsonValue *state = member(*applied, "state", "quest.lifecycle.apply");
			if (!rs->is_array() || rs->size() != 1 || applied->object_items.size() != 2) {
				throw DriveError("quest.lifecycle.apply answered not { results: [one], state }");
			}
			note_result(seen, step, *rs->array_items[0]);
			note_state(seen, *state);
			results.push_back(rs->array_items[0]);
			out += std::string(i ? "," : "") + "{\"result\":" + json_of(*rs->array_items[0]) + ",\"state\":" + json_of(*state) + "}";
		}
		out += "]}";
		auto answer = parse(out);
		const JsonValue *steps_out = answer->find("steps");
		const JsonValue &last_state = steps_out->size() ? *steps_out->array_items.back()->find("state") : *state0;
		check_after(c, seen, sid, name, *facts0, results, last_state);
		c.dispose(sid);
		return answer;
	} catch (...) {
		c.dispose(sid);
		throw;
	}
}

// One case's answer, in its `expected` shape. A DriveError when it cannot be driven.
JsonValuePtr drive(Caller &c, Seen &seen, const std::string &name, const std::string &op, const JsonValue &input) {
	if (op == "session") return drive_session(c, seen, name, input);
	throw DriveError("op " + op + " is not one of core's quests-lifecycle ops (quest-corpus.ts QUEST_CORPUS_OPS)");
}

// ── the measured contract keys and the stated tables, held to what the rows answered ──

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

// `held` counts the measured keys that hold; `answered` the stated tables the cases answered exactly.
std::vector<std::string> measured_problems(const JsonValue &contract, const Seen &seen, int sessions, int &held, int &answered) {
	std::vector<std::string> out;
	held = 0;
	answered = 0;
	if (sessions > 0 && seen.delta_sessions == sessions && contract.find("deltaRule")) held++;
	else out.push_back("deltaRule: " + std::to_string(seen.delta_sessions) + " of " + std::to_string(sessions) + " accepted session(s) hold it");
	auto same_set = [&](const char *key, const std::set<std::string> &got, const char *what) {
		const std::set<std::string> stated = string_set(contract.find(key));
		if (stated.empty() || stated != got) {
			out.push_back(std::string(key) + ": the contract states [" + joined(stated) + "] but the rows " + what + " [" + joined(got) + "]");
		} else {
			answered++;
		}
	};
	same_set("refusalCodes", seen.codes, "answered");
	same_set("predicates", seen.predicates, "stated facts of");
	same_set("statuses", seen.statuses, "answered");
	same_set("ops", seen.ops, "took steps of");
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

// { ok: false, refusal: { code, field } } with this code and field, and nothing else.
bool refused_with(const JsonValuePtr &r, const char *code, const char *field) {
	const JsonValue *ok = r ? r->find("ok") : nullptr;
	const JsonValue *refusal = r ? r->find("refusal") : nullptr;
	return ok && ok->type == JsonType::Bool && !ok->bool_value && refusal && refusal->get_string("code") == code &&
	       refusal->get_string("field") == field && r->object_items.size() == 2;
}

// One step on a fresh one-quest session; its result.
JsonValuePtr one_step(Caller &c, const std::string &step) {
	auto created = c.call("quest.lifecycle.create", "{\"quests\":[{\"id\":\"q\",\"status\":\"active\",\"objectives\":[]}]}");
	const long long sid = session_of(created, "quest.lifecycle.create");
	auto r = c.try_call("quest.lifecycle.apply", "{\"session\":" + std::to_string(sid) + ",\"ops\":[" + step + "]}");
	c.dispose(sid);
	if (!r || !r->find("results") || r->find("results")->size() != 1) return nullptr;
	return r->find("results")->array_items[0];
}

void refusal_probes(Caller &c, Probes &p) {
	// 1. An op this runner does not know fails its case.
	{
		Seen scratch;
		bool refused = false;
		try {
			drive(c, scratch, "probe", "replay", *parse("{}"));
		} catch (const DriveError &) {
			refused = true;
		}
		p.check(refused, "an unknown op (replay) was driven");
	}
	// 2. What core refuses itself is core's VALUE, never a row error.
	p.check(refused_with(c.try_call("quest.lifecycle.create", "{\"quests\":{}}"), "missing_field", "quests"),
	        "quests that are an object were not core's missing_field value");
	p.check(refused_with(c.try_call("quest.lifecycle.create", "{\"quests\":[{\"id\":\"q\",\"status\":\"failed\"}]}"), "bad_status", "quests[0].status"),
	        "a status core does not know was not core's bad_status value");
	p.check(refused_with(one_step(c, "{\"op\":\"dance\"}"), "unknown_op", "op"), "an op core does not know was not core's unknown_op value");
	p.check(refused_with(one_step(c, "{\"op\":\"pick_up\",\"item\":\"x\",\"count\":0}"), "bad_count", "count"),
	        "a pick-up of 0 was not core's bad_count value");
	p.check(refused_with(one_step(c, "{\"op\":\"talk_to\",\"npc\":\"n\",\"atMs\":1.5}"), "bad_time", "atMs"),
	        "a fractional atMs was not core's bad_time value");
	// 3. What core reads unchecked is the [invalid-input] ERROR.
	const std::string head = "{\"quests\":[{\"id\":\"q\",\"status\":\"active\",";
	p.check(invalid_input(c, "quest.lifecycle.create", head + "\"objectives\":{}}]}"), "objectives that are an object were not [invalid-input]");
	p.check(invalid_input(c, "quest.lifecycle.create", head + "\"experienceReward\":\"50\"}]}"), "a reward that is a string was not [invalid-input]");
	p.check(invalid_input(c, "quest.lifecycle.create", head + "\"itemRewards\":\"potion\"}]}"), "item rewards that are a string were not [invalid-input]");
	// 4. ... unless core refuses the same set itself: core's value wins.
	p.check(refused_with(c.try_call("quest.lifecycle.create", "{\"quests\":[{\"status\":\"active\",\"objectives\":{}}]}"), "missing_field", "quests[0].id"),
	        "a set core refuses (no id) beside objectives that are an object was not core's missing_field value");
	// 5. A session of another kind is the session table's error.
	{
		auto n = c.call("ui.notifications.create", "{}");
		const long long sid = session_of(n, "ui.notifications.create");
		auto r = c.try_call("quest.lifecycle.apply", "{\"session\":" + std::to_string(sid) + ",\"ops\":[]}");
		c.dispose(sid);
		p.check(!r && c.last_error.find("not quest.lifecycle") != std::string::npos, "another kind of session was applied as a lifecycle");
	}
	// 6. An unknown row is the method table's error.
	{
		auto r = c.try_call("quest.lifecycle.rewind", "{}");
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
		std::fprintf(stderr, "usage: insimulcore_quests_lifecycle_corpus [--negative] <conformance/quests/lifecycle.json>...\n");
		return 2;
	}
	const char *tag = negative ? "quests_lifecycle_corpus --negative" : "quests_lifecycle_corpus";
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
	try {
		refusal_probes(c, probes);
	} catch (const std::exception &e) {
		std::printf("  [FAIL] refusal probes: %s\n", e.what());
		probes.total++;
	}
	if (probes.passed != probes.total) failed++;
	std::printf("refusals: %d of %d probe(s) refused as core refuses (values: missing_field, bad_status, unknown_op, bad_count, "
	            "bad_time, core's own over the boundary; errors: [invalid-input], another session kind, an unknown row; an unknown op "
	            "fails its case)\n",
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
		const Area &a = kLifecycle;
		const JsonValue *case_list = doc.find("cases");
		const JsonValue *contract = doc.find("contract");
		const JsonValue *tol_v = doc.find("tolerance");
		if (doc.get_string("area") != a.area || !contract || !contract->is_object() || !tol_v || !tol_v->is_number()) {
			std::printf("  [FAIL] %s is not the quest lifecycle corpus (area quests-lifecycle, a contract, a tolerance)\n", file.c_str());
			failed++;
			continue;
		}
		if (!case_list || !case_list->is_array() || case_list->size() == 0) {
			std::printf("  [FAIL] %s holds no case\n", file.c_str());
			failed++;
			continue;
		}
		const double tol = tol_v->number_value;
		std::printf("%s: tolerance %g, as the file states\n", a.area, tol);

		// The contract row: the keys it states.
		int row_agree = 0;
		{
			JsonValuePtr row;
			try {
				row = c.call(a.contract_row, "{}");
			} catch (const DriveError &e) {
				std::printf("  [FAIL] %s contract: %s\n", a.area, e.what());
				failed++;
			}
			if (row) {
				const std::vector<std::string> problems = contract_problems(a, *contract, *row, row_agree);
				for (const std::string &why : problems) std::printf("  [FAIL] %s contract: %s\n", a.area, why.c_str());
				if (!problems.empty()) failed++;
			}
		}

		std::map<std::string, int> driven;
		int refused = 0, accepted = 0, total = 0, bit_exact = 0, case_failed = 0, sessions = 0;
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
			const std::size_t problems_before = seen.problems.size();
			try {
				actual = drive(c, seen, name, op, *input);
			} catch (const std::exception &e) {
				std::printf("  [FAIL] %s — not driven: %s\n", name.c_str(), e.what());
				case_failed++;
				continue;
			}
			const JsonValue *aok = actual->find("ok");
			if (aok && aok->type == JsonType::Bool && aok->bool_value) sessions++;
			for (std::size_t k = problems_before; k < seen.problems.size(); k++) std::printf("  [FAIL] %s\n", seen.problems[k].c_str());
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

		// The measured key, and the stated tables held to what the rows answered.
		int measured_held = 0, answered = 0;
		{
			const std::vector<std::string> problems = measured_problems(*contract, seen, sessions, measured_held, answered);
			for (const std::string &why : problems) std::printf("  [FAIL] %s contract: %s\n", a.area, why.c_str());
			if (!problems.empty()) failed++;
		}
		if (seen.quests_sessions != sessions) failed++;
		std::string by_cases;
		for (const std::string &k : a.by_cases) by_cases += (by_cases.empty() ? "" : ", ") + k;
		std::printf("%s contract: %zu key(s), whole: %d of %zu stated by %s agree; %d of %zu measured hold (deltaRule over %d "
		            "accepted session(s)); %d of 4 stated tables answered exactly over the cases (refusalCodes %zu, predicates %zu, "
		            "statuses %zu, ops %zu); pinned by the cases: %s\n",
		            a.area, contract->object_items.size(), row_agree, a.row_keys.size(), a.contract_row, measured_held, a.measured.size(),
		            seen.delta_sessions, answered, seen.codes.size(), seen.predicates.size(), seen.statuses.size(), seen.ops.size(),
		            by_cases.c_str());
		std::printf("%s: quest.lifecycle.quests agrees with the state after %d of %d accepted session(s)\n", a.area, seen.quests_sessions, sessions);

		// Every op of core's runner is driven by at least one case.
		std::string by_op;
		int undriven = 0;
		int file_driven = 0;
		for (const std::string &o : a.ops) {
			const int n = driven.count(o) ? driven[o] : 0;
			file_driven += n;
			by_op += (by_op.empty() ? "" : ", ") + o + " " + std::to_string(n);
			if (n == 0) {
				std::printf("  [FAIL] %s op %s: no case of it was driven\n", a.area, o.c_str());
				failed++;
				undriven++;
			}
		}
		std::printf("%s: driven %s. %d undriven\n", a.area, by_op.c_str(), undriven);
		if (negative) {
			std::printf("%s: %d of %d perturbed case(s) refused, %d accepted\n", a.area, refused, total, accepted);
		} else {
			std::printf("%s: %d of %d case(s) driven through the rows, %d failed (within the file's tolerance %g; %d of them identical to "
			            "the last bit)\n",
			            a.area, file_driven, total, case_failed, tol, bit_exact);
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
