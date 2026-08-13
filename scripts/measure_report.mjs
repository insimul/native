/*
 * measure_report.mjs — turn scripts/measure.sh's raw records into the published
 * comparison (tasklist 250 US-3).
 *
 *   node scripts/measure_report.mjs <raw-dir> <measurements.json> [--doc <md>]
 *
 * It reads what the harnesses wrote — one JSON-Lines record per cold process
 * per (leg, engine), one conformance record per case per (leg, engine), the
 * artifact path lists, the wasm payload tables and the host description — and
 * produces:
 *
 *   <measurements.json>   every figure, machine-readable, including each raw
 *                         sample (so a median can be re-derived, or disputed)
 *   the markdown tables, printed, and spliced into <md> between its
 *   `<!-- BEGIN GENERATED: <id> -->` / `<!-- END GENERATED: <id> -->` markers
 *
 * TWO RULES THIS FILE ENFORCES, because a comparison that cannot fail is not
 * evidence:
 *
 *  1. Every record's OWN version stamp must name the engine the file name says
 *     it holds. Measuring the wrong build tree is the easiest possible mistake
 *     and the hardest to see in a table; here it is a hard error.
 *  2. Both engines must report the SAME solution total for the same world. Two
 *     engines that disagree are not holding the same knowledge base, and no
 *     timing beneath that line would mean anything.
 *
 * Timings are published as the MEDIAN of N cold processes, with the minimum
 * beside it: the median is the honest expectation, the minimum is the figure a
 * benchmark would be tempted to quote alone.
 */

import { readFileSync, writeFileSync, existsSync, readdirSync, statSync, realpathSync } from 'node:fs';
import { join, resolve } from 'node:path';

const [rawDir, outPath, ...rest] = process.argv.slice(2);
if (!rawDir || !outPath) {
  console.error('measure_report: usage: node scripts/measure_report.mjs <raw-dir> <out.json> [--doc <md>]');
  process.exit(2);
}
const docPath = rest.includes('--doc') ? rest[rest.indexOf('--doc') + 1] : null;
const ENGINES = ['trealla', 'swipl'];
const LEGS = ['native', 'rust', 'wasm'];

const readJson = (p) => JSON.parse(readFileSync(p, 'utf8'));
const readJsonl = (p) =>
  readFileSync(p, 'utf8').split('\n').filter((l) => l.trim()).map((l) => JSON.parse(l));

const fail = (msg) => { console.error(`measure_report: ${msg}`); process.exit(1); };

/* The engine a record was produced by, read out of its OWN version stamp:
 * "insimul <semver> (git <sha>, engine <name>/<version>/<commit>)". */
function stampEngine(version) {
  const m = /engine ([^/\s]+)\/([^/\s]+)\/([^/\s]+)\)/.exec(version || '');
  return m ? { name: m[1], version: m[2], commit: m[3] } : null;
}

const median = (xs) => {
  const s = [...xs].sort((a, b) => a - b);
  const mid = s.length >> 1;
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
};

/* ------------------------------------------------------------- the samples */
const host = readJson(join(rawDir, 'host.json'));
const world = readJson(resolve('bench/world/MANIFEST.json'));
const runs = {};       // runs[leg][engine] = [record, ...]
const engineIds = {};  // engineIds[engine] = {name, version, commit}

