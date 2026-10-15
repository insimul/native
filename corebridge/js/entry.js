// entry.js — the bundle entry point: the ONLY place that says which of
// `@insimul/core`'s functions this library exposes across the C ABI.
//
// Adding a method here is what "adopting more of core" means. The method table
// is deliberately explicit: `insimul_core_call()` cannot reach arbitrary core
// internals, so the adopted surface is reviewable in one file. README.md
// ("The method table") documents every row; tests/corebridge_cases.* fail when
// the table and that document disagree, or when a row has no case.
//
// Contract with the C host (../src/insimulcore.c):
//   `globalThis.__insimul_core_dispatch(method, argsJson) -> Promise<any>`
// The host JSON.stringifies whatever the promise fulfils with, and turns a
// rejection into `insimul_core_last_error()`.
//
// THE ROWS DECIDE NOTHING. Every rule a row answers is core's and is imported,
// never restated. What a row does is the boundary's work only: JSON in (a Map
// or a callback core takes is built from plain data), argument checks for the
// enumerations core's TypeScript types declare but JSON cannot, and the model's
// view out. Where a row does more than that it says so in its comment.

// FIRST, and in this order: polyfills core needs at MODULE SCOPE. esbuild emits
// modules in import order. `identity/kinp.ts` constructs a TextEncoder when it
// loads; core logs through `console` from functions these rows call.
import './host-text-codec.js';
import { clearDiagnostics, diagnostics } from './host-console.js';

import { applyOps, disposeSession, listSessions, openSession, session } from './host-sessions.js';

import { generateRadiantQuests } from '@insimul/core/radiant/radiant-engine';
import { BASE_RADIANT_TEMPLATES, BASE_RADIANT_TEMPLATE_IDS } from '@insimul/core/radiant/base-templates';
// The quest-golden manifest is core's declared authority for the SHAPE the
// quest corpus is compared in. NOT an adopted runtime surface: `quest.hydrate`
// and `quest.radiantTick` exist for the engines' parity gates
// (RUNTIME_CORE_ADOPTION.md §10).
import { computeHydrationExpected, radiantTick } from '@insimul/core-scripts/quest-golden-manifest';

// ── saves ─────────────────────────────────────────────────────────────────────
import {
	SAVE_FILE_VERSION,
	isMigrationOutcomeSignificant,
	migrateSaveFileWithOutcome,
} from '@insimul/core/save-file';
import { listMigrations } from '@insimul/core/save-file-migrations';
import { extensionRegistry, isRegisteredExtension } from '@insimul/core/save-extensions';
import {
	SAVE_ENVELOPE_FORMAT,
	buildSaveFileEnvelope,
	computeSaveFileIntegrity,
	validateSaveFileEnvelope,
} from '@insimul/core/save-envelope';

// ── in-game UI view-models ────────────────────────────────────────────────────
import { KIND_COLOR, Notifications } from '@insimul/core/ui/notifications';
import { PauseMenuModel } from '@insimul/core/ui/pause-menu-model';
import { QuestJournalModel } from '@insimul/core/ui/quest-journal-model';
import { SLOT_MESSAGES, SaveSlotModel } from '@insimul/core/ui/save-slot-model';
import { LoadingScreenModel } from '@insimul/core/ui/loading-screen-model';
import { TradeModel } from '@insimul/core/ui/trade-model';

// ── quests: completion, markers, waypoints ────────────────────────────────────
import { QuestCompletionEngine } from '@insimul/core/game-engine/logic/QuestCompletionEngine';
import {
	MARKER_STYLES,
	hasActiveQuest,
	selectLocationMarker,
	selectNpcMarker,
} from '@insimul/core/game-engine/logic/QuestMarkerService';
import { extractObjectiveMarkers } from '@insimul/core/game-engine/logic/QuestMinimapMarkers';
import { DynamicQuestWaypointDirector } from '@insimul/core/game-engine/logic/DynamicQuestWaypointDirector';

// ── world: clock and weather ──────────────────────────────────────────────────
import { GameTimeManager } from '@insimul/core/game-engine/logic/GameTimeManager';
import { WeatherDirector } from '@insimul/core/game-engine/logic/WeatherDirector';
import {
	climateFromIR,
	initialWeatherState,
	runWeather,
	weatherIssues,
	weatherTuningFromIR,
	weatherView,
} from '@insimul/core/weather/weather';
import { weatherClimateFacts, weatherDelta } from '@insimul/core/weather/weather-facts';

// ── genre and module activation ───────────────────────────────────────────────
import { CAMERA_MODES, DEFAULT_GENRE_ID, GENRE_IDS, getAllGenres } from '@insimul/core/game-genres/registry';
import { RECIPE_GENRE_BINDINGS, RECIPE_IDS } from '@insimul/core/game-genres/recipes';
import { normalizeCameraMode, resolveGameGenre, resolveGenre } from '@insimul/core/game-genres/resolution';
import {
	activeModulesForWorld,
	moduleActivationTable,
	resolveActiveModules,
} from '@insimul/core/modules/module-activation';
import { PREDICATE_PACK_AREAS, PREDICATE_PACKS } from '@insimul/core/prolog/predicate-packs';

// ── boundary helpers ──────────────────────────────────────────────────────────

/** A caller error, named after the row it was made against. */
function refuse(method, message) {
	return new Error(`insimulcore: ${method}: ${message}`);
}

function needObject(method, value, name) {
	if (value === null || typeof value !== 'object' || Array.isArray(value)) {
		throw refuse(method, `\`${name}\` must be a JSON object`);
	}
	return value;
}

function needArray(method, value, name) {
	if (!Array.isArray(value)) throw refuse(method, `\`${name}\` must be an array`);
	return value;
}

function needString(method, value, name) {
	if (typeof value !== 'string') throw refuse(method, `\`${name}\` must be a string`);
	return value;
}

function needNumber(method, value, name) {
	if (typeof value !== 'number' || !Number.isFinite(value)) throw refuse(method, `\`${name}\` must be a finite number`);
	return value;
}

function optNumber(method, value, name) {
	return value === undefined || value === null ? undefined : needNumber(method, value, name);
}

