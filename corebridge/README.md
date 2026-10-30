# `libinsimulcore` — running `@insimul/core` from a native engine

This directory is the answer to the question the whole unification program hung
on: **how does a C++/C#/GDScript engine run 19,000 lines of TypeScript?**

The answer (`RUNTIME_CORE_ADOPTION.md` §4.5) is *not a language*. It is a **C
ABI** — `include/insimulcore.h`, five functions, opaque handle, JSON in, JSON out
— shaped exactly like `libinsimul`'s ABI, which Godot, Unity and Unreal already
consume successfully. Behind that ABI runs core's TypeScript inside an embedded
**QuickJS** today, and a Rust port later if it is ever funded, *without any
adapter noticing the difference*.

Zero lines of core are re-implemented here. TypeScript stays the single
semantics authority.

## Why it is in this repo

It was built in `insimul-godot/gdextension/corebridge/`, because the tasklist
that built it (100) had that repository as its worktree. That was always
temporary. The corollary it recorded is the reason this directory now exists:

> **Do not invent a second mechanism.** If Unity needs core, it P/Invokes
> `libinsimulcore`. If Unreal needs core, it links `libinsimulcore`. The bridge
> is built once, not three times.

A bridge that lives inside one engine's plugin gets forked by the second engine
that needs it. Promoting it here — beside `libinsimul`, built by the same CMake,
packaged by the same `scripts/package.sh` — is what makes "built once" true
rather than aspirational.

**`insimulcore.h` moved byte-for-byte.** It is the contract three engines bind,
and a header that forks between repositories is the exact failure this move
prevents; so the copy here is `diff`-identical to the one in the Godot plugin,
including its closing paragraph about where the bridge "should eventually live".
That paragraph is now satisfied by this very directory, and it will be dropped
when the Godot plugin stops carrying its own copy — which is a change in *that*
repository, with its own tasklist. Leaving both briefly is safer than breaking a
working adapter from outside it.

## The stack

```
engine host              Godot GDScript / Unity C# / Unreal C++
   │  Dictionary → JSON      ← the ONLY place engine types are translated
engine wrapper           e.g. Godot's gdextension/src/insimul_core.{h,cpp}
   │  C ABI                  insimul_core_call(h, "radiant.generate", json)
libinsimulcore           src/insimulcore.c  =  QuickJS + the vendored core bundle
   │  JS → C                 __insimul_prolog_{create,consult,query,destroy},
   │                         __insimul_sha256_hex (core's save-envelope hash)
libinsimul               Trealla, natively linked (../include/insimul.h)
```

Dependencies run one way only: adapters depend on core. Core gains no knowledge
of any engine, and this repository gains no edge into `packages/core` beyond
vendored artifacts (the bundle and the case corpus derived from it, here; the
Prolog and radiant corpora in `../conformance/`).

## Why the Prolog seam is wired to the native engine

Core's `createPrologEngine()` dynamic-imports `WasmPrologEngine`, which
instantiates libinsimul/Trealla compiled to **wasm32**. QuickJS has no
WebAssembly — and even if it did, wrapping a wasm build of an engine this
library already links natively would be absurd.

So the bundler resolves core's `../prolog/prolog-engine` import to
`js/host-prolog-engine.js`, an adapter-owned module implementing the same seam
over libinsimul's C ABI. **Core's source is never patched**; only the resolution
of its seam import changes, which is what a seam is for. The contract amendment
that would make this explicit (an injectable engine rather than a resolver
trick) is `RUNTIME_CORE_ADOPTION.md` §8.

`js/host-prolog-engine.js` therefore has one hard obligation: agree with
`packages/core/src/prolog/wasm-engine.ts` on everything the caller can observe —
`collapseTerm`, the trailing-`.` trim, the 1000-result default. The conformance
corpus is what proves it.

## Layout

