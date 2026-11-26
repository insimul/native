/*
 * build_log_redaction_order.mjs — the witness that the two orders core's build-log
 * redaction states are pinned on this library (PL.native-build-redact-rows; core's
 * PL.core-build-log-redaction round 2, which pinned both in its corpus).
 *
 *   node tests/build_log_redaction_order.mjs
 *
 * Core's rule runs its steps in an order, and two of its orderings change answers:
 *
 *   A  credentials before paths: redactBuildLogLine composes
 *      redactLocalPaths(redactCredentialTokens(redactCredentialAssignment(line)), context);
 *      paths first leaves `<credential><home>/ca.pem` where core writes `<credential>`.
 *   B  the usual home forms before the user-name segment: in redactLocalPaths the
 *      WINDOWS_HOME_RE / POSIX_HOME_RE replace runs before the userName loop; the loop
 *      first leaves `<home folder>/<user>/x` where core writes `<home>/x`.
 *
 * This witness reads the VENDORED bundle (corebridge/vendor/core/insimul-core-bundle.js,
 * the very text libinsimulcore evaluates) and:
 *
 *   1. finds each order in it exactly as core states it (A's composition once; B's home
 *      replace once, before the userName loop) — a bundle with either order swapped is
 *      RED here, before anything runs;
 *   2. replays all of conformance/headless-build/log-redaction.json through the
 *      `build.redactLogLine` and `build.redactLog` rows of that bundle, evaluated in
 *      Node exactly as tests/corebridge_cases.mjs evaluates it (markers expanded as
 *      tests/build_log_redaction_corpus.cpp expands them), and requires every case to
 *      agree;
 *   3. swaps A, then B, in a copy of the bundle text and replays the corpus again:
 *      each swap must change the bundle and be REFUSED by at least one case, and the
 *      cases that refuse it are named.
 *
 * So a re-vendor or an edit that swaps either order is red twice: here (1, and 2 on the
 * swapped text), and in the C legs, whose build_log_redaction_corpus replays the same
 * cases through QuickJS. A bundle whose text no longer matches the patterns (core
 * reworded the functions) is red too, with the pattern named: the witness is then
 * re-pointed, never skipped.
 */

import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const BUNDLE = join(REPO, 'corebridge', 'vendor', 'core', 'insimul-core-bundle.js');
const CORPUS = join(REPO, 'corebridge', 'vendor', 'core', 'conformance', 'headless-build', 'log-redaction.json');

let failures = 0;
function fail(message) {
	console.log(`  [FAIL] ${message}`);
	failures++;
}

const original = readFileSync(BUNDLE, 'utf8');
const corpus = JSON.parse(readFileSync(CORPUS, 'utf8'));
if (corpus.area !== 'build-log-redaction' || !Array.isArray(corpus.cases) || corpus.cases.length === 0) {
	console.log(`build_log_redaction_order: ${CORPUS} is not core's build-log redaction corpus`);
	process.exit(2);
}

// ── the two orders, as the bundle spells core's functions ────────────────────

const ID = '[\\w$]+';
/** An esbuild rename suffix (`redactLocalPaths2`), or none. */
const SUFFIX = '[\\w$]*';
/** The text of the bundled function `name` (up to the next top-level function of the bundle). */
function functionText(text, name) {
	const start = text.search(new RegExp(`\\n\\s*function ${name}\\(`));
	if (start < 0) return null;
	const next = text.slice(start + 1).search(/\n {0,2}function [\w$]+\(/);
	return { start: start + 1, end: next < 0 ? text.length : start + 1 + next };
}

// A: the composition in redactBuildLogLine.
const A_CORE = new RegExp(`return (redactLocalPaths${SUFFIX})\\((redactCredentialTokens${SUFFIX})\\((redactCredentialAssignment${SUFFIX})\\(line\\)\\), context\\);`, 'g');
function orderA(text) {
	const f = functionText(text, `redactBuildLogLine${SUFFIX}`);
	if (!f) return { found: 0 };
	const body = text.slice(f.start, f.end);
	const hits = [...body.matchAll(A_CORE)];
	return { found: hits.length, f, body, hit: hits[0] };
}
function swapA(text) {
	const a = orderA(text);
	if (a.found !== 1) return null;
	const [whole, paths, tokens, assignment] = a.hit;
	const body = a.body.replace(whole, `return ${tokens}(${paths}(${assignment}(line), context));`);
	return text.slice(0, a.f.start) + body + text.slice(a.f.end);
}

// B: the home-form replace before the userName loop in redactLocalPaths.
const B_HOME = new RegExp(`\\n(\\s*)out = out\\.replace\\((WINDOWS_HOME_RE${SUFFIX}), (${ID})\\)\\.replace\\((POSIX_HOME_RE${SUFFIX}), \\3\\);`, 'g');
const B_USER = /\n\s*const user = context\.userName \?\? "";/;
function orderB(text) {
	const f = functionText(text, `redactLocalPaths${SUFFIX}`);
	if (!f) return { found: 0 };
	const body = text.slice(f.start, f.end);
	const hits = [...body.matchAll(B_HOME)];
	const user = body.search(B_USER);
	return { found: hits.length, f, body, hit: hits[0], before: hits.length === 1 && user > 0 && hits[0].index < user };
}
function swapB(text) {
	const b = orderB(text);
	if (b.found !== 1 || !b.before) return null;
	const without = b.body.replace(b.hit[0], '');
	const at = without.lastIndexOf('\n    return out;');
	if (at < 0) return null;
	const body = without.slice(0, at) + b.hit[0] + without.slice(at);
	return text.slice(0, b.f.start) + body + text.slice(b.f.end);
}

// ── replaying the corpus through the rows of one bundle text ──────────────────

function fixtures(name) {
	return Object.fromEntries(Object.entries(corpus.contract[name] ?? {}).map(([k, parts]) => [k, parts.join('')]));
}
const SECRETS = fixtures('secretFixtures');
const LOCALS = fixtures('localFixtures');
function expand(v, kind, fx) {
	const re = new RegExp(`<<${kind}:([a-z-]+)>>`, 'g');
	const one = (s) =>
		s.replace(re, (_, n) => {
			if (!Object.hasOwn(fx, n)) throw new Error(`unknown ${kind} fixture ${n}`);
			return fx[n];
		});
	if (typeof v === 'string') return one(v);
	if (Array.isArray(v)) return v.map((x) => expand(x, kind, fx));
	if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [one(k), expand(x, kind, fx)]));
	return v;
}

