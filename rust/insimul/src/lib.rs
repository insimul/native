//! Safe, idiomatic Rust over libinsimul — the shared native Prolog core that
//! also backs the Unity, Unreal, and Godot engine wrappers.
//!
//! [`KnowledgeBase`] owns a C handle and frees it on `Drop`; every fallible
//! operation returns [`Result`] instead of the ABI's status-code-plus-
//! `last_error` dance. Solutions arrive as [`Bindings`] of decoded [`Term`]s.
//!
//! ```no_run
//! # fn main() -> Result<(), insimul::Error> {
//! use insimul::KnowledgeBase;
//!
//! let mut kb = KnowledgeBase::new()?;
//! kb.consult("parent(tom, bob).\nparent(bob, ann).\n")?;
//! kb.assert_fact("grandparent(X, Z) :- parent(X, Y), parent(Y, Z)")?;
//!
//! for solution in kb.query("grandparent(tom, Who)")? {
//!     let solution = solution?;
//!     println!("{:?}", solution.get("Who"));
//! }
//! # Ok(())
//! # }
//! ```
//!
//! # Threading
//!
//! A [`KnowledgeBase`] is owned by one thread — it is neither `Send` nor `Sync`,
//! matching the ABI's thread model. Independent KBs on independent threads are
//! fine, and creating the first one keeps the engine's process-global state
//! alive for the rest of the process (see
//! [`insimul_sys::ensure_engine_keepalive`]).

#![deny(missing_docs)]

mod error;
mod term;

pub use error::{Error, ErrorClass, Result};
pub use term::{Bindings, Term};

use core::ffi::CStr;
use std::ffi::CString;
use std::marker::PhantomData;
use std::sync::atomic::{AtomicUsize, Ordering};

/// Number of C handles (knowledge bases plus live queries) this crate currently
/// owns.
///
/// Every handle is released by its `Drop`, so a host that has dropped all of its
/// KBs and iterators sees `0`. Exposed for leak checks in tests and for host
/// diagnostics; the engine keepalive handle is not counted (it is intentionally
/// immortal and is not owned by this crate).
pub fn live_handles() -> usize {
    LIVE_HANDLES.load(Ordering::SeqCst)
}

static LIVE_HANDLES: AtomicUsize = AtomicUsize::new(0);

/// The version stamp of the linked libinsimul, e.g.
/// `"insimul 0.1.0 (git abc1234, trealla v2.106.1/07de013)"`.
pub fn version() -> &'static str {
    // SAFETY: the ABI guarantees a static, never-freed, NUL-terminated string.
    unsafe { CStr::from_ptr(insimul_sys::insimul_version()) }
        .to_str()
        .unwrap_or("insimul <unknown>")
}

/// A Prolog knowledge base: the standard library, plus whatever program the
/// host consulted or asserted into it.
///
/// The handle is freed when the value is dropped.
pub struct KnowledgeBase {
    kb: *mut insimul_sys::insimul_kb,
}

impl KnowledgeBase {
    /// Create an empty knowledge base.
    ///
    /// # Errors
    /// [`Error::EngineInit`] if the Prolog engine or its bootstrap could not
    /// initialize.
    pub fn new() -> Result<Self> {
        // No keepalive dance: libinsimul holds its own engine instance open, so
        // KBs may be created and destroyed in any order (leak L-01, fixed in
        // US-2). `insimul_sys::ensure_engine_keepalive()` is now a no-op.
        //
        // SAFETY: no arguments; NULL is the documented failure signal.
        let kb = unsafe { insimul_sys::insimul_kb_create() };
        if kb.is_null() {
            return Err(Error::EngineInit);
        }
        LIVE_HANDLES.fetch_add(1, Ordering::SeqCst);
        Ok(KnowledgeBase { kb })
    }

    /// Load Prolog program text: one or more clauses and/or `:- Goal`
    /// directives, each terminated by a full stop. Directives (including
    /// `:- op/3`) take effect as they are read, so they apply to the rest of
    /// `source`.
    ///
    /// # Errors
    /// [`Error::Prolog`] on a syntax or load error — the load is transactional,
    /// so nothing from `source` is left behind.
    pub fn consult(&mut self, source: &str) -> Result<()> {
        let source = CString::new(source)?;
        // SAFETY: live handle, NUL-terminated argument.
        self.check(unsafe { insimul_sys::insimul_kb_consult(self.kb, source.as_ptr()) })
    }

