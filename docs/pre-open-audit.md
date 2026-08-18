# Pre-open audit — `insimul-native`

*Status: §1–§2 complete (history scrub audited and rewrite prepared, not
executed; content + dependency audits clean and gated) · opened 2026-08-17 ·
tasklist `242-pre-open-native`*

| Checklist item | State |
|---|---|
| History scrub | audited; rewrite **prepared, not executed** — §1 |
| Content audit | **clean, and gated** — §2.2 |
| Dependency audit | **clean, and gated** — §2.3 |
| LICENSE / NOTICE / CONTRIBUTING · trademark + conformance policy link | US-3 |
| `git filter-repo` rewrite | **human-gated**; prepared and proven — §1.5 |
| `gh repo edit … --visibility public` | **human-gated, out of scope for every tasklist** |

`docs/explanation/OPEN_SOURCE_STRATEGY.md` (in the superproject) names a
**pre-open checklist, mandatory before any repo goes public**, and sequences
`insimul-native` in the second wave, after `insimul-core`. This page is that
checklist, executed against this repository. It inherits the audit METHOD and the
pattern set from `241-pre-open-core` — core was the probe — rather than inventing
a second one: a second secret scanner is a second thing to keep correct, and the
half nobody re-reads is the half that reports clean.

## What is *not* here, and will not be

Two steps in the flip are irreversible, and neither is performed by any tasklist:

| Step | Why it is human-gated |
|---|---|
| `gh repo edit insimul/native --visibility public` | There is no undo. A repository that has been public for one minute has been cloned, cached and indexed; making it private again removes the link, not the copies. |
| The `git filter-repo` history rewrite | Every commit id from the first rewritten commit onward changes. Every clone, branch and PR breaks at once — and this repository is a **submodule**, pinned by the superproject and by each engine repo, so every one of those pointers dies too. There is no rebase path back. |

US-1 **prepares and proves** the rewrite; it does not run it. The two are executed
together, by a human, in one sitting — the rewrite immediately before the flip,
because a rewrite that lands while the repository is still private costs a
re-clone, and one that lands after it is public is too late to matter.

---

## §1 History scrub — **audit complete, nothing to scrub, rewrite prepared**

> - [ ] **History scrub.** `git filter-repo` each open repo to purge secrets, API
>       keys, and closed world-pack content from *history*, not just HEAD. (The
>       most common IP-leak vector when open-sourcing.)

### §1.1 Why HEAD is not the audit

`git clone` copies every commit. Deleting a secret in a later commit publishes it
exactly as thoroughly as leaving it in place — the only thing that changes is how
long a reader has to look. Every gate this repository already has —
`trealla_vendor`, `core_vendor`, `abi_neutrality`, `conformance` — reads the
working tree and can see none of that. The scan below is what reads the commits.
The `history_scan` ctest's negative control demonstrates the point directly: it
plants a key, deletes it in the next commit, and the audit still finds it.

### §1.2 The tooling, and where it came from

| Artifact | What it is |
|---|---|
| `scripts/history-scan.mjs` | The scanner. Reads every blob reachable from every ref, applies the rules, attributes findings to commits, and can prove a scrub plan works without running it. |
| `scripts/check-pack-provenance.mjs` | The structural pack-shape detector, used by the scanner over historical blobs. |
| `scripts/history-scan.rules.json` | The rules, and the **keep/scrub decisions**. Every finding's classification and its reasoning live here, signed and dated. |
| `docs/pre-open/history-scan.json` | The committed output — coverage, findings, blob ids, commit hashes. This is the artifact to read before the flip. |
| `scripts/history-scrub.replacements.txt` | `git filter-repo --replace-text` input. **No active rules** — nothing was found to purge. |
| `scripts/history-scrub.paths.txt` | `--invert-paths` input. **Empty** — nothing needs deleting outright. |
| `scripts/history-scrub.sh` | The exact invocation. Plan-only by default; execution needs two flags and a typed confirmation, and is refused outright while the plan purges nothing. |
| `tests/history_scan_selftest.mjs` · `tests/run_history_scan.sh` | Falsify all of the above — the `history_scan` ctest. |

