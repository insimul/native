/*
 * verify_snapshot_ts.mjs — prove a committed native snapshot is parseable by the
 * engine wrappers' Prolog fact parser (US-LI4).
 *
 * Runs insimul-runtime's REAL prolog-fact-parser.ts (packages/core/src/prolog)
 * over the committed snapshot fixture and checks the result against the fixture's
 * expected-parse companion. This is the C#/C++/GDScript wrappers' parser, so a
 * green run means the native snapshot format they will load round-trips.
 *
 * Invoked (via tests/run_snapshot_parse.sh, which handles node/submodule absence)
 * as:  node --experimental-strip-types verify_snapshot_ts.mjs <fixture.pl> <expected.json> <parser.ts>
 */
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const [, , fixturePath, expectedPath, parserPath] = process.argv;
if (!fixturePath || !expectedPath || !parserPath) {
  console.error('usage: verify_snapshot_ts.mjs <fixture.pl> <expected.json> <parser.ts>');
  process.exit(2);
}

const { parsePrologFile, argToString } = await import(pathToFileURL(parserPath).href);

const source = readFileSync(fixturePath, 'utf8');
const expected = JSON.parse(readFileSync(expectedPath, 'utf8'));
const r = parsePrologFile(source);

let failures = 0;
const check = (cond, msg) => {
  if (cond) console.log(`  ok   ${msg}`);
  else { console.log(`  FAIL ${msg}`); failures++; }
};

check(r.errors.length === expected.errors,
  `parse errors == ${expected.errors} (got ${r.errors.length}: ${JSON.stringify(r.errors)})`);
check(r.facts.length === expected.facts,
  `fact count == ${expected.facts} (got ${r.facts.length})`);
check(r.rules.length === expected.rules,
  `rule count == ${expected.rules} (got ${r.rules.length})`);

const preds = r.facts.map((f) => `${f.predicate}/${f.arity}`).sort();
check(JSON.stringify(preds) === JSON.stringify([...expected.predicates].sort()),
  `fact predicates match (got ${preds.join(', ')})`);

const heads = r.rules.map((f) => `${f.head.predicate}/${f.head.arity}`).sort();
check(JSON.stringify(heads) === JSON.stringify([...expected.ruleHeads].sort()),
  `rule heads match (got ${heads.join(', ')})`);

/* Spot checks: a quoted-atom arg parses as a string, a list arg as a list. */
const title = r.facts.find((f) => f.predicate === 'title');
check(!!title && title.args[1] && title.args[1].type === 'string' &&
      title.args[1].value === expected.spotChecks['title.arg1'].value,
  `title/2 quoted atom parses as string "${expected.spotChecks['title.arg1'].value}"`);

const inv = r.facts.find((f) => f.predicate === 'inventory');
const invList = inv && inv.args[1];
const invElems = invList && invList.type === 'list'
  ? invList.elements.map((e) => (e.type === 'number' ? e.value : argToString(e)))
  : null;
check(JSON.stringify(invElems) === JSON.stringify(expected.spotChecks['inventory.arg1'].elements),
  `inventory/2 list parses as [${expected.spotChecks['inventory.arg1'].elements.join(', ')}]`);

if (failures === 0) { console.log('snapshot_parse: PASS'); process.exit(0); }
console.log(`snapshot_parse: FAIL (${failures})`);
process.exit(1);
