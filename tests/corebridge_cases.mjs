/*
 * corebridge_cases.mjs — the JS leg of libinsimulcore's method gate.
 *
 * The C leg (tests/corebridge_cases.c) drives every case through insimulcore.h,
 * i.e. through QuickJS, the C SHA-256 and the native Prolog seam. THIS leg
 * evaluates the very same generated bundle (corebridge/vendor/core/
 * insimul-core-bundle.js) in a fresh Node `vm` context per case — V8, Node's own
 * `crypto` behind `__insimul_sha256_hex`, no C at all — and calls the same
 * `__insimul_core_dispatch` the C host calls. Same cases, same matcher rules
 * (corebridge/tests/README.md), same summary line. Two runtimes agreeing on core's
 * own corpora is what makes "the bridge runs core" a measurement.
 *
 *   node tests/corebridge_cases.mjs [--parity <c-records.jsonl>]
 *
 * It also holds the table to its documentation and its tests:
 *   - every method `core.methods` lists is called by at least one case, and every
 *     method a case calls is in the table;
 *   - the method table in corebridge/README.md lists exactly `core.methods`.
 *
 * --parity <file> reads the JSON-Lines records the C leg writes
 * (INSIMUL_CORE_CASES_JSON) and requires every step to have produced the SAME
 * raw result string on both runtimes (and to have failed on both where it
 * failed) — a diff, not two green checkmarks. Error TEXT is not compared: a
 * JSON.parse message is the engine's, not the bridge's (cases assert the part
 * that is the bridge's with expectError).
 *
 * The Prolog seam is NOT wired here (there is no native engine in Node): a case
 * that reaches Prolog fails loudly with "the JS harness has no Prolog engine".
 * No case in the corpus does; the radiant gate (corebridge_radiant) is where the
 * Prolog-backed rows are proven.
 *
 * Non-vacuity: no case directory, an empty one, a file with no case, or a run
 * that executes no step is a hard failure (exit 2).
 */

import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, '..');
const BRIDGE = join(REPO, 'corebridge');
const CASE_DIRS = [join(BRIDGE, 'vendor', 'core', 'cases'), join(BRIDGE, 'tests', 'cases')];
const BUNDLE = join(BRIDGE, 'vendor', 'core', 'insimul-core-bundle.js');
const README = join(BRIDGE, 'README.md');

const argv = process.argv.slice(2);
const parityFile = argv.includes('--parity') ? argv[argv.indexOf('--parity') + 1] : null;

function hard(message) {
	console.error(`corebridge_cases(js): ${message}`);
	process.exit(2);
}

// ── the matcher (corebridge/tests/README.md; lockstep with tests/corebridge_cases.c) ──

const TYPES = { string: 'string', number: 'number', boolean: 'boolean' };

function typeOf(v) {
	if (v === null) return 'null';
	if (Array.isArray(v)) return 'array';
	return typeof v;
}

function isOperator(e) {
	if (e === null || typeof e !== 'object' || Array.isArray(e)) return false;
	const keys = Object.keys(e);
	return keys.length > 0 && keys.every((k) => k.startsWith('$'));
}

function deepEqual(a, b) {
	return match(a, b, '').length === 0;
}

