# Engine-leak audit of the libinsimul C ABI

**Status:** complete, evidence-backed, 2026-08-12 · **Engine audited:** Trealla Prolog
`v2.106.1` / `07de013677af760a8bca0594ae4b2bef158a3cde` (the pin in `CMakeLists.txt`)
· **ABI audited:** `include/insimul.h` @ `libinsimul 0.1.0` (12 functions)

This is US-1 of tasklist 251. It answers one question: **if the Prolog engine under
`insimul.h` were replaced tomorrow, what would break?** Not "what might" — what *does*,
with the file, the line, and the recorded output.

> **US-2 has since closed every row.** §1–§4 below are the audit as written, at the ABI it
> audited (12 functions); [§5](#5-what-us-2-did--the-disposition-of-every-finding) records
> what was done about each finding and which gate now holds it. Read §5 first if you want
> today's state; read §1 for the evidence. Line numbers and quoted behaviour are as of the
> audit, so several no longer reproduce — that is the point.

Everything below is a finding with an ID, evidence, and one of three verdicts:

| Verdict | Meaning | Who acts |
|---|---|---|
| **ISO** | ISO-defined semantics. Keep, but say so in the header — an undocumented dependency is a leak even when it is standard. | US-1 (record), US-2 (document) |
| **INSULATE** | Incidental. The engine happens to behave this way; a neutral layer can hide it. | US-2 |
| **ENGINE** | Genuinely engine-specific. Cannot be hidden without changing what the ABI means. Name it, gate on it, and let a swap fail loudly instead of silently. | US-2 (gate), swap program |

Counts: **19 findings — 2 ISO, 10 INSULATE, 7 ENGINE** (L-16 is INSULATE with an ENGINE
remainder and is counted once, as INSULATE). One of them, L-01, has *already* been worked
around seven separate times in five different repositories, which is the cost of a leak
nobody insulated.

## How the evidence was produced

`docs/audit/abi_leak_probe.c` includes **only** `insimul.h` — it is a consumer, not an
insider — and prints the raw strings the ABI returns. Its verbatim output is quoted
throughout and reproduced in [Appendix A](#appendix-a--recorded-probe-output).

```
cmake -B build && cmake --build build
cc -I include -o /tmp/abi_leak_probe docs/audit/abi_leak_probe.c build/libinsimul.a -lm
/tmp/abi_leak_probe            # the leak witness
/tmp/abi_leak_probe cycle      # L-01: does not terminate, by design
```

It is **not a gate** and is not wired into ctest. It is the witness the findings cite;
US-2 turns the INSULATE and ENGINE rows into gates that can fail.

The consumer sweep (§3) was a read-only grep of the sibling checkouts in the `insimul`
monorepo — `godot/`, `unity/`, `unreal/`, `server/`, `babylon/` — plus the two consumers
that live in this repo (`rust/`, `wasm/`). Line numbers are as of this audit.

**Prior art worth reading before US-2:**
`babylon/packages/core/docs/tau-wasm-parity.md` is a recorded, case-by-case comparison of
this library against a *second* Prolog (tau-prolog) over the same corpus — i.e. a real
engine-swap dry run, done for a different reason. Its D-1…D-8 divergences are cited below
where they corroborate a finding (L-04, L-08, L-11). Nothing in it contradicts this
audit; it adds a second data point to three of the rows and is the closest thing the
program has to "what actually happens when the engine changes".

---

## 1. The findings

### L-01 — `create → destroy(last KB) → create` spins forever · **INSULATE**

The single most expensive leak, because it is the one every consumer has already paid
for. Trealla tears down its process-global state (`g_destroy()`) when `g_tpl_count`
reaches 0; bringing it back up and tearing it down again never returns.

```
$ /tmp/abi_leak_probe cycle
cycle 1 create
cycle 1 destroy (last KB -> global teardown)
cycle 2 create
cycle 2 destroy            <- burns CPU forever; "SURVIVED both cycles" never prints
```

(Reproduced under `ulimit -t 25`, which killed it with SIGXCPU — it is a *spin*, not a
blocked wait, so it does not even show up as a deadlocked thread.)

`insimul.h` promises "`insimul_kb_destroy(NULL)` is a no-op; after it returns the handle
is invalid" and says nothing else. The real contract is *"never destroy your last KB"* —
and seven places across five repositories discovered it independently:

| Consumer | Workaround |
|---|---|
| `rust/insimul-sys/src/lib.rs:100-113` | `ensure_engine_keepalive()`, a deliberately leaked KB behind a `Once` |
| `rust/insimul/src/lib.rs:82-84` | every `KnowledgeBase::new` calls it first |
| `wasm/insimul-api.mjs:101-119` | `createKb()` opens a hidden never-destroyed keepalive KB |
| `tests/conformance.c:621-675` | a `keepalive` KB around the whole corpus run |
| `godot/gdextension/corebridge/src/insimulcore.c:120,294-296,348` | `core->keepalive`, "opened before anything else, closed last" |
| `server/rust/insimul-server/src/prolog/engine.rs:19-24` | documents it as the reason a KB-per-request model is safe at all |
| `unreal/.../Public/InsimulPrologSubsystem.h:126` | reasons about why it *doesn't* apply there |

That is a Trealla implementation detail carried by hand into three bindings, a server, a
Godot bridge and this repo's own test harness — and reasoned about in a fourth binding
that concluded it was safe. It is insulatable — an internal refcount/keepalive inside `insimul.c` makes
`insimul_kb_destroy` mean what the header already says — and until it is, every future
binding will rediscover it the hard way. `CLAUDE.md` already flags the ABI-level fix as
"a candidate follow-up"; this audit upgrades it to the top of US-2.

### L-02 — the vendor's name is a field in the ABI's own output · **INSULATE**

```
insimul 0.1.0 (git 3859faf, trealla v2.106.1/07de013677af760a8bca0594ae4b2bef158a3cde)
```

`insimul_version()`'s format is normative in the header ("of the form …") and names
`trealla` in it. That string is not decoration: it is a cross-repo contract.

- `scripts/package.sh:89-102` writes `trealla_tag` / `trealla_commit` keys into every
  package's `VERSION` file;
- `tests/wasm_package_smoke.mjs:139` rebuilds the stamp from those five fields and
  requires byte-equality with `insimul_version()`;
- `unreal/Source/ThirdParty/InsimulLibrary/VERSION:4-5` and
  `babylon/packages/core/src/prolog/vendor/prolog-wasm/VERSION:4-5` ship those keys;
- `babylon/packages/core/src/prolog/__tests__/prolog-wasm-vendor.test.ts:67,77` asserts
  the commit is 40 hex chars **and** that `insimul.version()` contains it.

So swapping the engine breaks a *test in another repository* — the right outcome for the
wrong reason. The field is legitimate (hosts must be able to identify the engine build);
naming the vendor in the *schema* is not. A neutral `engine <name>/<version>` pair keeps
the diagnostic and drops the coupling.

Unity's parser (`Runtime/Prolog/InsimulProlog.cs:181-208`, `NativeMethods.cs:62`) only
scans for the first `N.N.N`, so it survives a rename — but it documents the Trealla-shaped
stamp in three places and would read as a lie.

### L-03 — `double_quotes` is the engine's default, not a decision we made · **INSULATE**

```
double_quotes                  | {"F":"chars"}
double-quoted literal          | {"X":["a","b","c"]}
```

ISO's default is `codes`; SWI's is `string`; Trealla's is `chars`, and so is
tau-prolog's (`node_modules/tau-prolog/modules/core.js:4759-4762`) — which is *luck*, not
agreement, and it is the two engines this program has actually run. Whatever the engine
picks, the ABI hands it straight to the host: the same KB text yields `["a","b","c"]`,
`[97,98,99]` or `"abc"` in a binding set depending on the engine underneath. **It is also
persisted** — see L-16 (`dq("dq")` snapshots as `dq([d,q])`).

Nothing in `insimul.h`, `docs/c-abi.md` or the corpus states which one we want. The
bootstrap should pin the flag explicitly, so that it is insimul's decision and a swap
inherits it rather than re-rolling the dice.

### L-04 — `unknown = error` (undefined procedures raise) · **ISO**

```
unknown                        | {"F":"error"}
undefined procedure            | <START-FAIL> err=error(existence_error(procedure,no_such_pred/1),…)
```

ISO-defined default, and correct. But a consumer *depends* on it as control flow:
`unity/Runtime/Prolog/PrologGameAdapter.cs:205-224` (`TryEvaluate(goal, out undeclared)`)
treats "the engine raised" as "this rule set was never loaded → allow by default", which
is what `CanPerformAction` degrades on. Allow-by-default on *any* raised error is a wide
net: `babylon/packages/core/docs/tau-wasm-parity.md` D-6 records tau-prolog raising
`existence_error(procedure, member/2)` for a library predicate Trealla has resident, so
on that engine a perfectly loaded rule set would read as "not loaded" and permit
everything. The flag value is portable; *what raises* is not.

Keep the behaviour; **document it in `insimul.h`** as part of the contract — both that
undefined procedures raise, and that "raised" is not a synonym for "undefined". An
undocumented dependency this load-bearing is a leak even though the value is standard.

### L-05 — `bounded = false`: integers are unbounded · **ENGINE**

```
bounded                        | {"F":"false"}
unbounded integer              | {"X":12193263112482853211126352690}
```

Trealla ships arbitrary-precision integers (imath). A KB can therefore produce an integer
the ABI's JSON *emits correctly* and no consumer can *read* correctly (L-06). A bounded
engine would raise on the same goal instead. This cannot be hidden — it changes which
programs run — so name it: the ABI says whether integers are bounded, and the swap
gate checks it.

### L-06 — the JSON number mapping is lossy in three separate ways · **INSULATE**

```
integral float                 | {"X":1.0}
int/int exact                  | {"X":4.0}          <- 8/2, an implementation-defined choice
int/int inexact                | {"X":3.5}
power overflows to float       | {"X":1.6069380442589903e+60}   <- 2**200, silently float
negative zero                  | {"X":0.0}          <- -0.0 loses its sign
unbounded integer              | {"X":12193263112482853211126352690}
```

1. **`Int ÷ Int` is implementation-defined** (ISO 9.1.7). Trealla returns `4.0` for `8/2`;
   SWI returns `4`. The JSON *type* changes with the engine, so a C# host gets `double`
   where it got `long`, and a save written on one engine differs from the other.
2. **Big integers have no faithful representation.** `rust/insimul/src/term.rs:127-129`
   already gives up — "Integers beyond i64 can only come from a bignum; keep them as a
   float" — silently degrading precision. `JSON.parse` in the wasm/Babylon leg does the
   same. The value survives the ABI and dies in every binding.
3. **`-0.0` renders as `0.0`.** Minor, but it means the mapping is not round-trip.

The mapping is *ours*, in `src/insimul_boot.pl` `'$ij'/2`, so this is insulatable: spec
the numeric contract (and give big integers a lossless shape) rather than inheriting
whatever `write/1` prints.

### L-07 — standard order of terms puts **all** floats before **all** integers · **ENGINE**

```
sort mixed types               | {"L":[2.0,1,"a","b",{"functor":"f","args":["x"]}]}
compare(O, 1.0, 0)             | {"O":"<"}
compare(O, 2, 1.5)             | {"O":">"}
```

`compare(O, 1.0, 0)` answers `<`. By value, `1.0 > 0`. ISO 7.2.1 orders numbers **by
value**, using type only to break a tie (`Float` before `Int` when equal). Trealla orders
by type first, and `sort/2` shows it: `2.0` sorts before `1`.

This is exactly the "Trealla-specific term ordering" the tasklist warns about, and it is
*invisible*: every consumer sees a well-formed, plausibly-ordered solution list. Any KB
using `sort/2`, `msort/2`, `setof/3` or `@</2` over mixed numerics gets a different
answer order on a different engine — including the conformance corpus's own
`unordered: false` cases, which compare position by position.

Cannot be insulated without re-implementing the term order. **Name it and gate on it**:
a swap must run a term-ordering case and fail visibly.

### L-08 — the error channel is the engine's raw exception text · **INSULATE**

`insimul_last_error()` is a `const char *` of whatever the engine's writer produced:

```
undefined procedure     | error(existence_error(procedure,no_such_pred/1),no_such_pred/1)
type error              | error(type_error(evaluable,foo/0),(+)/2)
float overflow          | error(evaluation_error(float_overflow),* / 2)
```

Three distinct leaks in one string:

1. **The context argument is implementation-defined** (ISO 7.12.1 fixes only the formal
   part). `(+)/2`, `(is)/2`, `* / 2` — note the operator spacing — are Trealla's rendering.
2. **The formal part itself can be vendor-specific.** See L-09.
3. **The text is the only machine-readable form there is.** No code, no structured term —
   so any consumer that ever needs to distinguish "syntax error" from "type error" must
   string-match engine output. None does today (Godot `insimul_prolog.cpp:140-146` and
   Unreal `InsimulKB.cpp:526-529` pass the string straight through; Unity catches the
   exception without reading it), which is the only reason this is still cheap to fix.

**This one is already measured against a second engine.**
`babylon/packages/core/docs/tau-wasm-parity.md` D-3 tabulates tau-prolog against this
library for the same four goals, and *every* error path differs textually while the ISO
class never does:

| goal | tau-prolog | libinsimul (Trealla) |
|---|---|---|
| `nosuch(X)` | `throw(error(existence_error(procedure,/(nosuch,1)),/(top_level,0)))` | `error(existence_error(procedure,nosuch/1),nosuch/1)` |
| `X is foo + 1` | `throw(error(type_error(evaluable,/(foo,0)),/(is,2)))` | `error(type_error(evaluable,foo/0),(+)/2)` |
| `X is _Y + 1` | `throw(error(instantiation_error,/(top_level,0)))` | `error(instantiation_error,number)` |
| `foo((` | `throw(error(syntax_error(, or ) expected),[line(1),…]))` | `error(syntax_error(mismatched_parens_or_brackets_or_braces),read_term_from_atom/3)` |

Three axes move at once — the `throw/1` wrapper, canonical `/(nosuch,1)` vs operator
`nosuch/1` notation, and who gets blamed (`top_level/0` vs the offending goal) — and the
class is stable across all four. That is the shape of the fix: **surface the class, keep
the text as detail.**

### L-09 — `syntax_error(mismatched_parens_or_brackets_or_braces)` · **ENGINE**

```
syntax error in a goal | error(syntax_error(mismatched_parens_or_brackets_or_braces),read_term_from_atom/3)
consult syntax error   | error(syntax_error(mismatched_parens_or_brackets_or_braces),read_term/3)
```

ISO leaves the argument of `syntax_error/1` implementation-defined; this atom is
Trealla's own vocabulary and nothing else emits it. Gate on the *classification*
("this was a syntax error"), never on the atom.

### L-10 — the error context leaks **our own** bridge, not just the engine's · **INSULATE**

Same two lines. `read_term_from_atom/3` and `read_term/3` are `src/insimul_boot.pl`'s
internals: the host asked to run `foo(bar` and is told the error happened inside a
predicate it has never heard of, whose name changes whenever we refactor the bootstrap.
That is an insulation failure of the layer whose entire job is insulation.

### L-11 — arithmetic functors are also *static predicates* · **ENGINE**

```
asserta over a builtin name    | rc=0 err=(null)          <- assertz(log(1)) is ACCEPTED
asserta(log(0))                | permission_error(modify, static_procedure, log/1)
```

Trealla registers `log`, `sin`, `max`, `gcd` … as `name/N` *predicates*
(`src/bif_functions.c`), not merely evaluable functors, so a user KB that uses `log/1` as
a dynamic predicate is refused. ISO reserves those names only as evaluable functors, and
tau-prolog accepts them.

Already gated: the `AMENDMENTS` table in `tests/conformance.c:352-370` (mirrored in the
Rust and wasm legs, and documented at `unity/Tests/Editor/ConformanceCorpus.cs:165`) is
the repo's one amendment, printed on every run rather than skipped. Confirmed
independently from the other side by `tau-wasm-parity.md` D-2, which reaches the same
verdict and deliberately leaves the corpus unamended upstream so the difference stays
visible. Two refinements this audit adds: at the pinned version the refusal fires on
**`asserta` but not `assertz`** (recorded above), and the amendment's line is the *only*
place in the tree where a leak of this class is visible to a reader.

### L-12 — an unknown directive is silently ignored · **INSULATE**

```
consult unknown directive      | rc=0 err=(null)      (for ":- no_such_directive.")
```

`insimul.h` says directives "are executed as they are read" and that a bad consult
returns −1. A directive that throws returns 0 and reports nothing: the bootstrap's
`'$consult_collect'/2` wraps directives in `catch(..., _, true)`
(`src/insimul_boot.pl:118-122`). This is *our* choice, not the engine's, and it is
undocumented. A KB whose `:- set_prolog_flag(...)` typo is
swallowed behaves differently and reports success. Specify it (ignore, warn, or fail) and
say so.

### L-13 — control characters are emitted raw: the JSON can be invalid · **INSULATE**

```
atom holding U+000B            | {"X":"a^Kb"}        (0x0B, emitted unescaped; ^K is cat -v)
atom holding U+0000            | {"X":"ab"}          (the NUL is gone)
```

`'$ij_esc'/2` (`src/insimul_boot.pl:26-35`) escapes only `"`, `\`, `\n`, `\t` and `\r`.
RFC 8259 requires every character below `U+0020` to be escaped, so an atom containing `U+000B`, `U+0008` or `U+001F`
produces a document that `System.Text.Json`, `JSON.parse` and `serde_json` are entitled
to reject — from a call that reported success. Separately, a NUL inside an atom is
truncated away by the C-string channel.

Not a vendor leak — a defect in *our* neutral layer — but it belongs here because it is
the neutral layer's contract that US-2 has to be able to stand behind.

### L-14 — the list-cons functor is engine-specific · **ENGINE**

```
partial list [a|Y]             | {"X":{"functor":".","args":["a",null]},"Y":null}
```

A partial list falls through `'$ij'/2`'s `is_list/1` check into the compound branch and
surfaces the engine's cons functor: `'.'` in Trealla and ISO, `'[|]'` in SWI-Prolog 7+.
Consumers decode it structurally — `godot/gdextension/src/prolog_value.cpp:318-350`,
`unreal/.../InsimulKB.cpp:100,231` — so the atom reaches game code. Either normalise it
or make it part of the named contract; do not leave it as "whatever the engine calls
cons".

### L-15 — the bridge's own predicates are callable from a host goal · **INSULATE**

```
boot pred is visible           | {"X":"yes"}     (current_predicate('$insimul_query'/2))
boot pred is callable          | "hi"{"E":null,"X":null}
```

The second line is the interesting one: calling `'$ij_str'(user_output, hi)` from an
ordinary `insimul_query_start` goal **wrote `"hi"` to the process's stdout** — the exact
thing the temp-file result channel exists to avoid. `'$insimul_snapshot'/1` takes a file
path, and `'$snap_wipe'/0` erases the KB, so a hostile or merely careless goal string
reaches both. The `$` prefix prevents *accidental* collision; it is not a boundary.

### L-16 — the snapshot image is the engine's writer output · **INSULATE** (+ **ENGINE**)

The one surface where a leak becomes *durable*, because this text is what
`insimul.h` calls "the bridge to a save file's `currentState.prologFacts`". Given the
source on the left, the pinned engine writes the right:

| Wrote | Snapshotted as | Why it is a leak |
|---|---|---|
| `rule(X) :- neg(X), \+ fl(X).` | `rule(A):-neg(A), \+fl(A).` | writer spacing is implementation-defined — no space around `:-`, one after `,`, none after `\+` |
| `sci(1.0e10).` | `sci(10000000000.0).` | float re-rendering; source text is not preserved |
| `dq("dq").` | `dq([d,q]).` | **the `double_quotes` flag (L-03) is baked into the image** |
| `big(1267650600228229401496703205376).` | unchanged | a bounded engine cannot read its own save back (L-05) |
| `curly({a,b}).`, `opterm(1+2*3).` | unchanged | re-reading needs the same operator table and `{}/1` support |
| `esc('a\nb').`, `emptyatom('').` | unchanged | quoting convention is the writer's |

The *ordering* is ours and is ISO-clean (`sort/2` over `Name/Arity`, then `clause/2`
order), and the format is deliberately re-readable by the TypeScript
`prolog-fact-parser.ts` (`tests/run_snapshot_parse.sh`, golden at
`conformance/snapshots/basic.snapshot.pl`). What is *not* ours is every byte inside a
clause. Verdict: **INSULATE** the renderer (a canonical writer we own, not
`write_term/3`'s defaults) — with the bignum and operator-table rows flagged **ENGINE**,
because no renderer can make a bounded engine read `1267650600228229401496703205376`.

### L-17 — the thread model in the header is not proven, and one consumer disbelieves it · **ENGINE**

`insimul.h` states: *"There is no global mutable state shared across KBs, so a host may
run N independent KBs on N threads (required for Unity/Unreal)."*

That claim is false as written — L-01 is precisely a piece of global mutable state — and
the server refuses to rely on it (`server/rust/insimul-server/src/prolog/engine.rs:10-16`):

> There is exactly **one** worker. Trealla's symbol table is process-global (interning an
> atom mutates it) … Until that concurrency is proven safe *there*, a single engine
> thread is the honest configuration.

It is right that nothing proves it: **no test in this repo runs two KBs on two threads.**
For this audit a probe did — two threads × 150 × (create → consult → query → destroy),
interning distinct atoms — and completed cleanly 4/4 runs. That is *not* proof: it is an
unsanitised run of a racy-by-construction workload on one machine. The honest state is
**unknown**, and the header should not be the only thing asserting an answer.

Name it and gate on it: either a race-detector run makes the claim true, or the header
narrows to what is demonstrated.

### L-18 — non-ISO surface is silently available to KBs · **ENGINE**

```
lists:append/3                 | {"X":["a","b"],"E":null}
```

Module-qualified goals resolve; so do `between/3`, `format/3`, `msort/2`, `succ/2`,
`string_concat/3`, `term_to_atom/2`, `tab/1` (probed separately), while `nb_setval/2`,
`list_to_assoc/2` and `apply/2` do not. The ABI never says which library a KB may
assume, so "what a KB is allowed to write" is defined by whatever the vendored engine
happens to bundle. The conformance corpus is the de-facto answer for 76 cases; nothing
states it for the other infinity. Name the guaranteed set.

### L-19 — `insimul_query_start` is eager; there is no cancellation · **ISO**

`src/insimul.c:350-405` computes **every** solution at start (`findall/3` in
`'$insimul_query'/2`) and `insimul_query_next` walks a `char **`. The header says so
("computed eagerly at start (this suits finite goals)"), so this is documented, not
leaked — but it means a non-terminating goal hangs the calling thread with no handle to
stop it, on any engine. Recorded here because the swap program will be told "queries
stream" by the function names.

---

## 2. The 12 functions, one by one

Header **types** first: `insimul_kb` and `insimul_query` are opaque `struct`s, and every
other type in the file is `int`, `void` or `const char *`. **No vendor type appears in
`include/insimul.h`, and the `abi` ctest (`tests/abi.c`) includes only that header, so
the compiler enforces it.** The word "Trealla" appears in the header four times — once in
the invariant comment (fine) and three times in `insimul_version`'s normative format
(L-02).

| # | Function | Findings | Notes |
|---|---|---|---|
| 1 | `insimul_kb_create` | L-01, L-03, L-18 | "the standard library available" is undefined; the flag set is the engine's |
| 2 | `insimul_kb_destroy` | **L-01** | the documented contract and the real one differ |
| 3 | `insimul_kb_consult` | L-09, L-10, L-12 | rollback and `:- dynamic` handling are ours and ISO-clean |
| 4 | `insimul_kb_assert` | L-08, **L-11** | `permission_error` on names ISO reserves only as functors |
| 5 | `insimul_kb_retract` | L-08 | `0/1/-1` tri-state is ours and neutral; retracting a builtin gives `permission_error(modify,static_procedure,…)` |
| 6 | `insimul_query_start` | L-08, L-09, L-10, **L-07**, L-19 | solution *order* is the leak, and it is invisible |
| 7 | `insimul_query_next` | L-06, L-13, **L-14**, L-03 | the binding-set JSON is the widest surface: 5 wrappers parse it |
| 8 | `insimul_query_stop` | — | clean |
| 9 | `insimul_kb_snapshot` | **L-16**, L-05, L-03 | the durable surface |
| 10 | `insimul_kb_restore` | L-16 | accepts spaced/ISO-flavoured text and `0'a` literals, so it is more liberal than what it emits — good |
| 11 | `insimul_last_error` | **L-08**, L-09, L-10 | one string, no structure, engine-authored |
| 12 | `insimul_version` | **L-02** | the vendor's name is in the schema |

Also audited and **clean**: string ownership (borrowed, caller-copies, never freed by the
caller — consistent across all four returning functions); the `int` status convention
(`0` success / `-1` error / `1` "no match" on retract only); NULL-safety of the destroy
and stop calls; `extern "C"` guarding; the absence of any callback, struct-by-value or
enum in the surface (the three things that make an FFI ABI fragile). Arity and naming
conventions carry no module or engine prefix.

## 3. The consumers — what reaches past the ABI

Grepped read-only across the monorepo. Every hit, with the assumption it makes:

| File:line | Assumption | Finding |
|---|---|---|
| `rust/insimul-sys/src/lib.rs:90-113` | the engine tears down global state when the last KB dies → leak one KB forever | L-01 |
| `rust/insimul/src/lib.rs:82-84` | every `KnowledgeBase::new` must pin that global open first | L-01 |
| `rust/insimul/src/term.rs:127-129` | an integer past `i64` "can only come from a bignum" → silently store as `f64` | L-05, L-06 |
| `wasm/insimul-api.mjs:101-119` | first `createKb()` opens a hidden keepalive KB; comment cites "Trealla gotchas" | L-01 |
| `tests/conformance.c:621-675` | a `keepalive` KB wraps the corpus run | L-01 |
| `tests/conformance.c:352-377` | `log/1` is a static builtin here but not in tau-prolog → documented rename | L-11 |
| `tests/wasm_package_smoke.mjs:139` | the version stamp is exactly `insimul … (git …, trealla <tag>/<commit>)` | L-02 |
| `scripts/package.sh:89-102` | packages carry `trealla_tag` / `trealla_commit` keys | L-02 |
| `godot/gdextension/corebridge/src/insimulcore.c:120,294-296,348` | a `keepalive` KB opened first and closed last | L-01 |
| `godot/gdextension/src/prolog_value.cpp:318-350` | any `{"functor","args"}` object is a compound term — including `'.'` cons cells | L-14 |
| `godot/gdextension/src/insimul_prolog.cpp:105-131` | solution order is whatever the ABI gives; the snapshot image is an opaque `String` handed to GDScript | L-07, L-16 |
| `godot/gdextension/src/save_file.cpp:330-352`, `save_file.h:38-49` | every persisted fact argument is a C++ `double` | L-06 (see §4) |
| `unity/Runtime/Prolog/PrologGameAdapter.cs:205-224` | an undefined predicate *raises*, and that means "rule set not loaded → allow" | L-04 |
| `unity/Runtime/Prolog/InsimulProlog.cs:66,175-208`, `NativeMethods.cs:62` | the version stamp's documented shape names trealla; parser takes the first `N.N.N` | L-02 |
| `unity/Tests/Editor/ConformanceCorpus.cs:165` | mirrors the `log/1` amendment | L-11 |
| `unreal/Source/InsimulRuntime/Private/Prolog/InsimulKB.cpp:100,231` | decodes `{"functor","args"}` structurally | L-14 |
| `unreal/Source/InsimulRuntime/Public/InsimulPrologSubsystem.h:126` | reasons explicitly about "the Trealla keepalive concern" | L-01 |
| `unreal/Source/ThirdParty/InsimulLibrary/VERSION:4-5` | ships `trealla_tag` / `trealla_commit` | L-02 |
| `server/rust/insimul-server/src/prolog/engine.rs:10-24` | **one** engine thread, because the symbol table is process-global | L-17, L-01 |
| `server/rust/insimul-server/src/tau.rs:16-46,282` | a parity harness whose whole premise is tau-prolog vs Trealla answering alike | L-07, L-11 |
| `babylon/packages/core/src/prolog/vendor/prolog-wasm/{VERSION,insimul-api.mjs}` | vendored copies of the stamp and the keepalive wrapper | L-01, L-02 |
| `babylon/.../__tests__/prolog-wasm-vendor.test.ts:67,77` | asserts `insimul.version()` **contains the Trealla commit** | L-02 |

Two vendored copies of `insimul.h` exist —
`unreal/Source/ThirdParty/InsimulLibrary/include/insimul.h` (byte-identical to ours) and
`godot/gdextension/vendor/insimul/insimul.h` (identical plus a vendoring banner). Neither
has forked. Godot's banner records that the *previous*, hand-written copy had inverted
every return code — worth keeping in view when US-2 changes the contract.

## 4. The save-file surface — the question asked directly

**Is there a `prologFacts` / KB-image representation in users' saves that only Trealla can
read? No — not today. The risk is one commit away, and one part of it is already real.**

What is actually persisted (`babylon/packages/core/schemas/save-file.schema.json:126-141`,
`babylon/packages/core/src/save-file.ts:322`,
`godot/gdextension/src/save_file.cpp:330-386`):

```jsonc
"currentState": { "prologFacts": [ { "predicate": "has_item", "args": ["player", "bread", 2] } ] }
```

`SerializedFact = { predicate: string; args: Array<string | number> }` — flat ground
facts, string or number arguments. **No rules, no compounds, no variables, no engine
text.** It is engine-neutral, and any Prolog can produce and consume it. Godot writes it
from `kb_.facts()` and reads it back through `SaveSystem::restore_facts()`
(`bootstrap.cpp:60,93`); nothing writes a snapshot image into a save.

Three things keep this from being a clean bill of health:

1. **The ABI advertises the image as the save bridge.** `insimul.h` describes
   `insimul_kb_snapshot` as "the bridge to a save file's `currentState.prologFacts`", and
   `godot/gdextension/src/insimul_prolog.cpp:124-131` exposes `snapshot()` to GDScript as
   a plain `String`. The day someone persists that string — the obvious way to save a KB
   that has *rules*, which the current shape cannot hold — every byte in L-16 becomes
   permanent: writer spacing, float re-rendering, a baked-in `double_quotes` flag, and
   integer literals a bounded engine cannot read. That is the leak this story was written
   to catch, and it is currently *not* in saves. Keep it that way deliberately: US-2
   should state, in the header, that the image is an interchange/debug format and that
   the persisted form is the structured fact list.
2. **The numeric part of the leak is already persisted.** `PrologArg::num` is a C++
   `double` (`godot/gdextension/src/save_file.h:41`) and the TypeScript shape is
   `number`. An integer fact argument above 2⁵³ is silently corrupted on save — reachable
   today from an unbounded-integer KB (L-05/L-06), with no error anywhere on the path.
3. **`previousSnapshots` and `worldSnapshot`** (`save_file.cpp:222-312`) are *world*
   snapshots — JSON entity documents — not KB images. Checked; unrelated; no Prolog text.

## 5. What US-2 did — the disposition of every finding

US-2 is **done**. Every INSULATE row is either removed from the ABI or wrapped behind a
vendor-neutral shape, and every ENGINE row is now *named in `include/insimul.h`* under
"NOT PROMISED" instead of being an unstated assumption. The table below is the audit's
ledger closing; §6 is the original to-do list it was written against.

| # | Verdict | What US-2 did | Where the gate is |
|---|---|---|---|
| L-01 | INSULATE | `insimul.c` opens ONE internal engine instance on the first `insimul_kb_create` and never closes it, so `create → destroy(last) → create` works. The hand-rolled keepalives are deleted from `rust/insimul-sys`, `rust/insimul`, `wasm/insimul-api.mjs`, `corebridge/src/insimulcore.c`, `tests/conformance.c` and `tests/snapshot.c`. | `abi_neutral_runtime` cycles KBs with none held, under a ctest `TIMEOUT` (the old failure spins, it does not crash) |
| L-02 | INSULATE | The stamp is `insimul <semver> (git <sha>, engine <name>/<version>/<commit>)`. The vendor is a VALUE. `package.sh` writes `engine_name`/`engine_version`/`engine_commit`, with `trealla_*` kept as deprecated aliases for one re-vendor. | `version`, `abi_neutrality`, `wasm_package_smoke` (the alias may not drift) |
| L-03 | INSULATE | `insimul_boot.pl` pins `double_quotes = chars` and `unknown = error` explicitly. They are insimul's decisions now, inherited by any engine. | `abi_neutral_runtime` |
| L-04 | ISO | Documented in the header as PROMISED, together with the warning the Unity adapter needs: "raised" is not a synonym for "undefined" — branch on the class. | header + `abi_neutral_runtime` |
| L-05 | ENGINE | Named in the header under NOT PROMISED ("whether integers are bounded"), and L-06's shape means an unbounded integer at least crosses the ABI losslessly. | header + `abi_neutral_runtime` (`bounded` is asserted false) |
| L-06 | INSULATE | Integers beyond ±(2⁵³−1) are `{"bigint":"<digits>"}`; `inf`/`nan` floats are `{"float":…}` rather than invalid JSON. `rust/insimul` decodes both (`Term::BigInt`) instead of silently rounding to `f64`. The implementation-defined type of `Int ÷ Int` stays the engine's and is named as such. | `abi_neutral_runtime`, rust unit tests |
| L-07 | ENGINE | Named in the header under NOT PROMISED, spelled out: type-before-value ordering, `compare(O, 1.0, 0)` is `<`, and the failure mode ("the JSON still looks well formed"). Not insulatable without re-implementing the term order. | header + `abi_neutral_runtime` asserts `compare(O, 1.0, 0)` and `msort([1,2.0,a],L)` — a swap turns them RED instead of silently reordering answers |
| L-08 | INSULATE | New `insimul_last_error_class()` returns the ISO 7.12.2 class; the text is demoted to detail, in the header, in `docs/c-abi.md`, in the Rust `Error::Prolog { class, message }`, and in JS `InsimulError.class`. | `abi_neutral_runtime` (7 classes), rust `api`/`snapshot` tests now match on class, `wasm_smoke` |
| L-09 | ENGINE | Unchanged and now harmless: the Trealla-only atom lives *inside* the detail text, and nothing branches on it. | — |
| L-10 | INSULATE | `'$err_norm'/3` replaces an internal or unbound error context with the ABI call that raised, so a host is never told its syntax error happened in `read_term_from_atom/3`. | `abi_neutral_runtime` asserts the text names no bootstrap predicate |
| L-11 | ENGINE | Named in the header under NOT PROMISED; the corpus `AMENDMENTS` table (three legs, printed every run) stays the visible evidence. | `conformance` on all three legs + `abi_neutral_runtime` |
| L-12 | INSULATE | SPECIFIED: a directive that raises **or fails** fails the whole load, with the reason. It used to be swallowed by `catch(_, _, true)`. | `abi_neutral_runtime` |
| L-13 | INSULATE | `'$ij_esc'/2` escapes `\b`, `\f` and every remaining C0 control as `\u00XX`, so the binding set is RFC 8259 JSON. NUL truncation is documented as an ABI property. | `abi_neutral_runtime` |
| L-14 | ENGINE→ours | The cons functor is NORMALISED to `"."` whatever the engine calls it internally, so the name a host decodes is insimul's. | `abi_neutral_runtime` |
| L-15 | INSULATE | `'$guard'/2` walks every host term (goal, asserted clause, retracted term, consulted clause, directive) and refuses any `$`-prefixed name with `permission_error(access, private_procedure, N/A)`. The prefix is a boundary now. | `abi_neutral_runtime` (8 refusals, incl. the stdout-writing helper) |
| L-16 | INSULATE + ENGINE | The writer's option list is complete and explicit, the flag it depends on is pinned (L-03), and the header now says plainly: **the image is interchange/debug, not a save format** — the persisted form is the structured fact list. The engine remainder (operator spacing, float re-rendering, bignums a bounded engine cannot read) is named in the header. | `snapshot` (byte-identical golden), `snapshot_parse` |
| L-17 | ENGINE | The header's false claim is gone. It now says multi-threaded use is UNPROVEN and why, instead of asserting an answer no test supports. | header |
| L-18 | ENGINE | Named in the header under NOT PROMISED: only what the conformance corpus exercises is guaranteed to survive a swap. | header |
| L-19 | ISO | Unchanged; already documented. | header |

The ENGINE rows are gated in `tests/neutrality.c` rather than in the corpus: `conformance/
prolog` is a vendored mirror of `@insimul/core`'s, so a case added here would fork it (see
`conformance/VENDORED.md`). The gate lives in a file this repo owns and says out loud that
it is asserting behaviour the header does **not** promise, so a swap makes it red instead
of quietly changing answers.

**What the narrowing cost:** nothing in the corpus. 76/76 cases stay byte-identical across
the C, wasm **and Rust** legs — the Rust leg now emits the same JSON-Lines parity records
as the other two, so `scripts/conformance_parity.sh` diffs three legs instead of two.

**What still has to happen outside this repo:** the two vendored copies of `insimul.h`
(`unreal/Source/ThirdParty/InsimulLibrary/include/`, `godot/gdextension/vendor/insimul/`)
are now behind this one and must be re-vendored, not re-derived — a hand-written copy is
how one of them ended up with every return code inverted. The keepalive workarounds in
`server/rust/insimul-server`, `godot`'s bridge copy and `babylon`'s vendored
`insimul-api.mjs` are now redundant (harmless, just unnecessary).

## 6. What US-2 had to do (the original to-do list)

In blast-radius order:

1. **L-01** — internal keepalive/refcount in `insimul.c`; delete the workaround from five
   consumers, or at minimum make it unnecessary. Gate: a create/destroy/create cycle test
   that today spins.
2. **L-08 / L-09 / L-10** — a structured error surface (neutral classification + raw text
   as detail), and stop naming bootstrap predicates in it.
3. **L-16 / L-03** — own the snapshot writer and pin `double_quotes`; a golden image that
   changes only when we change it.
4. **L-06 / L-13 / L-14** — spec and fix the binding-set JSON: escaping, big integers,
   cons functor. This is the surface five wrappers parse.
5. **L-02** — neutral version schema (cross-repo; needs the packaging and Babylon vendor
   tests moved in the same change).
6. **L-15 / L-12** — close the bridge namespace; specify directive-failure behaviour.
7. **L-05 / L-07 / L-11 / L-17 / L-18** — the ENGINE rows: these do not get hidden, they
   get *named* in the header and *gated*, so a swap fails loudly. L-07 in particular needs
   a term-ordering case in the corpus; it is the leak that silently changes answers.

The bar the tasklist sets for all of it: 76/76 byte-identical across the C, Rust and wasm
legs (`scripts/conformance_parity.sh`). Every fix above changes bytes that gate compares,
which is the point — a narrowing that cannot be seen in that diff was not a narrowing.

---

## Appendix A — recorded probe output

Verbatim from `/tmp/abi_leak_probe` at the pin above, on macOS arm64. Non-printing bytes
are shown as `cat -v` renders them.

```text
== L-02 insimul_version ==
insimul 0.1.0 (git 3859faf, trealla v2.106.1/07de013677af760a8bca0594ae4b2bef158a3cde)

== L-03/L-04/L-05 engine flags visible through the ABI ==
double_quotes                  | {"F":"chars"}
unknown                        | {"F":"error"}
bounded                        | {"F":"false"}
occurs_check                   | {"F":"false"}
double-quoted literal          | {"X":["a","b","c"]}

== L-06 number marshalling ==
integral float                 | {"X":1.0}
int/int exact                  | {"X":4.0}
int/int inexact                | {"X":3.5}
unbounded integer              | {"X":12193263112482853211126352690}
power overflows to float       | {"X":1.6069380442589903e+60}
negative zero                  | {"X":0.0}
float overflow                 | <START-FAIL> err=error(evaluation_error(float_overflow),* / 2)

== L-07 standard order of terms ==
sort mixed types               | {"L":[2.0,1,"a","b",{"functor":"f","args":["x"]}]}
compare(O, 1.0, 0)             | {"O":"<"}
compare(O, 2, 1.5)             | {"O":">"}

== L-08..L-12 error terms (raw insimul_last_error text) ==
undefined procedure            | <START-FAIL> err=error(existence_error(procedure,no_such_pred/1),no_such_pred/1)
type error                     | <START-FAIL> err=error(type_error(evaluable,foo/0),(+)/2)
syntax error in a goal         | <START-FAIL> err=error(syntax_error(mismatched_parens_or_brackets_or_braces),read_term_from_atom/3)
asserta over a builtin name    | rc=0 err=(null)
asserta(log(0))                | {"E":{"functor":"error","args":[{"functor":"permission_error","args":["modify","static_procedure",{"functor":"/","args":["log",1]}]},{"functor":"/","args":["asserta",1]}]},"F":{"functor":"permission_error",…},"X":{"functor":"permission_error",…}}
consult syntax error           | rc=-1 err=error(syntax_error(mismatched_parens_or_brackets_or_braces),read_term/3)
consult unknown directive      | rc=0 err=(null)

== L-13/L-14 JSON well-formedness (control chars, cons functor, sharing) ==
atom holding U+000B            | {"X":"a^Kb"}
atom holding U+0000            | {"X":"ab"}
partial list [a|Y]             | {"X":{"functor":".","args":["a",null]},"Y":null}
aliased variables              | {"X":null,"Y":null}

== L-15 the bridge's own predicates are in the KB namespace ==
boot pred is visible           | {"X":"yes"}
boot pred is callable          | "hi"{"E":null,"X":null}

== L-18 module-qualified goals resolve ==
lists:append/3                 | {"X":["a","b"],"E":null}

== L-16 snapshot image rendering (this text reaches save files) ==
--- image ---
big(1267650600228229401496703205376).
curly({a,b}).
dq([d,q]).
emptyatom('').
esc('a\nb').
fine(1).
fl(1.0).
listy([a|A]).
neg(-1).
opterm(1+2*3).
quoted('hello world').
rule(A):-neg(A), \+fl(A).
sci(10000000000.0).
--- end ---
```

(`^K` is `U+000B` emitted unescaped — L-13. `fine(1)` is present and `ok(1)` absent
because the failed consult in the L-06 block rolled back, as designed.)

The teardown cycle, run separately because it does not return:

```text
$ ulimit -t 25; /tmp/abi_leak_probe cycle
cycle 1 create
cycle 1 destroy (last KB -> global teardown)
cycle 2 create
cycle 2 destroy
zsh: cpu limit exceeded   (no "SURVIVED both cycles")
```

## Appendix B — probes run but not leaked

Recorded so the next reader does not repeat them. Library predicates reachable from a
fresh KB: `between/3`, `format/3` (via `with_output_to/2`), `msort/2`, `succ/2`,
`string_concat/3`, `term_to_atom/2`, `tab/1`. Absent: `nb_setval/2`, `list_to_assoc/2`,
`apply/2`, `sleep/1`, `process_create/3` (L-18). `insimul_kb_restore` accepts
ISO-flavoured input it would never emit — spaced clauses, `0'a` character-code literals —
so it is more liberal than its writer, which is the right asymmetry. `clause/2` over a
bootstrap predicate is refused (`permission_error(access, private_procedure, …)`), so
L-15's exposure is call-only, not inspect-and-rewrite.

Two binding-set conventions are *ours*, documented in the header, and were checked against
the second engine rather than assumed (`tau-wasm-parity.md` D-4, D-5): an unbound variable
is `null` (tau binds it to its own name as a string, which is ambiguous with a real atom),
and a variable whose source name starts with `_` is omitted (tau leaks `{"_":"_"}`). Both
of ours are the better contract; the second has one caller-visible edge worth keeping in
mind at US-2 — the rule is name-based, so a *named* `_Y` is dropped too.
