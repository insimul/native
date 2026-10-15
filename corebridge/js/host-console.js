// host-console.js — a `console` for an engine that has none.
//
// WHY THIS EXISTS. QuickJS without quickjs-libc (deliberately: the embedded
// runtime has no filesystem, process or network access) defines no `console`.
// Core logs from inside functions the adopted surface calls — `migrateSaveFile`
// announces each migration step, `migrateExtensions` warns about an orphan key,
// `DynamicQuestWaypointDirector` debugs an objective it cannot place — and two of
// those three are unguarded, so without a console they would throw a
// ReferenceError out of an ordinary save load.
//
// WHAT IT DOES WITH THE TEXT. Nothing reaches the host's stdout or stderr: a game
// library that prints is a game library that corrupts somebody's log. Each line
// is kept in a bounded buffer instead, which `entry.js` clears at the start of
// every call and the `core.diagnostics` row returns — so "what did core say while
// it loaded that save" is answerable from any engine, after the fact, without a
// debugger.
//
// It is a POLYFILL like host-text-codec.js, not a seam: core has no import for it
// to resolve, so it installs a global and `entry.js` imports it first. It is
// installed unconditionally, so the C host and the JS harness (which runs the
// bundle in a Node `vm` context) record the same lines.

/** At most this many lines are kept per call; the rest are counted, not stored. */
export const MAX_DIAGNOSTICS = 200;

let lines = [];
let dropped = 0;

function render(value) {
	if (typeof value === 'string') return value;
	if (value instanceof Error) return `${value.name}: ${value.message}`;
	try {
		const text = JSON.stringify(value);
		return text === undefined ? String(value) : text;
	} catch {
		return String(value);
	}
}

function recorder(level) {
	return (...values) => {
		if (lines.length >= MAX_DIAGNOSTICS) {
			dropped += 1;
			return;
		}
		lines.push({ level, text: values.map(render).join(' ') });
	};
}

/** Forget everything recorded so far (called by the dispatcher per call). */
export function clearDiagnostics() {
	lines = [];
	dropped = 0;
}

/** What core logged during the most recent call, oldest first. */
export function diagnostics() {
	return { lines: lines.map((l) => ({ ...l })), dropped };
}

globalThis.console = {
	log: recorder('log'),
	info: recorder('info'),
	debug: recorder('debug'),
	warn: recorder('warn'),
	error: recorder('error'),
	trace: recorder('trace'),
};