Re-run the audit with:

```sh
node scripts/history-scan.mjs --check --verify-scrub --report docs/pre-open/history-scan.json
ctest --test-dir build -R history_scan          # the same, plus the falsification
```

**Provenance.** `check-pack-provenance.mjs` is vendored **byte for byte** from
`insimul/core@b37837b` (sha256
`baf15ca91f702ea12dc3d7cfff36b2531552757e543018cf236ebe4130e1694d`) — that file's
own header anticipates this repository doing exactly that. `history-scan.mjs` is
DERIVED from core's (sha256
`a48860d868b4ce7b0628fa2471fa4096c5897331208b3fd237ab8ee9210ed6a4`) with three
divergences, listed in its header and repeated here so a re-vendor knows what to
re-apply:

1. **`allow` entries may key on `pathPrefix`.** Core had one `.pl` in its whole
   history; this repository vendors an entire Prolog engine, 39 of whose library
   files are `.pl`. A prefix allowance keeps those blobs *visible* in the report —
   each classified, each with its commit hashes — instead of hiding them behind a
   rule `except`, which is the other way to get a green scan and tells a
   flip-time reviewer nothing.
2. **`SELF_FILES` also exempts `run_history_scan.sh`**, the gate driver.
3. Prose that counted core's blobs is marked as core's.

### §1.3 What was scanned

Every blob reachable from all branches, all tags and HEAD — **33 commits, 428
blobs, all 428 read as text**, the audit's own artifacts included. No blob was skipped: nothing in this history is
binary, and nothing is over the 4 MB cap (the largest is
`corebridge/vendor/quickjs/quickjs.c` at 1.7 MB, which *is* scanned). That is a
stronger coverage statement than core could make — core had to skip a 2.1 MB
vendored wasm module — and it is worth stating precisely, because a skipped file
that goes uncounted reads as a file that was checked.

The report necessarily records its **parent** commit as `repository.head`: a file
cannot contain the id of the commit that introduces it. The committed report is
therefore the run taken *after* the scanner, rules, plan and this page landed —
11 more blobs than the tree had before them, and the **same 61 findings**, so the
scan is a fixed point over itself. `history-scrub.sh` demands exact equality
before it will rewrite anything: at flip time staleness is the whole risk, and
re-running the scan takes a second.

That re-run is also where this audit stopped being theoretical about itself. The
first draft of `tests/history_scan_selftest.mjs` wrote two of its fixtures out
plainly — a connection string with an inline password, and a comment that spelled
out the three keys of the pack skeleton — and the scan came back with **one scrub
finding and one review finding, in the test that exists to prove the scanner
works**. Both were rewritten to assemble their fixtures at run time and the
commit was amended, so neither blob was ever pushed. The alternative — exempting
the file by name, which is what core does for its own test — was available and
declined: an exemption is permanent, a `+` is not.

Unreachable objects (an amended commit's orphan — including the two just
described — a dropped stash) are out of scope by design: `git push` and
`git clone` do not transfer them, so the visibility flip does not publish them,
and `filter-repo` expels them from the rewritten repository regardless.
`--all-objects` scans them anyway when you want to know what is sitting in a
particular local clone.

**Rule classes.** Inherited from core: cloud and vendor credentials (AWS, GitHub,
Anthropic, OpenAI, Google, Slack, Stripe, npm), inline private-key blocks, JWTs,
connection strings with inline passwords, a broad `apiKey = "…"` catch-all,
credential-shaped file paths (`.env`, `*.pem`, `id_ed25519`, `.npmrc`), the closed
`data/insimul/**` pack tree, every `.pl` source, and — structurally — every pack
document. Added here for the classes core does not have:

| Rule | Why native needs it |
|---|---|
| `world-content-tree` | A directory named `world/`, `packs/`, … in the ENGINE repository. `bench/world/` is a benchmark fixture and is classified as one; anything else that lands here needs a human. |
| `binary-artifact` | This repository builds `.wasm` modules, Emscripten `.data` preload images, static libraries and dist tarballs. A committed one is both plausible and *unreadable by the scanner* — a hole in the audit only a human can close. |
| `build-output-tree` | `build/`, `build-wasm/`, `dist/`, `node_modules/`, `target/`. Committed build output is how a binary reaches a history that reads as pure source. |

