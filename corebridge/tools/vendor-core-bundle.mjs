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
//   node corebridge/tools/vendor-core-bundle.mjs --check-genre-transcription-negative
//       The genre systems transcription guard's negative control (PL.native-genre-rows):
//       perturbs the vendored cases/core-genre-{puzzle,platformer,strategy,genre-pieces}-*.json in memory (a
//       dropped case, a case no corpus case names, a run's answer dropped, a read's first
//       call changed, a riddle's choices dropped, an answer key expected nowhere, an unlock
//       outcome weakened to a subset, a restored run's states expected nowhere, a KB run put
//       on both legs; a platformer step call dropped, a step's movement weakened, its probed
//       links changed, its outcome weakened to a subset, its host orders stated non-empty,
//       two runs' stars swapped, a course
//       case put on the C leg only, a restored platformer run put on both legs; a strategy
//       run's endTurn call dropped, a turn report's orders stated empty, a turn report weakened
//       to a subset, a victory answer flipped, a stockpile and a controls answer stated under
//       another key, two
//       businesses' prices swapped, a controlled call asked for another faction, a campaign
//       case put on the C leg only, a restored strategy run put on both legs; and over
//       cases/core-genre-genre-pieces-{kinds,build-plan}.json a key call asked without its
//       variant, a binding walk weakened to a subset, a pieces case put on the C leg only, a
//       build-plan fixture named at another path, a write's ground call dropped, a settle
//       offset stated under another key, a written world's ground stated empty) and requires
//       the guard to name each one.
//
//   node corebridge/tools/vendor-core-bundle.mjs --check-language-transcription-negative
//       The language transcription guard's negative control: perturbs the vendored
//       cases/core-language-*.json in memory (a dropped case, a dropped call, a first
//       call changed, an answer expected nowhere, a call that is no language row, an
//       answer weakened to a subset, a mode at one band dropped; slice 3: an
//       identification answer dropped, an examine weakened, a collection run's first call
//       changed, a collection's collected words expected nowhere, a listening chat dropped,
//       a listening chat's quests not expected, a composition's submit weakened; slice 4: a
//       quest feedback run's locks dropped, a lifecycle sync's pronunciation expected nowhere,
//       a run's recent ids not expected, a quest type table's categories not expected, a
//       template's parameters not expected, a world's quest types weakened) and fails unless
//       the guard names each (the core_vendor_language_negative ctest).
//
//   node corebridge/tools/vendor-core-bundle.mjs --check-extension-keys <case dir>
//       Only the save.rules extensionKeys check (below, SAVE_RULES_CASES_DIR) over
//       <case dir> instead of corebridge/tests/cases/ — the negative control's mode.
//
// WHAT --check (no --core) ACTUALLY VERIFIES: a sha256 per file over the
// generated artifacts AND the inputs bundled into them (the adapter JS, the case
// emitter), that VENDORED.json records the pinned commit and esbuild, and that
// every save.rules case states exactly the extension keys the bundle's registry
// answers (PL.native-save-extension-keys). It cannot see core changing underneath the bundle — only --core can, because that
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
// and `ui.onboarding.*` rows by tests/title_corpus.cpp, and the village-state
// corpus (PL.native-village-save-rows; core's P1.core and
// PL.core-save-conversations-projection), driven through the `save.village.*`
// rows by tests/village_save_corpus.cpp and transcribed by emit-bridge-cases.mjs
// into cases/core-saves-village.json. Only these files of `conformance/saves/`:
// the rest of that directory is the save-file corpora emit-bridge-cases.mjs
// transcribes.
const SAVES_CORPUS_FILES = [
  'conformance/saves/slots.json',
  'conformance/saves/tutorial-progress.json',
  'conformance/saves/village-state.json',
];

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

// core's P9i progression corpora and its skill-tree corpora (PL.native-progression-rows,
// U106(7); core's P9i.core and its skills program), copied verbatim the same way and
// driven through the `progression.*` and `skill.*` rows by tests/progression_corpus.cpp:
// the tracker, the feature modules, the domain trees and the save block
// (conformance/progression/), advancement, unlocks, effects, the drawn tree and the
// effect terms (conformance/skills/), and the skill pack's KB corpus
// (conformance/prolog/mechanic-skill.json), whose `can_unlock/2` cases a KB-backed
// `skill.unlock` replays. The three folders are this set's alone, so a file an earlier
// pin left there is seen, hashed and removed by the next write.
const PROGRESSION_CORPUS_FILES = [
  'conformance/progression/gamification.json',
  'conformance/progression/modules.json',
  'conformance/progression/save.json',
  'conformance/progression/skills.json',
  'conformance/prolog/mechanic-skill.json',
  'conformance/skills/advancement.json',
  'conformance/skills/effect-terms.json',
  'conformance/skills/effects.json',
  'conformance/skills/trees.json',
  'conformance/skills/unlocks.json',
];

// core's P9h language corpora that the language.* rows answer (PL.native-language-rows,
// U128, U118; core's P9h.core), copied verbatim the same way and driven through the rows
// by tests/language_corpus.cpp, each op composed as core's reference runner
// (src/language-learning/systems-corpus.ts) composes it; emit-bridge-cases.mjs also
// transcribes each into cases/core-language-<file>.json. Slice 1 copies five of the
// directory's thirteen: the book (progress), the save block (save), the prompt selector
// (prompts), hover (hover) and the chat metrics (chat); slice 2 three more: the bank and
// the learning profile (bank), the difficulty monitor and the CEFR adaptation
// (adaptation), and listen and repeat (pronunciation); slice 3 three more: knowledge
// collection (collection), object identification, point and name and examine (objects),
// and composition and listening (writing); slice 4, the last, two more: real-time quest
// language feedback (quest-feedback) and the language quest types and templates
// (quest-types). chat-strip.json joins with PL.native-chat-cefr-rows (U133), and core's
// genre quest types (conformance/quest-types/) with PL.native-genre-rows. conformance/language/
// is this set's alone, so a file an earlier pin left there is seen, hashed and removed.
const LANGUAGE_CORPUS_FILES = [
  'conformance/language/adaptation.json',
  'conformance/language/bank.json',
  'conformance/language/chat.json',
  'conformance/language/collection.json',
  'conformance/language/hover.json',
  'conformance/language/objects.json',
  'conformance/language/progress.json',
  'conformance/language/prompts.json',
  'conformance/language/pronunciation.json',
  'conformance/language/quest-feedback.json',
  'conformance/language/quest-types.json',
  'conformance/language/save.json',
  'conformance/language/writing.json',
];

// core's P9j genre systems corpora that the genre.*, puzzle.*, platformer.*, strategy.* and genrePieces.* rows answer
// (PL.native-genre-rows, U128, U115; core's P9j.core), copied verbatim the same way and
// driven through the rows by tests/genre_systems_corpus.cpp, each op composed as core's
// reference runner (src/genre-systems/systems-corpus.ts, runGenreSystemsOp) composes it;
// emit-bridge-cases.mjs also transcribes each into cases/core-genre-<area>-<file>.json.
// The committed world slice (conformance/genre-mechanics/thistlecombe.world-slice.json) is
// the corpora's `"thistlecombe"` world, which the runner hands core's `worldOf` as its
// slices. Slice 1 copies the puzzle's three files (definition, run, save), slice 2 the
// platformer's (course, run, save), slice 3 the strategy game's (campaign, run, save) and slice 4
// the genre pieces' (conformance/genre-pieces/{kinds,build-plan}.json, the rows' last). conformance/prolog/
// mechanic-{puzzle,platformer,strategy}.json stay with PL.native-prolog-mirror-full (U120(9)). Each
// directory is this set's alone, so a file an earlier pin left there is seen, hashed and removed.
const GENRE_SYSTEMS_CORPUS_FILES = [
  'conformance/genre-mechanics/thistlecombe.world-slice.json',
  'conformance/genre-pieces/build-plan.json',
  'conformance/genre-pieces/kinds.json',
  'conformance/platformer/course.json',
  'conformance/platformer/run.json',
  'conformance/platformer/save.json',
  'conformance/puzzle/definition.json',
  'conformance/puzzle/run.json',
  'conformance/puzzle/save.json',
  'conformance/strategy/campaign.json',
  'conformance/strategy/run.json',
  'conformance/strategy/save.json',
];

// core's villager pass-by corpus (PL.native-pass-by-rows, U128, U118; core's PL.pass-by-core
// and PL.core-p9-corpus-gaps), copied verbatim the same way and driven through the passBy.*
// rows by tests/villagers_pass_by_corpus.cpp, each op called as core's reference runner
// (src/pass-by/pass-by-corpus.ts, runPassByOp) calls core; emit-bridge-cases.mjs also
// transcribes it into cases/core-villagers-pass-by.json. `conformance/villagers/` is this
// set's alone, so a file an earlier pin left there is seen, hashed and removed.
const PASS_BY_CORPUS_FILES = ['conformance/villagers/pass-by.json'];

// Core modules the bundle must NOT carry (PL.native-interact-target, U94(2)/(3)): core's
// village-state comparator. No row needs it; it came in only through a corpus RUNNER
// module's comparator import (the P8 rows once imported `quests/tutorial-corpus` and
// `ui/title-flow-corpus`, ~29 KB of save code), which is why the rows import core's
// `*-corpus-host` modules instead. A write that would record one refuses, and `--check`
// (the core_vendor ctest) fails on a VENDORED.json that records one, naming it: the
// import to repoint is the one that reaches it. The save-file game state behind the
// comparator (`src/save-file-game-state.ts`) was on this list until
// PL.native-village-save-rows: the save.village.* rows import it, so it is bundled on
// purpose now, and only the runner (`save-file-game-state-corpus`) stays out.
//
// Core's movement prose (PL.native-ground-row, U97(1)/(3); core's PL.movement-prose-split):
// `camera/movement-prose` holds the frozen prose tables CAMERA_OCCLUSION_RULES and
// MOVEMENT_FRAME_MEANING, which no row reads (~3 KB of bundle). Core keeps it out of
// `camera/movement-rules`, the module the camera.movement.* rows import; importing
// `camera/movement-contract` (which re-exports both) would bring it back, and nothing
// in core can see native do that (its pl-movement-prose-split m1 and m4). Refused the
// same way, with its own remedy.
const UNBUNDLED_CORE_MODULES = ['src/save-file-game-state-corpus.ts', 'src/camera/movement-prose.ts'];
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

// The save extension keys (PL.native-save-extension-keys, U110). `save.rules` answers
// `extensionKeys` as core's `extensionRegistry` keys, sorted (js/entry.js), so the list
// moves whenever a core pin adds a registered extension — P9j.core's puzzle, platformer
// and strategy took it from 19 to 22, and an engine's own copy of the registry fell
// behind unseen. The hand cases state the list EXACTLY: every `save.rules` step under
// corebridge/tests/cases/ that names `extensionKeys` (directly or inside `$subset`) must
// give the literal sorted array, and that array must be what the vendored bundle's
// registry answers. So a pin bump that changes the registry turns `core_vendor` red until
// the cases are updated on purpose, and loosening a case to `{"$type": "array"}` is red
// too. With --core the bundle's keys are also held to the top-level keys of
// `extensionRegistry` in core's src/save-extensions.ts at the pin.
const SAVE_RULES_CASES_DIR = path.join(BRIDGE, 'tests', 'cases');

/** The vendored bundle's `save.rules` extensionKeys, evaluated in a Node vm. */
async function bundleExtensionKeys(js) {
  const vm = await import('node:vm');
  const noProlog = () => {
    throw new Error('vendor-core-bundle has no Prolog engine');
  };
  const context = vm.createContext({
    __insimul_sha256_hex: (text) => createHash('sha256').update(String(text), 'utf8').digest('hex'),
    __insimul_prolog_create: noProlog,
    __insimul_prolog_consult: noProlog,
    __insimul_prolog_query: noProlog,
    __insimul_prolog_destroy: noProlog,
  });
  new vm.Script(js, { filename: 'insimul-core-bundle.js' }).runInContext(context);
  const dispatch = context.__insimul_core_dispatch;
  if (typeof dispatch !== 'function') fail('the vendored bundle did not install __insimul_core_dispatch');
  const rules = await dispatch('save.rules', '{}');
  const keys = rules?.extensionKeys;
  if (!Array.isArray(keys) || keys.length === 0 || !keys.every((k) => typeof k === 'string')) {
    fail(`the vendored bundle's save.rules answers extensionKeys ${JSON.stringify(keys)}, not a non-empty list of names`);
  }
  // A plain array copied out of the vm's realm, so JSON comparisons below read the same.
  return JSON.parse(JSON.stringify(keys));
}

