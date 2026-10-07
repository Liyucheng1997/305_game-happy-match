// 程序化建模：动物、橡果、彩虹球、特效装饰、冰层、木箱、藤蔓、木槌。
// 每个模型的零件按材质合并成少量网格，克隆时共享几何体与材质。
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { ANIMALS } from './levels.js';

export const CELL = 1;
export const PIECE_Z = 0.4;

const AXIS_Z = new THREE.Vector3(0, 0, 1);
const tmpEuler = new THREE.Euler();

// ---------- 几何工具 ----------
const sph = (w = 40, h = 28) => new THREE.SphereGeometry(1, w, h);
const cone = (seg = 28) => new THREE.ConeGeometry(1, 1, seg, 3);
const cyl = (top = 1, bottom = 1, seg = 28) => new THREE.CylinderGeometry(top, bottom, 1, seg, 1);

function lathe(points, segments = 40) {
  return new THREE.LatheGeometry(points.map(([x, y]) => new THREE.Vector2(x, y)), segments);
}
// 圆角圆柱（用于猪鼻子、按钮状零件），沿 +z 方向
function roundDisc(radius, depth, bevel, segments = 40) {
  const pts = [[0, -depth / 2]];
  for (let k = 0; k <= 6; k++) {
    const a = -Math.PI / 2 + (k / 6) * (Math.PI / 2);
    pts.push([radius - bevel + Math.cos(a) * bevel, -depth / 2 + bevel + Math.sin(a) * bevel]);
  }
  for (let k = 0; k <= 6; k++) {
    const a = (k / 6) * (Math.PI / 2);
    pts.push([radius - bevel + Math.cos(a) * bevel, depth / 2 - bevel + Math.sin(a) * bevel]);
  }
  pts.push([0, depth / 2]);
  const g = lathe(pts, segments);
  g.rotateX(Math.PI / 2);
  return g;
}

function toMatrix({ p = [0, 0, 0], r = [0, 0, 0], q = null, s = 1 }) {
  const quat = q ?? new THREE.Quaternion().setFromEuler(tmpEuler.set(...r));
  const scale = typeof s === 'number' ? [s, s, s] : s;
  return new THREE.Matrix4().compose(new THREE.Vector3(...p), quat, new THREE.Vector3(...scale));
}

class Builder {
  constructor() { this.buckets = new Map(); }
  add(material, geometry, t = {}) {
    const g = geometry.index ? geometry.toNonIndexed() : geometry.clone();
    geometry.dispose();
    g.applyMatrix4(toMatrix(t));
    for (const name of Object.keys(g.attributes)) if (!['position', 'normal', 'uv'].includes(name)) g.deleteAttribute(name);
    if (!g.attributes.uv) g.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2));
    if (!this.buckets.has(material)) this.buckets.set(material, []);
    this.buckets.get(material).push(g);
    return this;
  }
  build(group, { shadow = true, offset = null } = {}) {
    for (const [material, geos] of this.buckets) {
      const geometry = mergeGeometries(geos);
      geos.forEach(g => g.dispose());
      if (offset) geometry.translate(...offset);
      const mesh = new THREE.Mesh(geometry, material);
      mesh.castShadow = shadow && !material.transparent;
      mesh.receiveShadow = !material.transparent;
      group.add(mesh);
    }
    this.buckets.clear();
    return group;
  }
}

// 椭球表面：用于把五官精确贴在曲面上
class Ell {
  constructor(rx, ry, rz, cx = 0, cy = 0, cz = 0) { Object.assign(this, { rx, ry, rz, cx, cy, cz }); }
  z(x, y) {
    const u = (x - this.cx) / this.rx, v = (y - this.cy) / this.ry, k = 1 - u * u - v * v;
    return k <= 0 ? -Infinity : this.cz + this.rz * Math.sqrt(k);
  }
  normal(x, y) {
    const z = this.z(x, y);
    return new THREE.Vector3((x - this.cx) / this.rx ** 2, (y - this.cy) / this.ry ** 2, (z - this.cz) / this.rz ** 2).normalize();
  }
}
// 返回贴在最外层表面的位置与朝向（out 沿法线外移；spin 绕法线旋转）
function onFace(shapes, x, y, out = 0, spin = 0) {
  let best = null, bz = -Infinity;
  for (const s of shapes) { const z = s.z(x, y); if (z > bz) { bz = z; best = s; } }
  const n = best.normal(x, y);
  const q = new THREE.Quaternion().setFromUnitVectors(AXIS_Z, n);
  if (spin) q.multiply(new THREE.Quaternion().setFromAxisAngle(AXIS_Z, spin));
  const p = new THREE.Vector3(x, y, bz).addScaledVector(n, out);
  return { p: p.toArray(), q, n };
}
function local(t, v) { return new THREE.Vector3(...v).applyQuaternion(t.q).add(new THREE.Vector3(...t.p)).toArray(); }

// ---------- 材质 ----------
function canvasTexture(size, draw, srgb = true) {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  draw(canvas.getContext('2d'), size);
  const tex = new THREE.CanvasTexture(canvas);
  if (srgb) tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}
export function radialTexture(stops, size = 128) {
  return canvasTexture(size, (ctx, s) => {
    const g = ctx.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
    stops.forEach(([o, c]) => g.addColorStop(o, c));
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, s, s);
  });
}

