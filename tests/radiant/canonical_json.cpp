// canonical_json.cpp — faithful port of InsimulCanonicalJson.cpp.

#include "canonical_json.h"

#include "sha256.h"

#include <algorithm>
#include <cmath>
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <utility>
#include <vector>

namespace insimul {

std::string canonical_number(double value, const std::string &raw) {
	// Non-finite values are not representable in JSON; JS emits `null`.
	if (std::isnan(value) || std::isinf(value)) {
		return "null";
	}

	// Integral fast path. std::to_string(long long) reproduces JS's integer
	// rendering exactly, and covers every integer save files carry (ids,
	// counts, ms timestamps ~1.7e12). Cap below int64 range; fall back to the
	// raw lexeme for the (save-absent) 9e18..1e21 integral band.
	if (value == std::floor(value) && std::fabs(value) < 9.0e18) {
		return std::to_string(static_cast<long long>(value));
	}

	// Non-integral (or huge): shortest %.*g string that round-trips back to the
	// same double — this matches ECMAScript's shortest-representation rule for
	// the simple decimals save files use (0.6, 2.5, ...).
	for (int precision = 1; precision <= 17; ++precision) {
		char buffer[64];
		std::snprintf(buffer, sizeof(buffer), "%.*g", precision, value);
		if (std::strtod(buffer, nullptr) == value) {
			return std::string(buffer);
		}
	}
	// Unreachable for finite doubles; keep the raw token as a last resort.
	return raw.empty() ? "0" : raw;
}

std::string canonical_json_string(const std::string &value) {
	static const char *hex = "0123456789abcdef";
	std::string out;
	out.reserve(value.size() + 2);
	out.push_back('"');
	for (unsigned char c : value) {
		switch (c) {
			case '"': out += "\\\""; break;
			case '\\': out += "\\\\"; break;
			case '\b': out += "\\b"; break;
			case '\f': out += "\\f"; break;
			case '\n': out += "\\n"; break;
			case '\r': out += "\\r"; break;
			case '\t': out += "\\t"; break;
			default:
				if (c < 0x20) {
					out += "\\u00";
					out.push_back(hex[(c >> 4) & 0xF]);
					out.push_back(hex[c & 0xF]);
				} else {
					// Printable ASCII and raw UTF-8 bytes pass through unescaped,
					// exactly as JSON.stringify emits them.
					out.push_back(static_cast<char>(c));
				}
		}
	}
	out.push_back('"');
	return out;
}

namespace {

void emit(const JsonValue &value, std::string &out) {
	switch (value.type) {
		case JsonType::Null:
			out += "null";
			break;
		case JsonType::Bool:
			out += value.bool_value ? "true" : "false";
			break;
		case JsonType::Number:
			out += canonical_number(value.number_value, value.raw_number);
			break;
		case JsonType::String:
			out += canonical_json_string(value.string_value);
			break;
		case JsonType::Array: {
			out.push_back('[');
			for (std::size_t i = 0; i < value.array_items.size(); ++i) {
				if (i != 0) {
					out.push_back(',');
				}
				if (value.array_items[i]) {
					emit(*value.array_items[i], out);
				} else {
					out += "null";
				}
			}
			out.push_back(']');
			break;
		}
		case JsonType::Object: {
			// Sort keys ascending by byte value (matches JS default sort for
			// ASCII keys). Ties keep first-seen ordering — save keys are unique.
			std::vector<std::size_t> order(value.object_items.size());
			for (std::size_t i = 0; i < order.size(); ++i) {
				order[i] = i;
			}
			std::stable_sort(order.begin(), order.end(), [&](std::size_t a, std::size_t b) {
				return value.object_items[a].first < value.object_items[b].first;
			});
			out.push_back('{');
			bool first = true;
			for (std::size_t idx : order) {
				const auto &pair = value.object_items[idx];
				// JSON.stringify drops keys whose value is undefined. Parsed JSON
				// has no `undefined`, so every member is emitted here.
				if (!first) {
					out.push_back(',');
				}
				first = false;
				out += canonical_json_string(pair.first);
				out.push_back(':');
				if (pair.second) {
					emit(*pair.second, out);
				} else {
					out += "null";
				}
			}
			out.push_back('}');
			break;
		}
	}
}

} // namespace

std::string canonical_json_stringify(const JsonValue &value) {
	std::string out;
	emit(value, out);
	return out;
}

std::string canonical_json_integrity(const JsonValue &value) {
	return sha256_hex(canonical_json_stringify(value));
}

} // namespace insimul
