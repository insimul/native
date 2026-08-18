#!/usr/bin/env bash
# run_history_scan.sh — ctest `history_scan` (US-1, `242-pre-open-native`).
#
# The pre-open history audit, run as a gate rather than as a one-off. Five checks:
#
#   A. the scanner is FALSIFIED first — tests/history_scan_selftest.mjs fires
#      every rule in scripts/history-scan.rules.json at a synthetic positive.
#   B. this repository's real history is clean and every finding is classified
#      (`--check`), and the committed scrub plan provably purges every
#      scrub-classified finding (`--verify-scrub`; there are none).
#   C. NEGATIVE CONTROL, live: a throwaway repository with a planted secret, a
#      planted closed pack and a planted .env is scanned with THIS repository's
#      rules. --check must exit non-zero and name all three.
#   D. the prepared scrub actually works: a replacement rule for the planted
#      secret is verified by --verify-scrub, then `git filter-repo` really
#      rewrites the throwaway repository and the rescan comes back clean. The
#      invocation this repo would run at flip time is therefore demonstrated, not
#      asserted — on a repository nobody cares about.
#   E. scripts/history-scrub.sh refuses to rewrite while the plan purges nothing.
#
# The committed report (docs/pre-open/history-scan.json) is NOT regenerated here.
# A gate that rewrites its own evidence and then checks it passes is the shape of
# a gate that cannot fail; this one reads the committed artifact and compares.
#
# Degrades to a LOUD [SKIP] only when node is genuinely absent — same convention
# as snapshot_parse and core_vendor. Read the output: a [SKIP] asserted nothing,
# and this is the gate standing between the repository and a permanent public
# history. Check D additionally needs git-filter-repo and says so when it is
# missing; A, B, C and E do not.
#
# Usage: run_history_scan.sh <source-dir>
set -uo pipefail

src="${1:?usage: run_history_scan.sh <source-dir>}"
fails=0

ok()  { printf '  ok   %s\n' "$1"; }
bad() { printf '  FAIL %s\n' "$1"; fails=$((fails + 1)); }

if ! command -v node >/dev/null 2>&1; then
    echo "  [SKIP] history_scan: 'node' not found — the pre-open history audit was NOT run."
    echo "         Install node to run this gate. It is the check that says whether this"
    echo "         repository's HISTORY is safe to publish; nothing else looks at it."
    exit 0
fi
if ! command -v git >/dev/null 2>&1; then
    printf 'history_scan: FAIL — git not found; the audit cannot read history and this test does not skip\n'
    exit 1
fi

scan="$src/scripts/history-scan.mjs"
rules="$src/scripts/history-scan.rules.json"
for f in "$scan" "$rules" "$src/tests/history_scan_selftest.mjs"; do
    [ -f "$f" ] || { printf 'history_scan: FAIL — %s not found\n' "$f"; exit 1; }
done

tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT

# ── A. falsify the scanner ───────────────────────────────────────────────────

if node "$src/tests/history_scan_selftest.mjs" --rules "$rules" > "$tmp/selftest.log" 2>&1; then
    ok "A: scanner falsified — $(grep -c '^  ok' "$tmp/selftest.log") self-test check(s) passed"
else
    bad "A: the scanner self-test FAILED"
    sed -n '/FAIL/,+1p' "$tmp/selftest.log" | sed 's/^/       /'
fi

# ── B. the real audit ────────────────────────────────────────────────────────

if node "$scan" --repo "$src" --rules "$rules" --check --verify-scrub > "$tmp/audit.log" 2>&1; then
    ok "B: $(grep -m1 '^history-scan: [0-9]* commit' "$tmp/audit.log" | sed 's/^history-scan: //')"
    ok "B: $(grep -m1 '^history-scan: [0-9]* finding' "$tmp/audit.log" | sed 's/^history-scan: //')"
else
    bad "B: the history audit FAILED — an unclassified finding, a stale allowance, or a surviving scrub finding"
    grep -E 'UNRESOLVED|SURVIVES|matches nothing' "$tmp/audit.log" | sed 's/^/       /'
fi

# ── C. negative control: a repository that is NOT clean ──────────────────────
#
# Every planted secret is assembled from parts so this file's own bytes match
# none of the patterns it plants — the same rule tests/history_scan_selftest.mjs
# follows, and for the same reason: a fixture committed today is a blob the audit
# reads forever.

dirty="$tmp/dirty"
mkdir -p "$dirty/src" "$dirty/data/insimul/genre" "$dirty/conf"
git -C "$dirty" init -q
git -C "$dirty" config user.email pre-open@insimul.invalid
git -C "$dirty" config user.name "history_scan negative control"

PLANTED="AKIA""IOSFODNN7EXAMPLE"
printf 'const key = "%s";\n' "$PLANTED" > "$dirty/src/deploy.js"
printf '{"pack": "insimul.streets.colonial", "packVersion": "3", "phases": [{"op": "grid"}]}\n' \
    > "$dirty/data/insimul/genre/streets.json"
printf 'DB_PASSWORD=hunter2hunter2\n' > "$dirty/conf/.env"
git -C "$dirty" add -A >/dev/null
git -C "$dirty" commit -qm "plant three findings" >/dev/null

