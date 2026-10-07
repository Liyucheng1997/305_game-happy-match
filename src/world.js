// 森林场景：天空、远山、树木、蘑菇、花草、云朵、花粉，以及随关卡形状生成的木质棋盘
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { CELL, makeExitArrow, radialTexture } from './models.js';

export function createWorld(renderer) {
  const scene = new THREE.Scene();
  const sky = document.createElement('canvas');
  sky.width = 4; sky.height = 256;
  const ctx = sky.getContext('2d');
  const grad = ctx.createLinearGradient(0, 0, 0, 256);
  grad.addColorStop(0, '#6ec3f5');
  grad.addColorStop(0.55, '#bfe6fb');
  grad.addColorStop(1, '#eaf7e2');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, 4, 256);
  const skyTex = new THREE.CanvasTexture(sky);
  skyTex.colorSpace = THREE.SRGBColorSpace;
  scene.background = skyTex;
  scene.fog = new THREE.Fog(0xcfeaf6, 28, 75);

  const pmrem = new THREE.PMREMGenerator(renderer);
  const envMap = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  pmrem.dispose();
  scene.environment = envMap;
  scene.environmentIntensity = 0.5;

  scene.add(new THREE.HemisphereLight(0xdff1ff, 0x9fc47e, 0.95));
  const key = new THREE.DirectionalLight(0xfff0d8, 2.3);
  key.position.set(-4, 7, 10);
  key.castShadow = true;
  key.shadow.mapSize.set(2048, 2048);
  Object.assign(key.shadow.camera, { left: -7, right: 7, top: 7, bottom: -7, near: 1, far: 30 });
  key.shadow.bias = -0.0004;
  key.shadow.normalBias = 0.02;
  scene.add(key);
  const fill = new THREE.DirectionalLight(0xcfe3ff, 0.6);
  fill.position.set(6, 2, 6);
  scene.add(fill);

  const scenery = new THREE.Group();
  scene.add(scenery);
  const clouds = [];
  const pollen = makePollen();
  scene.add(pollen);

  function decorate(groundY) {
    scenery.clear();
    clouds.length = 0;
    const rng = seeded(7);
    const ground = new THREE.Mesh(new THREE.CircleGeometry(90, 64), new THREE.MeshStandardMaterial({ color: 0x9fd46c, roughness: 1 }));
    ground.rotation.x = -Math.PI / 2;
    ground.position.set(0, groundY, -20);
    ground.receiveShadow = true;
    scenery.add(ground);
    // 远山
    [[-26, 0x86c66a, 16], [-6, 0x7bbd63, 13], [18, 0x8fcf71, 17], [36, 0x80c46a, 12], [-44, 0x8bc96e, 13]].forEach(([x, color, r], k) => {
      const hill = new THREE.Mesh(new THREE.SphereGeometry(r, 40, 20), new THREE.MeshStandardMaterial({ color, roughness: 1 }));
      hill.scale.y = 0.55;
      hill.position.set(x, groundY - 2, -42 - k * 3);
      scenery.add(hill);
    });
    // 树：两侧近景 + 后方远景
    const spots = [];
    for (const side of [-1, 1]) {
      for (let k = 0; k < 7; k++) spots.push([side * (6.8 + k * 1.9 + rng() * 1.2), -2.5 - rng() * 9]);
    }
    for (let k = 0; k < 10; k++) spots.push([(rng() - 0.5) * 40, -14 - rng() * 12]);
    spots.forEach(([x, z], k) => {
      const tree = k % 3 === 0 ? pineTree(rng) : roundTree(rng);
      tree.position.set(x, groundY, z);
      tree.scale.setScalar(0.85 + rng() * 0.7);
      tree.rotation.y = rng() * Math.PI;
      scenery.add(tree);
    });
    // 地面小物
    for (let k = 0; k < 16; k++) {
      const side = k % 2 ? 1 : -1;
      const item = k % 4 === 0 ? mushroom(rng) : k % 4 === 1 ? flowerPatch(rng) : grassTuft(rng);
      item.position.set(side * (5.2 + rng() * 6), groundY, -0.5 - rng() * 4);
      scenery.add(item);
    }
    for (let k = 0; k < 10; k++) {
      const item = k % 2 ? flowerPatch(rng) : grassTuft(rng);
      item.position.set((rng() - 0.5) * 9, groundY, -1.2 - rng() * 2);
      scenery.add(item);
    }
    // 云
    for (let k = 0; k < 6; k++) {
      const cloud = makeCloud(rng);
      cloud.position.set(-30 + k * 12 + rng() * 4, 9 + rng() * 6, -30 - rng() * 8);
      cloud.userData.speed = 0.25 + rng() * 0.35;
      clouds.push(cloud);
      scenery.add(cloud);
    }
    const sun = new THREE.Sprite(new THREE.SpriteMaterial({ map: radialTexture([[0, 'rgba(255,253,235,1)'], [0.2, 'rgba(255,246,200,0.9)'], [0.45, 'rgba(255,240,190,0.25)'], [1, 'rgba(255,240,190,0)']]), fog: false, depthWrite: false, transparent: true }));
    sun.scale.setScalar(26);
    sun.position.set(22, 22, -50);
    scenery.add(sun);
  }

  function update(t, dt) {
    for (const cloud of clouds) {
      cloud.position.x += cloud.userData.speed * dt;
      if (cloud.position.x > 45) cloud.position.x = -45;
    }
    const pos = pollen.geometry.attributes.position;
    const seeds = pollen.userData.seeds;
    for (let k = 0; k < pos.count; k++) {
      const s = seeds[k];
      pos.setXYZ(k, s.x + Math.sin(t * s.f + s.p) * 0.6, ((s.y + t * s.v + 8) % 16) - 8, s.z + Math.cos(t * s.f * 0.7 + s.p) * 0.4);
    }
    pos.needsUpdate = true;
  }

  return { scene, envMap, key, decorate, update };
}

