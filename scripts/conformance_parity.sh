#!/usr/bin/env bash
# conformance_parity.sh — prove the THREE legs agree on the golden Prolog
# conformance corpus: native C, wasm, and Rust (US-2 of tasklists 2 and 251).
#
# Each leg already gates itself (`ctest -R conformance` natively,
# `wasm_conformance` under scripts/build_wasm.sh, `cargo test` for Rust). This
# script is the stronger claim: it runs ALL THREE over the same corpus with
# INSIMUL_CONFORMANCE_JSON set, so each emits one JSON-Lines record per case
# carrying the RAW solution strings the ABI returned — then diffs them case by
# case. "Every leg is green" would still permit a divergence inside an unordered
# case or in error text; a byte-level diff of the engine's own output does not.
#
#   scripts/conformance_parity.sh                 # build what's missing, compare
#   scripts/conformance_parity.sh --keep          # keep the .jsonl dumps
#   scripts/conformance_parity.sh --no-rust       # skip the Rust leg (no cargo)
#
# Exit status: 0 only if every leg executed the same non-zero number of cases,
# all passed, and every record matches. Anything else is a loud failure — a
# divergence must be documented in conformance/WASM_PARITY.md, never skipped.
set -euo pipefail

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
root="$(cd "$here/.." && pwd)"
cd "$root"

keep=0
with_rust=1
native_build="build"
wasm_build="build-wasm"
while [ $# -gt 0 ]; do
  case "$1" in
    --keep)         keep=1; shift ;;
    --no-rust)      with_rust=0; shift ;;
    --native-build) native_build="$2"; shift 2 ;;
    --wasm-build)   wasm_build="$2";   shift 2 ;;
    -h|--help)      sed -n '2,20p' "$0"; exit 0 ;;
    *) echo "conformance_parity: unknown argument: $1" >&2; exit 2 ;;
  esac
done

