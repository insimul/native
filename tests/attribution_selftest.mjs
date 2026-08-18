#!/usr/bin/env node
// attribution_selftest.mjs — falsify the licensing + policy gate before trusting
// it about this repository (US-3, `242-pre-open-native`).
//
//   node tests/attribution_selftest.mjs
//
// Run by the `attribution` ctest via tests/run_attribution.sh.
//
// ## Why this file exists
//
// `NOTICE` says what is compiled into every artifact this repository ships and
// under what terms, and `docs/pre-open/status.json` says which checklist items
// are done, which are human-gated, and who owns what is still open. Both are
// paperwork in the specific sense that they are TRUE ON THE DAY THEY ARE WRITTEN
// and quietly falsified later — by a re-vendor, a lock bump, or a tasklist
// marking an irreversible step done.
//
// A licensing checker is also the easiest kind of gate to write wrong and never
// notice: its output on a correct tree is identical to the output of one whose
// NOTICE parser matched no headings, whose lockfile parse returned nothing, or
// that walked no files at all. Every one of those failure modes reports CLEAN.
//
// So every rule is fired at a synthetic POSITIVE and at a NEAR MISS here, over a
// throwaway git repository built from scratch, and the set of rules exercised is
// checked for completeness against `ALL_RULES`: adding a rule without a fixture
// fails this test rather than shipping an unexercised one.
//
// ## Everything is a fixture, nothing is this repository
//
// The audit reads a git tree, so the fixtures are real (tiny) git repositories
// in a temp directory, with their own `NOTICE`, their own lockfile, their own
// vendored directory and their own cargo registry cache. The license-drift rule
// therefore fires deterministically on a machine with no crates downloaded —
// `auditAttribution` takes a `cargoHome`, which exists for exactly this.

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  HUMAN_GATED_ITEMS,
  REQUIRED_ARTIFACTS,
  REQUIRED_STATUS_ITEMS,
  auditAttribution,
  auditStatusRecord,
  findLicenseDeclarations,
  findVendoredDirectories,
  parseCargoLock,
  parseNotice,
  readPin,
  unresolvedFindings,
} from '../scripts/check-attribution.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, '..');
const checker = path.join(repo, 'scripts/check-attribution.mjs');

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

/** Every rule id the audit can emit. Asserted covered at the end. */
const ALL_RULES = [
  'missing-artifact',
  'repository-license',
  'forked-policy',
  'unresolved-license',
  'missing-attribution',
  'stale-attribution',
  'license-drift',
  'pin-drift',
  'dangling-derived-path',
  'unattributed-vendor',
  'manifest-license',
  'missing-policy-link',
  'trademark-policy',
  'status-record',
  'status-item-missing',
  'status-human-gate',
  'status-open-item',
  'contributor-agreement',
];
const exercised = new Set();

const POLICY_URL = 'https://github.com/insimul/core/blob/main/TRADEMARK.md';

// ─── the fixture repository ──────────────────────────────────────────────────

const workdir = fs.mkdtempSync(path.join(os.tmpdir(), 'insimul-attribution-'));
process.on('exit', () => fs.rmSync(workdir, { recursive: true, force: true }));

/** A cargo registry cache holding one crate, so license-drift is deterministic. */
const cargoHome = path.join(workdir, 'cargo-home');
const crateDir = path.join(cargoHome, 'registry', 'src', 'fixture-index', 'demo-1.0.0');
fs.mkdirSync(crateDir, { recursive: true });
fs.writeFileSync(
  path.join(crateDir, 'Cargo.toml'),
  'name = "demo"\nversion = "1.0.0"\nlicense = "MIT OR Apache-2.0"\n',
);

