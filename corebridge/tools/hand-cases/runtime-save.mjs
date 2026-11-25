// hand-cases/runtime-save.mjs — the hand cases of the save.runtime.* and save.interior.* rows
// (PL.native-runtime-save-rows), beyond core's two corpora (conformance/saves/runtime-save.json,
// conformance/saves/interior-state.json): each contract whole; what a runtime-save session answers
// that the corpus does not pin (a Load's game state, a Save's written document, a refusal whole with
// `found`, `expected` and core's message, several ops in one apply); the rows' boundary; and the
// interior-save exports the corpus reaches only through `interiorLoadOf` (`layoutSeedOf`,
// `statedInteriorState`, `interiorFramePoint`, `interiorExtentOf`, `isInteriorFramePoint`).
//
// Written by tools/gen-hand-cases.mjs: every `expect` below is core's own answer at the pin, computed
// by the calls this file makes on core's `RuntimeSave` and `props/interior-save` (see that tool's
// header). Every save, world and building is synthetic.

import { RuntimeSave } from '@insimul/core/runtime-save';
import { writeVillageSave } from '@insimul/core/save-file-game-state';
import { SLOT_MESSAGES } from '@insimul/core/ui/save-slot-model';
import {
	DEFAULT_INTERIOR_FLOOR_HEIGHT_M,
	INTERIOR_LOAD_NOTES,
	INTERIOR_POSITION_TOLERANCE_M,
	interiorExtentOf,
	interiorFramePoint,
	interiorLayoutOf,
	interiorLoadOf,
	isInteriorFramePoint,
	layoutSeedOf,
	readInteriorState,
	statedInteriorState,
} from '@insimul/core/props/interior-save';

export const output = 'bridge-runtime-save.json';
export const area = 'saves-runtime-hand';
export const description =
	"Hand cases for the save.runtime.* and save.interior.* rows (PL.native-runtime-save-rows) beyond core's runtime-save and " +
	'interior-state corpora: each contract whole; a runtime save session answered whole (a Load\'s game state, a Save\'s written ' +
	"document, a refusal with found, expected and core's message, several ops in one apply, a refused step not stopping the " +
	"batch); the rows' [invalid-input] boundary; and core's layoutSeedOf, statedInteriorState, interiorFramePoint, " +
	'interiorExtentOf and isInteriorFramePoint, which the corpus reaches only through interiorLoadOf. Every expectation is ' +
	"core's own answer at the pin, computed by tools/hand-cases/runtime-save.mjs through tools/gen-hand-cases.mjs.";

const plain = (v) => (v === undefined ? null : JSON.parse(JSON.stringify(v)));
const W = '0a1b2c3d4e5f60718293a4b5';
const OTHER = 'f0e1d2c3b4a5968778695a4b';

const fresh = {
	id: 'hand-new-game',
	worldId: W,
	slotIndex: 0,
	version: 3,
	lastSavedAt: '2026-11-25T00:00:00Z',
	currentState: {
		player: { position: { x: 0, y: 0, z: 0 }, rotation: { x: 0, y: 0, z: 0 }, gold: 50, health: 100, energy: 100, inventory: [] },
		quests: { progress: {} },
		npcs: { relationships: {} },
		prologFacts: [],
		extensions: {},
	},
	conversations: [],
};
const gameState = (gold, interiorState) => ({
	version: 3,
	savedAt: 1,
	gameTime: 12.5,
	player: { position: { x: 3, y: 0, z: -4 }, rotation: { x: 0, y: 0.5, z: 0 }, gold, health: 90, energy: 70, inventory: [{ id: 'bread' }] },
	npcs: [{ id: 'npc_hand', position: { x: 1, y: 0, z: 2 }, state: 'idle', activity: 'rest', destinationId: null, runtimeState: 'idle' }],
	relationships: {},
	questProgress: {},
	...(interiorState === undefined ? {} : { interiorState }),
});
const writeOptions = { worldId: W, runtime: 'unreal-village', positionFrame: 'world-ir-m', tick: 12.5 };
const readOptions = { worldId: W, runtime: 'unreal-village' };

