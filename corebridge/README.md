# `libinsimulcore` — running `@insimul/core` from a native engine

This directory is the answer to the question the whole unification program hung
on: **how does a C++/C#/GDScript engine run 19,000 lines of TypeScript?**

The answer (`RUNTIME_CORE_ADOPTION.md` §4.5) is *not a language*. It is a **C
ABI** — `include/insimulcore.h`, five functions, opaque handle, JSON in, JSON out
— shaped exactly like `libinsimul`'s ABI, which Godot, Unity and Unreal already
consume successfully. Behind that ABI runs core's TypeScript inside an embedded
**QuickJS** today, and a Rust port later if it is ever funded, *without any
adapter noticing the difference*.

Zero lines of core are re-implemented here. TypeScript stays the single
semantics authority.

## Why it is in this repo

It was built in `insimul-godot/gdextension/corebridge/`, because the tasklist
that built it (100) had that repository as its worktree. That was always
temporary. The corollary it recorded is the reason this directory now exists:

> **Do not invent a second mechanism.** If Unity needs core, it P/Invokes
> `libinsimulcore`. If Unreal needs core, it links `libinsimulcore`. The bridge
> is built once, not three times.

A bridge that lives inside one engine's plugin gets forked by the second engine
that needs it. Promoting it here — beside `libinsimul`, built by the same CMake,
packaged by the same `scripts/package.sh` — is what makes "built once" true
rather than aspirational.

**`insimulcore.h` moved byte-for-byte.** It is the contract three engines bind,
and a header that forks between repositories is the exact failure this move
prevents; so the copy here is `diff`-identical to the one in the Godot plugin,
including its closing paragraph about where the bridge "should eventually live".
That paragraph is now satisfied by this very directory, and it will be dropped
when the Godot plugin stops carrying its own copy — which is a change in *that*
repository, with its own tasklist. Leaving both briefly is safer than breaking a
working adapter from outside it.

## The stack

```
engine host              Godot GDScript / Unity C# / Unreal C++
   │  Dictionary → JSON      ← the ONLY place engine types are translated
engine wrapper           e.g. Godot's gdextension/src/insimul_core.{h,cpp}
   │  C ABI                  insimul_core_call(h, "radiant.generate", json)
libinsimulcore           src/insimulcore.c  =  QuickJS + the vendored core bundle
   │  JS → C                 __insimul_prolog_{create,consult,query,destroy},
   │                         __insimul_sha256_hex (core's save-envelope hash)
libinsimul               Trealla, natively linked (../include/insimul.h)
```

Dependencies run one way only: adapters depend on core. Core gains no knowledge
of any engine, and this repository gains no edge into `packages/core` beyond
vendored artifacts (the bundle and the case corpus derived from it, here; the
Prolog and radiant corpora in `../conformance/`).

## Why the Prolog seam is wired to the native engine

Core's `createPrologEngine()` dynamic-imports `WasmPrologEngine`, which
instantiates libinsimul/Trealla compiled to **wasm32**. QuickJS has no
WebAssembly — and even if it did, wrapping a wasm build of an engine this
library already links natively would be absurd.

So the bundler resolves core's `../prolog/prolog-engine` import to
`js/host-prolog-engine.js`, an adapter-owned module implementing the same seam
over libinsimul's C ABI. **Core's source is never patched**; only the resolution
of its seam import changes, which is what a seam is for. The contract amendment
that would make this explicit (an injectable engine rather than a resolver
trick) is `RUNTIME_CORE_ADOPTION.md` §8.

`js/host-prolog-engine.js` therefore has one hard obligation: agree with
`packages/core/src/prolog/wasm-engine.ts` on everything the caller can observe —
`collapseTerm`, the trailing-`.` trim, the 1000-result default. The conformance
corpus is what proves it.

## Layout

