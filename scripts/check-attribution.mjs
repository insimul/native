#!/usr/bin/env node
// check-attribution.mjs — the pre-open LICENSING + POLICY gate (US-3,
// `242-pre-open-native`).
//
//   node scripts/check-attribution.mjs [root …] [--print] [--report <path>]
//
// `docs/explanation/OPEN_SOURCE_STRATEGY.md`'s pre-open checklist asks two
// things of every repo about to go public that the content/dependency audit
// does not:
//
//   "License + NOTICE files (Apache-2.0 + third-party attributions incl.
//    Trealla) in every open repo; CONTRIBUTING + CLA/DCO decision made."
//   "Trademark/conformance policy published alongside the spec."
//
// Those read like paperwork, and paperwork is exactly the kind of thing that is
// done once, congratulated, and then quietly falsified by the next re-vendor.
// A NOTICE is only true on the day it is written unless something keeps it
// true. So this is a gate, not a report:
//
//   NOTICE completeness  — every crate the lockfile resolves has a stanza,
//                          every stanza names a real crate or a real path,
//                          every vendored third-party directory is attributed,
//                          and an SPDX identifier that disagrees with the crate
//                          itself fails.
//   Pin agreement        — a stanza that quotes a pin is checked against the ONE
//                          authoritative location the BUILD reads it from
//                          (`vendor/trealla/VENDORED.json`,
//                          `corebridge/vendor/quickjs/VERSION`,
//                          `corebridge/vendor/core/VENDORED.json`). An
//                          attribution that names a different commit than the
//                          bytes compiled is the same class of bug the version
//                          stamp exists to prevent.
//   Artifact presence    — LICENSE, NOTICE, CONTRIBUTING.md and the pre-open
//                          status record exist and are not stubs.
//   Policy LINKED        — the trademark/conformance policy is core's single
//                          copy, linked from here and NOT forked into this
//                          repository. Both halves are checked: the link must
//                          be present in every file the record claims links it,
//                          and no local copy may exist.
//   License consistency  — every manifest in the tree declares the repository's
//                          own SPDX. `rust/Cargo.toml` said `MIT` while
//                          `LICENSE` was Apache-2.0; that is what this rule is
//                          for.
//   Status-record shape  — every checklist item carries a state, the two
//                          IRREVERSIBLE steps are marked human-gated and NOT
//                          performed by any tasklist, every open item has an
//                          owner, and the CLA/DCO decision is a decision rather
//                          than a TODO.
//
// ## DERIVED from `insimul/core`@`b37837b`'s `scripts/check-attribution.mjs`
//
// Same rule US-1 and US-2 followed: core went first, and a second judgement is
// a second thing to keep correct. The NOTICE parser, the status-record
// validator, the human-gate rules and the "no allow list, the data file IS the
// decision" doctrine are core's, unchanged in substance. Five divergences, all
// forced by this repository being a C/Rust tree rather than an npm package:
//
//   1. **The declared-dependency surface is CARGO, not npm.** There is no
//      `package.json` here (`scripts/open-boundary.rules.json` argues that at
//      length), so "every declared dependency has a stanza" reads against
//      `rust/Cargo.lock` — and against the LOCK, not the manifests, because the
//      lock is the set that actually gets compiled and it is tracked. Core's
//      license-drift rule reads `node_modules`; this one reads the Cargo
//      registry source cache, and SAYS SO OUT LOUD when the cache is absent.
//   2. **Pins are checked (`pin-drift`).** Core has one vendored binary; this
//      tree has three pinned drops, each with exactly one authoritative pin
//      location that the build reads (CLAUDE.md, "Versioning & packaging").
//      A stanza may name its pin and where the pin lives, and the two must
//      agree.
//   3. **TRADEMARK.md is a LINK here, not an artifact.** Core authored the
//      policy because core is the contract repo. A copy in this repository is
//      the failure the acceptance criterion names, so the gate requires the
//      link and FORBIDS the file.
//   4. **`manifest-license`** — a repository whose LICENSE and whose package
//      metadata disagree tells a redistributor two different things. Core's npm
//      manifest is a single field it already checks by hand; here the claim is
//      spread over a Cargo workspace and a generated wasm `package.json`.
//   5. **The walk is `git ls-files`**, not the filesystem — same reason
//      check-open-boundary.mjs walks it: a clone publishes the tracked set, and
//      this tree grows `build/`, `build-wasm/`, `dist/` and `rust/target/`
//      during a gate run.
//
// ## The decisions are not in this file
//
// The data files ARE the human decisions — `NOTICE` records what was found and
// under what license, `docs/pre-open/status.json` records where each checklist
// item stands and who owns what is still open — so there is no `allow` list to
// drift. The script's only judgements are the ones nobody should be able to
// sign away: that a dependency is attributed, that an unresolved license has
// somebody's name on it, and that a human-gated step is not quietly marked done.
//
// ## What it cannot see
//
// Whether a stanza's PROSE is true. Whether a file was copied from somewhere
// with no attribution at all — nothing in a tree announces that it was pasted.
// Whether the linked policy still says what this repository believes it says:
// the link is checked as a string, and core's copy could change under it (that
// is the cost of not forking, and it is the cheaper cost). A license identifier
// that is wrong in the crate's own metadata. And it makes no legal judgement
// about any of it: an obligation that attaches is a question for counsel, which
// is what the status record's open items are for.

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

