// Digimon Card Game rules engine (two players). No DOM: runs in the browser and in Node tests.
// Controllers (human UI, AI) make every choice through async methods; `io` hooks let the UI show logs and manual steps.
import { uid, makeRng, shuffle } from './util.js';
import { abilityLabel } from './cards.js';

export const MEM_MAX = 10;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

export class Game {
  // opts: { players: [{ name, ctrl, main: [def], eggs: [def], isAI }], seed, io, first }
  constructor(opts) {
    this.rng = makeRng(opts.seed);
    this.io = opts.io || {};
    this.memory = 0; // positive = player 0's side
    this.turn = 0; this.winner = null; this.reason = '';
    this.players = opts.players.map((p, idx) => {
      const pl = { idx, name: p.name, ctrl: p.ctrl, isAI: !!p.isAI, deck: [], eggs: [], hand: [], security: [], trash: [], breeding: null, field: [], firstTurnDone: false, stats: { digivolves: 0, checks: 0, deleted: 0, maxLevel: 0 } };
      pl.deck = shuffle(p.main.map((def) => this.inst(def, pl)), this.rng);
      pl.eggs = shuffle(p.eggs.map((def) => this.inst(def, pl)), this.rng);
      return pl;
    });
    this.first = opts.first ?? (this.rng() < 0.5 ? 0 : 1);
    this.active = this.players[this.first];
    this.usedOnce = new Set();
    this.memo = {};
  }
  inst(def, owner) { return { uid: uid('c'), def, owner }; }
  opp(pl) { return this.players[1 - pl.idx]; }
  log(msg, kind = '') { this.io.log?.(msg, kind); }
  async pace(kind) { await this.io.pace?.(kind); }

  // ---------- memory ----------
  mem(pl) { return pl.idx === 0 ? this.memory : -this.memory; }
  setMem(pl, v) { const n = clamp(v, -MEM_MAX, MEM_MAX); this.memory = pl.idx === 0 ? n : -n; this.io.changed?.(); }
  gainMem(pl, n) { this.setMem(pl, this.mem(pl) + n); }

  // ---------- stacks (a Digimon/Tamer in play: cards[0] is the bottom, the last card is on top) ----------
  top(st) { return st.cards[st.cards.length - 1]; }
  sources(st) { return st.cards.slice(0, -1); }
  newStack(cards, owner) { return { uid: uid('s'), cards, owner, suspended: false, enteredTurn: this.turn, temp: [] }; }
  isDigimon(st) { const d = this.top(st)?.def; return !!d && (d.isDigimon || d.isEgg); }
  allStacks() { return this.players.flatMap((p) => p.field); }

  // DP and keywords, including inherited effects, [Your Turn]-style statics and temporary boosts.
  statics(st) {
    const out = [];
    const top = this.top(st); const owner = st.owner;
    const live = (ab) => ab.statics && (ab.timings.includes('allTurns') || (ab.timings.includes('yourTurn') && this.active === owner) || (ab.timings.includes('oppTurn') && this.active !== owner));
    for (const ab of top.def.abilities) if (live(ab)) for (const s of ab.statics) out.push({ s, src: st, self: true });
    for (const c of this.sources(st)) for (const ab of c.def.inherited) if (live(ab)) for (const s of ab.statics) out.push({ s, src: st, self: true });
    for (const other of this.allStacks()) {
      if (other === st) continue;
      const lv = (ab) => ab.statics && (ab.timings.includes('allTurns') || (ab.timings.includes('yourTurn') && this.active === other.owner) || (ab.timings.includes('oppTurn') && this.active !== other.owner));
      for (const ab of this.top(other).def.abilities) if (lv(ab)) for (const s of ab.statics) if (s.kind === 'group') {
        const mine = other.owner === st.owner;
        if ((s.side === 'mine' && mine) || (s.side === 'opp' && !mine)) out.push({ s, src: other, self: false });
      }
    }
    return out.filter(({ s, src }) => !s.cond || this.condMet(src.owner, s.cond, src));
  }
  dp(st) {
    const top = this.top(st); if (top.def.dp == null) return 0;
    let v = top.def.dp;
    for (const { s } of this.statics(st)) v += s.dp || 0;
    for (const t of st.temp) v += t.dp || 0;
    return Math.max(0, v);
  }
  kw(st) {
    const k = { sa: 0 };
    const addK = (o) => { for (const [n, v] of Object.entries(o || {})) { if (n === 'sa') k.sa += v; else k[n] = v; } };
    addK(this.top(st).def.kw);
    for (const c of this.sources(st)) addK(c.def.inhKw);
    for (const { s } of this.statics(st)) addK(s.kw);
    for (const t of st.temp) addK(t.kw);
    return k;
  }
  checks(st) { return Math.max(0, 1 + this.kw(st).sa); }

