#!/usr/bin/env bash
# run_radiant.sh — ctest driver for the radiant bridge gate (tasklist 104, US-2).
#
# It exists for ONE reason: to apply this repo's corpus-resolution rule
# (CLAUDE.md — env → vendored → sibling, hard-fail on missing/empty) at RUN time
# without editing tests/radiant/radiant_bridge.cpp, which is a byte-for-byte copy
# of insimul-godot's gate. Keeping that file diff-identical is what lets us claim
# the two repos compare the corpus with literally the same code; the resolution
# plumbing therefore lives out here instead.
#
#   $1  the compiled gate binary
#   $2  the corpus directory CMake resolved at configure time (the default)
#   $3  --source leg: `core` (the adopted implementation) or `none`
#
# INSIMUL_RADIANT_DIR overrides $2, exactly as INSIMUL_CONFORMANCE_DIR overrides
# the prolog corpus for the C/Rust/wasm legs.
#
# UNLIKE tests/run_snapshot_parse.sh and tests/run_core_vendor.sh, this driver
# NEVER skips. Its dependencies (the corpus, the bridge) are both in-repo, so a
# missing one is a broken checkout, not an absent optional tool — and a gate that
# quietly passes having executed nothing is the failure US-2 exists to prevent.
set -euo pipefail

if [ "$#" -lt 3 ]; then
	echo "usage: run_radiant.sh <gate-binary> <default-corpus-dir> <core|none>" >&2
	exit 2
fi

binary="$1"
default_dir="$2"
source_leg="$3"

dir="${INSIMUL_RADIANT_DIR:-$default_dir}"

if [ ! -d "$dir" ]; then
	echo "error: radiant corpus directory not found: $dir" >&2
	echo "       set INSIMUL_RADIANT_DIR, or restore conformance/radiant/" >&2
	exit 1
fi

shopt -s nullglob
cases=("$dir"/*.json)
shopt -u nullglob
if [ "${#cases[@]}" -eq 0 ]; then
	echo "error: radiant corpus directory holds no *.json: $dir" >&2
	echo "       the gate would execute NOTHING — refusing to pass vacuously" >&2
	exit 1
fi

exec "$binary" --source "$source_leg" "$dir"
