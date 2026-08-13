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
#   usage: scripts/build_swipl.sh [--target native|wasm]
#                                 [--prefix DIR] [--src DIR] [--jobs N]
#
#   --target native   (default) libswipl.dylib/.so + its home tree, for
#                     `cmake -B build-swipl-native -DINSIMUL_ENGINE=swipl`.
#   --target wasm     libswipl.a cross-compiled by Emscripten + the wasm preload
#                     home tree, for `emcmake cmake -DINSIMUL_ENGINE=swipl`
#                     (scripts/build_wasm.sh --engine swipl does it for you).
#                     Needs a native build first — SWI compiles its own boot file
#                     and library index with a host `swipl` (SWIPL_NATIVE_FRIEND),
#                     so this target builds one if it is not already there.
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

# --- the wasm profile, and where it has to differ ----------------------------
#
# Same four size/behaviour choices as above (packages off, LibBF, no docs, no
# tests), plus what the Emscripten target forces. Each difference is a finding
# the spike owes, not a knob turned for convenience — docs/SWIPL_SPIKE.md §3
# numbers them:
#
#   MULTI_THREADED=OFF     -pthread in wasm means SharedArrayBuffer, which means
#                          COOP/COEP headers on every embedding page. libinsimul's
#                          own wasm target is single-threaded for exactly this
#                          reason (CLAUDE.md, "The wasm target"), so SWI matches it.
#   USE_SIGNALS=OFF        no host signal handlers in a browser tab; matches the
#                          --no-signals the native embed already passes.
#   INSTALL_QLF=OFF /      SWI's Emscripten branch puts library/wasm.pl and
#   INSTALL_PROLOG_SRC=ON  library/dom.pl in the library unconditionally, and both
#                          need library(uri) from the clib PACKAGE. With packages
#                          off the .qlf compile of the library therefore fails, so
#                          the home tree ships Prolog SOURCE. That is gap G-13:
#                          it costs startup time, and it is SWI's coupling, not a
#                          choice made to flatter or hurt the numbers.
#   ZLIB_*                 the core (not a package) requires zlib; Emscripten's
#                          port supplies it (`embuilder build zlib`, fetched once
#                          from github.com/madler/zlib — gap G-14, the wasm build
#                          is not offline).
#   SWIPL_NATIVE_FRIEND    boot.prc and the library index are compiled BY a
#                          Prolog, so a cross build needs a host swipl.
#   SWIPL_SHARED_LIB       omitted: src/CMakeLists.txt forces LIBSWIPL_TYPE=STATIC
#                          under EMSCRIPTEN whatever it is set to.
SWIPL_WASM_CMAKE_FLAGS=(
  -DCMAKE_BUILD_TYPE=Release
  -DSWIPL_PACKAGES=OFF
  -DUSE_GMP=OFF
  -DBUILD_SWIPL_LD=OFF
  -DINSTALL_DOCUMENTATION=OFF
  -DBUILD_TESTING=OFF
  -DMULTI_THREADED=OFF
  -DUSE_SIGNALS=OFF
  -DINSTALL_QLF=OFF
  -DINSTALL_PROLOG_SRC=ON
)

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
target="native"
prefix=""
srcdir="${INSIMUL_SWIPL_SRC:-$root/build-swipl/src}"
jobs="$(getconf _NPROCESSORS_ONLN 2>/dev/null || echo 4)"

while [ $# -gt 0 ]; do
  case "$1" in
    --target) target="$2"; shift 2 ;;
    --prefix) prefix="$2"; shift 2 ;;
    --src)    srcdir="$2"; shift 2 ;;
    --jobs)   jobs="$2";   shift 2 ;;
    -h|--help) sed -n '2,28p' "$0"; exit 0 ;;
    *) echo "build_swipl.sh: unknown argument '$1'" >&2; exit 2 ;;
  esac
done

case "$target" in
  native) : "${prefix:=${INSIMUL_SWIPL_ROOT:-$root/build-swipl/install}}" ;;
  wasm)   : "${prefix:=$root/build-swipl/install-wasm}" ;;
  *) echo "build_swipl.sh: --target must be 'native' or 'wasm', got '$target'" >&2; exit 2 ;;
esac

