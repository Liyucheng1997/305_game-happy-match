import test from 'node:test';
import assert from 'node:assert/strict';
import { LEVELS, SKILLS, skillCells, objectivesMet, starsFor, readProgress, outcomeFor } from '../src/rules.js';

test('关卡难度递进且收集动物存在于当前关卡', () => {
  assert.equal(LEVELS.length, 12);
  LEVELS.forEach((level, i) => {
    assert.ok(level.collectType < level.types);
    if (i) {
      assert.ok(level.moves <= LEVELS[i - 1].moves);
      assert.ok(level.targetScore > LEVELS[i - 1].targetScore);
      assert.ok(level.iceCount >= LEVELS[i - 1].iceCount);
    }
  });
});
test('炸弹边角裁剪、锤子单格、彩虹仅同类', () => {
  const board = [[0,1,0],[1,0,1],[0,1,0]];
  assert.deepEqual([...skillCells('bomb',0,0,board)], [0,1,3,4]);
  assert.equal(skillCells('bomb',1,1,board).size, 9);
  assert.deepEqual([...skillCells('hammer',1,1,board)], [4]);
  assert.deepEqual([...skillCells('rainbow',0,0,board)], [0,2,4,6,8]);
  assert.ok(Object.values(SKILLS).every(skill => skill.cost > 0 && skill.cost <= 60));
});
test('通关必须满足全部目标，包括所有冰层', () => {
  const level = LEVELS[7];
  assert.equal(objectivesMet(level, level.targetScore, level.collect, 0), true);
  assert.equal(objectivesMet(level, level.targetScore - 1, level.collect, 0), false);
  assert.equal(objectivesMet(level, level.targetScore, level.collect - 1, 0), false);
  assert.equal(objectivesMet(level, level.targetScore, level.collect, 1), false);
});
test('星级边界与损坏存档恢复', () => {
  assert.equal(starsFor(10,26),3);
  assert.equal(starsFor(9,26),2);
  assert.equal(starsFor(4,26),2);
  assert.equal(starsFor(3,26),1);
  assert.equal(starsFor(0,26),1);
  assert.equal(readProgress('invalid').unlocked,1);
  assert.equal(readProgress(null).unlocked,1);
  assert.deepEqual(readProgress('{"unlocked":99,"stars":[9,-2]}'),{unlocked:12,stars:[3,0,0,0,0,0,0,0,0,0,0,0]});
});

test('最后一步完成目标仍获胜，零步未达标失败', () => {
  const level = LEVELS[2];
  assert.equal(outcomeFor(level, level.targetScore, level.collect, 0, 0), 'won');
  assert.equal(outcomeFor(level, level.targetScore, level.collect, 1, 0), 'lost');
  assert.equal(outcomeFor(level, 0, 0, 0, 1), 'playing');
});
