// Card text parser: turns Digimon Card Game effect text into data the engine can run.
// Text is split into abilities by timing tags ([On Play], [When Digivolving], [Your Turn] …), each ability into
// sentences, and each sentence is matched against rule(...) patterns below. Anything not understood is kept in
// `unhandled` so the game can hand it to the player as a manual step (and the Dev menu can collect it).
import { fixFor } from './devfixes.js';

export const COLORS = ['Red', 'Blue', 'Yellow', 'Green', 'Black', 'Purple', 'White'];
export const TIMING_TAGS = {
  'on play': 'onPlay', 'when digivolving': 'whenDigivolving', 'when attacking': 'whenAttacking', 'on deletion': 'onDeletion',
  main: 'main', security: 'security', 'your turn': 'yourTurn', "opponent's turn": 'oppTurn', 'all turns': 'allTurns',
  'start of your turn': 'startOfYourTurn', 'end of your turn': 'endOfYourTurn', 'start of your main phase': 'startOfMain',
  "start of opponent's turn": 'startOfOppTurn', "end of opponent's turn": 'endOfOppTurn', 'end of all turns': 'endOfAllTurns', counter: 'counter',
  'once per turn': 'once', 'twice per turn': 'twice', hand: 'hand', breeding: 'breeding', trash: 'trash',
};
const TAG_RE = new RegExp(`\\[(${Object.keys(TIMING_TAGS).map((k) => k.replace(/'/g, "'")).join('|')})\\]`, 'gi');
// Keywords a card can have. Value: how the engine stores it.
export const KEYWORDS = {
  blocker: 'blocker', rush: 'rush', piercing: 'piercing', jamming: 'jamming', reboot: 'reboot', retaliation: 'retaliation',
  alliance: 'alliance', barrier: 'barrier', evade: 'evade', raid: 'raid', fortitude: 'fortitude', 'armor purge': 'armorPurge',
  blitz: 'blitz', collision: 'collision', progress: 'progress', vortex: 'vortex', iceclad: 'iceclad',
};

const NUMW = { a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, all: 99 };
const num = (s) => (s == null ? 1 : /^\d+$/.test(s) ? +s : NUMW[s] ?? 1);

// ---------- normalising ----------
export function normText(t) {
  let s = String(t || '').replace(/[＜〈]/g, '<').replace(/[＞〉]/g, '>').replace(/[［]/g, '[').replace(/[］]/g, ']').replace(/[“”]/g, '"').replace(/[‘’]/g, "'").replace(/\r/g, '');
  // Keep "(Deck)" etc. inside <...>, drop reminder text in parentheses elsewhere.
  const keep = [];
  s = s.replace(/<[^>]*>/g, (m) => { keep.push(m); return `\u0001${keep.length - 1}\u0002`; });
  s = s.replace(/\s*\([^)]*\)/g, '');
  s = s.replace(/\u0001(\d+)\u0002/g, (_, i) => keep[+i]);
  return s.replace(/[ \t]+/g, ' ').replace(/\s*\n\s*/g, '\n').trim();
}
export function splitSentences(s) {
  const out = []; let cur = ''; let depth = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s[i]; cur += c;
    if (c === '<' || c === '[') depth++;
    if (c === '>' || c === ']') depth = Math.max(0, depth - 1);
    if ((c === '.' || c === '\n') && depth === 0) { const t = cur.replace(/\n/g, ' ').trim(); if (t && t !== '.') out.push(t); cur = ''; }
  }
  if (cur.trim()) out.push(cur.trim());
  // "<Draw 1>" written with no full stop before the next sentence.
  return out.flatMap((x) => x.split(/(?<=>)\s+(?=[A-Z])/)).map((x) => x.trim()).filter(Boolean);
}

