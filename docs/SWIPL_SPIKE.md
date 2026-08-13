# The SWI-Prolog spike — building a second engine behind the same C ABI

Tasklist `chief/250`, phase 1 of decision **D20**. This document is US-1's and
US-2's deliverable: **how the second engine is built and wired — on the native
embed target (§1–§2) and on the WASM target (§4)** — and **every place the C ABI
could not be implemented over SWI-Prolog without a workaround** (§3). The
measurement — binary size, startup, memory, and the 76/76 corpus on each leg —
is US-3's, and lands in its own artifact —
[`docs/SWIPL_MEASUREMENT.md`](SWIPL_MEASUREMENT.md), which also carries the
verdict. Nothing here decides anything.

> The spike is allowed to say no. Nothing in this file is an argument for
> migrating. It is the evidence a decision needs, written down while it is still
> cheap to check.

---

## 1. What was actually built

`libinsimul` now compiles **two engines from one source tree**, selected at
configure time:

```sh
# what ships today (unchanged, and the default)
cmake -B build && cmake --build build && ctest --test-dir build

# the spike's second engine
scripts/build_swipl.sh                       # prints <prefix>
cmake -B build-swipl-native \
      -DINSIMUL_ENGINE=swipl \
      -DINSIMUL_SWIPL_ROOT=<prefix>
cmake --build build-swipl-native
ctest --test-dir build-swipl-native
```

Both selections are green (`13/13` and `12/12` — the difference is the `smoke`
ctest, see gap **G-12**).

The comparison is **engine-vs-engine at a fixed interface**, not API-vs-API,
because only one file differs between the two builds:

| | shared | per engine |
|---|---|---|
| the ABI's 12 functions, records, JSON, error classes | `src/insimul.c` | — |
| all Prolog term work | `src/insimul_boot.pl` | — |
| the tests, the corpus, the packaging | `tests/`, `conformance/`, `scripts/` | — |
| **bring the engine up, consult the bootstrap, run a ground goal, tear down** | `src/insimul_engine.h` (the port, 3 functions) | `src/engine_trealla.c` / `src/engine_swipl.c` |

That the port is only **three functions** is a property of the existing design,
not something this spike introduced: the C layer never walks Prolog terms, so an
engine only has to load a program and run a goal. Everything a host sees is
produced by the bootstrap on top of that.

`ctest -R abi_neutrality` was tightened to hold the new shape: an engine header
is reachable only from `src/engine_*.c`, and `src/insimul.c` — which holds every
ABI decision — includes none. Both halves run against a deliberately broken
fixture, as the rest of that script does.

## 2. Reproducing the build on another machine

`scripts/build_swipl.sh` is the only supported way to produce the prefix, and it
is where the pin and the flags live:

- **pin** — `V10.0.1` = `e58621a91ab7dd530e1e8185ed518f63d851c414`. The script
  refuses to build if the tag resolves to a different commit; a moved tag is a
  deliberate decision, not a silent one.
- **flags** — `-DSWIPL_PACKAGES=OFF -DUSE_GMP=OFF -DBUILD_SWIPL_LD=OFF
  -DINSTALL_DOCUMENTATION=OFF -DBUILD_TESTING=OFF -DSWIPL_SHARED_LIB=ON
  -DCMAKE_BUILD_TYPE=Release`.
  The profile is "smallest **honest** embedding": each removal matches something
  Trealla's build here also lacks (no FFI, no OpenSSL, bundled bignum rather than
  a system libgmp). Nothing Trealla *has* was removed from SWI to flatter it —
  `USE_GMP=OFF` keeps unbounded integers via SWI's bundled LibBF, which the ABI
  promises and which the corpus exercises.
- **provenance** — the script writes `INSIMUL_SWIPL_PIN` into the prefix, and
  `cmake/swipl.cmake` reads `commit=` from it into the version stamp. A build can
  therefore never name a commit other than the bytes it linked, which is the rule
  `vendor/trealla/VENDORED.json` already enforces for Trealla.