None of those three has ever fired. They are the guards that say so.

The structural pack detector is deliberately **not** a list of the closed tables'
values. A deny-list of the real numbers would have to contain the real numbers, in
the open repository, which is the leak it is meant to prevent wearing a guard's
clothes.

### §1.4 Findings — 61, all classified **keep**, zero to scrub

**No secret, API key, token, private key, closed pack, committed build output or
binary artifact has ever been committed to this repository.** Every credential
rule and every native-specific artifact rule matched nothing across all 32
commits. The 61 findings are the two content-boundary rules firing on four
things, all of which are engine or fixture:

| # | Rule | Path | Blobs | Decision |
|---|---|---|---|---|
| 1 | `prolog-seed-file` | `vendor/trealla/library/**` | 39 | **keep** |
| 2 | `prolog-seed-file` | `src/insimul_boot.pl` | 5 | **keep** |
| 3 | `prolog-seed-file` | `conformance/snapshots/basic.snapshot.pl` | 1 | **keep** |
| 4 | `prolog-seed-file` + `world-content-tree` | `bench/world/**` | 6 + 10 | **keep** |

Blob ids, commit hashes and full reasoning: `docs/pre-open/history-scan.json` and
the `allow` list in `scripts/history-scan.rules.json`.

**Finding 1 — keep.** The vendored Prolog engine's own standard library (`lists`,
`assoc`, `dcgs`, `clpz`, `format`, …), upstream Trealla's `library/` at pin
`07de0136`, BSD-2-Clause (`docs/TREALLA_LICENSE_FINDING.md` §4). This is not a
judgement about 39 files nobody read: `tests/run_trealla_vendor.sh` recomputes
git's own tree and blob ids for every vendored path, offline, so the bytes on disk
are already *proven* to be upstream's at that commit. It is engine, not authoring
content.

**Finding 2 — keep.** `src/insimul_boot.pl` is the ABI bootstrap — the Prolog that
*is* libinsimul's C layer (running goals, serialising the binding-set JSON,
classifying ISO errors, snapshotting). Every promise `include/insimul.h` makes is
implemented there. The open half of the content boundary by definition: a runtime
cannot be shown conformant against an ABI whose implementation it cannot read.

**Finding 3 — keep.** The golden snapshot image the `snapshot_parse` ctest feeds
to the wrappers' real `prolog-fact-parser.ts`. Six clauses of throwaway fixture
data; the file exists to pin the snapshot *format*, which is published ABI.

**Finding 4 — keep, and the one worth reading twice.** A directory literally named
`world/`, holding a world, in the repository whose whole job is running worlds, is
exactly what the content boundary is about — which is why the rule fires and why
the answer is written down rather than assumed. `bench/world/` is **generated in
the open** by `bench/world/generate.mjs`: a fixed LCG, no clock, and its entire
vocabulary (24 given names, 10 surnames, 10 roles, 8 factions, 10 quest titles) is
literal in the generator committed beside it. `node bench/world/generate.mjs
--check` reproduces the committed bytes from the committed source, which is the
strongest form this argument can take — nothing here was copied from a closed
pack, because all of it can be rebuilt from what is already public. It is the
fixture `docs/SWIPL_MEASUREMENT.md`'s figures are taken against.

### §1.5 The prepared rewrite — and why it refuses to run

`scripts/history-scrub.replacements.txt` has **no active rules**;
`scripts/history-scrub.paths.txt` is **empty**. There is nothing to purge, so
`scripts/history-scrub.sh` prints its finding and *refuses `--execute`*:

```
$ ./scripts/history-scrub.sh --execute --i-understand-this-invalidates-every-clone
history-scrub: --execute refused — the plan purges nothing.
```

That refusal is a decision, not an oversight. A `filter-repo` invocation with an
empty replacements file still rewrites every commit id in the repository and
removes nothing: the entire cost of a rewrite — invalidated clones, dead PRs, and
every superproject and engine-repo submodule pointer to this repository — for none
of its benefit.

