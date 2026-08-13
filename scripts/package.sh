#!/usr/bin/env bash
# package.sh — prebuilt-artifact packaging for libinsimul.
#
# ONE script, one version stamp, two distribution targets — the browser package
# is a sibling of the native ones (US-3), not a second mechanism:
#
#   scripts/package.sh                  -> dist/<platform>/  native (default)
#   scripts/package.sh --target wasm    -> dist/wasm/        browser / bundler
#   scripts/package.sh --target all     -> both
#
# NATIVE (US-LI5) — the three things an engine plugin needs to consume the core
# (see docs/consuming.md):
#   - the SHARED library  (libinsimul.dylib | libinsimul.so | insimul.dll)
#   - the public header   (insimul.h)
#   - a VERSION stamp     (semver + git sha + Trealla pin, one field per line)
#
# ...and, since tasklist 104 promoted the core bridge into this repo, the same
# two files for the SECOND library beside them (libinsimulcore + insimulcore.h).
# One package, two independent ABIs — a consumer that only needs Prolog ignores
# the extra pair. The wasm package deliberately carries only libinsimul: a
# browser host runs @insimul/core as the TypeScript it already is, so compiling a
# JS engine to wasm to run JS would be circular.
#
# WASM (US-3) — the same engine for a JS bundler: the Emscripten glue, the
# `.wasm` binary, the hand-written wrapper, an `index.mjs` entry point, a
# `package.json` whose `exports` map ties them together, and the SAME VERSION
# stamp. `tests/wasm_package_smoke.mjs` then loads the assembled directory the
# way a bundler would and refuses to let it ship if anything is missing, stale,
# or disagrees with insimul_version().
#
# The VERSION stamp mirrors the C ABI's insimul_version() exactly (both derive
# from the tracked VERSION file, the git sha, and the CMakeLists Trealla pin), so
# a consumer can cross-check the binary it loaded against the file it shipped.
#
# Usage: scripts/package.sh [--target native|wasm|all] [--build-dir DIR]
#                           [--wasm-build-dir DIR] [--out DIR]
#   Run from anywhere; paths are resolved relative to the repo root.
set -euo pipefail

# --------------------------------------------------------------- locate the repo
here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
root="$(cd "$here/.." && pwd)"          # repo root
cd "$root"

target="native"
build_dir="build"
wasm_build_dir="build-wasm"
out_root="dist"
while [ $# -gt 0 ]; do
  case "$1" in
    --target)
      target="$2"
      case "$target" in native|wasm|all) ;; *)
        echo "package: --target must be native, wasm or all (got '$target')" >&2; exit 2 ;;
      esac
      shift 2 ;;
    --build-dir)      build_dir="$2";      shift 2 ;;
    --wasm-build-dir) wasm_build_dir="$2"; shift 2 ;;
    --out)            out_root="$2";       shift 2 ;;
    -h|--help)   sed -n '2,30p' "$0"; exit 0 ;;
    *) echo "package: unknown argument: $1" >&2; exit 2 ;;
  esac
done

# ---------------------------------------------------------------- platform label
os="$(uname -s)"
arch="$(uname -m)"
case "$os" in
  Darwin)  plat_os="macos"; libname="libinsimul.dylib"; corelibname="libinsimulcore.dylib" ;;
  Linux)   plat_os="linux"; libname="libinsimul.so";    corelibname="libinsimulcore.so" ;;
  MINGW*|MSYS*|CYGWIN*) plat_os="windows"; libname="insimul.dll"; corelibname="insimulcore.dll" ;;
  *) echo "package: unsupported OS '$os'" >&2; exit 1 ;;
esac
case "$arch" in
  arm64|aarch64) plat_arch="arm64" ;;
  x86_64|amd64)  plat_arch="x64" ;;
  *) echo "package: unsupported arch '$arch'" >&2; exit 1 ;;
esac
platform="${plat_os}-${plat_arch}"

# ------------------------------------------------------------------- version bits
semver="$(head -n1 VERSION | tr -d '[:space:]')"
[ -n "$semver" ] || { echo "package: empty VERSION file" >&2; exit 1; }

if git_sha="$(git -C "$root" rev-parse --short HEAD 2>/dev/null)"; then :; else git_sha="unknown"; fi

