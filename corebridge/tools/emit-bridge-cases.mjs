// emit-bridge-cases.mjs — core's own conformance corpora, transcribed into the
// bridge's case format (corebridge/tests/README.md, "The case format").
//
// Run by vendor-core-bundle.mjs from the SAME core commit the bundle is built
// from, so the bundle and the expectations it is held to can never come from
// two different cores. The output is vendor/core/cases/*.json — generated,
// hashed in VENDORED.json, re-derived and diffed by `--check --core`.
//
// WHAT THIS FILE IS, AND IS NOT. It TRANSCRIBES: every `expect` below is a value
// core committed to its own corpus (or a constant core's own runner asserts),
// moved into the shape of a bridge call. It runs no core code and computes no
// expectation of its own — if it did, the bridge would be held to this file
// rather than to core. The mapping from a corpus step to a bridge call is the
// same one core's TypeScript runner for that corpus makes; each section names
// the runner it follows.
//
// Hand-written cases (behaviour no core corpus pins yet: notifications, quest
// completion, markers, waypoints, the clock, weather sessions, the save codec
// round trip, sessions and errors) live in corebridge/tests/cases/, not here.

import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const sha256 = (text) => createHash('sha256').update(text).digest('hex');

/** A subset matcher (README: `$subset`). */
const sub = (value) => ({ $subset: value });
const approx = (value, tol) => ({ $approx: value, $tol: tol });

function reader(root) {
	const files = {};
	return {
		files,
		json(rel) {
			const text = fs.readFileSync(path.join(root, rel), 'utf8');
			files[rel] = sha256(text);
			return JSON.parse(text);
		},
		text(rel) {
			const text = fs.readFileSync(path.join(root, rel), 'utf8');
			files[rel] = sha256(text);
			return text;
		},
	};
}

function caseFile(area, description, coreCommit, files, cases) {
	if (cases.length === 0) throw new Error(`emit-bridge-cases: ${area} transcribed no case`);
	const names = new Set(cases.map((c) => c.name));
	if (names.size !== cases.length) throw new Error(`emit-bridge-cases: ${area} has duplicate case names`);
	return `${JSON.stringify(
		{
			area,
			description,
			generatedBy: 'corebridge/tools/emit-bridge-cases.mjs (via vendor-core-bundle.mjs) — do not hand-edit',
			source: { coreCommit, files: Object.fromEntries(Object.entries(files).sort()) },
			cases,
		},
		null,
		1,
	)}\n`;
}

// ── saves: conformance/saves/ (save-integrity-crosscheck.test.ts, saves-migration.test.ts)

function saves(root, coreCommit) {
	const r = reader(root);
	const vectors = r.json('conformance/saves/integrity-vectors.json').vectors;
	const version = Number(/export const SAVE_FILE_VERSION = (\d+);/.exec(r.text('src/save-file.ts'))?.[1]);
	if (!Number.isInteger(version)) throw new Error('emit-bridge-cases: SAVE_FILE_VERSION not found in src/save-file.ts');
	const format = /export const SAVE_ENVELOPE_FORMAT = '([^']+)'/.exec(r.text('src/save-envelope.ts'))?.[1];
	if (!format) throw new Error('emit-bridge-cases: SAVE_ENVELOPE_FORMAT not found in src/save-envelope.ts');

	const cases = [];
	for (const name of Object.keys(vectors).sort()) {
		const fixture = r.json(`conformance/saves/${name}`);
		const integrity = vectors[name];
		cases.push({
			name: `${name}: integrity is the committed vector`,
			claim: 'save-integrity-crosscheck.test.ts: computeSaveFileIntegrity(fixture) equals integrity-vectors.json',
			steps: [{ call: 'save.integrity', args: { saveFile: fixture }, expect: { integrity } }],
		});
		const envelope = {
			format,
			exportedAt: '2026-10-15T00:00:00.000Z',
			insimulVersion: 'conformance',
			saveFile: fixture,
			integrity,
		};
		cases.push({
			name: `${name}: an envelope carrying the committed vector decodes and migrates to v${version}`,
			claim: 'validateSaveFileEnvelope accepts the vector; migrateSaveFile lifts any fixture to SAVE_FILE_VERSION',
			steps: [
				{
					call: 'save.decode',
					args: { envelope },
					expect: sub({
						ok: true,
						envelope: { format, exportedAt: envelope.exportedAt, insimulVersion: 'conformance', integrity },
						saveFile: sub({ version, id: fixture.id }),
						outcome: sub({
							versionFrom: fixture.version ?? 1,
							versionTo: version,
							versionsBehind: version - (fixture.version ?? 1),
							migrationApplied: version > (fixture.version ?? 1),
						}),
					}),
				},
			],
		});
		const tampered = { ...envelope, saveFile: { ...fixture, name: `${fixture.name ?? ''} (edited)` } };
		cases.push({
			name: `${name}: the same envelope with an edited payload is an integrity mismatch`,
			claim: 'validateSaveFileEnvelope recomputes the hash over the payload it is given',
			steps: [
				{
					call: 'save.decode',
					args: { envelope: tampered },
					expect: { ok: false, error: sub({ code: 'integrity_mismatch' }) },
				},
			],
		});
		cases.push({
			name: `${name}: decoding from text gives the same answer as from the object`,
			claim: 'save.decode {text} parses the file a host read from disk',
			steps: [
				{
					call: 'save.decode',
					args: { text: JSON.stringify(envelope) },
					expect: sub({ ok: true, envelope: sub({ integrity }), saveFile: sub({ version }) }),
				},
			],
		});
	}

	const v1 = r.json('conformance/saves/v1-minimal.json');
	if (!(v1.version < version)) throw new Error('emit-bridge-cases: v1-minimal.json is not older than the current version');
	cases.push({
		name: 'v1-minimal.json: migrate backfills what each step owns',
		claim:
			'saves-migration.test.ts: version becomes SAVE_FILE_VERSION; v1->v2 backfills proficiencyHistory, srsState, ' +
			'weakAreaHistory; v2->v3 stamps insimulVersion, engineRevision, snapshotCreatedAt as strings',
		steps: [
			{
				call: 'save.migrate',
				args: { saveFile: v1 },
				expect: sub({
					saveFile: sub({
						version,
						currentState: sub({
							languageProgress: sub({
								proficiencyHistory: { $any: true },
								srsState: { $any: true },
								weakAreaHistory: { $any: true },
							}),
						}),
						worldSnapshot: sub({
							insimulVersion: { $type: 'string' },
							engineRevision: { $type: 'string' },
							snapshotCreatedAt: { $type: 'string' },
						}),
					}),
					outcome: sub({ versionFrom: v1.version, versionTo: version, migrationApplied: true }),
					significant: true,
				}),
			},
		],
	});
	return caseFile(
		'saves',
		"core's save corpus through the save.* rows: every fixture's integrity vector (SHA-256 computed by the C host), " +
			'an envelope carrying it decoded and migrated, the same envelope tampered, and the v1 migration backfills.',
		coreCommit,
		r.files,
		cases,
	);
}

