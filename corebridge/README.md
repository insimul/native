# `libinsimulcore` — running `@insimul/core` from a native engine

This directory is the answer to the question the whole unification program hung
on: **how does a C++/C#/GDScript engine run 19,000 lines of TypeScript?**

The answer (`RUNTIME_CORE_ADOPTION.md` §4.5) is *not a language*. It is a **C
ABI** — `include/insimulcore.h`, five functions, opaque handle, JSON in, JSON out
— shaped exactly like `libinsimul`'s ABI, which Godot, Unity and Unreal already
consume successfully. Behind that ABI runs core's TypeScript inside an embedded
**QuickJS** today, and a Rust port later if it is ever funded, *without any
adapter noticing the difference*.

Zero lines of core are re-implemented here. TypeScript stays the single
semantics authority.

## Why it is in this repo

It was built in `insimul-godot/gdextension/corebridge/`, because the tasklist
that built it (100) had that repository as its worktree. That was always
temporary. The corollary it recorded is the reason this directory now exists:

> **Do not invent a second mechanism.** If Unity needs core, it P/Invokes
> `libinsimulcore`. If Unreal needs core, it links `libinsimulcore`. The bridge
> is built once, not three times.

A bridge that lives inside one engine's plugin gets forked by the second engine
that needs it. Promoting it here — beside `libinsimul`, built by the same CMake,
packaged by the same `scripts/package.sh` — is what makes "built once" true
rather than aspirational.

**`insimulcore.h` moved byte-for-byte.** It is the contract three engines bind,
and a header that forks between repositories is the exact failure this move
prevents; so the copy here is `diff`-identical to the one in the Godot plugin,
including its closing paragraph about where the bridge "should eventually live".
That paragraph is now satisfied by this very directory, and it will be dropped
when the Godot plugin stops carrying its own copy — which is a change in *that*
repository, with its own tasklist. Leaving both briefly is safer than breaking a
working adapter from outside it.

## The stack

```
engine host              Godot GDScript / Unity C# / Unreal C++
   │  Dictionary → JSON      ← the ONLY place engine types are translated
engine wrapper           e.g. Godot's gdextension/src/insimul_core.{h,cpp}
   │  C ABI                  insimul_core_call(h, "radiant.generate", json)
libinsimulcore           src/insimulcore.c  =  QuickJS + the vendored core bundle
   │  JS → C                 __insimul_prolog_{create,consult,query,destroy}
libinsimul               Trealla, natively linked (../include/insimul.h)
```

Dependencies run one way only: adapters depend on core. Core gains no knowledge
of any engine, and this repository gains no edge into `packages/core` beyond two
vendored artifacts (the bundle here, the corpus in `../conformance/`).

## Why the Prolog seam is wired to the native engine

Core's `createPrologEngine()` dynamic-imports `WasmPrologEngine`, which
instantiates libinsimul/Trealla compiled to **wasm32**. QuickJS has no
WebAssembly — and even if it did, wrapping a wasm build of an engine this
library already links natively would be absurd.

So the bundler resolves core's `../prolog/prolog-engine` import to
`js/host-prolog-engine.js`, an adapter-owned module implementing the same seam
over libinsimul's C ABI. **Core's source is never patched**; only the resolution
of its seam import changes, which is what a seam is for. The contract amendment
that would make this explicit (an injectable engine rather than a resolver
trick) is `RUNTIME_CORE_ADOPTION.md` §8.

`js/host-prolog-engine.js` therefore has one hard obligation: agree with
`packages/core/src/prolog/wasm-engine.ts` on everything the caller can observe —
`collapseTerm`, the trailing-`.` trim, the 1000-result default. The conformance
corpus is what proves it.

## Layout

