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
// on everything radiant generation can observe — `collapseTerm`, the trailing-`.`
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
 * Only the members core's radiant slice actually calls are implemented:
 * `consult`, `query` and `destroy`. Everything else on the interface throws a
 * NAMED error rather than returning a plausible empty value — if a future slice
 * reaches for `getStats()` we want a loud failure at the call site, not silent
 * wrong behaviour that the corpus might not cover.
 */
class NativePrologEngine {
	constructor(id) {
		/** @type {'wasm'} Same Trealla the wasm engine wraps — natively linked. */
		this.kind = 'wasm';
		this._id = id;
	}

	async consult(program) {
		const err = globalThis.__insimul_prolog_consult(this._id, program);
		return err === null ? { success: true } : { success: false, error: err };
	}

	/**
	 * @param {string} queryString goal text, with or without a trailing `.`
	 * @param {number} [maxResults] defaults to 1000, as `WasmPrologEngine.query` does
	 */
	async query(queryString, maxResults = 1000) {
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

	destroy() {
		if (this._id < 0) return;
		globalThis.__insimul_prolog_destroy(this._id);
		this._id = -1;
	}

	// ── Not reached by the adopted slice. Fail loudly if a future one gets here.
	declareDynamic() { return unimplemented('declareDynamic'); }
	assertFact() { return unimplemented('assertFact'); }
	assertFacts() { return unimplemented('assertFacts'); }
	retractFact() { return unimplemented('retractFact'); }
	addRule() { return unimplemented('addRule'); }
	addRules() { return unimplemented('addRules'); }
	queryOnce() { return unimplemented('queryOnce'); }
	getFactsForPredicate() { return unimplemented('getFactsForPredicate'); }
	getAllFacts() { return unimplemented('getAllFacts'); }
	getAllRules() { return unimplemented('getAllRules'); }
	clear() { return unimplemented('clear'); }
	clearFacts() { return unimplemented('clearFacts'); }
	export() { return unimplemented('export'); }
	import() { return unimplemented('import'); }
	getStats() { return unimplemented('getStats'); }
}

function unimplemented(member) {
	throw new Error(
		`insimulcore: PrologEngine.${member}() is not implemented by the native bridge. ` +
			'The adopted slice does not use it — see gdextension/corebridge/js/host-prolog-engine.js.',
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