// ── the village-state save: conformance/saves/village-state.json (village-state-corpus.test.ts) ──
//
// Core's reference runner is src/save-file-game-state-corpus.ts (`runVillageStateOp`);
// each op becomes the calls it makes, through the save.village.* rows
// (PL.native-village-save-rows):
//
//   write                 save.village.write { save, gameState, options }
//   read                  save.village.read { save, options }
//   roundTrip             save.village.write { save, gameState, options: writeOptions }, then
//                         save.village.read { save: { ...save, currentState, conversations } (the
//                         written bodies, by $ref), options: readOptions }; a refused case is the
//                         write's refusal (the writer stores only blocks it read, so a written save
//                         reads back; were a read ever to refuse instead, the write step fails loudly)
//   stamp                 save.village.runtimeOf, positionFrameOf, belongsTo { runtime ?? null }, and
//                         runtimeLabel over the runtimeOf answer (by $ref), one expected key each
//   agentCurie            save.village.agentCurie
//   timeStateOf           save.village.timeStateOf
//   totalHoursOf          save.village.totalHoursOf
//   conversationTimestamp save.village.conversations.timestamp
//   conversationEpochMs   save.village.conversations.epochMs
//   skillKb               save.village.read { save, options } (a refusal is the case's answer: the
//                         read checks the progression block before skillKbLoadJson could), then
//                         skill.kb.loadJson { currentState: save.currentState }
//
// A refusal is pinned as the corpus pins it, plus the row's `message` as any string
// (core's sentence for a log; the corpus does not pin it). One more case states the
// contract keys the save.village.contract row answers, from the corpus's own contract.
// An op this map does not know fails the emit, so a new core op cannot be skipped.

/** The corpus's contract keys save.village.contract states (the row keys them the same way). */
const VILLAGE_CONTRACT_KEYS = [
	'saveFileVersion',
	'gameStateVersion',
	'extensionKey',
	'playerAgentLocalId',
	'runtimeSlot',
	'positionFrameSlot',
	'villagerSlots',
	'weatherExtensionKey',
	'weatherDirectorKeys',
	'weatherBlockMembers',
	'conversationRowKeys',
	'conversationRecordKeys',
	'conversationMsRange',
];

/** A refused answer as the row gives it: the corpus's refusal plus core's message (any string). */
const refusedRow = (expected) => ({ ok: false, refusal: { ...expected.refusal, message: { $type: 'string' } } });

function villageSave(root, coreCommit) {
	const r = reader(root);
	const file = r.json('conformance/saves/village-state.json');
	if (file.area !== 'saves') throw new Error('emit-bridge-cases: village-state.json is not the saves corpus');
	const cases = [];
	const contract = {};
	for (const k of VILLAGE_CONTRACT_KEYS) {
		if (!(k in file.contract)) throw new Error(`emit-bridge-cases: village-state.json's contract has no ${k}`);
		contract[k] = file.contract[k];
	}
	cases.push({
		name: 'village-state: the contract keys the save.village.contract row states',
		steps: [{ call: 'save.village.contract', expect: contract }],
	});
	const one = (call, input, expected) => [{ call, args: input, expect: expected.ok === false ? refusedRow(expected) : expected }];
	for (const c of file.cases) {
		const i = c.input;
		const e = c.expected;
		let steps;
		switch (c.op) {
			case 'write':
				steps = one('save.village.write', i, e);
				break;
			case 'read':
				steps = one('save.village.read', i, e);
				break;
			case 'roundTrip': {
				const write = { call: 'save.village.write', args: { save: i.save, gameState: i.gameState, options: i.writeOptions } };
				if (e.ok === false) {
					steps = [{ ...write, expect: refusedRow(e) }];
					break;
				}
				const save = { ...i.save, currentState: { $ref: 'written.currentState' }, conversations: { $ref: 'written.conversations' } };
				steps = [
					{ ...write, expect: sub({ ok: true }), bind: 'written' },
					{ call: 'save.village.read', args: { save, options: i.readOptions }, expect: e },
				];
				break;
			}
			case 'stamp': {
				const at = { save: i.save, worldId: i.worldId };
				steps = [
					{ call: 'save.village.runtimeOf', args: at, expect: { runtime: e.runtime }, bind: 'writer' },
					{ call: 'save.village.positionFrameOf', args: at, expect: { positionFrame: e.positionFrame } },
					{ call: 'save.village.belongsTo', args: { ...at, runtime: i.runtime ?? null }, expect: { belongsTo: e.belongsTo } },
					{ call: 'save.village.runtimeLabel', args: { runtime: { $ref: 'writer.runtime' } }, expect: { label: e.label } },
				];
				break;
			}
			case 'agentCurie':
				steps = one('save.village.agentCurie', i, e);
				break;
			case 'timeStateOf':
				steps = one('save.village.timeStateOf', i, e);
				break;
			case 'totalHoursOf':
				steps = one('save.village.totalHoursOf', i, e);
				break;
			case 'conversationTimestamp':
				steps = one('save.village.conversations.timestamp', i, e);
				break;
			case 'conversationEpochMs':
				steps = one('save.village.conversations.epochMs', i, e);
				break;
			case 'skillKb': {
				const read = { call: 'save.village.read', args: { save: i.save, options: i.options } };
				if (e.ok === false) {
					steps = [{ ...read, expect: refusedRow(e) }];
					break;
				}
				steps = [
					{ ...read, expect: sub({ ok: true }) },
					{ call: 'skill.kb.loadJson', args: { currentState: i.save.currentState ?? null }, expect: e },
				];
				break;
			}
			default:
				throw new Error(`emit-bridge-cases: village-state.json op ${c.op} has no transcription (case "${c.name}")`);
		}
		cases.push({ name: `village-state ${c.op}: ${c.name}`, steps });
	}
	return caseFile(
		'saves-village',
		"core's village-state save corpus (conformance/saves/village-state.json, P1.core and " +
			'PL.core-save-conversations-projection) through the save.village.* rows and skill.kb.loadJson, each op as ' +
			"core's reference runner (save-file-game-state-corpus.ts) composes it.",
		coreCommit,
		r.files,
		cases,
	);
}

// ── ui: conformance/ui/ (dialogue-menu-save-corpus.test.ts, quest-trade-corpus.test.ts, ui-corpus.test.ts)

