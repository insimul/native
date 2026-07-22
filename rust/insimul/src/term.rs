//! Prolog terms and binding sets, decoded from the ABI's binding-set JSON.
//!
//! The wire format is specified on `insimul_query_next` in `include/insimul.h`:
//!
//! ```text
//! { "Var": <value>, ... }        one entry per named goal variable
//!   atom            -> "foo"
//!   integer / float -> 42 / 3.14
//!   list            -> [ <value>, ... ]      (the empty list is [])
//!   compound f(A..) -> {"functor":"f","args":[ <value>, ... ]}
//!   unbound var     -> null
//! ```
//!
//! The deserializers below are hand-written visitors rather than derives so a
//! binding set keeps the ABI's variable order (goal order, not sorted), which
//! makes a decode/encode round-trip faithful.

use serde::de::{self, Deserializer, MapAccess, SeqAccess, Visitor};
use serde::Deserialize;
use std::fmt;

/// A Prolog term as it crosses the ABI.
///
/// Note that Prolog does not distinguish an atom from a string here: the core
/// serializes both as JSON strings, so both decode to [`Term::Atom`]. The empty
/// list `[]` decodes to an empty [`Term::List`].
#[derive(Debug, Clone, PartialEq)]
pub enum Term {
    /// An atom (or string), e.g. `foo` or `'hello world'`.
    Atom(String),
    /// An integer.
    Int(i64),
    /// A float.
    Float(f64),
    /// A proper list, e.g. `[a, 1, f(x)]`.
    List(Vec<Term>),
    /// A compound term `functor(args...)`.
    Compound {
        /// The functor name.
        functor: String,
        /// The arguments, in order. Never empty (arity 0 is an atom).
        args: Vec<Term>,
    },
    /// A variable that the solution left unbound.
    Unbound,
}

impl Term {
    /// The text of an [`Term::Atom`], if this is one.
    pub fn as_atom(&self) -> Option<&str> {
        match self {
            Term::Atom(s) => Some(s),
            _ => None,
        }
    }

    /// The value of an [`Term::Int`], if this is one.
    pub fn as_i64(&self) -> Option<i64> {
        match self {
            Term::Int(i) => Some(*i),
            _ => None,
        }
    }

    /// This term's numeric value, widening an [`Term::Int`] to `f64`.
    pub fn as_f64(&self) -> Option<f64> {
        match self {
            Term::Int(i) => Some(*i as f64),
            Term::Float(f) => Some(*f),
            _ => None,
        }
    }

    /// The elements of a [`Term::List`], if this is one.
    pub fn as_list(&self) -> Option<&[Term]> {
        match self {
            Term::List(items) => Some(items),
            _ => None,
        }
    }

    /// The functor and arguments of a [`Term::Compound`], if this is one.
    pub fn as_compound(&self) -> Option<(&str, &[Term])> {
        match self {
            Term::Compound { functor, args } => Some((functor, args)),
            _ => None,
        }
    }
}

impl<'de> Deserialize<'de> for Term {
    fn deserialize<D: Deserializer<'de>>(d: D) -> Result<Self, D::Error> {
        d.deserialize_any(TermVisitor)
    }
}

struct TermVisitor;

impl<'de> Visitor<'de> for TermVisitor {
    type Value = Term;

    fn expecting(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str("a Prolog term encoded as insimul binding-set JSON")
    }

    fn visit_unit<E: de::Error>(self) -> Result<Term, E> {
        Ok(Term::Unbound)
    }

    fn visit_none<E: de::Error>(self) -> Result<Term, E> {
        Ok(Term::Unbound)
    }

    fn visit_str<E: de::Error>(self, v: &str) -> Result<Term, E> {
        Ok(Term::Atom(v.to_owned()))
    }

    fn visit_string<E: de::Error>(self, v: String) -> Result<Term, E> {
        Ok(Term::Atom(v))
    }

    fn visit_i64<E: de::Error>(self, v: i64) -> Result<Term, E> {
        Ok(Term::Int(v))
    }

    fn visit_u64<E: de::Error>(self, v: u64) -> Result<Term, E> {
        // Integers beyond i64 can only come from a bignum; keep them as a float
        // rather than failing the whole solution.
        Ok(i64::try_from(v).map_or_else(|_| Term::Float(v as f64), Term::Int))
    }

    fn visit_f64<E: de::Error>(self, v: f64) -> Result<Term, E> {
        Ok(Term::Float(v))
    }

    fn visit_bool<E: de::Error>(self, v: bool) -> Result<Term, E> {
        // The core never emits JSON booleans, but `true`/`fail` as atoms are
        // plausible enough to accept rather than reject.
        Ok(Term::Atom(v.to_string()))
    }

    fn visit_seq<A: SeqAccess<'de>>(self, mut seq: A) -> Result<Term, A::Error> {
        let mut items = Vec::with_capacity(seq.size_hint().unwrap_or(0));
        while let Some(item) = seq.next_element()? {
            items.push(item);
        }
        Ok(Term::List(items))
    }

    fn visit_map<A: MapAccess<'de>>(self, mut map: A) -> Result<Term, A::Error> {
        let mut functor: Option<String> = None;
        let mut args: Option<Vec<Term>> = None;
        while let Some(key) = map.next_key::<String>()? {
            match key.as_str() {
                "functor" => functor = Some(map.next_value()?),
                "args" => args = Some(map.next_value()?),
                other => return Err(de::Error::unknown_field(other, &["functor", "args"])),
            }
        }
        match (functor, args) {
            (Some(functor), Some(args)) => Ok(Term::Compound { functor, args }),
            (None, _) => Err(de::Error::missing_field("functor")),
            (_, None) => Err(de::Error::missing_field("args")),
        }
    }
}

