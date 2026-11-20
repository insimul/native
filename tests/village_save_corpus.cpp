// village_save_corpus.cpp — core's village-state save corpus, driven through
// libinsimulcore's `save.village.*` rows.
//
// PL.native-village-save-rows (rulings U118, U128, U101(1), U49(3), U36). Core's
// village-state save (src/save-file-game-state.ts: P1.core, and the conversations
// projection of PL.core-save-conversations-projection) is a set of rows of
// corebridge/js/entry.js. This gate holds them to core's own corpus,
// conformance/saves/village-state.json, COPIED byte for byte into
// corebridge/vendor/core/conformance/saves/ at the pin and sha256-checked by the
// `core_vendor` ctest. Nothing here re-writes a case or computes an answer: every
// answer comes out of the rows.
//
// How each op of the corpus is driven, as core's reference runner
// (src/save-file-game-state-corpus.ts, `runVillageStateOp`) composes it:
//
//   write                 save.village.write { save, gameState, options }
//   read                  save.village.read { save, options }
//   roundTrip             save.village.write { save, gameState, options: writeOptions }; on ok the
//                         written currentState and conversations are put over the save
//                         ({ ...save, ...body }) and save.village.read { that, options: readOptions }
//   stamp                 { runtime: save.village.runtimeOf, positionFrame: save.village.positionFrameOf,
//                           belongsTo: save.village.belongsTo { runtime ?? null },
//                           label: save.village.runtimeLabel over runtimeOf's answer }
//   agentCurie            save.village.agentCurie
//   timeStateOf           save.village.timeStateOf
//   totalHoursOf          save.village.totalHoursOf
//   conversationTimestamp save.village.conversations.timestamp
//   conversationEpochMs   save.village.conversations.epochMs
//   skillKb               save.village.read { save, options }; refused: that refusal; else
//                         skill.kb.loadJson { currentState: save.currentState }
//
// A refusal is compared as the corpus pins it, `{ code, field, found?, expected?,
// keys? }`: the row's `message` (core's sentence for a log) must be a string and is
// then set aside, as core's runner sets it aside. The row `save.village.contract` is
// held to the corpus's `contract` block, key for key.
//
// An op this runner does not know fails its case (never a skip); the refusal probes
// prove it on every start, and prove that the rows refuse what core refuses: a save
// of another version, an unregistered extension and a foreign world or runtime are
// VALUES (core's codes), a save that is not an object and records core cannot read
// are the `[invalid-input]` ERROR, and an unknown row is the method table's error.
// The run FAILS on a file that is not the saves corpus or holds no case, on an op of
// core's runner that no case drives, on a row missing from the method table, on a
// contract key that differs, on a session left open, and when its comparator or its
// perturbation cannot fail (a self-test on every start). Comparison is the corpus's
// own rule (core's `compareVillageState`): numbers within the file's `tolerance`,
// everything else exactly, object key sets included.
//
// --negative perturbs EVERY driven case's expectation (its last leaf) and requires
// every one to be refused.
//
// A pure consumer of insimulcore.h (no quickjs.h, no insimul.h). The JSON reader is
// tests/radiant/json_value.{h,cpp}, used as is.
//
// usage: insimulcore_village_save_corpus [--negative] <conformance/saves/village-state.json>

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

// core's VILLAGE_STATE_OPS (src/save-file-game-state-corpus.ts), in its order.
const char *const kOps[] = {"write",        "read",         "roundTrip",           "stamp",
                            "agentCurie",   "timeStateOf",  "totalHoursOf",        "conversationTimestamp",
                            "conversationEpochMs", "skillKb"};

// Every row this runner calls.
const char *const kRows[] = {"save.village.contract",          "save.village.write",
                             "save.village.read",              "save.village.check",
                             "save.village.ownership",         "save.village.runtimeOf",
                             "save.village.positionFrameOf",   "save.village.belongsTo",
                             "save.village.runtimeLabel",      "save.village.agentCurie",
                             "save.village.timeStateOf",       "save.village.totalHoursOf",
                             "save.village.conversations.rows", "save.village.conversations.timestamp",
                             "save.village.conversations.epochMs", "skill.kb.loadJson"};

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