function furMat(color, { sheen = 1, rough = 0.62 } = {}) {
  const c = new THREE.Color(color);
  return new THREE.MeshPhysicalMaterial({
    color: c, roughness: rough, metalness: 0,
    sheen, sheenRoughness: 0.45, sheenColor: c.clone().lerp(new THREE.Color(0xffffff), 0.55),
    clearcoat: 0.06, clearcoatRoughness: 0.6,
  });
}
const gloss = (color, extra = {}) => new THREE.MeshPhysicalMaterial({ color, roughness: 0.18, clearcoat: 1, clearcoatRoughness: 0.08, ...extra });

let M = null;
function materials() {
  if (M) return M;
  const blush = radialTexture([[0, 'rgba(255,120,150,0.95)'], [0.55, 'rgba(255,130,160,0.45)'], [1, 'rgba(255,140,170,0)']], 64);
  M = {
    eye: gloss(0x1d1411),
    eyeSoft: gloss(0x2b201c),
    shine: new THREE.MeshBasicMaterial({ color: 0xffffff }),
    white: furMat(0xfff8ee),
    cream: furMat(0xfff1dc),
    nose: gloss(0x2c1d18, { roughness: 0.25 }),
    mouth: new THREE.MeshStandardMaterial({ color: 0x5b2626, roughness: 0.55 }),
    blush: new THREE.MeshBasicMaterial({ map: blush, transparent: true, depthWrite: false }),
    beak: gloss(0xff9a1f, { roughness: 0.35, clearcoat: 0.5 }),
    beakDark: gloss(0xf07c12, { roughness: 0.35, clearcoat: 0.5 }),
  };
  return M;
}

// 眼睛：深色亮面眼球 + 两颗高光；放在单独的组里方便眨眼
function addEyes(e, shapes, { x, y, w = 0.052, h = 0.066, d = 0.04, inset = -0.014, mat }) {
  for (const sx of [-1, 1]) {
    const t = onFace(shapes, sx * x, y, inset);
    e.add(mat ?? M.eye, sph(24, 18), { p: t.p, q: t.q, s: [w, h, d] });
    e.add(M.shine, sph(12, 8), { p: local(t, [-w * 0.32, h * 0.36, d * 0.78]), q: t.q, s: [w * 0.36, h * 0.3, 0.01] });
    e.add(M.shine, sph(10, 6), { p: local(t, [w * 0.3, -h * 0.3, d * 0.8]), q: t.q, s: [w * 0.16, w * 0.16, 0.008] });
  }
}
function addBlush(b, shapes, x, y, w = 0.15, h = 0.09) {
  for (const sx of [-1, 1]) {
    const t = onFace(shapes, sx * x, y, 0.006);
    b.add(M.blush, new THREE.PlaneGeometry(1, 1), { p: t.p, q: t.q, s: [w, h, 1] });
  }
}
function addMouth(b, shapes, pts, { radius = 0.011, out = 0.004, mat } = {}) {
  const curve = new THREE.CatmullRomCurve3(pts.map(([x, y]) => new THREE.Vector3(...onFace(shapes, x, y, out).p)));
  b.add(mat ?? M.mouth, new THREE.TubeGeometry(curve, 24, radius, 8, false));
  for (const end of [curve.getPoint(0), curve.getPoint(1)]) b.add(mat ?? M.mouth, sph(10, 8), { p: end.toArray(), s: radius });
}

function finish(b, e, eyeY, kind) {
  const root = new THREE.Group();
  const body = new THREE.Group();
  body.name = 'body';
  b.build(body);
  const eyes = new THREE.Group();
  eyes.name = 'eyes';
  e.build(eyes, { shadow: false, offset: [0, -eyeY, 0] });
  eyes.position.y = eyeY;
  body.add(eyes);
  body.scale.setScalar(kind === 'acorn' ? 1.12 : 1.13);
  root.add(body);
  root.userData.kind = kind;
  return root;
}

