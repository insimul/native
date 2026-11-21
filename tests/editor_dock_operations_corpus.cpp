// editor_dock_operations_corpus.cpp — core's dock-operations request corpora, driven
// through libinsimulcore's `editor.dockOperations.*` rows.
//
// PL.native-dock-operations-rows (rulings U132, U113, U128, U101(1), U70/U76). Core's
// request builder for the four operations engine editor docks call
// (src/editor/dock-operations.ts: DOCK_OPERATION_IDS, DOCK_OPERATION_RULES and
// dockOperationRequest; PL.core-dock-operations-register) is three rows of
// corebridge/js/entry.js. This gate holds them to core's own corpora,
// conformance/editor-operations/{get-world-ir-summary,reread-reference-texts,
// mint-play-grant,get-entity-neighbourhood}.json, and the area's MANIFEST.json, all
// COPIED byte for byte into corebridge/vendor/core/conformance/editor-operations/ at
// the pin (sha256 in VENDORED.json, checked by the `core_vendor` ctest). Nothing here
// re-writes a case or computes an answer: every answer comes out of the rows.
//
// What is checked, in order:
//
//   manifest   each of the four files hashes to the sha256 MANIFEST.json records for
//              it (so stale vendored bytes are red here, not only in core_vendor), and
//              its cases match MANIFEST.json's caseCounts (total, accept, reject,
//              refuse). A file with response `cases` fails: no row answers them.
//   rules      `editor.dockOperations.ids` names exactly the four files' operations;
//              `editor.dockOperations.rules` has a rule for each and nothing else, and
//              each file's published `row` states that rule: its queryParameters
//              (name, required, enum, in order), its `body` and its `bodyMembers`.
//   requests   every `requestCases` entry is ONE call of `editor.dockOperations.request`
//              with the file's `operationId` and the case's `input` members as args.
//              `expect.outcome: ok` needs `{ ok: true, request }` whose method, path,
//              query and body equal `expect.request` exactly (key sets included), whose
//              operationId is the file's and whose verdict is the published row's.
//              `expect.outcome: error` needs `{ ok: false, error }` whose code and
//              received equal the expectation's, with a non-empty message. `kind`
//              accept goes with ok and refuse with error.
//   codes      every refusal code core states (kCodes) is answered by at least one
//              case, and no case expects a code outside that list.
//   empty body {} counts as no body: the corpus's `{}` cases expect body null, and a
//              probe per operation sends `{}` and must be answered with body null.
//
// The refusal probes prove, on every start, that the rows refuse ([invalid-input]) only
// what core's types exclude, while core's refusals are VALUES. A self-test proves the
// comparator, the perturbations and the manifest check can each fail. The run FAILS on a
// file that is missing or not the editor-operations corpus, on a row missing from the
// method table, on any undriven case, on a session left open.
//
// --negative perturbs every case's expectation (each ok case five ways, each refusal
// three, as Unreal's editor_operations_corpus does) and requires every perturbation to
// be refused by the same comparator.
//
// A pure consumer of insimulcore.h (no quickjs.h, no insimul.h). The JSON reader and the
// sha256 are tests/radiant/{json_value,sha256}.{h,cpp}, used as is.
//
// usage: insimulcore_editor_dock_operations_corpus [--negative] <conformance/editor-operations>

#include "insimulcore.h"
#include "radiant/json_value.h"
#include "radiant/sha256.h"

#include <cstdio>
#include <fstream>
#include <functional>
#include <map>
#include <set>
#include <sstream>
#include <string>
#include <vector>

using insimul::JsonType;
using insimul::JsonValue;
using insimul::JsonValuePtr;