/** This repository's own license, as an SPDX identifier. */
export const REPOSITORY_SPDX = 'Apache-2.0';

/**
 * The artifacts the checklist names, and what each is for.
 *
 * `minimumBytes` is deliberately not zero. "The file exists" is satisfied by a
 * file containing the word TODO, and the checklist item it would then satisfy
 * is the one that matters most at the moment somebody makes the repository
 * public.
 *
 * `TRADEMARK.md` is NOT on this list, and its absence is enforced below.
 */
export const REQUIRED_ARTIFACTS = [
  { path: 'LICENSE', minimumBytes: 10000, what: 'the Apache-2.0 license text' },
  { path: 'NOTICE', minimumBytes: 1000, what: 'third-party attributions (Apache-2.0 §4(d))' },
  { path: 'CONTRIBUTING.md', minimumBytes: 1000, what: 'how to contribute, and the CLA/DCO decision' },
  { path: 'docs/pre-open/status.json', minimumBytes: 500, what: 'the pre-open checklist status record' },
];

/** Every checklist item the status record must account for, by id. */
export const REQUIRED_STATUS_ITEMS = [
  'backend-extraction',
  'history-scrub',
  'content-audit',
  'dependency-audit',
  'license-notice-contributing',
  'trademark-conformance-policy',
  'history-rewrite',
  'visibility-flip',
];

/**
 * The two steps no tasklist performs. Both are irreversible — a rewrite
 * invalidates every clone (and every submodule pointer at this repository), and
 * a repository that has been public for one minute has been cloned, cached and
 * indexed. The gate's job is not to stop a human doing them; it is to stop a
 * *record* claiming they were done by an agent.
 */
export const HUMAN_GATED_ITEMS = ['history-rewrite', 'visibility-flip'];

/**
 * Paths that would BE a fork of the trademark policy rather than a link to it.
 * Matched against the tracked set; any hit is a finding with no allowance.
 */
export const FORKED_POLICY_PATHS =
  /^(TRADEMARK(-[A-Za-z0-9]+)?\.(md|txt)|docs\/(TRADEMARK|trademark)[^/]*\.(md|txt))$/;

const VALID_STATES = new Set([
  'done',
  'gated',
  'prepared-human-gated',
  'human-gated',
  'blocked',
  'not-started',
  'out-of-scope',
]);

/** Text that says a decision has not been made. */
const UNRESOLVED_TEXT = /\b(todo|tbd|t\.b\.d\.|undecided|to be decided|fixme|xxx)\b/i;

/** SPDX values that mean "nobody has determined this". */
const UNRESOLVED_SPDX = new Set(['', 'noassertion', 'unresolved', 'unknown', 'see-license-file']);

const LICENSE_FILENAME = /^(LICEN[CS]E|COPYING)(\..+)?$/i;

// ─── the tree ────────────────────────────────────────────────────────────────

/**
 * Every tracked file, repo-relative and forward-slashed.
 *
 * `git ls-files`, because that is what a clone publishes — and because this
 * tree grows `build/`, `build-wasm/`, `dist/` and `rust/target/` while the gate
 * that calls this is running. Throws rather than degrading: an attribution
 * audit over zero files reports "clean".
 */
export function listTrackedFiles(root) {
  const result = spawnSync('git', ['-C', root, 'ls-files', '-z'], {
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  });
  if (result.status !== 0) {
    throw new Error(
      `git ls-files failed in ${root}: ${(result.stderr ?? '').trim() || 'no such repository'}`,
    );
  }
  return result.stdout.split('\0').filter((entry) => entry.length > 0);
}

// ─── the NOTICE parser ───────────────────────────────────────────────────────

