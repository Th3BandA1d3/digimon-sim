// Dev menu (owner only): text the game couldn't automate, local rule fixes with a builder and a live check,
// keyword status, wording tips, and sending fixes to Claude as GitHub issues.
import { $, $$, h, toast, sheet, download } from './dom.js';
import { parseEffectText, parseText, KEYWORDS } from '../cards.js';
import { APP_VERSION, devOn, setDev, checkDevCode, listFound, saveFound, localFixes, saveLocalFixes, upsertFix, normRule, fixFor, setPreviewFix, wildcardFix, exportBundle,
  TEMPLATES, TIMINGS, CONDITIONS, REPO, ghToken, setGhToken, sendFixToClaude, manualIssueUrl, sentStatus } from '../devfixes.js';
import { explainEffect } from './explain.js';

export async function devUnlock(onDone) {
  const s = sheet('<h3>Developer mode</h3><form><label class="field">Passcode<input name="c" type="password" autocomplete="off"></label><div class="acts"><button class="btn go">Unlock</button></div></form>');
  s.el.querySelector('form').onsubmit = async (e) => {
    e.preventDefault();
    if (await checkDevCode(new FormData(e.target).get('c'))) { setDev(true); s.close(); toast('Developer mode on'); onDone?.(); } else toast('Wrong passcode');
  };
}

