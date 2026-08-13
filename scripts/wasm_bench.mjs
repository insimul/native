/*
 * wasm_bench.mjs — the WASM leg of the D20 measurement (tasklist 250, US-3).
 *
 * The browser mirror of tests/bench.c: the same three phases, over the same
 * committed world (bench/world/) and the same goal list (bench/world/
 * QUERIES.txt), through the same hand-written wrapper a page uses
 * (wasm/insimul-api.mjs). A difference between this leg's numbers and the
 * native leg's is a cost of the wasm target, not of a second harness.
 *
 *   node scripts/wasm_bench.mjs <build-dir> [--json <file>] [--label <s>] \
 *        [--queries <file>] <world.pl>...
 *
 * WHAT THE PHASES MEAN HERE, and where they differ from native:
 *
 *   instantiate  importing the glue and running the module factory —
 *                downloading is excluded (the files are local), but compiling
 *                the .wasm, standing up the runtime and MOUNTING any preload
 *                image are included. That last part is why this phase exists as
 *                its own number: an engine whose Prolog library ships as a
 *                separate .data image pays for it HERE, before any KB exists,
 *                and a page pays it once per load.
 *   create       insimul_kb_create() across the JS boundary — cold, once.
 *   consult      the world's .pl set, in the manifest's order.
 *   query        every goal, exhausted; the total is printed so a leg that is
 *                not holding the same world is visible before any timing.
 *
 * MEMORY is the host process's resident set (`process.memoryUsage().rss`),
 * sampled at every phase boundary, and the interesting figure is the DELTA from
 * the baseline taken before the glue is even imported — node's own footprint is
 * the same for both engines, so the delta is the engine's.
 *
 * The module's linear memory is deliberately NOT the figure quoted. This build
 * links `-sINITIAL_MEMORY=67108864 -sALLOW_MEMORY_GROWTH=1` (cmake/wasm.cmake),
 * so both engines RESERVE 64 MiB up front and `HEAPU8.length` would read 64 MiB
 * for either of them until one grew past it — a number that says nothing about
 * which engine costs more. RSS counts pages actually touched, which is what a
 * tab pays. (`HEAPU8` is also not in EXPORTED_RUNTIME_METHODS, and adding it to
 * the shipped module to feed a benchmark would be the measurement changing the
 * thing it measures.)
 */

import { dirname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { readFileSync, appendFileSync } from 'node:fs';
import { loadInsimul } from '../wasm/insimul-api.mjs';

const args = process.argv.slice(2);
let jsonPath = null;
let label = 'wasm';
let queriesPath = null;
const positional = [];
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--json') jsonPath = args[++i];
  else if (args[i] === '--label') label = args[++i];
  else if (args[i] === '--queries') queriesPath = args[++i];
  else if (args[i].startsWith('--')) {
    console.error(`wasm_bench: unknown option ${args[i]}`);
    process.exit(2);
  } else positional.push(args[i]);
}
const [buildDir, ...worldFiles] = positional;
if (!buildDir || worldFiles.length === 0) {
  console.error('wasm_bench: usage: node scripts/wasm_bench.mjs <build-dir> '
    + '[--json f] [--label s] [--queries f] <world.pl>...');
  process.exit(2);
}

const gluePath = resolve(join(buildDir, 'insimul.mjs'));
// Every sibling payload resolves next to the GLUE, not the cwd — Emscripten's
// default for a data package is a bare relative name (gap G-16).
const locateFile = (path) => join(dirname(gluePath), path);

// Read every input before any clock starts: this measures the engine, not the
// file system (tests/bench.c does the same).
const sources = worldFiles.map((f) => readFileSync(f, 'utf8'));
const totalBytes = sources.reduce((n, s) => n + Buffer.byteLength(s), 0);
const goals = queriesPath
  ? readFileSync(queriesPath, 'utf8').split('\n').map((l) => l.trim())
      .filter((l) => l && !l.startsWith('#'))
  : [];

const ms = () => Number(process.hrtime.bigint()) / 1e6;
const rss = () => process.memoryUsage().rss;

const rssStart = rss();
const t0 = ms();
const createInsimul = (await import(pathToFileURL(gluePath).href)).default;
const insimul = await loadInsimul(createInsimul, { locateFile });
const instantiateMs = ms() - t0;
const rssInstantiated = rss();

const t1 = ms();
const kb = insimul.createKb();
const createMs = ms() - t1;
const rssCreated = rss();

const t2 = ms();
for (const source of sources) kb.consult(source);
const consultMs = ms() - t2;
const rssConsulted = rss();

const t3 = ms();
let solutions = 0;
for (const goal of goals) {
  // The raw ABI strings, exactly as the native leg counts them: parsing each
  // binding set into an object would measure JSON.parse, not the engine.
  const q = kb.query(goal);
  try {
    while (q.nextRaw() !== null) solutions++;
  } finally {
    q.stop();
  }
}
const queryMs = ms() - t3;
const rssQueried = rss();

console.log(
  `bench[${label}]: instantiate ${instantiateMs.toFixed(2)} ms, `
  + `create ${createMs.toFixed(2)} ms, consult ${consultMs.toFixed(2)} ms `
  + `(${totalBytes} bytes, ${worldFiles.length} files), `
  + `query ${queryMs.toFixed(2)} ms (${solutions} solutions), `
  + `rss ${rssStart} -> ${rssInstantiated} -> ${rssConsulted} -> ${rssQueried}`,
);

if (jsonPath) {
  const record = {
    leg: label,
    version: insimul.version(),
    ms: { instantiate: +instantiateMs.toFixed(3), create: +createMs.toFixed(3),
          consult: +consultMs.toFixed(3), query: +queryMs.toFixed(3) },
    rss: { start: rssStart, instantiated: rssInstantiated, created: rssCreated,
           consulted: rssConsulted, queried: rssQueried },
    world: { files: worldFiles.length, bytes: totalBytes },
    solutions,
  };
  appendFileSync(jsonPath, JSON.stringify(record) + '\n');
}

// The KB is deliberately still alive when the figures above are taken.
kb.destroy();
