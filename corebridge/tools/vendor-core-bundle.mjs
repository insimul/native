#!/usr/bin/env node
// vendor-core-bundle.mjs — produce (and verify) the vendored `@insimul/core`
// bundle that libinsimulcore evaluates.
//
// WHY A VENDORED ARTIFACT. This repository is standalone by design (it vendors
// `conformance/` rather than path-resolving into `packages/core`), so it cannot
// run a bundler against core at build time: core is not here. The bundle is
// therefore a build artifact checked in beside the corpus, with the same
// discipline — a recorded source commit, a recorded hash, and a drift guard
// that fails loudly rather than silently shipping a stale core.
//
// TWO MODES:
//
//   node corebridge/tools/vendor-core-bundle.mjs --core <path-to-packages/core>
//       Re-bundle from a core checkout and write the artifacts. Run this when
//       adopting more of core, or when core changes under an adopted method.
//
//   node corebridge/tools/vendor-core-bundle.mjs --check
//       Verify the checked-in artifacts are self-consistent. Needs no core
//       checkout, so it runs in this repo's gates (the `core_vendor` ctest). If
//       a core checkout IS available, pass --core as well and it additionally
//       re-bundles into a temporary file and diffs — that is the real drift
//       check.
//
// WHAT --check ACTUALLY VERIFIES: a sha256 per file, recorded in VENDORED.json's
// `files` map, over BOTH the generated artifacts and the adapter JS that went
// into them. The two failure modes that matters for are different:
//
//   - a GENERATED file edited by hand (or a .c array swapped under a stale .js)
//     — caught by the hash and by re-deriving the .c/.h from the bundle text;
//   - an ADAPTER file edited without re-bundling — js/entry.js, js/host-prolog-
//     engine.js and js/host-crypto.js are INPUTS baked into the bundle, so an
//     edit that was never re-vendored leaves the shipping library running the
//     old code while the source reads as the new. Hashing the inputs is the only
//     way to see that from inside this repo, which has no core checkout to
//     re-bundle against.
//
// It cannot see core changing underneath the bundle — only --core can, because
// that requires core. Say so rather than implying otherwise.
//
// THE IMPORT RESOLUTION IS THE INTERESTING PART. Two onResolve hooks implement
// the adapter/core boundary:
//
//   `@insimul/core/x`     -> <core>/src/x.ts        — the one-way dependency.
//   `@insimul/core-scripts/x` -> <core>/scripts/x.ts — the same one-way
//                            dependency, on core's non-`src` authorities. Only
//                            `quest-golden-manifest` uses it: that file is where
//                            core DEFINES the quest corpus's projection and the
//                            radiant tick, so the parity gate compares against
//                            core's own definition rather than a copy of it.
//   `.../prolog-engine`   -> js/host-prolog-engine.js — the adapter SUPPLIES
//                            the Prolog seam, because core's own
//                            `createPrologEngine()` loads a **wasm** Trealla and
//                            this plugin links a native one. Core's source is
//                            never patched; only the resolution of its seam
//                            import changes, which is what a seam is for.
//                            See RUNTIME_CORE_ADOPTION.md §8 for the contract
//                            amendment that would make this explicit.

import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Layout, after the promotion out of the Godot plugin (tasklist 104): the
// bridge is corebridge/ at this repo's root, and this tool sits inside it. The
// bridge is self-contained on purpose — moving it again should stay a directory
// move plus a CMake target.
const HERE = path.dirname(fileURLToPath(import.meta.url));
const BRIDGE = path.resolve(HERE, '..');
const REPO = path.resolve(BRIDGE, '..');
const JS_DIR = path.join(BRIDGE, 'js');
const OUT_DIR = path.join(BRIDGE, 'vendor', 'core');

const BUNDLE_JS = path.join(OUT_DIR, 'insimul-core-bundle.js');
const BUNDLE_C = path.join(OUT_DIR, 'insimul_core_bundle.c');
const BUNDLE_H = path.join(OUT_DIR, 'insimul_core_bundle.h');
const MANIFEST = path.join(OUT_DIR, 'VENDORED.json');

// The adapter JS that is BUNDLED IN — inputs, not outputs, and hashed for the
// reason spelled out at the top of this file. Paths are relative to BRIDGE, so
// the manifest reads the same wherever the bridge is checked out.
const ADAPTER_MODULES = [
  'js/entry.js',
  'js/host-prolog-engine.js',
  'js/host-crypto.js',
];

// Everything --check hashes: the generated artifacts plus the adapter inputs.
const HASHED_FILES = [
  'vendor/core/insimul-core-bundle.js',
  'vendor/core/insimul_core_bundle.c',
  'vendor/core/insimul_core_bundle.h',
  ...ADAPTER_MODULES,
];

/** sha256 of every file in HASHED_FILES, keyed by its bridge-relative path. */
function hashFiles() {
  const out = {};
  for (const rel of HASHED_FILES) {
    const abs = path.join(BRIDGE, rel);
    if (!fs.existsSync(abs)) fail(`missing vendored artifact corebridge/${rel}`);
    out[rel] = sha256(fs.readFileSync(abs, 'utf8'));
  }
  return out;
}