Host these numbers were taken on: `Darwin 25.5.0 arm64`, Apple clang 17,
CMake 4.4.

**One host-portability finding, recorded because it cost an hour:** SWI-Prolog
**9.2.9 does not compile on this host at all**. macOS's `<mach/mach.h>` reaches
`<os/base.h>` → `<stdbool.h>`, whose `#define false 0` clobbers SWI 9.2.x's
`false(def, FLAG)` macro (`src/pl-thread.c:7784`). `-std=gnu11` does not help;
the macro is redefined regardless. 10.0.1 (which renamed those macros) builds
clean. Anyone re-running this spike against an older tag will hit it.

## 3. Named gaps — what the C ABI could not be implemented over cleanly

Each of these is a place where SWI's embedding model differs from Trealla's in a
way that a migration would have to answer. They are numbered so US-3 and
`chief/252` can cite them.

### G-01 — one Prolog database per process; a KB is a MODULE, not an instance
Trealla's `pl_create()` returns an independent engine; `pl_destroy()` frees it.
SWI's `PL_initialise()` may be called **once** and there is no second database.
So `insimul_kb_create()` on SWI allocates a fresh module `insimul_kb_<n>`, loads
the bootstrap into it, and calls every dispatch goal with that module as the
context module — which is what makes `assertz`/`retract`/`clause` in
`insimul_boot.pl` land in the right KB without the bootstrap knowing.

**Clause isolation does hold.** Probed directly: KB A asserting `secret(alpha)`
leaves KB B raising `existence_error` for `secret/1`, and B's own `secret(beta)`
does not reach A. But this is isolation *by naming*, not by construction — see
G-05 for the part of it that does not hold.

### G-02 — the engine is no longer self-contained (redistribution)
Trealla is compiled into `libinsimul` with its whole Prolog library embedded as
byte arrays (`EMBED=1`): one file, no runtime path. SWI resolves `boot.prc` plus
its compiled library from `$SWI_HOME_DIR` **at run time**. On this host that tree
is **6.9 MB** beside a **1.7 MB** `libswipl.dylib`.

Every consumer of this library ships to a platform where that matters — four
game-engine plugins, a browser bundle, and a Rust server. "Heavyweight to embed
and redistribute per-platform", the 2026 evaluation's phrase, is **still
literally true of the artifact shape**; whether it is true of the *numbers* is
US-3's question, not this one's. The port bakes the path in as
`INSIMUL_SWIPL_HOME` and honours `SWI_HOME_DIR` at run time.

### G-03 — a KB's namespace cannot be destroyed
SWI publishes no `destroy_module/1`. `insimul_engine_close()` therefore abolishes
every predicate the module owns and **leaves the empty module record and its atom
behind, permanently**. Trealla's `pl_destroy()` frees the instance outright.

An undocumented `'$destroy_module'/1` does exist and does run; the port does not
use it, because "libinsimul depends on an undocumented internal of the engine"
is a cost a migration should decide on deliberately rather than inherit. A host
that creates and destroys many KBs (a save/load loop) accumulates module records
either way — US-3 should measure it rather than assume it is small.

### G-04 — the ABI's pinned flags are module-sensitive, and the reader is not in the KB's module
`insimul_boot.pl` pins `double_quotes = chars` and `unknown = error` at load, and
on Trealla that is the whole story. On SWI both are **module-sensitive** flags,
and `read_term_from_atom/3` — the predicate that turns a host's goal text into a
term — runs in the `system` module, not the KB's. So the bootstrap's pin did not
reach the reader and `X = "ab"` came back as `{"X":"ab"}` instead of the char
list `insimul.h` promises. The port pins both flags **process-globally** after
`PL_initialise`. That is only sound *because* of G-01: there is no second KB with
a different opinion to trample. On an engine with real instances it would be
wrong.