| Path | What it is |
|------|------------|
| `include/insimulcore.h` | **The contract.** The one file that must not fork. |
| `src/insimulcore.c` | The QuickJS host: ABI, promise pump, Prolog bridge. |
| `js/entry.js` | The adopted surface — one entry per callable core method. |
| `js/host-prolog-engine.js` | Core's Prolog seam, implemented over libinsimul. |
| `js/host-crypto.js` | Stand-in for Node's `crypto`, which core's `save-envelope.ts` imports at module scope. It **throws**: nothing on the adopted surface hashes, and a plausible wrong digest is worse than a stop. See `RUNTIME_CORE_ADOPTION.md` §8. |
| `vendor/quickjs/` | QuickJS 2025-04-26, unmodified (see `../THIRD_PARTY.md`). |
| `vendor/core/` | **Generated.** The bundled core + its provenance. Never hand-edit. |
| `tools/vendor-core-bundle.mjs` | Produces `vendor/core/`, and the `--check` drift guard the `core_vendor` ctest runs. |
| `CMakeLists.txt` | The two targets: `insimulcore` (static) + `insimulcore_shared`. |

## The method table, and what "adopted" means in it

`js/entry.js` holds every callable method. Two of them are **not** adopted
runtime surface:

| method | status |
|---|---|
| `radiant.generate`, `radiant.baseTemplates` | **adopted** — Godot's `InsimulRadiantSource` calls these at runtime. |
| `quest.hydrate`, `quest.radiantTick` | **comparison only.** Nothing in a runtime calls them; they exist so the Godot plugin's `run_quest_parity_tests.sh` can diff core against its hand-ported `quest_system.cpp` over the same vectors. Quest hydration is still served by the C++ port. See `RUNTIME_CORE_ADOPTION.md` §10.3. |
| `core.methods` | introspection, so a gate can assert the surface. |

Keeping that distinction visible matters: a method reachable across the ABI is
not the same as a capability an engine has adopted, and the gates assert the
surface by name precisely so the two do not blur.

## Building

There is nothing special to do — `libinsimulcore` builds with everything else:

```sh
cmake -B build && cmake --build build && ctest --test-dir build
```

Artifacts land beside `libinsimul`'s, in the top-level build directory:
`build/libinsimulcore.a` and `build/libinsimulcore.dylib` (`.so` / `.dll`
elsewhere). `scripts/package.sh` copies the shared one and `insimulcore.h` into
`dist/<platform>/` — see `../docs/consuming.md` for the GDExtension, P/Invoke and
Unreal-module linkage recipes.

The shared library **static-links `libinsimul`**, so it loads on its own with no
rpath dance. That is safe precisely because the two ABIs share no state: no
`insimul_kb` handle ever crosses `insimulcore.h`.

It is **not** built for wasm (`cmake/wasm.cmake` returns before this directory is
added). A browser host runs `@insimul/core` as the TypeScript it already is;
compiling a JS engine to wasm in order to run JS would be circular.

## Adopting more of core

1. Add a method to the table in `js/entry.js`.
2. Re-vendor the bundle from a checkout that has `packages/core`:
   ```sh
   node corebridge/tools/vendor-core-bundle.mjs --core ../babylon/packages/core
   ```
3. Add corpus coverage for the new method and extend the gate.

The bundle is a **checked-in build artifact**, not a build step, because this
repository is standalone by design — it cannot run a bundler against a package it
does not contain. It carries a recorded source commit and a sha256 per file, and
the `core_vendor` ctest fails if any of them disagree — including the `js/` files
bundled *into* it, so an adapter edit that was never re-vendored is caught rather
than silently ignored. Pass `--core` to `--check` as well to additionally
re-bundle and diff against core itself, which is the real drift check:

```sh
node corebridge/tools/vendor-core-bundle.mjs --check --core ../babylon/packages/core
```

## Limits worth knowing

- **Nothing per-frame crosses this boundary.** Every call is a JSON round trip.
  Core is the decision layer; rendering, input and physics stay engine-side.
- **`insimul_core_call` is synchronous**, driving the JS job queue until the
  promise settles. Every promise in the adopted surface is resolved by JS or by
  a synchronous C call. A method that awaits real I/O would need a pump driven
  from the host's frame loop — the ABI would not change.
- **One handle, one thread**, exactly like an `insimul_kb`.
- **A `keepalive` KB is held open** for the handle's lifetime, working around the
  libinsimul create/destroy-cycle defect documented in the top-level `CLAUDE.md`
  ("Create/destroy CYCLE hangs") and `RUNTIME_CORE_ADOPTION.md` §6.7. Delete it
  when libinsimul is fixed.
