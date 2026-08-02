// json_value.h — portable, dependency-free JSON value + parser for the Insimul
// Godot GDExtension save core (US-GC2).
//
// Like prolog_value.h, this header uses ONLY the C++ standard library so it is
// host-testable under a plain clang toolchain (no godot-cpp, no libinsimul).
// Godot's built-in JSON differs from the save contract on key ordering and
// number formatting, so the canonical serializer (canonical_json.h) works over
// THIS value model, not Godot's Variant tree — that is what makes the integrity
// hash byte-identical to packages/core/src/save-envelope.ts.
//
// This is the Godot twin of packages/unreal/Source/InsimulRuntime/Portable/
// InsimulJson.{h,cpp} — same value model, same parser semantics. Number tokens
// preserve their original lexeme (raw_number) so a canonical re-serializer can
// reproduce byte-identical output for existing saves without re-formatting.

#ifndef INSIMUL_GODOT_JSON_VALUE_H
#define INSIMUL_GODOT_JSON_VALUE_H

#include <cstddef>
#include <memory>
#include <string>
#include <utility>
#include <vector>

namespace insimul {

enum class JsonType {
	Null,
	Bool,
	Number,
	String,
	Array,
	Object,
};

class JsonValue;
using JsonValuePtr = std::shared_ptr<JsonValue>;

// A parsed JSON node. Objects preserve key insertion order.
class JsonValue {
public:
	JsonType type = JsonType::Null;

	bool bool_value = false;

	// Original number token text, preserved for byte-faithful re-emit.
	std::string raw_number;
	double number_value = 0.0;

	// Decoded string contents (escapes already resolved).
	std::string string_value;

	std::vector<JsonValuePtr> array_items;
	std::vector<std::pair<std::string, JsonValuePtr>> object_items;

	bool is_null() const { return type == JsonType::Null; }
	bool is_object() const { return type == JsonType::Object; }
	bool is_array() const { return type == JsonType::Array; }
	bool is_string() const { return type == JsonType::String; }
	bool is_number() const { return type == JsonType::Number; }

	// Number of array elements (0 for non-arrays).
	std::size_t size() const { return is_array() ? array_items.size() : 0; }

	// Look up an object member by key. Returns nullptr if absent or non-object.
	const JsonValue *find(const std::string &key) const;

	std::string as_string(const std::string &def = std::string()) const;
	double as_number(double def = 0.0) const;
	long long as_int(long long def = 0) const;
	bool as_bool(bool def = false) const;

	// Convenience: read a member of this object (or def).
	std::string get_string(const std::string &key, const std::string &def = std::string()) const;
	long long get_int(const std::string &key, long long def = 0) const;
	bool get_bool(const std::string &key, bool def = false) const;
};

struct JsonParseResult {
	bool ok = false;
	JsonValuePtr root;
	std::string error;
	std::size_t error_pos = 0;
};

// Parse a UTF-8 JSON document. On failure ok is false and error is set.
JsonParseResult parse_json(const std::string &text);

} // namespace insimul

#endif // INSIMUL_GODOT_JSON_VALUE_H
