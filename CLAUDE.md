# insimul-native — conventions for the native Prolog core

## The ABI boundary is opaque
- `include/insimul.h` must **never** include Trealla headers or expose Trealla
  types. It is the contract three engine wrappers (C#/C++/GDScript) parse. The
  `abi` ctest includes *only* `insimul.h` to keep us honest — keep it that way.
- `src/insimul.c` is the only unit that includes `trealla.h`. It talks to Trealla
  through the **public** C API (`pl_create`, `pl_consult_fp`, `pl_query`/`pl_redo`,
  `set_quiet`, `get_status`), never internal headers.

## The C layer does not walk Prolog terms — the bootstrap does
- All term work (running goals, JSON-serializing solutions, catching exceptions,
  snapshotting) lives in **`src/insimul_boot.pl`**, consulted into every KB at
  create time. `cmake/gen_boot.cmake` embeds it as a NUL-terminated byte array
  (`insimul_boot_pl[]` / `_len`); `insimul.c` `fmemopen()`s it. To extend the ABI
  (US-LI3/LI4), add a `'$insimul_...'/N` helper there and a thin C wrapper.
- C↔Prolog data channel: C passes the goal/fact **inline as an escaped
  single-quoted atom** (`quote_atom`) and a **temp result-file path**; the helper
  writes tagged records (`SOL`/`ERR`/`OK`/`NONE`) one per line; C reads them back.
  This avoids process stdout/stderr entirely, so it stays per-KB / thread-safe.

## Trealla gotchas learned here (public C API)
- `pl_query` returns "ran without a *hard* error", not goal success; and its var
  dump goes to stdout. Give dispatch goals **no free top-level variables** and
  call `set_quiet(pl)` so nothing prints. Read solutions from the result file.
- Drive/free a sub-query with `while (pl_redo(q)) {}` (redo frees it when
  exhausted). Do **not** call `pl_done` on an already-exhausted query.
- `dynamic/1` does **not** exist as a runtime goal (only as a directive) — calling
  it throws `existence_error`. `assertz/1` auto-creates an undefined predicate as
  dynamic, so you don't need it to *populate* one — but you do need it to declare
  a predicate a KB only ever **calls** (the KINP corpus does this for `same_as/3`
  and `world_parent/2`), or the call raises instead of failing. Because the
  bootstrap consults via `read_term/3` + `call/1`, it must honor `:- dynamic`
  itself: `'$declare_dynamic'/1` does `asserta(H), retract(H)` on a fresh head
  (`asserta`, so the retract can only remove our placeholder, never a real clause
  of an already-populated predicate). `:- op/3` executed via `call/1` *does* affect
  subsequent `read_term/3`, so a read-term consult loop honors custom operators.
- Trealla's `consult/1` and loader print syntax errors to **C `stderr`** and can't
  be captured per-KB (fd redirection is racy and unreliable against Trealla).
  That's why consult is a transactional `read_term/3` loop in the bootstrap:
  syntax errors surface as **catchable** exceptions, and clauses are asserted only
  after the whole source parses (rollback on error).
- Capture a term's text deterministically with
  `with_output_to(atom(A), (current_output(S), <write to S>))` — `string(...)`
  renders oddly when re-written.
- **Create/destroy CYCLE hangs (process-global teardown).** A single
  `pl_create` … `pl_destroy` is fine, but `create → destroy(the last KB) →
  create` **deadlocks** the second full teardown. Trealla's `pl_destroy` calls
  `g_destroy()` when `g_tpl_count` hits 0 (tears down the global symbol table);
  re-`g_init`-ing it and tearing down again hangs. Mitigation for code that
  creates many KBs over time (the conformance harness, and eventually the engine
  plugins): keep **one long-lived KB open** so `g_tpl_count` never returns to 0 —
  then per-KB create/destroy is safe. See `tests/conformance.c` (`keepalive`).
  Flagged for human review in `progress.txt`; a real ABI-level fix (an internal
  keepalive/refcount in `insimul.c`) is a candidate follow-up.
- **Arithmetic functors are also STATIC builtin predicates.** Names like `log`,
  `sin`, `max`, `gcd` are registered in `src/bif_functions.c` as `name/N`
  predicates, not just evaluable functors. So a user KB that uses e.g. `log/1` as
  a dynamic predicate hits `permission_error(modify, static_procedure, log/1)` on
  `asserta`/`assertz` — ISO allows it (there `log` is an evaluable functor only)
  and tau-prolog accepts it. The conformance harness handles this with a
  documented, printed amendment (rename), never a silent skip — see its
  `AMENDMENTS` table.

## The conformance corpus is VENDORED here
- `conformance/prolog/*.json` is a mirror of `@insimul/core`'s
  `packages/core/conformance/prolog` (the source of truth) — the same vendoring the
  standalone engine repos do (`insimul-godot/conformance/`, unity, unreal). It is
  what makes the parity gates runnable from a fresh checkout with no sibling
  submodule. Re-copy it on a corpus change; see `conformance/VENDORED.md`.
- **Every leg resolves the corpus the same way**: `INSIMUL_CONFORMANCE_DIR` (env) →
  the vendored `conformance/prolog` → the sibling
  `../insimul-runtime/packages/core/conformance/prolog`. That order is implemented
  in `CMakeLists.txt` (baked as `INSIMUL_CONFORMANCE_DEFAULT_DIR`) and in
  `rust/insimul/tests/conformance.rs`. Any new leg must follow it — and must
  **hard-fail** on a missing/empty corpus rather than skip (no vacuous passes).
- The `AMENDMENTS` tables in `tests/conformance.c`, `rust/insimul/tests/
  conformance.rs` and `tests/wasm_conformance.mjs` must stay in lockstep; all three
  print an `[AMEND]` line and the same
  `files / cases / passed / failed / amended` summary, so the legs are
  directly comparable (currently 10 files, 76 cases, 76 passed, 1 amended).
- **Cross-leg parity is a diff, not two green checkmarks.** Every leg supports
  `INSIMUL_CONFORMANCE_JSON=<path>`, writing one JSON-Lines record per case that
  carries the **raw** `insimul_query_next()` strings (not a reparsed model).
  `scripts/conformance_parity.sh` runs native + wasm that way and `diff`s the
  records, so a difference in solution *order*, error wording or number
  formatting fails even when both legs still satisfy `expected`. A new leg should
  emit the same records. Result today: 76/76 byte-identical — see
  `conformance/WASM_PARITY.md`, which is where any future divergence gets
  documented (never skipped).
- The corpus carries the **KINP identity layer** (`identity.json`,
  `equivalence.json`, `worlds.json`, and a rewritten `gameplay.json`): entity
  atoms are CURIEs (`'insimul:ent:<id>'`, world-scoped
  `'insimul:world:<w>:ent:<id>'`), and `kb`/`query` are no longer atom-only — they
  contain compound terms (`id(ent, Ns, Local)`, `'@world'(W)`, `confidence(0.8)`).
  A CURIE is always a **quoted atom**, never a term to decompose; a world's local
  id may contain a percent escape (`alderforest%23save-7f`) that the engine must
  leave undecoded. See `@insimul/core`'s `conformance/README.md`.

## Snapshot / restore format (US-LI4)
- `insimul_kb_snapshot` serializes the **dynamic user clause set** only. Enumerate
  it with `current_predicate(N/A)` + `predicate_property(H, dynamic)` and drop
  `$`-prefixed names — the bootstrap's own predicates are loaded *static* (via
  `pl_consult_fp`), so the dynamic filter already excludes them; the `$` filter is
  belt-and-suspenders. `sort/2` the `N/A` list for deterministic predicate order;
  `clause/2` preserves assert order within a predicate. Result: **byte-identical**
  output for equal states (the `snapshot` ctest asserts it).
