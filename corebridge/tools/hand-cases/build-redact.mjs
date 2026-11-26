// hand-cases/build-redact.mjs — the hand cases of the build.redactLogLine and build.redactLog rows
// (PL.native-build-redact-rows), beyond core's corpus (conformance/build/log-redaction.json): the
// private-key state a streaming runner carries through `build.redactLogLine` (which the corpus pins
// only through redactLog), a context of `null` and context parts of `null`, both orders core's round 2
// pinned (credentials before paths; the usual home forms before the user-name segment) on lines of
// this file's own, and the rows' [invalid-input] boundary.
//
// Written by tools/gen-hand-cases.mjs: every `expect` below is core's own answer at the pin, computed
// by the calls this file makes on core's `build/build-log-redaction` (see that tool's header). Every
// line is synthetic. Credentials here are shapes core's scan names and no history-scan rule does (a
// database URL without a password, a Bearer token), and the private-key header is spelt with a word
// (`FAKE`) the history scan's list does not hold; home folders are `/home/…`, `/users/…` and
// `C:\Users\…`.

import { redactBuildLog, redactBuildLogLine } from '@insimul/core/build/build-log-redaction';

export const output = 'bridge-build-redact.json';
export const area = 'build-redact-hand';
export const description =
	"Hand cases for the build.redactLogLine and build.redactLog rows (PL.native-build-redact-rows) beyond core's " +
	'build-log redaction corpus: the private-key state carried line by line through build.redactLogLine (as a runner ' +
	"streaming its tools' output carries it), a null context and null context parts, both orders core pins (credentials " +
	"before paths; the usual home forms before the user-name segment), and the rows' [invalid-input] boundary. Every " +
	"expectation is core's own answer at the pin, computed by tools/hand-cases/build-redact.mjs through " +
	'tools/gen-hand-cases.mjs.';

const BEGIN = '-----BEGIN FAKE PRIVATE KEY-----';
const END = '-----END FAKE PRIVATE KEY-----';
const DB = 'mongodb+srv://cluster0.example.invalid/insimul';
const BEARER = 'Bearer fakefakefakefake0123456789abcdef';

/** The row's answer to one line, from core's redactBuildLogLine (entry.js `build.redactLogLine`). */
function lineRow(line, context, state) {
	const s = state === undefined || state === null ? undefined : { inPrivateKey: state.inPrivateKey };
	const out = redactBuildLogLine(line, context ?? {}, s);
	return s === undefined ? { line: out } : { line: out, state: { inPrivateKey: s.inPrivateKey } };
}

/** The row's answer to a log, from core's redactBuildLog (entry.js `build.redactLog`). */
function logRow(log, context) {
	return { log: redactBuildLog(log, context ?? {}) };
}

