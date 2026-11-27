// Dev menu support: the owner's local rule fixes, the log of text that wasn't automated, effect templates for the fix
// builder, and sending a fix to Claude as a GitHub issue. Safe to import in Node (no DOM).
import { SHIPPED_FIXES } from './rulefixes.js';

export const APP_VERSION = 'v1'; // keep in step with VERSION in sw.js
export const REPO = 'Th3BandA1d3/digimon-sim';
const FIXES = 'digisim.dev.fixes.v1';
const FOUND = 'digisim.dev.found.v1';
const DEV = 'digisim.dev.on';
const TOKEN_KEY = 'digisim.dev.ghtoken';
// SHA-256 of the owner's dev passcode (the same one as Commander Sim). Change it by asking for a new code.
export const DEV_HASH = 'ba4aef0538d7aef3086c7c82c7f9de4a685cb5d3c522546aeb15bf30d41aa86d';

const store = () => { try { return typeof localStorage !== 'undefined' ? localStorage : null; } catch { return null; } };
const read = (k, d) => { try { return JSON.parse(store()?.getItem(k) || 'null') ?? d; } catch { return d; } };
const write = (k, v) => { try { store()?.setItem(k, JSON.stringify(v)); } catch { /* storage full or blocked */ } };

export const devOn = () => store()?.getItem(DEV) === '1';
export function setDev(on) { if (on) store()?.setItem(DEV, '1'); else store()?.removeItem(DEV); }
export async function checkDevCode(code) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(String(code).trim()));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('') === DEV_HASH;
}

// One key per piece of text: lower case, no reminder text, straight quotes, no final full stop.
export function normRule(t) {
  return String(t || '').replace(/\((?!deck\)|hand\)|trash\))[^)]*\)/gi, '').replace(/[“”]/g, '"').replace(/[‘’]/g, "'").toLowerCase().replace(/\s+/g, ' ').replace(/\.\s*$/, '').trim();
}

let table = null;
function fixTable() {
  if (table) return table;
  table = new Map();
  for (const f of SHIPPED_FIXES) table.set(normRule(f.match), { ...f, shipped: true });
  for (const f of localFixes()) if (f.enabled !== false) table.set(normRule(f.match), f);
  return table;
}
// Number wildcards: a fix whose text contains {n1}, {n2}… matches the same wording with any numbers.
const NUMW = '(\\d+)';
let patterns = null;
function patternList() {
  if (patterns) return patterns;
  patterns = [];
  for (const f of fixTable().values()) {
    const k = normRule(f.match);
    if (!/\{n\d*\}/.test(k)) continue;
    const names = [];
    const src = k.replace(/\{n(\d*)\}/g, (_, d) => `\u0001${d}\u0002`).replace(/[.*+?^$()|[\]\\{}]/g, '\\$&').replace(/\u0001(\d*)\u0002/g, (_, d) => { names.push('n' + d); return NUMW; });
    patterns.push({ re: new RegExp('^' + src + '$'), names, f });
  }
  return patterns;
}
let preview = null; // a fix being tried out in the editor
export function setPreviewFix(f) { preview = f ? { ...f, key: normRule(f.match) } : null; patterns = null; }
// The replacement text for a sentence or ability, or null when there is no fix.
export function fixFor(text) {
  const k = normRule(text);
  if (preview && preview.key === k) return preview.replace;
  const f = fixTable().get(k); if (f) return f.replace;
  for (const p of patternList()) {
    const m = p.re.exec(k); if (!m) continue;
    let out = p.f.replace; p.names.forEach((nm, i) => { out = out.split('{' + nm + '}').join(m[i + 1]); });
    return out;
  }
  return null;
}
// Turn the numbers in a fix into wildcards: "gets -3000 DP" → "gets -{n1} DP" (and the same number in the replacement).
export function wildcardFix(match, replace) {
  const nums = []; let i = 0;
  const m2 = match.replace(/\b(\d+)\b/g, (w) => { nums.push(w); i++; return `{n${i}}`; });
  let r2 = replace;
  nums.forEach((w, j) => { r2 = r2.replace(new RegExp(`\\b${w}\\b`), `{n${j + 1}}`); });
  return { match: m2, replace: r2, count: nums.length };
}
export function shippedFixes() { return SHIPPED_FIXES; }
export function localFixes() { return read(FIXES, []); }
export function saveLocalFixes(list) { write(FIXES, list); table = null; patterns = null; }
export function upsertFix(fix) {
  const list = localFixes().filter((f) => normRule(f.match) !== normRule(fix.match));
  list.unshift({ ...fix, updated: Date.now() });
  saveLocalFixes(list);
}

