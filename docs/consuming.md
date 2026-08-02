# Consuming libinsimul

This repo ships **two** libraries. Most of this document is about the first; the
second has its own section further down.

| Library | Header | What it is |
|---|---|---|
| `libinsimul` | `insimul.h` | the Prolog core — Trealla behind a C ABI |
| `libinsimulcore` | `insimulcore.h` | `@insimul/core`'s TypeScript behind a C ABI ([Consuming libinsimulcore](#consuming-libinsimulcore)) |

They are independent: separate ABIs, separate artifacts, either one usable
without the other. The native package carries both; the wasm package carries only
`libinsimul` (a browser host runs core as the TypeScript it already is).

`scripts/package.sh` produces two package shapes from the **same engine build**,
both stamped by the same `VERSION` file:

| Consumer | Command | Output |
|----------|---------|--------|
| Unity / Unreal / Godot / Rust (native) | `scripts/package.sh` | `dist/<platform>/` |
| A JS bundler or Node (browser) | `scripts/package.sh --target wasm` | `dist/wasm/` |

`scripts/package.sh --target all` builds both.

## Native — `dist/<platform>/`

The native package is a shared library + public header per library, and one
shared `VERSION` stamp:

```
dist/macos-arm64/
  libinsimul.dylib      # or libinsimul.so (Linux), insimul.dll (Windows)
  insimul.h             # the stable C ABI (extern "C")
  libinsimulcore.dylib  # the core bridge — see "Consuming libinsimulcore"
  insimulcore.h
  VERSION               # semver + platform + git sha + Trealla pin
```

A consumer that only needs Prolog takes the first two files and ignores the rest;
nothing in `libinsimul` references `libinsimulcore`.

`<platform>` is one of `macos-arm64`, `macos-x64`, `linux-x64`, `windows-x64`
(iOS/Android come later — see the platform matrix in the README).

The ABI is the entire contract: `insimul.h` leaks no engine types, everything is
`extern "C"`, one KB is owned by one thread, and returned strings are owned by the
object they came from (see the header for the ownership rules). A wrapper calls
`insimul_version()` at load time and can cross-check it against the shipped
`VERSION` file — both carry the same semver / git sha / Trealla pin.

> This document specifies the **file layout** each engine expects. The actual
> managed/native wrappers (marshalling, lifetime, JSON parsing of the binding
> sets) are the per-engine PRDs' work, not this one.

---

## Unity — P/Invoke

Unity loads native code from a `Plugins/` folder, one native lib per platform
target. A C# `[DllImport("insimul")]` static class wraps the ABI.

```
Assets/Insimul/
  Plugins/
    macOS/libinsimul.dylib        # set Editor + Standalone; CPU per import
    Linux/libinsimul.so
    Windows/insimul.dll
  Runtime/
    InsimulNative.cs              # [DllImport("insimul")] extern declarations
    PrologEngine.cs               # replaces the fake substring store
  VERSION                          # copied from dist/<platform>/VERSION
```

- `[DllImport("insimul", CallingConvention = CallingConvention.Cdecl)]` — the lib
  base name is `insimul` (Unity strips the `lib` prefix / extension per platform).
- Marshal returned `const char*` as `IntPtr` + `Marshal.PtrToStringUTF8` (do **not**
  let the marshaler free it — the ABI owns the pointer).
- In the plugin importer, set each `.dylib`/`.so`/`.dll` to its OS + CPU so the
  right binary is selected per build target.
- Parse the binding-set JSON (README "Binding-set JSON format") with any C# JSON
  reader; the shape is stable across all three engines.

## Unreal — ThirdParty module

Unreal consumes prebuilt native libs through a `ThirdParty` module whose
`*.Build.cs` publishes the include path and the platform library, and stages the
runtime dylib/dll.

```
Source/ThirdParty/InsimulLibrary/
  InsimulLibrary.Build.cs         # PublicIncludePaths + per-platform lib/runtime
  include/insimul.h
  lib/
    Mac/libinsimul.dylib
    Linux/libinsimul.so
    Win64/insimul.dll  insimul.lib   # import lib if built with MSVC
  VERSION
```

- `Build.cs`: `PublicIncludePaths.Add(".../include")`; per `Target.Platform` add
  the library to `PublicAdditionalLibraries` and stage the shared lib with
  `RuntimeDependencies.Add(...)` (Mac/Linux) / `PublicDelayLoadDLLs` +
  `RuntimeDependencies` (Win64).
- A separate runtime module `#include "insimul.h"` and calls the ABI, replacing
  the fake `PrologEngine.cpp`.
- `extern "C"` in the header means no name-mangling work on the Unreal side.

