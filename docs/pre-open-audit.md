# Pre-open audit — `insimul-native`

*Status: §1 complete (history scrub audited; rewrite prepared, not executed) ·
opened 2026-08-17 · tasklist `242-pre-open-native`*

| Checklist item | State |
|---|---|
| History scrub | audited; rewrite **prepared, not executed** — §1 |
| Content audit | US-2 |
| Dependency audit | US-2 |
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

Every blob reachable from all branches, all tags and HEAD — **32 commits, 417
blobs, all 417 read as text**. No blob was skipped: nothing in this history is
binary, and nothing is over the 4 MB cap (the largest is
`corebridge/vendor/quickjs/quickjs.c` at 1.7 MB, which *is* scanned). That is a
stronger coverage statement than core could make — core had to skip a 2.1 MB
vendored wasm module — and it is worth stating precisely, because a skipped file
that goes uncounted reads as a file that was checked.

The report necessarily records its **parent** commit as `repository.head`: a file
cannot contain the id of the commit that introduces it. Re-running the scan with
the audit's own artifacts in history yields more blobs and the *same* findings
(the scan is a fixed point over itself). `history-scrub.sh` demands exact
equality before it will rewrite anything — at flip time, staleness is the whole
risk, and re-running the scan takes a second.

Unreachable objects (an amended commit's orphan, a dropped stash) are out of
scope by design: `git push` and `git clone` do not transfer them, so the
visibility flip does not publish them, and `filter-repo` expels them from the
rewritten repository regardless. `--all-objects` scans them anyway when you want
to know what is sitting in a particular local clone.

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
- **A stale report.** The script refuses to proceed if `repository.head` in the
  committed report is not the repository's current HEAD. A plan verified against a
  history that has since grown is a plan for a different repository.

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
