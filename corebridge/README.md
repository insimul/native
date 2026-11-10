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
| `vendor/core/` | **Generated.** The bundle, its C array, `VENDORED.json` (provenance + sha256 per file), `cases/` (core's corpora transcribed into bridge cases), and core's layout corpora, pack-composition corpus, pack catalog and P9a corpora (`conformance/`, `packs/`) copied byte for byte. Never hand-edit. |
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
| `saves.slots.create` | `{ config?, slots?: [{ index, outcome, summary? }], activeSlot? }` → `{ session, config, view }` (`config` as core resolved it) | `save-slots` `SaveSlotsSession` (`resolveSaveSlotsConfig`) | P1 slots (PL.native-catchup; core's P1.core-slots, U83(1)) |
| `saves.slots.apply` | `{ session, ops: save, load, continue, delete, ask_delete, confirm_delete, cancel_delete, key, tick, finished, disk_changed }` → `{ results: [{ ok, refusal?, outcome?, effect, history?, disk? }], view }` | same | P1 slots |
| `props.contract` | `{}` → `{ <area>: { <table>: value } }` — the data tables each P6 corpus file's `contract` states (`props-containers`, `props-documents`, `props-notice-board`, `props-doors`, `ui-inventory`, `props-pickup-placement`, `props-interactables`) | `props/containers`, `props/documents`, `props/doors`, `props/notice-board`, `ui/inventory-model`, `props/pickup-placement`, `props/interactables` constants | P6 (PL.native-props-rows, U89(2); `props-pickup-placement` PL.native-pickup-settle, U91(2); `props-interactables` PL.native-interact-target, U94(3)) |
| `props.containers.view` | `{ container, context?: { playerItemIds?, buildings?, now? } }` → `{ view }` | `props/containers` `containerView` | P6 |
| `props.containers.unlock` | `{ container, context? }` → `{ result, container }` | `props/containers` `unlockContainer` | P6 |
| `props.containers.move` | `{ container, move: { kind: take } or { kind: put, itemId }, context? }` → `{ refusal }` (null: `ui.trade` may run it) | `props/containers` `containerMoveRefusal` | P6 |
| `props.containers.at` | `{ containers, location: { businessId?, residenceId?, lotId? } }` → `{ ids }` | `props/containers` `containersAtLocation` | P6 |
| `props.containers.respawn` | `{ container, now }` → `{ due }` | `props/containers` `containerRespawnDue` | P6 |
| `props.documents.document` | `{ document, options?: { charsPerPage? } }` → `{ ok: true, document }` or the refusal value `{ ok: false, refusal: { code, field } }` | `props/documents` `documentOf` | P6 |
| `props.documents.paginate` | `{ text, charsPerPage? }` → `{ pages }` | `props/documents` `paginateText` | P6 |
| `props.reader.create` | `{ document, options?, open?: { alreadyRead?, alreadyAnswered? } }` → `{ ok: true, session, document, view }`, or `documentOf`'s refusal value and no session | `props/documents` `DocumentReader` | P6 |
| `props.reader.apply` | `{ session, ops: next, prev, answer, close }` (every op goes to core; an unknown one is its `unknown_action`) → `{ results: [{ ok, events } or { ok: false, refusal }], view }` | same | P6 |
| `props.doors.door` | `{ building }` → `{ door: { id, state, doorAt, outside, label, interiorFunction } }` | `props/doors` `doorView` | P6 |
| `props.doors.prompt` | `{ buildings, player: { position, inside? } }` → `{ prompt }` (null when nothing prompts) | `props/doors` `doorPrompt` | P6 |
| `props.doors.step` | `{ buildings, inside?, playerItemIds?, action: { op: enter, building } or { op: exit } }` → `{ ok: true, handoff, inside }` or the refusal value | `props/doors` `doorStep` | P6 |
| `props.board.create` | `{ notices, fluency?, read?, answered?, questStatus? }` → `{ session, view }` | `props/notice-board` `NoticeBoard` | P6 |
| `props.board.apply` | `{ session, ops: select, answer, take_quest }` (every op goes to core) → `{ results, view }` | same | P6 |
| `props.notices.generate` | `{ settlementId, settlementName, npcs: [{ characterId, name, occupation? }] }` → `{ articles }` | `game-engine/logic/NoticeGenerator` `generateSettlementNotices` | P6 |
| `props.pickups.settle` | `{ spot, groundY?, settled?, obstacles?, roads?, walkable?, clearance?, search? }` → `{ ok: true, at, moved, shiftM, ring, clearanceM, nearest, authored, approach }`, or the refusal value `{ ok: false, code: no-clear-spot, clearest, authored, approach }` or `{ ok: false, code: bad-spot }` | `props/pickup-placement` `settlePickup` | P6 pick-up settle (PL.native-pickup-settle, U91(2); core's PL.pickup-placement, U89(3)) |
| `props.pickups.sequence` | `{ pickups: [{ spot, groundY? }], obstacles?, roads?, walkable?, clearance?, search? }` → `{ placements }` | `props/pickup-placement` `settlePickups` | P6 pick-up settle |
| `props.pickups.clearance` | `{ spot, groundY?, settled?, obstacles?, roads?, clearance? }` → `{ ok: true, clearanceM, nearest }` or `{ ok: false, code: bad-spot }` | `props/pickup-placement` `pickupClearance` | P6 pick-up settle |
| `props.pickups.pattern` | `{ search? }` → `{ rings: [{ radiusM, points }] }` | `props/pickup-placement` `pickupSearchPattern` | P6 pick-up settle |
| `props.pickups.ring` | `{ ring, search? }` → `{ points: [{ x, z }] }` | `props/pickup-placement` `pickupSearchRing` | P6 pick-up settle |
| `props.interactables.target` | `{ at, panel?, villager?, pickups?, containers?, buildings?, props?, board?, ranges? }` → `{ ok: true, target: { action, kind, id, prompt, distance } or null }`, or the refusal value `{ ok: false, refusal: { code: bad_position, field: at } }` | `props/interactables` `interactTarget` | P8 interact (PL.native-interact-target, U94(3); core's PL.examine-props, U49(3)) |
| `props.interactables.interact` | `{ prop, board? }` → `{ ok: true, action, line, events }`, or the refusal value `{ ok: false, refusal: { code: not_offered, field: archetype, reason } }` | `props/interactables` `interactWithProp` | P8 interact |
| `props.interactables.meaning` | `{ prop, board? }` → `{ id, action, noun, prompt, text }` or `{ id, action: null, reason }` | `props/interactables` `propInteraction` | P8 interact |
| `props.interactables.host` | `{ props, settlement }` → `{ host }` (null: no board) | `props/interactables` `noticeBoardHost` | P8 interact |
| `props.interactables.noun` | `{ archetype }` → `{ noun }` | `props/interactables` `propNoun` | P8 interact |
| `inventory.create` | `{ player?: { gold, inventory } }` → `{ session, view: { filter, counts, gold, rows, equipment, save } }` | `ui/inventory-model` `InventoryViewModel` | P6 |
| `inventory.apply` | `{ session, ops: add, remove, filter, toggle, set_gold, add_gold, remove_gold, equip_flag, get, items, load, clear }` → `{ results, view }` | same | P6 |
| `ui.notifications.create` | `{}` → `{ session, view }` | `ui/notifications` `Notifications` | P2 |
| `ui.notifications.apply` | `{ session, ops: push, tick, dismiss, clear }` → `{ results, view }` | same | P2 |
| `ui.pause.create` | `{ enabledModules? or genre?, tabs? }` → `{ session, source, enabledModules, view }` | `ui/pause-menu-model` `PauseMenuModel`; `genre` via `resolveGenre` | P2 |
| `ui.pause.apply` | `{ session, ops: open, close, toggle, setActive }` → `{ results, view }` | same | P2 |
| `ui.journal.create` | `{ quests?, maxTracked? }` → `{ session, view }` | `ui/quest-journal-model` `QuestJournalModel` (journal, tracker HUD, offer) | P3 |
| `ui.journal.apply` | `{ session, ops: setQuests, upsert, accept, decline, complete, track, untrack, setFilter, get }` → `{ results, view }` | same | P3 |
| `ui.loading.create` | `{ phases?, tips? }` → `{ session, view }` | `ui/loading-screen-model` `LoadingScreenModel` | P8 |
| `ui.loading.apply` | `{ session, ops: advance, reset }` → `{ results, view }` | same | P8 |
| `ui.titleFlow.contract` | `{}` → `{ 'ui-title-flow': { entries, labels, messages, slotMessages, defaultTitle, defaultSlotCount, ops, steps } }` | `ui/title-flow` constants (`TITLE_ENTRIES`, …), `save-slots` `SAVE_SLOTS_DEFAULTS`, `ui/title-flow-corpus` ops and steps | P8 title (PL.native-title-rows, U92(1)) |
| `ui.titleFlow.create` | `{ menu?, savesSession? }` (`menu` core's `TitleFlowInput`, read by core; `savesSession` an open `saves.slots` session the menu reads live) → `{ session, view }` | `ui/title-flow` `titleMenu` | P8 title |
| `ui.titleFlow.apply` | `{ session, ops: choose, set }` → `{ results: [TitleChoice or null], view }`; a refusal (`busy`, `nothing_to_continue`, `no_saves`, `not_shown`, `unknown_entry`) is a VALUE | `ui/title-flow` `chooseTitleEntry`, `titleMenu` | P8 title |
| `ui.tutorial.contract` | `{}` → `{ 'quests-tutorial': { objectives, assessmentObjective, flows, ops, runSteps, onboardingSteps, t0 } }` | `TutorialQuestSystem` / `OnboardingManager` constants, `quests/tutorial-corpus` ops, steps and clock | P8 onboarding |
| `ui.tutorial.objectives` | `{ includeAssessment?, bindings? or unbind?, rebind?, bind? }` → `{ objectives }` | `TutorialQuestSystem` `buildTutorialObjectives` (`corpusBindings` for the changes) | P8 onboarding |
| `ui.tutorial.create` | `{ config?, now? }` → `{ session, title, description, objectives, events, view }` | `game-engine/logic/TutorialQuestSystem` over the session's own `GameEventBus`; view `tutorialStateJson` | P8 onboarding |
| `ui.tutorial.apply` | `{ session, ops: start, event, complete, completeById, skip, skipNonAssessment, tick, dispose }` → `{ results: [{ result, events }], view }` | same | P8 onboarding |
| `ui.onboarding.create` | `{ definition?, options?, now? }` → `{ session, totalSteps, view: { current, isComplete } }` | `game-engine/logic/OnboardingManager` | P8 onboarding |
| `ui.onboarding.apply` | `{ session, ops: start, complete, skip, event, tick, inspect, state }` → `{ results: [{ result, calls, events }], totalSteps, view }` | same (`getState` for `state`) | P8 onboarding |
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
| `ui.genreHud` | `{ op: config, view, genre_view, config_of or view_of, ...input }` (a `conformance/ui/genre-hud-cases.json` case's `op` and `input`; `config_of` / `view_of` take a game's own settings, `{ genreConfig }` or `{ recipe, world? }`, plus `state?` for `view_of`) → its `expected` shape: `{ ok: true, value }` or a refusal VALUE `{ ok: false, refusal: { code, field } }` (`unresolved_recipe` also carries `reason`); an unknown `op` is an error `[unknown-op]` | `ui/genre-hud-corpus` `runGenreHudOp` (`genre-hud-model`, `genreHudConfigOf`; `game-genres/resolution` `resolveGameGenre` for a recipe) | P9a.native (U84); `config_of` / `view_of` PL.native-genre-hud-config (U92(2)) |
| `ui.rulesPanel` | `{ op: panel, card, byCategory, byType or isActive, ...input }` (a `conformance/ui/rules-panel-cases.json` case's `op` and `input`) → its `expected` shape; an unknown `op` is an error `[unknown-op]`, an input of the wrong JSON type `[invalid-input]` | `ui/rules-panel-corpus` `runRulesPanelOp` (`rules-panel-model`) | P9a.native (U84) |
| `packs.compose` | `{ recipe?, world?, game?, engine?, catalog: { index, manifests } }` → core's `Composition` (packs, settings, activation, overrides; a refused choice is a `refusals` entry; a refused recipe, preset, request or engine is an error with a code) | `system-packs/composer` `resolveComposition` | SP.composer-native (U62(1)) |
| `modules.activate` | `{ ir }` or `{ genre }` or `{}` → `{ source, active, predicatePacks, hostInterfaces, reason }` | `modules/module-activation` | P9 (Godot's fork has the same row) |
| `modules.table` | `{}` → core's `moduleActivationTable()` | same | P9 |
| `prolog.packs` | `{ areas? }` → `{ packs: [{ area, prolog, runtimePredicates }], order, unknown }` | `prolog/predicate-packs` | P9 |
| `mechanics.run` | `{ ir: { meta: { genreConfig, enabledModules? }, routines? }, seed, steps }` (a `conformance/modules/mechanic-runtime.json` case's `input`) → `{ plan, steps, events }`; an IR without a `meta.genreConfig.id`, a seed or a step of the wrong JSON type is an error `[invalid-input]`, a step op core's runner does not apply `[unknown-op]`; `meta.enabledModules` goes to core unchecked (not an array: the genre decides, as `modules.activate` answers) | `game-engine/mechanic-runtime-corpus` `runMechanicRuntimeCase` over `game-engine/mechanic-runtime` `createMechanicRuntime` | P9a.native (U84) |
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
| `layout.startClearOutline` | a `conformance/layout/` case's `input` → its `expected` shape | `editor/layout/corpus` `runLayoutOp('startClearOutline')` | P9a.native (core's PL.start-clearance, U78) |
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

### The packs.compose row (SP.composer-native, rulings U62(1) and U79(4))

Core's composer (`src/system-packs/composer.ts`, SP.composer) is one row,
`packs.compose`: `resolveComposition(request, catalog)`, nothing else. The args
are a `conformance/packs/composition.json` case's `input` (`recipe`, `world`,
`game`, `engine`) with `catalog` beside it — `{ index, manifests }`, core's
`packs/index.json` and each `packs/<id>/pack.json` as JSON, the files that
corpus's own `catalog` names. Every key but `catalog` is the request and goes to
core unchanged; the row checks only the catalog's JSON shape. The answer is
core's `Composition`: the packs (with their source, variant, style, parameters
and whether they run), the genre settings and activation the game runs with, the
overrides the composer wrote, and every choice it refused (`refusals`, with
core's code). A recipe, preset, request or engine core cannot compose is an
error: `CompositionError: [<code>]` (`invalid-request`, `invalid-preset`,
`preset-drift`, `unknown-engine`) or `GenreResolutionError: [<code>]`.

The library carries no catalog of its own: an engine sends the one it vendored
from core at this library's pin (Unreal's re-vendor of `packs/` and
`conformance/packs/` is SP.composer-unreal part 2). The evidence is core's corpus,
not a transcription: `vendor/core/conformance/packs/composition.json` and the
catalog files it names, at their core paths under `vendor/core/`, copied byte for
byte by `tools/vendor-core-bundle.mjs` and hashed in `VENDORED.json`
(`core_vendor`; `--check --core` byte-compares them with core). The `packs_corpus`
ctest (`tests/packs_corpus.cpp`) sends every case through `insimulcore.h` and
holds it to core's replay rule (the exact answer, or core's code in last_error);
`packs_corpus_negative` must see it fail a wrong answer and a wrong code. The
hand cases in `tests/cases/bridge-packs.json` pin the row's own contract (the
catalog checks, the pass-through, a refusal as a value, the error codes).

**Cost.** The composer imports `system-packs/schema`, which builds core's zod
schemas at module scope, so the bundle now carries `zod` (3.25.76, MIT;
`npmModules` in `VENDORED.json`, a NOTICE stanza): at the b38e60d pin the bundle
grew from 819,818 to 988,816 bytes, of which zod is 129,138 and the composer and
schema 37,715. The 34 corpus cases take about 35 ms under QuickJS.

`save.decode` / `save.migrate` return core's `migrateSaveFileWithOutcome` outcome
exactly as core answers it. At the pin core declares `orphanExtensionKeys` and
`droppedFacts` but leaves both empty ("populated by … sibling stories"; when a
migration step runs, core's `migrateExtensions` only logs an orphan key, which
`core.diagnostics` shows), so
the rows report them empty and an unregistered key does not by itself make an
outcome `significant`. Filling them is core work with a core corpus case; the
bridge picks it up by re-pinning, and no binding (Babylon's included) fills them
itself.

### The P9a rows: the genre HUD, the rules panel, the mechanic runtime (P9a.native, U84)

Three of core's P9a corpus runners are rows, each core's own JSON boundary and
nothing else, as the layout rows are:

- **`ui.genreHud { op, ...input }`** is `runGenreHudOp(op, input)`: `config {
  genre }` (the registry entry's HUD config), `view { config, state? }` (core's
  `genreHudView`: which base HUD parts show and the genre's own elements, text
  and tone formatted by core) and `genre_view { genre, state? }`; and, for a
  game's OWN settings rather than a registry id (PL.native-genre-hud-config,
  U92(2)), `config_of { genreConfig }` (a world's `meta.genreConfig` as stated,
  any genre id, projected by core's `genreHudConfigOf`: the fighting HUD for the
  fighting camera or combat style, else `uiLayout`; an absent flag stays absent)
  or `config_of { recipe, world? }` (core's `resolveGameGenre`, then the
  projection of its `config`), and `view_of { …the same, state? }`, that
  projection composed with `view`. Refusal values: `no_genre_source`,
  `two_genre_sources`, `not_a_genre_config`, `world_without_recipe`,
  `unresolved_recipe` (with `reason`, core's `GenreResolutionError` code) and
  `unknown_layout` at `genreConfig.uiLayout` or `world.meta.genreConfig.uiLayout`.
  The row adds nothing: it checks `op` against core's `GENRE_HUD_OPS`.
- **`ui.rulesPanel { op, ...input }`** is `runRulesPanelOp(op, input)`: `panel {
  worldRules?, baseRules? }`, `card { rule }`, `byCategory { rules, category }`,
  `byType { rules, ruleType }`, `isActive { rules, ruleId }`.
- **`mechanics.run { ir, seed, steps }`** is `runMechanicRuntimeCase`: the IR's
  activation assembles core's `createMechanicRuntime` (`ir.routines` handed to the
  routine and locomotion directors), the steps run in order on its seven layers
  with no Prolog engine (`stamina.register`; `combat.register`, `combat.attack`;
  `traversal.links`, `traversal.register`, `traversal.traverse`;
  `locomotion.pursue`; `detection.observer`, `detection.target`,
  `detection.observe`; `routine.assign`, `routine.tick`; `skills.load`,
  `skills.register`, `skills.award`, `skills.advance`: core's `MECHANIC_STEP_OPS`,
  imported, so the list is core's and not a copy), and the answer is the
  plan, one result per step (`{ absent: true }` on a layer the world did not
  activate) and every event type the one bus carried.

So **the args are a corpus case's `op` and `input` (or its `input`) and the answer
is its `expected`**, key sets included. A domain refusal core's runner answers is
a VALUE, as the corpus pins it (`{ ok: false, refusal: { code: "unknown_genre",
field } }`); what the row itself refuses is an ERROR with a code (see "Errors"):
`[unknown-op]` for an op core's runner does not declare (`GENRE_HUD_OPS`,
`RULES_PANEL_OPS`, `MECHANIC_STEP_OPS`), `[invalid-input]`
for an input of the wrong JSON type (the rules-panel fields core's `PanelRule`
types; the mechanic IR's `meta.genreConfig.id`, the seed and the steps). Core's
runners would otherwise answer a misspelt rules field as an empty panel, and a
mechanic step op they do not know as `{ absent: false }` with no outcome. The
rows refuse only inputs core's types declare and its runners would answer
silently wrong, never one core types loosely and answers on purpose: the IR's
`meta.enabledModules` is `unknown` in core's `MechanicRuntimeInput`, and
core's `conformance/modules/world-activation.json` ("rpg with a string") pins
that a list that is not an array selects nothing and the genre decides, so
`mechanics.run` passes it to core unchecked and answers that IR exactly as
`modules.activate { ir }` does — including core's "no mechanic modules" form,
`meta.enabledModules: ['none']` (`NO_MECHANIC_MODULES`, core 798d333), which
assembles nothing whatever the genre (`mechanic-runtime.json`, "survival with
'none': nothing assembled"; `world-activation.json`, "rpg with 'none'" and seven
more), while an empty list still means the genre decides.

**Why `mechanics.run` is stateless and not a `mechanics.create`/`.apply` session.**
The session rows above hold a core model whose methods answer JSON-ready values.
The mechanic runtime's per-step answer (`outcome`, `stamina`) is a projection core
keeps private to its corpus runner; the one thing core exports is the whole
replay, `{ ir, seed, steps }` → `{ plan, steps, events }`. A session would have to
restate that projection here, and the rows decide nothing. It is named and shaped
like `weather.run`, the other seeded corpus replay. A live game session also needs
the layers' hosts (trajectory probe, perception, locomotion, skill modifiers),
which are engine callbacks that cannot cross this ABI: those are the per-system
rows of P9b–P9j. When core exports a per-step function, a session pair can wrap
it without restating anything.

The evidence is core's corpora, not a transcription:
`vendor/core/conformance/ui/genre-hud-cases.json` (106 cases at 7376894: config
16, view 31, genre_view 16, config_of 28, view_of 15),
`ui/rules-panel-cases.json` (17) and `modules/mechanic-runtime.json` (8 cases at
fc88be9, 25 steps each), copied byte for byte by `tools/vendor-core-bundle.mjs` and hashed
in `VENDORED.json` (`core_vendor`; `--check --core` byte-compares them with core).
`tests/p9a_corpus.cpp` sends every case through `insimulcore.h` and compares
exactly; it is three ctests, `genre_hud_corpus`, `rules_panel_corpus` and
`mechanic_runtime_corpus`, so removing one row turns its own test red, and it
also fails when a UI corpus declares an op (`ops`) no case exercises or when a
case is not driven through the row (each file's line prints `driven N (<op>
<count>, …), 0 undriven`). `p9a_corpus_negative` must see it fail one wrong answer
per row (`tests/p9a-negative/`), plus, for the genre HUD, a wrong `config_of`
projection (the fighting rule dropped) and a case it cannot drive, counted
undriven. The hand cases in `tests/cases/bridge-p9a.json` pin the
rows' own contract (the coded errors, a refusal as a value).

**Cost.** The three rows bring core's HUD and rules-panel models and the whole
mechanic assembly (the seven layers' directors, combat resolution, perception,
traversal, routines, skills, and the Prolog helper text those modules import):
47 core modules. At the f9aef13 pin the bundle grew from 1,005,516 bytes (the pin
bump alone, from 988,816 at b38e60d) to 1,392,156. The 86 cases take about 60 ms
under QuickJS. `config_of` / `view_of` (PL.native-genre-hud-config) add no core
module (152 before and after; `game-genres/resolution` was already in): the bundle
went from 1,553,471 bytes at eff846a to 1,563,073 with the 7376894 pin bump alone
(+9,602, core's runner and its cases) and 1,563,744 with this row's comment
(+10,273 in all, +0.66 %). The 106 genre HUD cases take about 3 ms.

### The saves.slots session: save slots, Continue, autosave, quick save (PL.native-catchup)

Core's `SaveSlotsSession` (`src/save-slots.ts`, P1.core-slots, ruling U83(1)) is
the engine-neutral logic around the one save format: which slot a request goes
to and what is refused, the slot rows and the Continue target, deleting a slot,
autosave at an interval with its "Saving…"/"Saved!" indicator, and quick save /
quick load on F5 / F9. It does no I/O, so it is a session pair like the clock:

- **`saves.slots.create { config?, slots?, activeSlot? }`** → `{ session, config,
  view }`. `config` is the saves pack's parameters (`slotCount`, or the pack's
  `maxSlots`; `quickSlot`, null for none; `autosaveIntervalSec`, 0 for off;
  `autosaveIndicator`), passed to core UNCHECKED: core reads a field of the wrong
  type as its default on purpose, and its corpus pins each reading. The answer's
  `config` is how core resolved them. `slots` is what the host's save codec found
  (`{ index, outcome, summary? }`; `ui.saveSlots` classifies an envelope into
  one). `activeSlot` is the autosave target at the start.
- **`saves.slots.apply { session, ops }`** → `{ results, view }`. The ops are
  core's steps: `save { slot }`, `load { slot }`, `continue`, `delete { slot }`,
  `ask_delete { slot }` (the slot list's Delete, which asks first: it opens the
  view's `confirm` prompt), `confirm_delete` and `cancel_delete` (the prompt's
  two actions; core's PL.slots-delete-states), `key { code }` (a
  KeyboardEvent.code: `F5`, `F9`; any other is `unbound_key`), `tick { delta }`
  (seconds; null is a non-finite tick, as the corpus writes it), `finished {
  ok, savedAt?, summary?, outcome? }` and `disk_changed { slots }` (the save
  files changed outside the game: `slots` is the host's new listing, as at
  create, null for none; core's PL.disk-changed-step, in from the 72c658c pin).
  Each result is core's `{ ok, refusal?, outcome?, effect, history?, disk? }`:
  a refusal (`busy`, `no_such_slot`, `slot_empty`,
  `slot_corrupted`, `no_quick_slot`, `nothing_to_continue`, `nothing_pending`,
  `unbound_key`, `confirm_open`, `nothing_to_confirm`, `quick_slot_reserved`) is
  a VALUE, `effect` is the I/O the host does now — `{ write: { slot, kind,
  autosave } }` (then raise core's `game_saved`), `{ read: { slot, kind } }` or
  `{ remove: { slot } }` — answered with `finished`, and `history` is the line a
  finished delete leaves in the game's log ("Deleted Slot N"), and `disk` (only
  on a `disk_changed` that was not refused) is `{ changed, deleted, added,
  droppedActive }`: when the active slot changed or went outside the game core
  clears it, so autosave never writes over the outside change, and the indicator
  says so (`slot_changed_outside`, `slot_deleted_outside`, or the `quick_` ones).
  The view is core's
  `SaveSlotsView`: `rows` (core's `SlotView` plus `canDelete`, `isContinue`,
  `isActive`, `isQuick`), `continueSlot`, `activeSlot`, `pending`, `confirm` (the
  delete prompt, or null), `autosave { on, target, inSec }` and `indicator`
  (state, label, detail, kind, opacity). Since core's PL.quick-slot (in from the
  ac229a7 pin) an unset `quickSlot` is a DEDICATED quick slot after the manual
  ones (index `slotCount`), so the table holds `slotCount + 1` rows; null names
  none. Since core's PL.quick-slot-one-based (in from the eff846a pin) a stated
  `quickSlot` is the 1-BASED slot number the player reads (`quickSlot: 1` is
  "Slot 1", index 0 — the old default), which core maps to the session's 0-based
  index in the resolved `config`; 0 and any number past the manual slots are
  refused `quick_slot_out_of_range` (F5 and F9 then answer that refusal and write
  nothing). A binding that stated a 0-based index must add one.

What the rows refuse as errors is only what core's types declare and JSON cannot
hold: a `config` that is not an object, a slot (at create or in a `disk_changed`
listing) that is not `{ index: number, outcome }` with an outcome core's
`SaveSlotModel` knows, a listing that is not an array, an `activeSlot`, `slot`
or `delta` that is not a number, a `code` that is not a string, and a `finished`
without a boolean `ok`. A slot index that is not a slot (`1.5`, `7`) goes to core,
which answers `no_such_slot` on purpose.

The evidence is core's corpus `conformance/saves/slots.json` (147 cases at
72c658c; 130 at eff846a; 126 at ac229a7; 94 at fc88be9), copied byte for byte by `tools/vendor-core-bundle.mjs`
and hashed in `VENDORED.json`. `tests/saves_slots_corpus.cpp` (ctest
`saves_slots_corpus`) drives it through the two rows from C: every `run` case as
one create and one apply per step (so the view after every step is the session's
own), every `config` case through create's `config`, every `continue` case
through the view of a session with no quick slot (core's `continueSlot(slots,
slotCount)` reads exactly `slotCount` slots), every `rows` case through create's
view (a `busy` rows case with one pending save first) — 132 cases at 72c658c
(config 28, continue 13, rows 10, run 81; 115 at eff846a). The 15
`indicator` cases show any state, kind and detail on a bare indicator, which no
session step does; the runner prints a measured reason for each (how many of its
views the session itself showed in the run cases, and which it never reached).
`saves_slots_corpus_negative` must see it fail one wrong config and one wrong run
(`tests/saves-negative/`). The hand cases in `tests/cases/bridge-saves-slots.json`
pin the rows' own contract (results in a batch, the effects, the errors).

**Cost.** The rows bring three core modules, `save-slots`, `ui/save-indicator-model`
and `game-engine/logic/KeyboardMap` (the slot model was already in; 138 → 141): at the fc88be9 pin the bundle went from 1,402,117
bytes (the pin bump alone, from 1,392,156 at f9aef13) to 1,422,744. The 83 driven
cases take about 20 ms under QuickJS.

### The props and inventory rows: containers, documents, doors, the notice board, the inventory panel (PL.native-props-rows)

Core's P6 logic (P6.core, 31764b1 onward; ruling U89(2)) is the engine-neutral
half of the props a player uses: `src/props/containers.ts` (whether a chest can
be opened, unlocked, put into, where it is, when it respawns),
`src/props/documents.ts` (one readable document from a TextIR, a NoticeArticle, a
book or a sign; its pages; the reader panel's `DocumentReader`),
`src/props/doors.ts` (a building's door, its prompt, and the handoff "enter
interior X" / "exit to Y"), `src/props/notice-board.ts` (`NoticeBoard`: which
notices a board shows, unread, read / answer / take a quest),
`game-engine/logic/NoticeGenerator.ts` (`generateSettlementNotices`, one notice
per NPC) and `src/ui/inventory-model.ts` (`InventoryViewModel`, the inventory
panel, moved into core from Babylon). The rows call those and decide nothing:

- **Stateless:** `props.containers.{view, unlock, move, at, respawn}`,
  `props.documents.{document, paginate}`, `props.doors.{door, prompt, step}` and
  `props.notices.generate` — one core function each, answering in the shape the
  corpus pins (the host keeps the state: a container record `unlock` returns, the
  door's `inside`).
- **Sessions** (`js/host-sessions.js`): `props.reader.create/apply` (a refused
  document answers `documentOf`'s refusal value and opens no session),
  `props.board.create/apply`, and `inventory.create/apply`. The reader's and the
  board's `apply` send EVERY op to core's `step`, because core answers an action
  it does not know as its refusal value `unknown_action` (`applySteps`); the
  inventory's ops are core's corpus steps (`add`, `remove`, `filter`, `toggle`,
  `set_gold`, `add_gold`, `remove_gold`, `equip_flag`) plus `get`, `items`,
  `load` and `clear` a game needs, refused by name otherwise (`applyOps`).
- **`props.contract`** answers the data tables of each P6 corpus file's
  `contract` (the states, refusals and actions, the default capacity, page size
  and quiz XP, the door's prompt radius and stand-off, the inventory's filters,
  colours, slot labels and empty messages) from core's own constants, keyed by
  area: a binding reads its words and numbers there, not from a copy.

The inventory's `view` is `{ filter, counts: { total, shown }, gold, rows,
equipment: { weapon, armor, accessory }, save: { gold, inventory } }` — exactly
the state core's inventory corpus records after every step: `rows()` with each
item row's live `item` left out (`get` returns the stored item), the equipped
item's id per slot, and `toSaveState()`. **`ui.trade` is not this row and is
unchanged**: C0's `ui.trade` is core's `TradeModel` (moving stock between the
pack, a container and a merchant over the same `currentState` slice); there was
no inventory-panel row to extend, so `inventory.*` is new beside it, and a host
runs a trade through `ui.trade` and re-loads the panel (`inventory.apply` `load`)
from the slice it returns.

What the rows refuse as errors (`[invalid-input]`) is only a field of the wrong
JSON type that core's types declare: a container, building, move, action,
player or option that is not an object, a list (`containers`, `buildings`,
`notices`, `npcs`, `read`, `answered`, the held item ids) that is not an array,
a `text`, `inside`, id or settlement name that is not a string, a `charsPerPage`
or `fluency` that is not a number, `now` that is neither a string nor a number,
and a reader flag or `equipped` that is not a boolean. Every value core reads
itself (a document of any shape, a stack's `quantity`, a `gold` of `null`) goes
to core, which answers it as its corpus pins.

The evidence is core's five P6 corpora, copied byte for byte by
`tools/vendor-core-bundle.mjs` (`PROPS_CORPUS_FILES`) and hashed in
`VENDORED.json`: `conformance/props/containers.json` (31 cases),
`documents.json` (32), `doors.json` (29), `notice-board.json` (17) and
`conformance/ui/inventory-cases.json` (19). `tests/props_corpus.cpp` drives
EVERY case of every file through the rows from C, one ctest per file
(`props_containers_corpus`, `props_documents_corpus`, `props_doors_corpus`,
`props_notice_board_corpus`, `inventory_corpus`): the stateless ops send the
case's `input` as the row's args; `read`, `board` and `inventory` open the
session and apply ONE op per step; a door `session` is the host's side of a door
as core's runner keeps it (`prompt` and `step` with the player's `inside`); and
`generate` projects the row's full articles to the fields the corpus records.
Each file's data tables are held to `props.contract`. 128 cases, none undriven.
`props_corpus_negative` must see one wrong case per file reported
(`tests/props-negative/`). The hand cases in `tests/cases/bridge-props.json` pin
the rows' own contract (refusal values, an unknown action as core's, a refused
document opening no session, the session kinds, the errors).

**Cost.** The rows bring eight core modules (the four `props/` modules,
`ui/inventory-model` and the `EquipmentManager` it reads its slots from, and
`game-engine/logic/NoticeGenerator` with its `GameTextTypes`; 141 → 149): at the
ac229a7 pin the bundle went from 1,435,892 bytes (the pin bump and the
saves.slots catch-up alone, from 1,422,744 at fc88be9) to 1,511,366. The 128 cases take about 30 ms under
QuickJS.

### The pick-up settle rows: where a pick-up is put down (PL.native-pickup-settle)

Core's pick-up placement (PL.pickup-placement, ac229a7 onward; ruling U89(3), in
U78's shape) is the rule Unreal's P6 cell wrote as an interim settle
(`InsimulVillageProps.cpp`, unreal `feat/p6-unreal` 29c37ab, VP:513–790): a
world's quest-object position is a point on the map, not a free one, so before a
pick-up is drawn its authored spot is settled clear of what stands round it
(props, buildings, plants by their trunk, containers), of the villagers' paths
(roads, doors, where a villager stands) and of the pick-ups settled before it, or
refused with a code. `src/props/pickup-placement.ts` states it as data in,
decision out, in core's metres on its ground plane `(x, z)` with heights `y`; the
rows (ruling U91(2)) call it and decide nothing:

- **`props.pickups.settle`** — one pick-up (`settlePickup`): the settled spot,
  whether it `moved`, the `ring` it was found on (0: the authored spot), its
  clearance and what it is `nearest`, how clear the `authored` spot was, and the
  `approach` (the side it is walked up to from); or `no-clear-spot` with the
  `clearest` spot (where an engine that still draws it draws it, as Unreal does),
  or `bad-spot` for a spot or ground height that is not a finite number. Both
  refusals are VALUES.
- **`props.pickups.sequence`** — several, in settle order (`settlePickups`), each
  kept clear of those settled before it (a refused one where its `clearest` is).
- **`props.pickups.clearance`** — how clear a spot is (`pickupClearance`;
  `clearanceM >= 0` is clear, `ok` first: a `bad-spot` has no clearance).
- **`props.pickups.pattern`** / **`props.pickups.ring`** — the search the settle
  walks (`pickupSearchPattern`, `pickupSearchRing`: rings 0.5 m apart out to 20 m,
  from +x toward +z).
- **`props.contract`'s `props-pickup-placement`** — the corpus's data tables from
  core's constants: the kinds, `clearanceM`, `search`, `refusals`, `frames` (how
  each engine maps its frame onto core's), every constant's value (`constants`;
  the Unreal line each was measured from is prose and stays in the corpus), the
  engine-side ground and plant kinds, and the `deviations` from Unreal.

**Frames, and what a binding sends.** Everything crosses in core's frame; the rows
convert nothing. Unreal sends its `(X, Y)` ÷ 100 as `(x, z)` and its `Z` ÷ 100 as
`y`, and a turned footprint's forward as `axis` UNMIRRORED (`half.x` is along it,
`half.z` across): core's ring and heading angles turn from +x toward +z, which is
+X toward +Y in Unreal (`frames.unreal`). Walkable ground is `walkable` areas (a
circle or a box each; absent is everywhere, empty is nowhere): core's
`isWalkable` callback (an engine's navmesh query) has no row, because a callback
cannot cross the C ABI — a binding states its navmesh as areas, or settles with
`walkable` absent and keeps its own navmesh test on the answer
(`ENGINE_BINDINGS.md`, "Pick-up settle").

**Errors** (`[invalid-input]`) are only a field of the wrong JSON type core's types
declare: `obstacles`, `roads`, `settled`, `walkable` or `pickups` that is not an
array, a road object's `waypoints` that is not an array, `clearance` or `search`
that is not an object, and a `ring` that is not a number. Every value core reads
itself goes to core, which answers it as its corpus pins: a null or non-point
list entry (skipped, keeping its index), an obstacle of a kind core does not know
(not kept off), a clearance or search field that is not a usable number (its
default), a spot that is not a point (`bad-spot`).

**The evidence** is core's `conformance/props/pickup-placement.json` (72 cases at
72c658c, the six added by core's PL.pickup-ring-search-case a `ring` that states a
`search`; 66 at eff846a; over
`pattern`, `ring`, `clearance`, `settle`, `sequence`), copied byte for byte with
the other P6 corpora (`PROPS_CORPUS_FILES`) and driven by the same runner,
`tests/props_corpus.cpp`, as the ctest `props_pickup_placement_corpus`: every
case's `input` is the row's args as is, every answer compared whole within the
file's `tolerance` (1e-6), none undriven. The runner also requires the file's
top-level `numerics` to name double precision (the rows run in QuickJS, whose
numbers are IEEE-754 doubles; several cases decide exactly on a boundary) and
holds the contract's data tables, `frames` and the constants' values among them,
to `props.contract`. `props_pickup_placement_corpus_negative`
(`tests/props-negative/pickup-placement-wrong.json`) must see a float32
`numerics`, a wrong frame, a wrong constant, an op with no case, a clearance's
wrong `ok`, a settle whose building axis was mirrored, a placement off by 0.01 m
and a refusal where core settles each reported. The hand cases in
`tests/cases/bridge-props.json` pin the rows' answer shapes, the refusal values
and the errors.

**Cost.** One core module (`props/pickup-placement`; 151 → 152 at the eff846a
pin): the bundle went from 1,530,726 bytes (the eff846a pin bump alone, from
1,511,366 at ac229a7) to 1,553,471. The 66 cases take about 20 ms under QuickJS.

### The interact rows: what E does by a prop (PL.native-interact-target)

Core's interact rule (PL.examine-props, core 2158b08; ruling U49(3), on the
Unreal P8 critic's m1 and its collision with P6's E actions) is the rule Unreal's
P8 cell wrote as an interim copy (`IsSign`, `IsOfferedProp`, `PropNoun`,
`PropToInteract`, `PropPrompt`, `InteractWithProp` and the board-sign search,
`InsimulPlayerTitle.cpp` and `InsimulVillageProps.cpp`): which ONE thing a press
of E acts on where the player stands, what each stated prop (`entities.props`,
pipelines' settlement dressing) means, and what reading and examining say.
`src/props/interactables.ts` states it as data in, decision out, in core's
metres on its ground plane `(x, z)`; the rows (ruling U94(3)) call it and decide
nothing:

- **`props.interactables.target`** — the ONE thing E acts on (`interactTarget`):
  an open props `panel` closes; else the nearest ACTION within its reach — `talk`
  (the `villager` the host would talk to, 3.5 m), `pick_up` (a pick-up not
  `taken`, 2.2 m), `open_container` (2.2 m), `open_board` (the board's host prop,
  3.2 m), `enter` (a door that prompts by `doorPrompt` over `buildings`, at its
  own distance) — ties going talk, pick-up, container, board, door, then the first
  listed; only with no action in range, the nearest LOOK, `read_sign` or `examine`
  (2.6 m, the first listed on a tie). It answers the target's `action`, `kind`,
  `id`, `prompt` ("Talk to Ada", "Pick up Apple", "Read the Elmford notice
  board", "Examine the barrel"; the key glyph is the host's) and `distance`, or
  null with nothing in reach; `ranges` overrides any reach for the call. A
  position that is not a finite point is the refusal VALUE `bad_position`.
- **`props.interactables.interact`** — what pressing E on a stated prop says and
  raises (`interactWithProp`): "The sign reads: X" or "The sign is blank." with
  one `sign_read`; "You examine the <noun>." or "You examine the <noun>: <text>."
  (no second full stop after a text that ends in one) with one `object_examined`;
  `open_board` with no line and no event (the board's model, `props.board.*`,
  takes over); a prop with no meaning is the refusal VALUE `not_offered`. The host
  raises the events on its bus (the tutorial's lessons complete on them).
- **`props.interactables.meaning`** — a prop's one meaning and prompt
  (`propInteraction`): `open_board` for the board's host prop (never also read as
  a sign), `read_sign` for `prop.structural.sign` by whole dotted segments,
  `examine` for every other stated prop (a `prop.container.*` prop too: only a
  `ContainerIR` opens), or none for the built fabric (`prop.structural.wall`,
  `prop.structural.fence`) and a prop with no archetype.
- **`props.interactables.host`** — the prop a settlement's notice board is posted
  on (`noticeBoardHost`): of the offered signs that state no other settlement, the
  nearest to the settlement's `position`, the first listed on a tie; null is no
  board. The `board` the other rows take is `{ host, name }`, `name` the
  settlement's: a binding works it out once per settlement.
- **`props.interactables.noun`** — what a prop is called (`propNoun`:
  `prop.furniture.stall.produce` is "produce stall"; fewer than three segments is
  "object").
- **`props.contract`'s `props-interactables`** — the corpus's data tables from
  core's constants: `propActions`, `actions`, `actionTier`, `lookTier`,
  `notOffered`, `notOfferedReasons`, `signArchetypes`, `rangesM`,
  `doorPromptRadiusM`, `refusals` and the `deviations` from Unreal's interim
  rules (ten, each with Unreal's reading, core's and why). The prose keys are
  rules written out and stay in the corpus.

What stays the host's: the villager it would talk to (sight and facing), which
containers are reachable, the panel that is open, the E press inside an interior
or during a conversation (core's `notHere`; PL.examine-props m3), and a language
world's translated objects (`examineNearest`, m4).

**Errors** (`[invalid-input]`) are only a field of the wrong JSON type core's types
declare: `props`, `pickups`, `containers` or `buildings` that is not an array, a
building that is not an object, `villager`, `board`, `settlement`, `prop` or
`ranges` that is not an object, a range that is not a number, a `panel` or an
`archetype` that is not a string. Every value core reads itself goes to core,
which answers it as its corpus pins: a position that is not a finite point (`at`:
`bad_position`; a candidate's: skipped), a null or id-less list entry, a taken
pick-up (skipped), an archetype or text that is not a non-empty string (no
archetype: not offered; no text: blank).

**The evidence** is core's `conformance/props/interactables.json` (27 cases over
`noun` 1, `meanings` 4, `host` 5, `interact` 2, `target` 15; Brightwater's 78
stated props among them), copied byte for byte with the other props corpora
(`PROPS_CORPUS_FILES`) and driven by the same runner, `tests/props_corpus.cpp`, as
the ctest `props_interactables_corpus`, 0 undriven. The rows take ONE prop or one
stand, as core's functions do; the runner walks a case's lists and composes its
board exactly as core's corpus runner does (`runMeanings`, `runTarget`): the board
as the case states it, else `{ host, name }` from `props.interactables.host` and
the settlement; a `meanings` case's `count` per action made from the rows'
meanings; a `target` case's `stands` one call each with the stand's fields over
the case's. Both projections are self-tested on every start.
`props_interactables_corpus_negative`
(`tests/props-negative/interactables-wrong.json`) must see a wrong range, an op
with no case, and five answers an engine keeping one of Unreal's interim rules
would give — the board's host sign also read as a sign, a fence offered, a nearer
barrel examined before a pick-up, a tie kept by the last prop, a second full stop
— and two runner controls no core case can be (a case's own `ranges` reaching a
prop the defaults do not; an `interact` case that states one `prop` alone), each
reported. The hand cases in `tests/cases/bridge-props.json` pin the answer
shapes, the refusal values and the errors.

**Cost.** One core module (`props/interactables`; 158 → 159 at the 72c658c pin):
the bundle went from 1,611,435 bytes (the pin, the repointed P8 imports and the
`disk_changed` op) to 1,628,183 (+16,748). The 27 cases take about 12 ms under
QuickJS.

### The title, tutorial and onboarding rows (PL.native-title-rows)

Core's P8 work (P8.core, ff599d7; in every pin since f9aef13) is the title
screen and the first minute of play: the title menu over the save slots
(`src/ui/title-flow.ts`), the tutorial quest (`TutorialQuestSystem`) and the
onboarding flow built on it (`OnboardingManager`). Unreal's P8 cell copied them as
an interim engine-side copy (`Portable/InsimulTitleFlow`,
`Portable/InsimulTutorialQuest`, U92(1)); these rows are what its retirement
(`P8.unreal.retire-title-copy`) binds instead, as `P6.unreal.retire-props-copy`
binds the `props.*` rows. They call core and decide nothing:

- **`ui.titleFlow.create` / `.apply`** — a session holding the host's `menu`
  (core's `TitleFlowInput`: `title`, `slots`, `saves`, `session`, `busy`, `quit`,
  `settings`, `onboarding`). Its fields go to core UNCHECKED, because core reads a
  flag of the wrong type as its default on purpose and the corpus pins each
  reading. `savesSession` LINKS an open `saves.slots` session: every view is then
  core's `titleMenu` over that session's live view (its rows, Continue target,
  pending write or read, delete prompt), so the title screen and the slot list
  never disagree. ops: `choose { entry }` → core's `TitleChoice` (an action the
  host does, or a refusal VALUE; `entry` goes to core unchecked, so a label or a
  number is core's `unknown_entry`) · `set { menu }` (replaces the host's input).
- **`ui.tutorial.objectives`** — the lessons a game's bindings build
  (`buildTutorialObjectives`).
- **`ui.tutorial.create` / `.apply`** — a `TutorialQuestSystem` on the session's
  own `GameEventBus`. Each op answers `{ result, events }`: the onboarding events
  the quest raised during it (`onboarding_step_started`,
  `onboarding_step_completed` with `durationMs`, `onboarding_completed` with
  `totalDurationMs`), which the host raises on its own bus; an event the host
  sent through `event` is never echoed back. The view is the state core's corpus
  records (`tutorialStateJson`); `create` also answers the quest's `title`,
  `description` and full `objectives` (what a HUD draws for the current one).
- **`ui.onboarding.create` / `.apply`** — an `OnboardingManager` (a definition's
  steps run as ONE tutorial quest) on its own bus. Each op answers `{ result,
  calls, events }`: the manager's callbacks during it (`started`, `completed` with
  `durationMs`, `skipped`, `done` with `totalDurationMs`) and the onboarding events
  its quest raised (as `ui.tutorial.apply`'s); `totalSteps` beside every answer is
  the flow's count against the game's bindings, the same before `start` as after
  (core's `totalStepsRule`); a flow with nothing left is `done` on `start` and
  raises nothing (`nothingLeftRule`). `inspect` (the count and the current step in
  full) and `state` (core's `getState()`: the quest's objectives with `completed`
  and `skipped`, and whether a skip ended it; null before `start`) read without
  acting.
- **`ui.titleFlow.contract`**, **`ui.tutorial.contract`** — each corpus file's
  data tables from core's constants. The title menu's refusal and action names and
  the three onboarding event names are literals in core's emitter, with no
  exported constant, so they are not restated here; the cases pin them.

**The game's bindings** are `bindings` (the whole `ControlBinding[]` table) or the
changes core's corpus writes (`unbind: [action]`, `rebind: { action: [keys] }`,
`bind: [binding]`, applied to `CONTROL_BINDINGS` by core's own `corpusBindings`),
never both. **The clock**: `now` (epoch ms or an ISO string) gives a session a host
clock that moves only on `tick { ms }`, as core's corpus clock does; without it the
session reads the wall clock and `tick` is an error.

**Errors** (`[invalid-input]`) are only a field of the wrong JSON type core's types
declare (`menu`, `config`, `options`, `definition` not an object; a flag not a
boolean; an id list not of strings; `bindings` beside its changes; an unreadable
`now`; `tick` without a host clock; an event without a string `type`). A linked
`savesSession` that is not an open `saves.slots` session is an error naming it.

**The evidence** is core's `conformance/ui/title-flow.json` (57 cases at 72c658c:
menu 29, choose 18, session 10, the tenth a session whose saves change outside the
game, through the `disk_changed` op; 56 at 7376894; it was 51 at ff599d7 and gained the quick-slot and
delete-prompt cases since) and `conformance/quests/tutorial.json` (40 cases:
objectives 8, run 18, onboarding 14; contract `totalStepsRule`, `bindingsRule`,
`nothingLeftRule`), copied byte for byte (`TITLE_CORPUS_FILES`) and driven by
`tests/title_corpus.cpp` as the ctests `title_flow_corpus` and `tutorial_corpus`:
every case through the rows, 0 undriven, each file's contract tables held to its
contract row. A title `session` case runs a `saves.slots` session and a title
session linked to it, one `saves.slots.apply` per slot step and the menu read
after it; tutorial and onboarding sessions open on a host clock at the file's
`contract.t0`. `title_flow_corpus_negative` and `tutorial_corpus_negative`
(`tests/title-negative/`) must see a wrong contract table, a wrong case per op and
an undrivable case each reported. The hand cases in `tests/cases/bridge-title.json`
pin the answer shapes, the live link, the clock, the events and the errors.

**Cost.** Five core modules for the rows (`ui/title-flow`,
`TutorialQuestSystem`, `OnboardingManager`, and the two corpus modules
`ui/title-flow-corpus`, `quests/tutorial-corpus`), and the modules the corpus
modules pull in through core's corpus comparator (`save-file-game-state-corpus` and
the save-file modules behind it): 152 → 183 at the 7376894 pin. The bundle went
from 1,563,744 bytes to 1,628,012 (+64,268, +4.1 %); the three models account for
about 39,400 of that, and about 23,500 is `tutorialStateJson` and `corpusBindings`
living in core's corpus module, whose comparator import brings the save-file code
with it. The 96 cases take about 30 ms under QuickJS. Since the 72c658c pin
(PL.native-interact-target, U94(3)) the rows import those host names from core's
`ui/title-flow-corpus-host` and `quests/tutorial-corpus-host` (core's
PL.tutorial-corpus-bundle, U94(2)), which reach no save module: at 72c658c the
repointed imports alone take the bundle from 1,639,824 bytes to 1,610,712
(−29,112) and 188 core modules to 158.

### What the feature phases asked for and core does not have yet

Exposed "as core has them" — so a few UI view-models in the brief are not rows,
because there is nothing in core at the pinned commit to expose: **no HUD
view-model** (the HUD shell composes `ui.notifications`, `ui.journal`'s tracker,
`quest.waypoints`' compass and the clock), and **no
minimap view-model** beyond the two marker functions (`quest.minimapMarkers`,
`quest.markers` with `surface: "minimap"`). The Features Round plan (§1) lists compass and minimap
view-models as core work; when they land, they are rows here. (The inventory
panel's view-model landed in core with P6.core and is the `inventory.*` rows
since PL.native-props-rows, above.)

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
  `CompositionError`, and any op failure wrapping one) reads `insimulcore: <ErrorName>: [<code>]
  <message>` — a host reads the code between the brackets and never parses prose;
- **a caller error the P9a rows refuse** (`ui.genreHud`, `ui.rulesPanel`,
  `mechanics.run`) carries a code the same way: `insimulcore: Error: [<code>]
  insimulcore: <method>: <what was wrong>`, with `unknown-op` or `invalid-input`;
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
| `saves_slots_corpus`, `saves_slots_corpus_negative` | core's `conformance/saves/slots.json` driven through the `saves.slots.*` session rows (132 of 147 cases at 72c658c; the 15 indicator cases reported with a measured reason), and a wrong answer seen as wrong |
| `props_containers_corpus`, `props_documents_corpus`, `props_doors_corpus`, `props_notice_board_corpus`, `inventory_corpus`, `props_corpus_negative` | core's five P6 corpora driven whole through the `props.*` and `inventory.*` rows (128 cases, each file's contract tables held to `props.contract`), and a wrong answer per file seen as wrong |
| `props_pickup_placement_corpus`, `props_pickup_placement_corpus_negative` | core's pick-up placement corpus driven whole through the `props.pickups.*` rows (72 cases; its `numerics` must name double precision; its contract tables, `frames` and the constants' values among them, held to `props.contract`), and a wrong numerics, frame, constant, undriven op and four wrong answers (a mirrored building axis among them) seen as wrong |
| `props_interactables_corpus`, `props_interactables_corpus_negative` | core's interact-rule corpus driven whole through the `props.interactables.*` rows (27 cases, 0 undriven; the runner walks each case's props and stands one row call each, as core's runner does; its contract's data tables held to `props.contract`), and a wrong range, an undriven op, five answers an engine keeping one of Unreal's interim rules would give and two runner controls (a case's `ranges`, a lone `prop`) seen as wrong |
| `title_flow_corpus`, `tutorial_corpus`, `title_flow_corpus_negative`, `tutorial_corpus_negative` | core's P8 corpora driven whole through the `ui.titleFlow.*`, `ui.tutorial.*` and `ui.onboarding.*` rows (97 cases, 0 undriven; each file's contract tables held to its contract row), and a wrong contract table, a wrong answer per op and an undrivable case per file seen as wrong |

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