namespace {

const char *const kIds = "editor.dockOperations.ids";
const char *const kRules = "editor.dockOperations.rules";
const char *const kRequest = "editor.dockOperations.request";
const char *const kRows[] = {kIds, kRules, kRequest};

// The four row files of PL.core-dock-operations-register, in the register's order.
const char *const kFiles[] = {"get-world-ir-summary.json", "reread-reference-texts.json", "mint-play-grant.json",
                              "get-entity-neighbourhood.json"};

// Every refusal code core's dockOperationRequest states (DockOperationRefusalCode).
const char *const kCodes[] = {"missing-path-parameter", "missing-query-parameter", "unknown-query-parameter",
                              "query-value-not-allowed", "unexpected-body",          "body-not-object",
                              "unknown-body-member",     "invalid-body-member"};

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

JsonValuePtr parsed(const std::string &text) {
	auto r = insimul::parse_json(text);
	return r.ok ? r.root : nullptr;
}

JsonValuePtr deep_copy(const JsonValue &v) {
	auto c = std::make_shared<JsonValue>(v);
	for (auto &item : c->array_items) item = deep_copy(*item);
	for (auto &kv : c->object_items) kv.second = deep_copy(*kv.second);
	return c;
}

void set_member(JsonValue &object, const std::string &key, JsonValuePtr value) {
	for (auto &kv : object.object_items) {
		if (kv.first == key) {
			kv.second = std::move(value);
			return;
		}
	}
	object.object_items.emplace_back(key, std::move(value));
}

// ── comparing (exact: the corpus states strings, objects and integers) ────────

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

// Empty when `actual` equals `expected` (numbers by value, object key sets both ways).
std::string compare(const JsonValue &expected, const JsonValue &actual, const std::string &path) {
	if (expected.type != actual.type) return path + ": expected a " + kind_of(expected) + ", got a " + kind_of(actual);
	switch (expected.type) {
	case JsonType::Null: return {};
	case JsonType::Bool: return expected.bool_value == actual.bool_value ? std::string() : path + ": boolean differs";
	case JsonType::String:
		return expected.string_value == actual.string_value
		           ? std::string()
		           : path + ": \"" + expected.string_value + "\" != \"" + actual.string_value + "\"";
	case JsonType::Number:
		return expected.number_value == actual.number_value ? std::string()
		                                                    : path + ": " + expected.raw_number + " != " + actual.raw_number;
	case JsonType::Array: {
		if (expected.array_items.size() != actual.array_items.size()) {
			return path + ": length " + std::to_string(expected.array_items.size()) + " != " +
			       std::to_string(actual.array_items.size());
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

// The object's keys, exactly `keys` (any order)?
bool keys_are(const JsonValue &v, const std::set<std::string> &keys) {
	if (!v.is_object() || v.object_items.size() != keys.size()) return false;
	for (const auto &kv : v.object_items) {
		if (!keys.count(kv.first)) return false;
	}
	return true;
}

// One answer of editor.dockOperations.request against one case's `expect`. Empty when
// they agree; otherwise where they do not.
std::string judge(const JsonValue &answer, const JsonValue &expect, const std::string &operation_id,
                  const std::string &verdict) {
	const std::string outcome = expect.get_string("outcome");
	const JsonValue *ok = answer.find("ok");
	if (!ok || ok->type != JsonType::Bool) return "the answer carries no boolean `ok`: " + json_of(answer);
	if (outcome == "ok") {
		if (!ok->bool_value) return "expected a request, got the refusal " + json_of(answer);
		if (!keys_are(answer, {"ok", "request"})) return "an ok answer is { ok, request } and nothing else: " + json_of(answer);
		const JsonValue *req = answer.find("request");
		const JsonValue *want = expect.find("request");
		if (!want || !want->is_object()) return "expect.request is missing";
		if (!req || !keys_are(*req, {"operationId", "method", "path", "query", "body", "verdict"})) {
			return "request is { operationId, method, path, query, body, verdict } (core's DockOperationRequest): " +
			       (req ? json_of(*req) : std::string("none"));
		}
		if (req->get_string("operationId") != operation_id) return "request.operationId is not " + operation_id;
		if (req->get_string("verdict") != verdict) return "request.verdict is not the published row's " + verdict;
		for (const char *k : {"method", "path", "query", "body"}) {
			const JsonValue *w = want->find(k);
			if (!w) return std::string("expect.request has no ") + k;
			std::string why = compare(*w, *req->find(k), std::string("request.") + k);
			if (!why.empty()) return why;
		}
		for (const auto &kv : want->object_items) {
			if (kv.first != "method" && kv.first != "path" && kv.first != "query" && kv.first != "body") {
				return "expect.request names " + kv.first + ", which a request does not carry";
			}
		}
		return {};
	}
	if (outcome == "error") {
		if (ok->bool_value) return "expected the refusal " + expect.get_string("code") + ", got the request " + json_of(answer);
		if (!keys_are(answer, {"ok", "error"})) return "a refusal is { ok, error } and nothing else: " + json_of(answer);
		const JsonValue *err = answer.find("error");
		if (!err || !keys_are(*err, {"code", "message", "received"})) {
			return "error is { code, message, received } (core's DockOperationRefusal): " + (err ? json_of(*err) : std::string("none"));
		}
		const JsonValue *msg = err->find("message");
		if (!msg->is_string() || msg->string_value.empty()) return "error.message is not a non-empty string";
		const JsonValue *code = expect.find("code");
		const JsonValue *received = expect.find("received");
		if (!code || !received) return "expect names no code / received";
		std::string why = compare(*code, *err->find("code"), "error.code");
		if (!why.empty()) return why;
		return compare(*received, *err->find("received"), "error.received");
	}
	return "unknown expect.outcome \"" + outcome + "\"";
}

// Every perturbation of one expectation the comparator must refuse (Unreal's
// editor_operations_corpus Perturbations: an ok case five ways, a refusal three).
std::vector<std::pair<std::string, JsonValuePtr>> perturbations(const JsonValue &expect) {
	std::vector<std::pair<std::string, JsonValuePtr>> out;
	const auto with = [&](const std::string &label, const std::function<void(JsonValue &)> &edit) {
		JsonValuePtr c = deep_copy(expect);
		edit(*c);
		out.emplace_back(label, c);
	};
	const auto req = [](JsonValue &e) -> JsonValue & {
		for (auto &kv : e.object_items) {
			if (kv.first == "request") return *kv.second;
		}
		return e;
	};
	if (expect.get_string("outcome") == "ok") {
		with("outcome flipped to a refusal", [](JsonValue &e) {
			set_member(e, "outcome", parsed("\"error\""));
			set_member(e, "code", parsed("\"missing-path-parameter\""));
			set_member(e, "received", parsed("\"an empty worldId\""));
		});
		with("method moved", [&](JsonValue &e) {
			JsonValue &r = req(e);
			set_member(r, "method", parsed(r.get_string("method") == "GET" ? "\"POST\"" : "\"GET\""));
		});
		with("path moved", [&](JsonValue &e) {
			JsonValue &r = req(e);
			std::string p;
			write_string(p, r.get_string("path") + "/x");
			set_member(r, "path", parsed(p));
		});
		with("query widened", [&](JsonValue &e) {
			JsonValue &r = req(e);
			JsonValuePtr q = r.find("query") ? deep_copy(*r.find("query")) : parsed("{}");
			set_member(*q, "perturbed", parsed("\"1\""));
			set_member(r, "query", q);
		});
		with("body moved", [&](JsonValue &e) {
			JsonValue &r = req(e);
			const JsonValue *b = r.find("body");
			set_member(r, "body", (b == nullptr || b->is_null()) ? parsed("{\"ttlSeconds\":1}") : parsed("null"));
		});
	} else {
		with("outcome flipped to a request", [](JsonValue &e) {
			set_member(e, "outcome", parsed("\"ok\""));
			set_member(e, "request", parsed("{\"method\":\"GET\",\"path\":\"/\",\"query\":{},\"body\":null}"));
		});
		with("code moved", [](JsonValue &e) {
			std::string c;
			write_string(c, e.get_string("code") + "-perturbed");
			set_member(e, "code", parsed(c));
		});
		with("received moved", [](JsonValue &e) {
			std::string c;
			write_string(c, e.get_string("received") + " (perturbed)");
			set_member(e, "received", parsed(c));
		});
	}
	return out;
}

// ── the manifest: sha256 and case counts ─────────────────────────────────────

// Empty when `text` (file `name`'s bytes) is what MANIFEST.json records: its sha256 and,
// from the parsed file, its caseCounts. Otherwise every way it is not.
std::vector<std::string> manifest_problems(const JsonValue &manifest, const std::string &name, const std::string &text) {
	std::vector<std::string> out;
	const JsonValue *files = manifest.find("files");
	const JsonValue *want_sha = files ? files->find(name) : nullptr;
	const std::string sha = insimul::sha256_hex(text);
	if (!want_sha || !want_sha->is_string()) out.push_back(name + ": MANIFEST.json records no sha256 for it");
	else if (want_sha->string_value != sha) {
		out.push_back(name + ": sha256 " + sha + ", MANIFEST.json records " + want_sha->string_value +
		              " (stale vendored bytes: re-vendor at the pin)");
	}
	JsonValuePtr doc = parsed(text);
	if (!doc || !doc->is_object()) {
		out.push_back(name + ": not a JSON object");
		return out;
	}
	const JsonValue *counts = manifest.find("caseCounts");
	const JsonValue *want = counts ? counts->find(name) : nullptr;
	if (!want || !want->is_object()) {
		out.push_back(name + ": MANIFEST.json records no caseCounts for it");
		return out;
	}
	std::map<std::string, long long> have = {{"total", 0}, {"accept", 0}, {"reject", 0}, {"refuse", 0}};
	for (const char *list : {"cases", "requestCases"}) {
		const JsonValue *l = doc->find(list);
		if (!l || !l->is_array()) continue;
		for (const auto &c : l->array_items) {
			have["total"]++;
			const std::string kind = c->get_string("kind");
			if (have.count(kind)) have[kind]++;
		}
	}
	for (const auto &kv : have) {
		const long long w = want->get_int(kv.first, -1);
		if (w != kv.second) {
			out.push_back(name + ": " + std::to_string(kv.second) + " " + kv.first + " case(s) on disk, MANIFEST.json records " +
			              std::to_string(w));
		}
	}
	return out;
}

// ── the self-test: the comparator, the perturbations and the manifest check can fail ─

bool self_test(const JsonValue *manifest, const std::map<std::string, std::string> &texts) {
	bool ok = true;
	auto ok_expect = parsed("{\"outcome\":\"ok\",\"request\":{\"method\":\"POST\",\"path\":\"/a\",\"query\":{},\"body\":null}}");
	auto ok_answer = parsed(
	    "{\"ok\":true,\"request\":{\"operationId\":\"x\",\"method\":\"POST\",\"path\":\"/a\",\"query\":{},\"body\":null,"
	    "\"verdict\":\"served\"}}");
	auto err_expect = parsed("{\"outcome\":\"error\",\"code\":\"unexpected-body\",\"received\":\"null\"}");
	auto err_answer = parsed("{\"ok\":false,\"error\":{\"code\":\"unexpected-body\",\"message\":\"m\",\"received\":\"null\"}}");
	if (!judge(*ok_answer, *ok_expect, "x", "served").empty() || !judge(*err_answer, *err_expect, "x", "served").empty()) {
		std::printf("  [FAIL] self-test: the comparator refused a right answer\n");
		ok = false;
	}
	const std::vector<std::pair<std::string, std::string>> wrong = {
	    {"{\"ok\":true,\"request\":{\"operationId\":\"y\",\"method\":\"POST\",\"path\":\"/a\",\"query\":{},\"body\":null,"
	     "\"verdict\":\"served\"}}",
	     "another operation"},
	    {"{\"ok\":true,\"request\":{\"operationId\":\"x\",\"method\":\"POST\",\"path\":\"/a\",\"query\":{},\"body\":null,"
	     "\"verdict\":\"node-owned\"}}",
	     "another verdict"},
	    {"{\"ok\":true,\"request\":{\"operationId\":\"x\",\"method\":\"POST\",\"path\":\"/a\",\"query\":{},\"body\":{},"
	     "\"verdict\":\"served\"}}",
	     "{} sent as a body"},
	    {"{\"ok\":true,\"request\":{\"operationId\":\"x\",\"method\":\"POST\",\"path\":\"/a\",\"query\":{},\"body\":null,"
	     "\"verdict\":\"served\",\"extra\":1}}",
	     "an extra request member"},
	    {"{\"ok\":true,\"request\":{\"method\":\"POST\",\"path\":\"/a\",\"query\":{},\"body\":null}}", "a request missing members"},
	};
	for (const auto &w : wrong) {
		if (judge(*parsed(w.first), *ok_expect, "x", "served").empty()) {
			std::printf("  [FAIL] self-test: the comparator accepted %s\n", w.second.c_str());
			ok = false;
		}
	}
	if (judge(*parsed("{\"ok\":false,\"error\":{\"code\":\"unexpected-body\",\"message\":\"\",\"received\":\"null\"}}"), *err_expect,
	          "x", "served")
	        .empty()) {
		std::printf("  [FAIL] self-test: the comparator accepted a refusal with no message\n");
		ok = false;
	}
	for (const auto &e : {ok_expect, err_expect}) {
		const JsonValue &right = e == ok_expect ? *ok_answer : *err_answer;
		for (const auto &p : perturbations(*e)) {
			if (judge(right, *p.second, "x", "served").empty()) {
				std::printf("  [FAIL] self-test: the perturbation '%s' was accepted\n", p.first.c_str());
				ok = false;
			}
		}
	}
	// The manifest check: one changed byte in each file, and one case dropped, must each be named.
	if (manifest) {
		for (const auto &kv : texts) {
			std::string stale = kv.second;
			if (stale.empty()) continue;
			stale[stale.size() / 2] = stale[stale.size() / 2] == ' ' ? '\t' : ' ';
			if (manifest_problems(*manifest, kv.first, stale).empty()) {
				std::printf("  [FAIL] self-test: the manifest check accepted %s with one byte changed\n", kv.first.c_str());
				ok = false;
			}
			JsonValuePtr doc = parsed(kv.second);
			if (doc && doc->find("requestCases") && doc->find("requestCases")->size() > 0) {
				for (auto &m : doc->object_items) {
					if (m.first == "requestCases") m.second->array_items.pop_back();
				}
				auto counts = manifest_problems(*manifest, kv.first, json_of(*doc));
				bool named = false;
				for (const auto &why : counts) named = named || why.find("total case(s) on disk") != std::string::npos;
				if (!named) {
					std::printf("  [FAIL] self-test: the manifest check did not count %s one case short\n", kv.first.c_str());
					ok = false;
				}
			}
		}
	}
	return ok;
}

// ── calling the rows ──────────────────────────────────────────────────────────

struct Caller {
	insimul_core *core;
	std::string last_error;

	// The parsed answer, or nullptr with `last_error` set (the row's error).
	JsonValuePtr call(const char *method, const std::string &args) {
		const char *raw = insimul_core_call(core, method, args.c_str());
		if (!raw) {
			last_error = insimul_core_last_error(core);
			return nullptr;
		}
		auto p = insimul::parse_json(raw);
		if (!p.ok || !p.root->is_object()) {
			last_error = std::string(method) + " answered something that is not a JSON object";
			return nullptr;
		}
		return p.root;
	}
};

// The row's args for one case: the file's operationId, then the case's input members.
std::string request_args(const std::string &operation_id, const JsonValue &input) {
	std::string out = "{\"operationId\":";
	write_string(out, operation_id);
	for (const auto &kv : input.object_items) {
		out += ',';
		write_string(out, kv.first);
		out += ':';
		write_json(out, *kv.second);
	}
	return out + "}";
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

bool invalid_input(Caller &c, const std::string &args) {
	return !c.call(kRequest, args) && c.last_error.find("[invalid-input]") != std::string::npos;
}

// core's refusal as a VALUE: { ok: false, error: { code, received } }.
bool refused_as(Caller &c, const std::string &args, const std::string &code, const std::string &received) {
	auto r = c.call(kRequest, args);
	const JsonValue *err = r ? r->find("error") : nullptr;
	return r && r->find("ok") && !r->find("ok")->bool_value && err && err->get_string("code") == code &&
	       err->get_string("received") == received;
}

// A built request whose body is null.
bool built_no_body(Caller &c, const std::string &args) {
	auto r = c.call(kRequest, args);
	const JsonValue *req = r ? r->find("request") : nullptr;
	const JsonValue *body = req ? req->find("body") : nullptr;
	return r && r->find("ok") && r->find("ok")->bool_value && body && body->is_null();
}

void refusal_probes(Caller &c, Probes &p) {
	// What core's types exclude is the [invalid-input] ERROR (core throws for an unknown id).
	p.check(invalid_input(c, "{\"operationId\":\"listWorlds\",\"worldId\":\"w1\"}"), "an operation that is not one of the four was not [invalid-input]");
	p.check(invalid_input(c, "{\"worldId\":\"w1\"}"), "no operationId was not [invalid-input]");
	p.check(invalid_input(c, "{\"operationId\":\"mintPlayGrant\",\"worldId\":5}"), "a worldId that is a number was not [invalid-input]");
	p.check(invalid_input(c, "{\"operationId\":\"mintPlayGrant\",\"worldId\":null}"), "a null worldId was not [invalid-input]");
	p.check(invalid_input(c, "{\"operationId\":\"getWorldIRSummary\",\"worldId\":\"w1\",\"query\":[]}"), "a query that is a list was not [invalid-input]");
	p.check(invalid_input(c, "{\"operationId\":\"getWorldIRSummary\",\"worldId\":\"w1\",\"query\":{\"engine\":1}}"),
	        "a query value that is a number was not [invalid-input]");
	p.check(invalid_input(c, "{\"operationId\":\"mintPlayGrant\",\"worldId\":\"w1\",\"bdy\":{\"ttlSeconds\":60}}"),
	        "a member that is not one of operationId, worldId, query, body was not [invalid-input]");
	p.check(!c.call(kRequest, "[]"), "args that are a list were answered");
	// What core reads is core's to answer, as a VALUE.
	p.check(refused_as(c, "{\"operationId\":\"mintPlayGrant\"}", "missing-path-parameter", "no worldId"),
	        "no worldId was not core's missing-path-parameter (no worldId)");
	p.check(refused_as(c, "{\"operationId\":\"getWorldIRSummary\",\"worldId\":\"w1\",\"body\":0}", "unexpected-body", "the number 0"),
	        "a body of 0 on a read was not core's unexpected-body");
	p.check(built_no_body(c, "{\"operationId\":\"getWorldIRSummary\",\"worldId\":\"w1\",\"query\":null}"), "a null query was not no query");
	p.check(built_no_body(c, "{\"operationId\":\"mintPlayGrant\",\"worldId\":\"w1\",\"body\":null}"), "a null body was not no body");
	// An unknown row is the method table's error.
	p.check(!c.call("editor.dockOperations.send", "{}") && c.last_error.find("unknown method") != std::string::npos,
	        "an unknown row was answered");
}

// {} is no body on every one of the four (core: "An empty object counts as no body").
int empty_body_probes(Caller &c, int &passed) {
	const std::vector<std::string> args = {
	    "{\"operationId\":\"getWorldIRSummary\",\"worldId\":\"w1\",\"body\":{}}",
	    "{\"operationId\":\"rereadReferenceTexts\",\"worldId\":\"w1\",\"body\":{}}",
	    "{\"operationId\":\"mintPlayGrant\",\"worldId\":\"w1\",\"body\":{}}",
	    "{\"operationId\":\"getEntityNeighbourhood\",\"worldId\":\"w1\",\"query\":{\"address\":\"a\"},\"body\":{}}",
	};
	passed = 0;
	for (const std::string &a : args) {
		if (built_no_body(c, a)) passed++;
		else std::printf("  [FAIL] empty body: %s was not built with body null\n", a.c_str());
	}
	return static_cast<int>(args.size());
}

// The published `row` against the rule editor.dockOperations.rules states; empty when they agree.
std::string row_problems(const JsonValue &row, const JsonValue &rule) {
	std::string d;
	const JsonValue *qp = row.find("queryParameters");
	const JsonValue *rq = rule.find("query");
	if (!qp || !qp->is_array() || !rq || !rq->is_array() || qp->size() != rq->size()) {
		d += "queryParameters: " + std::to_string(qp ? qp->size() : 0) + " in the row, " + std::to_string(rq ? rq->size() : 0) +
		     " in the rule; ";
	} else {
		for (std::size_t i = 0; i < qp->size(); i++) {
			const JsonValue &a = *qp->array_items[i];
			const JsonValue &b = *rq->array_items[i];
			const JsonValue *ea = a.find("enum");
			const JsonValue *eb = b.find("enum");
			if (a.get_string("name") != b.get_string("name") || !a.find("required") || !b.find("required") ||
			    a.get_bool("required") != b.get_bool("required") || !ea || !eb || !compare(*ea, *eb, "enum").empty()) {
				d += "query parameter " + a.get_string("name") + " differs from the rule's " + json_of(b) + "; ";
			}
		}
	}
	if (row.get_string("body") != rule.get_string("body") || rule.get_string("body").empty()) {
		d += "body " + row.get_string("body") + " vs the rule's " + rule.get_string("body") + "; ";
	}
	const JsonValue *ma = row.find("bodyMembers");
	const JsonValue *mb = rule.find("bodyMembers");
	if (!ma || !mb || !compare(*ma, *mb, "bodyMembers").empty()) d += "bodyMembers differ; ";
	return d;
}

} // namespace

int main(int argc, char **argv) {
	bool negative = false;
	std::vector<std::string> dirs;
	for (int i = 1; i < argc; i++) {
		const std::string a = argv[i];
		if (a == "--negative") negative = true;
		else dirs.push_back(a);
	}
	if (dirs.size() != 1) {
		std::fprintf(stderr, "usage: insimulcore_editor_dock_operations_corpus [--negative] <conformance/editor-operations>\n");
		return 2;
	}
	const char *tag = negative ? "editor_dock_operations_corpus --negative" : "editor_dock_operations_corpus";
	const std::string &dir = dirs[0];

	bool read_ok = false;
	const std::string manifest_text = read_file(dir + "/MANIFEST.json", read_ok);
	JsonValuePtr manifest = read_ok ? parsed(manifest_text) : nullptr;
	if (!manifest || !manifest->is_object() || manifest->get_string("corpus") != "editor-operations" ||
	    !manifest->find("files") || !manifest->find("caseCounts")) {
		std::fprintf(stderr, "%s: %s/MANIFEST.json is not the editor-operations manifest (corpus, files, caseCounts)\n", tag,
		             dir.c_str());
		return 2;
	}
	std::map<std::string, std::string> texts;
	for (const char *f : kFiles) {
		bool ok = false;
		std::string t = read_file(dir + "/" + f, ok);
		if (!ok) {
			std::fprintf(stderr, "%s: cannot read %s/%s\n", tag, dir.c_str(), f);
			return 2;
		}
		texts[f] = t;
	}
	if (!self_test(manifest.get(), texts)) {
		std::fprintf(stderr, "%s: the comparator, a perturbation or the manifest check cannot tell a wrong answer from a right one\n",
		             tag);
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
		auto m = c.call("core.methods", "{}");
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
	std::printf("refusals: %d of %d probe(s) refused as core refuses (errors: [invalid-input] for what core's types exclude, an "
	            "unknown row; values: core's refusal codes)\n",
	            probes.passed, probes.total);

	// The manifest: every file's sha256 and case counts.
	int manifest_ok = 0;
	std::map<std::string, JsonValuePtr> docs;
	for (const char *f : kFiles) {
		const std::vector<std::string> problems = manifest_problems(*manifest, f, texts[f]);
		for (const std::string &why : problems) std::printf("  [FAIL] manifest: %s\n", why.c_str());
		if (problems.empty()) manifest_ok++;
		else failed++;
		JsonValuePtr doc = parsed(texts[f]);
		if (!doc || doc->get_string("corpus") != "editor-operations" || doc->get_string("operationId").empty() ||
		    !doc->find("row") || !doc->find("requestCases") || !doc->find("requestCases")->is_array()) {
			std::printf("  [FAIL] %s is not an editor-operations row file (corpus, operationId, row, requestCases)\n", f);
			failed++;
			continue;
		}
		const JsonValue *cases = doc->find("cases");
		if (!cases || !cases->is_array() || cases->size() != 0) {
			std::printf("  [FAIL] %s carries response cases, which no editor.dockOperations row answers\n", f);
			failed++;
		}
		docs[f] = doc;
	}
	std::printf("manifest: %d of %zu file(s) match MANIFEST.json's sha256 and case counts\n", manifest_ok,
	            sizeof kFiles / sizeof *kFiles);

	// The rules: ids name the four files' operations; each file's row states its rule.
	int rules_ok = 0;
	{
		auto ids = c.call(kIds, "{}");
		auto rules_answer = c.call(kRules, "{}");
		const JsonValue *id_list = ids ? ids->find("ids") : nullptr;
		const JsonValue *rules = rules_answer ? rules_answer->find("rules") : nullptr;
		std::vector<std::string> want_ids;
		for (const char *f : kFiles) {
			if (docs.count(f)) want_ids.push_back(docs[f]->get_string("operationId"));
		}
		std::vector<std::string> have_ids;
		if (id_list && id_list->is_array()) {
			for (const auto &x : id_list->array_items) have_ids.push_back(x->as_string());
		}
		if (have_ids != want_ids) {
			std::printf("  [FAIL] rules: %s answers %s; the four files, in the register's order, name %zu operation(s)\n", kIds,
			            ids ? json_of(*ids).c_str() : c.last_error.c_str(), want_ids.size());
			failed++;
		}
		if (!rules || !rules->is_object() || rules->object_items.size() != want_ids.size()) {
			std::printf("  [FAIL] rules: %s answers %s, not one rule per operation\n", kRules,
			            rules_answer ? json_of(*rules_answer).c_str() : c.last_error.c_str());
			failed++;
		} else {
			for (const char *f : kFiles) {
				if (!docs.count(f)) continue;
				const std::string op = docs[f]->get_string("operationId");
				const JsonValue *rule = rules->find(op);
				const std::string why = rule ? row_problems(*docs[f]->find("row"), *rule) : "no rule for " + op;
				if (why.empty()) rules_ok++;
				else {
					std::printf("  [FAIL] rules: %s's published row is not %s's rule: %s\n", f, kRules, why.c_str());
					failed++;
				}
			}
		}
	}
	std::printf("rules: %d of %zu published row(s) state the rule editor.dockOperations.rules answers, and "
	            "editor.dockOperations.ids names the files' operations\n",
	            rules_ok, sizeof kFiles / sizeof *kFiles);

	// The request cases.
	int total = 0, driven = 0, perturbed = 0, refused = 0, accepted = 0, empty_cases = 0;
	std::set<std::string> codes_answered;
	for (const char *f : kFiles) {
		if (!docs.count(f)) continue;
		const JsonValue &doc = *docs[f];
		const std::string op = doc.get_string("operationId");
		const std::string verdict = doc.find("row")->get_string("verdict");
		int file_driven = 0, file_failed = 0;
		for (const auto &cp : doc.find("requestCases")->array_items) {
			const JsonValue &cs = *cp;
			const std::string name = std::string(f) + " / " + cs.get_string("name");
			const JsonValue *input = cs.find("input");
			const JsonValue *expect = cs.find("expect");
			total++;
			if (!input || !input->is_object() || !expect || !expect->is_object()) {
				std::printf("  [FAIL] %s — needs an input object and an expect object\n", name.c_str());
				failed++;
				file_failed++;
				continue;
			}
			const std::string outcome = expect->get_string("outcome");
			const std::string kind = cs.get_string("kind");
			if (!((kind == "accept" && outcome == "ok") || (kind == "refuse" && outcome == "error"))) {
				std::printf("  [FAIL] %s — kind %s with outcome %s\n", name.c_str(), kind.c_str(), outcome.c_str());
				failed++;
				file_failed++;
				continue;
			}
			auto answer = c.call(kRequest, request_args(op, *input));
			if (!answer) {
				std::printf("  [FAIL] %s — not driven: %s\n", name.c_str(), c.last_error.c_str());
				failed++;
				file_failed++;
				continue;
			}
			const std::string why = judge(*answer, *expect, op, verdict);
			if (negative) {
				if (!why.empty()) {
					std::printf("  [FAIL] %s (unperturbed) — %s\n", name.c_str(), why.c_str());
					failed++;
					file_failed++;
					continue;
				}
				for (const auto &pt : perturbations(*expect)) {
					perturbed++;
					if (judge(*answer, *pt.second, op, verdict).empty()) {
						std::printf("  [FAIL] %s — the perturbation '%s' was accepted\n", name.c_str(), pt.first.c_str());
						accepted++;
						failed++;
					} else {
						refused++;
					}
				}
			} else if (!why.empty()) {
				std::printf("  [FAIL] %s — %s\n", name.c_str(), why.c_str());
				failed++;
				file_failed++;
				continue;
			}
			driven++;
			file_driven++;
			if (outcome == "error") {
				const std::string code = expect->get_string("code");
				bool known = false;
				for (const char *k : kCodes) known = known || code == k;
				if (!known) {
					std::printf("  [FAIL] %s — expects the code %s, which is not one core's dockOperationRequest states here\n",
					            name.c_str(), code.c_str());
					failed++;
				}
				codes_answered.insert(code);
			}
			const JsonValue *body = input->find("body");
			if (body && body->is_object() && body->object_items.empty()) {
				const JsonValue *req = expect->find("request");
				const JsonValue *want_body = req ? req->find("body") : nullptr;
				if (outcome != "ok" || !want_body || !want_body->is_null()) {
					std::printf("  [FAIL] %s — sends {} and does not expect no body\n", name.c_str());
					failed++;
				} else {
					empty_cases++;
				}
			}
		}
		std::printf("  %s (%s): %d request case(s) driven, %d failed\n", f, op.c_str(), file_driven, file_failed);
	}

	// Every refusal code core states is answered by a corpus case.
	std::string missing_codes;
	for (const char *k : kCodes) {
		if (!codes_answered.count(k)) missing_codes += std::string(missing_codes.empty() ? "" : ", ") + k;
	}
	if (!missing_codes.empty()) {
		std::printf("  [FAIL] codes: no case answers %s\n", missing_codes.c_str());
		failed++;
	}
	std::printf("codes: %zu of %zu refusal code(s) core states answered by the corpus\n", codes_answered.size(),
	            sizeof kCodes / sizeof *kCodes);

	// {} is no body: the corpus's cases and a probe per operation.
	int empty_probes_passed = 0;
	const int empty_probes = empty_body_probes(c, empty_probes_passed);
	if (empty_cases == 0 || empty_probes_passed != empty_probes) failed++;
	std::printf("empty body: %d corpus case(s) and %d of %d probe(s) answer {} as no body\n", empty_cases, empty_probes_passed,
	            empty_probes);

	// No session left open (the rows are stateless).
	{
		auto l = c.call("session.list", "{}");
		const JsonValue *open = l ? l->find("sessions") : nullptr;
		if (!open || !open->is_array() || open->size() != 0) {
			std::printf("  [FAIL] sessions left open: %s\n", open ? json_of(*open).c_str() : "(session.list failed)");
			failed++;
		}
	}
	insimul_core_destroy(core);

	if (negative) {
		if (perturbed == 0) failed++;
		std::printf("%s: %d of %d perturbation(s) refused over %d request case(s), %d accepted, %d failure(s)\n", tag, refused,
		            perturbed, driven, accepted, failed);
	} else {
		std::printf("%s: %d of %d request case(s) driven through %s, %d failed\n", tag, driven, total, kRequest, failed);
	}
	if (failed || driven == 0 || driven != total) {
		std::printf("%s: FAIL\n", tag);
		return 1;
	}
	std::printf("%s: PASS\n", tag);
	return 0;
}
