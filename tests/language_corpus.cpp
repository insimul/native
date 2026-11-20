// language_corpus.cpp — core's P9h language corpora, driven through
// libinsimulcore's `language.*` rows.
//
// PL.native-language-rows, slices 1 and 2 (rulings U128, U118, U107(2), U101(1),
// U49(3), U36). Core's language kernels (src/language-learning/: the book, the save
// block, the prompt selector, hover and its word key, the chat metrics; slice 2: the
// vocabulary bank and the learning profile, the rest of adaptation.ts, listen and
// repeat; and src/prolog/player-language-state.ts, src/language/phonetic-similarity.ts)
// are rows of corebridge/js/entry.js. This gate holds them to core's own corpora,
// conformance/language/{progress,save,prompts,hover,chat,bank,adaptation,
// pronunciation}.json, COPIED byte for byte into corebridge/vendor/core/conformance/
// language/ at the pin and sha256-checked by the `core_vendor` ctest. Nothing here
// re-writes a case or computes an answer: every answer comes out of the rows; this
// file only composes them per op, as core's reference runner
// (src/language-learning/systems-corpus.ts, `runLanguageSystemsOp`) composes core's
// kernels, and builds the answer in the corpus's shape from what the rows answered.
//
//   progress  mastery   language.book.mastery per pair
//             gain      language.book.fluencyGain per conversation
//             run       a book (language.book.empty, then the case's book over it: core's
//                       `bookOf`), then per step: advance, encounter (recordEncounter),
//                       event (encounterOfEvent, then recordEncounter), grammar, conversation,
//                       cefr (setCefr), weak (weakPatterns; findWord and wordView for a word),
//                       summary
//             facts     language.facts.cefr and language.facts.weakDimensions
//   save      block     a book from the encounters (empty, recordEncounter, recordGrammar,
//                       setCefr), language.save.block, language.save.blockOf
//             read      language.save.read
//             restore   language.save.read, then language.save.blockOf (of an empty
//                       language.save.block when there is no block), language.book.summary,
//                       language.book.mastery per word, language.book.weakPatterns
//   prompts   run       language.contract (the default tunings, the case's params over
//                       them), the three initial states, then per step: register
//                       (registerTargets; nameableObjects then registerNameable; registerTags),
//                       pick (props.interactables.examinePick unless the step names its object,
//                       then language.prompts.onPick), standing, answer, reach (quizOnReach),
//                       choose (answerQuiz)
//   hover     tokens    language.hover.tokenize
//             run       language.hover.initial, then per step: hints (addHints), see (seeWord),
//                       mastery (setMastery), lookup, resolve, likely (isLikelyTarget per word),
//                       display
//   chat      words     language.chat.lineWords per line, over the case's book
//             percent   language.chat.targetPercent per pair
//             hear      language.chat.start, then language.chat.hear per check
//             usages    language.chat.questUsages per line
//             run       a book, then per step: start (language.chat.start, and the difficulty
//                       monitor started again: language.difficulty.initial), line
//                       (language.chat.line, then language.difficulty.recordTurn with its
//                       metrics), hear, end (language.chat.finish)
//   bank      cards     a book, language.bank.categories, language.bank.cards (query ?? {})
//             reveal    language.bank.revealsMeaning for each of the runner's three display
//                       modes and three interactions
//             grammar   a book, language.bank.grammarTab, language.bank.analyzeWeaknesses
//                       (options ?? {}), language.bank.strongPatterns (max when a number)
//             tables    language.contract (weaknessVolumePermille, weaknessConfidencePermille)
//             profile   language.profile.build (history ?? [], assessments ?? [])
//             history   language.profile.history, then language.profile.build over it
//   adaptation struggle language.difficulty.signals and language.difficulty.score per turn
//             difficulty language.difficulty.initial, then per step: turn (recordTurn)
//             mode      language.npc.hash (roll = hash mod 100, as the runner derives it), then
//                       language.npc.mode at each of the runner's six bands
//             npc       language.npc.adaptation (native when a string, scaffolding ?? 'none')
//             hint      language.hints.showsVocabHint per check (mastered === true), the check
//                       echoed with its show
//             quests    language.quests.filterByCefr (quests ?? [])
//             advance   language.cefr.advancement per snapshot
//   pronunciation encode language.pronunciation.encode per word
//             similarity language.pronunciation.wordSimilarity per pair
//             score     language.pronunciation.normalize (the spoken line), then
//                       language.pronunciation.score
//             repeat    language.pronunciation.listenAndRepeat (questId when a string)
//             xp        language.pronunciation.xp per score
//             hints     language.pronunciation.hintPenalty per revealed count
//
// Comparison is the corpora's own rule: exact, object key sets included. Each file's
// declared `ops` and `steps` must be exactly the ones this runner drives (core's
// LANGUAGE_SYSTEMS_CORPUS_OPS and _STEPS for the file), so a step core adds is a
// failure here, never a skip. An unknown op or step fails its case. The refusal probes
// show on every start that core's refusals are VALUES (empty_word, unknown_encounter,
// no_target_language, empty_line, no_turns, nothing_in_reach, no_prompt, no_quiz), that
// a book core's own save reader cannot read is the `[invalid-input]` ERROR naming its
// key (as are a vocabulary sort and a band outside core's types), and that an unknown
// row is the method table's error. The run FAILS on a file
// that is not a language corpus or holds no case, on an op of a file that no case
// drives, on a row missing from the method table, on a session left open, and when its
// comparator or its perturbation cannot fail (a self-test on every start).
//
// --negative perturbs EVERY driven case's expectation (its last leaf) and requires
// every one to be refused.
//
// A pure consumer of insimulcore.h (no quickjs.h, no insimul.h). The JSON reader is
// tests/radiant/json_value.{h,cpp}, used as is.
//
// usage: insimulcore_language_corpus [--negative] <conformance/language/<file>.json>...

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

// core's LANGUAGE_SYSTEMS_CORPUS_OPS and LANGUAGE_SYSTEMS_CORPUS_STEPS
// (src/language-learning/systems-corpus.ts) for the files slices 1 and 2 bind.
struct FileSpec {
	const char *file;
	std::vector<std::string> ops;
	std::map<std::string, std::vector<std::string>> steps;
};
const std::vector<FileSpec> kFiles = {
    {"language/progress", {"mastery", "gain", "run", "facts"},
     {{"run", {"advance", "encounter", "event", "grammar", "conversation", "cefr", "weak", "summary"}}}},
    {"language/save", {"block", "read", "restore"}, {}},
    {"language/prompts", {"run"}, {{"run", {"register", "pick", "standing", "answer", "reach", "choose"}}}},
    {"language/hover", {"tokens", "run"}, {{"run", {"hints", "see", "mastery", "lookup", "resolve", "likely", "display"}}}},
    {"language/chat", {"words", "percent", "hear", "usages", "run"}, {{"run", {"start", "line", "hear", "end"}}}},
    // slice 2
    {"language/bank", {"cards", "reveal", "grammar", "tables", "profile", "history"}, {}},
    {"language/adaptation", {"struggle", "difficulty", "mode", "npc", "hint", "quests", "advance"}, {{"difficulty", {"turn"}}}},
    {"language/pronunciation", {"encode", "similarity", "score", "repeat", "xp", "hints"}, {}},
};