const CLEAN_STATUS = () => ({
  repository: 'fixture',
  items: REQUIRED_STATUS_ITEMS.map((id) => ({
    id,
    checklistItem: `the checklist line for ${id}`,
    state: HUMAN_GATED_ITEMS.includes(id) ? 'prepared-human-gated' : 'gated',
    evidence: `evidence for ${id}`,
    humanGated: HUMAN_GATED_ITEMS.includes(id),
    performedByTasklist: !HUMAN_GATED_ITEMS.includes(id),
  })),
  openItems: [
    { id: 'an-open-question', summary: 'something unresolved', owner: 'A Maintainer', raisedBy: 'the fixture' },
  ],
  contributorAgreement: {
    decision: 'DCO 1.1 sign-off. No CLA.',
    decidedOn: '2026-08-17',
    rationale: 'because the fixture says so',
  },
  trademarkPolicy: {
    authoredIn: 'the contract repository',
    url: POLICY_URL,
    forkedHere: false,
    linkedFrom: ['README.md', 'CONTRIBUTING.md'],
  },
});

const CLEAN_NOTICE = () =>
  [
    'Fixture NOTICE',
    '',
    'Prose that the parser ignores, at some length, so that the artifact clears its',
    'byte floor. '.repeat(40),
    '',
    '### Vendored Thing',
    '',
    'SPDX-License-Identifier: MIT',
    'Copyright: Copyright (c) 2026 Somebody',
    'Upstream: https://example.invalid/thing',
    'Vendored-Path: vendor/thing',
    'Pinned-Commit: abc123',
    'Pin-Source: vendor/thing/PIN',
    '',
    'Prose about the vendored thing.',
    '',
    '### demo',
    '',
    'Package: demo',
    'Pinned-Version: 1.0.0',
    'SPDX-License-Identifier: MIT OR Apache-2.0',
    'Copyright: Copyright (c) 2026 Somebody Else',
    'Derived-Work: src/derived.c',
    '',
    'Prose about the crate.',
    '',
  ].join('\n');

const CLEAN_LOCK = () =>
  [
    'version = 4',
    '',
    '[[package]]',
    'name = "fixture"',
    'version = "0.1.0"',
    '',
    '[[package]]',
    'name = "demo"',
    'version = "1.0.0"',
    'source = "registry+https://example.invalid/index"',
    'checksum = "0000"',
    '',
  ].join('\n');

const FILLER = 'Filler prose so the artifact clears its byte floor. '.repeat(30);

/**
 * Build a fixture repository, apply `mutate` to its file map, write it, `git
 * add` it (the audit reads `git ls-files`, which reads the INDEX — no commit
 * needed), and run the audit.
 */
function auditFixture(mutate = () => {}) {
  const root = fs.mkdtempSync(path.join(workdir, 'tree-'));
  const files = {
    LICENSE: fs.readFileSync(path.join(repo, 'LICENSE'), 'utf8'),
    NOTICE: CLEAN_NOTICE(),
    'CONTRIBUTING.md': `# Contributing\n\n${FILLER}\n\nPolicy: ${POLICY_URL}\n`,
    'README.md': `# Fixture\n\n${FILLER}\n\nPolicy: ${POLICY_URL}\n`,
    'docs/pre-open/status.json': CLEAN_STATUS(),
    'rust/Cargo.lock': CLEAN_LOCK(),
    'rust/Cargo.toml': '[workspace.package]\nlicense = "Apache-2.0"\n',
    'rust/demo/Cargo.toml': '[package]\nname = "fixture"\nlicense.workspace = true\n',
    'vendor/thing/LICENSE': 'MIT-ish text\n',
    'vendor/thing/PIN': 'abc123\n',
    'src/derived.c': '/* derived */\n',
  };
  mutate(files);

  for (const [name, content] of Object.entries(files)) {
    if (content === null) continue;
    const full = path.join(root, name);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, typeof content === 'string' ? content : `${JSON.stringify(content, null, 2)}\n`);
  }

  spawnSync('git', ['-C', root, 'init', '-q'], { encoding: 'utf8' });
  spawnSync('git', ['-C', root, 'add', '-A'], { encoding: 'utf8' });

  const result = auditAttribution(root, { cargoHome });
  for (const finding of result.findings) exercised.add(finding.rule);
  return { root, result, rules: new Set(result.findings.map((f) => f.rule)) };
}

/** Assert `rule` fires (positive) and that the clean fixture leaves it alone. */
function fires(rule, mutate) {
  const dirty = auditFixture(mutate);
  assert.ok(
    dirty.rules.has(rule),
    `expected ${rule}; got ${[...dirty.rules].join(', ') || '(nothing)'}`,
  );
}

