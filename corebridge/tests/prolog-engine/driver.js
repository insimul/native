// driver.js — replays corebridge/tests/prolog-engine/*.json against
// corebridge/js/host-prolog-engine.js (PL.native-consult-floor-leak).
//
// tests/prolog_engine_cases.c evaluates host-prolog-engine.js and THIS file as one
// module inside a real libinsimulcore runtime, so the engine under test talks to
// the real __insimul_prolog_* globals over the native engine. Nothing here is a
// stub: every answer is the engine's.
//
// Every case runs on TWO engines built by the same file:
//   - `engine`, the shipped one (incremental fact writes where they are exact);
//   - `oracle`, the same object with its fact writes and `_rebuild()` put back
//     to the rebuild-everything code this repository shipped before (copied
//     below, verbatim in behaviour), i.e. core's wasm-engine bookkeeping.
// After every step both answers are compared (JSON, so ORDER counts), and so are
// the answers to the case's `probes`, asked of both. A step's `expect` is the
// stated answer any runner can replay without the oracle; `cost` bounds what the
// step asked of the native engine (`creates`: KBs created, `maxConsultBytes`: the
// largest single consult); `oracleDiffers` marks the one stated behaviour change.
// A `fuzz` block is a seeded op sequence (LCG, no clock) over its pools, compared
// the same way after every op.

const counters = { creates: 0, destroys: 0, consults: 0, consultBytes: 0, stepMaxConsultBytes: 0 };
const real = {
	create: globalThis.__insimul_prolog_create,
	consult: globalThis.__insimul_prolog_consult,
	destroy: globalThis.__insimul_prolog_destroy,
};
const utf8Length = (s) => {
	let n = 0;
	for (const ch of String(s)) {
		const c = ch.codePointAt(0);
		n += c < 0x80 ? 1 : c < 0x800 ? 2 : c < 0x10000 ? 3 : 4;
	}
	return n;
};
globalThis.__insimul_prolog_create = () => {
	counters.creates++;
	return real.create();
};
globalThis.__insimul_prolog_consult = (id, text) => {
	const n = utf8Length(text);
	counters.consults++;
	counters.consultBytes += n;
	if (n > counters.stepMaxConsultBytes) counters.stepMaxConsultBytes = n;
	return real.consult(id, text);
};
globalThis.__insimul_prolog_destroy = (id) => {
	counters.destroys++;
	return real.destroy(id);
};

/** The pre-change fact writes and rebuild, kept as the oracle. */
function rebuildOnly(e) {
	e.assertFact = async function (fact) {
		this._recordFact(fact);
		return (await this._rebuild()).success;
	};
	e.assertFacts = async function (facts) {
		for (const fact of facts) this._recordFact(fact);
		return (await this._rebuild()).success;
	};
	e.retractFact = async function (fact) {
		const normalized = String(fact).trim().replace(/\.\s*$/, '') + '.';
		const sig = signatureOf(normalized.replace(/\.$/, ''));
		const facts = this._facts.get(sig || '');
		if (facts) {
			facts.delete(normalized);
			if (facts.size === 0) this._facts.delete(sig || '');
		}
		return (await this._rebuild()).success;
	};
	e._rebuild = async function () {
		const parts = [];
		for (const p of this._dynamic) parts.push(`:- dynamic(${p}).`);
		const consulted = this._programs.join('\n').trim();
		if (consulted) parts.push(consulted);
		for (const r of this._rules) parts.push(r);
		for (const facts of this._facts.values()) for (const f of facts) parts.push(f);
		const fullProgram = parts.join('\n');
		this._freshKb();
		this._loadError = undefined;
		if (!fullProgram.trim()) return { success: true };
		const err = globalThis.__insimul_prolog_consult(this._id, fullProgram);
		if (err === null) return { success: true };
		this._loadError = err;
		return { success: false, error: err };
	};
	return e;
}

function expand(spec) {
	if (typeof spec === 'string') return spec;
	const out = [];
	for (let i = 0; i < spec.count; i++) out.push(spec.template.split('{i}').join(String(i)));
	return out.join('\n');
}

async function apply(e, step) {
	switch (step.op) {
		case 'consult':
			return e.consult(expand(step.program));
		case 'assertFact':
			return e.assertFact(step.fact);
		case 'assertFacts':
			return e.assertFacts(step.facts);
		case 'retractFact':
			return e.retractFact(step.fact);
		case 'addRule':
			return e.addRule(step.rule);
		case 'declareDynamic':
			return e.declareDynamic(step.predicates);
		case 'clearFacts':
			return e.clearFacts();
		case 'query':
			return e.query(step.goal);
		case 'queryOnce':
			return e.queryOnce(step.goal);
		case 'facts':
			return e.getAllFacts();
		case 'destroy': {
			e.destroy();
			const stats = e.getStats();
			return { programs: e._programs.length, rules: stats.ruleCount, facts: stats.factCount, dynamic: stats.dynamicPredicates.length };
		}
		default:
			throw new Error(`unknown op ${JSON.stringify(step.op)}`);
	}
}

const show = (v) => JSON.stringify(v === undefined ? null : v);

async function probeAll(engine, oracle, probes, where, problems) {
	for (const goal of probes || []) {
		const a = show(await engine.query(goal));
		const b = show(await oracle.query(goal));
		if (a !== b) problems.push(`${where}: probe ${goal}: engine ${a} vs rebuild ${b}`);
	}
}

