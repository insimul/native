#!/usr/bin/env bash
# build_swipl.sh — build the SPIKE's second engine, reproducibly.
#
# Tasklist 250 (decision D20 phase 1) compares SWI-Prolog against Trealla behind
# the SAME 12-function C ABI. A measurement nobody else can re-run is an
# anecdote, so the exact source pin and the exact configure flags live HERE, in
# the repository, and this script is the only supported way to produce the
# prefix that `-DINSIMUL_SWIPL_ROOT=` points at.
#
# UNLIKE TREALLA, SWI IS NOT VENDORED. Trealla is committed under vendor/ because
# libinsimul is layer zero and its build must not need the network. That rule is
# about what SHIPS; a spike that has not yet earned a migration does not get to
# add ~40 MB of a second engine's source to every clone. If the spike says yes,
# vendoring is the migration's first story — see docs/SWIPL_SPIKE.md.
#
#   usage: scripts/build_swipl.sh [--prefix DIR] [--src DIR] [--jobs N]
#
# Prints the install prefix on the last line.
set -euo pipefail

# --- the pin (the one authoritative location for this spike's SWI version) ---
SWIPL_REPO="https://github.com/SWI-Prolog/swipl-devel.git"
SWIPL_TAG="V10.0.1"
SWIPL_COMMIT="e58621a91ab7dd530e1e8185ed518f63d851c414"

# --- the configure flags, and WHY each one is here ---------------------------
#
# The profile is "smallest honest embedding of SWI", chosen to be as close as
# possible to what libinsimul asks of Trealla — which embeds only its own core
# and Prolog library. Anything that would flatter SWI's numbers by removing
# something Trealla HAS is not done here.
#
#   SWIPL_PACKAGES=OFF     no clib/sgml/http/ssl/… — Trealla's build here has no
#                          FFI and no OpenSSL either, so this is the fair pairing.
#   USE_GMP=OFF            use SWI's bundled LibBF for unbounded integers rather
#                          than a system libgmp. Trealla uses bundled imath and
#                          links no system bignum library, and the ABI promises
#                          big integers (insimul.h), so they must still WORK.
#   BUILD_SWIPL_LD=OFF     swipl-ld is a developer tool, not part of an embed.
#   INSTALL_DOCUMENTATION=OFF / BUILD_TESTING=OFF   not part of an embed either.
#   SWIPL_SHARED_LIB=ON    libinsimul links libswipl; this is the embedding form.
#   CMAKE_BUILD_TYPE=Release   same as libinsimul's default.
#
# The one flag that is a WORKAROUND, recorded rather than hidden:
#   CMAKE_C_FLAGS=-std=gnu11 is not needed on V10.0.1 (it was needed to build
#   V9.2.9 at all on this host — macOS SDK's <os/base.h> pulls in <stdbool.h>,
#   whose `#define false 0` clobbers SWI 9.2.x's `false(def, FLAG)` macro). It is
#   left off; if you pin an older tag you will need it.
SWIPL_CMAKE_FLAGS=(
  -DCMAKE_BUILD_TYPE=Release
  -DSWIPL_PACKAGES=OFF
  -DUSE_GMP=OFF
  -DBUILD_SWIPL_LD=OFF
  -DINSTALL_DOCUMENTATION=OFF
  -DBUILD_TESTING=OFF
  -DSWIPL_SHARED_LIB=ON
)

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
prefix="${INSIMUL_SWIPL_ROOT:-$root/build-swipl/install}"
srcdir="${INSIMUL_SWIPL_SRC:-$root/build-swipl/src}"
jobs="$(getconf _NPROCESSORS_ONLN 2>/dev/null || echo 4)"

while [ $# -gt 0 ]; do
  case "$1" in
    --prefix) prefix="$2"; shift 2 ;;
    --src)    srcdir="$2"; shift 2 ;;
    --jobs)   jobs="$2";   shift 2 ;;
    -h|--help) sed -n '2,20p' "$0"; exit 0 ;;
    *) echo "build_swipl.sh: unknown argument '$1'" >&2; exit 2 ;;
  esac
done

builddir="$(dirname "$srcdir")/build"
mkdir -p "$(dirname "$srcdir")"

# --- source at the pin -------------------------------------------------------
if [ -d "$srcdir/.git" ]; then
  have="$(git -C "$srcdir" rev-parse HEAD)"
  if [ "$have" != "$SWIPL_COMMIT" ]; then
    echo "build_swipl.sh: $srcdir is at $have, not the pin $SWIPL_COMMIT — removing" >&2
    rm -rf "$srcdir"
  fi
fi
if [ ! -d "$srcdir/.git" ]; then
  echo "==> cloning $SWIPL_REPO $SWIPL_TAG"
  git clone --depth 1 --branch "$SWIPL_TAG" "$SWIPL_REPO" "$srcdir"
fi

have="$(git -C "$srcdir" rev-parse HEAD)"
if [ "$have" != "$SWIPL_COMMIT" ]; then
  echo "build_swipl.sh: $SWIPL_TAG resolves to $have, not the pinned $SWIPL_COMMIT." >&2
  echo "  The tag moved. Update the pin in this script deliberately, do not build." >&2
  exit 1
fi
echo "==> pin verified: $SWIPL_TAG = $SWIPL_COMMIT"

# --- configure / build / install --------------------------------------------
echo "==> configuring into $builddir (prefix $prefix)"
cmake -S "$srcdir" -B "$builddir" "${SWIPL_CMAKE_FLAGS[@]}" \
      -DCMAKE_INSTALL_PREFIX="$prefix"
echo "==> building (-j$jobs)"
cmake --build "$builddir" -j"$jobs"
echo "==> installing"
cmake --install "$builddir"

# --- record what was built, beside what was built ----------------------------
# cmake/swipl.cmake reads `commit=` out of this file for the version stamp, so a
# libinsimul built against this prefix can never name a commit other than these
# bytes — the same rule vendor/trealla/VENDORED.json enforces for Trealla.
{
  echo "# written by scripts/build_swipl.sh — do not edit"
  echo "repo=$SWIPL_REPO"
  echo "tag=$SWIPL_TAG"
  echo "commit=$SWIPL_COMMIT"
  echo "cmake_flags=${SWIPL_CMAKE_FLAGS[*]}"
  echo "built_on=$(uname -srm)"
  echo "cc=$( (cc --version 2>/dev/null || echo unknown) | head -n1)"
} > "$prefix/INSIMUL_SWIPL_PIN"

echo
echo "SWI-Prolog $SWIPL_TAG installed. Configure libinsimul against it with:"
echo "  cmake -B build-swipl-native -DINSIMUL_ENGINE=swipl -DINSIMUL_SWIPL_ROOT=$prefix"
echo "$prefix"