## Godot — GDExtension

Godot 4 loads native code as a GDExtension: a shared lib plus a `.gdextension`
descriptor listing the per-platform binaries. The extension code links `insimul.h`
and registers a class the GDScript side uses in place of `prolog_engine.gd`.

```
addons/insimul/
  insimul.gdextension             # [libraries] entry per platform
  bin/
    macos/libinsimul.dylib
    linux/libinsimul.so
    windows/insimul.dll
  include/insimul.h               # for the extension's own C/C++ glue
  VERSION
```

- `insimul.gdextension` `[libraries]` maps `macos.arm64`, `linux.x86_64`,
  `windows.x86_64`, … to the matching file under `bin/`.
- The GDExtension glue (`godot-cpp` or a thin C shim) `#include`s `insimul.h` and
  exposes `consult`/`query`/`assert`/`snapshot` to GDScript; the binding-set JSON
  is parsed with Godot's `JSON` class.

---

# Consuming libinsimulcore

`libinsimulcore` is the **second** library this repo builds and ships. It is not
a bigger `libinsimul`: it is `@insimul/core`'s TypeScript — the simulation's
decision layer — running inside an embedded QuickJS behind its own C ABI,
`insimulcore.h`. Behind that ABI the implementation can be replaced (a Rust port
later) without any engine noticing.

It lives here so all three engines bind **one** bridge. The corollary from
`RUNTIME_CORE_ADOPTION.md` §4.5 is the whole point of the promotion:

> **Do not invent a second mechanism.** If Unity needs core, it P/Invokes
> `libinsimulcore`. If Unreal needs core, it links `libinsimulcore`. The bridge
> is built once, not three times.

```
dist/macos-arm64/
  libinsimul.dylib        # the Prolog core
  insimul.h
  libinsimulcore.dylib    # core's TypeScript behind a C ABI
  insimulcore.h
  VERSION
```

The two libraries are **independent artifacts with independent ABIs**. No
`insimul_kb` handle ever crosses `insimulcore.h`, so nothing has to be
initialised in a particular order and neither library has to be loaded for the
other to work. `libinsimulcore.dylib` static-links `libinsimul` internally, which
is what makes it loadable on its own — take it alone if core is all you need.

The ABI is five functions and one opaque handle:

```c
insimul_core *insimul_core_create(void);
void          insimul_core_destroy(insimul_core *core);
const char   *insimul_core_call(insimul_core *core, const char *method, const char *args_json);
const char   *insimul_core_last_error(const insimul_core *core);
const char   *insimul_core_version(void);
```

**Three rules that apply to every host below**, and are the reason the same
binary serves all of them:

1. **Nothing per-frame crosses this boundary.** Every call marshals JSON in and
   JSON out — fine at gameplay-event rate, fatal per frame. Core decides;
   rendering, input, animation and physics stay engine-side.
2. **One handle, one thread**, exactly like an `insimul_kb`. Creation costs a few
   milliseconds (a JS runtime plus the bundle evaluating), so create **one per
   game** and keep it.
3. **The returned string is borrowed**, owned by the handle and valid only until
   the next `insimul_core_call()` on that handle. Copy it into an engine string
   before calling again. A `NULL` return means failure and
   `insimul_core_last_error()` says why.

Call `core.methods` at startup to enumerate the method table rather than
hard-coding it; a bundle that lost the method you need should fail loudly at
load, not silently return nothing at runtime.

## Godot — GDExtension

The reference consumer, and the one that is proven end to end. The extension
links `libinsimulcore` (statically at build time, as GDExtension code links any
C dependency) and wraps it in a `RefCounted` class; GDScript talks to that class
in `Dictionary`s and never sees a C pointer.

```
gdextension/src/insimul_core.{h,cpp}   # RefCounted wrapper over the 5 functions
addons/insimul/runtime/*.gd            # Dictionary -> JSON, the ONE translation point
```

- Hold the handle in the wrapper object; `insimul_core_destroy()` in its
  destructor. One wrapper instance per handle, one handle per game.
- Convert with Godot's `JSON.stringify` / `JSON.parse` at the GDScript boundary —
  keeping engine types out of the C layer is what lets Unity and Unreal reuse it.
- `insimul_core_call()` is synchronous (it drives the JS job queue until the
  promise settles), so call it from gameplay events, not `_process`.

## Unity — P/Invoke

The same shape as `libinsimul`'s P/Invoke wrapper, with one extra care: the
returned pointer is borrowed.

```
Assets/Insimul/
  Plugins/
    macOS/libinsimulcore.dylib      # base name is `insimulcore`
    Linux/libinsimulcore.so
    Windows/insimulcore.dll
  Runtime/
    InsimulCoreNative.cs            # [DllImport("insimulcore")] extern declarations
```