function pauseMenu(root, coreCommit) {
	const r = reader(root);
	const doc = r.json('conformance/ui/pause-menu-cases.json');
	const cases = doc.cases.map((c) => {
		const steps = [
			{
				call: 'ui.pause.create',
				args: c.tabs ? { enabledModules: c.enabled_modules, tabs: c.tabs } : { enabledModules: c.enabled_modules },
				expect: sub({ session: 1, view: sub({ visibleKeys: c.expected_visible_keys }) }),
			},
		];
		for (const step of c.steps ?? []) {
			const apply = (ops, view, results) => ({
				call: 'ui.pause.apply',
				args: { session: 1, ops },
				expect: sub({ ...(results ? { results } : {}), view: sub(view) }),
			});
			switch (step.op) {
				case 'open':
					steps.push(apply([step.tab === undefined ? { op: 'open' } : { op: 'open', tab: step.tab }], { open: true }));
					break;
				case 'close':
					steps.push(apply([{ op: 'close' }], { open: false }));
					break;
				case 'toggle':
					steps.push(apply([{ op: 'toggle' }], {}));
					break;
				case 'set_active':
					steps.push(
						apply([{ op: 'setActive', key: step.key }], {}, step.expected_ok === undefined ? undefined : [step.expected_ok]),
					);
					break;
				case 'expect_active':
					steps.push(apply([], { active: step.key }));
					break;
				case 'expect_open':
					steps.push(apply([], { open: step.value }));
					break;
				default:
					throw new Error(`emit-bridge-cases: unknown pause-menu op '${step.op}'`);
			}
		}
		return { name: c.name, steps };
	});
	return caseFile('ui-pause-menu', "core's pause-menu tab-gating matrix through ui.pause.*", coreCommit, r.files, cases);
}

function questJournal(root, coreCommit) {
	const r = reader(root);
	const doc = r.json('conformance/ui/quest-journal-cases.json');
	const OPS = { set_filter: 'setFilter', accept: 'accept', decline: 'decline', complete: 'complete', track: 'track', untrack: 'untrack', upsert: 'upsert' };
	const cases = doc.cases.map((c) => {
		const steps = [{ call: 'ui.journal.create', args: { quests: c.quests, maxTracked: c.max_tracked }, expect: sub({ session: 1 }) }];
		for (const step of c.steps) {
			const op = OPS[step.op];
			if (!op) throw new Error(`emit-bridge-cases: unknown quest-journal op '${step.op}'`);
			const call =
				step.op === 'set_filter'
					? { op, filter: step.arg }
					: step.op === 'upsert'
						? { op, quest: step.entry }
						: { op, id: step.arg };
			const view = {};
			if (step.expected_filtered_ids) view.filtered = { $ids: step.expected_filtered_ids };
			if (step.expected_tracked_ids) view.tracked = { $ids: step.expected_tracked_ids };
			steps.push({
				call: 'ui.journal.apply',
				args: { session: 1, ops: [call] },
				expect: sub({ ...(step.expected_ok === undefined ? {} : { results: [step.expected_ok] }), view: sub(view) }),
			});
		}
		steps.push({ call: 'ui.journal.apply', args: { session: 1, ops: [] }, expect: sub({ view: sub({ counts: c.expected_counts }) }) });
		return { name: c.name, steps };
	});
	return caseFile('ui-quest-journal', "core's journal / tracker / offer matrix through ui.journal.*", coreCommit, r.files, cases);
}

function saveSlots(root, coreCommit) {
	const r = reader(root);
	const doc = r.json('conformance/ui/save-slot-cases.json');
	const cases = doc.cases.map((c) => ({
		name: c.name,
		steps: [
			{
				call: 'ui.saveSlots',
				args: { slots: c.slots },
				expect: {
					slots: c.expected.map((e) =>
						sub({ index: e.index, status: e.status, title: e.title, message: e.message, canLoad: e.can_load, canSave: e.can_save }),
					),
					hasAnyLoadable: c.expected_has_loadable,
				},
			},
		],
	}));
	// A refused Load (PL.core-load-refused-message, PL.core-load-refusal-codes; U118(5),
	// U124(1), U126(2)): each `load_refusals` entry as its `load_refusal_rule` says —
	// the refusal through the mapping (`ui.loadRefusal`), compared with
	// `expected_outcome` and `expected_message`, then slot 0 rendered with that
	// outcome (`ui.saveSlots`; no slot when it is null) and compared with `expected`.
	// The rule names no `hasAnyLoadable`, so the render step holds `slots` only.
	for (const c of doc.load_refusals ?? []) {
		const steps = [
			{ call: 'ui.loadRefusal', args: { refusal: c.refusal }, expect: { outcome: c.expected_outcome, message: c.expected_message } },
		];
		if (c.expected_outcome !== null) {
			steps.push({
				call: 'ui.saveSlots',
				args: { slots: [{ index: 0, outcome: c.expected_outcome }] },
				expect: sub({
					slots: c.expected.map((e) =>
						sub({ index: e.index, status: e.status, title: e.title, message: e.message, canLoad: e.can_load, canSave: e.can_save }),
					),
				}),
			});
		}
		cases.push({ name: `load refusal: ${c.name}`, steps });
	}
	return caseFile('ui-save-slots', "core's save/load slot matrix through ui.saveSlots, and its refused-Load mapping through ui.loadRefusal", coreCommit, r.files, cases);
}

function loading(root, coreCommit) {
	const r = reader(root);
	const doc = r.json('conformance/ui/loading-phases.json');
	const cases = doc.cases.map((c) => ({
		name: c.name,
		steps: [
			{ call: 'ui.loading.create', args: { phases: doc.phases, tips: doc.tips }, expect: sub({ session: 1 }) },
			...c.steps.map((step) => ({
				call: 'ui.loading.apply',
				args: { session: 1, ops: [{ op: 'advance', key: step.advance }] },
				// ui-corpus.test.ts: toBeCloseTo(expected_progress, 5) — |Δ| < 5e-6.
				expect: sub({
					view: sub({ progress: approx(step.expected_progress, 5e-6), label: step.expected_label, complete: step.expected_complete }),
				}),
			})),
		],
	}));
	return caseFile('ui-loading', "core's loading-screen phase matrix through ui.loading.*", coreCommit, r.files, cases);
}

