#!/usr/bin/env node
// history-scan.mjs — the pre-open HISTORY scrub audit (US-1, `242-pre-open-native`).
//
//   node scripts/history-scan.mjs [--repo .] [--rules scripts/history-scan.rules.json]
//                                 [--report docs/pre-open/history-scan.json]
//                                 [--check] [--verify-scrub] [--all-objects]
//
// ## Where this file came from
//
// DERIVED, not written here: `scripts/history-scan.mjs` in `insimul/core` at
// `b37837b` (sha256 a48860d868b4ce7b0628fa2471fa4096c5897331208b3fd237ab8ee9210ed6a4),
// the scanner tasklist `241-pre-open-core` US-1 built and falsified. 242 inherits
// core's audit METHOD and its pattern set rather than inventing a second one — a
// second secret scanner is a second thing to keep correct, and the half nobody
// re-reads is the half that reports clean.
//
// Three deliberate divergences, all of them recorded in `docs/pre-open-audit.md`
// §1.2 so a re-vendor knows what to re-apply:
//
//   1. `allow` entries may key on `pathPrefix` as well as `path`/`blob`. Core had
//      exactly one `.pl` in its history; this repository vendors an entire Prolog
//      engine, so 39 of them are one upstream library directory at one pinned
//      commit. Prefix allowances keep those blobs VISIBLE in the report — each
//      one classified, with its commit hashes — instead of hiding them behind a
//      rule `except`, which is the other way to get a green scan and tells a
//      flip-time reviewer nothing.
//   2. `SELF_FILES` also exempts this repository's own scanner gate script.
//   3. Prose that counted core's blobs is marked as core's.
//
// Everything else is byte-for-byte core's, including the rule engine, the
// masking, and `--verify-scrub`.
//
// Reads every blob reachable from every ref, applies `history-scan.rules.json`
// plus the structural pack detector, and writes a findings report. `--check`
// exits non-zero if any finding is not accounted for by an `allow` entry.
//
// ## Why HEAD is not the audit
//
// `docs/explanation/OPEN_SOURCE_STRATEGY.md` calls the history scrub *"the most
// common IP-leak vector when open-sourcing"*, and the reason is mechanical:
// `git clone` copies every commit, so deleting a secret in a later commit
// publishes it just as thoroughly as leaving it. Every gate this repository has
// — `trealla_vendor`, `core_vendor`, `abi_neutrality` — reads the working tree
// and can see none of that. This reads the commits.
//
// ## What it scans, exactly
//
// Every blob reachable from `--all` (all branches, all tags) plus HEAD. Not the
// full object database: unreachable objects — an amended commit's orphan, a
// dropped stash — are not transferred by `git push` or `git clone`, so they are
// not published by the visibility flip, and `git filter-repo` expels them from
// the rewritten repo regardless. `--all-objects` scans them anyway when you want
// to know what is sitting in a local clone.
//
// Blobs are read once each, by object id. Git stores one object per distinct
// CONTENT, so a file that never changed across the whole history is one blob,
// and the path recorded for it is the first path `rev-list` names it under. When a
// finding lands, the commit attribution (`--find-object`) recovers every commit
// that added or removed it, which is what a scrub needs anyway.
//
// ## What it deliberately does not do
//
// **It does not write matched text into the report.** A findings file that
// quoted the secret it found would be a second copy of the secret, committed to
// the repository the audit exists to protect, and it would survive the scrub of
// the first copy. The report records rule id, path, blob id, line number, and a
// masked excerpt (first two and last two characters). That is enough to find it
// with `git cat-file -p <blob>` locally and not enough to use.
//
// **It does not decide.** It classifies by rule and by the `allow` list a human
// wrote; a match with no `allow` entry is reported, not resolved. Scanners that
// classify their own findings drift toward whatever keeps the build green.
//
// ## What it cannot see
//
// A secret that is base64'd, encrypted, split across lines, or shaped like
// nothing in the rule list. A closed pack whose ids were stripped before the
// commit. Binary blobs are skipped entirely (they are counted and named in the
// report — a skipped file that is silently uncounted reads as a clean one).
// This is a guard against the accident, not against someone determined to leak;
// a clean report is evidence, not proof, and the audit record says so.

