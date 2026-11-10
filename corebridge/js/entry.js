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

import { applyOps, applySteps, disposeSession, listSessions, openSession, session } from './host-sessions.js';

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
import { extensionRegistry } from '@insimul/core/save-extensions';
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

// ── the genre HUD, the rules panel and the mechanic runtime (P9a) ─────────────
// Core's own JSON boundaries for its P9a corpora: `runGenreHudOp` /
// `runRulesPanelOp` answer a `conformance/ui/{genre-hud,rules-panel}-cases.json`
// case in exactly the shape the file pins, and `runMechanicRuntimeCase` replays a
// `conformance/modules/mechanic-runtime.json` case over `createMechanicRuntime`.
// `MECHANIC_STEP_OPS` is core's own list of the step ops that runner applies
// (its `MechanicStep` union as data, held to the union by core's type check).
import { GENRE_HUD_OPS, runGenreHudOp } from '@insimul/core/ui/genre-hud-corpus';
import { RULES_PANEL_OPS, runRulesPanelOp } from '@insimul/core/ui/rules-panel-corpus';
import { MECHANIC_STEP_OPS, runMechanicRuntimeCase } from '@insimul/core/game-engine/mechanic-runtime-corpus';

// ── save slots, Continue, autosave and quick save (P1.core-slots, U83(1)) ─────
// Core's `SaveSlotsSession`: the engine-neutral logic around one save format
// (which slot a request goes to, what is refused, the rows and Continue, when an
// autosave is due, the indicator). It does no I/O; the host does the I/O each
// step's `effect` names and answers with `finished`.
import { SaveSlotsSession } from '@insimul/core/save-slots';

// ── props, interiors and the inventory panel (P6.core; PL.native-props-rows, U89(2)) ──
// Core's P6 logic (core 31764b1 onward): containers (access, unlock, the deposit
// gate, location, respawn), documents (`documentOf`, `paginateText`, the reader
// panel's `DocumentReader`), doors (the door, its prompt, the enter X / exit to Y
// handoff), the notice board (`NoticeBoard`) and the notices a settlement posts
// (`generateSettlementNotices`), and the inventory panel's `InventoryViewModel`.
// The rows call these and decide nothing, so an engine drops its own copy
// (Unreal's interim `Portable/InsimulProps`, U89(2)) for them. The constants are
// imported for `props.contract`, which answers the tables core's P6 corpora state.
import {
	CONTAINER_ACCESS_STATES,
	CONTAINER_REFUSALS,
	CONTAINER_UNLOCK_RESULTS,
	DEFAULT_CONTAINER_CAPACITY,
	containerMoveRefusal,
	containerRespawnDue,
	containersAtLocation,
	containerView,
	unlockContainer,
} from '@insimul/core/props/containers';
import {
	DEFAULT_CHARS_PER_PAGE,
	DEFAULT_QUIZ_XP,
	DOCUMENT_KINDS,
	DOCUMENT_QUIZ_XP,
	DOCUMENT_READER_ACTIONS,
	DOCUMENT_READER_PHASES,
	DOCUMENT_REFUSALS,
	DocumentReader,
	documentOf,
	paginateText,
} from '@insimul/core/props/documents';
import {
	DOOR_ACTIONS,
	DOOR_PROMPT_RADIUS_M,
	DOOR_REFUSALS,
	DOOR_STANDOFF_M,
	DOOR_STATES,
	doorPrompt,
	doorStep,
	doorView,
} from '@insimul/core/props/doors';
import {
	NOTICE_BOARD_ACTIONS,
	NOTICE_BOARD_REFUSALS,
	NOTICE_FLUENCY_THRESHOLDS,
	NOTICE_HOOK_STATES,
	NoticeBoard,
} from '@insimul/core/props/notice-board';
import { generateSettlementNotices } from '@insimul/core/game-engine/logic/NoticeGenerator';
import {
	INVENTORY_DEFAULT_TYPE_COLOR,
	INVENTORY_EMPTY_MESSAGES,
	INVENTORY_EQUIPPED_NAME_COLOR,
	INVENTORY_FILTERS,
	INVENTORY_PINNED_GROUP,
	INVENTORY_PLAIN_BORDER,
	INVENTORY_RARITY_COLORS,
	INVENTORY_RARITY_ORDER,
	INVENTORY_SLOT_LABELS,
	INVENTORY_TYPE_COLORS,
	INVENTORY_USABLE_TYPES,
	InventoryViewModel,
	inventoryEntryId,
	inventoryItemName,
} from '@insimul/core/ui/inventory-model';

// ── where a pick-up is put down (PL.pickup-placement; PL.native-pickup-settle, U91(2), U89(3)) ──
// Core's pick-up placement (core ac229a7 onward, src/props/pickup-placement.ts):
// the authored spot settled clear of props, buildings, plants by their trunk,
// containers, roads, doors, villagers and the pick-ups settled before it, or
// refused with a code; the search pattern it walks; how clear a spot is. Data in,
// decision out, in core's metres on its ground plane (x, z). The `props.pickups.*`
// rows call these and decide nothing, so an engine drops its own settle (Unreal's
// interim one in InsimulVillageProps, U89(3)) for them. The constants are imported
// for `props.contract`, which answers the tables core's pick-up corpus states.
import {
	PICKUP_APPROACH_HEADINGS,
	PICKUP_APPROACH_PROBES_M,
	PICKUP_CLEARANCE_KINDS,
	PICKUP_CLEARANCE_M,
	PICKUP_CONTAINER_CLEARANCE_M,
	PICKUP_CONTAINER_RADIUS_M,
	PICKUP_CULL_RADIUS_M,
	PICKUP_DOOR_CLEARANCE_M,
	PICKUP_DOOR_RADIUS_M,
	PICKUP_GROUND_COVER_M,
	PICKUP_GROUND_KINDS,
	PICKUP_GROUND_PIECE_HALF_M,
	PICKUP_MOVED_M,
	PICKUP_NAV_SNAP_M,
	PICKUP_NOTHING_NEAR_M,
	PICKUP_OBSTACLE_KINDS,
	PICKUP_PLACEMENT_DEVIATIONS,
	PICKUP_PLACEMENT_FRAMES,
	PICKUP_PLACEMENT_REFUSALS,
	PICKUP_PLANT_ARCHETYPE_MARKS,
	PICKUP_PLANT_ENTITY_KINDS,
	PICKUP_RING_ARC_M,
	PICKUP_RING_MAX_POINTS,
	PICKUP_RING_MIN_POINTS,
	PICKUP_RING_STEP_M,
	PICKUP_ROAD_CLEARANCE_M,
	PICKUP_ROAD_DEFAULT_WIDTH_M,
	PICKUP_ROAD_POINT_SQ_M2,
	PICKUP_SEARCH,
	PICKUP_SEARCH_RADIUS_M,
	PICKUP_SPACING_M,
	PICKUP_STAND_HIGH_M,
	PICKUP_STAND_LOW_M,
	PICKUP_STATIC_CLEARANCE_M,
	PICKUP_STATIC_KINDS,
	PICKUP_TREE_HEIGHT_M,
	PICKUP_TRUNK_FRACTION,
	PICKUP_TRUNK_MAX_M,
	PICKUP_TRUNK_MIN_M,
	PICKUP_VILLAGER_CLEARANCE_M,
	PICKUP_VILLAGER_RADIUS_M,
	pickupClearance,
	pickupSearchPattern,
	pickupSearchRing,
	settlePickup,
	settlePickups,
} from '@insimul/core/props/pickup-placement';

// ── system packs (U50, U62(1): SP.composer-native) ────────────────────────────
// Core's composer: a game's recipe, world, pack choices and engine → its packs,
// settings and activation, over the pack catalog the caller sends.
import { resolveComposition } from '@insimul/core/system-packs/composer';