  condMet(pl, c, st) {
    if (!c) return true;
    const o = this.opp(pl);
    switch (c.k) {
      case 'haveTamer': return pl.field.some((s) => this.top(s).def.isTamer && (!c.color || this.top(s).def.colors.includes(c.color)));
      case 'mySec': return (c.max == null || pl.security.length <= c.max) && (c.min == null || pl.security.length >= c.min);
      case 'oppSec': return (c.max == null || o.security.length <= c.max) && (c.min == null || o.security.length >= c.min);
      case 'mem': return this.mem(pl) <= c.max;
      case 'sources': return !!st && st.cards.length - 1 >= c.min;
      case 'myDigimon': return pl.field.filter((s) => this.isDigimon(s)).length >= c.min;
      case 'oppDigimon': return o.field.filter((s) => this.isDigimon(s)).length >= c.min;
      case 'myTurn': return this.active === pl;
      case 'hand': return pl.hand.length <= c.max;
      default: return true;
    }
  }

  // ---------- moving cards ----------
  async draw(pl, n = 1) {
    for (let i = 0; i < n; i++) { const c = pl.deck.pop(); if (!c) return false; pl.hand.push(c); }
    this.io.changed?.(); return true;
  }
  trashStack(st) { const pl = st.owner; pl.field = pl.field.filter((x) => x !== st); if (pl.breeding === st) pl.breeding = null; for (const c of st.cards) pl.trash.push(c); }

  // ---------- setup and turns ----------
  async start() {
    for (const pl of this.players) {
      await this.draw(pl, 5);
      if (await pl.ctrl.mulligan?.(this, pl)) {
        pl.deck.push(...pl.hand.splice(0)); shuffle(pl.deck, this.rng); await this.draw(pl, 5);
        this.log(`${pl.name} redraws their opening hand.`);
      }
    }
    for (const pl of this.players) { for (let i = 0; i < 5; i++) { const c = pl.deck.pop(); if (c) pl.security.push(c); } }
    this.log(`${this.active.name} goes first.`, 'turn');
    this.io.changed?.();
  }
  async run() {
    await this.start();
    let guard = 0;
    while (!this.winner && guard++ < 200) await this.takeTurn();
    if (!this.winner) { this.winner = null; this.reason = 'turn limit'; }
    return this.winner;
  }
  lose(pl, why) { if (this.winner) return; this.winner = this.opp(pl); this.reason = why; this.log(`${this.winner.name} wins — ${why}.`, 'win'); this.io.changed?.(); }
  win(pl, why) { this.lose(this.opp(pl), why); }

  async takeTurn() {
    const pl = this.active; const o = this.opp(pl);
    this.turn++; this.phase = 'unsuspend'; this.usedOnce = new Set();
    this.log(`Turn ${this.turn}: ${pl.name}`, 'turn');
    for (const st of pl.field) st.suspended = false;
    for (const st of o.field) if (this.kw(st).reboot) st.suspended = false;
    await this.triggerTiming(pl, 'startOfYourTurn');
    if (this.winner) return;
    this.phase = 'draw';
    const skipDraw = this.turn === 1;
    if (!skipDraw) { if (!pl.deck.length) return this.lose(pl, `${pl.name} can't draw`); await this.draw(pl, 1); }
    this.phase = 'breeding'; this.io.changed?.();
    await this.breedingPhase(pl);
    if (this.winner) return;
    this.phase = 'main'; this.io.changed?.();
    await this.triggerTiming(pl, 'startOfMain');
    for (let loops = 0; loops < 3 && !this.winner; loops++) {
      await this.mainPhase(pl);
      if (this.winner) return;
      await this.triggerTiming(pl, 'endOfYourTurn');
      if (this.mem(pl) < 0) break; // memory came back during the end of turn: keep going
    }
    // Effects "for the turn" end now; effects "until the end of your opponent's turn" end after the next turn.
    for (const st of this.allStacks()) st.temp = st.temp.filter((t) => t.expires > this.turn);
    pl.firstTurnDone = true;
    this.active = o;
    if (this.mem(o) < 0) this.setMem(o, 0);
  }
  async breedingPhase(pl) {
    const opts = ['skip'];
    if (!pl.breeding && pl.eggs.length) opts.unshift('hatch');
    if (pl.breeding && this.top(pl.breeding).def.dp != null) opts.unshift('move');
    if (opts.length === 1) return;
    const ch = await pl.ctrl.breeding(this, pl, opts);
    if (ch === 'hatch') { const egg = pl.eggs.pop(); pl.breeding = this.newStack([egg], pl); this.log(`${pl.name} hatches ${egg.def.name}.`); this.io.fx?.('hatch', pl.breeding); }
    else if (ch === 'move') { const st = pl.breeding; pl.breeding = null; pl.field.push(st); this.log(`${pl.name} moves ${this.top(st).def.name} to the battle area.`); this.io.fx?.('move', st); }
    this.io.changed?.(); await this.pace('breed');
  }
  async mainPhase(pl) {
    let guard = 0;
    while (!this.winner && this.mem(pl) >= 0 && guard++ < 80) {
      this.io.checkpoint?.();
      const acts = this.legalActions(pl);
      const a = await pl.ctrl.chooseAction(this, pl, acts);
      if (!a || a.type === 'pass') { this.setMem(pl, -3); this.log(`${pl.name} passes.`); break; }
      await this.doAction(pl, a);
      await this.checkDeaths();
      this.io.changed?.();
    }
  }

