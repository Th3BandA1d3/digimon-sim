// Practice cards for the built-in demo decks. These creatures, tamers and options are ORIGINAL inventions for this app
// (not real Digimon cards) so the game works offline and the tests have fixed data. Their effect text uses the same
// wording patterns as real cards, so they exercise the parser.
const C = (id, name, type, o = {}) => ({ id, name, type, demo: true, colors: [o.color || 'Red'], level: o.level ?? null, playCost: o.cost ?? null, dp: o.dp ?? null, evo: o.evo || [], traits: o.traits || [], main: o.main || '', inherited: o.inh || '', security: o.sec || '', image: '' });
const evo = (color, level, cost) => [{ color, level, cost }];

const RED = [
  C('DEMO-R00', 'Ember Egg', 'Digi-Egg', { level: 2, inh: '[Your Turn] While this Digimon has 4 or more digivolution cards, this Digimon gets +1000 DP.', traits: ['In-Training'] }),
  C('DEMO-R01', 'Cinderpup', 'Digimon', { level: 3, cost: 3, dp: 2000, evo: evo('Red', 2, 0), inh: '[Your Turn] This Digimon gets +1000 DP.', traits: ['Rookie', 'Beast'] }),
  C('DEMO-R02', 'Sparkit', 'Digimon', { level: 3, cost: 2, dp: 1000, evo: evo('Red', 2, 0), main: '[On Play] <Draw 1>', inh: '[When Attacking][Once Per Turn] Gain 1 memory.', traits: ['Rookie', 'Fairy'] }),
  C('DEMO-R10', 'Emberling', 'Digimon', { level: 3, cost: 3, dp: 3000, evo: evo('Red', 2, 0), inh: '<Piercing>', traits: ['Rookie', 'Reptile'] }),
  C('DEMO-R03', 'Blazehound', 'Digimon', { level: 4, cost: 5, dp: 5000, evo: evo('Red', 3, 2), main: "[When Digivolving] Delete 1 of your opponent's Digimon with 3000 DP or less.", inh: '[Your Turn] This Digimon gets +1000 DP.', traits: ['Champion', 'Beast'] }),
  C('DEMO-R04', 'Flarewing', 'Digimon', { level: 4, cost: 4, dp: 4000, evo: evo('Red', 3, 2), main: '<Rush>', inh: '[When Attacking][Once Per Turn] Gain 1 memory.', traits: ['Champion', 'Bird'] }),
  C('DEMO-R11', 'Magmaram', 'Digimon', { level: 4, cost: 6, dp: 6000, evo: evo('Red', 3, 2), main: '[On Play] <Draw 1>', inh: '[Your Turn] This Digimon gets +1000 DP.', traits: ['Champion', 'Beast'] }),
  C('DEMO-R05', 'Pyrewolf', 'Digimon', { level: 5, cost: 7, dp: 7000, evo: evo('Red', 4, 3), main: "[When Attacking] 1 of your opponent's Digimon gets -2000 DP for the turn.", inh: '<Piercing>', traits: ['Ultimate', 'Beast'] }),
  C('DEMO-R12', 'Scorchbeak', 'Digimon', { level: 5, cost: 6, dp: 6000, evo: evo('Red', 4, 2), main: '[On Deletion] <Draw 1>', inh: '[Your Turn] This Digimon gets +2000 DP.', traits: ['Ultimate', 'Bird'] }),
  C('DEMO-R06', 'Infernoclaw', 'Digimon', { level: 6, cost: 12, dp: 12000, evo: evo('Red', 5, 3), main: "<Security A. +1>\n[When Digivolving] Delete 1 of your opponent's Digimon with 6000 DP or less.", traits: ['Mega', 'Dragon'] }),
  C('DEMO-R13', 'Solar Ignis', 'Digimon', { level: 6, cost: 11, dp: 11000, evo: evo('Red', 5, 3), main: "[When Attacking] Trash the top card of your opponent's security stack.", traits: ['Mega', 'Dragon'] }),
  C('DEMO-R07', 'Kai the Firestarter', 'Tamer', { cost: 2, main: '[Start of Your Turn] If you have 2 or less memory, set your memory to 3.', sec: '[Security] Play this card without paying the cost.' }),
  C('DEMO-R08', 'Flare Burst', 'Option', { cost: 2, main: "[Main] Delete 1 of your opponent's Digimon with 4000 DP or less.", sec: "[Security] Activate this card's [Main] effect." }),
  C('DEMO-R09', 'Firewall', 'Option', { cost: 1, main: "[Main] All of your opponent's Digimon get -1000 DP for the turn. <Draw 1>", sec: '[Security] Add this card to the hand.' }),
];
const BLUE = [
  C('DEMO-B00', 'Bubble Egg', 'Digi-Egg', { color: 'Blue', level: 2, inh: '[When Attacking][Once Per Turn] Gain 1 memory.', traits: ['In-Training'] }),
  C('DEMO-B01', 'Splashkit', 'Digimon', { color: 'Blue', level: 3, cost: 3, dp: 3000, evo: evo('Blue', 2, 0), inh: '[Your Turn] This Digimon gets +1000 DP.', traits: ['Rookie', 'Aquatic'] }),
  C('DEMO-B02', 'Shellby', 'Digimon', { color: 'Blue', level: 3, cost: 2, dp: 1000, evo: evo('Blue', 2, 0), main: '[On Play] <Draw 1>', inh: '<Jamming>', traits: ['Rookie', 'Aquatic'] }),
  C('DEMO-B10', 'Driftling', 'Digimon', { color: 'Blue', level: 3, cost: 3, dp: 2000, evo: evo('Blue', 2, 0), main: '<Blocker>', inh: '[When Attacking][Once Per Turn] Gain 1 memory.', traits: ['Rookie', 'Ice'] }),
  C('DEMO-B03', 'Tidecrab', 'Digimon', { color: 'Blue', level: 4, cost: 5, dp: 5000, evo: evo('Blue', 3, 2), main: "[When Digivolving] Return 1 of your opponent's level 3 Digimon to the hand.", inh: '[Your Turn] This Digimon gets +1000 DP.', traits: ['Champion', 'Aquatic'] }),
  C('DEMO-B04', 'Frostfin', 'Digimon', { color: 'Blue', level: 4, cost: 4, dp: 4000, evo: evo('Blue', 3, 2), main: '<Blocker>', inh: '<Jamming>', traits: ['Champion', 'Ice'] }),
  C('DEMO-B11', 'Coralgeist', 'Digimon', { color: 'Blue', level: 4, cost: 5, dp: 5000, evo: evo('Blue', 3, 2), main: "[When Digivolving] Suspend 1 of your opponent's Digimon.", inh: '[Your Turn] This Digimon gets +1000 DP.', traits: ['Champion', 'Ghost'] }),
  C('DEMO-B05', 'Reefknight', 'Digimon', { color: 'Blue', level: 5, cost: 7, dp: 7000, evo: evo('Blue', 4, 3), main: "[When Digivolving] <De-Digivolve 1> 1 of your opponent's Digimon.", inh: '<Jamming>', traits: ['Ultimate', 'Aquatic'] }),
  C('DEMO-B12', 'Glacierhorn', 'Digimon', { color: 'Blue', level: 5, cost: 6, dp: 7000, evo: evo('Blue', 4, 2), main: '<Blocker>\n[On Deletion] <Draw 1>', inh: '[Your Turn] This Digimon gets +2000 DP.', traits: ['Ultimate', 'Ice'] }),
  C('DEMO-B06', 'Leviadrake', 'Digimon', { color: 'Blue', level: 6, cost: 12, dp: 12000, evo: evo('Blue', 5, 3), main: "[When Digivolving] Suspend 1 of your opponent's Digimon.\n[Your Turn] This Digimon gains <Security A. +1>.", traits: ['Mega', 'Sea Dragon'] }),
  C('DEMO-B13', 'Abyssal Crown', 'Digimon', { color: 'Blue', level: 6, cost: 11, dp: 11000, evo: evo('Blue', 5, 3), main: "[When Attacking] Return 1 of your opponent's Digimon with 6000 DP or less to the hand.", traits: ['Mega', 'Aquatic'] }),
  C('DEMO-B07', 'Mira the Diver', 'Tamer', { color: 'Blue', cost: 2, main: '[Start of Your Turn] If you have 2 or less memory, set your memory to 3.', sec: '[Security] Play this card without paying the cost.' }),
  C('DEMO-B08', 'Tidal Pull', 'Option', { color: 'Blue', cost: 2, main: "[Main] Return 1 of your opponent's Digimon with 5000 DP or less to the hand.", sec: "[Security] Activate this card's [Main] effect." }),
  C('DEMO-B09', 'Deep Scan', 'Option', { color: 'Blue', cost: 1, main: '[Main] Reveal the top 3 cards of your deck. Add 1 Digimon card among them to the hand. Trash the rest.', sec: '[Security] Add this card to the hand.' }),
];
export const DEMO_CARDS = Object.fromEntries([...RED, ...BLUE].map((c) => [c.id, c]));

const list = (p) => `4 ${p}00\n4 ${p}01\n4 ${p}02\n4 ${p}10\n4 ${p}03\n4 ${p}04\n4 ${p}11\n4 ${p}05\n4 ${p}12\n3 ${p}06\n3 ${p}13\n4 ${p}07\n4 ${p}08\n4 ${p}09`;
export const DEMO_DECKS = [
  { key: 'demo-red', title: 'Demo: Ember Rush (red)', text: list('DEMO-R'), blurb: 'Fast and aggressive: delete small blockers, attack early, finish with Infernoclaw.' },
  { key: 'demo-blue', title: 'Demo: Tide Control (blue)', text: list('DEMO-B'), blurb: 'Defensive: blockers, bounce and de-digivolve to slow the opponent down.' },
];
