// Small shared helpers. No DOM access here so the engine can run in Node for tests.

let _id = 0;
export const uid = (p = 'o') => `${p}${++_id}`;
// After restoring a saved game, make sure new ids never collide with restored ones.
export function bumpIds(ids) { for (const id of ids) { const n = parseInt(String(id).replace(/^\D+/, ''), 10); if (n > _id) _id = n; } }

// Seedable PRNG (mulberry32) so games can be replayed / tested deterministically.
export function makeRng(seed = Date.now() >>> 0) {
  let a = seed >>> 0;
  const rng = () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  rng.seed = seed;
  rng.getState = () => a;
  rng.setState = (v) => { a = v >>> 0; };
  return rng;
}

export function shuffle(arr, rng = Math.random) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

export const sum = (a, f = (x) => x) => a.reduce((s, x) => s + f(x), 0);
export const maxBy = (a, f) => a.reduce((b, x) => (b === undefined || f(x) > f(b) ? x : b), undefined);
export const minBy = (a, f) => a.reduce((b, x) => (b === undefined || f(x) < f(b) ? x : b), undefined);
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const WORD_NUM = { a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, twenty: 20 };
export function wordToNum(w, x = 0) {
  if (w == null) return 1;
  const s = String(w).toLowerCase().trim();
  if (s === 'x') return x;
  if (/^\d+$/.test(s)) return parseInt(s, 10);
  return WORD_NUM[s] ?? 1;
}

// Normalise card names for matching: lower case, strip accents and punctuation differences.
export function normName(n) {
  return String(n || '')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase().replace(/[’`]/g, "'").replace(/\s+/g, ' ').trim();
}

export function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
