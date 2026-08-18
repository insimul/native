#!/usr/bin/env bash
# run_attribution.sh — ctest `attribution` (US-3, `242-pre-open-native`).
#
# The pre-open LICENSING + POLICY checklist items, run as a gate rather than as
# a one-off:
#
#   "License + NOTICE files (Apache-2.0 + third-party attributions incl.
#    Trealla) in every open repo; CONTRIBUTING + CLA/DCO decision made."
#   "Trademark/conformance policy published alongside the spec."
#
# Both read like paperwork, and paperwork is the kind of thing that is done
# once, congratulated, and then quietly falsified by the next re-vendor, the
# next lock bump, or a tasklist marking an irreversible step done. A NOTICE is
# only true on the day it is written unless something keeps it true.
#
# Five checks, the same shape as `open_boundary`:
#
#   A. the gate is FALSIFIED first — tests/attribution_selftest.mjs fires every
#      rule at a synthetic positive AND at a near miss, over throwaway git
#      repositories with their own NOTICE, lockfile, vendored directory and
#      cargo registry cache.
#   B. this repository's real tree passes: every stanza accounted for, every pin
#      agreeing with the location the build reads it from, exit 0.
#   C. the committed report (docs/pre-open/attribution.json) still describes
#      this tree.
#   D. NEGATIVE CONTROL, live, on a copy of the REAL tree: five violations are
#      injected at once — the trademark policy FORKED into this repository, a
#      crate stanza deleted, a pin edited to name a different drop, a manifest
#      relicensed, and the visibility flip marked done-and-performed-by-a-
#      tasklist — the gate must exit non-zero and name all of them, and must go
#      back to exit 0 when they are removed.
#   E. the gate is WIRED: CMakeLists.txt still runs it. A gate nobody calls is a
#      file, not a check.
#
# Degrades to a LOUD [SKIP] only when node is genuinely absent — same convention
# as history_scan, open_boundary, snapshot_parse and core_vendor. Read the
# output: a [SKIP] asserted nothing.
#
# Usage: run_attribution.sh <source-dir>
set -uo pipefail

src="${1:?usage: run_attribution.sh <source-dir>}"
fails=0

ok()  { printf '  ok   %s\n' "$1"; }
bad() { printf '  FAIL %s\n' "$1"; fails=$((fails + 1)); }

if ! command -v node >/dev/null 2>&1; then
    echo "  [SKIP] attribution: 'node' not found — the pre-open licensing + policy gate"
    echo "         was NOT run. It is what says every vendored component is attributed,"
    echo "         every pin in NOTICE matches the pin the build reads, and no tasklist"
    echo "         marked an irreversible step done."
    exit 0
fi
if ! command -v git >/dev/null 2>&1; then
    printf 'attribution: FAIL — git not found; the audit reads the tracked set and this test does not skip\n'
    exit 1
fi

check="$src/scripts/check-attribution.mjs"
report="$src/docs/pre-open/attribution.json"
for f in "$check" "$report" "$src/tests/attribution_selftest.mjs" "$src/NOTICE" \
         "$src/CONTRIBUTING.md" "$src/docs/pre-open/status.json"; do
    [ -f "$f" ] || { printf 'attribution: FAIL — %s not found\n' "$f"; exit 1; }
done

tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT

# ── A. falsify the gate ──────────────────────────────────────────────────────

if node "$src/tests/attribution_selftest.mjs" > "$tmp/selftest.log" 2>&1; then
    ok "A: gate falsified — $(grep -c '^  ok' "$tmp/selftest.log") self-test check(s) passed"
else
    bad "A: the gate self-test FAILED"
    sed -n '/FAIL/,+1p' "$tmp/selftest.log" | sed 's/^/       /'
fi

# ── B. the real tree ─────────────────────────────────────────────────────────

if node "$check" "$src" > "$tmp/audit.log" 2>&1; then
    ok "B: $(sed 's/^check-attribution: [^ ]* —/tree:/' "$tmp/audit.log" | head -1)"
    # The license-drift rule compares each stanza's SPDX against the crate's own
    # metadata, and it can only do that for crates present in the local cargo
    # registry cache. When some are missing the audit still passes — so the
    # driver repeats the warning rather than letting a partially-verified run
    # read as a fully-verified one.
    if grep -q 'were NOT compared' "$tmp/audit.log"; then
        sed -n '/were NOT compared/,$p' "$tmp/audit.log" | sed 's/^/       /'
    fi
else
    bad "B: the licensing + policy audit FAILED on this repository"
    sed 's/^/       /' "$tmp/audit.log"
fi

# ── C. the committed report still describes this tree ────────────────────────
#
# Findings and stanzas, deliberately not the whole document: `gitHead` changes
# with every commit and the coverage counts change whenever anybody adds a file.
# What must not drift silently is WHICH components are attributed, under which
# identifier, at which pin — and whether anything is unresolved.

