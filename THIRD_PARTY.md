# Third-party components

> **[`NOTICE`](NOTICE) is the legal artifact; this file is the engineering one.**
> `NOTICE` says who owns each component and under what terms, and reproduces the
> license texts that have to travel with every copy (Apache-2.0 §4(d)). This file
> says where each pin lives, how the vendored bytes are tied to an upstream
> commit, and how to bump one. Neither replaces the other, and the `attribution`
> ctest checks that every stanza in `NOTICE` names the same pin the build reads
> from the locations below.

This repository builds **two** libraries, and each vendors its own dependency:

| Library | Header | Vendors |
|---|---|---|
| `libinsimul` | `include/insimul.h` | Trealla Prolog (committed under `vendor/trealla/` at a pinned commit) |
| `libinsimulcore` | `corebridge/include/insimulcore.h` | QuickJS + a generated `@insimul/core` bundle (both committed) |

Everything below is permissively licensed (MIT / BSD-style / Apache-2.0) and
compatible with redistribution in the prebuilt binaries that the engine plugins
consume.

**Every pin has exactly one authoritative location, and the build reads it from
there** — so a stamp can never claim something other than what was compiled:

| Dependency | Pin lives in | Reported by |
|---|---|---|
| Trealla | `commit` in `vendor/trealla/VENDORED.json` | `insimul_version()` |
| QuickJS | `corebridge/vendor/quickjs/VERSION` | `insimul_core_version()` |
| `@insimul/core` bundle | `coreCommit` in `corebridge/vendor/core/VENDORED.json` | `insimul_core_version()` |

## Trealla Prolog

- **Repository:** https://github.com/trealla-prolog/trealla
- **Pinned commit:** `07de013677af760a8bca0594ae4b2bef158a3cde`
- **Tag at pin:** `v2.106.1`
- **License:** **MIT** (SPDX `MIT`) — Copyright (c) 2020 Andrew George Davison.
  Resolved by reading the license text at the pinned commit, not from a
  classifier: GitHub's API reports `NOASSERTION` for this repository. The
  evidence, the bundled components' licenses, and the exact `NOTICE` text to
  ship are in [`docs/TREALLA_LICENSE_FINDING.md`](docs/TREALLA_LICENSE_FINDING.md).
- **How it's vendored:** a source drop, **unmodified**, committed under
  `vendor/trealla/` — `src/`, `library/`, `util/bin2c.c`, `LICENSE` and
  `ATTRIBUTION` (upstream's `tests/`, `samples/`, `docs/`, `man/` and `Makefile`
  are omitted; this build does not use them). **The build performs no network
  fetch.** libinsimul is layer zero for four engine runtimes, the Rust server
  and every save file; a build of it must not depend on an upstream
  single-maintainer repository staying reachable or unchanged.
- **How you know it is really upstream's source:** `vendor/trealla/VENDORED.json`
  records the *git object id* of every vendored path, taken from upstream's tree
  at the pinned commit. The `trealla_vendor` ctest recomputes those ids offline
  (`git write-tree` over a throwaway index) and compares — so the bytes on disk
  are tied to a commit in `trealla-prolog/trealla`, not merely to a hash we
  invented. It also fails if the recorded pin drifts from the pin the build used,
  or if a `FetchContent` of the engine reappears. Each check is run against a
  tampered fixture too, so the gate is proven able to fail.

To bump: replace the files under `vendor/trealla/` from a fresh checkout of the
new commit, update `commit`/`tag`/`gitObjects` in `vendor/trealla/VENDORED.json`
together, re-run the build + conformance suite, re-check the license text (§8 of
the license finding), and record the change here. Because this PRD's `autoMerge`
is off, a human reviews toolchain/pin changes before merge.

### Components bundled inside Trealla

Trealla itself vendors these; they are compiled as part of `libinsimul`:

- **imath** (`src/imath/`) — arbitrary-precision integer/rational arithmetic,
  by M. J. Fromberger. MIT license.
- **isocline** (`src/isocline/`) — line editor, by Daan Leijen. MIT license.
  Used instead of system `libedit`/`readline` for portability.
- **Prolog standard library** (`library/*.pl`) — Prolog-Commons / SWI-Prolog
  derived predicates; see Trealla's `ATTRIBUTION` file. **BSD-2-Clause**
  (verified: two clauses, no "no endorsement" clause) — Mark Thom,
  Jan Wielemaker, Richard O'Keefe, University of Amsterdam / VU University
  Amsterdam / SWI-Prolog Solutions b.v. Its clause 2 requires the notice be
  reproduced in the documentation shipped with a binary, and these predicates
  are embedded in every `libinsimul` artifact — so this one is a real
  obligation on every engine plugin, not a formality.
