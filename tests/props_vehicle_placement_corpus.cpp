// props_vehicle_placement_corpus.cpp — core's world-vehicle parking corpus, driven
// through libinsimulcore's `props.vehicle.*` rows.
//
// PL.native-vehicle-rows (rulings U128, U115, U107, U106(3), U101(1), U49(3), U36). Core's
// world-vehicle parking rule (src/props/vehicle-placement.ts, PL.core-vehicle-rules) is
// rows of corebridge/js/entry.js. This gate holds them to core's own corpus,
// conformance/props/vehicle-placement.json, COPIED byte for byte into
// corebridge/vendor/core/conformance/props/ at the pin (the props set) and
// sha256-checked by the `core_vendor` ctest. Nothing here re-writes a case or computes
// an answer: every answer comes out of the rows.
//
// Each op of the corpus is ONE call, as core's reference runner
// (src/props/vehicle-placement-corpus.ts, `runVehiclePlacementOp`) makes one core call,
// in the file's case order, with the case's whole `input` as the row's args:
//
//   probes  props.vehicle.streetProbes  -> { points }          (vehicleStreetProbes)
//   park    props.vehicle.park          -> the VehicleParking  (parkVehicle)
//
// Comparison is the corpus's own rule (core's `checkVehiclePlacementCase`, which compares
// with `compareVillageState`): numbers within the file's `tolerance`, everything else
// exactly, object key sets included. The run also counts the cases whose answer is
// identical to the corpus's to the last bit (`tol 0`) and reports them. The file's
// `numerics` must name double precision (the rows compute in it). The row
// `props.vehicle.contract` is held to the corpus's `contract`: every constant's `value`,
// key for key both ways, each with a distinct `VEHICLE_PARK_*` export name keyed as the
// constants are, and `refusals`, `tiers` and `deviations` exactly. The contract's prose
// (`units`, `probes`, `park`, `when`, `sourceAbbreviation`, each constant's `source`) is
// core's emitter's text, which no core export holds; the run names it as not held.
//
// An op this runner does not know fails its case (never a skip); the refusal probes
// prove it on every start, and prove that the rows refuse what core cannot read
// ([invalid-input]) while a refused parking (`bad-place`, `no-open-spot`) is core's VALUE.
// The run FAILS on a file that is not the vehicle-placement corpus or holds no case, on an
// op of core's runner no case drives, on a row missing from the method table, on a
// contract key that differs, on a session left open, and when its comparator, its
// perturbation or its contract check cannot fail (self-tests on every start: ten
// doctored contract answers must each be named).
//
// --negative perturbs EVERY driven case's expectation (its last leaf) and requires
// every one to be refused.
//
// A pure consumer of insimulcore.h (no quickjs.h, no insimul.h). The JSON reader is
// tests/radiant/json_value.{h,cpp}, used as is.
//
// usage: insimulcore_props_vehicle_placement_corpus [--negative] <conformance/props/vehicle-placement.json>

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

// core's VEHICLE_PLACEMENT_OPS (src/props/vehicle-placement-corpus.ts), in its order, and the row each calls.
const char *const kOps[][2] = {{"probes", "props.vehicle.streetProbes"}, {"park", "props.vehicle.park"}};

// Every row this runner calls.
const char *const kRows[] = {"props.vehicle.contract", "props.vehicle.streetProbes", "props.vehicle.park"};

// The contract's tables the row states, held exactly (besides `constants` and `names`).
const char *const kTables[] = {"refusals", "tiers", "deviations"};

// The contract's prose, core's emitter's text: no core export holds it, so no row states it.
const char *const kProse[] = {"units", "probes", "park", "when", "sourceAbbreviation"};

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
	    {"{\"ok\":false,\"code\":\"bad-place\"}", "{\"ok\":false,\"code\":\"no-open-spot\"}", false},
	    {"{\"points\":[]}", "{\"points\":null}", false},
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
	const char *sources[] = {"[{}]", "[]", "{\"points\":[{\"x\":7,\"z\":0}]}", "{\"ok\":false,\"code\":\"bad-place\"}",
	                         "{\"ok\":true,\"at\":{\"x\":7,\"z\":0},\"tier\":1,\"misses\":{\"street\":0,\"slot\":0}}"};
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

