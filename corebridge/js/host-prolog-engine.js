// host-prolog-engine.js — the ADAPTER's implementation of core's `PrologEngine`
// seam, backed by the NATIVE Prolog engine this plugin already links.
//
// Why this file exists (US-2 of tasklist 100, RUNTIME_CORE_ADOPTION.md §5.4):
//
//   `@insimul/core`'s `createPrologEngine()` dynamic-imports `WasmPrologEngine`,
//   which instantiates libinsimul/Trealla compiled to **wasm32**. QuickJS has no
//   WebAssembly, so that path cannot run inside the bridge — and it should not:
//   this plugin already links the *same* Trealla, natively, through libinsimul's
//   C ABI (vendor/insimul/insimul.h). Wrapping a wasm build of an engine we hold
//   natively would be silly.
//
//   So the bundler (tools/vendor-core-bundle.mjs) resolves core's
//   `../prolog/prolog-engine` import to THIS module. Core's source is not
//   patched — the dependency stays one-way (adapter -> core); the adapter simply
//   supplies the seam's implementation, which is exactly what a seam is for.
//   The proposed contract amendment that would make this explicit rather than
//   resolver-driven is RUNTIME_CORE_ADOPTION.md §8.
//
// SEMANTICS: this file must agree with `packages/core/src/prolog/wasm-engine.ts`
// on everything a caller can observe — `collapseTerm`, the trailing-`.`
// trim, the 1000-result default, and "success with zero bindings is still
// success". Those are mirrored below with the source lines they mirror. The
// conformance corpus (conformance/radiant/*.json) is what proves the mirror.
//
// The four `__insimul_prolog_*` globals are installed by the C host
// (../src/insimulcore.c); they map 1:1 onto libinsimul's KB + query ABI.

/**
 * Collapse an ABI term to the scalar a `QueryBindings` slot holds.
 *
 * Mirrors `collapseTerm` in packages/core/src/prolog/wasm-engine.ts verbatim:
 *   - atom / integer / float / bool → itself;
 *   - list `[a,b]` → `"."` (`"[]"` for the empty list);
 *   - compound `f(a,b)` → `"f"` (the functor).
 * libinsimul's binding JSON uses the same term encoding the wasm ABI does
 * (vendor/insimul/insimul.h "Binding-set JSON format"), so one rule set serves
 * both.
 */
export function collapseTerm(term) {
	if (term === null || term === undefined) return null;
	if (typeof term === 'string' || typeof term === 'number' || typeof term === 'boolean') {
		return term;
	}
	if (Array.isArray(term)) return term.length === 0 ? '[]' : '.';
	if (typeof term === 'object' && typeof term.functor === 'string') return term.functor;
	return String(term);
}

/** The engine used when a caller does not choose one. Mirrors core's default. */
export const DEFAULT_PROLOG_ENGINE = 'wasm';

