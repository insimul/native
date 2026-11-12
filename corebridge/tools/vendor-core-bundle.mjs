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
//   3. the npm packages core's bundled modules import (resolved the way Node
//      resolves them from the checkout: its own node_modules, then each one
//      above it, then any --node-modules <dir> given; each one's name@version is
//      recorded in VENDORED.json, and --check --core compares that record);
//   4. the adapter JS in corebridge/js/ and the case emitter beside this file
//      (hashed in VENDORED.json's `files`).
//
// THE LAYOUT CORPUS IS COPIED, NOT TRANSCRIBED (L.native-layout, ruling U36).
// core's `conformance/layout/*.json` and `conformance/layout-composition/*.json`
// at the pin are copied byte for byte into vendor/core/conformance/ and hashed
// in `files`; nothing here parses or rewrites them. tests/layout_corpus.cpp runs
// them through the `layout.*` rows. `--check` holds each copy to its recorded
// sha256; `--check --core` holds the copied SET and every byte to core at the pin.
// The PACK corpus is copied the same way (SP.composer-native, U62(1)):
// `conformance/packs/composition.json` and the catalog files its `catalog`
// names (`packs/index.json`, `packs/<id>/pack.json`), at their core paths under
// vendor/core/; tests/packs_corpus.cpp runs them through the `packs.compose` row.
// The P9a corpora are copied the same way (P9a.native, U84):
// `conformance/ui/genre-hud-cases.json`, `conformance/ui/rules-panel-cases.json`
// and `conformance/modules/mechanic-runtime.json`, at their core paths under
// vendor/core/; tests/p9a_corpus.cpp runs them through the `ui.genreHud`,
// `ui.rulesPanel` and `mechanics.run` rows. The save-slots corpus is copied the
// same way (PL.native-catchup, P1.core-slots): `conformance/saves/slots.json` at
// its core path under vendor/core/; tests/saves_slots_corpus.cpp drives it
// through the `saves.slots.create` / `saves.slots.apply` session rows; beside it
// `conformance/saves/tutorial-progress.json` (PL.native-tutorial-save), which
// tests/title_corpus.cpp drives through the `ui.tutorial.*` and
// `ui.onboarding.*` rows. The P6
// corpora are copied the same way (PL.native-props-rows, U89(2)):
// `conformance/props/{containers,documents,doors,notice-board}.json` and
// `conformance/ui/inventory-cases.json`; tests/props_corpus.cpp drives them
// through the `props.*` and `inventory.*` rows. Core's pick-up placement corpus
// `conformance/props/pickup-placement.json` is copied with them
// (PL.native-pickup-settle, U91(2)) and driven through the `props.pickups.*` rows
// by the same runner, and so is its interact rule's corpus
// `conformance/props/interactables.json` (PL.native-interact-target, U94(3)),
// driven through the `props.interactables.*` rows. Core's P8 corpora are copied the same way
// (PL.native-title-rows, U92(1)): `conformance/ui/title-flow.json` and
// `conformance/quests/tutorial.json`; tests/title_corpus.cpp drives them through
// the `ui.titleFlow.*`, `ui.tutorial.*` and `ui.onboarding.*` rows. Core's
// movement contract corpus is copied the same way (PL.native-camera-movement,
// U95(5)): `conformance/camera/movement.json`; tests/props_corpus.cpp drives it
// through the `camera.movement.*` rows. So is core's ground reading corpus
// (PL.native-ground-row, U97(3)): `conformance/audio/ground.json`, driven by the
// same runner through the `audio.ground.*` rows.
//
// TWO MODES:
//
//   node corebridge/tools/vendor-core-bundle.mjs --core <core git checkout>
//       Re-bundle core at the pinned commit and write vendor/core/ (the bundle,
//       its C array, VENDORED.json and the derived case corpus vendor/core/cases/).
//       <core git checkout> is any checkout of @insimul/core that HAS the pinned
//       commit object and an installed node_modules (`npm install` in it, or in
//       a directory above it); which commit it has checked out does not matter.
//       `--node-modules <dir>` (repeatable) adds a node_modules directory to the
//       npm lookup after the checkout's own chain, for a checkout whose
//       packages are installed elsewhere (a loop worktree borrowing them).
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

// core's pack-composition corpus and the pack catalog it composes from
// (SP.composer-native, U62(1)), copied verbatim the same way: the corpus file,
// then exactly the files its `catalog` names (`packs/index.json` and each
// `packs/<id>/pack.json`), each at vendor/core/<same path>. The catalog list is
// read from the corpus at the pin, so the copy is the set core's own replay uses.
const PACK_CORPUS_FILE = 'conformance/packs/composition.json';
const PACK_COPY_ROOTS = ['conformance/packs', 'packs'];

// core's P9a corpora (P9a.native, U84), copied verbatim the same way: exactly
// these files, each at vendor/core/<same path>. The directories they sit in are
// listed so a file left behind by an earlier pin is seen (and removed) too.
const P9A_CORPUS_FILES = [
  'conformance/modules/mechanic-runtime.json',
  'conformance/ui/genre-hud-cases.json',
  'conformance/ui/rules-panel-cases.json',
];
const P9A_COPY_ROOTS = ['conformance/modules', 'conformance/ui'];

// core's save corpora that rows here run, copied verbatim the same way: the
// save-slots corpus (PL.native-catchup; P1.core-slots, U83(1)), driven through the
// `saves.slots.*` rows, and the tutorial progress corpus (PL.native-tutorial-save,
// U99(1); core's PL.tutorial-progress-save), driven through the `ui.tutorial.*`
// and `ui.onboarding.*` rows by tests/title_corpus.cpp. Only these files of
// `conformance/saves/`: the rest of that directory is the save-file corpora
// emit-bridge-cases.mjs transcribes (village-state.json has no rows here).
const SAVES_CORPUS_FILES = ['conformance/saves/slots.json', 'conformance/saves/tutorial-progress.json'];

