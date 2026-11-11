// props_corpus.cpp — core's P6 corpora, driven through libinsimulcore's
// `props.*` and `inventory.*` rows, and core's movement contract corpus through
// its `camera.movement.*` rows.
//
// PL.native-props-rows (rulings U89(2) and U36). Core's P6 logic (P6.core,
// src/props/{containers,documents,doors,notice-board}.ts, src/ui/inventory-model.ts
// and game-engine/logic/NoticeGenerator.ts) is a set of rows of
// corebridge/js/entry.js. This gate holds them to core's own corpora,
// COPIED byte for byte into corebridge/vendor/core/conformance/ at the pin and
// sha256-checked by the `core_vendor` ctest:
//
//   props/containers.json    area props-containers   view, unlock, move, at, respawn
//   props/documents.json     area props-documents    document, paginate, read
//   props/doors.json         area props-doors        door, prompt, session
//   props/notice-board.json  area props-notice-board board, generate
//   ui/inventory-cases.json  area ui-inventory       inventory
//   props/pickup-placement.json  area props-pickup-placement
//                                pattern, ring, clearance, settle, sequence
//                                (PL.native-pickup-settle, U91(2): core's
//                                PL.pickup-placement, src/props/pickup-placement.ts)
//   props/interactables.json     area props-interactables
//                                noun, meanings, host, interact, target
//                                (PL.native-interact-target, U94(3): core's
//                                PL.examine-props, src/props/interactables.ts)
//   camera/movement.json         area camera-movement
//                                occluders, sideView, buildingSolid, move,
//                                slope, slopeAtRest, step
//                                (PL.native-camera-movement, U95(5): core's
//                                PL.movement-contract and PL.movement-followups,
//                                src/camera/movement-contract.ts)
//
// Nothing here re-writes a case or computes an answer: every answer comes out of
// a row. How each op is driven (core's runner, src/props/props-corpus.ts, is the
// reference):
//
//   containers view/unlock/move/at/respawn, documents document/paginate, doors
//   door/prompt: the case's `input` is the row's args AS IS, and the row's answer
//   is compared whole (`props.containers.<op>`, `props.documents.<op>`,
//   `props.doors.<op>`).
//   documents read {document, options?, open?, steps}: `props.reader.create` (a
//   refusal VALUE `{ok: false, refusal}` is the answer; no session opens), then
//   ONE `props.reader.apply` per step → `{initial, steps: [{result, view}]}`.
//   notice-board board {notices, fluency?, read?, answered?, questStatus?, steps}:
//   `props.board.create`, then one `props.board.apply` per step, the same shape.
//   notice-board generate {settlementId, settlementName, npcs}:
//   `props.notices.generate`; core's runner records each article projected to
//   {id, title, titleTranslation, noticeType, difficulty, readingXp, documentType,
//   author, settlementId, questHook, vocabularyWords: <count>, question:
//   <comprehensionQuestion present>} — that projection is the corpus's, made here
//   from the row's full articles (an absent field stays absent).
//   doors session {buildings, inside?, playerItemIds?, steps}: the host's side of
//   a door, as core's runner keeps it — a `prompt` step is `props.doors.prompt`
//   with the player at its position and `inside` → `{prompt}`; any other step is
//   `props.doors.step` with the step as `action` → `{result, inside}`, `inside`
//   moving to the result's when it is ok.
//   ui-inventory inventory {player?, steps}: `inventory.create`, then one
//   `inventory.apply` per step → `{initial, steps: [{result, state}]}` (`state` is
//   the session's view, which is the snapshot core's corpus records).
//   props-pickup-placement pattern/ring/clearance/settle/sequence: the case's
//   `input` is the row's args AS IS (`props.pickups.<op>`), in core's metres on
//   its ground plane (x, z) — a footprint's `axis` included, never mirrored — and
//   the row's answer is compared whole: `clearance`'s `ok` before its numbers, a
//   refusal (`bad-spot`, `no-clear-spot`) as the value core answers. The file's
//   top-level `numerics` must be stated and name double precision (the rows run
//   in QuickJS, whose numbers are IEEE-754 doubles, and several cases decide
//   exactly on a boundary). Its `contract.constants` states each value as
//   `{value, source}`; the `source` line is prose, so that table is held to
//   `props.contract` on its values (a projection this runner self-tests), and
//   `contract.frames` — how each engine maps its frame onto core's (x, z) — is
//   held to it as core states it.
//   props-interactables (the rows are one core function each, over ONE prop or
//   one stand; core's runner, `runMeanings`/`runTarget`, walks the case's lists
//   and composes the board, and so does this one, the same way):
//     the board: the case's `board` when it states one (null included), else,
//     given a `settlement`, `{host, name}` with `host` from
//     `props.interactables.host {props, settlement}` and `name` the settlement's
//     (null when it states none), else null.
//     noun {archetypes}: `props.interactables.noun {archetype}` per entry →
//     `{nouns}`.
//     meanings {props, board? | settlement?}: `props.interactables.meaning {prop,
//     board}` per prop → `{board, meanings, count}`, `count` being how many
//     meanings have each action (`not_offered` for none) — the corpus's
//     projection, made here from the rows' meanings and self-tested.
//     host {props, settlement}: the input AS IS through `props.interactables.host`.
//     interact {props | prop, board? | settlement?}: `props.interactables.interact
//     {prop, board}` per prop → `{results: [{id, ...answer}]}`.
//     target {at, …, board? | settlement?, ranges?, stands?}: the input less
//     `settlement`, `ranges` and `stands`, with the board and `ranges`, through
//     `props.interactables.target`; with `stands`, once per stand with the
//     stand's fields over the input's and its `at` → `{board, stands: [{at,
//     ...answer}]}`.
//   camera-movement occluders/sideView/buildingSolid/move/slope/slopeAtRest/step:
//   the case's `input` is the row's args AS IS (`camera.movement.<op>`), in core's
//   metres in the IR's world frame, and the row's answer is compared whole (a
//   refusal `{error}` is the value core answers). The file's `order` rule
//   ("answers do not depend on the order of solids or exclude") is driven as
//   core's runner drives it (`checkMovementCase`): every case is run a second time
//   with `solids` and `exclude` reversed (`reversed_lists`, self-tested), and that
//   answer must equal `expected` too. Its contract tables are held to
//   `camera.movement.contract`, not `props.contract`.
//
// Each file's `contract` tables (the data ones) are held to its area's contract
// row (`props.contract`, or the area's own) for its area: every table the row
// states must equal the file's. The run
// FAILS on a case whose op is not one of its area's, on an op of the area that no
// case drives, on a row missing from the method table, on a session left open,
// on a file of an unknown area, and when its comparator cannot fail (a self-test
// on every start). Comparison is the corpora's own rule (core's
// `compareVillageState`): numbers within the file's `tolerance`, everything else
// exactly, object key sets included.
//
// A pure consumer of insimulcore.h (no quickjs.h, no insimul.h). The JSON reader
// is tests/radiant/json_value.{h,cpp}, used as is.
//
// usage: insimulcore_props_corpus <corpus.json>...

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