/** Every `save.rules` step under `dir` that names extensionKeys: { where, stated }. */
function statedExtensionKeyLists(dir) {
  if (!fs.existsSync(dir)) fail(`case directory missing: ${dir}`);
  const out = [];
  for (const name of fs.readdirSync(dir).filter((f) => f.endsWith('.json')).sort()) {
    const doc = JSON.parse(fs.readFileSync(path.join(dir, name), 'utf8'));
    for (const [ci, kase] of (doc.cases ?? []).entries()) {
      for (const [si, step] of (kase.steps ?? []).entries()) {
        if (step?.call !== 'save.rules' || step.expect === null || typeof step.expect !== 'object') continue;
        const holder = step.expect.$subset && typeof step.expect.$subset === 'object' ? step.expect.$subset : step.expect;
        if (!Object.prototype.hasOwnProperty.call(holder, 'extensionKeys')) continue;
        out.push({ where: `${name} case ${ci + 1} ("${kase.name ?? ''}") step ${si + 1}`, stated: holder.extensionKeys });
      }
    }
  }
  return out;
}

/** Problems with the stated lists against the bundle's keys (empty = they agree). */
// A refused Load (PL.native-bundle-core-r2; core's PL.core-load-refusal-codes, U124(1),
// U126(2)): core's conformance/ui/save-slot-cases.json states its `load_refusals`, and the
// emitter transcribes each into cases/core-ui-save-slots.json as a case whose steps call
// `ui.loadRefusal`. A self-consistent re-vendor with that transcription dropped would leave
// every other check green, so --check holds the derived file to carry them (and, with
// --core, exactly as many as core states at the pin).
const LOAD_REFUSAL_CASES = path.join(CASES_DIR, 'core-ui-save-slots.json');
// The village-state transcription (PL.native-village-save-rows): cases/core-saves-village.json
// must carry one case per case of the vendored conformance/saves/village-state.json, by name
// (`village-state <op>: <name>`), plus its contract case. A self-consistent re-vendor with an
// emitter that dropped cases would otherwise pass `--check --core`; the vendored corpus is
// hashed and byte-compared with core, so holding the transcription to it holds it to core.
const VILLAGE_CASES = path.join(CASES_DIR, 'core-saves-village.json');
/** The first row each village-state op calls (save-file-game-state-corpus.ts's runVillageStateOp, through the rows). */
const VILLAGE_FIRST_CALL = {
  write: 'save.village.write',
  read: 'save.village.read',
  roundTrip: 'save.village.write',
  stamp: 'save.village.runtimeOf',
  agentCurie: 'save.village.agentCurie',
  timeStateOf: 'save.village.timeStateOf',
  totalHoursOf: 'save.village.totalHoursOf',
  conversationTimestamp: 'save.village.conversations.timestamp',
  conversationEpochMs: 'save.village.conversations.epochMs',
  skillKb: 'save.village.read',
};
const VILLAGE_CORPUS = path.join(OUT_DIR, 'conformance/saves/village-state.json');
function villageTranscriptionProblems() {
  const corpus = JSON.parse(fs.readFileSync(VILLAGE_CORPUS, 'utf8')).cases;
  const transcribed = JSON.parse(fs.readFileSync(VILLAGE_CASES, 'utf8')).cases;
  const byName = new Map(transcribed.map((c) => [c.name, c]));
  const names = new Set(byName.keys());
  const missing = corpus.filter((c) => !names.has(`village-state ${c.op}: ${c.name}`)).map((c) => c.name);
  // Each case's calls are the ones core's runner makes for its op, in its order: the first
  // always, and for skillKb the checked read before skill.kb.loadJson.
  const wrongCalls = corpus.filter((c) => {
    const calls = (byName.get(`village-state ${c.op}: ${c.name}`)?.steps ?? []).map((st) => st.call);
    if (calls.length === 0) return false;
    if (calls[0] !== VILLAGE_FIRST_CALL[c.op]) return true;
    return c.op === 'skillKb' && c.expected?.ok !== false && calls.join(' ') !== 'save.village.read skill.kb.loadJson';
  }).map((c) => c.name);
  const want = corpus.length + 1;
  const problems = [];
  if (missing.length) problems.push(`${missing.length} corpus case(s) not transcribed, first: ${missing[0]}`);
  if (wrongCalls.length) problems.push(`${wrongCalls.length} case(s) not transcribed as core's runner calls their op, first: ${wrongCalls[0]}`);
  if (names.size !== want) problems.push(`it carries ${names.size} case(s), not the corpus's ${corpus.length} and the contract case`);
  return { problems, count: corpus.length };
}

// The pass-by transcription (PL.native-pass-by-rows): cases/core-villagers-pass-by.json must
// carry one case per case of the vendored conformance/villagers/pass-by.json, by name
// (`pass-by <op>: <name>`), each ONE call of the row core's runner's op calls
// (src/pass-by/pass-by-corpus.ts, runPassByOp: floor -> passByGuardFloor, guard ->
// keepClearOfPlayer, plan -> planStepAside, round -> planRoundPlayer, replay -> replayPassBy)
// with the case's whole input as its args and the case's whole answer as its expectation
// (no matcher operator anywhere), and the contract case holding passBy.contract's constants,
// side frames and measured window to the corpus's contract. A self-consistent re-vendor with an
// emitter that dropped, renamed or weakened a case would otherwise pass `--check --core`.
const PASS_BY_CASES = 'core-villagers-pass-by.json';
const PASS_BY_ROW = {
  floor: 'passBy.guardFloor',
  guard: 'passBy.keepClear',
  plan: 'passBy.planStepAside',
  round: 'passBy.planRound',
  replay: 'passBy.replay',
};
const PASS_BY_CONTRACT_CASE = 'pass-by: the contract the passBy.contract row states';
function passByTranscriptionProblems(doc = JSON.parse(fs.readFileSync(path.join(CASES_DIR, PASS_BY_CASES), 'utf8'))) {
  const file = JSON.parse(fs.readFileSync(path.join(OUT_DIR, 'conformance/villagers/pass-by.json'), 'utf8'));
  const byName = new Map(doc.cases.map((c) => [c.name, c]));
  const missing = [];
  const wrong = [];
  for (const c of file.cases) {
    const t = byName.get(`pass-by ${c.op}: ${c.name}`);
    if (!t) {
      missing.push(c.name);
      continue;
    }
    const steps = t.steps ?? [];
    const ok =
      steps.length === 1 &&
      t.legs === undefined &&
      steps[0].call === PASS_BY_ROW[c.op] &&
      canonJson(steps[0].args) === canonJson(c.input) &&
      canonJson(steps[0].expect) === canonJson(c.expected) &&
      Object.keys(steps[0]).sort().join(',') === 'args,call,expect';
    if (!ok) wrong.push(c.name);
  }
  const problems = [];
  if (missing.length) problems.push(`${missing.length} corpus case(s) not transcribed, first: ${missing[0]}`);
  if (wrong.length) problems.push(`${wrong.length} case(s) not transcribed as core's runner calls and answers their op, first: ${wrong[0]}`);
  const contract = byName.get(PASS_BY_CONTRACT_CASE)?.steps ?? [];
  const want = {
    constants: Object.fromEntries(Object.entries(file.contract.constants).map(([k, v]) => [k, v.value])),
    names: { $type: 'object' },
    measuredAbreastS: file.contract.measuredAbreastS,
    sideFrames: file.contract.sideFrames,
  };
  if (contract.length !== 1 || contract[0].call !== 'passBy.contract' || canonJson(contract[0].expect) !== canonJson(want)) {
    problems.push("the contract case does not hold passBy.contract to the corpus's constants, side frames and measured window");
  }
  if (byName.size !== file.cases.length + 1 || doc.cases.length !== byName.size) {
    problems.push(`it carries ${doc.cases.length} case(s), not the corpus's ${file.cases.length} and the contract case`);
  }
  return { problems, count: file.cases.length };
}

/** The pass-by guard's negative control: each perturbation of the transcription must be named. */
function passByTranscriptionNegative() {
  const read = () => JSON.parse(fs.readFileSync(path.join(CASES_DIR, PASS_BY_CASES), 'utf8'));
  const first = (d, op) => d.cases.find((c) => c.name.startsWith(`pass-by ${op}: `));
  const perturbations = [
    ['a dropped case', (d) => d.cases.splice(5, 1), 'corpus case(s) not transcribed'],
    ['a case no corpus case names', (d) => d.cases.push({ ...first(d, 'floor'), name: 'pass-by floor: invented' }), 'case(s), not the corpus'],
    ['a call changed (a plan answered by the guard row)', (d) => { first(d, 'plan').steps[0].call = 'passBy.keepClear'; }, "not transcribed as core's runner"],
    ["an argument dropped (a guard's side)", (d) => {
      delete d.cases.find((c) => c.steps[0].call === 'passBy.keepClear' && 'side' in c.steps[0].args).steps[0].args.side;
    }, "not transcribed as core's runner"],
    ['an answer weakened to a subset (a replay without its tracks)', (d) => {
      const st = first(d, 'replay').steps[0];
      st.expect = { $subset: { frames: st.expect.frames, villagers: st.expect.villagers } };
    }, "not transcribed as core's runner"],
    ['an answer number changed (a round point)', (d) => { first(d, 'round').steps[0].expect.way[0].x += 1e-3; }, "not transcribed as core's runner"],
    ['a refusal reason changed', (d) => {
      d.cases.find((c) => c.steps[0].expect.stepAside === false).steps[0].expect.reason = 'no-room-at-all';
    }, "not transcribed as core's runner"],
    ['a case put on one leg only', (d) => { Object.assign(first(d, 'guard'), { legs: ['c'], why: 'perturbed' }); }, "not transcribed as core's runner"],
    ['a contract constant dropped', (d) => { delete d.cases.find((c) => c.name === PASS_BY_CONTRACT_CASE).steps[0].expect.constants.waitS; }, 'the contract case'],
    ['the side frames weakened', (d) => { d.cases.find((c) => c.name === PASS_BY_CONTRACT_CASE).steps[0].expect.sideFrames = { $type: 'object' }; }, 'the contract case'],
  ];
  let named = 0;
  for (const [what, perturb, want] of perturbations) {
    const doc = read();
    perturb(doc);
    const { problems } = passByTranscriptionProblems(doc);
    const hit = problems.find((p) => p.includes(want));
    console.log(`  ${hit ? 'named' : 'MISSED'}: ${what} -> ${(hit ?? problems.join('; ')) || 'no problem'}`);
    if (hit) named++;
  }
  console.log(`vendor-core-bundle: pass-by transcription negative — ${named} of ${perturbations.length} perturbed transcription(s) named`);
  if (named !== perturbations.length) fail('the pass-by transcription guard missed a perturbation');
}

// The language transcriptions (PL.native-language-rows): each vendored
// conformance/language/<file>.json has cases/core-language-<file>.json, holding one case
// per corpus case by name (`language/<file> <op>: <name>`), whose first call is the one
// core's runner makes first for that op (systems-corpus.ts, through the rows) and whose
// every call is a language.* row (or examine's pick, props.interactables.examinePick, which
// the prompts runner's `examinePick` is), and whose calls are, row for row and count for
// count, the ones core's runner makes for that case (languageCallsOf). A self-consistent
// re-vendor with an emitter that dropped or mis-transcribed cases would otherwise pass
// `--check --core`.
const LANGUAGE_FIRST_CALL = {
  progress: { mastery: 'language.book.mastery', gain: 'language.book.fluencyGain', run: 'language.book.empty', facts: 'language.facts.cefr' },
  save: { block: (c) => (Array.isArray(c.input.encounters) ? 'language.book.empty' : 'language.save.block'), read: 'language.save.read', restore: 'language.save.read' },
  prompts: { run: 'language.contract' },
  hover: { tokens: 'language.hover.tokenize', run: 'language.hover.initial' },
  chat: { words: 'language.book.empty', percent: 'language.chat.targetPercent', hear: 'language.chat.start', usages: 'language.book.empty', run: 'language.book.empty' },
  bank: {
    cards: 'language.book.empty', reveal: 'language.bank.revealsMeaning', grammar: 'language.book.empty', tables: 'language.contract',
    profile: 'language.profile.build', history: 'language.profile.history',
  },
  adaptation: {
    struggle: 'language.difficulty.signals', difficulty: 'language.difficulty.initial', mode: 'language.npc.hash', npc: 'language.npc.adaptation',
    hint: 'language.hints.showsVocabHint', quests: 'language.quests.filterByCefr', advance: 'language.cefr.advancement',
  },
  pronunciation: {
    encode: 'language.pronunciation.encode', similarity: 'language.pronunciation.wordSimilarity', score: 'language.pronunciation.normalize',
    repeat: 'language.pronunciation.listenAndRepeat', xp: 'language.pronunciation.xp', hints: 'language.pronunciation.hintPenalty',
  },
  collection: { run: 'language.contract' },
  objects: { normalize: 'language.identification.normalize', identify: 'language.contract', naming: 'language.contract', examine: 'language.objects.examine' },
  writing: {
    composition: 'language.writing.countWords',
    // the state starts as [] and the first step's row takes it
    listening: (c) => ({ register: 'language.listening.register', prompt: 'language.listening.prompt', chat: 'language.listening.chat', grade: 'language.listening.grade' })[c.input.steps[0]?.do],
  },
  // slice 4
  'quest-feedback': { targets: 'language.questFeedback.targets', run: 'language.questFeedback.initial' },
  'quest-types': {
    select: 'language.questTypes.forWorld',
    table: 'language.questTypes.definition',
    complete: 'language.questTypes.objectiveComplete',
    map: 'language.contract',
    // the runner's order: a difficulty when a string, else a category when a string, else every template
    templates: (c) => (typeof c.input.difficulty === 'string'
      ? 'language.questTypes.templatesByDifficulty'
      : typeof c.input.category === 'string' ? 'language.questTypes.templatesByCategory' : 'language.questTypes.templates'),
  },
};
/**
 * The calls core's runner makes for one case (systems-corpus.ts, through the rows), as a
 * multiset { row: count }: every kernel it calls per op and per step. The transcription must
 * make exactly these, so an emitter that drops or doubles a call is red.
 */