// ── village layout and composition (U23, U36: L.native-layout) ────────────────
// Core's own JSON boundary for its layout rules: `runLayoutOp` /
// `runCompositionOp` read a corpus input, call the rule, and answer in exactly
// the shape `conformance/layout/` and `conformance/layout-composition/` pin.
// The rows below call them and nothing else, so an engine binding (Unreal's
// `Portable/` shrinking to one, L.portable-binding) sends a case's input and
// reads a case's answer.
import { LAYOUT_OPS, runLayoutOp } from '@insimul/core/editor/layout/corpus';
import { COMPOSITION_OPS, runCompositionOp } from '@insimul/core/editor/layout/composition/corpus';

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

/**
 * Run boundary checks so that whatever they refuse carries `code` (the P9a rows:
 * README.md "Errors"). `asRejection` then writes it as `insimulcore: Error:
 * [<code>] insimulcore: <method>: <what was wrong>`, so a host reads the code
 * between the brackets as it reads core's own. Only the row's checks run inside
 * `checks`, never a core call, so a core error is never relabelled.
 */
function coded(code, checks) {
	try {
		return checks();
	} catch (err) {
		if (err && typeof err === 'object' && typeof err.code !== 'string') err.code = code;
		throw err;
	}
}

/** `op` as one of the ops core's corpus runner declares, refused as `[unknown-op]`. */
function opOf(method, op, ops) {
	return coded('unknown-op', () => oneOf(method, op, ops, 'op'));
}

// ── the genre HUD, the rules panel and the mechanic runtime (P9a) ─────────────

/** `input[name]` is absent, null or an array (of objects when `objects`). */
function optArray(method, input, name, objects) {
	if (input[name] === undefined || input[name] === null) return;
	needArray(method, input[name], name).forEach((item, i) => {
		if (objects) needObject(method, item, `${name}[${i}]`);
	});
}

/**
 * The fields each rules-panel op reads, checked for the JSON type core's
 * `PanelRule` and its function signatures declare. Core's runner itself reads a
 * non-array as no rules and `String()`s a key, so without these a misspelt field
 * would answer an empty panel rather than fail.
 */
const RULES_PANEL_INPUTS = {
	panel: (m, input) => {
		optArray(m, input, 'worldRules', true);
		optArray(m, input, 'baseRules', true);
	},
	card: (m, input) => needObject(m, input.rule, 'rule'),
	byCategory: (m, input) => {
		needRules(m, input);
		needString(m, input.category, 'category');
	},
	byType: (m, input) => {
		needRules(m, input);
		needString(m, input.ruleType, 'ruleType');
	},
	isActive: (m, input) => {
		needRules(m, input);
		needString(m, input.ruleId, 'ruleId');
	},
};

/** `input.rules`: present, an array of objects. */
function needRules(method, input) {
	needArray(method, input.rules, 'rules');
	optArray(method, input, 'rules', true);
}

// ── save slots (P1.core-slots) ────────────────────────────────────────────────

/**
 * The init core's `SaveSlotsSession` takes (`SaveSlotsSessionInit`), checked for
 * the JSON types core declares and nothing more. `config` is an object or null,
 * and its fields go to core UNCHECKED: `resolveSaveSlotsConfig` reads a field of
 * the wrong type as its default on purpose, and `conformance/saves/slots.json`
 * pins each such reading. A slot is `{ index, outcome, summary? }` with an outcome
 * core's `SaveSlotModel` knows (as `ui.saveSlots` checks it); an index that is not
 * a slot is core's to ignore. `activeSlot` is a number or null; one that is not a
 * slot is core's to read as none.
 */
function saveSlotsInit(method, args) {
	const init = {};
	if (args.config !== undefined) {
		init.config = args.config === null ? null : needObject(method, args.config, 'config');
	}
	if (args.slots !== undefined && args.slots !== null) {
		init.slots = needArray(method, args.slots, 'slots').map((slot, i) => {
			needObject(method, slot, `slots[${i}]`);
			needNumber(method, slot.index, `slots[${i}].index`);
			oneOf(method, slot.outcome, Object.keys(SLOT_MESSAGES), `slots[${i}].outcome`);
			if (slot.summary !== undefined && slot.summary !== null) needObject(method, slot.summary, `slots[${i}].summary`);
			return slot;
		});
	}
	if (args.activeSlot !== undefined && args.activeSlot !== null) {
		init.activeSlot = needNumber(method, args.activeSlot, 'activeSlot');
	}
	return init;
}

/** `op[name]`, a string when present and not null. */
function optStringField(method, op, name) {
	if (op[name] !== undefined && op[name] !== null) needString(method, op[name], name);
}

/**
 * One `saves.slots.apply` op as core's `SaveSlotsStepResult`, in JSON: `{ ok,
 * refusal?, outcome?, effect, history? }` (`effect` null, or `{ write: { slot,
 * kind, autosave } }`, `{ read: { slot, kind } }` or `{ remove: { slot } }`;
 * `history` only on a finished delete) — the shape core's corpus runner records
 * (`saveSlotsResultJson`).
 */
function saveSlotsOps(m) {
	const slot = (op) => needNumber(m, op.slot, 'slot');
	return {
		save: ({ model }, op) => plain(model.save(slot(op))),
		load: ({ model }, op) => plain(model.load(slot(op))),
		continue: ({ model }) => plain(model.continueGame()),
		delete: ({ model }, op) => plain(model.delete(slot(op))),
		// The slot list's Delete asks first (PL.slots-delete-states, core 2e1706a):
		// `ask_delete` opens the view's `confirm` prompt, its two actions answer it.
		ask_delete: ({ model }, op) => plain(model.askDelete(slot(op))),
		confirm_delete: ({ model }) => plain(model.confirmDelete()),
		cancel_delete: ({ model }) => plain(model.cancelDelete()),
		key: ({ model }, op) => plain(model.key(needString(m, op.code, 'code'))),
		// JSON has no NaN: a `delta` of null is a non-finite tick, which core
		// answers as changing nothing (the corpus writes it the same way).
		tick: ({ model }, op) =>
			plain(model.tick(op.delta === null ? Number.NaN : needNumber(m, op.delta, 'delta'))),
		finished: ({ model }, op) => {
			const { op: _name, ...result } = op;
			if (typeof result.ok !== 'boolean') throw refuse(m, '`ok` must be a boolean');
			optStringField(m, result, 'savedAt');
			optStringField(m, result, 'outcome');
			if (result.summary !== undefined && result.summary !== null) needObject(m, result.summary, 'summary');
			return plain(model.finished(result));
		},
	};
}

// ── props and the inventory panel (P6; PL.native-props-rows) ──────────────────

/** `value` absent or null (undefined), else a JSON object. */
function optObject(method, value, name) {
	return value === undefined || value === null ? undefined : needObject(method, value, name);
}

/** `value` absent or null (undefined), else an array. */
function optArrayValue(method, value, name) {
	return value === undefined || value === null ? undefined : needArray(method, value, name);
}

/** `value` absent or null, else a boolean (core reads these flags by truthiness; its types say boolean). */
function optBoolean(method, value, name) {
	if (value !== undefined && value !== null && typeof value !== 'boolean') {
		throw refuse(method, `\`${name}\` must be a boolean`);
	}
	return value;
}

/**
 * The tables core's P6 corpora state as data in their `contract`, built from
 * core's own exported constants exactly as core's emitters
 * (`scripts/emit-props-corpora.ts`, `scripts/emit-pickup-placement-corpus.ts`)
 * build them, keyed by each file's `area`. The prose keys of those contracts
 * (orders, rules, units, source lines) are not data and are not here.
 */
