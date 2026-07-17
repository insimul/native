#!/usr/bin/env bash
# package.sh — US-LI5 prebuilt-binary packaging for libinsimul.
#
# Produces dist/<platform>/ containing the three things an engine plugin needs to
# consume the native core (see docs/consuming.md):
#   - the SHARED library  (libinsimul.dylib | libinsimul.so | insimul.dll)
#   - the public header   (insimul.h)
#   - a VERSION stamp     (semver + git sha + Trealla pin, one field per line)
#
# The VERSION stamp mirrors the C ABI's insimul_version() exactly (both derive
# from the tracked VERSION file, the git sha, and the CMakeLists Trealla pin), so
# a consumer can cross-check the binary it loaded against the file it shipped.
#
# Usage: scripts/package.sh [--build-dir DIR] [--out DIR]
#   Run from anywhere; paths are resolved relative to insimul-native/.
set -euo pipefail

# --------------------------------------------------------------- locate the repo
here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
root="$(cd "$here/.." && pwd)"          # insimul-native/
cd "$root"

build_dir="build"
out_root="dist"
while [ $# -gt 0 ]; do
  case "$1" in
    --build-dir) build_dir="$2"; shift 2 ;;
    --out)       out_root="$2";  shift 2 ;;
    -h|--help)   sed -n '2,20p' "$0"; exit 0 ;;
    *) echo "package: unknown argument: $1" >&2; exit 2 ;;
  esac
done

# ---------------------------------------------------------------- platform label
os="$(uname -s)"
arch="$(uname -m)"
case "$os" in
  Darwin)  plat_os="macos"; libname="libinsimul.dylib" ;;
  Linux)   plat_os="linux"; libname="libinsimul.so" ;;
  MINGW*|MSYS*|CYGWIN*) plat_os="windows"; libname="insimul.dll" ;;
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

# Read the authoritative Trealla pin straight from CMakeLists.txt (same source
# the build compiles against), so the stamp can never drift from what was built.
trealla_tag="$(sed -n 's/.*TREALLA_GIT_TAG "\([^"]*\)".*/\1/p' CMakeLists.txt | head -n1)"
trealla_commit="$(sed -n 's/.*TREALLA_GIT_COMMIT "\([0-9a-f]*\)".*/\1/p' CMakeLists.txt | head -n1)"
[ -n "$trealla_tag" ]    || trealla_tag="unknown"
[ -n "$trealla_commit" ] || trealla_commit="unknown"

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

# ------------------------------------------------------------------------- build
echo "package: building shared library ($platform, insimul $semver)"
cmake -B "$build_dir" >/dev/null
cmake --build "$build_dir" --target insimul_shared -j >/dev/null

lib_path="$build_dir/$libname"
[ -f "$lib_path" ] || { echo "package: built library not found at $lib_path" >&2; exit 1; }

# ------------------------------------------------------------------------ assemble
out="$out_root/$platform"
rm -rf "$out"
mkdir -p "$out"
cp "$lib_path" "$out/$libname"
cp include/insimul.h "$out/insimul.h"

cat > "$out/VERSION" <<EOF
insimul $semver
platform $platform
git $git_sha
trealla_tag $trealla_tag
trealla_commit $trealla_commit
EOF

echo "package: wrote $out/"
ls -1 "$out"
echo "package: --- VERSION ---"
cat "$out/VERSION"
echo "package: OK"
