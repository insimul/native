/*
 * wasm_smoke.mjs — US-1 wasm smoke test, the browser-side mirror of
 * tests/smoke.c.
 *
 * Like smoke.c it proves the engine behind the wasm build is a REAL Prolog:
 * consult a tiny KB with a rule, then run a query that only unification +
 * backtracking through that rule can answer (grandparent/2), plus one that must
 * FAIL so an always-true stub cannot pass. On top of that it calls ALL TWELVE
 * insimul.h entry points across the JS boundary — including stepping a query
 * handle — which is the US-1 export-surface acceptance criterion.
 *
 * Usage: node tests/wasm_smoke.mjs <path-to-built/insimul.mjs>
 * ctest runs it for you (`wasm_smoke`); see cmake/wasm.cmake.
 */

import { dirname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { loadInsimul, InsimulError } from '../wasm/insimul-api.mjs';

const gluePath = process.argv[2];
if (!gluePath) {
  console.error('wasm_smoke: usage: node tests/wasm_smoke.mjs <build/insimul.mjs>');
  process.exit(2);
}

let checks = 0;
let failures = 0;

function check(label, actual, expected) {
  checks++;
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a === e) {
    console.log(`wasm_smoke: ok    ${label}`);
  } else {
    failures++;
    console.error(`wasm_smoke: FAIL  ${label}\n  want ${e}\n  got  ${a}`);
  }
}

function checkThat(label, ok, detail = '') {
  checks++;
  if (ok) {
    console.log(`wasm_smoke: ok    ${label}`);
  } else {
    failures++;
    console.error(`wasm_smoke: FAIL  ${label}${detail ? `\n  ${detail}` : ''}`);
  }
}

const KB = `parent(tom, bob).
parent(bob, ann).
grandparent(X, Z) :- parent(X, Y), parent(Y, Z).
`;

const createInsimul = (await import(pathToFileURL(gluePath).href)).default;

// Resolve every sibling payload (the .wasm, and the preload .data image an
// engine that does not compile its Prolog library in needs) next to the GLUE,
// not next to the process's cwd — Emscripten's default for a data package is a
// bare relative name, so without this the test only runs from the build dir.
const locateFile = (path) => join(dirname(resolve(gluePath)), path);

// ------------------------------------------------------------ 1. insimul_version
const insimul = await loadInsimul(createInsimul, { locateFile });
const version = insimul.version();
// The engine field is checked as a SCHEMA — `engine <name>/<version>/<commit>`
// — never for a vendor's name, so swapping the engine changes this stamp's
// values and not this assertion (US-2, leak L-02).
checkThat('insimul_version() is a well-formed stamp',
  /^insimul \d+\.\d+\.\d+ \(git \S+, engine [^/\s]+\/[^/\s]+\/[^/\s]+\)$/.test(version),
  version);

// ---------------------------------------- 2/3. insimul_kb_create / kb_consult
const kb = insimul.createKb();
kb.consult(KB);
console.log('wasm_smoke: ok    insimul_kb_consult loaded the rule KB');
checks++;

// ------------------------- 4/5/6. query_start / query_next / query_stop
// Stepping the iterator across the JS boundary is the point of this block: the
// handle is a wasm pointer, and each next() hands back a borrowed string that
// the wrapper copies before the following step invalidates it.
const solved = [...kb.solutions('grandparent(tom, Who)')].map((s) => s.Who);
check('grandparent(tom, Who) — real backtracking through a rule', solved, ['ann']);

const none = [...kb.solutions('grandparent(tom, tom)')];
check('grandparent(tom, tom) must FAIL (no stub passes this)', none, []);

// A ground goal that succeeds yields exactly one empty binding set.
check('grandparent(tom, ann) is provably true',
  [...kb.solutions('grandparent(tom, ann)')], [{}]);