/**
 * Components declared in a NOTICE.
 *
 * A component is a `### Name` heading followed by `Key: value` lines; a value
 * continues onto following indented lines, so a multi-line copyright block
 * stays one field. Everything else is prose the parser ignores, which is the
 * point — the file has to read as a legal notice first and as a data file
 * second, or it will be maintained as neither.
 */
export function parseNotice(text) {
  const components = [];
  const lines = text.split('\n');
  let current = null;
  let lastKey = null;

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    const heading = /^###\s+(.+?)\s*$/.exec(line);
    if (heading) {
      current = { name: heading[1], line: i + 1, fields: {} };
      components.push(current);
      lastKey = null;
      continue;
    }
    if (current === null) continue;

    const field = /^([A-Za-z][A-Za-z0-9-]*):[ \t]*(.*)$/.exec(line);
    if (field) {
      lastKey = field[1];
      current.fields[lastKey] = field[2].trim();
      continue;
    }
    if (lastKey !== null && /^[ \t]+\S/.test(line)) {
      current.fields[lastKey] = `${current.fields[lastKey]} ${line.trim()}`.trim();
      continue;
    }
    lastKey = null;
  }
  return components;
}

/** A field's comma-separated values, trimmed and emptied of blanks. */
export function fieldList(value) {
  if (!value) return [];
  return value
    .split(',')
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
}

// ─── cargo: the declared-dependency surface ──────────────────────────────────

/**
 * Every package in a `Cargo.lock`, in order.
 *
 * A `[[package]]` block without a `source` is a workspace member or a path
 * dependency — first-party, and not something to attribute to somebody else.
 * The parse is deliberately shallow: the lock is a flat, generated file, and a
 * TOML parser would be a dependency this repository refuses to take (see
 * `scripts/open-boundary.rules.json`).
 */
export function parseCargoLock(text) {
  const packages = [];
  let current = null;
  for (const rawLine of text.split('\n')) {
    const line = rawLine.trim();
    if (line === '[[package]]') {
      current = { name: null, version: null, source: null };
      packages.push(current);
      continue;
    }
    if (line.startsWith('[') && line !== '[[package]]') {
      current = null;
      continue;
    }
    if (current === null) continue;
    const field = /^(name|version|source)\s*=\s*"(.*)"$/.exec(line);
    if (field) current[field[1]] = field[2];
  }
  return packages.filter((entry) => entry.name !== null);
}

/**
 * The license a crate declares about itself, read from the registry source
 * cache — the Cargo analogue of core's `node_modules` read, and the same
 * reasoning: the failure this rule exists for is not a missing NOTICE, it is a
 * NOTICE that used to be right.
 *
 * Returns `null` when the crate is not in the cache, and the caller SAYS SO in
 * the summary. A check that silently degrades to nothing is the failure mode
 * this repository keeps writing tests about.
 */
export function readCrateLicense(name, version, { cargoHome = null } = {}) {
  const home = cargoHome ?? process.env.CARGO_HOME ?? path.join(os.homedir(), '.cargo');
  const registry = path.join(home, 'registry', 'src');
  let indexes;
  try {
    indexes = fs.readdirSync(registry, { withFileTypes: true });
  } catch {
    return null;
  }
  for (const index of indexes) {
    if (!index.isDirectory()) continue;
    const manifest = path.join(registry, index.name, `${name}-${version}`, 'Cargo.toml');
    let text;
    try {
      text = fs.readFileSync(manifest, 'utf8');
    } catch {
      continue;
    }
    const declared = /^license\s*=\s*"(.*)"$/m.exec(text);
    if (declared) return declared[1];
  }
  return null;
}

// ─── vendored directories ────────────────────────────────────────────────────

/**
 * Directories that look like vendored third-party code.
 *
 * Two independent signals, unioned, because either alone has a blind spot: a
 * directory whose parent is `vendor/` (what this repository does today, twice
 * over — `vendor/trealla` and `corebridge/vendor/*`), and any directory
 * carrying its own LICENSE file (what somebody will do instead the first time
 * they vendor something without using that name — and, here, what surfaces the
 * three components bundled *inside* Trealla, which are not under a `vendor/`
 * parent at all).
 */
export function findVendoredDirectories(trackedFiles) {
  const found = new Set();
  for (const file of trackedFiles) {
    const segments = file.split('/');
    for (let i = 1; i < segments.length; i += 1) {
      if (segments[i - 1] === 'vendor') found.add(segments.slice(0, i + 1).join('/'));
    }
    const basename = segments[segments.length - 1];
    if (LICENSE_FILENAME.test(basename) && segments.length > 1) {
      found.add(segments.slice(0, -1).join('/'));
    }
  }
  return [...found].sort();
}

