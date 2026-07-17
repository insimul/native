# insimul-native — conventions for the native Prolog core

## The ABI boundary is opaque
- `include/insimul.h` must **never** include Trealla headers or expose Trealla
  types. It is the contract three engine wrappers (C#/C++/GDScript) parse. The
  `abi` ctest includes *only* `insimul.h` to keep us honest — keep it that way.
- `src/insimul.c` is the only unit that includes `trealla.h`. It talks to Trealla
  through the **public** C API (`pl_create`, `pl_consult_fp`, `pl_query`/`pl_redo`,
  `set_quiet`, `get_status`), never internal headers.

## The C layer does not walk Prolog terms — the bootstrap does
- All term work (running goals, JSON-serializing solutions, catching exceptions,
  snapshotting) lives in **`src/insimul_boot.pl`**, consulted into every KB at
  create time. `cmake/gen_boot.cmake` embeds it as a NUL-terminated byte array
  (`insimul_boot_pl[]` / `_len`); `insimul.c` `fmemopen()`s it. To extend the ABI
  (US-LI3/LI4), add a `'$insimul_...'/N` helper there and a thin C wrapper.
- C↔Prolog data channel: C passes the goal/fact **inline as an escaped
  single-quoted atom** (`quote_atom`) and a **temp result-file path**; the helper
  writes tagged records (`SOL`/`ERR`/`OK`/`NONE`) one per line; C reads them back.
  This avoids process stdout/stderr entirely, so it stays per-KB / thread-safe.

## Trealla gotchas learned here (public C API)
- `pl_query` returns "ran without a *hard* error", not goal success; and its var
  dump goes to stdout. Give dispatch goals **no free top-level variables** and
  call `set_quiet(pl)` so nothing prints. Read solutions from the result file.
- Drive/free a sub-query with `while (pl_redo(q)) {}` (redo frees it when
  exhausted). Do **not** call `pl_done` on an already-exhausted query.
- `dynamic/1` does **not** exist as a runtime goal (only as a directive) — calling
  it throws `existence_error`. You don't need it: `assertz/1` auto-creates an
  undefined predicate as dynamic. `:- op/3` executed via `call/1` *does* affect
  subsequent `read_term/3`, so a read-term consult loop honors custom operators.
- Trealla's `consult/1` and loader print syntax errors to **C `stderr`** and can't
  be captured per-KB (fd redirection is racy and unreliable against Trealla).
  That's why consult is a transactional `read_term/3` loop in the bootstrap:
  syntax errors surface as **catchable** exceptions, and clauses are asserted only
  after the whole source parses (rollback on error).
- Capture a term's text deterministically with
  `with_output_to(atom(A), (current_output(S), <write to S>))` — `string(...)`
  renders oddly when re-written.
- **Create/destroy CYCLE hangs (process-global teardown).** A single
  `pl_create` … `pl_destroy` is fine, but `create → destroy(the last KB) →
  create` **deadlocks** the second full teardown. Trealla's `pl_destroy` calls
  `g_destroy()` when `g_tpl_count` hits 0 (tears down the global symbol table);
  re-`g_init`-ing it and tearing down again hangs. Mitigation for code that
  creates many KBs over time (the conformance harness, and eventually the engine
  plugins): keep **one long-lived KB open** so `g_tpl_count` never returns to 0 —
  then per-KB create/destroy is safe. See `tests/conformance.c` (`keepalive`).
  Flagged for human review in `progress.txt`; a real ABI-level fix (an internal
  keepalive/refcount in `insimul.c`) is a candidate follow-up.
- **Arithmetic functors are also STATIC builtin predicates.** Names like `log`,
  `sin`, `max`, `gcd` are registered in `src/bif_functions.c` as `name/N`
  predicates, not just evaluable functors. So a user KB that uses e.g. `log/1` as
  a dynamic predicate hits `permission_error(modify, static_procedure, log/1)` on
  `asserta`/`assertz` — ISO allows it (there `log` is an evaluable functor only)
  and tau-prolog accepts it. The conformance harness handles this with a
  documented, printed amendment (rename), never a silent skip — see its
  `AMENDMENTS` table.

## Build
- `cmake -B build && cmake --build build && ctest --test-dir build`. `build/` is
  gitignored (holds fetched Trealla under `_deps/` and the generated
  `insimul_boot.c`). `src/insimul_boot.pl` is the tracked source of truth.
