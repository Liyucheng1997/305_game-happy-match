import * as THREE from 'three';
import { LEVELS, SKILLS, skillCells, objectivesMet, starsFor, readProgress, outcomeFor } from './rules.js';
import { unlock, sfx, setMuted, isMuted } from './audio.js';

// ---------- 配置 ----------
const ROWS = 8;
const COLS = 8;

const CELL = 1.15;          // 格子间距


const GEM_DEFS = [
  { name: '猫', color: 0xffa23c },
  { name: '狗', color: 0xb37a4c },
  { name: '猪', color: 0xffa6c9 },
  { name: '熊', color: 0x7a4b2a },
  { name: '蛙', color: 0x5dd35d },
  { name: '兔', color: 0xf4f4f8 },
];

// ---------- 场景 ----------
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x0f0c29);
scene.fog = new THREE.Fog(0x0f0c29, 14, 26);

const camera = new THREE.PerspectiveCamera(45, innerWidth / innerHeight, 0.1, 100);
camera.position.set(0, 2.5, 13.5);
camera.lookAt(0, 0, 0);

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setSize(innerWidth, innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
document.body.appendChild(renderer.domElement);

scene.add(new THREE.AmbientLight(0xffffff, 0.5));
const key = new THREE.DirectionalLight(0xffffff, 2.2);
key.position.set(5, 8, 8);
key.castShadow = true;
key.shadow.mapSize.set(2048, 2048);
key.shadow.camera.left = -8; key.shadow.camera.right = 8;
key.shadow.camera.top = 8; key.shadow.camera.bottom = -8;
scene.add(key);
const rim = new THREE.PointLight(0x8a6bff, 30, 30);
rim.position.set(-6, -3, 5);
scene.add(rim);

// 棋盘背板
const boardW = COLS * CELL + 0.6;
const boardH = ROWS * CELL + 0.6;
const board = new THREE.Mesh(
  new THREE.BoxGeometry(boardW, boardH, 0.4),
  new THREE.MeshStandardMaterial({ color: 0x1d1a4a, roughness: 0.8, metalness: 0.1 })
);
board.position.z = -0.5;
board.receiveShadow = true;
scene.add(board);

// 格子底纹
const cellGeo = new THREE.PlaneGeometry(CELL * 0.92, CELL * 0.92);
const cellMat = new THREE.MeshStandardMaterial({ color: 0x2a2666, roughness: 0.9 });
for (let r = 0; r < ROWS; r++) {
  for (let c = 0; c < COLS; c++) {
    const m = new THREE.Mesh(cellGeo, cellMat);
    m.position.set(colX(c), rowY(r), -0.29);
    m.receiveShadow = true;
    scene.add(m);
  }
}

// 选中框
const selector = new THREE.Mesh(
  new THREE.RingGeometry(0.56, 0.64, 48),
  new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.9, side: THREE.DoubleSide })
);
selector.visible = false;
selector.position.z = 0.55;
scene.add(selector);

// ---------- 工具 ----------
function colX(c) { return (c - (COLS - 1) / 2) * CELL; }
function rowY(r) { return ((ROWS - 1) / 2 - r) * CELL; } // r=0 在最上面