function languageCallsOf(base, c) {
  const n = {};
  const add = (row, k = 1) => {
    if (k > 0) n[row] = (n[row] ?? 0) + k;
  };
  const i = c.input;
  const e = c.expected;
  const steps = Array.isArray(i.steps) ? i.steps : [];
  const count = (d) => steps.filter((st) => st.do === d).length;
  if (base === 'progress') {
    if (c.op === 'mastery') add('language.book.mastery', i.pairs.length);
    if (c.op === 'gain') add('language.book.fluencyGain', i.conversations.length);
    if (c.op === 'facts') {
      add('language.facts.cefr');
      add('language.facts.weakDimensions');
    }
    if (c.op === 'run') {
      add('language.book.empty');
      add('language.book.advance', count('advance'));
      add('language.book.encounterOfEvent', count('event'));
      add('language.book.recordEncounter', count('encounter') + steps.filter((st, k) => st.do === 'event' && e[k]?.heard !== false).length);
      add('language.book.recordGrammar', count('grammar'));
      add('language.book.recordConversation', count('conversation'));
      add('language.book.setCefr', count('cefr'));
      add('language.book.weakPatterns', count('weak'));
      add('language.book.findWord', steps.filter((st) => st.do === 'weak' && typeof st.word === 'string').length);
      add('language.book.wordView', steps.filter((st, k) => st.do === 'weak' && typeof st.word === 'string' && e[k]?.word !== null).length);
      add('language.book.summary', count('summary'));
    }
  }
  if (base === 'save') {
    if (c.op === 'block') {
      if (Array.isArray(i.encounters)) {
        add('language.book.empty');
        add('language.book.recordEncounter', i.encounters.length);
        add('language.book.recordGrammar', (i.grammar ?? []).length);
        if (i.cefr) add('language.book.setCefr');
      }
      add('language.save.block');
      add('language.save.blockOf');
    }
    if (c.op === 'read') add('language.save.read');
    if (c.op === 'restore') {
      add('language.save.read');
      if (e.ok !== false) {
        if (i.block === undefined || i.block === null) add('language.save.block');
        add('language.save.blockOf');
        if (e.summary !== null) {
          add('language.book.summary');
          add('language.book.mastery', e.mastery.length);
          add('language.book.weakPatterns');
        }
      }
    }
  }
  if (base === 'prompts') {
    add('language.contract');
    add('language.identification.initial');
    add('language.naming.initial');
    add('language.prompts.initial');
    if (steps.some((st) => st.tags !== undefined || st.do === 'reach' || st.do === 'choose')) add('language.collection.initial');
    add('language.identification.registerTargets', steps.filter((st) => st.do === 'register' && st.targets !== undefined).length);
    add('language.naming.nameableObjects', steps.filter((st) => st.do === 'register' && st.world !== undefined).length);
    add('language.naming.registerNameable', steps.filter((st) => st.do === 'register' && st.world !== undefined).length);
    add('language.collection.registerTags', steps.filter((st) => st.do === 'register' && st.tags !== undefined).length);
    add('props.interactables.examinePick', steps.filter((st) => st.do === 'pick' && st.object === undefined).length);
    add('language.prompts.onPick', count('pick'));
    add('language.prompts.standing', count('standing'));
    add('language.prompts.answer', count('answer'));
    add('language.prompts.quizOnReach', count('reach'));
    add('language.prompts.answerQuiz', count('choose'));
  }
  if (base === 'hover') {
    if (c.op === 'tokens') add('language.hover.tokenize');
    if (c.op === 'run') {
      add('language.hover.initial');
      add('language.hover.addHints', count('hints'));
      add('language.hover.seeWord', count('see'));
      add('language.hover.setMastery', count('mastery'));
      add('language.hover.lookup', count('lookup'));
      add('language.hover.resolve', count('resolve'));
      add('language.hover.isLikelyTarget', steps.filter((st) => st.do === 'likely').reduce((a, st) => a + st.words.length, 0));
      add('language.hover.display', count('display'));
    }
  }
  if (base === 'chat') {
    if (c.op === 'words') {
      add('language.book.empty');
      add('language.chat.lineWords', i.lines.length);
    }
    if (c.op === 'usages') {
      add('language.book.empty');
      add('language.chat.questUsages', i.lines.length);
    }
    if (c.op === 'percent') add('language.chat.targetPercent', i.pairs.length);
    if (c.op === 'hear') {
      add('language.chat.start');
      add('language.chat.hear', i.checks.length);
    }
    if (c.op === 'run') {
      add('language.book.empty');
      add('language.difficulty.initial', 1 + count('start'));
      add('language.chat.start', count('start'));
      add('language.chat.line', count('line'));
      add('language.difficulty.recordTurn', steps.filter((st, k) => st.do === 'line' && e[k]?.ok === true).length);
      add('language.chat.hear', count('hear'));
      add('language.chat.finish', count('end'));
    }
  }
  if (base === 'bank') {
    if (c.op === 'cards') {
      add('language.book.empty');
      add('language.bank.categories');
      add('language.bank.cards');
    }
    // three display modes × three interactions (the runner's own lists)
    if (c.op === 'reveal') add('language.bank.revealsMeaning', 9);
    if (c.op === 'grammar') {
      add('language.book.empty');
      add('language.bank.grammarTab');
      add('language.bank.analyzeWeaknesses');
      add('language.bank.strongPatterns');
    }
    if (c.op === 'tables') add('language.contract');
    if (c.op === 'profile') add('language.profile.build');
    if (c.op === 'history') {
      add('language.profile.history');
      add('language.profile.build');
    }
  }
  if (base === 'adaptation') {
    if (c.op === 'struggle') {
      add('language.difficulty.signals', i.turns.length);
      add('language.difficulty.score', i.turns.length);
    }
    if (c.op === 'difficulty') {
      add('language.difficulty.initial');
      add('language.difficulty.recordTurn', count('turn'));
    }
    if (c.op === 'mode') {
      // the hash once, then the mode at each of the six bands the runner lists
      add('language.npc.hash', i.npcs.length);
      add('language.npc.mode', 6 * i.npcs.length);
    }
    if (c.op === 'npc') add('language.npc.adaptation');
    if (c.op === 'hint') add('language.hints.showsVocabHint', i.checks.length);
    if (c.op === 'quests') add('language.quests.filterByCefr');
    if (c.op === 'advance') add('language.cefr.advancement', i.snapshots.length);
  }
  if (base === 'pronunciation') {
    if (c.op === 'encode') add('language.pronunciation.encode', i.words.length);
    if (c.op === 'similarity') add('language.pronunciation.wordSimilarity', i.pairs.length);
    if (c.op === 'score') {
      add('language.pronunciation.normalize');
      add('language.pronunciation.score');
    }
    if (c.op === 'repeat') add('language.pronunciation.listenAndRepeat');
    if (c.op === 'xp') add('language.pronunciation.xp', i.scores.length);
    if (c.op === 'hints') add('language.pronunciation.hintPenalty', i.revealed.length);
  }
  if (base === 'collection') {
    add('language.contract');
    add('language.collection.initial');
    add('language.collection.registerTags', count('register'));
    add('language.collection.seed', count('seed'));
    add('language.collection.inReach', count('reach'));
    add('language.collection.quiz', count('quiz'));
    add('language.collection.answer', count('answer'));
  }
  if (base === 'objects') {
    if (c.op === 'normalize') {
      // said and expected normalised, their distance, its score
      add('language.identification.normalize', 2 * i.pairs.length);
      add('language.identification.editDistance', i.pairs.length);
      add('language.identification.distanceScore', i.pairs.length);
    }
    if (c.op === 'identify') {
      add('language.contract');
      add('language.identification.initial');
      add('language.identification.registerTargets', count('register'));
      add('language.identification.prompt', count('prompt'));
      add('language.identification.answer', count('answer'));
      add('language.identification.removeQuest', count('remove'));
      add('language.identification.quest', count('quest'));
    }
    if (c.op === 'naming') {
      add('language.contract');
      add('language.naming.initial');
      add('language.naming.nameableObjects', steps.filter((st) => st.do === 'register' && st.world).length);
      add('language.naming.registerNameable', count('register'));
      add('language.naming.point', count('point'));
      add('language.naming.submit', count('name'));
    }
    if (c.op === 'examine') add('language.objects.examine');
  }
  if (base === 'writing') {
    if (c.op === 'composition') {
      add('language.writing.countWords', i.texts.length);
      add('language.writing.view', i.texts.length);
      add('language.writing.submit', i.texts.length);
    }
    if (c.op === 'listening') {
      add('language.listening.register', count('register'));
      add('language.listening.prompt', count('prompt'));
      add('language.listening.chat', count('chat'));
      add('language.listening.grade', count('grade'));
    }
  }
  if (base === 'quest-feedback') {
    if (c.op === 'targets') add('language.questFeedback.targets');
    if (c.op === 'run') {
      add('language.questFeedback.initial');
      add('language.questFeedback.useVocabulary', count('vocabulary'));
      add('language.questFeedback.syncLifecycle', count('lifecycle'));
      add('language.questFeedback.grammar', count('grammar'));
      add('language.questFeedback.correctUsage', count('correct'));
      add('language.questFeedback.pronunciation', count('pronunciation'));
      add('language.questFeedback.hints', count('hints'));
      add('language.questFeedback.grammarObjectiveComplete', count('objective'));
      // questFeedbackDone: once for a vocabulary, grammar or pronunciation step's `done`, three
      // times for a lifecycle step (its words, its passes, its grammar uses), once for done
      add('language.questFeedback.done', count('vocabulary') + 3 * count('lifecycle') + count('grammar') + count('pronunciation') + count('done'));
      add('language.questFeedback.lockedVocabulary', count('vocabulary') + count('lifecycle'));
      add('language.questFeedback.lockedPronunciation', count('lifecycle') + count('pronunciation'));
      add('language.questFeedback.lockedGrammar', count('lifecycle') + count('grammar'));
    }
  }
  if (base === 'quest-types') {
    if (c.op === 'select') add('language.questTypes.forWorld', i.worlds.length);
    // the runner's three language quest types (LANGUAGE_QUEST_TYPES)
    if (c.op === 'table') add('language.questTypes.definition', 3);
    if (c.op === 'complete') add('language.questTypes.objectiveComplete', i.checks.length);
    if (c.op === 'map') add('language.contract');
    if (c.op === 'templates') add(LANGUAGE_FIRST_CALL['quest-types'].templates(c));
  }
  return n;
}

// The answer keys of a run step that the transcription states in another shape than the
// corpus's (a count as `$len`, ids as `$ids`, the cache's keys as pairs, a pick's id as a
// subset, a sum the runner derives, the words as subsets), so the stated-value check below
// does not look for them verbatim; each still has its own expectation in the transcription.
const LANGUAGE_RESHAPED_KEYS = {
  progress: ['do', 'words', 'weak'],
  save: ['do'],
  prompts: ['do', 'targets', 'nameable', 'tagged', 'picked'],
  hover: ['do', 'cached', 'words'],
  chat: ['do', 'bookWords', 'grammarChecked'],
  adaptation: ['do'],
  // slice 3: a register's ids as `$ids`, a listening quest's answers as a `$len`
  collection: ['do', 'objects'],
  objects: ['do', 'targets'],
  writing: ['do', 'quests'],
  // slice 4: a step's echoed objective index; a run's recent ids as `$ids`; a lifecycle
  // step's passes and grammar uses and a grammar step's uses, each spread over the calls
  // that answer them (LANGUAGE_NESTED_KEYS holds every member)
  'quest-feedback': ['do', 'index', 'recent', 'pronunciation', 'uses'],
};
// Slice 3's reshaped members are still held: each must appear in the case's expectations
// in exactly the shape the emitter states it (its form here), so an emitter that drops
// one is red (self-sweep V5: a listening chat's quests, dropped, went unseen).
const LANGUAGE_RESHAPED_FORMS = {
  collection: { objects: (v) => ({ $ids: v, $key: 'objectId' }) },
  objects: { targets: (v) => ({ $ids: v }) },
  writing: {
    quests: (v, x) => (x.do === 'register'
      ? { $ids: v, $key: 'questId' }
      : v.map((q) => ({ $subset: { questId: q.questId, storyHeard: q.storyHeard, answers: { $len: q.answers }, evaluated: q.evaluated, score: q.score } }))),
  },
  // slice 4: a run's recent ids (stated on the call that last answered the state); a quest
  // type's categories and objectives as `$ids`; a template's objectives as subsets of its
  // objective templates and its parameters as `$ids`
  'quest-feedback': { recent: (v) => ({ $ids: v, $key: 'id' }) },
  'quest-types': {
    categories: (v) => ({ $ids: v, $key: 'id' }),
    objectives: (v) => (!Array.isArray(v) ? undefined : v.every((o) => typeof o === 'string')
      ? { $ids: v, $key: 'id' }
      : v.map((o) => ({ $subset: { type: o.type, requiredCount: o.requiredCount } }))),
    parameters: (v) => ({ $ids: v, $key: 'name' }),
  },
};
// Slice 4's run members that are objects the runner assembles from several calls (a
// lifecycle step's `pronunciation` and `uses`, a grammar step's `uses`): each of their
// members must be stated in some expectation of the case.
const LANGUAGE_NESTED_KEYS = { 'quest-feedback': ['pronunciation', 'uses'] };
// Slice 2's and slice 3's files hold EVERY case to the stated-value check, not only a run's
// steps: each member of an answer (each member of each element, for a list of objects)
// must be stated in some expectation of the case, except the members the runner echoes
// from the input or derives itself (the emitter checks each of those against the input)
// and, for slice 3's runs, the reshaped members above (`do`, a register's ids, a listening
// quest's projection, each still expected in its own shape), listed per op here.
const LANGUAGE_ANSWER_ECHOES = {
  bank: { cards: [], reveal: ['mode'], grammar: [], tables: [], profile: [], history: [] },
  adaptation: {
    struggle: [], difficulty: ['do'], mode: ['id', 'roll', 'modes'], npc: [], hint: ['level', 'index', 'difficulty', 'mastered'], quests: [], advance: [],
  },
  pronunciation: { encode: ['word'], similarity: ['expected', 'spoken'], score: [], repeat: [], xp: ['score'], hints: ['revealed'] },
  collection: { run: ['do', 'objects'] },
  objects: { normalize: [], identify: ['do', 'targets'], naming: ['do'], examine: [] },
  writing: { composition: ['text'], listening: ['do', 'quests'] },
  // slice 4 (a reshaped member with a form above is held in its form, here too)
  'quest-feedback': { targets: [], run: ['do', 'index', 'recent', 'pronunciation', 'uses'] },
  'quest-types': { select: ['world'], table: [], complete: ['questType', 'objective', 'progress'], map: [], templates: [] },
};