// ─── the clean fixture is clean ──────────────────────────────────────────────
//
// Every near miss below rests on this: if the baseline had findings of its own,
// a rule "firing" would prove nothing.

check('the clean fixture produces ZERO findings — every near miss rests on this', () => {
  const clean = auditFixture();
  assert.equal(
    clean.result.findings.length,
    0,
    `clean fixture found: ${clean.result.findings.map((f) => `${f.rule}/${f.subject}`).join(', ')}`,
  );
  assert.equal(clean.result.components.length, 2);
  assert.equal(clean.result.coverage.registryPackages, 1);
  assert.equal(clean.result.coverage.firstPartyPackages, 1);
  assert.equal(clean.result.coverage.pinsVerified, 1);
  assert.equal(clean.result.coverage.licensesVerified, 1);
  assert.equal(unresolvedFindings(clean.result).length, 0);
});

// ─── artifacts ───────────────────────────────────────────────────────────────

check('missing-artifact fires when NOTICE is absent', () => {
  fires('missing-artifact', (files) => {
    files.NOTICE = null;
  });
});

check('missing-artifact fires on a STUB — a file containing the word TODO is not a NOTICE', () => {
  fires('missing-artifact', (files) => {
    files.NOTICE = '# NOTICE\n\nTODO\n';
  });
});

check('missing-artifact fires when the status record is absent', () => {
  fires('missing-artifact', (files) => {
    files['docs/pre-open/status.json'] = null;
  });
});

check('near miss: every REQUIRED_ARTIFACTS path exists in the clean fixture, at size', () => {
  const clean = auditFixture();
  for (const artifact of REQUIRED_ARTIFACTS) {
    const size = fs.statSync(path.join(clean.root, artifact.path)).size;
    assert.ok(size >= artifact.minimumBytes, `${artifact.path} is ${size} bytes`);
  }
});

check('repository-license fires when LICENSE is not the Apache-2.0 text', () => {
  fires('repository-license', (files) => {
    files.LICENSE = `MIT License\n\n${'Permission is hereby granted. '.repeat(500)}`;
  });
});

// ─── the policy is linked, not forked ────────────────────────────────────────

check('forked-policy fires on a local TRADEMARK.md', () => {
  fires('forked-policy', (files) => {
    files['TRADEMARK.md'] = '# Trademark policy\n\na divergent copy\n';
  });
});

check('forked-policy fires on docs/trademark-policy.md too', () => {
  fires('forked-policy', (files) => {
    files['docs/trademark-policy.md'] = '# Trademark policy\n';
  });
});

check('near miss: a file that merely DISCUSSES the mark is not a fork', () => {
  const clean = auditFixture((files) => {
    files['docs/naming.md'] = `# Naming\n\nSee the policy: ${POLICY_URL}\n`;
  });
  assert.ok(!clean.rules.has('forked-policy'), 'docs/naming.md read as a forked policy');
});

check('missing-policy-link fires when a file the record NAMES stops linking the policy', () => {
  fires('missing-policy-link', (files) => {
    files['README.md'] = `# Fixture\n\n${FILLER}\n`;
  });
});

check('missing-policy-link fires when the record names a file that is not tracked', () => {
  fires('missing-policy-link', (files) => {
    files['docs/pre-open/status.json'].trademarkPolicy.linkedFrom = ['docs/nowhere.md'];
  });
});

check('trademark-policy fires when the record has no trademarkPolicy at all', () => {
  fires('trademark-policy', (files) => {
    delete files['docs/pre-open/status.json'].trademarkPolicy;
  });
});

check('trademark-policy fires on forkedHere: true — the honest admission is still a failure', () => {
  fires('trademark-policy', (files) => {
    files['docs/pre-open/status.json'].trademarkPolicy.forkedHere = true;
  });
});

check('trademark-policy fires when the url is not a url, and when nothing links it', () => {
  fires('trademark-policy', (files) => {
    files['docs/pre-open/status.json'].trademarkPolicy.url = 'see the other repo';
  });
  fires('trademark-policy', (files) => {
    files['docs/pre-open/status.json'].trademarkPolicy.linkedFrom = [];
  });
});