// ---------- who / which Digimon ----------
// "1 of your opponent's Digimon with 4000 DP or less", "up to 2 of your opponent's level 3 Digimon", "1 of your other Digimon",
// "all of your opponent's suspended Digimon", "1 of your Tamers". Returns null when a word isn't understood.
export function parseWho(phrase) {
  let p = ` ${phrase.toLowerCase().trim()} `;
  const w = { side: null, count: 1, upTo: false, all: false, f: {} };
  let m;
  if ((m = /^ (up to )?(\d+|one|two|three|all) of /.exec(p))) { w.upTo = !!m[1]; if (m[2] === 'all') w.all = true; else w.count = num(m[2]); p = ' ' + p.slice(m[0].length); }
  else if ((m = /^ all /.exec(p))) { w.all = true; p = ' ' + p.slice(m[0].length); }
  else return null;
  const take = (re, fn) => { const r = re.exec(p); if (!r) return; fn(r); p = p.slice(0, r.index) + ' ' + p.slice(r.index + r[0].length); };
  take(/ your opponent's /, () => { w.side = 'opp'; });
  take(/ your /, () => { w.side = w.side || 'mine'; });
  take(/ their /, () => { w.side = w.side || 'opp'; });
  take(/ with (\d+) dp or less\b/, (r) => { w.f.maxDp = +r[1]; });
  take(/ with (\d+) dp or more\b/, (r) => { w.f.minDp = +r[1]; });
  take(/ with the (lowest|highest) dp\b/, (r) => { w.f.pick = r[1] + 'Dp'; });
  take(/ with the (lowest|highest) level\b/, (r) => { w.f.pick = r[1] + 'Level'; });
  take(/ with a play cost of (\d+) or less\b/, (r) => { w.f.maxCost = +r[1]; });
  take(/ with (?:as many or )?(?:no|0) digivolution cards\b/, () => { w.f.noSources = true; });
  take(/ with \[([^\]]+)\] in (?:its|their) names?\b/, (r) => { w.f.nameIncl = r[1].toLowerCase(); });
  take(/ with (?:the )?\[([^\]]+)\] trait\b|with \[([^\]]+)\] in (?:its|their) traits?\b/, (r) => { w.f.trait = (r[1] || r[2]).toLowerCase(); });
  take(/ level (\d+) or (?:lower|less)\b/, (r) => { w.f.maxLevel = +r[1]; });
  take(/ level (\d+) or (?:higher|more)\b/, (r) => { w.f.minLevel = +r[1]; });
  take(/ level (\d+)\b/, (r) => { w.f.level = +r[1]; });
  for (const word of p.trim().split(/\s+/).filter(Boolean)) {
    if (word === 'other') w.f.other = true;
    else if (word === 'suspended') w.f.suspended = true;
    else if (word === 'unsuspended') w.f.unsuspended = true;
    else if (/^digimon$/.test(word)) w.f.kind = w.f.kind || 'digimon';
    else if (/^tamers?$/.test(word)) w.f.kind = 'tamer';
    else if (COLORS.map((c) => c.toLowerCase()).includes(word)) w.f.color = word[0].toUpperCase() + word.slice(1);
    else return null;
  }
  if (!w.side || !w.f.kind) return null;
  return w;
}

