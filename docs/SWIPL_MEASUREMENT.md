# SWI-Prolog vs Trealla, measured — the D20 spike's answer

Tasklist `chief/250`, **US-3**. Phase 1 of decision **D20** asked one question:
if the engine at layer zero had to be replaced, is SWI-Prolog affordable? Two
engines were built behind the same twelve-function C ABI (US-1, US-2) so the
comparison could be **engine against engine at a fixed interface**. This
document is the measurement and the verdict.

> Everything below the verdict is regenerable:
> **`scripts/measure.sh`** builds all four trees, runs every leg, and rewrites
> the tables in this file from `bench/results/measurements.json`. The prose was
> written against the run recorded there; if a re-run moves a figure materially,
> the prose is wrong and must be revised with it.

---

## VERDICT

**NO — SWI-Prolog did not meet the bar on every leg. Trealla stays, and
`chief/252` stays parked.**

It missed on exactly one axis — **size** — and beat the incumbent on the other
three. That is a genuinely different result from the one the 2026 evaluation
predicted, and it is worth stating precisely, because the next reader's decision
turns on the difference:

| axis | result | met the bar? |
|---|---|---|
| conformance | 76/76 **byte-identical** to the shipping engine on native, Rust and wasm — and byte-identical across SWI's own three legs | **yes** |
| startup | cold engine + consult of the measured world: **5.5× faster** native (15.6 ms vs 85.9 ms), **2.4× faster** wasm (54.2 ms vs 131.1 ms) | **yes** |
| memory | holding the world's KB: **0.66×** native (11.7 MB vs 17.8 MB), **0.59×** on the Rust leg; wasm is a wash (0.95×) | **yes** |
| size | **2.55×** shipped natively (6.57 MB vs 2.58 MB) and **2.33×** over the wire in a browser (1,035 KB vs 444 KB brotli), across **three** payload files instead of two | **no** |

Two things that are not numbers weigh on the same side as size, and a reader
should not have to dig them out of `docs/SWIPL_SPIKE.md` to find them:

- **G-14 — the wasm build is not offline.** `libinsimul` is layer zero and its
  build fetches nothing; that is why the current engine is committed under
  `vendor/`. SWI's *core* needs zlib, which on Emscripten arrives as a
  downloaded port, and SWI itself is 25 MB of working tree at the pin (G-10), so
  "vendor it" is not a free answer either.
- **G-05 — `op/3` is not KB-scoped.** One world's operator definitions reach
  another world's source. This is the one gap on the list that is a
  **correctness** difference rather than packaging, and the KINP world layer is
  exactly the feature it damages.

**What this verdict does NOT say.** It does not say SWI-Prolog is heavyweight to
*run* — measured, it is the lighter and faster of the two on this host, which
the 2026 evaluation did not anticipate. It does not say the risk that motivated
D20 went away: the incumbent is still a single-maintainer project at layer zero.
It says the trade is now **priced**, and the price is paid in bytes shipped and
in three engineering items nobody has costed. If the payload owner accepts
+590 KB brotli in the browser and +4.0 MB per native platform, and G-05, G-09
(threading) and G-10/G-14 (vendoring, offline build) are answered, the
performance evidence here is a reason to revisit — not a reason to proceed now.

---

## The bar, stated before the tables

The bar is not invented here. Three of its four lines pre-date the measurement:

1. **The corpus, byte for byte.** The unification program earned "76/76
   byte-identical across native, Rust and wasm" and a migration must not lose
   it. `scripts/conformance_parity.sh` already holds it for the shipping engine;
   this measurement extends it to a second engine and adds the stronger
   comparison — **engine against engine, per case, on the raw ABI strings**.
2. **Size.** `docs/PLATFORM_SPLIT_AND_ENGINE_PLUGINS.md` §3.1 (in the **parent
   repo**, like `docs/PROLOG_ENGINE_DECISION.md` — this repository holds neither)
   picked the current engine while recording that SWI is "most complete, but heavyweight to embed
   and redistribute per-platform". The spike's job was to find out whether that
   is still true. It is — see below for by how much.
3. **Startup and memory.** No threshold was ever registered, so the bar is the
   honest one: *not worse than what ships today*.
4. **The gaps must be answerable.** `docs/SWIPL_SPIKE.md` §3 numbers seventeen
   of them (G-01…G-17). A migration would have to answer G-05, G-09 and
   G-10/G-14 before shipping; the rest are lifecycle or packaging costs.

