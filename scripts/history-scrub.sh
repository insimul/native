#!/usr/bin/env bash
#
# history-scrub.sh — the prepared `git filter-repo` invocation for the pre-open
# history scrub of insimul-native (US-1, `242-pre-open-native`).
#
#   ./scripts/history-scrub.sh                 # print the plan. Changes nothing.
#   ./scripts/history-scrub.sh --execute \
#        --i-understand-this-invalidates-every-clone
#
# Derived from insimul/core@b37837b's scripts/history-scrub.sh (tasklist
# `241-pre-open-core` US-1), which 242 inherits rather than reinvents. The one
# behavioural addition is §0 below: this repository's audit found NOTHING to
# scrub, so the script refuses to rewrite at all until that changes.
#
# ── THIS SCRIPT IS NOT RUN BY ANY TASKLIST ───────────────────────────────────
#
# A history rewrite changes every commit id from the first rewritten commit
# onward. Every existing clone, every open branch, every PR, and — this is
# native's own multiplier — every SUBMODULE POINTER in the superproject and in
# each engine repo that pins this one breaks at once. There is no un-rewriting.
# It is therefore executed BY A HUMAN, at flip time, in the same sitting as
# `gh repo edit insimul/native --visibility public`, which is the other
# irreversible half of the same operation and is likewise not automated.
# `242-pre-open-native` prepares and PROVES this; it does not run it.
# See `docs/pre-open-audit.md` §1.5.
#
# ── WHAT IT DOES, IN ORDER ───────────────────────────────────────────────────
#
#   0. Refuses to rewrite when the plan has no active rule and no active path —
#      a filter-repo run that purges nothing still invalidates every clone.
#   1. Re-runs the audit and refuses to continue on an unclassified finding.
#   2. Refuses to continue if the audit report is stale — i.e. if HEAD has moved
#      since the report was recorded. A scrub plan verified against a history
#      that has since grown is a plan for a different repository.
#   3. Proves, against the real blobs, that the committed plan purges every
#      scrub-classified finding (`--verify-scrub`).
#   4. Prints the exact invocation.
#   5. Only with BOTH flags and a typed confirmation: runs it.

set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO="$(cd "${HERE}/.." && pwd)"
REPORT="${REPO}/docs/pre-open/history-scan.json"
REPLACEMENTS="${HERE}/history-scrub.replacements.txt"
PATHS="${HERE}/history-scrub.paths.txt"

EXECUTE=0
ACKNOWLEDGED=0
for arg in "$@"; do
  case "${arg}" in
    --execute) EXECUTE=1 ;;
    --i-understand-this-invalidates-every-clone) ACKNOWLEDGED=1 ;;
    *) echo "history-scrub: unknown argument ${arg}" >&2; exit 2 ;;
  esac
done

# ── 1 & 3. the audit, and proof the plan works ───────────────────────────────

echo "history-scrub: re-running the audit and verifying the plan…"
node "${HERE}/history-scan.mjs" --repo "${REPO}" --check --verify-scrub

# ── 2. is the report the one that was reviewed? ──────────────────────────────

if [[ ! -f "${REPORT}" ]]; then
  echo "history-scrub: no report at ${REPORT}. Run: node scripts/history-scan.mjs --check --verify-scrub --report docs/pre-open/history-scan.json" >&2
  exit 1
fi
RECORDED_HEAD="$(node -e "process.stdout.write(JSON.parse(require('fs').readFileSync(process.argv[1],'utf8')).repository.head)" "${REPORT}")"
ACTUAL_HEAD="$(git -C "${REPO}" rev-parse HEAD)"
if [[ "${RECORDED_HEAD}" != "${ACTUAL_HEAD}" ]]; then
  echo "history-scrub: the audit report is STALE." >&2
  echo "  reviewed at HEAD ${RECORDED_HEAD}" >&2
  echo "  repository is at ${ACTUAL_HEAD}" >&2
  echo "  Commits landed since the audit. Re-run it, re-review the findings, and re-verify the plan" >&2
  echo "  before rewriting:" >&2
  echo "    node scripts/history-scan.mjs --check --verify-scrub --report docs/pre-open/history-scan.json" >&2
  exit 1
fi

# ── 0. is there anything to scrub at all? ────────────────────────────────────
#
# Counted from the plan files, not from the report, because the plan is what
# would actually be handed to filter-repo. Comments and blank lines do not count.

ACTIVE_PATHS="$(grep -cvE '^\s*(#|$)' "${PATHS}" || true)"
ACTIVE_RULES="$(grep -cvE '^\s*(#|$)' "${REPLACEMENTS}" || true)"

if [[ "${ACTIVE_RULES}" -eq 0 && "${ACTIVE_PATHS}" -eq 0 ]]; then
  cat <<EMPTY

── nothing to scrub ──────────────────────────────────────────────────────────

The audit classified every finding **keep**: no secret, API key, token, private
key, closed pack or binary artifact has ever been committed to this repository
(docs/pre-open-audit.md §1.4, docs/pre-open/history-scan.json).

So there is no rewrite to run, and this script will not run one. A filter-repo
invocation with an empty replacements file rewrites every commit id in the
repository and removes nothing: the entire cost of a rewrite — invalidated
clones, broken submodule pointers, dead PRs — for none of its benefit.

