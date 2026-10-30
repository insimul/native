#!/usr/bin/env node
// vendor-core-bundle.mjs — produce (and verify) the vendored `@insimul/core`
// bundle that libinsimulcore evaluates, and the bridge case corpus derived from
// the same core commit.
//
// WHY A VENDORED ARTIFACT. This repository is standalone by design (it vendors
// `conformance/` rather than path-resolving into `packages/core`), so it cannot
// run a bundler against core at build time: core is not here. The bundle is
// therefore a build artifact checked in beside the corpus, with the same
// discipline — a recorded source commit, a recorded hash, and a drift guard
// that fails loudly rather than silently shipping a stale core.
//
// THE PIN (corebridge/core-pin.json) IS THE INPUT; VENDORED.json IS THE RECORD.
// The bundle is a function of exactly four things, and every one of them is
// pinned or hashed:
//
//   1. core's source AT `coreCommit` — read with `git archive <commit>` into a
//      throwaway directory, never from the checkout's working tree, so a dirty
//      or differently-checked-out core cannot leak into the artifact;
//   2. the bundler — `esbuild` at exactly the version the pin names (resolved
//      from the core checkout's node_modules; a different version is refused);
//   3. the npm packages core's bundled modules import (resolved from the same
//      node_modules; each one's name@version is recorded in VENDORED.json);
//   4. the adapter JS in corebridge/js/ and the case emitter beside this file
//      (hashed in VENDORED.json's `files`).
//
// THE LAYOUT CORPUS IS COPIED, NOT TRANSCRIBED (L.native-layout, ruling U36).
// core's `conformance/layout/*.json` and `conformance/layout-composition/*.json`
// at the pin are copied byte for byte into vendor/core/conformance/ and hashed
// in `files`; nothing here parses or rewrites them. tests/layout_corpus.cpp runs
// them through the `layout.*` rows. `--check` holds each copy to its recorded
// sha256; `--check --core` holds the copied SET and every byte to core at the pin.
//
// TWO MODES:
//
//   node corebridge/tools/vendor-core-bundle.mjs --core <core git checkout>
//       Re-bundle core at the pinned commit and write vendor/core/ (the bundle,
//       its C array, VENDORED.json and the derived case corpus vendor/core/cases/).
//       <core git checkout> is any checkout of @insimul/core that HAS the pinned
//       commit object and an installed node_modules (`npm install` in it); which
//       commit it has checked out does not matter.
//
//   node corebridge/tools/vendor-core-bundle.mjs --check [--core <checkout>]
//       Verify the checked-in artifacts are self-consistent and agree with the
//       pin. Needs no core checkout, so it runs in this repo's gates (the
//       `core_vendor` ctest). With --core it additionally re-bundles at the pin
//       and diffs the bundle AND the derived cases byte for byte — that is the
//       real reproducibility check.
//
// WHAT --check (no --core) ACTUALLY VERIFIES: a sha256 per file over the
// generated artifacts AND the inputs bundled into them (the adapter JS, the case
// emitter), and that VENDORED.json records the pinned commit and esbuild. It
// cannot see core changing underneath the bundle — only --core can, because that
// requires core. Say so rather than implying otherwise.
//
// THE IMPORT RESOLUTION IS THE INTERESTING PART. onResolve hooks implement the
// adapter/core boundary:
//
//   `@insimul/core/x`         -> <core@pin>/src/x.ts     — the one-way dependency.
//   `@insimul/core-scripts/x` -> <core@pin>/scripts/x.ts — the same one-way
//                                dependency, on core's non-`src` authorities
//                                (`quest-golden-manifest` defines the quest
//                                corpus's projection and the radiant tick).
//   `.../prolog-engine`       -> js/host-prolog-engine.js — the adapter SUPPLIES
//                                core's Prolog seam (core's own loads a wasm
//                                Trealla; this library links a native one).
//   `crypto` / `node:crypto`  -> js/host-crypto.js — SHA-256 computed by the C
//                                host (src/insimulcore_sha256.c).
//   Core's source is never patched; only the resolution of its seam imports
//   changes, which is what a seam is for.

