#!/usr/bin/env bash
# run_trealla_vendor.sh — ctest `trealla_vendor` (US-3).
#
# Proves the committed engine source under vendor/trealla/ IS upstream's source
# at the pinned commit, and that the build still has no way to reach the network
# for it. Three checks:
#
#   A. PROVENANCE, offline: recompute the git object id of every vendored path
#      and compare it to the id recorded in VENDORED.json. Those ids came from
#      upstream's own tree at the pinned commit, so this ties the bytes on disk
#      to a commit in trealla-prolog/trealla — not merely to a hash we invented
#      when we generated the manifest. A hand-edited engine source, a dropped
#      file, or an ADDED file all change the tree id.
#   B. the pin CMake compiled with is the pin in VENDORED.json (one
#      authoritative location; the build reads it from there).
#   C. no FetchContent/network fetch of the engine has come back into the build.
#
# A and C each run against a deliberately broken fixture as well, and the test
# fails if the broken fixture PASSES. A gate that cannot fail is not a gate, and
# this repository has shipped a few (ROADMAP caveat D8-D11).
#
# Usage: run_trealla_vendor.sh <source-dir> <expected-commit> <expected-tag>
set -uo pipefail

src="${1:?usage: run_trealla_vendor.sh <source-dir> <commit> <tag>}"
want_commit="${2:?usage: run_trealla_vendor.sh <source-dir> <commit> <tag>}"
want_tag="${3:?usage: run_trealla_vendor.sh <source-dir> <commit> <tag>}"
vendor="$src/vendor/trealla"
manifest="$vendor/VENDORED.json"
fails=0

ok()  { printf '  ok   %s\n' "$1"; }
bad() { printf '  FAIL %s\n' "$1"; fails=$((fails + 1)); }

# git is REQUIRED, not optional: without it check A asserts nothing, and a
# vacuous pass here is exactly the failure this repo keeps re-learning.
if ! command -v git >/dev/null 2>&1; then
    printf 'trealla_vendor: FAIL — git not found; check A cannot run and this test does not skip\n'
    exit 1
fi
if [ ! -f "$manifest" ]; then
    printf 'trealla_vendor: FAIL — %s not found\n' "$manifest"
    exit 1
fi

tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT

# Minimal JSON readers — no jq dependency (the corebridge vendor check needs
# node; this one deliberately needs nothing but git and a shell).
json_str() { sed -n "s/.*\"$2\"[[:space:]]*:[[:space:]]*\"\([^\"]*\)\".*/\1/p" "$1" | head -n1; }
# keys of the "gitObjects" object, in file order
git_object_paths() {
    sed -n '/"gitObjects"[[:space:]]*:[[:space:]]*{/,/}/p' "$1" \
        | sed -n 's/^[[:space:]]*"\([^"]*\)"[[:space:]]*:[[:space:]]*"[0-9a-f]\{40\}".*/\1/p'
}
git_object_id() {
    sed -n '/"gitObjects"[[:space:]]*:[[:space:]]*{/,/}/p' "$1" \
        | sed -n "s/^[[:space:]]*\"$2\"[[:space:]]*:[[:space:]]*\"\([0-9a-f]\{40\}\)\".*/\1/p" | head -n1
}

# ---------------------------------------------------------------------------
# A. provenance — every vendored path reproduces upstream's git object id.
#
# `git write-tree` over a throwaway index hashes exactly what git would have
# hashed in the upstream repository (same blob/tree object format, same modes),
# so the comparison is against upstream's real ids and needs no network.
# ---------------------------------------------------------------------------
recompute_tree() {   # $1 = directory to hash; prints "<id> <path>" per top entry
    local dir="$1" work
    work="$(mktemp -d)"
    ( cd "$dir" && tar cf - . ) | ( cd "$work" && tar xf - ) || { rm -rf "$work"; return 1; }
    # VENDORED.json is ours, not upstream's — it is not part of any hashed path.
    rm -f "$work/VENDORED.json" "$work/VENDORED.md"
    # No global/system config: a user's core.autocrlf or a clean/smudge filter
    # would change the blob ids and make this gate lie in either direction.
    local g=(env GIT_CONFIG_GLOBAL=/dev/null GIT_CONFIG_SYSTEM=/dev/null git -C "$work")
    "${g[@]}" init -q                                       || { rm -rf "$work"; return 1; }
    "${g[@]}" add -A                                        || { rm -rf "$work"; return 1; }
    local root
    root="$("${g[@]}" write-tree)"                           || { rm -rf "$work"; return 1; }
    "${g[@]}" ls-tree "$root" | awk '{print $3, $4}'
    rm -rf "$work"
}

