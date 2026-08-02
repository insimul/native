// entry.js — the bundle entry point: the ONLY place that says which of
// `@insimul/core`'s functions this adapter exposes across the C ABI.
//
// Adding a method here is what "adopting more of core" means for this plugin.
// The method table is deliberately explicit: `insimul_core_call()` cannot reach
// arbitrary core internals, so the adopted surface is reviewable in one screen.
//
// Contract with the C host (../src/insimulcore.c):
//   `globalThis.__insimul_core_dispatch(method, argsJson) -> Promise<any>`
// The host JSON.stringifies whatever the promise fulfils with, and turns a
// rejection into `insimul_core_last_error()`.

import { generateRadiantQuests } from '@insimul/core/radiant/radiant-engine';
import { BASE_RADIANT_TEMPLATES, BASE_RADIANT_TEMPLATE_IDS } from '@insimul/core/radiant/base-templates';
// The quest-golden manifest is core's declared authority for the SHAPE the
// quest corpus is compared in (`conformance/quests/*.json` is emitted from it),
// and `radiantTick` is defined there rather than in src/ precisely so the TS
// reference and every port assert against one definition. Importing it is what
// lets US-3 compare core against this repo's hand-ported quest_system.cpp
// without either side reimplementing the other. NOT an adopted runtime surface:
// these two methods exist for the parity gate (RUNTIME_CORE_ADOPTION.md §10).
import {
	computeHydrationExpected,
	radiantTick,
} from '@insimul/core-scripts/quest-golden-manifest';

/** The adopted surface. One entry per method name callable from the host. */
const METHODS = {
	/**
	 * `radiant.generate` — the first adopted slice (RUNTIME_CORE_ADOPTION.md §5).
	 * args: `{ kb: string | string[], options: { seed, now, maxQuests? } }`
	 * result: `{ quests: GeneratedRadiantQuest[] }`
	 */
	'radiant.generate': (args) => generateRadiantQuests(args.kb, args.options),

	/**
	 * `radiant.baseTemplates` — core's shipped template pack, so a game does not
	 * have to vendor a copy of it to generate anything.
	 */
	'radiant.baseTemplates': () => ({
		templates: BASE_RADIANT_TEMPLATES,
		templateIds: BASE_RADIANT_TEMPLATE_IDS,
	}),

	/**
	 * `quest.hydrate` — core's `hydrateQuestFromProlog`, projected exactly as
	 * `conformance/quests/hydration-cases.json` records it.
	 * args: `{ content: string, status?: string }`
	 * result: `{ quest: <projection> }`
	 *
	 * COMPARISON SURFACE, not an adopted one: `gdextension/src/quest_system.cpp`
	 * is the hand-port that ships, and US-3 diffs the two over the same vectors
	 * to decide whether the port can eventually retire. See §10.
	 */
	'quest.hydrate': (args) => ({
		quest: computeHydrationExpected({
			content: args.content,
			...(args.status ? { status: args.status } : {}),
		}),
	}),

	/**
	 * `quest.radiantTick` — core's deterministic radiant distributor.
	 * args: `{ quests: [{id, tags, status}], maxOffering: number, ticks: number }`
	 * result: `{ facts: [{predicate, args}] }` (an order-independent multiset)
	 */
	'quest.radiantTick': (args) => ({
		facts: radiantTick({
			quests: args.quests || [],
			maxOffering: args.maxOffering,
			ticks: args.ticks,
		}),
	}),

	/** `core.methods` — introspection; lets a gate assert the adopted surface. */
	'core.methods': () => ({ methods: Object.keys(METHODS).sort() }),
};

globalThis.__insimul_core_dispatch = function (method, argsJson) {
	const fn = METHODS[method];
	if (!fn) {
		return Promise.reject(new Error(`insimulcore: unknown method "${method}"`));
	}
	// `Promise.resolve().then(...)` so a synchronous throw inside `fn` becomes a
	// rejection the host reports through last_error(), never a C-level exception.
	return Promise.resolve().then(() => fn(argsJson ? JSON.parse(argsJson) : {}));
};
