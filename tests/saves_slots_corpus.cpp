// saves_slots_corpus.cpp — core's save-slots corpus, driven through libinsimulcore's
// `saves.slots.create` / `saves.slots.apply` session rows.
//
// PL.native-catchup (rulings U83(1), U84, U87). Core's `SaveSlotsSession`
// (src/save-slots.ts, P1.core-slots) is a session row pair of corebridge/js/entry.js.
// This gate holds it to core's own corpus, conformance/saves/slots.json, COPIED
// byte for byte into corebridge/vendor/core/conformance/saves/ at the pin and
// sha256-checked by the `core_vendor` ctest. Nothing here re-writes a case, and
// nothing here calls a stateless helper: every answer comes out of a session.
//
// How each op of the corpus (its `contract.ops`) is driven:
//
//   run        {init, steps}  `saves.slots.create` with `init` (its `view` is the
//              case's `start`), then ONE `saves.slots.apply` per step, so the view
//              after every step is the session's own. A step `{save: i}` is the op
//              `{op: "save", slot: i}`; likewise `load`/`delete`/`ask_delete`
//              (`slot`), `key` (`code`), `tick` (`delta`; null stays null, the
//              non-finite tick), `disk_changed` (`slots`: the new listing, null
//              stays null; PL.disk-changed-step), `continue`/`confirm_delete`/
//              `cancel_delete` (no field) and `finished` (its object's fields, spread).
//   config     {config}       `saves.slots.create { config }`: its answer's
//              `config` is core's `resolveSaveSlotsConfig`, the session's own.
//   continue   {slots, slotCount}  `saves.slots.create { config: { slotCount,
//              quickSlot: null }, slots }`: the view's `continueSlot` (no quick
//              slot, so the session's table is exactly `slotCount` slots, as core's
//              `continueSlot(slots, slotCount)` reads them). Only when `slotCount` is a
//              positive integer (it then resolves to itself); otherwise the case
//              cannot be driven and the run FAILS.
//   rows       {slots, config, activeSlot, busy}  `saves.slots.create { config,
//              slots, activeSlot }`: the view's `rows`. `busy: true` is a session
//              with an operation running: one `save` of slot 0 (every slot count
//              has one) is applied first and must be accepted; a pending save
//              changes no slot and no active slot, only `busy`.
//   indicator  {steps}        NOT DRIVEN, with a measured reason per case: the op
//              shows ANY state with ANY kind and detail on a bare indicator
//              (core's `showSaveIndicator`), and the session shows the indicator
//              only through its own steps. The reason printed for each case
//              counts how many of its views the session itself produced in the
//              run cases above (compared by the same rule), and names the views
//              it never reached.
//
// A case of any other op, or a run step that cannot be expressed as an op, FAILS
// the run: only the indicator op may go undriven. The run also fails when the
// table lacks either row, when the file is not the save-slots corpus or holds no
// case, when a declared op is neither driven nor (indicator) reasoned, when a
// session is left open, and when its comparator cannot tell a wrong answer from a
// right one (a self-test on every start).
//
// Comparison is the corpus's own rule (core's `compareVillageState`): numbers
// within the file's `tolerance`, everything else exactly, object key sets
// included.
//
// A pure consumer of insimulcore.h (no quickjs.h, no insimul.h). The JSON reader
// is tests/radiant/json_value.{h,cpp}, used as is.
//
// usage: insimulcore_saves_slots <slots.json>

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

const char *const kCreate = "saves.slots.create";
const char *const kApply = "saves.slots.apply";

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

// ── writing JSON (the row's args) ─────────────────────────────────────────────

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

