/*
 * index.mjs — the entry point of the packaged wasm distribution (dist/wasm/).
 *
 * `insimul-api.mjs` is deliberately engine-agnostic: it takes an Emscripten
 * module FACTORY, so a host can control where the .wasm comes from and can run
 * several independent instances. That indirection is the right default for the
 * repo, but a package consumer just wants "give me an engine". This file is the
 * one-line bridge, and it is what `package.json`'s `exports["."]` points at:
 *
 *   import loadInsimul from '@insimul/prolog-wasm';
 *
 *   const insimul = await loadInsimul();
 *   const kb = insimul.createKb();
 *   kb.consult('parent(tom, bob).');
 *   for (const s of kb.solutions('parent(tom, Who)')) console.log(s.Who);
 *   kb.destroy();
 *
 * NOTE it resolves `./insimul.mjs` — the GENERATED Emscripten glue, which lives
 * in `build-wasm/`, not in this directory. So this module only imports cleanly
 * once `scripts/package.sh --target wasm` has assembled the two of them side by
 * side under `dist/wasm/`. Inside the repo, import `insimul-api.mjs` directly
 * and pass it the glue yourself (that is what tests/wasm_*.mjs do).
 *
 * The glue fetches `insimul.wasm` relative to its own URL. To put the binary
 * somewhere else, pass Emscripten's `locateFile` straight through:
 *
 *   const insimul = await loadInsimul({ locateFile: () => myWasmUrl });
 *
 * See docs/consuming.md ("Web / JS bundlers") for the bundler and CSP details.
 */

import createInsimul from './insimul.mjs';
import { loadInsimul } from './insimul-api.mjs';

export { loadInsimul, Insimul, InsimulError, Kb, Query } from './insimul-api.mjs';

/**
 * Instantiate the engine.
 *
 * @param {object} [moduleOptions] passed to the Emscripten factory (e.g.
 *   `{ locateFile }` when `insimul.wasm` is served from another path).
 * @returns {Promise<import('./insimul-api.mjs').Insimul>}
 */
export default function load(moduleOptions = {}) {
  return loadInsimul(createInsimul, moduleOptions);
}