builddir="$(dirname "$srcdir")/build"            # the native build tree
wasmbuilddir="$(dirname "$srcdir")/build-wasm"   # the Emscripten build tree
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

# --- record what was built, beside what was built ----------------------------
# cmake/swipl.cmake reads `commit=` out of this file for the version stamp, so a
# libinsimul built against this prefix can never name a commit other than these
# bytes — the same rule vendor/trealla/VENDORED.json enforces for Trealla.
write_pin() {  # write_pin <prefix> <flags...>
  local pfx="$1"; shift
  {
    echo "# written by scripts/build_swipl.sh — do not edit"
    echo "repo=$SWIPL_REPO"
    echo "tag=$SWIPL_TAG"
    echo "commit=$SWIPL_COMMIT"
    echo "target=$target"
    echo "cmake_flags=$*"
    echo "built_on=$(uname -srm)"
    if [ "$target" = "wasm" ]; then
      echo "cc=$( (emcc --version 2>/dev/null || echo unknown) | head -n1)"
    else
      echo "cc=$( (cc --version 2>/dev/null || echo unknown) | head -n1)"
    fi
  } > "$pfx/INSIMUL_SWIPL_PIN"
}

# --- native ------------------------------------------------------------------
build_native() {
  echo "==> configuring into $builddir (prefix $prefix)"
  cmake -S "$srcdir" -B "$builddir" "${SWIPL_CMAKE_FLAGS[@]}" \
        -DCMAKE_INSTALL_PREFIX="$prefix"
  echo "==> building (-j$jobs)"
  cmake --build "$builddir" -j"$jobs"
  echo "==> installing"
  cmake --install "$builddir"
  write_pin "$prefix" "${SWIPL_CMAKE_FLAGS[@]}"
}

if [ "$target" = "native" ]; then
  build_native
  echo
  echo "SWI-Prolog $SWIPL_TAG installed. Configure libinsimul against it with:"
  echo "  cmake -B build-swipl-native -DINSIMUL_ENGINE=swipl -DINSIMUL_SWIPL_ROOT=$prefix"
  echo "$prefix"
  exit 0
fi

# --- wasm --------------------------------------------------------------------
# Same emsdk discovery as scripts/build_wasm.sh: emcc on PATH, else $EMSDK or
# ~/emsdk's env script.
if ! command -v emcc >/dev/null 2>&1; then
  for env_sh in "${EMSDK:-}/emsdk_env.sh" "$HOME/emsdk/emsdk_env.sh"; do
    if [ -f "$env_sh" ]; then
      # shellcheck disable=SC1090
      source "$env_sh" >/dev/null 2>&1 || true
      break
    fi
  done
fi
command -v emcc >/dev/null 2>&1 || {
  echo "build_swipl.sh: emcc not found on PATH (see scripts/build_wasm.sh REQUIREMENTS)" >&2
  exit 1
}
echo "==> $(emcc --version | head -n1)"

# SWI's cross build compiles boot.prc and the library index with a HOST swipl.
# Build one at the same pin if it is not already there.
if [ ! -x "$builddir/src/swipl" ]; then
  echo "==> no native friend at $builddir/src/swipl — building the native target first"
  ( prefix="${INSIMUL_SWIPL_ROOT:-$root/build-swipl/install}"; build_native )
fi

# zlib: the SWI core (not a package) needs it, and Emscripten ships it as a port.
# Building it explicitly means the cmake find_package below has real paths to
# find rather than -sUSE_ZLIB magic the SWI build does not know about.
echo "==> ensuring the Emscripten zlib port is built"
embuilder build zlib
sysroot="$(em-config CACHE)/sysroot"
zlib_a="$sysroot/lib/wasm32-emscripten/libz.a"
[ -f "$zlib_a" ] || { echo "build_swipl.sh: no $zlib_a after embuilder" >&2; exit 1; }

