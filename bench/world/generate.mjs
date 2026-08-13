#!/usr/bin/env node
/*
 * generate.mjs — emit the measured world, deterministically.
 *
 * US-3 of tasklist 250 measures "cold KB create + consult of a REAL world's .pl
 * set" and "resident memory holding a real world's KB". Those numbers are
 * meaningless without their scale, so the world is a COMMITTED fixture with a
 * recorded manifest (bytes, clauses, sha256 per file) rather than something a
 * benchmark makes up at run time.
 *
 * The shapes are the KINP ones the conformance corpus already uses
 * (conformance/prolog/{gameplay,identity,worlds,equivalence}.json): entity atoms
 * are id/3 terms over world CURIEs, worlds form a parent chain, and equivalence
 * is same_as/3. This is the same Prolog a shipping world would hold, at a
 * plausible small-world scale — not a synthetic microbenchmark.
 *
 *   node bench/world/generate.mjs            rewrite the .pl set + MANIFEST.json
 *   node bench/world/generate.mjs --check    regenerate into memory and verify
 *                                            the committed bytes match (exit 1
 *                                            if they do not)
 *
 * The generator is deterministic: a fixed LCG, no clock, no Math.random. Two
 * runs on two machines produce byte-identical files, which is what lets
 * scripts/measure.sh refuse to quote a figure against a mutated world.
 */
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));

/* ---------------------------------------------------------------- scale ---
 * One place. Changing any of these changes the measured world, which changes
 * every figure in docs/SWIPL_MEASUREMENT.md — so the manifest records the
 * resulting counts and the doc quotes them.                                  */
const NPCS = 120;
const QUESTS = 90;
const ITEMS = 80;
const LOCATIONS = 36;
const FACTIONS = 8;
const ALIASES = 70;

const WORLD = 'alderforest';
const NS = `insimul:world:${WORLD}`;
const SAVE = `${WORLD}%23save-7f`;

/* A deterministic LCG (Numerical Recipes constants). No Math.random: the whole
 * point of this file is that it produces the same bytes twice. */
let seed = 20250813;
const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
const pick = (a) => a[Math.floor(rnd() * a.length)];
const int = (lo, hi) => lo + Math.floor(rnd() * (hi - lo + 1));

const pad = (n, w = 4) => String(n).padStart(w, '0');
const ent = (local) => `id(ent, '${NS}', '${local}')`;

const GIVEN = ['Aldra', 'Brenn', 'Cael', 'Dara', 'Eryn', 'Fenn', 'Gwyn', 'Hal',
  'Isolde', 'Joran', 'Kest', 'Lira', 'Maerin', 'Nolan', 'Orwin', 'Pell',
  'Quill', 'Rowan', 'Syl', 'Tamsin', 'Ulric', 'Vess', 'Wren', 'Ysolt'];
const FAMILY = ['Ashdown', 'Briarwood', 'Coldwater', 'Dunmere', 'Elmhollow',
  'Fairbrook', 'Greymoor', 'Hartwell', 'Ironvale', 'Larkspur'];
const ROLES = ['merchant', 'guard', 'smith', 'healer', 'scout', 'scholar',
  'innkeeper', 'hunter', 'priest', 'farmer'];
const PLACE_A = ['North', 'South', 'East', 'West', 'Old', 'High', 'Low', 'Far'];
const PLACE_B = ['gate', 'market', 'chapel', 'mill', 'bridge', 'quarry',
  'orchard', 'wharf', 'barrow', 'watchtower'];
const FACTION_NAMES = ['Woodwardens', 'Ashen Guild', 'River Concord',
  'Stonewrights', 'Lamplighters', 'Free Hands', 'Thornwatch', 'Quiet Court'];
const QUEST_TITLES = ['Rescue the Merchant', 'Slay the Dragon', 'Gather Herbs',
  'Escort the Caravan', 'Clear the Cellar', 'Find the Lost Ledger',
  'Douse the Beacon', 'Mend the Weir', 'Track the Poacher', 'Sing the Elegy'];
const OBJECTIVES = ['reach_camp', 'free_merchant', 'gather_herbs', 'slay_beast',
  'speak_to_elder', 'open_gate', 'recover_ledger', 'light_beacon',
  'repair_weir', 'follow_tracks'];
