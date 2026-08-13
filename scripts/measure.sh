#!/usr/bin/env bash
# measure.sh — THE measurement (tasklist 250 US-3, decision D20 phase 1).
#
# Runs the same four questions against BOTH engines on ALL THREE legs and
# regenerates docs/SWIPL_MEASUREMENT.md from what it finds:
#
#   size       what a host actually ships, per leg (not just the library file:
#              an engine that resolves its Prolog library at run time ships that
#              too, and an engine that compiles it in does not)
#   startup    a COLD engine start plus consult of a real world's .pl set
#   memory     resident set while HOLDING that world's KB
#   corpus     the 76-case conformance corpus, compared BYTE FOR BYTE — engine
#              against engine on each leg, and leg against leg for each engine
#
#   scripts/measure.sh                       # measure everything, rewrite the doc
#   scripts/measure.sh --repeat 9            # more samples (default 5)
#   scripts/measure.sh --no-doc              # leave the doc alone, print tables
#   scripts/measure.sh --skip-build          # trust the build trees as they are
#
# WHY ONE PROCESS PER SAMPLE: both engines bring their runtime up once per
# process (Trealla's internal keepalive instance, SWI's PL_initialise + boot.prc),
# so a second create in the same process would measure a warm engine and flatter
# whichever engine has the larger cold cost. Every sample below is a fresh
# process; the reporter publishes the median and the minimum of N.
#
# WHAT IS FIXED ACROSS ENGINES, so a difference is the engine's:
#   - the ABI            include/insimul.h, one set of 12 functions
#   - the harness        tests/bench.c, rust/insimul/examples/bench.rs,
#                        scripts/wasm_bench.mjs — one per leg, shared by both
#   - the world          bench/world/, a COMMITTED fixture whose manifest this
#                        script verifies before it measures anything
#   - the goals          bench/world/QUERIES.txt, and the solution TOTAL is
#                        cross-checked, so "the same world" is a fact
set -euo pipefail

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
root="$(cd "$here/.." && pwd)"
cd "$root"

repeat=5
update_doc=1
do_build=1
swipl_root="$root/build-swipl/install"
swipl_wasm_root="$root/build-swipl/install-wasm"
while [ $# -gt 0 ]; do
  case "$1" in
    --repeat)           repeat="$2"; shift 2 ;;
    --swipl-root)       swipl_root="$2"; shift 2 ;;
    --swipl-wasm-root)  swipl_wasm_root="$2"; shift 2 ;;
    --no-doc)           update_doc=0; shift ;;
    --skip-build)       do_build=0; shift ;;
    -h|--help)          sed -n '2,30p' "$0"; exit 0 ;;
    *) echo "measure: unknown argument: $1" >&2; exit 2 ;;
  esac
done

# Emscripten is found the same way scripts/build_wasm.sh finds it, so the
# provenance table records a version rather than "unknown" when emsdk is
# installed but not sourced into this shell.
if ! command -v emcc >/dev/null 2>&1; then
  for env_sh in "${EMSDK:-}/emsdk_env.sh" "$HOME/emsdk/emsdk_env.sh"; do
    if [ -f "$env_sh" ]; then
      # shellcheck disable=SC1090
      . "$env_sh" >/dev/null 2>&1 || true
      break
    fi
  done
fi

command -v node  >/dev/null 2>&1 || { echo "measure: node not found on PATH" >&2; exit 1; }
command -v cmake >/dev/null 2>&1 || { echo "measure: cmake not found on PATH" >&2; exit 1; }
command -v cargo >/dev/null 2>&1 || { echo "measure: cargo not found on PATH (the Rust leg is not optional here)" >&2; exit 1; }

world_dir="$root/bench/world"
results="$root/bench/results"
raw="$results/raw"
rm -rf "$raw"
mkdir -p "$raw"

# --------------------------------------------------------------- the world
# A figure quoted against a world nobody can reproduce is an anecdote, so the
# fixture's own generator verifies the committed bytes before anything is timed.
echo "measure: verifying the measured world (bench/world/)"
node "$world_dir/generate.mjs" --check
# Consult order is the manifest's, not the shell's glob order. (Word-split on
# purpose: the generator names these files, and none of them contains a space.)
world_files="$(node -e '
  const m = require("./bench/world/MANIFEST.json");
  console.log(m.consultOrder.map((f) => "bench/world/" + f).join(" "));
')"
queries="$world_dir/QUERIES.txt"

# ----------------------------------------------------------- the build trees
# One source tree, four builds: {native, wasm} x {default engine, spike engine}.
# Plain functions rather than associative arrays: /usr/bin/env bash is 3.2 on
# macOS, where `declare -A` is a syntax error at PARSE time — the whole script
# would die before its first line ran.
native_tree() {
  case "$1" in
    trealla) echo "$root/build" ;;
    swipl)   echo "$root/build-swipl-native" ;;
  esac
}
wasm_tree() {
  case "$1" in
    trealla) echo "$root/build-wasm" ;;
    swipl)   echo "$root/build-wasm-swipl" ;;
  esac
}

