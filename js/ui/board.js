// Game screen: the board, the human player's controller, watch mode, manual steps and the end-of-game sheet.
import { $, $$, h, toast, sheet } from './dom.js';
import { abilityLabel } from '../cards.js';
import { kwText } from '../engine.js';
import { getSettings } from '../storage.js';
import { devOn, recordFound } from '../devfixes.js';
import { sleep } from '../util.js';

const COLOR_HEX = { Red: '#e0483e', Blue: '#2f7fd8', Yellow: '#e8c43a', Green: '#3aa35b', Black: '#3b3f46', Purple: '#7d4bbf', White: '#d9dde3', Colorless: '#8a8f96' };
const bg = (def) => { const cs = def.colors.map((c) => COLOR_HEX[c] || '#777'); return cs.length > 1 ? `linear-gradient(135deg, ${cs.join(', ')})` : cs[0]; };

// ---------- card faces ----------
export function cardFace(def, { small = false, dp = null, showImg = true } = {}) {
  const img = showImg && def.image && getSettings().showImages ? `<img src="${h(def.image)}" alt="" loading="lazy" onerror="this.remove()">` : '';
  const lv = def.level != null ? `<b class="lv">Lv.${def.level}</b>` : `<b class="lv">${h(def.type === 'Digi-Egg' ? 'Egg' : def.type)}</b>`;
  const cost = def.playCost != null ? `<b class="cost">${def.playCost}</b>` : '';
  const d = dp ?? def.dp;
  return `<div class="face ${small ? 'sm' : ''}" style="--band:${bg(def)}">${img}<div class="ftxt">${cost}${lv}<span class="nm">${h(def.name)}</span>${d != null ? `<b class="dp">${d}</b>` : ''}</div></div>`;
}
export function cardDetails(def, extra = '') {
  const kws = kwText(def.kw); const ikws = kwText(def.inhKw);
  const ev = def.evo.map((e) => `Lv.${e.level} ${h(e.color)} → cost ${e.cost}`).join(' · ');
  return `<div class="detail"><div class="dimg">${cardFace(def)}</div>
    <h3>${h(def.name)} <small>${h(def.id || '')}</small></h3>
    <p class="hint">${h(def.type)}${def.level != null ? ` · Lv.${def.level}` : ''}${def.playCost != null ? ` · ${def.type === 'Option' ? 'use' : 'play'} cost ${def.playCost}` : ''}${def.dp != null ? ` · ${def.dp} DP` : ''} · ${def.colors.map(h).join('/')}${def.traits.length ? ` · ${h(def.traits.join(', '))}` : ''}</p>
    ${ev ? `<p class="hint">Digivolve: ${ev}</p>` : ''}
    ${def.main ? `<p class="ctext">${h(def.main).replace(/\n/g, '<br>')}</p>` : ''}
    ${def.inheritedText ? `<p class="ctext inh"><b>Inherited:</b> ${h(def.inheritedText)}</p>` : ''}
    ${def.securityText ? `<p class="ctext"><b>Security:</b> ${h(def.securityText)}</p>` : ''}
    ${kws || ikws ? `<p class="hint">${kws ? `Keywords: ${h(kws)}` : ''}${ikws ? ` · Inherited: ${h(ikws)}` : ''}</p>` : ''}
    ${def.manual.length ? `<p class="warnline">Not automated: ${def.manual.map(h).join(' · ')}</p>` : ''}
    ${extra}</div>`;
}