// ─── pins ────────────────────────────────────────────────────────────────────

/**
 * Read a pin from the ONE place the build reads it from.
 *
 * `Pin-Source` is `<path>` (the file's whole text, trimmed) or `<path>#<key>`
 * (a top-level key of a JSON document). That is exactly the shape of the three
 * authoritative pin locations CLAUDE.md names, and nothing else is supported on
 * purpose: a pin expressed as a regex over a build file is a pin with two
 * homes.
 */
export function readPin(root, pinSource) {
  const [file, key = null] = pinSource.split('#');
  let text;
  try {
    text = fs.readFileSync(path.join(root, file), 'utf8');
  } catch {
    return { ok: false, value: null, reason: `${file} does not exist` };
  }
  if (key === null) return { ok: true, value: text.trim(), reason: null };
  let document;
  try {
    document = JSON.parse(text);
  } catch {
    return { ok: false, value: null, reason: `${file} is not valid JSON` };
  }
  if (!Object.prototype.hasOwnProperty.call(document, key)) {
    return { ok: false, value: null, reason: `${file} has no \`${key}\`` };
  }
  return { ok: true, value: String(document[key]), reason: null };
}

// ─── license declarations across the tree ────────────────────────────────────

/**
 * Every place this repository states its own license to a package manager.
 *
 * A redistributor reads the manifest, not the LICENSE file, so a manifest that
 * disagrees with `LICENSE` is a false statement to exactly the audience the
 * NOTICE exists for. `license.workspace = true` inherits and is not a claim of
 * its own, so it is skipped rather than read.
 */
export function findLicenseDeclarations(root, trackedFiles) {
  const declarations = [];
  for (const file of trackedFiles) {
    const basename = file.split('/').pop();
    const isCargo = basename === 'Cargo.toml';
    const isJsonish = basename === 'package.json' || file === 'scripts/package.sh';
    if (!isCargo && !isJsonish) continue;
    let text;
    try {
      text = fs.readFileSync(path.join(root, file), 'utf8');
    } catch {
      continue;
    }
    const lines = text.split('\n');
    for (let i = 0; i < lines.length; i += 1) {
      const cargo = isCargo ? /^\s*license\s*=\s*"([^"]*)"/.exec(lines[i]) : null;
      const jsonish = isJsonish ? /^\s*"license"\s*:\s*"([^"]*)"/.exec(lines[i]) : null;
      const match = cargo ?? jsonish;
      if (match) declarations.push({ path: file, line: i + 1, spdx: match[1] });
    }
  }
  return declarations;
}

// ─── the status record ───────────────────────────────────────────────────────

