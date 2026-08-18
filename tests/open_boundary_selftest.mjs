#!/usr/bin/env node
// open_boundary_selftest.mjs — falsify the content + dependency gate before
// trusting it about this repository (US-2, `242-pre-open-native`).
//
//   node tests/open_boundary_selftest.mjs [--rules scripts/open-boundary.rules.json]
//
// Run by the `open_boundary` ctest via tests/run_open_boundary.sh.
//
// ## Why this file exists
//
// `docs/pre-open/open-boundary.json` says no closed pack is vendored here and
// nothing from insimul-backend or insimul-web is reachable. That sentence is
// worth exactly as much as the evidence that the gate can say anything else —
// and a boundary checker is the easiest kind of gate to write wrong and never
// notice, because its output on a clean tree is identical to the output of one
// whose regexes never compiled, whose rules file failed to load, or that walked
// no files at all.
//
// So every rule in scripts/open-boundary.rules.json is fired at a synthetic
// positive here, and the fixture table is checked for COMPLETENESS against the
// rules file: adding a rule without a fixture fails this test rather than
// shipping an unexercised pattern.
//
// ## The fixtures contain no literal forbidden specifier
//
// Core exempts its equivalent test by basename, because a test that a forbidden
// import is caught has to contain a forbidden import. This one assembles every
// forbidden specifier and every pack skeleton by concatenation instead, so its
// own bytes match nothing it exercises and it needs no exemption at all. US-1
// paid for that lesson in `tests/history_scan_selftest.mjs`: an exemption is
// permanent and a `+` is not, and the structural pack detector reads the whole
// blob — comments included — so even a comment spelling out the skeleton would
// make this file a finding forever.

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  auditOpenBoundary,
  classifyCrate,
  classifyInclude,
  classifySpecifier,
  listFiles,
  matchesDenyEntry,
  parseCargoDependencies,
  parseImportSpecifiers,
  parseIncludes,
  unresolvedFindings,
} from '../scripts/check-open-boundary.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, '..');

const argv = process.argv.slice(2);
let rulesPath = path.join(repo, 'scripts/open-boundary.rules.json');
for (let i = 0; i < argv.length; i += 1) {
  if (argv[i] === '--rules') rulesPath = path.resolve(argv[(i += 1)]);
  else {
    console.error(`open_boundary_selftest: unknown argument ${JSON.stringify(argv[i])}`);
    process.exit(2);
  }
}

const rules = JSON.parse(fs.readFileSync(rulesPath, 'utf8'));

let checks = 0;
let failures = 0;
function check(label, fn) {
  checks += 1;
  try {
    fn();
    console.log(`  ok   ${label}`);
  } catch (error) {
    failures += 1;
    console.log(`  FAIL ${label}`);
    console.log(`       ${error.message.split('\n')[0]}`);
  }
}

// ─── forbidden strings, assembled ────────────────────────────────────────────

const SCOPE = '@ins' + 'imul';
const CLOSED_BACKEND = `${SCOPE}/back` + 'end';
const CLOSED_WEB = `${SCOPE}/w` + 'eb';
const BACK_EDGE = '@sha' + 'red/schema';
const PACK_KEY = 'pa' + 'ck';
const PACK_VERSION_KEY = PACK_KEY + 'Vers' + 'ion';
const PHASES_KEY = 'pha' + 'ses';

/** A pack document, built so this file's own bytes are not one. */
function packDocument(id) {
  const idField = id === null ? `"${PACK_KEY}": PACK_ID` : `"${PACK_KEY}": ${JSON.stringify(id)}`;
  return `{ ${idField}, "${PACK_VERSION_KEY}": "3", "${PHASES_KEY}": [{ "op": "grid" }] }\n`;
}

// ─── fixture trees ───────────────────────────────────────────────────────────

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'open-boundary-selftest-'));
process.on('exit', () => fs.rmSync(tmp, { recursive: true, force: true }));

let treeSerial = 0;
/** Materialise `{ 'rel/path': 'contents' }` as a throwaway tree, return its root. */
function tree(files) {
  const root = path.join(tmp, `tree-${(treeSerial += 1)}`);
  for (const [rel, contents] of Object.entries(files)) {
    const full = path.join(root, rel);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, contents);
  }
  fs.mkdirSync(root, { recursive: true });
  return root;
}