If that changes (new commits land, or a rule is added), fill in
  ${REPLACEMENTS}
and/or
  ${PATHS}
re-run this script, and it will print the exact invocation.

──────────────────────────────────────────────────────────────────────────────
EMPTY
  if [[ "${EXECUTE}" -eq 1 ]]; then
    echo "history-scrub: --execute refused — the plan purges nothing." >&2
    exit 1
  fi
  exit 0
fi

# ── 4. the exact invocation ──────────────────────────────────────────────────
#
# `--replace-text` is present only when the replacements file has an active rule.
#
# `--invert-paths --paths-from-file` is present ONLY when the paths file has an
# active entry, and this is not a stylistic choice. filter-repo reads an empty
# paths file as "keep nothing", so passing one along would delete every file in
# the repository across all of history — see the header of history-scrub.paths.txt.

FILTER_ARGS=()
if [[ "${ACTIVE_RULES}" -gt 0 ]]; then
  FILTER_ARGS+=(--replace-text "${REPLACEMENTS}")
else
  echo
  echo "history-scrub: history-scrub.replacements.txt has no active rules — no text is replaced."
fi
if [[ "${ACTIVE_PATHS}" -gt 0 ]]; then
  FILTER_ARGS+=(--invert-paths --paths-from-file "${PATHS}")
else
  echo
  echo "history-scrub: history-scrub.paths.txt has no active entries — no file is deleted outright."
  echo "               --invert-paths is OMITTED (an empty paths file would delete the whole tree)."
fi

ORIGIN="$(git -C "${REPO}" remote get-url origin 2>/dev/null || echo '<origin-url>')"

cat <<PLAN

── the scrub, exactly ────────────────────────────────────────────────────────

Run these from a FRESH mirror clone, never from a working checkout — filter-repo
rewrites in place, and a working checkout still has remotes, stashes and
worktrees pointing at commit ids that will no longer exist. This repository is a
SUBMODULE of the insimul superproject and is pinned by the engine repos, so also
plan the pointer bumps: after the force-push, every superproject that references
it needs \`git submodule update --remote\` and a commit of the new sha.

A mirror is bare, so it has no scripts/ of its own: the plan files are passed by
ABSOLUTE path from this checkout, which is why they are named as variables here
rather than inlined as relative paths that would silently resolve to nothing.

$(if [[ "${ACTIVE_RULES}" -gt 0 ]]; then printf '  REPLACEMENTS=%s\n' "${REPLACEMENTS}"; fi)$(if [[ "${ACTIVE_PATHS}" -gt 0 ]]; then printf '  SCRUB_PATHS=%s\n' "${PATHS}"; fi)
  git clone --no-local --mirror ${ORIGIN} native-scrub.git
  cd native-scrub.git
  git filter-repo $(printf '%s ' "${FILTER_ARGS[@]}" | sed -e "s|${REPLACEMENTS}|\"\$REPLACEMENTS\"|" -e "s|${PATHS}|\"\$SCRUB_PATHS\"|")

Then, before pushing — the rewrite is only trustworthy if the audit agrees:

  git clone native-scrub.git native-scrubbed && cd native-scrubbed
  node scripts/history-scan.mjs --check --verify-scrub   # expect 0 scrub findings

  git push --force origin --all
  git push --force origin --tags

Everyone with a clone re-clones. There is no rebase path back.

──────────────────────────────────────────────────────────────────────────────
PLAN

if [[ "${EXECUTE}" -eq 0 ]]; then
  echo
  echo "history-scrub: plan only — nothing was changed."
  echo "               To run it: --execute --i-understand-this-invalidates-every-clone"
  exit 0
fi

# ── 5. execution, human-gated ────────────────────────────────────────────────

if [[ "${ACKNOWLEDGED}" -eq 0 ]]; then
  echo "history-scrub: --execute also requires --i-understand-this-invalidates-every-clone." >&2
  exit 2
fi
if ! command -v git-filter-repo >/dev/null 2>&1 && ! git filter-repo --version >/dev/null 2>&1; then
  echo "history-scrub: git-filter-repo is not installed (brew install git-filter-repo)." >&2
  exit 1
fi
if [[ "$(git -C "${REPO}" rev-parse --is-bare-repository)" != "true" ]]; then
  echo "history-scrub: refusing to rewrite a non-bare repository. Use a fresh --mirror clone; see the plan above." >&2
  exit 1
fi
if [[ ! -t 0 ]]; then
  echo "history-scrub: refusing to rewrite without an interactive confirmation." >&2
  exit 1
fi

echo
read -r -p "Type 'rewrite ${ACTUAL_HEAD:0:12}' to proceed: " CONFIRMATION
if [[ "${CONFIRMATION}" != "rewrite ${ACTUAL_HEAD:0:12}" ]]; then
  echo "history-scrub: not confirmed — nothing was changed." >&2
  exit 1
fi

git -C "${REPO}" filter-repo "${FILTER_ARGS[@]}"
echo "history-scrub: rewrite complete. Re-run the audit in a fresh clone before pushing."