for (const leg of LEGS) {
  runs[leg] = {};
  for (const engine of ENGINES) {
    const path = join(rawDir, `${leg}-${engine}.jsonl`);
    if (!existsSync(path)) fail(`no samples for the ${leg} leg of ${engine} (${path})`);
    const records = readJsonl(path);
    if (records.length === 0) fail(`${path} is empty — refusing to publish a figure with no sample`);
    for (const r of records) {
      const id = stampEngine(r.version);
      if (!id) fail(`a ${leg}/${engine} record carries no parseable version stamp: ${r.version}`);
      // Rule 1: the tree measured must be the tree the file claims.
      if (id.name !== engine) {
        fail(`the ${leg} leg of "${engine}" was measured against a build whose stamp says `
          + `"${id.name}" — the wrong build tree was measured, so nothing here is comparable.`);
      }
      engineIds[engine] = id;
    }
    // The rust leg's peak RSS is measured by the system timer, one line per run,
    // in the same order (see scripts/measure.sh for why it is not in-process).
    const rssPath = join(rawDir, `${leg}-${engine}.rss`);
    if (existsSync(rssPath)) {
      const peaks = readFileSync(rssPath, 'utf8').split('\n').filter((l) => l.trim()).map(Number);
      if (peaks.length !== records.length) {
        fail(`${rssPath} has ${peaks.length} peak-RSS samples but ${records.length} runs`);
      }
      records.forEach((r, i) => { r.rss = { ...(r.rss || {}), peak: peaks[i] }; });
    }
    runs[leg][engine] = records;
  }
}

/* Rule 2: the same world, or nothing below this line means anything. */
const solutionTotals = new Set();
for (const leg of LEGS) for (const engine of ENGINES) {
  for (const r of runs[leg][engine]) solutionTotals.add(r.solutions);
}
if (solutionTotals.size !== 1) {
  fail(`the legs report different solution totals (${[...solutionTotals].join(', ')}) for the same `
    + 'world — they are not holding the same knowledge base, so the timings are not comparable.');
}
const solutions = [...solutionTotals][0];

/* -------------------------------------------------------------- what ships */
function sizeOf(paths) {
  const seen = new Set();
  let bytes = 0;
  let files = 0;
  const walk = (p) => {
    let st;
    try { st = statSync(p); } catch { return; }
    if (st.isDirectory()) {
      for (const e of readdirSync(p)) walk(join(p, e));
      return;
    }
    if (!st.isFile()) return;                 // skip symlinks' targets being counted twice
    let real;
    try { real = realpathSync(p); } catch { real = p; }
    if (seen.has(real)) return;               // SWI's shared library lives INSIDE its
    seen.add(real);                           // home tree; naive addition double-counts
    bytes += st.size;
    files += 1;
  };
  for (const p of paths) walk(p);
  return { bytes, files };
}

const sizes = {};
for (const engine of ENGINES) {
  const listPath = join(rawDir, `paths-${engine}.txt`);
  if (!existsSync(listPath)) fail(`no artifact list for ${engine} (${listPath})`);
  const entries = readFileSync(listPath, 'utf8').split('\n').filter((l) => l.includes('='))
    .map((l) => { const i = l.indexOf('='); return [l.slice(0, i), l.slice(i + 1)]; });
  const pick = (k) => entries.filter(([kk]) => kk === k).map(([, v]) => v);
  const staticLib = sizeOf(pick('static'));
  const sharedLib = sizeOf(pick('shared'));
  const runtime = sizeOf(pick('runtime'));
  sizes[engine] = {
    staticLib, sharedLib, runtime,
    shippedShared: { bytes: sharedLib.bytes + runtime.bytes, files: sharedLib.files + runtime.files },
    runtimePaths: pick('runtime'),
  };
  const payloadPath = join(rawDir, `payload-${engine}.json`);
  if (existsSync(payloadPath)) sizes[engine].wasmPayload = readJson(payloadPath);
  // The Rust leg's own artifact: a release binary that has statically linked
  // libinsimul.a. Captured by measure.sh at build time — both engines build to
  // the same path, so it cannot be sized here.
  const rustBinPath = join(rawDir, `rustbin-${engine}.txt`);
  if (existsSync(rustBinPath)) sizes[engine].rustBinary = Number(readFileSync(rustBinPath, 'utf8').trim());
}

/* ------------------------------------------------- the conformance corpus */
/* Each record is one case: {area, name, status, solutions:[raw...]}. Comparing
 * the RAW strings is the point — two legs can both satisfy `expected` and still
 * disagree on solution order, on error wording or on how a float is printed. */