function oneOf(method, value, allowed, name) {
	if (!allowed.includes(value)) {
		throw refuse(method, `\`${name}\` must be one of ${allowed.join(', ')} (got ${JSON.stringify(value)})`);
	}
	return value;
}

/** A JSON object as the Map core takes, keys in the object's own order. */
function mapOf(method, value, name) {
	if (value === undefined || value === null) return new Map();
	return new Map(Object.entries(needObject(method, value, name)));
}

/** Plain-JSON copy of a model's answer (drops undefined, freezes nothing). */
function plain(value) {
	return value === undefined ? null : JSON.parse(JSON.stringify(value));
}

// ── saves ─────────────────────────────────────────────────────────────────────

/**
 * Core's migration chain plus its outcome. ONE thing is added to core's answer:
 * `migrateSaveFileWithOutcome` declares `orphanExtensionKeys` but leaves it
 * empty ("populated by the extensions contract in sibling stories"), so the row
 * fills it with the extension keys core's own `isRegisteredExtension` refuses,
 * and recomputes `significant` with core's `isMigrationOutcomeSignificant`.
 */
function migrateWithOutcome(saveFile) {
	const { save, outcome } = migrateSaveFileWithOutcome(saveFile);
	const extensions = save && save.currentState && save.currentState.extensions;
	const orphans = new Set(outcome.orphanExtensionKeys);
	if (extensions && typeof extensions === 'object') {
		for (const key of Object.keys(extensions)) if (!isRegisteredExtension(key)) orphans.add(key);
	}
	const filled = { ...outcome, orphanExtensionKeys: [...orphans].sort() };
	return { saveFile: save, outcome: filled, significant: isMigrationOutcomeSignificant(filled) };
}

// ── quests ────────────────────────────────────────────────────────────────────

const QUEST_STATUSES = ['available', 'active', 'completed'];
const QUEST_FILTERS = ['all', 'active', 'completed', 'available'];

function questEntry(method, entry) {
	needObject(method, entry, 'quest');
	needString(method, entry.id, 'quest.id');
	oneOf(method, entry.status, QUEST_STATUSES, 'quest.status');
	return entry;
}

function journalView(model) {
	return {
		filter: model.currentFilter(),
		filtered: model.filtered(),
		counts: model.counts(),
		tracked: model.trackedQuests(),
		maxTracked: model.maxTracked,
	};
}

function completionView(engine) {
	return {
		quests: engine.getQuests().map((quest) => ({
			id: quest.id,
			complete: engine.isQuestComplete(quest.id),
			available: engine.getAvailableObjectives(quest.id).map((o) => o.id),
			locked: engine.getLockedObjectives(quest.id).map((o) => o.id),
			objectives: plain(quest.objectives ?? []),
		})),
		objectiveStates: plain(engine.serializeObjectiveStates()),
	};
}

// ── world ─────────────────────────────────────────────────────────────────────

function clockView(clock) {
	return {
		state: clock.getState(),
		timeOfDay: clock.timeOfDay,
		fractionalHour: clock.fractionalHour,
		timeString: clock.timeString,
		isDaytime: clock.isDaytime,
		realSecondsPerGameHour: clock.realSecondsPerGameHour,
	};
}

/**
 * The KB a weather session writes to. `WeatherDirector` decides which facts
 * move and writes them through `assertFact`/`retractFact`; the game's KB lives
 * on the host's side of the ABI (libinsimul, opened by the engine), so the
 * session RECORDS each write in order and the row hands them over to be applied
 * there verbatim. Reading back (`readState`) is not offered: the host's KB is
 * the one to read.
 */
function recordingKb(writes) {
	return {
		assertFact: async (fact) => {
			writes.push({ op: 'assert', fact });
		},
		retractFact: async (fact) => {
			writes.push({ op: 'retract', fact });
		},
		query: async () => {
			throw new Error('insimulcore: a weather session has no KB to query — query the host KB');
		},
	};
}

function weatherSessionView(director) {
	return { state: director.serialize(), view: plain(director.view()), issues: director.issues() };
}

/**
 * One corpus step, exactly as core's `scripts/emit-weather-progression-corpus.ts`
 * derives it: the run from `from` (day -1 with no sky when null) through
 * `throughDay`, each day's derived view, and the fact delta from the day before
 * (from `from` itself on the first day — `null` for a fresh world).
 */
function weatherRunSteps(climate, seed, from, throughDay) {
	const start = from ?? { ...initialWeatherState(), day: -1 };
	const run = runWeather(start, climate, seed, throughDay);
	const steps = [];
	let previous = from;
	for (const state of run) {
		const view = weatherView(state, climate);
		steps.push({
			day: state.day,
			season: state.season,
			condition: state.condition,
			dayOfSeason: view.dayOfSeason,
			severity: view.severity,
			harsh: view.harsh,
			barred: [...view.barred],
			delta: weatherDelta(previous, state),
		});
		previous = state;
	}
	return { steps, final: run.length > 0 ? run[run.length - 1] : start };
}

function climateOf(method, args) {
	if (args.climate !== undefined && args.climate !== null) return needObject(method, args.climate, 'climate');
	const ir = args.weather === undefined ? null : args.weather;
	if (ir !== null) needObject(method, ir, 'weather');
	if (args.tuning !== undefined && args.tuning !== null) {
		needObject(method, args.tuning, 'tuning');
		return climateFromIR(ir, { ...weatherTuningFromIR(ir), ...args.tuning });
	}
	return climateFromIR(ir);
}

// ── module activation (the rows Godot's fork proved, same semantics) ─────────

function activated(source, set) {
	return {
		source,
		active: set,
		predicatePacks: [...set.predicatePacks],
		hostInterfaces: [...set.hostInterfaces],
		reason: set.known ? '' : `core has no genre bundle "${set.genre}" — shared vocabulary only`,
	};
}

function undeclared(reason) {
	return { source: 'undeclared', active: null, predicatePacks: [...PREDICATE_PACK_AREAS], hostInterfaces: [], reason };
}

// ── the method table ──────────────────────────────────────────────────────────

