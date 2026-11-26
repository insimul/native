// hand-cases/ground-seat-frame.mjs — the hand cases of the traversal.groundSeating.frame row
// (PL.native-ground-seat-batch, ruling U115): one call that settles every carried body of a frame, defined
// as exactly the single rows composed (.initial, .retarget, .offsetAt, .unseat). The cases are
//
//   1. core's five settle cases (conformance/traversal/ground-seating.json, the vendored copy, byte for
//      byte core's at the pin) played as five bodies of one frame per step, in the file's order and
//      reversed; every body's answer is checked here against the corpus's own `expected` before it is
//      written, so a frame that drifted from core's settle cannot be generated;
//   2. a mixed frame (a new body, a mid-settle retarget, the same target again, a clock-only body seated
//      and unseated, a body unseated this frame, an unseated body seated at once, null as absent), each
//      body first through the single rows one by one, then the whole frame;
//   3. an empty frame, a frame of one body, a body's own params over the frame's;
//   4. the row's own refusals, [invalid-input], naming the body.
//
// Written by tools/gen-hand-cases.mjs: every `expect` below is core's own answer at the pin, computed by
// core's `ground-seating/ground-seat` functions (see that tool's header). tests/traversal_corpus.cpp holds
// the row to the single rows byte for byte over the same settle cases (the frame differential).

import corpus from '../../vendor/core/conformance/traversal/ground-seating.json' with { type: 'json' };
import { groundSeatTuning, initialSeat, retargetSeat, seatOffsetAt, unseat } from '@insimul/core/ground-seating/ground-seat';

export const output = 'bridge-ground-seat-frame.json';
export const area = 'traversal-ground-seat-frame';
export const description =
	"Hand cases for the traversal.groundSeating.frame row (PL.native-ground-seat-batch, U115): one call settles every " +
	"carried body of a frame, exactly as the single rows composed body by body. Core's five settle cases " +
	'(conformance/traversal/ground-seating.json) played as five bodies of one frame per step, in order and reversed, ' +
	"each answer held to the corpus's expected; a mixed frame next to the single rows called one by one; an empty " +
	"frame, one body, a body's own params over the frame's; and the row's [invalid-input] refusals. Every expectation " +
	"is core's own answer at the pin, computed by tools/hand-cases/ground-seat-frame.mjs through tools/gen-hand-cases.mjs.";

const ROW = 'traversal.groundSeating.frame';
const copy = (v) => JSON.parse(JSON.stringify(v));
const absent = (v) => v === undefined || v === null;

/** One body of a frame as the row defines it: the single rows composed, with core's functions. */
function settled(body, frameParams) {
	const tuning = groundSeatTuning((absent(body.params) ? frameParams : body.params) ?? {});
	let state = absent(body.state) ? initialSeat() : body.state;
	if (body.unseat === true) state = unseat();
	else if (!absent(body.wantMm)) state = retargetSeat(state, body.wantMm, body.at, tuning);
	state = copy(state);
	return { state, offsetMm: seatOffsetAt(state, body.at ?? 0, tuning) };
}

function frame(bodies, params) {
	const args = params === undefined ? { bodies } : { bodies, params };
	return { call: ROW, args: copy(args), expect: { bodies: bodies.map((b) => settled(b, params)) } };
}

function same(a, b, what) {
	if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(`ground-seat-frame: ${what}: ${JSON.stringify(a)} is not ${JSON.stringify(b)}`);
}

/** The single rows one by one for a body, as the frame composes them: steps, and the answer they make. */
function singles(body, params) {
	const p = absent(body.params) ? params : body.params;
	const withParams = (a) => (p === undefined ? a : { ...a, params: p });
	const tuning = groundSeatTuning(p ?? {});
	const steps = [];
	let state = body.state;
	if (absent(state)) {
		state = copy(initialSeat());
		steps.push({ call: 'traversal.groundSeating.initial', expect: { state } });
	}
	if (body.unseat === true) {
		state = copy(unseat());
		steps.push({ call: 'traversal.groundSeating.unseat', expect: { state } });
	} else if (!absent(body.wantMm)) {
		const args = withParams({ state, wantMm: body.wantMm, at: body.at });
		state = copy(retargetSeat(state, body.wantMm, body.at, tuning));
		steps.push({ call: 'traversal.groundSeating.retarget', args: copy(args), expect: { state } });
	}
	const at = body.at ?? 0;
	const offsetMm = seatOffsetAt(state, at, tuning);
	steps.push({ call: 'traversal.groundSeating.offsetAt', args: copy(withParams({ state, at })), expect: { offsetMm } });
	same({ state, offsetMm }, settled(body, params), 'the single rows and the frame disagree');
	return steps;
}

/** Core's settle cases as bodies, one frame per step index; each answer held to the corpus's `expected`. */
function settleFrames(reversed) {
	const settles = corpus.cases.filter((c) => c.op === 'settle');
	if (settles.length !== 5) throw new Error(`ground-seat-frame: the corpus has ${settles.length} settle cases, not 5`);
	const order = settles.map((_, i) => i);
	if (reversed) order.reverse();
	const states = settles.map(() => undefined);
	const most = Math.max(...settles.map((c) => c.input.steps.length));
	const steps = [];
	for (let k = 0; k < most; k += 1) {
		const live = order.filter((i) => k < settles[i].input.steps.length);
		const bodies = live.map((i) => {
			const s = settles[i].input.steps[k];
			const body = states[i] === undefined ? {} : { state: states[i] };
			if (s.do === 'target') Object.assign(body, { wantMm: s.wantMm, at: s.at });
			else if (s.do === 'at') body.at = s.at;
			else if (s.do === 'unseat') body.unseat = true;
			else throw new Error(`ground-seat-frame: unknown settle step ${s.do}`);
			if (settles[i].input.params !== undefined) body.params = settles[i].input.params;
			return body;
		});
		const step = frame(bodies);
		live.forEach((i, j) => {
			const got = step.expect.bodies[j];
			const want = settles[i].expected[k];
			const name = `${settles[i].name}, step ${k}`;
			same(got.offsetMm, want.offsetMm, `${name}: offsetMm`);
			if (want.state !== undefined) same(got.state, want.state, `${name}: state`);
			states[i] = got.state;
		});
		steps.push(step);
	}
	return steps;
}