function trade(root, coreCommit) {
	const r = reader(root);
	const doc = r.json('conformance/ui/trade-cases.json');
	const cases = doc.cases.map((c) => {
		const { op, expected } = c;
		let call;
		switch (op.kind) {
			case 'take':
				call = { op: 'takeFromContainer', containerId: op.container, itemId: op.item, ...(op.qty === undefined ? {} : { qty: op.qty }) };
				break;
			case 'take_all':
				call = { op: 'takeAllFromContainer', containerId: op.container };
				break;
			case 'buy':
				call = { op: 'buy', merchantId: op.merchant, itemId: op.item, qty: op.qty };
				break;
			case 'sell':
				call = { op: 'sell', merchantId: op.merchant, itemId: op.item, qty: op.qty };
				break;
			default:
				throw new Error(`emit-bridge-cases: unknown trade op '${op.kind}'`);
		}
		const result = { ok: expected.ok };
		if (expected.reason !== undefined) result.reason = expected.reason;
		if (expected.moved !== undefined) result.moved = expected.moved;
		const player = {};
		if (expected.player_gold !== undefined) player.gold = expected.player_gold;
		if (expected.player_items) player.inventory = { $stacks: expected.player_items };
		const state = { player: sub(player) };
		if (op.container && expected.container_items) {
			state.containers = sub({ containers: sub({ [op.container]: sub({ items: { $stacks: expected.container_items } }) }) });
		}
		if (op.merchant && (expected.merchant_gold !== undefined || expected.merchant_items)) {
			const merchant = {};
			if (expected.merchant_gold !== undefined) merchant.goldReserve = expected.merchant_gold;
			if (expected.merchant_items) merchant.items = { $stacks: expected.merchant_items };
			state.npcs = sub({ merchantStates: sub({ [op.merchant]: sub(merchant) }) });
		}
		return {
			name: c.name,
			steps: [{ call: 'ui.trade', args: { state: c.state, ops: [call] }, expect: { results: [sub(result)], state: sub(state) } }],
		};
	});
	return caseFile(
		'ui-trade',
		"core's container / merchant trade matrix through ui.trade (item census per stack id, as core's runner counts it)",
		coreCommit,
		r.files,
		cases,
	);
}

// ── weather: conformance/weather/progression.json (weather-corpus.test.ts)

function weather(root, coreCommit) {
	const r = reader(root);
	const doc = r.json('conformance/weather/progression.json');
	const reversed = (ir) => ({
		...ir,
		seasons: [...(ir.seasons ?? [])].reverse().map((s) => ({ ...s, weather: [...(s.weather ?? [])].reverse() })),
		conditions: [...(ir.conditions ?? [])].reverse(),
	});
	const cases = doc.cases.map((c) => {
		const run = { seed: c.input.seed, from: c.input.from, throughDay: c.input.throughDay };
		const expectRun = { steps: c.expected.steps, final: c.expected.final };
		return {
			name: c.name,
			steps: [
				{
					call: 'weather.climate',
					args: { weather: c.input.weather },
					expect: { climate: c.input.climate, climateFacts: c.expected.climateFacts, issues: c.expected.issues },
				},
				{ call: 'weather.run', args: { weather: c.input.weather, ...run }, expect: expectRun },
				// weather-corpus.test.ts re-runs every case with the authored lists
				// REVERSED: the weighted pick walks canonical id order, never authoring order.
				{ call: 'weather.run', args: { weather: reversed(c.input.weather), ...run }, expect: expectRun },
				{ call: 'weather.run', args: { climate: c.input.climate, ...run }, expect: expectRun },
			],
		};
	});
	return caseFile('weather-progression', "core's seeded weather progression through weather.climate and weather.run", coreCommit, r.files, cases);
}

// ── genres: conformance/genres/ (genre-corpus.test.ts) and conformance/modules/

function genres(root, coreCommit) {
	const r = reader(root);
	const registry = r.json('conformance/genres/registry.json');
	const camera = r.json('conformance/genres/camera.json');
	const out = {};
	out['core-genres-registry.json'] = caseFile(
		'genres-registry',
		"core's genre resolution corpus through genre.resolve (and the registry ids through genre.registry)",
		coreCommit,
		r.files,
		[
			{
				name: 'the registry lists every corpus genre in order',
				steps: [{ call: 'genre.registry', args: {}, expect: sub({ ids: registry.genres }) }],
			},
			...registry.cases.map((c) => ({ name: c.name, steps: [{ call: 'genre.resolve', args: { genre: c.input.genre }, expect: c.expected }] })),
			...camera.cases.map((c) => ({ name: `camera ${c.name}`, steps: [{ call: 'genre.camera', args: { value: c.input.value }, expect: { mode: c.expected } }] })),
		],
	);

	const r2 = reader(root);
	const recipes = r2.json('conformance/genres/recipes.json');
	out['core-genres-recipes.json'] = caseFile(
		'genres-recipes',
		"core's recipe → game resolution corpus through genre.resolveGame; a refusal is an error carrying core's code",
		coreCommit,
		r2.files,
		recipes.cases.map((c) => ({
			name: c.name,
			steps: [
				c.expectedError
					? { call: 'genre.resolveGame', args: c.input, expectError: `[${c.expectedError.code}]` }
					: { call: 'genre.resolveGame', args: c.input, expect: c.expected },
			],
		})),
	);

	const r3 = reader(root);
	const activation = r3.json('conformance/modules/genre-activation.json');
	// P9a.core's world-path corpus (core f9aef13 on): a World IR's meta → the
	// `active` of `modules.activate { ir }`, with core's `source` and
	// `unknownModules` (WorldActiveModuleSet). Its description names that row.
	const world = r3.json('conformance/modules/world-activation.json');
	out['core-modules-activation.json'] = caseFile(
		'modules-activation',
		"core's committed activation table through modules.table, each genre's row through modules.activate, and " +
			"core's world-activation corpus (a World IR's meta.genreConfig and meta.enabledModules) through modules.activate { ir }",
		coreCommit,
		r3.files,
		[
			{ name: 'modules.table is the committed genre-activation.json', steps: [{ call: 'modules.table', args: {}, expect: activation }] },
			...Object.entries(activation.genres).map(([genre, row]) => ({
				name: `modules.activate on genre ${genre}`,
				steps: [
					{
						call: 'modules.activate',
						args: { genre },
						expect: { source: 'genre', active: row, predicatePacks: row.predicatePacks, hostInterfaces: row.hostInterfaces, reason: '' },
					},
					// Through a World IR the set is core's WorldActiveModuleSet: the
					// genre's row plus `source` and `unknownModules`, which
					// world-activation.json (below) pins exactly.
					{
						call: 'modules.activate',
						args: { ir: { meta: { genreConfig: { id: genre } } } },
						expect: sub({ source: 'worldIr', active: sub(row) }),
					},
				],
			})),
			...world.cases.map((c) => ({
				name: `modules.activate { ir }: ${c.name}`,
				steps: [{ call: 'modules.activate', args: { ir: c.input.ir }, expect: sub({ source: 'worldIr', active: c.expected }) }],
			})),
		],
	);
	return out;
}

// ── quests: conformance/quests/ (quest-goldens-crosscheck.test.ts) ────────────

function quests(root, coreCommit) {
	const r = reader(root);
	const hydration = r.json('conformance/quests/hydration-cases.json');
	const radiant = r.json('conformance/quests/radiant-cases.json');
	return caseFile(
		'quests',
		"core's quest-golden corpora through quest.hydrate and quest.radiantTick (the engines' parity surface); " +
			'the radiant facts are an order-independent multiset, as core declares them',
		coreCommit,
		r.files,
		[
			...hydration.cases.map((c) => ({
				name: `hydrate ${c.name}`,
				steps: [{ call: 'quest.hydrate', args: c.input, expect: { quest: c.expected } }],
			})),
			...radiant.cases.map((c) => ({
				name: `radiant tick ${c.name}`,
				steps: [
					{
						call: 'quest.radiantTick',
						args: { quests: c.quests, maxOffering: c.maxOffering, ticks: c.ticks },
						expect: { facts: { $multiset: c.expected } },
					},
				],
			})),
		],
	);
}