// ---------- 棋盘 ----------
function roundedRect(w, h, r) {
  const s = new THREE.Shape();
  const x = -w / 2, y = -h / 2;
  s.moveTo(x + r, y);
  s.lineTo(x + w - r, y); s.quadraticCurveTo(x + w, y, x + w, y + r);
  s.lineTo(x + w, y + h - r); s.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  s.lineTo(x + r, y + h); s.quadraticCurveTo(x, y + h, x, y + h - r);
  s.lineTo(x, y + r); s.quadraticCurveTo(x, y, x + r, y);
  return s;
}
function slab(size, radius, depth, bevel) {
  const g = new THREE.ExtrudeGeometry(roundedRect(size, size, radius), { depth, bevelEnabled: true, bevelThickness: bevel, bevelSize: bevel, bevelSegments: 3, curveSegments: 6 });
  return g;
}

let woodGrain = null;
function grainTexture() {
  if (woodGrain) return woodGrain;
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, 256, 256);
  for (let k = 0; k < 60; k++) {
    ctx.strokeStyle = `rgba(120,70,30,${0.05 + Math.random() * 0.12})`;
    ctx.lineWidth = 1 + Math.random() * 2;
    ctx.beginPath();
    const y = Math.random() * 256;
    ctx.moveTo(0, y);
    for (let x = 0; x <= 256; x += 32) ctx.lineTo(x, y + Math.sin(x * 0.03 + k) * 4);
    ctx.stroke();
  }
  woodGrain = new THREE.CanvasTexture(c);
  woodGrain.colorSpace = THREE.SRGBColorSpace;
  woodGrain.wrapS = woodGrain.wrapT = THREE.RepeatWrapping;
  woodGrain.repeat.set(0.25, 0.25);
  return woodGrain;
}

export function cellPosition(game, r, c) {
  return new THREE.Vector3((c - (game.cols - 1) / 2) * CELL, ((game.rows - 1) / 2 - r) * CELL, 0);
}