// The comparator is the gate; it must be able to fail.
bool self_test() {
	auto parse = [](const char *t) { return insimul::parse_json(t).root; };
	struct Probe {
		const char *expected, *actual;
		bool agree;
	} probes[] = {
	    {"{\"a\":1,\"b\":[true,\"x\"]}", "{\"b\":[true,\"x\"],\"a\":1.0}", true},
	    {"{\"a\":0.3}", "{\"a\":0.30000000000000004}", true},
	    {"{\"a\":1}", "{\"a\":1.000001}", false},
	    {"{\"ok\":false,\"refusal\":\"busy\",\"effect\":null}", "{\"ok\":false,\"refusal\":\"slot_empty\",\"effect\":null}", false},
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
	return ok;
}

// ── calling the rows ──────────────────────────────────────────────────────────

struct Caller {
	insimul_core *core;
	std::string error;

	// The parsed answer, or nullptr with `error` set.
	JsonValuePtr call(const char *method, const std::string &args) {
		const char *raw = insimul_core_call(core, method, args.c_str());
		if (!raw) {
			error = std::string(method) + " failed: " + insimul_core_last_error(core);
			return nullptr;
		}
		auto parsed = insimul::parse_json(raw);
		if (!parsed.ok || !parsed.root->is_object()) {
			error = std::string(method) + " answered something that is not a JSON object";
			return nullptr;
		}
		return parsed.root;
	}

	// `saves.slots.create` → its answer; the handle in `session` (raw JSON).
	JsonValuePtr create(const std::string &args, std::string &session) {
		auto r = call(kCreate, args);
		if (!r) return nullptr;
		const JsonValue *s = r->find("session");
		if (!s || !s->is_number() || !r->find("view") || !r->find("config")) {
			error = std::string(kCreate) + " answered no session, config or view";
			return nullptr;
		}
		session = s->raw_number;
		return r;
	}

	// One op through `saves.slots.apply`; the answer is `{ results: [r], view }`.
	JsonValuePtr apply(const std::string &session, const std::string &op) {
		ObjectText args;
		args.add("session", session);
		args.add("ops", "[" + op + "]");
		auto r = call(kApply, args.done());
		if (!r) return nullptr;
		const JsonValue *results = r->find("results");
		if (!results || !results->is_array() || results->size() != 1 || !r->find("view")) {
			error = std::string(kApply) + " answered no single result and view";
			return nullptr;
		}
		return r;
	}

	void dispose(const std::string &session) {
		insimul_core_call(core, "session.dispose", ("{\"session\":" + session + "}").c_str());
	}
};

// A corpus step as a `saves.slots.apply` op, or "" with `why` set.
std::string op_of_step(const JsonValue &step, std::string &why) {
	if (!step.is_object() || step.object_items.size() != 1) {
		why = "a step names exactly one step: " + json_of(step);
		return {};
	}
	const std::string &k = step.object_items[0].first;
	const JsonValue &v = *step.object_items[0].second;
	ObjectText op;
	op.add("op", "\"" + k + "\"");
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
			why = "a finished step the row cannot take (not an object with a boolean ok): " + json_of(step);
			return {};
		}
		for (const auto &kv : v.object_items) op.add(kv.first, *kv.second);
	} else {
		why = "a step this runner does not know: " + json_of(step);
		return {};
	}
	return op.done();
}

// The member `key` of `obj` as raw JSON, or `null`.
std::string member_json(const JsonValue &obj, const char *key) {
	const JsonValue *v = obj.find(key);
	return v ? json_of(*v) : std::string("null");
}

struct Driven {
	JsonValuePtr actual;           // the case's answer, in its `expected` shape
	std::vector<JsonValuePtr> indicators;  // every indicator view the session showed (run cases)
};