# Read the authoritative engine pin straight from the vendor drop that the build
# compiles — vendor/trealla/VENDORED.json, the same file CMakeLists.txt reads
# (US-3) — so the stamp can never drift from what was built. The stamp's KEYS
# are engine_name/engine_version/engine_commit — neutral, so a future engine
# changes these values and not a consumer's parser (US-2, L-02).
engine_pin="vendor/trealla/VENDORED.json"
# The engine NAME is the build's default engine selection (INSIMUL_ENGINE),
# which is what a packaged build embeds. Since tasklist 250 there are two
# selections in one tree; packaging only ever ships the vendored default, so the
# default is what is read — not INSIMUL_ENGINE_NAME, which is now derived from it.
engine_name="$(sed -n 's/^set(INSIMUL_ENGINE "\([^"]*\)" CACHE STRING.*/\1/p' CMakeLists.txt | head -n1)"
engine_version="$(sed -n 's/.*"tag"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' "$engine_pin" | head -n1)"
engine_commit="$(sed -n 's/.*"commit"[[:space:]]*:[[:space:]]*"\([0-9a-f]*\)".*/\1/p' "$engine_pin" | head -n1)"
[ -n "$engine_name" ]    || engine_name="unknown"
[ -n "$engine_version" ] || engine_version="unknown"
[ -n "$engine_commit" ]  || engine_commit="unknown"

# The one stamp writer both targets use — `platform` is the only field that
# differs, so a wasm package is cross-checked exactly like a macos-arm64 one.
# The trealla_* keys are DEPRECATED aliases of engine_version/engine_commit,
# kept so already-vendored consumers (babylon's prolog-wasm vendor test reads
# trealla_commit) keep working across one re-vendor. New readers use the engine_*
# keys; tests/wasm_package_smoke.mjs asserts the alias never drifts from them.
write_stamp() {  # write_stamp <outdir> <platform-label>
  cat > "$1/VERSION" <<EOF
insimul $semver
platform $2
git $git_sha
engine_name $engine_name
engine_version $engine_version
engine_commit $engine_commit
trealla_tag $engine_version
trealla_commit $engine_commit
EOF
}

# ---------------------------------------------------------------------- cmake PATH
# cmake may live in a user pip install or Homebrew rather than on the default PATH
# (mirrors .chief/verify.sh's discovery).
if ! command -v cmake >/dev/null 2>&1; then
  for d in "$HOME"/Library/Python/*/bin /opt/homebrew/bin /usr/local/bin; do
    [ -x "$d/cmake" ] && PATH="$d:$PATH"
  done
  export PATH
fi
command -v cmake >/dev/null 2>&1 || { echo "package: cmake not found on PATH" >&2; exit 1; }

# ================================================================ native target
package_native() {
  echo "package: building shared libraries ($platform, insimul $semver)"
  cmake -B "$build_dir" >/dev/null
  cmake --build "$build_dir" --target insimul_shared insimulcore_shared -j >/dev/null

  local lib_path="$build_dir/$libname"
  local corelib_path="$build_dir/$corelibname"
  for f in "$lib_path" "$corelib_path"; do
    [ -f "$f" ] || { echo "package: built library not found at $f" >&2; exit 1; }
  done

  local out="$out_root/$platform"
  rm -rf "$out"
  mkdir -p "$out"
  cp "$lib_path" "$out/$libname"
  cp include/insimul.h "$out/insimul.h"
  # The second library and its ABI (tasklist 104). Independent of the first —
  # it is packaged beside it, not inside it.
  cp "$corelib_path" "$out/$corelibname"
  cp corebridge/include/insimulcore.h "$out/insimulcore.h"
  write_stamp "$out" "$platform"

  echo "package: wrote $out/"
  ls -1 "$out"
  echo "package: --- VERSION ---"
  cat "$out/VERSION"
}

# ================================================================== wasm target
# Layout (docs/consuming.md, "Web / JS bundlers"):
#   dist/wasm/
#     package.json      exports map: "." -> index.mjs, plus ./insimul.wasm
#     index.mjs         the entry point (wires the glue into the wrapper)
#     insimul-api.mjs   the hand-written ABI wrapper (from wasm/)
#     insimul.mjs       the generated Emscripten glue
#     insimul.wasm      the engine — fetched by the glue, NOT inlined
#     VERSION  LICENSE
package_wasm() {
  command -v node >/dev/null 2>&1 || {
    echo "package: node not found on PATH (needed to verify the wasm package)" >&2; exit 1; }

  echo "package: building the WebAssembly target (insimul $semver)"
  # build_wasm.sh owns emsdk discovery and the emcmake configure; --no-test
  # because the package is verified below by tests/wasm_package_smoke.mjs
  # (ctest already gates the build itself via scripts/build_wasm.sh).
  scripts/build_wasm.sh --no-test --build-dir "$wasm_build_dir" >/dev/null

  local glue="$wasm_build_dir/insimul.mjs"
  local binary="$wasm_build_dir/insimul.wasm"
  for f in "$glue" "$binary"; do
    [ -f "$f" ] || { echo "package: built wasm artifact not found at $f" >&2; exit 1; }
  done

  local out="$out_root/wasm"
  rm -rf "$out"
  mkdir -p "$out"
  cp "$glue"                "$out/insimul.mjs"
  cp "$binary"              "$out/insimul.wasm"
  cp wasm/insimul-api.mjs   "$out/insimul-api.mjs"
  cp wasm/index.mjs         "$out/index.mjs"
  cp LICENSE                "$out/LICENSE"
  write_stamp "$out" "wasm32-emscripten"

  # No dependencies, ever: this package is consumed BY the JS runtime, it never
  # consumes it. The direction stays one-way (wasm_package_smoke asserts it).
  cat > "$out/package.json" <<EOF
{
  "name": "@insimul/prolog-wasm",
  "version": "$semver",
  "description": "libinsimul — the Trealla Prolog core, built for wasm32 (the same engine the native engine plugins run)",
  "license": "Apache-2.0",
  "type": "module",
  "sideEffects": false,
  "exports": {
    ".": "./index.mjs",
    "./api": "./insimul-api.mjs",
    "./glue": "./insimul.mjs",
    "./insimul.wasm": "./insimul.wasm",
    "./package.json": "./package.json"
  },
  "files": [
    "index.mjs",
    "insimul-api.mjs",
    "insimul.mjs",
    "insimul.wasm",
    "VERSION",
    "LICENSE"
  ]
}
EOF

  echo "package: wrote $out/"
  ls -1 "$out"
  echo "package: --- VERSION ---"
  cat "$out/VERSION"

  # Verify the assembled package the way a bundler resolves it. This is what
  # keeps the layout, the exports map and the version stamp honest — a package
  # that cannot be imported, or whose stamp disagrees with insimul_version(),
  # fails here instead of in a consumer's build.
  echo "package: --- verifying $out/ ---"
  node tests/wasm_package_smoke.mjs "$out"
}

case "$target" in
  native) package_native ;;
  wasm)   package_wasm ;;
  all)    package_native; echo; package_wasm ;;
esac

echo "package: OK"