## How these numbers were taken

<!-- BEGIN GENERATED: provenance -->

| | value |
|---|---|
| host | `Darwin 25.5.0 arm64` |
| compiler | Apple clang version 17.0.0 (clang-1700.6.3.2) |
| cmake / node / cargo | 4.4.0 / v22.22.2 / 1.97.0 (c980f4866 2026-06-30) |
| emscripten | emcc (Emscripten gcc/clang-like replacement + linker emulating GNU ld) 6.0.5 (1db513782be24469589d7cb8a1f1834e9a33f271) |
| samples per figure | 9 cold processes; median (min) published |
| load average when taken | 3.92 on 14 CPUs (a busy host inflates the slower engine most) |
| world | alderforest (KINP shapes; see bench/world/README.md) — 6 files, 1,630 clauses, 143,807 bytes |
| goals | `bench/world/QUERIES.txt`, every goal exhausted — 720 solutions on every leg of both engines |
| engine `trealla` | v2.106.1 (07de013677af760a8bca0594ae4b2bef158a3cde) |
| engine `swipl` | 10.0.1 (e58621a91ab7dd530e1e8185ed518f63d851c414) |

<!-- END GENERATED: provenance -->

**Method, per figure.** Every sample is a **fresh process**: both engines bring
their runtime up once per process, so a second `insimul_kb_create()` in the same
process would measure a warm engine and flatter whichever engine has the larger
cold cost. Inputs are read before any clock starts, so the file system is not in
the timing. The harnesses are one per leg and shared by both engines —
`tests/bench.c`, `rust/insimul/examples/bench.rs`, `scripts/wasm_bench.mjs` —
and each is a pure consumer of `include/insimul.h`, which is what makes a
difference in the output a difference in the *engine*.

Resident memory is the whole process's, because for an embedded engine that is
the honest unit: the current engine's Prolog library is in `.text` and the
spike's engine reads its home tree from disk at boot, and a host pays for both.
Native uses `mach_task_basic_info` (darwin) / `/proc/self/statm` (linux) at each
phase boundary plus `getrusage(RUSAGE_SELF).ru_maxrss` for the peak; the Rust
leg uses the system timer for the same `ru_maxrss` quantity (the `insimul`
crates are deliberately dependency-free, so there is no in-process reader);
the wasm leg uses node's RSS, **not** the module's linear memory — the build
links `-sINITIAL_MEMORY=67108864 -sALLOW_MEMORY_GROWTH=1`, so both engines
reserve 64 MiB up front and `HEAPU8.length` would read the same for either.

**The cross-check that makes the comparison legitimate:** every leg of every
engine reports the **same solution total** for the same goals, and every record
carries its own `insimul_version()` stamp, which the reporter matches against the
tree it was supposed to measure. A mismatch on either is a hard error, not a
footnote — measuring the wrong build tree is the easiest mistake here to make
and the hardest to see in a finished table.

## Size — what a host ships

<!-- BEGIN GENERATED: size -->

| leg | what a host ships | trealla | swipl | ratio |
|---|---|---:|---:|---:|
| native | `libinsimul.a` (static) | 3,328,576 | 40,912 | 0.01x |
| native | `libinsimul.dylib` (shared) | 2,579,536 | 86,272 | 0.03x |
| native | engine runtime shipped beside it | 0 | 6,484,509 | n/a |
| native | **TOTAL shipped (shared form)** | 2,579,536 | 6,570,781 | 2.55x |
| rust | `libinsimul.a` linked into the binary | 3,328,576 | 40,912 | 0.01x |
| rust | the linked release binary (`examples/bench`) | 3,036,960 | 534,256 | 0.18x |
| rust | engine runtime the binary needs at run time | 0 | 6,484,509 | n/a |
| rust | **TOTAL shipped (binary + runtime)** | 3,036,960 | 7,018,765 | 2.31x |
| wasm | payload, raw | 2,208,153 | 4,114,290 | 1.86x |
| wasm | payload, gzip -9 | 595,234 | 1,286,551 | 2.16x |
| wasm | **payload, brotli -11 (over the wire)** | 444,416 | 1,034,852 | 2.33x |
| wasm | payload files a page fetches | 2 | 3 | 1.50x |

<!-- END GENERATED: size -->