- Write clauses with `copy_term` → `numbervars(T,0,_)` → `write_term(S,T,[quoted(true),
  numbervars(true)])` so variables render as `A,B,C` (not `_G123`) and the text is
  BOTH re-readable by restore AND parseable by the wrappers' `prolog-fact-parser.ts`.
  The `snapshot_parse` ctest runs that real TS parser (via `node
  --experimental-strip-types`, gracefully skipping if node/submodule absent) over
  the committed golden fixture `conformance/snapshots/basic.snapshot.pl`.
- Snapshot's result file is **not** the tagged SOL/OK/NONE channel: line 1 is the
  status (`OK`/`ERR <term>`) and the image text follows (it is multi-line). Build
  the image into an atom first (`with_output_to`) so a serialization error is
  reported *before* any status byte is written. Restore reuses the transactional
  consult loop but parses the image first, then `retractall`s every dynamic pred,
  then asserts — so a bad image never destroys existing state.

## Versioning & packaging (US-LI5)
- **Semver has ONE source of truth: the tracked `VERSION` file.** `CMakeLists.txt`
  `file(STRINGS VERSION ...)` reads it into `project(... VERSION)` and compile defs;
  `insimul_version()` (src/insimul.c) embeds it; `scripts/package.sh` stamps it. To
  bump the version, edit `VERSION` only — do not hardcode it anywhere else.