// ---------- the human player's controller: every choice is a prompt on the board or a sheet ----------
export class HumanController {
  constructor(view) { this.view = view; this.isAI = false; }
  async mulligan(g, pl) {
    return new Promise((res) => {
      const s = sheet(`<h3>Your opening hand</h3><div class="cardrow">${pl.hand.map((c) => `<div class="card">${cardFace(c.def, { small: true })}</div>`).join('')}</div>
        <p class="hint">You can redraw once: your hand goes back, the deck is shuffled and you draw 5 new cards. Many players redraw when there's no level 3 Digimon.</p>
        <div class="acts"><button class="btn go" data-k="keep">Keep</button><button class="btn ghost" data-k="re">Redraw</button></div>`, { dismissable: false });
      s.el.onclick = (e) => { const b = e.target.closest('[data-k]'); if (!b) return; s.close(); res(b.dataset.k === 're'); };
    });
  }
  async breeding(g, pl, opts) {
    const b = pl.breeding ? g.top(pl.breeding).def : null;
    const label = { hatch: 'Hatch a Digi-Egg', move: `Move ${b?.name || ''} to the battle area`, skip: 'Do nothing' };
    return this.view.ask(`<h3>Breeding phase</h3><p class="hint">Do one thing: hatch an egg into the breeding area, move the Digimon there into battle, or nothing. Digimon in the breeding area can't be attacked or affected — a safe place to digivolve.</p>`,
      opts.map((o) => [o, label[o], o === 'skip' ? 'ghost' : 'go']), { phase: 'Breeding' });
  }
  async chooseAction(g, pl, acts) {
    this.view.acts = acts;
    this.view.render();
    return new Promise((res) => { this.view.resolveAction = (a) => { this.view.resolveAction = null; this.view.acts = null; res(a); }; });
  }
  async chooseTarget(g, pl, list, prompt, opts = {}) {
    if (!list.length) return null;
    const opt = opts.optional ? [['', 'Skip', 'ghost']] : [];
    const r = await this.view.ask(`<h3>${h(prompt)}</h3>`, [...list.map((s, i) => [String(i), stackTile(g, s), 'tile']), ...opt], { raw: true });
    return r === '' || r == null ? null : list[+r];
  }
  async chooseCards(g, pl, cards, prompt, { min = 0, max = 1 } = {}) {
    if (!cards.length) return [];
    return new Promise((res) => {
      const s = sheet(`<h3>${h(prompt)}</h3><p class="hint">${min === max ? `Choose ${max}` : `Choose up to ${max}`}.</p><div class="cardrow wrap">${cards.map((c, i) => `<button class="card pick" data-i="${i}">${cardFace(c.def, { small: true })}</button>`).join('')}</div><div class="acts"><button class="btn go" data-k="ok">Done</button></div>`, { dismissable: false });
      const sel = new Set();
      s.el.onclick = (e) => {
        const b = e.target.closest('[data-i]');
        if (b) { const i = +b.dataset.i; if (sel.has(i)) sel.delete(i); else if (sel.size < max) sel.add(i); else if (max === 1) { sel.clear(); sel.add(i); } $$('[data-i]', s.el).forEach((x) => x.classList.toggle('on', sel.has(+x.dataset.i))); return; }
        if (e.target.closest('[data-k=ok]')) { if (sel.size < Math.min(min, cards.length)) { toast(`Choose ${min}`); return; } s.close(); res([...sel].map((i) => cards[i])); }
      };
    });
  }
  async chooseBlocker(g, pl, attacker, target, blockers) {
    const r = await this.view.ask(`<h3>Block?</h3><p>${h(g.top(attacker).def.name)} (${g.dp(attacker)} DP${g.checks(attacker) > 1 ? `, checks ${g.checks(attacker)}` : ''}) is attacking ${target === 'player' ? 'you' : h(g.top(target).def.name)}.</p><p class="hint">A blocker suspends and battles the attacker instead.</p>`,
      [...blockers.map((b, i) => [String(i), stackTile(g, b), 'tile']), ['', 'No block', 'ghost']], { raw: true });
    return r === '' || r == null ? null : blockers[+r];
  }
  async confirm(g, pl, prompt) {
    return (await this.view.ask(`<p>${h(prompt)}</p>`, [['y', 'Yes', 'go'], ['n', 'No', 'ghost']])) === 'y';
  }
}
function stackTile(g, st) {
  const top = g.top(st).def;
  return `<span class="tile">${cardFace(top, { small: true, dp: g.dp(st) })}<span>${h(top.name)}<small>${g.dp(st)} DP${st.suspended ? ' · suspended' : ''}${st.cards.length > 1 ? ` · ${st.cards.length - 1} under` : ''}</small></span></span>`;
}

