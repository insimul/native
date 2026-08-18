#!/usr/bin/env node
// history_scan_selftest.mjs — falsify the history scanner before trusting it
// about this repository (US-1, `242-pre-open-native`).
//
//   node tests/history_scan_selftest.mjs [--rules scripts/history-scan.rules.json]
//
// Run by the `history_scan` ctest via tests/run_history_scan.sh.
//
// ## Why this file exists
//
// `docs/pre-open/history-scan.json` says this repository's history is clean.
// That sentence is worth exactly as much as the evidence that the scanner can
// say anything else — and a secret scanner is the easiest kind of gate to write
// wrong and never notice, because its output on a clean tree is identical to the
// output of a scanner whose regexes never compile, whose rules file failed to
// load, or that skipped every file it was meant to read.
//
// So: every rule in scripts/history-scan.rules.json is fired at a synthetic
// positive here, and the table is checked for COMPLETENESS against the rules
// file — adding a rule without a fixture fails this test rather than shipping an
// unexercised pattern.
//
// ## The fixtures contain no literal secret
//
// Every synthetic credential is assembled by concatenation at run time, so this
// file's own bytes match none of the patterns it exercises. That matters more
// here than the usual tidiness argument: a fixture committed today becomes a
// blob the history audit reads forever, and the alternative — exempting this
// file by name — is a permanent hole in the scan in exchange for saving a `+`.
// Delete the exemption of this file's name from SELF_FILES (there is none) and
// the audit stays clean; that is the property being preserved.

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { compileRulePattern, isBinary, maskMatch, parseReplacements, applyReplacements, scanBlob } from '../scripts/history-scan.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, '..');

