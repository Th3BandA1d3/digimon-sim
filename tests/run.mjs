// Node tests: node tests/run.mjs
import assert from 'node:assert/strict';
import { parseText, makeDef } from '../js/cards.js';
import { parseDeckText, checkDeck, splitDeck } from '../js/deckparse.js';
import { DEMO_CARDS, DEMO_DECKS } from '../js/data/demo.js';
import { fromApi } from '../js/carddb.js';
import { STARTER_DECKS } from '../js/data/starters.js';
import { AIController } from '../js/ai.js';
import { setPreviewFix } from '../js/devfixes.js';
import { newGame, place, defOf, demoDeck, card } from './helpers.mjs';

let pass = 0; let fail = 0;
async function test(name, fn) {
  try { await fn(); pass++; console.log('  ✓', name); } catch (e) { fail++; console.log('  ✗', name, '\n   ', e.stack.split('\n').slice(0, 3).join('\n    ')); }
}
const quiet = { log: () => {} };

await test('every demo card parses with nothing left manual', () => {
  for (const raw of Object.values(DEMO_CARDS)) { const d = makeDef(raw); assert.deepEqual(d.manual, [], `${raw.name}: ${d.manual.join(' / ')}`); }
});
await test('demo decks are legal: 50 main + 5 eggs, max 4 copies', () => {
  for (const d of DEMO_DECKS) {
    const parsed = parseDeckText(d.text);
    const split = splitDeck(parsed.cards, new Map(Object.entries(DEMO_CARDS)));
    assert.deepEqual(checkDeck(split), [], d.key);
  }
});
await test('deck list formats', () => {
  const a = parseDeckText('// Digi-Egg\n4 Koromon BT1-001\nBT1-010 x3\n2x Agumon (BT1-010)\n4 (ST1-03)\nTamers:\n1 Tai Kamiya P-001');
  const by = Object.fromEntries(a.cards.map((c) => [c.id, c.qty]));
  assert.equal(by['BT1-001'], 4); assert.equal(by['BT1-010'], 5); assert.equal(by['ST1-03'], 4); assert.equal(by['P-001'], 1);
  const j = parseDeckText('["Exported from digimoncard.dev","BT1-001","BT1-010","BT1-010"]');
  assert.equal(j.cards.find((c) => c.id === 'BT1-010').qty, 2);
});
await test('API rows become cards (colours, evo, inherited, security)', () => {
  const c = fromApi({ name: 'Testmon', type: 'Digimon', id: 'BT9-999', level: 4, play_cost: 5, evolution_cost: 2, evolution_color: 'Red', evolution_level: 3, color: 'Red', color2: 'Yellow', digi_type: 'Dragon', form: 'Champion', attribute: 'Vaccine', dp: 5000, main_effect: "[On Play] Delete 1 of your opponent's Digimon with 3000 DP or less.", source_effect: '[Your Turn] This Digimon gets +1000 DP.', alt_effect: '' });
  assert.deepEqual(c.colors, ['Red', 'Yellow']); assert.equal(c.evo[0].cost, 2); assert.equal(c.inherited, '[Your Turn] This Digimon gets +1000 DP.');
  const d = makeDef(c); assert.deepEqual(d.manual, []);
  const t = fromApi({ name: 'Tamer', type: 'Tamer', id: 'BT9-998', play_cost: 2, color: 'Red', main_effect: '[Start of Your Turn] If you have 2 or less memory, set your memory to 3.', alt_effect: '[Security] Play this card without paying the cost.' });
  const td = makeDef(t); assert.ok(td.abilities.some((ab) => ab.timings.includes('security')));
});
await test('parser: keywords, timings, statics, events', () => {
  const p = parseText("<Blocker> (reminder)\n<Security A. +1> <Rush>\n[When Digivolving] 1 of your opponent's Digimon gets -3000 DP for the turn.\n[Your Turn] While you have a Tamer, this Digimon gets +2000 DP.\n[Your Turn] When this Digimon attacks, gain 1 memory.");
  assert.equal(p.kw.blocker, true); assert.equal(p.kw.sa, 1); assert.equal(p.kw.rush, true);
  assert.equal(p.abilities.length, 3); assert.equal(p.abilities[2].event, 'attack');
  assert.equal(p.abilities[1].statics[0].cond.k, 'haveTamer'); assert.deepEqual(p.unhandled, []);
  const q = parseText("[Security] Activate this card's [Main] effect.");
  assert.equal(q.abilities.length, 1); assert.equal(q.abilities[0].effects[0].type, 'activateMain');
});
await test('memory: costs move the gauge and passing gives the opponent 3', async () => {
  const g = newGame(); await g.start(); const [a, b] = g.players;
  g.active = a; g.setMem(a, 2); g.gainMem(a, -5); assert.equal(g.mem(a), -3); assert.equal(g.mem(b), 3);
});
await test('digivolve: requirements, cost, draw 1 and [When Digivolving]', async () => {
  const g = newGame(); await g.start(); const [a, b] = g.players; g.active = a; g.turn = 3; g.setMem(a, 5);
  const pup = place(g, a, 'DEMO-R01');
  const small = place(g, b, 'DEMO-B02');
  const hound = g.inst(defOf('DEMO-R03'), a); a.hand.push(hound);
  const hand0 = a.hand.length;
  const acts = g.legalActions(a).filter((x) => x.type === 'digivolve' && x.card === hound);
  assert.equal(acts.length, 1); assert.equal(acts[0].cost, 2);
  await g.doAction(a, acts[0]);
  assert.equal(g.top(pup).def.name, 'Blazehound'); assert.equal(g.mem(a), 3); assert.equal(a.hand.length, hand0); // -1 played, +1 drawn
  assert.ok(!b.field.includes(small), 'When Digivolving deleted the 1000 DP Digimon');
  assert.equal(g.dp(pup), 6000, 'inherited +1000 DP on my turn');
});
await test('attack: security check, security Digimon battle, Jamming', async () => {
  const g = newGame(); await g.start(); const [a, b] = g.players; g.active = a; g.turn = 3;
  const att = place(g, a, 'DEMO-R05'); // 7000
  b.security = [g.inst(defOf('DEMO-R06'), b)]; // 12000 security Digimon
  await g.attack(a, att, 'player');
  assert.ok(!a.field.includes(att), 'lost the security battle'); assert.equal(b.security.length, 0);
  const j = place(g, a, ['DEMO-B00', 'DEMO-B02', 'DEMO-B04']); // Frostfin with inherited Jamming
  b.security = [g.inst(defOf('DEMO-R06'), b)];
  await g.attack(a, j, 'player');
  assert.ok(a.field.includes(j), 'Jamming survives');
});
await test('winning: attacking with no security left', async () => {
  const g = newGame(); await g.start(); const [a, b] = g.players; g.active = a; g.turn = 3;
  const att = place(g, a, 'DEMO-R01'); b.security = [];
  await g.attack(a, att, 'player');
  assert.equal(g.winner, a);
});
await test('blocking and battles (tie deletes both, Piercing checks)', async () => {
  const g = newGame(); await g.start(); const [a, b] = g.players; g.active = a; g.turn = 3;
  const att = place(g, a, 'DEMO-R04'); // 4000
  const blk = place(g, b, 'DEMO-B04'); // 4000 Blocker
  await g.attack(a, att, 'player');
  assert.ok(!a.field.includes(att) && !b.field.includes(blk), 'tie deletes both');
  const p = place(g, a, ['DEMO-R10', 'DEMO-R05']); // Pyrewolf 7000, inherited Piercing from Emberling
  const tgt = place(g, b, 'DEMO-B01', { suspended: true });
  const sec0 = b.security.length;
  await g.attack(a, p, tgt);
  assert.ok(!b.field.includes(tgt)); assert.equal(b.security.length, sec0 - 1, 'Piercing checked security');
});
await test('Tamer from security is played; Option security effects run', async () => {
  const g = newGame(); await g.start(); const [a, b] = g.players; g.active = a; g.turn = 3;
  const att = place(g, a, 'DEMO-R05');
  b.security = [g.inst(defOf('DEMO-B07'), b)];
  await g.attack(a, att, 'player');
  assert.ok(b.field.some((s) => g.top(s).def.name === 'Mira the Diver'));
  const att2 = place(g, a, 'DEMO-R01');
  b.security = [g.inst(defOf('DEMO-B08'), b)]; // Tidal Pull: return a Digimon with 5000 DP or less
  await g.attack(a, att2, 'player');
  assert.ok(!a.field.includes(att2), 'bounced by the security Option');
});
await test('statics: [Your Turn] only on your turn; group DP minus', async () => {
  const g = newGame(); await g.start(); const [a, b] = g.players;
  const st = place(g, a, ['DEMO-R01', 'DEMO-R03']); // Blazehound 5000 + inherited +1000 on my turn
  g.active = a; assert.equal(g.dp(st), 6000); g.active = b; assert.equal(g.dp(st), 5000);
});
await test('full AI games finish without errors (both decks, many seeds)', async () => {
  let wins = [0, 0];
  for (let seed = 1; seed <= 30; seed++) {
    const g = newGame({ seed, io: quiet, first: seed % 2 });
    const w = await g.run();
    assert.ok(w, `seed ${seed}: no winner (${g.reason})`);
    wins[w.idx]++;
  }
  console.log('     red/blue wins:', wins.join(' / '));
});
await test('easy AI loses more often than normal', async () => {
  let normal = 0;
  for (let seed = 100; seed < 120; seed++) {
    const g = newGame({ seed, io: quiet, ctrlA: new AIController('normal'), ctrlB: new AIController('easy'), a: 'demo-red', b: 'demo-red', first: seed % 2 });
    const w = await g.run(); if (w?.idx === 0) normal++;
  }
  assert.ok(normal >= 11, `normal won ${normal}/20`);
});