// Explicit handle management, not the generator sugar — proves query_stop is
// callable directly and that a stopped handle is unusable.
const q = kb.query('parent(P, C)');
const first = q.next();
check('query_next returns the first binding set', first, { P: 'tom', C: 'bob' });
q.stop();
let threwAfterStop = false;
try { q.next(); } catch (e) { threwAfterStop = e instanceof InsimulError; }
checkThat('query_next after insimul_query_stop is rejected, not a wild pointer',
  threwAfterStop);

// --------------------------------------------- 7/8. kb_assert / kb_retract
kb.assert('parent(ann, zoe)');
check('after assert, grandparent(bob, Who) finds the new descendant',
  [...kb.solutions('grandparent(bob, Who)')].map((s) => s.Who), ['zoe']);
check('insimul_kb_retract removes the asserted clause', kb.retract('parent(ann, zoe)'), true);
check('retracting it again reports "no clause matched" (0 solutions, not an error)',
  kb.retract('parent(ann, zoe)'), false);
check('and the derived solution is gone', [...kb.solutions('grandparent(bob, Who)')], []);

// ------------------- 9. insimul_last_error / insimul_last_error_class
let syntaxErr = null;
try { kb.consult('this is not( prolog'); } catch (e) { syntaxErr = e; }
checkThat('a syntax error throws with insimul_last_error() text',
  syntaxErr instanceof InsimulError && syntaxErr.message.length > 0,
  String(syntaxErr));
// The class is the portable half — branch on this, never on the message.
check('insimul_last_error_class() reports the ISO class', syntaxErr?.class, 'syntax_error');
check('and nothing from the bad source was loaded',
  [...kb.solutions('grandparent(tom, Who)')].map((s) => s.Who), ['ann']);

// --------------------------------------- 10/11. kb_snapshot / kb_restore
// The exact canonical image: predicates in sorted Name/Arity order, clauses in
// assert order, variables numbervar'd to A/B/C, no spaces after commas. This is
// the same determinism the native `snapshot` ctest asserts against
// conformance/snapshots/basic.snapshot.pl, so a wasm formatting drift fails here.
const image = kb.snapshot();
check('insimul_kb_snapshot returns the canonical dynamic clause set', image,
  'grandparent(A,B):-parent(A,C),parent(C,B).\n' +
  'parent(tom,bob).\n' +
  'parent(bob,ann).\n');

const restored = insimul.createKb();
restored.restore(image);
check('a snapshot round-trips into a fresh KB',
  [...restored.solutions('grandparent(tom, Who)')].map((s) => s.Who), ['ann']);
check('and re-snapshotting the restored KB is byte-identical',
  restored.snapshot() === image, true);
restored.destroy();

// -------------------------------------------------------- 12. kb_destroy
kb.destroy();
checkThat('insimul_kb_destroy invalidates the handle', kb.closed);
let threwAfterDestroy = false;
try { kb.consult('a.'); } catch (e) { threwAfterDestroy = e instanceof InsimulError; }
checkThat('using a destroyed KB is rejected', threwAfterDestroy);

// Create/destroy CYCLE — safe because libinsimul holds its own engine instance
// open (leak L-01, fixed in US-2); no keepalive KB is opened on the JS side any
// more. A browser host does this constantly.
const cycled = insimul.createKb();
cycled.assert('lives(again)');
check('a KB created after the previous one was destroyed still works',
  [...cycled.solutions('lives(X)')].map((s) => s.X), ['again']);
cycled.destroy();

console.log('-------------------------------------------------------------');
console.log(`wasm_smoke: ${checks} checks, ${failures} failed`);
if (failures > 0) {
  console.error('wasm_smoke: FAIL');
  process.exit(1);
}
if (checks < 19) {
  console.error(`wasm_smoke: only ${checks} checks ran — refusing to pass vacuously.`);
  process.exit(2);
}
console.log('wasm_smoke: PASS — all thirteen insimul.h entry points callable from JS');
