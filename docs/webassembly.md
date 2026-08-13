# The WebAssembly target

This doc teaches you how to build and use the browser/Node build of libinsimul. The
important idea to take away first: **the browser runs the same engine as the native
plugins**, not a lookalike. `libinsimul` compiles to `wasm32` through Emscripten from the
same `CMakeLists.txt`, the same `src/insimul.c`, and the same pinned Trealla commit — this
is a *build target*, not a port. (A previous web runtime ran a different Prolog
implementation that demonstrably disagreed with the native engine on error wording and
solution order; a single engine removes that whole class of bug.)

If you only want to drop the finished package into an app, read
[consuming.md](consuming.md), which covers bundler wiring, `locateFile`, CSP, and the
download size. This doc is about building the target yourself and the JS wrapper's
contract.

## Building it

```sh
scripts/build_wasm.sh              # configure + build + run the wasm tests
scripts/build_wasm.sh --no-test    # build only
```

It writes to **`build-wasm/`**, a separate tree, so the native `build/` and its artifacts
are never touched — the two builds coexist:

```
build-wasm/
  insimul.mjs      ES-module glue  (~102 KB)
  insimul.wasm     the engine      (~2.0 MB)
```

**Requirements: Emscripten ≥ 3.1.50** on `PATH` (developed and verified against emsdk
6.0.5 — the floor is the first version with a stable `EXPORT_ES6` +
`EXPORTED_RUNTIME_METHODS` spelling; anything newer works):

```sh
git clone https://github.com/emscripten-core/emsdk && cd emsdk
./emsdk install latest && ./emsdk activate latest && source ./emsdk_env.sh
```

`scripts/build_wasm.sh` sources `$EMSDK/emsdk_env.sh` or `~/emsdk/emsdk_env.sh`
automatically when `emcc` is not already on `PATH`. The only build-time network fetch is
the same Trealla `FetchContent` clone the native build does, at the pin in
[../THIRD_PARTY.md](../THIRD_PARTY.md).

## Using it from JS

All thirteen `insimul.h` entry points are exported (`cmake/wasm.cmake` names them
explicitly — that list *is* the wasm ABI). `wasm/insimul-api.mjs` is a small hand-written,
engine-agnostic wrapper that turns those raw functions into JS objects:

```js
import createInsimul from './build-wasm/insimul.mjs';   // generated glue
import { loadInsimul } from './wasm/insimul-api.mjs';   // this repo

const insimul = await loadInsimul(createInsimul);
const kb = insimul.createKb();
kb.consult(`parent(tom, bob).
parent(bob, ann).
grandparent(X, Z) :- parent(X, Y), parent(Y, Z).`);

for (const { Who } of kb.solutions('grandparent(tom, Who)')) console.log(Who);  // ann
kb.destroy();
```

(The *packaged* form, `import loadInsimul from '@insimul/prolog-wasm'`, wires the glue for
you — see [consuming.md](consuming.md). The two-argument form above is what you use inside
this repo.)

## Ownership across the JS boundary

WebAssembly has no destructors and no finalizers to lean on, so every pointer the ABI
hands out is owned explicitly. Three kinds cross the boundary:

| What | Owner | Rule |
|------|-------|------|
| **Handles** — `insimul_kb *`, `insimul_query *` (plain integers in JS) | the caller | Must be released with `insimul_kb_destroy` / `insimul_query_stop`, or the module's heap grows forever. `Kb`/`Query` own exactly one handle, null it on release, and throw on use-after-free. |
| **Borrowed strings** — from `insimul_query_next`, `insimul_last_error`, `insimul_kb_snapshot` | the KB/query they came from | Invalidated by the next call on that object. The wrapper `UTF8ToString`s them into JS strings *at the call site* and never stores the pointer — honoring `insimul.h`'s "callers copy anything they need to keep; they never free a returned pointer". |
| **Argument strings** going in | the caller | `malloc`'d on the wasm heap and freed in a `finally`. The wrapper deliberately avoids `ccall(..., 'string', ...)`, which copies onto the wasm **stack** — a snapshot image or a large consult source would blow it. |