/** As `tree`, but a real git repository with everything committed. */
function gitTree(files) {
  const root = tree(files);
  const git = (...args) => spawnSync('git', ['-C', root, ...args], { encoding: 'utf8' });
  git('init', '-q');
  git('config', 'user.email', 'pre-open@insimul.invalid');
  git('config', 'user.name', 'open_boundary selftest');
  git('add', '-A');
  git('commit', '-qm', 'fixture');
  return root;
}

/** Every finding a tree produces, resolved or not. */
function audit(root, overrides = {}) {
  const result = auditOpenBoundary(root, { ...rules, ...overrides });
  return [...result.content, ...result.dependency];
}
const fired = (root, id, overrides) => audit(root, overrides).some((f) => f.rule === id);

// ─── 1. content rules: one positive and one near miss each ──────────────────

const CONTENT_FIXTURES = {
  'closed-pack-tree': {
    positive: { 'data/insimul/genres/colonial.json': '{}\n' },
    clean: { 'data/insimulate/notes.json': '{}\n' },
  },
  'world-content-tree': {
    positive: { 'packs/harbour/rules.txt': 'x\n' },
    clean: { 'package-notes/readme.txt': 'x\n' },
  },
  'prolog-seed-file': {
    positive: { 'data/genre/colonial.pl': ':- dynamic(x/1).\n' },
    clean: { 'docs/prolog.md': 'about .pl files\n' },
  },
  'closed-pack-archive': {
    positive: { 'assets/harbour.pack': 'binary\n' },
    clean: { 'assets/harbour.packed.md': 'not an archive\n' },
  },
  'binary-artifact': {
    positive: { 'lib/libinsimul.a': 'not really\n' },
    clean: { 'lib/libinsimul.ar': 'x\n' },
  },
  'build-output-tree': {
    // Only reachable through the git walk: the filesystem fallback skips
    // build/ and friends by name, and an UNTRACKED build tree is not published,
    // so the git listing is the only place this rule can be true.
    positive: { 'build-wasm/insimul.mjs': 'export default 1;\n' },
    clean: { 'buildscripts/notes.md': 'x\n' },
    git: true,
  },
};

for (const [id, fixture] of Object.entries(CONTENT_FIXTURES)) {
  const make = fixture.git ? gitTree : tree;
  check(`content rule ${id} fires on its positive`, () => {
    assert.ok(fired(make(fixture.positive), id), 'the rule did not fire');
  });
  check(`content rule ${id} leaves its near miss alone`, () => {
    assert.ok(!fired(make(fixture.clean), id), 'the rule fired on an innocent path');
  });
}

check('every contentRule in the rules file has a fixture', () => {
  const covered = new Set(Object.keys(CONTENT_FIXTURES));
  const missing = rules.contentRules.map((rule) => rule.id).filter((id) => !covered.has(id));
  assert.deepEqual(missing, [], `contentRules with no synthetic positive: ${missing.join(', ')}`);
});

// ─── 2. the structural pack detector ────────────────────────────────────────

check('a pack document with a product id is a finding', () => {
  const root = tree({ 'conformance/harbour.json': packDocument('insimul.streets.colonial') });
  assert.ok(fired(root, 'closed-pack-document'), 'a closed pack document passed');
});

check('a pack document whose id was replaced by an identifier is still a finding', () => {
  const root = tree({ 'src/fixture.ts': `export const p = ${packDocument(null)};\n` });
  const finding = audit(root).find((f) => f.rule === 'closed-pack-document');
  assert.ok(finding, 'a pack with no literal id passed');
  assert.equal(finding.packId, '<no literal id>');
});

check('a probe-prefixed pack document is not a finding', () => {
  const root = tree({ 'tests/probe.json': packDocument('probe/street-network') });
  assert.ok(!fired(root, 'closed-pack-document'), 'an allowed probe was reported');
});

// ─── 3. the JavaScript import graph ─────────────────────────────────────────

