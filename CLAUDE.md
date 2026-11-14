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

## Two engines, one tree: the engine PORT (tasklist 250)
- **`src/insimul.c` names no engine.** It talks to `src/insimul_engine.h` — three
  functions (`insimul_engine_open/close/run`) — and one `src/engine_<name>.c`
  implements them. `engine_trealla.c` is the default; `engine_swipl.c` is the D20
  spike's second engine. Pick with `-DINSIMUL_ENGINE=trealla|swipl`. The port is
  three functions because the C layer never walks terms: an engine only has to
  load a program and run a ground goal, and everything a host sees is produced by
  `insimul_boot.pl` on top of that. Adding engine surface means adding it to the
  port, not to `insimul.c`.
- `ctest -R abi_neutrality` check C enforces the shape: an engine header is
  reachable ONLY from `src/engine_*.c`, and `src/insimul.c` includes none. Both
  halves keep a negative control.
- **Behaviours `insimul.h` lists as NOT PROMISED are declared by the BUILD.**
  `INSIMUL_ENGINE_ROWS` in `CMakeLists.txt` (numeric term ordering, whether
  arithmetic functor names are also static predicates) is compiled into
  `tests/neutrality.c`, which reads them as properties. The vendor's name stays
  where the pin lives and out of the tests (leak L-02) — and the row still goes
  red if an engine changes behaviour without CMake being updated.
- **The snapshot set is a LEDGER, not a probe.** `'$snap_owns'/2` records every
  predicate the ABI created (assert, consult, restore, `:- dynamic`), and
  `'$snap_preds'/1` snapshots that. Asking `current_predicate/1 +
  predicate_property(dynamic)` instead only works on an engine whose instance
  starts empty; on one shared database it dragged the system's own dynamic
  predicates into the image. Never go back to the probe.
- SWI is **located, not vendored**: `scripts/build_swipl.sh` holds the pin and the
  configure flags and writes `INSIMUL_SWIPL_PIN` into the prefix, which
  `cmake/swipl.cmake` reads into the version stamp. That is a spike shape, not a
  shipping shape — see `docs/SWIPL_SPIKE.md` §"G-10". `--target wasm` produces a
  SECOND, differently-shaped prefix (`lib/libswipl.a` + `include/` + `home/`);
  the pin file's `target=` says which, and `cmake/swipl.cmake` refuses the wrong
  one rather than link a host build into a wasm module.
- **`cmake/wasm.cmake` names no engine.** Anything an engine needs beyond its
  objects reaches the wasm link as `INSIMUL_ENGINE_WASM_LINK_OPTIONS` and
  `INSIMUL_ENGINE_WASM_PRELOAD_DIR`/`_MOUNT`, set by that engine's own cmake
  module. An engine whose Prolog library is not compiled in ships it as an
  Emscripten `--preload-file` image, which makes the browser payload THREE files
  — and a data package is resolved relative to the PAGE, so every JS caller must
  pass `locateFile` (`tests/wasm_*.mjs`, `scripts/wasm_payload.mjs` do).
  `node scripts/wasm_payload.mjs <build-dir>` is the one place payload bytes get
  quoted: it counts every file and refuses to print a partial total.
- Every place SWI could not implement the ABI cleanly is a NUMBERED GAP in
  `docs/SWIPL_SPIKE.md` §3. The one that is a correctness difference rather than
  packaging is **G-05: `op/3` is not KB-scoped in SWI**, so one world's operators
  reach another world's source.
- **The spike's ANSWER is `docs/SWIPL_MEASUREMENT.md`, and it is a NO** — SWI
  missed the bar on size alone (2.55x shipped natively, 2.33x over the wire) and
  beat the incumbent on startup, on memory, and matched it byte for byte on all
  76 corpus cases on all three legs. Trealla stays; `chief/252` stays parked.
  Do not re-derive that verdict from the tables — and do not quote a figure from
  it without `scripts/measure.sh` having produced it.

## Measuring the two engines (US-3)
- **`scripts/measure.sh` is the one command**, and it REGENERATES the doc: the
  tables in `docs/SWIPL_MEASUREMENT.md` live between
  `<!-- BEGIN/END GENERATED: <id> -->` markers that `scripts/measure_report.mjs`
  splices. Prose around them was written against the run in
  `bench/results/measurements.json`; a re-run that moves a figure materially
  makes the prose wrong, and fixing the prose is part of re-running.
- **The world is a COMMITTED fixture, not something the benchmark invents.**
  `bench/world/` (6 files, 1,630 clauses, 143,807 bytes) + `QUERIES.txt`, both
  generated deterministically by `bench/world/generate.mjs` (fixed LCG, no
  clock). `measure.sh` runs `generate.mjs --check` BEFORE it times anything, so
  a mutated world fails the measurement instead of silently changing what every
  published figure describes.
- **Two cross-checks make the comparison legitimate, and both are hard errors**:
  every record carries its own `insimul_version()` stamp, which the reporter
  matches against the tree it was told to measure (measuring the wrong build
  tree is the easiest mistake here and the hardest to see in a finished table),
  and every leg of both engines must report the SAME solution total for the same
  world. One harness per leg, shared by both engines: `tests/bench.c` (built by
  the default build, deliberately NOT a ctest — a benchmark's wall clock is not
  a gate), `rust/insimul/examples/bench.rs`, `scripts/wasm_bench.mjs`.