// Every row this runner calls.
const char *const kRows[] = {
    "language.contract",          "language.book.empty",          "language.book.mastery",
    "language.book.wordView",     "language.book.findWord",       "language.book.advance",
    "language.book.recordEncounter", "language.book.encounterOfEvent", "language.book.recordGrammar",
    "language.book.weakPatterns", "language.book.fluencyGain",    "language.book.recordConversation",
    "language.book.setCefr",      "language.book.summary",        "language.facts.cefr",
    "language.facts.weakDimensions", "language.save.block",       "language.save.read",
    "language.save.blockOf",      "language.identification.initial", "language.identification.registerTargets",
    "language.naming.initial",    "language.naming.registerNameable", "language.naming.nameableObjects",
    "language.collection.initial", "language.collection.registerTags", "language.prompts.initial",
    "language.prompts.onPick",    "language.prompts.standing",    "language.prompts.answer",
    "language.prompts.quizOnReach", "language.prompts.answerQuiz", "props.interactables.examinePick",
    "language.hover.tokenize",    "language.hover.initial",       "language.hover.addHints",
    "language.hover.seeWord",     "language.hover.setMastery",    "language.hover.isLikelyTarget",
    "language.hover.lookup",      "language.hover.resolve",       "language.hover.display",
    "language.chat.lineWords",    "language.chat.questUsages",    "language.chat.targetPercent",
    "language.chat.start",        "language.chat.hear",           "language.chat.line",
    "language.chat.finish",       "language.difficulty.initial",  "language.difficulty.recordTurn",
    // slice 2
    "language.bank.categories",   "language.bank.cards",          "language.bank.revealsMeaning",
    "language.bank.grammarTab",   "language.bank.analyzeWeaknesses", "language.bank.strongPatterns",
    "language.profile.history",   "language.profile.build",       "language.difficulty.signals",
    "language.difficulty.score",  "language.npc.hash",            "language.npc.mode",
    "language.npc.adaptation",    "language.hints.showsVocabHint", "language.quests.filterByCefr",
    "language.cefr.advancement",  "language.pronunciation.encode", "language.pronunciation.wordSimilarity",
    "language.pronunciation.normalize", "language.pronunciation.score", "language.pronunciation.listenAndRepeat",
    "language.pronunciation.xp",  "language.pronunciation.hintPenalty"};

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
	    {"{\"ok\":false,\"refusal\":\"empty_word\"}", "{\"ok\":false,\"refusal\":\"unknown_encounter\"}", false},
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
	const char *sources[] = {"[{}]", "[]", "{\"cefr\":null,\"weak\":[]}", "[{\"do\":\"display\",\"mode\":\"inline\"}]", "{\"ok\":false,\"keys\":[]}"};
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

struct Run {
	Caller &c;
	std::map<std::string, int> &steps_driven;
	const std::string file;

	void step_known(const std::string &op, const std::string &d) {
		for (const auto &spec : kFiles) {
			if (file != spec.file) continue;
			auto it = spec.steps.find(op);
			if (it != spec.steps.end()) {
				for (const auto &s : it->second) {
					if (s == d) {
						steps_driven[op + ":" + d]++;
						return;
					}
				}
			}
		}
		throw DriveError("step " + d + " is not one of core's " + file + ":" + op + " steps (systems-corpus.ts)");
	}

	// core's `bookOf`: emptyBook(b.language ?? 'fr') with the case's book over it.
	JsonValuePtr book_of(const JsonValue *b) {
		Obj args;
		const JsonValue *lang = b && b->is_object() ? b->find("language") : nullptr;
		if (lang && !lang->is_null()) args.put("language", *lang);
		else args.put("language", "fr");
		Obj book(*member(c.call("language.book.empty", args), "book", "language.book.empty"));
		if (b && b->is_object()) {
			for (const auto &kv : b->object_items) book.put(kv.first, *kv.second);
		}
		return book.v;
	}
};

const std::string &do_of(const JsonValue &step) {
	const JsonValue *d = step.find("do");
	if (!d || !d->is_string()) throw DriveError("a step has no do");
	return d->string_value;
}

// ── progress ──────────────────────────────────────────────────────────────────

JsonValuePtr progress(Run &r, const std::string &op, const JsonValue &input) {
	Caller &c = r.c;
	if (op == "mastery") {
		std::vector<JsonValuePtr> out;
		for (const auto &p : items(need(input, "pairs", "the input"), "pairs")) {
			const auto &pair = items(*p, "a pair");
			if (pair.size() != 2) throw DriveError("a pair is not two numbers");
			Obj a;
			a.put("encountered", *pair[0]).put("halves", *pair[1]);
			auto m = c.call("language.book.mastery", a);
			out.push_back(Obj().put("encountered", *pair[0]).put("halves", *pair[1]).put("mastery", member(m, "mastery", "language.book.mastery")).v);
		}
		return make_array(out);
	}
	if (op == "gain") {
		std::vector<JsonValuePtr> out;
		for (const auto &cv : items(need(input, "conversations", "the input"), "conversations")) {
			Obj a;
			a.put("fluency", need(*cv, "fluency", "a conversation"))
			    .put("uniqueWords", need(*cv, "unique", "a conversation"))
			    .put("grammarCorrect", need(*cv, "grammarCorrect", "a conversation"))
			    .put("grammarAttempted", need(*cv, "grammarAttempted", "a conversation"))
			    .put("turns", need(*cv, "turns", "a conversation"))
			    .put("targetPercent", need(*cv, "targetPercent", "a conversation"));
			out.push_back(c.call("language.book.fluencyGain", a));
		}
		return make_array(out);
	}
	if (op == "facts") {
		const JsonValue *f = input.find("facts");
		JsonValuePtr facts = f ? deep_copy(*f) : make_null();
		Obj a;
		a.put("facts", facts);
		auto cefr = c.call("language.facts.cefr", a);
		const JsonValue *t = input.find("threshold");
		if (t && t->is_number()) a.put("threshold", *t);
		auto weak = c.call("language.facts.weakDimensions", a);
		return Obj().put("cefr", member(cefr, "cefr", "language.facts.cefr")).put("weak", member(weak, "weak", "language.facts.weakDimensions")).v;
	}
	if (op == "run") {
		JsonValuePtr book = r.book_of(input.find("book"));
		std::vector<JsonValuePtr> out;
		for (const auto &sp : items(need(input, "steps", "the input"), "steps")) {
			const JsonValue &st = *sp;
			const std::string d = do_of(st);
			r.step_known(op, d);
			if (d == "advance") {
				auto a = c.call("language.book.advance", Obj().put("book", book).put("ms", need(st, "ms", "an advance step")));
				book = member(a, "book", "language.book.advance");
				out.push_back(Obj().put("do", d).put("clockMs", need(*book, "clockMs", "the book")).v);
			} else if (d == "encounter" || d == "event") {
				JsonValuePtr enc;
				if (d == "event") {
					auto e = c.call("language.book.encounterOfEvent", Obj().put("event", need(st, "event", "an event step")));
					enc = member(e, "encounter", "language.book.encounterOfEvent");
					if (enc->is_null()) {
						out.push_back(Obj().put("do", d).put("heard", make_bool(false)).v);
						continue;
					}
				} else {
					Obj e;
					for (const auto &kv : st.object_items) {
						if (kv.first != "do") e.put(kv.first, *kv.second);
					}
					enc = e.v;
				}
				auto a = c.call("language.book.recordEncounter", Obj().put("book", book).put("encounter", enc));
				book = member(a, "book", "language.book.recordEncounter");
				Obj o;
				o.put("do", d);
				if (ok_of(a, "language.book.recordEncounter")) {
					o.put("ok", make_bool(true))
					    .put("entry", member(a, "entry", "recordEncounter"))
					    .put("isNew", member(a, "isNew", "recordEncounter"))
					    .put("masteryChanged", member(a, "masteryChanged", "recordEncounter"))
					    .put("correctUsages", need(*book, "correctUsages", "the book"))
					    .put("words", make_number(static_cast<double>(items(need(*book, "words", "the book"), "words").size())));
				} else {
					o.put("ok", make_bool(false)).put("refusal", member(a, "refusal", "recordEncounter"));
				}
				out.push_back(o.v);
			} else if (d == "grammar") {
				auto a = c.call("language.book.recordGrammar", Obj().put("book", book).put("feedback", need(st, "feedback", "a grammar step")));
				book = member(a, "book", "language.book.recordGrammar");
				out.push_back(Obj().put("do", d).put("touched", member(a, "touched", "recordGrammar")).put("signals", member(a, "signals", "recordGrammar")).v);
			} else if (d == "conversation") {
				auto a = c.call("language.book.recordConversation", Obj().put("book", book).put("conversation", need(st, "conversation", "a conversation step")));
				book = member(a, "book", "language.book.recordConversation");
				out.push_back(Obj()
				                  .put("do", d)
				                  .put("result", member(a, "result", "recordConversation"))
				                  .put("signals", member(a, "signals", "recordConversation"))
				                  .put("fluency", need(*book, "fluency", "the book"))
				                  .put("cefr", need(*book, "cefr", "the book"))
				                  .put("conversations", need(*book, "conversations", "the book"))
				                  .v);
			} else if (d == "cefr") {
				auto a = c.call("language.book.setCefr", Obj().put("book", book).put("level", need(st, "level", "a cefr step")));
				book = member(a, "book", "language.book.setCefr");
				out.push_back(Obj()
				                  .put("do", d)
				                  .put("cefr", need(*book, "cefr", "the book"))
				                  .put("fluency", need(*book, "fluency", "the book"))
				                  .put("signals", member(a, "signals", "setCefr"))
				                  .v);
			} else if (d == "weak") {
				auto w = c.call("language.book.weakPatterns", Obj().put("book", book));
				Obj o;
				o.put("do", d).put("weak", pluck(*member(w, "patterns", "weakPatterns"), "pattern", "a weak pattern"));
				const JsonValue *word = st.find("word");
				if (word && word->is_string()) {
					auto f = c.call("language.book.findWord", Obj().put("book", book).put("word", *word));
					JsonValuePtr row = member(f, "row", "language.book.findWord");
					if (row->is_null()) o.put("word", make_null());
					else o.put("word", member(c.call("language.book.wordView", Obj().put("row", row)), "view", "language.book.wordView"));
				}
				out.push_back(o.v);
			} else if (d == "summary") {
				Obj o;
				o.put("do", d);
				auto s = c.call("language.book.summary", Obj().put("book", book));
				for (const auto &kv : s->object_items) o.put(kv.first, *kv.second);
				out.push_back(o.v);
			}
		}
		return make_array(out);
	}
	throw DriveError("op " + op + " is not one of core's language/progress ops");
}