# A FRESH build tree. The library preload directory is assembled by copying the
# staged home tree, so a tree left over from a different flag set can leak stale
# .qlf/.pl files into the artifact whose bytes US-3 measures.
rm -rf "$wasmbuilddir"
echo "==> configuring the Emscripten build into $wasmbuilddir"
emcmake cmake -S "$srcdir" -B "$wasmbuilddir" \
  "${SWIPL_WASM_CMAKE_FLAGS[@]}" \
  -DZLIB_LIBRARY="$zlib_a" \
  -DZLIB_INCLUDE_DIR="$sysroot/include" \
  -DSWIPL_NATIVE_FRIEND="$builddir" \
  -DCMAKE_INSTALL_PREFIX="$prefix"

# Only the two things an embedder needs: the static engine library, and the home
# tree (boot.prc + library) that SWI resolves at run time. `cmake --install` is
# not used: under Emscripten it stages a swipl-web/swipl-bundle *application*,
# which is the thing this spike is deliberately NOT measuring.
echo "==> building libswipl + wasm_preload (-j$jobs)"
cmake --build "$wasmbuilddir" --target libswipl wasm_preload -j"$jobs"

lib_a="$wasmbuilddir/src/libswipl.a"
preload="$wasmbuilddir/src/wasm-preload"
[ -f "$lib_a" ]        || { echo "build_swipl.sh: missing $lib_a" >&2; exit 1; }
[ -f "$preload/boot.prc" ] || { echo "build_swipl.sh: missing $preload/boot.prc" >&2; exit 1; }

echo "==> assembling the prefix $prefix"
rm -rf "$prefix"
mkdir -p "$prefix/lib" "$prefix/include" "$prefix/home"
cp "$lib_a" "$prefix/lib/"
cp "$wasmbuilddir/home/include/SWI-Prolog.h" \
   "$wasmbuilddir/home/include/SWI-Stream.h" "$prefix/include/"
cp -R "$preload/." "$prefix/home/"

# The home tree's ABI stamp (home/ABI) is produced by `swipl --abi-version`, and
# in a CROSS build that swipl is the native friend (upstream src/CMakeLists.txt:
# `COMMAND ${PROG_SWIPL_FOR_BOOT} --abi-version > ${SWIPL_ABI_FILE}`). So the
# preload ships the HOST engine's stamp, and the wasm engine that loads it
# disagrees — the foreign-predicate signature differs, because this build has
# MULTI_THREADED and USE_SIGNALS off. SWI then prints
#   WARNING: Invalid SWI-Prolog home directory /swipl: ABI mismatch
# on the process's stderr at every PL_initialise. It still runs (boot.prc's own
# QLF version matches), but libinsimul's contract is that nothing reaches the
# host's stderr — errors cross as records on the per-KB channel — and a warning
# per process start is also noise in US-3's startup measurement.
#
# So the stamp is replaced with the one the engine in libswipl.a actually
# reports, read from the cross-built swipl running under node. That is gap G-15:
# recorded, not hidden, and it fixes the FILE rather than muting the check.
node_bin="${EMSDK_NODE:-node}"
command -v "$node_bin" >/dev/null 2>&1 || node_bin=node
if wasm_abi="$("$node_bin" "$wasmbuilddir/src/swipl.js" --abi-version 2>/dev/null | tr -d '\r')" \
   && [ -n "$wasm_abi" ]; then
  host_abi="$(cat "$prefix/home/ABI" 2>/dev/null || echo)"
  if [ "$wasm_abi" != "$host_abi" ]; then
    echo "==> home/ABI: $host_abi (host friend) -> $wasm_abi (wasm engine)  [gap G-15]"
  fi
  printf '%s\n' "$wasm_abi" > "$prefix/home/ABI"
else
  echo "build_swipl.sh: could not read the wasm engine's ABI version;" >&2
  echo "  the prefix keeps the native friend's stamp and SWI will warn at startup (G-15)." >&2
fi

write_pin "$prefix" "${SWIPL_WASM_CMAKE_FLAGS[*]} -DSWIPL_NATIVE_FRIEND=$builddir"

echo
echo "SWI-Prolog $SWIPL_TAG (wasm32-emscripten) assembled:"
echo "  libswipl.a  $(wc -c <"$prefix/lib/libswipl.a" | tr -d ' ') bytes"
echo "  home/       $(du -sk "$prefix/home" | awk '{print $1*1024}') bytes"
echo "Build libinsimul against it with:"
echo "  scripts/build_wasm.sh --engine swipl --swipl-root $prefix"
echo "$prefix"