// ---------- 六只动物 ----------
function fox() {
  const b = new Builder(), e = new Builder();
  const fur = furMat(0xf0812f), dark = furMat(0x3d2518, { sheen: 0.4 });
  const head = new Ell(0.37, 0.32, 0.31), muzzle = new Ell(0.17, 0.12, 0.14, 0, -0.1, 0.19), snout = new Ell(0.105, 0.078, 0.1, 0, -0.065, 0.27);
  const shapes = [head, muzzle, snout];
  b.add(fur, sph(), { s: [0.37, 0.32, 0.31] });
  b.add(M.cream, sph(), { p: [0, -0.1, 0.19], s: [0.17, 0.12, 0.14] });
  b.add(M.cream, sph(), { p: [0, -0.065, 0.27], s: [0.105, 0.078, 0.1] });
  // 额头的浅色斑纹
  b.add(M.cream, sph(), { p: [0, 0.03, 0.235], r: [0.25, 0, 0], s: [0.045, 0.11, 0.06] });
  for (const sx of [-1, 1]) {
    // 蓬松的腮毛
    b.add(M.cream, sph(), { p: [sx * 0.215, -0.14, 0.1], r: [0, 0, sx * 0.45], s: [0.165, 0.11, 0.14] });
    b.add(M.cream, cone(), { p: [sx * 0.345, -0.16, 0.05], r: [0, 0, -sx * (Math.PI / 2 + 0.45)], s: [0.09, 0.13, 0.075] });
    b.add(M.cream, cone(), { p: [sx * 0.29, -0.235, 0.05], r: [0, 0, -sx * (Math.PI / 2 + 1.05)], s: [0.075, 0.1, 0.065] });
    // 耳朵：外耳、内耳、深色耳尖
    const er = [-0.18, 0, -sx * 0.38];
    const ec = new THREE.Vector3(sx * 0.2, 0.34, -0.05);
    b.add(fur, cone(), { p: ec.toArray(), r: er, s: [0.15, 0.3, 0.09] });
    b.add(M.cream, cone(), { p: ec.clone().add(new THREE.Vector3(0, -0.035, 0.035).applyEuler(tmpEuler.set(...er))).toArray(), r: er, s: [0.095, 0.2, 0.05] });
    b.add(dark, cone(), { p: ec.clone().add(new THREE.Vector3(0, 0.095, 0).applyEuler(tmpEuler.set(...er))).toArray(), r: er, s: [0.067, 0.112, 0.043] });
  }
  addEyes(e, shapes, { x: 0.13, y: 0.035 });
  addBlush(b, shapes, 0.235, -0.02, 0.13, 0.08);
  const nose = onFace(shapes, 0, -0.04, -0.012);
  b.add(M.nose, sph(), { p: nose.p, q: nose.q, s: [0.048, 0.034, 0.035] });
  e.add(M.shine, sph(10, 6), { p: local(nose, [-0.014, 0.014, 0.03]), s: [0.012, 0.008, 0.006] });
  addMouth(b, shapes, [[-0.058, -0.118], [-0.03, -0.138], [0, -0.118], [0.03, -0.138], [0.058, -0.118]]);
  return finish(b, e, 0.035, 'fox');
}

function chick() {
  const b = new Builder(), e = new Builder();
  const fur = furMat(0xffd23a), deep = furMat(0xffbf1f);
  const head = new Ell(0.355, 0.345, 0.32);
  const shapes = [head];
  b.add(fur, sph(), { s: [0.355, 0.345, 0.32] });
  // 头顶呆毛
  [[-0.06, 0.37, 0.5], [0, 0.4, 0], [0.06, 0.37, -0.5]].forEach(([x, y, rz]) =>
    b.add(deep, sph(), { p: [x, y, 0.02], r: [0, 0, rz], s: [0.035, 0.1, 0.03] }));
  for (const sx of [-1, 1]) {
    b.add(deep, sph(), { p: [sx * 0.33, -0.13, 0.02], r: [0, 0.2 * sx, sx * 0.55], s: [0.075, 0.15, 0.1] });
    b.add(deep, sph(), { p: [sx * 0.37, -0.06, 0.0], r: [0, 0, sx * 0.9], s: [0.04, 0.08, 0.06] });
  }
  addEyes(e, shapes, { x: 0.13, y: 0.065, w: 0.05, h: 0.062 });
  addBlush(b, shapes, 0.205, -0.03);
  // 上下喙
  const beak = onFace(shapes, 0, -0.035, -0.01);
  b.add(M.beak, cone(), { p: local(beak, [0, 0, 0.045]), r: [Math.PI / 2, 0, 0], s: [0.075, 0.11, 0.055] });
  b.add(M.beakDark, cone(), { p: local(beak, [0, -0.04, 0.025]), r: [Math.PI / 2 - 0.25, 0, 0], s: [0.055, 0.075, 0.035] });
  return finish(b, e, 0.065, 'chick');
}

function frog() {
  const b = new Builder(), e = new Builder();
  const skin = furMat(0x63c043, { sheen: 0.5, rough: 0.45 }), belly = furMat(0xd8f2a2, { sheen: 0.4, rough: 0.5 });
  const head = new Ell(0.39, 0.27, 0.3, 0, -0.05, 0);
  const throat = new Ell(0.28, 0.14, 0.22, 0, -0.15, 0.08);
  const shapes = [head, throat];
  b.add(skin, sph(), { p: [0, -0.05, 0], s: [0.39, 0.27, 0.3] });
  b.add(belly, sph(), { p: [0, -0.15, 0.08], s: [0.28, 0.14, 0.22] });
  const eyeShapes = [];
  for (const sx of [-1, 1]) {
    b.add(skin, sph(), { p: [sx * 0.17, 0.17, 0.05], s: 0.135 });
    b.add(M.white, sph(), { p: [sx * 0.17, 0.19, 0.13], s: [0.1, 0.1, 0.075] });
    eyeShapes.push(new Ell(0.1, 0.1, 0.075, sx * 0.17, 0.19, 0.13));
    // 鼻孔
    const n = onFace(shapes, sx * 0.045, -0.02, 0);
    b.add(M.mouth, sph(10, 8), { p: n.p, q: n.q, s: [0.014, 0.01, 0.006] });
  }
  addEyes(e, eyeShapes, { x: 0.17, y: 0.185, w: 0.052, h: 0.062, d: 0.03, inset: -0.008 });
  addBlush(b, shapes, 0.25, -0.09, 0.14, 0.08);
  addMouth(b, shapes, [[-0.23, -0.06], [-0.12, -0.115], [0, -0.13], [0.12, -0.115], [0.23, -0.06]], { radius: 0.012, mat: new THREE.MeshStandardMaterial({ color: 0x2c5d1b, roughness: 0.6 }) });
  return finish(b, e, 0.185, 'frog');
}

