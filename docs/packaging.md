# Packaging & versioning

This doc explains how a build of libinsimul turns into a redistributable package, and how
every artifact stays honest about exactly which engine it is. If you consume a package,
[consuming.md](consuming.md) shows the per-engine file layout; this doc is about producing
one and about the version stamp that ties it all together.

## One source of truth for the version

The library's semver lives in one place — the tracked `VERSION` file (currently `0.1.0`).
`CMakeLists.txt` reads it, `insimul_version()` embeds it, and `scripts/package.sh` stamps
it, so they never drift. **To bump the version, edit `VERSION` only.**

`insimul_version()` (part of the [C ABI](c-abi.md)) returns a static string identifying the
exact build:

```
insimul 0.1.0 (git 3c347ec, trealla v2.106.1/07de013677af760a8bca0594ae4b2bef158a3cde)
```

— the `insimul` semver, the short git sha the tree was built from (`unknown` for a non-git
tarball build), and the pinned Trealla tag/commit. Wrappers log it on startup, so support
can identify the precise engine a save file was produced against from a single string.

## Building a package

`scripts/package.sh` produces a redistributable package from the current tree — two shapes,
one script, one stamp:

```sh
scripts/package.sh                 # -> dist/<platform>/   native (default)
scripts/package.sh --target wasm   # -> dist/wasm/         browser / bundler
scripts/package.sh --target all    # -> both
```

`dist/` is gitignored.

### The native package — `dist/<platform>/`

`<platform>` is derived from `uname` (`macos-arm64`, `macos-x64`, `linux-x64`,
`windows-x64`). Each native package contains the **shared** library
(`libinsimul.dylib`/`.so`/`insimul.dll`), the public header `insimul.h`, and a `VERSION`
file:

```
insimul 0.1.0
platform macos-arm64
git 3c347ec
trealla_tag v2.106.1
trealla_commit 07de013677af760a8bca0594ae4b2bef158a3cde
```

The first line's semver matches `insimul_version()`, and the Trealla fields match the pin
in `CMakeLists.txt` / [../THIRD_PARTY.md](../THIRD_PARTY.md) — so a consumer can cross-check
the binary it loaded against the file it shipped.

### The wasm package — `dist/wasm/`

The same engine and the same stamp (`platform wasm32-emscripten`) laid out for a JS
bundler: `insimul.wasm`, the generated `insimul.mjs` glue, `wasm/insimul-api.mjs`, an
`index.mjs` entry point, `LICENSE`, and a `package.json` (`@insimul/prolog-wasm`) whose
`exports` map ties them together.

```
dist/wasm/  package.json  index.mjs  insimul-api.mjs  insimul.mjs
            insimul.wasm  VERSION  LICENSE
```

It declares **no dependencies at all** — the dependency direction is one-way; nothing here
depends on a JS consumer of it. How a browser actually wires this package (bundler
resolution, `locateFile`, CSP, the download-size table) is in [consuming.md](consuming.md).

## Packaging asserts its own correctness

The wasm package build ends by loading the assembled directory the way a bundler resolves
it (`tests/wasm_package_smoke.mjs`): every file present, every `exports` target resolvable,
no dependencies, `insimul_version()` byte-equal to the `VERSION` stamp (reassembled from
its five fields), and a real `grandparent/2` query answered through the packaged entry
point. Because the stamp is rebuilt from the `VERSION` fields and required to match the
binary's own `insimul_version()`, **a stale `build-wasm/` tree cannot be shipped with a
fresh stamp** — the smoke test fails first.

It also prints the raw/gzip/brotli size table on every run; regenerate the numbers in
[consuming.md](consuming.md) from that output after any Trealla or Emscripten bump rather
than guessing.
</content>
