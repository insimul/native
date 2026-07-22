//! Handle-leak check: churn through many knowledge bases and query iterators
//! and prove every C handle came back.
//!
//! `insimul::live_handles()` is process-global, so this file deliberately holds
//! exactly ONE `#[test]` — cargo gives each integration-test file its own
//! process, and a second test running concurrently here would race the counter.
//! (ASan is not wired up for this workspace, so the counter is the leak gate;
//! it is decremented only in `Drop`, so a missed free shows up as a non-zero
//! total.)

use insimul::{KnowledgeBase, Term};

const KBS: usize = 64;
const QUERIES_PER_KB: usize = 8;

#[test]
fn handles_are_released_on_drop() {
    assert_eq!(insimul::live_handles(), 0, "counter dirty before the churn");

    for round in 0..KBS {
        let mut kb = KnowledgeBase::new().unwrap();
        kb.consult("item(a).\nitem(b).\nitem(c).\n").unwrap();
        kb.assert_fact(&format!("round({round})")).unwrap();

        // One KB handle, plus one handle per query alive at a time.
        for _ in 0..QUERIES_PER_KB {
            let mut q = kb.query("item(X)").unwrap();
            assert_eq!(insimul::live_handles(), 2);
            assert_eq!(
                q.next().unwrap().unwrap().get("X"),
                Some(&Term::Atom("a".to_owned()))
            );
            // Dropped mid-iteration: the query must still be released.
        }
        assert_eq!(insimul::live_handles(), 1, "a query handle leaked");

        // Held concurrently, then dropped together.
        {
            let queries: Vec<_> = (0..QUERIES_PER_KB)
                .map(|_| kb.query("item(X)").unwrap())
                .collect();
            assert_eq!(insimul::live_handles(), 1 + QUERIES_PER_KB);
            drop(queries);
        }
        assert_eq!(insimul::live_handles(), 1);

        // Errors must not leak a half-built handle either.
        assert!(kb.query("item(").is_err());
        assert_eq!(insimul::live_handles(), 1);
    }

    assert_eq!(insimul::live_handles(), 0, "a KB handle leaked");
}