import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const BRIDGE = path.resolve(HERE, '..');
const REPO = path.resolve(BRIDGE, '..');
const JS_DIR = fs.realpathSync(path.join(BRIDGE, 'js'));
const OUT_DIR = path.join(BRIDGE, 'vendor', 'core');
const CASES_DIR = path.join(OUT_DIR, 'cases');
const PIN_FILE = path.join(BRIDGE, 'core-pin.json');

const BUNDLE_JS = path.join(OUT_DIR, 'insimul-core-bundle.js');
const BUNDLE_C = path.join(OUT_DIR, 'insimul_core_bundle.c');
const BUNDLE_H = path.join(OUT_DIR, 'insimul_core_bundle.h');
const MANIFEST = path.join(OUT_DIR, 'VENDORED.json');

// core's layout corpora, copied verbatim (see the top of this file). Paths are
// core-relative; each lands at vendor/core/<same path>.
const LAYOUT_CORPUS_DIRS = ['conformance/layout', 'conformance/layout-composition'];

// The adapter JS that is BUNDLED IN — inputs, not outputs, and hashed for the
// reason spelled out at the top of this file. Paths are relative to BRIDGE, so
// the manifest reads the same wherever the bridge is checked out.
const ADAPTER_MODULES = [
  'js/entry.js',
  'js/host-console.js',
  'js/host-crypto.js',
  'js/host-prolog-engine.js',
  'js/host-sessions.js',
  'js/host-text-codec.js',
];

// The tool inputs that shape vendor/core/cases/ (the emitter) — hashed for the
// same reason as the adapter: an emitter edit that was never re-vendored leaves
// the gate running cases the source no longer describes.
const TOOL_INPUTS = ['tools/emit-bridge-cases.mjs', 'core-pin.json'];

const GENERATED_FIXED = [
  'vendor/core/insimul-core-bundle.js',
  'vendor/core/insimul_core_bundle.c',
  'vendor/core/insimul_core_bundle.h',
];

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

function readPin() {
  if (!fs.existsSync(PIN_FILE)) fail('corebridge/core-pin.json is missing — the bundle has no input pin');
  const pin = JSON.parse(fs.readFileSync(PIN_FILE, 'utf8'));
  if (!/^[0-9a-f]{40}$/.test(pin.coreCommit ?? '')) {
    fail('core-pin.json coreCommit must be a full 40-hex commit id (a ref or a short id can move)');
  }
  if (!/^\d+\.\d+\.\d+$/.test(pin.esbuild ?? '')) fail('core-pin.json esbuild must be an exact x.y.z version');
  return pin;
}

/** The generated case files currently on disk, as bridge-relative paths, sorted. */
function caseFilesOnDisk() {
  if (!fs.existsSync(CASES_DIR)) return [];
  return fs
    .readdirSync(CASES_DIR)
    .filter((f) => f.endsWith('.json'))
    .sort()
    .map((f) => `vendor/core/cases/${f}`);
}

/** The vendored layout corpus files on disk, as bridge-relative paths, sorted. */
function layoutFilesOnDisk() {
  const out = [];
  for (const dir of LAYOUT_CORPUS_DIRS) {
    const abs = path.join(OUT_DIR, dir);
    if (!fs.existsSync(abs)) continue;
    for (const f of fs.readdirSync(abs).filter((x) => x.endsWith('.json')).sort()) out.push(`vendor/core/${dir}/${f}`);
  }
  return out;
}

/** core's layout corpus files at the pin, as { 'vendor/core/<dir>/<f>': Buffer }. */
function layoutFilesAtPin(src) {
  const out = {};
  for (const dir of LAYOUT_CORPUS_DIRS) {
    const abs = path.join(src.root, dir);
    if (!fs.existsSync(abs)) fail(`core ${src.commit} has no ${dir}/ — the layout rows would have no corpus`);
    const names = fs.readdirSync(abs).filter((x) => x.endsWith('.json')).sort();
    if (names.length === 0) fail(`core ${src.commit} has an empty ${dir}/`);
    for (const f of names) out[`vendor/core/${dir}/${f}`] = fs.readFileSync(path.join(abs, f));
  }
  return out;
}

