/*
 * corebridge_sha256.c — the C SHA-256 libinsimulcore hashes save envelopes with
 * (corebridge/src/insimulcore_sha256.c), against the FIPS 180-4 / NIST CAVS
 * example vectors, fed whole and split at every possible boundary (the partial
 * block buffering is where a hand-written SHA-256 goes wrong).
 *
 * The other half of its evidence is behavioural and lives in the case corpus:
 * core's conformance/saves/integrity-vectors.json through `save.integrity`, and
 * non-ASCII digests computed independently with Node's crypto (bridge-saves.json).
 */

#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#include "insimulcore_sha256.h"

static int check(const char *label, const char *msg, size_t len, const char *want) {
	char hex[65];
	insimulcore_sha256_hex(msg, len, hex);
	if (strcmp(hex, want) != 0) {
		fprintf(stderr, "sha256: %s: got %s, want %s\n", label, hex, want);
		return 1;
	}
	/* Every split point, as two updates. */
	for (size_t cut = 0; cut <= len; cut++) {
		insimulcore_sha256_ctx ctx;
		insimulcore_sha256_init(&ctx);
		insimulcore_sha256_update(&ctx, msg, cut);
		insimulcore_sha256_update(&ctx, msg + cut, len - cut);
		insimulcore_sha256_final_hex(&ctx, hex);
		if (strcmp(hex, want) != 0) {
			fprintf(stderr, "sha256: %s split at %zu: got %s, want %s\n", label, cut, hex, want);
			return 1;
		}
	}
	printf("sha256: %s ok\n", label);
	return 0;
}

int main(void) {
	int bad = 0;
	bad |= check("empty", "", 0, "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855");
	bad |= check("abc", "abc", 3, "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
	bad |= check("448-bit", "abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq", 56,
			"248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1");
	bad |= check("896-bit",
			"abcdefghbcdefghicdefghijdefghijkefghijklfghijklmghijklmnhijklmnoijklmnopjklmnopqklmnopqrlmnopqrsmnopqrstnopqrstu",
			112, "cf5b16a778af8380036ce59e7b0492370b249b11e8f07a51afac45037afee9d1");
	/* An embedded NUL is hashed, not a terminator (JS strings may carry one). */
	bad |= check("nul", "a\0b", 3, "59b271ae1bbcb1d31d41929817f4b16fb439eb4f31520b5ad1d5ce98920a7138");

	/* One million 'a' (FIPS 180-2 appendix B.3), in uneven chunks. */
	size_t n = 1000000;
	char *million = (char *)malloc(n);
	if (!million) return 2;
	memset(million, 'a', n);
	insimulcore_sha256_ctx ctx;
	insimulcore_sha256_init(&ctx);
	size_t off = 0, step = 1;
	while (off < n) {
		size_t take = step < n - off ? step : n - off;
		insimulcore_sha256_update(&ctx, million + off, take);
		off += take;
		step = step * 3 % 997 + 1;
	}
	char hex[65];
	insimulcore_sha256_final_hex(&ctx, hex);
	free(million);
	if (strcmp(hex, "cdc76e5c9914fb9281a1c7e284d73e67f1809a48a497200e046d39ccc7112cd0") != 0) {
		fprintf(stderr, "sha256: million-a: got %s\n", hex);
		bad = 1;
	} else {
		printf("sha256: million-a ok\n");
	}
	printf(bad ? "sha256: FAIL\n" : "sha256: PASS\n");
	return bad;
}
