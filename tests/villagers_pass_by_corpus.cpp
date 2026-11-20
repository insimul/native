// villagers_pass_by_corpus.cpp — core's villager pass-by corpus, driven through
// libinsimulcore's `passBy.*` rows.
//
// PL.native-pass-by-rows (rulings U128, U118, U107, U101(1), U49(3), U36). Core's
// villager pass-by rule (src/pass-by/pass-by.ts) and its frame-by-frame replay
// (src/pass-by/pass-by-replay.ts) are rows of corebridge/js/entry.js. This gate holds
// them to core's own corpus, conformance/villagers/pass-by.json, COPIED byte for byte
// into corebridge/vendor/core/conformance/villagers/ at the pin and sha256-checked by
// the `core_vendor` ctest. Nothing here re-writes a case or computes an answer: every
// answer comes out of the rows.
//
// Each op of the corpus is ONE call, as core's reference runner
// (src/pass-by/pass-by-corpus.ts, `runPassByOp`) makes one core call, in the file's
// case order, with the case's whole `input` as the row's args:
//
//   floor   passBy.guardFloor     -> { floorM }                  (passByGuardFloor)
//   guard   passBy.keepClear      -> { acted, velocity, side }   (keepClearOfPlayer)
//   plan    passBy.planStepAside  -> the StepAsideDecision       (planStepAside)
//   round   passBy.planRound      -> { way }                     (planRoundPlayer)
//   replay  passBy.replay         -> the PassByReplay            (replayPassBy)
//
// Comparison is the corpus's own rule (core's `compareVillageState`, which its runner
// uses): numbers within the file's `tolerance`, everything else exactly, object key
// sets included. The run also counts the cases whose answer is identical to the
// corpus's to the last bit (`tol 0`) and reports them. The row `passBy.contract` is
// held to the corpus's `contract`: every constant's `value`, key for key both ways,
// the side frames and the measured abreast window exactly; the export names it states
// are distinct `PASS_BY_*` names keyed as the constants are.
//
// An op this runner does not know fails its case (never a skip); the refusal probes
// prove it on every start, and prove that the rows refuse what core's declared types
// exclude ([invalid-input]) while a refused step aside is core's VALUE. The run FAILS on
// a file that is not the pass-by corpus or holds no case, on an op of core's runner no
// case drives, on a row missing from the method table, on a contract key that differs,
// on a session left open, and when its comparator, its perturbation or its contract check
// cannot fail (self-tests on every start: ten doctored contract answers must each be named).
//
// --negative perturbs EVERY driven case's expectation (its last leaf) and requires
// every one to be refused.
//
// A pure consumer of insimulcore.h (no quickjs.h, no insimul.h). The JSON reader is
// tests/radiant/json_value.{h,cpp}, used as is.
//
// usage: insimulcore_villagers_pass_by_corpus [--negative] <conformance/villagers/pass-by.json>

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

// core's PASS_BY_OPS (src/pass-by/pass-by-corpus.ts), in its order, and the row each calls.
const char *const kOps[][2] = {{"floor", "passBy.guardFloor"},
                               {"guard", "passBy.keepClear"},
                               {"plan", "passBy.planStepAside"},
                               {"round", "passBy.planRound"},
                               {"replay", "passBy.replay"}};

// Every row this runner calls.
const char *const kRows[] = {"passBy.contract",       "passBy.guardFloor", "passBy.keepClear",
                             "passBy.planStepAside",  "passBy.planRound",  "passBy.replay",
                             "passBy.distanceToSegment"};

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
	    {"{\"x\":0.21999999999999997}", "{\"x\":0.22}", true},
	    {"{\"x\":1}", "{\"x\":1.00001}", false},
	    {"{\"stepAside\":false,\"reason\":\"no-room\"}", "{\"stepAside\":false,\"reason\":\"off-line\"}", false},
	    {"{\"way\":null}", "{\"way\":[]}", false},
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
		const bool agree = e && a && compare(*e, *a, 1e-6, "$").empty();
		if (agree != p.agree) {
			std::printf("  [FAIL] self-test: %s vs %s should %s\n", p.expected, p.actual, p.agree ? "agree" : "differ");
			ok = false;
		}
	}
	const char *sources[] = {"[{}]", "[]", "{\"acted\":false,\"velocity\":{\"x\":0,\"z\":1.4},\"side\":0}",
	                         "{\"way\":null}", "{\"stepAside\":false,\"reason\":\"not-walking\",\"guardFloorM\":0.96}"};
	for (const char *s : sources) {
		auto src = parse(s);
		auto bad = deep_copy(*src);
		sabotage_last(*bad);
		if (compare(*src, *bad, 1e-6, "$").empty() || json_of(*src) != json_of(*parse(s))) {
			std::printf("  [FAIL] self-test: perturbing %s gave no difference, or changed the source\n", s);
			ok = false;
		}
	}
	return ok;
}