import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

import {
  PACK_SCANNED_EXTENSIONS,
  PROVENANCE_SELF_FILES,
  inspectPackText,
  isAllowedPackId,
} from './check-pack-provenance.mjs';

/**
 * Blobs larger than this are not scanned line-by-line.
 *
 * Nothing in this repository's history is close: the largest blob is
 * `corebridge/vendor/quickjs/quickjs.c` at 1.7 MB, which is text and IS scanned.
 * The cap exists so a future vendored artifact — a `.wasm`, a preload image, a
 * packaged tarball — cannot make the audit take ten minutes — and every blob it skips is NAMED in the report, because a cap
 * that silently drops files is how a scan reports clean over the one file that
 * mattered.
 */
const MAX_BLOB_BYTES = 4 * 1024 * 1024;

/**
 * Basenames whose SUBJECT is this scan, exempt for the same reason as `SELF` in
 * check-pack-provenance.mjs — and for one more that only applies here.
 *
 * The rules file has to CONTAIN the patterns it looks for. The test has to
 * contain a synthetic key per rule or it proves nothing. The report has to name
 * the findings, masked. Every one of those is a file that would flag itself
 * forever, in a history that cannot be edited without a rewrite. Kept tiny and
 * by exact basename — a glob here would be a hole.
 */
const SELF_FILES = new Set([
  ...PROVENANCE_SELF_FILES,
  'history-scan.mjs',
  'history-scan.rules.json',
  'history-scan.json',
  'history-scan.test.ts',
  'history-scrub.sh',
  'history-scrub.replacements.txt',
  'history-scrub.paths.txt',
  // This repository's falsification driver (the `history_scan` ctest). Same
  // reason as `history-scan.test.ts` above: a test that a synthetic AWS key is
  // caught has to contain a synthetic AWS key. It builds its fixtures by
  // concatenation anyway, so the exemption is belt-and-braces rather than the
  // only thing keeping the scan green — check that by deleting this line and
  // re-running: the scan stays clean.
  'run_history_scan.sh',
]);

// ─── regex ───────────────────────────────────────────────────────────────────

/**
 * Compile a rule pattern.
 *
 * JavaScript has no inline `(?i)`, so a LEADING one is translated to the `i`
 * flag. One anywhere else would be a group that matches nothing while looking
 * like it works, so it throws instead.
 */
export function compileRulePattern(pattern, extraFlags = '') {
  let source = pattern;
  let flags = extraFlags;
  if (source.startsWith('(?i)')) {
    source = source.slice(4);
    flags += 'i';
  }
  if (source.includes('(?i)')) {
    throw new Error(`history-scan: inline (?i) is only supported at the start of a pattern: ${pattern}`);
  }
  return new RegExp(source, flags);
}

/**
 * A match, reduced to something safe to commit: `sk-…ab` rather than the key.
 *
 * Short matches are replaced wholesale — masking `abc` as `a…c` gives away most
 * of a three-character secret, and there is no such thing anyway.
 */
export function maskMatch(text) {
  const collapsed = text.replace(/\s+/g, ' ').trim();
  if (collapsed.length <= 8) return `<${collapsed.length} chars>`;
  return `${collapsed.slice(0, 2)}…${collapsed.slice(-2)} <${collapsed.length} chars>`;
}

// ─── git ─────────────────────────────────────────────────────────────────────

function git(repo, args, options = {}) {
  return execFileSync('git', ['-C', repo, ...args], {
    encoding: options.encoding ?? 'utf8',
    maxBuffer: 512 * 1024 * 1024,
  });
}

/**
 * Every blob in scope, as `{ blob, path }`.
 *
 * `rev-list --all --objects` emits commits (no path), trees (a directory path)
 * and blobs (a file path) in one stream, so the types are separated with a
 * `--batch-check` pass rather than guessed from the path.
 */
