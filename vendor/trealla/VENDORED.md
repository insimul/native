# vendor/trealla — VENDORED, DO NOT EDIT

This is a source drop of [Trealla Prolog](https://github.com/trealla-prolog/trealla),
**unmodified**, at the commit recorded in `VENDORED.json`. It is upstream's code,
not ours. Nothing in this directory may be hand-edited — a local fix here would
be invisible to the next re-vendor and would break the provenance gate.

## Why it is committed rather than fetched

`libinsimul` is layer zero: four engine runtimes (Babylon, Godot, Unity,
Unreal), the Rust server, the save file and every world's canonical state sit on
it. A build of layer zero must not depend on a 381-star single-maintainer
repository staying reachable or unchanged, and a game developer who unzips an
engine plugin cannot be asked to run a network fetch. So the engine source ships
here, exactly as QuickJS does under `corebridge/vendor/quickjs/`.

**The build performs no network fetch.** `CMakeLists.txt` points `TREALLA_DIR` at
this directory; there is no `FetchContent` for the engine, and `trealla_vendor`
fails if one comes back.

## What is here, and what is not

Vendored: `src/` (the engine, including its own vendored `imath/`, `isocline/`,
`sre/`), `library/*.pl` (the Prolog standard library, embedded as C arrays by
`cmake/gen_embed.cmake`), `util/bin2c.c` (the build tool that does the
embedding), `LICENSE`, `ATTRIBUTION`.

Omitted, because this build does not use them: upstream's `tests/`, `samples/`,
`docs/`, `man/`, `Makefile`, `tpl.c` (the standalone `tpl` REPL — we link the
library, not the executable), `README.md`, `_config.yml`, `trealla.png`.

The omission is safe *and checked*: `VENDORED.json`'s `gitObjects` records the
git object id of each vendored path from upstream's tree at the pin, so a
missing or extra file inside those paths fails the gate.

## The pin lives here

`VENDORED.json` is the one authoritative location for the Trealla pin
(`commit` + `tag`). `CMakeLists.txt` reads it into `TREALLA_GIT_COMMIT` /
`TREALLA_GIT_TAG`, `insimul_version()` stamps it, and `scripts/package.sh` reads
the same file — so a version stamp can never name a commit other than the bytes
that were compiled. Same rule as QuickJS's `VERSION` and the core bundle's
`coreCommit`.

## License

**MIT**, plus MIT / BSD-2-Clause / Unlicense for the components Trealla itself
bundles. That was resolved by reading the texts here, not by trusting a
classifier — GitHub's API reports `NOASSERTION` for Trealla. See
[`../../docs/TREALLA_LICENSE_FINDING.md`](../../docs/TREALLA_LICENSE_FINDING.md),
which also carries the exact `NOTICE` text to ship.

## Re-vendoring

```sh
git clone https://github.com/trealla-prolog/trealla /tmp/trealla
git -C /tmp/trealla checkout <new-commit>
rm -rf vendor/trealla/src vendor/trealla/library vendor/trealla/util
cp -R /tmp/trealla/src /tmp/trealla/library vendor/trealla/
mkdir -p vendor/trealla/util && cp /tmp/trealla/util/bin2c.c vendor/trealla/util/
cp /tmp/trealla/LICENSE /tmp/trealla/ATTRIBUTION vendor/trealla/

# the new object ids, computed the same way the gate checks them:
git -C /tmp/trealla ls-tree <new-commit> ATTRIBUTION LICENSE library src util
```

Then update `commit`, `tag`, `vendoredOn` and `gitObjects` in `VENDORED.json`
**together**, re-run the full gate list from the repo root, and re-check the
license text (§8 of the license finding) before shipping a binary.