// ── language: conformance/language/ (systems-corpus.ts, runLanguageSystemsOp) ─────
//
// PL.native-language-rows: core's P9h corpora that the language.* rows answer, each
// case transcribed as core's reference runner (src/language-learning/systems-corpus.ts)
// composes its op: the same kernels, called in the same order, over the state the
// last call answered. Where the runner reads part of an answer (a book's
// `correctUsages`, a session's `turns`), the call's expectation is a subset holding
// exactly what the runner reads; where it reads state no call of the step answers
// (hover's `encounters`, an unchanged register), the expectation goes on the call that
// last answered that state (the state has not changed since). Every value expected is
// the corpus's own.

/** The corpus files the language rows answer (slice 1), by their `file` key. */
export const LANGUAGE_CASE_FILES = ['progress', 'save', 'prompts', 'hover', 'chat'];

class LanguageSteps {
	constructor(where) {
		this.where = where;
		this.steps = [];
		this.binds = 0;
	}
	/** A call, its expectation exact when given (else built from `want`, or none: it must succeed). */
	call(call, args, expect) {
		const step = { call, args };
		if (expect !== undefined) step.expect = expect;
		this.steps.push(step);
		return step;
	}
	/** A `$ref` to a path of a step's answer; the step is bound on first use. */
	ref(step, ...p) {
		if (!step.bind) step.bind = `b${this.binds++}`;
		return { $ref: [step.bind, ...p].join('.') };
	}
	/** The state a slot names (`{ step, path, set? }`), as an argument. */
	cur(slot) {
		const r = this.ref(slot.step, ...slot.path);
		return slot.set ? { ...r, $set: slot.set } : r;
	}
	/** Part of a step's answer the runner reads: a nested subset at `p`. */
	want(step, p, value) {
		if (step.expect !== undefined) throw new Error(`emit-bridge-cases: ${this.where}: ${step.call} has an exact expectation already`);
		if (value === undefined) throw new Error(`emit-bridge-cases: ${this.where}: the corpus answers no ${p.join('.')}`);
		step.want ??= {};
		let node = step.want;
		for (const k of p.slice(0, -1)) {
			node[k] ??= {};
			if ('$leaf' in node[k]) throw new Error(`emit-bridge-cases: ${this.where}: ${p.join('.')} under a whole value`);
			node = node[k];
		}
		const k = p[p.length - 1];
		if (node[k] && !('$leaf' in node[k])) throw new Error(`emit-bridge-cases: ${this.where}: ${p.join('.')} over a subset`);
		if (node[k] && JSON.stringify(node[k].$leaf) !== JSON.stringify(value)) {
			throw new Error(`emit-bridge-cases: ${this.where}: the corpus answers ${p.join('.')} twice for one state, differently`);
		}
		node[k] = { $leaf: value };
	}
	/** A slot's state, read where no call answers it: on the call that last answered it. */
	wantState(slot, key, value) {
		if (slot.set) throw new Error(`emit-bridge-cases: ${this.where}: a state read before any call answered it`);
		this.want(slot.step, [...slot.path, key], value);
	}
	done() {
		// tests/corebridge_cases.c keeps 64 bindings a case.
		if (this.binds > 64) throw new Error(`emit-bridge-cases: ${this.where}: ${this.binds} bindings, more than the C harness keeps (64)`);
		const finish = (node) => sub(Object.fromEntries(Object.entries(node).map(([k, v]) => [k, '$leaf' in v ? v.$leaf : finish(v)])));
		return this.steps.map(({ want, bind, ...st }) => ({ ...st, ...(want ? { expect: finish(want) } : {}), ...(bind ? { bind } : {}) }));
	}
}

const langCheck = (ok, where, what) => {
	if (!ok) throw new Error(`emit-bridge-cases: ${where}: ${what}`);
};
const slotOf = (step, ...p) => ({ step, path: p });
const withoutKeys = (o, ...keys) => Object.fromEntries(Object.entries(o).filter(([k]) => !keys.includes(k)));

/** core's `bookOf`: `emptyBook(b.language ?? 'fr')` with the case's book over it. */
function langBook(S, v) {
	const b = v ?? {};
	const empty = S.call('language.book.empty', { language: b.language ?? 'fr' });
	return Object.keys(b).length ? { ...slotOf(empty, 'book'), set: JSON.parse(JSON.stringify(b)) } : slotOf(empty, 'book');
}