// Drive one case through the session rows. False with `why` when it cannot be
// driven or a call failed.
bool drive(Caller &c, const std::string &op, const JsonValue &input, Driven &out, std::string &why) {
	std::string session;
	if (op == "config") {
		ObjectText args;
		if (input.find("config")) args.add("config", *input.find("config"));
		auto r = c.create(args.done(), session);
		if (!r) return why = c.error, false;
		c.dispose(session);
		out.actual = make_object({{"config", std::make_shared<JsonValue>(*r->find("config"))}});
		return true;
	}
	if (op == "continue") {
		const JsonValue *n = input.find("slotCount");
		if (!n || !n->is_number() || n->number_value < 1 || std::floor(n->number_value) != n->number_value) {
			why = "slotCount is not a positive integer, so no session config resolves to it";
			return false;
		}
		// core's `continue` op is `continueSlot(slots, slotCount)` over exactly
		// `slotCount` slots. A session's table holds the dedicated quick slot too
		// (index slotCount, the default since core's PL.quick-slot), so the session
		// is opened with no quick slot: its table is then exactly those slots.
		ObjectText config;
		config.add("slotCount", *n);
		config.add("quickSlot", "null");
		ObjectText args;
		args.add("config", config.done());
		if (input.find("slots")) args.add("slots", *input.find("slots"));
		auto r = c.create(args.done(), session);
		if (!r) return why = c.error, false;
		c.dispose(session);
		const JsonValue *slot = r->find("view")->find("continueSlot");
		if (!slot) return why = "the view has no continueSlot", false;
		out.actual = make_object({{"slot", std::make_shared<JsonValue>(*slot)}});
		return true;
	}
	if (op == "rows") {
		ObjectText args;
		for (const char *k : {"config", "slots", "activeSlot"}) {
			if (input.find(k)) args.add(k, *input.find(k));
		}
		auto r = c.create(args.done(), session);
		if (!r) return why = c.error, false;
		JsonValuePtr view = std::make_shared<JsonValue>(*r->find("view"));
		const JsonValue *busy = input.find("busy");
		if (busy && busy->type == JsonType::Bool && busy->bool_value) {
			auto a = c.apply(session, "{\"op\":\"save\",\"slot\":0}");
			if (!a) {
				c.dispose(session);
				return why = c.error, false;
			}
			if (!a->find("results")->array_items[0]->get_bool("ok")) {
				c.dispose(session);
				return why = "the save that makes the session busy was refused", false;
			}
			view = std::make_shared<JsonValue>(*a->find("view"));
		}
		c.dispose(session);
		const JsonValue *rows = view->find("rows");
		if (!rows) return why = "the view has no rows", false;
		out.actual = make_object({{"rows", std::make_shared<JsonValue>(*rows)}});
		return true;
	}
	if (op == "run") {
		const JsonValue *init = input.find("init");
		const JsonValue *steps = input.find("steps");
		if (!steps || !steps->is_array()) return why = "a run case needs steps", false;
		if (init && !init->is_object()) return why = "a run case's init is not an object", false;
		auto r = c.create(init ? json_of(*init) : std::string("{}"), session);
		if (!r) return why = c.error, false;
		JsonValuePtr start = std::make_shared<JsonValue>(*r->find("view"));
		if (start->find("indicator")) out.indicators.push_back(std::make_shared<JsonValue>(*start->find("indicator")));
		std::vector<JsonValuePtr> answers;
		for (const auto &st : steps->array_items) {
			const std::string o = op_of_step(*st, why);
			if (o.empty()) {
				c.dispose(session);
				return false;
			}
			auto a = c.apply(session, o);
			if (!a) {
				c.dispose(session);
				return why = c.error, false;
			}
			auto view = std::make_shared<JsonValue>(*a->find("view"));
			if (view->find("indicator")) out.indicators.push_back(std::make_shared<JsonValue>(*view->find("indicator")));
			answers.push_back(make_object({{"result", a->find("results")->array_items[0]}, {"view", view}}));
		}
		c.dispose(session);
		out.actual = make_object({{"start", start}, {"steps", make_array(std::move(answers))}});
		return true;
	}
	why = "op " + op + " is not one this runner drives through the session";
	return false;
}

} // namespace