// core's P6 corpora (PL.native-props-rows, U89(2); P6.core), copied verbatim the
// same way: the four props files and the inventory panel's cases. The inventory
// file shares `conformance/ui/` with the P9a corpora, so a file there belongs to
// the set that LISTS it (p9aFilesOnDisk leaves these out); `conformance/props/`
// is the props set's alone, so a file left there by an earlier pin is seen too.
// pickup-placement.json (PL.pickup-placement) joined the set with its
// `props.pickups.*` rows (PL.native-pickup-settle, U91(2)), and interactables.json
// (PL.examine-props) with its `props.interactables.*` rows
// (PL.native-interact-target, U94(3)).
const PROPS_CORPUS_FILES = [
  'conformance/props/containers.json',
  'conformance/props/documents.json',
  'conformance/props/doors.json',
  'conformance/props/interactables.json',
  'conformance/props/notice-board.json',
  'conformance/props/pickup-placement.json',
  'conformance/ui/inventory-cases.json',
];

// core's P8 corpora (PL.native-title-rows, U92(1); P8.core), copied verbatim the
// same way: the title menu's cases and the tutorial/onboarding cases. The title
// file shares `conformance/ui/` with the P9a and P6 sets, so it belongs to this
// list there; `conformance/quests/` is this set's alone.
const TITLE_CORPUS_FILES = ['conformance/quests/tutorial.json', 'conformance/ui/title-flow.json'];

// core's movement contract corpus (PL.native-camera-movement, U95(5); core's
// PL.movement-contract and PL.movement-followups), copied verbatim the same way.
// Only `movement.json` of `conformance/camera/`: P7.core's camera-modes corpus
// (`modes.json`) beside it has no rows here, so it is not copied; any other file
// found in vendor/core/conformance/camera/ is a stray the next write removes.
const CAMERA_CORPUS_FILES = ['conformance/camera/movement.json'];

// core's ground reading corpus (PL.native-ground-row, U97(3); core's
// PL.ground-from-ir, U94(5)), copied verbatim the same way. Only `ground.json` of
// `conformance/audio/`: P5.core's audio cue corpus (`cues.json`) beside it has no
// rows here, so it is not copied; any other file found in
// vendor/core/conformance/audio/ is a stray the next write removes.
const AUDIO_CORPUS_FILES = ['conformance/audio/ground.json'];

// core's P9c survival corpora (PL.native-survival-rows, U106(1); core's P9c.core and
// PL.core-survival-rules), copied verbatim the same way: the needs, HUD and stamina
// files, driven through the `survival.*` rows by tests/survival_corpus.cpp.
// `conformance/survival/` is this set's alone, so a file an earlier pin left there is
// seen, hashed and removed by the next write.
const SURVIVAL_CORPUS_FILES = ['conformance/survival/hud.json', 'conformance/survival/needs.json', 'conformance/survival/stamina.json'];

// core's P9e traversal corpora (PL.native-traversal-rows, U106(1); core's P9e.core),
// copied verbatim the same way, all seven, driven through the `traversal.*` rows by
// tests/traversal_corpus.cpp: slice 1's kernels (the planner's affordances and routes,
// the vehicle verbs, fast travel and ground seating) and slice 2's stateful layers
// (session.json: the planner, registry and director wired together; mounts.json: the
// personal vehicles; save.json: the save block). `conformance/traversal/` is this set's
// alone, so a file an earlier pin left there is seen, hashed and removed by the next write.
const TRAVERSAL_CORPUS_FILES = [
  'conformance/traversal/affordances.json',
  'conformance/traversal/fast-travel.json',
  'conformance/traversal/ground-seating.json',
  'conformance/traversal/mounts.json',
  'conformance/traversal/save.json',
  'conformance/traversal/session.json',
  'conformance/traversal/vehicles.json',
];

// core's P10 headless build corpus (PL.native-headless-build, U106(1), U107; core's
// P10.core), copied verbatim the same way: the request's plan or refusals, the result
// and progress checkers and the size line, driven through the `build.*` rows by
// tests/build_corpus.cpp. The ONE set vendored under another folder than core's: core
// keeps it at conformance/build/, a folder name every `build/` rule here reads as build
// output (.gitignore, and the history-scan and open-boundary `build-output-tree` rule,
// which reads every ref, so one branch's finding turns every other branch's scan red).
// The bytes are core's; the folder is named after the corpus's area, headless-build.
// `conformance/headless-build/` is this set's alone, so a file an earlier pin left there
// is seen, hashed and removed by the next write.
const BUILD_CORPUS_FROM = { 'conformance/headless-build/headless.json': 'conformance/build/headless.json' };
const BUILD_CORPUS_FILES = Object.keys(BUILD_CORPUS_FROM);

// Core modules the bundle must NOT carry (PL.native-interact-target, U94(2)/(3)): core's
// village-state comparator and the save-file game state behind it. No row needs them;
// they came in only through a corpus RUNNER module's comparator import (the P8 rows
// once imported `quests/tutorial-corpus` and `ui/title-flow-corpus`, ~29 KB of save
// code), which is why the rows import core's `*-corpus-host` modules instead. A
// write that would record one refuses, and `--check` (the core_vendor ctest) fails on
// a VENDORED.json that records one, naming it: the import to repoint is the one that
// reaches it.
//
// Core's movement prose (PL.native-ground-row, U97(1)/(3); core's PL.movement-prose-split):
// `camera/movement-prose` holds the frozen prose tables CAMERA_OCCLUSION_RULES and
// MOVEMENT_FRAME_MEANING, which no row reads (~3 KB of bundle). Core keeps it out of
// `camera/movement-rules`, the module the camera.movement.* rows import; importing
// `camera/movement-contract` (which re-exports both) would bring it back, and nothing
// in core can see native do that (its pl-movement-prose-split m1 and m4). Refused the
// same way, with its own remedy.
const UNBUNDLED_CORE_MODULES = ['src/save-file-game-state-corpus.ts', 'src/save-file-game-state.ts', 'src/camera/movement-prose.ts'];
const UNBUNDLED_REMEDY = {
  'src/camera/movement-prose.ts': 'a row imports camera/movement-contract (it re-exports the prose); import camera/movement-rules instead',
};
const UNBUNDLED_REMEDY_DEFAULT = 'a row imports a core corpus runner (its comparator); import the *-corpus-host module instead';

