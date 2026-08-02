#!/usr/bin/env bash
# build_wasm.sh — US-1 Emscripten/WebAssembly build for libinsimul.
#
# Mirrors scripts/package.sh: run it from anywhere, it resolves paths relative
# to the repo root and needs no arguments. It configures the SAME CMakeLists.txt
# the native build uses, through `emcmake`, into a separate build tree so the
# native artifacts (build/libinsimul.a, build/libinsimul.dylib) are untouched.
#
#   scripts/build_wasm.sh              # configure, build, run the wasm tests
#   scripts/build_wasm.sh --no-test    # build only
#   scripts/build_wasm.sh --build-dir build-wasm
#
# The test run is `wasm_smoke` + `wasm_conformance` — the latter drives the SAME
# golden corpus the native ctest does, so the parity gate cannot rot unrun. To
# compare the two builds case by case, use scripts/conformance_parity.sh.
#
# Output (build-wasm/):
#   insimul.mjs    ES-module glue (a -sMODULARIZE factory; see wasm/insimul-api.mjs)
#   insimul.wasm   the engine
#
# REQUIREMENTS
#   Emscripten >= 3.1.50 on PATH (`emcc`). Get it with emsdk:
#       git clone https://github.com/emscripten-core/emsdk && cd emsdk
#       ./emsdk install latest && ./emsdk activate latest
#       source ./emsdk_env.sh
#   If emcc is not on PATH this script sources $EMSDK/emsdk_env.sh or
#   ~/emsdk/emsdk_env.sh when either exists.
#
# The only network access is the existing Trealla FetchContent clone (shared
# with the native build tree's pin — see THIRD_PARTY.md). Nothing else is
# downloaded at build time.
set -euo pipefail

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
root="$(cd "$here/.." && pwd)"
cd "$root"

build_dir="build-wasm"
run_tests=1
while [ $# -gt 0 ]; do
  case "$1" in
    --build-dir) build_dir="$2"; shift 2 ;;
    --no-test)   run_tests=0;    shift ;;
    -h|--help)   sed -n '2,30p' "$0"; exit 0 ;;
    *) echo "build_wasm: unknown argument: $1" >&2; exit 2 ;;
  esac
done

# ------------------------------------------------------------------- emscripten
if ! command -v emcc >/dev/null 2>&1; then
  for env_sh in "${EMSDK:-}/emsdk_env.sh" "$HOME/emsdk/emsdk_env.sh"; do
    if [ -f "$env_sh" ]; then
      # shellcheck disable=SC1090
      source "$env_sh" >/dev/null 2>&1 || true
      break
    fi
  done
fi
if ! command -v emcc >/dev/null 2>&1; then
  echo "build_wasm: emcc not found on PATH." >&2
  sed -n '/^# REQUIREMENTS/,/^#$/p' "$0" >&2
  exit 1
fi
echo "build_wasm: $(emcc --version 2>/dev/null | head -n1)"

# ---------------------------------------------------------------------- cmake
# cmake may live in a user pip install or Homebrew rather than on the default
# PATH (mirrors scripts/package.sh).
if ! command -v cmake >/dev/null 2>&1; then
  for d in "$HOME"/Library/Python/*/bin /opt/homebrew/bin /usr/local/bin; do
    [ -x "$d/cmake" ] && PATH="$d:$PATH"
  done
  export PATH
fi
command -v cmake >/dev/null 2>&1 || { echo "build_wasm: cmake not found on PATH" >&2; exit 1; }

semver="$(head -n1 VERSION | tr -d '[:space:]')"
echo "build_wasm: building insimul $semver for wasm32 into $build_dir/"

# ------------------------------------------------------------- configure+build
# emcmake injects the Emscripten toolchain file, which is what makes
# CMAKE_SYSTEM_NAME=Emscripten (and therefore the EMSCRIPTEN branches in
# CMakeLists.txt / cmake/wasm.cmake) take effect.
emcmake cmake -B "$build_dir" -DCMAKE_BUILD_TYPE=Release
cmake --build "$build_dir" --target insimul_wasm -j

glue="$build_dir/insimul.mjs"
binary="$build_dir/insimul.wasm"
for f in "$glue" "$binary"; do
  [ -f "$f" ] || { echo "build_wasm: expected artifact missing: $f" >&2; exit 1; }
done

# --------------------------------------------------------------------- tests
if [ "$run_tests" -eq 1 ]; then
  echo "build_wasm: running the wasm test suite"
  ctest --test-dir "$build_dir" --output-on-failure
fi

echo "build_wasm: --- artifacts ---"
ls -l "$glue" "$binary" | awk '{printf "  %-10s %s bytes\n", $NF, $5}'
echo "build_wasm: OK"