/** sha256 of each listed bridge-relative file. */
function hashFiles(list) {
  const out = {};
  for (const rel of list) {
    const abs = path.join(BRIDGE, rel);
    if (!fs.existsSync(abs)) fail(`missing vendored artifact corebridge/${rel}`);
    out[rel] = sha256(fs.readFileSync(abs, 'utf8'));
  }
  return out;
}

/**
 * Core at the pinned commit, as a directory, plus the node_modules to resolve its
 * npm imports and the bundler from. `cleanup()` removes the directory this
 * function created (and nothing else).
 */
function materialize(coreDir, pin) {
  const core = path.resolve(coreDir);
  let gitDir;
  try {
    gitDir = execFileSync('git', ['-C', core, 'rev-parse', '--git-dir'], { encoding: 'utf8' }).trim();
  } catch {
    fail(`--core ${core} is not a git checkout of @insimul/core`);
  }
  void gitDir;
  let full;
  try {
    full = execFileSync('git', ['-C', core, 'rev-parse', '--verify', `${pin.coreCommit}^{commit}`], {
      encoding: 'utf8',
    }).trim();
  } catch {
    fail(
      `the core checkout at ${core} does not have the pinned commit ${pin.coreCommit} ` +
        `(${pin.coreRef ?? 'no ref recorded'}) — fetch it first`,
    );
  }
  if (full !== pin.coreCommit) fail(`pinned commit resolved to ${full}, not itself`);

  // node_modules: the checkout's own, else the nearest one above it (a hoisted
  // monorepo install). It must hold the pinned esbuild.
  let nodeModules = null;
  for (let dir = core; ; dir = path.dirname(dir)) {
    const candidate = path.join(dir, 'node_modules');
    if (fs.existsSync(path.join(candidate, 'esbuild', 'package.json'))) {
      nodeModules = candidate;
      break;
    }
    if (path.dirname(dir) === dir) break;
  }
  if (!nodeModules) fail(`no node_modules with esbuild at or above ${core} — run \`npm install\` there`);
  const esbuildVersion = JSON.parse(
    fs.readFileSync(path.join(nodeModules, 'esbuild', 'package.json'), 'utf8'),
  ).version;
  if (esbuildVersion !== pin.esbuild) {
    fail(
      `esbuild ${esbuildVersion} in ${nodeModules} is not the pinned ${pin.esbuild}. ` +
        'A different bundler can emit different bytes; install the pinned one (or bump the pin and re-vendor).',
    );
  }

  // realpath: esbuild reports the paths it resolves itself through symlinks
  // (macOS's /var is /private/var), and every label below is matched by prefix.
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'insimul-core-at-pin-')));
  const tar = execFileSync('git', ['-C', core, 'archive', '--format=tar', full], {
    maxBuffer: 1024 * 1024 * 1024,
  });
  execFileSync('tar', ['-x', '-f', '-', '-C', root], { input: tar });
  if (!fs.existsSync(path.join(root, 'src', 'index.ts'))) {
    fs.rmSync(root, { recursive: true, force: true });
    fail(`commit ${full} does not look like packages/core (no src/index.ts)`);
  }
  return {
    root,
    nodeModules: fs.realpathSync(nodeModules),
    commit: full,
    esbuildVersion,
    cleanup: () => fs.rmSync(root, { recursive: true, force: true }),
  };
}

/** `node_modules/@scope/pkg/x.js` → `@scope/pkg`; `node_modules/pkg/x.js` → `pkg`. */
function npmPackageOf(nodeModules, abs) {
  const rel = path.relative(nodeModules, abs).split(path.sep);
  return rel[0].startsWith('@') ? `${rel[0]}/${rel[1]}` : rel[0];
}

