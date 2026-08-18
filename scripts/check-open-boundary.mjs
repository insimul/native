#!/usr/bin/env node
// check-open-boundary.mjs — the pre-open CONTENT + DEPENDENCY audit, as a gate
// (US-2, `242-pre-open-native`).
//
//   node scripts/check-open-boundary.mjs [root …]
//                                        [--rules scripts/open-boundary.rules.json]
//                                        [--report docs/pre-open/open-boundary.json]
//                                        [--print]
//
// `docs/explanation/OPEN_SOURCE_STRATEGY.md`'s pre-open checklist asks two
// separate questions of every repo about to go public, and this script answers
// both over a working tree:
//
//   Content audit     — "no closed genre/language packs or generation heuristics
//                        are vendored into an open repo; only contract-level base
//                        predicates ship."
//   Dependency audit  — "no `insimul-backend` / `insimul-web` imports in any open
//                        repo (enforce with a CI check, cf. the cross-submodule-
//                        import ban)."
//
// ## Where this came from, and how it DIVERGES
//
// `insimul/core`@`b37837b` (tasklist 241) went first and wrote the method; this
// file is DERIVED from its `scripts/check-open-boundary.mjs` and keeps its
// structure, its rule names and its arguments so the two repositories' gates
// stay directly comparable. A second audit tool is a second thing to keep
// correct, and the half nobody re-reads is the half that reports clean.
//
// Four deliberate divergences, because core is one npm package and this is a
// CMake/C tree with four dependency surfaces:
//
//   1. **There is no `package.json`.** Core closes its import graph with
//      "every bare specifier must be a Node builtin or a declared dependency".
//      Here the declared set is EMPTY — nothing in this repository is installed
//      from npm — which makes the same rule STRICTER, not weaker: any bare
//      specifier at all is a finding a human must classify.
//   2. **Three more surfaces.** Rust (`Cargo.toml` dependency tables), C
//      (`#include "…"`), and the build itself (a CMake or shell fetch). For a C
//      tree "nothing else is reachable" is not a claim about imports alone: a
//      dependency the BUILD downloads is a dependency nobody declared. See
//      `auditOpenBoundary` for what each surface contributes to the closure.
//   3. **The walk is `git ls-files`, not the filesystem.** What `git clone`
//      publishes is the tracked set, and this tree grows `build/`, `build-wasm/`,
//      `dist/` and `rust/target/` during an ordinary gate run. A skip-list drifts
//      behind those; the index does not. Falls back to a filesystem walk with
//      core's skip list when the root is not a git repository.
//   4. **No `SELF_FILES` exemption of its own.** Core exempts its own test by
//      basename because a test that a forbidden import is caught must contain
//      one. `tests/open_boundary_selftest.mjs` assembles every forbidden
//      specifier by concatenation instead, so it needs no exemption — the same
//      call `tests/history_scan_selftest.mjs` made in US-1, and for the same
//      reason: an exemption is permanent and a `+` is not. The pack detector's
//      OWN `PROVENANCE_SELF_FILES` still applies, because it comes with the
//      detector rather than being added here.
//
// ## Why it ALWAYS enforces, with no `--check` flag
//
// `history-scan.mjs` has a `--check` flag because its default job is to write a
// findings report a human reads. This script's only job is to be a gate, and a
// gate with an opt-in enforcement flag is one forgotten argument away from a
// green CI job that checks nothing. Any unresolved finding exits non-zero,
// always. `--report` writes the JSON in addition.
//
// ## What it cannot see
//
// A closed pack whose declaring skeleton was altered, or whose ids were stripped
// (`check-pack-provenance.mjs` explains why a value-based deny-list would be the
// leak wearing a guard's clothes). A dependency reached at runtime through a
// string built at runtime. A curated table pasted into a source file as plain
// constants under an innocent name — no structural detector can tell tuned
// numbers from computed ones. Anything inside the one binary this repository can
// produce but does not commit. And an untracked file: it is not scanned because
// it is not published, which is the right answer for a gate and the wrong one
// for a human about to run `git add -A`.
//
// This is a guard against the accident, not against someone who has decided to
// leak. A clean run is evidence, not proof, and the audit record says so.

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import { builtinModules } from 'node:module';
import path from 'node:path';