// ── save ──────────────────────────────────────────────────────────────────────

JsonValuePtr save(Run &r, const std::string &op, const JsonValue &input) {
	Caller &c = r.c;
	if (op == "block") {
		Obj parts;
		const JsonValue *encounters = input.find("encounters");
		if (encounters && encounters->is_array()) {
			const JsonValue *lang = input.find("language");
			Obj b;
			b.put("language", lang && !lang->is_null() ? deep_copy(*lang) : make_string("fr"));
			JsonValuePtr book = r.book_of(b.v.get());
			for (const auto &e : encounters->array_items) {
				book = member(c.call("language.book.recordEncounter", Obj().put("book", book).put("encounter", *e)), "book", "recordEncounter");
			}
			if (const JsonValue *g = input.find("grammar")) {
				for (const auto &fb : items(*g, "grammar")) {
					book = member(c.call("language.book.recordGrammar", Obj().put("book", book).put("feedback", *fb)), "book", "recordGrammar");
				}
			}
			const JsonValue *cefr = input.find("cefr");
			if (cefr && cefr->is_string() && !cefr->string_value.empty()) {
				book = member(c.call("language.book.setCefr", Obj().put("book", book).put("level", *cefr)), "book", "setCefr");
			}
			parts.put("book", book);
		}
		for (const char *k : {"collected", "naming", "identification"}) {
			const JsonValue *x = input.find(k);
			if (x && !x->is_null()) parts.put(k, *x);
		}
		auto block = member(c.call("language.save.block", parts), "block", "language.save.block");
		return member(c.call("language.save.blockOf", Obj().put("block", block)), "block", "language.save.blockOf");
	}
	Obj args;
	args.copy(input, "block");
	if (op == "read") return c.call("language.save.read", args);
	if (op == "restore") {
		auto read = c.call("language.save.read", args);
		if (!ok_of(read, "language.save.read")) return Obj().put("ok", make_bool(false)).put("keys", member(read, "keys", "language.save.read")).v;
		JsonValuePtr value = member(read, "value", "language.save.read");
		JsonValuePtr from = value->is_null() ? member(c.call("language.save.block", Obj()), "block", "language.save.block") : value;
		auto block = member(c.call("language.save.blockOf", Obj().put("block", from)), "block", "language.save.blockOf");
		const JsonValue *book = value->is_null() ? nullptr : value->find("book");
		Obj o;
		o.put("ok", make_bool(true)).put("block", block);
		if (!book || book->is_null()) {
			o.put("summary", make_null()).put("mastery", make_array()).put("weak", make_array());
			return o.v;
		}
		o.put("summary", c.call("language.book.summary", Obj().put("book", *book)));
		std::vector<JsonValuePtr> mastery;
		for (const auto &w : items(need(*book, "words", "the book"), "words")) {
			auto m = c.call("language.book.mastery", Obj().put("encountered", need(*w, "encountered", "a word")).put("halves", need(*w, "halves", "a word")));
			mastery.push_back(Obj().put("word", need(*w, "word", "a word")).put("mastery", member(m, "mastery", "language.book.mastery")).v);
		}
		o.put("mastery", make_array(mastery));
		auto w = c.call("language.book.weakPatterns", Obj().put("book", *book));
		o.put("weak", pluck(*member(w, "patterns", "weakPatterns"), "pattern", "a weak pattern"));
		return o.v;
	}
	throw DriveError("op " + op + " is not one of core's language/save ops");
}

// ── prompts ───────────────────────────────────────────────────────────────────

JsonValuePtr tuning_of(const JsonValuePtr &contract, const char *key, const JsonValue *over) {
	Obj t(*member(contract, key, "language.contract"));
	if (over && over->is_object()) {
		for (const auto &kv : over->object_items) t.put(kv.first, *kv.second);
	}
	return t.v;
}