Two footguns the script disarms rather than documents:

- **An empty paths file means "keep nothing".** `filter-repo` reads
  `--invert-paths --paths-from-file <empty>` as *delete every file in the
  repository across all of history*. The script counts active entries and omits
  `--invert-paths` entirely when there are none. One careless copy-paste in the
  other direction is an irreversible rewrite.
- **A stale report.** The script refuses to **rewrite** if `repository.head` in
  the committed report is not the repository's current HEAD — a plan verified
  against a history that has since grown is a plan for a different repository. In
  plan-only mode it says so loudly and continues, because the report is stale by
  one commit from the instant it is committed (it cannot contain the id of the
  commit that adds it), and printing a plan changes nothing. The audit itself is
  re-run against the *current* history at step 1 either way, so the facts on
  screen are always fresh; what the staleness check gates is the irreversible
  act.

Print the plan — this changes nothing:

```sh
./scripts/history-scrub.sh
```

**The plan machinery is proved on a real rewrite, not asserted.** With zero scrub
findings here, "the plan works" would otherwise be an untested claim precisely
when it matters least and would be trusted most. So check D of the `history_scan`
ctest builds a throwaway repository with a planted AWS key, a planted
`data/insimul/**` pack and a planted `.env`, verifies the plan in memory
(`--verify-scrub` applies the rules to the flagged blobs' real bytes and re-scans
— a finding counts as purged only if it is *gone from the rescan*), and then
**actually runs `git filter-repo`** over a mirror clone and rescans the result: 4
scrub findings, 4 purged, 0 findings after the rewrite. If `git-filter-repo` is
not installed the check says so loudly instead of passing quietly.

### §1.6 What this audit cannot see

Stated plainly, because a clean report is what a human reads before making a
repository permanently public:

- A secret that is base64'd, encrypted, split across lines, or shaped like nothing
  in the rule list.
- A closed pack whose `pack`/`packVersion`/`phases` skeleton was altered, or whose
  ids were stripped before the commit.
- Anything a `pathPrefix` allowance covers, beyond what its reason claims. The two
  in use cover `vendor/trealla/library/` (whose bytes `trealla_vendor` ties to an
  upstream commit) and `bench/world/` (whose bytes `generate.mjs --check`
  reproduces), so both are backed by a mechanical check — but the allowance itself
  is a human decision and a new file dropped into either directory inherits it.
- Files exempted by basename (`SELF_FILES`) — the scan's own rules, report and
  gate driver, each of which must contain examples of what it matches.
  `tests/history_scan_selftest.mjs` is deliberately **not** among them: it builds
  every synthetic credential by concatenation, so it is scanned like any other
  file.

This is a guard against the accident — a key pasted into a script, a fixture
copied from the closed repo, an artifact committed by mistake — not against
someone who has decided to leak. A clean report is evidence, not proof. The
scanner is falsified against a synthetic example of every rule class before it is
trusted about this repository, and the whole audit is run against a repository
that is *not* clean and required to fail it.

---

## §2 Content + dependency audit — **both clean, and now gated**

> - [ ] **Content audit.** Confirm no closed genre/language packs or generation
>       heuristics are vendored into an open repo; only contract-level base
>       predicates ship.
> - [ ] **Dependency audit.** No `insimul-backend` / `insimul-web` imports in any
>       open repo (enforce with a CI check, cf. the cross-submodule-import ban).

§1 audited the history once, because history is written once. These two are
different in kind: they are properties of the *tree*, they must hold at every
future commit, and the commit that breaks one will not be the commit that is
thinking about open-sourcing. So the deliverable is not a report — it is a gate,
and a gate that has been watched failing.

### §2.1 The gate

| Artifact | What it is |
|---|---|
| `scripts/check-open-boundary.mjs` | Both audits, in one dependency-free Node script. Derived from `insimul/core`@`b37837b`'s, with four divergences listed in its header. |
| `scripts/open-boundary.rules.json` | The rules, and the **keep/remove decisions**. Every finding's classification and its reasoning live here, signed and dated. |
| `docs/pre-open/open-boundary.json` | The committed output. Regenerate with `--report`. |
| `tests/open_boundary_selftest.mjs` | Falsifies all of it — 55 checks, a positive *and* a near miss per rule. |
| `tests/run_open_boundary.sh` | The ctest driver: falsify, audit, compare the committed report, **inject five violations into a copy of the real tree and require the gate to catch them**, check the gate is still wired. |
| `add_test(NAME open_boundary …)` | What runs it: `ctest --test-dir build`, gate 1 of the five in `CLAUDE.md`. |