/** Mismatch descriptions for `actual` against `expected` (empty = matches). */
function match(expected, actual, where) {
	const at = where || '<root>';
	if (isOperator(expected)) {
		if ('$subset' in expected) {
			if (typeOf(actual) !== 'object') return [`${at}: expected an object, got ${typeOf(actual)}`];
			const out = [];
			for (const [k, sub] of Object.entries(expected.$subset)) {
				const has = Object.prototype.hasOwnProperty.call(actual, k);
				if (!has && !(isOperator(sub) && '$stacks' in sub)) {
					out.push(`${at}.${k}: missing`);
					continue;
				}
				out.push(...match(sub, has ? actual[k] : undefined, `${at}.${k}`));
			}
			return out;
		}
		if ('$approx' in expected) {
			const tol = expected.$tol ?? 1e-9;
			if (typeof actual !== 'number') return [`${at}: expected a number ≈ ${expected.$approx}, got ${typeOf(actual)}`];
			return Math.abs(actual - expected.$approx) <= tol ? [] : [`${at}: ${actual} is not within ${tol} of ${expected.$approx}`];
		}
		if ('$any' in expected) return actual === undefined ? [`${at}: missing`] : [];
		if ('$type' in expected) {
			return typeOf(actual) === expected.$type ? [] : [`${at}: expected type ${expected.$type}, got ${typeOf(actual)}`];
		}
		if ('$len' in expected) {
			// Arrays only (lockstep with the C leg, which counts no UTF-16 units).
			const n = Array.isArray(actual) ? actual.length : null;
			return n === expected.$len ? [] : [`${at}: expected length ${expected.$len}, got ${n === null ? typeOf(actual) : n}`];
		}
		if ('$ids' in expected) {
			if (!Array.isArray(actual)) return [`${at}: expected an array, got ${typeOf(actual)}`];
			const key = expected.$key ?? 'id';
			const ids = actual.map((x) => (x !== null && typeof x === 'object' ? x[key] : undefined));
			return deepEqual(expected.$ids, ids) ? [] : [`${at}: ${key}s ${JSON.stringify(ids)} ≠ ${JSON.stringify(expected.$ids)}`];
		}
		if ('$multiset' in expected) {
			if (!Array.isArray(actual)) return [`${at}: expected an array, got ${typeOf(actual)}`];
			if (actual.length !== expected.$multiset.length) {
				return [`${at}: expected ${expected.$multiset.length} element(s) in any order, got ${actual.length}`];
			}
			const used = new Array(actual.length).fill(false);
			for (const e of expected.$multiset) {
				const i = actual.findIndex((a, j) => !used[j] && deepEqual(e, a));
				if (i < 0) return [`${at}: no element matches ${JSON.stringify(e).slice(0, 200)}`];
				used[i] = true;
			}
			return [];
		}
		if ('$stacks' in expected) {
			const items = actual === undefined ? [] : actual;
			if (!Array.isArray(items)) return [`${at}: expected an item array, got ${typeOf(items)}`];
			const census = {};
			for (const i of items) census[i.itemId] = (census[i.itemId] ?? 0) + i.quantity;
			return deepEqual(expected.$stacks, census) ? [] : [`${at}: census ${JSON.stringify(census)} ≠ ${JSON.stringify(expected.$stacks)}`];
		}
		throw new Error(`bad case: unknown matcher ${Object.keys(expected).join(',')} at ${at}`);
	}
	if (Array.isArray(expected)) {
		if (!Array.isArray(actual)) return [`${at}: expected an array, got ${typeOf(actual)}`];
		if (actual.length !== expected.length) return [`${at}: expected ${expected.length} element(s), got ${actual.length}`];
		return expected.flatMap((e, i) => match(e, actual[i], `${at}[${i}]`));
	}
	if (expected !== null && typeof expected === 'object') {
		if (typeOf(actual) !== 'object') return [`${at}: expected an object, got ${typeOf(actual)}`];
		const ek = Object.keys(expected).sort();
		const ak = Object.keys(actual).sort();
		const extra = ak.filter((k) => !ek.includes(k));
		const missing = ek.filter((k) => !ak.includes(k));
		const out = [];
		if (extra.length) out.push(`${at}: unexpected key(s) ${extra.join(', ')}`);
		if (missing.length) out.push(`${at}: missing key(s) ${missing.join(', ')}`);
		for (const k of ek) if (ak.includes(k)) out.push(...match(expected[k], actual[k], `${at}.${k}`));
		return out;
	}
	if (TYPES[typeof expected] || expected === null) {
		return Object.is(expected, actual) || (expected === 0 && actual === 0)
			? []
			: [`${at}: expected ${JSON.stringify(expected)}, got ${actual === undefined ? 'nothing' : JSON.stringify(actual)}`];
	}
	throw new Error(`bad case: unmatchable expectation at ${at}`);
}

// ── $ref / $set in args ──────────────────────────────────────────────────────

function getPath(value, dotted, where) {
	let v = value;
	for (const seg of dotted.split('.')) {
		if (v === null || typeof v !== 'object' || !Object.prototype.hasOwnProperty.call(v, seg)) {
			throw new Error(`bad case: ${where} — $ref path ${dotted} does not resolve`);
		}
		v = v[seg];
	}
	return v;
}

function setPath(value, dotted, replacement, where) {
	const segs = dotted.split('.');
	let v = value;
	for (const seg of segs.slice(0, -1)) {
		if (v === null || typeof v !== 'object' || !Object.prototype.hasOwnProperty.call(v, seg)) {
			throw new Error(`bad case: ${where} — $set path ${dotted} does not resolve`);
		}
		v = v[seg];
	}
	v[segs[segs.length - 1]] = replacement;
}