export function buildBoard(game) {
  const board = new THREE.Group();
  const outer = [], inner = [], tilesA = [], tilesB = [];
  for (const cell of game.cells) {
    if (cell.void) continue;
    const p = cellPosition(game, cell.r, cell.c);
    const o = slab(CELL + 0.42, 0.26, 0.3, 0.06); o.translate(p.x, p.y, -0.5); outer.push(o);
    const n = slab(CELL + 0.16, 0.14, 0.2, 0.03); n.translate(p.x, p.y, -0.32); inner.push(n);
    const t = slab(CELL * 0.92, 0.12, 0.05, 0.025); t.translate(p.x, p.y, -0.09);
    ((cell.r + cell.c) % 2 ? tilesA : tilesB).push(t);
  }
  const mesh = (geos, material) => {
    const m = new THREE.Mesh(mergeGeometries(geos), material);
    geos.forEach(g => g.dispose());
    m.receiveShadow = true;
    m.castShadow = true;
    board.add(m);
    return m;
  };
  mesh(outer, new THREE.MeshStandardMaterial({ color: 0x9a6232, roughness: 0.7, map: grainTexture() }));
  mesh(inner, new THREE.MeshStandardMaterial({ color: 0x6f4320, roughness: 0.8 })).castShadow = false;
  mesh(tilesA, new THREE.MeshStandardMaterial({ color: 0xfff4da, roughness: 0.85 })).castShadow = false;
  mesh(tilesB, new THREE.MeshStandardMaterial({ color: 0xf2dfb6, roughness: 0.85 })).castShadow = false;
  // 支撑木桩
  const groundY = -(game.rows / 2) * CELL - 1.1;
  const postMat = new THREE.MeshStandardMaterial({ color: 0x7a4a24, roughness: 0.8, map: grainTexture() });
  for (const x of [-2.6, 2.6]) {
    const h = -groundY;
    const post = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.26, h, 16), postMat);
    post.position.set(x, groundY + h / 2, -0.75);
    post.castShadow = true;
    board.add(post);
  }
  // 橡果关卡：在出口下方显示箭头
  const exits = [];
  if (game.goals.some(g => g.kind === 'acorn')) {
    for (const i of game.exits) {
      const cell = game.cells[i];
      const arrow = makeExitArrow();
      const p = cellPosition(game, cell.r, cell.c);
      arrow.position.set(p.x, p.y - 0.66, 0.05);
      arrow.scale.setScalar(0.85);
      arrow.userData.baseY = arrow.position.y;
      board.add(arrow);
      exits.push(arrow);
    }
  }
  board.userData.exits = exits;
  board.userData.groundY = groundY;
  return board;
}

// ---------- 场景小物 ----------
function seeded(seed) {
  let a = seed;
  return () => { a = (a * 16807) % 2147483647; return a / 2147483647; };
}
const lam = (color, extra = {}) => new THREE.MeshStandardMaterial({ color, roughness: 0.85, flatShading: true, ...extra });

