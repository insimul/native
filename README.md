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
- **US-LI2** — the C ABI (`insimul.h`): KB lifecycle, consult,
  assert/retract, and a JSON binding-set query iterator. See **The C ABI** below.
- **US-LI3** — pass the golden Prolog conformance corpus. See
  **Conformance suite** below.
- **US-LI4** — KB snapshot/restore for save files. See
  **Snapshot & restore** below.
- **US-LI5 (this story)** — prebuilt-binary packaging (`scripts/package.sh`) +
  version stamping (`insimul_version()`). See **Packaging & versioning** below.

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

Six ctest cases run:

- `smoke` (`tests/smoke.c`) — consults a 3-clause KB with a `grandparent/2` rule
  and checks that a query needing **unification + backtracking through that rule**
  succeeds while an unsatisfiable one fails (something a substring fact-store
  cannot do). It drives Trealla's C API directly.
- `abi` (`tests/abi.c`) — exercises the whole `insimul.h` ABI (create, consult,
  assert/retract, the query iterator, and every error path) as a **pure consumer
  of `include/insimul.h`** — it never includes `trealla.h`, so it also proves the
  opaque boundary compiles and links.
- `conformance` (`tests/conformance.c`) — runs the golden Prolog corpus through
  the ABI and compares binding sets against the expected solutions. See below.
- `snapshot` (`tests/snapshot.c`) — snapshot/restore round-trip, determinism, and
  a golden fixture check. See **Snapshot & restore** below.
- `snapshot_parse` — runs the committed snapshot fixture through
  insimul-runtime's real `prolog-fact-parser.ts` (the wrappers' parser) via
  `node`. It degrades to a loud `[SKIP]` if `node` or the submodule parser is
  absent; the `snapshot` case still verifies the format byte-for-byte.
- `version` (`tests/version.c`) — a pure consumer of `insimul.h` that checks
  `insimul_version()` embeds the semver from the `VERSION` file plus the git sha
  and Trealla pin. See **Packaging & versioning** below.

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

## Conformance suite

The `conformance` ctest (`tests/conformance.c`) is the parity gate: it proves the
native engine gives the **same answers as tau-prolog**, the platform's reference
engine, over the golden query corpus authored by the core-extraction PRD.

Each corpus file (`insimul-runtime/packages/core/conformance/prolog/*.json`) is a
list of cases:

```json
{ "area": "unification",
  "cases": [
    { "name": "simple-fact-binding",
      "kb": ["parent(tom, bob)."],
      "query": "parent(tom, X)",
      "expected": [{ "X": "bob" }] } ] }
```