// ---------- 动物头建模 ----------
const mat = (color, opts = {}) => new THREE.MeshStandardMaterial({ color, roughness: 0.6, metalness: 0.05, ...opts });
const M = {
  black: mat(0x222222, { roughness: 0.3 }),
  white: mat(0xffffff),
  pink: mat(0xff7fa8),
  darkPink: mat(0xe0558a),
  cream: mat(0xf7e2c4),
  eyeShine: new THREE.MeshBasicMaterial({ color: 0xffffff }),
};
const G = {
  sphere: new THREE.SphereGeometry(1, 32, 24),
  cone: new THREE.ConeGeometry(1, 1, 24),
  cyl: new THREE.CylinderGeometry(1, 1, 1, 24),
  box: new THREE.BoxGeometry(1, 1, 1),
};
function part(geo, material, x, y, z, sx = 1, sy = sx, sz = sx, rx = 0, ry = 0, rz = 0) {
  const m = new THREE.Mesh(geo, material);
  m.position.set(x, y, z);
  m.scale.set(sx, sy, sz);
  m.rotation.set(rx, ry, rz);
  m.castShadow = true;
  return m;
}
// 眼睛：黑眼珠 + 高光
function eyes(group, x, y, z, r = 0.07) {
  for (const sx of [-1, 1]) {
    group.add(part(G.sphere, M.black, sx * x, y, z, r));
    group.add(part(G.sphere, M.eyeShine, sx * x + r * 0.35, y + r * 0.35, z + r * 0.8, r * 0.3));
  }
}
const HEAD_R = 0.4;
const builders = [
  // 猫：尖耳、粉鼻、胡须
  (color) => {
    const g = new THREE.Group(), fur = mat(color);
    g.add(part(G.sphere, fur, 0, 0, 0, HEAD_R, HEAD_R * 0.92, HEAD_R * 0.85));
    for (const sx of [-1, 1]) {
      g.add(part(G.cone, fur, sx * 0.26, 0.36, 0, 0.14, 0.26, 0.1, 0, 0, -sx * 0.35));
      g.add(part(G.cone, M.pink, sx * 0.26, 0.34, 0.05, 0.07, 0.14, 0.05, 0, 0, -sx * 0.35));
    }
    eyes(g, 0.15, 0.06, 0.33);
    g.add(part(G.sphere, M.pink, 0, -0.07, 0.37, 0.05, 0.04, 0.04));
    for (const sx of [-1, 1]) for (const dy of [-0.03, 0.03])
      g.add(part(G.box, M.white, sx * 0.3, -0.1 + dy, 0.3, 0.28, 0.012, 0.012, 0, 0, dy * 4 * sx));
    return g;
  },
  // 狗：垂耳、浅色口鼻、黑鼻子
  (color) => {
    const g = new THREE.Group(), fur = mat(color);
    g.add(part(G.sphere, fur, 0, 0, 0, HEAD_R, HEAD_R * 0.95, HEAD_R * 0.85));
    for (const sx of [-1, 1])
      g.add(part(G.sphere, mat(0x6b4326), sx * 0.38, 0.05, -0.02, 0.11, 0.26, 0.09));
    g.add(part(G.sphere, M.cream, 0, -0.14, 0.3, 0.19, 0.15, 0.16));
    g.add(part(G.sphere, M.black, 0, -0.08, 0.44, 0.07, 0.055, 0.06));
    eyes(g, 0.15, 0.1, 0.32);
    g.add(part(G.sphere, M.pink, 0, -0.26, 0.34, 0.06, 0.035, 0.04));
    return g;
  },
  // 猪：大鼻子、小耳朵
  (color) => {
    const g = new THREE.Group(), skin = mat(color);
    g.add(part(G.sphere, skin, 0, 0, 0, HEAD_R, HEAD_R * 0.9, HEAD_R * 0.85));
    g.add(part(G.cyl, M.darkPink, 0, -0.06, 0.36, 0.15, 0.1, 0.15, Math.PI / 2));
    for (const sx of [-1, 1]) g.add(part(G.sphere, mat(0x9c2c5c), sx * 0.06, -0.06, 0.42, 0.03, 0.04, 0.02));
    for (const sx of [-1, 1])
      g.add(part(G.cone, skin, sx * 0.27, 0.33, 0, 0.12, 0.18, 0.08, -0.3, 0, -sx * 0.6));
    eyes(g, 0.16, 0.12, 0.32, 0.06);
    return g;
  },
  // 熊：圆耳、浅色口鼻
  (color) => {
    const g = new THREE.Group(), fur = mat(color);
    g.add(part(G.sphere, fur, 0, 0, 0, HEAD_R, HEAD_R * 0.95, HEAD_R * 0.9));
    for (const sx of [-1, 1]) {
      g.add(part(G.sphere, fur, sx * 0.3, 0.3, -0.05, 0.13));
      g.add(part(G.sphere, M.cream, sx * 0.3, 0.3, 0.03, 0.07));
    }
    g.add(part(G.sphere, M.cream, 0, -0.12, 0.32, 0.17, 0.13, 0.14));
    g.add(part(G.sphere, M.black, 0, -0.07, 0.44, 0.07, 0.05, 0.05));
    eyes(g, 0.14, 0.1, 0.34, 0.06);
    return g;
  },
  // 青蛙：扁头、顶部大眼、腮红
  (color) => {
    const g = new THREE.Group(), skin = mat(color);
    g.add(part(G.sphere, skin, 0, -0.05, 0, HEAD_R * 1.05, HEAD_R * 0.75, HEAD_R * 0.85));
    for (const sx of [-1, 1]) {
      g.add(part(G.sphere, skin, sx * 0.22, 0.22, 0.12, 0.15));
      g.add(part(G.sphere, M.white, sx * 0.22, 0.22, 0.2, 0.1));
      g.add(part(G.sphere, M.black, sx * 0.22, 0.22, 0.27, 0.05));
      g.add(part(G.sphere, M.pink, sx * 0.25, -0.1, 0.3, 0.07, 0.04, 0.03));
    }
    g.add(part(G.box, mat(0x2e7d32), 0, -0.16, 0.36, 0.3, 0.02, 0.02));
    return g;
  },
  // 兔子：长耳、粉鼻、门牙
  (color) => {
    const g = new THREE.Group(), fur = mat(color);
    g.add(part(G.sphere, fur, 0, -0.05, 0, HEAD_R * 0.9, HEAD_R * 0.85, HEAD_R * 0.8));
    for (const sx of [-1, 1]) {
      g.add(part(G.sphere, fur, sx * 0.14, 0.48, -0.02, 0.09, 0.3, 0.07, 0, 0, -sx * 0.15));
      g.add(part(G.sphere, M.pink, sx * 0.14, 0.48, 0.03, 0.05, 0.22, 0.04, 0, 0, -sx * 0.15));
    }
    eyes(g, 0.14, 0.03, 0.3, 0.06);
    g.add(part(G.sphere, M.pink, 0, -0.1, 0.32, 0.045, 0.035, 0.035));
    g.add(part(G.box, M.white, 0, -0.2, 0.3, 0.08, 0.07, 0.03));
    g.add(part(G.box, M.black, 0, -0.2, 0.318, 0.006, 0.07, 0.01));
    return g;
  },
];
const prototypes = GEM_DEFS.map((d, i) => builders[i](d.color));


