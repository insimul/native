#!/usr/bin/env node
// chat-cefr-cases.mjs — transcribe a chat-cefr corpus into bridge cases (PL.native-chat-cefr-rows, slice 1).
//
// The corpus (corebridge/tests/chat-cefr/chat-cefr-corpus.json) is replayable DATA in the families the
// World IR's `chatCefr` section is conformance-tested in: `worlds` (each a section), `levelCases`,
// `npcModeCases`, `lookupCases`, `lineCases`, `lineLanguageRule`, `messageKindCases` and
// `messageHintCases`. An engine runner replays it from the data alone (corebridge/ENGINE_BINDINGS.md
// "chatCefr"). This tool maps every case to the `chatCefr.*` row calls that answer it, so the two case
// harnesses (tests/corebridge_cases.c on QuickJS, tests/corebridge_cases.mjs on V8) and their parity
// diff run the whole corpus through the rows. A section is never copied into a step: each step names it
// with `{ "$file": <the corpus>, "$path": "worlds.<n>.chatCefr" }`.
//
//   node corebridge/tools/chat-cefr-cases.mjs --write
//       Write corebridge/tests/cases/chat-cefr-corpus.json from the committed corpus.
//   node corebridge/tools/chat-cefr-cases.mjs --check                 (ctest chat_cefr_cases)
//       Fail unless the committed transcription is exactly the mapping of the committed corpus, and the
//       corpus holds only the families this slice maps (a new family cannot be skipped by accident).
//   node corebridge/tools/chat-cefr-cases.mjs --check-negative        (ctest chat_cefr_cases_negative)
//       Perturb the corpus in each family and require --check's comparison to name every perturbation.
//   node corebridge/tools/chat-cefr-cases.mjs --emit <dir> --corpus <file>
//       Transcribe ANOTHER corpus of the same families (the export's own, read from a local checkout) into
//       <dir>/chat-cefr-corpus-cases.json with the corpus copied beside it, for a LOCAL run of the two
//       harnesses over <dir>. Families this slice does not map are listed and skipped (slice 2's). Nothing
//       it writes belongs in this repository.
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const CORPUS = resolve(HERE, '../tests/chat-cefr/chat-cefr-corpus.json');
const CASES = resolve(HERE, '../tests/cases/chat-cefr-corpus.json');
const CORPUS_REF = '../chat-cefr/chat-cefr-corpus.json';

/** The families slice 1 maps, and the corpus's own keys that are not cases. */
const FAMILIES = ['levelCases', 'npcModeCases', 'lookupCases', 'lineCases', 'lineLanguageRule', 'messageKindCases', 'messageHintCases'];
const META = ['area', 'description', 'sources', 'worlds'];

function fail(msg) {
	console.error(`chat-cefr-cases: ${msg}`);
	process.exit(1);
}

