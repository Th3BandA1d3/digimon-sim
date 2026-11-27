// Quick AI-vs-AI simulation: node tools/sim.mjs [games] [log]
import { newGame } from '../tests/helpers.mjs';
import { AIController } from '../js/ai.js';
const N = +process.argv[2] || 50; const showLog = process.argv[3] === 'log';
const lines = []; let wins = [0, 0]; let turns = 0; let errors = 0;
for (let seed = 1; seed <= N; seed++) {
  const g = newGame({ seed, first: seed % 2, io: { log: (m) => showLog && seed === 1 && lines.push(m) }, ctrlA: new AIController(process.env.A || 'normal'), ctrlB: new AIController(process.env.B || 'normal'), a: process.env.DA || 'demo-red', b: process.env.DB || 'demo-blue' });
  try { const w = await g.run(); if (w) wins[w.idx]++; turns += g.turn; } catch (e) { errors++; console.log('seed', seed, e.stack); }
}
if (showLog) console.log(lines.join('\n'));
console.log(`games ${N}  wins A/B ${wins.join('/')}  avg turns ${(turns / N).toFixed(1)}  errors ${errors}`);
