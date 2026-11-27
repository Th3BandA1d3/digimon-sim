# Digimon Sim

A free, unofficial practice app for the **Digimon Card Game**: import your deck and play it against an AI, or watch two AIs play.
It runs in the browser and installs on a phone (Add to Home Screen). Built on the same foundations as
[Commander Sim](https://github.com/Th3BandA1d3/commander-sim).

**Live:** https://th3banda1d3.github.io/digimon-sim/

## What it does
- **Play** your deck against a Normal or Easy AI (or a goldfish that does nothing). Choose who goes first.
- **Watch** two AIs play: auto-play with pause, or step by step with **Next**, and a match summary at the end.
- **My decks:** paste a deck list — `4 Agumon BT1-010`, `BT1-010 x4`, or a Tabletop Simulator / digimoncard.dev list
  (`["BT1-001", "BT1-010", …]`). Cards are looked up by card number on DigimonCard.io and cached on the device;
  Digi-Eggs go to the egg deck automatically. The deck page shows legality notes and which cards have text the game
  can't do by itself yet.
- **Official starter decks:** ST-1 to ST-10, ST-12 to ST-21 and ST-23, ready to play or watch (card numbers only;
  cards load from DigimonCard.io). "Save a copy" puts one in My decks to edit.
- **Learn:** a short how-to-play and practice games with two demo decks.
- **Rules engine:** memory gauge and turn passing, breeding area (hatch / move), digivolving (colour + level, cost,
  draw 1, inherited effects), attacking players or suspended Digimon, blocking, security checks and security battles,
  [Security] effects of Tamers and Options, deletion at 0 DP, winning on an empty security stack or deck-out.
  Keywords: Blocker, Security A. ±N, Rush, Piercing, Jamming, Reboot, Retaliation, Recovery, De-Digivolve, Draw,
  Armor Purge, Evade, Barrier, Fortitude. Timings: [On Play], [When Digivolving], [When Attacking], [On Deletion],
  [Main], [Security], [Your Turn] / [Opponent's Turn] / [All Turns] (continuous effects and "When …" events),
  [Start of Your Turn], [Start of Your Main Phase], [End of Your Turn], [Once Per Turn].
- **Manual steps:** text the game can't do yet pauses with a "Manual step" for your cards; **Tools** (☰) let you
  adjust memory, draw, trash security, delete, suspend or change DP by hand.
- **Dev menu** (owner only, Settings → tap the version 7 times): collects text that isn't automated, lets you write a
  fix with a builder and a plain-English check, and — if you add a note for Claude — sends it as a GitHub issue so it
  gets built in for everyone. Also a keyword list and wording tips.

## Not yet
Alliance, Raid, Blitz, Digisorption, Collision, Decoy, Save, Mind Link, DigiXros, DNA/burst digivolution, [Counter]
timing, and many specific card wordings. Missing pieces appear as manual steps and in Dev → Found.

## Card data, images and fan-project note
Card data and images come from the [DigimonCard.io public API](https://digimoncard.io/api-documentation) at runtime and
are cached only on your device; this repository contains no Bandai card text or images. The demo decks use invented
cards. This is a free, non-commercial fan project, not affiliated with or endorsed by Bandai; Digimon and the Digimon
Card Game are trademarks of their respective owners.

## Development
No build step: plain ES modules. `node tests/run.mjs` runs the tests; `node tools/sim.mjs 50` runs AI-vs-AI games.
See `DEV.md`.
