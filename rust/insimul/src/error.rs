//! The crate's error type.
//!
//! The C ABI never unwinds: every fallible call reports failure through its
//! return value and leaves a message in `insimul_last_error`. This module maps
//! that convention onto a plain Rust `Result`.

use std::ffi::NulError;
use std::fmt;

/// Anything that can go wrong on the way to (or back from) the Prolog core.
#[derive(Debug)]
#[non_exhaustive]
pub enum Error {
    /// The engine could not initialize (`insimul_kb_create` returned NULL).
    EngineInit,

    /// The KB rejected the operation. The payload is the message from
    /// `insimul_last_error` — usually the caught Prolog exception term, quoted.
    Prolog(String),

    /// An argument contained an interior NUL byte, so it cannot be handed to a
    /// C API that takes NUL-terminated strings.
    InteriorNul(NulError),

    /// The ABI returned text that is not valid UTF-8.
    NotUtf8,

    /// A binding set did not parse as the JSON shape documented on
    /// `insimul_query_next`.
    Binding {
        /// The offending JSON text, as received from the ABI.
        json: String,
        /// What went wrong while parsing it.
        message: String,
    },
}

impl fmt::Display for Error {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Error::EngineInit => f.write_str("insimul: the Prolog engine failed to initialize"),
            Error::Prolog(msg) => write!(f, "insimul: {msg}"),
            Error::InteriorNul(e) => write!(f, "insimul: argument contains a NUL byte: {e}"),
            Error::NotUtf8 => f.write_str("insimul: the engine returned non-UTF-8 text"),
            Error::Binding { json, message } => {
                write!(f, "insimul: malformed binding set ({message}): {json}")
            }
        }
    }
}

impl std::error::Error for Error {
    fn source(&self) -> Option<&(dyn std::error::Error + 'static)> {
        match self {
            Error::InteriorNul(e) => Some(e),
            _ => None,
        }
    }
}

impl From<NulError> for Error {
    fn from(e: NulError) -> Self {
        Error::InteriorNul(e)
    }
}

/// Result alias used throughout the crate.
pub type Result<T> = std::result::Result<T, Error>;