/** Every subtree of a transcribed case's expectations, operators included, as JSON text (for LANGUAGE_RESHAPED_FORMS). */
function expectationNodes(kase) {
  const out = new Set();
  const walk = (v) => {
    out.add(JSON.stringify(v));
    if (Array.isArray(v)) v.forEach(walk);
    else if (v !== null && typeof v === 'object') Object.values(v).forEach(walk);
  };
  for (const st of kase.steps ?? []) if ('expect' in st) walk(st.expect);
  return out;
}

/** Every value a transcribed case's expectations state, as JSON text (a `$subset`'s contents count; other operators do not). */
function statedValues(kase) {
  const out = new Set();
  const walk = (v) => {
    if (Array.isArray(v)) {
      out.add(JSON.stringify(v));
      v.forEach(walk);
    } else if (v !== null && typeof v === 'object') {
      const keys = Object.keys(v);
      if (keys.length && keys.every((k) => k.startsWith('$'))) {
        if (v.$subset) walk(v.$subset);
        return;
      }
      out.add(JSON.stringify(v));
      keys.forEach((k) => walk(v[k]));
    } else out.add(JSON.stringify(v));
  };
  for (const st of kase.steps ?? []) if ('expect' in st) walk(st.expect);
  return out;
}

/**
 * The problems of the language transcriptions, read through `load(base)` (the vendored
 * cases/core-language-<base>.json by default; the negative control hands perturbed ones).
 */
function languageTranscriptionProblems(load = (base) => {
  const f = path.join(CASES_DIR, `core-language-${base}.json`);
  return fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, 'utf8')) : null;
}) {
  const problems = [];
  let count = 0;
  const files = [];
  for (const rel of LANGUAGE_CORPUS_FILES) {
    const base = path.basename(rel, '.json');
    files.push(base);
    const firstCall = LANGUAGE_FIRST_CALL[base];
    if (!firstCall) {
      problems.push(`${rel} has no first-call table here`);
      continue;
    }
    const doc = load(base);
    if (!doc) {
      problems.push(`cases/core-language-${base}.json is missing`);
      continue;
    }
    const corpus = JSON.parse(fs.readFileSync(path.join(OUT_DIR, rel), 'utf8')).cases;
    const byName = new Map(doc.cases.map((c) => [c.name, c]));
    count += corpus.length;
    const nameOf = (c) => `language/${base} ${c.op}: ${c.name}`;
    const missing = corpus.filter((c) => !byName.has(nameOf(c))).map((c) => c.name);
    const wrong = corpus.filter((c) => {
      const calls = (byName.get(nameOf(c))?.steps ?? []).map((st) => st.call);
      if (calls.length === 0) return false;
      const first = typeof firstCall[c.op] === 'function' ? firstCall[c.op](c) : firstCall[c.op];
      if (calls[0] !== first || calls.some((call) => !call.startsWith('language.') && call !== 'props.interactables.examinePick')) return true;
      const made = {};
      for (const call of calls) made[call] = (made[call] ?? 0) + 1;
      const want = languageCallsOf(base, c);
      const rows = new Set([...Object.keys(made), ...Object.keys(want)]);
      return [...rows].some((row) => (made[row] ?? 0) !== (want[row] ?? 0));
    }).map((c) => c.name);
    // Every answer of a run's steps that the transcription carries verbatim is stated in
    // some expectation of the case (a value core's runner reads, dropped by the emitter,
    // would otherwise go unexpected and unseen).
    const unstated = [];
    for (const c of corpus) {
      const kase = byName.get(nameOf(c));
      if (!kase || !Array.isArray(c.expected) || !c.expected.every((x) => x && typeof x === 'object' && 'do' in x)) continue;
      const stated = statedValues(kase);
      const forms = LANGUAGE_RESHAPED_FORMS[base] ?? {};
      const nodes = Object.keys(forms).length ? expectationNodes(kase) : null;
      const nested = LANGUAGE_NESTED_KEYS[base] ?? [];
      c.expected.forEach((x, k) => {
        for (const [key, v] of Object.entries(x)) {
          if (forms[key]) {
            if (!nodes.has(JSON.stringify(forms[key](v, x)))) unstated.push(`${c.name} (step ${k} ${x.do}: ${key}, reshaped)`);
          } else if (nested.includes(key)) {
            for (const [k2, v2] of Object.entries(v)) if (!stated.has(JSON.stringify(v2))) unstated.push(`${c.name} (step ${k} ${x.do}: ${key}.${k2})`);
          } else if (!LANGUAGE_RESHAPED_KEYS[base].includes(key) && !stated.has(JSON.stringify(v))) unstated.push(`${c.name} (step ${k} ${x.do}: ${key})`);
        }
      });
    }
    const echoes = LANGUAGE_ANSWER_ECHOES[base];
    if (echoes) {
      for (const c of corpus) {
        const kase = byName.get(nameOf(c));
        if (!kase) continue;
        const stated = statedValues(kase);
        const skip = echoes[c.op];
        if (!skip) {
          unstated.push(`${c.name} (op ${c.op} has no echo list here)`);
          continue;
        }
        const members = Array.isArray(c.expected) && c.expected.every((x) => x && typeof x === 'object' && !Array.isArray(x))
          ? c.expected.flatMap((x, k) => Object.entries(x).map(([key, v]) => [`[${k}].${key}`, key, v]))
          : c.expected && typeof c.expected === 'object' && !Array.isArray(c.expected)
            ? Object.entries(c.expected).map(([key, v]) => [key, key, v])
            : [['$', null, c.expected]];
        const forms = LANGUAGE_RESHAPED_FORMS[base] ?? {};
        const nodes = expectationNodes(kase);
        for (const [where, key, v] of members) {
          // a reshaped member of a non-run answer (slice 4's quest types), held in its form; a
          // form answers undefined for a member of another shape under the same name (the type
          // map's `objectives`), which is then held verbatim
          const form = key !== null && forms[key] && !skip.includes(key) ? forms[key](v) : undefined;
          if (form !== undefined) {
            if (!nodes.has(JSON.stringify(form))) unstated.push(`${c.name} (${where}, reshaped)`);
          } else if (!skip.includes(key) && !stated.has(JSON.stringify(v))) unstated.push(`${c.name} (${where})`);
        }
      }
    }
    if (missing.length) problems.push(`core-language-${base}.json: ${missing.length} corpus case(s) not transcribed, first: ${missing[0]}`);
    if (wrong.length) problems.push(`core-language-${base}.json: ${wrong.length} case(s) not transcribed as core's runner calls their op, first: ${wrong[0]}`);
    if (unstated.length) problems.push(`core-language-${base}.json: ${unstated.length} answer(s) of the corpus expected nowhere, first: ${unstated[0]}`);
    if (byName.size !== corpus.length) problems.push(`core-language-${base}.json carries ${byName.size} case(s), not the corpus's ${corpus.length}`);
  }
  return { problems, count, files };
}

// ── the genre systems transcription guard (PL.native-genre-rows) ──────────────
// cases/core-genre-<genre>-<file>.json must transcribe every case of the vendored
// conformance/<genre>/<file>.json: by name, by the calls core's runner (systems-corpus.ts,
// runGenreSystemsOp) makes for its op in that order, C-only exactly when it reaches the
// KB (puzzle.director.create, platformer.director.create, strategy.director.create), and with every answer of the
// corpus stated in some expectation (compared with object keys in canonical order). A
// platformer `step` answer is core's runner's view (`{ ...outcome, movement:
// movementView, probed }`), which the step row's expectation states as its outcome with the
// movement held as a subset: the guard reads the view back out of that expectation
// (`platformerStepView`) and requires it to BE the corpus's answer, and the host's `orders`
// to be stated empty. The stars are held in place: the k-th platformer.stars call takes the
// k-th run and expects its stars. A strategy case is held the same way, more tightly: each
// answer is the step row's whole expectation (a `{ victory }`, a `{ settlements }`, never a
// bare `true` or `[]` that any other step could state), and a campaign's books, prices and
// controlled settlements are held in place, call k taking the k-th business or faction and
// expecting its answer. The genre pieces (conformance/genre-pieces/{kinds,build-plan}.json, core's
// runners genre-pieces-corpus.ts and build-plan-corpus.ts) are one row call per case, a write two
// (the ground plan over `world ?? {}`, then the writer), and every call is held in place: its args
// exactly the input members core's runner passes (a build-plan `{"$fixture": name}` named by `$file`
// in the vendored corpus) and its whole answer stated. `--check-genre-transcription-negative`
// proves each kind of drift is named.
const GENRE_GUARD_FILES = [
  'puzzle/definition',
  'puzzle/run',
  'puzzle/save',
  'platformer/course',
  'platformer/run',
  'platformer/save',
  'strategy/campaign',
  'strategy/run',
  'strategy/save',
  'genre-pieces/kinds',
  'genre-pieces/build-plan',
];
const PLATFORMER_STEP_CALL = {
  restore: 'platformer.director.restore',
  enter: 'platformer.director.enter',
  step: 'platformer.director.step',
  respawn: 'platformer.director.respawn',
  hint: 'platformer.director.hint',
  unlocked: 'platformer.director.isUnlocked',
  progress: 'platformer.director.progress',
  state: 'platformer.director.serialize',
};
const STRATEGY_STEP_CALL = {
  start: 'strategy.director.start',
  restore: 'strategy.director.restore',
  claim: 'strategy.director.claim',
  assign: 'strategy.director.assign',
  release: 'strategy.director.release',
  endTurn: 'strategy.director.endTurn',
  stockpile: 'strategy.director.stockpile',
  holder: 'strategy.director.holderOf',
  controls: 'strategy.director.controls',
  victory: 'strategy.director.victory',
  progress: 'strategy.director.progress',
  state: 'strategy.director.serialize',
};
const KB_CREATES = ['puzzle.director.create', 'platformer.director.create', 'strategy.director.create'];

/** JSON with every object's keys in code-unit order: two values are equal exactly when these are. */
function canonJson(v) {
  if (Array.isArray(v)) return `[${v.map(canonJson).join(',')}]`;
  if (v !== null && typeof v === 'object') return `{${Object.keys(v).sort().map((k) => `${JSON.stringify(k)}:${canonJson(v[k])}`).join(',')}}`;
  return JSON.stringify(v);
}

/** Core's runner's view of a platformer step, read back out of a step row's expectation (null: it states none). */
function platformerStepView(expect) {
  const isPlain = (v) => v !== null && typeof v === 'object' && !Array.isArray(v) && !Object.keys(v).some((k) => k.startsWith('$'));
  if (!isPlain(expect) || !isPlain(expect.outcome) || !Array.isArray(expect.probed) || canonJson(expect.orders) !== '[]') return null;
  if (Object.keys(expect).length !== 3) return null;
  const { movement, ...rest } = expect.outcome;
  if (Object.values(rest).some((v) => v !== null && typeof v === 'object' && Object.keys(v).some((k) => k.startsWith('$')))) return null;
  const view = { ...rest, probed: expect.probed };
  if (movement === undefined) return view;
  const m = movement?.$subset;
  if (!m || Object.keys(movement).length !== 1) return null;
  const a = m.affordance?.$subset;
  const known = ['performed', 'refusal', 'affordance', 'cost', 'location'];
  if (Object.keys(m).some((k) => !known.includes(k)) || (m.affordance !== undefined && (!a || Object.keys(a).join() !== 'mode,id'))) return null;
  view.movement = {
    performed: m.performed,
    ...('refusal' in m ? { refusal: m.refusal } : {}),
    ...(a ? { mode: a.mode, link: a.id } : {}),
    cost: m.cost,
    location: m.location,
  };
  return view;
}