/** The bridge case file for `corpus`, whose steps name its sections through `ref`. */
export function transcribe(corpus, ref) {
	const worlds = corpus.worlds;
	if (!Array.isArray(worlds) || worlds.length === 0) throw new Error('the corpus has no worlds');
	const at = new Map(worlds.map((w, i) => [w.name, i]));
	const section = (name) => {
		if (!at.has(name)) throw new Error(`a case names the world ${JSON.stringify(name)}, which the corpus does not hold`);
		return { $file: ref, $path: `worlds.${at.get(name)}.chatCefr` };
	};
	const first = worlds[0].name;
	const cases = [];
	const add = (name, steps) => cases.push({ name, steps });

	(corpus.levelCases ?? []).forEach((c, i) => add(`levelCases[${i}] ${c.level}: the row, in every world`,
		worlds.map((w) => ({ call: 'chatCefr.levelRow', args: { section: section(w.name), level: c.level }, expect: { row: c.row } }))));
	(corpus.npcModeCases ?? []).forEach((c, i) => add(`npcModeCases[${i}] ${c.level} ${JSON.stringify(c.npcId)}`, [
		{ call: 'chatCefr.npcMode', args: { section: section(first), level: c.level, npcId: c.npcId }, expect: { hash: c.hash, bucket: c.bucket, mode: c.mode } },
	]));
	(corpus.lookupCases ?? []).forEach((c, i) => add(`lookupCases[${i}] ${c.world} ${JSON.stringify(c.word)}`, [
		{ call: 'chatCefr.translateWord', args: { section: section(c.world), word: c.word }, expect: { translation: c.translation } },
		{ call: 'chatCefr.vocabHintFor', args: { section: section(c.world), word: c.word }, expect: { hint: c.hint } },
	]));
	(corpus.lineCases ?? []).forEach((c, i) => add(`lineCases[${i}] ${c.world} ${c.level}: ${c.why}`, [
		{ call: 'chatCefr.vocabHintsForLine', args: { section: section(c.world), line: c.line, level: c.level, state: c.state, mastered: c.mastered }, expect: { hints: c.hints, state: c.nextState } },
	]));
	if (corpus.lineLanguageRule !== undefined) add('lineLanguageRule: the line rule\'s constants', [
		{ call: 'chatCefr.lineRule', args: {}, expect: corpus.lineLanguageRule },
	]);
	(corpus.messageKindCases ?? []).forEach((c, i) => add(`messageKindCases[${i}]: ${c.why}`, [
		{ call: 'chatCefr.messageKind', args: { section: section(first), message: c.message },
			expect: { row: c.kind === null ? null : { $subset: { kind: c.kind, role: c.message.role, color: { $subset: { css: c.color } } } } } },
		{ call: 'chatCefr.messageGetsHints', args: { section: section(first), message: c.message }, expect: { hints: c.hints } },
	]));
	(corpus.messageHintCases ?? []).forEach((c, i) => add(`messageHintCases[${i}] ${c.world} ${c.level}: ${c.why}`, [
		{ call: 'chatCefr.messageHints', args: { section: section(c.world), message: c.message, level: c.level, state: c.state, mastered: c.mastered }, expect: { hints: c.hints, state: c.nextState } },
	]));
	return {
		area: 'chat-cefr-corpus',
		description: 'GENERATED by corebridge/tools/chat-cefr-cases.mjs --write from corebridge/tests/chat-cefr/chat-cefr-corpus.json; never edit it by hand (ctest chat_cefr_cases holds it to the corpus). Every case of the corpus\'s slice-1 families, one row call per expectation (lookupCases and messageKindCases two), the sections named by $file.',
		cases,
	};
}

/** The families `corpus` holds that this slice does not map. */
function unmapped(corpus) {
	return Object.keys(corpus).filter((k) => !FAMILIES.includes(k) && !META.includes(k));
}

const text = (v) => JSON.stringify(v, null, 1) + '\n';

/** What --check finds wrong with `corpus` against the transcription `committed` (empty: none). */
function problems(corpus, committed) {
	const out = [];
	const extra = unmapped(corpus);
	if (extra.length) out.push(`the corpus holds families this slice does not map: ${extra.join(', ')}`);
	for (const f of FAMILIES) if (corpus[f] === undefined) out.push(`the corpus has no ${f}`);
	let want;
	try {
		want = text(transcribe(corpus, CORPUS_REF));
	} catch (err) {
		out.push(String(err.message));
		return out;
	}
	if (want !== committed) out.push('the committed transcription is not the mapping of the corpus (re-run --write)');
	return out;
}