async function runSteps(c, problems, stats) {
	const engine = await createPrologEngine();
	const oracle = rebuildOnly(await createPrologEngine());
	try {
		for (let i = 0; i < c.steps.length; i++) {
			const step = c.steps[i];
			const where = `step ${i} (${step.op})`;
			if (step.op === 'kbSlots') {
				const slots = globalThis.__pe_kb_slots();
				if (slots > step.max) problems.push(`${where}: the KB table holds ${slots} slot(s), more than ${step.max}`);
				continue;
			}
			if (step.op === 'cycle') {
				for (let k = 0; k < step.count; k++) {
					const e = await createPrologEngine();
					await e.consult(expand(step.program));
					e.destroy();
				}
				continue;
			}
			const createsBefore = counters.creates;
			counters.stepMaxConsultBytes = 0;
			const got = await apply(engine, step);
			const delta = { creates: counters.creates - createsBefore, maxConsultBytes: counters.stepMaxConsultBytes };
			const want = await apply(oracle, step);
			const a = show(got);
			const b = show(want);
			if (step.oracleDiffers) {
				if (a === b) problems.push(`${where}: stated to differ from the rebuild, but both answered ${a}`);
			} else if (a !== b) {
				problems.push(`${where}: engine ${a} vs rebuild ${b}`);
			}
			if ('expect' in step && show(step.expect) !== a) problems.push(`${where}: expected ${show(step.expect)}, got ${a}`);
			if (step.cost) {
				if ('creates' in step.cost && delta.creates !== step.cost.creates) {
					problems.push(`${where}: created ${delta.creates} KB(s), stated ${step.cost.creates}`);
				}
				if ('maxConsultBytes' in step.cost && delta.maxConsultBytes > step.cost.maxConsultBytes) {
					problems.push(`${where}: consulted ${delta.maxConsultBytes} byte(s) at once, bound ${step.cost.maxConsultBytes}`);
				}
			}
			stats.steps++;
			if (step.op === 'destroy') break;
			if (!step.skipProbes) await probeAll(engine, oracle, c.probes, where, problems);
		}
	} finally {
		engine.destroy();
		oracle.destroy();
	}
}

function lcg(seed) {
	let s = seed >>> 0;
	return (n) => {
		s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
		return s % n;
	};
}

async function runFuzz(f, problems, stats) {
	const pick = lcg(f.seed);
	const fastBefore = counters.creates;
	let engineCreates = 0;
	let oracleCreates = 0;
	for (let seq = 0; seq < f.sequences; seq++) {
		const steps = [{ op: 'consult', program: f.program }];
		for (let k = 0; k < f.steps; k++) {
			const r = pick(100);
			if (r < 40) steps.push({ op: 'assertFact', fact: f.facts[pick(f.facts.length)] });
			else if (r < 70) steps.push({ op: 'retractFact', fact: f.facts[pick(f.facts.length)] });
			else if (r < 80) steps.push({ op: 'assertFacts', facts: [f.facts[pick(f.facts.length)], f.facts[pick(f.facts.length)]] });
			else if (r < 85) steps.push({ op: 'addRule', rule: f.rules[pick(f.rules.length)] });
			else steps.push({ op: 'query', goal: f.probes[pick(f.probes.length)] });
		}
		const engine = await createPrologEngine();
		const oracle = rebuildOnly(await createPrologEngine());
		try {
			for (let i = 0; i < steps.length; i++) {
				const where = `fuzz seq ${seq} step ${i} ${show(steps[i])}`;
				let c0 = counters.creates;
				const a = show(await apply(engine, steps[i]));
				engineCreates += counters.creates - c0;
				c0 = counters.creates;
				const b = show(await apply(oracle, steps[i]));
				oracleCreates += counters.creates - c0;
				if (a !== b) problems.push(`${where}: engine ${a} vs rebuild ${b}`);
				await probeAll(engine, oracle, f.probes, where, problems);
				stats.steps++;
				if (problems.length > 20) return;
			}
		} finally {
			engine.destroy();
			oracle.destroy();
		}
	}
	stats.fuzz = { sequences: f.sequences, engineCreates, oracleCreates, totalCreates: counters.creates - fastBefore };
	if (f.maxCreateRatio !== undefined && engineCreates > oracleCreates * f.maxCreateRatio) {
		problems.push(`fuzz: the engine created ${engineCreates} KB(s) against the rebuild's ${oracleCreates}, above the stated ratio ${f.maxCreateRatio}`);
	}
}

globalThis.__pe_run = async (fileText) => {
	const file = JSON.parse(fileText);
	const report = [];
	for (const c of file.cases || []) {
		const problems = [];
		const stats = { steps: 0 };
		try {
			await runSteps(c, problems, stats);
		} catch (err) {
			problems.push(`threw: ${err && err.stack ? err.stack : err}`);
		}
		report.push({ name: c.name, problems, stats });
	}
	if (file.fuzz) {
		const problems = [];
		const stats = { steps: 0 };
		try {
			await runFuzz(file.fuzz, problems, stats);
		} catch (err) {
			problems.push(`threw: ${err && err.stack ? err.stack : err}`);
		}
		report.push({ name: `fuzz (seed ${file.fuzz.seed})`, problems, stats });
	}
	return JSON.stringify(report);
};
