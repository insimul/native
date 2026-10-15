/*
 * insimulcore_sha256.c — SHA-256 per FIPS 180-4 §6.2, written from the
 * standard (no third-party source). See insimulcore_sha256.h for why it is here.
 */

#include "insimulcore_sha256.h"

#include <string.h>

static const uint32_t K[64] = {
	0x428a2f98u, 0x71374491u, 0xb5c0fbcfu, 0xe9b5dba5u, 0x3956c25bu, 0x59f111f1u, 0x923f82a4u, 0xab1c5ed5u,
	0xd807aa98u, 0x12835b01u, 0x243185beu, 0x550c7dc3u, 0x72be5d74u, 0x80deb1feu, 0x9bdc06a7u, 0xc19bf174u,
	0xe49b69c1u, 0xefbe4786u, 0x0fc19dc6u, 0x240ca1ccu, 0x2de92c6fu, 0x4a7484aau, 0x5cb0a9dcu, 0x76f988dau,
	0x983e5152u, 0xa831c66du, 0xb00327c8u, 0xbf597fc7u, 0xc6e00bf3u, 0xd5a79147u, 0x06ca6351u, 0x14292967u,
	0x27b70a85u, 0x2e1b2138u, 0x4d2c6dfcu, 0x53380d13u, 0x650a7354u, 0x766a0abbu, 0x81c2c92eu, 0x92722c85u,
	0xa2bfe8a1u, 0xa81a664bu, 0xc24b8b70u, 0xc76c51a3u, 0xd192e819u, 0xd6990624u, 0xf40e3585u, 0x106aa070u,
	0x19a4c116u, 0x1e376c08u, 0x2748774cu, 0x34b0bcb5u, 0x391c0cb3u, 0x4ed8aa4au, 0x5b9cca4fu, 0x682e6ff3u,
	0x748f82eeu, 0x78a5636fu, 0x84c87814u, 0x8cc70208u, 0x90befffau, 0xa4506cebu, 0xbef9a3f7u, 0xc67178f2u,
};

#define ROTR(x, n) (((x) >> (n)) | ((x) << (32 - (n))))

static void compress(uint32_t state[8], const uint8_t block[64]) {
	uint32_t w[64];
	for (int t = 0; t < 16; t++) {
		w[t] = ((uint32_t)block[t * 4] << 24) | ((uint32_t)block[t * 4 + 1] << 16) |
		       ((uint32_t)block[t * 4 + 2] << 8) | (uint32_t)block[t * 4 + 3];
	}
	for (int t = 16; t < 64; t++) {
		uint32_t s0 = ROTR(w[t - 15], 7) ^ ROTR(w[t - 15], 18) ^ (w[t - 15] >> 3);
		uint32_t s1 = ROTR(w[t - 2], 17) ^ ROTR(w[t - 2], 19) ^ (w[t - 2] >> 10);
		w[t] = w[t - 16] + s0 + w[t - 7] + s1;
	}
	uint32_t a = state[0], b = state[1], c = state[2], d = state[3];
	uint32_t e = state[4], f = state[5], g = state[6], h = state[7];
	for (int t = 0; t < 64; t++) {
		uint32_t S1 = ROTR(e, 6) ^ ROTR(e, 11) ^ ROTR(e, 25);
		uint32_t ch = (e & f) ^ (~e & g);
		uint32_t t1 = h + S1 + ch + K[t] + w[t];
		uint32_t S0 = ROTR(a, 2) ^ ROTR(a, 13) ^ ROTR(a, 22);
		uint32_t maj = (a & b) ^ (a & c) ^ (b & c);
		uint32_t t2 = S0 + maj;
		h = g;
		g = f;
		f = e;
		e = d + t1;
		d = c;
		c = b;
		b = a;
		a = t1 + t2;
	}
	state[0] += a;
	state[1] += b;
	state[2] += c;
	state[3] += d;
	state[4] += e;
	state[5] += f;
	state[6] += g;
	state[7] += h;
}

void insimulcore_sha256_init(insimulcore_sha256_ctx *ctx) {
	static const uint32_t H0[8] = {
		0x6a09e667u, 0xbb67ae85u, 0x3c6ef372u, 0xa54ff53au, 0x510e527fu, 0x9b05688cu, 0x1f83d9abu, 0x5be0cd19u,
	};
	memcpy(ctx->state, H0, sizeof(H0));
	ctx->bytes = 0;
	ctx->used = 0;
}

void insimulcore_sha256_update(insimulcore_sha256_ctx *ctx, const void *data, size_t len) {
	const uint8_t *p = (const uint8_t *)data;
	ctx->bytes += (uint64_t)len;
	while (len > 0) {
		size_t take = 64 - ctx->used;
		if (take > len) take = len;
		memcpy(ctx->block + ctx->used, p, take);
		ctx->used += take;
		p += take;
		len -= take;
		if (ctx->used == 64) {
			compress(ctx->state, ctx->block);
			ctx->used = 0;
		}
	}
}

void insimulcore_sha256_final_hex(insimulcore_sha256_ctx *ctx, char hex[65]) {
	static const char digits[] = "0123456789abcdef";
	uint64_t bits = ctx->bytes * 8u;
	/* §5.1.1: a single 1 bit, zeros to 56 mod 64 bytes, then the 64-bit length. */
	uint8_t pad = 0x80;
	insimulcore_sha256_update(ctx, &pad, 1);
	uint8_t zero = 0;
	while (ctx->used != 56) insimulcore_sha256_update(ctx, &zero, 1);
	uint8_t len_be[8];
	for (int i = 0; i < 8; i++) len_be[i] = (uint8_t)(bits >> (56 - 8 * i));
	insimulcore_sha256_update(ctx, len_be, 8);
	for (int i = 0; i < 8; i++) {
		for (int j = 0; j < 4; j++) {
			uint8_t byte = (uint8_t)(ctx->state[i] >> (24 - 8 * j));
			hex[(i * 4 + j) * 2] = digits[byte >> 4];
			hex[(i * 4 + j) * 2 + 1] = digits[byte & 0x0f];
		}
	}
	hex[64] = '\0';
}

void insimulcore_sha256_hex(const void *data, size_t len, char hex[65]) {
	insimulcore_sha256_ctx ctx;
	insimulcore_sha256_init(&ctx);
	insimulcore_sha256_update(&ctx, data, len);
	insimulcore_sha256_final_hex(&ctx, hex);
}
