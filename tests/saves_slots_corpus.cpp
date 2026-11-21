// saves_slots_corpus.cpp — core's save-slots corpus, driven through libinsimulcore's
// `saves.slots.create` / `saves.slots.apply` session rows and its bare
// `saves.indicator.*` rows.
//
// PL.native-catchup (rulings U83(1), U84, U87). Core's `SaveSlotsSession`
// (src/save-slots.ts, P1.core-slots) is a session row pair of corebridge/js/entry.js.
// This gate holds it to core's own corpus, conformance/saves/slots.json, COPIED
// byte for byte into corebridge/vendor/core/conformance/saves/ at the pin and
// sha256-checked by the `core_vendor` ctest. Nothing here re-writes a case.
// Every config/continue/rows/run answer comes out of a session; the indicator
// cases, which show a bare indicator (PL.native-indicator-row, U132(1)), come out
// of the `saves.indicator.*` rows over core's `ui/save-indicator-model`.
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
//   indicator  {steps}        TWICE, through the bare indicator rows. (1) One
//              row call per step, the host holding the indicator between them as
//              an engine does: the start is `saves.indicator.show { state:
//              "hidden", kind: null }` (core's hidden indicator, as core's runner
//              starts); a step `{show: {state, kind, detail?, slot?}}` is
//              `saves.indicator.show` with those fields, a step `{tick: s}` is
//              `saves.indicator.tick { indicator, dtSec: s }` (null stays null,
//              the non-finite tick); after each, `saves.indicator.view {
//              indicator }` is the step's view. (2) The whole case as ONE
//              `saves.indicator.apply { ops }` (no indicator: the hidden one),
//              `show` ops carrying the show's fields and `tick` ops `dtSec`: its
//              `results` are the views, and its `indicator` must equal (1)'s last
//              exactly (a FAIL otherwise). Both must match `expected.views`.
//
// A case of any op that cannot be driven, or a step that cannot be expressed as
// a row call, FAILS the run: no case goes undriven. The run also fails when the
// table lacks any of the rows, when the file is not the save-slots corpus or
// holds no case, when a declared op goes undriven, when a session is left open,
// and when its comparator cannot tell a wrong answer from a right one (a
// self-test on every start).
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
const char *const kShow = "saves.indicator.show";
const char *const kTick = "saves.indicator.tick";
const char *const kView = "saves.indicator.view";
const char *const kIndicatorApply = "saves.indicator.apply";

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

struct Driven {
	JsonValuePtr actual;  // the case's answer, in its `expected` shape
	JsonValuePtr batch;   // indicator cases: the same answer through one saves.indicator.apply
	std::string batch_held;  // indicator cases: how apply's indicator differs from the rows' last ("" when equal)
};

