// App shell: screens (home, play setup, watch, decks, learn, settings, dev) and starting games.
import { $, h, toast, sheet, download } from './ui/dom.js';
import { listDecks, getDeck, saveDeck, deleteDeck, getSettings, saveSettings, addRecord, listRecords } from './storage.js';
import { parseDeckText, splitDeck, checkDeck, deckToText } from './deckparse.js';
import { getCards } from './carddb.js';
import { makeDef } from './cards.js';
import { DEMO_CARDS, DEMO_DECKS } from './data/demo.js';
import { Game } from './engine.js';
import { AIController, GoldfishController } from './ai.js';
import { GameView, HumanController, cardFace, cardDetails } from './ui/board.js';
import { devOn, APP_VERSION, recordFound } from './devfixes.js';
import { devScreen, devUnlock } from './ui/devui.js';

const app = $('#app');
const screens = {};
export function go(name, arg) { window.scrollTo(0, 0); app.onclick = null; (screens[name] || screens.home)(arg); }

if ('serviceWorker' in navigator && location.protocol === 'https:') navigator.serviceWorker.register('sw.js').catch(() => {});

// ---------- decks: saved + demo ----------
function allDeckChoices() {
  return [...listDecks().map((d) => ({ key: d.id, title: d.title, saved: true })), ...DEMO_DECKS.map((d) => ({ key: d.key, title: d.title, demo: true }))];
}
function demoAsDeck(key) {
  const d = DEMO_DECKS.find((x) => x.key === key);
  const s = splitDeck(parseDeckText(d.text).cards, new Map(Object.entries(DEMO_CARDS)));
  return { id: key, title: d.title, main: s.main, eggs: s.eggs };
}
const deckByKey = (k) => getDeck(k) || (DEMO_DECKS.some((d) => d.key === k) ? demoAsDeck(k) : null);
async function loadDefs(deck, onProgress) {
  const ids = [...deck.main, ...deck.eggs].map((e) => e.id);
  const cards = await getCards(ids, onProgress);
  const defs = new Map(); const missing = [];
  for (const id of new Set(ids)) { const c = cards.get(id); if (c) defs.set(id, makeDef(c)); else missing.push(id); }
  // Dev: collect every piece of text the game can't do yet, so it shows up in Dev → Found right away.
  if (devOn()) for (const d of defs.values()) for (const t of d.manual) recordFound({ card: d.name, text: t.replace(/^\(inherited\) /, ''), full: [d.main, d.inheritedText && `Inherited: ${d.inheritedText}`].filter(Boolean).join('\n'), id: d.id, where: 'deck' });
  const expand = (list) => list.flatMap((e) => (defs.get(e.id) ? Array.from({ length: e.qty }, () => defs.get(e.id)) : []));
  return { main: expand(deck.main), eggs: expand(deck.eggs), missing };
}

// ---------- home ----------
screens.home = () => {
  const recs = listRecords(); const w = recs.filter((r) => r.won).length;
  app.innerHTML = `<div class="screen home"><div class="logo"><img src="icon.svg" alt=""><h1>Digimon Sim</h1><p class="hint">Practise your Digimon Card Game decks against an AI.</p></div>
    <div class="acts col big">
      <button class="btn big go" data-go="play">▶ Play</button>
      <button class="btn big ghost" data-go="watch">👀 Watch two AIs</button>
      <button class="btn big ghost" data-go="decks">🗂 My decks</button>
      <button class="btn big ghost" data-go="learn">📘 Learn to play</button>
      <button class="btn big ghost" data-go="settings">⚙ Settings</button>
      ${devOn() ? '<button class="btn big ghost" data-go="dev">🛠 Dev</button>' : ''}
    </div>
    ${recs.length ? `<p class="hint center">Record: ${w} won · ${recs.length - w} lost</p>` : ''}
    <p class="hint center small">Unofficial fan-made practice tool, free and non-commercial. Not affiliated with or endorsed by Bandai. Digimon and the Digimon Card Game are trademarks of their owners. Card data and images: DigimonCard.io.</p></div>`;
  app.onclick = (e) => { const b = e.target.closest('[data-go]'); if (b) go(b.dataset.go); };
};