function corpus(leg, engine) {
  const p = join(rawDir, `conf-${leg}-${engine}.jsonl`);
  if (!existsSync(p)) fail(`no conformance records for ${leg}/${engine} (${p})`);
  const recs = readJsonl(p);
  if (recs.length === 0) fail(`${p} is empty — a corpus run that produced nothing is a failure`);
  return recs;
}
const key = (r) => `${r.area}/${r.name}`;

function diffCorpus(a, b) {
  if (a.length !== b.length) {
    return { comparable: false, cases: Math.max(a.length, b.length), identical: 0, divergent: [],
             note: `case counts differ (${a.length} vs ${b.length})` };
  }
  const divergent = [];
  for (let i = 0; i < a.length; i++) {
    if (key(a[i]) !== key(b[i])) {
      return { comparable: false, cases: a.length, identical: 0, divergent: [],
               note: `case order differs at #${i + 1}: ${key(a[i])} vs ${key(b[i])}` };
    }
    if (JSON.stringify(a[i]) !== JSON.stringify(b[i])) {
      divergent.push({
        case: key(a[i]),
        a: { status: a[i].status, solutions: a[i].solutions },
        b: { status: b[i].status, solutions: b[i].solutions },
      });
    }
  }
  return { comparable: true, cases: a.length, identical: a.length - divergent.length, divergent };
}

const conformance = { engineVsEngine: {}, legVsLeg: {} };
for (const leg of LEGS) {
  conformance.engineVsEngine[leg] = diffCorpus(corpus(leg, 'trealla'), corpus(leg, 'swipl'));
}
for (const engine of ENGINES) {
  const base = corpus('native', engine);
  conformance.legVsLeg[engine] = {};
  for (const leg of ['rust', 'wasm']) {
    conformance.legVsLeg[engine][leg] = diffCorpus(base, corpus(leg, engine));
  }
}

/* ----------------------------------------------------------------- tables */
const kb = (n) => `${(n / 1024).toFixed(1)} KB`;
const mb = (n) => `${(n / 1048576).toFixed(2)} MB`;
const num = (n) => n.toLocaleString('en-US');
const ms = (n) => n.toFixed(1);
const ratio = (a, b) => (b === 0 ? 'n/a' : `${(a / b).toFixed(2)}x`);

function phase(leg, engine, name) {
  const xs = runs[leg][engine].map((r) => r.ms[name]).filter((x) => typeof x === 'number');
  return xs.length ? { median: median(xs), min: Math.min(...xs), samples: xs } : null;
}
function rssStat(leg, engine, name) {
  const xs = runs[leg][engine].map((r) => r.rss?.[name]).filter((x) => typeof x === 'number');
  return xs.length ? { median: median(xs), min: Math.min(...xs), samples: xs } : null;
}

const tables = {};

/* size ------------------------------------------------------------------- */
{
  const rows = [
    '| leg | what a host ships | ' + ENGINES.join(' | ') + ' | ratio |',
    '|---|---|---:|---:|---:|',
  ];
  const row = (leg, what, get, fmt = num) => {
    const a = get('trealla'), b = get('swipl');
    rows.push(`| ${leg} | ${what} | ${fmt(a)} | ${fmt(b)} | ${ratio(b, a)} |`);
  };
  row('native', '`libinsimul.a` (static)', (e) => sizes[e].staticLib.bytes);
  row('native', '`libinsimul.dylib` (shared)', (e) => sizes[e].sharedLib.bytes);
  row('native', 'engine runtime shipped beside it', (e) => sizes[e].runtime.bytes);
  row('native', '**TOTAL shipped (shared form)**', (e) => sizes[e].shippedShared.bytes);
  row('rust', '`libinsimul.a` linked into the binary', (e) => sizes[e].staticLib.bytes);
  if (ENGINES.every((e) => sizes[e].rustBinary)) {
    row('rust', 'the linked release binary (`examples/bench`)', (e) => sizes[e].rustBinary);
  }
  row('rust', 'engine runtime the binary needs at run time', (e) => sizes[e].runtime.bytes);
  if (ENGINES.every((e) => sizes[e].rustBinary)) {
    row('rust', '**TOTAL shipped (binary + runtime)**',
        (e) => sizes[e].rustBinary + sizes[e].runtime.bytes);
  }
  if (ENGINES.every((e) => sizes[e].wasmPayload)) {
    const total = (e, field) => sizes[e].wasmPayload.total[field];
    row('wasm', 'payload, raw', (e) => total(e, 'raw'));
    row('wasm', 'payload, gzip -9', (e) => total(e, 'gzip'));
    row('wasm', '**payload, brotli -11 (over the wire)**', (e) => total(e, 'brotli'));
    row('wasm', 'payload files a page fetches', (e) => sizes[e].wasmPayload.files.length);
  }
  tables.size = rows.join('\n');
}

