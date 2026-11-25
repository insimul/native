#!/usr/bin/env node
// gen-hand-cases.mjs — write (or re-check) the hand case files whose expectations are CORE'S OWN
// answers, from core at the pin (PL.native-runtime-save-rows; the village-save rows' minor m1: their
// generator lived outside this repository, so a re-pin that moved core's answers would have left red
// hand cases with nothing here to regenerate them).
//
//   node corebridge/tools/gen-hand-cases.mjs --core <core git checkout> [--node-modules <dir>]… [--check] [<spec>…]
//
// A SPEC is one module under corebridge/tools/hand-cases/ (`<name>.mjs`). It imports core's modules
// as `@insimul/core/<path>` (src/<path>.ts at the pin) and exports
//
//   output      the case file it writes, a name under corebridge/tests/cases/;
//   area        the file's `area`;
//   description the file's `description`;
//   build()     the cases, `[{ name, steps: [{ call, args?, expect | expectError, bind? }] }]`.
//
// `build()` computes each `expect` by calling core's own functions and classes on the step's
// inputs: a spec states which row a call goes to and what it hands over, never an answer of its
// own (an answer it wrote by hand would hold the rows to the spec, not to core). The rows' own
// boundary errors (`[invalid-input]`), which core does not answer, are the only literal
// expectations a spec may carry, as `expectError`.
//
// HOW CORE IS REACHED. Exactly as tools/vendor-core-bundle.mjs reaches it: core's source AT the
// pinned `coreCommit` (corebridge/core-pin.json), read with `git archive` into a throwaway
// directory (never the checkout's working tree), bundled with the pinned `esbuild` resolved from
// the checkout's node_modules chain and any --node-modules given, `@insimul/core/x` resolving to
// <core@pin>/src/x.ts. The spec bundle runs in this Node process. Core's Prolog seam
// (`prolog-engine`) resolves to an empty stub, so calling into it fails: a hand case that needs
// the KB belongs to a row's own case file, not here.
//
// --check regenerates in memory and compares byte for byte with the file on disk; exit 1 names
// each file that differs. Without it, the files are written. Either way each file records
// `generatedBy` and `source: { coreCommit, spec }`, which `vendor-core-bundle.mjs --check` (the
// core_vendor ctest) holds to the pin: a re-pin is red until the hand cases are regenerated.

import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const BRIDGE = path.resolve(HERE, '..');
const SPECS = path.join(HERE, 'hand-cases');
const CASES = path.join(BRIDGE, 'tests', 'cases');
const PIN_FILE = path.join(BRIDGE, 'core-pin.json');
const GENERATED_BY = 'corebridge/tools/gen-hand-cases.mjs';

function fail(message) {
	console.error(`gen-hand-cases: ${message}`);
	process.exit(1);
}

const args = process.argv.slice(2);
const values = (flag) => args.flatMap((a, i) => (a === flag && args[i + 1] ? [args[i + 1]] : []));
const check = args.includes('--check');
const coreDir = values('--core')[0];
const extraNodeModules = values('--node-modules');
const flagged = new Set(args.flatMap((a, i) => (a === '--core' || a === '--node-modules' ? [i, i + 1] : [])));
const wanted = args.filter((a, i) => !a.startsWith('--') && !flagged.has(i));
if (!coreDir) fail('usage: gen-hand-cases.mjs --core <core git checkout> [--node-modules <dir>]… [--check] [<spec>…]');

const pin = JSON.parse(fs.readFileSync(PIN_FILE, 'utf8'));
const specs = fs.readdirSync(SPECS).filter((f) => f.endsWith('.mjs')).sort();
for (const w of wanted) if (!specs.includes(w) && !specs.includes(`${w}.mjs`)) fail(`no spec ${w} under tools/hand-cases/ (${specs.join(', ')})`);
const chosen = wanted.length ? specs.filter((s) => wanted.includes(s) || wanted.includes(s.replace(/\.mjs$/, ''))) : specs;

// ── core at the pin ───────────────────────────────────────────────────────────

