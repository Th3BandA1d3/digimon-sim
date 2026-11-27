// Deck list import. Understands the common formats:
//   "4 Agumon BT1-010", "4 BT1-010", "BT1-010 x4", "4x Agumon (BT1-010)", "Agumon BT1-010 4"
//   Tabletop Simulator / digimoncard.dev JSON: ["Exported from …", "BT1-001", "BT1-010", "BT1-010", …]
// Headers ("Digi-Egg", "// Main deck", "Tamers:") and blank lines are ignored.
const ID_RE = /\b((?:BT|EX|ST|RB|LM|P|BO|DEMO-[A-Z])\d*-?\d+[A-Z]?|DEMO-[A-Z]\d{2})\b/i;

export function parseDeckText(text) {
  const t = String(text || '').trim();
  const out = new Map(); const named = new Map(); const errors = [];
  const add = (id, qty, name) => {
    if (id) { const k = id.toUpperCase(); const e = out.get(k) || { id: k, qty: 0, name }; e.qty += qty; out.set(k, e); return; }
    const k = name.toLowerCase(); const e = named.get(k) || { name, qty: 0 }; e.qty += qty; named.set(k, e);
  };
  if (/^\[/.test(t)) {
    try { for (const x of JSON.parse(t)) { const m = ID_RE.exec(String(x)); if (m) add(m[1], 1); } return finish(); } catch { /* not JSON: fall through */ }
  }
  for (let line of t.split(/\r?\n/)) {
    line = line.replace(/\/\/.*$/, '').replace(/#.*$/, '').trim();
    if (!line || /^(digi-?egg|eggs?|main( deck)?|digimon|tamers?|options?|deck|side ?deck)s?\s*[:(]?.*$/i.test(line) && !/\d/.test(line.replace(/\(\d+\)/, ''))) continue;
    let qty = 1; let m;
    if ((m = /^(\d+)\s*x?\s+(.+)$/i.exec(line))) { qty = +m[1]; line = m[2]; }
    else if ((m = /^(.+?)\s+x?(\d+)$/i.exec(line)) && !ID_RE.test(m[2])) { qty = +m[2]; line = m[1]; }
    const idm = ID_RE.exec(line);
    const id = idm ? idm[1] : null;
    const name = line.replace(ID_RE, '').replace(/[()[\]]/g, '').replace(/\s{2,}/g, ' ').trim();
    if (!id && !name) { errors.push(line); continue; }
    add(id, qty, name);
  }
  return finish();
  function finish() { return { cards: [...out.values()], named: [...named.values()], errors }; }
}

// Build a playable deck from looked-up cards: Digi-Eggs go to the egg deck, everything else to the main deck.
export function splitDeck(entries, cardsById) {
  const main = []; const eggs = []; const missing = [];
  for (const e of entries) {
    const c = cardsById.get(e.id); if (!c) { missing.push(e); continue; }
    (c.type === 'Digi-Egg' ? eggs : main).push({ id: c.id, qty: e.qty, name: c.name });
  }
  return { main, eggs, missing };
}
export function checkDeck(deck) {
  const warn = [];
  const n = deck.main.reduce((s, e) => s + e.qty, 0); const ne = deck.eggs.reduce((s, e) => s + e.qty, 0);
  if (n !== 50) warn.push(`The main deck has ${n} cards (it should have exactly 50).`);
  if (ne > 5) warn.push(`The Digi-Egg deck has ${ne} cards (5 at most).`);
  for (const e of [...deck.main, ...deck.eggs]) if (e.qty > 4) warn.push(`${e.name} (${e.id}): ${e.qty} copies (4 at most).`);
  return warn;
}
export function deckToText(deck) {
  return ['// Digi-Egg deck', ...deck.eggs.map((e) => `${e.qty} ${e.name} ${e.id}`), '// Main deck', ...deck.main.map((e) => `${e.qty} ${e.name} ${e.id}`)].join('\n');
}
