import * as THREE from 'three';
import { LEVELS, ANIMALS, SKILLS, starsFor, readProgress } from './levels.js';
import { Game } from './engine.js';
import { createLibrary, makeDeco, makeIce, makeCrate, makeVine, renderIcons, CELL, PIECE_Z } from './models.js';
import { createWorld, buildBoard, cellPosition } from './world.js';
import { FX } from './fx.js';
import { createUI, goalLabel } from './ui.js';
import { unlock, sfx, setMuted, isMuted } from './audio.js';

const SAVE_KEY = 'happy-match3-v2';
const TICK = 0.07;           // 下落时每格耗时
const HINT_DELAY = 6;        // 闲置多少秒后提示

// ---------- 渲染器与场景 ----------
const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setSize(innerWidth, innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;
document.getElementById('stage').append(renderer.domElement);
const canvas = renderer.domElement;

const world = createWorld(renderer);
const { scene } = world;
const camera = new THREE.PerspectiveCamera(36, innerWidth / innerHeight, 0.1, 200);
const camBase = new THREE.Vector3(0, 0, 20);
const lib = createLibrary();

const board = new THREE.Group();
scene.add(board);
let boardBase = null;
const fx = new FX(scene, board);
fx.setRoot(board);

// 选中框与技能范围框
function frameTexture(stroke, fill) {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const ctx = c.getContext('2d');
  ctx.fillStyle = fill; ctx.strokeStyle = stroke; ctx.lineWidth = 9;
  ctx.beginPath(); ctx.roundRect(8, 8, 112, 112, 24); ctx.fill(); ctx.stroke();
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
const selFrame = new THREE.Mesh(new THREE.PlaneGeometry(0.98, 0.98), new THREE.MeshBasicMaterial({ map: frameTexture('#ffb31f', 'rgba(255,225,120,0.45)'), transparent: true, depthWrite: false }));
selFrame.visible = false;
board.add(selFrame);
const previewMat = new THREE.MeshBasicMaterial({ map: frameTexture('#c45cff', 'rgba(210,140,255,0.4)'), transparent: true, depthWrite: false });
const previewFrames = [];

// ---------- 状态 ----------
const views = new Map();        // 棋子 id → 模型
const cellViews = new Map();    // 格子 → { ice, crate, vine }
let game = null, levelIndex = 0, busy = false, selected = null, activeSkill = null, drag = null, hint = null;
let display = { moves: 0, score: 0, goals: [], energy: 0 };
let clockTime = 0, lastAction = 0, timeScale = 1, shake = 0, levelToken = 0;
const lookTarget = new THREE.Vector3();
let lookUntil = 0;
let progress = loadProgress();

function loadProgress() { try { return readProgress(localStorage.getItem(SAVE_KEY)); } catch { return readProgress(null); } }
function saveProgress() { try { localStorage.setItem(SAVE_KEY, JSON.stringify(progress)); return true; } catch { return false; } }

// ---------- 补间动画（按游戏时间推进，切到后台时自动暂停） ----------
const anims = new Set();
function animate(duration, fn, ease = t => t) {
  return new Promise(resolve => {
    if (duration <= 0) { fn(1, 1); resolve(); return; }
    anims.add({ t: 0, duration, fn, ease, resolve });
  });
}
const wait = s => animate(s, () => {});
const easeInOut = t => (t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2);
const easeOutBack = t => 1 + 2.70158 * (t - 1) ** 3 + 1.70158 * (t - 1) ** 2;
const easeInCubic = t => t * t * t;
function tickAnims(dt) {
  for (const a of [...anims]) {
    a.t += dt;
    const k = Math.min(1, a.t / a.duration);
    a.fn(a.ease(k), k);
    if (k >= 1) { anims.delete(a); a.resolve(); }
  }
}

// ---------- 坐标 ----------
const posOf = (r, c) => cellPosition(game, r, c).setZ(PIECE_Z);
const posOfI = i => posOf(Math.floor(i / game.cols), i % game.cols);
const colorOf = v => (v.userData.kind === 'animal' ? ANIMALS[v.userData.type].color : v.userData.kind === 'acorn' ? '#c9803f' : '#d08cff');
function toScreen(p) {
  const v = p.clone().project(camera);
  return { x: (v.x + 1) / 2 * innerWidth, y: (1 - v.y) / 2 * innerHeight };
}

// ---------- 棋子模型 ----------
const decoCache = new Map();
function setSpecial(v, special) {
  const u = v.userData;
  if (u.deco) v.remove(u.deco);
  u.special = special;
  u.deco = null;
  if (!special) return;
  const key = special;
  if (!decoCache.has(key)) decoCache.set(key, makeDeco(special));
  u.deco = decoCache.get(key).clone();
  v.add(u.deco);
}
function makeView(p) {
  const proto = p.kind === 'acorn' ? lib.acorn : p.kind === 'rainbow' ? lib.rainbow : lib.animals[p.type];
  const v = proto.clone();
  v.userData = {
    id: p.id, kind: p.kind, type: p.type, special: null, deco: null,
    body: v.getObjectByName('body'), eyes: v.getObjectByName('eyes'), gem: v.getObjectByName('gem'), orbit: v.getObjectByName('orbit'),
    blink: clockTime + 1 + Math.random() * 4, phase: Math.random() * Math.PI * 2,
  };
  setSpecial(v, p.special);
  board.add(v);
  views.set(p.id, v);
  return v;
}
function dropView(v) { board.remove(v); views.delete(v.userData.id); }

const protoCache = {};
function obstacleProto(kind, layers) {
  const key = `${kind}${layers}`;
  protoCache[key] ??= kind === 'ice' ? makeIce(layers) : kind === 'crate' ? makeCrate(layers) : makeVine();
  return protoCache[key].clone();
}
function setObstacle(i, kind, layers) {
  const entry = cellViews.get(i) ?? {};
  cellViews.set(i, entry);
  if (entry[kind]) board.remove(entry[kind]);
  entry[kind] = null;
  if (!layers) return;
  const obj = obstacleProto(kind, layers);
  const p = posOfI(i);
  obj.position.x = p.x;
  obj.position.y = p.y;
  obj.position.z = kind === 'vine' ? PIECE_Z : kind === 'crate' ? obj.position.z - 0.015 : -0.015;
  board.add(obj);
  entry[kind] = obj;
}

// ---------- 镜头适配：棋盘放在顶栏与道具栏之间 ----------
function fitCamera() {
  if (!game) return;
  const top = document.getElementById('topbar').getBoundingClientRect().bottom + 6;
  const bottom = document.getElementById('skillbar').getBoundingClientRect().top - 6;
  const W = innerWidth, H = innerHeight;
  const regionH = Math.max(120, bottom - top), regionW = Math.max(120, W - 16);
  const hasExits = game.goals.some(g => g.kind === 'acorn');
  const bw = game.cols * CELL + 0.7, bh = game.rows * CELL + 0.7 + (hasExits ? 0.5 : 0);
  const tanHalf = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
  const D = Math.max(bh * H / (2 * tanHalf * regionH), bw * H / (2 * tanHalf * regionW));
  const wpp = (2 * D * tanHalf) / H;
  const dyPix = H / 2 - (top + bottom) / 2;
  const offsetY = hasExits ? -0.25 : 0;
  camBase.set(0, -dyPix * wpp + offsetY, D + 0.3);
  camera.aspect = W / H;
  camera.updateProjectionMatrix();
  fx.setScale(renderer.getDrawingBufferSize(new THREE.Vector2()).y / (2 * tanHalf));
}
function onResize() {
  renderer.setSize(innerWidth, innerHeight);
  fitCamera();
}
addEventListener('resize', onResize);

// ---------- HUD ----------
const ui = createUI({
  onPlay(i) {
    unlock();
    const index = i ?? Number(document.getElementById('map-play').dataset.level);
    if (index + 1 <= progress.unlocked) startLevel(index);
  },
  onMap() {
    unlock();
    if (busy && !ui.resultOpen()) return;
    ui.showMap(progress, levelIndex, !!game && game.status === 'playing' && !ui.resultOpen());
  },
  onCloseMap() { ui.hideMap(); },
  onRestart() { unlock(); if (!busy || ui.resultOpen()) startLevel(levelIndex); },
  onNext() { unlock(); if (levelIndex + 1 < LEVELS.length) startLevel(levelIndex + 1); },
  onSound() {
    unlock();
    setMuted(!isMuted());
    ui.setSound(!isMuted());
    try { localStorage.setItem('happy-match3-muted', isMuted() ? '1' : '0'); } catch { /* 忽略 */ }
  },
  onSkill(kind) {
    unlock();
    if (!game || busy || game.status !== 'playing' || game.energy < SKILLS[kind].cost) return;
    lastAction = clockTime;
    clearHint();
    if (kind === 'shuffle') { castSkill('shuffle', null); return; }
    activeSkill = activeSkill === kind ? null : kind;
    select(null);
    showPreview([]);
    ui.status(activeSkill ? `${SKILLS[kind].description}。再次点击按钮或按 Esc 取消。` : '已取消道具。');
    refreshHUD();
  },
});
ui.setIcons(renderIcons(lib, world.envMap));
try { if (localStorage.getItem('happy-match3-muted') === '1') { setMuted(true); ui.setSound(false); } } catch { /* 忽略 */ }

function syncDisplay() {
  display = { moves: game.moves, score: game.score, goals: game.goals.map(g => ({ ...g })), energy: game.energy };
}
function refreshHUD() {
  if (!game) return;
  ui.update({ ...display, busy, playing: game.status === 'playing', activeSkill });
}
function bumpGoal(kind, type, n) {
  let changed = false;
  for (const g of display.goals) if (g.kind === kind && (kind !== 'collect' || g.type === type)) { g.current += n; changed = true; }
  if (changed) refreshHUD();
}

// ---------- 关卡流程 ----------
async function startLevel(index, { banner = true } = {}) {
  ui.hideMap();
  ui.hideResult();
  ui.hideBanner();
  const token = ++levelToken;
  levelIndex = index;
  const level = LEVELS[index];
  game = new Game(level);
  activeSkill = null;
  select(null);
  showPreview([]);
  clearHint();
  drag = null;
  for (const v of views.values()) board.remove(v);
  views.clear();
  for (const entry of cellViews.values()) for (const obj of Object.values(entry)) if (obj) board.remove(obj);
  cellViews.clear();
  if (boardBase) {
    board.remove(boardBase);
    boardBase.traverse(o => o.geometry?.dispose());
  }
  boardBase = buildBoard(game);
  board.add(boardBase);
  if (world.groundY !== boardBase.userData.groundY) {
    world.groundY = boardBase.userData.groundY;
    world.decorate(world.groundY);
  }
  syncDisplay();
  ui.setLevel(level, game.goals);
  fitCamera();
  busy = true;
  refreshHUD();
  ui.status(level.tip);

  for (const cell of game.cells) {
    if (cell.ice) setObstacle(cell.i, 'ice', cell.ice);
    if (cell.crate) setObstacle(cell.i, 'crate', cell.crate);
    if (cell.vine) setObstacle(cell.i, 'vine', 1);
  }
  const drops = [];
  for (const cell of game.cells) {
    if (!cell.piece) continue;
    const v = makeView(cell.piece);
    const to = posOf(cell.r, cell.c);
    const from = to.clone().setY(to.y + 9);
    v.position.copy(from);
    const delay = (game.rows - cell.r) * 0.045 + cell.c * 0.02;
    drops.push(wait(delay).then(() => animate(0.55, k => v.position.lerpVectors(from, to, k), easeOutBounce)));
  }
  if (banner) ui.banner(level, game.goals);
  await Promise.all(drops);
  if (token !== levelToken) return;
  sfx.land();
  busy = false;
  lastAction = clockTime;
  refreshHUD();
}
function easeOutBounce(t) {
  const n1 = 7.5625, d1 = 2.75;
  if (t < 1 / d1) return n1 * t * t;
  if (t < 2 / d1) return n1 * (t -= 1.5 / d1) * t + 0.75;
  if (t < 2.5 / d1) return n1 * (t -= 2.25 / d1) * t + 0.9375;
  return n1 * (t -= 2.625 / d1) * t + 0.984375;
}

async function afterTurn() {
  syncDisplay();
  refreshHUD();
  if (game.status === 'won') await celebrate();
  else if (game.status === 'lost') { await wait(0.5); showLose(); }
  else {
    busy = false;
    lastAction = clockTime;
    refreshHUD();
  }
}

async function celebrate() {
  ui.praise('目标达成！');
  sfx.create();
  // 满屏彩纸
  for (let k = 0; k < 14; k++) {
    wait(k * 0.06).then(() => {
      const p = new THREE.Vector3((Math.random() - 0.5) * game.cols, (Math.random() - 0.3) * game.rows * 0.8, PIECE_Z);
      fx.burst(p, ANIMALS[k % ANIMALS.length].color, { count: 10, speed: 4.5, solid: 12 });
    });
  }
  await wait(1.1);
  if (game.moves > 0) {
    ui.praise('森林狂欢！', true);
    ui.status('剩余步数变成疾风动物，全部引爆拿奖励分！');
    await wait(0.7);
  }
  await playSteps(game.finale());
  syncDisplay();
  refreshHUD();
  await wait(0.5);
  await showWin();
}

async function showWin() {
  const level = LEVELS[levelIndex];
  const stars = starsFor(level, game.score);
  progress.stars[levelIndex] = Math.max(progress.stars[levelIndex], stars);
  progress.best[levelIndex] = Math.max(progress.best[levelIndex], game.score);
  progress.unlocked = Math.min(LEVELS.length, Math.max(progress.unlocked, level.id + 1));
  const saved = saveProgress();
  const hasNext = levelIndex < LEVELS.length - 1;
  const starEls = ui.showResult({
    won: true, stars, score: game.score, best: progress.best[levelIndex], hasNext,
    detail: `${stars === 3 ? '完美！三星通关！' : stars === 2 ? `再拿 ${level.stars[1] - game.score} 分就是三星啦。` : `达到 ${level.stars[0]} 分可以拿到二星。`}${saved ? '' : '（浏览器无法保存进度）'}`,
  });
  sfx.win();
  busy = false;
  refreshHUD();
  for (let k = 0; k < stars; k++) {
    await wait(0.38);
    starEls[k].classList.add('lit');
    sfx.star(k);
  }
}

function showLose() {
  const missing = game.goals.filter(g => g.current < g.target).map(g => `${goalLabel(g)}还差 ${g.target - g.current}`);
  ui.showResult({ won: false, stars: 0, score: game.score, best: progress.best[levelIndex], hasNext: false, detail: `${missing.join('，')}。用好特效和道具，再来一次吧！` });
  sfx.lose();
  busy = false;
  refreshHUD();
}

// ---------- 播放引擎步骤 ----------
async function playSteps(steps, { countMove = false } = {}) {
  let first = true;
  for (const step of steps) {
    if (step.type === 'swap') await playSwap(step, countMove && first && !step.back);
    else if (step.type === 'clear') await playClear(step);
    else if (step.type === 'fall') await playFall(step);
    else if (step.type === 'collect') await playCollect(step);
    else if (step.type === 'shuffle') await playShuffle(step);
    else if (step.type === 'convert') await playConvert(step);
    first = false;
  }
}

async function playSwap(step, consume) {
  const [va, vb] = step.ids.map(id => views.get(id));
  const pa = posOf(...step.a), pb = posOf(...step.b);
  if (consume) { display.moves--; refreshHUD(); }
  if (!step.back) sfx.swap();
  await animate(0.17, k => {
    va.position.lerpVectors(pa, pb, k);
    vb.position.lerpVectors(pb, pa, k);
    va.position.z = PIECE_Z + Math.sin(k * Math.PI) * 0.35;
    vb.position.z = PIECE_Z - Math.sin(k * Math.PI) * 0.12;
  }, easeInOut);
  if (step.back) sfx.invalid();
}

const PRAISE = ['', '', '不错！', '真棒！', '太厉害了！', '无与伦比！', '森林之王！'];
async function playClear(step) {
  const jobs = [wait(step.duration)];
  const at = (delay, fn) => jobs.push(wait(delay).then(fn));
  const comboEffect = step.effects.find(e => e.kind === 'board') ? '彩虹风暴！' : step.converts.length ? '魔法连锁！' : null;
  if (comboEffect) ui.praise(comboEffect, true);
  else if (step.combo >= 2) ui.praise(PRAISE[Math.min(step.combo, PRAISE.length - 1)]);
  for (const e of step.effects) at(e.delay, () => playEffect(e));
  for (const h of step.hits) at(h.delay, () => popView(h));
  for (const c of step.created) at(c.delay, () => createdView(c));
  for (const c of step.converts) at(c.delay, () => {
    const v = views.get(c.id);
    if (!v) return;
    setSpecial(v, c.special);
    fx.twinkle(v.position, '#ffe27a', 4);
    sfx.convert(step.converts.indexOf(c));
  });
  for (const o of step.obstacles) at(o.delay, () => obstacleHit(o));
  let shown = 0;
  const colorAt = new Map();
  for (const h of step.hits) { const v = views.get(h.id); if (v && !colorAt.has(h.i)) colorAt.set(h.i, colorOf(v)); }
  for (const p of step.popups) at(p.delay + 0.15, () => {
    const s = toScreen(posOfI(p.i).setZ(PIECE_Z + 0.5));
    ui.popup(s.x, s.y, `+${p.amount}`, colorAt.get(p.i) ?? '#ffb31f');
    display.score += p.amount;
    shown += p.amount;
    refreshHUD();
  });
  await Promise.all(jobs);
  display.score += step.score - shown;
  refreshHUD();
}

function playEffect(e) {
  const p = posOfI(e.i);
  if (e.kind === 'row' || e.kind === 'col') {
    fx.beam(p, e.kind, 0xffc93c, (e.kind === 'row' ? game.cols : game.rows) * CELL + 0.6);
    sfx.line();
    shake = Math.max(shake, 0.08);
  } else if (e.kind === 'bomb') {
    fx.ring(p, 0xffa53d, 1.1 + e.radius * 1.2);
    fx.ring(p, 0xffffff, 0.7 + e.radius * 0.8, 0.35);
    fx.burst(p, '#ffc04d', { count: 22, speed: 5, solid: 10 });
    sfx.bomb();
    shake = Math.max(shake, 0.16 + e.radius * 0.1);
  } else if (e.kind === 'rainbow') {
    sfx.rainbow();
    const color = ANIMALS[e.type]?.color ?? '#ffffff';
    fx.twinkle(p, '#ffffff', 12, 0.9);
    e.targets.forEach((t, k) => wait(0.05 + k * 0.025).then(() => fx.arc(p, posOfI(t), color)));
  } else if (e.kind === 'board') {
    fx.flash(0xffffff, 0.9, 40);
    sfx.rainbow();
    sfx.bomb();
    shake = 0.5;
  } else if (e.kind === 'hammer') {
    fx.hammer(p, () => { sfx.hammer(); fx.ring(p, 0xffffff, 1.3, 0.3); shake = Math.max(shake, 0.18); });
  }
}

function popView(h) {
  const v = views.get(h.id);
  if (!v) return;
  views.delete(h.id);
  if (v.userData.kind === 'animal') bumpGoal('collect', v.userData.type, 1);
  if (h.into !== null && h.into !== h.i) {
    const from = v.position.clone(), to = posOfI(h.into);
    animate(0.2, k => { v.position.lerpVectors(from, to, k); v.scale.setScalar(1 - k * 0.7); }, easeInCubic).then(() => board.remove(v));
    return;
  }
  fx.burst(v.position, colorOf(v));
  if (v.userData.eyes) v.userData.eyes.scale.y = 0.3;
  animate(0.24, k => {
    const s = k < 0.3 ? 1 + (k / 0.3) * 0.28 : 1.28 * (1 - (k - 0.3) / 0.7);
    v.scale.setScalar(Math.max(0.001, s));
    v.rotation.z = k * 0.7;
  }).then(() => board.remove(v));
}

function createdView(c) {
  const v = makeView(c.piece);
  v.position.copy(posOfI(c.i));
  v.scale.setScalar(0.001);
  animate(0.35, k => v.scale.setScalar(Math.max(0.001, k)), easeOutBack);
  fx.twinkle(v.position, colorOf(v), 8, 0.8);
  sfx.create();
}

function obstacleHit(o) {
  const p = posOfI(o.i).setZ(0.25);
  bumpGoal(o.kind, null, o.layers);
  setObstacle(o.i, o.kind, o.left);
  if (o.kind === 'ice') { fx.debris(p, 0xbde8ff, 10, 0.2); sfx.ice(); }
  else if (o.kind === 'crate') {
    fx.debris(p, 0xb7773d, o.left ? 8 : 16, 0.26);
    if (o.left === 1) fx.debris(p, 0x9aa3b0, 6, 0.18);
    sfx.crate();
    shake = Math.max(shake, 0.06);
  } else { fx.debris(p, 0x66c23e, 12, 0.2); sfx.vine(); }
}

async function playFall(step) {
  const items = step.moves.map(m => {
    let v = views.get(m.id);
    if (!v) { v = makeView(m.spawn); v.scale.setScalar(0.001); }
    const pts = m.path.map(pt => posOf(pt.r, pt.c));
    v.position.copy(pts[0]);
    return { v, path: m.path, pts, spawn: !!m.spawn, end: m.path[m.path.length - 1].t };
  });
  const total = step.ticks * TICK + 0.16;
  await animate(total, (_, raw) => {
    const time = raw * total, tt = time / TICK;
    for (const it of items) {
      const { v, path, pts } = it;
      if (tt >= it.end) {
        v.position.copy(pts[pts.length - 1]);
        const s = Math.min(1, (time - it.end * TICK) / 0.16);
        const w = Math.sin(s * Math.PI) * (1 - s);
        v.scale.set(1 + 0.12 * w, 1 - 0.16 * w, 1);
        continue;
      }
      if (tt <= path[0].t) v.position.copy(pts[0]);
      else {
        let k = 0;
        while (k < path.length - 2 && path[k + 1].t <= tt) k++;
        const f = (tt - path[k].t) / (path[k + 1].t - path[k].t);
        v.position.lerpVectors(pts[k], pts[k + 1], Math.min(1, f));
      }
      if (it.spawn) v.scale.setScalar(Math.max(0.001, Math.min(1, tt - path[0].t)));
    }
  });
  sfx.land();
}

async function playCollect(step) {
  sfx.acorn();
  await Promise.all(step.items.map(item => {
    const v = views.get(item.id);
    if (!v) return null;
    views.delete(item.id);
    bumpGoal('acorn', null, 1);
    fx.twinkle(v.position, '#ffd36b', 10, 0.8);
    const from = v.position.clone();
    return animate(0.5, k => {
      v.position.set(from.x, from.y - k * 0.9, from.z + Math.sin(k * Math.PI) * 0.6);
      v.scale.setScalar(Math.max(0.001, 1 - k * 0.8));
      v.rotation.z = k * 4;
    }, easeInCubic).then(() => board.remove(v));
  }));
  display.score += step.score;
  const s = toScreen(posOfI(step.items[0].i));
  ui.popup(s.x, s.y, `+${step.score}`, '#ffd36b');
  refreshHUD();
}

async function playShuffle(step) {
  sfx.shuffle();
  ui.status('棋盘重新洗牌啦！');
  const items = step.moves.map(m => {
    let v = views.get(m.id);
    if (v && (v.userData.type !== m.piece.type || v.userData.special !== m.piece.special)) {
      const old = v.position.clone();
      dropView(v);
      v = makeView(m.piece);
      v.position.copy(old);
    }
    return { v, from: v.position.clone(), to: posOf(m.r, m.c) };
  });
  const center = new THREE.Vector3(0, 0, PIECE_Z);
  const tmp = new THREE.Vector3();
  await animate(0.8, k => {
    const e = easeInOut(k), swirl = Math.sin(k * Math.PI);
    for (const { v, from, to } of items) {
      tmp.lerpVectors(from, to, e).sub(center).multiplyScalar(1 - 0.55 * swirl);
      const a = swirl * 1.4;
      v.position.set(tmp.x * Math.cos(a) - tmp.y * Math.sin(a), tmp.x * Math.sin(a) + tmp.y * Math.cos(a), PIECE_Z + swirl * 0.6);
      v.rotation.z = k * Math.PI * 2;
    }
  });
  for (const { v, to } of items) { v.position.copy(to); v.rotation.z = 0; }
}

async function playConvert(step) {
  const jobs = step.items.map((item, k) => wait(item.delay).then(() => {
    const v = views.get(item.id);
    if (v) { setSpecial(v, item.special); fx.twinkle(v.position, '#ffe27a', 6, 0.6); }
    display.moves = Math.max(0, display.moves - 1);
    refreshHUD();
    sfx.convert(k);
  }));
  await Promise.all(jobs);
  display.score += step.score;
  refreshHUD();
  await wait(0.5);
}

// ---------- 玩家输入 ----------
const raycaster = new THREE.Raycaster();
const ndc = new THREE.Vector2();
const piecePlane = new THREE.Plane(new THREE.Vector3(0, 0, 1), -PIECE_Z);
function pointerWorld(e) {
  ndc.set((e.clientX / innerWidth) * 2 - 1, -(e.clientY / innerHeight) * 2 + 1);
  raycaster.setFromCamera(ndc, camera);
  return raycaster.ray.intersectPlane(piecePlane, new THREE.Vector3());
}
function cellAt(p) {
  if (!p || !game) return null;
  const c = Math.round(p.x / CELL + (game.cols - 1) / 2), r = Math.round((game.rows - 1) / 2 - p.y / CELL);
  const cell = game.cell(r, c);
  return cell && !cell.void ? cell : null;
}
const overlayOpen = () => ui.mapOpen() || ui.resultOpen();
const canAct = () => game && !busy && game.status === 'playing' && !overlayOpen();

function select(cell) {
  selected = cell;
  selFrame.visible = !!cell;
  if (cell) {
    const p = posOf(cell.r, cell.c);
    selFrame.position.set(p.x, p.y, 0.01);
    sfx.select();
  }
}
function showPreview(cells) {
  while (previewFrames.length < cells.length) {
    const m = new THREE.Mesh(selFrame.geometry, previewMat);
    board.add(m);
    previewFrames.push(m);
  }
  previewFrames.forEach((m, k) => {
    m.visible = k < cells.length;
    if (m.visible) { const p = posOf(cells[k].r, cells[k].c); m.position.set(p.x, p.y, 0.012); }
  });
}
function skillArea(kind, cell) {
  if (!cell) return [];
  if (kind === 'hammer') return [cell];
  if (kind === 'bomb') return game.areaCells(cell, 1).map(({ i }) => game.cells[i]).filter(c => !c.void);
  if (kind === 'rainbow') { const t = game.typeAt(cell); return t < 0 ? [] : game.cells.filter(c => game.typeAt(c) === t); }
  return [];
}
function nudge(cell) {
  const v = cell.piece && views.get(cell.piece.id);
  ui.status(cell.crate ? '木箱不能移动，在旁边消除就能敲开它。' : cell.vine ? '藤蔓缠住了它！让它参与一次消除就能解开。' : '这里不能移动。');
  sfx.invalid();
  if (v) {
    const x = v.position.x;
    animate(0.3, k => { v.position.x = x + Math.sin(k * Math.PI * 6) * 0.06 * (1 - k); });
  }
}

async function doSwap(a, b) {
  if (!canAct()) return;
  const target = game.cell(...b);
  if (!target || target.void) return;
  const res = game.trySwap(a, b);
  if (res.reason === 'locked') { nudge(game.swappable(game.cell(...a)) ? target : game.cell(...a)); return; }
  if (res.reason === 'far') return;
  busy = true;
  refreshHUD();
  await playSteps(res.steps, { countMove: res.valid });
  if (!res.valid) {
    ui.status('这样交换连不成三个哦，换个位置试试。');
    busy = false;
    refreshHUD();
    return;
  }
  ui.status('');
  await afterTurn();
}

async function castSkill(kind, cell) {
  const res = game.useSkill(kind, cell?.r ?? 0, cell?.c ?? 0);
  if (!res.ok) { ui.status(kind === 'rainbow' ? '彩虹魔法要点在动物身上哦。' : '这里不能使用道具。'); return; }
  activeSkill = null;
  showPreview([]);
  busy = true;
  display.energy = game.energy;
  refreshHUD();
  ui.status(`${SKILLS[kind].name}！道具不消耗步数。`);
  await playSteps(res.steps);
  await afterTurn();
}

canvas.addEventListener('pointerdown', e => {
  unlock();
  const p = pointerWorld(e);
  if (p) { lookTarget.copy(p); lookUntil = clockTime + 3; }
  if (!canAct()) return;
  lastAction = clockTime;
  clearHint();
  const cell = cellAt(p);
  if (!cell) { select(null); return; }
  if (activeSkill) { castSkill(activeSkill, cell); return; }
  if (!game.swappable(cell)) { select(null); nudge(cell); return; }
  if (selected && selected !== cell && Math.abs(selected.r - cell.r) + Math.abs(selected.c - cell.c) === 1) {
    const from = selected;
    select(null);
    doSwap([from.r, from.c], [cell.r, cell.c]);
    return;
  }
  if (selected === cell) { select(null); return; }
  select(cell);
  drag = { cell, x: e.clientX, y: e.clientY, id: e.pointerId };
  canvas.setPointerCapture?.(e.pointerId);
});
canvas.addEventListener('pointermove', e => {
  const p = pointerWorld(e);
  if (p) { lookTarget.copy(p); lookUntil = clockTime + 3; }
  if (activeSkill && canAct()) showPreview(skillArea(activeSkill, cellAt(p)));
  canvas.style.cursor = canAct() && cellAt(p) ? 'pointer' : 'default';
  if (!drag || e.pointerId !== drag.id || !canAct()) return;
  const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
  const a = toScreen(posOf(0, 0)), b = toScreen(posOf(0, 1));
  const threshold = Math.max(10, (b.x - a.x) * 0.3);
  if (Math.max(Math.abs(dx), Math.abs(dy)) < threshold) return;
  const [dr, dc] = Math.abs(dx) > Math.abs(dy) ? [0, Math.sign(dx)] : [Math.sign(dy), 0];
  const from = drag.cell;
  drag = null;
  select(null);
  doSwap([from.r, from.c], [from.r + dr, from.c + dc]);
});
const endDrag = () => { drag = null; };
canvas.addEventListener('pointerup', endDrag);
canvas.addEventListener('pointercancel', endDrag);
addEventListener('keydown', e => {
  if (e.key !== 'Escape') return;
  if (ui.mapOpen() && game?.status === 'playing') { ui.hideMap(); return; }
  activeSkill = null;
  select(null);
  showPreview([]);
  refreshHUD();
  ui.status('已取消选择。');
});

// ---------- 提示 ----------
function clearHint() { hint = null; }
function updateHint() {
  if (hint || !canAct() || activeSkill || clockTime - lastAction < HINT_DELAY) return;
  const h = game.hint();
  if (!h) return;
  const ca = game.cell(...h.a), cb = game.cell(...h.b);
  hint = { ids: [ca.piece.id, cb.piece.id], dir: [h.b[1] - h.a[1], h.a[0] - h.b[0]], start: clockTime };
}

// ---------- 每帧更新 ----------
const clock = new THREE.Clock();
function frame() {
  requestAnimationFrame(frame);
  const dt = Math.min(clock.getDelta(), 0.05) * timeScale;
  clockTime += dt;
  const t = clockTime;
  tickAnims(dt);
  fx.update(dt);
  world.update(t, dt);
  updateHint();
  const looking = t < lookUntil;
  const selId = selected?.piece?.id;
  for (const v of views.values()) {
    const u = v.userData;
    if (!u.body) continue;
    if (u.eyes) {
      const bt = t - u.blink;
      if (bt > 0) {
        u.eyes.scale.y = bt < 0.14 ? Math.max(0.12, Math.abs(1 - bt / 0.07)) : 1;
        if (bt >= 0.14) u.blink = t + 2 + Math.random() * 5;
      }
    }
    let ry, rx;
    if (looking) {
      ry = THREE.MathUtils.clamp((lookTarget.x - v.position.x) * 0.12, -0.5, 0.5);
      rx = THREE.MathUtils.clamp(-(lookTarget.y - v.position.y) * 0.12, -0.4, 0.4);
    } else {
      ry = Math.sin(t * 0.7 + u.phase) * 0.2;
      rx = Math.sin(t * 0.9 + u.phase) * 0.06;
    }
    const ease = Math.min(1, dt * 6);
    u.body.rotation.y += (ry - u.body.rotation.y) * ease;
    u.body.rotation.x += (rx - u.body.rotation.x) * ease;
    let ox = 0, oy = Math.sin(t * 2.2 + u.phase) * 0.012;
    if (u.id === selId) oy += Math.abs(Math.sin(t * 7)) * 0.1;
    if (hint && hint.ids.includes(u.id)) {
      const w = (t - hint.start) % 1.8;
      if (w < 0.7) {
        const s = Math.sin((w / 0.7) * Math.PI * 4) * 0.08 * (u.id === hint.ids[0] ? 1 : -1);
        ox = hint.dir[0] * s; oy += hint.dir[1] * s;
      }
    }
    u.body.position.set(ox, oy, 0);
    if (u.gem) { u.gem.rotation.y += dt * 1.2; u.gem.rotation.x += dt * 0.5; }
    if (u.orbit) u.orbit.rotation.z += dt * 1.6;
    if (u.deco) {
      for (const child of u.deco.children) {
        if (child.name === 'arrow') child.position.x = child.userData.dir * (0.44 + Math.sin(t * 6) * 0.035);
        else if (child.name === 'spin') child.rotation.z += dt * 1.4;
        else if (child.name === 'halo') child.scale.setScalar(1.3 + Math.sin(t * 5) * 0.1);
      }
    }
  }
  if (selFrame.visible) selFrame.material.opacity = 0.75 + Math.sin(t * 6) * 0.25;
  previewMat.opacity = 0.7 + Math.sin(t * 6) * 0.3;
  for (const arrow of boardBase?.userData.exits ?? []) arrow.position.y = arrow.userData.baseY + Math.sin(t * 4) * 0.06;
  shake *= Math.exp(-dt * 7);
  camera.position.set(camBase.x + (Math.random() - 0.5) * shake, camBase.y + (Math.random() - 0.5) * shake + camBase.z * 0.05, camBase.z);
  camera.lookAt(camBase.x, camBase.y, 0);
  renderer.render(scene, camera);
}

// ---------- 启动 ----------
const firstLevel = Math.min(progress.unlocked, LEVELS.length) - 1;
startLevel(firstLevel, { banner: false });
ui.showMap(progress, null, false);
frame();

// 自动化测试钩子
window.__match3 = {
  get game() { return game; },
  get busy() { return busy; },
  get levelIndex() { return levelIndex; },
  get display() { return display; },
  get progress() { return progress; },
  start: (i, banner = false) => startLevel(i, { banner }),
  setSpeed: s => { timeScale = s; },
  screenOf: (r, c) => toScreen(posOf(r, c)),
  viewCount: () => views.size,
  // 直接修改引擎状态后，按当前棋盘重建全部模型
  rebuildViews: () => {
    for (const v of views.values()) board.remove(v);
    views.clear();
    for (const cell of game.cells) {
      if (cell.piece) makeView(cell.piece).position.copy(posOf(cell.r, cell.c));
      setObstacle(cell.i, 'ice', cell.ice);
      setObstacle(cell.i, 'crate', cell.crate);
      setObstacle(cell.i, 'vine', cell.vine ? 1 : 0);
    }
    syncDisplay();
    refreshHUD();
  },
  renderInfo: () => ({ ...renderer.info.render, geometries: renderer.info.memory.geometries, textures: renderer.info.memory.textures }),
  profile: () => { const t0 = performance.now(); renderer.render(scene, camera); const t1 = performance.now(); return t1 - t0; },
  // 每个棋子都有模型，且模型停在对应格子上
  consistent: () => game.cells.every(cell => {
    if (!cell.piece) return true;
    const v = views.get(cell.piece.id);
    return v && v.position.distanceTo(posOf(cell.r, cell.c)) < 0.02;
  }) && views.size === game.cells.filter(c => c.piece).length,
};