/** The recorded core modules that UNBUNDLED_CORE_MODULES forbids. */
function unbundledIn(coreModules) {
  return (coreModules ?? []).filter((m) => UNBUNDLED_CORE_MODULES.includes(m));
}

/** Each forbidden module with the import to repoint, for a failure message. */
function unbundledReport(modules) {
  return modules.map((m) => `${m} (${UNBUNDLED_REMEDY[m] ?? UNBUNDLED_REMEDY_DEFAULT})`).join('; ');
}

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
const extraNodeModules = argValues('--node-modules');
const checkOnly = args.includes('--check');

function argValue(flag) {
  const i = args.indexOf(flag);
  return i >= 0 && i + 1 < args.length ? args[i + 1] : null;
}

function argValues(flag) {
  const out = [];
  for (let i = 0; i < args.length - 1; i++) if (args[i] === flag) out.push(args[i + 1]);
  return out;
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

/** Every file under `abs`, recursively, as paths relative to it, sorted. */
function filesUnder(abs, rel = '') {
  if (!fs.existsSync(abs)) return [];
  const out = [];
  for (const e of fs.readdirSync(abs, { withFileTypes: true })) {
    const r = rel ? `${rel}/${e.name}` : e.name;
    if (e.isDirectory()) out.push(...filesUnder(path.join(abs, e.name), r));
    else out.push(r);
  }
  return out.sort();
}

/** Every *.json under `abs`, recursively, as paths relative to it, sorted. */
function jsonFilesUnder(abs, rel = '') {
  if (!fs.existsSync(abs)) return [];
  const out = [];
  for (const e of fs.readdirSync(abs, { withFileTypes: true })) {
    const r = rel ? `${rel}/${e.name}` : e.name;
    if (e.isDirectory()) out.push(...jsonFilesUnder(path.join(abs, e.name), r));
    else if (e.name.endsWith('.json')) out.push(r);
  }
  return out.sort();
}

/** The vendored pack corpus and catalog files on disk, as bridge-relative paths, sorted. */
function packFilesOnDisk() {
  const out = [];
  for (const dir of PACK_COPY_ROOTS) {
    for (const f of jsonFilesUnder(path.join(OUT_DIR, dir))) out.push(`vendor/core/${dir}/${f}`);
  }
  return out.sort();
}

/** The vendored P9a corpus files on disk, as bridge-relative paths, sorted. */
function p9aFilesOnDisk() {
  const out = [];
  for (const dir of P9A_COPY_ROOTS) {
    for (const f of jsonFilesUnder(path.join(OUT_DIR, dir))) {
      if (!PROPS_CORPUS_FILES.includes(`${dir}/${f}`) && !TITLE_CORPUS_FILES.includes(`${dir}/${f}`)) {
        out.push(`vendor/core/${dir}/${f}`);
      }
    }
  }
  return out.sort();
}

/** core's P9a corpora at the pin, as { 'vendor/core/<path>': Buffer }. */
function p9aFilesAtPin(src) {
  return filesAtPin(src, P9A_CORPUS_FILES, 'the P9a rows');
}

/** The vendored save corpus files on disk (any file under their directories), sorted. */
function savesFilesOnDisk() {
  const out = [];
  for (const dir of new Set(SAVES_CORPUS_FILES.map((rel) => path.dirname(rel)))) {
    for (const f of jsonFilesUnder(path.join(OUT_DIR, dir))) out.push(`vendor/core/${dir}/${f}`);
  }
  return out.sort();
}

/**
 * The vendored P6 corpus files on disk, sorted: every file under a directory only
 * the props set copies into, and the listed files in a directory it shares.
 */
function propsFilesOnDisk() {
  return listedFilesOnDisk(PROPS_CORPUS_FILES);
}

/** The vendored P8 corpus files on disk, sorted (the same rule as the P6 set's). */
function titleFilesOnDisk() {
  return listedFilesOnDisk(TITLE_CORPUS_FILES);
}

/**
 * The files on disk of a set copied as a `files` list: every file under a
 * directory no other set copies into, and only the listed files in a directory
 * it shares with the P9a set (`conformance/ui/`).
 */
function listedFilesOnDisk(files) {
  const out = [];
  for (const dir of new Set(files.map((rel) => path.dirname(rel)))) {
    const shared = P9A_COPY_ROOTS.includes(dir);
    for (const f of jsonFilesUnder(path.join(OUT_DIR, dir))) {
      if (!shared || files.includes(`${dir}/${f}`)) out.push(`vendor/core/${dir}/${f}`);
    }
  }
  return out.sort();
}

/** core's P6 corpora at the pin, as { 'vendor/core/<path>': Buffer }. */
function propsFilesAtPin(src) {
  return filesAtPin(src, PROPS_CORPUS_FILES, 'the props.* and inventory.* rows');
}

/** core's P8 corpora at the pin, as { 'vendor/core/<path>': Buffer }. */
function titleFilesAtPin(src) {
  return filesAtPin(src, TITLE_CORPUS_FILES, 'the ui.titleFlow, ui.tutorial and ui.onboarding rows');
}

/**
 * The vendored camera corpus files on disk: every file under their directories
 * (no other set copies into `conformance/camera/`), so a file an earlier pin left
 * there is seen, hashed and removed by the next write, as the save-slots set does.
 */
function cameraFilesOnDisk() {
  return ownDirFilesOnDisk(CAMERA_CORPUS_FILES);
}

/** The vendored audio corpus files on disk: the camera set's rule (no other set copies into `conformance/audio/`). */
function audioFilesOnDisk() {
  return ownDirFilesOnDisk(AUDIO_CORPUS_FILES);
}

/** The vendored survival corpus files on disk: the camera set's rule (no other set copies into `conformance/survival/`). */
function survivalFilesOnDisk() {
  return ownDirFilesOnDisk(SURVIVAL_CORPUS_FILES);
}

/** Every file under the directories of `files`, which no other set copies into, sorted. */
function ownDirFilesOnDisk(files) {
  const out = [];
  for (const dir of new Set(files.map((rel) => path.dirname(rel)))) {
    for (const f of jsonFilesUnder(path.join(OUT_DIR, dir))) out.push(`vendor/core/${dir}/${f}`);
  }
  return out.sort();
}

/** core's movement contract corpus at the pin, as { 'vendor/core/<path>': Buffer }. */
function cameraFilesAtPin(src) {
  return filesAtPin(src, CAMERA_CORPUS_FILES, 'the camera.movement rows');
}

/** core's ground reading corpus at the pin, as { 'vendor/core/<path>': Buffer }. */
function audioFilesAtPin(src) {
  return filesAtPin(src, AUDIO_CORPUS_FILES, 'the audio.ground rows');
}

/** core's survival corpora at the pin, as { 'vendor/core/<path>': Buffer }. */
function survivalFilesAtPin(src) {
  return filesAtPin(src, SURVIVAL_CORPUS_FILES, 'the survival.* rows');
}

/** The vendored traversal corpus files on disk: the camera set's rule (no other set copies into `conformance/traversal/`). */
function traversalFilesOnDisk() {
  return ownDirFilesOnDisk(TRAVERSAL_CORPUS_FILES);
}

/** core's P9e traversal corpora at the pin, as { 'vendor/core/<path>': Buffer }. */
function traversalFilesAtPin(src) {
  return filesAtPin(src, TRAVERSAL_CORPUS_FILES, 'the traversal.* rows');
}

/** The vendored headless build corpus on disk: the camera set's rule (no other set copies into `conformance/build/`). */
function buildFilesOnDisk() {
  return ownDirFilesOnDisk(BUILD_CORPUS_FILES);
}

/** core's P10 headless build corpus at the pin, as { 'vendor/core/<path>': Buffer }. */
function buildFilesAtPin(src) {
  const out = {};
  for (const [rel, from] of Object.entries(BUILD_CORPUS_FROM)) {
    const abs = path.join(src.root, from);
    if (!fs.existsSync(abs)) fail(`core ${src.commit} has no ${from} — the build.* rows would have no corpus`);
    out[`vendor/core/${rel}`] = fs.readFileSync(abs);
  }
  return out;
}

/** core's save corpora (slots, tutorial progress) at the pin, as { 'vendor/core/<path>': Buffer }. */
function savesFilesAtPin(src) {
  return filesAtPin(src, SAVES_CORPUS_FILES, 'the saves.slots and tutorial progress rows');
}

/** Exactly `files` (core-relative) at the pin, as { 'vendor/core/<path>': Buffer }. */
function filesAtPin(src, files, who) {
  const out = {};
  for (const rel of files) {
    const abs = path.join(src.root, rel);
    if (!fs.existsSync(abs)) fail(`core ${src.commit} has no ${rel} — ${who} would have no corpus`);
    out[`vendor/core/${rel}`] = fs.readFileSync(abs);
  }
  return out;
}

/**
 * core's pack-composition corpus at the pin and the catalog files it names, as
 * { 'vendor/core/<path>': Buffer }. The catalog is read from the corpus itself
 * (its `catalog` is what core's replay test composes from), never guessed.
 */
function packFilesAtPin(src) {
  const corpusAbs = path.join(src.root, PACK_CORPUS_FILE);
  if (!fs.existsSync(corpusAbs)) fail(`core ${src.commit} has no ${PACK_CORPUS_FILE} — the packs.compose row would have no corpus`);
  const corpus = fs.readFileSync(corpusAbs);
  const catalog = JSON.parse(corpus.toString('utf8')).catalog;
  const named = [catalog?.index, ...(Array.isArray(catalog?.manifests) ? catalog.manifests : [])];
  if (typeof catalog?.index !== 'string' || named.length < 2 || named.some((f) => typeof f !== 'string')) {
    fail(`${PACK_CORPUS_FILE} at ${src.commit} names no catalog { index, manifests }`);
  }
  const out = { [`vendor/core/${PACK_CORPUS_FILE}`]: corpus };
  for (const rel of named) {
    if (!PACK_COPY_ROOTS.some((r) => rel.startsWith(`${r}/`)) || rel.split('/').includes('..') || !rel.endsWith('.json')) {
      fail(`${PACK_CORPUS_FILE} at ${src.commit} names catalog file '${rel}', outside ${PACK_COPY_ROOTS.join(' and ')}`);
    }
    const abs = path.join(src.root, rel);
    if (!fs.existsSync(abs)) fail(`${PACK_CORPUS_FILE} at ${src.commit} names ${rel}, which core does not have`);
    out[`vendor/core/${rel}`] = fs.readFileSync(abs);
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

  // node_modules: the checkout's own and every one above it, in Node's lookup
  // order (a hoisted monorepo install can put esbuild in one and core's npm
  // dependencies in another), then any --node-modules given. The bundler is the
  // FIRST esbuild on that chain, and it must be the pinned one.
  const chain = [];
  for (let dir = core; ; dir = path.dirname(dir)) {
    const candidate = path.join(dir, 'node_modules');
    if (fs.existsSync(candidate)) chain.push(candidate);
    if (path.dirname(dir) === dir) break;
  }
  for (const extra of extraNodeModules) {
    if (!fs.existsSync(extra)) fail(`--node-modules ${extra} does not exist`);
    chain.push(path.resolve(extra));
  }
  const nodeModules = chain.find((d) => fs.existsSync(path.join(d, 'esbuild', 'package.json'))) ?? null;
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
  // (macOS's /var is a symlink to its real path), and every label below is matched by prefix.
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
    nodePaths: chain.map((d) => fs.realpathSync(d)),
    commit: full,
    esbuildVersion,
    cleanup: () => fs.rmSync(root, { recursive: true, force: true }),
  };
}

/**
 * An npm module's place by its LAST `node_modules` segment, wherever that
 * node_modules sits (esbuild reports a symlinked package by its real path, so
 * the root it was found through is not a prefix of it):
 * `…/node_modules/@scope/pkg/x.js` → { pkg: '@scope/pkg', dir, rel: '@scope/pkg/x.js' }.
 * Null for a path outside any node_modules.
 */
function npmModuleOf(abs) {
  const parts = abs.split(path.sep);
  const i = parts.lastIndexOf('node_modules');
  if (i < 0 || i + 1 >= parts.length) return null;
  const n = parts[i + 1].startsWith('@') ? 2 : 1;
  return {
    pkg: parts.slice(i + 1, i + 1 + n).join('/'),
    dir: parts.slice(0, i + 1 + n).join(path.sep),
    rel: parts.slice(i + 1).join('/'),
  };
}

/** Bundle core@pin + the adapter's JS glue into one script at `outfile`. */
async function bundle(src, outfile) {
  const { root: core, nodeModules, nodePaths } = src;
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
    // the checkout's lookup chain (and their versions are recorded below).
    nodePaths,
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
    const npm = npmModuleOf(abs);
    if (npm) return `npm:${npm.rel}`;
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
  for (const p of abs.filter((x) => !x.startsWith(`${core}${path.sep}`) && !x.startsWith(`${JS_DIR}${path.sep}`))) {
    const npm = npmModuleOf(p);
    if (!npm) continue;
    npmModules[npm.pkg] = JSON.parse(fs.readFileSync(path.join(npm.dir, 'package.json'), 'utf8')).version;
  }
  return { coreModules, npmModules: Object.fromEntries(Object.entries(npmModules).sort(([a], [b]) => a.localeCompare(b))) };
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
    if (unbundledIn(coreModules).length) {
      fail(`the bundle reaches ${unbundledReport(unbundledIn(coreModules))}`);
    }
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

    // The pack corpus and its catalog: the same exact-set replacement.
    const packs = packFilesAtPin(src);
    for (const rel of packFilesOnDisk()) if (!(rel in packs)) fs.rmSync(path.join(BRIDGE, rel));
    for (const [rel, bytes] of Object.entries(packs)) {
      fs.mkdirSync(path.dirname(path.join(BRIDGE, rel)), { recursive: true });
      fs.writeFileSync(path.join(BRIDGE, rel), bytes);
    }

    // The P9a corpora: the same exact-set replacement.
    const p9a = p9aFilesAtPin(src);
    for (const rel of p9aFilesOnDisk()) if (!(rel in p9a)) fs.rmSync(path.join(BRIDGE, rel));
    for (const [rel, bytes] of Object.entries(p9a)) {
      fs.mkdirSync(path.dirname(path.join(BRIDGE, rel)), { recursive: true });
      fs.writeFileSync(path.join(BRIDGE, rel), bytes);
    }

    // The save corpora (slots, tutorial progress): the same exact-set replacement.
    const saves = savesFilesAtPin(src);
    for (const rel of savesFilesOnDisk()) if (!(rel in saves)) fs.rmSync(path.join(BRIDGE, rel));
    for (const [rel, bytes] of Object.entries(saves)) {
      fs.mkdirSync(path.dirname(path.join(BRIDGE, rel)), { recursive: true });
      fs.writeFileSync(path.join(BRIDGE, rel), bytes);
    }

    // The P6 corpora: the same exact-set replacement.
    const props = propsFilesAtPin(src);
    for (const rel of propsFilesOnDisk()) if (!(rel in props)) fs.rmSync(path.join(BRIDGE, rel));
    for (const [rel, bytes] of Object.entries(props)) {
      fs.mkdirSync(path.dirname(path.join(BRIDGE, rel)), { recursive: true });
      fs.writeFileSync(path.join(BRIDGE, rel), bytes);
    }

    // The P8 corpora: the same exact-set replacement.
    const title = titleFilesAtPin(src);
    for (const rel of titleFilesOnDisk()) if (!(rel in title)) fs.rmSync(path.join(BRIDGE, rel));
    for (const [rel, bytes] of Object.entries(title)) {
      fs.mkdirSync(path.dirname(path.join(BRIDGE, rel)), { recursive: true });
      fs.writeFileSync(path.join(BRIDGE, rel), bytes);
    }

    // The camera corpus: the same exact-set replacement (only the listed files).
    const camera = cameraFilesAtPin(src);
    for (const rel of cameraFilesOnDisk()) if (!(rel in camera)) fs.rmSync(path.join(BRIDGE, rel));
    for (const [rel, bytes] of Object.entries(camera)) {
      fs.mkdirSync(path.dirname(path.join(BRIDGE, rel)), { recursive: true });
      fs.writeFileSync(path.join(BRIDGE, rel), bytes);
    }

    // The audio corpus: the same exact-set replacement (only the listed files).
    const audio = audioFilesAtPin(src);
    for (const rel of audioFilesOnDisk()) if (!(rel in audio)) fs.rmSync(path.join(BRIDGE, rel));
    for (const [rel, bytes] of Object.entries(audio)) {
      fs.mkdirSync(path.dirname(path.join(BRIDGE, rel)), { recursive: true });
      fs.writeFileSync(path.join(BRIDGE, rel), bytes);
    }

    // The survival corpora: the same exact-set replacement (only the listed files).
    const survival = survivalFilesAtPin(src);
    for (const rel of survivalFilesOnDisk()) if (!(rel in survival)) fs.rmSync(path.join(BRIDGE, rel));
    for (const [rel, bytes] of Object.entries(survival)) {
      fs.mkdirSync(path.dirname(path.join(BRIDGE, rel)), { recursive: true });
      fs.writeFileSync(path.join(BRIDGE, rel), bytes);
    }

    // The traversal corpora: the same exact-set replacement (only the listed files).
    const traversal = traversalFilesAtPin(src);
    for (const rel of traversalFilesOnDisk()) if (!(rel in traversal)) fs.rmSync(path.join(BRIDGE, rel));
    for (const [rel, bytes] of Object.entries(traversal)) {
      fs.mkdirSync(path.dirname(path.join(BRIDGE, rel)), { recursive: true });
      fs.writeFileSync(path.join(BRIDGE, rel), bytes);
    }

    // The headless build corpus: the same exact-set replacement (only the listed file).
    const build = buildFilesAtPin(src);
    for (const rel of buildFilesOnDisk()) if (!(rel in build)) fs.rmSync(path.join(BRIDGE, rel));
    for (const [rel, bytes] of Object.entries(build)) {
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
      packCorpus: PACK_CORPUS_FILE,
      p9aCorpus: P9A_CORPUS_FILES,
      savesCorpus: SAVES_CORPUS_FILES,
      propsCorpus: PROPS_CORPUS_FILES,
      titleCorpus: TITLE_CORPUS_FILES,
      cameraCorpus: CAMERA_CORPUS_FILES,
      audioCorpus: AUDIO_CORPUS_FILES,
      survivalCorpus: SURVIVAL_CORPUS_FILES,
      traversalCorpus: TRAVERSAL_CORPUS_FILES,
      buildCorpus: BUILD_CORPUS_FROM,
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
      ...packFilesOnDisk(),
      ...p9aFilesOnDisk(),
      ...savesFilesOnDisk(),
      ...propsFilesOnDisk(),
      ...titleFilesOnDisk(),
      ...cameraFilesOnDisk(),
      ...audioFilesOnDisk(),
      ...survivalFilesOnDisk(),
      ...traversalFilesOnDisk(),
      ...buildFilesOnDisk(),
      ...ADAPTER_MODULES,
      ...TOOL_INPUTS,
    ]);
    fs.writeFileSync(MANIFEST, `${JSON.stringify(manifest, null, 2)}\n`);
    console.log(`vendor-core-bundle: wrote ${manifest.bundleBytes} bytes from core ${manifest.coreCommit}`);
    console.log(`  core modules (${coreModules.length}): ${coreModules.join(', ')}`);
    console.log(`  npm modules: ${Object.keys(npmModules).length ? JSON.stringify(npmModules) : 'none'}`);
    console.log(`  case files (${Object.keys(cases).length}): ${Object.keys(cases).join(', ')}`);
    console.log(`  layout corpus files (${Object.keys(layout).length}), copied unchanged`);
    console.log(`  pack corpus and catalog files (${Object.keys(packs).length}), copied unchanged`);
    console.log(`  P9a corpus files (${Object.keys(p9a).length}), copied unchanged`);
    console.log(`  save corpus files, slots and tutorial progress (${Object.keys(saves).length}), copied unchanged`);
    console.log(`  P6 props and inventory corpus files (${Object.keys(props).length}), copied unchanged`);
    console.log(`  P8 title-flow and tutorial corpus files (${Object.keys(title).length}), copied unchanged`);
    console.log(`  camera movement corpus files (${Object.keys(camera).length}), copied unchanged`);
    console.log(`  audio ground reading corpus files (${Object.keys(audio).length}), copied unchanged`);
    console.log(`  survival corpus files (${Object.keys(survival).length}), copied unchanged`);
    console.log(`  traversal corpus files (${Object.keys(traversal).length}), copied unchanged`);
    console.log(`  headless build corpus files (${Object.keys(build).length}), copied unchanged`);
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
  if (unbundledIn(manifest.coreModules).length) {
    fail(`VENDORED.json records in the bundle ${unbundledReport(unbundledIn(manifest.coreModules))}`);
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
  const packFiles = packFilesOnDisk();
  if (!packFiles.includes(`vendor/core/${PACK_CORPUS_FILE}`)) {
    fail(`vendor/core/${PACK_CORPUS_FILE} is missing — the packs gate would run nothing`);
  }
  const p9aFiles = p9aFilesOnDisk();
  for (const rel of P9A_CORPUS_FILES) {
    if (!p9aFiles.includes(`vendor/core/${rel}`)) fail(`vendor/core/${rel} is missing — the P9a gate would run nothing`);
  }
  const savesFiles = savesFilesOnDisk();
  for (const rel of SAVES_CORPUS_FILES) {
    if (!savesFiles.includes(`vendor/core/${rel}`)) fail(`vendor/core/${rel} is missing — the save-slots or tutorial progress gate would run nothing`);
  }
  const propsFiles = propsFilesOnDisk();
  for (const rel of PROPS_CORPUS_FILES) {
    if (!propsFiles.includes(`vendor/core/${rel}`)) fail(`vendor/core/${rel} is missing — the props corpus gate would run nothing`);
  }
  const titleFiles = titleFilesOnDisk();
  for (const rel of TITLE_CORPUS_FILES) {
    if (!titleFiles.includes(`vendor/core/${rel}`)) fail(`vendor/core/${rel} is missing — the title and tutorial corpus gate would run nothing`);
  }
  const cameraFiles = cameraFilesOnDisk();
  for (const rel of CAMERA_CORPUS_FILES) {
    if (!cameraFiles.includes(`vendor/core/${rel}`)) fail(`vendor/core/${rel} is missing — the camera movement corpus gate would run nothing`);
  }
  const audioFiles = audioFilesOnDisk();
  for (const rel of AUDIO_CORPUS_FILES) {
    if (!audioFiles.includes(`vendor/core/${rel}`)) fail(`vendor/core/${rel} is missing — the audio ground corpus gate would run nothing`);
  }
  const survivalFiles = survivalFilesOnDisk();
  for (const rel of SURVIVAL_CORPUS_FILES) {
    if (!survivalFiles.includes(`vendor/core/${rel}`)) fail(`vendor/core/${rel} is missing — the survival corpus gate would run nothing`);
  }
  const traversalFiles = traversalFilesOnDisk();
  for (const rel of TRAVERSAL_CORPUS_FILES) {
    if (!traversalFiles.includes(`vendor/core/${rel}`)) fail(`vendor/core/${rel} is missing — the traversal corpus gate would run nothing`);
  }
  const buildFiles = buildFilesOnDisk();
  for (const rel of BUILD_CORPUS_FILES) {
    if (!buildFiles.includes(`vendor/core/${rel}`)) fail(`vendor/core/${rel} is missing — the build corpus gate would run nothing`);
  }
  // conformance/ui/ is shared by the P9a, P6 and P8 sets: a file belongs to exactly one.
  const claimedTwice = propsFiles.filter((rel) => p9aFiles.includes(rel));
  if (claimedTwice.length) fail(`${claimedTwice.join(', ')} is listed as both a P9a and a P6 corpus file`);
  const titleClaimedTwice = titleFiles.filter((rel) => p9aFiles.includes(rel) || propsFiles.includes(rel));
  if (titleClaimedTwice.length) fail(`${titleClaimedTwice.join(', ')} is listed as a P8 corpus file and in another set`);
  const expectedList = [
    ...GENERATED_FIXED,
    ...caseFiles,
    ...layoutFiles,
    ...packFiles,
    ...p9aFiles,
    ...savesFiles,
    ...propsFiles,
    ...titleFiles,
    ...cameraFiles,
    ...audioFiles,
    ...survivalFiles,
    ...traversalFiles,
    ...buildFiles,
    ...ADAPTER_MODULES,
    ...TOOL_INPUTS,
  ];
  // Every file under vendor/core/ is claimed by one set above (PL.native-camera-movement):
  // a copied corpus no set lists would ship with no hash, so drift in it would pass
  // unseen (a set dropped from this tool, its file left behind on disk).
  // VENDORED.json is the record itself; a dotfile (a desktop's .DS_Store) is not a corpus.
  const unclaimed = filesUnder(OUT_DIR)
    .filter((rel) => rel !== 'VENDORED.json' && !rel.split('/').some((seg) => seg.startsWith('.')))
    .map((rel) => `vendor/core/${rel}`)
    .filter((rel) => !expectedList.includes(rel));
  if (unclaimed.length) {
    fail(`${unclaimed.join(', ')} is under vendor/core/ but in no copied set — nothing hashes it; list it in a set or remove it`);
  }
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
            : rel.startsWith('vendor/core/conformance/') || rel.startsWith('vendor/core/packs/')
              ? '  This file is core\'s, COPIED at the pin — never edit it here; change it in core, re-pin, re-vendor.'
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
      `${packFiles.length} pack corpus/catalog file(s), ${p9aFiles.length} P9a corpus file(s), ` +
      `${savesFiles.length} saves (slots, tutorial progress), ${propsFiles.length} P6 props/inventory, ${titleFiles.length} P8 title/tutorial, ` +
      `${cameraFiles.length} camera movement, ${audioFiles.length} audio ground, ${survivalFiles.length} survival, ` +
      `${traversalFiles.length} traversal and ${buildFiles.length} headless build corpus file(s), ` +
      `core ${manifest.coreCommit}, ` +
      `esbuild ${manifest.esbuild})`,
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
      const packs = packFilesAtPin(src);
      const wantPacks = Object.keys(packs).sort();
      if (JSON.stringify(wantPacks) !== JSON.stringify(packFiles)) {
        fail(`DRIFT: core ${pin.coreCommit}'s pack corpus and catalog are ${wantPacks.join(', ')} but vendor/core/ holds ${packFiles.join(', ')}`);
      }
      for (const rel of wantPacks) {
        if (!fs.readFileSync(path.join(BRIDGE, rel)).equals(packs[rel])) {
          fail(`DRIFT: corebridge/${rel} is not byte-identical to core ${pin.coreCommit}'s ${rel.slice('vendor/core/'.length)}`);
        }
      }
      const p9a = p9aFilesAtPin(src);
      const wantP9a = Object.keys(p9a).sort();
      if (JSON.stringify(wantP9a) !== JSON.stringify(p9aFiles)) {
        fail(`DRIFT: core ${pin.coreCommit}'s P9a corpora are ${wantP9a.join(', ')} but vendor/core/ holds ${p9aFiles.join(', ')}`);
      }
      for (const rel of wantP9a) {
        if (!fs.readFileSync(path.join(BRIDGE, rel)).equals(p9a[rel])) {
          fail(`DRIFT: corebridge/${rel} is not byte-identical to core ${pin.coreCommit}'s ${rel.slice('vendor/core/'.length)}`);
        }
      }
      const saves = savesFilesAtPin(src);
      const wantSaves = Object.keys(saves).sort();
      if (JSON.stringify(wantSaves) !== JSON.stringify(savesFiles)) {
        fail(`DRIFT: core ${pin.coreCommit}'s save corpora are ${wantSaves.join(', ')} but vendor/core/ holds ${savesFiles.join(', ')}`);
      }
      for (const rel of wantSaves) {
        if (!fs.readFileSync(path.join(BRIDGE, rel)).equals(saves[rel])) {
          fail(`DRIFT: corebridge/${rel} is not byte-identical to core ${pin.coreCommit}'s ${rel.slice('vendor/core/'.length)}`);
        }
      }
      const props = propsFilesAtPin(src);
      const wantProps = Object.keys(props).sort();
      if (JSON.stringify(wantProps) !== JSON.stringify(propsFiles)) {
        fail(`DRIFT: core ${pin.coreCommit}'s P6 corpora are ${wantProps.join(', ')} but vendor/core/ holds ${propsFiles.join(', ')}`);
      }
      for (const rel of wantProps) {
        if (!fs.readFileSync(path.join(BRIDGE, rel)).equals(props[rel])) {
          fail(`DRIFT: corebridge/${rel} is not byte-identical to core ${pin.coreCommit}'s ${rel.slice('vendor/core/'.length)}`);
        }
      }
      const title = titleFilesAtPin(src);
      const wantTitle = Object.keys(title).sort();
      if (JSON.stringify(wantTitle) !== JSON.stringify(titleFiles)) {
        fail(`DRIFT: core ${pin.coreCommit}'s P8 corpora are ${wantTitle.join(', ')} but vendor/core/ holds ${titleFiles.join(', ')}`);
      }
      for (const rel of wantTitle) {
        if (!fs.readFileSync(path.join(BRIDGE, rel)).equals(title[rel])) {
          fail(`DRIFT: corebridge/${rel} is not byte-identical to core ${pin.coreCommit}'s ${rel.slice('vendor/core/'.length)}`);
        }
      }
      const camera = cameraFilesAtPin(src);
      const wantCamera = Object.keys(camera).sort();
      if (JSON.stringify(wantCamera) !== JSON.stringify(cameraFiles)) {
        fail(`DRIFT: core ${pin.coreCommit}'s camera movement corpus is ${wantCamera.join(', ')} but vendor/core/ holds ${cameraFiles.join(', ')}`);
      }
      for (const rel of wantCamera) {
        if (!fs.readFileSync(path.join(BRIDGE, rel)).equals(camera[rel])) {
          fail(`DRIFT: corebridge/${rel} is not byte-identical to core ${pin.coreCommit}'s ${rel.slice('vendor/core/'.length)}`);
        }
      }
      const audio = audioFilesAtPin(src);
      const wantAudio = Object.keys(audio).sort();
      if (JSON.stringify(wantAudio) !== JSON.stringify(audioFiles)) {
        fail(`DRIFT: core ${pin.coreCommit}'s audio ground corpus is ${wantAudio.join(', ')} but vendor/core/ holds ${audioFiles.join(', ')}`);
      }
      for (const rel of wantAudio) {
        if (!fs.readFileSync(path.join(BRIDGE, rel)).equals(audio[rel])) {
          fail(`DRIFT: corebridge/${rel} is not byte-identical to core ${pin.coreCommit}'s ${rel.slice('vendor/core/'.length)}`);
        }
      }
      const survival = survivalFilesAtPin(src);
      const wantSurvival = Object.keys(survival).sort();
      if (JSON.stringify(wantSurvival) !== JSON.stringify(survivalFiles)) {
        fail(`DRIFT: core ${pin.coreCommit}'s survival corpora are ${wantSurvival.join(', ')} but vendor/core/ holds ${survivalFiles.join(', ')}`);
      }
      for (const rel of wantSurvival) {
        if (!fs.readFileSync(path.join(BRIDGE, rel)).equals(survival[rel])) {
          fail(`DRIFT: corebridge/${rel} is not byte-identical to core ${pin.coreCommit}'s ${rel.slice('vendor/core/'.length)}`);
        }
      }
      const traversal = traversalFilesAtPin(src);
      const wantTraversal = Object.keys(traversal).sort();
      if (JSON.stringify(wantTraversal) !== JSON.stringify(traversalFiles)) {
        fail(`DRIFT: core ${pin.coreCommit}'s traversal corpora are ${wantTraversal.join(', ')} but vendor/core/ holds ${traversalFiles.join(', ')}`);
      }
      for (const rel of wantTraversal) {
        if (!fs.readFileSync(path.join(BRIDGE, rel)).equals(traversal[rel])) {
          fail(`DRIFT: corebridge/${rel} is not byte-identical to core ${pin.coreCommit}'s ${rel.slice('vendor/core/'.length)}`);
        }
      }
      const build = buildFilesAtPin(src);
      const wantBuild = Object.keys(build).sort();
      if (JSON.stringify(wantBuild) !== JSON.stringify(buildFiles)) {
        fail(`DRIFT: core ${pin.coreCommit}'s headless build corpus is ${wantBuild.join(', ')} but vendor/core/ holds ${buildFiles.join(', ')}`);
      }
      for (const rel of wantBuild) {
        if (!fs.readFileSync(path.join(BRIDGE, rel)).equals(build[rel])) {
          fail(`DRIFT: corebridge/${rel} is not byte-identical to core ${pin.coreCommit}'s ${BUILD_CORPUS_FROM[rel.slice('vendor/core/'.length)]}`);
        }
      }
      console.log(
        `vendor-core-bundle: re-bundling and re-deriving at the pin reproduces the bundle, all ${names.length} case file(s), ` +
          `all ${want.length} layout corpus file(s), all ${wantPacks.length} pack corpus/catalog file(s), all ` +
          `${wantP9a.length} P9a corpus file(s), all ${wantSaves.length} save (slots, tutorial progress) corpus file(s), all ` +
          `${wantProps.length} P6 props/inventory corpus file(s), all ${wantTitle.length} P8 title/tutorial ` +
          `corpus file(s), all ${wantCamera.length} camera movement corpus file(s), all ${wantAudio.length} audio ground ` +
          `corpus file(s), all ${wantSurvival.length} survival corpus file(s), all ${wantTraversal.length} traversal ` +
          `corpus file(s) and all ${wantBuild.length} headless build corpus file(s) byte for byte`,
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
