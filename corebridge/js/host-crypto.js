// host-crypto.js — the adapter's stand-in for Node's `crypto`, supplied at
// bundle time exactly like js/host-prolog-engine.js supplies core's Prolog seam.
//
// WHY THIS IS NEEDED. `@insimul/core`'s `src/save-envelope.ts` opens with
// `import { createHash } from 'crypto'` — a bare Node builtin — and uses it for
// the one thing a save codec cannot do without: `computeSaveFileIntegrity`, the
// SHA-256 of the canonical JSON of a save. The `save.*` rows (Features Round C0)
// encode and decode envelopes through core's own `buildSaveFileEnvelope` /
// `validateSaveFileEnvelope`, so the hash has to be REAL here.
//
// WHERE THE HASH IS COMPUTED. Not in JavaScript: the C host installs
// `__insimul_sha256_hex(text)` (src/insimulcore_sha256.c, FIPS 180-4, checked
// against the NIST vectors by the corebridge_cases gate and against core's
// `conformance/saves/integrity-vectors.json` through the `save.integrity` row).
// That is the fix this file's previous version named — "route it to the C host
// rather than grow a second SHA-256 here" — and it keeps one SHA-256 per
// language in this repository. Under the JS harness (tests/corebridge_cases.mjs)
// the same global is Node's own `crypto`, so the two runtimes cross-check each
// other on every save case.
//
// WHAT IS SUPPORTED, AND WHAT IS LOUD. Exactly what core calls:
// `createHash('sha256').update(<string>).digest('hex')`, with any number of
// `update` calls. Any other algorithm, a Buffer/typed-array input, any other
// digest encoding and `randomUUID` THROW with a named error: a plausible wrong
// digest is worse than a stop.
//
// UTF-8, AS NODE DOES IT. Node hashes a JS string as its WHATWG UTF-8 encoding,
// where an unpaired surrogate becomes U+FFFD. QuickJS's C-string conversion would
// encode a lone surrogate as three WTF-8 bytes instead, so lone surrogates are
// replaced here BEFORE the string crosses into C, and the bytes hashed are the
// bytes Node hashes.

const LONE_SURROGATE = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g;

function unavailable(what) {
	return new Error(
		`insimulcore: ${what} is not available in the embedded runtime ` +
			'(corebridge/js/host-crypto.js supports createHash("sha256").update(string).digest("hex") only).',
	);
}

class Sha256 {
	constructor() {
		this._parts = [];
		this._done = false;
	}

	update(data, encoding) {
		if (this._done) throw new Error('insimulcore: Hash.update() after digest()');
		if (typeof data !== 'string') throw unavailable('hashing a non-string input');
		if (encoding !== undefined && encoding !== 'utf8' && encoding !== 'utf-8') {
			throw unavailable(`a "${encoding}" input encoding`);
		}
		this._parts.push(data);
		return this;
	}

	digest(encoding) {
		if (encoding !== 'hex') throw unavailable(`a "${String(encoding)}" digest`);
		if (this._done) throw new Error('insimulcore: Hash.digest() called twice');
		this._done = true;
		const host = globalThis.__insimul_sha256_hex;
		if (typeof host !== 'function') {
			throw new Error('insimulcore: the host installed no __insimul_sha256_hex — SHA-256 is unavailable');
		}
		return host(this._parts.join('').replace(LONE_SURROGATE, '�'));
	}
}

export function createHash(algorithm) {
	if (String(algorithm).toLowerCase() !== 'sha256') throw unavailable(`crypto.createHash("${algorithm}")`);
	return new Sha256();
}

export function randomUUID() {
	throw unavailable('crypto.randomUUID');
}

export default { createHash, randomUUID };
