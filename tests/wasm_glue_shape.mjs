/*
 * wasm_glue_shape.mjs — does the generated glue FETCH insimul.wasm, or inline it?
 *
 * docs/consuming.md promises consumers that `insimul.wasm` is a separate file the
 * glue fetches (CSP, caching, streaming compilation). This module is the one
 * place that promise is judged from the glue's TEXT; tests/wasm_package_smoke.mjs
 * additionally proves it by BEHAVIOUR (a lone copy of the glue cannot start).
 *
 * What is NOT evidence of inlining: the bare string
 * `data:application/octet-stream;base64,`. Emscripten 3.1.50 – 4.0.2 emit it in
 * EVERY build — `src/URIUtils.js` was `#include`d unconditionally by
 * `src/preamble.js` and `findWasmBinary()` asked `isDataURI(f)` even with
 * SINGLE_FILE off; 4.0.3 dropped the helper. Testing for that string made the
 * package smoke fail on a correctly fetched glue from any emsdk in that range
 * (3.1.74 included), while passing a SINGLE_FILE glue from 4.0.18 on, which
 * embeds the binary as a raw string rather than base64. So the judgement rests on
 * three things an inlined payload cannot avoid, each independent of the
 * Emscripten version:
 *
 *   name     the glue names the sibling binary (`insimul.wasm`) it will fetch;
 *   payload  no data URI carries a base64 payload (a prefix followed by data);
 *   size     the glue is far smaller than the binary — any inlined encoding
 *            (base64 at 4/3, a raw byte string at >= 1) is at least as big.
 *
 *   node tests/wasm_glue_shape.mjs <insimul.mjs> [--cases <cases.json>]
 *
 * With no --cases it judges the glue as built (exit 0 = fetched). With --cases it
 * also replays the case file (tests/wasm-glue-shape/cases.json): each
 * case applies a named transform to the REAL glue and binary and states the
 * expected verdict, so every rule above has a case that turns it red.
 */

