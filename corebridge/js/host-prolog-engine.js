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
		this._recordFact(fact);
		return (await this._rebuild()).success;
	}

	async assertFacts(facts) {
		for (const fact of facts) this._recordFact(fact);
		return (await this._rebuild()).success;
	}

	async retractFact(fact) {
		const normalized = String(fact).trim().replace(/\.\s*$/, '') + '.';
		const sig = signatureOf(normalized.replace(/\.$/, ''));
		const facts = this._facts.get(sig || '');
		if (facts) {
			facts.delete(normalized);
			if (facts.size === 0) this._facts.delete(sig || '');
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
		this._facts.clear();
		this._rules = [];
		this._programs = [];
		this._loadError = undefined;
		this._freshKb();
	}

	async clearFacts() {
		this._facts.clear();
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
		this._facts.get(sig || '').add(normalized + '.');
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

		this._freshKb();
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