// ─── the dependency surface ──────────────────────────────────────────────────

check('missing-attribution fires on a locked crate with no stanza', () => {
  fires('missing-attribution', (files) => {
    files['rust/Cargo.lock'] +=
      '[[package]]\nname = "unattributed"\nversion = "2.0.0"\nsource = "registry+https://example.invalid/index"\n\n';
  });
});

check('near miss: a first-party package (no `source`) needs no stanza', () => {
  const clean = auditFixture((files) => {
    files['rust/Cargo.lock'] += '[[package]]\nname = "fixture-sys"\nversion = "0.1.0"\n\n';
  });
  assert.ok(!clean.rules.has('missing-attribution'), 'a path dependency was treated as third-party');
});

check('stale-attribution fires on a stanza whose crate the lock no longer resolves', () => {
  fires('stale-attribution', (files) => {
    files.NOTICE = files.NOTICE.replace('Package: demo', 'Package: removed-last-year');
  });
});

check('stale-attribution fires when a stanza names no Pinned-Version', () => {
  fires('stale-attribution', (files) => {
    files.NOTICE = files.NOTICE.replace('Pinned-Version: 1.0.0\n', '');
  });
});

check('stale-attribution fires when the lock moves under the stanza', () => {
  fires('stale-attribution', (files) => {
    files['rust/Cargo.lock'] = files['rust/Cargo.lock'].replace('version = "1.0.0"', 'version = "1.0.1"');
  });
});

check('stale-attribution fires on a Vendored-Path that does not exist', () => {
  fires('stale-attribution', (files) => {
    files.NOTICE = files.NOTICE.replace('Vendored-Path: vendor/thing', 'Vendored-Path: vendor/gone');
  });
});

check('license-drift fires when NOTICE disagrees with the crate itself', () => {
  fires('license-drift', (files) => {
    files.NOTICE = files.NOTICE.replace('SPDX-License-Identifier: MIT OR Apache-2.0', 'SPDX-License-Identifier: ISC');
  });
});

check('near miss: license-drift compares case-insensitively, not byte for byte', () => {
  const clean = auditFixture((files) => {
    files.NOTICE = files.NOTICE.replace(
      'SPDX-License-Identifier: MIT OR Apache-2.0',
      'SPDX-License-Identifier: mit or apache-2.0',
    );
  });
  assert.ok(!clean.rules.has('license-drift'), 'case difference read as drift');
});

check('near miss: an uncached crate is NOT drift — it is unverified, and counted as such', () => {
  const clean = auditFixture((files) => {
    files['rust/Cargo.lock'] = files['rust/Cargo.lock'].replace('version = "1.0.0"', 'version = "9.9.9"');
    files.NOTICE = files.NOTICE.replace('Pinned-Version: 1.0.0', 'Pinned-Version: 9.9.9');
  });
  assert.ok(!clean.rules.has('license-drift'), 'an absent crate was reported as drift');
  assert.equal(clean.result.coverage.licensesUnverified, 1);
  assert.equal(clean.result.coverage.licensesVerified, 0);
});

check('unattributed-vendor fires on a new vendored directory nobody attributed', () => {
  fires('unattributed-vendor', (files) => {
    files['vendor/newthing/README'] = 'vendored yesterday\n';
  });
});

check('unattributed-vendor fires on a directory carrying its own LICENSE, anywhere', () => {
  fires('unattributed-vendor', (files) => {
    files['src/embedded/COPYING'] = 'somebody else copyright\n';
  });
});

check('dangling-derived-path fires when the attributed file is gone', () => {
  fires('dangling-derived-path', (files) => {
    files['src/derived.c'] = null;
  });
});

// ─── pins ────────────────────────────────────────────────────────────────────

check('pin-drift fires when NOTICE names a different drop than the build reads', () => {
  fires('pin-drift', (files) => {
    files['vendor/thing/PIN'] = 'def456\n';
  });
});

