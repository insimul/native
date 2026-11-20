#!/usr/bin/env bash
# run_chat_cefr_cases.sh — driver for the `chat_cefr_cases` and `chat_cefr_cases_negative` ctests
# (PL.native-chat-cefr-rows, slice 1).
#
# Runs corebridge/tools/chat-cefr-cases.mjs: --check holds the committed transcription
# (corebridge/tests/cases/chat-cefr-corpus.json) to the corpus it is the mapping of
# (corebridge/tests/chat-cefr/chat-cefr-corpus.json); --check-negative perturbs the corpus in
# every family and requires each perturbation to be named. The rows themselves are run over the
# transcription by corebridge_cases (C) and corebridge_cases_js (JS), diffed by
# corebridge_cases_parity.
#
# Degrades to a LOUD [SKIP] (exit 0) only when node is genuinely absent, as run_core_vendor.sh does.
#
# Args (baked as absolute paths by CMakeLists.txt): $1 = chat-cefr-cases.mjs, $2 = --check or --check-negative.
set -u
TOOL="$1"
MODE="${2:---check}"
NAME=chat_cefr_cases
[ "$MODE" = "--check-negative" ] && NAME=chat_cefr_cases_negative
if ! command -v node >/dev/null 2>&1; then
  echo "  [SKIP] $NAME: 'node' not found — the chat-cefr transcription was NOT checked. Install node to run this gate."
  exit 0
fi
[ -f "$TOOL" ] || { echo "$NAME: tool not found at $TOOL" >&2; exit 1; }
exec node "$TOOL" "$MODE"
