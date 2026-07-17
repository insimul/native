#!/usr/bin/env bash
# run_snapshot_parse.sh — driver for the `snapshot_parse` ctest (US-LI4).
#
# Runs the native snapshot fixture through insimul-runtime's real
# prolog-fact-parser.ts (via node's type stripping). The C harness legitimately
# cannot run a TypeScript module, so this shells out to node. It degrades to a
# LOUD [SKIP] (exit 0) only when node or the parser (insimul-runtime submodule)
# is genuinely unavailable — otherwise it runs the cross-check for real and
# fails on any parse mismatch.
#
# Args (baked as absolute paths by CMakeLists.txt):
#   $1 = script (verify_snapshot_ts.mjs)   $2 = fixture .pl
#   $3 = expected .json                    $4 = parser .ts
set -u

SCRIPT="$1"; FIXTURE="$2"; EXPECTED="$3"; PARSER="$4"

if ! command -v node >/dev/null 2>&1; then
  echo "  [SKIP] snapshot_parse: 'node' not found — TS-parser cross-check not run."
  echo "         (The snapshot's format is still verified byte-for-byte by the 'snapshot' ctest.)"
  exit 0
fi

if [ ! -f "$PARSER" ]; then
  echo "  [SKIP] snapshot_parse: prolog-fact-parser.ts not found at:"
  echo "         $PARSER"
  echo "         The insimul-runtime submodule is not checked out. Init it with:"
  echo "         git -c protocol.file.allow=always submodule update --init insimul-runtime"
  exit 0
fi

# node >= 22.6 strips TS types with this flag; on newer node it is a no-op.
exec node --experimental-strip-types "$SCRIPT" "$FIXTURE" "$EXPECTED" "$PARSER"