const jsContext = {
  root: '/repo',
  file: 'src/x.mjs',
  declared: new Set(),
  closedRepoPackages: rules.closedRepoPackages,
  runtimeBackEdges: rules.runtimeBackEdges,
};

check('a static import of a closed repo is a finding', () => {
  const root = tree({ 'src/a.mjs': `import { gen } from '${CLOSED_BACKEND}/pipelines';\n` });
  assert.ok(fired(root, 'closed-repo-import'), 'a closed-repo import passed');
});

check('a require() of a closed repo is a finding', () => {
  const root = tree({ 'src/a.cjs': `const w = require("${CLOSED_WEB}/editor");\n` });
  assert.ok(fired(root, 'closed-repo-import'), 'a require() of a closed repo passed');
});

check('a dynamic import() of a closed repo is a finding', () => {
  const root = tree({ 'src/a.mjs': `const m = await import('${CLOSED_BACKEND}');\n` });
  assert.ok(fired(root, 'closed-repo-import'), 'a dynamic import of a closed repo passed');
});

check('a bare-scope deny entry covers every package in the scope', () => {
  assert.ok(matchesDenyEntry('@shared', '@shared/schema'), '@shared did not cover @shared/schema');
  assert.ok(!matchesDenyEntry('@shared', '@sharedish/x'), '@shared covered an unrelated scope');
  const root = tree({ 'src/a.mjs': `import { S } from '${BACK_EDGE}';\n` });
  const finding = audit(root).find((f) => f.specifier === BACK_EDGE);
  assert.equal(finding?.rule, 'runtime-back-edge', 'the alias was reported with the generic rule');
});

check('an undeclared npm package is a finding — the rule that closes the graph', () => {
  const root = tree({ 'src/a.mjs': "import x from 'left-pad';\n" });
  assert.ok(fired(root, 'undeclared-dependency'), 'an undeclared package passed');
});

check('Node builtins are not findings, with or without the node: prefix', () => {
  const root = tree({ 'src/a.mjs': "import fs from 'node:fs';\nimport path from 'path';\n" });
  assert.deepEqual(audit(root), [], 'a builtin was reported');
});

check('a relative import that escapes the root is a finding', () => {
  assert.equal(
    classifySpecifier('../../platform/schema.js', jsContext)?.rule,
    'escaping-relative-import',
  );
  assert.equal(classifySpecifier('./sibling.js', jsContext), null, 'an in-tree sibling was reported');
});

check('a filesystem-root import is a finding', () => {
  assert.equal(classifySpecifier('/game-engine/logic/save.js', jsContext)?.rule, 'absolute-path-import');
});

check('a comment quoting an import is not an import', () => {
  const text = [
    `// import { gen } from '${CLOSED_BACKEND}';`,
    ` * const x = require("${CLOSED_WEB}");`,
    `/* await import('${CLOSED_BACKEND}') */`,
  ].join('\n');
  assert.deepEqual(parseImportSpecifiers(text), [], 'prose was read as an import');
});

check('a multi-line import clause is still read', () => {
  const specs = parseImportSpecifiers(`import {\n  a,\n} from '${CLOSED_BACKEND}';\n`);
  assert.deepEqual(specs.map((s) => s.specifier), [CLOSED_BACKEND]);
});

// ─── 4. the Rust dependency graph ───────────────────────────────────────────

const cargoContext = {
  root: '/repo',
  file: 'rust/insimul/Cargo.toml',
  allowedCrates: rules.allowedCrates,
  closedRepoPackages: rules.closedRepoPackages,
  runtimeBackEdges: rules.runtimeBackEdges,
};

check('Cargo.toml dependency tables are read, and non-dependency tables are not', () => {
  const manifest = [
    '[package]',
    'name = "insimul"',
    'version = "0.1.0"',
    '',
    '[dependencies]',
    'serde = "1"',
    'insimul-sys = { path = "../insimul-sys" }',
    '',
    '[dev-dependencies]',
    'tempfile = "3"',
    '',
    "[target.'cfg(unix)'.dependencies]",
    'libc = "0.2"',
    '',
    '[dependencies.tokio]',
    'version = "1"',
    'features = ["full"]',
    '',
  ].join('\n');
  const deps = parseCargoDependencies(manifest).map((d) => d.name);
  assert.deepEqual(deps, ['serde', 'insimul-sys', 'tempfile', 'libc', 'tokio']);
  assert.ok(!deps.includes('name'), 'a [package] key was read as a dependency');
  assert.ok(!deps.includes('version'), 'a [package] key was read as a dependency');
});

