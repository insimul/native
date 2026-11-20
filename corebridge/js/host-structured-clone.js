// host-structured-clone.js — `structuredClone` for QuickJS.
//
// WHY THIS EXISTS. `structuredClone` is an HTML platform API, not an ECMAScript
// one, so a bare JS engine does not have it — QuickJS included, and so does not a
// fresh Node `vm` context (the JS leg's runtime). Core's build-plan writer
// (`genre-systems/build-plan.ts`, `writeGenreBuildPlan`, behind the
// `genrePieces.write` row) copies each piece it writes with it; without this the
// row fails with `ReferenceError: structuredClone is not defined`.
//
// It is a POLYFILL, not a seam, like host-text-codec.js: nothing about it is
// adapter-specific and core has no import for it to resolve. It installs a
// global only when one is absent, so an engine that ships `structuredClone` wins,
// and `entry.js` imports it first, with the other polyfills.
//
// SCOPE. The structured clone algorithm over the values core clones here and the
// ones a JSON boundary can produce: primitives (`undefined` kept, as the
// algorithm keeps it), arrays (holes kept as holes), plain objects (own
// enumerable string keys, in order), `Date`, `Map` and `Set`, with shared and
// cyclic references preserved. A function or a symbol is refused as the
// algorithm refuses it (`DataCloneError`); a class instance clones as a plain
// object of its own enumerable members, as the algorithm does.

function dataCloneError(what) {
	const err = new Error(`${what} could not be cloned`);
	err.name = 'DataCloneError';
	return err;
}

function polyfillStructuredClone(value) {
	const seen = new Map();
	const clone = (v) => {
		if (typeof v === 'function') throw dataCloneError('a function');
		if (typeof v === 'symbol') throw dataCloneError('a symbol');
		if (v === null || typeof v !== 'object') return v;
		if (seen.has(v)) return seen.get(v);
		if (v instanceof Date) {
			const out = new Date(v.getTime());
			seen.set(v, out);
			return out;
		}
		if (v instanceof Map) {
			const out = new Map();
			seen.set(v, out);
			for (const [k, x] of v) out.set(clone(k), clone(x));
			return out;
		}
		if (v instanceof Set) {
			const out = new Set();
			seen.set(v, out);
			for (const x of v) out.add(clone(x));
			return out;
		}
		if (Array.isArray(v)) {
			const out = new Array(v.length);
			seen.set(v, out);
			for (const k of Object.keys(v)) out[k] = clone(v[k]);
			return out;
		}
		const out = {};
		seen.set(v, out);
		for (const k of Object.keys(v)) out[k] = clone(v[k]);
		return out;
	};
	return clone(value);
}

// Installed only when absent, so a future QuickJS that ships it wins.
if (typeof globalThis.structuredClone !== 'function') globalThis.structuredClone = polyfillStructuredClone;

export { polyfillStructuredClone };
