//! The golden Prolog conformance gate, run from Rust (US-FFI3).
//!
//! This is the Rust leg of the cross-language parity gate: it consumes the SAME
//! corpus (`conformance/prolog/*.json`) that `tests/conformance.c` drives
//! through the raw C ABI and that the TypeScript/Godot/Unity/Unreal legs run.
//! Passing here proves the safe wrapper (US-FFI2) preserves the core's
//! semantics end to end — Rust ⟷ C parity on the Prolog core.
//!
//! Corpus shape (see the corpus README in `@insimul/core`):
//!
//! ```jsonc
//! { "area": "unification",
//!   "cases": [ { "name": "…", "kb": ["parent(tom, bob)."],
//!                "query": "parent(tom, X)", "expected": [{ "X": "bob" }] } ] }
//! ```
//!
//! `expected` is the COMPLETE solution set, compared as an unordered multiset —
//! the corpus README states a conforming engine need not enumerate solutions in
//! tau-prolog's order, only produce the same set.
//!
//! Nothing is ever silently skipped: a missing corpus directory, a file with no
//! cases, an unparseable file, or a case whose query errors is a hard failure,
//! so this gate cannot pass vacuously. `wrong_expectation_fails_the_gate` pins
//! that non-vacuity in the suite itself.

use insimul::{Bindings, KnowledgeBase};
use serde_json::Value;
use std::path::{Path, PathBuf};

/// Documented corpus amendments — kept in lockstep with the `AMENDMENTS` table
/// in `tests/conformance.c` (see its comment block for the full rationale).
///
/// The corpus is authored against tau-prolog. Where Trealla diverges AND
/// tau-prolog is the ISO-correct one, the case is not skipped: an explicit,
/// printed, textual substitution preserves exactly the behavior the case tests.
const AMENDMENTS: &[Amendment] = &[Amendment {
    area: "assert-retract",
    case: "asserta-prepends",
    // `log/1` is an *evaluable functor* in ISO, but Trealla also registers it as
    // a static builtin predicate, so `asserta(log(0))` raises
    // permission_error(modify, static_procedure, log/1). The case is about
    // asserta-before-assertz ordering, not the name, so rename the predicate.
    subs: &[("log(", "entry("), ("log/", "entry/")],
    reason: "predicate 'log' collides with Trealla's static builtin arith \
             functor log/1; renamed to preserve asserta-ordering semantics",
}];

struct Amendment {
    area: &'static str,
    case: &'static str,
    subs: &'static [(&'static str, &'static str)],
    reason: &'static str,
}

/// One corpus case, already amended.
struct Case {
    area: String,
    name: String,
    source: Option<String>,
    query: String,
    expected: Vec<Bindings>,
    amended: bool,
}

enum Outcome {
    Pass,
    Fail(String),
}

// ------------------------------------------------------------------ //
// Corpus location: env override, else the vendored mirror, else the
// monorepo sibling submodule. Never an absolute path baked into source.
// ------------------------------------------------------------------ //

/// The insimul-native checkout root, found by walking up from this crate.
fn repo_root() -> PathBuf {
    let manifest_dir = Path::new(env!("CARGO_MANIFEST_DIR"));
    manifest_dir
        .ancestors()
        .find(|dir| {
            dir.join("CMakeLists.txt").is_file() && dir.join("include").join("insimul.h").is_file()
        })
        .unwrap_or_else(|| {
            panic!(
                "conformance: could not find the insimul-native repo root above {}",
                manifest_dir.display()
            )
        })
        .to_path_buf()
}

fn corpus_dir() -> PathBuf {
    if let Some(dir) = std::env::var_os("INSIMUL_CONFORMANCE_DIR") {
        let dir = PathBuf::from(dir);
        assert!(
            dir.is_dir(),
            "conformance: INSIMUL_CONFORMANCE_DIR points at {} which is not a directory",
            dir.display()
        );
        return dir;
    }

    let root = repo_root();
    let vendored = root.join("conformance").join("prolog");
    if vendored.is_dir() {
        return vendored;
    }
    // Monorepo layout: the corpus' source of truth, next to this checkout.
    let sibling = root
        .parent()
        .map(|p| p.join("insimul-runtime/packages/core/conformance/prolog"));
    if let Some(sibling) = sibling.filter(|p| p.is_dir()) {
        return sibling;
    }
    panic!(
        "conformance: no corpus found.\n  looked at {} and the sibling \
         insimul-runtime/packages/core/conformance/prolog\n  Set \
         INSIMUL_CONFORMANCE_DIR to point at the corpus.",
        vendored.display()
    );
}

