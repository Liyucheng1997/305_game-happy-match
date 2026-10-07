// 关卡平衡模拟：用贪心机器人反复游玩每关，统计胜率与得分分布。
// 用法：node scripts/simulate.mjs [每关局数=40] [关卡编号...]
import { LEVELS } from '../src/levels.js';
import { Game, mulberry32 } from '../src/engine.js';

const runs = Number(process.argv[2]) || 40;
const only = process.argv.slice(3).map(Number);

function value(game) {
  let v = 0;
  for (const g of game.goals) v += Math.min(g.current, g.target) / g.target * 1000;
  for (const cell of game.cells) if (cell.piece?.special || cell.piece?.kind === 'rainbow') v += 25;
  for (const cell of game.cells) if (cell.piece?.kind === 'acorn') v += cell.r * 15;
  return v + game.score * 0.02;
}

function play(level, seed) {
  const game = new Game(level, { rng: mulberry32(seed) });
  while (game.status === 'playing') {
    const moves = game.findMoves();
    let best = null, bestValue = -Infinity;
    for (const m of moves) {
      const copy = game.clone();
      copy.trySwap(m.a, m.b);
      const v = value(copy);
      if (v > bestValue) { bestValue = v; best = m; }
    }
    game.trySwap(best.a, best.b);
  }
  const won = game.status === 'won';
  const movesLeft = game.moves;
  if (won) game.finale();
  return { won, score: game.score, movesLeft };
}

const pct = (arr, p) => arr.length ? arr[Math.min(arr.length - 1, Math.floor(arr.length * p))] : 0;
for (const level of LEVELS) {
  if (only.length && !only.includes(level.id)) continue;
  const results = Array.from({ length: runs }, (_, k) => play(level, 1000 + k * 7919));
  const wins = results.filter(r => r.won);
  const scores = wins.map(r => r.score).sort((a, b) => a - b);
  const left = wins.map(r => r.movesLeft).sort((a, b) => a - b);
  console.log(`${String(level.id).padStart(2)} ${level.name.padEnd(5, '　')} 胜率 ${(wins.length / runs * 100).toFixed(0).padStart(3)}%  ` +
    `剩余步 p50=${pct(left, 0.5)}  得分 p25=${pct(scores, 0.25)} p50=${pct(scores, 0.5)} p85=${pct(scores, 0.85)}  当前星线 ${level.stars.join("/")}  建议 ${[0.3, 0.75].map(p => Math.round(pct(scores, p) / 100) * 100).join("/")}`);
}