const args = process.argv.slice(2);
const coreArg = argValue('--core') ?? process.env.INSIMUL_CORE_DIR ?? null;
const checkOnly = args.includes('--check');

function argValue(flag) {
  const i = args.indexOf(flag);
  return i >= 0 && i + 1 < args.length ? args[i + 1] : null;
}

function sha256(text) {
  return createHash('sha256').update(text).digest('hex');
}

function fail(message) {
  console.error(`vendor-core-bundle: ${message}`);
  process.exit(1);
}

/** Bundle core + the adapter's JS glue into one script. */
async function bundle(coreDir, outfile) {
  const core = path.resolve(coreDir);
  if (!fs.existsSync(path.join(core, 'src', 'index.ts'))) {
    fail(`--core ${core} does not look like packages/core (no src/index.ts)`);
  }
  // esbuild is resolved FROM the core checkout: this repo has no node_modules,
  // and the checkout that has core necessarily has a bundler.
  const require = createRequire(path.join(core, 'package.json'));
  let esbuild;
  try {
    esbuild = await import(require.resolve('esbuild'));
  } catch {
    fail(`esbuild is not resolvable from ${core} — run this from a checkout with core's node_modules installed`);
  }

  const adapterBoundary = {
    name: 'insimul-adapter-boundary',
    setup(build) {
      build.onResolve({ filter: /(^|\/)prolog-engine$/ }, () => ({
        path: path.join(JS_DIR, 'host-prolog-engine.js'),
      }));
      build.onResolve({ filter: /^(node:)?crypto$/ }, () => ({
        path: path.join(JS_DIR, 'host-crypto.js'),
      }));
      build.onResolve({ filter: /^@insimul\/core-scripts\// }, (a) => ({
        path: path.join(core, 'scripts', `${a.path.slice('@insimul/core-scripts/'.length)}.ts`),
      }));
      build.onResolve({ filter: /^@insimul\/core\// }, (a) => ({
        path: path.join(core, 'src', `${a.path.slice('@insimul/core/'.length)}.ts`),
      }));
    },
  };

  const result = await esbuild.build({
    entryPoints: [path.join(JS_DIR, 'entry.js')],
    bundle: true,
    format: 'iife',
    // QuickJS 2025-04-26 is ES2023-complete for everything core uses; es2020 is
    // a deliberately conservative floor that also keeps the output readable.
    target: 'es2020',
    platform: 'neutral',
    outfile,
    legalComments: 'none',
    metafile: true,
    plugins: [adapterBoundary],
  });

  const inputs = Object.keys(result.metafile.inputs)
    .map((p) => path.resolve(p))
    .filter((p) => p.startsWith(core))
    .map((p) => path.relative(core, p))
    .sort();
  return { inputs };
}

/** bin2c — the bundle as a C byte array, so the shipping library needs no files. */
function emitC(js, manifest) {
  const bytes = Buffer.from(js, 'utf8');
  const lines = [];
  for (let i = 0; i < bytes.length; i += 16) {
    const row = [...bytes.subarray(i, i + 16)].map((b) => String(b)).join(',');
    lines.push(`\t${row},`);
  }
  const banner = [
    '/*',
    ' * insimul_core_bundle.c — GENERATED, do not edit.',
    ' *',
    ' * Produced by tools/vendor-core-bundle.mjs from the sibling',
    ' * insimul-core-bundle.js. Regenerate both together; the gate',
    ' * (--check) fails if they disagree.',
    ' */',
    '',
  ].join('\n');
  const c = `${banner}#include "insimul_core_bundle.h"

const char insimul_core_bundle_source_commit[] = "${manifest.coreCommit}";
const char insimul_core_bundle_sha256[] = "${manifest.bundleSha256}";
const unsigned long insimul_core_bundle_js_len = ${bytes.length}UL;

const char insimul_core_bundle_js[] = {
${lines.join('\n')}
\t0
};
`;
  const h = `/*
 * insimul_core_bundle.h — GENERATED, do not edit.
 *
 * The vendored \`@insimul/core\` bundle, embedded so libinsimulcore is a single
 * self-contained artifact (the same reason libinsimul embeds its boot Prolog).
 * Provenance lives in VENDORED.json beside this file.
 */

#ifndef INSIMUL_CORE_BUNDLE_H
#define INSIMUL_CORE_BUNDLE_H

#ifdef __cplusplus
extern "C" {
#endif

/* NUL-terminated JS source; length EXCLUDES the terminator. */
extern const char insimul_core_bundle_js[];
extern const unsigned long insimul_core_bundle_js_len;

/* Provenance, reported by insimul_core_version(). */
extern const char insimul_core_bundle_source_commit[];
extern const char insimul_core_bundle_sha256[];

#ifdef __cplusplus
} /* extern "C" */
#endif

#endif /* INSIMUL_CORE_BUNDLE_H */
`;
  return { c, h };
}