It **always enforces**. `history-scan.mjs` has a `--check` flag because its main
job is to write a report a human reads; this script's only job is to be a gate,
and a gate with an opt-in enforcement flag is one forgotten argument away from a
green CI job that checks nothing.

Two audits in one script for the same reason `check-pack-provenance.mjs` is one
script rather than four: `243` (babylon) and `244` (godot) each need this check
over their own tree, and the alternative is four divergent copies of the same
judgement. The path rules here are the *same rules*, with the same ids and
patterns, as the history scan's — and the self-test fails if the two files ever
disagree about one. A rule that fires on a blob but not on the file it came from
is a gate somebody will point at and be wrong about.

**Where the enforcement point is.** This repository has no `.github/workflows`;
its CI surface is the five gates in `CLAUDE.md`, of which `ctest --test-dir
build` is the first. So the boundary gate is a ctest — the same mechanism as
`trealla_vendor`, `abi_neutrality`, `core_vendor` and `history_scan` — and any CI
that runs this repository's tests runs it. Check E of the driver fails if the
`add_test` ever disappears.

### §2.2 Content audit — clean, with the near-misses named

**No closed genre pack, language corpus, or generation heuristic is vendored in
this repository.** What that sentence rests on — 299 tracked files, 57 content
findings, all classified **keep**, zero unresolved:

| Check | Result |
|---|---|
| `data/insimul/**`, the closed pack tree | Does not exist here, and never has (§1.4). |
| `.pl` sources — the ~573 closed seed files are the risk | **47**, in four groups, each classified below. |
| A world/pack directory in the ENGINE repo | One: `bench/world/`, the committed benchmark fixture. |
| Pack documents, by structure | **0** in the whole tree. |
| Signed pack archives (`.pack`), committed binaries, committed build output | None. |

**The 47 `.pl`, by group.** The engine's own vendored standard library is 39 of
them (`vendor/trealla/library/`, upstream at the pinned commit, whose bytes
`trealla_vendor` ties to an upstream git object id — so this is one judgement
about a pinned directory, not 47 judgements nobody made). `src/insimul_boot.pl`
is the ABI bootstrap: the Prolog that *is* libinsimul's C layer, and the open
half of the content boundary by definition, since a runtime cannot be shown
conformant against an ABI whose implementation it cannot read.
`conformance/snapshots/basic.snapshot.pl` is six clauses of `parent/2` fixture
pinning the snapshot *format*. The remaining six are `bench/world/`.

A **new** `.pl` fails this gate until somebody writes down which side of the line
it is on. That is the rule doing its job: the closed asset and the open asset
have the same file extension, so the extension cannot decide.

**Four near-misses, judged and recorded** — an audit that reports "clean" without
naming what it looked hard at is not worth reading:

- **`bench/world/` — a whole committed world, in the engine repo.** This is the
  one thing here that *looks* exactly like the closed asset: 1,630 clauses of
  entities, places, items and quests. It is not authoring content and, crucially,
  the argument does not rest on anybody's word: `bench/world/generate.mjs`
  produces every byte from a fixed LCG with no clock, and `generate.mjs --check`
  re-derives and compares them before `measure.sh` times anything. A curated world
  and a generated one are indistinguishable by inspection; they are trivially
  distinguishable by re-running the generator. Both rules that can see it —
  `prolog-seed-file` and `world-content-tree` — are kept and both fire on purpose.
- **`conformance/prolog/` and `conformance/radiant/` — vendored corpora.** 10 + 5
  JSON files mirrored from `@insimul/core`, which is the source of truth. These
  are exactly what `OPEN_SOURCE_STRATEGY.md` puts on the open side: the corpus is
  the *contract*, and a runtime cannot be shown conformant against a suite it
  cannot read. They carry the KINP identity layer — CURIEs, world scoping,
  confidence terms — which is schema, not content: no genre bundle, no language
  corpus, no generation table. Their provenance is recorded in
  `conformance/VENDORED.md` with digests.
