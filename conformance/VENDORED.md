# Vendored conformance corpus

`prolog/` is a mirror of `@insimul/core`'s
`packages/core/conformance/prolog/` (the source of truth; see that package's
`conformance/README.md` for the case format, the order-independence rule, and the
"Amendments for the native harness" notes). Re-sync it with a plain copy of every
`*.json` — never hand-write or hand-edit a case here, or the two engines stop
testing the same thing. Last synced at the KINP identity corpus (`identity.json`,
`equivalence.json`, `worlds.json` + the rewritten `gameplay.json`), where entity
atoms became CURIEs. Regenerate on schema change — the engine repos (`insimul-godot`, `insimul-unity`,
`insimul-unreal`) vendor the same files the same way, so every standalone parity
gate runs identical cases.

Consumers here:

- `tests/conformance.c` (ctest `conformance`) — the C ABI gate.
- `rust/insimul/tests/conformance.rs` (`cargo test`) — the Rust wrapper gate.

Both resolve the corpus as: `INSIMUL_CONFORMANCE_DIR` (env, absolute) → this
vendored directory → the monorepo sibling
`../insimul-runtime/packages/core/conformance/prolog`.

`snapshots/` is not vendored: it holds this repo's own golden snapshot fixture
(US-LI4).
