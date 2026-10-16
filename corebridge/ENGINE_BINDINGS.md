# What each engine's binding must add (Features Round C0)

This component changed no engine. It made `libinsimulcore` answer the feature
phases' methods (`README.md`, "The method table"); this page is the list of what
each engine has to do before a phase can use them. Engines are listed in the
operator's order (Unreal, Unity, Babylon, Godot). Nothing here is done yet.

## Common to Unreal, Unity and Godot

1. **Take the new library.** The C ABI is unchanged — `insimulcore.h` is
   byte-identical, `INSIMULCORE_ABI_VERSION` is still `0.1.0`, the five functions
   behave as before — so a binding recompiles against nothing new. What changed is
   the bundle inside it (core `5ce94d7`, 42 methods instead of 5) and the size of
   the library (the bundle is ~604 KB of JS instead of 54 KB). Re-fetch or re-stage
   the built `libinsimulcore` (Unity `scripts/fetch-native.sh`, Unreal
   `Source/ThirdParty/InsimulCoreLibrary/lib/`, Godot below) and quote the
   version stamp (`insimul_core_version()`, which names the core commit) in the
   change.
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
   unchanged day reports no event (observed at core `5ce94d7`: day 2 → 6 over the
   monsoon world turns dry/dust into wet/downpour on day 5 and emits nothing). Read
   the `view` (or the per-step `conditionChanged` / `seasonTurned` in `results`)
   after every advance. Reported to core as a finding; the bridge reproduces core.
7. **Errors.** On NULL, read `insimul_core_last_error()`; when it contains
   `[<code>]` (genre resolution refusals today), that bracketed code is the
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
  native engines run one implementation. Where a row adds a boundary rule (the
  enumeration checks, `save.decode`'s filled `orphanExtensionKeys`), Babylon's
  call site must make the same decision or the cross-engine checks will differ.
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
