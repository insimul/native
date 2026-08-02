/*
 * wasm_package_smoke.mjs — US-3 verification of the PACKAGED wasm distribution.
 *
 * tests/wasm_smoke.mjs proves the built engine works; this proves the thing
 * `scripts/package.sh --target wasm` hands to a JS consumer works — which is a
 * different claim. It loads `dist/wasm/` exactly the way a bundler would (the
 * package entry named by `package.json`'s `exports["."]`, nothing else), so a
 * missing file, a broken exports map, a stale binary or a version stamp that
 * disagrees with `insimul_version()` fails here rather than in a downstream
 * consumer's build.
 *
 *   node tests/wasm_package_smoke.mjs <dist/wasm>
 *
 * scripts/package.sh runs it as its last step, so the package cannot ship
 * unverified. It also prints the artifact size table (raw / gzip / brotli) that
 * docs/consuming.md records — a multi-megabyte engine in a browser bundle is a
 * real cost and the number should be visible.
 */

import { readFileSync, existsSync, statSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { gzipSync, brotliCompressSync, constants as zlibConstants } from 'node:zlib';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, '..');

const distArg = process.argv[2];
if (!distArg) {
  console.error('wasm_package_smoke: usage: node tests/wasm_package_smoke.mjs <dist/wasm>');
  process.exit(2);
}
const dist = resolve(distArg);
if (!existsSync(dist) || !statSync(dist).isDirectory()) {
  console.error(`wasm_package_smoke: not a directory: ${dist}`);
  process.exit(2);
}

let checks = 0;
let failures = 0;

function check(label, actual, expected) {
  checks++;
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a === e) {
    console.log(`wasm_package_smoke: ok    ${label}`);
  } else {
    failures++;
    console.error(`wasm_package_smoke: FAIL  ${label}\n  want ${e}\n  got  ${a}`);
  }
}

function checkThat(label, ok, detail = '') {
  checks++;
  if (ok) {
    console.log(`wasm_package_smoke: ok    ${label}`);
  } else {
    failures++;
    console.error(`wasm_package_smoke: FAIL  ${label}${detail ? `\n  ${detail}` : ''}`);
  }
}

/* ------------------------------------------------------- 1. the file set */
// Everything a consumer needs and nothing that only makes sense in this repo.
const REQUIRED = ['package.json', 'index.mjs', 'insimul-api.mjs', 'insimul.mjs',
                  'insimul.wasm', 'VERSION', 'LICENSE'];
for (const name of REQUIRED) {
  const p = join(dist, name);
  checkThat(`${name} is present and non-empty`,
    existsSync(p) && statSync(p).size > 0, p);
}

/* ------------------------------------------------- 2. package.json shape */
const pkg = JSON.parse(readFileSync(join(dist, 'package.json'), 'utf8'));

check('package.json is an ES module ("type": "module")', pkg.type, 'module');
checkThat('package.json names the package', typeof pkg.name === 'string' && pkg.name.length > 0);
checkThat('package.json has a semver version', /^\d+\.\d+\.\d+/.test(pkg.version ?? ''), pkg.version);

// The direction stays one-way: this repo never depends on a JS consumer of it.
// A package with dependencies at all would be the first step down that road.
for (const field of ['dependencies', 'peerDependencies', 'optionalDependencies']) {
  const deps = Object.keys(pkg[field] ?? {});
  check(`package.json declares no ${field} (the dependency direction stays one-way)`,
    deps, []);
}

// Every path the exports map and the `files` allowlist name must actually exist,
// or `npm pack` ships a package that fails to resolve at import time.
const exportTargets = Object.values(pkg.exports ?? {})
  .flatMap((v) => (typeof v === 'string' ? [v] : Object.values(v)));
checkThat('package.json declares an exports map', exportTargets.length > 0);
for (const target of exportTargets) {
  checkThat(`exports target ${target} exists`, existsSync(join(dist, target)));
}
for (const name of pkg.files ?? []) {
  checkThat(`files entry ${name} exists`, existsSync(join(dist, name)));
}
check('exports["."] is the package entry point', pkg.exports?.['.'], './index.mjs');
// A bundler must be able to reach the binary directly (some hosts copy it into
// their own asset pipeline rather than letting the glue fetch it).
checkThat('the .wasm binary is reachable through the exports map',
  exportTargets.includes('./insimul.wasm'));

/* ------------------------------------------- 3. the VERSION stamp is honest */
// Parsed into the same five fields scripts/package.sh writes for the native
// packages, so a consumer cross-checks a wasm package exactly as it does a
// macos-arm64 one.
const stamp = Object.fromEntries(
  readFileSync(join(dist, 'VERSION'), 'utf8')
    .split('\n').filter(Boolean).map((line) => {
      const i = line.indexOf(' ');
      return [line.slice(0, i), line.slice(i + 1)];
    }));

check('VERSION stamp records the wasm platform', stamp.platform, 'wasm32-emscripten');
check('package.json version matches the VERSION stamp', pkg.version, stamp.insimul);