/** Validate `docs/pre-open/status.json`; returns findings. */
export function auditStatusRecord(record, statusPath, { root = null, trackedFiles = null } = {}) {
  const findings = [];
  const add = (rule, subject, detail) => findings.push({ rule, path: statusPath, subject, detail });

  if (record === null) {
    add('status-record', statusPath, 'is missing or is not valid JSON');
    return findings;
  }

  const items = Array.isArray(record.items) ? record.items : null;
  if (items === null) {
    add('status-record', statusPath, 'has no `items` array — the per-item checklist state IS the record');
    return findings;
  }

  const byId = new Map();
  for (const item of items) {
    if (typeof item?.id !== 'string' || item.id.length === 0) {
      add('status-record', JSON.stringify(item), 'an item has no `id`');
      continue;
    }
    byId.set(item.id, item);
    if (!VALID_STATES.has(item.state)) {
      add(
        'status-record',
        item.id,
        `state ${JSON.stringify(item.state)} is not one of: ${[...VALID_STATES].join(', ')}`,
      );
    }
    if (typeof item.checklistItem !== 'string' || item.checklistItem.trim().length === 0) {
      add('status-record', item.id, 'has no `checklistItem` — the checklist line it answers');
    }
    if (typeof item.evidence !== 'string' || item.evidence.trim().length === 0) {
      add('status-record', item.id, 'has no `evidence` — a state with nothing behind it is a claim');
    }
    if (typeof item.humanGated !== 'boolean' || typeof item.performedByTasklist !== 'boolean') {
      add('status-record', item.id, 'must state `humanGated` and `performedByTasklist` as booleans');
    }
  }

  for (const id of REQUIRED_STATUS_ITEMS) {
    if (!byId.has(id)) {
      add('status-item-missing', id, 'the checklist item is not accounted for in the status record');
    }
  }

  for (const id of HUMAN_GATED_ITEMS) {
    const item = byId.get(id);
    if (item === undefined) continue;
    if (item.humanGated !== true) {
      add('status-human-gate', id, 'is irreversible and must be recorded as `humanGated: true`');
    }
    if (item.performedByTasklist !== false) {
      add(
        'status-human-gate',
        id,
        'must be recorded as `performedByTasklist: false` — no tasklist performs it, and a record ' +
          'that says otherwise is the one an agent would point at',
      );
    }
    if (item.state === 'done') {
      add(
        'status-human-gate',
        id,
        'is marked `done`; this record is written by the tasklist that does NOT perform it, so ' +
          '`done` here can only be a mistake or a lie',
      );
    }
  }

  for (const open of record.openItems ?? []) {
    const id = open?.id ?? JSON.stringify(open);
    if (typeof open?.owner !== 'string' || open.owner.trim().length === 0 || UNRESOLVED_TEXT.test(open.owner)) {
      add('status-open-item', id, 'has no owner — an open item nobody owns is a wish');
    }
    if (typeof open?.raisedBy !== 'string' || open.raisedBy.trim().length === 0) {
      add('status-open-item', id, 'has no `raisedBy` — who found it is how the next reader checks it');
    }
  }

  const agreement = record.contributorAgreement;
  if (agreement === undefined || agreement === null) {
    add(
      'contributor-agreement',
      'contributorAgreement',
      'is absent; the checklist asks for the CLA/DCO decision to be MADE, and an absent record is a TODO',
    );
  } else {
    if (typeof agreement.decision !== 'string' || agreement.decision.trim().length === 0) {
      add('contributor-agreement', 'decision', 'is empty');
    } else if (UNRESOLVED_TEXT.test(agreement.decision)) {
      add(
        'contributor-agreement',
        'decision',
        `reads ${JSON.stringify(agreement.decision)} — that is a TODO, not a decision`,
      );
    }
    if (typeof agreement.decidedOn !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(agreement.decidedOn)) {
      add('contributor-agreement', 'decidedOn', 'is not an ISO date — an undated decision cannot be reviewed');
    }
    if (typeof agreement.rationale !== 'string' || agreement.rationale.trim().length === 0) {
      add('contributor-agreement', 'rationale', 'is empty — a decision without its reasoning gets re-litigated');
    }
  }

  // ── the policy is LINKED, and the link is a fact about files ──────────────
  //
  // The acceptance criterion is "LINKED from this repo, not forked into a
  // divergent copy". Both halves are mechanical here: `forked-policy` (below,
  // in auditAttribution) says there is no copy, and this says the link is real.
  // A record naming three files that link the policy, in a tree where none of
  // them mentions it, is the exact shape of paperwork this gate exists to stop.

  const policy = record.trademarkPolicy;
  if (policy === undefined || policy === null) {
    add(
      'trademark-policy',
      'trademarkPolicy',
      'is absent. The checklist asks for the trademark/conformance policy to be published ' +
        'alongside the spec; this repository is not the spec, so what it owes is a LINK, and the ' +
        'link has to be recorded somewhere a gate can check it',
    );
  } else {
    if (typeof policy.url !== 'string' || !/^https?:\/\/\S+$/.test(policy.url)) {
      add('trademark-policy', 'url', 'is not an http(s) URL — the link is the whole deliverable');
    }
    if (typeof policy.authoredIn !== 'string' || policy.authoredIn.trim().length === 0) {
      add('trademark-policy', 'authoredIn', 'does not say which repository holds the single copy');
    }
    if (policy.forkedHere !== false) {
      add(
        'trademark-policy',
        'forkedHere',
        'must be `false`. Five copies of a trademark policy is five policies, and the first time ' +
          'one is edited the mark means five different things',
      );
    }
    const linkedFrom = Array.isArray(policy.linkedFrom) ? policy.linkedFrom : [];
    if (linkedFrom.length === 0) {
      add('trademark-policy', 'linkedFrom', 'names no file that links the policy — a link nobody can reach is not one');
    }
    if (root !== null && typeof policy.url === 'string') {
      const tracked = new Set(trackedFiles ?? []);
      for (const file of linkedFrom) {
        if (!tracked.has(file)) {
          add('missing-policy-link', file, 'is named as linking the policy but is not a tracked file');
          continue;
        }
        let text = '';
        try {
          text = fs.readFileSync(path.join(root, file), 'utf8');
        } catch {
          text = '';
        }
        if (!text.includes(policy.url)) {
          add(
            'missing-policy-link',
            file,
            `does not contain ${JSON.stringify(policy.url)}. The record claims this file links the ` +
              'policy; it does not, and the claim is what a reader would trust',
          );
        }
      }
    }
  }

  return findings;
}

