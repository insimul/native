# Third-party components

`libinsimul` vendors the following. Everything below is permissively licensed
(MIT / BSD-style) and compatible with redistribution in the prebuilt binaries
that the engine plugins consume.

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
