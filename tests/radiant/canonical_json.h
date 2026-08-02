// canonical_json.h — canonical JSON serializer, the C++ twin of
// canonicalJSONStringify in packages/core/src/save-envelope.ts.
//
// Produces a byte-for-byte match with `JSON.stringify(sortDeep(value))`:
//   - object keys sorted ascending at every depth,
//   - arrays keep their order,
//   - no whitespace (minified),
//   - numbers formatted the way ECMAScript ToString(Number) / JSON.stringify
//     would render them, NOT the raw input lexeme,
//   - strings escaped exactly as JSON.stringify does (short escapes for
//     \b\f\n\r\t, \u00XX for other control chars, raw UTF-8 otherwise, / NOT
//     escaped).
//
// The integrity hash (SHA-256 of this output) is therefore portable across the
// TS, Unity, Unreal, and Godot runtimes. std-only — no godot-cpp. Faithful port
// of InsimulCanonicalJson.{h,cpp}.

#ifndef INSIMUL_GODOT_CANONICAL_JSON_H
#define INSIMUL_GODOT_CANONICAL_JSON_H

#include "json_value.h"

#include <string>

namespace insimul {

// Serialize a parsed JSON value in canonical (key-sorted, minified) form.
std::string canonical_json_stringify(const JsonValue &value);

// Convenience: SHA-256 hex of the canonical serialization of `value`.
std::string canonical_json_integrity(const JsonValue &value);

// Format a number the way ECMAScript ToString(Number) would. Exposed for the
// fixture-vector tests. `raw` is the original lexeme (used only as a fallback
// for integral magnitudes beyond the int64 fast path).
std::string canonical_number(double value, const std::string &raw);

// Escape a UTF-8 string exactly as JSON.stringify would (quotes included).
std::string canonical_json_string(const std::string &value);

} // namespace insimul

#endif // INSIMUL_GODOT_CANONICAL_JSON_H