- **mini regex** (`src/sre/`) — small regex module inspired by Rob Pike's code.
  **Unlicense** (public-domain dedication), *not* MIT.

Full license texts are committed with the source: `vendor/trealla/LICENSE`,
`vendor/trealla/ATTRIBUTION`, `vendor/trealla/src/imath/LICENSE`,
`vendor/trealla/src/isocline/LICENSE`, `vendor/trealla/src/sre/LICENSE`. Every
identifier above was read out of those files at the pinned commit — see
[`docs/TREALLA_LICENSE_FINDING.md`](docs/TREALLA_LICENSE_FINDING.md).

## QuickJS — the JS engine inside `libinsimulcore`

`corebridge/` embeds **QuickJS** so `@insimul/core`'s TypeScript can run behind a
C ABI (`corebridge/include/insimulcore.h`). See `corebridge/README.md`.

- **Upstream:** https://bellard.org/quickjs/ (Fabrice Bellard, Charlie Gordon)
- **Pinned version:** `2025-04-26`
- **Where the pin lives:** `corebridge/vendor/quickjs/VERSION`, read by
  `corebridge/CMakeLists.txt` into `CONFIG_VERSION`, which
  `insimul_core_version()` reports. That is the same discipline as Trealla's
  commit pin — one authoritative location, read by the build.
- **License:** MIT — `corebridge/vendor/quickjs/LICENSE`
- **How it's vendored:** a source drop, **unmodified**, committed under
  `corebridge/vendor/quickjs/`. Unlike Trealla it is not fetched, because a game
  developer who unzips an engine plugin into their project cannot be asked to
  init submodules or run a network fetch.
- **Only the engine core is taken.** `quickjs-libc` is deliberately excluded, so
  the embedded runtime has no filesystem, process or network access at all.

To bump: replace the files and the `VERSION` stamp **together**, rebuild, and run
`ctest --test-dir build` (`corebridge_smoke` asserts the reported pin matches the
one CMake read) plus the radiant corpus gate.

## `@insimul/core` bundle — generated, not third-party

`corebridge/vendor/core/` holds `@insimul/core` bundled to a single script and
embedded as a C array, so `libinsimulcore` is one self-contained artifact (the
same reason `libinsimul` embeds its boot Prolog). It is a **generated build
artifact**, not third-party source and not hand-written.

- **Source:** `@insimul/core` (`packages/core`), Apache-2.0 — the same
  TypeScript the web runtime executes. Zero lines of it are re-implemented here.
- **Pinned commit:** recorded as `coreCommit` in
  `corebridge/vendor/core/VENDORED.json`; the top-level `CMakeLists.txt` reads it
  out of that file and `insimul_core_version()` reports it. That string is what
  to quote in a bug report about core behaviour.
- **Generator:** `corebridge/tools/vendor-core-bundle.mjs` (esbuild).
- **How it's vendored:** committed, exactly like the conformance corpus
  (`conformance/VENDORED.md`) and for the same reason — this repo is standalone
  by design and cannot run a bundler against a package it does not contain.

### The drift guard

A vendored bundle that silently falls out of step with `packages/core` is the
same hazard the conformance corpus had, so it is checked the same way — by hash,
in a ctest that cannot rot unrun (`core_vendor`):

```sh
node corebridge/tools/vendor-core-bundle.mjs --check          # runs in ctest
node corebridge/tools/vendor-core-bundle.mjs --check --core <path-to-packages/core>
```

`--check` verifies a **sha256 per file** against `VENDORED.json`'s `files` map,
over both the generated artifacts and the adapter JS bundled into them
(`corebridge/js/*.js`) — so a hand-edited bundle, a stale C array, or a `js/`
edit that was never re-bundled each fail loudly. It cannot see core changing
*underneath* the bundle; only `--core` can, because that requires a core
checkout to re-bundle from. Set `INSIMUL_CORE_DIR` and the `core_vendor` ctest
passes it through.

To re-vendor (adopting more of core, or picking up a core change):

```sh
node corebridge/tools/vendor-core-bundle.mjs --core <path-to-packages/core>
```

then rebuild and re-run the radiant corpus gate.