/* startup ----------------------------------------------------------------- */
{
  const rows = [
    `| leg | phase | ${ENGINES.map((e) => `${e} median (min)`).join(' | ')} | ratio |`,
    '|---|---|---:|---:|---:|',
  ];
  const phases = {
    native: ['create', 'consult', 'query'],
    rust: ['create', 'consult', 'query'],
    wasm: ['instantiate', 'create', 'consult', 'query'],
  };
  for (const leg of LEGS) {
    for (const name of phases[leg]) {
      const a = phase(leg, 'trealla', name), b = phase(leg, 'swipl', name);
      if (!a || !b) continue;
      rows.push(`| ${leg} | ${name} | ${ms(a.median)} (${ms(a.min)}) | `
        + `${ms(b.median)} (${ms(b.min)}) | ${ratio(b.median, a.median)} |`);
    }
    const a = phase(leg, 'trealla', 'create'), b = phase(leg, 'swipl', 'create');
    const ac = phase(leg, 'trealla', 'consult'), bc = phase(leg, 'swipl', 'consult');
    if (a && b && ac && bc) {
      rows.push(`| ${leg} | **cold start + consult** | **${ms(a.median + ac.median)}** | `
        + `**${ms(b.median + bc.median)}** | ${ratio(b.median + bc.median, a.median + ac.median)} |`);
    }
  }
  tables.startup = rows.join('\n');
}

/* memory ------------------------------------------------------------------ */
{
  const rows = [
    `| leg | resident set | ${ENGINES.join(' | ')} | ratio |`,
    '|---|---|---:|---:|---:|',
  ];
  const row = (leg, what, field) => {
    const a = rssStat(leg, 'trealla', field), b = rssStat(leg, 'swipl', field);
    if (!a || !b) return;
    rows.push(`| ${leg} | ${what} | ${mb(a.median)} | ${mb(b.median)} | ${ratio(b.median, a.median)} |`);
  };
  row('native', 'before the engine is up', 'start');
  row('native', 'engine up, empty KB', 'created');
  row('native', '**holding the world (RSS)**', 'consulted');
  row('native', 'peak (getrusage ru_maxrss)', 'peak');
  row('rust', '**peak holding the world (system timer)**', 'peak');
  row('wasm', 'node before the module is loaded', 'start');
  row('wasm', 'module instantiated, no KB', 'instantiated');
  row('wasm', '**holding the world (node RSS)**', 'consulted');
  tables.memory = rows.join('\n');
}

/* the corpus -------------------------------------------------------------- */
{
  const rows = [
    '| comparison | cases | byte-identical | divergent |',
    '|---|---:|---:|---:|',
  ];
  for (const leg of LEGS) {
    const d = conformance.engineVsEngine[leg];
    rows.push(`| ${leg}: trealla vs swipl | ${d.cases} | ${d.identical} | `
      + `${d.comparable ? d.divergent.length : d.note} |`);
  }
  for (const engine of ENGINES) {
    for (const leg of ['rust', 'wasm']) {
      const d = conformance.legVsLeg[engine][leg];
      rows.push(`| ${engine}: native vs ${leg} | ${d.cases} | ${d.identical} | `
        + `${d.comparable ? d.divergent.length : d.note} |`);
    }
  }
  tables.corpus = rows.join('\n');

  const lines = [];
  for (const leg of LEGS) {
    const d = conformance.engineVsEngine[leg];
    if (!d.comparable) { lines.push(`- **${leg}: not comparable** — ${d.note}`); continue; }
    if (d.divergent.length === 0) { lines.push(`- **${leg}: all ${d.cases} cases byte-identical.**`); continue; }
    lines.push(`- **${leg}: ${d.divergent.length} of ${d.cases} cases diverge.**`);
    for (const c of d.divergent) {
      lines.push(`  - \`${c.case}\` — trealla \`${c.a.status}\` ${JSON.stringify(c.a.solutions)}`);
      lines.push(`    <br>swipl \`${c.b.status}\` ${JSON.stringify(c.b.solutions)}`);
    }
  }
  tables.corpusDetail = lines.join('\n');
}