### G-05 — operator definitions are NOT KB-scoped (an isolation gap that does not hold)
Probed directly:

```
KB A:  :- op(700, xfx, ===>).      (consulted)
KB B:  X = (p ===> q)
  Trealla -> syntax_error            (correct: B never saw the operator)
  SWI     -> {"X":{"functor":"===>","args":["p","q"]}}
```

`op/3` in SWI is global unless the file declaring it is a module file with an
export list, which a host's consulted source is not. A host running two worlds —
which is exactly what the KINP corpus's `'@world'(W)` layer is for — gets one
world's syntax silently applied to another's source. This is the one gap on this
list that is a **correctness** difference rather than a packaging or lifecycle
difference, and a migration would have to answer it before shipping.

### G-06 — `dynamic` is a prefix operator, so `dynamic/1` did not parse
`error(instantiation_error, dynamic/1)` in the bootstrap is a syntax error on
SWI: `dynamic` is `fx` 1150, so the reader tries to apply it to `/1`. Fixed
engine-neutrally as `(dynamic)/1`, which is standard and unchanged on Trealla.
Cheap, but it is the kind of thing that only a second engine finds.

### G-07 — snapshot could not ask the engine which predicates are the KB's
`'$snap_preds'/1` used to be "every visible dynamic predicate that is not
`'$'`-named". With one shared database (G-01) a KB's module also sees the
system's own dynamic predicates, so a snapshot image came back containing
`file_search_path/2`, `prolog_file_type/2` and their `system:`-qualified bodies —
and restoring that image was then refused for mentioning a reserved name.

Replaced by an **ownership ledger**: the bootstrap records `'$snap_owns'(N, A)`
at each of the three places the ABI adds a clause, and snapshots that. This asks
the question `insimul.h` actually documents ("what did the host put in?") instead
of asking the engine what it happens to call dynamic, and it is a better answer
on **both** engines. The Trealla golden image is byte-identical before and after,
and so is SWI's — see §4.

### G-08 — error DETAIL names the port's internal module
SWI reports `error(existence_error(procedure, insimul_kb_2:secret/1), …)`. The
class is right and `insimul.h` says the text is not the contract, so nothing is
broken — but `insimul_kb_2` is a name this port invented, of the same family as
the `read_term_from_atom/3` leak US-2 removed (L-10). If SWI were adopted, the
bootstrap's `'$err_norm'/3` would want to strip the module qualifier too.

### G-09 — threading is unimplemented, not merely unproven
SWI requires `PL_thread_attach_engine()` on every OS thread that calls into it.
The port does none, so a KB touched from a second thread is unsupported *by
construction* here. `insimul.h` already calls multi-threaded use UNPROVEN on the
current engine; on SWI it would be a real piece of work, not a test.

### G-10 — vendoring cost
The engine source is **committed** for Trealla because libinsimul is layer zero
and its build must not need the network (`vendor/trealla/` is 2.7 MB).
`swipl-devel` at the pin is **25 MB** of working tree — an order of magnitude
more in every clone of this repository, forever. So SWI is **located, not
vendored**, here: `scripts/build_swipl.sh` produces the prefix. That is a
legitimate shape for a spike and **not** a legitimate shape for shipping; if the
verdict is yes, vendoring (and re-resolving the license from its text, the way
`docs/TREALLA_LICENSE_FINDING.md` did) is the migration's first story.

### G-11 — build portability
See §2: the previous stable line (9.2.x) does not compile on this host.

### G-12 — one ctest does not run under the second selection
`tests/smoke.c` drives the **vendored engine's own C API** (`trealla.h`), not the
insimul ABI — it predates the ABI (US-LI1). It is engine-specific by
construction and is not built when `INSIMUL_ENGINE=swipl`. Every other gate runs
on both selections. This is named here rather than left as a silent difference in
a test count.

