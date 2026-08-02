/*
 * wasm_conformance.mjs — the golden Prolog conformance harness, run against the
 * Emscripten/WebAssembly build (US-2).
 *
 * This is the wasm leg of the same cross-language parity gate that
 * `tests/conformance.c` (native C ABI) and `rust/insimul/tests/conformance.rs`
 * (Rust wrapper) run. It drives the SAME vendored corpus — every file, every
 * case, no subset — through `wasm/insimul-api.mjs`, i.e. through exactly the
 * twelve insimul.h entry points a browser consumer will use.
 *
 *   node tests/wasm_conformance.mjs <path-to-built/insimul.mjs> [--corpus DIR]
 *
 * ctest runs it for you (`wasm_conformance`); see cmake/wasm.cmake, which is
 * what `scripts/build_wasm.sh` invokes — so this leg cannot rot unrun.
 *
 * PARITY WITH THE NATIVE LEG
 *   - The AMENDMENTS table below is kept in lockstep with the one in
 *     tests/conformance.c and rust/insimul/tests/conformance.rs (same case, same
 *     substitutions, same printed reason).
 *   - The per-case output and the final
 *     `conformance: N files, N cases, N passed, N failed, N amended`
 *     summary line are byte-comparable with the C leg's.
 *   - INSIMUL_CONFORMANCE_JSON=<path> writes one JSON-Lines record per case
 *     carrying the RAW solution strings the ABI returned, so
 *     scripts/conformance_parity.sh can diff wasm against native case by case
 *     rather than merely observing that both legs are green.
 *
 * NON-VACUITY
 *   A missing or empty corpus directory, a file with no cases, an unparseable
 *   file, or a run that executes fewer cases than the corpus declares is a HARD
 *   failure (exit 2). This repo has shipped a vacuous gate before; a harness
 *   that quietly executes nothing must never read as a pass.
 */

import { readdirSync, readFileSync, writeFileSync, existsSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { loadInsimul, InsimulError } from '../wasm/insimul-api.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, '..');

/* ------------------------------------------------------------------ *
 * Documented corpus amendments — lockstep with tests/conformance.c.
 *
 * The corpus is authored against tau-prolog (the platform's reference engine).
 * Where Trealla diverges AND tau-prolog is the ISO-correct one, the case is not
 * skipped: an explicit, printed, textual substitution preserves exactly the
 * behaviour the case tests.
 * ------------------------------------------------------------------ */
const AMENDMENTS = [
  {
    area: 'assert-retract',
    name: 'asserta-prepends',
    // `log/1` is an *evaluable functor* in ISO, but Trealla also registers it as
    // a static builtin predicate, so `asserta(log(0))` raises
    // permission_error(modify, static_procedure, log/1). The case is about
    // asserta-before-assertz ordering, not the name, so rename the predicate.
    subs: [['log(', 'entry('], ['log/', 'entry/']],
    reason:
      "predicate 'log' collides with Trealla's static builtin arith functor " +
      'log/1; renamed to preserve asserta-ordering semantics',
  },
];

/** Apply every amendment matching (area, name). Returns [text, applied]. */
function applyAmendments(area, name, text) {
  let out = text;
  let applied = false;
  for (const a of AMENDMENTS) {
    if (a.area !== area || a.name !== name) continue;
    for (const [from, to] of a.subs) {
      if (out.includes(from)) {
        out = out.split(from).join(to);
        applied = true;
      }
    }
  }
  return [out, applied];
}

function amendReason(area, name) {
  const a = AMENDMENTS.find((x) => x.area === area && x.name === name);
  return a ? a.reason : 'documented amendment (see wasm_conformance.mjs)';
}

/* ------------------------------------------------------------------ *
 * Comparison. Structural, key-order-insensitive for objects; numbers with a
 * small tolerance; solution ORDER is significant unless the case says
 * "unordered": true (Prolog's solution order is canonical). Same rules as the
 * C leg's jv_equal/solutions_match.
 * ------------------------------------------------------------------ */
function jsonEqual(a, b) {
  if (a === b) return true;
  if (typeof a === 'number' && typeof b === 'number') return Math.abs(a - b) < 1e-9;
  if (a === null || b === null) return a === b;
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
    return a.every((x, i) => jsonEqual(x, b[i]));
  }
  if (typeof a === 'object' && typeof b === 'object') {
    const ka = Object.keys(a);
    const kb = Object.keys(b);
    if (ka.length !== kb.length) return false;
    return ka.every((k) => Object.hasOwn(b, k) && jsonEqual(a[k], b[k]));
  }
  return false;
}