const argv = process.argv.slice(2);
let rulesPath = path.join(repo, 'scripts/history-scan.rules.json');
for (let i = 0; i < argv.length; i += 1) {
  if (argv[i] === '--rules') rulesPath = path.resolve(argv[(i += 1)]);
  else {
    console.error(`history_scan_selftest: unknown argument ${JSON.stringify(argv[i])}`);
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

/** Run the real rule set over one synthetic blob. */
function scan(at, text) {
  return scanBlob({ path: at, text }, rules.rules, rules.packProvenance);
}
const fired = (at, text, id) => scan(at, text).some((finding) => finding.rule === id);

// ─── the fixture table ───────────────────────────────────────────────────────
//
// One entry per rule id. `at`/`text` is a POSITIVE — it must fire. `clean` is a
// near miss that must NOT: the pattern's `except`, or the innocent neighbour the
// rule has to leave alone. A rule with no `clean` is one whose shape is
// unambiguous (a PEM header is never a false positive).

const KEY16 = 'ABCDEFGHIJKLMNOP';
const B64 = 'QUJDREVGR0hJSktMTU5PUFFSU1RVVldYWVoK';
const FIXTURES = {
  'closed-pack-tree': {
    at: 'data/insimul/genre/fantasy/heuristics.pl',
    text: 'noise',
    clean: { at: 'data/radiant/base-templates.pl', text: 'noise' },
  },
  'world-content-tree': {
    at: 'packs/alderforest/entities.pl',
    text: 'noise',
    clean: { at: 'src/insimul.c', text: 'noise' },
  },
  'prolog-seed-file': {
    at: 'somewhere/seed.pl',
    text: 'noise',
    clean: { at: 'somewhere/seed.pl.md', text: 'noise' },
  },
  'binary-artifact': {
    at: 'wasm/insimul.wasm',
    text: null,
    clean: { at: 'wasm/insimul.mjs', text: 'noise' },
  },
  'build-output-tree': {
    at: 'build-wasm/insimul.data',
    text: null,
    clean: { at: 'cmake/wasm.cmake', text: 'noise' },
  },
  'dotenv-file': {
    at: 'tools/.env',
    text: 'noise',
    clean: { at: 'tools/.env.example', text: 'noise' },
  },
  'private-key-file': {
    at: 'ci/deploy.pem',
    text: 'noise',
    clean: { at: 'ci/deploy.pem.md', text: 'noise' },
  },
  'credential-config-file': {
    at: '.npmrc',
    text: 'noise',
    clean: { at: 'npmrc.md', text: 'noise' },
  },
  'aws-access-key-id': {
    at: 'scripts/deploy.sh', text: `AWS_KEY=${'AKIA'}${KEY16}\n`,
    clean: { at: 'scripts/deploy.sh', text: `AWS_KEY=${'AKIA'}short\n` },
  },
  'github-token': {
    at: 'docs/ci.md', text: `token: ${'ghp_'}${'a'.repeat(36)}\n`,
    clean: { at: 'docs/ci.md', text: `token: ${'ghp_'}short\n` },
  },
  'anthropic-api-key': {
    at: 'notes.md', text: `key ${'sk-ant-'}${'a1'.repeat(16)}\n`,
  },
  'openai-api-key': {
    at: 'notes.md', text: `key ${'sk-'}${'b2'.repeat(20)}\n`,
  },
  'google-api-key': {
    at: 'app/config.js', text: `const k = "${'AIza'}${'c'.repeat(35)}";\n`,
  },
  'slack-token': {
    at: 'bot/config.yml', text: `token: ${'xoxb-'}1234567890abcdef\n`,
  },
  'stripe-key': {
    at: 'billing.md', text: `${'sk'}_live_${'d'.repeat(24)}\n`,
  },
  'npm-token': {
    at: '.github/workflows/publish.yml', text: `NODE_AUTH_TOKEN: ${'npm_'}${'e'.repeat(36)}\n`,
  },
  'private-key-block': {
    at: 'tests/fixture.txt', text: `${'-----BEGIN '}${'PRIVATE KEY-----'}\n${B64}\n`,
  },
  'json-web-token': {
    at: 'docs/api.md', text: `Authorization: Bearer ${'eyJ'}abcdefgh.${'eyJ'}ijklmnop.qrstuvwx\n`,
  },
  'connection-string-with-password': {
    at: 'server/config.md', text: `postgres://svc:${'hunter2'}${'hunter2'}@db.internal:5432/insimul\n`,
  },
  'assigned-secret': {
    at: 'src/config.js', text: `const apiKey = "${'z'.repeat(24)}";\n`,
    clean: { at: 'src/config.js', text: 'const apiKey = "your-key-here-goes";\n' },
  },
};

// ─── 1. completeness: no rule ships unexercised ─────────────────────────────

check('every rule in the rules file has a fixture', () => {
  const ids = rules.rules.map((rule) => rule.id).sort();
  const covered = Object.keys(FIXTURES).sort();
  assert.deepEqual(covered, ids, `fixtures ${JSON.stringify(covered)} != rules ${JSON.stringify(ids)}`);
});

check('the rules file declares only known kinds and valid classifications', () => {
  for (const rule of rules.rules) {
    assert.ok(['path', 'content'].includes(rule.kind), `${rule.id}: kind ${rule.kind}`);
    assert.ok(['scrub', 'review'].includes(rule.classification), `${rule.id}: classification ${rule.classification}`);
    assert.ok(rule.description && rule.description.trim().length > 10, `${rule.id}: no description`);
    compileRulePattern(rule.pattern); // throws on a misplaced (?i) or bad regex
    if (rule.except) compileRulePattern(rule.except);
  }
});

// ─── 2. every rule fires at a synthetic positive ────────────────────────────

for (const [id, fixture] of Object.entries(FIXTURES)) {
  check(`${id}: fires on a synthetic positive`, () => {
    assert.ok(fired(fixture.at, fixture.text, id), `${id} did not fire on ${fixture.at}`);
  });
  if (fixture.clean) {
    check(`${id}: does NOT fire on its near miss`, () => {
      assert.ok(!fired(fixture.clean.at, fixture.clean.text, id), `${id} fired on the clean fixture ${fixture.clean.at}`);
    });
  }
}

// ─── 3. the structural pack detector ────────────────────────────────────────

// Split the same way, and for the same reason: the detector fires on a blob
// carrying all three of the pack skeleton's keys, each followed by a literal
// value. Written out plainly, this file would BE a pack document — a
// scrub-classified finding in this repository's own history, forever, planted by
// the test that proves the detector works.
//
// (The first draft of this comment listed the three keys with their punctuation,
// which tripped the detector on the comment itself. That is not an anecdote: it
// is the shortest available demonstration that the structural rule fires on
// content rather than on intent, and it is why the fixtures below are assembled
// rather than written.)
const PACK_KEYS = { id: 'pack', version: `pack${'Version'}`, phases: `pha${'ses'}` };
const PACK = (id) =>
  JSON.stringify({ [PACK_KEYS.id]: id, [PACK_KEYS.version]: '3', [PACK_KEYS.phases]: [{ op: 'grid' }] });

check('closed-pack-document: fires on a product-named pack document', () => {
  const findings = scan('docs/design.md', PACK('insimul.streets.colonial'));
  assert.equal(findings.filter((f) => f.rule === 'closed-pack-document').length, 1);
  assert.equal(findings.find((f) => f.rule === 'closed-pack-document').classification, 'scrub');
});

check('closed-pack-document: does NOT fire on an allowed probe id', () => {
  for (const id of rules.packProvenance.allowedPrefixes.map((prefix) => `${prefix}sketch`)) {
    assert.ok(!fired('docs/design.md', PACK(id), 'closed-pack-document'), `fired on ${id}`);
  }
});

check('closed-pack-document: fires on a pack whose id was replaced by an identifier', () => {
  const text = `{ ${PACK_KEYS.id}: PACK_ID, ${PACK_KEYS.version}: "3", ${PACK_KEYS.phases}: [ { op: "grid" } ] }`;
  const findings = scan('src/fixture.ts', text).filter((f) => f.rule === 'closed-pack-document');
  assert.equal(findings.length, 1);
  assert.match(findings[0].match, /<no literal id>/);
});

check('closed-pack-document: does NOT fire on the code that implements the schema', () => {
  const text = `export function toPack(p) { return { ${PACK_KEYS.id}: p.pack, ${PACK_KEYS.phases}: p.phases.map(f) }; }`;
  assert.ok(!fired('src/pack.ts', text, 'closed-pack-document'));
});

// ─── 4. the report may not leak what it found ───────────────────────────────

check('maskMatch never emits a usable secret', () => {
  const secret = `${'AKIA'}${KEY16}`;
  const masked = maskMatch(secret);
  assert.ok(!masked.includes(secret), 'the mask contains the secret');
  assert.ok(masked.length < secret.length, 'the mask is not shorter than the secret');
  assert.equal(maskMatch('short'), '<5 chars>');
});

check('a content finding carries a masked excerpt, not the match', () => {
  const secret = `${'AKIA'}${KEY16}`;
  const finding = scan('scripts/deploy.sh', `AWS_KEY=${secret}\n`).find((f) => f.rule === 'aws-access-key-id');
  assert.ok(!finding.match.includes(secret));
  assert.equal(finding.line, 1);
});

// ─── 5. binary detection: source files are not silently skipped ─────────────

check('isBinary: a wasm-shaped buffer is binary', () => {
  assert.ok(isBinary(Buffer.from([0x00, 0x61, 0x73, 0x6d, ...new Array(400).fill(0)])));
});

check('isBinary: a source file holding one NUL is NOT binary', () => {
  assert.ok(!isBinary(Buffer.from(`const SEP = '\0';\n${'x'.repeat(4000)}`, 'utf8')));
});

// ─── 6. the scrub-plan verifier ─────────────────────────────────────────────

check('parseReplacements: literal and regex forms, and glob is rejected', () => {
  const parsed = parseReplacements('# comment\nliteral:a.b==>c\nregex:x[0-9]+\nplain\n');
  assert.deepEqual(parsed, [
    { kind: 'literal', search: 'a.b', replace: 'c' },
    { kind: 'regex', search: 'x[0-9]+', replace: '***REMOVED***' },
    { kind: 'literal', search: 'plain', replace: '***REMOVED***' },
  ]);
  assert.throws(() => parseReplacements('glob:*.pem\n'), /glob:/);
});

check('applyReplacements + rescan: a covered finding disappears, an uncovered one does not', () => {
  const secret = `${'AKIA'}${KEY16}`;
  const text = `AWS_KEY=${secret}\n`;
  const purged = applyReplacements(text, parseReplacements(`literal:${secret}\n`));
  assert.ok(!fired('scripts/deploy.sh', purged, 'aws-access-key-id'), 'the finding survived a correct rule');
  const typo = applyReplacements(text, parseReplacements(`literal:${secret.toLowerCase()}\n`));
  assert.ok(fired('scripts/deploy.sh', typo, 'aws-access-key-id'), 'a rule with the wrong casing reported a purge');
});

// ─── 7. this repository's committed plan is EMPTY, and says why ─────────────

check("the committed scrub plan has no active rule and no active path", () => {
  const active = (file) =>
    fs
      .readFileSync(path.join(repo, 'scripts', file), 'utf8')
      .split('\n')
      .filter((line) => line.trim() !== '' && !line.trim().startsWith('#'));
  assert.deepEqual(active('history-scrub.replacements.txt'), [], 'a replacement rule appeared without a scrub finding');
  assert.deepEqual(active('history-scrub.paths.txt'), [], 'a path removal appeared without a scrub finding');
});

check('the committed report agrees: zero scrub findings, zero unresolved', () => {
  const reportPath = path.join(repo, 'docs/pre-open/history-scan.json');
  assert.ok(fs.existsSync(reportPath), 'docs/pre-open/history-scan.json is missing');
  const report = JSON.parse(fs.readFileSync(reportPath, 'utf8'));
  assert.equal(report.summary.scrub, 0, 'the committed report has a scrub finding but the plan is empty');
  assert.equal(report.summary.unresolved, 0);
  assert.equal(report.summary.unusedAllowances, 0);
  assert.ok(report.coverage.blobs > 0);
});

// ─── done ───────────────────────────────────────────────────────────────────

console.log(`history_scan_selftest: ${checks} check(s), ${failures} failure(s)`);
process.exit(failures === 0 ? 0 : 1);