check('a registry crate nobody classified is a finding', () => {
  assert.equal(classifyCrate({ name: 'reqwest', spec: '"0.12"' }, cargoContext)?.rule, 'undeclared-crate');
});

check('a classified crate passes', () => {
  assert.equal(classifyCrate({ name: 'serde', spec: '"1"' }, cargoContext), null);
});

check('a git dependency is a finding even when its name is innocent', () => {
  const dep = { name: 'helper', spec: '{ git = "https://example.invalid/helper" }' };
  assert.equal(classifyCrate(dep, cargoContext)?.rule, 'git-dependency');
});

check('a path dependency that escapes the repository is a finding', () => {
  const escaping = { name: 'platform', spec: '{ path = "../../../platform/rust" }' };
  assert.equal(classifyCrate(escaping, cargoContext)?.rule, 'escaping-path-dependency');
  const sibling = { name: 'insimul-sys', spec: '{ path = "../insimul-sys" }' };
  assert.equal(classifyCrate(sibling, cargoContext), null, 'an in-tree path dependency was reported');
});

check('a closed repo named as a crate is a finding, with the named reason', () => {
  const dep = { name: 'insimul' + '_backend', spec: '{ path = "../../backend" }' };
  assert.equal(classifyCrate(dep, cargoContext)?.rule, 'closed-repo-import');
});

check('a real manifest in a tree is audited end to end', () => {
  const root = tree({
    'rust/app/Cargo.toml': '[package]\nname = "app"\n\n[dependencies]\nreqwest = "0.12"\n',
  });
  assert.ok(fired(root, 'undeclared-crate'), 'a manifest in a tree was not read');
});

// ─── 5. the C include graph ─────────────────────────────────────────────────

check('#include directives are parsed, quoted and angled', () => {
  const text = '#include <stdio.h>\n#include "insimul.h"\n  #  include "sub/dir.h"\n';
  assert.deepEqual(
    parseIncludes(text).map((i) => `${i.kind}:${i.header}`),
    ['angled:stdio.h', 'quoted:insimul.h', 'quoted:sub/dir.h'],
  );
});

check('an #include that walks out of the repository is a finding', () => {
  const context = { root: '/repo', file: 'src/insimul.c' };
  assert.equal(
    classifyInclude({ header: '../../platform/server.h' }, context)?.rule,
    'escaping-c-include',
  );
});

check('an #include that walks up but stays inside is NOT a finding', () => {
  const context = { root: '/repo', file: 'vendor/trealla/src/isocline/src/env.h' };
  assert.equal(classifyInclude({ header: '../include/isocline.h' }, context), null);
});

check('an absolute #include is a finding', () => {
  const context = { root: '/repo', file: 'src/insimul.c' };
  assert.equal(classifyInclude({ header: '/opt/closed/gen.h' }, context)?.rule, 'absolute-path-import');
});

check('a system include is not a finding', () => {
  const context = { root: '/repo', file: 'src/insimul.c' };
  assert.equal(classifyInclude({ header: 'stdio.h' }, context), null);
});

check('a C source in a tree is audited end to end', () => {
  const root = tree({ 'src/leak.c': '#include "../../platform/server.h"\n' });
  assert.ok(fired(root, 'escaping-c-include'), 'a C file in a tree was not read');
});

// ─── 6. the build-time fetch rule ───────────────────────────────────────────

check('build-time-fetch fires on a CMake fetch', () => {
  const root = tree({
    'cmake/deps.cmake': 'include(FetchContent)\nFetchContent_Declare(x GIT_REPOSITORY https://e.invalid/x)\n',
  });
  assert.ok(fired(root, 'build-time-fetch'), 'a CMake fetch passed');
});

