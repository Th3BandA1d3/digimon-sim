// Test helpers: demo decks as card definitions, quick games, and a scripted controller.
import { makeDef } from '../js/cards.js';
import { DEMO_CARDS, DEMO_DECKS } from '../js/data/demo.js';
import { parseDeckText, splitDeck } from '../js/deckparse.js';
import { Game } from '../js/engine.js';
import { AIController } from '../js/ai.js';

const defs = new Map();
export const defOf = (id) => { if (!defs.has(id)) defs.set(id, makeDef(DEMO_CARDS[id])); return defs.get(id); };
export function demoDeck(key) {
  const d = DEMO_DECKS.find((x) => x.key === key);
  const parsed = parseDeckText(d.text);
  const byId = new Map(Object.entries(DEMO_CARDS));
  const { main, eggs } = splitDeck(parsed.cards, byId);
  const expand = (list) => list.flatMap((e) => Array.from({ length: e.qty }, () => defOf(e.id)));
  return { main: expand(main), eggs: expand(eggs) };
}
export function newGame({ seed = 1, a = 'demo-red', b = 'demo-blue', ctrlA, ctrlB, io, first = 0 } = {}) {
  const A = demoDeck(a); const B = demoDeck(b);
  return new Game({ seed, first, io, players: [
    { name: 'A', ctrl: ctrlA || new AIController('normal'), main: A.main, eggs: A.eggs, isAI: true },
    { name: 'B', ctrl: ctrlB || new AIController('normal'), main: B.main, eggs: B.eggs, isAI: true },
  ] });
}
// Put a card straight onto a player's field (for tests).
export function place(g, pl, ids, { suspended = false, entered = -1 } = {}) {
  const cards = (Array.isArray(ids) ? ids : [ids]).map((id) => g.inst(defOf(id), pl));
  const st = g.newStack(cards, pl); st.suspended = suspended; st.enteredTurn = entered; pl.field.push(st); return st;
}
export const card = (raw) => makeDef({ id: raw.id || 'T-' + Math.random().toString(36).slice(2, 7), type: 'Digimon', colors: ['Red'], evo: [], traits: [], ...raw });