    /// Assert one clause — a fact or `Head :- Body` — given as term text
    /// **without** a trailing full stop, e.g. `"likes(alice, wine)"`.
    /// Undefined predicates are created dynamic automatically.
    ///
    /// # Errors
    /// [`Error::Prolog`] if the text does not parse or the predicate is static.
    pub fn assert_fact(&mut self, fact: &str) -> Result<()> {
        let fact = CString::new(fact)?;
        // SAFETY: live handle, NUL-terminated argument.
        self.check(unsafe { insimul_sys::insimul_kb_assert(self.kb, fact.as_ptr()) })
    }

    /// Retract the first clause unifying with `fact` (term text, no trailing
    /// full stop). Returns whether a clause was actually removed — matching
    /// nothing is not an error.
    ///
    /// # Errors
    /// [`Error::Prolog`] if the text does not parse or the predicate is static.
    pub fn retract_fact(&mut self, fact: &str) -> Result<bool> {
        let fact = CString::new(fact)?;
        // SAFETY: live handle, NUL-terminated argument.
        match unsafe { insimul_sys::insimul_kb_retract(self.kb, fact.as_ptr()) } {
            0 => Ok(true),
            1 => Ok(false),
            _ => Err(self.last_error()),
        }
    }

    /// Run `goal` (goal text, no trailing full stop) and iterate its solutions.
    ///
    /// The iterator borrows the KB, so the program cannot be modified while
    /// solutions are being read. A goal with no solutions yields an empty
    /// iterator; a goal with no named variables yields empty [`Bindings`] per
    /// solution.
    ///
    /// # Errors
    /// [`Error::Prolog`] if the goal does not parse or raised an exception.
    pub fn query(&self, goal: &str) -> Result<Query<'_>> {
        let goal = CString::new(goal)?;
        // SAFETY: live handle, NUL-terminated argument. The KB is neither Send
        // nor Sync, so this &self cannot alias across threads.
        let q = unsafe { insimul_sys::insimul_query_start(self.kb, goal.as_ptr()) };
        if q.is_null() {
            return Err(self.last_error());
        }
        LIVE_HANDLES.fetch_add(1, Ordering::SeqCst);
        Ok(Query {
            q,
            _kb: PhantomData,
        })
    }

    /// Every solution of `goal`, collected.
    ///
    /// # Errors
    /// As [`KnowledgeBase::query`], plus [`Error::Binding`] if a solution does
    /// not decode.
    pub fn solve(&self, goal: &str) -> Result<Vec<Bindings>> {
        self.query(goal)?.collect()
    }

    /// Every solution of `goal` as the RAW binding-set JSON the ABI returned,
    /// undecoded.
    ///
    /// This exists for cross-leg parity checking: comparing decoded
    /// [`Bindings`] would hide a difference in number formatting, escaping or
    /// solution order that the C and wasm legs would still show. The
    /// conformance harness dumps these strings so all three legs can be diffed
    /// byte for byte (`scripts/conformance_parity.sh`).
    ///
    /// # Errors
    /// As [`KnowledgeBase::query`], plus [`Error::NotUtf8`].
    pub fn solve_raw(&self, goal: &str) -> Result<Vec<String>> {
        let mut q = self.query(goal)?;
        let mut out = Vec::new();
        while let Some(json) = q.next_raw()? {
            out.push(json);
        }
        Ok(out)
    }

    /// Whether `goal` has at least one solution.
    ///
    /// # Errors
    /// As [`KnowledgeBase::query`].
    pub fn holds(&self, goal: &str) -> Result<bool> {
        Ok(self.query(goal)?.next().transpose()?.is_some())
    }

    /// Serialize the KB's dynamic state — everything consulted or asserted — as
    /// canonical Prolog program text, suitable for a save file. Equal states
    /// always produce byte-identical images.
    ///
    /// # Errors
    /// [`Error::Prolog`] if the state could not be serialized.
    pub fn snapshot(&self) -> Result<String> {
        // SAFETY: live handle; NULL is the documented failure signal.
        let image = unsafe { insimul_sys::insimul_kb_snapshot(self.kb) };
        if image.is_null() {
            return Err(self.last_error());
        }
        // The buffer belongs to the KB and the next snapshot replaces it, so
        // copy it out immediately.
        // SAFETY: non-NULL, NUL-terminated, owned by the KB and still valid.
        unsafe { CStr::from_ptr(image) }
            .to_str()
            .map(str::to_owned)
            .map_err(|_| Error::NotUtf8)
    }

    /// Replace the KB's dynamic state with `image` (as produced by
    /// [`KnowledgeBase::snapshot`]). The image is parsed before anything is
    /// discarded, so a malformed image leaves the KB untouched.
    ///
    /// # Errors
    /// [`Error::Prolog`] if the image does not parse or does not load.
    pub fn restore(&mut self, image: &str) -> Result<()> {
        let image = CString::new(image)?;
        // SAFETY: live handle, NUL-terminated argument.
        self.check(unsafe { insimul_sys::insimul_kb_restore(self.kb, image.as_ptr()) })
    }

    /// Turn a 0/non-0 ABI status into a `Result`.
    fn check(&self, status: core::ffi::c_int) -> Result<()> {
        if status == 0 {
            Ok(())
        } else {
            Err(self.last_error())
        }
    }

    /// The KB's current error, as an [`Error::Prolog`]: the ISO class to branch
    /// on plus the engine's message as detail.
    fn last_error(&self) -> Error {
        // SAFETY: live handle; NULL means "no error recorded".
        let msg = unsafe { insimul_sys::insimul_last_error(self.kb) };
        let message = if msg.is_null() {
            "operation failed without a message".to_owned()
        } else {
            // SAFETY: NUL-terminated and owned by the KB; copied before any
            // further ABI call can replace it.
            unsafe { CStr::from_ptr(msg) }
                .to_string_lossy()
                .into_owned()
        };
        // SAFETY: same handle, same lifetime as the message above.
        let cls = unsafe { insimul_sys::insimul_last_error_class(self.kb) };
        let class = if cls.is_null() {
            ErrorClass::System
        } else {
            // SAFETY: NUL-terminated, owned by the KB, copied immediately.
            ErrorClass::from_abi(&unsafe { CStr::from_ptr(cls) }.to_string_lossy())
        };
        Error::Prolog { class, message }
    }
}