verify_tree() {      # $1 = directory, $2 = manifest; 0 = matches the manifest
    local dir="$1" mf="$2" actual expected path want got
    actual="$(recompute_tree "$dir")" || return 1
    # every recorded path must be present with the recorded id …
    for path in $(git_object_paths "$mf"); do
        want="$(git_object_id "$mf" "$path")"
        got="$(printf '%s\n' "$actual" | awk -v p="$path" '$2 == p {print $1}')"
        [ -n "$got" ] && [ "$got" = "$want" ] || { VERIFY_WHY="$path: want ${want:-<none>}, got ${got:-<missing>}"; return 1; }
    done
    # … and nothing else may be there (an ADDED top-level path is drift too).
    expected="$(git_object_paths "$mf" | sort)"
    got="$(printf '%s\n' "$actual" | awk '{print $2}' | sort)"
    [ "$expected" = "$got" ] || { VERIFY_WHY="unexpected top-level paths: $(printf '%s\n' "$got" | tr '\n' ' ')"; return 1; }
    return 0
}

printf 'A. vendor/trealla is upstream'"'"'s source at the pinned commit (offline)\n'
VERIFY_WHY=""
if verify_tree "$vendor" "$manifest"; then
    ok "every vendored path reproduces upstream's git object id at $want_commit"
    git_object_paths "$manifest" | while read -r p; do
        printf '       %s %s\n' "$(git_object_id "$manifest" "$p")" "$p"
    done
else
    bad "vendored source does not match the recorded upstream tree — $VERIFY_WHY"
fi

# A's negative control: the same predicate over a copy with ONE byte changed in
# one engine source file. If that still passes, check A is decorative.
cp -R "$vendor" "$tmp/tampered"
printf '\n/* tamper */\n' >> "$tmp/tampered/src/prolog.c"
VERIFY_WHY=""
if verify_tree "$tmp/tampered" "$manifest"; then
    bad "negative control: a tampered engine source PASSED — check A cannot fail"
else
    ok "negative control: one edited byte in src/prolog.c FAILS the check ($VERIFY_WHY)"
fi

# A's second negative control: an ADDED file (which a hash-per-listed-file
# manifest would happily ignore).
cp -R "$vendor" "$tmp/extra"
printf 'int stowaway;\n' > "$tmp/extra/src/stowaway.c"
VERIFY_WHY=""
if verify_tree "$tmp/extra" "$manifest"; then
    bad "negative control: an ADDED engine source PASSED — check A cannot fail"
else
    ok "negative control: an added src/stowaway.c FAILS the check"
fi

# ---------------------------------------------------------------------------
# B. the compiled pin is the vendored pin.
# ---------------------------------------------------------------------------
printf 'B. the pin CMake built with is the pin in VENDORED.json\n'
mf_commit="$(json_str "$manifest" commit)"
mf_tag="$(json_str "$manifest" tag)"
if [ "$mf_commit" = "$want_commit" ] && [ "$mf_tag" = "$want_tag" ]; then
    ok "VENDORED.json ${mf_tag}/${mf_commit} == the pin the build used"
else
    bad "pin drift: VENDORED.json says ${mf_tag}/${mf_commit}, the build used ${want_tag}/${want_commit}"
fi

# ---------------------------------------------------------------------------
# C. the build cannot fetch the engine.
# ---------------------------------------------------------------------------
printf 'C. the build declares no network fetch of the engine\n'
declares_fetch() {   # 0 = a fetch of the engine is declared (the bad state)
    grep -Eiq 'FetchContent_Declare[[:space:]]*\([[:space:]]*trealla|ExternalProject_Add[[:space:]]*\([[:space:]]*trealla|GIT_REPOSITORY.*trealla' "$1"
}
for f in "$src/CMakeLists.txt" "$src/cmake/wasm.cmake"; do
    [ -f "$f" ] || continue
    if declares_fetch "$f"; then
        bad "$(basename "$f") declares a network fetch of the engine:"
        grep -Ein 'FetchContent_Declare[[:space:]]*\([[:space:]]*trealla|GIT_REPOSITORY.*trealla' "$f" | sed 's/^/       /'
    else
        ok "$(basename "$f") declares no engine fetch"
    fi
done

# C's negative control.
cp "$src/CMakeLists.txt" "$tmp/fetching.cmake"
cat >> "$tmp/fetching.cmake" <<'EOF'
FetchContent_Declare(trealla GIT_REPOSITORY https://example.invalid/trealla.git)
EOF
if declares_fetch "$tmp/fetching.cmake"; then
    ok "negative control: the check FAILS a build that fetches the engine"
else
    bad "negative control: a fetching build passed — check C cannot fail"
fi

if [ "$fails" -eq 0 ]; then
    printf 'trealla_vendor: PASS\n'
    exit 0
fi
printf 'trealla_vendor: FAIL (%d)\n' "$fails"
exit 1
