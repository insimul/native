/*
 * wasm_payload.mjs — what a page actually downloads for one wasm build.
 *
 * Tasklist 250 US-2: the wasm artifact's "exact output (payload files, total
 * transferred bytes)" has to be captured, per engine, by a command anyone can
 * re-run — a size quoted without the command that produced it is an anecdote,
 * and a size quoted without the OTHER files beside it is worse than none (the
 * default engine embeds its Prolog library in the .wasm; the spike's second
 * engine ships it as a separate --preload-file .data image, so comparing only
 * `insimul.wasm` would flatter the second engine by ~2.6 MB).
 *
 * It reports EVERY payload file present in the build directory, raw and as a
 * CDN would transfer it (gzip -9, brotli -11) — the same three columns
 * tests/wasm_package_smoke.mjs prints for the packaged directory, so the
 * numbers are directly comparable — and stamps the row set with what
 * insimul_version() says the module IS, so a table can never drift from the
 * engine it describes.
 *
 * Usage:
 *   node scripts/wasm_payload.mjs <build-dir> [--json]
 *
 *   node scripts/wasm_payload.mjs build-wasm            # the default engine
 *   node scripts/wasm_payload.mjs build-wasm-swipl      # the spike's second
 */

import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { gzipSync, brotliCompressSync, constants as zlibConstants } from 'node:zlib';
import { loadInsimul } from '../wasm/insimul-api.mjs';

const args = process.argv.slice(2);
const asJson = args.includes('--json');
const dir = args.find((a) => !a.startsWith('--'));
if (!dir) {
  console.error('wasm_payload: usage: node scripts/wasm_payload.mjs <build-dir> [--json]');
  process.exit(2);
}
const buildDir = resolve(dir);

/*
 * The payload is everything the module needs at run time, in load order:
 * the glue (an ES module the page imports), the binary it instantiates, and —
 * only for an engine whose library is not compiled in — the preload image the
 * glue fetches and mounts before main(). A file that is absent is simply not a
 * row; a file this list does not know about would be MISSED, so the check
 * below fails on any unexpected insimul.* artifact rather than under-reporting.
 */
const KNOWN = ['insimul.mjs', 'insimul.wasm', 'insimul.data'];
const present = KNOWN.filter((f) => existsSync(join(buildDir, f)));
if (!present.includes('insimul.mjs') || !present.includes('insimul.wasm')) {
  console.error(`wasm_payload: ${buildDir} holds no wasm build `
    + '(expected at least insimul.mjs and insimul.wasm).');
  process.exit(1);
}
const unexpected = readdirSync(buildDir)
  .filter((f) => f.startsWith('insimul.') && !KNOWN.includes(f));
if (unexpected.length > 0) {
  console.error(`wasm_payload: ${buildDir} holds artifact(s) this tool does not `
    + `know how to count: ${unexpected.join(', ')}.\n`
    + '  Add them to KNOWN (and to the packaging) rather than reporting a total '
    + 'that leaves them out.');
  process.exit(1);
}

const row = (name) => {
  const buf = readFileSync(join(buildDir, name));
  return {
    name,
    raw: buf.length,
    gzip: gzipSync(buf, { level: 9 }).length,
    brotli: brotliCompressSync(buf, {
      params: {
        [zlibConstants.BROTLI_PARAM_QUALITY]: 11,
        [zlibConstants.BROTLI_PARAM_SIZE_HINT]: buf.length,
      },
    }).length,
  };
};

const rows = present.map(row);
const total = rows.reduce((acc, r) => ({
  name: 'TOTAL', raw: acc.raw + r.raw, gzip: acc.gzip + r.gzip, brotli: acc.brotli + r.brotli,
}), { raw: 0, gzip: 0, brotli: 0 });

// The stamp: load the module and ask it. This also proves the build in this
// directory RUNS, which is what makes the row set evidence rather than a
// directory listing.
const createInsimul = (await import(pathToFileURL(join(buildDir, 'insimul.mjs')).href)).default;
const insimul = await loadInsimul(createInsimul,
  { locateFile: (path) => join(buildDir, path) });
const version = insimul.version();

if (asJson) {
  console.log(JSON.stringify({ buildDir, version, files: rows, total }, null, 2));
} else {
  const n = (v) => v.toLocaleString('en-US');
  console.log(`wasm_payload: ${buildDir}`);
  console.log(`wasm_payload: ${version}`);
  console.log('-------------------------------------------------------------');
  console.log(`  ${'file'.padEnd(14)} ${'raw'.padStart(11)} ${'gzip -9'.padStart(11)} ${'brotli -11'.padStart(11)}`);
  for (const r of [...rows, total]) {
    console.log(`  ${r.name.padEnd(14)} ${n(r.raw).padStart(11)} ${n(r.gzip).padStart(11)} ${n(r.brotli).padStart(11)}`);
  }
  console.log('-------------------------------------------------------------');
}
