# Developer notes

## Layout
- `js/cards.js` — text parser. `normText` (brackets, reminder text), `parseText` splits text into abilities by timing
  tags (a tag only starts an ability at the start of a sentence), `parseAbility`, `parseEffectSentence` + `rule(...)`
  list, `parseWho` (strict: "1 of your opponent's Digimon with 4000 DP or less" → filter; unknown words → null),
  `parseCond`, `parseStatic` (continuous [Your Turn]/[All Turns] effects), `EVENT_RE` ("When this Digimon attacks, …").
  `makeDef(raw)` builds a card definition with `kw`, `abilities`, `inhKw`, `inherited`, `manual`.
- `js/engine.js` — `Game`: memory (`memory` > 0 is player 0's side; `mem(pl)`), turns and phases, `legalActions`,
  `digivolve`, `attack` → block → `securityCheck` / `battle`, `deleteStack` (Armor Purge / Evade / Barrier /
  Fortitude, [On Deletion]), `statics` / `dp` / `kw` (inherited effects, continuous effects, temporary boosts with an
  `expires` turn), `triggerOn`, `fireEvent`, `runAbility` → `effect`.
  A stack is `{ cards: [bottom … top], suspended, enteredTurn, temp }`.
- `js/ai.js` — `AIController('normal' | 'easy')`, `GoldfishController`.
- `js/carddb.js` — DigimonCard.io lookups (batched card numbers, ~1 request/0.8 s), IndexedDB cache, `fromApi`.
- `js/data/demo.js` — invented demo cards and decks (offline play, tests).
- `js/deckparse.js`, `js/storage.js`, `js/ui/board.js` (board, HumanController, watch mode, Tools),
  `js/ui/devui.js` (Dev menu), `js/ui/explain.js`, `js/app.js` (screens).
- Bump `VERSION` in `sw.js` and `APP_VERSION` in `js/devfixes.js` together on every change; add new files to `SHELL`.

## Tests
- `node tests/run.mjs` — parser, deck formats, API mapping, rules (memory, digivolve, security, blocking, Piercing,
  Jamming, security Tamers/Options, statics), fixes, and 30 full AI games.
- `node tools/sim.mjs 60` — AI-vs-AI balance (`A=easy`, `DA=demo-blue` etc. as environment variables).

## Fixes sent straight to Claude (rule-fix issues)
Saving a fix in Dev with a **note for Claude** opens a GitHub issue titled "Rule fix: …" labelled `rule-fix`
(silently with a fine-grained token saved under Dev → Send, otherwise via a prefilled issue page). The body has the
note, the card, the text, the owner's replacement and a JSON block (`kind: 'digimon-sim-rule-fix'`).
To process them: read the note (what the card should really do — the card text and the rules are the final
authority), implement it generally in `js/cards.js` / `js/engine.js` so every card with that wording works (only if
that isn't practical, add it to `SHIPPED_FIXES` in `js/rulefixes.js`), add a test, run the tests, bump the version,
push, then comment on the issue, label it `built-in` and close it.

Fix keys: sentence-level fixes match one sentence; for continuous/event abilities the whole ability
("[Your Turn] When …") is the key, so a replacement can rewrite all of it. `{n1}` placeholders match any number.