async function replay(text) {
	const noProlog = () => {
		throw new Error('no Prolog engine here');
	};
	const context = vm.createContext({
		__insimul_sha256_hex: (t) => createHash('sha256').update(String(t), 'utf8').digest('hex'),
		__insimul_prolog_create: noProlog,
		__insimul_prolog_consult: noProlog,
		__insimul_prolog_query: noProlog,
		__insimul_prolog_destroy: noProlog,
	});
	new vm.Script(text, { filename: 'insimul-core-bundle.js' }).runInContext(context);
	const dispatch = context.__insimul_core_dispatch;
	if (typeof dispatch !== 'function') throw new Error('the bundle did not install __insimul_core_dispatch');
	const refused = [];
	for (const c of corpus.cases) {
		const input = expand(expand(c.input, 'secret', SECRETS), 'local', LOCALS);
		const want = JSON.stringify(expand(c.expected, 'local', LOCALS));
		let got;
		if (c.op === 'redactLine') {
			const a = await dispatch('build.redactLogLine', JSON.stringify({ line: input.line, ...(input.context ? { context: input.context } : {}) }));
			got = JSON.stringify(a); // the whole answer: `{ line }` and nothing else
		} else if (c.op === 'redactLog') {
			const a = await dispatch('build.redactLog', JSON.stringify({ log: input.lines, ...(input.context ? { context: input.context } : {}) }));
			got = a && Object.keys(a).join() === 'log' ? JSON.stringify({ lines: a.log }) : JSON.stringify(a); // `{ log }` and nothing else
		} else {
			throw new Error(`unknown op ${c.op}`);
		}
		if (got !== want) refused.push(c.name);
	}
	return refused;
}

// ── the run ──────────────────────────────────────────────────────────────────

const a = orderA(original);
const b = orderB(original);
console.log(`build_log_redaction_order: ${corpus.cases.length} case(s) of ${CORPUS.slice(REPO.length + 1)}`);
if (a.found !== 1) fail(`A: the vendored bundle does not compose redactBuildLogLine as core states (credentials before paths): found ${a.found}`);
else console.log('  A credentials before paths: stated in the vendored bundle');
if (b.found !== 1 || !b.before) fail(`B: the vendored bundle does not run the home forms before the userName segment (found ${b.found}, before the loop: ${!!b.before})`);
else console.log('  B home forms before the user segment: stated in the vendored bundle');

const asVendored = await replay(original);
if (asVendored.length) fail(`the vendored bundle: ${asVendored.length} case(s) refused: ${asVendored.join(' | ')}`);
else console.log(`  as vendored: ${corpus.cases.length} of ${corpus.cases.length} case(s) agree`);

for (const [label, swap] of [
	['A swapped (paths before credentials)', swapA],
	['B swapped (user segment before home forms)', swapB],
]) {
	const text = swap(original);
	if (text === null || text === original) {
		fail(`${label}: the swap could not be made in the vendored bundle (the pattern no longer matches core's functions)`);
		continue;
	}
	const refused = await replay(text);
	if (refused.length === 0) fail(`${label}: every case still agrees — the corpus does not pin this order`);
	else console.log(`  ${label}: refused by ${refused.length} case(s): ${refused.join(' | ')}`);
}

if (failures) {
	console.log(`build_log_redaction_order: FAIL (${failures})`);
	process.exit(1);
}
console.log('build_log_redaction_order: PASS — both orders are stated in the bundle and each swap is refused by the corpus');
