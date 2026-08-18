#!/usr/bin/env node
// check-pack-provenance.mjs — fail if a generation pack has been committed to an
// open repository (US-4, `130-generation-vm-and-packs`).
//
//   node scripts/check-pack-provenance.mjs [root …] [--allow-prefix probe/]
//
// Exit 0 and a one-line summary, or exit 1 and every offending path.
//
// ## Why this is a script and not only a test
//
// `docs/generation-vm.md` §4.1 draws the open/closed line at **open the VM,
// close the packs**, and the pre-open content audit names committed pack content
// as the most common IP-leak vector — the one mistake that cannot be undone by a
// later commit, because the history is public the moment the repository is.
//
// The leak is not confined to this repository. US-4's acceptance criterion is
// that no pack is committed to `native/` or to any open engine repo, and those
// are separate checkouts with no vitest in them. So the check is a dependency-
// free Node script that takes a root: `packages/core` runs it over itself from
// `src/generation/__tests__/provenance.test.ts`, and `native/` vendors this file
// and runs it over its own tree from ctest. One mechanism, not four — the same
// call `docs/editor-core-adoption.md` §1.1 makes about the bridge itself.
//
// ## What counts as a pack, and why the check is STRUCTURAL
//
// A pack document is recognised by shape: a JSON object (or a JS/TS object
// literal) carrying both `pack` and `packVersion` together with a `phases` key.
// That is `parsePack`'s required skeleton, and it is what a real pack has and a
// coincidence does not.
//
// The check deliberately does NOT look for the closed constants by value. A
// deny-list of `GRID_SPACING`'s real numbers would have to CONTAIN the real
// numbers, in the open repository, which is the leak it is meant to prevent
// wearing a guard's clothes. What it enforces instead is that every pack in an
// open tree declares itself a probe: an id starting with an allowed prefix
// (`probe/` by default). A closed pack is named for the product it belongs to,
// so renaming one to `probe/…` to get past this check is not a slip anybody makes
// by accident.
//
// ## What it cannot see
//
// A pack that has been base64'd, split across files, or built by a function whose
// literal id is a variable. Nor a document that carries real tables under the
// EMPTY id, which is the one carve-out below. This is a guard against the
// accident — a fixture pasted from the closed repo, a corpus regenerated against
// the real tables — not against someone who has decided to leak. Say so rather
// than implying otherwise.

import fs from 'node:fs';
import path from 'node:path';

const SKIP_DIRECTORIES = new Set([
  '.git',
  'node_modules',
  'dist',
  'build',
  'out',
  'target',
  '.venv',
  '__pycache__',
]);

const SCANNED_EXTENSIONS = new Set(['.json', '.jsonc', '.ts', '.js', '.mjs', '.cjs', '.md']);

/**
 * Files exempt from the scan, by basename: the ones whose SUBJECT is the check.
 * Kept tiny and by exact name — a glob here would be a hole.
 *
 * `history-scan.test.ts` and `open-boundary.test.ts` are here for exactly the
 * reason `provenance.test.ts` is: each falsifies this same detector (via
 * `inspectPackText`) as part of a wider pre-open audit, and a test that a
 * known-bad pack document is caught has to contain a known-bad pack document.
 *
 * The set is consumed by `history-scan.mjs` too, so a name added here is exempt
 * in HISTORY as well as in the working tree. That is deliberate and it is the
 * only reason this list may grow: a fixture committed today becomes a blob the
 * history audit reads forever.
 */
const SELF = new Set([
  'check-pack-provenance.mjs',
  'provenance.test.ts',
  'history-scan.test.ts',
  'open-boundary.test.ts',
]);

/**
 * A pack's skeleton, as `parsePack` requires it — and each marker demands a
 * LITERAL value, not merely the key name.
 *
 * That distinction is the whole difference between a scanner and a nuisance:
 * `pack.ts`, `vm.ts` and `bridge.ts` all write `pack: pack.pack` and
 * `phases: pack.phases.map(…)`, because they are the code that *implements* the
 * schema. Demanding a literal `packVersion` and a literal `phases` array
 * excludes every one of them and still matches any document a pack could
 * actually be written as, in JSON, JSONC, TypeScript, or a fenced block in a
 * Markdown file.
 *
 * `pack` is matched by KEY only, deliberately. A document whose id has been
 * replaced by an identifier — `{ pack: PACK_ID, packVersion: "3", phases: […] }`
 * — is what the accident looks like after somebody has tried to tidy it up, and
 * that is the version most worth catching. It is reported below under the id
 * `<no literal id>`.
 */