if ! command -v cmake >/dev/null 2>&1; then
  for d in "$HOME"/Library/Python/*/bin /opt/homebrew/bin /usr/local/bin; do
    [ -x "$d/cmake" ] && PATH="$d:$PATH"
  done
  export PATH
fi
command -v cmake >/dev/null 2>&1 || { echo "conformance_parity: cmake not found on PATH" >&2; exit 1; }
command -v node  >/dev/null 2>&1 || { echo "conformance_parity: node not found on PATH" >&2; exit 1; }

out_dir="$(mktemp -d)"
native_json="$out_dir/native.jsonl"
wasm_json="$out_dir/wasm.jsonl"
rust_json="$out_dir/rust.jsonl"
cleanup() { [ "$keep" -eq 1 ] || rm -rf "$out_dir"; }
trap cleanup EXIT

# --------------------------------------------------------------- native leg
native_bin="$native_build/insimul_conformance"
if [ ! -x "$native_bin" ]; then
  echo "conformance_parity: building the native leg ($native_bin)"
  cmake -B "$native_build" >/dev/null
  cmake --build "$native_build" --target insimul_conformance -j >/dev/null
fi
echo "conformance_parity: running the NATIVE leg"
native_out="$out_dir/native.log"
INSIMUL_CONFORMANCE_JSON="$native_json" "$native_bin" >"$native_out" 2>&1 || {
  echo "conformance_parity: the native conformance leg FAILED:" >&2
  cat "$native_out" >&2
  exit 1
}
native_summary="$(grep -E '^conformance: [0-9]+ files' "$native_out")"

# ----------------------------------------------------------------- wasm leg
glue="$wasm_build/insimul.mjs"
if [ ! -f "$glue" ]; then
  echo "conformance_parity: building the wasm leg ($glue)"
  "$here/build_wasm.sh" --build-dir "$wasm_build" --no-test
fi
echo "conformance_parity: running the WASM leg"
wasm_out="$out_dir/wasm.log"
INSIMUL_CONFORMANCE_JSON="$wasm_json" node tests/wasm_conformance.mjs "$glue" >"$wasm_out" 2>&1 || {
  echo "conformance_parity: the wasm conformance leg FAILED:" >&2
  cat "$wasm_out" >&2
  exit 1
}
wasm_summary="$(grep -E '^conformance: [0-9]+ files' "$wasm_out")"

# ----------------------------------------------------------------- rust leg
# The Rust leg is a third consumer of the same ABI (rust/insimul), so it catches
# a divergence the C and wasm legs could share — they are the same C code.
rust_summary=""
if [ "$with_rust" -eq 1 ]; then
  if command -v cargo >/dev/null 2>&1; then
    echo "conformance_parity: running the RUST leg"
    rust_out="$out_dir/rust.log"
    INSIMUL_CONFORMANCE_JSON="$rust_json" \
      cargo test --manifest-path rust/Cargo.toml -p insimul --test conformance \
        -- --nocapture prolog_corpus_passes >"$rust_out" 2>&1 || {
      echo "conformance_parity: the rust conformance leg FAILED:" >&2
      cat "$rust_out" >&2
      exit 1
    }
    rust_summary="$(grep -E '^conformance: [0-9]+ files' "$rust_out")"
  else
    # A missing toolchain is reported, never silently skipped.
    echo "conformance_parity: cargo not found — the RUST leg was NOT run." >&2
    echo "  Install a Rust toolchain or pass --no-rust to make that explicit." >&2
    exit 1
  fi
fi

# ---------------------------------------------------------------- compare
echo
echo "  native: $native_summary"
echo "  wasm:   $wasm_summary"
[ -n "$rust_summary" ] && echo "  rust:   $rust_summary"

native_cases="$(wc -l <"$native_json" | tr -d ' ')"
wasm_cases="$(wc -l <"$wasm_json" | tr -d ' ')"

if [ "$native_cases" -eq 0 ]; then
  echo "conformance_parity: the native leg emitted ZERO case records — refusing to compare nothing." >&2
  exit 2
fi
if [ "$wasm_cases" -lt "$native_cases" ]; then
  echo "conformance_parity: the wasm leg ran $wasm_cases cases but native ran $native_cases." >&2
  echo "  A wasm run that covers less than native is a FAILURE, not a pass." >&2
  exit 1
fi
if [ "$native_summary" != "$wasm_summary" ]; then
  echo "conformance_parity: native and wasm disagree on the summary line." >&2
  exit 1
fi
if [ -n "$rust_summary" ] && [ "$native_summary" != "$rust_summary" ]; then
  echo "conformance_parity: native and rust disagree on the summary line." >&2
  exit 1
fi

# Per-case, byte-for-byte on the engine's own solution text.
compare_leg() {  # compare_leg <label> <jsonl>
  if diff -u "$native_json" "$2" >"$out_dir/diff-$1.txt"; then
    return 0
  fi
  echo >&2
  echo "conformance_parity: DIVERGENCE — the $1 leg does not match native." >&2
  echo "  Each line below is one case record (area/name/status/solutions);" >&2
  echo "  '-' is native, '+' is $1. Document every divergence in" >&2
  echo "  conformance/WASM_PARITY.md — do NOT skip it." >&2
  echo >&2
  cat "$out_dir/diff-$1.txt" >&2
  return 1
}

status=0
compare_leg wasm "$wasm_json" || status=1
if [ -n "$rust_summary" ]; then
  rust_cases="$(wc -l <"$rust_json" | tr -d ' ')"
  if [ "$rust_cases" -ne "$native_cases" ]; then
    echo "conformance_parity: the rust leg ran $rust_cases cases but native ran $native_cases." >&2
    status=1
  else
    compare_leg rust "$rust_json" || status=1
  fi
fi
[ "$status" -eq 0 ] || exit 1

echo
if [ -n "$rust_summary" ]; then
  echo "conformance_parity: PASS — $native_cases cases; native, wasm and rust agree on"
  echo "  every case, including the raw solution text the ABI produced."
else
  echo "conformance_parity: PASS — $native_cases cases, native and wasm agree on every"
  echo "  case, including the raw solution text the ABI produced (rust leg skipped)."
fi
exit 0