function penguin() {
  const b = new Builder(), e = new Builder();
  const fur = furMat(0x2d4677, { sheen: 0.8 }), face = M.white;
  const head = new Ell(0.36, 0.34, 0.31);
  const masks = [new Ell(0.19, 0.22, 0.2, -0.085, 0.0, 0.13), new Ell(0.19, 0.22, 0.2, 0.085, 0.0, 0.13), new Ell(0.24, 0.17, 0.2, 0, -0.1, 0.13)];
  const shapes = [head, ...masks];
  b.add(fur, sph(), { s: [0.36, 0.34, 0.31] });
  masks.forEach(m => b.add(face, sph(), { p: [m.cx, m.cy, m.cz], s: [m.rx, m.ry, m.rz] }));
  // 头顶的小卷毛
  [[-0.045, 0.345, 0.45, 0.075], [0.005, 0.36, -0.05, 0.095], [0.05, 0.34, -0.5, 0.07]].forEach(([x, y, rz, h]) =>
    b.add(fur, sph(), { p: [x, y, 0.05], r: [0.2, 0, rz], s: [0.03, h, 0.03] }));
  for (const sx of [-1, 1]) b.add(fur, sph(), { p: [sx * 0.33, -0.15, 0], r: [0, 0, sx * 0.55], s: [0.06, 0.15, 0.1] });
  addEyes(e, shapes, { x: 0.1, y: 0.035, w: 0.046, h: 0.062 });
  addBlush(b, shapes, 0.185, -0.075, 0.13, 0.08);
  const beak = onFace(shapes, 0, -0.065, -0.01);
  b.add(M.beak, cone(), { p: local(beak, [0, 0, 0.04]), r: [Math.PI / 2, 0, 0], s: [0.06, 0.1, 0.042] });
  return finish(b, e, 0.035, 'penguin');
}

function pig() {
  const b = new Builder(), e = new Builder();
  const skin = furMat(0xffa0bb, { sheen: 0.7, rough: 0.5 }), snoutM = furMat(0xff86a8, { sheen: 0.5, rough: 0.4 });
  const inner = furMat(0xff7f9f, { sheen: 0.3 }), nostril = gloss(0xb8456c, { roughness: 0.4 });
  const head = new Ell(0.365, 0.325, 0.31);
  const shapes = [head];
  b.add(skin, sph(), { s: [0.365, 0.325, 0.31] });
  const s = onFace(shapes, 0, -0.075, -0.02);
  b.add(snoutM, roundDisc(0.125, 0.11, 0.035), { p: local(s, [0, 0, 0.04]), q: s.q, s: [1, 0.78, 1] });
  for (const sx of [-1, 1]) {
    b.add(nostril, sph(14, 10), { p: local(s, [sx * 0.042, 0, 0.095]), q: s.q, s: [0.022, 0.032, 0.012] });
    // 下垂的耳朵
    const er = [1.05, 0, -sx * 0.8];
    b.add(skin, cone(), { p: [sx * 0.25, 0.24, 0.1], r: er, s: [0.13, 0.2, 0.05] });
    b.add(inner, cone(), { p: [sx * 0.248, 0.228, 0.122], r: er, s: [0.085, 0.14, 0.03] });
  }
  addEyes(e, shapes, { x: 0.145, y: 0.075 });
  addBlush(b, shapes, 0.235, -0.05);
  addMouth(b, shapes, [[-0.05, -0.19], [0, -0.215], [0.05, -0.19]]);
  return finish(b, e, 0.075, 'pig');
}

function panda() {
  const b = new Builder(), e = new Builder();
  const fur = furMat(0xf8f6f0), black = furMat(0x26262e, { sheen: 0.6 });
  const head = new Ell(0.37, 0.33, 0.31), muzzle = new Ell(0.145, 0.1, 0.11, 0, -0.11, 0.22);
  const shapes = [head, muzzle];
  b.add(fur, sph(), { s: [0.37, 0.33, 0.31] });
  b.add(M.white, sph(), { p: [0, -0.11, 0.22], s: [0.145, 0.1, 0.11] });
  for (const sx of [-1, 1]) {
    b.add(black, sph(), { p: [sx * 0.265, 0.25, -0.03], s: [0.115, 0.115, 0.085] });
    const patch = onFace(shapes, sx * 0.135, 0.02, -0.02, sx * 0.55);
    b.add(black, sph(), { p: patch.p, q: patch.q, s: [0.085, 0.12, 0.045] });
  }
  addEyes(e, [new Ell(0.375, 0.335, 0.335)], { x: 0.13, y: 0.035, w: 0.042, h: 0.05, mat: M.eyeSoft });
  addBlush(b, shapes, 0.225, -0.1, 0.13, 0.08);
  const nose = onFace(shapes, 0, -0.07, -0.012);
  b.add(M.nose, sph(), { p: nose.p, q: nose.q, s: [0.045, 0.032, 0.03] });
  e.add(M.shine, sph(10, 6), { p: local(nose, [-0.012, 0.012, 0.026]), s: [0.011, 0.007, 0.006] });
  addMouth(b, shapes, [[-0.045, -0.135], [-0.022, -0.152], [0, -0.135], [0.022, -0.152], [0.045, -0.135]]);
  return finish(b, e, 0.035, 'panda');
}

