// hand-cases/hillside.mjs — the hand cases of the hillside.gradingPlan and hillside.contract rows
// (PL.native-grading-plan-call), beyond core's corpus (conformance/hillside/pads.json): the plan WHOLE
// as the row answers it (unrounded, its `dividers` included, which the corpus does not state), worlds
// of this file's own that pin each constant of the plan (a terrace depth and a wall step on a 26 %
// slope; the wall count stopping at HILLSIDE_MAX_WALLS on a 50 % one; a pair divided, a shared
// terrace and an overlap held or charged by the overlap lattice, its difference and its tolerance),
// each engine's own legacy scale where a world states no relief, core's refusals as values, the pad
// set with GradeLots' pads, and the rows' [invalid-input] boundary.
//
// Written by tools/gen-hand-cases.mjs: every `expect` below is core's own answer at the pin, computed
// by the calls this file makes on core's `editor/scene/hillside-grading` (see that tool's header).
// Every world is synthetic: a square terrain 64 m a side over a plane or a ridge, as core's emitter
// (scripts/emit-hillside-corpus.ts) states its worlds.

import { PLAYER_GROUND } from '@insimul/core/camera/movement-rules';
import { GRADED_CELL_M, LOT_PAD_BLEND_M, LOT_PAD_MARGIN_M } from '@insimul/core/editor/layout/ground-plan';
import {
	BLEND_MAX_RISE_M,
	HILLSIDE_MAX_WALLS,
	MAP_PAD_ID_PREFIX,
	OVERLAP_SLOPE_DIFF_M,
	OVERLAP_SLOPE_LATTICE_M,
	OVERLAP_SLOPE_TOLERANCE,
	STAND_MAX_GRADIENT,
	TERRACE_DEPTH_M,
	WALL_MAX_M,
	WALL_STEP_MIN_M,
	checkPadSet,
	computeGradingPlan,
	gradingPlanHeight,
} from '@insimul/core/editor/scene/hillside-grading';

export const output = 'bridge-hillside.json';
export const area = 'hillside-hand';
export const description =
	"Hand cases for the hillside.gradingPlan and hillside.contract rows (PL.native-grading-plan-call) beyond core's " +
	'hillside grading corpus: the plan whole (unrounded, dividers included), worlds that pin each of its constants (the ' +
	'terrace depth and the wall step, the wall count stopping at HILLSIDE_MAX_WALLS, divided neighbours and a shared ' +
	'terrace, the overlap lattice, its difference and its tolerance), each engine\'s legacy scale, core\'s refusals as ' +
	"values, GradeLots' pads in one set, and the rows' [invalid-input] boundary. Every expectation is core's own answer " +
	'at the pin, computed by tools/hand-cases/hillside.mjs through tools/gen-hand-cases.mjs.';

const SIZE = 64;
const HALF = SIZE / 2;
const RES = 17;
const ENGINES = ['unreal', 'unity', 'godot', 'babylon'];

const r6 = (v) => {
	const r = Math.round(v * 1e6) / 1e6;
	return r === 0 ? 0 : r;
};

/** A `res` × `res` heightmap of `h` (frame metres) normalised by `scale`, rounded to 1e-6 (core's emitter's rule). */
function heightmap(h, scale, res) {
	const rows = [];
	for (let j = 0; j < res; j += 1) {
		const row = [];
		for (let i = 0; i < res; i += 1) row.push(r6(h((SIZE * i) / (res - 1), (SIZE * j) / (res - 1)) / scale));
		rows.push(row);
	}
	return rows;
}

/** A building footprint record `footprint.map.<id>` over an axis-aligned rectangle (frame centre, width along x, depth along z). */
function building(id, cx, cz, w, d, kind = 'building') {
	return {
		id: `footprint.map.${id}`,
		sourceFeatureId: id,
		kind,
		points: [
			[-1, -1],
			[1, -1],
			[1, 1],
			[-1, 1],
		].map(([s, q]) => ({ x: r6(cx + (s * w) / 2 - HALF), z: r6(cz + (q * d) / 2 - HALF) })),
	};
}