// An indicator step as a `saves.indicator.apply` op, or "" with `why` set. A
// `show` op carries the show's fields; a `tick` op its seconds as `dtSec`.
std::string indicator_op_of_step(const JsonValue &step, std::string &why) {
	if (!step.is_object() || step.object_items.size() != 1) {
		why = "an indicator step names exactly one of show, tick: " + json_of(step);
		return {};
	}
	const std::string &k = step.object_items[0].first;
	const JsonValue &v = *step.object_items[0].second;
	ObjectText op;
	op.add("op", "\"" + k + "\"");
	if (k == "show") {
		if (!v.is_object() || v.find("op")) {
			why = "a show step the rows cannot take (not an object of show fields): " + json_of(step);
			return {};
		}
		for (const auto &kv : v.object_items) op.add(kv.first, *kv.second);
	} else if (k == "tick") {
		op.add("dtSec", v);
	} else {
		why = "an indicator step this runner does not know: " + json_of(step);
		return {};
	}
	return op.done();
}

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
	if (op == "indicator") {
		const JsonValue *steps = input.find("steps");
		if (!steps || !steps->is_array()) return why = "an indicator case needs steps", false;
		// (1) one row call per step, the indicator held here between calls.
		auto ind = c.call(kShow, "{\"state\":\"hidden\",\"kind\":null}");
		if (!ind) return why = c.error, false;
		std::vector<JsonValuePtr> views;
		std::vector<std::string> ops;
		for (const auto &st : steps->array_items) {
			const std::string o = indicator_op_of_step(*st, why);
			if (o.empty()) return false;
			ops.push_back(o);
			const std::string &k = st->object_items[0].first;
			if (k == "show") {
				ind = c.call(kShow, json_of(*st->object_items[0].second));
			} else {
				ObjectText args;
				args.add("indicator", *ind);
				args.add("dtSec", *st->object_items[0].second);
				ind = c.call(kTick, args.done());
			}
			if (!ind) return why = c.error, false;
			ObjectText vargs;
			vargs.add("indicator", *ind);
			auto view = c.call(kView, vargs.done());
			if (!view) return why = c.error, false;
			views.push_back(view);
		}
		out.actual = make_object({{"views", make_array(std::move(views))}});
		// (2) the whole case as one batch.
		std::string list;
		for (const auto &o : ops) list += (list.empty() ? "" : ",") + o;
		auto b = c.call(kIndicatorApply, "{\"ops\":[" + list + "]}");
		if (!b) return why = c.error, false;
		const JsonValue *results = b->find("results");
		const JsonValue *last = b->find("indicator");
		if (!results || !results->is_array() || !last || !b->find("view")) {
			return why = std::string(kIndicatorApply) + " answered no results, indicator and view", false;
		}
		out.batch_held = compare(*ind, *last, 0.0, "$.indicator");
		out.batch = make_object({{"views", std::make_shared<JsonValue>(*results)}});
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
		for (const char *row : {kCreate, kApply, kShow, kTick, kView, kIndicatorApply}) {
			if (!table.count(row)) {
				std::printf("  [FAIL] surface: the method table has no %s row\n", row);
				failed++;
			}
		}
	}

	std::map<std::string, int> driven;
	int undriven = 0;
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
		Driven d;
		std::string why;
		if (!drive(c, op, *input, d, why)) {
			std::printf("  [FAIL] %s — not driven: %s\n", name.c_str(), why.c_str());
			failed++;
			undriven++;
			continue;
		}
		const std::string diff = compare(*expected, *d.actual, tol, "$");
		const std::string batch_diff = d.batch ? compare(*expected, *d.batch, tol, "$") : std::string();
		if (!diff.empty() || !batch_diff.empty() || !d.batch_held.empty()) {
			if (!diff.empty()) std::printf("  [FAIL] %s — %s%s\n", name.c_str(), d.batch ? "show/tick/view: " : "", diff.c_str());
			if (!batch_diff.empty()) std::printf("  [FAIL] %s — %s: %s\n", name.c_str(), kIndicatorApply, batch_diff.c_str());
			if (!d.batch_held.empty()) {
				std::printf("  [FAIL] %s — %s's indicator is not the rows' last: %s\n", name.c_str(), kIndicatorApply, d.batch_held.c_str());
			}
			failed++;
			continue;
		}
		driven[op]++;
	}

	// Every op the corpus declares is driven.
	const JsonValue *contract = doc.find("contract");
	const JsonValue *ops = contract ? contract->find("ops") : nullptr;
	if (!ops || !ops->is_array() || ops->size() == 0) {
		std::printf("  [FAIL] %s — declares no contract.ops\n", file.c_str());
		failed++;
	} else {
		for (const auto &o : ops->array_items) {
			const std::string name = o->as_string();
			if (!driven.count(name)) {
				std::printf("  [FAIL] op %s is declared but no case of it was driven through the rows\n", name.c_str());
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
	std::printf("saves_slots_corpus: %zu case(s): %d driven through the rows (%s), %d undriven, %d failed, %.0f ms\n",
	            case_list->size(), total_driven, by_op.c_str(), undriven, failed, ms);
	if (failed || undriven || total_driven == 0) {
		std::printf("saves_slots_corpus: FAIL\n");
		return 1;
	}
	std::printf("saves_slots_corpus: PASS\n");
	return 0;
}