// ---------- play setup ----------
screens.play = (pre = {}) => {
  const choices = allDeckChoices();
  const st = { mine: pre.mine || choices[0]?.key, theirs: pre.theirs || 'random', level: pre.level || 'normal', first: 'random' };
  const opt = (sel) => choices.map((c) => `<option value="${h(c.key)}" ${sel === c.key ? 'selected' : ''}>${h(c.title)}</option>`).join('');
  app.innerHTML = `<div class="screen"><div class="bar"><button class="icon" data-k="back">←</button><h2>New game</h2><span></span></div>
    <label class="field">Your deck<select name="mine">${opt(st.mine)}</select></label>
    <label class="field">Opponent's deck<select name="theirs"><option value="random">Random demo deck</option>${opt(st.theirs)}<option value="fish">Goldfish (does nothing)</option></select></label>
    <label class="field">Opponent<select name="level"><option value="normal">Normal AI</option><option value="easy">Easy AI</option></select></label>
    <label class="field">Who goes first<select name="first"><option value="random">Random</option><option value="me">Me</option><option value="them">Opponent</option></select></label>
    <div class="acts"><button class="btn big go" data-k="start">Start</button></div>
    <p class="hint">Import your own decks under My decks. The demo decks use invented practice cards and work offline.</p></div>`;
  app.onclick = async (e) => {
    const k = e.target.closest('[data-k]')?.dataset.k;
    if (k === 'back') return go('home');
    if (k !== 'start') return;
    const v = (n) => $(`[name=${n}]`, app).value;
    let theirs = v('theirs'); const fish = theirs === 'fish';
    if (theirs === 'random' || fish) theirs = DEMO_DECKS[Math.floor(Math.random() * DEMO_DECKS.length)].key;
    startGame({ mine: v('mine'), theirs, level: v('level'), fish, first: v('first') });
  };
};
async function prepare(keys) {
  const s = sheet('<h3>Getting cards…</h3><p class="hint prog">Loading</p>', { dismissable: false });
  try {
    const out = [];
    for (const k of keys) {
      const deck = deckByKey(k); if (!deck) throw new Error('That deck is missing.');
      const d = await loadDefs(deck, (m) => { $('.prog', s.el).textContent = m; });
      if (d.missing.length) toast(`${d.missing.length} card(s) couldn't be found and were left out.`, 4000);
      if (!d.main.length) throw new Error(`${deck.title} has no cards the game could load.`);
      out.push({ deck, ...d });
    }
    s.close(); return out;
  } catch (err) { s.close(); toast(err.message || 'Could not load cards (are you offline?)', 5000); return null; }
}
async function startGame(cfg) {
  const loaded = await prepare([cfg.mine, cfg.theirs]); if (!loaded) return;
  const [m, t] = loaded; const set = getSettings();
  const firstIdx = cfg.first === 'me' ? 0 : cfg.first === 'them' ? 1 : undefined;
  let view;
  const human = { name: set.name || 'You', main: m.main, eggs: m.eggs };
  const ai = { name: cfg.fish ? 'Goldfish' : `AI (${cfg.level})`, ctrl: cfg.fish ? new GoldfishController() : new AIController(cfg.level), main: t.main, eggs: t.eggs, isAI: true };
  const game = new Game({ seed: (Date.now() ^ (Math.random() * 1e9)) >>> 0, first: firstIdx, players: [human, ai], io: {} });
  view = new GameView(game, { root: app, onExit: () => go('home'), onAgain: () => startGame(cfg), onHelp: () => helpSheet() });
  human.ctrl = new HumanController(view); game.players[0].ctrl = human.ctrl;
  game.io = view.io();
  view.mount();
  try { await game.run(); } catch (err) { console.error(err); toast('Something went wrong: ' + err.message, 6000); }
  if (view.closed) return;
  if (game.winner) addRecord({ won: game.winner === game.players[0], mine: m.deck.title, theirs: t.deck.title, turns: game.turn });
  view.render(); view.end();
}

