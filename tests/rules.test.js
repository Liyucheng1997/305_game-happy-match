import test from 'node:test';
import assert from 'node:assert/strict';
import { LEVELS, ANIMALS, SKILLS, starsFor, readProgress } from '../src/levels.js';
import { Game, mulberry32 } from '../src/engine.js';

const level = (layout, extra = {}) => ({ id: 0, name: 't', moves: 10, types: 4, stars: [100, 200], goals: [{ kind: 'score', target: 1e9 }], layout, ...extra });
// 用类型矩阵覆盖棋盘（数字 = 动物类型，# = 不设置）
function setTypes(game, rows) {
  rows.forEach((line, r) => [...line].forEach((ch, c) => {
    const cell = game.cell(r, c);
    if (/\d/.test(ch) && cell.piece) { cell.piece.type = Number(ch); cell.piece.kind = 'animal'; cell.piece.special = null; }
  }));
}
const pieceIds = game => game.cells.map(c => c.piece?.id ?? null);

test('关卡数据合法：布局尺寸、动物种类、目标可达', () => {
  assert.equal(LEVELS.length, 15);
  for (const lv of LEVELS) {
    assert.ok(lv.layout.every(line => line.length === lv.layout[0].length && /^[.o12cCvwa]+$/.test(line)), lv.name);
    assert.ok(lv.types <= ANIMALS.length);
    assert.ok(lv.stars[0] < lv.stars[1]);
    const game = new Game(lv, { rng: mulberry32(lv.id) });
    for (const g of game.goals) {
      assert.ok(g.target > 0, `${lv.name} ${g.kind}`);
      if (g.kind === 'collect') assert.ok(g.type < lv.types);
    }
    // 初始棋盘：没有空位、没有现成三连、至少有一步可走
    assert.ok(game.cells.every(c => c.void || c.crate || c.piece), lv.name);
    assert.equal(game.findGroups().length, 0, lv.name);
    assert.ok(game.hasMove(), lv.name);
  }
});

test('连成 4 个生成疾风动物，L 形生成炸弹，5 个生成彩虹球', () => {
  const g = new Game(level(['oooooo', 'oooooo', 'oooooo', 'oooooo', 'oooooo']), { rng: mulberry32(1) });
  setTypes(g, ['001023', '230312', '312231', '123123', '231231']);
  let res = g.trySwap([1, 2], [0, 2]);
  assert.ok(res.valid);
  const created = res.steps.find(s => s.type === 'clear').created;
  assert.equal(created.length, 1);
  assert.equal(created[0].piece.special, 'col');

  const g2 = new Game(level(['ooooo', 'ooooo', 'ooooo', 'ooooo', 'ooooo']), { rng: mulberry32(2) });
  setTypes(g2, ['00103', '11023', '22031', '31212', '23123']);
  res = g2.trySwap([0, 3], [0, 2]);
  assert.ok(res.valid);
  assert.equal(res.steps.find(s => s.type === 'clear').created[0].piece.special, 'bomb');

  const g3 = new Game(level(['ooooo', 'ooooo', 'ooooo', 'ooooo']), { rng: mulberry32(3) });
  setTypes(g3, ['00100', '11011', '23232', '32323']);
  res = g3.trySwap([1, 2], [0, 2]);
  assert.equal(res.steps.find(s => s.type === 'clear').created[0].piece.kind, 'rainbow');
});

test('无效交换不扣步数并原样换回', () => {
  const g = new Game(level(['oooo', 'oooo', 'oooo', 'oooo']), { rng: mulberry32(4) });
  setTypes(g, ['0123', '1230', '2301', '3012']);
  const before = pieceIds(g);
  const res = g.trySwap([0, 0], [0, 1]);
  assert.equal(res.valid, false);
  assert.equal(g.moves, 10);
  assert.deepEqual(pieceIds(g), before);
  assert.ok(res.steps.at(-1).back);
});

test('疾风动物清整行，两个特效交换触发十字组合', () => {
  const g = new Game(level(['ooooo', 'ooooo', 'ooooo', 'ooooo', 'ooooo']), { rng: mulberry32(5) });
  setTypes(g, ['01230', '12301', '23012', '30123', '01230']);
  g.cell(2, 2).piece.special = 'row';
  g.cell(2, 3).piece.special = 'col';
  const res = g.trySwap([2, 2], [2, 3]);
  assert.ok(res.valid);
  const clear = res.steps.find(s => s.type === 'clear');
  assert.deepEqual(clear.effects.map(e => e.kind).sort(), ['col', 'row']);
  // 十字：第 2 行 5 格 + 第 3 列另外 4 格
  assert.equal(clear.hits.length, 9);
  assert.equal(g.moves, 9);
});

test('彩虹球与普通动物交换：消除全部同类', () => {
  const g = new Game(level(['oooo', 'oooo', 'oooo', 'oooo']), { rng: mulberry32(6) });
  setTypes(g, ['0123', '1230', '2301', '3012']);
  g.cell(0, 0).piece.kind = 'rainbow';
  g.cell(0, 0).piece.type = -1;
  const res = g.trySwap([0, 0], [0, 1]);
  const clear = res.steps.find(s => s.type === 'clear');
  assert.ok(res.valid);
  assert.equal(clear.effects[0].kind, 'rainbow');
  assert.equal(clear.effects[0].type, 1);
  assert.equal(clear.hits.length, 1 + 4); // 彩虹球自身 + 4 只类型 1
});

