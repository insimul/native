# insimul-native (libinsimul)

> One real Prolog engine, one C interface, everywhere your game runs — native desktop,
> the browser, and Rust — so every platform reasons over game logic identically.

`libinsimul` is a small C library that embeds a real, ISO-conforming Prolog engine and
exposes it through one stable C interface. It is for anyone who wants to run genuine
logic-programming queries — facts, rules, unification, backtracking — from inside a game
engine (Unity, Unreal, Godot), a Rust program, or a web page, without each of those
platforms shipping its own half-built rules engine.

This repo also builds a second, independent library — [`libinsimulcore`](#a-second-library-libinsimulcore),
described below. It is a separate ABI and does not change anything above.

## The problem it solves

Say your game's logic lives in Prolog — quest preconditions, dialogue rules, world facts.
Each engine you ship on then needs a way to *run* that logic. The tempting shortcut is a
hand-rolled fact-store per engine that does substring or key lookups. Those look fine on
`parent(tom, bob)` and fall apart the moment a rule needs real unification and
backtracking:

```prolog
grandparent(X, Z) :- parent(X, Y), parent(Y, Z).
```

Answering `grandparent(tom, Who)` means chaining two `parent` facts through a shared
variable `Y` — something a lookup table cannot do. And even if three teams each build a
"good enough" engine, they will quietly disagree: different solution orders, different
error messages, different edge cases. A save file produced on one engine can then load
wrong on another.

`libinsimul` replaces all of that with **one** engine behind **one** interface:

- A **real** Prolog engine — [Trealla Prolog](https://github.com/trealla-prolog/trealla)
  (pure C, MIT-licensed), embedded and pinned to an exact commit.
- A single, stable **C ABI** (`include/insimul.h`) that C, C++, C#, GDScript, Rust, and
  JavaScript all bind to.
- The **same** engine on native desktop *and* in the browser (compiled to WebAssembly),
  so a query gives the same answer wherever it runs — and that sameness is enforced by a
  cross-platform test suite, not just asserted.

It is part of the [insimul](https://github.com/insimul) project — a system for building
fictional worlds and games whose canonical state is held in Prolog — but the library
stands on its own: if you need an embeddable Prolog engine with a clean C interface, you
need nothing else from that project to use this one.

## How it works

The whole library revolves around two ideas.

**A knowledge base (KB) is one Prolog world.** You create a KB, load facts and rules into
it (`consult`), add or remove clauses at runtime (`assert` / `retract`), and ask questions
(`query`). Each KB is completely independent — there is no shared global state — so a host
can run many KBs, one per thread. That independence is a hard requirement for game engines
and it is guaranteed by the interface.

**The interface is a plain C ABI, and the engine hides behind it.** `include/insimul.h`
exposes thirteen `extern "C"` functions over two opaque handle types (`insimul_kb`,
`insimul_query`). The header mentions no Trealla types at all — the engine is an
implementation detail that could be swapped without breaking a single caller. Queries
return their solutions as **JSON**, a shape every language can parse:

```text
{ "Var": <value>, ... }        one entry per named variable in your goal
```

so `grandparent(tom, W)` comes back as `{"W":"ann"}`. (The full mapping from Prolog terms
to JSON is in [docs/c-abi.md](docs/c-abi.md).)

## Getting started

You need **CMake ≥ 3.24** and a C toolchain. Nothing is downloaded: Trealla's source is
committed under `vendor/trealla/` at its pinned commit and builds directly into
`libinsimul`, so a clean checkout builds offline.

A **C++17** compiler is also needed, for exactly one target: the
`corebridge_radiant` gate (`tests/radiant/`), which is a byte-for-byte copy of
insimul-godot's. Nothing this repo *ships* is C++ — `project()` declares `C` and
`CXX` is enabled only in the test section.

```sh
cmake -B build
cmake --build build
ctest --test-dir build --output-on-failure
```

That produces `libinsimul.a` (static) and `libinsimul.dylib` / `.so` / `.dll` (shared) in
`build/`, and runs the test suite. The same build also produces `libinsimulcore.a` /
`libinsimulcore.dylib` beside them — see [below](#a-second-library-libinsimulcore).

### A minimal program

```c
#include "insimul.h"
#include <stdio.h>

int main(void) {
    insimul_kb *kb = insimul_kb_create();

    insimul_kb_consult(kb,
        "parent(tom, bob).\n"
        "parent(bob, ann).\n"
        "grandparent(X, Z) :- parent(X, Y), parent(Y, Z).\n");

    insimul_query *q = insimul_query_start(kb, "grandparent(tom, Who)");
    const char *solution;
    while ((solution = insimul_query_next(q)) != NULL)
        puts(solution);                 // prints: {"Who":"ann"}
    insimul_query_stop(q);

    insimul_kb_destroy(kb);
    return 0;
}
```

Two rules of thumb: text you pass to `consult` is one or more full clauses, each ending in
a `.`; text you pass to `assert`, `retract`, and `query_start` is a **single term with no
trailing full stop**. Returned strings are owned by the library — copy anything you want
to keep, and never free it. The full contract is in [docs/c-abi.md](docs/c-abi.md).

### From other languages

You do not have to call C directly. The same engine is available:

- **Rust** — a safe, idiomatic `KnowledgeBase` crate with RAII handles and `Result`s. See
  [rust/README.md](rust/README.md).
- **JavaScript / the browser** — the identical engine compiled to WebAssembly, published
  as an ES-module package. See [docs/webassembly.md](docs/webassembly.md).

```rust
// Rust
let mut kb = KnowledgeBase::new()?;
kb.consult("parent(tom, bob).\nparent(bob, ann).\n")?;
kb.assert_fact("grandparent(X, Z) :- parent(X, Y), parent(Y, Z)")?;
for solution in kb.query("grandparent(tom, Who)")? {
    println!("{:?}", solution?.get("Who"));   // Some(Atom("ann"))
}
```

```js
// Browser / Node
const insimul = await loadInsimul();
const kb = insimul.createKb();
kb.consult(`parent(tom, bob).
grandparent(X, Z) :- parent(X, Y), parent(Y, Z).`);
for (const { Who } of kb.solutions('grandparent(tom, Who)')) console.log(Who);  // ann
kb.destroy();
```

## A second library: libinsimulcore

Everything above describes `libinsimul`. This repo builds one more library beside it:
**`libinsimulcore`** — `@insimul/core`'s TypeScript running in an embedded QuickJS,
behind its own C ABI ([`corebridge/include/insimulcore.h`](corebridge/include/insimulcore.h)),
so Godot, Unity and Unreal bind one core bridge instead of forking three.

Same repo, same CMake, same packaging — but a **separate ABI, deliberately not merged
into `insimul.h`**. The only edge between the two is that `libinsimulcore` consumes
`libinsimul`'s public ABI exactly as a game plugin does; no `insimul_kb` handle ever
crosses `insimulcore.h`. Everything about it lives under
[`corebridge/`](corebridge/README.md), and the linkage recipes for each engine are in
[docs/consuming.md](docs/consuming.md).

Its own tests run under the same `ctest` invocation as everything else: a smoke test
that boots the bridge as a pure consumer of `insimulcore.h`, the **11 radiant
conformance cases** driven through core's real TypeScript on the native Trealla this
repo builds, and a sha256 drift guard over the vendored bundle. The radiant gate is a
byte-for-byte copy of Godot's, so "moving the bridge here changed nothing" is a `diff`
rather than a claim — see
[`conformance/RADIANT_PARITY.md`](conformance/RADIANT_PARITY.md). A second leg runs the
same corpus against an implementation that emits nothing, which is what stops the first
from passing vacuously: at least one case must expect quests for that leg to classify
correctly.

## Repository layout

| Path | Contents |
|---|---|
| [`include/insimul.h`](include/insimul.h) | The stable C ABI — the entire public contract. |
| [`corebridge/`](corebridge/) | The second library — `libinsimulcore`, its ABI, its vendored QuickJS and `@insimul/core` bundle. |
| [`src/`](src/) | The implementation: `insimul.c` (the C layer) and `insimul_boot.pl` (the Prolog-side helper it drives). |
| [`rust/`](rust/) | The Rust bindings — a `-sys` crate and a safe `insimul` crate. |
| [`wasm/`](wasm/) | The hand-written JS wrapper for the WebAssembly build. |
| [`vendor/trealla/`](vendor/trealla/VENDORED.md) | The Prolog engine's source, committed unmodified at a pinned commit — the build fetches nothing. Never hand-edit. |
| [`conformance/`](conformance/) | The shared Prolog test corpus and the cross-platform parity records. |
| [`tests/`](tests/) | The C and JS test executables run by ctest. |
| [`scripts/`](scripts/) | Build (`build_wasm.sh`), package (`package.sh`), and parity (`conformance_parity.sh`) helpers. |
| [`docs/`](docs/) | The guides linked below. |
| [`CMakeLists.txt`](CMakeLists.txt) · [`cmake/`](cmake/) | The build, including the wasm cross-build (`cmake/wasm.cmake`). |

## Going deeper

The core README stops here on purpose; each topic has a focused guide:

- **[The C ABI](docs/c-abi.md)** — every function, the binding-set JSON format, and how the
  library keeps engine types out of the interface.
- **[The WebAssembly target](docs/webassembly.md)** — building for the browser, the JS
  wrapper's ownership rules, and why it is the same engine as native.
- **[Snapshot & restore](docs/snapshots.md)** — saving a KB to disk and loading it back, the
  deterministic text format, and the one operator-declaration gotcha.
- **[The conformance suite](docs/conformance.md)** — how the library proves it gives the
  *same* answers across C, Rust, and WebAssembly, byte for byte.
- **[Packaging & versioning](docs/packaging.md)** — producing redistributable packages and
  the single-source-of-truth version stamp.
- **[Consuming the library](docs/consuming.md)** — the file layout each game engine (Unity,
  Unreal, Godot) and each JS bundler expects.
- **[Build configuration & platforms](docs/build-configuration.md)** — engine feature flags,
  the thread model, and the supported-platform matrix.
- **[The SWI-Prolog spike](docs/SWIPL_SPIKE.md)** — a *second* Prolog engine built behind
  the same twelve functions (`-DINSIMUL_ENGINE=swipl`), on the native embed target **and
  on wasm**, how to reproduce both builds, the browser payload each engine costs, and
  every place the ABI could not be implemented over it cleanly. Evidence for decision D20;
  it decides nothing.
- **[SWI-Prolog vs Trealla, measured](docs/SWIPL_MEASUREMENT.md)** — the spike's answer:
  size, startup and resident memory for both engines on all three legs (native, Rust,
  wasm), the 76-case corpus compared **byte for byte** engine-against-engine, and a plain
  verdict. Regenerate the whole thing with `scripts/measure.sh`; the world it measures is
  the committed fixture in [`bench/world/`](bench/world/README.md).
- **[Engine-leak audit of the C ABI](docs/ABI_ENGINE_LEAK_AUDIT.md)** — every place the
  Prolog engine underneath is still visible through the ABI, with a verdict per finding
  and the probe that witnesses each one.
- **[Trealla's license, resolved](docs/TREALLA_LICENSE_FINDING.md)** — what the engine's
  license actually is (SPDX `MIT`), read from the text at the pinned commit because
  GitHub's API cannot classify it, plus the exact `NOTICE` text to ship.

## License, attribution and the name

libinsimul is licensed under **Apache-2.0** — see [`LICENSE`](LICENSE).

**[`NOTICE`](NOTICE) is the attribution that has to travel with every copy** (Apache-2.0
§4(d)): what is compiled into these binaries, from whom, under what terms, and the full
MIT / BSD-2-Clause / Unlicense texts that require the permission notice itself to be
reproduced rather than merely named. This repository is layer zero — four engine plugins,
a Rust server and every save file sit on it — so **the obligations in `NOTICE` §1 are
inherited by anything that ships a `libinsimul` artifact**, not discharged here on its
behalf. The BSD-2-Clause one is live rather than a formality: the Prolog standard library
is embedded in every artifact, and its clause 2 asks for the notice in the documentation
shipped alongside.

The embedded Trealla Prolog engine is **MIT** and the components it bundles are MIT,
BSD-2-Clause and Unlicense — all redistributable in the prebuilt binaries. That was
resolved by reading the license texts in the pinned source, not by trusting a classifier
(GitHub's API reports `NOASSERTION` for Trealla and is wrong):
[`docs/TREALLA_LICENSE_FINDING.md`](docs/TREALLA_LICENSE_FINDING.md) records the finding.
Pins and provenance are in [`THIRD_PARTY.md`](THIRD_PARTY.md) — the Trealla commit for
`libinsimul`, and QuickJS plus the generated `@insimul/core` bundle for `libinsimulcore`.
Each pin has exactly one authoritative location, read by the build, so a version stamp
cannot claim something other than what was compiled — and the `attribution` ctest checks
each `NOTICE` stanza's pin against that location, so an attribution cannot name a
different drop than the bytes shipped.

**The code is open; the name is not the code.** The trademark and conformance-mark policy
— what you may call "Insimul", and what "Insimul-compatible" requires — is authored once,
in the contract repository, and linked from here rather than copied:
**[Trademark and conformance-mark policy](https://github.com/insimul/core/blob/main/TRADEMARK.md)**.
A copy of it in this tree is a gate failure, not a contribution.

Contributions: [`CONTRIBUTING.md`](CONTRIBUTING.md) — DCO 1.1 sign-off, no CLA. The
pre-open checklist this repository was measured against, item by item, is
[`docs/pre-open-audit.md`](docs/pre-open-audit.md) and
[`docs/pre-open/status.json`](docs/pre-open/status.json).