// ---------- 补间动画 ----------
const tweens = [];
function tween(obj, to, duration, { ease = easeOutCubic, onDone } = {}) {
  const from = {};
  for (const k in to) from[k] = obj[k];
  return new Promise(resolve => {
    tweens.push({ obj, from, to, duration, t: 0, ease, done: () => { onDone && onDone(); resolve(); } });
  });
}
function easeOutCubic(t) { return 1 - Math.pow(1 - t, 3); }
function easeOutBack(t) { const c1 = 1.70158, c3 = c1 + 1; return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2); }
function easeOutBounce(t) {
  const n1 = 7.5625, d1 = 2.75;
  if (t < 1 / d1) return n1 * t * t;
  if (t < 2 / d1) return n1 * (t -= 1.5 / d1) * t + 0.75;
  if (t < 2.5 / d1) return n1 * (t -= 2.25 / d1) * t + 0.9375;
  return n1 * (t -= 2.625 / d1) * t + 0.984375;
}
function updateTweens(dt) {
  for (let i = tweens.length - 1; i >= 0; i--) {
    const tw = tweens[i];
    tw.t = Math.min(1, tw.t + dt / tw.duration);
    const k = tw.ease(tw.t);
    for (const key in tw.to) tw.obj[key] = tw.from[key] + (tw.to[key] - tw.from[key]) * k;
    if (tw.t >= 1) { tweens.splice(i, 1); tw.done(); }
  }
}
const sleep = ms => new Promise(r => setTimeout(r, ms));

// ---------- 粒子特效 ----------
const particles = [];
const particleGeo = new THREE.SphereGeometry(0.07, 8, 8);
function burst(x, y, color) {
  const mat = new THREE.MeshBasicMaterial({ color });
  for (let i = 0; i < 12; i++) {
    const p = new THREE.Mesh(particleGeo, mat);
    p.position.set(x, y, 0.3);
    const a = Math.random() * Math.PI * 2, s = 2 + Math.random() * 3;
    p.userData.v = new THREE.Vector3(Math.cos(a) * s, Math.sin(a) * s, 1 + Math.random() * 2);
    p.userData.life = 0.6;
    scene.add(p);
    particles.push(p);
  }
}
function updateParticles(dt) {
  for (let i = particles.length - 1; i >= 0; i--) {
    const p = particles[i];
    p.userData.life -= dt;
    p.userData.v.y -= 9 * dt;
    p.position.addScaledVector(p.userData.v, dt);
    p.scale.setScalar(Math.max(0.001, p.userData.life / 0.6));
    if (p.userData.life <= 0) { scene.remove(p); particles.splice(i, 1); }
  }
}