/** Bundle core@pin + the adapter's JS glue into one script at `outfile`. */
async function bundle(src, outfile) {
  const { root: core, nodeModules } = src;
  const require = createRequire(path.join(nodeModules, 'esbuild', 'package.json'));
  const esbuild = await import(pathToFileURL(require.resolve('esbuild')).href);

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
    // The extracted tree has no node_modules of its own; npm imports resolve from
    // the checkout's (and their versions are recorded below).
    nodePaths: [nodeModules],
    mainFields: ['module', 'main'],
    outfile,
    legalComments: 'none',
    metafile: true,
    logLevel: 'silent',
    plugins: [adapterBoundary],
  });
  if (result.errors.length > 0) fail(`esbuild reported ${result.errors.length} error(s)`);

  // esbuild labels each bundled module with its path RELATIVE TO THE PROCESS
  // CWD. That makes the artifact a function of where core happens to sit, not of
  // its inputs: rewrite each label to a canonical, layout-independent name. A
  // gate that fires on a correct tree is as bad as one that never fires.
  const canonicalLabel = (p) => {
    const abs = path.resolve(p);
    if (abs.startsWith(`${core}${path.sep}`)) {
      return `@insimul/core/${path.relative(core, abs).split(path.sep).join('/')}`;
    }
    if (abs.startsWith(`${JS_DIR}${path.sep}`)) return `corebridge/js/${path.basename(abs)}`;
    if (abs.startsWith(`${nodeModules}${path.sep}`)) {
      return `npm:${path.relative(nodeModules, abs).split(path.sep).join('/')}`;
    }
    return path.basename(abs);
  };
  let text = fs.readFileSync(outfile, 'utf8');
  for (const key of Object.keys(result.metafile.inputs)) {
    text = text.split(`// ${key}\n`).join(`// ${canonicalLabel(key)}\n`);
  }
  fs.writeFileSync(outfile, text);

  const abs = Object.keys(result.metafile.inputs).map((p) => path.resolve(p));
  const coreModules = abs
    .filter((p) => p.startsWith(`${core}${path.sep}`))
    .map((p) => path.relative(core, p).split(path.sep).join('/'))
    .sort();
  const npmModules = {};
  for (const p of abs.filter((x) => x.startsWith(`${nodeModules}${path.sep}`))) {
    const pkg = npmPackageOf(nodeModules, p);
    npmModules[pkg] = JSON.parse(fs.readFileSync(path.join(nodeModules, pkg, 'package.json'), 'utf8')).version;
  }
  return { coreModules, npmModules };
}

