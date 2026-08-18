#!/usr/bin/env bash
# run_open_boundary.sh — ctest `open_boundary` (US-2, `242-pre-open-native`).
#
# The pre-open CONTENT + DEPENDENCY audits, run as a gate rather than as a
# one-off. US-1 audited the history once, because history is written once. These
# two are properties of the TREE: they must hold at every future commit, and the
# commit that breaks one will not be the commit that is thinking about
# open-sourcing. So the deliverable is not a report — it is a gate, and a gate
# that has been watched failing.
#
# Five checks:
#
#   A. the gate is FALSIFIED first — tests/open_boundary_selftest.mjs fires every
#      rule in scripts/open-boundary.rules.json at a synthetic positive and
#      checks each one leaves its near miss alone.
#   B. this repository's real tree passes: every finding classified, no stale
#      allowance, exit 0.
#   C. the committed report (docs/pre-open/open-boundary.json) still describes
#      this tree — the same findings a fresh run produces.
#   D. NEGATIVE CONTROL, live, on a copy of the REAL tree: five violations are
#      injected at once — a closed pack, a closed-repo import, an #include that
#      walks out of the repository, a git dependency and a build-time fetch —
#      the gate must exit non-zero and name all of them, and must go back to
#      exit 0 when they are removed. This is the acceptance criterion's "inject a
#      violation, watch it fail, remove it", executed every time the gate runs
#      rather than written down once.
#   E. the gate is WIRED: CMakeLists.txt still runs it. A gate nobody calls is a
#      file, not a check.
#
# Degrades to a LOUD [SKIP] only when node is genuinely absent — same convention
# as history_scan, snapshot_parse and core_vendor. Read the output: a [SKIP]
# asserted nothing.
#
# Usage: run_open_boundary.sh <source-dir>
set -uo pipefail

src="${1:?usage: run_open_boundary.sh <source-dir>}"
fails=0

ok()  { printf '  ok   %s\n' "$1"; }
bad() { printf '  FAIL %s\n' "$1"; fails=$((fails + 1)); }

if ! command -v node >/dev/null 2>&1; then
    echo "  [SKIP] open_boundary: 'node' not found — the pre-open content + dependency"
    echo "         audits were NOT run. They are what says no closed pack is vendored"
    echo "         here and nothing from insimul-backend or insimul-web is reachable."
    exit 0
fi
if ! command -v git >/dev/null 2>&1; then
    printf 'open_boundary: FAIL — git not found; the audit reads the tracked set and this test does not skip\n'
    exit 1
fi

check="$src/scripts/check-open-boundary.mjs"
rules="$src/scripts/open-boundary.rules.json"
report="$src/docs/pre-open/open-boundary.json"
for f in "$check" "$rules" "$report" "$src/tests/open_boundary_selftest.mjs"; do
    [ -f "$f" ] || { printf 'open_boundary: FAIL — %s not found\n' "$f"; exit 1; }
done

tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT

# ── A. falsify the gate ──────────────────────────────────────────────────────

if node "$src/tests/open_boundary_selftest.mjs" --rules "$rules" > "$tmp/selftest.log" 2>&1; then
    ok "A: gate falsified — $(grep -c '^  ok' "$tmp/selftest.log") self-test check(s) passed"
else
    bad "A: the gate self-test FAILED"
    sed -n '/FAIL/,+1p' "$tmp/selftest.log" | sed 's/^/       /'
fi

# ── B. the real tree ─────────────────────────────────────────────────────────

if node "$check" "$src" --rules "$rules" > "$tmp/audit.log" 2>&1; then
    ok "B: $(sed 's/^check-open-boundary: [^ ]* —/tree:/' "$tmp/audit.log" | head -1)"
else
    bad "B: the content + dependency audit FAILED on this repository"
    sed 's/^/       /' "$tmp/audit.log"
fi

# ── C. the committed report still describes this tree ────────────────────────
#
# Findings only, and without line numbers, deliberately: `gitHead` changes with
# every commit, the coverage counts change whenever anybody adds a file, and a
# finding slides down its file whenever anybody adds a comment above it. Compare
# the whole document and the gate goes red for reasons that are not findings —
# and a gate that goes red for a non-reason gets muted, which is the failure mode
# this repository keeps re-learning. What must not drift silently is WHAT WAS
# FOUND, in which file, and how it was classified; a NEW finding, a finding in a
# new file, and a changed classification all still fail this check.