// A row's answer with its refusal's `message` checked (a string) and set aside, as
// core's runner sets it aside: `{ ok: false, refusal: { code, field, found?,
// expected?, keys? } }`. Any other answer unchanged.
JsonValuePtr without_message(const char *method, JsonValuePtr answer) {
	const JsonValue *ok = answer->find("ok");
	if (!ok || ok->type != JsonType::Bool) throw DriveError(std::string(method) + " answered no boolean ok");
	if (ok->bool_value) return answer;
	const JsonValue *refusal = answer->find("refusal");
	if (!refusal || !refusal->is_object()) throw DriveError(std::string(method) + " refused with no refusal object");
	const JsonValue *message = refusal->find("message");
	if (!message || !message->is_string() || message->string_value.empty()) {
		throw DriveError(std::string(method) + " refused with no message (core's sentence for a log)");
	}
	auto out = deep_copy(*answer);
	for (auto &kv : out->object_items) {
		if (kv.first != "refusal") continue;
		auto &items = kv.second->object_items;
		for (auto it = items.begin(); it != items.end(); ++it) {
			if (it->first == "message") {
				items.erase(it);
				break;
			}
		}
	}
	return out;
}

const JsonValue &need(const JsonValue &input, const char *key) {
	const JsonValue *v = input.find(key);
	if (!v) throw DriveError(std::string("the case's input has no ") + key);
	return *v;
}

// `{ ...save, currentState, conversations }` from a write's answer.
JsonValuePtr save_with_written(const JsonValue &save, const JsonValue &written) {
	if (!save.is_object()) throw DriveError("the case's save is not an object");
	auto out = deep_copy(save);
	for (const char *k : {"currentState", "conversations"}) {
		const JsonValue *body = written.find(k);
		if (!body) throw DriveError(std::string("the write answered no ") + k);
		bool replaced = false;
		for (auto &kv : out->object_items) {
			if (kv.first == k) {
				kv.second = deep_copy(*body);
				replaced = true;
			}
		}
		if (!replaced) out->object_items.emplace_back(k, deep_copy(*body));
	}
	return out;
}