import {
  inspectPackText,
  isAllowedPackId,
  PACK_SCANNED_EXTENSIONS,
  PROVENANCE_SELF_FILES,
} from './check-pack-provenance.mjs';

/** Directories never walked by the filesystem fallback. Mirrors core's. */
const SKIP_DIRECTORIES = new Set([
  '.git',
  'node_modules',
  'dist',
  'out',
  'target',
  '.venv',
  '__pycache__',
]);

/** Extensions whose JavaScript import graph is read. */
const CODE_EXTENSIONS = new Set(['.ts', '.tsx', '.mts', '.cts', '.js', '.mjs', '.cjs']);

/** Extensions whose `#include` graph is read. */
const C_EXTENSIONS = new Set(['.c', '.h', '.cpp', '.cc', '.cxx', '.hpp', '.hh']);

/** Files whose lines are read for a build-time fetch. */
const BUILD_EXTENSIONS = new Set(['.sh', '.cmake', '.bash']);

const NODE_BUILTINS = new Set([
  ...builtinModules,
  ...builtinModules.map((name) => `node:${name}`),
]);

// ─── walking ─────────────────────────────────────────────────────────────────

/**
 * Every file this repository would publish, repo-relative and forward-slashed.
 *
 * `git ls-files` when `root` is a git repository, because the tracked set is
 * exactly what `git clone` hands a stranger — and because this tree grows
 * `build/`, `build-wasm/` and `rust/target/` during a gate run, which a
 * hand-maintained skip list will always be one build directory behind.
 * Filesystem walk otherwise, so the script still works over an unpacked tarball
 * or a synthetic fixture.
 */
export function listFiles(root) {
  const git = spawnSync('git', ['-C', root, 'ls-files', '-z', '--cached'], {
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  });
  if (git.status === 0) {
    const tracked = git.stdout.split('\0').filter((entry) => entry.length > 0);
    // A tracked path may be a deleted-but-staged file or a submodule gitlink.
    return tracked.filter((rel) => {
      try {
        return fs.statSync(path.join(root, rel)).isFile();
      } catch {
        return false;
      }
    }).sort();
  }
  return [...walkFiles(root)].sort();
}

/** Filesystem fallback: every file under `root`, skipping `SKIP_DIRECTORIES`. */
export function* walkFiles(root) {
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
        if (!SKIP_DIRECTORIES.has(entry.name) && !/^build(-|$)/.test(entry.name)) stack.push(full);
        continue;
      }
      if (!entry.isFile()) continue;
      yield path.relative(root, full).split(path.sep).join('/');
    }
  }
}

// ─── the JavaScript import parser ────────────────────────────────────────────

/**
 * Import specifiers in a source file, with line numbers. Core's parser, kept
 * byte-comparable on purpose.
 *
 * Deliberately line-anchored rather than a real parse. A static `import`/`export
 * … from` clause must begin its own line (or continue one that began with `{`),
 * so anchoring excludes the thing that actually produces false positives: doc
 * comments that quote an import statement.
 *
 * `require(…)` and dynamic `import(…)` are matched anywhere on a line, because
 * they are expressions and have no anchor — except on a line that is *only* a
 * comment. A comment is not an import, and the alternative — rewording prose to
 * appease a regex — is how a scanner starts quietly shaping the code it audits.
 */