- **Size means TOTAL BYTES SHIPPED, never the library file.** With SWI,
  `libinsimul.a` is 40 KB against 3.3 MB and its `.wasm` is smaller than
  Trealla's — because its Prolog library is a 6.5 MB home tree / 2.7 MB `.data`
  image beside it. The build states that itself: `INSIMUL_ENGINE_RUNTIME_DIR`
  (set in the engine's own cmake module) becomes a `runtime=` line in
  `<build>/insimul-link.txt`, so `measure.sh` sizes "everything shipped" without
  naming an engine.
- **`<build>/insimul-link.txt` is how a NON-CMAKE consumer links this tree.**
  `rust/insimul-sys/build.rs` replays it (`search=`/`lib=`), and
  `rust/insimul/build.rs` replays the `rpath=` line — a build script's
  `rustc-link-arg` only reaches its OWN package's targets, and the binaries that
  must start (tests, examples) are the wrapper crate's. Without it every Rust
  binary on a located engine dies in dyld before `main`. Point the Rust leg at
  the other engine with `INSIMUL_LIB_DIR=<build-dir>`.
- **A loaded host inflates the SLOWER engine most** (more phases to be
  descheduled in): at load 18 on this 14-CPU host Trealla's wasm `create` read
  244 ms instead of 86 ms while no SWI figure moved. The load average is
  recorded in the published provenance table and `measure.sh` warns when it is
  above the CPU count. Also: the first process of a run pays cold file cache
  (SWI's first `create` ~12 ms vs a ~7 ms median), which is why nothing here is
  ever measured with one sample.

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
- **"Fetched, not inlined" is judged by `tests/wasm_glue_shape.mjs`, never by
  grepping for `data:application/octet-stream;base64,`.** Emscripten 3.1.50 –
  4.0.2 emit that string in every glue (an unconditional `isDataURI` helper;
  gone in 4.0.3), and 4.0.18+'s SINGLE_FILE embeds a raw string with no data URI
  at all, so the grep was wrong in both directions. The judge's three rules
  (names `insimul.wasm`; no data URI carrying a payload; glue < half the binary)
  each have a red case in `tests/wasm-glue-shape/cases.json`, replayed by the
  `wasm_glue_shape` ctest on the real glue; the package smoke adds the
  behavioural proof (a lone glue cannot start). There is no exact emsdk pin —
  the floor is 3.1.50 (`docs/webassembly.md`).

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
- **`core_vendor` also pins `save.rules`' `extensionKeys`** (PL.native-save-extension-keys,
  U110): it evaluates the vendored bundle and fails unless every `save.rules` step under
  `corebridge/tests/cases/` naming `extensionKeys` states exactly the sorted registry
  keys (22 at 6cd4b4e); `--check --core` also holds them to core's `extensionRegistry`
  source at the pin. A re-pin that registers an extension must update those cases on
  purpose. `core_vendor_extension_keys_negative` (`tests/save-extension-keys-negative/`)
  must see five wrong statements named.

## The feature-phase method table (Features Round C0, 2026-10-15)
- **The bundle has an INPUT pin now: `corebridge/core-pin.json`** (`coreCommit`,
  a full id, and the exact `esbuild` version). `vendor-core-bundle.mjs --core
  <checkout>` bundles core AT THAT COMMIT via `git archive` into a throwaway dir —
  never the checkout's working tree — with the checkout's `node_modules` as
  `nodePaths`, and refuses any other installed esbuild. VENDORED.json's
  `coreCommit` is the RECORD (still what CMake reads); `--check` fails when record
  and pin disagree. The pin today is core `main` 6cd4b4e (2026-11-12,
  PL.native-survival-rows: PL.core-survival-rules' five survival host rules and
  grown corpora, which the new `survival.*` rows run over P9c.core's needs, HUD bars
  and stamina; PL.core-camera-movement-gaps' `prop` solid kind, which
  `camera.movement.contract` states as `solidKinds`; three new layout ops, each a
  `layout.*` row; and G.cat-flags' refused genre flags and modules, which move
  some genre, pause-menu and composition answers). Before that, core `main` 603063d (2026-11-11,
  PL.native-tutorial-save: PL.tutorial-progress-save's tutorial save block — the
  registered extension `tutorial`, `readTutorialBlock`, and the `progress` option
  and `saveProgress()` of `TutorialQuestSystem` and `OnboardingManager` — which the
  tutorial and onboarding rows now carry, with its corpus; and
  PL.stale-corpora-checks, which changes nothing vendored here). Before that,
  core `main` 6667999 (2026-11-10, PL.native-ground-row: PL.movement-prose-split's split of core's movement
  contract, after which the `camera.movement.*` rows import
  `camera/movement-rules` and the bundle leaves the prose tables out, and
  PL.core-doc-fixes; the `audio.ground.*` rows run PL.ground-from-ir's reading,
  in since 431c95b). Before that, 431c95b (2026-11-10,
  PL.native-camera-movement: every core item the Unreal-first queue landed after
  72c658c — PL.movement-contract's movement contract and its corpus, which the
  `camera.movement.*` rows run, with PL.movement-followups' `missing-view-yaw`
  sight line and `slopeAtRest`; PL.ground-from-ir; PL.corpus-provenance-scrub,
  after which no vendored corpus names a private repository path;
  PL.interactables-cases' six cases and PL.core-props-docs' turned-tavern door
  case). Before that, 72c658c (2026-11-10,
  PL.native-interact-target: every core item the Unreal-first queue landed after
  7376894 — PL.examine-props' interact rule and its corpus, which the
  `props.interactables.*` rows run; PL.disk-changed-step's `disk_changed` step,
  which `saves.slots.apply` now takes; P9i.core's progression pack;
  PL.pickup-ring-search-case's six ring cases; and PL.tutorial-corpus-bundle's
  `*-corpus-host` modules, which the P8 rows import so the bundle reaches no save
  module). Before that, 7376894 (2026-11-10,
  PL.native-genre-hud-config: its two commits on eff846a, landed on core `main` by
  checked fast-forward; it gives core's genre HUD runner the `config_of` /
  `view_of` ops that the `ui.genreHud` row passes through, and 43 corpus cases).
  PL.native-title-rows (2026-11-10) found core `main` still at 7376894 and kept the
  pin: P8.core's title menu, tutorial and onboarding (ff599d7) were already in it;
  it added their rows and copied their two corpora.
  Before that, core `main` eff846a (2026-11-10, PL.native-pickup-settle: every core item the Unreal-first queue landed after
  ac229a7, among them P9f/P9g/P9h.core's packs, PL.quick-slot-one-based's 1-based
  `quickSlot` that the `saves.slots.*` rows pass through, and PL.quest-converter-gaps;
  core's pick-up placement and its corpus, which the `props.pickups.*` rows run,
  were already in at ac229a7). Before that, ac229a7 (2026-11-09,
  PL.native-props-rows: every core item the Unreal-first queue landed through
  PL.pickup-placement, among them PL.slots-delete-states' delete prompt and
  PL.quick-slot's dedicated quick slot that the `saves.slots.*` rows answer, and
  P6.core's props and inventory logic with its corpora that the `props.*` and
  `inventory.*` rows run). Before that, fc88be9 (2026-11-09, PL.native-catchup:
  core's `MECHANIC_STEP_OPS` that `mechanics.run` imports, the World IR's
  `['none']` modules form, and P1.core-slots' `SaveSlotsSession` with its corpus
  that the `saves.slots.*` rows run). Before that, f9aef13 (2026-11-07, P9a.native: it holds P9a.core's genre HUD, rules
  panel and mechanic runtime and their corpora); before that, b38e60d (2026-11-05, SP.composer-native: it holds
  SP.composer's composer and its corpus); before that, 4a46789 (2026-10-29, L.native-layout: it holds L1's layout rules and B9's
  composition rules); before that, c4b46c4 (the 2026-10-16 landing of tracks G and E and C0's wasm entry). To
  move it again: bump the pin, re-vendor, re-run `--check --core` and
  `ctest -R 'corebridge|core_vendor|layout|packs|corpus'` (every corpus ctest matches `corpus`: the P9a, saves-slots, props, pick-up, interactables, title-flow, tutorial, tutorial progress, camera movement, audio ground, survival, traversal, headless build and progression ones and their negatives; `core-pin.json`'s `coreRefNote` lists them by name), then regenerate the two pre-open
  reports (`node scripts/check-attribution.mjs . --report docs/pre-open/attribution.json`,
  `check-open-boundary.mjs . --rules scripts/open-boundary.rules.json --report docs/pre-open/open-boundary.json`) — NOTICE's `Pinned-Commit` must move too.
- **The layout rows (L.native-layout, U36) run core's layout corpus UNCHANGED.**
  `layout.<op>` is one row per op of core's `LAYOUT_OPS` / `COMPOSITION_OPS`, each
  calling core's own corpus boundary (`runLayoutOp` / `runCompositionOp`).
  `vendor-core-bundle.mjs` COPIES core's `conformance/layout/` and
  `conformance/layout-composition/` into `corebridge/vendor/core/conformance/`
  (hashed in VENDORED.json; `--check --core` byte-compares them) — never transcribe
  them into bridge cases. `layout_corpus` (`tests/layout_corpus.cpp`) runs them
  through `insimulcore.h`; `layout_corpus_negative` must see it fail a wrong
  answer. `gradeTerrain` at core's 2,049² cap is what sized the JS heap cap
  (192 MiB; it OOMs at 80).
- **The packs.compose row (SP.composer-native, U62(1)) runs core's composition
  corpus UNCHANGED**, the same way: `vendor-core-bundle.mjs` copies
  `conformance/packs/composition.json` and exactly the catalog files its `catalog`
  names (`packs/index.json`, `packs/<id>/pack.json`) to their core paths under
  `corebridge/vendor/core/`; `packs_corpus` (`tests/packs_corpus.cpp`) sends each
  case's `input` with `catalog: { index, manifests }` beside it and holds the answer
  to core's replay rule (exact JSON, or core's `[<code>]` in last_error);
  `packs_corpus_negative` must see it fail. The library carries no catalog: a
  binding sends the one it vendored at this pin.
- **The P9a rows (P9a.native, U84) run core's P9a corpora UNCHANGED**, the same
  way: `vendor-core-bundle.mjs` copies `conformance/ui/genre-hud-cases.json`,
  `conformance/ui/rules-panel-cases.json` and `conformance/modules/mechanic-runtime.json`;
  `tests/p9a_corpus.cpp` sends `{ op, ...input }` to `ui.genreHud` / `ui.rulesPanel`
  and `input` to `mechanics.run`, compared exactly; one ctest per row
  (`genre_hud_corpus`, `rules_panel_corpus`, `mechanic_runtime_corpus`) and
  `p9a_corpus_negative`; every case must be DRIVEN (the per-file line prints the
  driven count per op and `0 undriven`). `ui.genreHud` checks only `op` against
  core's `GENRE_HUD_OPS`, so a game's own settings (`config_of` / `view_of` over a
  world's `genreConfig` or a `recipe` on its `world`, PL.native-genre-hud-config,
  U92(2)) are projected by core's `genreHudConfigOf` and never restated in
  `entry.js` or a binding. A domain refusal those corpora pin is a VALUE; the rows'
  own refusals are errors with a code (`[unknown-op]`, `[invalid-input]`).
  `mechanics.run` is a stateless replay (core's `runMechanicRuntimeCase`), not a
  session: core keeps the per-step projection private, so a session would restate
  it (corebridge/README.md, "The P9a rows"). Its step-op list is core's
  `MECHANIC_STEP_OPS`, IMPORTED — never copy it back into `entry.js`.
- **The saves.slots rows (PL.native-catchup) are a SESSION over core's
  `SaveSlotsSession`**, held to core's `conformance/saves/slots.json`, copied the
  same way (`SAVES_CORPUS_FILES`). `tests/saves_slots_corpus.cpp` drives every
  `config`/`continue`/`rows`/`run` case through `saves.slots.create` and ONE
  `saves.slots.apply` per run step (the view after each step is the session's);
  only the `indicator` op (a bare indicator, no session step shows one) goes
  undriven, with a measured reason printed per case. Any other undrivable case
  fails the run — do not widen that exemption, add a way to drive the case.
  `saves_slots_corpus_negative` must see it fail.
- **The props and inventory rows (PL.native-props-rows, U89(2)) run core's P6
  corpora UNCHANGED**, copied the same way (`PROPS_CORPUS_FILES`:
  `conformance/props/{containers,documents,doors,notice-board}.json` and
  `conformance/ui/inventory-cases.json`; the inventory file shares
  `conformance/ui/` with the P9a corpora, so a file there belongs to the list that
  names it). `tests/props_corpus.cpp` drives EVERY case through the rows, one
  ctest per file (`props_*_corpus`, `inventory_corpus`) plus
  `props_corpus_negative`; no case may go undriven. Stateless rows answer one
  core function each; `props.reader.*`, `props.board.*` and `inventory.*` are
  sessions. The reader's and board's `apply` send every op to core's `step`
  (`applySteps` in `js/host-sessions.js`), because core answers an unknown action
  as its refusal VALUE `unknown_action` — do not route them through `applyOps`'
  op table, which would turn that value into an error. `props.contract` answers
  each corpus file's data tables from core's constants; never restate one in
  `entry.js`. `ui.trade` (core's `TradeModel`) is a different model from the
  inventory panel and stays its own row.
- **The pick-up settle rows (PL.native-pickup-settle, U91(2)) run core's
  `conformance/props/pickup-placement.json` UNCHANGED**, copied with the P6 set
  (`PROPS_CORPUS_FILES`) and driven by the same runner as
  `props_pickup_placement_corpus` (+ `props_pickup_placement_corpus_negative`).
  `props.pickups.{settle, sequence, clearance, pattern, ring}` are stateless, one
  core function each, answering the shape core's corpus runner records; they
  take and answer core's metres on its ground plane `(x, z)` and convert or
  mirror NOTHING — a binding maps its own frame in (`props.contract` →
  `props-pickup-placement.frames`). Refusals (`bad-spot`, `no-clear-spot`) are
  values. The runner holds the file's `numerics` to double precision and the
  contract's `constants` on their `value` (the `source` line is prose): keep both
  checks, they are what an engine port must also honour. Core's `isWalkable`
  callback has no row (nothing callable crosses the ABI); walkable ground is
  `walkable` areas.
- **The title, tutorial and onboarding rows (PL.native-title-rows, U92(1)) run
  core's P8 corpora UNCHANGED**, copied the same way (`TITLE_CORPUS_FILES`:
  `conformance/ui/title-flow.json`, which shares `conformance/ui/` and belongs to
  the list that names it, and `conformance/quests/tutorial.json`).
  `tests/title_corpus.cpp` drives EVERY case through `ui.titleFlow.*`,
  `ui.tutorial.*` and `ui.onboarding.*` (a title `session` case through a
  `saves.slots` session the title session links with `savesSession`; tutorial
  and onboarding sessions on a host clock at the file's `contract.t0`), prints
  the driven count per op and `0 undriven`, and holds each file's contract tables
  to `ui.titleFlow.contract` / `ui.tutorial.contract`; one ctest per file
  (`title_flow_corpus`, `tutorial_corpus`) plus one negative each. The title
  menu's `menu` fields go to core UNCHECKED (core reads a wrong-typed flag as its
  default, and the corpus pins that). The tutorial's state is core's
  `tutorialStateJson` and the bindings' changes core's `corpusBindings`, both
  IMPORTED from `quests/tutorial-corpus-host` (and the title ops and steps from
  `ui/title-flow-corpus-host`; core's PL.tutorial-corpus-bundle) — never from the
  corpus modules themselves, whose comparator import drags the save-file code
  into the bundle (−29,112 bytes at 72c658c), and never restated in `entry.js`. An
  op's `events` are what the quest raised on the session's bus, never the
  host's own event.
- **The tutorial save rows (PL.native-tutorial-save, U99(1)) run core's
  `conformance/saves/tutorial-progress.json` UNCHANGED**, copied with the save
  corpora (`SAVES_CORPUS_FILES`, beside `slots.json`) and driven by the title runner
  as `tutorial_progress_corpus` (+ `tutorial_progress_corpus_negative`). The save
  block is core's: `ui.tutorial.readProgress` answers core's `readTutorialBlock`
  (an unreadable block is a VALUE, `{ ok: false, keys }`); `ui.tutorial.create`'s
  `config.progress` and `ui.onboarding.create`'s `options.progress` read the stored
  block with it and refuse exactly those blocks as `[invalid-input]`; the `save` op
  on both apply rows is core's `saveProgress()`. Import `quests/tutorial-save`
  (it imports only a type), never `quests/tutorial-progress-corpus` (its comparator
  is the save-file code `UNBUNDLED_CORE_MODULES` refuses), which is why
  `ui.tutorial.contract` states the progress file's `clockStart`, `extensionKey`
  and `blockMembers` but not its runner lists; the runner holds those to the steps
  it maps. The restore rule is core's and is not restated: a lesson the game now
  teaches before a save's `current` becomes current (U99(2)).
- **The interact rows (PL.native-interact-target, U94(3)) run core's
  `conformance/props/interactables.json` UNCHANGED**, copied with the props set
  (`PROPS_CORPUS_FILES`) and driven by the same runner as
  `props_interactables_corpus` (+ `props_interactables_corpus_negative`).
  `props.interactables.{target, interact, meaning, host, noun}` are stateless,
  one core function each (`interactTarget`, `interactWithProp`,
  `propInteraction`, `noticeBoardHost`, `propNoun`), over ONE prop or one stand:
  the runner walks a case's `props` and `stands` and composes its board (`board`
  as stated, else `{ host, name }` from the `host` row and the settlement) the
  way core's runner does, and makes a `meanings` case's `count` from the rows'
  meanings — both projections self-tested. Do not widen a row to take the
  corpus's lists: the rows are what a binding calls. Core's metres on `(x, z)`,
  nothing converted. Refusals (`bad_position`, `not_offered`) are values; a
  position that is not a finite point goes to core (the corpus pins `x: "here"`).
- **The camera movement rows (PL.native-camera-movement, U95(5)) run core's
  `conformance/camera/movement.json` UNCHANGED**, copied as their own set
  (`CAMERA_CORPUS_FILES`; P7.core's `modes.json` beside it is not copied, no row
  runs it) and driven by the same runner as `camera_movement_corpus` (+
  `camera_movement_corpus_negative`). `camera.movement.{occluders, sideView,
  buildingSolid, move, slope, slopeAtRest, step}` are stateless, one core
  function of `camera/movement-contract` each (`sightOccluders`,
  `sideViewBlockers`, `buildingSolidOf`, `playerMove`, `slopeResponse`,
  `slopeAtRest`, `stepResponse`; since PL.native-ground-row imported from
  `camera/movement-rules`, which core's PL.movement-prose-split keeps free of the
  prose tables no row reads — importing `camera/movement-contract`, which
  re-exports `camera/movement-prose`, is refused by the vendor tool
  (`UNBUNDLED_CORE_MODULES`, with its own remedy)), taking a case's `input` as their args; the
  runner drives every case a second time with `solids` and `exclude` reversed
  (the file's `order` rule, as core's `checkMovementCase` does; self-tested), and
  holds the data tables (`modes`, `solidKinds` since 6cd4b4e, `storeyM`, `gait`, `ground`) to
  `camera.movement.contract` — an Area's `contract_row`, not `props.contract`.
  Import the contract module only, never `camera/movement-corpus` (its comparator
  is the save-file code `UNBUNDLED_CORE_MODULES` refuses). Core's metres in the
  IR's left-handed world frame, nothing converted or mirrored (Unreal's import
  maps it). Refusals (`missing-view-yaw`, `not-a-side-view`, `invalid-radius`,
  `invalid-move`, `invalid-walk`) are values; only `mode`, `feet`, `view`,
  `solids`, `exclude` and `running` are type-checked.
- **The ground reading rows (PL.native-ground-row, U97(3)) run core's
  `conformance/audio/ground.json` UNCHANGED**, copied as their own set
  (`AUDIO_CORPUS_FILES`; P5.core's `cues.json` beside it is not copied, no row
  runs it) and driven by the same runner as `audio_ground_corpus` (+
  `audio_ground_corpus_negative`). `audio.ground.{placeAt, groundSurfaceAt,
  footstepAt}` are stateless, one core function of `audio/ground-from-ir` each,
  taking a case's `input` (`world`, `at`, `gait`) as their args and checking
  NOTHING: core reads every input itself and its corpus pins the reading (a world
  that is not an object has no ground and no settlement; an `at` that is not a
  finite point has no reading, null). The open ground `terrain.texture.ground` is a
  default, never a refusal. The runner drives every case a second time with the
  world's `geography.settlements`, `geography.groundSurfaces` and `entities.roads`
  reversed (`reversed_world`, the file's order rule as core's `checkGroundCase`
  drives it; self-tested), and holds `audio.ground.contract` to the file's
  contract: the file's `ground` table mixes data and prose, so the row states its
  data keys only (`tiers`, `kindDefaults`, `kindFallback`) and the runner compares
  on the row's keys (`keyed_tables`), plus `defaultFootstepSurface` whole. Import
  `audio/ground-from-ir` and `audio/footsteps` only, never `audio/ground-corpus`
  (its comparator is the save-file code). IR metres on `{x, z}`, nothing converted
  (Unreal's `Portable/InsimulAudioPlace` maps centimetres and its level offset in,
  then binds these rows in place of its interim reading).
- **The survival rows (PL.native-survival-rows, U106(1)) run core's P9c corpora
  UNCHANGED**, `conformance/survival/{needs,hud,stamina}.json` copied as their own
  set (`SURVIVAL_CORPUS_FILES`) and driven by their own runner,
  `tests/survival_corpus.cpp`, as `survival_corpus` (+ `survival_corpus_negative`,
  which perturbs EVERY case's expectation and must see each refused, as Unreal's
  does). One row per core function of `survival/needs`, `survival/survival-hud`,
  `survival/survival-systems`, `stamina/stamina` and `StaminaPool`, named
  `survival.<group>.<op>` after the file's area (`survival.needs.*`,
  `survival.hud.*`, `survival.stamina.*`). A row that answers a whole corpus op
  takes the case's `input` and answers its `expected` (`{ ok, value }`, a refusal
  `{ ok: false, refusal }` as a VALUE); the step rows a game calls as it plays
  (`advance`, `restore`, `action`, `consume`, `useItem`, `setTemperature`,
  `modifier`, `removeModifier`, `enable`; `survival.hud.reduce`/`.stamina`) are
  STATELESS over the `state` (and `hud`) the last answer carried, so a `run` case
  is one row per step and the runner records each in core's runner's shape. The
  needs rows read the tuning from `survival` and `params` on every call (never a
  tuning sent back), the stamina rows from `staminaConfig`. `StaminaPool` is the
  session `survival.stamina.pool.create`/`.apply` (no KB: each op answers its
  `energy/3` delta and the `ISurvivalSystem` calls core made, under `host`).
  Import those modules only, never `survival/systems-corpus` (core's runner). Only
  `state`, `hud`, `item`, `events`, `stamina` and the pool's create lists are
  type-checked (`[invalid-input]`); core reads the rest and its corpus pins the
  refusals (`need_not_tracked`, `bad_amount`, `not_usable`, …) as values. Unreal's
  `Portable/InsimulSurvival` is the interim copy these rows retire
  (`P9c.unreal.retire-survival-copy`).
- **The traversal kernel rows (PL.native-traversal-rows slice 1, U106(1)) run
  core's P9e kernel corpora UNCHANGED**,
  `conformance/traversal/{affordances,vehicles,fast-travel,ground-seating}.json`
  copied as their own set (`TRAVERSAL_CORPUS_FILES`, with slice 2's three) and driven by their own
  runner, `tests/traversal_corpus.cpp`, as `traversal_corpus` (+
  `traversal_corpus_negative`, every case perturbed and refused). One row per core
  function of `traversal/traversal` (+ `traversalGraphFacts`), `traversal/vehicles`
  (+ `vehicle-facts`), `traversal/fast-travel` (+ `fast-travel-facts`) and
  `ground-seating/ground-seat`, named `traversal.<group>.<fn>` after the file's area
  (`traversal.affordances.*`, `traversal.vehicles.*`, `traversal.fastTravel.*`,
  `traversal.groundSeating.*`). The three older corpora pin several functions per
  case, so each row answers ONE function under a named key and the runner composes
  the case's record from the rows, as core's corpus test composes it from core's
  functions, then drives it again with its lists reversed (core's order guard).
  The ground-seating rows that answer a whole op take the case's `input` and answer
  its `expected`; the settle rows (`initial`, `retarget`, `offsetAt`, `unseat`) are
  STATELESS over the `state` the last answer carried. Tunings are core's RESOLVED
  tunings, read from the IR by the `*.tuning`, `.links` and `.fromIR` rows. Never
  import `traversal/systems-corpus` (core's runner).
- **The traversal layers (PL.native-traversal-rows slice 2, U106(1)) run core's
  `conformance/traversal/{session,mounts,save}.json` UNCHANGED** in the same set and
  runner. Core's `TraversalPlanner`, `VehicleRegistry` and `FastTravelDirector` are
  ONE session (`traversal.session.create` / `.apply`), wired as core's
  `docs/traversal-systems.md` §1 and §8 wire them (the shared `StaminaPool`, the
  registry's follow and lent reins, the personal verbs' `personalVehicleModes`
  handed to `setModes`); each op is one core call answered under a named key plus
  what the hosts recorded (`events`, `orders`, `clock`), and the view is the four
  layers' state. The probe and the locomotion host are DATA the binding states
  (`probe`, `locomotion.stuck`, op `host`), because core's callbacks cannot cross
  the ABI. The pure parts are one row per function: `traversal.personal.*`,
  `traversal.lending.*`, `traversal.save.*`. A session case is driven as one session
  with one apply per step; the runner keeps the recordings pending until a step
  records them, as core's runner does. Unreal's `Portable/InsimulTraversal` is the
  interim copy both slices retire (`P9e.unreal.retire-traversal-copy`;
  `corebridge/ENGINE_BINDINGS.md` maps every function of it to its row).
- **The headless build rows (PL.native-headless-build, U106(1), U107) run core's
  P10 corpus UNCHANGED**, `conformance/build/headless.json` copied as its own set
  (`BUILD_CORPUS_FROM`) to `vendor/core/conformance/headless-build/headless.json`:
  the one set vendored under another folder than core's, because every `build/`
  rule here (`.gitignore`; history-scan's and open-boundary's `build-output-tree`,
  which reads every REF, so one branch's finding turns every branch's scan red)
  would read core's folder as build output. Driven by its own runner, `tests/build_corpus.cpp`, as `build_corpus` (+
  `build_corpus_negative`). One row per function of core's `build/headless-build`,
  named `build.<fn>` (`build.plan`, `.checkResult`, `.checkProgress`, `.size`,
  `.resultLine`, `.progressLine`, the credential scan, the path rules and both case
  folds) plus `build.contract`. The checkers answer core's whole answer, details
  included; a request, result or event list core cannot read is core's VALUE, never
  a row error. The corpus's credentials are `<<secret:NAME>>` markers the RUNNER
  expands from the file's own fixtures (never a literal credential in a committed
  file: hand cases use shapes core's scan names and no history-scan rule does). Never
  import `build/headless-build-corpus` (core's runner: it drags in the village-state
  comparator). Unreal's `Portable/InsimulHeadlessBuild` is the interim copy these
  rows retire (`P10.unreal.retire-headless-build-copy`).
- **The progression and skill rows (PL.native-progression-rows, U106(7)) run core's
  P9i corpora UNCHANGED**: `conformance/progression/*.json`, `conformance/skills/*.json`
  and `conformance/prolog/mechanic-skill.json`, copied as one set
  (`PROGRESSION_CORPUS_FILES`) and driven by `tests/progression_corpus.cpp` as
  `progression_corpus` (+ `_negative`). `progression.<group>.<op>` and
  `skill.<group>.<fn>` are one core function each, `{ ok: true, value }` with core's
  refusals as values; the tracker is stateless (`progression.gamification.step` takes
  the `run` the last answer carried). `skill.create` opens core's `SkillProgression`
  as a session; with `kb` it owns a native KB (`host-prolog-engine.js`'s
  `createPrologEngine`, the WHOLE `PrologEngine` seam, released by the session's
  `onDispose` in `host-sessions.js`), so `skill.unlock` asks core's own
  `skill_goal_met/2` there; with none, core's no-KB rule stands (a node that asks
  anything stays locked). Never import `progression/systems-corpus` (core's runner).
  The JS case leg has no Prolog: a KB-backed hand case is `"legs": ["c"]`.
- **The bundle carries one npm package, `zod`** (core's `system-packs/schema`
  builds its schemas with it at module scope, and the composer imports that
  module). npm imports resolve along the core checkout's `node_modules` chain
  (its own, then each one above it — a hoisted install keeps esbuild and zod in
  different ones), plus any `--node-modules <dir>`; a symlinked package is
  labelled and recorded by its last `node_modules` segment, since esbuild reports
  its real path. `npmModules` is compared by `--check --core`; NOTICE has its
  stanza.
- **macOS realpath trap**: esbuild reports paths it resolves itself through
  symlinks (macOS's `/var` → its real path), so the extracted root, `node_modules` and
  `js/` are all `realpathSync`'d before any label is matched by prefix. Without it
  only the modules resolved by the plugin got canonical labels and the bundle
  embedded a temp path — non-reproducible.
- **The case corpus is two directories, run by two harnesses.**
  `corebridge/vendor/core/cases/` is GENERATED by `tools/emit-bridge-cases.mjs`
  from core's own corpora at the pin (a transcription — it runs no core code and
  computes no expectation; hashed in VENDORED.json, re-derived by `--check
  --core`); `corebridge/tests/cases/` is hand-written for behaviour no core corpus
  pins. `tests/corebridge_cases.c` (C ABI → QuickJS) and
  `tests/corebridge_cases.mjs` (the same bundle in a Node `vm`, V8 + Node crypto)
  implement the matcher in `corebridge/tests/README.md` INDEPENDENTLY;
  `corebridge_cases_parity` diffs their raw result strings. Both fail on a method
  with no case; the JS leg fails when `corebridge/README.md`'s table (between the
  BEGIN/END METHOD TABLE markers) is not exactly `core.methods`.
- **SHA-256 is real now and lives in C** (`corebridge/src/insimulcore_sha256.c`,
  installed as `__insimul_sha256_hex`). `js/host-crypto.js` maps core's
  `createHash('sha256').update(str).digest('hex')` onto it, replacing lone
  surrogates with U+FFFD first so the bytes hashed are Node's. Anything else it
  is asked for still THROWS. `corebridge_sha256` holds the C to the NIST vectors.
- **Nothing in the library prints.** QuickJS has no `console`; `js/host-console.js`
  installs one that records into a per-call buffer (`core.diagnostics`). Core
  logs unguarded in `migrateExtensions` and the waypoint director — without the
  polyfill an ordinary save load throws ReferenceError.
- **Stateful rows share one contract** (`js/host-sessions.js`): `<area>.create`
  → integer handle (from 1 per insimulcore handle, never reused), `<area>.apply
  { session, ops }` → `{ results, …, view }`, `session.dispose`/`session.list`. A
  failing op stops the batch and KEEPS earlier effects (core mutates in place) —
  that is documented, not a bug to fix.
- **Error text is contract**: a core error with a string `code` is re-thrown as
  `<Name>: [<code>] <message>` (the dispatcher's `asRejection`), so a host reads
  `[unknown-recipe]` without parsing prose. Domain outcomes (`save.decode` of a
  corrupt slot, a refused trade) are values, never errors.
- **What engines must add** is `corebridge/ENGINE_BINDINGS.md`; this repo changes
  no engine.

## The pre-open audit (tasklist 242)

- **The history is the audit surface, not the tree.** `git clone` copies every
  commit, so every other gate here — `trealla_vendor`, `core_vendor`,
  `abi_neutrality` — reads a tree that says nothing about what is published.
  `scripts/history-scan.mjs` reads every blob reachable from every ref;
  `docs/pre-open/history-scan.json` is its committed output and
  `docs/pre-open-audit.md` is the human record. Re-run:
  `node scripts/history-scan.mjs --check --verify-scrub --report docs/pre-open/history-scan.json`.
- **The method is INHERITED from `insimul/core`@`b37837b` (tasklist 241), which
  went first.** `check-pack-provenance.mjs` is vendored byte for byte;
  `history-scan.mjs` is derived with three divergences listed in its own header.
  A second secret scanner is a second thing to keep correct, and the half nobody
  re-reads is the half that reports clean — extend the rules file, not the fleet.
- **Every finding is classified by a human in `scripts/history-scan.rules.json`,
  and `--check` fails on one that is not.** `allow` entries key on `path`,
  `blob`, or (native's addition) `pathPrefix` — used for the 39 vendored engine
  `.pl` files and `bench/world/`, so those blobs stay VISIBLE in the report
  rather than disappearing into a rule `except`.
- **The rewrite is PREPARED, never executed.** `scripts/history-scrub.sh` prints
  the exact `git filter-repo` invocation; it refuses `--execute` while the plan
  purges nothing, refuses a stale report, refuses a non-bare repo, and omits
  `--invert-paths` when the paths file is empty (filter-repo reads an empty paths
  file as *delete the whole tree across all of history*). The visibility flip and
  the rewrite are human-gated and out of scope for every tasklist.
- **Anything you commit is scanned forever, including the scanner's own
  fixtures.** `tests/history_scan_selftest.mjs` assembles every synthetic
  credential by concatenation instead of taking a `SELF_FILES` exemption — an
  exemption is a permanent hole. The structural pack detector reads the whole
  blob, comments included: a comment that spells out the pack skeleton's keys IS
  a pack document. Commit, then re-run the scan; a pre-commit scan proves nothing
  about what you just wrote.
- `ctest -R history_scan` falsifies all of it first: 45 self-test checks (every
  rule fires on a synthetic positive), then the real audit, then a throwaway
  repository with a planted key — deleted in the NEXT commit — which the gate
  must FAIL, and a real `git filter-repo` run over it that must come back clean.
- **The TREE has its own two audits, and they are a gate, not a report.**
  `scripts/check-open-boundary.mjs` + `open-boundary.rules.json` answer the
  content and dependency halves of the checklist over the tracked set
  (`git ls-files`, because that is what a clone publishes), and `ctest -R
  open_boundary` runs them. It has **no `--check` flag on purpose**: any
  unresolved finding exits non-zero, always — a gate with opt-in enforcement is
  one forgotten argument away from a green job that checks nothing. Its path
  rules are the SAME rules as the history scan's, and the self-test fails if the
  two files drift apart.
- **"Nothing is reachable" is a claim about FOUR surfaces here, not one.** Core
  closes its graph with npm alone; this tree needs JS (declared set is *empty* —
  there is no `package.json`, so every bare specifier is a finding), Rust
  (`Cargo.toml` tables — cargo refuses a `use` of an undeclared crate, so the
  manifests are the graph), C (`#include` must resolve inside the repository),
  and **the build itself** (`build-time-fetch`: a dependency the build downloads
  is one no import graph can see). Adding a language to this repo means adding
  its surface there.
- **A rule that fires on correct code gets fixed, never allowed.** The C rule
  first flagged any `..` in an `#include` and hit seven upstream isocline
  includes that stay inside the tree; the fix was to resolve the path and ask
  whether it escapes the REPOSITORY. Seven allowances would have papered over a
  wrong rule with seven holes. Conversely `check-pack-provenance.mjs`'s own
  `PROVENANCE_SELF_FILES` must be honoured when you reach for `inspectPackText`
  directly — the exemption comes with the detector.
- `ctest -R open_boundary` proves it can fail the same way `history_scan` does:
  55 self-test checks (a positive AND a near miss per rule, plus real-CLI exit
  statuses), then the real tree, then **five violations injected into a `git
  archive` copy of it** — a closed pack, a closed-repo import, an escaping
  `#include`, a `git =` crate and a `FetchContent` — which must all be named,
  and the same tree must go green again when they are reverted.
- **`NOTICE` is a gate's data file, not a document.** `scripts/check-attribution.mjs`
  (`ctest -R attribution`) reads the `Key: value` lines in each `### stanza` and
  fails on a crate `rust/Cargo.lock` resolves with no stanza, a stanza whose SPDX
  disagrees with the crate's own metadata, a `Pinned-Version` the lock has moved
  past, or an unresolved license with no `Resolution-Owner`. Adding a dependency
  or vendoring a directory means adding a stanza; the prose around them is for
  humans and is not checked.
- **A `NOTICE` pin is checked against the ONE location the BUILD reads it from.**
  `Pin-Source: vendor/trealla/VENDORED.json#commit` (or `…/quickjs/VERSION`, or
  `…/core/VENDORED.json#coreCommit`) — the same three authoritative pins the
  version stamps use. An attribution naming a different drop than the bytes
  compiled is the failure the stamp discipline exists to prevent, one level up.
- **The trademark policy is LINKED, and both halves are enforced.** It is
  authored once in the contract repo; `missing-policy-link` fails when a file
  `docs/pre-open/status.json`'s `trademarkPolicy.linkedFrom` names stops carrying
  the URL, and `forked-policy` fails if a `TRADEMARK.md` ever appears here. Five
  copies of a policy is five policies. **`TRADEMARK.md` is therefore deliberately
  NOT in this repo's required-artifact list** — the artifact it owes is a link.
- **The status record is written by the tasklist that does NOT perform the
  irreversible steps**, so `docs/pre-open/status.json` marking `history-rewrite`
  or `visibility-flip` as `done`/`performedByTasklist: true` can only be a
  mistake or a lie, and the gate refuses it. That is check D's fifth injection —
  the record a future agent would point at when asked whether the flip was
  reviewed.
- **Every manifest must declare the repository's own SPDX** (`manifest-license`,
  over every `Cargo.toml`, every `package.json` and the `"license"` line
  `scripts/package.sh` stamps). `rust/Cargo.toml` said `MIT` while `LICENSE` was
  Apache-2.0 until US-3; a redistributor reads the manifest, not the LICENSE.

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
