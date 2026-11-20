# The corebridge case corpus

Two directories of JSON case files, run by two harnesses that share nothing but
the files and the rules on this page:

| Directory | Written by | Holds |
|---|---|---|
| `../vendor/core/cases/` | `../tools/emit-bridge-cases.mjs`, from core at the pinned commit (`../core-pin.json`) | core's OWN corpora transcribed into bridge calls — every expectation is one core committed (`source.files` names each file and its sha256) |
| `cases/` | hand | behaviour no core corpus pins yet, and the bridge's own contract (sessions, errors, the method list) |

| Harness | Runtime | ctest |
|---|---|---|
| `../../tests/corebridge_cases.c` | `insimulcore.h` → QuickJS, the C SHA-256, the native Prolog seam | `corebridge_cases` |
| `../../tests/corebridge_cases.mjs` | the same bundle in a Node `vm` context → V8, Node's `crypto`, no Prolog | `corebridge_cases_js` |
| both, raw results diffed | | `corebridge_cases_parity` (a step declared as a library-version answer must differ instead, below) |

Every case runs on a FRESH runtime (a new `insimul_core` handle; a new `vm`
context), so session handles start at 1 in every case and can be written
literally.

## The case format

```json
{
  "area": "saves",
  "description": "…",
  "cases": [
    {
      "name": "unique within the file",
      "legs": ["c"],          // optional: only these harnesses run it ("c", "js"); needs "why"
      "why": "…",             // required with "legs": printed by the harness that does not run it
      "steps": [
        { "call": "save.encode", "args": { … }, "expect": <matcher>, "bind": "enc" },
        { "call": "save.decode", "args": { "envelope": { "$ref": "enc.envelope" } }, "expect": … },
        { "call": "core.methods", "argsText": "[1, 2]", "expectError": "must be a JSON object" }
      ]
    }
  ]
}
```

- `call` — the method; `args` — a JSON object (default `{}`); `argsText` — the
  argument string passed VERBATIM instead (for malformed-input cases).
- `expect` — the result must match (below). Neither `expect` nor `expectError`:
  the call must merely succeed.
- `expectError` — the call must FAIL, and `insimul_core_last_error()` (the JS leg:
  `"insimulcore: " + String(rejection)`, which is what the C host produces) must
  contain this text.
- `bind` — keep this step's parsed result under a name for later steps' `args`.
- In `args`, `{ "$ref": "name.path.to.value" }` is replaced by a deep copy of a
  bound result (path segments are object keys or array indices), and an optional
  `"$set": { "dotted.path": value, … }` beside it edits the copy (tampering a
  bound envelope, say).
- In `args`, `{ "$file": "<path>", "$path": "dotted.path" }` is replaced by a deep
  copy of a JSON file's value at `$path` (the whole file without it). The path is
  relative to the directory of the case file being run, must stay inside the vendored
  tree (no absolute path, no `../../`), and is read once per run. A generated case
  names a vendored corpus input this way instead of copying it into every step: the
  genre systems cases name the committed world slice
  (`../conformance/genre-mechanics/thistlecombe.world-slice.json`, `$path` `world`),
  which is 181 KB. Both harnesses implement it.

## Library-version answers

A step may carry `libraryVersion` where the row's answer depends on a table this
library's engine ships, and V8's differs: today the two case folds on letters and
marks Unicode 17.0 added, which QuickJS 2025-04-26's Unicode 16.0 tables do not
know (`cases/bridge-build.json`, PL.native-headless-fold-rules).

```json
{ "call": "build.foldMacos", "args": { "path": "…" },
  "expect": { "folded": "<the row's answer: this library's tables>" },
  "libraryVersion": {
    "library": "QuickJS 2025-04-26 (Unicode 16.0)",
    "v8": { "folded": "<V8's answer: Unicode 17.0>" },
    "why": "what the two tables disagree on" } }
```

- `expect` is the ROW's answer and the contract an engine binding the rows gets;
  the C leg holds QuickJS to it, and fails if QuickJS answers `v8` instead.
- `libraryVersion.v8` is V8's answer; the JS leg holds V8 to it, and fails if V8
  answers `expect`.
- `corebridge_cases_parity` requires the two raw answers to DIFFER on a declared
  step (every other step must be byte-identical), so a declaration fails the moment
  its cause goes (core names a Unicode version, QuickJS moves to 17.0, Node's tables
  change) and an undeclared difference fails as before.
- A declaration needs `library`, `v8` and a `why`, and `expect` (never
  `expectError`); `v8` equal to `expect` is a bad case.

## The matcher

A plain JSON value matches EXACTLY: objects have the same key set (order does not
matter), arrays the same length and elements in order, numbers are equal as
doubles, strings byte for byte. An object whose keys ALL start with `$` is an
operator:

| Operator | Matches |
|---|---|
| `{"$subset": {…}}` | an object holding at least these keys, each matched recursively (extra keys allowed) |
| `{"$approx": x, "$tol": t}` | a number within `t` of `x` (`t` defaults to 1e-9) |
| `{"$any": true}` | anything present |
| `{"$type": "string"}` | a value of that JSON type (`string`, `number`, `boolean`, `object`, `array`, `null`) |
| `{"$len": n}` | an array of length `n` |
| `{"$ids": [...], "$key": "id"}` | an array whose elements' `$key` field (default `id`) is exactly this list |
| `{"$multiset": [...]}` | an array with exactly these elements, in any order |
| `{"$stacks": {"potion": 2}}` | an array of `{ itemId, quantity }` whose quantities summed per `itemId` are exactly this map; an ABSENT value is the empty array (as core's trade runner reads `?.items ?? []`) |

The two harnesses implement these rules independently and must agree; a new
operator is added to both, and to this table, in the same change.

## Coverage, and the documented table

Both harnesses fail when a method `core.methods` lists is called by no case, or a
case calls a method that is not in the table (`no.such.method`, the unknown-method
error case, excepted). The JS leg also fails when the method table in
`../README.md` (between `BEGIN/END METHOD TABLE`) lists anything other than
exactly `core.methods`.