### G-13 — SWI's wasm library set is coupled to its PACKAGES, so the home tree ships source
Upstream's Emscripten branch adds `library/wasm.pl` and `library/dom.pl` to the
library unconditionally (`src/CMakeLists.txt`, `if(EMSCRIPTEN)`), and both
`use_module(library(uri))` — which lives in the **clib package**. With
`SWIPL_PACKAGES=OFF` (the same "smallest honest embedding" profile as the native
leg, §2) the `.qlf` compile of the whole library therefore dies:

```
ERROR: library/wasm.pl:58: source_sink `library(uri)' does not exist
ERROR: -g qlf_make: Unknown procedure: wasm:uri_is_global/1
make: *** [wasm_preload] Error 2
```

So the wasm profile sets `INSTALL_QLF=OFF INSTALL_PROLOG_SRC=ON` and the preload
image carries **Prolog source**, not compiled `.qlf`. The alternative is to build
SWI's own wasm package set (`clpqr plunit chr clib http semweb pcre` — the
"fairly comprehensive" profile the D20 brief quotes), which is a larger payload
than the one being measured, not a smaller one. Either way it is a real cost and
US-3 pays it in startup time.

### G-14 — the wasm build is NOT offline
`libinsimul` is layer zero and its own build fetches nothing (that is why Trealla
is committed under `vendor/`). SWI's core — not one of its packages — requires
**zlib**, and on Emscripten that arrives as a *port*: `embuilder build zlib`
downloads `github.com/madler/zlib` the first time. `scripts/build_swipl.sh
--target wasm` runs it explicitly and passes the resulting `libz.a`/`include` to
SWI's `find_package(ZLIB)` (which otherwise fails outright), so the dependency is
visible in the script rather than discovered by a failing CI job. A migration
would have to answer it — vendor zlib, or accept a network dependency in the
browser build.

### G-15 — a cross build ships the HOST engine's ABI stamp, and SWI warns on every start
`home/ABI` is produced by `swipl --abi-version`, and in a cross build that swipl
is the **native friend** (upstream `src/CMakeLists.txt`:
`COMMAND ${PROG_SWIPL_FOR_BOOT} --abi-version > ${SWIPL_ABI_FILE}`). The host and
the wasm engine disagree — this profile has `MULTI_THREADED` and `USE_SIGNALS`
off, so the foreign-predicate signature differs:

```
host friend   swipl-abi-2-68-dddc10dc-a5b83da7
wasm engine   swipl-abi-2-68-cda581d4-a5b83da7
```

The consequence is not cosmetic: every `PL_initialise` printed

```
WARNING: Invalid SWI-Prolog home directory /swipl: ABI mismatch
```

**on the process's stderr** — which the ABI's whole error design forbids (errors
cross as `ERR <class> <term>` records on the per-KB channel, never as process
output a host cannot attribute), and which would also land in the middle of
US-3's startup measurement. `scripts/build_swipl.sh --target wasm` therefore
overwrites `home/ABI` with the stamp the **wasm** engine reports (read by running
the cross-built `swipl.js` under node) and prints the substitution. It fixes the
file rather than muting the check, and it recurs on every pin bump.

### G-16 — the browser payload is THREE files, and the consumer has to locate them
Trealla's Prolog library is compiled into the binary, so the wasm package is
`insimul.mjs` + `insimul.wasm`. SWI's home tree cannot be (G-02), so it rides
along as an Emscripten `--preload-file` image — a third file, `insimul.data`,
which the glue fetches and mounts at `/swipl` before `main()`. Two things follow
for consumers, and neither is invisible:

- Emscripten resolves a data package **relative to the page**, not to the module,
  unless the caller passes `locateFile`. Every harness here now does
  (`tests/wasm_smoke.mjs`, `tests/wasm_conformance.mjs`,
  `scripts/wasm_payload.mjs`) — before that, the tests only passed when run with
  the build directory as the working directory.
- `@insimul/prolog-wasm`'s `files`/`exports` map, the CSP and offline-packaging
  advice in `docs/consuming.md`, and Babylon's vendored copy all enumerate the
  payload file by file. A third file is a change to each of them.

### G-17 — a wasm build needs a NATIVE build of the same pin first
`boot.prc` and the library `INDEX.pl` are compiled **by a Prolog**, so SWI's cross
build wants `SWIPL_NATIVE_FRIEND=<a native build tree>`. `scripts/build_swipl.sh
--target wasm` builds one if it is not there, which means the browser artifact
costs a host toolchain plus a host SWI build in CI. Trealla's wasm build needs no
host Prolog at all: `emcmake cmake` over the same committed sources is the whole
story.

## 4. The WASM leg (US-2)

**Result: SWI-Prolog builds for wasm behind the same twelve functions, loads, and
answers.** Both wasm ctests pass on the second engine — `wasm_smoke` (all
thirteen entry points across the JS boundary) and `wasm_conformance`
(`10 files, 76 cases, 76 passed, 0 failed, 1 amended`, the same line the default
engine prints). Nothing in `src/engine_swipl.c` had to change for the browser
target; the port that came out of US-1 cross-compiled as written.

### Reproducing it

```sh
scripts/build_swipl.sh --target wasm                 # prints <prefix>
scripts/build_wasm.sh --engine swipl --swipl-root <prefix> \
                      --build-dir build-wasm-swipl