function listBlobs(repo, { allObjects = false } = {}) {
  // The reachable walk, which is the only source of PATHS: `--batch-all-objects`
  // reports object ids and nothing else.
  const paths = new Map();
  for (const line of git(repo, ['rev-list', '--all', '--objects', 'HEAD']).split('\n')) {
    if (line === '') continue;
    const space = line.indexOf(' ');
    if (space === -1) continue; // a commit: no path, and never a blob
    const id = line.slice(0, space);
    if (!paths.has(id)) paths.set(id, line.slice(space + 1));
  }

  const format = '--batch-check=%(objectname) %(objecttype) %(objectsize)';
  const check = allObjects
    ? git(repo, ['cat-file', '--batch-all-objects', format])
    : execFileSync('git', ['-C', repo, 'cat-file', format], {
        input: [...paths.keys()].join('\n'),
        encoding: 'utf8',
        maxBuffer: 512 * 1024 * 1024,
      });

  const blobs = [];
  for (const line of check.split('\n')) {
    if (line === '') continue;
    const [id, type, size] = line.split(' ');
    if (type !== 'blob') continue;
    // An unreachable blob has no path anywhere in the tree walk. It is still
    // scanned (that is what --all-objects is for); the rules that key on a path
    // simply cannot fire on it, and the report says so rather than inventing one.
    blobs.push({ blob: id, path: paths.get(id) ?? `<unreachable ${id.slice(0, 12)}>`, size: Number(size) });
  }
  blobs.sort((a, b) => (a.path === b.path ? a.blob.localeCompare(b.blob) : a.path.localeCompare(b.path)));
  return blobs;
}

/**
 * Read many blobs in ONE `git cat-file --batch`.
 *
 * The obvious implementation — `git cat-file blob <id>` per object — spawned a
 * process 1,681 times and took 22 seconds when core measured it, most of it
 * fork/exec. `--batch`
 * reads the ids on stdin and answers on stdout as
 * `<id> blob <size>\n<size bytes>\n`, which is one spawn and about a second.
 * That difference is the whole reason the scan is cheap enough for US-2 to put
 * in CI, where an audit that takes half a minute gets skipped.
 */
function readBlobs(repo, ids) {
  const result = spawnSync('git', ['-C', repo, 'cat-file', '--batch'], {
    input: `${ids.join('\n')}\n`,
    maxBuffer: 1024 * 1024 * 1024,
  });
  if (result.status !== 0) {
    throw new Error(`history-scan: git cat-file --batch failed: ${result.stderr?.toString('utf8') ?? ''}`);
  }

  const out = result.stdout;
  const contents = new Map();
  let cursor = 0;
  while (cursor < out.length) {
    const newline = out.indexOf(0x0a, cursor);
    if (newline === -1) break;
    const header = out.toString('utf8', cursor, newline).split(' ');
    cursor = newline + 1;
    // `<id> missing` — no payload follows. Recorded as absent rather than empty;
    // an empty buffer would scan clean and read as a file that was checked.
    if (header.length < 3) continue;
    const size = Number(header[2]);
    contents.set(header[0], out.subarray(cursor, cursor + size));
    cursor += size + 1; // git writes a trailing newline after the payload
  }
  return contents;
}

/** Every commit that added or removed this blob, oldest first. */
function commitsTouching(repo, id) {
  const log = git(repo, ['log', '--all', '--format=%H\t%aI\t%s', '--find-object', id]);
  return log
    .split('\n')
    .filter((line) => line !== '')
    .map((line) => {
      const [commit, date, ...subject] = line.split('\t');
      return { commit, date, subject: subject.join('\t') };
    })
    .reverse();
}

// ─── scan ────────────────────────────────────────────────────────────────────

/**
 * Is this blob binary — i.e. not worth running text rules over?
 *
 * NOT git's "any NUL in the first 8 KiB" heuristic, which this scan started with
 * in core and which was wrong there in a way worth recording: three TypeScript
 * sources in that history use a literal NUL as a key separator (`const KEY_SEPARATOR =
 * '\0'` in `src/ai/deterministic-stream.ts` and two others), and git calls all
 * three binary. A secret-scanner that skips source files because they contain a
 * control character is the failure mode the whole audit exists to avoid, and it
 * would have reported clean while never reading them.
 *
 * So: binary if more than 1% of the first 8 KiB is non-text — NUL and the C0
 * controls other than tab/newline/carriage-return. One NUL in a 4 KB source is
 * 0.02% and reads as text; a wasm module is far over the line.
 */
