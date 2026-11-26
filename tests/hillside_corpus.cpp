// hillside_corpus.cpp — core's hillside grading corpus, its pads, driven through
// libinsimulcore's `hillside.gradingPlan` and `hillside.contract` rows.
//
// PL.native-grading-plan-call (rulings U115, U128, U101(1) and U36). Core's grading
// plan of a World IR (src/editor/scene/hillside-grading.ts: computeGradingPlan, the
// point function gradingPlanHeight and checkPadSet; core's NF.H3, ADR-0001) is the
// `hillside.gradingPlan` row of corebridge/js/entry.js. This gate holds it to core's
// own corpus, conformance/hillside/pads.json, COPIED byte for byte into
// corebridge/vendor/core/conformance/hillside/ at the pin (sha256 in VENDORED.json,
// checked by the `core_vendor` ctest; byte-compared with core by `--check --core`).
// Nothing here re-writes a case or computes a plan: every answer comes out of the row.
// Core's reference runner, src/editor/scene/hillside-grading-corpus.ts, is mirrored
// step for step:
//
//   contract  `hillside.contract` states every DATA key of the file's `contract`
//             (padIdPrefix and the numbers), and nothing else: numbers within the
//             file's `tolerance.unit` (the file rounds standMaxGradient and
//             blendMaxRiseM to 1e-6; the row states core's constants whole), strings
//             exactly. The file's prose keys (kProse) are rules written out; each must
//             be a string, and nothing is compared.
//   cases     for each engine the case names, ONE call `hillside.gradingPlan { world,
//             engine, points?, otherPads? }` (the case's input as is), projected as
//             core's runHillsideEngine projects its plan: a refusal is `{ refused }`;
//             else `pads` (id, sourceFeatureId, footprintId; cx, cz, halfAcross,
//             halfAway and height on core's 1 mm quantum, quantizeSceneCoord; awayX,
//             awayZ and carryM rounded to 1e-6, r6; hillside, wallCount,
//             terraceDepthM), `walls`, `report` and `findings` as the row answers them,
//             `points` (the input's label, x and z with the row's raw and graded
//             heights on the quantum) when the case sends points, and `padSet` when it
//             sends otherPads. Every engine must answer the same (runHillsideCase).
//             The case's `expected` must hold the answer invariants
//             (hillsideAnswerFlaws: no wall vertex top under its base or stepping over
//             the contract's wallMaxM, no wall on a default pad or on no pad, the report
//             counting the pads and printing `N grading patches not applied` only when
//             N > 0), and must equal the projection by compareHillside: numbers within
//             tolerance.metres (awayX, awayZ, carryM within tolerance.unit), plus 1e-12;
//             everything else exactly, object key sets included.
//   controls  each control names a case and gives an answer with one thing changed. A
//             control is refused when its answer breaks an invariant or differs from
//             what the row answered for that case (checkHillsideControl). Every control
//             must be refused; one that is not FAILS the run.
//
// A comparator and projection self-test runs on every start, so a comparator that
// cannot fail, or a rounding that rounds a half the wrong way, is red before any case.
// The run FAILS on a file that is not the hillside corpus, a case that names no
// engine, a row missing from the method table, an undriven case or control.
//
// A pure consumer of insimulcore.h (no quickjs.h, no insimul.h). The JSON reader is
// tests/radiant/json_value.{h,cpp}, used as is.
//
// usage: insimulcore_hillside_corpus [--only <case-name-substring>] <pads.json>

#include "insimulcore.h"
#include "radiant/json_value.h"

#include <chrono>
#include <cmath>
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <fstream>
#include <map>
#include <memory>
#include <set>
#include <sstream>
#include <string>
#include <vector>

using insimul::JsonType;
using insimul::JsonValue;
using insimul::JsonValuePtr;