// ---------- the board ----------
export class GameView {
  // opts: { root, onExit, watch, onAgain }
  constructor(game, opts) {
    this.g = game; this.o = opts; this.root = opts.root; this.logLines = []; this.acts = null; this.resolveAction = null;
    this.me = game.players[0]; this.paused = false; this.stepWaiter = null; this.speed = getSettings().aiSpeed;
    this.lastFx = null;
  }
  io() {
    const s = getSettings();
    return {
      log: (m, kind) => { this.logLines.push({ m, kind, t: this.g.turn }); this.flashLog(m, kind); },
      changed: () => this.render(),
      fx: (kind, a) => { this.lastFx = { kind, uid: a?.uid }; },
      pace: async (kind) => {
        const human = !this.o.watch && this.g.active === this.me && !this.me.isAI;
        if (this.o.watch) { await this.watchGate(); return; }
        if (!human) await sleep(kind === 'attack' || kind === 'security' ? this.speed * 1.4 : this.speed);
      },
      manual: async (pl, card, ab, st) => {
        const text = ab.unhandled.join(' ');
        if (devOn()) recordFound({ card: card.def.name, text: ab.unhandled[0], full: card.def.main, id: card.def.id, where: abilityLabel(ab) });
        const human = pl === this.me && !this.o.watch;
        if (!human && s.aiManual === 'skip') return;
        if (!human) { this.note(`${card.def.name}: “${text}” isn't automated — it was skipped.`); return; }
        await this.ask(`<h3>Manual step</h3><p class="hint">${h(card.def.name)} ${h(abilityLabel(ab))}</p><p class="ctext">${h(text)}</p><p class="hint">The game can't do this part by itself. Do it with <b>Tools</b> (☰) if it matters, then continue.${devOn() ? ' (Saved in Dev → Found.)' : ''}</p>`, [['ok', 'Continue', 'go']]);
      },
    };
  }
  async watchGate() {
    this.render();
    if (this.paused) { await new Promise((r) => { this.stepWaiter = r; }); this.stepWaiter = null; return; }
    await sleep(this.speed);
    if (this.paused) { await new Promise((r) => { this.stepWaiter = r; }); this.stepWaiter = null; }
  }
  note(m) { toast(m, 3400); }
  flashLog(m, kind) {
    const el = $('.lastlog', this.root); if (el) { el.textContent = m; el.className = `lastlog ${kind || ''}`; }
  }
  // A question in a sheet; choices: [[value, label, style]]. Resolves to the value.
  ask(html, choices, { raw = false } = {}) {
    return new Promise((res) => {
      const s = sheet(`${html}<div class="acts ${choices.length > 3 ? 'col' : ''}">${choices.map(([v, l, st]) => `<button class="btn ${st === 'go' ? 'go' : st === 'tile' ? 'ghost tilebtn' : 'ghost'}" data-v="${h(v)}">${raw ? l : h(l)}</button>`).join('')}</div>`, { dismissable: false });
      s.el.onclick = (e) => { const b = e.target.closest('[data-v]'); if (!b) return; s.close(); res(b.dataset.v); };
    });
  }