| Path | What it is |
|------|------------|
| `include/insimulcore.h` | **The contract.** The one file that must not fork. |
| `src/insimulcore.c` | The QuickJS host: ABI, promise pump, Prolog bridge, the SHA-256 global. |
| `src/insimulcore_sha256.{c,h}` | SHA-256 (FIPS 180-4) for core's save envelope. Internal; not exported. |
| `js/entry.js` | **The method table** — one entry per callable method (below). |
| `js/host-sessions.js` | The session table behind every stateful row (`<area>.create` / `<area>.apply`). |
| `js/host-prolog-engine.js` | Core's Prolog seam, implemented over libinsimul. |
| `js/host-crypto.js` | Core's `crypto` import: `createHash('sha256')` backed by the C host. Anything else throws. |
| `js/host-console.js` | A `console` for QuickJS: records what core logs, prints nothing (`core.diagnostics`). |
| `js/host-text-codec.js` | `TextEncoder`/`TextDecoder` polyfill (byte-for-byte Godot's; core's `identity/kinp.ts` needs one at load). |
| `core-pin.json` | **The input pin**: the core commit and the esbuild version the bundle is built from. |
| `vendor/quickjs/` | QuickJS 2025-04-26, unmodified (see `../THIRD_PARTY.md`). |
| `vendor/core/` | **Generated.** The bundle, its C array, `VENDORED.json` (provenance + sha256 per file) and `cases/` (core's corpora transcribed into bridge cases). Never hand-edit. |
| `tools/vendor-core-bundle.mjs` | Produces `vendor/core/` from the pin, and the `--check` drift guard the `core_vendor` ctest runs. |
| `tools/emit-bridge-cases.mjs` | The transcription of core's corpora into `vendor/core/cases/` (run by the tool above). |
| `tests/cases/` | Hand-written cases for behaviour no core corpus pins yet. |
| `tests/README.md` | The case format and the matcher rules both harnesses implement. |
| `ENGINE_BINDINGS.md` | What each engine's binding must add to use this table. |
| `CMakeLists.txt` | The two targets: `insimulcore` (static) + `insimulcore_shared`. |

## The method table

Every method is `insimul_core_call(core, "<name>", "<args JSON object>")` → a JSON
document, or NULL with `insimul_core_last_error()` set (see "Errors"). `core.methods`
returns the names; the `corebridge_cases_js` gate fails if this table and the
bundle's disagree, and both case harnesses fail if a method has no case.

Status: **adopted** = an engine calls it at runtime today; **feature phase** = added
for the Features Round phase named (the loop's `features/PLAN.md` §3: P1 saves, P2 HUD/notifications/pause, P3 quests, P4 clock and weather, P6 inventory and shops, P7 camera, P8 title, P9 genre systems), no
engine binds it yet; **parity** = exists for an engine's comparison gate, not for a
game; **meta** = about the bridge itself.

<!-- BEGIN METHOD TABLE -->
| Method | Args → result | Core behind it | Status |
|---|---|---|---|
| `core.methods` | `{}` → `{ methods }` (sorted) | — | meta |
| `core.diagnostics` | `{}` → `{ lines: [{ level, text }], dropped }` — what core logged during the previous call | `js/host-console.js` | meta |
| `session.list` | `{}` → `{ sessions: [{ session, kind }] }` | `js/host-sessions.js` | meta |
| `session.dispose` | `{ session }` → `{ disposed }` | `js/host-sessions.js` | meta |
| `radiant.generate` | `{ kb, options: { seed, now, maxQuests? } }` → `{ quests }` | `radiant/radiant-engine` `generateRadiantQuests` | adopted (Godot, Unreal) |
| `radiant.baseTemplates` | `{}` → `{ templates, templateIds }` | `radiant/base-templates` | adopted |
| `quest.hydrate` | `{ content, status? }` → `{ quest }` | `scripts/quest-golden-manifest` `computeHydrationExpected` | parity |
| `quest.radiantTick` | `{ quests, maxOffering, ticks }` → `{ facts }` (a multiset) | `scripts/quest-golden-manifest` `radiantTick` | parity |
| `save.rules` | `{}` → `{ saveFileVersion, envelopeFormat, migrations, extensionKeys }` | `save-file`, `save-file-migrations`, `save-extensions`, `save-envelope` | feature phase P1 |
| `save.integrity` | `{ saveFile }` → `{ integrity }` | `save-envelope` `computeSaveFileIntegrity` | P1 |
| `save.encode` | `{ saveFile, insimulVersion, exportedAt? }` → `{ envelope }` | `save-envelope` `buildSaveFileEnvelope` | P1 |
| `save.decode` | `{ envelope }` or `{ text }` → `{ ok: false, error: { code, message } }` or `{ ok: true, envelope, saveFile, outcome, significant }` | `validateSaveFileEnvelope` then `migrateSaveFileWithOutcome` | P1 |
| `save.migrate` | `{ saveFile }` → `{ saveFile, outcome, significant }` | `save-file` `migrateSaveFileWithOutcome`, unchanged; `significant` = `isMigrationOutcomeSignificant` | P1 |
| `ui.saveSlots` | `{ slots: [{ index, envelope } or { index, outcome }, summary?] }` → `{ slots, hasAnyLoadable }` | `ui/save-slot-model` `SaveSlotModel` | P1 |
| `ui.notifications.create` | `{}` → `{ session, view }` | `ui/notifications` `Notifications` | P2 |
| `ui.notifications.apply` | `{ session, ops: push, tick, dismiss, clear }` → `{ results, view }` | same | P2 |
| `ui.pause.create` | `{ enabledModules? or genre?, tabs? }` → `{ session, source, enabledModules, view }` | `ui/pause-menu-model` `PauseMenuModel`; `genre` via `resolveGenre` | P2 |
| `ui.pause.apply` | `{ session, ops: open, close, toggle, setActive }` → `{ results, view }` | same | P2 |
| `ui.journal.create` | `{ quests?, maxTracked? }` → `{ session, view }` | `ui/quest-journal-model` `QuestJournalModel` (journal, tracker HUD, offer) | P3 |
| `ui.journal.apply` | `{ session, ops: setQuests, upsert, accept, decline, complete, track, untrack, setFilter, get }` → `{ results, view }` | same | P3 |
| `ui.loading.create` | `{ phases?, tips? }` → `{ session, view }` | `ui/loading-screen-model` `LoadingScreenModel` | P8 |
| `ui.loading.apply` | `{ session, ops: advance, reset }` → `{ results, view }` | same | P8 |
| `ui.trade` | `{ state, ops: takeFromContainer, takeAllFromContainer, buy, sell }` → `{ results, state }` | `ui/trade-model` `TradeModel` | P6 |
| `quest.completion.create` | `{ quests? }` → `{ session, view }` | `game-engine/logic/QuestCompletionEngine` | P3 |
| `quest.completion.apply` | `{ session, ops: addQuest, removeQuest, clear, trackEvent, handleGameEvent, completeObjective, trackByTrigger, revealHint, checkTimedObjectives, restoreObjectiveStates }` → `{ results, events, view }` | same | P3 |
| `quest.markers` | `{ quests, npcs?, surface?, activeObjectiveNpcId?, readyToTurnIn? }` → `{ hasActiveQuest, npcs, locations, styles }` | `game-engine/logic/QuestMarkerService` | P3 |
| `quest.minimapMarkers` | `{ quests, resolvedPositions?, namedLocations?, activeObjectiveNpcId? }` → `{ markers }` | `game-engine/logic/QuestMinimapMarkers` `extractObjectiveMarkers` | P2/P3 (minimap) |
| `quest.waypoints` | `{ quest, player, forwardAngle?, buildings?, npcBuildingMap?, npcPositions? }` → `{ waypoints, compass }` | `game-engine/logic/DynamicQuestWaypointDirector` | P2/P3 (compass, waypoints) |
| `clock.create` | `{ msPerGameHour?, startHour?, startMinute?, startDay?, state? }` → `{ session, view }` | `game-engine/logic/GameTimeManager` | P4 |
| `clock.apply` | `{ session, ops: update, advanceHours, setTime, pause, resume, setTimeScale, setMsPerGameHour, restoreState }` → `{ results, events, view }` | same | P4 |
| `weather.climate` | `{ weather, tuning? }` → `{ climate, climateFacts, issues }` | `weather/weather` `climateFromIR`, `weatherIssues`; `weather/weather-facts` | P4 |
| `weather.run` | `{ weather or climate, seed, from, throughDay }` → `{ steps, final }` | `weather/weather` `runWeather`, `weatherView`; `weatherDelta` | P4 |
| `weather.create` | `{ weather, seed?, tuning?, state? }` → `{ session, state, view, issues }` | `game-engine/logic/WeatherDirector` | P4 |
| `weather.apply` | `{ session, ops: advanceTo, impose, restore, publishClimate, publishState }` → `{ results, writes, events, state, view, issues }` | same | P4 |
| `genre.registry` | `{}` → `{ defaultGenre, ids, genres, cameraModes }` | `game-genres/registry` | P9 |
| `genre.resolve` | `{ genre }` → core's `GenreResolution` | `game-genres/resolution` `resolveGenre` | P9 |
| `genre.camera` | `{ value }` → `{ mode }` | `game-genres/resolution` `normalizeCameraMode` | P7 |
| `genre.resolveGame` | `{ recipe?, world? }` → core's `GameGenreResolution` (refusals are errors with a code) | `game-genres/resolution` `resolveGameGenre` | P7/P9 |
| `genre.recipes` | `{}` → `{ ids, bindings }` | `game-genres/recipes` | P9 |
| `modules.activate` | `{ ir }` or `{ genre }` or `{}` → `{ source, active, predicatePacks, hostInterfaces, reason }` | `modules/module-activation` | P9 (Godot's fork has the same row) |
| `modules.table` | `{}` → core's `moduleActivationTable()` | same | P9 |
| `prolog.packs` | `{ areas? }` → `{ packs: [{ area, prolog, runtimePredicates }], order, unknown }` | `prolog/predicate-packs` | P9 |
| `layout.ops` | `{}` → `{ layout, composition }` — core's `LAYOUT_OPS` and `COMPOSITION_OPS` | `editor/layout/corpus`, `editor/layout/composition/corpus` | L.native-layout (U36) |
| `layout.isDoorPartName` | a `conformance/layout/` case's `input` → its `expected` shape | `editor/layout/corpus` `runLayoutOp('isDoorPartName')` | L.native-layout |
| `layout.faceYawOf` | a `conformance/layout/` case's `input` → its `expected` shape | `editor/layout/corpus` `runLayoutOp('faceYawOf')` | L.native-layout |
| `layout.chooseDoorPart` | a `conformance/layout/` case's `input` → its `expected` shape | `editor/layout/corpus` `runLayoutOp('chooseDoorPart')` | L.native-layout |
| `layout.bodyStature` | a `conformance/layout/` case's `input` → its `expected` shape | `editor/layout/corpus` `runLayoutOp('bodyStature')` | L.native-layout |
| `layout.fitBuildingToLot` | a `conformance/layout/` case's `input` → its `expected` shape | `editor/layout/corpus` `runLayoutOp('fitBuildingToLot')` | L.native-layout |
| `layout.findFitOverlaps` | a `conformance/layout/` case's `input` → its `expected` shape | `editor/layout/corpus` `runLayoutOp('findFitOverlaps')` | L.native-layout |
| `layout.settleSeparation` | a `conformance/layout/` case's `input` → its `expected` shape | `editor/layout/corpus` `runLayoutOp('settleSeparation')` | L.native-layout |
| `layout.settleBodies` | a `conformance/layout/` case's `input` → its `expected` shape | `editor/layout/corpus` `runLayoutOp('settleBodies')` | L.native-layout |
| `layout.settleFittedBuildings` | a `conformance/layout/` case's `input` → its `expected` shape | `editor/layout/corpus` `runLayoutOp('settleFittedBuildings')` | L.native-layout |
| `layout.settleClearance` | a `conformance/layout/` case's `input` → its `expected` shape | `editor/layout/corpus` `runLayoutOp('settleClearance')` | L.native-layout |
| `layout.clearancePairGap` | a `conformance/layout/` case's `input` → its `expected` shape | `editor/layout/corpus` `runLayoutOp('clearancePairGap')` | L.native-layout |
| `layout.markerClearance` | a `conformance/layout/` case's `input` → its `expected` shape | `editor/layout/corpus` `runLayoutOp('markerClearance')` | L.native-layout |
| `layout.plantWallClearance` | a `conformance/layout/` case's `input` → its `expected` shape | `editor/layout/corpus` `runLayoutOp('plantWallClearance')` | L.native-layout |
| `layout.settleBuildingMaxShift` | a `conformance/layout/` case's `input` → its `expected` shape | `editor/layout/corpus` `runLayoutOp('settleBuildingMaxShift')` | L.native-layout |
| `layout.pairingSeatSink` | a `conformance/layout/` case's `input` → its `expected` shape | `editor/layout/corpus` `runLayoutOp('pairingSeatSink')` | L.native-layout |
| `layout.layoutObstaclesOf` | a `conformance/layout/` case's `input` → its `expected` shape | `editor/layout/corpus` `runLayoutOp('layoutObstaclesOf')` | L.native-layout |
| `layout.plantTrunkOutline` | a `conformance/layout/` case's `input` → its `expected` shape | `editor/layout/corpus` `runLayoutOp('plantTrunkOutline')` | L.native-layout |
| `layout.layoutConstants` | a `conformance/layout/` case's `input` → its `expected` shape | `editor/layout/corpus` `runLayoutOp('layoutConstants')` | L.native-layout |
| `layout.buildGroundPlan` | a `conformance/layout/` case's `input` → its `expected` shape | `editor/layout/corpus` `runLayoutOp('buildGroundPlan')` | L.native-layout |
| `layout.gradeTerrain` | a `conformance/layout/` case's `input` → its `expected` shape | `editor/layout/corpus` `runLayoutOp('gradeTerrain')` | L.native-layout |
| `layout.followSettledBuildings` | a `conformance/layout/` case's `input` → its `expected` shape | `editor/layout/corpus` `runLayoutOp('followSettledBuildings')` | L.native-layout |
| `layout.pathMouths` | a `conformance/layout/` case's `input` → its `expected` shape | `editor/layout/corpus` `runLayoutOp('pathMouths')` | L.native-layout |
| `layout.lanternsAtPathMouths` | a `conformance/layout/` case's `input` → its `expected` shape | `editor/layout/corpus` `runLayoutOp('lanternsAtPathMouths')` | L.native-layout |
| `layout.keepPlantPropsOffPaving` | a `conformance/layout/` case's `input` → its `expected` shape | `editor/layout/corpus` `runLayoutOp('keepPlantPropsOffPaving')` | L.native-layout |
| `layout.trimGeneratedPoints` | a `conformance/layout/` case's `input` → its `expected` shape | `editor/layout/corpus` `runLayoutOp('trimGeneratedPoints')` | L.native-layout |
| `layout.keepLookNeighbours` | a `conformance/layout/` case's `input` → its `expected` shape | `editor/layout/corpus` `runLayoutOp('keepLookNeighbours')` | L.native-layout |
| `layout.keepStatedRows` | a `conformance/layout/` case's `input` → its `expected` shape | `editor/layout/corpus` `runLayoutOp('keepStatedRows')` | L.native-layout |
| `layout.planDistances` | a `conformance/layout/` case's `input` → its `expected` shape | `editor/layout/corpus` `runLayoutOp('planDistances')` | L.native-layout |
| `layout.margins` | a `conformance/layout/` case's `input` → its `expected` shape | `editor/layout/corpus` `runLayoutOp('margins')` | L.native-layout |
| `layout.readGroundLayers` | a `conformance/layout/` case's `input` → its `expected` shape | `editor/layout/corpus` `runLayoutOp('readGroundLayers')` | L.native-layout |
| `layout.resolveGroundPaint` | a `conformance/layout/` case's `input` → its `expected` shape | `editor/layout/corpus` `runLayoutOp('resolveGroundPaint')` | L.native-layout |
| `layout.groundNoise` | a `conformance/layout/` case's `input` → its `expected` shape | `editor/layout/corpus` `runLayoutOp('groundNoise')` | L.native-layout |
| `layout.groundCoverage` | a `conformance/layout/` case's `input` → its `expected` shape | `editor/layout/corpus` `runLayoutOp('groundCoverage')` | L.native-layout |
| `layout.groundLayerWeights` | a `conformance/layout/` case's `input` → its `expected` shape | `editor/layout/corpus` `runLayoutOp('groundLayerWeights')` | L.native-layout |
| `layout.clump` | a `conformance/layout/` case's `input` → its `expected` shape | `editor/layout/corpus` `runLayoutOp('clump')` | L.native-layout |
| `layout.lookHash01` | a `conformance/layout/` case's `input` → its `expected` shape | `editor/layout/corpus` `runLayoutOp('lookHash01')` | L.native-layout |
| `layout.lookNeighbours` | a `conformance/layout/` case's `input` → its `expected` shape | `editor/layout/corpus` `runLayoutOp('lookNeighbours')` | L.native-layout |
| `layout.lookPropStands` | a `conformance/layout/` case's `input` → its `expected` shape | `editor/layout/corpus` `runLayoutOp('lookPropStands')` | L.native-layout |
| `layout.backdropRing` | a `conformance/layout/` case's `input` → its `expected` shape | `editor/layout/corpus` `runLayoutOp('backdropRing')` | L.native-layout |
| `layout.backdropFrame` | a `conformance/layout/` case's `input` → its `expected` shape | `editor/layout/corpus` `runLayoutOp('backdropFrame')` | L.native-layout |
| `layout.composeLaneNetwork` | a `conformance/layout-composition/` case's `input` (with its `ruleOverrides`) → its `expected` shape | `editor/layout/composition/corpus` `runCompositionOp('composeLaneNetwork')` | L.native-layout |
| `layout.transitionCoverage` | a `conformance/layout-composition/` case's `input` (with its `ruleOverrides`) → its `expected` shape | `editor/layout/composition/corpus` `runCompositionOp('transitionCoverage')` | L.native-layout |
| `layout.edgeBreakup` | a `conformance/layout-composition/` case's `input` (with its `ruleOverrides`) → its `expected` shape | `editor/layout/composition/corpus` `runCompositionOp('edgeBreakup')` | L.native-layout |
| `layout.groundTransitionCoverage` | a `conformance/layout-composition/` case's `input` (with its `ruleOverrides`) → its `expected` shape | `editor/layout/composition/corpus` `runCompositionOp('groundTransitionCoverage')` | L.native-layout |
| `layout.transitionBounds` | a `conformance/layout-composition/` case's `input` (with its `ruleOverrides`) → its `expected` shape | `editor/layout/composition/corpus` `runCompositionOp('transitionBounds')` | L.native-layout |
| `layout.auditGroundEdges` | a `conformance/layout-composition/` case's `input` (with its `ruleOverrides`) → its `expected` shape | `editor/layout/composition/corpus` `runCompositionOp('auditGroundEdges')` | L.native-layout |
| `layout.coverageAudit` | a `conformance/layout-composition/` case's `input` (with its `ruleOverrides`) → its `expected` shape | `editor/layout/composition/corpus` `runCompositionOp('coverageAudit')` | L.native-layout |
| `layout.propPurpose` | a `conformance/layout-composition/` case's `input` (with its `ruleOverrides`) → its `expected` shape | `editor/layout/composition/corpus` `runCompositionOp('propPurpose')` | L.native-layout |
| `layout.groupProps` | a `conformance/layout-composition/` case's `input` (with its `ruleOverrides`) → its `expected` shape | `editor/layout/composition/corpus` `runCompositionOp('groupProps')` | L.native-layout |
| `layout.auditPropGroups` | a `conformance/layout-composition/` case's `input` (with its `ruleOverrides`) → its `expected` shape | `editor/layout/composition/corpus` `runCompositionOp('auditPropGroups')` | L.native-layout |
| `layout.trimFloraOffSquare` | a `conformance/layout-composition/` case's `input` (with its `ruleOverrides`) → its `expected` shape | `editor/layout/composition/corpus` `runCompositionOp('trimFloraOffSquare')` | L.native-layout |
| `layout.yardRole` | a `conformance/layout-composition/` case's `input` (with its `ruleOverrides`) → its `expected` shape | `editor/layout/composition/corpus` `runCompositionOp('yardRole')` | L.native-layout |
| `layout.composeYards` | a `conformance/layout-composition/` case's `input` (with its `ruleOverrides`) → its `expected` shape | `editor/layout/composition/corpus` `runCompositionOp('composeYards')` | L.native-layout |
| `layout.lanternsOnRoutes` | a `conformance/layout-composition/` case's `input` (with its `ruleOverrides`) → its `expected` shape | `editor/layout/composition/corpus` `runCompositionOp('lanternsOnRoutes')` | L.native-layout |
| `layout.foliageKind` | a `conformance/layout-composition/` case's `input` (with its `ruleOverrides`) → its `expected` shape | `editor/layout/composition/corpus` `runCompositionOp('foliageKind')` | L.native-layout |
| `layout.composeFoliage` | a `conformance/layout-composition/` case's `input` (with its `ruleOverrides`) → its `expected` shape | `editor/layout/composition/corpus` `runCompositionOp('composeFoliage')` | L.native-layout |
| `layout.auditFoliageSpacing` | a `conformance/layout-composition/` case's `input` (with its `ruleOverrides`) → its `expected` shape | `editor/layout/composition/corpus` `runCompositionOp('auditFoliageSpacing')` | L.native-layout |
| `layout.assignHouseModels` | a `conformance/layout-composition/` case's `input` (with its `ruleOverrides`) → its `expected` shape | `editor/layout/composition/corpus` `runCompositionOp('assignHouseModels')` | L.native-layout |
| `layout.seatCapacity` | a `conformance/layout-composition/` case's `input` (with its `ruleOverrides`) → its `expected` shape | `editor/layout/composition/corpus` `runCompositionOp('seatCapacity')` | L.native-layout |
| `layout.seatVillagers` | a `conformance/layout-composition/` case's `input` (with its `ruleOverrides`) → its `expected` shape | `editor/layout/composition/corpus` `runCompositionOp('seatVillagers')` | L.native-layout |
| `layout.keepClearOfProps` | a `conformance/layout-composition/` case's `input` (with its `ruleOverrides`) → its `expected` shape | `editor/layout/composition/corpus` `runCompositionOp('keepClearOfProps')` | L.native-layout |
| `layout.composeVillage` | a `conformance/layout-composition/` case's `input` (with its `ruleOverrides`) → its `expected` shape | `editor/layout/composition/corpus` `runCompositionOp('composeVillage')` | L.native-layout |
<!-- END METHOD TABLE -->

Each row's comment in `js/entry.js` gives the exact argument and result fields.
A row DECIDES nothing: it builds what core takes from JSON (a Map, a callback),
checks at the boundary the enumerations core's TypeScript types declare but JSON
cannot (a notification kind, a quest status, a slot outcome, a marker surface),
and hands core's answer back. One place does more, and says so in its comment:

- `weather.run` steps core's pure functions exactly as core's
  `scripts/emit-weather-progression-corpus.ts` does (that script writes files at
  import, so it cannot be bundled).

### The layout rows (L.native-layout, ruling U36)

Core's village-layout rules (`src/editor/layout/`: building fit, settle, the
ground plan and its paint, the backdrop; and `composition/`: the lane network,
transitions, prop grouping, yards, lanterns, foliage, house variety, seating,
reach, the composed village) are one row each, `layout.<op>`, for every op core's
two corpus runners declare (`LAYOUT_OPS`, `COMPOSITION_OPS`). A row is core's
own JSON boundary and nothing else: `runLayoutOp(op, args)` or
`runCompositionOp(op, args)` (core's `DEFAULT_COMPOSITION_RULES`, with the
input's `ruleOverrides` applied by core). So **the args are a corpus case's
`input` and the answer is in its `expected` shape**, `-0` already written as
`0`. A caller resolves a case's `{"$fixture": …}` references before sending;
the rows never see a fixture.

The evidence is core's own corpus, not a transcription: `vendor/core/conformance/
layout/` and `layout-composition/` are core's files at the pin, copied byte for
byte by `tools/vendor-core-bundle.mjs` and hashed in `VENDORED.json`
(`core_vendor`; `--check --core` byte-compares them with core). The
`layout_corpus` ctest (`tests/layout_corpus.cpp`) runs every case through
`insimulcore.h` and compares by the corpus's rule (the case's tolerance or the
file's, `angleKeys` round the circle, exact keys). It also fails when a row is
named by no case, when core declares an op that is not a row (`layout.ops`), and
when its comparator cannot fail; `layout_corpus_negative` runs it over a
deliberately wrong one-case file (`tests/layout-negative/`) and must fail. The
two case harnesses therefore do not require a case per `layout.*` row.

**What Unreal's binding will call (L.portable-binding, a later row on the 36 GB
Mac).** Unreal's `Portable/` layout code (`InsimulVillageLayout`,
`InsimulBuildingFit`, …; ~3,700 lines held by the same corpus under U36) shrinks
to a binding that builds each op's corpus-shaped input from its scene and calls
`insimul_core_call(core, "layout.<op>", input)`. Its `layout_corpus_ops.h` table
maps one-to-one onto these rows (the op names are the corpus's), so its host
suite's `layout_conformance` can run the same files through this library
instead of `Portable/`. The calls a placement pass makes, in order: `layout.fitBuildingToLot`
per building (or `layout.composeVillage` for the composed village), then
`layout.settleFittedBuildings` / `layout.settleBodies` / `layout.settleClearance`,
`layout.buildGroundPlan`, `layout.gradeTerrain`, `layout.followSettledBuildings`,
the paint (`layout.readGroundLayers`, `layout.resolveGroundPaint`,
`layout.groundLayerWeights`), the prop passes (`layout.keepPlantPropsOffPaving`,
`layout.trimGeneratedPoints`, `layout.lanternsAtPathMouths`, …) and the backdrop
(`layout.backdropRing`, `layout.backdropFrame`). The binding owns only the scene
reads and writes; every number it places comes back from a row.

**Cost.** Under QuickJS the whole corpus (427 cases) takes about 11 s on this
repo's 2026-10-29 build host, nearly all of it `ground-plan.json` (≈ 9.4 s) and
`settle.json` (≈ 1.1 s), every other file under 0.2 s; `gradeTerrain` at core's cap (2,049² heights) is the largest call, and it
is what sized the JS heap cap (`INSIMULCORE_JS_MEMORY_LIMIT`, 192 MiB,
`src/insimulcore.c`). A game calls these at authoring or load time, never per
frame.

`save.decode` / `save.migrate` return core's `migrateSaveFileWithOutcome` outcome
exactly as core answers it. At the pin core declares `orphanExtensionKeys` and
`droppedFacts` but leaves both empty ("populated by … sibling stories"; when a
migration step runs, core's `migrateExtensions` only logs an orphan key, which
`core.diagnostics` shows), so
the rows report them empty and an unregistered key does not by itself make an
outcome `significant`. Filling them is core work with a core corpus case; the
bridge picks it up by re-pinning, and no binding (Babylon's included) fills them
itself.

### What the feature phases asked for and core does not have yet

Exposed "as core has them" — so a few UI view-models in the brief are not rows,
because there is nothing in core at the pinned commit to expose: **no HUD
view-model** (the HUD shell composes `ui.notifications`, `ui.journal`'s tracker,
`quest.waypoints`' compass and the clock), **no inventory panel view-model** (the
inventory is `ItemLedger`, a Prolog-backed decision layer for P6, not a view;
`ui.trade` is the container/merchant transfer model core has), and **no
minimap view-model** beyond the two marker functions (`quest.minimapMarkers`,
`quest.markers` with `surface: "minimap"`). The Features Round plan (§1) lists compass, minimap
and inventory view-models as core work; when they land, they are rows here.

## Sessions

A stateful core object lives in the handle's JS heap and the host holds an
integer (`js/host-sessions.js`):

- `<area>.create {…}` returns `{ session, … }`. Handles count from 1 per
  `insimul_core` handle, in order, never reused.
- `<area>.apply { session, ops: [{ op, … }, …] }` runs the ops in order — one
  result per op in `results` (null for a void op) — then reports the model's
  `view` once. Batch everything one game event causes into one call.
- An op that throws stops the batch; earlier ops' effects are KEPT (core's models
  mutate in place and have no undo), and the error names the op's index.
- A handle of the wrong kind is refused by name; `session.dispose` releases one
  (idempotent); `session.list` shows what is open — a leak in a game is growth here.
- `events` (quest completion, clock, weather) are what core's callbacks or event
  bus reported during THIS call's ops, in order. `writes` (weather) are the KB
  writes core made through its engine seam, in order — the game's KB lives on
  the host's side of the ABI, so the host applies them there verbatim.

## Errors

The ABI's rule is unchanged: NULL and `insimul_core_last_error()`. What the text
looks like is now part of the contract:

- every failure reads `insimulcore: <ErrorName>: <message>`;
- a caller error found at the boundary reads `insimulcore: Error: insimulcore:
  <method>: <what was wrong>` (an op failure: `… <method>: ops[<i>] (<op>)
  failed: …`);
- **a refusal core raises with a machine-readable code** (`GenreResolutionError`,
  and any op failure wrapping one) reads `insimulcore: <ErrorName>: [<code>]
  <message>` — a host reads the code between the brackets and never parses prose;
- arguments must be a JSON object (or NULL / empty, meaning `{}`).

A domain outcome is not an error: a save slot that does not load is
`{ ok: false, error: { code, message } }` from `save.decode`, a refused trade is
`{ ok: false, reason }`, a marker that does not show is `kind: null`.

## Building

There is nothing special to do — `libinsimulcore` builds with everything else:

```sh
cmake -B build && cmake --build build && ctest --test-dir build
```

Artifacts land beside `libinsimul`'s, in the top-level build directory:
`build/libinsimulcore.a` and `build/libinsimulcore.dylib` (`.so` / `.dll`
elsewhere). `scripts/package.sh` copies the shared one and `insimulcore.h` into
`dist/<platform>/` — see `../docs/consuming.md` for the GDExtension, P/Invoke and
Unreal-module linkage recipes.

The shared library **static-links `libinsimul`**, so it loads on its own with no
rpath dance. That is safe precisely because the two ABIs share no state: no
`insimul_kb` handle ever crosses `insimulcore.h`.

It is **not** built for wasm (`cmake/wasm.cmake` returns before this directory is
added). A browser host runs `@insimul/core` as the TypeScript it already is;
compiling a JS engine to wasm in order to run JS would be circular.

## The gates

| ctest | What it proves |
|---|---|
| `corebridge_smoke` | the library boots, the version stamp names both pins, the table holds every row this file documents |
| `corebridge_cases` | **every method, from C**: all case files on a fresh handle per case, through `insimulcore.h` (QuickJS, the C SHA-256, the native Prolog seam) |
| `corebridge_cases_js` | the same cases with the same bundle in Node (V8, Node's crypto); also that this README's table equals `core.methods` |
| `corebridge_cases_parity` | the C and JS legs' RAW result strings are byte-identical for every step |
| `corebridge_sha256` | the C SHA-256 against the NIST vectors, at every split point |
| `corebridge_radiant`, `corebridge_radiant_none` | the radiant corpus through core's real radiant engine on the native Prolog engine |
| `core_vendor` | every vendored file matches its recorded sha256 and the pin |

The cases come from two places (`tests/README.md`): `vendor/core/cases/` is core's
OWN corpora (saves, the UI matrices, weather progression, genre resolution,
recipes, module activation, quest goldens), transcribed at the pinned commit by
`tools/emit-bridge-cases.mjs` — expectations core committed, not ones this repo
computed — and `tests/cases/` is hand-written for what no core corpus pins yet
(notifications, quest completion, markers, waypoints and the compass, the clock,
weather sessions, the codec round trip, sessions and errors).

## Adopting more of core

1. Add a row to `js/entry.js` and to the table above.
2. Re-vendor from any `@insimul/core` checkout that has the pinned commit and an
   installed `node_modules` (`npm install` in it); which commit it has checked
   out does not matter — the tool reads the pin with `git archive`:
   ```sh
   node corebridge/tools/vendor-core-bundle.mjs --core <core checkout>
   ```
   To move core, change `coreCommit` (a full id) in `core-pin.json` first; to move
   the bundler, `esbuild` (the tool refuses any other installed version).
3. Add cases: transcribe the area's core corpus in `tools/emit-bridge-cases.mjs`
   if core has one, hand-write them in `tests/cases/` if it does not.
4. Rebuild; `ctest -R corebridge`.

The bundle is a **checked-in build artifact**, not a build step, because this
repository is standalone by design — it cannot run a bundler against a package it
does not contain. `--check` (the `core_vendor` ctest) verifies a sha256 per file
over the generated artifacts AND their inputs (`js/*.js`, the emitter, the pin),
so an adapter edit that was never re-vendored is caught. Only `--check --core`
re-bundles and re-derives the cases at the pin and diffs them byte for byte —
the reproducibility check:

```sh
node corebridge/tools/vendor-core-bundle.mjs --check --core <core checkout>
```

## Limits worth knowing

- **Nothing per-frame crosses this boundary.** Every call is a JSON round trip.
  Core is the decision layer; rendering, input and physics stay engine-side. The
  clock in particular: send `clock.apply { ops: [{ op: "update", deltaMs }] }` at
  event rate (a fraction of a second is plenty) with the real time since the last
  one, never once a frame; core accrues minutes from any delta.
- **`insimul_core_call` is synchronous**, driving the JS job queue until the
  promise settles. Every promise in the adopted surface is resolved by JS or by
  a synchronous C call. A method that awaits real I/O would need a pump driven
  from the host's frame loop — the ABI would not change.
- **One handle, one thread**, exactly like an `insimul_kb`.
- **No keepalive KB** is held any more: libinsimul fixed the create/destroy-cycle
  defect inside itself (top-level `CLAUDE.md`, "Create/destroy CYCLE hangs").
- **Wall clock**: `quest.completion.apply`'s `checkTimedObjectives` reads
  `Date.now()` (objectives' `startedAt` is epoch milliseconds), and `save.encode`
  without `exportedAt` stamps the current time. Everything else is a function of
  its arguments.