# A second commit that DELETES the secret — the whole point of a history audit is
# that this does not help.
rm "$dirty/src/deploy.js"
git -C "$dirty" add -A >/dev/null
git -C "$dirty" commit -qm "remove the key (from HEAD only)" >/dev/null

if node "$scan" --repo "$dirty" --rules "$rules" --check > "$tmp/dirty.log" 2>&1; then
    bad "C: negative control PASSED — the audit cannot fail, and check B proves nothing"
else
    missing=""
    for want in aws-access-key-id closed-pack-tree dotenv-file closed-pack-document; do
        grep -q "UNRESOLVED\] $want " "$tmp/dirty.log" || missing="$missing $want"
    done
    if [ -n "$missing" ]; then
        bad "C: the audit failed the dirty repository but missed:$missing"
    else
        ok "C: negative control — a secret deleted in a later commit is still found in history (4 rules fired, exit 1)"
    fi
fi

# ── D. the prepared scrub, executed for real on the throwaway repository ─────

mkdir -p "$tmp/plan"
printf 'literal:%s\n' "$PLANTED" > "$tmp/plan/history-scrub.replacements.txt"
printf 'data/insimul/genre/streets.json\nconf/.env\n' > "$tmp/plan/history-scrub.paths.txt"

# The verifier first: does the plan purge the findings, in memory, before anything
# irreversible happens? This is what history-scrub.sh runs at step 3.
if node --input-type=module -e "
import { scanHistory, readScrubPlan, verifyScrubPlan } from '$scan';
const report = scanHistory('$dirty', '$rules');
const plan = readScrubPlan('$tmp/plan');
const verdict = verifyScrubPlan('$dirty', '$rules', report, plan);
console.log(JSON.stringify({ scrub: verdict.scrub, covered: verdict.covered.length, uncovered: verdict.uncovered.length }));
process.exit(verdict.uncovered.length === 0 && verdict.scrub > 0 ? 0 : 1);
" > "$tmp/verify.log" 2>&1; then
    ok "D: --verify-scrub proves the plan purges every scrub finding — $(cat "$tmp/verify.log")"
else
    bad "D: --verify-scrub could not prove the plan purges the planted findings"
    sed 's/^/       /' "$tmp/verify.log"
fi

if command -v git-filter-repo >/dev/null 2>&1 || git filter-repo --version >/dev/null 2>&1; then
    mirror="$tmp/dirty-mirror.git"
    git clone -q --no-local --mirror "$dirty" "$mirror" 2>/dev/null
    if git -C "$mirror" filter-repo --force \
            --replace-text "$tmp/plan/history-scrub.replacements.txt" \
            --invert-paths --paths-from-file "$tmp/plan/history-scrub.paths.txt" \
            > "$tmp/filter-repo.log" 2>&1; then
        rescanned="$tmp/rescanned"
        git clone -q "$mirror" "$rescanned" 2>/dev/null
        if node "$scan" --repo "$rescanned" --rules "$rules" > "$tmp/rescan.log" 2>&1 &&
           ! grep -qE '\] (aws-access-key-id|closed-pack-tree|dotenv-file|closed-pack-document) ' "$tmp/rescan.log"; then
            ok "D: git filter-repo really purged all four from the rewritten history ($(grep -m1 '^history-scan: [0-9]* finding' "$tmp/rescan.log" | sed 's/^history-scan: //'))"
        else
            bad "D: the rewritten history STILL carries a planted finding"
            grep -E '\] (aws-access-key-id|closed-pack-tree|dotenv-file|closed-pack-document) ' "$tmp/rescan.log" | sed 's/^/       /'
        fi
    else
        bad "D: git filter-repo failed on the throwaway repository"
        tail -5 "$tmp/filter-repo.log" | sed 's/^/       /'
    fi
else
    echo "  note D: git-filter-repo is not installed — the plan was verified in memory but"
    echo "          not executed end-to-end. Install it (brew install git-filter-repo) before"
    echo "          flip time; it is the tool the rewrite is written against."
fi

# ── E. the real scrub script refuses a pointless rewrite ─────────────────────

if bash "$src/scripts/history-scrub.sh" > "$tmp/scrub.log" 2>&1; then
    if grep -q "nothing to scrub" "$tmp/scrub.log"; then
        ok "E: history-scrub.sh prints the plan and states there is nothing to scrub"
    else
        bad "E: history-scrub.sh ran but did not report the empty plan"
    fi
else
    bad "E: history-scrub.sh failed in plan-only mode"
    tail -5 "$tmp/scrub.log" | sed 's/^/       /'
fi

if bash "$src/scripts/history-scrub.sh" --execute --i-understand-this-invalidates-every-clone \
        > "$tmp/scrub-exec.log" 2>&1; then
    bad "E: history-scrub.sh accepted --execute with a plan that purges nothing"
else
    ok "E: history-scrub.sh REFUSES --execute while the plan purges nothing"
fi

# ── verdict ──────────────────────────────────────────────────────────────────

if [ "$fails" -eq 0 ]; then
    printf 'history_scan: all checks passed\n'
    exit 0
fi
printf 'history_scan: %d check(s) FAILED\n' "$fails"
exit 1
