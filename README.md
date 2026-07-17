# insimul-native (libinsimul)

The shared **native Prolog core** for the Insimul engine plugins. It embeds a
real, ISO-conforming Prolog engine — [Trealla Prolog](https://github.com/trealla-prolog/trealla)
(pure C, MIT) — and exposes it through a stable C ABI (`include/insimul.h`) so the
Unreal, Unity, and Godot plugins can share one engine instead of the three
substring-matching fake fact-stores they ship today.

> Plan reference: `docs/PLATFORM_SPLIT_AND_ENGINE_PLUGINS.md` §3.1.

## Status

This directory is being built up story-by-story (PRD `libinsimul-bootstrap`):

- **US-LI1 (this story)** — project skeleton: CMake build of a static + shared
  `insimul` library, Trealla vendored at a pinned commit via FetchContent, and a
  ctest smoke test that consults a KB and runs one query through the engine.
- US-LI2 — the C ABI (`insimul.h`): KB lifecycle, consult, assert/retract, and a
  JSON binding-set query iterator.
- US-LI3 — pass the golden Prolog conformance corpus.
- US-LI4 — KB snapshot/restore for save files.
- US-LI5 — prebuilt-binary packaging + version stamping.

## Build & test

Requires **CMake ≥ 3.24** and a C toolchain. On first configure, CMake fetches
Trealla from GitHub (needs network access), so allow a little extra time.

```sh
cmake -B build
cmake --build build
ctest --test-dir build --output-on-failure
```

Artifacts land in `build/`: `libinsimul.a` (static) and `libinsimul.dylib` /
`.so` / `.dll` (shared).

The smoke test (`tests/smoke.c`) consults a 3-clause KB with a `grandparent/2`
rule and checks that a query which requires **unification + backtracking through
that rule** succeeds, while an unsatisfiable query fails — something a substring
fact-store cannot do.

## Engine build configuration

Trealla ships a Makefile, not CMake. `CMakeLists.txt` compiles its sources
directly into an `insimul` library with a minimal, dependency-light feature set
validated on macOS:

| Flag            | Setting | Why |
|-----------------|---------|-----|
| `EMBED`         | on      | Trealla's Prolog stdlib is embedded as C byte arrays (via its `bin2c` host tool), so no on-disk library path is needed at runtime. |
| `USE_ISOCLINE`  | on      | Uses Trealla's **bundled** line editor — avoids a system `libedit`/`readline` dependency, which keeps the build portable across CI. |
| `USE_THREADS`   | on      | Required: `src/bif_os.c` calls `pthread_self()` unconditionally. |
| `USE_FFI`       | off     | Would need `libffi` headers; not used by the runtime. |
| `USE_OPENSSL`   | off     | Would need OpenSSL headers; not used by the runtime. |

`libinsimul` links only `libm` + pthreads.

## Thread model

**One KB instance is owned by one thread; there is no shared global mutable
state across KB instances.** This is a hard requirement for Unity/Unreal usage
and is preserved by the ABI (US-LI2 onward).

## Target platform matrix

First-class targets (build + test in CI):

| Platform          | Arch        | Status |
|-------------------|-------------|--------|
| macOS             | arm64, x64  | supported (this machine: arm64) |
| Linux             | x64         | supported (isocline + pthreads; no system libedit needed) |
| Windows           | x64         | supported (MSVC/MinGW; isocline avoids readline) |

Later (post-bootstrap): iOS (arm64) and Android (arm64-v8a) — cross-compiled from
the same sources; deferred until the desktop matrix is proven.

## Vendored dependencies

See [`THIRD_PARTY.md`](./THIRD_PARTY.md) for the Trealla pin (repository, commit,
tag) and license notes.
