// Card data from the DigimonCard.io public API (https://digimoncard.io/api-documentation), cached on the device.
// The API allows about 15 requests per 10 seconds, so lookups are batched (card numbers are comma-separated) and spaced out.
// Card text and images stay on their servers: the app only caches what you look up, for your own use.
import { DEMO_CARDS } from './data/demo.js';

const API = 'https://digimoncard.io/api-public/search';
const IMG = (id) => `https://images.digimoncard.io/images/cards/${encodeURIComponent(id)}.jpg`;
const DB = 'digisim-cards'; const STORE = 'cards'; const FORMAT = 1;

// ---------- tiny IndexedDB cache (falls back to memory in Node / private mode) ----------
const mem = new Map();
let dbp = null;
function db() {
  if (typeof indexedDB === 'undefined') return Promise.resolve(null);
  if (!dbp) dbp = new Promise((res) => { const r = indexedDB.open(DB, 1); r.onupgradeneeded = () => r.result.createObjectStore(STORE); r.onsuccess = () => res(r.result); r.onerror = () => res(null); });
  return dbp;
}
async function cacheGet(id) {
  if (mem.has(id)) return mem.get(id);
  const d = await db(); if (!d) return null;
  return new Promise((res) => { const q = d.transaction(STORE).objectStore(STORE).get(id); q.onsuccess = () => { const v = q.result; if (v && v.f === FORMAT) { mem.set(id, v.c); res(v.c); } else res(null); }; q.onerror = () => res(null); });
}
async function cachePut(card) {
  mem.set(card.id, card);
  const d = await db(); if (!d) return;
  d.transaction(STORE, 'readwrite').objectStore(STORE).put({ f: FORMAT, c: card, t: Date.now() }, card.id);
}

// ---------- API → app card ----------
const colorList = (a) => [a.color, a.color2].filter((c) => c && c !== 'null').flatMap((c) => String(c).split(/\s*\/\s*/));
export function fromApi(a) {
  const type = a.type === 'Digi-Egg' || /egg/i.test(a.type || '') ? 'Digi-Egg' : a.type;
  const evo = [];
  if (a.evolution_cost != null && a.evolution_level != null) evo.push({ color: a.evolution_color || a.color, level: +a.evolution_level, cost: +a.evolution_cost });
  // "Digivolve" lines in the text, e.g. "Digivolve: Lv.4 Red: Cost 3" or "[Digivolve] 2 from Lv.4".
  const main = String(a.main_effect || '');
  for (const m of main.matchAll(/Lv\.?\s?(\d)\s*(?:w\/\s*)?([A-Za-z/ ]+?)?\s*:\s*Cost\s*(\d+)/g)) evo.push({ color: (m[2] || a.color || '').trim(), level: +m[1], cost: +m[3] });
  const alt = String(a.alt_effect || '');
  const security = /\[security\]/i.test(alt) ? alt : '';
  return {
    id: a.id || a.cardnumber, name: a.name, type, level: a.level != null ? +a.level : null, playCost: a.play_cost != null ? +a.play_cost : null,
    dp: a.dp != null ? +a.dp : null, colors: colorList(a), evo: dedupeEvo(evo), traits: [a.form, a.attribute, a.digi_type, a.digi_type2].filter((x) => x && x !== 'null').flatMap((x) => String(x).split(/\s*\/\s*/)),
    main: [main, security ? '' : alt].filter(Boolean).join('\n'), inherited: a.source_effect || '', security, image: IMG(a.id || a.cardnumber),
    rarity: a.rarity || '', set: Array.isArray(a.set_name) ? a.set_name[0] : a.set_name || '',
  };
}
function dedupeEvo(list) { const seen = new Set(); return list.filter((e) => { const k = `${e.color}|${e.level}|${e.cost}`; if (seen.has(k)) return false; seen.add(k); return true; }); }

let lastCall = 0;
const pause = (ms) => new Promise((r) => setTimeout(r, ms));
async function apiGet(params) {
  const wait = lastCall + 800 - Date.now(); if (wait > 0) await pause(wait);
  lastCall = Date.now();
  const url = `${API}?${new URLSearchParams({ series: 'Digimon Card Game', ...params })}`;
  const r = await fetch(url);
  if (r.status === 400) return [];
  if (r.status === 429) { await pause(5000); return apiGet(params); }
  if (!r.ok) throw new Error(`Card lookup failed (${r.status})`);
  const j = await r.json();
  return Array.isArray(j) ? j : [];
}

// Look up cards by number (e.g. "BT1-010"). Returns Map id → card; missing ids are left out.
export async function getCards(ids, onProgress) {
  const want = [...new Set(ids.map((x) => String(x).toUpperCase().trim()).filter(Boolean))];
  const out = new Map(); const need = [];
  for (const id of want) {
    const demo = DEMO_CARDS[id]; if (demo) { out.set(id, demo); continue; }
    const c = await cacheGet(id); if (c) out.set(id, c); else need.push(id);
  }
  for (let i = 0; i < need.length; i += 25) {
    const batch = need.slice(i, i + 25);
    onProgress?.(`Looking up cards ${i + 1}–${Math.min(need.length, i + batch.length)} of ${need.length}…`);
    const rows = await apiGet({ card: batch.join(',') });
    for (const row of rows) {
      const c = fromApi(row); const id = String(c.id).toUpperCase();
      if (!batch.includes(id) || out.has(id)) continue; // the API can return alternate printings; keep the first
      out.set(id, c); await cachePut(c);
    }
  }
  return out;
}
// Name search (for lists without card numbers). Returns the newest matching card with exactly that name, if any.
export async function findByName(name) {
  const rows = await apiGet({ n: name, sort: 'code', sortdirection: 'desc' });
  const exact = rows.filter((r) => String(r.name).toLowerCase() === String(name).toLowerCase());
  const pick = exact[0] || null; if (!pick) return null;
  const c = fromApi(pick); await cachePut(c); return c;
}
export const imageFor = (card) => (card?.demo ? '' : card?.image || '');