/** A save the game wrote (stamped with writeOptions' runtime), from core's checked writer. */
function written(gs, opts = writeOptions, over = {}) {
	const doc = { ...fresh, id: 'hand-slot-1', ...over };
	const w = writeVillageSave(doc, gs, opts);
	if (!w.ok) throw new Error(`hand-cases/runtime-save: the fixture write was refused: ${w.refusal.code}`);
	return plain({ ...doc, currentState: w.value.currentState, conversations: w.value.conversations });
}

/** The row's answer to one op, from the same op on core's RuntimeSave (entry.js runtimeLoaded / runtimeSaved). */
function opAnswer(rs, op) {
	if (op.op === 'new_game') {
		rs.newGame();
		return { ok: true };
	}
	if (op.op === 'load') {
		const r = rs.load(op.save, op.options);
		return r.ok ? { ok: true, gameState: plain(r.gameState) } : { ok: false, refusal: plain(r.refusal), outcome: r.outcome, message: r.message };
	}
	const r = rs.save(op.gameState, op.options);
	return r.ok ? { ok: true, save: plain(r.save) } : { ok: false, refusal: plain(r.refusal) };
}

/** A runtime-save session as steps: create over `start`, then one apply per batch, each answered by core. */
function session(start, batches) {
	const rs = new RuntimeSave(start);
	const steps = [{ call: 'save.runtime.create', args: { fresh: start }, expect: { session: 1, runtimeSave: plain(rs.current()), fresh: rs.isFresh() } }];
	for (const ops of batches) {
		const results = ops.map((op) => opAnswer(rs, op));
		steps.push({ call: 'save.runtime.apply', args: { session: 1, ops }, expect: { results, runtimeSave: plain(rs.current()), fresh: rs.isFresh() } });
	}
	return steps;
}

// Buildings in the doors model's input, with the interior's extent (synthetic).
const tavern = {
	id: 'bld_hand_tavern',
	position: { x: 120, y: 0, z: 40 },
	rotation: 1.2,
	spec: { buildingRole: 'Tavern', width: 12, depth: 9, floors: 2 },
	name: 'The Lantern',
	businessType: 'Tavern',
	interior: {
		function: 'business.Tavern',
		width: 11.6,
		depth: 8.6,
		height: 6,
		floors: 2,
		doors: [
			{ id: 'hall~kitchen', fromRoomId: 'hall', toRoomId: 'kitchen', kind: 'door', position: { x: 8, y: 0, z: 4.3 } },
			{ id: 'hall!entrance', fromRoomId: '', toRoomId: 'hall', kind: 'entrance', position: { x: 5.8, y: 0, z: 0 } },
		],
	},
};
const shed = { id: 'bld_hand_shed', position: { x: 10, y: 0, z: 10 }, rotation: 0, spec: { buildingRole: 'Shed', width: 4, depth: 3 }, interior: { function: 'storage', width: 3.6, depth: 2.6 } };
const cottage = { id: 'bld_hand_cottage', position: { x: -20, y: 0, z: 5 }, rotation: -0.6, spec: { width: 6, depth: 5 } };
const stated = (b) => plain(statedInteriorState(b));