function propsContract() {
	return plain({
		'props-containers': {
			defaultCapacity: DEFAULT_CONTAINER_CAPACITY,
			states: CONTAINER_ACCESS_STATES,
			refusals: CONTAINER_REFUSALS,
			unlockResults: CONTAINER_UNLOCK_RESULTS,
		},
		'props-documents': {
			kinds: DOCUMENT_KINDS,
			refusals: DOCUMENT_REFUSALS,
			defaultCharsPerPage: DEFAULT_CHARS_PER_PAGE,
			quizXp: DOCUMENT_QUIZ_XP,
			defaultQuizXp: DEFAULT_QUIZ_XP,
			phases: DOCUMENT_READER_PHASES,
			actions: DOCUMENT_READER_ACTIONS,
		},
		'props-notice-board': {
			fluencyThresholds: NOTICE_FLUENCY_THRESHOLDS,
			hookStates: NOTICE_HOOK_STATES,
			actions: NOTICE_BOARD_ACTIONS,
			refusals: NOTICE_BOARD_REFUSALS,
		},
		'props-doors': {
			states: DOOR_STATES,
			actions: DOOR_ACTIONS,
			refusals: DOOR_REFUSALS,
			promptRadiusM: DOOR_PROMPT_RADIUS_M,
			standoffM: DOOR_STANDOFF_M,
		},
		'ui-inventory': {
			filters: INVENTORY_FILTERS,
			usableTypes: INVENTORY_USABLE_TYPES,
			slotLabels: INVENTORY_SLOT_LABELS,
			rarityColors: INVENTORY_RARITY_COLORS,
			rarityOrder: INVENTORY_RARITY_ORDER,
			typeColors: INVENTORY_TYPE_COLORS,
			defaultTypeColor: INVENTORY_DEFAULT_TYPE_COLOR,
			equippedNameColor: INVENTORY_EQUIPPED_NAME_COLOR,
			plainBorder: INVENTORY_PLAIN_BORDER,
			pinnedGroup: INVENTORY_PINNED_GROUP,
			emptyMessages: INVENTORY_EMPTY_MESSAGES,
		},
		// PL.native-pickup-settle: the data tables of conformance/props/pickup-placement.json
		// (core's scripts/emit-pickup-placement-corpus.ts). Its `constants` table
		// states each value with the Unreal line it was measured from; the value is
		// data and is here, the `source` line is prose and is not (nor `units` or
		// `sourceAbbreviation`).
		'props-pickup-placement': {
			frames: PICKUP_PLACEMENT_FRAMES,
			obstacleKinds: PICKUP_OBSTACLE_KINDS,
			clearanceKinds: PICKUP_CLEARANCE_KINDS,
			staticKinds: PICKUP_STATIC_KINDS,
			refusals: PICKUP_PLACEMENT_REFUSALS,
			clearanceM: PICKUP_CLEARANCE_M,
			search: PICKUP_SEARCH,
			constants: {
				staticClearanceM: PICKUP_STATIC_CLEARANCE_M,
				containerClearanceM: PICKUP_CONTAINER_CLEARANCE_M,
				doorClearanceM: PICKUP_DOOR_CLEARANCE_M,
				villagerClearanceM: PICKUP_VILLAGER_CLEARANCE_M,
				roadClearanceM: PICKUP_ROAD_CLEARANCE_M,
				spacingM: PICKUP_SPACING_M,
				doorRadiusM: PICKUP_DOOR_RADIUS_M,
				villagerRadiusM: PICKUP_VILLAGER_RADIUS_M,
				containerRadiusM: PICKUP_CONTAINER_RADIUS_M,
				roadDefaultWidthM: PICKUP_ROAD_DEFAULT_WIDTH_M,
				roadPointSqM2: PICKUP_ROAD_POINT_SQ_M2,
				standLowM: PICKUP_STAND_LOW_M,
				standHighM: PICKUP_STAND_HIGH_M,
				groundCoverM: PICKUP_GROUND_COVER_M,
				treeHeightM: PICKUP_TREE_HEIGHT_M,
				trunkFraction: PICKUP_TRUNK_FRACTION,
				trunkMinM: PICKUP_TRUNK_MIN_M,
				trunkMaxM: PICKUP_TRUNK_MAX_M,
				groundPieceHalfM: PICKUP_GROUND_PIECE_HALF_M,
				ringStepM: PICKUP_RING_STEP_M,
				searchRadiusM: PICKUP_SEARCH_RADIUS_M,
				ringArcM: PICKUP_RING_ARC_M,
				ringMinPoints: PICKUP_RING_MIN_POINTS,
				ringMaxPoints: PICKUP_RING_MAX_POINTS,
				movedM: PICKUP_MOVED_M,
				nothingNearM: PICKUP_NOTHING_NEAR_M,
				approachHeadings: PICKUP_APPROACH_HEADINGS,
				approachProbesM: PICKUP_APPROACH_PROBES_M,
				navSnapM: PICKUP_NAV_SNAP_M,
				cullRadiusM: PICKUP_CULL_RADIUS_M,
			},
			groundKinds: PICKUP_GROUND_KINDS,
			plantEntityKinds: PICKUP_PLANT_ENTITY_KINDS,
			plantArchetypeMarks: PICKUP_PLANT_ARCHETYPE_MARKS,
			deviations: PICKUP_PLACEMENT_DEVIATIONS,
		},
	});
}

/**
 * The world a pick-up rule reads (core's `PickupWorld`, plus a settle's `spot`,
 * `groundY` and `settled` and a sequence's `pickups`), checked for the JSON types
 * core declares and nothing more, and returned AS IS: the lists are arrays (core
 * walks them) and `clearance` and `search` objects, when present; a road object's
 * `waypoints` an array when it states them. Everything core reads itself goes to
 * core unchanged, because core's corpus pins each of those readings: a spot or
 * ground height that is not a finite number (core's `bad-spot`), a list entry
 * that is null or not a point (skipped, its index kept), an obstacle of a kind
 * core does not know (not kept off), a clearance or search field that is not a
 * usable number (its default). Coordinates are core's metres on its ground plane
 * `(x, z)`; nothing here converts or mirrors a frame.
 */
function pickupWorldOf(method, args) {
	for (const key of ['obstacles', 'settled', 'walkable', 'pickups']) optArrayValue(method, args[key], key);
	(optArrayValue(method, args.roads, 'roads') ?? []).forEach((road, i) => {
		if (road !== null && typeof road === 'object' && !Array.isArray(road)) {
			optArrayValue(method, road.waypoints, `roads[${i}].waypoints`);
		}
	});
	optObject(method, args.clearance, 'clearance');
	optObject(method, args.search, 'search');
	return args;
}

/** A `ContainerRecord`: a JSON object (core reads every field of it itself). */
function containerOf(method, value, name = 'container') {
	return needObject(method, value, name);
}

/**
 * A `ContainerContext` (absent or null is `{}`, as core defaults it): the held
 * item ids and the buildings are arrays when present (a string's `includes`
 * would answer for its characters), `now` an ISO string or epoch ms.
 */
function containerContextOf(method, value) {
	const ctx = optObject(method, value, 'context') ?? {};
	optArrayValue(method, ctx.playerItemIds, 'context.playerItemIds');
	(optArrayValue(method, ctx.buildings, 'context.buildings') ?? []).forEach((b, i) =>
		needObject(method, b, `context.buildings[${i}]`),
	);
	nowOf(method, ctx.now, 'context.now');
	return ctx;
}

/** `now`: absent, null, an ISO date-time string or epoch milliseconds. */
function nowOf(method, value, name) {
	if (value !== undefined && value !== null && typeof value !== 'string' && typeof value !== 'number') {
		throw refuse(method, `\`${name}\` must be an ISO date-time string or epoch milliseconds`);
	}
	return value;
}

/** `DoorBuildingInput[]`: an array of JSON objects. */
function doorBuildingsOf(method, value) {
	return needArray(method, value, 'buildings').map((b, i) => needObject(method, b, `buildings[${i}]`));
}

/** `inside`: the building the player is in, or null (absent is null). */
function insideOf(method, value) {
	return value === undefined || value === null ? null : needString(method, value, 'inside');
}

/**
 * The `currentState.player` slice the inventory loads ({ gold, inventory }):
 * absent or null is an empty pack, as core's corpus runner opens one. `gold` goes
 * to core unchecked (core loads anything not finite as 0, and its corpus pins
 * `gold: null`); `inventory` is an array when present; its entries go to core,
 * which skips one with no id.
 */