function check(text) {
  const t = String(text || '').trim();
  if (!t) return { ok: true, html: '<p class="ok">Empty: this text will be ignored.</p>' };
  const hasTag = /\[(on play|when digivolving|when attacking|on deletion|main|security|your turn|opponent's turn|all turns|start of your|end of your)/i.test(t) || /^<[^>]+>$/.test(t);
  if (hasTag) {
    const p = parseText(t);
    const rows = p.abilities.map((ab) => {
      const ok = !ab.unhandled.length;
      const what = ab.statics ? ab.statics.map((s) => `continuous: ${s.dp ? `${s.dp > 0 ? '+' : ''}${s.dp} DP ` : ''}${Object.keys(s.kw || {}).join(' ')}${s.cond ? ' (with a condition)' : ''}`) : ab.effects.map(explainEffect);
      return `<li class="${ok ? 'ok' : 'warnline'}">${ok ? '✓' : '✗'} ${h(ab.timings.join(' + '))}${ab.event ? ` · when ${h(ab.event)}` : ''}${ab.once ? ' · once per turn' : ''}<div class="explain">${what.map(h).join('<br>')}${ab.unhandled.length ? `<br>Not understood: ${ab.unhandled.map(h).join(' / ')}` : ''}</div></li>`;
    });
    const kw = Object.keys(p.kw).length ? `<li class="ok">✓ keywords: ${h(JSON.stringify(p.kw))}</li>` : '';
    const un = p.unhandled.map((x) => `<li class="warnline">✗ ${h(x)}</li>`).join('');
    return { ok: !p.unhandled.length && p.abilities.every((a) => !a.unhandled.length), html: `<ul class="devcheck">${kw}${rows.join('')}${un}</ul>` };
  }
  const r = parseEffectText(t);
  const ok = !r.unhandled.length && r.effects.length;
  return { ok, html: `<ul class="devcheck">${r.effects.map((e) => `<li class="ok">✓ ${h(explainEffect(e))}</li>`).join('')}${r.unhandled.map((x) => `<li class="warnline">✗ ${h(x)}</li>`).join('')}</ul>` };
}

// Ways to simplify a sentence so it parses (a starting point for a fix).
function suggestions(text) {
  const t = text.trim(); const out = [];
  const tries = [
    t.replace(/^if [^,]+, /i, ''),
    t.replace(/^by [^,]+, /i, ''),
    t.replace(/, and .+$/, '.'),
    t.replace(/ (?:for each|for every) .+$/i, '.'),
    t.replace(/ with (?:\[[^\]]+\] in (?:its|their) (?:name|traits?))/i, ''),
  ];
  for (const x of tries) if (x !== t && x.trim()) { const r = parseEffectText(x); if (!r.unhandled.length && r.effects.length && !out.includes(x)) out.push(x); }
  return out.slice(0, 4);
}

export function fixEditor(text, info, onSaved) {
  const sug = suggestions(text);
  const s = sheet(`<h3>Fix a rule</h3><p class="hint">${h(info.card || '')}${info.id ? ` (${h(info.id)})` : ''}</p>
    <div class="devorig"><small>Not automated</small><p class="orig">${h(text)}</p><a class="simlink" target="_blank" rel="noopener" href="https://digimoncard.io/api-public/search?series=Digimon%20Card%20Game&desc=${encodeURIComponent(text.replace(/\.$/, '').slice(0, 50))}">Cards with this wording (raw data) ↗</a></div>
    ${sug.length ? `<h4>Suggestions</h4><div class="acts col">${sug.map((x, i) => `<button class="btn ghost" data-sug="${i}">${h(x)}</button>`).join('')}</div>` : ''}
    <label class="field">Replacement (what the game should read instead; leave empty to ignore)<textarea name="rep" rows="3">${h(fixFor(text) ?? '')}</textarea></label>
    <div class="chk"></div>
    <details class="builder"><summary>Builder</summary>
      <div class="brow"><select data-b="timing"><option value="">(just the effect)</option>${TIMINGS.map((t) => `<option>${h(t)}</option>`).join('')}</select>
      <select data-b="cond"><option value="">(no condition)</option>${CONDITIONS.map((c) => `<option>${h(c)}</option>`).join('')}</select></div>
      <div class="brow"><select data-b="tpl">${TEMPLATES.map((t, i) => `<option value="${i}">${h(t.label)}</option>`).join('')}</select></div>
      <div class="bfields"></div>
      <div class="acts"><button class="btn ghost" data-k="add">Add to replacement</button></div>
    </details>
    <label class="check"><input type="checkbox" name="wild"> Any numbers (one fix for "−2000 DP", "−3000 DP"…)</label>
    <label class="field">Notes for Claude <small>(what it should really do — writing a note also <b>sends this fix to Claude</b> to build in for everyone)</small><textarea name="notes" rows="2"></textarea></label>
    <div class="acts"><button class="btn go" data-k="save">Save fix</button>${fixFor(text) != null ? '<button class="btn ghost danger" data-k="del">Delete fix</button>' : ''}</div>`, { tall: true });
  const rep = $('[name=rep]', s.el); const chk = $('.chk', s.el);
  const upd = () => { const c = check(rep.value); chk.innerHTML = c.html; setPreviewFix({ match: text, replace: rep.value }); };
  const fields = () => {
    const t = TEMPLATES[+$('[data-b=tpl]', s.el).value];
    $('.bfields', s.el).innerHTML = t.fields.map((f) => f.type === 'select' ? `<label class="field">${h(f.label)}<select data-f="${f.name}">${f.options.map((o) => `<option>${h(o)}</option>`).join('')}</select></label>` : `<label class="field">${h(f.label)}<input data-f="${f.name}" type="number" value="${f.def ?? 1}" step="${f.step || 1}"></label>`).join('');
  };
  fields(); upd();
  rep.addEventListener('input', upd);
  $('[data-b=tpl]', s.el).onchange = fields;
  s.el.addEventListener('click', async (e) => {
    const sg = e.target.closest('[data-sug]'); if (sg) { rep.value = sug[+sg.dataset.sug]; upd(); return; }
    const k = e.target.closest('[data-k]')?.dataset.k;
    if (k === 'add') {
      const t = TEMPLATES[+$('[data-b=tpl]', s.el).value]; const v = {}; $$('[data-f]', s.el).forEach((i) => { v[i.dataset.f] = i.type === 'number' ? +i.value : i.value; });
      let line = t.make(v); const cond = $('[data-b=cond]', s.el).value; const tm = $('[data-b=timing]', s.el).value;
      if (cond && line) line = `${cond} ${line[0].toLowerCase()}${line.slice(1)}`;
      if (tm) line = `${tm} ${line}`;
      rep.value = (rep.value.trim() ? rep.value.trim() + ' ' : '') + line; upd(); return;
    }
    if (k === 'del') { saveLocalFixes(localFixes().filter((f) => normRule(f.match) !== normRule(text))); setPreviewFix(null); s.close(); toast('Fix deleted'); onSaved?.(); return; }
    if (k === 'save') {
      let match = text; let replace = rep.value.trim();
      const wild = $('[name=wild]', s.el).checked;
      if (wild) { const w = wildcardFix(match, replace); match = w.match; replace = w.replace; }
      const notes = $('[name=notes]', s.el).value.trim();
      const fix = { match, replace, card: info.card || '', id: info.id || '', full: info.full || '', notes, wildcard: wild, enabled: true };
      upsertFix(fix); setPreviewFix(null);
      if (notes) {
        if (!ghToken()) { window.open(manualIssueUrl(fix), '_blank'); upsertFix({ ...fix, sent: { manual: true, at: Date.now() } }); toast('Fix saved. GitHub opened with it filled in — tap Submit to send it to Claude.', 6000); }
        else { const r = await sendFixToClaude(fix); if (r.ok) { upsertFix({ ...fix, sent: { n: r.number, at: Date.now() } }); toast(`Fix saved and sent to Claude (#${r.number}).`, 4500); } else toast(`Saved here, but sending failed: ${r.error}`, 5000); }
      } else toast('Fix saved — it works on this device now. Add a note to have it built in for everyone.', 4000);
      s.close(); onSaved?.();
    }
  });
}

const KW_INFO = [
  ['Blocker', 'blocker', 'Can suspend to become the target of an opponent\'s attack.'],
  ['Security A. +N', 'sa', 'Checks N more (or fewer) security cards when attacking the player.'],
  ['Rush', 'rush', 'Can attack the turn it is played.'],
  ['Piercing', 'piercing', 'After deleting a Digimon in battle while attacking, checks one security card.'],
  ['Jamming', 'jamming', 'Isn\'t deleted by battling security Digimon.'],
  ['Reboot', 'reboot', 'Unsuspends during the opponent\'s unsuspend phase.'],
  ['Retaliation', 'retaliation', 'When deleted in battle, the Digimon it battled is deleted too.'],
  ['Recovery +N (Deck)', 'recovery', 'Puts the top N cards of your deck on top of your security stack.'],
  ['Draw N', 'draw', 'Draws N cards.'],
  ['De-Digivolve N', 'deDigivolve', 'Trashes up to N top cards of a Digimon (not below level 3).'],
  ['Armor Purge', 'armorPurge', 'When it would be deleted, trash its top card instead.'],
  ['Evade', 'evade', 'When it would be deleted, suspend it instead.'],
  ['Barrier', 'barrier', 'When it would be deleted in battle, trash your top security card instead.'],
  ['Fortitude', 'fortitude', 'When deleted with digivolution cards under it, it comes back into play.'],
  ['Alliance', 'alliance', 'When attacking, suspend another Digimon to add its DP and +1 security check.', true],
  ['Raid', 'raid', 'When attacking, switch the target to the opponent\'s highest-DP unsuspended Digimon.', true],
  ['Blitz', 'blitz', 'May attack when the opponent has memory.', true],
  ['Digisorption -N', 'digisorption', 'Suspend one of your Digimon to reduce a digivolve cost.', true],
  ['Collision', 'collision', 'While it attacks, opposing Digimon gain Blocker and must block.', true],
  ['Decoy', 'decoy', 'Delete it to save another of your Digimon from an opponent\'s effect.', true],
  ['Vortex / Overclock / Execute', 'vortex', 'End-of-turn attacks.', true],
  ['Iceclad', 'iceclad', 'Battles compare digivolution card counts instead of DP.', true],
  ['Progress', 'progress', 'Unaffected by opponent effects while attacking.', true],
  ['Save / Mind Link / Partition / Fragment / Scapegoat', 'misc', 'Card-placing and protection effects.', true],
];
const SYNTAX = [
  ['Timing first', 'Start each ability with its timing in square brackets: <code>[On Play]</code>, <code>[When Digivolving]</code>, <code>[When Attacking]</code>, <code>[On Deletion]</code>, <code>[Main]</code>, <code>[Security]</code>, <code>[Your Turn]</code>, <code>[All Turns]</code>, <code>[Start of Your Turn]</code>, <code>[End of Your Turn]</code>. Add <code>[Once Per Turn]</code> right after.'],
  ['Keywords', 'Write keywords in angle brackets on their own: <code>&lt;Blocker&gt;</code>, <code>&lt;Security A. +1&gt;</code>, <code>&lt;Rush&gt;</code>. As effects: <code>&lt;Draw 1&gt;</code>, <code>&lt;Recovery +1 (Deck)&gt;</code>, <code>&lt;De-Digivolve 1&gt; 1 of your opponent\'s Digimon.</code>'],
  ['Which Digimon', '<code>1 of your opponent\'s Digimon with 4000 DP or less</code>, <code>up to 2 of your opponent\'s level 3 Digimon</code>, <code>all of your Digimon</code>, <code>1 of your other Digimon</code>, <code>1 of your opponent\'s suspended Digimon</code>, <code>… with the lowest DP</code>, <code>… with [Greymon] in its name</code>.'],
  ['Continuous effects', 'Inside <code>[Your Turn]</code> / <code>[All Turns]</code>: <code>This Digimon gets +1000 DP.</code>, <code>This Digimon gains &lt;Blocker&gt;.</code>, <code>While you have a Tamer, this Digimon gets +2000 DP.</code>'],
  ['Events', 'Inside <code>[Your Turn]</code>: <code>When this Digimon attacks, …</code>, <code>When one of your Digimon digivolves, …</code>, <code>When an opponent\'s Digimon is deleted, …</code>.'],
  ['Conditions and costs', 'Put them first: <code>If you have a Tamer, …</code>, <code>If you have 3 or fewer security cards, …</code>, <code>By suspending this Tamer, …</code>, <code>You may …</code>.'],
  ['Durations', '<code>for the turn</code> or <code>until the end of your opponent\'s turn</code>.'],
];

export function devScreen(app, go) {
  const state = { tab: 'found', q: '', todo: true };
  const render = () => {
    const found = listFound(); const fixes = localFixes();
    let body = '';
    if (state.tab === 'found') {
      const list = found.filter((f) => (!state.todo || fixFor(f.text) == null) && (!state.q || (f.text + f.cards.join(' ')).toLowerCase().includes(state.q.toLowerCase())));
      body = `<div class="devfilter"><input class="search" placeholder="Search" value="${h(state.q)}"><label class="check"><input type="checkbox" data-k="todo" ${state.todo ? 'checked' : ''}> Needs fix only</label></div>
        <ul class="devlist">${list.map((f) => `<li data-i="${found.indexOf(f)}"><div class="dt">${h(f.text)}</div><small>${h(f.cards.slice(0, 3).join(', '))} · seen ${f.count}×</small>${fixFor(f.text) != null ? '<span class="tag ok">fixed here</span>' : parseEffectText(f.text).unhandled.length ? '<span class="tag todo">needs fix</span>' : '<span class="tag ok">automated now</span>'}</li>`).join('') || '<p class="hint">Nothing yet. Play games — text the game can\'t do is collected here.</p>'}</ul>`;
    } else if (state.tab === 'fixes') {
      body = `<ul class="devlist">${fixes.map((f, i) => `<li><div class="dt">${h(f.match)}</div><small>→ ${h(f.replace || '(ignored)')}${f.card ? ` · ${h(f.card)}` : ''}</small>${f.sent ? `<span class="tag mine">${f.sent.n ? (state.issueState?.[f.sent.n] === 'closed' ? 'built in ✓' : `sent #${f.sent.n}`) : 'sent via GitHub'}</span>` : f.notes ? '<span class="tag todo">not sent</span>' : ''}
        <span class="acts"><button class="btn ghost small" data-edit="${i}">Edit</button><button class="btn ghost small" data-tog="${i}">${f.enabled === false ? 'Turn on' : 'Turn off'}</button>${f.notes && !f.sent?.n ? `<button class="btn ghost small" data-resend="${i}">Send to Claude</button>` : ''}</span></li>`).join('') || '<p class="hint">No fixes yet.</p>'}</ul>`;
      const nums = fixes.map((f) => f.sent?.n).filter(Boolean);
      if (nums.length && !state.issueState && !state.loading) { state.loading = true; sentStatus(nums).then((st) => { state.issueState = st; if (state.tab === 'fixes') render(); }); }
    } else if (state.tab === 'keywords') {
      body = `<ul class="devlist">${KW_INFO.map(([n, k, d, manual]) => `<li><div class="dt"><b>${h(n)}</b></div><small>${h(d)}</small><span class="tag ${manual ? 'todo' : 'ok'}">${manual ? 'not automated' : 'automated'}</span></li>`).join('')}</ul>`;
    } else if (state.tab === 'syntax') {
      body = `<dl class="syntax">${SYNTAX.map(([t, d]) => `<dt>${h(t)}</dt><dd>${d}</dd>`).join('')}</dl>`;
    } else {
      body = `<p class="hint">Saving a fix with a note for Claude sends it as a GitHub issue on ${h(REPO)}. Without a token, GitHub opens with it filled in and you tap Submit.</p>
        <label class="field">GitHub token <small>(fine-grained, this repo only, Issues: read and write — kept on this device)</small><input name="tok" type="password" value="${h(ghToken())}" placeholder="github_pat_…"></label>
        <div class="acts"><button class="btn ghost" data-k="tok">Save token</button><button class="btn ghost" data-k="json">Download all fixes (JSON)</button><button class="btn ghost" data-k="copy">Copy all fixes for Claude</button></div>
        <h4>Developer mode</h4><div class="acts"><button class="btn ghost danger" data-k="lock">Turn off developer mode</button></div><p class="hint">App ${APP_VERSION}</p>`;
    }
    app.innerHTML = `<div class="screen"><div class="bar"><button class="icon" data-k="back">←</button><h2>Dev</h2><span></span></div>
      <div class="tabs">${[['found', 'Found'], ['fixes', `Fixes (${fixes.length})`], ['keywords', 'Keywords'], ['syntax', 'Syntax'], ['send', 'Send']].map(([k, l]) => `<button class="${state.tab === k ? 'on' : ''}" data-tab="${k}">${l}</button>`).join('')}</div>${body}</div>`;
    const sb = $('.search', app); if (sb) sb.oninput = () => { state.q = sb.value; const p = sb.selectionStart; render(); const n = $('.search', app); n.focus(); n.setSelectionRange(p, p); };
  };
  app.onclick = async (e) => {
    const k = e.target.closest('[data-k]')?.dataset.k;
    if (k === 'back') return go('home');
    if (k === 'todo') { state.todo = e.target.checked; return render(); }
    const tab = e.target.closest('[data-tab]'); if (tab) { state.tab = tab.dataset.tab; return render(); }
    if (k === 'tok') { setGhToken($('[name=tok]', app).value); toast('Saved'); return render(); }
    if (k === 'json') return download('digimon-sim-fixes.json', JSON.stringify(exportBundle(), null, 1), 'application/json');
    if (k === 'copy') { try { await navigator.clipboard.writeText(JSON.stringify(exportBundle(), null, 1)); toast('Copied'); } catch { toast('Copy not allowed — use Download'); } return; }
    if (k === 'lock') { setDev(false); return go('home'); }
    const li = e.target.closest('[data-i]'); if (li) { const f = listFound()[+li.dataset.i]; const card = f.cards[0]; return fixEditor(f.text.replace(/^\(inherited\) /, ''), { card, id: f.ids?.[card], full: f.full?.[card] }, render); }
    const ed = e.target.closest('[data-edit]'); if (ed) { const f = localFixes()[+ed.dataset.edit]; return fixEditor(f.match, f, render); }
    const tg = e.target.closest('[data-tog]'); if (tg) { const l = localFixes(); const f = l[+tg.dataset.tog]; f.enabled = f.enabled === false; saveLocalFixes(l); return render(); }
    const rs = e.target.closest('[data-resend]'); if (rs) { const f = localFixes()[+rs.dataset.resend]; if (!ghToken()) { window.open(manualIssueUrl(f), '_blank'); upsertFix({ ...f, sent: { manual: true, at: Date.now() } }); return render(); } const r = await sendFixToClaude(f); if (r.ok) upsertFix({ ...f, sent: { n: r.number, at: Date.now() } }); else toast(r.error); return render(); }
  };
  render();
}
export { saveFound };
