# The C ABI

This is the reference for `include/insimul.h` — the thirteen-function C interface every
consumer of libinsimul talks to, whether it is a C# game plugin, a Rust crate, or a
browser bundle. Read it to learn what each call does, the exact JSON a query hands back,
and (at the end) how the library produces that JSON without leaking engine types. If you
just want to *use* the library from a game engine or from JavaScript, start with
[consuming.md](consuming.md) or [webassembly.md](webassembly.md); come here when you need
the precise contract.

## Why the interface is a plain C ABI

Everything the library offers is exposed through one header, `include/insimul.h`, as
`extern "C"` functions over opaque handles. That is a deliberate design choice:

- **It leaks no engine types.** The header includes no Trealla headers and mentions no
  Trealla types. The Prolog engine is an implementation detail behind the boundary, so it
  can be swapped later without breaking anything that links this contract. (The `abi` test
  includes *only* `insimul.h` to keep that promise honest.) *No type* is a lower bar than
  *no behaviour*: [ABI_ENGINE_LEAK_AUDIT.md](ABI_ENGINE_LEAK_AUDIT.md) inventories what
  still shows through — solution order, error text, number marshalling, the snapshot
  image — with a verdict for each.
- **Every language can bind to it.** C, C++, C#, GDScript, Rust, and JavaScript all speak
  plain C. There is one surface to learn and one surface to keep stable.

## The two handles

The whole API revolves around two opaque pointer types:

- `insimul_kb` — a **knowledge base**: one Prolog world of facts and rules. Every KB is
  independent; there is no global mutable state shared across KBs.
- `insimul_query` — a live **query** over a KB, from which you pull solutions one at a
  time.

**Thread model.** One KB is owned by one thread. Because KBs share no mutable state, a
host may run N independent KBs on N threads — which is exactly what a game engine needs.
A single KB, its queries, and its error string must not be touched from more than one
thread at once.

## The calls

```c
insimul_kb *kb = insimul_kb_create();
insimul_kb_consult(kb,
    "parent(tom, bob).\n"
    "parent(bob, ann).\n"
    "grandparent(X, Z) :- parent(X, Y), parent(Y, Z).\n");   // -> 0
insimul_kb_assert(kb, "parent(ann, zoe)");                    // note: no trailing '.'

insimul_query *q = insimul_query_start(kb, "grandparent(tom, W)");
const char *sol;                       // NULL query => error, see insimul_last_error
while ((sol = insimul_query_next(q)) != NULL)
    puts(sol);                         // {"W":"ann"}
insimul_query_stop(q);
insimul_kb_destroy(kb);
```

| Function | What it does |
|---|---|
| `insimul_kb_create()` | Create a KB with the standard library available and an empty user program. Returns `NULL` only on init failure. |
| `insimul_kb_destroy(kb)` | Destroy a KB. `NULL` is a no-op; the handle is invalid afterwards. |
| `insimul_kb_consult(kb, source)` | Load program text — one or more clauses/directives. Directives (`:- Goal`, including `:- op/3`) run as they are read. Returns `0`; on a syntax error nothing is loaded, returns `-1`. |
| `insimul_kb_assert(kb, fact)` | Assert one clause given as term text **without** a trailing full stop. Undefined predicates auto-create as dynamic. Returns `0`/`-1`. |
| `insimul_kb_retract(kb, fact)` | Retract the first clause unifying with `fact`. Returns `0` if removed, `1` if none matched (not an error), `-1` on error. |
| `insimul_query_start(kb, goal)` | Start a query over `goal` (term text, no full stop). Returns a handle even for zero solutions; returns `NULL` if the goal raised an error. Release with `insimul_query_stop`. |
| `insimul_query_next(q)` | Return the next solution as a JSON binding-set string, or `NULL` when exhausted. See the format below. |
| `insimul_query_stop(q)` | Release a query handle (`NULL` is a no-op). |
| `insimul_kb_snapshot(kb)` | Serialize the KB's dynamic state to canonical Prolog text. See [snapshots.md](snapshots.md). |
| `insimul_kb_restore(kb, image)` | Replace the KB's dynamic state from a snapshot image. See [snapshots.md](snapshots.md). |
| `insimul_last_error(kb)` | The last error message for this KB, or `NULL` if the most recent call succeeded. Human-readable **detail**. |
| `insimul_last_error_class(kb)` | That error's **ISO error class** — the value to branch on. `NULL` when the last call succeeded. |
| `insimul_version()` | A static version stamp for this build. See [packaging.md](packaging.md). |