function inventorySliceOf(method, value, name) {
	const player = optObject(method, value, name);
	if (player === undefined) return { gold: 0, inventory: [] };
	optArrayValue(method, player.inventory, `${name}.inventory`);
	return player;
}

/**
 * The inventory panel's view after a call: exactly the state core's P6 corpus
 * records after every step (`props-corpus.ts`, `inventorySnapshot`): the filter,
 * `{ total, shown }`, the gold, `rows()` with each item row's live `item` left
 * out (`inventory.apply`'s `get` returns the stored item), the equipped item's id
 * in each slot (or null), and `toSaveState()` — what a save writes.
 */
function inventoryView(model) {
	const equipment = model.equipment();
	return plain({
		filter: model.currentFilter(),
		counts: model.counts(),
		gold: model.getGold(),
		rows: model.rows().map((row) => {
			if (row.kind !== 'item') return row;
			const { item: _item, ...rest } = row;
			return rest;
		}),
		equipment: Object.fromEntries(
			Object.entries(equipment).map(([slot, item]) => [slot, item ? (item.id ?? item.itemId) : null]),
		),
		save: model.toSaveState(),
	});
}

/**
 * The `inventory.apply` ops: core's corpus steps (`conformance/ui/inventory-cases.json`)
 * by their names, plus what a game needs beside them (`get`, `items`, `load`,
 * `clear`). Each result is core's: a boolean for `add`, `remove`, `remove_gold`
 * and `equip_flag`, null for the others; `get` answers the stored item or null,
 * `items` every stored item as `{ id, name, item }`.
 */
function inventoryOps(m) {
	// JSON has no NaN: an `amount` of null is a non-finite amount, which core
	// ignores (set/add) or refuses (remove), as the corpus writes it.
	const amount = (op) => (op.amount === null ? Number.NaN : needNumber(m, op.amount, 'amount'));
	return {
		add: ({ model }, op) => model.addItem(needObject(m, op.item, 'item')),
		remove: ({ model }, op) => {
			const id = needString(m, op.item, 'item');
			return op.quantity === undefined || op.quantity === null
				? model.removeItem(id)
				: model.removeItem(id, needNumber(m, op.quantity, 'quantity'));
		},
		filter: ({ model }, op) => {
			model.setFilter(needString(m, op.filter, 'filter'));
		},
		toggle: ({ model }, op) => {
			model.toggleGroup(needString(m, op.group, 'group'));
		},
		set_gold: ({ model }, op) => {
			model.setGold(amount(op));
		},
		add_gold: ({ model }, op) => {
			model.addGold(amount(op));
		},
		remove_gold: ({ model }, op) => model.removeGold(amount(op)),
		// What a host's equip handler does to the row's item (Babylon's
		// handleEquipItem, core's corpus step `equip_flag`): writes `equipped` on the
		// STORED object; false when nothing is held under that id.
		equip_flag: ({ model }, op) => {
			const id = needString(m, op.item, 'item');
			if (typeof op.equipped !== 'boolean') throw refuse(m, '`equipped` must be a boolean');
			const item = model.getItem(id);
			if (item) item.equipped = op.equipped;
			return !!item;
		},
		get: ({ model }, op) => plain(model.getItem(needString(m, op.item, 'item')) ?? null),
		// Every stored item in insertion order, with core's id and display name for
		// it (`inventoryEntryId`, `inventoryItemName`): what a host lists when it
		// needs the whole pack, which `rows` (filtered, folded) is not.
		items: ({ model }) =>
			plain(model.allItems().map((item) => ({ id: inventoryEntryId(item), name: inventoryItemName(item), item }))),
		load: ({ model }, op) => {
			model.loadFromSaveState(inventorySliceOf(m, op.player, 'player'));
		},
		clear: ({ model }) => {
			model.clearAll();
		},
	};
}

/** A `NoticeBoardInput`, its fields checked for the JSON types core declares. */
function noticeBoardInputOf(method, args) {
	const input = { notices: optArrayValue(method, args.notices, 'notices') ?? [] };
	if (args.fluency !== undefined && args.fluency !== null) input.fluency = needNumber(method, args.fluency, 'fluency');
	for (const key of ['read', 'answered']) {
		const list = optArrayValue(method, args[key], key);
		if (list !== undefined) input[key] = list.map((id, i) => needString(method, id, `${key}[${i}]`));
	}
	const status = optObject(method, args.questStatus, 'questStatus');
	if (status !== undefined) {
		for (const [quest, value] of Object.entries(status)) needString(method, value, `questStatus.${quest}`);
		input.questStatus = status;
	}
	return input;
}

// ── system packs ──────────────────────────────────────────────────────────────

/** The `{ index, manifests }` core's composer takes, checked for shape only. */
function catalogOf(method, value) {
	const catalog = needObject(method, value, 'catalog');
	const index = needObject(method, catalog.index, 'catalog.index');
	needArray(method, index.packs, 'catalog.index.packs').forEach((row, i) =>
		needObject(method, row, `catalog.index.packs[${i}]`),
	);
	needArray(method, catalog.manifests, 'catalog.manifests').forEach((m, i) =>
		needObject(method, m, `catalog.manifests[${i}]`),
	);
	return { index, manifests: catalog.manifests };
}

// ── layout ────────────────────────────────────────────────────────────────────

/**
 * One layout row: the args ARE the corpus case's `input` (fixtures resolved by
 * the caller), answered by core's `runLayoutOp` — which also turns -0 into 0, the
 * one normalisation the corpus pins. A row adds no check of its own: core's
 * reader refuses a malformed input with `layout corpus: …`.
 */
function layoutRow(op) {
	return (args) => runLayoutOp(op, args);
}

/**
 * One composition row: core's `runCompositionOp` under core's
 * `DEFAULT_COMPOSITION_RULES`, with the input's own `ruleOverrides` applied by
 * core (`applyRuleOverrides`), never by the row.
 */
function compositionRow(op) {
	return (args) => runCompositionOp(op, args);
}

// ── saves ─────────────────────────────────────────────────────────────────────

/**
 * Core's migration chain and its outcome, EXACTLY as core answers: the row
 * adds nothing to `outcome` and takes `significant` from core's own
 * `isMigrationOutcomeSignificant` over that unchanged outcome.
 *
 * At the pin, `migrateSaveFileWithOutcome` declares `orphanExtensionKeys` and
 * `droppedFacts` but leaves them empty ("populated by ... sibling stories"), so
 * this row reports them empty too. Filling them is a core change (with a core
 * corpus case), never a bridge one (GAUNTLET.md rule 1); the bridge picks it
 * up by re-pinning.
 */
