// json_value.cpp — recursive-descent JSON parser for the Godot save core.
//
// A faithful port of packages/unreal/Source/InsimulRuntime/Portable/
// InsimulJson.cpp. Correctness here (escape decoding, number-lexeme capture,
// key-order preservation) is what the canonical serializer relies on to match
// the TS semantics authority byte-for-byte.

#include "json_value.h"

#include <cstdlib>

namespace insimul {

const JsonValue *JsonValue::find(const std::string &key) const {
	if (!is_object()) {
		return nullptr;
	}
	for (const auto &pair : object_items) {
		if (pair.first == key) {
			return pair.second.get();
		}
	}
	return nullptr;
}

std::string JsonValue::as_string(const std::string &def) const {
	return is_string() ? string_value : def;
}

double JsonValue::as_number(double def) const {
	return is_number() ? number_value : def;
}

long long JsonValue::as_int(long long def) const {
	return is_number() ? static_cast<long long>(number_value) : def;
}

bool JsonValue::as_bool(bool def) const {
	return type == JsonType::Bool ? bool_value : def;
}

std::string JsonValue::get_string(const std::string &key, const std::string &def) const {
	const JsonValue *member = find(key);
	return member ? member->as_string(def) : def;
}

long long JsonValue::get_int(const std::string &key, long long def) const {
	const JsonValue *member = find(key);
	return member ? member->as_int(def) : def;
}

bool JsonValue::get_bool(const std::string &key, bool def) const {
	const JsonValue *member = find(key);
	return member ? member->as_bool(def) : def;
}

namespace {

// Minimal recursive-descent JSON parser over a std::string.
class Parser {
public:
	explicit Parser(const std::string &in_text) : text_(in_text) {}

	JsonParseResult run() {
		JsonParseResult result;
		skip_whitespace();
		JsonValuePtr root = parse_value();
		if (error_) {
			result.ok = false;
			result.error = error_msg_;
			result.error_pos = pos_;
			return result;
		}
		skip_whitespace();
		if (pos_ != text_.size()) {
			result.ok = false;
			result.error = "Trailing characters after JSON value";
			result.error_pos = pos_;
			return result;
		}
		result.ok = true;
		result.root = root;
		return result;
	}

private:
	const std::string &text_;
	std::size_t pos_ = 0;
	bool error_ = false;
	std::string error_msg_;

	void fail(const char *message) {
		if (!error_) {
			error_ = true;
			error_msg_ = message;
		}
	}

	bool at_end() const { return pos_ >= text_.size(); }
	char peek() const { return pos_ < text_.size() ? text_[pos_] : '\0'; }

	void skip_whitespace() {
		while (pos_ < text_.size()) {
			const char c = text_[pos_];
			if (c == ' ' || c == '\t' || c == '\n' || c == '\r') {
				++pos_;
			} else {
				break;
			}
		}
	}

	JsonValuePtr parse_value() {
		if (error_) {
			return nullptr;
		}
		skip_whitespace();
		if (at_end()) {
			fail("Unexpected end of input");
			return nullptr;
		}
		const char c = peek();
		switch (c) {
			case '{':
				return parse_object();
			case '[':
				return parse_array();
			case '"':
				return parse_string();
			case 't':
			case 'f':
				return parse_bool();
			case 'n':
				return parse_null();
			default:
				if (c == '-' || (c >= '0' && c <= '9')) {
					return parse_number();
				}
				fail("Unexpected character");
				return nullptr;
		}
	}

	JsonValuePtr parse_object() {
		auto node = std::make_shared<JsonValue>();
		node->type = JsonType::Object;
		++pos_; // consume '{'
		skip_whitespace();
		if (peek() == '}') {
			++pos_;
			return node;
		}
		while (true) {
			skip_whitespace();
			if (peek() != '"') {
				fail("Expected object key string");
				return nullptr;
			}
			JsonValuePtr key_node = parse_string();
			if (error_) {
				return nullptr;
			}
			skip_whitespace();
			if (peek() != ':') {
				fail("Expected ':' after object key");
				return nullptr;
			}
			++pos_; // consume ':'
			JsonValuePtr value_node = parse_value();
			if (error_) {
				return nullptr;
			}
			node->object_items.emplace_back(key_node->string_value, value_node);
			skip_whitespace();
			const char next = peek();
			if (next == ',') {
				++pos_;
				continue;
			}
			if (next == '}') {
				++pos_;
				break;
			}
			fail("Expected ',' or '}' in object");
			return nullptr;
		}
		return node;
	}

	JsonValuePtr parse_array() {
		auto node = std::make_shared<JsonValue>();
		node->type = JsonType::Array;
		++pos_; // consume '['
		skip_whitespace();
		if (peek() == ']') {
			++pos_;
			return node;
		}
		while (true) {
			JsonValuePtr value_node = parse_value();
			if (error_) {
				return nullptr;
			}
			node->array_items.push_back(value_node);
			skip_whitespace();
			const char next = peek();
			if (next == ',') {
				++pos_;
				continue;
			}
			if (next == ']') {
				++pos_;
				break;
			}
			fail("Expected ',' or ']' in array");
			return nullptr;
		}
		return node;
	}

