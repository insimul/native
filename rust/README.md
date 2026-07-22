# Rust bindings for libinsimul

A cargo workspace binding the native Prolog core (`include/insimul.h`) so the
Rust server can run the **same engine, on the same corpus**, as the Unity,
Unreal, and Godot wrappers.

```
rust/
├── insimul-sys/    raw `extern "C"` declarations + build.rs that links libinsimul
└── insimul/        the safe, idiomatic API — use this one
```

## Crate layout

**`insimul-sys`** is the unsafe layer: one `extern "C"` block mirroring every
function in `include/insimul.h`, plus `ensure_engine_keepalive()`. It has **no
dependencies** — the ABI is 11 functions over `*const c_char`/`c_int`, so the
bindings are hand-written rather than generated (bindgen would pull in libclang
and a large build-dep tree for very little). `build.rs` guards against drift:
every `insimul_*` function declared in the header must appear as a binding in
`src/lib.rs` or **the build fails**, so adding to the ABI forces a matching Rust
binding.

`build.rs` finds the repo root by walking up from `CARGO_MANIFEST_DIR` (looking
for a directory holding both `CMakeLists.txt` and `include/insimul.h`), then
searches `build/`, `build-*/` and their `Release/`/`Debug/` subdirectories for
`libinsimul.a`. Nothing is hardcoded; override with `INSIMUL_LIB_DIR` /
`INSIMUL_INCLUDE_DIR` if your build tree lives elsewhere. It links the **static**
archive, copied into `OUT_DIR` first so the linker cannot pick up the sibling
`libinsimul.dylib` (which is never installed and has no usable rpath).

**`insimul`** is what hosts use: `KnowledgeBase` with RAII (`Drop` frees the C
handle), `Result`-returning operations instead of the ABI's status-code +
`last_error` dance, and solutions decoded from the binding-set JSON into a
`Term`/`Bindings` model.

```rust
use insimul::KnowledgeBase;

let mut kb = KnowledgeBase::new()?;
kb.consult("parent(tom, bob).\nparent(bob, ann).\n")?;
kb.assert_fact("grandparent(X, Z) :- parent(X, Y), parent(Y, Z)")?;

for solution in kb.query("grandparent(tom, Who)")? {
    println!("{:?}", solution?.get("Who"));   // Some(Atom("ann"))
}
# Ok::<(), insimul::Error>(())
```

Also available: `solve` (collect every solution), `holds` (does the goal
succeed?), `retract_fact`, `snapshot`/`restore`, the free functions `version()`
and `live_handles()` (the leak gate — every handle this crate owns is released on
`Drop`, so a host that dropped everything sees `0`).

A `KnowledgeBase` is neither `Send` nor `Sync`: one KB is owned by one thread,
matching the ABI's thread model. `query`/`snapshot` take `&self` while the
mutators take `&mut self`, so the borrow checker enforces the ABI's rule that the
program cannot change while a solution iterator is alive.

## Build & test

**cmake first, then cargo** — `insimul-sys` links the archive the cmake tree
produces, so it must exist before `cargo build`:

```sh
cmake -B build -S ..        # from rust/; or `cmake -B build` from the repo root
cmake --build build -j
cargo build
cargo test
```

`cargo test` runs, in order of interest:

| test binary | what it covers |
|---|---|
| `insimul-sys` `tests/smoke.rs` | the raw ABI round-trips (create/consult/query/assert/retract/snapshot, error paths) |
| `insimul` `tests/api.rs` | consult, multi-solution query, assert/retract, every term shape, error mapping |
| `insimul` `tests/snapshot.rs` | snapshot/restore round-trip, determinism, the `op/3` caveat below |
| `insimul` `tests/stress.rs` | many KBs and iterators created and dropped, asserted leak-free via `live_handles()` |
| `insimul` `tests/conformance.rs` | **the parity gate** — the shared Prolog corpus, run through this wrapper |

The conformance runner reads the same `conformance/prolog/*.json` corpus the C
harness does, resolved as `INSIMUL_CONFORMANCE_DIR` → the vendored
`conformance/prolog` → the sibling `../insimul-runtime/packages/core/conformance/prolog`,
and prints the same `files / cases / passed / failed / amended` summary — so a
divergence between the C ABI and this binding shows up as a differing count. It
hard-fails (never skips) on a missing or empty corpus:

```sh
cargo test -p insimul --test conformance -- --nocapture
```

The full quality gate, all of which must be clean:

```sh
cargo build
cargo test
cargo clippy --all-targets --all-features -- -D warnings
cargo fmt --all --check
```

## Snapshot & restore

`snapshot()` serializes a KB's dynamic state — everything consulted or asserted —
as canonical Prolog text for a save file; `restore()` rehydrates it, parsing the
whole image *before* discarding anything, so a malformed image leaves the KB
untouched. Equal states produce byte-identical images, so
snapshot → restore → snapshot is a fixed point.

```rust
let image = kb.snapshot()?;              // persist this
let mut fresh = KnowledgeBase::new()?;
fresh.consult(world_rules)?;             // rules/ops from the export, first…
fresh.restore(&image)?;                  // …then the saved state
# Ok::<(), insimul::Error>(())
```

⚠️ **The `op/3` caveat.** A snapshot captures the **clause set only** — never the
`:- op(...)` directives that were in scope when the source was consulted. Clauses
are still *written* in operator notation, so an image containing them will not
parse in a KB that has not declared the same operators:

```rust
authored.consult(":- op(700, xfx, likes).\nalice likes wine.\n")?;
authored.snapshot()?;             // "alice likes wine.\n"  — the op/3 is gone

bare.restore(&image)              // Err(Prolog("...syntax_error(operator_expected)..."))
prepared.consult(":- op(700, xfx, likes).\n")?;
prepared.restore(&image)?;        // Ok
# Ok::<(), insimul::Error>(())
```

So: **re-consult the world's rules and operator directives into the fresh KB
before restoring a save**, which is the intended save/load shape anyway (rules
ship with the export, only the mutable state is in the save file). Sticking to
plain clauses avoids the issue entirely. `tests/snapshot.rs`
(`operator_directives_are_not_captured_by_a_snapshot`) pins this behaviour.

## Reference

- `../include/insimul.h` — the ABI contract, including the binding-set JSON shape
- `../README.md` — building the C library, the conformance suite, the snapshot format
- `../CLAUDE.md` — engine gotchas (notably the create/destroy teardown deadlock
  that `ensure_engine_keepalive()` works around)
