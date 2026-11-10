# What each engine's binding must add (Features Round C0)

This component changed no engine. It made `libinsimulcore` answer the feature
phases' methods (`README.md`, "The method table"); this page is the list of what
each engine has to do before a phase can use them. Engines are listed in the
operator's order (Unreal, Unity, Babylon, Godot). Nothing here is done yet.

## Common to Unreal, Unity and Godot

1. **Take the new library.** The C ABI is unchanged — `insimulcore.h` is
   byte-identical, `INSIMULCORE_ABI_VERSION` is still `0.1.0`, the five functions
   behave as before — so a binding recompiles against nothing new. What changed is
   the bundle inside it (core `main` `c4b46c4`, 42 methods instead of 5) and the size of
   the library (the bundle is ~620 KB of JS instead of 54 KB). Re-fetch or re-stage
   the built `libinsimulcore` (Unity `scripts/fetch-native.sh`, Unreal
   `Source/ThirdParty/InsimulCoreLibrary/lib/`, Godot below) and quote the
   version stamp (`insimul_core_version()`, which names the core commit) in the
   change.

   **Two behaviour changes in the five old methods** (`core.methods`,
   `quest.hydrate`, `quest.radiantTick`, `radiant.generate`,
   `radiant.baseTemplates`), both visible to an existing binding:
   - **Arguments must be a JSON object** (or NULL / empty text, meaning `{}`). The
     old bundle handed any parsed JSON to the row as it was (`[]`, `42`, `"x"`,
     `null`), so what happened depended on the row;
     the new one refuses a non-object before the row runs, with `insimulcore:
     Error: insimulcore: <method>: the arguments must be a JSON object`. A binding
     that passes `"null"` or an array for "no arguments" must pass `{}` instead.
     (A method name that is only an `Object.prototype` key, such as `toString`, is
     now "unknown method" too.)
   - **Error text has a code prefix where core raises one.** A refusal core makes
     with a machine-readable code now reads `insimulcore: <ErrorName>: [<code>]
     <message>` (README, "Errors"). None of the five old methods raise one today,
     but a binding that matches error text must read the bracketed code, never
     the prose, and must not assume the message starts right after `<ErrorName>: `.
2. **Read the surface, do not assume it.** Both Unity's and Unreal's
   `InsimulMechanicSurface` already read `core.methods`; their comments and tests
   that say the bridge "answers with FIVE methods" become stale and must be
   updated when they take this library — any gate asserting the count five will go
   red, correctly.
3. **One translation site per phase.** Each phase's engine code turns engine
   types into a row's JSON in ONE place (as `InsimulRadiantSource` does for
   radiant) and draws the `view` the row returns. No rule is re-decided
   engine-side; a pure projection under ~300 lines may be mirrored only under the
   shared corpus (GAUNTLET.md rule 1).