// ---------- 橡果 ----------
function acorn() {
  const b = new Builder(), e = new Builder();
  const nutM = gloss(0xc9803f, { roughness: 0.32, clearcoat: 0.6 });
  const capTex = canvasTexture(128, (ctx, s) => {
    ctx.fillStyle = '#7a4a24'; ctx.fillRect(0, 0, s, s);
    ctx.strokeStyle = '#5c341a'; ctx.lineWidth = 3;
    for (let k = -s; k < s * 2; k += 14) {
      ctx.beginPath(); ctx.moveTo(k, 0); ctx.lineTo(k + s, s); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(k, s); ctx.lineTo(k + s, 0); ctx.stroke();
    }
  });
  capTex.wrapS = capTex.wrapT = THREE.RepeatWrapping;
  capTex.repeat.set(4, 1);
  const capM = new THREE.MeshStandardMaterial({ color: 0xffffff, map: capTex, roughness: 0.85, bumpMap: capTex, bumpScale: 2.5 });
  const nutPts = [];
  for (let k = 0; k <= 16; k++) {
    const t = k / 16, y = -0.33 + t * 0.42;
    const r = 0.25 * Math.sin(Math.min(1, t * 1.15) * Math.PI * 0.62) ** 0.8 + (t > 0.9 ? -0.01 : 0);
    nutPts.push([Math.max(0.001, r), y]);
  }
  nutPts[0][0] = 0;
  b.add(nutM, lathe(nutPts), {});
  b.add(nutM, sph(), { p: [0, -0.335, 0], s: [0.025, 0.04, 0.025] });
  const capPts = [[0, 0.24], [0.08, 0.235], [0.17, 0.2], [0.24, 0.14], [0.275, 0.08], [0.27, 0.05], [0.24, 0.04], [0.2, 0.05]];
  b.add(capM, lathe(capPts), {});
  b.add(new THREE.MeshStandardMaterial({ color: 0x5c3a1c, roughness: 0.8 }), cyl(0.022, 0.03), { p: [0.02, 0.29, 0], r: [0, 0, -0.35], s: [1, 0.11, 1] });
  const nut = new Ell(0.245, 0.3, 0.245, 0, -0.08, 0);
  addEyes(e, [nut], { x: 0.085, y: -0.07, w: 0.036, h: 0.046, d: 0.03 });
  addBlush(b, [nut], 0.15, -0.13, 0.1, 0.06);
  addMouth(b, [nut], [[-0.03, -0.15], [0, -0.17], [0.03, -0.15]], { radius: 0.009 });
  return finish(b, e, -0.07, 'acorn');
}

// ---------- 彩虹球 ----------
function rainbowBall() {
  const root = new THREE.Group();
  const body = new THREE.Group();
  body.name = 'body';
  const gemGeo = new THREE.IcosahedronGeometry(0.28, 1);
  const pos = gemGeo.attributes.position, colors = [];
  const color = new THREE.Color();
  for (let f = 0; f < pos.count; f += 3) {
    const cx = (pos.getX(f) + pos.getX(f + 1) + pos.getX(f + 2)) / 3, cy = (pos.getY(f) + pos.getY(f + 1) + pos.getY(f + 2)) / 3;
    const cz = (pos.getZ(f) + pos.getZ(f + 1) + pos.getZ(f + 2)) / 3;
    color.setHSL(((Math.atan2(cy, cx) / (Math.PI * 2) + 1) % 1), 1, 0.5 + cz * 0.3);
    for (let k = 0; k < 3; k++) colors.push(color.r, color.g, color.b);
  }
  gemGeo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  const gem = new THREE.Mesh(gemGeo, new THREE.MeshPhysicalMaterial({
    vertexColors: true, roughness: 0.2, metalness: 0, clearcoat: 0.6, clearcoatRoughness: 0.05, flatShading: true,
    emissive: 0x2a1a40, emissiveIntensity: 0.5, envMapIntensity: 0.6,
  }));
  gem.name = 'gem';
  gem.castShadow = true;
  body.add(gem);
  const core = new THREE.Sprite(new THREE.SpriteMaterial({
    map: radialTexture([[0, 'rgba(255,240,255,0.9)'], [0.35, 'rgba(200,150,255,0.45)'], [1, 'rgba(160,120,255,0)']]),
    depthWrite: false, transparent: true,
  }));
  core.scale.setScalar(1.05);
  core.position.z = -0.05;
  body.add(core);
  const orbit = new THREE.Group();
  orbit.name = 'orbit';
  ANIMALS.forEach((a, k) => {
    const dot = new THREE.Mesh(new THREE.SphereGeometry(0.045, 16, 12), new THREE.MeshStandardMaterial({ color: a.color, emissive: a.color, emissiveIntensity: 0.6, roughness: 0.3 }));
    const ang = (k / ANIMALS.length) * Math.PI * 2;
    dot.position.set(Math.cos(ang) * 0.38, Math.sin(ang) * 0.38, 0.05);
    orbit.add(dot);
  });
  orbit.rotation.x = 0.5;
  body.add(orbit);
  body.scale.setScalar(1.1);
  root.add(body);
  root.userData.kind = 'rainbow';
  return root;
}