export function isBinary(buffer) {
  const head = buffer.subarray(0, 8192);
  if (head.length === 0) return false;
  let nonText = 0;
  for (const byte of head) {
    if (byte === 9 || byte === 10 || byte === 13) continue;
    if (byte < 32 || byte === 127) nonText += 1;
  }
  return nonText / head.length > 0.01;
}

function lineOf(text, index) {
  let line = 1;
  for (let i = 0; i < index; i += 1) if (text.charCodeAt(i) === 10) line += 1;
  return line;
}

/**
 * Run the rules over one blob's path and text.
 *
 * Exported so the test can falsify the scanner against synthetic blobs without
 * building a git repository per case.
 */
export function scanBlob({ path: at, text }, rules, packProvenance) {
  const findings = [];
  const basename = path.basename(at);
  const exempt = SELF_FILES.has(basename);

  for (const rule of rules) {
    if (exempt) continue;
    const pattern = compileRulePattern(rule.pattern, 'g');
    const except = rule.except ? compileRulePattern(rule.except) : null;

    if (rule.kind === 'path') {
      pattern.lastIndex = 0;
      if (!pattern.test(at)) continue;
      if (except && except.test(at)) continue;
      findings.push({ rule: rule.id, kind: 'path', classification: rule.classification, line: null, match: null });
      continue;
    }

    if (rule.kind !== 'content') throw new Error(`history-scan: unknown rule kind ${JSON.stringify(rule.kind)} on ${rule.id}`);
    if (text === null) continue;
    for (const match of text.matchAll(pattern)) {
      if (except && except.test(match[0])) continue;
      findings.push({
        rule: rule.id,
        kind: 'content',
        classification: rule.classification,
        line: lineOf(text, match.index),
        match: maskMatch(match[0]),
      });
    }
  }

  // The structural pack detector, shared with check-pack-provenance.mjs.
  if (!exempt && text !== null && PACK_SCANNED_EXTENSIONS.has(path.extname(at))) {
    const pack = inspectPackText(text);
    if (pack !== null) {
      // Deduplicated per blob: `sandbox.test.ts` builds five fixtures from the
      // same id, and five identical rows is noise a human has to re-read five
      // times to confirm it is one fact. The blob is the unit that gets scrubbed.
      const ids = pack.ids.length === 0 ? ['<no literal id>'] : [...new Set(pack.ids)];
      for (const id of ids) {
        if (id !== '<no literal id>' && isAllowedPackId(id, packProvenance.allowedPrefixes)) continue;
        findings.push({
          rule: 'closed-pack-document',
          kind: 'structural',
          classification: packProvenance.classification,
          line: null,
          match: `pack id ${JSON.stringify(id)}`,
        });
      }
    }
  }

  return findings;
}

/**
 * Does an `allow` entry cover this finding?
 *
 * `path`/`blob` are core's exact-match keys. `pathPrefix` is this repository's
 * addition (see the header): one decision covering one vendored directory, so
 * that a pinned upstream engine library does not need 39 identical entries whose
 * only difference is a filename — 39 entries nobody re-reads, in which a 40th
 * saying something else would be invisible.
 *
 * A prefix allowance is still a HUMAN decision with a reason and a date, and
 * every blob it covers is reported individually with its commit hashes. It is
 * broader than an exact path and deliberately not a regex: `startsWith` on a
 * directory path cannot be made to mean something surprising by accident.
 */
function allowanceFor(allow, finding) {
  return allow.find(
    (entry) =>
      entry.rule === finding.rule &&
      (entry.path === undefined || entry.path === finding.path) &&
      (entry.pathPrefix === undefined || finding.path.startsWith(entry.pathPrefix)) &&
      (entry.blob === undefined || entry.blob === finding.blob),
  );
}