// ---------- 游戏状态 ----------
const grid = [];           // grid[r][c] = gem mesh | null
let progress;
try { progress = readProgress(localStorage.getItem('happy-match3-progress')); }
catch { progress = readProgress(null); }
let levelIndex = progress.unlocked - 1;
let level = LEVELS[levelIndex];
let score = 0, moves = level.moves, busy = false, selected = null, gameOver = false;
let energy = 0, collected = 0, activeSkill = null, won = false;
let ice = Array(ROWS * COLS).fill(0);
const iceGroup = new THREE.Group();
scene.add(iceGroup);
const iceGeometry = new THREE.PlaneGeometry(CELL * 0.92, CELL * 0.92);
const iceMaterials = [null,
  new THREE.MeshBasicMaterial({ color: 0x8be7ff, transparent: true, opacity: 0.32, depthWrite: false }),
  new THREE.MeshBasicMaterial({ color: 0xb9cfff, transparent: true, opacity: 0.62, depthWrite: false })];
function renderIce() {
  iceGroup.clear();
  ice.forEach((layers, i) => {
    if (!layers) return;
    const tile = new THREE.Mesh(iceGeometry, iceMaterials[layers]);
    tile.position.set(colX(i % COLS), rowY(Math.floor(i / COLS)), 0.67);
    iceGroup.add(tile);
  });
}
function setupIce() {
  ice.fill(0);
  const cells = Array.from({ length: ROWS * COLS }, (_, i) => i);
  for (let i = cells.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [cells[i], cells[j]] = [cells[j], cells[i]];
  }
  cells.slice(0, level.iceCount).forEach(i => { ice[i] = level.iceLayers; });
  renderIce();
}
const iceLeft = () => ice.reduce((a, b) => a + b, 0);
function notice(message) { $('status').textContent = message; }

const gemGroup = new THREE.Group();
scene.add(gemGroup);

const $ = id => document.getElementById(id);
function updateHUD(combo) {
  $('score').textContent = score;
  $('moves').textContent = moves;
  $('combo').textContent = combo > 1 ? `x${combo}` : '-';
  $('level-title').textContent = `第 ${level.id} 关 · ${level.name}`;
  $('score-target').textContent = level.targetScore;
  $('score-progress').value = Math.min(score, level.targetScore);
  $('score-progress').max = level.targetScore;
  $('collect-goal').textContent = level.collect ? `${GEM_DEFS[level.collectType].name} ${Math.min(collected, level.collect)} / ${level.collect}` : '本关无需收集';
  $('ice-goal').textContent = level.iceCount ? `剩余 ${iceLeft()} 层冰` : '本关没有冰层';
  $('energy').textContent = `${energy} / 60`;
  $('energy-progress').value = energy;
  for (const [kind, skill] of Object.entries(SKILLS)) {
    const button = $(`skill-${kind}`);
    button.disabled = busy || gameOver || energy < skill.cost;
    button.classList.toggle('active', activeSkill === kind);
    button.setAttribute('aria-pressed', String(activeSkill === kind));
  }
  $('restart').disabled = busy;
  $('level-select').disabled = busy;

}

function makeGem(type, r, c) {
  const mesh = prototypes[type].clone();
  mesh.userData = { type, r, c, spin: (Math.random() - 0.5) * 0.8, phase: Math.random() * Math.PI * 2 };
  mesh.position.set(colX(c), rowY(r), 0.15);
  gemGroup.add(mesh);
  return mesh;
}

