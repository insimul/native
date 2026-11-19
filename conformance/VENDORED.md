# Vendored conformance corpus

## `prolog/`

`prolog/` is a mirror of `@insimul/core`'s
`packages/core/conformance/prolog/` (the source of truth; see that package's
`conformance/README.md` for the case format, the order-independence rule, and the
"Amendments for the native harness" notes). Re-sync it with a plain copy of every
`*.json` — never hand-write or hand-edit a case here, or the two engines stop
testing the same thing. Last synced at core `45409ed` (PL.native-bundle-core-r2,
2026-11-19, the commit `corebridge/core-pin.json` pins): every one of the 12 files the
mirror holds re-copied as it stands, and only `pack-agreement.json` moved (core's
PL.core-dead-readers, 55264c4 and 14d9387: the packs' `schedule/4` and funeral
candidate read both death facts, a recorded death outranking an unretractable
`alive/1`, U126(1); 16 of its 22 cases carry the changed pack clauses, no answer
changed). Still 12 files, 181 cases. The mirror is still a SUBSET of core's
`conformance/prolog/` (37 files at 45409ed: alive-negation.json and death-readers.json joined after d88b6f0); widening it to all of them is
PL.native-prolog-mirror-full's row (U120(9)), not this sync's.
Before that, synced at core `d88b6f0` (PL.native-bundle-core,
2026-11-16): every file the mirror holds
re-copied (only `worlds.json` moved: core's work/canon split, one case renamed
`playthrough-role-links-a-save-to-its-parent-world` and one added, 12 -> 14), and two
of core's files added that the core items PL.core-helper-aggregate-all,
PL.core-helper-sum-list and PL.core-prolog-predicate-dups deferred to this re-vendor:
`quest-count-goals.json` (81 cases: the count and total clauses of core's quest
helper program, `avg-pronunciation-mean` and `avg-pronunciation-none` among them) and
`pack-agreement.json` (22: core's packs loaded together). 12 files, 181 cases. The
mirror is still a SUBSET of core's `conformance/prolog/` (35 files at d88b6f0): the
`mechanic-*`, `agent-ai`, `geo-map`, `placement` and `scaffold` files are not here.
Before that, synced at the KINP identity corpus (`identity.json`,
`equivalence.json`, `worlds.json` + the rewritten `gameplay.json`), where entity
atoms became CURIEs. Regenerate on schema change — the engine repos (`insimul-godot`, `insimul-unity`,
`insimul-unreal`) vendor the same files the same way, so every standalone parity
gate runs identical cases.

Consumers here:

- `tests/conformance.c` (ctest `conformance`) — the C ABI gate.
- `rust/insimul/tests/conformance.rs` (`cargo test`) — the Rust wrapper gate.

Both resolve the corpus as: `INSIMUL_CONFORMANCE_DIR` (env, absolute) → this
vendored directory → the monorepo sibling
`../insimul-runtime/packages/core/conformance/prolog`.

## `radiant/`

`radiant/` is a mirror of the same source of truth's
`packages/core/conformance/radiant/` — 5 files / 11 cases, the vectors
`packages/core`'s own runner (`src/conformance/__tests__/radiant-corpus.test.ts`)
executes, unreduced. It was copied here from `insimul-godot/conformance/radiant/`
(itself vendored from core via that repo's `tools/vendor-conformance.mjs`), and
every file's sha256 was checked against the `files` map in
`insimul-godot/conformance/VENDORED.json` at the time of the copy — all five
matched, at core commit `443cce783eddea790d4a1f07b90018047ca36845`:

```
3a69927ed5ff65e84676209eb80bd63395d04d29094a8e368c919e193b82e10c  empty.json
db1b2bf3f21e8ff038547752c69d2e868d68bfad3a53d4f3e152998247baa5b1  exclusion-cooldown.json
7a06156d4fc7db1a47dba9d39e64d91301f95f90518c834211babfb3e182efb1  maxquests.json
0a2409368f9657d276a69ab71e7205db01a11a4422e067d0187c5c4b3771eac9  multi-slot.json
9274cda73e0c209148d9bde1b2146749bcf79e269fda6180cb955eb81e55a996  single-slot.json
```

Re-sync it the same way `prolog/` is re-synced: a plain copy of every `*.json`,
never a hand-edit. Re-check the digests above (`shasum -a 256 conformance/radiant/*.json`)
against core's after any re-sync, and update them here.

Consumer here:

- `tests/radiant/radiant_bridge.cpp` (ctests `corebridge_radiant` and
  `corebridge_radiant_none`) — the `libinsimulcore` gate. It resolves the corpus
  as `INSIMUL_RADIANT_DIR` (env, absolute) → this vendored directory → the
  monorepo sibling `../insimul-runtime/packages/core/conformance/radiant`, and
  **hard-fails** on a missing or empty one at both configure and run time. See
  [`RADIANT_PARITY.md`](RADIANT_PARITY.md).

Unlike `prolog/`, this corpus drives the **second** library in this repo
(`libinsimulcore`), not `libinsimul` — though core's radiant algorithm runs its
Prolog goals on `libinsimul` underneath, so a regression in either surfaces here.

## Not vendored

`snapshots/` is not vendored: it holds this repo's own golden snapshot fixture
(US-LI4).
