# Third-party components

This repository builds **two** libraries, and each vendors its own dependency:

| Library | Header | Vendors |
|---|---|---|
| `libinsimul` | `include/insimul.h` | Trealla Prolog (fetched at a pinned commit) |
| `libinsimulcore` | `corebridge/include/insimulcore.h` | QuickJS + a generated `@insimul/core` bundle (both committed) |

Everything below is permissively licensed (MIT / BSD-style / Apache-2.0) and
compatible with redistribution in the prebuilt binaries that the engine plugins
consume.

**Every pin has exactly one authoritative location, and the build reads it from
there** — so a stamp can never claim something other than what was compiled:

| Dependency | Pin lives in | Reported by |
|---|---|---|
| Trealla | `TREALLA_GIT_COMMIT` in `CMakeLists.txt` | `insimul_version()` |
| QuickJS | `corebridge/vendor/quickjs/VERSION` | `insimul_core_version()` |
| `@insimul/core` bundle | `coreCommit` in `corebridge/vendor/core/VENDORED.json` | `insimul_core_version()` |

## Trealla Prolog

- **Repository:** https://github.com/trealla-prolog/trealla
- **Pinned commit:** `07de013677af760a8bca0594ae4b2bef158a3cde`
- **Tag at pin:** `v2.106.1`
- **License:** MIT — Copyright (c) 2020 Andrew George Davison
- **How it's vendored:** CMake `FetchContent` clones the repository at the pinned
  commit at configure time (see `CMakeLists.txt`). It is **not** committed into
  this tree; the commit SHA is the single source of truth for the pin.

To bump: change `TREALLA_GIT_COMMIT` (and `TREALLA_GIT_TAG` for documentation) in
`CMakeLists.txt`, re-run the build + conformance suite, and record the change
here. Because this PRD's `autoMerge` is off, a human reviews toolchain/pin
changes before merge.

### Components bundled inside Trealla

Trealla itself vendors these; they are compiled as part of `libinsimul`:

- **imath** (`src/imath/`) — arbitrary-precision integer/rational arithmetic,
  by M. J. Fromberger. MIT license.
- **isocline** (`src/isocline/`) — line editor, by Daan Leijen. MIT license.
  Used instead of system `libedit`/`readline` for portability.
- **Prolog standard library** (`library/*.pl`) — Prolog-Commons / SWI-Prolog
  derived predicates; see Trealla's `ATTRIBUTION` file. Redistributed with
  attribution (BSD-2-Clause style terms per the original authors: Mark Thom,
  Jan Wielemaker, Richard O'Keefe, University of Amsterdam).
- **mini regex** (`src/sre/`) — small regex module inspired by Rob Pike's code.

Full license texts live in the fetched Trealla source tree (`LICENSE`,
`ATTRIBUTION`) under `build/_deps/trealla-src/` after configuring.

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