const PACK_MARKERS = [
  /(["'])?pack\1?\s*:/,
  /(["'])?packVersion\1?\s*:\s*["']/,
  /(["'])?phases\1?\s*:\s*\[/,
];

/** Every `pack: "<id>"` / `"pack": "<id>"` literal in a source or document. */
const PACK_ID = /(["'])?pack\1?\s*:\s*(["'])([^"']*)\2/g;

function* walk(root) {
  const stack = [root];
  while (stack.length > 0) {
    const current = stack.pop();
    let entries;
    try {
      entries = fs.readdirSync(current, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) {
        if (!SKIP_DIRECTORIES.has(entry.name)) stack.push(full);
        continue;
      }
      if (!entry.isFile()) continue;
      if (SELF.has(entry.name)) continue;
      if (!SCANNED_EXTENSIONS.has(path.extname(entry.name))) continue;
      yield full;
    }
  }
}

/**
 * The detector, over TEXT rather than a file.
 *
 * Returns `null` for a document that is not pack-shaped, or `{ ids }` — every
 * `pack: "<literal>"` in it — for one that is. `ids` may be empty: that is the
 * find-and-replaced pack the header describes, and callers report it under
 * `<no literal id>`.
 *
 * Split out of `checkPackProvenance` so the pre-open history scan
 * (`scripts/history-scan.mjs`) can run the SAME detector over historical blobs,
 * which have no path on disk to read. One detector, two traversals — a second
 * copy of `PACK_MARKERS` would drift, and the half that drifted would be the one
 * looking at history, where a miss is permanent.
 */
export function inspectPackText(text) {
  if (!PACK_MARKERS.every((marker) => marker.test(text))) return null;
  return { ids: [...text.matchAll(PACK_ID)].map((match) => match[3]) };
}

/**
 * Is this pack id one an open tree may carry?
 *
 * The empty id is the one `requireString` refuses, so a document carrying it is
 * not a pack anybody can load. It exists in `pack.test.ts` as the negative
 * fixture for exactly that rejection, and forcing it to be `probe/`-prefixed
 * would change what that test asserts. Narrow, and deliberately not a wildcard —
 * see "What it cannot see" above.
 */
export function isAllowedPackId(id, allowedPrefixes) {
  if (id === '') return true;
  return allowedPrefixes.some((prefix) => id.startsWith(prefix));
}

/** Basenames whose SUBJECT is this check, and so are exempt from it. */
export const PROVENANCE_SELF_FILES = SELF;

/** Extensions the pack detector is worth running over. */
export const PACK_SCANNED_EXTENSIONS = SCANNED_EXTENSIONS;

/**
 * Scan one tree.
 *
 * Returns `{ scanned, packFiles, violations }`. `packFiles` is every file that
 * looks like it contains a pack document; `violations` is every pack id in them
 * that does not start with an allowed prefix. A file with the skeleton but no
 * `pack: "<literal>"` at all is a violation too, under the id `<no literal id>`:
 * an unnameable pack is exactly what a leak looks like after a find-and-replace.
 */
export function checkPackProvenance(root, allowedPrefixes = ['probe/']) {
  const packFiles = [];
  const violations = [];
  let scanned = 0;

  for (const file of walk(root)) {
    scanned += 1;
    let text;
    try {
      text = fs.readFileSync(file, 'utf8');
    } catch {
      continue;
    }
    const pack = inspectPackText(text);
    if (pack === null) continue;

    const relative = path.relative(root, file) || path.basename(file);
    packFiles.push(relative);

    if (pack.ids.length === 0) {
      violations.push({ file: relative, id: '<no literal id>' });
      continue;
    }
    for (const id of pack.ids) {
      if (!isAllowedPackId(id, allowedPrefixes)) {
        violations.push({ file: relative, id });
      }
    }
  }

  return { scanned, packFiles: packFiles.sort(), violations };
}

// ─── CLI ─────────────────────────────────────────────────────────────────────

const isMain = process.argv[1] && path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname);

if (isMain) {
  const argv = process.argv.slice(2);
  const roots = [];
  const prefixes = [];
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--allow-prefix') {
      prefixes.push(argv[i + 1]);
      i += 1;
    } else {
      roots.push(argv[i]);
    }
  }
  if (roots.length === 0) roots.push(process.cwd());
  if (prefixes.length === 0) prefixes.push('probe/');

  let failed = false;
  for (const root of roots) {
    const result = checkPackProvenance(path.resolve(root), prefixes);
    if (result.violations.length > 0) {
      failed = true;
      console.error(
        `check-pack-provenance: ${result.violations.length} pack document(s) in ${root} are not ` +
          `probes. A generation pack is the CLOSED asset (docs/generation-vm.md §4.1) and must ` +
          `never be committed to an open repository:`,
      );
      for (const violation of result.violations) {
        console.error(`  ${violation.file}: pack id ${JSON.stringify(violation.id)}`);
      }
    } else {
      console.log(
        `check-pack-provenance: ${root} — ${result.scanned} file(s) scanned, ` +
          `${result.packFiles.length} pack document(s), all ${prefixes.join('/')} probes`,
      );
    }
  }
  process.exit(failed ? 1 : 0);
}