/**
 * `PrologEngine` over libinsimul's C ABI.
 *
 * The WHOLE seam, with `WasmPrologEngine`'s bookkeeping mirrored member for
 * member (packages/core/src/prolog/wasm-engine.ts): the consulted programs (added,
 * never replaced; an exact duplicate skipped; a program that fails rolled back),
 * the dynamic declarations, the asserted facts per predicate signature (a set, so
 * a repeated assert stores one clause), the added rules, and `rebuild()` — a FRESH
 * native KB consulted with the whole accumulated program on every mutation, in
 * wasm-engine's order (dynamic declarations, consulted programs, rules, facts).
 * Trealla would assert incrementally; wasm-engine rebuilds anyway so that the only
 * thing differing between its engines is the interpreter, and this file rebuilds
 * for the same reason: so that what a caller observes through the native engine is
 * what core's own engine shows it (a fact asserted twice is there once; retracting
 * a fact retracts only an ASSERTED one, never a clause of a consulted program).
 *
 * The radiant slice reaches `consult`, `query` and `destroy`; the skill session
 * (`skill.create { kb }`, PL.native-progression-rows) also reaches `queryOnce`
 * (core's `skill_goal_met/2` gate), `assertFact` and `retractFact` (its fact
 * deltas), which is why the rest of the seam is no longer a named throw.
 *
 * INCREMENTAL FACT WRITES (PL.native-consult-floor-leak). A rebuild per written
 * fact made every skill take a whole-program consult (a one-frame 0.43 s hitch
 * over a village-sized KB) and a fresh native KB. `assertFact`, `assertFacts`
 * and `retractFact` now write into the HELD KB when that provably leaves it
 * holding exactly the clauses, in exactly the order, that `_rebuild()` would
 * have consulted — and fall back to `_rebuild()` in every other case:
 *
 *   - assert: the fact is a plain term (`plainFact`: `name` or `name(args)`,
 *     nothing after it) whose predicate is the bookkeeping bucket it lands in,
 *     that bucket was already declared dynamic, and no stored fact sits in a
 *     different bucket for the same predicate (`_mixed`). Facts are the LAST
 *     part of a rebuilt program and a bucket appends, so the new clause is the
 *     predicate's last either way. One consult of the fact's own text.
 *   - retract: the fact is plain and ground, the bookkeeping holds it, and the
 *     KB holds exactly one identical clause which is also the first clause
 *     `retract/1` would take (checked in Prolog, `retractDirective`); that one
 *     clause is what a rebuild without the fact leaves out.
 *   - an already-held assert, or a retract of a fact never asserted, changes
 *     nothing a rebuild would change, so it writes nothing.
 *
 * Any failure on the incremental path (a fact the engine refuses, a check that
 * does not hold) is followed by the rebuild, so errors and `_loadError` read as
 * before. Rules, dynamic declarations, programs and `clearFacts` still rebuild.
 * One behaviour moves, and it is stated: a QUERY that itself asserts or
 * retracts (a world rule doing so) keeps that change until the engine rebuilds,
 * where previously the next fact write discarded it (core's wasm-engine still
 * does). `corebridge/tests/prolog-engine/` holds the cases and the seeded
 * differential that replay this file against the rebuild-only oracle.
 */
class NativePrologEngine {
	constructor(id) {
		/** @type {'wasm'} Same Trealla the wasm engine wraps — natively linked. */
		this.kind = 'wasm';
		this._id = id;
		this._dynamic = new Set();
		this._programs = [];
		this._facts = new Map();
		this._rules = [];
		this._loadError = undefined;
		/** Stored facts whose predicate is not their bucket's, or unknown (see `_mixed`). */
		this._mixedCount = 0;
		this._mixedSigs = new Map();
		/** True while the KB has had nothing consulted or queried since it was created. */
		this._pristine = true;
	}

	async declareDynamic(predicates) {
		const fresh = predicates.filter((p) => !this._dynamic.has(p));
		if (fresh.length === 0) return;
		for (const p of fresh) this._dynamic.add(p);
		await this._rebuild();
	}

	/** wasm-engine.ts `consult`: keep earlier programs; roll a failing one back. */
	async consult(program) {
		const trimmed = String(program).trim();
		const addedProgram = Boolean(trimmed) && !this._programs.includes(trimmed);
		if (addedProgram) this._programs.push(trimmed);

		const addedDynamic = [];
		const dynamicRegex = /:-\s*dynamic\s*\(?\s*([a-z_]\w*\s*\/\s*\d+)\s*\)?\s*\./g;
		let match;
		while ((match = dynamicRegex.exec(program)) !== null) {
			const signature = match[1].replace(/\s/g, '');
			if (!this._dynamic.has(signature)) {
				this._dynamic.add(signature);
				addedDynamic.push(signature);
			}
		}

		const result = await this._rebuild();
		if (!result.success) {
			if (addedProgram) this._programs.pop();
			for (const signature of addedDynamic) this._dynamic.delete(signature);
			const rolledBack = await this._rebuild();
			if (rolledBack.success) this._loadError = undefined;
		}
		return result;
	}

	async assertFact(fact) {
		return this.assertFacts([fact]);
	}

	async assertFacts(facts) {
		// Which facts are new, and may each be appended to the held KB?
		let incremental = this._writable();
		const fresh = [];
		for (const fact of facts) {
			const normalized = String(fact).trim().replace(/\.\s*$/, '');
			const sig = signatureOf(normalized);
			const held = this._facts.get(sig || '');
			if ((held && held.has(normalized + '.')) || fresh.some((f) => f.text === normalized + '.')) continue;
			const head = plainFact(normalized);
			if (!head || head.sig !== sig || !this._dynamic.has(sig) || this._mixedSigs.has(sig)) incremental = false;
			fresh.push({ fact, text: normalized + '.' });
		}
		for (const fact of facts) this._recordFact(fact);
		if (fresh.length === 0 && this._writable()) return true;
		if (incremental && this._consultHeld(fresh.map((f) => f.text).join('\n'))) return true;
		return (await this._rebuild()).success;
	}