```csharp
[DllImport("insimulcore", CallingConvention = CallingConvention.Cdecl)]
private static extern IntPtr insimul_core_call(IntPtr core, string method, string argsJson);
```

- Declare the return type as `IntPtr` and read it with `Marshal.PtrToStringUTF8`.
  Do **not** declare it as `string`: the default marshaler would try to free a
  pointer the ABI owns.
- Wrap the handle in a `SafeHandle` (or an `IDisposable` that is not resurrected)
  so `insimul_core_destroy` runs exactly once, off the finalizer thread — the
  handle is not thread-safe.
- `libinsimulcore` is self-contained, so shipping it does **not** require also
  shipping `libinsimul` unless the project P/Invokes the Prolog ABI too.

## Unreal — ThirdParty module

Same `ThirdParty` mechanism as `libinsimul`, listed as a second library (or a
second module) rather than folded into the first:

```
Source/ThirdParty/InsimulCoreLibrary/
  InsimulCoreLibrary.Build.cs
  include/insimulcore.h
  lib/
    Mac/libinsimulcore.dylib
    Linux/libinsimulcore.so
    Win64/insimulcore.dll  insimulcore.lib
  VERSION
```

- `extern "C"` in the header means no name-mangling work on the Unreal side;
  `#include "insimulcore.h"` from a C++ runtime module directly.
- Marshal with `FTCHARToUTF8` / `UTF8_TO_TCHAR` at the boundary and copy the
  result into an `FString` before the next call — the borrowed-pointer rule.
- Hold the handle on a `UGameInstanceSubsystem` (created once, destroyed with the
  game instance) rather than on an actor.

## Version / provenance

`insimul_core_version()` returns

```
0.1.0 (quickjs 2025-04-26, core 443cce783eddea790d4a1f07b90018047ca36845)
```

— its own ABI version, the pinned QuickJS, and the `packages/core` commit the
vendored bundle was built from. That last field is the one to quote in a bug
report about core's *behaviour*, because it identifies the exact TypeScript that
answered. All three come from the authoritative pins listed in `THIRD_PARTY.md`
and are asserted by the `corebridge_smoke` ctest.

Note this is **not** the `VERSION` file's semver: `libinsimulcore` versions its
own ABI separately from `libinsimul`'s, because they are separate contracts that
will move at different rates.

---

## Web / JS bundlers — `dist/wasm/`

The browser runs the **same engine**, built for `wasm32` through Emscripten from
the same `src/insimul.c` and the same pinned Trealla commit (see the README's
*WebAssembly target*). `scripts/package.sh --target wasm` assembles it as an ES
module package:

```
dist/wasm/
  package.json          # "@insimul/prolog-wasm", type: module, exports map
  index.mjs             # the entry point — exports["."]
  insimul-api.mjs       # the hand-written ABI wrapper (handles, ownership)
  insimul.mjs           # the generated Emscripten glue
  insimul.wasm          # the engine — a separate file the glue FETCHES
  VERSION               # semver + platform + git sha + Trealla pin
  LICENSE
```

There is no build step and no dependency to install: `dependencies`,
`peerDependencies` and `optionalDependencies` are all empty, deliberately. The
dependency direction is one-way — this repo never depends on a JS consumer of
it, and `tests/wasm_package_smoke.mjs` fails the package if that ever changes.

Consume it as a local package (`npm pack` the directory, a `file:` dependency, a
workspace, or a vendored copy — the same choice the engine repos make for
`dist/<platform>/`):

```js
import loadInsimul from '@insimul/prolog-wasm';

const insimul = await loadInsimul();          // instantiates the wasm module
const kb = insimul.createKb();
kb.consult(`parent(tom, bob).
grandparent(X, Z) :- parent(X, Y), parent(Y, Z).`);

for (const { Who } of kb.solutions('grandparent(tom, Who)')) console.log(Who);
kb.destroy();
```

Subpath exports, for hosts that want the pieces rather than the entry point:

| Specifier | What |
|-----------|------|
| `@insimul/prolog-wasm` | `index.mjs` — `loadInsimul()` as the default export, plus `Insimul`/`Kb`/`Query`/`InsimulError` |
| `@insimul/prolog-wasm/api` | `insimul-api.mjs` — the wrapper alone; takes an Emscripten factory, so a host can instantiate the module its own way |
| `@insimul/prolog-wasm/glue` | `insimul.mjs` — the raw Emscripten factory |
| `@insimul/prolog-wasm/insimul.wasm` | the binary itself, for an asset pipeline that copies/fingerprints it |