check('build-time-fetch fires on a shell download', () => {
  const root = tree({ 'scripts/setup.sh': '#!/bin/sh\ncurl -L https://e.invalid/blob.tar.gz | tar xz\n' });
  assert.ok(fired(root, 'build-time-fetch'), 'a curl in a build script passed');
});

check('build-time-fetch leaves a comment about fetching alone', () => {
  const root = tree({
    'CMakeLists.txt': '# There is no FetchContent here on purpose — the engine is vendored.\nproject(insimul C)\n',
  });
  assert.ok(!fired(root, 'build-time-fetch'), 'a comment explaining the rule became a finding');
});

check('every buildFetchRule in the rules file has a fixture', () => {
  assert.deepEqual(
    rules.buildFetchRules.map((rule) => rule.id).filter((id) => id !== 'build-time-fetch'),
    [],
    'a buildFetchRule was added with no synthetic positive',
  );
});

// ─── 7. allowances: they resolve, and a stale one fails ─────────────────────

check('a path allowance resolves exactly its finding', () => {
  const root = tree({ 'data/x.pl': ':- dynamic(a/1).\n', 'data/y.pl': ':- dynamic(b/1).\n' });
  const overrides = {
    allow: [{ rule: 'prolog-seed-file', path: 'data/x.pl', classification: 'keep', reason: 'fixture' }],
  };
  const result = auditOpenBoundary(root, { ...rules, ...overrides });
  assert.deepEqual(
    unresolvedFindings(result).map((f) => f.path),
    ['data/y.pl'],
    'the allowance covered the wrong set',
  );
});

check('a pathPrefix allowance covers a directory while every file stays visible', () => {
  const root = tree({ 'vendor/lib/a.pl': 'a.\n', 'vendor/lib/b.pl': 'b.\n' });
  const overrides = {
    allow: [
      { rule: 'prolog-seed-file', pathPrefix: 'vendor/lib/', classification: 'keep', reason: 'fixture' },
    ],
  };
  const result = auditOpenBoundary(root, { ...rules, ...overrides });
  assert.equal(unresolvedFindings(result).length, 0, 'the prefix allowance did not resolve');
  assert.equal(result.content.length, 2, 'the prefix allowance hid the files it allowed');
});

check('a specifier-scoped allowance does not bless the next import in the same file', () => {
  const root = tree({
    'src/a.mjs': `import a from 'left-pad';\nimport b from 'right-pad';\n`,
  });
  const overrides = {
    allow: [
      {
        rule: 'undeclared-dependency',
        path: 'src/a.mjs',
        specifier: 'left-pad',
        classification: 'keep',
        reason: 'fixture',
      },
    ],
  };
  const result = auditOpenBoundary(root, { ...rules, ...overrides });
  assert.deepEqual(unresolvedFindings(result).map((f) => f.specifier), ['right-pad']);
});

check('an allowance classified `remove` does not resolve its finding', () => {
  const root = tree({ 'data/x.pl': 'a.\n' });
  const overrides = {
    allow: [
      { rule: 'prolog-seed-file', path: 'data/x.pl', classification: 'remove', reason: 'owner: nobody' },
    ],
  };
  assert.equal(unresolvedFindings(auditOpenBoundary(root, { ...rules, ...overrides })).length, 1);
});

check('an allowance that matches nothing is reported', () => {
  const root = tree({ 'README.md': 'nothing here\n' });
  const overrides = {
    allow: [{ rule: 'prolog-seed-file', path: 'gone.pl', classification: 'keep', reason: 'stale' }],
  };
  const result = auditOpenBoundary(root, { ...rules, ...overrides });
  assert.equal(result.summary.unusedAllowances, 1, 'a stale allowance was not reported');
});

// ─── 8. the walk ────────────────────────────────────────────────────────────

check('listFiles reads the git index when there is one', () => {
  const root = gitTree({ 'src/a.c': '#include <stdio.h>\n', 'docs/b.md': 'x\n' });
  fs.writeFileSync(path.join(root, 'untracked.c'), '#include "../../out.h"\n');
  const files = listFiles(root);
  assert.deepEqual(files, ['docs/b.md', 'src/a.c'], 'the git listing was wrong');
  assert.ok(!files.includes('untracked.c'), 'an untracked file was audited');
});