function langProgress(S, c) {
	const i = c.input;
	const e = c.expected;
	switch (c.op) {
		case 'mastery':
			langCheck(e.length === i.pairs.length, S.where, 'one answer per pair');
			i.pairs.forEach(([encountered, halves], k) => {
				langCheck(e[k].encountered === encountered && e[k].halves === halves, S.where, `pair ${k} is not echoed`);
				S.call('language.book.mastery', { encountered, halves }, { mastery: e[k].mastery });
			});
			return;
		case 'gain':
			langCheck(e.length === i.conversations.length, S.where, 'one answer per conversation');
			i.conversations.forEach((cv, k) => {
				const args = { fluency: cv.fluency, uniqueWords: cv.unique, grammarCorrect: cv.grammarCorrect, grammarAttempted: cv.grammarAttempted, turns: cv.turns, targetPercent: cv.targetPercent };
				S.call('language.book.fluencyGain', args, e[k]);
			});
			return;
		case 'facts': {
			const facts = i.facts ?? null;
			S.call('language.facts.cefr', { facts }, { cefr: e.cefr });
			S.call('language.facts.weakDimensions', typeof i.threshold === 'number' ? { facts, threshold: i.threshold } : { facts }, { weak: e.weak });
			return;
		}
		case 'run': {
			let book = langBook(S, i.book);
			langCheck(e.length === i.steps.length, S.where, 'one answer per step');
			i.steps.forEach((st, k) => {
				const x = e[k];
				langCheck(x.do === st.do, S.where, `step ${k} answers ${x.do}, not ${st.do}`);
				switch (st.do) {
					case 'advance': {
						const s = S.call('language.book.advance', { book: S.cur(book), ms: st.ms });
						S.want(s, ['book', 'clockMs'], x.clockMs);
						book = slotOf(s, 'book');
						return;
					}
					case 'encounter':
					case 'event': {
						let encounter;
						if (st.do === 'event') {
							if (x.heard === false) {
								S.call('language.book.encounterOfEvent', { event: st.event }, { encounter: null });
								return;
							}
							const ev = S.call('language.book.encounterOfEvent', { event: st.event }, { encounter: { $type: 'object' } });
							encounter = S.ref(ev, 'encounter');
						} else encounter = withoutKeys(st, 'do');
						const s = S.call('language.book.recordEncounter', { book: S.cur(book), encounter });
						S.want(s, ['ok'], x.ok);
						if (x.ok) {
							for (const key of ['entry', 'isNew', 'masteryChanged']) S.want(s, [key], x[key]);
							S.want(s, ['book', 'correctUsages'], x.correctUsages);
							S.want(s, ['book', 'words'], { $len: x.words });
						} else S.want(s, ['refusal'], x.refusal);
						book = slotOf(s, 'book');
						return;
					}
					case 'grammar': {
						const s = S.call('language.book.recordGrammar', { book: S.cur(book), feedback: st.feedback });
						S.want(s, ['touched'], x.touched);
						S.want(s, ['signals'], x.signals);
						book = slotOf(s, 'book');
						return;
					}
					case 'conversation': {
						const s = S.call('language.book.recordConversation', { book: S.cur(book), conversation: st.conversation });
						S.want(s, ['result'], x.result);
						S.want(s, ['signals'], x.signals);
						for (const key of ['fluency', 'cefr', 'conversations']) S.want(s, ['book', key], x[key]);
						book = slotOf(s, 'book');
						return;
					}
					case 'cefr': {
						const s = S.call('language.book.setCefr', { book: S.cur(book), level: st.level });
						S.want(s, ['signals'], x.signals);
						for (const key of ['cefr', 'fluency']) S.want(s, ['book', key], x[key]);
						book = slotOf(s, 'book');
						return;
					}
					case 'weak': {
						S.call('language.book.weakPatterns', { book: S.cur(book) }, { patterns: { $ids: x.weak, $key: 'pattern' } });
						langCheck(('word' in x) === (typeof st.word === 'string'), S.where, `step ${k}: a word view without a word, or none for one`);
						if (typeof st.word === 'string') {
							if (x.word === null) S.call('language.book.findWord', { book: S.cur(book), word: st.word }, { row: null });
							else {
								const f = S.call('language.book.findWord', { book: S.cur(book), word: st.word }, { row: { $type: 'object' } });
								S.call('language.book.wordView', { row: S.ref(f, 'row') }, { view: x.word });
							}
						}
						return;
					}
					case 'summary':
						S.call('language.book.summary', { book: S.cur(book) }, withoutKeys(x, 'do'));
						return;
					default:
						throw new Error(`emit-bridge-cases: ${S.where}: progress run step ${st.do} has no transcription`);
				}
			});
			return;
		}
	}
	throw new Error(`emit-bridge-cases: ${S.where}: progress op ${c.op} has no transcription`);
}

function langSave(S, c) {
	const i = c.input;
	const e = c.expected;
	switch (c.op) {
		case 'block': {
			const args = {};
			if (Array.isArray(i.encounters)) {
				let book = langBook(S, { language: i.language ?? 'fr' });
				for (const enc of i.encounters) book = slotOf(S.call('language.book.recordEncounter', { book: S.cur(book), encounter: enc }), 'book');
				for (const fb of i.grammar ?? []) book = slotOf(S.call('language.book.recordGrammar', { book: S.cur(book), feedback: fb }), 'book');
				if (i.cefr) book = slotOf(S.call('language.book.setCefr', { book: S.cur(book), level: i.cefr }), 'book');
				args.book = S.cur(book);
			}
			for (const k of ['collected', 'naming', 'identification']) if (i[k] !== undefined && i[k] !== null) args[k] = i[k];
			const block = S.call('language.save.block', args);
			S.call('language.save.blockOf', { block: S.ref(block, 'block') }, { block: e });
			return;
		}
		case 'read':
			S.call('language.save.read', 'block' in i ? { block: i.block } : {}, e);
			return;
		case 'restore': {
			const args = 'block' in i ? { block: i.block } : {};
			if (e.ok === false) {
				S.call('language.save.read', args, { ok: false, keys: e.keys });
				return;
			}
			const read = S.call('language.save.read', args);
			S.want(read, ['ok'], true);
			const none = i.block === undefined || i.block === null;
			const from = none ? S.ref(S.call('language.save.block', {}), 'block') : S.ref(read, 'value');
			S.call('language.save.blockOf', { block: from }, { block: e.block });
			if (e.summary === null) {
				langCheck(e.mastery.length === 0 && e.weak.length === 0, S.where, 'no book, yet mastery or weakness');
				return;
			}
			S.call('language.book.summary', { book: S.ref(read, 'value', 'book') }, e.summary);
			e.mastery.forEach((m, k) => {
				langCheck(m.word === e.block.book.words[k].word, S.where, `mastery ${k} is not the book's word ${k}`);
				const w = ['value', 'book', 'words', String(k)];
				S.call('language.book.mastery', { encountered: S.ref(read, ...w, 'encountered'), halves: S.ref(read, ...w, 'halves') }, { mastery: m.mastery });
			});
			S.call('language.book.weakPatterns', { book: S.ref(read, 'value', 'book') }, { patterns: { $ids: e.weak, $key: 'pattern' } });
			return;
		}
	}
	throw new Error(`emit-bridge-cases: ${S.where}: save op ${c.op} has no transcription`);
}