export function build() {
	const cases = [];
	const c = (name, steps) => cases.push({ name, steps });
	const line = (args) => ({ call: 'build.redactLogLine', args, expect: lineRow(args.line, args.context, args.state) });
	const log = (args) => ({ call: 'build.redactLog', args, expect: logRow(args.log, args.context) });
	const inv = (call, args, text) => ({ call, args, expectError: text });

	// ── 1. The line row: no state, so only a header line is withheld ──
	c('build.redactLogLine without state: an assignment, a credential in a line, a kept line, a header and a body line', [
		line({ line: 'TOKEN=abc123' }),
		line({ line: `export SERVICE_URL="${DB}"` }),
		line({ line: `Fetching with Authorization: ${BEARER} ok` }),
		line({ line: 'Cook finished: 412 packages, errors=0' }),
		line({ line: `key: ${BEGIN}` }),
		line({ line: 'MIIEvfakefakefakefake' }),
		line({ line: '' }),
	]);

	// ── 2. The state a streaming runner carries ──
	// Each step sends the state the previous answer carried (bound, then sent back with $ref).
	const block = ['writing signing key', BEGIN, 'MIIEvfakefakefakefake', 'fakefakefake==', END, 'done'];
	{
		const steps = [];
		let state = { inPrivateKey: false };
		block.forEach((l, i) => {
			const args = i === 0 ? { line: l, state } : { line: l, state: { $ref: `s${i - 1}.state` } };
			const expect = lineRow(l, undefined, state);
			steps.push({ call: 'build.redactLogLine', args, expect, bind: `s${i}` });
			state = expect.state;
		});
		steps.push(log({ log: block }));
		c('build.redactLogLine carries a private-key block header to footer when the state is sent back, as build.redactLog does', steps);
	}
	c('the state: a key on one line ends its own block; a footer before the header does not; a set state withholds any line', [
		line({ line: `"${BEGIN}\\nMIIE\\n${END}"`, state: { inPrivateKey: false } }),
		line({ line: `${END} then ${BEGIN}`, state: { inPrivateKey: false } }),
		line({ line: 'Cook finished: 412 packages, errors=0', state: { inPrivateKey: true } }),
		line({ line: `tail ${END}`, state: { inPrivateKey: true } }),
		line({ line: 'Cook finished: 412 packages, errors=0', state: { inPrivateKey: false } }),
		line({ line: 'TOKEN=abc123', state: null }),
	]);

	// ── 3. The context ──
	const ctx = { projectDir: '/home/ann/Games/Thistle', homeDir: '/home/ann', userName: 'ann' };
	c('the context: absent, null, each part, null parts, and a whole one', [
		line({ line: 'Wrote /home/ann/Games/Thistle/Builds/web/index.html' }),
		line({ line: 'Wrote /home/ann/Games/Thistle/Builds/web/index.html', context: null }),
		line({ line: 'Wrote /home/ann/Games/Thistle/Builds/web/index.html', context: { projectDir: ctx.projectDir } }),
		line({ line: 'cache at /var/lib/ci-builder/.cache', context: { homeDir: '/var/lib/ci-builder' } }),
		line({ line: 'mounted /Volumes/ann/Builds', context: { userName: 'ann' } }),
		line({ line: 'mounted /Volumes/ann/Builds and ann ran', context: { projectDir: null, homeDir: null, userName: 'ann' } }),
		line({ line: 'mounted /Volumes/ann/Builds', context: { projectDir: null, homeDir: null, userName: null } }),
		line({ line: 'cd "/home/ann/Games/Thistle" && make', context: ctx }),
		line({ line: 'opened /users/ann/Desktop/notes.txt', context: { userName: 'ann' } }),
		log({ log: ['export UNREAL_TOKEN=abc', 'LogInit: Base directory: /home/ann/Games/Thistle/Binaries/Mac/', `GET ${DB} 200`], context: ctx }),
		log({ log: [], context: null }),
	]);

	// ── 4. The two orders core's round 2 pinned, on this file's own lines ──
	c('credentials before paths: a database URL carrying a home path goes whole, with and without a context', [
		line({ line: `connecting to ${DB}?tlsCAFile=/home/ann/ca.pem` }),
		line({ line: `connecting to ${DB}?tlsCAFile=/home/ann/ca.pem`, context: { userName: 'ann' } }),
		log({ log: [`connecting to ${DB}?tlsCAFile=/home/ann/ca.pem`] }),
	]);
	c("the usual home forms before the user-name segment: the user's own home folder is <home>, not a <user> segment", [
		line({ line: 'opened /home/ann/Desktop/notes.txt', context: { userName: 'ann' } }),
		line({ line: 'temp at C:\\Users\\ann\\AppData\\Local\\Temp', context: { userName: 'ann' } }),
		line({ line: 'temp at c:/users/ann/AppData/Local/Temp and /srv/ann/x', context: { userName: 'ann' } }),
		log({ log: ['opened /home/ann/Desktop/notes.txt', 'mounted /Volumes/ann/x'], context: { userName: 'ann' } }),
	]);

	// ── 5. The rows' boundary ([invalid-input]) ──
	c('build.redactLogLine and build.redactLog refuse what core reads unchecked, as [invalid-input]', [
		inv('build.redactLogLine', {}, '[invalid-input] insimulcore: build.redactLogLine: `line` must be a string'),
		inv('build.redactLogLine', { line: 5 }, '`line` must be a string'),
		inv('build.redactLogLine', { line: 'x', context: 'ctx' }, '[invalid-input] insimulcore: build.redactLogLine: `context` must be a JSON object'),
		inv('build.redactLogLine', { line: 'x', context: [] }, '`context` must be a JSON object'),
		inv('build.redactLogLine', { line: 'x', context: { projectDir: 5 } }, '`context.projectDir` must be a string'),
		inv('build.redactLogLine', { line: 'x', context: { homeDir: false } }, '`context.homeDir` must be a string'),
		inv('build.redactLogLine', { line: 'x', context: { userName: ['ann'] } }, '`context.userName` must be a string'),
		inv('build.redactLogLine', { line: 'x', state: true }, '[invalid-input] insimulcore: build.redactLogLine: `state` must be a JSON object'),
		inv('build.redactLogLine', { line: 'x', state: {} }, '`state.inPrivateKey` must be a boolean'),
		inv('build.redactLogLine', { line: 'x', state: { inPrivateKey: 'yes' } }, '`state.inPrivateKey` must be a boolean'),
		inv('build.redactLog', {}, '[invalid-input] insimulcore: build.redactLog: `log` must be an array'),
		inv('build.redactLog', { log: 'a\nb' }, '`log` must be an array'),
		inv('build.redactLog', { log: ['a', 5] }, '`log[1]` must be a string'),
		inv('build.redactLog', { log: ['a'], context: 7 }, '`context` must be a JSON object'),
		inv('build.redactLog', { log: ['a'], context: { userName: 7 } }, '`context.userName` must be a string'),
	]);
	return cases;
}