function migrateWithOutcome(saveFile) {
	const { save, outcome } = migrateSaveFileWithOutcome(saveFile);
	return { saveFile: save, outcome, significant: isMigrationOutcomeSignificant(outcome) };
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
	 * `migrateSaveFileWithOutcome` unchanged (see migrateWithOutcome above) and
	 * `significant` from core's `isMigrationOutcomeSignificant`.
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

	/**
	 * `saves.slots.create { config?, slots?, activeSlot? }` → `{ session, config,
	 * view }` — core's `SaveSlotsSession` (`save-slots`, P1.core-slots): deleting a
	 * slot, the Continue target, autosave at an interval with its indicator, and
	 * quick save / quick load on F5 / F9, for one play session. `config` is the
	 * saves pack's parameters (`slotCount` or `maxSlots`, `quickSlot`,
	 * `autosaveIntervalSec`, `autosaveIndicator`) and the answer's `config` is how
	 * core resolved them (`resolveSaveSlotsConfig`); `slots` is what the host's save
	 * codec found in each slot (`{ index, outcome, summary? }`, `SlotLoadResult`);
	 * `activeSlot` the autosave target at the start (default none).
	 */
	'saves.slots.create': (args) => {
		const m = 'saves.slots.create';
		const model = new SaveSlotsSession(saveSlotsInit(m, args));
		return { session: openSession('saves.slots', { model }), config: plain(model.config), view: plain(model.view()) };
	},

	/**
	 * `saves.slots.apply { session, ops }` → `{ results, view }`. The session does
	 * no I/O: a result's `effect` names the I/O the host does now (`write`, `read`,
	 * `remove`), and the host answers it with `finished` (a finished write: raise
	 * core's `game_saved`).
	 * ops (core's steps, `conformance/saves/slots.json`'s `run` steps): `save { slot }`
	 * · `load { slot }` · `continue` · `delete { slot }` · `ask_delete { slot }`
	 * (the list's Delete: opens the prompt) · `confirm_delete` · `cancel_delete`
	 * (the prompt's two actions) · `key { code }` (a KeyboardEvent.code; F5
	 * quick-saves, F9 quick-loads) · `tick { delta }` (seconds; null is a
	 * non-finite tick) · `finished { ok, savedAt?, summary?, outcome? }`. Each
	 * result is `{ ok, refusal?, outcome?, effect, history? }`; a refusal (`busy`,
	 * `no_such_slot`, `slot_empty`, `slot_corrupted`, `no_quick_slot`,
	 * `nothing_to_continue`, `nothing_pending`, `unbound_key`, `confirm_open`,
	 * `nothing_to_confirm`, `quick_slot_reserved`) is a VALUE.
	 * view: core's `SaveSlotsView` — `{ rows, continueSlot, activeSlot, pending,
	 * confirm, autosave: { on, target, inSec }, indicator }`.
	 */
	'saves.slots.apply': async (args) => {
		const m = 'saves.slots.apply';
		const s = session(m, args, 'saves.slots');
		const results = await applyOps(m, s, args, saveSlotsOps(m));
		return { results, view: plain(s.model.view()) };
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

	// ── props, interiors and the inventory panel (P6; PL.native-props-rows, U89(2)) ──
	//
	// Core's P6 logic, row for row; each answers in the shape core's P6 corpora
	// (`conformance/props/{containers,documents,doors,notice-board}.json`,
	// `conformance/ui/inventory-cases.json`) pin, so `tests/props_corpus.cpp` holds
	// every row to them. A domain refusal those corpora pin is a VALUE; what a row
	// refuses itself (a field of the wrong JSON type, which core's types declare
	// and JSON cannot hold) is an error `[invalid-input]`.

	/**
	 * `props.contract {}` → `{ <area>: { <table>: value } }` — the tables each P6
	 * corpus file's `contract` states as data (states, refusals, actions, the
	 * capacity, page size, quiz XP, the door's prompt radius and stand-off, the
	 * inventory's filters, colours, slot labels and empty messages, and the pick-up
	 * placement's kinds, clearances, search, frames, constants and deviations),
	 * from core's exported constants, keyed by the file's `area`. A binding reads
	 * its words and numbers here instead of restating them.
	 */
	'props.contract': () => propsContract(),

	/**
	 * `props.containers.view { container, context? }` → `{ view }` — core's
	 * `containerView`: `{ id, state (open | locked | unreachable), refusal,
	 * canUnlock, capacity, slotsUsed, slotsFree, full, respawnDue }`. `container` is
	 * a `ContainerRecord` (a runtime container, plus `buildingId`/`location` from
	 * the World IR); `context` is `{ playerItemIds?, buildings?: [{ id, interior }],
	 * now? }`.
	 */
	'props.containers.view': (args) => {
		const m = 'props.containers.view';
		const [container, ctx] = coded('invalid-input', () => [containerOf(m, args.container), containerContextOf(m, args.context)]);
		return { view: plain(containerView(container, ctx)) };
	},

	/**
	 * `props.containers.unlock { container, context? }` → `{ result, container }` —
	 * core's `unlockContainer`: `result` is `unlocked` (and `container` comes back
	 * with `locked: false`), `not_locked`, `no_key_item`, `key_missing`, or an
	 * unreachable container's refusal; the host stores the record it gets back.
	 */
	'props.containers.unlock': (args) => {
		const m = 'props.containers.unlock';
		const [container, ctx] = coded('invalid-input', () => [containerOf(m, args.container), containerContextOf(m, args.context)]);
		return plain(unlockContainer(container, ctx));
	},

	/**
	 * `props.containers.move { container, move: { kind: 'take' } | { kind: 'put',
	 * itemId }, context? }` → `{ refusal }` — core's `containerMoveRefusal`: null when
	 * `ui.trade` may run the move, else the first of `unknown_building`,
	 * `no_interior`, `locked`, `full` (a put that stacks onto a held id is allowed
	 * when full).
	 */
	'props.containers.move': (args) => {
		const m = 'props.containers.move';
		const [container, move, ctx] = coded('invalid-input', () => {
			const mv = needObject(m, args.move, 'move');
			oneOf(m, mv.kind, ['take', 'put'], 'move.kind');
			if (mv.kind === 'put') needString(m, mv.itemId, 'move.itemId');
			return [containerOf(m, args.container), mv, containerContextOf(m, args.context)];
		});
		return { refusal: containerMoveRefusal(container, move, ctx) };
	},

	/**
	 * `props.containers.at { containers, location: { businessId?, residenceId?,
	 * lotId? } }` → `{ ids }` — core's `containersAtLocation`, in input order.
	 */
	'props.containers.at': (args) => {
		const m = 'props.containers.at';
		const [containers, location] = coded('invalid-input', () => [
			needArray(m, args.containers, 'containers').map((c, i) => containerOf(m, c, `containers[${i}]`)),
			optObject(m, args.location, 'location') ?? {},
		]);
		return { ids: containersAtLocation(containers, location) };
	},

	/**
	 * `props.containers.respawn { container, now }` → `{ due }` — core's
	 * `containerRespawnDue` (`now` an ISO date-time or epoch milliseconds).
	 */
	'props.containers.respawn': (args) => {
		const m = 'props.containers.respawn';
		const [container, now] = coded('invalid-input', () => [containerOf(m, args.container), nowOf(m, args.now, 'now')]);
		return { due: containerRespawnDue(container, now) };
	},

	/**
	 * `props.documents.document { document, options?: { charsPerPage? } }` → core's
	 * `documentOf`: `{ ok: true, document }` (one `ReadableDocument` from a TextIR,
	 * a NoticeArticle, a book or a sign) or the refusal VALUE `{ ok: false, refusal:
	 * { code, field } }` (`missing_field`, `unknown_kind`, `bad_pages`,
	 * `bad_chars_per_page`). `document` goes to core unchecked: core types it
	 * `unknown` and refuses what it cannot read.
	 */
	'props.documents.document': (args) => {
		const m = 'props.documents.document';
		const options = coded('invalid-input', () => optObject(m, args.options, 'options') ?? {});
		return plain(documentOf(args.document, options));
	},

	/**
	 * `props.documents.paginate { text, charsPerPage? }` → `{ pages }` — core's
	 * `paginateText` (UTF-16 code units, word-boundary breaks, empty pages dropped;
	 * an absent `charsPerPage` is core's 800).
	 */
	'props.documents.paginate': (args) => {
		const m = 'props.documents.paginate';
		const [text, per] = coded('invalid-input', () => [needString(m, args.text, 'text'), optNumber(m, args.charsPerPage, 'charsPerPage')]);
		return { pages: per === undefined ? paginateText(text) : paginateText(text, per) };
	},

	/**
	 * `props.reader.create { document, options?, open?: { alreadyRead?,
	 * alreadyAnswered? } }` → `{ ok: true, session, document, view }` — the reader
	 * panel's `DocumentReader` over `documentOf(document, options)` (`document` is
	 * core's `ReadableDocument`, the pages a panel draws) — or, when `documentOf`
	 * refuses, its refusal VALUE `{ ok: false, refusal }` and no session.
	 * view: core's `DocumentReaderView` — `{ phase, page, pageCount, content,
	 * contentTranslation, canPrev, canNext, nextLabel, question, answer }`.
	 */
	'props.reader.create': (args) => {
		const m = 'props.reader.create';
		const [options, open] = coded('invalid-input', () => {
			const o = optObject(m, args.open, 'open') ?? {};
			optBoolean(m, o.alreadyRead, 'open.alreadyRead');
			optBoolean(m, o.alreadyAnswered, 'open.alreadyAnswered');
			return [optObject(m, args.options, 'options') ?? {}, o];
		});
		const r = documentOf(args.document, options);
		if (!r.ok) return plain(r);
		const model = new DocumentReader(r.document, open);
		return { ok: true, session: openSession('props.reader', { model }), document: plain(r.document), view: plain(model.view()) };
	},

	/**
	 * `props.reader.apply { session, ops }` → `{ results, view }`. ops are core's
	 * reader actions — `next` (Done on the last page), `prev`, `answer { index }`,
	 * `close` — and EVERY op goes to core's `step`: an action core does not know is
	 * its refusal VALUE `unknown_action`, never the row's error. Each result is
	 * `{ ok: true, events }` (`document_read`, `document_collected`, `reading_xp`,
	 * `vocabulary_added`, `clue_discovered`, `question_answered`, `document_closed`:
	 * the host raises them) or `{ ok: false, refusal: { code, field } }`.
	 */
	'props.reader.apply': async (args) => {
		const m = 'props.reader.apply';
		const s = session(m, args, 'props.reader');
		const results = await applySteps(m, s, args, ({ model }, op) => plain(model.step(op)));
		return { results, view: plain(s.model.view()) };
	},

	/**
	 * `props.doors.door { building }` → `{ door }` — core's `doorView`: `{ id, state
	 * (closed | locked | no_interior), doorAt, outside: { position, yaw }, label,
	 * interiorFunction }`. `building` is core's `DoorBuildingInput` (a BuildingIR's
	 * fields plus the host's name, lock, the layout's measured `door` and `doorYaw`).
	 */
	'props.doors.door': (args) => {
		const m = 'props.doors.door';
		const building = coded('invalid-input', () => needObject(m, args.building, 'building'));
		return { door: plain(doorView(building)) };
	},

	/**
	 * `props.doors.prompt { buildings, player: { position, inside? } }` → `{ prompt }`
	 * — core's `doorPrompt`: `{ building, action (enter | exit), label, state,
	 * distance }`, or null when nothing prompts.
	 */
	'props.doors.prompt': (args) => {
		const m = 'props.doors.prompt';
		const [buildings, player] = coded('invalid-input', () => {
			const p = needObject(m, args.player, 'player');
			const inside = insideOf(m, p.inside);
			if (!inside) needObject(m, p.position, 'player.position');
			return [doorBuildingsOf(m, args.buildings), p];
		});
		return { prompt: plain(doorPrompt(buildings, player)) };
	},

	/**
	 * `props.doors.step { buildings, inside?, playerItemIds?, action: { op: 'enter',
	 * building } | { op: 'exit' } }` → core's `doorStep`: `{ ok: true, handoff,
	 * inside }` (`enter_interior { building, interior, interiorFunction, arrive,
	 * entrance, unlocked }` or `exit_to_exterior { building, arrive, yaw }`; `inside`
	 * is where the player is after — the host keeps it) or the refusal VALUE `{ ok:
	 * false, refusal: { code, field } }`. `action` goes to core as it is, so an
	 * action core does not know is its `unknown_action`.
	 */
	'props.doors.step': (args) => {
		const m = 'props.doors.step';
		const [buildings, state, action] = coded('invalid-input', () => [
			doorBuildingsOf(m, args.buildings),
			{
				inside: insideOf(m, args.inside),
				playerItemIds: (optArrayValue(m, args.playerItemIds, 'playerItemIds') ?? []).map((id, i) =>
					needString(m, id, `playerItemIds[${i}]`),
				),
			},
			needObject(m, args.action, 'action'),
		]);
		return plain(doorStep(buildings, state, action));
	},

	/**
	 * `props.board.create { notices, fluency?, read?, answered?, questStatus? }` →
	 * `{ session, view }` — core's `NoticeBoard` for one settlement's board:
	 * `notices` are NoticeArticles (`props.notices.generate`'s, or the world's),
	 * `fluency` 0–100, `read`/`answered` the notice ids done before, `questStatus`
	 * quest id → its lifecycle status. view: core's `NoticeBoardView` — `{ rows,
	 * shown, hidden, unread, selected }`.
	 */
	'props.board.create': (args) => {
		const m = 'props.board.create';
		const input = coded('invalid-input', () => noticeBoardInputOf(m, args));
		const model = new NoticeBoard(input);
		return { session: openSession('props.board', { model }), view: plain(model.view()) };
	},

	/**
	 * `props.board.apply { session, ops }` → `{ results, view }`. ops are core's
	 * board actions — `select { id }`, `answer { id, index }`, `take_quest { id }` —
	 * and EVERY op goes to core's `step`: an action core does not know is its
	 * refusal VALUE `unknown_action`. Each result is `{ ok: true, events }`
	 * (`notice_read`, `reading_xp`, `question_answered`, `quest_requested`) or `{ ok:
	 * false, refusal: { code, field } }`.
	 */
	'props.board.apply': async (args) => {
		const m = 'props.board.apply';
		const s = session(m, args, 'props.board');
		const results = await applySteps(m, s, args, ({ model }, op) => plain(model.step(op)));
		return { results, view: plain(s.model.view()) };
	},

	/**
	 * `props.notices.generate { settlementId, settlementName, npcs: [{ characterId,
	 * name, occupation? }] }` → `{ articles }` — core's `generateSettlementNotices`:
	 * one NoticeArticle per NPC, chosen by occupation, deterministic.
	 */
	'props.notices.generate': (args) => {
		const m = 'props.notices.generate';
		const [id, name, npcs] = coded('invalid-input', () => [
			needString(m, args.settlementId, 'settlementId'),
			needString(m, args.settlementName, 'settlementName'),
			needArray(m, args.npcs, 'npcs').map((npc, i) => {
				needObject(m, npc, `npcs[${i}]`);
				needString(m, npc.characterId, `npcs[${i}].characterId`);
				needString(m, npc.name, `npcs[${i}].name`);
				if (npc.occupation !== undefined && npc.occupation !== null) needString(m, npc.occupation, `npcs[${i}].occupation`);
				return npc;
			}),
		]);
		return { articles: plain(generateSettlementNotices(id, name, npcs)) };
	},

	// Where a pick-up is put down (PL.native-pickup-settle, U91(2); core's
	// PL.pickup-placement, U89(3)). Stateless, one core function each, answering
	// the shape core's corpus runner (`runPickupPlacementOp`) records. Metres on
	// core's ground plane `(x, z)`, heights `y`; a binding maps its own frame in
	// (`props.contract`'s `props-pickup-placement.frames`; Unreal: its (X, Y) ÷ 100
	// as (x, z), its forward as `axis` unmirrored, its Z ÷ 100 as y). A refusal
	// (`bad-spot`, `no-clear-spot`) is a VALUE `{ ok: false, code }`; the rows'
	// own errors are `[invalid-input]` for a field of the wrong JSON type.

	/**
	 * `props.pickups.settle { spot, groundY?, settled?, obstacles?, roads?,
	 * walkable?, clearance?, search? }` → core's `settlePickup`: `{ ok: true, at,
	 * moved, shiftM, ring, clearanceM, nearest, authored, approach }`, or `{ ok:
	 * false, code: 'no-clear-spot', clearest, authored, approach }` (`clearest` is
	 * where an engine that still draws the pick-up draws it), or `{ ok: false,
	 * code: 'bad-spot' }`. `walkable` is the walkable ground as areas (absent:
	 * everywhere; empty: nowhere); core's `isWalkable` callback has no row.
	 */
	'props.pickups.settle': (args) => {
		const input = coded('invalid-input', () => pickupWorldOf('props.pickups.settle', args));
		return plain(settlePickup(input));
	},

	/**
	 * `props.pickups.sequence { pickups: [{ spot, groundY? }], obstacles?, roads?,
	 * walkable?, clearance?, search? }` → `{ placements }` — core's
	 * `settlePickups`: each settled in order, kept clear of those before it (a
	 * refused one where its `clearest` is; a `bad-spot` one nowhere).
	 */
	'props.pickups.sequence': (args) => {
		const input = coded('invalid-input', () => pickupWorldOf('props.pickups.sequence', args));
		return plain(settlePickups(input));
	},

	/**
	 * `props.pickups.clearance { spot, groundY?, settled?, obstacles?, roads?,
	 * clearance? }` → core's `pickupClearance`: `{ ok: true, clearanceM, nearest:
	 * { kind, index } | null }` (`clearanceM >= 0` is clear) or `{ ok: false,
	 * code: 'bad-spot' }`. A binding reads `ok` before `clearanceM`.
	 */
	'props.pickups.clearance': (args) => {
		const input = coded('invalid-input', () => pickupWorldOf('props.pickups.clearance', args));
		return plain(pickupClearance(input));
	},

	/**
	 * `props.pickups.pattern { search? }` → `{ rings: [{ radiusM, points }] }` —
	 * core's `pickupSearchPattern`: the rings the search walks out on.
	 */
	'props.pickups.pattern': (args) => {
		const search = coded('invalid-input', () => optObject('props.pickups.pattern', args.search, 'search'));
		return { rings: plain(pickupSearchPattern(search)) };
	},

	/**
	 * `props.pickups.ring { ring, search? }` → `{ points: [{ x, z }] }` — core's
	 * `pickupSearchRing`: ring `ring`'s (1-based) offsets from the authored spot,
	 * in the order tried, from +x toward +z (none past the search).
	 */
	'props.pickups.ring': (args) => {
		const m = 'props.pickups.ring';
		const [ring, search] = coded('invalid-input', () => [needNumber(m, args.ring, 'ring'), optObject(m, args.search, 'search')]);
		return { points: plain(pickupSearchRing(ring, search)) };
	},

	/**
	 * `inventory.create { player? }` → `{ session, view }` — the inventory panel's
	 * `InventoryViewModel` (`ui/inventory-model`, moved into core from Babylon by
	 * P6.core) over a `currentState.player` slice `{ gold, inventory }` (absent:
	 * an empty pack). view: `{ filter, counts: { total, shown }, gold, rows,
	 * equipment: { weapon, armor, accessory } (the equipped item's id or null),
	 * save: { gold, inventory } }` — the state core's inventory corpus records.
	 * Not `ui.trade`: that row is core's `TradeModel` (moving stock between the
	 * pack, a container and a merchant over the same slice); this is the panel.
	 */
	'inventory.create': (args) => {
		const m = 'inventory.create';
		const player = coded('invalid-input', () => inventorySliceOf(m, args.player, 'player'));
		const model = InventoryViewModel.fromSaveState(player);
		return { session: openSession('inventory', { model }), view: inventoryView(model) };
	},

	/**
	 * `inventory.apply { session, ops }` → `{ results, view }`. ops (core's corpus
	 * steps, then three a game needs): `add { item }` · `remove { item, quantity? }`
	 * · `filter { filter }` (an unknown key is ignored) · `toggle { group }` ·
	 * `set_gold`/`add_gold`/`remove_gold { amount }` (null is a non-finite amount) ·
	 * `equip_flag { item, equipped }` (writes `equipped` on the stored item, as a
	 * host's equip handler does) · `get { item }` → the stored item or null ·
	 * `items` → every stored item, insertion order, as `{ id, name, item }` ·
	 * `load { player }` (replace the store from a save slice) · `clear`.
	 */
	'inventory.apply': async (args) => {
		const m = 'inventory.apply';
		const s = session(m, args, 'inventory');
		const results = await applyOps(m, s, args, inventoryOps(m));
		return { results, view: inventoryView(s.model) };
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

	// ── the genre HUD and the world rules panel (P9a) ──
	// Each row is one of core's corpus runners and nothing else: the args are
	// `{ op, ...input }`, where `input` is a `conformance/ui/` case's `input` and
	// the answer is in that case's `expected` shape (key sets included; a key core
	// leaves undefined is absent). A domain refusal core's runner answers is a
	// VALUE, as the corpus pins it (`{ ok: false, refusal: { code, field } }`); an
	// op the runner does not declare, or an input the row cannot pass on, is an
	// ERROR with a code (`[unknown-op]`, `[invalid-input]`).

	/**
	 * `ui.genreHud { op: 'config'|'view'|'genre_view', ...input }` → core's
	 * `runGenreHudOp(op, input)` (`ui/genre-hud-corpus`): `config { genre }` → `{ ok,
	 * value: GenreHudConfig }`; `view { config, state? }` → `{ ok, value:
	 * GenreHudView }`; `genre_view { genre, state? }` → the view of that genre's own
	 * config. Refusal values: `unknown_genre`, `unknown_layout`. The row checks only
	 * `op` (core's `GENRE_HUD_OPS`): core's runner reads every input it is given.
	 */
	'ui.genreHud': (args) => {
		const { op, ...input } = args;
		return runGenreHudOp(opOf('ui.genreHud', op, GENRE_HUD_OPS), input);
	},

	/**
	 * `ui.rulesPanel { op: 'panel'|'card'|'byCategory'|'byType'|'isActive', ...input }`
	 * → core's `runRulesPanelOp(op, input)` (`ui/rules-panel-corpus`): `panel {
	 * worldRules?, baseRules? }` → `RulesPanelView`; `card { rule }` → `RuleCard`;
	 * `byCategory { rules, category }` / `byType { rules, ruleType }` → rule ids;
	 * `isActive { rules, ruleId }` → boolean. `op` is checked against core's
	 * `RULES_PANEL_OPS`, and each op's fields against the JSON types core's
	 * `PanelRule` declares (RULES_PANEL_INPUTS above) as `[invalid-input]`.
	 */
	'ui.rulesPanel': (args) => {
		const m = 'ui.rulesPanel';
		const { op, ...input } = args;
		opOf(m, op, RULES_PANEL_OPS);
		coded('invalid-input', () => RULES_PANEL_INPUTS[op](m, input));
		return runRulesPanelOp(op, input);
	},

	// ── the mechanic runtime (P9a) ──

	/**
	 * `mechanics.run { ir, seed, steps }` → `{ plan, steps, events }` — core's
	 * `runMechanicRuntimeCase` (`game-engine/mechanic-runtime-corpus`): the World
	 * IR's activation (`meta.genreConfig`, `meta.enabledModules`) assembles core's
	 * `createMechanicRuntime` (with `ir.routines` handed to the routine and
	 * locomotion directors), the steps run in order on its seven layers with no
	 * Prolog engine, and the answer is `conformance/modules/mechanic-runtime.json`'s
	 * `expected`: the plan, one result per step (`{ absent: true }` on a layer the
	 * world did not activate, else `{ absent: false, outcome, stamina }`) and the
	 * type of every event the one bus carried. Pure and seeded, like `weather.run`.
	 * Step ops: core's `MECHANIC_STEP_OPS` (imported, the `MechanicStep` union as
	 * data). The row checks the IR's shape, the seed and each step's `op`
	 * (`[invalid-input]`, `[unknown-op]`); a step's own fields go to core unchanged.
	 * `meta.enabledModules` goes to core unchecked, as core types it (`unknown`): a
	 * list that is not an array selects nothing and the genre decides, and a list
	 * holding the token `'none'` (core's `NO_MECHANIC_MODULES`) selects exactly its
	 * mechanic ids, so `['none']` assembles nothing whatever the genre, exactly as
	 * `modules.activate { ir }` answers the same IR (core's
	 * `conformance/modules/world-activation.json`, "rpg with a string", "rpg with
	 * 'none'"; `mechanic-runtime.json`, "survival with 'none': nothing assembled").
	 *
	 * Why a stateless `.run` and not a `mechanics.create`/`.apply` session pair:
	 * core defines the one operation as `{ ir, seed, steps }` → `{ plan, steps,
	 * events }` and exports it; the per-step answer (`outcome`, `stamina`) is a
	 * projection core keeps private to that runner, so a session would have to
	 * restate it here, and THE ROWS DECIDE NOTHING. A live game session also needs
	 * the layers' hosts (trajectory, perception, locomotion), which are engine
	 * callbacks that cannot cross this ABI — those are the per-system rows of
	 * P9b–P9j.
	 */
	'mechanics.run': (args) => {
		const m = 'mechanics.run';
		const input = coded('invalid-input', () => {
			const ir = needObject(m, args.ir, 'ir');
			const meta = needObject(m, ir.meta, 'ir.meta');
			needString(m, needObject(m, meta.genreConfig, 'ir.meta.genreConfig').id, 'ir.meta.genreConfig.id');
			if (ir.routines !== undefined && ir.routines !== null) needObject(m, ir.routines, 'ir.routines');
			const seed = typeof args.seed === 'string' ? args.seed : needNumber(m, args.seed, 'seed');
			const steps = needArray(m, args.steps, 'steps');
			steps.forEach((step, i) => needObject(m, step, `steps[${i}]`));
			return { ir, seed, steps };
		});
		input.steps.forEach((step, i) =>
			coded('unknown-op', () => oneOf(m, step.op, MECHANIC_STEP_OPS, `steps[${i}].op`)),
		);
		return runMechanicRuntimeCase(input);
	},

	/**
	 * `packs.compose { recipe?, world?, game?, engine?, catalog }` → core's
	 * `resolveComposition(request, catalog)`: the game's packs, its settings and
	 * activation, the overrides the composer wrote, and every refused choice. The
	 * args are a `conformance/packs/composition.json` case's `input` with the
	 * catalog beside it — `{ index, manifests }`, core's `packs/index.json` and
	 * each `packs/<id>/pack.json` as JSON (the files that corpus's `catalog`
	 * names); every other key is the request, passed to core unchanged. A choice
	 * core cannot honour is a refusal IN the answer; a recipe, preset, request
	 * or engine it cannot is an ERROR whose last_error carries core's code:
	 * `CompositionError: [<code>] …` or `GenreResolutionError: [<code>] …`.
	 * The row checks only the catalog's JSON shape (core's TypeScript types
	 * declare it; JSON cannot).
	 */
	'packs.compose': (args) => {
		const { catalog, ...request } = args;
		return resolveComposition(request, catalogOf('packs.compose', catalog));
	},

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

	// ── village layout (U23, U36) ──
	// One row per op core's layout corpus may name (`LAYOUT_OPS`, then
	// `COMPOSITION_OPS`), each `layout.<op>`. The rows are written out rather than
	// generated so the adopted surface stays reviewable here; `layout.ops`
	// returns core's two lists so the layout gate (tests/layout_corpus.cpp) can
	// fail when core gains an op this table does not have.

	/** `layout.ops` → `{ layout: LAYOUT_OPS, composition: COMPOSITION_OPS }`, core's lists as core declares them. */
	'layout.ops': () => ({ layout: [...LAYOUT_OPS], composition: [...COMPOSITION_OPS] }),

	'layout.isDoorPartName': layoutRow('isDoorPartName'),
	'layout.faceYawOf': layoutRow('faceYawOf'),
	'layout.chooseDoorPart': layoutRow('chooseDoorPart'),
	'layout.bodyStature': layoutRow('bodyStature'),
	'layout.fitBuildingToLot': layoutRow('fitBuildingToLot'),
	'layout.findFitOverlaps': layoutRow('findFitOverlaps'),
	'layout.settleSeparation': layoutRow('settleSeparation'),
	'layout.settleBodies': layoutRow('settleBodies'),
	'layout.settleFittedBuildings': layoutRow('settleFittedBuildings'),
	'layout.settleClearance': layoutRow('settleClearance'),
	'layout.clearancePairGap': layoutRow('clearancePairGap'),
	'layout.markerClearance': layoutRow('markerClearance'),
	'layout.plantWallClearance': layoutRow('plantWallClearance'),
	'layout.settleBuildingMaxShift': layoutRow('settleBuildingMaxShift'),
	'layout.pairingSeatSink': layoutRow('pairingSeatSink'),
	'layout.layoutObstaclesOf': layoutRow('layoutObstaclesOf'),
	'layout.plantTrunkOutline': layoutRow('plantTrunkOutline'),
	'layout.layoutConstants': layoutRow('layoutConstants'),
	// PL.start-clearance (U78): the start's clear ground, new in LAYOUT_OPS at core f9aef13.
	'layout.startClearOutline': layoutRow('startClearOutline'),
	'layout.buildGroundPlan': layoutRow('buildGroundPlan'),
	'layout.gradeTerrain': layoutRow('gradeTerrain'),
	'layout.followSettledBuildings': layoutRow('followSettledBuildings'),
	'layout.pathMouths': layoutRow('pathMouths'),
	'layout.lanternsAtPathMouths': layoutRow('lanternsAtPathMouths'),
	'layout.keepPlantPropsOffPaving': layoutRow('keepPlantPropsOffPaving'),
	'layout.trimGeneratedPoints': layoutRow('trimGeneratedPoints'),
	'layout.keepLookNeighbours': layoutRow('keepLookNeighbours'),
	'layout.keepStatedRows': layoutRow('keepStatedRows'),
	'layout.planDistances': layoutRow('planDistances'),
	'layout.margins': layoutRow('margins'),
	'layout.readGroundLayers': layoutRow('readGroundLayers'),
	'layout.resolveGroundPaint': layoutRow('resolveGroundPaint'),
	'layout.groundNoise': layoutRow('groundNoise'),
	'layout.groundCoverage': layoutRow('groundCoverage'),
	'layout.groundLayerWeights': layoutRow('groundLayerWeights'),
	'layout.clump': layoutRow('clump'),
	'layout.lookHash01': layoutRow('lookHash01'),
	'layout.lookNeighbours': layoutRow('lookNeighbours'),
	'layout.lookPropStands': layoutRow('lookPropStands'),
	'layout.backdropRing': layoutRow('backdropRing'),
	'layout.backdropFrame': layoutRow('backdropFrame'),

	// ── village composition (B9) ──
	'layout.composeLaneNetwork': compositionRow('composeLaneNetwork'),
	'layout.transitionCoverage': compositionRow('transitionCoverage'),
	'layout.edgeBreakup': compositionRow('edgeBreakup'),
	'layout.groundTransitionCoverage': compositionRow('groundTransitionCoverage'),
	'layout.transitionBounds': compositionRow('transitionBounds'),
	'layout.auditGroundEdges': compositionRow('auditGroundEdges'),
	'layout.coverageAudit': compositionRow('coverageAudit'),
	'layout.propPurpose': compositionRow('propPurpose'),
	'layout.groupProps': compositionRow('groupProps'),
	'layout.auditPropGroups': compositionRow('auditPropGroups'),
	'layout.trimFloraOffSquare': compositionRow('trimFloraOffSquare'),
	'layout.yardRole': compositionRow('yardRole'),
	'layout.composeYards': compositionRow('composeYards'),
	'layout.lanternsOnRoutes': compositionRow('lanternsOnRoutes'),
	'layout.foliageKind': compositionRow('foliageKind'),
	'layout.composeFoliage': compositionRow('composeFoliage'),
	'layout.auditFoliageSpacing': compositionRow('auditFoliageSpacing'),
	'layout.assignHouseModels': compositionRow('assignHouseModels'),
	'layout.seatCapacity': compositionRow('seatCapacity'),
	'layout.seatVillagers': compositionRow('seatVillagers'),
	'layout.keepClearOfProps': compositionRow('keepClearOfProps'),
	'layout.composeVillage': compositionRow('composeVillage'),
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
