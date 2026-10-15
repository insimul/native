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
	return caseFile('ui-save-slots', "core's save/load slot matrix through ui.saveSlots", coreCommit, r.files, cases);
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
	out['core-modules-activation.json'] = caseFile(
		'modules-activation',
		"core's committed activation table through modules.table, and each genre's row through modules.activate",
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
					{
						call: 'modules.activate',
						args: { ir: { meta: { genreConfig: { id: genre } } } },
						expect: sub({ source: 'worldIr', active: row }),
					},
				],
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

/** Every generated case file, keyed by file name. */
export function emitBridgeCases(root, coreCommit) {
	return {
		'core-saves.json': saves(root, coreCommit),
		'core-quests.json': quests(root, coreCommit),
		'core-ui-pause-menu.json': pauseMenu(root, coreCommit),
		'core-ui-quest-journal.json': questJournal(root, coreCommit),
		'core-ui-save-slots.json': saveSlots(root, coreCommit),
		'core-ui-loading.json': loading(root, coreCommit),
		'core-ui-trade.json': trade(root, coreCommit),
		'core-weather-progression.json': weather(root, coreCommit),
		...genres(root, coreCommit),
	};
}
