# Vendored conformance corpus

## `prolog/`

`prolog/` is a mirror of `@insimul/core`'s
`packages/core/conformance/prolog/` (the source of truth; see that package's
`conformance/README.md` for the case format, the order-independence rule, and the
"Amendments for the native harness" notes). Re-sync it from core's git objects
with the recorder below, never a hand copy — never hand-write or hand-edit a case
here, or the two engines stop testing the same thing.

**The bytes are held, not only the answers.** `PROLOG_MIRROR.json` (beside this
file, deliberately outside `prolog/` so no leg reads it as a corpus file) records
the sha256 of core's bytes at `corebridge/core-pin.json`'s `coreCommit` for every
mirrored file (`files`) and names every core file not mirrored (`notMirrored`).
**The mirror is complete** (slice 5 below): it holds all of core's files at the pin,
so `notMirrored` is `[]` and must stay so. The ctest `prolog_mirror_digest`
(`tests/prolog_mirror_digest.cmake`, plain `cmake -P`, no node and no skip) refuses
an extra, missing, renamed or changed file, a record taken at any other commit than
the pin, and any name in `notMirrored` ("incomplete mirror": a core file new at a
moved pin, which the recorder lists there with a warning, is refused until it is
recorded with `ADD=`; so is a reverted slice, whose files would be listed there
again). With a core checkout it
also holds the record to core's git objects (core's `conformance/prolog/` at the
pin must be exactly `files` + `notMirrored`, every mirrored file's sha256 its
blob's). The checkout is `-DCORE_DIR`, else `INSIMUL_CORE_DIR`, else **by default
the monorepo's sibling core** when it exists and holds the pin's commit, found from
the mirror's path as the corpus resolver finds its sibling
(`../babylon/packages/core`, then `../insimul-runtime/packages/core`, a list kept
once in `tests/prolog_mirror_sibling.cmake`, which the script and CMakeLists.txt
both include); a sibling
without the pin's commit is named and set aside, and `-DCORE_DIR=` (empty) turns
the record checks off. The PASS line says which check ran and where its core came
from, or why none was used (no sibling holding the pin, a stale sibling, or the
checks turned off by `-DCORE_DIR=`; the ctest `prolog_mirror_digest_optout` holds
that last wording). `prolog_mirror_digest_negative` perturbs a copy seven ways (nine
with a core checkout) and passes only when each is refused for its own named
reason. The ctests do not take the script's word for whether a core was found:
CMake looks for the monorepo's sibling core itself at configure time, and when one
holding the pin is there, `prolog_mirror_digest` must say it held the record to
core's git objects and `prolog_mirror_digest_negative` must refuse **9 of 9**, so a
script that lost its default lookup goes red instead of falling back to
manifest-only and 7 of 7. Both use the one lookup in
`tests/prolog_mirror_sibling.cmake`, so a location added there is required by the
ctests too. If that sibling goes away after configure, the script says so (CMake
hands it `-DEXPECT_SIBLING`) and the ctests go red until cmake is re-run. It exists because a stale `pack-agreement.json` whose answers
had not changed stayed green on every leg (self-sweep M22). **Re-sync with the
recorder, never a hand copy**: bump the pin, then

```
cmake -DMODE=record [-DCORE_DIR=<core checkout>] \
  -DMIRROR_DIR=$PWD/conformance/prolog -DMANIFEST=$PWD/conformance/PROLOG_MIRROR.json \
  -DPIN=$PWD/corebridge/core-pin.json [-DADD="new-file.json;…"] \
  -P tests/prolog_mirror_digest.cmake
```

which copies core's blobs at the pin (never the mirror on disk, so a stale file
cannot be recorded as current) for every file already mirrored plus `ADD`, and
rewrites the record; then run the three legs and update the counts here.

**Order rule.** Every leg compares `expected` as core says (`conformance/README.md`,
"Order-independence"): an unordered multiset, as core's own runner
(`sameSolutionSet`) does — the C leg (`tests/conformance.c`) and the wasm leg
(`tests/wasm_conformance.mjs`) were order-sensitive unless a case said
`"unordered": true` (a key core never states) and now compare as the Rust leg
always did (U120(9)). The C leg (`order_rule_self_check`) and the wasm leg
(`orderRuleSelfCheck`) put five probes straight to the comparator, both solution
lists given, and refuse to grade a corpus (exit 2) if one fails. The Rust leg's
test `order_is_not_significant_but_multiplicity_is` runs six probes of another
shape: six one-case corpora through the real engine (`run_case`), the engine's
answers to `p(X)` fixed at `a, b` and only `expected` varied (its own order and the
reverse pass; `[a,a]`, `[b,b]`, `[c,a]` and `[b,a,a]` fail). Both cover the same
four properties: a reordered list matches, and a wrong multiplicity, a member never
bound and an extra one do not. The order the legs enumerate in is still held,
across legs, by `scripts/conformance_parity.sh`'s raw diff.