export function scanHistory(repo, rulesPath, { allObjects = false, attributeCommits = true } = {}) {
  const rules = JSON.parse(fs.readFileSync(rulesPath, 'utf8'));
  const blobs = listBlobs(repo, { allObjects });

  const skippedBinary = [];
  const skippedOversize = [];
  const raw = [];
  let textBlobs = 0;

  const wanted = blobs.filter((blob) => blob.size <= MAX_BLOB_BYTES);
  const contents = wanted.length === 0 ? new Map() : readBlobs(repo, wanted.map((blob) => blob.blob));

  for (const blob of blobs) {
    if (blob.size > MAX_BLOB_BYTES) {
      skippedOversize.push({ blob: blob.blob, path: blob.path, size: blob.size });
      continue;
    }
    const buffer = contents.get(blob.blob);
    if (buffer === undefined) continue;
    let text = null;
    if (isBinary(buffer)) {
      skippedBinary.push({ blob: blob.blob, path: blob.path, size: blob.size });
    } else {
      text = buffer.toString('utf8');
      textBlobs += 1;
    }
    for (const finding of scanBlob({ path: blob.path, text }, rules.rules, rules.packProvenance)) {
      raw.push({ ...finding, path: blob.path, blob: blob.blob });
    }
  }

  const usedAllowances = new Set();
  const findings = raw.map((finding) => {
    const allowance = allowanceFor(rules.allow ?? [], finding);
    if (allowance) usedAllowances.add(rules.allow.indexOf(allowance));
    return {
      rule: finding.rule,
      kind: finding.kind,
      // The `allow` list is where a human's keep/scrub decision lives; an
      // unallowed finding keeps the RULE's classification and stays unresolved.
      classification: allowance ? allowance.classification : finding.classification,
      resolved: Boolean(allowance),
      path: finding.path,
      blob: finding.blob,
      line: finding.line,
      match: finding.match,
      reason: allowance?.reason ?? null,
      reviewedBy: allowance?.reviewedBy ?? null,
      commits: attributeCommits ? commitsTouching(repo, finding.blob) : [],
    };
  });

  const unusedAllowances = (rules.allow ?? [])
    .filter((_, index) => !usedAllowances.has(index))
    .map((entry) => ({
      rule: entry.rule,
      path: entry.path ?? null,
      pathPrefix: entry.pathPrefix ?? null,
      blob: entry.blob ?? null,
    }));

  const scrub = findings.filter((f) => f.classification === 'scrub');
  const unresolved = findings.filter((f) => !f.resolved);

  return {
    tool: 'scripts/history-scan.mjs',
    rules: path.relative(repo, path.resolve(rulesPath)) || path.basename(rulesPath),
    rulesVersion: rules.version,
    repository: {
      head: git(repo, ['rev-parse', 'HEAD']).trim(),
      commits: Number(git(repo, ['rev-list', '--all', '--count', 'HEAD']).trim()),
      refs: git(repo, ['for-each-ref', '--format=%(refname)'])
        .split('\n')
        .filter((line) => line !== '')
        .sort(),
      scope: allObjects ? 'every object in the object database' : 'every object reachable from all refs and HEAD',
    },
    coverage: {
      blobs: blobs.length,
      textBlobs,
      skippedBinary,
      skippedOversize,
    },
    summary: {
      findings: findings.length,
      scrub: scrub.length,
      keep: findings.filter((f) => f.classification === 'keep').length,
      review: findings.filter((f) => f.classification === 'review').length,
      unresolved: unresolved.length,
      unusedAllowances: unusedAllowances.length,
    },
    unusedAllowances,
    findings,
  };
}

// ─── the scrub plan, and proving it works without running it ─────────────────

/**
 * Parse a `git filter-repo --replace-text` file.
 *
 * filter-repo's own format: one rule per line, `[literal:|regex:|glob:]<search>`
 * optionally followed by `==>` and a replacement (default `***REMOVED***`).
 * Blank lines and `#` comments are ignored.
 *
 * `glob:` is REJECTED rather than ignored. filter-repo would honour it; this
 * verifier cannot reproduce its semantics, and a rule the verifier silently
 * skips is a rule that reports covered while purging nothing.
 */
