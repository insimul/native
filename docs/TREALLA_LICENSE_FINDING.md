# Trealla Prolog — license finding

**Status:** resolved. **SPDX identifier: `MIT`.**
**Resolved on:** 2026-08-12, against the pinned commit
`07de013677af760a8bca0594ae4b2bef158a3cde` (tag `v2.106.1`).
**Method:** read the license text in the pinned source and compare it
mechanically to the SPDX reference text. Not by asking a classifier — the whole
reason this document exists is that the classifier abstains.

This is the answer that `chief/242-pre-open-native` must write its `NOTICE`
against. A NOTICE written from an unverified license claim is the one bug that
survives the repository going public, so §6 below is the exact text to use.

---

## 1. Why this was in doubt

GitHub's licensing API cannot classify the repository. Reproduced today:

```console
$ gh api repos/trealla-prolog/trealla/license --jq '.license'
{"key":"other","name":"Other","node_id":"MDc6TGljZW5zZTA=","spdx_id":"NOASSERTION","url":null}
```

`NOASSERTION` is SPDX for *"no determination was made"* — it is **not** a finding
of "no license" and **not** a finding of "non-permissive". It means GitHub's
`licensee` matcher did not reach its confidence threshold against any reference
license. Meanwhile this program's own documentation asserted MIT in several
places on no recorded evidence:

| Claim | Where |
|---|---|
| "Trealla Prolog (pure C, MIT)" | `CMakeLists.txt` header comment (this repo) |
| "**License:** MIT — Copyright (c) 2020 Andrew George Davison" | `THIRD_PARTY.md` (this repo) |
| Trealla listed as MIT (×3) | `docs/OPEN_SOURCE_STRATEGY.md` (**parent repo** — see §7) |
| Trealla listed as MIT, §3.1 | `docs/PLATFORM_SPLIT_AND_ENGINE_PLUGINS.md` (**parent repo** — see §7) |

An asserted license and an abstaining classifier are not evidence either way.
What follows is evidence.

## 2. The license text, verbatim

`vendor/trealla/LICENSE` at the pinned commit, complete and unedited
(sha256 `5cc86fb863a1a461f04d171d5802b16db6c31d1d718c336806819311aa3176db`,
git blob `d31f9ac3ff88c4e3092d85b67a1a96aa4971c2e2`, byte-identical to
`repos/trealla-prolog/trealla/contents/LICENSE?ref=07de0136…`):

```
Trealla Prolog Copyright (c) 2020 Andrew George Davison <andrew.davison@gmail.com>

Permission is hereby granted, free of charge, to any person obtaining a
copy of this software and associated documentation files (the "Software"),
to deal in the Software without restriction, including without limitation
the rights to use, copy, modify, merge, publish, distribute, sublicense,
and/or sell copies of the Software, and to permit persons to whom the
Software is furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included
in all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS
OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL
THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR
OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE,
ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR
OTHER DEALINGS IN THE SOFTWARE.
```

## 3. The finding: this IS the MIT license

Dropping the copyright line and normalising case and whitespace (the two things
SPDX matching guidelines say to ignore), the remaining text is **identical, word
for word, to the SPDX reference text of `MIT`** — all three paragraphs: the
grant, the notice-retention condition, and the warranty disclaimer. Nothing is
added, removed, or reworded. Reproduce it:

```sh
sed '1d' vendor/trealla/LICENSE > /tmp/body.txt      # drop the copyright line
# compare /tmp/body.txt to the SPDX MIT reference body, case- and
# whitespace-normalised:  tr 'A-Z' 'a-z' | tr -s ' \t\n' ' '
# → identical
```

So:

- **SPDX identifier: `MIT`.** It applies exactly; no exception, no modification,
  no "MIT-like" qualifier is needed.
- The two deviations from the *canonical file layout* are cosmetic and carry no
  legal weight: there is no `MIT License` title line, and the copyright notice is
  prefixed with the project name ("Trealla Prolog Copyright (c) 2020 …") instead
  of beginning with the word `Copyright`.