export function parseImportSpecifiers(text) {
  const found = [];
  const lines = text.split('\n');
  const statics = [
    /^[ \t]*(?:import|export)\b.*?\bfrom\s*(['"])([^'"]+)\1/,
    /^[ \t]*\}\s*from\s*(['"])([^'"]+)\1/,
    /^[ \t]*import\s*(['"])([^'"]+)\1/,
  ];
  const dynamics = [
    /\brequire\(\s*(['"])([^'"]+)\1\s*\)/g,
    /(?<![.\w$])import\(\s*(['"])([^'"]+)\1\s*\)/g,
  ];

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    for (const pattern of statics) {
      const match = pattern.exec(line);
      if (match) {
        found.push({ specifier: match[2], line: i + 1, kind: 'static' });
        break;
      }
    }
    if (isCommentOnlyLine(line)) continue;
    for (const pattern of dynamics) {
      pattern.lastIndex = 0;
      let match;
      while ((match = pattern.exec(line)) !== null) {
        found.push({ specifier: match[2], line: i + 1, kind: 'dynamic' });
      }
    }
  }
  return found;
}

/**
 * A line that carries nothing but a comment: `//`, `/*`, a JSDoc `*`, or — this
 * repository's addition — a `#` comment, which is what CMake and shell use.
 */
export function isCommentOnlyLine(line) {
  const trimmed = line.trimStart();
  return (
    trimmed.startsWith('//') ||
    trimmed.startsWith('*') ||
    trimmed.startsWith('/*') ||
    trimmed.startsWith('#') ||
    trimmed.startsWith('dnl ')
  );
}

/** The package a bare specifier belongs to: `@scope/pkg/sub` → `@scope/pkg`. */
export function packageOfSpecifier(specifier) {
  const parts = specifier.split('/');
  return specifier.startsWith('@') ? parts.slice(0, 2).join('/') : parts[0];
}

/**
 * Does a deny-list entry cover this package?
 *
 * A bare `@scope` entry covers the whole scope. Core learned this the hard way
 * in its own rehearsal: `@shared/*` is a tsconfig alias, so every
 * `@shared/schema` is its own "package" by npm's naming rule and an entry
 * reading `@shared` would match none of them. A rule that fires with the wrong
 * reason is a rule nobody will trust the next time it fires.
 */
export function matchesDenyEntry(entryPackage, pkg) {
  if (entryPackage === pkg) return true;
  const isBareScope = entryPackage.startsWith('@') && !entryPackage.includes('/');
  return isBareScope && pkg.startsWith(`${entryPackage}/`);
}

/** Classify one JavaScript import specifier, or `null` if it is fine. */
export function classifySpecifier(specifier, context) {
  const { root, file, declared, closedRepoPackages, runtimeBackEdges } = context;

  if (specifier.startsWith('.')) {
    const resolved = path.resolve(path.dirname(path.join(root, file)), specifier);
    const relative = path.relative(root, resolved);
    if (relative.startsWith('..')) {
      return {
        rule: 'escaping-relative-import',
        detail: `resolves to ${relative}, outside the repository root`,
      };
    }
    return null;
  }

  if (path.posix.isAbsolute(specifier)) {
    return {
      rule: 'absolute-path-import',
      detail: 'a filesystem-root specifier resolves outside the repository on every machine',
    };
  }

  const pkg = packageOfSpecifier(specifier);

  if (NODE_BUILTINS.has(specifier) || NODE_BUILTINS.has(pkg)) return null;

  const closed = closedRepoPackages.find((entry) => matchesDenyEntry(entry.package, pkg));
  if (closed) return { rule: 'closed-repo-import', detail: closed.reason };

  const backEdge = runtimeBackEdges.find((entry) => matchesDenyEntry(entry.package, pkg));
  if (backEdge) return { rule: 'runtime-back-edge', detail: backEdge.reason };

  if (declared.has(pkg)) return null;

  return {
    rule: 'undeclared-dependency',
    detail:
      `"${pkg}" is not a Node builtin, and this repository declares no npm ` +
      `dependencies at all (there is no package.json), so it is not on the path ` +
      `a standalone clone can resolve`,
  };
}

// ─── the Rust dependency parser ──────────────────────────────────────────────

/**
 * Dependency entries in a `Cargo.toml`, with line numbers.
 *
 * A hand-rolled TOML section reader rather than a parser dependency, because
 * this repository has no dependency-installing step and the audit tool must not
 * introduce the first one. It reads exactly what cargo would call a dependency
 * table: `[dependencies]`, `[dev-dependencies]`, `[build-dependencies]`, their
 * `[workspace.…]` and `[target.'cfg(…)'.…]` spellings, and the sub-table form
 * `[dependencies.serde]`.
 *
 * Rust's own resolver is what makes this the whole surface. A `use` statement
 * can only name `std`, this crate, or a crate declared here — an undeclared one
 * does not compile — so the manifest IS the graph, and there is no need to read
 * every `.rs` file for the answer.
 */
export function parseCargoDependencies(text) {
  const deps = [];
  const lines = text.split('\n');
  let table = null;
  let subTableName = null;
  const isDepTable = (name) => /(^|\.)(dependencies|dev-dependencies|build-dependencies)$/.test(name);

  for (let i = 0; i < lines.length; i += 1) {
    const raw = lines[i];
    const line = raw.split('#')[0].trim();
    const header = /^\[\s*([^\]]+?)\s*\]$/.exec(line);
    if (header) {
      const name = header[1];
      const sub = /^(.*(?:dependencies))\.([A-Za-z0-9_-]+)$/.exec(name);
      if (sub && isDepTable(sub[1])) {
        table = sub[1];
        subTableName = sub[2];
        deps.push({ name: sub[2], spec: '', line: i + 1, table });
      } else {
        table = isDepTable(name) ? name : null;
        subTableName = null;
      }
      continue;
    }
    if (table === null || line === '') continue;
    if (subTableName !== null) {
      // Body of a `[dependencies.foo]` sub-table: fold its keys into the entry.
      const entry = deps[deps.length - 1];
      entry.spec += `${line} `;
      continue;
    }
    const assignment = /^([A-Za-z0-9_-]+)\s*=\s*(.*)$/.exec(line);
    if (!assignment) continue;
    deps.push({ name: assignment[1], spec: assignment[2].trim(), line: i + 1, table });
  }
  return deps;
}

/** Classify one Rust dependency, or `null` if it is fine. */
export function classifyCrate(dep, context) {
  const { root, file, allowedCrates, closedRepoPackages, runtimeBackEdges } = context;

  const closed = closedRepoPackages.find((entry) => matchesDenyEntry(entry.package, dep.name));
  if (closed) return { rule: 'closed-repo-import', detail: closed.reason };
  const backEdge = runtimeBackEdges.find((entry) => matchesDenyEntry(entry.package, dep.name));
  if (backEdge) return { rule: 'runtime-back-edge', detail: backEdge.reason };

  if (/\bgit\s*=/.test(dep.spec)) {
    return {
      rule: 'git-dependency',
      detail:
        'a crate fetched from a git URL at build time — an input that is neither ' +
        'committed here nor pinned by a registry checksum',
    };
  }

  const pathSpec = /\bpath\s*=\s*["']([^"']+)["']/.exec(dep.spec);
  if (pathSpec) {
    const manifestDir = path.dirname(path.join(root, file));
    const resolved = path.resolve(manifestDir, pathSpec[1]);
    const relative = path.relative(root, resolved);
    if (relative.startsWith('..')) {
      return {
        rule: 'escaping-path-dependency',
        detail: `path dependency resolves to ${relative}, outside the repository root`,
      };
    }
    return null;
  }

  if (allowedCrates.some((entry) => entry.crate === dep.name)) return null;

  return {
    rule: 'undeclared-crate',
    detail:
      `"${dep.name}" is a registry crate that no entry in the rules' allowedCrates ` +
      `list has been read and classified. Every third-party crate on the path of a ` +
      `shipped artifact is a human decision, not a lockfile's`,
  };
}

// ─── the C include parser ────────────────────────────────────────────────────

/** `#include` directives in a C/C++ source, with line numbers. */
export function parseIncludes(text) {
  const found = [];
  const lines = text.split('\n');
  const quoted = /^[ \t]*#[ \t]*include[ \t]*"([^"]+)"/;
  const angled = /^[ \t]*#[ \t]*include[ \t]*<([^>]+)>/;
  for (let i = 0; i < lines.length; i += 1) {
    const q = quoted.exec(lines[i]);
    if (q) {
      found.push({ header: q[1], line: i + 1, kind: 'quoted' });
      continue;
    }
    const a = angled.exec(lines[i]);
    if (a) found.push({ header: a[1], line: i + 1, kind: 'angled' });
  }
  return found;
}

/**
 * Classify one `#include`, or `null` if it is fine.
 *
 * The C surface's failure mode is not a closed-repo import — there is no C in
 * `insimul-backend` to import. It is a header reached by walking OUT of the
 * repository (`#include "../../platform/…"`, or an absolute path), which
 * compiles on the machine that wrote it and on no other.
 *
 * The test is therefore "does it escape the REPOSITORY", not "does it contain
 * `..`". The first draft of this rule asked the second question and reported
 * seven findings, every one of them upstream isocline writing
 * `#include "../include/isocline.h"` from `src/` — a walk that stays comfortably
 * inside the vendored engine. A rule that fires on correct code gets an
 * allowance written for it, and an allowance is a hole; the rule was wrong, not
 * the code.
 *
 * An angled include is resolved the same way when it is relative, because
 * `<../foo.h>` is a relative walk wearing a system header's clothes; a bare
 * `<stdio.h>` resolves to no file here and is left to the compiler's search
 * path, which CMake sets from in-tree directories.
 */
export function classifyInclude(include, context) {
  const { root, file } = context;
  const target = include.header;
  if (path.posix.isAbsolute(target)) {
    return {
      rule: 'absolute-path-import',
      detail: 'an absolute #include resolves outside the repository on every machine',
    };
  }
  if (!target.split('/').includes('..')) return null;
  const resolved = path.resolve(path.dirname(path.join(root, file)), target);
  const relative = path.relative(root, resolved);
  if (relative.startsWith('..')) {
    return {
      rule: 'escaping-c-include',
      detail: `an #include that resolves to ${relative}, outside the repository root`,
    };
  }
  return null;
}

// ─── content rules ───────────────────────────────────────────────────────────

/** Compile a rule's pattern, translating a leading `(?i)` into the `i` flag. */
export function compileContentPattern(pattern) {
  if (pattern.startsWith('(?i)')) return new RegExp(pattern.slice(4), 'i');
  if (pattern.includes('(?i)')) {
    throw new Error(`(?i) is only supported at the start of a pattern: ${pattern}`);
  }
  return new RegExp(pattern);
}

/**
 * Every line of `text` matching `regex`, skipping comment-only lines.
 *
 * The skip is core's lesson, paid for in its own rehearsal: run over its own
 * source, its scanner flagged the sentence that *explains* an allowance. The fix
 * is to stop reading comments, not to reword the prose — `CMakeLists.txt` line 90
 * of this repository says "there is no FetchContent here on purpose", and a
 * scanner that makes us delete that sentence has made the tree worse.
 */
export function matchingLines(text, regex) {
  const hits = [];
  const lines = text.split('\n');
  for (let i = 0; i < lines.length; i += 1) {
    if (isCommentOnlyLine(lines[i])) continue;
    regex.lastIndex = 0;
    const match = regex.exec(lines[i]);
    if (match) hits.push({ line: i + 1, text: match[0].trim().slice(0, 120) });
  }
  return hits;
}

// ─── the audit ───────────────────────────────────────────────────────────────

/**
 * Run both audits over `root`.
 *
 * Findings are NOT decided here. Each is matched against the rules' `allow`
 * list, which is where a human's keep/remove classification and its reasoning
 * live; a finding with no allowance comes back `resolved: false` and fails the
 * gate. Scanners that classify their own findings drift toward whatever keeps
 * the build green — the same argument `history-scan.mjs` makes.
 *
 * The four dependency surfaces are one result because the acceptance criterion
 * is one sentence: nothing from a closed repo is imported "or reachable". What
 * makes that a claim rather than a hope here:
 *
 *   JavaScript — every bare specifier is a Node builtin (this repository
 *                declares no npm dependency), or a human has classified it.
 *   Rust       — every dependency is an in-tree path dependency or one of the
 *                registry crates the rules name; cargo refuses a `use` of
 *                anything else, so the manifests are the whole graph.
 *   C          — every `#include` resolves inside the tree or to a system
 *                header; none walks out.
 *   The build  — nothing is fetched at build time, so the bytes compiled are the
 *                bytes committed.
 */
export function auditOpenBoundary(root, rules) {
  const contentRules = (rules.contentRules ?? []).map((rule) => ({
    ...rule,
    regex: compileContentPattern(rule.pattern),
    exceptRegex: rule.except ? compileContentPattern(rule.except) : null,
  }));
  const fetchRules = (rules.buildFetchRules ?? []).map((rule) => ({
    ...rule,
    regex: compileContentPattern(rule.pattern),
  }));
  const declared = new Set(rules.declaredNpmDependencies ?? []);
  const allowedPrefixes = rules.packProvenance?.allowedPrefixes ?? ['probe/'];

  const contentFindings = [];
  const dependencyFindings = [];
  const coverage = {
    files: 0,
    packScanned: 0,
    packDocuments: [],
    importFiles: 0,
    importSpecifiers: 0,
    cargoManifests: 0,
    cargoDependencies: 0,
    cFiles: 0,
    cIncludes: 0,
    buildFiles: 0,
  };

  for (const relative of listFiles(root)) {
    coverage.files += 1;
    const extension = path.extname(relative);
    const basename = path.posix.basename(relative);

    for (const rule of contentRules) {
      if (!rule.regex.test(relative)) continue;
      if (rule.exceptRegex?.test(relative)) continue;
      contentFindings.push({
        rule: rule.id,
        kind: 'path',
        classification: rule.classification,
        path: relative,
        detail: rule.description,
      });
    }

    const isCode = CODE_EXTENSIONS.has(extension);
    const isC = C_EXTENSIONS.has(extension);
    const isCargo = basename === 'Cargo.toml';
    const isBuild = BUILD_EXTENSIONS.has(extension) || basename === 'CMakeLists.txt';
    const isPackCandidate = PACK_SCANNED_EXTENSIONS.has(extension);
    if (!isCode && !isC && !isCargo && !isBuild && !isPackCandidate) continue;

    let text;
    try {
      text = fs.readFileSync(path.join(root, relative), 'utf8');
    } catch {
      continue;
    }

    // The pack detector is not reimplemented: `inspectPackText` is the same
    // function `check-pack-provenance.mjs` and the US-1 history scan both use.
    // The detector's own basename exemptions come WITH the detector: reaching
    // for `inspectPackText` instead of `checkPackProvenance`'s walker must not
    // silently drop them. `check-pack-provenance.mjs` is on that list because its
    // header quotes a pack skeleton to explain what it matches — the same shape
    // US-1 hit in its own fixtures. This is the one exemption here, it is not
    // this file's, and every name on it is a file whose SUBJECT is the check.
    if (isPackCandidate && !PROVENANCE_SELF_FILES.has(basename)) {
      coverage.packScanned += 1;
      const pack = inspectPackText(text);
      if (pack !== null) {
        coverage.packDocuments.push(relative);
        const ids = pack.ids.length > 0 ? pack.ids : ['<no literal id>'];
        for (const id of ids) {
          if (pack.ids.length > 0 && isAllowedPackId(id, allowedPrefixes)) continue;
          contentFindings.push({
            rule: 'closed-pack-document',
            kind: 'structural',
            classification: 'remove',
            path: relative,
            packId: id,
            detail:
              'a pack document whose id declares no allowed probe prefix — the ' +
              'CLOSED asset (OPEN_SOURCE_STRATEGY.md, "The content boundary")',
          });
        }
      }
    }

    if (isCode) {
      const specifiers = parseImportSpecifiers(text);
      if (specifiers.length > 0) coverage.importFiles += 1;
      coverage.importSpecifiers += specifiers.length;
      for (const { specifier, line } of specifiers) {
        const violation = classifySpecifier(specifier, {
          root,
          file: relative,
          declared,
          closedRepoPackages: rules.closedRepoPackages ?? [],
          runtimeBackEdges: rules.runtimeBackEdges ?? [],
        });
        if (violation === null) continue;
        dependencyFindings.push({
          rule: violation.rule,
          kind: 'import',
          classification: 'remove',
          path: relative,
          line,
          specifier,
          detail: violation.detail,
        });
      }
    }

    if (isCargo) {
      coverage.cargoManifests += 1;
      const deps = parseCargoDependencies(text);
      coverage.cargoDependencies += deps.length;
      for (const dep of deps) {
        const violation = classifyCrate(dep, {
          root,
          file: relative,
          allowedCrates: rules.allowedCrates ?? [],
          closedRepoPackages: rules.closedRepoPackages ?? [],
          runtimeBackEdges: rules.runtimeBackEdges ?? [],
        });
        if (violation === null) continue;
        dependencyFindings.push({
          rule: violation.rule,
          kind: 'crate',
          classification: 'remove',
          path: relative,
          line: dep.line,
          specifier: dep.name,
          detail: violation.detail,
        });
      }
    }

    if (isC) {
      coverage.cFiles += 1;
      const includes = parseIncludes(text);
      coverage.cIncludes += includes.length;
      for (const include of includes) {
        const violation = classifyInclude(include, { root, file: relative });
        if (violation === null) continue;
        dependencyFindings.push({
          rule: violation.rule,
          kind: 'include',
          classification: 'remove',
          path: relative,
          line: include.line,
          specifier: include.header,
          detail: violation.detail,
        });
      }
    }

    if (isBuild) {
      coverage.buildFiles += 1;
      for (const rule of fetchRules) {
        for (const hit of matchingLines(text, rule.regex)) {
          dependencyFindings.push({
            rule: rule.id,
            kind: 'fetch',
            classification: rule.classification,
            path: relative,
            line: hit.line,
            detail: rule.description,
            match: hit.text,
          });
        }
      }
    }
  }

  const allowances = rules.allow ?? [];
  const used = new Set();
  // An allowance matches on (rule, path or pathPrefix), and on `specifier` too
  // when it names one. Path alone is too coarse for an import finding: allowing
  // one undeclared specifier in a file would silently allow every other one
  // anybody ever adds to it. A `pathPrefix` allowance — this repository's
  // addition, as in history-scan.rules.json — covers a whole vendored directory
  // while leaving every file in it VISIBLE in the report.
  const resolve = (finding) => {
    const index = allowances.findIndex(
      (entry) =>
        entry.rule === finding.rule &&
        (entry.path !== undefined
          ? entry.path === finding.path
          : entry.pathPrefix !== undefined && finding.path.startsWith(entry.pathPrefix)) &&
        (entry.specifier === undefined || entry.specifier === finding.specifier),
    );
    if (index === -1) return { ...finding, resolved: false };
    used.add(index);
    const entry = allowances[index];
    return {
      ...finding,
      classification: entry.classification,
      resolved: entry.classification === 'keep',
      reason: entry.reason,
      reviewedBy: entry.reviewedBy,
      reviewedAt: entry.reviewedAt,
      ...(entry.owner ? { owner: entry.owner } : {}),
    };
  };

  const content = contentFindings.map(resolve).sort(byPath);
  const dependency = dependencyFindings.map(resolve).sort(byPath);
  const unusedAllowances = allowances
    .map((entry, index) => (used.has(index) ? null : entry))
    .filter(Boolean);

  coverage.packDocuments.sort();

  return {
    coverage,
    content,
    dependency,
    unusedAllowances,
    summary: {
      content: {
        findings: content.length,
        unresolved: content.filter((f) => !f.resolved).length,
      },
      dependency: {
        findings: dependency.length,
        unresolved: dependency.filter((f) => !f.resolved).length,
      },
      unusedAllowances: unusedAllowances.length,
    },
  };
}

function byPath(a, b) {
  return a.path.localeCompare(b.path) || (a.line ?? 0) - (b.line ?? 0);
}

/** Every finding the gate refuses to pass. */
export function unresolvedFindings(result) {
  return [...result.content, ...result.dependency].filter((finding) => !finding.resolved);
}

// ─── CLI ─────────────────────────────────────────────────────────────────────

const isMain =
  process.argv[1] &&
  path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname);

if (isMain) {
  const argv = process.argv.slice(2);
  const roots = [];
  let rulesPath = null;
  let reportPath = null;
  let print = false;
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--rules') rulesPath = argv[(i += 1)];
    else if (argv[i] === '--report') reportPath = argv[(i += 1)];
    else if (argv[i] === '--print') print = true;
    else roots.push(argv[i]);
  }
  if (roots.length === 0) roots.push(process.cwd());
  if (rulesPath === null) {
    rulesPath = path.join(
      path.dirname(new URL(import.meta.url).pathname),
      'open-boundary.rules.json',
    );
  }

  const rules = JSON.parse(fs.readFileSync(rulesPath, 'utf8'));
  let failed = false;

  for (const rawRoot of roots) {
    const root = path.resolve(rawRoot);
    const result = auditOpenBoundary(root, rules);
    const unresolved = unresolvedFindings(result);

    if (print) {
      for (const finding of [...result.content, ...result.dependency]) {
        const where = finding.line ? `${finding.path}:${finding.line}` : finding.path;
        console.log(`  [${finding.classification}] ${finding.rule} ${where}`);
      }
    }

    if (unresolved.length > 0) {
      failed = true;
      console.error(
        `check-open-boundary: ${unresolved.length} unresolved finding(s) in ${rawRoot}. ` +
          `OPEN_SOURCE_STRATEGY.md's content + dependency audits must hold before this ` +
          `repository goes public:`,
      );
      for (const finding of unresolved) {
        const where = finding.line ? `${finding.path}:${finding.line}` : finding.path;
        const what = finding.specifier
          ? ` — ${JSON.stringify(finding.specifier)}`
          : finding.packId
            ? ` — pack id ${JSON.stringify(finding.packId)}`
            : '';
        console.error(`  ${finding.rule}: ${where}${what}`);
        console.error(`    ${finding.detail}`);
      }
    } else {
      const c = result.coverage;
      console.log(
        `check-open-boundary: ${rawRoot} — ${c.files} tracked file(s); ` +
          `${c.importSpecifiers} import specifier(s) across ${c.importFiles} file(s), ` +
          `${c.cargoDependencies} cargo dependenc(ies) in ${c.cargoManifests} manifest(s), ` +
          `${c.cIncludes} #include(s) across ${c.cFiles} file(s), ` +
          `${c.buildFiles} build file(s), ${c.packDocuments.length} pack document(s); ` +
          `content ${result.summary.content.findings} finding(s), ` +
          `dependency ${result.summary.dependency.findings} finding(s), all classified`,
      );
    }

    if (result.unusedAllowances.length > 0) {
      failed = true;
      console.error(
        `check-open-boundary: ${result.unusedAllowances.length} allowance(s) in ${rulesPath} ` +
          `match nothing. A stale allowance is a hole nobody is watching:`,
      );
      for (const entry of result.unusedAllowances) {
        console.error(`  ${entry.rule}: ${entry.path ?? entry.pathPrefix}`);
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
        tool: 'scripts/check-open-boundary.mjs',
        rules: path.relative(root, path.resolve(rulesPath)).split(path.sep).join('/'),
        rulesVersion: rules.version ?? null,
        repository: { root: path.basename(root), gitHead: head },
        ...result,
      };
      fs.mkdirSync(path.dirname(path.resolve(reportPath)), { recursive: true });
      fs.writeFileSync(path.resolve(reportPath), `${JSON.stringify(report, null, 2)}\n`);
    }
  }

  process.exit(failed ? 1 : 0);
}