// The tracked VERSION file is the single source of truth for the semver
// (CLAUDE.md, "Versioning & packaging") — a package built from a stale tree
// must not slip through.
const repoSemver = readFileSync(join(REPO_ROOT, 'VERSION'), 'utf8').trim();
check('the packaged semver is the repo VERSION file', stamp.insimul, repoSemver);

/* --------------------------------- 4. load it the way a bundler resolves it */
const entry = join(dist, pkg.exports['.'].replace(/^\.\//, ''));
const mod = await import(pathToFileURL(entry).href);
checkThat('the package entry has a default export that instantiates the engine',
  typeof mod.default === 'function');
checkThat('the package re-exports InsimulError for instanceof checks',
  typeof mod.InsimulError === 'function');

const insimul = await mod.default();

// insimul_version() is the ABI's own stamp. Rebuilding it from the VERSION file
// proves the shipped text describes the shipped BINARY, not a stale tree.
const expectedVersion =
  `insimul ${stamp.insimul} (git ${stamp.git}, trealla ${stamp.trealla_tag}/${stamp.trealla_commit})`;
check('insimul_version() from the packaged binary matches the VERSION file',
  insimul.version(), expectedVersion);

/* ------------------------------------- 5. it actually answers a Prolog goal */
const kb = insimul.createKb();
kb.consult(`parent(tom, bob).
parent(bob, ann).
grandparent(X, Z) :- parent(X, Y), parent(Y, Z).
`);
check('a query backtracks through a rule (the engine really is loaded)',
  [...kb.solutions('grandparent(tom, Who)')].map((s) => s.Who), ['ann']);
check('a goal that must fail does fail', [...kb.solutions('grandparent(tom, tom)')], []);
kb.assert('parent(ann, zoe)');
check('assert + snapshot round-trip through the packaged wrapper', kb.snapshot(),
  'grandparent(A,B):-parent(A,C),parent(C,B).\n' +
  'parent(tom,bob).\n' +
  'parent(bob,ann).\n' +
  'parent(ann,zoe).\n');
kb.destroy();

/* ---------------------------------------- 6. fetched, not inlined (the docs) */
// docs/consuming.md tells consumers the .wasm is a SEPARATE file the glue
// fetches (it matters for CSP and for offline packaging), so assert the shape
// rather than trusting the prose: a real wasm binary on disk, and glue that
// names it.
const wasmBytes = readFileSync(join(dist, 'insimul.wasm'));
check('insimul.wasm is a real WebAssembly binary (\\0asm magic)',
  [...wasmBytes.subarray(0, 4)], [0x00, 0x61, 0x73, 0x6d]);
const glue = readFileSync(join(dist, 'insimul.mjs'), 'utf8');
checkThat('the glue fetches insimul.wasm as a sibling file rather than inlining it',
  glue.includes('insimul.wasm') && !/data:application\/octet-stream;base64/.test(glue));

/* ------------------------------------------------------- 7. the size table */
// The AC asks for the artifact size to be visible before a browser bundle
// commits to it. gzip/brotli are what a CDN actually transfers.
const bytes = (n) => n.toLocaleString('en-US');
const row = (name) => {
  const buf = readFileSync(join(dist, name));
  const gz = gzipSync(buf, { level: 9 }).length;
  const br = brotliCompressSync(buf, {
    params: {
      [zlibConstants.BROTLI_PARAM_QUALITY]: 11,
      [zlibConstants.BROTLI_PARAM_SIZE_HINT]: buf.length,
    },
  }).length;
  return { name, raw: buf.length, gz, br };
};
const rows = ['insimul.wasm', 'insimul.mjs', 'insimul-api.mjs', 'index.mjs'].map(row);
const total = rows.reduce((acc, r) => ({
  name: 'TOTAL', raw: acc.raw + r.raw, gz: acc.gz + r.gz, br: acc.br + r.br,
}), { raw: 0, gz: 0, br: 0 });

console.log('-------------------------------------------------------------');
console.log('wasm_package_smoke: artifact sizes (bytes)');
console.log(`  ${'file'.padEnd(16)} ${'raw'.padStart(11)} ${'gzip -9'.padStart(11)} ${'brotli -11'.padStart(11)}`);
for (const r of [...rows, total]) {
  console.log(`  ${r.name.padEnd(16)} ${bytes(r.raw).padStart(11)} ${bytes(r.gz).padStart(11)} ${bytes(r.br).padStart(11)}`);
}

/* ------------------------------------------------------------------ verdict */
console.log('-------------------------------------------------------------');
console.log(`wasm_package_smoke: ${checks} checks, ${failures} failed`);
if (failures > 0) {
  console.error('wasm_package_smoke: FAIL');
  process.exit(1);
}
if (checks < 25) {
  console.error(`wasm_package_smoke: only ${checks} checks ran — refusing to pass vacuously.`);
  process.exit(2);
}
console.log(`wasm_package_smoke: PASS — ${pkg.name}@${pkg.version} is consumable`);