await test('rule fixes: sentence-level and whole-ability replacements', () => {
  setPreviewFix({ match: 'Your opponent does something odd.', replace: 'Gain 1 memory.' });
  let p = parseText('[On Play] Your opponent does something odd.');
  assert.equal(p.abilities[0].effects[0].type, 'memory'); assert.deepEqual(p.abilities[0].unhandled, []);
  const ab = '[Your Turn] When this Digimon becomes suspended, this Digimon gets +1000 DP for the turn and something odd happens.';
  setPreviewFix({ match: ab, replace: '[Your Turn] When this Digimon becomes suspended, this Digimon gets +1000 DP for the turn.' });
  p = parseText(ab);
  assert.equal(p.abilities[0].event, 'suspended'); assert.deepEqual(p.abilities[0].unhandled, []);
  setPreviewFix(null);
});

await test('official starter decks: 54 cards (4 eggs + 50), max 4 copies, card numbers only', () => {
  const keys = new Set();
  for (const d of STARTER_DECKS) {
    assert.ok(!keys.has(d.key), d.key); keys.add(d.key);
    const p = parseDeckText(d.text);
    assert.deepEqual(p.errors, [], d.code); assert.deepEqual(p.named, [], d.code);
    assert.equal(p.cards.reduce((s, c) => s + c.qty, 0), 54, d.code);
    for (const c of p.cards) assert.ok(c.qty <= 4, `${d.code} ${c.id}`);
    const prefix = d.code.replace('-', '');
    assert.equal(p.cards.find((c) => c.id === `${prefix}-01`)?.qty, 4, `${d.code}: 4 Digi-Eggs`);
  }
});

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