/** Every value a genre case's expectations state, as canonical JSON (operators' `$subset` read through), with each platformer step's view. */
function genreStatedValues(kase) {
  const out = new Set();
  const walk = (v) => {
    if (Array.isArray(v)) {
      out.add(canonJson(v));
      v.forEach(walk);
    } else if (v !== null && typeof v === 'object') {
      const keys = Object.keys(v);
      if (keys.length && keys.every((k) => k.startsWith('$'))) {
        if (v.$subset) walk(v.$subset);
        return;
      }
      out.add(canonJson(v));
      keys.forEach((k) => walk(v[k]));
    } else out.add(canonJson(v));
  };
  for (const st of kase.steps ?? []) {
    if (!('expect' in st)) continue;
    if (st.call === 'platformer.director.step') {
      const view = platformerStepView(st.expect);
      if (view) out.add(canonJson(view));
      continue;
    }
    walk(st.expect);
  }
  return out;
}
const PUZZLE_STEP_CALL = {
  restore: 'puzzle.director.restore',
  clue: 'puzzle.director.findClue',
  answer: 'puzzle.director.answer',
  unlock: 'puzzle.director.unlock',
  take: 'puzzle.director.take',
  view: 'puzzle.director.view',
  progress: 'puzzle.director.progress',
  complete: 'puzzle.director.isComplete',
  state: 'puzzle.director.serialize',
};
const genreCaseFileOf = (file) => `core-genre-${file.replace('/', '-')}.json`;

/** The calls core's runner makes for one corpus case, in order, and the answers it must state. */
function genreCallsOf(file, c) {
  const e = c.expected;
  const runCalls = (input, run, restoring) => [
    'puzzle.director.create',
    ...(restoring ? ['puzzle.director.restore'] : []),
    ...(input.steps ?? []).map((st) => PUZZLE_STEP_CALL[st.step] ?? `(no row for step ${st.step})`),
    'puzzle.director.serialize',
    'session.dispose',
  ];
  const runAnswers = (run) => [run.published, ...run.steps.map((x) => {
    const { step, ...rest } = x;
    return step === 'view' ? rest.view : step === 'progress' ? rest.progress : step === 'complete' ? rest.complete : step === 'state' ? rest.state : rest;
  }), run.state];
  if (file === 'puzzle/definition') {
    if (c.op === 'generate') return { calls: ['genre.world.of', 'puzzle.forWorld', 'puzzle.facts', 'puzzle.worldFacts', 'puzzle.answerKey'], answers: [e.definition, e.facts, e.worldFacts, e.answerKey] };
    if (c.op === 'authored') return { calls: ['puzzle.issues', ...(e.issues.length === 0 ? ['puzzle.fromIR'] : [])], answers: [e.issues, ...(e.definition === null ? [] : [e.definition])] };
    if (c.op === 'choices') return { calls: ['genre.world.of', 'puzzle.forWorld', ...Object.keys(e).map(() => 'puzzle.choices')], answers: Object.values(e) };
  }
  if (file === 'puzzle/run') return { calls: runCalls(c.input, e, false), answers: runAnswers(e) };
  if (file === 'puzzle/save') {
    if (c.op === 'block') return { calls: ['puzzle.save.block', 'puzzle.save.blockOf'], answers: [e] };
    const read = c.op === 'read' ? e : e.read;
    const held = read.ok && read.value !== null;
    const calls = ['puzzle.save.read', ...(held ? ['puzzle.save.blockOf'] : [])];
    const answers = [held ? read.value : read];
    if (c.op === 'restore' && held) return { calls: [...calls, ...runCalls(c.input, e.run, true)], answers: [...answers, ...runAnswers(e.run)] };
    return { calls, answers };
  }
  const pRunCalls = (input, restoring) => [
    'platformer.director.create',
    ...(restoring ? ['platformer.director.restore'] : []),
    ...(input.steps ?? []).map((st) => PLATFORMER_STEP_CALL[st.step] ?? `(no row for step ${st.step})`),
    'platformer.director.serialize',
    'session.dispose',
  ];
  const pRunAnswers = (run) => [run.published, ...run.steps.map((x) => {
    const { step, ...rest } = x;
    return step === 'hint' ? rest.route : step === 'unlocked' ? rest.unlocked : step === 'progress' ? rest.progress : step === 'state' ? rest.state : rest;
  }), run.state];
  if (file === 'platformer/course') {
    if (c.op === 'generate') return { calls: ['genre.world.of', 'platformer.forWorld', 'platformer.levelFacts'], answers: [e.course, e.levelFacts] };
    if (c.op === 'route') return { calls: ['platformer.route'], answers: [e] };
    if (c.op === 'stars') {
      return {
        calls: c.input.runs.map(() => 'platformer.stars'),
        answers: [],
        positional: c.input.runs.map(([par, cost], k) => [k, { par, cost }, { stars: e[k] }]),
      };
    }
  }
  if (file === 'platformer/run') return { calls: pRunCalls(c.input, false), answers: pRunAnswers(e) };
  if (file === 'platformer/save') {
    if (c.op === 'block') return { calls: ['platformer.save.block', 'platformer.save.blockOf'], answers: [e] };
    const read = c.op === 'read' ? e : e.read;
    const held = read.ok && read.value !== null;
    const calls = ['platformer.save.read', ...(held ? ['platformer.save.blockOf'] : [])];
    const answers = [held ? read.value : read];
    if (c.op === 'restore' && held) return { calls: [...calls, ...pRunCalls(c.input, true)], answers: [...answers, ...pRunAnswers(e.run)] };
    return { calls, answers };
  }
  // The strategy game: a run's answers are each step row's whole expectation (a scalar
  // answer is held with its key, so a `true` or a `[]` stated elsewhere does not stand for it).
  const sRunCalls = (input, restoring) => [
    'strategy.director.create',
    ...(restoring ? ['strategy.director.restore'] : []),
    ...(input.steps ?? []).map((st) => STRATEGY_STEP_CALL[st.step] ?? `(no row for step ${st.step})`),
    'strategy.director.serialize',
    'session.dispose',
  ];
  const sRunAnswers = (run) => [...run.steps.map((x) => {
    const { step, ...rest } = x;
    return step === 'stockpile' ? { stockpile: rest.stockpile }
      : step === 'holder' ? { holder: rest.holder }
      : step === 'controls' ? { settlements: rest.controls }
      : step === 'victory' ? { victory: rest.victory }
      : step === 'progress' ? { progress: rest.progress }
      : step === 'state' ? { state: rest.state }
      : rest;
  }), { state: run.state }];
  if (file === 'strategy/campaign') {
    const board = c.input.board ?? { holders: {}, workers: {} };
    if (c.op === 'generate') return { calls: ['genre.world.of', 'strategy.forWorld', 'strategy.facts', 'strategy.worldFacts'], answers: [{ campaign: e.campaign }, { facts: e.facts }, { facts: e.worldFacts }] };
    if (c.op === 'adjacency') return { calls: ['genre.world.of', 'strategy.adjacency'], answers: [{ adjacency: e }] };
    if (c.op === 'books') return { calls: ['strategy.books'], answers: [], positional: [[0, { campaign: c.input.campaign, board }, { books: e }]] };
    if (c.op === 'claimCost') {
      return {
        calls: c.input.businesses.map(() => 'strategy.claimCost'),
        answers: [],
        positional: c.input.businesses.map((business, k) => [k, { campaign: c.input.campaign, business }, { cost: e[business] }]),
      };
    }
    if (c.op === 'controlled') {
      return {
        calls: c.input.campaign.factions.map(() => 'strategy.controlled'),
        answers: [],
        positional: c.input.campaign.factions.map((faction, k) => [k, { campaign: c.input.campaign, board, faction }, { settlements: e[faction] }]),
      };
    }
  }
  if (file === 'strategy/run') return { calls: sRunCalls(c.input, false), answers: sRunAnswers(e) };
  if (file === 'strategy/save') {
    if (c.op === 'block') return { calls: ['strategy.save.block', 'strategy.save.blockOf'], answers: [{ block: e }] };
    const read = c.op === 'read' ? e : e.read;
    const held = read.ok && read.value !== null;
    const calls = ['strategy.save.read', ...(held ? ['strategy.save.blockOf'] : [])];
    const answers = [held ? { block: read.value } : read];
    if (c.op === 'restore' && held) return { calls: [...calls, ...sRunCalls(c.input, true)], answers: [...answers, ...sRunAnswers(e.run)] };
    return { calls, answers };
  }
  // The genre pieces: one row call per case (a write: the ground plan, then the writer), held
  // in place: call k takes exactly the args core's runner passes (each input member when the
  // input has it; a build-plan fixture named by `$file` in the vendored corpus) and states the
  // whole answer.
  if (file === 'genre-pieces/kinds' || file === 'genre-pieces/build-plan') {
    const fixtureRef = (v) => {
      if (Array.isArray(v)) return v.map(fixtureRef);
      if (v === null || typeof v !== 'object') return v;
      const keys = Object.keys(v);
      if (keys.length === 1 && keys[0] === '$fixture') return { $file: '../conformance/genre-pieces/build-plan.json', $path: `fixtures.${v.$fixture}` };
      return Object.fromEntries(keys.map((k) => [k, fixtureRef(v[k])]));
    };
    const i = file === 'genre-pieces/build-plan' ? fixtureRef(c.input) : c.input;
    const pick = (keys) => Object.fromEntries(keys.filter((k) => Object.prototype.hasOwnProperty.call(i, k)).map((k) => [k, i[k]]));
    const D = ['course', 'puzzle', 'campaign'];
    const one = {
      kinds: ['genrePieces.kinds', ['genre'], (x) => x],
      key: ['genrePieces.key', ['genre', 'kind', 'variant'], (x) => x],
      pieces: ['genrePieces.for', ['genre', ...D], (x) => x],
      collect: ['genrePieces.collect', ['genrePieces'], (x) => ({ entities: x })],
      stamp: ['genrePieces.stamp', ['genrePieces'], (x) => x],
      anchors: ['genrePieces.anchors', ['world', 'course', 'puzzle'], (x) => ({ anchors: x })],
      place: ['genrePieces.place', ['genre', 'pieces', 'anchors'], (x) => x],
      plan: ['genrePieces.plan', ['genre', 'world', ...D], (x) => x],
      settle: ['genrePieces.settleOffset', ['n'], (x) => ({ offset: x })],
      ground: ['genrePieces.ground', ['genre', 'world', ...D], (x) => x],
    }[c.op];
    const ops = file === 'genre-pieces/kinds' ? ['kinds', 'key', 'pieces', 'collect', 'stamp'] : ['anchors', 'place', 'plan', 'settle', 'ground', 'write'];
    if (!ops.includes(c.op)) return { calls: [`(no op ${c.op} for ${file})`], answers: [] };
    if (one) return { calls: [one[0]], answers: [one[2](e)], positional: [[0, pick(one[1]), one[2](e)]] };
    const world = i.world ?? {};
    const groundArgs = { ...pick(['genre', ...D]), world };
    if ('refused' in e) return { calls: ['genrePieces.ground'], answers: [e], positional: [[0, groundArgs, e]] };
    return {
      calls: ['genrePieces.ground', 'genrePieces.write'],
      answers: [e],
      positional: [
        [0, groundArgs, { $type: 'object' }],
        [1, { world, plan: { $ref: 'g' } }, { world: { $subset: { entities: { $subset: { genrePieces: e.genrePieces, genreGround: e.genreGround } } } } }],
      ],
    };
  }
  return { calls: [`(no op ${c.op} for ${file})`], answers: [] };
}