export function build() {
	const cases = [];
	const c = (name, steps) => cases.push({ name, steps });
	const one = (call, args, expect) => ({ call, args, expect });
	const inv = (call, args, text) => ({ call, args, expectError: text });

	// ── 1. The contracts, whole ──
	c('save.runtime.contract and save.interior.contract state core\'s values, exactly', [
		{ call: 'save.runtime.contract', expect: { refusedLoadMessage: SLOT_MESSAGES.invalid_format } },
		{
			call: 'save.interior.contract',
			expect: { positionToleranceM: INTERIOR_POSITION_TOLERANCE_M, defaultFloorHeightM: DEFAULT_INTERIOR_FLOOR_HEIGHT_M, loadNotes: [...INTERIOR_LOAD_NOTES] },
		},
	]);

	// ── 2. A runtime save session answered whole ──
	const own = written(gameState(70, stated(tavern)));
	const otherWorld = written(gameState(71), { ...writeOptions, worldId: OTHER }, { worldId: OTHER });
	const otherRuntime = written(gameState(72), { ...writeOptions, runtime: 'bjs-village' });
	const v2 = { ...own, version: 2 };
	c('a session: Load answers the game state, Save the written document, New Game the fresh one', session(fresh, [
		[{ op: 'load', save: own, options: readOptions }],
		[{ op: 'save', gameState: gameState(80), options: writeOptions }],
		[{ op: 'new_game' }],
		[{ op: 'save', gameState: gameState(81, null), options: writeOptions }],
	]));
	c("a refused Load answers core's refusal whole (found, expected, its message), the slot outcome and the message it shows", session(fresh, [
		[{ op: 'load', save: otherWorld, options: readOptions }],
		[{ op: 'load', save: otherRuntime, options: readOptions }],
		[{ op: 'load', save: v2, options: readOptions }],
		[{ op: 'load', save: otherRuntime, options: { worldId: W } }],
	]));
	c('several ops in one apply run in order, and a refused one does not stop the batch', session(fresh, [
		[
			{ op: 'load', save: own, options: readOptions },
			{ op: 'load', save: otherWorld, options: readOptions },
			{ op: 'save', gameState: { ...gameState(90), version: 2 }, options: writeOptions },
			{ op: 'save', gameState: gameState(91), options: writeOptions },
			{ op: 'new_game' },
		],
		[],
	]));
	c('a session over a fresh document holding only its version: the checked writer fills it, a Load replaces it, New Game restores it', session({ version: 3 }, [
		[{ op: 'save', gameState: gameState(10), options: writeOptions }],
		[{ op: 'load', save: own, options: readOptions }],
		[{ op: 'new_game' }],
	]));

	// ── 3. The rows' boundary ──
	c("the runtime save rows' [invalid-input] boundary, and the session table's errors", [
		inv('save.runtime.create', { fresh: null }, '[invalid-input] insimulcore: save.runtime.create: `fresh` must be a JSON object'),
		inv('save.runtime.create', {}, '[invalid-input] insimulcore: save.runtime.create: `fresh` must be a JSON object'),
		one('save.runtime.create', { fresh }, { session: 1, runtimeSave: plain(new RuntimeSave(fresh).current()), fresh: true }),
		inv('save.runtime.apply', { session: 1, ops: [{ op: 'load', save: 'slot-1', options: readOptions }] }, '[invalid-input] insimulcore: save.runtime.apply: ops[0] (load) failed: insimulcore: save.runtime.apply: `save` must be a JSON object'),
		inv('save.runtime.apply', { session: 1, ops: [{ op: 'load', save: own }] }, '`options` must be a JSON object'),
		inv('save.runtime.apply', { session: 1, ops: [{ op: 'load', save: own, options: { runtime: 'unreal-village' } }] }, '`options.worldId` must be a string'),
		inv('save.runtime.apply', { session: 1, ops: [{ op: 'load', save: own, options: { worldId: W, runtime: 7 } }] }, '`options.runtime` must be a string'),
		inv('save.runtime.apply', { session: 1, ops: [{ op: 'save', gameState: gameState(1), options: { ...writeOptions, tick: 'now' } }] }, '`options.tick` must be a finite number'),
		inv('save.runtime.apply', { session: 1, ops: [{ op: 'save', gameState: gameState(1), options: { worldId: W, runtime: 'unreal-village', tick: 1 } }] }, '`options.positionFrame` must be a string'),
		inv('save.runtime.apply', { session: 1, ops: [{ op: 'quick_save' }] }, 'has no known op "quick_save" (known: new_game, load, save)'),
		inv('save.runtime.apply', { session: 1, ops: { op: 'new_game' } }, '`ops` must be an array'),
		inv('save.runtime.apply', { session: 2, ops: [] }, 'no open session 2'),
		one('session.list', {}, { sessions: [{ session: 1, kind: 'save.runtime' }] }),
		one('session.dispose', { session: 1 }, { disposed: true }),
		inv('save.runtime.apply', { session: 1, ops: [] }, 'no open session 1'),
	]);

	// ── 4. The interior save's exports the corpus reaches only through interiorLoadOf ──
	const seeds = [null, 0, 7, -3, 2.5, '7', true, [], {}, 1e21];
	c('save.interior.layoutSeedOf: an integer is a seed (0 and negatives included), anything else the stated sentinel null', [
		...seeds.map((s) => one('save.interior.layoutSeedOf', { layoutSeed: s }, { layoutSeed: layoutSeedOf(s) })),
		one('save.interior.layoutSeedOf', {}, { layoutSeed: layoutSeedOf(undefined) }),
	]);
	const reads = [
		5, 'bld_hand_tavern', [], null, {}, { buildingId: '' }, { buildingId: 7 },
		{ buildingId: 'bld_hand_tavern', buildingName: 3, buildingType: null, layoutSeed: 4, extra: true },
		{ buildingId: 'bld_hand_tavern', buildingName: 'The Lantern', buildingType: 'Tavern', layoutSeed: -1 },
	];
	c('save.interior.read reads anything into the one shape or null; save.interior.layoutOf names a read state stated or seeded', [
		...reads.map((v) => one('save.interior.read', { interiorState: v }, { interiorState: plain(readInteriorState(v)) })),
		one('save.interior.read', {}, { interiorState: plain(readInteriorState(undefined)) }),
		...[{ layoutSeed: null }, { layoutSeed: 0 }, { layoutSeed: 12 }, readInteriorState(reads[7])].map((s) =>
			one('save.interior.layoutOf', { interiorState: s }, { layout: interiorLayoutOf(s) }),
		),
		inv('save.interior.layoutOf', { interiorState: null }, '[invalid-input] insimulcore: save.interior.layoutOf: `interiorState` must be a JSON object'),
	]);
	const labelled = [
		tavern,
		{ ...tavern, name: '', businessType: 'Inn' },
		{ ...tavern, name: null, businessType: null },
		{ ...cottage },
		{ ...shed, spec: { buildingRole: 9 } },
	];
	c("save.interior.stated: what a writer puts in interiorState, the door's label and the building's role, layoutSeed null", [
		...labelled.map((b) => one('save.interior.stated', { building: b }, { interiorState: stated(b) })),
		inv('save.interior.stated', { building: 'bld_hand_tavern' }, '[invalid-input] insimulcore: save.interior.stated: `building` must be a JSON object'),
	]);
	const frames = [
		[{ x: 5120.3, y: 0.9, z: -4996.5 }, { x: 5000, y: 0, z: -5000 }],
		[{ x: 0.3, y: 0, z: 0.1 }, { x: 0.1, y: 0, z: 0.2 }],
		[{ x: 1, y: 2, z: 3 }, { x: 1, y: 2, z: 3 }],
		[{ x: -1e-10, y: 0, z: 0 }, { x: 0, y: 0, z: 0 }],
	];
	c('save.interior.framePoint: a host\'s point minus where it drew the frame\'s origin, rounded to 1e-9', [
		...frames.map(([p, o]) => one('save.interior.framePoint', { position: p, origin: o }, { position: plain(interiorFramePoint(p, o)) })),
		inv('save.interior.framePoint', { position: { x: 1, y: 2, z: 3 } }, '[invalid-input] insimulcore: save.interior.framePoint: `origin` must be a JSON object'),
		inv('save.interior.framePoint', { position: { x: 1, y: '2', z: 3 }, origin: { x: 0, y: 0, z: 0 } }, '`position.y` must be a finite number'),
	]);
	const interiors = [
		null, 5, {}, tavern.interior, shed.interior, { width: 0, depth: 4 }, { width: 4, depth: -1 }, { width: 4, depth: 4, floors: 3 },
		{ width: 4, depth: 4, floors: 0 }, { width: 4, depth: 4, floors: 2.7 }, { width: 4, depth: 4, height: -2, floors: 2 }, { width: '4', depth: 4 },
	];
	c('save.interior.extentOf: width and depth as stated, height as stated or floors (at least 1) times the default storey', [
		...interiors.map((x) => one('save.interior.extentOf', { interior: x }, { extent: plain(interiorExtentOf(x)) })),
		one('save.interior.extentOf', {}, { extent: plain(interiorExtentOf(undefined)) }),
	]);
	const t = INTERIOR_POSITION_TOLERANCE_M;
	const points = [
		{ x: 5, y: 1, z: 4 }, { x: -t, y: 0, z: 0 }, { x: -t - 1e-6, y: 0, z: 0 }, { x: 11.6 + t, y: 6 + t, z: 8.6 + t }, { x: 11.6, y: 6 + t + 1e-6, z: 1 },
		{ x: 5, y: 1 }, { x: 5, y: '1', z: 4 }, null, { x: 5120.3, y: 0.9, z: -4996.5 },
	];
	c('save.interior.isFramePoint: within the tolerance of the extent on every axis, false when there is no extent or no point', [
		...points.map((p) => one('save.interior.isFramePoint', { position: p, interior: tavern.interior }, { isFramePoint: isInteriorFramePoint(p, tavern.interior) })),
		one('save.interior.isFramePoint', { position: { x: 1, y: 1, z: 1 }, interior: shed.interior }, { isFramePoint: isInteriorFramePoint({ x: 1, y: 1, z: 1 }, shed.interior) }),
		one('save.interior.isFramePoint', { position: { x: 1, y: 3.4, z: 1 }, interior: shed.interior }, { isFramePoint: isInteriorFramePoint({ x: 1, y: 3.4, z: 1 }, shed.interior) }),
		one('save.interior.isFramePoint', { position: { x: 1, y: 1, z: 1 }, interior: null }, { isFramePoint: isInteriorFramePoint({ x: 1, y: 1, z: 1 }, null) }),
	]);
	const buildings = [tavern, shed, cottage];
	const loads = [
		{ interiorState: stated(tavern), position: { x: 5, y: 3.2, z: 4 } },
		{ interiorState: stated(tavern), position: { x: 5, y: 1, z: 40 }, rotation: { x: 0, y: 2, z: 0 } },
		{ interiorState: stated(shed), position: { x: 50, y: 0, z: 50 } },
		{ interiorState: { ...stated(tavern), layoutSeed: 3 }, position: { x: 5, y: 1, z: 4 } },
		{ interiorState: { buildingId: 'bld_hand_cottage', buildingName: 'Cottage', buildingType: '', layoutSeed: null }, position: { x: 1, y: 0, z: 1 } },
		{ interiorState: { buildingId: '' }, position: { x: 9, y: 0, z: 9 }, rotation: { x: 0, y: 1, z: 0 } },
		{ interiorState: null, position: null },
		{ interiorState: null, position: { x: 9, y: 0, z: 9 }, rotation: 'north' },
	];
	c('save.interior.loadOf beyond the corpus: a rotation absent or unreadable, an unreadable interiorState, a stated interior with no entrance', [
		...loads.map((s) => one('save.interior.loadOf', { ...s, buildings }, plain(interiorLoadOf(s, buildings)))),
		inv('save.interior.loadOf', { interiorState: null, position: { x: 0, y: 0, z: 0 }, buildings: {} }, '[invalid-input] insimulcore: save.interior.loadOf: `buildings` must be an array'),
		inv('save.interior.loadOf', { interiorState: null, position: { x: 0, y: 0, z: 0 }, buildings: [tavern, null] }, '`buildings[1]` must be a JSON object'),
	]);
	return cases;
}
