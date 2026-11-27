# Digimon Sim — notes for Claude
- Plain ES modules, no build. Run `node tests/run.mjs` before committing; it must pass.
- Bump `VERSION` (sw.js) and `APP_VERSION` (js/devfixes.js) together on every change; add new JS files to `SHELL` in sw.js.
- Commit as `git -c user.name=Th3BandA1d3 -c user.email=Th3BandA1d3@users.noreply.github.com commit` and push to `main` (GitHub Pages deploys it).
- Never commit Bandai card text or images; real card data is fetched at runtime from DigimonCard.io. Demo cards in js/data/demo.js are invented.
- Rule-fix issues: see DEV.md ("Fixes sent straight to Claude"). Card text and the comprehensive rules win over a note.
- Keep the app free, non-commercial and clearly unofficial.
