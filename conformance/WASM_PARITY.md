# three-leg conformance parity (native ⟷ wasm ⟷ Rust)

**Status: no divergences.** The native build, the Emscripten/wasm32 build and the
Rust wrapper produce **byte-identical** results on all **76** cases of the golden
Prolog corpus — same pass/fail, same solution count, same solution *text* from
`insimul_query_next()`, in the same order.

| leg | command | result |
|---|---|---|
| native (C ABI) | `ctest --test-dir build -R conformance` | 10 files, 76 cases, 76 passed, 0 failed, 1 amended |
| **Rust wrapper** | `cargo test --manifest-path rust/Cargo.toml` | 10 files, 76 cases, 76 passed, 0 failed, 1 amended |
| **wasm32** | `ctest --test-dir build-wasm -R wasm_conformance` | 10 files, 76 cases, 76 passed, 0 failed, 1 amended |
| **cross-leg diff** | `scripts/conformance_parity.sh` | PASS — 76/76 records identical on all three |

(The Rust leg joined the diff in tasklist 251 US-2. It was always run, but its
records were not compared, so only two of the three legs were actually diffed —
and the two that were share the same C code.)

This is the evidence that swapping tau-prolog for this build in the web runtime
does not change behaviour: it is the *same engine source* (`src/insimul.c` +
the same pinned Trealla commit), not a reimplementation, and the corpus confirms
the toolchain change did not perturb it.

## Why a diff, and not just "both legs are green"

Two harnesses can both agree with `expected` and still disagree with each other
— on the order of an `unordered` case, on error wording, or on number
formatting. So the gate is not "both passed". Both legs write one JSON-Lines
record per case (`INSIMUL_CONFORMANCE_JSON=<path>`) holding the **raw** string
`insimul_query_next()` returned, before any reparsing. The Rust leg reaches those
strings through `KnowledgeBase::solve_raw`, which exists for this and returns the
undecoded JSON rather than `Bindings`:

```jsonl
{"area":"unification","name":"ground-match-success","status":"pass","amended":false,"solutions":["{}"]}
{"area":"gameplay-predicates","name":"available-quests-by-status","status":"pass","amended":false,"solutions":["{\"Q\":\"q1\"}","{\"Q\":\"q3\"}"]}
```

`scripts/conformance_parity.sh` runs all three legs and `diff`s each against
native. A single differing byte fails the script and prints the offending case. A
missing toolchain is a hard failure, not a silent skip — `--no-rust` is how you
say "not this time" out loud.

## What runs, and how it cannot rot

- `tests/wasm_conformance.mjs` drives the corpus through `wasm/insimul-api.mjs`
  — i.e. through the thirteen `insimul.h` entry points a browser consumer uses,
  not through some test-only shortcut.
- It is registered as the **`wasm_conformance` ctest** in `cmake/wasm.cmake`, so
  `scripts/build_wasm.sh` — the one command that builds the wasm target — runs
  it every time. There is no way to build wasm without running the corpus.
- Corpus resolution is the repo-wide order (`--corpus` → `INSIMUL_CONFORMANCE_DIR`
  → vendored `conformance/prolog` → sibling `../insimul-runtime/...`), identical
  to the C and Rust legs, so all three legs read the same vectors.

## Non-vacuity

This repo has shipped a gate that passed by executing nothing. Every one of
these is a hard failure (exit 2), and each was verified by deliberately
triggering it:

| condition | result |
|---|---|
| corpus directory missing | exit 2 |
| corpus directory has no `*.json` | exit 2 |
| a corpus file has an empty `cases` array | exit 2 |
| a corpus file is unparseable | exit 2 |
| fewer cases executed than the corpus declares | exit 2 |
| `--min-cases` / `INSIMUL_CONFORMANCE_MIN_CASES` floor not met | exit 2 |
| a case's solutions don't match `expected` | exit 1 |
| wasm executed fewer cases than native (parity script) | exit 1 |

`cmake/wasm.cmake` additionally refuses to *configure* a wasm build if the
corpus directory holds no files, so the test can never be generated with
nothing to run.

## The one amendment

The corpus is authored against tau-prolog. One case carries a documented,
printed amendment, applied identically by all three legs (the `AMENDMENTS`
tables in `tests/conformance.c`, `rust/insimul/tests/conformance.rs` and
`tests/wasm_conformance.mjs` are kept in lockstep):

- **`assert-retract / asserta-prepends`** — the case uses `log/1` as a user
  dynamic predicate. ISO reserves `log` only as an *evaluable functor*, so
  tau-prolog accepts it; Trealla additionally registers `log/1` as a **static
  builtin predicate** (`src/bif_functions.c`), so `asserta(log(0))` raises
  `permission_error(modify, static_procedure, log/1)`. The case tests
  asserta-before-assertz ordering, not the name, so the predicate is renamed to
  `entry`. Every leg prints an `[AMEND]` line and counts it in the summary.

This is a **Trealla-vs-tau** difference, not a **wasm-vs-native** one: it
reproduces identically in both builds, which is why the parity diff is clean.
It is flagged for human review in `.chief/state/progress.txt`.

## If a divergence ever appears

Do **not** skip the case and do **not** narrow the corpus. Add a row here
naming the case, the observed difference, and whether it is acceptable — then
decide whether the web runtime can ship it. A wasm build that quietly diverges
is worse than no wasm build, because every browser would get the divergence.