/** The adopted surface. One entry per method name callable from the host. */
const METHODS = {
	// ── introspection ───────────────────────────────────────────────────────────

	/** `core.methods` — the method table, sorted; lets a gate assert the surface. */
	'core.methods': () => ({ methods: Object.keys(METHODS).sort() }),

	/**
	 * `core.diagnostics` — what core logged (console.*) during the PREVIOUS call
	 * on this handle. Nothing in this library prints; see js/host-console.js.
	 * result: `{ lines: [{ level, text }], dropped }`
	 */
	'core.diagnostics': () => diagnostics(),

	// ── sessions (js/host-sessions.js) ──────────────────────────────────────────

	/** `session.list` → `{ sessions: [{ session, kind }] }` */
	'session.list': () => ({ sessions: listSessions() }),

	/** `session.dispose { session }` → `{ disposed }` (false when none was open) */
	'session.dispose': (args) => ({ disposed: disposeSession(args.session) }),

	// ── radiant and quest parity (unchanged) ────────────────────────────────────

	/** `radiant.generate { kb, options: { seed, now, maxQuests? } }` → `{ quests }` */
	'radiant.generate': (args) => generateRadiantQuests(args.kb, args.options),

	/** `radiant.baseTemplates` → `{ templates, templateIds }` */
	'radiant.baseTemplates': () => ({
		templates: BASE_RADIANT_TEMPLATES,
		templateIds: BASE_RADIANT_TEMPLATE_IDS,
	}),

	/** `quest.hydrate { content, status? }` → `{ quest }` (parity surface) */
	'quest.hydrate': (args) => ({
		quest: computeHydrationExpected({
			content: args.content,
			...(args.status ? { status: args.status } : {}),
		}),
	}),

	/** `quest.radiantTick { quests, maxOffering, ticks }` → `{ facts }` (parity surface) */
	'quest.radiantTick': (args) => ({
		facts: radiantTick({
			quests: args.quests || [],
			maxOffering: args.maxOffering,
			ticks: args.ticks,
		}),
	}),

	// ── saves (P1) ──────────────────────────────────────────────────────────────

	/**
	 * `save.rules` — what a save view must not hard-code: the current version,
	 * the envelope format, the migration chain and the registered extension keys.
	 */
	'save.rules': () => ({
		saveFileVersion: SAVE_FILE_VERSION,
		envelopeFormat: SAVE_ENVELOPE_FORMAT,
		migrations: listMigrations().map(({ name, fromVersion, toVersion, description }) => ({
			name,
			fromVersion,
			toVersion,
			description,
		})),
		extensionKeys: Object.keys(extensionRegistry).sort(),
	}),

	/**
	 * `save.integrity { saveFile }` → `{ integrity }` — core's
	 * `computeSaveFileIntegrity`: SHA-256 hex of the canonical JSON.
	 */
	'save.integrity': (args) => ({
		integrity: computeSaveFileIntegrity(needObject('save.integrity', args.saveFile, 'saveFile')),
	}),

	/**
	 * `save.encode { saveFile, insimulVersion, exportedAt? }` → `{ envelope }` —
	 * core's `buildSaveFileEnvelope`. `exportedAt` defaults to now (core's rule);
	 * pass it for a reproducible file.
	 */
	'save.encode': (args) => {
		const m = 'save.encode';
		const saveFile = needObject(m, args.saveFile, 'saveFile');
		const insimulVersion = needString(m, args.insimulVersion, 'insimulVersion');
		const options = { insimulVersion };
		if (args.exportedAt !== undefined && args.exportedAt !== null) {
			options.exportedAt = needString(m, args.exportedAt, 'exportedAt');
		}
		return { envelope: buildSaveFileEnvelope(saveFile, options) };
	},

	/**
	 * `save.decode { envelope } | { text }` — validate an envelope (format,
	 * payload, SHA-256 integrity: core's `validateSaveFileEnvelope`) and migrate
	 * the save inside it to the current version.
	 *
	 * A slot that does not load is an ANSWER, not an error: `{ ok: false, error:
	 * { code, message } }` with core's codes (`invalid_format`,
	 * `missing_save_file`, `integrity_mismatch`). `text` that is not JSON is
	 * `invalid_format`. On success: `{ ok: true, envelope: { format, exportedAt,
	 * insimulVersion, integrity }, saveFile, outcome, significant }` — see
	 * `save.migrate` for the last three.
	 */
	'save.decode': (args) => {
		let candidate = args.envelope;
		if (candidate === undefined && typeof args.text === 'string') {
			try {
				candidate = JSON.parse(args.text);
			} catch {
				return { ok: false, error: { code: 'invalid_format', message: 'Envelope is not valid JSON' } };
			}
		}
		const res = validateSaveFileEnvelope(candidate);
		if (!res.ok) return { ok: false, error: res.error };
		const { format, exportedAt, insimulVersion, integrity } = res.envelope;
		return {
			ok: true,
			envelope: { format, exportedAt, insimulVersion, integrity },
			...migrateWithOutcome(res.envelope.saveFile),
		};
	},

	/**
	 * `save.migrate { saveFile }` → `{ saveFile, outcome, significant }` — core's
	 * `migrateSaveFileWithOutcome`, with `outcome.orphanExtensionKeys` filled
	 * (see migrateWithOutcome above) and `significant` from core's
	 * `isMigrationOutcomeSignificant`.
	 */
	'save.migrate': (args) => migrateWithOutcome(needObject('save.migrate', args.saveFile, 'saveFile')),

	// ── in-game UI (P2, P3, P6, P8) ─────────────────────────────────────────────

	/** `ui.notifications.create {}` → `{ session, view }` — core's `Notifications` toast queue. */
	'ui.notifications.create': () => {
		const model = new Notifications();
		return { session: openSession('ui.notifications', { model }), view: notificationsView(model) };
	},

	/**
	 * `ui.notifications.apply { session, ops }` → `{ results, view }`.
	 * ops: `push { text, kind?, lifetime? }` → id · `tick { delta }` (seconds) →
	 * changed · `dismiss { id }` → dismissed · `clear` → null.
	 * view: `{ visible: [{ id, text, kind, remaining, color }], count }`.
	 */
	'ui.notifications.apply': async (args) => {
		const m = 'ui.notifications.apply';
		const s = session(m, args, 'ui.notifications');
		const results = await applyOps(m, s, args, {
			push: ({ model }, op) => {
				const kind = op.kind === undefined ? 'info' : oneOf(m, op.kind, Object.keys(KIND_COLOR), 'kind');
				const lifetime = optNumber(m, op.lifetime, 'lifetime');
				return lifetime === undefined
					? model.push(needString(m, op.text, 'text'), kind)
					: model.push(needString(m, op.text, 'text'), kind, lifetime);
			},
			tick: ({ model }, op) => model.tick(needNumber(m, op.delta, 'delta')),
			dismiss: ({ model }, op) => model.dismiss(needNumber(m, op.id, 'id')),
			clear: ({ model }) => model.clear(),
		});
		return { results, view: notificationsView(s.model) };
	},

	/**
	 * `ui.pause.create { enabledModules? | genre?, tabs? }` → `{ session, source,
	 * enabledModules, view }` — core's `PauseMenuModel`. With `genre` the enabled
	 * modules are that genre's feature-module bundle as core resolves it
	 * (`resolveGenre(genre).bundle.featureModules`; an unknown genre enables none).
	 */
	'ui.pause.create': (args) => {
		const m = 'ui.pause.create';
		let enabled = [];
		let source = 'none';
		if (args.enabledModules !== undefined && args.enabledModules !== null) {
			enabled = needArray(m, args.enabledModules, 'enabledModules').map(String);
			source = 'modules';
		} else if (args.genre !== undefined && args.genre !== null) {
			enabled = [...resolveGenre(args.genre).bundle.featureModules];
			source = 'genre';
		}
		const tabs = args.tabs === undefined || args.tabs === null ? undefined : needArray(m, args.tabs, 'tabs');
		const model = tabs === undefined ? new PauseMenuModel(enabled) : new PauseMenuModel(enabled, tabs);
		return { session: openSession('ui.pause', { model }), source, enabledModules: enabled, view: pauseView(model) };
	},

	/**
	 * `ui.pause.apply { session, ops }` → `{ results, view }`.
	 * ops: `open { tab? }` · `close` · `toggle` · `setActive { key }` → accepted.
	 * view: `{ open, active, visibleKeys, visibleTabs }`.
	 */
	'ui.pause.apply': async (args) => {
		const m = 'ui.pause.apply';
		const s = session(m, args, 'ui.pause');
		const results = await applyOps(m, s, args, {
			open: ({ model }, op) => model.openMenu(op.tab === undefined ? undefined : needString(m, op.tab, 'tab')),
			close: ({ model }) => model.closeMenu(),
			toggle: ({ model }) => model.toggle(),
			setActive: ({ model }, op) => model.setActive(needString(m, op.key, 'key')),
		});
		return { results, view: pauseView(s.model) };
	},

	/**
	 * `ui.journal.create { quests?, maxTracked? }` → `{ session, view }` — core's
	 * `QuestJournalModel`: the journal, the tracker HUD and the offer dialog.
	 */
	'ui.journal.create': (args) => {
		const m = 'ui.journal.create';
		const max = optNumber(m, args.maxTracked, 'maxTracked');
		const model = max === undefined ? new QuestJournalModel() : new QuestJournalModel(max);
		if (args.quests !== undefined && args.quests !== null) {
			model.setQuests(needArray(m, args.quests, 'quests').map((q) => questEntry(m, q)));
		}
		return { session: openSession('ui.journal', { model }), view: journalView(model) };
	},

	/**
	 * `ui.journal.apply { session, ops }` → `{ results, view }`.
	 * ops: `setQuests { quests }` · `upsert { quest }` · `accept { id }` ·
	 * `decline { id }` · `complete { id }` · `track { id }` · `untrack { id }` ·
	 * `setFilter { filter }` · `get { id }` → entry | null.
	 * view: `{ filter, filtered, counts, tracked, maxTracked }`.
	 */
	'ui.journal.apply': async (args) => {
		const m = 'ui.journal.apply';
		const s = session(m, args, 'ui.journal');
		const id = (op) => needString(m, op.id, 'id');
		const results = await applyOps(m, s, args, {
			setQuests: ({ model }, op) => model.setQuests(needArray(m, op.quests, 'quests').map((q) => questEntry(m, q))),
			upsert: ({ model }, op) => model.upsert(questEntry(m, op.quest)),
			accept: ({ model }, op) => model.accept(id(op)),
			decline: ({ model }, op) => model.decline(id(op)),
			complete: ({ model }, op) => model.complete(id(op)),
			track: ({ model }, op) => model.track(id(op)),
			untrack: ({ model }, op) => model.untrack(id(op)),
			setFilter: ({ model }, op) => model.setFilter(oneOf(m, op.filter, QUEST_FILTERS, 'filter')),
			get: ({ model }, op) => model.get(id(op)) ?? null,
		});
		return { results, view: journalView(s.model) };
	},

	/**
	 * `ui.saveSlots { slots }` → `{ slots, hasAnyLoadable }` — core's
	 * `SaveSlotModel`. A slot is either `{ index, envelope }` (classified by core's
	 * `SaveSlotModel.classifyEnvelope`, i.e. the real SHA-256 envelope check;
	 * `envelope: null` is an empty slot) or `{ index, outcome }` (a verdict the
	 * host already has). `summary` is shown on a slot that loads.
	 */
	'ui.saveSlots': (args) => {
		const m = 'ui.saveSlots';
		const results = needArray(m, args.slots, 'slots').map((slot, i) => {
			needObject(m, slot, `slots[${i}]`);
			const index = needNumber(m, slot.index, `slots[${i}].index`);
			const summary = slot.summary === undefined || slot.summary === null ? undefined : slot.summary;
			if (Object.prototype.hasOwnProperty.call(slot, 'envelope')) {
				return SaveSlotModel.classifyEnvelope(index, slot.envelope, () => summary);
			}
			const outcome = oneOf(m, slot.outcome, Object.keys(SLOT_MESSAGES), `slots[${i}].outcome`);
			return summary === undefined ? { index, outcome } : { index, outcome, summary };
		});
		const model = new SaveSlotModel(results);
		return { slots: plain(model.slots()), hasAnyLoadable: model.hasAnyLoadable() };
	},

	/** `ui.loading.create { phases?, tips? }` → `{ session, view }` — core's `LoadingScreenModel`. */
	'ui.loading.create': (args) => {
		const m = 'ui.loading.create';
		const phases = args.phases === undefined || args.phases === null ? undefined : needArray(m, args.phases, 'phases');
		const tips = args.tips === undefined || args.tips === null ? undefined : needArray(m, args.tips, 'tips');
		const model =
			phases === undefined && tips === undefined
				? new LoadingScreenModel()
				: new LoadingScreenModel(phases ?? [], tips ?? []);
		return { session: openSession('ui.loading', { model }), view: loadingView(model) };
	},

	/**
	 * `ui.loading.apply { session, ops }` → `{ results, view }`.
	 * ops: `advance { key }` · `reset`.
	 * view: `{ phase, progress, label, tip, complete }`.
	 */
	'ui.loading.apply': async (args) => {
		const m = 'ui.loading.apply';
		const s = session(m, args, 'ui.loading');
		const results = await applyOps(m, s, args, {
			advance: ({ model }, op) => model.advance(needString(m, op.key, 'key')),
			reset: ({ model }) => model.reset(),
		});
		return { results, view: loadingView(s.model) };
	},

	/**
	 * `ui.trade { state, ops }` → `{ results, state }` — core's `TradeModel` over a
	 * `currentState` slice (`player.gold/inventory`, `containers.containers`,
	 * `npcs.merchantStates`). Stateless: the slice goes in and the moved slice
	 * comes back, because the save owns it. ops: `takeFromContainer { containerId,
	 * itemId, qty? }` · `takeAllFromContainer { containerId }` · `buy { merchantId,
	 * itemId, qty }` · `sell { merchantId, itemId, qty }`; each result is core's
	 * `{ ok, reason, moved }`.
	 */
	'ui.trade': async (args) => {
		const m = 'ui.trade';
		const state = plain(needObject(m, args.state, 'state'));
		needObject(m, state.player, 'state.player');
		needArray(m, state.player.inventory, 'state.player.inventory');
		needNumber(m, state.player.gold, 'state.player.gold');
		needObject(m, state.containers && state.containers.containers, 'state.containers.containers');
		needObject(m, state.npcs && state.npcs.merchantStates, 'state.npcs.merchantStates');
		const model = new TradeModel(state);
		const qty = (op) => (op.qty === undefined || op.qty === null ? 0 : needNumber(m, op.qty, 'qty'));
		const results = await applyOps(m, { model }, args, {
			takeFromContainer: (s, op) =>
				model.takeFromContainer(needString(m, op.containerId, 'containerId'), needString(m, op.itemId, 'itemId'), qty(op)),
			takeAllFromContainer: (s, op) => model.takeAllFromContainer(needString(m, op.containerId, 'containerId')),
			buy: (s, op) =>
				model.buy(needString(m, op.merchantId, 'merchantId'), needString(m, op.itemId, 'itemId'), needNumber(m, op.qty, 'qty')),
			sell: (s, op) =>
				model.sell(needString(m, op.merchantId, 'merchantId'), needString(m, op.itemId, 'itemId'), needNumber(m, op.qty, 'qty')),
		});
		return { results, state };
	},

	// ── quests (P3) ─────────────────────────────────────────────────────────────

	/**
	 * `quest.completion.create { quests? }` → `{ session, view }` — core's
	 * `QuestCompletionEngine`, the objective-progress decision layer.
	 */
	'quest.completion.create': (args) => {
		const m = 'quest.completion.create';
		const events = [];
		const engine = new QuestCompletionEngine();
		engine.setOnObjectiveCompleted((questId, objectiveId) => events.push({ type: 'objectiveCompleted', questId, objectiveId }));
		engine.setOnObjectiveProgress((questId, objectiveId, current, required, objectiveType) =>
			events.push({ type: 'objectiveProgress', questId, objectiveId, current, required, objectiveType }),
		);
		engine.setOnQuestCompleted((questId) => events.push({ type: 'questCompleted', questId }));
		engine.setOnPronunciationFeedback((questId, objectiveId, feedback) =>
			events.push({ type: 'pronunciationFeedback', questId, objectiveId, feedback }),
		);
		for (const quest of args.quests === undefined || args.quests === null ? [] : needArray(m, args.quests, 'quests')) {
			engine.addQuest(plain(needObject(m, quest, 'quest')));
		}
		return { session: openSession('quest.completion', { engine, events }), view: completionView(engine) };
	},

	/**
	 * `quest.completion.apply { session, ops }` → `{ results, events, view }`.
	 * ops: `addQuest { quest }` · `removeQuest { questId }` · `clear` ·
	 * `trackEvent { event }` (core's `CompletionEvent` union) ·
	 * `handleGameEvent { event }` → objectives affected (core's declarative
	 * quest-action mapping) · `completeObjective { questId, objectiveId }` → bool ·
	 * `trackByTrigger { trigger, questId? }` · `revealHint { questId,
	 * objectiveId }` → hint text | null · `checkTimedObjectives` → expiry
	 * messages (reads the wall clock: objectives' `startedAt` is epoch ms) ·
	 * `restoreObjectiveStates { states }`.
	 * events: what core's callbacks reported during these ops, in order —
	 * `objectiveCompleted`, `objectiveProgress`, `questCompleted`,
	 * `pronunciationFeedback`.
	 */
	'quest.completion.apply': async (args) => {
		const m = 'quest.completion.apply';
		const s = session(m, args, 'quest.completion');
		s.events.length = 0;
		const questId = (op) => needString(m, op.questId, 'questId');
		const results = await applyOps(m, s, args, {
			addQuest: ({ engine }, op) => engine.addQuest(plain(needObject(m, op.quest, 'quest'))),
			removeQuest: ({ engine }, op) => engine.removeQuest(questId(op)),
			clear: ({ engine }) => engine.clear(),
			trackEvent: ({ engine }, op) => {
				needString(m, needObject(m, op.event, 'event').type, 'event.type');
				return engine.trackEvent(op.event);
			},
			handleGameEvent: ({ engine }, op) => {
				needString(m, needObject(m, op.event, 'event').type, 'event.type');
				return engine.handleGameEvent(op.event);
			},
			completeObjective: ({ engine }, op) => engine.completeObjective(questId(op), needString(m, op.objectiveId, 'objectiveId')),
			trackByTrigger: ({ engine }, op) =>
				engine.trackByTrigger(needString(m, op.trigger, 'trigger'), op.questId === undefined ? undefined : questId(op)),
			revealHint: ({ engine }, op) => engine.revealHint(questId(op), needString(m, op.objectiveId, 'objectiveId')),
			checkTimedObjectives: ({ engine }) => engine.checkTimedObjectives(),
			restoreObjectiveStates: ({ engine }, op) => engine.restoreObjectiveStates(needObject(m, op.states, 'states')),
		});
		const events = s.events.splice(0, s.events.length);
		return { results, events: plain(events), view: completionView(s.engine) };
	},

	/**
	 * `quest.markers { quests, npcs?, surface?, activeObjectiveNpcId?,
	 * readyToTurnIn? }` — core's `QuestMarkerService`: which marker each NPC gets
	 * (`selectNpcMarker`), which objective locations get one
	 * (`selectLocationMarker`, every objective of every quest), on the `world` or
	 * `minimap` surface. `readyToTurnIn` lists the quest ids the host's completion
	 * check says are done (core takes that check as a callback). result:
	 * `{ hasActiveQuest, npcs: [{ id, kind, style }], locations: [{ questId,
	 * objectiveIndex, objectiveId, kind, style }], styles }` — `kind`/`style` are
	 * null where no marker shows.
	 */
	'quest.markers': (args) => {
		const m = 'quest.markers';
		const quests = needArray(m, args.quests, 'quests');
		const surface = args.surface === undefined ? 'world' : oneOf(m, args.surface, ['world', 'minimap'], 'surface');
		const ready = args.readyToTurnIn === undefined || args.readyToTurnIn === null
			? null
			: new Set(needArray(m, args.readyToTurnIn, 'readyToTurnIn').map(String));
		const context = {
			quests,
			activeObjectiveNpcId: args.activeObjectiveNpcId ?? null,
			questCompletionChecker: ready === null ? null : (id) => ready.has(id),
		};
		const style = (kind) => (kind === null ? null : MARKER_STYLES[kind]);
		const npcs = (args.npcs === undefined || args.npcs === null ? [] : needArray(m, args.npcs, 'npcs')).map((npc) => {
			needString(m, needObject(m, npc, 'npc').id, 'npc.id');
			const kind = selectNpcMarker(npc, context, surface);
			return { id: npc.id, kind, style: style(kind) };
		});
		const locations = [];
		for (const quest of quests) {
			const objectives = Array.isArray(quest && quest.objectives) ? quest.objectives : [];
			objectives.forEach((objective, objectiveIndex) => {
				const kind = selectLocationMarker(quest, objective, context, surface);
				locations.push({
					questId: quest.id,
					objectiveIndex,
					objectiveId: objective && objective.id !== undefined ? objective.id : null,
					kind,
					style: style(kind),
				});
			});
		}
		return { hasActiveQuest: hasActiveQuest(quests), npcs, locations, styles: MARKER_STYLES };
	},

	/**
	 * `quest.minimapMarkers { quests, resolvedPositions?, namedLocations?,
	 * activeObjectiveNpcId? }` → `{ markers }` — core's `extractObjectiveMarkers`:
	 * one marker per active quest's current objective. The two position tables are
	 * JSON objects keyed as core keys its Maps (`<questId>_obj_<index>`; location
	 * atoms).
	 */
	'quest.minimapMarkers': (args) => {
		const m = 'quest.minimapMarkers';
		return {
			markers: extractObjectiveMarkers(
				needArray(m, args.quests, 'quests'),
				mapOf(m, args.resolvedPositions, 'resolvedPositions'),
				mapOf(m, args.namedLocations, 'namedLocations'),
				args.activeObjectiveNpcId ?? null,
			),
		};
	},

	/**
	 * `quest.waypoints { quest, player, forwardAngle?, buildings?, npcBuildingMap?,
	 * npcPositions? }` — core's `DynamicQuestWaypointDirector`: where each
	 * incomplete objective points (`resolveWaypoints`), each one's distance fade
	 * (`getDistanceAlpha`), and the HUD compass to the nearest (`getCompassData`,
	 * angle in radians relative to `forwardAngle`; null when nothing resolved).
	 * `buildings` is an ARRAY of `{ id, position, metadata }` because core walks
	 * them in order and picks the first match; `npcBuildingMap` is `{ npcId:
	 * buildingId }`. result: `{ waypoints: [{ objectiveId, objectiveType,
	 * position, label?, alpha }], compass }`.
	 */
	'quest.waypoints': (args) => {
		const m = 'quest.waypoints';
		const quest = needObject(m, args.quest, 'quest');
		const player = needObject(m, args.player, 'player');
		const buildings = new Map();
		for (const b of args.buildings === undefined || args.buildings === null ? [] : needArray(m, args.buildings, 'buildings')) {
			needObject(m, b, 'building');
			buildings.set(needString(m, b.id, 'building.id'), { position: b.position, metadata: b.metadata ?? null });
		}
		const director = new DynamicQuestWaypointDirector();
		const npcPositions = args.npcPositions === undefined || args.npcPositions === null ? [] : needArray(m, args.npcPositions, 'npcPositions');
		const waypoints = director.resolveWaypoints(quest, buildings, mapOf(m, args.npcBuildingMap, 'npcBuildingMap'), npcPositions, player);
		const forward = args.forwardAngle === undefined || args.forwardAngle === null ? 0 : needNumber(m, args.forwardAngle, 'forwardAngle');
		return {
			waypoints: waypoints.map((wp) => ({ ...wp, alpha: director.getDistanceAlpha(player, wp.position) })),
			compass: director.getCompassData(waypoints, player, forward),
		};
	},

	// ── world: clock and weather (P4) ───────────────────────────────────────────

	/**
	 * `clock.create { msPerGameHour?, startHour?, startMinute?, startDay?, state? }`
	 * → `{ session, view }` — core's `GameTimeManager`. `state` (a saved
	 * `GameTimeState`) is restored after construction.
	 */
	'clock.create': (args) => {
		const m = 'clock.create';
		const options = {};
		for (const key of ['msPerGameHour', 'startHour', 'startMinute', 'startDay']) {
			const v = optNumber(m, args[key], key);
			if (v !== undefined) options[key] = v;
		}
		const events = [];
		const clock = new GameTimeManager(options);
		clock.setEventBus({ emit: (event) => events.push(event) });
		if (args.state !== undefined && args.state !== null) clock.restoreState(needObject(m, args.state, 'state'));
		return { session: openSession('clock', { clock, events }), view: clockView(clock) };
	},

	/**
	 * `clock.apply { session, ops }` → `{ results, events, view }`.
	 * ops: `update { deltaMs }` (real milliseconds since the last update — call at
	 * event rate, never per frame) · `advanceHours { hours }` · `setTime { hour,
	 * minute?, day? }` · `pause` · `resume` · `setTimeScale { scale }` ·
	 * `setMsPerGameHour { ms }` · `restoreState { state }`.
	 * events: core's `hour_changed`, `day_changed`, `time_of_day_changed` in order.
	 * view: `{ state, timeOfDay, fractionalHour, timeString, isDaytime,
	 * realSecondsPerGameHour }`.
	 */
	'clock.apply': async (args) => {
		const m = 'clock.apply';
		const s = session(m, args, 'clock');
		s.events.length = 0;
		const results = await applyOps(m, s, args, {
			update: ({ clock }, op) => {
				const ms = needNumber(m, op.deltaMs, 'deltaMs');
				if (ms < 0) throw refuse(m, '`deltaMs` must not be negative');
				return clock.update(ms);
			},
			advanceHours: ({ clock }, op) => clock.advanceHours(needNumber(m, op.hours, 'hours')),
			setTime: ({ clock }, op) =>
				clock.setTime(needNumber(m, op.hour, 'hour'), optNumber(m, op.minute, 'minute') ?? 0, optNumber(m, op.day, 'day')),
			pause: ({ clock }) => clock.pause(),
			resume: ({ clock }) => clock.resume(),
			setTimeScale: ({ clock }, op) => clock.setTimeScale(needNumber(m, op.scale, 'scale')),
			setMsPerGameHour: ({ clock }, op) => clock.setMsPerGameHour(needNumber(m, op.ms, 'ms')),
			restoreState: ({ clock }, op) => clock.restoreState(needObject(m, op.state, 'state')),
		});
		const events = s.events.splice(0, s.events.length);
		return { results, events, view: clockView(s.clock) };
	},

	/**
	 * `weather.climate { weather, tuning? }` → `{ climate, climateFacts, issues }` —
	 * core's `climateFromIR` over a World IR's `weather` block, the authored facts
	 * (`weatherClimateFacts`) and the authoring problems (`weatherIssues`).
	 */
	'weather.climate': (args) => {
		const climate = climateOf('weather.climate', args);
		return { climate, climateFacts: weatherClimateFacts(climate), issues: weatherIssues(climate) };
	},

	/**
	 * `weather.run { weather | climate, seed, from, throughDay }` → `{ steps,
	 * final }` — core's seeded progression (`runWeather`) as
	 * `conformance/weather/progression.json` records it: every day from `from`
	 * (null = a fresh world, day -1) through `throughDay`, each with its view and
	 * its fact delta. Pure; for a playthrough use a `weather.create` session.
	 */
	'weather.run': (args) => {
		const m = 'weather.run';
		const climate = climateOf(m, args);
		const seed = typeof args.seed === 'number' ? args.seed : needString(m, args.seed, 'seed');
		const from = args.from === undefined || args.from === null ? null : needObject(m, args.from, 'from');
		return weatherRunSteps(climate, seed, from, needNumber(m, args.throughDay, 'throughDay'));
	},

	/**
	 * `weather.create { weather, seed?, tuning?, state? }` → `{ session, …view }` —
	 * core's `WeatherDirector` for one playthrough; `state` restores a saved sky
	 * (silently, as core does).
	 */
	'weather.create': (args) => {
		const m = 'weather.create';
		const writes = [];
		const events = [];
		const config = {
			weather: args.weather === undefined || args.weather === null ? null : needObject(m, args.weather, 'weather'),
			engine: recordingKb(writes),
			eventBus: { emit: (event) => events.push(event) },
		};
		if (args.seed !== undefined && args.seed !== null) {
			config.seed = typeof args.seed === 'number' ? args.seed : needString(m, args.seed, 'seed');
		}
		if (args.tuning !== undefined && args.tuning !== null) config.tuning = needObject(m, args.tuning, 'tuning');
		const director = new WeatherDirector(config);
		if (args.state !== undefined) director.restore(args.state === null ? null : needObject(m, args.state, 'state'));
		return { session: openSession('weather', { director, writes, events }), ...weatherSessionView(director) };
	},

	/**
	 * `weather.apply { session, ops }` → `{ results, writes, events, state, view,
	 * issues }`.
	 * ops: `advanceTo { day }` → core's `WeatherAdvance` · `impose { condition }` →
	 * imposed · `restore { state }` · `publishClimate` → facts written ·
	 * `publishState` → facts written.
	 * writes: the KB writes core made, in order (`{ op: 'assert'|'retract', fact }`,
	 * no trailing period) — apply them to the host KB verbatim. events: core's
	 * `weather_changed`.
	 */
	'weather.apply': async (args) => {
		const m = 'weather.apply';
		const s = session(m, args, 'weather');
		s.writes.length = 0;
		s.events.length = 0;
		const results = await applyOps(m, s, args, {
			advanceTo: ({ director }, op) => director.advanceTo(needNumber(m, op.day, 'day')),
			impose: ({ director }, op) =>
				director.impose(op.condition === null ? null : needString(m, op.condition, 'condition')),
			restore: ({ director }, op) => director.restore(op.state === null ? null : needObject(m, op.state, 'state')),
			publishClimate: ({ director }) => director.publishClimate(),
			publishState: ({ director }) => director.publishState(),
		});
		const writes = s.writes.splice(0, s.writes.length);
		const events = s.events.splice(0, s.events.length);
		return { results: plain(results), writes, events, ...weatherSessionView(s.director) };
	},

	// ── genre and module activation (P9; track G's registry) ────────────────────

	/** `genre.registry` → `{ defaultGenre, ids, genres, cameraModes }` — core's 15-genre registry. */
	'genre.registry': () => ({
		defaultGenre: DEFAULT_GENRE_ID,
		ids: [...GENRE_IDS],
		genres: plain(getAllGenres()),
		cameraModes: [...CAMERA_MODES],
	}),

	/** `genre.resolve { genre }` → core's `resolveGenre` (an unknown genre is never silently rpg). */
	'genre.resolve': (args) => resolveGenre(args.genre),

	/** `genre.camera { value }` → `{ mode }` — core's `normalizeCameraMode` (null when none). */
	'genre.camera': (args) => ({ mode: normalizeCameraMode(args.value) }),

	/**
	 * `genre.resolveGame { recipe?, world? }` → core's `resolveGameGenre`: which
	 * settings, camera (decision X3), bundle and activation a game runs with. A
	 * recipe core cannot resolve is an ERROR whose last_error carries core's code:
	 * `GenreResolutionError: [<code>] …` (see "Errors" in README.md).
	 */
	'genre.resolveGame': (args) => resolveGameGenre({ recipe: args.recipe ?? null, world: args.world ?? null }),

	/** `genre.recipes` → `{ ids, bindings }` — core's recipe → genre bindings. */
	'genre.recipes': () => ({ ids: [...RECIPE_IDS], bindings: plain(RECIPE_GENRE_BINDINGS) }),

	/**
	 * `modules.activate { ir } | { genre } | {}` → `{ source, active,
	 * predicatePacks, hostInterfaces, reason }` — core's module activation, with
	 * the three answers kept apart exactly as Godot's fork answers them: a known
	 * genre (its bundle), an unknown one (`known: false`, no modules), and nothing
	 * declared (`source: 'undeclared'`, every pack, `active: null`).
	 */
	'modules.activate': (args) => {
		if (args.ir !== undefined && args.ir !== null) {
			const id = args.ir && args.ir.meta && args.ir.meta.genreConfig && args.ir.meta.genreConfig.id;
			if (typeof id !== 'string') return undeclared('the World IR carries no meta.genreConfig.id');
			return activated('worldIr', activeModulesForWorld(args.ir));
		}
		if (typeof args.genre === 'string') return activated('genre', resolveActiveModules(args.genre));
		return undeclared('no genre and no World IR was passed');
	},

	/** `modules.table` → core's `moduleActivationTable()` (= conformance/modules/genre-activation.json). */
	'modules.table': () => moduleActivationTable(),

	/**
	 * `prolog.packs { areas? }` → `{ packs: [{ area, prolog, runtimePredicates }],
	 * order, unknown }` — the rule-pack TEXT the activation names, in consult
	 * order (`PREDICATE_PACK_AREAS`; a `:- dynamic` must precede the clauses
	 * other packs add).
	 */
	'prolog.packs': (args) => {
		const wanted = Array.isArray(args.areas) ? new Set(args.areas.map(String)) : null;
		return {
			packs: PREDICATE_PACKS.filter((pack) => wanted === null || wanted.has(pack.area)).map((pack) => ({
				area: pack.area,
				prolog: pack.prolog,
				runtimePredicates: [...pack.runtimePredicates],
			})),
			order: [...PREDICATE_PACK_AREAS],
			unknown: wanted === null ? [] : [...wanted].filter((a) => !PREDICATE_PACK_AREAS.includes(a)),
		};
	},
};