4. **Sessions.** Hold the integer a `.create` row returns for as long as the
   object lives (a playthrough's clock, a pause menu, a journal), batch one game
   event's ops into one `.apply`, and `session.dispose` on teardown. A level reload
   that forgets to dispose shows up in `session.list`.
5. **Never per frame.** The clock is the trap: accumulate real time engine-side
   and send `clock.apply { ops: [{ op: "update", deltaMs }] }` at event rate (a few
   times a second at most), then `weather.apply { ops: [{ op: "advanceTo", day }] }`
   when the clock's `day` moves.
6. **Weather writes go into the game's KB.** `weather.apply` returns `writes` —
   the asserts and retracts `WeatherDirector` made, in order, without the trailing
   period. The game's KB is the engine's own libinsimul KB, so the binding applies
   them there (`insimul_kb_assert` / `insimul_kb_retract`) in that order.
   **Do not drive the sky from `events` alone.** Core's `WeatherDirector.advanceTo`
   announces (`weather_changed`, and its `IWeatherSink`) only when the LAST day it
   stepped changed: an `advanceTo` that crosses a season turn and lands on an
   unchanged day reports no event (observed at core `5ce94d7`, and unchanged at `73f93ee` and at the pin `c4b46c4` —
   no change in `src/weather/` or `WeatherDirector.ts` between them: day 2 → 6 over the
   monsoon world turns dry/dust into wet/downpour on day 5 and emits nothing). Read
   the `view` (or the per-step `conditionChanged` / `seasonTurned` in `results`)
   after every advance. Reported to core as a finding; the bridge reproduces core.
7. **Errors.** On NULL, read `insimul_core_last_error()`; when it contains
   `[<code>]` (genre resolution and pack composition refusals today, and the P9a
   rows' own `[unknown-op]` / `[invalid-input]`), that bracketed code is the
   machine-readable reason. Domain outcomes (a corrupt save slot, a refused trade)
   are NOT errors — they come back as values.
8. **Saves: one hash.** `save.encode` / `save.decode` compute the envelope's
   SHA-256 inside the library. An engine that keeps its own canonical-JSON +
   SHA-256 (Unreal's portable C++ save core, Godot's `canonical_json.cpp` /
   `sha256.cpp`) must either retire it for these rows or keep it pinned to
   `conformance/saves/integrity-vectors.json` — two hashers that disagree make a
   save written by one engine unloadable in another (the cross-engine save check in
   `PLAN.md` §4).
9. **An editor-free corpus runner** (track C0's gate). Each binding runs
   `corebridge/vendor/core/cases/*.json` and `corebridge/tests/cases/*.json`
   through its own wrapper (Unity: a dotnet test over `InsimulCore`; Unreal:
   `check:host`; Godot: headless), with the matcher in `tests/README.md`. The
   native C and JS harnesses here are the reference implementations of that loop.

## Unreal

- Stage the new `libinsimulcore` under `Source/ThirdParty/InsimulCoreLibrary/lib/`;
  the vendored `include/insimulcore.h` there needs no change (diff-identical).
- `Portable/InsimulCoreCaller` is the generic caller; add one portable view per
  phase over it: P1 `save.*` + `ui.saveSlots` (Unreal's save system is "code but
  unwired" — wire it to `save.encode`/`save.decode` instead of its own envelope),
  P2 `ui.notifications.*`, `ui.pause.*` (the genre path: `ui.pause.create { genre }`),
  P3 `ui.journal.*` (the journal port), `quest.completion.*`, `quest.markers`,
  `quest.minimapMarkers`, `quest.waypoints`, P4 `clock.*`, `weather.*`.
- Update `InsimulMechanicSurface.h`'s "FIVE methods" comment and any test pinning it.
- **Layout (L.portable-binding, after L.native-layout).** The `layout.*` rows
  (`README.md`, "The layout rows") answer every op of core's layout corpora, the
  same ops `Tests/layout_corpus_ops.h` maps onto `Portable/`. The binding replaces
  `Portable/`'s layout rules (`InsimulVillageLayout`, `InsimulBuildingFit`, …) by
  calls to `layout.<op>` with corpus-shaped inputs, and `layout_conformance` runs
  the same corpus files through the library. Re-vendor the corpus from core at
  this library's pin, not from `Portable/`'s.
- **Packs (SP.composer-unreal, U62(1)).** Part 1 is this library's
  `packs.compose` row (`README.md`, "The packs.compose row"):
  `insimul_core_call(core, "packs.compose", { recipe, world, game, engine, catalog })`
  answers core's `Composition`. The library carries no catalog: part 2
  re-vendors core's `packs/` (`index.json`, `<id>/pack.json`) and
  `conformance/packs/` into Unreal from core at this library's pin, and the
  binding sends `catalog: { index, manifests }` built from those files. Part 3
  is the Unreal replay target (`test_core_rows_corpus.cpp`) running
  `composition.json`'s cases through the row by the rule `tests/packs_corpus.cpp`
  implements here: send each case's `input` with the catalog beside it; an
  `expected` case answers exactly that JSON, an `expectedError` case fails with
  `CompositionError: [<code>]` or `GenreResolutionError: [<code>]`.
- **P9a (Unreal's P9a cell, after P9a.native).** Three rows (`README.md`, "The
  P9a rows"): `ui.genreHud { op, ...input }` (the genre HUD view-model: bind the
  HUD to its `view`), `ui.rulesPanel { op, ...input }` (the world rules panel: draw
  its `panel` and `card` answers) and `mechanics.run { ir, seed, steps }` (core's
  mechanic runtime assembly replayed: `{ plan, steps, events }`). Re-vendor
  `conformance/ui/{genre-hud-cases,rules-panel-cases}.json` and
  `conformance/modules/mechanic-runtime.json` from core at this library's pin, and
  have the replay target send each case the way `tests/p9a_corpus.cpp` does: `{
  "op": <case op>, ...<case input> }` to the two UI rows, the case's `input` to
  `mechanics.run`, each answer compared exactly with `expected` (key sets
  included; a domain refusal is the VALUE `{ ok: false, refusal }`, never an
  error). Two rows are stricter than core's runners, and a binding must know
  where: `ui.rulesPanel` refuses a `worldRules`, `baseRules` or `rules` that
  is not an array of objects (`rules` is required by `byCategory`, `byType` and
  `isActive`), a `card` `rule` that is not an object, and a `category`,
  `ruleType` or `ruleId` that is not a string, as an ERROR `[invalid-input]`, where core's `runRulesPanelOp` would read a
  non-array as no rules and `String()` a key. Send the JSON types core's
  `PanelRule` declares. `mechanics.run` passes `meta.enabledModules` to core
  unchecked, as `modules.activate` answers it (a non-array list or an empty one:
  the genre decides; `['none']`, core's `NO_MECHANIC_MODULES` from fc88be9: no
  mechanic module whatever the genre), and it refuses only an `ir`, `ir.meta` or `ir.routines` that is not an object, a
  missing `meta.genreConfig.id`, a seed or a step of the wrong JSON type
  (`[invalid-input]`), and a step op outside core's `MECHANIC_STEP_OPS`
  (`[unknown-op]`; imported from core's `game-engine/mechanic-runtime-corpus`
  since PL.native-catchup, no longer a hand copy). Core's corpus now carries the
  same list as its top-level `ops` key; a replay target reads or ignores it.
  `mechanics.run` is a replay, not a live runtime: the decision layers
  `InsimulMechanicSurface.h` marks `BridgeHasNoRow` still need per-system rows
  (P9b–P9j). The existing `genre.*`, `modules.*` and `packs.compose` rows answer
  the six genres P9a.core added and `meta.enabledModules` with no row change.
- **The genre HUD of a game's own settings (Unreal's
  `P9a.unreal.retire-genre-hud-copy`, after PL.native-genre-hud-config, U92(2)).**
  `ui.genreHud` takes the settings a game is built with, not only a registry id,
  so a binding keeps no copy of core's `genreHudConfigOf` (Unreal's
  `GenreHudConfigOf` in `Portable/InsimulGenreGate.cpp`, the interim copy U92(2)
  accepts). The input shapes:
  - `{ "op": "view_of", "genreConfig": <the World IR's meta.genreConfig, as
    stated>, "state"?: {…} }` → `{ ok, value: { layout, chrome, elements } }`:
    the projection and the view in one call. This replaces the copy plus the
    `view` call. `{ "op": "config_of", "genreConfig": … }` answers the projection
    alone (`{ ok, value: { layout?, showMinimap?, … } }`; an absent flag stays
    absent, a `uiLayout` the model does not draw is projected as it is).
  - `{ "op": "view_of" | "config_of", "recipe": <a recipe id core binds, or a
    recipe file's { id, genre }>, "world"?: <the World IR, or its { meta } > }`:
    core resolves the game's settings with `resolveGameGenre` (what
    `genre.resolveGame` answers as `config`) and projects those.
  - Exactly one of `genreConfig` / `recipe` (a JSON `null` counts as absent);
    `world` only beside a recipe. Refusals are VALUES `{ ok: false, refusal: {
    code, field } }`: `no_genre_source`, `two_genre_sources`,
    `not_a_genre_config` (a string id or a list), `world_without_recipe`,
    `unresolved_recipe` (plus `reason`: `unknown-recipe`, `invalid-recipe`,
    `unknown-recipe-genre`, `recipe-drift`, …) and, for `view_of`,
    `unknown_layout` at `genreConfig.uiLayout` (or
    `world.meta.genreConfig.uiLayout` when a recipe kept the world's settings).
  - A world with NO `meta.genreConfig` keeps today's fallback, `{ "op":
    "genre_view", "genre": <id> }` (or `config { genre }`), which still refuses
    an id the registry does not hold (`unknown_genre`). Note the two differ in
    one place: Unreal's copy builds a config with no `layout` key from a
    `genreConfig` that has no `uiLayout`, and its `view` call is then refused
    `unknown_layout` at `config.layout`; `view_of` refuses the same settings at
    `genreConfig.uiLayout`.
  The evidence is core's corpus at this pin (`config_of` 28 cases, `view_of` 15),
  driven by `genre_hud_corpus`; re-vendor `conformance/ui/genre-hud-cases.json`
  and replay those ops the way the other ops are replayed.
- **Save slots (Unreal's `P1.unreal.slots` interim port, after PL.native-catchup).**
  Two session rows (`README.md`, "The saves.slots session") wrap core's
  `SaveSlotsSession`: `saves.slots.create { config?, slots?, activeSlot? }` →
  `{ session, config, view }` and `saves.slots.apply { session, ops }` →
  `{ results, view }`, the ops being core's steps (`save { slot }`, `load { slot }`,
  `continue`, `delete { slot }`, `ask_delete { slot }`, `confirm_delete`,
  `cancel_delete`, `key { code }`, `tick { delta }`, `finished { ok, savedAt?,
  summary?, outcome? }`; the three delete-prompt steps and a result's `history`
  arrived with the ac229a7 pin, core's PL.slots-delete-states, as did core's
  PL.quick-slot: an unset `quickSlot` is now a dedicated quick slot at index
  `slotCount`). The session does no I/O: each result's
  `effect` (`write`, `read`, `remove`) is the I/O the binding does with its own
  save codec (`save.encode`/`save.decode`), answered with `finished`. With them
  `Portable/InsimulSaveSlots` (the session, the indicator, the config resolution,
  Continue and the rows) can go: the binding keeps only the I/O and the drawing
  of `view`. Re-vendor `conformance/saves/slots.json` from core at this library's
  pin and have `test_save_slots` drive it the way `tests/saves_slots_corpus.cpp`
  does: a `run` case as one create and one apply per step (`{ save: i }` → `{ op:
  "save", slot: i }`, likewise `load`/`delete`/`ask_delete`; `key` → `code`, `tick`
  → `delta`, `confirm_delete`/`cancel_delete` with no field, `finished`'s fields
  spread), `config` through create's `config`, `continue` through the view of a
  session created with `config: { slotCount, quickSlot: null }` (core's
  `continueSlot` reads exactly `slotCount` slots), `rows` through create's `view`
  (a `busy` rows case: one pending `save` of slot 0 first). The
  15 `indicator` cases (11 at fc88be9) are not a session's (they show a bare indicator); the
  view's `indicator` is the binding's whole indicator. Numbers compare within the
  file's `tolerance`.
- **Props and inventory (Unreal's `P6.unreal.retire-props-copy`, after
  PL.native-props-rows; U89(2)).** `Portable/InsimulProps.{h,cpp}` is an interim
  port of core's P6 logic; every entry point of it has a row (`README.md`, "The
  props and inventory rows"), so the retirement is a substitution, entry point by
  entry point:

  | `InsimulProps.h` entry point | Row (and what of its answer) |
  |---|---|
  | `kDefaultContainerCapacity`, `kDefaultCharsPerPage`, `kDefaultQuizXp`, `kDoorPromptRadiusM`, `kDoorStandoffM` | `props.contract` → `props-containers.defaultCapacity`, `props-documents.defaultCharsPerPage`, `props-documents.defaultQuizXp`, `props-doors.promptRadiusM`, `props-doors.standoffM` |
  | `ContractTables(Area)` | `props.contract` → `[Area]` (the same keys; `test_props_corpus`'s contract check holds the file's tables to it) |
  | `FInventoryModel::FromSaveState(Player)` | `inventory.create { player }` → `{ session, view }` |
  | `LoadFromSaveState(Player)` | `inventory.apply` op `load { player }` |
  | `ToSaveState()` | `view.save` |
  | `AddItem(Item)` | op `add { item }` → bool |
  | `RemoveItem(Id)`, `RemoveItem(Id, Quantity)` | op `remove { item, quantity? }` → bool |
  | `GetItem(Id)`, `HasItem(Id)` | op `get { item }` → the stored item, or null (has = non-null). A write through the pointer (the equip handler) is op `equip_flag { item, equipped }` |
  | `ItemCount()`, `Counts()` | `view.counts` (`total`, `shown`) |
  | `LiveItems()` | op `items` → `[{ id, name, item }]`, every stored item in insertion order |
  | `InventoryEntryId`, `InventoryItemName` (a held item's id and display name) | op `items`' `id` and `name`, or an item row's `id` and `name` |
  | `GetGold()`, `SetGold`, `AddGold`, `RemoveGold` | `view.gold`; ops `set_gold`, `add_gold`, `remove_gold { amount }` (→ bool) |
  | `Equipment()` | `view.equipment` (the equipped item's id per slot; `get` for the item) |
  | `SetFilter`, `CurrentFilter()` | op `filter { filter }`; `view.filter` |
  | `ToggleGroup`, `IsCollapsed` | op `toggle { group }`; a group row's `collapsed` |
  | `Rows()`, `RowItemIds()` | `view.rows` (an item row without its live `item`); the item rows' `id`s |
  | `FoldInventoryName`, `CompareInventoryNames`, `ItemFilterCategory`, `ItemGroupLabel` | no row of their own: they order, file and label `view.rows`, which the rows already answer (the game calls none of them directly at 29c37ab) |
  | `ContainerView(Container, Context)` | `props.containers.view { container, context }` → `view` |
  | `UnlockContainer` | `props.containers.unlock` → `{ result, container }` |
  | `ContainerMoveRefusal` (`""` = allowed) | `props.containers.move { container, move, context }` → `refusal` (null = allowed) |
  | `ContainersAtLocation` | `props.containers.at` → `ids` |
  | `ContainerRespawnDue` | `props.containers.respawn { container, now }` → `due` |
  | `PaginateText` | `props.documents.paginate { text, charsPerPage? }` → `pages` |
  | `DocumentOf` | `props.documents.document { document, options? }` |
  | `FDocumentReader(Doc, Open)`; `Document()` | `props.reader.create { document, options?, open? }` (it runs `documentOf` itself; a refusal opens no session) → `{ session, document, view }` |
  | `FDocumentReader::View()`, `Phase()` | `view`; `view.phase` |
  | `FDocumentReader::Step(Action)` | `props.reader.apply { session, ops: [action] }` → `results[0]` |
  | `DoorView` | `props.doors.door { building }` → `door` |
  | `DoorPrompt` | `props.doors.prompt { buildings, player }` → `prompt` |
  | `DoorStep(Buildings, Inside, PlayerItemIds, Action)` | `props.doors.step { buildings, inside?, playerItemIds?, action }` |
  | `FNoticeBoard(Input)`, `View()`, `Step(Action)` | `props.board.create { notices, fluency?, read?, answered?, questStatus? }`; `view`; `props.board.apply` |
  | `GenerateSettlementNotices(Id, Name, Npcs)` | `props.notices.generate { settlementId, settlementName, npcs }` → `articles` (full NoticeArticles) |
  | `PropsCorpusOps()`, `RunPropsOp(...)` | no row: the replay is the runner's. Re-vendor `conformance/props/{containers,documents,doors,notice-board}.json` and `conformance/ui/inventory-cases.json` from core at this library's pin and drive each case as `tests/props_corpus.cpp` does (its header lists the mapping per op: the stateless ops send `input` as the args; `read`, `board`, `inventory` are one create and one apply per step; a door `session` keeps `inside` host-side; `generate` projects the articles) |

  The sessions are `props.reader`, `props.board` and `inventory` (dispose each
  with `session.dispose`). Every row answers in exactly the JSON the corpora pin,
  so the `FJsonValue` code around the calls stays; what goes is the port's own
  rules.
- **Pick-up settle (Unreal's `P6.unreal.retire-pickup-settle`, after
  PL.native-pickup-settle; U91(2), U89(3)).** The interim settle in
  `Private/InsimulVillageProps.cpp` (unreal main a0ec591 lines 515–797; at
  `feat/p6-unreal` 29c37ab, VP:513–790, the lines core cites) is core's
  `src/props/pickup-placement.ts` now, through the `props.pickups.*` rows
  (`README.md`, "The pick-up settle rows"). What the block keeps is what is the
  engine's: walking the level for what stands (the actor and mesh walk, its
  `Ground` kinds and plant test, each mesh's bounds through its transform) and
  the navmesh. What goes is the rule:

  | In the settle block | Row (and what the binding sends or reads) |
  |---|---|
  | `FObstacle` statics (each mesh's footprint: `C`, `Half`, `Ax`, `ZMin`/`ZMax`; a plant over 250 cm as its trunk at the pivot) | `obstacles: [{ kind: prop \| building \| plant, at, half, axis, pivot?, yMin, yMax }]` — the box as measured, ÷ 100; core decides ground pieces, ground cover, trees by their trunk and the height band itself (`props-pickup-placement.constants`), so state a plant's full footprint and pivot, not the trunk |
  | `Movers`: villagers (40 cm, 150 cm off), doors (60 cm, 200 cm off), containers (50 cm) | `obstacles: [{ kind: villager \| door \| container, at }]` (the radius is core's unless stated) |
  | `FRoadSeg` from the world's `roads` (`width` or 3 m) | `roads: [{ waypoints, width? }]` as the world states them (core joins the waypoints and breaks a road at one that is not a point) |
  | `Near(At, 2100)` (the cull) | nothing: core reads every obstacle stated (deviation `no-culling`); a binding may still send only those within 21 m (`constants.cullRadiusM`) of the spot |
  | `Clearance(At, …)` | `props.pickups.clearance` → `{ ok, clearanceM, nearest: { kind, index } }` (read `ok` first; `nearest.index` is into the list sent) |
  | `OnNav(At)` (navmesh within 30 cm) | `walkable` areas — no callback crosses the C ABI. Either send the navmesh as areas, or settle with `walkable` absent and keep `OnNav` as the binding's own check of the answer (deviation `walkable-areas`) |
  | the ring search (`Radius` 50 → 2000 cm, 8–64 steps), `Was`/`Found`/`bClear`, `Shift > 1.0` | `props.pickups.sequence { pickups: [{ spot, groundY }], … }` in `S.PickUps` order → `placements[i]`: `ok` and `at`, `moved`, `shiftM`, `ring`; `{ ok: false, code: no-clear-spot, clearest }` is Unreal's "NO clear spot within 20 m, the clearest taken" — draw it at `clearest.at` (deviation `refuse-when-nothing-clear`) |
  | `P.Approach` (16 headings, probes 60/150/250/350 cm) | `approach.heading` (core's `(x, z)`, so Unreal `(X, Y)`), `headingDeg`, `roomM` |
  | the `UE_LOG` lines | the same facts from the answer: `authored.clearanceM` and `.nearest` (`Was`, `WasNear`), `clearanceM`, `nearest` |

  **Frames** (`props.contract` → `props-pickup-placement.frames.unreal`): every
  point is Unreal's `(X, Y)` ÷ 100 as core's `(x, z)` and its `Z` ÷ 100 as `y`
  (`groundY`, `yMin`, `yMax`); a static's forward `Ax` goes as `axis` UNMIRRORED
  (`axis: { x: Ax.X, z: Ax.Y }`, `half: { x: Half.X / 100, z: Half.Y / 100 }`:
  `half.x` is along `axis`, `half.z` across), and the answers come back in the
  same frame. Core's ring and heading angles turn from +x toward +z, which is +X
  toward +Y in Unreal, the same order the block walks. The rows compute in double
  precision, as the corpus's `numerics` asks (several cases decide exactly on a
  boundary). Re-vendor `conformance/props/pickup-placement.json` from core at this
  library's pin and drive each case as `tests/props_corpus.cpp` does (`input` as
  the args of `props.pickups.<op>`, the answer compared whole within the file's
  `tolerance`, the contract's tables held to `props.contract`, the constants on
  their `value`).
- **Save slots: `quickSlot` is 1-based since the eff846a pin** (core's
  PL.quick-slot-one-based). A character or pack config that states
  `quickSlot: 0` (the old "Slot 1") is now refused `quick_slot_out_of_range`, and
  F5/F9 answer that refusal and write nothing: state `1`. The resolved `config`'s
  `quickSlot` is still the session's 0-based index.
- **Layout: one more op.** Core f9aef13 added `startClearOutline` to `LAYOUT_OPS`
  (PL.start-clearance, U78): the `layout.startClearOutline` row answers it, and
  `Tests/layout_corpus_ops.h` needs the matching entry when Unreal re-vendors
  `conformance/layout/settle.json`.

## Unity

- `scripts/fetch-native.sh` already copies `libinsimulcore`; re-fetch from a
  build of this branch. `Runtime/CoreBridge/InsimulCore.cs` is already a generic
  JSON-in/JSON-out handle and needs no change for the new rows.
- Add one C# translation site per phase (UnityEngine-free where it can be, as
  `Runtime/Prolog/` is): P1 the save system (unwired today) onto `save.*` and
  `ui.saveSlots`; P2 the HUD/notifications/pause (live but engine-local today —
  move the decisions onto `ui.notifications.*`, `ui.pause.*`, `quest.waypoints`'
  compass and `quest.minimapMarkers`); P3 `ui.journal.*`, `quest.completion.*`,
  `quest.markers`; P4 `clock.*`, `weather.*`.
- `Editor/Connect/InsimulEmbedProtocol.cs`, `Runtime/Mechanics/InsimulMechanicSurface.cs`
  and `InsimulModulePacks.cs` say the bridge carries five methods and no packs; with
  this library `prolog.packs` returns the pack text, so `InsimulModulePacks` can stop
  vendoring the packs as game data (its own comment names that as the reason).

## Babylon

- Babylon does not use `libinsimulcore`: its game imports `@insimul/core` as
  TypeScript. Its binding is therefore "call the same core function each row
  wraps" — the "Core behind it" column of the table — so the browser and the
  native engines run one implementation. The rows add no rule of their own (the
  enumeration checks only refuse what core's TypeScript types already forbid), so
  Babylon's call site takes core's answer as it is — `save.decode` /
  `save.migrate`'s outcome included.
- Its corpus runner (vitest) can execute `corebridge/vendor/core/cases/` against
  core directly only through a thin shim mapping each `call` to the core function
  in the table; that shim is Babylon's to write if it wants this gate.

## Godot

- Godot still ships its own fork of the bridge (`gdextension/corebridge/`, core
  `44ea906`, 47 methods). Repointing it at this library is its own task, because
  the two tables differ:
  - **Only in Godot's fork**: the band-120 mechanic rows (`combat.*`,
    `stamina.*`, `perception.*`, `traversal.*`, `skill.*`, `equipment.*`,
    `routine.*`, `mechanic.dispose|sessions|modules`), its conformance runners
    (`prolog.run`, `conformance.run`, `conformance.areas`) and its save projection
    (`save.newGame`, `save.capture`, `save.restore`, `save.summary`). Repointing
    without porting those (they are P9 and Godot-template concerns, outside this
    component) would break Godot's mechanic surface.
  - **Same name, different shape**: Godot's `save.migrate` takes and returns
    `save`, this library's takes and returns `saveFile` (core's own field name in
    the envelope); Godot's `save.rules` adds `unregisteredKeys`. Godot's GDScript
    views must adapt when they switch.
  - **Same semantics**: `modules.activate`, `modules.table`, `prolog.packs` were
    carried over unchanged.
- Godot's `insimulcore.h` copy is still diff-identical to this one.
