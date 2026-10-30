(() => {
  var __defProp = Object.defineProperty;
  var __defNormalProp = (obj3, key, value) => key in obj3 ? __defProp(obj3, key, { enumerable: true, configurable: true, writable: true, value }) : obj3[key] = value;
  var __publicField = (obj3, key, value) => __defNormalProp(obj3, typeof key !== "symbol" ? key + "" : key, value);

  // corebridge/js/host-text-codec.js
  var REPLACEMENT = 65533;
  var PolyfillTextEncoder = class {
    get encoding() {
      return "utf-8";
    }
    /** @param {string} input @returns {Uint8Array} */
    encode(input = "") {
      const str3 = String(input);
      const bytes = [];
      for (let i = 0; i < str3.length; i++) {
        let code = str3.charCodeAt(i);
        if (code >= 55296 && code <= 56319) {
          const next = i + 1 < str3.length ? str3.charCodeAt(i + 1) : 0;
          if (next >= 56320 && next <= 57343) {
            code = 65536 + (code - 55296 << 10) + (next - 56320);
            i++;
          } else {
            code = REPLACEMENT;
          }
        } else if (code >= 56320 && code <= 57343) {
          code = REPLACEMENT;
        }
        if (code < 128) {
          bytes.push(code);
        } else if (code < 2048) {
          bytes.push(192 | code >> 6, 128 | code & 63);
        } else if (code < 65536) {
          bytes.push(224 | code >> 12, 128 | code >> 6 & 63, 128 | code & 63);
        } else {
          bytes.push(
            240 | code >> 18,
            128 | code >> 12 & 63,
            128 | code >> 6 & 63,
            128 | code & 63
          );
        }
      }
      return new Uint8Array(bytes);
    }
  };
  var PolyfillTextDecoder = class {
    constructor(label = "utf-8") {
      const normalized = String(label).toLowerCase();
      if (normalized !== "utf-8" && normalized !== "utf8" && normalized !== "unicode-1-1-utf-8") {
        throw new RangeError(`insimulcore: TextDecoder supports utf-8 only, not "${label}"`);
      }
    }
    get encoding() {
      return "utf-8";
    }
    /** @param {Uint8Array | ArrayBuffer} input @returns {string} */
    decode(input) {
      if (input === void 0 || input === null) return "";
      const bytes = input instanceof Uint8Array ? input : new Uint8Array(input.buffer !== void 0 ? input.buffer : input);
      let out = "";
      for (let i = 0; i < bytes.length; ) {
        const byte = bytes[i];
        let code;
        let width;
        if (byte < 128) {
          code = byte;
          width = 1;
        } else if ((byte & 224) === 192) {
          code = byte & 31;
          width = 2;
        } else if ((byte & 240) === 224) {
          code = byte & 15;
          width = 3;
        } else if ((byte & 248) === 240) {
          code = byte & 7;
          width = 4;
        } else {
          out += String.fromCharCode(REPLACEMENT);
          i++;
          continue;
        }
        if (i + width > bytes.length) {
          out += String.fromCharCode(REPLACEMENT);
          break;
        }
        let malformed = false;
        for (let k = 1; k < width; k++) {
          const cont = bytes[i + k];
          if ((cont & 192) !== 128) {
            malformed = true;
            break;
          }
          code = code << 6 | cont & 63;
        }
        if (malformed || code > 1114111 || code >= 55296 && code <= 57343 || width === 2 && code < 128 || width === 3 && code < 2048 || width === 4 && code < 65536) {
          out += String.fromCharCode(REPLACEMENT);
          i++;
          continue;
        }
        if (code < 65536) {
          out += String.fromCharCode(code);
        } else {
          const astral = code - 65536;
          out += String.fromCharCode(55296 + (astral >> 10), 56320 + (astral & 1023));
        }
        i += width;
      }
      return out;
    }
  };
  if (typeof globalThis.TextEncoder === "undefined") globalThis.TextEncoder = PolyfillTextEncoder;
  if (typeof globalThis.TextDecoder === "undefined") globalThis.TextDecoder = PolyfillTextDecoder;

  // corebridge/js/host-console.js
  var MAX_DIAGNOSTICS = 200;
  var lines = [];
  var dropped = 0;
  function render(value) {
    if (typeof value === "string") return value;
    if (value instanceof Error) return `${value.name}: ${value.message}`;
    try {
      const text2 = JSON.stringify(value);
      return text2 === void 0 ? String(value) : text2;
    } catch {
      return String(value);
    }
  }
  function recorder(level) {
    return (...values) => {
      if (lines.length >= MAX_DIAGNOSTICS) {
        dropped += 1;
        return;
      }
      lines.push({ level, text: values.map(render).join(" ") });
    };
  }
  function clearDiagnostics() {
    lines = [];
    dropped = 0;
  }
  function diagnostics() {
    return { lines: lines.map((l) => ({ ...l })), dropped };
  }
  globalThis.console = {
    log: recorder("log"),
    info: recorder("info"),
    debug: recorder("debug"),
    warn: recorder("warn"),
    error: recorder("error"),
    trace: recorder("trace")
  };

  // corebridge/js/host-sessions.js
  var SESSIONS = /* @__PURE__ */ new Map();
  var nextHandle = 1;
  function openSession(kind, state) {
    const handle = nextHandle++;
    SESSIONS.set(handle, { kind, ...state });
    return handle;
  }
  function session(method, args, kind) {
    const handle = args ? args.session : void 0;
    const found = SESSIONS.get(handle);
    if (!found) {
      throw new Error(`insimulcore: ${method}: no open session ${JSON.stringify(handle ?? null)}`);
    }
    if (found.kind !== kind) {
      throw new Error(`insimulcore: ${method}: session ${handle} is a ${found.kind} session, not ${kind}`);
    }
    return found;
  }
  function disposeSession(handle) {
    return SESSIONS.delete(handle);
  }
  function listSessions() {
    return [...SESSIONS.entries()].sort((a, b) => a[0] - b[0]).map(([handle, s]) => ({ session: handle, kind: s.kind }));
  }
  async function applyOps(method, s, args, table) {
    const ops = args.ops;
    if (!Array.isArray(ops)) throw new Error(`insimulcore: ${method}: \`ops\` must be an array of { op, \u2026 }`);
    const results = [];
    for (let i = 0; i < ops.length; i++) {
      const op = ops[i];
      const name = op && typeof op === "object" ? op.op : void 0;
      const fn = typeof name === "string" && Object.prototype.hasOwnProperty.call(table, name) ? table[name] : null;
      if (!fn) {
        throw new Error(
          `insimulcore: ${method}: ops[${i}] has no known op ${JSON.stringify(name ?? null)} (known: ${Object.keys(table).join(", ")})`
        );
      }
      try {
        const result = await fn(s, op);
        results.push(result === void 0 ? null : result);
      } catch (err) {
        const msg = err && err.message ? err.message : String(err);
        const wrapped = new Error(`insimulcore: ${method}: ops[${i}] (${name}) failed: ${msg}`);
        if (err && typeof err.code === "string") wrapped.code = err.code;
        throw wrapped;
      }
    }
    return results;
  }

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
    const lines2 = source.split("\n");
    let i = 0;
    while (i < lines2.length) {
      const line = lines2[i].trim();
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
      while (!clauseEnds(clause) && i + 1 < lines2.length) {
        i++;
        const nextLine = lines2[i].trim();
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
    buildContentBlocks(facts, rules, contentBlocks, source, lines2);
    return { facts, rules, contentBlocks, errors };
  }
  function parseTerm(text2) {
    text2 = text2.trim();
    if (!text2) return null;
    const match = text2.match(/^([a-z_][a-z0-9_]*)\s*\(([\s\S]*)\)$/);
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
  function parseArgList(text2) {
    const args = [];
    let current = "";
    let depth = 0;
    let inSingleQuote = false;
    let i = 0;
    while (i < text2.length) {
      const ch = text2[i];
      if (inSingleQuote) {
        if (ch === "'" && i + 1 < text2.length && text2[i + 1] === "'") {
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
  function parseArg(text2) {
    text2 = text2.trim();
    if (text2.startsWith("'") && text2.endsWith("'") && text2.length >= 2) {
      const inner = text2.slice(1, -1).replace(/''/g, "'");
      return { type: "string", value: inner };
    }
    if (/^-?[0-9]+(\.[0-9]+)?([eE][+-]?[0-9]+)?$/.test(text2)) {
      return { type: "number", value: parseFloat(text2) };
    }
    if (/^[A-Z_][A-Za-z0-9_]*$/.test(text2)) {
      return { type: "variable", value: text2 };
    }
    if (text2.startsWith("[") && text2.endsWith("]")) {
      const inner = text2.slice(1, -1).trim();
      if (!inner) return { type: "list", elements: [] };
      const elements = parseArgList(inner);
      return { type: "list", elements };
    }
    const compMatch = text2.match(/^([a-z_][a-z0-9_]*)\s*\(([\s\S]*)\)$/);
    if (compMatch) {
      const functor = compMatch[1];
      const innerArgs = parseArgList(compMatch[2]);
      return { type: "compound", functor, args: innerArgs };
    }
    return { type: "atom", value: text2 };
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
  function buildContentBlocks(facts, rules, blocks, _source, lines2) {
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
      for (let l = group.startLine - 1; l < group.endLine && l < lines2.length; l++) {
        rawLines.push(lines2[l]);
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
    const lines2 = [];
    lines2.push(
      `quest(${questId}, ${quoteProlog(fillTitle(tpl.meta.title, bindings))}, ${atom(tpl.meta.questType)}, ${tpl.meta.difficulty}, available).`
    );
    tpl.objectives.forEach((obj3, i) => {
      lines2.push(`quest_objective(${questId}, ${i}, ${argToProlog(substitute(obj3, bindMap))}).`);
    });
    for (const reward of tpl.rewards) {
      const amount = evalAmount(reward.amount, tpl, bindMap);
      lines2.push(`quest_reward(${questId}, ${atom(reward.kind)}, ${amount}).`);
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
      questContent: lines2.join("\n"),
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
    for (const obj3 of tpl.objectives) {
      if (obj3.type !== "compound") continue;
      const hasSlot = obj3.args.some((a) => a.type === "variable" && a.value === v);
      if (!hasSlot) continue;
      const num3 = obj3.args.find((a) => a.type === "number");
      if (num3 && num3.type === "number") return num3.value;
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
      // parenthesised conjunctions land here verbatim
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

  // corebridge/js/host-crypto.js
  var LONE_SURROGATE = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g;
  function unavailable(what) {
    return new Error(
      `insimulcore: ${what} is not available in the embedded runtime (corebridge/js/host-crypto.js supports createHash("sha256").update(string).digest("hex") only).`
    );
  }
  var Sha256 = class {
    constructor() {
      this._parts = [];
      this._done = false;
    }
    update(data, encoding) {
      if (this._done) throw new Error("insimulcore: Hash.update() after digest()");
      if (typeof data !== "string") throw unavailable("hashing a non-string input");
      if (encoding !== void 0 && encoding !== "utf8" && encoding !== "utf-8") {
        throw unavailable(`a "${encoding}" input encoding`);
      }
      this._parts.push(data);
      return this;
    }
    digest(encoding) {
      if (encoding !== "hex") throw unavailable(`a "${String(encoding)}" digest`);
      if (this._done) throw new Error("insimulcore: Hash.digest() called twice");
      this._done = true;
      const host = globalThis.__insimul_sha256_hex;
      if (typeof host !== "function") {
        throw new Error("insimulcore: the host installed no __insimul_sha256_hex \u2014 SHA-256 is unavailable");
      }
      return host(this._parts.join("").replace(LONE_SURROGATE, "\uFFFD"));
    }
  };
  function createHash(algorithm) {
    if (String(algorithm).toLowerCase() !== "sha256") throw unavailable(`crypto.createHash("${algorithm}")`);
    return new Sha256();
  }

  // @insimul/core/src/save-envelope.ts
  var SAVE_ENVELOPE_FORMAT = "insimul-save-v2";
  function canonicalJSONStringify(value) {
    return JSON.stringify(sortDeep(value));
  }
  function sortDeep(value) {
    if (Array.isArray(value)) return value.map(sortDeep);
    if (value && typeof value === "object") {
      const obj3 = value;
      const out = {};
      for (const key of Object.keys(obj3).sort()) {
        const v = obj3[key];
        if (v === void 0) continue;
        out[key] = sortDeep(v);
      }
      return out;
    }
    return value;
  }
  function computeSaveFileIntegrity(saveFile) {
    return createHash("sha256").update(canonicalJSONStringify(saveFile)).digest("hex");
  }
  function buildSaveFileEnvelope(saveFile, options = { insimulVersion: "unknown" }) {
    return {
      format: SAVE_ENVELOPE_FORMAT,
      exportedAt: options.exportedAt ?? (/* @__PURE__ */ new Date()).toISOString(),
      insimulVersion: options.insimulVersion,
      saveFile,
      integrity: computeSaveFileIntegrity(saveFile)
    };
  }
  function validateSaveFileEnvelope(candidate2) {
    if (!candidate2 || typeof candidate2 !== "object") {
      return { ok: false, error: { code: "invalid_format", message: "Envelope must be a JSON object" } };
    }
    const e = candidate2;
    if (e.format !== SAVE_ENVELOPE_FORMAT) {
      return {
        ok: false,
        error: {
          code: "invalid_format",
          message: `Unknown envelope format: expected '${SAVE_ENVELOPE_FORMAT}', got '${String(e.format)}'`
        }
      };
    }
    if (!e.saveFile || typeof e.saveFile !== "object") {
      return { ok: false, error: { code: "missing_save_file", message: "Envelope is missing saveFile payload" } };
    }
    if (typeof e.integrity !== "string" || e.integrity.length === 0) {
      return {
        ok: false,
        error: { code: "integrity_mismatch", message: "Envelope is missing integrity hash" }
      };
    }
    const expected = computeSaveFileIntegrity(e.saveFile);
    if (expected !== e.integrity) {
      return {
        ok: false,
        error: {
          code: "integrity_mismatch",
          message: "Save file integrity check failed \u2014 file may be corrupted or tampered"
        }
      };
    }
    return {
      ok: true,
      envelope: {
        format: SAVE_ENVELOPE_FORMAT,
        exportedAt: typeof e.exportedAt === "string" ? e.exportedAt : (/* @__PURE__ */ new Date(0)).toISOString(),
        insimulVersion: typeof e.insimulVersion === "string" ? e.insimulVersion : "unknown",
        saveFile: e.saveFile,
        integrity: e.integrity
      }
    };
  }

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
        for (const obj3 of objectives) {
          if (obj3.assessmentPhaseId && obj3.description) {
            obj3.description = enrichAssessmentDescription(obj3.description, targetLang);
          }
        }
      }
      const existingObjs = Array.isArray(quest.objectives) ? quest.objectives : [];
      quest.objectives = objectives.map((obj3) => {
        const existing = existingObjs.find((e) => e.id === obj3.id);
        if (existing) {
          return {
            ...obj3,
            completed: existing.completed ?? obj3.completed,
            currentCount: existing.currentCount ?? obj3.currentCount,
            current: existing.current ?? existing.currentCount ?? obj3.currentCount
          };
        }
        return obj3;
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
  function unescapeObj(obj3) {
    for (const key of Object.keys(obj3)) {
      if (typeof obj3[key] === "string") obj3[key] = unescape(obj3[key]);
    }
    return obj3;
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
      const obj3 = objectives.find((o) => o.id === `obj_${idx}`);
      if (obj3 && !obj3.description) {
        obj3.description = descMatch[2].trim();
      }
    }
    const locPattern = /quest_objective_location\(\s*\w+\s*,\s*(\d+)\s*,\s*(.*)\)\s*\./g;
    let locMatch;
    while ((locMatch = locPattern.exec(content)) !== null) {
      const idx = parseInt(locMatch[1]);
      const locAtom = locMatch[2].trim().replace(/^'|'$/g, "");
      const obj3 = objectives.find((o) => o.id === `obj_${idx}`);
      if (obj3) {
        obj3.objectiveLocation = locAtom;
        const innerMatch = locAtom.match(/^(location|npc)\(\s*'((?:[^'\\]|\\.)*)'\s*\)$/);
        if (innerMatch) {
          const locType = innerMatch[1];
          const name = innerMatch[2].replace(/\\'/g, "'");
          if (locType === "location") {
            obj3.locationName = name;
          } else if (locType === "npc") {
            if (!obj3.npcName) obj3.npcName = name;
            if (!obj3.npcId) obj3.npcId = name;
          }
        }
      }
    }
    const detailsPattern = /quest_objective_details\(\s*\w+\s*,\s*(\d+)\s*,\s*'((?:[^'\\]|\\.)*)'\s*\)\s*\./g;
    let detailsMatch;
    while ((detailsMatch = detailsPattern.exec(content)) !== null) {
      const idx = parseInt(detailsMatch[1]);
      const details = detailsMatch[2].replace(/\\'/g, "'").replace(/\\\\/g, "\\");
      const obj3 = objectives.find((o) => o.id === `obj_${idx}`);
      if (obj3) {
        obj3.details = details;
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
        const obj3 = {
          id: o.id,
          type: o.type,
          description: o.description,
          requiredCount: o.requiredCount
        };
        if (o.target !== void 0 && o.target !== null) obj3.target = o.target;
        if (o.npcId !== void 0 && o.npcId !== null) obj3.npcId = o.npcId;
        return obj3;
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

  // @insimul/core/src/language/spaced-repetition.ts
  var SRS_SESSION_MS = 30 * 60 * 1e3;
  function createEmptySrsState() {
    return { items: {}, currentSession: 0, lastUpdated: 0 };
  }

  // @insimul/core/src/save-file-migrations.ts
  var MigrationStepError = class extends Error {
    constructor(step, cause) {
      const causeMsg = cause instanceof Error ? cause.message : String(cause);
      super(
        `Migration step "${step.name}" (v${step.fromVersion} -> v${step.toVersion}) failed: ${causeMsg}`
      );
      __publicField(this, "stepName");
      __publicField(this, "fromVersion");
      __publicField(this, "toVersion");
      __publicField(this, "cause");
      this.name = "MigrationStepError";
      this.stepName = step.name;
      this.fromVersion = step.fromVersion;
      this.toVersion = step.toVersion;
      this.cause = cause;
    }
  };
  var v1_to_v2_populate_language_progress = {
    name: "v1_to_v2_populate_language_progress",
    fromVersion: 1,
    toVersion: 2,
    description: "Backfill proficiency fields on LanguageProgressState (arrivalAssessment, proficiencyHistory, srsState, weakAreaHistory).",
    migrate(save) {
      if (save.currentState) {
        save.currentState.languageProgress = migrateLanguageProgress(
          save.currentState.languageProgress
        );
      }
      return save;
    }
  };
  var PRE_VERSIONING_SENTINEL = "pre-versioning";
  var v2_to_v3_backfill_snapshot_versioning = {
    name: "v2_to_v3_backfill_snapshot_versioning",
    fromVersion: 2,
    toVersion: 3,
    description: "Backfill WorldSnapshot.insimulVersion / engineRevision / snapshotCreatedAt on saves predating version stamping (US-001).",
    migrate(save) {
      const snapshot = save.worldSnapshot;
      if (snapshot && typeof snapshot === "object") {
        if (typeof snapshot.insimulVersion !== "string") {
          snapshot.insimulVersion = PRE_VERSIONING_SENTINEL;
        }
        if (typeof snapshot.engineRevision !== "string") {
          snapshot.engineRevision = PRE_VERSIONING_SENTINEL;
        }
        if (typeof snapshot.snapshotCreatedAt !== "string") {
          snapshot.snapshotCreatedAt = PRE_VERSIONING_SENTINEL;
        }
      }
      return save;
    }
  };
  var migrations = {
    1: v1_to_v2_populate_language_progress,
    2: v2_to_v3_backfill_snapshot_versioning
  };
  function listMigrations() {
    return Object.keys(migrations).map((k) => Number(k)).sort((a, b) => a - b).map((k) => migrations[k]);
  }
  function applyMigrations(save, targetVersion, options = {}) {
    let current = save;
    let version = current.version ?? 1;
    while (version < targetVersion) {
      const step = migrations[version];
      if (!step) {
        throw new Error(
          `No migration step registered for save version ${version} -> ${version + 1} (target v${targetVersion})`
        );
      }
      options.onStep?.(step);
      try {
        current = step.migrate(current);
      } catch (err) {
        throw new MigrationStepError(step, err);
      }
      current.version = step.toVersion;
      version = step.toVersion;
    }
    return current;
  }

  // @insimul/core/src/save-extensions.ts
  function cloneDefault(value) {
    if (value === null || typeof value !== "object") return value;
    if (typeof structuredClone === "function") return structuredClone(value);
    return JSON.parse(JSON.stringify(value));
  }
  var extensionRegistry = {
    introShown: {
      owner: "intro-system",
      describe: "Whether the player has seen the opening intro cinematic for this save.",
      defaultValue: false
    },
    evaluations: {
      owner: "assessment-framework",
      describe: "Per-playthrough research evaluation responses (US-018). Replaces the legacy assessments collection.",
      defaultValue: []
    },
    sessions: {
      owner: "session-tracker",
      describe: "Array of SessionEntry records \u2014 one per play session for this save. Appended on createPlayerSession, finalized on endPlayerSession.",
      defaultValue: []
    },
    gamification: {
      owner: "language-gamification",
      describe: "GamificationState: XP/level, achievements unlocked, daily challenge, streaks, and lifetime counters (quests, NPCs talked, articles read, etc.). Written by LanguageGamificationTracker. Some saves still carry this at currentState.gamification (legacy position) \u2014 endpoints read both.",
      defaultValue: null
    },
    playthroughTelemetry: {
      owner: "telemetry",
      describe: "Rolling-window buffer of per-playthrough telemetry events (US-019). Capped at PLAYTHROUGH_TELEMETRY_MAX_EVENTS; oldest events drop on overflow.",
      defaultValue: []
    },
    droppedFacts: {
      owner: "prolog-migration",
      describe: "Prolog facts dropped during save migration because their predicate signature no longer matches the current schema. Each entry: {predicate, reason}.",
      defaultValue: []
    },
    skillTree: {
      owner: "skill-system",
      describe: "Skill-tree progression: unlocked node IDs and unspent skill points. Shape: {unlockedNodes: string[], availablePoints: number}. Registered preemptively; no production writer yet.",
      defaultValue: null
    },
    aiBlackboards: {
      owner: "ai-substrate",
      describe: "Per-agent working state for the game-AI substrate (US-1, 113-game-ai-substrate), keyed by the agent's CURIE. Shape: {[agentCurie]: {agent, updatedTick, slots}} with scalar slot values. Written by src/ai/blackboard.ts. Per-playthrough by definition: a world template must never carry it \u2014 findBlackboardLeaks() is the guard.",
      defaultValue: {}
    },
    detectionStates: {
      owner: "perception",
      describe: "Graded detection state per (observer, target) pair for the stealth module (US-2, 121-stealth-and-perception). Shape: {pairs: [{observer, target, awareness, state, believedLocation?, believedAt?, lastPerceivedTick?}]} \u2014 written by DetectionTracker.serialize() and read back through its constructor. Per-playthrough by definition: how convinced a guard has become and where they BELIEVE you are belong to one playthrough, while the thresholds, rates and stance weights that decide them are authored (WorldIR.perception) and must never ride here \u2014 findDetectionTuningLeaks() is the guard.",
      defaultValue: { pairs: [] }
    },
    achievements: {
      owner: "gamification",
      describe: "Per-playthrough achievement-earned records. Shape: {earned: Array<{id, earnedAt}>}. Registered for fixtures that persist achievement state outside the gamification bag; the canonical achievement list lives in `gamification.achievements`.",
      defaultValue: null
    }
  };
  function defaultOrphanLogger(key, _value) {
    try {
      console.warn(
        `[save-extensions] orphan extension "${key}" \u2014 no registered contract. Value preserved as-is.`
      );
    } catch {
    }
  }
  function migrateExtensions(legacy, fromVersion, options = {}) {
    const source = legacy ?? {};
    const out = {};
    const onOrphan = options.onOrphan ?? defaultOrphanLogger;
    for (const [key, contract] of Object.entries(extensionRegistry)) {
      const hasValue = Object.prototype.hasOwnProperty.call(source, key);
      if (hasValue) {
        out[key] = contract.migrate ? contract.migrate(source[key], fromVersion) : source[key];
      } else {
        out[key] = cloneDefault(contract.defaultValue);
      }
    }
    for (const [key, value] of Object.entries(source)) {
      if (Object.prototype.hasOwnProperty.call(extensionRegistry, key)) continue;
      out[key] = value;
      onOrphan(key, value);
    }
    return out;
  }

  // @insimul/core/src/save-file.ts
  var SAVE_FILE_VERSION = 3;
  function createDefaultLanguageProgress() {
    return {
      vocabulary: [],
      grammarPatterns: [],
      totalXP: 0,
      level: 1,
      arrivalAssessment: null,
      proficiencyHistory: [],
      srsState: createEmptySrsState(),
      weakAreaHistory: []
    };
  }
  function migrateLanguageProgress(legacy) {
    const defaults = createDefaultLanguageProgress();
    if (!legacy) return defaults;
    return {
      vocabulary: legacy.vocabulary ?? defaults.vocabulary,
      grammarPatterns: legacy.grammarPatterns ?? defaults.grammarPatterns,
      totalXP: legacy.totalXP ?? defaults.totalXP,
      level: legacy.level ?? defaults.level,
      arrivalAssessment: legacy.arrivalAssessment === void 0 ? defaults.arrivalAssessment : legacy.arrivalAssessment,
      proficiencyHistory: legacy.proficiencyHistory ?? defaults.proficiencyHistory,
      srsState: legacy.srsState ?? defaults.srsState,
      weakAreaHistory: legacy.weakAreaHistory ?? defaults.weakAreaHistory
    };
  }
  function migrateSaveFile(save) {
    const fromVersion = save.version ?? 1;
    const migrated = applyMigrations(save, SAVE_FILE_VERSION, {
      onStep: (step) => {
        if (typeof console !== "undefined" && typeof console.log === "function") {
          console.log(
            `[save-file-migration] applying ${step.name} (v${step.fromVersion} -> v${step.toVersion})`
          );
        }
      }
    });
    if (migrated.currentState) {
      migrated.currentState.extensions = migrateExtensions(
        migrated.currentState.extensions,
        fromVersion
      );
    }
    return migrated;
  }
  function migrateSaveFileWithOutcome(save) {
    const versionFrom = save.version ?? 1;
    const migrated = migrateSaveFile(save);
    const versionTo = migrated.version ?? SAVE_FILE_VERSION;
    const outcome = {
      versionFrom,
      versionTo,
      versionsBehind: Math.max(0, versionTo - versionFrom),
      migrationApplied: versionTo > versionFrom,
      droppedFacts: [],
      orphanExtensionKeys: [],
      predicateSchemaDrift: false
    };
    return { save: migrated, outcome };
  }
  function isMigrationOutcomeSignificant(outcome) {
    if (!outcome) return false;
    return outcome.versionsBehind > 0 || outcome.droppedFacts.length > 0 || outcome.orphanExtensionKeys.length > 0 || outcome.predicateSchemaDrift;
  }

  // @insimul/core/src/ui/notifications.ts
  var KIND_COLOR = {
    info: "accent",
    success: "success",
    warning: "warning",
    danger: "danger"
  };
  var DEFAULT_NOTIFICATION_LIFETIME = 4;
  var Notifications = class {
    constructor() {
      __publicField(this, "items", []);
      __publicField(this, "nextId", 1);
    }
    /** Enqueue a notification. Returns its id (so a caller can `dismiss` it early). */
    push(text2, kind = "info", lifetime = DEFAULT_NOTIFICATION_LIFETIME) {
      const id = this.nextId++;
      this.items.push({ id, text: text2, kind, remaining: lifetime, color: KIND_COLOR[kind] });
      return id;
    }
    /**
     * Age every notification by `delta` seconds, dropping expired ones. Returns
     * true if the visible set changed (so a view knows to repaint).
     */
    tick(delta) {
      if (this.items.length === 0) return false;
      const before = this.items.length;
      this.items = this.items.filter((item) => {
        item.remaining -= delta;
        return item.remaining > 0;
      });
      return this.items.length !== before;
    }
    /** Dismiss a notification by id early. Returns true if one was removed. */
    dismiss(id) {
      const before = this.items.length;
      this.items = this.items.filter((item) => item.id !== id);
      return this.items.length !== before;
    }
    /** Currently visible notifications (oldest first). */
    visible() {
      return this.items;
    }
    count() {
      return this.items.length;
    }
    clear() {
      this.items = [];
    }
  };

  // @insimul/core/src/ui/pause-menu-model.ts
  var DEFAULT_MENU_TABS = [
    { key: "resume", label: "Resume" },
    { key: "journal", label: "Journal" },
    { key: "inventory", label: "Inventory" },
    { key: "map", label: "Map" },
    { key: "character", label: "Character", requires: "proficiency" },
    { key: "vocabulary", label: "Vocabulary", requires: "knowledge-acquisition" },
    { key: "skills", label: "Skills", requires: "skill-tree" },
    { key: "analytics", label: "Analytics", requires: "conversation-analytics" },
    { key: "assessment", label: "Assessment", requires: "assessment" },
    { key: "settings", label: "Settings" },
    { key: "save", label: "Save / Load" }
  ];
  function required(tab) {
    if (!tab.requires) return [];
    return Array.isArray(tab.requires) ? tab.requires : [tab.requires];
  }
  var PauseMenuModel = class {
    constructor(enabledModules = [], tabs = DEFAULT_MENU_TABS) {
      __publicField(this, "tabs");
      __publicField(this, "enabled");
      __publicField(this, "open", false);
      __publicField(this, "active", "");
      this.enabled = new Set(enabledModules);
      this.tabs = tabs.length > 0 ? tabs : DEFAULT_MENU_TABS;
    }
    /** True when every module a tab requires is enabled (ungated tabs always pass). */
    gated(tab) {
      return required(tab).every((m) => this.enabled.has(m));
    }
    /** Tabs visible under the current module set, in declaration order. */
    visibleTabs() {
      return this.tabs.filter((t) => this.gated(t)).map((t) => ({ ...t }));
    }
    visibleKeys() {
      return this.tabs.filter((t) => this.gated(t)).map((t) => t.key);
    }
    isVisible(key) {
      const tab = this.tabs.find((t) => t.key === key);
      return !!tab && this.gated(tab);
    }
    // ── Open / active-tab state ───────────────────────────────────────────────
    /** Open the menu, optionally to a tab (falls back to the first visible tab). */
    openMenu(tab) {
      this.open = true;
      if (tab && this.isVisible(tab)) {
        this.active = tab;
      } else if (!this.isVisible(this.active)) {
        this.active = this.visibleKeys()[0] ?? "";
      }
    }
    closeMenu() {
      this.open = false;
    }
    toggle() {
      if (this.open) this.closeMenu();
      else this.openMenu();
    }
    isOpen() {
      return this.open;
    }
    /** Switch tabs. Rejected (returns false) for a hidden/unknown tab. */
    setActive(key) {
      if (!this.isVisible(key)) return false;
      this.active = key;
      return true;
    }
    activeTab() {
      return this.active;
    }
  };

  // @insimul/core/src/ui/quest-journal-model.ts
  var DEFAULT_MAX_TRACKED = 3;
  var QuestJournalModel = class {
    constructor(maxTracked = DEFAULT_MAX_TRACKED) {
      /** Insertion-ordered quest list (order is stable + part of the contract). */
      __publicField(this, "order", []);
      __publicField(this, "byId", /* @__PURE__ */ new Map());
      __publicField(this, "tracked", []);
      __publicField(this, "filter", "all");
      __publicField(this, "maxTracked");
      this.maxTracked = maxTracked > 0 ? maxTracked : DEFAULT_MAX_TRACKED;
    }
    /** Replace the whole quest set (e.g. on load), preserving given order. */
    setQuests(entries) {
      this.order = [];
      this.byId.clear();
      this.tracked = [];
      for (const e of entries) this.upsert(e);
    }
    /**
     * Add or replace a quest by id (a radiant arrival / quest_offered lands here).
     * A brand-new id is appended so list order stays stable.
     */
    upsert(entry) {
      if (!this.byId.has(entry.id)) this.order.push(entry.id);
      this.byId.set(entry.id, { ...entry });
    }
    get(id) {
      const e = this.byId.get(id);
      return e ? { ...e } : void 0;
    }
    /** Accept an AVAILABLE quest (available -> active). No-op otherwise. */
    accept(id) {
      const e = this.byId.get(id);
      if (!e || e.status !== "available") return false;
      e.status = "active";
      return true;
    }
    /** Decline an AVAILABLE quest (offer dismissed) — removes it entirely. */
    decline(id) {
      const e = this.byId.get(id);
      if (!e || e.status !== "available") return false;
      this.remove(id);
      return true;
    }
    /** Complete an ACTIVE quest (active -> completed) and auto-untrack it. */
    complete(id) {
      const e = this.byId.get(id);
      if (!e || e.status !== "active") return false;
      e.status = "completed";
      this.untrack(id);
      return true;
    }
    remove(id) {
      this.byId.delete(id);
      this.order = this.order.filter((x) => x !== id);
      this.untrack(id);
    }
    // ── Filtering / counts ──────────────────────────────────────────────────
    setFilter(filter) {
      this.filter = filter;
    }
    currentFilter() {
      return this.filter;
    }
    /** Quests matching the current filter, in stable insertion order. */
    filtered() {
      return this.order.map((id) => this.byId.get(id)).filter((e) => !!e && (this.filter === "all" || e.status === this.filter)).map((e) => ({ ...e }));
    }
    counts() {
      const c = { all: 0, active: 0, completed: 0, available: 0 };
      for (const id of this.order) {
        const e = this.byId.get(id);
        if (!e) continue;
        c.all++;
        c[e.status]++;
      }
      return c;
    }
    // ── Tracker HUD ─────────────────────────────────────────────────────────
    /**
     * Track an ACTIVE quest for the HUD. Fails if the quest is not active, already
     * tracked, or the tracked set is full (maxTracked). Returns true on a change.
     */
    track(id) {
      const e = this.byId.get(id);
      if (!e || e.status !== "active") return false;
      if (this.tracked.includes(id)) return false;
      if (this.tracked.length >= this.maxTracked) return false;
      this.tracked.push(id);
      return true;
    }
    untrack(id) {
      const before = this.tracked.length;
      this.tracked = this.tracked.filter((x) => x !== id);
      return this.tracked.length !== before;
    }
    isTracked(id) {
      return this.tracked.includes(id);
    }
    /** The tracker HUD view: tracked quests that are still active, in track order. */
    trackedQuests() {
      return this.tracked.map((id) => this.byId.get(id)).filter((e) => !!e && e.status === "active").map((e) => ({ ...e }));
    }
  };

  // @insimul/core/src/ui/save-slot-model.ts
  var SLOT_MESSAGES = {
    empty: "",
    ok: "",
    invalid_format: "Unrecognized save format \u2014 this slot cannot be loaded.",
    missing_save_file: "Save data is missing or unreadable.",
    integrity_mismatch: "Save file integrity check failed \u2014 file may be corrupted or tampered."
  };
  function summaryTitle(index, s) {
    if (!s) return `Slot ${index + 1}`;
    const bits = [];
    if (s.playerName) bits.push(s.playerName);
    if (s.level !== void 0) bits.push(`Lv ${s.level}`);
    if (s.locationName) bits.push(s.locationName);
    return bits.length ? bits.join(" \xB7 ") : `Slot ${index + 1}`;
  }
  function view(result) {
    const { index, outcome, summary } = result;
    if (outcome === "empty") {
      return { index, status: "empty", title: "Empty Slot", message: "", canLoad: false, canSave: true };
    }
    if (outcome === "ok") {
      return {
        index,
        status: "ok",
        title: summaryTitle(index, summary),
        message: summary?.savedAt ? `Saved ${summary.savedAt}` : "",
        canLoad: true,
        canSave: true,
        summary
      };
    }
    return {
      index,
      status: "corrupted",
      title: "Corrupted Save",
      message: SLOT_MESSAGES[outcome],
      canLoad: false,
      canSave: true
    };
  }
  var SaveSlotModel = class {
    constructor(results = []) {
      __publicField(this, "results", []);
      this.results = results.map((r) => ({ ...r }));
    }
    setSlots(results) {
      this.results = results.map((r) => ({ ...r }));
    }
    /** The rendered rows, in slot-index order. */
    slots() {
      return [...this.results].sort((a, b) => a.index - b.index).map(view);
    }
    slot(index) {
      const r = this.results.find((x) => x.index === index);
      return r ? view(r) : void 0;
    }
    /** True when no slot is loadable (fresh install / all corrupted) — main-menu Continue gate. */
    hasAnyLoadable() {
      return this.results.some((r) => r.outcome === "ok");
    }
    /**
     * TS-only: run the real envelope validator over a loaded slot candidate and map
     * its verdict to a `SlotLoadResult`. `null`/`undefined` candidate = empty slot.
     */
    static classifyEnvelope(index, candidate2, summarize) {
      if (candidate2 === null || candidate2 === void 0) {
        return { index, outcome: "empty" };
      }
      const res = validateSaveFileEnvelope(candidate2);
      if (res.ok) {
        return { index, outcome: "ok", summary: summarize?.(candidate2) };
      }
      return { index, outcome: res.error.code };
    }
  };

  // @insimul/core/src/ui/loading-screen-model.ts
  var DEFAULT_LOADING_PHASES = [
    { key: "init", label: "Starting up\u2026", weight: 1 },
    { key: "world", label: "Loading world\u2026", weight: 3 },
    { key: "save", label: "Restoring save\u2026", weight: 2 },
    { key: "kb", label: "Building knowledge base\u2026", weight: 2 },
    { key: "systems", label: "Initializing systems\u2026", weight: 1 },
    { key: "ready", label: "Ready", weight: 1 }
  ];
  var DEFAULT_LOADING_TIPS = [
    "Talk to villagers to uncover radiant quests.",
    "Every conversation is generated live \u2014 no two runs are alike.",
    "Check the quest journal (J) to track objectives.",
    "Your progress autosaves to the active slot."
  ];
  var LoadingScreenModel = class {
    constructor(phases = DEFAULT_LOADING_PHASES, tips = DEFAULT_LOADING_TIPS) {
      __publicField(this, "phases");
      __publicField(this, "tips");
      __publicField(this, "totalWeight");
      __publicField(this, "currentKey", "");
      __publicField(this, "progressValue", 0);
      this.phases = phases.length > 0 ? phases : DEFAULT_LOADING_PHASES;
      this.tips = tips.length > 0 ? tips : DEFAULT_LOADING_TIPS;
      this.totalWeight = Math.max(
        1,
        this.phases.reduce((sum, p) => sum + p.weight, 0)
      );
    }
    /**
     * Advance to a named phase. Progress is clamped monotonic — re-entering the
     * current phase, or a phase earlier in the order, never lowers the bar.
     */
    advance(key) {
      const idx = this.indexOf(key);
      if (idx < 0) return;
      this.currentKey = key;
      let cumulative = 0;
      for (let i = 0; i <= idx; i++) cumulative += this.phases[i].weight;
      this.progressValue = Math.max(this.progressValue, cumulative / this.totalWeight);
    }
    progress() {
      return this.progressValue;
    }
    label() {
      const idx = this.indexOf(this.currentKey);
      return idx < 0 ? "" : this.phases[idx].label;
    }
    /** Deterministic per-phase tip (index by phase position, wrapping the pool). */
    tip() {
      const idx = this.indexOf(this.currentKey);
      if (idx < 0 || this.tips.length === 0) return "";
      return this.tips[idx % this.tips.length];
    }
    currentPhase() {
      return this.currentKey;
    }
    /** True once the final (terminal) phase has been reached. */
    isComplete() {
      if (this.phases.length === 0) return false;
      return this.currentKey === this.phases[this.phases.length - 1].key;
    }
    reset() {
      this.currentKey = "";
      this.progressValue = 0;
    }
    indexOf(key) {
      return this.phases.findIndex((p) => p.key === key);
    }
  };

  // @insimul/core/src/ui/trade-model.ts
  var OK = (moved2) => ({ ok: true, reason: "", moved: moved2 });
  var FAIL = (reason) => ({ ok: false, reason, moved: 0 });
  function findStack(items, itemId) {
    return items.find((i) => i.itemId === itemId);
  }
  function addStack(items, itemId, qty, value) {
    if (qty <= 0) return;
    const existing = findStack(items, itemId);
    if (existing) {
      existing.quantity += qty;
      return;
    }
    const stack = { itemId, quantity: qty };
    if (value !== void 0) stack.value = value;
    items.push(stack);
  }
  function removeStack(items, itemId, qty) {
    const idx = items.findIndex((i) => i.itemId === itemId);
    if (idx < 0) return;
    items[idx].quantity -= qty;
    if (items[idx].quantity <= 0) items.splice(idx, 1);
  }
  var TradeModel = class {
    constructor(state) {
      __publicField(this, "state", state);
    }
    // ── Reads (all straight off currentState — no private copy) ─────────────
    playerGold() {
      return this.state.player.gold;
    }
    /** The player's live inventory array (same reference as currentState). */
    playerItems() {
      return this.state.player.inventory;
    }
    containerItems(containerId) {
      return this.state.containers.containers[containerId]?.items ?? [];
    }
    merchantItems(merchantId) {
      return this.state.npcs.merchantStates[merchantId]?.items ?? [];
    }
    merchantGold(merchantId) {
      return this.state.npcs.merchantStates[merchantId]?.goldReserve ?? 0;
    }
    // ── Container transfer ──────────────────────────────────────────────────
    /**
     * Take `qty` of `itemId` from a container into the player inventory. `qty <= 0`
     * or omitted takes the whole stack; a request larger than stock is clamped.
     */
    takeFromContainer(containerId, itemId, qty = 0) {
      const container = this.state.containers.containers[containerId];
      if (!container) return FAIL("no_container");
      const stack = findStack(container.items, itemId);
      const avail = stack?.quantity ?? 0;
      if (avail <= 0) return FAIL("not_present");
      const moved2 = qty > 0 ? Math.min(qty, avail) : avail;
      removeStack(container.items, itemId, moved2);
      addStack(this.state.player.inventory, itemId, moved2, stack?.value);
      return OK(moved2);
    }
    /** Take every stack from a container into the player inventory. */
    takeAllFromContainer(containerId) {
      const container = this.state.containers.containers[containerId];
      if (!container) return FAIL("no_container");
      let moved2 = 0;
      const stacks = container.items.map((i) => ({ itemId: i.itemId }));
      for (const s of stacks) {
        const r = this.takeFromContainer(containerId, s.itemId, 0);
        if (r.ok) moved2 += r.moved;
      }
      return OK(moved2);
    }
    // ── Merchant buy / sell ─────────────────────────────────────────────────
    /** Buy `qty` of `itemId` from a merchant: item merchant->player, gold player->merchant. */
    buy(merchantId, itemId, qty) {
      if (qty <= 0) return FAIL("bad_qty");
      const merchant = this.state.npcs.merchantStates[merchantId];
      if (!merchant) return FAIL("no_merchant");
      const stack = findStack(merchant.items, itemId);
      if ((stack?.quantity ?? 0) < qty) return FAIL("out_of_stock");
      const unit = stack?.value ?? 0;
      const cost = unit * qty;
      if (this.state.player.gold < cost) return FAIL("insufficient_gold");
      removeStack(merchant.items, itemId, qty);
      addStack(this.state.player.inventory, itemId, qty, unit);
      this.state.player.gold -= cost;
      merchant.goldReserve += cost;
      return OK(qty);
    }
    /** Sell `qty` of `itemId` to a merchant: item player->merchant, gold merchant->player. */
    sell(merchantId, itemId, qty) {
      if (qty <= 0) return FAIL("bad_qty");
      const merchant = this.state.npcs.merchantStates[merchantId];
      if (!merchant) return FAIL("no_merchant");
      const stack = findStack(this.state.player.inventory, itemId);
      if ((stack?.quantity ?? 0) < qty) return FAIL("insufficient_items");
      const unit = stack?.value ?? 0;
      const revenue = unit * qty;
      if (merchant.goldReserve < revenue) return FAIL("merchant_cannot_afford");
      removeStack(this.state.player.inventory, itemId, qty);
      addStack(merchant.items, itemId, qty, unit);
      this.state.player.gold += revenue;
      merchant.goldReserve -= revenue;
      return OK(qty);
    }
  };

  // @insimul/core/src/game-engine/quest-action-mapping.ts
  var QUEST_ACTION_MAPPINGS = [
    {
      objectiveType: "collect_item",
      eventType: "item_collected",
      matchFields: [
        { eventField: "itemName", objectiveField: "itemName", comparison: "contains_lower", optional: true }
      ],
      quantity: { currentField: "collectedCount", requiredField: "itemCount", defaultRequired: 1 },
      description: "Player collects an item into inventory"
    },
    {
      objectiveType: "visit_location",
      eventType: "location_visited",
      matchFields: [
        { eventField: "locationName", objectiveField: "locationName", comparison: "contains_lower", optional: true }
      ],
      description: "Player visits a named location"
    },
    {
      objectiveType: "discover_location",
      eventType: "location_discovered",
      matchFields: [
        { eventField: "locationName", objectiveField: "locationName", comparison: "contains_lower", optional: true }
      ],
      description: "Player discovers a new location"
    },
    {
      objectiveType: "talk_to_npc",
      eventType: "npc_talked",
      matchFields: [
        { eventField: "npcId", objectiveField: "npcId", comparison: "exact", optional: true }
      ],
      description: "Player talks to an NPC"
    },
    {
      objectiveType: "complete_reading",
      eventType: "reading_completed",
      matchFields: [
        { eventField: "textId", objectiveField: "textId", comparison: "exact", optional: true }
      ],
      description: "Player completes reading a text"
    },
    {
      objectiveType: "answer_questions",
      eventType: "questions_answered",
      matchFields: [
        { eventField: "textId", objectiveField: "textId", comparison: "exact", optional: true }
      ],
      description: "Player answers comprehension questions"
    },
    {
      objectiveType: "photograph_subject",
      eventType: "photo_taken",
      matchFields: [
        { eventField: "subjectName", objectiveField: "targetSubject", comparison: "contains_lower", optional: true },
        { eventField: "subjectCategory", objectiveField: "targetCategory", comparison: "exact", optional: true }
      ],
      quantity: { currentField: "currentCount", requiredField: "requiredCount", defaultRequired: 1 },
      description: "Player photographs a subject"
    },
    {
      objectiveType: "photograph_activity",
      eventType: "photo_taken",
      matchFields: [
        { eventField: "subjectName", objectiveField: "targetSubject", comparison: "contains_lower", optional: true },
        { eventField: "subjectCategory", objectiveField: "targetCategory", comparison: "exact", optional: true }
      ],
      quantity: { currentField: "currentCount", requiredField: "requiredCount", defaultRequired: 1 },
      description: "Player photographs an activity (compound: requires matching subject activity)"
    },
    {
      objectiveType: "physical_action",
      eventType: "physical_action_completed",
      matchFields: [
        { eventField: "actionType", objectiveField: "actionType", comparison: "exact", optional: true }
      ],
      quantity: { currentField: "actionsCompleted", requiredField: "actionsRequired", defaultRequired: 1 },
      description: "Player performs a physical action at a hotspot"
    },
    {
      objectiveType: "craft_item",
      eventType: "item_crafted",
      matchFields: [
        { eventField: "itemName", objectiveField: "itemName", comparison: "contains_lower", optional: true }
      ],
      quantity: { currentField: "craftedCount", requiredField: "requiredCount", defaultRequired: 1 },
      description: "Player crafts an item"
    },
    {
      objectiveType: "eavesdrop",
      eventType: "conversation_overheard",
      matchFields: [
        { eventField: "topic", objectiveField: "eavesdropTopic", comparison: "contains_lower", optional: true }
      ],
      quantity: { currentField: "currentCount", requiredField: "requiredCount", defaultRequired: 1 },
      description: "Player overhears an NPC-to-NPC conversation about a topic"
    },
    {
      objectiveType: "observe_activity",
      eventType: "activity_observed",
      matchFields: [
        { eventField: "activity", objectiveField: "activityType", comparison: "exact", optional: true },
        { eventField: "npcName", objectiveField: "npcName", comparison: "contains_lower", optional: true }
      ],
      quantity: { currentField: "currentCount", requiredField: "requiredCount", defaultRequired: 1 },
      description: "Player observes an NPC performing an activity"
    },
    // ─── Inventory action mappings ──────────────────────────────────────────────
    {
      objectiveType: "use_item",
      eventType: "item_used",
      matchFields: [
        { eventField: "itemName", objectiveField: "itemName", comparison: "contains_lower", optional: true }
      ],
      quantity: { currentField: "currentCount", requiredField: "requiredCount", defaultRequired: 1 },
      description: "Player uses an item from inventory"
    },
    {
      objectiveType: "equip_item",
      eventType: "item_equipped",
      matchFields: [
        { eventField: "itemName", objectiveField: "itemName", comparison: "contains_lower", optional: true }
      ],
      description: "Player equips an item"
    },
    {
      objectiveType: "drop_item",
      eventType: "item_dropped",
      matchFields: [
        { eventField: "itemName", objectiveField: "itemName", comparison: "contains_lower", optional: true }
      ],
      description: "Player drops an item"
    },
    {
      objectiveType: "deliver_item",
      eventType: "item_delivered",
      matchFields: [
        { eventField: "npcId", objectiveField: "npcId", comparison: "exact", optional: true },
        { eventField: "itemName", objectiveField: "itemName", comparison: "contains_lower", optional: true }
      ],
      description: "Player delivers an item to an NPC"
    },
    {
      objectiveType: "buy_item",
      eventType: "item_purchased",
      matchFields: [
        { eventField: "itemName", objectiveField: "itemName", comparison: "contains_lower", optional: true }
      ],
      quantity: { currentField: "currentCount", requiredField: "requiredCount", defaultRequired: 1 },
      description: "Player purchases an item from a merchant"
    },
    // ─── Text/document objective mappings ──────────────────────────────────────
    {
      objectiveType: "read_document",
      eventType: "text_read",
      matchFields: [
        { eventField: "textId", objectiveField: "textId", comparison: "exact", optional: true },
        { eventField: "textTitle", objectiveField: "textTitle", comparison: "contains_lower", optional: true }
      ],
      description: "Player reads a document/text in the world"
    },
    {
      objectiveType: "read_text",
      eventType: "text_read",
      matchFields: [
        { eventField: "textId", objectiveField: "textId", comparison: "exact", optional: true },
        { eventField: "textTitle", objectiveField: "textTitle", comparison: "contains_lower", optional: true }
      ],
      description: "Player reads a text (alias for read_document)"
    },
    {
      objectiveType: "find_text",
      eventType: "text_found",
      matchFields: [
        { eventField: "textId", objectiveField: "textId", comparison: "exact", optional: true },
        { eventField: "textCategory", objectiveField: "textCategory", comparison: "exact", optional: true }
      ],
      quantity: { currentField: "currentCount", requiredField: "requiredCount", defaultRequired: 1 },
      description: "Player finds/collects a text document"
    },
    {
      objectiveType: "collect_text",
      eventType: "text_found",
      matchFields: [
        { eventField: "textId", objectiveField: "textId", comparison: "exact", optional: true },
        { eventField: "textCategory", objectiveField: "textCategory", comparison: "exact", optional: true }
      ],
      quantity: { currentField: "currentCount", requiredField: "requiredCount", defaultRequired: 1 },
      description: "Player collects a text document (alias for find_text)"
    },
    {
      objectiveType: "comprehension_quiz",
      eventType: "comprehension_answer",
      matchFields: [
        { eventField: "textId", objectiveField: "textId", comparison: "exact", optional: true }
      ],
      quantity: { currentField: "correctAnswers", requiredField: "requiredCorrect", defaultRequired: 1 },
      description: "Player answers comprehension questions correctly"
    },
    {
      objectiveType: "collect_clue",
      eventType: "clue_discovered",
      matchFields: [
        { eventField: "clueCategory", objectiveField: "clueCategory", comparison: "exact", optional: true },
        { eventField: "clueSource", objectiveField: "clueSource", comparison: "contains_lower", optional: true }
      ],
      quantity: { currentField: "currentCount", requiredField: "requiredCount", defaultRequired: 1 },
      description: "Player discovers an investigation clue"
    },
    // ─── Meta-objective aliases (chapter quests use generic category names) ─────
    {
      objectiveType: "vocabulary",
      eventType: "vocabulary_usage",
      matchFields: [],
      quantity: { currentField: "currentCount", requiredField: "requiredCount", defaultRequired: 1 },
      description: "Player completes a vocabulary activity (meta-objective for chapter quests)"
    },
    {
      objectiveType: "conversation",
      eventType: "npc_talked",
      matchFields: [],
      quantity: { currentField: "currentCount", requiredField: "requiredCount", defaultRequired: 1 },
      description: "Player has a conversation with an NPC (meta-objective for chapter quests)"
    },
    {
      objectiveType: "grammar",
      eventType: "grammar_demonstrated",
      matchFields: [],
      quantity: { currentField: "currentCount", requiredField: "requiredCount", defaultRequired: 1 },
      description: "Player demonstrates grammar knowledge (meta-objective for chapter quests)"
    },
    // ─── Pronunciation objectives ──────────────────────────────────────────────
    {
      objectiveType: "pronunciation_check",
      eventType: "pronunciation_attempt",
      matchFields: [],
      quantity: { currentField: "currentCount", requiredField: "requiredCount", defaultRequired: 1 },
      description: "Player pronounces a phrase and gets scored"
    },
    // ─── Photography alias (photograph → photograph_subject) ──────────────────
    {
      objectiveType: "photograph",
      eventType: "photo_taken",
      matchFields: [
        { eventField: "subjectName", objectiveField: "targetSubject", comparison: "contains_lower", optional: true }
      ],
      quantity: { currentField: "currentCount", requiredField: "requiredCount", defaultRequired: 1 },
      description: "Player photographs a subject (alias for photograph_subject)"
    },
    // ─── Generic action_executed mapping (catches any action for flexible quests) ─
    {
      objectiveType: "perform_action",
      eventType: "action_executed",
      matchFields: [
        { eventField: "actionName", objectiveField: "actionName", comparison: "exact", optional: true }
      ],
      quantity: { currentField: "actionsCompleted", requiredField: "actionsRequired", defaultRequired: 1 },
      description: "Player performs a specific action (generic)"
    },
    // ─── NPC speech act mapping ──────────────────────────────────────────────────
    {
      objectiveType: "receive_directions",
      eventType: "npc_speech_act",
      matchFields: [
        { eventField: "npcId", objectiveField: "npcId", comparison: "exact", optional: true },
        { eventField: "actionType", objectiveField: "speechActType", comparison: "exact", optional: true }
      ],
      description: "NPC performs a speech act (gives directions, teaches vocabulary, etc.)"
    }
  ];
  var eventTypeIndex = /* @__PURE__ */ new Map();
  var objectiveTypeIndex = /* @__PURE__ */ new Map();
  function rebuildIndexes(mappings) {
    eventTypeIndex = /* @__PURE__ */ new Map();
    objectiveTypeIndex = /* @__PURE__ */ new Map();
    for (const mapping of mappings) {
      const list = eventTypeIndex.get(mapping.eventType) || [];
      list.push(mapping);
      eventTypeIndex.set(mapping.eventType, list);
      if (!objectiveTypeIndex.has(mapping.objectiveType)) {
        objectiveTypeIndex.set(mapping.objectiveType, mapping);
      }
    }
  }
  rebuildIndexes(QUEST_ACTION_MAPPINGS);
  function getMappingsForEvent(eventType) {
    return eventTypeIndex.get(eventType) || [];
  }
  function matchesField(rule, eventValue, objectiveValue) {
    if ((objectiveValue === void 0 || objectiveValue === null || objectiveValue === "") && rule.optional) {
      return true;
    }
    if (eventValue === void 0 || eventValue === null) return false;
    if (objectiveValue === void 0 || objectiveValue === null) return false;
    const comparison = rule.comparison || "exact";
    const ev = String(eventValue);
    const ov = String(objectiveValue);
    switch (comparison) {
      case "exact":
        return ev === ov;
      case "contains":
        return ev.includes(ov) || ov.includes(ev);
      case "contains_lower":
        return ev.toLowerCase().includes(ov.toLowerCase()) || ov.toLowerCase().includes(ev.toLowerCase());
      default:
        return ev === ov;
    }
  }
  function matchesAllFields(mapping, event, objective) {
    for (const rule of mapping.matchFields) {
      if (!matchesField(rule, event[rule.eventField], objective[rule.objectiveField])) {
        return false;
      }
    }
    return true;
  }

  // @insimul/core/src/game-engine/logic/ConversationQuestBridge.ts
  var MIN_CONVERSATION_GOAL_CONFIDENCE = 0.7;

  // @insimul/core/src/quest-objective-types.ts
  var ACHIEVABLE_OBJECTIVE_TYPES = [
    // ── Movement / Exploration ───────────────────────────────────────────────
    {
      type: "visit_location",
      description: "Go to a specific location in the game world",
      playerAction: "Walk to a location marker",
      requiresTarget: "location",
      countable: false
    },
    {
      type: "discover_location",
      description: "Discover a new location by entering its area",
      playerAction: "Walk into a new area for the first time",
      requiresTarget: "location",
      countable: false
    },
    // ── NPC Interaction ──────────────────────────────────────────────────────
    {
      type: "talk_to_npc",
      description: "Talk to a specific NPC character",
      playerAction: "Press G near an NPC to start a conversation",
      requiresTarget: "npc",
      countable: true
    },
    {
      type: "complete_conversation",
      description: "Complete a multi-turn conversation (with keyword usage or turn count)",
      playerAction: "Have a sustained back-and-forth dialogue with NPCs",
      requiresTarget: "none",
      countable: true
    },
    {
      type: "conversation_initiation",
      description: "Respond to an NPC who proactively approaches and starts a conversation",
      playerAction: "Accept an NPC-initiated conversation (press G) and respond appropriately",
      requiresTarget: "npc",
      countable: true
    },
    // ── Vocabulary & Language ────────────────────────────────────────────────
    {
      type: "use_vocabulary",
      description: "Use specific target-language words in conversation",
      playerAction: "Type or speak target-language words during NPC dialogue",
      requiresTarget: "none",
      countable: true
    },
    {
      type: "collect_vocabulary",
      description: "Collect vocabulary words by interacting with labeled world objects",
      playerAction: "Walk near objects with vocabulary labels to add words to vocabulary bank",
      requiresTarget: "none",
      countable: true
    },
    {
      type: "collect_text",
      description: "Collect a text artifact (book, letter, journal, scroll) from the world",
      playerAction: "Walk to a text object and press E to pick it up and add it to your library",
      requiresTarget: "none",
      countable: true
    },
    {
      type: "identify_object",
      description: "Identify an object by typing its name in the target language",
      playerAction: "Click an object and type its target-language name",
      requiresTarget: "none",
      countable: true
    },
    // ── Items & Inventory ────────────────────────────────────────────────────
    {
      type: "collect_item",
      description: "Pick up or collect a specific item in the world",
      playerAction: "Walk to an item and pick it up",
      requiresTarget: "item",
      countable: true
    },
    {
      type: "deliver_item",
      description: "Bring a specific item to a specific NPC",
      playerAction: "Talk to target NPC while holding the quest item",
      requiresTarget: "npc",
      countable: false
    },
    {
      type: "buy_item",
      description: "Purchase an item from a shop or merchant",
      playerAction: "Visit a shop and buy an item using gold",
      requiresTarget: "item",
      countable: true
    },
    {
      type: "sell_item",
      description: "Sell an item to a merchant",
      playerAction: "Talk to a merchant and sell an inventory item",
      requiresTarget: "item",
      countable: true
    },
    // ── Combat ───────────────────────────────────────────────────────────────
    {
      type: "defeat_enemies",
      description: "Defeat enemies in combat",
      playerAction: "Fight and defeat enemies using F key",
      requiresTarget: "none",
      countable: true
    },
    // ── Crafting ─────────────────────────────────────────────────────────────
    {
      type: "craft_item",
      description: "Craft a specific item using the crafting system",
      playerAction: "Gather materials and craft the item at a crafting station",
      requiresTarget: "item",
      countable: true
    },
    {
      type: "physical_action",
      description: "Perform a physical action at a hotspot (fishing, mining, farming, herbalism, etc.)",
      playerAction: "Approach a hotspot and press G to perform the action",
      requiresTarget: "none",
      countable: true
    },
    // ── Escort & Arrival ─────────────────────────────────────────────────────
    {
      type: "escort_npc",
      description: "Escort an NPC safely to a destination",
      playerAction: "Walk alongside an NPC to guide them to a location",
      requiresTarget: "npc",
      countable: false
    },
    // ── Social / Relationships ──────────────────────────────────────────────
    {
      type: "build_friendship",
      description: "Build a friendship with an NPC through repeated conversations",
      playerAction: "Have multiple conversations with the same NPC to build rapport",
      requiresTarget: "npc",
      countable: true
    },
    {
      type: "give_gift",
      description: "Give a gift item to an NPC to strengthen a relationship",
      playerAction: "Collect an item and present it to an NPC during conversation",
      requiresTarget: "npc",
      countable: false
    },
    // ── Reputation ───────────────────────────────────────────────────────────
    {
      type: "gain_reputation",
      description: "Gain reputation with a faction through positive actions",
      playerAction: "Complete tasks and interactions that improve faction standing",
      requiresTarget: "none",
      countable: false
    },
    // ── Listening & Comprehension ────────────────────────────────────────────
    {
      type: "listening_comprehension",
      description: "Listen to an NPC story and answer comprehension questions",
      playerAction: "Trigger NPC story, listen, then answer questions about it",
      requiresTarget: "npc",
      countable: true
    },
    // ── Translation ──────────────────────────────────────────────────────────
    {
      type: "translation_challenge",
      description: "Translate phrases between English and the target language",
      playerAction: "Type translations of prompted phrases",
      requiresTarget: "none",
      countable: true
    },
    // ── Navigation (language-based) ──────────────────────────────────────────
    {
      type: "navigate_language",
      description: "Follow directions given in the target language to reach waypoints",
      playerAction: "Read/listen to target-language directions and walk to each waypoint",
      requiresTarget: "location",
      countable: false
    },
    {
      type: "follow_directions",
      description: "Follow step-by-step directions in the target language",
      playerAction: "Interpret target-language instructions and follow them physically",
      requiresTarget: "none",
      countable: true
    },
    // ── Pronunciation ────────────────────────────────────────────────────────
    {
      type: "pronunciation_check",
      description: "Pronounce phrases aloud and get accuracy feedback",
      playerAction: "Press R to record voice and pronounce target-language phrases",
      requiresTarget: "none",
      countable: true
    },
    // ── Language Learning Actions ──────────────────────────────────────────
    {
      type: "examine_object",
      description: "Inspect a world object to see its name in the target language",
      playerAction: "Press X near an object or click it to examine and learn its name",
      requiresTarget: "item",
      countable: true
    },
    {
      type: "read_sign",
      description: "Read text on signs, menus, or books written in the target language",
      playerAction: "Approach a sign or readable surface and press X to read it",
      requiresTarget: "item",
      countable: true
    },
    {
      type: "write_response",
      description: "Compose written text in the target language in response to a prompt",
      playerAction: "Type a written response in the target language when prompted",
      requiresTarget: "none",
      countable: true
    },
    {
      type: "listen_and_repeat",
      description: "Listen to an NPC phrase and repeat it back via speech",
      playerAction: "Listen to the NPC, then press R to record and repeat the phrase",
      requiresTarget: "npc",
      countable: true
    },
    {
      type: "point_and_name",
      description: "Point at an object and name it in the target language",
      playerAction: "Click an object and type or speak its target-language name",
      requiresTarget: "item",
      countable: true
    },
    {
      type: "ask_for_directions",
      description: "Ask an NPC for directions using the target language",
      playerAction: "Talk to an NPC and request directions in the target language",
      requiresTarget: "npc",
      countable: true
    },
    {
      type: "order_food",
      description: "Order food or drinks at a restaurant or market in the target language",
      playerAction: "Talk to a vendor NPC and order items in the target language",
      requiresTarget: "npc",
      countable: true
    },
    {
      type: "haggle_price",
      description: "Negotiate a price with a merchant in the target language",
      playerAction: "Talk to a merchant NPC and negotiate the price in the target language",
      requiresTarget: "npc",
      countable: true
    },
    {
      type: "introduce_self",
      description: "Introduce yourself to an NPC in the target language",
      playerAction: "Talk to an NPC and introduce yourself in the target language",
      requiresTarget: "npc",
      countable: false
    },
    {
      type: "describe_scene",
      description: "Describe what you see in the current location in the target language",
      playerAction: "Type or speak a description of the scene in the target language",
      requiresTarget: "none",
      countable: true
    },
    // ── Text / Reading / Comprehension ─────────────────────────────────────
    {
      type: "find_text",
      description: "Find a book, document, or text item in the world",
      playerAction: "Explore the world to locate a specific book or document",
      requiresTarget: "item",
      countable: true
    },
    {
      type: "read_text",
      description: "Read the contents of a book, document, or text written in the target language",
      playerAction: "Open a collected book or document and read through its contents",
      requiresTarget: "item",
      countable: true
    },
    {
      type: "comprehension_quiz",
      description: "Answer comprehension questions about a text that was read",
      playerAction: "Answer multiple-choice or short-answer questions about a previously read text",
      requiresTarget: "none",
      countable: true
    },
    // ── Photography ─────────────────────────────────────────────────────────
    {
      type: "photograph_subject",
      description: "Take a photograph of a specific subject (item, NPC, building, or nature feature)",
      playerAction: "Use the camera to photograph the target subject",
      requiresTarget: "none",
      countable: true
    },
    {
      type: "photograph_activity",
      description: "Take a photograph of an NPC performing a specific activity (cooking, painting, reading, etc.)",
      playerAction: "Use the camera to photograph an NPC while they are performing the target activity",
      requiresTarget: "npc",
      countable: true
    },
    // ── Eavesdropping ──────────────────────────────────────────────────────
    {
      type: "eavesdrop",
      description: "Overhear a conversation between NPCs about a specific topic",
      playerAction: "Stand near two NPCs who are conversing to overhear their discussion",
      requiresTarget: "none",
      countable: true
    },
    // ── Observation ────────────────────────────────────────────────────────
    {
      type: "observe_activity",
      description: "Watch an NPC performing a specific activity by staying nearby for a period of time",
      playerAction: "Stand within 10m of an NPC performing the target activity for 5+ seconds",
      requiresTarget: "npc",
      countable: true
    },
    // ── Teaching (player teaches NPC) ────────────────────────────────────────
    {
      type: "teach_vocabulary",
      description: "Teach vocabulary words to an NPC by using them in conversation and confirming the NPC learned them",
      playerAction: "Talk to an NPC learner and use target-language words until the NPC demonstrates understanding",
      requiresTarget: "npc",
      countable: true
    },
    {
      type: "teach_phrase",
      description: "Teach a phrase or sentence to an NPC by modeling it and having the NPC repeat it",
      playerAction: "Talk to an NPC learner, model a phrase, and confirm they can repeat it",
      requiresTarget: "npc",
      countable: true
    }
  ];
  var VALID_OBJECTIVE_TYPES = new Set(
    ACHIEVABLE_OBJECTIVE_TYPES.map((t) => t.type)
  );
  var CONVERSATION_ONLY_OBJECTIVE_TYPES = /* @__PURE__ */ new Set([
    "talk_to_npc",
    "complete_conversation",
    "use_vocabulary",
    "listening_comprehension",
    "pronunciation_check",
    "translation_challenge",
    "listen_and_repeat",
    "ask_for_directions",
    "order_food",
    "haggle_price",
    "introduce_self",
    "describe_scene",
    "write_response",
    "build_friendship"
  ]);
  var CONVERSATION_ONLY_ACHIEVABLE_TYPES = ACHIEVABLE_OBJECTIVE_TYPES.filter(
    (t) => CONVERSATION_ONLY_OBJECTIVE_TYPES.has(t.type)
  );
  var NORMALIZATION_MAP = {
    // AI tends to generate these
    "talk_to": "talk_to_npc",
    "talk": "talk_to_npc",
    "speak_to": "talk_to_npc",
    "speak_with": "talk_to_npc",
    "converse": "talk_to_npc",
    "converse_with": "talk_to_npc",
    "interview": "talk_to_npc",
    "greet": "talk_to_npc",
    "meet": "talk_to_npc",
    "ask": "talk_to_npc",
    "npc_initiated": "conversation_initiation",
    "npc_initiation": "conversation_initiation",
    "npc_proactive": "conversation_initiation",
    "respond_to_npc": "conversation_initiation",
    "accept_conversation": "conversation_initiation",
    "npc_approach": "conversation_initiation",
    "reach_location": "visit_location",
    "go_to": "visit_location",
    "travel_to": "visit_location",
    "find_location": "visit_location",
    "explore": "discover_location",
    "explore_area": "discover_location",
    "discover": "discover_location",
    "investigate": "visit_location",
    "investigate_location": "visit_location",
    "search_area": "visit_location",
    "collect": "collect_item",
    "gather": "collect_item",
    "pick_up": "collect_item",
    "find_item": "collect_item",
    "obtain": "collect_item",
    "acquire": "collect_item",
    "buy_item": "collect_item",
    "purchase": "collect_item",
    "purchase_item": "collect_item",
    "shop": "collect_item",
    "shop_for": "collect_item",
    "buy_from": "collect_item",
    "collect_items": "collect_item",
    "deliver": "deliver_item",
    "bring_item": "deliver_item",
    "give_item": "deliver_item",
    "hand_over": "deliver_item",
    "kill": "defeat_enemies",
    "defeat": "defeat_enemies",
    "fight": "defeat_enemies",
    "combat": "defeat_enemies",
    "slay": "defeat_enemies",
    "eliminate": "defeat_enemies",
    "craft": "craft_item",
    "create_item": "craft_item",
    "build": "craft_item",
    "forge": "craft_item",
    "forge_item": "craft_item",
    "smith": "craft_item",
    "assemble": "craft_item",
    "brew": "craft_item",
    "brew_potion": "craft_item",
    "cook_item": "craft_item",
    "weave": "craft_item",
    "sew_item": "craft_item",
    "escort": "escort_npc",
    "protect": "escort_npc",
    "accompany": "escort_npc",
    "guard": "escort_npc",
    "befriend": "build_friendship",
    "befriend_npc": "build_friendship",
    "make_friend": "build_friendship",
    "friendship": "build_friendship",
    "build_rapport": "build_friendship",
    "bond_with": "build_friendship",
    "socialize": "build_friendship",
    "gift": "give_gift",
    "present_gift": "give_gift",
    "give_present": "give_gift",
    "gift_item": "give_gift",
    "offer_gift": "give_gift",
    "reputation": "gain_reputation",
    "improve_standing": "gain_reputation",
    "listen": "listening_comprehension",
    "comprehension": "listening_comprehension",
    "listen_to_story": "listening_comprehension",
    "answer_questions": "comprehension_quiz",
    "translate": "translation_challenge",
    "translation": "translation_challenge",
    "navigate": "navigate_language",
    "follow_path": "follow_directions",
    "follow_route": "follow_directions",
    "pronounce": "pronunciation_check",
    "speak_aloud": "pronunciation_check",
    "read_aloud": "pronunciation_check",
    "use_words": "use_vocabulary",
    "vocabulary_usage": "use_vocabulary",
    "practice_vocabulary": "use_vocabulary",
    "use_word": "use_vocabulary",
    "identify": "identify_object",
    "name_object": "identify_object",
    "label_object": "identify_object",
    "learn_vocabulary": "collect_vocabulary",
    "collect_words": "collect_vocabulary",
    "find_words": "collect_vocabulary",
    "collect_book": "collect_text",
    "collect_letter": "collect_text",
    "collect_journal": "collect_text",
    "collect_scroll": "collect_text",
    "find_text": "collect_text",
    "pick_up_text": "collect_text",
    "gather_text": "collect_text",
    "text_collected": "collect_text",
    // Business scavenger hunt aliases
    "visit_business": "visit_location",
    "enter_business": "visit_location",
    "enter_shop": "visit_location",
    "visit_shop": "visit_location",
    "identify_business_item": "identify_object",
    "name_item": "identify_object",
    "name_business_item": "identify_object",
    "find_item_in_business": "identify_object",
    "get_clue": "talk_to_npc",
    "get_clue_from_owner": "talk_to_npc",
    "ask_owner": "talk_to_npc",
    "collect_business_item": "collect_item",
    // Customer service quest aliases
    "request_refund": "complete_conversation",
    "explain_problem": "complete_conversation",
    "negotiate_resolution": "complete_conversation",
    "reserve_slot": "complete_conversation",
    "describe_preference": "complete_conversation",
    "express_urgency": "complete_conversation",
    "make_return": "complete_conversation",
    "file_complaint": "complete_conversation",
    "make_reservation": "complete_conversation",
    "ask_recommendation": "complete_conversation",
    "request_exchange": "complete_conversation",
    "complain": "complete_conversation",
    "reserve": "complete_conversation",
    "book_table": "complete_conversation",
    "book_room": "complete_conversation",
    // Language learning action aliases
    "examine": "examine_object",
    "inspect_object": "examine_object",
    "inspect": "examine_object",
    "read": "read_sign",
    "read_text": "read_sign",
    "read_menu": "read_sign",
    "write": "write_response",
    "compose": "write_response",
    "repeat": "listen_and_repeat",
    "repeat_phrase": "listen_and_repeat",
    "name": "point_and_name",
    "label": "point_and_name",
    "ask_directions": "ask_for_directions",
    "get_directions": "ask_for_directions",
    "order": "order_food",
    "order_at_restaurant": "order_food",
    "haggle": "haggle_price",
    "negotiate": "haggle_price",
    "negotiate_price": "haggle_price",
    "introduce": "introduce_self",
    "introduction": "introduce_self",
    "describe": "describe_scene",
    "describe_surroundings": "describe_scene",
    // Storytelling / narrative quest aliases
    "tell_story": "complete_conversation",
    "retell_story": "complete_conversation",
    "narrate": "complete_conversation",
    "storytelling": "complete_conversation",
    "collaborative_story": "complete_conversation",
    "retell": "complete_conversation",
    // Legacy template types that need normalization
    "learn_new_words": "collect_vocabulary",
    "find_vocabulary_items": "identify_object",
    "use_vocabulary_category": "use_vocabulary",
    "master_words": "use_vocabulary",
    "sustained_conversation": "complete_conversation",
    "practice_grammar": "use_vocabulary",
    // SRS / spaced repetition review variations
    "review_vocabulary": "use_vocabulary",
    "vocabulary_review": "use_vocabulary",
    "srs_review": "use_vocabulary",
    "spaced_repetition": "use_vocabulary",
    "review_words": "use_vocabulary",
    "practice_words": "use_vocabulary",
    "reinforce_vocabulary": "use_vocabulary",
    "recall_vocabulary": "use_vocabulary",
    // Teaching-back objective aliases
    "teach_word": "teach_vocabulary",
    "teach_words": "teach_vocabulary",
    "teach_npc_vocabulary": "teach_vocabulary",
    "teach_npc_words": "teach_vocabulary",
    "teach_npc": "teach_vocabulary",
    "tutor_vocabulary": "teach_vocabulary",
    "teach_sentence": "teach_phrase",
    "teach_npc_phrase": "teach_phrase",
    "teach_expression": "teach_phrase",
    "model_phrase": "teach_phrase",
    "tutor_phrase": "teach_phrase",
    // Text / reading / comprehension aliases
    "find_book": "find_text",
    "find_document": "find_text",
    "locate_text": "find_text",
    "locate_book": "find_text",
    "locate_document": "find_text",
    "find_scroll": "find_text",
    "search_text": "find_text",
    "read_book": "read_text",
    "read_document": "read_text",
    "read_scroll": "read_text",
    "read_letter": "read_text",
    "read_page": "read_text",
    "study_text": "read_text",
    "complete_reading": "read_text",
    "text_quiz": "comprehension_quiz",
    "reading_quiz": "comprehension_quiz",
    "reading_comprehension": "comprehension_quiz",
    "text_comprehension": "comprehension_quiz",
    "book_quiz": "comprehension_quiz",
    "answer_about_text": "comprehension_quiz",
    // Photography objective aliases
    "photograph": "photograph_subject",
    "take_photo": "photograph_subject",
    "take_photograph": "photograph_subject",
    "photo": "photograph_subject",
    "snap_photo": "photograph_subject",
    "capture_photo": "photograph_subject",
    "photograph_item": "photograph_subject",
    "photograph_npc": "photograph_subject",
    "photograph_building": "photograph_subject",
    "photograph_nature": "photograph_subject",
    "photo_subject": "photograph_subject",
    // Photography activity aliases
    "photo_activity": "photograph_activity",
    "photograph_npc_activity": "photograph_activity",
    "capture_activity": "photograph_activity",
    "photo_action": "photograph_activity",
    // Observation activity aliases
    "watch_activity": "observe_activity",
    "observe_npc": "observe_activity",
    "watch_npc": "observe_activity",
    "observe_work": "observe_activity",
    "watch_work": "observe_activity",
    "observe": "observe_activity",
    // Eavesdrop aliases
    "overhear": "eavesdrop",
    "overhear_conversation": "eavesdrop",
    "listen_to_conversation": "eavesdrop",
    "eavesdrop_conversation": "eavesdrop",
    "spy_on_conversation": "eavesdrop",
    // Grammar-focused objective aliases (map to canonical types)
    "grammar_pattern": "use_vocabulary",
    "grammar_practice": "use_vocabulary",
    "grammar_drill": "use_vocabulary",
    "conjugation": "use_vocabulary",
    "conjugate": "use_vocabulary",
    "grammar_conversation": "complete_conversation",
    "grammar_focus": "complete_conversation"
  };
  function normalizeObjectiveType(type) {
    if (!type) return null;
    const cleaned = type.toLowerCase().trim();
    if (VALID_OBJECTIVE_TYPES.has(cleaned)) return cleaned;
    if (NORMALIZATION_MAP[cleaned]) return NORMALIZATION_MAP[cleaned];
    const withUnderscores = cleaned.replace(/\s+/g, "_");
    if (VALID_OBJECTIVE_TYPES.has(withUnderscores)) return withUnderscores;
    if (NORMALIZATION_MAP[withUnderscores]) return NORMALIZATION_MAP[withUnderscores];
    return null;
  }
  var OBJECTIVE_TYPE_DEFAULTS = {
    // Conversation types — minimum 4 exchanges matches MIN_ASSESSMENT_TURNS in BabylonGame
    conversation: { requiredCount: 4 },
    arrival_conversation: { requiredCount: 4 },
    departure_conversation: { requiredCount: 4 },
    periodic_conversational: { requiredCount: 4 },
    complete_conversation: { requiredCount: 5 },
    conversation_turns: { requiredCount: 5 },
    // Language skill types
    use_vocabulary: { requiredCount: 10 },
    collect_vocabulary: { requiredCount: 10 },
    pronunciation_check: { requiredCount: 3 },
    listen_and_repeat: { requiredCount: 3 },
    listening_comprehension: { requiredCount: 3 },
    translation_challenge: { requiredCount: 3 },
    comprehension_quiz: { requiredCount: 3 },
    teach_vocabulary: { requiredCount: 3 },
    grammar: { requiredCount: 2 },
    // Writing types
    writing: { minWordCount: 20 },
    arrival_writing: { minWordCount: 20 },
    departure_writing: { minWordCount: 20 },
    write_response: { requiredCount: 1, minWordCount: 20 },
    describe_scene: { requiredCount: 1, minWordCount: 20 },
    // Social types
    build_friendship: { requiredStrength: 0.5 },
    gain_reputation: { reputationRequired: 100 },
    // Observation types
    observe_activity: { observeDurationSeconds: 5 }
  };
  function getDefaultRequiredCount(objectiveType) {
    return OBJECTIVE_TYPE_DEFAULTS[objectiveType]?.requiredCount ?? 1;
  }

  // @insimul/core/src/game-engine/logic/pronunciation-helpers.ts
  var DIFFICULTY_CONFIGS = {
    beginner: {
      maxDistanceRatio: 0.4,
      passThreshold: 40,
      ignoreAccents: true,
      ignorePunctuation: true
    },
    intermediate: {
      maxDistanceRatio: 0.25,
      passThreshold: 55,
      ignoreAccents: true,
      ignorePunctuation: false
    },
    advanced: {
      maxDistanceRatio: 0.15,
      passThreshold: 70,
      ignoreAccents: false,
      ignorePunctuation: false
    },
    native: {
      maxDistanceRatio: 0.08,
      passThreshold: 85,
      ignoreAccents: false,
      ignorePunctuation: false
    }
  };
  var PRONUNCIATION_RETRY_THRESHOLD = 60;
  function hintPenaltyMultiplier(hints, hintsRevealed) {
    if (!hints || hints.length === 0 || hintsRevealed <= 0) return 1;
    let totalPenalty = 0;
    for (let i = 0; i < hintsRevealed && i < hints.length; i++) {
      totalPenalty += hints[i].scorePenalty;
    }
    return Math.max(0, 1 - totalPenalty);
  }
  function applyHintPenalty(rawScore, hints, hintsRevealed) {
    return Math.max(0, rawScore * hintPenaltyMultiplier(hints, hintsRevealed));
  }
  function wordResultsToFeedback(wordResults) {
    return wordResults.filter((w) => w.match !== "extra").map((w) => ({
      word: w.expected,
      status: w.match === "missed" ? "missed" : w.similarity >= 0.9 ? "good" : w.similarity >= 0.6 ? "acceptable" : "needs_work",
      similarity: w.similarity
    }));
  }
  var CORRECTION_TEMPLATES = {
    encouraging: {
      close: [
        `"{npc} smiles warmly" Almost! You said "{input}" \u2014 try "{correct}" instead. You're so close!`,
        '"{npc} nods encouragingly" Good try! The right way to say it is "{correct}". Keep it up!',
        '"{npc} tilts their head" Not quite, but I can see what you meant. It should be "{correct}".'
      ],
      far: [
        `"{npc} smiles patiently" That's not quite right, but don't worry! The word you're looking for is "{correct}".`,
        '"{npc} gestures kindly" Let me help \u2014 you want to say "{correct}". Try again!'
      ],
      generic: [
        `"{npc} gives a reassuring look" Not quite, but you're learning! Try again.`,
        `"{npc} encourages you" Keep trying, you'll get it!`
      ]
    },
    strict: {
      close: [
        `"{npc} shakes their head" No. It's "{correct}", not "{input}". Pay attention to the details.`,
        '"{npc} corrects you firmly" Close, but incorrect. The proper form is "{correct}".'
      ],
      far: [
        '"{npc} frowns" That is wrong. The correct answer is "{correct}". Study harder.',
        '"{npc} crosses their arms" Incorrect. You need to say "{correct}". Practice more.'
      ],
      generic: [
        `"{npc} looks unimpressed" That's not right. Try again, and think carefully this time.`,
        '"{npc} taps their foot" Incorrect. Focus and try once more.'
      ]
    },
    humorous: {
      close: [
        `"{npc} chuckles" Ha! Close, but you just said something funny. It's "{correct}", not "{input}"!`,
        '"{npc} grins" Almost! But what you said means... well, never mind. Try "{correct}".'
      ],
      far: [
        `"{npc} laughs" Oh my! That's... creative, but the word is "{correct}". Let me teach you!`,
        `"{npc} wipes a tear of laughter" You just asked for a dancing goat! It's "{correct}".`
      ],
      generic: [
        '"{npc} smirks" Nice try, but not quite! Want to give it another shot?',
        `"{npc} laughs good-naturedly" That was entertaining, but let's try again!`
      ]
    },
    patient: {
      close: [
        `"{npc} speaks slowly" You're very close. Listen carefully: "{correct}". Can you hear the difference?`,
        '"{npc} repeats gently" Almost right. Let me say it again: "{correct}". The key part is slightly different.'
      ],
      far: [
        '"{npc} pauses thoughtfully" Let me show you step by step. The phrase is "{correct}". Try saying it with me.',
        '"{npc} sits down beside you" No rush. The word is "{correct}". Take your time and try again.'
      ],
      generic: [
        `"{npc} waits patiently" That wasn't quite right, but learning takes time. Shall we try again?`,
        `"{npc} gives a gentle nod" Not yet, but you're on the right path. Let's keep going.`
      ]
    },
    scholarly: {
      close: [
        '"{npc} adjusts their glasses" Interesting attempt. Linguistically, the correct form is "{correct}" \u2014 note the morphological difference from "{input}".',
        '"{npc} strokes their chin" Close! "{correct}" follows the conjugation pattern of this verb class. Your "{input}" was off by the suffix.'
      ],
      far: [
        '"{npc} consults a book" The etymologically correct form is "{correct}". This derives from the root that means...',
        '"{npc} points to a chart" The proper term is "{correct}". In this language family, the phonemic structure requires...'
      ],
      generic: [
        '"{npc} looks scholarly" Not quite. Consider the grammatical rules we discussed. Try once more.',
        '"{npc} taps the textbook" Review the pattern and attempt it again.'
      ]
    }
  };
  var PRAISE_TEMPLATES = {
    encouraging: {
      excellent: ['"{npc} beams with pride" Perfect! You said it beautifully!', '"{npc} claps" Wonderful! That was flawless!'],
      good: [`"{npc} smiles" Very good! You're making great progress!`, '"{npc} nods approvingly" Nice work! Keep it up!'],
      okay: [`"{npc} gives a thumbs up" That works! You're getting there!`, '"{npc} nods" Good enough to be understood. Keep practicing!']
    },
    strict: {
      excellent: ['"{npc} gives a rare nod of approval" Correct. Well done.', '"{npc} looks satisfied" Precisely right.'],
      good: ['"{npc} nods curtly" Acceptable. Your pronunciation could still improve.', '"{npc}" Adequate. Continue practicing.'],
      okay: ['"{npc} sighs" It will do. But strive for perfection.', '"{npc}" Barely passable. Do better next time.']
    },
    humorous: {
      excellent: [`"{npc} does a little dance" You nailed it! I'm out of a job!`, '"{npc} gasps" Wait, did you just say that perfectly?!'],
      good: [`"{npc} grins" Hey, that was pretty good! Maybe you'll be fluent by next century.`, '"{npc} applauds" Not bad at all!'],
      okay: ['"{npc} shrugs with a smile" Close enough! At least nobody will run away screaming.', `"{npc} winks" That'll do!`]
    },
    patient: {
      excellent: [`"{npc} smiles warmly" Beautiful. You've been practicing, haven't you?`, `"{npc} nods slowly" Perfect. I'm very proud of you.`],
      good: [`"{npc} looks pleased" Very good. You're making steady progress.`, '"{npc} smiles" Well done. Each time it gets easier.'],
      okay: [`"{npc} nods gently" That's coming along nicely. Keep at it.`, `"{npc}" You're improving. Every attempt counts.`]
    },
    scholarly: {
      excellent: ['"{npc} marks their notes" Exemplary. Your phonemic accuracy is remarkable.', '"{npc} nods" Textbook perfect. You have an ear for this.'],
      good: ['"{npc} scribbles a note" Good command of the morphology. Minor improvements possible.', '"{npc}" Solid performance. Your grasp of the syntax is evident.'],
      okay: ['"{npc} adjusts their glasses" Functionally correct. The prosody needs refinement.', '"{npc}" Understandable. Work on the tonal patterns.']
    }
  };
  function pick(arr3, rng = Math.random) {
    return arr3[Math.floor(rng() * arr3.length)];
  }
  function generateCorrectionResponse(input, correct, score, ctx, rng = Math.random) {
    const templates = CORRECTION_TEMPLATES[ctx.style];
    const bucket = score >= 30 && correct ? templates.close : correct ? templates.far : templates.generic;
    return pick(bucket, rng).replace("{npc}", ctx.npcName).replace("{correct}", correct).replace("{input}", input);
  }
  function generatePraiseResponse(score, ctx, rng = Math.random) {
    const templates = PRAISE_TEMPLATES[ctx.style];
    const bucket = score >= 90 ? templates.excellent : score >= 70 ? templates.good : templates.okay;
    return pick(bucket, rng).replace("{npc}", ctx.npcName);
  }

  // @insimul/core/src/game-engine/logic/QuestCompletionEngine.ts
  var _QuestCompletionEngine = class _QuestCompletionEngine {
    constructor() {
      __publicField(this, "quests", []);
      __publicField(this, "onObjectiveCompleted", null);
      __publicField(this, "onObjectiveProgress", null);
      __publicField(this, "onQuestCompleted", null);
      __publicField(this, "onPronunciationFeedback", null);
      __publicField(this, "correctionContext", null);
    }
    // ── Quest management ────────────────────────────────────────────────────
    addQuest(quest) {
      if (quest.objectives) {
        for (const obj3 of quest.objectives) {
          const normalized = normalizeObjectiveType(obj3.type);
          if (normalized) obj3.type = normalized;
        }
      }
      this.quests.push(quest);
    }
    removeQuest(questId) {
      const idx = this.quests.findIndex((q) => q.id === questId);
      if (idx !== -1) this.quests.splice(idx, 1);
    }
    getQuests() {
      return this.quests;
    }
    clear() {
      this.quests = [];
    }
    // ── Callbacks ───────────────────────────────────────────────────────────
    setOnObjectiveCompleted(cb) {
      this.onObjectiveCompleted = cb;
    }
    setOnObjectiveProgress(cb) {
      this.onObjectiveProgress = cb;
    }
    setOnQuestCompleted(cb) {
      this.onQuestCompleted = cb;
    }
    setOnPronunciationFeedback(cb) {
      this.onPronunciationFeedback = cb;
    }
    // ── Correction context (for NPC correction/praise responses) ────────────
    /** Set the active NPC context for generating correction responses during
     *  pronunciation/utterance evaluation. */
    setCorrectionContext(ctx) {
      this.correctionContext = ctx;
    }
    /** Clear the active correction context (e.g. when leaving a conversation). */
    clearCorrectionContext() {
      this.correctionContext = null;
    }
    /** Read the current correction context (null if none). */
    getCorrectionContext() {
      return this.correctionContext;
    }
    // ── Hints ───────────────────────────────────────────────────────────────
    /**
     * Reveal the next hint on an objective, incrementing the reveal count.
     * Returns the hint text (or null if no more hints available). Each revealed
     * hint applies its `scorePenalty` to the effective score of future
     * successful attempts.
     */
    revealHint(questId, objectiveId) {
      const quest = this.quests.find((q) => q.id === questId);
      if (!quest) return null;
      const obj3 = quest.objectives?.find((o) => o.id === objectiveId);
      if (!obj3) return null;
      const hints = obj3.hints ?? [];
      const revealed = obj3.hintsRevealed ?? 0;
      if (revealed >= hints.length) return null;
      const hint = hints[revealed];
      obj3.hintsRevealed = revealed + 1;
      return hint.text;
    }
    // ── Unified event dispatch ──────────────────────────────────────────────
    trackEvent(event) {
      switch (event.type) {
        case "npc_conversation":
          this.trackNPCConversation(event.npcId, event.questId);
          break;
        case "vocabulary_usage":
          this.trackVocabularyUsage(event.word, event.questId);
          break;
        case "conversation_turn":
          this.trackConversationTurn(event.keywords, event.questId);
          break;
        case "collect_item_by_name":
          this.trackCollectedItemByName(event.itemName, event.questId);
          break;
        case "item_delivery":
          this.trackItemDelivery(event.npcId, event.playerItemNames, event.questId);
          break;
        case "inventory_check":
          this.checkInventoryObjectives(event.playerItemNames, event.questId);
          break;
        case "enemy_defeat":
          this.trackEnemyDefeat(event.enemyType, event.questId);
          break;
        case "item_crafted":
          this.trackItemCrafted(event.itemId, event.questId);
          break;
        case "location_discovery":
          this.trackLocationVisit(event.locationId, event.locationName || event.locationId, event.questId);
          break;
        case "arrival":
          this.trackArrival(event.npcOrItemId, event.destinationReached, event.questId);
          break;
        case "reputation_gain":
          this.trackReputationGain(event.factionId, event.amount, event.questId);
          break;
        case "listening_answer":
          this.trackListeningAnswer(event.isCorrect, event.questId);
          break;
        case "translation_attempt":
          this.trackTranslationAttempt(event.isCorrect, event.questId);
          break;
        case "navigation_waypoint":
          this.trackNavigationWaypoint(event.questId);
          break;
        case "pronunciation_attempt":
          this.trackPronunciationAttempt(event.passed, event.questId, event.score, event.phrase);
          break;
        case "location_visit":
          this.completeObjective(event.questId, event.objectiveId);
          break;
        case "objective_direct_complete":
          this.completeObjective(event.questId, event.objectiveId);
          break;
        case "conversation_initiation":
          this.trackConversationInitiation(event.npcId, event.accepted, event.responseQuality, event.questId);
          break;
        case "writing_submitted":
          this.trackWritingSubmission(event.text, event.wordCount, event.questId);
          break;
        case "teach_word":
          this.trackTeachWord(event.npcId, event.word, event.questId);
          break;
        case "teach_phrase_to_npc":
          this.trackTeachPhrase(event.npcId, event.phrase, event.questId);
          break;
        case "object_identified":
          this.trackObjectIdentified(event.objectName, event.questId);
          break;
        case "object_examined":
          this.trackObjectExamined(event.objectName, event.questId);
          break;
        case "sign_read":
          this.trackSignRead(event.signId, event.questId);
          break;
        case "object_pointed_and_named":
          this.trackPointAndName(event.objectName, event.questId);
          break;
        case "npc_conversation_turn":
          this.trackNpcConversationTurn(event.npcId, event.topicTag, event.questId);
          break;
        case "gift_given":
          this.trackGiftGiven(event.npcId, event.itemName, event.questId);
          break;
        case "direction_step_completed":
          this.trackDirectionStep(event.questId);
          break;
        case "food_ordered":
          this.trackFoodOrdered(event.itemName, event.merchantId, event.businessType, event.questId);
          break;
        case "price_haggled":
          this.trackPriceHaggled(event.itemName, event.merchantId, event.typedWord, event.questId);
          break;
        case "text_found":
          this.trackTextFound(event.textId, event.textName, event.questId);
          break;
        case "text_read":
          this.trackTextRead(event.textId, event.questId);
          break;
        case "comprehension_answer":
          this.trackComprehensionAnswer(event.isCorrect, event.questId);
          break;
        case "clue_discovered":
          this.trackByTrigger("clue_discovered", event.questId);
          this.forEachObjective(event.questId, "collect_clue", (quest, obj3) => {
            obj3.currentCount = (obj3.currentCount || 0) + 1;
            if (obj3.currentCount >= (obj3.requiredCount || 1)) {
              this.completeObjective(quest.id, obj3.id);
            } else {
              this.onObjectiveProgress?.(quest.id, obj3.id, obj3.currentCount, obj3.requiredCount || 1, obj3.type);
            }
          });
          break;
        case "photo_taken":
          this.trackPhotoTaken(event.subjectName, event.subjectCategory, event.subjectActivity, event.questId);
          break;
        case "assessment_phase_completed":
          this.completeObjective(event.questId, event.objectiveId);
          break;
        case "reading_completed":
          this.trackByTrigger("reading_completed", event.questId);
          this.forEachObjective(event.questId, ["reading", "arrival_reading", "departure_reading"], (quest, obj3) => {
            this.completeObjective(quest.id, obj3.id);
          });
          break;
        case "listening_completed":
          this.trackByTrigger("listening_completed", event.questId);
          this.forEachObjective(event.questId, ["listening", "arrival_listening", "departure_listening"], (quest, obj3) => {
            this.completeObjective(quest.id, obj3.id);
          });
          break;
        case "npc_talked":
          this.trackByTrigger("npc_talked", event.questId);
          this.forEachObjective(event.questId, ["initiate_conversation", "arrival_initiate_conversation"], (quest, obj3) => {
            if (obj3.npcId && obj3.npcId !== event.npcId) return;
            this.completeObjective(quest.id, obj3.id);
          });
          break;
        case "conversation_assessment_completed":
          this.forEachObjective(event.questId, ["conversation", "arrival_conversation", "departure_conversation", "periodic_conversational"], (quest, obj3) => {
            if (obj3.npcId && obj3.npcId !== event.npcId) return;
            obj3.currentCount = event.turnCount;
            const required2 = obj3.requiredCount || getDefaultRequiredCount(obj3.type);
            if (event.turnCount >= required2) {
              this.completeObjective(quest.id, obj3.id);
            }
          });
          break;
        case "conversational_action":
          this.trackConversationalAction(event.action, event.npcId, event.topic, event.questId);
          break;
        case "conversation_turn_counted":
          this.trackConversationTurnCounted(event.npcId, event.totalTurns, event.meaningfulTurns, event.questId);
          break;
        case "physical_action":
          this.trackPhysicalAction(event.actionType, event.itemsProduced, event.questId);
          break;
        case "activity_observed":
          this.trackActivityObserved(event.npcId, event.npcName, event.activity, event.durationSeconds, event.questId);
          break;
        case "activity_photographed":
          this.trackActivityPhotographed(event.npcId, event.npcName, event.activity, event.questId);
          break;
        case "conversation_goal_evaluated":
          this.trackConversationGoalResult(event.questId, event.objectiveId, event.goalMet, event.confidence, event.extractedInfo);
          break;
        case "eavesdrop":
          this.trackEavesdrop(event.npcId1, event.npcId2, event.topic, event.languageUsed, event.questId);
          break;
        case "assessment_completed_event":
          this.forEachObjective(event.questId, "complete_assessment", (quest, obj3) => {
            this.completeObjective(quest.id, obj3.id);
          });
          break;
        case "grammar_demonstrated":
          this.trackGrammarDemonstrated(event.patternCount, event.questId);
          break;
        case "item_purchased":
          this.trackItemPurchased(event.itemName, event.merchantId, event.questId);
          break;
        case "item_sold":
          this.trackItemSold(event.itemName, event.questId);
          break;
        case "listen_and_repeat_passed":
          this.trackListenAndRepeat(event.passed, event.phrase, event.questId);
          break;
        case "friendship_changed":
          this.trackFriendshipBuilt(event.npcId, event.relationshipStrength, event.questId);
          break;
      }
      this.handleGameEvent(event);
    }
    // ── Core completion logic ───────────────────────────────────────────────
    completeObjective(questId, objectiveId) {
      const quest = this.quests.find((q) => q.id === questId);
      if (!quest) return false;
      const objective = quest.objectives?.find((o) => o.id === objectiveId);
      if (!objective || objective.completed) return false;
      if (this.isObjectiveLocked(quest, objective)) return false;
      objective.completed = true;
      const required2 = objective.requiredCount ?? 1;
      objective.currentCount = Math.max(objective.currentCount ?? 0, required2);
      this.onObjectiveCompleted?.(questId, objectiveId);
      const allComplete = quest.objectives?.every((o) => o.completed);
      if (allComplete) {
        this.onQuestCompleted?.(questId);
      }
      return true;
    }
    /**
     * Check if an objective is locked due to unmet dependencies.
     * An objective is locked if:
     * 1. It has `dependsOn` IDs and any of those objectives are incomplete, OR
     * 2. It has an `order` value and any objective with a lower `order` is incomplete.
     */
    isObjectiveLocked(quest, objective) {
      const objectives = quest.objectives || [];
      if (objective.dependsOn && objective.dependsOn.length > 0) {
        for (const depId of objective.dependsOn) {
          const dep = objectives.find((o) => o.id === depId);
          if (dep && !dep.completed) return true;
        }
      }
      if (objective.order != null) {
        for (const other of objectives) {
          if (other.id === objective.id) continue;
          if (other.order != null && other.order < objective.order && !other.completed) {
            return true;
          }
        }
      }
      return false;
    }
    /**
     * Get all currently available (unlocked, incomplete) objectives for a quest.
     */
    getAvailableObjectives(questId) {
      const quest = this.quests.find((q) => q.id === questId);
      if (!quest) return [];
      return (quest.objectives || []).filter(
        (o) => !o.completed && !this.isObjectiveLocked(quest, o)
      );
    }
    /**
     * Unified check: is a specific objective complete?
     * All UI components should use this instead of reading objective fields directly.
     */
    isObjectiveComplete(questId, objectiveId) {
      const quest = this.quests.find((q) => q.id === questId);
      if (!quest) return false;
      const objective = quest.objectives?.find((o) => o.id === objectiveId);
      return !!objective?.completed;
    }
    /**
     * Check if all objectives for a quest are complete.
     */
    isQuestComplete(questId) {
      const quest = this.quests.find((q) => q.id === questId);
      if (!quest?.objectives?.length) return false;
      return quest.objectives.every((o) => o.completed);
    }
    /**
     * Get all locked (incomplete, dependencies not met) objectives for a quest.
     */
    getLockedObjectives(questId) {
      const quest = this.quests.find((q) => q.id === questId);
      if (!quest) return [];
      return (quest.objectives || []).filter(
        (o) => !o.completed && this.isObjectiveLocked(quest, o)
      );
    }
    // ── Type-specific tracking methods ──────────────────────────────────────
    trackNPCConversation(npcId, questId) {
      this.forEachObjective(questId, ["talk_to_npc", "introduce_self", "ask_for_directions"], (quest, obj3) => {
        if (obj3.npcId === npcId) {
          this.completeObjective(quest.id, obj3.id);
        }
      });
    }
    trackConversationInitiation(npcId, accepted, responseQuality, questId) {
      if (!accepted) return;
      this.forEachObjective(questId, "conversation_initiation", (quest, obj3) => {
        if (obj3.npcId && obj3.npcId !== npcId) return;
        obj3.currentCount = (obj3.currentCount || 0) + 1;
        if (responseQuality !== void 0) {
          obj3.responseQuality = responseQuality;
        }
        const minQuality = obj3.minResponseQuality ?? 0;
        const meetsQuality = (responseQuality ?? 100) >= minQuality;
        if (obj3.currentCount >= (obj3.requiredCount || 1) && meetsQuality) {
          this.completeObjective(quest.id, obj3.id);
        }
      });
    }
    // Also track against 'vocabulary' objective type (alias used in some quests)
    trackVocabularyUsage(word, questId) {
      const lowerWord = word.toLowerCase();
      this.forEachObjective(questId, ["use_vocabulary", "collect_vocabulary", "vocabulary"], (quest, obj3) => {
        if (obj3.targetWords && obj3.targetWords.length > 0) {
          if (!obj3.targetWords.includes(lowerWord)) return;
        }
        obj3.wordsUsed = obj3.wordsUsed || [];
        if (obj3.wordsUsed.includes(lowerWord)) return;
        obj3.wordsUsed.push(lowerWord);
        obj3.currentCount = (obj3.currentCount || 0) + 1;
        const required2 = obj3.requiredCount || getDefaultRequiredCount("use_vocabulary");
        if (obj3.currentCount >= required2) {
          this.completeObjective(quest.id, obj3.id);
        } else {
          this.onObjectiveProgress?.(quest.id, obj3.id, obj3.currentCount, required2, obj3.type);
        }
      });
    }
    trackConversationTurn(keywords, questId) {
      this.forEachObjective(questId, ["complete_conversation", "conversation"], (quest, obj3) => {
        obj3.currentCount = (obj3.currentCount || 0) + 1;
        const required2 = obj3.requiredCount || getDefaultRequiredCount(obj3.type);
        if (obj3.currentCount >= required2) {
          this.completeObjective(quest.id, obj3.id);
        } else {
          this.onObjectiveProgress?.(quest.id, obj3.id, obj3.currentCount, required2, obj3.type);
        }
      });
    }
    // ── Missing objective type handlers (added for full quest coverage) ────
    trackGrammarDemonstrated(patternCount, questId) {
      this.forEachObjective(questId, "grammar", (quest, obj3) => {
        obj3.currentCount = (obj3.currentCount || 0) + patternCount;
        const required2 = obj3.requiredCount || getDefaultRequiredCount("grammar");
        if (obj3.currentCount >= required2) {
          this.completeObjective(quest.id, obj3.id);
        } else {
          this.onObjectiveProgress?.(quest.id, obj3.id, obj3.currentCount, required2, obj3.type);
        }
      });
    }
    trackItemPurchased(itemName, merchantId, questId) {
      this.forEachObjective(questId, "buy_item", (quest, obj3) => {
        obj3.currentCount = (obj3.currentCount || 0) + 1;
        if (obj3.currentCount >= (obj3.requiredCount || 1)) {
          this.completeObjective(quest.id, obj3.id);
        }
      });
    }
    trackItemSold(itemName, questId) {
      this.forEachObjective(questId, "sell_item", (quest, obj3) => {
        obj3.currentCount = (obj3.currentCount || 0) + 1;
        if (obj3.currentCount >= (obj3.requiredCount || 1)) {
          this.completeObjective(quest.id, obj3.id);
        }
      });
    }
    trackListenAndRepeat(passed, phrase, questId) {
      this.forEachObjective(questId, "listen_and_repeat", (quest, obj3) => {
        if (!passed) return;
        obj3.currentCount = (obj3.currentCount || 0) + 1;
        if (obj3.currentCount >= (obj3.requiredCount || getDefaultRequiredCount("listen_and_repeat"))) {
          this.completeObjective(quest.id, obj3.id);
        }
      });
    }
    trackFriendshipBuilt(npcId, relationshipStrength, questId) {
      this.forEachObjective(questId, "build_friendship", (quest, obj3) => {
        if (obj3.npcId && obj3.npcId !== npcId) return;
        const threshold = obj3.requiredStrength ?? OBJECTIVE_TYPE_DEFAULTS["build_friendship"]?.requiredStrength ?? 0.5;
        if (relationshipStrength >= threshold) {
          this.completeObjective(quest.id, obj3.id);
        }
      });
    }
    /**
     * Track a collected item against collect_item objectives.
     * Supports exact match, partial match (objective 'herbs' matches 'Healing Herbs'),
     * and category match. Handles quantity-based objectives (itemCount/collectedCount).
     * Returns matched quest/objective info for notification display.
     */
    trackCollectedItemByName(itemName, questId, category) {
      const key = itemName.toLowerCase();
      const catKey = category?.toLowerCase();
      const matches = [];
      this.forEachObjective(questId, "collect_item", (quest, obj3) => {
        const objName = (obj3.itemName || "").toLowerCase();
        if (!objName) return;
        const exactMatch = objName === key;
        const substringMatch = key.includes(objName) || objName.includes(key);
        const categoryExact = catKey ? objName === catKey : false;
        const categorySubstring = catKey ? catKey.includes(objName) || objName.includes(catKey) : false;
        const objWords = objName.split(/\s+/);
        const keyWords = key.split(/\s+/);
        const wordOverlap = objWords.some((w) => w.length >= 3 && keyWords.includes(w)) || keyWords.some((w) => w.length >= 3 && objWords.includes(w));
        if (!exactMatch && !substringMatch && !categoryExact && !categorySubstring && !wordOverlap) return;
        const required2 = obj3.itemCount || 1;
        obj3.collectedCount = (obj3.collectedCount || 0) + 1;
        if (obj3.collectedCount >= required2) {
          if (this.completeObjective(quest.id, obj3.id)) {
            matches.push({ questId: quest.id, objectiveId: obj3.id, questName: "", objectiveDescription: obj3.description, completed: true, current: obj3.collectedCount, required: required2 });
          }
        } else {
          matches.push({ questId: quest.id, objectiveId: obj3.id, questName: "", objectiveDescription: obj3.description, completed: false, current: obj3.collectedCount, required: required2 });
        }
      });
      return matches;
    }
    trackItemDelivery(npcId, playerItemNames, questId) {
      const normalizedItems = playerItemNames.map((n) => n.toLowerCase());
      this.forEachObjective(questId, "deliver_item", (quest, obj3) => {
        const matchesNpc = obj3.npcId === npcId || !obj3.npcId;
        const matchesItem = obj3.itemName && normalizedItems.includes(obj3.itemName.toLowerCase());
        if (matchesNpc && matchesItem) {
          obj3.delivered = true;
          this.completeObjective(quest.id, obj3.id);
        }
      });
    }
    checkInventoryObjectives(playerItemNames, questId) {
      const normalizedItems = playerItemNames.map((n) => n.toLowerCase());
      this.forEachObjective(questId, ["collect_item", "collect_items"], (quest, obj3) => {
        const objName = (obj3.itemName || "").toLowerCase();
        if (!objName) return;
        const matched = normalizedItems.some((n) => n === objName || n.includes(objName) || objName.includes(n));
        if (matched) {
          this.completeObjective(quest.id, obj3.id);
        }
      });
    }
    trackEnemyDefeat(enemyType, questId) {
      this.forEachObjective(questId, "defeat_enemies", (quest, obj3) => {
        if (obj3.enemyType === enemyType || !obj3.enemyType) {
          obj3.enemiesDefeated = (obj3.enemiesDefeated || 0) + 1;
          if (obj3.enemiesDefeated >= (obj3.enemiesRequired || 1)) {
            this.completeObjective(quest.id, obj3.id);
          }
        }
      });
    }
    trackItemCrafted(itemId, questId) {
      this.forEachObjective(questId, "craft_item", (quest, obj3) => {
        if (obj3.craftedItemId === itemId) {
          obj3.craftedCount = (obj3.craftedCount || 0) + 1;
          if (obj3.craftedCount >= (obj3.requiredCount || 1)) {
            this.completeObjective(quest.id, obj3.id);
          }
        }
      });
    }
    trackPhysicalAction(actionType, itemsProduced, questId) {
      this.forEachObjective(questId, ["perform_physical_action", "physical_action"], (quest, obj3) => {
        if (obj3.actionType && obj3.actionType !== actionType) return;
        obj3.actionsCompleted = (obj3.actionsCompleted || 0) + 1;
        if (obj3.actionsCompleted >= (obj3.actionsRequired || 1)) {
          this.completeObjective(quest.id, obj3.id);
        }
      });
      for (const itemName of itemsProduced) {
        this.trackCollectedItemByName(itemName, questId);
      }
      for (const itemName of itemsProduced) {
        this.forEachObjective(questId, "craft_item", (quest, obj3) => {
          if (obj3.craftedItemId === itemName || obj3.itemName === itemName) {
            obj3.craftedCount = (obj3.craftedCount || 0) + 1;
            if (obj3.craftedCount >= (obj3.requiredCount || 1)) {
              this.completeObjective(quest.id, obj3.id);
            }
          }
        });
      }
    }
    trackLocationVisit(locationId, locationName, questId) {
      const lowerName = locationName.toLowerCase();
      const lowerId = locationId.toLowerCase();
      this.forEachObjective(questId, ["visit_location", "discover_location"], (quest, obj3) => {
        const objName = (obj3.locationName || "").toLowerCase();
        if (!objName) return;
        if (objName === lowerId || objName === lowerName || lowerName.includes(objName) || objName.includes(lowerName)) {
          this.completeObjective(quest.id, obj3.id);
        }
      });
    }
    /** @deprecated Use trackLocationVisit instead */
    trackLocationDiscovery(locationId, questId) {
      this.trackLocationVisit(locationId, locationId, questId);
    }
    trackArrival(npcOrItemId, destinationReached, questId) {
      this.forEachObjective(questId, ["escort_npc", "deliver_item"], (quest, obj3) => {
        if (destinationReached) {
          if (obj3.type === "escort_npc") {
            obj3.arrived = true;
          } else {
            obj3.delivered = true;
          }
          this.completeObjective(quest.id, obj3.id);
        }
      });
    }
    trackReputationGain(factionId, amount, questId) {
      this.forEachObjective(questId, "gain_reputation", (quest, obj3) => {
        if (obj3.factionId === factionId) {
          obj3.reputationGained = (obj3.reputationGained || 0) + amount;
          if (obj3.reputationGained >= (obj3.reputationRequired || OBJECTIVE_TYPE_DEFAULTS["gain_reputation"]?.reputationRequired || 100)) {
            this.completeObjective(quest.id, obj3.id);
          }
        }
      });
    }
    trackListeningAnswer(isCorrect, questId) {
      this.forEachObjective(questId, "listening_comprehension", (quest, obj3) => {
        obj3.questionsAnswered = (obj3.questionsAnswered || 0) + 1;
        if (isCorrect) {
          obj3.questionsCorrect = (obj3.questionsCorrect || 0) + 1;
        }
        obj3.currentCount = obj3.questionsAnswered;
        const required2 = obj3.requiredCount || obj3.comprehensionQuestions?.length || getDefaultRequiredCount("listening_comprehension");
        if (obj3.questionsCorrect >= required2) {
          this.completeObjective(quest.id, obj3.id);
        }
      });
    }
    trackTranslationAttempt(isCorrect, questId) {
      this.forEachObjective(questId, "translation_challenge", (quest, obj3) => {
        if (isCorrect) {
          obj3.translationsCorrect = (obj3.translationsCorrect || 0) + 1;
        }
        obj3.translationsCompleted = (obj3.translationsCompleted || 0) + 1;
        obj3.currentCount = obj3.translationsCorrect || 0;
        const required2 = obj3.requiredCount || obj3.translationPhrases?.length || getDefaultRequiredCount("translation_challenge");
        if (obj3.translationsCorrect >= required2) {
          this.completeObjective(quest.id, obj3.id);
        }
      });
    }
    trackNavigationWaypoint(questId) {
      let result = null;
      this.forEachObjective(questId, "navigate_language", (quest, obj3) => {
        obj3.waypointsReached = (obj3.waypointsReached || 0) + 1;
        obj3.stepsCompleted = obj3.waypointsReached;
        const waypoints = obj3.navigationWaypoints || [];
        const nextIdx = obj3.waypointsReached;
        if (nextIdx >= (obj3.stepsRequired || waypoints.length)) {
          this.completeObjective(quest.id, obj3.id);
          result = { nextWaypointIndex: nextIdx, completed: true, objective: obj3 };
        } else {
          result = { nextWaypointIndex: nextIdx, completed: false, objective: obj3 };
        }
      });
      return result;
    }
    trackPronunciationAttempt(passed, questId, score, phrase, options) {
      const pronunciationTypes = ["pronunciation_check", "listen_and_repeat", "speak_phrase"];
      this.forEachObjective(questId, pronunciationTypes, (quest, obj3) => {
        if (obj3.completed || obj3.failed) return;
        let effectivePassed = passed;
        if (obj3.difficulty && score !== void 0) {
          const threshold = DIFFICULTY_CONFIGS[obj3.difficulty].passThreshold;
          effectivePassed = score >= threshold;
        }
        const isPronunciationRetry = !effectivePassed && score !== void 0 && score < PRONUNCIATION_RETRY_THRESHOLD;
        const effectiveScore = score === void 0 ? 0 : applyHintPenalty(score, obj3.hints, obj3.hintsRevealed ?? 0);
        if (score !== void 0) {
          if (!obj3.pronunciationScores) obj3.pronunciationScores = [];
          obj3.pronunciationScores.push(score);
          if (score > (obj3.pronunciationBestScore ?? 0)) {
            obj3.pronunciationBestScore = score;
          }
        }
        if (options?.wordResults && options.wordResults.length > 0) {
          obj3.wordFeedback = wordResultsToFeedback(options.wordResults);
        }
        if (!isPronunciationRetry) {
          obj3.attempts = (obj3.attempts ?? 0) + 1;
          if (!effectivePassed && obj3.maxAttempts && obj3.maxAttempts > 0 && obj3.attempts >= obj3.maxAttempts) {
            obj3.failed = true;
          }
          if (effectivePassed) {
            obj3.currentCount = (obj3.currentCount || 0) + 1;
            obj3.totalScore = (obj3.totalScore ?? 0) + effectiveScore;
            const required2 = obj3.requiredCount || getDefaultRequiredCount("pronunciation_check");
            if (obj3.currentCount >= required2) {
              const scores = obj3.pronunciationScores || [];
              if (obj3.minAverageScore && obj3.minAverageScore > 0 && scores.length > 0) {
                const avg = scores.reduce((a, b) => a + b, 0) / scores.length;
                if (avg >= obj3.minAverageScore) {
                  this.completeObjective(quest.id, obj3.id);
                }
              } else {
                this.completeObjective(quest.id, obj3.id);
              }
            }
          }
        }
        if (this.onPronunciationFeedback) {
          const targetPhrase = options?.targetPhrase ?? phrase ?? "";
          const input = options?.input ?? "";
          let npcResponse;
          if (this.correctionContext && score !== void 0) {
            npcResponse = effectivePassed ? generatePraiseResponse(score, this.correctionContext) : generateCorrectionResponse(input, targetPhrase, score, this.correctionContext);
          }
          this.onPronunciationFeedback(quest.id, obj3.id, {
            npcResponse,
            isPronunciationRetry,
            effectiveScore,
            passed: effectivePassed
          });
        }
      });
    }
    getPronunciationStats(questId, objectiveId) {
      const quest = this.quests.find((q) => q.id === questId);
      const obj3 = quest?.objectives?.find((o) => o.id === objectiveId);
      if (!obj3 || obj3.type !== "pronunciation_check") return null;
      const scores = obj3.pronunciationScores || [];
      const average = scores.length > 0 ? scores.reduce((a, b) => a + b, 0) / scores.length : 0;
      return { scores, average, passed: scores.length };
    }
    // ── Additional language-learning objective types (ported from UQS) ──────
    //
    // Note: `listen_to_conversation` (UQS terminology) normalizes to `eavesdrop`
    // in this engine (see quest-objective-types.ts). Callers should emit an
    // `eavesdrop` event or invoke `trackEavesdrop()` directly.
    /**
     * Complete any `romance_stage_reach` objective whose target stage has been
     * met (comparing via the standard romance stage progression).
     *
     * Target stage is read from `obj.targetRomanceStage`, falling back to
     * `obj.targetPhrase`.
     */
    trackRomanceStageReach(currentStage, questId) {
      const stageOrder = [
        "none",
        "attracted",
        "flirting",
        "dating",
        "committed",
        "engaged",
        "married"
      ];
      const currentIdx = stageOrder.indexOf(currentStage.toLowerCase());
      if (currentIdx < 0) return;
      this.forEachObjective(questId, "romance_stage_reach", (quest, obj3) => {
        const target = (obj3.targetRomanceStage ?? obj3.targetPhrase ?? "").toLowerCase();
        const targetIdx = stageOrder.indexOf(target);
        if (targetIdx < 0) return;
        if (currentIdx >= targetIdx) {
          this.completeObjective(quest.id, obj3.id);
        }
      });
    }
    /**
     * Complete any `romance_gift` objective when the player gives a gift. If
     * the objective constrains the recipient via `romanceGiftRecipientNpcId`,
     * only matching recipients count.
     */
    trackRomanceGift(npcId, questId) {
      this.forEachObjective(questId, "romance_gift", (quest, obj3) => {
        if (obj3.romanceGiftRecipientNpcId && obj3.romanceGiftRecipientNpcId !== npcId) return;
        obj3.currentCount = (obj3.currentCount || 0) + 1;
        const required2 = obj3.requiredCount ?? 1;
        if (obj3.currentCount >= required2) {
          this.completeObjective(quest.id, obj3.id);
        } else {
          this.onObjectiveProgress?.(quest.id, obj3.id, obj3.currentCount, required2, obj3.type);
        }
      });
    }
    trackWritingSubmission(text2, wordCount, questId) {
      this.trackByTrigger("writing_submitted", questId);
      this.forEachObjective(questId, ["writing", "arrival_writing", "departure_writing"], (quest, obj3) => {
        const minWords = obj3.minWordCount || OBJECTIVE_TYPE_DEFAULTS[obj3.type]?.minWordCount || OBJECTIVE_TYPE_DEFAULTS["writing"]?.minWordCount || 20;
        if (wordCount >= minWords) {
          this.completeObjective(quest.id, obj3.id);
        }
      });
      this.forEachObjective(questId, ["write_response", "describe_scene"], (quest, obj3) => {
        if (!obj3.writtenResponses) obj3.writtenResponses = [];
        obj3.writtenResponses.push(text2);
        obj3.currentCount = (obj3.currentCount || 0) + 1;
        const minWords = obj3.minWordCount || 0;
        if (minWords > 0 && wordCount < minWords) return;
        if (obj3.currentCount >= (obj3.requiredCount || 1)) {
          this.completeObjective(quest.id, obj3.id);
        }
      });
    }
    // ── Timed objectives ────────────────────────────────────────────────────
    checkTimedObjectives() {
      const expired = [];
      const now = Date.now();
      for (const quest of this.quests) {
        for (const obj3 of quest.objectives || []) {
          if (obj3.completed) continue;
          if (!obj3.timeLimitSeconds || !obj3.startedAt) continue;
          const elapsedSec = (now - obj3.startedAt) / 1e3;
          if (elapsedSec > obj3.timeLimitSeconds) {
            obj3.completed = true;
            const required2 = obj3.requiredCount ?? 1;
            obj3.currentCount = Math.max(obj3.currentCount ?? 0, required2);
            expired.push(`Time expired: ${obj3.description}`);
          }
        }
      }
      return expired;
    }
    getObjectiveTimeRemaining(objectiveId) {
      for (const quest of this.quests) {
        const obj3 = quest.objectives?.find((o) => o.id === objectiveId);
        if (obj3?.timeLimitSeconds && obj3.startedAt) {
          const elapsed = (Date.now() - obj3.startedAt) / 1e3;
          return Math.max(0, obj3.timeLimitSeconds - elapsed);
        }
      }
      return null;
    }
    // ── Teaching tracking ──────────────────────────────────────────────────
    trackTeachWord(npcId, word, questId) {
      const lowerWord = word.toLowerCase();
      this.forEachObjective(questId, "teach_vocabulary", (quest, obj3) => {
        if (obj3.npcId && obj3.npcId !== npcId) return;
        obj3.wordsTaught = obj3.wordsTaught || [];
        if (obj3.wordsTaught.includes(lowerWord)) return;
        obj3.wordsTaught.push(lowerWord);
        obj3.currentCount = (obj3.currentCount || 0) + 1;
        if (obj3.currentCount >= (obj3.requiredCount || getDefaultRequiredCount("teach_vocabulary"))) {
          this.completeObjective(quest.id, obj3.id);
        }
      });
    }
    trackTeachPhrase(npcId, phrase, questId) {
      const lowerPhrase = phrase.toLowerCase();
      this.forEachObjective(questId, "teach_phrase", (quest, obj3) => {
        if (obj3.npcId && obj3.npcId !== npcId) return;
        obj3.phrasesTaught = obj3.phrasesTaught || [];
        if (obj3.phrasesTaught.includes(lowerPhrase)) return;
        obj3.phrasesTaught.push(lowerPhrase);
        obj3.currentCount = (obj3.currentCount || 0) + 1;
        if (obj3.currentCount >= (obj3.requiredCount || 1)) {
          this.completeObjective(quest.id, obj3.id);
        }
      });
    }
    // ── Object interaction tracking ─────────────────────────────────────
    trackObjectIdentified(objectName, questId) {
      const lowerName = objectName.toLowerCase();
      this.forEachObjective(questId, "identify_object", (quest, obj3) => {
        obj3.currentCount = (obj3.currentCount || 0) + 1;
        if (obj3.currentCount >= (obj3.requiredCount || 1)) {
          this.completeObjective(quest.id, obj3.id);
        }
      });
    }
    trackObjectExamined(objectName, questId) {
      this.forEachObjective(questId, "examine_object", (quest, obj3) => {
        obj3.currentCount = (obj3.currentCount || 0) + 1;
        if (obj3.currentCount >= (obj3.requiredCount || 1)) {
          this.completeObjective(quest.id, obj3.id);
        }
      });
    }
    trackSignRead(signId, questId) {
      this.forEachObjective(questId, "read_sign", (quest, obj3) => {
        obj3.currentCount = (obj3.currentCount || 0) + 1;
        if (obj3.currentCount >= (obj3.requiredCount || 1)) {
          this.completeObjective(quest.id, obj3.id);
        }
      });
    }
    trackPointAndName(objectName, questId) {
      this.forEachObjective(questId, "point_and_name", (quest, obj3) => {
        obj3.currentCount = (obj3.currentCount || 0) + 1;
        if (obj3.currentCount >= (obj3.requiredCount || 1)) {
          this.completeObjective(quest.id, obj3.id);
        }
      });
    }
    // ── Conversation-based objective tracking ──────────────────────────
    /**
     * Track conversation turns with NPCs for objectives that complete through
     * sustained dialogue: ask_for_directions, order_food, haggle_price,
     * introduce_self, build_friendship.
     * The topicTag helps match the right objective type (e.g. 'directions', 'order', 'haggle', 'introduction').
     */
    trackNpcConversationTurn(npcId, topicTag, questId) {
      const tagToTypes = {
        directions: ["ask_for_directions"],
        order: ["order_food"],
        haggle: ["haggle_price"],
        introduction: ["introduce_self"],
        friendship: ["build_friendship"]
      };
      const targetTypes = topicTag && tagToTypes[topicTag] ? tagToTypes[topicTag] : ["ask_for_directions", "order_food", "haggle_price", "introduce_self", "build_friendship"];
      this.forEachObjective(questId, targetTypes, (quest, obj3) => {
        if (obj3.npcId && obj3.npcId !== npcId) return;
        obj3.currentCount = (obj3.currentCount || 0) + 1;
        if (obj3.currentCount >= (obj3.requiredCount || 1)) {
          this.completeObjective(quest.id, obj3.id);
        }
      });
    }
    trackGiftGiven(npcId, itemName, questId) {
      this.forEachObjective(questId, "give_gift", (quest, obj3) => {
        if (obj3.npcId && obj3.npcId !== npcId) return;
        this.completeObjective(quest.id, obj3.id);
      });
    }
    trackDirectionStep(questId) {
      this.forEachObjective(questId, "follow_directions", (quest, obj3) => {
        obj3.stepsCompleted = (obj3.stepsCompleted || 0) + 1;
        obj3.currentCount = obj3.stepsCompleted;
        if (obj3.stepsCompleted >= (obj3.stepsRequired || obj3.requiredCount || 1)) {
          this.completeObjective(quest.id, obj3.id);
        }
      });
    }
    // ── Mercantile objective tracking ──────────────────────────────────
    trackFoodOrdered(itemName, merchantId, businessType, questId) {
      this.forEachObjective(questId, "order_food", (quest, obj3) => {
        if (obj3.merchantId && obj3.merchantId !== merchantId) return;
        obj3.itemsPurchased = obj3.itemsPurchased || [];
        obj3.itemsPurchased.push(itemName);
        obj3.currentCount = (obj3.currentCount || 0) + 1;
        if (obj3.currentCount >= (obj3.requiredCount || 1)) {
          this.completeObjective(quest.id, obj3.id);
        }
      });
    }
    trackPriceHaggled(itemName, merchantId, typedWord, questId) {
      this.forEachObjective(questId, "haggle_price", (quest, obj3) => {
        if (obj3.merchantId && obj3.merchantId !== merchantId) return;
        obj3.currentCount = (obj3.currentCount || 0) + 1;
        if (obj3.currentCount >= (obj3.requiredCount || 1)) {
          this.completeObjective(quest.id, obj3.id);
        }
      });
    }
    // ── Text / reading / comprehension tracking ──────────────────────────
    trackTextFound(textId, textName, questId) {
      const lowerName = textName.toLowerCase();
      this.forEachObjective(questId, ["find_text", "collect_text"], (quest, obj3) => {
        const targetName = (obj3.itemName || "").toLowerCase();
        if (targetName && targetName !== lowerName && targetName !== textId) return;
        obj3.textsFound = obj3.textsFound || [];
        if (obj3.textsFound.includes(textId)) return;
        obj3.textsFound.push(textId);
        obj3.currentCount = (obj3.currentCount || 0) + 1;
        if (obj3.currentCount >= (obj3.requiredCount || 1)) {
          this.completeObjective(quest.id, obj3.id);
        }
      });
    }
    trackTextRead(textId, questId) {
      this.forEachObjective(questId, ["read_text", "read_document"], (quest, obj3) => {
        if (obj3.textId && obj3.textId !== textId) return;
        obj3.textsRead = obj3.textsRead || [];
        if (obj3.textsRead.includes(textId)) return;
        obj3.textsRead.push(textId);
        obj3.currentCount = (obj3.currentCount || 0) + 1;
        if (obj3.currentCount >= (obj3.requiredCount || 1)) {
          this.completeObjective(quest.id, obj3.id);
        }
      });
    }
    trackComprehensionAnswer(isCorrect, questId) {
      this.forEachObjective(questId, "comprehension_quiz", (quest, obj3) => {
        obj3.quizAnswered = (obj3.quizAnswered || 0) + 1;
        if (isCorrect) {
          obj3.quizCorrect = (obj3.quizCorrect || 0) + 1;
        }
        obj3.currentCount = obj3.quizCorrect || 0;
        const required2 = obj3.requiredCount || obj3.quizQuestions?.length || getDefaultRequiredCount("comprehension_quiz");
        const threshold = obj3.quizPassThreshold ?? required2;
        if (obj3.quizCorrect >= threshold) {
          this.completeObjective(quest.id, obj3.id);
        }
      });
    }
    trackPhotoTaken(subjectName, subjectCategory, subjectActivity, questId) {
      const lowerName = subjectName.toLowerCase();
      const lowerActivity = subjectActivity?.toLowerCase();
      this.forEachObjective(questId, "photograph_subject", (quest, obj3) => {
        if (obj3.targetCategory && obj3.targetCategory !== subjectCategory) return;
        if (obj3.targetSubject && obj3.targetSubject.toLowerCase() !== lowerName) return;
        if (obj3.targetActivity) {
          if (!lowerActivity) return;
          if (!lowerActivity.includes(obj3.targetActivity.toLowerCase())) return;
        }
        const trackingKey = obj3.targetActivity ? `${lowerName}:${lowerActivity}` : lowerName;
        obj3.photographedSubjects = obj3.photographedSubjects || [];
        if (obj3.photographedSubjects.includes(trackingKey)) return;
        obj3.photographedSubjects.push(trackingKey);
        obj3.currentCount = (obj3.currentCount || 0) + 1;
        if (obj3.currentCount >= (obj3.requiredCount || 1)) {
          this.completeObjective(quest.id, obj3.id);
        }
      });
    }
    trackActivityPhotographed(npcId, npcName, activity, questId) {
      const lowerName = npcName.toLowerCase();
      const lowerActivity = activity.toLowerCase();
      this.forEachObjective(questId, "photograph_activity", (quest, obj3) => {
        if (obj3.npcName && obj3.npcName.toLowerCase() !== lowerName) return;
        if (obj3.targetActivity && !lowerActivity.includes(obj3.targetActivity.toLowerCase())) return;
        const trackingKey = `${lowerName}:${lowerActivity}`;
        obj3.photographedSubjects = obj3.photographedSubjects || [];
        if (obj3.photographedSubjects.includes(trackingKey)) return;
        obj3.photographedSubjects.push(trackingKey);
        obj3.currentCount = (obj3.currentCount || 0) + 1;
        if (obj3.currentCount >= (obj3.requiredCount || 1)) {
          this.completeObjective(quest.id, obj3.id);
        }
      });
    }
    trackActivityObserved(npcId, npcName, activity, durationSeconds, questId) {
      const lowerName = npcName.toLowerCase();
      const lowerActivity = activity.toLowerCase();
      const defaultDuration = OBJECTIVE_TYPE_DEFAULTS["observe_activity"]?.observeDurationSeconds ?? 5;
      this.forEachObjective(questId, "observe_activity", (quest, obj3) => {
        if (obj3.npcName && obj3.npcName.toLowerCase() !== lowerName) return;
        if (obj3.targetActivity && !lowerActivity.includes(obj3.targetActivity.toLowerCase())) return;
        const required2 = obj3.observeDurationRequired || defaultDuration;
        if (durationSeconds < required2) return;
        const trackingKey = `${lowerName}:${lowerActivity}`;
        obj3.observedActivities = obj3.observedActivities || [];
        if (obj3.observedActivities.includes(trackingKey)) return;
        obj3.observedActivities.push(trackingKey);
        obj3.currentCount = (obj3.currentCount || 0) + 1;
        if (obj3.currentCount >= (obj3.requiredCount || 1)) {
          this.completeObjective(quest.id, obj3.id);
        }
      });
    }
    // ── Conversation goal evaluation ────────────────────────────────────────
    /**
     * Track the result of a conversation goal evaluation (from LLM or keyword fallback).
     * Completes the objective if goalMet is true and confidence > 0.7.
     */
    trackConversationGoalResult(questId, objectiveId, goalMet, confidence, extractedInfo) {
      const quest = this.quests.find((q) => q.id === questId);
      if (!quest) return;
      const obj3 = quest.objectives?.find((o) => o.id === objectiveId);
      if (!obj3 || obj3.completed) return;
      obj3.conversationGoalConfidence = confidence;
      obj3.conversationGoalExtractedInfo = extractedInfo;
      if (goalMet && confidence >= MIN_CONVERSATION_GOAL_CONFIDENCE) {
        obj3.conversationGoalMet = true;
        this.completeObjective(questId, objectiveId);
      }
    }
    /**
     * Get objectives with conversation goals for a specific quest or all quests.
     * Used by the conversation system to know which goals to evaluate after a conversation ends.
     */
    getConversationGoalObjectives(questId) {
      const results = [];
      for (const quest of this.quests) {
        if (questId && quest.id !== questId) continue;
        for (const obj3 of quest.objectives || []) {
          if (obj3.completed) continue;
          if (obj3.conversationGoal && !this.isObjectiveLocked(quest, obj3)) {
            results.push({ questId: quest.id, objective: obj3 });
          }
        }
      }
      return results;
    }
    // ── Eavesdrop tracking ──────────────────────────────────────────────────
    /**
     * Track an overheard conversation event against eavesdrop objectives.
     * Completes eavesdrop objectives when the topic matches.
     */
    trackEavesdrop(npcId1, npcId2, topic, languageUsed, questId) {
      const lowerTopic = topic.toLowerCase();
      this.forEachObjective(questId, "eavesdrop", (quest, obj3) => {
        if (obj3.eavesdropTopic) {
          const targetTopic = obj3.eavesdropTopic.toLowerCase();
          if (!lowerTopic.includes(targetTopic) && !targetTopic.includes(lowerTopic)) return;
        }
        obj3.eavesdropCompleted = true;
        obj3.currentCount = (obj3.currentCount || 0) + 1;
        if (obj3.currentCount >= (obj3.requiredCount || 1)) {
          this.completeObjective(quest.id, obj3.id);
        }
      });
    }
    /**
     * Export mutable objective progress for all quests.
     * Returns a map of questId → array of { id, ...progressFields }.
     */
    serializeObjectiveStates() {
      const result = {};
      for (const quest of this.quests) {
        if (!quest.objectives?.length) continue;
        const objectiveStates = [];
        for (const obj3 of quest.objectives) {
          const state = { id: obj3.id };
          let hasProgress = false;
          for (const field of _QuestCompletionEngine.PROGRESS_FIELDS) {
            const value = obj3[field];
            if (value !== void 0 && value !== false && value !== null && value !== 0) {
              state[field] = value;
              hasProgress = true;
            }
          }
          if (hasProgress) {
            objectiveStates.push(state);
          }
        }
        if (objectiveStates.length > 0) {
          result[quest.id] = objectiveStates;
        }
      }
      return result;
    }
    /**
     * Restore objective progress from previously serialized state.
     * Merges saved progress into existing quest objectives by matching objective IDs.
     */
    restoreObjectiveStates(states) {
      if (!states) return;
      for (const [questId, savedObjectives] of Object.entries(states)) {
        const quest = this.quests.find((q) => q.id === questId);
        if (!quest?.objectives) continue;
        for (const saved of savedObjectives) {
          const obj3 = quest.objectives.find((o) => o.id === saved.id);
          if (!obj3) continue;
          for (const [key, value] of Object.entries(saved)) {
            if (key === "id") continue;
            obj3[key] = value;
          }
        }
      }
    }
    // ── Conversational action tracking ─────────────────────────────────────
    /**
     * Track a detected conversational action against matching quest objectives.
     * Objective types that can be completed by conversational actions:
     * - asked_about_topic: player asked about a quest-relevant topic
     * - used_target_language: player wrote in the target language
     * - answered_question: player answered an NPC's question
     * - requested_information: player asked for directions/help
     * - made_introduction: player introduced themselves
     * - arrival_initiate_conversation: completed when any action fires (conversation started)
     * - arrival_conversation: completed via conversation_turn_counted
     */
    trackConversationalAction(action, npcId, topic, questId) {
      const actionToObjectiveTypes = {
        asked_about_topic: ["asked_about_topic"],
        used_target_language: ["used_target_language", "arrival_writing"],
        answered_question: ["answered_question"],
        requested_information: ["requested_information", "ask_for_directions"],
        made_introduction: ["made_introduction", "introduce_self"]
      };
      const targetTypes = actionToObjectiveTypes[action] || [action];
      this.forEachObjective(questId, targetTypes, (quest, obj3) => {
        if (obj3.npcId && obj3.npcId !== npcId) return;
        if (obj3.type === "asked_about_topic" && obj3.targetWords && obj3.targetWords.length > 0) {
          if (topic && !obj3.targetWords.includes(topic)) return;
        }
        obj3.currentCount = (obj3.currentCount || 0) + 1;
        if (obj3.currentCount >= (obj3.requiredCount || 1)) {
          this.completeObjective(quest.id, obj3.id);
        }
      });
      this.forEachObjective(questId, "arrival_initiate_conversation", (quest, obj3) => {
        if (obj3.npcId && obj3.npcId !== npcId) return;
        this.completeObjective(quest.id, obj3.id);
      });
    }
    /**
     * Track accumulated conversation turns per NPC.
     * Completes assessment conversation objectives when meaningful turn count
     * meets the required threshold (arrival, departure, periodic).
     */
    trackConversationTurnCounted(npcId, totalTurns, meaningfulTurns, questId) {
      this.forEachObjective(questId, ["conversation", "arrival_conversation", "departure_conversation", "periodic_conversational"], (quest, obj3) => {
        if (obj3.npcId && obj3.npcId !== npcId) return;
        obj3.currentCount = meaningfulTurns;
        const required2 = obj3.requiredCount || getDefaultRequiredCount(obj3.type);
        if (meaningfulTurns >= required2) {
          this.completeObjective(quest.id, obj3.id);
        }
      });
    }
    // ── Declarative trigger-based completion ────────────────────────────────
    /**
     * Complete any objectives whose `completionTrigger` matches the given trigger string.
     * This enables declarative event-to-objective mapping: quest authors set
     * `completionTrigger: 'reading_completed'` on an objective, and any event
     * that calls `trackByTrigger('reading_completed')` will complete it.
     */
    trackByTrigger(trigger, questId) {
      for (const quest of this.quests) {
        if (questId && quest.id !== questId) continue;
        for (const obj3 of quest.objectives || []) {
          if (obj3.completed) continue;
          if (obj3.completionTrigger === trigger && !this.isObjectiveLocked(quest, obj3)) {
            this.completeObjective(quest.id, obj3.id);
          }
        }
      }
    }
    // ── Declarative game-event matcher ──────────────────────────────────────
    /**
     * Generic event matcher that uses the declarative quest-action mapping.
     *
     * Receives any game event object (must have a `type` string field),
     * looks up which objective types can be satisfied by that event type,
     * checks if any active (unlocked, incomplete) objective matches the
     * event's fields, and completes or increments matching objectives.
     *
     * Supports:
     * - Simple field matching (exact, contains, case-insensitive)
     * - Quantity objectives (increments progress, completes at threshold)
     * - Compound objectives (all match fields must pass simultaneously)
     *
     * Returns the number of objectives that were completed or progressed.
     */
    handleGameEvent(event) {
      const eventType = event.type;
      if (!eventType) return 0;
      const mappings = getMappingsForEvent(eventType);
      if (mappings.length === 0) return 0;
      let affected = 0;
      for (const mapping of mappings) {
        this.forEachObjective(void 0, mapping.objectiveType, (quest, obj3) => {
          if (!matchesAllFields(mapping, event, obj3)) {
            return;
          }
          if (mapping.objectiveType === "photograph_activity") {
            const objActivity = (obj3.targetActivity || "").toLowerCase();
            const eventActivity = String(event.subjectActivity || event.activity || "").toLowerCase();
            if (objActivity && (!eventActivity || !eventActivity.includes(objActivity))) {
              return;
            }
          }
          affected++;
          if (mapping.quantity) {
            const { currentField, requiredField, defaultRequired } = mapping.quantity;
            const objAny = obj3;
            objAny[currentField] = (objAny[currentField] || 0) + 1;
            const required2 = objAny[requiredField] || defaultRequired;
            if (objAny[currentField] >= required2) {
              this.completeObjective(quest.id, obj3.id);
            } else {
              this.onObjectiveProgress?.(quest.id, obj3.id, objAny[currentField], required2, obj3.type);
            }
          } else {
            this.completeObjective(quest.id, obj3.id);
          }
        });
      }
      return affected;
    }
    /**
     * Get all mappings registered in the event catalog for a given event type.
     * Useful for tooling and quest designer UIs.
     */
    static getMappingsForEvent(eventType) {
      return getMappingsForEvent(eventType);
    }
    // ── Internal helper ─────────────────────────────────────────────────────
    forEachObjective(questId, type, callback) {
      const types = Array.isArray(type) ? type : [type];
      for (const quest of this.quests) {
        if (questId && quest.id !== questId) continue;
        if (quest.status && quest.status !== "active") continue;
        const eligible = (quest.objectives || []).filter(
          (obj3) => !obj3.completed && types.includes(obj3.type) && !this.isObjectiveLocked(quest, obj3)
        );
        for (const obj3 of eligible) {
          if (obj3.completed) continue;
          callback(quest, obj3);
        }
      }
    }
  };
  // ── Serialization ──────────────────────────────────────────────────────
  /** Progress-relevant fields that change at runtime and need persistence. */
  __publicField(_QuestCompletionEngine, "PROGRESS_FIELDS", [
    "completed",
    "collectedCount",
    "wordsUsed",
    "currentCount",
    "npcInitiated",
    "responseQuality",
    "pronunciationScores",
    "pronunciationBestScore",
    "writtenResponses",
    "enemiesDefeated",
    "craftedCount",
    "arrived",
    "delivered",
    "reputationGained",
    "questionsAnswered",
    "questionsCorrect",
    "translationsCompleted",
    "translationsCorrect",
    "waypointsReached",
    "stepsCompleted",
    "wordsTaught",
    "phrasesTaught",
    "startedAt",
    "itemsPurchased",
    "textsFound",
    "textsRead",
    "quizAnswered",
    "quizCorrect",
    "photographedSubjects",
    "observedActivities",
    "conversationGoalMet",
    "conversationGoalConfidence",
    "conversationGoalExtractedInfo",
    "eavesdropCompleted"
  ]);
  var QuestCompletionEngine = _QuestCompletionEngine;

  // @insimul/core/src/game-engine/logic/QuestMarkerService.ts
  var MARKER_STYLES = {
    turn_in: {
      priority: 50,
      symbol: "\u2713",
      color: "#32CD32",
      borderColor: "#228b22",
      minimapSize: 14,
      minimapPulsing: true,
      label: "Ready to turn in"
    },
    active_objective: {
      priority: 40,
      symbol: "!",
      color: "#F44336",
      borderColor: "#b71c1c",
      minimapSize: 14,
      minimapPulsing: true,
      label: "Current objective"
    },
    in_progress: {
      priority: 30,
      symbol: "?",
      color: "#C0C0C0",
      borderColor: "#808080",
      minimapSize: 11,
      minimapPulsing: false,
      label: "Quest in progress"
    },
    available: {
      priority: 20,
      symbol: "?",
      color: "#FFD700",
      borderColor: "#cc9900",
      minimapSize: 11,
      minimapPulsing: false,
      label: "Quest available"
    },
    available_radiant: {
      priority: 10,
      symbol: "?",
      color: "#C0A050",
      borderColor: "#806830",
      minimapSize: 10,
      minimapPulsing: false,
      label: "Side quest available"
    }
  };
  function hasActiveQuest(quests) {
    for (const q of quests) {
      if (q && q.status === "active") return true;
    }
    return false;
  }
  function isRadiantQuest(quest) {
    const tags = quest.tags;
    if (!tags || !Array.isArray(tags)) return false;
    return tags.includes("radiant");
  }
  function selectNpcMarker(npc, context, surface = "world") {
    const { quests, activeObjectiveNpcId, questCompletionChecker } = context;
    const npcFullName = [npc.firstName, npc.lastName].filter(Boolean).join(" ").trim();
    if (questCompletionChecker) {
      for (const q of quests) {
        if (!q || q.status !== "active") continue;
        if (!npcGaveQuest(q, npc.id, npcFullName)) continue;
        if (questCompletionChecker(q.id)) return "turn_in";
      }
    }
    if (activeObjectiveNpcId && activeObjectiveNpcId === npc.id) {
      return "active_objective";
    }
    for (const q of quests) {
      if (!q || q.status !== "active") continue;
      const obj3 = firstIncompleteObjective(q);
      if (!obj3) continue;
      if (npcMatchesObjective(obj3, npc.id, npcFullName)) {
        return "active_objective";
      }
    }
    if (activeObjectiveNpcId && activeObjectiveNpcId !== npc.id) {
      return null;
    }
    for (const q of quests) {
      if (!q || q.status !== "active") continue;
      if (npcGaveQuest(q, npc.id, npcFullName)) return "in_progress";
    }
    let radiantFound = false;
    for (const q of quests) {
      if (!q || q.status !== "available") continue;
      if (!npcGaveQuest(q, npc.id, npcFullName)) continue;
      if (!isRadiantQuest(q)) {
        if (surface === "minimap" && hasActiveQuest(quests)) return null;
        return "available";
      }
      radiantFound = true;
    }
    if (radiantFound) {
      if (hasActiveQuest(quests)) return null;
      return "available_radiant";
    }
    return null;
  }
  function selectLocationMarker(quest, objective, context, _surface = "world") {
    if (!objective) return null;
    if (quest.status !== "active") return null;
    if (objective.completed) return null;
    const objLoc = objective.objectiveLocation ?? "";
    if (typeof objLoc === "string" && objLoc.startsWith("npc(")) return null;
    if (objective.npcId || objective.targetNpcId) return null;
    return "active_objective";
  }
  function firstIncompleteObjective(quest) {
    const objs = quest.objectives;
    if (!Array.isArray(objs)) return null;
    for (const obj3 of objs) {
      if (obj3 && !obj3.completed) return obj3;
    }
    return null;
  }
  function npcMatchesObjective(objective, npcId, npcFullName) {
    if (!objective) return false;
    if (objective.npcId && objective.npcId === npcId) return true;
    if (objective.targetNpcId && objective.targetNpcId === npcId) return true;
    const locRef = typeof objective.objectiveLocation === "string" ? objective.objectiveLocation : "";
    if (!locRef) return false;
    const match = locRef.match(/^npc\(\s*'?([^')]+)'?\s*\)$/);
    if (!match) return false;
    const refName = match[1];
    if (!refName) return false;
    if (refName === npcId) return true;
    if (npcFullName && refName.toLowerCase() === npcFullName.toLowerCase()) return true;
    return false;
  }
  function npcGaveQuest(quest, npcId, npcFullName) {
    if (quest.assignedByCharacterId && quest.assignedByCharacterId === npcId) return true;
    if (quest.assignedBy && npcFullName && String(quest.assignedBy).toLowerCase() === npcFullName.toLowerCase()) {
      return true;
    }
    return false;
  }

  // @insimul/core/src/game-engine/logic/QuestMinimapMarkers.ts
  var ACTIVE_OBJECTIVE_COLOR = MARKER_STYLES.active_objective.color;
  function getObjectiveMarkerShape(objectiveType) {
    switch (objectiveType) {
      case "visit_location":
      case "discover_location":
      case "navigate_language":
      case "follow_directions":
        return "diamond";
      default:
        return "circle";
    }
  }
  function extractObjectiveMarkers(quests, resolvedPositions, namedLocations, activeObjectiveNpcId) {
    const markers = [];
    for (const quest of quests) {
      if (quest.status !== "active") continue;
      if (!quest.objectives || quest.objectives.length === 0) continue;
      const questPos = quest.locationPosition;
      let foundCurrent = false;
      for (let i = 0; i < quest.objectives.length; i++) {
        const obj3 = quest.objectives[i];
        if (obj3.completed) continue;
        if (foundCurrent) break;
        foundCurrent = true;
        const objLoc = obj3.objectiveLocation || "";
        if (objLoc.startsWith("npc(")) continue;
        let pos = obj3.locationPosition ?? obj3.position ?? questPos;
        if (!pos && resolvedPositions) {
          const markerId = `${quest.id}_obj_${i}`;
          const dynPos = resolvedPositions.get(markerId);
          if (dynPos) {
            pos = { x: dynPos.x, y: 0, z: dynPos.z };
          }
        }
        if (!pos && namedLocations && obj3.objectiveLocation) {
          let locKey = obj3.objectiveLocation;
          const termMatch = locKey.match(/^(?:location|npc|merchant|settlement)\(\s*'?([^')]+)'?\s*\)$/);
          if (termMatch) locKey = termMatch[1];
          const namedPos = namedLocations.get(locKey);
          if (namedPos) {
            pos = { x: namedPos.x, y: 0, z: namedPos.z };
          }
        }
        if (!pos) continue;
        void activeObjectiveNpcId;
        markers.push({
          id: `${quest.id}_obj_${i}`,
          questId: quest.id,
          questTitle: quest.title || quest.name || quest.id,
          objectiveType: obj3.type,
          objectiveDescription: obj3.description,
          position: { x: pos.x, z: pos.z },
          color: MARKER_STYLES.active_objective.color,
          shape: getObjectiveMarkerShape(obj3.type)
        });
      }
    }
    return markers;
  }

  // @insimul/core/src/game-engine/logic/waypointFading.ts
  function computeWaypointAlpha(distance) {
    if (distance < 3) return 0;
    if (distance < 8) return (distance - 3) / 5;
    if (distance > 200) return 0.2;
    if (distance > 150) return 0.2 + 0.8 * ((200 - distance) / 50);
    return 1;
  }

  // @insimul/core/src/game-engine/logic/DynamicQuestWaypointDirector.ts
  var BUSINESS_OBJECTIVE_MAP = {
    order_food: ["restaurant", "cafe", "bakery", "tavern", "inn", "diner", "bistro"],
    haggle_price: ["shop", "store", "market", "merchant", "boutique", "trade"],
    craft_item: ["workshop", "forge", "smithy", "carpentry", "artisan"]
  };
  var CONVERSATION_OBJECTIVE_TYPES = /* @__PURE__ */ new Set([
    "talk_to_npc",
    "complete_conversation",
    "use_vocabulary",
    "introduce_self",
    "build_friendship",
    "listen_and_repeat",
    "pronunciation_check",
    "translation_challenge",
    "listening_comprehension",
    "write_response",
    "describe_scene",
    "ask_for_directions",
    "conversation_initiation"
  ]);
  var DynamicQuestWaypointDirector = class {
    /**
     * Resolve waypoint positions for all incomplete objectives of a quest.
     *
     * Priority for position resolution:
     * 1. Explicit objective position/locationPosition
     * 2. NPC-based: find NPC in building map or NPC positions
     * 3. Business-based: match objective type to business type
     * 4. Conversation-only: nearest NPC to player
     * 5. Quest-level locationName matched to buildings
     */
    resolveWaypoints(quest, buildingData, npcBuildingMap, npcPositions, playerPosition) {
      const waypoints = [];
      const objectives = this.getIncompleteObjectives(quest);
      if (objectives.length === 0) return waypoints;
      for (const obj3 of objectives) {
        const resolved = this.resolveObjectivePosition(
          quest,
          obj3,
          buildingData,
          npcBuildingMap,
          npcPositions,
          playerPosition
        );
        if (resolved) {
          waypoints.push(resolved);
        }
      }
      return waypoints;
    }
    /**
     * Compute compass data pointing to the nearest incomplete objective.
     */
    getCompassData(waypoints, playerPosition, playerForwardAngle) {
      if (waypoints.length === 0) return null;
      let nearest = null;
      let nearestDist = Infinity;
      for (const wp of waypoints) {
        const dist = this.distance2D(playerPosition, wp.position);
        if (dist < nearestDist) {
          nearestDist = dist;
          nearest = wp;
        }
      }
      if (!nearest) return null;
      if (nearestDist < 3) {
        return {
          angle: 0,
          // Point straight ahead — player is essentially at the target
          distance: nearestDist,
          label: nearest.label || nearest.objectiveType,
          objectiveType: nearest.objectiveType
        };
      }
      const dx = nearest.position.x - playerPosition.x;
      const dz = nearest.position.z - playerPosition.z;
      const worldAngle = Math.atan2(dx, dz);
      const relativeAngle = this.normalizeAngle(worldAngle - playerForwardAngle);
      return {
        angle: relativeAngle,
        distance: nearestDist,
        label: nearest.label || nearest.objectiveType,
        objectiveType: nearest.objectiveType
      };
    }
    /**
     * Compute alpha (opacity) for a waypoint based on distance to player.
     * Delegates to shared computeWaypointAlpha for consistent breakpoints.
     */
    getDistanceAlpha(playerPosition, waypointPosition) {
      const dist = this.distance2D(playerPosition, waypointPosition);
      return computeWaypointAlpha(dist);
    }
    // ── Private helpers ──────────────────────────────────────────────────────
    getIncompleteObjectives(quest) {
      const objectives = [];
      if (quest.objectives) {
        for (const obj3 of quest.objectives) {
          if (!obj3.completed) {
            objectives.push(obj3);
          }
        }
      }
      if (quest.completionCriteria?.objectives) {
        const criteriaObjs = Array.isArray(quest.completionCriteria.objectives) ? quest.completionCriteria.objectives : [];
        for (const obj3 of criteriaObjs) {
          if (!obj3.completed) {
            objectives.push({
              id: obj3.id || `crit_${objectives.length}`,
              type: obj3.type || quest.questType,
              completed: false,
              position: obj3.position,
              locationPosition: obj3.locationPosition,
              locationName: obj3.locationName,
              npcId: obj3.npcId,
              npcName: obj3.npcName,
              itemName: obj3.itemName,
              directionSteps: obj3.directionSteps,
              navigationWaypoints: obj3.navigationWaypoints,
              stepsCompleted: obj3.stepsCompleted,
              waypointsReached: obj3.waypointsReached
            });
          }
        }
      }
      return objectives;
    }
    resolveObjectivePosition(quest, objective, buildingData, npcBuildingMap, npcPositions, playerPosition) {
      const objId = `${quest.id}_${objective.id}`;
      if (objective.type === "follow_directions" && objective.directionSteps) {
        const stepIdx = objective.stepsCompleted || 0;
        if (stepIdx < objective.directionSteps.length) {
          const step = objective.directionSteps[stepIdx];
          const pos = step.targetPosition || step.locationPosition;
          if (pos) {
            return {
              objectiveId: objId,
              objectiveType: objective.type,
              position: pos,
              label: step.locationName || step.instruction
            };
          }
        }
      }
      if (objective.type === "navigate_language" && objective.navigationWaypoints) {
        const wpIdx = objective.waypointsReached || 0;
        if (wpIdx < objective.navigationWaypoints.length) {
          const wp = objective.navigationWaypoints[wpIdx];
          const pos = wp.targetPosition || wp.locationPosition;
          if (pos) {
            return {
              objectiveId: objId,
              objectiveType: objective.type,
              position: pos,
              label: wp.locationName || wp.instruction
            };
          }
        }
      }
      const explicitPos = objective.position || objective.locationPosition;
      if (explicitPos) {
        return {
          objectiveId: objId,
          objectiveType: objective.type,
          position: explicitPos,
          label: objective.locationName || objective.npcName
        };
      }
      if (objective.destinationPosition) {
        return {
          objectiveId: objId,
          objectiveType: objective.type,
          position: objective.destinationPosition,
          label: "Destination"
        };
      }
      const npcId = objective.npcId || objective.escortNpcId;
      if (npcId) {
        const pos = this.findNpcPosition(npcId, buildingData, npcBuildingMap, npcPositions);
        if (pos) {
          return {
            objectiveId: objId,
            objectiveType: objective.type,
            position: pos,
            label: objective.npcName
          };
        }
      }
      const businessPos = this.findBusinessForObjective(objective.type, buildingData);
      if (businessPos) {
        return {
          objectiveId: objId,
          objectiveType: objective.type,
          position: businessPos.position,
          label: businessPos.label
        };
      }
      const locName = objective.locationName || quest.locationName;
      if (locName) {
        const pos = this.findBuildingByName(locName, buildingData);
        if (pos) {
          return {
            objectiveId: objId,
            objectiveType: objective.type,
            position: pos,
            label: locName
          };
        }
      }
      if (quest.assignedByCharacterId) {
        const pos = this.findNpcPosition(quest.assignedByCharacterId, buildingData, npcBuildingMap, npcPositions);
        if (pos) {
          return {
            objectiveId: objId,
            objectiveType: objective.type,
            position: pos,
            label: "Quest Giver"
          };
        }
      }
      if (CONVERSATION_OBJECTIVE_TYPES.has(objective.type) && npcPositions.length > 0) {
        const nearest = this.findNearestNpc(playerPosition, npcPositions);
        if (nearest) {
          return {
            objectiveId: objId,
            objectiveType: objective.type,
            position: nearest.position,
            label: nearest.name || "Nearby NPC"
          };
        }
      }
      const warnKey = `${quest.id}_${objective.id}`;
      if (!this._warnedObjectives) this._warnedObjectives = /* @__PURE__ */ new Set();
      if (!this._warnedObjectives.has(warnKey)) {
        this._warnedObjectives.add(warnKey);
        console.debug(
          `[DynamicQuestWaypointDirector] Could not resolve position for objective "${objective.id}" (type: ${objective.type}) in quest "${quest.title || quest.id}". npcId=${objective.npcId || "none"}, locationName=${objective.locationName || "none"}, npcPositions=${npcPositions.length}, buildingData=${buildingData.size}`
        );
      }
      return null;
    }
    findNpcPosition(npcId, buildingData, npcBuildingMap, npcPositions) {
      const npcEntry = npcPositions.find((n) => n.id === npcId);
      if (npcEntry) return npcEntry.position;
      const buildingId = npcBuildingMap.get(npcId);
      if (buildingId) {
        const building = buildingData.get(buildingId);
        if (building) return building.position;
      }
      return null;
    }
    findBusinessForObjective(objectiveType, buildingData) {
      const businessTypes = BUSINESS_OBJECTIVE_MAP[objectiveType];
      if (!businessTypes) return null;
      for (const [, entry] of buildingData) {
        const meta = entry.metadata;
        if (!meta) continue;
        const name = (meta.name || meta.businessName || "").toLowerCase();
        const type = (meta.type || meta.businessType || "").toLowerCase();
        const category = (meta.category || "").toLowerCase();
        for (const bType of businessTypes) {
          if (name.includes(bType) || type.includes(bType) || category.includes(bType)) {
            return {
              position: entry.position,
              label: meta.name || meta.businessName || type
            };
          }
        }
      }
      return null;
    }
    findBuildingByName(locationName, buildingData) {
      const target = locationName.toLowerCase();
      for (const [, entry] of buildingData) {
        const meta = entry.metadata;
        if (!meta) continue;
        const name = (meta.name || meta.businessName || "").toLowerCase();
        const settlement = (meta.settlementName || "").toLowerCase();
        const type = (meta.type || meta.businessType || "").toLowerCase();
        if (name && (name.includes(target) || target.includes(name)) || settlement && (settlement.includes(target) || target.includes(settlement)) || type && type.includes(target)) {
          return entry.position;
        }
      }
      return null;
    }
    findNearestNpc(playerPosition, npcPositions) {
      let nearest = null;
      let nearestDist = Infinity;
      for (const npc of npcPositions) {
        const dist = this.distance2D(playerPosition, npc.position);
        if (dist < nearestDist) {
          nearestDist = dist;
          nearest = npc;
        }
      }
      return nearest;
    }
    distance2D(a, b) {
      const dx = a.x - b.x;
      const dz = a.z - b.z;
      return Math.sqrt(dx * dx + dz * dz);
    }
    normalizeAngle(angle) {
      while (angle > Math.PI) angle -= 2 * Math.PI;
      while (angle < -Math.PI) angle += 2 * Math.PI;
      return angle;
    }
  };

  // @insimul/core/src/game-engine/logic/GameTimeManager.ts
  function getTimeOfDay(hour) {
    if (hour >= 5 && hour < 7) return "dawn";
    if (hour >= 7 && hour < 10) return "morning";
    if (hour >= 10 && hour < 14) return "midday";
    if (hour >= 14 && hour < 17) return "afternoon";
    if (hour >= 17 && hour < 20) return "evening";
    return "night";
  }
  var GameTimeManager = class {
    constructor(options = {}) {
      __publicField(this, "_hour");
      __publicField(this, "_minute");
      __publicField(this, "_day");
      __publicField(this, "_accumulatedMs", 0);
      __publicField(this, "_msPerGameHour");
      __publicField(this, "_paused", false);
      /** Multiplier applied on top of base rate (1 = normal, 2 = 2x, etc.). */
      __publicField(this, "_timeScale", 1);
      __publicField(this, "_eventBus", null);
      __publicField(this, "_lastTimeOfDay");
      this._msPerGameHour = options.msPerGameHour ?? 6e4;
      this._hour = options.startHour ?? 8;
      this._minute = options.startMinute ?? 0;
      this._day = options.startDay ?? 1;
      this._lastTimeOfDay = getTimeOfDay(this._hour);
    }
    // ── Wiring ──────────────────────────────────────────────────────────────
    setEventBus(bus) {
      this._eventBus = bus;
    }
    // ── Getters ─────────────────────────────────────────────────────────────
    get hour() {
      return this._hour;
    }
    get minute() {
      return Math.floor(this._minute);
    }
    get day() {
      return this._day;
    }
    /** Alias: 1 timestep = 1 day. */
    get timestep() {
      return this._day;
    }
    get timeOfDay() {
      return getTimeOfDay(this._hour);
    }
    get paused() {
      return this._paused;
    }
    get timeScale() {
      return this._timeScale;
    }
    get msPerGameHour() {
      return this._msPerGameHour;
    }
    get isDaytime() {
      return this._hour >= 6 && this._hour < 18;
    }
    /** Fractional hour (0–24), e.g. 8.5 = 8:30 AM. Used for smooth interpolation. */
    get fractionalHour() {
      return this._hour + this._minute / 60;
    }
    /** Formatted "HH:MM". */
    get timeString() {
      return `${String(this._hour).padStart(2, "0")}:${String(this.minute).padStart(2, "0")}`;
    }
    /** Real seconds that elapse per game hour at current settings. */
    get realSecondsPerGameHour() {
      return this._msPerGameHour / (this._timeScale * 1e3);
    }
    // ── Setters / controls ──────────────────────────────────────────────────
    pause() {
      this._paused = true;
    }
    resume() {
      this._paused = false;
    }
    setTimeScale(scale) {
      this._timeScale = Math.max(0.25, Math.min(16, scale));
    }
    setMsPerGameHour(ms) {
      this._msPerGameHour = Math.max(1e3, ms);
    }
    /** Advance time by a number of hours (e.g. resting). Fires hour/day/time-of-day events. */
    advanceHours(hours) {
      if (hours <= 0) return;
      for (let i = 0; i < hours; i++) {
        this._minute = 0;
        this._hour += 1;
        if (this._hour >= 24) {
          this._hour = 0;
          this._day += 1;
          this._emitDayChanged();
        }
        this._emitHourChanged();
        const currentToD = getTimeOfDay(this._hour);
        if (currentToD !== this._lastTimeOfDay) {
          this._emitTimeOfDayChanged(this._lastTimeOfDay, currentToD);
          this._lastTimeOfDay = currentToD;
        }
      }
      this._accumulatedMs = 0;
    }
    /** Set time directly (e.g. from a save). Does NOT fire events. */
    setTime(hour, minute = 0, day) {
      this._hour = Math.max(0, Math.min(23, Math.floor(hour)));
      this._minute = Math.max(0, Math.min(59, minute));
      if (day !== void 0) this._day = Math.max(1, day);
      this._accumulatedMs = 0;
      this._lastTimeOfDay = getTimeOfDay(this._hour);
    }
    // ── Main update (call every frame) ──────────────────────────────────────
    update(deltaTimeMs) {
      if (this._paused) return;
      const effectiveMs = deltaTimeMs * this._timeScale;
      this._accumulatedMs += effectiveMs;
      const msPerMinute = this._msPerGameHour / 60;
      const prevHour = this._hour;
      while (this._accumulatedMs >= msPerMinute) {
        this._accumulatedMs -= msPerMinute;
        this._minute += 1;
        if (this._minute >= 60) {
          this._minute -= 60;
          this._hour += 1;
          if (this._hour >= 24) {
            this._hour = 0;
            this._day += 1;
            this._emitDayChanged();
          }
          this._emitHourChanged();
        }
      }
      const currentToD = getTimeOfDay(this._hour);
      if (currentToD !== this._lastTimeOfDay) {
        this._emitTimeOfDayChanged(this._lastTimeOfDay, currentToD);
        this._lastTimeOfDay = currentToD;
      }
    }
    // ── Serialization ───────────────────────────────────────────────────────
    getState() {
      return {
        hour: this._hour,
        minute: this.minute,
        day: this._day,
        msPerGameHour: this._msPerGameHour,
        paused: this._paused,
        timeScale: this._timeScale
      };
    }
    restoreState(state) {
      this._hour = state.hour;
      this._minute = state.minute;
      this._day = state.day;
      this._msPerGameHour = state.msPerGameHour;
      this._paused = state.paused;
      this._timeScale = state.timeScale;
      this._accumulatedMs = 0;
      this._lastTimeOfDay = getTimeOfDay(this._hour);
    }
    // ── Event emission ──────────────────────────────────────────────────────
    _emitHourChanged() {
      this._eventBus?.emit({ type: "hour_changed", hour: this._hour, day: this._day });
    }
    _emitDayChanged() {
      this._eventBus?.emit({ type: "day_changed", day: this._day, timestep: this._day });
    }
    _emitTimeOfDayChanged(from, to) {
      this._eventBus?.emit({ type: "time_of_day_changed", from, to, hour: this._hour });
    }
    // ── Cleanup ─────────────────────────────────────────────────────────────
    dispose() {
      this._eventBus = null;
    }
  };

  // @insimul/core/src/identity/kinp.ts
  var utf8Encoder = new TextEncoder();
  var utf8Decoder = new TextDecoder();
  function prologAtom(value) {
    if (/^[a-z][a-zA-Z0-9_]*$/.test(value)) return value;
    return `'${value.replace(/\\/g, "\\\\").replace(/'/g, "\\'")}'`;
  }

  // @insimul/core/src/weather/weather-facts.ts
  function emptyWeatherDelta() {
    return { retract: [], assert: [] };
  }
  var WEATHER_RESOLUTION_PREDICATES = Object.freeze([
    "weather/1",
    "season/1",
    "weather_day/1"
  ]);
  var WEATHER_AUTHORED_FACT_PREDICATES = Object.freeze([
    "season_order/2",
    "season_length/2",
    "season_start/2",
    "year_length/1",
    "weather_kind/1",
    "weather_chance/3",
    "weather_severity/2",
    "weather_bars/2",
    "weather_harsh_above/1"
  ]);
  function weatherClimateFacts(climate) {
    const facts = [
      `year_length(${Math.trunc(climate.yearLength)}).`,
      `weather_harsh_above(${Math.trunc(climate.tuning.harshAbove)}).`
    ];
    for (const season of climate.seasons) {
      const id = prologAtom(season.id);
      facts.push(`season_order(${id}, ${Math.trunc(season.index)}).`);
      facts.push(`season_length(${id}, ${Math.trunc(season.length)}).`);
      facts.push(`season_start(${id}, ${Math.trunc(season.start)}).`);
    }
    for (const condition of climate.conditions) {
      const id = prologAtom(condition.id);
      facts.push(`weather_kind(${id}).`);
      facts.push(`weather_severity(${id}, ${Math.trunc(condition.severity)}).`);
      for (const action of condition.bars) {
        facts.push(`weather_bars(${id}, ${prologAtom(action)}).`);
      }
    }
    for (const season of climate.seasons) {
      for (const row of season.chances) {
        facts.push(
          `weather_chance(${prologAtom(season.id)}, ${prologAtom(row.condition)}, ${Math.trunc(row.weight)}).`
        );
      }
    }
    return facts;
  }
  function weatherFact(condition) {
    return `weather(${prologAtom(condition)}).`;
  }
  function seasonFact(season) {
    return `season(${prologAtom(season)}).`;
  }
  function weatherDayFact(day) {
    return `weather_day(${Math.trunc(day)}).`;
  }
  function weatherDelta(before, after) {
    const delta = emptyWeatherDelta();
    const from = before ?? { day: null, season: null, condition: null };
    const to = after ?? { day: null, season: null, condition: null };
    if (from.condition !== to.condition) {
      if (from.condition !== null) delta.retract.push(weatherFact(from.condition));
      if (to.condition !== null) delta.assert.push(weatherFact(to.condition));
    }
    if (from.season !== to.season) {
      if (from.season !== null) delta.retract.push(seasonFact(from.season));
      if (to.season !== null) delta.assert.push(seasonFact(to.season));
    }
    const fromDay = from.day === null ? null : Math.trunc(from.day);
    const toDay = to.day === null ? null : Math.trunc(to.day);
    if (fromDay !== toDay) {
      if (fromDay !== null) delta.retract.push(weatherDayFact(fromDay));
      if (toDay !== null) delta.assert.push(weatherDayFact(toDay));
    }
    return delta;
  }
  function weatherStateFacts(state) {
    if (state === null) return [];
    const facts = [weatherDayFact(state.day)];
    if (state.season !== null) facts.push(seasonFact(state.season));
    if (state.condition !== null) facts.push(weatherFact(state.condition));
    return facts;
  }

  // @insimul/core/src/ai/deterministic-stream.ts
  function hashSeedString(text2) {
    let h = 2166136261 >>> 0;
    for (let i = 0; i < text2.length; i++) {
      h ^= text2.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return h >>> 0;
  }
  function streamKey(parts) {
    return parts.map((part) => {
      const text2 = String(part);
      return `${text2.length}:${text2}`;
    }).join("");
  }
  function compareIds(a, b) {
    return a === b ? 0 : a < b ? -1 : 1;
  }

  // @insimul/core/src/weather/weather.ts
  var DEFAULT_WEATHER_TUNING = Object.freeze({
    persistence: 60,
    harshAbove: 60,
    defaultSeasonLength: 30,
    defaultSeverity: 0
  });
  var EMPTY_CLIMATE = Object.freeze({
    seasons: Object.freeze([]),
    conditions: Object.freeze([]),
    yearLength: 0,
    tuning: DEFAULT_WEATHER_TUNING
  });
  function weatherTuningFromIR(ir) {
    return {
      persistence: clampScale(intOr(ir?.persistence, DEFAULT_WEATHER_TUNING.persistence)),
      harshAbove: clampScale(intOr(ir?.harshAbove, DEFAULT_WEATHER_TUNING.harshAbove)),
      defaultSeasonLength: Math.max(
        1,
        intOr(ir?.defaultSeasonLength, DEFAULT_WEATHER_TUNING.defaultSeasonLength)
      ),
      defaultSeverity: clampScale(intOr(ir?.defaultSeverity, DEFAULT_WEATHER_TUNING.defaultSeverity))
    };
  }
  function seasonsFromIR(ir, tuning) {
    const resolved = tuning ?? weatherTuningFromIR(ir);
    const spans = [];
    for (const authored of ir?.seasons ?? []) {
      if (!authored?.id) continue;
      spans.push(resolveSeason(authored, resolved, spans.length));
    }
    spans.sort((a, b) => a.index - b.index || compareIds(a.id, b.id));
    const seasons = [];
    let start = 0;
    for (const span of spans) {
      seasons.push({ ...span, start });
      start += span.length;
    }
    return seasons;
  }
  function resolveSeason(authored, tuning, fallbackIndex) {
    const chances = /* @__PURE__ */ new Map();
    for (const row of authored.weather ?? []) {
      if (!row?.condition) continue;
      chances.set(row.condition, clampScale(intOr(row.weight, 0)));
    }
    return {
      id: authored.id,
      index: Math.max(0, intOr(authored.index, fallbackIndex)),
      length: Math.max(1, intOr(authored.length, tuning.defaultSeasonLength)),
      chances: [...chances.entries()].map(([condition, weight]) => ({ condition, weight })).sort((a, b) => compareIds(a.condition, b.condition))
    };
  }
  function conditionsFromIR(ir, tuning) {
    const resolved = tuning ?? weatherTuningFromIR(ir);
    const conditions = [];
    for (const authored of ir?.conditions ?? []) {
      if (!authored?.id) continue;
      conditions.push(resolveCondition(authored, resolved));
    }
    return conditions.sort((a, b) => compareIds(a.id, b.id));
  }
  function resolveCondition(authored, tuning) {
    return {
      id: authored.id,
      severity: clampScale(intOr(authored.severity, tuning.defaultSeverity)),
      bars: Array.from(new Set((authored.bars ?? []).filter(Boolean))).sort(compareIds)
    };
  }
  function climateFromIR(ir, tuning) {
    const resolved = tuning ?? weatherTuningFromIR(ir);
    const seasons = seasonsFromIR(ir, resolved);
    return {
      seasons,
      conditions: conditionsFromIR(ir, resolved),
      yearLength: seasons.reduce((sum, season) => sum + season.length, 0),
      tuning: resolved
    };
  }
  function clampScale(value) {
    const n = Math.trunc(value);
    return n < 0 ? 0 : n > 100 ? 100 : n;
  }
  function dayOfYear(climate, day) {
    const length = climate.yearLength;
    if (length <= 0) return 0;
    const d = Math.trunc(day) % length;
    return d < 0 ? d + length : d;
  }
  function seasonForDay(climate, day) {
    if (climate.yearLength <= 0) return null;
    const d = dayOfYear(climate, day);
    return climate.seasons.find((s) => d >= s.start && d < s.start + s.length) ?? null;
  }
  function dayOfSeason(climate, day) {
    const season = seasonForDay(climate, day);
    if (season === null) return -1;
    return dayOfYear(climate, day) - season.start;
  }
  function conditionOf(climate, id) {
    if (id === null) return void 0;
    return climate.conditions.find((c) => c.id === id);
  }
  function isHarsh(climate, id) {
    const condition = conditionOf(climate, id);
    return condition !== void 0 && condition.severity > climate.tuning.harshAbove;
  }
  function possibleConditions(climate, seasonId) {
    if (seasonId === null) return [];
    const season = climate.seasons.find((s) => s.id === seasonId);
    if (season === void 0) return [];
    const known = new Set(climate.conditions.map((c) => c.id));
    return season.chances.filter((row) => row.weight > 0 && known.has(row.condition));
  }
  var PERSISTENCE_SUBJECT = "hold";
  var PICK_SUBJECT = "pick";
  function weatherRoll(seed, day, subject, bound) {
    if (bound <= 0) return 0;
    return hashSeedString(streamKey([seed, "weather", Math.trunc(day), subject])) % bound;
  }
  function rollCondition(climate, seasonId, seed, day) {
    const rows = possibleConditions(climate, seasonId);
    const total = rows.reduce((sum, row) => sum + row.weight, 0);
    if (total <= 0) return null;
    let roll = weatherRoll(seed, day, PICK_SUBJECT, total);
    for (const row of rows) {
      roll -= row.weight;
      if (roll < 0) return row.condition;
    }
    return rows[rows.length - 1].condition;
  }
  function initialWeatherState() {
    return { day: 0, season: null, condition: null };
  }
  function stepWeather(state, climate, seed, day) {
    const target = Math.trunc(day);
    const season = seasonForDay(climate, target);
    const seasonId = season?.id ?? null;
    const held = state.condition !== null && possibleConditions(climate, seasonId).some((row) => row.condition === state.condition) && weatherRoll(seed, target, PERSISTENCE_SUBJECT, 100) < climate.tuning.persistence;
    return {
      day: target,
      season: seasonId,
      condition: held ? state.condition : rollCondition(climate, seasonId, seed, target)
    };
  }
  function runWeather(state, climate, seed, throughDay) {
    const target = Math.trunc(throughDay);
    const from = Math.max(Math.trunc(state.day) + 1, target - MAX_STEPS + 1);
    const steps = [];
    let current = state;
    for (let day = from; day <= target; day += 1) {
      current = stepWeather(current, climate, seed, day);
      steps.push(current);
    }
    return steps;
  }
  var MAX_STEPS = 365;
  function weatherView(state, climate) {
    const condition = conditionOf(climate, state.condition);
    return Object.freeze({
      day: Math.trunc(state.day),
      season: state.season,
      condition: state.condition,
      dayOfSeason: dayOfSeason(climate, state.day),
      severity: condition?.severity ?? 0,
      harsh: isHarsh(climate, state.condition),
      barred: Object.freeze([...condition?.bars ?? []])
    });
  }
  function weatherIssues(climate) {
    const issues = [];
    const seen = /* @__PURE__ */ new Set();
    const known = new Set(climate.conditions.map((c) => c.id));
    for (const season of climate.seasons) {
      if (seen.has(season.id)) issues.push(`season "${season.id}" is declared twice`);
      seen.add(season.id);
      for (const row of season.chances) {
        if (!known.has(row.condition)) {
          issues.push(
            `season "${season.id}" gives weight to "${row.condition}", which is not a weather condition this world declares`
          );
        }
      }
      if (possibleConditions(climate, season.id).length === 0) {
        issues.push(
          `season "${season.id}" brings no weather at all, so the sky never changes while it lasts`
        );
      }
    }
    const ranks = /* @__PURE__ */ new Map();
    for (const season of climate.seasons) {
      const taken = ranks.get(season.index);
      if (taken !== void 0) {
        issues.push(`seasons "${taken}" and "${season.id}" are both at index ${season.index}`);
      }
      ranks.set(season.index, season.id);
    }
    const conditions = /* @__PURE__ */ new Set();
    for (const condition of climate.conditions) {
      if (conditions.has(condition.id)) issues.push(`condition "${condition.id}" is declared twice`);
      conditions.add(condition.id);
      const reachable = climate.seasons.some(
        (s) => s.chances.some((row) => row.condition === condition.id && row.weight > 0)
      );
      if (!reachable) {
        issues.push(
          `condition "${condition.id}" is brought by no season, so only a script can ever cause it`
        );
      }
    }
    if (climate.seasons.length > 0 && climate.yearLength <= 0) {
      issues.push("the year has no length, so no day falls in any season");
    }
    return issues.sort(compareIds);
  }
  function intOr(value, fallback) {
    return typeof value === "number" && Number.isFinite(value) ? Math.trunc(value) : fallback;
  }

  // @insimul/core/src/game-engine/logic/WeatherDirector.ts
  var WeatherDirector = class {
    constructor(config = {}) {
      __publicField(this, "engine");
      __publicField(this, "eventBus");
      __publicField(this, "sink");
      __publicField(this, "seed");
      __publicField(this, "authored");
      __publicField(this, "current", initialWeatherState());
      /** `false` until the first step or restore — the state before there is a sky. */
      __publicField(this, "started", false);
      this.engine = config.engine;
      this.eventBus = config.eventBus;
      this.sink = resolveSink(config.host);
      this.seed = config.seed ?? "";
      const authored = config.weather;
      if (authored !== null && authored !== void 0 && "yearLength" in authored) {
        this.authored = authored;
      } else {
        const ir = authored ?? null;
        const tuning = { ...weatherTuningFromIR(ir), ...config.tuning };
        this.authored = ir === null ? { ...EMPTY_CLIMATE, tuning } : climateFromIR(ir, tuning);
      }
    }
    // ── The authored world ────────────────────────────────────────────────────
    /** The world's resolved climate. Read-only. */
    climate() {
      return this.authored;
    }
    /** Everything wrong with the climate this world authored. Empty = sound. */
    issues() {
      return weatherIssues(this.authored);
    }
    /**
     * Publish the authored calendar and conditions into the KB.
     *
     * For load time, and for a caller that wired the KB after the world — exactly
     * what `RoutineDirector.publishRoutines` and `VolitionDirector.publishDesires`
     * are for. Returns how many facts were written.
     */
    async publishClimate(engine = this.engine) {
      if (!engine) return 0;
      const facts = weatherClimateFacts(this.authored);
      for (const fact of facts) await engine.assertFact(stripPeriod(fact));
      return facts.length;
    }
    // ── The sky ───────────────────────────────────────────────────────────────
    /** The current sky. A copy — the caller cannot write the module's state. */
    state() {
      return { ...this.current };
    }
    /**
     * Everything a renderer needs, DERIVED and frozen.
     *
     * Computed from the canonical state every time it is asked rather than held
     * beside it, which is the whole of "derived rendering fields are read-only":
     * there is no second copy of the weather for a host and the KB to disagree
     * about, and the object a host receives cannot be written to.
     */
    view() {
      return weatherView(this.current, this.authored);
    }
    /**
     * Advance the sky to the day the world has reached.
     *
     * The day is an INPUT — `GameTimeManager`'s clock, handed in. Every day
     * between the last one stepped and this one is stepped in order, because
     * persistence looks one day back and a jump would skip the progression rather
     * than reproduce it. A day at or before the last one stepped does nothing and
     * returns an empty advance, which is the correct answer for a clock that has
     * not moved: this module is not on a per-tick write path.
     *
     * **A world with no sky yet rolls the target day alone**, rather than
     * simulating every day from the epoch to it. There is no prior condition for
     * persistence to hold, so a history would be a thousand rolls whose only
     * effect is the last one — and a world opened on day 40,000 would spend a
     * frame on it. What a fresh world does not have is a PAST, and pretending
     * otherwise would be inventing one.
     */
    async advanceTo(day) {
      const target = Math.trunc(day);
      if (this.started && target <= this.current.day) {
        return { day: this.current.day, steps: [], state: this.state(), changed: false };
      }
      const from = this.started ? this.current : { ...initialWeatherState(), day: target - 1 };
      const rolled = runWeather(from, this.authored, this.seed, target);
      const steps = [];
      let previous = from;
      let changed = false;
      const wasStarted = this.started;
      for (const [index, state] of rolled.entries()) {
        const wrote = await this.writeDelta(
          weatherDelta(index === 0 && !wasStarted ? null : previous, state)
        );
        changed = changed || wrote;
        steps.push({
          day: state.day,
          state,
          conditionChanged: previous.condition !== state.condition,
          seasonTurned: previous.season !== state.season
        });
        previous = state;
      }
      this.current = previous;
      this.started = true;
      if (steps.length > 0) this.announce(steps[steps.length - 1], from);
      return { day: this.current.day, steps, state: this.state(), changed };
    }
    /**
     * Impose a condition the calendar did not roll — a quest, a ritual, a cutscene.
     *
     * The escape hatch a world needs and the reason `weather_kind/1` exists
     * separately from `weather_chance/3`: a condition no season brings is still a
     * condition, and a story that summons a storm should not have to make storms
     * likely in June. It is the same fact by the same name, so every rule reads it
     * identically and the next {@link advanceTo} rolls on from it.
     *
     * Returns `false` when the condition is not one this world declares — a typo
     * leaves the sky alone rather than asserting a fact no rule can interpret.
     */
    async impose(condition) {
      if (condition !== null && conditionOf(this.authored, condition) === void 0) return false;
      const before = this.started ? this.current : null;
      if (before !== null && before.condition === condition) return false;
      const after = { ...this.current, condition };
      this.current = after;
      this.started = true;
      await this.writeDelta(weatherDelta(before, after));
      this.announce(
        {
          day: after.day,
          state: after,
          conditionChanged: true,
          seasonTurned: false
        },
        before ?? { ...initialWeatherState(), day: after.day }
      );
      return true;
    }
    // ── The KB ────────────────────────────────────────────────────────────────
    /**
     * Write one delta into the KB, retracting first.
     *
     * Retracting a fact the KB never carried is a no-op rather than a failure: a
     * host with its own persistence, a restored save and a sky advanced before the
     * engine was wired all produce one, and none of them is an error.
     */
    async writeDelta(delta) {
      if (delta.retract.length === 0 && delta.assert.length === 0) return false;
      if (!this.engine) return true;
      for (const fact of delta.retract) {
        try {
          await this.engine.retractFact(stripPeriod(fact));
        } catch {
        }
      }
      for (const fact of delta.assert) {
        await this.engine.assertFact(stripPeriod(fact));
      }
      return true;
    }
    /**
     * Publish the runtime facts, for a caller that wired the KB after the sky — a
     * save restore, a host that builds its world before its engine.
     */
    async publishState(engine = this.engine) {
      if (!engine || !this.started) return 0;
      const facts = weatherStateFacts(this.current);
      for (const fact of facts) await engine.assertFact(stripPeriod(fact));
      return facts.length;
    }
    /**
     * Read the sky back OUT of the KB.
     *
     * The other half of AC2's round trip, and the reason it is worth having at
     * all: if the facts are canonical then the KB is a complete description of the
     * weather, so a director rebuilt from them must equal the one that wrote them.
     * `weather/__tests__/round-trip.test.ts` asserts exactly that against a real
     * engine, in both directions.
     */
    async readState(engine = this.engine) {
      if (!engine) return null;
      const day = await one(engine, "weather_day(D)", "D");
      if (day === null) return null;
      return {
        day: int(day) ?? 0,
        season: text(await one(engine, "season(S)", "S")),
        condition: text(await one(engine, "weather(C)", "C"))
      };
    }
    // ── The host ──────────────────────────────────────────────────────────────
    /**
     * Tell the host what the sky is — once, absolutely, and only when it moved.
     *
     * Nothing is read back. The sink returns `void`, so there is no channel through
     * which a host could tell core it is raining, which is the property that keeps
     * two engines from disagreeing again.
     */
    announce(step, from) {
      if (!step.conditionChanged && !step.seasonTurned) return;
      this.sink?.applyWeather(this.report());
      this.eventBus?.emit({
        type: "weather_changed",
        day: step.day,
        season: step.state.season,
        condition: step.state.condition,
        fromSeason: from.season,
        fromCondition: from.condition,
        seasonTurned: step.seasonTurned,
        severity: conditionOf(this.authored, step.state.condition)?.severity ?? 0,
        harsh: isHarsh(this.authored, step.state.condition)
      });
    }
    /** The whole current sky, as a host receives it. Frozen. */
    report() {
      const view2 = this.view();
      return Object.freeze({
        day: view2.day,
        season: view2.season,
        condition: view2.condition,
        dayOfSeason: view2.dayOfSeason,
        severity: view2.severity,
        harsh: view2.harsh
      });
    }
    // ── Save/restore ──────────────────────────────────────────────────────────
    /**
     * The per-playthrough state, and only that: the day the sky was rolled for,
     * the season and the condition. The calendar, the weights and the severities
     * are authored and are NOT here — a tuning number inside a save file is
     * world-template data leaking into a playthrough
     * (`docs/mechanic-predicates.md` §3).
     */
    serialize() {
      return this.started ? { ...this.current } : null;
    }
    /**
     * Restore a saved playthrough. Silent — no events, no host call and no KB
     * writes, because loading a save is not the weather turning, and
     * re-publishing is what {@link publishState} is for once the engine exists.
     */
    restore(state) {
      if (!state) {
        this.current = initialWeatherState();
        this.started = false;
        return;
      }
      const day = int(state.day) ?? 0;
      this.current = {
        day,
        // A season the calendar no longer has — the creator renamed it, or a save
        // from an older export — resolves to what the DAY says it is rather than
        // to a fact no rule can read. The day is the canonical thing; the season
        // is a function of it.
        season: this.authored.seasons.some((s) => s.id === state.season) ? state.season : seasonForDay(this.authored, day)?.id ?? null,
        condition: state.condition !== null && conditionOf(this.authored, state.condition) !== void 0 ? state.condition : null
      };
      this.started = true;
    }
  };
  function resolveSink(host) {
    if (!host) return void 0;
    if ("applyWeather" in host && typeof host.applyWeather === "function") return host;
    return host.weather;
  }
  async function one(engine, goal, variable) {
    const result = await engine.query(goal, 1);
    if (!result.success || result.bindings.length === 0) return null;
    const value = result.bindings[0][variable];
    return typeof value === "string" || typeof value === "number" ? value : null;
  }
  function text(value) {
    if (typeof value === "string") return value;
    if (typeof value === "number") return String(value);
    return null;
  }
  function int(value) {
    if (typeof value === "number") return Number.isFinite(value) ? Math.trunc(value) : null;
    if (typeof value === "string") {
      const parsed = Number(value);
      return Number.isFinite(parsed) ? Math.trunc(parsed) : null;
    }
    return null;
  }
  function stripPeriod(clause) {
    return clause.replace(/\.$/, "");
  }

  // @insimul/core/src/game-genres/registry.ts
  var DEFAULT_GENRE_ID = "rpg";
  var CAMERA_MODES = Object.freeze([
    "first_person",
    "third_person",
    "isometric",
    "side_scroll",
    "top_down",
    "fighting"
  ]);
  var defaultFeatures = {
    inventory: true,
    crafting: false,
    dialogue: true,
    combat: true,
    building: false,
    resources: false,
    permadeath: false,
    quests: true,
    experience: true,
    skills: true
  };
  var GENRE_REGISTRY = {
    "rpg": {
      id: "rpg",
      name: "RPG",
      description: "Role-playing game with character progression, quests, and story",
      cameraMode: "third_person",
      movementPlane: "free",
      controlScheme: "wasd_mouse",
      combatStyle: "melee",
      movementStyle: "free",
      uiLayout: "action_rpg",
      defaultWorldType: "medieval-fantasy",
      features: {
        ...defaultFeatures,
        inventory: true,
        crafting: true
      },
      questTypes: ["rpg"],
      difficultyLevels: ["easy", "normal", "hard", "legendary"],
      defaultPlayerSpeed: 1,
      defaultJumpHeight: 1,
      gravityMultiplier: 1,
      showMinimap: true,
      showHealthBar: true,
      showStaminaBar: true,
      showAmmoCounter: false,
      showCompass: true
    },
    "action": {
      id: "action",
      name: "Action",
      description: "Fast-paced combat and reflexes",
      cameraMode: "third_person",
      movementPlane: "free",
      controlScheme: "wasd_mouse",
      combatStyle: "melee",
      movementStyle: "free",
      uiLayout: "action_rpg",
      defaultWorldType: "medieval-fantasy",
      features: {
        ...defaultFeatures,
        crafting: false
      },
      questTypes: ["rpg"],
      difficultyLevels: ["easy", "normal", "hard"],
      defaultPlayerSpeed: 1.2,
      defaultJumpHeight: 1,
      gravityMultiplier: 1,
      showMinimap: false,
      showHealthBar: true,
      showStaminaBar: true,
      showAmmoCounter: false,
      showCompass: false
    },
    "fighting": {
      id: "fighting",
      name: "Fighting",
      description: "One-on-one combat with combos and special moves",
      cameraMode: "fighting",
      movementPlane: "xy",
      controlScheme: "wasd_mouse",
      combatStyle: "melee",
      movementStyle: "free",
      uiLayout: "minimal",
      defaultWorldType: "generic",
      features: {
        ...defaultFeatures,
        inventory: false,
        dialogue: false,
        quests: false,
        experience: false,
        skills: false
      },
      questTypes: [],
      difficultyLevels: ["easy", "normal", "hard"],
      defaultPlayerSpeed: 1,
      defaultJumpHeight: 1.2,
      gravityMultiplier: 1,
      showMinimap: false,
      showHealthBar: true,
      showStaminaBar: false,
      showAmmoCounter: false,
      showCompass: false
    },
    "platformer": {
      id: "platformer",
      name: "Platformer",
      description: "Jumping and navigating levels",
      cameraMode: "side_scroll",
      movementPlane: "xy",
      controlScheme: "wasd_mouse",
      combatStyle: "melee",
      movementStyle: "platformer",
      uiLayout: "platformer",
      defaultWorldType: "generic",
      features: {
        ...defaultFeatures,
        inventory: false,
        dialogue: false,
        combat: false
      },
      questTypes: ["platformer"],
      difficultyLevels: ["easy", "normal", "hard"],
      defaultPlayerSpeed: 1,
      defaultJumpHeight: 1.5,
      gravityMultiplier: 1.2,
      showMinimap: false,
      showHealthBar: true,
      showStaminaBar: false,
      showAmmoCounter: false,
      showCompass: false
    },
    "strategy": {
      id: "strategy",
      name: "Strategy",
      description: "Tactical decision-making and resource management",
      cameraMode: "isometric",
      movementPlane: "free",
      controlScheme: "point_click",
      combatStyle: "none",
      movementStyle: "grid",
      uiLayout: "rts",
      defaultWorldType: "medieval-fantasy",
      features: {
        ...defaultFeatures,
        inventory: false,
        combat: false,
        building: true,
        resources: true
      },
      questTypes: ["strategy"],
      difficultyLevels: ["easy", "normal", "hard"],
      defaultPlayerSpeed: 1,
      defaultJumpHeight: 0,
      gravityMultiplier: 1,
      showMinimap: true,
      showHealthBar: false,
      showStaminaBar: false,
      showAmmoCounter: false,
      showCompass: false
    },
    "survival": {
      id: "survival",
      name: "Survival",
      description: "Resource gathering, crafting, and survival mechanics",
      cameraMode: "third_person",
      movementPlane: "free",
      controlScheme: "wasd_mouse",
      combatStyle: "hybrid",
      movementStyle: "free",
      uiLayout: "action_rpg",
      defaultWorldType: "post-apocalyptic",
      features: {
        ...defaultFeatures,
        inventory: true,
        crafting: true,
        building: true,
        resources: true
      },
      questTypes: ["survival"],
      difficultyLevels: ["easy", "normal", "hard", "hardcore"],
      defaultPlayerSpeed: 1,
      defaultJumpHeight: 1,
      gravityMultiplier: 1,
      showMinimap: true,
      showHealthBar: true,
      showStaminaBar: true,
      showAmmoCounter: false,
      showCompass: true
    },
    "shooter": {
      id: "shooter",
      name: "Shooter",
      description: "Ranged combat and precision shooting",
      cameraMode: "first_person",
      movementPlane: "free",
      controlScheme: "wasd_mouse",
      combatStyle: "ranged",
      movementStyle: "free",
      uiLayout: "fps",
      defaultWorldType: "cyberpunk",
      features: {
        ...defaultFeatures,
        inventory: true,
        dialogue: false
      },
      questTypes: ["shooter"],
      difficultyLevels: ["easy", "normal", "hard", "nightmare"],
      defaultPlayerSpeed: 1.1,
      defaultJumpHeight: 1,
      gravityMultiplier: 1,
      showMinimap: true,
      showHealthBar: true,
      showStaminaBar: false,
      showAmmoCounter: true,
      showCompass: true
    },
    "sandbox": {
      id: "sandbox",
      name: "Sandbox",
      description: "Open-world exploration and creativity",
      cameraMode: "third_person",
      movementPlane: "free",
      controlScheme: "wasd_mouse",
      combatStyle: "hybrid",
      movementStyle: "free",
      uiLayout: "action_rpg",
      defaultWorldType: "generic",
      features: {
        ...defaultFeatures,
        inventory: true,
        crafting: true,
        building: true,
        resources: true,
        quests: false
      },
      questTypes: [],
      difficultyLevels: ["creative", "easy", "normal", "hard"],
      defaultPlayerSpeed: 1,
      defaultJumpHeight: 1,
      gravityMultiplier: 1,
      showMinimap: true,
      showHealthBar: true,
      showStaminaBar: true,
      showAmmoCounter: false,
      showCompass: true
    },
    "city-building": {
      id: "city-building",
      name: "City Building",
      description: "Urban planning and city management",
      cameraMode: "top_down",
      movementPlane: "free",
      controlScheme: "point_click",
      combatStyle: "none",
      movementStyle: "free",
      uiLayout: "rts",
      defaultWorldType: "generic",
      features: {
        ...defaultFeatures,
        inventory: false,
        dialogue: false,
        combat: false,
        building: true,
        resources: true,
        quests: false,
        experience: false,
        skills: false
      },
      questTypes: [],
      difficultyLevels: ["easy", "normal", "hard"],
      defaultPlayerSpeed: 1,
      defaultJumpHeight: 0,
      gravityMultiplier: 1,
      showMinimap: true,
      showHealthBar: false,
      showStaminaBar: false,
      showAmmoCounter: false,
      showCompass: false
    },
    "simulation": {
      id: "simulation",
      name: "Simulation",
      description: "Realistic systems and life simulation",
      cameraMode: "third_person",
      movementPlane: "free",
      controlScheme: "wasd_mouse",
      combatStyle: "none",
      movementStyle: "free",
      uiLayout: "minimal",
      defaultWorldType: "generic",
      features: {
        ...defaultFeatures,
        inventory: true,
        combat: false
      },
      questTypes: ["rpg"],
      difficultyLevels: ["easy", "normal", "hard"],
      defaultPlayerSpeed: 1,
      defaultJumpHeight: 1,
      gravityMultiplier: 1,
      showMinimap: false,
      showHealthBar: false,
      showStaminaBar: false,
      showAmmoCounter: false,
      showCompass: false
    },
    "puzzle": {
      id: "puzzle",
      name: "Puzzle",
      description: "Logic challenges and problem-solving",
      cameraMode: "isometric",
      movementPlane: "free",
      controlScheme: "wasd_mouse",
      combatStyle: "none",
      movementStyle: "free",
      uiLayout: "puzzle",
      defaultWorldType: "generic",
      features: {
        ...defaultFeatures,
        inventory: false,
        combat: false,
        experience: false,
        skills: false
      },
      questTypes: ["puzzle"],
      difficultyLevels: ["easy", "normal", "hard", "expert"],
      defaultPlayerSpeed: 1,
      defaultJumpHeight: 1,
      gravityMultiplier: 1,
      showMinimap: false,
      showHealthBar: false,
      showStaminaBar: false,
      showAmmoCounter: false,
      showCompass: false
    },
    "language-learning": {
      id: "language-learning",
      name: "Language Learning",
      description: "Educational game focused on vocabulary and grammar",
      cameraMode: "third_person",
      movementPlane: "free",
      controlScheme: "wasd_mouse",
      combatStyle: "none",
      movementStyle: "free",
      uiLayout: "minimal",
      defaultWorldType: "historical",
      features: {
        ...defaultFeatures,
        inventory: true,
        combat: false,
        crafting: true
      },
      questTypes: ["language-learning"],
      difficultyLevels: ["beginner", "intermediate", "advanced"],
      defaultPlayerSpeed: 1,
      defaultJumpHeight: 1,
      gravityMultiplier: 1,
      showMinimap: true,
      showHealthBar: false,
      showStaminaBar: false,
      showAmmoCounter: false,
      showCompass: true
    },
    "educational": {
      id: "educational",
      name: "Educational",
      description: "Learning experiences through gameplay",
      cameraMode: "third_person",
      movementPlane: "free",
      controlScheme: "wasd_mouse",
      combatStyle: "none",
      movementStyle: "free",
      uiLayout: "minimal",
      defaultWorldType: "historical",
      features: {
        ...defaultFeatures,
        inventory: false,
        combat: false,
        crafting: false
      },
      questTypes: ["language-learning"],
      difficultyLevels: ["beginner", "intermediate", "advanced"],
      defaultPlayerSpeed: 1,
      defaultJumpHeight: 1,
      gravityMultiplier: 1,
      showMinimap: true,
      showHealthBar: false,
      showStaminaBar: false,
      showAmmoCounter: false,
      showCompass: true
    },
    "adventure": {
      id: "adventure",
      name: "Adventure",
      description: "Exploration, narrative, and puzzle-solving",
      cameraMode: "third_person",
      movementPlane: "free",
      controlScheme: "wasd_mouse",
      combatStyle: "melee",
      movementStyle: "free",
      uiLayout: "action_rpg",
      defaultWorldType: "tropical-pirate",
      features: {
        ...defaultFeatures,
        inventory: true
      },
      questTypes: ["rpg"],
      difficultyLevels: ["easy", "normal", "hard"],
      defaultPlayerSpeed: 1,
      defaultJumpHeight: 1,
      gravityMultiplier: 1,
      showMinimap: true,
      showHealthBar: true,
      showStaminaBar: false,
      showAmmoCounter: false,
      showCompass: true
    },
    "roguelike": {
      id: "roguelike",
      name: "Roguelike",
      description: "Procedural generation and permadeath",
      cameraMode: "top_down",
      movementPlane: "free",
      controlScheme: "wasd_mouse",
      combatStyle: "hybrid",
      movementStyle: "grid",
      uiLayout: "action_rpg",
      defaultWorldType: "dark-fantasy",
      features: {
        ...defaultFeatures,
        inventory: true,
        permadeath: true
      },
      questTypes: ["rpg"],
      difficultyLevels: ["normal", "hard", "nightmare"],
      defaultPlayerSpeed: 1,
      defaultJumpHeight: 0,
      gravityMultiplier: 1,
      showMinimap: true,
      showHealthBar: true,
      showStaminaBar: false,
      showAmmoCounter: false,
      showCompass: false
    }
  };
  var GENRE_IDS = Object.freeze(Object.keys(GENRE_REGISTRY));
  function getAllGenres() {
    return Object.values(GENRE_REGISTRY);
  }

  // @insimul/core/src/game-genres/recipes.ts
  function binding(b) {
    return Object.freeze({
      ...b,
      overrides: Object.freeze(b.overrides.map((o) => Object.freeze({ ...o }))),
      keepWorldConfigFor: Object.freeze([...b.keepWorldConfigFor])
    });
  }
  var RECIPE_GENRE_BINDINGS = Object.freeze({
    // Living world: the village pipeline. On an rpg or adventure world (every loop
    // world) the game IS the world's — its own genre settings, its own camera
    // default — so choosing this recipe changes nothing today's pipeline reads.
    "rpg-adventure": binding({
      recipeId: "rpg-adventure",
      genreId: "adventure",
      overrides: [],
      keepWorldConfigFor: ["rpg", "adventure"],
      camera: "world-default"
    }),
    puzzle: binding({
      recipeId: "puzzle",
      genreId: "puzzle",
      overrides: [],
      keepWorldConfigFor: [],
      camera: "recipe"
    }),
    // The registry's platformer says `combatStyle: 'melee'` with
    // `features.combat: false`. The game's genre block must not contradict itself
    // (a script that reads only the style would see melee), so the recipe says
    // `none`; the registry entry is unchanged.
    platformer: binding({
      recipeId: "platformer",
      genreId: "platformer",
      overrides: [{ path: "combatStyle", value: "none" }],
      keepWorldConfigFor: [],
      camera: "recipe"
    }),
    strategy: binding({
      recipeId: "strategy",
      genreId: "strategy",
      overrides: [],
      keepWorldConfigFor: [],
      camera: "recipe"
    })
  });
  var RECIPE_IDS = Object.freeze(Object.keys(RECIPE_GENRE_BINDINGS));
  function getRecipeGenreBinding(recipeId) {
    return Object.prototype.hasOwnProperty.call(RECIPE_GENRE_BINDINGS, recipeId) ? RECIPE_GENRE_BINDINGS[recipeId] : void 0;
  }

  // @insimul/core/src/feature-modules/genre-bundles.ts
  var ALL_MODULES = [
    "knowledge-acquisition",
    "proficiency",
    "pattern-recognition",
    "assessment",
    "npc-exams",
    "performance-scoring",
    "voice",
    "gamification",
    "skill-tree",
    "adaptive-difficulty",
    "world-lore",
    "conversation-analytics",
    "onboarding"
  ];
  function compatibleExcluding(defaults) {
    return ALL_MODULES.filter((m) => !defaults.includes(m));
  }
  var LANGUAGE_LEARNING_BUNDLE = {
    id: "language-learning",
    name: "Language Learning",
    description: "Educational game focused on vocabulary, grammar, and conversational fluency",
    defaultModules: [
      "knowledge-acquisition",
      "proficiency",
      "pattern-recognition",
      "performance-scoring",
      "voice",
      "gamification",
      "skill-tree",
      "adaptive-difficulty",
      "world-lore",
      "conversation-analytics",
      "assessment",
      "npc-exams",
      "onboarding"
    ],
    compatibleModules: [],
    // already includes all relevant modules
    moduleConfigs: {
      "proficiency": {
        tierLabels: ["A1", "A2", "B1", "B2"],
        dimensions: ["vocabulary", "grammar", "pronunciation", "listening", "communication"]
      },
      "knowledge-acquisition": {
        entryLabel: "Vocabulary Word",
        entryLabelPlural: "Vocabulary Words",
        masteryLabels: ["New", "Learning", "Familiar", "Mastered"]
      },
      "adaptive-difficulty": {
        tierLabels: ["Beginner", "Elementary", "Intermediate", "Advanced", "Near-native"]
      },
      "gamification": {
        tierLabels: ["Beginner", "Elementary", "Intermediate", "Advanced", "Near-native"]
      }
    }
  };
  var RPG_BUNDLE = {
    id: "rpg",
    name: "Role-Playing Game",
    description: "Character progression, quests, and story-driven gameplay",
    defaultModules: [
      "knowledge-acquisition",
      "proficiency",
      "gamification",
      "skill-tree",
      "adaptive-difficulty",
      "world-lore",
      "conversation-analytics",
      "onboarding"
    ],
    compatibleModules: compatibleExcluding([
      "knowledge-acquisition",
      "proficiency",
      "gamification",
      "skill-tree",
      "adaptive-difficulty",
      "world-lore",
      "conversation-analytics",
      "onboarding"
    ]),
    moduleConfigs: {
      "proficiency": {
        tierLabels: ["Novice", "Apprentice", "Journeyman", "Expert", "Master"],
        dimensions: ["melee", "ranged", "magic", "stealth", "diplomacy"]
      },
      "knowledge-acquisition": {
        entryLabel: "Lore Entry",
        entryLabelPlural: "Lore Entries",
        masteryLabels: ["Unknown", "Discovered", "Studied", "Mastered"]
      },
      "adaptive-difficulty": {
        tierLabels: ["Easy", "Normal", "Hard", "Veteran", "Legendary"]
      }
    }
  };
  var SURVIVAL_BUNDLE = {
    id: "survival",
    name: "Survival",
    description: "Resource gathering, crafting, and surviving hostile environments",
    defaultModules: [
      "knowledge-acquisition",
      "proficiency",
      "gamification",
      "adaptive-difficulty",
      "world-lore",
      "onboarding"
    ],
    compatibleModules: compatibleExcluding([
      "knowledge-acquisition",
      "proficiency",
      "gamification",
      "adaptive-difficulty",
      "world-lore",
      "onboarding"
    ]),
    moduleConfigs: {
      "proficiency": {
        tierLabels: ["Greenhorn", "Survivor", "Woodsman", "Ranger", "Wilderness Master"],
        dimensions: ["foraging", "crafting", "navigation", "combat", "shelter"]
      },
      "knowledge-acquisition": {
        entryLabel: "Discovery",
        entryLabelPlural: "Discoveries",
        masteryLabels: ["Unknown", "Discovered", "Practiced", "Mastered"]
      },
      "adaptive-difficulty": {
        tierLabels: ["Peaceful", "Normal", "Hard", "Brutal", "Nightmare"]
      }
    }
  };
  var STRATEGY_BUNDLE = {
    id: "strategy",
    name: "Strategy",
    description: "Tactical decision-making, resource management, and empire building",
    defaultModules: [
      "proficiency",
      "gamification",
      "adaptive-difficulty",
      "world-lore",
      "onboarding"
    ],
    compatibleModules: compatibleExcluding([
      "proficiency",
      "gamification",
      "adaptive-difficulty",
      "world-lore",
      "onboarding"
    ]),
    moduleConfigs: {
      "proficiency": {
        tierLabels: ["Recruit", "Officer", "Commander", "General", "Overlord"],
        dimensions: ["economics", "military", "diplomacy", "technology", "espionage"]
      },
      "adaptive-difficulty": {
        tierLabels: ["Settler", "Chieftain", "Prince", "Emperor", "Deity"]
      }
    }
  };
  var PUZZLE_BUNDLE = {
    id: "puzzle",
    name: "Puzzle",
    description: "Logic challenges and problem-solving",
    defaultModules: [
      "pattern-recognition",
      "gamification",
      "adaptive-difficulty",
      "onboarding"
    ],
    compatibleModules: compatibleExcluding([
      "pattern-recognition",
      "gamification",
      "adaptive-difficulty",
      "onboarding"
    ]),
    moduleConfigs: {
      "adaptive-difficulty": {
        tierLabels: ["Casual", "Thinker", "Puzzler", "Genius", "Mastermind"]
      }
    }
  };
  var PLATFORMER_BUNDLE = {
    id: "platformer",
    name: "Platformer",
    description: "Running, jumping and reaching places, level by level",
    // A platformer is scored on runs and paced by its levels, so its feature
    // modules are the scoring and pacing ones and nothing that needs a
    // conversation or a lesson: `performance-scoring` (a run is scored), and
    // `gamification`, `adaptive-difficulty` and `onboarding` as every game bundle
    // carries them. No `proficiency` or `skill-tree`, so the pause menu shows no
    // Character or Skills tab (`ui/pause-menu-model.ts`); the registry's
    // `features.skills` stays as the registry has it, because module activation
    // reads the bundle, not that flag.
    defaultModules: [
      "performance-scoring",
      "gamification",
      "adaptive-difficulty",
      "onboarding"
    ],
    compatibleModules: compatibleExcluding([
      "performance-scoring",
      "gamification",
      "adaptive-difficulty",
      "onboarding"
    ]),
    moduleConfigs: {
      "adaptive-difficulty": {
        tierLabels: ["Stroll", "Hop", "Leap", "Sprint", "Daredevil"]
      }
    }
  };
  var ADVENTURE_BUNDLE = {
    id: "adventure",
    name: "Adventure",
    description: "Exploration, narrative, and puzzle-solving",
    defaultModules: [
      "knowledge-acquisition",
      "gamification",
      "world-lore",
      "conversation-analytics",
      "onboarding"
    ],
    compatibleModules: compatibleExcluding([
      "knowledge-acquisition",
      "gamification",
      "world-lore",
      "conversation-analytics",
      "onboarding"
    ]),
    moduleConfigs: {
      "knowledge-acquisition": {
        entryLabel: "Clue",
        entryLabelPlural: "Clues",
        masteryLabels: ["Unknown", "Found", "Examined", "Understood"]
      }
    }
  };
  var SIMULATION_BUNDLE = {
    id: "simulation",
    name: "Simulation",
    description: "Realistic systems and life simulation",
    defaultModules: [
      "proficiency",
      "gamification",
      "world-lore",
      "conversation-analytics",
      "onboarding"
    ],
    compatibleModules: compatibleExcluding([
      "proficiency",
      "gamification",
      "world-lore",
      "conversation-analytics",
      "onboarding"
    ]),
    moduleConfigs: {}
  };
  var EDUCATIONAL_BUNDLE = {
    id: "educational",
    name: "Educational",
    description: "Learning experiences through gameplay",
    defaultModules: [
      "knowledge-acquisition",
      "proficiency",
      "pattern-recognition",
      "assessment",
      "gamification",
      "skill-tree",
      "adaptive-difficulty",
      "onboarding"
    ],
    compatibleModules: compatibleExcluding([
      "knowledge-acquisition",
      "proficiency",
      "pattern-recognition",
      "assessment",
      "gamification",
      "skill-tree",
      "adaptive-difficulty",
      "onboarding"
    ]),
    moduleConfigs: {
      "proficiency": {
        tierLabels: ["Novice", "Beginner", "Intermediate", "Advanced", "Expert"]
      },
      "knowledge-acquisition": {
        entryLabel: "Concept",
        entryLabelPlural: "Concepts",
        masteryLabels: ["New", "Learning", "Familiar", "Mastered"]
      }
    }
  };
  var GENRE_BUNDLES = {
    "language-learning": LANGUAGE_LEARNING_BUNDLE,
    "rpg": RPG_BUNDLE,
    "survival": SURVIVAL_BUNDLE,
    "strategy": STRATEGY_BUNDLE,
    "puzzle": PUZZLE_BUNDLE,
    "platformer": PLATFORMER_BUNDLE,
    "adventure": ADVENTURE_BUNDLE,
    "simulation": SIMULATION_BUNDLE,
    "educational": EDUCATIONAL_BUNDLE
  };
  function getGenreBundle(genreId) {
    return GENRE_BUNDLES[genreId];
  }

  // @insimul/core/src/ai/action-predicates.ts
  var AI_ACTION_SELECTION_PROLOG = `
% \u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550
% Game-AI substrate \u2014 candidate actions and the legality gate
% packages/core/docs/game-ai-substrate.md \xA74
% \u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550

% \u2500\u2500 The action block (AUTHORED \u2014 prolog/action-converter.ts) \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
% action(ActionId, Name, Type, EnergyCost) \u2014 the action itself.
% action_requires_target(ActionId) \u2014 it must be aimed at something.
% action_target_type(ActionId, Kind) \u2014 at something of this kind.
% action_prerequisite(ActionId, Goal) \u2014 the feasibility goals the converter
%   folds into can_perform/2 (targetless) or can_perform/3 (targeted). This pack
%   never re-evaluates a stored Goal term: its variables are fresh on retrieval
%   and there is no portable way to bind Actor/Target by name, which is exactly
%   why the converter generates a RULE whose head does the binding.
% action_appeal(ActionId, Motive, 0..100) \u2014 how strongly the action serves a
%   motive. Authored: "brawling serves anger, not hunger" is world design.
% forbids(RuleId, Agent, ActionId, Target) \u2014 the legality gate's ONLY input.
%   Content defines facts or rules for it; US-3's IRuleEnforcer composes social
%   mores, faction law and taboo into it. A creator changes what an NPC may do
%   by changing content, never by changing core.
:- dynamic(action/4).
:- dynamic(action_requires_target/1).
:- dynamic(action_target_type/2).
:- dynamic(action_prerequisite/2).
:- dynamic(can_perform/2).
:- dynamic(can_perform/3).
:- dynamic(action_appeal/3).
:- dynamic(forbids/4).

% \u2500\u2500 Runtime facts (per playthrough) \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
% target_kind(Target, Kind) \u2014 what exists to aim at right now, and what it is.
%   Runtime, not authored: a spawned NPC and a dropped sword are a playthrough's,
%   not a template's.
% agent_motive(Agent, Motive, 0..100) \u2014 how strongly the agent wants that thing
%   at this tick. Drives move; that is the point of them.
% target_appeal(Agent, Target, -100..100) \u2014 how much more, or less, this agent
%   wants THAT target: a grudge, a debt, a bond, a mark it has been watching.
%   Without it every target of an action scores alike and the layer cannot tell
%   "hit the guard" from "hit the priest", which is most of what a decision is.
% action_bias(Agent, ActionId, -100..100) \u2014 a nudge from outside the KB: the
%   blackboard's commitment to last tick's plan, or a local SLM's proposal. An
%   ADVISOR's slot \u2014 it moves a score and can never make a forbidden action
%   permissible, because it is not read by the gate below at all.
:- dynamic(target_kind/2).
:- dynamic(agent_motive/3).
:- dynamic(target_appeal/3).
:- dynamic(action_bias/3).

% \u2500\u2500 Candidate enumeration \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500

% What this agent could do: every action, aimed at every target it admits, that
% the agent is capable of right now. The roster is the CALLER's \u2014 core hands the
% agent in \u2014 so A is required to be bound; enumerating agents from the KB here
% would make the answer depend on what the KB happens to hold.
candidate_action(A, Act, T) :-
  nonvar(A),
  action(Act, _, _, _),
  action_target_choice(Act, T),
  feasible(A, Act, T).

% A targetless action's target is the atom \`none\`, not an unbound variable: a
% caller enumerating solutions must never receive a free variable, and \`none\`
% is a value four engines spell the same way.
action_target_choice(Act, T) :-
  action_requires_target(Act),
  action_target_type(Act, Kind),
  target_kind(T, Kind).
action_target_choice(Act, none) :-
  \\+ action_requires_target(Act).

% CAPABILITY, which is not permission. An action that declares no prerequisite
% is unconstrained; one that does is exactly as feasible as the action block's
% own can_perform rule says.
feasible(_, Act, _) :-
  \\+ action_prerequisite(Act, _).
feasible(A, Act, T) :-
  action_prerequisite(Act, _),
  prerequisites_hold(A, Act, T).

% The three clauses are mutually exclusive, so a candidate is never enumerated
% twice: targetless goes to can_perform/2, targeted to can_perform/3, and a
% targeted action whose content only wrote the targetless rule falls back to it.
prerequisites_hold(A, Act, none) :-
  can_perform(A, Act).
prerequisites_hold(A, Act, T) :-
  T \\== none,
  can_perform(A, Act, T).
prerequisites_hold(A, Act, T) :-
  T \\== none,
  \\+ can_perform(A, Act, T),
  can_perform(A, Act).

% \u2500\u2500 The legality gate \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500

% May the agent do it? A forbidden action is not a penalised one \u2014 it is not a
% choice. The utility layer scores it and then cannot pick it.
permissible(A, Act, T) :-
  candidate_action(A, Act, T),
  \\+ forbidden(A, Act, T).

forbidden(A, Act, T) :-
  forbids(_, A, Act, T).

% Which rule forbade it \u2014 the reason the decision carries, so a refusal is
% legible ("faction law", "hearth taboo") rather than a silent absence.
forbidden_by(A, Act, T, Rule) :-
  forbids(Rule, A, Act, T).

% \u2500\u2500 Scoring inputs, projected as scalars \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
% A query binding collapses a compound term to its functor (see
% prolog/wasm-engine.ts), so every value the selection layer reads is projected
% through a rule that yields an atom or a number. Never bind to action/4 itself.

action_cost(Act, Cost) :-
  action(Act, _, _, Cost).

% One row of the utility sum: this agent's drive for a motive, and how far this
% action serves it. Joined here rather than in TypeScript so the join is the
% KB's answer, and so a native engine reads one predicate instead of two.
motive_appeal(A, Act, Motive, Drive, Appeal) :-
  agent_motive(A, Motive, Drive),
  action_appeal(Act, Motive, Appeal).
`;
  var AI_ACTION_RUNTIME_PREDICATES = [
    "target_kind/2",
    "agent_motive/3",
    "target_appeal/3",
    "action_bias/3"
  ];

  // @insimul/core/src/ai/enforcement-predicates.ts
  var AI_ENFORCEMENT_PROLOG = `
% \u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550
% Game-AI substrate \u2014 rule enforcement (COMPOSITION pack)
% packages/core/docs/game-ai-substrate.md \xA76
% Requires, in this order: identity/identity-predicates.ts (id_local/2),
%   ai/perception-predicates.ts (witness/2), ai/action-predicates.ts (the
%   :- dynamic(forbids/4) declaration this pack writes clauses for).
% \u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550

% \u2500\u2500 The rule block (AUTHORED \u2014 prolog/rule-converter.ts) \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
% rule_active(RuleId) \u2014 the rule is in force. A disabled more is not a deleted
%   one: content keeps it and stops declaring it active.
% rule_category(RuleId, Category) \u2014 social, faction, legal, taboo, \u2026 The atom
%   is the WORLD's; core enumerates no list of moral categories, for the same
%   reason it enumerates no list of damage types.
% rule_applies(RuleId, Actor, Target) \u2014 the rule block's own conditions, as the
%   converter generates them. An unconditional more is authored as the fact
%   rule_applies(RuleId, _, _), which is how "murder is always wrong" is spelled.
:- dynamic(rule_active/1).
:- dynamic(rule_category/2).
:- dynamic(rule_applies/3).

% \u2500\u2500 The norm vocabulary this pack adds (AUTHORED) \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
% rule_forbids_action(RuleId, ActionId) \u2014 the link the rule block has no place
%   for: which action of the action block this rule prohibits. This is the ONE
%   predicate that turns an editor rule into a legality gate, and it is content.
% faction_law(RuleId, FactionId) \u2014 the rule is that faction's law and binds its
%   members only. Absent = a norm binding on everyone (a social more, a taboo).
% faction_law_protects(RuleId, hostile|neutral|allied) \u2014 a law that protects a
%   CLASS of target rather than naming conditions: "do not raise a hand against
%   an ally" is a stance, not a when-clause, and authoring it as one would mean
%   re-authoring the law every time the diplomatic map moves.
% norm_truth(RuleId, Predicate, Object) \u2014 what a WITNESSED violation makes true
%   of its actor. The consequence is a claim the rest of the simulation reads
%   like any other truth, which is what "legible to the simulation" means.
% norm_reputation(RuleId, FactionId, Delta) \u2014 the reputation with FactionId that
%   a witnessed violation costs. A negative Delta is the usual authoring; a
%   positive one is a world where the thieves' guild approves.
:- dynamic(rule_forbids_action/2).
:- dynamic(faction_law/2).
:- dynamic(faction_law_protects/2).
:- dynamic(norm_truth/3).
:- dynamic(norm_reputation/3).

% \u2500\u2500 The combat block's faction facts (AUTHORED, adopted not re-minted) \u2500\u2500\u2500\u2500
% faction(EntityId, FactionId) and faction_stance(A, B, hostile|neutral|allied)
% are docs/mechanic-predicates.md \xA74's, unchanged. Declared here so this pack
% loads standalone-ish; never redefined.
:- dynamic(faction/2).
:- dynamic(faction_stance/3).

% \u2500\u2500 Runtime facts (per playthrough) \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
% act(EventId, Actor, ActionId, Target) \u2014 an act that HAPPENED this tick. The
%   EventId is the PERCEPT id of the same event (ai/perception.ts), not a second
%   identifier: witnessing is then perception's answer rather than a parallel
%   ledger, and an act nobody published as a percept is an act nobody could have
%   seen. Target is the atom \`none\` for a targetless action, matching
%   action_target_choice/2 in the decision pack.
% violation_record(EventId, RuleId, Actor, Witness) \u2014 the durable memory of a
%   witnessed violation, written by enforceActs/2. A percept lasts a tick; the
%   fact that the guard saw Renaud take the ledger has to outlive it, or a
%   consequence could only ever be immediate.
:- dynamic(act/4).
:- dynamic(violation_record/4).

% \u2500\u2500 Norms: the rule block, read as prohibitions \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500

% A NORM is an active rule that prohibits an action. Its KIND is the rule's own
% category, so "which body of rule refused this" is answerable without core
% holding an opinion about what bodies of rule exist.
norm(Rule, Kind) :-
  rule_active(Rule),
  rule_forbids_action(Rule, _),
  norm_kind(Rule, Kind).

norm_kind(Rule, Kind) :- rule_category(Rule, Kind).
norm_kind(Rule, unclassified) :- rule_active(Rule), \\+ rule_category(Rule, _).

% A norm is binding on EVERYONE unless something scoped it. faction_law/2 is one
% scope; geo/region-predicates.ts adds a second (jurisdiction_law/2 \u2014 a law of
% the ground you stand on rather than of the house you belong to). So the
% exclusion is a predicate instead of a lengthening list of \\+ goals in the
% universal clause below, and it is declared :- dynamic so a pack consulted LATER
% can add a clause for it \u2014 the same extension seam this pack itself reaches
% forbids/4 through. A scope that forgot to register here would make its norm
% bind the whole world, which is why this is one predicate and not a convention.
:- dynamic(scoped_norm/1).
scoped_norm(Rule) :- faction_law(Rule, _).

% \u2500\u2500 The gate's input \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
% forbids/4 is the ONLY thing US-2's permissible/3 reads. Everything above this
% line exists to define these three clauses, and everything below reads them.

% A norm binding on everyone, whose own conditions hold for this actor and
% target. Most social mores and every taboo are this clause.
forbids(Rule, A, Act, T) :-
  norm(Rule, _),
  \\+ scoped_norm(Rule),
  rule_forbids_action(Rule, Act),
  rule_applies(Rule, A, T).

% Faction law, with its own conditions: binding on the faction's members, and
% only on them. An outsider is not bound by a law they are not under \u2014 that is
% the difference between a law and a more, and collapsing the two would make
% every faction's code universal.
forbids(Rule, A, Act, T) :-
  norm(Rule, _),
  faction_law(Rule, F),
  faction(A, F),
  rule_forbids_action(Rule, Act),
  rule_applies(Rule, A, T).

% Faction law by stance: forbidden because of who the TARGET is to the actor's
% faction. Reads the diplomatic map at query time, so an alliance signed this
% session changes what is permitted without re-authoring the law.
forbids(Rule, A, Act, T) :-
  norm(Rule, _),
  faction_law(Rule, F),
  faction(A, F),
  rule_forbids_action(Rule, Act),
  faction_law_protects(Rule, Stance),
  faction(T, G),
  faction_stance(F, G, Stance).

% \u2500\u2500 Violations: a norm broken by an act that actually happened \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500

% The gate refuses an action BEFORE it is taken; a violation is what a broken
% norm looks like AFTER one was. Both read the same forbids/4, so an NPC that
% was gated and a player who was not are judged by one body of rule.
violation(E, Rule, Actor, Act, T) :-
  act(E, Actor, Act, T),
  forbids(Rule, Actor, Act, T).

% The same question with every column projected to an atom \u2014 the form a caller
% binds, since a query binding collapses a compound to its functor. The actor is
% the only column that can be one; Act and T are already atoms of the action
% block.
violation_of(E, Rule, Actor, Act, T) :-
  violation(E, Rule, Subject, Act, T),
  agent_atom(Subject, Actor).

% \u2500\u2500 Witnessing: the gate on social consequence \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500

% Who saw a violation. witness/2 already excludes the actor from witnessing
% their own act, so a crime is never self-reported.
witnessed_violation(E, Rule, W) :-
  violation(E, Rule, _, _, _),
  witness(Agent, E),
  agent_atom(Agent, W).

% Nobody saw it. A violation with no witness has NO social consequence, which is
% what makes stealth worth anything \u2014 and note it is still a VIOLATION, so a
% world that wants a private guilt or a divine observer has a predicate to hang
% it on rather than needing core to relax the gate.
secret_violation(E, Rule) :-
  violation(E, Rule, _, _, _),
  \\+ witness(_, E).

% \u2500\u2500 Consequences: structured, never a boolean \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500

% What a witnessed violation makes TRUE of its actor. The enforcement layer's
% output is a fact the rest of the simulation reads like any other, not a
% refusal: a reaction can be authored against claim/4 with no knowledge that an
% enforcer produced it.
enforced_truth(E, Rule, Actor, P, O) :-
  violation(E, Rule, Subject, _, _),
  witness(_, E),
  norm_truth(Rule, P, O),
  agent_atom(Subject, Actor).

% What it costs. reputation_change/3 (prolog/helper-predicates.ts) is the
% existing standing mechanism and reputation/3 already sums it; enforcement
% contributes a row rather than minting a second scale.
enforced_reputation(E, Rule, Actor, Faction, Delta) :-
  violation(E, Rule, Subject, _, _),
  witness(_, E),
  norm_reputation(Rule, Faction, Delta),
  agent_atom(Subject, Actor).

% \u2500\u2500 Scalar projection \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
% A query binding collapses a compound term to its functor (prolog/wasm-engine.ts),
% so every column this pack yields to a caller must be an atom. Content spells an
% agent either way \u2014 a legacy id atom, or the KINP id/3 term ai/perception.ts
% emits \u2014 and both are projected here, in the pack, so a native engine reads one
% rule instead of re-deriving the mapping.
%
% An id/3 term projects to its CURIE, because the CURIE is what the rest of the
% substrate keys an agent by: agentRefKey() in ai/action-selection.ts, the
% blackboard's slot key, and a perception's agent column are all the same string.
% curie/2 is a ground fact identity-facts.ts emits per identifier, so this is a
% lookup and not string surgery. A KB carrying no identity bridge falls back to
% the local id \u2014 a degraded answer rather than no answer, since a witness core
% cannot name is a witness the world cannot react to.
agent_atom(A, A) :- atom(A).
agent_atom(Id, Curie) :- nonvar(Id), \\+ atom(Id), curie(Id, Curie).
agent_atom(Id, Local) :- nonvar(Id), \\+ atom(Id), \\+ curie(Id, _), id_local(Id, Local).
`;
  var AI_ENFORCEMENT_RUNTIME_PREDICATES = [
    "act/4",
    "violation_record/4"
  ];

  // @insimul/core/src/ai/perception-predicates.ts
  var AI_PERCEPTION_PREDICATES_PROLOG = `
% \u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550
% Game-AI substrate \u2014 perception provenance
% packages/core/docs/game-ai-substrate.md \xA72
% \u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550

% \u2500\u2500 Runtime facts (per playthrough) \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
% agent_belief_world(Agent, World) \u2014 the world an agent's beliefs are claimed
%   at. Emitted by beliefWorldFacts/2; one per agent that can believe anything.
% percept(PerceptId, Subject, Predicate, Object) \u2014 an observable published this
%   tick: the SPO triple an observer would learn from perceiving it.
% percept_channel(PerceptId, sight|hearing|smell|touch) \u2014 the sense it presents
%   on. percept_actor(PerceptId, Actor) \u2014 who is responsible, when the percept
%   is an act; that is the hook a witnessing rule hangs on.
% perceived(Agent, PerceptId, Channel, clear|partial) \u2014 core's decision that
%   this agent perceived it, and how well. Written by perceive/1, never by hand.
:- dynamic(agent_belief_world/2).
:- dynamic(percept/4).
:- dynamic(percept_channel/2).
:- dynamic(percept_actor/2).
:- dynamic(perceived/4).

% \u2500\u2500 Rules \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500

% "Did this agent perceive it at all?" \u2014 the question most rules ask, written
% over perceived/4 so a new fidelity band tightens nothing.
perceived(A, E) :- perceived(A, E, _, _).

perceived_clearly(A, E) :- perceived(A, E, _, clear).

% Through which sense. Distinct from the fidelity so "the guard HEARD something"
% and "the guard saw it clearly" are different answers.
perceived_via(A, E, Channel) :- perceived(A, E, Channel, _).

% A witness is someone OTHER than the actor who perceived the act. The actor
% perceiving their own act is not a witness to it \u2014 otherwise every crime is
% self-reported and nothing is ever secret.
witness(A, E) :-
  perceived(A, E, _, _),
  percept_actor(E, Actor),
  A \\== Actor.

% Nobody saw it. This is the predicate that makes stealth mean something: an
% enforcement rule that conjoins a violation with witness/2 has no consequence
% to produce when this holds.
unwitnessed(E) :- percept_actor(E, _), \\+ witness(_, E).

% The triple an agent would have learned, restricted to what it actually
% perceived. The BELIEF it produces is claimed at the agent's belief world \u2014
% see the bridge pack \u2014 this is only the perceived content.
perceived_content(A, S, P, O) :-
  perceived(A, E, _, _),
  percept(E, S, P, O).
`;
  var AI_PERCEPTION_RUNTIME_PREDICATES = [
    "agent_belief_world/2",
    "percept/4",
    "percept_channel/2",
    "percept_actor/2",
    "perceived/4"
  ];
  var AI_BELIEF_BRIDGE_PROLOG = `
% \u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550
% Game-AI substrate \u2014 belief as a world (composition pack)
% packages/core/docs/game-ai-substrate.md \xA71
% Requires: identity/world-predicates.ts (holds/4) + ai/perception-predicates.ts
% \u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550

% What the agent holds true, reasoning in its own world. A belief world is a
% ROOT world, so this returns what the agent has been told or has perceived \u2014
% never the world's truths by default.
believes(A, S, P, O) :-
  agent_belief_world(A, W),
  holds(S, P, O, '@world'(W)).

% The agent has no belief about (S, P) at all. Ignorance, as distinct from
% believing something false. A must be bound.
unaware_of(A, S, P) :-
  agent_belief_world(A, _),
  \\+ believes(A, S, P, _).

% The agent believes something the world does not: the predicate stealth,
% deception and every "he thinks the ledger is still in the drawer" plot depend
% on. Truth is read at the world the caller names, so "mistaken about canon" and
% "mistaken about this playthrough" are different questions.
mistaken(A, TruthWorld, S, P, Believed, Actual) :-
  believes(A, S, P, Believed),
  holds(S, P, Actual, '@world'(TruthWorld)),
  Believed \\== Actual.

% True in the world, and this agent does not know it.
ignorant_of(A, TruthWorld, S, P, O) :-
  holds(S, P, O, '@world'(TruthWorld)),
  agent_belief_world(A, _),
  \\+ believes(A, S, P, O).
`;

  // @insimul/core/src/ai/planning-predicates.ts
  var AI_PLANNING_PROLOG = `
% \u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550
% Game-AI substrate \u2014 goals, plan steps and the planning frontier
% packages/core/docs/game-ai-substrate.md \xA77
%
% COMPOSITION PACK. Consult AFTER ai/action-predicates.ts: this pack reads
% permissible/3, forbidden/3 and action_target_choice/2, which that pack owns.
% \u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550

% \u2500\u2500 Goals (AUTHORED \u2014 world content) \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
% goal(GoalId, Name) \u2014 a goal this world knows about. Authored, because what an
%   NPC may want is world design: "keep the shop stocked", "get home by dark".
% goal_requires(GoalId, Condition) \u2014 the conditions that must hold for the goal
%   to be met. A goal with no requirement is met the moment it is adopted, which
%   is a legitimate way to author a goal that is only a label.
% action_achieves(ActionId, Condition) \u2014 what taking the action makes true. The
%   link from the action block to the condition vocabulary, and the reason a plan
%   can be built at all.
% action_needs(ActionId, Condition) \u2014 what must be true BEFORE the action can be
%   taken, in the same vocabulary. Deliberately NOT action_prerequisite/2: a
%   prerequisite is arbitrary world state a plan cannot bring about, while a
%   condition is exactly the thing another step can achieve.
:- dynamic(goal/2).
:- dynamic(goal_requires/2).
:- dynamic(action_achieves/2).
:- dynamic(action_needs/2).

% \u2500\u2500 Runtime facts (per playthrough) \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
% agent_goal(Agent, GoalId, Priority 0..100) \u2014 what this agent is pursuing now.
%   Runtime: an NPC adopts and drops goals as the world moves, and which goal it
%   holds at a tick belongs in the save file, never on a world template.
% condition_met(Agent, Condition) \u2014 what is already true for it. Agent-relative
%   because most conditions are ("has the key", "is at the forge"); a world with
%   a global condition authors the rule condition_met(_, door_open) :- ... over
%   its own state, which is the intended escape hatch and the reason nothing here
%   assumes this predicate is a plain fact.
:- dynamic(agent_goal/3).
:- dynamic(condition_met/2).

% \u2500\u2500 Goals \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500

% The goals this agent holds. The roster is the CALLER's, exactly as in the
% decision pack: an unbound agent enumerates nothing, so "who is planning" never
% depends on which facts happened to load.
pursuing(A, G, P) :-
  nonvar(A),
  agent_goal(A, G, P),
  goal(G, _).

% What the goal still wants \u2014 the planning frontier, one condition per solution.
goal_unmet(A, G, C) :-
  goal_requires(G, C),
  \\+ condition_met(A, C).

% A goal with nothing unmet. Checked against the goal block so a typo'd goal id
% is unsatisfied rather than vacuously satisfied.
goal_satisfied(A, G) :-
  goal(G, _),
  \\+ goal_unmet(A, G, _).

% \u2500\u2500 Steps \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500

% A step the agent can take THIS TICK: it achieves the condition, the decision
% layer's gate both enumerates it and permits it, and nothing the PLAN can see
% blocks it. The only kind of step a plan may start with, because a plan whose
% first step cannot be taken is a plan that never moves.
%
% step_ready/2 is not redundant with the gate. permissible/3 goes through
% can_perform/2,3 \u2014 the action block's own feasibility \u2014 which knows nothing
% about the condition vocabulary: an action with no action_prerequisite/2 is
% feasible by default and would otherwise be reported takeable while the plan
% still owed it a bucket.
plan_step(A, C, Act, T) :-
  action_achieves(Act, C),
  permissible(A, Act, T),
  step_ready(A, Act).

% A step the plan may REACH: it achieves the condition and is not forbidden, but
% its feasibility is left to the tick it actually runs on. Without this, chaining
% is impossible \u2014 "open the door" is not feasible until "take the key" has run,
% so a planner that only saw plan_step/4 could never plan past length one.
%
% The gate is applied here too, and that is the point: a forbidden action is not
% a candidate at any depth of any plan.
projected_step(A, C, Act, T) :-
  action_achieves(Act, C),
  action_target_choice(Act, T),
  \\+ forbidden(A, Act, T).

% What a step still needs before it can be taken. The planner's chaining edge:
% every solution here is a sub-goal an earlier step has to achieve.
step_blocked(A, Act, C) :-
  action_needs(Act, C),
  \\+ condition_met(A, C).

% A step nothing blocks. Act is required to be bound: an unbound action would ask
% "is there an action nothing blocks", which is a different question and one whose
% answer depends on what the KB happens to hold.
step_ready(A, Act) :-
  nonvar(Act),
  \\+ step_blocked(A, Act, _).

% One row of the frontier, joined: an unmet condition of the goal and a step that
% would achieve it. The planner reads this to seed its search and then bounds the
% search itself \u2014 see ./planner, and \xA77 for why the SEARCH is TypeScript's while
% the truth and the permission stay the KB's.
goal_step(A, G, Act, T, C) :-
  goal_unmet(A, G, C),
  plan_step(A, C, Act, T).
`;
  var AI_PLANNING_RUNTIME_PREDICATES = [
    "agent_goal/3",
    "condition_met/2"
  ];

  // @insimul/core/src/ai/substrate-pack.ts
  var AI_SUBSTRATE_AREA = "agentAi";
  var AI_SUBSTRATE_PACK_TEXTS = [
    AI_PERCEPTION_PREDICATES_PROLOG,
    AI_BELIEF_BRIDGE_PROLOG,
    AI_ACTION_SELECTION_PROLOG,
    AI_ENFORCEMENT_PROLOG,
    AI_PLANNING_PROLOG
  ];
  var AI_SUBSTRATE_PROLOG = AI_SUBSTRATE_PACK_TEXTS.join("\n");
  var AI_SUBSTRATE_RUNTIME_PREDICATES = Array.from(
    /* @__PURE__ */ new Set([
      ...AI_PERCEPTION_RUNTIME_PREDICATES,
      ...AI_ACTION_RUNTIME_PREDICATES,
      ...AI_ENFORCEMENT_RUNTIME_PREDICATES,
      ...AI_PLANNING_RUNTIME_PREDICATES
    ])
  );
  var AI_SUBSTRATE_PACK = Object.freeze({
    area: AI_SUBSTRATE_AREA,
    prolog: AI_SUBSTRATE_PROLOG,
    runtimePredicates: AI_SUBSTRATE_RUNTIME_PREDICATES
  });
  var AI_PREDICATE_PACKS = Object.freeze([
    AI_SUBSTRATE_PACK
  ]);

  // @insimul/core/src/business/business-predicates.ts
  var BUSINESS_PREDICATES_PROLOG = `
% \u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550
% Business lifecycle \u2014 what a trade costs to open, what a day of it costs to
% run, what it brings in, and the day the doors do not open again
% packages/core/docs/business-lifecycle.md \xA73
%
% COMPOSITION PACK. Consult AFTER prolog/mechanics/equipment-predicates.ts:
% this pack reads business_owner/2 and vendor/2 and defines clauses for
% neither. It declares them dynamic so it loads alone, exactly as the volition
% pack declares the substrate's facts.
% \u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550

% \u2500\u2500 Authored facts (world content \u2014 never in a save) \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
% trade_kind(Type) \u2014 a kind of business this world knows how to open. The atom
%   business_type/2 already names; declaring it is what turns a generated
%   business into one with a price on its door.
% trade_capital(Type, Coin) \u2014 what founding one takes out of the founder's
%   purse, and what the till therefore opens holding.
% trade_upkeep(Type, Coin) \u2014 what a day of being open costs before a single
%   wage: rent, fuel, spoilage. A trade that authored none costs nothing to
%   keep, which is the correct answer for a stall.
% trade_post(Type, Role) \u2014 a post this kind of business hires for. More than
%   one holder of a role is allowed: two bakers is two employed_at/3 facts,
%   never a seat count, because a seat count is a number no rule could read
%   off the world.
% post_wage(Role, Coin) \u2014 the day's wage of a post.
% post_yield(Role, Coin) \u2014 what a day of that post brings the till. It is the
%   POST that earns, not the business, which is what makes an empty shop earn
%   nothing without a rule saying so.
% ruin_grace(Days) \u2014 how many consecutive days a business may fail to cover
%   its own day before the doors stay shut. The world's patience, authored:
%   a guild town carries its own and a frontier one does not.
:- dynamic(trade_kind/1).
:- dynamic(trade_capital/2).
:- dynamic(trade_upkeep/2).
:- dynamic(trade_post/2).
:- dynamic(post_wage/2).
:- dynamic(post_yield/2).
:- dynamic(ruin_grace/1).

% \u2500\u2500 Runtime facts (per playthrough) \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
% business_capital(B, Coin) \u2014 what is in the till. THE ledger, and the fact the
%   whole module turns on: v1 had no such number, so a business could not be
%   robbed, subsidised, inherited or run into the ground.
% business_arrears(B, Days) \u2014 consecutive days it could not cover its own
%   outgoings. Reset by any day it could, so a bad week is survivable and a bad
%   season is not.
:- dynamic(business_capital/2).
:- dynamic(business_arrears/2).

% \u2500\u2500 Adopted (declared so the pack loads alone; owned elsewhere) \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
% The business block of prolog/predicate-schema.ts owns the first seven,
% prolog/tott-predicates.ts owns employed_at/3, the gameplay-state block owns
% gold/2, gameplay-predicates.ts owns day_number/1, and the trade half of
% prolog/mechanics/equipment-predicates.ts owns vendor/2.
:- dynamic(business/1).
:- dynamic(business_type/2).
:- dynamic(business_owner/2).
:- dynamic(business_of_settlement/2).
:- dynamic(business_founded/2).
:- dynamic(business_closed/2).
:- dynamic(business_out_of_business/1).
:- dynamic(employed_at/3).
:- dynamic(gold/2).
:- dynamic(day_number/1).
:- dynamic(vendor/2).

% \u2500\u2500 Adding up \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500

% The pack's own sum, for equipment_sum/2's reason: the shared engine has no
% aggregate_all/3 (it lives in library(aggregate), and a pack may not depend on
% a library) and sum_list/2 is a static builtin it will not let a program
% define. See docs/tau-wasm-parity.md D-1.
business_sum([], 0).
business_sum([X | T], S) :-
  business_sum(T, S0),
  S is S0 + X.

% \u2500\u2500 Open, or not \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500

% A business that has not shut. business_out_of_business/1 is the generator's
% own flag, so a world that arrives already carrying failed shops is read the
% same way as one that fails them during play.
business_trading(B) :-
  business(B),
  \\+ business_out_of_business(B).

% \u2500\u2500 Employment \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500

business_staff(B, Who, Role) :-
  employed_at(Who, B, Role).

business_employs(B, Who) :-
  employed_at(Who, B, _).

% A post the trade authorises and nobody holds. What "hiring" means, said as a
% fact about the world rather than as an event somebody has to catch.
business_post_open(B, Role) :-
  business_trading(B),
  business_type(B, T),
  trade_post(T, Role),
  \\+ employed_at(_, B, Role).

% \u2500\u2500 The day's books \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500

% What the doors cost to keep open, before a wage. A trade the world priced
% nothing for costs nothing, and that is an answer rather than a failure \u2014
% the same stance stock_level/3 takes about a bare shelf.
business_upkeep(B, Cost) :-
  nonvar(B),
  business_type(B, T),
  trade_upkeep(T, Cost),
  !.
business_upkeep(B, 0) :-
  nonvar(B),
  business(B).

% Every wage this business owes for one day.
business_wage_bill(B, Total) :-
  business(B),
  findall(W, (employed_at(_, B, Role), post_wage(Role, W)), Ws),
  business_sum(Ws, Total).

% What a day of work brings the till. It is the sum over the POSTS that are
% filled, so a shop whose staff have all left earns nothing without a rule
% anywhere saying that an empty shop earns nothing.
business_yield(B, Total) :-
  business(B),
  findall(Y, (employed_at(_, B, Role), post_yield(Role, Y)), Ys),
  business_sum(Ys, Total).

% Upkeep plus wages: the number the till has to cover to open tomorrow.
business_outgoings(B, Total) :-
  business_upkeep(B, Upkeep),
  business_wage_bill(B, Wages),
  Total is Upkeep + Wages.

% What the day made. Negative is an ordinary answer and the interesting one.
business_profit(B, Profit) :-
  business_yield(B, In),
  business_outgoings(B, Out),
  Profit is In - Out.

% Can it pay for the day it is about to have? Solvency is about the TILL
% against the outgoings, not about the profit: a shop can be losing money for a
% month and still be solvent, which is exactly how a business dies slowly.
business_solvent(B) :-
  business_capital(B, C),
  business_outgoings(B, Out),
  C >= Out.

% What the owner draws when the day made something. A day that lost money pays
% its proprietor nothing rather than paying them a negative wage.
business_draw(B, Owner, Profit) :-
  business_owner(B, Owner),
  business_profit(B, Profit),
  Profit > 0.

% \u2500\u2500 Founding \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500

% May this person open one of those? The founder must be BOUND, exactly as
% candidate_action/3 and volition_proposal/4 require: an unbound founder would
% enumerate whoever the KB happened to hold.
%
% It asks about money and about nothing else. Whether founding is ALLOWED \u2014 a
% guild that admits no outsiders, a jurisdiction that licenses trades \u2014 is one
% more clause of forbids/4, so permissible/3 refuses an unlicensed opening with
% no line added here (docs/business-lifecycle.md \xA72).
can_found_business(Founder, Type) :-
  nonvar(Founder),
  trade_kind(Type),
  trade_capital(Type, Cap),
  gold(Founder, G),
  G >= Cap.

% \u2500\u2500 Hiring \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500

% A post it authorises and a till that covers a day of it. A business that
% cannot pay tomorrow's wage does not take somebody on today.
can_hire(B, Role) :-
  business_trading(B),
  business_type(B, T),
  trade_post(T, Role),
  post_wage(Role, W),
  business_capital(B, C),
  C >= W.

% \u2500\u2500 Failing \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500

% Trading, and unable to cover the day it is having. One bad day, not a verdict.
business_failing(B) :-
  business_trading(B),
  \\+ business_solvent(B).

% The verdict: as many consecutive days in arrears as the world allows. A world
% that authored no ruin_grace/1 never ruins anybody, which is the correct answer
% for a world whose shops are scenery.
business_ruined(B) :-
  business_trading(B),
  ruin_grace(G),
  business_arrears(B, D),
  D >= G.

% \u2500\u2500 The join to trade \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500

% The shop a business sells through \u2014 vendor/2 read in the direction a business
% asks it. This is the ONE clause connecting this pack to the economy, and it is
% a lookup rather than a rule, because what is on the shelf, what it costs and
% whether the sale happens are all answered already
% (prolog/mechanics/equipment-predicates.ts, src/items/economy.ts).
business_shop(B, V) :-
  vendor(V, B).
`;
  var BUSINESS_AREA = "business";
  var BUSINESS_AUTHORED_PREDICATES = Object.freeze([
    "trade_kind/1",
    "trade_capital/2",
    "trade_upkeep/2",
    "trade_post/2",
    "post_wage/2",
    "post_yield/2",
    "ruin_grace/1"
  ]);
  var BUSINESS_RUNTIME_PREDICATES = Object.freeze([
    "business_capital/2",
    "business_arrears/2"
  ]);
  var BUSINESS_PACK = Object.freeze({
    area: BUSINESS_AREA,
    prolog: BUSINESS_PREDICATES_PROLOG,
    runtimePredicates: BUSINESS_RUNTIME_PREDICATES
  });
  var BUSINESS_PREDICATE_PACKS = Object.freeze([
    BUSINESS_PACK
  ]);

  // @insimul/core/src/narrative/dialogue-predicates.ts
  var DIALOGUE_PREDICATES_PROLOG = `
% \u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550
% Dialogue goals \u2014 what was asked of a conversation, what counts as having
% done it, and which quest step it discharges
% packages/core/docs/dialogue-goals.md \xA73
%
% COMPOSITION PACK. Consult AFTER prolog/helper-predicates.ts: this pack reads
% quest_active/2, quest_objective/3 and conversational_action/4 and defines
% clauses for none of them \u2014 it declares them dynamic so it loads alone,
% exactly as the volition pack declares the substrate's facts. It adds NO
% clause to objective_complete/3: the helper library already reads
% conversational_action/4, and a second completion rule here would be a second
% answer to a settled question.
% \u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550

% \u2500\u2500 Authored facts (world content \u2014 never in a save) \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
% dialogue_goal(GoalId) \u2014 a thing this world asks of a conversation. The atom
%   everything below is keyed by.
% dialogue_goal_quest(GoalId, QuestId, ObjIndex) \u2014 the quest step it
%   discharges, spelled as quest_objective/3's own key. A goal that names no
%   quest step is authoring debris, never a quest of its own: dialogueIssues
%   reports it, because a goal nothing asks for is a goal nothing can finish.
% dialogue_goal_act(GoalId, Act) \u2014 the conversational_action/4 atom asserted
%   when it is met. ADOPTED from the quest-objective vocabulary
%   (introduce_self, ask_for_directions, order_food, haggle_price, \u2026), which
%   is what makes a met goal legible to objective_complete/3 with no clause
%   added anywhere.
% dialogue_goal_npc(GoalId, NpcId) \u2014 the NPC it must be said to. NO fact at
%   all means anybody will do, which is the right answer for "ask three
%   people the way" \u2014 an absence rather than a wildcard atom, for
%   desire_target_kind/2's reason.
% dialogue_cue(GoalId, CueId, Weight) \u2014 one piece of evidence this goal
%   accepts and what it is worth, as an integer. A cue is what a host
%   OBSERVED \u2014 a keyword matched, a model's extraction, a dialogue-tree
%   branch, a menu pick \u2014 never a verdict it reached.
% dialogue_goal_threshold(GoalId, Need) \u2014 the integer total of cue weights the
%   goal needs. Emitted for every goal by the layer that publishes the table,
%   carrying the RESOLVED number rather than the raw authored one, for the
%   reason post_wage/2 does: a rule that reads the bar and the layer that
%   clears it have to agree.
:- dynamic(dialogue_goal/1).
:- dynamic(dialogue_goal_quest/3).
:- dynamic(dialogue_goal_act/2).
:- dynamic(dialogue_goal_npc/2).
:- dynamic(dialogue_cue/3).
:- dynamic(dialogue_goal_threshold/2).

% \u2500\u2500 Runtime facts (per playthrough) \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
% dialogue_cue_shown(Actor, GoalId, CueId) \u2014 this actor has produced that
%   evidence for that goal. THE fact the module mints, and the only one: what
%   was said toward a goal is exactly what a world template cannot carry and
%   what v1 kept in a transcript array no rule could read.
:- dynamic(dialogue_cue_shown/3).

% \u2500\u2500 Adopted (declared so the pack loads alone; owned elsewhere) \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
% prolog/helper-predicates.ts owns quest_objective/3, conversational_action/4
% and talked_to/3; prolog/gameplay-predicates.ts owns quest_active/2.
:- dynamic(quest_active/2).
:- dynamic(quest_objective/3).
:- dynamic(conversational_action/4).
:- dynamic(talked_to/3).

% \u2500\u2500 Adding up \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500

% The pack's own sum, for business_sum/2's reason: the shared engine has no
% aggregate_all/3 (it lives in library(aggregate), and a pack may not depend on
% a library) and sum_list/2 is a static builtin it will not let a program
% define. See docs/tau-wasm-parity.md D-1.
dialogue_sum([], 0).
dialogue_sum([X | T], S) :-
  dialogue_sum(T, S0),
  S is S0 + X.

% \u2500\u2500 Who may be told \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500

% The NPCs a goal may be satisfied by talking to. A goal that authored a
% dialogue_goal_npc/2 is that NPC's; one that authored none is anybody's, and
% the second clause says so by leaving the argument unbound rather than by
% inventing an 'any' atom no world would author.
dialogue_goal_addressee(G, Npc) :-
  dialogue_goal_npc(G, Npc).
dialogue_goal_addressee(G, _) :-
  dialogue_goal(G),
  \\+ dialogue_goal_npc(G, _).

% \u2500\u2500 What has been said toward it \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500

% The weight of the evidence on the record, for one BOUND actor. Unbound would
% enumerate whoever the KB happened to hold, exactly as candidate_action/3 and
% can_found_business/2 refuse to.
%
% The join is over dialogue_cue/3, so a cue shown for a goal that does not
% accept it is worth nothing without a rule anywhere saying so \u2014 which is what
% makes a host's evidence safe to take at face value.
dialogue_goal_score(A, G, S) :-
  nonvar(A),
  dialogue_goal(G),
  findall(W, (dialogue_cue_shown(A, G, C), dialogue_cue(G, C, W)), Ws),
  dialogue_sum(Ws, S).

% Met: enough of it. Threshold and score are integers, so two engines reading
% the same transcript reach the same verdict rather than the same number to two
% decimal places.
dialogue_goal_met(A, G) :-
  dialogue_goal_threshold(G, Need),
  dialogue_goal_score(A, G, S),
  S >= Need.

% How much more is wanted. The "why not" a host shows, and an ordinary answer
% rather than a failure \u2014 a goal already met simply has no solution here.
dialogue_goal_short(A, G, Short) :-
  dialogue_goal_threshold(G, Need),
  dialogue_goal_score(A, G, S),
  S < Need,
  Short is Need - S.

% \u2500\u2500 The quest step \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500

% Already written down: the conversational_action/4 for this goal is on the
% record against its own quest. This is the only place the module asks whether
% something has HAPPENED, and it asks the quest vocabulary rather than a memory
% of its own.
dialogue_goal_discharged(A, G) :-
  dialogue_goal_act(G, Act),
  dialogue_goal_quest(G, Q, _),
  conversational_action(A, _, Act, Q).

% Live: the quest is running, the step it discharges exists, and it has not
% been discharged already. A goal whose quest was never started is not open,
% which is what stops one conversation from finishing a dozen quests at once \u2014
% v1 sliced its candidate list to five to control an LLM bill instead.
dialogue_goal_live(A, G) :-
  dialogue_goal_quest(G, Q, Idx),
  quest_active(A, Q),
  quest_objective(Q, Idx, _),
  \\+ dialogue_goal_discharged(A, G).

% \u2500\u2500 The gate \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500

% May what this actor says to that NPC count toward this goal? Actor bound,
% for dialogue_goal_score/3's reason.
%
% It asks about the world and about nothing else. Whether the actor may SPEAK
% to them at all \u2014 a curfew, an outlawry, a language they do not share \u2014 is one
% more clause of forbids/4, so permissible/3 refuses a forbidden conversation
% with no line added here (docs/dialogue-goals.md \xA72).
can_advance_dialogue(A, G, Npc) :-
  nonvar(A),
  dialogue_goal(G),
  dialogue_goal_addressee(G, Npc),
  dialogue_goal_live(A, G).

% Met, live, and not yet written down \u2014 the one thing the decision layer acts
% on, and a rule rather than a stored flag for business_profit/2's reason: a
% persisted dialogue_goal_pending(a, g) is a fact that contradicts the evidence
% beside it after a reload.
dialogue_goal_pending(A, G) :-
  dialogue_goal_met(A, G),
  dialogue_goal_live(A, G).
`;
  var DIALOGUE_AREA = "dialogue";
  var DIALOGUE_AUTHORED_PREDICATES = Object.freeze([
    "dialogue_goal/1",
    "dialogue_goal_quest/3",
    "dialogue_goal_act/2",
    "dialogue_goal_npc/2",
    "dialogue_cue/3",
    "dialogue_goal_threshold/2"
  ]);
  var DIALOGUE_RUNTIME_PREDICATES = Object.freeze([
    "dialogue_cue_shown/3"
  ]);
  var DIALOGUE_PACK = Object.freeze({
    area: DIALOGUE_AREA,
    prolog: DIALOGUE_PREDICATES_PROLOG,
    runtimePredicates: DIALOGUE_RUNTIME_PREDICATES
  });
  var DIALOGUE_PREDICATE_PACKS = Object.freeze([
    DIALOGUE_PACK
  ]);

  // @insimul/core/src/geo/region-predicates.ts
  var GEO_REGION_PREDICATES_PROLOG = `
% \u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550
% Regions and jurisdiction \u2014 where am I, and whose is it
% packages/core/docs/geopolitical-layer.md \xA73
%
% COMPOSITION PACK. Consult AFTER ai/action-predicates.ts (which declares
% :- dynamic(forbids/4)) and ai/enforcement-predicates.ts (whose norm/2 the
% jurisdiction clause below calls).
%
% Every coordinate is an INTEGER on the geo grid (\xA74): world units multiplied
% by GEO_GRID_SCALE and rounded once, at mint time, by geoUnit() in
% geo/regions.ts. Nothing here rounds, and nothing here compares floats.
% \u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550

% \u2500\u2500 Extents (AUTHORED \u2014 projected from the World IR by geo/regions.ts) \u2500\u2500\u2500\u2500
% region(Id) \u2014 this world knows where Id is. Id is the DOCUMENT's atom: a
%   country, a state, a settlement, a terrain feature, a water body. There is no
%   region id space, which is why a region needs no name, no world and no
%   identifier of its own.
% region_kind(Id, country|state|settlement|terrain|water) \u2014 which axis the
%   extent belongs to. political_kind/1 and geographic_kind/1 below classify
%   them; core enumerates these five because they are the five the World IR
%   exports geometry for, not because a world may not have districts.
% region_bounds(Id, MinX, MinZ, MaxX, MaxZ) \u2014 an axis-aligned extent, inclusive
%   on all four edges. The World IR's BoundsIR.
% region_disc(Id, CenterX, CenterZ, Radius) \u2014 a settlement's footprint, which is
%   what SettlementIR actually carries (a position and a radius).
% region_biome(Id, Biome) \u2014 the biome of the land this extent covers.
% region_watershed(Id, WaterId) \u2014 the water body this extent drains to. A
%   watershed is a RELATION to a water region, not a third geometry: the water
%   body already has an extent of its own.
% region_feature(Id, FeatureType) \u2014 a terrain feature's own type (mountain,
%   ridge, canyon). Read by region_terrain/2 beside the terrain the state and
%   settlement blocks already carry.
:- dynamic(region/1).
:- dynamic(region_kind/2).
:- dynamic(region_bounds/5).
:- dynamic(region_disc/4).
:- dynamic(region_biome/2).
:- dynamic(region_watershed/2).
:- dynamic(region_feature/2).

% place_position(Place, X, Z) \u2014 where a location atom is on the map. The bridge
%   between at_location/2 (which carries a place, not a coordinate) and every
%   rule below (which takes a point). AUTHORED: a lot, a landmark and a camp all
%   have positions in the World IR.
:- dynamic(place_position/3).

% jurisdiction_law(RuleId, JurisdictionId) \u2014 AUTHORED. The rule is that
%   jurisdiction's law and binds an act committed inside it. The territorial
%   twin of faction_law/2: one binds by WHO you are, this one by WHERE you
%   stand, and a world needs both to say that smuggling is legal across the
%   border and heresy is not, whoever you are.
:- dynamic(jurisdiction_law/2).

% \u2500\u2500 Adopted (declared so the pack loads alone; owned elsewhere) \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
% The political blocks are prolog/predicate-schema.ts's country/state/settlement
% entries, unchanged and never re-minted. at_location/2 is the world-state
% predicate traversal writes. entity_id/2 and entity_curie/2 are the KINP bridge
% identity-facts.ts emits. The three rule-block predicates belong to
% prolog/rule-converter.ts and ai/enforcement-predicates.ts.
:- dynamic(country/1).
:- dynamic(state/1).
:- dynamic(settlement/1).
:- dynamic(state_of_country/2).
:- dynamic(settlement_of_state/2).
:- dynamic(settlement_of_country/2).
:- dynamic(state_terrain/2).
:- dynamic(settlement_terrain/2).
:- dynamic(lot_of_settlement/2).
:- dynamic(residence_of_settlement/2).
:- dynamic(business_of_settlement/2).
:- dynamic(at_location/2).
:- dynamic(entity_id/2).
:- dynamic(entity_curie/2).
:- dynamic(rule_forbids_action/2).
:- dynamic(rule_applies/3).
:- dynamic(scoped_norm/1).

% \u2500\u2500 The two axes \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
% Which extents answer "whose is it" and which answer "what is it". A terrain
% feature is never a jurisdiction and a country is never a biome, and keeping
% the two lists here is what lets one containment test serve both questions.

political_kind(country).
political_kind(state).
political_kind(settlement).

geographic_kind(terrain).
geographic_kind(water).

% \u2500\u2500 Containment \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
% Integer comparison, on the grid the facts were minted on. A point on a border
% is INSIDE \u2014 inclusive on all four edges \u2014 so a coastline shared by two states
% resolves to both and jurisdiction_conflict/3 can say so, rather than to
% neither.

% A region's extent as ONE term, so the containment arithmetic can be stated
% once and asked twice. geo/history-predicates.ts resolves an extent through the
% world chain instead of reading these facts, and then calls the very same
% region_extent_contains/3 and region_extent_area/2 \u2014 a border that moved and a
% border that never did are compared by identical arithmetic, which is the whole
% reason this indirection exists.
region_extent(R, rect(MinX, MinZ, MaxX, MaxZ)) :- region_bounds(R, MinX, MinZ, MaxX, MaxZ).
region_extent(R, disc(Cx, Cz, Rad)) :- region_disc(R, Cx, Cz, Rad).

region_extent_contains(rect(MinX, MinZ, MaxX, MaxZ), X, Z) :-
  X >= MinX,
  X =< MaxX,
  Z >= MinZ,
  Z =< MaxZ.

region_extent_contains(disc(Cx, Cz, Rad), X, Z) :-
  DX is X - Cx,
  DZ is Z - Cz,
  DX * DX + DZ * DZ =< Rad * Rad.

% The area of an extent's AXIS-ALIGNED BOUND, so a rectangle and a disc are
% ordered in one commensurate unit. A disc's bound is its enclosing square,
% which is why a settlement inside a state always ranks smaller even when its
% radius is generous.
region_extent_area(rect(MinX, MinZ, MaxX, MaxZ), S) :- S is (MaxX - MinX) * (MaxZ - MinZ).
region_extent_area(disc(_, _, Rad), S) :- S is 4 * Rad * Rad.

in_region(X, Z, R) :-
  region_extent(R, E),
  region_extent_contains(E, X, Z).

region_size(R, S) :-
  region_extent(R, E),
  region_extent_area(E, S).

% A TOTAL order over extents: area first, atom order to break ties. This is the
% whole of AC4 \u2014 "the innermost region" is never "the first solution the engine
% enumerated", so two KBs holding the same facts in different orders answer the
% same thing. A region is never smaller than itself under either clause.
smaller_region(A, B) :-
  region_size(A, SA),
  region_size(B, SB),
  SA < SB.

smaller_region(A, B) :-
  region_size(A, SA),
  region_size(B, SB),
  SA =:= SB,
  A @< B.

% The innermost region of a KIND containing a point: the one no containing
% region of that kind is smaller than.
region_at(X, Z, Kind, R) :-
  in_region(X, Z, R),
  region_kind(R, Kind),
  \\+ ( in_region(X, Z, Other),
        region_kind(Other, Kind),
        smaller_region(Other, R) ).

% \u2500\u2500 What the land is \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500

% A region's terrain is the terrain the DOCUMENT already carries. The state and
% settlement blocks have had state_terrain/2 and settlement_terrain/2 since the
% first world was exported; a region_terrain/2 fact beside them would be the
% second vocabulary for one fact that docs/mechanic-predicates.md \xA710.1 exists
% to prevent. Only a terrain FEATURE \u2014 a thing with no document field for it \u2014
% contributes a fact of its own.
region_terrain(R, T) :- settlement_terrain(R, T).
region_terrain(R, T) :- state_terrain(R, T).
region_terrain(R, T) :- region_feature(R, T).

% The three descriptors, each read off the INNERMOST containing region that
% carries one. A position inside a settlement inside a state answers with the
% settlement's terrain, and falls through to the state's when the settlement
% names none \u2014 which is what makes a sparse world answer at all.
position_terrain(X, Z, T) :-
  in_region(X, Z, R),
  region_terrain(R, T),
  \\+ ( in_region(X, Z, Other),
        region_terrain(Other, _),
        smaller_region(Other, R) ).

position_biome(X, Z, B) :-
  in_region(X, Z, R),
  region_biome(R, B),
  \\+ ( in_region(X, Z, Other),
        region_biome(Other, _),
        smaller_region(Other, R) ).

position_watershed(X, Z, W) :-
  in_region(X, Z, R),
  region_watershed(R, W),
  \\+ ( in_region(X, Z, Other),
        region_watershed(Other, _),
        smaller_region(Other, R) ).

% \u2500\u2500 Whose it is \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500

jurisdiction_level(J, settlement) :- settlement(J).
jurisdiction_level(J, state) :- state(J).
jurisdiction_level(J, country) :- country(J).

% ONE step up the document chain: the superior the world's own blocks name. A
% settlement names its state and, when content authored both links, its country
% directly as well \u2014 normal authoring, and neither link is preferred.
jurisdiction_parent(S, St) :- settlement_of_state(S, St).
jurisdiction_parent(S, C) :- settlement_of_country(S, C).
jurisdiction_parent(St, C) :- state_of_country(St, C).

% The document chain above a jurisdiction: one step, or two. NO recursion \u2014 so it
% is acyclic by construction rather than by a depth guard, and a malformed world
% cannot make it loop. A settlement reaches its country both directly and through
% its state when content authored both; the duplicate solution is folded by the
% caller, which is cheaper than teaching the KB to prefer one path.
%
% geo/history-predicates.ts re-states these two clauses over a WORLD-resolved
% parent instead of jurisdiction_parent/2, which is the only part of the chain a
% regime can move \u2014 the shape of the chain is the same at every time.
jurisdiction_above(J, Above) :- jurisdiction_parent(J, Above).
jurisdiction_above(S, C) :- jurisdiction_parent(S, St), jurisdiction_parent(St, C).

% THE ONE POLITICAL QUESTION GEOMETRY IS ASKED: the smallest political extent
% containing this point, across all three levels at once. Inside a settlement
% that is the settlement; out in the province it is the state; in the marches it
% is the country.
innermost_jurisdiction(X, Z, J) :-
  political_kind(Kind),
  region_at(X, Z, Kind, J),
  \\+ ( political_kind(OtherKind),
        region_at(X, Z, OtherKind, Other),
        smaller_region(Other, J) ).

% ...and everything above it is the DOCUMENTS' answer, never a second reading of
% the map. This is the predicate the rest of the ecosystem asks: the rule
% enforcer, fast travel's discovery, a quest that wants a border crossed.
position_jurisdiction(X, Z, Level, J) :-
  innermost_jurisdiction(X, Z, J),
  jurisdiction_level(J, Level).

position_jurisdiction(X, Z, Level, J) :-
  innermost_jurisdiction(X, Z, Inner),
  jurisdiction_above(Inner, J),
  jurisdiction_level(J, Level).

% Geometry and the documents disagree about this point: a political region
% contains it that the innermost jurisdiction's own chain never reaches. A
% content defect \u2014 a settlement placed across a border, a state whose bounds
% outgrew its country \u2014 NAMED rather than silently resolved, because a silent
% resolution is how a world ships with two capitals.
jurisdiction_conflict(X, Z, J) :-
  political_kind(Kind),
  region_at(X, Z, Kind, J),
  \\+ position_jurisdiction(X, Z, _, J).

% \u2500\u2500 Places, and the actors standing in them \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
% at_location/2 carries a PLACE, not a coordinate, so a place reaches the map
% three ways: it has a position, it IS a jurisdiction, or the lot/residence/
% business blocks already say which settlement it belongs to. The third is the
% one that costs nothing \u2014 those facts have been exported since the beginning.

place_jurisdiction(P, Level, J) :-
  place_position(P, X, Z),
  position_jurisdiction(X, Z, Level, J).

place_jurisdiction(P, Level, J) :-
  jurisdiction_of(P, Level, J).

place_jurisdiction(P, Level, J) :-
  place_of_settlement(P, S),
  jurisdiction_of(S, Level, J).

% A jurisdiction, and everything the documents put above it. The third clause of
% place_jurisdiction/3 calls THIS rather than calling itself, so nothing in this
% pack is recursive: a world that authored lot_of_settlement/2 in a cycle gets a
% wrong answer, which is a content defect, instead of an engine that never
% returns, which is a crash in whatever frame asked.
jurisdiction_of(J, Level, J) :-
  jurisdiction_level(J, Level).

jurisdiction_of(J, Level, Above) :-
  jurisdiction_level(J, _),
  jurisdiction_above(J, Above),
  jurisdiction_level(Above, Level).

place_of_settlement(P, S) :- lot_of_settlement(P, S).
place_of_settlement(P, S) :- residence_of_settlement(P, S).
place_of_settlement(P, S) :- business_of_settlement(P, S).

% Every jurisdiction an actor is currently under. The agent must be BOUND, for
% the same reason candidate_action/3 requires it: an unbound one would enumerate
% every at_location/2 fact in the world.
agent_jurisdiction(A, Level, J) :-
  nonvar(A),
  at_location(A, P),
  place_jurisdiction(P, Level, J).

in_jurisdiction(A, J) :-
  agent_jurisdiction(A, _, J).

% \u2500\u2500 The gate's input \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
% One more clause for forbids/4, and no change to anything that reads it.
% permissible/3, forbidden_by/4, checkAction() and enforceActs() are untouched:
% permissibility differs by territory because content authored a jurisdiction's
% law, not because the gate learned about borders.
%
% A territorial law is SCOPED, so the enforcement pack's universal clause must
% not also match it \u2014 a law of Aldermark that bound every actor everywhere would
% be a more, and the whole point is that it is not. scoped_norm/1 is that pack's
% extension seam and this is the clause that registers the second scope; without
% it, every jurisdiction_law/2 in the world would silently become universal.
scoped_norm(Rule) :- jurisdiction_law(Rule, _).

% The law binds by where the ACTOR stands. Not the target's jurisdiction and not
% the act's: a smuggler in free waters is beyond a customs law even when the
% cargo's owner is not, and "where the act happened" is where its actor was.
forbids(Rule, A, Act, T) :-
  norm(Rule, _),
  jurisdiction_law(Rule, J),
  in_jurisdiction(A, J),
  rule_forbids_action(Rule, Act),
  rule_applies(Rule, A, T).

% \u2500\u2500 Identity \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
% A region is referable across worlds because the atom it is named by is an
% ENTITY, and entity_id/2 / entity_curie/2 already name every entity with its
% KINP identifier. These two rules exist so a caller asking "what is this region
% called elsewhere" has a predicate to ask rather than a convention to follow \u2014
% and so nothing downstream is tempted to mint a region id space.
region_id(R, Id) :- region(R), entity_id(R, Id).
region_curie(R, Curie) :- region(R), entity_curie(R, Curie).
`;
  var GEO_AUTHORED_PREDICATES = Object.freeze([
    "region/1",
    "region_kind/2",
    "region_bounds/5",
    "region_disc/4",
    "region_biome/2",
    "region_watershed/2",
    "region_feature/2",
    "place_position/3",
    "jurisdiction_law/2"
  ]);
  var GEO_ADOPTED_PREDICATES = Object.freeze([
    "country/1",
    "state/1",
    "settlement/1",
    "state_of_country/2",
    "settlement_of_state/2",
    "settlement_of_country/2",
    "state_terrain/2",
    "settlement_terrain/2",
    "lot_of_settlement/2",
    "residence_of_settlement/2",
    "business_of_settlement/2",
    "at_location/2",
    "entity_id/2",
    "entity_curie/2",
    "rule_forbids_action/2",
    "rule_applies/3",
    "scoped_norm/1"
  ]);
  var GEO_RUNTIME_PREDICATES = Object.freeze([]);
  var MAP_PREDICATE_PACK = Object.freeze({
    area: "map",
    prolog: GEO_REGION_PREDICATES_PROLOG,
    runtimePredicates: GEO_RUNTIME_PREDICATES
  });
  var MAP_PREDICATE_PACKS = Object.freeze([
    MAP_PREDICATE_PACK
  ]);

  // @insimul/core/src/placement/placement-predicates.ts
  var PLACEMENT_PREDICATES_PROLOG = `
% \u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550
% Placement painting \u2014 what a stroke put where, which variation of it, and
% whether the stroke was allowed to land at all
% packages/core/docs/placement-painting.md \xA73
%
% COMPOSITION PACK. It defines clauses for nothing anybody else declares: it
% reads the entity vocabulary (item/1, person/1, entity_id/2) and the place
% vocabulary (place_position/3, region/1, lot/1, settlement/1), declaring all
% of them dynamic so it loads into an empty engine and FAILS rather than
% raising. Metric coordinates are deliberately not here \u2014 where a painted node
% stands in metres is the scene manifest's (editor/scene/placement.ts), and a
% second copy of a transform is a transform free to disagree with the first.
% \u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550

% \u2500\u2500 Authored facts (world content \u2014 never in a save) \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
% placement_prop(PropId) \u2014 a thing this world may paint. The palette, and the
%   reason a stroke can be refused for naming something that does not exist:
%   an oak is paintable because the world says an oak is a thing, not because
%   an editor had a button for it.
% placement_prop_variation(PropId, Variation) \u2014 a variation that prop
%   declares. NO fact at all means the prop has exactly one form, which is the
%   right answer for a signpost \u2014 an absence rather than a 'default' atom no
%   world would author, for dialogue_goal_npc/2's reason.
% placement_painted(InstanceId, PropId, PlaceId) \u2014 WHAT and WHERE. One fact
%   per painted instance, keyed by an id the scene manifest carries as its
%   entityId, which is what makes a hand-moved tree survive a regeneration.
% placement_variation(InstanceId, Variation) \u2014 WHICH. The half of variation
%   that is world truth rather than an asset binding: a quest may be about the
%   split oak, and no rule can say "the split one" if the split-ness lives in
%   a mesh name.
% placement_stroke(InstanceId, StrokeId) \u2014 the stroke that laid it. Provenance,
%   and the unit of erasure: a creator undoes a gesture, not four hundred
%   individual trees.
:- dynamic(placement_prop/1).
:- dynamic(placement_prop_variation/2).
:- dynamic(placement_painted/3).
:- dynamic(placement_variation/2).
:- dynamic(placement_stroke/2).

% \u2500\u2500 Runtime facts (per playthrough) \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
% placement_removed(InstanceId) \u2014 this painted instance is gone in THIS
%   playthrough: felled, mined out, burned down. The one runtime fact the area
%   has, and it is runtime for \xA73's reason \u2014 where a world STARTS its trees is
%   the template's, and which of them are stumps on the fortieth day is the
%   save's. Retracting the authored fact instead would edit the world template
%   from inside a playthrough.
:- dynamic(placement_removed/1).

% \u2500\u2500 Adopted (declared so the pack loads alone; owned elsewhere) \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
% The entity vocabulary is PREDICATE_SCHEMA's item and character blocks plus
% the KINP bridge (identity/identity-facts.ts); the place vocabulary is
% geo/region-predicates.ts's and the settlement/lot blocks'.
:- dynamic(item/1).
:- dynamic(person/1).
:- dynamic(entity_id/2).
:- dynamic(place_position/3).
:- dynamic(region/1).
:- dynamic(lot/1).
:- dynamic(settlement/1).

% \u2500\u2500 Counting \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500

% The pack's own fold, for dialogue_sum/2's reason: the shared engine has no
% aggregate_all/3 (it lives in library(aggregate), and a pack may not depend on
% a library) and a pack may not redefine a static builtin. See
% docs/tau-wasm-parity.md D-1.
placement_length([], 0).
placement_length([_ | T], N) :-
  placement_length(T, N0),
  N is N0 + 1.

% \u2500\u2500 What the world knows \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500

% A subject a stroke may name. Four clauses, and they are four DIFFERENT
% answers to "the world has heard of this": the paint palette itself, the item
% catalogue, the people, and anything KINP gave an identifier to. A world
% extends the set by asserting facts, never by editing this rule.
placement_subject(S) :- placement_prop(S).
placement_subject(S) :- item(S).
placement_subject(S) :- person(S).
placement_subject(S) :- entity_id(S, _).

% A place a stroke may target. Same shape: a location atom that is on the map,
% a region, a lot, a settlement. There is no clause for "anywhere", which is
% the whole of why a stroke over a place nobody generated is refused.
placement_place(P) :- place_position(P, _, _).
placement_place(P) :- region(P).
placement_place(P) :- lot(P).
placement_place(P) :- settlement(P).

% THE GATE. May a stroke put that there? Asked of the KB by
% game-engine/logic/PlacementPainter.ts before a single fact is written, and
% asked with both arguments BOUND \u2014 unbound, it would enumerate the cross
% product of everything the world knows with everywhere it could go, which is
% not a question anybody is asking.
placement_paintable(S, P) :-
  nonvar(S),
  nonvar(P),
  placement_subject(S),
  placement_place(P).

% \u2500\u2500 What is actually there \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500

% Painted, and not removed since. The predicate every other reader should use:
% placement_painted/3 alone is what the TEMPLATE says, and a felled tree is
% still in the template.
placement_present(I) :-
  placement_painted(I, _, _),
  \\+ placement_removed(I).

% Which props stand in which places, live. The join a quest, a norm or an
% ambient-life rule asks: is there an oak in the grove at all.
placement_at(Prop, Place) :-
  placement_painted(I, Prop, Place),
  placement_present(I).

% How many of them. Integer, over live instances only.
placement_density(Prop, Place, N) :-
  nonvar(Prop),
  nonvar(Place),
  findall(I, (placement_painted(I, Prop, Place), placement_present(I)), Is),
  placement_length(Is, N).

% The instances one gesture laid \u2014 the unit of erasure.
placement_of_stroke(Stroke, I) :-
  placement_stroke(I, Stroke).

% \u2500\u2500 What is wrong with it \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500

% An instance carrying a variation its prop never declared. It cannot happen
% through PlacementPainter \u2014 the gate refuses the whole delta first \u2014 so a
% solution here means facts arrived some other way: a hand-edited world file,
% an importer, a prop whose variation list was narrowed after the painting.
% The corpus pins it as a NEGATIVE, which is what stops an engine from
% answering yes to every variation it is shown.
placement_misvaried(I) :-
  placement_variation(I, V),
  placement_painted(I, Prop, _),
  \\+ placement_prop_variation(Prop, V).

% An instance whose prop the world no longer declares, and which no other part
% of the vocabulary knows either \u2014 content deleted out from under a stroke.
placement_orphan(I) :-
  placement_painted(I, Prop, _),
  \\+ placement_subject(Prop).
`;
  var PLACEMENT_AREA = "placement";
  var PLACEMENT_AUTHORED_PREDICATES = Object.freeze([
    "placement_prop/1",
    "placement_prop_variation/2",
    "placement_painted/3",
    "placement_variation/2",
    "placement_stroke/2"
  ]);
  var PLACEMENT_RUNTIME_PREDICATES = Object.freeze([
    "placement_removed/1"
  ]);
  var PLACEMENT_RULE_PREDICATES = Object.freeze([
    "placement_length/2",
    "placement_subject/1",
    "placement_place/1",
    "placement_paintable/2",
    "placement_present/1",
    "placement_at/2",
    "placement_density/3",
    "placement_of_stroke/2",
    "placement_misvaried/1",
    "placement_orphan/1"
  ]);
  var PLACEMENT_PACK = Object.freeze({
    area: PLACEMENT_AREA,
    prolog: PLACEMENT_PREDICATES_PROLOG,
    runtimePredicates: PLACEMENT_RUNTIME_PREDICATES
  });
  var PLACEMENT_PREDICATE_PACKS = Object.freeze([
    PLACEMENT_PACK
  ]);

  // @insimul/core/src/platformer/platformer-predicates.ts
  var PLATFORMER_PREDICATES_PROLOG = `
% \u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550
% Platformer \u2014 levels over the world's places, goals at homes and workplaces
% packages/core/docs/genre-mechanics.md \xA74
%
% COMPOSITION PACK. Consult WITH prolog/mechanics/traversal-predicates.ts:
% platformer_goal_reachable/2 calls reachable/3. at_location/2 is the
% traversal pack's world-state fact; it is declared dynamic here so the pack
% loads alone.
% \u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550

% \u2500\u2500 Authored facts (world content \u2014 never in a save) \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
% platformer_level(L, Order) \u2014 a level, and where it comes in the course (1..).
% platformer_level_start(L, Place) / platformer_level_goal(L, Place) \u2014 place
%   atoms of the traversal graph.
% platformer_level_goal_kind(L, home|work|place) and
%   platformer_level_subject(L, Character) \u2014 whose home or workplace it is.
% platformer_level_checkpoint(L, Place, N) \u2014 the N-th place to touch on the way.
% platformer_level_par(L, Cost) \u2014 the cost a three-star run stays within.
:- dynamic(platformer_level/2).
:- dynamic(platformer_level_start/2).
:- dynamic(platformer_level_goal/2).
:- dynamic(platformer_level_goal_kind/2).
:- dynamic(platformer_level_subject/2).
:- dynamic(platformer_level_checkpoint/3).
:- dynamic(platformer_level_par/2).

% \u2500\u2500 Runtime facts (per playthrough) \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
% platformer_running(Runner, L) \u2014 the level this runner is on.
% platformer_checkpoint_reached(Runner, L, N) \u2014 checkpoint N touched this run.
% platformer_run_cost(Runner, L, Cost) \u2014 what this run has cost so far.
% platformer_cleared(Runner, L, Stars) \u2014 the best clear of L.
:- dynamic(platformer_running/2).
:- dynamic(platformer_checkpoint_reached/3).
:- dynamic(platformer_run_cost/3).
:- dynamic(platformer_cleared/3).

% \u2500\u2500 Adopted (declared so the pack loads alone; owned by traversal) \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
:- dynamic(at_location/2).

% \u2500\u2500 Helpers \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
platformer_max([X], X).
platformer_max([X | T], M) :-
  T \\== [],
  platformer_max(T, M0),
  ( X >= M0 -> M = X ; M = M0 ).

% \u2500\u2500 Order \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500

% The first level is open to everybody; every other one opens when the level
% before it has been cleared.
platformer_unlocked(R, L) :-
  nonvar(R),
  platformer_level(L, 1).
platformer_unlocked(R, L) :-
  nonvar(R),
  platformer_level(L, N),
  N > 1,
  P is N - 1,
  platformer_level(Prev, P),
  platformer_cleared(R, Prev, _).

% \u2500\u2500 Reachability (traversal's question, asked of a level) \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500

% A test, once per level: reachable/3 finds every route, and how many there
% are is not the question.
platformer_goal_reachable(R, L) :-
  nonvar(R),
  platformer_level_start(L, S),
  platformer_level_goal(L, G),
  \\+ \\+ reachable(R, S, G).

% \u2500\u2500 The run \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500

platformer_checkpoint_missed(R, L, N) :-
  platformer_level_checkpoint(L, _, N),
  \\+ platformer_checkpoint_reached(R, L, N).

% A level is complete when the runner is on it, stands at its goal, and has
% touched every checkpoint.
platformer_level_complete(R, L) :-
  nonvar(R),
  platformer_running(R, L),
  platformer_level_goal(L, G),
  at_location(R, G),
  \\+ platformer_checkpoint_missed(R, L, _).

% Where a runner who falls goes back to: the furthest checkpoint touched this
% run, or the level's start.
platformer_respawn(R, L, Place) :-
  nonvar(R),
  platformer_running(R, L),
  findall(N, platformer_checkpoint_reached(R, L, N), Ns),
  Ns \\== [],
  !,
  platformer_max(Ns, Max),
  platformer_level_checkpoint(L, Place, Max).
platformer_respawn(R, L, Place) :-
  nonvar(R),
  platformer_running(R, L),
  platformer_level_start(L, Place).

% Stars for a run of this cost: within par is three, within half as much
% again is two, anything else that finishes is one. Integer arithmetic only.
platformer_stars_for(L, Cost, 3) :-
  platformer_level_par(L, Par),
  Cost =< Par,
  !.
platformer_stars_for(L, Cost, 2) :-
  platformer_level_par(L, Par),
  2 * Cost =< 3 * Par,
  !.
platformer_stars_for(L, _, 1) :-
  platformer_level(L, _).

platformer_run_stars(R, L, Stars) :-
  platformer_level_complete(R, L),
  platformer_run_cost(R, L, Cost),
  platformer_stars_for(L, Cost, Stars).

% The course is finished when every level has been cleared.
platformer_course_complete(R) :-
  nonvar(R),
  \\+ \\+ platformer_level(_, _),
  \\+ (platformer_level(L, _), \\+ platformer_cleared(R, L, _)).
`;
  var PLATFORMER_AREA = "platformer";
  var PLATFORMER_AUTHORED_PREDICATES = Object.freeze([
    "platformer_level/2",
    "platformer_level_start/2",
    "platformer_level_goal/2",
    "platformer_level_goal_kind/2",
    "platformer_level_subject/2",
    "platformer_level_checkpoint/3",
    "platformer_level_par/2"
  ]);
  var PLATFORMER_RUNTIME_PREDICATES = Object.freeze([
    "platformer_running/2",
    "platformer_checkpoint_reached/3",
    "platformer_run_cost/3",
    "platformer_cleared/3"
  ]);
  var PLATFORMER_PACK = Object.freeze({
    area: PLATFORMER_AREA,
    prolog: PLATFORMER_PREDICATES_PROLOG,
    runtimePredicates: PLATFORMER_RUNTIME_PREDICATES
  });
  var PLATFORMER_PREDICATE_PACKS = Object.freeze([PLATFORMER_PACK]);

  // @insimul/core/src/puzzle/puzzle-predicates.ts
  var PUZZLE_PREDICATES_PROLOG = `
% \u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550
% Puzzle \u2014 riddles answered by the world, locks opened by what was found
% packages/core/docs/genre-mechanics.md \xA73
%
% COMPOSITION PACK. Reads the world generator's facts (business_owner/2,
% lives_at/2, married_to/2, parent_of/2, occupation/2, truth_about/2,
% text_author/2, business_type/2) and the equipment vocabulary's has_item/3, and
% defines clauses for none of them. They are declared dynamic so the pack loads
% alone.
% \u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550

% \u2500\u2500 Authored facts (world content \u2014 never in a save) \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
% puzzle_riddle(R, Relation, Subject) \u2014 a question about Subject, answered by
%   the world's own facts through puzzle_relation_answer/3.
% puzzle_riddle_prompt(R, Text) \u2014 what the player is asked. Display only.
% puzzle_riddle_clue(R, TextId) \u2014 a text that must have been found before the
%   riddle is put to anybody.
% puzzle_lock(L, Target) \u2014 a lock on Target (a container or building atom).
% puzzle_lock_needs(L, Need) \u2014 riddle(R), item(I), clue(T) or lock(L2).
% puzzle_lock_holds(L, Item) \u2014 what opening L makes available to take.
% puzzle_final(L) \u2014 the lock whose opening completes the puzzle.
% puzzle_max_attempts(N) \u2014 wrong answers a riddle tolerates before it is spent.
%   A world that authored none never spends a riddle.
:- dynamic(puzzle_riddle/3).
:- dynamic(puzzle_riddle_prompt/2).
:- dynamic(puzzle_riddle_clue/2).
:- dynamic(puzzle_lock/2).
:- dynamic(puzzle_lock_needs/2).
:- dynamic(puzzle_lock_holds/2).
:- dynamic(puzzle_final/1).
:- dynamic(puzzle_max_attempts/1).

% \u2500\u2500 Runtime facts (per playthrough) \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
% puzzle_clue_found(Actor, TextId) \u2014 the actor has found and read that text.
% puzzle_solved(Actor, R) \u2014 the actor answered R correctly.
% puzzle_attempts(Actor, R, N) \u2014 wrong answers so far. Absent means none.
% puzzle_opened(Actor, L) \u2014 the actor opened L.
:- dynamic(puzzle_clue_found/2).
:- dynamic(puzzle_solved/2).
:- dynamic(puzzle_attempts/3).
:- dynamic(puzzle_opened/2).

% \u2500\u2500 Adopted (declared so the pack loads alone; owned elsewhere) \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
:- dynamic(business_owner/2).
:- dynamic(business_type/2).
:- dynamic(lives_at/2).
:- dynamic(married_to/2).
:- dynamic(parent_of/2).
:- dynamic(occupation/2).
:- dynamic(truth_about/2).
:- dynamic(text_author/2).
:- dynamic(has_item/3).

% \u2500\u2500 What the world says \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500

% One clause per relation, each a lookup in the world's own vocabulary. A
% relation with several true answers (two residents of one house, two
% parents) accepts any of them.
puzzle_relation_answer(owner_of, B, X) :- business_owner(B, X).
puzzle_relation_answer(trade_of, B, X) :- business_type(B, X).
puzzle_relation_answer(resident_of, P, X) :- lives_at(X, P).
puzzle_relation_answer(home_of, Who, X) :- lives_at(Who, X).
puzzle_relation_answer(spouse_of, Who, X) :- married_to(Who, X).
puzzle_relation_answer(parent_of, Who, X) :- parent_of(X, Who).
puzzle_relation_answer(child_of, Who, X) :- parent_of(Who, X).
puzzle_relation_answer(occupation_of, Who, X) :- occupation(Who, X).
puzzle_relation_answer(subject_of, T, X) :- truth_about(T, X).
puzzle_relation_answer(author_of, T, X) :- text_author(T, X).

puzzle_answer(R, X) :-
  puzzle_riddle(R, Rel, S),
  puzzle_relation_answer(Rel, S, X).

% A riddle the world can answer at all. \\+ \\+ keeps it a test: it binds
% nothing and enumerates each riddle once.
puzzle_answerable(R) :-
  puzzle_riddle(R, _, _),
  \\+ \\+ puzzle_answer(R, _).

% Is this answer right? The answer must be GIVEN: an unbound one would unify
% with the truth and every guess would be correct.
puzzle_correct(R, Given) :-
  nonvar(Given),
  puzzle_riddle(R, _, _),
  \\+ \\+ puzzle_answer(R, Given).

% \u2500\u2500 Asking \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500

puzzle_spent(A, R) :-
  puzzle_max_attempts(M),
  puzzle_attempts(A, R, N),
  N >= M.

% A riddle may be put to this actor: not yet solved, not spent, and every clue
% it waits on found. The actor must be bound, as every actor-keyed gate in the
% build requires.
puzzle_riddle_open(A, R) :-
  nonvar(A),
  puzzle_riddle(R, _, _),
  \\+ puzzle_solved(A, R),
  \\+ puzzle_spent(A, R),
  \\+ (puzzle_riddle_clue(R, T), \\+ puzzle_clue_found(A, T)).

puzzle_can_answer(A, R) :-
  puzzle_riddle_open(A, R),
  puzzle_answerable(R).

% \u2500\u2500 Opening \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500

puzzle_need_met(A, riddle(R)) :- puzzle_solved(A, R).
puzzle_need_met(A, item(I)) :- has_item(A, I, N), N > 0.
puzzle_need_met(A, clue(T)) :- puzzle_clue_found(A, T).
puzzle_need_met(A, lock(L)) :- puzzle_opened(A, L).

% What still stands between this actor and this lock.
puzzle_unmet(A, L, Need) :-
  nonvar(A),
  puzzle_lock_needs(L, Need),
  \\+ puzzle_need_met(A, Need).

% The same, with the need taken apart \u2014 riddle(r1) as riddle and r1 \u2014 for a
% caller that compares atoms rather than terms.
puzzle_unmet_need(A, L, Kind, Ref) :-
  puzzle_unmet(A, L, Need),
  Need =.. [Kind, Ref].

puzzle_can_unlock(A, L) :-
  nonvar(A),
  puzzle_lock(L, _),
  \\+ puzzle_opened(A, L),
  \\+ puzzle_unmet(A, L, _).

% What an opened lock now lets this actor take, once.
puzzle_can_take(A, I) :-
  nonvar(A),
  puzzle_lock_holds(L, I),
  puzzle_opened(A, L),
  \\+ has_item(A, I, _).

puzzle_complete(A) :-
  nonvar(A),
  puzzle_final(L),
  puzzle_opened(A, L).
`;
  var PUZZLE_AREA = "puzzle";
  var PUZZLE_AUTHORED_PREDICATES = Object.freeze([
    "puzzle_riddle/3",
    "puzzle_riddle_prompt/2",
    "puzzle_riddle_clue/2",
    "puzzle_lock/2",
    "puzzle_lock_needs/2",
    "puzzle_lock_holds/2",
    "puzzle_final/1",
    "puzzle_max_attempts/1"
  ]);
  var PUZZLE_RUNTIME_PREDICATES = Object.freeze([
    "puzzle_clue_found/2",
    "puzzle_solved/2",
    "puzzle_attempts/3",
    "puzzle_opened/2"
  ]);
  var PUZZLE_RELATIONS = Object.freeze([
    "owner_of",
    "trade_of",
    "resident_of",
    "home_of",
    "spouse_of",
    "parent_of",
    "child_of",
    "occupation_of",
    "subject_of",
    "author_of"
  ]);
  var PUZZLE_PACK = Object.freeze({
    area: PUZZLE_AREA,
    prolog: PUZZLE_PREDICATES_PROLOG,
    runtimePredicates: PUZZLE_RUNTIME_PREDICATES
  });
  var PUZZLE_PREDICATE_PACKS = Object.freeze([PUZZLE_PACK]);

  // @insimul/core/src/strategy/strategy-predicates.ts
  var STRATEGY_PREDICATES_PROLOG = `
% \u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550
% Strategy \u2014 holdings, resources and the settlements they add up to
% packages/core/docs/genre-mechanics.md \xA75
%
% COMPOSITION PACK over the world generator's business, settlement and
% residence blocks: reads them, defines clauses for none of them.
% \u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550

% \u2500\u2500 Authored facts (world content \u2014 never in a save) \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
% strategy_resource(Res) \u2014 a resource the campaign counts.
% strategy_trade_output(Trade, Res, Amount) \u2014 what one hand at a holding of
%   that trade yields per turn. The holding itself counts as one hand.
% strategy_claim_cost(Trade, Res, Amount) \u2014 what taking a holding of that trade
%   costs. strategy_default_claim_cost(Res, Amount) prices a trade with none.
% strategy_worker_upkeep(Res, Amount) \u2014 what one assigned worker eats per turn.
% strategy_workers_per_holding(N) \u2014 hands one holding takes.
% strategy_adjacent(S1, S2) \u2014 settlements a faction may expand between.
% strategy_faction(F) \u2014 a faction in the campaign.
:- dynamic(strategy_resource/1).
:- dynamic(strategy_trade_output/3).
:- dynamic(strategy_claim_cost/3).
:- dynamic(strategy_default_claim_cost/2).
:- dynamic(strategy_worker_upkeep/2).
:- dynamic(strategy_workers_per_holding/1).
:- dynamic(strategy_adjacent/2).
:- dynamic(strategy_faction/1).

% \u2500\u2500 Runtime facts (per playthrough) \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
% strategy_holds(F, B) \u2014 faction F runs business B.
% strategy_stock(F, Res, Amount) \u2014 F's stockpile. Absent means none.
% strategy_worker(B, W) \u2014 W works at holding B.
% strategy_turn(N) \u2014 the campaign's turn counter.
:- dynamic(strategy_holds/2).
:- dynamic(strategy_stock/3).
:- dynamic(strategy_worker/2).
:- dynamic(strategy_turn/1).

% \u2500\u2500 Adopted (declared so the pack loads alone; owned elsewhere) \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
:- dynamic(business/1).
:- dynamic(business_type/2).
:- dynamic(business_of_settlement/2).
:- dynamic(business_out_of_business/1).
:- dynamic(settlement/1).
:- dynamic(lives_at/2).
:- dynamic(residence_of_settlement/2).

% \u2500\u2500 Helpers (library-free, as every pack is) \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
strategy_sum([], 0).
strategy_sum([X | T], S) :- strategy_sum(T, S0), S is S0 + X.
strategy_length([], 0).
strategy_length([_ | T], N) :- strategy_length(T, N0), N is N0 + 1.

% \u2500\u2500 Holdings \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500

strategy_trading(B) :-
  business(B),
  \\+ business_out_of_business(B).

strategy_holding_in(F, B, S) :-
  strategy_holds(F, B),
  business_of_settlement(B, S).

% What F holds of Res, zero when it holds none. F must be bound.
strategy_stock_of(F, Res, Amount) :-
  nonvar(F),
  strategy_resource(Res),
  ( strategy_stock(F, Res, A0) -> Amount = A0 ; Amount = 0 ).

strategy_hands(B, Hands) :-
  findall(W, strategy_worker(B, W), Ws),
  strategy_length(Ws, N),
  Hands is N + 1.

% \u2500\u2500 A turn's books \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500

strategy_output(B, Res, Amount) :-
  strategy_trading(B),
  business_type(B, T),
  strategy_trade_output(T, Res, Per),
  strategy_hands(B, Hands),
  Amount is Per * Hands.

strategy_income(F, Res, Total) :-
  strategy_faction(F),
  strategy_resource(Res),
  findall(A, (strategy_holds(F, B), strategy_output(B, Res, A)), As),
  strategy_sum(As, Total).

strategy_upkeep(F, Res, Total) :-
  strategy_faction(F),
  strategy_resource(Res),
  findall(W, (strategy_holds(F, B), strategy_worker(B, W)), Ws),
  strategy_length(Ws, N),
  ( strategy_worker_upkeep(Res, Per) -> true ; Per = 0 ),
  Total is N * Per.

strategy_net(F, Res, Net) :-
  strategy_income(F, Res, In),
  strategy_upkeep(F, Res, Out),
  Net is In - Out.

% A resource this faction is short of next turn: what it has plus what the
% turn brings is below zero.
strategy_shortfall(F, Res, Short) :-
  strategy_net(F, Res, Net),
  strategy_stock_of(F, Res, Have),
  Short is 0 - (Have + Net),
  Short > 0.

% \u2500\u2500 Taking a holding \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500

strategy_claim_price(B, Res, Amount) :-
  business_type(B, T),
  strategy_claim_cost(T, _, _),
  !,
  strategy_claim_cost(T, Res, Amount).
strategy_claim_price(B, Res, Amount) :-
  business(B),
  strategy_default_claim_cost(Res, Amount).

strategy_cannot_afford(F, B) :-
  strategy_claim_price(B, Res, Cost),
  strategy_stock_of(F, Res, Have),
  Have < Cost.

% Where a faction may reach: a settlement it already holds in, one adjacent to
% a settlement it controls, or anywhere at all while it holds nothing.
strategy_frontier(F, S) :-
  strategy_holding_in(F, _, S).
strategy_frontier(F, S) :-
  strategy_controls(F, S0),
  ( strategy_adjacent(S0, S) ; strategy_adjacent(S, S0) ).
strategy_frontier(F, S) :-
  nonvar(F),
  \\+ strategy_holds(F, _),
  settlement(S).

strategy_can_claim(F, B) :-
  nonvar(F),
  strategy_faction(F),
  strategy_trading(B),
  \\+ strategy_holds(F, B),
  business_of_settlement(B, S),
  \\+ \\+ strategy_frontier(F, S),
  \\+ strategy_cannot_afford(F, B).

% \u2500\u2500 Hands \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500

strategy_resident_of(W, S) :-
  lives_at(W, R),
  residence_of_settlement(R, S).

strategy_can_assign(F, W, B) :-
  nonvar(F),
  nonvar(W),
  strategy_holds(F, B),
  strategy_trading(B),
  business_of_settlement(B, S),
  strategy_resident_of(W, S),
  \\+ strategy_worker(_, W),
  findall(X, strategy_worker(B, X), Xs),
  strategy_length(Xs, N),
  strategy_workers_per_holding(Max),
  N < Max.

% \u2500\u2500 Control \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500

strategy_trading_in(S, N) :-
  settlement(S),
  findall(B, (business_of_settlement(B, S), strategy_trading(B)), Bs),
  strategy_length(Bs, N).

strategy_held_in(F, S, N) :-
  findall(B, (strategy_holding_in(F, B, S), strategy_trading(B)), Bs),
  strategy_length(Bs, N).

% A strict majority of the settlement's trading businesses.
strategy_controls(F, S) :-
  strategy_faction(F),
  strategy_trading_in(S, Total),
  Total > 0,
  strategy_held_in(F, S, Held),
  2 * Held > Total.

strategy_victory(F) :-
  nonvar(F),
  strategy_faction(F),
  \\+ (strategy_trading_in(S, Total), Total > 0, \\+ strategy_controls(F, S)),
  \\+ \\+ strategy_controls(F, _).
`;
  var STRATEGY_AREA = "strategy";
  var STRATEGY_AUTHORED_PREDICATES = Object.freeze([
    "strategy_resource/1",
    "strategy_trade_output/3",
    "strategy_claim_cost/3",
    "strategy_default_claim_cost/2",
    "strategy_worker_upkeep/2",
    "strategy_workers_per_holding/1",
    "strategy_adjacent/2",
    "strategy_faction/1"
  ]);
  var STRATEGY_RUNTIME_PREDICATES = Object.freeze([
    "strategy_holds/2",
    "strategy_stock/3",
    "strategy_worker/2",
    "strategy_turn/1"
  ]);
  var STRATEGY_PACK = Object.freeze({
    area: STRATEGY_AREA,
    prolog: STRATEGY_PREDICATES_PROLOG,
    runtimePredicates: STRATEGY_RUNTIME_PREDICATES
  });
  var STRATEGY_PREDICATE_PACKS = Object.freeze([STRATEGY_PACK]);

  // @insimul/core/src/production/production-predicates.ts
  var CRAFTING_PREDICATES_PROLOG = `
% \u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550
% Crafting \u2014 what this world knows how to make, out of what, where, with what
% packages/core/docs/native-production.md \xA73.1
%
% COMPOSITION PACK. Consult AFTER prolog/mechanics/equipment-predicates.ts and
% prolog/mechanics/skill-predicates.ts: it reads has_item/3, item_type/2 and
% has_skill/3 and defines clauses for none of them. It declares them dynamic so
% it loads alone, exactly as the business pack declares the trade layer's.
%
% It mints NO runtime predicate. What crafting does is move items, and the
% vocabulary already had one name for that.
% \u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550

% \u2500\u2500 Authored facts (world content \u2014 never in a save) \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
% recipe(R) \u2014 something this world knows how to make.
% recipe_station(R, Type) \u2014 the at_location_type/2 atom it must be made at. A
%   recipe with none may be made anywhere, which is the right answer for
%   lashing two sticks together.
% recipe_tool(R, Type) \u2014 an item_type/2 atom, never an item id, so any hammer
%   serves. There is no tool predicate of this module's own: the taxonomy is
%   the equipment module's and is read rather than restated.
% recipe_input(R, ItemId, Qty) \u2014 consumed. ItemId is an authored item atom.
% recipe_output(R, ItemId, Qty) \u2014 produced. Also an authored item atom, which
%   is what makes a crafted sword the same thing as a bought one.
% recipe_skill(R, SkillId, MinLevel) \u2014 what making it asks of an actor.
% recipe_time(R, Ticks) \u2014 whole ticks.
:- dynamic(recipe/1).
:- dynamic(recipe_station/2).
:- dynamic(recipe_tool/2).
:- dynamic(recipe_input/3).
:- dynamic(recipe_output/3).
:- dynamic(recipe_skill/3).
:- dynamic(recipe_time/2).

% \u2500\u2500 Adopted (declared so the pack loads alone; owned elsewhere) \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
:- dynamic(has_item/3).
:- dynamic(item_type/2).
:- dynamic(has_skill/3).
:- dynamic(at_location/2).
:- dynamic(at_location_type/2).

% \u2500\u2500 What a recipe is \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500

recipe_yields(R, ItemId) :-
  recipe_output(R, ItemId, _).

% Every input present in sufficient quantity. Stated as "nothing it asks for
% is unmet" rather than as a fold, because a fold would need the pack's own
% sum and because "which one am I short of" is the question a player asks.
has_inputs(A, R) :-
  nonvar(A),
  recipe(R),
  \\+ (recipe_input(R, ItemId, Qty), \\+ (has_item(A, ItemId, Held), Held >= Qty)).

% The one they are short of. More than one is more than one solution.
missing_input(A, R, ItemId) :-
  nonvar(A),
  recipe_input(R, ItemId, Qty),
  \\+ (has_item(A, ItemId, Held), Held >= Qty).

% \u2500\u2500 The gate \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500

% May this actor make that? The actor must be BOUND, exactly as
% can_found_business/2 and candidate_action/3 require: an unbound actor would
% enumerate whoever the KB happened to hold.
%
% It asks about place, tool, skill and inputs, and about nothing else. Whether
% making it is ALLOWED \u2014 a guild recipe, a proscribed poison \u2014 is one more
% clause of forbids/4, so permissible/3 refuses it with no line added here.
can_craft(A, R) :-
  nonvar(A),
  recipe(R),
  \\+ (recipe_station(R, Type), \\+ at_location_type(A, Type)),
  \\+ (recipe_tool(R, Tool), \\+ (has_item(A, I, Q), Q > 0, item_type(I, Tool))),
  \\+ (recipe_skill(R, S, Min), \\+ (has_skill(A, S, L), L >= Min)),
  has_inputs(A, R).
`;
  var FARMING_PREDICATES_PROLOG = `
% \u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550
% Farming \u2014 a seed in a plot, a wait, a harvest
% packages/core/docs/native-production.md \xA73.2
%
% COMPOSITION PACK. Consult AFTER the mechanic packs: it reads has_item/3,
% item_type/2, has_skill/3, at_location/2 and day_number/1 and defines clauses
% for none of them.
%
% There is NO ROLL here, and its absence is the finding. v1's
% FarmingSystem.rollCropType() picked the crop AT HARVEST out of a hardcoded
% table weighted by rarity, so a plot sown with wheat came up tomatoes.
% \u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550

% \u2500\u2500 Authored facts (world content \u2014 never in a save) \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
% crop(C) \u2014 a kind this world grows.
% crop_seed(C, ItemId) \u2014 the item atom planting consumes, one per planting.
% crop_yield(C, ItemId, Qty) \u2014 what a ripe plot gives up. More than one row is
%   more than one thing off the same field.
% crop_growth(C, Days) \u2014 whole days from sowing.
% crop_water_bonus(C, Days) \u2014 what one watering takes off the wait.
% crop_skill(C, SkillId, MinLevel), crop_tool(C, Type) \u2014 the same two gates
%   every one of these four mechanics has.
% plot(P) \u2014 a field the world placed. Also the at_location/2 atom a farmer has
%   to be standing on, which is why a plot is a place and not a record.
% plot_of_settlement(P, S) \u2014 whose fields these are.
:- dynamic(crop/1).
:- dynamic(crop_seed/2).
:- dynamic(crop_yield/3).
:- dynamic(crop_growth/2).
:- dynamic(crop_water_bonus/2).
:- dynamic(crop_skill/3).
:- dynamic(crop_tool/2).
:- dynamic(plot/1).
:- dynamic(plot_of_settlement/2).

% \u2500\u2500 Runtime facts (per playthrough) \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
% plot_crop(P, C) \u2014 what is in the ground. Absent = the plot is empty, which
%   is why there is no plot_empty/2 flag: absence IS the empty plot.
% plot_planted(P, Day) \u2014 the absolute day it went in.
% plot_watered(P, N) \u2014 how many times it has been tended. Absent = none, for
%   business_arrears/2's reason: a zero written as a fact is a zero every rule
%   has to remember to read.
:- dynamic(plot_crop/2).
:- dynamic(plot_planted/2).
:- dynamic(plot_watered/2).

% \u2500\u2500 Adopted \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
:- dynamic(has_item/3).
:- dynamic(item_type/2).
:- dynamic(has_skill/3).
:- dynamic(at_location/2).
:- dynamic(day_number/1).

% \u2500\u2500 The state of a field \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500

plot_empty(P) :-
  plot(P),
  \\+ plot_crop(P, _).

plot_tended(P, N) :-
  nonvar(P),
  plot_watered(P, N),
  !.
plot_tended(P, 0) :-
  nonvar(P),
  plot(P).

% How many days THIS planting needs: the crop's growth less one bonus per
% watering, floored at a day. The floor is the mechanic rather than a guard \u2014
% a crop that is ready the instant it is sown is not a crop, and without it a
% generous crop_water_bonus/2 would let a farmer plant and reap one morning.
plot_wait(P, Days) :-
  nonvar(P),
  plot_crop(P, C),
  crop_growth(C, Growth),
  plot_tended(P, N),
  crop_water_bonus(C, Bonus),
  Raw is Growth - N * Bonus,
  Raw >= 1,
  !,
  Days = Raw.
plot_wait(P, 1) :-
  nonvar(P),
  plot_crop(P, _).

% How long it has been in the ground, against the world's own clock.
plot_age(P, Age) :-
  plot_planted(P, Sown),
  day_number(Today),
  Age is Today - Sown.

% Binding the plot FIRST is deliberate: plot_wait/2 cuts, so a caller that let
% it enumerate would get one plot's answer for every plot in the world.
plot_ready(P) :-
  plot_crop(P, _),
  plot_wait(P, Days),
  plot_age(P, Age),
  Age >= Days.

plot_yields(P, ItemId, Qty) :-
  plot_crop(P, C),
  crop_yield(C, ItemId, Qty).

% \u2500\u2500 The gates \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500

can_plant(A, P, C) :-
  nonvar(A),
  plot(P),
  crop(C),
  \\+ plot_crop(P, _),
  at_location(A, P),
  crop_seed(C, Seed),
  has_item(A, Seed, Held),
  Held >= 1,
  \\+ (crop_tool(C, Tool), \\+ (has_item(A, I, Q), Q > 0, item_type(I, Tool))),
  \\+ (crop_skill(C, S, Min), \\+ (has_skill(A, S, L), L >= Min)).

can_harvest(A, P) :-
  nonvar(A),
  plot_crop(P, C),
  at_location(A, P),
  plot_ready(P),
  \\+ (crop_tool(C, Tool), \\+ (has_item(A, I, Q), Q > 0, item_type(I, Tool))),
  \\+ (crop_skill(C, S, Min), \\+ (has_skill(A, S, L), L >= Min)).
`;
  var FISHING_PREDICATES_PROLOG = `
% \u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550
% Fishing \u2014 a cast at a pool that runs down
% packages/core/docs/native-production.md \xA73.3
%
% COMPOSITION PACK. Consult AFTER the mechanic packs.
%
% What this pack answers is what the water HOLDS. What came up on THIS cast is
% a seeded draw, it is not expressible as a rule, and core owns it \u2014
% divergence P-1 of docs/native-production.md \xA76.
% \u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550

% \u2500\u2500 Authored facts (world content \u2014 never in a save) \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
% fishery(Kind) \u2014 a kind of water: river, lake, coast.
% fishery_catch(Kind, ItemId, Weight) \u2014 what it holds, in WHOLE relative
%   weights rather than probabilities. There is no percentage anywhere in
%   these four packs, for the business pack's reason: a float that differs in
%   its last bits gives one engine a trout and another a boot.
% fishery_tool(Kind, Type), fishery_skill(Kind, SkillId, MinLevel) \u2014 the two
%   gates, in the item and skill vocabularies rather than in one of ours.
% fishery_stock(Kind, Casts) \u2014 how many casts a FRESH spot of it holds. v1 had
%   no such number, so a river was a vending machine.
% fishing_spot(S, Kind) \u2014 a pool the world placed. Also the at_location/2 atom.
% spot_of_settlement(S, Settlement).
:- dynamic(fishery/1).
:- dynamic(fishery_catch/3).
:- dynamic(fishery_tool/2).
:- dynamic(fishery_skill/3).
:- dynamic(fishery_stock/2).
:- dynamic(fishing_spot/2).
:- dynamic(spot_of_settlement/2).

% \u2500\u2500 Runtime facts (per playthrough) \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
% spot_stock(S, Casts) \u2014 what is LEFT. Absent = untouched, so a template
%   describes where the water is and a save file describes how hard it has
%   been fished.
:- dynamic(spot_stock/2).

% \u2500\u2500 Adopted \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
:- dynamic(has_item/3).
:- dynamic(item_type/2).
:- dynamic(has_skill/3).
:- dynamic(at_location/2).

% \u2500\u2500 What a pool has left \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500

spot_left(S, N) :-
  nonvar(S),
  spot_stock(S, N),
  !.
spot_left(S, N) :-
  nonvar(S),
  fishing_spot(S, Kind),
  fishery_stock(Kind, N).

spot_fished_out(S) :-
  fishing_spot(S, _),
  spot_left(S, 0).

% What this water holds at all. A weight-0 row is authored and never drawn,
% which is how a world says "there are no salmon in this river any more"
% without deleting the row a quest still reads.
spot_holds(S, ItemId) :-
  fishing_spot(S, Kind),
  fishery_catch(Kind, ItemId, Weight),
  Weight > 0.

% \u2500\u2500 The gate \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500

can_fish(A, S) :-
  nonvar(A),
  fishing_spot(S, Kind),
  at_location(A, S),
  spot_left(S, Left),
  Left > 0,
  \\+ (fishery_tool(Kind, Tool), \\+ (has_item(A, I, Q), Q > 0, item_type(I, Tool))),
  \\+ (fishery_skill(Kind, Sk, Min), \\+ (has_skill(A, Sk, L), L >= Min)).
`;
  var MINING_PREDICATES_PROLOG = `
% \u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550
% Mining \u2014 a swing at a vein that runs out
% packages/core/docs/native-production.md \xA73.4
%
% COMPOSITION PACK. Consult AFTER the mechanic packs.
%
% Structurally the twin of the fishing pack, and deliberately so: a pool and a
% seam differ in what they are called, what tool they take and what they hold,
% and in nothing else. What is NOT shared is the vocabulary, because "is this
% seam dug out" is a different question from "is this river fished out" and a
% rule that had to ask both through one name would be asking neither.
% \u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550

% \u2500\u2500 Authored facts (world content \u2014 never in a save) \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
% seam(Kind) \u2014 a kind of seam: iron, copper, salt.
% seam_ore(Kind, ItemId, Weight) \u2014 what it holds, in whole relative weights.
%   The v1 action block asserted has_item(Actor, ore, 1) for every swing at
%   every rock in the world (prolog/action-effects.ts); this is the row that
%   replaces it.
% seam_tool(Kind, Type), seam_skill(Kind, SkillId, MinLevel) \u2014 the two gates.
% seam_deposit(Kind, Swings) \u2014 how much a FRESH vein of it holds.
% vein(V, Kind) \u2014 a digging the world placed. Also the at_location/2 atom.
% vein_of_settlement(V, Settlement) \u2014 the fact a settlement whose reason to
%   exist has run out is legible from.
:- dynamic(seam/1).
:- dynamic(seam_ore/3).
:- dynamic(seam_tool/2).
:- dynamic(seam_skill/3).
:- dynamic(seam_deposit/2).
:- dynamic(vein/2).
:- dynamic(vein_of_settlement/2).

% \u2500\u2500 Runtime facts (per playthrough) \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
% vein_remaining(V, Swings) \u2014 what is LEFT.
:- dynamic(vein_remaining/2).

% \u2500\u2500 Adopted \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
:- dynamic(has_item/3).
:- dynamic(item_type/2).
:- dynamic(has_skill/3).
:- dynamic(at_location/2).

% \u2500\u2500 What a vein has left \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500

vein_left(V, N) :-
  nonvar(V),
  vein_remaining(V, N),
  !.
vein_left(V, N) :-
  nonvar(V),
  vein(V, Kind),
  seam_deposit(Kind, N).

vein_exhausted(V) :-
  vein(V, _),
  vein_left(V, 0).

vein_holds(V, ItemId) :-
  vein(V, Kind),
  seam_ore(Kind, ItemId, Weight),
  Weight > 0.

% \u2500\u2500 The gate \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500

can_mine(A, V) :-
  nonvar(A),
  vein(V, Kind),
  at_location(A, V),
  vein_left(V, Left),
  Left > 0,
  \\+ (seam_tool(Kind, Tool), \\+ (has_item(A, I, Q), Q > 0, item_type(I, Tool))),
  \\+ (seam_skill(Kind, Sk, Min), \\+ (has_skill(A, Sk, L), L >= Min)).
`;
  var CRAFTING_AREA = "crafting";
  var FARMING_AREA = "farming";
  var FISHING_AREA = "fishing";
  var MINING_AREA = "mining";
  var PRODUCTION_AUTHORED_PREDICATES = Object.freeze([
    "recipe/1",
    "recipe_station/2",
    "recipe_tool/2",
    "recipe_input/3",
    "recipe_output/3",
    "recipe_skill/3",
    "recipe_time/2",
    "crop/1",
    "crop_seed/2",
    "crop_yield/3",
    "crop_growth/2",
    "crop_water_bonus/2",
    "crop_skill/3",
    "crop_tool/2",
    "plot/1",
    "plot_of_settlement/2",
    "fishery/1",
    "fishery_catch/3",
    "fishery_tool/2",
    "fishery_skill/3",
    "fishery_stock/2",
    "fishing_spot/2",
    "spot_of_settlement/2",
    "seam/1",
    "seam_ore/3",
    "seam_tool/2",
    "seam_skill/3",
    "seam_deposit/2",
    "vein/2",
    "vein_of_settlement/2"
  ]);
  var CRAFTING_RUNTIME_PREDICATES = Object.freeze([]);
  var FARMING_RUNTIME_PREDICATES = Object.freeze([
    "plot_crop/2",
    "plot_planted/2",
    "plot_watered/2"
  ]);
  var FISHING_RUNTIME_PREDICATES = Object.freeze(["spot_stock/2"]);
  var MINING_RUNTIME_PREDICATES = Object.freeze(["vein_remaining/2"]);
  var CRAFTING_PACK = Object.freeze({
    area: CRAFTING_AREA,
    prolog: CRAFTING_PREDICATES_PROLOG,
    runtimePredicates: CRAFTING_RUNTIME_PREDICATES
  });
  var FARMING_PACK = Object.freeze({
    area: FARMING_AREA,
    prolog: FARMING_PREDICATES_PROLOG,
    runtimePredicates: FARMING_RUNTIME_PREDICATES
  });
  var FISHING_PACK = Object.freeze({
    area: FISHING_AREA,
    prolog: FISHING_PREDICATES_PROLOG,
    runtimePredicates: FISHING_RUNTIME_PREDICATES
  });
  var MINING_PACK = Object.freeze({
    area: MINING_AREA,
    prolog: MINING_PREDICATES_PROLOG,
    runtimePredicates: MINING_RUNTIME_PREDICATES
  });
  var PRODUCTION_PREDICATE_PACKS = Object.freeze([
    CRAFTING_PACK,
    FARMING_PACK,
    FISHING_PACK,
    MINING_PACK
  ]);
  var PRODUCTION_PACK_TEXT = Object.freeze({
    crafting: CRAFTING_PREDICATES_PROLOG,
    farming: FARMING_PREDICATES_PROLOG,
    fishing: FISHING_PREDICATES_PROLOG,
    mining: MINING_PREDICATES_PROLOG
  });

  // @insimul/core/src/narrative/script-predicates.ts
  var SCRIPT_PREDICATES_PROLOG = `
% \u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550
% Imported scripts \u2014 the nodes, lines and choices an authoring format was
% compiled into, and where a playthrough stands inside them
% packages/core/docs/ink-mapping.md \xA73
%
% STANDALONE PACK. It defines clauses for nothing anybody else declares and
% calls no rule of another pack, so it loads into an empty engine and FAILS
% rather than raising. What it does NOT own is the point: whether a
% conversation satisfied a quest step is dialogue_goal_pending/2's answer over
% the dialogue module's own facts, and a script reaches it through an authored
% dialogue_cue/3 naming a node.
% \u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550

% \u2500\u2500 Authored facts (world content \u2014 never in a save) \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
% script_source(ScriptId, Format) \u2014 an imported script and the front end that
%   produced it (ink | yarn). The atom everything below is keyed by, and the
%   provenance a re-import needs: a world may carry scripts from both formats
%   at once, because the mapping target is one and the front ends are two.
% script_node(ScriptId, NodeId) \u2014 a place the flow can stand. An ink knot, an
%   ink stitch, a gather, or a Yarn node \u2014 the front end decides what deserves
%   one, the KB knows only that it is a node.
% script_entry(ScriptId, NodeId) \u2014 where the flow starts.
% script_line(ScriptId, NodeId, Seq, Text) \u2014 one line of content, Seq
%   ordering it within the node. Text is the authored string and stays a
%   string: it is the one thing in a script that is genuinely for a human to
%   read, and a rule has no business branching on it.
% script_line_speaker(ScriptId, NodeId, Seq, SpeakerId) \u2014 who says it. NO
%   fact at all means the line is narration, which is an absence rather than a
%   'narrator' atom nobody authored (dialogue_goal_npc/2's reason).
% script_line_condition(ScriptId, NodeId, Seq, Cond) \u2014 a condition gating the
%   line. Several facts for one line are a CONJUNCTION; none means always.
% script_choice(ScriptId, NodeId, ChoiceId, Label, TargetNodeId) \u2014 a branch:
%   what the player is offered, and where taking it lands them.
% script_choice_line(ScriptId, NodeId, ChoiceId, Text) \u2014 what is printed
%   AFTER it is taken. ink's [bracket] syntax separates the two, and losing
%   the distinction would silently rewrite half the lines in a real script.
% script_choice_condition(ScriptId, NodeId, ChoiceId, Cond) \u2014 as
%   script_line_condition/4, conjunctive in the same way.
% script_choice_sticky(ScriptId, NodeId, ChoiceId) \u2014 the choice may be taken
%   again (ink's '+'). NO fact means once-only (ink's '*'), which is the
%   commoner case and therefore the absence.
% script_divert(ScriptId, NodeId, TargetNodeId) \u2014 where the flow goes when
%   the node's content runs out and it offers no choice.
% script_end(ScriptId, NodeId) \u2014 a terminal node. The flow stops here.
% script_var(ScriptId, VarId, Initial) \u2014 a declared variable and the value the
%   AUTHOR gave it. The initial only: what it is worth in a playthrough is
%   script_var_value/4, one directory over in the save file.
% script_effect(ScriptId, NodeId, VarId, Op, Value) \u2014 what standing on a node
%   does to a variable. Op is set | add | sub, and Value is an INTEGER: no
%   float, no string, no expression, for docs/mechanic-predicates.md \xA711's
%   reason \u2014 an expression evaluated by an importer is an expression three
%   native engines cannot reproduce.
% script_tag(ScriptId, NodeId, Tag) \u2014 an authored tag on the node. ink tags
%   are how a writer says something to the game, so they are carried whole
%   rather than interpreted here.
:- dynamic(script_source/2).
:- dynamic(script_node/2).
:- dynamic(script_entry/2).
:- dynamic(script_line/4).
:- dynamic(script_line_speaker/4).
:- dynamic(script_line_condition/4).
:- dynamic(script_choice/5).
:- dynamic(script_choice_line/4).
:- dynamic(script_choice_condition/4).
:- dynamic(script_choice_sticky/3).
:- dynamic(script_divert/3).
:- dynamic(script_end/2).
:- dynamic(script_var/3).
:- dynamic(script_effect/5).
:- dynamic(script_tag/3).

% \u2500\u2500 Runtime facts (per playthrough) \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
% script_at(Actor, ScriptId, NodeId) \u2014 where this actor stands. THE fact that
%   makes the KB the story's memory instead of an importer object's.
% script_visits(Actor, ScriptId, NodeId, Count) \u2014 how often they have been
%   here. ink conditions read visit counts, so a world that dropped them would
%   silently re-offer content the writer wrote once.
% script_var_value(Actor, ScriptId, VarId, Value) \u2014 THE variable store. It is
%   in the KB, it is in the save, and it is per-actor because two players of
%   one world are two playthroughs of its script.
% script_taken(Actor, ScriptId, NodeId, ChoiceId) \u2014 a choice already used,
%   which is what makes a once-only choice once-only.
:- dynamic(script_at/3).
:- dynamic(script_visits/4).
:- dynamic(script_var_value/4).
:- dynamic(script_taken/4).

% \u2500\u2500 What a variable is worth \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500

% The playthrough's value if there is one, the author's otherwise. The second
% clause's negation is what stops a variable never written from being answered
% twice, and it is why nothing has to seed the store at import time.
script_value(A, S, Var, V) :-
  script_var_value(A, S, Var, V).
script_value(A, S, Var, V) :-
  script_var(S, Var, V),
  \\+ script_var_value(A, S, Var, _).

% \u2500\u2500 What has been seen \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500

% How often, INCLUDING never: a node with no script_visits/4 fact has been
% visited zero times, and a rule that simply failed there could not answer
% "not yet" \u2014 which is the condition ink writers reach for most.
script_visit_count(A, S, Node, C) :-
  script_visits(A, S, Node, C).
script_visit_count(A, S, Node, 0) :-
  script_node(S, Node),
  \\+ script_visits(A, S, Node, _).

script_visited(A, S, Node) :-
  script_visit_count(A, S, Node, C),
  C > 0.

% \u2500\u2500 Conditions \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500

% The four condition shapes the mapping admits, and no others: a comparison
% against a variable, a comparison against a visit count, and the two visit
% tests that are its common cases spelled readably. An importer that meets an
% expression it cannot reduce to one of these REPORTS it (INK_CONSTRUCTS marks
% it unsupported) rather than emitting a term no rule can evaluate.
script_holds(A, S, var_cmp(Var, Op, N)) :-
  script_value(A, S, Var, V),
  script_compare(Op, V, N).
script_holds(A, S, visited(Node)) :-
  script_visited(A, S, Node).
script_holds(A, S, not_visited(Node)) :-
  script_node(S, Node),
  \\+ script_visited(A, S, Node).
script_holds(A, S, visit_cmp(Node, Op, N)) :-
  script_visit_count(A, S, Node, C),
  script_compare(Op, C, N).

% Each clause type-checks its arguments first. Arithmetic comparison on an
% unbound variable RAISES rather than fails, and a pack that raises on an empty
% KB is a pack that takes the whole KB down when a world consults it before its
% content \u2014 the property mechanic-packs.test.ts holds every pack in the build
% to.
script_compare(eq, V, N) :- number(V), number(N), V =:= N.
script_compare(ne, V, N) :- number(V), number(N), V =\\= N.
script_compare(lt, V, N) :- number(V), number(N), V < N.
script_compare(le, V, N) :- number(V), number(N), V =< N.
script_compare(gt, V, N) :- number(V), number(N), V > N.
script_compare(ge, V, N) :- number(V), number(N), V >= N.

% \u2500\u2500 What is on screen \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500

% A line whose every condition holds. The double negation is a FORALL, which
% is what makes several conditions on one line a conjunction with no list, no
% aggregate and no library (docs/tau-wasm-parity.md D-1).
script_line_live(A, S, Node, Seq, Text) :-
  script_line(S, Node, Seq, Text),
  \\+ ( script_line_condition(S, Node, Seq, C), \\+ script_holds(A, S, C) ).

% A choice already used up: taken, and not sticky. ink's '*' and '+' in one
% clause.
script_choice_spent(A, S, Node, Choice) :-
  script_taken(A, S, Node, Choice),
  \\+ script_choice_sticky(S, Node, Choice).

script_choice_live(A, S, Node, Choice, Label) :-
  script_choice(S, Node, Choice, Label, _),
  \\+ ( script_choice_condition(S, Node, Choice, C), \\+ script_holds(A, S, C) ),
  \\+ script_choice_spent(A, S, Node, Choice).

% \u2500\u2500 Where this actor actually is \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500

% Actor BOUND, for dialogue_goal_score/3's reason: unbound would enumerate
% whoever the KB happened to hold and offer one player another's choices.
script_available(A, S, Choice, Label) :-
  nonvar(A),
  script_at(A, S, Node),
  script_choice_live(A, S, Node, Choice, Label).

script_next(A, S, Choice, Target) :-
  nonvar(A),
  script_at(A, S, Node),
  script_choice(S, Node, Choice, _, Target).

% The flow has nowhere left to go by design.
script_finished(A, S) :-
  script_at(A, S, Node),
  script_end(S, Node).

% ...and the failure that looks like it: a node that is not terminal, diverts
% nowhere, and offers this actor nothing. A writer's dead end, and an ordinary
% query rather than a crash \u2014 which is the only way a host can report one.
script_stuck(A, S) :-
  nonvar(A),
  script_at(A, S, Node),
  \\+ script_end(S, Node),
  \\+ script_divert(S, Node, _),
  \\+ script_choice_live(A, S, Node, _, _).

% \u2500\u2500 Authoring debris \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500

script_reaches(S, Node) :- script_choice(S, _, _, _, Node).
script_reaches(S, Node) :- script_divert(S, _, Node).

% A node nothing reaches and nothing starts at. Content the writer can no
% longer see, and the check an importer cannot make for itself \u2014 a knot may be
% reached from another script's divert only once both are in the KB.
script_orphan(S, Node) :-
  script_node(S, Node),
  \\+ script_entry(S, Node),
  \\+ script_reaches(S, Node).

% A choice pointing at a node this script does not have. The importer refuses
% one (scriptIssues), and this is the same question asked of a KB that several
% imports have landed in.
script_dangling(S, Node, Choice) :-
  script_choice(S, Node, Choice, _, Target),
  \\+ script_node(S, Target).
`;
  var SCRIPT_AREA = "script";
  var SCRIPT_AUTHORED_PREDICATES = Object.freeze([
    "script_source/2",
    "script_node/2",
    "script_entry/2",
    "script_line/4",
    "script_line_speaker/4",
    "script_line_condition/4",
    "script_choice/5",
    "script_choice_line/4",
    "script_choice_condition/4",
    "script_choice_sticky/3",
    "script_divert/3",
    "script_end/2",
    "script_var/3",
    "script_effect/5",
    "script_tag/3"
  ]);
  var SCRIPT_RUNTIME_PREDICATES = Object.freeze([
    "script_at/3",
    "script_visits/4",
    "script_var_value/4",
    "script_taken/4"
  ]);
  var SCRIPT_RULE_PREDICATES = Object.freeze([
    "script_value/4",
    "script_visit_count/4",
    "script_visited/3",
    "script_holds/3",
    "script_compare/3",
    "script_line_live/5",
    "script_choice_spent/4",
    "script_choice_live/5",
    "script_available/4",
    "script_next/4",
    "script_finished/2",
    "script_stuck/2",
    "script_reaches/2",
    "script_orphan/2",
    "script_dangling/3"
  ]);
  var SCRIPT_PACK = Object.freeze({
    area: SCRIPT_AREA,
    prolog: SCRIPT_PREDICATES_PROLOG,
    runtimePredicates: SCRIPT_RUNTIME_PREDICATES
  });
  var SCRIPT_PREDICATE_PACKS = Object.freeze([
    SCRIPT_PACK
  ]);

  // @insimul/core/src/routines/routine-predicates.ts
  var ROUTINE_PREDICATES_PROLOG = `
% \u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550
% NPC routines \u2014 a standing goal, and the clock that decides when it is held
% packages/core/docs/npc-routines.md \xA73
%
% COMPOSITION PACK. Consult AFTER ai/planning-predicates.ts: this pack adds
% clauses for goal_requires/2 and condition_met/2, which that pack declares
% :- dynamic, and a dynamic directive arriving after clauses for the same
% predicate is a permission_error on a strict ISO engine.
% \u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550

% \u2500\u2500 Authored facts (world content \u2014 never in a save) \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
% routine(RoutineId, Name) \u2014 a routine this world knows about.
% routine_block(RoutineId, BlockId) \u2014 the blocks it is made of.
% routine_block_window(BlockId, StartHour, EndHour) \u2014 whole hours. Start is
%   inclusive, End exclusive, and End =< Start WRAPS midnight, so the night
%   watch is one block rather than two.
% routine_block_day(BlockId, Weekday) \u2014 the days it runs, counted
%   day_number mod routine_week_length. NO fact at all means every day.
% routine_block_goal(BlockId, GoalId) \u2014 the goal/2 it puts the NPC in pursuit
%   of. The whole of what a routine decides.
% routine_block_place(BlockId, Location) \u2014 where that goal is pursued.
% routine_block_priority(BlockId, 0..100) \u2014 what it is worth against a quest,
%   an errand or a threat, on agent_goal/3's own scale.
% routine_week_length(N) \u2014 how many days the week has.
:- dynamic(routine/2).
:- dynamic(routine_block/2).
:- dynamic(routine_block_window/3).
:- dynamic(routine_block_day/2).
:- dynamic(routine_block_goal/2).
:- dynamic(routine_block_place/2).
:- dynamic(routine_block_priority/2).
:- dynamic(routine_week_length/1).

% \u2500\u2500 Runtime facts (per playthrough) \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
% follows_routine(Agent, RoutineId) \u2014 whose routine this is. Runtime, because
%   an NPC takes a job, loses one and retires, and which routine they keep at a
%   tick belongs in the save file.
% routine_suspended(Agent, Reason) \u2014 the routine is preempted: a threat, a
%   conversation, a rule violation. While it holds, the routine adopts nothing
%   and whatever displaced it is the only goal in play.
:- dynamic(follows_routine/2).
:- dynamic(routine_suspended/2).

% \u2500\u2500 Adopted (declared so the pack loads alone; owned elsewhere) \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
% The clock is gameplay-predicates.ts's, at_location/2 is what traversal
% writes, and the two planning predicates are ai/planning-predicates.ts's.
:- dynamic(time_of_day/1).
:- dynamic(day_number/1).
:- dynamic(at_location/2).
:- dynamic(goal_requires/2).
:- dynamic(condition_met/2).

% \u2500\u2500 The clock \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500

% Which day of the week it is. The week's length is AUTHORED rather than seven:
% a world with a ten-day week should not need three engines recompiled.
routine_weekday(W) :-
  day_number(D),
  routine_week_length(N),
  N > 0,
  W is D mod N.

% Is this hour inside that window? Semidet either way \u2014 a window that matched
% twice would make a due block a duplicate solution and a routine's priority
% depend on how many ways it happened to match.
%
% Start < End is the ordinary window. Otherwise it WRAPS, and a window whose
% ends coincide (22 to 22) is the whole day, which is how a routine with one
% block is authored.
routine_hour_in(H, Start, End) :- Start < End, !, H >= Start, H < End.
routine_hour_in(H, Start, End) :- ( H >= Start ; H < End ), !.

routine_window_open(B) :-
  routine_block_window(B, Start, End),
  time_of_day(H),
  routine_hour_in(H, Start, End).

% A block with no routine_block_day/2 fact runs every day. Semidet, for the
% same reason routine_hour_in/3 is.
routine_day_matches(B) :- \\+ routine_block_day(B, _), !.
routine_day_matches(B) :- routine_weekday(W), routine_block_day(B, W), !.

% \u2500\u2500 What is due \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500

% A block of this agent's routine whose time condition holds right now.
%
% The agent must be BOUND, exactly as pursuing/3 and candidate_action/3 require:
% an unbound agent would enumerate every follows_routine/2 fact, which is the
% roster being decided by which facts happened to load.
routine_due(A, B) :-
  nonvar(A),
  follows_routine(A, R),
  routine_block(R, B),
  routine_window_open(B),
  routine_day_matches(B).

% The goal a routine wants held, and what it is worth. THIS IS THE WHOLE OF
% WHAT A ROUTINE DECIDES: a goal id and a number, which RoutineDirector writes
% as one agent_goal/3 fact. Everything after that \u2014 which goal wins, which
% actions serve it, whether they are permitted \u2014 is the substrate's, unchanged.
routine_goal(A, G, P) :-
  routine_due(A, B),
  \\+ routine_suspended(A, _),
  routine_block_goal(B, G),
  routine_block_priority(B, P).

% \u2500\u2500 Place \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500

% A block's place is a REQUIREMENT of its goal, stated in the planner's own
% condition vocabulary \u2014 so "get to the forge" is planned by the planner, out of
% the actions the world already authored, rather than by a routine that walks
% people around.
%
% The condition atom IS the location atom: an action the world authored
% action_achieves(walk_to_forge, forge) for is what the planner commits to.
% Because the requirement hangs on the GOAL, two blocks pursuing one goal in two
% places are an authoring error (routineIssues says so) \u2014 that is two goals.
goal_requires(G, Place) :-
  routine_block_goal(B, G),
  routine_block_place(B, Place).

% ...and it is met exactly when the actor is there. at_location/2 is the
% predicate traversal already writes; nothing here moves anybody.
condition_met(A, Place) :-
  routine_block_place(_, Place),
  at_location(A, Place).

% Where the routine wants this agent to be, and whether they are there. US-2
% turns the gap between the two into movement intent; this pack states it and
% executes nothing.
routine_destination(A, Place) :-
  routine_due(A, B),
  routine_block_place(B, Place).

routine_in_place(A) :-
  routine_destination(A, Place),
  at_location(A, Place).
`;
  var ROUTINE_AREA = "routine";
  var ROUTINE_AUTHORED_PREDICATES = Object.freeze([
    "routine/2",
    "routine_block/2",
    "routine_block_window/3",
    "routine_block_day/2",
    "routine_block_goal/2",
    "routine_block_place/2",
    "routine_block_priority/2",
    "routine_week_length/1"
  ]);
  var ROUTINE_RUNTIME_PREDICATES = Object.freeze([
    "follows_routine/2",
    "routine_suspended/2"
  ]);
  var ROUTINE_PACK = Object.freeze({
    area: ROUTINE_AREA,
    prolog: ROUTINE_PREDICATES_PROLOG,
    runtimePredicates: ROUTINE_RUNTIME_PREDICATES
  });
  var ROUTINE_PREDICATE_PACKS = Object.freeze([
    ROUTINE_PACK
  ]);

  // @insimul/core/src/volition/volition-predicates.ts
  var VOLITION_PREDICATES_PROLOG = `
% \u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550
% NPC volition \u2014 what an NPC wants of its own accord, and who it wants it with
% packages/core/docs/npc-volition.md \xA73
%
% COMPOSITION PACK. Consult AFTER ai/action-predicates.ts: this pack reads
% target_kind/2 and agent_goal/3 and its decision layer writes agent_motive/3
% and target_appeal/3. It defines clauses for none of them \u2014 it declares them
% dynamic so it loads alone, exactly as the routine pack declares the clock.
% \u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550

% \u2500\u2500 Authored facts (world content \u2014 never in a save) \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
% desire(DesireId, Motive) \u2014 a want this world knows about, and the motive it
%   feeds. The motive is agent_motive/3's own, so a desire reaches behaviour
%   through the utility function that already exists.
% desire_class(DesireId, romantic|social|ambient) \u2014 which of the three kinds of
%   life this is. Only 'ambient' is read by a rule (it yields, below); the other
%   two are for a reader, a debug overlay and a corpus.
% desire_base(DesireId, 0..100) \u2014 what the want is worth before disposition.
% desire_trait(DesireId, Trait, Above, Bonus) \u2014 the ONE personality trait this
%   desire hangs on, the fraction above which it pulls, and what it adds. At
%   most one fact per desire (volitionIssues reports a second): a sum over
%   traits needs findall/3, and a pack that reaches for a library is a pack
%   three native engines cannot consult verbatim.
% desire_action(DesireId, ActionId) \u2014 the AUTHORED action that serves it. The
%   action block's own id, so the candidate a desire is behind is a candidate
%   the substrate already enumerates and never a second one.
% desire_target_kind(DesireId, Kind) \u2014 the target_kind/2 it is aimed at. No
%   fact at all means the desire is targetless.
% desire_stage(DesireId, Stage) \u2014 the courtship rung a pair must already stand
%   at for this desire to open. No fact means ungated.
% courtship_stage(Stage, Rank) \u2014 the ladder, ranked. A world authors its own
%   rungs; nothing here knows the name of one. Rank 0 is the floor a pair the
%   world has recorded nothing about stands at.
% stage_threshold(Stage, 0..100) \u2014 the spark BOTH of them need for the pair to
%   take that rung.
% ambient_yield(0..100) \u2014 the agent_goal/3 priority ambient life stands down
%   to. What an NPC does when nobody asked it to is what it does when nothing
%   was asked of it.
:- dynamic(desire/2).
:- dynamic(desire_class/2).
:- dynamic(desire_base/2).
:- dynamic(desire_trait/4).
:- dynamic(desire_action/2).
:- dynamic(desire_target_kind/2).
:- dynamic(desire_stage/2).
:- dynamic(courtship_stage/2).
:- dynamic(stage_threshold/2).
:- dynamic(ambient_yield/1).

% \u2500\u2500 Runtime facts (per playthrough) \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
% spark(A, B, 0..100) \u2014 how drawn A is to B right now. ADOPTED from the social
%   vocabulary (prolog/tott-predicates.ts); this is the scalar RomanceSystem
%   kept as a hydrated field, and it is mutation state, so it is a fact.
% romantic_status(A, B, Stage) \u2014 the rung the pair stand at. ADOPTED likewise.
% desire_spent(A, DesireId) \u2014 this urge has just been served, so it offers
%   nothing until the layer that remembers clears it. Runtime, because "what
%   this NPC has just done" is a fact about one playthrough at one tick.
:- dynamic(spark/3).
:- dynamic(romantic_status/3).
:- dynamic(desire_spent/2).

% \u2500\u2500 Adopted (declared so the pack loads alone; owned elsewhere) \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
% personality/3 is the character stack's, target_kind/2, agent_motive/3 and
% target_appeal/3 are ai/action-predicates.ts's, and agent_goal/3 is
% ai/planning-predicates.ts's \u2014 the fact a routine writes, which is what
% ambient life yields to.
:- dynamic(personality/3).
:- dynamic(target_kind/2).
:- dynamic(agent_motive/3).
:- dynamic(target_appeal/3).
:- dynamic(agent_goal/3).

% \u2500\u2500 The ladder \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500

% Which rung a pair stand at. A pair the world has recorded nothing about
% stands at 0 \u2014 the floor \u2014 rather than at a stage this pack named, because
% the names of the rungs are the world's.
volition_rank(A, B, R) :- romantic_status(A, B, S), courtship_stage(S, R).
volition_rank(A, B, 0) :- \\+ romantic_status(A, B, _).

% May this pair take that rung? The next one up, the authored spark, and BOTH
% of them over it. Mutual by construction: a courtship one side wants is not a
% courtship, and an engine that could advance it unilaterally is an engine that
% married somebody to their stalker.
volition_may_advance(A, B, S) :-
  nonvar(A), nonvar(B),
  courtship_stage(S, R),
  volition_rank(A, B, Cur),
  R =:= Cur + 1,
  stage_threshold(S, Need),
  spark(A, B, X), X >= Need,
  spark(B, A, Y), Y >= Need.

% \u2500\u2500 Drive \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500

% What disposition adds. A COMPARISON against an authored fraction, never a
% multiplication: personality/3 carries floats and a drive four engines must
% agree on may not turn on one. Semidet \u2014 at most one desire_trait/4 per
% desire, which volitionIssues enforces on the authoring side.
volition_pull(A, D, Bonus) :-
  desire_trait(D, Trait, Above, Bonus),
  personality(A, Trait, V),
  V > Above,
  !.
volition_pull(_, _, 0).

volition_clamp(R, 0) :- R < 0, !.
volition_clamp(R, 100) :- R > 100, !.
volition_clamp(R, R).

% What this desire is worth to this agent: its standing strength plus whatever
% its disposition adds, on agent_motive/3's own 0..100 scale. Integer
% arithmetic throughout.
volition_drive(A, D, Drive) :-
  nonvar(A),
  desire_base(D, Base),
  volition_pull(A, D, Pull),
  Raw is Base + Pull,
  volition_clamp(Raw, Drive).

% \u2500\u2500 Ambient life yields \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500

% Is something already asked of this agent? agent_goal/3 is the fact the
% ROUTINE module writes (docs/npc-routines.md \xA73) \u2014 ambient life reads it and
% stands down, which is what makes this module an extension of that one rather
% than a second day running beside it.
volition_yielding(A) :-
  ambient_yield(P),
  agent_goal(A, _, Q),
  Q >= P.

% A desire is active unless it is ambient life during a day that has something
% in it.
volition_active(A, D) :- desire_class(D, ambient), !, \\+ volition_yielding(A).
volition_active(_, D) :- \\+ desire_class(D, ambient).

% \u2500\u2500 What the agent proposes \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500

% Who a desire could be aimed at. A targetless desire's target is the atom
% 'none', exactly as action_target_choice/2 spells it, and an agent is never
% its own target.
volition_target(A, D, T) :-
  desire_target_kind(D, Kind),
  target_kind(T, Kind),
  T \\== A.
volition_target(_, D, none) :- \\+ desire_target_kind(D, _).

% The stage gate on a romantic desire: the pair must ALREADY stand at or above
% the rung the desire names. A desire naming no stage is ungated, and a
% targetless one has no pair to stand anywhere.
volition_stage_met(_, _, D) :- \\+ desire_stage(D, _).
volition_stage_met(A, T, D) :-
  desire_stage(D, S),
  courtship_stage(S, Need),
  volition_rank(A, T, R),
  R >= Need.

% A PROPOSAL: this desire, aimed at that target, worth this much.
%
% It is not a decision and not an action. The whole of what a proposal does is
% become a number on agent_motive/3 and target_appeal/3 \u2014 after which the
% substrate enumerates candidates from the action block, the utility layer
% scores them and permissible/3 decides which of them the agent may have. A
% desire that never clears the gate never happens, however hard it is wanted,
% and that is the sentence this module exists to make true.
%
% The agent must be BOUND, exactly as candidate_action/3 and routine_due/2
% require: an unbound agent would enumerate whatever the KB happened to hold.
volition_proposal(A, D, T, Drive) :-
  nonvar(A),
  desire(D, _),
  volition_active(A, D),
  \\+ desire_spent(A, D),
  volition_target(A, D, T),
  volition_stage_met(A, T, D),
  volition_drive(A, D, Drive).

% The motive a proposal feeds, and how hard. This is what the decision layer
% writes as agent_motive/3 \u2014 the substrate's own fact \u2014 so a want reaches
% behaviour through the utility function that already exists. Two desires on
% one motive are two solutions; the strongest is the one the layer writes.
volition_motive(A, M, Drive) :-
  volition_proposal(A, D, _, Drive),
  desire(D, M).

% How much more this agent wants THAT one \u2014 target_appeal/3's grudge-or-bond
% term, said in the romance vocabulary. Keyed by TARGET and not by (desire,
% target), for the reason ai/action-selection.ts reads it that way: how an agent
% feels about somebody does not change with what it is about to do to them. One
% solution per direction, because spark/3 is one fact per direction, so the
% layer that writes target_appeal/3 is never folding a rule's duplicates.
volition_appeal(A, T, V) :-
  nonvar(A),
  spark(A, T, V).

% The candidate a desire would be behind: the AUTHORED action that serves it,
% aimed where the desire is aimed. It is not a candidate_action/3 clause and
% must never become one \u2014 enumeration, capability and the gate are the
% substrate's, and this only says which of its answers this want was hoping for.
volition_candidate(A, Act, T) :-
  volition_proposal(A, D, T, _),
  desire_action(D, Act).
`;
  var VOLITION_AREA = "volition";
  var VOLITION_AUTHORED_PREDICATES = Object.freeze([
    "desire/2",
    "desire_class/2",
    "desire_base/2",
    "desire_trait/4",
    "desire_action/2",
    "desire_target_kind/2",
    "desire_stage/2",
    "courtship_stage/2",
    "stage_threshold/2",
    "ambient_yield/1"
  ]);
  var VOLITION_RUNTIME_PREDICATES = Object.freeze([
    "spark/3",
    "romantic_status/3",
    "desire_spent/2"
  ]);
  var VOLITION_PACK = Object.freeze({
    area: VOLITION_AREA,
    prolog: VOLITION_PREDICATES_PROLOG,
    runtimePredicates: VOLITION_RUNTIME_PREDICATES
  });
  var VOLITION_PREDICATE_PACKS = Object.freeze([
    VOLITION_PACK
  ]);

  // @insimul/core/src/weather/weather-predicates.ts
  var WEATHER_PREDICATES_PROLOG = `
% \u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550
% Weather and seasons \u2014 what the sky is doing, and what it closes
% packages/core/docs/weather-seasons.md \xA73
%
% COMPOSITION PACK. Consult AFTER ai/action-predicates.ts: this pack writes
% CLAUSES for forbids/4, which that pack declares dynamic, so it must not
% declare it here. Everything else it touches it declares, so it loads alone.
% \u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550

% \u2500\u2500 Authored facts (world content \u2014 never in a save) \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
% season_order(SeasonId, Index) \u2014 the wheel of the year, ranked from 0. A world
%   authors its own seasons; nothing here knows the name of one, and a world
%   with two seasons or with six is the same amount of code.
% season_length(SeasonId, Days) \u2014 how many days that season lasts.
% season_start(SeasonId, Day) \u2014 the day of the year that season opens on, which
%   is the running sum of the lengths before it. RESOLVED and emitted rather
%   than derived in a rule, for the reason desire_base/2 is: summing a list
%   needs findall/3, and a pack that reaches for a library is a pack three
%   native engines cannot consult verbatim.
% year_length(Days) \u2014 the sum of every season's length. Resolved likewise.
% weather_kind(CondId) \u2014 a condition this world knows about. A condition with
%   no chance in any season is still a condition: a quest may impose one.
% weather_chance(SeasonId, CondId, Weight) \u2014 the relative weight of that
%   condition in that season, 0..100. Weight 0 means the season never brings it,
%   which is what makes 'a drought in winter' expressible as content.
% weather_severity(CondId, 0..100) \u2014 how hard the world is to live in under it.
% weather_bars(CondId, ActionId) \u2014 an action this condition CLOSES. The action
%   block's own id, so what a blizzard stops is an action the substrate already
%   enumerates and never a second one.
% weather_harsh_above(0..100) \u2014 the severity above which the weather is harsh.
:- dynamic(season_order/2).
:- dynamic(season_length/2).
:- dynamic(season_start/2).
:- dynamic(year_length/1).
:- dynamic(weather_kind/1).
:- dynamic(weather_chance/3).
:- dynamic(weather_severity/2).
:- dynamic(weather_bars/2).
:- dynamic(weather_harsh_above/1).

% \u2500\u2500 Runtime facts (per playthrough) \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
% weather(CondId) \u2014 what the sky is doing RIGHT NOW. ADOPTED from the world
%   state vocabulary (prolog/gameplay-predicates.ts), which the twelve
%   environment-awareness rules in prolog/npc-reasoning.ts have always read and
%   which nothing in core had ever written.
% season(SeasonId) \u2014 which season the world is in. ADOPTED likewise
%   (prolog/npc-reasoning.ts).
% weather_day(Day) \u2014 the absolute day the sky was last rolled for. Runtime,
%   because 'how far this playthrough's weather has been advanced' is a fact
%   about one playthrough \u2014 and it is what makes the progression resumable
%   rather than re-rolled from the clock on every load.
:- dynamic(weather/1).
:- dynamic(season/1).
:- dynamic(weather_day/1).

% \u2500\u2500 Adopted (declared so the pack loads alone; owned elsewhere) \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
% day_number/1 is the CLOCK, and it is the host's through GameTruthSync \u2014 this
% module reads it and never writes it, exactly as the routine pack does.
:- dynamic(day_number/1).

% \u2500\u2500 The wheel of the year \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500

% Which season an absolute day falls in. The whole calendar is this one rule:
% fold the day into the year, then find the span that contains it. Integer
% arithmetic only, and mod is floor-based, so day 0 and a day before the epoch
% both land inside the year rather than outside it.
%
% The day must be BOUND, exactly as candidate_action/3 requires its agent: an
% unbound day would ask the engine to enumerate the integers.
season_of_day(Day, S) :-
  nonvar(Day),
  year_length(L),
  L > 0,
  D is Day mod L,
  season_start(S, Start),
  season_length(S, Len),
  D >= Start,
  End is Start + Len,
  D < End.

% How far into its season that day is, counting from 0.
season_day_of(Day, N) :-
  season_of_day(Day, S),
  year_length(L),
  D is Day mod L,
  season_start(S, Start),
  N is D - Start.

% The season after this one, wrapping at the turn of the year. By the resolved
% start and length rather than by season_order/2, so a world that numbers its
% seasons 0, 10, 20 means the same thing as one that numbers them 0, 1, 2.
season_next(S, T) :-
  season_start(S, Start),
  season_length(S, Len),
  year_length(L),
  L > 0,
  Next is (Start + Len) mod L,
  season_start(T, Next).

% \u2500\u2500 What a season can bring \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500

% A condition this season brings at all. Weight 0 is a real answer and the
% reason this is a rule rather than a lookup: a world that authors snow at 0 in
% summer has SAID something, and an engine that treated every authored row as
% possible would give a July blizzard.
weather_possible(S, C) :-
  weather_kind(C),
  weather_chance(S, C, W),
  W > 0.

% \u2500\u2500 What the sky is doing \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500

% Harsh weather: above the authored threshold, never at it. A world that
% authors no threshold has no harsh weather, which is the right direction \u2014
% inventing one would make every unconfigured world's winter dangerous.
weather_harsh(C) :-
  weather_severity(C, V),
  weather_harsh_above(T),
  V > T.

% The severity of what the sky is doing right now, for a rule that wants the
% number rather than the name.
weather_severity_now(V) :-
  weather(C),
  weather_severity(C, V).

% An action the current sky closes. This is the whole of what weather DOES to
% behaviour, said as a query; the clause below is the same thing said to the
% gate.
weather_bars_now(Act) :-
  weather(C),
  weather_bars(C, Act).

% \u2500\u2500 The gate's input \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
% One more clause for forbids/4, and no change to anything that reads it.
% permissible/3, forbidden_by/4 and the utility layer are untouched: an actor
% cannot set out across the pass in a blizzard because content authored what a
% blizzard closes, not because the gate learned about the sky.
%
% The RULE ID is the condition itself, so forbidden_by/4 reports 'blizzard'
% rather than a synthetic rule atom \u2014 the reason a refusal is legible at all.
% It binds nobody in particular, because weather binds everybody: there is no
% actor argument on the right-hand side and that is the claim, not an omission.
forbids(C, _A, Act, _T) :-
  weather(C),
  weather_bars(C, Act).
`;
  var WEATHER_AREA = "weather";
  var WEATHER_AUTHORED_PREDICATES = Object.freeze([
    "season_order/2",
    "season_length/2",
    "season_start/2",
    "year_length/1",
    "weather_kind/1",
    "weather_chance/3",
    "weather_severity/2",
    "weather_bars/2",
    "weather_harsh_above/1"
  ]);
  var WEATHER_RUNTIME_PREDICATES = Object.freeze([
    "weather/1",
    "season/1",
    "weather_day/1"
  ]);
  var WEATHER_PACK = Object.freeze({
    area: WEATHER_AREA,
    prolog: WEATHER_PREDICATES_PROLOG,
    runtimePredicates: WEATHER_RUNTIME_PREDICATES
  });
  var WEATHER_PREDICATE_PACKS = Object.freeze([
    WEATHER_PACK
  ]);

  // @insimul/core/src/scaffold/scaffold-predicates.ts
  var SCAFFOLD_PREDICATES_PROLOG = `
% \u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550
% Whole-game scaffolding \u2014 the pacing and the endings, evaluated
% packages/core/docs/whole-game-scaffolding.md \xA77
%
% The authored facts are src/scaffold/scaffold-document.ts's sixteen; the rules
% here are the only thing in the build that READS a gate. Nothing below names a
% mechanic, a threshold or an ending: a scaffold that needed a rule of its own
% per genre would be a game designer, which \xA75 of the design refuses.
% \u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550

% \u2500\u2500 Authored facts (the scaffold document \u2014 world content, never in a save) \u2500
% scaffold(ScaffoldId) \u2014 the scaffold itself.
% scaffold_genre/2, scaffold_world/2, scaffold_seed/2 \u2014 provenance.
% scaffold_module(S, ModuleId) \u2014 the mechanics this game HAS.
% scaffold_start_place/2, scaffold_start_role/2, scaffold_start_time/2 \u2014 where
%   the player begins, as what, and when.
% scaffold_start_because(S, Goal) \u2014 a goal that was true of the world when the
%   start was chosen. Evidence a creator can re-read and a rule can re-check.
% scaffold_objective(S, Key, Source, Ref, Order) \u2014 one initial objective, by
%   reference to the machinery that owns it (quest / radiant / arc).
% scaffold_stage(S, Stage, Order), scaffold_stage_gate(S, Stage, Goal),
%   scaffold_stage_unlocks(S, Stage, ObjectiveKey) \u2014 the pacing.
% scaffold_ending(S, Key, Outcome), scaffold_ending_when(S, Key, Goal) \u2014 what
%   finishes this game, and on what.
% scaffold_edited(S, Section) \u2014 the section a creator has taken over.
:- dynamic(scaffold/1).
:- dynamic(scaffold_genre/2).
:- dynamic(scaffold_world/2).
:- dynamic(scaffold_seed/2).
:- dynamic(scaffold_module/2).
:- dynamic(scaffold_start_place/2).
:- dynamic(scaffold_start_role/2).
:- dynamic(scaffold_start_time/2).
:- dynamic(scaffold_start_because/2).
:- dynamic(scaffold_objective/5).
:- dynamic(scaffold_stage/3).
:- dynamic(scaffold_stage_gate/3).
:- dynamic(scaffold_stage_unlocks/3).
:- dynamic(scaffold_ending/3).
:- dynamic(scaffold_ending_when/3).
:- dynamic(scaffold_edited/2).

% \u2500\u2500 Runtime facts (per playthrough) \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
% scaffold_active(ScaffoldId) \u2014 which scaffold this playthrough is running.
% The ONLY thing this layer remembers. Which stage is open, which objectives
% are available and whether the game has ended are questions about the world,
% and the world already answers them; a second copy could disagree.
:- dynamic(scaffold_active/1).

% \u2500\u2500 The meta-call \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500

% Does this authored goal hold right now?
%
% Every gate, ending and justification below is reached through here, and the
% catch is load-bearing: a goal naming a predicate no active pack defines
% RAISES under ISO rather than failing, so a mechanic the creator switched off
% would end a playthrough with an existence error instead of a closed gate.
scaffold_holds(G) :- catch(call(G), _, fail).

% \u2500\u2500 Which scaffold is in play \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500

% The running scaffold: the one a host declared, or \u2014 in a KB carrying exactly
% the scaffold it was built from \u2014 that one. Semidet either way, so a host that
% never declares one still gets an answer rather than an enumeration.
scaffold_in_play(S) :- scaffold_active(S), !, scaffold(S).
scaffold_in_play(S) :- \\+ scaffold_active(_), scaffold(S), !.

% Where the player begins, as one question.
scaffold_start(S, Place, Role, Time) :-
  scaffold_start_place(S, Place),
  scaffold_start_role(S, Role),
  scaffold_start_time(S, Time).

% A reason the start was chosen for that is no longer true of the world.
%
% Not an error \u2014 worlds move, and a mayor dying does not invalidate a start.
% It is the question a creator regenerating a scaffold wants answered, and it
% is only askable because US-1 stored the reasoning rather than the result.
scaffold_start_unjustified(S, Goal) :-
  scaffold_start_because(S, Goal),
  \\+ scaffold_holds(Goal).

% \u2500\u2500 Pacing \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500

% A stage whose gate holds. The gate is a GOAL, so faction standing, genealogy
% and the world clock reach this slot exactly as a quest count does, and
% nothing here knows the difference.
scaffold_stage_open(S, Stage) :-
  scaffold_stage(S, Stage, _),
  scaffold_stage_gate(S, Stage, Gate),
  scaffold_holds(Gate).

scaffold_stage_blocked(S, Stage) :-
  scaffold_stage(S, Stage, _),
  \\+ scaffold_stage_open(S, Stage).

% The furthest-along open stage \u2014 what a host shows as "where you are".
% Defined by the authored ORDER and not by arrival, because a gate that closes
% again (a faction made peace) must be able to take the game back a step.
scaffold_current_stage(S, Stage) :-
  scaffold_stage_open(S, Stage),
  scaffold_stage(S, Stage, N),
  \\+ ( scaffold_stage_open(S, Other),
        scaffold_stage(S, Other, M),
        M > N ).

% \u2500\u2500 Objectives \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500

scaffold_objective_gated(S, Key) :- scaffold_stage_unlocks(S, _, Key).

% Semidet on purpose: two open stages unlocking one objective is an authoring
% choice, not two objectives, and a duplicate solution here would double it in
% every list a host draws.
scaffold_objective_unlocked(S, Key) :- \\+ scaffold_objective_gated(S, Key), !.
scaffold_objective_unlocked(S, Key) :-
  scaffold_stage_unlocks(S, Stage, Key),
  scaffold_stage_open(S, Stage),
  !.

scaffold_objective_available(S, Key) :-
  scaffold_objective(S, Key, _, _, _),
  scaffold_objective_unlocked(S, Key).

scaffold_objective_locked(S, Key) :-
  scaffold_objective(S, Key, _, _, _),
  \\+ scaffold_objective_unlocked(S, Key).

% How much of the game is open. Total is what the scaffold seeded, so a
% progress readout can never promise more than exists.
scaffold_progress(S, Available, Total) :-
  scaffold(S),
  findall(A, scaffold_objective_available(S, A), Open),
  length(Open, Available),
  findall(T, scaffold_objective(S, T, _, _, _), All),
  length(All, Total).

% \u2500\u2500 Endings \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500

% An end condition that has been met, and what reaching it means.
scaffold_ending_reached(S, Key, Outcome) :-
  scaffold_ending(S, Key, Outcome),
  scaffold_ending_when(S, Key, When),
  scaffold_holds(When).

% Is this game finished? Semidet \u2014 a world may satisfy two endings at once and
% that is still one finished game.
scaffold_over(S) :- scaffold_ending_reached(S, _, _), !.

% What the finished game was. Enumerates when more than one ending holds: which
% of them the host announces is a presentation decision, and the authored order
% is the answer core hands it rather than one it invents here.
scaffold_outcome(S, Outcome) :- scaffold_ending_reached(S, _, Outcome).
`;
  var SCAFFOLD_AREA = "scaffold";
  var SCAFFOLD_AUTHORED_PREDICATES = Object.freeze([
    "scaffold/1",
    "scaffold_genre/2",
    "scaffold_world/2",
    "scaffold_seed/2",
    "scaffold_module/2",
    "scaffold_start_place/2",
    "scaffold_start_role/2",
    "scaffold_start_time/2",
    "scaffold_start_because/2",
    "scaffold_objective/5",
    "scaffold_stage/3",
    "scaffold_stage_gate/3",
    "scaffold_stage_unlocks/3",
    "scaffold_ending/3",
    "scaffold_ending_when/3",
    "scaffold_edited/2"
  ]);
  var SCAFFOLD_RUNTIME_PREDICATES = Object.freeze([
    "scaffold_active/1"
  ]);
  var SCAFFOLD_RULE_PREDICATES = Object.freeze([
    "scaffold_holds/1",
    "scaffold_in_play/1",
    "scaffold_start/4",
    "scaffold_start_unjustified/2",
    "scaffold_stage_open/2",
    "scaffold_stage_blocked/2",
    "scaffold_current_stage/2",
    "scaffold_objective_gated/2",
    "scaffold_objective_unlocked/2",
    "scaffold_objective_available/2",
    "scaffold_objective_locked/2",
    "scaffold_progress/3",
    "scaffold_ending_reached/3",
    "scaffold_over/1",
    "scaffold_outcome/2"
  ]);
  var SCAFFOLD_PACK = Object.freeze({
    area: SCAFFOLD_AREA,
    prolog: SCAFFOLD_PREDICATES_PROLOG,
    runtimePredicates: SCAFFOLD_RUNTIME_PREDICATES
  });
  var SCAFFOLD_PREDICATE_PACKS = Object.freeze([
    SCAFFOLD_PACK
  ]);

  // @insimul/core/src/prolog/mechanics/combat-predicates.ts
  var COMBAT_PREDICATES_PROLOG = `
% \u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550
% Combat \u2014 reach, legality and effectiveness
% docs/mechanic-predicates.md \xA74
% \u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550

% \u2500\u2500 Authored facts (world content \u2014 never in a save) \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
% faction(EntityId, FactionId).
% faction_stance(FactionA, FactionB, hostile|neutral|allied).
% resists_damage(EntityId, DamageType) / vulnerable_to(EntityId, DamageType) \u2014
%   DamageType is an atom the WORLD declares (slashing, fire, silver, \u2026); core
%   fixes no list, because the set is content.
:- dynamic(faction/2).
:- dynamic(faction_stance/3).
:- dynamic(resists_damage/2).
:- dynamic(vulnerable_to/2).

% \u2500\u2500 Runtime facts (per playthrough \u2014 save.currentState.prologFacts) \u2500\u2500\u2500\u2500\u2500\u2500\u2500
% in_combat/1, combat_target/2, threat/3 and incapacitated/1 differ between two
% playthroughs of the same world, so authoring any of them on a world template
% is a design error, not a schema entry (\xA73).
:- dynamic(in_combat/1).
:- dynamic(combat_target/2).
:- dynamic(threat/3).
:- dynamic(incapacitated/1).

% \u2500\u2500 Facts owned elsewhere that these rules read \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
% alive/1 is the character block's (see the module header); near/3 and
% has_equipped/3 are runtime gameplay state (\xA710.1); item_range/2 and
% item_damage_type/2 are authored weapon stats on the item block.
% Declared here so this pack answers "no" instead of raising in a KB that
% carries none of them.
:- dynamic(alive/1).
:- dynamic(near/3).
:- dynamic(has_equipped/3).
:- dynamic(item_range/2).
:- dynamic(item_damage_type/2).

% \u2500\u2500 Rules \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500

% Hostility is a property of the factions, not of the pair: two members of
% mutually hostile factions are hostile without anyone authoring the pair.
hostile_to(A, B) :-
  faction(A, FA),
  faction(B, FB),
  faction_stance(FA, FB, hostile).

% A legal target: still standing, not already down, and an enemy. incapacitated/1
% is deliberately distinct from dead/1 \u2014 "down but not dead" is its own decision
% state (lootable, untalkable, and NOT a legal attack target).
can_attack(A, T) :-
  alive(T),
  \\+ incapacitated(T),
  hostile_to(A, T).

% "You may only swing at something you can actually reach with what you're
% holding." W is the weapon that reaches, so a caller can name it.
in_reach(A, T, W) :-
  has_equipped(A, weapon, W),
  item_range(W, R),
  near(A, T, R).

% The weapon's damage type means something against this target. The world
% authors what resists what; core owns no damage formula.
effective_against(W, T) :-
  item_damage_type(W, DT),
  \\+ resists_damage(T, DT).
`;
  var COMBAT_RUNTIME_PREDICATES = [
    "in_combat/1",
    "combat_target/2",
    "threat/3",
    "incapacitated/1"
  ];

  // @insimul/core/src/prolog/mechanics/perception-predicates.ts
  var PERCEPTION_PREDICATES_PROLOG = `
% \u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550
% Stealth and perception \u2014 detection and trespass
% docs/mechanic-predicates.md \xA75
% \u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550

% \u2500\u2500 Authored facts (world content \u2014 never in a save) \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
% senses(EntityId, sight|hearing|smell, Range) \u2014 what this creature can use.
% restricted_area(LocationId) / access_permitted(Actor, LocationId): "the
%   innkeeper's family may enter the back room" is a fact about the WORLD, not
%   about a playthrough, so both are authored. A key picked up mid-game asserts
%   nothing here \u2014 a trespass rule reads has/2 separately.
:- dynamic(senses/3).
:- dynamic(restricted_area/1).
:- dynamic(access_permitted/2).

% \u2500\u2500 Runtime facts (per playthrough) \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
% line_of_sight/2 is HOST-SUPPLIED: the engine raycasts and asserts it.
% light_level/2 is runtime and not authored on purpose (\xA73's test case): a cave's
%   darkness looks like template data, but the value that decides the query is
%   the one at query time \u2014 night, a doused torch, a spell.
% Level is 0\u2013100 for both noise_level/2 and light_level/2.
:- dynamic(line_of_sight/2).
:- dynamic(concealed/1).
:- dynamic(noise_level/2).
:- dynamic(light_level/2).
:- dynamic(alerted/2).

% \u2500\u2500 The graded detection state (per playthrough) \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
% awareness(Observer, Target, Level) \u2014 0\u2013100, accumulated over ticks by
%   game-engine/logic/DetectionTracker.ts out of what the host's senses reported.
% detection_state(Observer, Target, unaware|suspicious|searching|alerted).
:- dynamic(awareness/3).
:- dynamic(detection_state/3).

% \u2500\u2500 Authored bands (world content \u2014 published at load, never in a save) \u2500\u2500\u2500\u2500
% detection_threshold(suspicious|searching|alerted, Level) \u2014 the world's
%   thresholds, out of WorldIR.perception, the way stamina_threshold/2 is (\xA79).
:- dynamic(detection_threshold/2).

% \u2500\u2500 Facts owned elsewhere that these rules read \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
:- dynamic(near/3).
:- dynamic(at_location/2).

% \u2500\u2500 Rules \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500

% Detection, and the sense that produced it. detects_via/3 is the one that
% carries the reason; detects/2 is the question every authored rule asks.
detects(O, T) :- detects_via(O, T, _).

detects_via(O, T, sight) :-
  senses(O, sight, R),
  near(O, T, R),
  line_of_sight(O, T),
  \\+ concealed(T),
  at_location(T, L),
  light_level(L, Lx),
  Lx >= 20.

detects_via(O, T, hearing) :-
  senses(O, hearing, R),
  near(O, T, R),
  noise_level(T, N),
  N >= 30.

% Nobody detects T. Written over detects/2 so a new sense clause tightens it
% automatically.
unseen(T) :- \\+ detects(_, T).

% Somewhere you are not allowed to be. Being SEEN there is a separate question \u2014
% the guard's rule conjoins trespassing/2 with detects/2 (\xA75).
trespassing(A, L) :-
  at_location(A, L),
  restricted_area(L),
  \\+ access_permitted(A, L).

% \u2500\u2500 The rungs of the ladder \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
% Named, so an authored rule says "the guard is searching for the thief" rather
% than comparing a number to a band it would have to know the value of.
suspicious_of(O, T) :- detection_state(O, T, suspicious).

searching_for(O, T) :- detection_state(O, T, searching).

% alerted/2 stays dynamic \u2014 a scripted alarm or a quest script asserts it \u2014 AND
% is derived from the ladder, so a graded state and the boolean every existing
% rule already asks can never contradict each other.
alerted(O, T) :- detection_state(O, T, alerted).

% Noticed at all: any rung above unaware. Written over detection_state/3 so a
% world that adds a rung gets it here for free.
noticed(O, T) :-
  detection_state(O, T, S),
  S \\== unaware.

% Nobody has noticed T. unseen/1 asks that of THIS instant's sensing;
% undetected/1 asks it of the accumulated state, which is the one a stealth
% mechanic actually pays out on.
undetected(T) :- \\+ noticed(_, T).
`;
  var PERCEPTION_RUNTIME_PREDICATES = [
    "line_of_sight/2",
    "concealed/1",
    "noise_level/2",
    "light_level/2",
    "alerted/2",
    "awareness/3",
    "detection_state/3"
  ];

  // @insimul/core/src/prolog/mechanics/skill-predicates.ts
  var SKILL_PREDICATES_PROLOG = `
% \u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550
% Skills \u2014 what exists, what it costs, what it requires
% docs/mechanic-predicates.md \xA76
% \u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550

% \u2500\u2500 Authored facts (world content \u2014 never in a save) \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
% skill_defined(SkillId, Category).
% skill_max_level(SkillId, Max).
% skill_requires(SkillId, PrereqSkillId, MinLevel).
% skill_level_xp(SkillId, Level, XpNeeded) \u2014 the progression CURVE, kept in
%   content. Without it the curve is a constant in four engines and the same
%   save levels up in three of them.
:- dynamic(skill_defined/2).
:- dynamic(skill_max_level/2).
:- dynamic(skill_requires/3).
:- dynamic(skill_level_xp/3).

% \u2500\u2500 Runtime facts (per playthrough) \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
:- dynamic(skill_xp/3).

% \u2500\u2500 Facts owned elsewhere that these rules read \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
:- dynamic(has_skill/3).

% \u2500\u2500 Rules \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500

% At the world's cap for this skill.
skill_capped(A, S) :-
  has_skill(A, S, L),
  skill_max_level(S, L).

% A skill the world declares, that this actor does not have yet, and whose every
% prerequisite is met. The double negation is "no prerequisite is unmet", so a
% skill with no skill_requires/3 facts qualifies.
can_learn_skill(A, S) :-
  skill_defined(S, _),
  \\+ has_skill(A, S, _),
  \\+ (skill_requires(S, P, Min), \\+ (has_skill(A, P, L), L >= Min)).

% Enough XP banked for the next level, and not already capped.
can_advance(A, S) :-
  has_skill(A, S, L),
  \\+ skill_capped(A, S),
  Next is L + 1,
  skill_level_xp(S, Next, Need),
  skill_xp(A, S, X),
  X >= Need.

% \u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550
% Skill trees \u2014 nodes, what they ask, what they cost, what they do
% US-1 of 123-skill-trees-and-progression
% \u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550

% \u2500\u2500 Authored facts (world content \u2014 never in a save) \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
% skill_tree(TreeId, SkillId) \u2014 the skill whose levels FUND this tree. It is
%   the whole coupling between the two halves of progression: advancing
%   smithing grants points to the trees rooted on smithing, and nothing else
%   does. A guild or faction tree is authored the same way over a standing.
% skill_node(NodeId, TreeId).
% skill_node_cost(NodeId, Points).
% skill_node_requires(NodeId, Goal) \u2014 Goal is a Prolog goal evaluated with the
%   actor bound, the convention traversal_requires/3 uses. An authored parent
%   edge arrives here as skill_node_requires(N, skill_unlocked(Actor, Parent)),
%   so tree structure and an arbitrary condition are ONE gate.
% skill_node_effect(NodeId, Effect) \u2014 what taking it does, as a term:
%   unlocks(Action), modifies(Param, Amount), permits(Thing). The set is
%   authored; a world that wants a fourth writes it and a rule reads it.
:- dynamic(skill_tree/2).
:- dynamic(skill_node/2).
:- dynamic(skill_node_cost/2).
:- dynamic(skill_node_requires/2).
:- dynamic(skill_node_effect/2).

% \u2500\u2500 Runtime facts (per playthrough) \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
% What is unspent, per tree, and what has been taken. Both are per-playthrough:
% two saves of one world differ by exactly this (\xA73).
:- dynamic(skill_points/3).
:- dynamic(skill_unlocked/2).

% \u2500\u2500 Rules \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500

% An authored requirement is written with the ACTOR as its first argument \u2014
% skill_node_requires(guild_forge, reputation(Actor, smiths_guild, 50)). That
% variable is a FRESH one every time the fact is read, so it is not the caller's
% actor and call/1 on the term as stored would be satisfied by anybody at all
% with the standing \u2014 one guild member's reputation unlocking the whole roster's
% node. The goal is therefore rebuilt with A in the first argument position
% before it is called. A requirement authored as a plain atom (bridge_repaired)
% says nothing about the actor and is called as written.
skill_goal_met(_, Goal) :-
  atom(Goal),
  !,
  call(Goal).
skill_goal_met(A, Goal) :-
  Goal =.. [F, _ | Rest],
  Bound =.. [F, A | Rest],
  call(Bound).

% What a node costs. A loaded world publishes a cost for every node (the
% world's default applied), so the second clause is what keeps the pack
% answerable about a tree asserted by hand.
skill_node_price(N, C) :- skill_node_cost(N, C), !.
skill_node_price(N, 0) :- skill_node(N, _).

% What is unspent in a tree the actor has never earned a point in.
skill_points_held(A, T, P) :- skill_points(A, T, P), !.
skill_points_held(_, T, 0) :- skill_tree(T, _).

% A node this actor has not taken, can pay for, and whose every requirement
% holds. The double negation is "no requirement is unmet", so a node with no
% skill_node_requires/2 fact qualifies. Whether it is PERMITTED is forbids/4's,
% exactly as a climb's is: a guild's own rules refuse an unlock without this
% rule knowing that guilds exist.
can_unlock(A, N) :-
  skill_node(N, T),
  \\+ skill_unlocked(A, N),
  skill_node_price(N, C),
  skill_points_held(A, T, P),
  P >= C,
  \\+ (skill_node_requires(N, G), \\+ skill_goal_met(A, G)).

% What an actor's skills DO \u2014 the one thing another module asks. A module reads
% effects; it never reads nodes, which is what keeps a skill tree data over
% combat, traversal and crafting rather than a system inside them.
skill_effect(A, E) :- skill_unlocked(A, N), skill_node_effect(N, E).
`;
  var SKILL_RUNTIME_PREDICATES = [
    "skill_xp/3",
    "skill_points/3",
    "skill_unlocked/2"
  ];

  // @insimul/core/src/prolog/mechanics/traversal-predicates.ts
  var TRAVERSAL_PREDICATES_PROLOG = `
% \u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550
% Traversal \u2014 links, blockage, and reachability
% docs/mechanic-predicates.md \xA77
% \u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550

% \u2500\u2500 Authored facts (world content \u2014 never in a save) \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
% traversal_link(FromLoc, ToLoc, walk|climb|swim|ride|boat) \u2014 DIRECTED. Mode is
%   authored, and it is where mounts and boats land: the decision layer's whole
%   interest in a boat is "this link needs boat and you have it", so there is no
%   vehicle vocabulary (\xA712).
% traversal_cost(FromLoc, ToLoc, Cost) \u2014 read by authored rules (travel time,
%   stamina spend); the pack imposes no cost model of its own.
% traversal_requires(FromLoc, ToLoc, Goal) \u2014 Goal is a Prolog goal evaluated
%   with Actor bound, the same convention radiant_precondition/3 uses.
:- dynamic(traversal_link/3).
:- dynamic(traversal_cost/3).
:- dynamic(traversal_requires/3).

% \u2500\u2500 Runtime facts (per playthrough) \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
% "The landslide closed the pass" is a playthrough event, never world content.
:- dynamic(traversal_blocked/2).
:- dynamic(movement_mode/2).

% \u2500\u2500 Rules \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500

% Pack-local, library-free membership (see the module header).
traversal_member(X, [X|_]).
traversal_member(X, [_|T]) :- traversal_member(X, T).

% An authored requirement is written with the ACTOR as its first argument \u2014
% traversal_requires(camp, ford, has_item(Actor, rope, 1)). That variable is a
% FRESH one every time the fact is read, so it is not the caller's actor and
% call/1 on the term as stored would be satisfied by anyone at all holding a
% rope. The goal is therefore rebuilt with A in the first argument position
% before it is called. A requirement authored as a plain atom (bridge_repaired)
% says nothing about the actor and is called as written.
traversal_goal_met(_, Goal) :-
  atom(Goal),
  !,
  call(Goal).
traversal_goal_met(A, Goal) :-
  Goal =.. [F, _ | Rest],
  Bound =.. [F, A | Rest],
  call(Bound).

% One link, open, in a mode this actor is using, whose requirement (if any)
% holds. The \\+ (Requirement, \\+ Met) shape means a link with no
% traversal_requires/3 fact passes; calling an authored goal is the trust
% boundary radiant_precondition/3 already accepts.
can_traverse(A, From, To) :-
  traversal_link(From, To, Mode),
  \\+ traversal_blocked(From, To),
  movement_mode(A, Mode),
  \\+ (traversal_requires(From, To, Goal), \\+ traversal_goal_met(A, Goal)).

% Reachability over one or more links. Cycle-safe by carrying the visited set,
% so a loop of links terminates instead of spinning.
reachable(A, From, To) :- reachable_via(A, From, To, [From]).

reachable_via(A, From, To, _) :- can_traverse(A, From, To).
reachable_via(A, From, To, Seen) :-
  can_traverse(A, From, Mid),
  \\+ traversal_member(Mid, Seen),
  reachable_via(A, Mid, To, [Mid | Seen]).

% \u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550
% Vehicles \u2014 ridden entities, in the same vocabulary
% US-2 of 122-traversal-and-travel
% \u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550

% \u2500\u2500 Authored \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
% vehicle_mode(VehicleId, ride|boat|...) \u2014 what the thing IS, said as the
%   traversal mode it lends whoever is driving it. \xA712 cut vehicle/1 and that cut
%   stands: a kind predicate would say strictly less than this one does.
:- dynamic(vehicle_mode/2).

% \u2500\u2500 Runtime (per playthrough) \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
% Ownership is runtime because a horse is bought, inherited, confiscated and
% stolen; the world's authored owner is where the playthrough STARTS (\xA73).
% at_location/2 is the world-state predicate, not a vehicle-private one: a
% vehicle is an entity, and a rule asking what is at the dock must see the boat.
:- dynamic(vehicle_owner/2).
:- dynamic(vehicle_occupant/2).
:- dynamic(vehicle_driver/2).
:- dynamic(at_location/2).

% \u2500\u2500 Rules \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500

% The mode a vehicle lends its driver \u2014 the ONLY thing a vehicle changes about
% traversal, and the reason there is no vehicle mechanic beside this one. A
% passenger is carried; the driver is the one movement_mode/2 becomes true of.
riding_mode(A, Mode) :- vehicle_driver(V, A), vehicle_mode(V, Mode).

% Boarding: same place, not already aboard. Colocation is asked of the location
% ATOMS \u2014 "three metres from the horse" is the host's question, not this one's.
% Capacity is deliberately absent: \xA712 cut vehicle_capacity/2, so a world that
% wants to know whether the cart is full counts vehicle_occupant/2 itself.
can_board(A, V) :-
  vehicle_mode(V, _),
  at_location(V, L),
  at_location(A, L),
  \\+ vehicle_occupant(V, A).

% Taking the reins: aboard, and nobody else at the helm. Permission is NOT here
% \u2014 whether taking somebody else's cart is a crime is forbids/4's answer, which
% is what lets one world police the roads and another leave them common.
can_drive(A, V) :-
  vehicle_occupant(V, A),
  \\+ (vehicle_driver(V, Other), Other \\== A).

% Nobody has the reins \u2014 what an NPC's candidate_action/3 keys on to notice that
% the cart at the mill is there for the taking.
vehicle_unattended(V) :- vehicle_mode(V, _), \\+ vehicle_driver(V, _).

% "It is not theirs" \u2014 the FACT a theft norm is authored over
% (rule_applies(cart_theft, Actor, V) :- vehicle_not_owned_by(Actor, V)). A
% vehicle nobody owns is nobody's to steal, so an absent owner FAILS rather than
% succeeds: core states ownership and never invents a prohibition.
vehicle_not_owned_by(A, V) :- vehicle_owner(V, Owner), Owner \\== A.

% \u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550
% Fast travel \u2014 you may go where you have BEEN and can still GET to
% US-3 of 122-traversal-and-travel
% \u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550

% location_discovered/1 is gameplay-predicates.ts's, already asserted whenever a
% player reaches somewhere. It is DECLARED here rather than re-minted as a
% traversal-private "known destination" fact, for \xA710.1's reason: two vocabularies
% for one fact is how a place discovered through a rumour, a map or a quest stops
% counting as discovered for travel.
:- dynamic(location_discovered/1).

% \xA77's own worked example, promoted from an authored can_perform/2 clause to a
% pack rule because the decision layer asks it: fast travel is gated by DISCOVERY
% and by REACHABILITY, and reachability is what makes it a world operation rather
% than a teleport \u2014 you cannot fast travel past a landslide you could not have
% walked past, and a route that needs a rope needs the rope either way.
%
% Whether it is PERMITTED is forbids/4's, exactly as a climb's is, and is not here:
% a closed border, a quarantine and 123's skill gates refuse a journey without this
% rule knowing they exist. What is also not here is time \u2014 how long the journey
% takes is arithmetic over traversal_cost/3 and belongs in src/traversal/, never in
% a predicate a save could carry a stale copy of.
can_fast_travel(A, Dest) :-
  location_discovered(Dest),
  at_location(A, Here),
  Here \\== Dest,
  reachable(A, Here, Dest).
`;
  var TRAVERSAL_RUNTIME_PREDICATES = [
    "traversal_blocked/2",
    "movement_mode/2",
    "vehicle_owner/2",
    "vehicle_occupant/2",
    "vehicle_driver/2"
  ];

  // @insimul/core/src/prolog/mechanics/equipment-predicates.ts
  var EQUIPMENT_PREDICATES_PROLOG = `
% \u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550
% Equipment \u2014 slots, requirements, weight and armour
% docs/mechanic-predicates.md \xA78
% \u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550

% \u2500\u2500 Authored facts (world content \u2014 never in a save) \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
% equip_slot(ItemId, Slot) / equip_slot_capacity(Slot, N) \u2014 "two rings, not five".
% item_requires(ItemId, SkillId, MinLevel) \u2014 "heavy plate isn't something you
%   just put on".
:- dynamic(equip_slot/2).
:- dynamic(equip_slot_capacity/2).
:- dynamic(item_requires/3).

% \u2500\u2500 Runtime facts (per playthrough) \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
:- dynamic(carry_capacity/2).
:- dynamic(item_condition/2).

% \u2500\u2500 Facts owned elsewhere that these rules read \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
% has_equipped/3 and has_item/3 are runtime gameplay state; item_weight/2 and
% item_armor/2 are authored stats on the item block.
:- dynamic(has_equipped/3).
:- dynamic(has_item/3).
:- dynamic(has_skill/3).
:- dynamic(item_weight/2).
:- dynamic(item_armor/2).

% \u2500\u2500 Rules \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500

% The compat bridge for helper-predicates.ts's objective_complete/3 clauses \u2014
% note the argument order differs from has_equipped/3, which is why this rule
% exists at all (\xA710.3).
equipped(Actor, Item, Slot) :- has_equipped(Actor, Slot, Item).

% Pack-local total. findall/3 and length/2 are ISO builtins the shared engine
% has; aggregate_all/3 is NOT (it lives in library(aggregate), which a pack may
% not depend on \u2014 see the module header), and the name is prefixed so this pack
% cannot shadow a builtin the way sum_list/2 once did.
equipment_sum([], 0).
equipment_sum([X | T], S) :-
  equipment_sum(T, S0),
  S is S0 + X.

% Room left in a slot the world gave a capacity to.
slot_free(A, Slot) :-
  equip_slot_capacity(Slot, N),
  findall(I, has_equipped(A, Slot, I), Equipped),
  length(Equipped, Used),
  Used < N.

% Held, has a slot, the slot has room, and every skill requirement is met. The
% comparison is inline rather than helper-predicates.ts's skill_gte/3 so this
% pack consults standalone (see the module header).
can_equip(A, I) :-
  has_item(A, I, _),
  equip_slot(I, Slot),
  slot_free(A, Slot),
  \\+ (item_requires(I, S, Min), \\+ (has_skill(A, S, L), L >= Min)).

% Everything carried, by weight. A rule and not a fact: a stored total goes
% stale against has_item/3 the moment anything is picked up (\xA712). An actor
% carrying nothing weighs 0 rather than failing, so a caller never has to
% distinguish "empty" from "unknown".
carried_weight(A, W) :-
  findall(Wi, (has_item(A, I, Q), item_weight(I, U), Wi is U * Q), Weights),
  equipment_sum(Weights, W).

encumbered(A) :-
  carried_weight(A, W),
  carry_capacity(A, Max),
  W > Max.

% Armour from everything worn, whatever slot it is in.
armor_value(A, V) :-
  findall(Av, (has_equipped(A, _, I), item_armor(I, Av)), Values),
  equipment_sum(Values, V).

% \u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550
% Trade \u2014 who sells what, whether the shelf is bare, and who is paid
% docs/mechanic-predicates.md \xA78, US-2 of 124-items-equipment-economy
% \u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550

% \u2500\u2500 Authored facts (world content \u2014 never in a save) \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
% vendor(VendorId, BusinessId) \u2014 who trades, and on whose behalf. A vendor
%   trading for themselves is said with their own atom in both places, so
%   vendor(V, B), business_owner(B, O) is one query rather than two shapes.
% vendor_markup(BusinessId, Percent) \u2014 the SHOP's margin: the business sets the
%   price and the clerk does not.
% item_stock_normal(ItemId, Qty) \u2014 what a well-supplied shelf carries. Scarcity
%   is meaningless without it: three left is a glut of warhorses and a famine of
%   arrows.
% item_loot_weight(ItemId, Weight) \u2014 how likely the thing is to turn up at all.
:- dynamic(vendor/2).
:- dynamic(vendor_markup/2).
:- dynamic(item_stock_normal/2).
:- dynamic(item_loot_weight/2).

% \u2500\u2500 Facts owned elsewhere that these rules read \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
% gold/2 belongs to the gameplay-state block and predates this pack; it is
% declared here so this pack stands alone, exactly as has_item/3 above is, and
% gameplay-state-predicates.ts is what OWNS the signature (\xA710.1).
:- dynamic(gold/2).
% A merchant's shelf is a CONTAINER: container_contains/3 already says "this
% many of that, in that place", and a shelf is a place \u2014 so trade mints no
% stock predicate of its own. business_owner/2 is the business block's.
:- dynamic(container_contains/3).
:- dynamic(business_owner/2).
:- dynamic(item_tradeable/1).

% \u2500\u2500 Rules \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500

% What is on the shelf, with "none" as an answer rather than a failure \u2014 the
% same stance carried_weight/2 takes, so a caller never has to distinguish
% "empty" from "unknown".
stock_level(V, I, Q) :-
  container_contains(V, I, Q),
  !.
stock_level(_, _, 0).

in_stock(V, I, Q) :-
  vendor(V, _),
  stock_level(V, I, Q),
  Q > 0.

% Availability: they have one AND it is merchandise. A quest letter in a
% merchant's pack is not for sale.
sells(V, I) :-
  in_stock(V, I, _),
  item_tradeable(I).

% Fewer on the shelf than the world calls a normal stock. HOW MUCH that costs is
% arithmetic and stays out of the vocabulary (\xA711) \u2014 src/items/economy.ts \u2014 for
% the reason \xA712 gives: a stored price goes stale the moment a shelf moves.
scarce(V, I) :-
  vendor(V, _),
  item_stock_normal(I, N),
  stock_level(V, I, Q),
  Q < N.

% Who the money belongs to. A vendor with no separate owner is their own.
proceeds_to(V, Owner) :-
  vendor(V, B),
  business_owner(B, Owner),
  !.
proceeds_to(V, V) :-
  vendor(V, _).

% Whether a purse covers an amount. Named can_pay/2 rather than can_afford/2
% because the latter belongs to the ToTT economics vocabulary and a pack may not
% quietly redefine another's rule.
can_pay(A, Amount) :-
  gold(A, G),
  G >= Amount.

% \u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550
% Placement \u2014 things in the world before anybody owns them
% docs/mechanic-predicates.md \xA78, US-3 of 124-items-equipment-economy
% \u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550

% \u2500\u2500 Runtime facts (per playthrough) \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
% item_at(ItemId, LocationId, Qty) \u2014 lying in the world, owned by nobody. The
%   fourth place an item can be and the ONLY one that had no predicate: carried
%   is has_item/3, in a chest is container_contains/3, worn is has_equipped/3.
%   It carries a quantity because those two do and because the ledger holds one:
%   forty arrows on a barrow floor said as item_at(arrow, barrow) would be a KB
%   that means "some arrows" about a stack core knows the size of.
%   Runtime, not authored: where the world STARTS its things is the template's,
%   where they are on the fortieth day is the playthrough's (\xA73).
:- dynamic(item_at/3).

% \u2500\u2500 Facts owned elsewhere that these rules read \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
% Containers already had a vocabulary \u2014 helper-predicates.ts declares five
% container predicates and reasons over them with container_accessible/2 \u2014 so
% placement mints none of its own and declares them the way it declares
% has_item/3 above. at_location/2 is the world-state predicate, not a
% placement-private one: a chest is an entity, and a rule asking what is in the
% crypt must see it (traversal-predicates.ts makes the same call for a boat).
:- dynamic(container/1).
:- dynamic(container_locked/1).
:- dynamic(at_location/2).

% \u2500\u2500 Rules \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500

% Something lying where this actor is standing \u2014 what a "take" is offered over.
% Whether they MAY take it is permissible/3's answer, asked by whoever takes it.
item_here(A, I) :-
  at_location(A, L),
  item_at(I, L, _).

% A container within reach. Whether it opens is container_accessible/2, which
% belongs to helper-predicates.ts and is not called here: a pack that calls
% another pack's rule is unusable without it (the AC4 coupling \xA78 refuses).
container_here(A, C) :-
  at_location(A, L),
  container(C),
  at_location(C, L).
`;
  var EQUIPMENT_RUNTIME_PREDICATES = [
    "carry_capacity/2",
    "item_condition/2",
    // US-3's one minted predicate — the fourth place, and the one US-1 and US-2
    // each deferred to placement so its shape would be decided by the story that
    // needed it. Everything else placement writes belongs to somebody else:
    // containers are `helper-predicates.ts`'s, `at_location/2` is the world's.
    "item_at/3"
  ];

  // @insimul/core/src/prolog/mechanics/stamina-predicates.ts
  var STAMINA_PREDICATES_PROLOG = `
% \u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550
% Stamina \u2014 thresholds, affordability and regeneration
% docs/mechanic-predicates.md \xA79
% \u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550

% \u2500\u2500 Authored facts (world content \u2014 never in a save) \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
% stamina_regen_base(EntityId, RatePerTick) \u2014 the rate the HOST applies per tick.
% stamina_threshold(winded|exhausted, Pct) \u2014 the world's balance numbers.
:- dynamic(stamina_regen_base/2).
:- dynamic(stamina_threshold/2).

% \u2500\u2500 Facts owned elsewhere that these rules read \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
% energy/3 is runtime gameplay state, in_combat/1 is \xA74's runtime fact, and
% action/4 is the authored action catalogue whose 4th argument IS the energy
% cost \u2014 which is why no stamina_cost/2 exists (\xA712).
:- dynamic(energy/3).
:- dynamic(in_combat/1).
:- dynamic(action/4).

% \u2500\u2500 Rules \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500

% Integer arithmetic on both sides (C * 100 =< M * P), so no float rounding can
% make two engines disagree about who is winded. M > 0 keeps a zero-max actor
% out of the comparison instead of dividing by it.
winded(A) :-
  energy(A, C, M),
  M > 0,
  stamina_threshold(winded, P),
  C * 100 =< M * P.

exhausted(A) :-
  energy(A, C, M),
  M > 0,
  stamina_threshold(exhausted, P),
  C * 100 =< M * P.

% Enough in the tank for what action/4 says this action costs.
can_afford_stamina(A, ActionId) :-
  action(ActionId, _, _, Cost),
  energy(A, C, _),
  C >= Cost.

% The rate the host applies per tick; core decides only the modifier. You don't
% catch your breath mid-fight \u2014 hence the cut on the first clause.
stamina_regen(A, 0) :- in_combat(A), !.
stamina_regen(A, Rate) :- stamina_regen_base(A, Rate).
`;
  var STAMINA_RUNTIME_PREDICATES = [];

  // @insimul/core/src/prolog/mechanics/gameplay-state-predicates.ts
  var GAMEPLAY_STATE_PREDICATES_PROLOG = `
% \u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550
% Runtime gameplay state \u2014 declarations only, no rules
% docs/mechanic-predicates.md \xA710.1
% \u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550
%
% Declared so a KB that carries none of them FAILS a query rather than raising
% existence_error, and so a fact restored from a save validates instead of being
% dropped. Per-playthrough state: these belong in save.currentState.prologFacts
% and never on a world template (\xA73).

:- dynamic(health/3).            % health(Actor, Current, Max).
:- dynamic(energy/3).            % energy(Actor, Current, Max).
:- dynamic(has_equipped/3).      % has_equipped(Actor, Slot, ItemId).
:- dynamic(has_status/3).        % has_status(Actor, Status, Duration).
:- dynamic(has_ability/2).       % has_ability(Actor, Ability).
:- dynamic(near/3).              % near(Actor, Target, Distance).
:- dynamic(at_location_type/2).  % at_location_type(Actor, LocationType).
:- dynamic(level/2).             % level(Actor, Level).
:- dynamic(xp/3).                % xp(Actor, Current, Max).
:- dynamic(gold/2).              % gold(Actor, Amount).
`;
  var GAMEPLAY_STATE_RUNTIME_PREDICATES = [
    "health/3",
    "energy/3",
    "has_equipped/3",
    "has_status/3",
    "has_ability/2",
    "near/3",
    "at_location_type/2",
    "level/2",
    "xp/3",
    "gold/2"
  ];

  // @insimul/core/src/prolog/mechanics/index.ts
  var MECHANIC_PREDICATE_PACKS = [
    { area: "combat", prolog: COMBAT_PREDICATES_PROLOG, runtimePredicates: COMBAT_RUNTIME_PREDICATES },
    {
      area: "perception",
      prolog: PERCEPTION_PREDICATES_PROLOG,
      runtimePredicates: PERCEPTION_RUNTIME_PREDICATES
    },
    { area: "skill", prolog: SKILL_PREDICATES_PROLOG, runtimePredicates: SKILL_RUNTIME_PREDICATES },
    {
      area: "traversal",
      prolog: TRAVERSAL_PREDICATES_PROLOG,
      runtimePredicates: TRAVERSAL_RUNTIME_PREDICATES
    },
    {
      area: "equipment",
      prolog: EQUIPMENT_PREDICATES_PROLOG,
      runtimePredicates: EQUIPMENT_RUNTIME_PREDICATES
    },
    {
      area: "stamina",
      prolog: STAMINA_PREDICATES_PROLOG,
      runtimePredicates: STAMINA_RUNTIME_PREDICATES
    },
    {
      area: "gameplayState",
      prolog: GAMEPLAY_STATE_PREDICATES_PROLOG,
      runtimePredicates: GAMEPLAY_STATE_RUNTIME_PREDICATES
    }
  ];
  var MECHANIC_RUNTIME_PREDICATES = Array.from(
    new Set(MECHANIC_PREDICATE_PACKS.flatMap((pack) => pack.runtimePredicates))
  );

  // @insimul/core/src/prolog/predicate-packs.ts
  var PREDICATE_PACKS = Object.freeze([
    ...MECHANIC_PREDICATE_PACKS,
    ...AI_PREDICATE_PACKS,
    ...ROUTINE_PREDICATE_PACKS,
    ...VOLITION_PREDICATE_PACKS,
    ...WEATHER_PREDICATE_PACKS,
    ...BUSINESS_PREDICATE_PACKS,
    ...PRODUCTION_PREDICATE_PACKS,
    ...DIALOGUE_PREDICATE_PACKS,
    ...PUZZLE_PREDICATE_PACKS,
    ...PLATFORMER_PREDICATE_PACKS,
    ...STRATEGY_PREDICATE_PACKS,
    ...SCRIPT_PREDICATE_PACKS,
    ...PLACEMENT_PREDICATE_PACKS,
    ...MAP_PREDICATE_PACKS,
    ...SCAFFOLD_PREDICATE_PACKS
  ]);
  var PREDICATE_PACK_AREAS = Object.freeze(
    PREDICATE_PACKS.map((pack) => pack.area)
  );
  var PREDICATE_PACK_RUNTIME_PREDICATES = Object.freeze(
    Array.from(new Set(PREDICATE_PACKS.flatMap((pack) => pack.runtimePredicates)))
  );

  // @insimul/core/src/modules/module-contract.ts
  var INSIMUL_MODULES = [
    {
      id: "combat",
      name: "Combat",
      summary: "May this actor attack that one, with what, from how far, and does the attack mean anything against that target.",
      parts: {
        predicatePack: "combat",
        irSection: "combat",
        // US-1 of `120-combat-and-stamina`. The pure resolution is
        // `src/combat/resolution.ts` — a function of (attacker, defender, action,
        // tuning, separation, seed, tick) that four engines reproduce — and this
        // is the half that remembers: the roster, the accumulated `threat/3`, the
        // `can_attack/2` gate it asks before anything resolves, and the fact delta
        // it writes back so a hit is legible to every rule in the world.
        decisionLayer: ["CombatResolver"],
        // Two, and they run in opposite directions. `ICombatSystem` is TOLD damage
        // core already decided; `ITrajectoryProbe` (US-3) is ASKED the one question
        // core cannot answer — is the line to that target clear — because hit
        // detection is geometry per frame (`docs/mechanic-predicates.md` §11). A
        // ranged attack needs the answer; nothing else about it leaves core.
        hostInterface: ["ICombatSystem", "ITrajectoryProbe"],
        conformanceCorpus: ["mechanic-combat"],
        // The two bundles whose GenreConfig turns combat on (`features.combat`,
        // `combatStyle` other than `none`). An adventure or puzzle world does not
        // consult the combat pack at all — see `module-activation.ts`.
        genreBundles: ["rpg", "survival"]
      }
    },
    {
      id: "perception",
      name: "Stealth and perception",
      summary: "Who can see whom, who has noticed, and what a hidden actor may still do.",
      parts: {
        predicatePack: "perception",
        // US-1 of `121-stealth-and-perception`. The bands, the rates and what a
        // stance or a shadow is worth — the whole of stealth's balance, so a world
        // where guards are jumpy and one where they are half-asleep differ by
        // content. What is NOT authored here is every per-tick measurement
        // (`IPerceptionProbe`): a scene does not exist at authoring time. US-2
        // added `actions` to the same section — stealth's COLUMNS on the shared
        // action rows, the way `CombatIR.actions` extends them, never a second
        // action table.
        irSection: "perception",
        // The pure pass is `src/perception/detection.ts` — a function of (host
        // readings, memory, tuning, seed, tick) four engines reproduce — and this
        // is the half that remembers: how convinced each pair has become, which
        // rung that puts them on, and what each observer BELIEVES about where its
        // target is, which is not where the target is.
        decisionLayer: ["DetectionTracker"],
        // One, and it is a question rather than an executor. The host answers what
        // an observer's senses can reach — a raycast, a light probe, an occlusion
        // test, the animation state that says a body is prone — and core alone
        // decides what follows from it (`docs/mechanic-predicates.md` §5, §11).
        hostInterface: ["IPerceptionProbe"],
        // The manifest names the QUERY corpus, because that is the shape the C,
        // Rust and wasm harnesses run (`docs/module-contract.md` §2.5). It cannot
        // pin a suspicion level — no rule computes one — so US-3 added the second
        // artifact a native port actually diffs against: `conformance/stealth/`,
        // one detection tick per case down to the rung, the belief and the fact
        // delta, driven end to end with no engine by
        // `src/conformance/__tests__/headless-stealth-host.ts`.
        conformanceCorpus: ["mechanic-perception"],
        // Stealth is a mechanic an RPG offers (`rpg`'s proficiency dimensions
        // include it by name) and an exploration game is built on. It is not one a
        // strategy, puzzle or simulation world asks for.
        genreBundles: ["rpg", "adventure"]
      }
    },
    {
      id: "skill",
      name: "Skills",
      summary: "What an actor is good enough at to attempt, and what practising it does.",
      parts: {
        predicatePack: "skill",
        // US-1 of `123-skill-trees-and-progression`. The pending block used to
        // name `entities.characters.skills`, and that field is real and
        // unchanged: it is the level each character STARTS at. What a
        // `Record<string, number>` cannot carry is the thing that makes a tree a
        // tree — which skills exist at all, the cap, the curve, which nodes hang
        // off which, what each asks of an actor and what taking it does. Those
        // are properties of the WORLD, so `WorldIR.skills` is where they live,
        // exactly as `WorldIR.traversal` is the link graph the road geometry
        // could not be read as. The two coexist.
        irSection: "skills",
        // The pure resolution is `src/skills/skills.ts` — what a level prices,
        // what a node costs, which refusal applies and in what order — and this
        // is the half that remembers: levels (`has_skill/3`, adopted rather than
        // re-minted), banked XP, unspent points per tree and taken nodes. The
        // same two-part shape `combat`, `stamina`, `perception` and `traversal`
        // have.
        decisionLayer: ["SkillProgression"],
        // US-3, and the part US-1 recorded as an open QUESTION rather than a
        // to-do. Both halves of the answer matter. The panel is NOT an interface:
        // what a host draws a tree from is the value `buildSkillView` returns
        // (`src/skills/skill-view.ts`), so layout stays in the engine and the
        // tree's meaning stays in core — an `ISkillTreeUi` would have been a UI
        // callback on the C ABI (§3). What is left over is one thing, and it is
        // real: a `modifies(Param, Amount)` effect is applied by whoever owns the
        // field it names, US-2 wired every parameter core owns
        // (`withSkillModifiers`), and the rest name a quantity only the engine
        // holds — how fast a body moves, how far it reaches. Those reached nobody
        // in any engine until this. Told, never asked; absolute, never a delta;
        // once per change to an actor's taken nodes, never on a frame.
        hostInterface: ["ISkillModifierSink"],
        conformanceCorpus: ["mechanic-skill"],
        // Skill CHECKS, which is a different thing from the language-learning
        // proficiency stack: `educational` and `language-learning` deliberately do
        // not select this module even though both track proficiency.
        genreBundles: ["rpg", "survival"]
      }
    },
    {
      id: "traversal",
      name: "Traversal",
      summary: "Whether an actor can get from here to there, by what mode, and what blocks it.",
      parts: {
        predicatePack: "traversal",
        // US-1 of `122-traversal-and-travel`, and the part the pending block above
        // named for longest: the World IR carried roads, street networks and water
        // as GEOMETRY, which is what a renderer needs and what a decision layer
        // cannot read — geometry does not say whether an actor may go that way, in
        // what mode, or what it costs them. `WorldIR.traversal` is the authored
        // link graph `traversal_link/3` always described and nothing exported. The
        // two coexist: a host lays its navmesh over the geometry and asks core
        // about the graph.
        irSection: "traversal",
        // The pure resolution is `src/traversal/traversal.ts` — affordances, cost
        // and reachability as functions of the authored graph plus the runtime
        // facts — and this is the half that remembers: who is where (a location
        // atom, never a coordinate), which mode each actor is using, which links
        // this playthrough closed, and the fact delta that makes all of it legible
        // to every rule in the world. It charges 120's `energy/3` and grows no
        // meter of its own.
        // `VehicleRegistry` is the second half (US-2): a vehicle handed entirely to
        // the engine is an opaque object, and an opaque object has no owner, so
        // taking it is not theft; no NPC can choose it, because `candidate_action/3`
        // cannot see it; and no law can forbid riding it. It holds identity,
        // ownership, occupancy and the reins — and nothing else, because speed and
        // handling are the host's and it exposes no surface for them.
        // `FastTravelDirector` is the third (US-3), and the one a generic engine
        // cannot supply: every engine can put a character somewhere else, and none
        // of them can say what the WORLD did meanwhile. A journey advances the
        // clock in bounded steps so the systems that hang off it run forward
        // through it, and it is gated on discovery and permissibility rather than
        // on a menu — `can_fast_travel/2` is the KB's own statement of that.
        decisionLayer: ["TraversalPlanner", "VehicleRegistry", "FastTravelDirector"],
        // Two, and they run in opposite directions — the same shape `combat` has.
        // `ITraversalProbe` is ASKED the one question core cannot answer (could
        // this actor actually get across that, from where they are standing);
        // `ILocomotionHost` is TOLD to carry out a movement core has already
        // afforded, permitted and charged for. Between them sits the whole of
        // locomotion — the path, the speed, the animation, the character
        // controller — and none of it crosses the boundary
        // (`docs/mechanic-predicates.md` §11, `docs/module-contract.md` §3).
        // Vehicles (US-2) add NO third interface, deliberately: riding somewhere is
        // an ordinary traversal, so it goes out through `ILocomotionHost` with the
        // vehicle named in the order. A vehicle-shaped host hook is where a speed
        // and a handling model would arrive. Fast travel (US-3) adds none either,
        // for the same reason in the other direction: a journey needs nothing from
        // an engine that a movement does not, and a travel-shaped hook is where a
        // transition animation and a loading screen would arrive in core.
        hostInterface: ["ITraversalProbe", "ILocomotionHost"],
        conformanceCorpus: ["mechanic-traversal"],
        // The three bundles whose worlds are navigated rather than managed from
        // above: `adventure` is exploration by definition, `survival` scores
        // navigation, `rpg` gates regions on whether the player can reach them.
        // `platformer` (Features Round track G) is a game about getting from here
        // to there and nothing else: whether a level's households and businesses
        // can be reached is this module's `can_traverse/3` over the authored link
        // graph, and the run and the jump are the host's `ILocomotionHost`. It
        // needs no other module's pack — its `energy/3` is the always-active
        // `gameplayState` vocabulary — which is why it can be selected without
        // `map` (whose jurisdiction clause needs `agentAi`'s `norm/2`).
        genreBundles: ["rpg", "survival", "adventure", "platformer"]
      }
    },
    {
      id: "equipment",
      name: "Equipment",
      summary: "What may be equipped, into which slot, what it weighs, what it protects, and what wearing it does to the numbers.",
      parts: {
        predicatePack: "equipment",
        // US-1 of `124-items-equipment-economy` moved this from `systems.items`,
        // and both are real. `systems.items` is the item CATALOGUE — what a thing
        // weighs, what it is worth, what it does — and it is unchanged; what an
        // array of items cannot carry is the WORLD's own table, and that was the
        // gap. `EquipmentManager` shipped with `EquipmentSlot` as a compiled union
        // of three, so "two rings, not five" — the pack's own justifying example
        // for `equip_slot_capacity/2` — was unrepresentable and a back slot for a
        // cloak was a TypeScript change in four engines. `WorldIR.items` is the
        // slot table those authored facts always described and nothing exported,
        // exactly as `WorldIR.traversal` is the link graph the road geometry could
        // not be read as. The two coexist.
        irSection: "items",
        // Two, and they divide by what they remember. `EquipmentManager` holds one
        // actor's worn loadout and totals it into `CombatStats` for a host that
        // supplied `ICombatStatSink` (US-1 of `112-core-inverted-module-seam`).
        // `ItemLedger` (US-1 of `124-items-equipment-economy`) holds the thing that
        // was missing under it: WHERE every item is. Three systems existed —
        // `ContainerManager` for chests, `EquipmentManager` for slots, an
        // `assert(has_item(...))` in the action block for a pickup — and none of
        // them agreed on what an item is, so a sword in a chest, a sword in a pack
        // and a sword in a hand were three records that shared a name. The ledger
        // is one representation, four places, and NOT ONE new predicate: the
        // vocabulary already had `has_item/3`, `container_contains/3` and
        // `has_equipped/3`, every one keyed by the same authored item atom.
        // `Market` is the third (US-2 of `124-items-equipment-economy`), and the
        // one that had to exist for this module to be about ITEMS rather than
        // about equipment: an item nobody can buy, sell or price is a thing the
        // world hands out. It is also where the module stops resembling a generic
        // inventory system — businesses, owners, occupations, factions and
        // genealogy already exist as simulation here, so a price is resolved from
        // them (`vendor_markup/2`, `business_owner/2`, `reputation/3`, a shelf's
        // own `container_contains/3`) rather than read off a table, and a
        // transaction is `permissible/3` under `buy_item` like any other action —
        // which is what makes a theft a transaction that failed the gate rather
        // than a mechanism of its own. It holds no item state: a shelf is a
        // `container` place in `ItemLedger`.
        // `ItemPlacer` is the fourth (US-3 of `124-items-equipment-economy`), and
        // the one the brief lists FIRST: a world whose every sword starts in a
        // merchant's pack has no exploration in it, and a generated world that
        // cannot carry its own loot has nothing for the generation band to
        // generate. It remembers what the world INTENDED to place and how much of
        // that has happened; where the things themselves are is the ledger's
        // `world` and `container` places, so this is the third module in a row
        // that holds no item state. Its scene half is not here at all — the
        // manifest is `editor/scene/placement.ts` and the re-import policy is
        // `editor/reimport/diff.ts`, both used unchanged, because a placement id
        // is the node's `entityId` and therefore the diff's match key: that is
        // what makes a creator's hand-moved chest survive a regeneration.
        decisionLayer: ["EquipmentManager", "ItemLedger", "Market", "ItemPlacer"],
        // Still one, and deliberately: `ItemLedger` adds no host interface at all.
        // Where an item physically is, the paper doll, the pickup animation and the
        // dropped-sword mesh are the engine's and core never asks about them; the
        // numbers a loadout totals go out the way they always did (`ICombatStatSink`)
        // or through the parameter seam a module already takes as input
        // (`items/item-effects.ts`, `withEquipmentModifiers`). An item-shaped host
        // hook is where a mesh handle and a per-frame position would arrive in core.
        // `Market` (US-2) adds none either, and the answer is the same one in a
        // different key: money and stock are core state, a price is core's
        // arithmetic over facts core already reads, and the shop panel — the
        // layout, the haggling animation, the coin sound — is presentation. A
        // trade-shaped host hook is where a UI callback would arrive on the C ABI
        // (`docs/module-contract.md` §3). Adding none is a legitimate answer to
        // part 4, and this is twice it has been the right one. `ItemPlacer` (US-3)
        // makes it three, and it is the case that would most obviously have needed
        // one: a placed sword has a mesh, a transform and a pickup radius. It gets
        // no hook because the engine is already told where to draw it by the
        // placement MANIFEST — an artifact, computed once, not a per-frame call
        // across the ABI (UNIFICATION_ROADMAP decision 1) — and what a node IS
        // comes back the other way, through `ItemPlacer.placementOf`.
        //
        // US-4 is where that answer stopped being an assertion: the headless
        // reference host (`src/conformance/__tests__/headless-items-host.ts`) runs a
        // whole playthrough — a placed wreck, a pickup, two equips, a purchase and a
        // purchase the law refuses — and `asked` ends it holding one entry,
        // `base_stats(nessa)`. An item-shaped probe would show up there as traffic
        // and nowhere else. The Babylon host is tasklist 144.
        hostInterface: ["ICombatStatSink"],
        // Part 5 names the VOCABULARY corpus, as every module's does. The module's
        // second artifact is `conformance/items/` (US-4): equipping, pricing,
        // transaction resolution and placement identity, which no query corpus can
        // pin because no rule computes a price, a refusal, a hoard or an identity —
        // the same split `conformance/combat/` and `conformance/skills/` make.
        // `npm run items-corpus` regenerates it.
        conformanceCorpus: ["mechanic-equipment"],
        genreBundles: ["rpg", "survival"]
      }
    },
    {
      id: "stamina",
      name: "Stamina",
      summary: "Whether an actor has the energy for this, and what exhaustion stops them doing.",
      parts: {
        predicatePack: "stamina",
        irSection: "survival.staminaConfig",
        // US-2 of `120-combat-and-stamina`, ahead of the 125 it was assigned to,
        // because combat spends this resource and a mechanic cannot spend a
        // resource no module owns. The pure model is `src/stamina/stamina.ts` —
        // cost, recovery and the two threshold bands as integer functions of
        // authored tuning — and this is the half that remembers one meter per
        // actor and writes `energy/3` back where every rule can read it.
        decisionLayer: ["StaminaPool"],
        hostInterface: ["ISurvivalSystem"],
        conformanceCorpus: ["mechanic-stamina"],
        // One bundle, on purpose. Stamina is authored in `SurvivalIR`, which
        // `WorldIR` itself marks "if genre enables it" — a genre that exports no
        // survival section has nothing for this module to read. An RPG world still
        // fights: `CombatResolver` takes a pool when one exists and prices nothing
        // when it does not, which is what "does nothing when not selected" means
        // for a resource other mechanics spend.
        genreBundles: ["survival"]
      }
    },
    {
      id: "agentAi",
      name: "Agent AI",
      summary: "What each NPC does next: what it believes, which of the actions it could take are permitted, which is best, and what it has committed to over the next several ticks.",
      parts: {
        // One area for five pack texts, in the only order they consult in — see
        // `ai/substrate-pack.ts`. The substrate is not one of the six mechanic
        // areas; it is the layer that decides over whichever of them a world
        // selected, which is why it registers in `PREDICATE_PACKS` rather than in
        // `MECHANIC_PREDICATE_PACKS`.
        predicatePack: "agentAi",
        // The action block. Every plan step and every candidate is an `ActionIR`
        // the creator authored, which is the whole of "one action vocabulary, not
        // two": there is no second authored section for AI-only actions, and there
        // must never be. Goals and norms ride in `systems.rules` and the world's
        // `knowledgeBase` as authored Prolog (US-3's AC3 — a creator changes a more
        // by changing content), so the section that carries the module's OWN
        // authored data is this one.
        irSection: "systems.actions",
        decisionLayer: ["AgentPlanner"],
        hostInterface: ["IAgentActionHost"],
        conformanceCorpus: ["agent-ai"],
        // The four bundles whose worlds are populated by characters who act on
        // their own: an RPG's NPCs have routines and factions, a survival world's
        // wildlife and raiders decide, an adventure's inhabitants are most of the
        // content, and a life simulation is nothing else. A puzzle or strategy
        // world moves pieces the player commands, and a language-learning or
        // educational world's NPCs are conversation partners driven by the
        // dialogue stack rather than by utility over a world model.
        genreBundles: ["rpg", "survival", "adventure", "simulation"]
      }
    },
    {
      id: "routine",
      name: "NPC routines",
      summary: "What this NPC is standing here to do at this hour of this day, where it wants to be doing it, and what displaced it.",
      parts: {
        // US-1 of `125-npc-routines-and-locomotion`. Not one of the six mechanic
        // areas and not the substrate either: it is a CLOCK OVER GOALS, which is
        // why it registers in `PREDICATE_PACKS` beside `agentAi` rather than in
        // `MECHANIC_PREDICATE_PACKS`. It is also the build's first composition
        // pack outside the substrate, and `prolog/predicate-packs.ts` registers it
        // last for the reason its header gives.
        predicatePack: "routine",
        // The World IR carried `NPCDailyScheduleIR` — hours, an activity atom and
        // a building id per NPC — which is what a behaviour tree needs and what a
        // decision layer cannot read: an activity is a LABEL, and a label says
        // nothing about what the NPC wants. `WorldIR.routines` is the same day
        // authored as goals, and `routineFromDailySchedule` converts one into the
        // other so the schedule stops being a parallel system.
        irSection: "routines",
        // The pure resolution is `src/routines/routines.ts` — which authored block
        // is open at this hour on this day, as integer arithmetic four engines
        // reproduce — and this is the half that remembers: whose routine is whose,
        // what each has adopted, and what preempted it. Its entire output is one
        // `agent_goal/3` fact per NPC; `AgentPlanner` does everything after that
        // and has no idea routines exist, which is the whole of "no second
        // scheduler" (`docs/npc-routines.md` §2).
        // `LocomotionDirector` is the second half (US-2), and it is what closes the
        // sentence US-1 opened: a block's place is a REQUIREMENT of its goal, so an
        // NPC whose day says "be at the forge" holds a goal it cannot satisfy from
        // where it stands. This turns that standing wish into movement INTENT — a
        // destination, an urgency and a stance, all atoms — orders ONE adjacent leg
        // at a time through 122's `TraversalPlanner`, and treats a host that could
        // not get there as an outcome rather than an exception: it counts the
        // failures and, after an authored number of them, invalidates the plan so
        // the substrate re-plans. It computes no path and owns no notion of what is
        // passable; both are `traversal`'s, asked through one structural interface.
        decisionLayer: ["RoutineDirector", "LocomotionDirector"],
        // One, and it is `traversal`'s own — the ONLY part of this manifest two
        // modules name (US-2 of `125-npc-routines-and-locomotion`). That is the
        // answer, not a shortcut: an NPC walking to the forge because its day says
        // so is an ordinary movement, so it leaves through the interface a player's
        // step leaves through, with the intent named in the order
        // (`LocomotionOrder.urgency`, `.stance`). A routine-shaped host hook is
        // precisely where a path, a speed and an animation would have arrived in
        // core — the same reasoning that gave vehicles and fast travel no interface
        // of their own, and the reason US-1's pending block refused to invent one
        // before this story defined the contract. What US-2 DID add is two atoms on
        // the order every engine already had to implement.
        //
        // US-3 added no interface either, and for the third time the absence IS the
        // contract: an ANIMATION intent (`ActionOrder.animation`, one atom of
        // `ANIMATION_INTENTS`) rides the order `agentAi`'s `IAgentActionHost`
        // already carries, so a host learns what a body should be doing in the same
        // call that tells it the body is doing anything at all. An `IAnimationHost`
        // beside it would be a second call about one decision, and the cadence of
        // that second call is a frame loop (`docs/animation-intent.md` §4).
        hostInterface: ["ILocomotionHost"],
        conformanceCorpus: ["mechanic-routine"],
        // The same four bundles `agentAi` names, and necessarily a subset of them:
        // a routine is a goal for the substrate's planner to serve, so a genre that
        // selects routines without the substrate would author days nothing acts on.
        // A puzzle or strategy world moves pieces the player commands and its
        // inhabitants keep no hours.
        genreBundles: ["rpg", "survival", "adventure", "simulation"]
      }
    },
    {
      id: "map",
      name: "Map and geopolitics",
      summary: "Which region a position is in, which authority claims it, what that authority claimed in 1850, what this playthrough has found, and what an engine draws from all of it.",
      parts: {
        // US-1 of `133-map-and-geopolitical-layer` wrote the pack and deliberately
        // left it UNregistered (`docs/geopolitical-layer.md` §9): four of the six
        // parts depended on what the map surface turned out to need, and a
        // `pending` block written in ignorance of its own answer is worse than no
        // entry at all. US-3 is that answer, so the area is registered — last in
        // `PREDICATE_PACKS`, because the pack writes clauses for `forbids/4` and
        // `scoped_norm/1` that the substrate's enforcement pack declares
        // `:- dynamic`, and its territorial clause calls that pack's `norm/2`.
        // The area carries the REGION half only. The temporal half
        // (`geo/history-predicates.ts`) reads `world_resolve/4` out of the identity
        // layer, which `GamePrologEngine` does not consult, so registering it would
        // put a pack in every selected KB whose rules call something that KB has no
        // definition for — `docs/political-history.md` §6 is the consult order a
        // caller that wants borders over time follows instead.
        predicatePack: "map",
        // The geometry the World IR has exported since the first world:
        // `CountryIR.bounds`, `StateIR.bounds`, `SettlementIR.position` + `radius`,
        // `TerrainFeatureIR`, `WaterFeatureIR`. `regionsFromGeography` is the
        // projection and it adds no field — a region is an extent for a document
        // that already exists, so a country's name, its laws and its government
        // stay in the country block where they always were.
        irSection: "geography",
        // The pure half is `src/geo/` — the facts, the readers and
        // `buildMapSurface`, all functions of their inputs — and this is the half
        // that remembers: what this playthrough has FOUND. That is the module's
        // only runtime state, it is per-playthrough by definition, and it is
        // written in `location_discovered/1`, the predicate travel and quests were
        // already asserting. There is no `map_discovered/1`.
        decisionLayer: ["MapDirector"],
        // `traversal`'s own, and the second time in this manifest a module names
        // another's (after `routine`). It is the answer rather than a shortcut:
        // what a host DRAWS is the value `MapDirector.surface()` returns — an
        // `IMapUi` would be a UI callback on the C ABI (§3), and a map is the most
        // per-frame surface in a game, so it is exactly where one would arrive —
        // and the only thing a map DOES is send somebody to a place they found,
        // which is an ordinary fast travel and leaves through the interface every
        // other movement leaves through. A map-shaped locomotion hook would be a
        // second way to move a character; a map-shaped UI hook would be a frame
        // loop across the ABI. Neither exists (`docs/map-surface.md` §5).
        hostInterface: ["ILocomotionHost"],
        // The query corpus. It cannot pin the surface — no rule computes one — so
        // `conformance/map/` is the artifact a native port diffs against, with the
        // resolution re-run against a REVERSED world in every case.
        conformanceCorpus: ["geo-map"],
        // The four bundles whose worlds are places rather than boards, and
        // necessarily a subset of `agentAi`'s: the pack's jurisdiction clause calls
        // the substrate's `norm/2`, so a genre that selected the map without the
        // substrate would author a territorial law with no gate to evaluate it. A
        // puzzle world has no territory; an educational or language-learning world
        // has locations without jurisdiction over them.
        genreBundles: ["rpg", "survival", "adventure", "simulation"]
      }
    },
    {
      id: "volition",
      name: "NPC volition",
      summary: "What this NPC wants that nobody asked it for, who it wants it with, and whether the world will let it have it.",
      parts: {
        // US-1 of `193-module-v2-characters-environments`. The tenth module and
        // the third whose pack is not one of the six mechanic areas: it is a WANT
        // OVER CANDIDATES, the mirror of what `routine` is to goals, which is why
        // it registers in `PREDICATE_PACKS` beside `agentAi` and `routine` rather
        // than in `MECHANIC_PREDICATE_PACKS`. It mints no scalar the build already
        // had — `spark/3`, `romantic_status/3` and `personality/3` are the social
        // vocabulary `prolog/tott-predicates.ts` and `prolog/npc-reasoning.ts`
        // already carry, and what `RomanceSystem` kept as a hydrated field.
        predicatePack: "volition",
        // v1 had NO authored section: `VolitionSystem`'s action grammar and
        // `RomanceSystem`'s stage ladder were `Record` constants in core's source,
        // so a world where courtship goes differently — or where nobody courts —
        // meant forking the runtime. `WorldIR.volition` is that content authored,
        // in the substrate's own vocabulary: a desire names a motive and an
        // authored `action/4`, never a verb of its own.
        irSection: "volition",
        // The pure resolution is `src/volition/volition.ts` — what a desire is
        // worth to an agent and which rung of a courtship a spark reaches, as
        // integer arithmetic four engines reproduce — and this is the half that
        // remembers: every spark in each direction, what the pair are to each
        // other, and which urge has just been served. Its entire output is
        // `agent_motive/3` and `target_appeal/3`; `selectActions()` does
        // everything after that and has no idea desires exist, which is the whole
        // of "no fourth selection mechanism" (`docs/npc-volition.md` §2).
        decisionLayer: ["VolitionDirector"],
        // One, and it is `agentAi`'s own — the third time in this manifest a
        // module names another's (after `routine` and `map`), and the first time
        // the shared interface is the substrate's. That is the answer, not a
        // shortcut: a desire's whole output is two numbers the utility layer
        // already reads, so what finally crosses to a host is an ordinary
        // `ActionOrder` from an ordinary selection. A volition-shaped host hook is
        // precisely where a romance UI, a flirt animation and an ambient-life
        // scheduler would have arrived in core — the same reasoning that gave
        // vehicles, fast travel and the map surface no interface of their own.
        // `src/conformance/__tests__/headless-volition-host.ts` is the seam proved
        // the only way `packages/core` can prove it, and the engine adoption is
        // the 144–147 wave.
        hostInterface: ["IAgentActionHost"],
        conformanceCorpus: ["mechanic-volition"],
        // Three of `agentAi`'s four, and necessarily a subset of them: a desire is
        // a drive for the substrate's utility layer to weigh, so a genre that
        // selected volition without the substrate would author wants nothing acts
        // on. `survival` is the one left out — the pressure on a survival world's
        // NPCs is the environment rather than each other, and its bundle already
        // carries routines for the day and the substrate for the deciding.
        genreBundles: ["rpg", "adventure", "simulation"]
      }
    },
    {
      id: "weather",
      name: "Weather and seasons",
      summary: "Which season this world is in, what its sky is doing today, and what that closes.",
      parts: {
        // US-2 of `193-module-v2-characters-environments`. The eleventh module and
        // the fourth whose pack is not one of the six mechanic areas. It is the
        // first raised from a mechanic that existed only as a HOLE: `weather/1`
        // (`prolog/gameplay-predicates.ts`) and `season/1`
        // (`prolog/npc-reasoning.ts`) have been in the vocabulary since the
        // beginning, twelve authored rules read them by name, and nothing in core
        // ever wrote either one — a host synced a string in and every rule quoted
        // whichever engine was running. This pack mints no second name for them.
        predicatePack: "weather",
        // v1 had NO authored section, which is why the mechanic could not exist:
        // a world where autumn is long, where snow closes the pass and where the
        // wet season IS the game had nowhere to say so. `WorldIR.weather` is that
        // content, in the vocabulary the rules already speak — a season names a
        // span of the year and a condition names an `action/4` it closes, and
        // neither names a colour, a particle count or a skybox.
        irSection: "weather",
        // The pure resolution is `src/weather/weather.ts` — the calendar and the
        // seeded roll as integer arithmetic four engines reproduce, with no float
        // anywhere in it — and this is the half that remembers: the day the sky
        // was rolled for, the season, the condition, and the fact delta that makes
        // all three legible. It gates nothing: what a blizzard CLOSES is one more
        // clause of `forbids/4` in the pack, so `permissible/3` refuses a
        // snowbound errand with no line added here (`docs/weather-seasons.md` §2).
        decisionLayer: ["WeatherDirector"],
        // One, and it is MINTED rather than borrowed — the decision worth reading,
        // because `volition` went the other way in the same tasklist. The sky is
        // not an actor: it performs no action, holds no goal and appears in no
        // roster, so there is no `ActionOrder` for it to ride and no probe to
        // answer. And a blizzard no engine ever hears about is a rule with no
        // world attached. `IWeatherSink` is told the whole current sky, absolutely,
        // once per change, and returns `void` — the property that stops a host
        // telling core it is raining, which is how four engines ended up with four
        // skies in v1 (`docs/weather-seasons.md` §4).
        hostInterface: ["IWeatherSink"],
        // Two, and the split is the one `routine` and `traversal` make. The query
        // corpus pins the VOCABULARY — the calendar, the possibility of a
        // condition, the gate's refusal. It cannot pin a seeded progression,
        // because no rule rolls one, so `conformance/weather/progression.json` is
        // the second artifact a native port diffs against: whole multi-day runs,
        // day by day, from a seed.
        conformanceCorpus: ["mechanic-weather"],
        // All four of `agentAi`'s, and necessarily a subset of them: this pack
        // writes clauses for the substrate's `forbids/4`, so a genre that selected
        // weather without the substrate would author a storm ban with no gate to
        // evaluate it. `survival` is the one bundle where it is not optional —
        // the pressure on a survival world's NPCs is the environment, which is
        // exactly the sentence `volition`'s registration used to explain leaving
        // that bundle out.
        genreBundles: ["rpg", "survival", "adventure", "simulation"]
      }
    },
    {
      id: "business",
      name: "Business lifecycle",
      summary: "Whether this trade can be opened here, what a day of it costs to run, who it pays, and whether it is still open tomorrow.",
      parts: {
        // US-1 of `194-module-v2-settlements-economy`. The twelfth module and the
        // fifth whose pack is not one of the six mechanic areas. It mints exactly
        // two names — `business_capital/2` and `business_arrears/2` — and both are
        // the same finding: a world TEMPLATE describes an opening day, and neither
        // what is in a till nor how long it has been empty survives one.
        // Everything else it writes belongs to somebody: `business/1`,
        // `business_owner/2` and five more are the world generator's
        // (`prolog/predicate-schema.ts`), `employed_at/3` is the hiring
        // vocabulary's, `gold/2` is the gameplay-state block's.
        predicatePack: "business",
        // v1 had `entities.businesses` — an id, a type, an owner, a founding year,
        // an `isOutOfBusiness` flag and a `businessData: Record<string, any>` — and
        // nowhere at all that said what a bakery COSTS. So a business could not
        // fail for a reason; it failed on `should_close_business/1`'s
        // `random_chance(0.02)`. `WorldIR.business` is the world's TABLE, keyed by
        // the trade rather than the instance, exactly as `WorldIR.items` is the
        // slot table `systems.items` could not be read as. The two coexist.
        irSection: "business",
        // The pure resolution is `src/business/business.ts` — the day's books and
        // the two refusal ladders as integer arithmetic four engines reproduce,
        // with no percentage anywhere in the module — and this is the half that
        // remembers: every till, every arrears count, every post held. It is also
        // the first decision layer in this manifest to validate its mutation
        // against the predicate schema BEFORE any of it lands, whole delta at a
        // time, because a business is the first mechanic whose state is written
        // into predicates the world generator owns and a half-applied founding is
        // a shop whose owner never paid for it (`docs/business-lifecycle.md` §5).
        decisionLayer: ["BusinessDirector"],
        // One, and it is `agentAi`'s own — the fourth time in this manifest a
        // module names another's and the second time it is the substrate's, for
        // exactly `volition`'s reason. Founding a shop, taking a post and turning
        // up to work are things an ACTOR does: each is an authored `action/4` the
        // substrate already enumerates, gates on `forbids/4` and dispatches, so
        // what crosses to a host is an ordinary `ActionOrder` and an adopted engine
        // contributes nothing extra for a smithy to go under. A business-shaped
        // host hook is precisely where a shop-management panel, a hiring dialogue
        // and a till animation would have arrived in core — the same reasoning that
        // gave `Market`, `ItemLedger` and `ItemPlacer` no interface of their own,
        // three times over in the module this one extends.
        hostInterface: ["IAgentActionHost"],
        // One, and for `volition`'s reason rather than `weather`'s: everything this
        // module decides IS a query. `business_profit/2` is the arithmetic,
        // `business_solvent/1` and `business_ruined/1` are the verdicts, and
        // `can_found_business/2` and `can_hire/2` are the gates. What
        // `BusinessDirector` adds is memory and a schema gate, and memory is pinned
        // by a save round trip rather than by a case.
        conformanceCorpus: ["mechanic-business"],
        // `equipment`'s two, plus `simulation`. The first two are where money
        // already changes hands, so a business that can go broke is a business
        // whose shelf and purse the world already has. `simulation` is the one
        // added rather than inherited: a world whose whole subject is the town
        // running itself is the world in which a smithy failing is the CONTENT,
        // and it is the bundle `routine`, `volition` and `map` all name for the
        // same reason. `adventure` is left out deliberately — an exploration world
        // has shops, and `equipment` gives it every one of them, but nothing in it
        // turns on whether the innkeeper makes payroll.
        genreBundles: ["rpg", "survival", "simulation"]
      }
    },
    {
      id: "crafting",
      name: "Crafting",
      summary: "Whether this actor may make that here, out of what, with what tool, and what it takes off them.",
      parts: {
        // US-2 of `194-module-v2-settlements-economy`. It mints NOT ONE runtime
        // predicate, which is the entry worth reading twice: what crafting does is
        // move items, `has_item/3` already said that, and a `crafted_by/2` beside
        // it would be the second vocabulary for one fact. `ItemLedger`'s answer,
        // arrived at again by a different route.
        predicatePack: "crafting",
        // v1 had `RECIPES` as a TypeScript constant inside `RecipeCraftingSystem`
        // and a second one inside `CraftingSystem`, so a world that wanted a new
        // recipe needed a change in four engines. `WorldIR.production.crafting` is
        // the book, keyed by the recipe rather than by the maker.
        irSection: "production.crafting",
        // One class for four modules, deliberately: four directors over four
        // kernels is precisely the v1 shape these four were raised out of.
        decisionLayer: ["ProductionDirector"],
        // `agentAi`'s own. `craft_item` is an authored `action/4` the substrate
        // already enumerates, gates on `forbids/4` and dispatches, so a proscribed
        // recipe is refused with no line added to any decision layer and an adopted
        // engine contributes nothing extra to make a sword.
        hostInterface: ["IAgentActionHost"],
        conformanceCorpus: ["mechanic-crafting"],
        // Making things is what an RPG, a survival game and a town simulation all
        // do. A puzzle or language-learning world's bread simply exists.
        genreBundles: ["rpg", "survival", "simulation"]
      }
    },
    {
      id: "farming",
      name: "Farming",
      summary: "What is in this field, how long it still needs, and what comes off it when it is ready.",
      parts: {
        // US-2 of `194-module-v2-settlements-economy`. Three runtime predicates
        // and they are exactly the three a world template cannot carry: what is in
        // the ground, when it went in, and how often it has been tended. The plot
        // itself is AUTHORED, because a world's fields are placed by its generator
        // — the same split `business` makes between `trade_kind/1` and
        // `business_capital/2`.
        predicatePack: "farming",
        // v1's `CROP_TYPES` held five crops, their growth times, their values and
        // their French vocabulary, compiled in. Worse, `rollCropType()` chose the
        // crop AT HARVEST, so a plot sown with wheat came up tomatoes.
        irSection: "production.farming",
        decisionLayer: ["ProductionDirector"],
        hostInterface: ["IAgentActionHost"],
        conformanceCorpus: ["mechanic-farming"],
        // Fields are a survival mechanic and a simulation's subject. An RPG has
        // farms as scenery and nothing in it turns on whether the barley came up.
        genreBundles: ["survival", "simulation"]
      }
    },
    {
      id: "fishing",
      name: "Fishing",
      summary: "Whether this water may be fished, what it holds, and how much of it is left.",
      parts: {
        // US-2 of `194-module-v2-settlements-economy`. `spot_stock/2` is the whole
        // of what v1 was missing under the roll: `FishingSystem` drew a float
        // ladder against three hardcoded `FISH_TYPES` at a pool that never ran
        // down, so a river was a vending machine and there was never a reason to
        // walk to the next one.
        predicatePack: "fishing",
        irSection: "production.fishing",
        decisionLayer: ["ProductionDirector"],
        hostInterface: ["IAgentActionHost"],
        // One QUERY corpus, plus a share of `conformance/production/draws.json` —
        // the manifest names the query corpus because that is the shape the C,
        // Rust and wasm harnesses run (`docs/module-contract.md` §2.5), and the
        // draw file is the second artifact a native port diffs against, because
        // the seeded draw is not expressible as a rule at all
        // (`docs/native-production.md` §6, divergence P-1).
        conformanceCorpus: ["mechanic-fishing"],
        genreBundles: ["survival", "simulation"]
      }
    },
    {
      id: "mining",
      name: "Mining",
      summary: "Whether this vein may be worked, what the rock holds, and how much of it is left.",
      parts: {
        // US-2 of `194-module-v2-settlements-economy`. `fishing`'s structural twin
        // and deliberately so — a pool and a seam differ in what they are called,
        // what tool they take and what they hold, and in nothing else a rule could
        // read. What is not shared is the vocabulary, because a rule that had to
        // ask "is this site used up" through one name would be asking neither
        // question (`docs/native-production.md` §3).
        predicatePack: "mining",
        irSection: "production.mining",
        decisionLayer: ["ProductionDirector"],
        hostInterface: ["IAgentActionHost"],
        conformanceCorpus: ["mechanic-mining"],
        // A mine is an RPG's dungeon with a purpose, a survival game's iron and a
        // simulation's reason for a town to be where it is — `vein_of_settlement/2`
        // is the fact a settlement whose seam has run out is legible from.
        genreBundles: ["rpg", "survival", "simulation"]
      }
    },
    {
      id: "dialogue",
      name: "Dialogue goals",
      summary: "Whether what was said in this conversation satisfies what was asked of it, and which quest step that discharges.",
      parts: {
        // US-1 of `195-module-v2-narrative-placement-skills`. It mints exactly ONE
        // runtime predicate — `dialogue_cue_shown/3` — and the singleness is the
        // finding: what has been SAID toward a goal is the one thing neither a
        // world template nor the quest vocabulary had a place for, while "this
        // conversational action was performed" (`conversational_action/4`) and
        // "this pair has talked" (`talked_to/3`) have had one in
        // `prolog/helper-predicates.ts` since quests existed. This module is
        // simply the first thing in core that WRITES them as the output of a
        // decision rather than as an event a bridge happened to catch.
        predicatePack: "dialogue",
        // v1 had no authored section at all. A quest objective carried a
        // `conversationGoal` STRING and a `keywords` array, and
        // `ConversationGoalEvaluator` decided satisfaction by counting how many of
        // the keywords appeared as substrings of the transcript and dividing.
        // `WorldIR.narrative` is the world's TABLE — the goals, the evidence each
        // accepts, what that evidence is worth and which quest step it discharges
        // — keyed by the goal rather than by the objective, exactly as
        // `WorldIR.business` is keyed by the trade rather than by the shop.
        irSection: "narrative",
        // The pure resolution is `src/narrative/dialogue.ts` — integer arithmetic
        // over the authored table and one refusal ladder, with no confidence, no
        // ratio and no rounding anywhere in the module — and this is the half that
        // remembers: every cue produced, every turn spent. It is the third
        // decision layer in this manifest to validate its whole mutation against
        // the predicate schema before any of it lands, and the reason is the
        // shortest yet: it writes `conversational_action/4`, which
        // `objective_complete/3` reads, which `quest_complete/2` reads, so a
        // clause it gets wrong is a quest that finishes itself
        // (`docs/dialogue-goals.md` §5).
        decisionLayer: ["DialogueDirector"],
        // One, and it is `agentAi`'s own — the sixth time in this manifest a
        // module names another's, for exactly `business`'s and `production`'s
        // reason and with the same sharper claim behind it: `talk_to_npc`,
        // `introduce_self`, `haggle_price` and `order_food` are rows
        // `game-engine/action-matrix.ts` ALREADY enumerates, so a curfew, an
        // outlawry or a garrison that speaks to nobody refuses a conversation
        // through `forbids/4` with no line added to any decision layer, and what
        // crosses to a host is an ordinary `ActionOrder`. A dialogue-shaped host
        // hook is precisely where a chat window, a subtitle track and a barks
        // system would have arrived in core.
        hostInterface: ["IAgentActionHost"],
        // One, and for `business`'s reason: everything this module decides is a
        // query. `dialogue_goal_score/3` is the arithmetic, `dialogue_goal_met/2`
        // is the verdict, `dialogue_goal_live/2` and `can_advance_dialogue/3` are
        // the gates. What `DialogueDirector` adds is memory and a schema gate, and
        // memory is pinned by a save round trip rather than by a case.
        conformanceCorpus: ["mechanic-dialogue"],
        // The four bundles with quests AND conversations in them.
        // `language-learning` and `educational` are where the mechanic was born —
        // "order food in French" is a conversation goal and nothing else — and
        // `rpg` and `adventure` are where it earns its keep, because asking the
        // right person the right question is what an adventure IS. `survival`,
        // `simulation`, `strategy` and `puzzle` are left out deliberately: they
        // all have NPCs and some have quests, but nothing in them turns on what
        // was said to get one.
        genreBundles: ["rpg", "adventure", "language-learning", "educational"]
      }
    },
    {
      id: "puzzle",
      name: "Puzzle",
      summary: "Whether this riddle may be put to this player, whether their answer is what the world says, and whether what they have found out opens this lock.",
      parts: {
        // Features Round track G. A riddle is a RELATION over a SUBJECT
        // (`puzzle_riddle/3`) and its answer is never authored: it is the world's
        // own fact — `business_owner/2`, `married_to/2`, `truth_about/2` and the
        // rest — asked through `puzzle_relation_answer/3`. A lock names what
        // opening it needs: a riddle solved, an item held (`has_item/3`, adopted),
        // a text found, another lock opened.
        predicatePack: "puzzle",
        // Optional and usually absent: a world with no authored riddles gets a
        // puzzle GENERATED from what it already is (`src/puzzle/puzzle.ts`).
        irSection: "puzzle",
        // Remembers, per actor, clues found, riddles solved and the wrong answers
        // each cost, locks opened and keys taken; every verdict is the KB's.
        decisionLayer: ["PuzzleDirector"],
        // `agentAi`'s own, for `business`'s reason: opening a lock is the action
        // block's `open_container` row, so once core decides a lock opens it TELLS
        // the host with an ordinary `ActionOrder`. What the host gives back is
        // evidence — this text was read, this answer was chosen — and the verdict
        // never leaves core, the boundary `dialogue` drew.
        hostInterface: ["IAgentActionHost"],
        conformanceCorpus: ["mechanic-puzzle"],
        // The puzzle bundle, and only it: an adventure has mysteries, but its
        // mysteries are quests and conversations (`dialogue`), not locks.
        genreBundles: ["puzzle"]
      }
    },
    {
      id: "platformer",
      name: "Platformer",
      summary: "Which level this runner may play, whether its goal can be reached, which checkpoints the run has touched, and how well it went.",
      parts: {
        // Level structure over the world's own places: a level's goal is where
        // somebody lives or works (`platformer_level_goal/2`,
        // `platformer_level_subject/2`), and whether it can be reached is
        // `traversal`'s `reachable/3` — the pack asks it rather than owning a path.
        predicatePack: "platformer",
        // Optional: a world with no authored levels gets a course GENERATED over
        // its streets, homes and workplaces (`src/platformer/course.ts`).
        irSection: "platformer",
        // Remembers, per runner, the level they are on, the checkpoints touched,
        // the run's cost and the best clear of each level. Every step goes through
        // `TraversalPlanner`, which is the module that moves anybody.
        decisionLayer: ["PlatformerDirector"],
        // `traversal`'s two, the fourth module to name them: a run is a sequence of
        // ordinary movements, the jump onto a doorstep is a geometric link the
        // host's probe is asked about, and the arc of the jump is the engine's. A
        // jump-shaped hook is where a physics step would arrive in core.
        hostInterface: ["ITraversalProbe", "ILocomotionHost"],
        conformanceCorpus: ["mechanic-platformer"],
        genreBundles: ["platformer"]
      }
    },
    {
      id: "strategy",
      name: "Strategy",
      summary: "Which of the world's businesses a faction holds, what they yield and cost it each turn, whether it may take another, and which settlements that adds up to.",
      parts: {
        // Holdings, stockpiles, workers and control over the world generator's
        // business, residence and settlement blocks, read and never written.
        predicatePack: "strategy",
        // Optional; every field falls back on core's table (`src/strategy/strategy.ts`).
        irSection: "strategy",
        // Remembers who holds what, every stockpile, who works where and the turn.
        // Only the player's faction acts (minimal: no opponent AI).
        decisionLayer: ["StrategyDirector"],
        // `agentAi`'s own: a worker turning up at a holding is the action block's
        // `work` row, told once per worker per turn. The board and the turn button
        // are the host's presentation of values the director returns.
        hostInterface: ["IAgentActionHost"],
        conformanceCorpus: ["mechanic-strategy"],
        genreBundles: ["strategy"]
      }
    }
  ];
  var PACKS_WITHOUT_A_MODULE = Object.freeze({
    gameplayState: "Shared state vocabulary, not a mechanic \u2014 `health/3`, `energy/3`, `near/3` and the rest of the adopted gameplay predicates (docs/mechanic-predicates.md \xA710.1). Every module reads it; none owns it.",
    script: "What a WRITER authored in somebody else's tool, not a mechanic the world runs (US-1 of 253-ink-yarn-authoring-inputs, docs/ink-mapping.md \xA76). ink and Yarn Spinner are adopted as AUTHORING INPUTS, so this pack is the shape a compiled `.ink` or `.yarn` file takes in the KB \u2014 the same classification `placement` has, said about narrative instead of props. It fails part 6 by construction and the failure is the right answer: a genre does not select an imported script, because a world in any genre may have had one written for it in Inky, so the pack is ALWAYS active. It fails part 4 too: the host interface a script needs is the one that already exists \u2014 a host shows lines and returns a choice id, exactly as it supplies a dialogue cue rather than a verdict \u2014 and adding an IScriptHost beside it would be the second vocabulary docs/mechanic-predicates.md \xA710.1 exists to prevent. What core owns is the COMPILER (src/narrative/ink-importer.ts), the emit path every front end shares (src/narrative/script-graph.ts) and the vocabulary a corpus can pin, which is why the other parts are real. Part 1 is also where the module contract BINDS a creator who brings a third format: src/narrative/script-importers.ts registers a front end by format, so ink and Yarn Spinner are two registrations rather than two branches, and a creator swaps or extends one without forking core \u2014 but every importer in that registry emits into THIS pack through the one emit path, and checkScriptFacts() refuses a clause outside it. A new syntax is a registration; a new vocabulary is not on offer (US-2 of 253, docs/yarn-mapping.md \xA76).",
    placement: "What a creator PAINTED into the world, not a mechanic the world runs (US-2 of 195-module-v2-narrative-placement-skills, docs/placement-painting.md \xA76). It fails part 6 by construction and the failure is the right answer: a genre does not select painted placement, because a world in any genre may have had trees put on a hill by hand \u2014 so the pack is ALWAYS active, exactly as the scaffold is. It fails part 4 too, and for the sharper reason: the host interface a paint tool needs is an in-editor brush in Unreal, Unity, Godot and the Babylon editor, which is the per-engine leg this tasklist explicitly leaves to the 190-192 default-UI ports and the 144-147 adoption wave. What core owns is the DATA a stroke asserts and the gate it passes first, which is why the other four parts are real: the pack (src/placement/placement-predicates.ts), the IR section (WorldIR.placement), the decision layer (game-engine/logic/PlacementPainter.ts) and \u2014 through the pack's own rules \u2014 the vocabulary a corpus can pin.",
    scaffold: "The shell AROUND the mechanics, not one of them (136-whole-game-scaffolding, docs/whole-game-scaffolding.md \xA77). It fails three of the six parts by construction and each failure is the right answer: no irSection, because a scaffold is authored Prolog a creator edits beside the world rather than a field of WorldIR; no hostInterface, because its decisions are a value core returns and a game that ended is something a host is told through the event bus it already has; and no genreBundles, because \xA72.6 is explicit that a mechanic which is always on is not a module \u2014 every game has a shell, whichever mechanics it selected, so this pack is ALWAYS active. src/scaffold/__tests__/module-position.test.ts holds the classification in both directions."
  });

  // @insimul/core/src/modules/module-activation.ts
  var ALWAYS_ACTIVE_PACKS = Object.freeze(
    Object.keys(PACKS_WITHOUT_A_MODULE)
  );
  var PACK_ORDER = PREDICATE_PACKS.map((pack) => pack.area);
  function describe(module) {
    return {
      id: module.id,
      name: module.name,
      predicatePack: module.parts.predicatePack ?? null,
      irSection: module.parts.irSection ?? null,
      decisionLayer: [...module.parts.decisionLayer ?? []],
      hostInterface: [...module.parts.hostInterface ?? []],
      conforms: module.pending === void 0
    };
  }
  function packsFor(modules) {
    const owned = new Set(modules.map((m) => m.predicatePack).filter((a) => a !== null));
    return PACK_ORDER.filter((area) => owned.has(area) || ALWAYS_ACTIVE_PACKS.includes(area));
  }
  function build(genre, known, modules) {
    return Object.freeze({
      genre,
      known,
      modules: Object.freeze(modules),
      predicatePacks: Object.freeze(packsFor(modules)),
      hostInterfaces: Object.freeze([
        ...new Set(modules.flatMap((m) => [...m.hostInterface]))
      ])
    });
  }
  function resolveActiveModules(genreId) {
    if (!(genreId in GENRE_BUNDLES)) return build(genreId, false, []);
    return build(
      genreId,
      true,
      INSIMUL_MODULES.filter((m) => m.parts.genreBundles?.includes(genreId)).map(describe)
    );
  }
  function activeModulesForWorld(ir) {
    return resolveActiveModules(ir.meta.genreConfig.id);
  }
  var MODULE_ACTIVATION_TABLE = Object.freeze(
    Object.fromEntries(Object.keys(GENRE_BUNDLES).map((id) => [id, resolveActiveModules(id)]))
  );
  function moduleActivationTable() {
    return {
      description: "Genre bundle \u2192 active Insimul modules. Emitted from INSIMUL_MODULES by npm run module-activation; see packages/core/docs/module-contract.md \xA77.",
      alwaysActivePacks: ALWAYS_ACTIVE_PACKS,
      genres: Object.fromEntries(
        Object.entries(MODULE_ACTIVATION_TABLE).map(([id, set]) => [id, set])
      )
    };
  }

  // @insimul/core/src/game-genres/resolution.ts
  var GenreResolutionError = class extends Error {
    constructor(code, message) {
      super(`${code}: ${message}`);
      __publicField(this, "code");
      this.name = "GenreResolutionError";
      this.code = code;
    }
  };
  var hasOwn = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
  function clone(value) {
    return JSON.parse(JSON.stringify(value));
  }
  var ENUM_FIELDS = {
    cameraMode: CAMERA_MODES,
    movementPlane: ["free", "xy", "xz"],
    controlScheme: ["wasd_mouse", "point_click", "controller", "touch"],
    combatStyle: ["melee", "ranged", "hybrid", "none", "turn_based"],
    movementStyle: ["free", "grid", "platformer", "vehicle"],
    uiLayout: ["action_rpg", "fps", "rts", "platformer", "puzzle", "minimal"]
  };
  var OPTIONAL_FEATURE_FLAGS = [
    "knowledgeAcquisition",
    "proficiencyTracking",
    "patternRecognition",
    "assessment",
    "npcExams",
    "performanceScoring",
    "voiceInteraction",
    "adaptiveDifficulty",
    "worldLore",
    "conversationAnalytics",
    "onboarding"
  ];
  function normalizeCameraMode(value) {
    if (typeof value !== "string") return null;
    const key = value.trim().toLowerCase().replace(/[\s-]+/g, "_");
    return CAMERA_MODES.includes(key) ? key : null;
  }
  function bundleFor(genreId) {
    const bundle = genreId === null ? void 0 : getGenreBundle(genreId);
    return bundle ? { id: bundle.id, featureModules: [...bundle.defaultModules] } : { id: null, featureModules: [] };
  }
  function activationFor(genreId) {
    const set = resolveActiveModules(genreId);
    return {
      genre: set.genre,
      known: set.known,
      modules: set.modules.map((m) => m.id),
      predicatePacks: [...set.predicatePacks],
      hostInterfaces: [...set.hostInterfaces]
    };
  }
  function isGenreId(id) {
    return typeof id === "string" && id.length > 0;
  }
  function resolveGenre(requested) {
    if (isGenreId(requested) && hasOwn(GENRE_REGISTRY, requested)) {
      return {
        requested,
        known: true,
        id: requested,
        config: clone(GENRE_REGISTRY[requested]),
        fallback: null,
        bundle: bundleFor(requested),
        activation: activationFor(requested)
      };
    }
    const asked = isGenreId(requested) ? requested : null;
    return {
      requested: asked,
      known: false,
      id: DEFAULT_GENRE_ID,
      config: clone(GENRE_REGISTRY[DEFAULT_GENRE_ID]),
      fallback: { reason: asked === null ? "no-genre" : "unknown-genre", requested: asked, to: DEFAULT_GENRE_ID },
      bundle: { id: null, featureModules: [] },
      // The id that was asked for, not rpg's: an unknown genre gets no mechanics.
      // With no id at all there is still nothing to activate; '' resolves as unknown.
      activation: activationFor(asked ?? "")
    };
  }
  function applyOverride(config, override, recipeId) {
    const where = `recipe '${recipeId}' override '${String(override.path)}'`;
    if (typeof override.path !== "string" || !/^[A-Za-z]+(\.[A-Za-z]+)?$/.test(override.path)) {
      throw new GenreResolutionError("invalid-override", `${where}: a path is 'field' or 'features.field'`);
    }
    const [head, sub] = override.path.split(".");
    const target = config;
    if (head === "id") {
      throw new GenreResolutionError("invalid-override", `${where}: the genre id is not overridable (name another genre instead)`);
    }
    if (sub !== void 0) {
      if (head !== "features") {
        throw new GenreResolutionError("invalid-override", `${where}: only 'features' has sub-fields`);
      }
      const features = config.features;
      if (!hasOwn(features, sub) && !OPTIONAL_FEATURE_FLAGS.includes(sub)) {
        throw new GenreResolutionError("invalid-override", `${where}: features has no '${sub}'`);
      }
      if (typeof override.value !== "boolean") {
        throw new GenreResolutionError("invalid-override", `${where}: a feature switch is a boolean`);
      }
      features[sub] = override.value;
      return;
    }
    if (!hasOwn(target, head)) {
      throw new GenreResolutionError("invalid-override", `${where}: the genre settings have no '${head}'`);
    }
    if (head === "features") {
      throw new GenreResolutionError("invalid-override", `${where}: override one feature at a time ('features.<name>')`);
    }
    const current = target[head];
    const value = override.value;
    if (Array.isArray(current)) {
      if (!Array.isArray(value) || !value.every((v) => typeof v === "string")) {
        throw new GenreResolutionError("invalid-override", `${where}: '${head}' is a list of strings`);
      }
    } else if (typeof current !== typeof value || value === null) {
      throw new GenreResolutionError("invalid-override", `${where}: '${head}' is a ${typeof current}`);
    }
    if (hasOwn(ENUM_FIELDS, head) && !ENUM_FIELDS[head].includes(value)) {
      throw new GenreResolutionError(
        "invalid-override",
        `${where}: '${String(value)}' is not one of ${ENUM_FIELDS[head].join(", ")}`
      );
    }
    target[head] = clone(value);
  }
  function recipeConfig(b) {
    const config = clone(GENRE_REGISTRY[b.genreId]);
    for (const o of b.overrides) applyOverride(config, o, b.recipeId);
    return config;
  }
  function sameJson(a, b) {
    return JSON.stringify(canonical(a)) === JSON.stringify(canonical(b));
  }
  function canonical(value) {
    if (Array.isArray(value)) return value.map(canonical);
    if (value !== null && typeof value === "object") {
      return Object.fromEntries(
        Object.keys(value).sort().map((k) => [k, canonical(value[k])])
      );
    }
    return value;
  }
  function bindingFor(recipe) {
    if (typeof recipe === "string") {
      const bound2 = getRecipeGenreBinding(recipe);
      if (!bound2) {
        throw new GenreResolutionError("unknown-recipe", `core binds no recipe '${recipe}'`);
      }
      return { binding: bound2, bound: true };
    }
    if (recipe === null || typeof recipe !== "object" || !isGenreId(recipe.id) || recipe.genre === null || typeof recipe.genre !== "object" || typeof recipe.genre.id !== "string") {
      throw new GenreResolutionError("invalid-recipe", "a recipe needs a string id and a genre block with a string id");
    }
    const g = recipe.genre;
    if (!hasOwn(GENRE_REGISTRY, g.id)) {
      throw new GenreResolutionError(
        "unknown-recipe-genre",
        `recipe '${recipe.id}' names genre '${g.id}', which the registry does not hold`
      );
    }
    if (g.camera !== void 0 && g.camera !== "recipe" && g.camera !== "world-default") {
      throw new GenreResolutionError("invalid-recipe", `recipe '${recipe.id}': camera is 'recipe' or 'world-default'`);
    }
    if (g.overrides !== void 0 && !Array.isArray(g.overrides)) {
      throw new GenreResolutionError("invalid-recipe", `recipe '${recipe.id}': overrides is a list`);
    }
    if (g.keepWorldConfigFor !== void 0 && (!Array.isArray(g.keepWorldConfigFor) || !g.keepWorldConfigFor.every((x) => typeof x === "string"))) {
      throw new GenreResolutionError("invalid-recipe", `recipe '${recipe.id}': keepWorldConfigFor is a list of genre ids`);
    }
    const bound = getRecipeGenreBinding(recipe.id);
    const stated = {
      recipeId: recipe.id,
      genreId: g.id,
      // Only what the binding reads: a recipe's override also carries its `why`.
      overrides: (g.overrides ?? []).map((o) => ({ path: o?.path, value: o?.value })),
      keepWorldConfigFor: [...g.keepWorldConfigFor ?? []],
      camera: g.camera ?? bound?.camera ?? "recipe"
    };
    if (bound) {
      const drift = [];
      if (stated.genreId !== bound.genreId) drift.push(`genre '${stated.genreId}' (core: '${bound.genreId}')`);
      if (!sameJson(stated.overrides, bound.overrides)) drift.push("overrides");
      if (!sameJson([...stated.keepWorldConfigFor].sort(), [...bound.keepWorldConfigFor].sort())) {
        drift.push("keepWorldConfigFor");
      }
      if (stated.camera !== bound.camera) drift.push(`camera '${stated.camera}' (core: '${bound.camera}')`);
      if (drift.length > 0) {
        throw new GenreResolutionError(
          "recipe-drift",
          `recipe '${recipe.id}' disagrees with core's binding on ${drift.join(", ")}`
        );
      }
    }
    if (g.config !== void 0) {
      const expected = recipeConfig(stated);
      if (!sameJson(g.config, expected)) {
        const fields = Object.keys({ ...expected, ...g.config }).filter(
          (k) => !sameJson(
            g.config[k],
            expected[k]
          )
        );
        throw new GenreResolutionError(
          "recipe-config-drift",
          `recipe '${recipe.id}': genre.config is not the registry's '${g.id}' with the overrides (differs on ${fields.join(", ")})`
        );
      }
    }
    return { binding: bound ?? stated, bound: bound !== void 0 };
  }
  function worldConfig(world) {
    const g = world?.meta?.genreConfig;
    return g !== null && typeof g === "object" && isGenreId(g.id) ? clone(g) : null;
  }
  function resolveGameGenre(request = {}) {
    const notes = [];
    const world = request.world ?? null;
    const own = worldConfig(world);
    const rawPerspective = world?.meta?.cameraPerspective;
    const worldPerspective = typeof rawPerspective === "string" ? rawPerspective : null;
    let config;
    let configSource;
    let fallback = null;
    let policy2;
    let recipeOut = null;
    if (request.recipe !== void 0 && request.recipe !== null) {
      const { binding: binding2, bound } = bindingFor(request.recipe);
      recipeOut = { id: binding2.recipeId, bound };
      policy2 = binding2.camera;
      if (own && binding2.keepWorldConfigFor.includes(own.id)) {
        config = own;
        configSource = "world";
        notes.push({
          code: "world-config-kept",
          detail: `recipe '${binding2.recipeId}' keeps the settings of a '${own.id}' world unchanged`
        });
      } else {
        config = recipeConfig(binding2);
        configSource = "recipe";
      }
    } else {
      policy2 = "world-default";
      if (own) {
        config = own;
        configSource = "world";
      } else {
        const r = resolveGenre(world?.meta?.genreConfig?.id);
        config = r.config;
        configSource = "registry-fallback";
        fallback = r.fallback;
        notes.push({
          code: r.fallback?.reason ?? "no-genre",
          detail: r.fallback?.reason === "unknown-genre" ? `the world names genre '${r.fallback.requested}' and carries no settings; the '${DEFAULT_GENRE_ID}' settings are used` : `the world carries no genre; the '${DEFAULT_GENRE_ID}' settings are used`
        });
      }
    }
    const declared = fallback ? fallback.requested ?? "" : config.id;
    const known = fallback === null && hasOwn(GENRE_REGISTRY, config.id);
    if (!known && configSource === "world") {
      notes.push({
        code: "unknown-genre",
        detail: `the world's genre '${config.id}' is not in the registry: its own settings are kept, and it activates no bundle and no mechanic module`
      });
    }
    const fromConfig = normalizeCameraMode(config.cameraMode);
    let mode = fromConfig ?? GENRE_REGISTRY[DEFAULT_GENRE_ID].cameraMode;
    if (!fromConfig) {
      notes.push({
        code: "config-camera-invalid",
        detail: `genreConfig.cameraMode '${String(config.cameraMode)}' names no camera mode; '${mode}' (the '${DEFAULT_GENRE_ID}' camera) is used`
      });
    }
    let source = "genreConfig.cameraMode";
    const perspective = normalizeCameraMode(worldPerspective);
    if (policy2 === "world-default") {
      if (perspective) {
        mode = perspective;
        source = "meta.cameraPerspective";
      } else if (worldPerspective !== null && worldPerspective.trim() !== "") {
        notes.push({
          code: "world-perspective-ignored",
          detail: `meta.cameraPerspective '${worldPerspective}' names no camera mode; genreConfig.cameraMode '${mode}' stands`
        });
      }
    } else if (perspective && perspective !== mode) {
      notes.push({
        code: "world-perspective-unused",
        detail: `the recipe decides the camera ('${mode}'); the world's '${worldPerspective}' is only a default`
      });
    }
    config.cameraMode = mode;
    return {
      recipe: recipeOut,
      genre: { id: config.id, known, fallback },
      configSource,
      config,
      camera: { mode, policy: policy2, source, worldPerspective },
      bundle: known ? bundleFor(config.id) : { id: null, featureModules: [] },
      activation: activationFor(declared),
      notes
    };
  }

  // @insimul/core/src/game-engine/ir-types.ts
  var DEFAULT_HANDLE_KEY = "default";

  // @insimul/core/src/editor/binding/geometry.ts
  var CORE_CONVENTION = {
    up: "y",
    handedness: "left",
    unitsPerMetre: 1
  };
  var ENGINE_CONVENTIONS = {
    [DEFAULT_HANDLE_KEY]: CORE_CONVENTION,
    babylon: { up: "y", handedness: "left", unitsPerMetre: 1 },
    unity: { up: "y", handedness: "left", unitsPerMetre: 1 },
    godot: { up: "y", handedness: "right", unitsPerMetre: 1 },
    unreal: { up: "z", handedness: "left", unitsPerMetre: 100 }
  };
  var ENTRANCE_SOCKET_KIND = "door";
  function socketByName(geometry, name) {
    if (!name) return null;
    return geometry.sockets.find((socket) => socket.name === name) ?? null;
  }
  function socketsOfKind(geometry, kind) {
    if (!kind) return [];
    return geometry.sockets.filter((socket) => socket.kind === kind);
  }
  function entranceSocket(geometry) {
    const byKind = socketsOfKind(geometry, ENTRANCE_SOCKET_KIND);
    if (byKind.length > 0) return byKind[0];
    return socketByName(geometry, ENTRANCE_SOCKET_KIND);
  }

  // @insimul/core/src/editor/scene/fit.ts
  var FIT_QUANTUM = 1e-3;
  var QUARTER_TURN = Math.PI / 2;
  var TWO_PI = Math.PI * 2;
  var UNBOUNDED_LOT = {
    width: 0,
    depth: 0,
    frontageYaw: 0,
    hasFrontage: false
  };
  function isRecord(v) {
    return typeof v === "object" && v !== null && !Array.isArray(v);
  }
  function positive(v) {
    return typeof v === "number" && Number.isFinite(v) && v > 0 ? v : 0;
  }
  function readFitLot(raw) {
    if (!isRecord(raw)) return { ...UNBOUNDED_LOT };
    const frontage = raw.frontageYaw;
    const hasFrontage = typeof frontage === "number" && Number.isFinite(frontage);
    return {
      width: positive(raw.width),
      depth: positive(raw.depth),
      frontageYaw: hasFrontage ? normalizeYaw(frontage) : 0,
      hasFrontage
    };
  }
  function lotIsBounded(lot) {
    return lot.width > 0 && lot.depth > 0;
  }
  function normalizeYaw(yaw) {
    if (!Number.isFinite(yaw)) return 0;
    let out = yaw % TWO_PI;
    if (out > Math.PI) out -= TWO_PI;
    else if (out <= -Math.PI) out += TWO_PI;
    return out === 0 ? 0 : out;
  }
  function quantizeFitMetre(value) {
    if (!Number.isFinite(value)) return 0;
    const inv = 1 / FIT_QUANTUM;
    const scaled2 = value * inv;
    const rounded = scaled2 < 0 ? -Math.round(-scaled2) : Math.round(scaled2);
    const q = rounded / inv;
    return q === 0 ? 0 : q;
  }
  function rotatedExtent(sizeX, sizeZ, delta) {
    const c = Math.abs(Math.cos(delta));
    const s = Math.abs(Math.sin(delta));
    return {
      across: quantizeFitMetre(sizeX * c + sizeZ * s),
      away: quantizeFitMetre(sizeX * s + sizeZ * c)
    };
  }
  function within(required2, lot) {
    return required2.across <= lot.width + FIT_QUANTUM && required2.away <= lot.depth + FIT_QUANTUM;
  }
  function scaled(size, factor) {
    if (factor === void 0) return { ...size };
    return { x: size.x * factor.x, y: size.y * factor.y, z: size.z * factor.z };
  }
  function alignEntranceYaw(geometry, entrance, frontageYaw) {
    return normalizeYaw(frontageYaw - geometry.yaw - entrance.yaw);
  }
  function checkAssetFit(geometry, lot, placement) {
    const authored = normalizeYaw(placement.rotationY);
    if (!geometry.measured) {
      return {
        outcome: "unmeasured",
        issues: [],
        rotationY: authored,
        aligned: false,
        required: { across: 0, away: 0 }
      };
    }
    const issues = [];
    const entrance = lot.hasFrontage ? entranceSocket(geometry) : null;
    const aligned = entrance !== null;
    const rotationY = aligned ? alignEntranceYaw(geometry, entrance, lot.frontageYaw) : authored;
    if (lot.hasFrontage && !aligned) issues.push("no-entrance-anchor");
    if (geometry.footprint === null) {
      return {
        outcome: issues.length > 0 ? "misfit" : "unmeasured",
        issues,
        rotationY,
        aligned,
        required: { across: 0, away: 0 }
      };
    }
    const size = scaled(scaled(geometry.footprint.size, geometry.scale), placement.scale);
    const delta = lot.hasFrontage ? rotationY + geometry.yaw - lot.frontageYaw : 0;
    const required2 = rotatedExtent(size.x, size.z, delta);
    if (!lotIsBounded(lot)) {
      return {
        outcome: issues.length > 0 ? "misfit" : "unbounded",
        issues,
        rotationY,
        aligned,
        required: required2
      };
    }
    if (!within(required2, lot)) {
      const turned = { across: required2.away, away: required2.across };
      issues.push(within(turned, lot) ? "wrong-aspect" : "too-large");
    }
    issues.sort();
    return {
      outcome: issues.length > 0 ? "misfit" : "fits",
      issues,
      rotationY,
      aligned,
      required: required2
    };
  }

  // @insimul/core/src/editor/layout/plan-geometry.ts
  function planSub(a, b) {
    return [a[0] - b[0], a[1] - b[1]];
  }
  function planDot(a, b) {
    return a[0] * b[0] + a[1] * b[1];
  }
  function planCross(a, b) {
    return a[0] * b[1] - a[1] * b[0];
  }
  function isConvexOutline(p) {
    if (p.length < 3) return false;
    let sign = 0;
    for (let i = 0; i < p.length; i += 1) {
      const a = p[i];
      const b = p[(i + 1) % p.length];
      const c = p[(i + 2) % p.length];
      const z = planCross(planSub(b, a), planSub(c, b));
      if (Math.abs(z) < 1e-12) continue;
      const s = z > 0 ? 1 : -1;
      if (sign === 0) sign = s;
      else if (s !== sign) return false;
    }
    return sign !== 0;
  }
  function satDepth(a, b) {
    let best = Infinity;
    for (const q of [a, b]) {
      for (let i = 0; i < q.length; i += 1) {
        const e = planSub(q[(i + 1) % q.length], q[i]);
        const l = Math.sqrt(e[0] * e[0] + e[1] * e[1]);
        if (l < 1e-12) continue;
        const n = [-e[1] / l, e[0] / l];
        let aMin = Infinity;
        let aMax = -Infinity;
        let bMin = Infinity;
        let bMax = -Infinity;
        for (const v of a) {
          const d = planDot(v, n);
          aMin = Math.min(aMin, d);
          aMax = Math.max(aMax, d);
        }
        for (const v of b) {
          const d = planDot(v, n);
          bMin = Math.min(bMin, d);
          bMax = Math.max(bMax, d);
        }
        const overlap = Math.min(aMax, bMax) - Math.max(aMin, bMin);
        if (overlap <= 0) return 0;
        best = Math.min(best, overlap);
      }
    }
    return best === Infinity ? 0 : best;
  }
  function planSeparation(a, b) {
    let best = -Infinity;
    let axis = [1, 0];
    for (const q of [a, b]) {
      for (let i = 0; i < q.length; i += 1) {
        const e = planSub(q[(i + 1) % q.length], q[i]);
        const l = Math.sqrt(e[0] * e[0] + e[1] * e[1]);
        if (l < 1e-12) continue;
        const n = [-e[1] / l, e[0] / l];
        let aMin = Infinity;
        let aMax = -Infinity;
        let bMin = Infinity;
        let bMax = -Infinity;
        for (const v of a) {
          const d = planDot(v, n);
          aMin = Math.min(aMin, d);
          aMax = Math.max(aMax, d);
        }
        for (const v of b) {
          const d = planDot(v, n);
          bMin = Math.min(bMin, d);
          bMax = Math.max(bMax, d);
        }
        const forward = bMin - aMax;
        const back = aMin - bMax;
        const gap = Math.max(forward, back);
        if (gap > best + 1e-12) {
          best = gap;
          axis = forward >= back ? n : [-n[0], -n[1]];
        }
      }
    }
    return { gap: best === -Infinity ? 0 : best, axis };
  }
  function pointInOutline(p, q) {
    let inside = false;
    for (let i = 0, j = q.length - 1; i < q.length; j = i, i += 1) {
      if (q[i][1] > p[1] !== q[j][1] > p[1] && p[0] < (q[j][0] - q[i][0]) * (p[1] - q[i][1]) / (q[j][1] - q[i][1]) + q[i][0]) {
        inside = !inside;
      }
    }
    return inside;
  }
  function pointSegmentDistance(p, a, b) {
    const ab = planSub(b, a);
    const l2 = planDot(ab, ab);
    let t = l2 > 0 ? planDot(planSub(p, a), ab) / l2 : 0;
    t = Math.max(0, Math.min(1, t));
    const cx = a[0] + t * ab[0] - p[0];
    const cz = a[1] + t * ab[1] - p[1];
    return Math.sqrt(cx * cx + cz * cz);
  }
  function nearestOnSegment(p, a, b) {
    const dx = b[0] - a[0];
    const dz = b[1] - a[1];
    const l2 = dx * dx + dz * dz;
    const t = l2 > 0 ? Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dz) / l2)) : 0;
    return [a[0] + dx * t, a[1] + dz * t];
  }
  function segmentsCross(a, b, c, d) {
    const d1 = planCross(planSub(b, a), planSub(c, a));
    const d2 = planCross(planSub(b, a), planSub(d, a));
    const d3 = planCross(planSub(d, c), planSub(a, c));
    const d4 = planCross(planSub(d, c), planSub(b, c));
    return d1 > 0 !== d2 > 0 && d3 > 0 !== d4 > 0;
  }
  function segmentOutlineDistance(a, b, q) {
    if (pointInOutline(a, q) || pointInOutline(b, q)) return 0;
    let best = Infinity;
    for (let i = 0; i < q.length; i += 1) {
      const c = q[i];
      const d = q[(i + 1) % q.length];
      if (segmentsCross(a, b, c, d)) return 0;
      best = Math.min(
        best,
        pointSegmentDistance(c, a, b),
        pointSegmentDistance(d, a, b),
        pointSegmentDistance(a, c, d),
        pointSegmentDistance(b, c, d)
      );
    }
    return best;
  }
  function triangulateOutline(outline) {
    const out = [];
    let p = [...outline];
    let area = 0;
    for (let i = 0; i < p.length; i += 1) area += planCross(p[i], p[(i + 1) % p.length]);
    if (area < 0) p = p.reverse();
    let guard = 0;
    while (p.length > 3 && guard < 1e4) {
      guard += 1;
      let cut = false;
      for (let i = 0; i < p.length; i += 1) {
        const ia = (i + p.length - 1) % p.length;
        const ic = (i + 1) % p.length;
        const a = p[ia];
        const b = p[i];
        const c = p[ic];
        if (planCross(planSub(b, a), planSub(c, b)) <= 1e-12) continue;
        let empty = true;
        for (let j = 0; j < p.length && empty; j += 1) {
          if (j === ia || j === i || j === ic) continue;
          const q = p[j];
          const d1 = planCross(planSub(b, a), planSub(q, a));
          const d2 = planCross(planSub(c, b), planSub(q, b));
          const d3 = planCross(planSub(a, c), planSub(q, c));
          if (d1 > 0 && d2 > 0 && d3 > 0) empty = false;
        }
        if (!empty) continue;
        out.push([a, b, c]);
        p.splice(i, 1);
        cut = true;
        break;
      }
      if (!cut) break;
    }
    if (p.length >= 3) out.push(p);
    return out;
  }
  function outlineDepth(footprint, outline) {
    if (isConvexOutline(outline)) return satDepth(footprint, outline);
    let deepest = 0;
    for (const t of triangulateOutline(outline)) deepest = Math.max(deepest, satDepth(footprint, t));
    return deepest;
  }
  function quantizeMillimetre(m) {
    const scaled2 = m * 1e3;
    const q = (scaled2 < 0 ? -Math.round(-scaled2) : Math.round(scaled2)) / 1e3;
    return q === 0 ? 0 : q;
  }
  function roundHalfAway(v) {
    return v < 0 ? -Math.round(-v) : Math.round(v);
  }

  // @insimul/core/src/editor/layout/building-fit.ts
  var QUARTER_TURN2 = Math.PI / 2;
  var DOOR_GROUND_FLOOR_BAND_M = 0.6;
  var DOOR_OUTLINE_BAND_M = 1;
  var DOOR_MIN_HEIGHT_M = 1;
  var SEAT_TOLERANCE_M = 0.02;
  var DEFAULT_FIT_SCALE_MIN = 0.5;
  var DEFAULT_FIT_SCALE_MAX = 1;
  var DEFAULT_DOOR_CLEARANCE = 1;
  var DEFAULT_SEAT_SINK = 0;
  var DEFAULT_NEIGHBOUR_GAP_M = 1;
  var STATURE_PER_HEAD_BONE = 1.15;
  var CROWN_RADIUS_M = 0.15;
  var FIT_ISSUE_DOOR_BELOW_BODY = "door-below-body";
  var FIT_OVERLAP_TOLERANCE_M = 0.02;
  function defaultFitPolicy() {
    return {
      mode: "lot",
      scaleMin: DEFAULT_FIT_SCALE_MIN,
      scaleMax: DEFAULT_FIT_SCALE_MAX,
      doorClearance: DEFAULT_DOOR_CLEARANCE,
      seatSink: DEFAULT_SEAT_SINK,
      neighbourGap: DEFAULT_NEIGHBOUR_GAP_M
    };
  }
  function bodyStature(boundsHeight, headBoneHeight = 0, crownTop = 0) {
    if (!(boundsHeight > 0)) return 0;
    const person = headBoneHeight > 0 ? Math.min(boundsHeight, headBoneHeight * STATURE_PER_HEAD_BONE) : boundsHeight;
    if (!(person > 0) || !(crownTop > 0)) return person;
    return Math.min(boundsHeight, Math.max(person, crownTop));
  }
  function noDoor() {
    return { source: "none", name: "", hasPosition: false, position: { x: 0, y: 0, z: 0 }, yaw: 0, candidates: 0, height: 0 };
  }
  function isDoorPartName(c) {
    if (c.mesh !== "") return c.mesh.toLowerCase().includes("door");
    return c.component.toLowerCase().includes("door") || c.owner.toLowerCase().includes("door");
  }
  function faceYawOf(p, min, max) {
    const sides = [max.z - p.z, max.x - p.x, p.x - min.x, p.z - min.z];
    const yaws = [0, QUARTER_TURN2, -QUARTER_TURN2, Math.PI];
    let best = 0;
    for (let i = 1; i < 4; i += 1) {
      if (sides[i] < sides[best] - 1e-11) best = i;
    }
    return yaws[best];
  }
  function faceCentreFor(yaw, min, max, y) {
    const cf = (min.z + max.z) / 2;
    const cr = (min.x + max.x) / 2;
    const hf = (max.z - min.z) / 2;
    const hr = (max.x - min.x) / 2;
    const df = Math.cos(yaw);
    const dr = Math.sin(yaw);
    const tf = Math.abs(df) > 1e-12 ? hf / Math.abs(df) : Infinity;
    const tr = Math.abs(dr) > 1e-12 ? hr / Math.abs(dr) : Infinity;
    const t = Math.min(tf, tr);
    return { x: cr + dr * t, y, z: cf + df * t };
  }
  function facingRank(yaw) {
    if (yaw === 0) return 0;
    if (yaw === QUARTER_TURN2) return 1;
    if (yaw === -QUARTER_TURN2) return 2;
    return 3;
  }
  function compareStrings(a, b) {
    return a < b ? -1 : a > b ? 1 : 0;
  }
  function chooseDoorPart(parts, boundsMin, boundsMax) {
    const upright = [];
    let named = 0;
    for (const p of parts) {
      if (!isDoorPartName(p)) continue;
      named += 1;
      const h = p.max.y - p.min.y;
      const w = Math.max(p.max.z - p.min.z, p.max.x - p.min.x);
      if (h < DOOR_MIN_HEIGHT_M || h < 0.5 * w) continue;
      const c = { x: (p.min.x + p.max.x) / 2, y: p.min.y, z: (p.min.z + p.max.z) / 2 };
      const outline = Math.min(boundsMax.z - c.z, boundsMax.x - c.x, c.x - boundsMin.x, c.z - boundsMin.z);
      const yaw = faceYawOf(c, boundsMin, boundsMax);
      const mesh = (p.mesh === "" ? p.component : p.mesh).toLowerCase();
      upright.push({ part: p, leaf: !mesh.includes("wall"), outline, yaw, facingRank: facingRank(yaw) });
    }
    const out = noDoor();
    out.candidates = named;
    if (upright.length === 0) return out;
    let lowest = Infinity;
    for (const r of upright) lowest = Math.min(lowest, r.part.min.y);
    let ground = upright.filter((r) => r.part.min.y <= lowest + DOOR_GROUND_FLOOR_BAND_M);
    if (ground.some((r) => r.leaf)) ground = ground.filter((r) => r.leaf);
    let nearest = Infinity;
    for (const r of ground) nearest = Math.min(nearest, r.outline);
    const near = ground.filter((r) => r.outline <= nearest + DOOR_OUTLINE_BAND_M);
    near.sort((a, b) => a.facingRank - b.facingRank || (a.outline < b.outline ? -1 : a.outline > b.outline ? 1 : 0) || compareStrings(a.part.component, b.part.component) || compareStrings(a.part.owner, b.part.owner));
    const chosen = near[0];
    out.source = "component";
    out.name = chosen.part.component;
    out.hasPosition = true;
    out.position = {
      x: (chosen.part.min.x + chosen.part.max.x) / 2,
      y: chosen.part.min.y,
      z: (chosen.part.min.z + chosen.part.max.z) / 2
    };
    out.yaw = chosen.yaw;
    out.height = chosen.part.max.y - chosen.part.min.y;
    return out;
  }
  function streetHeadingOf(frontageYaw) {
    return normalizeYaw(QUARTER_TURN2 - frontageYaw);
  }
  function quantizeFactor(f) {
    const q = (f < 0 ? -Math.round(-f * 1e6) : Math.round(f * 1e6)) / 1e6;
    return q === 0 ? 0 : q;
  }
  function turn(forward, right, heading) {
    const c = Math.cos(heading);
    const s = Math.sin(heading);
    return [forward * c - right * s, forward * s + right * c];
  }
  function emptySeat() {
    return { sampled: false, groundMin: 0, groundMax: 0, foundation: 0, float: 0, sink: 0 };
  }
  function sampleGrid(g, x, z) {
    const { heights, resolution, sizeX, sizeZ } = g;
    if (resolution < 1 || heights.length === 0) return 0;
    if (resolution === 1) return heights[0];
    if (sizeX <= 0 || sizeZ <= 0) return heights[0];
    let gx = x / sizeX * (resolution - 1);
    let gz = z / sizeZ * (resolution - 1);
    gx = Math.min(Math.max(gx, 0), resolution - 1);
    gz = Math.min(Math.max(gz, 0), resolution - 1);
    const x0 = Math.floor(gx);
    const z0 = Math.floor(gz);
    const x1 = Math.min(x0 + 1, resolution - 1);
    const z1 = Math.min(z0 + 1, resolution - 1);
    const fx = gx - x0;
    const fz = gz - z0;
    const at = (xi, zi) => {
      const idx = zi * resolution + xi;
      return idx < heights.length ? heights[idx] : 0;
    };
    const top = at(x0, z0) + (at(x1, z0) - at(x0, z0)) * fx;
    const bot = at(x0, z1) + (at(x1, z1) - at(x0, z1)) * fx;
    return top + (bot - top) * fz;
  }
  function layoutGroundAt(g, x, z) {
    return sampleGrid(g, x, z);
  }
  function fitBuildingToLot(input) {
    const policy2 = { ...input.policy };
    const notApplied = (why) => ({
      applied: false,
      notApplied: why,
      fit: { outcome: "unmeasured", issues: [], rotationY: 0, aligned: false, required: { across: 0, away: 0 } },
      lot: { width: 0, depth: 0, frontageYaw: 0, hasFrontage: false },
      streetHeading: 0,
      wantedFactor: 1,
      factor: 1,
      limited: false,
      doorFactor: 0,
      doorHeld: false,
      doorHeight: 0,
      castHeight: 0,
      policy: policy2,
      scale: { x: 1, y: 1, z: 1 },
      fixupScale: { x: 1, y: 1, z: 1 },
      heading: 0,
      fixupHeading: 0,
      location: { x: 0, y: 0, z: 0 },
      offsetFromNode: { x: 0, y: 0, z: 0 },
      door: noDoor(),
      doorWorld: { x: 0, y: 0, z: 0 },
      doorHeading: 0,
      seat: emptySeat(),
      footprint: { entityId: input.entityId, lotId: input.lotId, corners: [[0, 0], [0, 0], [0, 0], [0, 0]] },
      settleShift: [0, 0],
      notes: []
    });
    if (input.lot === null) return notApplied("no-lot");
    if (policy2.mode === "none") return notApplied("fit-none");
    const inLot2 = input.lot;
    const notes = [];
    let door2 = { ...input.door, position: { ...input.door.position } };
    if (door2.source === "none" && policy2.doorYaw !== void 0) {
      door2 = { ...door2, source: "binding_yaw", name: "doorYaw", yaw: policy2.doorYaw, hasPosition: false };
    }
    const hasDoor = door2.source !== "none";
    const hostLot = {
      width: inLot2.width,
      depth: inLot2.depth,
      frontageYaw: inLot2.hasFrontage ? streetHeadingOf(inLot2.frontageYaw) : 0,
      hasFrontage: inLot2.hasFrontage
    };
    const streetHeading = inLot2.hasFrontage ? hostLot.frontageYaw : 0;
    const b = input.bounds;
    const size = b === null ? null : { x: b.max.x - b.min.x, y: b.max.y - b.min.y, z: b.max.z - b.min.z };
    const hasFootprint = size !== null && size.x > 0 && size.y > 0 && size.z > 0;
    const g = input.geometry;
    const sockets = hasDoor ? [{ name: "door", kind: "door", position: { ...door2.position }, yaw: door2.yaw, node: "" }] : [];
    const checkGeometry = (factor2) => ({
      convention: CORE_CONVENTION,
      measured: true,
      footprint: hasFootprint && size !== null ? { size, pivot: { x: 0, y: 0, z: 0 } } : null,
      offset: { ...g.offset },
      yaw: g.yaw,
      scale: { x: g.scale.x * factor2, y: g.scale.y * factor2, z: g.scale.z * factor2 },
      sockets
    });
    const placement = { rotationY: input.nodeHeading, scale: { ...input.nodeScale } };
    const first = checkAssetFit(checkGeometry(1), hostLot, placement);
    let wanted = 1;
    if (hasFootprint && lotIsBounded(inLot2) && first.required.across > 0 && first.required.away > 0) {
      wanted = Math.min(inLot2.width / first.required.across, inLot2.depth / first.required.away);
    }
    const wantedFactor = quantizeFactor(wanted);
    const lotFactor = Math.max(policy2.scaleMin, Math.min(policy2.scaleMax, wanted));
    let factor = lotFactor;
    const limited = wanted < policy2.scaleMin - 1e-9;
    let doorShort = false;
    let doorFactor = 0;
    let doorHeld = false;
    const doorLocal = door2.height * g.scale.y * input.nodeScale.y;
    if (policy2.doorClearance > 0 && input.castHeight > 0 && doorLocal > 0) {
      const floor = input.castHeight * policy2.doorClearance / doorLocal;
      doorFactor = quantizeFactor(floor);
      if (floor > factor + 1e-9) {
        if (floor <= policy2.scaleMax + 1e-9) {
          factor = Math.min(policy2.scaleMax, Math.ceil(floor * 1e6) / 1e6);
          doorHeld = true;
        } else {
          factor = policy2.scaleMax;
          doorHeld = factor > lotFactor + 1e-9;
          doorShort = true;
        }
      }
    }
    factor = quantizeFactor(factor);
    const doorHeight = doorLocal * factor;
    const fit = checkAssetFit(checkGeometry(factor), hostLot, placement);
    let fitOut = fit;
    if (doorShort) {
      const issues = [.../* @__PURE__ */ new Set([...fit.issues, FIT_ISSUE_DOOR_BELOW_BODY])].sort();
      fitOut = { ...fit, outcome: "misfit", issues };
    }
    const fixupScale = { x: g.scale.x * factor, y: g.scale.y * factor, z: g.scale.z * factor };
    const scale = { x: input.nodeScale.x * fixupScale.x, y: input.nodeScale.y * fixupScale.y, z: input.nodeScale.z * fixupScale.z };
    const heading = normalizeYaw(fitOut.rotationY + g.yaw);
    const fixupHeading = normalizeYaw(heading - input.nodeHeading);
    const target = input.lotCentre !== null ? [input.lotCentre[0], input.lotCentre[1]] : [input.node.x, input.node.z];
    const settleShift = [input.settleShift[0], input.settleShift[1]];
    target[0] += settleShift[0];
    target[1] += settleShift[1];
    if (doorHeld && lotIsBounded(inLot2) && inLot2.hasFrontage && fitOut.required.away > inLot2.depth + FIT_QUANTUM) {
      const back = (fitOut.required.away - inLot2.depth) / 2;
      target[0] -= Math.cos(hostLot.frontageYaw) * back;
      target[1] -= Math.sin(hostLot.frontageYaw) * back;
    }
    let centreF = 0;
    let centreR = 0;
    if (b !== null) {
      centreF = (b.min.z + b.max.z) / 2;
      centreR = (b.min.x + b.max.x) / 2;
    } else {
      notes.push("no-bounds");
    }
    const shift = turn((g.offset.z - centreF) * scale.z, (g.offset.x - centreR) * scale.x, heading);
    const location = { x: target[0] + shift[0], y: input.node.y, z: target[1] + shift[1] };
    const corners = [];
    if (b !== null) {
      const fs = [b.min.z, b.max.z, b.max.z, b.min.z];
      const rs = [b.min.x, b.min.x, b.max.x, b.max.x];
      for (let i = 0; i < 4; i += 1) {
        const w = turn(fs[i] * scale.z, rs[i] * scale.x, heading);
        corners.push([location.x + w[0], location.z + w[1]]);
      }
    } else {
      for (let i = 0; i < 4; i += 1) corners.push([location.x, location.z]);
    }
    const bottom = b !== null ? b.min.y : 0;
    const floorKnown = hasDoor && door2.hasPosition;
    const floorLocal = floorKnown ? Math.max(door2.position.y, bottom) : bottom;
    let y = input.node.y - bottom * scale.y;
    const seat = emptySeat();
    if (input.ground !== null) {
      let gMin = Infinity;
      let gMax = -Infinity;
      const samples = corners.map((c) => [c[0], c[1]]);
      for (let i = 0; i < 4; i += 1) {
        const a = corners[i];
        const c = corners[(i + 1) % 4];
        samples.push([(a[0] + c[0]) / 2, (a[1] + c[1]) / 2]);
      }
      samples.push([target[0], target[1]]);
      for (const s of samples) {
        const h = sampleGrid(input.ground, s[0], s[1]);
        gMin = Math.min(gMin, h);
        gMax = Math.max(gMax, h);
      }
      if (gMin <= gMax) {
        seat.sampled = true;
        seat.groundMin = gMin;
        seat.groundMax = gMax;
        const bottomOnLow = gMin - bottom * scale.y;
        const floorOnHigh = gMax - floorLocal * scale.y;
        seat.foundation = (floorLocal - bottom) * scale.y;
        const sink = floorKnown ? Math.max(0, Math.min(1, policy2.seatSink)) * seat.foundation : 0;
        y = floorKnown ? Math.max(bottomOnLow - sink, floorOnHigh) : bottomOnLow;
        const float = y + bottom * scale.y - gMin;
        seat.float = float > SEAT_TOLERANCE_M ? float : 0;
        seat.sink = float < -SEAT_TOLERANCE_M ? -float : 0;
        if (policy2.seatSink > 0 && !floorKnown) notes.push("seat-sink-needs-floor");
        if (!floorKnown && gMax - gMin > SEAT_TOLERANCE_M) notes.push("no-floor");
      }
    }
    y += g.offset.y * scale.y;
    location.y = y;
    const offsetFromNode = { x: location.x - input.node.x, y: location.y - input.node.y, z: location.z - input.node.z };
    let doorWorld = { x: 0, y: 0, z: 0 };
    let doorHeading = 0;
    if (hasDoor) {
      let local;
      if (b !== null) {
        const face = faceCentreFor(door2.yaw, b.min, b.max, floorLocal);
        if (door2.hasPosition) {
          const alongRight = Math.abs(Math.cos(door2.yaw)) > 0.5;
          local = alongRight ? { x: door2.position.x, y: floorLocal, z: face.z } : { x: face.x, y: floorLocal, z: door2.position.z };
        } else {
          local = face;
        }
      } else {
        local = door2.hasPosition ? { ...door2.position } : { x: 0, y: 0, z: 0 };
      }
      const w = turn(local.z * scale.z, local.x * scale.x, heading);
      doorWorld = { x: location.x + w[0], y: location.y + local.y * scale.y, z: location.z + w[1] };
      doorHeading = normalizeYaw(heading + door2.yaw);
    } else {
      notes.push("no-door");
    }
    if (doorHeld) notes.push("door-held");
    if (doorShort) notes.push("door-below-body");
    if (policy2.doorClearance > 0 && input.castHeight > 0 && hasDoor && doorLocal <= 0) notes.push("door-unmeasured");
    if (limited) notes.push("limited");
    if (Math.hypot(settleShift[0], settleShift[1]) > 5e-4) notes.push("settled");
    return {
      applied: true,
      notApplied: null,
      fit: fitOut,
      lot: hostLot,
      streetHeading,
      wantedFactor,
      factor,
      limited,
      doorFactor,
      doorHeld,
      doorHeight,
      castHeight: input.castHeight,
      policy: policy2,
      scale,
      fixupScale,
      heading,
      fixupHeading,
      location,
      offsetFromNode,
      door: door2,
      doorWorld,
      doorHeading,
      seat,
      footprint: { entityId: input.entityId, lotId: input.lotId, corners },
      settleShift,
      notes
    };
  }
  function findFitOverlaps(buildings, obstacles2) {
    const out = [];
    for (let i = 0; i < buildings.length; i += 1) {
      const a = buildings[i].corners;
      for (let j = 0; j < buildings.length; j += 1) {
        if (i === j) continue;
        const d = satDepth(a, buildings[j].corners);
        if (d > FIT_OVERLAP_TOLERANCE_M) out.push({ entityId: buildings[i].entityId, with: buildings[j].entityId, withKind: "building", depth: d });
      }
      for (const o of obstacles2) {
        if (o.points.length < 2) continue;
        if (o.lotId !== "" && o.lotId === buildings[i].lotId) continue;
        let depth;
        if (o.closed && o.points.length >= 3) {
          depth = outlineDepth(a, o.points);
        } else {
          let nearest = Infinity;
          for (let k = 0; k + 1 < o.points.length; k += 1) {
            nearest = Math.min(nearest, segmentOutlineDistance(o.points[k], o.points[k + 1], a));
          }
          depth = o.halfWidth - nearest;
        }
        if (depth > FIT_OVERLAP_TOLERANCE_M) out.push({ entityId: buildings[i].entityId, with: o.entityId, withKind: o.kind, depth });
      }
    }
    out.sort((x, y) => compareStrings(x.entityId, y.entityId) || compareStrings(x.withKind, y.withKind) || compareStrings(x.with, y.with));
    return out;
  }

  // @insimul/core/src/editor/layout/settle.ts
  var SETTLE_OBSTACLE_GAP_M = 0.25;
  var SETTLE_BUILDING_MAX_SHIFT_M = 2;
  var SETTLE_BUILDING_EXTRA_SHIFT_M = 1.5;
  var SETTLE_DEFAULT_NEIGHBOUR_GAP_M = 1;
  var CLEARANCE_BUILDING = 0;
  var CLEARANCE_PROP = 1;
  var CLEARANCE_PLANT = 2;
  var PROP_CLEARANCE_MAX_SHIFT_M = 2.5;
  var PLANT_CLEARANCE_MAX_SHIFT_M = 3;
  var PLANT_PAVING_CLEARANCE_M = 0.3;
  var POST_CLEARANCE_M = 3;
  var CLEARANCE_INSIDE_TOLERANCE_M = 0.02;
  var PLANT_TRUNK_HALF_M = 0.25;
  var BANNER_ARCHETYPE_PREFIX = "prop.structural.banner";
  var SETTLE_DEFAULT_ITERATIONS = 128;
  var SLACK = 1e-4;
  var neighbourPairGap = (a, b) => Math.max(a.gap, b.gap);
  function settleBuildingMaxShiftM(neighbourGap) {
    if (!Number.isFinite(neighbourGap) || neighbourGap <= SETTLE_DEFAULT_NEIGHBOUR_GAP_M + 1e-9) return SETTLE_BUILDING_MAX_SHIFT_M;
    return Math.max(SETTLE_BUILDING_MAX_SHIFT_M, neighbourGap + SETTLE_BUILDING_EXTRA_SHIFT_M);
  }
  function plantWallClearanceM(crownRadius) {
    const r = !Number.isFinite(crownRadius) || crownRadius < 0 ? 0 : crownRadius;
    return Math.max(0.5, Math.min(2, r / 3));
  }
  function isPostShape(height, longestPlan) {
    if (!Number.isFinite(height) || !Number.isFinite(longestPlan) || longestPlan <= 0) return false;
    return height >= 1.8 && height >= 2.5 * longestPlan;
  }
  function markerClearanceM(archetype, height, longestPlan) {
    if (isPostShape(height, longestPlan)) return POST_CLEARANCE_M;
    if (archetype.startsWith(BANNER_ARCHETYPE_PREFIX)) return POST_CLEARANCE_M;
    return 0;
  }
  function clearancePairGap(classA, gapA, classB, gapB) {
    let ca = classA;
    let ga = gapA;
    let cb = classB;
    let gb = gapB;
    if (ca > cb) {
      [ca, cb] = [cb, ca];
      [ga, gb] = [gb, ga];
    }
    if (ca === CLEARANCE_BUILDING && cb === CLEARANCE_BUILDING) return -1;
    if (ca === CLEARANCE_BUILDING && cb === CLEARANCE_PROP) return 0.15;
    if (ca === CLEARANCE_BUILDING && cb === CLEARANCE_PLANT) return gb;
    if (ca === CLEARANCE_PROP && cb === CLEARANCE_PROP) return ga > 0 && gb > 0 ? Math.max(0.05, Math.min(ga, gb)) : 0.05;
    if (ca === CLEARANCE_PROP && cb === CLEARANCE_PLANT) return 0.3;
    return -1;
  }
  function settlePairGapOf(rule) {
    return rule === "neighbour" ? neighbourPairGap : (a, b) => clearancePairGap(a.class, a.gap, b.class, b.gap);
  }
  function obstaclePieces(obstacles2) {
    const out = [];
    for (const o of obstacles2) {
      if (o.points.length < 2) continue;
      const p = o.points;
      if (o.closed && p.length >= 3) {
        if (isConvexOutline(p)) out.push({ outline: [...p], entityId: o.entityId, lotId: o.lotId });
        else for (const t of triangulateOutline(p)) out.push({ outline: t, entityId: o.entityId, lotId: o.lotId });
        continue;
      }
      if (o.halfWidth <= 0) continue;
      for (let k = 0; k + 1 < p.length; k += 1) {
        const a = p[k];
        const b = p[k + 1];
        const dx = b[0] - a[0];
        const dz = b[1] - a[1];
        const l = Math.sqrt(dx * dx + dz * dz);
        const u = l > 1e-9 ? [dx / l, dz / l] : [1, 0];
        const n = [-u[1] * o.halfWidth, u[0] * o.halfWidth];
        const e = [u[0] * o.halfWidth, u[1] * o.halfWidth];
        out.push({
          outline: [
            [a[0] - e[0] + n[0], a[1] - e[1] + n[1]],
            [b[0] + e[0] + n[0], b[1] + e[1] + n[1]],
            [b[0] + e[0] - n[0], b[1] + e[1] - n[1]],
            [a[0] - e[0] - n[0], a[1] - e[1] - n[1]]
          ],
          entityId: o.entityId,
          lotId: o.lotId
        });
      }
    }
    return out;
  }
  function moved(p, d) {
    return p.map((v) => [v[0] + d[0], v[1] + d[1]]);
  }
  function circle(p) {
    let cx = 0;
    let cz = 0;
    for (const v of p) {
      cx += v[0];
      cz += v[1];
    }
    if (p.length > 0) {
      cx /= p.length;
      cz /= p.length;
    }
    let r = 0;
    for (const v of p) r = Math.max(r, Math.hypot(v[0] - cx, v[1] - cz));
    return { centre: [cx, cz], radius: r };
  }
  function settleSeparation(a, b) {
    return planSeparation(a, b);
  }
  function settleBodies(bodies, obstacles2, pairGap, iterations = SETTLE_DEFAULT_ITERATIONS) {
    const n = bodies.length;
    const base = bodies.map((b) => b.outline);
    const shift = bodies.map(() => [0, 0]);
    const limited = bodies.map(() => false);
    const movable = (i) => bodies[i].mass > 0 && bodies[i].maxShift > 0 && base[i].length >= 3;
    const clamp = (i) => {
      const l = Math.sqrt(shift[i][0] * shift[i][0] + shift[i][1] * shift[i][1]);
      if (l > bodies[i].maxShift) {
        shift[i][0] *= bodies[i].maxShift / l;
        shift[i][1] *= bodies[i].maxShift / l;
        limited[i] = true;
      }
    };
    const pieces = obstaclePieces(obstacles2);
    const circles = base.map((p) => circle(p));
    const reach = (i) => circles[i].radius + (movable(i) ? bodies[i].maxShift : 0);
    const pairs = [];
    for (let i = 0; i < n; i += 1) {
      for (let j = i + 1; j < n; j += 1) {
        if (!movable(i) && !movable(j) || base[i].length < 3 || base[j].length < 3) continue;
        const g = pairGap(bodies[i], bodies[j]);
        if (g < 0) continue;
        const ci = circles[i].centre;
        const cj = circles[j].centre;
        if (Math.hypot(ci[0] - cj[0], ci[1] - cj[1]) > reach(i) + reach(j) + g) continue;
        pairs.push({ i, j, gap: g });
      }
    }
    const near = bodies.map(() => []);
    for (let i = 0; i < n; i += 1) {
      if (!movable(i) || bodies[i].obstacleGap < 0) continue;
      for (let k = 0; k < pieces.length; k += 1) {
        const o = pieces[k];
        if (o.lotId !== "" && o.lotId === bodies[i].lotId) continue;
        const c = circle(o.outline);
        const ci = circles[i].centre;
        if (Math.hypot(ci[0] - c.centre[0], ci[1] - c.centre[1]) > reach(i) + c.radius + bodies[i].obstacleGap) continue;
        near[i].push(k);
      }
    }
    for (let it = 0; it < Math.max(1, iterations); it += 1) {
      let worst = 0;
      for (const p of pairs) {
        const sep = planSeparation(moved(base[p.i], shift[p.i]), moved(base[p.j], shift[p.j]));
        const short = p.gap - sep.gap;
        if (short <= SLACK) continue;
        const mi = movable(p.i);
        const mj = movable(p.j);
        let shareI = 0;
        let shareJ = 0;
        if (mi && mj) {
          const massI = bodies[p.i].mass;
          const massJ = bodies[p.j].mass;
          shareI = massJ / (massI + massJ);
          shareJ = massI / (massI + massJ);
        } else if (mi) {
          shareI = 1;
        } else {
          shareJ = 1;
        }
        const push = short + SLACK;
        const beforeI = [shift[p.i][0], shift[p.i][1]];
        const beforeJ = [shift[p.j][0], shift[p.j][1]];
        shift[p.i][0] -= sep.axis[0] * push * shareI;
        shift[p.i][1] -= sep.axis[1] * push * shareI;
        shift[p.j][0] += sep.axis[0] * push * shareJ;
        shift[p.j][1] += sep.axis[1] * push * shareJ;
        clamp(p.i);
        clamp(p.j);
        const movedBy = Math.hypot(shift[p.i][0] - beforeI[0], shift[p.i][1] - beforeI[1]) + Math.hypot(shift[p.j][0] - beforeJ[0], shift[p.j][1] - beforeJ[1]);
        if (movedBy > SLACK) worst = Math.max(worst, short);
      }
      for (let i = 0; i < n; i += 1) {
        for (const k of near[i]) {
          const o = pieces[k];
          const sep = planSeparation(moved(base[i], shift[i]), o.outline);
          const short = bodies[i].obstacleGap - sep.gap;
          if (short <= SLACK) continue;
          const before = [shift[i][0], shift[i][1]];
          shift[i][0] -= sep.axis[0] * (short + SLACK);
          shift[i][1] -= sep.axis[1] * (short + SLACK);
          clamp(i);
          if (Math.hypot(shift[i][0] - before[0], shift[i][1] - before[1]) > SLACK) worst = Math.max(worst, short);
        }
      }
      if (worst <= SLACK) break;
    }
    const out = bodies.map((b, i) => ({
      entityId: b.entityId,
      dx: quantizeMillimetre(shift[i][0]),
      dz: quantizeMillimetre(shift[i][1]),
      short: 0,
      shortOf: "",
      limited: limited[i]
    }));
    for (let i = 0; i < n; i += 1) shift[i] = [out[i].dx, out[i].dz];
    const note = (i, short, of) => {
      if (short > out[i].short + 1e-9) {
        out[i].short = short;
        out[i].shortOf = of;
      }
    };
    for (const p of pairs) {
      const short = p.gap - planSeparation(moved(base[p.i], shift[p.i]), moved(base[p.j], shift[p.j])).gap;
      if (short < 0.01) continue;
      note(p.i, short, bodies[p.j].entityId);
      note(p.j, short, bodies[p.i].entityId);
    }
    for (let i = 0; i < n; i += 1) {
      for (const k of near[i]) {
        const o = pieces[k];
        const short = bodies[i].obstacleGap - planSeparation(moved(base[i], shift[i]), o.outline).gap;
        if (short >= 0.01) note(i, short, o.entityId);
      }
    }
    for (const m of out) m.short = quantizeMillimetre(m.short);
    return out;
  }
  function clearanceSetAsides(bodies, moves) {
    const out = [];
    if (moves.length !== bodies.length) return out;
    const buildings = [];
    for (let i = 0; i < bodies.length; i += 1) {
      if (bodies[i].class === CLEARANCE_BUILDING && bodies[i].outline.length >= 3) buildings.push(i);
    }
    const movedOf = (i) => moved(bodies[i].outline, [moves[i].dx, moves[i].dz]);
    for (let i = 0; i < bodies.length; i += 1) {
      const b = bodies[i];
      if (b.class === CLEARANCE_BUILDING || b.outline.length < 3) continue;
      const mine = movedOf(i);
      const worst = { index: i, buildingId: "", inside: 0 };
      for (const k of buildings) {
        const sep = planSeparation(mine, movedOf(k)).gap;
        if (-sep > worst.inside) {
          worst.inside = -sep;
          worst.buildingId = bodies[k].entityId;
        }
      }
      if (worst.inside > CLEARANCE_INSIDE_TOLERANCE_M) out.push(worst);
    }
    return out;
  }
  function settleFittedBuildings(buildings, obstacles2, iterations = SETTLE_DEFAULT_ITERATIONS) {
    const bodies = buildings.map((b) => {
      const gap = Math.max(0, b.neighbourGap);
      return {
        entityId: b.entityId,
        lotId: b.lotId,
        outline: b.corners.map((c) => [c[0], c[1]]),
        mass: 1,
        maxShift: settleBuildingMaxShiftM(gap),
        obstacleGap: SETTLE_OBSTACLE_GAP_M,
        class: CLEARANCE_BUILDING,
        gap
      };
    });
    return settleBodies(bodies, obstacles2, neighbourPairGap, iterations);
  }
  function plantTrunkOutline(x, z) {
    const h = PLANT_TRUNK_HALF_M;
    return [[x - h, z - h], [x + h, z - h], [x + h, z + h], [x - h, z + h]];
  }
  function clearanceBodyOf(item) {
    const outline = item.outline.map((c) => [c[0], c[1]]);
    if (item.kind === "building") {
      return { entityId: item.entityId, lotId: "", outline, mass: 0, maxShift: 0, obstacleGap: -1, class: CLEARANCE_BUILDING, gap: 0 };
    }
    if (item.kind === "plant") {
      return {
        entityId: item.entityId,
        lotId: "",
        outline,
        mass: 1e-3,
        maxShift: PLANT_CLEARANCE_MAX_SHIFT_M,
        obstacleGap: PLANT_PAVING_CLEARANCE_M,
        class: CLEARANCE_PLANT,
        gap: plantWallClearanceM(item.crownRadius ?? 1)
      };
    }
    return {
      entityId: item.entityId,
      lotId: "",
      outline,
      mass: Math.max(0.01, item.area ?? 0),
      maxShift: PROP_CLEARANCE_MAX_SHIFT_M,
      obstacleGap: -1,
      // a prop may stand on paving (a market's barrels on the square)
      class: CLEARANCE_PROP,
      gap: markerClearanceM(item.archetype ?? "", item.height ?? 0, item.longestPlan ?? 0)
    };
  }
  function settleClearance(items, obstacles2, iterations = SETTLE_DEFAULT_ITERATIONS) {
    const bodies = items.map(clearanceBodyOf);
    const moves = settleBodies(bodies, obstacles2, settlePairGapOf("clearance"), iterations);
    return { moves, setAsides: clearanceSetAsides(bodies, moves) };
  }

  // @insimul/core/src/editor/layout/pairing.ts
  var PAIRING_NEIGHBOUR_GAP_M = 6;
  var PAIRING_STEP_M = 0.3;
  var PAIRING_MAX_SEAT_SINK = 0.9;
  function pairingSeatSink(bottom, doorFoot, factor) {
    if (doorFoot === null) return null;
    const foundation = (Math.max(doorFoot, bottom) - bottom) * Math.max(0.05, factor);
    if (foundation <= PAIRING_STEP_M * 1.5) return null;
    const ratio = (foundation - PAIRING_STEP_M) / foundation * 100;
    const sink = (ratio < 0 ? -Math.round(-ratio) : Math.round(ratio)) / 100;
    return Math.min(PAIRING_MAX_SEAT_SINK, sink);
  }

  // @insimul/core/src/editor/layout/backdrop.ts
  var CRC_TABLE = (() => {
    const t = new Uint32Array(256);
    for (let i = 0; i < 256; i += 1) {
      let c = i;
      for (let k = 0; k < 8; k += 1) c = c & 1 ? (3988292384 ^ c >>> 1) >>> 0 : c >>> 1;
      t[i] = c >>> 0;
    }
    return t;
  })();
  function strCrc32(text2, crc = 0) {
    let c = ~crc >>> 0;
    for (let i = 0; i < text2.length; i += 1) {
      const ch = text2.charCodeAt(i);
      for (let b = 0; b < 4; b += 1) {
        const byte = ch >>> 8 * b & 255;
        c = (CRC_TABLE[(c ^ byte) & 255] ^ c >>> 8) >>> 0;
      }
    }
    return ~c >>> 0;
  }
  function lookHash01(id, salt) {
    const seed = Math.imul(salt >>> 0, 2654435761) + 17 >>> 0;
    return (strCrc32(id, seed) & 16777215) / 16777216;
  }
  function backdropRing(box, ring, ringIndex, meshHalfExtents) {
    const out = [];
    if (meshHalfExtents.length === 0 || !(ring.count > 0)) return out;
    const cx = (box.minX + box.maxX) / 2;
    const cz = (box.minZ + box.maxZ) / 2;
    const ex = (box.maxX - box.minX) / 2;
    const ez = (box.maxZ - box.minZ) / 2;
    const hx0 = ex + ring.outside;
    const hz0 = ez + ring.outside;
    const perimeter = 4 * (hx0 + hz0);
    for (let i = 0; i < ring.count; i += 1) {
      const id = `backdrop.${ringIndex}.${i}`;
      const s = ring.scale * (1 + ring.scaleJitter * (2 * lookHash01(id, 2) - 1));
      const mesh = i % meshHalfExtents.length;
      const half = meshHalfExtents[mesh] * s;
      const hx = hx0 + half;
      const hz = hz0 + half;
      let d = (i + 0.5) / ring.count * perimeter * ((hx + hz) / (hx0 + hz0));
      let at;
      if (d < 2 * hx) {
        at = [-hx + d, -hz];
      } else if ((d -= 2 * hx) < 2 * hz) {
        at = [hx, -hz + d];
      } else if ((d -= 2 * hz) < 2 * hx) {
        at = [hx - d, hz];
      } else {
        d -= 2 * hx;
        at = [-hx, hz - d];
      }
      const heading = Math.atan2(-at[1], -at[0]) + (lookHash01(id, 1) - 0.5) * 40 * Math.PI / 180;
      out.push({ id, mesh, scale: s, x: cx + at[0], y: box.minY - ring.sink, z: cz + at[1], heading });
    }
    return out;
  }
  var BACKDROP_FRAME_OVERLAP_M = 1;
  var BACKDROP_FRAME_MIN_BEYOND_M = 1;
  var BACKDROP_FRAME_MIN_SIZE_M = 0.01;
  function backdropFrame(box, mesh, pieceScale, offsetY, edgeMinY) {
    const sizeX = mesh.maxX - mesh.minX;
    const sizeZ = mesh.maxZ - mesh.minZ;
    const height = (edgeMinY !== null ? edgeMinY : box.minY) + offsetY;
    if (sizeX <= BACKDROP_FRAME_MIN_SIZE_M || sizeZ <= BACKDROP_FRAME_MIN_SIZE_M) {
      return { laid: false, outerHalfX: 0, outerHalfZ: 0, height, strips: [] };
    }
    const cx = (box.minX + box.maxX) / 2;
    const cz = (box.minZ + box.maxZ) / 2;
    const ex = (box.maxX - box.minX) / 2;
    const ez = (box.maxZ - box.minZ) / 2;
    const outerHalfX = Math.max(sizeX * pieceScale.x * 0.5, ex + BACKDROP_FRAME_MIN_BEYOND_M);
    const outerHalfZ = Math.max(sizeZ * pieceScale.z * 0.5, ez + BACKDROP_FRAME_MIN_BEYOND_M);
    const o = BACKDROP_FRAME_OVERLAP_M;
    const rects = [
      ["S", cx - outerHalfX, cz - outerHalfZ, cx + outerHalfX, box.minZ + o],
      ["N", cx - outerHalfX, box.maxZ - o, cx + outerHalfX, cz + outerHalfZ],
      ["W", cx - outerHalfX, box.minZ + o, box.minX + o, box.maxZ - o],
      ["E", box.maxX - o, box.minZ + o, cx + outerHalfX, box.maxZ - o]
    ];
    const meshCx = (mesh.minX + mesh.maxX) / 2;
    const meshCz = (mesh.minZ + mesh.maxZ) / 2;
    const strips = rects.map(([side, x0, z0, x1, z1]) => {
      const scaleX = (x1 - x0) / sizeX;
      const scaleZ = (z1 - z0) / sizeZ;
      return {
        side,
        x0,
        z0,
        x1,
        z1,
        scaleX,
        scaleZ,
        scaleY: pieceScale.y,
        x: (x0 + x1) * 0.5 - meshCx * scaleX,
        y: height,
        z: (z0 + z1) * 0.5 - meshCz * scaleZ
      };
    });
    return { laid: true, outerHalfX, outerHalfZ, height, strips };
  }

  // @insimul/core/src/editor/layout/ground-plan.ts
  var GROUND_SURFACES = ["road", "plaza", "path", "lot", "slope", "patch", "fleck", "base"];
  function buildGroundPlan(nodes, terrain = null) {
    const plan2 = { strips: [], lots: [], terrain };
    for (const n of nodes) {
      const path = n.path ?? [];
      if ((n.kind === "road" || n.kind === "ground_surface") && path.length >= 2) {
        const closed = n.kind === "ground_surface" && n.closed === true && path.length >= 3;
        const width = n.width ?? 0;
        plan2.strips.push({
          entityId: n.entityId,
          surface: n.kind === "road" ? "road" : closed ? "plaza" : "path",
          lotId: n.lotId ?? "",
          points: path.map((p) => [p[0], p[1]]),
          halfWidth: closed ? 0 : (width > 0 ? width : n.kind === "road" ? 4 : 2) / 2,
          closed
        });
      } else if (n.kind === "building" && n.lot != null && lotIsBounded(n.lot)) {
        const centre = n.lotCentre ?? n.position ?? [0, 0];
        const heading = n.lot.hasFrontage ? streetHeadingOf(n.lot.frontageYaw) : 0;
        plan2.lots.push({
          entityId: n.entityId,
          lotId: n.lotId ?? "",
          cx: centre[0],
          cz: centre[1],
          halfAcross: n.lot.width / 2,
          halfAway: n.lot.depth / 2,
          awayX: Math.cos(heading),
          awayZ: Math.sin(heading)
        });
      }
    }
    return plan2;
  }
  function layoutObstaclesOf(nodes) {
    const out = [];
    for (const n of nodes) {
      const path = n.path ?? [];
      if (n.kind !== "road" && n.kind !== "ground_surface" || path.length < 2) continue;
      const closed = n.kind === "ground_surface" && n.closed === true && path.length >= 3;
      out.push({
        entityId: n.entityId,
        kind: n.kind === "road" ? "road" : closed ? "plaza" : "footpath",
        lotId: n.lotId ?? "",
        points: path.map((p) => [p[0], p[1]]),
        halfWidth: closed ? 0 : (n.width ?? 0) / 2,
        closed
      });
    }
    return out;
  }
  function stripDistance(strip, x, z) {
    const p = strip.points;
    if (p.length < 2) return Infinity;
    let best = Infinity;
    for (let i = 0; i + 1 < p.length; i += 1) best = Math.min(best, pointSegmentDistance([x, z], p[i], p[i + 1]));
    if (strip.closed) {
      best = Math.min(best, pointSegmentDistance([x, z], p[p.length - 1], p[0]));
      return pointInOutline([x, z], p) ? 0 : best;
    }
    return best - strip.halfWidth;
  }
  function lotDistance(lot, x, z) {
    const dx = x - lot.cx;
    const dz = z - lot.cz;
    const away = dx * lot.awayX + dz * lot.awayZ;
    const across = -dx * lot.awayZ + dz * lot.awayX;
    const ox = Math.max(0, Math.abs(away) - lot.halfAway);
    const oz = Math.max(0, Math.abs(across) - lot.halfAcross);
    return Math.sqrt(ox * ox + oz * oz);
  }
  function isOnPavedNode(paved, x, z) {
    const p = paved.path;
    if (p.length < 2) return false;
    if (paved.kind === "ground_surface" && paved.closed && p.length >= 3) return pointInOutline([x, z], p);
    if (paved.kind !== "road" && paved.kind !== "ground_surface") return false;
    const half = paved.width * 0.5;
    if (half <= 0) return false;
    for (let i = 0; i + 1 < p.length; i += 1) {
      const ax = p[i][0];
      const az = p[i][1];
      const dx = p[i + 1][0] - ax;
      const dz = p[i + 1][1] - az;
      const l2 = dx * dx + dz * dz;
      let t = l2 > 0 ? ((x - ax) * dx + (z - az) * dz) / l2 : 0;
      t = Math.max(0, Math.min(1, t));
      const cx = ax + t * dx - x;
      const cz = az + t * dz - z;
      if (cx * cx + cz * cz <= half * half) return true;
    }
    return false;
  }
  var LOT_PAD_MARGIN_M = 2;
  var LOT_PAD_BLEND_M = 4;
  var GRADED_CELL_M = 1;
  var GRADED_MAX_RESOLUTION = 2049;
  function buildLotPads(lots, raw) {
    const pads = [];
    if (raw.resolution < 2 || raw.sizeX <= 0 || raw.sizeZ <= 0) return pads;
    for (const l of lots) {
      let sum = 0;
      let count = 0;
      for (let i = 0; i < 5; i += 1) {
        for (let j = 0; j < 5; j += 1) {
          const a = (i / 4 * 2 - 1) * l.halfAway;
          const c = (j / 4 * 2 - 1) * l.halfAcross;
          const x = l.cx + a * l.awayX - c * l.awayZ;
          const z = l.cz + a * l.awayZ + c * l.awayX;
          sum += layoutGroundAt(raw, x, z);
          count += 1;
        }
      }
      pads.push({
        lotId: l.lotId,
        cx: l.cx,
        cz: l.cz,
        halfAcross: l.halfAcross,
        halfAway: l.halfAway,
        awayX: l.awayX,
        awayZ: l.awayZ,
        height: count > 0 ? sum / count : 0
      });
    }
    pads.sort((p, q) => p.lotId < q.lotId ? -1 : p.lotId > q.lotId ? 1 : 0);
    return pads;
  }
  function gradedHeight(pads, rawHeight, x, z) {
    let wMax = 0;
    let wSum = 0;
    let hSum = 0;
    for (const p of pads) {
      const dx = x - p.cx;
      const dz = z - p.cz;
      const away = Math.abs(dx * p.awayX + dz * p.awayZ) - (p.halfAway + LOT_PAD_MARGIN_M);
      const across = Math.abs(-dx * p.awayZ + dz * p.awayX) - (p.halfAcross + LOT_PAD_MARGIN_M);
      const outside = Math.hypot(Math.max(0, away), Math.max(0, across));
      if (outside >= LOT_PAD_BLEND_M) continue;
      const t = 1 - outside / LOT_PAD_BLEND_M;
      const w = t * t * (3 - 2 * t);
      wMax = Math.max(wMax, w);
      wSum += w;
      hSum += w * p.height;
    }
    if (wSum <= 0) return rawHeight;
    return rawHeight + wMax * (hSum / wSum - rawHeight);
  }
  function gradeTerrain(raw, lots) {
    if (raw.resolution < 2 || raw.sizeX <= 0 || raw.sizeZ <= 0) return { pads: [], grid: null };
    const pads = buildLotPads(lots, raw);
    if (pads.length === 0) return { pads, grid: null };
    const size = Math.max(raw.sizeX, raw.sizeZ);
    const resolution = Math.max(raw.resolution, Math.min(GRADED_MAX_RESOLUTION, Math.ceil(size / GRADED_CELL_M) + 1));
    const heights = new Array(resolution * resolution);
    for (let j = 0; j < resolution; j += 1) {
      for (let i = 0; i < resolution; i += 1) {
        const x = raw.sizeX * i / (resolution - 1);
        const z = raw.sizeZ * j / (resolution - 1);
        heights[j * resolution + i] = gradedHeight(pads, layoutGroundAt(raw, x, z), x, z);
      }
    }
    return { pads, grid: { resolution, sizeX: raw.sizeX, sizeZ: raw.sizeZ, heights } };
  }
  function gradeLift(pads, raw, x, z) {
    const h = layoutGroundAt(raw, x, z);
    return gradedHeight(pads, h, x, z) - h;
  }
  function quantizeSceneMetre(v) {
    if (!Number.isFinite(v)) return 0;
    const q = roundHalfAway(v * 1e3) / 1e3;
    return q === 0 ? 0 : q;
  }
  function gradedNodeHeight(pads, raw, x, y, z) {
    const d = gradeLift(pads, raw, x, z);
    return d !== 0 ? quantizeSceneMetre(y + d) : y;
  }
  var FOOTPATH_REACH_M = 14;
  var FOOTPATH_STEP_M = 0.4;
  var FOOTPATH_INTO_STREET_M = 0.6;
  function nearestStreetPoint(s, x, z) {
    const p = s.points;
    if (p.length < 2) return null;
    if (s.closed && pointInOutline([x, z], p)) return null;
    let best = Infinity;
    let ox = 0;
    let oz = 0;
    const n = s.closed ? p.length : p.length - 1;
    for (let i = 0; i < n; i += 1) {
      const q = nearestOnSegment([x, z], p[i], p[(i + 1) % p.length]);
      const d = Math.hypot(q[0] - x, q[1] - z);
      if (d < best) {
        best = d;
        ox = q[0];
        oz = q[1];
      }
    }
    if (!s.closed) {
      if (best <= s.halfWidth) return null;
      const k = (best - s.halfWidth) / best;
      ox = x + (ox - x) * k;
      oz = z + (oz - z) * k;
      best -= s.halfWidth;
    }
    return { x: ox, z: oz, d: best };
  }
  function followSettledBuildings(plan2, settled) {
    const out = {
      strips: plan2.strips.map((s) => ({ ...s, points: s.points.map((p) => [p[0], p[1]]) })),
      lots: plan2.lots.map((l) => ({ ...l })),
      terrain: plan2.terrain
    };
    const result = { plan: out, lotsMoved: 0, pathsFromDoor: 0, pathsMoved: 0, events: [] };
    for (const b of settled) {
      if (b.lotId === "") continue;
      const shifted = b.shiftX !== 0 || b.shiftZ !== 0;
      if (shifted) {
        for (const l of out.lots) {
          if (l.lotId !== b.lotId) continue;
          l.cx += b.shiftX;
          l.cz += b.shiftZ;
          result.lotsMoved += 1;
          result.events.push({ kind: "yard-moved", lotId: b.lotId, entityId: b.entityId, shiftX: b.shiftX, shiftZ: b.shiftZ });
        }
      }
      for (const s of out.strips) {
        if (s.surface !== "path" || s.closed || s.lotId !== b.lotId || s.points.length < 2) continue;
        let fromDoor = false;
        if (b.door !== null) {
          const fl = Math.hypot(b.door.faceX, b.door.faceZ);
          const fx = fl > 0 ? b.door.faceX / fl : 1;
          const fz = fl > 0 ? b.door.faceZ / fl : 0;
          const sx = b.door.x + fx * FOOTPATH_STEP_M;
          const sz = b.door.z + fz * FOOTPATH_STEP_M;
          let qx = 0;
          let qz = 0;
          let d = Infinity;
          let to = "";
          for (const t of out.strips) {
            const street = t.surface === "road" || t.surface === "plaza" && t.lotId !== b.lotId;
            if (!street) continue;
            const q = nearestStreetPoint(t, sx, sz);
            if (q === null) continue;
            const ahead = (q.x - sx) * fx + (q.z - sz) * fz;
            if (q.d > 1e-6 && ahead < 0.25 * q.d) continue;
            if (q.d < d) {
              d = q.d;
              qx = q.x;
              qz = q.z;
              to = t.entityId;
            }
          }
          if (d <= FOOTPATH_REACH_M) {
            let ex = qx;
            let ez = qz;
            if (d > 1e-6) {
              ex += (qx - sx) / d * FOOTPATH_INTO_STREET_M;
              ez += (qz - sz) / d * FOOTPATH_INTO_STREET_M;
            } else {
              ex += fx * FOOTPATH_INTO_STREET_M;
              ez += fz * FOOTPATH_INTO_STREET_M;
            }
            s.points = [[sx, sz], [ex, ez]];
            fromDoor = true;
            result.pathsFromDoor += 1;
            result.events.push({ kind: "path-from-door", pathId: s.entityId, entityId: b.entityId, to, length: d + FOOTPATH_INTO_STREET_M });
          }
        }
        if (!fromDoor && shifted) {
          s.points = s.points.map((p) => [p[0] + b.shiftX, p[1] + b.shiftZ]);
          result.pathsMoved += 1;
          result.events.push({ kind: "path-moved", pathId: s.entityId, entityId: b.entityId });
        }
      }
    }
    return result;
  }
  function pathMouths(plan2) {
    const out = [];
    for (const s of plan2.strips) {
      if (s.surface !== "path" || s.closed || s.points.length < 2) continue;
      const a = s.points[s.points.length - 2];
      const b = s.points[s.points.length - 1];
      const l = Math.hypot(b[0] - a[0], b[1] - a[1]);
      if (l < 1e-6) continue;
      out.push({ pathId: s.entityId, x: b[0], z: b[1], dirX: (b[0] - a[0]) / l, dirZ: (b[1] - a[1]) / l, halfWidth: s.halfWidth });
    }
    return out;
  }
  var LANTERN_MOUTH_REACH_M = 4.5;
  var LANTERN_BESIDE_PATH_M = 0.5;
  var LANTERN_SHORT_OF_MOUTH_M = 0.3;
  function lanternsAtPathMouths(mouths, lanterns) {
    const pairs = [];
    for (let l = 0; l < lanterns.length; l += 1) {
      for (let m = 0; m < mouths.length; m += 1) {
        const d = Math.hypot(lanterns[l][0] - mouths[m].x, lanterns[l][1] - mouths[m].z);
        if (d <= LANTERN_MOUTH_REACH_M) pairs.push({ d, l, m });
      }
    }
    pairs.sort((a, b) => {
      if (a.d !== b.d) return a.d < b.d ? -1 : 1;
      if (a.l !== b.l) return a.l - b.l;
      const pa = mouths[a.m].pathId;
      const pb = mouths[b.m].pathId;
      return pa < pb ? -1 : pa > pb ? 1 : 0;
    });
    const lTaken = lanterns.map(() => false);
    const mTaken = mouths.map(() => false);
    const out = [];
    for (const p of pairs) {
      if (lTaken[p.l] || mTaken[p.m]) continue;
      lTaken[p.l] = true;
      mTaken[p.m] = true;
      const m = mouths[p.m];
      const nx = -m.dirZ;
      const nz = m.dirX;
      const side = (lanterns[p.l][0] - m.x) * nx + (lanterns[p.l][1] - m.z) * nz < 0 ? -1 : 1;
      const off = m.halfWidth + LANTERN_BESIDE_PATH_M;
      const x = m.x - m.dirX * LANTERN_SHORT_OF_MOUTH_M + nx * side * off;
      const z = m.z - m.dirZ * LANTERN_SHORT_OF_MOUTH_M + nz * side * off;
      out.push({ lantern: p.l, pathId: m.pathId, x, z, from: Math.hypot(x - lanterns[p.l][0], z - lanterns[p.l][1]) });
    }
    out.sort((a, b) => a.lantern - b.lantern);
    return out;
  }
  function isPlantArchetype(archetype) {
    return archetype.startsWith("prop.vegetation.") && !archetype.startsWith("prop.vegetation.planter");
  }
  function keepPlantPropsOffPaving(props, paved) {
    const usable = paved.filter((p) => (p.kind === "road" || p.kind === "ground_surface") && p.path.length >= 2);
    const out = [];
    if (usable.length === 0) return out;
    for (const n of props) {
      if (!isPlantArchetype(n.archetype)) continue;
      for (const p of usable) {
        if (!isOnPavedNode(p, n.x, n.z)) continue;
        out.push({ entityId: n.entityId, archetype: n.archetype, x: n.x, z: n.z, onKind: p.kind, on: p.entityId });
        break;
      }
    }
    return out;
  }
  function groundKeepOff(plan2, x, z, margin) {
    for (const s of plan2.strips) {
      if (stripDistance(s, x, z) <= margin) return { surface: s.surface, entityId: s.entityId };
    }
    for (const l of plan2.lots) {
      if (lotDistance(l, x, z) <= margin) return { surface: "lot", entityId: l.entityId };
    }
    return null;
  }
  function keepOffMarginFor(horizontalRadius) {
    const r = Number.isFinite(horizontalRadius) && horizontalRadius > 0 ? horizontalRadius : 0;
    return Math.min(3, 0.5 + r / 3);
  }
  function obstacleMarginFor(horizontalRadius) {
    const r = Number.isFinite(horizontalRadius) && horizontalRadius > 0 ? horizontalRadius : 0;
    return Math.min(1, 0.2 + r / 3);
  }
  function obstacleDistance(o, x, z) {
    const dx = x - o.cx;
    const dz = z - o.cz;
    const u = dx * o.axisX + dz * o.axisZ;
    const v = -dx * o.axisZ + dz * o.axisX;
    const ou = Math.max(0, Math.abs(u) - o.halfX);
    const ov = Math.max(0, Math.abs(v) - o.halfZ);
    return Math.sqrt(ou * ou + ov * ov);
  }
  function obstacleAt(obstacles2, x, z, margin) {
    for (const o of obstacles2) if (obstacleDistance(o, x, z) <= margin) return o;
    return null;
  }
  var LAYER_AREA_CELL_M = 4;
  var LAYER_AREA_DILATE = 1;
  function cellKey(cx, cz) {
    return `${cx},${cz}`;
  }
  function buildLayerArea(instances, cell = LAYER_AREA_CELL_M, dilate = LAYER_AREA_DILATE) {
    const c = cell > 0 ? cell : LAYER_AREA_CELL_M;
    const d = Math.max(0, Math.trunc(dilate));
    const cells = /* @__PURE__ */ new Set();
    for (const p of instances) {
      const cx = Math.floor(p[0] / c);
      const cz = Math.floor(p[1] / c);
      for (let a = -d; a <= d; a += 1) for (let b = -d; b <= d; b += 1) cells.add(cellKey(cx + a, cz + b));
    }
    return { cell: c, cells };
  }
  function inLayerArea(area, x, z) {
    return area.cells.has(cellKey(Math.floor(x / area.cell), Math.floor(z / area.cell)));
  }
  function onGround(hit) {
    return hit.surface === "road" ? "on-road" : hit.surface === "plaza" ? "on-plaza" : hit.surface === "path" ? "on-path" : "on-lot";
  }
  function atObstacle(obstacles2, x, z, margin) {
    const o = obstacles2 !== null ? obstacleAt(obstacles2, x, z, margin) : null;
    if (o === null) return { trim: "kept", what: "" };
    return { trim: o.building ? "in-building" : "at-prop", what: o.entityId };
  }
  function trimGeneratedPoint(plan2, area, x, z, radius, obstacles2 = null) {
    if (!inLayerArea(area, x, z)) return { trim: "off-area", what: "" };
    const hit = groundKeepOff(plan2, x, z, keepOffMarginFor(radius));
    if (hit !== null) return { trim: onGround(hit), what: hit.entityId };
    return atObstacle(obstacles2, x, z, obstacleMarginFor(radius));
  }
  function keepLookNeighbour(plan2, obstacles2, x, z, radius) {
    if (plan2 !== null) {
      const hit = groundKeepOff(plan2, x, z, keepOffMarginFor(radius));
      if (hit !== null) return { trim: onGround(hit), what: hit.entityId };
    }
    return atObstacle(obstacles2, x, z, obstacleMarginFor(radius));
  }
  function keepStatedRow(obstacles2, x, z) {
    return atObstacle(obstacles2, x, z, 0);
  }
  function trimGeneratedPointClumped(plan2, area, x, z, radius, obstacles2, clumping, clumpCell) {
    const r = trimGeneratedPoint(plan2, area, x, z, radius, obstacles2);
    if (r.trim === "kept" && clumpThins(x, z, clumping, clumpCell)) return { trim: "in-clearing", what: "" };
    return r;
  }
  function layerInstanceKey(layerId, x, z) {
    return `${layerId}@${roundHalfAway(x * 100)},${roundHalfAway(z * 100)}`;
  }
  function lookPropStands(entityId, density) {
    return !(density < 1 && lookHash01(entityId, 0) >= density);
  }
  var LOOK_PI = Math.fround(Math.PI);
  function lookNeighbours(layerId, row, look, terrain, plan2, paving, obstacles2, radius) {
    const density = Math.max(0, look.density);
    const whole = Math.floor(density);
    const frac = density - whole;
    const key = layerInstanceKey(layerId, row.x, row.z);
    const evenCopies = whole + (lookHash01(key, 0) < frac ? 1 : 0);
    let copies = evenCopies;
    if (look.clumping > 0 && density > 1) {
      const d = density * clumpWeight(row.x, row.z, look.clumping, look.clumpCell);
      const w = Math.floor(d);
      copies = Math.max(1, w + (lookHash01(key, 0) < d - w ? 1 : 0));
    }
    const plants = [];
    for (let c = 0; c < copies; c += 1) {
      let x = row.x;
      let z = row.z;
      let yaw = row.yaw;
      if (c === 0) {
        const inside = keepStatedRow(obstacles2, x, z);
        plants.push({ copy: 0, x, z, yaw, keep: inside.trim, what: inside.what });
        continue;
      }
      const a = lookHash01(key, c * 3 + 1) * 2 * LOOK_PI;
      const r = Math.sqrt(lookHash01(key, c * 3 + 2)) * look.jitter;
      x += Math.cos(a) * r;
      z += Math.sin(a) * r;
      if (terrain !== null && (x < 0 || z < 0 || x > terrain.sizeX || z > terrain.sizeZ)) {
        plants.push({ copy: c, x, z, yaw, keep: "off-terrain", what: "" });
        continue;
      }
      let keep;
      if (plan2 !== null) keep = keepLookNeighbour(plan2, obstacles2, x, z, radius);
      else if (paving.some((p) => isOnPavedNode(p, x, z))) keep = { trim: "on-road", what: "" };
      else keep = keepLookNeighbour(null, obstacles2, x, z, radius);
      if (keep.trim === "kept") yaw += lookHash01(key, c * 3 + 3) * 2 * LOOK_PI;
      plants.push({ copy: c, x, z, yaw, keep: keep.trim, what: keep.what });
    }
    return { evenCopies, copies, plants };
  }
  var MASK64 = (1n << 64n) - 1n;
  function mix64(v) {
    let x = v + 0x9e3779b97f4a7c15n & MASK64;
    x = (x ^ x >> 30n) * 0xbf58476d1ce4e5b9n & MASK64;
    x = (x ^ x >> 27n) * 0x94d049bb133111ebn & MASK64;
    return x ^ x >> 31n;
  }
  function latticeValue01(ix, iz, salt) {
    const ux = BigInt.asUintN(64, BigInt(ix));
    const uz = BigInt.asUintN(64, BigInt(iz));
    const h = mix64(ux * 0x632be59bd9b4e019n & MASK64 ^ mix64(uz + BigInt(salt >>> 0) & MASK64));
    return Number(h >> 11n) * (1 / 9007199254740992);
  }
  function fade(t) {
    return t * t * t * (t * (t * 6 - 15) + 10);
  }
  function valueNoise(x, z, cell, salt) {
    const gx = x / cell;
    const gz = z / cell;
    const fx = Math.floor(gx);
    const fz = Math.floor(gz);
    const u = fade(gx - fx);
    const v = fade(gz - fz);
    const a = latticeValue01(fx, fz, salt);
    const b = latticeValue01(fx + 1, fz, salt);
    const c = latticeValue01(fx, fz + 1, salt);
    const d = latticeValue01(fx + 1, fz + 1, salt);
    return (a + (b - a) * u) * (1 - v) + (c + (d - c) * u) * v;
  }
  function clamp01(v) {
    return v < 0 ? 0 : v > 1 ? 1 : v;
  }
  function smooth(edge0, edge1, x) {
    const t = clamp01((x - edge0) / (edge1 - edge0));
    return t * t * (3 - 2 * t);
  }
  function groundNoise01(x, z, cell, salt) {
    if (!Number.isFinite(x) || !Number.isFinite(z) || !(cell > 0)) return 0.5;
    const second = Math.imul(salt >>> 0, 31) + 7 >>> 0;
    return clamp01(0.68 * valueNoise(x, z, cell, salt >>> 0) + 0.32 * valueNoise(x, z, cell * 0.43, second));
  }
  var GROUND_PATCH_CELL_M = 16;
  var GROUND_FLECK_CELL_M = 6;
  var PATCH_SALT = 1346458691;
  var FLECK_SALT = 1179403587;
  var CLUMP_SALT = 1129076045;
  var THIN_SALT = 1414023502;
  var DEFAULT_CLUMP_CELL_M = 12;
  function groundPatchCoverage(x, z) {
    return smooth(0.52, 0.64, groundNoise01(x, z, GROUND_PATCH_CELL_M, PATCH_SALT));
  }
  function groundFleckCoverage(x, z) {
    return smooth(0.58, 0.68, groundNoise01(x, z, GROUND_FLECK_CELL_M, FLECK_SALT));
  }
  function clumpWeight(x, z, clumping, cell) {
    const c = clamp01(Number.isFinite(clumping) ? clumping : 0);
    if (c <= 0) return 1;
    const n = smooth(0.36, 0.64, groundNoise01(x, z, cell > 0 ? cell : DEFAULT_CLUMP_CELL_M, CLUMP_SALT));
    return 1 - c + 2 * c * n;
  }
  function clumpThins(x, z, clumping, cell) {
    const c = clamp01(Number.isFinite(clumping) ? clumping : 0);
    if (c <= 0) return false;
    const keep = clumpWeight(x, z, c, cell) / (1 + c);
    return latticeValue01(roundHalfAway(x * 100), roundHalfAway(z * 100), THIN_SALT) >= keep;
  }
  function surfaceRank(name) {
    const i = GROUND_SURFACES.indexOf(name);
    return i >= 0 ? i : GROUND_SURFACES.length;
  }
  function readGroundLayers(transform) {
    const out = [];
    if (typeof transform !== "object" || transform === null || Array.isArray(transform)) return out;
    const block = transform.groundLayers;
    if (typeof block !== "object" || block === null || Array.isArray(block)) return out;
    for (const [surface, v] of Object.entries(block)) {
      if (v === void 0) continue;
      const c = { surface, layer: "", strength: 1, hasStrength: false };
      if (typeof v === "string") {
        c.layer = v;
      } else if (typeof v === "object" && v !== null && !Array.isArray(v)) {
        const l = v.layer;
        if (typeof l !== "string") continue;
        c.layer = l;
        const s = v.strength;
        if (typeof s === "number" && Number.isFinite(s)) {
          c.strength = clamp01(s);
          c.hasStrength = true;
        }
      } else if (v === null) {
        c.layer = "";
      } else {
        continue;
      }
      out.push(c);
    }
    out.sort((a, b) => {
      const ra = surfaceRank(a.surface);
      const rb = surfaceRank(b.surface);
      if (ra !== rb) return ra - rb;
      return a.surface < b.surface ? -1 : a.surface > b.surface ? 1 : 0;
    });
    return out;
  }
  function layerWords(name) {
    const out = [];
    let cur = "";
    const isAlnum = (ch) => /^[A-Za-z0-9]$/.test(ch);
    const isUpper = (ch) => /^[A-Z]$/.test(ch);
    const isLower = (ch) => /^[a-z]$/.test(ch);
    for (const ch of name.split("")) {
      const alnum = isAlnum(ch);
      if (alnum && cur !== "" && isUpper(ch) && isLower(cur[cur.length - 1])) {
        out.push(cur.toLowerCase());
        cur = "";
      }
      if (alnum) cur += ch;
      else if (cur !== "") {
        out.push(cur.toLowerCase());
        cur = "";
      }
    }
    if (cur !== "") out.push(cur.toLowerCase());
    return out;
  }
  function firstLayer(layers, pred) {
    for (const l of layers) if (pred(layerWords(l))) return l;
    return "";
  }
  var LOT_DEFAULT_STRENGTH = 0.5;
  function resolveGroundPaint(layers, authored) {
    const rules = {};
    for (const s of GROUND_SURFACES) rules[s] = { layer: "", strength: 1, why: "none" };
    const paint = { layers: [...layers], rules, notes: [] };
    if (layers.length === 0) {
      for (const c of authored) paint.notes.push(`ignored:${c.surface}`);
      return paint;
    }
    const isLayer = (l) => layers.includes(l);
    const authoredSet = /* @__PURE__ */ new Set();
    for (const c of authored) {
      if (!GROUND_SURFACES.includes(c.surface)) {
        paint.notes.push(`not-a-surface:${c.surface}`);
        continue;
      }
      const s = c.surface;
      if (c.layer !== "" && !isLayer(c.layer)) {
        paint.notes.push(`unknown-layer:${c.surface}`);
        continue;
      }
      rules[s] = { layer: c.layer, strength: c.hasStrength ? c.strength : 1, why: c.layer === "" ? "none" : "authored" };
      authoredSet.add(s);
    }
    const infer = (s, layer, strength) => {
      if (authoredSet.has(s)) return;
      rules[s] = { layer, strength, why: layer === "" ? "none" : "by-name" };
    };
    const has = (w, word) => w.includes(word);
    let base = firstLayer(layers, (w) => has(w, "grass") && !has(w, "lush"));
    if (base === "") base = firstLayer(layers, (w) => has(w, "grass"));
    if (base === "") base = layers[0];
    infer("base", base, 1);
    let road = firstLayer(layers, (w) => has(w, "dirt") && !has(w, "rocky") && !has(w, "rock"));
    if (road === "") road = firstLayer(layers, (w) => has(w, "mud"));
    if (road === "") road = firstLayer(layers, (w) => has(w, "gravel") || has(w, "path") || has(w, "road") || has(w, "sand"));
    const roadNow = rules.road.layer;
    infer("road", road, 1);
    const roadLayer = authoredSet.has("road") ? roadNow : road;
    const path = firstLayer(layers, (w) => has(w, "mud"));
    infer("path", path === "" ? roadLayer : path, 1);
    let plaza = firstLayer(layers, (w) => (has(w, "rocky") || has(w, "rock")) && has(w, "dirt"));
    if (plaza === "") {
      plaza = firstLayer(layers, (w) => has(w, "stone") || has(w, "cobble") || has(w, "cobblestone") || has(w, "paving") || has(w, "gravel") || has(w, "rocky"));
    }
    infer("plaza", plaza === "" ? roadLayer : plaza, 1);
    infer("lot", roadLayer, LOT_DEFAULT_STRENGTH);
    const slope = firstLayer(layers, (w) => (has(w, "rock") || has(w, "rocks") || has(w, "cliff")) && !has(w, "dirt") && !has(w, "rocky"));
    infer("slope", slope, 1);
    infer("patch", "", 1);
    infer("fleck", "", 1);
    if (rules.base.layer === "") {
      rules.base = { ...rules.base, layer: layers[0] };
      paint.notes.push("base-cannot-be-none");
    }
    return paint;
  }
  function paintLayerIndex(paint, surface) {
    const l = paint.rules[surface].layer;
    if (l === "") return -1;
    return paint.layers.indexOf(l);
  }
  var ROAD_FEATHER_M = 1.5;
  var EDGE_FEATHER_M = 1;
  var SLOPE_START = 0.45;
  var SLOPE_FULL = 0.8;
  function feathered(d, feather) {
    if (d <= 0) return 1;
    if (d >= feather) return 0;
    return 1 - smooth(0, feather, d);
  }
  function sampleGroundCoverage(plan2, x, z) {
    const c = { road: 0, plaza: 0, path: 0, lot: 0, slope: 0, patch: 0, fleck: 0, base: 0 };
    for (const s of plan2.strips) {
      const d = stripDistance(s, x, z);
      c[s.surface] = Math.max(c[s.surface], feathered(d, s.surface === "road" ? ROAD_FEATHER_M : EDGE_FEATHER_M));
    }
    for (const l of plan2.lots) c.lot = Math.max(c.lot, feathered(lotDistance(l, x, z), EDGE_FEATHER_M));
    if (plan2.terrain !== null && plan2.terrain.resolution >= 2) {
      const g = plan2.terrain;
      const h = (px, pz) => layoutGroundAt(g, px, pz);
      const step = 1;
      const dx = (h(x + step, z) - h(x - step, z)) / (2 * step);
      const dz = (h(x, z + step) - h(x, z - step)) / (2 * step);
      c.slope = smooth(SLOPE_START, SLOPE_FULL, Math.sqrt(dx * dx + dz * dz));
    }
    c.patch = groundPatchCoverage(x, z);
    c.fleck = groundFleckCoverage(x, z);
    c.base = 1;
    return c;
  }
  function groundLayerWeights(paint, coverage) {
    const n = paint.layers.length;
    const out = new Array(n).fill(0);
    const base = paintLayerIndex(paint, "base");
    if (n === 0 || base < 0) return out;
    const share = new Array(n).fill(0);
    let left = 1;
    for (const s of GROUND_SURFACES) {
      if (s === "base") continue;
      const layer = paintLayerIndex(paint, s);
      if (layer < 0) continue;
      const take = clamp01(coverage[s]) * clamp01(paint.rules[s].strength) * left;
      share[layer] += take;
      left -= take;
    }
    share[base] += Math.max(0, left);
    let sum = 0;
    const frac = [];
    for (let i = 0; i < n; i += 1) {
      const v = share[i] * 255;
      const f = Math.floor(v + 1e-9);
      out[i] = Math.max(0, Math.min(255, f));
      sum += out[i];
      frac.push({ f: v - f, i });
    }
    frac.sort((a, b) => b.f - a.f);
    for (let k = 0; sum < 255 && k < frac.length; k += 1) {
      if (out[frac[k].i] < 255) {
        out[frac[k].i] += 1;
        sum += 1;
      }
    }
    return out;
  }

  // @insimul/core/src/editor/layout/corpus.ts
  function bad(why) {
    throw new Error(`layout corpus: ${why}`);
  }
  function obj(v, what) {
    if (typeof v !== "object" || v === null || Array.isArray(v)) bad(`${what} is not an object`);
    return v;
  }
  function arr(v, what) {
    if (!Array.isArray(v)) bad(`${what} is not an array`);
    return v;
  }
  function num(o, k) {
    const v = o[k];
    if (typeof v !== "number") bad(`'${k}' is not a number`);
    return v;
  }
  function numOr(o, k, d) {
    const v = o[k];
    return typeof v === "number" ? v : d;
  }
  function str(o, k, d = "") {
    const v = o[k];
    return typeof v === "string" ? v : d;
  }
  function bool(o, k) {
    return o[k] === true;
  }
  function present(o, k) {
    return o[k] !== void 0 && o[k] !== null;
  }
  function point(v) {
    const a = arr(v, "a point");
    if (a.length < 2) bad("a point is [x, z]");
    return [a[0], a[1]];
  }
  function points(v) {
    return arr(v, "points").map(point);
  }
  function vec(v) {
    const o = obj(v, "a vector");
    return { x: numOr(o, "x", 0), y: numOr(o, "y", 0), z: numOr(o, "z", 0) };
  }
  function grid(v) {
    const o = obj(v, "a terrain grid");
    return {
      resolution: num(o, "resolution"),
      sizeX: num(o, "sizeX"),
      sizeZ: num(o, "sizeZ"),
      heights: arr(o.heights, "heights")
    };
  }
  var DOOR_SOURCES = ["none", "binding_socket", "mesh_socket", "component", "binding_yaw"];
  function door(v) {
    const o = obj(v, "a door");
    const source = str(o, "source", "none");
    if (!DOOR_SOURCES.includes(source)) bad(`unknown door source '${source}'`);
    return {
      source,
      name: str(o, "name"),
      hasPosition: bool(o, "hasPosition"),
      position: present(o, "position") ? vec(o.position) : { x: 0, y: 0, z: 0 },
      yaw: numOr(o, "yaw", 0),
      candidates: numOr(o, "candidates", 0),
      height: numOr(o, "height", 0)
    };
  }
  function candidate(v) {
    const o = obj(v, "a door candidate");
    return { component: str(o, "component"), mesh: str(o, "mesh"), owner: str(o, "owner"), min: vec(o.min), max: vec(o.max) };
  }
  function policy(v) {
    const o = obj(v, "a fit policy");
    const d = defaultFitPolicy();
    const p = {
      mode: str(o, "mode", "lot") === "none" ? "none" : "lot",
      scaleMin: numOr(o, "scaleMin", d.scaleMin),
      scaleMax: numOr(o, "scaleMax", d.scaleMax),
      doorClearance: numOr(o, "doorClearance", d.doorClearance),
      seatSink: numOr(o, "seatSink", d.seatSink),
      neighbourGap: numOr(o, "neighbourGap", d.neighbourGap)
    };
    if (present(o, "doorYaw")) p.doorYaw = num(o, "doorYaw");
    return p;
  }
  function fitInput(v) {
    const o = obj(v, "a fit input");
    const g = obj(o.geometry, "geometry");
    const b = present(o, "bounds") ? obj(o.bounds, "bounds") : null;
    return {
      entityId: str(o, "entityId"),
      lotId: str(o, "lotId"),
      lot: present(o, "lot") ? readFitLot(o.lot) : null,
      lotCentre: present(o, "lotCentre") ? point(o.lotCentre) : null,
      node: vec(o.node),
      nodeHeading: num(o, "nodeHeading"),
      nodeScale: vec(o.nodeScale),
      geometry: { scale: vec(g.scale), yaw: num(g, "yaw"), offset: vec(g.offset) },
      policy: policy(o.policy),
      bounds: b === null ? null : { min: vec(b.min), max: vec(b.max) },
      door: door(o.door),
      ground: present(o, "ground") ? grid(o.ground) : null,
      castHeight: numOr(o, "castHeight", 0),
      settleShift: point(o.settleShift)
    };
  }
  function obstacle(v) {
    const o = obj(v, "an obstacle");
    return {
      entityId: str(o, "entityId"),
      kind: str(o, "kind"),
      lotId: str(o, "lotId"),
      points: points(o.points),
      halfWidth: numOr(o, "halfWidth", 0),
      closed: bool(o, "closed")
    };
  }
  function obstacles(v) {
    return arr(v, "obstacles").map(obstacle);
  }
  function body(v) {
    const o = obj(v, "a body");
    return {
      entityId: str(o, "entityId"),
      lotId: str(o, "lotId"),
      outline: points(o.outline),
      mass: num(o, "mass"),
      maxShift: num(o, "maxShift"),
      obstacleGap: num(o, "obstacleGap"),
      class: numOr(o, "class", 0),
      gap: numOr(o, "gap", 0)
    };
  }
  function layoutNode(v) {
    const o = obj(v, "a node");
    let position;
    let y = 0;
    if (present(o, "position")) {
      const p = arr(o.position, "a position");
      if (p.length !== 3) bad("a node's position is [x, y, z]");
      position = [p[0], p[2]];
      y = p[1];
    }
    return {
      kind: str(o, "kind"),
      entityId: str(o, "entityId"),
      archetype: str(o, "archetype"),
      lotId: str(o, "lotId"),
      path: present(o, "path") ? points(o.path) : [],
      width: numOr(o, "width", 0),
      closed: bool(o, "closed"),
      lot: present(o, "lot") ? readFitLot(o.lot) : null,
      lotCentre: present(o, "lotCentre") ? point(o.lotCentre) : null,
      position: position ?? [0, 0],
      y
    };
  }
  function plan(v) {
    const o = obj(v, "a plan");
    const strips = present(o, "strips") ? arr(o.strips, "strips").map((x) => {
      const s = obj(x, "a strip");
      const surface = str(s, "surface");
      if (surface !== "road" && surface !== "plaza" && surface !== "path") bad("a strip's surface is road, plaza or path");
      return {
        entityId: str(s, "entityId"),
        surface,
        lotId: str(s, "lotId"),
        points: points(s.points),
        halfWidth: numOr(s, "halfWidth", 0),
        closed: bool(s, "closed")
      };
    }) : [];
    const lots = present(o, "lots") ? arr(o.lots, "lots").map((x) => {
      const l = obj(x, "a lot");
      return {
        entityId: str(l, "entityId"),
        lotId: str(l, "lotId"),
        cx: num(l, "cx"),
        cz: num(l, "cz"),
        halfAcross: num(l, "halfAcross"),
        halfAway: num(l, "halfAway"),
        awayX: num(l, "awayX"),
        awayZ: num(l, "awayZ")
      };
    }) : [];
    return { strips, lots, terrain: present(o, "terrain") ? grid(o.terrain) : null };
  }
  function groundObstacles(v) {
    return arr(v, "obstacles").map((x) => {
      const o = obj(x, "a ground obstacle");
      return {
        entityId: str(o, "entityId"),
        building: bool(o, "building"),
        cx: num(o, "cx"),
        cz: num(o, "cz"),
        halfX: num(o, "halfX"),
        halfZ: num(o, "halfZ"),
        axisX: num(o, "axisX"),
        axisZ: num(o, "axisZ")
      };
    });
  }
  function choices(v) {
    return arr(v, "authored").map((x) => {
      const o = obj(x, "a layer choice");
      return { surface: str(o, "surface"), layer: str(o, "layer"), strength: numOr(o, "strength", 1), hasStrength: bool(o, "hasStrength") };
    });
  }
  var v3 = (v) => ({ x: v.x, y: v.y, z: v.z });
  var pt = (p) => [p[0], p[1]];
  function doorJson(d) {
    return {
      source: d.source,
      name: d.name,
      hasPosition: d.hasPosition,
      position: v3(d.position),
      yaw: d.yaw,
      candidates: d.candidates,
      height: d.height
    };
  }
  function policyJson(p) {
    const o = { mode: p.mode, scaleMin: p.scaleMin, scaleMax: p.scaleMax };
    if (p.doorYaw !== void 0) o.doorYaw = p.doorYaw;
    o.doorClearance = p.doorClearance;
    o.seatSink = p.seatSink;
    o.neighbourGap = p.neighbourGap;
    return o;
  }
  function fitJson(f) {
    if (!f.applied) return { applied: false, notApplied: f.notApplied ?? "" };
    const o = {
      applied: true,
      outcome: f.fit.outcome,
      issues: [...f.fit.issues],
      required: { across: f.fit.required.across, away: f.fit.required.away },
      aligned: f.fit.aligned,
      lot: { width: f.lot.width, depth: f.lot.depth, hasFrontage: f.lot.hasFrontage },
      streetHeading: f.streetHeading,
      wantedFactor: f.wantedFactor,
      factor: f.factor,
      limited: f.limited,
      doorFactor: f.doorFactor,
      doorHeld: f.doorHeld,
      doorHeight: f.doorHeight,
      castHeight: f.castHeight,
      policy: policyJson(f.policy),
      scale: v3(f.scale),
      fixupScale: v3(f.fixupScale),
      heading: f.heading,
      fixupHeading: f.fixupHeading,
      location: v3(f.location),
      offsetFromNode: v3(f.offsetFromNode),
      door: doorJson(f.door)
    };
    if (f.door.source !== "none") {
      o.doorWorld = v3(f.doorWorld);
      o.doorHeading = f.doorHeading;
    }
    o.seat = { ...f.seat };
    o.footprint = f.footprint.corners.map((c) => [c[0], c[1]]);
    o.settleShift = [f.settleShift[0], f.settleShift[1]];
    o.notes = [...f.notes];
    return o;
  }
  function movesJson(moves) {
    return moves.map((m) => ({ entityId: m.entityId, dx: m.dx, dz: m.dz, short: m.short, shortOf: m.shortOf, limited: m.limited }));
  }
  function obstacleJson(o) {
    return { entityId: o.entityId, kind: o.kind, lotId: o.lotId, points: o.points.map(pt), halfWidth: o.halfWidth, closed: o.closed };
  }
  function planJson(p) {
    return {
      strips: p.strips.map((s) => ({
        entityId: s.entityId,
        surface: s.surface,
        lotId: s.lotId,
        points: s.points.map(pt),
        halfWidth: s.halfWidth,
        closed: s.closed
      })),
      lots: p.lots.map((l) => ({ ...l }))
    };
  }
  function trimJson(r) {
    return { trim: r.trim, what: r.what };
  }
  var EXCLUDED_FROM_GRADING = /* @__PURE__ */ new Set(["terrain_field", "environment", "nav_region", "interior"]);
  function noNegativeZero(v) {
    if (typeof v === "number") return v === 0 ? 0 : v;
    if (Array.isArray(v)) return v.map(noNegativeZero);
    if (v !== null && typeof v === "object") {
      const out = {};
      for (const k of Object.keys(v)) out[k] = noNegativeZero(v[k]);
      return out;
    }
    return v;
  }
  function runLayoutOp(op, input) {
    return noNegativeZero(answer(op, input));
  }
  function answer(op, input) {
    const i = obj(input, "an input");
    switch (op) {
      // ── building-fit ──
      case "isDoorPartName":
        return isDoorPartName({ component: str(i, "component"), mesh: str(i, "mesh"), owner: str(i, "owner") });
      case "faceYawOf":
        return faceYawOf(vec(i.point), vec(i.min), vec(i.max));
      case "chooseDoorPart":
        return doorJson(chooseDoorPart(arr(i.parts, "parts").map(candidate), vec(i.boundsMin), vec(i.boundsMax)));
      case "bodyStature":
        return bodyStature(num(i, "boundsHeight"), numOr(i, "headBoneHeight", 0), numOr(i, "crownTop", 0));
      case "fitBuildingToLot":
        return fitJson(fitBuildingToLot(fitInput(input)));
      case "findFitOverlaps": {
        const buildings = arr(i.buildings, "buildings").map((x) => {
          const o = obj(x, "a footprint");
          const corners = points(o.corners);
          if (corners.length !== 4) bad("a footprint has four corners");
          return { entityId: str(o, "entityId"), lotId: str(o, "lotId"), corners: corners.map((c) => [c[0], c[1]]) };
        });
        return findFitOverlaps(buildings, obstacles(i.obstacles)).map((o) => ({ entityId: o.entityId, with: o.with, withKind: o.withKind, depth: o.depth }));
      }
      // ── settle ──
      case "settleSeparation": {
        const s = settleSeparation(points(i.a), points(i.b));
        return { gap: s.gap, axis: [s.axis[0], s.axis[1]] };
      }
      case "settleBodies": {
        const rule = str(i, "rule");
        if (rule !== "neighbour" && rule !== "clearance") bad(`unknown settle rule '${rule}'`);
        return movesJson(settleBodies(
          arr(i.bodies, "bodies").map(body),
          obstacles(i.obstacles),
          settlePairGapOf(rule),
          numOr(i, "iterations", SETTLE_DEFAULT_ITERATIONS)
        ));
      }
      case "settleFittedBuildings":
        return movesJson(settleFittedBuildings(arr(i.buildings, "buildings").map((x) => {
          const o = obj(x, "a fitted footprint");
          return { entityId: str(o, "entityId"), lotId: str(o, "lotId"), corners: points(o.corners), neighbourGap: num(o, "neighbourGap") };
        }), obstacles(i.obstacles)));
      case "settleClearance": {
        const items = arr(i.items, "items").map((x) => {
          const o = obj(x, "a clearance item");
          const kind = str(o, "kind");
          const item = {
            entityId: str(o, "entityId"),
            kind: kind === "building" ? "building" : kind === "plant" ? "plant" : "prop",
            outline: points(o.outline)
          };
          item.area = numOr(o, "area", 0);
          item.archetype = str(o, "archetype");
          item.height = numOr(o, "height", 0);
          item.longestPlan = numOr(o, "longestPlan", 0);
          item.crownRadius = numOr(o, "crownRadius", 1);
          return item;
        });
        const r = settleClearance(items, obstacles(i.obstacles));
        return { moves: movesJson(r.moves), setAsides: r.setAsides.map((s) => ({ index: s.index, buildingId: s.buildingId, inside: s.inside })) };
      }
      case "clearancePairGap":
        return clearancePairGap(num(i, "classA"), num(i, "gapA"), num(i, "classB"), num(i, "gapB"));
      case "plantTrunkOutline":
        return points(i.points).map((q) => plantTrunkOutline(q[0], q[1]).map(pt));
      case "layoutConstants":
        return { pairingNeighbourGap: PAIRING_NEIGHBOUR_GAP_M, crownRadius: CROWN_RADIUS_M };
      case "markerClearance":
        return markerClearanceM(str(i, "archetype"), num(i, "height"), num(i, "longestPlan"));
      case "plantWallClearance":
        return plantWallClearanceM(num(i, "crownRadius"));
      case "settleBuildingMaxShift":
        return settleBuildingMaxShiftM(num(i, "neighbourGap"));
      case "pairingSeatSink":
        return pairingSeatSink(num(i, "bottom"), present(i, "doorFoot") ? num(i, "doorFoot") : null, num(i, "factor"));
      case "layoutObstaclesOf":
        return layoutObstaclesOf(arr(i.nodes, "nodes").map(layoutNode)).map(obstacleJson);
      // ── ground plan ──
      case "buildGroundPlan":
        return planJson(buildGroundPlan(arr(i.nodes, "nodes").map(layoutNode)));
      case "gradeTerrain": {
        const nodes = arr(i.nodes, "nodes").map(layoutNode);
        const raw = grid(i.terrain);
        const graded = gradeTerrain(raw, buildGroundPlan(nodes).lots);
        const probes = present(i, "gridProbes") ? arr(i.gridProbes, "gridProbes") : [];
        return {
          pads: graded.pads.map((p) => ({ ...p })),
          resolution: graded.grid !== null ? graded.grid.resolution : 0,
          gridProbes: probes.map((x) => {
            const ij = arr(x, "a grid probe");
            const g = graded.grid;
            return g !== null ? g.heights[ij[1] * g.resolution + ij[0]] : null;
          }),
          lifted: nodes.map((n) => ({
            entityId: n.entityId,
            y: graded.pads.length > 0 && !EXCLUDED_FROM_GRADING.has(n.kind) ? gradedNodeHeight(graded.pads, raw, n.position[0], n.y, n.position[1]) : n.y
          }))
        };
      }
      case "followSettledBuildings": {
        const settled = arr(i.settled, "settled").map((x) => {
          const o = obj(x, "a settled building");
          const d = present(o, "door") ? obj(o.door, "a door") : null;
          return {
            entityId: str(o, "entityId"),
            lotId: str(o, "lotId"),
            shiftX: numOr(o, "shiftX", 0),
            shiftZ: numOr(o, "shiftZ", 0),
            door: d === null ? null : { x: num(d, "x"), z: num(d, "z"), faceX: num(d, "faceX"), faceZ: num(d, "faceZ") }
          };
        });
        const f = followSettledBuildings(plan(i.plan), settled);
        return {
          plan: planJson(f.plan),
          lotsMoved: f.lotsMoved,
          pathsFromDoor: f.pathsFromDoor,
          pathsMoved: f.pathsMoved,
          events: f.events.map((e) => e.kind === "yard-moved" ? { kind: e.kind, lotId: e.lotId, entityId: e.entityId } : e.kind === "path-from-door" ? { kind: e.kind, pathId: e.pathId, entityId: e.entityId, to: e.to } : { kind: e.kind, pathId: e.pathId, entityId: e.entityId })
        };
      }
      case "pathMouths":
        return pathMouths(plan(i.plan)).map((m) => ({ ...m }));
      case "lanternsAtPathMouths": {
        const mouths = arr(i.mouths, "mouths").map((x) => {
          const o = obj(x, "a mouth");
          return { pathId: str(o, "pathId"), x: num(o, "x"), z: num(o, "z"), dirX: num(o, "dirX"), dirZ: num(o, "dirZ"), halfWidth: num(o, "halfWidth") };
        });
        return lanternsAtPathMouths(mouths, points(i.lanterns)).map((l) => ({ ...l }));
      }
      case "keepPlantPropsOffPaving": {
        const nodes = arr(i.nodes, "nodes").map(layoutNode);
        const props = nodes.filter((n) => n.kind === "prop").map((n) => ({ entityId: n.entityId, archetype: n.archetype, x: n.position[0], z: n.position[1] }));
        const paved = nodes.filter((n) => n.kind === "road" || n.kind === "ground_surface").map((n) => ({ kind: n.kind, entityId: n.entityId, path: n.path ?? [], width: n.width ?? 0, closed: n.closed === true }));
        return keepPlantPropsOffPaving(props, paved).map((p) => ({ ...p }));
      }
      case "trimGeneratedPoints":
      case "keepLookNeighbours":
      case "keepStatedRows": {
        const obs = groundObstacles(i.obstacles);
        const p = present(i, "plan") ? plan(i.plan) : null;
        const area = op === "trimGeneratedPoints" ? (() => {
          const layer = obj(i.layer, "a layer");
          return buildLayerArea(points(layer.instances), numOr(layer, "cell", LAYER_AREA_CELL_M), numOr(layer, "dilate", LAYER_AREA_DILATE));
        })() : null;
        return arr(i.points, "points").map((x) => {
          const q = arr(x, "a point");
          const px = q[0];
          const pz = q[1];
          const r = q.length > 2 ? q[2] : 0;
          if (op === "trimGeneratedPoints") {
            const flat = p ?? { strips: [], lots: [], terrain: null };
            return trimJson(present(i, "clumping") ? trimGeneratedPointClumped(flat, area, px, pz, r, obs, num(i, "clumping"), num(i, "clumpCell")) : trimGeneratedPoint(flat, area, px, pz, r, obs));
          }
          if (op === "keepLookNeighbours") return trimJson(keepLookNeighbour(p, obs, px, pz, r));
          return trimJson(keepStatedRow(obs, px, pz));
        });
      }
      case "lookPropStands": {
        const d = num(i, "density");
        return arr(i.entityIds, "entityIds").map((id) => lookPropStands(id, d));
      }
      case "lookNeighbours": {
        const look = obj(i.look, "a look");
        const t = present(i, "terrain") ? obj(i.terrain, "a terrain size") : null;
        const paving = present(i, "paving") ? arr(i.paving, "paving").map(layoutNode).map((n) => ({ kind: n.kind, entityId: n.entityId, path: n.path ?? [], width: n.width ?? 0, closed: n.closed === true })) : [];
        const p = present(i, "plan") ? plan(i.plan) : null;
        const obs = groundObstacles(i.obstacles);
        const radius = num(i, "radius");
        return arr(i.rows, "rows").map((x) => {
          const q = arr(x, "a row");
          const r = lookNeighbours(
            str(i, "layerId"),
            { x: q[0], z: q[1], yaw: q[2] },
            { density: num(look, "density"), clumping: num(look, "clumping"), clumpCell: num(look, "clumpCell"), jitter: num(look, "jitter") },
            t === null ? null : { sizeX: num(t, "sizeX"), sizeZ: num(t, "sizeZ") },
            p,
            paving,
            obs,
            radius
          );
          return { evenCopies: r.evenCopies, copies: r.copies, plants: r.plants.map((pl) => ({ ...pl })) };
        });
      }
      case "planDistances": {
        const p = plan(input);
        const pts = points(i.points);
        return {
          strips: p.strips.map((s) => pts.map((q) => stripDistance(s, q[0], q[1]))),
          lots: p.lots.map((l) => pts.map((q) => lotDistance(l, q[0], q[1])))
        };
      }
      case "margins":
        return arr(i.radii, "radii").map((r) => ({ keepOff: keepOffMarginFor(r), obstacle: obstacleMarginFor(r) }));
      // ── paint ──
      case "readGroundLayers":
        return readGroundLayers(i.transform ?? null).map((c) => ({ surface: c.surface, layer: c.layer, strength: c.strength, hasStrength: c.hasStrength }));
      case "resolveGroundPaint": {
        const p = resolveGroundPaint(arr(i.layers, "layers"), choices(i.authored));
        const rules = {};
        for (const s of GROUND_SURFACES) rules[s] = { layer: p.rules[s].layer, strength: p.rules[s].strength, why: p.rules[s].why };
        return { rules, notes: [...p.notes] };
      }
      case "groundNoise":
        return arr(i.samples, "samples").map((x) => {
          const s = arr(x, "a sample");
          return groundNoise01(s[0], s[1], s[2], s[3]);
        });
      case "groundCoverage": {
        const p = plan(i.plan);
        return points(i.points).map((q) => ({ ...sampleGroundCoverage(p, q[0], q[1]) }));
      }
      case "groundLayerWeights": {
        const p = plan(i.plan);
        const paint = resolveGroundPaint(arr(i.layers, "layers"), choices(i.authored));
        return points(i.points).map((q) => groundLayerWeights(paint, sampleGroundCoverage(p, q[0], q[1])));
      }
      case "clump": {
        const c = num(i, "clumping");
        const cell = num(i, "cell");
        return points(i.points).map((q) => ({ weight: clumpWeight(q[0], q[1], c, cell), thins: clumpThins(q[0], q[1], c, cell) }));
      }
      // ── backdrop ──
      case "lookHash01":
        return arr(i.samples, "samples").map((x) => {
          const s = arr(x, "a sample");
          return lookHash01(s[0], s[1]);
        });
      case "backdropRing": {
        const box = obj(i.box, "a box");
        const ring = obj(i.ring, "a ring");
        return backdropRing(
          { minX: num(box, "minX"), minZ: num(box, "minZ"), maxX: num(box, "maxX"), maxZ: num(box, "maxZ"), minY: num(box, "minY") },
          { count: num(ring, "count"), outside: num(ring, "outside"), scale: num(ring, "scale"), scaleJitter: num(ring, "scaleJitter"), sink: num(ring, "sink") },
          num(i, "ringIndex"),
          arr(i.meshHalfExtents, "meshHalfExtents")
        ).map((p) => ({ ...p }));
      }
      case "backdropFrame": {
        const box = obj(i.box, "a box");
        const m = obj(i.mesh, "a mesh");
        const f = backdropFrame(
          { minX: num(box, "minX"), minZ: num(box, "minZ"), maxX: num(box, "maxX"), maxZ: num(box, "maxZ"), minY: num(box, "minY") },
          { minX: num(m, "minX"), minZ: num(m, "minZ"), maxX: num(m, "maxX"), maxZ: num(m, "maxZ") },
          vec(i.pieceScale),
          num(i, "offsetY"),
          present(i, "edgeMinY") ? num(i, "edgeMinY") : null
        );
        return { laid: f.laid, outerHalfX: f.outerHalfX, outerHalfZ: f.outerHalfZ, height: f.height, strips: f.strips.map((s) => ({ ...s })) };
      }
      default:
        return bad(`unknown layout op '${op}'`);
    }
  }
  var LAYOUT_OPS = [
    "isDoorPartName",
    "faceYawOf",
    "chooseDoorPart",
    "bodyStature",
    "fitBuildingToLot",
    "findFitOverlaps",
    "settleSeparation",
    "settleBodies",
    "settleFittedBuildings",
    "settleClearance",
    "clearancePairGap",
    "markerClearance",
    "plantWallClearance",
    "settleBuildingMaxShift",
    "pairingSeatSink",
    "layoutObstaclesOf",
    "plantTrunkOutline",
    "layoutConstants",
    "buildGroundPlan",
    "gradeTerrain",
    "followSettledBuildings",
    "pathMouths",
    "lanternsAtPathMouths",
    "keepPlantPropsOffPaving",
    "trimGeneratedPoints",
    "keepLookNeighbours",
    "keepStatedRows",
    "planDistances",
    "margins",
    "readGroundLayers",
    "resolveGroundPaint",
    "groundNoise",
    "groundCoverage",
    "groundLayerWeights",
    "clump",
    "lookHash01",
    "lookNeighbours",
    "lookPropStands",
    "backdropRing",
    "backdropFrame"
  ];

  // @insimul/core/src/editor/layout/composition/rules.ts
  var TRANSITION_SURFACES = ["road", "plaza", "path", "lot"];
  var PROP_PURPOSES = ["goods", "work", "seat", "sign", "planting", "flora"];
  var DEFAULT_COMPOSITION_RULES = deepFreeze({
    network: {
      laneHalfWidthM: 1.25,
      pathHalfWidthM: 0.6,
      minVisibleHalfWidthM: 0.5,
      laneLotClearanceM: 0.3,
      laneReachM: 24,
      streetJoinReachM: 18,
      doorStepOutM: 1,
      sampleStepM: 1,
      maxWalkGrade: 0.2
    },
    transitions: {
      featherM: { road: 3.5, plaza: 3, path: 3, lot: 3 },
      edgeBreakupM: 0.3,
      edgeBreakupCellM: 6,
      maxEdgeGradientPerM: 0.75,
      minEdgeContrast: 0.1
    },
    grouping: {
      purposeByArchetype: {
        "prop.container.crate": "goods",
        "prop.container.barrel": "goods",
        "prop.container.sack": "goods",
        "prop.container.basket": "goods",
        "prop.container.cauldron": "work",
        "prop.furniture.anvil": "work",
        "prop.furniture.workbench": "work",
        "prop.furniture.bench": "seat",
        "prop.structural.sign": "sign",
        "prop.structural.banner": "sign",
        "prop.vegetation.planter": "planting",
        "prop.vegetation.flower": "flora",
        "prop.vegetation.fern": "flora",
        "prop.vegetation.tuft": "flora",
        "prop.vegetation.grass": "flora"
      },
      anchorsByPurpose: {
        goods: ["cart", "building"],
        work: ["building", "cart"],
        seat: ["route", "building"],
        sign: ["building", "cart"],
        planting: ["building", "route"],
        flora: []
      },
      cartArchetypes: ["prop.vehicle.cart", "prop.furniture.stall", "prop.structural.well"],
      tieReachM: 3,
      regroupReachM: 20,
      clusterSpacingM: 1.2,
      clusterStandOffM: 0.5,
      packGapM: 0.35,
      blockMinAreaM2: 2,
      rowToleranceM: 0.2,
      floraSquareMarginM: 0.6
    },
    yards: {
      roleByArchetype: {
        "building.farm": "farm",
        "building.blacksmith": "smithy",
        "building.smithy": "smithy",
        "building.bakery": "bakery",
        "building.restaurant": "inn",
        "building.inn": "inn",
        "building.tavern": "inn",
        "building.shop": "shop",
        "building.residence": "home"
      },
      defaultRole: "home",
      edgeByRole: { farm: "fence", smithy: "wall", bakery: "fence", inn: "wall", shop: "fence", home: "hedge" },
      itemsByRole: {
        farm: ["prop.container.hay", "prop.vehicle.cart", "prop.container.trough"],
        smithy: ["prop.container.coal", "prop.furniture.grindstone"],
        bakery: ["prop.container.woodpile", "prop.container.sack"],
        inn: ["prop.container.barrel", "prop.furniture.bench"],
        shop: ["prop.container.crate"],
        home: ["prop.furniture.washline", "prop.vegetation.planter"]
      },
      porchWidthM: 2.4,
      porchDepthM: 1.5,
      porchPostReachM: 3,
      porchDeckMarginM: 0.3,
      yardEdgeInsetM: 0.3,
      gateGapM: 3,
      minYardGapM: 1,
      edgePostSpacingM: 2,
      yardItemInsetM: 1
    },
    lanterns: {
      routeReachM: 3,
      besideRouteM: 0.5,
      minSpacingM: 5,
      postClearM: 0.3
    },
    foliage: {
      kindByArchetype: {
        "prop.vegetation.tree": "tree",
        "prop.vegetation.sapling": "sapling",
        "prop.vegetation.tree.sapling": "sapling",
        "prop.vegetation.fern": "undergrowth",
        "prop.vegetation.tuft": "undergrowth",
        "prop.vegetation.bush": "undergrowth",
        "prop.vegetation.grass": "undergrowth"
      },
      fillArchetype: "prop.vegetation.fern",
      treeWallSetbackM: 3,
      saplingWallSetbackM: 1.5,
      setBackMarginM: 0.2,
      groveCellM: 12,
      grovePull: 0.5,
      undergrowthReachM: 4,
      undergrowthRingM: 0.8,
      undergrowthSpacingM: 0.45,
      clumpCellM: 5,
      clumpPull: 0.6,
      evenSpacingMaxCv: 0.25
    },
    variety: {
      neighbourReachM: 20,
      minRoofGapM: 2,
      blankWallViewM: 8,
      wayUpOffsetM: 0.6,
      wayUpArchetype: "prop.structural.stair"
    },
    seating: {
      seatSpanM: 0.6,
      seatReachM: 6,
      singleSeatArchetypes: ["prop.furniture.chair", "prop.furniture.stool"]
    },
    reach: {
      bodyKeepClearM: 0.45,
      workReachM: 0.8
    }
  });
  function byLongestPrefix(table, archetype) {
    let best = null;
    for (const k of Object.keys(table)) {
      if ((archetype === k || archetype.startsWith(`${k}.`)) && (best === null || k.length > best.length)) best = k;
    }
    return best === null ? null : table[best];
  }
  function underAnyPrefix(prefixes, archetype) {
    return prefixes.some((k) => archetype === k || archetype.startsWith(`${k}.`));
  }
  function compositionConstant(rules, key) {
    let v = rules;
    for (const part of key.split(".")) {
      if (typeof v !== "object" || v === null || !(part in v)) throw new Error(`no composition constant '${key}'`);
      v = v[part];
    }
    if (typeof v !== "number") throw new Error(`composition constant '${key}' is not a number`);
    return v;
  }
  function withCompositionConstant(rules, key, value) {
    compositionConstant(rules, key);
    const out = JSON.parse(JSON.stringify(rules));
    const parts = key.split(".");
    let o = out;
    for (const part of parts.slice(0, -1)) o = o[part];
    o[parts[parts.length - 1]] = value;
    return out;
  }
  function deepFreeze(v) {
    if (typeof v === "object" && v !== null) {
      for (const k of Object.keys(v)) deepFreeze(v[k]);
      Object.freeze(v);
    }
    return v;
  }

  // @insimul/core/src/editor/layout/composition/geometry.ts
  var COMPOSITION_SLACK = 1e-9;
  function compareIds2(a, b) {
    return a < b ? -1 : a > b ? 1 : 0;
  }
  function byEntityId(a, b) {
    return compareIds2(a.entityId, b.entityId);
  }
  function nearestOnPolyline(p, q, closed) {
    if (q.length === 0) return null;
    if (q.length === 1) return { at: [q[0][0], q[0][1]], d: Math.hypot(p[0] - q[0][0], p[1] - q[0][1]) };
    let best = null;
    const n = closed ? q.length : q.length - 1;
    for (let i = 0; i < n; i += 1) {
      const at = nearestOnSegment(p, q[i], q[(i + 1) % q.length]);
      const d = Math.hypot(at[0] - p[0], at[1] - p[1]);
      if (best === null || d < best.d - COMPOSITION_SLACK) best = { at, d };
    }
    return best;
  }
  function lotOutline(lot) {
    const ax = lot.awayX * lot.halfAway;
    const az = lot.awayZ * lot.halfAway;
    const cx = -lot.awayZ * lot.halfAcross;
    const cz = lot.awayX * lot.halfAcross;
    return [
      [lot.cx + ax + cx, lot.cz + az + cz],
      [lot.cx + ax - cx, lot.cz + az - cz],
      [lot.cx - ax - cx, lot.cz - az - cz],
      [lot.cx - ax + cx, lot.cz - az + cz]
    ];
  }
  function signedStripDistance(strip, x, z) {
    if (!strip.closed) return stripDistance(strip, x, z);
    const p = strip.points;
    if (p.length < 3) return Infinity;
    let edge = Infinity;
    for (let i = 0; i < p.length; i += 1) edge = Math.min(edge, pointSegmentDistance([x, z], p[i], p[(i + 1) % p.length]));
    return pointInOutline([x, z], p) ? -edge : edge;
  }
  function signedLotDistance(lot, x, z) {
    const dx = x - lot.cx;
    const dz = z - lot.cz;
    const away = Math.abs(dx * lot.awayX + dz * lot.awayZ) - lot.halfAway;
    const across = Math.abs(-dx * lot.awayZ + dz * lot.awayX) - lot.halfAcross;
    if (away <= 0 && across <= 0) return Math.max(away, across);
    return Math.hypot(Math.max(0, away), Math.max(0, across));
  }
  function signedOutlineDistance(p, outline) {
    const n = nearestOnPolyline(p, outline, true);
    if (n === null) return Infinity;
    return outline.length >= 3 && pointInOutline(p, outline) ? -n.d : n.d;
  }
  function cellHash01(ix, iz, salt) {
    let h = (Math.imul(ix | 0, 668265261) ^ Math.imul(iz | 0, 374761393) ^ (salt | 0)) >>> 0;
    h = Math.imul(h ^ h >>> 15, 739982445) >>> 0;
    h = Math.imul(h ^ h >>> 12, 695872825) >>> 0;
    h = (h ^ h >>> 15) >>> 0;
    return h / 4294967296;
  }
  function stringHash01(s) {
    let h = 2166136261;
    for (let i = 0; i < s.length; i += 1) h = Math.imul(h ^ s.charCodeAt(i), 16777619) >>> 0;
    return h / 4294967296;
  }

  // @insimul/core/src/editor/layout/composition/grouping.ts
  var GOLDEN = 0.6180339887498949;
  var CLUSTER_SPOTS = 256;
  function propPurpose(archetype, rules = DEFAULT_COMPOSITION_RULES) {
    return byLongestPrefix(rules.grouping.purposeByArchetype, archetype);
  }
  function anchorsOf(input, rules) {
    const g = rules.grouping;
    const out = [];
    for (const b of input.buildings) {
      if (b.outline.length < 3) continue;
      out.push({
        kind: "building",
        id: b.entityId,
        reach: (p) => {
          const n = nearestOnPolyline(p, b.outline, true);
          const inside = pointInOutline(p, b.outline);
          return { at: n.at, edge: inside ? 0 : n.d, inside };
        }
      });
    }
    for (const c of input.props) {
      if (!underAnyPrefix(g.cartArchetypes, c.archetype)) continue;
      out.push({
        kind: "cart",
        id: c.entityId,
        reach: (p) => {
          const d = Math.hypot(p[0] - c.x, p[1] - c.z);
          const k = d > COMPOSITION_SLACK ? c.radius / d : 0;
          const at = d > COMPOSITION_SLACK ? [c.x + (p[0] - c.x) * k, c.z + (p[1] - c.z) * k] : [c.x + c.radius, c.z];
          return { at, edge: Math.max(0, d - c.radius), inside: d < c.radius };
        }
      });
    }
    for (const s of input.plan.strips) {
      if (s.closed || s.surface !== "road" && s.surface !== "path" || s.points.length < 2) continue;
      out.push({
        kind: "route",
        id: s.entityId,
        reach: (p) => {
          const n = nearestOnPolyline(p, s.points, false);
          const inside = n.d < s.halfWidth;
          if (n.d <= COMPOSITION_SLACK) return { at: n.at, edge: 0, inside };
          const k = s.halfWidth / n.d;
          return { at: [n.at[0] + (p[0] - n.at[0]) * k, n.at[1] + (p[1] - n.at[1]) * k], edge: Math.max(0, n.d - s.halfWidth), inside };
        }
      });
    }
    return out;
  }
  function nearestAnchor(anchors, kinds, p, reach, exceptId) {
    let best = null;
    for (const a of anchors) {
      const rank = kinds.indexOf(a.kind);
      if (rank < 0 || a.id === exceptId) continue;
      const r = a.reach([p.x, p.z]);
      if (r === null) continue;
      const edge = Math.max(0, r.edge - p.radius);
      if (edge > reach + COMPOSITION_SLACK) continue;
      const better = best === null || edge < best.edge - COMPOSITION_SLACK || Math.abs(edge - best.edge) <= COMPOSITION_SLACK && (rank < best.rank || rank === best.rank && a.id < best.a.id);
      if (better) best = { a, edge, at: r.at, inside: r.inside, rank };
    }
    return best;
  }
  function squareReach(plan2, p, margin) {
    let best = null;
    for (const s of plan2.strips) {
      if (!s.closed || s.surface !== "plaza" || s.points.length < 3) continue;
      const n = nearestOnPolyline(p, s.points, true);
      const outside = pointInOutline(p, s.points) ? -n.d : n.d;
      if (outside >= margin - COMPOSITION_SLACK) continue;
      if (best === null || outside < best.outside) best = { id: s.entityId, at: n.at, outside };
    }
    return best;
  }
  function onSquareFloor(plan2, p) {
    return plan2.strips.some((s) => s.closed && s.surface === "plaza" && s.points.length >= 3 && pointInOutline(p, s.points));
  }
  function makesRow(standing, x, z, radius, rules) {
    const reach = 4 * rules.grouping.tieReachM;
    const near = standing.filter((q) => Math.hypot(q.x - x, q.z - z) <= reach).map((q, k) => ({ entityId: `s${k}`, archetype: "", x: q.x, z: q.z, radius: q.radius }));
    if (near.length < 2) return false;
    near.push({ entityId: "~spot", archetype: "", x, z, radius });
    return findBlocksAndRows(near, rules).rows.some((r) => r.includes("~spot"));
  }
  function findBlocksAndRows(props, rules = DEFAULT_COMPOSITION_RULES) {
    const g = rules.grouping;
    const n = props.length;
    const parent = Array.from({ length: n }, (_, k) => k);
    const find = (k) => {
      while (parent[k] !== k) k = parent[k] = parent[parent[k]];
      return k;
    };
    for (let i = 0; i < n; i += 1) {
      for (let j = i + 1; j < n; j += 1) {
        const gap = Math.hypot(props[i].x - props[j].x, props[i].z - props[j].z) - props[i].radius - props[j].radius;
        if (gap < g.packGapM) parent[find(i)] = find(j);
      }
    }
    const comps = /* @__PURE__ */ new Map();
    for (let k = 0; k < n; k += 1) comps.set(find(k), [...comps.get(find(k)) ?? [], k]);
    const blocks = [];
    for (const members of comps.values()) {
      if (members.length < 2) continue;
      const area = members.reduce((a, k) => a + 4 * props[k].radius * props[k].radius, 0);
      if (area >= g.blockMinAreaM2 - COMPOSITION_SLACK) blocks.push(members.map((k) => props[k].entityId).sort());
    }
    const seen = /* @__PURE__ */ new Set();
    const rows = [];
    const tol = g.rowToleranceM;
    for (let i = 0; i < n; i += 1) {
      for (let j = i + 1; j < n; j += 1) {
        const dx = props[j].x - props[i].x;
        const dz = props[j].z - props[i].z;
        const l = Math.hypot(dx, dz);
        if (l <= COMPOSITION_SLACK) continue;
        const ux = dx / l;
        const uz = dz / l;
        const on = props.map((p, k) => ({ k, s: (p.x - props[i].x) * ux + (p.z - props[i].z) * uz, off: Math.abs(-(p.x - props[i].x) * uz + (p.z - props[i].z) * ux) })).filter((q) => q.off <= tol + COMPOSITION_SLACK).sort((a, b) => a.s - b.s);
        for (let a = 0; a + 2 < on.length; a += 1) {
          let b = a + 1;
          const step = on[b].s - on[a].s;
          while (b + 1 < on.length && Math.abs(on[b + 1].s - on[b].s - step) <= tol + COMPOSITION_SLACK) b += 1;
          if (b - a < 2) continue;
          const ids = on.slice(a, b + 1).map((q) => props[q.k].entityId).sort();
          const key = ids.join("|");
          if (!seen.has(key)) {
            seen.add(key);
            rows.push(ids);
          }
        }
      }
    }
    const kept = rows.filter((r) => !rows.some((o) => o.length > r.length && r.every((id) => o.includes(id))));
    const sortSets = (s) => s.sort((a, b) => a.join("|") < b.join("|") ? -1 : 1);
    return { blocks: sortSets(blocks), rows: sortSets(kept) };
  }
  function auditPropGroups(input, rules = DEFAULT_COMPOSITION_RULES) {
    const g = rules.grouping;
    const anchors = anchorsOf(input, rules);
    const untied = [];
    const floraOnSquare = [];
    const open = [];
    for (const p of input.props) {
      const purpose = propPurpose(p.archetype, rules);
      if (purpose === null) continue;
      if (purpose === "flora") {
        const sq = squareReach(input.plan, [p.x, p.z], g.floraSquareMarginM + p.radius);
        if (sq !== null) floraOnSquare.push(p.entityId);
        continue;
      }
      const tied = nearestAnchor(anchors, g.anchorsByPurpose[purpose], p, g.tieReachM, p.entityId) !== null;
      if (!tied) untied.push(p.entityId);
      if (!tied || onSquareFloor(input.plan, [p.x, p.z])) open.push(p);
    }
    return { untied: untied.sort(), ...findBlocksAndRows(open, rules), floraOnSquare: floraOnSquare.sort() };
  }
  function groupProps(input, rules = DEFAULT_COMPOSITION_RULES) {
    const g = rules.grouping;
    const anchors = anchorsOf(input, rules);
    const before = auditPropGroups(input, rules);
    const why = /* @__PURE__ */ new Map();
    const add = (id, w) => why.set(id, [...why.get(id) ?? [], w].filter((x, k, a) => a.indexOf(x) === k));
    for (const id of before.untied) add(id, "untied");
    for (const b of before.blocks) for (const id of b) add(id, "block");
    for (const r of before.rows) for (const id of r) add(id, "row");
    const out = input.props.map((p) => ({
      entityId: p.entityId,
      purpose: propPurpose(p.archetype, rules),
      verdict: "left",
      anchor: null,
      why: why.get(p.entityId) ?? [],
      x: p.x,
      z: p.z,
      moved: 0
    }));
    const clusters = /* @__PURE__ */ new Map();
    input.props.forEach((p, k) => {
      const o = out[k];
      if (o.purpose === null) return;
      if (o.purpose === "flora") {
        const sq = squareReach(input.plan, [p.x, p.z], g.floraSquareMarginM + p.radius);
        if (sq === null) return;
        let nx = p.x - sq.at[0];
        let nz = p.z - sq.at[1];
        let l = Math.hypot(nx, nz);
        if (l <= COMPOSITION_SLACK) {
          [nx, nz, l] = [1, 0, 1];
        }
        const sign = sq.outside < 0 ? -1 : 1;
        const off = g.floraSquareMarginM + p.radius;
        o.x = sq.at[0] + nx / l * sign * off;
        o.z = sq.at[1] + nz / l * sign * off;
        o.verdict = "off-square";
        o.moved = Math.hypot(o.x - p.x, o.z - p.z);
        return;
      }
      const kinds = g.anchorsByPurpose[o.purpose];
      const tied = nearestAnchor(anchors, kinds, p, g.tieReachM, p.entityId);
      if (o.why.length === 0 && tied !== null) {
        o.verdict = "tied";
        o.anchor = { kind: tied.a.kind, id: tied.a.id };
        return;
      }
      const to = tied ?? nearestAnchor(anchors, kinds, p, g.regroupReachM, p.entityId);
      if (to === null) {
        o.verdict = "set-aside";
        return;
      }
      const key = `${to.a.kind}:${to.a.id}`;
      const c = clusters.get(key) ?? { anchor: to.a, at: to.at, members: [] };
      c.members.push(k);
      clusters.set(key, c);
    });
    const purposeRank = (k) => PROP_PURPOSES.indexOf(out[k].purpose);
    const regrouping = new Set([...clusters.values()].flatMap((c) => c.members));
    const standing = input.props.map((p, k) => ({ x: out[k].x, z: out[k].z, radius: p.radius, k })).filter((q) => !regrouping.has(q.k) && out[q.k].verdict !== "set-aside");
    const spotAt = (anchor, at, n, p) => {
      const [nx, nz] = n;
      const tx = -nz;
      const tz = nx;
      const out0 = g.clusterStandOffM + p.radius;
      for (let j = 0; j < CLUSTER_SPOTS; j += 1) {
        const phi = (j * GOLDEN % 1 - 0.5) * Math.PI * 0.9;
        const rho = g.clusterSpacingM * Math.sqrt(j + 1);
        const x = at[0] + nx * (out0 + rho * Math.cos(phi)) + tx * rho * Math.sin(phi);
        const z = at[1] + nz * (out0 + rho * Math.cos(phi)) + tz * rho * Math.sin(phi);
        const mine = anchor.reach([x, z]);
        if (mine.inside || Math.max(0, mine.edge - p.radius) > g.tieReachM + COMPOSITION_SLACK) continue;
        if (anchors.some((a) => a.id !== p.entityId && (() => {
          const q = a.reach([x, z]);
          return q !== null && (q.inside || q.edge < p.radius - COMPOSITION_SLACK);
        })())) continue;
        if (standing.some((q) => Math.hypot(q.x - x, q.z - z) - q.radius - p.radius < g.packGapM)) continue;
        if (makesRow(standing, x, z, p.radius, rules)) continue;
        return [x, z];
      }
      return null;
    };
    const outOf = (anchor, from) => {
      const r = anchor.reach(from);
      let nx = from[0] - r.at[0];
      let nz = from[1] - r.at[1];
      let l = Math.hypot(nx, nz);
      if (l <= COMPOSITION_SLACK) {
        [nx, nz, l] = [1, 0, 1];
      }
      const k = r.inside ? -1 : 1;
      return { at: r.at, n: [k * nx / l, k * nz / l] };
    };
    for (const key of [...clusters.keys()].sort()) {
      const c = clusters.get(key);
      c.members.sort((a, b) => purposeRank(a) - purposeRank(b) || (input.props[a].entityId < input.props[b].entityId ? -1 : 1));
      const first = input.props[c.members[0]];
      const own = outOf(c.anchor, [first.x, first.z]);
      for (const k of c.members) {
        const p = input.props[k];
        const o = out[k];
        let spot = spotAt(c.anchor, own.at, own.n, p);
        let anchor = c.anchor;
        if (spot === null) {
          const kinds = g.anchorsByPurpose[o.purpose];
          const others = anchors.map((a) => ({ a, rank: kinds.indexOf(a.kind), r: a.reach([p.x, p.z]) })).filter((x) => x.rank >= 0 && x.a.id !== p.entityId && x.a !== c.anchor && x.r !== null && Math.max(0, x.r.edge - p.radius) <= g.regroupReachM + COMPOSITION_SLACK).map((x) => ({ ...x, edge: Math.max(0, x.r.edge - p.radius) })).sort((x, y) => Math.abs(x.edge - y.edge) > COMPOSITION_SLACK ? x.edge - y.edge : x.rank - y.rank || (x.a.id < y.a.id ? -1 : x.a.id > y.a.id ? 1 : 0));
          for (const x of others) {
            const w = outOf(x.a, [p.x, p.z]);
            spot = spotAt(x.a, w.at, w.n, p);
            if (spot !== null) {
              anchor = x.a;
              break;
            }
          }
        }
        if (spot === null) {
          o.verdict = "set-aside";
          o.why = [...o.why, "crowded"];
          continue;
        }
        standing.push({ x: spot[0], z: spot[1], radius: p.radius });
        o.x = spot[0];
        o.z = spot[1];
        o.verdict = "regrouped";
        o.anchor = { kind: anchor.kind, id: anchor.id };
        o.moved = Math.hypot(o.x - p.x, o.z - p.z);
      }
    }
    const placed = input.props.map((p, k) => ({ ...p, x: out[k].x, z: out[k].z })).filter((_, k) => out[k].verdict !== "set-aside");
    return { props: out, before, after: auditPropGroups({ ...input, props: placed }, rules) };
  }
  function regroupedHeading(input, prop, rules = DEFAULT_COMPOSITION_RULES) {
    if (prop.verdict !== "regrouped" || prop.anchor === null) return null;
    const a = anchorsOf(input, rules).find((x) => x.kind === prop.anchor.kind && x.id === prop.anchor.id);
    if (a === void 0) return null;
    const r = a.reach([prop.x, prop.z]);
    if (r === null) return null;
    const dx = prop.x - r.at[0];
    const dz = prop.z - r.at[1];
    if (Math.hypot(dx, dz) <= COMPOSITION_SLACK) return null;
    return a.kind === "route" ? Math.atan2(-dz, -dx) : Math.atan2(dz, dx);
  }
  function trimFloraOffSquare(plan2, points3, rules = DEFAULT_COMPOSITION_RULES) {
    const out = [];
    points3.forEach((p, k) => {
      if (squareReach(plan2, p, rules.grouping.floraSquareMarginM) !== null) out.push(k);
    });
    return out;
  }

  // @insimul/core/src/editor/layout/composition/foliage.ts
  var UNDERGROWTH_PER_TREE = 3;
  var EVEN_AUDIT_MIN = 4;
  var EVEN_AUDIT_NEIGHBOURS = 3;
  var FOOT_SPOTS = 64;
  var GOLDEN_TURN = 2 * Math.PI * 0.3819660112501051;
  var GROVE_SALT = 1196576598;
  var CLUMP_SALT2 = 1129074e3;
  function foliageKind(archetype, rules = DEFAULT_COMPOSITION_RULES) {
    return byLongestPrefix(rules.foliage.kindByArchetype, archetype);
  }
  function onStrip(plan2, x, z) {
    return plan2.strips.some((s) => s.points.length >= 2 && signedStripDistance(s, x, z) <= COMPOSITION_SLACK);
  }
  function inLot(plan2, x, z) {
    return plan2.lots.some((l) => signedLotDistance(l, x, z) < -COMPOSITION_SLACK);
  }
  function inHouse(buildings, x, z) {
    return buildings.some((b) => b.outline.length >= 3 && pointInOutline([x, z], b.outline));
  }
  function auditFoliageSpacing(points3, rules = DEFAULT_COMPOSITION_RULES) {
    if (points3.length < 2) return { count: points3.length, meanNearest: null, cv: null, even: false };
    const nearest = points3.flatMap((p, i) => {
      const ds = [];
      for (let j = 0; j < points3.length; j += 1) if (j !== i) ds.push(Math.hypot(points3[j][0] - p[0], points3[j][1] - p[1]));
      return ds.sort((a, b) => a - b).slice(0, EVEN_AUDIT_NEIGHBOURS);
    });
    const mean = nearest.reduce((a, b) => a + b, 0) / nearest.length;
    const variance = nearest.reduce((a, b) => a + (b - mean) * (b - mean), 0) / nearest.length;
    const cv = mean > COMPOSITION_SLACK ? Math.sqrt(variance) / mean : null;
    return {
      count: points3.length,
      meanNearest: mean,
      cv,
      even: points3.length >= EVEN_AUDIT_MIN && cv !== null && cv < rules.foliage.evenSpacingMaxCv - COMPOSITION_SLACK
    };
  }
  function gatherByCell(members, cell, pull, salt, ok) {
    const out = /* @__PURE__ */ new Map();
    if (!(cell > 0)) return out;
    const cells = /* @__PURE__ */ new Map();
    for (const m of members) {
      const ix = Math.floor(m.x / cell);
      const iz = Math.floor(m.z / cell);
      const key = `${ix},${iz}`;
      if (!cells.has(key)) cells.set(key, { ix, iz, list: [] });
      cells.get(key).list.push(m);
    }
    for (const { ix, iz, list } of cells.values()) {
      if (list.length < 2) continue;
      const cx = list.reduce((a, m) => a + m.x, 0) / list.length + (cellHash01(ix, iz, salt) - 0.5) * 0.5 * cell;
      const cz = list.reduce((a, m) => a + m.z, 0) / list.length + (cellHash01(ix, iz, salt ^ 1515870810) - 0.5) * 0.5 * cell;
      for (const m of list) {
        const x = m.x + pull * (cx - m.x);
        const z = m.z + pull * (cz - m.z);
        out.set(m.k, ok(x, z) ? { x, z, blocked: false } : { x: m.x, z: m.z, blocked: true });
      }
    }
    return out;
  }
  function composeFoliage(input, rules = DEFAULT_COMPOSITION_RULES) {
    const f = rules.foliage;
    const { plan: plan2, buildings } = input;
    const houses = buildings.filter((b) => b.outline.length >= 3);
    const items = input.foliage.map((p) => ({
      entityId: p.entityId,
      archetype: p.archetype,
      kind: foliageKind(p.archetype, rules),
      verdict: "left",
      why: null,
      x: p.x,
      z: p.z,
      moved: 0,
      wall: null,
      host: null,
      generated: false
    }));
    const woody = items.map((it, k) => ({ it, k })).filter(({ it }) => it.kind === "tree" || it.kind === "sapling");
    const under = items.map((it, k) => ({ it, k })).filter(({ it }) => it.kind === "undergrowth");
    const before = {
      woody: auditFoliageSpacing(woody.map(({ it }) => [it.x, it.z]), rules),
      undergrowth: auditFoliageSpacing(under.map(({ it }) => [it.x, it.z]), rules)
    };
    const nearestWall = (x, z) => {
      let best = null;
      for (const b of houses) {
        const d = signedOutlineDistance([x, z], b.outline);
        if (best === null || d < best.d - COMPOSITION_SLACK || Math.abs(d - best.d) <= COMPOSITION_SLACK && b.entityId < best.b.entityId) best = { d, b };
      }
      return best;
    };
    const groves = gatherByCell(
      woody.map(({ it, k }) => ({ k, x: it.x, z: it.z })),
      f.groveCellM,
      f.grovePull,
      GROVE_SALT,
      (x, z) => !onStrip(plan2, x, z) && !inLot(plan2, x, z) && !inHouse(houses, x, z)
    );
    for (const { it, k } of woody) {
      it.verdict = "kept";
      const g = groves.get(k);
      if (g === void 0) continue;
      if (g.blocked) it.why = "pull-blocked";
      else if (Math.hypot(g.x - it.x, g.z - it.z) > COMPOSITION_SLACK) {
        it.x = g.x;
        it.z = g.z;
        it.verdict = "grove";
      }
    }
    const setback = (kind) => kind === "tree" ? f.treeWallSetbackM : f.saplingWallSetbackM;
    for (const { it } of woody) {
      const w = nearestWall(it.x, it.z);
      if (w === null) continue;
      const need = setback(it.kind);
      if (w.d >= need - COMPOSITION_SLACK) continue;
      const at = nearestOnPolyline([it.x, it.z], w.b.outline, true).at;
      let dx = it.x - at[0];
      let dz = it.z - at[1];
      let len = Math.hypot(dx, dz);
      if (w.d < 0) {
        dx = -dx;
        dz = -dz;
      }
      if (len <= COMPOSITION_SLACK) {
        const c = w.b.outline.reduce((a, p) => [a[0] + p[0] / w.b.outline.length, a[1] + p[1] / w.b.outline.length], [0, 0]);
        dx = at[0] - c[0];
        dz = at[1] - c[1];
        len = Math.hypot(dx, dz) || 1;
      }
      len = Math.hypot(dx, dz);
      const x = at[0] + dx / len * (need + f.setBackMarginM);
      const z = at[1] + dz / len * (need + f.setBackMarginM);
      const crowd = houses.some((b) => signedOutlineDistance([x, z], b.outline) < need - COMPOSITION_SLACK);
      if (onStrip(plan2, x, z) || crowd) {
        it.verdict = "set-aside";
        it.why = onStrip(plan2, x, z) ? "on-strip" : "walls";
        continue;
      }
      it.x = x;
      it.z = z;
      it.verdict = "set-back";
      it.why = null;
    }
    for (const { it, k } of woody) {
      const p = input.foliage[k];
      it.moved = Math.hypot(it.x - p.x, it.z - p.z);
      const w = nearestWall(it.x, it.z);
      it.wall = w === null ? null : w.d;
    }
    const trunks = woody.filter(({ it }) => it.verdict !== "set-aside").map(({ it }) => it);
    const feet = new Map(trunks.map((t) => [t.entityId, []]));
    const open = [];
    for (const u of under) {
      let host = null;
      let hd = Infinity;
      for (const t of trunks) {
        const d = Math.hypot(t.x - u.it.x, t.z - u.it.z);
        if (d < hd - COMPOSITION_SLACK || Math.abs(d - hd) <= COMPOSITION_SLACK && host !== null && t.entityId < host.entityId) {
          host = t;
          hd = d;
        }
      }
      if (host !== null && hd <= f.undergrowthReachM + COMPOSITION_SLACK) feet.get(host.entityId).push(u.it);
      else open.push(u);
    }
    const fills = [];
    const spotOk = (x, z) => !onStrip(plan2, x, z) && !inHouse(houses, x, z);
    for (const t of [...trunks].sort(byEntityId)) {
      const mine = feet.get(t.entityId).sort(byEntityId);
      const base = 2 * Math.PI * stringHash01(t.entityId);
      let spot = 0;
      const nextSpot = () => {
        while (spot < FOOT_SPOTS) {
          const k = spot;
          spot += 1;
          const r = f.undergrowthRingM + f.undergrowthSpacingM * Math.sqrt(k);
          const a = base + k * GOLDEN_TURN;
          const x = t.x + r * Math.cos(a);
          const z = t.z + r * Math.sin(a);
          if (spotOk(x, z)) return [x, z];
        }
        return null;
      };
      for (const u of mine) {
        const at = nextSpot();
        u.host = t.entityId;
        if (at === null) {
          u.verdict = "set-aside";
          u.why = "no-spot";
          continue;
        }
        u.verdict = "foot";
        u.x = at[0];
        u.z = at[1];
      }
      if (t.kind !== "tree") continue;
      for (let n = mine.length; n < UNDERGROWTH_PER_TREE; n += 1) {
        const at = nextSpot();
        if (at === null) break;
        fills.push({
          entityId: `${t.entityId}:undergrowth:${n}`,
          archetype: f.fillArchetype,
          kind: "undergrowth",
          verdict: "foot",
          why: null,
          x: at[0],
          z: at[1],
          moved: 0,
          wall: null,
          host: t.entityId,
          generated: true
        });
      }
    }
    const clumps = gatherByCell(open.map(({ it, k }) => ({ k, x: it.x, z: it.z })), f.clumpCellM, f.clumpPull, CLUMP_SALT2, spotOk);
    for (const { it, k } of open) {
      it.verdict = "kept";
      const c = clumps.get(k);
      if (c === void 0) continue;
      if (c.blocked) it.why = "pull-blocked";
      else if (Math.hypot(c.x - it.x, c.z - it.z) > COMPOSITION_SLACK) {
        it.x = c.x;
        it.z = c.z;
        it.verdict = "clump";
      }
    }
    for (const { it, k } of under) it.moved = Math.hypot(it.x - input.foliage[k].x, it.z - input.foliage[k].z);
    const all = [...items, ...fills];
    const standing = (it) => it.verdict !== "set-aside" && it.verdict !== "left";
    const after = {
      woody: auditFoliageSpacing(all.filter((it) => (it.kind === "tree" || it.kind === "sapling") && standing(it)).map((it) => [it.x, it.z]), rules),
      undergrowth: auditFoliageSpacing(all.filter((it) => it.kind === "undergrowth" && standing(it)).map((it) => [it.x, it.z]), rules)
    };
    return { items: all, audit: { before, after } };
  }

  // @insimul/core/src/editor/layout/composition/lanterns.ts
  var LANTERN_STATION_STEP_M = 0.5;
  var LANTERN_STATIONS = 8;
  var ROUTE_REPEAT_M = 1e-3;
  function withoutRepeats(s) {
    const pts = [];
    for (const p of s.points) {
      const last = pts[pts.length - 1];
      if (last === void 0 || Math.hypot(p[0] - last[0], p[1] - last[1]) > ROUTE_REPEAT_M) pts.push(p);
    }
    if (s.closed) while (pts.length > 1 && Math.hypot(pts[0][0] - pts[pts.length - 1][0], pts[0][1] - pts[pts.length - 1][1]) <= ROUTE_REPEAT_M) pts.pop();
    if (pts.length < (s.closed ? 3 : 2)) return null;
    return pts.length === s.points.length ? s : { ...s, points: pts };
  }
  function stationsOf(s, p) {
    const q = s.points;
    const n = s.closed ? q.length : q.length - 1;
    const cum = [0];
    for (let i = 0; i < n; i += 1) cum.push(cum[i] + Math.hypot(q[(i + 1) % q.length][0] - q[i][0], q[(i + 1) % q.length][1] - q[i][1]));
    const total = cum[n];
    let s0 = 0;
    let best = Infinity;
    for (let i = 0; i < n; i += 1) {
      const a = q[i];
      const b = q[(i + 1) % q.length];
      const dx = b[0] - a[0];
      const dz = b[1] - a[1];
      const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dz) / (dx * dx + dz * dz)));
      const d = Math.hypot(a[0] + dx * t - p[0], a[1] + dz * t - p[1]);
      if (d < best - COMPOSITION_SLACK) {
        best = d;
        s0 = cum[i] + t * (cum[i + 1] - cum[i]);
      }
    }
    const at = (arc) => {
      let u = arc;
      if (s.closed) u = (u % total + total) % total;
      else if (u < -COMPOSITION_SLACK || u > total + COMPOSITION_SLACK) return null;
      u = Math.max(0, Math.min(total, u));
      let i = 0;
      while (i < n - 1 && cum[i + 1] <= u) i += 1;
      const a = q[i];
      const b = q[(i + 1) % q.length];
      const len = cum[i + 1] - cum[i];
      const t = Math.max(0, Math.min(1, (u - cum[i]) / len));
      return { at: [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t], dir: [(b[0] - a[0]) / len, (b[1] - a[1]) / len] };
    };
    const out = [];
    for (let k = 0; k <= LANTERN_STATIONS; k += 1) {
      for (const sign of k === 0 ? [1] : [1, -1]) {
        const st = at(s0 + sign * k * LANTERN_STATION_STEP_M);
        if (st !== null) out.push(st);
      }
    }
    return out;
  }
  function lanternsOnRoutes(input, rules = DEFAULT_COMPOSITION_RULES) {
    const r = rules.lanterns;
    const routes = [...input.plan.strips, ...input.routes ?? []].filter((s) => s.closed ? s.surface === "plaza" : s.surface === "road" || s.surface === "path").map(withoutRepeats).filter((s) => s !== null);
    const open = routes.filter((s) => !s.closed);
    const buildings = input.buildings.filter((b) => b.outline.length >= 3);
    const props = input.props;
    const lines2 = (input.lines ?? []).filter((q) => q.points.length >= 2);
    const clear = (x, z, own) => {
      for (const b of buildings) if (signedOutlineDistance([x, z], b.outline) < r.postClearM - COMPOSITION_SLACK) return false;
      for (const p of props) if (Math.hypot(p.x - x, p.z - z) - p.radius < r.postClearM - COMPOSITION_SLACK) return false;
      for (const q of lines2) if (nearestOnPolyline([x, z], q.points, false).d < r.postClearM - COMPOSITION_SLACK) return false;
      for (const s of open) if (nearestOnPolyline([x, z], s.points, false).d < s.halfWidth + r.besideRouteM - COMPOSITION_SLACK) return false;
      if (own.closed && nearestOnPolyline([x, z], own.points, true).d < r.besideRouteM - COMPOSITION_SLACK) return false;
      return true;
    };
    const spotOn = (s, l) => {
      const stations = stationsOf(s, [l.x, l.z]);
      const first = stations[0];
      const left = (st) => [-st.dir[1], st.dir[0]];
      if (s.closed) {
        const wantInside = pointInOutline([l.x, l.z], s.points);
        for (const st of stations) {
          const [lx, lz] = left(st);
          const probe = [st.at[0] + lx * 1e-6, st.at[1] + lz * 1e-6];
          const k = pointInOutline(probe, s.points) === wantInside ? 1 : -1;
          const x = st.at[0] + k * lx * r.besideRouteM;
          const z = st.at[1] + k * lz * r.besideRouteM;
          if (clear(x, z, s)) return [x, z];
        }
        return null;
      }
      const cross = first.dir[0] * (l.z - first.at[1]) - first.dir[1] * (l.x - first.at[0]);
      const own = cross < -COMPOSITION_SLACK ? -1 : 1;
      const off = s.halfWidth + r.besideRouteM;
      for (const side of [own, -own]) {
        for (const st of stations) {
          const [lx, lz] = left(st);
          const x = st.at[0] + side * lx * off;
          const z = st.at[1] + side * lz * off;
          if (clear(x, z, s)) return [x, z];
        }
      }
      return null;
    };
    const found = input.lanterns.map((l) => {
      const near = routes.map((s) => {
        const n = nearestOnPolyline([l.x, l.z], s.points, s.closed);
        const edge = s.closed && pointInOutline([l.x, l.z], s.points) ? 0 : Math.max(0, n.d - (s.closed ? 0 : s.halfWidth));
        return { s, edge };
      }).sort((a, b) => Math.abs(a.edge - b.edge) > COMPOSITION_SLACK ? a.edge - b.edge : compareIds2(a.s.entityId, b.s.entityId));
      return { l, near };
    });
    const out = input.lanterns.map((l) => ({ entityId: l.entityId, verdict: "loose", route: null, edge: null, x: l.x, z: l.z, moved: 0 }));
    const order = found.map((f, k) => ({ ...f, k })).sort((a, b) => {
      const ea = a.near[0]?.edge ?? Infinity;
      const eb = b.near[0]?.edge ?? Infinity;
      if (Math.abs(ea - eb) > COMPOSITION_SLACK) return ea - eb;
      return compareIds2(a.l.entityId, b.l.entityId);
    });
    const placed = [];
    for (const { l, near, k } of order) {
      const o = out[k];
      if (near.length === 0) continue;
      o.edge = near[0].edge;
      if (near[0].edge > r.routeReachM + COMPOSITION_SLACK) continue;
      let spot = null;
      for (const { s, edge } of near) {
        if (edge > r.routeReachM + COMPOSITION_SLACK) break;
        const at = spotOn(s, l);
        if (at !== null) {
          spot = { s, at };
          break;
        }
      }
      if (spot === null) {
        o.verdict = "blocked";
        o.route = near[0].s.entityId;
        continue;
      }
      o.route = spot.s.entityId;
      const [x, z] = spot.at;
      if (placed.some((p) => Math.hypot(p[0] - x, p[1] - z) < r.minSpacingM - COMPOSITION_SLACK)) {
        o.verdict = "crowded";
        continue;
      }
      placed.push([x, z]);
      o.verdict = "on-route";
      o.x = x;
      o.z = z;
      o.moved = Math.hypot(x - l.x, z - l.z);
    }
    return out;
  }

  // @insimul/core/src/editor/layout/composition/reach.ts
  var REACH_PASSES = 4;
  var REACH_VERDICT_TOLERANCE = 1e-6;
  function propEdgeDistance(p, x, z) {
    return Math.hypot(x - p.x, z - p.z) - p.radius;
  }
  function standAt(p, x, z, edge) {
    let dx = x - p.x;
    let dz = z - p.z;
    let len = Math.hypot(dx, dz);
    if (len <= COMPOSITION_SLACK) {
      dx = 1;
      dz = 0;
      len = 1;
    }
    return [p.x + dx / len * (p.radius + edge), p.z + dz / len * (p.radius + edge)];
  }
  function keepClearOfProps(input, rules = DEFAULT_COMPOSITION_RULES) {
    const r = rules.reach;
    const props = [...input.props].sort(byEntityId);
    return input.villagers.map((v) => {
      const target = v.target == null ? null : props.find((p) => p.entityId === v.target) ?? null;
      let x = v.x;
      let z = v.z;
      for (let pass = 0; pass < REACH_PASSES; pass += 1) {
        let changed = false;
        if (target !== null) {
          const d = propEdgeDistance(target, x, z);
          if (d < r.bodyKeepClearM - COMPOSITION_SLACK) [x, z] = standAt(target, x, z, r.bodyKeepClearM);
          else if (d > r.workReachM + COMPOSITION_SLACK) [x, z] = standAt(target, x, z, r.workReachM);
          changed || (changed = d < r.bodyKeepClearM - COMPOSITION_SLACK || d > r.workReachM + COMPOSITION_SLACK);
        }
        for (const p of props) {
          if (p === target) continue;
          if (propEdgeDistance(p, x, z) < r.bodyKeepClearM - COMPOSITION_SLACK) {
            [x, z] = standAt(p, x, z, r.bodyKeepClearM);
            changed = true;
          }
        }
        if (!changed) break;
      }
      const targetEdge = target === null ? null : propEdgeDistance(target, x, z);
      let nearest = null;
      for (const p of props) {
        const e = propEdgeDistance(p, x, z);
        if (nearest === null || e < nearest.edge - COMPOSITION_SLACK) nearest = { prop: p.entityId, edge: e };
      }
      const tooNear = props.some((p) => propEdgeDistance(p, x, z) < r.bodyKeepClearM - REACH_VERDICT_TOLERANCE);
      const outOfReach = targetEdge !== null && targetEdge > r.workReachM + REACH_VERDICT_TOLERANCE;
      const moved2 = Math.hypot(x - v.x, z - v.z);
      return {
        entityId: v.entityId,
        verdict: tooNear || outOfReach ? "blocked" : moved2 > COMPOSITION_SLACK ? "moved" : "clear",
        x,
        z,
        moved: moved2,
        heading: target === null ? null : Math.atan2(target.z - z, target.x - x),
        targetEdge,
        nearest
      };
    });
  }

  // @insimul/core/src/editor/layout/composition/seating.ts
  function seatCapacity(seat, rules = DEFAULT_COMPOSITION_RULES) {
    if (!(seat.length > 0)) return 0;
    if (underAnyPrefix(rules.seating.singleSeatArchetypes, seat.archetype)) return 1;
    const span = rules.seating.seatSpanM;
    return span > 0 ? Math.max(0, Math.floor(seat.length / span + COMPOSITION_SLACK)) : 0;
  }
  function seatVillagers(input, rules = DEFAULT_COMPOSITION_RULES) {
    const props = input.props ?? [];
    const keep = rules.reach.bodyKeepClearM;
    const seats = input.seats.map((s) => {
      const capacity = seatCapacity(s, rules);
      const ax = -Math.sin(s.heading);
      const az = Math.cos(s.heading);
      const slots = [];
      for (let i = 0; i < capacity; i += 1) {
        const t = (i + 0.5) * s.length / capacity - s.length / 2;
        const x = s.x + ax * t;
        const z = s.z + az * t;
        let blocked = null;
        for (const p of props) {
          const e = propEdgeDistance(p, x, z);
          if (e < keep - COMPOSITION_SLACK && (blocked === null || e < blocked.e - COMPOSITION_SLACK || Math.abs(e - blocked.e) <= COMPOSITION_SLACK && p.entityId < blocked.id)) blocked = { id: p.entityId, e };
        }
        slots.push({ x, z, blocked: blocked?.id ?? null, sitter: null });
      }
      return { entityId: s.entityId, capacity, slots };
    });
    const pairs = [];
    input.sitters.forEach((v, si) => {
      seats.forEach(
        (s, ki) => s.slots.forEach((slot, li) => {
          if (slot.blocked !== null) return;
          const d = Math.hypot(slot.x - v.x, slot.z - v.z);
          if (d <= rules.seating.seatReachM + COMPOSITION_SLACK) pairs.push({ d, sitter: si, seat: ki, slot: li });
        })
      );
    });
    const cmp = compareIds2;
    pairs.sort(
      (a, b) => (Math.abs(a.d - b.d) > COMPOSITION_SLACK ? a.d - b.d : 0) || cmp(input.sitters[a.sitter].entityId, input.sitters[b.sitter].entityId) || cmp(seats[a.seat].entityId, seats[b.seat].entityId) || a.slot - b.slot
    );
    const sitters = input.sitters.map((v) => ({ entityId: v.entityId, verdict: "standing", seat: null, slot: null, x: v.x, z: v.z, heading: null }));
    for (const p of pairs) {
      const who = sitters[p.sitter];
      const slot = seats[p.seat].slots[p.slot];
      if (who.verdict === "seated" || slot.sitter !== null) continue;
      slot.sitter = who.entityId;
      who.verdict = "seated";
      who.seat = seats[p.seat].entityId;
      who.slot = p.slot;
      who.x = slot.x;
      who.z = slot.z;
      who.heading = input.seats[p.seat].heading;
    }
    return { seats, sitters };
  }

  // @insimul/core/src/editor/layout/composition/variety.ts
  var HOUSE_SIDES = ["front", "back", "left", "right"];
  function axes(h) {
    const f = [Math.cos(h.heading), Math.sin(h.heading)];
    return { f, l: [-f[1], f[0]] };
  }
  function houseFootprint(h, m) {
    const { f, l } = axes(h);
    const d = m.depth / 2;
    const w = m.width / 2;
    const at = (a, b) => [h.x + f[0] * a + l[0] * b, h.z + f[1] * a + l[1] * b];
    return [at(d, -w), at(d, w), at(-d, w), at(-d, -w)];
  }
  function houseWall(h, m, side) {
    const { f, l } = axes(h);
    const s = side === "front" ? { v: f, r: m.depth / 2 } : side === "back" ? { v: [-f[0], -f[1]], r: m.depth / 2 } : side === "left" ? { v: l, r: m.width / 2 } : { v: [-l[0], -l[1]], r: m.width / 2 };
    return { at: [h.x + s.v[0] * s.r, h.z + s.v[1] * s.r], n: s.v };
  }
  function turnedBlank(m, mirrored) {
    const out = m.blank.map((s) => !mirrored ? s : s === "left" ? "right" : s === "right" ? "left" : s);
    return HOUSE_SIDES.filter((s) => out.includes(s));
  }
  function openBlankWalls(h, m, mirrored, lots, rules = DEFAULT_COMPOSITION_RULES) {
    const view2 = rules.variety.blankWallViewM;
    const others = lots.filter((l) => l.entityId !== h.entityId).map(lotOutline);
    return turnedBlank(m, mirrored).filter((side) => {
      const { at, n } = houseWall(h, m, side);
      const end = [at[0] + n[0] * view2, at[1] + n[1] * view2];
      return !others.some((o) => segmentOutlineDistance(at, end, o) <= COMPOSITION_SLACK || pointInOutline(end, o));
    });
  }
  function lexLess(a, b) {
    for (let i = 0; i < a.length; i += 1) if (a[i] !== b[i]) return a[i] < b[i];
    return false;
  }
  function assignHouseModels(input, rules = DEFAULT_COMPOSITION_RULES) {
    const v = rules.variety;
    const houses = [...input.houses].sort(byEntityId);
    const models = input.models;
    if (models.length === 0) return { houses: [], unplaced: houses.map((h) => h.entityId) };
    const done = [];
    const near = (a, b) => Math.hypot(a.x - b.x, a.z - b.z) <= v.neighbourReachM + COMPOSITION_SLACK;
    const crowds = (a, b) => planSeparation(a, b).gap < v.minRoofGapM - COMPOSITION_SLACK;
    houses.forEach((h, k) => {
      let best = null;
      for (let j = 0; j < models.length; j += 1) {
        const m = models[(j + k) % models.length];
        const fp = houseFootprint(h, m);
        for (const mirrored of [false, true]) {
          const score = [
            done.filter((d) => crowds(fp, d.fp)).length,
            done.filter((d) => near(h, d.h) && d.m.id === m.id && d.mirrored === mirrored).length,
            openBlankWalls(h, m, mirrored, input.lots, rules).length,
            done.filter((d) => near(h, d.h) && d.m.id === m.id).length
          ];
          if (best === null || lexLess(score, best.score)) best = { score, m, mirrored, fp };
        }
      }
      done.push({ h, m: best.m, mirrored: best.mirrored, fp: best.fp });
    });
    return {
      houses: done.map((d) => {
        const openBlank = openBlankWalls(d.h, d.m, d.mirrored, input.lots, rules);
        return {
          entityId: d.h.entityId,
          model: d.m.id,
          mirrored: d.mirrored,
          footprint: d.fp,
          openBlank,
          wayUps: openBlank.map((side) => {
            const { at, n } = houseWall(d.h, d.m, side);
            return { side, archetype: v.wayUpArchetype, x: at[0] + n[0] * v.wayUpOffsetM, z: at[1] + n[1] * v.wayUpOffsetM, heading: Math.atan2(n[1], n[0]) };
          }),
          repeats: done.filter((o) => o !== d && near(d.h, o.h) && o.m.id === d.m.id).map((o) => o.h.entityId),
          crowdedWith: done.filter((o) => o !== d && crowds(d.fp, o.fp)).map((o) => o.h.entityId)
        };
      }),
      unplaced: []
    };
  }

  // @insimul/core/src/editor/layout/composition/network.ts
  function convexHull(points3) {
    const pts = [...points3].map((p) => [p[0], p[1]]).sort((a, b) => a[0] - b[0] || a[1] - b[1]);
    if (pts.length < 3) return pts;
    const cross = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
    const half = (list) => {
      const h = [];
      for (const p of list) {
        while (h.length >= 2 && cross(h[h.length - 2], h[h.length - 1], p) <= COMPOSITION_SLACK) h.pop();
        h.push(p);
      }
      h.pop();
      return h;
    };
    return [...half(pts), ...half([...pts].reverse())];
  }
  function offsetHull(hull, off) {
    const n = hull.length;
    const normal = (a, b) => {
      const l = Math.hypot(b[0] - a[0], b[1] - a[1]);
      return [(b[1] - a[1]) / l, -(b[0] - a[0]) / l];
    };
    return hull.map((c, i) => {
      const n1 = normal(hull[(i + n - 1) % n], c);
      const n2 = normal(c, hull[(i + 1) % n]);
      const k = off / (1 + n1[0] * n2[0] + n1[1] * n2[1]);
      return [c[0] + (n1[0] + n2[0]) * k, c[1] + (n1[1] + n2[1]) * k];
    });
  }
  function roundHouse(p, t, hull, ring, half) {
    const clears = (a, b) => segmentOutlineDistance(a, b, hull) >= half - COMPOSITION_SLACK;
    if (clears(p, t)) return [];
    const n = hull.length;
    let side = 0;
    for (let i = 1; i < n; i += 1) {
      if (pointSegmentDistance(p, hull[i], hull[(i + 1) % n]) < pointSegmentDistance(p, hull[side], hull[(side + 1) % n]) - COMPOSITION_SLACK) side = i;
    }
    const walk = (d) => {
      const pts = [];
      let k = d > 0 ? side + 1 : side;
      for (let step = 0; step < n; step += 1, k += d) {
        const q = ring[(k % n + n) % n];
        pts.push(q);
        if (clears(q, t)) {
          let length = 0;
          let at = p;
          for (const x of [...pts, t]) {
            length += Math.hypot(x[0] - at[0], x[1] - at[1]);
            at = x;
          }
          return { pts, length };
        }
      }
      return null;
    };
    const ccw = walk(1);
    const cw = walk(-1);
    if (ccw === null && cw === null) return [];
    if (cw === null || ccw !== null && ccw.length <= cw.length + COMPOSITION_SLACK) return ccw.pts;
    return cw.pts;
  }
  function lotGate(lot, standOff) {
    const reach = lot.halfAway + standOff;
    return [lot.cx + lot.awayX * reach, lot.cz + lot.awayZ * reach];
  }
  function groundRun(polyline, terrain, step) {
    const at = (x, z) => [x, terrain !== null ? layoutGroundAt(terrain, x, z) : 0, z];
    const out = [];
    if (polyline.length === 0) return out;
    out.push(at(polyline[0][0], polyline[0][1]));
    for (let i = 0; i + 1 < polyline.length; i += 1) {
      const [ax, az] = polyline[i];
      const [bx, bz] = polyline[i + 1];
      const len = Math.hypot(bx - ax, bz - az);
      const n = Math.max(1, Math.ceil(len / step - COMPOSITION_SLACK));
      for (let k = 1; k <= n; k += 1) out.push(at(ax + (bx - ax) * k / n, az + (bz - az) * k / n));
    }
    return out;
  }
  function runProfile(points3) {
    let length = 0;
    let maxGrade = 0;
    for (let i = 0; i + 1 < points3.length; i += 1) {
      const d = Math.hypot(points3[i + 1][0] - points3[i][0], points3[i + 1][2] - points3[i][2]);
      const dy = points3[i + 1][1] - points3[i][1];
      length += Math.hypot(d, dy);
      if (d > COMPOSITION_SLACK) maxGrade = Math.max(maxGrade, Math.abs(dy) / d);
    }
    return { length, maxGrade };
  }
  function streetReach(strip, p) {
    const q = strip.points;
    if (q.length < 2) return null;
    if (strip.closed) {
      if (pointInOutline(p, q)) return { at: [p[0], p[1]], edge: 0 };
      let best2 = null;
      for (let i = 0; i < q.length; i += 1) {
        const at = nearestOnSegment(p, q[i], q[(i + 1) % q.length]);
        const d = Math.hypot(at[0] - p[0], at[1] - p[1]);
        if (best2 === null || d < best2.edge) best2 = { at, edge: d };
      }
      return best2;
    }
    let best = null;
    for (let i = 0; i + 1 < q.length; i += 1) {
      const at = nearestOnSegment(p, q[i], q[i + 1]);
      const d = Math.hypot(at[0] - p[0], at[1] - p[1]);
      if (best === null || d < best.d) best = { at, d };
    }
    return best === null ? null : { at: best.at, edge: Math.max(0, best.d - strip.halfWidth) };
  }
  function composeLaneNetwork(input, rules = DEFAULT_COMPOSITION_RULES) {
    const r = rules.network;
    const { plan: plan2 } = input;
    const notes = [];
    const widthOf2 = (stated, fallbackHalf, note) => {
      const half = stated != null && stated > 0 ? stated / 2 : fallbackHalf;
      if (half < r.minVisibleHalfWidthM) {
        notes.push(note);
        return r.minVisibleHalfWidthM;
      }
      return half;
    };
    const laneHalf = widthOf2(input.laneWidthM, r.laneHalfWidthM, "lane-widened");
    const pathHalf = widthOf2(input.pathWidthM, r.pathHalfWidthM, "path-widened");
    const keepOff = laneHalf + r.laneLotClearanceM;
    const lots = plan2.lots;
    const outlines = lots.map(lotOutline);
    const gates = lots.map((l) => lotGate(l, keepOff));
    const clear = (a, b) => outlines.every((o) => segmentOutlineDistance(a, b, o) >= keepOff - COMPOSITION_SLACK);
    const run = (polyline) => {
      const points3 = groundRun(polyline, plan2.terrain, r.sampleStepM);
      return { points: points3, ...runProfile(points3) };
    };
    const n = lots.length;
    const street = n;
    const candidates = [];
    for (let i = 0; i < n; i += 1) {
      for (let j = i + 1; j < n; j += 1) {
        const d = Math.hypot(gates[j][0] - gates[i][0], gates[j][1] - gates[i][1]);
        if (d > r.laneReachM || !clear(gates[i], gates[j])) continue;
        const polyline = [gates[i], gates[j]];
        candidates.push({ a: i, b: j, to: lots[j].entityId, polyline, ...run(polyline) });
      }
      let best = null;
      for (const s of plan2.strips) {
        if (s.surface !== "road" && s.surface !== "plaza") continue;
        const reach = streetReach(s, gates[i]);
        if (reach === null || reach.edge > r.streetJoinReachM || !clear(gates[i], reach.at)) continue;
        const polyline = [gates[i], reach.at];
        const c = { a: i, b: street, to: s.entityId, polyline, ...run(polyline) };
        if (best === null || c.length < best.length - COMPOSITION_SLACK || Math.abs(c.length - best.length) <= COMPOSITION_SLACK && c.to < best.to) best = c;
      }
      if (best !== null) candidates.push(best);
    }
    const key = (c) => `${lots[c.a].entityId}~${c.to}`;
    candidates.sort((x, y) => Math.abs(x.length - y.length) > COMPOSITION_SLACK ? x.length - y.length : key(x) < key(y) ? -1 : key(x) > key(y) ? 1 : 0);
    const parent = Array.from({ length: n + 1 }, (_, k) => k);
    const find = (k) => {
      while (parent[k] !== k) {
        parent[k] = parent[parent[k]];
        k = parent[k];
      }
      return k;
    };
    const lanes = [];
    for (const c of candidates) {
      const ra = find(c.a);
      const rb = find(c.b);
      if (ra === rb) continue;
      parent[ra] = rb;
      lanes.push({
        id: `lane:${key(c)}`,
        kind: "lane",
        from: lots[c.a].entityId,
        to: c.to,
        halfWidth: laneHalf,
        points: c.points,
        length: c.length,
        maxGrade: c.maxGrade,
        stepped: c.maxGrade > r.maxWalkGrade
      });
    }
    const unjoined = lots.filter((_, k) => find(k) !== find(street)).map((l) => l.entityId);
    const houses = new Map((input.buildings ?? []).filter((b) => b.outline.length >= 3).map((b) => [b.entityId, convexHull(b.outline)]));
    const off = Math.max(r.doorStepOutM, pathHalf);
    const edgeAway = (l) => l.halfAway - rules.yards.yardEdgeInsetM;
    const frame = (l, q) => {
      const dx = q[0] - l.cx;
      const dz = q[1] - l.cz;
      return [dx * l.awayX + dz * l.awayZ, -dx * l.awayZ + dz * l.awayX];
    };
    const missesGap = (l, a, gate) => {
      const [ua, va] = frame(l, a);
      const [ug, vg] = frame(l, gate);
      const line = edgeAway(l);
      if (ua >= line - COMPOSITION_SLACK || ug <= line + COMPOSITION_SLACK) return false;
      const v = va + (line - ua) / (ug - ua) * (vg - va);
      return Math.abs(v) > Math.max(0, rules.yards.gateGapM / 2 - pathHalf) + COMPOSITION_SLACK;
    };
    const paths = [];
    const noLot = [];
    const served = /* @__PURE__ */ new Set();
    const pathPolylines = [];
    for (const d of input.doors) {
      const k = lots.findIndex((l) => l.entityId === d.entityId);
      if (k < 0) {
        noLot.push(d.entityId);
        continue;
      }
      const out = [d.x + Math.cos(d.heading) * r.doorStepOutM, d.z + Math.sin(d.heading) * r.doorStepOutM];
      const polyline = [[d.x, d.z], out];
      const lot = lots[k];
      const hull = houses.get(d.entityId) ?? null;
      const ring = hull === null ? null : offsetHull(hull, off);
      const round = (a, t) => hull === null ? [] : roundHouse(a, t, hull, ring, pathHalf);
      let mid = round(out, gates[k]);
      const last = mid.length > 0 ? mid[mid.length - 1] : out;
      if (missesGap(lot, last, gates[k])) {
        const depth = Math.max(edgeAway(lot) - off, frame(lot, last)[0]);
        const approach = [lot.cx + lot.awayX * depth, lot.cz + lot.awayZ * depth];
        if (hull === null || segmentOutlineDistance(approach, approach, hull) >= pathHalf - COMPOSITION_SLACK) mid = [...round(out, approach), approach];
      }
      polyline.push(...mid);
      const tail = polyline[polyline.length - 1];
      if (Math.hypot(gates[k][0] - tail[0], gates[k][1] - tail[1]) > COMPOSITION_SLACK) polyline.push(gates[k]);
      const p = run(polyline);
      pathPolylines.push(polyline);
      served.add(lots[k].lotId);
      paths.push({
        id: `path:${d.entityId}`,
        kind: "path",
        from: d.entityId,
        to: `gate:${lots[k].entityId}`,
        halfWidth: pathHalf,
        points: p.points,
        length: p.length,
        maxGrade: p.maxGrade,
        stepped: p.maxGrade > r.maxWalkGrade
      });
    }
    const strips = [
      ...lanes.map((l) => ({
        entityId: l.id,
        surface: "path",
        lotId: "",
        points: [
          [l.points[0][0], l.points[0][2]],
          [l.points[l.points.length - 1][0], l.points[l.points.length - 1][2]]
        ],
        halfWidth: l.halfWidth,
        closed: false
      })),
      ...paths.map((p, k) => ({
        entityId: p.id,
        surface: "path",
        lotId: lots.find((l) => l.entityId === p.from).lotId,
        points: pathPolylines[k].map((q) => [q[0], q[1]]),
        halfWidth: p.halfWidth,
        closed: false
      }))
    ];
    const supersedes = plan2.strips.filter((s) => s.surface === "path" && s.lotId !== "" && served.has(s.lotId)).map((s) => s.entityId);
    return {
      gates: lots.map((l, k) => ({ entityId: l.entityId, x: gates[k][0], z: gates[k][1] })),
      lanes,
      paths,
      strips,
      unjoined,
      noLot,
      supersedes,
      notes
    };
  }

  // @insimul/core/src/editor/layout/composition/yards.ts
  var YARD_SIDES = ["back", "across+", "across-", "front"];
  function yardRole(archetype, rules = DEFAULT_COMPOSITION_RULES) {
    return byLongestPrefix(rules.yards.roleByArchetype, archetype) ?? rules.yards.defaultRole;
  }
  function porchFor(door2, posts, rules) {
    const y = rules.yards;
    const hx = Math.cos(door2.heading);
    const hz = Math.sin(door2.heading);
    let depth = y.porchDepthM;
    let halfWidth = y.porchWidthM / 2;
    for (const p of posts) {
      const dx = p.x - door2.x;
      const dz = p.z - door2.z;
      depth = Math.max(depth, dx * hx + dz * hz + y.porchDeckMarginM);
      halfWidth = Math.max(halfWidth, Math.abs(-dx * hz + dz * hx) + y.porchDeckMarginM);
    }
    return {
      door: door2.entityId,
      x: door2.x + hx * depth / 2,
      z: door2.z + hz * depth / 2,
      heading: door2.heading,
      halfWidth,
      depth,
      posts: posts.map((p) => p.entityId).sort()
    };
  }
  function porchDeckOutline(d) {
    const hx = Math.cos(d.heading);
    const hz = Math.sin(d.heading);
    const ox = hx * d.depth / 2;
    const oz = hz * d.depth / 2;
    const ax = -hz * d.halfWidth;
    const az = hx * d.halfWidth;
    return [
      [d.x - ox - ax, d.z - oz - az],
      [d.x + ox - ax, d.z + oz - az],
      [d.x + ox + ax, d.z + oz + az],
      [d.x - ox + ax, d.z - oz + az]
    ];
  }
  function postsAlong(a, b, spacing) {
    const l = Math.hypot(b[0] - a[0], b[1] - a[1]);
    const out = [];
    for (let k = 0; k * spacing < l - COMPOSITION_SLACK; k += 1) out.push([a[0] + (b[0] - a[0]) * k * spacing / l, a[1] + (b[1] - a[1]) * k * spacing / l]);
    out.push([b[0], b[1]]);
    return out;
  }
  function composeYards(input, rules = DEFAULT_COMPOSITION_RULES) {
    const y = rules.yards;
    const posts = input.posts ?? [];
    const claimed = /* @__PURE__ */ new Map();
    const loosePosts = [];
    for (const p of posts) {
      let best = null;
      for (const d of input.doors) {
        const dist = Math.hypot(p.x - d.x, p.z - d.z);
        if (dist > y.porchPostReachM + COMPOSITION_SLACK) continue;
        if (best === null || dist < best.d - COMPOSITION_SLACK || Math.abs(dist - best.d) <= COMPOSITION_SLACK && d.entityId < best.id) best = { id: d.entityId, d: dist };
      }
      if (best === null) loosePosts.push(p.entityId);
      else claimed.set(best.id, [...claimed.get(best.id) ?? [], p]);
    }
    const porches = input.doors.map((d) => porchFor(d, claimed.get(d.entityId) ?? [], rules));
    const yards = [];
    for (const lot of input.lots) {
      const b = input.buildings.find((x) => x.entityId === lot.entityId);
      const role = yardRole(b?.archetype ?? "", rules);
      const edge = y.edgeByRole[role] ?? y.edgeByRole[y.defaultRole] ?? "none";
      const ax = lot.awayX;
      const az = lot.awayZ;
      const ux = -az;
      const uz = ax;
      const toPlan = (s, w) => [lot.cx + ux * s + ax * w, lot.cz + uz * s + az * w];
      const hA = lot.halfAcross;
      const hW = lot.halfAway;
      const gaps = { back: 2 * hW, "across+": 2 * hA, "across-": 2 * hA, front: 2 * hW };
      const outline = b?.outline != null && b.outline.length >= 3 ? b.outline : null;
      if (outline !== null) {
        let sMin = Infinity;
        let sMax = -Infinity;
        let wMin = Infinity;
        let wMax = -Infinity;
        for (const p of outline) {
          const s = (p[0] - lot.cx) * ux + (p[1] - lot.cz) * uz;
          const w = (p[0] - lot.cx) * ax + (p[1] - lot.cz) * az;
          sMin = Math.min(sMin, s);
          sMax = Math.max(sMax, s);
          wMin = Math.min(wMin, w);
          wMax = Math.max(wMax, w);
        }
        gaps.back = wMin + hW;
        gaps["across+"] = hA - sMax;
        gaps["across-"] = sMin + hA;
        gaps.front = hW - wMax;
      }
      const clear = (side) => gaps[side] >= y.minYardGapM - COMPOSITION_SLACK;
      const tooTight = YARD_SIDES.filter((s) => !clear(s));
      const edges = [];
      if (edge !== "none") {
        const i = y.yardEdgeInsetM;
        const sE = hA - i;
        const wE = hW - i;
        const runs = [
          ["back", -sE, -wE, sE, -wE],
          ["across+", sE, -wE, sE, wE],
          ["across-", -sE, -wE, -sE, wE]
        ];
        const half = y.gateGapM / 2;
        if (sE - half > COMPOSITION_SLACK) runs.push(["front", -sE, wE, -half, wE], ["front", half, wE, sE, wE]);
        for (const [side, s0, w0, s1, w1] of runs) {
          if (!clear(side)) continue;
          const from = toPlan(s0, w0);
          const to = toPlan(s1, w1);
          edges.push({ side, kind: edge, from, to, posts: postsAlong(from, to, y.edgePostSpacingM) });
        }
      }
      const ins = y.yardItemInsetM;
      const slots = [
        ["back across+", hA - ins, -(hW - ins), ["back", "across+"]],
        ["back across-", -(hA - ins), -(hW - ins), ["back", "across-"]],
        ["side across+", hA - ins, 0, ["across+"]],
        ["side across-", -(hA - ins), 0, ["across-"]],
        ["front across+", hA - ins, hW - ins, ["front", "across+"]],
        ["front across-", -(hA - ins), hW - ins, ["front", "across-"]]
      ];
      const items = [];
      const want = [...y.itemsByRole[role] ?? []];
      for (const [slot, s, w, sides] of slots) {
        if (want.length === 0) break;
        const at = toPlan(s, w);
        if (!sides.some(clear) || outline !== null && pointInOutline(at, outline)) continue;
        items.push({ archetype: want.shift(), slot, x: at[0], z: at[1], heading: Math.atan2(lot.cz - at[1], lot.cx - at[0]) });
      }
      yards.push({
        entityId: lot.entityId,
        role,
        edge,
        gaps,
        tooTight,
        porches: porches.filter((p) => p.door === lot.entityId),
        edges,
        items,
        unplaced: want
      });
    }
    const noLot = input.doors.filter((d) => !input.lots.some((l) => l.entityId === d.entityId)).map((d) => d.entityId);
    return { yards, noLot, porches, loosePosts: loosePosts.sort() };
  }

  // @insimul/core/src/editor/layout/composition/village.ts
  var YARD_ITEM_RADIUS_M = 0.5;
  function withLaneNetwork(plan2, network) {
    const superseded = new Set(network.supersedes);
    return {
      strips: [...plan2.strips.filter((s) => !superseded.has(s.entityId)), ...network.strips],
      lots: plan2.lots,
      terrain: plan2.terrain
    };
  }
  function yardLines(yards) {
    return yards.yards.flatMap((y) => y.edges.map((e, k) => ({ entityId: `edge:${y.entityId}:${e.side}:${k}`, points: [e.from, e.to] })));
  }
  function postObstacles(yards, foliage, stairs) {
    const items = yards.yards.flatMap((y) => y.items.map((it) => ({ entityId: `yard:${y.entityId}:${it.slot}`, x: it.x, z: it.z, radius: YARD_ITEM_RADIUS_M })));
    const trunks = foliage.items.filter((f) => (f.kind === "tree" || f.kind === "sapling") && f.verdict !== "set-aside").map((f) => ({ entityId: f.entityId, x: f.x, z: f.z, radius: PLANT_TRUNK_HALF_M }));
    return [...items, ...trunks, ...stairs];
  }
  function composeVillage(input, rules = DEFAULT_COMPOSITION_RULES) {
    const network = composeLaneNetwork(
      { plan: input.plan, doors: input.doors, laneWidthM: input.laneWidthM, pathWidthM: input.pathWidthM, buildings: input.buildings },
      rules
    );
    const plan2 = withLaneNetwork(input.plan, network);
    const props = input.props ?? [];
    const grouping = groupProps({ plan: plan2, buildings: input.buildings, props }, rules);
    const radius = new Map(props.map((p) => [p.entityId, p.radius]));
    const standing = grouping.props.filter((p) => p.verdict !== "set-aside").map((p) => ({ entityId: p.entityId, x: p.x, z: p.z, radius: radius.get(p.entityId) }));
    const yards = composeYards({ lots: plan2.lots, buildings: input.buildings, doors: input.doors, posts: input.posts ?? [] }, rules);
    const decks = yards.porches.map((d) => ({ entityId: `porch:${d.door}`, outline: porchDeckOutline(d) }));
    const foliage = composeFoliage({ plan: plan2, buildings: input.buildings, foliage: input.foliage ?? [] }, rules);
    const lanterns = lanternsOnRoutes(
      { plan: plan2, lanterns: input.lanterns ?? [], buildings: [...input.buildings, ...decks], props: [...standing, ...postObstacles(yards, foliage, input.stairs ?? [])], lines: yardLines(yards) },
      rules
    );
    const stoodAt = new Map(grouping.props.map((p) => [p.entityId, p]));
    const seatsSetAside = [];
    const seatsTurned = [];
    const seats = [];
    for (const s of input.seats ?? []) {
      const p = stoodAt.get(s.entityId);
      if (p === void 0) seats.push({ ...s });
      else if (p.verdict === "set-aside") seatsSetAside.push(s.entityId);
      else {
        const turned = regroupedHeading({ plan: plan2, buildings: input.buildings, props }, p, rules);
        if (turned !== null) seatsTurned.push({ entityId: s.entityId, heading: turned });
        seats.push({ ...s, x: p.x, z: p.z, heading: turned ?? s.heading });
      }
    }
    const seatIds = new Set((input.seats ?? []).map((s) => s.entityId));
    const seating = seatVillagers({ seats, sitters: input.sitters ?? [], props: standing.filter((p) => !seatIds.has(p.entityId)) }, rules);
    const reach = keepClearOfProps({ villagers: input.villagers ?? [], props: standing }, rules);
    return { plan: plan2, network, grouping, lanterns, yards, foliage, seatsSetAside, seatsTurned, seating, reach };
  }

  // @insimul/core/src/editor/layout/composition/transitions.ts
  var BREAKUP_SALT = 1162102597;
  var NOISE_SLOPE_BOUND = 1.875 * Math.SQRT2 * (0.68 + 0.32 / 0.43);
  function clamp012(v) {
    return v < 0 ? 0 : v > 1 ? 1 : v;
  }
  function transitionCoverage(distance, feather) {
    if (distance <= 0) return 1;
    if (!(feather > 0) || distance >= feather) return 0;
    const t = clamp012(distance / feather);
    return 1 - t * t * (3 - 2 * t);
  }
  function edgeBreakup(x, z, rules = DEFAULT_COMPOSITION_RULES) {
    const t = rules.transitions;
    if (!(t.edgeBreakupM > 0)) return 0;
    return t.edgeBreakupM * (2 * groundNoise01(x, z, t.edgeBreakupCellM, BREAKUP_SALT) - 1);
  }
  function groundTransitionCoverage(plan2, x, z, rules = DEFAULT_COMPOSITION_RULES) {
    const c = sampleGroundCoverage(plan2, x, z);
    const f = rules.transitions.featherM;
    const b = edgeBreakup(x, z, rules);
    c.road = 0;
    c.plaza = 0;
    c.path = 0;
    c.lot = 0;
    for (const s of plan2.strips) {
      c[s.surface] = Math.max(c[s.surface], transitionCoverage(signedStripDistance(s, x, z) - b, f[s.surface]));
    }
    for (const l of plan2.lots) c.lot = Math.max(c.lot, transitionCoverage(signedLotDistance(l, x, z) - b, f.lot));
    return c;
  }
  function transitionSteepestGradient(surface, rules = DEFAULT_COMPOSITION_RULES) {
    const t = rules.transitions;
    const feather = t.featherM[surface];
    if (!(feather > 0)) return Infinity;
    const breakup = t.edgeBreakupM > 0 && t.edgeBreakupCellM > 0 ? 2 * t.edgeBreakupM * NOISE_SLOPE_BOUND / t.edgeBreakupCellM : 0;
    return 1.5 / feather * (1 + breakup);
  }
  function hardTransitionSurfaces(rules = DEFAULT_COMPOSITION_RULES) {
    return TRANSITION_SURFACES.filter((s) => transitionSteepestGradient(s, rules) > rules.transitions.maxEdgeGradientPerM);
  }
  function auditGroundEdges(samples, rules = DEFAULT_COMPOSITION_RULES) {
    const t = rules.transitions;
    let maxGradient = 0;
    const edges = [];
    let start = -1;
    let steepest = 0;
    const close = (end) => {
      const rise = samples[end][1] - samples[start][1];
      if (Math.abs(rise) >= t.minEdgeContrast) edges.push({ s0: samples[start][0], s1: samples[end][0], rise, gradient: steepest });
      start = -1;
      steepest = 0;
    };
    for (let i = 0; i + 1 < samples.length; i += 1) {
      const ds = samples[i + 1][0] - samples[i][0];
      if (!(ds > 0)) continue;
      const g = Math.abs(samples[i + 1][1] - samples[i][1]) / ds;
      maxGradient = Math.max(maxGradient, g);
      if (g > t.maxEdgeGradientPerM) {
        if (start < 0) start = i;
        steepest = Math.max(steepest, g);
      } else if (start >= 0) {
        close(i);
      }
    }
    if (start >= 0) close(samples.length - 1);
    return { maxGradient, edges };
  }
  function coverageProfile(plan2, surface, from, to, step, source, rules = DEFAULT_COMPOSITION_RULES) {
    const len = Math.hypot(to[0] - from[0], to[1] - from[1]);
    const n = Math.max(1, Math.ceil(len / step - COMPOSITION_SLACK));
    const out = [];
    for (let k = 0; k <= n; k += 1) {
      const x = from[0] + (to[0] - from[0]) * k / n;
      const z = from[1] + (to[1] - from[1]) * k / n;
      const c = source === "transition" ? groundTransitionCoverage(plan2, x, z, rules) : sampleGroundCoverage(plan2, x, z);
      out.push([len * k / n, c[surface]]);
    }
    return out;
  }

  // @insimul/core/src/editor/layout/composition/corpus.ts
  function bad2(why) {
    throw new Error(`composition corpus: ${why}`);
  }
  function obj2(v, what) {
    if (typeof v !== "object" || v === null || Array.isArray(v)) bad2(`${what} is not an object`);
    return v;
  }
  function arr2(v, what) {
    if (!Array.isArray(v)) bad2(`${what} is not an array`);
    return v;
  }
  function num2(o, k) {
    const v = o[k];
    if (typeof v !== "number") bad2(`'${k}' is not a number`);
    return v;
  }
  function str2(o, k) {
    const v = o[k];
    if (typeof v !== "string") bad2(`'${k}' is not a string`);
    return v;
  }
  function point2(v, what) {
    const p = arr2(v, what);
    if (p.length !== 2 || typeof p[0] !== "number" || typeof p[1] !== "number") bad2(`${what} is not [x, z]`);
    return [p[0], p[1]];
  }
  function points2(v, what) {
    return arr2(v, what).map((p, k) => point2(p, `${what}[${k}]`));
  }
  function terrainOf(v) {
    if (v === void 0 || v === null) return null;
    const t = obj2(v, "terrain");
    return {
      resolution: num2(t, "resolution"),
      sizeX: num2(t, "sizeX"),
      sizeZ: num2(t, "sizeZ"),
      heights: arr2(t.heights, "terrain.heights")
    };
  }
  function stripOf(v) {
    const s = obj2(v, "a strip");
    const surface = str2(s, "surface");
    if (surface !== "road" && surface !== "plaza" && surface !== "path") bad2(`unknown strip surface '${surface}'`);
    return {
      entityId: str2(s, "entityId"),
      surface,
      lotId: typeof s.lotId === "string" ? s.lotId : "",
      points: points2(s.points, "a strip's points"),
      halfWidth: num2(s, "halfWidth"),
      closed: s.closed === true
    };
  }
  function lotOf(v) {
    const l = obj2(v, "a lot");
    return {
      entityId: str2(l, "entityId"),
      lotId: typeof l.lotId === "string" ? l.lotId : "",
      cx: num2(l, "cx"),
      cz: num2(l, "cz"),
      halfAcross: num2(l, "halfAcross"),
      halfAway: num2(l, "halfAway"),
      awayX: num2(l, "awayX"),
      awayZ: num2(l, "awayZ")
    };
  }
  function compositionPlan(v) {
    const p = obj2(v, "plan");
    return {
      strips: arr2(p.strips ?? [], "plan.strips").map(stripOf),
      lots: arr2(p.lots ?? [], "plan.lots").map(lotOf),
      terrain: terrainOf(p.terrain)
    };
  }
  function surfaceOf(v) {
    if (typeof v !== "string" || !TRANSITION_SURFACES.includes(v)) bad2(`unknown transition surface ${JSON.stringify(v)}`);
    return v;
  }
  function json(v) {
    return JSON.parse(JSON.stringify(v));
  }
  function applyRuleOverrides(rules, input) {
    const o = input.ruleOverrides;
    if (o === void 0) return rules;
    let out = rules;
    for (const [k, v] of Object.entries(obj2(o, "ruleOverrides"))) {
      if (typeof v !== "number") bad2(`ruleOverrides '${k}' is not a number`);
      out = withCompositionConstant(out, k, v);
    }
    return out;
  }
  function doorsOf(v) {
    return arr2(v ?? [], "doors").map((d) => {
      const o = obj2(d, "a door");
      return { entityId: str2(o, "entityId"), x: num2(o, "x"), z: num2(o, "z"), heading: num2(o, "heading") };
    });
  }
  function groupingInput(i) {
    return {
      plan: compositionPlan(i.plan),
      buildings: outlinedBuildings(i.buildings),
      props: propsOf(i.props)
    };
  }
  function propsOf(v) {
    return arr2(v ?? [], "props").map((p) => {
      const o = obj2(p, "a prop");
      return { entityId: str2(o, "entityId"), archetype: str2(o, "archetype"), x: num2(o, "x"), z: num2(o, "z"), radius: num2(o, "radius") };
    });
  }
  function plannedOn(i) {
    const plan2 = compositionPlan(i.plan);
    if (i.terrain !== void 0) plan2.terrain = terrainOf(i.terrain);
    return plan2;
  }
  function widthOf(i, k) {
    return typeof i[k] === "number" ? i[k] : null;
  }
  function spotsOf(v, what) {
    return arr2(v ?? [], what).map((p) => {
      const o = obj2(p, what);
      return { entityId: str2(o, "entityId"), x: num2(o, "x"), z: num2(o, "z") };
    });
  }
  var postsOf = (v) => spotsOf(v, "posts");
  var lanternsOf = (v) => spotsOf(v, "lanterns");
  var sittersOf = (v) => spotsOf(v, "sitters");
  function foliageOf(v) {
    return arr2(v ?? [], "foliage").map((p) => {
      const o = obj2(p, "a foliage prop");
      return { entityId: str2(o, "entityId"), archetype: str2(o, "archetype"), x: num2(o, "x"), z: num2(o, "z") };
    });
  }
  function villagersOf(v) {
    return arr2(v ?? [], "villagers").map((p) => {
      const o = obj2(p, "a villager");
      return { entityId: str2(o, "entityId"), x: num2(o, "x"), z: num2(o, "z"), target: typeof o.target === "string" ? o.target : null };
    });
  }
  function outlinedBuildings(v) {
    return arr2(v ?? [], "buildings").map((b) => {
      const o = obj2(b, "a building");
      return { entityId: str2(o, "entityId"), outline: points2(o.outline, "a building's outline") };
    });
  }
  function reachProps(v) {
    return arr2(v ?? [], "props").map((p) => {
      const o = obj2(p, "a prop");
      return { entityId: str2(o, "entityId"), x: num2(o, "x"), z: num2(o, "z"), radius: num2(o, "radius") };
    });
  }
  function seatsOf(v) {
    return arr2(v ?? [], "seats").map((s) => {
      const o = obj2(s, "a seat");
      return { entityId: str2(o, "entityId"), archetype: str2(o, "archetype"), x: num2(o, "x"), z: num2(o, "z"), heading: num2(o, "heading"), length: num2(o, "length") };
    });
  }
  function modelsOf(v) {
    return arr2(v ?? [], "models").map((m) => {
      const o = obj2(m, "a model");
      const blank = arr2(o.blank ?? [], "a model's blank walls").map((s) => {
        if (typeof s !== "string" || !HOUSE_SIDES.includes(s)) bad2(`unknown house side ${JSON.stringify(s)}`);
        return s;
      });
      return { id: str2(o, "id"), width: num2(o, "width"), depth: num2(o, "depth"), blank };
    });
  }
  function runCompositionOp(op, input, rules = DEFAULT_COMPOSITION_RULES) {
    const i = obj2(input, "input");
    const r = applyRuleOverrides(rules, i);
    switch (op) {
      case "composeLaneNetwork":
        return json(
          composeLaneNetwork(
            {
              plan: plannedOn(i),
              doors: doorsOf(i.doors),
              laneWidthM: widthOf(i, "laneWidthM"),
              pathWidthM: widthOf(i, "pathWidthM"),
              buildings: i.buildings === void 0 ? void 0 : outlinedBuildings(i.buildings)
            },
            r
          )
        );
      case "transitionCoverage":
        return arr2(i.samples, "samples").map((s) => {
          const [d, f] = point2(s, "a [distance, feather] sample");
          return transitionCoverage(d, f);
        });
      case "edgeBreakup":
        return points2(i.points, "points").map((p) => edgeBreakup(p[0], p[1], r));
      case "groundTransitionCoverage": {
        const plan2 = compositionPlan(i.plan);
        return points2(i.points, "points").map((p) => json(groundTransitionCoverage(plan2, p[0], p[1], r)));
      }
      case "transitionBounds": {
        const out = {};
        for (const s of TRANSITION_SURFACES) out[s] = transitionSteepestGradient(s, r);
        out.hard = hardTransitionSurfaces(r);
        return out;
      }
      case "auditGroundEdges":
        return json(auditGroundEdges(arr2(i.samples, "samples").map((s) => point2(s, "an [s, w] sample")), r));
      case "coverageAudit": {
        const source = str2(i, "source");
        if (source !== "transition" && source !== "paint") bad2(`unknown coverage source '${source}'`);
        const profile = coverageProfile(
          compositionPlan(i.plan),
          surfaceOf(i.surface),
          point2(i.from, "from"),
          point2(i.to, "to"),
          num2(i, "step"),
          source,
          r
        );
        return json({ samples: profile.length, ...auditGroundEdges(profile, r) });
      }
      case "propPurpose":
        return arr2(i.archetypes, "archetypes").map((a) => {
          if (typeof a !== "string") bad2("an archetype is not a string");
          return propPurpose(a, r);
        });
      case "groupProps":
        return json(groupProps(groupingInput(i), r));
      case "auditPropGroups":
        return json(auditPropGroups(groupingInput(i), r));
      case "trimFloraOffSquare":
        return trimFloraOffSquare(compositionPlan(i.plan), points2(i.points, "points"), r);
      case "yardRole":
        return arr2(i.archetypes, "archetypes").map((a) => {
          if (typeof a !== "string") bad2("an archetype is not a string");
          return yardRole(a, r);
        });
      case "composeYards": {
        const buildings = arr2(i.buildings ?? [], "buildings").map((b) => {
          const o = obj2(b, "a building");
          return { entityId: str2(o, "entityId"), archetype: str2(o, "archetype"), outline: o.outline == null ? null : points2(o.outline, "an outline") };
        });
        return json(composeYards({ lots: compositionPlan(i.plan).lots, buildings, doors: doorsOf(i.doors), posts: postsOf(i.posts) }, r));
      }
      case "lanternsOnRoutes": {
        const routes = i.routes === void 0 ? [] : compositionPlan({ strips: i.routes }).strips;
        if (i.buildings === void 0 || i.props === void 0) bad2("a lanternsOnRoutes input states its 'buildings' and 'props' (empty means none)");
        const lines2 = arr2(i.lines ?? [], "lines").map((q) => {
          const o = obj2(q, "a line");
          return { entityId: str2(o, "entityId"), points: points2(o.points, "a line's points") };
        });
        return json(lanternsOnRoutes({ plan: compositionPlan(i.plan), routes, lanterns: lanternsOf(i.lanterns), buildings: outlinedBuildings(i.buildings), props: reachProps(i.props), lines: lines2 }, r));
      }
      case "foliageKind":
        return arr2(i.archetypes, "archetypes").map((a) => {
          if (typeof a !== "string") bad2("an archetype is not a string");
          return foliageKind(a, r);
        });
      case "composeFoliage":
        return json(composeFoliage({ plan: compositionPlan(i.plan ?? {}), buildings: outlinedBuildings(i.buildings), foliage: foliageOf(i.foliage) }, r));
      case "auditFoliageSpacing":
        return json(auditFoliageSpacing(points2(i.points, "points"), r));
      case "assignHouseModels": {
        const houses = arr2(i.houses ?? [], "houses").map((h) => {
          const o = obj2(h, "a house");
          return { entityId: str2(o, "entityId"), x: num2(o, "x"), z: num2(o, "z"), heading: num2(o, "heading") };
        });
        return json(assignHouseModels({ lots: compositionPlan(i.plan ?? {}).lots, houses, models: modelsOf(i.models) }, r));
      }
      case "seatCapacity":
        return seatsOf(i.seats).map((s) => seatCapacity(s, r));
      case "seatVillagers":
        return json(seatVillagers({ seats: seatsOf(i.seats), sitters: sittersOf(i.sitters), props: reachProps(i.props) }, r));
      case "keepClearOfProps":
        return json(keepClearOfProps({ villagers: villagersOf(i.villagers), props: reachProps(i.props) }, r));
      case "composeVillage": {
        const buildings = arr2(i.buildings ?? [], "buildings").map((b) => {
          const o = obj2(b, "a building");
          return { entityId: str2(o, "entityId"), archetype: str2(o, "archetype"), outline: points2(o.outline, "an outline") };
        });
        return json(
          composeVillage(
            {
              plan: plannedOn(i),
              doors: doorsOf(i.doors),
              laneWidthM: widthOf(i, "laneWidthM"),
              pathWidthM: widthOf(i, "pathWidthM"),
              buildings,
              props: propsOf(i.props),
              posts: postsOf(i.posts),
              lanterns: lanternsOf(i.lanterns),
              foliage: foliageOf(i.foliage),
              seats: seatsOf(i.seats),
              sitters: sittersOf(i.sitters),
              villagers: villagersOf(i.villagers),
              stairs: i.stairs === void 0 ? void 0 : reachProps(i.stairs)
            },
            r
          )
        );
      }
      default:
        return bad2(`unknown composition op '${op}'`);
    }
  }
  var COMPOSITION_OPS = [
    "composeLaneNetwork",
    "transitionCoverage",
    "edgeBreakup",
    "groundTransitionCoverage",
    "transitionBounds",
    "auditGroundEdges",
    "coverageAudit",
    "propPurpose",
    "groupProps",
    "auditPropGroups",
    "trimFloraOffSquare",
    "yardRole",
    "composeYards",
    "lanternsOnRoutes",
    "foliageKind",
    "composeFoliage",
    "auditFoliageSpacing",
    "assignHouseModels",
    "seatCapacity",
    "seatVillagers",
    "keepClearOfProps",
    "composeVillage"
  ];

  // corebridge/js/entry.js
  function refuse(method, message) {
    return new Error(`insimulcore: ${method}: ${message}`);
  }
  function needObject(method, value, name) {
    if (value === null || typeof value !== "object" || Array.isArray(value)) {
      throw refuse(method, `\`${name}\` must be a JSON object`);
    }
    return value;
  }
  function needArray(method, value, name) {
    if (!Array.isArray(value)) throw refuse(method, `\`${name}\` must be an array`);
    return value;
  }
  function needString(method, value, name) {
    if (typeof value !== "string") throw refuse(method, `\`${name}\` must be a string`);
    return value;
  }
  function needNumber(method, value, name) {
    if (typeof value !== "number" || !Number.isFinite(value)) throw refuse(method, `\`${name}\` must be a finite number`);
    return value;
  }
  function optNumber(method, value, name) {
    return value === void 0 || value === null ? void 0 : needNumber(method, value, name);
  }
  function oneOf(method, value, allowed, name) {
    if (!allowed.includes(value)) {
      throw refuse(method, `\`${name}\` must be one of ${allowed.join(", ")} (got ${JSON.stringify(value)})`);
    }
    return value;
  }
  function mapOf(method, value, name) {
    if (value === void 0 || value === null) return /* @__PURE__ */ new Map();
    return new Map(Object.entries(needObject(method, value, name)));
  }
  function plain(value) {
    return value === void 0 ? null : JSON.parse(JSON.stringify(value));
  }
  function layoutRow(op) {
    return (args) => runLayoutOp(op, args);
  }
  function compositionRow(op) {
    return (args) => runCompositionOp(op, args);
  }
  function migrateWithOutcome(saveFile) {
    const { save, outcome } = migrateSaveFileWithOutcome(saveFile);
    return { saveFile: save, outcome, significant: isMigrationOutcomeSignificant(outcome) };
  }
  var QUEST_STATUSES = ["available", "active", "completed"];
  var QUEST_FILTERS = ["all", "active", "completed", "available"];
  function questEntry(method, entry) {
    needObject(method, entry, "quest");
    needString(method, entry.id, "quest.id");
    oneOf(method, entry.status, QUEST_STATUSES, "quest.status");
    return entry;
  }
  function journalView(model) {
    return {
      filter: model.currentFilter(),
      filtered: model.filtered(),
      counts: model.counts(),
      tracked: model.trackedQuests(),
      maxTracked: model.maxTracked
    };
  }
  function completionView(engine) {
    return {
      quests: engine.getQuests().map((quest) => ({
        id: quest.id,
        complete: engine.isQuestComplete(quest.id),
        available: engine.getAvailableObjectives(quest.id).map((o) => o.id),
        locked: engine.getLockedObjectives(quest.id).map((o) => o.id),
        objectives: plain(quest.objectives ?? [])
      })),
      objectiveStates: plain(engine.serializeObjectiveStates())
    };
  }
  function clockView(clock) {
    return {
      state: clock.getState(),
      timeOfDay: clock.timeOfDay,
      fractionalHour: clock.fractionalHour,
      timeString: clock.timeString,
      isDaytime: clock.isDaytime,
      realSecondsPerGameHour: clock.realSecondsPerGameHour
    };
  }
  function recordingKb(writes) {
    return {
      assertFact: async (fact) => {
        writes.push({ op: "assert", fact });
      },
      retractFact: async (fact) => {
        writes.push({ op: "retract", fact });
      },
      query: async () => {
        throw new Error("insimulcore: a weather session has no KB to query \u2014 query the host KB");
      }
    };
  }
  function weatherSessionView(director) {
    return { state: director.serialize(), view: plain(director.view()), issues: director.issues() };
  }
  function weatherRunSteps(climate, seed, from, throughDay) {
    const start = from ?? { ...initialWeatherState(), day: -1 };
    const run = runWeather(start, climate, seed, throughDay);
    const steps = [];
    let previous = from;
    for (const state of run) {
      const view2 = weatherView(state, climate);
      steps.push({
        day: state.day,
        season: state.season,
        condition: state.condition,
        dayOfSeason: view2.dayOfSeason,
        severity: view2.severity,
        harsh: view2.harsh,
        barred: [...view2.barred],
        delta: weatherDelta(previous, state)
      });
      previous = state;
    }
    return { steps, final: run.length > 0 ? run[run.length - 1] : start };
  }
  function climateOf(method, args) {
    if (args.climate !== void 0 && args.climate !== null) return needObject(method, args.climate, "climate");
    const ir = args.weather === void 0 ? null : args.weather;
    if (ir !== null) needObject(method, ir, "weather");
    if (args.tuning !== void 0 && args.tuning !== null) {
      needObject(method, args.tuning, "tuning");
      return climateFromIR(ir, { ...weatherTuningFromIR(ir), ...args.tuning });
    }
    return climateFromIR(ir);
  }
  function activated(source, set) {
    return {
      source,
      active: set,
      predicatePacks: [...set.predicatePacks],
      hostInterfaces: [...set.hostInterfaces],
      reason: set.known ? "" : `core has no genre bundle "${set.genre}" \u2014 shared vocabulary only`
    };
  }
  function undeclared(reason) {
    return { source: "undeclared", active: null, predicatePacks: [...PREDICATE_PACK_AREAS], hostInterfaces: [], reason };
  }
  var METHODS = {
    // ── introspection ───────────────────────────────────────────────────────────
    /** `core.methods` — the method table, sorted; lets a gate assert the surface. */
    "core.methods": () => ({ methods: Object.keys(METHODS).sort() }),
    /**
     * `core.diagnostics` — what core logged (console.*) during the PREVIOUS call
     * on this handle. Nothing in this library prints; see js/host-console.js.
     * result: `{ lines: [{ level, text }], dropped }`
     */
    "core.diagnostics": () => diagnostics(),
    // ── sessions (js/host-sessions.js) ──────────────────────────────────────────
    /** `session.list` → `{ sessions: [{ session, kind }] }` */
    "session.list": () => ({ sessions: listSessions() }),
    /** `session.dispose { session }` → `{ disposed }` (false when none was open) */
    "session.dispose": (args) => ({ disposed: disposeSession(args.session) }),
    // ── radiant and quest parity (unchanged) ────────────────────────────────────
    /** `radiant.generate { kb, options: { seed, now, maxQuests? } }` → `{ quests }` */
    "radiant.generate": (args) => generateRadiantQuests(args.kb, args.options),
    /** `radiant.baseTemplates` → `{ templates, templateIds }` */
    "radiant.baseTemplates": () => ({
      templates: BASE_RADIANT_TEMPLATES,
      templateIds: BASE_RADIANT_TEMPLATE_IDS
    }),
    /** `quest.hydrate { content, status? }` → `{ quest }` (parity surface) */
    "quest.hydrate": (args) => ({
      quest: computeHydrationExpected({
        content: args.content,
        ...args.status ? { status: args.status } : {}
      })
    }),
    /** `quest.radiantTick { quests, maxOffering, ticks }` → `{ facts }` (parity surface) */
    "quest.radiantTick": (args) => ({
      facts: radiantTick({
        quests: args.quests || [],
        maxOffering: args.maxOffering,
        ticks: args.ticks
      })
    }),
    // ── saves (P1) ──────────────────────────────────────────────────────────────
    /**
     * `save.rules` — what a save view must not hard-code: the current version,
     * the envelope format, the migration chain and the registered extension keys.
     */
    "save.rules": () => ({
      saveFileVersion: SAVE_FILE_VERSION,
      envelopeFormat: SAVE_ENVELOPE_FORMAT,
      migrations: listMigrations().map(({ name, fromVersion, toVersion, description }) => ({
        name,
        fromVersion,
        toVersion,
        description
      })),
      extensionKeys: Object.keys(extensionRegistry).sort()
    }),
    /**
     * `save.integrity { saveFile }` → `{ integrity }` — core's
     * `computeSaveFileIntegrity`: SHA-256 hex of the canonical JSON.
     */
    "save.integrity": (args) => ({
      integrity: computeSaveFileIntegrity(needObject("save.integrity", args.saveFile, "saveFile"))
    }),
    /**
     * `save.encode { saveFile, insimulVersion, exportedAt? }` → `{ envelope }` —
     * core's `buildSaveFileEnvelope`. `exportedAt` defaults to now (core's rule);
     * pass it for a reproducible file.
     */
    "save.encode": (args) => {
      const m = "save.encode";
      const saveFile = needObject(m, args.saveFile, "saveFile");
      const insimulVersion = needString(m, args.insimulVersion, "insimulVersion");
      const options = { insimulVersion };
      if (args.exportedAt !== void 0 && args.exportedAt !== null) {
        options.exportedAt = needString(m, args.exportedAt, "exportedAt");
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
    "save.decode": (args) => {
      let candidate2 = args.envelope;
      if (candidate2 === void 0 && typeof args.text === "string") {
        try {
          candidate2 = JSON.parse(args.text);
        } catch {
          return { ok: false, error: { code: "invalid_format", message: "Envelope is not valid JSON" } };
        }
      }
      const res = validateSaveFileEnvelope(candidate2);
      if (!res.ok) return { ok: false, error: res.error };
      const { format, exportedAt, insimulVersion, integrity } = res.envelope;
      return {
        ok: true,
        envelope: { format, exportedAt, insimulVersion, integrity },
        ...migrateWithOutcome(res.envelope.saveFile)
      };
    },
    /**
     * `save.migrate { saveFile }` → `{ saveFile, outcome, significant }` — core's
     * `migrateSaveFileWithOutcome` unchanged (see migrateWithOutcome above) and
     * `significant` from core's `isMigrationOutcomeSignificant`.
     */
    "save.migrate": (args) => migrateWithOutcome(needObject("save.migrate", args.saveFile, "saveFile")),
    // ── in-game UI (P2, P3, P6, P8) ─────────────────────────────────────────────
    /** `ui.notifications.create {}` → `{ session, view }` — core's `Notifications` toast queue. */
    "ui.notifications.create": () => {
      const model = new Notifications();
      return { session: openSession("ui.notifications", { model }), view: notificationsView(model) };
    },
    /**
     * `ui.notifications.apply { session, ops }` → `{ results, view }`.
     * ops: `push { text, kind?, lifetime? }` → id · `tick { delta }` (seconds) →
     * changed · `dismiss { id }` → dismissed · `clear` → null.
     * view: `{ visible: [{ id, text, kind, remaining, color }], count }`.
     */
    "ui.notifications.apply": async (args) => {
      const m = "ui.notifications.apply";
      const s = session(m, args, "ui.notifications");
      const results = await applyOps(m, s, args, {
        push: ({ model }, op) => {
          const kind = op.kind === void 0 ? "info" : oneOf(m, op.kind, Object.keys(KIND_COLOR), "kind");
          const lifetime = optNumber(m, op.lifetime, "lifetime");
          return lifetime === void 0 ? model.push(needString(m, op.text, "text"), kind) : model.push(needString(m, op.text, "text"), kind, lifetime);
        },
        tick: ({ model }, op) => model.tick(needNumber(m, op.delta, "delta")),
        dismiss: ({ model }, op) => model.dismiss(needNumber(m, op.id, "id")),
        clear: ({ model }) => model.clear()
      });
      return { results, view: notificationsView(s.model) };
    },
    /**
     * `ui.pause.create { enabledModules? | genre?, tabs? }` → `{ session, source,
     * enabledModules, view }` — core's `PauseMenuModel`. With `genre` the enabled
     * modules are that genre's feature-module bundle as core resolves it
     * (`resolveGenre(genre).bundle.featureModules`; an unknown genre enables none).
     */
    "ui.pause.create": (args) => {
      const m = "ui.pause.create";
      let enabled = [];
      let source = "none";
      if (args.enabledModules !== void 0 && args.enabledModules !== null) {
        enabled = needArray(m, args.enabledModules, "enabledModules").map(String);
        source = "modules";
      } else if (args.genre !== void 0 && args.genre !== null) {
        enabled = [...resolveGenre(args.genre).bundle.featureModules];
        source = "genre";
      }
      const tabs = args.tabs === void 0 || args.tabs === null ? void 0 : needArray(m, args.tabs, "tabs");
      const model = tabs === void 0 ? new PauseMenuModel(enabled) : new PauseMenuModel(enabled, tabs);
      return { session: openSession("ui.pause", { model }), source, enabledModules: enabled, view: pauseView(model) };
    },
    /**
     * `ui.pause.apply { session, ops }` → `{ results, view }`.
     * ops: `open { tab? }` · `close` · `toggle` · `setActive { key }` → accepted.
     * view: `{ open, active, visibleKeys, visibleTabs }`.
     */
    "ui.pause.apply": async (args) => {
      const m = "ui.pause.apply";
      const s = session(m, args, "ui.pause");
      const results = await applyOps(m, s, args, {
        open: ({ model }, op) => model.openMenu(op.tab === void 0 ? void 0 : needString(m, op.tab, "tab")),
        close: ({ model }) => model.closeMenu(),
        toggle: ({ model }) => model.toggle(),
        setActive: ({ model }, op) => model.setActive(needString(m, op.key, "key"))
      });
      return { results, view: pauseView(s.model) };
    },
    /**
     * `ui.journal.create { quests?, maxTracked? }` → `{ session, view }` — core's
     * `QuestJournalModel`: the journal, the tracker HUD and the offer dialog.
     */
    "ui.journal.create": (args) => {
      const m = "ui.journal.create";
      const max = optNumber(m, args.maxTracked, "maxTracked");
      const model = max === void 0 ? new QuestJournalModel() : new QuestJournalModel(max);
      if (args.quests !== void 0 && args.quests !== null) {
        model.setQuests(needArray(m, args.quests, "quests").map((q) => questEntry(m, q)));
      }
      return { session: openSession("ui.journal", { model }), view: journalView(model) };
    },
    /**
     * `ui.journal.apply { session, ops }` → `{ results, view }`.
     * ops: `setQuests { quests }` · `upsert { quest }` · `accept { id }` ·
     * `decline { id }` · `complete { id }` · `track { id }` · `untrack { id }` ·
     * `setFilter { filter }` · `get { id }` → entry | null.
     * view: `{ filter, filtered, counts, tracked, maxTracked }`.
     */
    "ui.journal.apply": async (args) => {
      const m = "ui.journal.apply";
      const s = session(m, args, "ui.journal");
      const id = (op) => needString(m, op.id, "id");
      const results = await applyOps(m, s, args, {
        setQuests: ({ model }, op) => model.setQuests(needArray(m, op.quests, "quests").map((q) => questEntry(m, q))),
        upsert: ({ model }, op) => model.upsert(questEntry(m, op.quest)),
        accept: ({ model }, op) => model.accept(id(op)),
        decline: ({ model }, op) => model.decline(id(op)),
        complete: ({ model }, op) => model.complete(id(op)),
        track: ({ model }, op) => model.track(id(op)),
        untrack: ({ model }, op) => model.untrack(id(op)),
        setFilter: ({ model }, op) => model.setFilter(oneOf(m, op.filter, QUEST_FILTERS, "filter")),
        get: ({ model }, op) => model.get(id(op)) ?? null
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
    "ui.saveSlots": (args) => {
      const m = "ui.saveSlots";
      const results = needArray(m, args.slots, "slots").map((slot, i) => {
        needObject(m, slot, `slots[${i}]`);
        const index = needNumber(m, slot.index, `slots[${i}].index`);
        const summary = slot.summary === void 0 || slot.summary === null ? void 0 : slot.summary;
        if (Object.prototype.hasOwnProperty.call(slot, "envelope")) {
          return SaveSlotModel.classifyEnvelope(index, slot.envelope, () => summary);
        }
        const outcome = oneOf(m, slot.outcome, Object.keys(SLOT_MESSAGES), `slots[${i}].outcome`);
        return summary === void 0 ? { index, outcome } : { index, outcome, summary };
      });
      const model = new SaveSlotModel(results);
      return { slots: plain(model.slots()), hasAnyLoadable: model.hasAnyLoadable() };
    },
    /** `ui.loading.create { phases?, tips? }` → `{ session, view }` — core's `LoadingScreenModel`. */
    "ui.loading.create": (args) => {
      const m = "ui.loading.create";
      const phases = args.phases === void 0 || args.phases === null ? void 0 : needArray(m, args.phases, "phases");
      const tips = args.tips === void 0 || args.tips === null ? void 0 : needArray(m, args.tips, "tips");
      const model = phases === void 0 && tips === void 0 ? new LoadingScreenModel() : new LoadingScreenModel(phases ?? [], tips ?? []);
      return { session: openSession("ui.loading", { model }), view: loadingView(model) };
    },
    /**
     * `ui.loading.apply { session, ops }` → `{ results, view }`.
     * ops: `advance { key }` · `reset`.
     * view: `{ phase, progress, label, tip, complete }`.
     */
    "ui.loading.apply": async (args) => {
      const m = "ui.loading.apply";
      const s = session(m, args, "ui.loading");
      const results = await applyOps(m, s, args, {
        advance: ({ model }, op) => model.advance(needString(m, op.key, "key")),
        reset: ({ model }) => model.reset()
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
    "ui.trade": async (args) => {
      const m = "ui.trade";
      const state = plain(needObject(m, args.state, "state"));
      needObject(m, state.player, "state.player");
      needArray(m, state.player.inventory, "state.player.inventory");
      needNumber(m, state.player.gold, "state.player.gold");
      needObject(m, state.containers && state.containers.containers, "state.containers.containers");
      needObject(m, state.npcs && state.npcs.merchantStates, "state.npcs.merchantStates");
      const model = new TradeModel(state);
      const qty = (op) => op.qty === void 0 || op.qty === null ? 0 : needNumber(m, op.qty, "qty");
      const results = await applyOps(m, { model }, args, {
        takeFromContainer: (s, op) => model.takeFromContainer(needString(m, op.containerId, "containerId"), needString(m, op.itemId, "itemId"), qty(op)),
        takeAllFromContainer: (s, op) => model.takeAllFromContainer(needString(m, op.containerId, "containerId")),
        buy: (s, op) => model.buy(needString(m, op.merchantId, "merchantId"), needString(m, op.itemId, "itemId"), needNumber(m, op.qty, "qty")),
        sell: (s, op) => model.sell(needString(m, op.merchantId, "merchantId"), needString(m, op.itemId, "itemId"), needNumber(m, op.qty, "qty"))
      });
      return { results, state };
    },
    // ── quests (P3) ─────────────────────────────────────────────────────────────
    /**
     * `quest.completion.create { quests? }` → `{ session, view }` — core's
     * `QuestCompletionEngine`, the objective-progress decision layer.
     */
    "quest.completion.create": (args) => {
      const m = "quest.completion.create";
      const events = [];
      const engine = new QuestCompletionEngine();
      engine.setOnObjectiveCompleted((questId, objectiveId) => events.push({ type: "objectiveCompleted", questId, objectiveId }));
      engine.setOnObjectiveProgress(
        (questId, objectiveId, current, required2, objectiveType) => events.push({ type: "objectiveProgress", questId, objectiveId, current, required: required2, objectiveType })
      );
      engine.setOnQuestCompleted((questId) => events.push({ type: "questCompleted", questId }));
      engine.setOnPronunciationFeedback(
        (questId, objectiveId, feedback) => events.push({ type: "pronunciationFeedback", questId, objectiveId, feedback })
      );
      for (const quest of args.quests === void 0 || args.quests === null ? [] : needArray(m, args.quests, "quests")) {
        engine.addQuest(plain(needObject(m, quest, "quest")));
      }
      return { session: openSession("quest.completion", { engine, events }), view: completionView(engine) };
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
    "quest.completion.apply": async (args) => {
      const m = "quest.completion.apply";
      const s = session(m, args, "quest.completion");
      s.events.length = 0;
      const questId = (op) => needString(m, op.questId, "questId");
      const results = await applyOps(m, s, args, {
        addQuest: ({ engine }, op) => engine.addQuest(plain(needObject(m, op.quest, "quest"))),
        removeQuest: ({ engine }, op) => engine.removeQuest(questId(op)),
        clear: ({ engine }) => engine.clear(),
        trackEvent: ({ engine }, op) => {
          needString(m, needObject(m, op.event, "event").type, "event.type");
          return engine.trackEvent(op.event);
        },
        handleGameEvent: ({ engine }, op) => {
          needString(m, needObject(m, op.event, "event").type, "event.type");
          return engine.handleGameEvent(op.event);
        },
        completeObjective: ({ engine }, op) => engine.completeObjective(questId(op), needString(m, op.objectiveId, "objectiveId")),
        trackByTrigger: ({ engine }, op) => engine.trackByTrigger(needString(m, op.trigger, "trigger"), op.questId === void 0 ? void 0 : questId(op)),
        revealHint: ({ engine }, op) => engine.revealHint(questId(op), needString(m, op.objectiveId, "objectiveId")),
        checkTimedObjectives: ({ engine }) => engine.checkTimedObjectives(),
        restoreObjectiveStates: ({ engine }, op) => engine.restoreObjectiveStates(needObject(m, op.states, "states"))
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
    "quest.markers": (args) => {
      const m = "quest.markers";
      const quests = needArray(m, args.quests, "quests");
      const surface = args.surface === void 0 ? "world" : oneOf(m, args.surface, ["world", "minimap"], "surface");
      const ready = args.readyToTurnIn === void 0 || args.readyToTurnIn === null ? null : new Set(needArray(m, args.readyToTurnIn, "readyToTurnIn").map(String));
      const context = {
        quests,
        activeObjectiveNpcId: args.activeObjectiveNpcId ?? null,
        questCompletionChecker: ready === null ? null : (id) => ready.has(id)
      };
      const style = (kind) => kind === null ? null : MARKER_STYLES[kind];
      const npcs = (args.npcs === void 0 || args.npcs === null ? [] : needArray(m, args.npcs, "npcs")).map((npc) => {
        needString(m, needObject(m, npc, "npc").id, "npc.id");
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
            objectiveId: objective && objective.id !== void 0 ? objective.id : null,
            kind,
            style: style(kind)
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
    "quest.minimapMarkers": (args) => {
      const m = "quest.minimapMarkers";
      return {
        markers: extractObjectiveMarkers(
          needArray(m, args.quests, "quests"),
          mapOf(m, args.resolvedPositions, "resolvedPositions"),
          mapOf(m, args.namedLocations, "namedLocations"),
          args.activeObjectiveNpcId ?? null
        )
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
    "quest.waypoints": (args) => {
      const m = "quest.waypoints";
      const quest = needObject(m, args.quest, "quest");
      const player = needObject(m, args.player, "player");
      const buildings = /* @__PURE__ */ new Map();
      for (const b of args.buildings === void 0 || args.buildings === null ? [] : needArray(m, args.buildings, "buildings")) {
        needObject(m, b, "building");
        buildings.set(needString(m, b.id, "building.id"), { position: b.position, metadata: b.metadata ?? null });
      }
      const director = new DynamicQuestWaypointDirector();
      const npcPositions = args.npcPositions === void 0 || args.npcPositions === null ? [] : needArray(m, args.npcPositions, "npcPositions");
      const waypoints = director.resolveWaypoints(quest, buildings, mapOf(m, args.npcBuildingMap, "npcBuildingMap"), npcPositions, player);
      const forward = args.forwardAngle === void 0 || args.forwardAngle === null ? 0 : needNumber(m, args.forwardAngle, "forwardAngle");
      return {
        waypoints: waypoints.map((wp) => ({ ...wp, alpha: director.getDistanceAlpha(player, wp.position) })),
        compass: director.getCompassData(waypoints, player, forward)
      };
    },
    // ── world: clock and weather (P4) ───────────────────────────────────────────
    /**
     * `clock.create { msPerGameHour?, startHour?, startMinute?, startDay?, state? }`
     * → `{ session, view }` — core's `GameTimeManager`. `state` (a saved
     * `GameTimeState`) is restored after construction.
     */
    "clock.create": (args) => {
      const m = "clock.create";
      const options = {};
      for (const key of ["msPerGameHour", "startHour", "startMinute", "startDay"]) {
        const v = optNumber(m, args[key], key);
        if (v !== void 0) options[key] = v;
      }
      const events = [];
      const clock = new GameTimeManager(options);
      clock.setEventBus({ emit: (event) => events.push(event) });
      if (args.state !== void 0 && args.state !== null) clock.restoreState(needObject(m, args.state, "state"));
      return { session: openSession("clock", { clock, events }), view: clockView(clock) };
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
    "clock.apply": async (args) => {
      const m = "clock.apply";
      const s = session(m, args, "clock");
      s.events.length = 0;
      const results = await applyOps(m, s, args, {
        update: ({ clock }, op) => {
          const ms = needNumber(m, op.deltaMs, "deltaMs");
          if (ms < 0) throw refuse(m, "`deltaMs` must not be negative");
          return clock.update(ms);
        },
        advanceHours: ({ clock }, op) => clock.advanceHours(needNumber(m, op.hours, "hours")),
        setTime: ({ clock }, op) => clock.setTime(needNumber(m, op.hour, "hour"), optNumber(m, op.minute, "minute") ?? 0, optNumber(m, op.day, "day")),
        pause: ({ clock }) => clock.pause(),
        resume: ({ clock }) => clock.resume(),
        setTimeScale: ({ clock }, op) => clock.setTimeScale(needNumber(m, op.scale, "scale")),
        setMsPerGameHour: ({ clock }, op) => clock.setMsPerGameHour(needNumber(m, op.ms, "ms")),
        restoreState: ({ clock }, op) => clock.restoreState(needObject(m, op.state, "state"))
      });
      const events = s.events.splice(0, s.events.length);
      return { results, events, view: clockView(s.clock) };
    },
    /**
     * `weather.climate { weather, tuning? }` → `{ climate, climateFacts, issues }` —
     * core's `climateFromIR` over a World IR's `weather` block, the authored facts
     * (`weatherClimateFacts`) and the authoring problems (`weatherIssues`).
     */
    "weather.climate": (args) => {
      const climate = climateOf("weather.climate", args);
      return { climate, climateFacts: weatherClimateFacts(climate), issues: weatherIssues(climate) };
    },
    /**
     * `weather.run { weather | climate, seed, from, throughDay }` → `{ steps,
     * final }` — core's seeded progression (`runWeather`) as
     * `conformance/weather/progression.json` records it: every day from `from`
     * (null = a fresh world, day -1) through `throughDay`, each with its view and
     * its fact delta. Pure; for a playthrough use a `weather.create` session.
     */
    "weather.run": (args) => {
      const m = "weather.run";
      const climate = climateOf(m, args);
      const seed = typeof args.seed === "number" ? args.seed : needString(m, args.seed, "seed");
      const from = args.from === void 0 || args.from === null ? null : needObject(m, args.from, "from");
      return weatherRunSteps(climate, seed, from, needNumber(m, args.throughDay, "throughDay"));
    },
    /**
     * `weather.create { weather, seed?, tuning?, state? }` → `{ session, …view }` —
     * core's `WeatherDirector` for one playthrough; `state` restores a saved sky
     * (silently, as core does).
     */
    "weather.create": (args) => {
      const m = "weather.create";
      const writes = [];
      const events = [];
      const config = {
        weather: args.weather === void 0 || args.weather === null ? null : needObject(m, args.weather, "weather"),
        engine: recordingKb(writes),
        eventBus: { emit: (event) => events.push(event) }
      };
      if (args.seed !== void 0 && args.seed !== null) {
        config.seed = typeof args.seed === "number" ? args.seed : needString(m, args.seed, "seed");
      }
      if (args.tuning !== void 0 && args.tuning !== null) config.tuning = needObject(m, args.tuning, "tuning");
      const director = new WeatherDirector(config);
      if (args.state !== void 0) director.restore(args.state === null ? null : needObject(m, args.state, "state"));
      return { session: openSession("weather", { director, writes, events }), ...weatherSessionView(director) };
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
    "weather.apply": async (args) => {
      const m = "weather.apply";
      const s = session(m, args, "weather");
      s.writes.length = 0;
      s.events.length = 0;
      const results = await applyOps(m, s, args, {
        advanceTo: ({ director }, op) => director.advanceTo(needNumber(m, op.day, "day")),
        impose: ({ director }, op) => director.impose(op.condition === null ? null : needString(m, op.condition, "condition")),
        restore: ({ director }, op) => director.restore(op.state === null ? null : needObject(m, op.state, "state")),
        publishClimate: ({ director }) => director.publishClimate(),
        publishState: ({ director }) => director.publishState()
      });
      const writes = s.writes.splice(0, s.writes.length);
      const events = s.events.splice(0, s.events.length);
      return { results: plain(results), writes, events, ...weatherSessionView(s.director) };
    },
    // ── genre and module activation (P9; track G's registry) ────────────────────
    /** `genre.registry` → `{ defaultGenre, ids, genres, cameraModes }` — core's 15-genre registry. */
    "genre.registry": () => ({
      defaultGenre: DEFAULT_GENRE_ID,
      ids: [...GENRE_IDS],
      genres: plain(getAllGenres()),
      cameraModes: [...CAMERA_MODES]
    }),
    /** `genre.resolve { genre }` → core's `resolveGenre` (an unknown genre is never silently rpg). */
    "genre.resolve": (args) => resolveGenre(args.genre),
    /** `genre.camera { value }` → `{ mode }` — core's `normalizeCameraMode` (null when none). */
    "genre.camera": (args) => ({ mode: normalizeCameraMode(args.value) }),
    /**
     * `genre.resolveGame { recipe?, world? }` → core's `resolveGameGenre`: which
     * settings, camera (decision X3), bundle and activation a game runs with. A
     * recipe core cannot resolve is an ERROR whose last_error carries core's code:
     * `GenreResolutionError: [<code>] …` (see "Errors" in README.md).
     */
    "genre.resolveGame": (args) => resolveGameGenre({ recipe: args.recipe ?? null, world: args.world ?? null }),
    /** `genre.recipes` → `{ ids, bindings }` — core's recipe → genre bindings. */
    "genre.recipes": () => ({ ids: [...RECIPE_IDS], bindings: plain(RECIPE_GENRE_BINDINGS) }),
    /**
     * `modules.activate { ir } | { genre } | {}` → `{ source, active,
     * predicatePacks, hostInterfaces, reason }` — core's module activation, with
     * the three answers kept apart exactly as Godot's fork answers them: a known
     * genre (its bundle), an unknown one (`known: false`, no modules), and nothing
     * declared (`source: 'undeclared'`, every pack, `active: null`).
     */
    "modules.activate": (args) => {
      if (args.ir !== void 0 && args.ir !== null) {
        const id = args.ir && args.ir.meta && args.ir.meta.genreConfig && args.ir.meta.genreConfig.id;
        if (typeof id !== "string") return undeclared("the World IR carries no meta.genreConfig.id");
        return activated("worldIr", activeModulesForWorld(args.ir));
      }
      if (typeof args.genre === "string") return activated("genre", resolveActiveModules(args.genre));
      return undeclared("no genre and no World IR was passed");
    },
    /** `modules.table` → core's `moduleActivationTable()` (= conformance/modules/genre-activation.json). */
    "modules.table": () => moduleActivationTable(),
    /**
     * `prolog.packs { areas? }` → `{ packs: [{ area, prolog, runtimePredicates }],
     * order, unknown }` — the rule-pack TEXT the activation names, in consult
     * order (`PREDICATE_PACK_AREAS`; a `:- dynamic` must precede the clauses
     * other packs add).
     */
    "prolog.packs": (args) => {
      const wanted = Array.isArray(args.areas) ? new Set(args.areas.map(String)) : null;
      return {
        packs: PREDICATE_PACKS.filter((pack) => wanted === null || wanted.has(pack.area)).map((pack) => ({
          area: pack.area,
          prolog: pack.prolog,
          runtimePredicates: [...pack.runtimePredicates]
        })),
        order: [...PREDICATE_PACK_AREAS],
        unknown: wanted === null ? [] : [...wanted].filter((a) => !PREDICATE_PACK_AREAS.includes(a))
      };
    },
    // ── village layout (U23, U36) ──
    // One row per op core's layout corpus may name (`LAYOUT_OPS`, then
    // `COMPOSITION_OPS`), each `layout.<op>`. The rows are written out rather than
    // generated so the adopted surface stays reviewable here; `layout.ops`
    // returns core's two lists so the layout gate (tests/layout_corpus.cpp) can
    // fail when core gains an op this table does not have.
    /** `layout.ops` → `{ layout: LAYOUT_OPS, composition: COMPOSITION_OPS }`, core's lists as core declares them. */
    "layout.ops": () => ({ layout: [...LAYOUT_OPS], composition: [...COMPOSITION_OPS] }),
    "layout.isDoorPartName": layoutRow("isDoorPartName"),
    "layout.faceYawOf": layoutRow("faceYawOf"),
    "layout.chooseDoorPart": layoutRow("chooseDoorPart"),
    "layout.bodyStature": layoutRow("bodyStature"),
    "layout.fitBuildingToLot": layoutRow("fitBuildingToLot"),
    "layout.findFitOverlaps": layoutRow("findFitOverlaps"),
    "layout.settleSeparation": layoutRow("settleSeparation"),
    "layout.settleBodies": layoutRow("settleBodies"),
    "layout.settleFittedBuildings": layoutRow("settleFittedBuildings"),
    "layout.settleClearance": layoutRow("settleClearance"),
    "layout.clearancePairGap": layoutRow("clearancePairGap"),
    "layout.markerClearance": layoutRow("markerClearance"),
    "layout.plantWallClearance": layoutRow("plantWallClearance"),
    "layout.settleBuildingMaxShift": layoutRow("settleBuildingMaxShift"),
    "layout.pairingSeatSink": layoutRow("pairingSeatSink"),
    "layout.layoutObstaclesOf": layoutRow("layoutObstaclesOf"),
    "layout.plantTrunkOutline": layoutRow("plantTrunkOutline"),
    "layout.layoutConstants": layoutRow("layoutConstants"),
    "layout.buildGroundPlan": layoutRow("buildGroundPlan"),
    "layout.gradeTerrain": layoutRow("gradeTerrain"),
    "layout.followSettledBuildings": layoutRow("followSettledBuildings"),
    "layout.pathMouths": layoutRow("pathMouths"),
    "layout.lanternsAtPathMouths": layoutRow("lanternsAtPathMouths"),
    "layout.keepPlantPropsOffPaving": layoutRow("keepPlantPropsOffPaving"),
    "layout.trimGeneratedPoints": layoutRow("trimGeneratedPoints"),
    "layout.keepLookNeighbours": layoutRow("keepLookNeighbours"),
    "layout.keepStatedRows": layoutRow("keepStatedRows"),
    "layout.planDistances": layoutRow("planDistances"),
    "layout.margins": layoutRow("margins"),
    "layout.readGroundLayers": layoutRow("readGroundLayers"),
    "layout.resolveGroundPaint": layoutRow("resolveGroundPaint"),
    "layout.groundNoise": layoutRow("groundNoise"),
    "layout.groundCoverage": layoutRow("groundCoverage"),
    "layout.groundLayerWeights": layoutRow("groundLayerWeights"),
    "layout.clump": layoutRow("clump"),
    "layout.lookHash01": layoutRow("lookHash01"),
    "layout.lookNeighbours": layoutRow("lookNeighbours"),
    "layout.lookPropStands": layoutRow("lookPropStands"),
    "layout.backdropRing": layoutRow("backdropRing"),
    "layout.backdropFrame": layoutRow("backdropFrame"),
    // ── village composition (B9) ──
    "layout.composeLaneNetwork": compositionRow("composeLaneNetwork"),
    "layout.transitionCoverage": compositionRow("transitionCoverage"),
    "layout.edgeBreakup": compositionRow("edgeBreakup"),
    "layout.groundTransitionCoverage": compositionRow("groundTransitionCoverage"),
    "layout.transitionBounds": compositionRow("transitionBounds"),
    "layout.auditGroundEdges": compositionRow("auditGroundEdges"),
    "layout.coverageAudit": compositionRow("coverageAudit"),
    "layout.propPurpose": compositionRow("propPurpose"),
    "layout.groupProps": compositionRow("groupProps"),
    "layout.auditPropGroups": compositionRow("auditPropGroups"),
    "layout.trimFloraOffSquare": compositionRow("trimFloraOffSquare"),
    "layout.yardRole": compositionRow("yardRole"),
    "layout.composeYards": compositionRow("composeYards"),
    "layout.lanternsOnRoutes": compositionRow("lanternsOnRoutes"),
    "layout.foliageKind": compositionRow("foliageKind"),
    "layout.composeFoliage": compositionRow("composeFoliage"),
    "layout.auditFoliageSpacing": compositionRow("auditFoliageSpacing"),
    "layout.assignHouseModels": compositionRow("assignHouseModels"),
    "layout.seatCapacity": compositionRow("seatCapacity"),
    "layout.seatVillagers": compositionRow("seatVillagers"),
    "layout.keepClearOfProps": compositionRow("keepClearOfProps"),
    "layout.composeVillage": compositionRow("composeVillage")
  };
  function notificationsView(model) {
    return { visible: plain(model.visible()), count: model.count() };
  }
  function pauseView(model) {
    return {
      open: model.isOpen(),
      active: model.activeTab(),
      visibleKeys: model.visibleKeys(),
      visibleTabs: plain(model.visibleTabs())
    };
  }
  function loadingView(model) {
    return {
      phase: model.currentPhase(),
      progress: model.progress(),
      label: model.label(),
      tip: model.tip(),
      complete: model.isComplete()
    };
  }
  function asRejection(err) {
    if (err && typeof err === "object" && typeof err.code === "string") {
      const wrapped = new Error(`[${err.code}] ${err.message}`);
      wrapped.name = err.name || "Error";
      return wrapped;
    }
    return err;
  }
  globalThis.__insimul_core_dispatch = function(method, argsJson) {
    if (method !== "core.diagnostics") clearDiagnostics();
    const fn = Object.prototype.hasOwnProperty.call(METHODS, method) ? METHODS[method] : null;
    if (!fn) {
      return Promise.reject(new Error(`insimulcore: unknown method "${method}"`));
    }
    return Promise.resolve().then(() => {
      const args = argsJson ? JSON.parse(argsJson) : {};
      if (args === null || typeof args !== "object" || Array.isArray(args)) {
        throw new Error(`insimulcore: ${method}: the arguments must be a JSON object`);
      }
      return fn(args);
    }).catch((err) => {
      throw asRejection(err);
    });
  };
})();