JsonValuePtr prompts(Run &r, const std::string &op, const JsonValue &input) {
	Caller &c = r.c;
	if (op != "run") throw DriveError("op " + op + " is not one of core's language/prompts ops");
	const JsonValue *params = input.find("params");
	auto param = [&](const char *k) { return params && params->is_object() ? params->find(k) : nullptr; };
	auto contract = c.call("language.contract", Obj());
	JsonValuePtr identifyTuning = tuning_of(contract, "identificationTuning", param("identification"));
	JsonValuePtr namingTuning = tuning_of(contract, "namingTuning", param("naming"));
	JsonValuePtr collectionTuning = tuning_of(contract, "collectionTuning", param("collection"));
	JsonValuePtr identification = member(c.call("language.identification.initial", Obj()), "state", "identification.initial");
	JsonValuePtr naming = member(c.call("language.naming.initial", Obj()), "state", "naming.initial");
	JsonValuePtr state = member(c.call("language.prompts.initial", Obj()), "state", "prompts.initial");
	JsonValuePtr collection;
	auto target_language = [&]() -> const JsonValue & {
		const JsonValue *t = input.find("targetLanguage");
		if (!t || !t->is_string()) throw DriveError("targetLanguage must be a string");
		return *t;
	};
	auto world = [&]() {
		return Obj()
		    .put("identification", identification)
		    .put("naming", naming)
		    .put("targetLanguage", target_language())
		    .put("identifyTuning", identifyTuning)
		    .put("namingTuning", namingTuning)
		    .v;
	};
	auto tags = [&]() {
		if (!collection) collection = member(c.call("language.collection.initial", Obj().put("seed", need(input, "seed", "the input"))), "state", "collection.initial");
		return collection;
	};
	std::vector<JsonValuePtr> out;
	for (const auto &sp : items(need(input, "steps", "the input"), "steps")) {
		const JsonValue &st = *sp;
		const std::string d = do_of(st);
		r.step_known(op, d);
		if (d == "register") {
			if (const JsonValue *t = st.find("targets")) {
				identification = member(c.call("language.identification.registerTargets", Obj().put("state", identification).put("targets", *t)), "state", "registerTargets");
			}
			if (const JsonValue *w = st.find("world")) {
				auto named = member(c.call("language.naming.nameableObjects", Obj().put("objects", *w).put("targetLanguage", target_language())), "objects", "nameableObjects");
				naming = member(c.call("language.naming.registerNameable", Obj().put("state", naming).put("objects", named)), "state", "registerNameable");
			}
			if (const JsonValue *t = st.find("tags")) {
				collection = member(c.call("language.collection.registerTags", Obj().put("state", tags()).put("tags", *t)), "state", "registerTags");
			}
			out.push_back(Obj()
			                  .put("do", d)
			                  .put("targets", pluck(need(*identification, "targets", "identification"), "id", "a target"))
			                  .put("nameable", pluck(need(*naming, "objects", "naming"), "objectId", "a nameable object"))
			                  .put("tagged", collection ? pluck(need(*collection, "tags", "collection"), "objectId", "a tag") : make_array())
			                  .v);
		} else if (d == "pick") {
			const JsonValue &at_in = need(st, "at", "a pick step");
			auto at = Obj().put("x", need(at_in, "x", "at")).put("z", need(at_in, "z", "at")).v;
			JsonValuePtr pick;
			if (const JsonValue *o = st.find("object")) pick = deep_copy(*o);
			else {
				const JsonValue *objs = st.find("objects");
				auto p = c.call("props.interactables.examinePick", Obj().put("objects", objs ? deep_copy(*objs) : make_array()).put("at", at));
				pick = member(p, "pick", "props.interactables.examinePick");
			}
			auto a = c.call("language.prompts.onPick", Obj().put("state", state).put("pick", pick).put("at", at).put("world", world()));
			state = member(a, "state", "language.prompts.onPick");
			Obj o;
			o.put("do", d);
			if (ok_of(a, "language.prompts.onPick")) {
				const JsonValue *id = pick->is_object() ? pick->find("id") : nullptr;
				o.put("picked", id ? deep_copy(*id) : make_null())
				    .put("ok", make_bool(true))
				    .put("prompt", member(a, "prompt", "onPick"))
				    .put("checked", member(a, "checked", "onPick"))
				    .put("events", member(a, "events", "onPick"));
			} else {
				o.put("picked", make_null()).put("ok", make_bool(false)).put("refusal", member(a, "refusal", "onPick"));
			}
			o.put("standing", need(*state, "pick", "the prompt state"));
			out.push_back(o.v);
		} else if (d == "standing") {
			auto a = c.call("language.prompts.standing", Obj().put("state", state).put("world", world()));
			state = member(a, "state", "language.prompts.standing");
			out.push_back(Obj().put("do", d).put("pick", member(a, "prompt", "standing")).put("quiz", need(*state, "quiz", "the prompt state")).v);
		} else if (d == "answer") {
			auto a = c.call("language.prompts.answer", Obj().put("state", state).put("input", need(st, "input", "an answer step")).put("world", world()));
			state = member(a, "state", "language.prompts.answer");
			identification = member(a, "identification", "language.prompts.answer");
			naming = member(a, "naming", "language.prompts.answer");
			Obj o;
			o.put("do", d);
			if (ok_of(a, "language.prompts.answer")) {
				o.put("ok", make_bool(true));
				for (const char *k : {"kind", "id", "result", "standing"}) o.put(k, member(a, k, "answer"));
			} else {
				o.put("ok", make_bool(false)).put("refusal", member(a, "refusal", "answer"));
			}
			out.push_back(o.v);
		} else if (d == "reach") {
			auto a = c.call("language.prompts.quizOnReach",
			                Obj().put("state", state).put("collection", tags()).put("at", need(st, "at", "a reach step")).put("tuning", collectionTuning));
			state = member(a, "state", "language.prompts.quizOnReach");
			collection = member(a, "collection", "language.prompts.quizOnReach");
			out.push_back(Obj()
			                  .put("do", d)
			                  .put("inReach", member(a, "inReach", "quizOnReach"))
			                  .put("quiz", member(a, "quiz", "quizOnReach"))
			                  .put("standing", need(*state, "quiz", "the prompt state"))
			                  .put("offered", need(*state, "offered", "the prompt state"))
			                  .v);
		} else if (d == "choose") {
			auto a = c.call("language.prompts.answerQuiz",
			                Obj().put("state", state).put("collection", tags()).put("answer", need(st, "answer", "a choose step")).put("tuning", collectionTuning));
			state = member(a, "state", "language.prompts.answerQuiz");
			collection = member(a, "collection", "language.prompts.answerQuiz");
			Obj o;
			o.put("do", d);
			if (!ok_of(a, "language.prompts.answerQuiz")) {
				o.put("ok", make_bool(false)).put("refusal", member(a, "refusal", "answerQuiz"));
			} else {
				o.put("ok", make_bool(true)).put("objectId", member(a, "objectId", "answerQuiz"));
				auto ans = member(a, "answer", "answerQuiz");
				for (const auto &kv : ans->object_items) o.put(kv.first, *kv.second);
				o.put("collected", need(*collection, "collected", "the collection")).put("standing", need(*state, "quiz", "the prompt state"));
			}
			out.push_back(o.v);
		}
	}
	return make_array(out);
}

// ── hover ─────────────────────────────────────────────────────────────────────