impl Drop for KnowledgeBase {
    fn drop(&mut self) {
        // SAFETY: the handle was created here and is dropped exactly once; all
        // queries borrowed from it have already been released.
        unsafe { insimul_sys::insimul_kb_destroy(self.kb) };
        LIVE_HANDLES.fetch_sub(1, Ordering::SeqCst);
    }
}

impl std::fmt::Debug for KnowledgeBase {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("KnowledgeBase").finish_non_exhaustive()
    }
}

/// An iterator over a goal's solutions, returned by [`KnowledgeBase::query`].
///
/// The query handle is released when the iterator is dropped, whether or not it
/// was drained.
pub struct Query<'kb> {
    q: *mut insimul_sys::insimul_query,
    /// Ties the query to its KB and keeps this type `!Send`/`!Sync`.
    _kb: PhantomData<&'kb KnowledgeBase>,
}

impl Query<'_> {
    /// The next solution as the raw binding-set JSON string, or `None` when the
    /// solutions are exhausted. See [`KnowledgeBase::solve_raw`].
    ///
    /// # Errors
    /// [`Error::NotUtf8`] if the ABI returned text that is not UTF-8.
    pub fn next_raw(&mut self) -> Result<Option<String>> {
        // SAFETY: live handle; NULL means the solutions are exhausted.
        let json = unsafe { insimul_sys::insimul_query_next(self.q) };
        if json.is_null() {
            return Ok(None);
        }
        // SAFETY: NUL-terminated, owned by the query, copied before returning.
        unsafe { CStr::from_ptr(json) }
            .to_str()
            .map(|s| Some(s.to_owned()))
            .map_err(|_| Error::NotUtf8)
    }
}

impl Iterator for Query<'_> {
    type Item = Result<Bindings>;

    fn next(&mut self) -> Option<Self::Item> {
        // SAFETY: live handle; NULL means the solutions are exhausted.
        let json = unsafe { insimul_sys::insimul_query_next(self.q) };
        if json.is_null() {
            return None;
        }
        // SAFETY: NUL-terminated and owned by the query, which outlives this
        // borrow (we decode before returning).
        let json = unsafe { CStr::from_ptr(json) };
        Some(match json.to_str() {
            Err(_) => Err(Error::NotUtf8),
            Ok(json) => serde_json::from_str(json).map_err(|e| Error::Binding {
                json: json.to_owned(),
                message: e.to_string(),
            }),
        })
    }
}

impl Drop for Query<'_> {
    fn drop(&mut self) {
        // SAFETY: the handle was created here and is stopped exactly once.
        unsafe { insimul_sys::insimul_query_stop(self.q) };
        LIVE_HANDLES.fetch_sub(1, Ordering::SeqCst);
    }
}

impl std::fmt::Debug for Query<'_> {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("Query").finish_non_exhaustive()
    }
}
