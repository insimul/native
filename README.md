# insimul-native (libinsimul)

The shared **native Prolog core** for the Insimul engine plugins. It embeds a
real, ISO-conforming Prolog engine — [Trealla Prolog](https://github.com/trealla-prolog/trealla)
(pure C, MIT) — and exposes it through a stable C ABI (`include/insimul.h`) so the
Unreal, Unity, and Godot plugins can share one engine instead of the three
substring-matching fake fact-stores they ship today.

> Plan reference: `docs/PLATFORM_SPLIT_AND_ENGINE_PLUGINS.md` §3.1.

## Status

This directory is being built up story-by-story (PRD `libinsimul-bootstrap`):

- **US-LI1** — project skeleton: CMake build of a static + shared `insimul`
  library, Trealla vendored at a pinned commit via FetchContent, and a ctest
  smoke test that consults a KB and runs one query through the engine.
- **US-LI2 (this story)** — the C ABI (`insimul.h`): KB lifecycle, consult,
  assert/retract, and a JSON binding-set query iterator. See **The C ABI** below.
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

Two ctest cases run:

- `smoke` (`tests/smoke.c`) — consults a 3-clause KB with a `grandparent/2` rule
  and checks that a query needing **unification + backtracking through that rule**
  succeeds while an unsatisfiable one fails (something a substring fact-store
  cannot do). It drives Trealla's C API directly.
- `abi` (`tests/abi.c`) — exercises the whole `insimul.h` ABI (create, consult,
  assert/retract, the query iterator, and every error path) as a **pure consumer
  of `include/insimul.h`** — it never includes `trealla.h`, so it also proves the
  opaque boundary compiles and links.

## The C ABI

`include/insimul.h` is the stable, engine-agnostic surface the Unity, Unreal, and
Godot wrappers link against. It leaks no Trealla types (the engine is an
implementation detail), and every KB is independent — no shared global state — so
a host may run one KB per thread.

```c
insimul_kb *kb = insimul_kb_create();
insimul_kb_consult(kb,
    "parent(tom, bob).\n"
    "parent(bob, ann).\n"
    "grandparent(X, Z) :- parent(X, Y), parent(Y, Z).\n");   // -> 0
insimul_kb_assert(kb, "parent(ann, zoe)");                    // no trailing '.'

insimul_query *q = insimul_query_start(kb, "grandparent(tom, W)");
const char *sol;                       // NULL query => error, see insimul_last_error
while ((sol = insimul_query_next(q)) != NULL)
    puts(sol);                         // {"W":"ann"}
insimul_query_stop(q);
insimul_kb_destroy(kb);
```

Program text passed to `consult` is one or more clauses/directives (each with its
own full stop). Terms passed to `assert`/`retract` and goals passed to
`query_start` are **single terms without a trailing full stop**. Each function's
return codes and string-ownership rules are documented in `include/insimul.h`.

### Binding-set JSON format

`insimul_query_next` returns each solution as a JSON object — the exact shape the
C#/C++/GDScript wrappers parse:

```
{ "Var": <value>, ... }        one entry per named goal variable
```

with Prolog terms mapped as:

| Prolog term          | JSON                                        |
|----------------------|---------------------------------------------|
| atom                 | string — `"foo"`                            |
| integer / float      | number — `42`, `4.5`                         |
| list                 | array — `["wine", 3]` (empty list is `[]`)  |
| compound `f(A, ...)` | `{"functor":"f","args":[ <value>, ... ]}`   |
| unbound variable     | `null`                                      |

A goal that succeeds with no named variables yields `{}`; a goal that simply
fails yields no solutions (the first `insimul_query_next` returns `NULL`, and
`insimul_last_error` stays clear). Variables whose source name begins with `_`
are omitted. The `abi` test asserts these exact strings, and the
`insimul_boot.pl` helper is what produces them.

### How it works (implementation note)

The C layer never walks Trealla term structures. Each KB consults a fixed
bootstrap program (`src/insimul_boot.pl`, embedded as a C byte array by
`cmake/gen_boot.cmake`) that does the Prolog-side work — running a goal,
serializing solutions to JSON, catching exceptions — and reports back through a
per-KB temp file. This keeps Trealla types out of `insimul.h` and avoids any
process-global stdout/stderr redirection, preserving the one-KB-per-thread model.

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
