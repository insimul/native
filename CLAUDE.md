# insimul-native — conventions for the native Prolog core

## The ABI boundary is opaque
- `include/insimul.h` must **never** include Trealla headers, expose Trealla
  types, **or name a vendor** — not in a type, a macro or a format string. It is
  the contract three engine wrappers (C#/C++/GDScript) parse. Two ctests hold
  it: `abi` includes *only* `insimul.h` (no engine TYPE is reachable), and
  `abi_neutrality` (tests/run_abi_neutrality.sh) greps the header for vendor
  names and compiles a consumer that tries `#include "trealla.h"` — **each check
  also runs against a deliberately broken fixture and must fail it**. Keep that
  negative control when you touch the script; a gate that cannot fail is the
  failure mode this repo keeps re-learning.
- **The ABI's promises are written down in the header** (US-2): what a swap must
  reproduce (ISO semantics, the pinned `double_quotes`/`unknown` flags, the
  binding-set JSON byte for byte, an ISO error class on every failure, reserved
  `$` names) and what it may NOT (numeric term ordering, bounded-ness, the
  library set, arithmetic-functor names as predicates, error TEXT). Adding
  behaviour means adding it to one of those two lists.
  `docs/ABI_ENGINE_LEAK_AUDIT.md` §5 is the ledger of what each of the 19
  findings became.
- `src/insimul.c` is the only unit that includes `trealla.h`. It talks to Trealla
  through the **public** C API (`pl_create`, `pl_consult_fp`, `pl_query`/`pl_redo`,
  `set_quiet`, `get_status`), never internal headers.

## Engine neutrality lives in the bootstrap (US-2)
- **Flags the output depends on are PINNED, never inherited**: `insimul_boot.pl`
  sets `double_quotes = chars` and `unknown = error` at load. Changing either is
  changing the ABI, not a build detail.
- **Errors cross as `ERR <class> <term>`**: `'$err_lines'/3` is the single place
  an exception becomes a record. It classifies with `'$err_class'/2` (ISO
  7.12.2's ten names + `unknown`) and normalises the error CONTEXT with
  `'$err_norm'/3`, so a host is never told its syntax error happened inside
  `read_term_from_atom/3`. C splits the class off in `split_err`/
  `set_error_record`; `insimul_last_error_class()` exposes it. Never make a
  consumer string-match `insimul_last_error()`.
- **`$`-prefixed names are a boundary, not a convention**: `'$guard'/2` walks
  every host term (query goal, asserted/retracted term, consulted clause and
  directive) and throws `permission_error(access, private_procedure, N/A)`.
  Before US-2, `'$ij_str'(user_output, hi)` from an ordinary goal printed to the
  process's stdout.
- **A directive that raises OR fails fails the whole consult** (`'$run_directive'/2`).
  It used to be swallowed by `catch(_, _, true)`, so a misspelled
  `:- set_prolog_flag(...)` loaded "successfully".
- **The binding-set JSON is RFC 8259 and lossless**: `'$ij_esc'/2` escapes every
  C0 control; integers past 2^53-1 become `{"bigint":"<digits>"}`; `inf`/`nan`
  become `{"float":…}`; the cons functor is normalised to `"."` whatever the
  engine calls it. Five wrappers parse this — extend the shape in the header,
  `docs/c-abi.md`, `rust/insimul/src/term.rs` and `tests/neutrality.c` together.

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
- **Create/destroy CYCLE hangs (process-global teardown) — FIXED IN `insimul.c`,
  do not re-add a keepalive.** `create → destroy(the last KB) → create` used to
  spin forever: `pl_destroy` calls `g_destroy()` when `g_tpl_count` hits 0 and
  re-`g_init`-ing then tearing down again never returns. US-2 moved the fix
  inside the library: `ensure_keepalive()` opens one engine instance on the
  first `insimul_kb_create` and never closes it. Every hand-rolled keepalive in
  this repo is gone; `abi_neutral_runtime` cycles KBs with none held, under a
  ctest `TIMEOUT` (the failure spins, so a clock is the only gate that catches
  it).
  **The internal instance must be BOOTSTRAPPED, not a bare `pl_create()`.** With
  a bare one, the third KB creation dies with SIGTRAP — the same crash
  `corebridge` independently hit and worked around. Keeping `g_tpl_count` above
  zero is necessary but not sufficient; consulting the bootstrap in that first
  instance is what makes it safe.
- **Arithmetic functors are also STATIC builtin predicates.** Names like `log`,
  `sin`, `max`, `gcd` are registered in `src/bif_functions.c` as `name/N`
  predicates, not just evaluable functors. So a user KB that uses e.g. `log/1` as
  a dynamic predicate hits `permission_error(modify, static_procedure, log/1)` on
  `asserta`/`assertz` — ISO allows it (there `log` is an evaluable functor only)
  and tau-prolog accepts it. The conformance harness handles this with a
  documented, printed amendment (rename), never a silent skip — see its
  `AMENDMENTS` table.

## The engine source is VENDORED here (US-3)
- **Trealla is committed under `vendor/trealla/`, not fetched.** libinsimul is
  layer zero — four engine runtimes, the Rust server and every save file sit on
  it — so its build must not depend on an upstream single-maintainer repo staying
  reachable. There is no `FetchContent` for the engine and none may come back;
  `trealla_vendor` fails on one. The drop is `src/`, `library/`, `util/bin2c.c`,
  `LICENSE`, `ATTRIBUTION` — upstream's `tests/`/`samples/`/`docs/`/`Makefile` are
  omitted. **Never hand-edit it**; see `vendor/trealla/VENDORED.md` to re-vendor.
- **Provenance is proven with git's own object ids, not a hash we invented.**
  `VENDORED.json`'s `gitObjects` holds upstream's tree/blob id for each vendored
  path at the pin; `tests/run_trealla_vendor.sh` recomputes them offline with
  `git write-tree` over a throwaway index (config-isolated, so nobody's
  `core.autocrlf` can make the gate lie). That ties the bytes on disk to a commit
  in `trealla-prolog/trealla`, and it catches an ADDED file — which a
  hash-per-listed-file manifest silently would not. Both negative controls (a
  tampered byte, an extra file) are part of the test.
- **The engine's license is RESOLVED, in writing:** `docs/TREALLA_LICENSE_FINDING.md`
  — SPDX `MIT`, read from the text, with the bundled components (imath MIT,
  isocline MIT, `sre` **Unlicense**, the Prolog library **BSD-2-Clause**) and the
  exact `NOTICE` stanza to ship. GitHub's API says `NOASSERTION` for Trealla and
  is wrong; cite the finding instead of re-asking a classifier. Re-read the text
  on every pin bump (§8 of that doc) — a `NOTICE` written against an unverified
  claim is the bug that survives going public.

## The conformance corpus is VENDORED here
- `conformance/prolog/*.json` is a mirror of `@insimul/core`'s
  `packages/core/conformance/prolog` (the source of truth) — the same vendoring the
  standalone engine repos do (`insimul-godot/conformance/`, unity, unreal). It is
  what makes the parity gates runnable from a fresh checkout with no sibling
  submodule. Re-copy it on a corpus change; see `conformance/VENDORED.md`.
- `conformance/radiant/` is vendored the same way, for the **second** library —
  see "libinsimulcore" below and `conformance/RADIANT_PARITY.md`.
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
- **Cross-leg parity is a diff, not three green checkmarks.** Every leg supports
  `INSIMUL_CONFORMANCE_JSON=<path>`, writing one JSON-Lines record per case that
  carries the **raw** `insimul_query_next()` strings (not a reparsed model — the
  Rust leg uses `KnowledgeBase::solve_raw`, which exists for exactly this).
  `scripts/conformance_parity.sh` runs native + wasm + **rust** that way and
  `diff`s the records against native, so a difference in solution *order*, error
  wording or number formatting fails even when every leg still satisfies
  `expected`. A missing toolchain is a hard failure, not a skip (`--no-rust`
  makes skipping explicit). A new leg should emit the same records. Result
  today: 76/76 byte-identical on all three — see `conformance/WASM_PARITY.md`,
  which is where any future divergence gets documented (never skipped).
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
- **The version stamp names the engine as a VALUE, never a field.**
  `insimul <semver> (git <sha>, engine <name>/<version>/<commit>)`, and the
  package `VERSION` uses `engine_name`/`engine_version`/`engine_commit`
  (`trealla_*` survive as deprecated aliases for one re-vendor, asserted equal by
  `wasm_package_smoke`). A test that asserts the vendor's name here turns an
  engine swap into a red test in someone else's repository — that was leak L-02.
- **Semver has ONE source of truth: the tracked `VERSION` file.** `CMakeLists.txt`
  `file(STRINGS VERSION ...)` reads it into `project(... VERSION)` and compile defs;
  `insimul_version()` (src/insimul.c) embeds it; `scripts/package.sh` stamps it. To
  bump the version, edit `VERSION` only — do not hardcode it anywhere else. The
  engine pin has the same rule, but it lives with the DROP (US-3):
  `commit`/`tag` in `vendor/trealla/VENDORED.json` are authoritative —
  `CMakeLists.txt` reads them into `TREALLA_GIT_TAG`/`_COMMIT` and
  `scripts/package.sh` reads the same file, so a stamp can never name a commit
  other than the bytes compiled. Only `INSIMUL_ENGINE_NAME` still lives in
  `CMakeLists.txt`.
- `insimul_version()` is stamped from CMake compile defs (`INSIMUL_VERSION`,
  `INSIMUL_GIT_SHA` via `git rev-parse --short HEAD` at configure time,
  `INSIMUL_ENGINE_NAME`/`_VERSION`/`_COMMIT`). The `#ifndef` fallbacks in src/insimul.c only
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
  image would blow it). `createKb()` no longer opens a keepalive KB — the
  library owns that now (see "Trealla gotchas") — and `InsimulError` carries
  `.class`, the ISO error class, alongside `.message`.

## libinsimulcore — the SECOND library (corebridge/)
- **Two libraries, two ABIs, one build. Do not merge them.** `libinsimul` is
  Trealla behind `include/insimul.h`; `libinsimulcore` is `@insimul/core`'s
  TypeScript in an embedded QuickJS behind `corebridge/include/insimulcore.h`.
  The only edge between them is that the second *consumes the first's public
  ABI* exactly as a game plugin does — `src/insimulcore.c` includes `insimul.h`,
  never `trealla.h`, and **no `insimul_kb` handle ever crosses `insimulcore.h`**.
  That last fact is what makes `insimulcore_shared` static-linking `libinsimul`
  safe: a host that also loads `libinsimul.dylib` gets an independent engine
  instance, not corrupted shared state.
- `insimulcore.h` is the contract Godot, Unity and Unreal all bind. It was moved
  here from `insimul-godot/gdextension/corebridge/` **byte-for-byte** and the two
  copies must stay `diff`-identical until Godot repoints at this one (its own
  tasklist). A header that forks between repos is the failure the promotion
  exists to prevent — change it here first, never in an engine repo.
- Everything corebridge-specific lives in `corebridge/CMakeLists.txt`, added from
  the root under `if(NOT EMSCRIPTEN)`. It is **not** built for wasm: a browser
  host runs core as the TypeScript it already is, so compiling a JS engine to
  wasm to run JS would be circular. Artifacts are forced into `${CMAKE_BINARY_DIR}`
  so `libinsimulcore.{a,dylib}` sit beside `libinsimul`'s — the engine repos'
  gates probe `<native>/build/libinsimul.*` and expect that flat layout.
- **Each vendored dependency has ONE authoritative pin location, and the build
  reads it from there**: Trealla's is `commit`/`tag` in
  `vendor/trealla/VENDORED.json`, read by the root `CMakeLists.txt` via
  `string(JSON ...)`; QuickJS's is `corebridge/vendor/quickjs/VERSION` →
  `CONFIG_VERSION`; the core bundle's is `coreCommit` in
  `corebridge/vendor/core/VENDORED.json`, regex'd out by the root `CMakeLists.txt`. `corebridge_smoke` then asserts
  `insimul_core_version()` reports both, so a stale vendored tree is a red ctest
  rather than a mystery in a bug report.
- **The evidence moves with the code.** Promoting the bridge promoted its gate:
  `tests/radiant/` holds `radiant_bridge.cpp` + `json_value`/`canonical_json`/
  `sha256` as **byte-for-byte copies** of insimul-godot's, and
  `conformance/radiant/` mirrors the 5-file/11-case corpus (digests recorded in
  `conformance/VENDORED.md`). Because the comparison code is literally the same
  file, "the promotion changed no behaviour" is a `diff` of the two runs, not an
  argument — both legs are byte-identical, recorded in
  `conformance/RADIANT_PARITY.md`. Never tidy those copies (the `INSIMUL_GODOT_*`
  guards stay); a copy you have edited is a copy you can no longer diff. They are
  test support, **not** a contract — that rule is `insimulcore.h`'s.
- **`enable_language(CXX)` is in the test section, not `project()`.** That gate is
  the only C++ in the repo and nothing shipped is C++, so `project(... LANGUAGES C)`
  stands and CXX is enabled next to `add_executable(insimulcore_radiant ...)`.
  It sits below the `if(EMSCRIPTEN) ... return()` block, so the wasm build never
  sees it.
- **The bundle is a function of its INPUTS, not of where core sits.** esbuild
  labels each bundled module with its path *relative to the process cwd*, so the
  artifact used to change bytes when core was reached by a different relative
  path — and `--check --core`, which re-bundles and diffs, would then report
  DRIFT on a perfectly correct tree. `bundle()` rewrites every label to a
  canonical name (`@insimul/core/src/…`, `corebridge/js/…`) before writing.
  Keep that: a gate that fires on a correct tree gets muted, and a muted gate is
  the failure mode this repo keeps re-learning. It is also what makes this
  bundle byte-identical to `insimul-godot`'s — previously true only because 104
  *copied* the artifact rather than re-bundling it.
- `corebridge/vendor/core/` is **generated** — never hand-edit it.
  `corebridge/tools/vendor-core-bundle.mjs --check` (the `core_vendor` ctest)
  verifies a sha256 per file from `VENDORED.json`'s `files` map. It hashes the
  **adapter inputs** (`corebridge/js/*.js`) as well as the generated outputs,
  because editing `js/entry.js` without re-vendoring leaves the shipping library
  running the old code while the source reads as the new — invisible to any
  output-only check. Only `--check --core <packages/core>` can see core drifting
  underneath the bundle; say so rather than implying the cheap check covers it.

## Build
- `cmake -B build && cmake --build build && ctest --test-dir build`. **It needs no
  network** — the engine source is committed (see "The engine source is VENDORED"
  below). `build/` is gitignored (holds the generated `insimul_boot.c`).
  `src/insimul_boot.pl` is the tracked source of truth.
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
  the monorepo layout. `core_vendor` does the same without `node`. Read their
  output before trusting a green ctest summary. The exception that proves it:
  `corebridge_radiant_none` also finishes in ~0.01s but is **not** a skip — it
  boots no engine by design and still asserts 11 classified cases. Check the
  output, not the clock.