import { readFileSync, existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const WASM_NAME = 'insimul.wasm';
export const DATA_URI_PREFIX = 'data:application/octet-stream;base64,';
// 64 base64 characters is 48 bytes — more than any constant the glue legitimately
// carries after the prefix, far less than any real payload.
const PAYLOAD_RE = /data:application\/octet-stream;base64,[A-Za-z0-9+/]{64,}/;
// A glue at half the binary's size or more has room for an inlined binary.
// The real one is ~5% (109,713 bytes against 2,086,227 with emcc 3.1.74).
export const MAX_GLUE_TO_WASM = 0.5;

/** Judge glue text against the binary's byte length. */
export function judgeGlue(glueText, wasmByteLength, wasmName = WASM_NAME) {
  const reasons = [];
  if (!glueText.includes(wasmName)) {
    reasons.push(`name: the glue never names ${wasmName}, so it has nothing to fetch`);
  }
  if (PAYLOAD_RE.test(glueText)) {
    reasons.push('payload: a data URI in the glue carries a base64 payload');
  }
  const ratio = glueText.length / wasmByteLength;
  if (ratio >= MAX_GLUE_TO_WASM) {
    reasons.push(`size: the glue is ${glueText.length} chars against a ${wasmByteLength}-byte binary `
      + `(ratio ${ratio.toFixed(3)} >= ${MAX_GLUE_TO_WASM}), room for an inlined binary`);
  }
  return { inlined: reasons.length > 0, reasons, ratio };
}

/* ----------------------------------------------------- case-file transforms */
// Each transform takes the real glue text and binary bytes and returns new glue
// text. They model the glue shapes Emscripten has actually emitted.
export const TRANSFORMS = {
  // The glue exactly as linked.
  'as-built': (glue) => glue,
  // Emscripten 3.1.50 – 4.0.2's unconditional URIUtils helper, present whether
  // or not anything is inlined. Must still judge as fetched.
  'with-helper-constant': (glue) =>
    `var dataURIPrefix="${DATA_URI_PREFIX}";var isDataURI=f=>f.startsWith(dataURIPrefix);${glue}`,
  // The sibling binary's name gone (a renamed or path-mangled output).
  'name-dropped': (glue) => glue.split(WASM_NAME).join('engine.bin'),
  // A short base64 data URI (a partial inline, or a second small payload) — the
  // glue stays small and keeps the name, so only the payload rule can see it.
  'data-uri-small-payload': (glue, wasm) =>
    `${glue}\nvar inlined="${DATA_URI_PREFIX}${Buffer.from(wasm.subarray(0, 3072)).toString('base64')}";`,
  // SINGLE_FILE from Emscripten 4.0.18 on: the binary as a raw string, no data
  // URI, name kept — only the size rule can see it.
  'inline-binary-string': (glue, wasm) =>
    `${glue}\nvar wasmBinaryData=${JSON.stringify(Buffer.from(wasm).toString('latin1'))};`,
  // The glue padded with an inert comment to `ratio` times the binary's size —
  // pins the size rule's threshold from both sides (a case on each side of it).
  'pad-to-ratio': (glue, wasm, c) =>
    `${glue}\n/*${'.'.repeat(Math.max(0, Math.ceil(wasm.length * c.ratio) - glue.length - 5))}*/`,
  // SINGLE_FILE up to 4.0.17: the binary as a base64 data URI in place of the name.
  'inline-base64-single-file': (glue, wasm) =>
    glue.split(`"${WASM_NAME}"`).join(`"${DATA_URI_PREFIX}${Buffer.from(wasm).toString('base64')}"`),
};

/** Replay a case file against the real glue + binary. Returns failing case ids. */
export function replayCases(cases, glueText, wasmBytes) {
  const failed = [];
  for (const c of cases) {
    const transform = TRANSFORMS[c.transform];
    if (!transform) {
      failed.push(c.id);
      console.error(`wasm_glue_shape: FAIL  ${c.id}: unknown transform '${c.transform}'`);
      continue;
    }
    const verdict = judgeGlue(transform(glueText, wasmBytes, c), wasmBytes.length);
    const got = verdict.inlined ? 'inlined' : 'fetched';
    const rulesOk = !c.rules || JSON.stringify(verdict.reasons.map((r) => r.split(':')[0]))
      === JSON.stringify(c.rules);
    if (got === c.expect && rulesOk) {
      console.log(`wasm_glue_shape: ok    ${c.id} -> ${got}${c.rules ? ` [${c.rules.join(',')}]` : ''}`);
    } else {
      failed.push(c.id);
      console.error(`wasm_glue_shape: FAIL  ${c.id}: want ${c.expect}${c.rules ? ` [${c.rules.join(',')}]` : ''}, `
        + `got ${got} [${verdict.reasons.map((r) => r.split(':')[0]).join(',')}]`);
    }
  }
  return failed;
}

/* ------------------------------------------------------------------- CLI */
const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const args = process.argv.slice(2);
  const glueArg = args.find((a, i) => !a.startsWith('--') && args[i - 1] !== '--cases');
  const ci = args.indexOf('--cases');
  const casesArg = ci >= 0 ? args[ci + 1] : null;
  if (!glueArg || (ci >= 0 && !casesArg)) {
    console.error('usage: node tests/wasm_glue_shape.mjs <insimul.mjs> [--cases <cases.json>]');
    process.exit(2);
  }
  const gluePath = resolve(glueArg);
  const wasmPath = join(dirname(gluePath), WASM_NAME);
  for (const p of [gluePath, wasmPath]) {
    if (!existsSync(p)) { console.error(`wasm_glue_shape: missing ${p}`); process.exit(2); }
  }
  const glue = readFileSync(gluePath, 'utf8');
  const wasm = readFileSync(wasmPath);
  const v = judgeGlue(glue, wasm.length);
  console.log(`wasm_glue_shape: as built -> ${v.inlined ? 'INLINED' : 'fetched'} `
    + `(glue/binary ${v.ratio.toFixed(3)}; Emscripten's bare data-URI helper `
    + `${glue.includes(DATA_URI_PREFIX) ? 'present, ignored' : 'absent'})`);
  for (const r of v.reasons) console.error(`  ${r}`);
  let failed = v.inlined ? ['as-built-glue'] : [];
  if (casesArg) {
    const file = JSON.parse(readFileSync(resolve(casesArg), 'utf8'));
    const cases = file.cases ?? [];
    if (cases.length === 0) {
      console.error(`wasm_glue_shape: ${casesArg} holds no cases — refusing to pass vacuously`);
      process.exit(2);
    }
    // Every rule must be turned red by at least one case, and both verdicts
    // must be represented, or the file cannot catch a rule that stops firing.
    const covered = new Set(cases.flatMap((c) => c.rules ?? []));
    for (const rule of ['name', 'payload', 'size']) {
      if (!covered.has(rule)) {
        console.error(`wasm_glue_shape: no case turns the '${rule}' rule red`);
        failed.push(`coverage:${rule}`);
      }
    }
    failed = failed.concat(replayCases(cases, glue, wasm));
    console.log(`wasm_glue_shape: ${cases.length} cases, ${failed.length} failed`);
  }
  if (failed.length) {
    console.error(`wasm_glue_shape: FAIL (${failed.join(', ')})`);
    process.exit(1);
  }
  console.log('wasm_glue_shape: PASS');
}