// ---------- 特效装饰 ----------
let glowTex = null;
export function glowTexture() {
  glowTex ??= radialTexture([[0, 'rgba(255,255,255,1)'], [0.25, 'rgba(255,255,255,0.55)'], [1, 'rgba(255,255,255,0)']]);
  return glowTex;
}
let ringTex = null;
export function makeDeco(special) {
  const deco = new THREE.Group();
  deco.name = 'deco';
  ringTex ??= radialTexture([[0, 'rgba(255,255,255,0)'], [0.56, 'rgba(255,255,255,0)'], [0.7, 'rgba(255,255,255,1)'], [0.8, 'rgba(255,255,255,0.75)'], [1, 'rgba(255,255,255,0)']], 128);
  const halo = new THREE.Sprite(new THREE.SpriteMaterial({ map: ringTex, color: special === 'bomb' ? 0xff7a1a : 0xffc400, transparent: true, depthWrite: false }));
  halo.name = 'halo';
  halo.scale.setScalar(1.3);
  halo.position.z = -0.05;
  deco.add(halo);
  if (special === 'row' || special === 'col') {
    const arrowMat = new THREE.MeshStandardMaterial({ color: 0xffc229, emissive: 0xff9a00, emissiveIntensity: 0.55, roughness: 0.3 });
    const rimMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
    const wind = new THREE.CapsuleGeometry(0.022, 0.15, 4, 8);
    for (const sx of [-1, 1]) {
      const arrow = new THREE.Group();
      arrow.name = 'arrow';
      const head = new THREE.Mesh(new THREE.ConeGeometry(0.12, 0.2, 3), arrowMat);
      head.rotation.z = -sx * Math.PI / 2;
      const rim = new THREE.Mesh(new THREE.ConeGeometry(0.16, 0.26, 3), rimMat);
      rim.rotation.z = -sx * Math.PI / 2;
      rim.position.set(-sx * 0.012, 0, -0.03);
      arrow.add(rim, head);
      for (const sy of [-1, 1]) {
        const line = new THREE.Mesh(wind, rimMat);
        line.rotation.z = Math.PI / 2;
        line.position.set(-sx * 0.1, sy * 0.15, -0.02);
        arrow.add(line);
      }
      arrow.position.set(sx * 0.48, 0, 0.24);
      arrow.userData.dir = sx;
      deco.add(arrow);
    }
    if (special === 'col') deco.rotation.z = Math.PI / 2;
  } else if (special === 'bomb') {
    const ring = new THREE.Group();
    ring.name = 'spin';
    const gold = new THREE.MeshStandardMaterial({ color: 0xffb02e, emissive: 0xff7a00, emissiveIntensity: 0.6, roughness: 0.25, metalness: 0.3 });
    ring.add(new THREE.Mesh(new THREE.TorusGeometry(0.47, 0.045, 14, 72), gold));
    for (let k = 0; k < 8; k++) {
      const a = (k / 8) * Math.PI * 2;
      const spike = new THREE.Mesh(new THREE.OctahedronGeometry(0.07), gold);
      spike.position.set(Math.cos(a) * 0.52, Math.sin(a) * 0.52, 0);
      spike.scale.set(1, 1.7, 0.8);
      spike.rotation.z = a - Math.PI / 2;
      ring.add(spike);
    }
    ring.position.z = 0.08;
    deco.add(ring);
  }
  return deco;
}

// ---------- 障碍物 ----------
let woodTex = null;
function woodTexture() {
  woodTex ??= canvasTexture(256, (ctx, s) => {
    const planks = 4, h = s / planks;
    for (let k = 0; k < planks; k++) {
      ctx.fillStyle = ['#c98a4b', '#bf7f42', '#cf9353', '#c4843f'][k];
      ctx.fillRect(0, k * h, s, h);
      ctx.strokeStyle = 'rgba(110,60,25,0.35)'; ctx.lineWidth = 1.5;
      for (let l = 0; l < 7; l++) {
        ctx.beginPath();
        const y = k * h + 6 + l * (h - 12) / 6;
        ctx.moveTo(0, y);
        for (let x = 0; x <= s; x += 16) ctx.lineTo(x, y + Math.sin(x * 0.05 + k * 3 + l) * 2);
        ctx.stroke();
      }
      ctx.fillStyle = 'rgba(80,40,15,0.7)'; ctx.fillRect(0, k * h, s, 3);
      ctx.fillStyle = '#6b4020';
      for (const x of [14, s - 14]) { ctx.beginPath(); ctx.arc(x, k * h + h / 2, 4, 0, Math.PI * 2); ctx.fill(); }
    }
  });
  return woodTex;
}
export function makeCrate(layers) {
  const g = new THREE.Group();
  const wood = new THREE.MeshStandardMaterial({ map: woodTexture(), roughness: 0.75, bumpMap: woodTexture(), bumpScale: 1.5 });
  const box = new THREE.Mesh(new RoundedBoxGeometry(0.9, 0.9, 0.62, 4, 0.07), wood);
  box.castShadow = box.receiveShadow = true;
  g.add(box);
  const frame = new THREE.MeshStandardMaterial({ color: 0x9a5b2a, roughness: 0.7 });
  for (const [w, h, x, y] of [[0.9, 0.1, 0, 0.4], [0.9, 0.1, 0, -0.4], [0.1, 0.9, 0.4, 0], [0.1, 0.9, -0.4, 0]]) {
    const bar = new THREE.Mesh(new RoundedBoxGeometry(w, h, 0.08, 2, 0.03), frame);
    bar.position.set(x, y, 0.3);
    g.add(bar);
  }
  const diag = new THREE.Mesh(new RoundedBoxGeometry(1.08, 0.1, 0.07, 2, 0.03), frame);
  diag.rotation.z = Math.PI / 4;
  diag.position.z = 0.3;
  g.add(diag);
  if (layers >= 2) {
    const iron = new THREE.MeshStandardMaterial({ color: 0x8c96a6, roughness: 0.3, metalness: 0.85 });
    for (const x of [-0.22, 0.22]) {
      const strap = new THREE.Mesh(new RoundedBoxGeometry(0.1, 0.94, 0.66, 2, 0.03), iron);
      strap.position.x = x;
      strap.name = 'strap';
      g.add(strap);
      for (const y of [-0.3, 0, 0.3]) {
        const rivet = new THREE.Mesh(new THREE.SphereGeometry(0.025, 10, 8), iron);
        rivet.position.set(x, y, 0.335);
        g.add(rivet);
      }
    }
  }
  g.position.z = 0.31;
  return g;
}