check('pin-drift fires when Pin-Source points at a file that is not there', () => {
  fires('pin-drift', (files) => {
    files.NOTICE = files.NOTICE.replace('Pin-Source: vendor/thing/PIN', 'Pin-Source: vendor/thing/MISSING');
  });
});

check('pin-drift fires when a stanza names a Pin-Source but pins nothing against it', () => {
  fires('pin-drift', (files) => {
    files.NOTICE = files.NOTICE.replace('Pinned-Commit: abc123\n', '');
  });
});

check('readPin reads a JSON key, and reports a missing key rather than guessing', () => {
  const root = fs.mkdtempSync(path.join(workdir, 'pin-'));
  fs.writeFileSync(path.join(root, 'V.json'), '{"commit":"deadbeef","tag":"v1"}');
  fs.writeFileSync(path.join(root, 'V.txt'), '  deadbeef\n');
  assert.deepEqual(readPin(root, 'V.json#commit'), { ok: true, value: 'deadbeef', reason: null });
  assert.deepEqual(readPin(root, 'V.txt'), { ok: true, value: 'deadbeef', reason: null });
  assert.equal(readPin(root, 'V.json#sha').ok, false);
  assert.equal(readPin(root, 'V.txt#commit').ok, false);
  assert.equal(readPin(root, 'nope.json#commit').ok, false);
});

check('the three real pins in this repository agree with the locations the build reads', () => {
  assert.equal(
    readPin(repo, 'vendor/trealla/VENDORED.json#commit').value,
    '07de013677af760a8bca0594ae4b2bef158a3cde',
  );
  assert.equal(readPin(repo, 'corebridge/vendor/quickjs/VERSION').ok, true);
  assert.equal(readPin(repo, 'corebridge/vendor/core/VENDORED.json#coreCommit').ok, true);
});

// ─── the repository's own license claims ─────────────────────────────────────

check('manifest-license fires on a Cargo manifest claiming a different license', () => {
  fires('manifest-license', (files) => {
    files['rust/Cargo.toml'] = '[workspace.package]\nlicense = "MIT"\n';
  });
});

check('manifest-license fires on a package.json claiming a different license', () => {
  fires('manifest-license', (files) => {
    files['wasm/package.json'] = '{\n  "name": "fixture",\n  "license": "GPL-3.0"\n}\n';
  });
});

check('near miss: `license.workspace = true` inherits and is not a claim of its own', () => {
  const clean = auditFixture();
  assert.ok(!clean.rules.has('manifest-license'), 'an inherited license read as a claim');
  const declarations = findLicenseDeclarations(clean.root, ['rust/Cargo.toml', 'rust/demo/Cargo.toml']);
  assert.deepEqual(declarations.map((d) => d.spdx), ['Apache-2.0']);
});

// ─── unresolved licenses ─────────────────────────────────────────────────────

check('unresolved-license fires on NOASSERTION with no Resolution-Owner', () => {
  fires('unresolved-license', (files) => {
    files.NOTICE += '### Unknown Thing\n\nSPDX-License-Identifier: NOASSERTION\n\nprose\n';
  });
});

check('unresolved-license fires when the owner is a TODO rather than a person', () => {
  fires('unresolved-license', (files) => {
    files.NOTICE += '### Unknown Thing\n\nSPDX-License-Identifier: NOASSERTION\nResolution-Owner: TODO\n\nprose\n';
  });
});

check('near miss: an unresolved license WITH an owner is allowed to exist', () => {
  const clean = auditFixture((files) => {
    files.NOTICE +=
      '### Unknown Thing\n\nSPDX-License-Identifier: NOASSERTION\nResolution-Owner: A Maintainer, before the flip\n\nprose\n';
  });
  assert.ok(!clean.rules.has('unresolved-license'), 'an owned unresolved license was rejected');
});

// ─── the status record ───────────────────────────────────────────────────────

check('status-item-missing fires when a checklist item is unaccounted for', () => {
  fires('status-item-missing', (files) => {
    files['docs/pre-open/status.json'].items = files['docs/pre-open/status.json'].items.filter(
      (item) => item.id !== 'content-audit',
    );
  });
});

