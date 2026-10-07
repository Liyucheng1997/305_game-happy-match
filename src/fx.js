// 特效：粒子（Points 着色器）、光束、冲击波、彩虹闪电、木槌
import * as THREE from 'three';
import { makeHammer } from './models.js';

function spriteTexture(draw) {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  draw(c.getContext('2d'));
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
const TEX = {
  spark: () => spriteTexture(ctx => {
    const g = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
    g.addColorStop(0, 'rgba(255,255,255,1)'); g.addColorStop(0.3, 'rgba(255,255,255,0.7)'); g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g; ctx.fillRect(0, 0, 64, 64);
    ctx.fillStyle = 'rgba(255,255,255,0.9)';
    ctx.beginPath(); ctx.moveTo(32, 2); ctx.lineTo(36, 28); ctx.lineTo(62, 32); ctx.lineTo(36, 36); ctx.lineTo(32, 62); ctx.lineTo(28, 36); ctx.lineTo(2, 32); ctx.lineTo(28, 28); ctx.fill();
  }),
  chunk: () => spriteTexture(ctx => {
    ctx.fillStyle = '#fff';
    ctx.beginPath(); ctx.moveTo(32, 6); ctx.quadraticCurveTo(58, 32, 32, 58); ctx.quadraticCurveTo(6, 32, 32, 6); ctx.fill();
  }),
};

class ParticleLayer {
  constructor(scene, texture, blending, capacity = 1200) {
    this.cap = capacity;
    this.n = 0;
    this.data = [];
    const geo = new THREE.BufferGeometry();
    this.pos = new Float32Array(capacity * 3);
    this.col = new Float32Array(capacity * 3);
    this.size = new Float32Array(capacity);
    this.alpha = new Float32Array(capacity);
    this.rot = new Float32Array(capacity);
    geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('color', new THREE.BufferAttribute(this.col, 3).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('size', new THREE.BufferAttribute(this.size, 1).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('alpha', new THREE.BufferAttribute(this.alpha, 1).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('rot', new THREE.BufferAttribute(this.rot, 1).setUsage(THREE.DynamicDrawUsage));
    this.material = new THREE.ShaderMaterial({
      uniforms: { map: { value: texture }, scale: { value: 600 } },
      vertexShader: `
        attribute float size; attribute float alpha; attribute float rot; attribute vec3 color;
        varying vec3 vColor; varying float vAlpha; varying float vRot;
        uniform float scale;
        void main() {
          vColor = color; vAlpha = alpha; vRot = rot;
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          gl_PointSize = size * scale / -mv.z;
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: `
        uniform sampler2D map; varying vec3 vColor; varying float vAlpha; varying float vRot;
        void main() {
          vec2 p = gl_PointCoord - 0.5;
          float c = cos(vRot), s = sin(vRot);
          p = mat2(c, -s, s, c) * p + 0.5;
          vec4 t = texture2D(map, p);
          gl_FragColor = vec4(vColor * t.rgb, t.a * vAlpha);
          if (gl_FragColor.a < 0.01) discard;
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }`,
      transparent: true, depthWrite: false, blending,
    });
    this.points = new THREE.Points(geo, this.material);
    this.points.frustumCulled = false;
    this.points.renderOrder = 10;
    scene.add(this.points);
  }
  spawn(p) {
    if (this.data.length >= this.cap) this.data.shift();
    this.data.push(p);
  }
  update(dt) {
    const d = this.data;
    for (let k = d.length - 1; k >= 0; k--) {
      const p = d[k];
      p.age += dt;
      if (p.age >= p.life) { d.splice(k, 1); continue; }
      p.vy += p.gravity * dt;
      const drag = Math.exp(-p.drag * dt);
      p.vx *= drag; p.vy *= drag; p.vz *= drag;
      p.x += p.vx * dt; p.y += p.vy * dt; p.z += p.vz * dt;
      p.r += p.spin * dt;
    }
    for (let k = 0; k < d.length; k++) {
      const p = d[k], t = p.age / p.life;
      this.pos[k * 3] = p.x; this.pos[k * 3 + 1] = p.y; this.pos[k * 3 + 2] = p.z;
      this.col[k * 3] = p.color.r; this.col[k * 3 + 1] = p.color.g; this.col[k * 3 + 2] = p.color.b;
      this.size[k] = p.size * (p.grow ? 0.4 + t : 1 - t * 0.6);
      this.alpha[k] = t < 0.1 ? t / 0.1 : 1 - Math.max(0, (t - 0.55) / 0.45);
      this.rot[k] = p.r;
    }
    const geo = this.points.geometry;
    geo.setDrawRange(0, d.length);
    for (const name of ['position', 'color', 'size', 'alpha', 'rot']) geo.attributes[name].needsUpdate = true;
  }
}

export class FX {
  constructor(scene, board) {
    this.scene = scene;
    this.root = board;
    this.glow = new ParticleLayer(board, TEX.spark(), THREE.AdditiveBlending);
    this.solid = new ParticleLayer(board, TEX.chunk(), THREE.NormalBlending);
    this.items = [];
    this.beamTex = spriteTexture(ctx => {
      const g = ctx.createLinearGradient(0, 0, 0, 64);
      g.addColorStop(0, 'rgba(255,255,255,0)'); g.addColorStop(0.35, 'rgba(255,255,255,0.65)');
      g.addColorStop(0.5, 'rgba(255,255,255,1)'); g.addColorStop(0.65, 'rgba(255,255,255,0.65)'); g.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = g; ctx.fillRect(0, 0, 64, 64);
    });
    this.ringTex = spriteTexture(ctx => {
      const g = ctx.createRadialGradient(32, 32, 18, 32, 32, 32);
      g.addColorStop(0, 'rgba(255,255,255,0)'); g.addColorStop(0.6, 'rgba(255,255,255,0.9)'); g.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = g; ctx.fillRect(0, 0, 64, 64);
    });
    this.hammerModel = makeHammer();
  }
  setScale(px) { this.glow.material.uniforms.scale.value = px; this.solid.material.uniforms.scale.value = px; }
  setRoot(board) {
    // 粒子层跟随当前棋盘
    board.add(this.glow.points, this.solid.points);
    this.root = board;
  }

  burst(pos, color, { count = 14, speed = 3.2, size = 0.22, life = 0.7, solid = 8 } = {}) {
    const c = new THREE.Color(color);
    const light = c.clone().lerp(new THREE.Color(0xffffff), 0.6);
    for (let k = 0; k < count; k++) {
      const a = Math.random() * Math.PI * 2, s = speed * (0.4 + Math.random() * 0.8);
      this.glow.spawn({ x: pos.x, y: pos.y, z: pos.z + 0.3, vx: Math.cos(a) * s, vy: Math.sin(a) * s, vz: Math.random() * 2, gravity: -3, drag: 2.5,
        size: size * (0.6 + Math.random() * 0.8), life: life * (0.6 + Math.random() * 0.6), age: 0, color: light, r: Math.random() * 3, spin: 2 });
    }
    for (let k = 0; k < solid; k++) {
      const a = Math.random() * Math.PI * 2, s = speed * (0.5 + Math.random());
      this.solid.spawn({ x: pos.x, y: pos.y, z: pos.z + 0.4, vx: Math.cos(a) * s, vy: Math.sin(a) * s + 2, vz: 1 + Math.random() * 2, gravity: -11, drag: 0.8,
        size: 0.16 + Math.random() * 0.12, life: 0.8 + Math.random() * 0.4, age: 0, color: Math.random() > 0.3 ? c : light, r: Math.random() * 6, spin: (Math.random() - 0.5) * 12 });
    }
  }
  debris(pos, color, count = 10, size = 0.2) {
    const c = new THREE.Color(color);
    for (let k = 0; k < count; k++) {
      const a = Math.random() * Math.PI * 2, s = 2 + Math.random() * 3;
      this.solid.spawn({ x: pos.x + (Math.random() - 0.5) * 0.6, y: pos.y + (Math.random() - 0.5) * 0.6, z: pos.z + 0.5, vx: Math.cos(a) * s, vy: Math.sin(a) * s + 3, vz: 1 + Math.random() * 3,
        gravity: -14, drag: 0.5, size: size * (0.6 + Math.random() * 0.8), life: 0.9 + Math.random() * 0.4, age: 0,
        color: c.clone().multiplyScalar(0.8 + Math.random() * 0.4), r: Math.random() * 6, spin: (Math.random() - 0.5) * 14 });
    }
  }
  twinkle(pos, color, count = 6, spread = 0.5) {
    const c = new THREE.Color(color).lerp(new THREE.Color(0xffffff), 0.5);
    for (let k = 0; k < count; k++) {
      this.glow.spawn({ x: pos.x + (Math.random() - 0.5) * spread, y: pos.y + (Math.random() - 0.5) * spread, z: pos.z + 0.6, vx: 0, vy: 0.6, vz: 0,
        gravity: 0, drag: 1, size: 0.25 + Math.random() * 0.2, life: 0.6 + Math.random() * 0.5, age: 0, color: c, r: 0, spin: 1.5, grow: true });
    }
  }

  // 整行 / 整列光束
  beam(pos, dir, color, length) {
    const g = new THREE.Group();
    for (const [w, c, o] of [[0.95, color, 1], [0.34, 0xffffff, 1]]) {
      const m = new THREE.Mesh(new THREE.PlaneGeometry(1, w), new THREE.MeshBasicMaterial({ map: this.beamTex, color: c, transparent: true, depthWrite: false, opacity: o }));
      g.add(m);
    }
    g.position.set(dir === 'row' ? 0 : pos.x, dir === 'row' ? pos.y : 0, 0.9);
    if (dir === 'col') g.rotation.z = Math.PI / 2;
    g.scale.set(0.01, 1, 1);
    this.root.add(g);
    this.items.push({ obj: g, age: 0, life: 0.6, update: (t) => {
      g.scale.x = length * Math.min(1, t / 0.22);
      g.scale.y = t < 0.4 ? 1 : 1 - (t - 0.4) / 0.6;
      g.children.forEach(m => { m.material.opacity = t < 0.45 ? 1 : 1 - (t - 0.45) / 0.55; });
    } });
    const c = new THREE.Color(color).lerp(new THREE.Color(0xffffff), 0.4);
    for (let k = -length / 2; k <= length / 2; k += 0.5) {
      const x = dir === 'row' ? k : pos.x, y = dir === 'row' ? pos.y : k;
      this.glow.spawn({ x, y, z: 1, vx: (Math.random() - 0.5) * 2, vy: (Math.random() - 0.5) * 2, vz: 0, gravity: 0, drag: 2,
        size: 0.3, life: 0.5, age: 0, color: c, r: 0, spin: 3 });
    }
  }
  ring(pos, color, radius = 1.5, life = 0.5) {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), new THREE.MeshBasicMaterial({ map: this.ringTex, color, transparent: true, depthWrite: false }));
    m.position.set(pos.x, pos.y, 1);
    this.root.add(m);
    this.items.push({ obj: m, age: 0, life, update: t => {
      m.scale.setScalar(0.2 + radius * (1 - (1 - t) ** 3));
      m.material.opacity = 1 - t;
    } });
  }
  arc(from, to, color, life = 0.55) {
    const dir = new THREE.Vector3().subVectors(to, from);
    const len = dir.length();
    const g = new THREE.Group();
    const mat = new THREE.MeshBasicMaterial({ map: this.beamTex, color, transparent: true, depthWrite: false });
    // 由多段折线组成的闪电
    const segs = 6, pts = [];
    for (let k = 0; k <= segs; k++) pts.push(new THREE.Vector3().lerpVectors(from, to, k / segs).add(new THREE.Vector3((Math.random() - 0.5) * 0.25, (Math.random() - 0.5) * 0.25, 0).multiplyScalar(k && k < segs ? 1 : 0)));
    for (let k = 0; k < segs; k++) {
      const a = pts[k], b = pts[k + 1];
      const seg = new THREE.Mesh(new THREE.PlaneGeometry(1, 0.22), mat);
      seg.position.set((a.x + b.x) / 2, (a.y + b.y) / 2, 1.1);
      seg.scale.x = a.distanceTo(b) + 0.05;
      seg.rotation.z = Math.atan2(b.y - a.y, b.x - a.x);
      g.add(seg);
    }
    this.root.add(g);
    this.items.push({ obj: g, age: 0, life, update: t => { mat.opacity = t < 0.2 ? t / 0.2 : 1 - (t - 0.2) / 0.8; } });
    return len;
  }
  flash(color = 0xffffff, life = 0.6, size = 14) {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(size, size), new THREE.MeshBasicMaterial({ color, transparent: true, depthWrite: false }));
    m.position.z = 1.4;
    this.root.add(m);
    this.items.push({ obj: m, age: 0, life, update: t => { m.material.opacity = 0.8 * (1 - t); } });
  }
  hammer(pos, onImpact) {
    const h = this.hammerModel.clone();
    h.position.set(pos.x + 0.55, pos.y - 0.3, 1.2);
    h.scale.setScalar(0.85);
    this.root.add(h);
    let hit = false;
    this.items.push({ obj: h, age: 0, life: 0.6, keep: true, update: t => {
      const swing = t < 0.45 ? t / 0.45 : 1;
      h.rotation.z = 1.3 - swing ** 2 * 1.9;
      if (swing >= 1 && !hit) { hit = true; onImpact?.(); }
      h.traverse(o => { if (o.material) { o.material.transparent = true; o.material.opacity = t > 0.75 ? 1 - (t - 0.75) / 0.25 : 1; } });
    } });
  }

  update(dt) {
    this.glow.update(dt);
    this.solid.update(dt);
    for (let k = this.items.length - 1; k >= 0; k--) {
      const it = this.items[k];
      it.age += dt;
      const t = Math.min(1, it.age / it.life);
      it.update(t);
      if (t >= 1) {
        it.obj.parent?.remove(it.obj);
        if (!it.keep) it.obj.traverse(o => { o.geometry?.dispose(); o.material?.dispose(); });
        this.items.splice(k, 1);
      }
    }
  }
}
