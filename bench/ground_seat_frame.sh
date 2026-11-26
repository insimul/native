#!/usr/bin/env bash
# bench/ground_seat_frame.sh <build-dir> — times traversal.groundSeating.frame against the single rows it composes
# (PL.native-ground-seat-batch) and writes bench/results/ground-seat-frame.json.
#
# The figures come from <build-dir>/insimulcore_ground_seat_bench (tests/ground_seat_bench.cpp): 10 carried bodies,
# 600 frames a run, 9 runs a leg, the median and the fastest run in ms per frame. The bench exits non-zero, and
# nothing is written, if any frame's answer differs from the single rows' answers composed. The host lines say what
# the numbers were measured on; a loaded host inflates both legs, so the load average is recorded beside them.
set -euo pipefail
[ $# -eq 1 ] || { echo "usage: bench/ground_seat_frame.sh <build-dir>" >&2; exit 2; }
BUILD="$1"
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
OUT="$HERE/results/ground-seat-frame.json"
BIN="$BUILD/insimulcore_ground_seat_bench"
[ -x "$BIN" ] || { echo "ground_seat_frame: $BIN is not built (cmake --build $BUILD)" >&2; exit 2; }
RESULT="$("$BIN" --bodies 10 --frames 600 --repeat 9)"
UNAME="$(uname -sm)"
CC_LINE="$( (${CC:-cc} --version 2>/dev/null || true) | head -n 1)"
CPUS="$(getconf _NPROCESSORS_ONLN 2>/dev/null || echo unknown)"
LOAD="$( (sysctl -n vm.loadavg 2>/dev/null | awk '{print $2}') || true)"
[ -n "$LOAD" ] || LOAD="$(awk '{print $1}' /proc/loadavg 2>/dev/null || echo unknown)"
TMP="$(mktemp)"
{
  printf '{\n'
  printf '  "generatedBy": "bench/ground_seat_frame.sh -> insimulcore_ground_seat_bench (tests/ground_seat_bench.cpp)",\n'
  printf '  "what": "traversal.groundSeating.frame (one call a frame) against .retarget + .offsetAt per body per frame, 10 carried bodies, through insimulcore.h; every frame'"'"'s answers checked byte for byte equal before timing",\n'
  printf '  "host": { "uname": "%s", "cc": "%s", "cpus": "%s", "loadAverage1min": "%s" },\n' "$UNAME" "$CC_LINE" "$CPUS" "$LOAD"
  printf '  "result": %s\n' "$RESULT"
  printf '}\n'
} > "$TMP"
mv "$TMP" "$OUT"
cat "$OUT"