function genreTranscriptionProblems(load = (file) => JSON.parse(fs.readFileSync(path.join(CASES_DIR, genreCaseFileOf(file)), 'utf8'))) {
  const problems = [];
  let count = 0;
  for (const file of GENRE_GUARD_FILES) {
    const corpus = JSON.parse(fs.readFileSync(path.join(OUT_DIR, 'conformance', `${file}.json`), 'utf8'));
    const doc = load(file);
    const label = genreCaseFileOf(file);
    const byName = new Map(doc.cases.map((k) => [k.name, k]));
    const missing = [];
    const miscalled = [];
    const legs = [];
    const unstated = [];
    const names = new Set();
    for (const c of corpus.cases) {
      count++;
      const name = `${file} ${c.op}: ${c.name}`;
      names.add(name);
      const kase = byName.get(name);
      if (!kase) {
        missing.push(name);
        continue;
      }
      const { calls, answers, positional = [] } = genreCallsOf(file, c);
      const got = (kase.steps ?? []).map((st) => st.call);
      if (JSON.stringify(got) !== JSON.stringify(calls)) miscalled.push(name);
      const kb = calls.some((call) => KB_CREATES.includes(call));
      const cOnly = Array.isArray(kase.legs) && kase.legs.length === 1 && kase.legs[0] === 'c';
      if (kb !== cOnly) legs.push(name);
      const stated = genreStatedValues(kase);
      for (const [k, v] of answers.entries()) if (!stated.has(canonJson(v))) unstated.push(`${name} (answer ${k})`);
      for (const [k, args, expect] of positional) {
        const st = (kase.steps ?? [])[k];
        if (!st || canonJson(st.args) !== canonJson(args)) miscalled.push(`${name} (call ${k})`);
        else if (!('expect' in st) || canonJson(st.expect) !== canonJson(expect)) unstated.push(`${name} (answer ${k})`);
      }
    }
    const extra = doc.cases.filter((k) => !names.has(k.name)).map((k) => k.name);
    if (missing.length) problems.push(`${label}: ${missing.length} corpus case(s) not transcribed: ${missing.join(', ')}`);
    if (extra.length) problems.push(`${label}: ${extra.length} case(s) no corpus case names: ${extra.join(', ')}`);
    if (miscalled.length) problems.push(`${label}: ${miscalled.length} case(s) not transcribed as core's runner calls their op: ${miscalled.join(', ')}`);
    if (legs.length) problems.push(`${label}: ${legs.length} case(s) C-only when they do not reach the KB, or not C-only when they do: ${legs.join(', ')}`);
    if (unstated.length) problems.push(`${label}: ${unstated.length} answer(s) of the corpus expected nowhere: ${unstated.join(', ')}`);
  }
  return { problems, count };
}

/** The genre guard's negative control: each perturbation, made in memory, must be named. */
function genreTranscriptionNegative() {
  const read = (file) => JSON.parse(fs.readFileSync(path.join(CASES_DIR, genreCaseFileOf(file)), 'utf8'));
  const steps = (d) => d.cases.flatMap((c) => c.steps);
  const perturbations = [
    ['a dropped case', 'puzzle/definition', (d) => d.cases.splice(2, 1), 'corpus case(s) not transcribed'],
    ['a case no corpus case names', 'puzzle/save', (d) => d.cases.push({ ...d.cases[0], name: 'puzzle/save block: invented' }), 'no corpus case names'],
    ['a dropped call (a run\'s answer)', 'puzzle/run', (d) => {
      d.cases[0].steps.splice(d.cases[0].steps.findIndex((st) => st.call === 'puzzle.director.answer'), 1);
    }, "not transcribed as core's runner calls their op"],
    ['a first call changed (a read that starts at blockOf)', 'puzzle/save', (d) => {
      d.cases.find((c) => c.name.startsWith('puzzle/save read')).steps[0].call = 'puzzle.save.blockOf';
    }, "not transcribed as core's runner calls their op"],
    ['a riddle\'s choices dropped', 'puzzle/definition', (d) => {
      const kase = d.cases.find((c) => c.name.startsWith('puzzle/definition choices'));
      kase.steps.splice(kase.steps.findIndex((st) => st.call === 'puzzle.choices'), 1);
    }, "not transcribed as core's runner calls their op"],
    ['an answer expected nowhere (a generated answer key)', 'puzzle/definition', (d) => {
      delete steps(d).find((st) => st.call === 'puzzle.answerKey').expect;
    }, 'answer(s) of the corpus expected nowhere'],
    ['an answer weakened to a subset (an unlock outcome)', 'puzzle/run', (d) => {
      const st = steps(d).find((x) => x.call === 'puzzle.director.unlock');
      st.expect = { $subset: { ok: st.expect.ok } };
    }, 'answer(s) of the corpus expected nowhere'],
    ['a restored run\'s states expected nowhere', 'puzzle/save', (d) => {
      // Every serialize of the restored run (a state may repeat another step's, so all of them).
      const kase = d.cases.find((c) => c.steps.some((st) => st.call === 'puzzle.director.create'));
      for (const st of kase.steps) if (st.call === 'puzzle.director.serialize') st.expect = { state: { $type: 'object' } };
    }, 'answer(s) of the corpus expected nowhere'],
    ['a KB run put on both legs', 'puzzle/run', (d) => {
      delete d.cases[1].legs;
    }, 'C-only when they do not reach the KB'],
    ['a platformer run\'s step call dropped', 'platformer/run', (d) => {
      d.cases[0].steps.splice(d.cases[0].steps.findIndex((st) => st.call === 'platformer.director.step'), 1);
    }, "not transcribed as core's runner calls their op"],
    ['a step\'s movement weakened (its cost dropped from the subset)', 'platformer/run', (d) => {
      const st = steps(d).find((x) => x.call === 'platformer.director.step' && x.expect.outcome.movement);
      delete st.expect.outcome.movement.$subset.cost;
    }, 'answer(s) of the corpus expected nowhere'],
    ['a step\'s probed links changed', 'platformer/run', (d) => {
      const st = d.cases.flatMap((c) => c.steps).find((x) => x.call === 'platformer.director.step' && x.expect.probed.length > 0);
      st.expect.probed = [];
    }, 'answer(s) of the corpus expected nowhere'],
    ['a step\'s outcome weakened to a subset', 'platformer/run', (d) => {
      const st = steps(d).find((x) => x.call === 'platformer.director.step');
      st.expect.outcome = { $subset: { ok: st.expect.outcome.ok } };
    }, 'answer(s) of the corpus expected nowhere'],
    ['a step\'s host orders stated non-empty', 'platformer/run', (d) => {
      steps(d).find((x) => x.call === 'platformer.director.step').expect.orders = [{ actor: 'player' }];
    }, 'answer(s) of the corpus expected nowhere'],
    ['two runs\' stars swapped', 'platformer/course', (d) => {
      const kase = d.cases.find((c) => c.name.startsWith('platformer/course stars'));
      const [a, b] = [kase.steps[1].expect, kase.steps[2].expect];
      [kase.steps[1].expect, kase.steps[2].expect] = [b, a];
      if (canonJson(a) === canonJson(b)) kase.steps[1].expect = { stars: a.stars === 3 ? 1 : 3 };
    }, 'answer(s) of the corpus expected nowhere'],
    ['a course case put on the C leg only', 'platformer/course', (d) => {
      Object.assign(d.cases[0], { legs: ['c'], why: 'perturbed' });
    }, 'C-only when they do not reach the KB'],
    ['a restored platformer run put on both legs', 'platformer/save', (d) => {
      delete d.cases.find((c) => c.legs).legs;
    }, 'C-only when they do not reach the KB'],
    ['a strategy run\'s endTurn call dropped', 'strategy/run', (d) => {
      d.cases[0].steps.splice(d.cases[0].steps.findIndex((st) => st.call === 'strategy.director.endTurn'), 1);
    }, "not transcribed as core's runner calls their op"],
    ['a turn report\'s orders stated empty', 'strategy/run', (d) => {
      steps(d).find((x) => x.call === 'strategy.director.endTurn' && x.expect.orders.length > 0).expect.orders = [];
    }, 'answer(s) of the corpus expected nowhere'],
    ['a turn report weakened to a subset', 'strategy/run', (d) => {
      const st = steps(d).find((x) => x.call === 'strategy.director.endTurn');
      st.expect = { $subset: { ok: st.expect.ok, turn: st.expect.turn } };
    }, 'answer(s) of the corpus expected nowhere'],
    ['a victory answer flipped', 'strategy/run', (d) => {
      const st = steps(d).find((x) => x.call === 'strategy.director.victory');
      st.expect = { victory: !st.expect.victory };
    }, 'answer(s) of the corpus expected nowhere'],
    ['a stockpile answer stated under another key', 'strategy/run', (d) => {
      const st = steps(d).find((x) => x.call === 'strategy.director.stockpile');
      st.expect = { pile: st.expect.stockpile };
    }, 'answer(s) of the corpus expected nowhere'],
    ['a controls answer stated under another key', 'strategy/run', (d) => {
      const st = steps(d).find((x) => x.call === 'strategy.director.controls' && x.expect.settlements.length > 0);
      st.expect = { controls: st.expect.settlements };
    }, 'answer(s) of the corpus expected nowhere'],
    ['two businesses\' prices swapped', 'strategy/campaign', (d) => {
      const kase = d.cases.find((c) => c.steps.every((st) => st.call === 'strategy.claimCost') && new Set(c.steps.map((st) => canonJson(st.expect))).size > 1);
      const k = kase.steps.findIndex((st) => canonJson(st.expect) !== canonJson(kase.steps[0].expect));
      [kase.steps[0].expect, kase.steps[k].expect] = [kase.steps[k].expect, kase.steps[0].expect];
    }, 'answer(s) of the corpus expected nowhere'],
    ['a controlled call asked for another faction', 'strategy/campaign', (d) => {
      const kase = d.cases.find((c) => c.steps[0]?.call === 'strategy.controlled');
      kase.steps[1].args.faction = kase.steps[0].args.faction;
    }, "not transcribed as core's runner calls their op"],
    ['a campaign case put on the C leg only', 'strategy/campaign', (d) => {
      Object.assign(d.cases[0], { legs: ['c'], why: 'perturbed' });
    }, 'C-only when they do not reach the KB'],
    ['a restored strategy run put on both legs', 'strategy/save', (d) => {
      delete d.cases.find((c) => c.legs).legs;
    }, 'C-only when they do not reach the KB'],
    ['a key call asked without its variant', 'genre-pieces/kinds', (d) => {
      delete steps(d).find((x) => x.call === 'genrePieces.key' && 'variant' in x.args).args.variant;
    }, "not transcribed as core's runner calls their op"],
    ['a binding walk weakened to a subset (the first entity alone)', 'genre-pieces/kinds', (d) => {
      const st = steps(d).find((x) => x.call === 'genrePieces.collect' && x.expect.entities.length > 1);
      st.expect = { $subset: { entities: { $len: st.expect.entities.length } } };
    }, 'answer(s) of the corpus expected nowhere'],
    ['a pieces case put on the C leg only', 'genre-pieces/kinds', (d) => {
      Object.assign(d.cases.find((c) => c.steps[0].call === 'genrePieces.for'), { legs: ['c'], why: 'perturbed' });
    }, 'C-only when they do not reach the KB'],
    ['a build-plan fixture named at another path', 'genre-pieces/build-plan', (d) => {
      steps(d).find((x) => x.args.world?.$path === 'fixtures.thistlecombe-world').args.world.$path = 'fixtures.thistlecombe-course';
    }, "not transcribed as core's runner calls their op"],
    ['a write\'s ground call dropped', 'genre-pieces/build-plan', (d) => {
      const kase = d.cases.find((c) => c.steps.some((st) => st.call === 'genrePieces.write'));
      kase.steps.splice(kase.steps.findIndex((st) => st.call === 'genrePieces.ground'), 1);
    }, "not transcribed as core's runner calls their op"],
    ['a settle offset stated under another key', 'genre-pieces/build-plan', (d) => {
      const st = steps(d).find((x) => x.call === 'genrePieces.settleOffset' && x.args.n > 0);
      st.expect = { at: st.expect.offset };
    }, 'answer(s) of the corpus expected nowhere'],
    ['a written world\'s ground stated empty', 'genre-pieces/build-plan', (d) => {
      steps(d).find((x) => x.call === 'genrePieces.write').expect.world.$subset.entities.$subset.genreGround = [];
    }, 'answer(s) of the corpus expected nowhere'],
  ];
  let named = 0;
  for (const [what, file, perturb, want] of perturbations) {
    const doc = read(file);
    perturb(doc);
    const { problems } = genreTranscriptionProblems((f) => (f === file ? doc : read(f)));
    const hit = problems.find((p) => p.startsWith(genreCaseFileOf(file)) && p.includes(want));
    console.log(`  ${hit ? 'named' : 'MISSED'}: ${what} -> ${(hit ?? problems.join('; ')) || 'no problem'}`);
    if (hit) named++;
  }
  console.log(`vendor-core-bundle: genre transcription negative — ${named} of ${perturbations.length} perturbed transcription(s) named`);
  if (named !== perturbations.length) fail('the genre transcription guard missed a perturbation');
}

/**
 * The language guard's negative control (`--check-language-transcription-negative`): each
 * perturbation of the vendored transcriptions, made in memory, must be named by the guard.
 */