test('冰层、木箱与藤蔓逐层受损', () => {
  const g = new Game(level(['ooooo', '22ooo', 'cvooo', 'Coooo'], { goals: [{ kind: 'ice' }, { kind: 'crate' }, { kind: 'vine' }] }), { rng: mulberry32(7) });
  assert.deepEqual(g.goals.map(x => x.target), [4, 3, 1]);
  g.beginClear(1);
  g.hit(g.cell(1, 0).i, 0); // 消除动物并削一层冰
  g.hit(g.cell(2, 0).i, 0); // 木箱
  g.hit(g.cell(3, 0).i, 0); // 铁箍木箱 2→1
  g.hit(g.cell(2, 1).i, 0); // 藤蔓解开，动物保留
  g.endClear();
  assert.equal(g.cell(1, 0).ice, 1);
  assert.equal(g.cell(2, 0).crate, 0);
  assert.equal(g.cell(3, 0).crate, 1);
  assert.equal(g.cell(2, 1).vine, false);
  assert.ok(g.cell(2, 1).piece);
  assert.deepEqual(g.goals.map(x => x.current), [1, 2, 1]);
});

test('重力：补满棋盘，木箱下方从斜上方滑入', () => {
  const g = new Game(level(['ooo', 'oco', 'ooo', 'ooo']), { rng: mulberry32(8) });
  for (const cell of g.cells) if (!cell.crate && cell.r >= 2) cell.piece = null;
  const fall = g.gravity();
  assert.ok(fall.moves.length > 0);
  assert.ok(g.cells.every(c => c.crate || c.piece));
  // 每条路径时间递增、每步只移动一格（斜向算一格）
  for (const m of fall.moves) for (let k = 1; k < m.path.length; k++) {
    assert.ok(m.path[k].t > m.path[k - 1].t);
    assert.ok(Math.abs(m.path[k].c - m.path[k - 1].c) <= 1);
  }
});

test('橡果落到底部被收集', () => {
  const g = new Game(level(['oao', 'ooo', 'ooo'], { goals: [{ kind: 'acorn', target: 1 }] }), { rng: mulberry32(9) });
  g.cell(1, 1).piece = null; g.cell(2, 1).piece = null;
  const steps = [];
  g.settle(steps, 1);
  assert.ok(steps.some(s => s.type === 'collect'));
  assert.equal(g.goals[0].current, 1);
  assert.equal(g.acornsPending, 0);
});

test('技能：小木槌一次敲碎全部层，不加能量也不扣步数', () => {
  const g = new Game(level(['ooo', 'oCo', 'o2o'], { goals: [{ kind: 'crate' }, { kind: 'ice' }] }), { rng: mulberry32(10) });
  g.energy = 60;
  assert.ok(g.useSkill('hammer', 1, 1).ok);
  assert.equal(g.cell(1, 1).crate, 0);
  assert.ok(g.useSkill('hammer', 2, 1).ok);
  assert.equal(g.cell(2, 1).ice, 0);
  assert.equal(g.energy, 60 - 2 * SKILLS.hammer.cost);
  assert.equal(g.moves, 10);
  g.energy = 5;
  assert.equal(g.useSkill('bomb', 0, 0).ok, false);
});

test('洗牌保留障碍与特效，结果无现成三连且有路可走', () => {
  const lv = LEVELS[9];
  const g = new Game(lv, { rng: mulberry32(11) });
  const obstacles = g.cells.map(c => [c.ice, c.crate, c.vine]);
  g.cell(0, 0).piece.special = 'bomb';
  const step = g.shuffle();
  assert.equal(step.type, 'shuffle');
  assert.deepEqual(g.cells.map(c => [c.ice, c.crate, c.vine]), obstacles);
  assert.equal(g.findGroups().length, 0);
  assert.ok(g.hasMove());
  assert.ok(g.cells.some(c => c.piece?.special === 'bomb'));
});

test('过关后剩余步数转化为奖励，状态与星级正确', () => {
  const g = new Game(level(['oooo', 'oooo', 'oooo', 'oooo'], { goals: [{ kind: 'score', target: 0 }] }), { rng: mulberry32(12) });
  g.afterMove([]);
  assert.equal(g.status, 'won');
  const before = g.score;
  const steps = g.finale();
  assert.equal(g.moves, 0);
  assert.ok(steps[0].type === 'convert');
  assert.ok(g.score >= before + 10 * 50);
  const lv = LEVELS[0];
  assert.equal(starsFor(lv, 0), 1);
  assert.equal(starsFor(lv, lv.stars[0]), 2);
  assert.equal(starsFor(lv, lv.stars[1]), 3);
});

test('步数用完未达成目标即失败', () => {
  const g = new Game(level(['oooo', 'oooo', 'oooo', 'oooo']), { rng: mulberry32(13) });
  g.moves = 0;
  g.afterMove([]);
  assert.equal(g.status, 'lost');
  assert.equal(g.trySwap([0, 0], [0, 1]).valid, false);
});

test('损坏存档恢复默认值', () => {
  assert.equal(readProgress('invalid').unlocked, 1);
  assert.equal(readProgress(null).unlocked, 1);
  const p = readProgress('{"unlocked":99,"stars":[9,-2],"best":[500]}');
  assert.equal(p.unlocked, LEVELS.length);
  assert.deepEqual(p.stars.slice(0, 3), [3, 0, 0]);
  assert.equal(p.best[0], 500);
});

test('随机对局长时间运行：棋盘始终填满且视觉路径一致', () => {
  for (const lv of LEVELS) {
    const g = new Game(lv, { rng: mulberry32(100 + lv.id) });
    g.moves = 40;
    for (let n = 0; n < 40 && g.status === 'playing'; n++) {
      const move = g.hint();
      assert.ok(move, `${lv.name} 无可用步`);
      const res = g.trySwap(move.a, move.b);
      assert.ok(res.valid, `${lv.name} 提示的步无效`);
      assert.ok(g.cells.every(c => c.void || c.crate || c.piece), `${lv.name} 出现空格`);
      assert.equal(g.findGroups().length, 0);
    }
  }
});
