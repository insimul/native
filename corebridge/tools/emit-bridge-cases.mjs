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

// ── villager pass-by: conformance/villagers/pass-by.json (pass-by-corpus.test.ts) ──
//
// Core's reference runner is src/pass-by/pass-by-corpus.ts (`runPassByOp`): each op is ONE
// core call, and each becomes ONE call of the passBy.* row over that function
// (PL.native-pass-by-rows), the case's whole input as its args and its whole answer as
// its expectation:
//
//   floor   passBy.guardFloor     { villagerRadius?, playerRadius? }  -> { floorM }
//   guard   passBy.keepClear      the PassByGuardInput                -> { acted, velocity, side }
//   plan    passBy.planStepAside  the StepAsideInput                  -> the StepAsideDecision
//   round   passBy.planRound      { here, next, player, radii? }      -> { way }
//   replay  passBy.replay         { scene }                           -> the PassByReplay
//
// Core's runner compares numbers within the file's `tolerance` (1e-6); the bridge's matcher
// compares them as doubles, exactly, which both legs meet (the rows run core's own code). One
// more case holds passBy.contract to the corpus's contract: the constants (each key's
// `value`), the side frames and the measured abreast window; the export names it also states
// are pinned by the hand cases. An op this map does not know fails the emit.

/** The row each pass-by op calls (pass-by-corpus.ts's runPassByOp, through the rows). */
const PASS_BY_ROWS = {
	floor: 'passBy.guardFloor',
	guard: 'passBy.keepClear',
	plan: 'passBy.planStepAside',
	round: 'passBy.planRound',
	replay: 'passBy.replay',
};

function passBy(root, coreCommit) {
	const r = reader(root);
	const file = r.json('conformance/villagers/pass-by.json');
	if (file.area !== 'villager-pass-by') throw new Error('emit-bridge-cases: pass-by.json is not the villager pass-by corpus');
	const cases = [
		{
			name: 'pass-by: the contract the passBy.contract row states',
			steps: [
				{
					call: 'passBy.contract',
					expect: {
						constants: Object.fromEntries(Object.entries(file.contract.constants).map(([k, v]) => [k, v.value])),
						names: { $type: 'object' },
						measuredAbreastS: file.contract.measuredAbreastS,
						sideFrames: file.contract.sideFrames,
					},
				},
			],
		},
	];
	for (const c of file.cases) {
		const call = PASS_BY_ROWS[c.op];
		if (!call) throw new Error(`emit-bridge-cases: pass-by.json op ${c.op} has no transcription (case "${c.name}")`);
		cases.push({ name: `pass-by ${c.op}: ${c.name}`, steps: [{ call, args: c.input, expect: c.expected }] });
	}
	return caseFile(
		'villagers-pass-by',
		"core's villager pass-by corpus (conformance/villagers/pass-by.json, PL.pass-by-core) through the passBy.* rows, " +
			"each op one call of its row, as core's reference runner (pass-by/pass-by-corpus.ts) makes one core call.",
		coreCommit,
		r.files,
		cases,
	);
}

// ── world-vehicle parking: conformance/props/vehicle-placement.json (vehicle-placement.test.ts) ──
//
// Core's reference runner is src/props/vehicle-placement-corpus.ts (`runVehiclePlacementOp`):
// each op is ONE core call, and each becomes ONE call of the props.vehicle.* row over that
// function (PL.native-vehicle-rows), the case's whole input as its args and its whole answer
// as its expectation:
//
//   probes  props.vehicle.streetProbes  { at, radiusM }          -> { points }
//   park    props.vehicle.park          the VehicleParkingInput  -> the VehicleParking
//
// Core's runner compares numbers within the file's `tolerance` (1e-6); the bridge's matcher
// compares them as doubles, exactly, which both legs meet (the rows run core's own code). One
// more case holds props.vehicle.contract to the corpus's contract: the constants (each key's
// `value`), the refusals, the tiers and the deviations; the export names it also states are
// pinned by the hand cases. An op this map does not know fails the emit.

/**
 * Library-version answers (corebridge/tests/README.md): the members of a case's answer where this library's QuickJS
 * answers otherwise than the V8 core's corpus was written with, within the corpus's `tolerance`. Core's runner compares
 * within that tolerance, and so does tests/props_vehicle_placement_corpus.cpp; the bridge's matcher compares as doubles,
 * so such a step is declared: `expect` is the row's answer, `libraryVersion.v8` the corpus's. Measured at the 45409ed pin:
 * `Math.hypot(7, 1.5)` is 7.158910531638177 on QuickJS (the correctly rounded √51.25) and 7.158910531638176 on V8, one ulp
 * apart. core_vendor holds each declaration to the corpus (v8 the case's answer exactly, expect within the tolerance).
 */
const VEHICLE_PLACEMENT_QUICKJS = {
	'park: a ring point off the street moves to the first street point within 1.5 m (here 1.5 m toward +z)': { distanceM: 7.158910531638177 },
};

/** The row each vehicle-placement op calls (vehicle-placement-corpus.ts's runVehiclePlacementOp, through the rows). */
const VEHICLE_PLACEMENT_ROWS = {
	probes: 'props.vehicle.streetProbes',
	park: 'props.vehicle.park',
};