JsonValuePtr hover(Run &r, const std::string &op, const JsonValue &input) {
	Caller &c = r.c;
	if (op == "tokens") return c.call("language.hover.tokenize", Obj().put("text", need(input, "text", "the input")));
	if (op != "run") throw DriveError("op " + op + " is not one of core's language/hover ops");
	Obj init;
	const JsonValue *cefr = input.find("cefr");
	init.put("cefr", cefr && !cefr->is_null() ? deep_copy(*cefr) : make_string("A1"));
	const JsonValue *tl = input.find("targetLanguage");
	init.put("targetLanguage", tl && tl->is_string() ? deep_copy(*tl) : make_null());
	JsonValuePtr state = member(c.call("language.hover.initial", init), "state", "language.hover.initial");
	std::vector<JsonValuePtr> out;
	for (const auto &sp : items(need(input, "steps", "the input"), "steps")) {
		const JsonValue &st = *sp;
		const std::string d = do_of(st);
		r.step_known(op, d);
		if (d == "hints") {
			state = member(c.call("language.hover.addHints", Obj().put("state", state).put("hints", need(st, "hints", "a hints step"))), "state", "addHints");
			std::vector<JsonValuePtr> keys;
			for (const auto &pair : items(need(*state, "cache", "the hover state"), "the cache")) {
				const auto &kv = items(*pair, "a cache entry");
				if (kv.empty()) throw DriveError("a cache entry is empty");
				keys.push_back(deep_copy(*kv[0]));
			}
			out.push_back(Obj().put("do", d).put("cached", make_array(keys)).v);
		} else if (d == "see") {
			Obj a;
			a.put("state", state).put("word", need(st, "word", "a see step"));
			a.copy(st, "difficulty");
			auto s = c.call("language.hover.seeWord", a);
			state = member(s, "state", "seeWord");
			out.push_back(Obj().put("do", d).put("showHint", member(s, "showHint", "seeWord")).put("newWordIndex", need(*state, "newWordIndex", "the hover state")).v);
		} else if (d == "mastery") {
			Obj a;
			a.put("state", state).put("word", need(st, "word", "a mastery step")).put("encountered", need(st, "encountered", "a mastery step")).put("correct", need(st, "correct", "a mastery step"));
			state = member(c.call("language.hover.setMastery", a), "state", "setMastery");
			out.push_back(Obj().put("do", d).v);
		} else if (d == "lookup") {
			auto l = c.call("language.hover.lookup", Obj().put("state", state).put("word", need(st, "word", "a lookup step")));
			state = member(l, "state", "lookup");
			Obj o;
			o.put("do", d);
			if (ok_of(l, "language.hover.lookup")) {
				o.put("ok", make_bool(true));
				for (const char *k : {"result", "request", "signals"}) o.put(k, member(l, k, "lookup"));
				o.put("pending", need(*state, "pending", "the hover state"));
			} else {
				o.put("ok", make_bool(false)).put("refusal", member(l, "refusal", "lookup"));
			}
			out.push_back(o.v);
		} else if (d == "resolve") {
			Obj a;
			a.put("state", state).put("word", need(st, "word", "a resolve step"));
			const JsonValue *t = st.find("translation");
			a.put("translation", t ? deep_copy(*t) : make_null());
			const JsonValue *ctx = st.find("context");
			if (ctx && ctx->is_string()) a.put("context", *ctx);
			auto s = c.call("language.hover.resolve", a);
			state = member(s, "state", "resolve");
			out.push_back(Obj()
			                  .put("do", d)
			                  .put("result", member(s, "result", "resolve"))
			                  .put("signals", member(s, "signals", "resolve"))
			                  .put("pending", need(*state, "pending", "the hover state"))
			                  .v);
		} else if (d == "likely") {
			std::vector<JsonValuePtr> words;
			for (const auto &w : items(need(st, "words", "a likely step"), "words")) {
				auto l = c.call("language.hover.isLikelyTarget", Obj().put("state", state).put("word", *w));
				words.push_back(Obj().put("word", *w).put("likely", member(l, "likely", "isLikelyTarget")).v);
			}
			out.push_back(Obj().put("do", d).put("words", make_array(words)).v);
		} else if (d == "display") {
			auto s = c.call("language.hover.display", Obj().put("state", state));
			Obj o;
			o.put("do", d);
			for (const auto &kv : s->object_items) o.put(kv.first, *kv.second);
			o.put("encounters", need(*state, "mastery", "the hover state"));
			out.push_back(o.v);
		}
	}
	return make_array(out);
}

// ── chat ──────────────────────────────────────────────────────────────────────

JsonValuePtr chat(Run &r, const std::string &op, const JsonValue &input) {
	Caller &c = r.c;
	const JsonValue *worldWords = input.find("worldWords");
	auto with_words = [&](Obj &a, const JsonValuePtr &book) {
		a.put("book", book);
		if (worldWords) a.put("worldWords", *worldWords);
	};
	if (op == "words" || op == "usages") {
		JsonValuePtr book = r.book_of(input.find("book"));
		std::vector<JsonValuePtr> out;
		for (const auto &line : items(need(input, "lines", "the input"), "lines")) {
			Obj a;
			a.put("line", *line);
			if (op == "usages") a.put("questWords", need(input, "questWords", "the input"));
			with_words(a, book);
			Obj o;
			o.put("line", *line);
			if (op == "words") {
				auto w = c.call("language.chat.lineWords", a);
				for (const auto &kv : w->object_items) o.put(kv.first, *kv.second);
			} else {
				o.put("usages", member(c.call("language.chat.questUsages", a), "usages", "questUsages"));
			}
			out.push_back(o.v);
		}
		return make_array(out);
	}
	if (op == "percent") {
		std::vector<JsonValuePtr> out;
		for (const auto &p : items(need(input, "pairs", "the input"), "pairs")) {
			const auto &pair = items(*p, "a pair");
			if (pair.size() != 2) throw DriveError("a pair is not two numbers");
			auto t = c.call("language.chat.targetPercent", Obj().put("used", *pair[0]).put("turns", *pair[1]));
			out.push_back(Obj().put("used", *pair[0]).put("turns", *pair[1]).put("targetPercent", member(t, "targetPercent", "targetPercent")).v);
		}
		return make_array(out);
	}
	if (op == "hear") {
		JsonValuePtr session = member(c.call("language.chat.start", Obj()), "session", "language.chat.start");
		std::vector<JsonValuePtr> out;
		for (const auto &check : items(need(input, "checks", "the input"), "checks")) {
			session = member(c.call("language.chat.hear", Obj().put("session", session).put("check", *check)), "session", "language.chat.hear");
			const JsonValue &gc = need(*session, "grammarCorrect", "the session");
			const JsonValue &ge = need(*session, "grammarErrors", "the session");
			out.push_back(Obj()
			                  .put("status", need(*check, "status", "a check"))
			                  .put("grammarCorrect", gc)
			                  .put("grammarErrors", ge)
			                  .put("grammarChecked", make_number(gc.number_value + ge.number_value))
			                  .v);
		}
		return make_array(out);
	}
	if (op != "run") throw DriveError("op " + op + " is not one of core's language/chat ops");
	JsonValuePtr book = r.book_of(input.find("book"));
	JsonValuePtr session;
	JsonValuePtr difficulty = member(c.call("language.difficulty.initial", Obj()), "state", "language.difficulty.initial");
	std::vector<JsonValuePtr> out;
	for (const auto &sp : items(need(input, "steps", "the input"), "steps")) {
		const JsonValue &st = *sp;
		const std::string d = do_of(st);
		r.step_known(op, d);
		if (d != "start" && !session) throw DriveError("chat " + d + " with no chat open");
		if (d == "start") {
			Obj a;
			a.copy(st, "npc", "npcName");
			session = member(c.call("language.chat.start", a), "session", "language.chat.start");
			difficulty = member(c.call("language.difficulty.initial", Obj()), "state", "language.difficulty.initial");
			out.push_back(Obj().put("do", d).put("session", session).v);
		} else if (d == "line") {
			Obj a;
			a.put("session", session).put("line", need(st, "text", "a line step"));
			with_words(a, book);
			auto l = c.call("language.chat.line", a);
			session = member(l, "session", "language.chat.line");
			Obj o;
			o.put("do", d);
			if (!ok_of(l, "language.chat.line")) {
				o.put("ok", make_bool(false)).put("refusal", member(l, "refusal", "line")).put("turns", need(*session, "turns", "the session"));
			} else {
				auto t = c.call("language.difficulty.recordTurn", Obj().put("state", difficulty).put("metrics", member(l, "metrics", "line")));
				difficulty = member(t, "state", "language.difficulty.recordTurn");
				o.put("ok", make_bool(true))
				    .put("metrics", member(l, "metrics", "line"))
				    .put("wordsUsed", member(l, "wordsUsed", "line"))
				    .put("turns", need(*session, "turns", "the session"))
				    .put("chatWords", need(*session, "wordsUsed", "the session"))
				    .put("struggle", member(t, "struggle", "recordTurn"))
				    .put("level", need(*difficulty, "level", "the difficulty state"))
				    .put("adjustment", member(t, "adjustment", "recordTurn"));
			}
			out.push_back(o.v);
		} else if (d == "hear") {
			session = member(c.call("language.chat.hear", Obj().put("session", session).put("check", need(st, "check", "a hear step"))), "session", "language.chat.hear");
			out.push_back(Obj().put("do", d).put("grammarCorrect", need(*session, "grammarCorrect", "the session")).put("grammarErrors", need(*session, "grammarErrors", "the session")).v);
		} else if (d == "end") {
			auto f = c.call("language.chat.finish", Obj().put("book", book).put("session", session));
			book = member(f, "book", "language.chat.finish");
			session.reset();
			Obj o;
			o.put("do", d);
			if (ok_of(f, "language.chat.finish")) {
				o.put("ok", make_bool(true));
				for (const char *k : {"conversation", "result", "signals"}) o.put(k, member(f, k, "finish"));
				o.put("fluency", need(*book, "fluency", "the book")).put("conversations", need(*book, "conversations", "the book"));
				std::vector<JsonValuePtr> words;
				for (const auto &w : items(need(*book, "words", "the book"), "words")) {
					words.push_back(Obj().put("word", need(*w, "word", "a word")).put("encountered", need(*w, "encountered", "a word")).put("correct", need(*w, "correct", "a word")).v);
				}
				o.put("bookWords", make_array(words));
			} else {
				o.put("ok", make_bool(false)).put("refusal", member(f, "refusal", "finish")).put("conversations", need(*book, "conversations", "the book"));
			}
			out.push_back(o.v);
		}
	}
	return make_array(out);
}