check('listFiles falls back to a filesystem walk outside a git repository', () => {
  const root = tree({ 'src/a.c': 'x\n', 'docs/b.md': 'y\n' });
  assert.deepEqual(listFiles(root), ['docs/b.md', 'src/a.c']);
});

// ─── 9. the rules files have not drifted apart ──────────────────────────────

check('the path rules shared with history-scan.rules.json are identical', () => {
  const history = JSON.parse(fs.readFileSync(path.join(repo, 'scripts/history-scan.rules.json'), 'utf8'));
  const historyPathRules = new Map(
    history.rules.filter((rule) => rule.kind === 'path').map((rule) => [rule.id, rule.pattern]),
  );
  const drifted = rules.contentRules
    .filter((rule) => historyPathRules.has(rule.id) && historyPathRules.get(rule.id) !== rule.pattern)
    .map((rule) => rule.id);
  assert.deepEqual(drifted, [], `the tree gate and the history gate disagree about: ${drifted.join(', ')}`);
  // And the overlap is real, not vacuously empty.
  const shared = rules.contentRules.filter((rule) => historyPathRules.has(rule.id));
  assert.ok(shared.length >= 4, `only ${shared.length} rule(s) are shared; the drift check is vacuous`);
});

// ─── 10. the CLI exits non-zero, which is the whole point ───────────────────

const cli = (root, withRules = rulesPath) =>
  spawnSync(process.execPath, [path.join(repo, 'scripts/check-open-boundary.mjs'), root, '--rules', withRules], {
    encoding: 'utf8',
  });

// A synthetic tree matches none of the real rules file's allowances, and
// every one of them going stale is itself a failure — correctly, and it is what
// the third check below asserts. So the clean-tree run is given the same rules
// with an empty `allow`, which is the only difference between "clean" and
// "clean, audited by a rules file written for a different tree".
const rulesWithoutAllowances = path.join(tmp, 'no-allowances.rules.json');
fs.writeFileSync(rulesWithoutAllowances, JSON.stringify({ ...rules, allow: [] }, null, 2));

check('the CLI exits 1 on a tree with a violation', () => {
  const root = tree({ 'src/a.mjs': `import x from '${CLOSED_BACKEND}';\n` });
  const run = cli(root);
  assert.equal(run.status, 1, `expected exit 1, got ${run.status}: ${run.stderr}`);
  assert.match(run.stderr, /closed-repo-import/);
});

check('the CLI exits 0 on a clean tree', () => {
  const root = tree({ 'src/a.mjs': "import fs from 'node:fs';\n" });
  const run = cli(root, rulesWithoutAllowances);
  assert.equal(run.status, 0, `expected exit 0, got ${run.status}: ${run.stderr}`);
});

check('the CLI exits 1 when an allowance in the real rules file is stale', () => {
  const root = tree({ 'README.md': 'an otherwise clean tree\n' });
  const run = cli(root);
  assert.equal(run.status, 1, 'every allowance was stale and the CLI still passed');
  assert.match(run.stderr, /match nothing/);
});

// ─── 11. the committed report agrees with the rules ─────────────────────────

check('the committed report is clean and non-vacuous', () => {
  const reportPath = path.join(repo, 'docs/pre-open/open-boundary.json');
  assert.ok(fs.existsSync(reportPath), 'docs/pre-open/open-boundary.json is missing');
  const report = JSON.parse(fs.readFileSync(reportPath, 'utf8'));
  assert.equal(report.summary.content.unresolved, 0);
  assert.equal(report.summary.dependency.unresolved, 0);
  assert.equal(report.summary.unusedAllowances, 0);
  assert.ok(report.coverage.files > 100, 'the report walked almost nothing');
  assert.ok(report.coverage.cIncludes > 100, 'the report read no C');
  assert.ok(report.coverage.importSpecifiers > 0, 'the report read no imports');
  assert.ok(report.coverage.cargoDependencies > 0, 'the report read no cargo manifest');
});

// ─── done ───────────────────────────────────────────────────────────────────

console.log(`open_boundary_selftest: ${checks} check(s), ${failures} failure(s)`);
process.exit(failures === 0 ? 0 : 1);