namespace {

const char *const kPlanRow = "hillside.gradingPlan";
const char *const kContractRow = "hillside.contract";

// The file's contract keys that are rules written out, not data (core's emitter,
// scripts/emit-hillside-corpus.ts): no row states them.
const std::set<std::string> kProse = {"blendMaxRiseRule", "reportLine", "overlapSlopeRule", "neighbourWallRule", "frame",
                                      "module"};

// Unit-vector and carry fields compare at tolerance.unit (core's UNIT_KEYS).
const std::set<std::string> kUnitKeys = {"awayX", "awayZ", "carryM"};

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

// ── JSON values: building and writing ─────────────────────────────────────────

// The shortest text that reads back as the same double (as JSON.stringify writes a
// number), so two answers are the same text exactly when they hold the same doubles.
std::string num_text(double d) {
	if (d == 0) return "0"; // no -0, as JSON.stringify writes it
	char buf[40];
	for (int precision = 1; precision <= 17; precision++) {
		std::snprintf(buf, sizeof buf, "%.*g", precision, d);
		if (std::strtod(buf, nullptr) == d) break;
	}
	return buf;
}

JsonValuePtr make_number(double d) {
	auto v = std::make_shared<JsonValue>();
	v->type = JsonType::Number;
	v->number_value = d == 0 ? 0.0 : d;
	v->raw_number = num_text(d);
	return v;
}

JsonValuePtr make_object() {
	auto v = std::make_shared<JsonValue>();
	v->type = JsonType::Object;
	return v;
}

JsonValuePtr make_array() {
	auto v = std::make_shared<JsonValue>();
	v->type = JsonType::Array;
	return v;
}

// A deep copy: the projection never shares a node with the row's answer.
JsonValuePtr copy_of(const JsonValue &v) {
	auto c = std::make_shared<JsonValue>(v);
	for (auto &item : c->array_items) item = copy_of(*item);
	for (auto &kv : c->object_items) kv.second = copy_of(*kv.second);
	return c;
}

void put(JsonValue &obj, const std::string &key, JsonValuePtr value) {
	if (value) obj.object_items.emplace_back(key, std::move(value));
}

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

// Canonical text: numbers by num_text (so two answers are the same text exactly when
// they hold the same doubles), keys in their order. The args a row is sent keep the
// file's own number text (`raw`).
void write_json(std::string &out, const JsonValue &v, bool raw = false) {
	switch (v.type) {
	case JsonType::Null: out += "null"; return;
	case JsonType::Bool: out += v.bool_value ? "true" : "false"; return;
	case JsonType::Number: out += raw ? v.raw_number : num_text(v.number_value); return;
	case JsonType::String: write_string(out, v.string_value); return;
	case JsonType::Array:
		out += '[';
		for (std::size_t i = 0; i < v.array_items.size(); i++) {
			if (i) out += ',';
			write_json(out, *v.array_items[i], raw);
		}
		out += ']';
		return;
	case JsonType::Object:
		out += '{';
		for (std::size_t i = 0; i < v.object_items.size(); i++) {
			if (i) out += ',';
			write_string(out, v.object_items[i].first);
			out += ':';
			write_json(out, *v.object_items[i].second, raw);
		}
		out += '}';
		return;
	}
}

std::string text_of(const JsonValue &v) {
	std::string s;
	write_json(s, v);
	return s;
}

// ── core's roundings (src/editor/scene/placement.ts, hillside-grading-corpus.ts) ──

// JavaScript's Math.round: the nearest integer, a half toward +Infinity.
double js_round(double x) {
	if (!std::isfinite(x)) return x;
	double f = std::floor(x);
	return (x - f >= 0.5) ? f + 1.0 : f;
}

// quantizeSceneCoord: the 1 mm placement quantum; a non-finite value is 0; no -0.
double quantize(double value) {
	if (!std::isfinite(value)) return 0;
	const double inv = 1000.0;
	const double scaled = value * inv;
	const double rounded = scaled < 0 ? -js_round(-scaled) : js_round(scaled);
	const double q = rounded / inv;
	return q == 0 ? 0.0 : q;
}

// r6: rounded to 1e-6 (no -0).
double r6(double v) {
	const double r = js_round(v * 1e6) / 1e6;
	return r == 0 ? 0.0 : r;
}

// A number field projected by `f`; a field the row did not answer as a number is
// carried as it is (so the comparison names it), and an absent one stays absent.
JsonValuePtr projected(const JsonValue &obj, const char *key, double (*f)(double)) {
	const JsonValue *v = obj.find(key);
	if (!v) return nullptr;
	if (!v->is_number()) return copy_of(*v);
	return make_number(f(v->number_value));
}

JsonValuePtr carried(const JsonValue &obj, const char *key) {
	const JsonValue *v = obj.find(key);
	return v ? copy_of(*v) : nullptr;
}

// ── compareHillside ───────────────────────────────────────────────────────────

struct Tolerance {
	double metres = 0;
	double unit = 0;
};

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

std::string short_text(const JsonValue &v) {
	std::string s = text_of(v);
	if (s.size() > 160) s = s.substr(0, 157) + "...";
	return s;
}

// The first difference between `want` and `got` (path and values), or "" — core's
// compareHillside: numbers within the key's tolerance (+1e-12); arrays item by item
// (the key passed down); objects with the same sorted key sets; the rest exactly.
std::string compare(const JsonValue &want, const JsonValue &got, const Tolerance &tol, const std::string &path,
                    const std::string &key) {
	if (want.is_number() && got.is_number()) {
		const double t = kUnitKeys.count(key) ? tol.unit : tol.metres;
		// A NaN difference fails here (NaN <= t is false), as it does in core's.
		if (std::fabs(want.number_value - got.number_value) <= t + 1e-12) return {};
		return path + ": " + num_text(got.number_value) + " (want " + num_text(want.number_value) + ")";
	}
	if (want.is_array() || got.is_array()) {
		if (!want.is_array() || !got.is_array()) return path + ": not both arrays";
		if (want.array_items.size() != got.array_items.size()) {
			return path + ": " + std::to_string(got.array_items.size()) + " item(s) (want " +
			       std::to_string(want.array_items.size()) + ")";
		}
		for (std::size_t i = 0; i < want.array_items.size(); i++) {
			std::string d = compare(*want.array_items[i], *got.array_items[i], tol, path + "[" + std::to_string(i) + "]", key);
			if (!d.empty()) return d;
		}
		return {};
	}
	if (want.is_object() || got.is_object()) {
		if (!want.is_object() || !got.is_object()) return path + ": not both objects";
		std::set<std::string> wk, gk;
		for (const auto &kv : want.object_items) wk.insert(kv.first);
		for (const auto &kv : got.object_items) gk.insert(kv.first);
		if (wk != gk || wk.size() != want.object_items.size() || gk.size() != got.object_items.size()) {
			std::string g, w;
			for (const auto &k : gk) g += (g.empty() ? "" : ",") + k;
			for (const auto &k : wk) w += (w.empty() ? "" : ",") + k;
			return path + ": keys " + g + " (want " + w + ")";
		}
		for (const auto &k : wk) {
			std::string d = compare(*want.find(k), *got.find(k), tol, path + "." + k, k);
			if (!d.empty()) return d;
		}
		return {};
	}
	bool same = want.type == got.type;
	if (same && want.is_string()) same = want.string_value == got.string_value;
	if (same && want.type == JsonType::Bool) same = want.bool_value == got.bool_value;
	if (same && want.is_number()) same = want.number_value == got.number_value;
	return same ? std::string() : path + ": " + short_text(got) + " (want " + short_text(want) + ")";
}

// ── hillsideAnswerFlaws ───────────────────────────────────────────────────────

// §8's report lines for a plan of `n` pads, as core's gradingReportLines writes them.
std::vector<std::string> report_lines(std::size_t n) {
	if (n == 0) return {};
	return {std::to_string(n) + " grading patches not applied"};
}

// What an answer must hold whatever the world (core's hillsideAnswerFlaws), with
// the contract's wallMaxM. A refusal holds nothing to check.
std::vector<std::string> answer_flaws(const JsonValue &answer, double wall_max) {
	std::vector<std::string> flaws;
	if (!answer.is_object() || answer.find("refused")) return flaws;
	std::vector<const JsonValue *> pads, walls;
	if (const JsonValue *p = answer.find("pads"); p && p->is_array())
		for (const auto &x : p->array_items)
			if (x->is_object()) pads.push_back(x.get());
	if (const JsonValue *w = answer.find("walls"); w && w->is_array())
		for (const auto &x : w->array_items)
			if (x->is_object()) walls.push_back(x.get());
	for (const JsonValue *w : walls) {
		const std::string id = w->get_string("id");
		if (const JsonValue *vs = w->find("vertices"); vs && vs->is_array()) {
			for (const auto &v : vs->array_items) {
				if (!v->is_object()) continue;
				const JsonValue *top = v->find("top");
				const JsonValue *base = v->find("base");
				const double rise = (top && top->is_number() ? top->number_value : NAN) -
				                    (base && base->is_number() ? base->number_value : NAN);
				if (!(rise >= 0)) flaws.push_back(id + ": a vertex's top is under its base");
				if (rise > wall_max + 1e-9) flaws.push_back(id + ": a vertex steps " + num_text(r6(rise)) + " m, over WALL_MAX_M " + num_text(wall_max));
			}
		}
		const JsonValue *pad_id = w->find("padId");
		const JsonValue *pad = nullptr;
		for (const JsonValue *p : pads) {
			const JsonValue *pid = p->find("id");
			if (pid && pad_id && pid->is_string() && pad_id->is_string() && pid->string_value == pad_id->string_value) {
				pad = p;
				break;
			}
		}
		const std::string pad_name = pad_id && pad_id->is_string() ? pad_id->string_value : short_text(pad_id ? *pad_id : JsonValue());
		if (!pad) {
			flaws.push_back(id + ": no pad " + pad_name);
		} else {
			const JsonValue *h = pad->find("hillside");
			if (!(h && h->type == JsonType::Bool && h->bool_value)) flaws.push_back(id + ": a wall on default pad " + pad_name);
		}
	}
	const JsonValue *report = answer.find("report");
	const JsonValue *patches = report && report->is_object() ? report->find("patches") : nullptr;
	if (!(patches && patches->is_number() && patches->number_value == static_cast<double>(pads.size()))) {
		flaws.push_back("report.patches " + (patches ? short_text(*patches) : std::string("undefined")) + " is not the " +
		                std::to_string(pads.size()) + " pad(s)");
	}
	const JsonValue *lines = report && report->is_object() ? report->find("lines") : nullptr;
	const std::vector<std::string> want = report_lines(pads.size());
	bool lines_ok = lines && lines->is_array() && lines->array_items.size() == want.size();
	for (std::size_t i = 0; lines_ok && i < want.size(); i++) {
		lines_ok = lines->array_items[i]->is_string() && lines->array_items[i]->string_value == want[i];
	}
	if (!lines_ok) flaws.push_back("report.lines " + (lines ? short_text(*lines) : std::string("undefined")) + " (want the line for " + std::to_string(pads.size()) + " pad(s))");
	return flaws;
}

// ── the row's answer, projected as core's runHillsideEngine projects its plan ──

// `why` is set (and null returned) when the row's answer is not an answer at all.
JsonValuePtr project(const JsonValue &answer, const JsonValue &input, std::string &why) {
	if (!answer.is_object()) {
		why = "the row answered a " + std::string(kind_of(answer)) + ", not an object";
		return nullptr;
	}
	const JsonValue *ok = answer.find("ok");
	if (!ok || ok->type != JsonType::Bool) {
		why = "the row's answer has no boolean `ok`";
		return nullptr;
	}
	auto out = make_object();
	if (!ok->bool_value) {
		const JsonValue *refused = answer.find("refused");
		if (!refused) {
			why = "a refusal without `refused`";
			return nullptr;
		}
		put(*out, "refused", copy_of(*refused));
		return out;
	}
	const JsonValue *plan = answer.find("plan");
	if (!plan || !plan->is_object()) {
		why = "an ok answer without a `plan` object";
		return nullptr;
	}
	auto pads = make_array();
	if (const JsonValue *ps = plan->find("pads"); ps && ps->is_array()) {
		for (const auto &pp : ps->array_items) {
			const JsonValue &p = *pp;
			auto o = make_object();
			if (!p.is_object()) {
				pads->array_items.push_back(copy_of(p));
				continue;
			}
			put(*o, "id", carried(p, "id"));
			put(*o, "sourceFeatureId", carried(p, "sourceFeatureId"));
			put(*o, "footprintId", carried(p, "footprintId"));
			put(*o, "cx", projected(p, "cx", quantize));
			put(*o, "cz", projected(p, "cz", quantize));
			put(*o, "halfAcross", projected(p, "halfAcross", quantize));
			put(*o, "halfAway", projected(p, "halfAway", quantize));
			put(*o, "awayX", projected(p, "awayX", r6));
			put(*o, "awayZ", projected(p, "awayZ", r6));
			put(*o, "height", projected(p, "height", quantize));
			put(*o, "hillside", carried(p, "hillside"));
			put(*o, "wallCount", carried(p, "wallCount"));
			put(*o, "terraceDepthM", carried(p, "terraceDepthM"));
			put(*o, "carryM", projected(p, "carryM", r6));
			pads->array_items.push_back(o);
		}
	} else {
		why = "the plan has no `pads` array";
		return nullptr;
	}
	put(*out, "pads", pads);
	put(*out, "walls", carried(*plan, "walls"));
	put(*out, "report", carried(*plan, "report"));
	put(*out, "findings", carried(*plan, "findings"));
	if (const JsonValue *in_points = input.find("points")) {
		const JsonValue *got = answer.find("points");
		if (!got || !got->is_array() || !in_points->is_array() || got->array_items.size() != in_points->array_items.size()) {
			why = "the row answered " + std::string(got && got->is_array() ? std::to_string(got->array_items.size()) : "no") +
			      " point(s) for the " + std::to_string(in_points->size()) + " sent";
			return nullptr;
		}
		auto pts = make_array();
		for (std::size_t i = 0; i < in_points->array_items.size(); i++) {
			const JsonValue &pt = *in_points->array_items[i];
			const JsonValue &g = *got->array_items[i];
			const JsonValue *gx = g.find("x");
			const JsonValue *gz = g.find("z");
			const JsonValue *px = pt.find("x");
			const JsonValue *pz = pt.find("z");
			if (!g.is_object() || !gx || !gz || !px || !pz || gx->number_value != px->number_value ||
			    gz->number_value != pz->number_value) {
				why = "the row's point " + std::to_string(i) + " is not at the point sent";
				return nullptr;
			}
			auto o = make_object();
			put(*o, "label", carried(pt, "label"));
			put(*o, "x", copy_of(*px));
			put(*o, "z", copy_of(*pz));
			put(*o, "raw", projected(g, "raw", quantize));
			put(*o, "graded", projected(g, "graded", quantize));
			pts->array_items.push_back(o);
		}
		put(*out, "points", pts);
	}
	if (input.find("otherPads")) {
		const JsonValue *pad_set = answer.find("padSet");
		if (!pad_set) {
			why = "otherPads were sent and the row answered no `padSet`";
			return nullptr;
		}
		put(*out, "padSet", copy_of(*pad_set));
	}
	return out;
}

// ── self-test: the comparator, the roundings and the invariants can each fail ──

bool self_test() {
	auto parse = [](const char *t) { return insimul::parse_json(t).root; };
	const Tolerance tol{0.001, 1e-6};
	struct Probe {
		const char *want, *got;
		bool agree;
	} probes[] = {
	    {"{\"height\":1}", "{\"height\":1.0009}", true},
	    {"{\"height\":1}", "{\"height\":1.0011}", false},
	    {"{\"awayX\":0.5}", "{\"awayX\":0.5000009}", true},
	    {"{\"awayX\":0.5}", "{\"awayX\":0.50001}", false},
	    {"{\"carryM\":[0.5]}", "{\"carryM\":[0.5002]}", false},
	    {"{\"a\":1}", "{\"a\":1,\"b\":2}", false},
	    {"{\"a\":1,\"b\":2}", "{\"a\":1}", false},
	    {"[1,2]", "[1,2,3]", false},
	    {"\"a\"", "\"b\"", false},
	    {"null", "null", true},
	    {"null", "0", false},
	    {"false", "0", false},
	    {"true", "false", false},
	    {"{\"padSet\":null}", "{\"padSet\":\"x\"}", false},
	    {"[\"a\"]", "{\"0\":\"a\"}", false},
	};
	bool ok = true;
	for (const Probe &p : probes) {
		auto w = parse(p.want);
		auto g = parse(p.got);
		bool agree = w && g && compare(*w, *g, tol, "$", "").empty();
		if (agree != p.agree) {
			std::printf("  [FAIL] self-test: compare %s vs %s should %s\n", p.want, p.got, p.agree ? "agree" : "differ");
			ok = false;
		}
	}
	// Math.round: a half toward +Infinity (r6 rounds a negative half up, never away from zero).
	const double halves[][2] = {{2.5, 3}, {-2.5, -2}, {-1.5, -1}, {-0.5, 0}, {0.49999999999999994, 0}, {-3.7, -4}};
	for (const auto &h : halves) {
		if (js_round(h[0]) != h[1]) {
			std::printf("  [FAIL] self-test: Math.round(%.17g) is %.17g here, not %.17g\n", h[0], js_round(h[0]), h[1]);
			ok = false;
		}
	}
	struct Round {
		double in, quantized, rounded6;
	} rounds[] = {
	    {0.0625, 0.063, 0.0625},   // 62.5 on the quantum, exactly: rounds up
	    {-0.0625, -0.063, -0.0625}, // ... and its negative away from zero (core negates first)
	    {-0.0004, 0, -0.0004},     // -0.4 on the quantum: 0, never -0
	    {0.2679491924311227, 0.268, 0.267949},
	    {NAN, 0, NAN},
	};
	for (const Round &r : rounds) {
		const double q = quantize(r.in);
		const double s = r6(r.in);
		const bool q_ok = std::fabs(q - r.quantized) < 1e-12;
		const bool s_ok = std::isnan(r.rounded6) ? std::isnan(s) : std::fabs(s - r.rounded6) < 1e-15;
		if (!q_ok || !s_ok) {
			std::printf("  [FAIL] self-test: %.17g quantized %.17g (want %.17g), r6 %.17g (want %.17g)\n", r.in, q, r.quantized, s,
			            r.rounded6);
			ok = false;
		}
	}
	struct Flaw {
		const char *answer;
		std::size_t flaws;
	} flaw_probes[] = {
	    {"{\"pads\":[],\"walls\":[],\"report\":{\"patches\":0,\"lines\":[]},\"findings\":[]}", 0},
	    {"{\"pads\":[],\"walls\":[],\"report\":{\"patches\":0,\"lines\":[\"0 grading patches not applied\"]},\"findings\":[]}", 1},
	    {"{\"pads\":[{\"id\":\"p\",\"hillside\":false}],\"walls\":[],\"report\":{\"patches\":1,\"lines\":[]},\"findings\":[]}", 1},
	    {"{\"pads\":[{\"id\":\"p\",\"hillside\":false}],\"walls\":[{\"id\":\"w\",\"padId\":\"p\",\"vertices\":[{\"top\":1.6,\"base\":0}]}],"
	     "\"report\":{\"patches\":1,\"lines\":[\"1 grading patches not applied\"]},\"findings\":[]}",
	     2},
	    {"{\"pads\":[],\"walls\":[{\"id\":\"w\",\"padId\":\"q\",\"vertices\":[{\"top\":0,\"base\":0.1}]}],"
	     "\"report\":{\"patches\":0,\"lines\":[]},\"findings\":[]}",
	     2},
	    {"{\"refused\":\"unknown-engine\"}", 0},
	};
	for (const Flaw &f : flaw_probes) {
		auto a = parse(f.answer);
		const std::size_t n = a ? answer_flaws(*a, 1.5).size() : 99;
		if (n != f.flaws) {
			std::printf("  [FAIL] self-test: %s has %zu flaw(s), want %zu\n", f.answer, n, f.flaws);
			ok = false;
		}
	}
	return ok;
}

std::vector<std::string> string_list(const JsonValue *v) {
	std::vector<std::string> out;
	if (v && v->is_array()) {
		for (const auto &x : v->array_items) out.push_back(x->as_string());
	}
	return out;
}

} // namespace