  // ---------- legal actions ----------
  optionColorsOk(pl, def) {
    const have = new Set([...pl.field, ...(pl.breeding ? [pl.breeding] : [])].flatMap((s) => this.top(s).def.colors));
    return def.colors.every((c) => c === 'Colorless' || have.has(c));
  }
  digivolveTargets(pl, card) {
    const out = [];
    for (const st of [...pl.field, ...(pl.breeding ? [pl.breeding] : [])]) {
      const t = this.top(st).def; if (!(t.isDigimon || t.isEgg)) continue;
      for (const e of card.def.evo) if (t.level === e.level && t.colors.some((c) => String(e.color).split(/[\s/]+/).includes(c))) { out.push({ st, cost: e.cost }); break; }
    }
    return out;
  }
  legalActions(pl) {
    const acts = [];
    for (const c of pl.hand) {
      const d = c.def;
      if ((d.isDigimon || d.isTamer) && d.playCost != null) acts.push({ type: 'play', card: c, cost: d.playCost, label: `Play ${d.name} (${d.playCost})` });
      if (d.isDigimon) for (const t of this.digivolveTargets(pl, c)) acts.push({ type: 'digivolve', card: c, st: t.st, cost: t.cost, label: `Digivolve ${this.top(t.st).def.name} → ${d.name} (${t.cost})` });
      if (d.isOption && d.playCost != null && this.optionColorsOk(pl, d)) acts.push({ type: 'option', card: c, cost: d.playCost, label: `Use ${d.name} (${d.playCost})` });
    }
    for (const st of pl.field) {
      const top = this.top(st);
      if (this.isDigimon(st) && !st.suspended && top.def.dp != null && (st.enteredTurn < this.turn || this.kw(st).rush)) {
        acts.push({ type: 'attack', st, target: 'player', label: `Attack with ${top.def.name}` });
        for (const t of this.opp(pl).field) if (t.suspended && this.isDigimon(t)) acts.push({ type: 'attack', st, target: t, label: `${top.def.name} attacks ${this.top(t).def.name}` });
      }
      top.def.abilities.forEach((ab, i) => {
        if (!ab.timings.includes('main') || top.def.isOption) return;
        if (ab.once && this.usedOnce.has(`${st.uid}:${top.uid}:${i}`)) return;
        if (ab.effects.some((e) => e.cond?.costSuspendSelf) && st.suspended) return;
        acts.push({ type: 'activate', st, index: i, label: `${top.def.name}: ${abilityLabel(ab)} ${ab.text.slice(0, 40)}` });
      });
    }
    acts.push({ type: 'pass', label: 'Pass turn' });
    return acts;
  }