**Slice 1 of PL.native-prolog-mirror-full** (2026-11-21, U120(9), U128, U131): at
core `45409ed` (unchanged pin), three of core's files added unchanged —
`geo-map.json` (15 cases, `region_at`), `mechanic-farming.json` (29, `plot_yields`)
and `mechanic-strategy.json` (36, `strategy_can_claim`), the three predicates the
order rule clears — and the 12 already here re-recorded from core's objects (all 12
byte-identical to core at the pin). 15 files, 261 cases, 261 passed, 1 amended
on all three legs.

**Slice 2** (2026-11-23, same pin `45409ed`): five more of core's files added
unchanged through the recorder (`ADD=`) — `mechanic-puzzle.json` (38 cases) and
`mechanic-platformer.json` (28), the two held for this row, which finish the genre
trio with strategy (see CLAUDE.md's genre rows), plus `mechanic-business.json` (39),
`mechanic-crafting.json` (25) and `mechanic-equipment.json` (29). No engine change
and no new amendment: all 159 new cases pass on every leg under the order rule.
The record checks now run by default inside the monorepo (above). 20 files, 420
cases, 420 passed, 1 amended on all three legs.

**Slice 3** (2026-11-23, same pin `45409ed`): six more of core's files added
unchanged through the recorder (`ADD=`) — `mechanic-combat.json` (10 cases),
`mechanic-dialogue.json` (32), `mechanic-fishing.json` (15),
`mechanic-gameplay-state.json` (9), `mechanic-mining.json` (15) and
`mechanic-perception.json` (12). No engine change and no new amendment: all 93 new
cases pass on every leg under the order rule. The digest ctests now require the
sibling core when CMake finds one holding the pin, and the PASS line says when the
record checks were turned off (above). 26 files, 513 cases, 513 passed, 1
amended on all three legs.

**Slice 4** (2026-11-23, same pin `45409ed`): the six remaining `mechanic-*` files
added unchanged through the recorder (`ADD=`) — `mechanic-routine.json` (19 cases),
`mechanic-skill.json` (14), `mechanic-stamina.json` (12),
`mechanic-traversal.json` (22), `mechanic-volition.json` (24) and
`mechanic-weather.json` (27). No engine change and no new amendment: all 118 new
cases pass on every leg under the order rule. The configure-time sibling lookup
and the script's default lookup are now one function in
`tests/prolog_mirror_sibling.cmake` (above). **32 files, 631 cases**, 631 passed,
1 amended on all three legs. Still missing then: the 5 files slice 5 added.

**Slice 5, the last** (2026-11-24, same pin `45409ed`): the five remaining files
added unchanged through the recorder (`ADD=`) — `agent-ai.json` (15 cases),
`alive-negation.json` (8), `death-readers.json` (21), `placement.json` (21) and
`scaffold.json` (32), 97 cases. `alive-negation` and `death-readers` hold the death
reading in which a recorded `deceased/3` outranks an unretractable `alive/1`
(U126(1)). No engine change and no new amendment: all 97 new cases pass on every
leg under the order rule. **The mirror now holds all 37 of core's files at the pin:
37 files, 728 cases**, 728 passed, 1 amended on all three legs, and
`notMirrored` is `[]`. The digest gate now refuses any name there (above), so the
mirror cannot fall back to a subset without going red, which closes slice 4's m1
(a full revert of a slice stayed green). **PL.native-prolog-mirror-full's row is
complete.**

Before that, synced at core `45409ed` (PL.native-bundle-core-r2,
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
- `tests/wasm_conformance.mjs` (ctest `wasm_conformance` in `build-wasm/`) — the
  wasm gate.
- `tests/prolog_mirror_digest.cmake` (ctests `prolog_mirror_digest` and
  `prolog_mirror_digest_negative`) — the digest gate over the bytes.

The three legs resolve the corpus as: `INSIMUL_CONFORMANCE_DIR` (env, absolute) → this
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