// ---------- watch ----------
screens.watch = () => {
  const choices = allDeckChoices();
  const opt = (sel) => choices.map((c) => `<option value="${h(c.key)}" ${sel === c.key ? 'selected' : ''}>${h(c.title)}</option>`).join('');
  app.innerHTML = `<div class="screen"><div class="bar"><button class="icon" data-k="back">←</button><h2>Watch</h2><span></span></div>
    <p class="hint">Two AIs play each other. Pause any time, step through one move at a time with Next, and see a match summary at the end.</p>
    <label class="field">Bottom player<select name="a">${opt('demo-red')}</select></label>
    <label class="field">Top player<select name="b">${opt('demo-blue')}</select></label>
    <label class="field">Mode<select name="mode"><option value="auto">Auto-play (pause any time)</option><option value="step">Step by step (press Next)</option></select></label>
    <div class="acts"><button class="btn big go" data-k="start">Start watching</button></div></div>`;
  app.onclick = async (e) => {
    const k = e.target.closest('[data-k]')?.dataset.k;
    if (k === 'back') return go('home');
    if (k === 'start') startWatch({ a: $('[name=a]', app).value, b: $('[name=b]', app).value, step: $('[name=mode]', app).value === 'step' });
  };
};
async function startWatch(cfg) {
  const loaded = await prepare([cfg.a, cfg.b]); if (!loaded) return;
  const [a, b] = loaded;
  const game = new Game({ seed: (Date.now() ^ (Math.random() * 1e9)) >>> 0, players: [
    { name: `${a.deck.title.replace(/^Demo: /, '')}`, ctrl: new AIController('normal'), main: a.main, eggs: a.eggs, isAI: true },
    { name: `${b.deck.title.replace(/^Demo: /, '')}`, ctrl: new AIController('normal'), main: b.main, eggs: b.eggs, isAI: true }], io: {} });
  const view = new GameView(game, { root: app, watch: true, onExit: () => go('home'), onAgain: () => startWatch(cfg), onHelp: () => helpSheet() });
  view.paused = !!cfg.step;
  game.io = view.io(); view.mount();
  try { await game.run(); } catch (err) { console.error(err); toast('Something went wrong: ' + err.message, 6000); }
  if (!view.closed) { view.render(); view.end(); }
}

