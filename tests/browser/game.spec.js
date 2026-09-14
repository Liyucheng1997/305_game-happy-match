import { test, expect } from '@playwright/test';
const ready = page => page.waitForFunction(() => window.__match3 && !window.__match3.busy);
const forceMatch = page => page.evaluate(() => {
  const game = window.__match3;
  game.grid.forEach(row => row.forEach(gem => { gem.userData.type = 0; }));
  game.clickCell(3,3); game.clickCell(3,4);
});
test('技能、冰层、洗牌和重玩保持正确状态', async ({ page }) => {
  const errors = []; page.on('pageerror', e => errors.push(e.message));
  await page.addInitScript(() => localStorage.setItem('happy-match3-progress', JSON.stringify({unlocked:12,stars:[]})));
  await page.goto('/'); await ready(page);
  expect(await page.evaluate(() => window.__match3.ice.reduce((a,b)=>a+b,0))).toBe(48);
  const target = await page.evaluate(() => { const i=window.__match3.ice.findIndex(x=>x===2); return [Math.floor(i/8),i%8]; });
  await page.locator('#skill-hammer').click();
  await page.evaluate(([r,c]) => window.__match3.clickCell(r,c),target); await ready(page);
  expect(await page.evaluate(([r,c])=>window.__match3.ice[r*8+c],target)).toBe(0);
  expect(await page.evaluate(()=>window.__match3.moves)).toBe(21);
  expect(await page.evaluate(()=>window.__match3.energy)).toBe(0);
  await expect(page.locator('#skill-bomb')).toBeDisabled();
  await forceMatch(page); await ready(page);
  expect(await page.evaluate(()=>window.__match3.energy)).toBe(60);
  await page.locator('#skill-rainbow').click();
  await page.evaluate(()=>window.__match3.clickCell(3,3)); await ready(page);
  expect(await page.evaluate(()=>window.__match3.energy)).toBe(15);
  await forceMatch(page); await ready(page);
  await page.locator('#skill-bomb').click();
  await page.evaluate(()=>window.__match3.clickCell(0,0)); await ready(page);
  expect(await page.evaluate(()=>window.__match3.energy)).toBe(32);
  const before = await page.evaluate(()=>({ice:window.__match3.ice,moves:window.__match3.moves,score:window.__match3.score}));
  await page.locator('#skill-shuffle').click(); await ready(page);
  expect(await page.evaluate(()=>({ice:window.__match3.ice,moves:window.__match3.moves,score:window.__match3.score}))).toEqual(before);
  expect(await page.evaluate(()=>window.__match3.energy)).toBe(12);
  expect(await page.evaluate(()=>window.__match3.consistent())).toBe(true);
  expect(await page.evaluate(()=>window.__match3.findMove())).not.toBeNull();
  await page.locator('#restart').click(); await ready(page);
  expect(await page.evaluate(()=>window.__match3.score)).toBe(0);
  expect(await page.evaluate(()=>window.__match3.moves)).toBe(21);
  await page.screenshot({path:'test-results/desktop.png'});
  expect(errors).toEqual([]);
});
test('过关、解锁、保存、下一关与手机布局', async ({ page }) => {
  await page.setViewportSize({width:390,height:844});
  await page.goto('/'); await ready(page);
  await expect(page.locator('#level-select option:disabled')).toHaveCount(11);
  for(let i=0;i<3;i++) {
    if(await page.evaluate(()=>window.__match3.gameOver)) break;
    await forceMatch(page); await ready(page);
  }
  await expect(page.locator('#result-title')).toHaveText('关卡通过！');
  expect(await page.evaluate(()=>JSON.parse(localStorage.getItem('happy-match3-progress')).unlocked)).toBe(2);
  await page.locator('#next-level').click(); await ready(page);
  expect(await page.evaluate(()=>window.__match3.level.id)).toBe(2);
  await page.reload(); await ready(page);
  expect(await page.evaluate(()=>window.__match3.level.id)).toBe(2);
  const boxes=await Promise.all(['#hud','canvas','#skillbar'].map(selector=>page.locator(selector).boundingBox()));
  expect(boxes[0].y+boxes[0].height).toBeLessThanOrEqual(boxes[1].y);
  expect(boxes[1].y+boxes[1].height).toBeLessThanOrEqual(boxes[2].y);
  await page.screenshot({path:'test-results/mobile.png'});
});