const core = path.resolve(coreDir);
let commit;
try {
	commit = execFileSync('git', ['-C', core, 'rev-parse', '--verify', `${pin.coreCommit}^{commit}`], { encoding: 'utf8' }).trim();
} catch {
	fail(`${core} is not a git checkout of @insimul/core holding the pinned commit ${pin.coreCommit}; fetch it first`);
}
if (commit !== pin.coreCommit) fail(`the pinned commit resolved to ${commit}, not itself`);
const chain = [];
for (let dir = core; ; dir = path.dirname(dir)) {
	if (fs.existsSync(path.join(dir, 'node_modules'))) chain.push(path.join(dir, 'node_modules'));
	if (path.dirname(dir) === dir) break;
}
for (const extra of extraNodeModules) {
	if (!fs.existsSync(extra)) fail(`--node-modules ${extra} does not exist`);
	chain.push(path.resolve(extra));
}
const withEsbuild = chain.find((d) => fs.existsSync(path.join(d, 'esbuild', 'package.json')));
if (!withEsbuild) fail(`no node_modules with esbuild at or above ${core}, nor among --node-modules`);
const esbuildVersion = JSON.parse(fs.readFileSync(path.join(withEsbuild, 'esbuild', 'package.json'), 'utf8')).version;
if (esbuildVersion !== pin.esbuild) fail(`esbuild ${esbuildVersion} in ${withEsbuild} is not the pinned ${pin.esbuild}`);
const esbuild = await import(pathToFileURL(createRequire(path.join(withEsbuild, 'esbuild', 'package.json')).resolve('esbuild')).href);

const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'insimul-hand-cases-')));
let status = 0;
try {
	const tar = execFileSync('git', ['-C', core, 'archive', '--format=tar', commit], { maxBuffer: 1024 * 1024 * 1024 });
	const src = path.join(root, 'core');
	fs.mkdirSync(src);
	execFileSync('tar', ['-x', '-f', '-', '-C', src], { input: tar });
	if (!fs.existsSync(path.join(src, 'src', 'index.ts'))) fail(`commit ${commit} does not look like packages/core (no src/index.ts)`);

	const boundary = {
		name: 'insimul-hand-cases-boundary',
		setup(build) {
			build.onResolve({ filter: /^@insimul\/core\// }, (a) => ({ path: path.join(src, 'src', `${a.path.slice('@insimul/core/'.length)}.ts`) }));
			build.onResolve({ filter: /(^|\/)prolog-engine$/ }, () => ({ path: 'prolog-engine', namespace: 'hand-cases-stub' }));
			// A CommonJS module with nothing in it: every name core imports from the seam is undefined, so
			// reaching the engine is a TypeError at the call, and a module that only imports it still loads.
			build.onLoad({ filter: /.*/, namespace: 'hand-cases-stub' }, () => ({ contents: 'module.exports = {};\n', loader: 'js' }));
		},
	};

	for (const spec of chosen) {
		const out = path.join(root, `${spec}.bundle.mjs`);
		const result = await esbuild.build({
			entryPoints: [path.join(SPECS, spec)],
			bundle: true,
			format: 'esm',
			platform: 'node',
			target: 'node20',
			nodePaths: chain.map((d) => fs.realpathSync(d)),
			outfile: out,
			logLevel: 'silent',
			plugins: [boundary],
		});
		if (result.errors.length) fail(`${spec}: esbuild reported ${result.errors.length} error(s)`);
		const m = await import(pathToFileURL(out).href);
		for (const k of ['output', 'area', 'description', 'build']) if (m[k] === undefined) fail(`${spec} exports no ${k}`);
		if (!/^[a-z0-9-]+\.json$/.test(m.output)) fail(`${spec}: output ${m.output} is not a case file name`);
		const cases = await m.build();
		if (!Array.isArray(cases) || cases.length === 0) fail(`${spec}: build() gave no case`);
		const names = new Set(cases.map((c) => c.name));
		if (names.size !== cases.length) fail(`${spec}: duplicate case names`);
		const doc = {
			area: m.area,
			description: m.description,
			generatedBy: `${GENERATED_BY} (tools/hand-cases/${spec}) — do not hand-edit; regenerate with --core <checkout>`,
			source: { coreCommit: commit, spec },
			cases,
		};
		const text = `${JSON.stringify(doc, null, 1)}\n`;
		const file = path.join(CASES, m.output);
		const steps = cases.reduce((n, c) => n + c.steps.length, 0);
		if (check) {
			const same = fs.existsSync(file) && fs.readFileSync(file, 'utf8') === text;
			console.log(`gen-hand-cases: ${m.output} (${spec}) ${same ? 'is' : 'is NOT'} what core ${commit.slice(0, 7)} answers (${cases.length} case(s), ${steps} step(s))`);
			if (!same) status = 1;
		} else {
			fs.writeFileSync(file, text);
			console.log(`gen-hand-cases: wrote ${m.output} from ${spec} at core ${commit.slice(0, 7)} (${cases.length} case(s), ${steps} step(s))`);
		}
	}
} finally {
	fs.rmSync(root, { recursive: true, force: true });
}
process.exit(status);
