# Snapshot & restore

This doc explains how to save a knowledge base to disk and load it back — the mechanism
behind a game's save files. The two calls `insimul_kb_snapshot` and `insimul_kb_restore`
are the bridge between a KB's *live* dynamic state and a *persisted* copy of it: snapshot
serializes, restore rehydrates.

```c
const char *image = insimul_kb_snapshot(kb);   // owned by kb; copy to keep
// ... persist `image` into the save file ...

insimul_kb *fresh = insimul_kb_create();
insimul_kb_consult(fresh, world_rules);        // rules/world from the export, FIRST…
insimul_kb_restore(fresh, image);              // …then rehydrate the saved state
```

## What a snapshot contains

A snapshot serializes the **dynamic user clause set only** — every fact and rule the host
consulted or asserted. The bootstrap's own predicates are excluded. The image is canonical
Prolog program text, one clause per line ending in `.`:

```prolog
age(alice,30).
friend(alice,pet(dog)).
inventory(bob,[sword,shield,3]).
knows(A,B):-likes(A,B).
knows(A,B):-likes(A,C),knows(C,B).
likes(alice,bob).
person(alice).
person(bob).
score(carol,4.5).
title(alice,'Grand Duchess').
```

It is **deterministic**: predicates are emitted in standard `Name/Arity` order and clauses
within a predicate in assert order, so two equal states serialize to **byte-identical**
text (the `snapshot` test asserts this). Facts write just the head; rules write
`Head :- Body` with variables rendered `A, B, C, …`; atoms needing quotes use single
quotes. The format is deliberately a subset that the wrappers' Prolog fact parser accepts,
so the same image round-trips through C, Rust, and the TypeScript-side parser alike.

## Restore replaces state

`insimul_kb_restore` parses the image **first** (a malformed image is rejected with `-1`
and the KB left untouched), then wipes all existing dynamic user clauses and loads the
image's clauses in order. So a round-trip — `consult base → assert → snapshot → fresh KB →
restore` — reproduces identical query results and re-snapshots to the identical image.

```sh
ctest --test-dir build -R 'snapshot' --output-on-failure
```

If the snapshot format ever changes legitimately, regenerate the golden fixture with
`INSIMUL_SNAPSHOT_UPDATE=1 ./build/insimul_snapshot` (run from the repo root).

## The `op/3` caveat — load rules before restoring

A snapshot captures the **clause set only**, never the `:- op(...)` operator directives
that were in scope when the source was consulted. Clauses are still *written* in operator
notation, so an image containing them will not parse in a KB that has not declared the same
operators:

```prolog
:- op(700, xfx, likes).
alice likes wine.        % snapshots as "alice likes wine." — the op/3 is gone
```

Restoring that image into a bare KB fails with a `syntax_error(operator_expected)`;
restoring it into a KB that has re-declared the operator succeeds. The rule is simple and
matches the intended save/load shape anyway:

**Re-consult the world's rules and operator directives into the fresh KB *before* restoring
a save.** Rules ship with the world export; only the mutable state lives in the save file.
Sticking to plain clauses (no custom operators) avoids the issue entirely. The Rust
binding's `tests/snapshot.rs` pins this behavior, and
[../rust/README.md](../rust/README.md) walks through it in idiomatic Rust.
</content>
