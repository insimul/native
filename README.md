# insimul-native (libinsimul)

> One real Prolog engine, one C interface, everywhere your game runs — native desktop,
> the browser, and Rust — so every platform reasons over game logic identically.

`libinsimul` is a small C library that embeds a real, ISO-conforming Prolog engine and
exposes it through one stable C interface. It is for anyone who wants to run genuine
logic-programming queries — facts, rules, unification, backtracking — from inside a game
engine (Unity, Unreal, Godot), a Rust program, or a web page, without each of those
platforms shipping its own half-built rules engine.

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
exposes twelve `extern "C"` functions over two opaque handle types (`insimul_kb`,
`insimul_query`). The header mentions no Trealla types at all — the engine is an
implementation detail that could be swapped without breaking a single caller. Queries
return their solutions as **JSON**, a shape every language can parse:

```text
{ "Var": <value>, ... }        one entry per named variable in your goal
```

so `grandparent(tom, W)` comes back as `{"W":"ann"}`. (The full mapping from Prolog terms
to JSON is in [docs/c-abi.md](docs/c-abi.md).)

## Getting started

You need **CMake ≥ 3.24** and a C toolchain. On the first configure, CMake downloads
Trealla at its pinned commit (so allow network access and a little extra time), then builds
it directly into `libinsimul`.

```sh
cmake -B build
cmake --build build
ctest --test-dir build --output-on-failure
```

That produces `libinsimul.a` (static) and `libinsimul.dylib` / `.so` / `.dll` (shared) in
`build/`, and runs the test suite.

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

## Repository layout

| Path | Contents |
|---|---|
| [`include/insimul.h`](include/insimul.h) | The stable C ABI — the entire public contract. |
| [`src/`](src/) | The implementation: `insimul.c` (the C layer) and `insimul_boot.pl` (the Prolog-side helper it drives). |
| [`rust/`](rust/) | The Rust bindings — a `-sys` crate and a safe `insimul` crate. |
| [`wasm/`](wasm/) | The hand-written JS wrapper for the WebAssembly build. |
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

## License

libinsimul is licensed under **Apache-2.0** — see [`LICENSE`](LICENSE).

The embedded Trealla Prolog engine and the components it bundles are permissively licensed
(MIT / BSD-style) and redistributable in the prebuilt binaries. Pins and attributions are
in [`THIRD_PARTY.md`](THIRD_PARTY.md).
</content>