function langPrompts(S, c) {
	const i = c.input;
	const e = c.expected;
	langCheck(c.op === 'run', S.where, `prompts op ${c.op} has no transcription`);
	const params = i.params ?? {};
	const contract = S.call('language.contract', {});
	const tuning = (key, over) => ({ ...S.ref(contract, key), ...(over && Object.keys(over).length ? { $set: over } : {}) });
	const identifyTuning = tuning('identificationTuning', params.identification);
	const namingTuning = tuning('namingTuning', params.naming);
	const collectionTuning = tuning('collectionTuning', params.collection);
	let ident = slotOf(S.call('language.identification.initial', {}), 'state');
	let naming = slotOf(S.call('language.naming.initial', {}), 'state');
	let prompts = slotOf(S.call('language.prompts.initial', {}), 'state');
	let collection = null;
	const tags = () => (collection ??= slotOf(S.call('language.collection.initial', { seed: i.seed }), 'state'));
	const world = () => ({ identification: S.cur(ident), naming: S.cur(naming), targetLanguage: i.targetLanguage, identifyTuning, namingTuning });
	langCheck(e.length === i.steps.length, S.where, 'one answer per step');
	i.steps.forEach((st, k) => {
		const x = e[k];
		langCheck(x.do === st.do, S.where, `step ${k} answers ${x.do}, not ${st.do}`);
		switch (st.do) {
			case 'register': {
				if (st.targets !== undefined) ident = slotOf(S.call('language.identification.registerTargets', { state: S.cur(ident), targets: st.targets }), 'state');
				if (st.world !== undefined) {
					const named = S.call('language.naming.nameableObjects', { objects: st.world, targetLanguage: i.targetLanguage });
					naming = slotOf(S.call('language.naming.registerNameable', { state: S.cur(naming), objects: S.ref(named, 'objects') }), 'state');
				}
				if (st.tags !== undefined) collection = slotOf(S.call('language.collection.registerTags', { state: S.cur(tags()), tags: st.tags }), 'state');
				S.wantState(ident, 'targets', { $ids: x.targets });
				S.wantState(naming, 'objects', { $ids: x.nameable, $key: 'objectId' });
				if (collection) S.wantState(collection, 'tags', { $ids: x.tagged, $key: 'objectId' });
				else langCheck(x.tagged.length === 0, S.where, `step ${k}: tagged objects with no collection`);
				return;
			}
			case 'pick': {
				const at = { x: st.at.x, z: st.at.z };
				let pick;
				if (st.object !== undefined) {
					pick = st.object;
					langCheck(x.picked === (x.ok ? (st.object?.id ?? null) : null), S.where, `step ${k}: picked is not the object's id`);
				} else {
					const p = S.call('props.interactables.examinePick', { objects: st.objects ?? [], at }, { pick: x.picked === null ? null : sub({ id: x.picked }) });
					pick = S.ref(p, 'pick');
				}
				const s = S.call('language.prompts.onPick', { state: S.cur(prompts), pick, at, world: world() });
				S.want(s, ['ok'], x.ok);
				if (x.ok) for (const key of ['prompt', 'checked', 'events']) S.want(s, [key], x[key]);
				else S.want(s, ['refusal'], x.refusal);
				S.want(s, ['state', 'pick'], x.standing);
				prompts = slotOf(s, 'state');
				return;
			}
			case 'standing': {
				const s = S.call('language.prompts.standing', { state: S.cur(prompts), world: world() });
				S.want(s, ['prompt'], x.pick);
				S.want(s, ['state', 'quiz'], x.quiz);
				prompts = slotOf(s, 'state');
				return;
			}
			case 'answer': {
				const s = S.call('language.prompts.answer', { state: S.cur(prompts), input: st.input, world: world() });
				S.want(s, ['ok'], x.ok);
				if (x.ok) for (const key of ['kind', 'id', 'result', 'standing']) S.want(s, [key], x[key]);
				else S.want(s, ['refusal'], x.refusal);
				prompts = slotOf(s, 'state');
				ident = slotOf(s, 'identification');
				naming = slotOf(s, 'naming');
				return;
			}
			case 'reach': {
				const s = S.call('language.prompts.quizOnReach', { state: S.cur(prompts), collection: S.cur(tags()), at: st.at, tuning: collectionTuning });
				S.want(s, ['inReach'], x.inReach);
				S.want(s, ['quiz'], x.quiz);
				S.want(s, ['state', 'quiz'], x.standing);
				S.want(s, ['state', 'offered'], x.offered);
				prompts = slotOf(s, 'state');
				collection = slotOf(s, 'collection');
				return;
			}
			case 'choose': {
				const s = S.call('language.prompts.answerQuiz', { state: S.cur(prompts), collection: S.cur(tags()), answer: st.answer, tuning: collectionTuning });
				S.want(s, ['ok'], x.ok);
				if (x.ok) {
					S.want(s, ['objectId'], x.objectId);
					S.want(s, ['answer'], withoutKeys(x, 'do', 'ok', 'objectId', 'collected', 'standing'));
					S.want(s, ['collection', 'collected'], x.collected);
					S.want(s, ['state', 'quiz'], x.standing);
				} else S.want(s, ['refusal'], x.refusal);
				prompts = slotOf(s, 'state');
				collection = slotOf(s, 'collection');
				return;
			}
		}
		throw new Error(`emit-bridge-cases: ${S.where}: prompts run step ${st.do} has no transcription`);
	});
}

function langHover(S, c) {
	const i = c.input;
	const e = c.expected;
	if (c.op === 'tokens') {
		S.call('language.hover.tokenize', { text: i.text }, { tokens: e.tokens });
		return;
	}
	langCheck(c.op === 'run', S.where, `hover op ${c.op} has no transcription`);
	const init = S.call('language.hover.initial', { cefr: i.cefr ?? 'A1', targetLanguage: typeof i.targetLanguage === 'string' ? i.targetLanguage : null });
	let hover = slotOf(init, 'state');
	langCheck(e.length === i.steps.length, S.where, 'one answer per step');
	i.steps.forEach((st, k) => {
		const x = e[k];
		langCheck(x.do === st.do, S.where, `step ${k} answers ${x.do}, not ${st.do}`);
		switch (st.do) {
			case 'hints': {
				const s = S.call('language.hover.addHints', { state: S.cur(hover), hints: st.hints });
				S.want(s, ['state', 'cache'], x.cached.map((key) => [key, { $any: true }]));
				hover = slotOf(s, 'state');
				return;
			}
			case 'see': {
				const s = S.call('language.hover.seeWord', { state: S.cur(hover), word: st.word, ...(st.difficulty === undefined ? {} : { difficulty: st.difficulty }) });
				S.want(s, ['showHint'], x.showHint);
				S.want(s, ['state', 'newWordIndex'], x.newWordIndex);
				hover = slotOf(s, 'state');
				return;
			}
			case 'mastery':
				hover = slotOf(S.call('language.hover.setMastery', { state: S.cur(hover), word: st.word, encountered: st.encountered, correct: st.correct }), 'state');
				return;
			case 'lookup': {
				const s = S.call('language.hover.lookup', { state: S.cur(hover), word: st.word });
				S.want(s, ['ok'], x.ok);
				if (x.ok) {
					for (const key of ['result', 'request', 'signals']) S.want(s, [key], x[key]);
					S.want(s, ['state', 'pending'], x.pending);
				} else S.want(s, ['refusal'], x.refusal);
				hover = slotOf(s, 'state');
				return;
			}
			case 'resolve': {
				const args = { state: S.cur(hover), word: st.word, translation: st.translation ?? null, ...(typeof st.context === 'string' ? { context: st.context } : {}) };
				const s = S.call('language.hover.resolve', args);
				S.want(s, ['result'], x.result);
				S.want(s, ['signals'], x.signals);
				S.want(s, ['state', 'pending'], x.pending);
				hover = slotOf(s, 'state');
				return;
			}
			case 'likely':
				langCheck(x.words.length === st.words.length, S.where, `step ${k}: one answer per word`);
				st.words.forEach((word, n) => {
					langCheck(x.words[n].word === word, S.where, `step ${k}: word ${n} is not echoed`);
					S.call('language.hover.isLikelyTarget', { state: S.cur(hover), word }, { likely: x.words[n].likely });
				});
				return;
			case 'display':
				S.call('language.hover.display', { state: S.cur(hover) }, { mode: x.mode, size: x.size });
				S.wantState(hover, 'mastery', x.encounters);
				return;
		}
		throw new Error(`emit-bridge-cases: ${S.where}: hover run step ${st.do} has no transcription`);
	});
}