/* provenance -------------------------------------------------------------- */
{
  const rows = [
    '| | value |',
    '|---|---|',
    `| host | \`${host.uname}\` |`,
    `| compiler | ${host.cc} |`,
    `| cmake / node / cargo | ${host.cmake.replace('cmake version ', '')} / ${host.node} / ${host.cargo.replace('cargo ', '')} |`,
    `| emscripten | ${host.emcc} |`,
    `| samples per figure | ${host.repeat} cold processes; median (min) published |`,
    `| load average when taken | ${host.loadAverage1min ?? 'not recorded'} on ${host.cpus ?? '?'} CPUs (a busy host inflates the slower engine most) |`,
    `| world | ${world.world} — ${world.totals.files} files, ${num(world.totals.clauses)} clauses, ${num(world.totals.bytes)} bytes |`,
    `| goals | \`bench/world/QUERIES.txt\`, every goal exhausted — ${num(solutions)} solutions on every leg of both engines |`,
  ];
  for (const e of ENGINES) {
    rows.push(`| engine \`${e}\` | ${engineIds[e].version} (${engineIds[e].commit}) |`);
  }
  tables.provenance = rows.join('\n');
}

/* ------------------------------------------------------------------ output */
const out = {
  generatedBy: 'scripts/measure.sh -> scripts/measure_report.mjs',
  host,
  world: { ...world.totals, description: world.world, consultOrder: world.consultOrder },
  solutions,
  engines: engineIds,
  sizes,
  timings: Object.fromEntries(LEGS.map((leg) => [leg, Object.fromEntries(ENGINES.map((e) => [e, {
    ms: Object.fromEntries(Object.keys(runs[leg][e][0].ms).map((k) => [k, phase(leg, e, k)])),
    rss: Object.fromEntries(Object.keys(runs[leg][e][0].rss || {}).map((k) => [k, rssStat(leg, e, k)])),
    samples: runs[leg][e].length,
  }]))])),
  conformance,
};
writeFileSync(outPath, JSON.stringify(out, null, 2) + '\n');

const sections = [
  ['provenance', 'How these numbers were taken'],
  ['size', 'Size — what a host ships'],
  ['startup', 'Startup — cold engine + consult of the world (ms)'],
  ['memory', 'Memory — resident while holding the world'],
  ['corpus', 'The conformance corpus, compared byte for byte'],
  ['corpusDetail', 'Every divergent case'],
];
for (const [id, title] of sections) {
  console.log(`\n### ${title}\n\n${tables[id]}`);
}

if (docPath) {
  let doc = readFileSync(docPath, 'utf8');
  for (const [id] of sections) {
    const begin = `<!-- BEGIN GENERATED: ${id} -->`;
    const end = `<!-- END GENERATED: ${id} -->`;
    const i = doc.indexOf(begin), j = doc.indexOf(end);
    if (i < 0 || j < 0) fail(`${docPath} has no "${id}" generated block — the doc and this reporter disagree`);
    doc = doc.slice(0, i + begin.length) + '\n\n' + tables[id] + '\n\n' + doc.slice(j);
  }
  writeFileSync(docPath, doc);
  console.log(`\nmeasure_report: ${docPath} regenerated (${sections.length} blocks), `
    + `raw figures in ${outPath}`);
}