  async doAction(pl, a) {
    if (a.type === 'play') return this.playFromHand(pl, a.card, a.cost);
    if (a.type === 'digivolve') return this.digivolve(pl, a.card, a.st, a.cost);
    if (a.type === 'option') return this.useOption(pl, a.card, a.cost);
    if (a.type === 'attack') return this.attack(pl, a.st, a.target);
    if (a.type === 'activate') { const top = this.top(a.st); const ab = top.def.abilities[a.index]; if (ab.once) this.usedOnce.add(`${a.st.uid}:${top.uid}:${a.index}`); return this.runAbility(pl, ab, a.st, top, {}); }
  }
  async playFromHand(pl, card, cost, free = false) {
    pl.hand = pl.hand.filter((c) => c !== card);
    if (!free) this.gainMem(pl, -cost);
    return this.putIntoPlay(pl, card, free ? ' without paying the cost' : ` for ${cost}`);
  }
  async putIntoPlay(pl, card, how = '') {
    const st = this.newStack([card], pl); pl.field.push(st);
    this.log(`${pl.name} plays ${card.def.name}${how}.`); this.io.fx?.('play', st); this.io.changed?.();
    await this.pace('play');
    await this.triggerOn(st, 'onPlay');
    await this.fireEvent('played', st);
    return st;
  }
  async digivolve(pl, card, st, cost, free = false) {
    pl.hand = pl.hand.filter((c) => c !== card);
    if (!free) this.gainMem(pl, -cost);
    const from = this.top(st).def.name;
    st.cards.push(card);
    pl.stats.digivolves++; pl.stats.maxLevel = Math.max(pl.stats.maxLevel, card.def.level || 0);
    this.log(`${pl.name} digivolves ${from} into ${card.def.name}${free ? '' : ` for ${cost}`}.`); this.io.fx?.('digivolve', st); this.io.changed?.();
    await this.draw(pl, 1);
    await this.pace('digivolve');
    if (pl.breeding === st) return st; // effects don't activate in the breeding area
    await this.triggerOn(st, 'whenDigivolving');
    await this.fireEvent('digivolve', st);
    return st;
  }
  async useOption(pl, card, cost) {
    pl.hand = pl.hand.filter((c) => c !== card);
    this.gainMem(pl, -cost);
    this.log(`${pl.name} uses ${card.def.name}.`); this.io.fx?.('option', card);
    await this.pace('play');
    for (const ab of card.def.abilities) if (ab.timings.includes('main')) await this.runAbility(pl, ab, null, card, {});
    await this.fireEvent('option', null, pl);
    pl.trash.push(card); this.io.changed?.();
  }

  // ---------- attacking ----------
  async attack(pl, st, target) {
    const o = this.opp(pl);
    st.suspended = true;
    const name = this.top(st).def.name;
    this.log(`${name} attacks ${target === 'player' ? o.name : this.top(target).def.name}!`, 'combat'); this.io.fx?.('attack', st, target);
    await this.pace('attack');
    await this.triggerOn(st, 'whenAttacking');
    await this.fireEvent('attack', st);
    await this.checkDeaths();
    if (!pl.field.includes(st) || this.winner) return;
    if (target !== 'player' && !o.field.includes(target)) { this.log('The attack target is gone.'); return; }
    // Block
    const blockers = o.field.filter((b) => b !== target && !b.suspended && this.isDigimon(b) && this.kw(b).blocker);
    if (blockers.length) {
      const b = await o.ctrl.chooseBlocker(this, o, st, target, blockers);
      if (b && blockers.includes(b)) {
        b.suspended = true; target = b;
        this.log(`${this.top(b).def.name} blocks!`, 'combat'); this.io.fx?.('block', b, st);
        await this.pace('block'); await this.fireEvent('block', b);
      }
    }
    if (!pl.field.includes(st)) return;
    if (target === 'player') {
      const n = this.checks(st);
      if (!o.security.length) { if (n > 0) this.win(pl, `${name} broke through with no security left`); return; }
      for (let i = 0; i < n && pl.field.includes(st) && o.security.length && !this.winner; i++) await this.securityCheck(pl, st);
      return;
    }
    const defender = target;
    const deletedTarget = await this.battle(st, defender);
    if (deletedTarget && pl.field.includes(st) && this.kw(st).piercing && o.security.length) { this.log(`${name} pierces through!`); await this.securityCheck(pl, st); }
  }
  // Returns true if the defender was deleted.
  async battle(a, d) {
    const da = this.dp(a); const dd = this.dp(d);
    this.log(`Battle: ${this.top(a).def.name} (${da}) vs ${this.top(d).def.name} (${dd}).`, 'combat');
    const delA = da <= dd; const delD = dd <= da;
    const kA = this.kw(a); const kD = this.kw(d);
    if (delD) await this.deleteStack(d, { battle: true, by: a });
    if (delA) await this.deleteStack(a, { battle: true, by: d });
    if (delA && kA.retaliation && d.owner.field.includes(d)) { this.log(`${this.top(a).def.name}'s Retaliation takes ${this.top(d).def.name} down too.`); await this.deleteStack(d, { battle: true }); }
    if (delD && kD.retaliation && a.owner.field.includes(a)) { this.log(`${this.top(d).def.name}'s Retaliation takes ${this.top(a).def.name} down too.`); await this.deleteStack(a, { battle: true }); }
    return !d.owner.field.includes(d);
  }
  async securityCheck(pl, st) {
    const o = this.opp(pl);
    const card = o.security.pop(); if (!card) return;
    pl.stats.checks++;
    this.log(`Security check: ${card.def.name} (${card.def.type}).`, 'combat'); this.io.fx?.('security', card, st); this.io.changed?.();
    await this.pace('security');
    let placed = false;
    for (const ab of card.def.abilities) if (ab.timings.includes('security')) {
      const r = await this.runAbility(o, ab, null, card, { security: true });
      if (r?.placed) placed = true;
    }
    if (card.def.isDigimon && card.def.dp != null && pl.field.includes(st)) {
      const da = this.dp(st); const ds = card.def.dp;
      this.log(`Security battle: ${this.top(st).def.name} (${da}) vs ${card.def.name} (${ds}).`, 'combat');
      if (da <= ds) {
        if (this.kw(st).jamming) this.log(`${this.top(st).def.name} has Jamming and survives.`);
        else await this.deleteStack(st, { battle: true, security: true });
      }
    }
    if (!placed) o.trash.push(card);
    this.io.changed?.();
  }