JsonValuePtr make_bool(bool b) {
	auto v = std::make_shared<JsonValue>();
	v->type = JsonType::Bool;
	v->bool_value = b;
	return v;
}

JsonValuePtr make_count(std::size_t n) {
	auto v = std::make_shared<JsonValue>();
	v->type = JsonType::Number;
	v->number_value = static_cast<double>(n);
	v->raw_number = std::to_string(n);
	return v;
}

JsonValuePtr copy_of(const JsonValue &v) { return std::make_shared<JsonValue>(v); }

// JavaScript's `!!value` over a JSON value.
bool truthy(const JsonValue *v) {
	if (!v) return false;
	switch (v->type) {
	case JsonType::Null: return false;
	case JsonType::Bool: return v->bool_value;
	case JsonType::Number: return v->number_value != 0 && !std::isnan(v->number_value);
	case JsonType::String: return !v->string_value.empty();
	case JsonType::Array:
	case JsonType::Object: return true;
	}
	return false;
}

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

JsonValuePtr projected_article(const JsonValue &a, std::string &why);
JsonValuePtr meaning_counts(const std::vector<JsonValuePtr> &meanings, std::string &why);
JsonValuePtr spread(const JsonValue &base, const JsonValue &over);
JsonValuePtr reversed_lists(const JsonValue &input, bool &changed);

// A `{ <key>: { value, source } }` table as `{ <key>: value }` (the `source` line is
// prose); nullptr with `why` when it is not an object or an entry states no value.
JsonValuePtr projected_values(const JsonValue &table, std::string &why) {
	if (!table.is_object()) {
		why = "is not an object";
		return nullptr;
	}
	std::vector<std::pair<std::string, JsonValuePtr>> items;
	for (const auto &kv : table.object_items) {
		const JsonValue *v = kv.second->is_object() ? kv.second->find("value") : nullptr;
		if (!v) {
			why = "entry '" + kv.first + "' states no value";
			return nullptr;
		}
		items.emplace_back(kv.first, copy_of(*v));
	}
	return make_object(std::move(items));
}

// The file's `numerics` (empty when absent or not a string) and whether it names double precision.
bool numerics_double(const JsonValue &doc, std::string &stated) {
	const JsonValue *n = doc.find("numerics");
	stated = n && n->type == JsonType::String ? n->string_value : std::string();
	return stated.find("double precision") != std::string::npos;
}