export function build() {
	const cases = [];
	const c = (name, steps) => cases.push({ name, steps });

	c("frame: core's five settle cases as five bodies, one frame per step (state absent on the first frame is .initial's)", settleFrames(false));
	c("frame: the same frames with the bodies reversed answer the same bodies, reversed", settleFrames(true));

	// ── a mixed frame, next to the single rows one by one ──
	const seated = { seated: true, fromMm: 40, wantMm: -60, since: 1000 };
	const unseated = copy(initialSeat());
	const mixed = [
		{ wantMm: 40, at: 1050 }, // new: .initial, then seated at once
		{ state: seated, wantMm: 100, at: 1050 }, // mid-settle retarget: from where the offset is
		{ state: seated, wantMm: -60, at: 1030 }, // the same target again: the settle keeps its start
		{ state: seated, at: 1040 }, // the clock only, seated
		{ state: unseated, at: 1040 }, // the clock only, unseated: 0
		{ state: seated, unseat: true }, // unseated this frame
		{ state: seated, unseat: true, at: 1040 }, // unseated, with a clock
		{ state: unseated, wantMm: -25, at: 1060 }, // unseated, seated at once
		{ state: seated, wantMm: 100, at: 1050, unseat: false }, // unseat false is no unseat
		{ state: null, wantMm: null, at: 1050 }, // null is absent: .initial's state, the clock only
	];
	const mixedSteps = [];
	for (const b of mixed) mixedSteps.push(...singles(b));
	mixedSteps.push(frame(mixed));
	c('frame: a mixed frame equals .initial, .retarget, .offsetAt and .unseat called body by body', mixedSteps);

	c('frame: an empty frame answers no bodies', [frame([]), frame([], { settleMmPerS: 1000 })]);
	c('frame: one body', [frame([{ state: seated, wantMm: 100, at: 1050 }]), frame([{ wantMm: 100, at: 1050 }])]);

	// ── a body's own params over the frame's ──
	const p1 = { settleMmPerS: 1000, upFactor: 2 };
	const p3 = { settleMmPerS: 3000, upFactor: 1 };
	const one = { state: seated, wantMm: 100, at: 1050 };
	const own = [one, { ...one, params: null }, { ...one, params: {} }, { ...one, params: p3 }];
	const withFrame = frame(own, p1);
	const offs = withFrame.expect.bodies.map((b) => b.state.fromMm);
	// The frame's params, the frame's (null), core's defaults ({}), the body's own: three answers.
	same(offs[0], offs[1], 'a body with null params reads the frame params');
	if (new Set([offs[0], offs[2], offs[3]]).size !== 3) throw new Error(`ground-seat-frame: the params witness does not separate: ${offs}`);
	const ownSteps = [withFrame];
	for (const b of own) ownSteps.push(...singles(b, p1));
	ownSteps.push(frame(own));
	c("frame: a body's own params stand over the frame's; null is absent and {} is core's defaults", ownSteps);

	// ── the row's own refusals ──
	const inv = (args, error) => ({ call: ROW, args, expectError: error });
	const pre = `insimulcore: Error: [invalid-input] insimulcore: ${ROW}: `;
	const ok = { state: seated, at: 1050 };
	c('frame: the row refuses a malformed frame whole, [invalid-input], naming the body', [
		inv({}, `${pre}\`bodies\` must be an array`),
		inv({ bodies: {} }, `${pre}\`bodies\` must be an array`),
		inv({ bodies: [ok, 1] }, `${pre}\`bodies[1]\` must be a JSON object`),
		inv({ bodies: [ok, null] }, `${pre}\`bodies[1]\` must be a JSON object`),
		inv({ bodies: [ok, { state: [], at: 0 }] }, `${pre}\`bodies[1].state\` must be a JSON object`),
		inv({ bodies: [{ state: 5, at: 0 }] }, `${pre}\`bodies[0].state\` must be a JSON object`),
		inv({ bodies: [{ state: seated }] }, `${pre}\`bodies[0].at\` must be a finite number`),
		inv({ bodies: [{ state: seated, at: '1050' }] }, `${pre}\`bodies[0].at\` must be a finite number`),
		inv({ bodies: [ok, ok, { wantMm: 10 }] }, `${pre}\`bodies[2].at\` must be a finite number`),
		inv({ bodies: [{ wantMm: '40', at: 0 }] }, `${pre}\`bodies[0].wantMm\` must be a finite number`),
		inv({ bodies: [{ unseat: 'yes', at: 0 }] }, `${pre}\`bodies[0].unseat\` must be a boolean`),
		inv({ bodies: [{ unseat: true, wantMm: 40, at: 0 }] }, `${pre}\`bodies[0]\` cannot both unseat and send a \`wantMm\``),
		inv({ bodies: [{ unseat: true, at: 'now' }] }, `${pre}\`bodies[0].at\` must be a finite number`),
	]);
	return cases;
}
