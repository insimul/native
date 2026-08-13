//! The safe wrapper's behaviour: consult, query, assert, retract, and the way
//! ABI failures surface as `Result::Err` rather than status codes.

use insimul::{Bindings, Error, ErrorClass, KnowledgeBase, Term};

const FAMILY: &str = "\
parent(tom, bob).
parent(bob, ann).
parent(bob, liz).
grandparent(X, Z) :- parent(X, Y), parent(Y, Z).
";

fn family() -> KnowledgeBase {
    let mut kb = KnowledgeBase::new().expect("engine failed to start");
    kb.consult(FAMILY).expect("consult failed");
    kb
}

/// The atom bound to `name`, for terse assertions.
fn atom(solution: &Bindings, name: &str) -> String {
    solution
        .get(name)
        .and_then(Term::as_atom)
        .unwrap_or_else(|| panic!("{name} not bound to an atom in {solution:?}"))
        .to_owned()
}

#[test]
fn consult_loads_clauses_and_rules() {
    let kb = family();
    assert!(kb.holds("parent(tom, bob)").unwrap());
    assert!(kb.holds("grandparent(tom, ann)").unwrap());
    assert!(!kb.holds("grandparent(ann, tom)").unwrap());
}

#[test]
fn consult_rejects_a_syntax_error_without_loading_anything() {
    let mut kb = KnowledgeBase::new().unwrap();
    let err = kb
        .consult("good(one).\nbroken(2.\n")
        .expect_err("a syntax error should not load");
    assert!(matches!(err, Error::Prolog { .. }), "unexpected error: {err:?}");

    // Transactional: the clause that *did* parse must not have survived — the
    // predicate was never created, so asking about it is an existence error.
    let err = kb.query("good(one)").expect_err("good/1 should not exist");
    // Branch on the ISO CLASS, never on the message: the text is the engine's
    // rendering and changes with the engine, the class does not (US-2, L-08).
    assert!(
        matches!(&err, Error::Prolog { class: ErrorClass::Existence, .. }),
        "unexpected error: {err:?}"
    );

    // ...and the KB is still usable afterwards.
    kb.consult("good(two).\n").unwrap();
    assert!(kb.holds("good(two)").unwrap());
    assert!(!kb.holds("good(one)").unwrap());
}

#[test]
fn query_iterates_every_solution() {
    let kb = family();

    let children: Vec<String> = kb
        .query("parent(bob, C)")
        .unwrap()
        .map(|s| atom(&s.unwrap(), "C"))
        .collect();
    assert_eq!(children, ["ann", "liz"]);

    // Two variables at once, and the multi-solution rule.
    let pairs: Vec<(String, String)> = kb
        .solve("grandparent(G, C)")
        .unwrap()
        .iter()
        .map(|s| (atom(s, "G"), atom(s, "C")))
        .collect();
    assert_eq!(
        pairs,
        [
            ("tom".to_owned(), "ann".to_owned()),
            ("tom".to_owned(), "liz".to_owned())
        ]
    );
}

#[test]
fn a_goal_with_no_solutions_yields_an_empty_iterator() {
    let kb = family();
    assert!(kb.solve("parent(nobody, X)").unwrap().is_empty());
}

#[test]
fn a_ground_goal_that_succeeds_yields_one_empty_binding_set() {
    let kb = family();
    let solutions = kb.solve("parent(tom, bob)").unwrap();
    assert_eq!(solutions.len(), 1);
    assert!(solutions[0].is_empty());
}