// ─── the audit ───────────────────────────────────────────────────────────────

/** Run the whole licensing/policy gate over `root`. */
export function auditAttribution(root, { cargoHome = null } = {}) {
  const findings = [];
  const add = (rule, where, subject, detail) => findings.push({ rule, path: where, subject, detail });

  const trackedFiles = listTrackedFiles(root);
  const tracked = new Set(trackedFiles);

  for (const artifact of REQUIRED_ARTIFACTS) {
    let size = -1;
    try {
      size = fs.statSync(path.join(root, artifact.path)).size;
    } catch {
      size = -1;
    }
    if (size < 0) {
      add('missing-artifact', artifact.path, artifact.path, `is absent — ${artifact.what}`);
    } else if (size < artifact.minimumBytes) {
      add(
        'missing-artifact',
        artifact.path,
        artifact.path,
        `is ${size} bytes, under the ${artifact.minimumBytes}-byte floor for ${artifact.what}; ` +
          'a stub satisfies the checklist item it was supposed to answer',
      );
    }
  }

  // The repository's own license, read rather than assumed. Every
  // `manifest-license` finding below is measured against this claim, so the
  // claim itself is checked first.
  let licenseText = '';
  try {
    licenseText = fs.readFileSync(path.join(root, 'LICENSE'), 'utf8');
  } catch {
    licenseText = '';
  }
  if (licenseText.length > 0 && !/Apache License\s*\n?\s*Version 2\.0, January 2004/.test(licenseText)) {
    add(
      'repository-license',
      'LICENSE',
      'LICENSE',
      `does not read as the Apache-2.0 text, but everything else here asserts SPDX ` +
        `${REPOSITORY_SPDX}. One of the two is wrong`,
    );
  }

  // ── the policy must be linked, not forked ────────────────────────────────

  for (const file of trackedFiles) {
    if (FORKED_POLICY_PATHS.test(file)) {
      add(
        'forked-policy',
        file,
        file,
        'is a local copy of the trademark/conformance policy. That policy is authored ONCE, in ' +
          'the contract repository, and linked from here — a fork of it means the mark means two ' +
          'different things the first time somebody edits one copy',
      );
    }
  }

  let noticeText = '';
  try {
    noticeText = fs.readFileSync(path.join(root, 'NOTICE'), 'utf8');
  } catch {
    noticeText = '';
  }
  const components = parseNotice(noticeText);

  // ── the declared-dependency surface: cargo ───────────────────────────────

  let lockPackages = [];
  const lockPath = 'rust/Cargo.lock';
  if (tracked.has(lockPath)) {
    try {
      lockPackages = parseCargoLock(fs.readFileSync(path.join(root, lockPath), 'utf8'));
    } catch {
      lockPackages = [];
    }
  }
  const registryPackages = lockPackages.filter((entry) => entry.source !== null);
  const firstParty = lockPackages.filter((entry) => entry.source === null).map((entry) => entry.name);
  const lockByName = new Map(registryPackages.map((entry) => [entry.name, entry]));

  const attributed = new Map();
  let licensesVerified = 0;
  let licensesUnverified = 0;
  let pinsVerified = 0;

  for (const component of components) {
    const spdx = (component.fields['SPDX-License-Identifier'] ?? '').trim();
    const packageName = component.fields.Package;

    if (UNRESOLVED_SPDX.has(spdx.toLowerCase())) {
      const owner = component.fields['Resolution-Owner'];
      if (!owner || owner.trim().length === 0 || UNRESOLVED_TEXT.test(owner)) {
        add(
          'unresolved-license',
          'NOTICE',
          component.name,
          `declares SPDX ${JSON.stringify(spdx)} and names no \`Resolution-Owner\`. An unresolved ` +
            'license is allowed to exist; an unowned one is not — a NOTICE that ships into a public ' +
            'repository cannot be un-shipped',
        );
      }
    }

    if (packageName) {
      attributed.set(packageName, component);
      const locked = lockByName.get(packageName);
      if (locked === undefined) {
        add(
          'stale-attribution',
          'NOTICE',
          packageName,
          `is attributed here but ${lockPath} resolves no such registry package. A stale ` +
            'attribution is a claim about a dependency this repository no longer builds against',
        );
      } else {
        const claimed = (component.fields['Pinned-Version'] ?? '').trim();
        if (claimed.length === 0) {
          add(
            'stale-attribution',
            'NOTICE',
            packageName,
            'names no `Pinned-Version`. The version is which license text was read; without it the ' +
              'stanza is a claim about whatever the reader assumes is installed',
          );
        } else if (claimed !== locked.version) {
          add(
            'stale-attribution',
            'NOTICE',
            packageName,
            `NOTICE pins ${JSON.stringify(claimed)}; ${lockPath} resolves ` +
              `${JSON.stringify(locked.version)}. A lock bump re-opens the license question, which is ` +
              'the only reason to record the version at all',
          );
        }

        const installed = readCrateLicense(packageName, locked.version, { cargoHome });
        if (installed === null) {
          licensesUnverified += 1;
        } else {
          licensesVerified += 1;
          if (installed.toLowerCase() !== spdx.toLowerCase()) {
            add(
              'license-drift',
              'NOTICE',
              packageName,
              `NOTICE says ${JSON.stringify(spdx)}; the crate declares ${JSON.stringify(installed)}. ` +
                'The attribution used to be right, which is the only way a NOTICE ever goes wrong',
            );
          }
        }
      }
    }

    // ── pins: one authoritative location, read by the build ────────────────

    const pinSource = (component.fields['Pin-Source'] ?? '').trim();
    const pinned = (component.fields['Pinned-Commit'] ?? component.fields['Pinned-Version'] ?? '').trim();
    if (pinSource.length > 0) {
      if (pinned.length === 0) {
        add(
          'pin-drift',
          'NOTICE',
          component.name,
          `names \`Pin-Source: ${pinSource}\` but pins nothing against it`,
        );
      } else {
        const read = readPin(root, pinSource);
        if (!read.ok) {
          add('pin-drift', 'NOTICE', component.name, `\`Pin-Source: ${pinSource}\` — ${read.reason}`);
        } else if (read.value !== pinned) {
          add(
            'pin-drift',
            'NOTICE',
            component.name,
            `NOTICE pins ${JSON.stringify(pinned)}; ${pinSource} — the one location the BUILD reads ` +
              `this pin from — says ${JSON.stringify(read.value)}. An attribution that names a ` +
              'different drop than the bytes compiled is attribution for something nobody ships',
          );
        } else {
          pinsVerified += 1;
        }
      }
    }

    for (const derived of fieldList(component.fields['Derived-Work'])) {
      if (!fs.existsSync(path.join(root, derived))) {
        add(
          'dangling-derived-path',
          'NOTICE',
          `${component.name} → ${derived}`,
          'the attributed file does not exist. Either it moved and the attribution must follow, or ' +
            'it is gone and somebody should decide whether the attribution still applies',
        );
      }
    }
  }

  for (const entry of registryPackages) {
    if (!attributed.has(entry.name)) {
      add(
        'missing-attribution',
        'NOTICE',
        entry.name,
        `is resolved by ${lockPath} (v${entry.version}) and attributed nowhere in NOTICE`,
      );
    }
  }

  // ── vendored directories ─────────────────────────────────────────────────

  const vendored = findVendoredDirectories(trackedFiles);
  const vendoredAttributed = new Set(
    components.flatMap((component) => fieldList(component.fields['Vendored-Path'])),
  );
  for (const directory of vendored) {
    if (!vendoredAttributed.has(directory)) {
      add(
        'unattributed-vendor',
        directory,
        directory,
        'looks like vendored third-party code (it sits under a `vendor/` directory, or carries its ' +
          'own LICENSE) and no NOTICE stanza names it in `Vendored-Path`',
      );
    }
  }
  for (const directory of vendoredAttributed) {
    if (!fs.existsSync(path.join(root, directory))) {
      add(
        'stale-attribution',
        'NOTICE',
        directory,
        'is attributed as a vendored path that does not exist',
      );
    }
  }

  // ── every manifest states the same license ───────────────────────────────

  const declarations = findLicenseDeclarations(root, trackedFiles);
  for (const declaration of declarations) {
    if (declaration.spdx !== REPOSITORY_SPDX) {
      add(
        'manifest-license',
        declaration.path,
        `${declaration.path}:${declaration.line}`,
        `declares SPDX ${JSON.stringify(declaration.spdx)} while this repository is licensed ` +
          `${REPOSITORY_SPDX} (LICENSE). A redistributor reads the manifest, not the LICENSE file`,
      );
    }
  }

  // ── the status record ────────────────────────────────────────────────────

  const statusPath = 'docs/pre-open/status.json';
  let record = null;
  try {
    record = JSON.parse(fs.readFileSync(path.join(root, statusPath), 'utf8'));
  } catch {
    record = null;
  }
  findings.push(...auditStatusRecord(record, statusPath, { root, trackedFiles }));

  return {
    coverage: {
      trackedFiles: trackedFiles.length,
      components: components.length,
      registryPackages: registryPackages.length,
      firstPartyPackages: firstParty.length,
      vendoredDirectories: vendored.length,
      derivedPaths: components.flatMap((c) => fieldList(c.fields['Derived-Work'])).length,
      licenseDeclarations: declarations.length,
      licensesVerified,
      licensesUnverified,
      pinsVerified,
      statusItems: Array.isArray(record?.items) ? record.items.length : 0,
      openItems: Array.isArray(record?.openItems) ? record.openItems.length : 0,
    },
    components: components.map((component) => ({
      name: component.name,
      spdx: component.fields['SPDX-License-Identifier'] ?? null,
      package: component.fields.Package ?? null,
      pinnedVersion: component.fields['Pinned-Version'] ?? null,
      pinnedCommit: component.fields['Pinned-Commit'] ?? null,
      pinSource: component.fields['Pin-Source'] ?? null,
      vendoredPath: component.fields['Vendored-Path'] ?? null,
      derivedWork: fieldList(component.fields['Derived-Work']),
    })),
    findings,
  };
}

