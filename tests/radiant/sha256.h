// sha256.h — portable, dependency-free SHA-256 for the Godot save core.
//
// std-only (no godot-cpp, no OpenSSL) so it is host-testable via test/. Produces
// the lowercase-hex digest the save-envelope integrity check uses, byte-compatible
// with Node's crypto.createHash('sha256').digest('hex') in
// packages/core/src/save-envelope.ts. Twin of InsimulSha256.h.

#ifndef INSIMUL_GODOT_SHA256_H
#define INSIMUL_GODOT_SHA256_H

#include <cstdint>
#include <string>

namespace insimul {

// Lowercase 64-char hex SHA-256 digest of the raw UTF-8 bytes of `data`.
std::string sha256_hex(const std::string &data);

} // namespace insimul

#endif // INSIMUL_GODOT_SHA256_H