  // ---------- deletion ----------
  async deleteStack(st, why = {}) {
    const pl = st.owner; if (!pl.field.includes(st)) return false;
    const k = this.kw(st); const name = this.top(st).def.name;
    // Ways to avoid deletion (the controller decides).
    if (k.armorPurge && st.cards.length > 1 && await pl.ctrl.confirm(this, pl, `Armor Purge: trash ${name} to save the Digimon under it?`, { kind: 'save' })) { pl.trash.push(st.cards.pop()); this.log(`${name} uses Armor Purge.`); return false; }
    if (k.evade && !st.suspended && await pl.ctrl.confirm(this, pl, `Evade: suspend ${name} instead of deleting it?`, { kind: 'save' })) { st.suspended = true; this.log(`${name} evades.`); return false; }
    if (k.barrier && why.battle && !why.security && pl.security.length && await pl.ctrl.confirm(this, pl, `Barrier: trash your top security card to save ${name}?`, { kind: 'save' })) { pl.trash.push(pl.security.pop()); this.log(`${name} uses Barrier.`); return false; }
    const hadSources = st.cards.length > 1; const top = this.top(st);
    this.log(`${name} is deleted.`, 'delete'); this.io.fx?.('delete', st);
    this.opp(pl).stats.deleted++;
    // [On Deletion] effects (the top card's and inherited ones) still resolve after it leaves.
    const abs = this.abilitiesOf(st, 'onDeletion');
    this.trashStack(st); this.io.changed?.();
    await this.pace('delete');
    for (const { ab, card } of abs) await this.runAbility(pl, ab, st, card, { deleted: true });
    await this.fireEvent('deleted', st);
    if (k.fortitude && hadSources) { pl.trash = pl.trash.filter((c) => c !== top); this.log(`${top.def.name} returns with Fortitude.`); await this.putIntoPlay(pl, top, ' (Fortitude)'); }
    return true;
  }
  async checkDeaths() {
    for (let i = 0; i < 5; i++) {
      const dead = this.allStacks().filter((st) => this.isDigimon(st) && this.top(st).def.dp != null && this.dp(st) <= 0);
      if (!dead.length) return;
      for (const st of dead) await this.deleteStack(st, { dp0: true });
    }
  }