Read the **TOTAL** rows, never the library row alone. `libinsimul` is 40 KB
against 3.3 MB with the spike's engine — and that inversion is meaningless,
because the missing 3 MB is a Prolog library that one engine compiles in and the
other reads from a 6.5 MB home tree at run time (**G-02**). The same trap is why
`scripts/wasm_payload.mjs` refuses to print a partial payload: SWI's `.wasm` is
*smaller* (1.3 MB vs 2.1 MB) and its total is 1.9× larger.

What the size rows cost in practice:

- **Browser** — +590 KB brotli on every cold load, and a **third** payload file
  (`insimul.data`), which every consumer's `files`/`exports` map, CSP advice and
  offline-packaging story has to enumerate (**G-16**).
- **Native** — +4.0 MB per platform, per plugin, forever, and the artifact stops
  being one file: four game-engine plugins would each have to locate and ship a
  home tree (**G-02**), which is precisely the "heavyweight to redistribute
  per-platform" the 2026 evaluation named.

## Startup — cold engine + consult of the world (ms)

<!-- BEGIN GENERATED: startup -->

| leg | phase | trealla median (min) | swipl median (min) | ratio |
|---|---|---:|---:|---:|
| native | create | 55.6 (54.6) | 7.1 (6.9) | 0.13x |
| native | consult | 30.3 (29.3) | 8.5 (8.4) | 0.28x |
| native | query | 21.2 (20.6) | 9.7 (9.6) | 0.46x |
| native | **cold start + consult** | **85.9** | **15.6** | 0.18x |
| rust | create | 54.9 (54.2) | 6.7 (6.5) | 0.12x |
| rust | consult | 29.8 (29.0) | 8.2 (8.0) | 0.28x |
| rust | query | 20.8 (20.7) | 9.4 (9.2) | 0.45x |
| rust | **cold start + consult** | **84.8** | **14.9** | 0.18x |
| wasm | instantiate | 7.9 (7.6) | 10.7 (10.4) | 1.35x |
| wasm | create | 85.9 (83.1) | 36.5 (36.2) | 0.43x |
| wasm | consult | 45.2 (43.4) | 17.7 (17.3) | 0.39x |
| wasm | query | 27.8 (27.3) | 15.2 (14.8) | 0.55x |
| wasm | **cold start + consult** | **131.1** | **54.2** | 0.41x |

<!-- END GENERATED: startup -->