The ownership rules are the C ABI's, unchanged: handles must be released
(`kb.destroy()`, `query.stop()` — `kb.solutions()` does it for you in a
`finally`), and returned strings are copied at the call site because the KB or
query still owns them. The README's *Ownership across the JS boundary* table is
the full statement; `insimul-api.mjs`'s header repeats it next to the code.

**One module instance is single-threaded**, on purpose: the wasm build is linked
without `-pthread`, so an embedding page does **not** need `SharedArrayBuffer`
and therefore does **not** need COOP/COEP headers. Run it in a Web Worker if a
long query would otherwise block the frame.

### How `insimul.wasm` is loaded — fetched, not inlined

The glue is linked with `-sMODULARIZE -sEXPORT_ES6`, so it resolves the binary
as `new URL('insimul.wasm', import.meta.url)` and `fetch`es it. Two consequences
worth planning for:

- **The `.wasm` must be served next to the `.mjs`**, or told where it is. Most
  bundlers (Vite, webpack 5, Rollup with the URL plugin) recognise the
  `new URL(..., import.meta.url)` pattern and emit the binary as an asset
  automatically. If yours does not, copy `insimul.wasm` into your static
  directory and point the loader at it:

  ```js
  import wasmUrl from '@insimul/prolog-wasm/insimul.wasm?url';   // Vite
  const insimul = await loadInsimul({ locateFile: () => wasmUrl });
  ```

  `locateFile` is Emscripten's own hook and is passed straight through by
  `loadInsimul(moduleOptions)`.
- **CSP.** Instantiating WebAssembly needs `script-src 'wasm-unsafe-eval'` (older
  Chrome accepted only `'unsafe-eval'`), and fetching the binary needs its origin
  allowed by `connect-src` — `'self'` covers the same-origin case. A host that
  forbids fetching the binary altogether (a strict sandboxed iframe, an offline
  desktop bundle with no asset server) has one escape hatch: relink with
  `-sSINGLE_FILE=1` in `cmake/wasm.cmake`, which base64-embeds the binary into
  `insimul.mjs`. That is **not** the default because base64 costs ~33% on top of
  the 2.0 MB binary and removes streaming compilation. This build does not read
  `Module.wasmBinary`, so `locateFile` or `SINGLE_FILE` are the two options.

Node works out of the box (`-sENVIRONMENT=web,worker,node`); there the glue reads
the sibling file from disk instead of fetching it, which is how
`tests/wasm_package_smoke.mjs` verifies the assembled package.

### Size

A Prolog engine in a browser bundle is a real cost, so the numbers are stated
rather than implied (insimul 0.1.0, Emscripten 6.0.5, `-O2` Release):

| File | Raw | gzip -9 | brotli -11 |
|------|----:|--------:|-----------:|
| `insimul.wasm` | 2,092,182 | 561,946 | 415,595 |
| `insimul.mjs` | 104,426 | 28,662 | 25,550 |
| `insimul-api.mjs` | 10,173 | 3,687 | 3,099 |
| `index.mjs` | 1,985 | 999 | 805 |
| **Total** | **2,208,766** (2.1 MB) | **595,294** (581 KB) | **445,049** (435 KB) |

`npm pack` on the directory yields a **600 kB** tarball (7 files, 2.2 MB
unpacked). So ~435 KB over the wire from a brotli-serving CDN, of which the
binary is ~416 KB. It is a separate file, so it is cached independently of the app bundle
and compiles while it streams. `scripts/package.sh --target wasm` reprints this
table on every run — regenerate the numbers here from its output rather than
guessing after a Trealla bump.

---

## Version / provenance

Every package carries `VERSION`, e.g.:

```
insimul 0.1.0
platform macos-arm64
git 3c347ec
trealla_tag v2.106.1
trealla_commit 07de013677af760a8bca0594ae4b2bef158a3cde
```

The first line matches the semver embedded in `insimul_version()` (the C ABI),
and the Trealla fields match the pin in `CMakeLists.txt` / `THIRD_PARTY.md`. A
wrapper that logs `insimul_version()` on startup gives support a single string
identifying the exact engine build a save file was produced against.

The wasm package carries the identical stamp with `platform wasm32-emscripten`,
and `package.json`'s `version` is the same semver — so a browser host
cross-checks its engine exactly as a Unity build does. Packaging asserts it
rather than assuming it: `tests/wasm_package_smoke.mjs` reassembles
`insimul <semver> (git <sha>, trealla <tag>/<commit>)` from the `VERSION` file
and requires `insimul_version()` from the packaged binary to equal it byte for
byte, so a stale `build-wasm/` tree cannot be shipped with a fresh stamp.