- Obligation on us: **retain the copyright notice and the permission notice in
  all copies or substantial portions**, including binary redistribution. That is
  what §6's NOTICE stanza and the vendored `vendor/trealla/LICENSE` discharge.
- MIT is compatible with this repository's own Apache-2.0 `LICENSE`, and with
  redistributing prebuilt `libinsimul` binaries inside engine plugins.

### Why the classifier abstains — inference, clearly labelled

Verified above: the *text* is MIT. The following is the most likely *mechanism*
for `NOASSERTION` and is inference, not a finding — `licensee` was not run here:

`licensee` strips a leading copyright notice before hashing, matching lines that
begin with `Copyright`. This file's notice begins with `Trealla Prolog`, so the
notice is probably not stripped and stays in the compared body. An extra ~9-word
line against MIT's ~170-word body drops the similarity below `licensee`'s 98%
threshold, and with no title line to fall back on, the result is "Other".

The practical consequence either way is the same: **any downstream tool that
reads GitHub's API rather than the file will also report NOASSERTION.** Expect
it, cite this document, and do not "re-resolve" it by asking another classifier.

## 4. Components bundled *inside* Trealla

All of these compile into `libinsimul` and are redistributed in every shipped
binary, so each needs its own answer. Each was read at the pinned commit:

| Component | Path in `vendor/trealla/` | SPDX | Copyright / notes |
|---|---|---|---|
| Trealla Prolog | `LICENSE` | `MIT` | © 2020 Andrew George Davison |
| imath | `src/imath/LICENSE` | `MIT` | © 2002-2009 Michael J. Fromberger. Full MIT body, same cosmetic deviation (notice prefixed "IMath is Copyright …"). |
| isocline | `src/isocline/LICENSE` | `MIT` | © 2021 Daan Leijen. Canonical layout, `MIT License` title and all. |
| mini regex (`sre`) | `src/sre/LICENSE` | `Unlicense` | **Public-domain dedication, not MIT.** `THIRD_PARTY.md` previously described it without a license; it is the Unlicense verbatim ("This is free and unencumbered software released into the public domain… refer to <http://unlicense.org>"). |
| Prolog standard library | `ATTRIBUTION` | `BSD-2-Clause` | © 2018-2021 Mark Thom; © 2002-2020 University of Amsterdam / VU University Amsterdam / SWI-Prolog Solutions b.v. Authors: Mark Thom, Jan Wielemaker, Richard O'Keefe. **Two** clauses (retain in source, reproduce in binary documentation) and the disclaimer — there is no third "no endorsement" clause, so this is BSD-2, not BSD-3. |