For every case the harness creates a fresh KB, consults the `kb` clauses, runs
`query` through the C ABI, and compares the collected [binding sets](#binding-set-json-format)
against `expected`. Solutions are matched **in order** by default (Prolog's
solution order is canonical); a case may set `"unordered": true` to request a
multiset comparison instead. The harness prints a per-case `[PASS]`/`[FAIL]`
table and a final `files / cases / passed / failed / amended` summary.

Run it via ctest, or directly for the full table:

```sh
ctest --test-dir build -R conformance --output-on-failure
./build/insimul_conformance          # prints the per-case table
```

The corpus directory is resolved from the `INSIMUL_CONFORMANCE_DIR` environment
variable, falling back to the sibling `insimul-runtime` submodule (an absolute
path baked in at configure time). Point the env var elsewhere to run a corpus
from any checkout:

```sh
INSIMUL_CONFORMANCE_DIR=/path/to/conformance/prolog ./build/insimul_conformance
```

The harness **never passes vacuously**: a missing/unreadable corpus directory, a
directory with no `*.json` files, an unparseable corpus file, or zero executed
cases all exit non-zero. Nothing is silently skipped.

**Documented amendments.** Where Trealla diverges from tau-prolog *and*
tau-prolog is the ISO-correct one, the harness applies an explicit, printed
textual amendment to the affected case rather than skipping it, and flags it for
human review (see the `[AMEND]` lines, the `AMENDMENTS` table in
`tests/conformance.c`, and `progress.txt`). The only current amendment renames
the `log/1` user predicate in `assert-retract / asserta-prepends`: ISO reserves
`log` as an *evaluable functor* only, but Trealla also registers `log/1` as a
**static builtin predicate**, so `asserta(log(0))` would raise a
`permission_error`. The rename preserves exactly the assert-ordering behavior the
case tests.

## Snapshot & restore

`insimul_kb_snapshot` / `insimul_kb_restore` are the bridge between a KB's live
dynamic state and a save file's `currentState.prologFacts`: snapshot serializes,
restore rehydrates.

```c
const char *image = insimul_kb_snapshot(kb);   // owned by kb; copy to keep
// ... persist `image` into the save file ...

insimul_kb *fresh = insimul_kb_create();
insimul_kb_consult(fresh, world_rules);        // rules/world from the export
insimul_kb_restore(fresh, image);              // rehydrate the saved state
```

**Snapshot format.** The image is canonical Prolog program text — every fact and
rule the host consulted or asserted (the bootstrap's own predicates are excluded),
one clause per line ending in `.`:

```prolog
age(alice,30).
friend(alice,pet(dog)).
inventory(bob,[sword,shield,3]).
knows(A,B):-likes(A,B).
knows(A,B):-likes(A,C),knows(C,B).
likes(alice,bob).
person(alice).
person(bob).
score(carol,4.5).
title(alice,'Grand Duchess').
```

It is **deterministic**: predicates are emitted in standard `Name/Arity` order and
clauses within a predicate in assert order, so two equal states serialize to
**byte-identical** text (the `snapshot` ctest asserts this). Facts write just the
head; rules write `Head :- Body` with variables rendered `A, B, C, …`; atoms
needing quotes use single quotes. The format is deliberately a subset that
insimul-runtime's `prolog-fact-parser.ts` accepts — the `snapshot_parse` ctest
runs that TypeScript parser over the committed fixture
(`conformance/snapshots/basic.snapshot.pl`) and checks it against the fixture's
expected-parse companion (see `conformance/snapshots/README.md`).

**Restore replaces state.** `insimul_kb_restore` parses the image first (a
malformed image is rejected with `-1` and the KB left untouched), then wipes all
existing dynamic user clauses and loads the image's clauses in order — so a
round-trip (`consult base → assert → snapshot → fresh KB → restore`) reproduces
identical query results and re-snapshots to the identical image.

```sh
ctest --test-dir build -R 'snapshot' --output-on-failure
```

If the snapshot format ever changes legitimately, regenerate the golden fixture
with `INSIMUL_SNAPSHOT_UPDATE=1 ./build/insimul_snapshot` (run from this
directory) and re-run `snapshot_parse`.

## Packaging & versioning

The library's semver lives in one place — the tracked `VERSION` file (currently
`0.1.0`). `CMakeLists.txt` reads it, `insimul_version()` embeds it, and
`scripts/package.sh` stamps it, so they never drift.

**`insimul_version()`** returns a static string identifying the exact build:

```
insimul 0.1.0 (git 3c347ec, trealla v2.106.1/07de013677af760a8bca0594ae4b2bef158a3cde)
```

— the `insimul` semver, the short git sha the tree was built from (`unknown` for
a non-git tarball build), and the pinned Trealla tag/commit. Wrappers log it on
startup for provenance.

**`scripts/package.sh`** produces a redistributable package for the current host:

```sh
scripts/package.sh                 # -> dist/<platform>/
```

`<platform>` is derived from `uname` (`macos-arm64`, `macos-x64`, `linux-x64`,
`windows-x64`). Each package contains the **shared** library
(`libinsimul.dylib`/`.so`/`insimul.dll`), the public header `insimul.h`, and a
`VERSION` file:

```
insimul 0.1.0
platform macos-arm64
git 3c347ec
trealla_tag v2.106.1
trealla_commit 07de013677af760a8bca0594ae4b2bef158a3cde
```

The first line's semver matches `insimul_version()`, and the Trealla fields match
the pin in `CMakeLists.txt` / `THIRD_PARTY.md` — a consumer can cross-check the
binary it loaded against the file it shipped. `dist/` is gitignored.

How the three engine plugins consume `dist/<platform>/` (Unity `Plugins/`
P/Invoke, Unreal `ThirdParty` module, Godot GDExtension) is documented in
[`docs/consuming.md`](docs/consuming.md) — layout only; the per-engine wrappers
are their own PRDs' work.

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