**The query iterator** is the trickiest case the ABI's C shape produces: `query()` returns
a stepped pointer, and each `next()` returns a borrowed JSON string that the *following*
step invalidates. `kb.solutions(goal)` is the safe form — a generator wrapped in
`try/finally`, so the handle is stopped even if the consumer `break`s out of the loop or
throws mid-iteration. Reach for the raw `kb.query()` only when you need to interleave
stepping with other work, and stop it yourself.

**No hidden KB any more.** `insimul.createKb()` used to open an internal keepalive KB,
because the engine tore down its process-global symbol table with the last Prolog instance
and then spun on the next teardown. libinsimul owns that now (leak L-01 in
[ABI_ENGINE_LEAK_AUDIT.md](ABI_ENGINE_LEAK_AUDIT.md)), so a host can create and destroy
KBs freely — which a browser does constantly — with nothing on the JS side arranging it.

## The wasm build profile

Two deliberate differences from the native build, both in `cmake/wasm.cmake`:

- **Single-threaded** (`USE_THREADS` off). `-pthread` in wasm means `SharedArrayBuffer`,
  which means every embedding page has to serve COOP/COEP headers. That cost is not worth
  pushing onto browser consumers, and it matches upstream Trealla's own wasm profile (its
  Makefile sets `NOTHREADS=1` for WASI). Emscripten's libc supplies the pthread stubs the
  few unconditional call sites need. The one-KB-per-thread contract is unaffected — there
  is one thread.
- **`posix_spawnp` is stubbed** (`src/insimul_wasm_stubs.c`) to return `ENOSYS`. Trealla's
  `process_create/3` needs it and a wasm module cannot fork. It is a real, failing
  implementation rather than `-sERROR_ON_UNDEFINED_SYMBOLS=0`, so the link stays honest
  about any *future* missing symbol.

Link settings worth knowing: `-sSTACK_SIZE=8388608` (Trealla recurses deeply; the 64 KB
Emscripten default overflows on ordinary goals), `-sALLOW_MEMORY_GROWTH`, and
`-sFORCE_FILESYSTEM` (the C↔Prolog channel writes a temp file under `/tmp`, which is MEMFS
here — never a real disk).

## The wasm tests

`ctest --test-dir build-wasm` (which `scripts/build_wasm.sh` runs for you) has two tests:

- **`wasm_smoke`** (`tests/wasm_smoke.mjs`) — the browser-side mirror of the native `smoke`
  test: same `grandparent/2` KB, same "one query must succeed, one must fail" shape. It
  additionally calls **all thirteen** entry points across the JS boundary, checks the
  snapshot image byte-for-byte against the canonical format, and exercises a
  create → destroy → create cycle. It exits non-zero if fewer than 18 checks ran, so a
  harness that silently does nothing cannot read as a pass.
- **`wasm_conformance`** (`tests/wasm_conformance.mjs`) — the **golden Prolog conformance
  corpus**, the same vectors the native and Rust legs run: every file, every case, no
  subset. It drives them through `wasm/insimul-api.mjs`, i.e. through the public ABI a
  browser consumer uses.

Both legs currently report `10 files, 76 cases, 76 passed, 0 failed, 1 amended`.

## Native ⟷ wasm parity

Two harnesses can both agree with the corpus and still disagree with *each other*, so
"both are green" is not the gate. `scripts/conformance_parity.sh` runs the native and wasm
legs with `INSIMUL_CONFORMANCE_JSON` set — each writes one JSON-Lines record per case
holding the **raw** string `insimul_query_next()` returned — and diffs them case by case:

```sh
scripts/conformance_parity.sh        # builds whatever leg is missing, then compares
```

It fails loudly if the wasm leg runs fewer cases than native, if the summary lines differ,
or if any case record differs by a byte. Current result: **PASS, 76/76 identical — no
divergences.** See [../conformance/WASM_PARITY.md](../conformance/WASM_PARITY.md) for the
full parity record, the non-vacuity gates (each verified by deliberately triggering it),
and the one documented amendment. The corpus itself is covered in
[conformance.md](conformance.md).
</content>