node "$check" "$src" --rules "$rules" --report "$tmp/fresh.json" > /dev/null 2>&1
if node --input-type=module -e "
import fs from 'node:fs';
const key = (r) => JSON.stringify(
  [...r.content, ...r.dependency]
    .map((f) => [f.rule, f.path, f.specifier ?? f.packId ?? null, f.classification])
    .sort(),
);
const committed = JSON.parse(fs.readFileSync('$report', 'utf8'));
const fresh = JSON.parse(fs.readFileSync('$tmp/fresh.json', 'utf8'));
if (key(committed) !== key(fresh)) {
  console.error('the committed report and a fresh run disagree');
  process.exit(1);
}
console.log(\`\${committed.content.length} content + \${committed.dependency.length} dependency finding(s), all classified keep\`);
" > "$tmp/report.log" 2>&1; then
    ok "C: committed report matches a fresh run — $(cat "$tmp/report.log")"
else
    bad "C: docs/pre-open/open-boundary.json is STALE — regenerate it with --report"
    sed 's/^/       /' "$tmp/report.log"
fi

# ── D. negative control: the real tree, with five violations in it ───────────
#
# A copy of the TRACKED tree, re-inited as a git repository so the gate walks it
# the same way it walks the real one.
#
# `git ls-files` and not `git archive HEAD`, deliberately. The archive is the
# tree at the last COMMIT, while the rules file this check runs with is the one
# in the working tree — so any allowance added but not yet committed matches
# nothing in the copy and the gate fails check D for a reason that is not a
# finding. That is precisely the false red this file argues against everywhere
# else, and it fired the first time this check ran. The tracked set as it stands
# on disk is both what the audit sees and what a commit would publish.

dirty="$tmp/dirty"
mkdir -p "$dirty"
if ! (cd "$src" && git ls-files -z | tar -cf - --null -T -) 2>/dev/null | tar -xf - -C "$dirty" 2>/dev/null; then
    bad "D: could not copy the tracked tree"
fi

if [ -d "$dirty/src" ]; then
    git -C "$dirty" init -q
    git -C "$dirty" config user.email pre-open@insimul.invalid
    git -C "$dirty" config user.name "open_boundary negative control"
    # The pristine copy is its own commit, so the injection can be reverted
    # without reverting the repository itself.
    git -C "$dirty" add -A >/dev/null 2>&1
    git -C "$dirty" commit -qm "the tracked tree, as a clone would carry it" >/dev/null 2>&1

    # Every injected specifier is assembled from parts, so this file's own bytes
    # match none of the patterns it plants — the rule US-1 set in
    # tests/history_scan_selftest.mjs, for the same reason: a fixture committed
    # today is a blob the history audit reads forever.
    CLOSED="@ins""imul/back""end"

    mkdir -p "$dirty/data/insimul/genres"
    printf 'street_grid(colonial, 12).\n' > "$dirty/data/insimul/genres/colonial.pl"
    printf "\nimport { generate } from '%s/pipelines/generate';\n" "$CLOSED" >> "$dirty/wasm/insimul-api.mjs"
    printf '#include "../../platform/server.h"\n' >> "$dirty/src/insimul.c"
    printf '\nharness = { git = "https://example.invalid/harness" }\n' >> "$dirty/rust/insimul/Cargo.toml"
    printf '\nFetchContent_Declare(zlib GIT_REPOSITORY https://example.invalid/zlib.git)\n' >> "$dirty/cmake/wasm.cmake"

    git -C "$dirty" add -A >/dev/null 2>&1
    git -C "$dirty" commit -qm "inject five boundary violations" >/dev/null 2>&1

    if node "$check" "$dirty" --rules "$rules" > "$tmp/dirty.log" 2>&1; then
        bad "D: negative control PASSED — the gate cannot fail, and check B proves nothing"
    else
        missing=""
        for want in closed-pack-tree closed-repo-import escaping-c-include git-dependency build-time-fetch; do
            grep -q "^  $want: " "$tmp/dirty.log" || missing="$missing $want"
        done
        if [ -n "$missing" ]; then
            bad "D: the gate failed the dirty tree but missed:$missing"
            sed 's/^/       /' "$tmp/dirty.log" | head -20
        else
            ok "D: negative control — 5 injected violations, all 5 named, exit 1"
        fi
    fi

    # …and removed again. A gate that stays red once it has been red is as
    # useless as one that never goes red: it is the difference that carries the
    # information.
    git -C "$dirty" revert --no-edit HEAD >/dev/null 2>&1
    if node "$check" "$dirty" --rules "$rules" > "$tmp/clean.log" 2>&1; then
        ok "D: violations removed — the same tree passes again, exit 0"
    else
        bad "D: the tree did not go back to green after the injection was reverted"
        sed 's/^/       /' "$tmp/clean.log" | head -20
    fi
fi

# ── E. the gate is wired ─────────────────────────────────────────────────────

if grep -q 'add_test(NAME open_boundary' "$src/CMakeLists.txt"; then
    ok "E: CMakeLists.txt still runs this gate as a ctest"
else
    bad "E: nothing in CMakeLists.txt runs the boundary gate — it is a file, not a check"
fi

# ── verdict ──────────────────────────────────────────────────────────────────

if [ "$fails" -eq 0 ]; then
    printf 'open_boundary: all checks passed\n'
    exit 0
fi
printf 'open_boundary: %d check(s) FAILED\n' "$fails"
exit 1