function resolveRefs(value, bound, where) {
	if (Array.isArray(value)) return value.map((v) => resolveRefs(v, bound, where));
	if (value !== null && typeof value === 'object') {
		if (typeof value.$ref === 'string') {
			const [name, ...rest] = value.$ref.split('.');
			if (!Object.prototype.hasOwnProperty.call(bound, name)) throw new Error(`bad case: ${where} — nothing bound as ${name}`);
			let out = structuredClone(rest.length ? getPath(bound[name], rest.join('.'), where) : bound[name]);
			for (const [p, v] of Object.entries(value.$set ?? {})) setPath(out, p, v, where);
			return out;
		}
		return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, resolveRefs(v, bound, where)]));
	}
	return value;
}

// ── one runtime per case ─────────────────────────────────────────────────────

if (!existsSync(BUNDLE)) hard(`no bundle at ${BUNDLE}`);
const script = new vm.Script(readFileSync(BUNDLE, 'utf8'), { filename: 'insimul-core-bundle.js' });

function newRuntime() {
	const noProlog = () => {
		throw new Error('the JS harness has no Prolog engine');
	};
	const context = vm.createContext({
		__insimul_sha256_hex: (text) => createHash('sha256').update(String(text), 'utf8').digest('hex'),
		__insimul_prolog_create: noProlog,
		__insimul_prolog_consult: noProlog,
		__insimul_prolog_query: noProlog,
		__insimul_prolog_destroy: noProlog,
	});
	script.runInContext(context);
	const dispatch = context.__insimul_core_dispatch;
	if (typeof dispatch !== 'function') hard('the bundle did not install __insimul_core_dispatch');
	// Exactly what src/insimulcore.c does with a settled promise.
	return async (method, argsJson) => {
		try {
			const value = await dispatch(method, argsJson);
			const text = JSON.stringify(value);
			return { ok: true, raw: text === undefined ? 'null' : text };
		} catch (reason) {
			return { ok: false, error: `insimulcore: ${String(reason)}` };
		}
	};
}

// ── the run ──────────────────────────────────────────────────────────────────

const files = [];
for (const dir of CASE_DIRS) {
	if (!existsSync(dir)) hard(`case directory missing: ${dir}`);
	const names = readdirSync(dir).filter((f) => f.endsWith('.json')).sort();
	if (names.length === 0) hard(`case directory holds no *.json: ${dir}`);
	for (const n of names) files.push(join(dir, n));
}

const called = new Set();
const cOnly = new Set();
const records = [];
let nCases = 0;
let nSteps = 0;
let failed = 0;

for (const file of files) {
	const rel = file.slice(REPO.length + 1);
	const doc = JSON.parse(readFileSync(file, 'utf8'));
	if (!Array.isArray(doc.cases) || doc.cases.length === 0) hard(`${rel} has no cases`);
	for (const c of doc.cases) {
		nCases++;
		if (Array.isArray(c.legs) && !c.legs.includes('js')) {
			// A case only the C leg can run (it reaches the native Prolog engine).
			// Printed and counted, never silently dropped; its methods still count
			// as covered because the C leg runs them.
			if (typeof c.why !== 'string' || c.why.length < 20) hard(`${rel} :: ${c.name} is C-only without a \`why\``);
			console.log(`  [C-ONLY] ${rel} :: ${c.name} — ${c.why}`);
			cOnly.add(`${rel}\u0000${c.name}`);
			for (const step of c.steps ?? []) called.add(step.call);
			continue;
		}
		const call = newRuntime();
		const bound = {};
		let caseFailed = false;
		for (const [i, step] of (c.steps ?? []).entries()) {
			nSteps++;
			const where = `${rel} :: ${c.name} :: step ${i} (${step.call})`;
			called.add(step.call);
			let argsJson;
			try {
				argsJson = typeof step.argsText === 'string' ? step.argsText : JSON.stringify(resolveRefs(step.args ?? {}, bound, where));
			} catch (e) {
				hard(e.message);
			}
			const res = await call(step.call, argsJson);
			records.push({ file: rel, case: c.name, step: i, method: step.call, ok: res.ok, ...(res.ok ? { raw: res.raw } : {}) });
			const problems = [];
			if (step.expectError !== undefined) {
				if (res.ok) problems.push(`expected an error containing ${JSON.stringify(step.expectError)}, got ${res.raw.slice(0, 200)}`);
				else if (!res.error.includes(step.expectError)) problems.push(`error ${JSON.stringify(res.error)} lacks ${JSON.stringify(step.expectError)}`);
			} else if (!res.ok) {
				problems.push(`call failed: ${res.error}`);
			} else {
				const value = JSON.parse(res.raw);
				if (step.bind) bound[step.bind] = value;
				if (step.expect !== undefined) {
					try {
						problems.push(...match(step.expect, value, ''));
					} catch (e) {
						hard(`${where}: ${e.message}`);
					}
				}
			}
			if (problems.length) {
				caseFailed = true;
				console.log(`  [FAIL] ${where}`);
				for (const p of problems.slice(0, 8)) console.log(`         ${p}`);
				if (problems.length > 8) console.log(`         … ${problems.length - 8} more`);
			}
		}
		if (caseFailed) failed++;
	}
}
if (nSteps === 0) hard('executed no step');