/// Every `*.json` corpus file, sorted for deterministic ordering.
fn corpus_files(dir: &Path) -> Vec<PathBuf> {
    let entries = std::fs::read_dir(dir)
        .unwrap_or_else(|e| panic!("conformance: cannot read {}: {e}", dir.display()));
    let mut files: Vec<PathBuf> = entries
        .flatten()
        .map(|e| e.path())
        .filter(|p| p.extension().is_some_and(|x| x == "json"))
        .collect();
    files.sort();
    assert!(
        !files.is_empty(),
        "conformance: no *.json corpus files in {} — refusing to pass vacuously",
        dir.display()
    );
    files
}

// ------------------------------------------------------------------ //
// Corpus parsing.
// ------------------------------------------------------------------ //

fn apply_amendments(area: &str, case: &str, text: &str) -> (String, bool) {
    let mut out = text.to_owned();
    let mut amended = false;
    for a in AMENDMENTS
        .iter()
        .filter(|a| a.area == area && a.case == case)
    {
        for (from, to) in a.subs {
            if out.contains(from) {
                out = out.replace(from, to);
                amended = true;
            }
        }
    }
    (out, amended)
}

fn amend_reason(area: &str, case: &str) -> &'static str {
    AMENDMENTS
        .iter()
        .find(|a| a.area == area && a.case == case)
        .map_or("documented amendment (see conformance.rs)", |a| a.reason)
}

/// Parse one corpus file into its cases. Panics — a corpus file that does not
/// load is a hard failure, never a skip.
fn parse_file(path: &Path) -> Vec<Case> {
    let text = std::fs::read_to_string(path)
        .unwrap_or_else(|e| panic!("conformance: cannot read {}: {e}", path.display()));
    let root: Value = serde_json::from_str(&text)
        .unwrap_or_else(|e| panic!("conformance: JSON parse error in {}: {e}", path.display()));

    let fallback = path.file_name().unwrap().to_string_lossy().into_owned();
    let area = root["area"].as_str().unwrap_or(&fallback).to_owned();
    let cases = root["cases"].as_array().unwrap_or_else(|| {
        panic!("conformance: {} has no `cases` array", path.display());
    });
    assert!(
        !cases.is_empty(),
        "conformance: {} has no cases",
        path.display()
    );

    cases
        .iter()
        .map(|c| {
            let name = c["name"].as_str().unwrap_or("?").to_owned();
            let query = c["query"].as_str().unwrap_or_else(|| {
                panic!("conformance: {area} / {name} — malformed case (missing query)")
            });
            let expected: Vec<Bindings> = serde_json::from_value(c["expected"].clone())
                .unwrap_or_else(|e| {
                    panic!("conformance: {area} / {name} — malformed `expected`: {e}")
                });

            // The whole `kb` array is consulted as one program before the query.
            let source = c["kb"].as_array().filter(|kb| !kb.is_empty()).map(|kb| {
                kb.iter()
                    .filter_map(Value::as_str)
                    .fold(String::new(), |mut acc, line| {
                        acc.push_str(line);
                        acc.push('\n');
                        acc
                    })
            });

            let (source, amended_kb) = match source {
                Some(src) => {
                    let (src, a) = apply_amendments(&area, &name, &src);
                    (Some(src), a)
                }
                None => (None, false),
            };
            let (query, amended_query) = apply_amendments(&area, &name, query);

            Case {
                area: area.clone(),
                name,
                source,
                query,
                expected,
                amended: amended_kb || amended_query,
            }
        })
        .collect()
}

// ------------------------------------------------------------------ //
// Case execution.
// ------------------------------------------------------------------ //

/// Unordered multiset comparison: every expected solution must be matched by a
/// distinct actual solution, and the counts must be equal.
fn solutions_match(expected: &[Bindings], actual: &[Bindings]) -> bool {
    if expected.len() != actual.len() {
        return false;
    }
    let mut used = vec![false; actual.len()];
    expected.iter().all(|want| {
        match actual
            .iter()
            .enumerate()
            .find(|(i, got)| !used[*i] && *got == want)
        {
            Some((i, _)) => {
                used[i] = true;
                true
            }
            None => false,
        }
    })
}