int main(int argc, char **argv) {
	if (argc != 2) {
		std::fprintf(stderr, "usage: insimulcore_saves_slots <conformance/saves/slots.json>\n");
		return 2;
	}
	if (!self_test()) {
		std::fprintf(stderr, "saves_slots_corpus: the comparator cannot tell a wrong answer from a right one\n");
		return 2;
	}
	const std::string file = argv[1];
	bool read_ok = false;
	const std::string text = read_file(file, read_ok);
	auto parsed = insimul::parse_json(text);
	if (!read_ok || !parsed.ok || !parsed.root->is_object()) {
		std::fprintf(stderr, "saves_slots_corpus: cannot read %s: %s\n", file.c_str(), parsed.error.c_str());
		return 2;
	}
	const JsonValue &doc = *parsed.root;
	if (doc.get_string("area") != "saves-slots") {
		std::fprintf(stderr, "saves_slots_corpus: %s is not the save-slots corpus (area saves-slots)\n", file.c_str());
		return 2;
	}
	const JsonValue *case_list = doc.find("cases");
	if (!case_list || !case_list->is_array() || case_list->size() == 0) {
		std::fprintf(stderr, "saves_slots_corpus: %s holds no case\n", file.c_str());
		return 2;
	}
	const JsonValue *tol_v = doc.find("tolerance");
	const double tol = tol_v && tol_v->is_number() ? tol_v->number_value : 0.0;

	insimul_core *core = insimul_core_create();
	if (!core) {
		std::fprintf(stderr, "saves_slots_corpus: insimul_core_create() failed\n");
		return 2;
	}
	std::printf("saves_slots_corpus: %s\n", insimul_core_version());
	Caller c{core, {}};

	int failed = 0;
	// The surface: a missing row would otherwise show only as every case failing.
	{
		std::set<std::string> table;
		auto m = c.call("core.methods", "{}");
		const JsonValue *list = m ? m->find("methods") : nullptr;
		if (list && list->is_array()) {
			for (const auto &x : list->array_items) table.insert(x->as_string());
		}
		for (const char *row : {kCreate, kApply}) {
			if (!table.count(row)) {
				std::printf("  [FAIL] surface: the method table has no %s row\n", row);
				failed++;
			}
		}
	}

	std::map<std::string, int> driven, reasoned;
	std::vector<std::pair<std::string, JsonValuePtr>> indicator_cases;  // name, expected
	std::vector<JsonValuePtr> session_indicators;
	const auto t0 = std::chrono::steady_clock::now();
	for (const auto &cp : case_list->array_items) {
		const JsonValue &cs = *cp;
		const std::string name = cs.get_string("name");
		const std::string op = cs.get_string("op");
		const JsonValue *input = cs.find("input");
		const JsonValue *expected = cs.find("expected");
		if (!input || !input->is_object() || !expected) {
			std::printf("  [FAIL] %s — needs an input object and an expected answer\n", name.c_str());
			failed++;
			continue;
		}
		if (op == "indicator") {
			indicator_cases.emplace_back(name, cp->find("expected") ? std::make_shared<JsonValue>(*expected) : nullptr);
			reasoned[op]++;
			continue;
		}
		Driven d;
		std::string why;
		if (!drive(c, op, *input, d, why)) {
			std::printf("  [FAIL] %s — not driven: %s\n", name.c_str(), why.c_str());
			failed++;
			continue;
		}
		const std::string diff = compare(*expected, *d.actual, tol, "$");
		if (!diff.empty()) {
			std::printf("  [FAIL] %s — %s\n", name.c_str(), diff.c_str());
			failed++;
			continue;
		}
		driven[op]++;
		for (auto &v : d.indicators) session_indicators.push_back(v);
	}

	// The indicator cases: a measured reason each (see the top of this file).
	for (const auto &ic : indicator_cases) {
		const JsonValue *views = ic.second ? ic.second->find("views") : nullptr;
		if (!views || !views->is_array()) {
			std::printf("  [FAIL] %s — an indicator case with no expected views\n", ic.first.c_str());
			failed++;
			continue;
		}
		int reached = 0;
		std::set<std::string> unreached;
		for (const auto &v : views->array_items) {
			bool seen = false;
			for (const auto &s : session_indicators) {
				if (compare(*v, *s, tol, "$").empty()) {
					seen = true;
					break;
				}
			}
			if (seen) {
				reached++;
			} else {
				unreached.insert(v->get_string("state") + "/" + member_json(*v, "kind") + "/opacity " +
				                 member_json(*v, "opacity") + (v->get_string("detail").empty() ? "" : "/detail"));
			}
		}
		std::string list;
		for (const auto &u : unreached) list += (list.empty() ? "" : ", ") + u;
		std::printf("  [skip] %s — not driven: op indicator shows any state, kind and detail on a bare indicator "
		            "(showSaveIndicator), which no session step does; %d of its %zu view(s) are views the session "
		            "itself showed in the run cases%s%s\n",
		            ic.first.c_str(), reached, views->size(), unreached.empty() ? "" : "; never reached: ", list.c_str());
	}

	// Every op the corpus declares is driven or (indicator only) reasoned.
	const JsonValue *contract = doc.find("contract");
	const JsonValue *ops = contract ? contract->find("ops") : nullptr;
	if (!ops || !ops->is_array() || ops->size() == 0) {
		std::printf("  [FAIL] %s — declares no contract.ops\n", file.c_str());
		failed++;
	} else {
		for (const auto &o : ops->array_items) {
			const std::string name = o->as_string();
			if (!driven.count(name) && !(name == "indicator" && reasoned.count(name))) {
				std::printf("  [FAIL] op %s is declared but no case of it was driven through the session\n", name.c_str());
				failed++;
			}
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
	int total_driven = 0;
	std::string by_op;
	for (const auto &kv : driven) {
		total_driven += kv.second;
		by_op += (by_op.empty() ? "" : ", ") + kv.first + " " + std::to_string(kv.second);
	}
	std::printf("saves_slots_corpus: %zu case(s): %d driven through the session (%s), %zu indicator case(s) not "
	            "driven (reasons above), %d failed, %.0f ms\n",
	            case_list->size(), total_driven, by_op.c_str(), indicator_cases.size(), failed, ms);
	if (failed || total_driven == 0) {
		std::printf("saves_slots_corpus: FAIL\n");
		return 1;
	}
	std::printf("saves_slots_corpus: PASS\n");
	return 0;
}