export function parseReplacements(text) {
  const rules = [];
  for (const line of text.split('\n')) {
    const trimmed = line.trim();
    if (trimmed === '' || trimmed.startsWith('#')) continue;
    const arrow = trimmed.indexOf('==>');
    const left = arrow === -1 ? trimmed : trimmed.slice(0, arrow);
    const replace = arrow === -1 ? '***REMOVED***' : trimmed.slice(arrow + 3);
    if (left.startsWith('regex:')) rules.push({ kind: 'regex', search: left.slice(6), replace });
    else if (left.startsWith('glob:')) {
      throw new Error(`history-scan: glob: replacement rules cannot be verified, use literal: or regex: — ${trimmed}`);
    } else rules.push({ kind: 'literal', search: left.startsWith('literal:') ? left.slice(8) : left, replace });
  }
  return rules;
}

/** Apply the parsed replacement rules to one blob's text, as filter-repo would. */
export function applyReplacements(text, rules) {
  let out = text;
  for (const rule of rules) {
    out =
      rule.kind === 'regex'
        ? out.replace(new RegExp(rule.search, 'g'), rule.replace)
        : out.split(rule.search).join(rule.replace);
  }
  return out;
}

/**
 * Prove the plan purges every scrub-classified finding — WITHOUT rewriting.
 *
 * For each scrub finding: if its path is slated for removal outright, it is
 * covered. Otherwise the replacement rules are applied to that blob's real
 * bytes in memory and the blob is re-scanned; the finding is covered only if it
 * is *gone from the rescan*.
 *
 * That is the difference between a scrub script and a scrub script somebody
 * believes in. "The invocation mentions the string" is not evidence — a rule
 * with a typo, a rule that matches a different casing, a finding nobody added a
 * rule for at all, all read identically until the rewrite has already happened
 * and every clone is already invalid. This runs the plan against the actual
 * content and reports what survives.
 */
export function verifyScrubPlan(repo, rulesPath, report, plan) {
  const rules = JSON.parse(fs.readFileSync(rulesPath, 'utf8'));
  const scrub = report.findings.filter((finding) => finding.classification === 'scrub');
  const contents = scrub.length === 0 ? new Map() : readBlobs(repo, [...new Set(scrub.map((f) => f.blob))]);

  const covered = [];
  const uncovered = [];
  for (const finding of scrub) {
    if (plan.removePaths.includes(finding.path)) {
      covered.push({ finding, by: `path removal: ${finding.path}` });
      continue;
    }
    const buffer = contents.get(finding.blob);
    if (buffer === undefined || isBinary(buffer)) {
      uncovered.push({ finding, why: 'blob is binary or unreadable — a text replacement cannot reach it' });
      continue;
    }
    const rewritten = applyReplacements(buffer.toString('utf8'), plan.replacements);
    const survivors = scanBlob({ path: finding.path, text: rewritten }, rules.rules, rules.packProvenance).filter(
      (candidate) => candidate.rule === finding.rule && candidate.match === finding.match,
    );
    if (survivors.length === 0) covered.push({ finding, by: 'replace-text' });
    else uncovered.push({ finding, why: 'the replacement rules do not remove this finding from the blob' });
  }
  return { scrub: scrub.length, covered, uncovered };
}

/** Read the two committed plan files; either may be absent or comments-only. */
export function readScrubPlan(dir) {
  const replacementsPath = path.join(dir, 'history-scrub.replacements.txt');
  const pathsPath = path.join(dir, 'history-scrub.paths.txt');
  const replacements = fs.existsSync(replacementsPath)
    ? parseReplacements(fs.readFileSync(replacementsPath, 'utf8'))
    : [];
  const removePaths = fs.existsSync(pathsPath)
    ? fs
        .readFileSync(pathsPath, 'utf8')
        .split('\n')
        .map((line) => line.trim())
        .filter((line) => line !== '' && !line.startsWith('#'))
    : [];
  return { replacements, removePaths, replacementsPath, pathsPath };
}