| Path | What it is |
|------|------------|
| `include/insimulcore.h` | **The contract.** The one file that must not fork. |
| `src/insimulcore.c` | The QuickJS host: ABI, promise pump, Prolog bridge, the SHA-256 global. |
| `src/insimulcore_sha256.{c,h}` | SHA-256 (FIPS 180-4) for core's save envelope. Internal; not exported. |
| `src/insimulcore_testing.h` | Test-only views (the handle's QuickJS context, its KB table) for this repo's `prolog_engine_cases`. Never shipped, never included by a plugin. |
| `js/entry.js` | **The method table** — one entry per callable method (below). |
| `js/host-sessions.js` | The session table behind every stateful row (`<area>.create` / `<area>.apply`). |
| `js/host-prolog-engine.js` | Core's Prolog seam, implemented over libinsimul. Fact writes go into the held KB where that is provably what a rebuild would hold (PL.native-consult-floor-leak); everything else rebuilds. |
| `js/host-crypto.js` | Core's `crypto` import: `createHash('sha256')` backed by the C host. Anything else throws. |
| `js/host-console.js` | A `console` for QuickJS: records what core logs, prints nothing (`core.diagnostics`). |
| `js/host-text-codec.js` | `TextEncoder`/`TextDecoder` polyfill (byte-for-byte Godot's; core's `identity/kinp.ts` needs one at load). |
| `core-pin.json` | **The input pin**: the core commit and the esbuild version the bundle is built from. |
| `vendor/quickjs/` | QuickJS 2025-04-26, unmodified (see `../THIRD_PARTY.md`). |
| `vendor/core/` | **Generated.** The bundle, its C array, `VENDORED.json` (provenance + sha256 per file), `cases/` (core's corpora transcribed into bridge cases), and core's layout corpora, pack-composition corpus, pack catalog and P9a corpora (`conformance/`, `packs/`) copied byte for byte. Never hand-edit. |
| `tools/vendor-core-bundle.mjs` | Produces `vendor/core/` from the pin, and the `--check` drift guard the `core_vendor` ctest runs. |
| `tools/emit-bridge-cases.mjs` | The transcription of core's corpora into `vendor/core/cases/` (run by the tool above). |
| `tests/cases/` | Hand-written cases for behaviour no core corpus pins yet. |
| `tests/prolog-engine/` | The Prolog seam's own corpus and driver: each step against the rebuild-only oracle, with stated answers and native cost, plus a seeded differential (`prolog_engine_cases`). |
| `tests/README.md` | The case format and the matcher rules both harnesses implement. |
| `ENGINE_BINDINGS.md` | What each engine's binding must add to use this table. |
| `CMakeLists.txt` | The two targets: `insimulcore` (static) + `insimulcore_shared`. |

## The method table

Every method is `insimul_core_call(core, "<name>", "<args JSON object>")` → a JSON
document, or NULL with `insimul_core_last_error()` set (see "Errors"). `core.methods`
returns the names; the `corebridge_cases_js` gate fails if this table and the
bundle's disagree, and both case harnesses fail if a method has no case.

Status: **adopted** = an engine calls it at runtime today; **feature phase** = added
for the Features Round phase named (the loop's `features/PLAN.md` §3: P1 saves, P2 HUD/notifications/pause, P3 quests, P4 clock and weather, P6 inventory and shops, P7 camera, P8 title, P9 genre systems), no
engine binds it yet; **parity** = exists for an engine's comparison gate, not for a
game; **meta** = about the bridge itself.

<!-- BEGIN METHOD TABLE -->
| Method | Args → result | Core behind it | Status |
|---|---|---|---|
| `core.methods` | `{}` → `{ methods }` (sorted) | — | meta |
| `core.diagnostics` | `{}` → `{ lines: [{ level, text }], dropped }` — what core logged during the previous call | `js/host-console.js` | meta |
| `session.list` | `{}` → `{ sessions: [{ session, kind }] }` | `js/host-sessions.js` | meta |
| `session.dispose` | `{ session }` → `{ disposed }` | `js/host-sessions.js` | meta |
| `radiant.generate` | `{ kb, options: { seed, now, maxQuests? } }` → `{ quests }` | `radiant/radiant-engine` `generateRadiantQuests` | adopted (Godot, Unreal) |
| `radiant.baseTemplates` | `{}` → `{ templates, templateIds }` | `radiant/base-templates` | adopted |
| `quest.hydrate` | `{ content, status? }` → `{ quest }` | `scripts/quest-golden-manifest` `computeHydrationExpected` | parity |
| `quest.radiantTick` | `{ quests, maxOffering, ticks }` → `{ facts }` (a multiset) | `scripts/quest-golden-manifest` `radiantTick` | parity |
| `save.rules` | `{}` → `{ saveFileVersion, envelopeFormat, migrations, extensionKeys }` | `save-file`, `save-file-migrations`, `save-extensions`, `save-envelope` | feature phase P1 |
| `save.integrity` | `{ saveFile }` → `{ integrity }` | `save-envelope` `computeSaveFileIntegrity` | P1 |
| `save.encode` | `{ saveFile, insimulVersion, exportedAt? }` → `{ envelope }` | `save-envelope` `buildSaveFileEnvelope` | P1 |
| `save.decode` | `{ envelope }` or `{ text }` → `{ ok: false, error: { code, message } }` or `{ ok: true, envelope, saveFile, outcome, significant }` | `validateSaveFileEnvelope` then `migrateSaveFileWithOutcome` | P1 |
| `save.migrate` | `{ saveFile }` → `{ saveFile, outcome, significant }` | `save-file` `migrateSaveFileWithOutcome`, unchanged; `significant` = `isMigrationOutcomeSignificant` | P1 |
| `save.village.contract` | `{}` → `{ saveFileVersion, gameStateVersion, extensionKey, playerAgentLocalId, runtimeSlot, positionFrameSlot, villagerSlots, weatherExtensionKey, weatherDirectorKeys, weatherBlockMembers, conversationRowKeys, conversationRecordKeys, conversationMsRange }` | `save-file-game-state` constants, `ai/blackboard` `BLACKBOARD_EXTENSION_KEY`, `save-file` `SAVE_FILE_VERSION` | P1 village-state save (PL.native-village-save-rows; core's P1.core, PL.core-save-conversations-projection) |
| `save.village.write` | `{ save, gameState, options: { worldId, runtime, positionFrame, tick } }` → `{ ok: true, currentState, conversations }` or `{ ok: false, refusal }` | `save-file-game-state` `writeVillageSave` | P1 village-state save (PL.native-village-save-rows; core's P1.core, PL.core-save-conversations-projection) |
| `save.village.read` | `{ save, options: { worldId, runtime? } }` → `{ ok: true, gameState }` or `{ ok: false, refusal }` | `save-file-game-state` `readVillageSave` | P1 village-state save (PL.native-village-save-rows; core's P1.core, PL.core-save-conversations-projection) |
| `save.village.check` | `{ save }` → `{ refusal }` (null: none) | `save-file-game-state` `checkVillageSave` | P1 village-state save (PL.native-village-save-rows; core's P1.core, PL.core-save-conversations-projection) |
| `save.village.ownership` | `{ save, worldId, runtime }` → `{ refusal }`: `wrong_world`, `wrong_runtime` or null | `save-file-game-state` `checkSaveOwnership` | P1 village-state save (PL.native-village-save-rows; core's P1.core, PL.core-save-conversations-projection) |
| `save.village.readRuntime` | `{ save, worldId, runtime }` → `{ ok: true, gameState }` or `{ ok: false, refusal }`: a game's Load | `save-file-game-state` `readRuntimeSave` | P1 village-state save (PL.native-village-save-rows; core's P1.core, PL.core-save-conversations-projection) |
| `save.village.runtimeOf` | `{ save, worldId }` → `{ runtime }` | `save-file-game-state` `saveRuntimeOf` | P1 village-state save (PL.native-village-save-rows; core's P1.core, PL.core-save-conversations-projection) |
| `save.village.positionFrameOf` | `{ save, worldId }` → `{ positionFrame }` | `save-file-game-state` `positionFrameOf` | P1 village-state save (PL.native-village-save-rows; core's P1.core, PL.core-save-conversations-projection) |
| `save.village.belongsTo` | `{ save, worldId, runtime }` → `{ belongsTo }` | `save-file-game-state` `saveBelongsTo` | P1 village-state save (PL.native-village-save-rows; core's P1.core, PL.core-save-conversations-projection) |
| `save.village.runtimeLabel` | `{ runtime }` → `{ label }` | `save-file-game-state` `runtimeLabel` | P1 village-state save (PL.native-village-save-rows; core's P1.core, PL.core-save-conversations-projection) |
| `save.village.agentCurie` | `{ localId, worldId }` → `{ curie }` | `save-file-game-state` `agentCurie` | P1 village-state save (PL.native-village-save-rows; core's P1.core, PL.core-save-conversations-projection) |
| `save.village.timeStateOf` | `{ totalHours, timeScale, isPaused }` → `{ timeState }` | `save-file-game-state` `timeStateOf` | P1 village-state save (PL.native-village-save-rows; core's P1.core, PL.core-save-conversations-projection) |
| `save.village.totalHoursOf` | `{ timeState }` → `{ totalHours }` | `save-file-game-state` `totalHoursOf` | P1 village-state save (PL.native-village-save-rows; core's P1.core, PL.core-save-conversations-projection) |
| `save.village.weather.read` | `{ block }` → `{ ok: true, value }` or `{ ok: false, keys }` | `save-file-game-state` `readWeatherBlock` | P1 village-state save (PL.native-village-save-rows; core's P1.core, PL.core-save-conversations-projection) |
| `save.village.weather.saveState` | `{ session, surfaceWetness? }` → `{ weather }`: a `weather.create` session's sky as the game state carries it | `save-file-game-state` `weatherSaveState` | P1 village-state save (PL.native-village-save-rows; core's P1.core, PL.core-save-conversations-projection) |
| `save.village.weather.restore` | `{ session, gameState }` → `{ surfaceWetness, state, view, issues }`: the saved sky into a `weather.create` session | `save-file-game-state` `restoreWeatherFromSave` | P1 village-state save (PL.native-village-save-rows; core's P1.core, PL.core-save-conversations-projection) |
| `save.village.conversations.read` | `{ records }` → `{ ok: true, value }` or `{ ok: false, keys }` | `save-file-game-state` `readConversationRecords` | P1 village-state save (PL.native-village-save-rows; core's P1.core, PL.core-save-conversations-projection) |
| `save.village.conversations.rows` | `{ stored, records }` → `{ rows }`: the records folded into one row per NPC (unreadable records: `[invalid-input]`) | `save-file-game-state` `readConversationRecords` then `conversationRowsOf` | P1 village-state save (PL.native-village-save-rows; core's P1.core, PL.core-save-conversations-projection) |
| `save.village.conversations.records` | `{ rows }` → `{ records }`: the rows split back, one record per conversation | `save-file-game-state` `conversationRecordsOf` | P1 village-state save (PL.native-village-save-rows; core's P1.core, PL.core-save-conversations-projection) |
| `save.village.conversations.timestamp` | `{ epochMs }` → `{ timestamp }` (null outside the range) | `save-file-game-state` `conversationTimestampOf` | P1 village-state save (PL.native-village-save-rows; core's P1.core, PL.core-save-conversations-projection) |
| `save.village.conversations.epochMs` | `{ timestamp }` → `{ epochMs }` (null unless it writes back to itself) | `save-file-game-state` `epochMsOfConversationTimestamp` | P1 village-state save (PL.native-village-save-rows; core's P1.core, PL.core-save-conversations-projection) |
| `language.contract` | `{}` → `{ cefrOrder, encounterTypes, encounterHalves, grammarWeaknessMinAttempts, grammarWeaknessRate, grammarMasteryCorrectUses, fluencyMax, fluencyGainMin, fluencyGainMax, bookRefusals, extensionKey, blockMembers, bookKeys, wordKeys, grammarKeys, namingKeys, identificationKeys, promptRefusals, examineRange, identificationTuning, namingTuning, collectionTuning, hoverRefusals, chatRefusals, chatPercentPerWordPerTurn, vocabularySorts, masteryLabels, masteryTones, dueLabel, dueTone, cardInteractions, weaknessMinAttempts, weaknessMinRatePermille, weaknessMax, improvementPermille, weaknessVolumePermille, weaknessConfidencePermille, questCategories, skillDimensions, skillToCategories, learningHistoryStatuses, scaffoldingThreshold, scaffoldingTurns, stretchThreshold, stretchTurns, signalWeights, npcModePercent, hintBehavior, cefrAdvancement, frequencyRanges, textComplexity, questPoolSizes, closeThreshold, phoneticWeight, passScore, baseXp, worldWordRefusals, signRoles, compositionRefusals, commonEnglishWords, listeningPass, storyMinLength, feedbackTypes, pronunciationObjectives, pronunciationDefaultRequired, vocabularyObjectives, vocabularyDefaultRequired, grammarObjectives, grammarDefaultRequired, recentFeedbackMax, patternExamplesMax, languageObjectiveTypeMap, languageRewardTypeMap }` | `language-learning/{progress,language-save,prompt-selector,world-words,reading-writing,chat-metrics,bank-profile,adaptation,pronunciation,quest-feedback}`, `quest-types/language-learning` constants | P9h language (PL.native-language-rows slices 1 to 4; core's P9h.core) |
| `language.book.empty` | `{ language? }` → `{ book }` | `language-learning/progress` `emptyBook` | P9h language (PL.native-language-rows slice 1; core's P9h.core) |
| `language.book.mastery` | `{ encountered, halves }` → `{ mastery }` | `language-learning/progress` `masteryOf` | P9h language (PL.native-language-rows slice 1; core's P9h.core) |
| `language.book.wordView` | `{ row }` → `{ view }` (a row core's save reader cannot read: `[invalid-input]`) | `language-learning/progress` `wordView` | P9h language (PL.native-language-rows slice 1; core's P9h.core) |
| `language.book.findWord` | `{ book, word, language? }` → `{ row }` (null: none) | `language-learning/progress` `findWord` | P9h language (PL.native-language-rows slice 1; core's P9h.core) |
| `language.book.advance` | `{ book, ms }` → `{ book }` | `language-learning/progress` `advanceBook` | P9h language (PL.native-language-rows slice 1; core's P9h.core) |
| `language.book.recordEncounter` | `{ book, encounter }` → `{ ok: true, book, entry, isNew, masteryChanged }` or `{ ok: false, book, refusal }` | `language-learning/progress` `recordEncounter` | P9h language (PL.native-language-rows slice 1; core's P9h.core) |
| `language.book.encounterOfEvent` | `{ event }` → `{ encounter }` (null: not a word event) | `language-learning/progress` `encounterOfEvent` | P9h language (PL.native-language-rows slice 1; core's P9h.core) |
| `language.book.isWeak` | `{ row }` → `{ weak }` | `language-learning/progress` `isWeak` | P9h language (PL.native-language-rows slice 1; core's P9h.core) |
| `language.book.recordGrammar` | `{ book, feedback }` → `{ book, touched, signals }` | `language-learning/progress` `recordGrammar` | P9h language (PL.native-language-rows slice 1; core's P9h.core) |
| `language.book.weakPatterns` | `{ book }` → `{ patterns }` | `language-learning/progress` `weakPatterns` | P9h language (PL.native-language-rows slice 1; core's P9h.core) |
| `language.book.fluencyGain` | `{ fluency, uniqueWords, grammarCorrect, grammarAttempted, turns, targetPercent }` → `{ gain, bonuses }` | `language-learning/progress` `fluencyGain` | P9h language (PL.native-language-rows slice 1; core's P9h.core) |
| `language.book.recordConversation` | `{ book, conversation }` → `{ book, result, signals }` | `language-learning/progress` `recordConversation` | P9h language (PL.native-language-rows slice 1; core's P9h.core) |
| `language.book.setCefr` | `{ book, level }` → `{ book, signals }` | `language-learning/progress` `setCefr` | P9h language (PL.native-language-rows slice 1; core's P9h.core) |
| `language.book.summary` | `{ book }` → `{ language, clockMs, fluency, cefr, conversations, correctUsages, wordsLearned, mastered }` | `language-learning/progress` `bookSummary` | P9h language (PL.native-language-rows slice 1; core's P9h.core) |
| `language.facts.cefr` | `{ facts }` → `{ cefr }` (null: none) | `prolog/player-language-state` `extractPlayerCefrFromFacts` | P9h language (PL.native-language-rows slice 1; core's P9h.core) |
| `language.facts.weakDimensions` | `{ facts, threshold? }` → `{ weak }` | `prolog/player-language-state` `extractPlayerWeakDimensions` | P9h language (PL.native-language-rows slice 1; core's P9h.core) |
| `language.save.block` | `{ book?, collected?, naming?, identification? }` → `{ block }` | `language-learning/language-save` `languageSaveBlock` | P9h language (PL.native-language-rows slice 1; core's P9h.core) |
| `language.save.read` | `{ block }` → `{ ok: true, value }` or `{ ok: false, keys }` | `language-learning/language-save` `readLanguageBlock` | P9h language (PL.native-language-rows slice 1; core's P9h.core) |
| `language.save.blockOf` | `{ block }` → `{ block }`: the stored block (one core's reader cannot read: `[invalid-input]`) | `language-learning/language-save` `readLanguageBlock` then `languageBlockOf` | P9h language (PL.native-language-rows slice 1; core's P9h.core) |
| `language.identification.initial` | `{}` → `{ state }` | `language-learning/world-words` `initialIdentification` | P9h language (PL.native-language-rows slice 1; core's P9h.core) |
| `language.identification.registerTargets` | `{ state, targets }` → `{ state }` | `language-learning/world-words` `registerTargets` | P9h language (PL.native-language-rows slice 1; core's P9h.core) |
| `language.naming.initial` | `{}` → `{ state }` | `language-learning/world-words` `initialNaming` | P9h language (PL.native-language-rows slice 1; core's P9h.core) |
| `language.naming.registerNameable` | `{ state, objects }` → `{ state }` | `language-learning/world-words` `registerNameable` | P9h language (PL.native-language-rows slice 1; core's P9h.core) |
| `language.naming.nameableObjects` | `{ objects, targetLanguage }` → `{ objects }` | `language-learning/world-words` `nameableObjects` | P9h language (PL.native-language-rows slice 1; core's P9h.core) |
| `language.collection.initial` | `{ seed }` → `{ state }` | `language-learning/world-words` `initialCollection` | P9h language (PL.native-language-rows slice 1; core's P9h.core) |
| `language.collection.registerTags` | `{ state, tags }` → `{ state }` | `language-learning/world-words` `registerTags` | P9h language (PL.native-language-rows slice 1; core's P9h.core) |
| `language.prompts.initial` | `{}` → `{ state }` | `language-learning/prompt-selector` `initialPrompts` | P9h language (PL.native-language-rows slice 1; core's P9h.core) |
| `language.prompts.pickTargetIds` | `{ identification, pick }` → `{ ids }` | `language-learning/prompt-selector` `pickTargetIds` | P9h language (PL.native-language-rows slice 1; core's P9h.core) |
| `language.prompts.onPick` | `{ state, pick, at, world }` → `{ ok: true, state, prompt, checked, events }` or `{ ok: false, state, refusal }` | `language-learning/prompt-selector` `promptOnPick` | P9h language (PL.native-language-rows slice 1; core's P9h.core) |
| `language.prompts.standing` | `{ state, world }` → `{ state, prompt }` | `language-learning/prompt-selector` `standingPick` | P9h language (PL.native-language-rows slice 1; core's P9h.core) |
| `language.prompts.answer` | `{ state, input, world }` → `{ ok: true, state, identification, naming, kind, id, result, standing }` or `{ ok: false, state, identification, naming, refusal }` | `language-learning/prompt-selector` `answerPick` | P9h language (PL.native-language-rows slice 1; core's P9h.core) |
| `language.prompts.quizOnReach` | `{ state, collection, at, tuning? }` → `{ state, collection, inReach, quiz }` | `language-learning/prompt-selector` `quizOnReach` | P9h language (PL.native-language-rows slice 1; core's P9h.core) |
| `language.prompts.answerQuiz` | `{ state, collection, answer, tuning? }` → `{ ok: true, state, collection, objectId, answer }` or `{ ok: false, state, collection, refusal }` | `language-learning/prompt-selector` `answerStandingQuiz` | P9h language (PL.native-language-rows slice 1; core's P9h.core) |
| `language.word.key` | `{ word }` → `{ key }` | `language-learning/word-key` `wordKey` | P9h language (PL.native-language-rows slice 1; core's P9h.core) |
| `language.word.stripEdges` | `{ word }` → `{ word }` | `language-learning/word-key` `stripWordEdges` | P9h language (PL.native-language-rows slice 1; core's P9h.core) |
| `language.hover.tokenize` | `{ text }` → `{ tokens }` | `language-learning/reading-writing` `tokenize` | P9h language (PL.native-language-rows slice 1; core's P9h.core) |
| `language.hover.initial` | `{ cefr?, targetLanguage? }` → `{ state }` | `language-learning/reading-writing` `initialHover` | P9h language (PL.native-language-rows slice 1; core's P9h.core) |
| `language.hover.addHints` | `{ state, hints }` → `{ state }` | `language-learning/reading-writing` `addHints` | P9h language (PL.native-language-rows slice 1; core's P9h.core) |
| `language.hover.seeWord` | `{ state, word, difficulty? }` → `{ state, showHint }` | `language-learning/reading-writing` `seeWord` | P9h language (PL.native-language-rows slice 1; core's P9h.core) |
| `language.hover.setMastery` | `{ state, word, encountered, correct }` → `{ state }` | `language-learning/reading-writing` `setMastery` | P9h language (PL.native-language-rows slice 1; core's P9h.core) |
| `language.hover.isLikelyTarget` | `{ state, word }` → `{ likely }` | `language-learning/reading-writing` `isLikelyTarget` | P9h language (PL.native-language-rows slice 1; core's P9h.core) |
| `language.hover.lookup` | `{ state, word }` → `{ ok: true, state, result, request, signals }` or `{ ok: false, state, refusal }` | `language-learning/reading-writing` `lookup` | P9h language (PL.native-language-rows slice 1; core's P9h.core) |
| `language.hover.resolve` | `{ state, word, translation, context? }` → `{ state, result, signals }` | `language-learning/reading-writing` `resolveLookup` | P9h language (PL.native-language-rows slice 1; core's P9h.core) |
| `language.hover.display` | `{ state }` → `{ mode, size }` | `language-learning/reading-writing` `hoverDisplay` | P9h language (PL.native-language-rows slice 1; core's P9h.core) |
| `language.chat.lineTokens` | `{ line }` → `{ tokens }` | `language-learning/chat-metrics` `lineTokens` | P9h language (PL.native-language-rows slice 1; core's P9h.core) |
| `language.chat.lineWords` | `{ line, book, worldWords? }` → `{ totalWords, targetWords, wordsUsed }` | `language-learning/chat-metrics` `chatLineWords` | P9h language (PL.native-language-rows slice 1; core's P9h.core) |
| `language.chat.questUsages` | `{ line, questWords, book, worldWords? }` → `{ usages }` | `language-learning/chat-metrics` `chatQuestUsages` | P9h language (PL.native-language-rows slice 1; core's P9h.core) |
| `language.chat.targetPercent` | `{ used, turns }` → `{ targetPercent }` | `language-learning/chat-metrics` `chatTargetPercent` | P9h language (PL.native-language-rows slice 1; core's P9h.core) |
| `language.chat.start` | `{ npcName? }` → `{ session }` | `language-learning/chat-metrics` `startChat` | P9h language (PL.native-language-rows slice 1; core's P9h.core) |
| `language.chat.checkErrors` | `{ check }` → `{ errors }` | `language-learning/chat-metrics` `checkErrors` | P9h language (PL.native-language-rows slice 1; core's P9h.core) |
| `language.chat.hear` | `{ session, check }` → `{ session }` | `language-learning/chat-metrics` `hearChatGrammar` | P9h language (PL.native-language-rows slice 1; core's P9h.core) |
| `language.chat.line` | `{ session, line, book, worldWords? }` → `{ ok: true, session, metrics, wordsUsed }` or `{ ok: false, session, refusal }` | `language-learning/chat-metrics` `chatLine` | P9h language (PL.native-language-rows slice 1; core's P9h.core) |
| `language.chat.end` | `{ session }` → `{ ok: true, conversation }` or `{ ok: false, refusal }` | `language-learning/chat-metrics` `endChat` | P9h language (PL.native-language-rows slice 1; core's P9h.core) |
| `language.chat.finish` | `{ book, session }` → `{ ok: true, book, conversation, result, signals }` or `{ ok: false, book, refusal }` | `language-learning/chat-metrics` `finishChat` | P9h language (PL.native-language-rows slice 1; core's P9h.core) |
| `language.difficulty.initial` | `{}` → `{ state }` | `language-learning/adaptation` `initialDifficulty` | P9h language (PL.native-language-rows slice 1; core's P9h.core) |
| `language.difficulty.recordTurn` | `{ state, metrics }` → `{ state, struggle, adjustment }` | `language-learning/adaptation` `recordTurn` | P9h language (PL.native-language-rows slice 1; core's P9h.core) |
| `language.bank.categories` | `{ book }` → `{ categories }`: first-seen order, `general` for an untagged word | `language-learning/bank-profile` `bankCategories` | P9h language (PL.native-language-rows slice 2; core's P9h.core) |
| `language.bank.cards` | `{ book, query? }` → `{ cards }` (`query`: `{ category?, sort?, limit?, due?, cefr? }`, absent or null members read as core's defaults; a sort outside `vocabularySorts` is `[invalid-input]`) | `language-learning/bank-profile` `bankCards` | P9h language (PL.native-language-rows slice 2; core's P9h.core) |
| `language.bank.revealsMeaning` | `{ reveal, interaction }` → `{ reveals }` | `language-learning/bank-profile` `revealsMeaning` | P9h language (PL.native-language-rows slice 2; core's P9h.core) |
| `language.bank.grammarTab` | `{ book }` → `{ tab }`: each pattern's attempts, half-up accuracy (null with none), mastered, weak | `language-learning/bank-profile` `grammarTab` | P9h language (PL.native-language-rows slice 2; core's P9h.core) |
| `language.bank.halfUpPercent` | `{ n, d }` → `{ percent }` | `language-learning/bank-profile` `halfUpPercent` | P9h language (PL.native-language-rows slice 2; core's P9h.core) |
| `language.bank.rateOf` | `{ row: { correct, incorrect } }` → `{ ratePermille }` | `language-learning/bank-profile` `rateOf` | P9h language (PL.native-language-rows slice 2; core's P9h.core) |
| `language.bank.weaknessPriority` | `{ incorrect, total }` → `{ priority }` (thousandths) | `language-learning/bank-profile` `weaknessPriority` | P9h language (PL.native-language-rows slice 2; core's P9h.core) |
| `language.bank.analyzeWeaknesses` | `{ book, options? }` → `{ weaknesses, stats, improved }` (`options`: `{ minRatePermille?, minAttempts?, max?, previous? }`) | `language-learning/bank-profile` `analyzeWeaknesses` | P9h language (PL.native-language-rows slice 2; core's P9h.core) |
| `language.bank.strongPatterns` | `{ book, max? }` → `{ patterns }` (absent max: core's 3) | `language-learning/bank-profile` `strongPatterns` | P9h language (PL.native-language-rows slice 2; core's P9h.core) |
| `language.profile.history` | `{ quests }` → `{ history }`: the finished records (completed, failed, abandoned), one row each | `language-learning/bank-profile` `learningHistory` | P9h language (PL.native-language-rows slice 2; core's P9h.core) |
| `language.profile.build` | `{ history, assessments }` → `{ cefrLevel, categories, skills, weakCategories, strongCategories, weakSkills, strongSkills, unexplored, completed, attempted }` | `language-learning/bank-profile` `learningProfile` | P9h language (PL.native-language-rows slice 2; core's P9h.core) |
| `language.difficulty.signals` | `{ metrics }` → `{ signals: { grammar, targetLanguage, length, quality } }` (thousandths) | `language-learning/adaptation` `struggleSignals` | P9h language (PL.native-language-rows slice 2; core's P9h.core) |
| `language.difficulty.score` | `{ metrics }` → `{ score }` (thousandths) | `language-learning/adaptation` `struggleScore` | P9h language (PL.native-language-rows slice 2; core's P9h.core) |
| `language.npc.hash` | `{ id }` → `{ hash }` | `language-learning/adaptation` `npcHash` | P9h language (PL.native-language-rows slice 2; core's P9h.core) |
| `language.npc.mode` | `{ level, npcId }` → `{ mode }` (`bilingual`, `simplified`, `natural`) | `language-learning/adaptation` `npcLanguageMode` | P9h language (PL.native-language-rows slice 2; core's P9h.core) |
| `language.npc.modeDirective` | `{ mode, target, native?, level? }` → `{ directive }` (absent native: `English`; with a band, its frequency constraint appended) | `language-learning/adaptation` `modeDirective` | P9h language (PL.native-language-rows slice 2; core's P9h.core) |
| `language.npc.scaffoldingDirective` | `{ level, target, native? }` → `{ directive }` (`''` at `none`) | `language-learning/adaptation` `scaffoldingDirective` | P9h language (PL.native-language-rows slice 2; core's P9h.core) |
| `language.npc.frequencyDirective` | `{ level, target }` → `{ directive }` | `language-learning/adaptation` `frequencyDirective` | P9h language (PL.native-language-rows slice 2; core's P9h.core) |
| `language.npc.adaptation` | `{ level, npcId, target, native?, scaffolding? }` → `{ mode, directive, scaffolding, hints, frequency, text, questPool }` | `language-learning/adaptation` `npcAdaptation` | P9h language (PL.native-language-rows slice 2; core's P9h.core) |
| `language.hints.behavior` | `{ level }` → `{ behavior: { translationMode, showTranslateButton, translateButtonProminence, newWordHintFrequency, advancedVocabOnly } }` | `language-learning/adaptation` `hintBehavior` | P9h language (PL.native-language-rows slice 2; core's P9h.core) |
| `language.hints.showsVocabHint` | `{ level, index, difficulty?, mastered? }` → `{ show }` | `language-learning/adaptation` `showsVocabHint` | P9h language (PL.native-language-rows slice 2; core's P9h.core) |
| `language.word.isMastered` | `{ encountered, correct }` → `{ mastered }` | `language-learning/adaptation` `isWordMastered` (core's `language/mastery`, re-exported) | P9h language (PL.native-language-rows slice 2; core's P9h.core) |
| `language.quests.filterByCefr` | `{ quests, level }` → `{ shown }` (ids: untagged, then within one band, closest first) | `language-learning/adaptation` `filterQuestsByCefr` | P9h language (PL.native-language-rows slice 2; core's P9h.core) |
| `language.cefr.advancement` | `{ snapshot: { level, wordsLearned, conversations, textsRead } }` → `{ advance, next, progress, words, conversations, texts }` | `language-learning/adaptation` `cefrAdvancement` | P9h language (PL.native-language-rows slice 2; core's P9h.core) |
| `language.pronunciation.encode` | `{ word }` → `{ code }` | `language/phonetic-similarity` `phoneticEncode` | P9h language (PL.native-language-rows slice 2; core's P9h.core) |
| `language.pronunciation.normalize` | `{ text }` → `{ normalized }` | `language-learning/pronunciation` `normalizePhrase` | P9h language (PL.native-language-rows slice 2; core's P9h.core) |
| `language.pronunciation.wordSimilarity` | `{ expected, spoken }` → `{ similarity, text, phonetic, expectedCode, spokenCode }` (thousandths) | `language-learning/pronunciation` `wordSimilarity` | P9h language (PL.native-language-rows slice 2; core's P9h.core) |
| `language.pronunciation.score` | `{ expected, spoken }` → `{ score, words, feedback }` | `language-learning/pronunciation` `scorePhrase` | P9h language (PL.native-language-rows slice 2; core's P9h.core) |
| `language.pronunciation.grade` | `{ score }` → `{ grade }` (`A`..`D`) | `language-learning/pronunciation` `grade` | P9h language (PL.native-language-rows slice 2; core's P9h.core) |
| `language.pronunciation.wordFeedback` | `{ words }` → `{ words: [{ word, status, similarity }] }` | `language-learning/pronunciation` `wordFeedback` | P9h language (PL.native-language-rows slice 2; core's P9h.core) |
| `language.pronunciation.xp` | `{ score }` → `{ xp }` | `language-learning/pronunciation` `listenXp` | P9h language (PL.native-language-rows slice 2; core's P9h.core) |
| `language.pronunciation.hintPenalty` | `{ score, penalties, revealed }` → `{ score }` | `language-learning/pronunciation` `hintPenalty` | P9h language (PL.native-language-rows slice 2; core's P9h.core) |
| `language.pronunciation.listenAndRepeat` | `{ phrase, spoken, questId? }` → `{ score, passed, xp, grade, feedback, message, narrative, words, events }` | `language-learning/pronunciation` `listenAndRepeat` | P9h language (PL.native-language-rows slice 2; core's P9h.core) |
| `language.collection.seed` | `{ state, category, answers }` → `{ state }` | `language-learning/world-words` `seedDistractors` | P9h language (PL.native-language-rows slice 3; core's P9h.core) |
| `language.collection.quizDraw` | `{ seed, objectId, quiz, i }` → `{ draw }` (0..999999) | `language-learning/world-words` `quizDraw` | P9h language (PL.native-language-rows slice 3; core's P9h.core) |
| `language.collection.inReach` | `{ state, at, tuning? }` → `{ inReach }` | `language-learning/world-words` `objectsInReach` | P9h language (PL.native-language-rows slice 3; core's P9h.core) |
| `language.collection.quiz` | `{ state, objectId, tuning? }` → `{ state, quiz }` | `language-learning/world-words` `raiseQuiz` | P9h language (PL.native-language-rows slice 3; core's P9h.core) |
| `language.collection.answer` | `{ state, objectId, answer, tuning? }` → `{ ok, state, correct, alreadyCollected, xp, label, answer, category, events }` or `{ ok: false, state, refusal }` | `language-learning/world-words` `answerQuiz` | P9h language (PL.native-language-rows slice 3; core's P9h.core) |
| `language.identification.normalize` | `{ text }` → `{ normalized }` | `language-learning/world-words` `normalizeAnswer` | P9h language (PL.native-language-rows slice 3; core's P9h.core) |
| `language.identification.editDistance` | `{ a, b }` → `{ distance }` | `language-learning/world-words` `editDistance` | P9h language (PL.native-language-rows slice 3; core's P9h.core) |
| `language.identification.distanceScore` | `{ distance, length }` → `{ score }` | `language-learning/world-words` `distanceScore` | P9h language (PL.native-language-rows slice 3; core's P9h.core) |
| `language.identification.removeQuest` | `{ state, questId }` → `{ state }` | `language-learning/world-words` `removeQuestTargets` | P9h language (PL.native-language-rows slice 3; core's P9h.core) |
| `language.identification.prompt` | `{ state, id, tuning? }` → `{ prompt, events }` | `language-learning/world-words` `identificationPrompt` | P9h language (PL.native-language-rows slice 3; core's P9h.core) |
| `language.identification.answer` | `{ state, id, input, tuning? }` → `{ ok, state, passed, score, feedback, bestMatch, objectiveCompleted, events }` or `{ ok: false, state, refusal }` | `language-learning/world-words` `answerIdentification` | P9h language (PL.native-language-rows slice 3; core's P9h.core) |
| `language.identification.quest` | `{ state, questId }` → `{ identified, total, complete }` | `language-learning/world-words` `questIdentification` | P9h language (PL.native-language-rows slice 3; core's P9h.core) |
| `language.naming.point` | `{ state, objectId, tuning? }` → `{ ok, prompt, attemptsLeft }` or `{ ok: false, refusal }` | `language-learning/world-words` `pointAt` | P9h language (PL.native-language-rows slice 3; core's P9h.core) |
| `language.naming.submit` | `{ state, objectId, input, tuning? }` → `{ ok, state, correct, xp, attempts, revealed, toasts, events }` or `{ ok: false, state, refusal }` | `language-learning/world-words` `submitName` | P9h language (PL.native-language-rows slice 3; core's P9h.core) |
| `language.objects.isSignRole` | `{ role }` → `{ sign }` | `language-learning/world-words` `isSignRole` | P9h language (PL.native-language-rows slice 3; core's P9h.core) |
| `language.objects.fluencyTier` | `{ fluency }` → `{ tier }` | `language-learning/world-words` `fluencyTier` | P9h language (PL.native-language-rows slice 3; core's P9h.core) |
| `language.objects.nearest` | `{ objects, at, range? }` → `{ object }` (or null) | `language-learning/world-words` `nearestObject` | P9h language (PL.native-language-rows slice 3; core's P9h.core) |
| `language.objects.examine` | `{ objects, at, options }` → `{ ok, action, title, description, tier, narrative, events }` or `{ ok: false, refusal }` | `language-learning/world-words` `examineNearest` | P9h language (PL.native-language-rows slice 3; core's P9h.core) |
| `language.writing.countWords` | `{ text }` → `{ words }` | `language-learning/reading-writing` `countWords` | P9h language (PL.native-language-rows slice 3; core's P9h.core) |
| `language.writing.view` | `{ config, text }` → `{ header, instructions, count, label, tone, canSubmit }` | `language-learning/reading-writing` `compositionView` | P9h language (PL.native-language-rows slice 3; core's P9h.core) |
| `language.writing.submit` | `{ config, text }` → `{ ok, text, wordCount, events }` or `{ ok: false, refusal }` | `language-learning/reading-writing` `submitComposition` | P9h language (PL.native-language-rows slice 3; core's P9h.core) |
| `language.listening.register` | `{ state, quest }` → `{ state }` | `language-learning/reading-writing` `registerListening` | P9h language (PL.native-language-rows slice 3; core's P9h.core) |
| `language.listening.prompt` | `{ state, npcId }` → `{ prompt }` (or null) | `language-learning/reading-writing` `listeningPrompt` | P9h language (PL.native-language-rows slice 3; core's P9h.core) |
| `language.listening.chat` | `{ state, npcId, player, npc }` → `{ state, captured, needsGrade }` | `language-learning/reading-writing` `listeningChat` | P9h language (PL.native-language-rows slice 3; core's P9h.core) |
| `language.listening.fallbackGrade` | `{ quest: { questions, answers } }` → `{ score, results }` | `language-learning/reading-writing` `fallbackGrade` | P9h language (PL.native-language-rows slice 3; core's P9h.core) |
| `language.listening.grade` | `{ state, questId, score }` → `{ state, completed }` | `language-learning/reading-writing` `gradeListening` | P9h language (PL.native-language-rows slice 3; core's P9h.core) |
| `language.questFeedback.initial` | `{ questId, objectives, meanings? }` → `{ state }` | `language-learning/quest-feedback` `questFeedback` | P9h language (PL.native-language-rows slice 4; core's P9h.core, U118(10)) |
| `language.questFeedback.targets` | `{ objectives }` → `{ targetWords, grammarPatterns, pronunciationPhrases, vocabularyRequired, pronunciationRequired, grammarRequired }` | `language-learning/quest-feedback` `questLanguageTargets` | P9h language (PL.native-language-rows slice 4; core's P9h.core) |
| `language.questFeedback.useVocabulary` | `{ state, usages }` → `{ state, items }` | `language-learning/quest-feedback` `useVocabulary` | P9h language (PL.native-language-rows slice 4; core's P9h.core, U118(10)) |
| `language.questFeedback.syncLifecycle` | `{ state, objectives }` → `{ state, items }` (the lifecycle's records, by index) | `language-learning/quest-feedback` `syncLifecycle` | P9h language (PL.native-language-rows slice 4; core's P9h.core, U118(10)) |
| `language.questFeedback.lockedVocabulary` | `{ state }` → `{ locked }` (indices) | `language-learning/quest-feedback` `lockedVocabulary` | P9h language (PL.native-language-rows slice 4; core's P9h.core) |
| `language.questFeedback.lockedPronunciation` | `{ state }` → `{ locked }` (indices) | `language-learning/quest-feedback` `lockedPronunciation` | P9h language (PL.native-language-rows slice 4; core's P9h.core) |
| `language.questFeedback.lockedGrammar` | `{ state }` → `{ locked }` (indices) | `language-learning/quest-feedback` `lockedGrammar` | P9h language (PL.native-language-rows slice 4; core's P9h.core) |
| `language.questFeedback.grammar` | `{ state, feedback }` → `{ state, items, objectivesUpdated }` | `language-learning/quest-feedback` `grammarFeedback` | P9h language (PL.native-language-rows slice 4; core's P9h.core) |
| `language.questFeedback.correctUsage` | `{ state, pattern, example? }` → `{ state, objectivesUpdated }` | `language-learning/quest-feedback` `correctUsage` | P9h language (PL.native-language-rows slice 4; core's P9h.core) |
| `language.questFeedback.grammarObjectiveComplete` | `{ state, index, accuracy?, correct? }` → `{ complete }` | `language-learning/quest-feedback` `grammarObjectiveComplete` | P9h language (PL.native-language-rows slice 4; core's P9h.core) |
| `language.questFeedback.pronunciation` | `{ state, result }` → `{ state, items }` | `language-learning/quest-feedback` `pronunciationFeedback` | P9h language (PL.native-language-rows slice 4; core's P9h.core) |
| `language.questFeedback.hints` | `{ state, max? }` → `{ state, items }` | `language-learning/quest-feedback` `vocabularyHints` | P9h language (PL.native-language-rows slice 4; core's P9h.core) |
| `language.questFeedback.done` | `{ state }` → `{ vocabulary, pronunciation, grammar }` | `language-learning/quest-feedback` `questFeedbackDone` | P9h language (PL.native-language-rows slice 4; core's P9h.core) |
| `language.questTypes.forWorld` | `{ world }` → `{ types }` (ids) | `quest-types/index` `getQuestTypesForWorld` | P9h language (PL.native-language-rows slice 4; core's P9h.core) |
| `language.questTypes.primary` | `{ world }` → `{ type }` (id) | `quest-types/index` `getQuestTypeForWorld` | P9h language (PL.native-language-rows slice 4; core's P9h.core) |
| `language.questTypes.definition` | `{ id }` → `{ definition }` (as data, or null) | `quest-types/index` `getQuestTypeById` | P9h language (PL.native-language-rows slice 4; core's P9h.core) |
| `language.questTypes.has` | `{ id }` → `{ has }` | `quest-types/index` `hasQuestType` | P9h language (PL.native-language-rows slice 4; core's P9h.core) |
| `language.questTypes.all` | `{}` → `{ definitions }` (as data) | `quest-types/index` `getAllQuestTypes` | P9h language (PL.native-language-rows slice 4; core's P9h.core) |
| `language.questTypes.mixing` | `{ ids }` → `{ definitions }` (as data) | `quest-types/index` `getQuestTypesForMixing` | P9h language (PL.native-language-rows slice 4; core's P9h.core) |
| `language.questTypes.merge` | `{ definitions }` → `{ questCategories, objectiveTypes, rewardTypes }` | `quest-types/index` `mergeQuestTypes` | P9h language (PL.native-language-rows slice 4; core's P9h.core) |
| `language.questTypes.objectiveComplete` | `{ questType, objective, progress }` → `{ complete }` | `quest-types/index` `QUEST_TYPE_REGISTRY` (an objective type's `completionCheck`) | P9h language (PL.native-language-rows slice 4; core's P9h.core) |
| `language.questTypes.templates` | `{}` → `{ templates }` | `language/quest-templates` `QUEST_TEMPLATES` | P9h language (PL.native-language-rows slice 4; core's P9h.core) |
| `language.questTypes.templatesByDifficulty` | `{ difficulty }` → `{ templates }` | `language/quest-templates` `getTemplatesByDifficulty` | P9h language (PL.native-language-rows slice 4; core's P9h.core) |
| `language.questTypes.templatesByCategory` | `{ category }` → `{ templates }` | `language/quest-templates` `getTemplatesByCategory` | P9h language (PL.native-language-rows slice 4; core's P9h.core) |
| `genre.world.of` | `{ world, slices? }` → `{ world }`: a slice by name, a slice with `dropFacts`/`dropEntities`/`player`, or an inline world | `genre-systems/systems-corpus` `worldOf` | P9j genre systems (PL.native-genre-rows slice 1; core's P9j.core) |
| `puzzle.contract` | `{}` → `{ relations, worldPredicates, authoredPredicates, runtimePredicates, writtenPredicates, defaultMaxAttempts, tuning, extensionKey, blockMembers, actorKeys }` | `puzzle/puzzle`, `puzzle/puzzle-predicates`, `puzzle/puzzle-save`, `PuzzleDirector` constants | P9j puzzle (PL.native-genre-rows slice 1; core's P9j.core) |
| `puzzle.forWorld` | `{ world, puzzle?, maxAttempts? }` → `{ definition }` (`puzzle` over the world's own section; `maxAttempts` a number or null) | `puzzle/puzzle` `puzzleForWorld` | P9j puzzle (PL.native-genre-rows slice 1; core's P9j.core) |
| `puzzle.generate` | `{ world, maxAttempts? }` → `{ definition }` | `puzzle/puzzle` `generatePuzzle` | P9j puzzle (PL.native-genre-rows slice 1; core's P9j.core) |
| `puzzle.issues` | `{ puzzle? }` → `{ issues }` | `puzzle/puzzle` `puzzleIssues` | P9j puzzle (PL.native-genre-rows slice 1; core's P9j.core) |
| `puzzle.fromIR` | `{ puzzle, maxAttempts? }` → `{ definition }` (a section with issues is core's error) | `puzzle/puzzle` `puzzleFromIR` | P9j puzzle (PL.native-genre-rows slice 1; core's P9j.core) |
| `puzzle.facts` | `{ definition }` → `{ facts }` | `puzzle/puzzle` `puzzleFacts` | P9j puzzle (PL.native-genre-rows slice 1; core's P9j.core) |
| `puzzle.worldFacts` | `{ world, definition }` → `{ facts }` | `puzzle/puzzle` `puzzleWorldFacts` | P9j puzzle (PL.native-genre-rows slice 1; core's P9j.core) |
| `puzzle.answerKey` | `{ world, definition }` → `{ answerKey }` | `puzzle/puzzle` `puzzleAnswerKey` | P9j puzzle (PL.native-genre-rows slice 1; core's P9j.core) |
| `puzzle.choices` | `{ world, riddle, count? }` → `{ choices }` | `puzzle/puzzle` `puzzleChoices` | P9j puzzle (PL.native-genre-rows slice 1; core's P9j.core) |
| `puzzle.director.create` | `{ definition, worldFacts?, kb? }` → `{ session, published }` (a KB of its own: `GamePrologEngine` genre `puzzle`) | `game-engine/logic/PuzzleDirector` (`publish`), `GamePrologEngine` | P9j puzzle (PL.native-genre-rows slice 1; core's P9j.core) |
| `puzzle.director.findClue` | `{ session, actor, text }` → `{ ok, refusal?, reason, applied }` | `PuzzleDirector.findClue` | P9j puzzle (PL.native-genre-rows slice 1; core's P9j.core) |
| `puzzle.director.answer` | `{ session, actor, riddle, given }` → the outcome with `correct`, `attemptsLeft` | `PuzzleDirector.answer` | P9j puzzle (PL.native-genre-rows slice 1; core's P9j.core) |
| `puzzle.director.unlock` | `{ session, actor, lock }` → the outcome with `unmet`, and `order` when it opened | `PuzzleDirector.unlock` | P9j puzzle (PL.native-genre-rows slice 1; core's P9j.core) |
| `puzzle.director.take` | `{ session, actor, item }` → the outcome | `PuzzleDirector.take` | P9j puzzle (PL.native-genre-rows slice 1; core's P9j.core) |
| `puzzle.director.view` | `{ session, actor, riddle }` → `{ view }` (null: no such riddle) | `PuzzleDirector.view` | P9j puzzle (PL.native-genre-rows slice 1; core's P9j.core) |
| `puzzle.director.progress` | `{ session, actor }` → `{ progress }` | `PuzzleDirector.progress` | P9j puzzle (PL.native-genre-rows slice 1; core's P9j.core) |
| `puzzle.director.isComplete` | `{ session, actor }` → `{ complete }` | `PuzzleDirector.isComplete` | P9j puzzle (PL.native-genre-rows slice 1; core's P9j.core) |
| `puzzle.director.serialize` | `{ session }` → `{ state }` | `PuzzleDirector.serialize` | P9j puzzle (PL.native-genre-rows slice 1; core's P9j.core) |
| `puzzle.director.restore` | `{ session, state }` → the outcome (`schema` once the director has actors) | `PuzzleDirector.restore` | P9j puzzle (PL.native-genre-rows slice 1; core's P9j.core) |
| `puzzle.director.stateFacts` | `{ state }` → `{ facts }` | `PuzzleDirector.stateFacts` | P9j puzzle (PL.native-genre-rows slice 1; core's P9j.core) |
| `puzzle.save.read` | `{ block? }` → `{ ok: true, value }` (null: no block) or `{ ok: false, keys }` | `puzzle/puzzle-save` `readPuzzleBlock` | P9j puzzle (PL.native-genre-rows slice 1; core's P9j.core) |
| `puzzle.save.block` | `{ state? }` → `{ block }` (null for no state) | `puzzle/puzzle-save` `puzzleSaveBlock` | P9j puzzle (PL.native-genre-rows slice 1; core's P9j.core) |
| `puzzle.save.blockOf` | `{ block }` → `{ block }` (rows by actor, lists in canonical order) | `puzzle/puzzle-save` `puzzleBlockOf` | P9j puzzle (PL.native-genre-rows slice 1; core's P9j.core) |
| `ui.saveSlots` | `{ slots: [{ index, envelope } or { index, outcome }, summary?] }` → `{ slots, hasAnyLoadable }` | `ui/save-slot-model` `SaveSlotModel` | P1 |
| `ui.loadRefusal` | `{ refusal }` → `{ outcome, message }`: every string `invalid_format` with its message; any other value `{ outcome: null, message: '' }` | `ui/save-slot-model` `slotOutcomeOfLoadRefusal`, `loadRefusalMessage` | P1 refused Load (PL.native-bundle-core-r2; core's PL.core-load-refusal-codes, U124(1), U126(2)) |
| `saves.slots.create` | `{ config?, slots?: [{ index, outcome, summary? }], activeSlot? }` → `{ session, config, view }` (`config` as core resolved it) | `save-slots` `SaveSlotsSession` (`resolveSaveSlotsConfig`) | P1 slots (PL.native-catchup; core's P1.core-slots, U83(1)) |
| `saves.slots.apply` | `{ session, ops: save, load, continue, delete, ask_delete, confirm_delete, cancel_delete, key, tick, finished, disk_changed }` → `{ results: [{ ok, refusal?, outcome?, effect, history?, disk? }], view }` | same | P1 slots |
| `props.contract` | `{}` → `{ <area>: { <table>: value } }` — the data tables each P6 corpus file's `contract` states (`props-containers`, `props-documents`, `props-notice-board`, `props-doors`, `ui-inventory`, `props-pickup-placement`, `props-interactables`) | `props/containers`, `props/documents`, `props/doors`, `props/notice-board`, `ui/inventory-model`, `props/pickup-placement`, `props/interactables` constants | P6 (PL.native-props-rows, U89(2); `props-pickup-placement` PL.native-pickup-settle, U91(2); `props-interactables` PL.native-interact-target, U94(3)) |
| `props.containers.view` | `{ container, context?: { playerItemIds?, buildings?, now? } }` → `{ view }` | `props/containers` `containerView` | P6 |
| `props.containers.unlock` | `{ container, context? }` → `{ result, container }` | `props/containers` `unlockContainer` | P6 |
| `props.containers.move` | `{ container, move: { kind: take } or { kind: put, itemId }, context? }` → `{ refusal }` (null: `ui.trade` may run it) | `props/containers` `containerMoveRefusal` | P6 |
| `props.containers.at` | `{ containers, location: { businessId?, residenceId?, lotId? } }` → `{ ids }` | `props/containers` `containersAtLocation` | P6 |
| `props.containers.respawn` | `{ container, now }` → `{ due }` | `props/containers` `containerRespawnDue` | P6 |
| `props.documents.document` | `{ document, options?: { charsPerPage? } }` → `{ ok: true, document }` or the refusal value `{ ok: false, refusal: { code, field } }` | `props/documents` `documentOf` | P6 |
| `props.documents.paginate` | `{ text, charsPerPage? }` → `{ pages }` | `props/documents` `paginateText` | P6 |
| `props.reader.create` | `{ document, options?, open?: { alreadyRead?, alreadyAnswered? } }` → `{ ok: true, session, document, view }`, or `documentOf`'s refusal value and no session | `props/documents` `DocumentReader` | P6 |
| `props.reader.apply` | `{ session, ops: next, prev, answer, close }` (every op goes to core; an unknown one is its `unknown_action`) → `{ results: [{ ok, events } or { ok: false, refusal }], view }` | same | P6 |
| `props.doors.door` | `{ building }` → `{ door: { id, state, doorAt, outside, label, interiorFunction } }` | `props/doors` `doorView` | P6 |
| `props.doors.prompt` | `{ buildings, player: { position, inside? } }` → `{ prompt }` (null when nothing prompts) | `props/doors` `doorPrompt` | P6 |
| `props.doors.step` | `{ buildings, inside?, playerItemIds?, action: { op: enter, building } or { op: exit } }` → `{ ok: true, handoff, inside }` or the refusal value | `props/doors` `doorStep` | P6 |
| `props.board.create` | `{ notices, fluency?, read?, answered?, questStatus? }` → `{ session, view }` | `props/notice-board` `NoticeBoard` | P6 |
| `props.board.apply` | `{ session, ops: select, answer, take_quest }` (every op goes to core) → `{ results, view }` | same | P6 |
| `props.notices.generate` | `{ settlementId, settlementName, npcs: [{ characterId, name, occupation? }] }` → `{ articles }` | `game-engine/logic/NoticeGenerator` `generateSettlementNotices` | P6 |
| `props.pickups.settle` | `{ spot, groundY?, settled?, obstacles?, roads?, walkable?, clearance?, search? }` → `{ ok: true, at, moved, shiftM, ring, clearanceM, nearest, authored, approach }`, or the refusal value `{ ok: false, code: no-clear-spot, clearest, authored, approach }` or `{ ok: false, code: bad-spot }` | `props/pickup-placement` `settlePickup` | P6 pick-up settle (PL.native-pickup-settle, U91(2); core's PL.pickup-placement, U89(3)) |
| `props.pickups.sequence` | `{ pickups: [{ spot, groundY? }], obstacles?, roads?, walkable?, clearance?, search? }` → `{ placements }` | `props/pickup-placement` `settlePickups` | P6 pick-up settle |
| `props.pickups.clearance` | `{ spot, groundY?, settled?, obstacles?, roads?, clearance? }` → `{ ok: true, clearanceM, nearest }` or `{ ok: false, code: bad-spot }` | `props/pickup-placement` `pickupClearance` | P6 pick-up settle |
| `props.pickups.pattern` | `{ search? }` → `{ rings: [{ radiusM, points }] }` | `props/pickup-placement` `pickupSearchPattern` | P6 pick-up settle |
| `props.pickups.ring` | `{ ring, search? }` → `{ points: [{ x, z }] }` | `props/pickup-placement` `pickupSearchRing` | P6 pick-up settle |
| `props.interactables.target` | `{ at, panel?, villager?, pickups?, containers?, buildings?, props?, board?, ranges?, aboard?, vehicles?, nodes?, hotspots?, actionTable?, busy?, now?, interior? }` → `{ ok: true, target: { action, kind, id, prompt, distance } or null }`, or the refusal value `{ ok: false, refusal: { code: bad_position, field: at } }` | `props/interactables` `interactTarget` | P8 interact (PL.native-interact-target, U94(3); core's PL.examine-props, U49(3)) |
| `props.interactables.examinePick` | `{ objects?, at }` → `{ pick }`: the nearest object with a role within 5 m of `at`, as sent, or null | `language-learning/prompt-selector` `examinePick` | P8 interact, one press (PL.native-bundle-core-r2; core's PL.core-interact-pick-precedence, U118(4)) |
| `props.interactables.press` | `{ target?, pick? }` → `{ source, id, target, pick, shadowed }`: the one object an E press acts on | `props/interactables` `resolveInteractPress` | P8 interact, one press (PL.native-bundle-core-r2) |
| `props.interactables.contract` | `{}` → `{ standWithoutY: { y: not_added, floor: every } }`: the rows' own reading of a stand with no y, as data | (these rows; core reads such a stand on every floor) | P8 interact (PL.native-bundle-core-r2, U126) |
| `props.interactables.interact` | `{ prop, board? }` → `{ ok: true, action, line, events }`, or the refusal value `{ ok: false, refusal: { code: not_offered, field: archetype, reason } }` | `props/interactables` `interactWithProp` | P8 interact |
| `props.interactables.meaning` | `{ prop, board? }` → `{ id, action, noun, prompt, text }` or `{ id, action: null, reason }` | `props/interactables` `propInteraction` | P8 interact |
| `props.interactables.host` | `{ props, settlement }` → `{ host }` (null: no board) | `props/interactables` `noticeBoardHost` | P8 interact |
| `props.interactables.noun` | `{ archetype }` → `{ noun }` | `props/interactables` `propNoun` | P8 interact |
| `inventory.create` | `{ player?: { gold, inventory } }` → `{ session, view: { filter, counts, gold, rows, equipment, save } }` | `ui/inventory-model` `InventoryViewModel` | P6 |
| `inventory.apply` | `{ session, ops: add, remove, filter, toggle, set_gold, add_gold, remove_gold, equip_flag, get, items, load, clear }` → `{ results, view }` | same | P6 |
| `ui.notifications.create` | `{}` → `{ session, view }` | `ui/notifications` `Notifications` | P2 |
| `ui.notifications.apply` | `{ session, ops: push, tick, dismiss, clear }` → `{ results, view }` | same | P2 |
| `ui.pause.create` | `{ enabledModules? or genre?, tabs? }` → `{ session, source, enabledModules, view }` | `ui/pause-menu-model` `PauseMenuModel`; `genre` via `resolveGenre` | P2 |
| `ui.pause.apply` | `{ session, ops: open, close, toggle, setActive }` → `{ results, view }` | same | P2 |
| `ui.journal.create` | `{ quests?, maxTracked? }` → `{ session, view }` | `ui/quest-journal-model` `QuestJournalModel` (journal, tracker HUD, offer) | P3 |
| `ui.journal.apply` | `{ session, ops: setQuests, upsert, accept, decline, complete, track, untrack, setFilter, get }` → `{ results, view }` | same | P3 |
| `ui.loading.create` | `{ phases?, tips? }` → `{ session, view }` | `ui/loading-screen-model` `LoadingScreenModel` | P8 |
| `ui.loading.apply` | `{ session, ops: advance, reset }` → `{ results, view }` | same | P8 |
| `ui.titleFlow.contract` | `{}` → `{ 'ui-title-flow': { entries, labels, messages, slotMessages, defaultTitle, defaultSlotCount, ops, steps } }` | `ui/title-flow` constants (`TITLE_ENTRIES`, …), `save-slots` `SAVE_SLOTS_DEFAULTS`, `ui/title-flow-corpus` ops and steps | P8 title (PL.native-title-rows, U92(1)) |
| `ui.titleFlow.create` | `{ menu?, savesSession? }` (`menu` core's `TitleFlowInput`, read by core; `savesSession` an open `saves.slots` session the menu reads live) → `{ session, view }` | `ui/title-flow` `titleMenu` | P8 title |
| `ui.titleFlow.apply` | `{ session, ops: choose, set }` → `{ results: [TitleChoice or null], view }`; a refusal (`busy`, `nothing_to_continue`, `no_saves`, `not_shown`, `unknown_entry`) is a VALUE | `ui/title-flow` `chooseTitleEntry`, `titleMenu` | P8 title |
| `ui.tutorial.contract` | `{}` → `{ 'quests-tutorial': { objectives, assessmentObjective, flows, ops, runSteps, onboardingSteps, t0 }, 'saves-tutorial-progress': { clockStart, extensionKey, blockMembers } }` | `TutorialQuestSystem` / `OnboardingManager` constants, `quests/tutorial-corpus-host` ops, steps and clock; `quests/tutorial-save` `TUTORIAL_EXTENSION_KEY`, `TUTORIAL_BLOCK_MEMBERS` | P8 onboarding; tutorial save (PL.native-tutorial-save, U99(1)) |
| `ui.tutorial.objectives` | `{ includeAssessment?, bindings? or unbind?, rebind?, bind? }` → `{ objectives }` | `TutorialQuestSystem` `buildTutorialObjectives` (`corpusBindings` for the changes) | P8 onboarding |
| `ui.tutorial.readProgress` | `{ stored? }` (a save's `currentState.extensions.tutorial`) → `{ ok: true, progress }` or `{ ok: false, keys }` (a VALUE, as core's load refuses it `unreadable_tutorial`) | `quests/tutorial-save` `readTutorialBlock` | tutorial save (PL.native-tutorial-save, U99(1)) |
| `ui.tutorial.create` | `{ config?, now? }` (`config.progress`: a stored tutorial block, read by `readTutorialBlock`; unreadable is `[invalid-input]`) → `{ session, title, description, objectives, events, view }` | `game-engine/logic/TutorialQuestSystem` over the session's own `GameEventBus` (`progress` restores); view `tutorialStateJson` | P8 onboarding; tutorial save |
| `ui.tutorial.apply` | `{ session, ops: start, event, complete, completeById, skip, skipNonAssessment, tick, save, dispose }` → `{ results: [{ result, events }], view }` (`save`: `saveProgress()`, the block a save stores) | same | P8 onboarding; tutorial save |
| `ui.onboarding.create` | `{ definition?, options?, now? }` (`options.progress` as `ui.tutorial.create`'s `config.progress`) → `{ session, totalSteps, view: { current, isComplete } }` | `game-engine/logic/OnboardingManager` | P8 onboarding; tutorial save |
| `ui.onboarding.apply` | `{ session, ops: start, complete, skip, event, tick, inspect, state, save }` → `{ results: [{ result, calls, events }], totalSteps, view }` | same (`getState` for `state`, `saveProgress` for `save`) | P8 onboarding; tutorial save |
| `ui.trade` | `{ state, ops: takeFromContainer, takeAllFromContainer, buy, sell }` → `{ results, state }` | `ui/trade-model` `TradeModel` | P6 |
| `quest.completion.create` | `{ quests? }` → `{ session, view }` | `game-engine/logic/QuestCompletionEngine` | P3 |
| `quest.completion.apply` | `{ session, ops: addQuest, removeQuest, clear, trackEvent, handleGameEvent, completeObjective, trackByTrigger, revealHint, checkTimedObjectives, restoreObjectiveStates }` → `{ results, events, view }` | same | P3 |
| `quest.markers` | `{ quests, npcs?, surface?, activeObjectiveNpcId?, readyToTurnIn? }` → `{ hasActiveQuest, npcs, locations, styles }` | `game-engine/logic/QuestMarkerService` | P3 |
| `quest.minimapMarkers` | `{ quests, resolvedPositions?, namedLocations?, activeObjectiveNpcId? }` → `{ markers }` | `game-engine/logic/QuestMinimapMarkers` `extractObjectiveMarkers` | P2/P3 (minimap) |
| `quest.waypoints` | `{ quest, player, forwardAngle?, buildings?, npcBuildingMap?, npcPositions? }` → `{ waypoints, compass }` | `game-engine/logic/DynamicQuestWaypointDirector` | P2/P3 (compass, waypoints) |
| `clock.create` | `{ msPerGameHour?, startHour?, startMinute?, startDay?, state? }` → `{ session, view }` | `game-engine/logic/GameTimeManager` | P4 |
| `clock.apply` | `{ session, ops: update, advanceHours, setTime, pause, resume, setTimeScale, setMsPerGameHour, restoreState }` → `{ results, events, view }` | same | P4 |
| `weather.climate` | `{ weather, tuning? }` → `{ climate, climateFacts, issues }` | `weather/weather` `climateFromIR`, `weatherIssues`; `weather/weather-facts` | P4 |
| `weather.run` | `{ weather or climate, seed, from, throughDay }` → `{ steps, final }` | `weather/weather` `runWeather`, `weatherView`; `weatherDelta` | P4 |
| `weather.create` | `{ weather, seed?, tuning?, state? }` → `{ session, state, view, issues }` | `game-engine/logic/WeatherDirector` | P4 |
| `weather.apply` | `{ session, ops: advanceTo, impose, restore, publishClimate, publishState }` → `{ results, writes, events, state, view, issues }` | same | P4 |
| `genre.registry` | `{}` → `{ defaultGenre, ids, genres, cameraModes }` | `game-genres/registry` | P9 |
| `genre.resolve` | `{ genre }` → core's `GenreResolution` | `game-genres/resolution` `resolveGenre` | P9 |
| `genre.camera` | `{ value }` → `{ mode }` | `game-genres/resolution` `normalizeCameraMode` | P7 |
| `genre.resolveGame` | `{ recipe?, world? }` → core's `GameGenreResolution` (refusals are errors with a code) | `game-genres/resolution` `resolveGameGenre` | P7/P9 |
| `genre.recipes` | `{}` → `{ ids, bindings }` | `game-genres/recipes` | P9 |
| `camera.movement.contract` | `{}` → `{ 'camera-movement': { modes, solidKinds, storeyM, gait, ground } }` — the data tables of core's `conformance/camera/movement.json` `contract` | `camera/movement-rules` `movementModeTable`, `MOVEMENT_SOLID_KINDS`, `BUILDING_STOREY_M`, `PLAYER_GAIT`, `PLAYER_GROUND` | P7 movement (PL.native-camera-movement, U95(5); core's PL.movement-contract, U94(4)) |
| `camera.movement.occluders` | `{ mode, feet, view?, solids?, exclude? }` → `{ rule, pivot, lens, hidden: [{ id, atM }], unreadable }`, or the refusal value `{ error: missing-view-yaw }` | `camera/movement-rules` `sightOccluders` | P7 movement |
| `camera.movement.sideView` | `{ mode, feet, radiusM, solids? }` → `{ depthZ, blockers: [{ id, xMin, xMax, bottomY, topY }], unreadable }`, or the refusal values `{ error: not-a-side-view }` and `{ error: invalid-radius }` | `camera/movement-rules` `sideViewBlockers` | P7 movement |
| `camera.movement.buildingSolid` | `{ building }` → `{ solid }` (null: no footprint stated) | `camera/movement-rules` `buildingSolidOf` | P7 movement |
| `camera.movement.move` | `{ mode, move: { forward, right }, viewYawDeg?, walkMps, running? }` → `{ frame, plane, viewYawDeg, velocity, speedMps }`, or the refusal values `{ error }`: `invalid-move`, `invalid-walk`, `missing-view-yaw` | `camera/movement-rules` `playerMove` | P7 movement |
| `camera.movement.slope` | `{ slopeDeg }` → `{ response }`: `walk`, `slide`, `blocked`, or null (unreadable) | `camera/movement-rules` `slopeResponse` | P7 movement |
| `camera.movement.slopeAtRest` | `{ slopeDeg }` → `{ atRest }`: `stand`, `slideBack`, or null (unreadable) | `camera/movement-rules` `slopeAtRest` | P7 movement |
| `camera.movement.step` | `{ riseM }` → `{ response }`: `none`, `step`, `blocked`, or null (unreadable) | `camera/movement-rules` `stepResponse` | P7 movement |
| `audio.ground.contract` | `{}` → `{ 'audio-ground': { ground: { tiers, kindDefaults, kindFallback }, defaultFootstepSurface } }` — the data of core's `conformance/audio/ground.json` `contract` | `audio/ground-from-ir` `GROUND_TIERS`, `GROUND_SURFACE_KIND_DEFAULTS`, `GROUND_SURFACE_KIND_FALLBACK`; `audio/footsteps` `DEFAULT_FOOTSTEP_SURFACE` | P5 ground (PL.native-ground-row, U97(3); core's PL.ground-from-ir, U94(5)) |
| `audio.ground.placeAt` | `{ world, at }` → `{ reading }`: `{ place: settlement, settlementId, settlementName }`, `{ place: wilderness, settlementId: null, settlementName: null }`, or null (no position) | `audio/ground-from-ir` `placeAt` | P5 ground |
| `audio.ground.groundSurfaceAt` | `{ world, at }` → `{ reading }`: `{ surface, tier, shapeId }` (tier `road`, `closed`, `open`, or `ground`: the open ground `terrain.texture.ground`, a default), or null (no position) | `audio/ground-from-ir` `groundSurfaceAt` | P5 ground |
| `audio.ground.footstepAt` | `{ world, at, gait }` → `{ cue }`: `{ key, surface, gait, volume, intervalSec, source }`, or null (no step) | `audio/ground-from-ir` `footstepAt` | P5 ground |
| `survival.needs.tuning` | `{ survival?, params? }` → `{ ok, value: SurvivalTuning }` | `survival/needs` `survivalTuningFromIR` | P9c survival (PL.native-survival-rows, U106(1); core's P9c.core, PL.core-survival-rules) |
| `survival.needs.initial` | `{ survival?, params?, at? }` → `{ ok, value: SurvivalState }` | `survival/needs` `initialSurvival` | P9c survival |
| `survival.needs.advance` | `{ survival?, params?, state, at }` → `{ state, ticks, skipped, events, expired, hurt }` | `survival/needs` `advanceSurvival` | P9c survival |
| `survival.needs.restore` | `{ survival?, params?, state, need, amount, at }` → `{ ok: true, state, events }` or `{ ok: false, reason, state }` | `survival/needs` `restoreNeed` | P9c survival |
| `survival.needs.action` | `{ survival?, params?, state, action, at, amount? }` → `{ ok: true, state, events }` or `{ ok: false, reason, state }` | `survival/needs` `performSurvivalAction` | P9c survival |
| `survival.needs.consume` | `{ survival?, params?, state, effects, at }` → `{ state, applied, events }` | `survival/needs` `consumeForNeeds` | P9c survival |
| `survival.needs.useItem` | `{ survival?, params?, state, item, at }` → `{ ok: true, state, consumed, remaining, applied, action, events }` or `{ ok: false, reason, state }` | `survival/needs` `useItemForNeeds` | P9c survival |
| `survival.needs.setTemperature` | `{ survival?, params?, state, value, at }` → `{ ok: true, state, events }` or `{ ok: false, reason, state }` | `survival/needs` `setEnvironmentTemperature` | P9c survival |
| `survival.needs.modifier` | `{ survival?, params?, state, modifier, at }` → `{ ok: true, state, events }` or `{ ok: false, reason, state }` | `survival/needs` `applyNeedModifier` | P9c survival |
| `survival.needs.removeModifier` | `{ state, id }` → `{ state }` | `survival/needs` `removeNeedModifier` | P9c survival |
| `survival.needs.enable` | `{ state, enabled }` → `{ state }` | `survival/needs` `setSurvivalEnabled` | P9c survival |
| `survival.needs.save` | `{ state, at }` → `{ ok, value: SavedSurvivalNeeds }` (the `survivalNeeds` save extension) | `survival/needs` `survivalSaveBlock` | P9c survival |
| `survival.needs.load` | `{ block, survival?, params?, at? }` → `{ ok, value: SurvivalState }`, or the value `{ ok: false, refusal: { code: unreadable_survival, field: block, keys } }` | `survival/needs` `readSurvivalBlock`, `survivalFromSave` | P9c survival |
| `survival.hud.initial` | `{}` → `{ hud }` (a new HUD state) | `survival/survival-hud` `initialSurvivalHud` | P9c survival |
| `survival.hud.view` | `{ survival?, params?, state?, hud?, now, visible?, stamina?, staminaConfig? }` → `{ ok, value: { visible, bars } }` | `survival/survival-hud` `survivalHudView` | P9c survival |
| `survival.hud.reduce` | `{ hud, events }` → `{ hud }` (a needs row's band changes as the bars' flashes) | `survival/survival-hud` `reduceSurvivalHud` | P9c survival |
| `survival.hud.stamina` | `{ hud, stamina: { current, max }, staminaConfig?, at }` → `{ hud, band, events }` | `survival/survival-hud` `reduceStaminaHud` | P9c survival |
| `survival.hud.systems` | `{ request, catalog }` → `{ ok, value: { needs, stamina, running, worldActivation } }`, or the value `{ ok: false, refusal: { code, field: request } }` | `survival/survival-systems` `survivalSystemsRunning` over `system-packs/composer` `resolveComposition`; `modules/module-activation` `resolveWorldActivation` | P9c survival |
| `survival.stamina.tuning` | `{ staminaConfig? }` → `{ ok, value: StaminaTuning }` | `stamina/stamina` `staminaTuningFromIR` | P9c survival |
| `survival.stamina.state` | `{ current, max, staminaConfig? }` → `{ state }` (`fresh`, `winded`, `exhausted`) | `stamina/stamina` `staminaStateOf` | P9c survival |
| `survival.stamina.spend` | `{ current, max, cost, staminaConfig? }` → `{ ok, value: StaminaSpendResult }` | `stamina/stamina` `spendStamina` | P9c survival |
| `survival.stamina.regen` | `{ current, max, ticks, rate?, inCombat?, encumbered?, staminaConfig? }` → `{ ok, value: StaminaRegenResult }` | `stamina/stamina` `regenerateStamina` | P9c survival |
| `survival.stamina.clock` | `{ lastTickAt, now, tickMs? }` → `{ ticks, lastTickAt }` | `stamina/stamina` `staminaRestClock` | P9c survival |
| `survival.stamina.pool.create` | `{ staminaConfig?, costs?, actions?, actors?, survivalActorId?, start?, state? }` → `{ session, view: { tuning, actors } }` | `game-engine/logic/StaminaPool` | P9c survival |
| `survival.stamina.pool.apply` | `{ session, ops }` → `{ results, view }`; ops `cost`, `afford`, `spend`, `rest`, `play`, `band`, `save` | `StaminaPool` `costOf`, `canAfford`, `spend`, `rest` (with `staminaRestClock`), `stateOf`, `serialize` | P9c survival |
| `traversal.affordances.tuning` | `{ traversal? }` (the World IR's `traversal` block) → `{ tuning }` (`TraversalTuning`; absent: core's defaults) | `traversal/traversal` `traversalTuningFromIR` | P9e traversal kernels (PL.native-traversal-rows slice 1, U106(1); core's P9e.core) |
| `traversal.affordances.links` | `{ traversal? }` → `{ links }` (the block's authored links as `TraversalLink`s) | `traversal/traversal` `traversalLinksFromIR` | P9e traversal kernels |
| `traversal.affordances.resolve` | `{ actor, from, links, modes, blocked?, geometry?, stamina?, tuning? }` → `{ affordances }` (every authored way out of `from`, refused ones included, sorted) | `traversal/traversal` `resolveAffordances` | P9e traversal kernels |
| `traversal.affordances.best` | `{ affordances, to }` → `{ best }` (the cheapest available affordance to `to`, or null) | `traversal/traversal` `bestAffordance` | P9e traversal kernels |
| `traversal.affordances.route` | `{ …resolve's args, to, maxSteps? }` → `{ route }` (`{ from, to, steps, cost, conditional }`, or null) | `traversal/traversal` `findRoute` | P9e traversal kernels |
| `traversal.affordances.graphFacts` | `{ links, tuning? }` → `{ facts }` (`traversal_link/3` per link, `traversal_cost/3` and `traversal_requires/3` per edge) | `traversal/traversal-facts` `traversalGraphFacts` | P9e traversal kernels |
| `traversal.vehicles.fromIR` | `{ vehicles? }` (the IR's `traversal.vehicles`) → `{ vehicles }` | `traversal/vehicles` `vehiclesFromIR` | P9e traversal kernels |
| `traversal.vehicles.resolve` | `{ vehicle, state, actor, at, verb }` → `{ resolution }` (`{ vehicle, actor, verb, action, available, refusal?, grants? }`) | `traversal/vehicles` `resolveVehicleVerb` | P9e traversal kernels |
| `traversal.vehicles.apply` | `{ state, actor, verb, resolution }` → `{ next }` (null for a refused verb) | `traversal/vehicles` `applyVehicleVerb` | P9e traversal kernels |
| `traversal.vehicles.actions` | `{ vehicle }` → `{ actions }` (`{ board, drive, disembark }`) | `traversal/vehicles` `vehicleActions` | P9e traversal kernels |
| `traversal.vehicles.seats` | `{ vehicle }` → `{ seats }` | `traversal/vehicles` `vehicleSeats` | P9e traversal kernels |
| `traversal.vehicles.modeFact` | `{ vehicle }` → `{ fact }` (`vehicle_mode/2`) | `traversal/vehicle-facts` `vehicleModeFact` | P9e traversal kernels |
| `traversal.vehicles.stateFacts` | `{ state }` → `{ facts }` | `traversal/vehicle-facts` `vehicleStateFacts` | P9e traversal kernels |
| `traversal.vehicles.stateDelta` | `{ before?, after }` → `{ delta: { retract, assert } }` | `traversal/vehicle-facts` `vehicleStateDelta` | P9e traversal kernels |
| `traversal.vehicles.anothers` | `{ state, actor }` → `{ anothers }` | `traversal/vehicles` `isAnothersVehicle` | P9e traversal kernels |
| `traversal.fastTravel.tuning` | `{ fastTravel? }` (the IR's `traversal.fastTravel`) → `{ tuning }` (`FastTravelTuning`) | `traversal/fast-travel` `fastTravelTuningFromIR` | P9e traversal kernels |
| `traversal.fastTravel.ceiling` | `{ tuning }` → `{ ceiling }` | `traversal/fast-travel` `fastTravelCeiling` | P9e traversal kernels |
| `traversal.fastTravel.hours` | `{ routeCost, tuning }` → `{ hours }` | `traversal/fast-travel` `fastTravelHours` | P9e traversal kernels |
| `traversal.fastTravel.plan` | `{ seed, actor, from, to, journey, route, tuning? }` → `{ plan }` (`{ …, cost, hours, ceiling, capped, steps, requires }`) | `traversal/fast-travel` `planFastTravel` | P9e traversal kernels |
| `traversal.fastTravel.arrival` | `{ actor, from, to }` → `{ delta }` | `traversal/fast-travel-facts` `fastTravelArrivalDelta` | P9e traversal kernels |
| `traversal.fastTravel.discovery` | `{ location, known }` → `{ delta }` | `traversal/fast-travel-facts` `discoveryDelta` | P9e traversal kernels |
| `traversal.groundSeating.tuning` | `{ params? }` → `GroundSeatTuning` (a `conformance/traversal/ground-seating.json` `tuning` case's `input` → its `expected`) | `ground-seating/ground-seat` `groundSeatTuning` | P9e traversal kernels |
| `traversal.groundSeating.footprint` | `{ xMm, zMm, params? }` → `{ points }` | `ground-seating/ground-seat` `footprintPoints` | P9e traversal kernels |
| `traversal.groundSeating.ground` | `{ probes, fromMm, params? }` → `{ found, heightMm, paved }` | `ground-seating/ground-seat` `drawnGround` | P9e traversal kernels |
| `traversal.groundSeating.target` | `{ meshMm, probes, params? }` → `{ reason, wantMm, onPaving }` | `ground-seating/ground-seat` `seatTarget` | P9e traversal kernels |
| `traversal.groundSeating.stand` | `{ bodyMm, probes, params? }` → `{ reason, heightMm, onPaving }` | `ground-seating/ground-seat` `standSeat` | P9e traversal kernels |
| `traversal.groundSeating.moved` | `{ from: { xMm, zMm }, to }` → `{ moved }` | `ground-seating/ground-seat` `movedSideways` | P9e traversal kernels |
| `traversal.groundSeating.initial` | `{}` → `{ state }` (a `SeatState`, not seated) | `ground-seating/ground-seat` `initialSeat` | P9e traversal kernels |
| `traversal.groundSeating.retarget` | `{ state, wantMm, at, params? }` → `{ state }` | `ground-seating/ground-seat` `retargetSeat` | P9e traversal kernels |
| `traversal.groundSeating.offsetAt` | `{ state, at, params? }` → `{ offsetMm }` | `ground-seating/ground-seat` `seatOffsetAt` | P9e traversal kernels |
| `traversal.groundSeating.unseat` | `{}` → `{ state }` | `ground-seating/ground-seat` `unseat` | P9e traversal kernels |
| `traversal.personal.tuning` | `{ params? }` → `{ tuning }` (`PersonalVehicleTuning`: kinds merged by id over the bicycle and horse, the cycle, on-foot rates) | `traversal/personal-vehicles` `personalVehicleTuning` | P9e traversal layers (PL.native-traversal-rows slice 2, U106(1); core's P9e.core) |
| `traversal.personal.pace` | `{ kind, params? }` → `{ pace }` (`{ walk, run, turn, strafe, back }` in thousandths; null kind: on foot) | `traversal/personal-vehicles` `personalPace` | P9e traversal layers |
| `traversal.personal.label` | `{ kind, params? }` → `{ label }` | `traversal/personal-vehicles` `personalVehicleLabel` | P9e traversal layers |
| `traversal.personal.modes` | `{ modes, lent?, from, to, params? }` → `{ modes, lent }` (what a host hands `setModes`) | `traversal/personal-vehicles` `personalVehicleModes` | P9e traversal layers |
| `traversal.personal.initial` | `{}` → `{ state }` (nobody riding) | `traversal/personal-vehicles` `initialPersonalVehicles` | P9e traversal layers |
| `traversal.personal.mount` | `{ state, actor, kind, inVehicle?, params? }` → `{ ok, refusal?, detail?, state, kind, pace, label, events }` | `traversal/personal-vehicles` `mountPersonalVehicle` | P9e traversal layers |
| `traversal.personal.dismount` | `{ state, actor, inVehicle?, params? }` → the same | `traversal/personal-vehicles` `dismountPersonalVehicle` | P9e traversal layers |
| `traversal.personal.cycle` | `{ state, actor, inVehicle?, params? }` → the same | `traversal/personal-vehicles` `cyclePersonalVehicle` | P9e traversal layers |
| `traversal.personal.saveRows` | `{ state }` → `{ riding }` (`{ <actor>: <kind> }`) | `traversal/personal-vehicles` `personalVehicleSaveRows` | P9e traversal layers |
| `traversal.personal.fromSave` | `{ riding?, params? }` → `{ state, dropped }` | `traversal/personal-vehicles` `personalVehiclesFromSave` | P9e traversal layers |
| `traversal.lending.lend` | `{ modes, lent?, mode, lender }` → `{ modes, lent }` | `traversal/mode-lending` `lendMode` | P9e traversal layers |
| `traversal.lending.giveBack` | `{ modes, lent?, mode, lender }` → `{ modes, lent }` | `traversal/mode-lending` `returnMode` | P9e traversal layers |
| `traversal.lending.canonical` | `{ lent?, modes }` → `{ lent }` | `traversal/mode-lending` `canonicalLent` | P9e traversal layers |
| `traversal.lending.vehicleLender` | `{ vehicle }` → `{ lender }` (`vehicle:<id>`) | `traversal/mode-lending` `vehicleLender` | P9e traversal layers |
| `traversal.lending.personalLender` | `{ kind }` → `{ lender }` (`personal:<kind>`) | `traversal/mode-lending` `personalLender` | P9e traversal layers |
| `traversal.rider.posture` | `{ actor, state?, vehicles? }` → `{ posture: { kind, aboard } }` (the personal kind ridden in `state`; the first world vehicle of `vehicles`, in canonical id order, that carries `actor`) | `traversal/rider-intent` `riderPostureOf` | P9e rider intent (PL.native-bundle-core; core's PL.core-ride-intent, U106(4)) |
| `traversal.rider.intent` | `{ posture: { kind, aboard } }` → `{ rider }` (`ride` aboard anything, null aboard nothing) | `traversal/rider-intent` `riderIntent` | P9e rider intent |
| `traversal.rider.body` | `{ prior, rider? }` → `{ body }` (the rider intent while there is one, else `prior`; both animation intents) | `traversal/rider-intent` `bodyIntent` | P9e rider intent |
| `traversal.rider.vehicleRiders` | `{ state }` → `{ riders }` (occupant → `ride`, canonical order; `{}` parked) | `traversal/rider-intent` `vehicleRiderIntents` | P9e rider intent |
| `traversal.save.block` | `{ planner?, vehicles?, fastTravel?, riding? }` → `{ key, block }` (the block stored at `currentState.extensions[key]`) | `traversal/traversal-save` `traversalSaveBlock`, `traversalBlockOf`, `TRAVERSAL_EXTENSION_KEY` | P9e traversal layers |
| `traversal.save.read` | `{ block? }` → `{ ok: true, value }` or `{ ok: false, keys }` | `traversal/traversal-save` `readTraversalBlock` | P9e traversal layers |
| `traversal.session.create` | `{ links?, tuning?, vehicles?, fastTravel?, seed?, stamina?, probe?, locomotion?, personal? }` → `{ session, view }` (view: the four layers' state) | `game-engine/logic/TraversalPlanner`, `VehicleRegistry`, `FastTravelDirector`, `StaminaPool`, `GameEventBus` (wired as core's doc §1) | P9e traversal layers (a session) |
| `traversal.session.apply` | `{ session, ops }` → `{ results, view }` (each op one core call under a named key, plus `events`, `orders`, `clock`; ops in "The traversal layers") | the same three layers, `traversal/personal-vehicles`, `traversal/traversal-save` | P9e traversal layers (a session) |
| `build.contract` | `{}` → core's tables, as `conformance/build/headless.json`'s `contract` states them (less `secretFixtures`, `rules`, `schemas.jsonSchemas`): schema ids, platforms, steps, artefact kinds, primary artefacts, statuses, refusal / note / issue / progress-issue codes in order, failure steps, reserved folders, timeouts, `secretKeyStandIn`, `hiddenDetail` | `build/headless-build` constants, `system-packs/schema` `SYSTEM_PACKS_LOCK_SCHEMA` | P10 headless build |
| `build.plan` | `{ request, context?: { lock?, files?, predicateSchemaHash? } }` → `{ ok, refusals: [{ code, field, detail }], notes: [{ code, field, detail }], plan }` | `build/headless-build` `planBuild` | P10 headless build |
| `build.checkResult` | `{ request, result, context? }` → `{ ok, issues: [{ code, field, detail }], summary: { status, platform, primary, bytes, open, line } \| null }` | `build/headless-build` `checkBuildResult` | P10 headless build |
| `build.checkProgress` | `{ request, events }` → `{ ok, issues: [{ code, field, detail }], summary: { step, stepNumber, steps, fraction, canStop, line } \| null }` | `build/headless-build` `checkBuildProgress` | P10 headless build |
| `build.size` | `{ bytes }` → `{ text }` | `build/headless-build` `formatBuildSize` | P10 headless build |
| `build.resultLine` | `{ result, hideDetails? }` → `{ line }` | `build/headless-build` `buildResultLine` | P10 headless build |
| `build.progressLine` | `{ event: { step, fraction } }` → `{ line }` | `build/headless-build` `buildProgressLine` | P10 headless build |
| `build.isSecretKey` | `{ key }` → `{ secret }` | `build/headless-build` `isSecretKey` | P10 headless build |
| `build.looksLikeSecret` | `{ value }` → `{ secret }` | `build/headless-build` `looksLikeSecret` | P10 headless build |
| `build.findSecrets` | `{ value }` (any JSON) → `{ fields }` (dotted, code-unit sorted; a credential key as `<credential>`) | `build/headless-build` `findSecrets` | P10 headless build |
| `build.pathProblem` | `{ path }` → `{ problem }` (`absolute`, `parent`, `backslash`, `empty-segment` or null) | `build/headless-build` `projectPathProblem` | P10 headless build |
| `build.foldMacos` | `{ path }` → `{ folded }` | `build/headless-build` `foldPathCaseMacos` | P10 headless build |
| `build.foldWindows` | `{ path }` → `{ folded }` | `build/headless-build` `foldPathCaseWindows` | P10 headless build |
| `build.insideDir` | `{ path, dir }` → `{ inside }` (as spelt) | `build/headless-build` `isInsideDir` | P10 headless build |
| `build.insideDirFolded` | `{ path, dir }` → `{ inside }` (under either fold) | `build/headless-build` `isInsideDirFolded` | P10 headless build |
| `build.compareCodeUnits` | `{ a, b }` → `{ order }` (-1, 0, 1) | `build/headless-build` `compareCodeUnits` | P10 headless build |
| `build.resolvePlatform` | `{ platform, host }` → `{ platform }` | `build/headless-build` `resolveBuildPlatform` | P10 headless build |
| `build.isPrimaryArtefact` | `{ platform, artefact: { path, kind } }` → `{ primary }` | `build/headless-build` `isPrimaryArtefactFor` | P10 headless build |
| `progression.gamification.tuning` | `{ tuning? }` → `{ ok: true, value }`: core's tuning with the pack's `tuning` over it | `progression/gamification` `GAMIFICATION_TUNING` | P9i progression (PL.native-progression-rows) |
| `progression.gamification.levelForXp` | `{ total, thresholds? }` → `{ ok: true, value }` | `progression/gamification` `levelForXp` | P9i progression (PL.native-progression-rows) |
| `progression.gamification.nextLevelXp` | `{ level, thresholds? }` → `{ ok: true, value }` (0 at the top) | `progression/gamification` `nextLevelXp` | P9i progression (PL.native-progression-rows) |
| `progression.gamification.progressPermille` | `{ total, thresholds? }` → `{ ok: true, value }` | `progression/gamification` `levelProgressPermille` | P9i progression (PL.native-progression-rows) |
| `progression.gamification.tier` | `{ level, labels? }` → `{ ok: true, value }` | `progression/gamification` `levelTier` | P9i progression (PL.native-progression-rows) |
| `progression.gamification.table` | `{ bundle?, tuning?, overrides? }` → `{ ok: true, value }`: the XP event table | `progression/gamification` `xpEventTable` | P9i progression (PL.native-progression-rows) |
| `progression.gamification.achievements` | `{}` → `{ ok: true, value }`: the catalogue in order | `progression/gamification` `ACHIEVEMENTS` | P9i progression (PL.native-progression-rows) |
| `progression.gamification.dailyIndex` | `{ date }` → `{ ok: true, value }` | `progression/gamification` `dailyTemplateIndex` | P9i progression (PL.native-progression-rows) |
| `progression.gamification.previousDate` | `{ date }` → `{ ok: true, value }` | `progression/gamification` `previousDateKey` | P9i progression (PL.native-progression-rows) |
| `progression.gamification.dailyChallenge` | `{ daily: { dateKey, progress, completed } }` → `{ ok: true, value }` | `progression/gamification` `dailyChallengeView` | P9i progression (PL.native-progression-rows) |
| `progression.gamification.streakTenths` | `{ streak, tuning? }` → `{ ok: true, value }` | `progression/gamification` `streakMultiplierTenths` | P9i progression (PL.native-progression-rows) |
| `progression.gamification.streakXp` | `{ reward, streak, tuning? }` → `{ ok: true, value }` | `progression/gamification` `streakXp` | P9i progression (PL.native-progression-rows) |
| `progression.gamification.initial` | `{}` → `{ ok: true, value }`: a new learner's state | `progression/gamification` `emptyGamification` | P9i progression (PL.native-progression-rows) |
| `progression.gamification.step` | `{ run: { state, date }, step: { do, … }, tuning?, config?, at? }` → `{ ok: true, value }` with `{ run, events, signals, refusal? }`; a refused step (`bad_date`, `unknown_award`, `unknown_event`, which an unknown step kind also answers) is a value | `progression/gamification` `applyGamification` | P9i progression (PL.native-progression-rows) |
| `progression.gamification.view` | `{ state, config? }` → `{ ok: true, value }`: what a progress panel draws | `progression/gamification` `gamificationView` | P9i progression (PL.native-progression-rows) |
| `progression.modules.definitions` | `{}` → `{ ok: true, value }` with `{ definitions, verdicts }` | `progression/feature-modules` `FEATURE_MODULE_DEFINITIONS`, `FEATURE_MODULE_VERDICTS` | P9i progression (PL.native-progression-rows) |
| `progression.modules.bundleModules` | `{ bundle }` → `{ ok: true, value }` (`[]` for an unknown bundle) | `feature-modules/genre-bundles` `getDefaultModulesForGenre` | P9i progression (PL.native-progression-rows) |
| `progression.modules.resolve` | `{ ids, bundle? }` → `{ ok: true, value }`: enabled, refused (values) and the contributions | `progression/feature-modules` `resolveFeatureModules` | P9i progression (PL.native-progression-rows) |
| `progression.modules.genre` | `{ genre }` → `{ ok: true, value }` with `{ genre, bundle, featureModules, enabled, refused, tabsDeclared, tabs, configs }` (the corpus's `genre` record) | `game-genres/resolution` `resolveGenre`, `getDefaultModulesForGenre`, `resolveFeatureModules`, `ui/pause-menu-model` `DEFAULT_MENU_TABS` and `PauseMenuModel`, `bundleModuleConfigs` | P9i progression (PL.native-progression-rows) |
| `progression.modules.configs` | `{ bundle }` → `{ ok: true, value }` | `progression/feature-modules` `bundleModuleConfigs` | P9i progression (PL.native-progression-rows) |
| `progression.modules.proficiencyTiers` | `{ tierLabels? }` → `{ ok: true, value }` | `progression/feature-modules` `proficiencyTiers` | P9i progression (PL.native-progression-rows) |
| `progression.modules.proficiency` | `{ scores, tiers?, scale? }` → `{ ok: true, value }` | `progression/feature-modules` `proficiencyOf` | P9i progression (PL.native-progression-rows) |
| `progression.modules.difficultyTiers` | `{ tierLabels? }` → `{ ok: true, value }` | `progression/feature-modules` `difficultyTiers` | P9i progression (PL.native-progression-rows) |
| `progression.modules.difficulty` | `{ score, tiers? }` → `{ ok: true, value }` | `progression/feature-modules` `difficultyParams` | P9i progression (PL.native-progression-rows) |
| `progression.modules.performance` | `{ records }` → `{ ok: true, value }` | `progression/feature-modules` `performanceScore` | P9i progression (PL.native-progression-rows) |
| `progression.modules.adjust` | `{ records, current }` → `{ ok: true, value }` | `progression/feature-modules` `adjustDifficulty` | P9i progression (PL.native-progression-rows) |
| `progression.modules.applyAdjustment` | `{ adjustment, objectiveCount, estimatedMinutes }` → `{ ok: true, value }` | `progression/feature-modules` `applyAdjustment` | P9i progression (PL.native-progression-rows) |
| `progression.modules.records` | `{ quests }` → `{ ok: true, value }` | `progression/feature-modules` `performanceRecords` | P9i progression (PL.native-progression-rows) |
| `progression.skills.domain` | `{}` → `{ ok: true, value }`: the language and guild domain trees as a World IR `skills` section | `skills/domain-trees` `DOMAIN_SKILL_TREES` | P9i progression (PL.native-progression-rows) |
| `progression.save.build` | `{ gamification?, skills? }` → `{ ok: true, value }`: the `progression` save block | `progression/progression-save` `progressionSaveBlock` | P9i progression (PL.native-progression-rows) |
| `progression.save.read` | `{ block }` → `{ ok: true, value }` with core's `{ ok: true, value }` or `{ ok: false, keys }` | `progression/progression-save` `readProgressionBlock` | P9i progression (PL.native-progression-rows) |
| `progression.save.write` | `{ block }` → `{ ok: true, value }`: the block as the writer stores it | `progression/progression-save` `progressionBlockOf` | P9i progression (PL.native-progression-rows) |
| `skill.ir.tuning` | `{ ir? }` → `{ ok: true, value }` | `skills/skills` `skillTuningFromIR` | P9i skill trees (PL.native-progression-rows) |
| `skill.ir.skills` | `{ ir?, tuning? }` → `{ ok: true, value }` | `skills/skills` `skillDefinitionsFromIR` | P9i skill trees (PL.native-progression-rows) |
| `skill.ir.trees` | `{ ir? }` → `{ ok: true, value }` | `skills/skills` `skillTreesFromIR` | P9i skill trees (PL.native-progression-rows) |
| `skill.advancement.resolve` | `{ actor, skill, skillId?, level, banked, levels, tuning }` → `{ ok: true, value }`: the price and the verdict (refusal a value) | `skills/skills` `resolveAdvance` | P9i skill trees (PL.native-progression-rows) |
| `skill.advancement.xpForLevel` | `{ skill, level, tuning }` → `{ ok: true, value }`: one level's price | `skills/skills` `xpForLevel` | P9i skill trees (PL.native-progression-rows) |
| `skill.advancement.maxLevel` | `{ skill, tuning }` → `{ ok: true, value }` | `skills/skills` `maxLevelOf` | P9i skill trees (PL.native-progression-rows) |
| `skill.unlocks.resolve` | `{ actor, node, nodeId?, points, unlocked, tuning }` → `{ ok: true, value }`: cost, `requires`, `conditional` and core's own refusal (a value) | `skills/skills` `resolveUnlock` | P9i skill trees (PL.native-progression-rows) |
| `skill.unlocks.requirements` | `{ node }` → `{ ok: true, value }` | `skills/skills` `nodeRequirements` | P9i skill trees (PL.native-progression-rows) |
| `skill.unlocks.cost` | `{ node, tuning }` → `{ ok: true, value }` | `skills/skills` `nodeCost` | P9i skill trees (PL.native-progression-rows) |
| `skill.effects.modifiers` | `{ effects }` → `{ ok: true, value }` as `{ param: total }` | `skills/skill-effects` `skillModifiers` | P9i skill trees (PL.native-progression-rows) |
| `skill.effects.unlocks` | `{ effects }` → `{ ok: true, value }` | `skills/skill-effects` `unlockedActions` | P9i skill trees (PL.native-progression-rows) |
| `skill.effects.permits` | `{ effects }` → `{ ok: true, value }` | `skills/skill-effects` `permittedThings` | P9i skill trees (PL.native-progression-rows) |
| `skill.effects.apply` | `{ snapshot, effects }` → `{ ok: true, value }`: the snapshot modified | `skills/skill-effects` `withSkillModifiers` | P9i skill trees (PL.native-progression-rows) |
| `skill.effects.modifierOf` | `{ effects, parameter }` → `{ ok: true, value }` | `skills/skill-effects` `modifierOf` | P9i skill trees (PL.native-progression-rows) |
| `skill.trees.view` | `{ trees, skills?, tuning?, actor }` → `{ ok: true, value }`: the tree a skill panel draws | `skills/skill-view` `buildSkillView` | P9i skill trees (PL.native-progression-rows) |
| `skill.trees.funded` | `{ trees, skill }` → `{ ok: true, value }` | `skills/skills` `treesFundedBy` | P9i skill trees (PL.native-progression-rows) |
| `skill.trees.depth` | `{ tree, node }` → `{ ok: true, value }` | `skills/skills` `nodeDepth` | P9i skill trees (PL.native-progression-rows) |
| `skill.trees.facts` | `{ trees, tuning }` → `{ ok: true, value }`: one clause per line | `skills/skill-facts` `skillTreeFacts` | P9i skill trees (PL.native-progression-rows) |
| `skill.create` | `{ skills?, trees?, tuning?, state?, kb? }` → `{ session, view: { roster, kb } }`; `kb` (a program, or a list of clauses) is a native KB the session consults and owns; a program the KB refuses is `[invalid-input]` | `game-engine/logic/SkillProgression` `new SkillProgression` | P9i skill trees (PL.native-progression-rows) |
| `skill.register` | `{ session, actor: { id, levels?, xp?, points?, unlocked? } }` → `{ ok: true, value, events }`: the fact delta | `game-engine/logic/SkillProgression` `register` | P9i skill trees (PL.native-progression-rows) |
| `skill.unregister` | `{ session, actor }` → `{ ok: true, value, events }` | `game-engine/logic/SkillProgression` `unregister` | P9i skill trees (PL.native-progression-rows) |
| `skill.award` | `{ session, actor, skill, amount }` → `{ ok: true, value, events }` | `game-engine/logic/SkillProgression` `award` | P9i skill trees (PL.native-progression-rows) |
| `skill.priceOfNextLevel` | `{ session, actor, skill }` → `{ ok: true, value, events }` | `game-engine/logic/SkillProgression` `priceOfNextLevel` | P9i skill trees (PL.native-progression-rows) |
| `skill.canAdvance` | `{ session, actor, skill }` → `{ ok: true, value, events }` | `game-engine/logic/SkillProgression` `canAdvance` | P9i skill trees (PL.native-progression-rows) |
| `skill.advance` | `{ session, actor, skill }` → `{ ok: true, value, events }` | `game-engine/logic/SkillProgression` `advance` | P9i skill trees (PL.native-progression-rows) |
| `skill.canUnlock` | `{ session, actor, node }` → `{ ok: true, value, events }`: resolution, then `skill_goal_met/2` in the KB (no KB: every goal unmet), then permissibility | `game-engine/logic/SkillProgression` `canUnlock` | P9i skill trees (PL.native-progression-rows) |
| `skill.unlock` | `{ session, actor, node }` → `{ ok: true, value, events }`: `performed`, or a refusal value (`unknown`, `owned`, `points`, `requires`, `forbidden`); with a KB a node's goals are core's `skill_goal_met/2`'s (U106(7)), with none a node that asks anything stays locked | `game-engine/logic/SkillProgression` `unlock` | P9i skill trees (PL.native-progression-rows) |
| `skill.view` | `{ session, actor }` → `{ ok: true, value, events }` | `game-engine/logic/SkillProgression` `viewOf` | P9i skill trees (PL.native-progression-rows) |
| `skill.effectsOf` | `{ session, actor }` → `{ ok: true, value, events }` | `game-engine/logic/SkillProgression` `effectsOf` | P9i skill trees (PL.native-progression-rows) |
| `skill.modifiersOf` | `{ session, actor }` → `{ ok: true, value, events }` with `{ param: total }` | `game-engine/logic/SkillProgression` `modifiersOf` | P9i skill trees (PL.native-progression-rows) |
| `skill.serialize` | `{ session }` → `{ ok: true, value, events }`: the roster a save carries | `game-engine/logic/SkillProgression` `serialize` | P9i skill trees (PL.native-progression-rows) |
| `skill.restore` | `{ session, state }` → `{ ok: true, value, events }` (silent) | `game-engine/logic/SkillProgression` `restore` | P9i skill trees (PL.native-progression-rows) |
| `skill.publishWorld` | `{ session }` → `{ ok: true, value, events }`: clauses asserted (0 with no KB) | `game-engine/logic/SkillProgression` `publishWorld` | P9i skill trees (PL.native-progression-rows) |
| `skill.publishActors` | `{ session }` → `{ ok: true, value, events }`: clauses asserted (0 with no KB) | `game-engine/logic/SkillProgression` `publishActors` | P9i skill trees (PL.native-progression-rows) |
| `skill.lastWriteRefusal` | `{ session }` → `{ ok: true, value, events }`: why the last write was refused, or null | `game-engine/logic/SkillProgression` `lastWriteRefusal` | P9i skill trees (PL.native-progression-rows) |
| `skill.kb.liveFacts` | `{ prologFacts }` → `{ ok: true, value: { live: [{ fact, clause }], dropped: [{ at, code }] } }` | `progression/skill-kb` `skillKbLiveFactsOf` | P9i skill KB live facts (PL.native-bundle-core-r2; core's PL.core-skill-kb-live-facts, PL.core-skill-kb-rule-head-facts) |
| `skill.kb.loadJson` | `{ currentState }` → `{ ok: true, facts, dropped, roster }` or `{ ok: false, refusal }`: what a load recomposes the skill KB from | `progression/skill-kb` `skillKbLoadJson` | P1 village-state save (PL.native-village-save-rows; core's P1.core, PL.core-save-conversations-projection) |
| `skill.kb.compose` | `{ pack?, world?, facts? }` → `{ ok: true, value }`: the program a recomposing host consults | `progression/skill-kb` `composeSkillKbProgram` | P9i skill KB live facts (PL.native-bundle-core-r2; core's PL.core-skill-kb-live-facts, PL.core-skill-kb-rule-head-facts) |
| `skill.kb.open` | `{ program?, pack?, skills?, trees?, tuning? }` → `{ session, view: { facts } }`: a skill session with a native KB of its own | `progression/skill-kb` `SkillKbSession.open` | P9i skill KB live facts (PL.native-bundle-core-r2; core's PL.core-skill-kb-live-facts, PL.core-skill-kb-rule-head-facts) |
| `skill.kb.load` | `{ session, currentState }` → `{ ok: true, value: { ok: true, dropped } or { ok: false, refusal } }` | `progression/skill-kb` `SkillKbSession.load` | P9i skill KB live facts (PL.native-bundle-core-r2; core's PL.core-skill-kb-live-facts, PL.core-skill-kb-rule-head-facts) |
| `skill.kb.assert` | `{ session, fact }` → `{ ok: true, value: { changed } or { changed: false, refusal } }` | `progression/skill-kb` `SkillKbSession.assert` | P9i skill KB live facts (PL.native-bundle-core-r2; core's PL.core-skill-kb-live-facts, PL.core-skill-kb-rule-head-facts) |
| `skill.kb.retract` | `{ session, fact }` → `{ ok: true, value: { changed } or { changed: false, refusal } }` | `progression/skill-kb` `SkillKbSession.retract` | P9i skill KB live facts (PL.native-bundle-core-r2; core's PL.core-skill-kb-live-facts, PL.core-skill-kb-rule-head-facts) |
| `skill.kb.canUnlock` | `{ session, actor, node }` → `{ ok: true, value }`: the unlock decision over the current KB | `progression/skill-kb` `SkillKbSession.canUnlock` | P9i skill KB live facts (PL.native-bundle-core-r2; core's PL.core-skill-kb-live-facts, PL.core-skill-kb-rule-head-facts) |
| `skill.kb.unlock` | `{ session, actor, node }` → `{ ok: true, value }`: the unlock report | `progression/skill-kb` `SkillKbSession.unlock` | P9i skill KB live facts (PL.native-bundle-core-r2; core's PL.core-skill-kb-live-facts, PL.core-skill-kb-rule-head-facts) |
| `skill.kb.facts` | `{ session }` → `{ ok: true, value }`: the live clauses, in clause order | `progression/skill-kb` `SkillKbSession.facts` | P9i skill KB live facts (PL.native-bundle-core-r2; core's PL.core-skill-kb-live-facts, PL.core-skill-kb-rule-head-facts) |
| `skill.kb.savedFacts` | `{ session }` → `{ ok: true, value }`: the live facts as `currentState.prologFacts` keeps them | `progression/skill-kb` `SkillKbSession.savedFacts` | P9i skill KB live facts (PL.native-bundle-core-r2; core's PL.core-skill-kb-live-facts, PL.core-skill-kb-rule-head-facts) |
| `skill.kb.program` | `{ session }` → `{ ok: true, value }`: what a recomposing host would consult now | `progression/skill-kb` `SkillKbSession.program` | P9i skill KB live facts (PL.native-bundle-core-r2; core's PL.core-skill-kb-live-facts, PL.core-skill-kb-rule-head-facts) |
| `skill.kb.serialize` | `{ session }` → `{ ok: true, value }`: the session's roster, for the save's skills block | `progression/skill-kb` `SkillKbSession.progression` | P9i skill KB live facts (PL.native-bundle-core-r2; core's PL.core-skill-kb-live-facts, PL.core-skill-kb-rule-head-facts) |
| `ui.genreHud` | `{ op: config, view, genre_view, config_of or view_of, ...input }` (a `conformance/ui/genre-hud-cases.json` case's `op` and `input`; `config_of` / `view_of` take a game's own settings, `{ genreConfig }` or `{ recipe, world? }`, plus `state?` for `view_of`) → its `expected` shape: `{ ok: true, value }` or a refusal VALUE `{ ok: false, refusal: { code, field } }` (`unresolved_recipe` also carries `reason`); an unknown `op` is an error `[unknown-op]` | `ui/genre-hud-corpus` `runGenreHudOp` (`genre-hud-model`, `genreHudConfigOf`; `game-genres/resolution` `resolveGameGenre` for a recipe) | P9a.native (U84); `config_of` / `view_of` PL.native-genre-hud-config (U92(2)) |
| `ui.rulesPanel` | `{ op: panel, card, byCategory, byType or isActive, ...input }` (a `conformance/ui/rules-panel-cases.json` case's `op` and `input`) → its `expected` shape; an unknown `op` is an error `[unknown-op]`, an input of the wrong JSON type `[invalid-input]` | `ui/rules-panel-corpus` `runRulesPanelOp` (`rules-panel-model`) | P9a.native (U84) |
| `packs.compose` | `{ recipe?, world?, game?, engine?, catalog: { index, manifests } }` → core's `Composition` (packs, settings, activation, overrides; a refused choice is a `refusals` entry; a refused recipe, preset, request or engine is an error with a code) | `system-packs/composer` `resolveComposition` | SP.composer-native (U62(1)) |
| `modules.activate` | `{ ir }` or `{ genre }` or `{}` → `{ source, active, predicatePacks, hostInterfaces, reason }` | `modules/module-activation` | P9 (Godot's fork has the same row) |
| `modules.table` | `{}` → core's `moduleActivationTable()` | same | P9 |
| `prolog.packs` | `{ areas? }` → `{ packs: [{ area, prolog, runtimePredicates }], order, unknown }` | `prolog/predicate-packs` | P9 |
| `mechanics.run` | `{ ir: { meta: { genreConfig, enabledModules? }, routines? }, seed, steps }` (a `conformance/modules/mechanic-runtime.json` case's `input`) → `{ plan, steps, events }`; an IR without a `meta.genreConfig.id`, a seed or a step of the wrong JSON type is an error `[invalid-input]`, a step op core's runner does not apply `[unknown-op]`; `meta.enabledModules` goes to core unchecked (not an array: the genre decides, as `modules.activate` answers) | `game-engine/mechanic-runtime-corpus` `runMechanicRuntimeCase` over `game-engine/mechanic-runtime` `createMechanicRuntime` | P9a.native (U84) |
| `layout.ops` | `{}` → `{ layout, composition }` — core's `LAYOUT_OPS` and `COMPOSITION_OPS` | `editor/layout/corpus`, `editor/layout/composition/corpus` | L.native-layout (U36) |
| `layout.isDoorPartName` | a `conformance/layout/` case's `input` → its `expected` shape | `editor/layout/corpus` `runLayoutOp('isDoorPartName')` | L.native-layout |
| `layout.faceYawOf` | a `conformance/layout/` case's `input` → its `expected` shape | `editor/layout/corpus` `runLayoutOp('faceYawOf')` | L.native-layout |
| `layout.chooseDoorPart` | a `conformance/layout/` case's `input` → its `expected` shape | `editor/layout/corpus` `runLayoutOp('chooseDoorPart')` | L.native-layout |
| `layout.bodyStature` | a `conformance/layout/` case's `input` → its `expected` shape | `editor/layout/corpus` `runLayoutOp('bodyStature')` | L.native-layout |
| `layout.fitBuildingToLot` | a `conformance/layout/` case's `input` → its `expected` shape | `editor/layout/corpus` `runLayoutOp('fitBuildingToLot')` | L.native-layout |
| `layout.buildingAreaOf` | a `conformance/layout/` case's `input` → its `expected` shape | `editor/layout/corpus` `runLayoutOp('buildingAreaOf')` | PL.native-survival-rows' re-pin (core's PL.fit-front-line) |
| `layout.findFitOverlaps` | a `conformance/layout/` case's `input` → its `expected` shape | `editor/layout/corpus` `runLayoutOp('findFitOverlaps')` | L.native-layout |
| `layout.settleSeparation` | a `conformance/layout/` case's `input` → its `expected` shape | `editor/layout/corpus` `runLayoutOp('settleSeparation')` | L.native-layout |
| `layout.settleBodies` | a `conformance/layout/` case's `input` → its `expected` shape | `editor/layout/corpus` `runLayoutOp('settleBodies')` | L.native-layout |
| `layout.settleFittedBuildings` | a `conformance/layout/` case's `input` → its `expected` shape | `editor/layout/corpus` `runLayoutOp('settleFittedBuildings')` | L.native-layout |
| `layout.settleClearance` | a `conformance/layout/` case's `input` → its `expected` shape | `editor/layout/corpus` `runLayoutOp('settleClearance')` | L.native-layout |
| `layout.clearancePairGap` | a `conformance/layout/` case's `input` → its `expected` shape | `editor/layout/corpus` `runLayoutOp('clearancePairGap')` | L.native-layout |
| `layout.markerClearance` | a `conformance/layout/` case's `input` → its `expected` shape | `editor/layout/corpus` `runLayoutOp('markerClearance')` | L.native-layout |
| `layout.plantWallClearance` | a `conformance/layout/` case's `input` → its `expected` shape | `editor/layout/corpus` `runLayoutOp('plantWallClearance')` | L.native-layout |
| `layout.settleBuildingMaxShift` | a `conformance/layout/` case's `input` → its `expected` shape | `editor/layout/corpus` `runLayoutOp('settleBuildingMaxShift')` | L.native-layout |
| `layout.pairingSeatSink` | a `conformance/layout/` case's `input` → its `expected` shape | `editor/layout/corpus` `runLayoutOp('pairingSeatSink')` | L.native-layout |
| `layout.layoutObstaclesOf` | a `conformance/layout/` case's `input` → its `expected` shape | `editor/layout/corpus` `runLayoutOp('layoutObstaclesOf')` | L.native-layout |
| `layout.plantTrunkOutline` | a `conformance/layout/` case's `input` → its `expected` shape | `editor/layout/corpus` `runLayoutOp('plantTrunkOutline')` | L.native-layout |
| `layout.layoutConstants` | a `conformance/layout/` case's `input` → its `expected` shape | `editor/layout/corpus` `runLayoutOp('layoutConstants')` | L.native-layout |
| `layout.startClearOutline` | a `conformance/layout/` case's `input` → its `expected` shape | `editor/layout/corpus` `runLayoutOp('startClearOutline')` | P9a.native (core's PL.start-clearance, U78) |
| `layout.settleDoorFrontage` | a `conformance/layout/` case's `input` → its `expected` shape | `editor/layout/corpus` `runLayoutOp('settleDoorFrontage')` | PL.native-survival-rows' re-pin (core's PL.brightwater-door-facing) |
| `layout.doorApproachOutline` | a `conformance/layout/` case's `input` → its `expected` shape | `editor/layout/corpus` `runLayoutOp('doorApproachOutline')` | PL.native-survival-rows' re-pin (core's PL.brightwater-door-facing) |
| `layout.buildGroundPlan` | a `conformance/layout/` case's `input` → its `expected` shape | `editor/layout/corpus` `runLayoutOp('buildGroundPlan')` | L.native-layout |
| `layout.gradeTerrain` | a `conformance/layout/` case's `input` → its `expected` shape | `editor/layout/corpus` `runLayoutOp('gradeTerrain')` | L.native-layout |
| `layout.followSettledBuildings` | a `conformance/layout/` case's `input` → its `expected` shape | `editor/layout/corpus` `runLayoutOp('followSettledBuildings')` | L.native-layout |
| `layout.pathMouths` | a `conformance/layout/` case's `input` → its `expected` shape | `editor/layout/corpus` `runLayoutOp('pathMouths')` | L.native-layout |
| `layout.lanternsAtPathMouths` | a `conformance/layout/` case's `input` → its `expected` shape | `editor/layout/corpus` `runLayoutOp('lanternsAtPathMouths')` | L.native-layout |
| `layout.keepPlantPropsOffPaving` | a `conformance/layout/` case's `input` → its `expected` shape | `editor/layout/corpus` `runLayoutOp('keepPlantPropsOffPaving')` | L.native-layout |
| `layout.trimGeneratedPoints` | a `conformance/layout/` case's `input` → its `expected` shape | `editor/layout/corpus` `runLayoutOp('trimGeneratedPoints')` | L.native-layout |
| `layout.keepLookNeighbours` | a `conformance/layout/` case's `input` → its `expected` shape | `editor/layout/corpus` `runLayoutOp('keepLookNeighbours')` | L.native-layout |
| `layout.keepStatedRows` | a `conformance/layout/` case's `input` → its `expected` shape | `editor/layout/corpus` `runLayoutOp('keepStatedRows')` | L.native-layout |
| `layout.planDistances` | a `conformance/layout/` case's `input` → its `expected` shape | `editor/layout/corpus` `runLayoutOp('planDistances')` | L.native-layout |
| `layout.margins` | a `conformance/layout/` case's `input` → its `expected` shape | `editor/layout/corpus` `runLayoutOp('margins')` | L.native-layout |
| `layout.readGroundLayers` | a `conformance/layout/` case's `input` → its `expected` shape | `editor/layout/corpus` `runLayoutOp('readGroundLayers')` | L.native-layout |
| `layout.resolveGroundPaint` | a `conformance/layout/` case's `input` → its `expected` shape | `editor/layout/corpus` `runLayoutOp('resolveGroundPaint')` | L.native-layout |
| `layout.groundNoise` | a `conformance/layout/` case's `input` → its `expected` shape | `editor/layout/corpus` `runLayoutOp('groundNoise')` | L.native-layout |
| `layout.groundCoverage` | a `conformance/layout/` case's `input` → its `expected` shape | `editor/layout/corpus` `runLayoutOp('groundCoverage')` | L.native-layout |
| `layout.groundLayerWeights` | a `conformance/layout/` case's `input` → its `expected` shape | `editor/layout/corpus` `runLayoutOp('groundLayerWeights')` | L.native-layout |
| `layout.clump` | a `conformance/layout/` case's `input` → its `expected` shape | `editor/layout/corpus` `runLayoutOp('clump')` | L.native-layout |
| `layout.lookHash01` | a `conformance/layout/` case's `input` → its `expected` shape | `editor/layout/corpus` `runLayoutOp('lookHash01')` | L.native-layout |
| `layout.lookNeighbours` | a `conformance/layout/` case's `input` → its `expected` shape | `editor/layout/corpus` `runLayoutOp('lookNeighbours')` | L.native-layout |
| `layout.lookPropStands` | a `conformance/layout/` case's `input` → its `expected` shape | `editor/layout/corpus` `runLayoutOp('lookPropStands')` | L.native-layout |
| `layout.backdropRing` | a `conformance/layout/` case's `input` → its `expected` shape | `editor/layout/corpus` `runLayoutOp('backdropRing')` | L.native-layout |
| `layout.backdropFrame` | a `conformance/layout/` case's `input` → its `expected` shape | `editor/layout/corpus` `runLayoutOp('backdropFrame')` | L.native-layout |
| `layout.composeLaneNetwork` | a `conformance/layout-composition/` case's `input` (with its `ruleOverrides`) → its `expected` shape | `editor/layout/composition/corpus` `runCompositionOp('composeLaneNetwork')` | L.native-layout |
| `layout.transitionCoverage` | a `conformance/layout-composition/` case's `input` (with its `ruleOverrides`) → its `expected` shape | `editor/layout/composition/corpus` `runCompositionOp('transitionCoverage')` | L.native-layout |
| `layout.edgeBreakup` | a `conformance/layout-composition/` case's `input` (with its `ruleOverrides`) → its `expected` shape | `editor/layout/composition/corpus` `runCompositionOp('edgeBreakup')` | L.native-layout |
| `layout.groundTransitionCoverage` | a `conformance/layout-composition/` case's `input` (with its `ruleOverrides`) → its `expected` shape | `editor/layout/composition/corpus` `runCompositionOp('groundTransitionCoverage')` | L.native-layout |
| `layout.transitionBounds` | a `conformance/layout-composition/` case's `input` (with its `ruleOverrides`) → its `expected` shape | `editor/layout/composition/corpus` `runCompositionOp('transitionBounds')` | L.native-layout |
| `layout.auditGroundEdges` | a `conformance/layout-composition/` case's `input` (with its `ruleOverrides`) → its `expected` shape | `editor/layout/composition/corpus` `runCompositionOp('auditGroundEdges')` | L.native-layout |
| `layout.coverageAudit` | a `conformance/layout-composition/` case's `input` (with its `ruleOverrides`) → its `expected` shape | `editor/layout/composition/corpus` `runCompositionOp('coverageAudit')` | L.native-layout |
| `layout.propPurpose` | a `conformance/layout-composition/` case's `input` (with its `ruleOverrides`) → its `expected` shape | `editor/layout/composition/corpus` `runCompositionOp('propPurpose')` | L.native-layout |
| `layout.groupProps` | a `conformance/layout-composition/` case's `input` (with its `ruleOverrides`) → its `expected` shape | `editor/layout/composition/corpus` `runCompositionOp('groupProps')` | L.native-layout |
| `layout.auditPropGroups` | a `conformance/layout-composition/` case's `input` (with its `ruleOverrides`) → its `expected` shape | `editor/layout/composition/corpus` `runCompositionOp('auditPropGroups')` | L.native-layout |
| `layout.trimFloraOffSquare` | a `conformance/layout-composition/` case's `input` (with its `ruleOverrides`) → its `expected` shape | `editor/layout/composition/corpus` `runCompositionOp('trimFloraOffSquare')` | L.native-layout |
| `layout.yardRole` | a `conformance/layout-composition/` case's `input` (with its `ruleOverrides`) → its `expected` shape | `editor/layout/composition/corpus` `runCompositionOp('yardRole')` | L.native-layout |
| `layout.composeYards` | a `conformance/layout-composition/` case's `input` (with its `ruleOverrides`) → its `expected` shape | `editor/layout/composition/corpus` `runCompositionOp('composeYards')` | L.native-layout |
| `layout.lanternsOnRoutes` | a `conformance/layout-composition/` case's `input` (with its `ruleOverrides`) → its `expected` shape | `editor/layout/composition/corpus` `runCompositionOp('lanternsOnRoutes')` | L.native-layout |
| `layout.foliageKind` | a `conformance/layout-composition/` case's `input` (with its `ruleOverrides`) → its `expected` shape | `editor/layout/composition/corpus` `runCompositionOp('foliageKind')` | L.native-layout |
| `layout.composeFoliage` | a `conformance/layout-composition/` case's `input` (with its `ruleOverrides`) → its `expected` shape | `editor/layout/composition/corpus` `runCompositionOp('composeFoliage')` | L.native-layout |
| `layout.auditFoliageSpacing` | a `conformance/layout-composition/` case's `input` (with its `ruleOverrides`) → its `expected` shape | `editor/layout/composition/corpus` `runCompositionOp('auditFoliageSpacing')` | L.native-layout |
| `layout.assignHouseModels` | a `conformance/layout-composition/` case's `input` (with its `ruleOverrides`) → its `expected` shape | `editor/layout/composition/corpus` `runCompositionOp('assignHouseModels')` | L.native-layout |
| `layout.seatCapacity` | a `conformance/layout-composition/` case's `input` (with its `ruleOverrides`) → its `expected` shape | `editor/layout/composition/corpus` `runCompositionOp('seatCapacity')` | L.native-layout |
| `layout.seatVillagers` | a `conformance/layout-composition/` case's `input` (with its `ruleOverrides`) → its `expected` shape | `editor/layout/composition/corpus` `runCompositionOp('seatVillagers')` | L.native-layout |
| `layout.keepClearOfProps` | a `conformance/layout-composition/` case's `input` (with its `ruleOverrides`) → its `expected` shape | `editor/layout/composition/corpus` `runCompositionOp('keepClearOfProps')` | L.native-layout |
| `layout.composeVillage` | a `conformance/layout-composition/` case's `input` (with its `ruleOverrides`) → its `expected` shape | `editor/layout/composition/corpus` `runCompositionOp('composeVillage')` | L.native-layout |
<!-- END METHOD TABLE -->

Each row's comment in `js/entry.js` gives the exact argument and result fields.
A row DECIDES nothing: it builds what core takes from JSON (a Map, a callback),
checks at the boundary the enumerations core's TypeScript types declare but JSON
cannot (a notification kind, a quest status, a slot outcome, a marker surface),
and hands core's answer back. One place does more, and says so in its comment:

- `weather.run` steps core's pure functions exactly as core's
  `scripts/emit-weather-progression-corpus.ts` does (that script writes files at
  import, so it cannot be bundled).

### The layout rows (L.native-layout, ruling U36)

Core's village-layout rules (`src/editor/layout/`: building fit, settle, the
ground plan and its paint, the backdrop; and `composition/`: the lane network,
transitions, prop grouping, yards, lanterns, foliage, house variety, seating,
reach, the composed village) are one row each, `layout.<op>`, for every op core's
two corpus runners declare (`LAYOUT_OPS`, `COMPOSITION_OPS`). A row is core's
own JSON boundary and nothing else: `runLayoutOp(op, args)` or
`runCompositionOp(op, args)` (core's `DEFAULT_COMPOSITION_RULES`, with the
input's `ruleOverrides` applied by core). So **the args are a corpus case's
`input` and the answer is in its `expected` shape**, `-0` already written as
`0`. A caller resolves a case's `{"$fixture": …}` references before sending;
the rows never see a fixture.

The evidence is core's own corpus, not a transcription: `vendor/core/conformance/
layout/` and `layout-composition/` are core's files at the pin, copied byte for
byte by `tools/vendor-core-bundle.mjs` and hashed in `VENDORED.json`
(`core_vendor`; `--check --core` byte-compares them with core). The
`layout_corpus` ctest (`tests/layout_corpus.cpp`) runs every case through
`insimulcore.h` and compares by the corpus's rule (the case's tolerance or the
file's, `angleKeys` round the circle, exact keys). It also fails when a row is
named by no case, when core declares an op that is not a row (`layout.ops`), and
when its comparator cannot fail; `layout_corpus_negative` runs it over a
deliberately wrong one-case file (`tests/layout-negative/`) and must fail. The
two case harnesses therefore do not require a case per `layout.*` row.

**What Unreal's binding will call (L.portable-binding, a later row on the 36 GB
Mac).** Unreal's `Portable/` layout code (`InsimulVillageLayout`,
`InsimulBuildingFit`, …; ~3,700 lines held by the same corpus under U36) shrinks
to a binding that builds each op's corpus-shaped input from its scene and calls
`insimul_core_call(core, "layout.<op>", input)`. Its `layout_corpus_ops.h` table
maps one-to-one onto these rows (the op names are the corpus's), so its host
suite's `layout_conformance` can run the same files through this library
instead of `Portable/`. The calls a placement pass makes, in order: `layout.fitBuildingToLot`
per building (or `layout.composeVillage` for the composed village), then
`layout.settleFittedBuildings` / `layout.settleBodies` / `layout.settleClearance`,
`layout.buildGroundPlan`, `layout.gradeTerrain`, `layout.followSettledBuildings`,
the paint (`layout.readGroundLayers`, `layout.resolveGroundPaint`,
`layout.groundLayerWeights`), the prop passes (`layout.keepPlantPropsOffPaving`,
`layout.trimGeneratedPoints`, `layout.lanternsAtPathMouths`, …) and the backdrop
(`layout.backdropRing`, `layout.backdropFrame`). The binding owns only the scene
reads and writes; every number it places comes back from a row.

**Cost.** Under QuickJS the whole corpus (427 cases) takes about 11 s on this
repo's 2026-10-29 build host, nearly all of it `ground-plan.json` (≈ 9.4 s) and
`settle.json` (≈ 1.1 s), every other file under 0.2 s; `gradeTerrain` at core's cap (2,049² heights) is the largest call, and it
is what sized the JS heap cap (`INSIMULCORE_JS_MEMORY_LIMIT`, 192 MiB,
`src/insimulcore.c`). A game calls these at authoring or load time, never per
frame.

### The packs.compose row (SP.composer-native, rulings U62(1) and U79(4))

Core's composer (`src/system-packs/composer.ts`, SP.composer) is one row,
`packs.compose`: `resolveComposition(request, catalog)`, nothing else. The args
are a `conformance/packs/composition.json` case's `input` (`recipe`, `world`,
`game`, `engine`) with `catalog` beside it — `{ index, manifests }`, core's
`packs/index.json` and each `packs/<id>/pack.json` as JSON, the files that
corpus's own `catalog` names. Every key but `catalog` is the request and goes to
core unchanged; the row checks only the catalog's JSON shape. The answer is
core's `Composition`: the packs (with their source, variant, style, parameters
and whether they run), the genre settings and activation the game runs with, the
overrides the composer wrote, and every choice it refused (`refusals`, with
core's code). A recipe, preset, request or engine core cannot compose is an
error: `CompositionError: [<code>]` (`invalid-request`, `invalid-preset`,
`preset-drift`, `unknown-engine`) or `GenreResolutionError: [<code>]`.

The library carries no catalog of its own: an engine sends the one it vendored
from core at this library's pin (Unreal's re-vendor of `packs/` and
`conformance/packs/` is SP.composer-unreal part 2). The evidence is core's corpus,
not a transcription: `vendor/core/conformance/packs/composition.json` and the
catalog files it names, at their core paths under `vendor/core/`, copied byte for
byte by `tools/vendor-core-bundle.mjs` and hashed in `VENDORED.json`
(`core_vendor`; `--check --core` byte-compares them with core). The `packs_corpus`
ctest (`tests/packs_corpus.cpp`) sends every case through `insimulcore.h` and
holds it to core's replay rule (the exact answer, or core's code in last_error);
`packs_corpus_negative` must see it fail a wrong answer and a wrong code. The
hand cases in `tests/cases/bridge-packs.json` pin the row's own contract (the
catalog checks, the pass-through, a refusal as a value, the error codes).

**Cost.** The composer imports `system-packs/schema`, which builds core's zod
schemas at module scope, so the bundle now carries `zod` (3.25.76, MIT;
`npmModules` in `VENDORED.json`, a NOTICE stanza): at the b38e60d pin the bundle
grew from 819,818 to 988,816 bytes, of which zod is 129,138 and the composer and
schema 37,715. The 34 corpus cases take about 35 ms under QuickJS.

`save.decode` / `save.migrate` return core's `migrateSaveFileWithOutcome` outcome
exactly as core answers it. At the pin core declares `orphanExtensionKeys` and
`droppedFacts` but leaves both empty ("populated by … sibling stories"; when a
migration step runs, core's `migrateExtensions` only logs an orphan key, which
`core.diagnostics` shows), so
the rows report them empty and an unregistered key does not by itself make an
outcome `significant`. Filling them is core work with a core corpus case; the
bridge picks it up by re-pinning, and no binding (Babylon's included) fills them
itself.

**A re-save keeps the villagers' blackboards (PL.native-slot9-digest, U115).** `save.decode`,
`save.migrate` and `save.encode` carry `currentState.extensions.aiBlackboards` byte for byte: core
registers the key with no migrator, so `migrateExtensions` hands every board back as it was, and an
envelope decoded and re-encoded has the integrity it was loaded with. Two hand cases in
`tests/cases/bridge-saves.json` pin it over four villagers whose slots hold `state` walking or idle and
`runtimeState` walking or active: the round trip through the envelope, its text and `save.migrate`, a
tampered villager `state` (`integrity_mismatch`) and the walking/idle-swapped save's different digest; and
an older build's save with 19 extension keys, which decodes with `puzzle`, `platformer` and `strategy`
added as `null` and its boards unchanged, so its first re-save moves the ENVELOPE integrity (to the
22-key save's) and never the village state. Every expected digest is core's `computeSaveFileIntegrity`
run in Node outside the bridge. Core's village mapping (`save-file-game-state.ts`, which the
`save.village.*` rows run since PL.native-village-save-rows) copies `state` and `runtimeState` verbatim
both ways as well. So a village digest that moves
when a binding re-saves a slot it has just loaded is the binding re-deriving villager state on capture,
not the codec, and it is the binding's to fix (U49(3)).

### The P9a rows: the genre HUD, the rules panel, the mechanic runtime (P9a.native, U84)

Three of core's P9a corpus runners are rows, each core's own JSON boundary and
nothing else, as the layout rows are:

- **`ui.genreHud { op, ...input }`** is `runGenreHudOp(op, input)`: `config {
  genre }` (the registry entry's HUD config), `view { config, state? }` (core's
  `genreHudView`: which base HUD parts show and the genre's own elements, text
  and tone formatted by core) and `genre_view { genre, state? }`; and, for a
  game's OWN settings rather than a registry id (PL.native-genre-hud-config,
  U92(2)), `config_of { genreConfig }` (a world's `meta.genreConfig` as stated,
  any genre id, projected by core's `genreHudConfigOf`: the fighting HUD for the
  fighting camera or combat style, else `uiLayout`; an absent flag stays absent)
  or `config_of { recipe, world? }` (core's `resolveGameGenre`, then the
  projection of its `config`), and `view_of { …the same, state? }`, that
  projection composed with `view`. Refusal values: `no_genre_source`,
  `two_genre_sources`, `not_a_genre_config`, `world_without_recipe`,
  `unresolved_recipe` (with `reason`, core's `GenreResolutionError` code) and
  `unknown_layout` at `genreConfig.uiLayout` or `world.meta.genreConfig.uiLayout`.
  The row adds nothing: it checks `op` against core's `GENRE_HUD_OPS`.
- **`ui.rulesPanel { op, ...input }`** is `runRulesPanelOp(op, input)`: `panel {
  worldRules?, baseRules? }`, `card { rule }`, `byCategory { rules, category }`,
  `byType { rules, ruleType }`, `isActive { rules, ruleId }`.
- **`mechanics.run { ir, seed, steps }`** is `runMechanicRuntimeCase`: the IR's
  activation assembles core's `createMechanicRuntime` (`ir.routines` handed to the
  routine and locomotion directors), the steps run in order on its seven layers
  with no Prolog engine (`stamina.register`; `combat.register`, `combat.attack`;
  `traversal.links`, `traversal.register`, `traversal.traverse`;
  `locomotion.pursue`; `detection.observer`, `detection.target`,
  `detection.observe`; `routine.assign`, `routine.tick`; `skills.load`,
  `skills.register`, `skills.award`, `skills.advance`: core's `MECHANIC_STEP_OPS`,
  imported, so the list is core's and not a copy), and the answer is the
  plan, one result per step (`{ absent: true }` on a layer the world did not
  activate) and every event type the one bus carried.

So **the args are a corpus case's `op` and `input` (or its `input`) and the answer
is its `expected`**, key sets included. A domain refusal core's runner answers is
a VALUE, as the corpus pins it (`{ ok: false, refusal: { code: "unknown_genre",
field } }`); what the row itself refuses is an ERROR with a code (see "Errors"):
`[unknown-op]` for an op core's runner does not declare (`GENRE_HUD_OPS`,
`RULES_PANEL_OPS`, `MECHANIC_STEP_OPS`), `[invalid-input]`
for an input of the wrong JSON type (the rules-panel fields core's `PanelRule`
types; the mechanic IR's `meta.genreConfig.id`, the seed and the steps). Core's
runners would otherwise answer a misspelt rules field as an empty panel, and a
mechanic step op they do not know as `{ absent: false }` with no outcome. The
rows refuse only inputs core's types declare and its runners would answer
silently wrong, never one core types loosely and answers on purpose: the IR's
`meta.enabledModules` is `unknown` in core's `MechanicRuntimeInput`, and
core's `conformance/modules/world-activation.json` ("rpg with a string") pins
that a list that is not an array selects nothing and the genre decides, so
`mechanics.run` passes it to core unchecked and answers that IR exactly as
`modules.activate { ir }` does — including core's "no mechanic modules" form,
`meta.enabledModules: ['none']` (`NO_MECHANIC_MODULES`, core 798d333), which
assembles nothing whatever the genre (`mechanic-runtime.json`, "survival with
'none': nothing assembled"; `world-activation.json`, "rpg with 'none'" and seven
more), while an empty list still means the genre decides.

**Why `mechanics.run` is stateless and not a `mechanics.create`/`.apply` session.**
The session rows above hold a core model whose methods answer JSON-ready values.
The mechanic runtime's per-step answer (`outcome`, `stamina`) is a projection core
keeps private to its corpus runner; the one thing core exports is the whole
replay, `{ ir, seed, steps }` → `{ plan, steps, events }`. A session would have to
restate that projection here, and the rows decide nothing. It is named and shaped
like `weather.run`, the other seeded corpus replay. A live game session also needs
the layers' hosts (trajectory probe, perception, locomotion, skill modifiers),
which are engine callbacks that cannot cross this ABI: those are the per-system
rows of P9b–P9j. When core exports a per-step function, a session pair can wrap
it without restating anything.

The evidence is core's corpora, not a transcription:
`vendor/core/conformance/ui/genre-hud-cases.json` (106 cases at 7376894: config
16, view 31, genre_view 16, config_of 28, view_of 15),
`ui/rules-panel-cases.json` (17) and `modules/mechanic-runtime.json` (8 cases at
fc88be9, 25 steps each), copied byte for byte by `tools/vendor-core-bundle.mjs` and hashed
in `VENDORED.json` (`core_vendor`; `--check --core` byte-compares them with core).
`tests/p9a_corpus.cpp` sends every case through `insimulcore.h` and compares
exactly; it is three ctests, `genre_hud_corpus`, `rules_panel_corpus` and
`mechanic_runtime_corpus`, so removing one row turns its own test red, and it
also fails when a UI corpus declares an op (`ops`) no case exercises or when a
case is not driven through the row (each file's line prints `driven N (<op>
<count>, …), 0 undriven`). `p9a_corpus_negative` must see it fail one wrong answer
per row (`tests/p9a-negative/`), plus, for the genre HUD, a wrong `config_of`
projection (the fighting rule dropped) and a case it cannot drive, counted
undriven. The hand cases in `tests/cases/bridge-p9a.json` pin the
rows' own contract (the coded errors, a refusal as a value).

**Cost.** The three rows bring core's HUD and rules-panel models and the whole
mechanic assembly (the seven layers' directors, combat resolution, perception,
traversal, routines, skills, and the Prolog helper text those modules import):
47 core modules. At the f9aef13 pin the bundle grew from 1,005,516 bytes (the pin
bump alone, from 988,816 at b38e60d) to 1,392,156. The 86 cases take about 60 ms
under QuickJS. `config_of` / `view_of` (PL.native-genre-hud-config) add no core
module (152 before and after; `game-genres/resolution` was already in): the bundle
went from 1,553,471 bytes at eff846a to 1,563,073 with the 7376894 pin bump alone
(+9,602, core's runner and its cases) and 1,563,744 with this row's comment
(+10,273 in all, +0.66 %). The 106 genre HUD cases take about 3 ms.

### The saves.slots session: save slots, Continue, autosave, quick save (PL.native-catchup)

Core's `SaveSlotsSession` (`src/save-slots.ts`, P1.core-slots, ruling U83(1)) is
the engine-neutral logic around the one save format: which slot a request goes
to and what is refused, the slot rows and the Continue target, deleting a slot,
autosave at an interval with its "Saving…"/"Saved!" indicator, and quick save /
quick load on F5 / F9. It does no I/O, so it is a session pair like the clock:

- **`saves.slots.create { config?, slots?, activeSlot? }`** → `{ session, config,
  view }`. `config` is the saves pack's parameters (`slotCount`, or the pack's
  `maxSlots`; `quickSlot`, null for none; `autosaveIntervalSec`, 0 for off;
  `autosaveIndicator`), passed to core UNCHECKED: core reads a field of the wrong
  type as its default on purpose, and its corpus pins each reading. The answer's
  `config` is how core resolved them. `slots` is what the host's save codec found
  (`{ index, outcome, summary? }`; `ui.saveSlots` classifies an envelope into
  one). `activeSlot` is the autosave target at the start.
- **`saves.slots.apply { session, ops }`** → `{ results, view }`. The ops are
  core's steps: `save { slot }`, `load { slot }`, `continue`, `delete { slot }`,
  `ask_delete { slot }` (the slot list's Delete, which asks first: it opens the
  view's `confirm` prompt), `confirm_delete` and `cancel_delete` (the prompt's
  two actions; core's PL.slots-delete-states), `key { code }` (a
  KeyboardEvent.code: `F5`, `F9`; any other is `unbound_key`), `tick { delta }`
  (seconds; null is a non-finite tick, as the corpus writes it), `finished {
  ok, savedAt?, summary?, outcome?, refusal? }` and `disk_changed { slots }` (the save
  files changed outside the game: `slots` is the host's new listing, as at
  create, null for none; core's PL.disk-changed-step, in from the 72c658c pin).
  Each result is core's `{ ok, refusal?, outcome?, effect, history?, disk? }`:
  a refusal (`busy`, `no_such_slot`, `slot_empty`,
  `slot_corrupted`, `no_quick_slot`, `nothing_to_continue`, `nothing_pending`,
  `unbound_key`, `confirm_open`, `nothing_to_confirm`, `quick_slot_reserved`) is
  a VALUE, `effect` is the I/O the host does now — `{ write: { slot, kind,
  autosave } }` (then raise core's `game_saved`), `{ read: { slot, kind } }` or
  `{ remove: { slot } }` — answered with `finished`, and `history` is the line a
  finished delete leaves in the game's log ("Deleted Slot N"), and `disk` (only
  on a `disk_changed` that was not refused) is `{ changed, deleted, added,
  droppedActive }`: when the active slot changed or went outside the game core
  clears it, so autosave never writes over the outside change, and the indicator
  says so (`slot_changed_outside`, `slot_deleted_outside`, or the `quick_` ones).
  The view is core's
  `SaveSlotsView`: `rows` (core's `SlotView` plus `canDelete`, `isContinue`,
  `isActive`, `isQuick`), `continueSlot`, `activeSlot`, `pending`, `confirm` (the
  delete prompt, or null), `autosave { on, target, inSec }` and `indicator`
  (state, label, detail, kind, opacity). Since core's PL.quick-slot (in from the
  ac229a7 pin) an unset `quickSlot` is a DEDICATED quick slot after the manual
  ones (index `slotCount`), so the table holds `slotCount + 1` rows; null names
  none. Since core's PL.quick-slot-one-based (in from the eff846a pin) a stated
  `quickSlot` is the 1-BASED slot number the player reads (`quickSlot: 1` is
  "Slot 1", index 0 — the old default), which core maps to the session's 0-based
  index in the resolved `config`; 0 and any number past the manual slots are
  refused `quick_slot_out_of_range` (F5 and F9 then answer that refusal and write
  nothing). A binding that stated a 0-based index must add one.
- **A refused Load** (core's PL.core-load-refused-message and PL.core-load-refusal-codes,
  U118(5), U124(1), U126(2); in from the 45409ed pin, bound by PL.native-bundle-core-r2).
  A read the host refused is answered `finished { ok: false, refusal: <code> }`: with no
  `outcome`, core makes the slot `invalid_format` and the indicator's detail
  `SLOT_MESSAGES.invalid_format`, the one message every engine shows. Every string is
  mapped that way — the codes core states (`wrong_world`, another world's save;
  `wrong_runtime`, another runtime's; the checked read's `wrong_version`,
  `unregistered_extension`, every `unreadable_*`) and every other string (`not_this_game`,
  '', a bare `unreadable_`); a stated `outcome` wins; a value that is not a string names no
  refusal and the slot stays as it was. **`ui.loadRefusal { refusal }`** → `{ outcome,
  message }` is the same mapping outside a session (`slotOutcomeOfLoadRefusal`,
  `loadRefusalMessage`); render it with `ui.saveSlots`. Core's 20 `load_refusals`
  (`conformance/ui/save-slot-cases.json`) are transcribed into
  `vendor/core/cases/core-ui-save-slots.json`, each the mapping then the slot it renders,
  and `conformance/saves/slots.json`'s 9 `finished { refusal }` runs go through
  `saves.slots.apply` in `saves_slots_corpus`.

What the rows refuse as errors is only what core's types declare and JSON cannot
hold: a `config` that is not an object, a slot (at create or in a `disk_changed`
listing) that is not `{ index: number, outcome }` with an outcome core's
`SaveSlotModel` knows, a listing that is not an array, an `activeSlot`, `slot`
or `delta` that is not a number, a `code` that is not a string, and a `finished`
without a boolean `ok`. A slot index that is not a slot (`1.5`, `7`) goes to core,
which answers `no_such_slot` on purpose.

The evidence is core's corpus `conformance/saves/slots.json` (147 cases at
72c658c; 130 at eff846a; 126 at ac229a7; 94 at fc88be9), copied byte for byte by `tools/vendor-core-bundle.mjs`
and hashed in `VENDORED.json`. `tests/saves_slots_corpus.cpp` (ctest
`saves_slots_corpus`) drives it through the two rows from C: every `run` case as
one create and one apply per step (so the view after every step is the session's
own), every `config` case through create's `config`, every `continue` case
through the view of a session with no quick slot (core's `continueSlot(slots,
slotCount)` reads exactly `slotCount` slots), every `rows` case through create's
view (a `busy` rows case with one pending save first) — 132 cases at 72c658c
(config 28, continue 13, rows 10, run 81; 115 at eff846a). The 15
`indicator` cases show any state, kind and detail on a bare indicator, which no
session step does; the runner prints a measured reason for each (how many of its
views the session itself showed in the run cases, and which it never reached).
`saves_slots_corpus_negative` must see it fail one wrong config and one wrong run
(`tests/saves-negative/`). The hand cases in `tests/cases/bridge-saves-slots.json`
pin the rows' own contract (results in a batch, the effects, the errors).

**Cost.** The rows bring three core modules, `save-slots`, `ui/save-indicator-model`
and `game-engine/logic/KeyboardMap` (the slot model was already in; 138 → 141): at the fc88be9 pin the bundle went from 1,402,117
bytes (the pin bump alone, from 1,392,156 at f9aef13) to 1,422,744. The 83 driven
cases take about 20 ms under QuickJS.

### The props and inventory rows: containers, documents, doors, the notice board, the inventory panel (PL.native-props-rows)

Core's P6 logic (P6.core, 31764b1 onward; ruling U89(2)) is the engine-neutral
half of the props a player uses: `src/props/containers.ts` (whether a chest can
be opened, unlocked, put into, where it is, when it respawns),
`src/props/documents.ts` (one readable document from a TextIR, a NoticeArticle, a
book or a sign; its pages; the reader panel's `DocumentReader`),
`src/props/doors.ts` (a building's door, its prompt, and the handoff "enter
interior X" / "exit to Y"), `src/props/notice-board.ts` (`NoticeBoard`: which
notices a board shows, unread, read / answer / take a quest),
`game-engine/logic/NoticeGenerator.ts` (`generateSettlementNotices`, one notice
per NPC) and `src/ui/inventory-model.ts` (`InventoryViewModel`, the inventory
panel, moved into core from Babylon). The rows call those and decide nothing:

- **Stateless:** `props.containers.{view, unlock, move, at, respawn}`,
  `props.documents.{document, paginate}`, `props.doors.{door, prompt, step}` and
  `props.notices.generate` — one core function each, answering in the shape the
  corpus pins (the host keeps the state: a container record `unlock` returns, the
  door's `inside`).
- **Sessions** (`js/host-sessions.js`): `props.reader.create/apply` (a refused
  document answers `documentOf`'s refusal value and opens no session),
  `props.board.create/apply`, and `inventory.create/apply`. The reader's and the
  board's `apply` send EVERY op to core's `step`, because core answers an action
  it does not know as its refusal value `unknown_action` (`applySteps`); the
  inventory's ops are core's corpus steps (`add`, `remove`, `filter`, `toggle`,
  `set_gold`, `add_gold`, `remove_gold`, `equip_flag`) plus `get`, `items`,
  `load` and `clear` a game needs, refused by name otherwise (`applyOps`).
- **`props.contract`** answers the data tables of each P6 corpus file's
  `contract` (the states, refusals and actions, the default capacity, page size
  and quiz XP, the door's prompt radius and stand-off, the inventory's filters,
  colours, slot labels and empty messages) from core's own constants, keyed by
  area: a binding reads its words and numbers there, not from a copy.

The inventory's `view` is `{ filter, counts: { total, shown }, gold, rows,
equipment: { weapon, armor, accessory }, save: { gold, inventory } }` — exactly
the state core's inventory corpus records after every step: `rows()` with each
item row's live `item` left out (`get` returns the stored item), the equipped
item's id per slot, and `toSaveState()`. **`ui.trade` is not this row and is
unchanged**: C0's `ui.trade` is core's `TradeModel` (moving stock between the
pack, a container and a merchant over the same `currentState` slice); there was
no inventory-panel row to extend, so `inventory.*` is new beside it, and a host
runs a trade through `ui.trade` and re-loads the panel (`inventory.apply` `load`)
from the slice it returns.

What the rows refuse as errors (`[invalid-input]`) is only a field of the wrong
JSON type that core's types declare: a container, building, move, action,
player or option that is not an object, a list (`containers`, `buildings`,
`notices`, `npcs`, `read`, `answered`, the held item ids) that is not an array,
a `text`, `inside`, id or settlement name that is not a string, a `charsPerPage`
or `fluency` that is not a number, `now` that is neither a string nor a number,
and a reader flag or `equipped` that is not a boolean. Every value core reads
itself (a document of any shape, a stack's `quantity`, a `gold` of `null`) goes
to core, which answers it as its corpus pins.

The evidence is core's five P6 corpora, copied byte for byte by
`tools/vendor-core-bundle.mjs` (`PROPS_CORPUS_FILES`) and hashed in
`VENDORED.json`: `conformance/props/containers.json` (31 cases),
`documents.json` (32), `doors.json` (29), `notice-board.json` (17) and
`conformance/ui/inventory-cases.json` (19). `tests/props_corpus.cpp` drives
EVERY case of every file through the rows from C, one ctest per file
(`props_containers_corpus`, `props_documents_corpus`, `props_doors_corpus`,
`props_notice_board_corpus`, `inventory_corpus`): the stateless ops send the
case's `input` as the row's args; `read`, `board` and `inventory` open the
session and apply ONE op per step; a door `session` is the host's side of a door
as core's runner keeps it (`prompt` and `step` with the player's `inside`); and
`generate` projects the row's full articles to the fields the corpus records.
Each file's data tables are held to `props.contract`. 129 cases at 431c95b (core's
PL.core-props-docs added a turned-tavern door `session` case; 128 at ac229a7), none undriven.
`props_corpus_negative` must see one wrong case per file reported
(`tests/props-negative/`). The hand cases in `tests/cases/bridge-props.json` pin
the rows' own contract (refusal values, an unknown action as core's, a refused
document opening no session, the session kinds, the errors).

**Cost.** The rows bring eight core modules (the four `props/` modules,
`ui/inventory-model` and the `EquipmentManager` it reads its slots from, and
`game-engine/logic/NoticeGenerator` with its `GameTextTypes`; 141 → 149): at the
ac229a7 pin the bundle went from 1,435,892 bytes (the pin bump and the
saves.slots catch-up alone, from 1,422,744 at fc88be9) to 1,511,366. The 128 cases take about 30 ms under
QuickJS.

### The pick-up settle rows: where a pick-up is put down (PL.native-pickup-settle)

Core's pick-up placement (PL.pickup-placement, ac229a7 onward; ruling U89(3), in
U78's shape) is the rule Unreal's P6 cell wrote as an interim settle
(`InsimulVillageProps.cpp`, unreal `feat/p6-unreal` 29c37ab, VP:513–790): a
world's quest-object position is a point on the map, not a free one, so before a
pick-up is drawn its authored spot is settled clear of what stands round it
(props, buildings, plants by their trunk, containers), of the villagers' paths
(roads, doors, where a villager stands) and of the pick-ups settled before it, or
refused with a code. `src/props/pickup-placement.ts` states it as data in,
decision out, in core's metres on its ground plane `(x, z)` with heights `y`; the
rows (ruling U91(2)) call it and decide nothing:

- **`props.pickups.settle`** — one pick-up (`settlePickup`): the settled spot,
  whether it `moved`, the `ring` it was found on (0: the authored spot), its
  clearance and what it is `nearest`, how clear the `authored` spot was, and the
  `approach` (the side it is walked up to from); or `no-clear-spot` with the
  `clearest` spot (where an engine that still draws it draws it, as Unreal does),
  or `bad-spot` for a spot or ground height that is not a finite number. Both
  refusals are VALUES.
- **`props.pickups.sequence`** — several, in settle order (`settlePickups`), each
  kept clear of those settled before it (a refused one where its `clearest` is).
- **`props.pickups.clearance`** — how clear a spot is (`pickupClearance`;
  `clearanceM >= 0` is clear, `ok` first: a `bad-spot` has no clearance).
- **`props.pickups.pattern`** / **`props.pickups.ring`** — the search the settle
  walks (`pickupSearchPattern`, `pickupSearchRing`: rings 0.5 m apart out to 20 m,
  from +x toward +z).
- **`props.contract`'s `props-pickup-placement`** — the corpus's data tables from
  core's constants: the kinds, `clearanceM`, `search`, `refusals`, `frames` (how
  each engine maps its frame onto core's), every constant's value (`constants`;
  the Unreal line each was measured from is prose and stays in the corpus), the
  engine-side ground and plant kinds, and the `deviations` from Unreal.

**Frames, and what a binding sends.** Everything crosses in core's frame; the rows
convert nothing. Unreal sends its `(X, Y)` ÷ 100 as `(x, z)` and its `Z` ÷ 100 as
`y`, and a turned footprint's forward as `axis` UNMIRRORED (`half.x` is along it,
`half.z` across): core's ring and heading angles turn from +x toward +z, which is
+X toward +Y in Unreal (`frames.unreal`). Walkable ground is `walkable` areas (a
circle or a box each; absent is everywhere, empty is nowhere): core's
`isWalkable` callback (an engine's navmesh query) has no row, because a callback
cannot cross the C ABI — a binding states its navmesh as areas, or settles with
`walkable` absent and keeps its own navmesh test on the answer
(`ENGINE_BINDINGS.md`, "Pick-up settle").

**Errors** (`[invalid-input]`) are only a field of the wrong JSON type core's types
declare: `obstacles`, `roads`, `settled`, `walkable` or `pickups` that is not an
array, a road object's `waypoints` that is not an array, `clearance` or `search`
that is not an object, and a `ring` that is not a number. Every value core reads
itself goes to core, which answers it as its corpus pins: a null or non-point
list entry (skipped, keeping its index), an obstacle of a kind core does not know
(not kept off), a clearance or search field that is not a usable number (its
default), a spot that is not a point (`bad-spot`).

**The evidence** is core's `conformance/props/pickup-placement.json` (72 cases at
72c658c, the six added by core's PL.pickup-ring-search-case a `ring` that states a
`search`; 66 at eff846a; over
`pattern`, `ring`, `clearance`, `settle`, `sequence`), copied byte for byte with
the other P6 corpora (`PROPS_CORPUS_FILES`) and driven by the same runner,
`tests/props_corpus.cpp`, as the ctest `props_pickup_placement_corpus`: every
case's `input` is the row's args as is, every answer compared whole within the
file's `tolerance` (1e-6), none undriven. The runner also requires the file's
top-level `numerics` to name double precision (the rows run in QuickJS, whose
numbers are IEEE-754 doubles; several cases decide exactly on a boundary) and
holds the contract's data tables, `frames` and the constants' values among them,
to `props.contract`. `props_pickup_placement_corpus_negative`
(`tests/props-negative/pickup-placement-wrong.json`) must see a float32
`numerics`, a wrong frame, a wrong constant, an op with no case, a clearance's
wrong `ok`, a settle whose building axis was mirrored, a placement off by 0.01 m
and a refusal where core settles each reported. The hand cases in
`tests/cases/bridge-props.json` pin the rows' answer shapes, the refusal values
and the errors.

**Cost.** One core module (`props/pickup-placement`; 151 → 152 at the eff846a
pin): the bundle went from 1,530,726 bytes (the eff846a pin bump alone, from
1,511,366 at ac229a7) to 1,553,471. The 66 cases take about 20 ms under QuickJS.

### The interact rows: what E does by a prop (PL.native-interact-target)

Core's interact rule (PL.examine-props, core 2158b08; ruling U49(3), on the
Unreal P8 critic's m1 and its collision with P6's E actions) is the rule Unreal's
P8 cell wrote as an interim copy (`IsSign`, `IsOfferedProp`, `PropNoun`,
`PropToInteract`, `PropPrompt`, `InteractWithProp` and the board-sign search,
`InsimulPlayerTitle.cpp` and `InsimulVillageProps.cpp`): which ONE thing a press
of E acts on where the player stands, what each stated prop (`entities.props`,
pipelines' settlement dressing) means, and what reading and examining say.
`src/props/interactables.ts` states it as data in, decision out, in core's
metres on its ground plane `(x, z)`; the rows (ruling U94(3)) call it and decide
nothing:

- **`props.interactables.target`** — the ONE thing E acts on (`interactTarget`):
  an open props `panel` closes; else the nearest ACTION within its reach — `talk`
  (the `villager` the host would talk to, 3.5 m), `pick_up` (a pick-up not
  `taken`, 2.2 m), `open_container` (2.2 m), `open_board` (the board's host prop,
  3.2 m), `enter` (a door that prompts by `doorPrompt` over `buildings`, at its
  own distance) — ties going talk, pick-up, container, board, door, then the first
  listed; only with no action in range, the nearest LOOK, `read_sign` or `examine`
  (2.6 m, the first listed on a tie). It answers the target's `action`, `kind`,
  `id`, `prompt` ("Talk to Ada", "Pick up Apple", "Read the Elmford notice
  board", "Examine the barrel"; the key glyph is the host's) and `distance`, or
  null with nothing in reach; `ranges` overrides any reach for the call. A
  position that is not a finite point is the refusal VALUE `bad_position`.
- **`props.interactables.interact`** — what pressing E on a stated prop says and
  raises (`interactWithProp`): "The sign reads: X" or "The sign is blank." with
  one `sign_read`; "You examine the <noun>." or "You examine the <noun>: <text>."
  (no second full stop after a text that ends in one) with one `object_examined`;
  `open_board` with no line and no event (the board's model, `props.board.*`,
  takes over); a prop with no meaning is the refusal VALUE `not_offered`. The host
  raises the events on its bus (the tutorial's lessons complete on them).
- **`props.interactables.meaning`** — a prop's one meaning and prompt
  (`propInteraction`): `open_board` for the board's host prop (never also read as
  a sign), `read_sign` for `prop.structural.sign` by whole dotted segments,
  `examine` for every other stated prop (a `prop.container.*` prop too: only a
  `ContainerIR` opens), or none for the built fabric (`prop.structural.wall`,
  `prop.structural.fence`) and a prop with no archetype.
- **`props.interactables.host`** — the prop a settlement's notice board is posted
  on (`noticeBoardHost`): of the offered signs that state no other settlement, the
  nearest to the settlement's `position`, the first listed on a tie; null is no
  board. The `board` the other rows take is `{ host, name }`, `name` the
  settlement's: a binding works it out once per settlement.
- **`props.interactables.noun`** — what a prop is called (`propNoun`:
  `prop.furniture.stall.produce` is "produce stall"; fewer than three segments is
  "object").
- **`props.contract`'s `props-interactables`** — the corpus's data tables from
  core's constants: `propActions`, `actions`, `actionTier`, `lookTier`,
  `vehicleTier`, `notOffered`, `notOfferedReasons`, `signArchetypes`, `rangesM`,
  `doorPromptRadiusM`, `refusals`, `interiorActions` and `floorBandM` (inside an
  interior), the `deviations` from Unreal's interim rules (nineteen at the 45409ed
  pin, each with Unreal's reading, core's and why), and the press's `pressSources`,
  `pressPrecedence` and `examineRangeM`. The prose keys are rules written out and
  stay in the corpus.
- **One E press, one object** (core's PL.core-interact-pick-precedence, U118(4); in at
  the 45409ed pin, bound by PL.native-bundle-core-r2). The language world's examine
  pick can name an object the target does not. **`props.interactables.examinePick`
  `{ objects?, at }`** → `{ pick }` is core's `examinePick`: of `objects` (core's
  `WorldObjectIn`) with a non-empty `role`, the nearest to `at` on the ground plane
  within 5 m (`<=`, squared; the first listed on a tie), as it was sent, or null.
  **`props.interactables.press { target?, pick? }`** → `{ source, id, target, pick,
  shadowed }` is core's `resolveInteractPress`: the target wins whenever there is one
  (`source` `interactables`; `pick` the same object when it names the target's id,
  else null with the pick `shadowed`), else the pick acts (`source` `examine`),
  else every field is null. A press is target, then (when not refused) the pick,
  then this row, as core's corpus runner composes it.
- **Inside an interior** (core's PL.core-interior-interact-target, in at the 45409ed
  pin). The target row also takes `interior` (`currentState.interiorState`'s record
  plus that interior's reachable `containers`): inside, only an open panel, those
  containers and the interior's `exit` are candidates, each only from its own floor.
  **`props.interactables.contract {}`** → `{ standWithoutY: { y: "not_added", floor:
  "every" } }` states, as data, how these rows read a stand that states no `y`
  (U126): they add none and default none to 0, and core reads it on every
  candidate's floor. A binding that has no `y` sends none.
- **The vehicles and gathering packs' inputs** (core's PL.core-vehicle-rules and
  PL.core-gather-reach-tier, in at the d88b6f0 pin; bound by PL.native-bundle-core).
  A game that runs the vehicles pack also sends `aboard { id, name? }` (E gets off
  it, `get_off`, second only to an open panel) and `vehicles [{ id, name?,
  position }]` (`board` the nearest within `rangesM.board`, only when nothing else
  is in range); one that runs the gathering pack sends `nodes`, `hotspots`,
  `actionTable` (absent: core's default physical actions), `busy` and `now`
  (`gather` 2.0 m and `perform` 2.5 m, both in the actions tier after `enter`;
  `busy` offers neither). The row passes them to core as sent, like the rest.

What stays the host's: the villager it would talk to (sight and facing), which
containers are reachable, the panel that is open, the E press inside an interior
or during a conversation (core's `notHere`; PL.examine-props m3), and a language
world's translated objects (`examineNearest`, m4).

**Errors** (`[invalid-input]`) are only a field of the wrong JSON type core's types
declare: `props`, `pickups`, `containers` or `buildings` that is not an array, a
building that is not an object, `villager`, `board`, `settlement`, `prop` or
`ranges` that is not an object, a range that is not a number, a `panel` or an
`archetype` that is not a string; and of the packs' inputs, `vehicles`, `nodes` or
`hotspots` that is not an array of objects, `aboard` or `actionTable` that is not
an object, `actionTable.actions` that is not an array of objects, `busy` that is
not a boolean; `interior.containers` that is not an array (any other `interior` goes
to core, which reads a non-record as outside); and of the press rows, `objects`
that is not an array of objects each with a `position` object, `at` with no
numeric `x` and `z`, a `target` or `pick` that is not an object. Every value core
reads itself goes to core,
which answers it as its corpus pins: a position that is not a finite point (`at`:
`bad_position`; a candidate's: skipped), a null or id-less list entry, a taken
pick-up (skipped), an archetype or text that is not a non-empty string (no
archetype: not offered; no text: blank).

**The evidence** is core's `conformance/props/interactables.json` (73 cases at
45409ed over `noun` 1, `meanings` 4, `host` 5, `interact` 4, `target` 51, `press` 8,
after core's PL.core-interior-interact-target added 12 `target` cases and
PL.core-interact-pick-precedence the 8 `press` cases, none of an earlier case's answer
changed; the runner counts the stands it sent with no `y` and holds them to
`props.interactables.contract`; 53 at d88b6f0 with `target` 39, after core's
PL.core-vehicle-rules and PL.core-gather-reach-tier added 20 `target` cases, none
of an earlier case's answer changed; 33 at 431c95b with `target` 19, after core's
PL.interactables-cases added four `target` cases whose answer depends on the stated
`ranges` and two `interact` cases with a lone `prop`; 27 at 72c658c; Brightwater's 78
stated props among them), copied byte for byte with the other props corpora
(`PROPS_CORPUS_FILES`) and driven by the same runner, `tests/props_corpus.cpp`, as
the ctest `props_interactables_corpus`, 0 undriven. The rows take ONE prop or one
stand, as core's functions do; the runner walks a case's lists and composes its
board exactly as core's corpus runner does (`runMeanings`, `runTarget`): the board
as the case states it, else `{ host, name }` from `props.interactables.host` and
the settlement; a `meanings` case's `count` per action made from the rows'
meanings; a `target` case's `stands` one call each with the stand's fields over
the case's. Both projections are self-tested on every start.
`props_interactables_corpus_negative`
(`tests/props-negative/interactables-wrong.json`) must see a wrong range, an op
with no case, and five answers an engine keeping one of Unreal's interim rules
would give — the board's host sign also read as a sign, a fence offered, a nearer
barrel examined before a pick-up, a tie kept by the last prop, a second full stop
— and two runner controls no core case can be (a case's own `ranges` reaching a
prop the defaults do not; an `interact` case that states one `prop` alone), each
reported. The hand cases in `tests/cases/bridge-props.json` pin the answer
shapes, the refusal values and the errors.

**Cost.** One core module (`props/interactables`; 158 → 159 at the 72c658c pin):
the bundle went from 1,611,435 bytes (the pin, the repointed P8 imports and the
`disk_changed` op) to 1,628,183 (+16,748). The 27 cases take about 12 ms under
QuickJS.

### The camera movement rows: what the lens hides, the move, slopes and steps (PL.native-camera-movement)

Core's movement contract (PL.movement-contract, core 89dd9ed, and
PL.movement-followups, 431c95b; rulings U94(4), U95(1) and U95(5)) answers the four
questions Unreal's P7 cell left with core's owner (its round-2 m4, m5 and m6):
what a camera mode does about a solid between the player and the lens, what the
world (isometric) frame means for the move input, the run speed, and the slope and
step limits. `src/camera/movement-contract.ts` states them as data in, decision
out (since core's PL.movement-prose-split, the rules are `src/camera/movement-rules.ts`,
which the rows import, and the prose tables no row reads `movement-prose.ts`; the
contract module re-exports both), in core's metres in the IR's world frame (left-handed, +Y up, a yaw from +Z
toward +X); the rows (ruling U95(5)) call it and decide nothing, so Unreal's P7
cell binds them as its P6 cell binds `props.*` instead of keeping an interim copy:

- **`camera.movement.occluders`** — what the mode's lens hides this frame
  (`sightOccluders`): the four overhead rigs (`isometric`, `side_scroll`,
  `top_down`, `fighting`) `hide` every solid the sight line from the pivot (the
  feet plus the mode's `pivotHeightM`) to the lens touches, nearest first, and
  never one named in `exclude` (the player, the conversation partner);
  `third_person` pulls the lens in (`pull-in`, its own sweep) and `first_person`
  has no line (`none`): neither hides anything. The answer carries the `pivot` and
  `lens` it read. A follow mode given no view yaw is the refusal VALUE
  `missing-view-yaw` (never yaw 0; PL.movement-followups).
- **`camera.movement.sideView`** — what blocks the player on a side view's strip
  (`sideViewBlockers`; plane `xy`): every solid whose footprint comes within the
  body's `radiusM` of the player's own depth line, as the stretch `xMin`–`xMax` it
  blocks and its `bottomY`/`topY` (passed over its top only); `not-a-side-view`
  and `invalid-radius` are values.
- **`camera.movement.buildingSolid`** — a `BuildingIR`'s solid (`buildingSolidOf`):
  its stated footprint about its position, turned by its rotation,
  `max(1, floor(floors)) × storeyM` (4 m) tall; null when the footprint, position or
  rotation is not stated (core never guesses a size; a host that knows its drawn
  bounds states its own solids).
- **`camera.movement.move`** — where the move input takes the player (`playerMove`):
  clamped to length 1, turned into the mode's frame (`world` for isometric and
  top-down: forward +Z and right +X whatever the view's yaw, so orbiting never
  changes the mapping; `view` for the others, along the view's yaw), the plane's
  component dropped (a side view keeps only x), scaled by the engine's own walk
  and, `running`, by `gait.runOverWalk` (2). `invalid-move`, `invalid-walk` and
  `missing-view-yaw` are values. An engine whose level mirrors the IR (Unreal's
  `X = x`, `Y = z`) maps the answer through its import; the row converts nothing.
- **`camera.movement.slope`**, **`.slopeAtRest`**, **`.step`** — the ground table
  (`slopeResponse`, `slopeAtRest`, `stepResponse`): moving, a slope at or below
  15° is walked, below 75° walked up slowed (`slide`), at or above 75° `blocked`;
  at rest every slope above 15° slides the player back (`slideBack`), the blocked
  ones too; a rise up to 0.75 m is stepped, a higher one `blocked`, none or a drop
  `none`. Anything unreadable is null.
- **`camera.movement.contract`** — the corpus's data tables from core's constants:
  `modes` (each mode's occlusion rule and opening view yaw: the follow modes open
  on the player's facing, isometric and top-down at 0, the side and fighting views
  at their fixed 180), `storeyM`, `gait` and `ground` (with core's own source
  lines). The prose keys stay in the corpus.

What stays the engine's: its physics moving the body, the boom's sweep, drawing
and hiding meshes, the walk speed, and mapping the IR's frame onto its level.

**Errors** (`[invalid-input]`) are only a field of the wrong JSON type core's types
declare and core does not read itself: a `mode` that is not one of core's
`CAMERA_MODES`, `feet` that is not a point of three finite numbers, a `view` that is
not an object, `solids` or `exclude` that is not an array, an `exclude` entry that
is not a string, a `running` that is not a boolean. Absent `solids`/`exclude` and a
null `view` read as empty, as core's runner passes them. Everything else goes to
core, which answers it as its corpus pins: an unreadable solid (counted in
`unreadable`), a view yaw, radius, move, walk, building, slope or rise that is not
a number.

**The evidence** is core's `conformance/camera/movement.json` (95 cases at the
6cd4b4e pin over `occluders` 28, `sideView` 10, `buildingSolid` 8, `move` 19,
`slope` 11, `slopeAtRest` 11, `step` 8; 87 before core's
PL.core-camera-movement-gaps added a solid's optional `kind`, `building` or `prop`,
a prop never hidden by the lens, and the contract's `solidKinds` table), copied byte for byte as its own set
(`CAMERA_CORPUS_FILES`) and driven by `tests/props_corpus.cpp` as the ctest
`camera_movement_corpus`, 0 undriven. The case's `input` is the row's args as it
stands; every case with more than one solid or exclusion is driven a second time
with `solids` and `exclude` reversed (the file's `order` rule, as core's
`checkMovementCase` checks it; 20 cases at 6cd4b4e), and the data tables are held to
`camera.movement.contract`. `camera_movement_corpus_negative`
(`tests/props-negative/movement-wrong.json`) must see Unreal's 45 cm step in the
contract, an op with no case, and six answers an engine keeping one of its interim
rules would give — the Smithy drawn in the side view, a third-person sight line
read at yaw 0, the isometric right mirrored onto the IR's −X, Unreal's 7.5/4.2 run,
a 50° slope walked and a 0.75 m rise refused — each reported. The hand cases in
`tests/cases/bridge-camera.json` pin the answer shapes, the refusal values and the
errors.

**Cost.** Two core modules (`camera/movement-contract` and the `camera/camera-modes`
table it reads; 160 → 162 at the 431c95b pin): the bundle went from 1,628,178
bytes (the pin alone) to 1,652,390 (+24,212). The 87 cases, with their 13 reversed
runs, take about 5 ms under QuickJS. At the 6667999 pin (PL.native-ground-row) the
rows import `camera/movement-rules` instead, which leaves core's prose tables out:
1,652,390 → 1,649,195 (−3,195) before the ground rows. Importing
`camera/movement-contract` again would bring them back; the vendor tool refuses that
(`UNBUNDLED_CORE_MODULES`).

### The ground reading rows: where the listener is and what is under the foot (PL.native-ground-row)

Core's audio rules take two facts as inputs and never look them up: **where the
listener is** (`settlement`, `wilderness` or `indoor`; the ambient and music rules)
and **what is under the foot** (a surface archetype; `footstepCue`). Reading them is
the host's job, from the World IR it already holds, and core states exactly how
(PL.ground-from-ir, core 91a180d; ruling U94(5)) so that every engine reads them the
same way. The rows (ruling U97(3)) call core's reading and decide nothing, so
Unreal's `P5.unreal.ground-from-ir` cell binds them in place of its interim
`Portable/InsimulAudioPlace` reading:

- **`audio.ground.placeAt { world, at }`** → `{ reading }` (`placeAt`): `settlement`
  inside a `geography.settlements[]` circle (plan distance ≤ `radius`; overlapping
  circles: the nearest centre, then the smaller id), with its `settlementId` and
  `settlementName` (its `name`, else its id); else `wilderness`. `indoor` is never
  read from the IR: the host knows when its listener is inside.
- **`audio.ground.groundSurfaceAt { world, at }`** → `{ reading }`
  (`groundSurfaceAt`): `{ surface, tier, shapeId }` from a road (`entities.roads[]`,
  within half its width of its waypoints; its `archetype`, else
  `terrain.texture.road`; its `id`, else `road.<fromId>.<toId>`), then a closed
  ground surface (inside its polygon, even-odd), then an open one (within half its
  width); a surface with no archetype is read by its kind (plaza → sidewalk, any
  other → path). Within a tier the nearest shape wins, then the smaller id. Where
  none covers the point, the open ground `terrain.texture.ground` (tier `ground`,
  `shapeId` null) — a default, never a refusal.
- **`audio.ground.footstepAt { world, at, gait }`** → `{ cue }` (`footstepAt`): the
  ground reading handed to `footstepCue` — `{ key, surface, gait, volume,
  intervalSec, source }`, or null where no step sounds (`idle`, an unknown gait, a
  surface that makes none). With no position the step is the default surface's
  (`stone`, `source: default`).
- **`audio.ground.contract`** — the corpus contract's data from core's constants:
  `ground.tiers`, `ground.kindDefaults`, `ground.kindFallback` and
  `defaultFootstepSurface`. The file's other `ground` keys and its other keys are
  rules written out, and stay in the corpus.

Points are IR metres on the ground plane `{x, z}`; `y` is never read. The rows
convert nothing: the engine maps its listener's position into the IR's frame first
(Unreal: centimetres and `(X, Y)` to metres and `(x, z)`, less the director's level
offset). **Nothing is an error**: core reads every input itself and its corpus pins
the reading — a world that is absent or not an object states no ground and no
settlement, and an `at` that is absent or not a finite point has no reading (null).

**The evidence** is core's `conformance/audio/ground.json` (48 cases over `placeAt`
13, `groundSurfaceAt` 27, `footstepAt` 8), copied byte for byte as its own set
(`AUDIO_CORPUS_FILES`; `cues.json` beside it is not copied) and driven by
`tests/props_corpus.cpp` as the ctest `audio_ground_corpus`, 0 undriven. Every case
whose world lists two or more settlements, ground surfaces or roads is driven a
second time with those lists reversed (the file's order rule, as core's
`checkGroundCase` drives it; 31 cases), and the contract's data is held to
`audio.ground.contract` on the keys the row states. `audio_ground_corpus_negative`
(`tests/props-negative/ground-wrong.json`) must see Unreal's sidewalk for a footpath
in the contract, an op with no case, and six answers an engine keeping one of its
interim readings would give — a non-finite position read as the wilderness, the open
ground refused, a stated road id ignored, a footpath with no archetype read as
sidewalk, the first listed road taken on a tie, and a road of width 0 read — each
reported. The hand cases in `tests/cases/bridge-audio.json` pin the answer shapes and
the inputs core reads itself.

**Cost.** Three core modules (`audio/ground-from-ir`, `audio/footsteps` and the
`audio/audio-keys` it reads; `geometry/plan-geometry` was already in): at the 6667999
pin the bundle goes from 1,649,195 bytes (the pin and the movement repoint alone) to
1,659,828 (+10,633: core's three modules 7,253, the rows and their comments the
rest). Against the 431c95b pin's 1,652,390 that is +7,438. The 48 cases, with their
31 reversed runs, take about 5 ms under QuickJS.

### The title, tutorial and onboarding rows (PL.native-title-rows)

Core's P8 work (P8.core, ff599d7; in every pin since f9aef13) is the title
screen and the first minute of play: the title menu over the save slots
(`src/ui/title-flow.ts`), the tutorial quest (`TutorialQuestSystem`) and the
onboarding flow built on it (`OnboardingManager`). Unreal's P8 cell copied them as
an interim engine-side copy (`Portable/InsimulTitleFlow`,
`Portable/InsimulTutorialQuest`, U92(1)); these rows are what its retirement
(`P8.unreal.retire-title-copy`) binds instead, as `P6.unreal.retire-props-copy`
binds the `props.*` rows. They call core and decide nothing:

- **`ui.titleFlow.create` / `.apply`** — a session holding the host's `menu`
  (core's `TitleFlowInput`: `title`, `slots`, `saves`, `session`, `busy`, `quit`,
  `settings`, `onboarding`). Its fields go to core UNCHECKED, because core reads a
  flag of the wrong type as its default on purpose and the corpus pins each
  reading. `savesSession` LINKS an open `saves.slots` session: every view is then
  core's `titleMenu` over that session's live view (its rows, Continue target,
  pending write or read, delete prompt), so the title screen and the slot list
  never disagree. ops: `choose { entry }` → core's `TitleChoice` (an action the
  host does, or a refusal VALUE; `entry` goes to core unchecked, so a label or a
  number is core's `unknown_entry`) · `set { menu }` (replaces the host's input).
- **`ui.tutorial.objectives`** — the lessons a game's bindings build
  (`buildTutorialObjectives`).
- **`ui.tutorial.create` / `.apply`** — a `TutorialQuestSystem` on the session's
  own `GameEventBus`. Each op answers `{ result, events }`: the onboarding events
  the quest raised during it (`onboarding_step_started`,
  `onboarding_step_completed` with `durationMs`, `onboarding_completed` with
  `totalDurationMs`), which the host raises on its own bus; an event the host
  sent through `event` is never echoed back. The view is the state core's corpus
  records (`tutorialStateJson`); `create` also answers the quest's `title`,
  `description` and full `objectives` (what a HUD draws for the current one).
- **`ui.onboarding.create` / `.apply`** — an `OnboardingManager` (a definition's
  steps run as ONE tutorial quest) on its own bus. Each op answers `{ result,
  calls, events }`: the manager's callbacks during it (`started`, `completed` with
  `durationMs`, `skipped`, `done` with `totalDurationMs`) and the onboarding events
  its quest raised (as `ui.tutorial.apply`'s); `totalSteps` beside every answer is
  the flow's count against the game's bindings, the same before `start` as after
  (core's `totalStepsRule`); a flow with nothing left is `done` on `start` and
  raises nothing (`nothingLeftRule`). `inspect` (the count and the current step in
  full) and `state` (core's `getState()`: the quest's objectives with `completed`
  and `skipped`, and whether a skip ended it; null before `start`) read without
  acting.
- **`ui.titleFlow.contract`**, **`ui.tutorial.contract`** — each corpus file's
  data tables from core's constants. The title menu's refusal and action names and
  the three onboarding event names are literals in core's emitter, with no
  exported constant, so they are not restated here; the cases pin them.

**The game's bindings** are `bindings` (the whole `ControlBinding[]` table) or the
changes core's corpus writes (`unbind: [action]`, `rebind: { action: [keys] }`,
`bind: [binding]`, applied to `CONTROL_BINDINGS` by core's own `corpusBindings`),
never both. **The clock**: `now` (epoch ms or an ISO string) gives a session a host
clock that moves only on `tick { ms }`, as core's corpus clock does; without it the
session reads the wall clock and `tick` is an error.

**Errors** (`[invalid-input]`) are only a field of the wrong JSON type core's types
declare (`menu`, `config`, `options`, `definition` not an object; a flag not a
boolean; an id list not of strings; `bindings` beside its changes; an unreadable
`now`; `tick` without a host clock; an event without a string `type`). A linked
`savesSession` that is not an open `saves.slots` session is an error naming it.

**The evidence** is core's `conformance/ui/title-flow.json` (57 cases at 72c658c:
menu 29, choose 18, session 10, the tenth a session whose saves change outside the
game, through the `disk_changed` op; 56 at 7376894; it was 51 at ff599d7 and gained the quick-slot and
delete-prompt cases since) and `conformance/quests/tutorial.json` (40 cases:
objectives 8, run 18, onboarding 14; contract `totalStepsRule`, `bindingsRule`,
`nothingLeftRule`), copied byte for byte (`TITLE_CORPUS_FILES`) and driven by
`tests/title_corpus.cpp` as the ctests `title_flow_corpus` and `tutorial_corpus`:
every case through the rows, 0 undriven, each file's contract tables held to its
contract row. A title `session` case runs a `saves.slots` session and a title
session linked to it, one `saves.slots.apply` per slot step and the menu read
after it; tutorial and onboarding sessions open on a host clock at the file's
`contract.t0`. `title_flow_corpus_negative` and `tutorial_corpus_negative`
(`tests/title-negative/`) must see a wrong contract table, a wrong case per op and
an undrivable case each reported. The hand cases in `tests/cases/bridge-title.json`
pin the answer shapes, the live link, the clock, the events and the errors.

**Cost.** Five core modules for the rows (`ui/title-flow`,
`TutorialQuestSystem`, `OnboardingManager`, and the two corpus modules
`ui/title-flow-corpus`, `quests/tutorial-corpus`), and the modules the corpus
modules pull in through core's corpus comparator (`save-file-game-state-corpus` and
the save-file modules behind it): 152 → 183 at the 7376894 pin. The bundle went
from 1,563,744 bytes to 1,628,012 (+64,268, +4.1 %); the three models account for
about 39,400 of that, and about 23,500 is `tutorialStateJson` and `corpusBindings`
living in core's corpus module, whose comparator import brings the save-file code
with it. The 96 cases take about 30 ms under QuickJS. Since the 72c658c pin
(PL.native-interact-target, U94(3)) the rows import those host names from core's
`ui/title-flow-corpus-host` and `quests/tutorial-corpus-host` (core's
PL.tutorial-corpus-bundle, U94(2)), which reach no save module: at 72c658c the
repointed imports alone take the bundle from 1,639,824 bytes to 1,610,712
(−29,112) and 188 core modules to 158.

### The tutorial's save block: progress in, `save` out (PL.native-tutorial-save)

Core's save carries the tutorial's progress (core's PL.tutorial-progress-save,
U97(4)): the registered extension `currentState.extensions.tutorial`, `{ completed,
skipped, current, endedBySkip }` (core's `TUTORIAL_BLOCK_MEMBERS`, in the order its
writer stores them). The tutorial and onboarding rows carry it both ways (U99(1)),
so an engine's save writes the block from a row and its load restores it through
one, and decides nothing itself:

- **`ui.tutorial.readProgress { stored? }`** — core's `readTutorialBlock` over a
  save's stored block. Absent (a new game's save, or one written before the block)
  and null (the registry default after `migrateExtensions`) are no block: `{ ok:
  true, progress: null }`, and the tutorial starts fresh. A readable block answers
  `{ ok: true, progress }` as core reads it (unknown members dropped). An
  unreadable one is a VALUE, `{ ok: false, keys }`, naming every unreadable member
  in ascending order (empty when the block is not an object): core's load refuses
  that save as `unreadable_tutorial`.
- **`ui.tutorial.create`'s `config.progress`** and **`ui.onboarding.create`'s
  `options.progress`** take the stored block as it is. They read it with
  `readTutorialBlock` and refuse exactly what `readProgress` answers `ok: false`
  for, as `[invalid-input]` with the same member names. Core restores it without
  raising anything: completed lessons done, skipped ones done by a skip, and the
  first lesson left in THIS game's order current, which `start` then announces;
  the clock counts from that `start`. So **a mid-tutorial save loaded by a game
  that now teaches a new lesson before the saved `current` makes the new lesson
  current** (core's rule, confirmed by U99(2)); a block whose `current` is null
  restores a tutorial that is over. Ids the game does not run are kept for the
  next save.
- **The `save` op** on `ui.tutorial.apply` and `ui.onboarding.apply` reads without
  acting: its result is core's `saveProgress()`, the block the engine stores at
  `currentState.extensions.tutorial`. An onboarding session's `save` before
  `start` is the progress it was created with, or null when it was given none (the
  save then carries the stored block untouched).
- **`ui.tutorial.contract`** also states the progress corpus's data tables under
  `saves-tutorial-progress`: `extensionKey` (`tutorial`), `blockMembers` and the
  corpus clock's `clockStart`. The corpus's `ops`, `tutorialSteps` and
  `onboardingSteps` are core's runner lists, exported only by
  `quests/tutorial-progress-corpus`, whose comparator import is the save-file code
  the vendor tool refuses; the runner holds them to the steps it maps instead.

**The evidence** is core's `conformance/saves/tutorial-progress.json` (23 cases at
603063d: tutorial 18, onboarding 5), copied byte for byte with the save corpora
(`SAVES_CORPUS_FILES`) and driven by `tests/title_corpus.cpp` as the ctest
`tutorial_progress_corpus`: `stored` goes to `readProgress` (its answer is the
case's `read`), then, when readable, as the create row's `progress` on a host clock
at the file's `contract.clockStart`. A `save` op right after `create` gives
`start.saved`, and one op per step follows. When unreadable, the create row must
refuse the same block as `[invalid-input]`. `tutorial_progress_corpus_negative`
(`tests/title-negative/tutorial-progress-wrong.json`) must see a wrong contract
table, a wrong runner list, four wrong answers (among them the saved `current`
kept where the game now teaches a new lesson) and an undrivable step, each
reported. The hand cases in `tests/cases/bridge-tutorial-save.json` pin absent vs
null, the refusal text and code, the new-lesson rule once more, and the save rows'
answers the pin changed.

**What the core pin changed in the save rows.** `tutorial` is a registered
extension at 603063d. `save.rules`' `extensionKeys` gains it (19 keys), and
`save.migrate` and `save.decode` give a save without the key `extensions.tutorial:
null`, the registry default. A save that carries a block keeps it as a registered
extension, no longer as an orphan. Engines that compare a migrated save field by
field see the new key.

**Cost.** One core module for the rows (`quests/tutorial-save`, which imports only
a type; 165 → 166). The pin alone takes the bundle from 1,659,828 bytes to
1,663,154 (+3,326: the restore and `saveProgress` code in `TutorialQuestSystem` and
`OnboardingManager`, and the registry entry). The rows take it to 1,669,036
(+5,882), for +9,208 in all; `libinsimulcore.dylib` (Release) goes from 5,068,152 bytes to 5,084,664. The 23 cases take about 13 ms under QuickJS.

### The survival rows: the needs, the HUD bars and stamina (PL.native-survival-rows)

Core's P9c logic (P9c.core, with PL.core-survival-rules' five host rules; catalog
systems `survival-needs` and `survival-stamina`) is a set of rows (U106(1)), so an
engine binds core's survival instead of keeping a copy of it (Unreal's interim
`Portable/InsimulSurvival`, which `P9c.unreal.retire-survival-copy` retires):
hunger, thirst, temperature and sleep decaying per whole tick, restored by the
restore actions (`eat`, `drink`, `sleep`) and by items, modified by presets, with
deprivation damage owed to the host; the HUD bars over them and the stamina bar,
held with one rest tick of hysteresis; what runs, read from the composer's
activation; the stamina meter; and `StaminaPool`, the decision layer that spends
and grants rest.

The rows are named `survival.<group>.<op>` after the corpus file's area
(`survival-needs`, `survival-hud`, `survival-stamina`), one core function each:

- **A row that answers a whole corpus op** takes the case's `input` as its args
  and answers its `expected` shape: `survival.needs.{tuning, initial, save, load}`,
  `survival.hud.{view, systems}`, `survival.stamina.{tuning, spend, regen}` answer
  `{ ok: true, value }`; an unreadable save block (`unreadable_survival`, with the
  keys core could not read) and a composition core refuses are VALUES `{ ok: false,
  refusal: { code, field, keys? } }`.
- **The step rows a game calls as it plays are stateless over the state they are
  sent.** `survival.needs.{advance, restore, action, consume, useItem,
  setTemperature, modifier, removeModifier, enable}` take the `state` the last
  answer carried (a `SurvivalState`) with the step's own fields, and answer core's
  result whole, the new `state` in it: `advance` → `{ state, ticks, skipped,
  events, expired, hurt }` (`hurt` is the whole points of deprivation damage the
  host hands its vitals), a change → `{ ok: true, state, events }` or `{ ok: false,
  reason, state }`, `useItem` → `{ ok, state, consumed, remaining, applied, action,
  events }` (one of a stack spent). The HUD's state travels the same way:
  `survival.hud.initial` → `{ hud }`, then `survival.hud.reduce { hud, events }`
  with every needs answer's `events`, and `survival.hud.stamina { hud, stamina:
  { current, max }, staminaConfig, at }` → `{ hud, band, events }` on every stamina
  reading. Nothing is kept between two calls, so a save is `survival.needs.save`
  of the state the game holds and a load is `survival.needs.load`.
- **The tuning is read, never sent back.** Every needs row reads the world's
  tuning from `survival` (the World IR's block) and `params` (the pack's flat
  parameters), as core's corpus reads a case's input; the stamina rows read
  `staminaConfig`. A binding sends the IR it holds on each call; `survival.needs.tuning`
  and `survival.stamina.tuning` answer what core read, for display.
- **`StaminaPool` is a session**, `survival.stamina.pool.create { staminaConfig,
  costs, actions, actors, survivalActorId, start, state }` → `{ session, view: {
  tuning, actors } }` and `.apply` with the ops `cost`, `afford`, `spend`, `rest`,
  `play { actor, at }` (the session's play clock reaches `at`: core's
  `staminaRestClock` grants its whole seconds as rest ticks and keeps the
  remainder), `band` and `save`. The session holds no KB: each `spend` and `rest`
  answers its `energy/3` delta (`facts: { retract, assert }`) for the host's KB, and
  `host` lists the `ISurvivalSystem` calls core made for `survivalActorId`
  (`consumeStamina`, `recoverStamina`). `survival.stamina.state` and
  `survival.stamina.clock` are the meter's band and the rest clock outside a pool.

Only the JSON types core dereferences unread are checked, as `[invalid-input]`
errors: `state` and `hud` objects, `item` an object, `events` an array, `stamina`
an object, the pool's `actors`/`actions` lists of objects, `costs` and `state`
objects and `start` a number, and the systems row's `catalog` as `packs.compose`
checks it. Everything else goes to core, whose corpus pins the
refusals as values (`need_not_tracked`, `unknown_action`, `unknown_modifier`,
`bad_amount`, `not_usable`, `not_held`). The rows import `survival/needs`,
`survival/survival-hud`, `survival/survival-systems`, `stamina/stamina` and
`StaminaPool`, never `survival/systems-corpus` (core's runner).

**The evidence** is core's three P9c corpora (89 cases at the 6cd4b4e pin:
`needs.json` 43 over `tuning` 4, `initial` 2, `run` 30, `save` 1, `load` 6;
`hud.json` 19 over `view` 6, `run` 8, `systems` 5; `stamina.json` 27 over `tuning`
3, `bands` 2, `spend` 7, `regen` 6, `pool` 5, `clock` 4), copied byte for byte as
their own set (`SURVIVAL_CORPUS_FILES`) and driven by their own runner,
`tests/survival_corpus.cpp`, as the ctest `survival_corpus`, 0 undriven. A `run`
case is one row per step (161 steps across the two files), each sent the state
the last answer carried, and recorded in core's runner's shape; a `pool` case is
one `.apply` per step (42); `bands` and `clock` are one row call per reading;
`systems` sends the case's request with the pack catalog the vendored
`composition.json` names. Each file's catalog and op list must be core's.
`survival_corpus_negative` perturbs EVERY case's expectation (the last leaf of its
`value` or `refusal`) and must see all 89 refused, as Unreal's
`survival_corpus_negative` does for its copy. The hand cases in
`tests/cases/bridge-survival.json` (every expectation computed by core's own
functions at the pin) pin the state threading, the refusal values, the
`[invalid-input]` errors and the pool session's lifecycle.

**What the core pin changed beside the survival corpora** (603063d → 6cd4b4e): the
movement corpus's solids gained an optional `kind` (`building`, the default, or
`prop`, which the lens never hides), and `camera.movement.contract` states the new
`solidKinds` table; core's layout corpus gained the ops `buildingAreaOf`,
`settleDoorFrontage` and `doorApproachOutline`, each a new `layout.*` row; core
refuses genre flags and feature modules nothing reads (G.cat-flags), so the rpg
bundle no longer lists `world-lore` nor the platformer bundle `performance-scoring`,
and a refused module (`assessment`, port-later) gates no pause-menu tab even when
listed; P9j's puzzle, platformer and strategy packs join the vendored catalog and
their save extensions `save.rules`' `extensionKeys` (22 keys).

**Cost.** Three core modules for the rows (`survival/needs`,
`survival/survival-hud`, `survival/survival-systems`; `stamina/stamina` and
`StaminaPool` were already bundled, 169 → 172 modules). The pin alone takes the
bundle from 1,669,036 bytes to 1,697,748 (+28,712); the rows, the three layout
rows and `solidKinds` take it to 1,740,208 (+42,460). The 89 cases take about
25 ms under QuickJS.

### The traversal kernel rows: affordances, routes, vehicles, fast travel, ground seating (PL.native-traversal-rows, slice 1)

Core's P9e kernels (P9e.core; catalog systems `traversal-planner`,
`traversal-vehicles`, `traversal-fast-travel` and `traversal-ground-seating`) are a
set of rows (U106(1)), so an engine binds core's traversal instead of keeping a copy
of it (Unreal's interim `Portable/InsimulTraversal`, which
`P9e.unreal.retire-traversal-copy` retires with these rows and slice 2's): what the
link graph affords an actor out of a place and what each way costs, the cheapest way
and the route by core's uniform-cost search, the graph as facts; the three vehicle
verbs (board, drive, disembark) over one vehicle and the facts they change; a fast
travel's hours, its bounded advances and their derived draws; and where a body is
seated on the drawn ground. This is **slice 1 of 2**: the stateless kernels. The
stateful layers (`TraversalPlanner`, `VehicleRegistry`, `FastTravelDirector`, the
personal vehicles, mode lending and the `extensions.traversal` save block, with
core's `session.json`, `mounts.json` and `save.json`) are slice 2's, the next
section.

The rows are named `traversal.<group>.<fn>` after the corpus file's area
(`traversal-affordances`, `traversal-vehicles`, `traversal-fast-travel`, and
`traversal/ground-seating`), one core function each:

- **The three older corpora pin several functions per case** (core's traversal
  corpus test composes each case's record from `resolveAffordances`,
  `bestAffordance`, `findRoute` and `traversalGraphFacts`; from the vehicle verb
  and its facts; from `findRoute` and `planFastTravel` with the arrival and
  discovery deltas), so each row answers ONE function under a named key
  (`{ affordances }`, `{ best }`, `{ route }`, `{ facts }`, `{ resolution }`,
  `{ next }`, `{ plan }`, `{ delta }`, …) and the runner composes the record from
  the rows. A route the route row answered is what `traversal.fastTravel.plan`
  prices; a resolution the resolve row answered is what `traversal.vehicles.apply`
  applies.
- **A ground-seating row that answers a whole corpus op** takes the case's `input`
  and answers its `expected` (`traversal.groundSeating.{tuning, footprint, ground,
  target, stand, moved}`), and the settle is three rows **stateless over the
  state they are sent**: `.initial` → `{ state }`, then per frame `.retarget {
  state, wantMm, at }` → `{ state }` and `.offsetAt { state, at }` → `{ offsetMm }`,
  and `.unseat` → `{ state }` whenever nothing carries the body. Each reads the
  pack's `params` on every call (core's `groundSeatTuning`).
- **Tunings are core's resolved tunings**, as the corpora carry them. A binding
  reads its World IR's `traversal` block once through `traversal.affordances.tuning`
  and `.links`, `traversal.vehicles.fromIR` (its `vehicles`) and
  `traversal.fastTravel.tuning` (its `fastTravel`), and sends what they answered.
  An absent tuning is core's own default (`DEFAULT_TRAVERSAL_TUNING`, which the
  planner also defaults to, for `.resolve`, `.route` and `.graphFacts`;
  `DEFAULT_FAST_TRAVEL_TUNING` for `.plan`); `.ceiling` and `.hours` take one,
  as core's functions do.
- **`stamina` on the route row** reaches every leg the search resolves, as core's
  corpus test's spread of a case's input sends it to `findRoute`; core's planner
  sends none, and neither need a binding that routes as the planner does.

Refusals are values (`unreachable`, `blocked`, `mode`, `impassable`, `stamina` on an
affordance; `elsewhere`, `full`, `not_aboard`, `occupied`, `redundant` on a vehicle
verb; `nothing_drawn`, `too_far`, `level` on a seat), and a refused verb's `next`
is null. Only what core dereferences unread or its TypeScript declares and JSON
cannot hold is checked, as `[invalid-input]` errors: `links`, `blocked`,
`affordances`, `vehicles` and a route's `steps` lists of objects, `modes` a list of
strings, `geometry`, `stamina`, `vehicle`, `resolution` and the fast-travel
`tuning` objects, a stated traversal `tuning`'s `modeCost`/`modeAction` objects, a
vehicle state's `occupants` list, `verb` one of core's `VEHICLE_VERBS`, `known` a
boolean, and the ground-seat numbers, points and probes (each hit `{ heightMm:
number, paved: boolean }`). Ids, location atoms, costs and the seed go to core as
sent. The rows import `traversal/traversal`, `traversal/traversal-facts`,
`traversal/vehicles`, `traversal/vehicle-facts`, `traversal/fast-travel`,
`traversal/fast-travel-facts` and `ground-seating/ground-seat`, never
`traversal/systems-corpus` (core's runner).

**The evidence** is core's four kernel corpora (67 cases at the 6cd4b4e pin:
`affordances.json` 14, `vehicles.json` 14, `fast-travel.json` 11,
`ground-seating.json` 28 over `tuning` 2, `footprint` 2, `ground` 7, `target` 5,
`stand` 5, `moved` 2, `settle` 5), copied byte for byte as their own set
(`TRAVERSAL_CORPUS_FILES`) and driven by their own runner,
`tests/traversal_corpus.cpp`, as the ctest `traversal_corpus`, 0 undriven. The
runner composes each older case's record from the rows as core's test composes it
from core's functions, and drives every one of them a second time with its lists
reversed (the links, modes and closures; a vehicle's occupants), as core's order
guard does; each planned fast-travel case also asks `.ceiling` and `.hours`, which
must answer the pinned plan's. A settle is one row per step (28 steps). The
ground-seating file's catalog, op list and settle steps must be core's.
`traversal_corpus_negative` perturbs EVERY case's expectation (its last leaf) and
must see all 67 refused, as Unreal's `traversal_corpus_negative` does for its copy.
The hand cases in `tests/cases/bridge-traversal.json` (every expectation computed
by core's own functions at the pin) pin the IR readers, the answer of one row sent
to the next, a stated `stamina` on the route row, the ground-seat `params` (on a
settle; and on `ground`, `stand` and a mid-settle `retarget`, each with an answer
core's default tuning would give differently, because no `ground-seating.json` case
of those ops states `params`) and the `[invalid-input]` errors.

**Cost.** Five core modules for the rows (`traversal/vehicles`,
`traversal/vehicle-facts`, `traversal/fast-travel`, `traversal/fast-travel-facts`,
`ground-seating/ground-seat`; `traversal/traversal` and `traversal/traversal-facts`
were already bundled through the mechanic runtime, 172 → 177 modules). The bundle
goes from 1,740,440 bytes to 1,773,586 (+33,146). The 67 cases take about 15 ms
under QuickJS.

### The traversal layers: the session, personal vehicles, lent modes and the save block (PL.native-traversal-rows, slice 2)

Slice 2 of the same task (U106(1)): core's P9e decision layers and what they keep
(catalog systems `traversal-planner`, `traversal-vehicles`, `traversal-fast-travel`).
With slice 1's kernels these rows hold everything Unreal's interim copy does, so
`P9e.unreal.retire-traversal-copy` can bind them in its place
(`ENGINE_BINDINGS.md` maps every function of the copy to its row).

- **The three decision layers are ONE session**, `traversal.session.create` /
  `traversal.session.apply`, because core wires them together (core's
  `docs/traversal-systems.md` §1): a `TraversalPlanner` over the shared
  `StaminaPool` (when `stamina` is stated), a `VehicleRegistry` that lends a driver
  its mode through the planner, names the driven vehicle in the planner's orders and
  follows the driver on `traversal_completed`, and a `FastTravelDirector` over the
  same planner with a world clock. There is no KB, so every permission is granted
  and every authored requirement unmet (the layers' own no-KB rule); each answer's
  fact `delta` is for the host's KB. `links` and `tuning` are the planner's graph
  and numbers as slice 1's `traversal.affordances.links` / `.tuning` answer them;
  `vehicles` and `fastTravel` are the IR's blocks (core's `vehiclesFromIR`,
  `fastTravelTuningFromIR` in the row); `personal` the pack's personal-vehicle
  params; `seed` the playthrough seed. Absent, each is core's default.
- **The hosts are data, not callbacks.** Core's planner and director call a probe
  and a locomotion host in the middle of a decision, and a callback cannot cross
  this ABI. So the binding states them: `probe { <link id>: passable }` (a link not
  listed is unanswered, so passable: core's rule) and `locomotion { stuck? }` (every
  order core makes is recorded and reported arrived, except one to a destination
  `stuck` names, which leaves the actor where it says, `reason: 'stuck'`, the
  corpus host's report). Op `host { probe?, stuck? }` restates them. Absent, there
  is no probe and no locomotion host (core's degradations: geometry passable, every
  order arrived and none recorded). The world clock and the bus are recorded.
- **Each op is ONE call into core**, answered under a named key, with what the hosts
  recorded while it ran: `events` (raise them on the game's bus), `orders` (carry
  them out; if a body ends up elsewhere, `arrive` tells core once) and `clock` (the
  hours to pass, in order). Planner: `register`, `setModes`, `lendMode`,
  `returnMode`, `arrive`, `block`, `unblock` → `{ delta }`; `isBlocked`,
  `affordances`, `route` (null: none), `canTraverse` → `{ decision }`, `traverse
  { actor, to, intent? }` → `{ report }`, `locationOf` (null: never registered),
  `modesOf`, `lentOf`. Registry: `board`, `drive`, `disembark` → `{ report }`,
  `canDo { verb }` → `{ decision }`, `vehicleOf`, `drivenBy` (null: none),
  `stateOf`, `roster`. Director: `discover`, `discoveries`, `destinations`,
  `canFastTravel`, `fastTravel`. The meter: `meter { actor }` (core's
  `StaminaPool.get`). Personal vehicles: `mount { actor, kind }`, `dismount`,
  `cycle` → `{ result, delta }` — core's verb with the rider's registry vehicle as
  `inVehicle`, and when performed `personalVehicleModes` of the planner's modes and
  lent record handed to `setModes(actor, modes, lent)`, the wiring core's doc §8
  states (the result is core's without `state`, which the session holds). The
  rider's intent (core's PL.core-ride-intent, bound by PL.native-bundle-core):
  `riderIntent { actor, prior }` → `{ posture, rider, body }` (what `actor` is
  aboard over the session's riders and its registry's roster, the rider intent, and
  what the host draws given `prior`, the body's own animation intent), `riders
  { vehicle }` → `{ riders }` (`{}` parked or unknown); neither changes state. Save:
  `save` → `{ key, block }`; `load { block? }` hands each member core's reader read
  to its layer's `restore()` and `riding` to `personalVehiclesFromSave` → `{ ok,
  dropped }`, or the VALUE `{ ok: false, keys }` with nothing changed. Every op
  settles the registry's follow before it answers. The `view` after each apply is
  the four layers' state (each `serialize()` and the save rows of who rides what).
- **The pure parts are rows of their own**, one core function each, stateless over
  the state they are sent: `traversal.personal.*` (`tuning`, `pace`, `label`,
  `modes`, `initial`, `mount`, `dismount`, `cycle`, `saveRows`, `fromSave`; each
  reads the pack's `params`), `traversal.lending.*` (`lend`, `giveBack`,
  `canonical`, `vehicleLender`, `personalLender`), `traversal.save.*` (`block`,
  the writer at core's `TRAVERSAL_EXTENSION_KEY`; `read`, core's reader, whose
  refusal is a value) and `traversal.rider.*` (`posture`, `intent`, `body`,
  `vehicleRiders`: core's `traversal/rider-intent`, what a body aboard a vehicle is
  drawn as; one atom, `ride`, for every vehicle, driver and passenger alike, and
  getting off gives the body's own intent back).

Checked as `[invalid-input]` errors, as slice 1: the lists core iterates or spreads
(`links`, `vehicles`, `stamina.actors`, `modes`, a save part's rows, each actor's
`modes` and each vehicle's `occupants`), the objects it reads (a lent record with
list values, the personal `params` with its `kinds`/`cycle` lists and `onFoot`
object, a personal `state` with its `riding` map, a saved `riding`, the probe's
boolean answers, `stuck`'s location atoms), a stated traversal `tuning`'s tables,
`seed` a string or number, a personal `kind` a string (or null where core's type
allows it), `verb` one of `VEHICLE_VERBS` and an `intent`'s `urgency`/`stance` one
of core's `MOVEMENT_URGENCIES`/`MOVEMENT_STANCES`; `host` refuses a probe or a
`stuck` the session was created without. Ids and location atoms go to core as sent.
The rows import `game-engine/logic/{TraversalPlanner, VehicleRegistry,
FastTravelDirector}`, `game-engine/host-contracts`, `traversal/personal-vehicles`,
`traversal/mode-lending` and `traversal/traversal-save`, never
`traversal/systems-corpus` (core's runner).

**The evidence** is core's three systems corpora (69 cases at the d88b6f0 pin:
`session.json` 26 runs over all 21 of its steps, `mounts.json` 27 over `tuning` 3,
`pace` 5, `modes` 9 and `run` 10, `save.json` 16 over `block` 4, `read` 8 and
`restore` 4; core's PL.core-ride-intent added the `intent` and `riders` steps and
the 7 cases that use them, which a mounts run drives through `traversal.rider.*`
with the stated `inVehicle` as `aboard`, as core's runner does), copied byte for byte into the same set as slice 1's and driven by the
same runner, `tests/traversal_corpus.cpp` (129 cases in all, 0 undriven). Each
session case is ONE session, each step one `traversal.session.apply` whose ops'
answers compose core's runner's record; the hosts' recordings stay pending until a
step records them, as core's runner keeps them. A mounts run is one personal row per
step over the state the last answer carried; a save `restore` is a session's
`load` and its view. Each file's catalog, op list and steps must be core's, and
every step a header declares must be driven. `traversal_corpus_negative` perturbs
EVERY case of all seven files and must see all 129 refused. The hand cases in
`tests/cases/bridge-traversal-session.json` (every expectation computed by core's own
functions and classes at the pin) call every row and every op: the state one
personal row answers sent to the next, the writer's and the reader's answers, one
session through every op (the `host` op restating both hosts, a save loaded back
after the playthrough moved on, an unreadable block refused), core's degradations
with no hosts, and the `[invalid-input]` errors.

**Cost.** Four core modules (`game-engine/logic/VehicleRegistry`,
`game-engine/logic/FastTravelDirector`, `traversal/personal-vehicles`,
`traversal/traversal-save`; the planner and mode lending were already bundled,
177 → 181 modules). The bundle goes from 1,773,586 bytes to 1,847,883 (+74,297).
The 129 cases take about 40 ms under QuickJS.

### The headless build rows: plan, result, progress, credentials, folds (PL.native-headless-build)

Core's P10 headless build contract (P10.core: `src/build/headless-build.ts`,
`docs/headless-build.md`; the schemas `insimul.build-request/1`,
`insimul.build-result/1`, `insimul.build-progress/1`) is a set of rows (U106(1),
U107), so an engine binds core's build contract instead of keeping a copy of it
(Unreal's interim `Portable/InsimulHeadlessBuild`, which
`P10.unreal.retire-headless-build-copy` retires). Core holds no engine build code,
and neither do these rows: they say what a build is asked for and what it answers.

The rows are named `build.<fn>`, one core function each, plus the contract's tables:

- **The three checkers answer core's whole answer**, details included.
  `build.plan { request, context? }` is `planBuild`: `{ ok, refusals, notes, plan }`,
  each refusal and note `{ code, field, detail }`, in core's order (the code lists'
  order, then the field by UTF-16 code unit). `build.checkResult { request, result,
  context? }` is `checkBuildResult` (`{ ok, issues, summary }`, the summary E6's Build
  row: `status`, `platform`, `primary`, `bytes`, `open`, `line`), and
  `build.checkProgress { request, events }` is `checkBuildProgress` (the summary E6's
  Busy state from the last event). A refusal or an issue is a VALUE. Core's corpus
  pins codes and fields; the details are creator sentences, and a hand case pins
  them as core words them.
- **What a request, a result or the events hold goes to core as sent**: a wrong
  shape is core's `invalid-request`, `result-invalid` or `progress-invalid`, never a
  row error. The rows' own checks (`[invalid-input]`) are on the plan context
  (`files` an object, `predicateSchemaHash` a string; `lock` any JSON, `null`
  included, because core parses it; an absent or `null` context is core's `{}`, so
  the plan notes `lock-unverified` and `inputs-unverified`), the strings the scan and
  path rows take, and the parts of a parsed result or event the line rows read.
- **The lines and the size**: `build.resultLine { result, hideDetails? }` (core's
  `buildResultLine`; with `hideDetails` the engine's words are `hiddenDetail`),
  `build.progressLine { event }` ("Building… 41%", a half rounding up, or
  "Building… 3 of 7") and `build.size { bytes }` ("999 kB", "1 MB").
- **The credential scan**: `build.isSecretKey`, `build.looksLikeSecret` and
  `build.findSecrets` (dotted fields, code-unit sorted, a key that is itself a
  credential named `<credential>`, `secretKeyStandIn`). **What "lower-cased" means
  for a credential key** (PL.native-headless-fold-rules): core's own code, the key
  through JavaScript's `toLowerCase` as the rows run it in QuickJS, `_` and `-`
  dropped, then a match on one of core's endings. That is full Unicode lower case,
  not a case fold: the Kelvin sign (U+212A) lower-cases to `k`, so `TOKEN` spelt with
  it is a credential key (and `ACCESS_KEY` with it); the long s (U+017F) is already
  lower case and stays `ſ`, so `PAſSWORD` and `ſECRET` are not (a case fold would
  make them `s`); dotted capital `İ` (U+0130) lower-cases to `i` + U+0307, so
  `APİKEY` and `SESSİONİD` are not; dotless `ı` (U+0131) stays `ı`, so `APıKEY` is
  not. No letter Unicode 17.0 added lower-cases into ASCII, so these answers are the
  same under QuickJS's 16.0 tables and V8's 17.0 (a key holding U+A7CE or U+16EA0
  before `TOKEN` is a credential key on both; after it, on neither). Core's rule text
  says only "lower-cased" and its corpus holds no such key, so this is the rows'
  current behaviour stated as the contract (U101(4)); whether core means a case fold
  is core's to answer (U49(3)), unanswered. Hand cases in
  `tests/cases/bridge-build.json` pin each key, and `build.findSecrets` over them, on
  both legs.
  Unreal's engine-side `RedactCredentialAssignment` (a build log's `NAME=value`
  lines) stays Unreal's and calls these.
- **The path rules**: `build.pathProblem`, the two case folds `build.foldMacos`
  (NFD, each code point's full lower, upper, lower case, then NFC) and
  `build.foldWindows` (the same without normalising), `build.insideDir` (as spelt:
  how a result's paths are held to `outDir`) and `build.insideDirFolded` (under
  either fold: the plan's `out-dir-holds-inputs` and `out-dir-reserved`), with
  `build.compareCodeUnits`, `build.resolvePlatform` and `build.isPrimaryArtefact`.
  The folds run in QuickJS with QuickJS's Unicode tables; `corebridge_cases_parity`
  holds them to V8's on the hand cases' fold vectors, and the corpus's fold cases run
  through `build.plan` in QuickJS. QuickJS 2025-04-26's tables are Unicode 16.0's:
  measured over every code point against Node 26 (Unicode 17.0), both folds differ on
  28 code points, all case pairs Unicode 17.0 added (U+A7CE, U+A7D2, U+A7D4,
  U+16EA0–U+16EB8), and the macOS fold also on strings holding marks 17.0 added (their
  combining classes). **The 9 fold differences** (PL.native-headless-fold-rules):
  against Unreal's `fold-vectors.json` (1,593 strings as V8 folded them, Unicode
  17.0), the rows answer differently on 6 strings, 9 folds: the macOS fold of all 6
  (#29, #72 and #79 hold marks 17.0 added, U+1ACF–U+1AEB, U+10EFA–U+10EFB and
  U+1E6E3–U+1E6F5, which 17.0's combining classes order under NFC and which 16.0's
  tables call unassigned, class 0; #55 holds the case pairs U+A7CE, U+A7D2 and
  U+A7D4; #76 and #77 hold Beria Erfe, U+16EA0–U+16EB8) and the Windows fold of 3
  (#55, #76, #77, the case pairs; the Windows fold does not normalise, so the marks
  agree). Core names no Unicode version and no ruling pins one, so **the rows'
  current answers are the contract** (U101(4)): a fold is what this library's QuickJS
  tables say, and a letter or mark newer than Unicode 16.0 is left as it is.
  Whether core pins a Unicode version (and native then updates QuickJS's tables, or
  an engine's own suite skips code points newer than the library's) is core's
  question under U49(3), unanswered. `tests/cases/bridge-build.json` states each of
  the 9 as a **library-version answer** (`tests/README.md`): the row's answer in
  `expect`, V8's in `libraryVersion.v8`; `corebridge_cases_parity` holds every other
  step to V8 byte for byte and fails if a declared one starts agreeing.
- **`build.contract`** answers the tables `conformance/build/headless.json`'s
  `contract` states, less the corpus's own `secretFixtures` and `rules` and
  `schemas.jsonSchemas` (core's file names).

Core's corpus `conformance/build/headless.json` (233 cases at 6cd4b4e) is copied
byte for byte as its own set (`BUILD_CORPUS_FROM`) to
`vendor/core/conformance/headless-build/headless.json`, one folder over from core's
(`build/` is a folder name `.gitignore` and the `build-output-tree` scan rule read as
build output; the bytes are core's, and `--check --core` compares them with core's
`conformance/build/headless.json`), and driven by `tests/build_corpus.cpp` (ctest `build_corpus`): every
`<<secret:NAME>>` marker expanded from the file's own `secretFixtures` (core's
`expandSecretFixtures`), every case through `build.plan`, `.checkResult`,
`.checkProgress` or `.size` and cut to core's runner's shape; `build.contract` held to
the file's contract; no credential repeated in a detail or a line; and every out-dir
refusal a plan case expects asked of the fold rows (which fold catches it: the corpus
has two cases only the macOS fold catches and one only the Windows fold catches), and
every accepted plan's inputs clear of its build folder under them.
`build_corpus_negative` perturbs every case's expectation and, on purpose, a
credential not caught, a credential shown (as an expectation, and planted in an
answer the leak check must catch), a path escaping the build folder (by fold), an
artefact outside it and a path outside the project; all must be refused.

### The progression and skill rows: XP, modules, the save block, skill trees (PL.native-progression-rows)

Core's P9i progression (P9i.core: `src/progression/gamification.ts`,
`feature-modules.ts` and `progression-save.ts`, `docs/progression-systems.md`) and
core's skill trees (`src/skills/`, with the decision layer
`game-engine/logic/SkillProgression`) are rows (U106(7)), so an engine binds them
instead of keeping a copy (Unreal's interim P9i copy, which its retirement rows
retire; `ENGINE_BINDINGS.md` maps it row by row).

- **`progression.<group>.<op>`, one core function each**, groups after core's corpus
  files: `progression.gamification.*` (levels, tiers, the XP table, achievements, the
  daily challenge and streaks, and the tracker), `progression.modules.*` (the module
  definitions and verdicts, resolution, proficiency, adaptive difficulty and the quest
  difficulty adjustment), `progression.skills.domain` (core's language and guild
  domain trees) and `progression.save.*` (the `progression` save block's builder,
  reader and writer). Every answer is `{ ok: true, value }`, and a refusal core
  returns is IN the value: a tracker step's `refusal` (`bad_date`, `unknown_award`,
  `unknown_event`, which an unknown step kind also answers), a module's `refused`,
  an unreadable block's `{ ok: false, keys }`. One row is a composite:
  `progression.modules.genre` answers the record core's `modules` corpus states for a
  genre (its bundle, declared and enabled modules, refusals, pause tabs and configs),
  each part a core function's answer.
- **The tracker is stateless here**: `progression.gamification.step { run, step,
  tuning?, config?, at? }` is core's `applyGamification`, which does not change its
  input; keep the `run` the answer carried and send it with the next step. `tuning` is
  the pack's parameters over core's `GAMIFICATION_TUNING`, read on every call.
- **`skill.<group>.<fn>` are the pure skill-tree functions** (`skill.ir.*`,
  `skill.advancement.*`, `skill.unlocks.*`, `skill.effects.*`, `skill.trees.*`): a
  resolution's refusal is a value, and a pure resolution never asks a KB.
- **`skill.create` opens core's `SkillProgression`**; each `skill.<method> { session,
  … }` row is one of its methods and answers `{ ok: true, value, events }`, `events`
  being what core raised on the session's bus during that call (a take's
  `skill_node_unlocked`, its effects as `effectTerm` text). **With `kb`** (a program,
  or a list of clauses, holding core's skill pack from `prolog.packs { areas:
  ['skill'] }` and the world's facts and rules), the session's KB is a native Prolog
  KB: `skill.unlock` and `skill.canUnlock` ask core's own `skill_goal_met/2` there for
  each authored goal, bound to the asking actor, permissibility is asked there, and
  the take's facts are written there. **With none**, core's rule stands: a node that
  asks anything stays locked until this world's rules open it (refusal `requires`),
  and nothing is forbidden. A program the KB refuses is `[invalid-input]`; the KB
  lives as long as the session and `session.dispose` destroys it.
- **`skill.kb.*` is the skill KB that sees the live facts** (core's
  PL.core-skill-kb-live-facts and PL.core-skill-kb-rule-head-facts, in at the 45409ed
  pin; bound by PL.native-bundle-core-r2). A fact the game asserts or retracts in play
  (`currentState.prologFacts`) reaches the requirement gate, in play and after a load.
  `skill.kb.liveFacts { prologFacts }` (core's `skillKbLiveFactsOf`) says which facts a
  skill KB holds, in clause order, and which it drops and why (`unreadable`,
  `skill_owned` — a roster predicate or a rule head of the skill pack — `authored`,
  `reserved`, `duplicate`); `skill.kb.compose { pack?, world?, facts? }` (core's
  `composeSkillKbProgram`) is the program a host that recomposes consults. A host that
  layers opens core's reference session, `skill.kb.open { program?, pack?, skills?,
  trees?, tuning? }` (a native KB of its own), then `skill.kb.load { currentState }`
  (recomposed from the save; a refused progression block is the value `{ ok: false,
  refusal }` and changes nothing), `.assert` / `.retract { fact }`, `.canUnlock` /
  `.unlock { actor, node }`, `.facts`, `.savedFacts` (what a save writes as
  `prologFacts`), `.program` and `.serialize` (the roster). Each answers `{ ok: true,
  value }`. The JS leg has no Prolog, so its hand case is C-only.

Evidence: `progression_corpus` (`tests/progression_corpus.cpp`) drives core's
`conformance/progression/{gamification,modules,skills,save}.json` (87 cases at
45409ed, the 14 `compose` and `kb` cases of skills.json among them, a `kb` case one
`skill.kb.open` session with one row per step; 73 at 6cd4b4e), `conformance/skills/{advancement,unlocks,effects,trees,effect-terms}.json`
(52) and the three `can_unlock/2` cases of `conformance/prolog/mechanic-skill.json`
through the rows, each copied byte for byte at the pin; a KB-backed unlock replays
each `can_unlock` case with the case's KB behind the session, and every node the KB
opens is asked again with no KB and must stay locked. Its refusal probes show that an
unknown op, step or area is refused (a failed case, never a skip), that
`progression.gamification.step` answers an unknown step kind with core's
`unknown_event`, and that an unknown row is the method table's error.
`progression_corpus_negative` perturbs every case's expectation. Hand cases:
`tests/cases/bridge-progression.json` (every row, the threaded tracker run, the
`[invalid-input]` errors, the no-KB session and, on the C leg, a KB-backed unlock),
every expectation computed by core's own functions at the pin.

### The village-state save rows: the checked write and read, ownership, the sky, the conversations (PL.native-village-save-rows)

Core's village-state save (`src/save-file-game-state.ts`, `docs/village-state-save.md`:
P1.core, and the conversations projection of PL.core-save-conversations-projection)
is rows (U118, U128), so an engine binds them instead of keeping a copy (Unreal's
interim `Portable/InsimulVillageSave` and the village-save and save-conversations
copies in `InsimulUIStateBinding` and `InsimulSocialBinding`, which its retirement
rows retire; `ENGINE_BINDINGS.md` maps them row by row). The mapping sits between a
game's save interchange (`GameSaveState`) and the ONE persisted format, core's
`SaveFile` (`currentState` and `conversations`); every rule is core's.

- **`save.village.write` and `save.village.read` are core's CHECKED entry points**
  (`writeVillageSave`, `readVillageSave`), answered in the corpus's shape: `{ ok: true,
  currentState, conversations }` (the two bodies a save PUT takes: put them over the
  save, `{ ...save, currentState, conversations }`) or `{ ok: true, gameState }`, and a
  refusal is a VALUE, `{ ok: false, refusal: { code, field, found?, expected?, keys?,
  message } }`, in core's order: the save's version, the game state's, unregistered
  extensions, each stored block, each written block, the conversation records. The
  codes are core's (`wrong_version`, `unregistered_extension`, `unreadable_<block>`,
  `unreadable_conversations`); `message` is core's sentence for a log, which the corpus
  does not pin. `save.village.check` is `checkVillageSave` alone.
- **Whose save it is.** `save.village.ownership` (`checkSaveOwnership`) answers
  `wrong_world` (field `worldId`) and then `wrong_runtime` (field `runtime`, C5-3),
  each with `found` and `expected`, or null; `save.village.readRuntime`
  (`readRuntimeSave`) is a game's Load: that check, then the checked read of the
  runtime's villagers. `runtime` null (or absent) is the legacy runtime, which owns only
  unstamped saves. The stamp readers are `save.village.runtimeOf`, `.positionFrameOf`,
  `.belongsTo` and `.runtimeLabel`; `save.village.agentCurie` is a board key.
- **The clock and the sky.** `save.village.timeStateOf` and `.totalHoursOf` are core's
  clock mapping (an hour that rounds to 24 carries into the next day).
  `save.village.weather.read` is `readWeatherBlock` (`{ ok, value }` or `{ ok: false,
  keys }`); `save.village.weather.saveState` and `.restore` run `weatherSaveState` and
  `restoreWeatherFromSave` over a `weather.create` session's director, so the sky a save
  carries goes into and out of core's own `WeatherDirector`.
- **The conversations.** `save.village.conversations.read` is `readConversationRecords`;
  `.rows { stored, records }` is `conversationRowsOf`, the records folded into one row
  per NPC (read with core's reader first, as the writer reads them; records it cannot
  read are `[invalid-input]` naming core's keys); `.records { rows }` is
  `conversationRecordsOf`, the rows split back; `.timestamp` and `.epochMs` are the wall
  clock's instant and the round trip back (null outside `CONVERSATION_MS_MIN`..`MAX`).
  The checked write and read fold and split them already; these rows are for a binding
  that shows or edits conversations between saves.
- **`save.village.contract`** states the constants a binding must not hard-code
  (versions, the board extension key, the player's local id, the slot names, the
  villager slots, the weather keys, the conversation keys and the ms range), keyed as
  the corpus's `contract` keys them. **`skill.kb.loadJson`** is core's `skillKbLoadJson`,
  what a load recomposes the skill KB from (the corpus's `skillKb` op).
- **`[invalid-input]` only for what core dereferences unread**: the save document,
  the write's and read's options, a world id, a runtime (a string or null), the
  `totalHours` of `timeStateOf`, the restore's `gameState`. The game state, a stored
  block, a timestamp and a clock are handed over as they came, and core answers them.

Evidence: `village_save_corpus` (`tests/village_save_corpus.cpp`) drives core's
`conformance/saves/village-state.json` (399 cases at 45409ed: write 177, read 129,
roundTrip 44, stamp 4, agentCurie 4, timeStateOf 10, totalHoursOf 5,
conversationTimestamp 8, conversationEpochMs 8, skillKb 10), copied byte for byte at
the pin, each op composed from the rows as core's reference runner
(`save-file-game-state-corpus.ts`) composes it, and holds `save.village.contract` to the
corpus's contract key for key. Its refusal probes show that another version, an
unregistered extension, another world and another runtime are core's values, that a
save that is not an object and unreadable records are `[invalid-input]`, that an
unknown op fails its case and that an unknown row is the method table's error.
`village_save_corpus_negative` perturbs every case's expectation. The same 399 cases
also run on both case legs (and `corebridge_cases_parity`) as
`vendor/core/cases/core-saves-village.json`, which `emit-bridge-cases.mjs` transcribes
and `core_vendor` holds to the vendored corpus case by case. Hand cases:
`tests/cases/bridge-village-save.json` (every row; malformed saves and game states,
foreign-world and foreign-runtime ownership through `ownership` and `readRuntime`, the
`[invalid-input]` boundary, the projection's round trip through the rows and through
the checked write and read, the conversation clock, the sky against a `weather.create`
session), every expectation computed by core's own functions at the pin.

### The language rows: the book, the save block, the prompt selector, hover, the chat, the bank and profile, adaptation, pronunciation, the words in the world, composition and listening, quest feedback and the quest types (PL.native-language-rows, slices 1 to 4)

Core's P9h language kernels (`src/language-learning/`, `docs/language-systems.md`) are
rows (U118, U128), so an engine binds them instead of keeping a copy (Unreal's interim
`Portable/InsimulLanguage*`, which `P9h.unreal.retire-language-copy` retires once the
row's last slice, slice 4, lands; `ENGINE_BINDINGS.md` maps them function by function). Core's
kernels are PURE: each takes a state and returns a new one, so each row takes the state
as JSON and answers core's result as JSON, and the host keeps the state between calls
(no session). Slice 1 binds five of core's thirteen corpus files, slice 2 three more
(the bank and learning profile, adaptation, pronunciation) and slice 3 three more
(collection, objects, writing) and slice 4, the last, two more (quest feedback, quest
types): twelve of the thirteen (`chat-strip.json`, the NPC reply's marker strip, is the
chat-cefr copy's and goes with `PL.native-chat-cefr-rows`; core's genre quest types,
`conformance/quest-types/`, go with `PL.native-genre-rows`).

- **The book** (`progress.ts`): `language.book.empty`, `.recordEncounter`, `.advance`,
  `.recordGrammar`, `.recordConversation`, `.setCefr` move a book; `.findWord`,
  `.wordView`, `.mastery`, `.isWeak`, `.weakPatterns`, `.fluencyGain`, `.summary` and
  `.encounterOfEvent` read one. A book is read with core's own reader of a stored book
  (`readLanguageBlock`, the reader the village save's checked write and read use for
  `extensions.languageLearning`), so a book the save would refuse is `[invalid-input]`
  naming core's keys (`book.words[0]`, `book.fluency`, ...), and a book with members
  missing reads with core's defaults. `language.facts.cefr` and `.weakDimensions` are
  `prolog/player-language-state.ts`, the player's band and weak dimensions from facts.
- **The save block** (`language-save.ts`): `language.save.block` is `languageSaveBlock`
  (the block a game hands the save from its kernels), `language.save.read` is
  `readLanguageBlock` (`{ ok, value }` or `{ ok: false, keys }`), and
  `language.save.blockOf` is `languageBlockOf`, the stored form, over the block read
  first with that reader, as the village save's writer reads `gameState.languageLearning`.
  The checked write and read (`save.village.*`) carry the block already; these rows are
  for a binding that builds or shows it between saves.
- **The prompt selector** (`prompt-selector.ts`): `language.prompts.onPick`,
  `.standing`, `.answer`, `.quizOnReach`, `.answerQuiz`, `.pickTargetIds` and `.initial`,
  over core's `PickWorld` (`{ identification, naming, targetLanguage, identifyTuning?,
  namingTuning? }`); a pick is examine's (`props.interactables.examinePick`) or a
  pointer's. The registers it reads are core's `world-words.ts`:
  `language.identification.initial`/`.registerTargets`, `language.naming.initial`/
  `.registerNameable`/`.nameableObjects`, `language.collection.initial`/`.registerTags`
  (the rest of `world-words` is slice 3's, below). A tuning given is checked to hold every
  key of core's default with the same JSON type; `language.contract` states the defaults.
- **Hover and the word key** (the hover half of `reading-writing.ts`; `word-key.ts`):
  `language.hover.initial`, `.tokenize`, `.addHints`, `.seeWord`, `.setMastery`,
  `.isLikelyTarget`, `.lookup`, `.resolve`, `.display`; `language.word.key` and
  `.stripEdges` are the one key hover and the chat share.
- **The chat metrics** (`chat-metrics.ts`): `language.chat.start`, `.line`, `.hear`,
  `.end`, `.finish`, `.lineTokens`, `.lineWords`, `.questUsages`, `.targetPercent`,
  `.checkErrors`; a line's metrics feed core's difficulty monitor,
  `language.difficulty.initial` and `.recordTurn` (`adaptation.ts`; the rest of
  adaptation is slice 2's, below).
- **The bank and the learning profile** (slice 2, `bank-profile.ts`):
  `language.bank.categories`, `.cards` (core's `BankQuery`, each member absent or null
  read as core's `??` default; a sort outside `vocabularySorts` is `[invalid-input]`
  before core would throw, and a `limit` must be a number, since core slices by it),
  `.revealsMeaning`, `.grammarTab`, `.analyzeWeaknesses`, `.strongPatterns` and the
  arithmetic rows `.halfUpPercent`, `.rateOf`, `.weaknessPriority`; `language.profile.history`
  is `learningHistory` (which of a host's quest records a profile holds: finished ones
  only) and `language.profile.build` is `learningProfile` over those rows and the
  assessments. The weakness tables, labels, tones, quest categories and skill dimensions
  are `language.contract`'s.
- **Adaptation** (slice 2, the rest of `adaptation.ts`): `language.difficulty.signals`
  and `.score` (the struggle the monitor reads), `language.npc.hash`, `.mode`,
  `.modeDirective`, `.scaffoldingDirective`, `.frequencyDirective` and `.adaptation`
  (what an NPC's chat request carries), `language.hints.behavior` and `.showsVocabHint`,
  `language.word.isMastered` (core's `language/mastery`, which `adaptation.ts`
  re-exports), `language.quests.filterByCefr` and `language.cefr.advancement`. A
  default argument (`native = 'English'`, `scaffolding = 'none'`, a word's difficulty)
  is core's when the member is absent or null.
- **Pronunciation** (slice 2, `pronunciation.ts`): `language.pronunciation.normalize`,
  `.wordSimilarity`, `.score`, `.grade`, `.wordFeedback`, `.xp`, `.hintPenalty` and
  `.listenAndRepeat` (core reads a phrase's `targetPhrase` only), and `.encode`, core's
  `language/phonetic-similarity.ts` `phoneticEncode`, the code the similarity blends.
  The STT transcript and the TTS voice stay the host's.
- **Words in the world** (slice 3, the rest of `world-words.ts`): knowledge collection,
  `language.collection.seed`, `.inReach` (a point `{ x, y, z }`), `.quiz` (the seeded
  quiz; `.quizDraw` is the draw it shuffles by) and `.answer`; object identification,
  `language.identification.prompt`, `.answer`, `.quest` and `.removeQuest`, graded by
  `.normalize`, `.editDistance` (over code points) and `.distanceScore`; point and name,
  `language.naming.point` and `.submit`; examine and read sign,
  `language.objects.examine` (`options` `{ languageWorld, targetLanguage, fluency,
  range? }`), with `.nearest`, `.isSignRole` and `.fluencyTier`, the parts it reads. A
  tuning absent or null is core's default. Every target's progress is held to core's
  `IdentificationProgress` (`attempts` and `bestScore` numbers, `identified` a boolean),
  a translation to its string `targetWord` and optional string `pronunciation` and
  `category`, and a sign's optional `category` to a string (a null is `[invalid-input]`,
  slice 4 round 2 carrying slice 3's verdict m1).
- **Composition and listening** (slice 3, the rest of `reading-writing.ts`):
  `language.writing.countWords`, `.view` and `.submit` (a config's `minWords` and
  `objectiveType` absent or null are core's defaults); `language.listening.register`,
  `.prompt`, `.chat` and `.grade` over core's `ListeningState` (a list the host starts as
  `[]`), with `.fallbackGrade`, the local grade a `grade` with `score: null` gives. A
  grade's `score` is core's `number | null` and must be stated. `stripPunctuation` and
  `hoverKey` are core's `stripWordEdges` and `wordKey` under other names:
  `language.word.stripEdges` and `language.word.key` answer them.
- **Quest feedback** (slice 4, `quest-feedback.ts`; the quest lifecycle governs, U118(10)):
  `language.questFeedback.initial` (the strip's state from a quest's objectives, read as
  the lifecycle reads them; `meanings` absent or null: none; core is handed a
  prototype-free copy, so a word such as `constructor` takes the host's meaning or none
  like any other), `.useVocabulary`,
  `.grammar`, `.correctUsage`, `.pronunciation` and `.hints` move it;
  `.syncLifecycle` takes the lifecycle's records of the same quest again (by index);
  `.lockedVocabulary`, `.lockedPronunciation`, `.lockedGrammar`, `.done`,
  `.grammarObjectiveComplete` (the analyser's check; `accuracy` and `correct` absent or
  null: core's 60 and 3) and `.targets` (`questLanguageTargets`) read. Core states no
  refusal here. Every member of an objective and of the state is held to core's declared
  type (slice 3's verdict m1): a null is `[invalid-input]` where core declares an optional
  string, number, list or boolean, and taken where core declares `| null`; an objective's
  `index` must name one of the state's `objectiveLocks`.
- **The quest types** (slice 4, `quest-types/index.ts` with `language-learning.ts`,
  `business-scavenger-hunt.ts`, `customer-service.ts`, and `language/quest-templates.ts`):
  `language.questTypes.forWorld` (every quest type a world gets, as ids), `.primary`,
  `.definition` (as data: JSON drops the tracking and completion functions and the
  generation prompt; null when unknown), `.has`, `.all`, `.mixing`, `.merge` (over
  definitions as data), `.objectiveComplete` (a registered objective type's
  `completionCheck`; an unknown quest type or objective is `[invalid-input]`, where core's
  runner throws, and so is a member core's `ObjectiveProgress` declares that is not its
  declared number or `{ x, y, z }`), and `.templates`, `.templatesByDifficulty`, `.templatesByCategory`. The
  objective and reward type maps are `language.contract`'s. The genre quest types
  (`quest-types/genre-quests.ts`) are bundled through `index.ts` and bound by no row here.
- **Refusals are values** in core's shape: `empty_word`, `unknown_encounter`
  (the book handed back unchanged), `no_target_language`, `empty_line`, `no_turns`,
  `nothing_in_reach`, `no_prompt`, `no_quiz`; slice 3: `unknown_object`, `already_named`,
  `no_attempts_left`, `empty`, `too_short`. Core states them as codes with no message,
  so none is added. **`[invalid-input]` only for what core dereferences unread**: a book
  core's reader cannot read, a state, list or string a kernel indexes, an enumeration
  core's types declare (a CEFR band, a grammar status, a word difficulty, a tuning's
  kind; slice 2: a vocabulary sort, a card interaction, a translation display mode, a
  scaffolding level, an NPC language mode, a word match; slice 3: a composition's
  objective type; slice 4: a grammar feedback status, a feedback item type, a reward
  type), each checked as core's
  declared TypeScript type reads it (slice 1's line). **`language.contract`** states the
  constants a binding must not hard-code, every one imported from core.

Evidence: `language_corpus` (`tests/language_corpus.cpp`) drives core's
`conformance/language/{progress,save,prompts,hover,chat,bank,adaptation,pronunciation,collection,objects,writing,quest-feedback,quest-types}.json`
(186 cases at 45409ed: 14, 12, 10, 20 and 20; slice 2's 24, 16 and 15; slice 3's 3, 18 and 5; slice 4's 22 and 7), copied byte for byte at the pin, each op composed from the
rows as core's reference runner (`systems-corpus.ts`, `runLanguageSystemsOp`) composes
core's kernels, and needs each file's declared `ops` and `steps` to be exactly the ones
it drives (0 undriven, every step driven). Its 27 refusal probes show that core's thirteen
refusals and an unknown quest type's null definition are values, that an unreadable book, a
vocabulary sort and a band outside core's types, a listening grade with no score, an
objective type a quest type does not define, a grammar status outside core's three, an
objective's null description and an objective index naming no lock are `[invalid-input]`
naming the member, that an unknown op or step fails its case
and that an unknown row is the method table's error.
`language_corpus_negative` perturbs every case's expectation. The same 186 cases also run
on both case legs (and `corebridge_cases_parity`) as
`vendor/core/cases/core-language-<file>.json`, which
`emit-bridge-cases.mjs` transcribes and `core_vendor` holds to the vendored corpora case by
case (by name, by the calls core's runner makes for it, row for row and count for count,
and with every answer of a run's steps stated in some expectation; for slice 2's to 4's
files every member of every answer, except the input echoes the runner makes, which the
emitter checks, and a register's ids, a listening quest's projection, a quest feedback run's
recent ids, a quest type's categories and objectives and a template's objectives and
parameters, stated in their own shape, each still required in that shape, and a quest
feedback step's members assembled from several rows, each member required);
`core_vendor_language_negative` proves the guard names twenty perturbations of those files.
Hand cases: `tests/cases/bridge-language.json` (every row; malformed books and the
`[invalid-input]` boundary of every state; core's refusals as values; a game's own
tunings; slice 4: every quest feedback row on its own with its defaults, every setting a
world's quest type is read from, the definitions and templates whole, every objective
type's completion check, a quest word naming an `Object.prototype` member), every expectation computed by core's own functions at the pin.

### The genre systems rows: the puzzle (PL.native-genre-rows, slice 1)

Core's P9j genre systems (`docs/genre-systems.md`) are rows (U115, U128), so an engine binds
them instead of keeping a copy (Unreal's interim `Portable/InsimulPuzzle.{h,cpp}`, which
`P9j.unreal.retire-puzzle-copy` retires). Slice 1 binds the puzzle (catalog
`puzzle-rule-module`); the platformer, the strategy game and the genre pieces are later slices
of the row.

- **The definition** (`puzzle/puzzle.ts`, pure): `puzzle.forWorld` (the world's authored
  section when it has riddles, else one generated from the world; the row's `puzzle`, or null
  for none, stands over the world's own section when given; `maxAttempts` is the pack tunable,
  a number or null for never spent, absent for core's default), `puzzle.generate`,
  `puzzle.issues` and `puzzle.fromIR` (an authored section; one with issues is core's error),
  `puzzle.facts` (the pack's authored facts), `puzzle.worldFacts` (the world facts its riddles
  are answered from, for a KB that did not consult the whole world), `puzzle.answerKey` and
  `puzzle.choices` (what a host offers; the verdict stays the KB's). `puzzle.contract` states
  core's constants.
- **The director** (`game-engine/logic/PuzzleDirector.ts`): `puzzle.director.create` opens a
  session holding a KB of its own, built as core's runner builds it — `GamePrologEngine` with
  genre `puzzle`, whose module activation consults the puzzle pack and declares its runtime
  predicates — on this library's native Trealla seam; `kb` (a host program, for instance the
  world's whole knowledge base) is consulted after the packs, and `worldFacts` and the
  definition are published. Each further row is one method: `.findClue`, `.answer`,
  `.unlock` (the host's `open_container` order is IN the outcome), `.take`, `.view`,
  `.progress`, `.isComplete`, `.serialize` and `.restore`; `puzzle.director.stateFacts` is the
  static. Every verdict is the KB's; a refusal (`unknown_riddle`, `clue_missing`, `spent`,
  `locked`, …) is a VALUE in the outcome. `session.dispose` destroys the KB.
- **The save block** (`puzzle/puzzle-save.ts`): `puzzle.save.read` (core's reader, its
  refusal `{ ok: false, keys }` a value), `puzzle.save.block` and `puzzle.save.blockOf`. A load
  builds the definition again from the same world and restores the READ value into a fresh
  director.
- **The world input** (`genre.world.of`, core's `worldOf`): the corpora's `world` — a committed
  slice by name, a slice with KB predicates (`dropFacts`) or entity lists (`dropEntities`)
  dropped or its player replaced, or an inline world. `slices` are the committed slices by name
  (a name must be an own key of it); an unknown entity list is core's error. Bundling it brings
  core's genre systems runner module and, with it, the platformer and strategy modules and
  directors the later slices bind (the bundle grows 2,481,156 → 2,553,569 bytes).
- **The boundary.** Every argument is held to the type core declares for it, member for member
  (`GenreWorldSource`, `PuzzleIR`, `PuzzleDefinition`, `PuzzleRiddle`, `PuzzleDirectorState`):
  a declared member must be present and of its type, an optional one may be absent, and a null
  is refused unless core declares `| null`; members core does not declare pass through. Every
  member is looked up as an own key. Anything else is `[invalid-input]`.

Gates: `genre_systems_corpus` (+ `_negative`) drives every case of core's
`conformance/puzzle/{definition,run,save}.json` (17 + 6 + 11) through the rows, each op as
core's runner (`genre-systems/systems-corpus.ts`, `runGenreSystemsOp`) composes it, with the
committed world slice `conformance/genre-mechanics/thistlecombe.world-slice.json`; all four
files are copied byte for byte at the pin. `emit-bridge-cases.mjs` transcribes the three corpora
into `cases/core-genre-puzzle-{definition,run,save}.json` (a world through `genre.world.of`
over the vendored slice, named by `$file`; a case that reaches the KB is C-only), which
`core_vendor` holds to the corpora (by name, by the calls core's runner makes in order, C-only
exactly where a case reaches the KB, and with every answer stated) and
`core_vendor_genre_negative` proves names nine perturbations of. Hand cases:
`tests/cases/bridge-puzzle.json` (the contract, generate, a world's own section, issues, ids
naming `Object.prototype` members, stateFacts and the save block's defaults, `worldOf`'s forms,
the `[invalid-input]` boundary of every argument, and a director over its own KB with a host
program), every expectation computed by core's own functions at the pin.

### The extension keys `save.rules` answers (PL.native-save-extension-keys, U110)

`save.rules`' `extensionKeys` is `Object.keys(extensionRegistry).sort()` over core's
`src/save-extensions.ts` at the pin, so it moves with every pin that registers an
extension. At 45409ed (as at d88b6f0 and 6cd4b4e) it is **22 keys**: `achievements`, `aiBlackboards`,
`detectionStates`, `droppedFacts`, `evaluations`, `gamification`, `gathering`,
`introShown`, `languageLearning`, `npcLife`, `platformer`, `playthroughTelemetry`,
`progression`, `puzzle`, `sessions`, `skillTree`, `social`, `strategy`,
`survivalNeeds`, `traversal`, `tutorial`, `weather` (P9j.core's `puzzle`,
`platformer` and `strategy` took it from 19 to 22). The rules case in
`tests/cases/bridge-saves.json` states that exact list (it used to accept any
array, so a drop back to 19 passed), as `bridge-tutorial-save.json`'s re-pin case
does inside `$subset`; both legs replay them. `core_vendor` evaluates the vendored
bundle, asks it `save.rules`, and fails unless every `save.rules` step under
`tests/cases/` that names `extensionKeys` states exactly that sorted list; so the
next pin that changes the registry is red until those cases are updated on purpose.
With `--check --core` it also reads the top-level keys of core's
`extensionRegistry` at the pin and needs the bundle to answer the same.
`core_vendor_extension_keys_negative` must see five wrong statements named. An
engine's own registry (Unreal's `RegisteredExtensions()` in its interim village
save) should equal this list; `save.rules` is the row to hold it to.

### What the feature phases asked for and core does not have yet

Exposed "as core has them" — so a few UI view-models in the brief are not rows,
because there is nothing in core at the pinned commit to expose: **no HUD
view-model** (the HUD shell composes `ui.notifications`, `ui.journal`'s tracker,
`quest.waypoints`' compass and the clock), and **no
minimap view-model** beyond the two marker functions (`quest.minimapMarkers`,
`quest.markers` with `surface: "minimap"`). The Features Round plan (§1) lists compass and minimap
view-models as core work; when they land, they are rows here. (The inventory
panel's view-model landed in core with P6.core and is the `inventory.*` rows
since PL.native-props-rows, above.)

## Sessions

A stateful core object lives in the handle's JS heap and the host holds an
integer (`js/host-sessions.js`):

- `<area>.create {…}` returns `{ session, … }`. Handles count from 1 per
  `insimul_core` handle, in order, never reused.
- `<area>.apply { session, ops: [{ op, … }, …] }` runs the ops in order — one
  result per op in `results` (null for a void op) — then reports the model's
  `view` once. Batch everything one game event causes into one call.
- An op that throws stops the batch; earlier ops' effects are KEPT (core's models
  mutate in place and have no undo), and the error names the op's index.
- A handle of the wrong kind is refused by name; `session.dispose` releases one
  (idempotent); `session.list` shows what is open — a leak in a game is growth here.
- `events` (quest completion, clock, weather) are what core's callbacks or event
  bus reported during THIS call's ops, in order. `writes` (weather) are the KB
  writes core made through its engine seam, in order — the game's KB lives on
  the host's side of the ABI, so the host applies them there verbatim.

## Errors

The ABI's rule is unchanged: NULL and `insimul_core_last_error()`. What the text
looks like is now part of the contract:

- every failure reads `insimulcore: <ErrorName>: <message>`;
- a caller error found at the boundary reads `insimulcore: Error: insimulcore:
  <method>: <what was wrong>` (an op failure: `… <method>: ops[<i>] (<op>)
  failed: …`);
- **a refusal core raises with a machine-readable code** (`GenreResolutionError`,
  `CompositionError`, and any op failure wrapping one) reads `insimulcore: <ErrorName>: [<code>]
  <message>` — a host reads the code between the brackets and never parses prose;
- **a caller error the P9a rows refuse** (`ui.genreHud`, `ui.rulesPanel`,
  `mechanics.run`) carries a code the same way: `insimulcore: Error: [<code>]
  insimulcore: <method>: <what was wrong>`, with `unknown-op` or `invalid-input`;
- arguments must be a JSON object (or NULL / empty, meaning `{}`).

A domain outcome is not an error: a save slot that does not load is
`{ ok: false, error: { code, message } }` from `save.decode`, a refused trade is
`{ ok: false, reason }`, a marker that does not show is `kind: null`.

## Building

There is nothing special to do — `libinsimulcore` builds with everything else:

```sh
cmake -B build && cmake --build build && ctest --test-dir build
```

Artifacts land beside `libinsimul`'s, in the top-level build directory:
`build/libinsimulcore.a` and `build/libinsimulcore.dylib` (`.so` / `.dll`
elsewhere). `scripts/package.sh` copies the shared one and `insimulcore.h` into
`dist/<platform>/` — see `../docs/consuming.md` for the GDExtension, P/Invoke and
Unreal-module linkage recipes.

The shared library **static-links `libinsimul`**, so it loads on its own with no
rpath dance. That is safe precisely because the two ABIs share no state: no
`insimul_kb` handle ever crosses `insimulcore.h`.

It is **not** built for wasm (`cmake/wasm.cmake` returns before this directory is
added). A browser host runs `@insimul/core` as the TypeScript it already is;
compiling a JS engine to wasm in order to run JS would be circular.

## The gates

| ctest | What it proves |
|---|---|
| `corebridge_smoke` | the library boots, the version stamp names both pins, the table holds every row this file documents |
| `corebridge_cases` | **every method, from C**: all case files on a fresh handle per case, through `insimulcore.h` (QuickJS, the C SHA-256, the native Prolog seam) |
| `corebridge_cases_js` | the same cases with the same bundle in Node (V8, Node's crypto); also that this README's table equals `core.methods` |
| `corebridge_cases_parity` | the C and JS legs' RAW result strings are byte-identical for every step |
| `corebridge_sha256` | the C SHA-256 against the NIST vectors, at every split point |
| `corebridge_radiant`, `corebridge_radiant_none` | the radiant corpus through core's real radiant engine on the native Prolog engine |
| `core_vendor` | every vendored file matches its recorded sha256 and the pin; `cases/core-ui-save-slots.json` carries core's `load_refusals` as `ui.loadRefusal` cases (with `--check --core`, exactly as many as core states at the pin); every `save.rules` case under `tests/cases/` states exactly the sorted extension keys the vendored bundle's registry answers (22 at 45409ed; with `--check --core`, also the keys of core's `extensionRegistry` in `src/save-extensions.ts` at the pin) |
| `core_vendor_extension_keys_negative` | that extension-key check alone over `tests/save-extension-keys-negative/`: a dropped key, a reordered list, an unregistered key, a list loosened to any array and a dropped key inside `$subset`, each named, and the run failed |
| `core_vendor_language_negative` | the language transcription guard alone, over fourteen in-memory perturbations of `cases/core-language-*.json` (a dropped case, a dropped call, a first call changed, an answer expected nowhere, a call that is no language row, an answer weakened to a subset, an NPC's mode at one band dropped; slice 3: an identification answer dropped, an examine weakened, a collection run's first call changed, a knowledge world's collected words expected nowhere, a listening chat dropped, a listening chat's quests not expected, a submitted composition weakened): passes only when the guard names all fourteen |
| `saves_slots_corpus`, `saves_slots_corpus_negative` | core's `conformance/saves/slots.json` driven through the `saves.slots.*` session rows (132 of 147 cases at 72c658c; the 15 indicator cases reported with a measured reason), and a wrong answer seen as wrong |
| `props_containers_corpus`, `props_documents_corpus`, `props_doors_corpus`, `props_notice_board_corpus`, `inventory_corpus`, `props_corpus_negative` | core's five P6 corpora driven whole through the `props.*` and `inventory.*` rows (129 cases at 431c95b, each file's contract tables held to `props.contract`), and a wrong answer per file seen as wrong |
| `props_pickup_placement_corpus`, `props_pickup_placement_corpus_negative` | core's pick-up placement corpus driven whole through the `props.pickups.*` rows (72 cases; its `numerics` must name double precision; its contract tables, `frames` and the constants' values among them, held to `props.contract`), and a wrong numerics, frame, constant, undriven op and four wrong answers (a mirrored building axis among them) seen as wrong |
| `props_interactables_corpus`, `props_interactables_corpus_negative` | core's interact-rule corpus driven whole through the `props.interactables.*` rows (73 cases at 45409ed with 8 `press`, 53 at d88b6f0, 33 at 431c95b, 27 at 72c658c; 0 undriven; the runner walks each case's props and stands one row call each, as core's runner does, a press through target, examinePick and press; its contract's data tables held to `props.contract`; the stands sent with no `y` counted against `props.interactables.contract`), and a wrong range, an undriven op, five answers an engine keeping one of Unreal's interim rules would give, two runner controls (a case's `ranges`, a lone `prop`), a stand with no `y` read as floor 0, a pick acting over the target and a stand's dropped `objects` seen as wrong |
| `audio_ground_corpus`, `audio_ground_corpus_negative` | core's ground reading corpus driven whole through the `audio.ground.*` rows (48 cases, 0 undriven; every case whose world lists two or more settlements, ground surfaces or roads driven again with them reversed; its contract's data held to `audio.ground.contract`), and Unreal's sidewalk for a footpath in the contract, an undriven op and six answers an engine keeping one of its interim readings would give seen as wrong |
| `camera_movement_corpus`, `camera_movement_corpus_negative` | core's movement contract corpus driven whole through the `camera.movement.*` rows (95 cases at 6cd4b4e, 0 undriven; every case with more than one solid or exclusion driven again with them reversed; its contract's data tables held to `camera.movement.contract`), and Unreal's step in the contract, an undriven op and six answers an engine keeping one of its interim rules would give seen as wrong |
| `title_flow_corpus`, `tutorial_corpus`, `title_flow_corpus_negative`, `tutorial_corpus_negative` | core's P8 corpora driven whole through the `ui.titleFlow.*`, `ui.tutorial.*` and `ui.onboarding.*` rows (97 cases, 0 undriven; each file's contract tables held to its contract row), and a wrong contract table, a wrong answer per op and an undrivable case per file seen as wrong |
| `survival_corpus`, `survival_corpus_negative` | core's three P9c corpora (`needs.json`, `hud.json`, `stamina.json`; 89 cases at 6cd4b4e) driven whole through the `survival.*` rows by `tests/survival_corpus.cpp` (0 undriven per file; a `run` one row per step over the state the last answer carried, a `pool` one `survival.stamina.pool.apply` per step; each file's catalog and op list held to core's), and EVERY case's expectation perturbed and seen as wrong, as Unreal's `survival_corpus_negative` does |
| `traversal_corpus`, `traversal_corpus_negative` | core's seven P9e corpora (the kernels' `affordances.json`, `vehicles.json`, `fast-travel.json`, `ground-seating.json`, and the layers' `session.json`, `mounts.json`, `save.json`; 136 cases at d88b6f0, 129 at 6cd4b4e) driven whole through the `traversal.*` rows by `tests/traversal_corpus.cpp` (0 undriven per file; each older case's record composed from one row per core function and driven again with its lists reversed, a settle one row per step, a session case one `traversal.session` with one apply per step, a mounts run one personal row per step; each systems file's catalog, ops and steps held to core's and every step driven), and EVERY case's expectation perturbed and seen as wrong, as Unreal's `traversal_corpus_negative` does |
| `build_corpus`, `build_corpus_negative` | core's P10 headless build corpus (`conformance/build/headless.json`, 233 cases at 6cd4b4e) driven whole through the `build.*` rows by `tests/build_corpus.cpp` (credential markers expanded as core's runner does; 0 undriven; `build.contract` held to the file's contract; no credential repeated in a detail or a line; every out-dir refusal asked of the fold rows, with at least one case only the macOS fold catches and one only the Windows fold catches), and EVERY case's expectation perturbed and seen as wrong, with purposeful perturbations (a credential not caught or shown, a path escaping the build folder under either fold, an artefact outside it, a path outside the project) each refused |
| `progression_corpus`, `progression_corpus_negative` | core's P9i progression corpora (`conformance/progression/{gamification,modules,skills,save}.json`, 87 cases at 45409ed with skills.json's `compose` and `kb` through the `skill.kb.*` rows, 73 at 6cd4b4e), its skill-tree corpora (`conformance/skills/*.json`, 52) and the `can_unlock/2` cases of `conformance/prolog/mechanic-skill.json` (3) driven whole through the `progression.*` and `skill.*` rows by `tests/progression_corpus.cpp` (0 undriven per file; a gamification `run` one `progression.gamification.step` per step, every step kind driven; each progression file's catalog, ops and steps held to core's; a KB-backed `skill.unlock` per `can_unlock` case, with a no-KB control; refusal probes for an unknown op, step, area and row); the negative pass perturbs every expectation and needs every one refused |
| `village_save_corpus`, `village_save_corpus_negative` | core's village-state save corpus (`conformance/saves/village-state.json`, 399 cases at 45409ed) driven whole through the `save.village.*` rows and `skill.kb.loadJson` by `tests/village_save_corpus.cpp`, each op as core's reference runner composes it (0 undriven; `save.village.contract` held to the file's contract; refusal probes for another version, an unregistered extension, another world and runtime, `[invalid-input]` and an unknown op or row); the negative perturbs every case |
| `language_corpus`, `language_corpus_negative` | core's P9h language corpora `conformance/language/{progress,save,prompts,hover,chat,bank,adaptation,pronunciation,collection,objects,writing}.json` (157 cases at 45409ed) driven whole through the `language.*` rows (and `props.interactables.examinePick` for the prompts' examine pick) by `tests/language_corpus.cpp`, each op as core's reference runner composes it (every op and step of each file driven, 0 undriven; each file's declared ops and steps held to the runner's; refusal probes for core's thirteen refusal values, the `[invalid-input]` of an unreadable book, a vocabulary sort and a band outside core's types and a listening grade with no score, an unknown op, step or row); the negative perturbs every case |
| `tutorial_progress_corpus`, `tutorial_progress_corpus_negative` | core's tutorial progress corpus driven whole through `ui.tutorial.readProgress`, the create rows' `progress` and the apply rows' `save` op (23 cases, 0 undriven; contract tables held to `ui.tutorial.contract`, the runner lists to the steps it maps), and a wrong contract table, a wrong runner list, four wrong answers and an undrivable step seen as wrong |

The cases come from two places (`tests/README.md`): `vendor/core/cases/` is core's
OWN corpora (saves, the UI matrices, weather progression, genre resolution,
recipes, module activation, quest goldens), transcribed at the pinned commit by
`tools/emit-bridge-cases.mjs` — expectations core committed, not ones this repo
computed — and `tests/cases/` is hand-written for what no core corpus pins yet
(notifications, quest completion, markers, waypoints and the compass, the clock,
weather sessions, the codec round trip, sessions and errors).

## Adopting more of core

1. Add a row to `js/entry.js` and to the table above.
2. Re-vendor from any `@insimul/core` checkout that has the pinned commit and an
   installed `node_modules` (`npm install` in it); which commit it has checked
   out does not matter — the tool reads the pin with `git archive`:
   ```sh
   node corebridge/tools/vendor-core-bundle.mjs --core <core checkout>
   ```
   To move core, change `coreCommit` (a full id) in `core-pin.json` first; to move
   the bundler, `esbuild` (the tool refuses any other installed version).
3. Add cases: transcribe the area's core corpus in `tools/emit-bridge-cases.mjs`
   if core has one, hand-write them in `tests/cases/` if it does not.
4. Rebuild; `ctest -R corebridge`.

The bundle is a **checked-in build artifact**, not a build step, because this
repository is standalone by design — it cannot run a bundler against a package it
does not contain. `--check` (the `core_vendor` ctest) verifies a sha256 per file
over the generated artifacts AND their inputs (`js/*.js`, the emitter, the pin),
so an adapter edit that was never re-vendored is caught. Only `--check --core`
re-bundles and re-derives the cases at the pin and diffs them byte for byte —
the reproducibility check:

```sh
node corebridge/tools/vendor-core-bundle.mjs --check --core <core checkout>
```

## Limits worth knowing

- **Nothing per-frame crosses this boundary.** Every call is a JSON round trip.
  Core is the decision layer; rendering, input and physics stay engine-side. The
  clock in particular: send `clock.apply { ops: [{ op: "update", deltaMs }] }` at
  event rate (a fraction of a second is plenty) with the real time since the last
  one, never once a frame; core accrues minutes from any delta.
- **`insimul_core_call` is synchronous**, driving the JS job queue until the
  promise settles. Every promise in the adopted surface is resolved by JS or by
  a synchronous C call. A method that awaits real I/O would need a pump driven
  from the host's frame loop — the ABI would not change.
- **One handle, one thread**, exactly like an `insimul_kb`.
- **No keepalive KB** is held any more: libinsimul fixed the create/destroy-cycle
  defect inside itself (top-level `CLAUDE.md`, "Create/destroy CYCLE hangs").
- **Wall clock**: `quest.completion.apply`'s `checkTimedObjectives` reads
  `Date.now()` (objectives' `startedAt` is epoch milliseconds), and `save.encode`
  without `exportedAt` stamps the current time. Everything else is a function of
  its arguments.
