// AI opponent. Easy plays loosely; Normal follows a simple plan: raise in the breeding area, digivolve while memory
// stays on its side, attack when it's safe or wins, and make one last big play before handing over little memory.
const LV = (c) => c.def.level || 0;

export class AIController {
  constructor(level = 'normal') { this.level = level; this.isAI = true; }
  rnd(g) { return g.rng(); }

  async mulligan(g, pl) { return !pl.hand.some((c) => c.def.isDigimon && LV(c) === 3); }

  async breeding(g, pl, opts) {
    const b = pl.breeding;
    if (opts.includes('move') && b) {
      const lv = g.top(b).def.level || 0;
      const fieldDigimon = pl.field.filter((s) => g.isDigimon(s)).length;
      if (lv >= 5 || (lv >= 4 && (fieldDigimon < 2 || this.rnd(g) < 0.6)) || (lv === 3 && fieldDigimon === 0 && !this.canRaise(g, pl, b))) return 'move';
    }
    if (opts.includes('hatch')) return 'hatch';
    return 'skip';
  }
  canRaise(g, pl, st) { return pl.hand.some((c) => c.def.isDigimon && g.digivolveTargets(pl, c).some((t) => t.st === st)); }

  // Score every action; play the best one that keeps memory on our side, or one last strong play.
  async chooseAction(g, pl, acts) {
    const o = g.opp(pl); const mem = g.mem(pl);
    // Easy: often just does something that looks fun, memory be damned.
    if (this.level === 'easy' && this.rnd(g) < 0.35) { const some = acts.filter((x) => x.type !== 'pass' && (x.type !== 'attack' || x.target === 'player')); if (some.length) return some[Math.floor(this.rnd(g) * some.length)]; }
    const scored = [];
    for (const a of acts) {
      let s = -Infinity; const after = mem - (a.cost || 0);
      if (a.type === 'pass') s = 0;
      else if (a.type === 'attack') s = this.scoreAttack(g, pl, a);
      else if (a.type === 'digivolve') {
        const top = g.top(a.st).def; const inBreed = pl.breeding === a.st;
        s = 30 + (LV(a.card) - (top.level || 0)) * 6 - a.cost * 2 + (inBreed ? 4 : 8) + (a.card.def.abilities.some((ab) => ab.timings.includes('whenDigivolving') && ab.effects.length) ? 6 : 0);
      } else if (a.type === 'play') {
        const d = a.card.def;
        if (d.isTamer) s = pl.field.some((x) => g.top(x).def.name === d.name) ? 4 : 22 - a.cost;
        else s = 14 + (d.dp || 0) / 1000 - a.cost * 1.5 + (d.kw?.rush ? 5 : 0) + (d.kw?.blocker ? 2 : 0);
        if (pl.field.filter((x) => g.isDigimon(x)).length >= 4) s -= 10;
      } else if (a.type === 'option') s = this.scoreOption(g, pl, a);
      else if (a.type === 'activate') s = 18;
      if (a.type !== 'pass' && a.type !== 'attack') {
        if (after >= 0) s += 6;
        else if (after >= -3) s -= 2; // ends the turn but gives no more than passing would
        else s -= 12 + (-3 - after) * 6;
      }
      if (this.level === 'easy') s += this.rnd(g) * 25 - 8;
      scored.push({ a, s });
    }
    scored.sort((x, y) => y.s - x.s);
    const best = scored[0];
    if (!best || best.s <= 0) return acts.find((a) => a.type === 'pass');
    return best.a;
  }
  scoreAttack(g, pl, a) {
    const o = g.opp(pl); const dp = g.dp(a.st); const n = g.checks(a.st);
    if (a.target === 'player') {
      if (!o.security.length) return n > 0 ? 1000 : -1;
      const blockers = o.field.filter((b) => !b.suspended && g.isDigimon(b) && g.kw(b).blocker && g.dp(b) >= dp);
      let s = 12 + Math.min(4, n) * 4 + dp / 1500 - (blockers.length ? 14 : 0);
      if (dp < 3000 && o.security.length > 2 && !g.kw(a.st).jamming) s -= 6;
      if (o.security.length <= 2) s += 8;
      return s;
    }
    const tdp = g.dp(a.target);
    if (dp > tdp) return 20 + tdp / 1000;
    if (dp === tdp) return (g.top(a.target).def.level || 0) > (g.top(a.st).def.level || 0) ? 8 : -5;
    return -20;
  }
  scoreOption(g, pl, a) {
    let s = 10 - a.cost;
    for (const ab of a.card.def.abilities) if (ab.timings.includes('main')) for (const e of ab.effects) {
      if (['delete', 'bounce', 'bottom', 'dp', 'suspend', 'deDigivolve'].includes(e.type) && e.who?.side === 'opp') s += g.candidates(pl, e.who, null).length ? 14 : -30;
      if (e.type === 'draw') s += 4 * e.n;
      if (e.type === 'memory') s += 3 * e.n;
      if (e.type === 'reveal') s += 6;
    }
    return s;
  }

  async chooseTarget(g, pl, list, prompt, opts = {}) {
    if (!list.length) return null;
    const val = (s) => g.dp(s) + (g.top(s).def.level || 0) * 800 + (s.cards.length - 1) * 300 + (g.top(s).def.isTamer ? 2500 : 0);
    const sorted = [...list].sort((a, b) => val(b) - val(a));
    if (opts.side === 'mine' || ['buff', 'unsuspend'].includes(opts.kind)) return sorted[0];
    return this.level === 'easy' ? list[Math.floor(this.rnd(g) * list.length)] : sorted[0];
  }
  async chooseCards(g, pl, cards, prompt, { min = 0, max = 1, kind } = {}) {
    const val = (c) => (c.def.isDigimon ? 10 + LV(c) * 2 : c.def.isTamer ? 9 : 7) + (c.def.dp || 0) / 2000;
    const sorted = [...cards].sort((a, b) => val(b) - val(a));
    if (kind === 'discard') return sorted.reverse().slice(0, Math.max(min, Math.min(max, 1)));
    return sorted.slice(0, Math.max(min, max));
  }
  async chooseBlocker(g, pl, attacker, target, blockers) {
    if (this.level === 'easy') return this.rnd(g) < 0.5 ? blockers[0] : null;
    const adp = g.dp(attacker);
    const survive = blockers.filter((b) => g.dp(b) > adp).sort((a, b) => g.dp(a) - g.dp(b));
    if (survive.length) return survive[0];
    if (target === 'player' && (pl.security.length <= 1 || g.checks(attacker) >= 2)) return [...blockers].sort((a, b) => g.dp(a) - g.dp(b))[0];
    const trade = blockers.filter((b) => g.dp(b) === adp && (g.top(b).def.level || 0) <= (g.top(attacker).def.level || 0));
    if (trade.length && target === 'player') return trade[0];
    return null;
  }
  async confirm(g, pl, prompt, { kind, effect } = {}) {
    if (effect?.type === 'memory' && effect.n < 0) return false;
    return true;
  }
}

// Goldfish: never attacks or blocks; only raises Digimon. For practice runs.
export class GoldfishController extends AIController {
  async chooseAction(g, pl, acts) { return acts.find((a) => a.type === 'pass'); }
  async chooseBlocker() { return null; }
}