function randomTypeNoMatch(r, c) {
  const banned = new Set();
  if (c >= 2 && grid[r][c - 1] && grid[r][c - 2] && grid[r][c - 1].userData.type === grid[r][c - 2].userData.type)
    banned.add(grid[r][c - 1].userData.type);
  if (r >= 2 && grid[r - 1][c] && grid[r - 2][c] && grid[r - 1][c].userData.type === grid[r - 2][c].userData.type)
    banned.add(grid[r - 1][c].userData.type);
  let t;
  do { t = Math.floor(Math.random() * level.types); } while (banned.has(t));
  return t;
}

async function initBoard() {
  gemGroup.clear();
  grid.length = 0;
  for (let r = 0; r < ROWS; r++) {
    grid.push([]);
    for (let c = 0; c < COLS; c++) grid[r].push(null);
  }
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      const g = makeGem(randomTypeNoMatch(r, c), r, c);
      g.position.y = rowY(r) + 12;
      grid[r][c] = g;
    }
  }
  if (!hasPossibleMove()) return initBoard();
  const anims = [];
  for (let r = 0; r < ROWS; r++)
    for (let c = 0; c < COLS; c++) {
      anims.push(sleep((ROWS - r) * 40 + c * 20).then(() => tween(grid[r][c].position, { y: rowY(r) }, 0.6, { ease: easeOutBounce })));
    }
  await Promise.all(anims);
}

// ---------- 匹配逻辑 ----------
function findMatches() {
  const matched = new Set();
  for (let r = 0; r < ROWS; r++) {
    let run = 1;
    for (let c = 1; c <= COLS; c++) {
      const same = c < COLS && grid[r][c] && grid[r][c - 1] && grid[r][c].userData.type === grid[r][c - 1].userData.type;
      if (same) run++;
      else { if (run >= 3) for (let k = c - run; k < c; k++) matched.add(r * COLS + k); run = 1; }
    }
  }
  for (let c = 0; c < COLS; c++) {
    let run = 1;
    for (let r = 1; r <= ROWS; r++) {
      const same = r < ROWS && grid[r][c] && grid[r - 1][c] && grid[r][c].userData.type === grid[r - 1][c].userData.type;
      if (same) run++;
      else { if (run >= 3) for (let k = r - run; k < r; k++) matched.add(k * COLS + c); run = 1; }
    }
  }
  return matched;
}

function swapCells(a, b) {
  const ga = grid[a.r][a.c], gb = grid[b.r][b.c];
  grid[a.r][a.c] = gb; grid[b.r][b.c] = ga;
  if (ga) { ga.userData.r = b.r; ga.userData.c = b.c; }
  if (gb) { gb.userData.r = a.r; gb.userData.c = a.c; }
}

function hasPossibleMove() {
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      for (const [dr, dc] of [[0, 1], [1, 0]]) {
        const r2 = r + dr, c2 = c + dc;
        if (r2 >= ROWS || c2 >= COLS) continue;
        swapCells({ r, c }, { r: r2, c: c2 });
        const ok = findMatches().size > 0;
        swapCells({ r, c }, { r: r2, c: c2 });
        if (ok) return true;
      }
    }
  }
  return false;
}

// 让两个宝石分别移动到各自 userData 中记录的逻辑格子
async function animateToCell(...gems) {
  await Promise.all(gems.map(g => tween(g.position, { x: colX(g.userData.c), y: rowY(g.userData.r) }, 0.22)));
}

async function removeMatches(matched, combo, charge = true, shatter = false) {
  const gems = [...matched].map(i => grid[Math.floor(i / COLS)][i % COLS]);
  score += gems.length * 10 * combo;
  if (charge) energy = Math.min(60, energy + gems.length);
  collected += gems.filter(g => g.userData.type === level.collectType).length;
  for (const i of matched) ice[i] = Math.max(0, ice[i] - (shatter ? 2 : 1));
  renderIce();
  updateHUD(combo);
  sfx.pop(combo, gems.length);
  await Promise.all(gems.map(g => {
    burst(g.position.x, g.position.y, GEM_DEFS[g.userData.type].color);
    return tween(g.scale, { x: 0.01, y: 0.01, z: 0.01 }, 0.25).then(() => gemGroup.remove(g));
  }));
  for (const i of matched) grid[Math.floor(i / COLS)][i % COLS] = null;
}