// ---------- conditions ----------
export function parseCond(c) {
  c = c.toLowerCase().trim().replace(/,$/, ''); let m;
  if (/^you have a tamer$/.test(c)) return { k: 'haveTamer' };
  if ((m = /^you have (\d+) or (?:fewer|less) security cards?$/.exec(c))) return { k: 'mySec', max: +m[1] };
  if ((m = /^you have (\d+) or more security cards?$/.exec(c))) return { k: 'mySec', min: +m[1] };
  if ((m = /^your opponent has (\d+) or more security cards?$/.exec(c))) return { k: 'oppSec', min: +m[1] };
  if ((m = /^your opponent has (\d+) or (?:fewer|less) security cards?$/.exec(c))) return { k: 'oppSec', max: +m[1] };
  if ((m = /^you have (\d+) or (?:less|fewer) memory$/.exec(c))) return { k: 'mem', max: +m[1] };
  if ((m = /^this digimon has (\d+) or more digivolution cards$/.exec(c))) return { k: 'sources', min: +m[1] };
  if ((m = /^you have (\d+) or more digimon$/.exec(c))) return { k: 'myDigimon', min: +m[1] };
  if ((m = /^your opponent has (\d+) or more digimon$/.exec(c))) return { k: 'oppDigimon', min: +m[1] };
  if (/^it'?s your turn$/.test(c)) return { k: 'myTurn' };
  if ((m = /^you have (\d+) or (?:fewer|less) cards in your hand$/.exec(c))) return { k: 'hand', max: +m[1] };
  if ((m = /^you have a (red|blue|yellow|green|black|purple|white) tamer$/.exec(c))) return { k: 'haveTamer', color: m[1][0].toUpperCase() + m[1].slice(1) };
  return null;
}

// ---------- effect sentences ----------
const R = [];
const rule = (re, fn) => R.push([re, fn]);
const DUR = "(for the turn|until the end of your opponent's turn|until end of turn|this turn)";
const dur = (d) => (/opponent/.test(d || '') ? 'oppTurn' : 'turn');
const kwKey = (k) => {
  const s = k.toLowerCase().trim(); let m;
  if ((m = /^security a(?:ttack|\.)? ?([+-]\d+)$/.exec(s))) return { sa: +m[1] };
  if (KEYWORDS[s]) return { [KEYWORDS[s]]: true };
  return null;
};

rule(/^<draw (\d+)>$|^draw (\d+) cards?$/, (m) => ({ type: 'draw', n: +(m[1] || m[2]) }));
rule(/^gain (\d+) memory$/, (m) => ({ type: 'memory', n: +m[1] }));
rule(/^lose (\d+) memory$/, (m) => ({ type: 'memory', n: -m[1] }));
rule(/^set your memory to (\d+)$/, (m) => ({ type: 'setMemory', n: +m[1] }));
rule(/^trash (\d+) cards? (?:in|from) your hand$/, (m) => ({ type: 'discard', n: +m[1] }));
rule(/^your opponent trashes (\d+) cards? (?:in|from) their hand$/, (m) => ({ type: 'oppDiscard', n: +m[1] }));
rule(/^trash the top (\d+) cards? of your deck$/, (m) => ({ type: 'mill', n: +m[1] }));
rule(/^<recovery \+(\d+) \(deck\)>$/, (m) => ({ type: 'recovery', n: +m[1] }));
rule(/^trash the top (?:card|(\d+) cards) of your opponent's security stack$/, (m) => ({ type: 'trashSecurity', n: +(m[1] || 1) }));
rule(/^delete (.+?)$/, (m) => { const w = parseWho(m[1]); return w && { type: 'delete', who: w }; });
rule(new RegExp(`^(.+?) (?:gets|get) ([+-]\\d+) dp(?: ${DUR})?$`), (m) => {
  const n = +m[2]; const d = dur(m[3]);
  if (/^this (?:digimon|card)$/.test(m[1])) return { type: 'dp', self: true, n, dur: d };
  const w = parseWho(m[1]); return w && { type: 'dp', who: w, n, dur: d };
});
rule(new RegExp(`^(.+?) (?:gains|gain) <([^>]+)>(?: and <([^>]+)>)?(?: ${DUR})?$`), (m) => {
  const k = { ...kwKey(m[2]), ...(m[3] ? kwKey(m[3]) : {}) }; if (!kwKey(m[2]) || (m[3] && !kwKey(m[3]))) return null;
  const d = dur(m[4]);
  if (/^this (?:digimon|card)$/.test(m[1])) return { type: 'grant', self: true, kw: k, dur: d };
  const w = parseWho(m[1]); return w && { type: 'grant', who: w, kw: k, dur: d };
});
rule(/^suspend (.+)$/, (m) => { if (/^this (digimon|tamer)$/.test(m[1])) return { type: 'suspend', self: true }; const w = parseWho(m[1]); return w && { type: 'suspend', who: w }; });
rule(/^unsuspend (.+)$/, (m) => { if (/^this (digimon|tamer)$/.test(m[1])) return { type: 'unsuspend', self: true }; const w = parseWho(m[1]); return w && { type: 'unsuspend', who: w }; });
rule(/^return (.+?) to (?:the|its owner's|their owner's|the owner's) hands?$/, (m) => { const w = parseWho(m[1]); return w && { type: 'bounce', who: w }; });
rule(/^(?:return|place) (.+?) (?:to|at) the bottom of (?:the|its owner's|their owner's) decks?$/, (m) => { const w = parseWho(m[1]); return w && { type: 'bottom', who: w }; });
rule(/^<de-digivolve (\d+)> (.+)$/, (m) => { const w = parseWho(m[2]); return w && { type: 'deDigivolve', n: +m[1], who: w }; });
rule(/^reveal the top (\d+) cards? of your deck$/, (m) => ({ type: 'reveal', n: +m[1] }));
rule(/^add (\d+|1) (.+?) among them to (?:the|your) hand$/, (m) => {
  const f = {}; let s = m[2];
  if (/^cards?$/.test(s)) return { type: 'revealAdd', n: +m[1], f };
  const tr = /with \[([^\]]+)\] in (?:its|their) traits?|with the \[([^\]]+)\] trait/.exec(s); if (tr) { f.trait = (tr[1] || tr[2]).toLowerCase(); s = s.replace(tr[0], '').trim(); }
  const nm = /with \[([^\]]+)\] in (?:its|their) names?/.exec(s); if (nm) { f.nameIncl = nm[1].toLowerCase(); s = s.replace(nm[0], '').trim(); }
  const ty = /^(?:(red|blue|yellow|green|black|purple|white) )?(digimon|tamer|option)? ?cards?$/.exec(s); if (!ty) return null;
  if (ty[1]) f.color = ty[1][0].toUpperCase() + ty[1].slice(1); if (ty[2]) f.type = ty[2][0].toUpperCase() + ty[2].slice(1);
  return { type: 'revealAdd', n: +m[1], f };
});
rule(/^(?:trash|place) the (?:rest|remaining cards)(?: (?:at|on) the bottom of (?:the|your) deck(?: in any order)?)?$/, (m) => ({ type: 'revealRest', where: /bottom/.test(m[0]) ? 'bottom' : 'trash' }));
rule(/^play (\d+) (.+?) from your (hand|trash) without paying (?:the|its) (?:memory )?cost$/, (m) => {
  const f = {}; let s = m[2];
  const lv = /^level (\d+)(?: or (lower|less))? /.exec(s); if (lv) { if (lv[2]) f.maxLevel = +lv[1]; else f.level = +lv[1]; s = s.slice(lv[0].length); }
  const col = /^(red|blue|yellow|green|black|purple|white) /.exec(s); if (col) { f.color = col[1][0].toUpperCase() + col[1].slice(1); s = s.slice(col[0].length); }
  const cost = / with a play cost of (\d+) or less$/.exec(s); if (cost) { f.maxCost = +cost[1]; s = s.slice(0, cost.index); }
  const tr = / with \[([^\]]+)\] in (?:its|their) traits?$| with the \[([^\]]+)\] trait$/.exec(s); if (tr) { f.trait = (tr[1] || tr[2]).toLowerCase(); s = s.slice(0, tr.index); }
  const nm = /^\[([^\]]+)\]$/.exec(s); if (nm) { f.name = nm[1].toLowerCase(); s = 'digimon card'; }
  if (!/^(digimon|tamer) cards?$/.test(s)) return null;
  f.type = /tamer/.test(s) ? 'Tamer' : 'Digimon';
  return { type: 'playFree', from: m[3], n: +m[1], f };
});
rule(/^play this card without paying (?:the|its) (?:memory )?cost$/, () => ({ type: 'playSelf' }));
rule(/^activate this card's \[main\] effects?$/, () => ({ type: 'activateMain' }));
rule(/^add this card to (?:the|your|its owner's) hand$/, () => ({ type: 'toHand' }));
// Parts with no game effect for a simulator.
rule(/^(?:then, )?shuffle your deck$/, () => ({ type: 'noop' }));

export function parseEffectSentence(sentence) {
  let s = sentence.replace(/\.$/, '').trim();
  const fixed = fixFor(sentence); if (fixed != null) { if (!fixed.trim()) return { effects: [{ type: 'noop' }], ok: true }; const r = parseEffectText(fixed, 1); return { effects: r.effects, ok: !r.unhandled.length }; }
  const low0 = s.toLowerCase();
  let opt = false; let cond = null; let low = low0;
  low = low.replace(/^then,? /, '');
  let m;
  if ((m = /^if (.+?), (.+)$/.exec(low))) { const c = parseCond(m[1]); if (!c) return { effects: [], ok: false }; cond = c; low = m[2]; }
  if ((m = /^by suspending this (tamer|digimon), (.+)$/.exec(low))) { low = m[2]; cond = { ...(cond || {}), costSuspendSelf: true }; opt = true; }
  if (/^you may /.test(low)) { opt = true; low = low.replace(/^you may /, ''); }
  for (const [re, fn] of R) {
    const mm = re.exec(low); if (!mm) continue;
    const e = fn(mm); if (!e) continue;
    const effs = Array.isArray(e) ? e : [e];
    if (cond) effs[0].cond = cond; if (opt) effs[0].optional = true;
    return { effects: effs, ok: true };
  }
  return { effects: [], ok: false };
}
export function parseEffectText(text, depth = 0) {
  const effects = []; const unhandled = [];
  for (const s of splitSentences(normText(text))) {
    const r = depth > 2 ? { ok: false, effects: [] } : parseEffectSentence(s);
    if (r.ok) effects.push(...r.effects); else unhandled.push(s);
  }
  return { effects, unhandled };
}

// ---------- continuous effects inside [Your Turn] / [All Turns] / [Opponent's Turn] ----------
function parseStatic(body) {
  let low = body.toLowerCase().replace(/\.$/, '').trim(); let cond = null; let m;
  if ((m = /^(?:while|if) (.+?), (.+)$/.exec(low))) { cond = parseCond(m[1]); if (!cond) return null; low = m[2]; }
  if ((m = /^(?:this digimon|it) gets ([+-]\d+) dp(?: and gains <([^>]+)>)?$/.exec(low))) { const k = m[2] ? kwKey(m[2]) : {}; if (!k) return null; return { kind: 'self', dp: +m[1], kw: k, cond }; }
  if ((m = /^(?:this digimon|it) gains <([^>]+)>(?: and <([^>]+)>)?$/.exec(low))) { const k = { ...kwKey(m[1]), ...(m[2] ? kwKey(m[2]) : {}) }; if (!kwKey(m[1])) return null; return { kind: 'self', dp: 0, kw: k, cond }; }
  if ((m = /^(all of your (?:other )?digimon|all of your opponent's digimon|your opponent's digimon) gets? ([+-]\d+) dp$/.exec(low))) return { kind: 'group', side: /opponent/.test(m[1]) ? 'opp' : 'mine', other: /other/.test(m[1]), dp: +m[2], kw: {}, cond };
  return null;
}
const EVENT_RE = [
  [/^when this digimon attacks, (.+)$/, 'attack', { self: true }],
  [/^when this digimon becomes suspended, (.+)$/, 'suspended', { self: true }],
  [/^when this digimon is deleted, (.+)$/, 'deleted', { self: true }],
  [/^when this digimon blocks, (.+)$/, 'block', { self: true }],
  [/^when one of your digimon digivolves, (.+)$/, 'digivolve', { mine: true }],
  [/^when one of your digimon attacks, (.+)$/, 'attack', { mine: true }],
  [/^when an opponent's digimon attacks, (.+)$/, 'attack', { opp: true }],
  [/^when one of your digimon is played, (.+)$/, 'played', { mine: true }],
  [/^when an opponent's digimon is deleted, (.+)$/, 'deleted', { opp: true }],
  [/^when one of your digimon is deleted, (.+)$/, 'deleted', { mine: true }],
  [/^when you use an option card, (.+)$/, 'option', { mine: true }],
];

// One ability: its timings, whether it's once per turn, and either effects (triggered/activated/security) or a static.
function parseAbility(tags, body) {
  const timings = tags.map((t) => TIMING_TAGS[t.toLowerCase()]).filter(Boolean);
  const ab = { timings: timings.filter((t) => !['once', 'twice'].includes(t)), once: timings.includes('once'), twice: timings.includes('twice'), text: body.trim(), effects: [], unhandled: [] };
  const continuous = ab.timings.length && ab.timings.every((t) => ['yourTurn', 'oppTurn', 'allTurns'].includes(t));
  if (continuous) {
    // Text that isn't understood here is reported as the whole ability ("[Your Turn] When …"), so a fix can replace all of it.
    const whole = `${tags.map((t) => `[${t}]`).join('')} ${normText(body)}`.trim();
    const orig = normText(body).replace(/\.$/, '');
    for (const [re, ev, who] of EVENT_RE) {
      const m = new RegExp(re.source, 'i').exec(orig); if (!m) continue;
      ab.event = ev; ab.eventWho = who;
      const r = parseEffectText(m[1].replace(/^[a-z]/, (c) => c.toUpperCase()));
      ab.effects = r.effects; ab.unhandled = r.unhandled.length ? [whole] : []; return ab;
    }
    const statics = []; let bad = false;
    for (const s of splitSentences(normText(body))) { const st = parseStatic(s); if (st) statics.push(st); else bad = true; }
    ab.statics = statics; ab.unhandled = bad ? [whole] : []; return ab;
  }
  const r = parseEffectText(body); ab.effects = r.effects; ab.unhandled = r.unhandled;
  return ab;
}

// Whole text block → keywords, abilities and plain text that wasn't understood.
export function parseText(text, depth = 0) {
  const out = { kw: {}, abilities: [], unhandled: [] };
  const t = normText(text); if (!t) return out;
  const fixedAll = fixFor(t); const src = fixedAll != null ? normText(fixedAll) : t;
  const parts = []; let last = 0; let m; const re = new RegExp(TAG_RE.source, 'gi');
  let tags = null; let tagEnd = 0;
  while ((m = re.exec(src))) {
    // A tag only starts an ability at the start of the text or a sentence ("activate this card's [Main] effect" is not one).
    const before = src.slice(0, m.index).trimEnd();
    if (before && !/[.\n\]>)]$/.test(before) && !(tags && m.index === tagEnd)) continue;
    const between = src.slice(last, m.index);
    if (tags && between.trim() === '' && m.index === tagEnd) { tags.push(m[1]); tagEnd = re.lastIndex; last = re.lastIndex; continue; }
    if (tags) parts.push({ tags, body: between }); else if (between.trim()) parts.push({ tags: null, body: between });
    tags = [m[1]]; tagEnd = re.lastIndex; last = re.lastIndex;
  }
  const rest = src.slice(last);
  if (tags) parts.push({ tags, body: rest }); else if (rest.trim()) parts.push({ tags: null, body: rest });
  for (const p of parts) {
    if (!p.tags) {
      for (const s of splitSentences(p.body)) {
        const all = /^(?:<[^>]+>\s*)+\.?$/.test(s) ? [...s.matchAll(/<([^>]+)>/g)].map((x) => x[1]) : null;
        if (all && all.length > 1 && all.every((x) => kwKey(x) || /^digisorption/i.test(x))) { for (const x of all) Object.assign(out.kw, kwKey(x) || { digisorption: +(/-(\d+)/.exec(x)?.[1] || 1) }); continue; }
        const k = /^<([^>]+)>\.?$/.exec(s); const kk = k && kwKey(k[1]);
        if (kk) Object.assign(out.kw, kk);
        else if (k && /^digisorption/i.test(k[1])) out.kw.digisorption = +(/-(\d+)/.exec(k[1])?.[1] || 1);
        else if (fixFor(s) === '') continue;
        else out.unhandled.push(s);
      }
      continue;
    }
    const whole = `${p.tags.map((t) => `[${t}]`).join('')} ${normText(p.body)}`.trim();
    const fx = fixFor(whole);
    if (fx != null) { if (fx.trim() && depth < 2) { const r = parseText(fx, depth + 1); Object.assign(out.kw, r.kw); out.abilities.push(...r.abilities); out.unhandled.push(...r.unhandled); } continue; }
    const ab = parseAbility(p.tags, p.body);
    out.abilities.push(ab);
  }
  return out;
}

// ---------- card definitions ----------
// raw: { id, name, type, level, playCost, dp, colors, evo:[{color, level, cost}], traits, main, inherited, security, image }
export function makeDef(raw) {
  const def = {
    id: raw.id, name: raw.name, type: raw.type || 'Digimon', level: raw.level ?? null, playCost: raw.playCost ?? null, dp: raw.dp ?? null,
    colors: raw.colors?.length ? raw.colors : ['Colorless'], evo: raw.evo || [], traits: (raw.traits || []).map((x) => x.toLowerCase()), image: raw.image || '',
    main: raw.main || '', inheritedText: raw.inherited || '', securityText: raw.security || '', demo: !!raw.demo,
  };
  const main = parseText(def.main);
  def.kw = main.kw; def.abilities = main.abilities; def.unhandled = [...main.unhandled];
  const inh = parseText(def.inheritedText);
  def.inhKw = inh.kw; def.inherited = inh.abilities; def.unhandled.push(...inh.unhandled.map((x) => '(inherited) ' + x));
  if (def.securityText) { const sec = parseText(/\[security\]/i.test(def.securityText) ? def.securityText : `[Security] ${def.securityText}`); def.abilities.push(...sec.abilities); def.unhandled.push(...sec.unhandled); }
  // Plain-English list of what the game can't do on its own for this card.
  def.manual = [...def.unhandled, ...def.abilities.flatMap((a) => a.unhandled), ...def.inherited.flatMap((a) => a.unhandled.map((x) => '(inherited) ' + x))];
  def.isDigimon = def.type === 'Digimon'; def.isTamer = def.type === 'Tamer'; def.isOption = def.type === 'Option'; def.isEgg = def.type === 'Digi-Egg';
  return def;
}
export function abilityLabel(ab) {
  const names = { onPlay: 'On Play', whenDigivolving: 'When Digivolving', whenAttacking: 'When Attacking', onDeletion: 'On Deletion', main: 'Main', security: 'Security', yourTurn: 'Your Turn', oppTurn: "Opponent's Turn", allTurns: 'All Turns', startOfYourTurn: 'Start of Your Turn', endOfYourTurn: 'End of Your Turn', startOfMain: 'Start of Your Main Phase', counter: 'Counter' };
  return ab.timings.map((t) => `[${names[t] || t}]`).join('');
}
