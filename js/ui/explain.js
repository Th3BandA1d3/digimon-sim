// Plain-English descriptions of parsed effects, so a fix can be checked for what it will actually do.
export function describeWho(w) {
  if (!w) return '?';
  const f = w.f || {}; const bits = [];
  if (f.other) bits.push('other'); if (f.suspended) bits.push('suspended'); if (f.unsuspended) bits.push('unsuspended');
  if (f.color) bits.push(f.color.toLowerCase());
  if (f.level != null) bits.push(`level ${f.level}`); if (f.maxLevel != null) bits.push(`level ${f.maxLevel} or lower`); if (f.minLevel != null) bits.push(`level ${f.minLevel}+`);
  const noun = f.kind === 'tamer' ? 'Tamer' : 'Digimon';
  const tail = [f.maxDp != null && `with ≤${f.maxDp} DP`, f.minDp != null && `with ≥${f.minDp} DP`, f.maxCost != null && `costing ≤${f.maxCost}`, f.pick && `with the ${f.pick.replace(/(Dp|Level)$/, ' $1').toLowerCase()}`, f.trait && `with the ${f.trait} trait`, f.nameIncl && `with “${f.nameIncl}” in its name`].filter(Boolean).join(', ');
  const who = w.side === 'opp' ? "opponent's" : 'your';
  const count = w.all ? 'all' : `${w.upTo ? 'up to ' : ''}${w.count}`;
  return `${count} of ${who} ${bits.join(' ')} ${noun}${tail ? ' ' + tail : ''}`.replace(/\s+/g, ' ');
}
const dur = (d) => (d === 'oppTurn' ? "until the end of the opponent's turn" : 'for the turn');
export function explainEffect(e) {
  const pre = (e.cond ? (e.cond.costSuspendSelf ? 'by suspending this card, ' : 'if the condition holds, ') : '') + (e.optional ? '(optional) ' : '');
  const who = e.self ? 'this Digimon' : describeWho(e.who);
  switch (e.type) {
    case 'draw': return `${pre}draw ${e.n}`;
    case 'memory': return `${pre}${e.n >= 0 ? 'gain' : 'lose'} ${Math.abs(e.n)} memory`;
    case 'setMemory': return `${pre}set memory to ${e.n} (if lower)`;
    case 'discard': return `${pre}trash ${e.n} from your hand`;
    case 'oppDiscard': return `${pre}opponent trashes ${e.n} from their hand`;
    case 'mill': return `${pre}trash the top ${e.n} of your deck`;
    case 'recovery': return `${pre}put the top ${e.n} of your deck on your security stack`;
    case 'trashSecurity': return `${pre}trash the opponent's top ${e.n} security card(s)`;
    case 'delete': return `${pre}delete ${who}`;
    case 'dp': return `${pre}${who}: ${e.n > 0 ? '+' : ''}${e.n} DP ${dur(e.dur)}`;
    case 'grant': return `${pre}${who} gains ${Object.keys(e.kw).map((k) => (k === 'sa' ? `Security A. ${e.kw.sa > 0 ? '+' : ''}${e.kw.sa}` : k)).join(', ')} ${dur(e.dur)}`;
    case 'suspend': return `${pre}suspend ${who}`;
    case 'unsuspend': return `${pre}unsuspend ${who}`;
    case 'bounce': return `${pre}return ${who} to the hand (cards under it are trashed)`;
    case 'bottom': return `${pre}put ${who} at the bottom of the deck`;
    case 'deDigivolve': return `${pre}De-Digivolve ${e.n}: ${who}`;
    case 'reveal': return `${pre}reveal the top ${e.n} of your deck`;
    case 'revealAdd': return `${pre}add ${e.n} revealed ${[e.f.color, e.f.type].filter(Boolean).join(' ') || 'card'}${e.f.trait ? ` with the ${e.f.trait} trait` : ''} to the hand`;
    case 'revealRest': return `${pre}${e.where === 'bottom' ? 'put the rest at the bottom of the deck' : 'trash the rest'}`;
    case 'playFree': return `${pre}play ${e.n} ${e.f.color ? e.f.color.toLowerCase() + ' ' : ''}${e.f.type}${e.f.maxLevel != null ? ` (level ≤${e.f.maxLevel})` : e.f.level != null ? ` (level ${e.f.level})` : ''} from your ${e.from} for free`;
    case 'playSelf': return 'play this card for free (security)';
    case 'activateMain': return "use this card's [Main] effect (security)";
    case 'toHand': return 'add this card to the hand (security)';
    case 'noop': return 'nothing (ignored)';
    default: return e.type;
  }
}
