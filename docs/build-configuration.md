# Build configuration & platforms

This doc covers the details behind the one-line `cmake` build: which engine features are
compiled in and why, the thread model the whole design rests on, and which platforms are
supported. You do not need any of this to build the library — `cmake -B build && cmake
--build build` just works — but it explains the choices if you are porting, packaging, or
debugging a build.

## Requirements

- **CMake ≥ 3.24** and a C11 toolchain (the library is C11, no C++ required to build it).
- **No network access, ever.** Trealla's source is *committed* under `vendor/trealla/`
  at a pinned commit, so a clean checkout configures and builds offline. The pin lives in
  `vendor/trealla/VENDORED.json` and CMake reads it from there — one authoritative
  location; see [../THIRD_PARTY.md](../THIRD_PARTY.md). The `trealla_vendor` ctest
  recomputes the vendored tree's upstream git object ids, so the committed bytes are
  provably upstream's at that commit, and fails if a `FetchContent` of the engine ever
  comes back.

```sh
cmake -B build
cmake --build build
ctest --test-dir build --output-on-failure
```

Artifacts land in `build/`: `libinsimul.a` (static) and `libinsimul.dylib` / `.so` /
`insimul.dll` (shared). `build/` is gitignored.

## The native test suite

Six ctest cases run — each guards a different part of the contract:

- **`smoke`** (`tests/smoke.c`) — consults a 3-clause KB with a `grandparent/2` rule and
  checks that a query needing unification + backtracking succeeds while an unsatisfiable
  one fails (something a naive fact-store cannot do). Drives the engine's C API directly.
- **`abi`** (`tests/abi.c`) — exercises the whole `insimul.h` ABI as a **pure consumer of
  the header** — it never includes any engine header, so it also proves the opaque boundary
  compiles and links. See [c-abi.md](c-abi.md).
- **`conformance`** (`tests/conformance.c`) — runs the golden Prolog corpus through the ABI.
  See [conformance.md](conformance.md).
- **`snapshot`** (`tests/snapshot.c`) — snapshot/restore round-trip, determinism, and a
  golden-fixture check. See [snapshots.md](snapshots.md).
- **`snapshot_parse`** — runs the committed snapshot fixture through the wrappers' real
  TypeScript fact parser via `node`. It degrades to a loud `[SKIP]` if `node` or the sibling
  runtime submodule is absent; the `snapshot` case still verifies the format byte-for-byte.
- **`version`** (`tests/version.c`) — a pure consumer of `insimul.h` that checks
  `insimul_version()` embeds the semver from the `VERSION` file plus the git sha and Trealla
  pin. See [packaging.md](packaging.md).

## Engine build configuration

Trealla ships a Makefile, not CMake. `CMakeLists.txt` compiles its sources directly into an
`insimul` library with a minimal, dependency-light feature set:

| Flag            | Setting | Why |
|-----------------|---------|-----|
| `EMBED`         | on      | Trealla's Prolog stdlib is embedded as C byte arrays, so no on-disk library path is needed at runtime. |
| `USE_ISOCLINE`  | on      | Uses Trealla's **bundled** line editor — avoids a system `libedit`/`readline` dependency, keeping the build portable across CI. |
| `USE_THREADS`   | on      | Required: the engine calls `pthread_self()` unconditionally. **Off in the wasm build** — see [webassembly.md](webassembly.md). |
| `USE_FFI`       | off     | Would need `libffi` headers; not used by the runtime. |
| `USE_OPENSSL`   | off     | Would need OpenSSL headers; not used by the runtime. |

`libinsimul` links only `libm` + pthreads (just `libm` on wasm).

## Thread model

**One KB instance is owned by one thread; there is no shared global mutable state across KB
instances.** This is a hard requirement for Unity/Unreal usage and is preserved by the ABI.
The wasm build satisfies it trivially: it is single-threaded, one module instance running N
KBs. This is stated normatively in the [C ABI header](c-abi.md).

## Target platform matrix

First-class targets (build + test in CI):

| Platform          | Arch        | Status |
|-------------------|-------------|--------|
| macOS             | arm64, x64  | supported |
| Linux             | x64         | supported (isocline + pthreads; no system libedit needed) |
| Windows           | x64         | supported (MSVC/MinGW; isocline avoids readline) |
| Browser / Node    | wasm32      | supported via Emscripten — `scripts/build_wasm.sh`; see [webassembly.md](webassembly.md) |

Later: iOS (arm64) and Android (arm64-v8a), cross-compiled from the same sources; deferred
until the desktop matrix is fully proven.
</content>