check('status-record fires on an invented state, and on an item with no evidence', () => {
  fires('status-record', (files) => {
    files['docs/pre-open/status.json'].items[0].state = 'mostly-done';
  });
  fires('status-record', (files) => {
    files['docs/pre-open/status.json'].items[0].evidence = '';
  });
});

check('status-record fires when humanGated / performedByTasklist are not booleans', () => {
  fires('status-record', (files) => {
    files['docs/pre-open/status.json'].items[0].performedByTasklist = 'yes';
  });
});

check('status-human-gate fires when the visibility flip is marked DONE', () => {
  fires('status-human-gate', (files) => {
    const record = files['docs/pre-open/status.json'];
    record.items.find((item) => item.id === 'visibility-flip').state = 'done';
  });
});

check('status-human-gate fires when a tasklist claims to have performed an irreversible step', () => {
  fires('status-human-gate', (files) => {
    const record = files['docs/pre-open/status.json'];
    record.items.find((item) => item.id === 'history-rewrite').performedByTasklist = true;
  });
});

check('status-human-gate fires when an irreversible step is not marked humanGated', () => {
  fires('status-human-gate', (files) => {
    const record = files['docs/pre-open/status.json'];
    record.items.find((item) => item.id === 'history-rewrite').humanGated = false;
  });
});

check('near miss: HUMAN_GATED_ITEMS are all required items, so none can be dropped silently', () => {
  for (const id of HUMAN_GATED_ITEMS) {
    assert.ok(REQUIRED_STATUS_ITEMS.includes(id), `${id} is human-gated but not required`);
  }
});

check('status-open-item fires on an unowned open item, and on an owner that is a TBD', () => {
  fires('status-open-item', (files) => {
    files['docs/pre-open/status.json'].openItems[0].owner = '';
  });
  fires('status-open-item', (files) => {
    files['docs/pre-open/status.json'].openItems[0].owner = 'TBD';
  });
  fires('status-open-item', (files) => {
    delete files['docs/pre-open/status.json'].openItems[0].raisedBy;
  });
});

check('contributor-agreement fires when the decision is absent, a TODO, undated, or unreasoned', () => {
  fires('contributor-agreement', (files) => {
    delete files['docs/pre-open/status.json'].contributorAgreement;
  });
  fires('contributor-agreement', (files) => {
    files['docs/pre-open/status.json'].contributorAgreement.decision = 'TBD — CLA or DCO';
  });
  fires('contributor-agreement', (files) => {
    files['docs/pre-open/status.json'].contributorAgreement.decidedOn = 'summer';
  });
  fires('contributor-agreement', (files) => {
    files['docs/pre-open/status.json'].contributorAgreement.rationale = '';
  });
});

check('status-record fires on a record that is not JSON, or has no items array', () => {
  fires('status-record', (files) => {
    files['docs/pre-open/status.json'] = '{ not json';
  });
  const noItems = auditStatusRecord({ openItems: [] }, 'docs/pre-open/status.json');
  for (const finding of noItems) exercised.add(finding.rule);
  assert.ok(noItems.some((f) => f.rule === 'status-record'));
});

// ─── the parsers ─────────────────────────────────────────────────────────────

check('parseNotice folds INDENTED continuation lines in, and leaves prose out', () => {
  const components = parseNotice(
    [
      '### Thing',
      'Copyright: Copyright (c) 2026 A',
      '  and Copyright (c) 2026 B',
      'Upstream: x',
      '',
      'Unindented prose about the thing, which is not a continuation of Upstream.',
      'Late-Field: still read',
    ].join('\n'),
  );
  assert.equal(components.length, 1);
  assert.equal(components[0].fields.Copyright, 'Copyright (c) 2026 A and Copyright (c) 2026 B');
  // Prose after a field does NOT extend it — that is what separates a legal
  // notice a human can write from a data file that eats its own paragraphs.
  assert.equal(components[0].fields.Upstream, 'x');
  // …and a field is read wherever it appears in the stanza, so a stanza whose
  // prose comes first still parses.
  assert.equal(components[0].fields['Late-Field'], 'still read');
});