function langChat(S, c) {
	const i = c.input;
	const e = c.expected;
	const worldWords = i.worldWords === undefined ? {} : { worldWords: i.worldWords };
	switch (c.op) {
		case 'words': {
			const book = langBook(S, i.book);
			langCheck(e.length === i.lines.length, S.where, 'one answer per line');
			i.lines.forEach((line, k) => {
				langCheck(e[k].line === line, S.where, `line ${k} is not echoed`);
				S.call('language.chat.lineWords', { line, book: S.cur(book), ...worldWords }, withoutKeys(e[k], 'line'));
			});
			return;
		}
		case 'percent':
			langCheck(e.length === i.pairs.length, S.where, 'one answer per pair');
			i.pairs.forEach(([used, turns], k) => {
				langCheck(e[k].used === used && e[k].turns === turns, S.where, `pair ${k} is not echoed`);
				S.call('language.chat.targetPercent', { used, turns }, { targetPercent: e[k].targetPercent });
			});
			return;
		case 'hear': {
			let session = slotOf(S.call('language.chat.start', {}), 'session');
			langCheck(e.length === i.checks.length, S.where, 'one answer per check');
			i.checks.forEach((check, k) => {
				const x = e[k];
				langCheck(x.status === check.status && x.grammarChecked === x.grammarCorrect + x.grammarErrors, S.where, `check ${k}: status or grammarChecked`);
				const s = S.call('language.chat.hear', { session: S.cur(session), check });
				S.want(s, ['session', 'grammarCorrect'], x.grammarCorrect);
				S.want(s, ['session', 'grammarErrors'], x.grammarErrors);
				session = slotOf(s, 'session');
			});
			return;
		}
		case 'usages': {
			const book = langBook(S, i.book);
			langCheck(e.length === i.lines.length, S.where, 'one answer per line');
			i.lines.forEach((line, k) => {
				langCheck(e[k].line === line, S.where, `line ${k} is not echoed`);
				S.call('language.chat.questUsages', { line, questWords: i.questWords, book: S.cur(book), ...worldWords }, { usages: e[k].usages });
			});
			return;
		}
		case 'run': {
			let book = langBook(S, i.book);
			let session = null;
			let difficulty = null;
			langCheck(e.length === i.steps.length, S.where, 'one answer per step');
			i.steps.forEach((st, k) => {
				const x = e[k];
				langCheck(x.do === st.do, S.where, `step ${k} answers ${x.do}, not ${st.do}`);
				langCheck(st.do === 'start' || session, S.where, `step ${k}: ${st.do} with no chat open`);
				switch (st.do) {
					case 'start':
						session = slotOf(S.call('language.chat.start', st.npc === undefined ? {} : { npcName: st.npc }, { session: x.session }), 'session');
						difficulty = slotOf(S.call('language.difficulty.initial', {}), 'state');
						return;
					case 'line': {
						const s = S.call('language.chat.line', { session: S.cur(session), line: st.text, book: S.cur(book), ...worldWords });
						S.want(s, ['ok'], x.ok);
						S.want(s, ['session', 'turns'], x.turns);
						if (x.ok) {
							S.want(s, ['metrics'], x.metrics);
							S.want(s, ['wordsUsed'], x.wordsUsed);
							S.want(s, ['session', 'wordsUsed'], x.chatWords);
							const t = S.call('language.difficulty.recordTurn', { state: S.cur(difficulty), metrics: S.ref(s, 'metrics') });
							S.want(t, ['struggle'], x.struggle);
							S.want(t, ['adjustment'], x.adjustment);
							S.want(t, ['state', 'level'], x.level);
							difficulty = slotOf(t, 'state');
						} else S.want(s, ['refusal'], x.refusal);
						session = slotOf(s, 'session');
						return;
					}
					case 'hear': {
						const s = S.call('language.chat.hear', { session: S.cur(session), check: st.check });
						S.want(s, ['session', 'grammarCorrect'], x.grammarCorrect);
						S.want(s, ['session', 'grammarErrors'], x.grammarErrors);
						session = slotOf(s, 'session');
						return;
					}
					case 'end': {
						const s = S.call('language.chat.finish', { book: S.cur(book), session: S.cur(session) });
						S.want(s, ['ok'], x.ok);
						if (x.ok) {
							for (const key of ['conversation', 'result', 'signals']) S.want(s, [key], x[key]);
							S.want(s, ['book', 'fluency'], x.fluency);
							S.want(s, ['book', 'words'], x.bookWords.map((w) => sub(w)));
						} else S.want(s, ['refusal'], x.refusal);
						S.want(s, ['book', 'conversations'], x.conversations);
						book = slotOf(s, 'book');
						session = null;
						return;
					}
				}
				throw new Error(`emit-bridge-cases: ${S.where}: chat run step ${st.do} has no transcription`);
			});
			return;
		}
	}
	throw new Error(`emit-bridge-cases: ${S.where}: chat op ${c.op} has no transcription`);
}

const LANGUAGE_TRANSCRIBERS = { progress: langProgress, save: langSave, prompts: langPrompts, hover: langHover, chat: langChat };

/** One case file per language corpus file: `core-language-<file>.json`. */
function language(root, coreCommit) {
	const out = {};
	for (const base of LANGUAGE_CASE_FILES) {
		const r = reader(root);
		const file = r.json(`conformance/language/${base}.json`);
		if (file.area !== 'language' || file.file !== `language/${base}`) throw new Error(`emit-bridge-cases: conformance/language/${base}.json is not core's language/${base} corpus`);
		const cases = file.cases.map((c) => {
			const name = `language/${base} ${c.op}: ${c.name}`;
			const S = new LanguageSteps(name);
			LANGUAGE_TRANSCRIBERS[base](S, c);
			return { name, steps: S.done() };
		});
		out[`core-language-${base}.json`] = caseFile(
			`language-${base}`,
			`core's language corpus conformance/language/${base}.json (P9h.core) through the language.* rows, each op as ` +
				"core's reference runner (src/language-learning/systems-corpus.ts, runLanguageSystemsOp) composes it.",
			coreCommit,
			r.files,
			cases,
		);
	}
	return out;
}

/** Every generated case file, keyed by file name. */
export function emitBridgeCases(root, coreCommit) {
	return {
		'core-saves.json': saves(root, coreCommit),
		'core-saves-village.json': villageSave(root, coreCommit),
		'core-quests.json': quests(root, coreCommit),
		'core-ui-pause-menu.json': pauseMenu(root, coreCommit),
		'core-ui-quest-journal.json': questJournal(root, coreCommit),
		'core-ui-save-slots.json': saveSlots(root, coreCommit),
		'core-ui-loading.json': loading(root, coreCommit),
		'core-ui-trade.json': trade(root, coreCommit),
		'core-weather-progression.json': weather(root, coreCommit),
		...genres(root, coreCommit),
		...language(root, coreCommit),
	};
}