This is the axis that did not come out as expected. On the native and Rust legs
the spike's engine reaches a loaded world in about a fifth of the time; on wasm,
where it also has to mount and read a preload image, it still wins by better
than 2×. Its `create` includes `PL_initialise` plus `boot.prc` plus its library
index; the incumbent's includes standing up its own instance **and** the
internal keepalive instance the ABI holds (see CLAUDE.md, "create/destroy CYCLE
hangs") — which is a real cost of the shipping library, not a handicap invented
here.

`instantiate` exists only on the wasm leg and is the one wasm phase the spike's
engine loses: compiling a smaller `.wasm` but also mounting a 2.7 MB `.data`
image costs it ~4 ms more. It is dwarfed by what it wins back on `create`.

**On noise.** On a quiet host the samples are tight: under 15% spread across
every phase of every leg, against columns that differ by 2×–5×. Two things do
show up in the raw samples and are worth knowing before re-running:

- The **first process of a run is slower** than the eight after it (the spike
  engine's first `create` is ~12 ms against a ~7 ms median — its shared library
  and home tree are being read off disk for the first time). The median absorbs
  it; a `--repeat 1` run would not.
- A **loaded host inflates the slower engine most**, because it has more phases
  to be descheduled in. A run taken at load 18 on this 14-CPU host reported the
  incumbent's wasm `create` at 244 ms rather than 86 ms and moved no SWI figure
  materially — i.e. noise flatters the *conclusion* here rather than
  contradicting it, which is precisely why the load average is in the
  provenance table and `scripts/measure.sh` warns when it is high.

## Memory — resident while holding the world

<!-- BEGIN GENERATED: memory -->

| leg | resident set | trealla | swipl | ratio |
|---|---|---:|---:|---:|
| native | before the engine is up | 1.59 MB | 5.91 MB | 3.71x |
| native | engine up, empty KB | 8.67 MB | 11.08 MB | 1.28x |
| native | **holding the world (RSS)** | 17.78 MB | 11.73 MB | 0.66x |
| native | peak (getrusage ru_maxrss) | 18.17 MB | 12.08 MB | 0.66x |
| rust | **peak holding the world (system timer)** | 21.55 MB | 12.67 MB | 0.59x |
| wasm | node before the module is loaded | 36.84 MB | 36.80 MB | 1.00x |
| wasm | module instantiated, no KB | 47.28 MB | 52.52 MB | 1.11x |
| wasm | **holding the world (node RSS)** | 99.48 MB | 94.42 MB | 0.95x |

<!-- END GENERATED: memory -->

Natively the spike's engine holds the same 1,630-clause world in **two thirds**
the resident set, and its process starts *higher* (its shared library is mapped
before `main`) and grows *less*. These are the steadiest figures in this
document — on a quiet host both engines' samples land within 1.5% of their
median, so unlike the timings they can be quoted to three digits. On wasm the
two are within 5% — at that point
both are dominated by the 64 MiB linear memory the module reserves and by node
itself, so the wasm row is best read as "neither engine is the reason a tab is
big".

Note what these rows do **not** cover: **G-03** — a KB's namespace cannot be
destroyed on the spike's engine, so a host that creates and destroys many KBs
(a save/load loop) accumulates module records. This measurement holds one world
in one KB and would not see it. A migration owes that measurement separately.

## The conformance corpus, compared byte for byte

<!-- BEGIN GENERATED: corpus -->

| comparison | cases | byte-identical | divergent |
|---|---:|---:|---:|
| native: trealla vs swipl | 76 | 76 | 0 |
| rust: trealla vs swipl | 76 | 76 | 0 |
| wasm: trealla vs swipl | 76 | 76 | 0 |
| trealla: native vs rust | 76 | 76 | 0 |
| trealla: native vs wasm | 76 | 76 | 0 |
| swipl: native vs rust | 76 | 76 | 0 |
| swipl: native vs wasm | 76 | 76 | 0 |

<!-- END GENERATED: corpus -->

<!-- BEGIN GENERATED: corpusDetail -->

- **native: all 76 cases byte-identical.**
- **rust: all 76 cases byte-identical.**
- **wasm: all 76 cases byte-identical.**

<!-- END GENERATED: corpusDetail -->

Both comparisons matter and they are different claims:

- **engine vs engine, per leg** — does the second engine answer what ships
  today, byte for byte, on the raw strings `insimul_query_next()` returns? Not
  "does it satisfy `expected`" (two engines can both satisfy a case and still
  disagree on solution order, on error wording, or on how a float prints).
- **leg vs leg, per engine** — does the second engine hold the cross-leg bar the
  program earned, native vs Rust vs wasm?

Both hold, on every case. That is the strongest single result in this document,
and it is a result about **US-2's ABI work**, not about either engine: the
bootstrap pins the flags, classifies the errors, normalises the cons functor and
writes the binding-set JSON, so two engines with genuinely different internals
produce the same bytes. The three behaviours `insimul.h` lists as NOT PROMISED
(numeric term ordering, whether arithmetic functor names are also static
predicates, builtin type strictness) are exactly the three that still differ —
the corpus does not exercise them, and `tests/neutrality.c` asserts them per
engine from `INSIMUL_ENGINE_ROWS`.

## Re-running this

```sh
# once: build the spike's engine (it is located, not vendored — G-10)
scripts/build_swipl.sh                       # prints <native-prefix>
scripts/build_swipl.sh --target wasm         # prints <wasm-prefix>

# the measurement: 4 build trees, 3 legs x 2 engines, 6 corpus runs, this file
scripts/measure.sh
scripts/measure.sh --repeat 9                # more samples
scripts/measure.sh --no-doc                  # print the tables, touch nothing
```

`scripts/measure.sh` verifies the measured world against its manifest before it
times anything, refuses to publish a figure it has no sample for, and hard-fails
if a leg's records disagree with the engine they claim to be measuring. Raw
per-sample figures — including every individual timing, so a median can be
re-derived or disputed — land in `bench/results/measurements.json`.

## Where the rest of the evidence is

- `docs/SWIPL_SPIKE.md` — how both engines are built and wired, and the
  seventeen named gaps (G-01…G-17) this verdict cites.
- `bench/world/README.md` — the measured world, its scale, and how to regenerate
  it.
- `conformance/WASM_PARITY.md` — the cross-leg parity claim for the shipping
  engine, which `scripts/conformance_parity.sh` gates on every change.
