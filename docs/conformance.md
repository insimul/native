# The conformance suite

This doc explains how libinsimul proves it computes the *right* answers — and, just as
importantly, the *same* answers across every language binding. If you are changing the
engine pin, adding a binding, or wondering why a query behaves the way it does, this is the
gate that keeps the four ways of calling the library honest.

## What it guarantees

A shared corpus of Prolog query cases is run through **every** binding of the library, and
their answers are compared — not just against the expected results, but against each other,
byte for byte. Three legs run the identical corpus:

| Leg | Runner | How to run |
|---|---|---|
| **Native C** | `tests/conformance.c` (the `conformance` ctest) | `ctest --test-dir build -R conformance` |
| **Rust** | `rust/insimul/tests/conformance.rs` | `cargo test -p insimul --test conformance` |
| **WebAssembly** | `tests/wasm_conformance.mjs` (the `wasm_conformance` ctest) | `scripts/build_wasm.sh` |

All three print the same `files / cases / passed / failed / amended` summary — currently
**20 files, 420 cases, 420 passed, 1 amended** at core 45409ed (261 cases in 15 files before
PL.native-prolog-mirror-full slice 2 added `mechanic-puzzle.json`, `mechanic-platformer.json`,
`mechanic-business.json`, `mechanic-crafting.json` and `mechanic-equipment.json`; 181 in 12
before slice 1 added `geo-map.json`, `mechanic-farming.json` and `mechanic-strategy.json`; 76 before core d88b6f0's `quest-count-goals.json` and
`pack-agreement.json` joined the mirror) — so a divergence between the C ABI and any
binding shows up immediately as a differing count.

## The corpus format

Each corpus file (`conformance/prolog/*.json`) is a list of cases:

```json
{ "area": "unification",
  "cases": [
    { "name": "simple-fact-binding",
      "kb": ["parent(tom, bob)."],
      "query": "parent(tom, X)",
      "expected": [{ "X": "bob" }] } ] }
```

For every case the harness creates a fresh KB, consults the `kb` clauses, runs `query`
through the ABI, and compares the collected [binding sets](c-abi.md#binding-set-json-format)
against `expected` as an **unordered multiset**, as core's `conformance/README.md`
("Order-independence") and core's own runner say: the same number of solutions, each matched
once, in any order (U120(9)). The C and wasm legs put five probes straight to their
comparator, both solution lists given, and refuse to grade a corpus if one fails. The Rust
leg's `order_is_not_significant_but_multiplicity_is` runs six probes through the engine
instead: its answers to `p(X)` are fixed at `a, b` and only `expected` varies. Both cover the
same four properties: a reordered list matches, and a wrong multiplicity, a member never
bound and an extra one do not. The order the legs enumerate in is still compared, across
legs, by the parity diff below. The mirror's bytes are held to core's at the pin by the
`prolog_mirror_digest` ctest, and inside the monorepo, by default, the record itself is held
to the sibling core's git objects (see [../conformance/VENDORED.md](../conformance/VENDORED.md)).

The corpus also carries the identity layer used by the wider platform — entity atoms are
CURIEs such as `'insimul:ent:<id>'` and world-scoped `'insimul:world:<w>:ent:<id>'`, and
`kb`/`query` may contain compound terms. A CURIE is always a **quoted atom**, never a term
to decompose.

## Running it directly

```sh
ctest --test-dir build -R conformance --output-on-failure
./build/insimul_conformance          # prints the per-case PASS/FAIL table
```

The corpus directory is resolved from the `INSIMUL_CONFORMANCE_DIR` environment variable,
falling back to the vendored `conformance/prolog` (see **Where the corpus comes from**
below). Point the variable elsewhere to run a corpus from any checkout:

```sh
INSIMUL_CONFORMANCE_DIR=/path/to/conformance/prolog ./build/insimul_conformance
```

**The harness never passes vacuously.** A missing/unreadable corpus directory, a directory
with no `*.json` files, an unparseable corpus file, or zero executed cases all exit
non-zero. Nothing is silently skipped.

## Cross-leg parity — a diff, not two checkmarks

Setting `INSIMUL_CONFORMANCE_JSON=<path>` makes any leg additionally write one JSON-Lines
record per case — area, name, status, and the **raw** solution strings the ABI returned.
`scripts/conformance_parity.sh` runs the native and wasm legs that way and diffs the records
case by case:

```sh
scripts/conformance_parity.sh        # builds whatever leg is missing, then compares
```

Because it compares the *raw* strings, it catches a divergence in solution order, error
wording, or number formatting that each leg's own `expected` check would happily pass.
Result today: **420/420 byte-identical**. The full record, and the non-vacuity gates each
verified by deliberately triggering them, live in
[../conformance/WASM_PARITY.md](../conformance/WASM_PARITY.md).

## Documented amendments

Where the engine diverges from the ISO-correct reference behavior, the harness applies an
explicit, **printed** textual amendment to the affected case rather than skipping it, and
flags it for human review (the `[AMEND]` lines and the `AMENDMENTS` table in each leg). The
three legs' amendment tables stay in lockstep so the counts remain comparable.

The only current amendment renames the `log/1` user predicate in one assert-ordering case:
ISO reserves `log` as an *evaluable functor* only, but Trealla also registers `log/1` as a
static builtin predicate, so `asserta(log(0))` would raise a `permission_error`. The rename
preserves exactly the assert-ordering behavior the case tests.

## Where the corpus comes from

`conformance/prolog/*.json` is **vendored** here — a byte-identical mirror of the upstream
source of truth (`@insimul/core`'s conformance corpus), the same vendoring the standalone
engine repos do. That is what makes the parity gates runnable from a fresh checkout with no
sibling submodule present. Every leg resolves the corpus the same way:
`INSIMUL_CONFORMANCE_DIR` → the vendored `conformance/prolog` → the sibling runtime
submodule. See [../conformance/VENDORED.md](../conformance/VENDORED.md) for how to re-copy
it on a corpus change.
</content>