/// Run one case in a fresh KB (cases are isolated from each other).
fn run_case(case: &Case) -> Outcome {
    let solve = || -> insimul::Result<Vec<Bindings>> {
        let mut kb = KnowledgeBase::new()?;
        if let Some(source) = &case.source {
            kb.consult(source)?;
        }
        kb.solve(&case.query)
    };

    match solve() {
        Err(e) => Outcome::Fail(format!(
            "query error: {e}\n         query:    {}\n         expected: {:?}",
            case.query, case.expected
        )),
        Ok(actual) if solutions_match(&case.expected, &actual) => Outcome::Pass,
        Ok(actual) => Outcome::Fail(format!(
            "query:    {}\n         expected: {:?}  (unordered)\n         actual:   {:?}",
            case.query, case.expected, actual
        )),
    }
}

// ------------------------------------------------------------------ //
// The gate.
// ------------------------------------------------------------------ //

#[test]
fn prolog_corpus_passes() {
    let dir = corpus_dir();
    println!("conformance corpus dir: {}", dir.display());

    let files = corpus_files(&dir);
    let (mut passed, mut failed, mut cases, mut amended) = (0, 0, 0, 0);
    let mut failures = Vec::new();

    for path in &files {
        let file_cases = parse_file(path);
        println!(
            "== {} ({}) ==",
            path.file_name().unwrap().to_string_lossy(),
            file_cases[0].area
        );
        for case in &file_cases {
            cases += 1;
            if case.amended {
                amended += 1;
                println!(
                    "  [AMEND] {} / {} — {}",
                    case.area,
                    case.name,
                    amend_reason(&case.area, &case.name)
                );
            }
            match run_case(case) {
                Outcome::Pass => {
                    passed += 1;
                    println!("  [PASS] {} / {}", case.area, case.name);
                }
                Outcome::Fail(why) => {
                    failed += 1;
                    println!("  [FAIL] {} / {}\n         {why}", case.area, case.name);
                    failures.push(format!("{} / {}", case.area, case.name));
                }
            }
        }
    }

    println!("\n-------------------------------------------------------------");
    println!(
        "conformance: {} files, {cases} cases, {passed} passed, {failed} failed, {amended} amended",
        files.len()
    );
    if amended > 0 {
        println!(
            "conformance: {amended} case(s) ran with DOCUMENTED amendments (see the \
             [AMEND] lines above, conformance.rs, and progress.txt) — flagged for \
             human review."
        );
    }

    assert!(cases > 0, "conformance: zero cases executed");
    assert!(
        failures.is_empty(),
        "conformance: {failed} of {cases} case(s) failed: {}\n(run with --nocapture for the diffs)",
        failures.join(", ")
    );
}

/// The gate is not vacuous: a case whose `expected` is wrong must FAIL.
///
/// This runs the real corpus machinery — the same `parse_file`/`run_case` path —
/// over a synthetic file, so it also pins that a deliberately-wrong expected
/// value in a scratch corpus case would be caught.
#[test]
fn wrong_expectation_fails_the_gate() {
    let scratch = |tag: usize, expected: &str| -> Vec<Case> {
        let file = std::env::temp_dir().join(format!("insimul-conformance-scratch-{tag}.json"));
        std::fs::write(
            &file,
            format!(
                r#"{{ "area": "scratch", "cases": [
                     {{ "name": "sanity", "kb": ["parent(tom, bob)."],
                        "query": "parent(tom, X)", "expected": {expected} }} ] }}"#
            ),
        )
        .expect("scratch corpus file should be writable");
        let cases = parse_file(&file);
        let _ = std::fs::remove_file(&file);
        cases
    };

    assert!(
        matches!(
            run_case(&scratch(0, r#"[{ "X": "bob" }]"#)[0]),
            Outcome::Pass
        ),
        "the truthful scratch case must pass"
    );
    for (tag, wrong) in [
        r#"[{ "X": "ann" }]"#,          // wrong binding
        r#"[{ "Y": "bob" }]"#,          // wrong variable
        r#"[{ "X": 1 }]"#,              // wrong term type
        r#"[]"#,                        // too few solutions
        r#"[{}]"#,                      // right count, no bindings
        r#"[{"X":"bob"},{"X":"bob"}]"#, // too many solutions
    ]
    .into_iter()
    .enumerate()
    {
        assert!(
            matches!(run_case(&scratch(tag + 1, wrong)[0]), Outcome::Fail(_)),
            "expected `{wrong}` must FAIL the gate"
        );
    }
}
