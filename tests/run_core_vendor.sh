#!/usr/bin/env bash
# run_core_vendor.sh — driver for the `core_vendor` ctest (tasklist 104, US-1).
#
# Runs corebridge/tools/vendor-core-bundle.mjs --check: the sha256 drift guard
# over the vendored `@insimul/core` bundle. It is written in node because the
# tool that PRODUCES the bundle is (it drives esbuild), and a checker that does
# not share the producer's code is a second implementation waiting to disagree.
#
# It degrades to a LOUD [SKIP] (exit 0) only when node is genuinely absent —
# same convention as snapshot_parse. Read the output: a [SKIP] asserted nothing,
# and the vendored bundle is exactly the kind of artifact that rots unchecked.
#
# INSIMUL_CORE_DIR (optional) points at a `packages/core` checkout; when set it
# is passed through as --core, which additionally re-bundles from core and diffs.
# That is the real drift check, and it is why the tool takes the flag at all —
# but it needs core's node_modules, which a standalone checkout does not have.
#
# Args (baked as an absolute path by CMakeLists.txt):
#   $1 = vendor-core-bundle.mjs
set -u

TOOL="$1"

if ! command -v node >/dev/null 2>&1; then
  echo "  [SKIP] core_vendor: 'node' not found — the vendored @insimul/core bundle"
  echo "         was NOT checked for drift. Install node to run this gate."
  exit 0
fi

if [ ! -f "$TOOL" ]; then
  echo "core_vendor: vendoring tool not found at $TOOL" >&2
  exit 1
fi

if [ -n "${INSIMUL_CORE_DIR:-}" ]; then
  exec node "$TOOL" --check --core "$INSIMUL_CORE_DIR"
fi
exec node "$TOOL" --check