const REWARDS = ['gold', 'xp', 'renown', 'supplies'];
const ITEM_KINDS = ['weapon', 'tool', 'charm', 'ration', 'relic', 'garment'];

/* ------------------------------------------------------------------ files -- */

function worldFile() {
  const L = [];
  L.push(`% world.pl — the world chain and the identity/equivalence rules.`);
  L.push(`% KINP: a playthrough inherits from editor canon, which inherits from`);
  L.push(`% consensus reality (conformance/prolog/worlds.json). The '#' of the`);
  L.push(`% playthrough spelling is percent-encoded, and stays undecoded.`);
  L.push(``);
  L.push(`:- dynamic(world_parent/2).`);
  L.push(`:- dynamic(same_as/3).`);
  L.push(``);
  L.push(`world_parent(id(world, insimul, '${SAVE}'), id(world, insimul, ${WORLD})).`);
  L.push(`world_parent(id(world, insimul, ${WORLD}), id(world, pinakes, 'consensus-reality')).`);
  L.push(``);
  L.push(`world_ancestor(W, P) :- world_parent(W, P).`);
  L.push(`world_ancestor(W, A) :- world_parent(W, M), world_ancestor(M, A).`);
  L.push(`world_scope(W, W).`);
  L.push(`world_scope(W, A) :- world_ancestor(W, A).`);
  L.push(``);
  L.push(`id_local(id(_, _, L), L).`);
  L.push(`id_ns(id(_, N, _), N).`);
  L.push(``);
  L.push(`% Equivalence is symmetric and transitive over a confidence floor.`);
  L.push(`equivalent(A, B, C) :- same_as(A, B, C).`);
  L.push(`equivalent(A, B, C) :- same_as(B, A, C).`);
  L.push(`alias_of(L, M) :- equivalent(A, B, _), id_local(A, L), id_local(B, M).`);
  L.push(`confident_alias(L, M) :- equivalent(A, B, C), C >= 0.75,`);
  L.push(`    id_local(A, L), id_local(B, M).`);
  return L.join('\n') + '\n';
}

function entitiesFile() {
  const L = [];
  L.push(`% entities.pl — the world's inhabitants, as KINP id/3 terms.`);
  L.push(``);
  L.push(`:- dynamic(npc/2).`);
  L.push(`:- dynamic(npc_name/2).`);
  L.push(`:- dynamic(npc_home/2).`);
  L.push(`:- dynamic(npc_faction/2).`);
  L.push(`:- dynamic(npc_level/2).`);
  L.push(``);
  for (let i = 1; i <= NPCS; i++) {
    const id = ent(`npc_${pad(i)}`);
    const name = `${pick(GIVEN)} ${pick(FAMILY)}`;
    L.push(`npc(${id}, ${pick(ROLES)}).`);
    L.push(`npc_name(${id}, '${name}').`);
    L.push(`npc_home(${id}, ${ent(`loc_${pad(int(1, LOCATIONS))}`)}).`);
    L.push(`npc_faction(${id}, ${ent(`fac_${pad(int(1, FACTIONS))}`)}).`);
    L.push(`npc_level(${id}, ${int(1, 30)}).`);
  }
  return L.join('\n') + '\n';
}

function placesFile() {
  const L = [];
  L.push(`% places.pl — locations, their containment tree, and the factions.`);
  L.push(``);
  L.push(`:- dynamic(location/2).`);
  L.push(`:- dynamic(location_parent/2).`);
  L.push(`:- dynamic(faction/2).`);
  L.push(`:- dynamic(faction_standing/3).`);
  L.push(``);
  for (let i = 1; i <= LOCATIONS; i++) {
    const id = ent(`loc_${pad(i)}`);
    L.push(`location(${id}, '${pick(PLACE_A)} ${pick(PLACE_B)}').`);
    if (i > 1) L.push(`location_parent(${id}, ${ent(`loc_${pad(int(1, i - 1))}`)}).`);
  }
  L.push(``);
  for (let i = 1; i <= FACTIONS; i++) {
    const id = ent(`fac_${pad(i)}`);
    L.push(`faction(${id}, '${FACTION_NAMES[i - 1]}').`);
    for (let j = 1; j <= 4; j++) {
      L.push(`faction_standing(${id}, ${ent(`fac_${pad(int(1, FACTIONS))}`)}, ${int(-100, 100)}).`);
    }
  }
  L.push(``);
  L.push(`inside(X, Y) :- location_parent(X, Y).`);
  L.push(`inside(X, Y) :- location_parent(X, M), inside(M, Y).`);
  L.push(`neighbours(A, B) :- location_parent(A, P), location_parent(B, P), A \\== B.`);
  return L.join('\n') + '\n';
}