if [ "$do_build" -eq 1 ]; then
  echo "measure: building the native legs"
  cmake -B "$(native_tree trealla)" >/dev/null
  cmake --build "$(native_tree trealla)" -j >/dev/null
  cmake -B "$(native_tree swipl)" -DINSIMUL_ENGINE=swipl \
        -DINSIMUL_SWIPL_ROOT="$swipl_root" >/dev/null
  cmake --build "$(native_tree swipl)" -j >/dev/null

  echo "measure: building the wasm legs"
  "$here/build_wasm.sh" --build-dir "$(wasm_tree trealla)" --no-test >/dev/null
  "$here/build_wasm.sh" --engine swipl --swipl-root "$swipl_wasm_root" \
        --build-dir "$(wasm_tree swipl)" --no-test >/dev/null
fi

for e in trealla swipl; do
  [ -x "$(native_tree "$e")/insimul_bench" ] || { echo "measure: $(native_tree "$e")/insimul_bench is missing — drop --skip-build" >&2; exit 1; }
  [ -f "$(wasm_tree "$e")/insimul.mjs" ]     || { echo "measure: $(wasm_tree "$e")/insimul.mjs is missing — drop --skip-build" >&2; exit 1; }
done

# ------------------------------------------------------------------- the host
# Recorded beside the figures: a number without its host is not a measurement.
#
# THE LOAD AVERAGE IS PART OF THE HOST. A run on a busy machine inflates the
# slower engine's numbers most (it has more phases to be descheduled in), which
# is exactly the direction that would make this comparison lie. It is recorded
# in the published provenance table and warned about here rather than being
# turned into a hard failure: a CI box is legitimately busier than a laptop, and
# a gate nobody can satisfy gets muted.
ncpu="$(getconf _NPROCESSORS_ONLN 2>/dev/null || echo 1)"
load1="$(uptime | sed -e 's/.*load averages*: *//' -e 's/[, ].*//')"
if [ -n "$load1" ] && awk -v l="$load1" -v n="$ncpu" 'BEGIN { exit !(l > n) }'; then
  echo "measure: WARNING — 1-minute load average is $load1 on $ncpu CPUs." >&2
  echo "  Timings taken now will be noisy and are not comparable with a quiet run." >&2
fi
{
  echo '{'
  printf '  "uname": "%s",\n' "$(uname -srm)"
  printf '  "cc": "%s",\n' "$(${CC:-cc} --version 2>/dev/null | head -1)"
  printf '  "cmake": "%s",\n' "$(cmake --version | head -1)"
  printf '  "node": "%s",\n' "$(node --version)"
  printf '  "cargo": "%s",\n' "$(cargo --version)"
  printf '  "emcc": "%s",\n' "$(emcc --version 2>/dev/null | head -1 || echo unknown)"
  printf '  "repeat": %s,\n' "$repeat"
  printf '  "cpus": %s,\n' "$ncpu"
  printf '  "loadAverage1min": "%s",\n' "$load1"
  printf '  "swiplRoot": "%s",\n' "$swipl_root"
  printf '  "swiplWasmRoot": "%s"\n' "$swipl_wasm_root"
  echo '}'
} > "$raw/host.json"

# ------------------------------------------------------------- what is shipped
# The artifact list per engine, resolved by the reporter (which dedupes by real
# path and sums — SWI's shared library lives INSIDE its home tree, so adding the
# two naively would count it twice).
#
# `runtime=` lines come from the build's own link manifest (insimul-link.txt),
# so this script names no engine: an engine that needs nothing at run time
# simply contributes no runtime lines, which is itself the finding.
for e in trealla swipl; do
  tree="$(native_tree "$e")"
  {
    echo "static=$tree/libinsimul.a"
    for f in "$tree"/libinsimul.dylib "$tree"/libinsimul.so; do
      [ -f "$f" ] && echo "shared=$f"
    done
    if [ -f "$tree/insimul-link.txt" ]; then
      # A library the archive only REFERENCES ships beside it, and so does any
      # directory the engine reads at run time.
      awk -F= '/^search=/{dir=$2} /^lib=/{print "runtime=" dir "/lib" $2 ".dylib"} /^runtime=/{print}' \
        "$tree/insimul-link.txt"
    fi
  } > "$raw/paths-$e.txt"
done