```

The first command holds the whole recipe (the pin from §2, the wasm flag profile,
the zlib port, the native friend, the ABI stamp fix) and assembles a prefix with
a fixed layout — `lib/libswipl.a`, `include/`, `home/` — which is what
`cmake/swipl.cmake`'s `if(EMSCRIPTEN)` branch reads. It refuses a prefix whose
`INSIMUL_SWIPL_PIN` does not say `target=wasm`, so a host build cannot be linked
into a wasm module by mistake. The second command is the ordinary
`scripts/build_wasm.sh` with two new options; **the no-argument invocation is
unchanged in every respect** and still builds the default engine into
`build-wasm/`.

`cmake/wasm.cmake` names no engine. What an engine needs beyond its objects
arrives as `INSIMUL_ENGINE_WASM_LINK_OPTIONS` (here `-sUSE_ZLIB=1`) and
`INSIMUL_ENGINE_WASM_PRELOAD_DIR`/`_MOUNT` (here the home tree at `/swipl`), both
set by the engine's own cmake module. It also gained
`target_compile_definitions(... ${INSIMUL_ENGINE_DEFS})`, which the native
library targets always had and the wasm target never needed until an engine had
something to say (without it, `--home=` was empty and SWI exited with
`ERROR: Could not find SWI-Prolog home directory`).

Host: `Darwin 25.5.0 arm64`, Emscripten 6.0.5, CMake 4.4. Wall clock on this
host: ~2 min for the SWI wasm engine once the native friend exists, ~5 s to
link `libinsimul` against it.

### The payload, captured for US-3

`node scripts/wasm_payload.mjs <build-dir>` reports every payload file a page
downloads, raw and as a CDN transfers it, and stamps the table with what
`insimul_version()` says the module is — so a size can never be quoted without
the engine it belongs to. Taken on the builds above:

| engine | file | raw | gzip -9 | brotli -11 |
|---|---|---:|---:|---:|
| trealla v2.106.1 | `insimul.mjs` | 104,532 | 28,679 | 25,562 |
| | `insimul.wasm` | 2,103,621 | 566,556 | 418,998 |
| | **TOTAL** | **2,208,153** | **595,235** | **444,560** |
| swipl 10.0.1 | `insimul.mjs` | 92,899 | 24,632 | 21,670 |
| | `insimul.wasm` | 1,323,635 | 539,635 | 433,837 |
| | `insimul.data` | 2,697,756 | 722,286 | 579,829 |
| | **TOTAL** | **4,114,290** | **1,286,553** | **1,035,336** |

SWI's *binary* is smaller (1.3 MB against 2.1 MB) because its Prolog library is
**not in it** — the 2.7 MB `.data` image is that library. Comparing
`insimul.wasm` alone would therefore report the opposite of the truth, which is
why the tool refuses to print a row set it cannot fully account for. Over the
wire the honest figures are the totals: **~1,011 KB brotli against ~434 KB**,
2.3×. US-3 owns what that means.

### What "loads in the browser harness" means here, exactly

The Babylon runtime lives in a **sibling repository** and is not in this
worktree, so it was not run. What was run is the harness that guards what
Babylon vendors: `wasm/insimul-api.mjs` — the same hand-written wrapper that
repository copies — driven by `tests/wasm_smoke.mjs` and
`tests/wasm_conformance.mjs`, unmodified, against the SWI module.

The spike engine is deliberately **not** packaged: `scripts/package.sh --target
wasm` still assembles `@insimul/prolog-wasm` from the default engine only.
Publishing a package built on an engine that is neither vendored (G-10) nor
adopted would be the migration shipping itself ahead of its own decision. Doing
it later means the `.data` file entering `files`/`exports` and the pin moving out
of `vendor/trealla/VENDORED.json` — G-16 and G-10, priced.

## 5. What did NOT need a gap (recorded because it is the surprising half)

Taken on this host at the pins above; US-3 re-runs all of it as measurement.

- **The conformance corpus passes on SWI**: `10 files, 76 cases, 76 passed,
  0 failed, 1 amended` — the same line the Trealla leg prints, including the same
  single documented amendment. (US-3 owes the byte-identity comparison per case;
  this is only the pass/fail count.)
- **The snapshot image is byte-identical to the committed golden fixture**
  (`conformance/snapshots/basic.snapshot.pl`) after G-07's ledger fix — same
  clause order, same quoting, same float rendering, same `A`/`B` variable names.
  That was not expected of a different writer.
- **`abi_neutral_runtime` passes**, including the create/destroy cycle, the RFC
  8259 escaping, lossless big integers (on LibBF, with `USE_GMP=OFF`), the
  normalised cons functor — SWI's is `'[|]'`, and the bootstrap already
  normalised it — the reserved-name boundary, and the directive-failure policy.
- The three rows `insimul.h` lists as **NOT PROMISED** are exactly the three that
  differ: numeric term ordering (SWI is ISO 7.2.1 by-value; the pinned engine is
  type-first), whether arithmetic functor names are also static predicates (SWI:
  no, so the corpus's one amendment would become unnecessary), and builtin type
  strictness (`atom_length(1, _)` raises on one and succeeds on the other). The
  header predicted all three. They are now declared by the build
  (`INSIMUL_ENGINE_ROWS` in `CMakeLists.txt`) and read by `tests/neutrality.c` as
  properties, so the test still goes red if an engine changes one — without the
  test ever naming a vendor (leak L-02).

## 6. Scope note, and where the verdict is

US-1 is the native embed target, US-2 the WASM one (§4). **The numbers are
US-3's**: the sizes in §4 are the payload capture that story asked US-2 to hand
over, not a comparison — startup, resident memory, the Rust leg and the
per-case byte-identity of the corpus are not claimed here, and neither is any
verdict.

US-3 landed them in **[`docs/SWIPL_MEASUREMENT.md`](SWIPL_MEASUREMENT.md)**,
which is regenerable with `scripts/measure.sh`. Its verdict, in one line:
**no — SWI-Prolog did not meet the bar on every leg**, missing on size alone
(2.55× shipped natively, 2.33× over the wire) while beating the incumbent on
startup, on resident memory, and matching it byte for byte on all 76 conformance
cases on all three legs. The gaps this section numbers are what that verdict
weighs beside the numbers — G-05, G-09 and G-10/G-14 in particular.
