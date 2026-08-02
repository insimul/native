# Radiant bridge parity — insimul-native ⟷ insimul-godot

`libinsimulcore` was promoted into this repo from
`insimul-godot/gdextension/corebridge/` (tasklist 104, US-1). The adoption that
justified it was proved *there*: 11 radiant conformance cases driven through
`@insimul/core`'s real TypeScript over the native Trealla engine. US-2's job is to
show that claim still holds from here — and to **record any behaviour difference**,
because a difference would mean an environment dependency Unity and Unreal will
also hit.

## There is none. The two runs are byte-identical.

Not "both green" — the same bytes. That is achievable because the comparison code
is literally the same file (see below), so the only expected difference is the
line naming the corpus directory.

```
$ bash tests/run_radiant.sh build/insimulcore_radiant conformance/radiant core     > native.txt
$ ( cd ../insimul-godot && INSIMUL_NATIVE_DIR=<this repo> \
      bash gdextension/test/run_radiant_tests.sh )                                 > godot.txt
$ diff <(normalize godot.txt) <(normalize native.txt)     # normalize = mask the corpus path
                                                          # (no output)
```

Both legs print:

```
libinsimulcore 0.1.0 (quickjs 2025-04-26, core 443cce783eddea790d4a1f07b90018047ca36845)
adopted surface: {"methods":["core.methods","quest.hydrate","quest.radiantTick","radiant.baseTemplates","radiant.generate"]}
Radiant conformance corpus (…) — source=core
empty.json (radiant-empty)
  ✓ empty-unsatisfiable-precondition (0 quest(s))
  ✓ empty-no-templates (0 quest(s))
exclusion-cooldown.json (radiant-exclusion-cooldown)
  ✓ exclusion-suppresses (0 quest(s))
  ✓ cooldown-active-suppresses (0 quest(s))
  ✓ cooldown-elapsed-regenerates (1 quest(s))
maxquests.json (radiant-maxquests)
  ✓ maxquests-cap-across-templates (1 quest(s))
  ✓ two-templates-both-generate (2 quest(s))
multi-slot.json (radiant-multi-slot)
  ✓ multi-slot-join (1 quest(s))
single-slot.json (radiant-single-slot)
  ✓ single-slot-fill-one-candidate (1 quest(s))
  ✓ single-slot-fill-multi-candidate (1 quest(s))
  ✓ single-slot-fill-alt-seed (1 quest(s))

11 case(s) executed from 5 corpus file(s)
PASSED: 11 case(s), all 5 areas
```

The `--source none` leg matches too, classification included:
`4 AGREE, 7 GAIN, 0 REGRESSION`.

This file is where a future divergence gets **documented**, never skipped — the
same discipline [`WASM_PARITY.md`](WASM_PARITY.md) applies to the Prolog legs.

## Why identity is a diff and not an argument

Four files under `tests/radiant/` are byte-for-byte copies of insimul-godot's:

| here                              | there                                          |
| --------------------------------- | ---------------------------------------------- |
| `tests/radiant/radiant_bridge.cpp`| `gdextension/test/test_radiant_bridge.cpp`     |
| `tests/radiant/json_value.{h,cpp}`| `gdextension/src/json_value.{h,cpp}`           |
| `tests/radiant/canonical_json.{h,cpp}` | `gdextension/src/canonical_json.{h,cpp}`  |
| `tests/radiant/sha256.{h,cpp}`    | `gdextension/src/sha256.{h,cpp}`               |

Verify with a literal `diff` (all four pairs must be silent). Their include
guards still read `INSIMUL_GODOT_*` and their comments still say "the Godot twin
of …" — **left untouched on purpose**, exactly as `insimulcore.h` was in US-1. A
copy you have "tidied" is a copy you can no longer diff.

They are std-only (no godot-cpp, no Godot binary), which is why they build here
under a plain C++17 toolchain. This is the *only* C++ in this repo; `project()`
still declares `LANGUAGES C` and `enable_language(CXX)` is called in the test
section of `CMakeLists.txt`.

These are **test support utilities, not a contract**. Unlike `insimulcore.h` —
which three engines bind and which must never fork — nothing links against these,
so a copy is the right shape. The rule that applies to them is only that the copy
stays a copy: re-diff after any change on either side.

## What the corpus was run through

Not a re-implementation, and not a stub:

- `insimul_core_call(core, "radiant.generate", …)` — core's actual
  `radiant.generate`, executing the vendored `@insimul/core` bundle inside the
  embedded QuickJS.
- Core's radiant algorithm is **Prolog-driven**, and the bridge's
  `corebridge/js/host-prolog-engine.js` routes those goals to `libinsimul` — the
  native Trealla engine built from this repo's own `src/`. That is why the gate
  links `insimulcore` (which re-exports `insimul`) rather than faking an engine.
- The gate asserts `radiant.generate` is on the reported method surface *before*
  running anything, so a bundle that lost it fails loudly instead of silently
  returning zero quests.

## The floor that keeps the gate from passing on nothing

`radiant_bridge.cpp` carries `MIN_CASES = 11` and five `REQUIRED_AREAS`
(`radiant-single-slot`, `radiant-multi-slot`, `radiant-exclusion-cooldown`,
`radiant-empty`, `radiant-maxquests`). Growing the corpus does not break the gate;
shrinking it does. Zero cases, a missing area, or a duplicate case name is a
failure, not a pass.

Three more places refuse to be vacuous, cheapest-to-fail first:

1. **Configure time** — `CMakeLists.txt` `message(FATAL_ERROR …)` if the resolved
   radiant directory holds no `*.json`. A checkout whose gate has nothing to run
   cannot be generated.
2. **Run time** — `tests/run_radiant.sh` re-checks the directory it resolved
   (`INSIMUL_RADIANT_DIR` env → the vendored `conformance/radiant` → the sibling
   `../insimul-runtime/packages/core/conformance/radiant`, the order CLAUDE.md
   fixes for every corpus here). It **never** skips: both of its dependencies are
   in-repo, so a missing one is a broken checkout, not an absent optional tool.
3. **The `none` leg** — asserts `gain > 0`, i.e. that the corpus expects quests
   somewhere. A corpus of nothing-but-empty-expectations would let the `core` leg
   pass while proving nothing; this catches that.

## insimul-godot is untouched

`insimul-godot/gdextension/corebridge/` and its `run_radiant_tests.sh` still
exist and still pass (that is one half of the diff above). Repointing Godot at
the promoted bridge is a change in *that* repo and belongs to its own tasklist;
leaving both briefly is safer than breaking a working adapter from outside it.
