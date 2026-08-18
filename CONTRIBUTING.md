# Contributing to `insimul-native`

This repository is **layer zero**. `libinsimul` is the Prolog core that four
engine plugins (Godot, Unity, Unreal, the browser), a Rust server and every save
file sit on, behind one deliberately opaque C ABI. A change here reaches all of
them at once, and a change to `include/insimul.h` is a change to a contract
three engine wrappers parse. So the bar is a little different from a normal
library's, and the sections below say how.

Start with [`CLAUDE.md`](CLAUDE.md). It is the repository's real design
document — what the ABI boundary promises, why the C layer never walks Prolog
terms, why the engine is vendored rather than fetched, and a long list of things
this codebase learned the hard way and does not want to re-learn.

## The decision that usually gets left as a TODO: **DCO, not a CLA**

**Decision (2026-08-17): contributions are accepted under the [Developer
Certificate of Origin 1.1](https://developercertificate.org/), signed off per
commit. There is no CLA, and there will not be one by default.**

Sign off with:

```sh
git commit -s          # appends: Signed-off-by: Your Name <you@example.com>
```

That line is a statement about the commit — that you wrote it, or have the right
to submit it under this repository's license. It is not a copyright assignment
and not a separate legal agreement to sign.

This is the **same decision `insimul/core` recorded on the same date**, and that
is deliberate: a contributor who works across the contract repository and the
native core should not have to find out that the two ask for different things.
The reasoning is core's, and it holds here:

- **Apache-2.0 already grants inbound what the project needs outbound.** §5 says
  a contribution is licensed under the same terms as the work unless you say
  otherwise — patent grant included, which is the reason this project chose
  Apache-2.0 over MIT in the first place. A CLA on top buys one additional
  thing: the right to relicense your contribution unilaterally.
- **We do not need that right.** Insimul's commercial position is the closed
  generation backend and the hosted studio, not the ability to relicense the
  engine substrate. Opening the substrate is the point of it.
- **A CLA is an adoption tax on exactly the people this repository opens for** —
  implementers writing or porting a runtime. The cost lands on them and the
  benefit lands on us, which is the wrong way round for a substrate.
- **A DCO is enforceable by a machine.** `git commit -s` and a CI check; a CLA
  needs a bot, a signature store and somebody to operate both.

**What it costs us, stated plainly:** relicensing `insimul-native` later would
require every contributor's consent. That is the trade, recorded here rather
than discovered during a relicensing.

**Revisit if** the project wants to relicense or commercially dual-license the
native core, or if a contributor's employer requires a signed agreement — the
latter handled per-contribution, not by making everyone sign one.

The decision, its rationale and the enforcement follow-up are also recorded
machine-readably in [`docs/pre-open/status.json`](docs/pre-open/status.json)
(`contributorAgreement`), which the `attribution` ctest checks is a decision
rather than a TODO. Sign-off is asked for here today and will be **enforced in
CI at the point this repository becomes public** — enforcing it against a
single-org pre-flip history would fail every existing commit for no benefit
(`dco-enforcement-at-flip` in the same record).

## The name: trademark and conformance-mark policy

**The code here is open. The name is not the code.** The policy that says what
you may do with "Insimul" and what "Insimul-compatible" requires lives in the
contract repository and is **linked, never copied**:

> **[Trademark and conformance-mark policy](https://github.com/insimul/core/blob/main/TRADEMARK.md)** — `TRADEMARK.md` in `insimul/core`.

That single copy is the policy for this repository too. Five copies of a
trademark policy is five policies, and the first time one of them is edited the
mark means five different things — so a `TRADEMARK.md` in *this* tree is a gate
failure (`forked-policy` in `scripts/check-attribution.mjs`), not a
contribution. If the policy needs to change, change it there.

Two consequences worth naming here, because they land on this repository
specifically:

- **A conformance claim is about the corpus, not about this library.**
  `conformance/prolog/` is a *vendored mirror* of core's corpus
  (`conformance/VENDORED.md`), and every leg here runs it unmodified. Editing a
  case to make a leg pass converts the mark into a statement about nothing —
  which is why the amendment this repository does need (arithmetic functors that
  are also static predicates) is a **printed `[AMEND]` line** in all three
  harnesses, never a silent skip.
- **An ABI change can be a certification event.** The binding-set JSON, the
  error classes and the snapshot format are what a save file and five wrappers
  agree about. Flag a change to any of them in the PR.

## Before you open a pull request

Run all five gates, from the repository root, cheapest-to-fail first:

```sh
cmake -B build && cmake --build build && ctest --test-dir build   # 1
scripts/build_wasm.sh                                             # 2
scripts/conformance_parity.sh                                     # 3
scripts/package.sh && scripts/package.sh --target wasm            # 4
cargo test --manifest-path rust/Cargo.toml                        # 5
```

`CLAUDE.md` §Build is the authoritative list. What the five are for:

| Gate | What it protects |
| --- | --- |
| 1 · ctest | Everything that is a property of the tree: the ABI's opacity (`abi`, `abi_neutrality`), the vendored engine's provenance (`trealla_vendor`), the vendored core bundle (`core_vendor`), and the three pre-open audits (`history_scan`, `open_boundary`, `attribution`). |
| 2 · wasm | The second toolchain. One `CMakeLists.txt` builds both, so a native-only change can still break the browser target. |
| 3 · parity | **The highest-signal one.** It diffs the *raw* ABI strings across the native, wasm and Rust legs, so it catches divergence in solution order, error wording or number formatting that each leg's own `expected` check would happily pass. |
| 4 · package | What a consumer actually receives, including the `VERSION` stamp and the wasm package's exports map. |
| 5 · cargo | The Rust wrapper and its own conformance leg. |

**A ctest that passes in 0.00s is a skip.** `snapshot_parse` and `core_vendor`
degrade to a loud `[SKIP]` without node or the sibling submodule; read the
output rather than the summary line. (`corebridge_radiant_none` is the exception
that proves it — ~0.01s, and it really does assert 11 cases.)

## The rules that are specific to this repository

**1. The ABI boundary is opaque, and it names no vendor.** `include/insimul.h`
must never include an engine header, expose an engine type, or name a vendor —
not in a type, a macro or a format string. Two ctests hold it, and each check
also runs against a deliberately broken fixture. `src/insimul.c` names no engine
either; it talks to the three-function port in `src/insimul_engine.h`.

**2. The C layer does not walk Prolog terms.** All term work lives in
`src/insimul_boot.pl`. Extending the ABI means adding a `'$insimul_...'/N`
helper there and a thin C wrapper — not term-walking C.

**3. The engine is VENDORED, and never hand-edited.** `vendor/trealla/` is a
committed source drop; `vendor/trealla/VENDORED.md` says how to re-vendor. The
build performs **no network fetch**, and `open_boundary` fails if one appears. A
pin bump means updating `commit`/`tag`/`gitObjects` together and **re-reading
the license text** ([`docs/TREALLA_LICENSE_FINDING.md`](docs/TREALLA_LICENSE_FINDING.md)
§8) before the `NOTICE` can keep claiming what it claims.

**4. Guards are falsified before they are believed.** Every checker here has a
negative control that watches the rule fire — `trealla_vendor` tampers a byte,
`abi_neutrality` compiles a broken fixture, `open_boundary` injects five real
violations into a copy of the real tree, `history_scan` runs a real
`git filter-repo` over a repository with a planted key. If you add a guard, add
its falsification. A check that cannot fail is worse than no check, because
somebody will point at it when asked whether the boundary holds.

**5. A rule that fires on correct code is a wrong rule, not an allowance
opportunity.** Fix the rule. Allowances are permanent holes; the C `#include`
rule's history in `docs/pre-open-audit.md` §2.4 is the worked example.

**6. Adding a dependency is a deliberate act.** This repository declares no npm
dependencies at all and two Cargo ones. Anything new widens the graph a
standalone clone has to resolve, needs a `NOTICE` stanza with the license read
from the crate's own text, and needs an entry in `allowedCrates`. Nothing here
may import from the closed repositories, and `open_boundary` closes that as a
graph rather than as a deny-list.

**7. The content boundary.** Only contract-level material ships here. Genre
bundles, language corpora and generation heuristics are closed content. A new
`.pl` file fails `open_boundary` until somebody records which side of the line
it is on — that is the rule working, not a bug: the closed asset and the open
asset have the same file extension, so the extension cannot decide.

**8. Docs are part of the change.** `CLAUDE.md` carries the design rules and
`docs/` the explanations; a measured figure may only be quoted if
`scripts/measure.sh` produced it.

## Reporting a security issue

Do not open a public issue. Report it privately through GitHub's **Report a
vulnerability** flow on this repository (Security → Advisories), and give the
maintainers a reasonable window to respond before disclosing. No security
contact address is published here on purpose: an address in a file is one that
must be kept working, and the private advisory flow reaches whoever maintains
the repository today.

## Licensing of contributions

By contributing, you agree that your contribution is licensed under
[Apache-2.0](LICENSE), the license of this repository, and you certify its
origin under the DCO as described above. If your contribution includes or
derives from third-party work, say so in the PR **and add its stanza to
[`NOTICE`](NOTICE)** — the `attribution` gate will catch a vendored directory or
a new crate that nobody attributed, but it cannot tell that a file was pasted
from somewhere. That part is on the contributor, and it is the one thing in this
document that cannot be automated.