async function applyGravityAndRefill() {
  const anims = [];
  for (let c = 0; c < COLS; c++) {
    let write = ROWS - 1;
    for (let r = ROWS - 1; r >= 0; r--) {
      const g = grid[r][c];
      if (!g) continue;
      if (write !== r) {
        grid[write][c] = g; grid[r][c] = null;
        g.userData.r = write;
        anims.push(tween(g.position, { x: colX(c), y: rowY(write) }, 0.35 + (write - r) * 0.05, { ease: easeOutBounce }));
      }
      write--;
    }
    // 补充新宝石
    let spawn = 1;
    for (let r = write; r >= 0; r--, spawn++) {
      const g = makeGem(Math.floor(Math.random() * level.types), r, c);
      g.position.y = rowY(0) + spawn * CELL + 0.5;
      grid[r][c] = g;
      anims.push(tween(g.position, { y: rowY(r) }, 0.45 + spawn * 0.05, { ease: easeOutBounce }));
    }
  }
  await Promise.all(anims);
  sfx.land();
}

async function resolveBoard(charge = true) {
  let combo = 1;
  let matched = findMatches();
  while (matched.size > 0) {
    await removeMatches(matched, combo, charge);
    await applyGravityAndRefill();
    combo++;
    matched = findMatches();
  }
  updateHUD(1);
  if (moves > 0 && !objectivesMet(level, score, collected, iceLeft()) && !hasPossibleMove()) {
    notice('没有可用交换，已为你免费洗牌。');
    await sleep(300);
    await reshuffle();
  }
}

async function reshuffle() {
  sfx.shuffle();
  // 打散所有宝石并重新生成（保留分数/步数）
  await Promise.all(gemGroup.children.map(g => tween(g.scale, { x: 0.01, y: 0.01, z: 0.01 }, 0.3)));
  await initBoard();
}

// ---------- 交互 ----------
const raycaster = new THREE.Raycaster();
const pointer = new THREE.Vector2();

function pickGem(ev) {
  const rect = renderer.domElement.getBoundingClientRect();
  pointer.x = ((ev.clientX - rect.left) / rect.width) * 2 - 1;
  pointer.y = -((ev.clientY - rect.top) / rect.height) * 2 + 1;
  raycaster.setFromCamera(pointer, camera);
  const hit = raycaster.intersectObjects(gemGroup.children, true)[0];
  if (!hit) return null;
  let o = hit.object;
  while (o.parent && o.parent !== gemGroup) o = o.parent;
  return o.parent === gemGroup ? o : null;
}

function setSelected(g) {
  selected = g;
  if (g) {
    selector.visible = true;
    selector.position.x = g.position.x;
    selector.position.y = g.position.y;
  } else selector.visible = false;
}

async function trySwap(ga, gb) {
  const a = { r: ga.userData.r, c: ga.userData.c }, b = { r: gb.userData.r, c: gb.userData.c };
  busy = true;
  updateHUD(1);
  setSelected(null);
  swapCells(a, b);
  sfx.swap();
  await animateToCell(ga, gb);
  if (findMatches().size === 0) {
    sfx.invalid();
    await sleep(80);
    swapCells(a, b);
    await animateToCell(ga, gb);
    busy = false;
    updateHUD(1);
    notice('这次交换无法消除，不扣步数。');
    return;
  }
  moves--;
  updateHUD(1);
  await resolveBoard();
  busy = false;
  checkOutcome();
  updateHUD(1);
}

renderer.domElement.addEventListener('pointerdown', ev => {
  unlock();
  if (busy || gameOver) return;
  const g = pickGem(ev);
  if (!g) { setSelected(null); return; }
  if (activeSkill) { useSkill(g); return; }
  if (!selected) { setSelected(g); sfx.select(); return; }
  if (g === selected) { setSelected(null); return; }
  const dr = Math.abs(g.userData.r - selected.userData.r), dc = Math.abs(g.userData.c - selected.userData.c);
  if (dr + dc === 1) trySwap(selected, g);
  else setSelected(g);
});

// 悬停高亮
let hovered = null;
renderer.domElement.addEventListener('pointermove', ev => {
  if (busy) return;
  const g = pickGem(ev);
  if (hovered && hovered !== g) hovered.userData.hover = false;
  hovered = g;
  if (g) g.userData.hover = true;
  renderer.domElement.style.cursor = g ? 'pointer' : 'default';
});