#[test]
fn every_term_shape_decodes() {
    let kb = KnowledgeBase::new().unwrap();
    let terms: Vec<Term> = kb
        .query("member(X, [a, 42, 2.5, [], [p, q], f(u, v)])")
        .unwrap()
        .map(|s| s.unwrap().get("X").cloned().expect("X unbound"))
        .collect();

    assert_eq!(
        terms,
        [
            Term::Atom("a".to_owned()),
            Term::Int(42),
            Term::Float(2.5),
            Term::List(vec![]),
            Term::List(vec![Term::Atom("p".to_owned()), Term::Atom("q".to_owned())]),
            Term::Compound {
                functor: "f".to_owned(),
                args: vec![Term::Atom("u".to_owned()), Term::Atom("v".to_owned())],
            },
        ]
    );

    // A variable the solution never bound comes back as `Unbound`, and one
    // whose source name starts with '_' is not reported at all.
    let solution = kb.solve("X = X, _Hidden = 1").unwrap().remove(0);
    assert_eq!(solution.get("X"), Some(&Term::Unbound));
    assert_eq!(solution.get("_Hidden"), None);
    assert_eq!(solution.len(), 1);
}

#[test]
fn assert_fact_adds_facts_and_rules() {
    let mut kb = family();

    kb.assert_fact("parent(ann, zoe)").unwrap();
    assert!(kb.holds("grandparent(bob, zoe)").unwrap());

    kb.assert_fact("ancestor(A, D) :- parent(A, D)").unwrap();
    kb.assert_fact("ancestor(A, D) :- parent(A, M), ancestor(M, D)")
        .unwrap();
    let descendants: Vec<String> = kb
        .solve("ancestor(tom, D)")
        .unwrap()
        .iter()
        .map(|s| atom(s, "D"))
        .collect();
    assert_eq!(descendants, ["bob", "ann", "liz", "zoe"]);
}

#[test]
fn retract_fact_removes_one_clause_and_reports_a_miss() {
    let mut kb = family();

    assert!(kb.retract_fact("parent(bob, ann)").unwrap());
    assert!(!kb.holds("parent(bob, ann)").unwrap());
    assert!(kb.holds("parent(bob, liz)").unwrap());

    // Retracting it again matches nothing — false, not an error.
    assert!(!kb.retract_fact("parent(bob, ann)").unwrap());

    // A pattern with a variable retracts the first matching clause only.
    assert!(kb.retract_fact("parent(P, liz)").unwrap());
    assert!(kb.holds("parent(tom, bob)").unwrap());
    assert!(!kb.holds("parent(_, liz)").unwrap());
}

#[test]
fn a_failing_goal_surfaces_as_an_error() {
    let kb = KnowledgeBase::new().unwrap();

    let err = kb
        .query("foo(bar")
        .expect_err("unbalanced goal should fail");
    assert!(matches!(err, Error::Prolog { .. }), "unexpected error: {err:?}");

    let err = kb
        .query("X is foo + 1")
        .expect_err("type error should fail");
    assert!(matches!(err, Error::Prolog { .. }), "unexpected error: {err:?}");

    // The KB survives a failed goal.
    assert!(kb.holds("true").unwrap());
}

#[test]
fn interior_nul_bytes_are_rejected_before_the_abi() {
    let mut kb = KnowledgeBase::new().unwrap();
    let err = kb.consult("a(b).\0").expect_err("NUL must be rejected");
    assert!(
        matches!(err, Error::InteriorNul(_)),
        "unexpected error: {err:?}"
    );
}

#[test]
fn bindings_compare_by_content_not_order() {
    let kb = family();
    let one = kb.solve("parent(P, C)").unwrap().remove(0);
    let flipped: Bindings = one
        .iter()
        .map(|(k, v)| (k.to_owned(), v.clone()))
        .rev()
        .collect();
    assert_eq!(one, flipped);
}

#[test]
fn version_is_stamped() {
    let stamp = insimul::version();
    assert!(stamp.starts_with("insimul "), "unexpected stamp: {stamp}");
    // The engine is a FIELD, and its identity is that field's value. Asserting
    // the vendor's name here would make an engine swap a red test in the wrong
    // repository, which is the coupling US-2 removed (leak L-02).
    assert!(stamp.contains("engine "), "unexpected stamp: {stamp}");
}