  mount() {
    this.root.innerHTML = `<div class="game ${this.o.watch ? 'watching' : ''}"><div class="board"></div>
      <div class="controls"><div class="lastlog"></div><div class="btns"></div></div></div>`;
    this.root.onclick = (e) => this.click(e);
    this.render();
  }
  sideHtml(pl, mine) {
    const g = this.g; const hideHand = !mine || (this.o.watch && pl.isAI && false);
    const bar = `<div class="pbar ${g.active === pl ? 'active' : ''}"><b>${h(pl.name)}</b>
      <span title="Security">🛡 ${pl.security.length}</span><span title="Deck">🂠 ${pl.deck.length}</span><span title="Hand">✋ ${pl.hand.length}</span>
      <button class="mini" data-trash="${pl.idx}" title="Trash">🗑 ${pl.trash.length}</button><span title="Digi-Egg deck">🥚 ${pl.eggs.length}</span></div>`;
    const breed = `<div class="breed"><small>Breeding</small>${pl.breeding ? this.stackHtml(pl.breeding, pl) : '<div class="slot"></div>'}</div>`;
    const field = `<div class="field">${pl.field.length ? pl.field.map((st) => this.stackHtml(st, pl)).join('') : '<div class="emptyf">No Digimon</div>'}</div>`;
    const hand = mine && !(this.o.watch && false) ? `<div class="hand">${pl.hand.map((c, i) => { const can = this.acts?.some((a) => a.card === c && (a.cost ?? 0) <= Math.max(0, this.g.mem(this.me))); return `<button class="card hc ${can ? 'can' : ''}" data-hand="${i}">${cardFace(c.def, { small: true })}</button>`; }).join('')}</div>` : '';
    return `<section class="side ${mine ? 'me' : 'them'}">${mine ? '' : bar}<div class="zone">${breed}${field}</div>${mine ? bar : ''}${hand}</section>`;
  }
  stackHtml(st, pl) {
    const g = this.g; const top = g.top(st).def;
    const can = this.acts?.some((a) => a.st === st && ['attack', 'activate'].includes(a.type)) || this.acts?.some((a) => a.type === 'digivolve' && a.st === st && this.sel && a.card === this.sel);
    const fx = this.lastFx?.uid === st.uid ? `fx-${this.lastFx.kind}` : '';
    const k = g.kw(st); const tags = [k.blocker && 'B', k.sa > 0 && `+${k.sa}`, k.rush && 'R', k.piercing && 'P', k.jamming && 'J'].filter(Boolean);
    return `<button class="stack ${st.suspended ? 'sus' : ''} ${can ? 'can' : ''} ${fx}" data-st="${st.uid}">${cardFace(top, { small: true, dp: top.dp != null ? g.dp(st) : null })}
      ${st.cards.length > 1 ? `<i class="under">${st.cards.length - 1}</i>` : ''}${tags.length ? `<i class="kws">${tags.join(' ')}</i>` : ''}</button>`;
  }
  gaugeHtml() {
    const g = this.g; const m = g.memory; // + = player 0 (bottom) side
    const cells = []; for (let v = 10; v >= -10; v--) cells.push(`<i class="${v === m ? 'on' : ''} ${v === 0 ? 'zero' : ''} ${v > 0 ? 'mine' : v < 0 ? 'theirs' : ''}">${Math.abs(v)}</i>`);
    return `<div class="gauge" title="Memory"><span class="gl">${h(this.g.players[1].name)}</span><div class="cells">${cells.reverse().join('')}</div><span class="gl">${h(this.me.name)}</span></div>`;
  }
  render() {
    const board = $('.board', this.root); if (!board) return;
    const g = this.g;
    const phase = g.winner ? `${h(g.winner.name)} wins` : `Turn ${g.turn} · ${h(g.active.name)} · ${h(g.phase || '')}`;
    const myMove = this.acts && !this.o.watch;
    board.innerHTML = `${this.sideHtml(g.players[1], false)}
      <div class="mid">${this.gaugeHtml()}<div class="phase">${phase}${myMove ? ` · <b>${g.mem(this.me)} memory</b>` : ''}</div></div>
      ${this.sideHtml(this.me, !this.o.watch)}`;
    const btns = $('.controls .btns', this.root);
    if (this.o.watch) btns.innerHTML = `<button class="btn ghost" data-ui="pause">${this.paused ? '▶ Play' : '⏸ Pause'}</button>${this.paused ? '<button class="btn ghost" data-ui="step">Next ›</button>' : ''}<button class="btn ghost" data-ui="speed">${this.speed <= 300 ? 'Fast' : this.speed >= 1200 ? 'Slow' : 'Normal'}</button><button class="btn ghost" data-ui="log">Log</button><button class="btn ghost" data-ui="menu">☰</button>`;
    else btns.innerHTML = `${myMove ? `<button class="btn go" data-ui="pass">Pass <small>(opp. gets 3)</small></button>` : `<span class="hint wait">${g.winner ? '' : `${h(g.active.name)} is thinking…`}</span>`}<button class="btn ghost" data-ui="log">Log</button><button class="btn ghost" data-ui="menu">☰</button>`;
    if (this.lastFx) setTimeout(() => { this.lastFx = null; }, 600);
  }
  findStack(uid) { return this.g.allStacks().find((s) => s.uid === uid) || this.g.players.map((p) => p.breeding).find((s) => s?.uid === uid); }
  async click(e) {
    const g = this.g;
    const ui = e.target.closest('[data-ui]')?.dataset.ui;
    if (ui === 'log') return this.showLog();
    if (ui === 'menu') return this.menu();
    if (ui === 'pause') { this.paused = !this.paused; if (!this.paused) this.stepWaiter?.(); return this.render(); }
    if (ui === 'step') { this.stepWaiter?.(); return; }
    if (ui === 'speed') { this.speed = this.speed <= 300 ? 650 : this.speed >= 1200 ? 250 : 1300; return this.render(); }
    if (ui === 'pass') {
      if (!this.resolveAction) return;
      const left = g.mem(this.me);
      if (getSettings().confirmPass && left > 0) { const ok = await this.ask(`<p>Pass with ${left} memory left? Your opponent starts with 3.</p>`, [['y', 'Pass', 'go'], ['n', 'Keep playing', 'ghost']]); if (ok !== 'y') return; }
      return this.resolveAction({ type: 'pass' });
    }
    const tr = e.target.closest('[data-trash]'); if (tr) { const pl = g.players[+tr.dataset.trash]; return sheet(`<h3>${h(pl.name)}'s trash</h3><div class="cardrow wrap">${pl.trash.map((c) => `<div class="card">${cardFace(c.def, { small: true })}</div>`).join('') || '<p class="hint">Empty.</p>'}</div>`); }
    const hc = e.target.closest('[data-hand]');
    if (hc) {
      const c = this.me.hand[+hc.dataset.hand]; if (!c) return;
      const acts = (this.acts || []).filter((a) => a.card === c);
      const r = await this.ask(cardDetails(c.def), [...acts.map((a, i) => [String(i), a.label, 'go']), ['', 'Close', 'ghost']]);
      if (r && this.resolveAction) this.resolveAction(acts[+r]);
      return;
    }
    const sb = e.target.closest('[data-st]');
    if (sb) {
      const st = this.findStack(sb.dataset.st); if (!st) return;
      const acts = (this.acts || []).filter((a) => a.st === st);
      const under = st.cards.length > 1 ? `<h4>Digivolution cards</h4><div class="cardrow">${g.sources(st).map((c) => `<div class="card">${cardFace(c.def, { small: true })}</div>`).join('')}</div>` : '';
      const now = `<p class="hint">Now: ${g.dp(st)} DP${st.suspended ? ' · suspended' : ''}${kwText(g.kw(st)) ? ` · ${h(kwText(g.kw(st)))}` : ''}</p>`;
      const r = await this.ask(cardDetails(g.top(st).def, now + under), [...acts.map((a, i) => [String(i), a.label, a.type === 'digivolve' ? 'go' : 'go']), ['', 'Close', 'ghost']]);
      if (r && this.resolveAction) this.resolveAction(acts[+r]);
    }
  }
  showLog() {
    const lines = this.logLines.slice(-250).map((l) => `<li class="${l.kind || ''}">${h(l.m)}</li>`).join('');
    const s = sheet(`<h3>Game log</h3><ol class="log">${lines}</ol>`, { tall: true });
    const ol = $('.log', s.el); ol.scrollTop = ol.scrollHeight;
  }
  menu() {
    const g = this.g; const me = this.me;
    const s = sheet(`<h3>Menu</h3><div class="acts col">
      ${!this.o.watch ? `<button class="btn ghost" data-m="tools">Tools (fix things by hand)</button>` : ''}
      <button class="btn ghost" data-m="help">How to play</button>
      ${!this.o.watch && !g.winner ? '<button class="btn ghost danger" data-m="concede">Concede</button>' : ''}
      <button class="btn ghost" data-m="exit">Leave game</button></div>`);
    s.el.onclick = async (e) => {
      const m = e.target.closest('[data-m]')?.dataset.m; if (!m) return; s.close();
      if (m === 'exit') { this.closed = true; this.o.onExit?.(); }
      if (m === 'concede') { if ((await this.ask('<p>Concede this game?</p>', [['y', 'Concede', 'go'], ['n', 'Cancel', 'ghost']])) === 'y') { g.lose(me, `${me.name} conceded`); this.resolveAction?.({ type: 'pass' }); } }
      if (m === 'help') this.o.onHelp?.();
      if (m === 'tools') this.tools();
    };
  }
  tools() {
    const g = this.g; const me = this.me; const o = g.opp(me);
    const s = sheet(`<h3>Tools</h3><p class="hint">For effects the game couldn't do by itself.</p><div class="acts col">
      <button class="btn ghost" data-t="mem+">Gain 1 memory</button><button class="btn ghost" data-t="mem-">Lose 1 memory</button>
      <button class="btn ghost" data-t="draw">Draw a card</button><button class="btn ghost" data-t="sec">Trash ${h(o.name)}'s top security card</button>
      <button class="btn ghost" data-t="rec">Add the top card of my deck to my security</button>
      <button class="btn ghost" data-t="del">Delete a Digimon…</button><button class="btn ghost" data-t="sus">Suspend / unsuspend a Digimon…</button>
      <button class="btn ghost" data-t="dp">Give a Digimon −/+ DP for the turn…</button></div>`);
    s.el.onclick = async (e) => {
      const t = e.target.closest('[data-t]')?.dataset.t; if (!t) return; s.close();
      const pickAny = async (p) => { const list = g.allStacks(); if (!list.length) return null; const r = await this.ask(`<h3>${h(p)}</h3>`, [...list.map((x, i) => [String(i), stackTile(g, x), 'tile']), ['', 'Cancel', 'ghost']], { raw: true }); return r ? list[+r] : null; };
      if (t === 'mem+') g.gainMem(me, 1);
      if (t === 'mem-') g.gainMem(me, -1);
      if (t === 'draw') await g.draw(me, 1);
      if (t === 'sec') { const c = o.security.pop(); if (c) o.trash.push(c); }
      if (t === 'rec') { const c = me.deck.pop(); if (c) me.security.push(c); }
      if (t === 'del') { const st = await pickAny('Delete which Digimon?'); if (st) await g.deleteStack(st, { manual: true }); }
      if (t === 'sus') { const st = await pickAny('Suspend or unsuspend which?'); if (st) st.suspended = !st.suspended; }
      if (t === 'dp') { const st = await pickAny('Which Digimon?'); if (st) { const r = await this.ask('<p>How much?</p>', [['-3000', '−3000', 'ghost'], ['-2000', '−2000', 'ghost'], ['-1000', '−1000', 'ghost'], ['1000', '+1000', 'ghost'], ['2000', '+2000', 'ghost'], ['3000', '+3000', 'ghost']]); st.temp.push({ dp: +r, expires: g.turn }); } }
      g.log(`(${me.name} used Tools: ${e.target.textContent.trim()})`);
      await g.checkDeaths(); this.render();
    };
  }
  summary() {
    const g = this.g;
    const st = (p) => `<tr><td>${h(p.name)}</td><td>${p.security.length}</td><td>${p.stats.digivolves}</td><td>${p.stats.checks}</td><td>${p.stats.deleted}</td><td>${p.stats.maxLevel || '—'}</td></tr>`;
    return `<table class="stats"><tr><th></th><th>Security left</th><th>Digivolves</th><th>Checks made</th><th>Deleted</th><th>Top level</th></tr>${g.players.map(st).join('')}</table>`;
  }
  async end() {
    const g = this.g; if (this.closed) return;
    const won = g.winner === this.me && !this.o.watch;
    const title = this.o.watch ? `${h(g.winner?.name || 'Nobody')} wins` : won ? 'You win!' : g.winner ? `${h(g.winner.name)} wins` : 'Draw';
    const r = await this.ask(`<h2 class="center">${title}</h2><p class="center hint">${h(g.reason || '')} · ${g.turn} turns</p>${this.summary()}`, [['again', this.o.watch ? 'Watch again' : 'Rematch', 'go'], ['log', 'See the log', 'ghost'], ['home', 'Home', 'ghost']]);
    if (r === 'again') this.o.onAgain?.();
    else if (r === 'log') { this.showLog(); this.end(); }
    else this.o.onExit?.();
  }
}
