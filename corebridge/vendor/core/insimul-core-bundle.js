(() => {
  // corebridge/js/host-prolog-engine.js
  function collapseTerm(term) {
    if (term === null || term === void 0) return null;
    if (typeof term === "string" || typeof term === "number" || typeof term === "boolean") {
      return term;
    }
    if (Array.isArray(term)) return term.length === 0 ? "[]" : ".";
    if (typeof term === "object" && typeof term.functor === "string") return term.functor;
    return String(term);
  }
  var NativePrologEngine = class {
    constructor(id) {
      this.kind = "wasm";
      this._id = id;
    }
    async consult(program) {
      const err = globalThis.__insimul_prolog_consult(this._id, program);
      return err === null ? { success: true } : { success: false, error: err };
    }
    /**
     * @param {string} queryString goal text, with or without a trailing `.`
     * @param {number} [maxResults] defaults to 1000, as `WasmPrologEngine.query` does
     */
    async query(queryString, maxResults = 1e3) {
      const goal = String(queryString).trim().replace(/\.\s*$/, "");
      let raw;
      try {
        raw = globalThis.__insimul_prolog_query(this._id, goal, maxResults);
      } catch (err) {
        return { success: false, bindings: [], error: String(err && err.message ? err.message : err) };
      }
      const solutions = JSON.parse(raw);
      return {
        success: true,
        bindings: solutions.map((sol) => {
          const out = {};
          for (const key of Object.keys(sol)) out[key] = collapseTerm(sol[key]);
          return out;
        })
      };
    }
    destroy() {
      if (this._id < 0) return;
      globalThis.__insimul_prolog_destroy(this._id);
      this._id = -1;
    }
    // ── Not reached by the adopted slice. Fail loudly if a future one gets here.
    declareDynamic() {
      return unimplemented("declareDynamic");
    }
    assertFact() {
      return unimplemented("assertFact");
    }
    assertFacts() {
      return unimplemented("assertFacts");
    }
    retractFact() {
      return unimplemented("retractFact");
    }
    addRule() {
      return unimplemented("addRule");
    }
    addRules() {
      return unimplemented("addRules");
    }
    queryOnce() {
      return unimplemented("queryOnce");
    }
    getFactsForPredicate() {
      return unimplemented("getFactsForPredicate");
    }
    getAllFacts() {
      return unimplemented("getAllFacts");
    }
    getAllRules() {
      return unimplemented("getAllRules");
    }
    clear() {
      return unimplemented("clear");
    }
    clearFacts() {
      return unimplemented("clearFacts");
    }
    export() {
      return unimplemented("export");
    }
    import() {
      return unimplemented("import");
    }
    getStats() {
      return unimplemented("getStats");
    }
  };
  function unimplemented(member) {
    throw new Error(
      `insimulcore: PrologEngine.${member}() is not implemented by the native bridge. The adopted slice does not use it \u2014 see gdextension/corebridge/js/host-prolog-engine.js.`
    );
  }
  async function createPrologEngine(_options = {}) {
    const id = globalThis.__insimul_prolog_create();
    if (id < 0) throw new Error("insimulcore: could not create a Prolog KB");
    return new NativePrologEngine(id);
  }

  // @insimul/core/src/prolog/prolog-fact-parser.ts
  function parsePrologFile(source) {
    const facts = [];
    const rules = [];
    const contentBlocks = [];
    const errors = [];
    const lines = source.split("\n");
    let i = 0;
    while (i < lines.length) {
      const line = lines[i].trim();
      if (!line || line.startsWith("%")) {
        i++;
        continue;
      }
      if (line.startsWith(":-")) {
        i++;
        continue;
      }
      let clause = line;
      let startLine = i + 1;
      while (!clauseEnds(clause) && i + 1 < lines.length) {
        i++;
        const nextLine = lines[i].trim();
        if (!nextLine || nextLine.startsWith("%")) continue;
        clause += "\n" + nextLine;
      }
      const ruleIdx = findRuleOperator(clause);
      if (ruleIdx >= 0) {
        const headText = clause.substring(0, ruleIdx).trim();
        const bodyText = clause.substring(ruleIdx + 2).trim().replace(/\.\s*$/, "");
        const head = parseTerm(headText);
        if (head && head.type === "fact") {
          rules.push({
            head: head.fact,
            body: bodyText,
            raw: clause,
            line: startLine
          });
        } else {
          errors.push({ line: startLine, message: "Failed to parse rule head", text: clause.substring(0, 80) });
        }
      } else {
        const factText = clause.replace(/\.\s*$/, "").trim();
        const result = parseTerm(factText);
        if (result && result.type === "fact") {
          result.fact.line = startLine;
          facts.push(result.fact);
        } else if (factText) {
          errors.push({ line: startLine, message: "Failed to parse fact", text: factText.substring(0, 80) });
        }
      }
      i++;
    }
    buildContentBlocks(facts, rules, contentBlocks, source, lines);
    return { facts, rules, contentBlocks, errors };
  }
  function parseTerm(text) {
    text = text.trim();
    if (!text) return null;
    const match = text.match(/^([a-z_][a-z0-9_]*)\s*\(([\s\S]*)\)$/);
    if (!match) {
      return null;
    }
    const predicate = match[1];
    const argsText = match[2];
    const args = parseArgList(argsText);
    return {
      type: "fact",
      fact: { predicate, arity: args.length, args, line: 0 }
    };
  }
  function parseArgList(text) {
    const args = [];
    let current = "";
    let depth = 0;
    let inSingleQuote = false;
    let i = 0;
    while (i < text.length) {
      const ch = text[i];
      if (inSingleQuote) {
        if (ch === "'" && i + 1 < text.length && text[i + 1] === "'") {
          current += "''";
          i += 2;
          continue;
        } else if (ch === "'") {
          inSingleQuote = false;
          current += ch;
          i++;
          continue;
        }
        current += ch;
        i++;
        continue;
      }
      if (ch === "'") {
        inSingleQuote = true;
        current += ch;
        i++;
        continue;
      }
      if (ch === "(" || ch === "[") {
        depth++;
        current += ch;
      } else if (ch === ")" || ch === "]") {
        depth--;
        current += ch;
      } else if (ch === "," && depth === 0) {
        args.push(parseArg(current.trim()));
        current = "";
        i++;
        continue;
      } else {
        current += ch;
      }
      i++;
    }
    if (current.trim()) {
      args.push(parseArg(current.trim()));
    }
    return args;
  }
  function parseArg(text) {
    text = text.trim();
    if (text.startsWith("'") && text.endsWith("'") && text.length >= 2) {
      const inner = text.slice(1, -1).replace(/''/g, "'");
      return { type: "string", value: inner };
    }
    if (/^-?[0-9]+(\.[0-9]+)?([eE][+-]?[0-9]+)?$/.test(text)) {
      return { type: "number", value: parseFloat(text) };
    }
    if (/^[A-Z_][A-Za-z0-9_]*$/.test(text)) {
      return { type: "variable", value: text };
    }
    if (text.startsWith("[") && text.endsWith("]")) {
      const inner = text.slice(1, -1).trim();
      if (!inner) return { type: "list", elements: [] };
      const elements = parseArgList(inner);
      return { type: "list", elements };
    }
    const compMatch = text.match(/^([a-z_][a-z0-9_]*)\s*\(([\s\S]*)\)$/);
    if (compMatch) {
      const functor = compMatch[1];
      const innerArgs = parseArgList(compMatch[2]);
      return { type: "compound", functor, args: innerArgs };
    }
    return { type: "atom", value: text };
  }
  function clauseEnds(clause) {
    let inQuote = false;
    for (let i = 0; i < clause.length; i++) {
      if (clause[i] === "'" && !inQuote) {
        inQuote = true;
      } else if (clause[i] === "'" && inQuote) {
        if (i + 1 < clause.length && clause[i + 1] === "'") {
          i++;
        } else {
          inQuote = false;
        }
      } else if (clause[i] === "." && !inQuote && (i + 1 >= clause.length || /\s/.test(clause[i + 1]))) {
        return true;
      }
    }
    return false;
  }
  function findRuleOperator(clause) {
    let inQuote = false;
    let depth = 0;
    for (let i = 0; i < clause.length - 1; i++) {
      if (clause[i] === "'" && !inQuote) {
        inQuote = true;
      } else if (clause[i] === "'" && inQuote) {
        if (i + 1 < clause.length && clause[i + 1] === "'") {
          i++;
        } else {
          inQuote = false;
        }
      } else if (!inQuote) {
        if (clause[i] === "(") depth++;
        else if (clause[i] === ")") depth--;
        else if (depth === 0 && clause[i] === ":" && clause[i + 1] === "-") {
          return i;
        }
      }
    }
    return -1;
  }
  function buildContentBlocks(facts, rules, blocks, _source, lines) {
    const groups = /* @__PURE__ */ new Map();
    for (const fact of facts) {
      const entityArg = fact.args[0];
      if (!entityArg) continue;
      const entityAtom = argToString(entityArg);
      if (!groups.has(entityAtom)) {
        groups.set(entityAtom, { predicate: fact.predicate, startLine: fact.line, endLine: fact.line });
      } else {
        const g = groups.get(entityAtom);
        g.endLine = Math.max(g.endLine, fact.line);
      }
    }
    for (const rule of rules) {
      const entityArg = rule.head.args[0];
      if (!entityArg) continue;
      const entityAtom = argToString(entityArg);
      if (!groups.has(entityAtom)) {
        groups.set(entityAtom, { predicate: rule.head.predicate, startLine: rule.line, endLine: rule.line });
      } else {
        const g = groups.get(entityAtom);
        g.endLine = Math.max(g.endLine, rule.line);
      }
    }
    Array.from(groups.entries()).forEach(([entityAtom, group]) => {
      const rawLines = [];
      for (let l = group.startLine - 1; l < group.endLine && l < lines.length; l++) {
        rawLines.push(lines[l]);
      }
      blocks.push({
        primaryPredicate: group.predicate,
        entityAtom,
        raw: rawLines.join("\n"),
        line: group.startLine
      });
    });
  }
  function argToString(arg) {
    switch (arg.type) {
      case "atom":
        return arg.value;
      case "string":
        return arg.value;
      case "number":
        return String(arg.value);
      case "variable":
        return arg.value;
      case "compound":
        return `${arg.functor}(${arg.args.map(argToString).join(", ")})`;
      case "list":
        return `[${arg.elements.map(argToString).join(", ")}]`;
    }
  }

  // @insimul/core/src/radiant/radiant-engine.ts
  async function generateRadiantQuests(kb, opts) {
    const program = Array.isArray(kb) ? kb.join("\n") : kb;
    const maxQuests = opts.maxQuests ?? Number.POSITIVE_INFINITY;
    const templates = parseTemplates(program);
    templates.sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
    const engine = await createPrologEngine();
    try {
      const consulted = await engine.consult(program);
      if (!consulted.success) {
        throw new Error(`radiant: KB consult failed: ${consulted.error}`);
      }
      const quests = [];
      for (const tpl of templates) {
        if (quests.length >= maxQuests) break;
        let excluded = false;
        for (const goal of tpl.exclusions) {
          if (await succeeds(engine, goal)) {
            excluded = true;
            break;
          }
        }
        if (excluded) continue;
        const cooldownUntils = await solveAll(engine, `radiant_cooldown_until(${tpl.id}, T)`);
        const active = cooldownUntils.map((b) => Number(b["T"])).filter((t) => Number.isFinite(t));
        if (active.some((t) => t > opts.now)) continue;
        const candidates = await solveCandidates(engine, tpl);
        if (candidates.length === 0) continue;
        const rng = mulberry32(hashSeed(opts.seed) ^ hashSeed(tpl.id));
        const chosen = candidates[Math.floor(rng() * candidates.length)];
        quests.push(buildQuest(tpl, chosen, opts.now, active));
      }
      return { quests };
    } finally {
      engine.destroy?.();
    }
  }
  function parseTemplates(program) {
    const { facts } = parsePrologFile(program);
    const byId = /* @__PURE__ */ new Map();
    const ensure = (id) => {
      let t = byId.get(id);
      if (!t) {
        t = {
          id,
          meta: { category: "radiant", title: "", questType: "radiant", difficulty: 1 },
          preconditions: [],
          objectives: [],
          rewards: [],
          cooldownSeconds: 0,
          exclusions: []
        };
        byId.set(id, t);
      }
      return t;
    };
    for (const f of facts) {
      const id = firstAtom(f.args[0]);
      if (!id) continue;
      switch (`${f.predicate}/${f.arity}`) {
        case "radiant_template/2":
          ensure(id).meta = parseMeta(f.args[1]);
          break;
        case "radiant_precondition/3": {
          const slot = firstAtom(f.args[1]);
          if (slot) ensure(id).preconditions.push({ slot, goalText: goalText(f.args[2]) });
          break;
        }
        case "radiant_objective/2":
          ensure(id).objectives.push(f.args[1]);
          break;
        case "radiant_reward/3": {
          const kind = firstAtom(f.args[1]);
          if (kind) ensure(id).rewards.push({ kind, amount: f.args[2] });
          break;
        }
        case "radiant_cooldown/2":
          ensure(id).cooldownSeconds = argNum(f.args[1]) ?? 0;
          break;
        case "radiant_exclusion/2":
          ensure(id).exclusions.push(goalText(f.args[1]));
          break;
        default:
          break;
      }
    }
    return Array.from(byId.values()).filter((t) => t.meta.title !== "" || t.objectives.length > 0);
  }
  function parseMeta(arg) {
    const meta = { category: "radiant", title: "", questType: "radiant", difficulty: 1 };
    if (!arg || arg.type !== "list") return meta;
    for (const el of arg.elements) {
      if (el.type !== "compound" || el.args.length !== 1) continue;
      const v = el.args[0];
      switch (el.functor) {
        case "category":
          meta.category = argText(v);
          break;
        case "title":
          meta.title = argText(v);
          break;
        case "quest_type":
          meta.questType = argText(v);
          break;
        case "difficulty":
          meta.difficulty = argNum(v) ?? 1;
          break;
        default:
          break;
      }
    }
    return meta;
  }
  async function solveCandidates(engine, tpl) {
    if (tpl.preconditions.length === 0) return [];
    const goal = tpl.preconditions.map((p) => p.goalText).join(", ");
    const slotVars = tpl.preconditions.map((p) => ({ slot: p.slot, varName: slotVar(p.slot) }));
    const solutions = await solveAll(engine, goal);
    const seen = /* @__PURE__ */ new Set();
    const projected = [];
    for (const sol of solutions) {
      const row = {};
      let complete = true;
      for (const { slot, varName } of slotVars) {
        const raw = sol[varName];
        if (raw === void 0 || raw === null || typeof raw === "boolean") {
          complete = false;
          break;
        }
        row[slot] = raw;
      }
      if (!complete) continue;
      const key = canonKey(row, slotVars.map((s) => s.slot));
      if (seen.has(key)) continue;
      seen.add(key);
      projected.push(row);
    }
    const slots = slotVars.map((s) => s.slot);
    projected.sort((a, b) => canonKey(a, slots) < canonKey(b, slots) ? -1 : 1);
    return projected;
  }
  function canonKey(row, slots) {
    return JSON.stringify(slots.map((s) => [s, typeof row[s], row[s]]));
  }
  function buildQuest(tpl, bindings, now, staleCooldowns) {
    const questId = `radiant_${tpl.id}_${now}`;
    const bindMap = new Map(Object.entries(bindings));
    const lines = [];
    lines.push(
      `quest(${questId}, ${quoteProlog(fillTitle(tpl.meta.title, bindings))}, ${atom(tpl.meta.questType)}, ${tpl.meta.difficulty}, available).`
    );
    tpl.objectives.forEach((obj, i) => {
      lines.push(`quest_objective(${questId}, ${i}, ${argToProlog(substitute(obj, bindMap))}).`);
    });
    for (const reward of tpl.rewards) {
      const amount = evalAmount(reward.amount, tpl, bindMap);
      lines.push(`quest_reward(${questId}, ${atom(reward.kind)}, ${amount}).`);
    }
    const factsToAssert = [`radiant_generated(${questId}, ${tpl.id}, ${now}).`];
    const factsToRetract = [];
    if (tpl.cooldownSeconds > 0) {
      for (const t of staleCooldowns) {
        factsToRetract.push(`radiant_cooldown_until(${tpl.id}, ${t}).`);
      }
      factsToAssert.push(`radiant_cooldown_until(${tpl.id}, ${now + tpl.cooldownSeconds}).`);
    }
    return {
      questId,
      templateId: tpl.id,
      questContent: lines.join("\n"),
      factsToAssert,
      factsToRetract
    };
  }
  function fillTitle(title, bindings) {
    return title.replace(
      /\{(\w+)\}/g,
      (whole, slot) => slot in bindings ? String(bindings[slot]) : whole
    );
  }
  function evalAmount(arg, tpl, bindMap) {
    if (arg.type === "number") return Math.trunc(arg.value);
    if (arg.type === "compound" && arg.functor === "times" && arg.args.length === 2) {
      return Math.trunc(evalFactor(arg.args[0], tpl, bindMap) * evalFactor(arg.args[1], tpl, bindMap));
    }
    if (arg.type === "compound" && arg.functor === "per" && arg.args.length === 2) {
      const slot = argText(arg.args[0]);
      const unit = evalFactor(arg.args[1], tpl, bindMap);
      return Math.trunc(unit * countForSlot(slot, tpl));
    }
    return 0;
  }
  function evalFactor(arg, tpl, bindMap) {
    if (arg.type === "number") return arg.value;
    if (arg.type === "atom") {
      if (arg.value === "difficulty") return tpl.meta.difficulty;
      const n = Number(arg.value);
      return Number.isFinite(n) ? n : 0;
    }
    if (arg.type === "variable") {
      const v = bindMap.get(slotForVar(arg.value));
      const n = Number(v);
      return Number.isFinite(n) ? n : 0;
    }
    return 0;
  }
  function countForSlot(slot, tpl) {
    const v = slotVar(slot);
    for (const obj of tpl.objectives) {
      if (obj.type !== "compound") continue;
      const hasSlot = obj.args.some((a) => a.type === "variable" && a.value === v);
      if (!hasSlot) continue;
      const num = obj.args.find((a) => a.type === "number");
      if (num && num.type === "number") return num.value;
    }
    return 1;
  }
  function substitute(arg, bindMap) {
    switch (arg.type) {
      case "variable": {
        const slot = slotForVar(arg.value);
        const v = bindMap.get(slot);
        if (v === void 0) return arg;
        return typeof v === "number" ? { type: "number", value: v } : { type: "atom", value: v };
      }
      case "compound":
        return { type: "compound", functor: arg.functor, args: arg.args.map((a) => substitute(a, bindMap)) };
      case "list":
        return { type: "list", elements: arg.elements.map((a) => substitute(a, bindMap)) };
      default:
        return arg;
    }
  }
  function argToProlog(arg) {
    switch (arg.type) {
      case "number":
        return String(arg.value);
      case "atom":
      case "string":
        return atom(arg.value);
      case "variable":
        return arg.value;
      case "compound":
        return `${arg.functor}(${arg.args.map(argToProlog).join(", ")})`;
      case "list":
        return `[${arg.elements.map(argToProlog).join(", ")}]`;
    }
  }
  async function succeeds(engine, goal) {
    try {
      const r = await engine.query(goal, 1);
      return r.success && r.bindings.length > 0;
    } catch {
      return false;
    }
  }
  async function solveAll(engine, goal) {
    try {
      const r = await engine.query(goal);
      return r.success ? r.bindings : [];
    } catch {
      return [];
    }
  }
  function slotVar(slot) {
    return slot.charAt(0).toUpperCase() + slot.slice(1);
  }
  function slotForVar(varName) {
    return varName.charAt(0).toLowerCase() + varName.slice(1);
  }
  function firstAtom(arg) {
    if (!arg) return null;
    if (arg.type === "atom") return arg.value;
    if (arg.type === "string") return arg.value;
    return null;
  }
  function argText(arg) {
    if (!arg) return "";
    if (arg.type === "atom" || arg.type === "string") return arg.value;
    if (arg.type === "number") return String(arg.value);
    if (arg.type === "variable") return arg.value;
    return "";
  }
  function argNum(arg) {
    if (arg && arg.type === "number") return arg.value;
    return null;
  }
  function goalText(arg) {
    return argToGoalSource(arg);
  }
  function argToGoalSource(arg) {
    if (!arg) return "fail";
    switch (arg.type) {
      case "atom":
        return arg.value;
      case "string":
        return quoteProlog(arg.value);
      case "number":
        return String(arg.value);
      case "variable":
        return arg.value;
      case "compound":
        return `${arg.functor}(${arg.args.map(argToGoalSource).join(", ")})`;
      case "list":
        return `[${arg.elements.map(argToGoalSource).join(", ")}]`;
    }
  }
  var ATOM_RE = /^[a-z][a-zA-Z0-9_]*$/;
  function atom(s) {
    if (s === "") return quoteProlog("");
    return ATOM_RE.test(s) ? s : quoteProlog(s);
  }
  function quoteProlog(s) {
    return `'${s.replace(/\\/g, "\\\\").replace(/'/g, "\\'")}'`;
  }
  function hashSeed(seed) {
    if (typeof seed === "number") return seed >>> 0;
    let h = 2166136261 >>> 0;
    for (let i = 0; i < seed.length; i++) {
      h ^= seed.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return h >>> 0;
  }
  function mulberry32(seed) {
    let a = seed >>> 0;
    return function() {
      a = a + 1831565813 | 0;
      let t = Math.imul(a ^ a >>> 15, 1 | a);
      t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
      return ((t ^ t >>> 14) >>> 0) / 4294967296;
    };
  }

  // @insimul/core/src/radiant/base-templates.ts
  var BASE_RADIANT_TEMPLATES = `% Insimul base radiant template pack (US-RQ5)
%
% A starter pack of genre-neutral radiant (procedural) quest templates. It uses
% ONLY predicates guaranteed by predicate-schema.ts for any world, so it drops
% into any base world without authoring:
%
%   characters  \u2014 person/1, occupation/2
%   settlements \u2014 settlement/1, settlement_mayor/2
%   items       \u2014 item_category/2
%   businesses  \u2014 business_owner/2
%
% This pack proves the runtime path (plan docs/PLATFORM_SPLIT_AND_ENGINE_PLUGINS.md
% \xA73.3): once radiant generation is Prolog template DATA + the fixed slot-filling
% algorithm (packages/core/src/radiant/radiant-engine.ts), a closed platform
% generator may later EMIT richer, world-specific template packs in this same
% format and every native engine inherits them for free.
%
% Vocabulary reference + fully-worked examples: packages/core/docs/radiant-templates.md
%
% Runtime provenance/cooldown facts are declared dynamic so the pack consults
% into a fresh engine (via GamePrologEngine.initialize's radiantTemplates seam)
% even before any quest has been generated.
:- dynamic(radiant_generated/3).
:- dynamic(radiant_cooldown_until/2).

% \u2500\u2500 1. Fetch \u2014 gather herbs for a herbalist \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
radiant_template(rt_fetch, [category(fetch), title('Gather Herbs for {giver}'), quest_type(gathering), difficulty(1)]).
radiant_precondition(rt_fetch, giver, occupation(Giver, herbalist)).
radiant_precondition(rt_fetch, item, item_category(Item, herb)).
radiant_objective(rt_fetch, collect(Item, 5)).
radiant_objective(rt_fetch, deliver(Item, Giver)).
radiant_reward(rt_fetch, gold, times(15, difficulty)).
radiant_reward(rt_fetch, experience, 20).
radiant_cooldown(rt_fetch, 3600).
radiant_exclusion(rt_fetch, radiant_generated(_, rt_fetch, _)).

% \u2500\u2500 2. Delivery \u2014 carry a trade good between two different residents \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
% Multi-slot join: \`recipient\` is solved after \`giver\` and must be a different
% person (the parenthesised conjunction is a single Goal term).
radiant_template(rt_delivery, [category(delivery), title('Deliver goods to {recipient}'), quest_type(delivery), difficulty(2)]).
radiant_precondition(rt_delivery, giver, business_owner(_Business, Giver)).
radiant_precondition(rt_delivery, item, item_category(Item, trade_good)).
radiant_precondition(rt_delivery, recipient, (person(Recipient), Recipient \\= Giver)).
radiant_objective(rt_delivery, deliver(Item, Recipient)).
radiant_reward(rt_delivery, gold, times(25, difficulty)).
radiant_reward(rt_delivery, experience, 35).
radiant_cooldown(rt_delivery, 1800).
radiant_exclusion(rt_delivery, radiant_generated(_, rt_delivery, _)).

% \u2500\u2500 3. Bounty \u2014 hunt a wanted outlaw for a settlement \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
radiant_template(rt_bounty, [category(bounty), title('Bounty: {target}'), quest_type(combat), difficulty(3)]).
radiant_precondition(rt_bounty, poster, settlement_mayor(_Settlement, Poster)).
radiant_precondition(rt_bounty, target, occupation(Target, outlaw)).
radiant_objective(rt_bounty, defeat(Target, 1)).
radiant_reward(rt_bounty, gold, times(50, difficulty)).
radiant_reward(rt_bounty, reputation, times(5, difficulty)).
radiant_cooldown(rt_bounty, 7200).
radiant_exclusion(rt_bounty, radiant_generated(_, rt_bounty, _)).

% \u2500\u2500 4. Escort-lite \u2014 meet a traveller and see them to a settlement \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
% "Escort-lite": no live escort AI, just talk to the traveller then reach the
% destination \u2014 expressible with the guaranteed talk_to/visit_location goals.
radiant_template(rt_escort, [category(escort), title('See {traveller} to {destination}'), quest_type(escort), difficulty(2)]).
radiant_precondition(rt_escort, traveller, occupation(Traveller, traveller)).
radiant_precondition(rt_escort, destination, settlement(Destination)).
radiant_objective(rt_escort, talk_to(Traveller)).
radiant_objective(rt_escort, visit_location(Destination)).
radiant_reward(rt_escort, gold, times(30, difficulty)).
radiant_reward(rt_escort, experience, 30).
radiant_cooldown(rt_escort, 3600).
radiant_exclusion(rt_escort, radiant_generated(_, rt_escort, _)).

% \u2500\u2500 5. Gather \u2014 collect a stock of ore for a blacksmith \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
% \`per(item, N)\` scales the gold by the objective's collect count (10).
radiant_template(rt_gather, [category(gather), title('Supply {giver} with ore'), quest_type(gathering), difficulty(2)]).
radiant_precondition(rt_gather, giver, occupation(Giver, blacksmith)).
radiant_precondition(rt_gather, item, item_category(Item, ore)).
radiant_objective(rt_gather, collect(Item, 10)).
radiant_objective(rt_gather, deliver(Item, Giver)).
radiant_reward(rt_gather, gold, per(item, 4)).
radiant_reward(rt_gather, experience, 40).
radiant_cooldown(rt_gather, 5400).
radiant_exclusion(rt_gather, radiant_generated(_, rt_gather, _)).

% \u2500\u2500 6. Visit \u2014 scout a settlement \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
radiant_template(rt_visit, [category(visit), title('Scout {destination}'), quest_type(exploration), difficulty(1)]).
radiant_precondition(rt_visit, destination, settlement(Destination)).
radiant_objective(rt_visit, visit_location(Destination)).
radiant_reward(rt_visit, gold, times(10, difficulty)).
radiant_reward(rt_visit, experience, 15).
radiant_cooldown(rt_visit, 2400).
radiant_exclusion(rt_visit, radiant_generated(_, rt_visit, _)).
`;
  var BASE_RADIANT_TEMPLATE_IDS = [
    "rt_fetch",
    "rt_delivery",
    "rt_bounty",
    "rt_escort",
    "rt_gather",
    "rt_visit"
  ];

  // @insimul/core/src/prolog/quest-hydrator.ts
  function hydrateQuestFromProlog(quest) {
    const content = quest?.content;
    if (!content || typeof content !== "string") return quest;
    const main = parseQuestFact(content);
    if (main) {
      quest.title = main.title;
      quest.questType = main.questType;
      quest.difficulty = main.difficulty;
      if (!quest.status) {
        quest.status = main.status;
      } else if (quest.status === "unavailable" && main.status === "available") {
        const prereqs2 = parsePrerequisites(content);
        const hasNoPrereqs = prereqs2.length === 0 || prereqs2.length === 1 && prereqs2[0] === "none";
        if (hasNoPrereqs) {
          quest.status = "available";
        }
      }
    }
    const objectives = parseObjectives(content);
    if (objectives.length > 0) {
      const targetLang = parseAtomFact(content, "quest_language");
      if (targetLang) {
        for (const obj of objectives) {
          if (obj.assessmentPhaseId && obj.description) {
            obj.description = enrichAssessmentDescription(obj.description, targetLang);
          }
        }
      }
      const existingObjs = Array.isArray(quest.objectives) ? quest.objectives : [];
      quest.objectives = objectives.map((obj) => {
        const existing = existingObjs.find((e) => e.id === obj.id);
        if (existing) {
          return {
            ...obj,
            completed: existing.completed ?? obj.completed,
            currentCount: existing.currentCount ?? obj.currentCount,
            current: existing.current ?? existing.currentCount ?? obj.currentCount
          };
        }
        return obj;
      });
    }
    quest.assignedTo = parseStringFact(content, "quest_assigned_to") ?? quest.assignedTo;
    quest.assignedBy = parseStringFact(content, "quest_assigned_by") ?? quest.assignedBy;
    quest.targetLanguage = parseAtomFact(content, "quest_language") ?? quest.targetLanguage;
    quest.questChainId = parseAtomFact(content, "quest_chain") ?? quest.questChainId ?? null;
    quest.parentQuestId = parseAtomFact(content, "quest_parent") ?? quest.parentQuestId ?? null;
    const chainOrder = parseNumberFact(content, "quest_chain_order");
    if (chainOrder !== null) quest.questChainOrder = chainOrder;
    const location = parseAtomOrStringFact(content, "quest_location");
    if (location && location !== "anywhere") {
      quest.locationName = quest.locationName || location;
    }
    const discoveryMethod = parseAtomFact(content, "quest_discovery");
    if (discoveryMethod) quest.discoveryMethod = discoveryMethod;
    const noticeText = parseStringFact(content, "quest_notice_text");
    if (noticeText) quest.noticeText = noticeText;
    const cefrLevel = parseAtomFact(content, "quest_cefr_level");
    if (cefrLevel) quest.cefrLevel = cefrLevel;
    const tags = parseAllAtomFacts(content, "quest_tag");
    if (tags.length > 0) quest.tags = tags;
    const rewards = parseRewards(content);
    if (rewards.experience) {
      quest.experienceReward = rewards.experience;
      delete rewards.experience;
    }
    if (Object.keys(rewards).length > 0) {
      quest.rewards = { ...quest.rewards, ...rewards };
    }
    const itemRewards = parseItemRewards(content);
    if (itemRewards.length > 0) quest.itemRewards = itemRewards;
    const skillRewards = parseSkillRewards(content);
    if (skillRewards.length > 0) quest.skillRewards = skillRewards;
    const unlocks = parseUnlocks(content);
    if (unlocks.length > 0) quest.unlocks = unlocks;
    const prereqs = parsePrerequisites(content);
    if (prereqs.length > 0 && !(prereqs.length === 1 && prereqs[0] === "none")) {
      quest.prerequisiteQuestIds = prereqs;
    }
    const activates = parseAllAtomFacts(content, "quest_activates");
    if (activates.length > 0) quest.activatesQuestIds = activates;
    const completionCriteria = parseCompletionCriteria(content);
    if (completionCriteria) quest.completionCriteria = completionCriteria;
    const failureConditions = parseFailureConditions(content);
    if (failureConditions) quest.failureConditions = failureConditions;
    return quest;
  }
  function parseQuestFact(content) {
    const m = content.match(/quest\(\s*\w+\s*,\s*'((?:[^'\\]|\\.)*)'\s*,\s*(\w+)\s*,\s*(\w+)\s*,\s*(\w+)\s*\)/);
    if (!m) return null;
    return { title: unescape(m[1]), questType: m[2], difficulty: m[3], status: m[4] };
  }
  function unescape(s) {
    return s.replace(/\\'/g, "'").replace(/\\\\/g, "\\");
  }
  function capitalize(s) {
    return s.charAt(0).toUpperCase() + s.slice(1);
  }
  function formatCountDescription(template, count) {
    const withCount = template.replace("{n}", String(count));
    if (count === 1) {
      return withCount.replace(/\(s\)/g, "").replace(/\(ies\)/g, "y");
    }
    return withCount.replace(/\(s\)/g, "s").replace(/\(ies\)/g, "ies");
  }
  function enrichAssessmentDescription(description, language) {
    const langCapitalized = capitalize(language);
    if (description.toLowerCase().includes(language.toLowerCase())) return description;
    const parenMatch = description.match(/^(.*?)(\s*\(.*\))$/);
    if (parenMatch) {
      return `${parenMatch[1]} in ${langCapitalized}${parenMatch[2]}`;
    }
    return `${description} in ${langCapitalized}`;
  }
  function buildExplicitDescription(phaseType, count, minWordCount) {
    if (phaseType.includes("initiate_conversation")) {
      return "Initiate a conversation with the marked NPC";
    }
    if (phaseType.includes("conversation")) {
      const turns = Math.max(count, 4);
      return `Complete the conversation exercise (at least ${turns} exchanges)`;
    }
    if (phaseType.includes("writing")) {
      const words = minWordCount || 20;
      return `Complete the writing exercise (at least ${words} words)`;
    }
    if (phaseType.includes("reading")) {
      return "Complete the reading comprehension exercise";
    }
    if (phaseType.includes("listening")) {
      return "Complete the listening comprehension exercise";
    }
    return capitalize(phaseType.replace(/_/g, " "));
  }
  function goalToDescription(functor, args) {
    const labels = {
      visit_location: "Visit",
      discover_location: "Discover",
      talk_to: "Talk to",
      collect: "Collect",
      defeat: "Defeat",
      deliver: "Deliver to",
      use_item: "Use",
      craft_item: "Craft",
      escort: "Escort",
      solve_puzzle: "Solve",
      gain_reputation: "Gain reputation with",
      reach_level: "Reach level",
      give_gift: "Give a gift to",
      equip_item: "Equip",
      drop_item: "Drop",
      accept_quest: "Accept quest",
      read_text: "Read",
      find_text: "Find texts",
      photograph: "Photograph"
    };
    const label = labels[functor] || capitalize(functor.replace(/_/g, " "));
    if (args.length === 0) return label;
    const mainArg = args[0] === "any" ? "" : ` ${args[0]}`;
    if (args.length > 1 && /^\d+$/.test(args[1])) {
      const count = parseInt(args[1]);
      if (count > 1) {
        if (functor === "collect") return `Collect ${count} ${args[0]}`;
        if (functor === "defeat") return `Defeat ${count} ${args[0]}`;
        if (functor === "craft_item") return `Craft ${count} ${args[0]}`;
        if (functor === "gain_reputation") return `Gain ${count} reputation with ${args[0]}`;
        if (functor === "photograph") return `Photograph ${count} ${args[0]}`;
        return `${label}${mainArg} (${count})`;
      }
    }
    return `${label}${mainArg}`.trim();
  }
  function unescapeObj(obj) {
    for (const key of Object.keys(obj)) {
      if (typeof obj[key] === "string") obj[key] = unescape(obj[key]);
    }
    return obj;
  }
  function parseObjectives(content) {
    const objectives = [];
    const pattern = /quest_objective\(\s*\w+\s*,\s*(\d+)\s*,\s*(.*)\)\s*\./g;
    let match;
    while ((match = pattern.exec(content)) !== null) {
      const index = parseInt(match[1]);
      const goalStr = match[2].trim();
      const parsed = parseObjectiveGoal(goalStr);
      if (parsed) {
        objectives.push({
          id: `obj_${index}`,
          ...unescapeObj(parsed),
          completed: false,
          currentCount: 0,
          current: 0
        });
      }
    }
    const descPattern = /% Objective (\d+):\s*(.*)/g;
    let descMatch;
    while ((descMatch = descPattern.exec(content)) !== null) {
      const idx = parseInt(descMatch[1]);
      const obj = objectives.find((o) => o.id === `obj_${idx}`);
      if (obj && !obj.description) {
        obj.description = descMatch[2].trim();
      }
    }
    const locPattern = /quest_objective_location\(\s*\w+\s*,\s*(\d+)\s*,\s*(.*)\)\s*\./g;
    let locMatch;
    while ((locMatch = locPattern.exec(content)) !== null) {
      const idx = parseInt(locMatch[1]);
      const locAtom = locMatch[2].trim().replace(/^'|'$/g, "");
      const obj = objectives.find((o) => o.id === `obj_${idx}`);
      if (obj) {
        obj.objectiveLocation = locAtom;
        const innerMatch = locAtom.match(/^(location|npc)\(\s*'((?:[^'\\]|\\.)*)'\s*\)$/);
        if (innerMatch) {
          const locType = innerMatch[1];
          const name = innerMatch[2].replace(/\\'/g, "'");
          if (locType === "location") {
            obj.locationName = name;
          } else if (locType === "npc") {
            if (!obj.npcName) obj.npcName = name;
            if (!obj.npcId) obj.npcId = name;
          }
        }
      }
    }
    const detailsPattern = /quest_objective_details\(\s*\w+\s*,\s*(\d+)\s*,\s*'((?:[^'\\]|\\.)*)'\s*\)\s*\./g;
    let detailsMatch;
    while ((detailsMatch = detailsPattern.exec(content)) !== null) {
      const idx = parseInt(detailsMatch[1]);
      const details = detailsMatch[2].replace(/\\'/g, "'").replace(/\\\\/g, "\\");
      const obj = objectives.find((o) => o.id === `obj_${idx}`);
      if (obj) {
        obj.details = details;
      }
    }
    return objectives;
  }
  function parseObjectiveGoal(goal) {
    const functorMatch = goal.match(/^(\w+)\(/);
    if (!functorMatch) {
      if (goal.trim() === "introduce_self") return { type: "introduce_self", description: "Introduce yourself", requiredCount: 1, required: 1 };
      if (goal.trim() === "complete_assessment") return { type: "complete_assessment", description: "Complete the assessment", requiredCount: 1, required: 1 };
      return null;
    }
    const functor = functorMatch[1];
    const argsStr = goal.slice(functor.length + 1, -1).trim();
    const args = [];
    let i = 0;
    while (i < argsStr.length) {
      if (argsStr[i] === " " || argsStr[i] === ",") {
        i++;
        continue;
      }
      if (argsStr[i] === "'") {
        let val = "";
        i++;
        while (i < argsStr.length) {
          if (argsStr[i] === "\\" && i + 1 < argsStr.length) {
            val += argsStr[i + 1];
            i += 2;
          } else if (argsStr[i] === "'") {
            i++;
            break;
          } else {
            val += argsStr[i];
            i++;
          }
        }
        args.push(val);
      } else if (argsStr[i] === "[") {
        const end = argsStr.indexOf("]", i);
        args.push(argsStr.slice(i, end + 1));
        i = end + 1;
      } else {
        let val = "";
        while (i < argsStr.length && argsStr[i] !== "," && argsStr[i] !== ")") {
          val += argsStr[i];
          i++;
        }
        args.push(val.trim());
      }
    }
    const twoArgGoals = {
      collect: "collect_item",
      defeat: "defeat_enemies",
      craft_item: "craft_item",
      gain_reputation: "gain_reputation",
      reach_level: "reach_level",
      photograph: "photograph_subject",
      physical_action: "physical_action",
      practice_grammar: "grammar_pattern"
    };
    if (twoArgGoals[functor] && args.length >= 2) {
      const target = args[0];
      const count = parseInt(args[1]) || 1;
      return { type: twoArgGoals[functor], description: goalToDescription(functor, args), target, requiredCount: count, required: count };
    }
    const singleArgGoals = {
      visit_location: "visit_location",
      discover_location: "discover_location",
      talk_to: "talk_to_npc",
      solve_puzzle: "solve_puzzle",
      use_item: "use_item",
      equip_item: "equip_item",
      drop_item: "drop_item",
      give_gift: "give_gift",
      read_text: "read_text",
      accept_quest: "accept_quest",
      escort: "escort_npc"
    };
    if (singleArgGoals[functor] && args.length >= 1) {
      const target = args[0];
      const count = args.length >= 2 ? parseInt(args[1]) || 1 : 1;
      let desc = goalToDescription(functor, args);
      if (functor === "talk_to" && count > 1) {
        desc = `Talk to ${target} (at least ${count} turns)`;
      }
      const result = { type: singleArgGoals[functor], description: desc, target, requiredCount: count, required: count };
      if (functor === "talk_to") result.npcId = target;
      return result;
    }
    if (functor === "deliver" && args.length >= 2) {
      return { type: "deliver_item", description: `Deliver ${args[0]} to ${args[1]}`, target: args[1], item: args[0], requiredCount: 1, required: 1 };
    }
    const countGoals = {
      conversation_turns: "Complete {n} conversation turn(s)",
      examine_object: "Examine {n} object(s)",
      read_sign: "Read {n} sign(s)",
      write_response: "Write {n} response(s)",
      listen_and_repeat: "Listen and repeat {n} phrase(s)",
      pronunciation_check: "Complete {n} pronunciation check(s)",
      identify_object: "Identify {n} object(s)",
      order_food: "Order {n} food item(s)",
      haggle_price: "Haggle {n} price(s)",
      buy_item: "Buy {n} item(s)",
      sell_item: "Sell {n} item(s)",
      ask_for_directions: "Ask for directions {n} time(s)",
      comprehension_quiz: "Answer {n} quiz question(s) correctly",
      translation_challenge: "Complete {n} translation(s) correctly",
      follow_directions: "Follow {n} direction(s)",
      listening_comprehension: "Answer {n} listening question(s) correctly",
      collect_vocabulary: "Collect {n} vocabulary word(s)",
      collect_clue: "Collect {n} clue(s)",
      vocabulary_activities: "Complete {n} vocabulary activit(ies)",
      conversation_activities: "Complete {n} conversation activit(ies)",
      grammar_activities: "Demonstrate {n} grammar pattern(s)",
      sustained_conversation: "Sustain a conversation for {n} turn(s)",
      master_words: "Master {n} vocabulary word(s)",
      learn_new_words: "Learn {n} new word(s)",
      find_vocabulary_items: "Find {n} vocabulary item(s)",
      find_text: "Find {n} text(s)",
      combat_action: "Perform {n} combat action(s)",
      observe_activity: "Observe {n} activit(ies)",
      build_friendship: "Build friendship (reach {n} strength)",
      learn_words_count: "Learn {n} vocabulary word(s)",
      survive: "Survive for {n} second(s)",
      visit_location: "Visit {n} location(s)"
    };
    if (countGoals[functor] && args.length >= 1 && /^\d+(\.\d+)?$/.test(args[0])) {
      const count = functor === "build_friendship" ? parseFloat(args[0]) : parseInt(args[0]);
      const result = { type: functor, description: formatCountDescription(countGoals[functor], count), requiredCount: count, required: count };
      if (functor === "observe_activity" && args.length >= 2) {
        result.observeDurationRequired = parseInt(args[1]) || 5;
      }
      if (functor === "build_friendship") {
        result.requiredStrength = count;
        result.requiredCount = 1;
        result.required = 1;
      }
      return result;
    }
    if (functor === "learn_words" && args.length === 1 && args[0].startsWith("[")) {
      const words = args[0].slice(1, -1).split(",").map((w) => w.trim().replace(/'/g, ""));
      return { type: "use_vocabulary", description: `Learn words: ${words.join(", ")}`, targetWords: words, requiredCount: words.length, required: words.length };
    }
    if (functor === "assessment_phase" && args.length >= 2) {
      const count = args.length >= 3 ? parseInt(args[2]) || 1 : 1;
      const minWordCount = args.length >= 4 ? parseInt(args[3]) || void 0 : void 0;
      const phaseType = args[0];
      const desc = buildExplicitDescription(phaseType, count, minWordCount);
      const result = {
        type: phaseType,
        description: desc,
        assessmentPhaseId: phaseType,
        completionTrigger: args[1],
        requiredCount: count,
        required: count
      };
      if (minWordCount) result.minWordCount = minWordCount;
      return result;
    }
    if (functor === "objective" && args.length >= 1) {
      let desc = args[0];
      const stripped = desc.replace(/[Oo]bjective\(\s*'?/g, "").replace(/'?\s*\)(?:\s*'\s*\))*\s*$/g, "").replace(/^'+|'+$/g, "").trim();
      const buriedTerm = stripped.match(/^(visit[\s_]location|discover[\s_]location|talk[\s_]to|collect|deliver|escort)\s*\(\s*'?/i);
      if (buriedTerm) {
        const funcName = buriedTerm[1].replace(/\s/g, "_").toLowerCase();
        const afterParen = stripped.slice(buriedTerm[0].length);
        const targetName = afterParen.replace(/[')\s]+$/g, "").trim();
        if (targetName) {
          return { type: funcName, description: goalToDescription(funcName, [targetName]), target: targetName, requiredCount: 1, required: 1 };
        }
      }
      return { type: "objective", description: capitalize(desc), requiredCount: 1, required: 1 };
    }
    return { type: functor || "custom", description: capitalize(goal.replace(/_/g, " ").replace(/'/g, "").replace(/\(.*\)/, "").trim()), requiredCount: 1, required: 1 };
  }
  function parseStringFact(content, predicate) {
    const m = content.match(new RegExp(`${predicate}\\(\\s*\\w+\\s*,\\s*'((?:[^'\\\\]|\\\\.)*)'\\s*\\)`));
    return m ? unescape(m[1]) : null;
  }
  function parseAtomFact(content, predicate) {
    const m = content.match(new RegExp(`${predicate}\\(\\s*\\w+\\s*,\\s*(\\w+)\\s*\\)`));
    return m ? m[1] : null;
  }
  function parseAtomOrStringFact(content, predicate) {
    return parseStringFact(content, predicate) ?? parseAtomFact(content, predicate);
  }
  function parseNumberFact(content, predicate) {
    const m = content.match(new RegExp(`${predicate}\\(\\s*\\w+\\s*,\\s*(\\d+(?:\\.\\d+)?)\\s*\\)`));
    return m ? parseFloat(m[1]) : null;
  }
  function parseAllAtomFacts(content, predicate) {
    const results = [];
    const pattern = new RegExp(`${predicate}\\(\\s*\\w+\\s*,\\s*(\\w+)\\s*\\)`, "g");
    let m;
    while ((m = pattern.exec(content)) !== null) {
      results.push(m[1]);
    }
    return results;
  }
  function parseRewards(content) {
    const rewards = {};
    const pattern = /quest_reward\(\s*\w+\s*,\s*(\w+)\s*,\s*(\d+(?:\.\d+)?)\s*\)/g;
    let m;
    while ((m = pattern.exec(content)) !== null) {
      rewards[m[1]] = parseFloat(m[2]);
    }
    return rewards;
  }
  function parseItemRewards(content) {
    const items = [];
    const pattern = /quest_item_reward\(\s*\w+\s*,\s*(?:'((?:[^'\\\\]|\\\\.)*)'|(\w+))\s*,\s*(\d+)\s*\)/g;
    let m;
    while ((m = pattern.exec(content)) !== null) {
      items.push({ itemName: m[1] || m[2], quantity: parseInt(m[3]) });
    }
    return items;
  }
  function parseSkillRewards(content) {
    const skills = [];
    const pattern = /quest_skill_reward\(\s*\w+\s*,\s*(?:'((?:[^'\\\\]|\\\\.)*)'|(\w+))\s*,\s*(\d+)\s*\)/g;
    let m;
    while ((m = pattern.exec(content)) !== null) {
      skills.push({ skillName: m[1] || m[2], level: parseInt(m[3]) });
    }
    return skills;
  }
  function parseUnlocks(content) {
    const unlocks = [];
    const pattern = /quest_unlock\(\s*\w+\s*,\s*(\w+)\s*,\s*(?:'((?:[^'\\\\]|\\\\.)*)'|(\w+))\s*\)/g;
    let m;
    while ((m = pattern.exec(content)) !== null) {
      unlocks.push({ type: m[1], name: m[2] || m[3] });
    }
    return unlocks;
  }
  function parsePrerequisites(content) {
    const prereqs = [];
    const pattern = /quest_prerequisite\(\s*\w+\s*,\s*(\w+)\s*\)/g;
    let m;
    while ((m = pattern.exec(content)) !== null) {
      if (m[1] !== "none") prereqs.push(m[1]);
    }
    return prereqs;
  }
  function parseCompletionCriteria(content) {
    const m = content.match(/quest_completion\(\s*\w+\s*,\s*(.*?)\)\s*\./);
    if (!m) return null;
    const goal = m[1].trim();
    if (goal === "all_objectives_complete") {
      return { type: "all_objectives", description: "Complete all objectives" };
    }
    const vocabMatch = goal.match(/^vocabulary_usage\(\s*\[(.*?)\]\s*,\s*(\d+)\s*\)$/);
    if (vocabMatch) {
      const words = vocabMatch[1].split(",").map((w) => w.trim().replace(/'/g, ""));
      return { type: "vocabulary_usage", requiredWords: words, requiredCount: parseInt(vocabMatch[2]) };
    }
    const vocabCountMatch = goal.match(/^vocabulary_count\(\s*(\d+)\s*\)$/);
    if (vocabCountMatch) {
      return { type: "vocabulary_usage", requiredCount: parseInt(vocabCountMatch[1]) };
    }
    const convMatch = goal.match(/^conversation_turns\(\s*(\d+)\s*\)$/);
    if (convMatch) {
      return { type: "conversation_turns", requiredTurns: parseInt(convMatch[1]) };
    }
    return { type: "all_objectives", description: "Complete all objectives" };
  }
  function parseFailureConditions(content) {
    const m = content.match(/quest_failure_condition\(\s*\w+\s*,\s*(.*?)\)\s*\./);
    if (!m) return null;
    const goal = m[1].trim();
    if (goal === "timeout") return { type: "timeout" };
    if (goal === "player_death") return { type: "player_death" };
    const repMatch = goal.match(/^reputation_below\(\s*(\d+)\s*\)$/);
    if (repMatch) return { type: "reputation_below", threshold: parseInt(repMatch[1]) };
    return { type: "custom", description: goal };
  }

  // @insimul/core/scripts/quest-golden-manifest.ts
  function projectHydratedQuest(q) {
    const out = {};
    const put = (k, v) => {
      if (v !== void 0 && v !== null) out[k] = v;
    };
    put("title", q.title);
    put("questType", q.questType);
    put("difficulty", q.difficulty);
    put("status", q.status);
    put("targetLanguage", q.targetLanguage);
    put("assignedTo", q.assignedTo);
    put("assignedBy", q.assignedBy);
    put("experienceReward", q.experienceReward);
    if (Array.isArray(q.tags) && q.tags.length > 0) out.tags = q.tags;
    if (Array.isArray(q.prerequisiteQuestIds) && q.prerequisiteQuestIds.length > 0) {
      out.prerequisiteQuestIds = q.prerequisiteQuestIds;
    }
    if (q.completionCriteria) out.completionCriteria = q.completionCriteria;
    if (Array.isArray(q.objectives) && q.objectives.length > 0) {
      out.objectives = q.objectives.map((o) => {
        const obj = {
          id: o.id,
          type: o.type,
          description: o.description,
          requiredCount: o.requiredCount
        };
        if (o.target !== void 0 && o.target !== null) obj.target = o.target;
        if (o.npcId !== void 0 && o.npcId !== null) obj.npcId = o.npcId;
        return obj;
      });
    }
    return out;
  }
  function computeHydrationExpected(input) {
    const seed = { content: input.content };
    if (input.status !== void 0) seed.status = input.status;
    return projectHydratedQuest(hydrateQuestFromProlog(seed));
  }
  function radiantTick(params) {
    const { quests, maxOffering, ticks } = params;
    const offered = /* @__PURE__ */ new Set();
    const facts = [];
    for (let t = 0; t < ticks; t++) {
      const candidates = quests.filter(
        (q) => Array.isArray(q.tags) && q.tags.includes("radiant") && q.status === "available" && !offered.has(q.id)
      ).map((q) => q.id).sort();
      for (const id of candidates.slice(0, Math.max(0, maxOffering))) {
        offered.add(id);
        facts.push({ predicate: "quest_offered", args: [id, t] });
      }
    }
    return facts;
  }

  // corebridge/js/entry.js
  var METHODS = {
    /**
     * `radiant.generate` — the first adopted slice (RUNTIME_CORE_ADOPTION.md §5).
     * args: `{ kb: string | string[], options: { seed, now, maxQuests? } }`
     * result: `{ quests: GeneratedRadiantQuest[] }`
     */
    "radiant.generate": (args) => generateRadiantQuests(args.kb, args.options),
    /**
     * `radiant.baseTemplates` — core's shipped template pack, so a game does not
     * have to vendor a copy of it to generate anything.
     */
    "radiant.baseTemplates": () => ({
      templates: BASE_RADIANT_TEMPLATES,
      templateIds: BASE_RADIANT_TEMPLATE_IDS
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
    "quest.hydrate": (args) => ({
      quest: computeHydrationExpected({
        content: args.content,
        ...args.status ? { status: args.status } : {}
      })
    }),
    /**
     * `quest.radiantTick` — core's deterministic radiant distributor.
     * args: `{ quests: [{id, tags, status}], maxOffering: number, ticks: number }`
     * result: `{ facts: [{predicate, args}] }` (an order-independent multiset)
     */
    "quest.radiantTick": (args) => ({
      facts: radiantTick({
        quests: args.quests || [],
        maxOffering: args.maxOffering,
        ticks: args.ticks
      })
    }),
    /** `core.methods` — introspection; lets a gate assert the adopted surface. */
    "core.methods": () => ({ methods: Object.keys(METHODS).sort() })
  };
  globalThis.__insimul_core_dispatch = function(method, argsJson) {
    const fn = METHODS[method];
    if (!fn) {
      return Promise.reject(new Error(`insimulcore: unknown method "${method}"`));
    }
    return Promise.resolve().then(() => fn(argsJson ? JSON.parse(argsJson) : {}));
  };
})();