function languageTranscriptionNegative() {
  const read = (base) => JSON.parse(fs.readFileSync(path.join(CASES_DIR, `core-language-${base}.json`), 'utf8'));
  const perturbations = [
    ['a dropped case', 'save', (d) => d.cases.splice(3, 1), 'corpus case(s) not transcribed'],
    ['a dropped call (a chat line\'s recordTurn)', 'chat', (d) => {
      const kase = d.cases.find((c) => c.steps.some((st) => st.call === 'language.difficulty.recordTurn'));
      kase.steps.splice(kase.steps.findIndex((st) => st.call === 'language.difficulty.recordTurn'), 1);
    }, "not transcribed as core's runner calls their op"],
    ['a first call changed', 'hover', (d) => {
      d.cases.find((c) => c.steps[0].call === 'language.hover.initial').steps[0].call = 'language.hover.addHints';
    }, "not transcribed as core's runner calls their op"],
    ['an answer expected nowhere (a hover display\'s encounters)', 'hover', (d) => {
      // The display's `encounters` is stated on the call that last answered the state.
      for (const kase of d.cases) {
        for (const st of kase.steps) {
          const held = st.expect?.$subset?.state?.$subset;
          if (held && held.mastery && Object.keys(held.mastery).length) {
            delete held.mastery;
            return;
          }
        }
      }
      throw new Error('no hover case states a display\'s encounters');
    }, 'answer(s) of the corpus expected nowhere'],
    ['a call not a language row', 'prompts', (d) => {
      d.cases[0].steps[1].call = 'props.interactables.press';
    }, "not transcribed as core's runner calls their op"],
    ['an answer weakened to a subset (a pronunciation score without its words and feedback)', 'pronunciation', (d) => {
      const st = d.cases.flatMap((c) => c.steps).find((x) => x.call === 'language.pronunciation.score');
      st.expect = { $subset: { score: st.expect.score } };
    }, 'answer(s) of the corpus expected nowhere'],
    ['a mode at one band dropped (an NPC mode)', 'adaptation', (d) => {
      const kase = d.cases.find((c) => c.steps.some((x) => x.call === 'language.npc.mode'));
      kase.steps.splice(kase.steps.findIndex((x) => x.call === 'language.npc.mode'), 1);
    }, "not transcribed as core's runner calls their op"],
    // slice 3
    ['an identification answer dropped', 'objects', (d) => {
      const kase = d.cases.find((c) => c.steps.some((x) => x.call === 'language.identification.answer'));
      kase.steps.splice(kase.steps.findIndex((x) => x.call === 'language.identification.answer'), 1);
    }, "not transcribed as core's runner calls their op"],
    ['an answer weakened to a subset (an examine without its events)', 'objects', (d) => {
      const st = d.cases.flatMap((c) => c.steps).find((x) => x.call === 'language.objects.examine' && x.expect.ok === true);
      st.expect = { $subset: { ok: true } };
    }, 'answer(s) of the corpus expected nowhere'],
    ['a first call changed (a collection run that does not read the contract first)', 'collection', (d) => {
      d.cases[0].steps[0].call = 'language.collection.initial';
    }, "not transcribed as core's runner calls their op"],
    ['an answer expected nowhere (a knowledge world\'s collected words)', 'collection', (d) => {
      // Every collection answer of the knowledge-world case loses its collected words.
      const kase = d.cases.find((c) => c.name.includes('knowledge world'));
      for (const st of kase.steps) if (st.call === 'language.collection.answer') delete st.expect.$subset.state;
    }, 'answer(s) of the corpus expected nowhere'],
    ['a listening chat dropped', 'writing', (d) => {
      const kase = d.cases.find((c) => c.steps.some((x) => x.call === 'language.listening.chat'));
      kase.steps.splice(kase.steps.findIndex((x) => x.call === 'language.listening.chat'), 1);
    }, "not transcribed as core's runner calls their op"],
    ['a listening chat\'s quests not expected (a reshaped member)', 'writing', (d) => {
      // Every chat of the first listening case loses its quests (one alone may repeat another's).
      const kase = d.cases.find((c) => c.steps.some((x) => x.call === 'language.listening.chat'));
      for (const st of kase.steps) if (st.call === 'language.listening.chat') delete st.expect.$subset.state;
    }, 'answer(s) of the corpus expected nowhere'],
    ['an answer weakened to a subset (a submitted composition without its events)', 'writing', (d) => {
      const st = d.cases.flatMap((c) => c.steps).find((x) => x.call === 'language.writing.submit' && x.expect.ok === true);
      st.expect = { $subset: { ok: true } };
    }, 'answer(s) of the corpus expected nowhere'],
    // slice 4
    ['a quest feedback run\'s locks dropped (a vocabulary step\'s lockedVocabulary)', 'quest-feedback', (d) => {
      const kase = d.cases.find((c) => c.steps.some((x) => x.call === 'language.questFeedback.lockedVocabulary'));
      kase.steps.splice(kase.steps.findIndex((x) => x.call === 'language.questFeedback.lockedVocabulary'), 1);
    }, "not transcribed as core's runner calls their op"],
    ['a lifecycle sync\'s pronunciation objectives expected nowhere (a nested member)', 'quest-feedback', (d) => {
      // Every sync of the pronunciation objectives in the cases that sync them loses that expectation (a nested
      // member of the lifecycle step's `pronunciation`, held by LANGUAGE_NESTED_KEYS alone).
      for (const kase of d.cases.filter((c) => c.name.startsWith('language/quest-feedback run: pronunciation'))) {
        for (const st of kase.steps) if (st.call === 'language.questFeedback.syncLifecycle') delete st.expect.$subset.state.$subset.pronunciationObjectives;
      }
    }, 'lifecycle: pronunciation.objectives)'],
    ['a run\'s recent ids not expected (a reshaped member)', 'quest-feedback', (d) => {
      const kase = d.cases.find((c) => c.name.includes('last twenty'));
      for (const st of kase.steps) {
        const held = st.expect?.$subset?.state?.$subset;
        if (held) delete held.recent;
      }
    }, 'answer(s) of the corpus expected nowhere'],
    ['a quest type table\'s categories not expected (a reshaped member)', 'quest-types', (d) => {
      for (const st of d.cases.flatMap((c) => c.steps)) if (st.call === 'language.questTypes.definition') delete st.expect.definition.$subset.questCategories;
    }, 'answer(s) of the corpus expected nowhere'],
    ['a template\'s parameters not expected (a reshaped member)', 'quest-types', (d) => {
      const st = d.cases.flatMap((c) => c.steps).find((x) => x.call === 'language.questTypes.templatesByCategory');
      for (const t of st.expect.templates) delete t.$subset.parameters;
    }, 'answer(s) of the corpus expected nowhere'],
    ['an answer weakened to a subset (every world\'s quest types)', 'quest-types', (d) => {
      for (const st of d.cases.flatMap((c) => c.steps)) if (st.call === 'language.questTypes.forWorld') st.expect = { $subset: {} };
    }, 'answer(s) of the corpus expected nowhere'],
  ];
  let named = 0;
  for (const [what, file, perturb, want] of perturbations) {
    const doc = read(file);
    perturb(doc);
    const { problems } = languageTranscriptionProblems((base) => (base === file ? doc : read(base)));
    const hit = problems.find((p) => p.startsWith(`core-language-${file}.json`) && p.includes(want));
    console.log(`  ${hit ? 'named' : 'MISSED'}: ${what} -> ${hit ?? problems.join('; ') ?? 'no problem'}`);
    if (hit) named++;
  }
  console.log(`vendor-core-bundle: language transcription negative — ${named} of ${perturbations.length} perturbed transcription(s) named`);
  if (named !== perturbations.length) fail('the language transcription guard missed a perturbation');
}

function loadRefusalCasesOnDisk() {
  const doc = JSON.parse(fs.readFileSync(LOAD_REFUSAL_CASES, 'utf8'));
  return doc.cases.filter((c) => (c.steps ?? []).some((st) => st.call === 'ui.loadRefusal')).length;
}

function extensionKeyProblems(bundleKeys, stated) {
  const problems = [];
  if (stated.length === 0) problems.push('no save.rules step states extensionKeys, so nothing pins the registered extension keys');
  for (const { where, stated: list } of stated) {
    if (!Array.isArray(list) || !list.every((k) => typeof k === 'string')) {
      problems.push(`${where} states extensionKeys as ${JSON.stringify(list)}, not the literal list of names`);
      continue;
    }
    if (JSON.stringify(list) === JSON.stringify(bundleKeys)) continue;
    const missing = bundleKeys.filter((k) => !list.includes(k));
    const extra = list.filter((k) => !bundleKeys.includes(k));
    problems.push(
      `${where} states ${list.length} extension key(s) but the vendored bundle's registry has ${bundleKeys.length}` +
        (missing.length ? `; missing from the case: ${missing.join(', ')}` : '') +
        (extra.length ? `; not registered: ${extra.join(', ')}` : '') +
        (!missing.length && !extra.length ? '; same names, not in sorted order' : ''),
    );
  }
  return problems;
}

/** The top-level keys of `extensionRegistry` in core's src/save-extensions.ts. */
function registryKeysInSource(text) {
  const lines = text.split('\n');
  const start = lines.findIndex((l) => /^export const extensionRegistry\b/.test(l));
  if (start < 0) fail("core's src/save-extensions.ts at the pin declares no `export const extensionRegistry`");
  const keys = [];
  for (let i = start + 1; i < lines.length && !/^};/.test(lines[i]); i++) {
    const m = /^ {2}([A-Za-z_$][\w$]*): \{/.exec(lines[i]);
    if (m) keys.push(m[1]);
  }
  if (keys.length === 0) fail("no key found in core's extensionRegistry at the pin — the reader no longer matches its layout");
  return keys.sort();
}