/** A World IR as core's emitter states one: relief stated (`elevation`) unless `noRelief`. */
function world(id, h, scale, footprints, extra = {}) {
	const geography = {
		terrainSize: SIZE,
		heightmap: heightmap(h, scale, extra.res ?? RES),
		...(extra.noRelief ? {} : { elevation: { minM: 0, maxM: scale, verticalScaleM: scale } }),
		layers: { footprints },
		...(extra.geography ?? {}),
	};
	return { meta: { worldId: id, seed: id }, geography, entities: {} };
}

const plane = (base, grade, angle) => (x, z) => base + grade * ((x - 32) * Math.cos(angle) + (z - 32) * Math.sin(angle));

/**
 * The row's answer, from core's own functions (entry.js `gradingPlanAnswer`): `points` and
 * `otherPads` sent as null are not sent (the row's boundary), so no `points` and no `padSet`.
 */
function planRow(args) {
	const result = computeGradingPlan(args.world, { engine: args.engine });
	if (!result.ok) return JSON.parse(JSON.stringify(result));
	const { plan, raw } = result;
	const answer = { ok: true, engine: result.engine, plan: JSON.parse(JSON.stringify(plan)) };
	const points = args.points ?? undefined;
	const sentPads = args.otherPads ?? undefined;
	const otherPads = sentPads ?? [];
	if (points !== undefined) {
		answer.points = points.map((pt) => ({
			...(pt.label !== undefined ? { label: pt.label } : {}),
			x: pt.x,
			z: pt.z,
			raw: gradingPlanHeight({ pads: [] }, raw, pt.x, pt.z),
			graded: gradingPlanHeight(plan, raw, pt.x, pt.z, otherPads),
		}));
	}
	if (sentPads !== undefined) answer.padSet = checkPadSet(plan, otherPads);
	return answer;
}

/** The plan alone (for the witnesses below). */
const planOf = (w, engine = 'unreal') => {
	const r = computeGradingPlan(w, { engine });
	if (!r.ok) throw new Error(`witness world ${w.meta.worldId} refused: ${r.refused}`);
	return r.plan;
};

const assert = (cond, what) => {
	if (!cond) throw new Error(`hillside hand cases: the witness does not hold: ${what}`);
};

const P = (label, x, z) => ({ label, x, z });

