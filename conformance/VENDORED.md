# Vendored conformance corpus

## `prolog/`

`prolog/` is a mirror of `@insimul/core`'s
`packages/core/conformance/prolog/` (the source of truth; see that package's
`conformance/README.md` for the case format, the order-independence rule, and the
"Amendments for the native harness" notes). Re-sync it with a plain copy of every
`*.json` — never hand-write or hand-edit a case here, or the two engines stop
testing the same thing. Last synced at the KINP identity corpus (`identity.json`,
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
