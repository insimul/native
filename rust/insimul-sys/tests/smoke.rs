//! End-to-end FFI smoke test: create a KB, consult a fact + a rule, run a
//! query, and read a binding back. This is the US-FFI1 gate — it proves the
//! Rust <-> C round-trip, not the ergonomics (that is the `insimul` crate).

use core::ffi::CStr;
use insimul_sys::*;
use std::ffi::CString;

/// Collect every solution of `goal` as the raw binding-set JSON strings.
///
/// # Safety
/// `kb` must be a live KB owned by the calling thread.
unsafe fn solutions(kb: *mut insimul_kb, goal: &str) -> Vec<String> {
    let goal = CString::new(goal).unwrap();
    let q = insimul_query_start(kb, goal.as_ptr());
    assert!(!q.is_null(), "query failed to start: {}", last_error(kb));

    let mut out = Vec::new();
    loop {
        let s = insimul_query_next(q);
        if s.is_null() {
            break;
        }
        // Copied immediately: the buffer belongs to the query.
        out.push(CStr::from_ptr(s).to_str().unwrap().to_owned());
    }
    insimul_query_stop(q);
    out
}

/// # Safety
/// `kb` must be a live KB owned by the calling thread.
unsafe fn last_error(kb: *mut insimul_kb) -> String {
    let e = insimul_last_error(kb);
    if e.is_null() {
        "<none>".to_owned()
    } else {
        CStr::from_ptr(e).to_string_lossy().into_owned()
    }
}

#[test]
fn ffi_round_trips_a_program_and_a_query() {
    unsafe {
        let kb = insimul_kb_create();
        assert!(!kb.is_null(), "insimul_kb_create returned NULL");

        let src = CString::new(
            "parent(tom, bob).\n\
             parent(bob, ann).\n\
             grandparent(X, Z) :- parent(X, Y), parent(Y, Z).\n",
        )
        .unwrap();
        assert_eq!(
            insimul_kb_consult(kb, src.as_ptr()),
            0,
            "consult failed: {}",
            last_error(kb)
        );
        assert!(
            insimul_last_error(kb).is_null(),
            "good consult set an error"
        );

        // The rule must fire, and the binding must come back as ABI JSON.
        let sols = solutions(kb, "grandparent(tom, X)");
        assert_eq!(sols, vec![r#"{"X":"ann"}"#.to_owned()]);

        // ...and the two-solution case, to prove the iterator really iterates.
        let sols = solutions(kb, "parent(P, C)");
        assert_eq!(
            sols,
            vec![
                r#"{"P":"tom","C":"bob"}"#.to_owned(),
                r#"{"P":"bob","C":"ann"}"#.to_owned(),
            ]
        );

        // assert/retract round-trip through the same handle.
        let fact = CString::new("parent(ann, zoe)").unwrap();
        assert_eq!(insimul_kb_assert(kb, fact.as_ptr()), 0);
        assert_eq!(solutions(kb, "grandparent(bob, X)"), vec![r#"{"X":"zoe"}"#]);
        assert_eq!(insimul_kb_retract(kb, fact.as_ptr()), 0);
        assert!(solutions(kb, "grandparent(bob, _)").is_empty());

        insimul_kb_destroy(kb);
    }
}

#[test]
fn snapshot_restores_into_a_fresh_kb() {
    unsafe {
        let a = insimul_kb_create();
        assert!(!a.is_null());
        let src = CString::new("likes(alice, wine).\nlikes(bob, chess).\n").unwrap();
        assert_eq!(insimul_kb_consult(a, src.as_ptr()), 0);

        let image = insimul_kb_snapshot(a);
        assert!(!image.is_null(), "snapshot failed: {}", last_error(a));
        let image = CStr::from_ptr(image).to_owned(); // owned by the KB — copy it

        let b = insimul_kb_create();
        assert!(!b.is_null());
        assert_eq!(
            insimul_kb_restore(b, image.as_ptr()),
            0,
            "restore failed: {}",
            last_error(b)
        );
        assert_eq!(solutions(b, "likes(Who, wine)"), vec![r#"{"Who":"alice"}"#]);

        insimul_kb_destroy(b);
        insimul_kb_destroy(a);
    }
}

#[test]
fn version_stamp_is_well_formed() {
    // No KB required for this one.
    let stamp = unsafe { CStr::from_ptr(insimul_version()) }
        .to_str()
        .unwrap();
    assert!(stamp.starts_with("insimul "), "unexpected stamp: {stamp}");
    // `engine <name>/<version>/<commit>` — the field, not the vendor in it.
    assert!(stamp.contains("engine "), "unexpected stamp: {stamp}");
}

#[test]
fn errors_are_reported_not_thrown() {
    unsafe {
        let kb = insimul_kb_create();
        assert!(!kb.is_null());

        let bad = CString::new("broken(2.\n").unwrap();
        assert_eq!(insimul_kb_consult(kb, bad.as_ptr()), -1);
        assert!(
            !insimul_last_error(kb).is_null(),
            "syntax error not reported"
        );

        let goal = CString::new("foo(bar").unwrap();
        assert!(insimul_query_start(kb, goal.as_ptr()).is_null());
        assert!(!insimul_last_error(kb).is_null());

        insimul_query_stop(std::ptr::null_mut()); // NULL-safe
        insimul_kb_destroy(kb);
        insimul_kb_destroy(std::ptr::null_mut()); // NULL-safe
    }
}