function vehiclePlacement(root, coreCommit) {
	const r = reader(root);
	const file = r.json('conformance/props/vehicle-placement.json');
	if (file.area !== 'props-vehicle-placement') throw new Error('emit-bridge-cases: vehicle-placement.json is not the vehicle-placement corpus');
	const cases = [
		{
			name: 'vehicle-placement: the contract the props.vehicle.contract row states',
			steps: [
				{
					call: 'props.vehicle.contract',
					expect: {
						constants: Object.fromEntries(Object.entries(file.contract.constants).map(([k, v]) => [k, v.value])),
						names: { $type: 'object' },
						refusals: file.contract.refusals,
						tiers: file.contract.tiers,
						deviations: file.contract.deviations,
					},
				},
			],
		},
	];
	for (const c of file.cases) {
		const call = VEHICLE_PLACEMENT_ROWS[c.op];
		if (!call) throw new Error(`emit-bridge-cases: vehicle-placement.json op ${c.op} has no transcription (case "${c.name}")`);
		const quickjs = VEHICLE_PLACEMENT_QUICKJS[c.name];
		const step = quickjs
			? {
					call,
					args: c.input,
					expect: { ...c.expected, ...quickjs },
					libraryVersion: {
						library: 'QuickJS 2025-04-26 Math.hypot (correctly rounded), against V8 Math.hypot',
						v8: c.expected,
						why: `the corpus's answer was written on V8, whose Math.hypot is one ulp from QuickJS's here (${Object.keys(quickjs).join(', ')}); core's runner compares within the file's tolerance ${file.tolerance}, which both meet`,
					},
				}
			: { call, args: c.input, expect: c.expected };
		cases.push({ name: `vehicle-placement ${c.op}: ${c.name}`, steps: [step] });
	}
	return caseFile(
		'props-vehicle-placement',
		"core's world-vehicle parking corpus (conformance/props/vehicle-placement.json, PL.core-vehicle-rules) through the props.vehicle.* rows, " +
			"each op one call of its row, as core's reference runner (props/vehicle-placement-corpus.ts) makes one core call.",
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

/** The corpus files the language rows answer (slices 1 to 4, in order), by their `file` key. */
export const LANGUAGE_CASE_FILES = [
	'progress', 'save', 'prompts', 'hover', 'chat', 'bank', 'adaptation', 'pronunciation', 'collection', 'objects', 'writing', 'quest-feedback', 'quest-types',
];

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
			// core's runner starts the monitor before the first chat too, and again with each chat.
			let difficulty = slotOf(S.call('language.difficulty.initial', {}), 'state');
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

// Slice 2: the bank and the learning profile, the rest of adaptation, listen and repeat.
// Where the runner echoes an input member into its answer (a mode's id, a check's level,
// a word, a score), the emitter checks the echo against the input; core_vendor's
// LANGUAGE_ANSWER_ECHOES names those members, and holds every other member of every
// answer to being stated in some expectation.

const echoes = (S, x, from, keys) => {
	for (const k of keys) langCheck(JSON.stringify(x[k]) === JSON.stringify(from[k]), S.where, `${k} is not echoed from the input`);
};

function langBank(S, c) {
	const i = c.input;
	const e = c.expected;
	switch (c.op) {
		case 'cards': {
			const book = langBook(S, i.book);
			S.call('language.bank.categories', { book: S.cur(book) }, { categories: e.categories });
			S.call('language.bank.cards', { book: S.cur(book), query: i.query ?? {} }, { cards: e.cards });
			return;
		}
		case 'reveal': {
			const modes = ['inline', 'hover', 'click'];
			langCheck(e.length === modes.length, S.where, 'one answer per display mode');
			modes.forEach((mode, k) => {
				langCheck(e[k].mode === mode, S.where, `answer ${k} is not mode ${mode}`);
				for (const interaction of ['idle', 'gaze', 'select']) S.call('language.bank.revealsMeaning', { reveal: mode, interaction }, { reveals: e[k][interaction] });
			});
			return;
		}
		case 'grammar': {
			const book = langBook(S, i.book);
			S.call('language.bank.grammarTab', { book: S.cur(book) }, { tab: e.tab });
			S.call('language.bank.analyzeWeaknesses', { book: S.cur(book), options: i.options ?? {} }, e.analysis);
			S.call('language.bank.strongPatterns', typeof i.max === 'number' ? { book: S.cur(book), max: i.max } : { book: S.cur(book) }, { patterns: e.strong });
			return;
		}
		case 'tables':
			S.call('language.contract', {}, sub({ weaknessVolumePermille: e.volume, weaknessConfidencePermille: e.confidence }));
			return;
		case 'profile':
			S.call('language.profile.build', { history: i.history ?? [], assessments: i.assessments ?? [] }, e);
			return;
		case 'history': {
			const h = S.call('language.profile.history', { quests: i.quests ?? [] }, { history: e.history });
			S.call('language.profile.build', { history: S.ref(h, 'history'), assessments: i.assessments ?? [] }, e.profile);
			return;
		}
	}
	throw new Error(`emit-bridge-cases: ${S.where}: bank op ${c.op} has no transcription`);
}

function langAdaptation(S, c) {
	const i = c.input;
	const e = c.expected;
	switch (c.op) {
		case 'struggle':
			langCheck(e.length === i.turns.length, S.where, 'one answer per turn');
			i.turns.forEach((metrics, k) => {
				S.call('language.difficulty.signals', { metrics }, { signals: e[k].signals });
				S.call('language.difficulty.score', { metrics }, { score: e[k].score });
			});
			return;
		case 'difficulty': {
			let state = slotOf(S.call('language.difficulty.initial', {}), 'state');
			langCheck(e.length === i.steps.length, S.where, 'one answer per step');
			i.steps.forEach((st, k) => {
				const x = e[k];
				langCheck(x.do === st.do && st.do === 'turn', S.where, `step ${k} answers ${x.do}, not ${st.do}`);
				const t = S.call('language.difficulty.recordTurn', { state: S.cur(state), metrics: st.metrics });
				S.want(t, ['struggle'], x.struggle);
				S.want(t, ['adjustment'], x.adjustment);
				for (const key of ['level', 'high', 'low', 'turns', 'scaffolded', 'stretched']) S.want(t, ['state', key], x[key]);
				state = slotOf(t, 'state');
			});
			return;
		}
		case 'mode': {
			const bands = ['A1', 'A2', 'B1', 'B2', 'C1', 'C2'];
			langCheck(e.length === i.npcs.length, S.where, 'one answer per NPC');
			i.npcs.forEach((id, k) => {
				const x = e[k];
				langCheck(x.id === id && x.roll === x.hash % 100, S.where, `NPC ${k}: its id or roll (hash mod 100) is not the runner's`);
				langCheck(JSON.stringify(Object.keys(x.modes)) === JSON.stringify(bands), S.where, `NPC ${k}: modes are not the six bands`);
				S.call('language.npc.hash', { id }, { hash: x.hash });
				for (const level of bands) S.call('language.npc.mode', { level, npcId: id }, { mode: x.modes[level] });
			});
			return;
		}
		case 'npc': {
			const args = { level: i.level, npcId: i.npcId, target: i.target };
			if (typeof i.native === 'string') args.native = i.native;
			args.scaffolding = i.scaffolding ?? 'none';
			S.call('language.npc.adaptation', args, e);
			return;
		}
		case 'hint':
			langCheck(e.length === i.checks.length, S.where, 'one answer per check');
			i.checks.forEach((ch, k) => {
				echoes(S, e[k], ch, Object.keys(ch));
				langCheck(JSON.stringify(Object.keys(e[k])) === JSON.stringify([...Object.keys(ch), 'show']), S.where, `check ${k}: the answer is not the check and its show`);
				const args = { level: ch.level, index: ch.index };
				if (ch.difficulty !== undefined) args.difficulty = ch.difficulty;
				args.mastered = ch.mastered === true;
				S.call('language.hints.showsVocabHint', args, { show: e[k].show });
			});
			return;
		case 'quests':
			S.call('language.quests.filterByCefr', { quests: i.quests ?? [], level: i.level }, { shown: e.shown });
			return;
		case 'advance':
			langCheck(e.length === i.snapshots.length, S.where, 'one answer per snapshot');
			i.snapshots.forEach((snapshot, k) => S.call('language.cefr.advancement', { snapshot }, e[k]));
			return;
	}
	throw new Error(`emit-bridge-cases: ${S.where}: adaptation op ${c.op} has no transcription`);
}

function langPronunciation(S, c) {
	const i = c.input;
	const e = c.expected;
	switch (c.op) {
		case 'encode':
			langCheck(e.length === i.words.length, S.where, 'one answer per word');
			i.words.forEach((word, k) => {
				langCheck(e[k].word === word, S.where, `word ${k} is not echoed`);
				S.call('language.pronunciation.encode', { word }, { code: e[k].code });
			});
			return;
		case 'similarity':
			langCheck(e.length === i.pairs.length, S.where, 'one answer per pair');
			i.pairs.forEach(([expected, spoken], k) => {
				langCheck(e[k].expected === expected && e[k].spoken === spoken, S.where, `pair ${k} is not echoed`);
				S.call('language.pronunciation.wordSimilarity', { expected, spoken }, withoutKeys(e[k], 'expected', 'spoken'));
			});
			return;
		case 'score':
			S.call('language.pronunciation.normalize', { text: i.spoken }, { normalized: e.normalized });
			S.call('language.pronunciation.score', { expected: i.expected, spoken: i.spoken }, withoutKeys(e, 'normalized'));
			return;
		case 'repeat': {
			const args = { phrase: i.phrase, spoken: i.spoken };
			if (typeof i.questId === 'string') args.questId = i.questId;
			S.call('language.pronunciation.listenAndRepeat', args, e);
			return;
		}
		case 'xp':
			langCheck(e.length === i.scores.length, S.where, 'one answer per score');
			i.scores.forEach((score, k) => {
				langCheck(e[k].score === score, S.where, `score ${k} is not echoed`);
				S.call('language.pronunciation.xp', { score }, { xp: e[k].xp });
			});
			return;
		case 'hints':
			langCheck(e.length === i.revealed.length, S.where, 'one answer per revealed count');
			i.revealed.forEach((revealed, k) => {
				langCheck(e[k].revealed === revealed, S.where, `revealed ${k} is not echoed`);
				S.call('language.pronunciation.hintPenalty', { score: i.score, penalties: i.penalties, revealed }, { score: e[k].score });
			});
			return;
	}
	throw new Error(`emit-bridge-cases: ${S.where}: pronunciation op ${c.op} has no transcription`);
}

// Slice 3: knowledge collection, object identification, point and name, examine
// (world-words.ts), composition and listening (reading-writing.ts). A run's tuning is
// the contract's default with the case's params over it (`$set`), as the runner spreads
// them; a register step's ids are stated as `$ids`, a listening quest's answers as a
// `$len` (core_vendor's LANGUAGE_RESHAPED_KEYS); every other member of every answer is
// stated verbatim.

/** The contract's default tuning `key` with the case's params over it (`{ ...DEFAULT, ...params }`). */
function langTuning(S, contract, key, params) {
	const over = params ?? {};
	return { ...S.ref(contract, key), ...(Object.keys(over).length ? { $set: over } : {}) };
}

function langCollection(S, c) {
	const i = c.input;
	const e = c.expected;
	langCheck(c.op === 'run', S.where, `collection op ${c.op} has no transcription`);
	const tuning = langTuning(S, S.call('language.contract', {}), 'collectionTuning', i.params);
	let state = slotOf(S.call('language.collection.initial', { seed: i.seed }), 'state');
	langCheck(e.length === i.steps.length, S.where, 'one answer per step');
	i.steps.forEach((st, k) => {
		const x = e[k];
		langCheck(x.do === st.do, S.where, `step ${k} answers ${x.do}, not ${st.do}`);
		switch (st.do) {
			case 'register': {
				const s = S.call('language.collection.registerTags', { state: S.cur(state), tags: st.tags });
				S.want(s, ['state', 'tags'], { $ids: x.objects, $key: 'objectId' });
				S.want(s, ['state', 'pool'], x.pool);
				state = slotOf(s, 'state');
				return;
			}
			case 'seed': {
				const s = S.call('language.collection.seed', { state: S.cur(state), category: st.category, answers: st.answers });
				S.want(s, ['state', 'pool'], x.pool);
				state = slotOf(s, 'state');
				return;
			}
			case 'reach':
				S.call('language.collection.inReach', { state: S.cur(state), at: st.at, tuning }, { inReach: x.inReach });
				return;
			case 'quiz': {
				const s = S.call('language.collection.quiz', { state: S.cur(state), objectId: st.objectId, tuning });
				S.want(s, ['quiz'], x.quiz);
				state = slotOf(s, 'state');
				return;
			}
			case 'answer': {
				const s = S.call('language.collection.answer', { state: S.cur(state), objectId: st.objectId, answer: st.answer, tuning });
				S.want(s, ['ok'], x.ok);
				if (x.ok) {
					for (const key of ['correct', 'alreadyCollected', 'xp', 'label', 'answer', 'category', 'events']) S.want(s, [key], x[key]);
					S.want(s, ['state', 'collected'], x.collected);
				} else S.want(s, ['refusal'], x.refusal);
				state = slotOf(s, 'state');
				return;
			}
		}
		throw new Error(`emit-bridge-cases: ${S.where}: collection run step ${st.do} has no transcription`);
	});
}

function langObjects(S, c) {
	const i = c.input;
	const e = c.expected;
	switch (c.op) {
		case 'normalize':
			langCheck(e.length === i.pairs.length, S.where, 'one answer per pair');
			i.pairs.forEach(([said, expected], k) => {
				const a = S.call('language.identification.normalize', { text: said }, { normalized: e[k].said });
				const b = S.call('language.identification.normalize', { text: expected }, { normalized: e[k].expected });
				const d = S.call('language.identification.editDistance', { a: S.ref(a, 'normalized'), b: S.ref(b, 'normalized') }, { distance: e[k].distance });
				// distanceScore's length is the expected answer's code points, as the runner counts them.
				S.call('language.identification.distanceScore', { distance: S.ref(d, 'distance'), length: Array.from(e[k].expected).length }, { score: e[k].score });
			});
			return;
		case 'identify': {
			const tuning = langTuning(S, S.call('language.contract', {}), 'identificationTuning', i.params);
			let state = slotOf(S.call('language.identification.initial', {}), 'state');
			langCheck(e.length === i.steps.length, S.where, 'one answer per step');
			i.steps.forEach((st, k) => {
				const x = e[k];
				langCheck(x.do === st.do, S.where, `step ${k} answers ${x.do}, not ${st.do}`);
				switch (st.do) {
					case 'register': {
						const s = S.call('language.identification.registerTargets', { state: S.cur(state), targets: st.targets });
						S.want(s, ['state', 'targets'], { $ids: x.targets });
						state = slotOf(s, 'state');
						return;
					}
					case 'prompt':
						S.call('language.identification.prompt', { state: S.cur(state), id: st.id, tuning }, withoutKeys(x, 'do'));
						return;
					case 'answer': {
						const s = S.call('language.identification.answer', { state: S.cur(state), id: st.id, input: st.input, tuning });
						S.want(s, ['ok'], x.ok);
						if (x.ok) {
							for (const key of ['passed', 'score', 'feedback', 'bestMatch', 'objectiveCompleted', 'events']) S.want(s, [key], x[key]);
							S.want(s, ['state', 'progress', st.id], x.progress);
						} else S.want(s, ['refusal'], x.refusal);
						state = slotOf(s, 'state');
						return;
					}
					case 'remove': {
						const s = S.call('language.identification.removeQuest', { state: S.cur(state), questId: st.questId });
						S.want(s, ['state', 'targets'], { $ids: x.targets });
						state = slotOf(s, 'state');
						return;
					}
					case 'quest':
						S.call('language.identification.quest', { state: S.cur(state), questId: st.questId }, withoutKeys(x, 'do'));
						return;
				}
				throw new Error(`emit-bridge-cases: ${S.where}: objects identify step ${st.do} has no transcription`);
			});
			return;
		}
		case 'naming': {
			const tuning = langTuning(S, S.call('language.contract', {}), 'namingTuning', i.params);
			let state = slotOf(S.call('language.naming.initial', {}), 'state');
			langCheck(e.length === i.steps.length, S.where, 'one answer per step');
			i.steps.forEach((st, k) => {
				const x = e[k];
				langCheck(x.do === st.do, S.where, `step ${k} answers ${x.do}, not ${st.do}`);
				switch (st.do) {
					case 'register': {
						let objects = st.objects;
						if (st.world) objects = S.ref(S.call('language.naming.nameableObjects', { objects: st.world, targetLanguage: st.targetLanguage }), 'objects');
						const s = S.call('language.naming.registerNameable', { state: S.cur(state), objects });
						S.want(s, ['state', 'objects'], x.objects);
						state = slotOf(s, 'state');
						return;
					}
					case 'point':
						S.call('language.naming.point', { state: S.cur(state), objectId: st.objectId, tuning }, withoutKeys(x, 'do'));
						return;
					case 'name': {
						const s = S.call('language.naming.submit', { state: S.cur(state), objectId: st.objectId, input: st.input, tuning });
						S.want(s, ['ok'], x.ok);
						if (x.ok) for (const key of ['correct', 'xp', 'attempts', 'revealed', 'toasts', 'events']) S.want(s, [key], x[key]);
						else S.want(s, ['refusal'], x.refusal);
						state = slotOf(s, 'state');
						return;
					}
				}
				throw new Error(`emit-bridge-cases: ${S.where}: objects naming step ${st.do} has no transcription`);
			});
			return;
		}
		case 'examine':
			S.call('language.objects.examine', { objects: i.objects ?? [], at: i.at, options: i.options }, e);
			return;
	}
	throw new Error(`emit-bridge-cases: ${S.where}: objects op ${c.op} has no transcription`);
}

const LISTENING_STEP_ROWS = { register: 'language.listening.register', prompt: 'language.listening.prompt', chat: 'language.listening.chat', grade: 'language.listening.grade' };

function langWriting(S, c) {
	const i = c.input;
	const e = c.expected;
	switch (c.op) {
		case 'composition':
			langCheck(e.length === i.texts.length, S.where, 'one answer per text');
			i.texts.forEach((text, k) => {
				langCheck(e[k].text === text, S.where, `text ${k} is not echoed`);
				S.call('language.writing.countWords', { text }, { words: e[k].words });
				S.call('language.writing.view', { config: i.config, text }, e[k].view);
				S.call('language.writing.submit', { config: i.config, text }, e[k].submit);
			});
			return;
		case 'listening': {
			// The state starts as core's runner starts it: `[]`.
			let state = null;
			const cur = () => (state === null ? [] : S.cur(state));
			langCheck(e.length === i.steps.length, S.where, 'one answer per step');
			i.steps.forEach((st, k) => {
				const x = e[k];
				langCheck(x.do === st.do, S.where, `step ${k} answers ${x.do}, not ${st.do}`);
				switch (st.do) {
					case 'register': {
						const s = S.call(LISTENING_STEP_ROWS.register, { state: cur(), quest: st.quest });
						S.want(s, ['state'], { $ids: x.quests, $key: 'questId' });
						state = slotOf(s, 'state');
						return;
					}
					case 'prompt':
						S.call(LISTENING_STEP_ROWS.prompt, { state: cur(), npcId: st.npcId }, { prompt: x.prompt });
						return;
					case 'chat': {
						const s = S.call(LISTENING_STEP_ROWS.chat, { state: cur(), npcId: st.npcId, player: st.player ?? '', npc: st.npc ?? '' });
						S.want(s, ['captured'], x.captured);
						S.want(s, ['needsGrade'], x.needsGrade);
						// Each quest as the runner projects it: its answers counted.
						S.want(s, ['state'], x.quests.map((q) => sub({ questId: q.questId, storyHeard: q.storyHeard, answers: { $len: q.answers }, evaluated: q.evaluated, score: q.score })));
						state = slotOf(s, 'state');
						return;
					}
					case 'grade': {
						const s = S.call(LISTENING_STEP_ROWS.grade, { state: cur(), questId: st.questId, score: typeof st.score === 'number' ? st.score : null });
						S.want(s, ['completed'], x.completed);
						state = slotOf(s, 'state');
						return;
					}
				}
				throw new Error(`emit-bridge-cases: ${S.where}: writing listening step ${st.do} has no transcription`);
			});
			return;
		}
	}
	throw new Error(`emit-bridge-cases: ${S.where}: writing op ${c.op} has no transcription`);
}

// Slice 4: real-time quest language feedback (quest-feedback.ts) and the language quest
// types and templates (quest-types/, language/quest-templates.ts). A run's state members
// are stated on the call that answered them (its `start` as the initial state's members);
// the members the runner assembles from several kernels (a step's `done`, its `locked`, a
// lifecycle step's `pronunciation` and `uses`) on the calls that answer each; a run's
// `recent` ids as `$ids` on the call that last answered the state. A quest type's
// categories and objectives are stated as `$ids`, a template's objectives as subsets of
// its objective templates and its parameters as `$ids` (core_vendor's
// LANGUAGE_RESHAPED_FORMS); every other member verbatim.

const QF = (fn) => `language.questFeedback.${fn}`;

function langQuestFeedback(S, c) {
	const i = c.input;
	const e = c.expected;
	if (c.op === 'targets') {
		S.call(QF('targets'), { objectives: i.objectives }, e);
		return;
	}
	langCheck(c.op === 'run', S.where, `quest-feedback op ${c.op} has no transcription`);
	langCheck(e.length === i.steps.length + 1 && e[0].do === 'start', S.where, 'the start, then one answer per step');
	const init = S.call(QF('initial'), { questId: i.questId, objectives: i.objectives, meanings: i.meanings ?? {} });
	for (const [key, v] of Object.entries(e[0].state)) S.want(init, ['state', key], v);
	let state = slotOf(init, 'state');
	// The runner's members read off the state: a step's answer key -> the state's member.
	const wantState = (s, x, pairs) => {
		for (const [key, member] of pairs) S.want(s, ['state', member], x[key]);
	};
	const done = (kind, value) => S.call(QF('done'), { state: S.cur(state) }, sub({ [kind]: value }));
	const locked = (kind, value) => S.call(QF(`locked${kind}`), { state: S.cur(state) }, { locked: value });
	i.steps.forEach((st, k) => {
		const x = e[k + 1];
		langCheck(x.do === st.do, S.where, `step ${k} answers ${x.do}, not ${st.do}`);
		switch (st.do) {
			case 'vocabulary': {
				const s = S.call(QF('useVocabulary'), { state: S.cur(state), usages: st.usages });
				S.want(s, ['items'], x.items);
				wantState(s, x, [['used', 'vocabularyUsed'], ['required', 'vocabularyRequired'], ['progress', 'vocabularyProgress'], ['objectives', 'vocabularyObjectives']]);
				state = slotOf(s, 'state');
				done('vocabulary', x.done);
				locked('Vocabulary', x.locked);
				return;
			}
			case 'lifecycle': {
				const s = S.call(QF('syncLifecycle'), { state: S.cur(state), objectives: st.objectives });
				S.want(s, ['items'], x.items);
				wantState(s, x, [['used', 'vocabularyUsed'], ['required', 'vocabularyRequired'], ['progress', 'vocabularyProgress'], ['objectives', 'vocabularyObjectives']]);
				wantState(s, x.pronunciation, [['passed', 'pronunciationPassed'], ['required', 'pronunciationRequired'], ['progress', 'pronunciationProgress'], ['objectives', 'pronunciationObjectives']]);
				wantState(s, x.uses, [['used', 'grammarUsed'], ['required', 'grammarRequired'], ['progress', 'grammarProgress'], ['objectives', 'grammarObjectives']]);
				state = slotOf(s, 'state');
				done('vocabulary', x.done);
				locked('Vocabulary', x.locked);
				done('pronunciation', x.pronunciation.done);
				locked('Pronunciation', x.pronunciation.locked);
				done('grammar', x.uses.done);
				locked('Grammar', x.uses.locked);
				return;
			}
			case 'grammar': {
				const s = S.call(QF('grammar'), { state: S.cur(state), feedback: st.feedback });
				S.want(s, ['items'], x.items);
				S.want(s, ['objectivesUpdated'], x.objectivesUpdated);
				wantState(s, x, [['accuracy', 'grammarAccuracy'], ['grammar', 'grammar'], ['objectives', 'objectives']]);
				wantState(s, x.uses, [['used', 'grammarUsed'], ['required', 'grammarRequired'], ['progress', 'grammarProgress'], ['objectives', 'grammarObjectives']]);
				state = slotOf(s, 'state');
				done('grammar', x.uses.done);
				locked('Grammar', x.uses.locked);
				return;
			}
			case 'correct': {
				const args = { state: S.cur(state), pattern: st.pattern };
				if (typeof st.example === 'string') args.example = st.example;
				const s = S.call(QF('correctUsage'), args);
				S.want(s, ['objectivesUpdated'], x.objectivesUpdated);
				wantState(s, x, [['objectives', 'objectives']]);
				state = slotOf(s, 'state');
				return;
			}
			case 'pronunciation': {
				const s = S.call(QF('pronunciation'), { state: S.cur(state), result: st.result });
				S.want(s, ['items'], x.items);
				wantState(s, x, [
					['passed', 'pronunciationPassed'], ['required', 'pronunciationRequired'], ['progress', 'pronunciationProgress'],
					['average', 'pronunciationAverage'], ['phrases', 'pronunciation'], ['objectives', 'pronunciationObjectives'],
				]);
				state = slotOf(s, 'state');
				done('pronunciation', x.done);
				locked('Pronunciation', x.locked);
				return;
			}
			case 'hints': {
				const s = S.call(QF('hints'), typeof st.max === 'number' ? { state: S.cur(state), max: st.max } : { state: S.cur(state) });
				S.want(s, ['items'], x.items);
				state = slotOf(s, 'state');
				return;
			}
			case 'objective': {
				langCheck(x.index === st.index, S.where, `step ${k}: the index is not echoed`);
				const args = { state: S.cur(state), index: st.index };
				if (st.accuracy !== undefined) args.accuracy = st.accuracy;
				if (st.correct !== undefined) args.correct = st.correct;
				S.call(QF('grammarObjectiveComplete'), args, { complete: x.complete });
				return;
			}
			case 'done':
				S.call(QF('done'), { state: S.cur(state) }, { vocabulary: x.vocabulary, pronunciation: x.pronunciation, grammar: x.grammar });
				S.wantState(state, 'recent', { $ids: x.recent, $key: 'id' });
				return;
		}
		throw new Error(`emit-bridge-cases: ${S.where}: quest-feedback run step ${st.do} has no transcription`);
	});
}

/** core's runner's three language quest types (systems-corpus.ts LANGUAGE_QUEST_TYPES), in its order. */
const LANGUAGE_QUEST_TYPE_IDS = ['language-learning', 'business-scavenger-hunt', 'customer-service'];
const QT = (fn) => `language.questTypes.${fn}`;

function langQuestTypes(S, c) {
	const i = c.input;
	const e = c.expected;
	switch (c.op) {
		case 'select':
			langCheck(e.length === i.worlds.length, S.where, 'one answer per world');
			i.worlds.forEach((world, k) => {
				echoes(S, e[k], { world }, ['world']);
				langCheck(JSON.stringify(Object.keys(e[k])) === JSON.stringify(['world', 'types']), S.where, `world ${k}: the answer is not the world and its types`);
				S.call(QT('forWorld'), { world }, { types: e[k].types });
			});
			return;
		case 'table':
			langCheck(JSON.stringify(e.map((x) => x.id)) === JSON.stringify(LANGUAGE_QUEST_TYPE_IDS), S.where, "the table is not the runner's three language quest types");
			for (const x of e) {
				const definition = sub({
					id: x.id,
					name: x.name,
					questCategories: { $ids: x.categories, $key: 'id' },
					objectiveTypes: { $ids: x.objectives, $key: 'id' },
					rewardTypes: x.rewardTypes,
					difficultyScaling: x.difficultyScaling,
				});
				S.call(QT('definition'), { id: x.id }, { definition });
			}
			return;
		case 'complete':
			langCheck(e.length === i.checks.length, S.where, 'one answer per check');
			i.checks.forEach((ch, k) => {
				echoes(S, e[k], ch, ['questType', 'objective', 'progress']);
				S.call(QT('objectiveComplete'), { questType: ch.questType, objective: ch.objective, progress: ch.progress }, { complete: e[k].complete });
			});
			return;
		case 'map':
			S.call('language.contract', {}, sub({ languageObjectiveTypeMap: e.objectives, languageRewardTypeMap: e.rewards }));
			return;
		case 'templates': {
			// The runner's order: a difficulty when a string, else a category when a string, else every template.
			const [call, args] = typeof i.difficulty === 'string'
				? [QT('templatesByDifficulty'), { difficulty: i.difficulty }]
				: typeof i.category === 'string' ? [QT('templatesByCategory'), { category: i.category }] : [QT('templates'), {}];
			const templates = e.map((t) => sub({
				id: t.id,
				category: t.category,
				difficulty: t.difficulty,
				objectiveTemplates: t.objectives.map((o) => sub({ type: o.type, requiredCount: o.requiredCount })),
				rewardScale: t.rewardScale,
				parameters: { $ids: t.parameters, $key: 'name' },
			}));
			S.call(call, args, { templates });
			return;
		}
	}
	throw new Error(`emit-bridge-cases: ${S.where}: quest-types op ${c.op} has no transcription`);
}

const LANGUAGE_TRANSCRIBERS = {
	progress: langProgress,
	save: langSave,
	prompts: langPrompts,
	hover: langHover,
	chat: langChat,
	bank: langBank,
	adaptation: langAdaptation,
	pronunciation: langPronunciation,
	collection: langCollection,
	objects: langObjects,
	writing: langWriting,
	'quest-feedback': langQuestFeedback,
	'quest-types': langQuestTypes,
};

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

// ── genre systems: conformance/{puzzle,platformer,strategy}/ (src/genre-systems/systems-corpus.ts, runGenreSystemsOp) ──
// PL.native-genre-rows slices 1 (the puzzle), 2 (the platformer) and 3 (the strategy game). Each case is its op composed from the rows as core's runner
// composes core's functions. A `world` input goes through genre.world.of (core's worldOf) over
// the committed slices, which every case names by `$file` (the vendored slice beside these
// cases) instead of copying 181 KB into each one. The runner's steps are `{ step, ...outcome }`;
// each is the matching director row's answer, stated exactly. A run reaches core's
// PuzzleDirector over a KB (module activation's puzzle pack on the native Prolog seam), which
// the JS leg does not have, so those cases are C-only; everything else runs on both legs. A
// platformer run likewise reaches core's PlatformerDirector over a KB; its `step` answers are
// the row's (`{ outcome, probed, orders }`), whose outcome is core's StepOutcome with the whole
// TraversalReport as `movement`, where core's runner shows only movementView of it
// ({ performed, refusal?, mode, link, cost, location }): that step's outcome is stated exactly
// but for `movement`, which is held as a subset (performed, refusal, cost, location, and the
// affordance's mode and id), and the guard in vendor-core-bundle.mjs reads the view back. A
// strategy run reaches core's StrategyDirector over a KB the same way; every answer, the
// turn report's orders included, is stated exactly. A campaign's claimCost and controlled
// ops are one row call per business and per faction, in the input's order.

export const GENRE_CASE_FILES = [
	'puzzle/definition',
	'puzzle/run',
	'puzzle/save',
	'platformer/course',
	'platformer/run',
	'platformer/save',
	'strategy/campaign',
	'strategy/run',
	'strategy/save',
	'genre-pieces/kinds',
	'genre-pieces/build-plan',
];

/** The schema each genre corpus file declares (the genre pieces' two are their own runners'). */
export const GENRE_CASE_SCHEMAS = {
	'genre-pieces/kinds': 'insimul.conformance.genre-pieces/1',
	'genre-pieces/build-plan': 'insimul.conformance.genre-build-plan/1',
};

/** The committed world slices core's runner is handed, as the case reads them: `$file`s beside the case files. */
export const GENRE_SLICES = { thistlecombe: 'conformance/genre-mechanics/thistlecombe.world-slice.json' };
const genreSlicesArg = () => Object.fromEntries(Object.entries(GENRE_SLICES).map(([name, rel]) => [name, { $file: `../${rel}`, $path: 'world' }]));

const GENRE_KB_LEGS = {
	legs: ['c'],
	why: "it drives core's PuzzleDirector over a KB (GamePrologEngine's puzzle pack on the native Prolog seam), which the JS leg does not have",
};
const PLATFORMER_KB_LEGS = {
	legs: ['c'],
	why: "it drives core's PlatformerDirector over a KB (GamePrologEngine's platformer and traversal packs on the native Prolog seam), which the JS leg does not have",
};

/** The director row each puzzle run step calls, and the args it takes from the step (actor `player` unless named). */
const PUZZLE_STEP_ROWS = {
	clue: ['puzzle.director.findClue', [['text', 'text']]],
	answer: ['puzzle.director.answer', [['riddle', 'riddle'], ['given', 'given']]],
	unlock: ['puzzle.director.unlock', [['lock', 'lock']]],
	take: ['puzzle.director.take', [['item', 'item']]],
	view: ['puzzle.director.view', [['riddle', 'riddle']]],
	progress: ['puzzle.director.progress', []],
	complete: ['puzzle.director.isComplete', []],
};
const genreCheck = (ok, where, what) => {
	if (!ok) throw new Error(`emit-bridge-cases: ${where}: ${what}`);
};
const withoutStep = (x) => Object.fromEntries(Object.entries(x).filter(([k]) => k !== 'step'));

/** core's puzzleRun: create (published), restore the read value first when given, the steps, serialize, dispose. */
function puzzleRunSteps(S, input, expected, restoreFrom) {
	const where = S.where;
	const sess = { $ref: 's.session' };
	const steps = [];
	steps.push({ call: 'puzzle.director.create', args: { definition: input.definition, worldFacts: input.worldFacts ?? [] }, expect: { session: { $type: 'number' }, published: expected.published }, bind: 's' });
	const results = expected.steps;
	let k = 0;
	if (restoreFrom) {
		genreCheck(results[0]?.step === 'restore', where, 'a restored run starts with its restore');
		steps.push({ call: 'puzzle.director.restore', args: { session: sess, state: restoreFrom }, expect: withoutStep(results[0]) });
		k = 1;
	}
	const given = input.steps ?? [];
	genreCheck(results.length === given.length + k, where, 'one answer per step');
	given.forEach((st, i) => {
		const x = results[i + k];
		genreCheck(x.step === st.step, where, `step ${i} answers ${x.step}, not ${st.step}`);
		const actor = st.actor === undefined ? 'player' : st.actor;
		if (st.step === 'restore') {
			steps.push({ call: 'puzzle.director.restore', args: { session: sess, state: st.state }, expect: withoutStep(x) });
			return;
		}
		if (st.step === 'state') {
			steps.push({ call: 'puzzle.director.serialize', args: { session: sess }, expect: { state: x.state } });
			return;
		}
		const row = PUZZLE_STEP_ROWS[st.step];
		genreCheck(row !== undefined, where, `puzzle run step ${st.step} has no transcription`);
		const args = { session: sess, actor };
		for (const [from, to] of row[1]) args[to] = st[from];
		const expect = st.step === 'view' ? { view: x.view } : st.step === 'progress' ? { progress: x.progress } : st.step === 'complete' ? { complete: x.complete } : withoutStep(x);
		steps.push({ call: row[0], args, expect });
	});
	steps.push({ call: 'puzzle.director.serialize', args: { session: sess }, expect: { state: expected.state } });
	steps.push({ call: 'session.dispose', args: { session: sess }, expect: { disposed: true } });
	return steps;
}

/** One case of conformance/puzzle/<file>.json as bridge steps, and whether it reaches the KB. */
function puzzleCase(file, c, where) {
	const i = c.input;
	const e = c.expected;
	const S = { where };
	const max = 'maxAttempts' in i ? { maxAttempts: i.maxAttempts } : {};
	const world = () => ({ call: 'genre.world.of', args: { world: i.world, slices: genreSlicesArg() }, bind: 'w' });
	if (file === 'puzzle/definition') {
		if (c.op === 'generate') {
			return [[
				world(),
				{ call: 'puzzle.forWorld', args: { world: { $ref: 'w.world' }, puzzle: i.puzzle ?? null, ...max }, expect: { definition: e.definition }, bind: 'd' },
				{ call: 'puzzle.facts', args: { definition: { $ref: 'd.definition' } }, expect: { facts: e.facts } },
				{ call: 'puzzle.worldFacts', args: { world: { $ref: 'w.world' }, definition: { $ref: 'd.definition' } }, expect: { facts: e.worldFacts } },
				{ call: 'puzzle.answerKey', args: { world: { $ref: 'w.world' }, definition: { $ref: 'd.definition' } }, expect: { answerKey: e.answerKey } },
			], false];
		}
		if (c.op === 'authored') {
			const steps = [{ call: 'puzzle.issues', args: 'puzzle' in i ? { puzzle: i.puzzle } : {}, expect: { issues: e.issues } }];
			if (e.issues.length === 0) steps.push({ call: 'puzzle.fromIR', args: { ...('puzzle' in i ? { puzzle: i.puzzle } : {}), ...max }, expect: { definition: e.definition } });
			else genreCheck(e.definition === null, where, 'a section with issues defines nothing');
			return [steps, false];
		}
		if (c.op === 'choices') {
			const ids = Object.keys(e);
			const steps = [
				world(),
				{ call: 'puzzle.forWorld', args: { world: { $ref: 'w.world' }, puzzle: i.puzzle ?? null }, expect: sub({ definition: sub({ riddles: { $ids: ids, $key: 'id' } }) }), bind: 'd' },
			];
			ids.forEach((id, k) => {
				steps.push({ call: 'puzzle.choices', args: { world: { $ref: 'w.world' }, riddle: { $ref: `d.definition.riddles.${k}` }, count: i.count === undefined ? 4 : i.count }, expect: { choices: e[id] } });
			});
			return [steps, false];
		}
	}
	if (file === 'puzzle/run') {
		genreCheck(c.op === 'run', where, `puzzle run op ${c.op} has no transcription`);
		return [puzzleRunSteps(S, i, e, null), true];
	}
	if (file === 'puzzle/save') {
		if (c.op === 'block') {
			return [[
				{ call: 'puzzle.save.block', args: { state: i.state }, expect: { block: { $type: 'object' } }, bind: 'b' },
				{ call: 'puzzle.save.blockOf', args: { block: { $ref: 'b.block' } }, expect: { block: e } },
			], false];
		}
		const read = { call: 'puzzle.save.read', args: 'block' in i ? { block: i.block } : {} };
		const readOf = (r) => {
			if (!r.ok) return [{ ...read, expect: r }];
			if (r.value === null) return [{ ...read, expect: { ok: true, value: null } }];
			return [
				{ ...read, expect: { ok: true, value: { $type: 'object' } }, bind: 'r' },
				{ call: 'puzzle.save.blockOf', args: { block: { $ref: 'r.value' } }, expect: { block: r.value } },
			];
		};
		if (c.op === 'read') return [readOf(e), false];
		if (c.op === 'restore') {
			const steps = readOf(e.read);
			if (!e.read.ok || e.read.value === null) {
				genreCheck(!('run' in e), where, 'nothing runs without a read block');
				return [steps, false];
			}
			return [[...steps, ...puzzleRunSteps(S, i, e.run, { $ref: 'r.value' })], true];
		}
	}
	throw new Error(`emit-bridge-cases: ${where}: ${file} op ${c.op} has no transcription`);
}

/** A platformer run step's `{ step, ...outcome, movement: movementView, probed }` as the step row's expectation. */
function platformerStepExpect(x) {
	const { step: _step, movement, probed, ...rest } = x;
	const outcome = { ...rest };
	if (movement !== undefined) {
		const { performed, refusal, mode, link, cost, location } = movement;
		outcome.movement = {
			$subset: {
				performed,
				...(refusal !== undefined ? { refusal } : {}),
				...(mode !== undefined ? { affordance: { $subset: { mode, id: link } } } : {}),
				cost,
				location,
			},
		};
	}
	return { outcome, probed, orders: [] };
}

/** The director row each platformer run step calls, and the args it takes from the step (runner `player` unless named). */
const PLATFORMER_STEP_ROWS = {
	enter: ['platformer.director.enter', ['level']],
	step: ['platformer.director.step', ['to']],
	respawn: ['platformer.director.respawn', []],
	hint: ['platformer.director.hint', []],
	unlocked: ['platformer.director.isUnlocked', ['level']],
	progress: ['platformer.director.progress', []],
};

/** core's platformerRun: create over the course with the host's probe (published), restore the read value first when given, the steps, serialize, dispose. */
function platformerRunSteps(S, input, expected, restoreFrom) {
	const where = S.where;
	const sess = { $ref: 's.session' };
	const probe = Object.fromEntries((input.impassable ?? []).map((link) => [link, false]));
	const steps = [{ call: 'platformer.director.create', args: { course: input.course, probe }, expect: { session: { $type: 'number' }, published: expected.published }, bind: 's' }];
	const results = expected.steps;
	let k = 0;
	if (restoreFrom) {
		genreCheck(results[0]?.step === 'restore', where, 'a restored run starts with its restore');
		steps.push({ call: 'platformer.director.restore', args: { session: sess, state: restoreFrom }, expect: withoutStep(results[0]) });
		k = 1;
	}
	const given = input.steps ?? [];
	genreCheck(results.length === given.length + k, where, 'one answer per step');
	given.forEach((st, i) => {
		const x = results[i + k];
		genreCheck(x.step === st.step, where, `step ${i} answers ${x.step}, not ${st.step}`);
		if (st.step === 'restore') {
			steps.push({ call: 'platformer.director.restore', args: { session: sess, state: st.state }, expect: withoutStep(x) });
			return;
		}
		if (st.step === 'state') {
			steps.push({ call: 'platformer.director.serialize', args: { session: sess }, expect: { state: x.state } });
			return;
		}
		const row = PLATFORMER_STEP_ROWS[st.step];
		genreCheck(row !== undefined, where, `platformer run step ${st.step} has no transcription`);
		const args = { session: sess, runner: st.runner === undefined ? 'player' : st.runner };
		for (const key of row[1]) args[key] = st[key];
		const expect =
			st.step === 'step' ? platformerStepExpect(x)
			: st.step === 'hint' ? { route: x.route }
			: st.step === 'unlocked' ? { unlocked: x.unlocked }
			: st.step === 'progress' ? { progress: x.progress }
			: withoutStep(x);
		steps.push({ call: row[0], args, expect });
	});
	steps.push({ call: 'platformer.director.serialize', args: { session: sess }, expect: { state: expected.state } });
	steps.push({ call: 'session.dispose', args: { session: sess }, expect: { disposed: true } });
	return steps;
}

/** One case of conformance/platformer/<file>.json as bridge steps, and whether it reaches the KB. */
function platformerCase(file, c, where) {
	const i = c.input;
	const e = c.expected;
	const S = { where };
	if (file === 'platformer/course') {
		if (c.op === 'generate') {
			return [[
				{ call: 'genre.world.of', args: { world: i.world, slices: genreSlicesArg() }, bind: 'w' },
				{
					call: 'platformer.forWorld',
					args: { world: { $ref: 'w.world' }, platformer: i.platformer ?? null, traversal: i.traversal ?? null, ...('levelCount' in i ? { levelCount: i.levelCount } : {}) },
					expect: { course: e.course },
					bind: 'c',
				},
				{ call: 'platformer.levelFacts', args: { course: { $ref: 'c.course' } }, expect: { facts: e.levelFacts } },
			], false];
		}
		if (c.op === 'route') {
			return [[{ call: 'platformer.route', args: { links: i.links, from: i.from, to: i.to, ...('modes' in i ? { modes: i.modes } : {}) }, expect: { route: e } }], false];
		}
		if (c.op === 'stars') {
			genreCheck(i.runs.length === e.length, where, 'one star count per run');
			return [i.runs.map(([par, cost], k) => ({ call: 'platformer.stars', args: { par, cost }, expect: { stars: e[k] } })), false];
		}
	}
	if (file === 'platformer/run') {
		genreCheck(c.op === 'run', where, `platformer run op ${c.op} has no transcription`);
		return [platformerRunSteps(S, i, e, null), true];
	}
	if (file === 'platformer/save') {
		if (c.op === 'block') {
			return [[
				{ call: 'platformer.save.block', args: { state: i.state }, expect: { block: { $type: 'object' } }, bind: 'b' },
				{ call: 'platformer.save.blockOf', args: { block: { $ref: 'b.block' } }, expect: { block: e } },
			], false];
		}
		const read = { call: 'platformer.save.read', args: 'block' in i ? { block: i.block } : {} };
		const readOf = (r) => {
			if (!r.ok) return [{ ...read, expect: r }];
			if (r.value === null) return [{ ...read, expect: { ok: true, value: null } }];
			return [
				{ ...read, expect: { ok: true, value: { $type: 'object' } }, bind: 'r' },
				{ call: 'platformer.save.blockOf', args: { block: { $ref: 'r.value' } }, expect: { block: r.value } },
			];
		};
		if (c.op === 'read') return [readOf(e), false];
		if (c.op === 'restore') {
			const steps = readOf(e.read);
			if (!e.read.ok || e.read.value === null) {
				genreCheck(!('run' in e), where, 'nothing runs without a read block');
				return [steps, false];
			}
			return [[...steps, ...platformerRunSteps(S, i, e.run, { $ref: 'r.value' })], true];
		}
	}
	throw new Error(`emit-bridge-cases: ${where}: ${file} op ${c.op} has no transcription`);
}

// ── the strategy game (slice 3): conformance/strategy/ ──
const STRATEGY_KB_LEGS = {
	legs: ['c'],
	why: "it drives core's StrategyDirector over a KB (GamePrologEngine's strategy pack on the native Prolog seam), which the JS leg does not have",
};

/** The director row each strategy run step calls, the args it takes from the step (faction the campaign's player unless named), and the expectation it states. */
const STRATEGY_STEP_ROWS = {
	start: ['strategy.director.start', [], (x) => withoutStep(x)],
	claim: ['strategy.director.claim', ['faction', 'business'], (x) => withoutStep(x)],
	assign: ['strategy.director.assign', ['faction', 'worker', 'business'], (x) => withoutStep(x)],
	release: ['strategy.director.release', ['faction', 'worker'], (x) => withoutStep(x)],
	endTurn: ['strategy.director.endTurn', [], (x) => withoutStep(x)],
	stockpile: ['strategy.director.stockpile', ['faction'], (x) => ({ stockpile: x.stockpile })],
	holder: ['strategy.director.holderOf', ['business'], (x) => ({ holder: x.holder })],
	controls: ['strategy.director.controls', ['faction'], (x) => ({ settlements: x.controls })],
	victory: ['strategy.director.victory', ['faction'], (x) => ({ victory: x.victory })],
	progress: ['strategy.director.progress', ['faction'], (x) => ({ progress: x.progress })],
};

/** core's strategyRun: create over the campaign and its world facts, restore the read value first when given, the steps, serialize, dispose. */
function strategyRunSteps(S, input, expected, restoreFrom) {
	const where = S.where;
	const sess = { $ref: 's.session' };
	const steps = [{ call: 'strategy.director.create', args: { campaign: input.campaign, worldFacts: input.worldFacts ?? [] }, expect: { session: { $type: 'number' } }, bind: 's' }];
	const results = expected.steps;
	let k = 0;
	if (restoreFrom) {
		genreCheck(results[0]?.step === 'restore', where, 'a restored run starts with its restore');
		steps.push({ call: 'strategy.director.restore', args: { session: sess, state: restoreFrom }, expect: withoutStep(results[0]) });
		k = 1;
	}
	const given = input.steps ?? [];
	genreCheck(results.length === given.length + k, where, 'one answer per step');
	given.forEach((st, i) => {
		const x = results[i + k];
		genreCheck(x.step === st.step, where, `step ${i} answers ${x.step}, not ${st.step}`);
		if (st.step === 'restore') {
			steps.push({ call: 'strategy.director.restore', args: { session: sess, state: st.state }, expect: withoutStep(x) });
			return;
		}
		if (st.step === 'state') {
			steps.push({ call: 'strategy.director.serialize', args: { session: sess }, expect: { state: x.state } });
			return;
		}
		const row = STRATEGY_STEP_ROWS[st.step];
		genreCheck(row !== undefined, where, `strategy run step ${st.step} has no transcription`);
		const args = { session: sess };
		for (const key of row[1]) args[key] = key === 'faction' ? (st.faction === undefined ? input.campaign.playerFaction : st.faction) : st[key];
		steps.push({ call: row[0], args, expect: row[2](x) });
	});
	steps.push({ call: 'strategy.director.serialize', args: { session: sess }, expect: { state: expected.state } });
	steps.push({ call: 'session.dispose', args: { session: sess }, expect: { disposed: true } });
	return steps;
}

/** One case of conformance/strategy/<file>.json as bridge steps, and whether it reaches the KB. */
function strategyCase(file, c, where) {
	const i = c.input;
	const e = c.expected;
	const S = { where };
	const world = () => ({ call: 'genre.world.of', args: { world: i.world, slices: genreSlicesArg() }, bind: 'w' });
	const board = i.board ?? { holders: {}, workers: {} };
	if (file === 'strategy/campaign') {
		if (c.op === 'generate') {
			return [[
				world(),
				{ call: 'strategy.forWorld', args: { world: { $ref: 'w.world' }, strategy: i.strategy ?? null, tuning: i.tuning ?? null }, expect: { campaign: e.campaign }, bind: 'c' },
				{ call: 'strategy.facts', args: { campaign: { $ref: 'c.campaign' } }, expect: { facts: e.facts } },
				{ call: 'strategy.worldFacts', args: { world: { $ref: 'w.world' } }, expect: { facts: e.worldFacts } },
			], false];
		}
		if (c.op === 'adjacency') return [[world(), { call: 'strategy.adjacency', args: { world: { $ref: 'w.world' } }, expect: { adjacency: e } }], false];
		if (c.op === 'books') return [[{ call: 'strategy.books', args: { campaign: i.campaign, board }, expect: { books: e } }], false];
		if (c.op === 'claimCost') {
			genreCheck(new Set(i.businesses).size === i.businesses.length && i.businesses.length === Object.keys(e).length, where, 'one price per business');
			return [i.businesses.map((business) => ({ call: 'strategy.claimCost', args: { campaign: i.campaign, business }, expect: { cost: e[business] } })), false];
		}
		if (c.op === 'controlled') {
			const factions = i.campaign.factions;
			genreCheck(factions.length === Object.keys(e).length, where, 'one answer per faction');
			return [factions.map((faction) => ({ call: 'strategy.controlled', args: { campaign: i.campaign, board, faction }, expect: { settlements: e[faction] } })), false];
		}
	}
	if (file === 'strategy/run') {
		genreCheck(c.op === 'run', where, `strategy run op ${c.op} has no transcription`);
		return [strategyRunSteps(S, i, e, null), true];
	}
	if (file === 'strategy/save') {
		if (c.op === 'block') {
			return [[
				{ call: 'strategy.save.block', args: { state: i.state }, expect: { block: { $type: 'object' } }, bind: 'b' },
				{ call: 'strategy.save.blockOf', args: { block: { $ref: 'b.block' } }, expect: { block: e } },
			], false];
		}
		const read = { call: 'strategy.save.read', args: 'block' in i ? { block: i.block } : {} };
		const readOf = (r) => {
			if (!r.ok) return [{ ...read, expect: r }];
			if (r.value === null) return [{ ...read, expect: { ok: true, value: null } }];
			return [
				{ ...read, expect: { ok: true, value: { $type: 'object' } }, bind: 'r' },
				{ call: 'strategy.save.blockOf', args: { block: { $ref: 'r.value' } }, expect: { block: r.value } },
			];
		};
		if (c.op === 'read') return [readOf(e), false];
		if (c.op === 'restore') {
			const steps = readOf(e.read);
			if (!e.read.ok || e.read.value === null) {
				genreCheck(!('run' in e), where, 'nothing runs without a read block');
				return [steps, false];
			}
			return [[...steps, ...strategyRunSteps(S, i, e.run, { $ref: 'r.value' })], true];
		}
	}
	throw new Error(`emit-bridge-cases: ${where}: ${file} op ${c.op} has no transcription`);
}


// ── the genre pieces (slice 4): conformance/genre-pieces/ ──
// Every op is one row call (core's runners, src/editor/binding/genre-pieces-corpus.ts and
// src/genre-systems/build-plan-corpus.ts), each input member passed when the input has it, except
// `write`: the ground plan over `world ?? {}`, then the writer, whose world's `entities` must hold
// the corpus's genrePieces and genreGround. None reaches the KB. A build-plan input's
// `{"$fixture": name}` is the file's fixture: here a `$file` naming it in the vendored corpus.

/** `{ $file, $path }` naming build-plan.json's fixture `name`. */
export const genreFixtureRef = (name) => ({ $file: '../conformance/genre-pieces/build-plan.json', $path: `fixtures.${name}` });

/** A build-plan input with each fixture named by `$file` (core's fixtures do not name one another). */
export function genreFixtureArgs(value, fixtures, where) {
	if (Array.isArray(value)) return value.map((v) => genreFixtureArgs(v, fixtures, where));
	if (value !== null && typeof value === 'object') {
		const keys = Object.keys(value);
		if (keys.length === 1 && keys[0] === '$fixture') {
			genreCheck(Object.prototype.hasOwnProperty.call(fixtures ?? {}, value.$fixture), where, `unknown fixture ${value.$fixture}`);
			genreCheck(!JSON.stringify(fixtures[value.$fixture]).includes('"$fixture"'), where, `fixture ${value.$fixture} names another`);
			return genreFixtureRef(value.$fixture);
		}
		return Object.fromEntries(keys.map((k) => [k, genreFixtureArgs(value[k], fixtures, where)]));
	}
	return value;
}

/** `input`'s own `keys`, in that order (core's runner passes `input.<key>`; an absent key stays absent). */
export const genrePick = (input, keys) => Object.fromEntries(keys.filter((k) => Object.prototype.hasOwnProperty.call(input, k)).map((k) => [k, input[k]]));

/** The row, args and expectation of a single-call genre-pieces op (null: write, which takes two). */
export function genrePiecesCall(file, op, input, expected) {
	const D = ['course', 'puzzle', 'campaign'];
	if (file === 'genre-pieces/kinds') {
		if (op === 'kinds') return ['genrePieces.kinds', genrePick(input, ['genre']), expected];
		if (op === 'key') return ['genrePieces.key', genrePick(input, ['genre', 'kind', 'variant']), expected];
		if (op === 'pieces') return ['genrePieces.for', genrePick(input, ['genre', ...D]), expected];
		if (op === 'collect') return ['genrePieces.collect', genrePick(input, ['genrePieces']), { entities: expected }];
		if (op === 'stamp') return ['genrePieces.stamp', genrePick(input, ['genrePieces']), expected];
	}
	if (file === 'genre-pieces/build-plan') {
		if (op === 'anchors') return ['genrePieces.anchors', genrePick(input, ['world', 'course', 'puzzle']), { anchors: expected }];
		if (op === 'place') return ['genrePieces.place', genrePick(input, ['genre', 'pieces', 'anchors']), expected];
		if (op === 'plan') return ['genrePieces.plan', genrePick(input, ['genre', 'world', ...D]), expected];
		if (op === 'settle') return ['genrePieces.settleOffset', { n: input.n }, { offset: expected }];
		if (op === 'ground') return ['genrePieces.ground', genrePick(input, ['genre', 'world', ...D]), expected];
		if (op === 'write') return null;
	}
	throw new Error(`emit-bridge-cases: ${file} op ${op} has no transcription`);
}

/** The two calls of a write case: the grounded plan over `world ?? {}`, then the writer (none when the plan is refused). */
export function genreWriteCalls(input, expected) {
	const world = input.world ?? {};
	const ground = { call: 'genrePieces.ground', args: { ...genrePick(input, ['genre', 'course', 'puzzle', 'campaign']), world } };
	if ('refused' in expected) return [{ ...ground, expect: expected }];
	return [
		{ ...ground, expect: { $type: 'object' }, bind: 'g' },
		{
			call: 'genrePieces.write',
			args: { world, plan: { $ref: 'g' } },
			expect: { world: { $subset: { entities: { $subset: { genrePieces: expected.genrePieces, genreGround: expected.genreGround } } } } },
		},
	];
}

/** One case of conformance/genre-pieces/<file>.json as bridge steps (never reaching the KB). */
function genrePiecesCase(file, c, where, doc) {
	const input = file === 'genre-pieces/build-plan' ? genreFixtureArgs(c.input, doc.fixtures, where) : c.input;
	const one = genrePiecesCall(file, c.op, input, c.expected);
	if (one) return [[{ call: one[0], args: one[1], expect: one[2] }], false];
	genreCheck(
		'refused' in c.expected || (Object.keys(c.expected).sort().join() === 'genreGround,genrePieces'),
		where,
		'a write answers its refusal, or exactly genrePieces and genreGround',
	);
	return [genreWriteCalls(input, c.expected), false];
}

/** Each genre's transcription and the legs a case that reaches the KB runs on. */
const GENRE_TRANSCRIPTIONS = {
	puzzle: [(...a) => puzzleCase(...a), GENRE_KB_LEGS],
	platformer: [(...a) => platformerCase(...a), PLATFORMER_KB_LEGS],
	strategy: [(...a) => strategyCase(...a), STRATEGY_KB_LEGS],
	'genre-pieces': [(...a) => genrePiecesCase(...a), null],
};

/** One case file per genre corpus file: `core-genre-<genre>-<file>.json`. */
function genreSystems(root, coreCommit) {
	const out = {};
	for (const file of GENRE_CASE_FILES) {
		const r = reader(root);
		const doc = r.json(`conformance/${file}.json`);
		for (const rel of Object.values(GENRE_SLICES)) r.json(rel);
		if (doc.schema !== (GENRE_CASE_SCHEMAS[file] ?? 'insimul.conformance.genre-systems/1') || doc.file !== file) throw new Error(`emit-bridge-cases: conformance/${file}.json is not core's ${file} corpus`);
		const cases = doc.cases.map((c) => {
			const name = `${file} ${c.op}: ${c.name}`;
			const [transcribe, kbLegs] = GENRE_TRANSCRIPTIONS[file.split('/')[0]];
			const [steps, kb] = transcribe(file, c, name, doc);
			return { name, ...(kb ? kbLegs : {}), steps };
		});
		out[`core-genre-${file.replace('/', '-')}.json`] = caseFile(
			`genre-${file.replace('/', '-')}`,
			file.startsWith('genre-pieces/')
				? `core's genre pieces corpus conformance/${file}.json (P9j.core-asset-kinds, P9j.core-build-plan) through the genrePieces.* rows, each op as ` +
					`core's reference runner (${file === 'genre-pieces/kinds' ? 'src/editor/binding/genre-pieces-corpus.ts, runGenrePiecesOp' : 'src/genre-systems/build-plan-corpus.ts, runGenreBuildPlanOp'}) composes it.`
				: `core's genre systems corpus conformance/${file}.json (P9j.core) through the genre.world.of and ${file.split('/')[0]}.* rows, each op as ` +
					"core's reference runner (src/genre-systems/systems-corpus.ts, runGenreSystemsOp) composes it.",
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
		'core-villagers-pass-by.json': passBy(root, coreCommit),
		'core-props-vehicle-placement.json': vehiclePlacement(root, coreCommit),
		'core-quests.json': quests(root, coreCommit),
		'core-ui-pause-menu.json': pauseMenu(root, coreCommit),
		'core-ui-quest-journal.json': questJournal(root, coreCommit),
		'core-ui-save-slots.json': saveSlots(root, coreCommit),
		'core-ui-loading.json': loading(root, coreCommit),
		'core-ui-trade.json': trade(root, coreCommit),
		'core-weather-progression.json': weather(root, coreCommit),
		...genres(root, coreCommit),
		...language(root, coreCommit),
		...genreSystems(root, coreCommit),
	};
}