function notificationsView(model) {
	return { visible: plain(model.visible()), count: model.count() };
}

function pauseView(model) {
	return {
		open: model.isOpen(),
		active: model.activeTab(),
		visibleKeys: model.visibleKeys(),
		visibleTabs: plain(model.visibleTabs()),
	};
}

function loadingView(model) {
	return {
		phase: model.currentPhase(),
		progress: model.progress(),
		label: model.label(),
		tip: model.tip(),
		complete: model.isComplete(),
	};
}

/**
 * A rejection's text. Core's errors that carry a machine-readable `code`
 * (`GenreResolutionError`, an op failure wrapping one) keep their name and gain
 * a `[code] ` prefix, so a host reads the code without parsing prose:
 * last_error = `insimulcore: <Name>: [<code>] <message>`.
 */
function asRejection(err) {
	if (err && typeof err === 'object' && typeof err.code === 'string') {
		const wrapped = new Error(`[${err.code}] ${err.message}`);
		wrapped.name = err.name || 'Error';
		return wrapped;
	}
	return err;
}

globalThis.__insimul_core_dispatch = function (method, argsJson) {
	if (method !== 'core.diagnostics') clearDiagnostics();
	const fn = Object.prototype.hasOwnProperty.call(METHODS, method) ? METHODS[method] : null;
	if (!fn) {
		return Promise.reject(new Error(`insimulcore: unknown method "${method}"`));
	}
	// `Promise.resolve().then(...)` so a synchronous throw inside `fn` becomes a
	// rejection the host reports through last_error(), never a C-level exception.
	return Promise.resolve()
		.then(() => {
			const args = argsJson ? JSON.parse(argsJson) : {};
			if (args === null || typeof args !== 'object' || Array.isArray(args)) {
				throw new Error(`insimulcore: ${method}: the arguments must be a JSON object`);
			}
			return fn(args);
		})
		.catch((err) => {
			throw asRejection(err);
		});
};
