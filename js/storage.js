// Saved decks, settings and match records live in the browser's localStorage.
// Card data is cached separately in IndexedDB by carddb.js.
const DECKS = 'digisim.decks.v1';
const SETTINGS = 'digisim.settings.v1';
const RECORDS = 'digisim.records.v1';

const read = (k, d) => { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch { return d; } };
const write = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); return true; } catch { return false; } };

// deck: { id, title, main: [{ id, qty, name }], eggs: [{ id, qty, name }], updated }
export function listDecks() { return read(DECKS, []).sort((a, b) => (b.updated || 0) - (a.updated || 0)); }
export function getDeck(id) { return listDecks().find((d) => d.id === id); }
export function saveDeck(deck) {
  const all = read(DECKS, []);
  deck.id = deck.id || 'd' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  deck.updated = Date.now();
  const i = all.findIndex((d) => d.id === deck.id);
  if (i >= 0) all[i] = deck; else all.push(deck);
  write(DECKS, all);
  return deck;
}
export function deleteDeck(id) { write(DECKS, read(DECKS, []).filter((d) => d.id !== id)); }

export const DEFAULT_SETTINGS = {
  name: 'You',
  aiSpeed: 650,          // ms pause after each AI action
  showImages: true,      // card images from DigimonCard.io when online
  aiManual: 'notice',    // 'notice' | 'skip': manual steps from AI cards
  confirmPass: true,
  tips: true,
};
export function getSettings() { return { ...DEFAULT_SETTINGS, ...read(SETTINGS, {}) }; }
export function saveSettings(s) { write(SETTINGS, s); }

export function addRecord(r) { const all = read(RECORDS, []); all.unshift({ ...r, date: Date.now() }); write(RECORDS, all.slice(0, 300)); }
export function listRecords() { return read(RECORDS, []); }