/// One solution: the named goal variables and what they were bound to.
///
/// Entries keep the order the ABI emitted them (the goal's variable order).
/// Variables whose source name begins with `_` are omitted by the core and so
/// never appear here; a goal with no named variables yields an empty set.
#[derive(Debug, Clone, Default)]
pub struct Bindings {
    entries: Vec<(String, Term)>,
}

impl Bindings {
    /// The term bound to `name`, if the solution bound it.
    pub fn get(&self, name: &str) -> Option<&Term> {
        self.entries.iter().find(|(k, _)| k == name).map(|(_, v)| v)
    }

    /// Number of bound variables.
    pub fn len(&self) -> usize {
        self.entries.len()
    }

    /// True when the goal succeeded without binding any named variable.
    pub fn is_empty(&self) -> bool {
        self.entries.is_empty()
    }

    /// Iterate the bindings in ABI order.
    pub fn iter(&self) -> impl DoubleEndedIterator<Item = (&str, &Term)> + ExactSizeIterator {
        self.entries.iter().map(|(k, v)| (k.as_str(), v))
    }
}

/// Equality ignores order: two solutions binding the same variables to the same
/// terms are the same solution, however the goal happened to order them.
impl PartialEq for Bindings {
    fn eq(&self, other: &Self) -> bool {
        self.len() == other.len()
            && self
                .entries
                .iter()
                .all(|(k, v)| other.get(k).is_some_and(|o| o == v))
    }
}

impl IntoIterator for Bindings {
    type Item = (String, Term);
    type IntoIter = std::vec::IntoIter<(String, Term)>;

    fn into_iter(self) -> Self::IntoIter {
        self.entries.into_iter()
    }
}

impl FromIterator<(String, Term)> for Bindings {
    fn from_iter<I: IntoIterator<Item = (String, Term)>>(iter: I) -> Self {
        Bindings {
            entries: iter.into_iter().collect(),
        }
    }
}

impl<'de> Deserialize<'de> for Bindings {
    fn deserialize<D: Deserializer<'de>>(d: D) -> Result<Self, D::Error> {
        struct BindingsVisitor;

        impl<'de> Visitor<'de> for BindingsVisitor {
            type Value = Bindings;

            fn expecting(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
                f.write_str("an insimul binding set object")
            }

            fn visit_map<A: MapAccess<'de>>(self, mut map: A) -> Result<Bindings, A::Error> {
                let mut entries = Vec::with_capacity(map.size_hint().unwrap_or(0));
                while let Some((name, term)) = map.next_entry::<String, Term>()? {
                    entries.push((name, term));
                }
                Ok(Bindings { entries })
            }
        }

        d.deserialize_map(BindingsVisitor)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn decode(json: &str) -> Bindings {
        serde_json::from_str(json).expect("should decode")
    }

    #[test]
    fn decodes_the_documented_shapes() {
        let b = decode(r#"{"A":"foo","B":42,"C":3.5,"D":[1,"a"],"E":[],"F":null}"#);
        assert_eq!(b.get("A"), Some(&Term::Atom("foo".to_owned())));
        assert_eq!(b.get("B"), Some(&Term::Int(42)));
        assert_eq!(b.get("C"), Some(&Term::Float(3.5)));
        assert_eq!(
            b.get("D"),
            Some(&Term::List(vec![Term::Int(1), Term::Atom("a".to_owned())]))
        );
        assert_eq!(b.get("E"), Some(&Term::List(vec![])));
        assert_eq!(b.get("F"), Some(&Term::Unbound));
        assert_eq!(b.get("nope"), None);
    }

    #[test]
    fn decodes_nested_compounds() {
        let b = decode(r#"{"T":{"functor":"point","args":[1,{"functor":"-","args":[2,3]}]}}"#);
        let (functor, args) = b.get("T").unwrap().as_compound().unwrap();
        assert_eq!(functor, "point");
        assert_eq!(args[0], Term::Int(1));
        assert_eq!(
            args[1],
            Term::Compound {
                functor: "-".to_owned(),
                args: vec![Term::Int(2), Term::Int(3)],
            }
        );
    }

    #[test]
    fn keeps_the_abi_variable_order() {
        // Goal order, not sorted — see insimul_query_next.
        let b = decode(r#"{"P":"tom","C":"bob"}"#);
        let names: Vec<&str> = b.iter().map(|(k, _)| k).collect();
        assert_eq!(names, ["P", "C"]);
    }

    #[test]
    fn an_empty_object_is_a_successful_solution_with_no_bindings() {
        let b = decode("{}");
        assert!(b.is_empty());
        assert_eq!(b.len(), 0);
    }

    #[test]
    fn rejects_an_object_that_is_not_a_compound() {
        let err = serde_json::from_str::<Bindings>(r#"{"T":{"oops":1}}"#)
            .expect_err("unknown field should be rejected");
        assert!(err.to_string().contains("oops"), "{err}");
    }
}