function questsFile() {
  const L = [];
  L.push(`% quests.pl — quest/5, quest_objective/3, quest_reward/3,`);
  L.push(`% quest_prerequisite/2: the shapes of packages/core's predicate schema.`);
  L.push(``);
  L.push(`:- dynamic(quest/5).`);
  L.push(`:- dynamic(quest_objective/3).`);
  L.push(`:- dynamic(quest_reward/3).`);
  L.push(`:- dynamic(quest_prerequisite/2).`);
  L.push(`:- dynamic(quest_giver/2).`);
  L.push(`:- dynamic(completed/3).`);
  L.push(``);
  for (let i = 1; i <= QUESTS; i++) {
    const id = ent(`q${pad(i)}`);
    const kind = rnd() < 0.4 ? 'main' : 'side';
    const diff = pick(['easy', 'normal', 'hard']);
    const state = pick(['active', 'active', 'locked', 'done']);
    L.push(`quest(${id}, '${pick(QUEST_TITLES)}', ${kind}, ${diff}, ${state}).`);
    L.push(`quest_giver(${id}, ${ent(`npc_${pad(int(1, NPCS))}`)}).`);
    const nobj = int(2, 3);
    for (let k = 0; k < nobj; k++) L.push(`quest_objective(${id}, ${k}, ${pick(OBJECTIVES)}).`);
    for (let k = 0; k < 2; k++) L.push(`quest_reward(${id}, ${pick(REWARDS)}, ${int(10, 900)}).`);
    if (i > 1 && rnd() < 0.6) L.push(`quest_prerequisite(${id}, ${ent(`q${pad(int(1, i - 1))}`)}).`);
  }
  L.push(``);
  L.push(`completed(${ent('hero')}, ${ent('q0001')}, 0).`);
  L.push(`completed(${ent('hero')}, ${ent('q0002')}, 1).`);
  return L.join('\n') + '\n';
}

function itemsFile() {
  const L = [];
  L.push(`% items.pl — the world's things, who holds them, and the alias set.`);
  L.push(``);
  L.push(`:- dynamic(item/3).`);
  L.push(`:- dynamic(item_owner/2).`);
  L.push(``);
  for (let i = 1; i <= ITEMS; i++) {
    const id = ent(`item_${pad(i)}`);
    L.push(`item(${id}, ${pick(ITEM_KINDS)}, ${int(1, 400)}).`);
    L.push(`item_owner(${id}, ${ent(`npc_${pad(int(1, NPCS))}`)}).`);
  }
  L.push(``);
  for (let i = 1; i <= ALIASES; i++) {
    const a = ent(`npc_${pad(int(1, NPCS))}`);
    const b = `id(ent, 'pinakes:canon', 'p_${pad(int(1, 400))}')`;
    L.push(`same_as(${a}, ${b}, 0.${int(50, 99)}).`);
  }
  return L.join('\n') + '\n';
}