const args = process.argv.slice(2);
const mode = args[0];
if (mode === '--write') {
	const corpus = JSON.parse(readFileSync(CORPUS, 'utf8'));
	const extra = unmapped(corpus);
	if (extra.length) fail(`the corpus holds families this slice does not map: ${extra.join(', ')}`);
	const out = transcribe(corpus, CORPUS_REF);
	writeFileSync(CASES, text(out));
	console.log(`chat-cefr-cases: wrote ${out.cases.length} case(s), ${out.cases.reduce((n, c) => n + c.steps.length, 0)} step(s)`);
} else if (mode === '--check') {
	const corpus = JSON.parse(readFileSync(CORPUS, 'utf8'));
	const found = problems(corpus, readFileSync(CASES, 'utf8'));
	if (found.length) fail(`DRIFT\n  ${found.join('\n  ')}`);
	const counts = FAMILIES.map((f) => `${f} ${Array.isArray(corpus[f]) ? corpus[f].length : 1}`).join(', ');
	console.log(`chat-cefr-cases: ${corpus.worlds.length} world(s), ${counts}, and the transcription is the corpus's mapping: PASS`);
} else if (mode === '--check-negative') {
	const corpus = JSON.parse(readFileSync(CORPUS, 'utf8'));
	const committed = readFileSync(CASES, 'utf8');
	if (problems(corpus, committed).length) fail('the unperturbed corpus does not pass --check; run it first');
	const clone = () => JSON.parse(JSON.stringify(corpus));
	const perturbations = [
		['a level row', (c) => { c.levelCases[0].row.hints.newWordHintFrequency += 1; }],
		['an NPC mode', (c) => { c.npcModeCases[0].mode = c.npcModeCases[0].mode === 'natural' ? 'bilingual' : 'natural'; }],
		['an NPC bucket', (c) => { c.npcModeCases[0].bucket += 1; }],
		['a translation', (c) => { c.lookupCases[0].translation = null; }],
		['a hint card', (c) => { c.lookupCases[0].hint = null; }],
		['a line\'s hints', (c) => { c.lineCases[0].hints.pop(); }],
		['a line\'s next state', (c) => { c.lineCases[0].nextState.newWordIndex += 1; }],
		['a line\'s mastered words', (c) => { c.lineCases[0].mastered.push('x'); }],
		['the line rule', (c) => { c.lineLanguageRule.englishEvidenceMinLength += 1; }],
		['a message kind', (c) => { c.messageKindCases[0].kind = 'system'; }],
		['a message colour', (c) => { c.messageKindCases[0].color = '#000000'; }],
		['a message\'s hints', (c) => { c.messageKindCases[0].hints = !c.messageKindCases[0].hints; }],
		['a message line\'s next state', (c) => { c.messageHintCases[0].nextState.seen.push('x'); }],
		['a dropped world a case names', (c) => { c.worlds.pop(); }],
		['a dropped case', (c) => { c.lineCases.pop(); }],
		['an unmapped family', (c) => { c.grammarBlockCases = []; }],
	];
	let named = 0;
	for (const [what, perturb] of perturbations) {
		const c = clone();
		perturb(c);
		if (problems(c, committed).length) named += 1;
		else console.log(`  NOT NAMED: ${what}`);
	}
	console.log(`chat-cefr-cases --check-negative: ${named} of ${perturbations.length} perturbed corpora named`);
	if (named !== perturbations.length) process.exit(1);
} else if (mode === '--emit') {
	const dir = args[1];
	const i = args.indexOf('--corpus');
	if (!dir || i < 0 || !args[i + 1]) fail('usage: --emit <dir> --corpus <file>');
	const corpus = JSON.parse(readFileSync(args[i + 1], 'utf8'));
	mkdirSync(dir, { recursive: true });
	copyFileSync(args[i + 1], join(dir, 'chat-cefr-corpus.json'));
	const out = transcribe(corpus, 'chat-cefr-corpus.json');
	writeFileSync(join(dir, 'chat-cefr-corpus-cases.json'), text(out));
	const skipped = unmapped(corpus).map((k) => `${k} ${Array.isArray(corpus[k]) ? corpus[k].length : 1}`);
	console.log(`chat-cefr-cases --emit: ${out.cases.length} case(s), ${out.cases.reduce((n, c) => n + c.steps.length, 0)} step(s) into ${dir}; not mapped (slice 2): ${skipped.join(', ') || 'none'}`);
} else {
	fail('usage: --write | --check | --check-negative | --emit <dir> --corpus <file>');
}