/** Every finding the gate refuses to pass. There is no allow list, by design. */
export function unresolvedFindings(result) {
  return result.findings;
}

// ─── CLI ─────────────────────────────────────────────────────────────────────

const isMain =
  process.argv[1] &&
  path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname);

if (isMain) {
  const argv = process.argv.slice(2);
  const roots = [];
  let reportPath = null;
  let print = false;
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--report') reportPath = argv[(i += 1)];
    else if (argv[i] === '--print') print = true;
    else roots.push(argv[i]);
  }
  if (roots.length === 0) roots.push(process.cwd());

  let failed = false;
  for (const rawRoot of roots) {
    const root = path.resolve(rawRoot);
    const result = auditAttribution(root);

    if (print) {
      for (const component of result.components) {
        console.log(`  ${component.spdx ?? '—'}  ${component.name}`);
      }
    }

    if (result.findings.length > 0) {
      failed = true;
      console.error(
        `check-attribution: ${result.findings.length} finding(s) in ${rawRoot}. ` +
          `OPEN_SOURCE_STRATEGY.md's licensing + policy checklist must hold before this ` +
          `repository goes public:`,
      );
      for (const finding of result.findings) {
        console.error(`  ${finding.rule}: ${finding.subject} (${finding.path})`);
        console.error(`    ${finding.detail}`);
      }
    } else {
      const c = result.coverage;
      console.log(
        `check-attribution: ${rawRoot} — ${c.components} NOTICE component(s) covering ` +
          `${c.registryPackages} registry crate(s) (plus ${c.firstPartyPackages} first-party), ` +
          `${c.vendoredDirectories} vendored directory(ies) and ${c.derivedPaths} derived path(s); ` +
          `${c.pinsVerified} pin(s) checked against the location the build reads; ` +
          `${c.licensesVerified} license(s) verified against the cargo registry, ` +
          `${c.licensesUnverified} NOT verified (not in the local cache); ` +
          `${c.licenseDeclarations} manifest license declaration(s); ` +
          `${c.statusItems} checklist item(s), ${c.openItems} open item(s)`,
      );
      if (c.licensesUnverified > 0) {
        console.log(
          `check-attribution: ${c.licensesUnverified} SPDX identifier(s) were NOT compared against ` +
            'the crate itself — those crates are not in the local cargo registry cache. Run ' +
            '`cargo fetch --manifest-path rust/Cargo.toml` and re-run to close that gap.',
        );
      }
    }

    if (reportPath !== null) {
      let head = null;
      try {
        head = spawnSync('git', ['-C', root, 'rev-parse', 'HEAD'], { encoding: 'utf8' })
          .stdout.trim() || null;
      } catch {
        head = null;
      }
      const report = {
        tool: 'scripts/check-attribution.mjs',
        repository: { root: path.basename(root), gitHead: head },
        ...result,
      };
      fs.mkdirSync(path.dirname(path.resolve(reportPath)), { recursive: true });
      fs.writeFileSync(path.resolve(reportPath), `${JSON.stringify(report, null, 2)}\n`);
    }
  }

  process.exit(failed ? 1 : 0);
}