export function makeIce(layers) {
  const g = new THREE.Group();
  const thick = layers >= 2;
  const mat = new THREE.MeshPhysicalMaterial({
    color: thick ? 0x5aaeff : 0x9ddcff, roughness: 0.08, metalness: 0, clearcoat: 1, clearcoatRoughness: 0.05,
    transparent: true, opacity: thick ? 0.9 : 0.78, emissive: thick ? 0x1d63c4 : 0x3b9be0, emissiveIntensity: thick ? 0.35 : 0.28,
    envMapIntensity: 1.6,
  });
  const slab = new THREE.Mesh(new RoundedBoxGeometry(0.95, 0.95, thick ? 0.2 : 0.11, 3, 0.05), mat);
  slab.position.z = thick ? 0.1 : 0.055;
  slab.receiveShadow = true;
  g.add(slab);
  // 四角的冰晶
  const shardMat = new THREE.MeshPhysicalMaterial({ color: thick ? 0xa9d8ff : 0xe4f7ff, roughness: 0.05, clearcoat: 1, flatShading: true, transparent: true, opacity: 0.9, emissive: 0x5aa8e0, emissiveIntensity: 0.25 });
  const shard = new THREE.OctahedronGeometry(1, 0);
  const corners = [[-1, -1], [1, -1], [-1, 1], [1, 1]];
  corners.forEach(([sx, sy], k) => {
    const count = thick ? 3 : 2;
    for (let n = 0; n < count; n++) {
      const m = new THREE.Mesh(shard, shardMat);
      const ang = Math.atan2(sy, sx) + (n - (count - 1) / 2) * 0.55;
      const len = 0.09 + ((k + n) % 3) * 0.025 + (thick ? 0.03 : 0);
      m.position.set(sx * 0.36 + Math.cos(ang) * 0.02, sy * 0.36 + Math.sin(ang) * 0.02, (thick ? 0.2 : 0.11) + 0.02);
      m.scale.set(0.035, len, 0.035);
      m.rotation.set(0.5, 0, ang - Math.PI / 2);
      m.rotateX(-0.6);
      g.add(m);
    }
  });
  // 表面的霜花纹理
  const frost = new THREE.Mesh(new THREE.PlaneGeometry(0.9, 0.9), new THREE.MeshBasicMaterial({
    map: frostTexture(), transparent: true, depthWrite: false, opacity: thick ? 0.75 : 0.5,
  }));
  frost.position.z = (thick ? 0.2 : 0.11) + 0.003;
  g.add(frost);
  return g;
}
let frostTex = null;
function frostTexture() {
  frostTex ??= canvasTexture(128, (ctx, s) => {
    ctx.strokeStyle = 'rgba(255,255,255,0.85)';
    ctx.lineCap = 'round';
    const branch = (x, y, a, len, depth) => {
      if (depth === 0 || len < 3) return;
      const x2 = x + Math.cos(a) * len, y2 = y + Math.sin(a) * len;
      ctx.lineWidth = depth * 0.8;
      ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x2, y2); ctx.stroke();
      branch(x2, y2, a + 0.6, len * 0.55, depth - 1);
      branch(x2, y2, a - 0.6, len * 0.55, depth - 1);
      branch(x2, y2, a, len * 0.6, depth - 1);
    };
    for (const [x, y] of [[10, 10], [s - 10, 10], [10, s - 10], [s - 10, s - 10]]) {
      const base = Math.atan2(s / 2 - y, s / 2 - x);
      for (const off of [-0.5, 0, 0.5]) branch(x, y, base + off, 16, 3);
    }
  });
  return frostTex;
}