// Text the game had to hand to the player ("Manual step") or flagged as not automated.
export function recordFound({ card, text, full, where, id }) {
  if (!devOn() || !text) return;
  const list = read(FOUND, []);
  const k = normRule(text);
  let e = list.find((x) => normRule(x.text) === k);
  if (!e) { e = { text, cards: [], full: {}, where, count: 0, first: Date.now() }; list.unshift(e); }
  e.count++; e.last = Date.now();
  if (card && !e.cards.includes(card)) { e.cards.push(card); if (full) e.full[card] = full; if (id) { e.ids = e.ids || {}; e.ids[card] = id; } }
  write(FOUND, list.slice(0, 400));
}
export function listFound() { return read(FOUND, []); }
export function saveFound(list) { write(FOUND, list); }

// ---------- Effect templates for the fix builder: every one produces text the parser understands ----------
const T = (label, fields, make) => ({ label, fields, make });
const N = (label = 'How many', def = 1) => ({ name: 'n', label, type: 'number', def });
const DP = { name: 'dp', label: 'DP', type: 'number', def: 3000, step: 1000 };
const WHO_OPP = { name: 'w', label: 'Which', type: 'select', options: ["1 of your opponent's Digimon", "all of your opponent's Digimon"] };
const DUR = { name: 'd', label: 'For', type: 'select', options: ['for the turn', "until the end of your opponent's turn"] };
const KW = ['Blocker', 'Rush', 'Piercing', 'Jamming', 'Reboot', 'Retaliation', 'Security A. +1', 'Security A. -1', 'Alliance', 'Barrier', 'Evade', 'Raid', 'Fortitude'];
export const TEMPLATES = [
  T('Draw', [N()], (v) => `<Draw ${v.n}>`),
  T('Gain memory', [N()], (v) => `Gain ${v.n} memory.`),
  T('Lose memory', [N()], (v) => `Lose ${v.n} memory.`),
  T('Set memory', [N('Set to', 3)], (v) => `Set your memory to ${v.n}.`),
  T('Delete (DP or less)', [DP], (v) => `Delete 1 of your opponent's Digimon with ${v.dp} DP or less.`),
  T('Delete (level or lower)', [N('Level', 4)], (v) => `Delete 1 of your opponent's level ${v.n} Digimon.`),
  T('Delete (any)', [], () => "Delete 1 of your opponent's Digimon."),
  T('Delete all (DP or less)', [DP], (v) => `Delete all of your opponent's Digimon with ${v.dp} DP or less.`),
  T('Minus DP', [WHO_OPP, DP, DUR], (v) => `${v.w[0].toUpperCase() + v.w.slice(1)} ${v.w.startsWith('all') ? 'get' : 'gets'} -${v.dp} DP ${v.d}.`),
  T('Plus DP (this Digimon)', [DP, DUR], (v) => `This Digimon gets +${v.dp} DP ${v.d}.`),
  T('Plus DP (1 of yours)', [DP, DUR], (v) => `1 of your Digimon gets +${v.dp} DP ${v.d}.`),
  T('Plus DP (all of yours)', [DP, DUR], (v) => `All of your Digimon get +${v.dp} DP ${v.d}.`),
  T('Gain a keyword (this Digimon)', [{ name: 'k', label: 'Keyword', type: 'select', options: KW }, DUR], (v) => `This Digimon gains <${v.k}> ${v.d}.`),
  T('Gain a keyword (1 of yours)', [{ name: 'k', label: 'Keyword', type: 'select', options: KW }, DUR], (v) => `1 of your Digimon gains <${v.k}> ${v.d}.`),
  T('Suspend an opponent\'s Digimon', [], () => "Suspend 1 of your opponent's Digimon."),
  T('Unsuspend this Digimon', [], () => 'Unsuspend this Digimon.'),
  T('Unsuspend 1 of yours', [], () => 'Unsuspend 1 of your Digimon.'),
  T('Bounce to hand', [DP], (v) => `Return 1 of your opponent's Digimon with ${v.dp} DP or less to the hand.`),
  T('Bottom of deck', [DP], (v) => `Place 1 of your opponent's Digimon with ${v.dp} DP or less at the bottom of the deck.`),
  T('Trash opponent\'s security', [N()], (v) => `Trash the top ${v.n > 1 ? v.n + ' cards' : 'card'} of your opponent's security stack.`),
  T('Recovery (deck)', [N()], (v) => `<Recovery +${v.n} (Deck)>`),
  T('De-Digivolve', [N()], (v) => `<De-Digivolve ${v.n}> 1 of your opponent's Digimon.`),
  T('Reveal and add', [N('Reveal', 3), { name: 'what', label: 'Add', type: 'select', options: ['Digimon card', 'Tamer card', 'Option card', 'card'] }], (v) => `Reveal the top ${v.n} cards of your deck. Add 1 ${v.what} among them to the hand. Trash the rest.`),
  T('Trash from hand', [N()], (v) => `Trash ${v.n} card${v.n > 1 ? 's' : ''} in your hand.`),
  T('Play from hand (free)', [N('Max level', 4)], (v) => `Play 1 level ${v.n} or lower Digimon card from your hand without paying the cost.`),
  T('Play from trash (free)', [N('Max level', 3)], (v) => `Play 1 level ${v.n} or lower Digimon card from your trash without paying the cost.`),
  T('Security: play this Tamer', [], () => 'Play this card without paying the cost.'),
  T('Security: use this Option', [], () => "Activate this card's [Main] effect."),
  T('Security: add to hand', [], () => 'Add this card to the hand.'),
  T('Ignore this text', [], () => ''),
];
export const TIMINGS = ['[On Play]', '[When Digivolving]', '[When Attacking]', '[On Deletion]', '[Main]', '[Security]', '[Your Turn]', "[Opponent's Turn]", '[All Turns]', '[Start of Your Turn]', '[End of Your Turn]', '[Start of Your Main Phase]'];
export const CONDITIONS = ['If you have a Tamer,', 'If you have 3 or fewer security cards,', 'If your opponent has 3 or more security cards,', 'If you have 2 or less memory,', 'If this Digimon has 4 or more digivolution cards,'];