**Program text vs. terms.** `consult` takes one or more full clauses/directives, each
ending in a full stop. `assert`, `retract`, and `query_start` each take a **single term
with no trailing full stop** (e.g. `member(X, [a,b,c])`).

**Errors and string ownership.** Mutating calls return an `int` status. Whenever one
reports failure, `insimul_last_error_class(kb)` returns the **ISO error class** and
`insimul_last_error(kb)` the caught exception term as text; a successful call clears both
back to `NULL`.

Branch on the class, never on the text. The class is one of ISO/IEC 13211-1 §7.12.2's
fixed names — `instantiation_error`, `type_error`, `domain_error`, `existence_error`,
`permission_error`, `representation_error`, `evaluation_error`, `resource_error`,
`syntax_error`, `system_error` — plus `unknown` when a program threw something that is not
an `error/2` term. Those tokens are the same on any conforming engine. The *text* is the
engine's own rendering: for one and the same goal, this engine and tau-prolog differ in the
`throw/1` wrapper, in canonical vs operator notation for the predicate indicator, and in
which goal gets blamed. The one thing they never differ on is the class, which is why it is
the contract. (Anything below the class — the atom inside `syntax_error(...)`, say — is the
engine's vocabulary too.) Every `const char *` this ABI returns is **owned
by the object it came from** (the KB for `insimul_last_error`, the query for
`insimul_query_next`) and stays valid only until that object is destroyed/stopped or a
later call on the same object replaces it. **Callers copy anything they need to keep; they
never free a returned pointer.**

## Binding-set JSON format

`insimul_query_next` returns each solution as a JSON object — the exact shape every
wrapper (C#, C++, GDScript, Rust, JS) parses:

```
{ "Var": <value>, ... }        one entry per named goal variable
```

with Prolog terms mapped as:

| Prolog term          | JSON                                        |
|----------------------|---------------------------------------------|
| atom                 | string — `"foo"`                            |
| integer / float      | number — `42`, `4.5`                         |
| integer beyond 2⁵³−1 | `{"bigint":"<decimal digits>"}`             |
| `inf` / `nan` float  | `{"float":"inf"｜"-inf"｜"nan"}`             |
| list                 | array — `["wine", 3]` (empty list is `[]`)  |
| compound `f(A, ...)` | `{"functor":"f","args":[ <value>, ... ]}`   |
| unbound variable     | `null`                                      |

A goal that succeeds with no named variables yields `{}`; a goal that simply fails yields
no solutions (the first `insimul_query_next` returns `NULL`, and `insimul_last_error`
stays clear). Variables whose source name begins with `_` are omitted — including a
*named* one like `_Y`.

Three details that exist because JSON and Prolog do not line up (US-2; see
[ABI_ENGINE_LEAK_AUDIT.md](ABI_ENGINE_LEAK_AUDIT.md) L-06, L-13, L-14):

- **Big integers are not numbers.** A JSON number is an IEEE-754 double to every consumer
  we have, so an integer past 2⁵³−1 would silently round. It gets the `bigint` shape
  instead: lossless, and unmistakable for a compound (no `functor`/`args` keys).
- **The output is RFC 8259 JSON.** Every character below `U+0020` is escaped (`\n`, `\t`,
  `\b`, `\f`, `\r`, else `\u00XX`), so a strict parser never rejects a solution. A NUL
  byte inside an atom does *not* survive: the channel is C strings.
- **The cons functor is ours.** A partial list `[a|Y]` is a compound, and it is always
  reported as `{"functor":".", ...}` whatever the engine calls its cons cell internally.

**Reserved names.** Names beginning with `$` belong to the library's bootstrap. A goal,
asserted clause, retracted term, consulted clause or directive that mentions one is refused
with `permission_error(access, private_procedure, Name/Arity)` before it runs — the prefix
is a boundary, not a convention.

## How it works (implementation note)

You do not need this to use the library, but it explains why the boundary stays so clean.

The C layer **never walks Trealla term structures**. Each KB consults a fixed bootstrap
program, `src/insimul_boot.pl` (embedded as a C byte array by `cmake/gen_boot.cmake`),
that does all the Prolog-side work — running a goal, serializing solutions to JSON,
catching exceptions, snapshotting — and reports back through a per-KB temporary file
tagged one record per line. This keeps Trealla types out of `insimul.h` and avoids any
process-global stdout/stderr redirection, which is what preserves the one-KB-per-thread
model. To extend the ABI you add a helper predicate in the bootstrap and a thin C wrapper
around it, rather than reaching into engine internals.
</content>
</invoke>