// ─── CLI ─────────────────────────────────────────────────────────────────────

const isMain = process.argv[1] && path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname);

if (isMain) {
  const argv = process.argv.slice(2);
  const options = { repo: process.cwd(), rules: null, report: null, check: false, allObjects: false, verifyScrub: false };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--repo') options.repo = argv[(i += 1)];
    else if (arg === '--rules') options.rules = argv[(i += 1)];
    else if (arg === '--report') options.report = argv[(i += 1)];
    else if (arg === '--check') options.check = true;
    else if (arg === '--all-objects') options.allObjects = true;
    else if (arg === '--verify-scrub') options.verifyScrub = true;
    else {
      console.error(`history-scan: unknown argument ${JSON.stringify(arg)}`);
      process.exit(2);
    }
  }
  const here = path.dirname(new URL(import.meta.url).pathname);
  const rulesPath = options.rules ?? path.join(here, 'history-scan.rules.json');
  const repo = path.resolve(options.repo);

  const report = scanHistory(repo, rulesPath, { allObjects: options.allObjects });

  if (options.report) {
    const target = path.resolve(options.report);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
    console.log(`history-scan: report written to ${path.relative(repo, target)}`);
  }

  const { blobs, textBlobs, skippedBinary, skippedOversize } = report.coverage;
  console.log(
    `history-scan: ${report.repository.commits} commit(s), ${blobs} blob(s) — ${textBlobs} scanned as text, ` +
      `${skippedBinary.length} binary skipped, ${skippedOversize.length} oversize skipped`,
  );
  for (const skipped of [...skippedBinary, ...skippedOversize]) {
    console.log(`  skipped: ${skipped.path} (${skipped.size} bytes, ${skipped.blob})`);
  }
  console.log(
    `history-scan: ${report.summary.findings} finding(s) — ${report.summary.scrub} scrub, ` +
      `${report.summary.keep} keep, ${report.summary.review} review, ${report.summary.unresolved} unresolved`,
  );
  for (const finding of report.findings) {
    const where = finding.line === null ? finding.path : `${finding.path}:${finding.line}`;
    console.log(
      `  [${finding.classification}${finding.resolved ? '' : ' UNRESOLVED'}] ${finding.rule} ${where} ` +
        `(${finding.blob.slice(0, 12)})${finding.match ? ` ${finding.match}` : ''}`,
    );
  }
  for (const stale of report.unusedAllowances) {
    console.error(
      `history-scan: allow entry matches nothing — ${stale.rule} ${stale.path ?? stale.pathPrefix ?? stale.blob ?? ''}`,
    );
  }

  let scrubUncovered = 0;
  if (options.verifyScrub) {
    const plan = readScrubPlan(here);
    const verdict = verifyScrubPlan(repo, rulesPath, report, plan);
    scrubUncovered = verdict.uncovered.length;
    console.log(
      `history-scan: scrub plan — ${verdict.scrub} scrub finding(s), ${verdict.covered.length} provably purged ` +
        `by ${plan.replacements.length} replacement rule(s) and ${plan.removePaths.length} path removal(s)`,
    );
    for (const { finding, by } of verdict.covered) {
      console.log(`  purged: ${finding.rule} ${finding.path} (${finding.blob.slice(0, 12)}) via ${by}`);
    }
    for (const { finding, why } of verdict.uncovered) {
      console.error(`  SURVIVES: ${finding.rule} ${finding.path} (${finding.blob.slice(0, 12)}) — ${why}`);
    }
  }

  if (options.check) {
    const failures = report.summary.unresolved + report.summary.unusedAllowances + scrubUncovered;
    if (failures > 0) {
      console.error(
        'history-scan: --check failed. Every finding must carry an `allow` entry recording a human keep/scrub ' +
          'decision, every `allow` entry must still match something, and (with --verify-scrub) every scrub-classified ' +
          'finding must be provably purged by the committed plan.',
      );
      process.exit(1);
    }
    console.log('history-scan: --check passed — every finding is classified and every allowance is live.');
  }
}