// What is wrong with props.vehicle.contract's answer `row` against the corpus's `contract`: every
// constant's `value` equal (key for key, both ways), each with a distinct VEHICLE_PARK_* export
// name keyed as the constants are, refusals, tiers and deviations equal, and no other key.
// `agree` counts the constants that hold.
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
		if (!name || !name->is_string() || name->string_value.rfind("VEHICLE_PARK_", 0) != 0) {
			out.push_back("constant " + kv.first + " has no VEHICLE_PARK_* export name");
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
	for (const char *k : kTables) {
		const JsonValue *want = contract.find(k);
		const JsonValue *got = row.find(k);
		const std::string diff = want && got ? compare(*want, *got, 0.0, k) : std::string(k) + ": missing";
		if (!diff.empty()) out.push_back(diff);
	}
	if (row.object_items.size() != 2 + sizeof kTables / sizeof kTables[0]) {
		out.push_back("the row states " + std::to_string(row.object_items.size()) +
		              " key(s), not constants, names, refusals, tiers and deviations");
	}
	return out;
}

// The contract check is a gate too: each doctored answer must be named, the sound one must not.
bool contract_self_test() {
	const char *contract = "{\"constants\":{\"snapM\":{\"value\":1.5,\"source\":\"s\"},\"ringsM\":{\"value\":[7,9],\"source\":\"s\"}},"
	                       "\"refusals\":[\"no-open-spot\",\"bad-place\"],\"tiers\":{\"1\":\"every rule\"},"
	                       "\"deviations\":[{\"id\":\"panel-open\",\"why\":\"w\"}]}";
	const std::string names = "\"names\":{\"snapM\":\"VEHICLE_PARK_SNAP_M\",\"ringsM\":\"VEHICLE_PARK_RINGS_M\"}";
	const std::string refusals = "\"refusals\":[\"no-open-spot\",\"bad-place\"]";
	const std::string tiers = "\"tiers\":{\"1\":\"every rule\"}";
	const std::string devs = "\"deviations\":[{\"id\":\"panel-open\",\"why\":\"w\"}]";
	const std::string sound = "\"constants\":{\"snapM\":1.5,\"ringsM\":[7,9]}";
	struct Probe {
		std::string row;
		bool sound;
	} probes[] = {
	    {"{" + sound + "," + names + "," + refusals + "," + tiers + "," + devs + "}", true},
	    {"{\"constants\":{\"snapM\":1.4,\"ringsM\":[7,9]}," + names + "," + refusals + "," + tiers + "," + devs + "}", false},
	    {"{\"constants\":{\"snapM\":1.5,\"ringsM\":[9,7]}," + names + "," + refusals + "," + tiers + "," + devs + "}", false},
	    {"{\"constants\":{\"snapM\":1.5}," + names + "," + refusals + "," + tiers + "," + devs + "}", false},
	    {"{\"constants\":{\"snapM\":1.5,\"ringsM\":[7,9],\"standM\":2.5}," + names + "," + refusals + "," + tiers + "," + devs + "}", false},
	    {"{" + sound + ",\"names\":{\"snapM\":\"SNAP\",\"ringsM\":\"VEHICLE_PARK_RINGS_M\"}," + refusals + "," + tiers + "," + devs + "}", false},
	    {"{" + sound + ",\"names\":{\"snapM\":\"VEHICLE_PARK_X\",\"ringsM\":\"VEHICLE_PARK_X\"}," + refusals + "," + tiers + "," + devs + "}", false},
	    {"{" + sound + "," + names + ",\"refusals\":[\"bad-place\",\"no-open-spot\"]," + tiers + "," + devs + "}", false},
	    {"{" + sound + "," + names + "," + refusals + ",\"tiers\":{\"1\":\"every rule!\"}," + devs + "}", false},
	    {"{" + sound + "," + names + "," + refusals + "," + tiers + ",\"deviations\":[]}", false},
	    {"{" + sound + "," + names + "," + refusals + "," + tiers + "," + devs + ",\"extra\":1}", false},
	};
	auto c = insimul::parse_json(contract).root;
	bool ok = true;
	for (const Probe &p : probes) {
		auto r = insimul::parse_json(p.row).root;
		int agree = 0;
		const bool sound_seen = c && r && contract_problems(*c, *r, agree).empty();
		if (sound_seen != p.sound) {
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
	if (!row) throw DriveError("op " + op + " is not one of core's vehicle-placement ops (vehicle-placement-corpus.ts VEHICLE_PLACEMENT_OPS)");
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

// `{ ok: false, code }` with `code` the given refusal.
bool refused_with(const JsonValuePtr &r, const char *code) {
	const JsonValue *ok = r ? r->find("ok") : nullptr;
	return ok && ok->type == JsonType::Bool && !ok->bool_value && r->get_string("code") == code;
}

void refusal_probes(Caller &c, Probes &p) {
	const std::string here = "{\"x\":0,\"z\":0}";
	// 1. An op this runner does not know fails its case.
	{
		bool refused = false;
		try {
			auto in = insimul::parse_json("{}").root;
			drive(c, "unpark", *in);
		} catch (const DriveError &) {
			refused = true;
		}
		p.check(refused, "an unknown op (unpark) was driven");
	}
	// 2. A refused parking is core's VALUE, never a row error: a place or ground height core cannot read, and no street.
	p.check(refused_with(c.try_call("props.vehicle.park", "{\"place\":\"the inn\"}"), "bad-place"),
	        "a place that is not a point was not core's bad-place value");
	p.check(refused_with(c.try_call("props.vehicle.park", "{\"place\":" + here + ",\"groundY\":null,\"streets\":[]}"), "no-open-spot"),
	        "no street anywhere (a null groundY read as 0) was not core's no-open-spot value");
	// 3. What core cannot read is the [invalid-input] ERROR.
	p.check(invalid_input(c, "props.vehicle.park", "{\"place\":" + here + ",\"streets\":null}"),
	        "a null streets (absent is everywhere, [] nowhere) was not [invalid-input]");
	p.check(invalid_input(c, "props.vehicle.park", "{\"place\":" + here + ",\"streets\":\"the high street\"}"),
	        "streets that is a string was not [invalid-input]");
	p.check(invalid_input(c, "props.vehicle.park", "{\"place\":" + here + ",\"buildings\":{\"at\":" + here + ",\"radius\":2}}"),
	        "buildings that is an object was not [invalid-input]");
	p.check(invalid_input(c, "props.vehicle.streetProbes", "{\"at\":" + here + "}"), "probes with no radiusM was not [invalid-input]");
	p.check(invalid_input(c, "props.vehicle.streetProbes", "{\"at\":{\"x\":\"7\",\"z\":0},\"radiusM\":1.5}"),
	        "a probe point whose x is a string was not [invalid-input]");
	// 4. An unknown row is the method table's error.
	{
		auto r = c.try_call("props.vehicle.unpark", "{}");
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
		std::fprintf(stderr, "usage: insimulcore_props_vehicle_placement_corpus [--negative] <conformance/props/vehicle-placement.json>\n");
		return 2;
	}
	const char *tag = negative ? "props_vehicle_placement_corpus --negative" : "props_vehicle_placement_corpus";
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
	if (doc.get_string("area") != "props-vehicle-placement" || !contract || !contract->is_object() || !constants ||
	    !constants->is_object()) {
		std::fprintf(stderr, "%s: %s is not the vehicle-placement corpus (area props-vehicle-placement, a contract with constants)\n",
		             tag, file.c_str());
		return 2;
	}
	if (!case_list || !case_list->is_array() || case_list->size() == 0) {
		std::fprintf(stderr, "%s: %s holds no case\n", tag, file.c_str());
		return 2;
	}
	const JsonValue *tol_v = doc.find("tolerance");
	const double tol = tol_v && tol_v->is_number() ? tol_v->number_value : 0.0;
	// How the file says its numbers are computed: the rows run in double precision.
	const std::string numerics = doc.get_string("numerics");
	const bool numerics_double = numerics.find("double precision") != std::string::npos;

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
	std::printf("refusals: %d of %d probe(s) refused as core refuses (values: bad-place, no-open-spot; errors: "
	            "[invalid-input], an unknown row; an unknown op fails its case)\n",
	            probes.passed, probes.total);

	if (!numerics_double) {
		std::printf("  [FAIL] numerics: the file %s; the rows compute in double precision\n",
		            numerics.empty() ? "states no numerics" : ("states \"" + numerics + "\", not double precision").c_str());
		failed++;
	} else {
		std::printf("numerics: double precision, as the file states; tolerance %g\n", tol);
	}

	// The contract: every constant's value, both key sets, the refusals, the tiers and the deviations.
	{
		JsonValuePtr row;
		try {
			row = c.call("props.vehicle.contract", "{}");
		} catch (const DriveError &e) {
			std::printf("  [FAIL] contract: %s\n", e.what());
			failed++;
		}
		if (row) {
			int agree = 0;
			const std::vector<std::string> problems = contract_problems(*contract, *row, agree);
			for (const std::string &why : problems) std::printf("  [FAIL] contract: %s\n", why.c_str());
			if (!problems.empty()) failed++;
			std::printf("contract: %d of %zu constant(s) props.vehicle.contract states agree with the corpus's, each with its "
			            "export name, and refusals, tiers and deviations %s\n",
			            agree, constants->object_items.size(), problems.empty() ? "agree" : "checked, with problems");
			std::string prose;
			for (const char *k : kProse) {
				if (contract->find(k)) prose += (prose.empty() ? "" : ", ") + std::string(k);
			}
			std::printf("contract prose not held (core's emitter's text, in no core export): %s, and each constant's source\n",
			            prose.c_str());
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
	std::printf("props-vehicle-placement: driven %s. %d undriven\n", by_op.c_str(), undriven);
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