int main(int argc, char **argv) {
	std::string only, file;
	for (int i = 1; i < argc; i++) {
		if (std::strcmp(argv[i], "--only") == 0 && i + 1 < argc) {
			only = argv[++i];
		} else if (file.empty()) {
			file = argv[i];
		} else {
			std::fprintf(stderr, "usage: insimulcore_hillside_corpus [--only <case-name-substring>] <pads.json>\n");
			return 2;
		}
	}
	if (file.empty()) {
		std::fprintf(stderr, "usage: insimulcore_hillside_corpus [--only <case-name-substring>] <pads.json>\n");
		return 2;
	}
	if (!self_test()) {
		std::fprintf(stderr, "hillside_corpus: the comparator, the roundings or the invariants cannot tell right from wrong\n");
		return 2;
	}
	bool read_ok = false;
	const std::string text = read_file(file, read_ok);
	auto parsed = insimul::parse_json(text);
	if (!read_ok || !parsed.ok || !parsed.root->is_object()) {
		std::fprintf(stderr, "hillside_corpus: cannot read %s: %s\n", file.c_str(), parsed.error.c_str());
		return 2;
	}
	const JsonValue &doc = *parsed.root;
	const JsonValue *tol_v = doc.find("tolerance");
	const JsonValue *contract = doc.find("contract");
	const JsonValue *cases = doc.find("cases");
	const JsonValue *controls = doc.find("controls");
	if (doc.get_string("area") != "hillside" || !tol_v || !tol_v->is_object() || !tol_v->find("metres") ||
	    !tol_v->find("unit") || !tol_v->find("metres")->is_number() || !tol_v->find("unit")->is_number() || !contract ||
	    !contract->is_object() || !cases || !cases->is_array() || cases->size() == 0 || !controls || !controls->is_array()) {
		std::fprintf(stderr, "hillside_corpus: %s is not the hillside corpus (area, tolerance, contract, cases, controls)\n",
		             file.c_str());
		return 2;
	}
	const Tolerance tol{tol_v->find("metres")->number_value, tol_v->find("unit")->number_value};

	insimul_core *core = insimul_core_create();
	if (!core) {
		std::fprintf(stderr, "hillside_corpus: insimul_core_create() failed\n");
		return 2;
	}
	std::printf("hillside_corpus: %s\n", insimul_core_version());
	{
		const char *m = insimul_core_call(core, "core.methods", nullptr);
		auto mdoc = m ? insimul::parse_json(m).root : nullptr;
		std::set<std::string> rows;
		for (const std::string &name : string_list(mdoc ? mdoc->find("methods") : nullptr)) rows.insert(name);
		for (const char *r : {kPlanRow, kContractRow}) {
			if (!rows.count(r)) {
				std::fprintf(stderr, "hillside_corpus: %s is not in the method table\n", r);
				insimul_core_destroy(core);
				return 2;
			}
		}
	}

	int failed = 0;

	// ── the contract ──
	double wall_max = NAN;
	int contract_keys = 0, contract_bad = 0;
	{
		const char *raw = insimul_core_call(core, kContractRow, nullptr);
		auto row = raw ? insimul::parse_json(raw) : insimul::JsonParseResult{};
		if (!raw || !row.ok || !row.root->is_object()) {
			std::printf("  [FAIL] contract: %s failed: %s\n", kContractRow, raw ? "unparseable" : insimul_core_last_error(core));
			contract_bad++;
		} else {
			const JsonValue &stated = *row.root;
			for (const auto &kv : contract->object_items) {
				const std::string &k = kv.first;
				if (kProse.count(k)) {
					if (!kv.second->is_string()) {
						std::printf("  [FAIL] contract: the file's %s is not prose (a string)\n", k.c_str());
						contract_bad++;
					}
					continue;
				}
				contract_keys++;
				const JsonValue *s = stated.find(k);
				if (!s) {
					std::printf("  [FAIL] contract: the file states %s, which %s does not\n", k.c_str(), kContractRow);
					contract_bad++;
					continue;
				}
				const Tolerance unit{tol.unit, tol.unit};
				const std::string d = compare(*kv.second, *s, unit, "contract." + k, k);
				if (!d.empty()) {
					std::printf("  [FAIL] contract: %s states %s\n", kContractRow, d.c_str());
					contract_bad++;
				}
			}
			for (const auto &kv : stated.object_items) {
				if (!contract->find(kv.first)) {
					std::printf("  [FAIL] contract: %s states %s, which the file does not\n", kContractRow, kv.first.c_str());
					contract_bad++;
				}
			}
			if (const JsonValue *w = stated.find("wallMaxM"); w && w->is_number()) wall_max = w->number_value;
		}
		if (!(wall_max > 0)) {
			std::printf("  [FAIL] contract: no wallMaxM to hold the answers' walls to\n");
			contract_bad++;
			wall_max = 0;
		}
		std::printf("  %s contract: %d data key(s) held to %s, %d problem(s)\n", contract_bad ? "[FAIL]" : "[ ok ]",
		            contract_keys, kContractRow, contract_bad);
		failed += contract_bad;
	}

	// ── the cases ──
	std::map<std::string, JsonValuePtr> answered; // case name → its (agreed) projection
	int case_count = 0, case_failed = 0, calls = 0, skipped = 0;
	for (const auto &cp : cases->array_items) {
		const JsonValue &c = *cp;
		const std::string name = c.get_string("name");
		if (!only.empty() && name.find(only) == std::string::npos) {
			skipped++;
			continue;
		}
		case_count++;
		const auto t0 = std::chrono::steady_clock::now();
		const JsonValue *input = c.find("input");
		const JsonValue *expected = c.find("expected");
		const std::vector<std::string> engines = string_list(input ? input->find("engines") : nullptr);
		std::string why;
		if (!input || !input->is_object() || !expected) why = "no input or no expected";
		else if (engines.empty()) why = "names no engine";
		else if (answered.count(name)) why = "a second case of the same name";
		JsonValuePtr first;
		std::string first_text;
		for (std::size_t e = 0; why.empty() && e < engines.size(); e++) {
			std::string args = "{";
			bool any = false;
			for (const auto &kv : input->object_items) {
				if (kv.first == "engines") continue;
				if (any) args += ',';
				any = true;
				write_string(args, kv.first);
				args += ':';
				write_json(args, *kv.second, true);
			}
			if (any) args += ',';
			args += "\"engine\":";
			write_string(args, engines[e]);
			args += '}';
			calls++;
			const char *raw = insimul_core_call(core, kPlanRow, args.c_str());
			if (!raw) {
				why = engines[e] + ": " + kPlanRow + " failed: " + insimul_core_last_error(core);
				break;
			}
			auto got = insimul::parse_json(raw);
			if (!got.ok) {
				why = engines[e] + ": the row answered unparseable JSON";
				break;
			}
			std::string pwhy;
			JsonValuePtr proj = project(*got.root, *input, pwhy);
			if (!proj) {
				why = engines[e] + ": " + pwhy;
				break;
			}
			const std::string t = text_of(*proj);
			if (e == 0) {
				first = proj;
				first_text = t;
			} else if (t != first_text) {
				why = engines[e] + " answers differently from " + engines[0];
			}
		}
		if (why.empty()) {
			answered[name] = first;
			const std::vector<std::string> flaws = answer_flaws(*expected, wall_max);
			if (!flaws.empty()) why = "the expected answer breaks an invariant: " + flaws[0];
			else why = compare(*expected, *first, tol, "$", "");
		}
		const double ms = std::chrono::duration<double, std::milli>(std::chrono::steady_clock::now() - t0).count();
		if (!why.empty()) {
			std::printf("  [FAIL] case %s — %s (%.0f ms)\n", name.c_str(), why.c_str(), ms);
			case_failed++;
		} else {
			std::printf("  [ ok ] case %s: %zu engine(s) agree (%.0f ms)\n", name.c_str(), engines.size(), ms);
		}
	}
	failed += case_failed;

	// ── the controls ──
	int control_count = 0, control_passed = 0, control_unrun = 0;
	for (const auto &kp : controls->array_items) {
		const JsonValue &k = *kp;
		const std::string name = k.get_string("name");
		const std::string of = k.get_string("case");
		const JsonValue *answer = k.find("answer");
		bool known = false;
		for (const auto &cp : cases->array_items) known = known || cp->get_string("name") == of;
		auto it = answered.find(of);
		if (it == answered.end()) {
			if (known && !only.empty() && of.find(only) == std::string::npos) {
				control_unrun++;
				continue; // its case was not run under --only
			}
			control_count++;
			if (!known || !answer) {
				std::printf("  [ ok ] control %s refused: %s\n", name.c_str(), !known ? ("no case " + of).c_str() : "no answer");
			} else {
				std::printf("  [FAIL] control %s — its case %s has no answer to hold it to\n", name.c_str(), of.c_str());
				control_passed++;
			}
			continue;
		}
		control_count++;
		std::string why;
		if (!answer) {
			why = "no answer";
		} else {
			const std::vector<std::string> flaws = answer_flaws(*answer, wall_max);
			why = !flaws.empty() ? flaws[0] : compare(*it->second, *answer, tol, "$", "");
		}
		if (why.empty()) {
			std::printf("  [FAIL] control %s NOT refused: its answer is what the row answers for %s\n", name.c_str(), of.c_str());
			control_passed++;
		} else {
			std::printf("  [ ok ] control %s refused: %s\n", name.c_str(), why.c_str());
		}
	}
	failed += control_passed;
	insimul_core_destroy(core);

	if (case_count == 0) {
		std::fprintf(stderr, "hillside_corpus: executed no case\n");
		return 2;
	}
	std::printf("hillside_corpus: contract %d key(s), %d problem(s); %d case(s) (%d call(s)), %d failed%s; "
	            "%d control(s), %d not refused%s\n",
	            contract_keys, contract_bad, case_count, calls, case_failed,
	            skipped ? (", " + std::to_string(skipped) + " not run (--only)").c_str() : "", control_count, control_passed,
	            control_unrun ? (", " + std::to_string(control_unrun) + " not run (--only)").c_str() : "");
	if (failed) {
		std::printf("hillside_corpus: FAIL\n");
		return 1;
	}
	std::printf("hillside_corpus: PASS\n");
	return 0;
}
