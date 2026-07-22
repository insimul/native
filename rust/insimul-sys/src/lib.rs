//! Raw FFI bindings to libinsimul, the shared native Prolog core.
//!
//! This crate is a 1:1 transcription of `include/insimul.h` — the stable,
//! opaque C ABI that the Unity/Unreal/Godot wrappers also consume — plus the
//! link metadata to find the cmake-built `libinsimul.a` (see `build.rs`).
//! Nothing here is safe; the safe, idiomatic API lives in the `insimul` crate.
//!
//! The declarations are hand-written rather than generated, and `build.rs`
//! fails the build if the header ever declares an `insimul_*` function that is
//! not bound below.
//!
//! # Contract reminders (full text in `include/insimul.h`)
//!
//! * All `*const c_char` returned by the ABI is owned by the object it came
//!   from (the KB or the query) — never free it, and copy before the next call
//!   on that object.
//! * All `*const c_char` passed in must be NUL-terminated (use [`std::ffi::CString`]).
//! * One KB is owned by one thread. Different KBs on different threads are fine.
//! * Nothing here unwinds or throws: failures are reported by the return value
//!   plus [`insimul_last_error`].

#![allow(non_camel_case_types)]

use core::ffi::{c_char, c_int};

/// Opaque knowledge base handle. Created by [`insimul_kb_create`].
#[repr(C)]
pub struct insimul_kb {
    _private: [u8; 0],
}

/// Opaque query handle. Created by [`insimul_query_start`].
#[repr(C)]
pub struct insimul_query {
    _private: [u8; 0],
}

extern "C" {
    /// Create a KB with the standard library available and an empty user
    /// program. Returns NULL only if the engine failed to initialize.
    pub fn insimul_kb_create() -> *mut insimul_kb;

    /// Destroy a KB. NULL is a no-op; the handle is invalid afterwards.
    pub fn insimul_kb_destroy(kb: *mut insimul_kb);

    /// Load Prolog program text (clauses and/or `:- Goal` directives).
    /// Returns 0 on success; on a syntax error nothing is loaded and it
    /// returns -1 with [`insimul_last_error`] set.
    pub fn insimul_kb_consult(kb: *mut insimul_kb, source: *const c_char) -> c_int;

    /// Assert one clause given as term text *without* a trailing full stop.
    /// Returns 0 on success, -1 on error.
    pub fn insimul_kb_assert(kb: *mut insimul_kb, fact: *const c_char) -> c_int;

    /// Retract the first clause unifying with `fact` (term text, no trailing
    /// stop). Returns 0 if a clause was removed, 1 if none matched (not an
    /// error), -1 on error.
    pub fn insimul_kb_retract(kb: *mut insimul_kb, fact: *const c_char) -> c_int;

    /// Start a query over `goal` (goal text, no trailing full stop). Returns a
    /// handle even when there are zero solutions; NULL means the goal raised.
    /// Release it with [`insimul_query_stop`].
    pub fn insimul_query_start(kb: *mut insimul_kb, goal: *const c_char) -> *mut insimul_query;

    /// Next solution as a binding-set JSON object string, or NULL when
    /// exhausted. Owned by the query, valid until [`insimul_query_stop`].
    pub fn insimul_query_next(q: *mut insimul_query) -> *const c_char;

    /// Release a query handle (NULL is a no-op).
    pub fn insimul_query_stop(q: *mut insimul_query);

    /// Serialize the KB's dynamic clause set as canonical Prolog text, or NULL
    /// on error. Owned by the KB and replaced by the next snapshot call.
    pub fn insimul_kb_snapshot(kb: *mut insimul_kb) -> *const c_char;

    /// Replace the KB's dynamic state with `image` (as produced by
    /// [`insimul_kb_snapshot`]). Returns 0 on success, -1 on error — a
    /// malformed image leaves the KB unchanged.
    pub fn insimul_kb_restore(kb: *mut insimul_kb, image: *const c_char) -> c_int;

    /// Last error message for this KB, or NULL if the most recent operation
    /// succeeded. Owned by the KB; valid until the next call on it.
    pub fn insimul_last_error(kb: *mut insimul_kb) -> *const c_char;

    /// Static version stamp for this build, e.g.
    /// `"insimul 0.1.0 (git abc1234, trealla v2.106.1/07de013…)"`. Never NULL.
    pub fn insimul_version() -> *const c_char;
}

/// Keep the Prolog engine's process-global state alive for the lifetime of the
/// process.
///
/// The embedded engine tears down its global symbol table when the *last* KB is
/// destroyed, and re-initializing it afterwards deadlocks on the next teardown
/// (see `CLAUDE.md`, "Trealla gotchas"). Any process that creates KBs in more
/// than one batch — a test binary, the server's request handlers — must
/// therefore hold one KB open forever. Call this before the first
/// [`insimul_kb_create`]; it leaks exactly one KB, once, and is thread-safe and
/// idempotent.
pub fn ensure_engine_keepalive() {
    use std::sync::Once;
    static KEEPALIVE: Once = Once::new();
    KEEPALIVE.call_once(|| {
        // SAFETY: no arguments, and the returned handle is intentionally never
        // destroyed. A NULL return means the engine could not initialize at
        // all, which the caller's own create will report.
        let kb = unsafe { insimul_kb_create() };
        assert!(!kb.is_null(), "insimul: engine failed to initialize");
        // The handle is deliberately leaked; it is never touched again, so it
        // stays sound to create/use other KBs from other threads.
        let _ = kb;
    });
}