export function build() {
	const cases = [];
	const c = (name, steps) => cases.push({ name, steps });
	const plan = (args) => ({ call: 'hillside.gradingPlan', args, expect: planRow(args) });
	const inv = (args, text) => ({ call: 'hillside.gradingPlan', args, expectError: `[invalid-input] insimulcore: hillside.gradingPlan: ${text}` });

	// ── 1. The contract: core's constants whole ──
	const contract = {
		padIdPrefix: MAP_PAD_ID_PREFIX,
		lotPadMarginM: LOT_PAD_MARGIN_M,
		lotPadBlendM: LOT_PAD_BLEND_M,
		gradedCellM: GRADED_CELL_M,
		standMaxDeg: PLAYER_GROUND.standMaxDeg,
		standMaxGradient: STAND_MAX_GRADIENT,
		blendMaxRiseM: BLEND_MAX_RISE_M,
		wallMaxM: WALL_MAX_M,
		terraceDepthM: TERRACE_DEPTH_M,
		hillsideMaxWalls: HILLSIDE_MAX_WALLS,
		wallStepMinM: WALL_STEP_MIN_M,
		overlapSlopeLatticeM: OVERLAP_SLOPE_LATTICE_M,
		overlapSlopeDiffM: OVERLAP_SLOPE_DIFF_M,
		overlapSlopeTolerance: OVERLAP_SLOPE_TOLERANCE,
	};
	c('hillside.contract states core\'s constants whole (standMaxGradient and blendMaxRiseM unrounded)', [
		{ call: 'hillside.contract', expect: contract },
		{ call: 'hillside.contract', args: { ignored: true }, expect: contract },
	]);

	// ── 2. A terraced pad: the terrace depth and the wall step ──
	const terraced = world('hand-terraced-26', plane(30, 0.26, 0.5), 60, [building('fp', 32, 32, 12, 8)]);
	const tPlan = planOf(terraced);
	assert(tPlan.pads.length === 1 && tPlan.pads[0].hillside && tPlan.pads[0].wallCount === 3, 'the 26 % pad is terraced with 3 walls');
	assert(tPlan.pads[0].terraceDepthM === TERRACE_DEPTH_M && tPlan.findings.length === 0, 'its terraces are one margin deep, no finding');
	const tRise = Math.max(...tPlan.walls.flatMap((w) => w.vertices.map((v) => v.top - v.base)));
	assert(tRise > 1 && tRise <= WALL_MAX_M + 1e-9, `its highest wall steps ${tRise} m, within the limit and near it`);
	const tPoints = [
		P('centre (flat area)', 32, 32),
		P('the first terrace, uphill', 32, 38.5),
		P('the third terrace, downhill', 32, 20.5),
		P('a corner fan', 41, 40),
		P('the band', 32, 50),
		{ x: 5, z: 5 },
	];
	c('hillside.gradingPlan: a pad on a 26 % slope is terraced (three walls, one margin apart, each stepping at most WALL_MAX_M): the plan whole and its points', [
		plan({ world: terraced, engine: 'unreal', points: tPoints }),
		plan({ world: terraced, engine: 'babylon' }),
	]);

	// ── 3. HILLSIDE_MAX_WALLS: the walls stop, and every limit is a finding ──
	const cliff = world('hand-cliff-50', plane(30, 0.5, 0.5), 60, [building('fp', 32, 32, 12, 8)]);
	const cPlan = planOf(cliff);
	assert(cPlan.pads[0].wallCount === HILLSIDE_MAX_WALLS, 'the 50 % pad stops at HILLSIDE_MAX_WALLS');
	assert(cPlan.findings.some((f) => f.includes('walls of')) && cPlan.findings.some((f) => f.includes('steeper than')), 'its limits are findings');
	c('hillside.gradingPlan: a pad on a 50 % slope stops at HILLSIDE_MAX_WALLS walls, and the raw slope, the short walls and the fan steps are findings', [
		plan({ world: cliff, engine: 'unreal', points: [P('centre', 32, 32), P('the eighth terrace, uphill', 32, 51)] }),
	]);

	// ── 4. Divided neighbours: the plan's dividers, one wall and a shared terrace ──
	const hillTown = world('hand-neighbours', plane(14, 0.25, 0.5), 30, [building('a', 23.5, 32, 8, 8), building('b', 40.5, 32, 8, 8)]);
	const nPlan = planOf(hillTown);
	assert(nPlan.dividers?.length === 1 && nPlan.dividers[0].stripHalfM === 0 && nPlan.findings.length === 0, 'the hill-town pair is divided by one wall, no finding');
	const gap = world('hand-shed-gap', (x) => 14 + 0.17 * (x - 32), 30, [building('a', 28, 32, 12, 12), building('b', 37.5, 32, 3, 3)]);
	const gPlan = planOf(gap);
	assert(gPlan.dividers?.length === 1 && gPlan.dividers[0].stripHalfM > 0, 'the house and shed across a gap share a terrace');
	c('hillside.gradingPlan: neighbours whose blend breaks the slope bound are divided, and the plan carries each division (one wall; a shared terrace)', [
		plan({ world: hillTown, engine: 'unreal', points: [P('on the dividing line', 32, 32), P("A's side", 31, 32), P("B's side", 33, 32)] }),
		plan({ world: gap, engine: 'unreal', points: [P('the shared terrace', 35, 32)] }),
	]);

	// ── 5. Each engine's own legacy scale where the world states no relief ──
	const legacy = world('hand-legacy', plane(0.4, 0.004, 0), 1, [building('fp', 32, 32, 8, 8)], { noRelief: true });
	const heights = ENGINES.map((e) => planOf(legacy, e).pads[0].height);
	assert(new Set(heights.map((h) => r6(h))).size > 1, 'the engines\' legacy scales give different targets');
	c('hillside.gradingPlan: a world with no stated relief is projected with each engine\'s own legacy scale (four targets)', ENGINES.map((engine) => plan({ world: legacy, engine, points: [P('centre', 32, 32)] })));

	// ── 6. Core's refusals are values ──
	const flat = world('hand-flat', () => 1, 10, [building('fp', 32, 32, 8, 8)]);
	c('hillside.gradingPlan: a world core cannot place is its refusal value, never an error', [
		plan({ world: flat, engine: 'cryengine' }),
		plan({ world: flat }),
		plan({ world: flat, engine: 7 }),
		plan({ world: { ...flat, geography: { ...flat.geography, terrainSize: 0 } }, engine: 'unity' }),
		plan({ world: { ...flat, geography: { ...flat.geography, heightmap: [[0, 1], [0]] } }, engine: 'unity' }),
		plan({
			world: { ...flat, geography: { terrainSize: SIZE, terrainSource: { kind: 'raster' }, layers: flat.geography.layers } },
			engine: 'unreal',
		}),
		plan({ world: {}, engine: 'unreal' }),
	]);

	// ── 7. No map record: an empty plan, and GradeLots' pads in one set ──
	const noMap = world('hand-no-map', plane(2, 0.05, 0), 10, [building('lot-7', 20, 20, 6, 6, 'lot')]);
	const other = { lotId: 'lot.dressed.7', cx: 20, cz: 20, halfAcross: 3, halfAway: 3, awayX: 1, awayZ: 0, height: 2.4 };
	c('hillside.gradingPlan: a world with no map building has an empty plan and no report line; GradeLots\' pads grade in the same set', [
		plan({ world: noMap, engine: 'godot', points: [P('the lot', 20, 20), P('beyond', 50, 50)] }),
		plan({ world: noMap, engine: 'godot', points: [P('the lot', 20, 20), P("the GradeLots pad's band", 25, 20)], otherPads: [other] }),
		plan({ world: noMap, engine: 'godot', otherPads: [] }),
		plan({ world: noMap, engine: 'godot', points: [], otherPads: null }),
		plan({ world: noMap, engine: 'godot', points: null }),
	]);

	// ── 8. A map lot stacked on GradeLots is refused by name; another lot is one pass ──
	const gentle = world('hand-gentle', plane(3, 0.05, 0), 10, [building('fp', 32, 32, 10, 8)]);
	const gPad = planOf(gentle).pads[0];
	const sameId = { ...other, lotId: 'footprint.map.fp', cx: 10, cz: 10 };
	const samePlace = { ...other, lotId: 'lot.elsewhere', cx: gPad.cx, cz: gPad.cz, halfAcross: gPad.halfAcross, halfAway: gPad.halfAway };
	const apart = { ...other, lotId: 'lot.apart', cx: 12, cz: 52 };
	// 1.5 mm off the pad's centre: past WALL_STEP_MIN_M (1 mm), so not the same place (a stack only within it).
	const nearly = { ...samePlace, lotId: 'lot.nearly', cx: gPad.cx + 0.0015 };
	assert(checkPadSet(planOf(gentle), [sameId]) !== null && checkPadSet(planOf(gentle), [samePlace]) !== null, 'both stacks are refused');
	assert(checkPadSet(planOf(gentle), [nearly]) === null, 'a pad 1.5 mm off is not a stack');
	c('hillside.gradingPlan: padSet refuses a map lot stacked on GradeLots (by its id, or on its rectangle within WALL_STEP_MIN_M) and passes a lot apart or 1.5 mm off', [
		plan({ world: gentle, engine: 'unity', otherPads: [sameId] }),
		plan({ world: gentle, engine: 'unity', otherPads: [samePlace], points: [P('centre', 32, 32)] }),
		plan({ world: gentle, engine: 'unity', otherPads: [apart], points: [P('centre', 32, 32), P('the other lot', 12, 52)] }),
		plan({ world: gentle, engine: 'unity', otherPads: [nearly] }),
	]);

	// ── 10. The overlap rule's constants: worlds on either side of its margin ──
	// A 12 × 12 m house and a 3 × 3 m shed on a slope along x, the shed beyond a gap (core's
	// emitter's shapes). Near the grade where the overlap rule first charges the pair, the
	// answer turns on the lattice (OVERLAP_SLOPE_LATTICE_M), the difference
	// (OVERLAP_SLOPE_DIFF_M) and the tolerance (OVERLAP_SLOPE_TOLERANCE): the builder's sweep
	// (round-1 record) found these worlds by moving each constant in the bundle.
	const pair = (id, grade, gapM) =>
		world(id, (x) => 14 + grade * (x - 32), 30, [building('a', 28, 32, 12, 12), building('b', 28 + 6 + gapM + 1.5, 32, 3, 3)]);
	const charged = pair('hand-margin-charged', 0.1, 0.5);
	const fine = pair('hand-margin-fine', 0.098, 0.5);
	const diff = pair('hand-margin-diff', 0.09866, 0.5);
	const tight = pair('hand-margin-tight', 0.1, 3);
	assert(planOf(charged).dividers?.length === 1, 'at 10 % the pair is charged and divided');
	for (const [w, what] of [[fine, '9.8 %'], [diff, '9.866 %'], [tight, '10 % with a 3 m gap']]) {
		const p = planOf(w);
		assert(p.dividers === undefined && p.findings.length === 0 && !p.pads[1].hillside, `at ${what} the pair holds, blended`);
	}
	c('hillside.gradingPlan: a house and a shed at the overlap rule\'s margin: charged and divided at 10 %, held and blended at 9.8 % and 9.866 % and across a 3 m gap', [
		plan({ world: charged, engine: 'unreal' }),
		plan({ world: fine, engine: 'unreal' }),
		plan({ world: diff, engine: 'unreal' }),
		plan({ world: tight, engine: 'unreal' }),
	]);

	// ── 9. The boundary ([invalid-input]): only what core reads unchecked ──
	c('hillside.gradingPlan refuses what core reads unchecked, as [invalid-input]', [
		inv({}, '`world` must be a JSON object'),
		inv({ world: null, engine: 'unreal' }, '`world` must be a JSON object'),
		inv({ world: [], engine: 'unreal' }, '`world` must be a JSON object'),
		inv({ world: 'w', engine: 'unreal' }, '`world` must be a JSON object'),
		inv({ world: flat, engine: 'unreal', points: {} }, '`points` must be an array'),
		inv({ world: flat, engine: 'unreal', points: [1] }, '`points[0]` must be a JSON object'),
		inv({ world: flat, engine: 'unreal', points: [{ z: 1 }] }, '`points[0].x` must be a finite number'),
		inv({ world: flat, engine: 'unreal', points: [{ x: 1, z: '2' }] }, '`points[0].z` must be a finite number'),
		inv({ world: flat, engine: 'unreal', points: [{ x: 1, z: 2 }, { x: 1, z: 2, label: 3 }] }, '`points[1].label` must be a string'),
		inv({ world: flat, engine: 'unreal', otherPads: 'pads' }, '`otherPads` must be an array'),
		inv({ world: flat, engine: 'unreal', otherPads: [null] }, '`otherPads[0]` must be a JSON object'),
		inv({ world: flat, engine: 'unreal', otherPads: [{ ...other, lotId: undefined }] }, '`otherPads[0].lotId` must be a string'),
		inv({ world: flat, engine: 'unreal', otherPads: [{ ...other, height: 'high' }] }, '`otherPads[0].height` must be a finite number'),
		inv({ world: flat, engine: 'unreal', otherPads: [{ ...other, awayZ: null }] }, '`otherPads[0].awayZ` must be a finite number'),
		{ call: 'hillside.gradingPlan', argsText: '{"world":{},"engine":"unreal","points":[{"x":1e999,"z":0}]}', expectError: '[invalid-input] insimulcore: hillside.gradingPlan: `points[0].x` must be a finite number' },
	]);
	return cases;
}