- `insimul_version()` is stamped from CMake compile defs (`INSIMUL_VERSION`,
  `INSIMUL_GIT_SHA` via `git rev-parse --short HEAD` at configure time,
  `INSIMUL_TREALLA_TAG`/`_COMMIT`). The `#ifndef` fallbacks in src/insimul.c only
  fire for a non-CMake compile. Applied to BOTH `insimul` and `insimul_shared`.
- `scripts/package.sh` builds `insimul_shared` and assembles `dist/<platform>/`
  (shared lib + `insimul.h` + `VERSION`). Platform from `uname` → `macos-arm64`
  etc. It reads the Trealla pin by `sed`-ing `CMakeLists.txt` (the authoritative
  pin), so the stamp can't drift from what was built. `dist/` is gitignored.
- **`--target wasm` is a sibling package, not a second mechanism** (US-3). The
  same script, the same `write_stamp` helper (only the `platform` field differs:
  `wasm32-emscripten`), so a browser host cross-checks its engine exactly as a
  Unity build does. Default target stays `native` — the existing no-arg
  invocation must keep behaving identically.
- The wasm package's identity lives in the generated `package.json`
  (`@insimul/prolog-wasm`, `type: module`, an `exports` map). Its `dependencies`
  are **empty on purpose**: the dependency direction is one-way, nothing here
  may depend on a JS consumer. Adding a file to the package means adding it to
  BOTH `files` and (if importable) `exports` — `tests/wasm_package_smoke.mjs`
  asserts every named path resolves.
- `wasm/index.mjs` is the package entry (`exports["."]`). It imports
  `./insimul.mjs`, the **generated** glue, so it only resolves once packaged
  under `dist/wasm/`; inside the repo import `wasm/insimul-api.mjs` and pass it
  the glue yourself (what `tests/wasm_*.mjs` do).
- Packaging ends by running `tests/wasm_package_smoke.mjs` over the assembled
  directory — layout, exports map, no-deps, a real query, and
  `insimul_version()` **byte-equal** to the `VERSION` stamp (rebuilt from its
  five fields), which is what makes shipping a stale `build-wasm/` a hard error.
  It also prints the raw/gzip/brotli size table `docs/consuming.md` records;
  regenerate those numbers from its output after any Trealla or Emscripten bump.

## The wasm target (US-1) — cross-build rules
- **One CMakeLists, two toolchains.** `emcmake cmake` sets
  `CMAKE_SYSTEM_NAME=Emscripten`, so `if(EMSCRIPTEN)` is the switch. Everything
  wasm-specific lives in **`cmake/wasm.cmake`**, `include()`d after
  `enable_testing()` followed by a top-level `return()` — the native test
  executables below that point are host binaries a cross build cannot run. Keep
  new wasm surface in that file, not scattered through `CMakeLists.txt`.
- **Host build-tools must not be cross-compiled.** `bin2c` has to *run* during
  the build, so under `CMAKE_CROSSCOMPILING` it is compiled at configure time
  with `find_program(... cc clang gcc)` + `execute_process`, not
  `add_executable` (which emcc would turn into a .js). Same trap applies to any
  future generator tool. `find_program` works on host paths because
  Emscripten.cmake sets `CMAKE_FIND_ROOT_PATH_MODE_PROGRAM BOTH`.