- **`corebridge/vendor/core/insimul-core-bundle.js` — core's TypeScript, bundled
  in.** The one place another repository's *content* crosses into this one. It
  bundles five core modules, and the only content-shaped member is
  `src/radiant/base-templates.ts` — the TS counterpart of the single `.pl` core's
  own audit classified **keep** (241 §2.2): contract-level radiant templates,
  genre-neutral by construction because they use only predicates the predicate
  schema guarantees for every world. Same file, same decision, one repository
  down. The bundle is generated, not hand-edited, and `core_vendor` verifies a
  sha256 per file including the adapter inputs.
- **`scripts/build_swipl.sh` and `cmake/swipl.cmake` — the located engine.** The
  SWI spike reaches *outside* the repository twice: the script clones upstream
  SWI-Prolog, and the cmake module reads an absolute prefix out of the
  environment. Neither is content and neither is in the default build (the
  engine that ships is the vendored Trealla, and D20 answered the spike NO), but
  the shape is worth naming rather than hiding: a spike helper is exactly how an
  external build input becomes load-bearing later. `build_time-fetch` names the
  clone in the report; §2.3 states what it does and does not reach.

The detector is deliberately **structural**, not a value deny-list. A deny-list of
the closed tables' real numbers would have to contain the real numbers, in the
open repository — the leak it is meant to prevent, wearing a guard's clothes. The
same argument `check-pack-provenance.mjs` makes at length, and the reason this
gate reuses that file's detector rather than growing a second one.

### §2.3 Dependency audit — clean, and closed across four surfaces

**Nothing from `insimul-backend` or `insimul-web` is imported, and nothing is
reachable.** Before this story, the strings `insimul-backend`, `insimul-web`,
`@shared/`, `insimul/platform` and `insimul/pipelines` appeared **nowhere** in the
tracked tree — not in a comment, not in a doc. They appear now only in the
audit's own files: the rules file, this page, and the comment above the ctest.

Core closes its graph with "every bare specifier is a Node builtin or a declared
dependency". This is a CMake/C tree, so that is one surface out of four, and
"or **reachable**" needs all four to be closed:

| Surface | Coverage | Rule that closes it | Findings |
|---|---|---|---|
| JavaScript | 68 specifiers across 16 files | `undeclared-dependency` — and the declared set is **empty** (there is no `package.json`; the wasm one is generated with no dependencies on purpose), so *every* bare specifier is a finding | 7 |
| Rust | 3 dependencies across 3 manifests | `undeclared-crate` — every registry crate must be named and reasoned about in the rules; cargo refuses a `use` of anything else, so the manifests **are** the graph | 0 unclassified |
| C | 724 `#include`s across 133 files | `escaping-c-include` / `absolute-path-import` — nothing may resolve outside the repository | 0 |
| The build | 19 CMake and shell files | `build-time-fetch` — a dependency the build *downloads* is a dependency no import graph can see | 9, all in shell |

That is what makes "or reachable" a claim rather than a hope: every JS import in
this tree resolves to a Node builtin or inside the tree, every Rust dependency is
an in-tree path dependency or one of two crates a human has read, every
`#include` lands inside the repository, and **the default build fetches
nothing** — so the bytes compiled are the bytes committed. Nothing else is on the
path, so nothing else can be reached transitively.

**Seven findings on the JS surface, two files, all allowed with reasons.**
`corebridge/js/entry.js` imports `@insimul/core/radiant/radiant-engine`,
`@insimul/core/radiant/base-templates` and
`@insimul/core-scripts/quest-golden-manifest`. These are **bundle inputs, not
runtime imports**: esbuild resolves them when `vendor-core-bundle.mjs` re-vendors
the bundle, against a sibling core checkout, and the artifact that actually ships
carries **zero** bare specifiers — a closed graph, which this same scan verifies
by reading it like any other file. `@insimul/core` is an *open* repo, so the edge
is open→open even at vendor time, and it is the direction the architecture
already runs. The allowances are scoped per **specifier**, not per file: a
path-only allowance would silently bless every future bare import added to the
one file in this tree where adding one is easy.