function gitCommit(dir) {
  try {
    const { execFileSync } = require('node:child_process');
    return execFileSync('git', ['-C', dir, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
  } catch {
    return 'unknown';
  }
}

// `require` is not defined in ESM; make gitCommit's dynamic import work.
const require = createRequire(import.meta.url);

async function write(coreDir) {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const { inputs } = await bundle(coreDir, BUNDLE_JS);
  const js = fs.readFileSync(BUNDLE_JS, 'utf8');
  const manifest = {
    description:
      'Vendored @insimul/core bundle evaluated by libinsimulcore (corebridge/). ' +
      'GENERATED by corebridge/tools/vendor-core-bundle.mjs — do not hand-edit any file in this directory.',
    source: '@insimul/core (packages/core)',
    coreCommit: gitCommit(path.resolve(coreDir)),
    coreModules: inputs,
    adapterModules: ADAPTER_MODULES,
    bundleBytes: Buffer.byteLength(js, 'utf8'),
    bundleSha256: sha256(js),
  };
  const { c, h } = emitC(js, manifest);
  fs.writeFileSync(BUNDLE_C, c);
  fs.writeFileSync(BUNDLE_H, h);
  // Hashed LAST: the .c/.h are derived from the bundle text plus the two
  // provenance fields above, so they must exist before they can be hashed.
  manifest.files = hashFiles();
  fs.writeFileSync(MANIFEST, `${JSON.stringify(manifest, null, 2)}\n`);
  console.log(`vendor-core-bundle: wrote ${manifest.bundleBytes} bytes from core ${manifest.coreCommit}`);
  console.log(`  core modules: ${inputs.join(', ')}`);
}

async function check(coreDir) {
  for (const f of [BUNDLE_JS, BUNDLE_C, BUNDLE_H, MANIFEST]) {
    if (!fs.existsSync(f)) fail(`missing vendored artifact ${path.relative(REPO, f)} — run without --check`);
  }
  const js = fs.readFileSync(BUNDLE_JS, 'utf8');
  const manifest = JSON.parse(fs.readFileSync(MANIFEST, 'utf8'));
  const actual = sha256(js);
  if (actual !== manifest.bundleSha256) {
    fail(`bundle hash drift: VENDORED.json records ${manifest.bundleSha256}, file hashes ${actual}`);
  }

  // sha256 per file, over the generated artifacts AND the adapter JS baked into
  // them. A manifest with no `files` map predates this check and is a hard error
  // rather than a silent pass — an unhashed vendored tree is the hazard.
  if (!manifest.files || typeof manifest.files !== 'object') {
    fail('VENDORED.json records no `files` hash map — re-vendor with --core');
  }
  const hashes = hashFiles();
  for (const rel of HASHED_FILES) {
    const recorded = manifest.files[rel];
    if (!recorded) fail(`VENDORED.json records no sha256 for corebridge/${rel}`);
    if (recorded !== hashes[rel]) {
      fail(
        `sha256 drift in corebridge/${rel}\n` +
          `  VENDORED.json records ${recorded}\n` +
          `  the file hashes      ${hashes[rel]}\n` +
          (ADAPTER_MODULES.includes(rel)
            ? '  This file is BUNDLED IN — editing it does nothing until you re-vendor:\n' +
              '      node corebridge/tools/vendor-core-bundle.mjs --core <path-to-packages/core>'
            : '  This file is GENERATED — do not hand-edit it; re-vendor instead.'),
      );
    }
  }
  for (const rel of Object.keys(manifest.files)) {
    if (!HASHED_FILES.includes(rel)) fail(`VENDORED.json hashes an unknown file: ${rel}`);
  }

  const { c, h } = emitC(js, manifest);
  if (fs.readFileSync(BUNDLE_C, 'utf8') !== c) fail('insimul_core_bundle.c does not match the bundle it claims to embed');
  if (fs.readFileSync(BUNDLE_H, 'utf8') !== h) fail('insimul_core_bundle.h is stale');
  console.log(
    `vendor-core-bundle: ${HASHED_FILES.length} file(s) match their recorded sha256 ` +
      `(${manifest.bundleBytes} bytes, core ${manifest.coreCommit})`,
  );

  if (coreDir) {
    const tmp = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'insimul-bundle-')), 'bundle.js');
    await bundle(coreDir, tmp);
    const fresh = fs.readFileSync(tmp, 'utf8');
    if (fresh !== js) {
      fail(
        `DRIFT: re-bundling from ${coreDir} produces different output than the vendored artifact.\n` +
          '  Core has changed under an adopted method. Re-vendor with --core and re-run the radiant gate.',
      );
    }
    console.log('vendor-core-bundle: re-bundle from core reproduces the vendored artifact byte-for-byte');
  } else {
    console.log('vendor-core-bundle: no --core given, so drift against core itself was NOT checked');
  }
}

if (checkOnly) {
  await check(coreArg);
} else if (coreArg) {
  await write(coreArg);
} else {
  fail('usage: vendor-core-bundle.mjs --core <path-to-packages/core> | --check [--core <path>]');
}
