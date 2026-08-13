#!/usr/bin/env bash
# run_abi_neutrality.sh — ctest `abi_neutrality` (US-2).
#
# The SOURCE half of the ABI's neutrality invariant, in two checks:
#
#   A. include/insimul.h names no engine vendor — not in a type, a macro or a
#      format string. (The `abi` ctest already proves no engine TYPE is
#      reachable, by including only this header; this proves no vendor NAME is
#      baked into what wrappers parse.)
#   B. a deliberately vendor-shaped consumer does not compile: the engine's own
#      headers are not on the ABI's public include path, so `#include
#      "trealla.h"` from a consumer built the documented way fails.
#   C. inside the library, an engine header is reachable only from an engine PORT
#      (src/engine_<name>.c); src/insimul.c, which holds every ABI decision, sees
#      none. Tasklist 250 made this two-sided so it survives a second engine.
#
# Every check runs TWICE — once against the real tree, which must pass, and once
# against a deliberately broken fixture, which must FAIL. A gate that cannot
# fail is not a gate, and this repository has shipped a few (see the ROADMAP's
# D8-D11 caveat), so the negative controls are part of the test, not a comment
# claiming one was run.
#
# Usage: run_abi_neutrality.sh <source-dir> <cc>
set -uo pipefail

src="${1:?usage: run_abi_neutrality.sh <source-dir> <cc>}"
cc="${2:?usage: run_abi_neutrality.sh <source-dir> <cc>}"
hdr="$src/include/insimul.h"
fails=0

tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT

ok()   { printf '  ok   %s\n' "$1"; }
bad()  { printf '  FAIL %s\n' "$1"; fails=$((fails + 1)); }

# Vendor names, as identifiers: any Prolog implementation whose behaviour could
# leak. Word-ish boundaries keep "trealla" from matching inside a URL we might
# legitimately cite... which we also do not want, so it does not.
vendors='trealla|swipl|swi-prolog|gprolog|scryer|tau-prolog|sicstus|yap|ciao'

# A. --------------------------------------------------------- header hygiene
header_names_vendor() {   # 0 = a vendor is named (the bad state)
    grep -Eiq "$vendors" "$1"
}

printf 'A. include/insimul.h names no engine vendor\n'
if header_names_vendor "$hdr"; then
    bad "the ABI header names an engine vendor:"
    grep -Ein "$vendors" "$hdr" | sed 's/^/       /'
else
    ok "the ABI header names no engine vendor"
fi

# A's negative control: the same predicate over a copy that DOES name one.
cp "$hdr" "$tmp/vendor_shaped.h"
cat >> "$tmp/vendor_shaped.h" <<'EOF'
/* deliberately vendor-shaped, for the negative control */
typedef struct trealla_kb trealla_kb;
EOF
if header_names_vendor "$tmp/vendor_shaped.h"; then
    ok "negative control: the check FAILS a header that names a vendor"
else
    bad "negative control: a vendor-named header passed — check A cannot fail"
fi

# B. ------------------------------------------------- the include path is opaque
# The documented way to build a consumer: the public include dir and nothing else.
cat > "$tmp/neutral_consumer.c" <<'EOF'
#include "insimul.h"
int main(void) { return insimul_kb_create() ? 0 : 1; }
EOF
cat > "$tmp/vendor_consumer.c" <<'EOF'
/* A consumer that reaches past the ABI for the engine's own header. */
#include "insimul.h"
#include "trealla.h"
int main(void) { prolog *pl = pl_create(); (void)pl; return 0; }
EOF

printf 'B. a vendor-shaped consumer does not compile\n'
if "$cc" -fsyntax-only -I "$src/include" "$tmp/neutral_consumer.c" 2>"$tmp/neutral.err"; then
    ok "a consumer that includes only <insimul.h> compiles"
else
    bad "the neutral consumer failed to compile:"
    sed 's/^/       /' "$tmp/neutral.err"
fi

if "$cc" -fsyntax-only -I "$src/include" "$tmp/vendor_consumer.c" 2>"$tmp/vendor.err"; then
    bad "a consumer reaching for the engine's header COMPILED — the boundary is not opaque"
else
    ok "negative control: reaching for the engine's header does not compile"
    head -n1 "$tmp/vendor.err" | sed 's/^/       /'
fi

# C. ------------------------------- only the engine PORTS see an engine header
#
# US-2 phrased this as "src/insimul.c is the only unit that includes trealla.h".
# Tasklist 250 (the SWI spike) made the boundary explicit instead of incidental:
# src/insimul.c holds every ABI decision and names NO engine, and each engine is
# one port file, src/engine_<name>.c, implementing src/insimul_engine.h. So the
# invariant is now two-sided and survives a second engine:
#
#   * every file under src/ that includes an engine header is a src/engine_*.c;
#   * src/insimul.c includes none of them.
#
# That is what makes "swap the engine" a new file rather than an edit to the ABI.
printf 'C. only the engine ports (src/engine_*.c) include an engine header\n'

# The engine headers any port in this tree may reach for.
engine_hdrs='trealla\.h|SWI-Prolog\.h'

engine_includers() {   # <dir> -> the files in it that include an engine header
    grep -rlE "^[[:space:]]*#include[[:space:]]*[<\"]($engine_hdrs)[>\"]" \
        "$1/src" "$1/include" 2>/dev/null | sed "s|^$1/||" | sort
}

including="$(engine_includers "$src")"
stray="$(printf '%s\n' "$including" | grep -v '^src/engine_[a-z0-9_]*\.c$' || true)"
if [ -z "$including" ]; then
    bad "no file includes an engine header at all — the port is not wired up"
elif [ -n "$stray" ]; then
    bad "these are not engine ports but include an engine header: $(printf '%s ' $stray)"
else
    ok "the only units that include an engine header are: $(printf '%s ' $including)"
fi

# The half that actually protects the ABI layer: insimul.c must stay engine-blind.
if printf '%s\n' "$including" | grep -qx 'src/insimul.c'; then
    bad "src/insimul.c includes an engine header — the ABI layer is not engine-blind"
else
    ok "src/insimul.c includes no engine header"
fi

# Negative control: a tree where the ABI layer reaches for the engine must FAIL.
mkdir -p "$tmp/broken/src" "$tmp/broken/include"
cp "$src/include/insimul.h" "$tmp/broken/include/"
printf '#include "insimul.h"\n#include "trealla.h"\n' > "$tmp/broken/src/insimul.c"
cp "$src/src/engine_trealla.c" "$tmp/broken/src/" 2>/dev/null || true
broken_includes="$(engine_includers "$tmp/broken")"
if printf '%s\n' "$broken_includes" | grep -qx 'src/insimul.c'; then
    ok "negative control: the check FAILS an ABI layer that includes the engine header"
else
    bad "negative control: a leaking src/insimul.c passed — check C cannot fail"
fi


if [ "$fails" -eq 0 ]; then
    printf 'abi_neutrality: PASS\n'
    exit 0
fi
printf 'abi_neutrality: FAIL (%d)\n' "$fails"
exit 1
