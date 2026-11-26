#!/usr/bin/env bash
# run_corebridge_cases.sh — driver for the JS-side corebridge case ctests.
#
#   run_corebridge_cases.sh js     <repo>                      the JS leg alone
#   run_corebridge_cases.sh parity <repo> <c-binary> <out-dir> the C leg writing raw
#                                                              records, then the JS
#                                                              leg diffing against them
#   run_corebridge_cases.sh redaction-order <repo>             the build-log redaction
#                                                              order witness
#                                                              (tests/build_log_redaction_order.mjs)
#
# The C leg alone is its own ctest (corebridge_cases) and needs nothing but the
# build. The JS leg needs node; without it this driver prints a LOUD [SKIP] and
# exits 0 — the same convention as core_vendor. Read the output: a [SKIP]
# asserted nothing.
set -u
mode="$1"
repo="$2"

if ! command -v node >/dev/null 2>&1; then
  [ "$mode" = redaction-order ] && { echo "  [SKIP] build_log_redaction_order: 'node' not found — the order witness did NOT run."; exit 0; }
  echo "  [SKIP] corebridge_cases_${mode}: 'node' not found — the JS leg of the corebridge"
  echo "         method gate did NOT run. Install node to run it."
  exit 0
fi

case "$mode" in
  js)
    exec node "$repo/tests/corebridge_cases.mjs"
    ;;
  redaction-order)
    exec node "$repo/tests/build_log_redaction_order.mjs"
    ;;
  parity)
    binary="$3"
    out="$4/corebridge-cases-c.jsonl"
    rm -f "$out"
    INSIMUL_CORE_CASES_JSON="$out" "$binary" \
      "$repo/corebridge/vendor/core/cases" "$repo/corebridge/tests/cases" >/dev/null
    status=$?
    if [ "$status" -ne 0 ]; then
      echo "corebridge_cases_parity: the C leg failed (exit $status) — run ctest -R '^corebridge_cases$' for its output" >&2
      exit 1
    fi
    exec node "$repo/tests/corebridge_cases.mjs" --parity "$out"
    ;;
  *)
    echo "usage: run_corebridge_cases.sh js|parity|redaction-order <repo> [<c-binary> <out-dir>]" >&2
    exit 2
    ;;
esac
