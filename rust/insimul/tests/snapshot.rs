//! `snapshot()` / `restore()` — the save-file path: serialize a KB's dynamic
//! state, rehydrate it into a fresh KB, and get the same answers back.

use insimul::{Error, ErrorClass, KnowledgeBase, Term};

const WORLD: &str = "\
person(alice).
person(bob).
likes(alice, wine).
likes(bob, chess).
age(alice, 30).
score(carol, 4.5).
inventory(bob, [sword, shield, 3]).
title(alice, 'Grand Duchess').
friend(alice, pet(dog)).
knows(A, B) :- likes(A, B).
";

/// A KB holding `WORLD` plus one asserted fact.
fn world() -> KnowledgeBase {
    let mut kb = KnowledgeBase::new().expect("engine failed to start");
    kb.consult(WORLD).expect("consult failed");
    kb.assert_fact("likes(carol, tea)").expect("assert failed");
    kb
}

/// The queries a round-trip has to answer identically.
const PROBES: &[&str] = &[
    "person(Who)",
    "likes(Who, What)",
    "age(alice, Years)",
    "score(carol, Points)",
    "inventory(bob, Items)",
    "title(alice, T)",
    "friend(alice, F)",
    "knows(alice, X)",
];

#[test]
fn snapshot_restores_into_a_fresh_kb() {
    let original = world();
    let image = original.snapshot().expect("snapshot failed");

    let mut restored = KnowledgeBase::new().unwrap();
    restored.restore(&image).expect("restore failed");

    for goal in PROBES {
        assert_eq!(
            restored.solve(goal).unwrap(),
            original.solve(goal).unwrap(),
            "{goal} answered differently after a round-trip"
        );
    }

    // Every term shape survived, not just the atoms.
    let items = restored.solve("inventory(bob, I)").unwrap().remove(0);
    assert_eq!(
        items.get("I"),
        Some(&Term::List(vec![
            Term::Atom("sword".to_owned()),
            Term::Atom("shield".to_owned()),
            Term::Int(3),
        ]))
    );
    assert_eq!(
        restored.solve("score(carol, P)").unwrap()[0].get("P"),
        Some(&Term::Float(4.5))
    );
    assert_eq!(
        restored.solve("title(alice, T)").unwrap()[0].get("T"),
        Some(&Term::Atom("Grand Duchess".to_owned()))
    );
    assert_eq!(
        restored.solve("friend(alice, F)").unwrap()[0].get("F"),
        Some(&Term::Compound {
            functor: "pet".to_owned(),
            args: vec![Term::Atom("dog".to_owned())],
        })
    );
}

#[test]
fn a_round_trip_re_snapshots_to_the_identical_image() {
    let original = world();
    let image = original.snapshot().unwrap();

    // Equal states serialize byte-identically, so the image is a stable save
    // payload: snapshot → restore → snapshot is a fixed point.
    assert_eq!(original.snapshot().unwrap(), image);

    let mut restored = KnowledgeBase::new().unwrap();
    restored.restore(&image).unwrap();
    assert_eq!(restored.snapshot().unwrap(), image);
}

#[test]
fn restore_replaces_the_existing_state() {
    let source = world();
    let image = source.snapshot().unwrap();

    let mut target = KnowledgeBase::new().unwrap();
    target.consult("person(zoe).\nleftover(yes).\n").unwrap();
    target.restore(&image).unwrap();

    // The image's clauses are the whole state now — the old ones are gone.
    assert!(target.holds("person(alice)").unwrap());
    assert!(!target.holds("person(zoe)").unwrap());
    assert!(!target.holds("leftover(yes)").unwrap());
    assert_eq!(target.snapshot().unwrap(), image);
}

#[test]
fn an_empty_kb_round_trips() {
    let empty = KnowledgeBase::new().unwrap();
    let image = empty.snapshot().unwrap();
    assert!(image.trim().is_empty(), "unexpected image: {image:?}");

    let mut target = world();
    target.restore(&image).unwrap();
    assert!(!target.holds("person(alice)").unwrap());
    assert_eq!(target.snapshot().unwrap(), image);
}

#[test]
fn a_malformed_image_leaves_the_kb_untouched() {
    let mut kb = world();
    let before = kb.snapshot().unwrap();

    let err = kb
        .restore("person(dave).\nbroken(oops.\n")
        .expect_err("a syntax error should not load");
    assert!(matches!(err, Error::Prolog { .. }), "unexpected error: {err:?}");

    // Rejected before anything was discarded: the old state is intact and the
    // clause that *did* parse never landed.
    assert_eq!(kb.snapshot().unwrap(), before);
    assert!(kb.holds("person(alice)").unwrap());
    assert!(!kb.holds("person(dave)").unwrap());
}

#[test]
fn operator_directives_are_not_captured_by_a_snapshot() {
    // Known gotcha: a snapshot serializes the dynamic *clause set* only, never
    // the `:- op/3` directives that were in scope when it was consulted. The
    // clauses are still written in operator notation, so restoring them needs a
    // KB where the same operators are already declared — i.e. restore into a KB
    // that has re-consulted the world rules, not into a bare one.
    let mut authored = KnowledgeBase::new().unwrap();
    authored
        .consult(":- op(700, xfx, likes).\nalice likes wine.\n")
        .unwrap();
    let image = authored.snapshot().unwrap();
    assert_eq!(image.trim(), "alice likes wine.");

    let mut bare = KnowledgeBase::new().unwrap();
    let err = bare
        .restore(&image)
        .expect_err("operator notation must not parse without the op/3");
    assert!(
        matches!(&err, Error::Prolog { class: ErrorClass::Syntax, .. }),
        "unexpected error: {err:?}"
    );

    let mut prepared = KnowledgeBase::new().unwrap();
    prepared.consult(":- op(700, xfx, likes).\n").unwrap();
    prepared.restore(&image).expect("restore failed");
    assert!(prepared.holds("likes(alice, wine)").unwrap());
}