function roundTree(rng) {
  const g = new THREE.Group();
  const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.32, 2.2, 8), lam(0x8a5a33));
  trunk.position.y = 1.1;
  trunk.castShadow = true;
  g.add(trunk);
  const greens = [0x5fb548, 0x6cc254, 0x4fa83f, 0x78c95c];
  for (let k = 0; k < 4; k++) {
    const blob = new THREE.Mesh(new THREE.IcosahedronGeometry(1, 1), lam(greens[(k + Math.floor(rng() * 4)) % 4]));
    blob.position.set((rng() - 0.5) * 1.2, 2.6 + k * 0.45 + rng() * 0.3, (rng() - 0.5) * 1);
    blob.scale.setScalar(1.05 - k * 0.12 + rng() * 0.25);
    blob.castShadow = true;
    g.add(blob);
  }
  return g;
}
function pineTree(rng) {
  const g = new THREE.Group();
  const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.24, 1.2, 8), lam(0x7a4b2a));
  trunk.position.y = 0.6;
  g.add(trunk);
  const col = [0x3f9a4f, 0x47a957, 0x52b862][Math.floor(rng() * 3)];
  for (let k = 0; k < 4; k++) {
    const tier = new THREE.Mesh(new THREE.ConeGeometry(1.5 - k * 0.3, 1.5, 9), lam(col));
    tier.position.y = 1.5 + k * 0.85;
    tier.castShadow = true;
    g.add(tier);
  }
  return g;
}
function mushroom(rng) {
  const g = new THREE.Group();
  const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.16, 0.45, 12), new THREE.MeshStandardMaterial({ color: 0xfff3e0, roughness: 0.7 }));
  stem.position.y = 0.22;
  g.add(stem);
  const cap = new THREE.Mesh(new THREE.SphereGeometry(0.36, 20, 12, 0, Math.PI * 2, 0, Math.PI / 2), new THREE.MeshStandardMaterial({ color: 0xe8483f, roughness: 0.45 }));
  cap.position.y = 0.4;
  cap.scale.y = 0.8;
  cap.castShadow = true;
  g.add(cap);
  for (let k = 0; k < 6; k++) {
    const a = rng() * Math.PI * 2, e = 0.3 + rng() * 0.9;
    const dot = new THREE.Mesh(new THREE.SphereGeometry(0.05, 8, 6), new THREE.MeshStandardMaterial({ color: 0xffffff }));
    dot.position.set(Math.cos(a) * Math.cos(e) * 0.36, 0.4 + Math.sin(e) * 0.29, Math.sin(a) * Math.cos(e) * 0.36);
    dot.scale.y = 0.5;
    g.add(dot);
  }
  g.scale.setScalar(0.9 + rng() * 0.8);
  return g;
}
function flowerPatch(rng) {
  const g = new THREE.Group();
  const petals = [0xff8fb1, 0xffd34d, 0xffffff, 0xb59cff, 0xff9f5a];
  for (let k = 0; k < 3; k++) {
    const f = new THREE.Group();
    const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.4, 5), lam(0x4f9a3a));
    stem.position.y = 0.2;
    f.add(stem);
    const color = petals[Math.floor(rng() * petals.length)];
    for (let p = 0; p < 5; p++) {
      const a = (p / 5) * Math.PI * 2;
      const petal = new THREE.Mesh(new THREE.SphereGeometry(0.07, 8, 6), new THREE.MeshStandardMaterial({ color, roughness: 0.6 }));
      petal.position.set(Math.cos(a) * 0.08, 0.42, Math.sin(a) * 0.08);
      petal.scale.y = 0.45;
      f.add(petal);
    }
    const center = new THREE.Mesh(new THREE.SphereGeometry(0.05, 8, 6), new THREE.MeshStandardMaterial({ color: 0xffc23a }));
    center.position.y = 0.44;
    f.add(center);
    f.position.set((rng() - 0.5) * 0.6, 0, (rng() - 0.5) * 0.6);
    g.add(f);
  }
  return g;
}
function grassTuft(rng) {
  const g = new THREE.Group();
  const mat = lam(rng() > 0.5 ? 0x6cbf45 : 0x5aae3d);
  for (let k = 0; k < 6; k++) {
    const blade = new THREE.Mesh(new THREE.ConeGeometry(0.05, 0.4 + rng() * 0.3, 4), mat);
    blade.position.set((rng() - 0.5) * 0.3, 0.2, (rng() - 0.5) * 0.3);
    blade.rotation.set((rng() - 0.5) * 0.6, 0, (rng() - 0.5) * 0.6);
    g.add(blade);
  }
  return g;
}
function makeCloud(rng) {
  const g = new THREE.Group();
  const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 1, emissive: 0xeaf4ff, emissiveIntensity: 0.35 });
  for (let k = 0; k < 5; k++) {
    const puff = new THREE.Mesh(new THREE.SphereGeometry(1, 16, 12), mat);
    puff.position.set((k - 2) * 1.3, Math.sin(k) * 0.3 + (k === 2 ? 0.6 : 0), rng() * 0.5);
    puff.scale.setScalar(1.1 + rng() * 0.8 - Math.abs(k - 2) * 0.2);
    g.add(puff);
  }
  g.scale.set(1.4, 1, 1);
  return g;
}
function makePollen() {
  const count = 70;
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array(count * 3), 3));
  const seeds = Array.from({ length: count }, () => ({
    x: (Math.random() - 0.5) * 22, y: Math.random() * 16 - 8, z: -1 - Math.random() * 6,
    v: 0.15 + Math.random() * 0.25, f: 0.3 + Math.random() * 0.6, p: Math.random() * 6,
  }));
  const pts = new THREE.Points(geo, new THREE.PointsMaterial({
    size: 0.16, map: radialTexture([[0, 'rgba(255,255,230,1)'], [0.4, 'rgba(255,250,200,0.6)'], [1, 'rgba(255,250,200,0)']], 32),
    transparent: true, depthWrite: false, color: 0xfffbe0,
  }));
  pts.userData.seeds = seeds;
  pts.frustumCulled = false;
  return pts;
}