check('parseNotice ignores fields before the first stanza — prose is not a component', () => {
  assert.equal(parseNotice('Copyright: nobody\n\nsome prose\n').length, 0);
});

check('parseCargoLock separates registry packages from path/workspace ones', () => {
  const packages = parseCargoLock(CLEAN_LOCK());
  assert.deepEqual(
    packages.map((p) => [p.name, p.version, p.source === null]),
    [
      ['fixture', '0.1.0', true],
      ['demo', '1.0.0', false],
    ],
  );
});

check('parseCargoLock stops reading at a non-package table', () => {
  const packages = parseCargoLock(
    '[[package]]\nname = "a"\nversion = "1"\n\n[metadata]\nname = "not-a-package"\n',
  );
  assert.deepEqual(packages.map((p) => p.name), ['a']);
});

check('findVendoredDirectories unions both signals — under vendor/, or carrying a LICENSE', () => {
  const found = findVendoredDirectories([
    'vendor/thing/src/a.c',
    'corebridge/vendor/quickjs/quickjs.c',
    'src/embedded/LICENSE',
    'src/insimul.c',
    'LICENSE',
  ]);
  assert.deepEqual(found, ['corebridge/vendor/quickjs', 'src/embedded', 'vendor/thing']);
});

check('findVendoredDirectories does not report the repository root for its own LICENSE', () => {
  assert.deepEqual(findVendoredDirectories(['LICENSE', 'NOTICE']), []);
});

// ─── the real CLI ────────────────────────────────────────────────────────────
//
// The functions above are exercised in-process; these three assert that the
// EXECUTABLE behaves — that a finding is exit 1, a clean tree is exit 0, and the
// summary a human reads is the summary the audit produced.

function cli(root, extra = []) {
  return spawnSync(process.execPath, [checker, root, ...extra], { encoding: 'utf8' });
}

check('CLI: a clean fixture exits 0 and reports its coverage', () => {
  const clean = auditFixture();
  const run = cli(clean.root);
  assert.equal(run.status, 0, run.stderr);
  assert.match(run.stdout, /2 NOTICE component\(s\) covering 1 registry crate\(s\)/);
  assert.match(run.stdout, /1 pin\(s\) checked against the location the build reads/);
});

check('CLI: a forked policy exits 1 and NAMES the rule', () => {
  const dirty = auditFixture((files) => {
    files['TRADEMARK.md'] = '# Trademark policy\n\na divergent copy\n';
  });
  const run = cli(dirty.root);
  assert.equal(run.status, 1);
  assert.match(run.stderr, /forked-policy: TRADEMARK\.md/);
});

check('CLI: --print lists every stanza with its identifier', () => {
  const clean = auditFixture();
  const run = cli(clean.root, ['--print']);
  assert.equal(run.status, 0, run.stderr);
  assert.match(run.stdout, /MIT {2}Vendored Thing/);
});

check('CLI: --report writes a report a later run can be diffed against', () => {
  const clean = auditFixture();
  const out = path.join(workdir, 'report.json');
  const run = cli(clean.root, ['--report', out]);
  assert.equal(run.status, 0, run.stderr);
  const report = JSON.parse(fs.readFileSync(out, 'utf8'));
  assert.equal(report.tool, 'scripts/check-attribution.mjs');
  assert.equal(report.findings.length, 0);
  assert.equal(report.components.length, 2);
});

// ─── completeness ────────────────────────────────────────────────────────────

check('every rule in ALL_RULES was fired at a synthetic positive by this file', () => {
  const unexercised = ALL_RULES.filter((rule) => !exercised.has(rule));
  assert.deepEqual(unexercised, [], `never fired: ${unexercised.join(', ')}`);
});

check('every rule this file fired is declared in ALL_RULES', () => {
  const undeclared = [...exercised].filter((rule) => !ALL_RULES.includes(rule));
  assert.deepEqual(undeclared, [], `undeclared: ${undeclared.join(', ')}`);
});

// ─── verdict ─────────────────────────────────────────────────────────────────

console.log(`attribution_selftest: ${checks} check(s), ${failures} failure(s)`);
process.exit(failures === 0 ? 0 : 1);