// ── the contract check ────────────────────────────────────────────────────────

// What is wrong with passBy.contract's answer `row` against the corpus's `contract`: every
// constant's `value` equal (key for key, both ways), each with a distinct PASS_BY_* export name
// keyed as the constants are, sideFrames and measuredAbreastS equal, and no other key. `agree`
// counts the constants that hold.
std::vector<std::string> contract_problems(const JsonValue &contract, const JsonValue &row, int &agree) {
	std::vector<std::string> out;
	agree = 0;
	const JsonValue *constants = contract.find("constants");
	const JsonValue *stated = row.find("constants");
	const JsonValue *names = row.find("names");
	if (!constants || !constants->is_object()) return {"the corpus's contract has no constants"};
	if (!stated || !stated->is_object() || !names || !names->is_object()) return {"the row states no constants or names object"};
	for (const auto &kv : constants->object_items) {
		const JsonValue *want = kv.second->find("value");
		const JsonValue *got = stated->find(kv.first);
		const JsonValue *name = names->find(kv.first);
		if (!want || !got) {
			out.push_back("constant " + kv.first + (want ? " is not stated by the row" : " has no value in the corpus"));
			continue;
		}
		const std::string diff = compare(*want, *got, 0.0, "constants." + kv.first);
		if (!diff.empty()) {
			out.push_back(diff);
			continue;
		}
		if (!name || !name->is_string() || name->string_value.rfind("PASS_BY_", 0) != 0) {
			out.push_back("constant " + kv.first + " has no PASS_BY_* export name");
			continue;
		}
		agree++;
	}
	for (const auto &kv : stated->object_items) {
		if (!constants->find(kv.first)) out.push_back("the row states constant " + kv.first + ", which the corpus's contract does not");
	}
	std::set<std::string> distinct;
	for (const auto &kv : names->object_items) {
		distinct.insert(kv.second->as_string());
		if (!constants->find(kv.first)) out.push_back("the row names " + kv.first + ", which the corpus's contract does not hold");
	}
	if (distinct.size() != names->object_items.size()) out.push_back("two constants share an export name");
	for (const char *k : {"sideFrames", "measuredAbreastS"}) {
		const JsonValue *want = contract.find(k);
		const JsonValue *got = row.find(k);
		const std::string diff = want && got ? compare(*want, *got, 0.0, k) : std::string(k) + ": missing";
		if (!diff.empty()) out.push_back(diff);
	}
	if (row.object_items.size() != 4) {
		out.push_back("the row states " + std::to_string(row.object_items.size()) +
		              " key(s), not constants, names, measuredAbreastS and sideFrames");
	}
	return out;
}