// One case's answer, in its `expected` shape. A DriveError when it cannot be driven.
JsonValuePtr drive(Caller &c, const std::string &op, const JsonValue &input) {
	if (op == "write" || op == "read") {
		const char *row = op == "write" ? "save.village.write" : "save.village.read";
		ObjectText args;
		args.copy(input, "save");
		if (op == "write") args.copy(input, "gameState");
		args.copy(input, "options");
		return without_message(row, c.call(row, args.done()));
	}
	if (op == "roundTrip") {
		ObjectText w;
		w.copy(input, "save");
		w.copy(input, "gameState");
		w.copy(input, "writeOptions", "options");
		auto written = without_message("save.village.write", c.call("save.village.write", w.done()));
		if (!written->get_bool("ok")) return written;
		ObjectText r;
		r.add("save", *save_with_written(need(input, "save"), *written));
		r.copy(input, "readOptions", "options");
		return without_message("save.village.read", c.call("save.village.read", r.done()));
	}
	if (op == "stamp") {
		ObjectText at;
		at.copy(input, "save");
		at.copy(input, "worldId");
		auto writer = c.call("save.village.runtimeOf", at.done());
		auto frame = c.call("save.village.positionFrameOf", at.done());
		ObjectText b;
		b.copy(input, "save");
		b.copy(input, "worldId");
		const JsonValue *runtime = input.find("runtime");
		b.add("runtime", runtime ? json_of(*runtime) : std::string("null"));
		auto belongs = c.call("save.village.belongsTo", b.done());
		const JsonValue *stamp = writer->find("runtime");
		if (!stamp) throw DriveError("save.village.runtimeOf answered no runtime");
		ObjectText l;
		l.add("runtime", *stamp);
		auto label = c.call("save.village.runtimeLabel", l.done());
		const JsonValue *pf = frame->find("positionFrame");
		const JsonValue *bt = belongs->find("belongsTo");
		const JsonValue *lb = label->find("label");
		if (!pf || !bt || !lb) throw DriveError("a stamp row answered without its key");
		return make_object({{"runtime", deep_copy(*stamp)},
		                    {"positionFrame", deep_copy(*pf)},
		                    {"belongsTo", deep_copy(*bt)},
		                    {"label", deep_copy(*lb)}});
	}
	if (op == "agentCurie") return c.call("save.village.agentCurie", json_of(input));
	if (op == "timeStateOf") return c.call("save.village.timeStateOf", json_of(input));
	if (op == "totalHoursOf") return c.call("save.village.totalHoursOf", json_of(input));
	if (op == "conversationTimestamp") return c.call("save.village.conversations.timestamp", json_of(input));
	if (op == "conversationEpochMs") return c.call("save.village.conversations.epochMs", json_of(input));
	if (op == "skillKb") {
		ObjectText r;
		r.copy(input, "save");
		r.copy(input, "options");
		auto read = without_message("save.village.read", c.call("save.village.read", r.done()));
		if (!read->get_bool("ok")) return read;
		ObjectText k;
		k.copy(need(input, "save"), "currentState");
		return c.call("skill.kb.loadJson", k.done());
	}
	throw DriveError("op " + op + " is not one of core's village-state ops (save-file-game-state-corpus.ts)");
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

// The code of an answer's refusal (`refusal.code`), or "".
std::string refusal_code(const JsonValuePtr &answer) {
	if (!answer) return {};
	const JsonValue *r = answer->find("refusal");
	return r && r->is_object() ? r->get_string("code") : std::string();
}

void refusal_probes(Caller &c, Probes &p) {
	const std::string W = "\"0123456789abcdef01234567\"";
	const std::string save3 = "{\"worldId\":" + W + ",\"version\":3,\"currentState\":{\"extensions\":{}},\"conversations\":[]}";
	const std::string opts = "{\"worldId\":" + W + ",\"runtime\":\"unreal-village\",\"positionFrame\":\"world-ir-m\",\"tick\":1}";
	// 1. An op this runner does not know fails its case.
	{
		bool refused = false;
		try {
			auto in = insimul::parse_json("{}").root;
			drive(c, "fly", *in);
		} catch (const DriveError &) {
			refused = true;
		}
		p.check(refused, "an unknown op (fly) was driven");
	}
	// 2. A save of another version is core's wrong_version VALUE, on write and on read.
	{
		const std::string v2 = "{\"worldId\":" + W + ",\"version\":2,\"currentState\":{}}";
		auto w = c.try_call("save.village.write", "{\"save\":" + v2 + ",\"gameState\":{\"version\":3},\"options\":" + opts + "}");
		p.check(refusal_code(w) == "wrong_version", "a version-2 save written was not refused wrong_version");
		auto r = c.try_call("save.village.read", "{\"save\":" + v2 + ",\"options\":{\"worldId\":" + W + "}}");
		p.check(refusal_code(r) == "wrong_version", "a version-2 save read was not refused wrong_version");
	}
	// 3. An unregistered extension is core's unregistered_extension VALUE.
	{
		auto r = c.try_call("save.village.check",
		                    "{\"save\":{\"version\":3,\"currentState\":{\"extensions\":{\"bespoke\":1}}}}");
		p.check(refusal_code(r) == "unregistered_extension", "an unregistered extension was not refused");
	}
	// 4. A foreign world, then a foreign runtime, are core's ownership VALUES.
	{
		auto stamped = c.try_call("save.village.write", "{\"save\":" + save3 + ",\"gameState\":{\"version\":3},\"options\":" + opts + "}");
		const bool wrote = stamped && stamped->get_bool("ok");
		p.check(wrote, "a sound save could not be written for the ownership probes");
		if (wrote) {
			auto own = save_with_written(*insimul::parse_json(save3).root, *stamped);
			const std::string s = json_of(*own);
			auto world = c.try_call("save.village.ownership", "{\"save\":" + s + ",\"worldId\":\"fedcba9876543210fedcba98\",\"runtime\":\"unreal-village\"}");
			p.check(refusal_code(world) == "wrong_world", "another world's save was not refused wrong_world");
			auto runtime = c.try_call("save.village.readRuntime", "{\"save\":" + s + ",\"worldId\":" + W + ",\"runtime\":\"bjs-village\"}");
			p.check(refusal_code(runtime) == "wrong_runtime", "another runtime's save was not refused wrong_runtime");
			auto mine = c.try_call("save.village.ownership", "{\"save\":" + s + ",\"worldId\":" + W + ",\"runtime\":\"unreal-village\"}");
			const JsonValue *none = mine ? mine->find("refusal") : nullptr;
			p.check(none && none->is_null(), "the game's own save was refused");
		}
	}
	// 5. What core would dereference unread is the [invalid-input] ERROR.
	{
		auto r = c.try_call("save.village.read", "{\"save\":null,\"options\":{\"worldId\":" + W + "}}");
		p.check(!r && c.last_error.find("[invalid-input]") != std::string::npos, "a null save was not [invalid-input]");
		auto rows = c.try_call("save.village.conversations.rows", "{\"stored\":[],\"records\":[{\"npcId\":\"\"}]}");
		p.check(!rows && c.last_error.find("[invalid-input]") != std::string::npos,
		        "records core cannot read were not [invalid-input]");
	}
	// 6. An unknown row is the method table's error.
	{
		auto r = c.try_call("save.village.fly", "{}");
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
		std::fprintf(stderr, "usage: insimulcore_village_save_corpus [--negative] <conformance/saves/village-state.json>\n");
		return 2;
	}
	const char *tag = negative ? "village_save_corpus --negative" : "village_save_corpus";
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
	const JsonValue *case_list = doc.find("cases");
	const JsonValue *contract = doc.find("contract");
	if (doc.get_string("area") != "saves" || !contract || !contract->is_object() || !contract->find("conversationsRule")) {
		std::fprintf(stderr, "%s: %s is not the village-state corpus (area saves, a contract with conversationsRule)\n", tag, file.c_str());
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
	std::printf("refusals: %d of %d probe(s) refused as core refuses (values: wrong_version, unregistered_extension, "
	            "wrong_world, wrong_runtime; errors: [invalid-input], an unknown row; an unknown op fails its case)\n",
	            probes.passed, probes.total);

	// The contract: every key the row states is the corpus's, equal.
	int contract_keys = 0;
	{
		JsonValuePtr row;
		try {
			row = c.call("save.village.contract", "{}");
		} catch (const DriveError &e) {
			std::printf("  [FAIL] contract: %s\n", e.what());
			failed++;
		}
		if (row) {
			std::set<std::string> stated;
			for (const auto &kv : row->object_items) {
				stated.insert(kv.first);
				const JsonValue *want = contract->find(kv.first);
				if (!want) {
					std::printf("  [FAIL] contract: the row states %s, which the corpus's contract does not\n", kv.first.c_str());
					failed++;
					continue;
				}
				const std::string diff = compare(*want, *kv.second, 0.0, "contract." + kv.first);
				if (!diff.empty()) {
					std::printf("  [FAIL] %s\n", diff.c_str());
					failed++;
					continue;
				}
				contract_keys++;
			}
			int others = 0;
			for (const auto &kv : contract->object_items) {
				if (!stated.count(kv.first)) others++;
			}
			std::printf("contract: %d key(s) save.village.contract states agree with the corpus's; %d other key(s) are "
			            "other blocks' and rules' (their own rows and corpora)\n",
			            contract_keys, others);
		}
	}

	std::map<std::string, int> driven;
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
		}
		driven[op]++;
	}

	// Every op of core's runner is driven by at least one case.
	std::string by_op;
	int undriven = 0;
	for (const char *op : kOps) {
		const int n = driven.count(op) ? driven[op] : 0;
		by_op += (by_op.empty() ? "" : ", ") + std::string(op) + " " + std::to_string(n);
		if (n == 0) {
			std::printf("  [FAIL] op %s: no case of it was driven through the rows\n", op);
			failed++;
			undriven++;
		}
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
	std::printf("village-state: driven %s. %d undriven\n", by_op.c_str(), undriven);
	if (negative) {
		std::printf("%s: %d of %d perturbed case(s) refused, %d accepted, %d failure(s), %.0f ms\n", tag, refused, total,
		            accepted, failed, ms);
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
