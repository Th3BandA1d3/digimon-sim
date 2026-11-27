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
  // Some phones (private mode, low storage) never answer the open request: give up after 2 s and use memory only.
  if (!dbp) dbp = new Promise((res) => {
    const t = setTimeout(() => res(null), 2000);
    try {
      const r = indexedDB.open(DB, 1);
      r.onupgradeneeded = () => r.result.createObjectStore(STORE);
      r.onsuccess = () => { clearTimeout(t); res(r.result); }; r.onerror = r.onblocked = () => { clearTimeout(t); res(null); };
    } catch { clearTimeout(t); res(null); }
  });
  return dbp;
}
async function cacheGet(id) {
  if (mem.has(id)) return mem.get(id);
  const d = await db(); if (!d) return null;
  return new Promise((res) => {
    try { const q = d.transaction(STORE).objectStore(STORE).get(id); q.onsuccess = () => { const v = q.result; if (v && v.f === FORMAT) { mem.set(id, v.c); res(v.c); } else res(null); }; q.onerror = () => res(null); } catch { res(null); }
  });
}
async function cachePut(card) {
  mem.set(card.id, card);
  const d = await db(); if (!d) return;
  try { d.transaction(STORE, 'readwrite').objectStore(STORE).put({ f: FORMAT, c: card, t: Date.now() }, card.id); } catch { /* memory cache still has it */ }
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
// One API call: spaced ~0.8 s apart, 15 s time limit, at most 3 waits on "too many requests". Errors say what happened.
export class LookupError extends Error {}
async function apiGet(params, tries = 0) {
  const wait = lastCall + 800 - Date.now(); if (wait > 0) await pause(wait);
  lastCall = Date.now();
  const url = `${API}?${new URLSearchParams({ series: 'Digimon Card Game', ...params })}`;
  const ctl = typeof AbortController !== 'undefined' ? new AbortController() : null;
  const timer = setTimeout(() => ctl?.abort(), 15000);
  let r;
  try { r = await fetch(url, ctl ? { signal: ctl.signal } : undefined); }
  catch (e) { throw new LookupError(e?.name === 'AbortError' ? 'DigimonCard.io took too long to answer.' : "Couldn't reach DigimonCard.io (offline, or the site is down)."); }
  finally { clearTimeout(timer); }
  if (r.status === 400 || r.status === 404) return []; // "No cards found for this search."
  if (r.status === 429) {
    if (tries >= 3) throw new LookupError('DigimonCard.io says too many requests — wait a few minutes and try again.');
    await pause(5000 * (tries + 1)); return apiGet(params, tries + 1);
  }
  if (!r.ok) throw new LookupError(`DigimonCard.io lookup failed (error ${r.status}).`);
  let j; try { j = await r.json(); } catch { throw new LookupError('DigimonCard.io sent back something unexpected.'); }
  return Array.isArray(j) ? j : [];
}
const rowId = (row) => String(row.id || row.cardnumber || row.card_number || '').toUpperCase();

// Look up cards by number (e.g. "BT1-010"). Returns Map id → card; missing ids are left out.
// Asks for up to 25 numbers per call; anything a batch didn't return is retried one card at a time.
export async function getCards(ids, onProgress) {
  const want = [...new Set(ids.map((x) => String(x).toUpperCase().trim()).filter(Boolean))];
  const out = new Map(); const need = [];
  for (const id of want) {
    const demo = DEMO_CARDS[id]; if (demo) { out.set(id, demo); continue; }
    const c = await cacheGet(id); if (c) out.set(id, c); else need.push(id);
  }
  const keep = async (rows, allowed) => {
    for (const row of rows) {
      const id = rowId(row);
      if (!allowed.includes(id) || out.has(id)) continue; // the API can return alternate printings; keep the first
      const c = fromApi(row); c.id = id; out.set(id, c); await cachePut(c);
    }
  };
  for (let i = 0; i < need.length; i += 25) {
    const batch = need.slice(i, i + 25);
    onProgress?.(`Looking up cards ${i + 1}–${i + batch.length} of ${need.length}…`);
    await keep(await apiGet({ card: batch.join(',') }), batch);
  }
  const left = need.filter((id) => !out.has(id));
  if (left.length) {
    for (let i = 0; i < left.length; i++) {
      onProgress?.(`Looking up ${left[i]} (${i + 1} of ${left.length})…`);
      await keep(await apiGet({ card: left[i] }), [left[i]]);
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
