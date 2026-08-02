// host-crypto.js — the adapter's stand-in for Node's `crypto`, supplied at
// bundle time exactly like js/host-prolog-engine.js supplies core's Prolog seam.
//
// WHY THIS IS NEEDED. `@insimul/core`'s `src/save-envelope.ts` opens with
// `import { createHash } from 'crypto'` — a bare Node builtin, at module scope.
// `save-envelope` is a wide module (canonical JSON stringify + envelope
// build/validate), so anything that pulls in ONE of its exports pulls in the
// Node import too. `scripts/quest-golden-manifest.ts` imports
// `canonicalJSONStringify` from it, and that is enough to make the whole module
// unbundlable for a non-Node host. Nothing about the code we actually call needs
// a hash. Reported as a contract finding — RUNTIME_CORE_ADOPTION.md §8.
//
// WHY IT THROWS RATHER THAN COMPUTES. libinsimulcore's adopted surface uses no
// integrity hash: `computeSaveFileIntegrity` is unreachable from any method in
// entry.js, and this plugin computes save integrity in C++
// (`gdextension/src/canonical_json.cpp`, pinned to the same corpus). Vendoring a
// JS SHA-256 to satisfy a dead import would add code that is never exercised and
// could rot unnoticed. So the stub is loud: the first call is a crash with an
// explanation, never a silently wrong digest.
//
// If a future slice DOES need hashing across the boundary, the right fix is to
// route it to libinsimul/the C host rather than to grow a second SHA-256 here.

function unavailable(what) {
	return new Error(
		`insimulcore: ${what} is not available in the embedded runtime. ` +
			'The adopted surface does not hash; see gdextension/corebridge/js/host-crypto.js.',
	);
}

export function createHash() {
	throw unavailable('crypto.createHash');
}

export function randomUUID() {
	throw unavailable('crypto.randomUUID');
}

export default { createHash, randomUUID };