function refreshLevels() {
  $('level-select').replaceChildren(...LEVELS.map((item, i) => {
    const option = document.createElement('option');
    option.value = i;
    option.disabled = item.id > progress.unlocked;
    option.textContent = `${item.id > progress.unlocked ? '🔒 ' : ''}${item.id}. ${item.name} ${'★'.repeat(progress.stars[i])}`;
    return option;
  }));
  $('level-select').value = levelIndex;
}
function checkOutcome() {
  const outcome = outcomeFor(level, score, collected, iceLeft(), moves);
  if (outcome !== 'playing') endGame(outcome === 'won');
}
function endGame(success) {
  gameOver = true;
  won = success;
  activeSkill = null;
  setSelected(null);
  sfx.gameOver();
  const stars = starsFor(moves, level.moves);
  let saved = true;
  if (success) {
    progress.stars[levelIndex] = Math.max(progress.stars[levelIndex], stars);
    progress.unlocked = Math.min(LEVELS.length, Math.max(progress.unlocked, level.id + 1));
    try { localStorage.setItem('happy-match3-progress', JSON.stringify(progress)); } catch { saved = false; }
    refreshLevels();
  }
  $('result-title').textContent = success ? (level.id === 12 ? '恭喜完成全部关卡！' : '关卡通过！') : '还差一点点';
  $('result-stars').textContent = success ? '★'.repeat(stars) + '☆'.repeat(3 - stars) : '再试一次';
  $('result-detail').textContent = success
    ? `全部目标完成，剩余 ${moves} 步。${saved ? '星级与解锁进度已保存。' : '浏览器无法保存进度，本次会话仍可继续。'}`
    : `未完成：${[score < level.targetScore ? `分数还差 ${level.targetScore - score}` : '', collected < level.collect ? `${GEM_DEFS[level.collectType].name}还差 ${level.collect - collected} 只` : '', iceLeft() ? `还有 ${iceLeft()} 层冰` : ''].filter(Boolean).join('、')}`;
  $('final-score').textContent = score;
  $('next-level').hidden = !success || level.id === LEVELS.length;
  $('overlay').classList.remove('hidden');
  $('next-level').hidden ? $('play-again').focus() : $('next-level').focus();
}

async function restart(index = levelIndex) {
  if (busy) return;
  busy = true;
  levelIndex = index;
  level = LEVELS[levelIndex];
  $('overlay').classList.add('hidden');
  gameOver = false;
  won = false;
  score = 0; moves = level.moves; energy = 12; collected = 0; activeSkill = null;
  setSelected(null);
  setupIce();
  refreshLevels();
  updateHUD(1);
  notice(`完成全部目标即可过关。${level.iceLayers === 2 ? '深蓝冰块需要消除两次。' : '消除冰块上的动物可以破冰。'}`);
  await initBoard();
  busy = false;
  updateHUD(1);
}

async function useSkill(g) {
  const kind = activeSkill;
  if (busy || gameOver || !kind || energy < SKILLS[kind].cost) return;
  busy = true;
  activeSkill = null;
  setSelected(null);
  energy -= SKILLS[kind].cost;
  updateHUD(1);
  notice(`${SKILLS[kind].name}已释放，不消耗步数。`);
  if (kind === 'shuffle') await reshuffle();
  else {
    const cells = skillCells(kind, g.userData.r, g.userData.c, grid.map(row => row.map(gem => gem.userData.type)));
    await removeMatches(cells, 1, false, kind === 'hammer');
    await applyGravityAndRefill();
    await resolveBoard(false);
  }
  busy = false;
  checkOutcome();
  updateHUD(1);
}
for (const [kind, skill] of Object.entries(SKILLS)) {
  $(`skill-${kind}`).addEventListener('click', () => {
    unlock();
    if (busy || gameOver || energy < skill.cost) return;
    activeSkill = activeSkill === kind ? null : kind;
    setSelected(null);
    if (activeSkill === 'shuffle') { useSkill(null); return; }
    notice(activeSkill ? `${skill.description}；再次点击技能或按 Esc 取消。` : '技能已取消，可以继续交换动物。');
    updateHUD(1);
  });
}
addEventListener('keydown', ev => {
  if (ev.key === 'Escape') { activeSkill = null; setSelected(null); updateHUD(1); notice('已取消选择。'); }
});
$('restart').addEventListener('click', () => { unlock(); restart(); });
$('next-level').addEventListener('click', () => { if (won && levelIndex < 11) restart(levelIndex + 1); });
$('level-select').addEventListener('change', ev => {
  const index = Number(ev.target.value);
  if (Number.isInteger(index) && index >= 0 && index < progress.unlocked) restart(index);
});
$('mute').addEventListener('click', () => {
  unlock();
  setMuted(!isMuted());
  $('mute').textContent = isMuted() ? '🔇 已静音' : '🔊 声音开';
});
$('play-again').addEventListener('click', () => { unlock(); restart(); });

