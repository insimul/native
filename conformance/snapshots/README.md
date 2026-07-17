# Snapshot conformance fixtures (US-LI4)

`insimul_kb_snapshot()` serializes a KB's dynamic state (every fact/rule the host
consulted or asserted) as canonical Prolog program text — the bridge to a save
file's `currentState.prologFacts`. Two contracts pin the format:

- **`basic.snapshot.pl`** — a **byte-exact** snapshot image produced by the native
  ABI for a fixed KB (see `tests/snapshot.c`). The `snapshot` ctest reproduces this
  exact KB and asserts its `insimul_kb_snapshot()` output is byte-identical to this
  file (golden + determinism). If the snapshot format legitimately changes,
  regenerate the file (run `snapshot` once with `INSIMUL_SNAPSHOT_UPDATE=1`) and
  re-run `snapshot_parse`.
- **`basic.snapshot.expected.json`** — what
  `insimul-runtime/packages/core/src/prolog/prolog-fact-parser.ts` must yield when
  it parses `basic.snapshot.pl` (facts/rules/errors counts + spot checks). The
  `snapshot_parse` ctest runs the actual TS parser (via `node
  --experimental-strip-types`) over the `.pl` fixture and checks it against this
  file — proving the C#/C++/GDScript wrappers' fact parser accepts the native
  snapshot format. It degrades to a loud `[SKIP]` only if `node` or the
  insimul-runtime submodule's parser is unavailable.

Snapshot format (also documented in `../../README.md`):

- One clause per line, terminated by `.`; predicates in standard `Name/Arity`
  order, clauses within a predicate in assert order → **deterministic**, so equal
  states serialize byte-identically.
- Facts write just the head; rules write `Head :- Body`. Variables render as
  `A, B, C, …` (numbervars); atoms needing quotes use single quotes
  (`'Grand Duchess'`). The bootstrap's own `$`-prefixed predicates are never
  included.