node "$check" "$src" --report "$tmp/fresh.json" > /dev/null 2>&1
if node --input-type=module -e "
import fs from 'node:fs';
const key = (r) => JSON.stringify({
  components: r.components
    .map((c) => [c.name, c.spdx, c.package, c.pinnedVersion, c.pinnedCommit, c.pinSource, c.vendoredPath])
    .sort(),
  findings: r.findings.map((f) => [f.rule, f.path, f.subject]).sort(),
});
const committed = JSON.parse(fs.readFileSync('$report', 'utf8'));
const fresh = JSON.parse(fs.readFileSync('$tmp/fresh.json', 'utf8'));
if (key(committed) !== key(fresh)) {
  console.error('the committed report and a fresh run disagree');
  process.exit(1);
}
console.log(\`\${committed.components.length} attributed component(s), \${committed.findings.length} finding(s)\`);
" > "$tmp/report.log" 2>&1; then
    ok "C: committed report matches a fresh run — $(cat "$tmp/report.log")"
else
    bad "C: docs/pre-open/attribution.json is STALE — regenerate it with --report"
    sed 's/^/       /' "$tmp/report.log"
fi

# ── D. negative control: the real tree, with five violations in it ───────────
#
# A copy of the TRACKED tree (as it stands on disk — see run_open_boundary.sh
# check D for why `git ls-files` and not `git archive HEAD`), re-inited as a git
# repository so the gate walks it the same way it walks the real one.

dirty="$tmp/dirty"
mkdir -p "$dirty"
if ! (cd "$src" && git ls-files -z | tar -cf - --null -T -) 2>/dev/null | tar -xf - -C "$dirty" 2>/dev/null; then
    bad "D: could not copy the tracked tree"
fi

if [ -f "$dirty/NOTICE" ]; then
    git -C "$dirty" init -q
    git -C "$dirty" config user.email pre-open@insimul.invalid
    git -C "$dirty" config user.name "attribution negative control"
    git -C "$dirty" add -A >/dev/null 2>&1
    git -C "$dirty" commit -qm "the tracked tree, as a clone would carry it" >/dev/null 2>&1

    # 1. the policy, FORKED into this repository rather than linked
    printf '# Trademark and conformance-mark policy\n\nA divergent second copy.\n' > "$dirty/TRADEMARK.md"

    node --input-type=module -e "
import fs from 'node:fs';

// 2. a crate stanza deleted — the lock still resolves it
const notice = fs.readFileSync('$dirty/NOTICE', 'utf8');
const withoutCrate = notice.replace(/### memchr\n[\s\S]*?(?=\n### )/, '');
if (withoutCrate === notice) { console.error('injection 2 matched nothing'); process.exit(2); }

// 3. a pin edited to name a different drop than the one the build reads
const withBadPin = withoutCrate.replace(
  'Pinned-Commit: 07de013677af760a8bca0594ae4b2bef158a3cde',
  'Pinned-Commit: 0000000000000000000000000000000000000000',
);
if (withBadPin === withoutCrate) { console.error('injection 3 matched nothing'); process.exit(2); }
fs.writeFileSync('$dirty/NOTICE', withBadPin);

// 4. a manifest relicensed away from the repository's own license
const manifest = fs.readFileSync('$dirty/rust/Cargo.toml', 'utf8');
const relicensed = manifest.replace(/^license = \".*\"$/m, 'license = \"MIT\"');
if (relicensed === manifest) { console.error('injection 4 matched nothing'); process.exit(2); }
fs.writeFileSync('$dirty/rust/Cargo.toml', relicensed);

// 5. the record claiming a tasklist performed the irreversible step
const status = JSON.parse(fs.readFileSync('$dirty/docs/pre-open/status.json', 'utf8'));
const flip = status.items.find((item) => item.id === 'visibility-flip');
if (flip === undefined) { console.error('injection 5 matched nothing'); process.exit(2); }
flip.state = 'done';
flip.performedByTasklist = true;
fs.writeFileSync('$dirty/docs/pre-open/status.json', JSON.stringify(status, null, 2) + '\n');
" || bad "D: could not inject the violations"

    git -C "$dirty" add -A >/dev/null 2>&1
    git -C "$dirty" commit -qm "inject five licensing/policy violations" >/dev/null 2>&1

    if node "$check" "$dirty" > "$tmp/dirty.log" 2>&1; then
        bad "D: negative control PASSED — the gate cannot fail, and check B proves nothing"
    else
        missing=""
        for want in forked-policy missing-attribution pin-drift manifest-license status-human-gate; do
            grep -q "^  $want: " "$tmp/dirty.log" || missing="$missing $want"
        done
        if [ -n "$missing" ]; then
            bad "D: the gate failed the dirty tree but missed:$missing"
            sed 's/^/       /' "$tmp/dirty.log" | head -24
        else
            ok "D: negative control — 5 injected violations, all 5 named, exit 1"
        fi
    fi

    # …and removed again. A gate that stays red once it has been red is as
    # useless as one that never goes red: it is the difference that carries the
    # information.
    git -C "$dirty" revert --no-edit HEAD >/dev/null 2>&1
    if node "$check" "$dirty" > "$tmp/clean.log" 2>&1; then
        ok "D: violations removed — the same tree passes again, exit 0"
    else
        bad "D: the tree did not go back to green after the injection was reverted"
        sed 's/^/       /' "$tmp/clean.log" | head -24
    fi
fi

# ── E. the gate is wired ─────────────────────────────────────────────────────

if grep -q 'add_test(NAME attribution' "$src/CMakeLists.txt"; then
    ok "E: CMakeLists.txt still runs this gate as a ctest"
else
    bad "E: nothing in CMakeLists.txt runs the attribution gate — it is a file, not a check"
fi

# ── verdict ──────────────────────────────────────────────────────────────────

if [ "$fails" -eq 0 ]; then
    printf 'attribution: all checks passed\n'
    exit 0
fi
printf 'attribution: %d check(s) FAILED\n' "$fails"
exit 1