// ── the table against its tests and its documentation ────────────────────────

const methods = JSON.parse((await newRuntime()('core.methods', '{}')).raw).methods;
const surfaceProblems = [];
// A `layout.*` row is held by core's layout corpora instead (the layout_corpus
// ctest, which fails on a row no corpus case names).
for (const m of methods) if (!called.has(m) && !m.startsWith('layout.')) surfaceProblems.push(`method ${m} is called by no case`);
for (const m of called) if (!methods.includes(m) && m !== 'no.such.method') surfaceProblems.push(`a case calls ${m}, which is not in the table`);
const readme = readFileSync(README, 'utf8');
const tableStart = readme.indexOf('<!-- BEGIN METHOD TABLE -->');
const tableEnd = readme.indexOf('<!-- END METHOD TABLE -->');
if (tableStart < 0 || tableEnd < tableStart) {
	surfaceProblems.push('corebridge/README.md has no <!-- BEGIN/END METHOD TABLE --> block');
} else {
	const documented = [...readme.slice(tableStart, tableEnd).matchAll(/^\| `([a-z][A-Za-z0-9.]*)` \|/gm)].map((m) => m[1]);
	const missing = methods.filter((m) => !documented.includes(m));
	const stale = documented.filter((m) => !methods.includes(m));
	const dup = documented.filter((m, i) => documented.indexOf(m) !== i);
	if (missing.length) surfaceProblems.push(`README method table lacks: ${missing.join(', ')}`);
	if (stale.length) surfaceProblems.push(`README method table lists methods the bundle does not have: ${stale.join(', ')}`);
	if (dup.length) surfaceProblems.push(`README method table lists twice: ${dup.join(', ')}`);
}
for (const p of surfaceProblems) console.log(`  [FAIL] surface: ${p}`);

// ── parity with the C leg ────────────────────────────────────────────────────

let parityProblems = 0;
if (parityFile) {
	if (!existsSync(parityFile)) hard(`--parity: no C records at ${parityFile}`);
	const cRecords = readFileSync(parityFile, 'utf8')
		.split('\n')
		.filter(Boolean)
		.map((l) => JSON.parse(l))
		.filter((r) => !cOnly.has(`${r.file}\u0000${r.case}`));
	const key = (r) => `${r.file}\u0000${r.case}\u0000${r.step}`;
	const cBy = new Map(cRecords.map((r) => [key(r), r]));
	if (cRecords.length !== records.length) {
		console.log(`  [FAIL] parity: the C leg recorded ${cRecords.length} step(s), this leg ${records.length}`);
		parityProblems++;
	}
	for (const r of records) {
		const other = cBy.get(key(r));
		if (!other) {
			console.log(`  [FAIL] parity: no C record for ${r.file} :: ${r.case} :: step ${r.step}`);
			parityProblems++;
		} else if (other.ok !== r.ok || (r.ok && other.raw !== r.raw)) {
			console.log(`  [FAIL] parity: ${r.file} :: ${r.case} :: step ${r.step} (${r.method}) differs between QuickJS and V8`);
			console.log(`         C : ${other.ok ? other.raw.slice(0, 300) : 'error'}`);
			console.log(`         JS: ${r.ok ? r.raw.slice(0, 300) : 'error'}`);
			parityProblems++;
		}
	}
	console.log(`corebridge_cases(js): parity with the C leg over ${records.length} step(s): ${parityProblems === 0 ? 'byte-identical' : `${parityProblems} difference(s)`}`);
}

console.log(
	`corebridge_cases(js): ${files.length} files, ${nCases} cases, ${nSteps} steps, ${nCases - failed - cOnly.size} passed, ${failed} failed, ${cOnly.size} C-only; ` +
		`${methods.length} methods, all covered: ${surfaceProblems.length === 0 ? 'yes' : 'NO'}`,
);
process.exit(failed === 0 && surfaceProblems.length === 0 && parityProblems === 0 ? 0 : 1);
