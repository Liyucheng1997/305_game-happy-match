export const LEVELS = Array.from({ length: 12 }, (_, i) => ({
  id: i + 1,
  name: ['林间起步', '采集时光', '薄冰初现', '冰湖探险', '缤纷山谷', '霜雪小径', '双层冰阵', '极光森林', '寒冬挑战', '冰封峡谷', '群星试炼', '森林之巅'][i],
  moves: 26 - Math.floor(i / 2),
  types: i < 4 ? 5 : 6,
  targetScore: 650 + i * 140,
  collectType: i % 6,
  collect: i === 0 ? 0 : 10 + i * 2,
  iceCount: i < 2 ? 0 : 6 + (i - 2) * 2,
  iceLayers: i < 6 ? 1 : 2,
}));

export const SKILLS = {
  hammer: { name: '破冰锤', cost: 12, description: '点击一格，清除动物并击碎该格全部冰层' },
  bomb: { name: '范围炸弹', cost: 28, description: '点击一格，消除周围 3×3 区域' },
  rainbow: { name: '彩虹魔法', cost: 45, description: '点击一个动物，消除全盘同类动物' },
  shuffle: { name: '重新洗牌', cost: 20, description: '重排动物，冰层留在原位' },
};

export function skillCells(kind, r, c, board) {
  const cells = new Set();
  const type = board[r][c];
  for (let y = 0; y < board.length; y++) for (let x = 0; x < board[y].length; x++) {
    if ((kind === 'hammer' && y === r && x === c) ||
        (kind === 'bomb' && Math.abs(y - r) <= 1 && Math.abs(x - c) <= 1) ||
        (kind === 'rainbow' && board[y][x] === type)) cells.add(y * board[0].length + x);
  }
  return cells;
}

export function objectivesMet(level, score, collected, iceLeft) {
  return score >= level.targetScore && collected >= level.collect && iceLeft === 0;
}

export function starsFor(moves, initialMoves) {
  return moves >= Math.ceil(initialMoves * 0.35) ? 3 : moves >= Math.ceil(initialMoves * 0.15) ? 2 : 1;
}

export function readProgress(raw) {
  try {
    const data = JSON.parse(raw);
    return { unlocked: Math.min(12, Math.max(1, Math.floor(Number(data.unlocked) || 1))),
      stars: Array.from({ length: 12 }, (_, i) => Math.min(3, Math.max(0, Math.floor(Number(data.stars?.[i]) || 0)))) };
  } catch { return { unlocked: 1, stars: Array(12).fill(0) }; }
}

export function outcomeFor(level, score, collected, iceLeft, moves) {
  if (objectivesMet(level, score, collected, iceLeft)) return 'won';
  return moves <= 0 ? 'lost' : 'playing';
}