/** The check `--check` runs; `--check-extension-keys <dir>` runs it alone over another case directory. */
async function checkExtensionKeys(js, dir, coreSrcRoot = null) {
  const bundleKeys = await bundleExtensionKeys(js);
  const stated = statedExtensionKeyLists(dir);
  const problems = extensionKeyProblems(bundleKeys, stated);
  if (coreSrcRoot) {
    const sourceKeys = registryKeysInSource(fs.readFileSync(path.join(coreSrcRoot, 'src', 'save-extensions.ts'), 'utf8'));
    if (JSON.stringify(sourceKeys) !== JSON.stringify(bundleKeys)) {
      problems.push(
        `core's src/save-extensions.ts at the pin registers ${sourceKeys.join(', ')} but the vendored bundle answers ${bundleKeys.join(', ')}`,
      );
    }
  }
  if (problems.length) {
    fail(
      `save.rules extensionKeys drift (${problems.length} problem(s)):\n` +
        problems.map((p) => `  - ${p}`).join('\n') +
        `\n  The vendored bundle registers ${bundleKeys.length}: ${bundleKeys.join(', ')}.\n` +
        '  A core pin that changes the registry must update every save.rules case under corebridge/tests/cases/ ON PURPOSE.',
    );
  }
  return { count: bundleKeys.length, steps: stated.length, fromSource: Boolean(coreSrcRoot) };
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

/** The vendored progression and skill corpus files on disk: the camera set's rule (no other set copies into their folders). */
function progressionFilesOnDisk() {
  return ownDirFilesOnDisk(PROGRESSION_CORPUS_FILES);
}

/** core's P9i progression and skill-tree corpora at the pin, as { 'vendor/core/<path>': Buffer }. */
function progressionFilesAtPin(src) {
  return filesAtPin(src, PROGRESSION_CORPUS_FILES, 'the progression.* and skill.* rows');
}

/** The vendored language corpus files on disk: the camera set's rule (no other set copies into `conformance/language/`). */
function languageFilesOnDisk() {
  return ownDirFilesOnDisk(LANGUAGE_CORPUS_FILES);
}

/** core's P9h language corpora the language.* rows answer, at the pin, as { 'vendor/core/<path>': Buffer }. */
function languageFilesAtPin(src) {
  return filesAtPin(src, LANGUAGE_CORPUS_FILES, 'the language.* rows');
}

/** The vendored P9j genre systems corpora and world slice on disk (their directories are this set's alone). */
function genreFilesOnDisk() {
  return ownDirFilesOnDisk(GENRE_SYSTEMS_CORPUS_FILES);
}

/** core's P9j genre systems corpora and world slice at the pin, as { 'vendor/core/<path>': Buffer }. */
function genreFilesAtPin(src) {
  return filesAtPin(src, GENRE_SYSTEMS_CORPUS_FILES, 'the genre.*, puzzle.*, platformer.*, strategy.* and genrePieces.* rows');
}

/** The vendored pass-by corpus on disk: the camera set's rule (no other set copies into `conformance/villagers/`). */
function passByFilesOnDisk() {
  return ownDirFilesOnDisk(PASS_BY_CORPUS_FILES);
}

/** core's villager pass-by corpus at the pin, as { 'vendor/core/<path>': Buffer }. */
function passByFilesAtPin(src) {
  return filesAtPin(src, PASS_BY_CORPUS_FILES, 'the passBy.* rows');
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

/** core's save corpora (slots, tutorial progress, village state) at the pin, as { 'vendor/core/<path>': Buffer }. */
function savesFilesAtPin(src) {
  return filesAtPin(src, SAVES_CORPUS_FILES, 'the saves.slots, tutorial progress and save.village rows');
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

    // The progression and skill corpora: the same exact-set replacement (only the listed files).
    const progression = progressionFilesAtPin(src);
    for (const rel of progressionFilesOnDisk()) if (!(rel in progression)) fs.rmSync(path.join(BRIDGE, rel));
    for (const [rel, bytes] of Object.entries(progression)) {
      fs.mkdirSync(path.dirname(path.join(BRIDGE, rel)), { recursive: true });
      fs.writeFileSync(path.join(BRIDGE, rel), bytes);
    }

    // The language corpora: the same exact-set replacement (only the listed files).
    const language = languageFilesAtPin(src);
    for (const rel of languageFilesOnDisk()) if (!(rel in language)) fs.rmSync(path.join(BRIDGE, rel));
    for (const [rel, bytes] of Object.entries(language)) {
      fs.mkdirSync(path.dirname(path.join(BRIDGE, rel)), { recursive: true });
      fs.writeFileSync(path.join(BRIDGE, rel), bytes);
    }

    // The genre systems corpora and world slice: the same exact-set replacement (only the listed files).
    const genre = genreFilesAtPin(src);
    for (const rel of genreFilesOnDisk()) if (!(rel in genre)) fs.rmSync(path.join(BRIDGE, rel));
    for (const [rel, bytes] of Object.entries(genre)) {
      fs.mkdirSync(path.dirname(path.join(BRIDGE, rel)), { recursive: true });
      fs.writeFileSync(path.join(BRIDGE, rel), bytes);
    }

    // The villager pass-by corpus: the same exact-set replacement (only the listed file).
    const passBy = passByFilesAtPin(src);
    for (const rel of passByFilesOnDisk()) if (!(rel in passBy)) fs.rmSync(path.join(BRIDGE, rel));
    for (const [rel, bytes] of Object.entries(passBy)) {
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
      progressionCorpus: PROGRESSION_CORPUS_FILES,
      languageCorpus: LANGUAGE_CORPUS_FILES,
      genreSystemsCorpus: GENRE_SYSTEMS_CORPUS_FILES,
      passByCorpus: PASS_BY_CORPUS_FILES,
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
      ...progressionFilesOnDisk(),
      ...languageFilesOnDisk(),
      ...genreFilesOnDisk(),
      ...passByFilesOnDisk(),
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
    console.log(`  progression and skill corpus files (${Object.keys(progression).length}), copied unchanged`);
    console.log(`  language corpus files (${Object.keys(language).length}), copied unchanged`);
    console.log(`  genre systems corpus files and world slice (${Object.keys(genre).length}), copied unchanged`);
    console.log(`  villager pass-by corpus files (${Object.keys(passBy).length}), copied unchanged`);
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
    if (!savesFiles.includes(`vendor/core/${rel}`)) fail(`vendor/core/${rel} is missing — the save-slots, tutorial progress or village save gate would run nothing`);
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
  const progressionFiles = progressionFilesOnDisk();
  for (const rel of PROGRESSION_CORPUS_FILES) {
    if (!progressionFiles.includes(`vendor/core/${rel}`)) fail(`vendor/core/${rel} is missing — the progression corpus gate would run nothing`);
  }
  const languageFiles = languageFilesOnDisk();
  for (const rel of LANGUAGE_CORPUS_FILES) {
    if (!languageFiles.includes(`vendor/core/${rel}`)) fail(`vendor/core/${rel} is missing — the language corpus gate would run nothing`);
  }
  const genreFiles = genreFilesOnDisk();
  for (const rel of GENRE_SYSTEMS_CORPUS_FILES) {
    if (!genreFiles.includes(`vendor/core/${rel}`)) fail(`vendor/core/${rel} is missing — the genre systems corpus gate would run nothing`);
  }
  const passByFiles = passByFilesOnDisk();
  for (const rel of PASS_BY_CORPUS_FILES) {
    if (!passByFiles.includes(`vendor/core/${rel}`)) fail(`vendor/core/${rel} is missing — the villager pass-by corpus gate would run nothing`);
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
    ...progressionFiles,
    ...languageFiles,
    ...genreFiles,
    ...passByFiles,
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
      `${savesFiles.length} saves (slots, tutorial progress, village state), ${propsFiles.length} P6 props/inventory, ${titleFiles.length} P8 title/tutorial, ` +
      `${cameraFiles.length} camera movement, ${audioFiles.length} audio ground, ${survivalFiles.length} survival, ` +
      `${traversalFiles.length} traversal, ${buildFiles.length} headless build, ${progressionFiles.length} progression/skill and ` +
      `${languageFiles.length} language corpus file(s), ${genreFiles.length} genre systems corpus file(s) (the world slice among them), ` +
      `${passByFiles.length} villager pass-by corpus file(s), ` +
      `core ${manifest.coreCommit}, ` +
      `esbuild ${manifest.esbuild})`,
  );
  const keys = await checkExtensionKeys(js, SAVE_RULES_CASES_DIR);
  console.log(
    `vendor-core-bundle: save.rules extensionKeys — the vendored bundle registers ${keys.count}, and all ` +
      `${keys.steps} save.rules step(s) under corebridge/tests/cases/ state exactly that list`,
  );
  const refusalCases = loadRefusalCasesOnDisk();
  if (refusalCases === 0) {
    fail("cases/core-ui-save-slots.json carries no ui.loadRefusal case: core's load_refusals were not transcribed");
  }
  console.log(`vendor-core-bundle: load refusals — cases/core-ui-save-slots.json carries ${refusalCases} ui.loadRefusal case(s)`);
  const village = villageTranscriptionProblems();
  if (village.problems.length) {
    fail(`cases/core-saves-village.json does not transcribe vendor/core/conformance/saves/village-state.json: ${village.problems.join('; ')}`);
  }
  console.log(
    `vendor-core-bundle: village state — cases/core-saves-village.json transcribes all ${village.count} case(s) of ` +
      'conformance/saves/village-state.json, by name and by the calls core\'s runner makes, and its contract',
  );
  const lang = languageTranscriptionProblems();
  if (lang.problems.length) fail(`the language transcription does not hold the vendored language corpora: ${lang.problems.join('; ')}`);
  console.log(
    `vendor-core-bundle: language — cases/core-language-{${lang.files.join(',')}}.json transcribe all ${lang.count} case(s) of ` +
      'the vendored conformance/language/ files, by name, by the calls core\'s runner makes, row for row, and with every answer stated',
  );

  const passByGuard = passByTranscriptionProblems();
  if (passByGuard.problems.length) {
    fail(`cases/${PASS_BY_CASES} does not transcribe vendor/core/conformance/villagers/pass-by.json: ${passByGuard.problems.join('; ')}`);
  }
  console.log(
    `vendor-core-bundle: villager pass-by — cases/${PASS_BY_CASES} transcribes all ${passByGuard.count} case(s) of ` +
      "conformance/villagers/pass-by.json, by name, each one call of its op's row with the case's whole input and answer, and its contract",
  );
  const genreGuard = genreTranscriptionProblems();
  if (genreGuard.problems.length) fail(`the genre transcription does not hold the vendored genre systems corpora: ${genreGuard.problems.join('; ')}`);
  console.log(
    `vendor-core-bundle: genre systems — cases/core-genre-{puzzle-{definition,run,save},platformer-{course,run,save},strategy-{campaign,run,save},genre-pieces-{kinds,build-plan}}.json transcribe all ${genreGuard.count} case(s) of ` +
      "the vendored conformance/{puzzle,platformer,strategy,genre-pieces}/ files, by name, by the calls core's runner makes, C-only exactly where they reach the KB, " +
      'and with every answer stated (the genre pieces each call held in place, args and answer)',
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
      const stated = JSON.parse(fs.readFileSync(path.join(src.root, 'conformance/ui/save-slot-cases.json'), 'utf8')).load_refusals ?? [];
      if (stated.length !== refusalCases) {
        fail(`core ${pin.coreCommit} states ${stated.length} load_refusals; cases/core-ui-save-slots.json carries ${refusalCases}`);
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
      const progression = progressionFilesAtPin(src);
      const wantProgression = Object.keys(progression).sort();
      if (JSON.stringify(wantProgression) !== JSON.stringify(progressionFiles)) {
        fail(`DRIFT: core ${pin.coreCommit}'s progression and skill corpora are ${wantProgression.join(', ')} but vendor/core/ holds ${progressionFiles.join(', ')}`);
      }
      for (const rel of wantProgression) {
        if (!fs.readFileSync(path.join(BRIDGE, rel)).equals(progression[rel])) {
          fail(`DRIFT: corebridge/${rel} is not byte-identical to core ${pin.coreCommit}'s ${rel.slice('vendor/core/'.length)}`);
        }
      }
      const languageAtPin = languageFilesAtPin(src);
      const wantLanguage = Object.keys(languageAtPin).sort();
      if (JSON.stringify(wantLanguage) !== JSON.stringify(languageFiles)) {
        fail(`DRIFT: core ${pin.coreCommit}'s language corpora are ${wantLanguage.join(', ')} but vendor/core/ holds ${languageFiles.join(', ')}`);
      }
      for (const rel of wantLanguage) {
        if (!fs.readFileSync(path.join(BRIDGE, rel)).equals(languageAtPin[rel])) {
          fail(`DRIFT: corebridge/${rel} is not byte-identical to core ${pin.coreCommit}'s ${rel.slice('vendor/core/'.length)}`);
        }
      }
      const genreAtPin = genreFilesAtPin(src);
      const wantGenre = Object.keys(genreAtPin).sort();
      if (JSON.stringify(wantGenre) !== JSON.stringify(genreFiles)) {
        fail(`DRIFT: core ${pin.coreCommit}'s genre systems corpora are ${wantGenre.join(', ')} but vendor/core/ holds ${genreFiles.join(', ')}`);
      }
      for (const rel of wantGenre) {
        if (!fs.readFileSync(path.join(BRIDGE, rel)).equals(genreAtPin[rel])) {
          fail(`DRIFT: corebridge/${rel} is not byte-identical to core ${pin.coreCommit}'s ${rel.slice('vendor/core/'.length)}`);
        }
      }
      const passByAtPin = passByFilesAtPin(src);
      const wantPassBy = Object.keys(passByAtPin).sort();
      if (JSON.stringify(wantPassBy) !== JSON.stringify(passByFiles)) {
        fail(`DRIFT: core ${pin.coreCommit}'s villager pass-by corpus is ${wantPassBy.join(', ')} but vendor/core/ holds ${passByFiles.join(', ')}`);
      }
      for (const rel of wantPassBy) {
        if (!fs.readFileSync(path.join(BRIDGE, rel)).equals(passByAtPin[rel])) {
          fail(`DRIFT: corebridge/${rel} is not byte-identical to core ${pin.coreCommit}'s ${rel.slice('vendor/core/'.length)}`);
        }
      }
      const keysAtPin = await checkExtensionKeys(js, SAVE_RULES_CASES_DIR, src.root);
      console.log(
        `vendor-core-bundle: core ${pin.coreCommit}'s src/save-extensions.ts registers the same ${keysAtPin.count} ` +
          'extension key(s) the vendored bundle answers',
      );
      console.log(
        `vendor-core-bundle: re-bundling and re-deriving at the pin reproduces the bundle, all ${names.length} case file(s), ` +
          `all ${want.length} layout corpus file(s), all ${wantPacks.length} pack corpus/catalog file(s), all ` +
          `${wantP9a.length} P9a corpus file(s), all ${wantSaves.length} save (slots, tutorial progress, village state) corpus file(s), all ` +
          `${wantProps.length} P6 props/inventory corpus file(s), all ${wantTitle.length} P8 title/tutorial ` +
          `corpus file(s), all ${wantCamera.length} camera movement corpus file(s), all ${wantAudio.length} audio ground ` +
          `corpus file(s), all ${wantSurvival.length} survival corpus file(s), all ${wantTraversal.length} traversal ` +
          `corpus file(s), all ${wantBuild.length} headless build corpus file(s), all ${wantProgression.length} progression/skill ` +
          `corpus file(s), all ${wantLanguage.length} language corpus file(s), all ${wantGenre.length} genre systems corpus ` +
          `file(s) (the world slice among them) and all ${wantPassBy.length} villager pass-by corpus file(s) byte for byte`,
      );
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
      src.cleanup();
    }
  } else {
    console.log('vendor-core-bundle: no --core given, so the artifacts were NOT re-derived from core');
  }
}

if (args.includes('--check-language-transcription-negative')) {
  languageTranscriptionNegative();
} else if (args.includes('--check-pass-by-transcription-negative')) {
  passByTranscriptionNegative();
} else if (args.includes('--check-genre-transcription-negative')) {
  genreTranscriptionNegative();
} else if (argValue('--check-extension-keys')) {
  // The save.rules extensionKeys check alone, over another case directory: the
  // core_vendor_extension_keys_negative ctest points it at tests/save-extension-keys-negative/,
  // whose cases drop a key, reorder, add one and loosen the list, and must see each named.
  if (!fs.existsSync(BUNDLE_JS)) fail(`missing vendored artifact ${path.relative(REPO, BUNDLE_JS)}`);
  const keys = await checkExtensionKeys(fs.readFileSync(BUNDLE_JS, 'utf8'), path.resolve(argValue('--check-extension-keys')));
  console.log(`vendor-core-bundle: save.rules extensionKeys — ${keys.steps} step(s) state the bundle's ${keys.count} key(s)`);
} else if (checkOnly) {
  await check(coreArg);
} else if (coreArg) {
  await write(coreArg);
} else {
  fail('usage: vendor-core-bundle.mjs --core <core git checkout> | --check [--core <checkout>] | --check-extension-keys <case dir>');
}