The other four are the gate auditing **itself**, and they are the evidence that
its fixtures are safe. `tests/open_boundary_selftest.mjs` takes no basename
exemption, so it is walked like every other file — and what the scanner reads
there is the literal text `${CLOSED_BACKEND}`, a template placeholder, because
every forbidden specifier is assembled by concatenation at run time and appears
nowhere in the file's bytes. That is why those four come back as
`undeclared-dependency` and not as `closed-repo-import`: if the fixtures had
contained the real strings, the rule in the report would be the other one, and
the report would say so in the open. A placeholder resolves to nothing, and the
test never runs its fixtures as code.

**Nine findings on the build surface, five files, zero in the default build.**
`CMakeLists.txt` and every module under `cmake/` fetch nothing — which is the
property `trealla_vendor` already enforces for the engine and this rule now
enforces for everything else. The eight hits are shell: `scripts/build_swipl.sh`
(the opt-in SWI clone, §2.2), `scripts/history-scrub.sh` (two clones of *this*
repository, the prepared rewrite from §1.5), `tests/run_history_scan.sh` (two
clones of a throwaway repo in `mktemp -d`), and `tests/run_trealla_vendor.sh`
(three, and they are the rule's ally rather than its violator — that file is the
gate that fails the build if the engine is ever fetched instead of vendored, and
the hits are its own machinery plus the deliberately broken fixture that proves
the check can fail). The ninth is `tests/run_open_boundary.sh`, which injects a
`FetchContent` into a throwaway copy of the tree to prove *this* rule can fail;
same argument.