	async retractFact(fact) {
		const normalized = String(fact).trim().replace(/\.\s*$/, '') + '.';
		const sig = signatureOf(normalized.replace(/\.$/, ''));
		const facts = this._facts.get(sig || '');
		const held = Boolean(facts && facts.has(normalized));
		if (held) {
			facts.delete(normalized);
			this._countMixed(normalized, sig || '', -1);
			if (facts.size === 0) this._facts.delete(sig || '');
		}
		if (this._writable()) {
			if (!held) return true;
			const head = plainFact(normalized.replace(/\.$/, ''));
			if (head && head.ground && this._consultHeld(retractDirective(normalized.replace(/\.$/, '')))) return true;
		}
		return (await this._rebuild()).success;
	}

	async addRule(rule) {
		this._recordRule(rule);
		return (await this._rebuild()).success;
	}

	async addRules(rules) {
		for (const rule of rules) this._recordRule(rule);
		return (await this._rebuild()).success;
	}

	/**
	 * @param {string} queryString goal text, with or without a trailing `.`
	 * @param {number} [maxResults] defaults to 1000, as `WasmPrologEngine.query` does
	 */
	async query(queryString, maxResults = 1000) {
		// wasm-engine.ts: a KB whose last rebuild failed answers with that error.
		if (this._loadError) return { success: false, bindings: [], error: this._loadError };
		// wasm-engine.ts: `queryString.trim().replace(/\.\s*$/, '')`.
		const goal = String(queryString).trim().replace(/\.\s*$/, '');
		this._pristine = false;
		let raw;
		try {
			raw = globalThis.__insimul_prolog_query(this._id, goal, maxResults);
		} catch (err) {
			// A goal that will not even start (syntax/type error) — the wasm
			// engine reports the same shape.
			return { success: false, bindings: [], error: String(err && err.message ? err.message : err) };
		}
		const solutions = JSON.parse(raw);
		return {
			success: true,
			bindings: solutions.map((sol) => {
				const out = {};
				for (const key of Object.keys(sol)) out[key] = collapseTerm(sol[key]);
				return out;
			}),
		};
	}

	/** wasm-engine.ts `queryOnce`: one solution asked for; true when one came back. */
	async queryOnce(queryString) {
		const result = await this.query(queryString, 1);
		return result.success && result.bindings.length > 0;
	}

	getFactsForPredicate(predicateSignature) {
		const facts = this._facts.get(predicateSignature);
		return facts ? Array.from(facts) : [];
	}

	getAllFacts() {
		const all = [];
		for (const facts of this._facts.values()) for (const f of facts) all.push(f);
		return all;
	}

	getAllRules() {
		return [...this._rules];
	}

	async clear() {
		this._dynamic.clear();
		this._forgetFacts();
		this._rules = [];
		this._programs = [];
		this._loadError = undefined;
		this._freshKb();
	}

	async clearFacts() {
		this._forgetFacts();
		await this._rebuild();
	}

	getStats() {
		let factCount = 0;
		for (const facts of this._facts.values()) factCount += facts.size;
		return { factCount, ruleCount: this._rules.length, dynamicPredicates: Array.from(this._dynamic) };
	}

	destroy() {
		if (this._id < 0) return;
		globalThis.__insimul_prolog_destroy(this._id);
		this._id = -1;
		// The program text is the bulk of an engine; a disposed session can stay
		// reachable from the JS heap until QuickJS's next cycle collection, and it
		// should not hold a village-sized program there in the meantime.
		this._programs = [];
		this._rules = [];
		this._forgetFacts();
	}

	// ── Not reached by any adopted slice. Fail loudly if a future one gets here.
	export() { return unimplemented('export'); }
	import() { return unimplemented('import'); }

	// ── wasm-engine.ts's internals, mirrored ─────────────────────────────────