// ── bank (slice 2) ────────────────────────────────────────────────────────────

JsonValuePtr bank(Run &r, const std::string &op, const JsonValue &input) {
	Caller &c = r.c;
	if (op == "cards") {
		// { categories: bankCategories(book), cards: bankCards(book, input.query ?? {}) }
		JsonValuePtr book = r.book_of(input.find("book"));
		Obj o;
		o.put("categories", member(c.call("language.bank.categories", Obj().put("book", book)), "categories", "language.bank.categories"));
		Obj a;
		a.put("book", book);
		const JsonValue *q = input.find("query");
		a.put("query", q && !q->is_null() ? deep_copy(*q) : Obj().v);
		o.put("cards", member(c.call("language.bank.cards", a), "cards", "language.bank.cards"));
		return o.v;
	}
	if (op == "reveal") {
		// core's runner lists the three display modes and the three interactions itself.
		std::vector<JsonValuePtr> out;
		for (const char *mode : {"inline", "hover", "click"}) {
			Obj o;
			o.put("mode", mode);
			for (const char *interaction : {"idle", "gaze", "select"}) {
				auto v = c.call("language.bank.revealsMeaning", Obj().put("reveal", mode).put("interaction", interaction));
				o.put(interaction, member(v, "reveals", "language.bank.revealsMeaning"));
			}
			out.push_back(o.v);
		}
		return make_array(out);
	}
	if (op == "grammar") {
		// { tab: grammarTab(book), analysis: analyzeWeaknesses(book, input.options ?? {}), strong: strongPatterns(book, max when a number) }
		JsonValuePtr book = r.book_of(input.find("book"));
		Obj o;
		o.put("tab", member(c.call("language.bank.grammarTab", Obj().put("book", book)), "tab", "language.bank.grammarTab"));
		Obj a;
		a.put("book", book);
		const JsonValue *opts = input.find("options");
		a.put("options", opts && !opts->is_null() ? deep_copy(*opts) : Obj().v);
		o.put("analysis", c.call("language.bank.analyzeWeaknesses", a));
		Obj s;
		s.put("book", book);
		const JsonValue *max = input.find("max");
		if (max && max->type == JsonType::Number) s.put("max", *max);
		o.put("strong", member(c.call("language.bank.strongPatterns", s), "patterns", "language.bank.strongPatterns"));
		return o.v;
	}
	if (op == "tables") {
		auto k = c.call("language.contract", Obj());
		return Obj()
		    .put("volume", member(k, "weaknessVolumePermille", "language.contract"))
		    .put("confidence", member(k, "weaknessConfidencePermille", "language.contract"))
		    .v;
	}
	auto list_or_empty = [&](const char *key) {
		const JsonValue *v = input.find(key);
		return v && !v->is_null() ? deep_copy(*v) : make_array();
	};
	if (op == "profile") {
		return c.call("language.profile.build", Obj().put("history", list_or_empty("history")).put("assessments", list_or_empty("assessments")));
	}
	if (op == "history") {
		// learningHistory over the host's records, then the profile over that history.
		auto history = member(c.call("language.profile.history", Obj().put("quests", list_or_empty("quests"))), "history", "language.profile.history");
		auto profile = c.call("language.profile.build", Obj().put("history", history).put("assessments", list_or_empty("assessments")));
		return Obj().put("history", history).put("profile", profile).v;
	}
	throw DriveError("op " + op + " is not one of core's language/bank ops");
}

// ── adaptation (slice 2) ──────────────────────────────────────────────────────

JsonValuePtr adaptation(Run &r, const std::string &op, const JsonValue &input) {
	Caller &c = r.c;
	if (op == "struggle") {
		std::vector<JsonValuePtr> out;
		for (const auto &m : items(need(input, "turns", "the input"), "turns")) {
			auto sig = member(c.call("language.difficulty.signals", Obj().put("metrics", *m)), "signals", "language.difficulty.signals");
			auto score = member(c.call("language.difficulty.score", Obj().put("metrics", *m)), "score", "language.difficulty.score");
			out.push_back(Obj().put("signals", sig).put("score", score).v);
		}
		return make_array(out);
	}
	if (op == "difficulty") {
		JsonValuePtr state = member(c.call("language.difficulty.initial", Obj()), "state", "language.difficulty.initial");
		std::vector<JsonValuePtr> out;
		for (const auto &sp : items(need(input, "steps", "the input"), "steps")) {
			const std::string d = do_of(*sp);
			r.step_known(op, d);
			auto t = c.call("language.difficulty.recordTurn", Obj().put("state", state).put("metrics", need(*sp, "metrics", "a turn step")));
			state = member(t, "state", "language.difficulty.recordTurn");
			Obj o;
			o.put("do", d).put("struggle", member(t, "struggle", "recordTurn"));
			for (const char *k : {"level", "high", "low", "turns", "scaffolded", "stretched"}) o.put(k, need(*state, k, "the difficulty state"));
			o.put("adjustment", member(t, "adjustment", "recordTurn"));
			out.push_back(o.v);
		}
		return make_array(out);
	}
	if (op == "mode") {
		// { id, hash, roll: hash mod 100, modes: the mode at each band } — core's runner lists the six bands itself.
		std::vector<JsonValuePtr> out;
		for (const auto &id : items(need(input, "npcs", "the input"), "npcs")) {
			auto hash = member(c.call("language.npc.hash", Obj().put("id", *id)), "hash", "language.npc.hash");
			if (hash->type != JsonType::Number) throw DriveError("language.npc.hash answered no number");
			Obj modes;
			for (const char *band : {"A1", "A2", "B1", "B2", "C1", "C2"}) {
				modes.put(band, member(c.call("language.npc.mode", Obj().put("level", band).put("npcId", *id)), "mode", "language.npc.mode"));
			}
			out.push_back(Obj().put("id", *id).put("hash", hash).put("roll", make_number(std::fmod(hash->number_value, 100.0))).put("modes", modes.v).v);
		}
		return make_array(out);
	}
	if (op == "npc") {
		// npcAdaptation(level, npcId, target, native when a string, scaffolding ?? 'none')
		Obj a;
		a.put("level", need(input, "level", "the input")).put("npcId", need(input, "npcId", "the input")).put("target", need(input, "target", "the input"));
		const JsonValue *native = input.find("native");
		if (native && native->is_string()) a.put("native", *native);
		const JsonValue *sc = input.find("scaffolding");
		a.put("scaffolding", sc && !sc->is_null() ? deep_copy(*sc) : make_string("none"));
		return c.call("language.npc.adaptation", a);
	}
	if (op == "hint") {
		// { ...check, show: showsVocabHint(level, index, difficulty, mastered === true) }
		std::vector<JsonValuePtr> out;
		for (const auto &ch : items(need(input, "checks", "the input"), "checks")) {
			Obj a;
			a.put("level", need(*ch, "level", "a check")).put("index", need(*ch, "index", "a check"));
			if (const JsonValue *d = ch->find("difficulty")) a.put("difficulty", *d);
			const JsonValue *m = ch->find("mastered");
			a.put("mastered", make_bool(m && m->type == JsonType::Bool && m->bool_value));
			Obj o(*ch);
			o.put("show", member(c.call("language.hints.showsVocabHint", a), "show", "language.hints.showsVocabHint"));
			out.push_back(o.v);
		}
		return make_array(out);
	}
	if (op == "quests") {
		const JsonValue *q = input.find("quests");
		auto shown = c.call("language.quests.filterByCefr", Obj().put("quests", q && !q->is_null() ? deep_copy(*q) : make_array()).put("level", need(input, "level", "the input")));
		return Obj().put("shown", member(shown, "shown", "language.quests.filterByCefr")).v;
	}
	if (op == "advance") {
		std::vector<JsonValuePtr> out;
		for (const auto &snap : items(need(input, "snapshots", "the input"), "snapshots")) out.push_back(c.call("language.cefr.advancement", Obj().put("snapshot", *snap)));
		return make_array(out);
	}
	throw DriveError("op " + op + " is not one of core's language/adaptation ops");
}