  // ---------- triggers ----------
  abilitiesOf(st, timing) {
    const out = [];
    const top = this.top(st);
    top.def.abilities.forEach((ab, i) => { if (ab.timings.includes(timing) && !ab.event) out.push({ ab, card: top, key: `${st.uid}:${top.uid}:${i}` }); });
    if (!['onPlay', 'whenDigivolving'].includes(timing)) for (const c of this.sources(st)) c.def.inherited.forEach((ab, i) => { if (ab.timings.includes(timing) && !ab.event) out.push({ ab, card: c, key: `${st.uid}:${c.uid}:i${i}` }); });
    return out;
  }
  async triggerOn(st, timing) {
    for (const { ab, card, key } of this.abilitiesOf(st, timing)) {
      if (!st.owner.field.includes(st) && timing !== 'onDeletion') return;
      if (ab.once) { if (this.usedOnce.has(key)) continue; this.usedOnce.add(key); }
      await this.runAbility(st.owner, ab, st, card, {});
    }
  }
  async triggerTiming(pl, timing) {
    for (const st of [...pl.field]) await this.triggerOn(st, timing);
  }
  // [Your Turn] When one of your Digimon digivolves, … — abilities waiting for an event.
  async fireEvent(ev, subject, actor) {
    for (const st of [...this.allStacks()]) {
      const live = (ab) => ab.timings.includes('allTurns') || (ab.timings.includes('yourTurn') && this.active === st.owner) || (ab.timings.includes('oppTurn') && this.active !== st.owner);
      const list = [];
      const top = this.top(st);
      top.def.abilities.forEach((ab, i) => { if (ab.event === ev && live(ab)) list.push({ ab, card: top, key: `${st.uid}:${top.uid}:e${i}` }); });
      for (const c of this.sources(st)) c.def.inherited.forEach((ab, i) => { if (ab.event === ev && live(ab)) list.push({ ab, card: c, key: `${st.uid}:${c.uid}:ie${i}` }); });
      for (const { ab, card, key } of list) {
        const w = ab.eventWho || {};
        const owner = subject ? subject.owner : actor;
        if (w.self && subject !== st) continue;
        if (w.mine && owner !== st.owner) continue;
        if (w.opp && owner === st.owner) continue;
        if (ab.once) { if (this.usedOnce.has(key)) continue; this.usedOnce.add(key); }
        if (!st.owner.field.includes(st)) continue;
        await this.runAbility(st.owner, ab, st, card, { subject });
      }
    }
  }