# ------------------------------------------------------------------ the legs
run_native() {  # run_native <engine>
  local e="$1" tree i
  tree="$(native_tree "$e")"
  echo "measure: native leg, engine $e ($repeat cold processes)"
  for ((i = 0; i < repeat; i++)); do
    "$tree/insimul_bench" --label native --json "$raw/native-$e.jsonl" \
      --queries "$queries" $world_files >/dev/null
  done
}

# The Rust leg links libinsimul.a out of the SAME build tree the native leg
# measured, so "rust vs native" is one binding layer, not two engines.
run_rust() {  # run_rust <engine>
  local e="$1" tree i bin timing
  tree="$(native_tree "$e")"
  echo "measure: rust leg, engine $e ($repeat cold processes)"
  INSIMUL_LIB_DIR="$tree" cargo build --manifest-path rust/Cargo.toml -p insimul \
    --release --example bench >/dev/null 2>&1
  bin="$root/rust/target/release/examples/bench"
  [ -x "$bin" ] || { echo "measure: the rust bench example did not build" >&2; exit 1; }
  # The leg's own binary size, captured NOW: both engines build to the same
  # path, so by the time the reporter runs this file is the last engine's.
  wc -c < "$bin" | tr -d ' ' > "$raw/rustbin-$e.txt"
  : > "$raw/rust-$e.rss"
  for ((i = 0; i < repeat; i++)); do
    # Peak RSS comes from the system timer rather than from inside the process:
    # the insimul crates are deliberately dependency-free (no libc), and this is
    # the same quantity getrusage(RUSAGE_SELF).ru_maxrss gives the native leg.
    timing="$( { /usr/bin/time -l "$bin" --label rust --json "$raw/rust-$e.jsonl" \
                   --queries "$queries" $world_files >/dev/null; } 2>&1 )" || {
      echo "measure: the rust bench FAILED:" >&2; echo "$timing" >&2; exit 1; }
    # BSD /usr/bin/time -l reports bytes; GNU /usr/bin/time -v reports kilobytes.
    echo "$timing" | awk '
      /maximum resident set size/ { print $1; found=1 }
      /Maximum resident set size/ { print $NF * 1024; found=1 }
      END { if (!found) print 0 }' | head -1 >> "$raw/rust-$e.rss"
  done
}

run_wasm() {  # run_wasm <engine>
  local e="$1" dir i
  dir="$(wasm_tree "$e")"
  echo "measure: wasm leg, engine $e ($repeat cold processes)"
  for ((i = 0; i < repeat; i++)); do
    node "$here/wasm_bench.mjs" "$dir" --label wasm --json "$raw/wasm-$e.jsonl" \
      --queries "$queries" $world_files >/dev/null
  done
  node "$here/wasm_payload.mjs" "$dir" --json > "$raw/payload-$e.json"
}

for e in trealla swipl; do
  run_native "$e"
  run_rust "$e"
  run_wasm "$e"
done

# ------------------------------------------------------- the conformance corpus
# Every leg of every engine emits one JSON-Lines record per case carrying the RAW
# strings insimul_query_next() returned. The reporter diffs them two ways: engine
# vs engine on each leg (does SWI answer byte for byte what ships today?) and leg
# vs leg for each engine (does SWI hold the cross-leg bar the program earned?).
echo "measure: running the conformance corpus on 6 legs (2 engines x 3 legs)"
for e in trealla swipl; do
  INSIMUL_CONFORMANCE_JSON="$raw/conf-native-$e.jsonl" \
    "$(native_tree "$e")/insimul_conformance" > "$raw/conf-native-$e.log" 2>&1 || {
      echo "measure: the native conformance leg FAILED for $e:" >&2
      cat "$raw/conf-native-$e.log" >&2; exit 1; }

  INSIMUL_CONFORMANCE_JSON="$raw/conf-wasm-$e.jsonl" \
    node tests/wasm_conformance.mjs "$(wasm_tree "$e")/insimul.mjs" \
      > "$raw/conf-wasm-$e.log" 2>&1 || {
      echo "measure: the wasm conformance leg FAILED for $e:" >&2
      cat "$raw/conf-wasm-$e.log" >&2; exit 1; }

  INSIMUL_LIB_DIR="$(native_tree "$e")" INSIMUL_CONFORMANCE_JSON="$raw/conf-rust-$e.jsonl" \
    cargo test --manifest-path rust/Cargo.toml -p insimul --test conformance \
      -- --nocapture prolog_corpus_passes > "$raw/conf-rust-$e.log" 2>&1 || {
      echo "measure: the rust conformance leg FAILED for $e:" >&2
      cat "$raw/conf-rust-$e.log" >&2; exit 1; }
done

# ---------------------------------------------------------------- the report
report_args=("$raw" "$results/measurements.json")
[ "$update_doc" -eq 1 ] && report_args+=("--doc" "$root/docs/SWIPL_MEASUREMENT.md")
node "$here/measure_report.mjs" "${report_args[@]}"