// ── pronunciation (slice 2) ───────────────────────────────────────────────────

JsonValuePtr pronunciation(Run &r, const std::string &op, const JsonValue &input) {
	Caller &c = r.c;
	if (op == "encode") {
		std::vector<JsonValuePtr> out;
		for (const auto &w : items(need(input, "words", "the input"), "words")) {
			out.push_back(Obj().put("word", *w).put("code", member(c.call("language.pronunciation.encode", Obj().put("word", *w)), "code", "encode")).v);
		}
		return make_array(out);
	}
	if (op == "similarity") {
		std::vector<JsonValuePtr> out;
		for (const auto &p : items(need(input, "pairs", "the input"), "pairs")) {
			const auto &pair = items(*p, "a pair");
			if (pair.size() != 2) throw DriveError("a pair is not two strings");
			Obj o;
			o.put("expected", *pair[0]).put("spoken", *pair[1]);
			auto s = c.call("language.pronunciation.wordSimilarity", Obj().put("expected", *pair[0]).put("spoken", *pair[1]));
			for (const auto &kv : s->object_items) o.put(kv.first, *kv.second);
			out.push_back(o.v);
		}
		return make_array(out);
	}
	if (op == "score") {
		// { normalized: normalizePhrase(spoken), ...scorePhrase(expected, spoken) }
		const JsonValue &spoken = need(input, "spoken", "the input");
		Obj o;
		o.put("normalized", member(c.call("language.pronunciation.normalize", Obj().put("text", spoken)), "normalized", "normalize"));
		auto s = c.call("language.pronunciation.score", Obj().put("expected", need(input, "expected", "the input")).put("spoken", spoken));
		for (const auto &kv : s->object_items) o.put(kv.first, *kv.second);
		return o.v;
	}
	if (op == "repeat") {
		// listenAndRepeat(phrase, spoken, questId when a string)
		Obj a;
		a.put("phrase", need(input, "phrase", "the input")).put("spoken", need(input, "spoken", "the input"));
		const JsonValue *q = input.find("questId");
		if (q && q->is_string()) a.put("questId", *q);
		return c.call("language.pronunciation.listenAndRepeat", a);
	}
	if (op == "xp") {
		std::vector<JsonValuePtr> out;
		for (const auto &s : items(need(input, "scores", "the input"), "scores")) {
			out.push_back(Obj().put("score", *s).put("xp", member(c.call("language.pronunciation.xp", Obj().put("score", *s)), "xp", "xp")).v);
		}
		return make_array(out);
	}
	if (op == "hints") {
		std::vector<JsonValuePtr> out;
		for (const auto &rv : items(need(input, "revealed", "the input"), "revealed")) {
			Obj a;
			a.put("score", need(input, "score", "the input")).put("penalties", need(input, "penalties", "the input")).put("revealed", *rv);
			out.push_back(Obj().put("revealed", *rv).put("score", member(c.call("language.pronunciation.hintPenalty", a), "score", "hintPenalty")).v);
		}
		return make_array(out);
	}
	throw DriveError("op " + op + " is not one of core's language/pronunciation ops");
}