**Two Rust crates, read and classified.** `serde` (traits only — `term.rs` writes
its visitor by hand so the binding-set map keeps the ABI's variable order) and
`serde_json`. Both dual MIT/Apache-2.0, pure Rust, no build-time network, no
transitive path toward any closed repo. `insimul-sys` is an in-tree path
dependency and resolves as one.

**A rule that was wrong, and got fixed rather than allowed.** The C rule first
asked "does this `#include` contain `..`" and reported seven findings — every one
of them upstream isocline writing `#include "../include/isocline.h"` from `src/`,
a walk that stays comfortably inside the vendored engine. The right question is
"does it escape the *repository*", and the rule now resolves the path and asks
that. Writing seven allowances instead would have papered over a wrong rule with
seven holes; a rule that fires on correct code is a rule that gets muted.

### §2.4 The gate is proven to fail

US-2's acceptance criterion asks for the gate to be watched failing, and it is
worded that way for a reason this project has already paid for: a check that
cannot fail is indistinguishable from a check that passes, and it is *more*
dangerous than no check, because somebody points at it when asked whether the
boundary holds.

**In the self-test, every run.** `tests/open_boundary_selftest.mjs` builds a
throwaway tree per rule and asserts the rule fires *and* that its near miss does
not: each of the six content rules, the pack detector (product id, and the
find-and-replaced pack with no literal id), every closed-repo and back-edge
specifier family (static, `require()`, dynamic `import()`), an escaping relative
path, a root-absolute path, an undeclared package, an undeclared crate, a git
dependency, an escaping path dependency, an escaping `#include`, an absolute
`#include`, a CMake fetch and a shell download. Three checks run the **real CLI
as a subprocess** and assert the *exit status*, because a checker that finds
violations and exits 0 is the same failure in better clothes. The fixture table
is checked for completeness against the rules file, so adding a rule without a
fixture fails the test rather than shipping an unexercised pattern.

**On a copy of the real tree, every run.** Check D of the ctest driver copies the
tracked tree with `git archive`, commits it, and injects five violations at once
— a closed pack at `data/insimul/genres/colonial.pl`, an `@insimul/backend`
import into `wasm/insimul-api.mjs`, `#include "../../platform/server.h"` into
`src/insimul.c`, a `git =` dependency into `rust/insimul/Cargo.toml`, and a
`FetchContent_Declare` into `cmake/wasm.cmake`:

```
$ node scripts/check-open-boundary.mjs <copy>
check-open-boundary: 6 unresolved finding(s) …
  closed-pack-tree: data/insimul/genres/colonial.pl
  prolog-seed-file: data/insimul/genres/colonial.pl
  build-time-fetch: cmake/wasm.cmake:159
  git-dependency: rust/insimul/Cargo.toml:17 — "harness"
  escaping-c-include: src/insimul.c:542 — "../../platform/server.h"
  closed-repo-import: wasm/insimul-api.mjs:289 — "@insimul/backend/pipelines/generate"
$ echo $?
1
```

The injection is then reverted and the same tree must pass again, exit 0 — a gate
that stays red once it has been red carries no information either. Both halves
run on every `ctest`, so "inject a violation, watch it fail, remove it" is
executed continuously rather than written down once.

**The rehearsal earned its keep three times**, which is the argument for doing it
at all:

- The C rule was wrong (§2.3), and the seven false positives are what said so.
- The `closed-pack-document` detector fired on `check-pack-provenance.mjs`
  itself, whose header quotes a pack skeleton to explain what it matches. That
  file is **vendored byte-for-byte** from core and cannot be edited here, and it
  is already on the detector's own `PROVENANCE_SELF_FILES` list — the fix was to
  honour that list when reaching for `inspectPackText` directly instead of
  through the walker that applies it. Same shape as the fixture US-1 caught in
  its own test file.
- The first "the CLI exits 0 on a clean tree" check failed, because a synthetic
  tree matches none of the real rules file's twelve allowances and *every stale
  allowance is a failure*. That is the stale-allowance rule working; the test was
  wrong and now runs with an empty `allow`.

### §2.5 What this audit cannot see

- A closed pack whose declaring skeleton was altered, or whose ids were stripped
  before the commit.
- A curated table pasted into a `.pl` or `.c` file as plain constants under an
  innocent name. No structural detector can tell tuned numbers from computed
  ones; §2.2's near-miss review is a human reading, and it does not scale to
  every future commit. This is the audit's weakest joint and it is worth
  restating at the flip.
- What a **pathPrefix allowance** covers beyond what its reason claims. The two
  in use (`vendor/trealla/library/`, `bench/world/`) are each backed by a
  mechanical check that reproduces their bytes — but a new file dropped into
  either directory inherits the allowance.
- A dependency reached through a specifier built at runtime, or a `dlopen`.
- An **untracked** file: the walk is `git ls-files`, because what a clone
  publishes is the tracked set. That is the right answer for a gate and the
  wrong one for a human about to run `git add -A`.
- Anything inside a binary. This tree commits none — `binary-artifact` is the
  rule that says so — but the wasm and dist artifacts it *builds* are not read
  by anything here.
- Whether `@insimul/core`'s own tree is clean. That is 241's audit, and this
  repository vendors a bundle of it; the two audits are separate on purpose and
  `core_vendor` is what ties the bytes here to a commit there.

### §2.6 This repository's own gates

All five of `CLAUDE.md`'s gates, run from the repo root on 2026-08-17:

| Gate | Result |
|---|---|
| `cmake -B build && cmake --build build && ctest --test-dir build` | **green — 15/15**, including the new `open_boundary` (3.34 s; `history_scan` 9.57 s) |
| `scripts/build_wasm.sh` | **green — 2/2** (`wasm_smoke`, `wasm_conformance`) |
| `scripts/conformance_parity.sh` | **green — 76/76 byte-identical across native, wasm and rust** |
| `scripts/package.sh` and `scripts/package.sh --target wasm` | **green**, both packages assembled and smoke-tested |
| `cargo test --manifest-path rust/Cargo.toml` | **green — 31 passed, 0 failed** |

`snapshot_parse` and `core_vendor` finish in ~0.0 s in this checkout: they are
the two gates that degrade to a loud `[SKIP]` without node or the sibling
`../insimul-runtime` submodule, and this is a standalone worktree.
`open_boundary` is not one of those — it asserted 55 self-test checks, the real
tree, and a live injection into a copy of it.
