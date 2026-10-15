/*
 * insimulcore_sha256.h — SHA-256 (FIPS 180-4) for libinsimulcore's JS runtime.
 *
 * INTERNAL to libinsimulcore: not part of insimulcore.h and not exported. It
 * exists because `@insimul/core`'s save envelope is a SHA-256 over canonical
 * JSON (`computeSaveFileIntegrity`), QuickJS has no crypto, and a hash written
 * in JavaScript would be a second implementation to keep correct. The C host
 * installs it as `__insimul_sha256_hex(text)`; js/host-crypto.js is the only
 * caller. Pinned by the NIST vectors and core's
 * `conformance/saves/integrity-vectors.json` (the corebridge_cases gate).
 */

#ifndef INSIMULCORE_SHA256_H
#define INSIMULCORE_SHA256_H

#include <stddef.h>
#include <stdint.h>

typedef struct {
	uint32_t state[8];
	uint64_t bytes;      /* total message length so far */
	uint8_t block[64];   /* pending partial block */
	size_t used;         /* bytes pending in `block` */
} insimulcore_sha256_ctx;

void insimulcore_sha256_init(insimulcore_sha256_ctx *ctx);
void insimulcore_sha256_update(insimulcore_sha256_ctx *ctx, const void *data, size_t len);
/* Writes 64 lowercase hex digits and a NUL into `hex` (65 bytes). */
void insimulcore_sha256_final_hex(insimulcore_sha256_ctx *ctx, char hex[65]);

/* One-shot convenience: SHA-256 of `len` bytes at `data`, as hex. */
void insimulcore_sha256_hex(const void *data, size_t len, char hex[65]);

#endif /* INSIMULCORE_SHA256_H */