export function makeVine() {
  const g = new THREE.Group();
  const stem = new THREE.MeshStandardMaterial({ color: 0x3e8a2c, roughness: 0.6 });
  const leafM = new THREE.MeshStandardMaterial({ color: 0x66c23e, roughness: 0.5, side: THREE.DoubleSide });
  const leafShape = new THREE.Shape();
  leafShape.moveTo(0, 0);
  leafShape.quadraticCurveTo(0.06, 0.05, 0, 0.13);
  leafShape.quadraticCurveTo(-0.06, 0.05, 0, 0);
  const leafGeo = new THREE.ShapeGeometry(leafShape, 8);
  const b = new Builder();
  [[0.45, 0.35], [-0.5, -0.3]].forEach(([tx, ty], k) => {
    const pts = [];
    for (let n = 0; n <= 64; n++) {
      const a = (n / 64) * Math.PI * 2;
      pts.push(new THREE.Vector3(Math.cos(a) * 0.42, Math.sin(a) * 0.42 + Math.sin(a * 5 + k) * 0.025, Math.sin(a * 3 + k) * 0.05));
    }
    const curve = new THREE.CatmullRomCurve3(pts, true);
    b.add(stem, new THREE.TubeGeometry(curve, 96, 0.028, 8, true), { r: [tx, ty, k * 0.8] });
  });
  b.build(g);
  for (let k = 0; k < 9; k++) {
    const a = (k / 9) * Math.PI * 2 + 0.3;
    const leaf = new THREE.Mesh(leafGeo, leafM);
    leaf.position.set(Math.cos(a) * 0.43, Math.sin(a) * 0.43, 0.08);
    leaf.rotation.z = a + (k % 2 ? 0.9 : -0.9);
    leaf.rotation.x = 0.4;
    leaf.scale.setScalar(0.9 + (k % 3) * 0.15);
    g.add(leaf);
  }
  return g;
}

export function makeHammer() {
  const g = new THREE.Group();
  const wood = new THREE.MeshStandardMaterial({ color: 0xa8642e, roughness: 0.6 });
  const headM = new THREE.MeshStandardMaterial({ color: 0xe25a4a, roughness: 0.45 });
  const handle = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.06, 1, 16), wood);
  handle.position.y = 0.5;
  g.add(handle);
  const head = new THREE.Mesh(roundDisc(0.17, 0.5, 0.05), headM);
  head.rotation.y = Math.PI / 2;
  head.position.y = 1;
  g.add(head);
  for (const sx of [-1, 1]) {
    const cap = new THREE.Mesh(roundDisc(0.18, 0.06, 0.02), new THREE.MeshStandardMaterial({ color: 0xffd36b, roughness: 0.3, metalness: 0.5 }));
    cap.rotation.y = Math.PI / 2;
    cap.position.set(sx * 0.24, 1, 0);
    g.add(cap);
  }
  g.traverse(o => { o.castShadow = true; });
  return g;
}

// 出口提示箭头（橡果关卡）
export function makeExitArrow() {
  const shape = new THREE.Shape();
  shape.moveTo(-0.16, 0.1); shape.lineTo(-0.06, 0.1); shape.lineTo(-0.06, 0.24); shape.lineTo(0.06, 0.24);
  shape.lineTo(0.06, 0.1); shape.lineTo(0.16, 0.1); shape.lineTo(0, -0.08); shape.lineTo(-0.16, 0.1);
  const geo = new THREE.ExtrudeGeometry(shape, { depth: 0.05, bevelEnabled: true, bevelSize: 0.015, bevelThickness: 0.015, bevelSegments: 2 });
  return new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color: 0x7ed957, emissive: 0x2f9e2f, emissiveIntensity: 0.5, roughness: 0.4 }));
}

// ---------- 原型库 ----------
export function createLibrary() {
  materials();
  const animals = [fox, chick, frog, penguin, pig, panda].map(fn => fn());
  return { animals, acorn: acorn(), rainbow: rainbowBall() };
}

// 用离屏渲染为 HUD 生成图标
export function renderIcons(lib, envMap) {
  const size = 96;
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
  renderer.setSize(size, size);
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  const scene = new THREE.Scene();
  scene.environment = envMap;
  scene.add(new THREE.HemisphereLight(0xffffff, 0x8899aa, 1.2));
  const key = new THREE.DirectionalLight(0xffffff, 2);
  key.position.set(-2, 3, 5);
  scene.add(key);
  const camera = new THREE.PerspectiveCamera(30, 1, 0.1, 20);
  camera.position.set(0, 0.05, 2.1);
  const shot = (obj, scale = 1) => {
    obj.scale.multiplyScalar(scale);
    scene.add(obj);
    renderer.render(scene, camera);
    scene.remove(obj);
    return renderer.domElement.toDataURL();
  };
  const icons = {};
  lib.animals.forEach((a, k) => { icons[`animal${k}`] = shot(a.clone()); });
  icons.acorn = shot(lib.acorn.clone());
  const ice = makeIce(2); ice.rotation.x = 0.45; icons.ice = shot(ice, 0.95);
  const crate = makeCrate(2); crate.position.z = 0; crate.rotation.set(0.35, -0.45, 0); icons.crate = shot(crate, 0.8);
  const vine = new THREE.Group(); vine.add(lib.animals[2].clone()); vine.add(makeVine()); icons.vine = shot(vine, 0.95);
  renderer.dispose();
  renderer.forceContextLoss();
  return icons;
}