// The contract check is a gate too: each doctored answer must be named, the sound one must not.
bool contract_self_test() {
	const char *contract = "{\"constants\":{\"gapM\":{\"value\":0.2,\"source\":\"s\"},\"pastLegsM\":{\"value\":[1.3,0.9],\"source\":\"s\"}},"
	                       "\"sideFrames\":{\"unreal\":\"+1 right\"},\"measuredAbreastS\":{\"min\":0.4,\"max\":1.7}}";
	const std::string frames = "\"sideFrames\":{\"unreal\":\"+1 right\"},\"measuredAbreastS\":{\"min\":0.4,\"max\":1.7}";
	const std::string names = "\"names\":{\"gapM\":\"PASS_BY_GUARD_GAP_M\",\"pastLegsM\":\"PASS_BY_PAST_LEGS_M\"}";
	struct Probe {
		std::string row;
		bool sound;
	} probes[] = {
	    {"{\"constants\":{\"gapM\":0.2,\"pastLegsM\":[1.3,0.9]}," + names + "," + frames + "}", true},
	    {"{\"constants\":{\"gapM\":0.25,\"pastLegsM\":[1.3,0.9]}," + names + "," + frames + "}", false},
	    {"{\"constants\":{\"gapM\":0.2,\"pastLegsM\":[1.3]}," + names + "," + frames + "}", false},
	    {"{\"constants\":{\"gapM\":0.2}," + names + "," + frames + "}", false},
	    {"{\"constants\":{\"gapM\":0.2,\"pastLegsM\":[1.3,0.9],\"waitS\":3}," + names + "," + frames + "}", false},
	    {"{\"constants\":{\"gapM\":0.2,\"pastLegsM\":[1.3,0.9]},\"names\":{\"gapM\":\"GAP\",\"pastLegsM\":\"PASS_BY_PAST_LEGS_M\"}," + frames + "}", false},
	    {"{\"constants\":{\"gapM\":0.2,\"pastLegsM\":[1.3,0.9]},\"names\":{\"gapM\":\"PASS_BY_X\",\"pastLegsM\":\"PASS_BY_X\"}," + frames + "}", false},
	    {"{\"constants\":{\"gapM\":0.2,\"pastLegsM\":[1.3,0.9]}," + names + ",\"sideFrames\":{\"unreal\":\"+1 left\"},\"measuredAbreastS\":{\"min\":0.4,\"max\":1.7}}", false},
	    {"{\"constants\":{\"gapM\":0.2,\"pastLegsM\":[1.3,0.9]}," + names + ",\"sideFrames\":{\"unreal\":\"+1 right\"},\"measuredAbreastS\":{\"min\":0.4,\"max\":1.6}}", false},
	    {"{\"constants\":{\"gapM\":0.2,\"pastLegsM\":[1.3,0.9]}," + names + "," + frames + ",\"extra\":1}", false},
	};
	auto c = insimul::parse_json(contract).root;
	bool ok = true;
	for (const Probe &p : probes) {
		auto r = insimul::parse_json(p.row).root;
		int agree = 0;
		const bool sound = c && r && contract_problems(*c, *r, agree).empty();
		if (sound != p.sound) {
			std::printf("  [FAIL] self-test: the contract check %s %s\n", p.sound ? "refused" : "accepted", p.row.c_str());
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

// The row core's runner's op calls; nullptr for an op it does not know.
const char *row_of(const std::string &op) {
	for (const auto &o : kOps) {
		if (op == o[0]) return o[1];
	}
	return nullptr;
}

// One case's answer, in its `expected` shape: ONE call of the op's row with the input
// as its args. A DriveError when it cannot be driven.
JsonValuePtr drive(Caller &c, const std::string &op, const JsonValue &input) {
	const char *row = row_of(op);
	if (!row) throw DriveError("op " + op + " is not one of core's pass-by ops (pass-by-corpus.ts PASS_BY_OPS)");
	return c.call(row, json_of(input));
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

void refusal_probes(Caller &c, Probes &p) {
	const std::string here = "{\"x\":0,\"z\":0}";
	const std::string walk = "{\"x\":1.4,\"z\":0}";
	// 1. An op this runner does not know fails its case.
	{
		bool refused = false;
		try {
			auto in = insimul::parse_json("{}").root;
			drive(c, "sidestep", *in);
		} catch (const DriveError &) {
			refused = true;
		}
		p.check(refused, "an unknown op (sidestep) was driven");
	}
	// 2. A refused step aside is core's VALUE, never a row error.
	{
		auto r = c.try_call("passBy.planStepAside",
		                    "{\"villager\":{\"at\":" + here + ",\"velocity\":" + walk + ",\"path\":[{\"x\":20,\"z\":0}]},"
		                    "\"player\":{\"at\":{\"x\":1.5,\"z\":0.2}},\"room\":{\"plus\":false,\"minus\":false}}");
		const JsonValue *step = r ? r->find("stepAside") : nullptr;
		p.check(r && step && step->type == JsonType::Bool && !step->bool_value && r->get_string("reason") == "no-room",
		        "no room either side was not core's no-room value");
	}
	// 3. What core's declared types exclude, or what it would dereference unread, is the [invalid-input] ERROR.
	p.check(invalid_input(c, "passBy.keepClear", "{\"at\":" + here + ",\"velocity\":" + walk + ",\"player\":" + here + "}"),
	        "a guard input with no playerVelocity was not [invalid-input]");
	p.check(invalid_input(c, "passBy.planStepAside",
	                      "{\"villager\":{\"at\":" + here + ",\"velocity\":" + walk + ",\"path\":{\"x\":2,\"z\":0}},\"player\":{\"at\":" + here + "}}"),
	        "a plan whose path is not a list was not [invalid-input]");
	p.check(invalid_input(c, "passBy.planRound", "{\"here\":{\"x\":0.4},\"next\":" + here + ",\"player\":" + here + "}"),
	        "a round point with no z was not [invalid-input]");
	p.check(invalid_input(c, "passBy.guardFloor", "{\"villagerRadius\":\"0.3\"}"),
	        "a radius that is a string was not [invalid-input]");
	p.check(invalid_input(c, "passBy.replay",
	                      "{\"scene\":{\"seconds\":1,\"player\":{\"at\":" + here + "},\"villagers\":[{\"id\":\"v\",\"at\":" + here + ",\"path\":[]}]}}"),
	        "a replay villager with an empty path was not [invalid-input]");
	p.check(invalid_input(c, "passBy.replay", "{}"), "a replay with no scene was not [invalid-input]");
	// 4. An unknown row is the method table's error.
	{
		auto r = c.try_call("passBy.sidestep", "{}");
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
	if (files.size() != 1) {
		std::fprintf(stderr, "usage: insimulcore_villagers_pass_by_corpus [--negative] <conformance/villagers/pass-by.json>\n");
		return 2;
	}
	const char *tag = negative ? "villagers_pass_by_corpus --negative" : "villagers_pass_by_corpus";
	if (!self_test() || !contract_self_test()) {
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
	const JsonValue *case_list = doc.find("cases");
	const JsonValue *contract = doc.find("contract");
	const JsonValue *constants = contract ? contract->find("constants") : nullptr;
	if (doc.get_string("area") != "villager-pass-by" || !contract || !contract->is_object() || !constants || !constants->is_object()) {
		std::fprintf(stderr, "%s: %s is not the villager pass-by corpus (area villager-pass-by, a contract with constants)\n", tag,
		             file.c_str());
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

	// The refusal probes.
	Probes probes;
	refusal_probes(c, probes);
	if (probes.passed != probes.total) failed++;
	std::printf("refusals: %d of %d probe(s) refused as core refuses (a value: no-room; errors: [invalid-input], an "
	            "unknown row; an unknown op fails its case)\n",
	            probes.passed, probes.total);

	// The contract: every constant's value, both key sets, the side frames and the measured window.
	{
		JsonValuePtr row;
		try {
			row = c.call("passBy.contract", "{}");
		} catch (const DriveError &e) {
			std::printf("  [FAIL] contract: %s\n", e.what());
			failed++;
		}
		if (row) {
			int agree = 0;
			const std::vector<std::string> problems = contract_problems(*contract, *row, agree);
			for (const std::string &why : problems) std::printf("  [FAIL] contract: %s\n", why.c_str());
			if (!problems.empty()) failed++;
			std::printf("contract: %d of %zu constant(s) passBy.contract states agree with the corpus's, each with its export "
			            "name, and sideFrames and measuredAbreastS %s\n",
			            agree, constants->object_items.size(), problems.empty() ? "agree" : "checked, with problems");
		}
	}

	std::map<std::string, int> driven;
	int refused = 0, accepted = 0, total = 0, bit_exact = 0;
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
			actual = drive(c, op, *input);
		} catch (const std::exception &e) {
			std::printf("  [FAIL] %s — not driven: %s\n", name.c_str(), e.what());
			failed++;
			continue;
		}
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
			if (compare(*expected, *actual, 0.0, "$").empty()) bit_exact++;
		}
		driven[op]++;
	}

	// Every op of core's runner is driven by at least one case.
	std::string by_op;
	int undriven = 0;
	for (const auto &o : kOps) {
		const int n = driven.count(o[0]) ? driven[o[0]] : 0;
		by_op += (by_op.empty() ? "" : ", ") + std::string(o[0]) + " " + std::to_string(n);
		if (n == 0) {
			std::printf("  [FAIL] op %s: no case of it was driven through %s\n", o[0], o[1]);
			failed++;
			undriven++;
		}
	}

	// No session left open (the rows are stateless).
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
	std::printf("villager-pass-by: driven %s. %d undriven\n", by_op.c_str(), undriven);
	if (negative) {
		std::printf("%s: %d of %d perturbed case(s) refused, %d accepted, %d failure(s), %.0f ms\n", tag, refused, total,
		            accepted, failed, ms);
	} else {
		std::printf("%s: %d of %d case(s) driven through the rows, %d failed (within the corpus's tolerance %g; %d of them "
		            "identical to the last bit), %.0f ms\n",
		            tag, total_driven, total, failed, tol, bit_exact, ms);
	}
	if (failed || total_driven == 0 || total_driven != total) {
		std::printf("%s: FAIL\n", tag);
		return 1;
	}
	std::printf("%s: PASS\n", tag);
	return 0;
}
