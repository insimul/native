//! The crate's error type.
//!
//! The C ABI never unwinds: every fallible call reports failure through its
//! return value and leaves a message in `insimul_last_error`. This module maps
//! that convention onto a plain Rust `Result`.

use std::ffi::NulError;
use std::fmt;

/// The ISO error class of a Prolog failure — the value to branch on.
///
/// ISO/IEC 13211-1 7.12.2 fixes this vocabulary, so it is the same token on any
/// conforming engine, whereas the message text is the engine's own rendering
/// (three engines write the same error three different ways). The ABI hands the
/// class over as a string; this enum is that string, typed.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
#[non_exhaustive]
pub enum ErrorClass {
    /// `instantiation_error`
    Instantiation,
    /// `type_error(Type, Culprit)`
    Type,
    /// `domain_error(Domain, Culprit)`
    Domain,
    /// `existence_error(Kind, Culprit)` — e.g. calling an undefined procedure.
    Existence,
    /// `permission_error(Op, Kind, Culprit)` — also what a reserved
    /// `$`-prefixed name is refused with.
    Permission,
    /// `representation_error(Flag)`
    Representation,
    /// `evaluation_error(Kind)` — e.g. `zero_divisor`.
    Evaluation,
    /// `resource_error(Resource)`
    Resource,
    /// `syntax_error(Detail)`. The DETAIL is the engine's vocabulary; only the
    /// class is portable.
    Syntax,
    /// `system_error`, and this library's own infrastructure failures.
    System,
    /// The program threw something that is not an `error/2` term.
    Unknown,
}

impl ErrorClass {
    /// Decode the token the ABI reported. An unrecognized token is
    /// [`ErrorClass::Unknown`] rather than an error: a newer core may classify
    /// more finely than this enum knows.
    #[must_use]
    pub fn from_abi(token: &str) -> Self {
        match token {
            "instantiation_error" => ErrorClass::Instantiation,
            "type_error" => ErrorClass::Type,
            "domain_error" => ErrorClass::Domain,
            "existence_error" => ErrorClass::Existence,
            "permission_error" => ErrorClass::Permission,
            "representation_error" => ErrorClass::Representation,
            "evaluation_error" => ErrorClass::Evaluation,
            "resource_error" => ErrorClass::Resource,
            "syntax_error" => ErrorClass::Syntax,
            "system_error" => ErrorClass::System,
            _ => ErrorClass::Unknown,
        }
    }

    /// The ABI token for this class.
    #[must_use]
    pub fn as_str(self) -> &'static str {
        match self {
            ErrorClass::Instantiation => "instantiation_error",
            ErrorClass::Type => "type_error",
            ErrorClass::Domain => "domain_error",
            ErrorClass::Existence => "existence_error",
            ErrorClass::Permission => "permission_error",
            ErrorClass::Representation => "representation_error",
            ErrorClass::Evaluation => "evaluation_error",
            ErrorClass::Resource => "resource_error",
            ErrorClass::Syntax => "syntax_error",
            ErrorClass::System => "system_error",
            ErrorClass::Unknown => "unknown",
        }
    }
}

impl fmt::Display for ErrorClass {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(self.as_str())
    }
}

/// Anything that can go wrong on the way to (or back from) the Prolog core.
#[derive(Debug)]
#[non_exhaustive]
pub enum Error {
    /// The engine could not initialize (`insimul_kb_create` returned NULL).
    EngineInit,

    /// The KB rejected the operation.
    ///
    /// Match on `class`; `message` is human-readable detail whose wording is
    /// the engine's, not this ABI's contract.
    Prolog {
        /// The ISO class the core reported (`insimul_last_error_class`).
        class: ErrorClass,
        /// The exception term as text (`insimul_last_error`).
        message: String,
    },

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
            Error::Prolog { class, message } => write!(f, "insimul: [{class}] {message}"),
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