- **The wasm build is single-threaded on purpose.** `-pthread` in wasm ⇒
  SharedArrayBuffer ⇒ COOP/COEP headers on every embedding page. Upstream
  Trealla does the same (`NOTHREADS=1` for its WASI target); `USE_THREADS`
  defaults to 0 in `src/internal.h` and Emscripten's libc supplies the stubs.
- **`posix_spawnp` is the only symbol Emscripten's libc lacks** (Trealla's
  `process_create/3`). Stubbed to `ENOSYS` in `src/insimul_wasm_stubs.c` —
  deliberately NOT `-sERROR_ON_UNDEFINED_SYMBOLS=0`, which would silently turn
  every future missing symbol into a runtime abort.
- Link flags that are not optional: `-sSTACK_SIZE=8388608` (Trealla recurses
  deeply; the 64KB default overflows on ordinary goals) and `-sFORCE_FILESYSTEM=1`
  (the C↔Prolog channel `mkstemp`s under `/tmp`, which is MEMFS here).
- `EXPORTED_FUNCTIONS` in `cmake/wasm.cmake` **is** the wasm ABI — the linker
  garbage-collects anything unnamed. Adding a function to `insimul.h` means
  adding it there too.
- `INSIMUL_CONFORMANCE_DEFAULT_DIR` is resolved in `CMakeLists.txt` **above** the
  `if(EMSCRIPTEN) ... return()` block, because the wasm conformance ctest needs it
  too. `cmake/wasm.cmake` hard-errors at *configure* time if that directory holds
  no `*.json`, so a wasm build whose parity gate has nothing to run cannot even be
  generated.
- `wasm/insimul-api.mjs` is the hand-written JS wrapper. It keeps `insimul.h`'s
  ownership rules: borrowed `const char *` are `UTF8ToString`'d at the call site
  and never stored; handles are owned by one JS object that nulls them on
  release; argument strings are `malloc`/`free`d rather than `ccall`'s
  `'string'` marshalling (which copies onto the wasm **stack** — a snapshot
  image would blow it). `createKb()` opens the keepalive KB described in
  "Trealla gotchas" so create→destroy→create cycles are safe by default.

## Build
- `cmake -B build && cmake --build build && ctest --test-dir build`. `build/` is
  gitignored (holds fetched Trealla under `_deps/` and the generated
  `insimul_boot.c`). `src/insimul_boot.pl` is the tracked source of truth.
- Wasm: `scripts/build_wasm.sh` (configure via `emcmake` → build → `ctest`) into
  `build-wasm/`, which is gitignored by the `build-*/` rule. It never touches
  `build/`; the two trees coexist and both must stay green.
- **The full gate list**, cheapest-to-fail first — run all five before calling a
  change green: (1) `cmake -B build && cmake --build build && ctest --test-dir
  build`, (2) `scripts/build_wasm.sh`, (3) `scripts/conformance_parity.sh`,
  (4) `scripts/package.sh` and `scripts/package.sh --target wasm`, (5) `cargo
  test --manifest-path rust/Cargo.toml`. Gate 3 is the highest-signal one: it
  diffs the **raw** ABI strings across legs, so it catches divergence that each
  leg's own `expected` check would happily pass.
- **Run every gate from the repo root.** `cmake -B build` invoked from a
  subdirectory fails with "source directory ... does not appear to contain
  CMakeLists.txt", which in a summarized CI log is indistinguishable from a real
  compile failure. Prefer `cargo test --manifest-path rust/Cargo.toml` over
  `cd rust && cargo test` so the working directory never drifts.
- **A ctest that passes in 0.00s is a skip.** `snapshot_parse` degrades to a
  loud `[SKIP]` when node or the sibling `../insimul-runtime` submodule is
  absent, so it is vacuous in a standalone checkout and only really asserts in
  the monorepo layout. Read its output before trusting a green ctest summary.
