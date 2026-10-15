// host-sessions.js — the session table behind every STATEFUL row in entry.js.
//
// Some of what the feature phases adopt is a value in and a value out (a save
// envelope, a genre resolution, a marker decision). The rest is one of core's
// stateful view-models or decision layers — `Notifications`, `PauseMenuModel`,
// `QuestJournalModel`, `LoadingScreenModel`, `QuestCompletionEngine`,
// `GameTimeManager`, `WeatherDirector` — whose state has to live somewhere
// between two calls. It lives HERE, in the JS heap of the handle, and the host
// holds only an integer.
//
// THE CONTRACT every stateful row follows (README.md, "Sessions"):
//
//   `<area>.create {…}`  → `{ session, … }`   opens one, returns its handle;
//   `<area>.apply  { session, ops: [{ op, … }] }`
//                        → `{ results, …, view }` runs the ops IN ORDER, one
//                          result per op, then reports the model's view once;
//   `session.dispose { session }`             releases it (idempotent);
//   `session.list`                            every open session — a leak in a
//                                             game shows up here as growth.
//
// Handles are positive integers, unique per `insimul_core` handle, issued in
// order from 1 and never reused, so a case corpus can name them literally. A
// handle of the wrong kind is refused by name rather than coerced: a pause-menu
// handle passed to `clock.apply` is a bug in the caller, and the error says
// which two kinds were confused.
//
// ATOMICITY, stated rather than implied: ops run in order and an op that throws
// stops the batch with the earlier ops' effects KEPT (core's models mutate in
// place and have no undo). The error names the failing op's index, so a host can
// re-read the view and decide.

const SESSIONS = new Map();
let nextHandle = 1;

/** Open a session of `kind` around `state` (an object the rows own). */
export function openSession(kind, state) {
	const handle = nextHandle++;
	SESSIONS.set(handle, { kind, ...state });
	return handle;
}

/** The session `args.session` names, which must be of `kind`. */
export function session(method, args, kind) {
	const handle = args ? args.session : undefined;
	const found = SESSIONS.get(handle);
	if (!found) {
		throw new Error(`insimulcore: ${method}: no open session ${JSON.stringify(handle ?? null)}`);
	}
	if (found.kind !== kind) {
		throw new Error(`insimulcore: ${method}: session ${handle} is a ${found.kind} session, not ${kind}`);
	}
	return found;
}

/** Close a session. Returns whether one was open. */
export function disposeSession(handle) {
	return SESSIONS.delete(handle);
}

/** Every open session, in handle order. */
export function listSessions() {
	return [...SESSIONS.entries()]
		.sort((a, b) => a[0] - b[0])
		.map(([handle, s]) => ({ session: handle, kind: s.kind }));
}

/**
 * Run `args.ops` against session `s` through `table` (op name → function of
 * (s, op) returning the op's result). Unknown ops are refused with the list of
 * known ones; a throwing op is re-thrown naming its index.
 */
export async function applyOps(method, s, args, table) {
	const ops = args.ops;
	if (!Array.isArray(ops)) throw new Error(`insimulcore: ${method}: \`ops\` must be an array of { op, … }`);
	const results = [];
	for (let i = 0; i < ops.length; i++) {
		const op = ops[i];
		const name = op && typeof op === 'object' ? op.op : undefined;
		const fn = typeof name === 'string' && Object.prototype.hasOwnProperty.call(table, name) ? table[name] : null;
		if (!fn) {
			throw new Error(
				`insimulcore: ${method}: ops[${i}] has no known op ${JSON.stringify(name ?? null)} ` +
					`(known: ${Object.keys(table).join(', ')})`,
			);
		}
		try {
			const result = await fn(s, op);
			results.push(result === undefined ? null : result);
		} catch (err) {
			const msg = err && err.message ? err.message : String(err);
			const wrapped = new Error(`insimulcore: ${method}: ops[${i}] (${name}) failed: ${msg}`);
			if (err && typeof err.code === 'string') wrapped.code = err.code;
			throw wrapped;
		}
	}
	return results;
}