// The comparator (and the one projection this runner makes) is the gate; it must be able to fail.
bool self_test() {
	auto parse = [](const char *t) { return insimul::parse_json(t).root; };
	struct Probe {
		const char *expected, *actual;
		bool agree;
	} probes[] = {
	    {"{\"a\":1,\"b\":[true,\"x\"]}", "{\"b\":[true,\"x\"],\"a\":1.0}", true},
	    {"{\"a\":0.3}", "{\"a\":0.30000000000000004}", true},
	    {"{\"a\":1}", "{\"a\":1.000001}", false},
	    {"{\"ok\":false,\"refusal\":{\"code\":\"locked\",\"field\":\"building\"}}",
	     "{\"ok\":false,\"refusal\":{\"code\":\"no_interior\",\"field\":\"building\"}}", false},
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
	// The generate projection: `question` is `!!comprehensionQuestion`, absent or null is false.
	struct Article {
		const char *json;
		bool question;
	} articles[] = {
	    {"{\"vocabularyWords\":[1,2],\"comprehensionQuestion\":{\"q\":1}}", true},
	    {"{\"vocabularyWords\":[],\"comprehensionQuestion\":null}", false},
	    {"{\"vocabularyWords\":[]}", false},
	};
	for (const Article &a : articles) {
		std::string why;
		auto v = parse(a.json);
		auto p = v ? projected_article(*v, why) : nullptr;
		const JsonValue *q = p ? p->find("question") : nullptr;
		if (!q || q->type != JsonType::Bool || q->bool_value != a.question) {
			std::printf("  [FAIL] projection self-test: %s should project question %s\n", a.json, a.question ? "true" : "false");
			ok = false;
		}
	}
	// The values projection: it keeps every key and each value, and refuses an entry with none.
	{
		std::string why;
		auto t = parse("{\"a\":{\"value\":1,\"source\":\"x\"},\"b\":{\"value\":[0.6,1.5],\"source\":\"y\"}}");
		auto p = t ? projected_values(*t, why) : nullptr;
		auto want = parse("{\"a\":1,\"b\":[0.6,1.5]}");
		if (!p || compare(*want, *p, 0.0, "$") != "") {
			std::printf("  [FAIL] values projection self-test: {a:{value:1},b:{value:[0.6,1.5]}} should project to {a:1,b:[0.6,1.5]}\n");
			ok = false;
		}
		auto bad = parse("{\"a\":{\"source\":\"x\"}}");
		if (bad && projected_values(*bad, why)) {
			std::printf("  [FAIL] values projection self-test: an entry with no value should be refused\n");
			ok = false;
		}
		std::string stated;
		auto with = parse("{\"numerics\":\"Runners compute in IEEE-754 double precision.\"}");
		auto without = parse("{\"numerics\":\"float32 is fine\"}");
		if (!with || !numerics_double(*with, stated) || !without || numerics_double(*without, stated)) {
			std::printf("  [FAIL] numerics self-test: only a numerics naming double precision should pass\n");
			ok = false;
		}
	}
	// The interactables projections: `count` per action (null is not_offered), and `{...base, ...over}`.
	{
		std::string why;
		std::vector<JsonValuePtr> ms = {parse("{\"action\":\"read_sign\"}"), parse("{\"action\":null}"),
		                                parse("{\"action\":\"read_sign\"}"), parse("{\"action\":\"examine\"}")};
		auto got = meaning_counts(ms, why);
		auto want = parse("{\"read_sign\":2,\"not_offered\":1,\"examine\":1}");
		if (!got || compare(*want, *got, 0.0, "$") != "") {
			std::printf("  [FAIL] count self-test: read_sign, null, read_sign, examine should count {read_sign 2, not_offered 1, examine 1}\n");
			ok = false;
		}
		std::vector<JsonValuePtr> bad = {parse("{\"id\":\"x\"}")};
		if (meaning_counts(bad, why)) {
			std::printf("  [FAIL] count self-test: a meaning with no action should be refused\n");
			ok = false;
		}
		auto base = parse("{\"at\":{\"x\":0},\"board\":null,\"props\":[1]}");
		auto over = parse("{\"at\":{\"x\":1},\"villager\":{\"id\":\"v\"}}");
		auto merged = spread(*base, *over);
		auto want2 = parse("{\"at\":{\"x\":1},\"board\":null,\"props\":[1],\"villager\":{\"id\":\"v\"}}");
		if (!merged || compare(*want2, *merged, 0.0, "$") != "") {
			std::printf("  [FAIL] spread self-test: a stand's fields should lie over the input's\n");
			ok = false;
		}
	}
	// The movement order projection: `solids` and `exclude` reversed, every other key kept as is.
	{
		bool changed = false;
		auto in = parse("{\"mode\":\"side_scroll\",\"solids\":[{\"id\":\"a\"},{\"id\":\"b\"}],\"exclude\":[\"p\",\"q\"],\"feet\":[1,2]}");
		auto got = in ? reversed_lists(*in, changed) : nullptr;
		auto want = parse("{\"mode\":\"side_scroll\",\"solids\":[{\"id\":\"b\"},{\"id\":\"a\"}],\"exclude\":[\"q\",\"p\"],\"feet\":[1,2]}");
		if (!got || !changed || compare(*want, *got, 0.0, "$") != "") {
			std::printf("  [FAIL] order self-test: solids [a, b] and exclude [p, q] should reverse, and nothing else\n");
			ok = false;
		}
		bool none = true;
		auto plain_in = parse("{\"slopeDeg\":15}");
		if (!plain_in || !reversed_lists(*plain_in, none) || none) {
			std::printf("  [FAIL] order self-test: an input with no list should report nothing reversed\n");
			ok = false;
		}
	}
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

// ── the areas: their ops and the rows each op is driven through ───────────────

struct Area {
	const char *name;
	std::vector<std::string> ops;     // core's PROPS_CORPUS_OPS for the area
	std::vector<std::string> rows;    // the rows its cases go through
	std::vector<std::string> tables;  // the data tables of its contract props.contract must state
	// Tables the file states as `{ <key>: { value, source } }`: held to props.contract on each value.
	std::vector<std::string> valued_tables = {};
	// The file must state its top-level `numerics`, naming double precision.
	bool numerics = false;
	// The row whose answer holds the area's contract tables, keyed by the area.
	const char *contract_row = "props.contract";
	// Every case is driven again with `solids` and `exclude` reversed (the file's `order` rule).
	bool reverse_lists = false;
};

const std::vector<Area> &areas() {
	static const std::vector<Area> all = {
	    {"props-containers",
	     {"view", "unlock", "move", "at", "respawn"},
	     {"props.containers.view", "props.containers.unlock", "props.containers.move", "props.containers.at",
	      "props.containers.respawn", "props.contract"},
	     {"defaultCapacity", "states", "refusals", "unlockResults"}},
	    {"props-documents",
	     {"document", "paginate", "read"},
	     {"props.documents.document", "props.documents.paginate", "props.reader.create", "props.reader.apply",
	      "props.contract"},
	     {"kinds", "refusals", "defaultCharsPerPage", "quizXp", "defaultQuizXp", "phases", "actions"}},
	    {"props-doors",
	     {"door", "prompt", "session"},
	     {"props.doors.door", "props.doors.prompt", "props.doors.step", "props.contract"},
	     {"states", "actions", "refusals", "promptRadiusM", "standoffM"}},
	    {"props-notice-board",
	     {"board", "generate"},
	     {"props.board.create", "props.board.apply", "props.notices.generate", "props.contract"},
	     {"fluencyThresholds", "hookStates", "actions", "refusals"}},
	    {"ui-inventory",
	     {"inventory"},
	     {"inventory.create", "inventory.apply", "props.contract"},
	     {"filters", "usableTypes", "slotLabels", "rarityColors", "rarityOrder", "typeColors", "defaultTypeColor",
	      "equippedNameColor", "plainBorder", "pinnedGroup", "emptyMessages"}},
	    {"props-pickup-placement",
	     {"pattern", "ring", "clearance", "settle", "sequence"},
	     {"props.pickups.pattern", "props.pickups.ring", "props.pickups.clearance", "props.pickups.settle",
	      "props.pickups.sequence", "props.contract"},
	     {"frames", "obstacleKinds", "clearanceKinds", "staticKinds", "refusals", "clearanceM", "search", "constants",
	      "groundKinds", "plantEntityKinds", "plantArchetypeMarks", "deviations"},
	     {"constants"},
	     true},
	    {"props-interactables",
	     {"noun", "meanings", "host", "interact", "target"},
	     {"props.interactables.noun", "props.interactables.meaning", "props.interactables.host",
	      "props.interactables.interact", "props.interactables.target", "props.contract"},
	     {"propActions", "actions", "actionTier", "lookTier", "notOffered", "notOfferedReasons", "signArchetypes",
	      "rangesM", "doorPromptRadiusM", "refusals", "deviations"}},
	    {"camera-movement",
	     {"occluders", "sideView", "buildingSolid", "move", "slope", "slopeAtRest", "step"},
	     {"camera.movement.occluders", "camera.movement.sideView", "camera.movement.buildingSolid",
	      "camera.movement.move", "camera.movement.slope", "camera.movement.slopeAtRest", "camera.movement.step",
	      "camera.movement.contract"},
	     {"modes", "storeyM", "gait", "ground"},
	     {},
	     false,
	     "camera.movement.contract",
	     true},
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

	// ONE op through `<area>.apply`: `{ results: [r], view }`.
	JsonValuePtr apply(const std::string &method, const std::string &session, const JsonValue &op) {
		ObjectText args;
		args.add("session", session);
		args.add("ops", "[" + json_of(op) + "]");
		auto r = call(method, args.done());
		if (!r) return nullptr;
		const JsonValue *results = r->find("results");
		if (!results || !results->is_array() || results->size() != 1 || !r->find("view")) {
			error = method + " answered no single result and view";
			return nullptr;
		}
		return r;
	}

	void dispose(const std::string &session) {
		insimul_core_call(core, "session.dispose", ("{\"session\":" + session + "}").c_str());
	}
};

// `input` without the keys in `drop`, as JSON text.
std::string args_without(const JsonValue &input, std::initializer_list<const char *> drop) {
	ObjectText args;
	for (const auto &kv : input.object_items) {
		bool skip = false;
		for (const char *d : drop) skip = skip || kv.first == d;
		if (!skip) args.add(kv.first, *kv.second);
	}
	return args.done();
}

// A session row pair over `steps`: create from `input` less `steps`, then one
// apply per step, recording `{result, <view_key>: view}`. `refusal_ok`: a create
// answer `{ok: false, …}` with no session is the case's answer as it stands.
bool drive_session(Caller &c, const std::string &create, const std::string &apply, const JsonValue &input,
                   const char *view_key, bool refusal_ok, JsonValuePtr &out, std::string &why) {
	const JsonValue *steps = input.find("steps");
	if (steps && !steps->is_array()) return why = "steps is not an array", false;
	const std::string args = args_without(input, {"steps"});
	auto r = c.call(create, args);
	if (!r) return why = c.error, false;
	const JsonValue *ok = r->find("ok");
	if (refusal_ok && ok && ok->type == JsonType::Bool && !ok->bool_value) {
		if (r->find("session")) return why = create + " refused AND opened a session", false;
		out = r;
		return true;
	}
	const JsonValue *handle = r->find("session");
	if (!handle || !handle->is_number() || !r->find("view")) return why = create + " answered no session and view", false;
	const std::string session = handle->raw_number;
	JsonValuePtr initial = copy_of(*r->find("view"));
	std::vector<JsonValuePtr> answers;
	if (steps) {
		for (const auto &st : steps->array_items) {
			auto a = c.apply(apply, session, *st);
			if (!a) {
				c.dispose(session);
				return why = c.error, false;
			}
			answers.push_back(make_object({{"result", a->find("results")->array_items[0]}, {view_key, copy_of(*a->find("view"))}}));
		}
	}
	c.dispose(session);
	out = make_object({{"initial", initial}, {"steps", make_array(std::move(answers))}});
	return true;
}

// core's runner's projection of one generated article (props-corpus.ts, runGenerate).
JsonValuePtr projected_article(const JsonValue &a, std::string &why) {
	std::vector<std::pair<std::string, JsonValuePtr>> items;
	for (const char *k : {"id", "title", "titleTranslation", "noticeType", "difficulty", "readingXp", "documentType",
	                      "author", "settlementId", "questHook"}) {
		if (const JsonValue *v = a.find(k)) items.emplace_back(k, copy_of(*v));
	}
	const JsonValue *words = a.find("vocabularyWords");
	if (!words || !words->is_array()) {
		why = "an article has no vocabularyWords array: " + json_of(a);
		return nullptr;
	}
	items.emplace_back("vocabularyWords", make_count(words->size()));
	items.emplace_back("question", make_bool(truthy(a.find("comprehensionQuestion"))));
	return make_object(std::move(items));
}

// core's runner's `count` over the meanings (props-corpus.ts, runMeanings): how many
// meanings have each action, `not_offered` for an action of null, in first-seen order.
JsonValuePtr meaning_counts(const std::vector<JsonValuePtr> &meanings, std::string &why) {
	std::vector<std::pair<std::string, std::size_t>> counts;
	for (const auto &m : meanings) {
		const JsonValue *a = m && m->is_object() ? m->find("action") : nullptr;
		if (!a || (a->type != JsonType::String && a->type != JsonType::Null)) {
			why = "a meaning states no action (a string or null): " + (m ? json_of(*m) : std::string("null"));
			return nullptr;
		}
		const std::string key = a->type == JsonType::Null ? std::string("not_offered") : a->string_value;
		bool seen = false;
		for (auto &kv : counts) {
			if (kv.first == key) {
				kv.second++;
				seen = true;
			}
		}
		if (!seen) counts.emplace_back(key, 1);
	}
	std::vector<std::pair<std::string, JsonValuePtr>> items;
	for (const auto &kv : counts) items.emplace_back(kv.first, make_count(kv.second));
	return make_object(std::move(items));
}

// `base`'s members with `over`'s laid over them (JavaScript's `{...base, ...over}`):
// a key of both keeps its place in `base` and takes `over`'s value.
JsonValuePtr spread(const JsonValue &base, const JsonValue &over) {
	std::vector<std::pair<std::string, JsonValuePtr>> items;
	for (const auto &kv : base.object_items) items.emplace_back(kv.first, kv.second);
	for (const auto &kv : over.object_items) {
		bool replaced = false;
		for (auto &it : items) {
			if (it.first == kv.first) {
				it.second = kv.second;
				replaced = true;
			}
		}
		if (!replaced) items.emplace_back(kv.first, kv.second);
	}
	return make_object(std::move(items));
}

// `input` less the keys in `drop` (as a value).
JsonValuePtr without(const JsonValue &input, std::initializer_list<const char *> drop) {
	std::vector<std::pair<std::string, JsonValuePtr>> items;
	for (const auto &kv : input.object_items) {
		bool skip = false;
		for (const char *d : drop) skip = skip || kv.first == d;
		if (!skip) items.emplace_back(kv.first, kv.second);
	}
	return make_object(std::move(items));
}

JsonValuePtr null_value() { return std::make_shared<JsonValue>(); }

// The board a props-interactables case states (core's runner's `boardOf`): `board`
// as given, else posted by `props.interactables.host` in `settlement`, else null.
bool board_of(Caller &c, const JsonValue &input, const JsonValue &props, JsonValuePtr &board, std::string &why) {
	if (const JsonValue *b = input.find("board")) {
		board = copy_of(*b);
		return true;
	}
	const JsonValue *s = input.find("settlement");
	if (!truthy(s)) {
		board = null_value();
		return true;
	}
	ObjectText args;
	args.add("props", props);
	args.add("settlement", *s);
	auto r = c.call("props.interactables.host", args.done());
	if (!r) return why = c.error, false;
	const JsonValue *host = r->find("host");
	if (!host) return why = "props.interactables.host answered no host", false;
	const JsonValue *name = s->is_object() ? s->find("name") : nullptr;
	board = make_object({{"host", copy_of(*host)}, {"name", name && name->type != JsonType::Null ? copy_of(*name) : null_value()}});
	return true;
}

// One props-interactables case through the rows.
bool drive_interactables(Caller &c, const std::string &op, const JsonValue &input, JsonValuePtr &out, std::string &why) {
	if (op == "host") {
		auto r = c.call("props.interactables.host", json_of(input));
		if (!r) return why = c.error, false;
		out = r;
		return true;
	}
	if (op == "noun") {
		const JsonValue *list = input.find("archetypes");
		if (list && list->type != JsonType::Null && !list->is_array()) return why = "archetypes is not an array", false;
		std::vector<JsonValuePtr> nouns;
		if (list && list->is_array()) {
			for (const auto &a : list->array_items) {
				ObjectText args;
				args.add("archetype", *a);
				auto r = c.call("props.interactables.noun", args.done());
				if (!r) return why = c.error, false;
				const JsonValue *n = r->find("noun");
				if (!n) return why = "props.interactables.noun answered no noun", false;
				nouns.push_back(copy_of(*n));
			}
		}
		out = make_object({{"nouns", make_array(std::move(nouns))}});
		return true;
	}
	// The props the case states: `props`, else (interact) `prop` alone, else none.
	JsonValuePtr props = make_array({});
	if (const JsonValue *p = input.find("props"); p && p->type != JsonType::Null) {
		if (!p->is_array()) return why = "props is not an array", false;
		props = copy_of(*p);
	} else if (op == "interact" && truthy(input.find("prop"))) {
		props = make_array({copy_of(*input.find("prop"))});
	}
	JsonValuePtr board;
	if (!board_of(c, input, *props, board, why)) return false;
	if (op == "meanings" || op == "interact") {
		const char *row = op == "meanings" ? "props.interactables.meaning" : "props.interactables.interact";
		std::vector<JsonValuePtr> answers;
		for (const auto &p : props->array_items) {
			ObjectText args;
			args.add("prop", *p);
			args.add("board", *board);
			auto r = c.call(row, args.done());
			if (!r) return why = c.error, false;
			if (op == "meanings") {
				answers.push_back(r);
				continue;
			}
			// `{id: p.id, ...answer}`: an id the prop does not state stays absent.
			const JsonValue *id = p->is_object() ? p->find("id") : nullptr;
			answers.push_back(id ? spread(*make_object({{"id", copy_of(*id)}}), *r) : r);
		}
		if (op == "interact") {
			out = make_object({{"results", make_array(std::move(answers))}});
			return true;
		}
		JsonValuePtr count = meaning_counts(answers, why);
		if (!count) return false;
		out = make_object({{"board", board}, {"meanings", make_array(std::move(answers))}, {"count", count}});
		return true;
	}
	if (op == "target") {
		JsonValuePtr base = without(input, {"settlement", "ranges", "stands"});
		base = spread(*base, *make_object({{"board", board}}));
		const JsonValue *ranges = input.find("ranges");
		auto target = [&](const JsonValue &args_v, JsonValuePtr &answer) {
			JsonValuePtr args = ranges ? spread(args_v, *make_object({{"ranges", copy_of(*ranges)}})) : copy_of(args_v);
			answer = c.call("props.interactables.target", json_of(*args));
			if (!answer) why = c.error;
			return answer != nullptr;
		};
		const JsonValue *stands = input.find("stands");
		if (!stands || !stands->is_array()) {
			return target(*base, out);
		}
		std::vector<JsonValuePtr> answers;
		for (const auto &st : stands->array_items) {
			if (!st->is_object()) return why = "a stand is not an object: " + json_of(*st), false;
			const JsonValue *at = st->find("at");
			// `{...input, ...stand, at: stand.at}`: a stand with no `at` has none.
			JsonValuePtr args = without(*spread(*base, *st), {"at"});
			if (at) args = spread(*args, *make_object({{"at", copy_of(*at)}}));
			JsonValuePtr answer;
			if (!target(*args, answer)) return false;
			answers.push_back(at ? spread(*make_object({{"at", copy_of(*at)}}), *answer) : answer);
		}
		out = make_object({{"board", board}, {"stands", make_array(std::move(answers))}});
		return true;
	}
	why = "op " + op + " is not one of props-interactables'";
	return false;
}

// Drive one case. False with `why` when it cannot be driven or a call failed.
// core's runner's order check (movement-corpus.ts, reversedMovementInput): the input
// with its `solids` and `exclude` arrays reversed, every other key as it stands;
// `changed` says whether there was a list to reverse.
JsonValuePtr reversed_lists(const JsonValue &input, bool &changed) {
	changed = false;
	std::vector<std::pair<std::string, JsonValuePtr>> items;
	for (const auto &kv : input.object_items) {
		if ((kv.first == "solids" || kv.first == "exclude") && kv.second->is_array()) {
			std::vector<JsonValuePtr> rev(kv.second->array_items.rbegin(), kv.second->array_items.rend());
			changed = changed || rev.size() > 1;
			items.emplace_back(kv.first, make_array(std::move(rev)));
		} else {
			items.emplace_back(kv.first, kv.second);
		}
	}
	return make_object(std::move(items));
}

bool drive(Caller &c, const std::string &area, const std::string &op, const JsonValue &input, JsonValuePtr &out,
           std::string &why) {
	if (area == "props-containers") {
		auto r = c.call("props.containers." + op, json_of(input));
		if (!r) return why = c.error, false;
		out = r;
		return true;
	}
	if (area == "props-documents") {
		if (op == "document" || op == "paginate") {
			auto r = c.call("props.documents." + op, json_of(input));
			if (!r) return why = c.error, false;
			out = r;
			return true;
		}
		return drive_session(c, "props.reader.create", "props.reader.apply", input, "view", true, out, why);
	}
	if (area == "props-notice-board") {
		if (op == "board") return drive_session(c, "props.board.create", "props.board.apply", input, "view", false, out, why);
		auto r = c.call("props.notices.generate", json_of(input));
		if (!r) return why = c.error, false;
		const JsonValue *articles = r->find("articles");
		if (!articles || !articles->is_array()) return why = "props.notices.generate answered no articles", false;
		std::vector<JsonValuePtr> list;
		for (const auto &a : articles->array_items) {
			auto p = projected_article(*a, why);
			if (!p) return false;
			list.push_back(p);
		}
		out = make_object({{"articles", make_array(std::move(list))}});
		return true;
	}
	if (area == "props-doors") {
		if (op == "door" || op == "prompt") {
			auto r = c.call("props.doors." + op, json_of(input));
			if (!r) return why = c.error, false;
			out = r;
			return true;
		}
		const JsonValue *buildings = input.find("buildings");
		const JsonValue *steps = input.find("steps");
		if (!buildings || !steps || !steps->is_array()) return why = "a session case needs buildings and steps", false;
		const JsonValue *held = input.find("playerItemIds");
		std::string inside = input.find("inside") ? json_of(*input.find("inside")) : std::string("null");
		std::vector<JsonValuePtr> answers;
		for (const auto &st : steps->array_items) {
			if (st->is_object() && st->get_string("op") == "prompt") {
				ObjectText player;
				if (st->find("position")) player.add("position", *st->find("position"));
				player.add("inside", inside);
				ObjectText args;
				args.add("buildings", *buildings);
				args.add("player", player.done());
				auto r = c.call("props.doors.prompt", args.done());
				if (!r) return why = c.error, false;
				if (!r->find("prompt")) return why = "props.doors.prompt answered no prompt", false;
				answers.push_back(make_object({{"prompt", copy_of(*r->find("prompt"))}}));
				continue;
			}
			ObjectText args;
			args.add("buildings", *buildings);
			args.add("inside", inside);
			if (held) args.add("playerItemIds", *held);
			args.add("action", *st);
			auto r = c.call("props.doors.step", args.done());
			if (!r) return why = c.error, false;
			const JsonValue *ok = r->find("ok");
			if (ok && ok->type == JsonType::Bool && ok->bool_value) {
				const JsonValue *now = r->find("inside");
				if (!now) return why = "an ok door step answered no inside", false;
				inside = json_of(*now);
			}
			answers.push_back(make_object({{"result", r}, {"inside", insimul::parse_json(inside).root}}));
		}
		out = make_object({{"steps", make_array(std::move(answers))}});
		return true;
	}
	if (area == "ui-inventory") {
		return drive_session(c, "inventory.create", "inventory.apply", input, "state", false, out, why);
	}
	if (area == "props-pickup-placement") {
		auto r = c.call("props.pickups." + op, json_of(input));
		if (!r) return why = c.error, false;
		out = r;
		return true;
	}
	if (area == "props-interactables") return drive_interactables(c, op, input, out, why);
	if (area == "camera-movement") {
		auto r = c.call("camera.movement." + op, json_of(input));
		if (!r) return why = c.error, false;
		out = r;
		return true;
	}
	why = "area " + area + " is not one this runner drives";
	return false;
}

} // namespace

int main(int argc, char **argv) {
	if (argc < 2) {
		std::fprintf(stderr, "usage: insimulcore_props_corpus <corpus.json>...\n");
		return 2;
	}
	if (!self_test()) {
		std::fprintf(stderr, "props_corpus: the comparator cannot tell a wrong answer from a right one\n");
		return 2;
	}
	insimul_core *core = insimul_core_create();
	if (!core) {
		std::fprintf(stderr, "props_corpus: insimul_core_create() failed\n");
		return 2;
	}
	std::printf("props_corpus: %s\n", insimul_core_version());
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
	// Each contract row's answer, asked once.
	std::map<std::string, JsonValuePtr> contract_answers;
	std::map<std::string, std::string> contract_errors;

	const auto t0 = std::chrono::steady_clock::now();
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
			std::printf("  [FAIL] %s — area '%s' is not one this runner drives\n", file.c_str(), area_name.c_str());
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
		std::printf("── %s (area %s, %zu case(s))\n", file.c_str(), area_name.c_str(), case_list->size());

		// How the file says its numbers are computed: the rows run in double precision.
		if (area->numerics) {
			std::string stated;
			if (!numerics_double(doc, stated)) {
				std::printf("  [FAIL] numerics: the file %s; this runner drives rows that compute in double precision\n",
				            stated.empty() ? "states no numerics" : ("states \"" + stated + "\", not double precision").c_str());
				failed++;
			} else {
				std::printf("  numerics: double precision, as the file states; tolerance %g\n", tol);
			}
		}

		// The surface: a missing row would otherwise show only as every case failing.
		for (const std::string &row : area->rows) {
			if (!table.count(row)) {
				std::printf("  [FAIL] surface: the method table has no %s row\n", row.c_str());
				failed++;
			}
		}

		// The contract tables: every table the area's contract row states for it is the file's.
		{
			const std::string row = area->contract_row;
			if (!contract_answers.count(row)) {
				contract_answers[row] = c.call(row, "{}");
				contract_errors[row] = contract_answers[row] ? std::string() : c.error;
			}
			const JsonValuePtr &contract_tables = contract_answers[row];
			const JsonValue *mine = contract_tables ? contract_tables->find(area_name) : nullptr;
			const JsonValue *theirs = doc.find("contract");
			if (!mine || !mine->is_object() || mine->object_items.empty()) {
				std::printf("  [FAIL] contract: %s states no table for %s%s%s\n", row.c_str(), area_name.c_str(),
				            contract_tables ? "" : ": ", contract_tables ? "" : contract_errors[row].c_str());
				failed++;
			} else {
				int bad = 0;
				for (const std::string &t : area->tables) {
					if (!mine->find(t)) {
						std::printf("  [FAIL] contract.%s: %s states no such table for %s\n", t.c_str(), row.c_str(), area_name.c_str());
						bad++;
					}
				}
				for (const auto &kv : mine->object_items) {
					const JsonValue *t = theirs ? theirs->find(kv.first) : nullptr;
					JsonValuePtr projected;
					bool valued = false;
					for (const std::string &v : area->valued_tables) valued = valued || v == kv.first;
					if (t && valued) {
						std::string why;
						projected = projected_values(*t, why);
						if (!projected) {
							std::printf("  [FAIL] contract.%s: %s\n", kv.first.c_str(), why.c_str());
							bad++;
							continue;
						}
						t = projected.get();
					}
					const std::string diff = t ? compare(*t, *kv.second, 0.0, "contract." + kv.first)
					                           : "contract." + kv.first + ": the file states no such table";
					if (!diff.empty()) {
						std::printf("  [FAIL] %s\n", diff.c_str());
						bad++;
					}
				}
				failed += bad;
				std::printf("  contract: %zu table(s) %s %s's\n", mine->object_items.size(), bad ? "DIFFER from" : "are", row.c_str());
			}
		}

		std::map<std::string, int> driven;
		int file_undriven = 0, reversed_runs = 0;
		for (const auto &cp : case_list->array_items) {
			const JsonValue &cs = *cp;
			const std::string name = cs.get_string("name");
			const std::string op = cs.get_string("op");
			const JsonValue *input = cs.find("input");
			const JsonValue *expected = cs.find("expected");
			if (!input || !input->is_object() || !expected) {
				std::printf("  [FAIL] %s — needs an input object and an expected answer\n", name.c_str());
				failed++;
				file_undriven++;
				continue;
			}
			bool known = false;
			for (const std::string &o : area->ops) known = known || o == op;
			if (!known) {
				std::printf("  [FAIL] %s — op '%s' is not one of area %s's\n", name.c_str(), op.c_str(), area_name.c_str());
				failed++;
				file_undriven++;
				continue;
			}
			JsonValuePtr actual;
			std::string why;
			if (!drive(c, area_name, op, *input, actual, why)) {
				std::printf("  [FAIL] %s — not driven: %s\n", name.c_str(), why.c_str());
				failed++;
				file_undriven++;
				continue;
			}
			const std::string diff = compare(*expected, *actual, tol, "$");
			if (!diff.empty()) {
				std::printf("  [FAIL] %s — %s\n", name.c_str(), diff.c_str());
				failed++;
				continue;
			}
			if (area->reverse_lists) {
				bool changed = false;
				JsonValuePtr reversed = reversed_lists(*input, changed);
				if (changed) {
					JsonValuePtr again;
					if (!drive(c, area_name, op, *reversed, again, why)) {
						std::printf("  [FAIL] %s — with solids and exclude reversed, not driven: %s\n", name.c_str(), why.c_str());
						failed++;
						continue;
					}
					const std::string rdiff = compare(*expected, *again, tol, "$");
					if (!rdiff.empty()) {
						std::printf("  [FAIL] %s — with solids and exclude reversed: %s\n", name.c_str(), rdiff.c_str());
						failed++;
						continue;
					}
					reversed_runs++;
				}
			}
			driven[op]++;
			total_driven++;
		}
		std::string by_op;
		for (const std::string &o : area->ops) {
			if (!driven.count(o)) {
				std::printf("  [FAIL] op %s of area %s: no case of it was driven\n", o.c_str(), area_name.c_str());
				failed++;
			}
			by_op += (by_op.empty() ? "" : ", ") + o + " " + std::to_string(driven.count(o) ? driven[o] : 0);
		}
		std::printf("  %s: %zu case(s), driven %s; %d undriven\n", area_name.c_str(), case_list->size(), by_op.c_str(),
		            file_undriven);
		if (area->reverse_lists) {
			std::printf("  order: %d case(s) driven again with solids and exclude reversed, the same answer\n", reversed_runs);
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
	std::printf("props_corpus: %d case(s) driven through the rows, %d failed, %.0f ms\n", total_driven, failed, ms);
	if (failed || total_driven == 0) {
		std::printf("props_corpus: FAIL\n");
		return 1;
	}
	std::printf("props_corpus: PASS\n");
	return 0;
}