function rulesFile() {
  const L = [];
  L.push(`% rules.pl — the derived gameplay predicates a session actually asks.`);
  L.push(`% These are the goals scripts/measure.sh runs against the loaded world.`);
  L.push(``);
  L.push(`quest_available(L) :- quest(Q, _, _, _, active), \\+ quest_blocked(Q), id_local(Q, L).`);
  L.push(`quest_blocked(Q) :- quest_prerequisite(Q, P), \\+ completed(_, P, _).`);
  L.push(`quest_of_difficulty(D, L) :- quest(Q, _, _, D, _), id_local(Q, L).`);
  L.push(`quest_payout(L, Total) :-`);
  L.push(`    quest(Q, _, _, _, _), id_local(Q, L),`);
  L.push(`    findall(V, quest_reward(Q, _, V), Vs), sum_list_(Vs, Total).`);
  L.push(`sum_list_([], 0).`);
  L.push(`sum_list_([H|T], S) :- sum_list_(T, S0), S is S0 + H.`);
  L.push(``);
  L.push(`giver_of(QL, NL) :- quest_giver(Q, N), id_local(Q, QL), id_local(N, NL).`);
  L.push(`veteran(L) :- npc_level(N, Lv), Lv >= 20, id_local(N, L).`);
  L.push(`staffed(FL, Count) :-`);
  L.push(`    faction(F, _), id_local(F, FL),`);
  L.push(`    findall(N, npc_faction(N, F), Ns), length_(Ns, Count).`);
  L.push(`length_([], 0).`);
  L.push(`length_([_|T], N) :- length_(T, N0), N is N0 + 1.`);
  L.push(``);
  L.push(`% Reachability over the location tree, and the world-scoped view of it.`);
  L.push(`resident(LocL, NpcL) :- npc_home(N, Loc), id_local(Loc, LocL), id_local(N, NpcL).`);
  L.push(`nested_in(AL, BL) :- inside(A, B), id_local(A, AL), id_local(B, BL).`);
  L.push(`world_view(WL, Scope) :-`);
  L.push(`    world_scope(id(world, insimul, '${SAVE}'), S), id_local(S, Scope), WL = '${SAVE}'.`);
  L.push(``);
  L.push(`carrier(ItemL, NpcName) :-`);
  L.push(`    item_owner(I, N), id_local(I, ItemL), npc_name(N, NpcName).`);
  L.push(`rich_item(L, V) :- item(I, _, V), V > 300, id_local(I, L).`);
  return L.join('\n') + '\n';
}

const FILES = [
  ['world.pl', worldFile],
  ['places.pl', placesFile],
  ['entities.pl', entitiesFile],
  ['quests.pl', questsFile],
  ['items.pl', itemsFile],
  ['rules.pl', rulesFile],
];

/* A clause is a term ended by a full stop at end of line; comments and blanks
 * are not clauses. Counted here so the manifest states the world's real scale. */
function countClauses(text) {
  return text.split('\n').filter((l) => /\.\s*$/.test(l) && !/^\s*%/.test(l) && l.trim() !== '')
    .length;
}

const sha256 = (s) => createHash('sha256').update(s).digest('hex');

const built = FILES.map(([name, fn]) => {
  const text = fn();
  return { name, text, bytes: Buffer.byteLength(text), sha256: sha256(text), clauses: countClauses(text) };
});

const manifest = {
  world: `${WORLD} (KINP shapes; see bench/world/README.md)`,
  generator: 'bench/world/generate.mjs',
  scale: { npcs: NPCS, quests: QUESTS, items: ITEMS, locations: LOCATIONS, factions: FACTIONS, aliases: ALIASES },
  consultOrder: built.map((f) => f.name),
  files: built.map(({ name, bytes, sha256, clauses }) => ({ name, bytes, sha256, clauses })),
  totals: {
    files: built.length,
    bytes: built.reduce((n, f) => n + f.bytes, 0),
    clauses: built.reduce((n, f) => n + f.clauses, 0),
  },
};
const manifestText = JSON.stringify(manifest, null, 2) + '\n';

const check = process.argv.includes('--check');
let bad = 0;
for (const f of built) {
  const path = join(here, f.name);
  if (check) {
    if (!existsSync(path) || readFileSync(path, 'utf8') !== f.text) {
      console.error(`world: ${f.name} DIFFERS from what the generator produces`);
      bad++;
    }
  } else {
    writeFileSync(path, f.text);
  }
}
const mpath = join(here, 'MANIFEST.json');
if (check) {
  if (!existsSync(mpath) || readFileSync(mpath, 'utf8') !== manifestText) {
    console.error('world: MANIFEST.json DIFFERS from what the generator produces');
    bad++;
  }
} else {
  writeFileSync(mpath, manifestText);
}

const t = manifest.totals;
console.log(
  `${check ? 'checked' : 'wrote'} ${t.files} files, ${t.clauses} clauses, ${t.bytes} bytes` +
    (check && bad ? ` — ${bad} MISMATCH` : ''),
);
process.exit(bad ? 1 : 0);