// ---------- 渲染循环 ----------
const clock = new THREE.Clock();
function animate() {
  requestAnimationFrame(animate);
  const dt = Math.min(clock.getDelta(), 0.05);
  const t = clock.elapsedTime;
  updateTweens(dt);
  updateParticles(dt);
  for (const g of gemGroup.children) {
    g.rotation.y = Math.sin(t * 1.2 + g.userData.phase) * 0.35;
    g.rotation.z = Math.sin(t * 1.8 + g.userData.phase) * 0.08;
    const target = g.userData.hover || g === selected ? 1.2 : 1;
    if (!tweens.some(tw => tw.obj === g.scale)) {
      g.scale.x += (target - g.scale.x) * 0.2;
      g.scale.y += (target - g.scale.y) * 0.2;
      g.scale.z += (target - g.scale.z) * 0.2;
    }
  }
  selector.rotation.z += dt;
  selector.material.opacity = 0.6 + Math.sin(t * 6) * 0.3;
  camera.position.x = Math.sin(t * 0.2) * 0.4;
  camera.lookAt(0, 0, 0);
  renderer.render(scene, camera);
}

function resizeGame() {
  const mobile = innerWidth <= 760;
  const left = mobile ? 0 : 320;
  const top = mobile ? 245 : 0;
  const width = Math.max(1, innerWidth - left);
  const height = Math.max(1, innerHeight - top - (mobile ? 164 : 110));
  renderer.domElement.style.left = `${left}px`;
  renderer.domElement.style.top = `${top}px`;
  renderer.setSize(width, height);
  camera.aspect = width / height;
  camera.position.z = Math.max(14.8, 6.5 / Math.tan(Math.PI / 8) / camera.aspect);
  camera.updateProjectionMatrix();
}
addEventListener('resize', resizeGame);
resizeGame();

restart();
animate();

// 调试钩子（用于自动化测试）
window.__match3 = {
  grid, camera, colX, rowY, ROWS, COLS,
  get level() { return level; }, get energy() { return energy; }, get ice() { return [...ice]; }, get collected() { return collected; }, get gameOver() { return gameOver; }, get won() { return won; },
  get busy() { return busy; }, get score() { return score; }, get moves() { return moves; },
  types: () => grid.map(row => row.map(g => g ? g.userData.type : null)),
  // 检查每个宝石的视觉位置是否与逻辑格子一致
  consistent: () => grid.every((row, r) => row.every((g, c) => g && g.userData.r === r && g.userData.c === c &&
    Math.abs(g.position.x - colX(c)) < 0.01 && Math.abs(g.position.y - rowY(r)) < 0.01)),
  findMove: () => {
    for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) for (const [dr, dc] of [[0, 1], [1, 0]]) {
      const r2 = r + dr, c2 = c + dc; if (r2 >= ROWS || c2 >= COLS) continue;
      swapCells({ r, c }, { r: r2, c: c2 }); const ok = findMatches().size > 0; swapCells({ r, c }, { r: r2, c: c2 });
      if (ok) return [[r, c], [r2, c2]];
    }
    return null;
  },
  clickCell: (r, c) => {
    const v = new THREE.Vector3(colX(c), rowY(r), 0.2).project(camera);
    const rect = renderer.domElement.getBoundingClientRect();
    renderer.domElement.dispatchEvent(new PointerEvent('pointerdown', { clientX: rect.left + (v.x + 1) / 2 * rect.width, clientY: rect.top + (1 - v.y) / 2 * rect.height, bubbles: true }));
  },
};
