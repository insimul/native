# The measured world

The fixture every figure in [`docs/SWIPL_MEASUREMENT.md`](../../docs/SWIPL_MEASUREMENT.md)
is taken against. US-3 of tasklist 250 asks for "cold KB create + consult of a
real world's `.pl` set" and "resident memory holding a real world's KB" — so the
world has to be **committed, reproducible and stated**, or the numbers are
anecdotes about somebody's laptop.

|  | |
|---|---|
| world | `alderforest`, a KINP world with an editor-canon parent and a playthrough child |
| files | 6, consulted in `MANIFEST.json`'s `consultOrder` |
| clauses | 1,630 |
| bytes | 143,807 |
| goals | [`QUERIES.txt`](QUERIES.txt) — 12 goals, each exhausted, 720 solutions in total |

`MANIFEST.json` records a sha256 per file and is the one place the scale is
stated; `scripts/measure.sh` runs `node generate.mjs --check` **before** it times
anything, so a mutated world fails the measurement instead of quietly changing
what the published figures describe.

## What is in it

The shapes are the ones the conformance corpus already uses
(`conformance/prolog/{gameplay,identity,worlds,equivalence}.json`), because a
benchmark over shapes nobody ships would measure the wrong Prolog:

- `world.pl` — the world chain (`world_parent/2` over
  `pinakes:world:consensus-reality` ← `insimul:world:alderforest` ←
  `alderforest%23save-7f`), plus the ancestor/scope and equivalence rules. The
  playthrough's `#` stays percent-encoded, undecoded, as KINP §3.1 requires.
- `places.pl`, `entities.pl`, `items.pl` — 36 locations in a containment tree,
  8 factions, 120 NPCs and 80 items, all as `id/3` terms over the world's CURIE,
  plus 70 `same_as/3` alias facts pointing at a `pinakes:canon` namespace.
- `quests.pl` — `quest/5`, `quest_objective/3`, `quest_reward/3`,
  `quest_prerequisite/2`, `quest_giver/2`: `@insimul/core`'s predicate schema.
- `rules.pl` — the derived predicates a session actually asks: quest
  availability with negation-as-failure, reward sums via `findall/3`, faction
  head counts, transitive containment, world scope.

Every predicate is either populated or declared `:- dynamic`, and no predicate
is named after an arithmetic functor — on one of the two engines those names are
also static builtins, and `assertz` on them raises `permission_error` (that is a
documented ABI non-promise, not something a benchmark should trip over).

## Regenerating

```sh
node bench/world/generate.mjs           # rewrite the .pl set + MANIFEST.json
node bench/world/generate.mjs --check   # verify the committed bytes (exit 1 if not)
```

The generator is deterministic — a fixed LCG, no clock, no `Math.random` — so
two machines produce byte-identical files. Changing the `scale` constants at the
top of `generate.mjs` changes the world, and therefore every published figure:
re-run `scripts/measure.sh` in the same commit.