	_recordFact(fact) {
		const normalized = String(fact).trim().replace(/\.\s*$/, '');
		const sig = signatureOf(normalized);
		if (sig && !this._dynamic.has(sig)) this._dynamic.add(sig);
		if (!this._facts.has(sig || '')) this._facts.set(sig || '', new Set());
		const bucket = this._facts.get(sig || '');
		if (bucket.has(normalized + '.')) return;
		bucket.add(normalized + '.');
		this._countMixed(normalized + '.', sig || '', 1);
	}

	/**
	 * `_mixed`: a stored fact whose real predicate is not the bucket
	 * `signatureOf` put it in (it reads `p(f(a,b), c)` as p/1), or whose predicate
	 * `plainFact` cannot tell. A rebuild emits buckets in insertion order, so such
	 * a fact can sit AFTER another bucket holding its predicate, and appending to
	 * that other bucket's predicate would then not be appending to the end of the
	 * rebuilt clause list. Counted per real predicate; an unknown one blocks all.
	 */
	_countMixed(text, bucket, delta) {
		const head = plainFact(text.replace(/\.$/, ''));
		if (head && head.sig === bucket) return;
		const key = head ? head.sig : '';
		const n = (this._mixedSigs.get(key) || 0) + delta;
		if (n > 0) this._mixedSigs.set(key, n);
		else this._mixedSigs.delete(key);
		this._mixedCount += delta;
	}

	_forgetFacts() {
		this._facts.clear();
		this._mixedSigs.clear();
		this._mixedCount = 0;
	}

	/** May a fact write go straight into the held KB (it holds the bookkeeping's program)? */
	_writable() {
		return this._id >= 0 && !this._loadError && !this._mixedSigs.has('');
	}

	/** Consult `text` into the held KB; false (and nothing changed by a clause) when it refuses. */
	_consultHeld(text) {
		this._pristine = false;
		return globalThis.__insimul_prolog_consult(this._id, text) === null;
	}

	_recordRule(rule) {
		const normalized = String(rule).trim().replace(/\.\s*$/, '') + '.';
		const headMatch = normalized.match(/^([a-z_]\w*)\s*\(/);
		if (headMatch) {
			const arityMatch = normalized.match(/^[^(]*\(([^)]*)\)/);
			if (arityMatch) {
				const sig = `${headMatch[1]}/${arityMatch[1].split(',').length}`;
				if (!this._dynamic.has(sig)) this._dynamic.add(sig);
			}
		}
		if (!this._rules.includes(normalized)) this._rules.push(normalized);
	}

	_freshKb() {
		if (this._id >= 0) globalThis.__insimul_prolog_destroy(this._id);
		const id = globalThis.__insimul_prolog_create();
		if (id < 0) throw new Error('insimulcore: could not create a Prolog KB');
		this._id = id;
		this._pristine = true;
	}

	/** wasm-engine.ts `rebuild()`: a fresh KB consulted with everything, in order. */
	async _rebuild() {
		const parts = [];
		for (const p of this._dynamic) parts.push(`:- dynamic(${p}).`);
		const consulted = this._programs.join('\n').trim();
		if (consulted) parts.push(consulted);
		for (const r of this._rules) parts.push(r);
		for (const facts of this._facts.values()) for (const f of facts) parts.push(f);
		const fullProgram = parts.join('\n');

		// A KB nothing has been consulted into or asked yet is already what
		// `_freshKb()` would make: reuse it rather than create and destroy one.
		if (!(this._pristine && this._id >= 0)) this._freshKb();
		this._pristine = false;
		this._loadError = undefined;
		if (!fullProgram.trim()) return { success: true };
		const err = globalThis.__insimul_prolog_consult(this._id, fullProgram);
		if (err === null) return { success: true };
		this._loadError = err;
		return { success: false, error: err };
	}
}

/** wasm-engine.ts `extractPredicateSignature` (tau-engine's): `name/arity` of a fact. */
function signatureOf(fact) {
	const match = fact.match(/^([a-z_]\w*)\s*\(([^)]*)\)/);
	if (!match) {
		const atomMatch = fact.match(/^([a-z_]\w*)\s*\.?$/);
		if (atomMatch) return `${atomMatch[1]}/0`;
		return '';
	}
	let depth = 0;
	let arity = 1;
	const argsStr = match[2];
	for (let i = 0; i < argsStr.length; i++) {
		const ch = argsStr[i];
		if (ch === '(' || ch === '[') depth++;
		else if (ch === ')' || ch === ']') depth--;
		else if (ch === ',' && depth === 0) arity++;
		else if (ch === "'" || ch === '"') {
			const quote = ch;
			i++;
			while (i < argsStr.length && argsStr[i] !== quote) {
				if (argsStr[i] === '\\') i++;
				i++;
			}
		}
	}
	return `${match[1]}/${arity}`;
}