function solutionsMatch(expected, actual, unordered) {
  if (expected.length !== actual.length) return false;
  if (!unordered) return expected.every((e, i) => jsonEqual(e, actual[i]));
  const used = new Array(actual.length).fill(false);
  return expected.every((e) => {
    const k = actual.findIndex((a, i) => !used[i] && jsonEqual(e, a));
    if (k < 0) return false;
    used[k] = true;
    return true;
  });
}

/* ------------------------------------------------------------------ *
 * Corpus location — the repo-wide resolution order (CLAUDE.md): the --corpus
 * flag, then INSIMUL_CONFORMANCE_DIR, then the vendored mirror, then the
 * sibling insimul-runtime submodule. Never a baked absolute path.
 * ------------------------------------------------------------------ */
function isDir(p) {
  try { return statSync(p).isDirectory(); } catch { return false; }
}

function resolveCorpusDir(flagDir) {
  if (flagDir) {
    if (!isDir(flagDir)) die(`--corpus points at ${flagDir}, which is not a directory`);
    return flagDir;
  }
  const env = process.env.INSIMUL_CONFORMANCE_DIR;
  if (env) {
    if (!isDir(env)) die(`INSIMUL_CONFORMANCE_DIR points at ${env}, which is not a directory`);
    return env;
  }
  const vendored = join(REPO_ROOT, 'conformance', 'prolog');
  if (isDir(vendored)) return vendored;
  const sibling = resolve(REPO_ROOT, '..', 'insimul-runtime/packages/core/conformance/prolog');
  if (isDir(sibling)) return sibling;
  die(
    `no corpus found.\n  looked at ${vendored}\n  and ${sibling}\n` +
    '  Set INSIMUL_CONFORMANCE_DIR to point at the corpus.');
}

function die(msg) {
  console.error(`conformance: ${msg}`);
  process.exit(2);
}

/* ------------------------------------------------------------------ *
 * Arguments.
 * ------------------------------------------------------------------ */
const argv = process.argv.slice(2);
let gluePath = null;
let corpusFlag = null;
let minCases = Number(process.env.INSIMUL_CONFORMANCE_MIN_CASES ?? 0) || 0;

for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  if (a === '--corpus') corpusFlag = argv[++i];
  else if (a === '--min-cases') minCases = Number(argv[++i]);
  else if (!gluePath) gluePath = a;
  else die(`unexpected argument: ${a}`);
}
if (!gluePath) {
  console.error('conformance: usage: node tests/wasm_conformance.mjs <build-wasm/insimul.mjs> [--corpus DIR]');
  process.exit(2);
}

const dir = resolveCorpusDir(corpusFlag);
console.log(`conformance corpus dir: ${dir}`);

const dumpPath = process.env.INSIMUL_CONFORMANCE_JSON;
const dumpRecords = [];
if (dumpPath) console.log(`conformance: writing per-case parity records to ${dumpPath}`);

/* ------------------------------------------------------------------ *
 * Load the corpus first (before touching the engine), so a corpus problem
 * fails as a corpus problem and the declared case count is known up front —
 * that count is the floor the run must reach.
 * ------------------------------------------------------------------ */
const files = readdirSync(dir).filter((f) => f.endsWith('.json')).sort();
if (files.length === 0)
  die(`no *.json corpus files in '${dir}' — refusing to pass vacuously.`);

const corpus = files.map((fname) => {
  const path = join(dir, fname);
  let root;
  try {
    root = JSON.parse(readFileSync(path, 'utf8'));
  } catch (e) {
    die(`JSON parse error in ${path}: ${e.message}`);
  }
  if (!root || typeof root !== 'object' || !Array.isArray(root.cases) || root.cases.length === 0)
    die(`${path} has no cases`);
  return { fname, area: typeof root.area === 'string' ? root.area : fname, cases: root.cases };
});
const declaredCases = corpus.reduce((n, f) => n + f.cases.length, 0);

/* ------------------------------------------------------------------ *
 * The engine.
 * ------------------------------------------------------------------ */
if (!existsSync(gluePath)) die(`wasm glue not found: ${gluePath} (run scripts/build_wasm.sh)`);
const createInsimul = (await import(pathToFileURL(gluePath).href)).default;
// Insimul.createKb() opens its own never-destroyed keepalive KB, which is what
// makes the per-case create/destroy cycle below safe (Trealla deadlocks when
// its process-global symbol table is torn down and re-initialised — see
// CLAUDE.md "Trealla gotchas"). The C leg does this explicitly in main().
const insimul = await loadInsimul(createInsimul);