// ---------- decks ----------
screens.decks = () => {
  const decks = listDecks();
  app.innerHTML = `<div class="screen"><div class="bar"><button class="icon" data-k="back">←</button><h2>My decks</h2><span></span></div>
    <div class="acts"><button class="btn go" data-k="import">+ Import a deck</button></div>
    <ul class="decklist">${decks.map((d) => `<li data-d="${h(d.id)}"><b>${h(d.title)}</b><small>${d.main.reduce((s, e) => s + e.qty, 0)} cards + ${d.eggs.reduce((s, e) => s + e.qty, 0)} eggs</small></li>`).join('') || '<p class="hint">No decks yet. Import one from a deck list (card numbers like BT1-010 work best).</p>'}
    ${DEMO_DECKS.map((d) => `<li data-d="${h(d.key)}"><b>${h(d.title)}</b><small>${h(d.blurb)}</small></li>`).join('')}</ul></div>`;
  app.onclick = (e) => {
    const k = e.target.closest('[data-k]')?.dataset.k;
    if (k === 'back') return go('home');
    if (k === 'import') return go('import');
    const li = e.target.closest('[data-d]'); if (li) go('deck', li.dataset.d);
  };
};
screens.import = () => {
  app.innerHTML = `<div class="screen"><div class="bar"><button class="icon" data-k="back">←</button><h2>Import deck</h2><span></span></div>
    <label class="field">Deck name<input name="title" placeholder="My deck"></label>
    <label class="field">Deck list<textarea name="list" rows="12" placeholder="4 Koromon BT1-001\n4 Agumon BT1-010\n…\n\nAlso works: BT1-010 x4, or a Tabletop Simulator list [&quot;BT1-010&quot;, …]"></textarea></label>
    <div class="acts"><button class="btn go" data-k="go">Import</button><button class="btn ghost" data-k="paste">Paste</button></div>
    <p class="hint">Cards are looked up on DigimonCard.io by card number (names without numbers are matched to the newest card with that exact name). Digi-Eggs go to the egg deck automatically.</p><div class="res"></div></div>`;
  app.onclick = async (e) => {
    const k = e.target.closest('[data-k]')?.dataset.k;
    if (k === 'back') return go('decks');
    if (k === 'paste') { try { $('[name=list]', app).value = await navigator.clipboard.readText(); } catch { toast('Paste not allowed — long-press the box instead'); } return; }
    if (k !== 'go') return;
    const parsed = parseDeckText($('[name=list]', app).value);
    if (!parsed.cards.length && !parsed.named.length) { toast('No cards found in that list'); return; }
    const res = $('.res', app); res.innerHTML = '<p class="hint">Looking up cards…</p>';
    try {
      const { findByName } = await import('./carddb.js');
      for (const n of parsed.named) { const c = await findByName(n.name); if (c) parsed.cards.push({ id: c.id, qty: n.qty, name: c.name }); else parsed.errors.push(n.name); }
      const cards = await getCards(parsed.cards.map((c) => c.id), (m) => { res.innerHTML = `<p class="hint">${h(m)}</p>`; });
      const split = splitDeck(parsed.cards, cards);
      const title = $('[name=title]', app).value.trim() || guessTitle(split, cards);
      const notes = [...split.missing.map((m) => `Not found: ${m.id}`), ...parsed.errors.map((x) => `Not found or not understood: ${x}`)];
      const deck = saveDeck({ title, main: split.main, eggs: split.eggs, notes });
      const warns = [...checkDeck(deck), ...notes];
      if (warns.length) toast(`Saved with ${warns.length} note(s) — see the deck page.`, 4000);
      go('deck', deck.id);
    } catch (err) { res.innerHTML = `<p class="warnline">${h(err.message || 'Lookup failed')} — check your connection and try again.</p>`; }
  };
};
function guessTitle(split, cards) {
  const top = [...split.main].map((e) => cards.get(e.id)).filter((c) => c?.type === 'Digimon').sort((a, b) => (b.level || 0) - (a.level || 0))[0];
  return top ? `${top.name} deck` : 'My deck';
}
screens.deck = async (key) => {
  const deck = deckByKey(key); if (!deck) return go('decks');
  const isDemo = !getDeck(key);
  app.innerHTML = `<div class="screen"><div class="bar"><button class="icon" data-k="back">←</button><h2>${h(deck.title)}</h2><span></span></div><p class="hint">Loading cards…</p></div>`;
  let cards;
  try { cards = await getCards([...deck.main, ...deck.eggs].map((e) => e.id)); } catch { cards = new Map(); }
  const warns = [...checkDeck(deck), ...(deck.notes || [])];
  const group = (label, list) => (list.length ? `<h4>${label} (${list.reduce((s, e) => s + e.qty, 0)})</h4><div class="cardrow wrap">${list.map((e) => { const c = cards.get(e.id); return c ? `<button class="card dk" data-id="${h(e.id)}">${cardFace(makeDef(c), { small: true })}<i class="qty">×${e.qty}</i></button>` : `<div class="card missing">${h(e.name || e.id)} ×${e.qty}</div>`; }).join('')}</div>` : '');
  const byType = (t) => deck.main.filter((e) => cards.get(e.id)?.type === t);
  const lv = (n) => deck.main.filter((e) => cards.get(e.id)?.type === 'Digimon' && (cards.get(e.id).level || 0) === n);
  const manual = new Set(); for (const e of [...deck.main, ...deck.eggs]) { const c = cards.get(e.id); if (c && makeDef(c).manual.length) manual.add(c.name); }
  app.innerHTML = `<div class="screen"><div class="bar"><button class="icon" data-k="back">←</button><h2>${h(deck.title)}</h2><span></span></div>
    <div class="acts"><button class="btn go" data-k="play">▶ Play with this deck</button><button class="btn ghost" data-k="export">Export</button>${isDemo ? '' : '<button class="btn ghost" data-k="rename">Rename</button><button class="btn ghost danger" data-k="del">Delete</button>'}</div>
    ${warns.length ? `<ul class="warns">${warns.map((w) => `<li>${h(w)}</li>`).join('')}</ul>` : ''}
    ${manual.size ? `<p class="hint">${manual.size} card${manual.size > 1 ? 's have' : ' has'} text the game can't do by itself yet (shown as a manual step in play): ${h([...manual].slice(0, 8).join(', '))}${manual.size > 8 ? '…' : ''}</p>` : '<p class="hint ok">Every card in this deck is automated.</p>'}
    ${group('Digi-Eggs', deck.eggs)}${[3, 4, 5, 6, 7].map((n) => group(`Level ${n}`, lv(n))).join('')}${group('Tamers', byType('Tamer'))}${group('Options', byType('Option'))}</div>`;
  app.onclick = async (e) => {
    const k = e.target.closest('[data-k]')?.dataset.k;
    if (k === 'back') return go('decks');
    if (k === 'play') return go('play', { mine: key });
    if (k === 'export') { const t = deckToText(deck); try { await navigator.clipboard.writeText(t); toast('Deck list copied'); } catch { download(`${deck.title}.txt`, t); } return; }
    if (k === 'rename') { const n = prompt('Deck name', deck.title); if (n) { deck.title = n; saveDeck(deck); go('deck', key); } return; }
    if (k === 'del') { if (confirm(`Delete ${deck.title}?`)) { deleteDeck(key); go('decks'); } return; }
    const c = e.target.closest('[data-id]'); if (c) sheet(cardDetails(makeDef(cards.get(c.dataset.id))), { tall: true });
  };
};

// ---------- learn ----------
const HOW = `<h3>How to play (the short version)</h3>
  <p><b>Goal:</b> attack your opponent when they have no security cards left. You also win if they can't draw at the start of their turn.</p>
  <p><b>Setup:</b> each player has a 50-card deck and up to 5 Digi-Eggs. Draw 5 (you may redraw once), then put 5 cards face down as your security stack.</p>
  <p><b>Memory:</b> one shared gauge. Paying for cards moves it toward your opponent. Your turn ends when it reaches 1 or more on their side — so cheap plays let you keep going. Passing gives them 3.</p>
  <p><b>Your turn:</b> unsuspend → draw (not on the first player's first turn) → breeding (hatch an egg, or move the Digimon there into battle, or nothing) → main (play, digivolve, use Options, attack).</p>
  <p><b>Digivolving:</b> put a Digimon from your hand on top of one of yours that matches the colour and level, pay the small digivolve cost, and draw a card. The cards underneath give their <i>inherited</i> effects to the new top card.</p>
  <p><b>Attacking:</b> suspend an unsuspended Digimon (not one played this turn, unless it has Rush) to attack the player or one of their suspended Digimon. Attacking the player checks their top security card: Digimon there battle yours (higher DP wins), Tamers and Options use their [Security] effect.</p>
  <p><b>Keywords:</b> Blocker (can take an attack instead), Security A. +1 (check one more card), Rush, Piercing, Jamming, Recovery, De-Digivolve…</p>`;
function helpSheet() { sheet(HOW, { tall: true }); }
screens.learn = () => {
  app.innerHTML = `<div class="screen"><div class="bar"><button class="icon" data-k="back">←</button><h2>Learn</h2><span></span></div>${HOW}
    <h4>Practice</h4><div class="acts col">${DEMO_DECKS.map((d) => `<button class="btn ghost" data-demo="${d.key}"><b>${h(d.title)}</b>&nbsp;<small>${h(d.blurb)}</small></button>`).join('')}</div>
    <p class="hint">Practice games use invented demo cards and an Easy AI.</p></div>`;
  app.onclick = (e) => {
    if (e.target.closest('[data-k=back]')) return go('home');
    const d = e.target.closest('[data-demo]'); if (d) startGame({ mine: d.dataset.demo, theirs: DEMO_DECKS.find((x) => x.key !== d.dataset.demo).key, level: 'easy', first: 'me' });
  };
};

// ---------- settings ----------
screens.settings = () => {
  const s = getSettings(); let taps = 0;
  app.innerHTML = `<div class="screen"><div class="bar"><button class="icon" data-k="back">←</button><h2>Settings</h2><span></span></div>
    <label class="field">Your name<input name="name" value="${h(s.name)}"></label>
    <label class="field">AI speed<select name="aiSpeed">${[[300, 'Fast'], [650, 'Normal'], [1200, 'Slow']].map(([v, l]) => `<option value="${v}" ${+s.aiSpeed === v ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
    <label class="check"><input type="checkbox" name="showImages" ${s.showImages ? 'checked' : ''}> Show card images (from DigimonCard.io)</label>
    <label class="check"><input type="checkbox" name="confirmPass" ${s.confirmPass ? 'checked' : ''}> Ask before passing with memory left</label>
    <label class="field">AI cards with text the game can't do<select name="aiManual"><option value="notice" ${s.aiManual === 'notice' ? 'selected' : ''}>Tell me</option><option value="skip" ${s.aiManual === 'skip' ? 'selected' : ''}>Skip quietly</option></select></label>
    <div class="acts"><button class="btn go" data-k="save">Save</button></div>
    <p class="hint center ver">Version ${APP_VERSION}</p></div>`;
  app.onclick = (e) => {
    const k = e.target.closest('[data-k]')?.dataset.k;
    if (k === 'back') return go('home');
    if (e.target.closest('.ver') && ++taps >= 7) { taps = 0; return devUnlock(() => go('dev')); }
    if (k === 'save') {
      const v = (n) => $(`[name=${n}]`, app);
      saveSettings({ ...s, name: v('name').value.trim() || 'You', aiSpeed: +v('aiSpeed').value, showImages: v('showImages').checked, confirmPass: v('confirmPass').checked, aiManual: v('aiManual').value });
      toast('Saved'); go('home');
    }
  };
};
screens.dev = () => (devOn() ? devScreen(app, go) : go('home'));

go(location.hash.slice(1) || 'home');