	void append_codepoint_utf8(std::string &out, unsigned int cp) {
		if (cp <= 0x7F) {
			out.push_back(static_cast<char>(cp));
		} else if (cp <= 0x7FF) {
			out.push_back(static_cast<char>(0xC0 | (cp >> 6)));
			out.push_back(static_cast<char>(0x80 | (cp & 0x3F)));
		} else if (cp <= 0xFFFF) {
			out.push_back(static_cast<char>(0xE0 | (cp >> 12)));
			out.push_back(static_cast<char>(0x80 | ((cp >> 6) & 0x3F)));
			out.push_back(static_cast<char>(0x80 | (cp & 0x3F)));
		} else {
			out.push_back(static_cast<char>(0xF0 | (cp >> 18)));
			out.push_back(static_cast<char>(0x80 | ((cp >> 12) & 0x3F)));
			out.push_back(static_cast<char>(0x80 | ((cp >> 6) & 0x3F)));
			out.push_back(static_cast<char>(0x80 | (cp & 0x3F)));
		}
	}

	int read_hex4() {
		if (pos_ + 4 > text_.size()) {
			fail("Truncated \\u escape");
			return -1;
		}
		int value = 0;
		for (int i = 0; i < 4; ++i) {
			const char c = text_[pos_ + i];
			value <<= 4;
			if (c >= '0' && c <= '9') {
				value |= (c - '0');
			} else if (c >= 'a' && c <= 'f') {
				value |= (c - 'a' + 10);
			} else if (c >= 'A' && c <= 'F') {
				value |= (c - 'A' + 10);
			} else {
				fail("Invalid hex digit in \\u escape");
				return -1;
			}
		}
		pos_ += 4;
		return value;
	}

	JsonValuePtr parse_string() {
		auto node = std::make_shared<JsonValue>();
		node->type = JsonType::String;
		++pos_; // consume opening quote
		std::string &out = node->string_value;
		while (true) {
			if (at_end()) {
				fail("Unterminated string");
				return nullptr;
			}
			const char c = text_[pos_++];
			if (c == '"') {
				break;
			}
			if (c == '\\') {
				if (at_end()) {
					fail("Unterminated escape sequence");
					return nullptr;
				}
				const char esc = text_[pos_++];
				switch (esc) {
					case '"': out.push_back('"'); break;
					case '\\': out.push_back('\\'); break;
					case '/': out.push_back('/'); break;
					case 'b': out.push_back('\b'); break;
					case 'f': out.push_back('\f'); break;
					case 'n': out.push_back('\n'); break;
					case 'r': out.push_back('\r'); break;
					case 't': out.push_back('\t'); break;
					case 'u': {
						const int first = read_hex4();
						if (error_) {
							return nullptr;
						}
						unsigned int cp = static_cast<unsigned int>(first);
						// Surrogate pair handling.
						if (cp >= 0xD800 && cp <= 0xDBFF) {
							if (pos_ + 1 < text_.size() && text_[pos_] == '\\' && text_[pos_ + 1] == 'u') {
								pos_ += 2;
								const int second = read_hex4();
								if (error_) {
									return nullptr;
								}
								const unsigned int low = static_cast<unsigned int>(second);
								if (low >= 0xDC00 && low <= 0xDFFF) {
									cp = 0x10000 + ((cp - 0xD800) << 10) + (low - 0xDC00);
								} else {
									// Unpaired: emit replacement char.
									append_codepoint_utf8(out, 0xFFFD);
									cp = low;
								}
							} else {
								cp = 0xFFFD;
							}
						}
						append_codepoint_utf8(out, cp);
						break;
					}
					default:
						fail("Invalid escape character");
						return nullptr;
				}
			} else {
				out.push_back(c);
			}
		}
		return node;
	}

	JsonValuePtr parse_number() {
		auto node = std::make_shared<JsonValue>();
		node->type = JsonType::Number;
		const std::size_t start = pos_;
		if (peek() == '-') {
			++pos_;
		}
		while (pos_ < text_.size() && text_[pos_] >= '0' && text_[pos_] <= '9') {
			++pos_;
		}
		if (peek() == '.') {
			++pos_;
			while (pos_ < text_.size() && text_[pos_] >= '0' && text_[pos_] <= '9') {
				++pos_;
			}
		}
		if (peek() == 'e' || peek() == 'E') {
			++pos_;
			if (peek() == '+' || peek() == '-') {
				++pos_;
			}
			while (pos_ < text_.size() && text_[pos_] >= '0' && text_[pos_] <= '9') {
				++pos_;
			}
		}
		node->raw_number = text_.substr(start, pos_ - start);
		if (node->raw_number.empty()) {
			fail("Invalid number");
			return nullptr;
		}
		node->number_value = std::strtod(node->raw_number.c_str(), nullptr);
		return node;
	}

	JsonValuePtr parse_bool() {
		auto node = std::make_shared<JsonValue>();
		node->type = JsonType::Bool;
		if (text_.compare(pos_, 4, "true") == 0) {
			node->bool_value = true;
			pos_ += 4;
		} else if (text_.compare(pos_, 5, "false") == 0) {
			node->bool_value = false;
			pos_ += 5;
		} else {
			fail("Invalid literal");
			return nullptr;
		}
		return node;
	}

	JsonValuePtr parse_null() {
		if (text_.compare(pos_, 4, "null") == 0) {
			pos_ += 4;
			auto node = std::make_shared<JsonValue>();
			node->type = JsonType::Null;
			return node;
		}
		fail("Invalid literal");
		return nullptr;
	}
};

} // namespace

JsonParseResult parse_json(const std::string &text) {
	Parser parser(text);
	return parser.run();
}

} // namespace insimul
