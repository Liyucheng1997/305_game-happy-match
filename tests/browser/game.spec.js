import { test, expect } from '@playwright/test';

const ready = page => page.waitForFunction(() => window.__match3 && !window.__match3.busy, null, { timeout: 60000 });
const boot = async (page, progress) => {
  if (progress) await page.addInitScript(p => localStorage.setItem('happy-match3-v2', JSON.stringify(p)), progress);
  await page.goto('/');
  await page.waitForFunction(() => window.__match3);
  await page.evaluate(() => window.__match3.setSpeed(4));
};
// 用鼠标拖动完成一次交换
async function drag(page, a, b) {
  const p = await page.evaluate(([a, b]) => ({ a: window.__match3.screenOf(...a), b: window.__match3.screenOf(...b) }), [a, b]);
  await page.mouse.move(p.a.x, p.a.y);
  await page.mouse.down();
  await page.mouse.move(p.b.x, p.b.y, { steps: 4 });
  await page.mouse.up();
}
const hintMove = page => page.evaluate(() => { const h = window.__match3.game.hint(); return [h.a, h.b]; });

test('地图开局、拖动交换、画面与逻辑保持一致', async ({ page }) => {
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await boot(page);
  await expect(page.locator('#map')).toBeVisible();
  await expect(page.locator('#map-path .node.locked')).toHaveCount(14);
  await page.locator('#map-play').click();
  await expect(page.locator('#banner')).toBeVisible();
  await expect(page.locator('#banner-title')).toHaveText('林间起步');
  await page.locator('#banner').click();
  await ready(page);
  for (let k = 0; k < 3; k++) {
    await drag(page, ...(await hintMove(page)));
    await page.waitForTimeout(50);
    await ready(page);
    expect(await page.evaluate(() => window.__match3.consistent())).toBe(true);
  }
  const state = await page.evaluate(() => ({ moves: window.__match3.game.moves, shown: window.__match3.display.moves, score: window.__match3.game.score }));
  expect(state.moves).toBe(17);
  expect(state.shown).toBe(17);
  expect(state.score).toBeGreaterThan(0);
  await expect(page.locator('#moves')).toHaveText('17');
  expect(errors).toEqual([]);
});

test('特效组合、道具、木箱与无效交换', async ({ page }) => {
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await boot(page, { unlocked: 15, stars: [], best: [] });
  await page.evaluate(() => window.__match3.start(4));
  await ready(page);
  // 两个特效交换：不需要三连也算有效
  await page.evaluate(() => {
    const g = window.__match3.game;
    g.cell(2, 3).piece.special = 'row';
    g.cell(2, 4).piece.special = 'col';
    window.__match3.rebuildViews();
  });
  await drag(page, [2, 3], [2, 4]);
  await page.waitForTimeout(50);
  await ready(page);
  expect(await page.evaluate(() => window.__match3.game.moves)).toBe(19);
  expect(await page.evaluate(() => window.__match3.consistent())).toBe(true);
  // 炸弹道具：不扣步数，炸开木箱
  await page.evaluate(() => { window.__match3.game.energy = 60; window.__match3.rebuildViews(); });
  const cratesBefore = await page.evaluate(() => window.__match3.game.cells.reduce((s, c) => s + c.crate, 0));
  await page.locator('#skill-bomb').click();
  await expect(page.locator('#skill-bomb')).toHaveClass(/active/);
  const target = await page.evaluate(() => window.__match3.screenOf(6, 3));
  await page.mouse.click(target.x, target.y);
  await page.waitForTimeout(50);
  await ready(page);
  const after = await page.evaluate(() => ({ moves: window.__match3.game.moves, energy: window.__match3.game.energy, crates: window.__match3.game.cells.reduce((s, c) => s + c.crate, 0) }));
  expect(after.moves).toBe(19);
  expect(after.energy).toBe(32);
  expect(after.crates).toBeLessThan(cratesBefore);
  await expect(page.locator('#skill-rainbow')).toBeDisabled();
  // 无效交换：不扣步数并提示
  await page.evaluate(() => {
    const g = window.__match3.game;
    const types = [0, 1, 2, 3, 4];
    for (const c of g.cells) if (c.piece && !c.crate) { c.piece.kind = 'animal'; c.piece.special = null; c.piece.type = types[(c.r * 2 + c.c) % 5]; }
    window.__match3.rebuildViews();
  });
  await drag(page, [0, 0], [0, 1]);
  await page.waitForTimeout(50);
  await ready(page);
  expect(await page.evaluate(() => window.__match3.game.moves)).toBe(19);
  await expect(page.locator('#status')).toContainText('连不成三个');
  expect(await page.evaluate(() => window.__match3.consistent())).toBe(true);
  await page.screenshot({ path: 'test-results/desktop.png' });
  expect(errors).toEqual([]);
});

test('过关结算、星级保存、下一关与手机布局', async ({ page }) => {
  test.setTimeout(240000);
  await page.setViewportSize({ width: 390, height: 844 });
  await boot(page);
  await page.locator('#map-play').click();
  await page.locator('#banner').click();
  await ready(page);
  await page.evaluate(() => { const g = window.__match3.game; g.goals[0].current = g.goals[0].target; window.__match3.rebuildViews(); });
  await drag(page, ...(await hintMove(page)));
  await expect(page.locator('#result')).toBeVisible({ timeout: 60000 });
  await expect(page.locator('#result-title')).toHaveText('过关啦！');
  await expect(page.locator('#result-stars i.lit').first()).toBeVisible();
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('happy-match3-v2')));
  expect(saved.unlocked).toBe(2);
  expect(saved.stars[0]).toBeGreaterThanOrEqual(1);
  expect(await page.evaluate(() => window.__match3.game.moves)).toBe(0); // 剩余步数已转为奖励
  await page.locator('#result-next').click();
  await ready(page);
  expect(await page.evaluate(() => window.__match3.levelIndex)).toBe(1);
  await page.reload();
  await page.waitForFunction(() => window.__match3);
  await page.evaluate(() => window.__match3.setSpeed(4));
  await expect(page.locator('#map-play')).toHaveText('继续冒险 · 第 2 关');
  await page.locator('#map-play').click();
  await page.locator('#banner').click();
  await ready(page);
  // 棋盘位于顶栏与道具栏之间
  const top = await page.locator('#topbar').boundingBox();
  const bottom = await page.locator('#skillbar').boundingBox();
  const corners = await page.evaluate(() => [window.__match3.screenOf(0, 1), window.__match3.screenOf(7, 1)]);
  expect(corners[0].y - 20).toBeGreaterThan(top.y + top.height);
  expect(corners[1].y + 20).toBeLessThan(bottom.y);
  await page.screenshot({ path: 'test-results/mobile.png' });
});