The MIT and BSD bodies above were compared the same mechanical way as §3;
imath's and isocline's are the MIT reference text word for word. `ATTRIBUTION`
matches the SPDX `BSD-2-Clause` reference with exactly **one** word differing —
"IN NO EVENT SHALL THE COPYRIGHT **OWNER** OR CONTRIBUTORS BE LIABLE" where SPDX
says "COPYRIGHT **HOLDER**" (the wording BSD-3-Clause's reference uses). No
operative effect; `BSD-2-Clause` is the identifier.

One correction this produced:

- `sre` is **Unlicense**, not MIT, and `THIRD_PARTY.md` gave it no license at
  all. Harmless in substance — a public-domain dedication imposes nothing — but a
  NOTICE that called it MIT would be a false statement about someone else's work.

And one claim it confirmed: `THIRD_PARTY.md` already said the Prolog library was
"BSD-2-Clause style per the original authors". That was right; it is now cited
rather than asserted.

Every one of these is permissive and compatible with Apache-2.0 redistribution.
None is copyleft. None imposes a source-disclosure obligation.

## 5. What is actually redistributed

`libinsimul` statically embeds the compiled Trealla objects **and** the Prolog
standard library `library/*.pl` (as C byte arrays — see `cmake/gen_embed.cmake`).
So the BSD-2-Clause attribution above travels inside every `libinsimul.a`,
`libinsimul.dylib`, `insimul.wasm` and every engine plugin that links one. Its
clause 2 asks that the notice be reproduced "in the documentation and/or other
materials provided with the distribution" — shipping the binary alone does not
discharge it, the plugin's third-party notices must carry it. The obligation is
not theoretical; it ships.

## 6. The NOTICE stanza — for `chief/242-pre-open-native`

Copy this verbatim into `NOTICE` alongside the Apache-2.0 `LICENSE`. It is
written against the finding above, not against a claim.

```
This product includes Trealla Prolog (https://github.com/trealla-prolog/trealla),
vendored at commit 07de013677af760a8bca0594ae4b2bef158a3cde (v2.106.1) under
vendor/trealla/ and compiled into libinsimul.

  Trealla Prolog — MIT License
  Trealla Prolog Copyright (c) 2020 Andrew George Davison <andrew.davison@gmail.com>

Trealla bundles the following, which are also compiled into libinsimul:

  imath — MIT License
  IMath is Copyright (c) 2002-2009 Michael J. Fromberger

  isocline — MIT License
  Copyright (c) 2021 Daan Leijen

  mini regex (src/sre) — The Unlicense (public domain dedication)

  Prolog standard library (library/*.pl) — BSD 2-Clause License
  Copyright (c) 2018-2021, Mark Thom
  Copyright (c) 2002-2020, University of Amsterdam, VU University Amsterdam,
                           SWI-Prolog Solutions b.v.
  Authors: Mark Thom, Jan Wielemaker, Richard O'Keefe

Full license texts: vendor/trealla/LICENSE, vendor/trealla/ATTRIBUTION,
vendor/trealla/src/imath/LICENSE, vendor/trealla/src/isocline/LICENSE,
vendor/trealla/src/sre/LICENSE.
```

Note for 242: GitHub's API will report `NOASSERTION` for Trealla. That is
expected and answered here; do not let it reopen the question.

## 7. Documentation corrected

**In this repository** (done in this commit):

- `THIRD_PARTY.md` — "fetched at a pinned commit" → vendored/committed; the MIT
  claim now cites this document; `sre` corrected to Unlicense and the Prolog
  library to BSD-3-Clause; the pin's authoritative location moved to
  `vendor/trealla/VENDORED.json`.
- `CMakeLists.txt`, `README.md`, `docs/build-configuration.md`,
  `docs/webassembly.md` — the build no longer fetches anything.

**In the parent repository** (`insimul/docs/`, outside this submodule's
worktree — a hand-off, not an omission): `OPEN_SOURCE_STRATEGY.md` (×3) and
`PLATFORM_SPLIT_AND_ENGINE_PLUGINS.md` §3.1 say "MIT". **Those claims are
CORRECT** — this finding confirms them rather than contradicting them, so no
text has to change. What they lack is a citation. The one-line edit each needs
is a pointer to this file, so the next reader who runs `gh api` and sees
`NOASSERTION` does not re-litigate it:

> Trealla Prolog is MIT (`native/docs/TREALLA_LICENSE_FINDING.md` resolves this
> from the license text; GitHub's API reports NOASSERTION and is wrong).

## 8. Re-resolving this after a version bump

The pin is `vendor/trealla/VENDORED.json`. When it moves:

1. `diff` the new `LICENSE` and `ATTRIBUTION` against the vendored ones. If both
   are unchanged, this finding still holds — say so and move on.
2. If either changed, redo §2-§4 from the new text and update §6 before shipping
   a binary.
3. Check for **new** bundled components under `src/` (a new third-party
   directory with its own LICENSE) and add a row to §4.

The `trealla_vendor` ctest guarantees step 1 is not skippable by accident: it
recomputes the git object ids of the vendored tree, so a re-vendor that changed
`LICENSE` cannot pass with the old manifest.