let pass = 0, fail = 0, cases = 0, amendedCount = 0;

function runCase(area, c) {
  cases++;
  const name = typeof c.name === 'string' ? c.name : '?';
  const unordered = c.unordered === true;

  if (typeof c.query !== 'string' || !Array.isArray(c.expected)) {
    console.log(`  [FAIL] ${area} / ${name} — malformed case (missing query/expected)`);
    dumpRecords.push({ area, name, status: 'fail', amended: false, solutions: [], error: 'malformed case' });
    fail++;
    return;
  }

  const joined = Array.isArray(c.kb) && c.kb.length
    ? c.kb.filter((l) => typeof l === 'string').join('\n') + '\n'
    : null;
  const [src, amendedKb] = joined === null ? [null, false] : applyAmendments(area, name, joined);
  const [query, amendedQuery] = applyAmendments(area, name, c.query);
  const amended = amendedKb || amendedQuery;
  if (amended) {
    console.log(`  [AMEND] ${area} / ${name} — ${amendReason(area, name)}`);
    amendedCount++;
  }

  const kb = insimul.createKb();
  let ok = true;
  let why = null;
  const raw = [];       // the ABI's own solution text, for the parity dump
  const actual = [];    // parsed, for the comparison

  try {
    if (src !== null) kb.consult(src);
    const q = kb.query(query);
    try {
      // nextRaw() rather than the solutions() sugar: the parity dump needs the
      // exact JSON text the ABI produced, before JSON.parse normalises it.
      for (let s = q.nextRaw(); s !== null; s = q.nextRaw()) {
        raw.push(s);
        try {
          actual.push(JSON.parse(s));
        } catch {
          ok = false;
          why = 'ABI returned unparseable JSON';
          actual.push(null);
        }
      }
    } finally {
      q.stop();
    }
  } catch (e) {
    ok = false;
    why = e instanceof InsimulError ? e.message : String(e);
  } finally {
    kb.destroy();
  }

  const match = ok && solutionsMatch(c.expected, actual, unordered);
  if (match) {
    console.log(`  [PASS] ${area} / ${name}`);
    pass++;
  } else {
    console.log(`  [FAIL] ${area} / ${name}`);
    if (!ok && why) console.log(`         query error: ${why}`);
    console.log(`         query:    ${query}`);
    console.log(`         expected: ${JSON.stringify(c.expected)}${unordered ? '  (unordered)' : ''}`);
    console.log(`         actual:   ${JSON.stringify(actual)}`);
    fail++;
  }

  const rec = { area, name, status: match ? 'pass' : 'fail', amended, solutions: raw };
  if (!ok) rec.error = why ?? 'query error';
  dumpRecords.push(rec);
}

for (const f of corpus) {
  console.log(`== ${f.fname} (${f.area}) ==`);
  for (const c of f.cases) runCase(f.area, c);
}

console.log('\n-------------------------------------------------------------');
console.log(
  `conformance: ${files.length} files, ${cases} cases, ${pass} passed, ${fail} failed, ${amendedCount} amended`);
if (amendedCount)
  console.log(
    `conformance: ${amendedCount} case(s) ran with DOCUMENTED amendments (see the ` +
    '[AMEND] lines above, wasm_conformance.mjs, and progress.txt) — flagged for human review.');

if (dumpPath) {
  writeFileSync(dumpPath, dumpRecords.map((r) => JSON.stringify(r)).join('\n') + '\n');
}

/* ------------------------------------------------------------------ *
 * Non-vacuity gates. `declaredCases` is what the corpus contains and therefore
 * exactly what the native leg executes over the same directory — so "fewer
 * cases ran than the corpus declares" is precisely "fewer than the native run".
 * ------------------------------------------------------------------ */
if (cases === 0) die('zero cases executed — refusing to pass vacuously.');
if (cases < declaredCases)
  die(`only ${cases} of the ${declaredCases} cases in the corpus executed — ` +
      'refusing to pass on a partial run.');
if (minCases && cases < minCases)
  die(`${cases} cases executed, but the required floor is ${minCases} ` +
      '(INSIMUL_CONFORMANCE_MIN_CASES / --min-cases).');

process.exit(fail === 0 ? 0 : 1);