/** The derived case corpus, as { fileName: text }. */
async function emitCases(src, pin) {
  const { emitBridgeCases } = await import(pathToFileURL(path.join(HERE, 'emit-bridge-cases.mjs')).href);
  return emitBridgeCases(src.root, pin.coreCommit);
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

async function write(coreDir) {
  const pin = readPin();
  const src = materialize(coreDir, pin);
  try {
    fs.mkdirSync(OUT_DIR, { recursive: true });
    const { coreModules, npmModules } = await bundle(src, BUNDLE_JS);
    const cases = await emitCases(src, pin);
    // vendor/core/cases/ is wholly generated: replace its *.json set exactly, so
    // a case file the emitter no longer writes cannot linger and keep passing.
    fs.mkdirSync(CASES_DIR, { recursive: true });
    for (const f of fs.readdirSync(CASES_DIR)) {
      if (f.endsWith('.json') && !(f in cases)) fs.rmSync(path.join(CASES_DIR, f));
    }
    for (const [name, text] of Object.entries(cases)) fs.writeFileSync(path.join(CASES_DIR, name), text);

    // The layout corpus: the same exact-set replacement, bytes copied unchanged.
    const layout = layoutFilesAtPin(src);
    for (const rel of layoutFilesOnDisk()) if (!(rel in layout)) fs.rmSync(path.join(BRIDGE, rel));
    for (const [rel, bytes] of Object.entries(layout)) {
      fs.mkdirSync(path.dirname(path.join(BRIDGE, rel)), { recursive: true });
      fs.writeFileSync(path.join(BRIDGE, rel), bytes);
    }

    const js = fs.readFileSync(BUNDLE_JS, 'utf8');
    const manifest = {
      description:
        'Vendored @insimul/core bundle evaluated by libinsimulcore (corebridge/), and the bridge case corpus ' +
        'derived from the same commit. GENERATED by corebridge/tools/vendor-core-bundle.mjs from the pin in ' +
        'corebridge/core-pin.json — do not hand-edit any file in this directory.',
      source: '@insimul/core (packages/core)',
      coreCommit: src.commit,
      coreRef: pin.coreRef ?? null,
      esbuild: src.esbuildVersion,
      coreModules,
      npmModules,
      adapterModules: ADAPTER_MODULES,
      toolInputs: TOOL_INPUTS,
      layoutCorpus: LAYOUT_CORPUS_DIRS,
      bundleBytes: Buffer.byteLength(js, 'utf8'),
      bundleSha256: sha256(js),
    };
    const { c, h } = emitC(js, manifest);
    fs.writeFileSync(BUNDLE_C, c);
    fs.writeFileSync(BUNDLE_H, h);
    // Hashed LAST: the .c/.h are derived from the bundle text plus provenance.
    manifest.files = hashFiles([
      ...GENERATED_FIXED,
      ...caseFilesOnDisk(),
      ...layoutFilesOnDisk(),
      ...ADAPTER_MODULES,
      ...TOOL_INPUTS,
    ]);
    fs.writeFileSync(MANIFEST, `${JSON.stringify(manifest, null, 2)}\n`);
    console.log(`vendor-core-bundle: wrote ${manifest.bundleBytes} bytes from core ${manifest.coreCommit}`);
    console.log(`  core modules (${coreModules.length}): ${coreModules.join(', ')}`);
    console.log(`  npm modules: ${Object.keys(npmModules).length ? JSON.stringify(npmModules) : 'none'}`);
    console.log(`  case files (${Object.keys(cases).length}): ${Object.keys(cases).join(', ')}`);
    console.log(`  layout corpus files (${Object.keys(layout).length}), copied unchanged`);
  } finally {
    src.cleanup();
  }
}

async function check(coreDir) {
  const pin = readPin();
  for (const f of [BUNDLE_JS, BUNDLE_C, BUNDLE_H, MANIFEST]) {
    if (!fs.existsSync(f)) fail(`missing vendored artifact ${path.relative(REPO, f)} — run without --check`);
  }
  const js = fs.readFileSync(BUNDLE_JS, 'utf8');
  const manifest = JSON.parse(fs.readFileSync(MANIFEST, 'utf8'));
  if (manifest.coreCommit !== pin.coreCommit) {
    fail(
      `VENDORED.json records core ${manifest.coreCommit} but core-pin.json pins ${pin.coreCommit} — ` +
        're-vendor with --core',
    );
  }
  if (manifest.esbuild !== pin.esbuild) {
    fail(`VENDORED.json records esbuild ${manifest.esbuild} but core-pin.json pins ${pin.esbuild}`);
  }
  const actual = sha256(js);
  if (actual !== manifest.bundleSha256) {
    fail(`bundle hash drift: VENDORED.json records ${manifest.bundleSha256}, file hashes ${actual}`);
  }

  if (!manifest.files || typeof manifest.files !== 'object') {
    fail('VENDORED.json records no `files` hash map — re-vendor with --core');
  }
  const caseFiles = caseFilesOnDisk();
  if (caseFiles.length === 0) fail('vendor/core/cases/ holds no case file — the bridge gate would run nothing');
  const layoutFiles = layoutFilesOnDisk();
  for (const dir of LAYOUT_CORPUS_DIRS) {
    if (!layoutFiles.some((f) => f.startsWith(`vendor/core/${dir}/`))) {
      fail(`vendor/core/${dir}/ holds no corpus file — the layout gate would run nothing`);
    }
  }
  const expectedList = [...GENERATED_FIXED, ...caseFiles, ...layoutFiles, ...ADAPTER_MODULES, ...TOOL_INPUTS];
  const hashes = hashFiles(expectedList);
  const inputs = [...ADAPTER_MODULES, ...TOOL_INPUTS];
  for (const rel of expectedList) {
    const recorded = manifest.files[rel];
    if (!recorded) fail(`VENDORED.json records no sha256 for corebridge/${rel}`);
    if (recorded !== hashes[rel]) {
      fail(
        `sha256 drift in corebridge/${rel}\n` +
          `  VENDORED.json records ${recorded}\n` +
          `  the file hashes      ${hashes[rel]}\n` +
          (inputs.includes(rel)
            ? '  This file is an INPUT to the vendored artifacts — editing it does nothing until you re-vendor:\n' +
              '      node corebridge/tools/vendor-core-bundle.mjs --core <core checkout>'
            : rel.startsWith('vendor/core/conformance/')
              ? '  This file is core\'s layout corpus, COPIED at the pin — never edit it here; change it in core, re-pin, re-vendor.'
              : '  This file is GENERATED — do not hand-edit it; re-vendor instead.'),
      );
    }
  }
  for (const rel of Object.keys(manifest.files)) {
    if (!expectedList.includes(rel)) fail(`VENDORED.json hashes a file that is not there or not expected: ${rel}`);
  }

  const { c, h } = emitC(js, manifest);
  if (fs.readFileSync(BUNDLE_C, 'utf8') !== c) fail('insimul_core_bundle.c does not match the bundle it claims to embed');
  if (fs.readFileSync(BUNDLE_H, 'utf8') !== h) fail('insimul_core_bundle.h is stale');
  console.log(
    `vendor-core-bundle: ${expectedList.length} file(s) match their recorded sha256 ` +
      `(${manifest.bundleBytes} bytes, ${caseFiles.length} case file(s), ${layoutFiles.length} layout corpus file(s), ` +
      `core ${manifest.coreCommit}, esbuild ${manifest.esbuild})`,
  );

  if (coreDir) {
    const src = materialize(coreDir, pin);
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'insimul-bundle-'));
    try {
      const tmp = path.join(tmpDir, 'bundle.js');
      const fresh = await bundle(src, tmp);
      if (fs.readFileSync(tmp, 'utf8') !== js) {
        fail(
          `DRIFT: re-bundling core ${pin.coreCommit} produces different output than the vendored artifact.\n` +
            '  An input changed without a re-vendor. Re-vendor with --core and re-run the bridge gates.',
        );
      }
      if (JSON.stringify(fresh.npmModules) !== JSON.stringify(manifest.npmModules ?? {})) {
        fail(`DRIFT: npm modules ${JSON.stringify(fresh.npmModules)} differ from the recorded ${JSON.stringify(manifest.npmModules)}`);
      }
      const cases = await emitCases(src, pin);
      const names = Object.keys(cases).sort();
      const onDisk = caseFiles.map((f) => path.basename(f));
      if (JSON.stringify(names) !== JSON.stringify(onDisk)) {
        fail(`DRIFT: the emitter writes ${names.join(', ')} but vendor/core/cases/ holds ${onDisk.join(', ')}`);
      }
      for (const name of names) {
        if (fs.readFileSync(path.join(CASES_DIR, name), 'utf8') !== cases[name]) {
          fail(`DRIFT: vendor/core/cases/${name} is not what core ${pin.coreCommit} derives`);
        }
      }
      const layout = layoutFilesAtPin(src);
      const want = Object.keys(layout).sort();
      if (JSON.stringify(want) !== JSON.stringify([...layoutFiles].sort())) {
        fail(`DRIFT: core ${pin.coreCommit} has layout corpus ${want.join(', ')} but vendor/core/ holds ${layoutFiles.join(', ')}`);
      }
      for (const rel of want) {
        if (!fs.readFileSync(path.join(BRIDGE, rel)).equals(layout[rel])) {
          fail(`DRIFT: corebridge/${rel} is not byte-identical to core ${pin.coreCommit}'s ${rel.slice('vendor/core/'.length)}`);
        }
      }
      console.log(
        `vendor-core-bundle: re-bundling and re-deriving at the pin reproduces the bundle, all ${names.length} case file(s) ` +
          `and all ${want.length} layout corpus file(s) byte for byte`,
      );
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
      src.cleanup();
    }
  } else {
    console.log('vendor-core-bundle: no --core given, so the artifacts were NOT re-derived from core');
  }
}

if (checkOnly) {
  await check(coreArg);
} else if (coreArg) {
  await write(coreArg);
} else {
  fail('usage: vendor-core-bundle.mjs --core <core git checkout> | --check [--core <checkout>]');
}
