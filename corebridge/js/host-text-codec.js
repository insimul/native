// host-text-codec.js — `TextEncoder` / `TextDecoder` for QuickJS.
//
// WHY THIS EXISTS. `TextEncoder` is a WHATWG platform API, not an ECMAScript
// one, so a bare JS engine does not have it — QuickJS included. Core's
// `identity/kinp.ts` constructs both AT MODULE SCOPE to percent-encode a local
// id's non-ASCII characters, and `identity/` is reached by every band-120
// mechanic module (a KINP identifier is how an observer, a target and an agent
// are named). Before this file the whole bundle failed to evaluate with
// `ReferenceError: 'TextEncoder' is not defined` — not at the call, at load.
//
// It is a POLYFILL, not a seam: unlike `host-prolog-engine.js` and
// `host-crypto.js`, nothing about it is adapter-specific and core has no import
// for it to resolve. So it installs globals, and `entry.js` imports it FIRST —
// esbuild emits modules in import order, and core's module-scope construction
// must find them already there.
//
// SCOPE. UTF-8 only, which is the only encoding the spec requires a
// `TextEncoder` to support and the only one `TextDecoder` is constructed for
// here. Both follow the WHATWG replacement-character rules rather than throwing:
// a lone surrogate encodes as U+FFFD and a malformed byte sequence decodes to
// U+FFFD, because the caller is sanitising an id and a thrown error there would
// turn an odd character in a world's content into a failure to load the world.
//
// A native implementation in ../src/insimulcore.c would be faster. It would also
// be a second UTF-8 codec in a repository that already has one per language, and
// this is called once per non-ASCII character in an authored id.

const REPLACEMENT = 0xfffd;

class PolyfillTextEncoder {
	get encoding() {
		return 'utf-8';
	}

	/** @param {string} input @returns {Uint8Array} */
	encode(input = '') {
		const str = String(input);
		const bytes = [];
		for (let i = 0; i < str.length; i++) {
			let code = str.charCodeAt(i);
			// Surrogate pair → the astral code point it encodes. A lone surrogate
			// (either half, unpaired) is U+FFFD, as the spec requires.
			if (code >= 0xd800 && code <= 0xdbff) {
				const next = i + 1 < str.length ? str.charCodeAt(i + 1) : 0;
				if (next >= 0xdc00 && next <= 0xdfff) {
					code = 0x10000 + ((code - 0xd800) << 10) + (next - 0xdc00);
					i++;
				} else {
					code = REPLACEMENT;
				}
			} else if (code >= 0xdc00 && code <= 0xdfff) {
				code = REPLACEMENT;
			}

			if (code < 0x80) {
				bytes.push(code);
			} else if (code < 0x800) {
				bytes.push(0xc0 | (code >> 6), 0x80 | (code & 0x3f));
			} else if (code < 0x10000) {
				bytes.push(0xe0 | (code >> 12), 0x80 | ((code >> 6) & 0x3f), 0x80 | (code & 0x3f));
			} else {
				bytes.push(
					0xf0 | (code >> 18),
					0x80 | ((code >> 12) & 0x3f),
					0x80 | ((code >> 6) & 0x3f),
					0x80 | (code & 0x3f),
				);
			}
		}
		return new Uint8Array(bytes);
	}
}

class PolyfillTextDecoder {
	constructor(label = 'utf-8') {
		const normalized = String(label).toLowerCase();
		if (normalized !== 'utf-8' && normalized !== 'utf8' && normalized !== 'unicode-1-1-utf-8') {
			// Loud rather than silently wrong: a caller asking for latin1 and
			// getting UTF-8 is the kind of defect a corpus would not catch.
			throw new RangeError(`insimulcore: TextDecoder supports utf-8 only, not "${label}"`);
		}
	}

	get encoding() {
		return 'utf-8';
	}

	/** @param {Uint8Array | ArrayBuffer} input @returns {string} */
	decode(input) {
		if (input === undefined || input === null) return '';
		const bytes =
			input instanceof Uint8Array
				? input
				: new Uint8Array(input.buffer !== undefined ? input.buffer : input);
		let out = '';
		for (let i = 0; i < bytes.length; ) {
			const byte = bytes[i];
			let code;
			let width;
			if (byte < 0x80) {
				code = byte;
				width = 1;
			} else if ((byte & 0xe0) === 0xc0) {
				code = byte & 0x1f;
				width = 2;
			} else if ((byte & 0xf0) === 0xe0) {
				code = byte & 0x0f;
				width = 3;
			} else if ((byte & 0xf8) === 0xf0) {
				code = byte & 0x07;
				width = 4;
			} else {
				out += String.fromCharCode(REPLACEMENT);
				i++;
				continue;
			}

			if (i + width > bytes.length) {
				out += String.fromCharCode(REPLACEMENT);
				break;
			}
			let malformed = false;
			for (let k = 1; k < width; k++) {
				const cont = bytes[i + k];
				if ((cont & 0xc0) !== 0x80) {
					malformed = true;
					break;
				}
				code = (code << 6) | (cont & 0x3f);
			}
			// Overlong encodings, surrogates and out-of-range code points are all
			// malformed input; the spec's answer to every one of them is U+FFFD.
			if (
				malformed ||
				code > 0x10ffff ||
				(code >= 0xd800 && code <= 0xdfff) ||
				(width === 2 && code < 0x80) ||
				(width === 3 && code < 0x800) ||
				(width === 4 && code < 0x10000)
			) {
				out += String.fromCharCode(REPLACEMENT);
				i++;
				continue;
			}

			if (code < 0x10000) {
				out += String.fromCharCode(code);
			} else {
				const astral = code - 0x10000;
				out += String.fromCharCode(0xd800 + (astral >> 10), 0xdc00 + (astral & 0x3ff));
			}
			i += width;
		}
		return out;
	}
}

// Installed only when absent, so a future QuickJS that ships them wins.
if (typeof globalThis.TextEncoder === 'undefined') globalThis.TextEncoder = PolyfillTextEncoder;
if (typeof globalThis.TextDecoder === 'undefined') globalThis.TextDecoder = PolyfillTextDecoder;

export { PolyfillTextEncoder, PolyfillTextDecoder };