JsonValuePtr drive(Run &r, const std::string &op, const JsonValue &input) {
	for (const auto &spec : kFiles) {
		if (r.file != spec.file) continue;
		bool known = false;
		for (const auto &o : spec.ops) known = known || o == op;
		if (!known) throw DriveError("op " + op + " is not one of core's " + r.file + " ops (systems-corpus.ts)");
	}
	if (r.file == "language/progress") return progress(r, op, input);
	if (r.file == "language/save") return save(r, op, input);
	if (r.file == "language/prompts") return prompts(r, op, input);
	if (r.file == "language/hover") return hover(r, op, input);
	if (r.file == "language/chat") return chat(r, op, input);
	if (r.file == "language/bank") return bank(r, op, input);
	if (r.file == "language/adaptation") return adaptation(r, op, input);
	if (r.file == "language/pronunciation") return pronunciation(r, op, input);
	throw DriveError("file " + r.file + " is not one this runner drives");
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

std::string refusal_of(const JsonValuePtr &answer) {
	if (!answer) return {};
	const JsonValue *ok = answer->find("ok");
	const JsonValue *r = answer->find("refusal");
	return ok && ok->type == JsonType::Bool && !ok->bool_value && r && r->is_string() ? r->string_value : std::string();
}

void refusal_probes(Caller &c, std::map<std::string, int> &sink, Probes &p) {
	auto parse = [](const char *t) { return insimul::parse_json(t).root; };
	// 1-2. An op or step this runner does not know fails its case.
	{
		bool refused = false;
		try {
			Run r{c, sink, "language/progress"};
			drive(r, "fly", *parse("{}"));
		} catch (const DriveError &) {
			refused = true;
		}
		p.check(refused, "an unknown op (fly) was driven");
		refused = false;
		try {
			Run r{c, sink, "language/hover"};
			drive(r, "run", *parse("{\"steps\":[{\"do\":\"fly\"}]}"));
		} catch (const DriveError &) {
			refused = true;
		}
		p.check(refused, "an unknown step (fly) was driven");
	}
	const std::string book = "{\"language\":\"fr\",\"clockMs\":0,\"fluency\":0,\"cefr\":null,\"conversations\":0,\"correctUsages\":0,\"words\":[],\"grammar\":[]}";
	// 3-4. The book's refusals are values, the book handed back.
	{
		auto e = c.try_call("language.book.recordEncounter", "{\"book\":" + book + ",\"encounter\":{\"word\":\"  \"}}");
		p.check(refusal_of(e) == "empty_word" && e->find("book"), "an empty word was not refused empty_word with the book");
		auto u = c.try_call("language.book.recordEncounter", "{\"book\":" + book + ",\"encounter\":{\"word\":\"pain\",\"type\":\"shouted\"}}");
		p.check(refusal_of(u) == "unknown_encounter", "an unknown encounter was not refused unknown_encounter");
	}
	// 5. Hover with no target language refuses a miss, a value.
	{
		auto h = c.try_call("language.hover.initial", "{}");
		const JsonValue *s = h ? h->find("state") : nullptr;
		auto l = s ? c.try_call("language.hover.lookup", "{\"state\":" + json_of(*s) + ",\"word\":\"pain\"}") : nullptr;
		p.check(refusal_of(l) == "no_target_language", "a miss with no target language was not refused no_target_language");
	}
	// 6. The chat's refusals are values.
	{
		const std::string s0 = "{\"npcName\":\"\",\"turns\":0,\"wordsUsed\":[],\"grammarCorrect\":0,\"grammarErrors\":0}";
		auto l = c.try_call("language.chat.line", "{\"session\":" + s0 + ",\"line\":\"  \",\"book\":" + book + "}");
		p.check(refusal_of(l) == "empty_line", "an empty line was not refused empty_line");
		auto f = c.try_call("language.chat.finish", "{\"session\":" + s0 + ",\"book\":" + book + "}");
		p.check(refusal_of(f) == "no_turns", "a chat of no turns was not refused no_turns");
	}
	// 7. The prompt selector's refusals are values.
	{
		const std::string st = "{\"pick\":null,\"quiz\":null,\"offered\":[]}";
		const std::string world = "{\"identification\":{\"targets\":[],\"progress\":{}},\"naming\":{\"objects\":[],\"attempts\":{},\"named\":[]},\"targetLanguage\":\"fr\"}";
		auto n = c.try_call("language.prompts.onPick", "{\"state\":" + st + ",\"pick\":null,\"at\":{\"x\":0,\"z\":0},\"world\":" + world + "}");
		p.check(refusal_of(n) == "nothing_in_reach", "a pick of nothing was not refused nothing_in_reach");
		auto a = c.try_call("language.prompts.answer", "{\"state\":" + st + ",\"input\":\"puits\",\"world\":" + world + "}");
		p.check(refusal_of(a) == "no_prompt", "an answer with no prompt was not refused no_prompt");
		const std::string coll = "{\"seed\":\"s\",\"tags\":[],\"pool\":[],\"collected\":[],\"quizzes\":{}}";
		auto q = c.try_call("language.prompts.answerQuiz", "{\"state\":" + st + ",\"collection\":" + coll + ",\"answer\":\"bread\"}");
		p.check(refusal_of(q) == "no_quiz", "a choice with no quiz was not refused no_quiz");
	}
	// 8. A book core's own save reader cannot read is the [invalid-input] ERROR, naming its key.
	{
		auto s = c.try_call("language.book.summary", "{\"book\":{\"words\":\"pain\"}}");
		p.check(!s && c.last_error.find("[invalid-input]") != std::string::npos && c.last_error.find("book.words") != std::string::npos,
		        "an unreadable book was not [invalid-input] naming book.words");
	}
	// 9. Slice 2: a vocabulary sort outside core's VOCABULARY_SORTS (core throws) and a band
	// outside core's CEFRLevel are the [invalid-input] ERROR naming the member.
	{
		auto s = c.try_call("language.bank.cards", "{\"book\":" + book + ",\"query\":{\"sort\":\"length\"}}");
		p.check(!s && c.last_error.find("[invalid-input]") != std::string::npos && c.last_error.find("query.sort") != std::string::npos,
		        "an unknown vocabulary sort was not [invalid-input] naming query.sort");
		auto m = c.try_call("language.npc.mode", "{\"level\":\"D1\",\"npcId\":\"ada\"}");
		p.check(!m && c.last_error.find("[invalid-input]") != std::string::npos && c.last_error.find("`level`") != std::string::npos,
		        "an unknown band was not [invalid-input] naming level");
	}
	// 10. An unknown row is the method table's error.
	{
		auto r = c.try_call("language.book.fly", "{}");
		p.check(!r && c.last_error.find("unknown method") != std::string::npos, "an unknown row was answered");
	}
}

} // namespace

int main(int argc, char **argv) {
	bool negative = false;
	std::vector<std::string> paths;
	for (int i = 1; i < argc; i++) {
		const std::string a = argv[i];
		if (a == "--negative") negative = true;
		else paths.push_back(a);
	}
	if (paths.empty()) {
		std::fprintf(stderr, "usage: insimulcore_language_corpus [--negative] <conformance/language/<file>.json>...\n");
		return 2;
	}
	const char *tag = negative ? "language_corpus --negative" : "language_corpus";
	if (!self_test()) {
		std::fprintf(stderr, "%s: the comparator or the perturbation cannot tell a wrong answer from a right one\n", tag);
		return 2;
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
	refusal_probes(c, probe_steps, probes);
	if (probes.passed != probes.total) failed++;
	std::printf("refusals: %d of %d probe(s) refused as core refuses (values: empty_word, unknown_encounter, no_target_language, "
	            "empty_line, no_turns, nothing_in_reach, no_prompt, no_quiz; errors: [invalid-input] for an unreadable book, an "
	            "unknown vocabulary sort, an unknown band, an unknown row; an unknown op or step fails its case)\n",
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
		if (doc.get_string("area") != "language" || !spec || !case_list || !case_list->is_array() || case_list->size() == 0) {
			std::printf("  [FAIL] %s is not a language corpus this runner drives, or holds no case\n", path.c_str());
			failed++;
			continue;
		}
		seen_files.insert(file);
		// The file's declared ops and steps are exactly the ones driven here.
		{
			std::vector<std::string> ops;
			if (const JsonValue *o = doc.find("ops")) {
				for (const auto &x : o->array_items) ops.push_back(x->as_string());
			}
			bool steps_same = true;
			const JsonValue *steps = doc.find("steps");
			std::size_t declared = 0;
			if (steps && steps->is_object()) {
				for (const auto &kv : steps->object_items) {
					declared++;
					auto it = spec->steps.find(kv.first);
					std::vector<std::string> got;
					for (const auto &x : kv.second->array_items) got.push_back(x->as_string());
					if (it == spec->steps.end() || it->second != got) steps_same = false;
				}
			}
			if (ops != spec->ops || !steps_same || declared != spec->steps.size()) {
				std::printf("  [FAIL] %s: its ops or steps are not the ones this runner drives (core's LANGUAGE_SYSTEMS_CORPUS_OPS/_STEPS)\n", file.c_str());
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
				Run r{c, steps_driven, file};
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
		for (const auto &kv : spec->steps) {
			for (const auto &s : kv.second) {
				const std::string key = kv.first + ":" + s;
				const int n = steps_driven.count(key) ? steps_driven[key] : 0;
				by_step += (by_step.empty() ? "" : ", ") + s + " " + std::to_string(n);
				if (n == 0) {
					std::printf("  [FAIL] %s step %s: no case drove it\n", file.c_str(), key.c_str());
					file_failed++;
				}
			}
		}
		failed += file_failed;
		std::printf("%s: driven %s. %d undriven%s%s\n", file.c_str(), by_op.c_str(), undriven, by_step.empty() ? "" : "; steps ", by_step.c_str());
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
	std::string rows_used;
	int rows_called = 0;
	for (const char *row : kRows) {
		if (c.calls.count(row)) rows_called++;
		else rows_used += (rows_used.empty() ? "" : ", ") + std::string(row);
	}
	insimul_core_destroy(core);
	if (!rows_used.empty()) {
		std::printf("  [FAIL] rows this runner names that no case called: %s\n", rows_used.c_str());
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