// ---------- Sending a single fix to Claude ----------
// A fix saved with a note for Claude is sent as a GitHub issue labelled "rule-fix". Claude builds it in properly,
// pushes a new version, and closes the issue.
export const ghToken = () => { try { return localStorage.getItem(TOKEN_KEY) || ''; } catch { return ''; } };
export const setGhToken = (t) => { try { if (t) localStorage.setItem(TOKEN_KEY, t.trim()); else localStorage.removeItem(TOKEN_KEY); } catch { /* private mode */ } };
export function fixIssue(fix) {
  const short = (fix.match || '').replace(/\s+/g, ' ').slice(0, 60);
  const payload = { kind: 'digimon-sim-rule-fix', appVersion: APP_VERSION, fix: { match: fix.match, replace: fix.replace, wildcard: !!fix.wildcard, card: fix.card, id: fix.id, full: fix.full, notes: fix.notes } };
  const body = `**Note for Claude:** ${fix.notes}\n\n**Card:** ${fix.card || '—'}${fix.id ? ` (${fix.id})` : ''}\n\n**Not automated:** ${fix.match}\n\n**My fix:** ${fix.replace || '(ignore this text)'}\n\n<details><summary>Data</summary>\n\n\`\`\`json\n${JSON.stringify(payload, null, 1)}\n\`\`\`\n</details>\n`;
  return { title: `Rule fix: ${fix.card ? fix.card + ' — ' : ''}${short}`, body, labels: ['rule-fix'] };
}
export function manualIssueUrl(fix) {
  const issue = fixIssue(fix);
  return `https://github.com/${REPO}/issues/new?labels=rule-fix&title=${encodeURIComponent(issue.title)}&body=${encodeURIComponent(issue.body.slice(0, 6500))}`;
}
export async function sendFixToClaude(fix) {
  const token = ghToken();
  if (!token) return { ok: true, manual: true, url: manualIssueUrl(fix) };
  try {
    const r = await fetch(`https://api.github.com/repos/${REPO}/issues`, { method: 'POST', headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json' }, body: JSON.stringify(fixIssue(fix)) });
    if (r.ok) { const j = await r.json(); return { ok: true, number: j.number, url: j.html_url }; }
    return { ok: false, error: `GitHub said ${r.status}${r.status === 401 ? ' (token not accepted)' : r.status === 403 || r.status === 404 ? ' (token needs Issues: read and write on this repo)' : ''}` };
  } catch { return { ok: false, error: 'No connection to GitHub' }; }
}
export async function sentStatus(numbers) {
  const out = {};
  await Promise.all(numbers.map(async (n) => {
    try { const r = await fetch(`https://api.github.com/repos/${REPO}/issues/${n}`, { headers: { Accept: 'application/vnd.github+json' } }); if (r.ok) out[n] = (await r.json()).state; } catch { /* offline */ }
  }));
  return out;
}
export function exportBundle() {
  return { kind: 'digimon-sim-fixes', appVersion: APP_VERSION, exported: new Date().toISOString(), fixes: localFixes(), unfixed: listFound().filter((f) => !fixFor(f.text)).slice(0, 80) };
}