/**
 * The head of a PLAIN fact — `name` or `name(args)` with nothing after the
 * closing parenthesis — as `{ sig: 'name/arity', ground }`, or null for
 * anything else (a rule, a directive, an operator term, a quoted or
 * upper-case functor, a comment, `0'c`, an end token inside, unbalanced
 * brackets). Unlike `signatureOf` it counts arguments at the top level of the
 * argument list, so `p(f(a,b), c)` is p/2. `ground` is false when a variable
 * token appears outside quotes. Null always means "rebuild", never an error.
 */
export function plainFact(text) {
	const name = /^[a-z][A-Za-z0-9_]*/.exec(text);
	if (!name) return null;
	let i = name[0].length;
	if (i === text.length) return { sig: `${name[0]}/0`, ground: true };
	if (text[i] !== '(') return null;
	let depth = 0;
	let arity = 1;
	let ground = true;
	const word = (c) => c !== undefined && /[A-Za-z0-9_]/.test(c);
	for (; i < text.length; i++) {
		const ch = text[i];
		if (ch === "'" || ch === '"' || ch === '`') {
			let j = i + 1;
			for (;;) {
				if (j >= text.length) return null;
				if (text[j] === '\\') j += 2;
				else if (text[j] === ch && text[j + 1] === ch) j += 2;
				else if (text[j] === ch) break;
				else j++;
			}
			i = j;
			continue;
		}
		if (ch === '(' || ch === '[' || ch === '{') {
			depth++;
		} else if (ch === ')' || ch === ']' || ch === '}') {
			depth--;
			if (depth === 0) {
				return ch === ')' && i === text.length - 1 ? { sig: `${name[0]}/${arity}`, ground } : null;
			}
			if (depth < 0) return null;
		} else if (ch === ',' && depth === 1) {
			arity++;
		} else if (ch === '%' || (ch === '/' && text[i + 1] === '*')) {
			return null;
		} else if (ch === '0' && text[i + 1] === "'" && !word(text[i - 1])) {
			return null;
		} else if (ch === '.' && (i + 1 === text.length || /[\s%]/.test(text[i + 1]))) {
			return null;
		} else if (/[A-Z_]/.test(ch) && !word(text[i - 1])) {
			ground = false;
		}
	}
	return null;
}

/**
 * The directive that retracts ground fact `fact` from a held KB exactly as a
 * rebuild without it would: only when the KB holds ONE clause identical to it
 * and it is the first clause `retract/1` would take (no earlier fact merely
 * unifies with it). Otherwise the directive fails, so does the consult, and the
 * caller rebuilds. ISO builtins only; no helper predicate enters the KB.
 */
export function retractDirective(fact) {
	return (
		`:- once((G = (${fact}), functor(G, N, A), functor(H1, N, A), ` +
		`findall(x, (clause(H1, true), H1 == G), [_]), functor(H2, N, A), ` +
		`once((clause(H2, true), \\+ H2 \\= G)), H2 == G, retract(G))).`
	);
}

function unimplemented(member) {
	throw new Error(
		`insimulcore: PrologEngine.${member}() is not implemented by the native bridge. ` +
			'No adopted slice uses it — see corebridge/js/host-prolog-engine.js.',
	);
}

/**
 * Build an engine. Async to match core's `createPrologEngine`, though the
 * native KB is created synchronously (there is no wasm module to instantiate).
 * The returned promise is already settled, which is what lets the C host drive
 * an async core call to completion by draining the job queue — see
 * `insimul_core_call`.
 */
export async function createPrologEngine(_options = {}) {
	const id = globalThis.__insimul_prolog_create();
	if (id < 0) throw new Error('insimulcore: could not create a Prolog KB');
	return new NativePrologEngine(id);
}