  // ---------- running effects ----------
  async runAbility(pl, ab, st, card, ctx) {
    const res = {};
    if (ab.unhandled?.length) await this.io.manual?.(pl, card, ab, st);
    if (!ab.effects.length) return res;
    this.memo = { revealed: [] };
    for (const e of ab.effects) {
      if (this.winner) break;
      if (e.cond) {
        if (e.cond.costSuspendSelf) { if (!st || st.suspended || !pl.field.includes(st)) break; }
        if (e.cond.k && !this.condMet(pl, e.cond, st)) break;
      }
      if (e.optional && !(await pl.ctrl.confirm(this, pl, `${card.def.name}: ${describe(e)}?`, { kind: 'optional', effect: e }))) break;
      if (e.cond?.costSuspendSelf) st.suspended = true;
      const r = await this.effect(pl, e, st, card, ctx);
      if (r?.placed) res.placed = true;
      await this.checkDeaths();
      this.io.changed?.();
    }
    return res;
  }
  matches(st, f, viewer, source) {
    const top = this.top(st).def;
    if (f.kind === 'digimon' && !this.isDigimon(st)) return false;
    if (f.kind === 'tamer' && !top.isTamer) return false;
    if (f.other && st === source) return false;
    if (f.suspended && !st.suspended) return false;
    if (f.unsuspended && st.suspended) return false;
    if (f.maxDp != null && this.dp(st) > f.maxDp) return false;
    if (f.minDp != null && this.dp(st) < f.minDp) return false;
    if (f.level != null && top.level !== f.level) return false;
    if (f.maxLevel != null && !(top.level <= f.maxLevel)) return false;
    if (f.minLevel != null && !(top.level >= f.minLevel)) return false;
    if (f.maxCost != null && !(top.playCost <= f.maxCost)) return false;
    if (f.color && !top.colors.includes(f.color)) return false;
    if (f.trait && !top.traits.some((t) => t.includes(f.trait))) return false;
    if (f.nameIncl && !top.name.toLowerCase().includes(f.nameIncl)) return false;
    if (f.noSources && st.cards.length > 1) return false;
    return true;
  }
  candidates(pl, w, source) {
    const side = w.side === 'opp' ? this.opp(pl) : pl;
    let list = side.field.filter((st) => this.matches(st, w.f, pl, source));
    if (w.f.pick) {
      const key = /Dp/.test(w.f.pick) ? (s) => this.dp(s) : (s) => this.top(s).def.level || 0;
      const best = list.reduce((b, s) => (b == null ? key(s) : /lowest/.test(w.f.pick) ? Math.min(b, key(s)) : Math.max(b, key(s))), null);
      list = list.filter((s) => key(s) === best);
    }
    return list;
  }
  async pick(pl, w, source, prompt, kind) {
    const list = this.candidates(pl, w, source);
    if (w.all) return list;
    if (!list.length) return [];
    const out = [];
    for (let i = 0; i < w.count && list.length; i++) {
      const s = await pl.ctrl.chooseTarget(this, pl, list.filter((x) => !out.includes(x)), prompt, { optional: w.upTo, kind, side: w.side });
      if (!s) break; out.push(s);
      if (out.length >= list.length) break;
    }
    return out;
  }
  async effect(pl, e, st, card, ctx) {
    const o = this.opp(pl); const name = card.def.name;
    const expires = (d) => this.turn + (d === 'oppTurn' && this.active === pl ? 1 : 0);
    switch (e.type) {
      case 'noop': return;
      case 'draw': await this.draw(pl, e.n); this.log(`${pl.name} draws ${e.n}.`); return;
      case 'memory': this.gainMem(pl, e.n); this.log(`${pl.name} ${e.n >= 0 ? 'gains' : 'loses'} ${Math.abs(e.n)} memory.`); return;
      case 'setMemory': if (this.mem(pl) < e.n) { this.setMem(pl, e.n); this.log(`${pl.name}'s memory is set to ${e.n}.`); } return;
      case 'discard': {
        const n = Math.min(e.n, pl.hand.length); if (!n) return;
        const cs = await pl.ctrl.chooseCards(this, pl, pl.hand, `Trash ${n} card${n > 1 ? 's' : ''} from your hand`, { min: n, max: n, kind: 'discard' });
        for (const c of cs) { pl.hand = pl.hand.filter((x) => x !== c); pl.trash.push(c); }
        this.log(`${pl.name} trashes ${cs.map((c) => c.def.name).join(', ')}.`); return;
      }
      case 'oppDiscard': {
        const n = Math.min(e.n, o.hand.length); if (!n) return;
        const cs = await o.ctrl.chooseCards(this, o, o.hand, `Trash ${n} card${n > 1 ? 's' : ''} from your hand`, { min: n, max: n, kind: 'discard' });
        for (const c of cs) { o.hand = o.hand.filter((x) => x !== c); o.trash.push(c); }
        this.log(`${o.name} trashes ${cs.map((c) => c.def.name).join(', ')}.`); return;
      }
      case 'mill': for (let i = 0; i < e.n; i++) { const c = pl.deck.pop(); if (c) pl.trash.push(c); } return;
      case 'recovery': for (let i = 0; i < e.n; i++) { const c = pl.deck.pop(); if (c) pl.security.push(c); } this.log(`${pl.name} adds ${e.n} card${e.n > 1 ? 's' : ''} to their security stack.`); return;
      case 'trashSecurity': for (let i = 0; i < e.n; i++) { const c = o.security.pop(); if (c) { o.trash.push(c); this.log(`${name} trashes ${o.name}'s top security card (${c.def.name}).`); } } return;
      case 'delete': { const ts = await this.pick(pl, e.who, st, `${name}: choose a Digimon to delete`, 'delete'); for (const t of ts) await this.deleteStack(t, { effect: true, by: pl }); return; }
      case 'dp': {
        const ts = e.self ? (st && st.owner.field.includes(st) ? [st] : []) : await this.pick(pl, e.who, st, `${name}: choose a Digimon to get ${e.n > 0 ? '+' : ''}${e.n} DP`, e.n < 0 ? 'debuff' : 'buff');
        for (const t of ts) { t.temp.push({ dp: e.n, expires: expires(e.dur) }); this.log(`${this.top(t).def.name} gets ${e.n > 0 ? '+' : ''}${e.n} DP.`); }
        return;
      }
      case 'grant': {
        const ts = e.self ? (st && st.owner.field.includes(st) ? [st] : []) : await this.pick(pl, e.who, st, `${name}: choose a Digimon`, 'buff');
        for (const t of ts) { t.temp.push({ kw: e.kw, expires: expires(e.dur) }); this.log(`${this.top(t).def.name} gains ${kwText(e.kw)}.`); }
        return;
      }
      case 'suspend': { const ts = e.self ? [st] : await this.pick(pl, e.who, st, `${name}: choose a Digimon to suspend`, 'suspend'); for (const t of ts) if (t) { t.suspended = true; this.log(`${this.top(t).def.name} is suspended.`); await this.fireEvent('suspended', t); } return; }
      case 'unsuspend': { const ts = e.self ? [st] : await this.pick(pl, e.who, st, `${name}: choose a Digimon to unsuspend`, 'unsuspend'); for (const t of ts) if (t) { t.suspended = false; this.log(`${this.top(t).def.name} is unsuspended.`); } return; }
      case 'bounce': case 'bottom': {
        const ts = await this.pick(pl, e.who, st, `${name}: choose a Digimon to ${e.type === 'bounce' ? 'return to hand' : 'put at the bottom of the deck'}`, 'remove');
        for (const t of ts) {
          const owner = t.owner; const top = this.top(t);
          owner.field = owner.field.filter((x) => x !== t);
          for (const c of this.sources(t)) owner.trash.push(c);
          if (e.type === 'bounce') owner.hand.push(top); else owner.deck.unshift(top);
          this.log(`${top.def.name} returns to ${e.type === 'bounce' ? `${owner.name}'s hand` : `the bottom of ${owner.name}'s deck`}.`);
        }
        return;
      }
      case 'deDigivolve': {
        const ts = await this.pick(pl, e.who, st, `${name}: choose a Digimon to de-digivolve`, 'debuff');
        for (const t of ts) for (let i = 0; i < e.n && t.cards.length > 1 && (this.top(t).def.level || 0) > 3; i++) { const c = t.cards.pop(); t.owner.trash.push(c); this.log(`${c.def.name} is trashed (De-Digivolve).`); }
        return;
      }
      case 'reveal': { this.memo.revealed = []; for (let i = 0; i < e.n; i++) { const c = pl.deck.pop(); if (c) this.memo.revealed.push(c); } this.log(`${pl.name} reveals ${this.memo.revealed.map((c) => c.def.name).join(', ') || 'nothing'}.`); return; }
      case 'revealAdd': {
        const ok = (this.memo.revealed || []).filter((c) => (!e.f.type || c.def.type === e.f.type) && (!e.f.color || c.def.colors.includes(e.f.color)) && (!e.f.trait || c.def.traits.some((t) => t.includes(e.f.trait))) && (!e.f.nameIncl || c.def.name.toLowerCase().includes(e.f.nameIncl)));
        if (!ok.length) return;
        const cs = await pl.ctrl.chooseCards(this, pl, ok, 'Add to your hand', { min: 0, max: e.n, kind: 'take' });
        for (const c of cs) { pl.hand.push(c); this.memo.revealed = this.memo.revealed.filter((x) => x !== c); this.log(`${pl.name} adds ${c.def.name} to their hand.`); }
        return;
      }
      case 'revealRest': { for (const c of this.memo.revealed || []) (e.where === 'bottom' ? pl.deck.unshift(c) : pl.trash.push(c)); this.memo.revealed = []; return; }
      case 'playFree': {
        const zone = e.from === 'hand' ? pl.hand : pl.trash;
        const ok = zone.filter((c) => c.def.type === e.f.type && (e.f.maxLevel == null || c.def.level <= e.f.maxLevel) && (e.f.level == null || c.def.level === e.f.level) && (!e.f.color || c.def.colors.includes(e.f.color)) && (e.f.maxCost == null || c.def.playCost <= e.f.maxCost) && (!e.f.trait || c.def.traits.some((t) => t.includes(e.f.trait))) && (!e.f.name || c.def.name.toLowerCase() === e.f.name));
        if (!ok.length) return;
        const cs = await pl.ctrl.chooseCards(this, pl, ok, 'Play without paying the cost', { min: 0, max: e.n, kind: 'play' });
        for (const c of cs) { if (e.from === 'hand') pl.hand = pl.hand.filter((x) => x !== c); else pl.trash = pl.trash.filter((x) => x !== c); await this.putIntoPlay(pl, c, ' without paying the cost'); }
        return;
      }
      case 'playSelf': if (ctx.security) { await this.putIntoPlay(pl, card, ' from security'); return { placed: true }; } return;
      case 'activateMain': for (const ab of card.def.abilities) if (ab.timings.includes('main')) await this.runAbility(pl, ab, null, card, {}); return;
      case 'toHand': if (ctx.security) { pl.hand.push(card); this.log(`${card.def.name} goes to ${pl.name}'s hand.`); return { placed: true }; } return;
      default: this.log(`(${name}: "${e.type}" isn't automated yet.)`);
    }
  }
}

export function kwText(k) {
  return Object.entries(k || {}).filter(([n, v]) => v && !(n === 'sa' && v === 0)).map(([n, v]) => (n === 'sa' ? `<Security A. ${v > 0 ? '+' : ''}${v}>` : `<${n[0].toUpperCase()}${n.slice(1).replace(/([A-Z])/g, ' $1')}>`)).join(' ');
}
export function describe(e) {
  switch (e.type) {
    case 'draw': return `draw ${e.n}`;
    case 'memory': return `${e.n >= 0 ? 'gain' : 'lose'} ${Math.abs(e.n)} memory`;
    case 'delete': return 'delete a Digimon';
    case 'playFree': return `play a card from your ${e.from} for free`;
    case 'dp': return `${e.n > 0 ? '+' : ''}${e.n} DP`;
    default: return e.type;
  }
}
