// 三消核心逻辑：不依赖 Three.js。
// 每次操作返回一串「步骤」（交换 / 消除 / 下落 / 收集 / 洗牌 / 变身），由渲染层按顺序播放动画。
import { ENERGY_MAX, ENERGY_START, SKILLS } from './levels.js';

export function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const SCORE = { animal: 10, row: 40, col: 40, bomb: 60, rainbow: 100, obstacle: 20, acorn: 100, bonusMove: 50 };
const NEIGHBORS = [[1, 0], [-1, 0], [0, 1], [0, -1]];
const isLine = s => s === 'row' || s === 'col';

export class Game {
  constructor(level, { rng = Math.random, energy = ENERGY_START } = {}) {
    this.level = level;
    this.rng = rng;
    this.rows = level.layout.length;
    this.cols = level.layout[0].length;
    this.moves = level.moves;
    this.score = 0;
    this.energy = energy;
    this.status = 'playing';
    this.nextId = 1;
    this.charge = true;
    this.cells = [];
    const fixed = new Set();
    let acornsOnBoard = 0;
    level.layout.forEach((line, r) => [...line].forEach((ch, c) => {
      const cell = { r, c, i: r * this.cols + c, void: ch === '.', ice: 0, crate: 0, vine: false, piece: null };
      if (ch === '1' || ch === 'w') cell.ice = 1;
      if (ch === '2') cell.ice = 2;
      if (ch === 'c') cell.crate = 1;
      if (ch === 'C') cell.crate = 2;
      if (ch === 'v' || ch === 'w') cell.vine = true;
      if (ch === 'a') { cell.piece = this.newPiece(-1, 'acorn'); fixed.add(cell.i); acornsOnBoard++; }
      this.cells.push(cell);
    }));
    const total = key => this.cells.reduce((sum, cell) => sum + (key === 'vine' ? +cell.vine : cell[key]), 0);
    this.goals = level.goals.map(goal => ({
      ...goal, current: 0,
      target: goal.target ?? (goal.kind === 'ice' ? total('ice') : goal.kind === 'crate' ? total('crate') : goal.kind === 'vine' ? total('vine') : 0),
    }));
    const acornGoal = this.goals.find(g => g.kind === 'acorn');
    this.acornsPending = acornGoal ? Math.max(0, acornGoal.target - acornsOnBoard) : 0;
    this.exits = new Set();
    for (let c = 0; c < this.cols; c++) {
      for (let r = this.rows - 1; r >= 0; r--) if (!this.cell(r, c).void) { this.exits.add(r * this.cols + c); break; }
    }
    this.fillInitial(fixed);
  }

  // ---------- 基础查询 ----------
  cell(r, c) { return r >= 0 && r < this.rows && c >= 0 && c < this.cols ? this.cells[r * this.cols + c] : null; }
  newPiece(type, kind = 'animal', special = null) { return { id: this.nextId++, kind, type, special }; }
  typeAt(cell) { return cell && !cell.void && !cell.crate && cell.piece?.kind === 'animal' ? cell.piece.type : -1; }
  swappable(cell) { return !!(cell && !cell.void && !cell.crate && cell.piece && !cell.vine); }
  emptyTarget(cell) { return !!(cell && !cell.void && !cell.crate && !cell.piece); }
  above(cell) {
    for (let r = cell.r - 1; r >= 0; r--) { const up = this.cell(r, cell.c); if (!up.void) return up; }
    return null;
  }
  below(cell) {
    for (let r = cell.r + 1; r < this.rows; r++) { const down = this.cell(r, cell.c); if (!down.void) return down; }
    return null;
  }
  randomType() { return Math.floor(this.rng() * this.level.types); }
  goalsMet() { return this.goals.every(g => g.current >= g.target); }
  goal(kind, type) {
    for (const g of this.goals) if (g.kind === kind && (kind !== 'collect' || g.type === type)) g.current++;
  }

  // ---------- 初始棋盘 ----------
  fillInitial(fixed) {
    for (let attempt = 0; attempt < 200; attempt++) {
      for (const cell of this.cells) {
        if (cell.void || cell.crate || fixed.has(cell.i)) continue;
        const banned = new Set();
        const l1 = this.cell(cell.r, cell.c - 1), l2 = this.cell(cell.r, cell.c - 2);
        const u1 = this.cell(cell.r - 1, cell.c), u2 = this.cell(cell.r - 2, cell.c);
        if (this.typeAt(l1) >= 0 && this.typeAt(l1) === this.typeAt(l2)) banned.add(this.typeAt(l1));
        if (this.typeAt(u1) >= 0 && this.typeAt(u1) === this.typeAt(u2)) banned.add(this.typeAt(u1));
        let type;
        do { type = this.randomType(); } while (banned.has(type));
        cell.piece = this.newPiece(type);
      }
      if (!this.findGroups().length && this.hasMove()) return;
    }
  }

  // ---------- 匹配 ----------
  findGroups() {
    const runs = [];
    const scan = (outer, inner, at, dir) => {
      for (let a = 0; a < outer; a++) {
        let b = 0;
        while (b < inner) {
          const t = this.typeAt(at(a, b));
          if (t < 0) { b++; continue; }
          let e = b + 1;
          while (e < inner && this.typeAt(at(a, e)) === t) e++;
          if (e - b >= 3) runs.push({ dir, type: t, cells: Array.from({ length: e - b }, (_, k) => at(a, b + k).i) });
          b = e;
        }
      }
    };
    scan(this.rows, this.cols, (r, c) => this.cell(r, c), 'h');
    scan(this.cols, this.rows, (c, r) => this.cell(r, c), 'v');
    // 共享格子的线段合并为一组（L / T / 十字）
    const parent = runs.map((_, k) => k);
    const find = k => (parent[k] === k ? k : (parent[k] = find(parent[k])));
    const owner = new Map();
    runs.forEach((run, k) => run.cells.forEach(i => {
      if (owner.has(i)) parent[find(k)] = find(owner.get(i)); else owner.set(i, k);
    }));
    const groups = new Map();
    runs.forEach((run, k) => {
      const root = find(k);
      if (!groups.has(root)) groups.set(root, { type: run.type, cells: new Set(), runs: [] });
      const g = groups.get(root);
      g.runs.push(run);
      run.cells.forEach(i => g.cells.add(i));
    });
    return [...groups.values()];
  }

  matchAt(cell) {
    const t = this.typeAt(cell);
    if (t < 0) return 0;
    const count = (dr, dc) => { let n = 0, r = cell.r + dr, c = cell.c + dc; while (this.typeAt(this.cell(r, c)) === t) { n++; r += dr; c += dc; } return n; };
    const h = 1 + count(0, -1) + count(0, 1), v = 1 + count(-1, 0) + count(1, 0);
    return Math.max(h >= 3 ? h : 0, v >= 3 ? v : 0) + (h >= 3 && v >= 3 ? 2 : 0);
  }

  // 返回所有有效交换，value 粗略衡量这一步的价值（用于提示）
  findMoves(limit = Infinity) {
    const moves = [];
    for (const a of this.cells) {
      for (const [dr, dc] of [[0, 1], [1, 0]]) {
        const b = this.cell(a.r + dr, a.c + dc);
        if (!this.swappable(a) || !this.swappable(b)) continue;
        const pa = a.piece, pb = b.piece;
        let value = 0;
        if ((pa.kind === 'rainbow' && pb.kind !== 'acorn') || (pb.kind === 'rainbow' && pa.kind !== 'acorn')) value = 12;
        else if (pa.special && pb.special) value = 10;
        else {
          a.piece = pb; b.piece = pa;
          const m = Math.max(this.matchAt(a), this.matchAt(b));
          a.piece = pa; b.piece = pb;
          if (m) value = m + (pa.special || pb.special ? 3 : 0);
        }
        if (value) {
          moves.push({ a: [a.r, a.c], b: [b.r, b.c], value });
          if (moves.length >= limit) return moves;
        }
      }
    }
    return moves;
  }
  hasMove() { return this.findMoves(1).length > 0; }
  hint() {
    const moves = this.findMoves();
    if (!moves.length) return null;
    const best = Math.max(...moves.map(m => m.value));
    const top = moves.filter(m => m.value === best);
    return top[Math.floor(this.rng() * top.length)];
  }

  // ---------- 一次消除（一个连锁层级） ----------
  beginClear(combo) {
    this.clr = { type: 'clear', combo, hits: [], created: [], effects: [], obstacles: [], popups: [], converts: [], score: 0, duration: 0 };
    this.queue = [];
  }
  bump(delay) { this.clr.duration = Math.max(this.clr.duration, delay); }
  addScore(points, popup) { this.score += points; this.clr.score += points; if (popup) popup.amount += points; }
  popup(i, delay = 0) { const p = { i, amount: 0, delay }; this.clr.popups.push(p); return p; }

  damageObstacle(cell, kind, delay, popup, all = false) {
    const before = kind === 'vine' ? +cell.vine : cell[kind];
    const layers = all ? before : 1;
    for (let k = 0; k < layers; k++) { this.goal(kind); this.addScore(SCORE.obstacle, popup); }
    if (kind === 'vine') cell.vine = false; else cell[kind] -= layers;
    this.clr.obstacles.push({ i: cell.i, kind, layers, left: kind === 'vine' ? 0 : cell[kind], delay });
    this.bump(delay);
  }

  // 打击一格：木箱 → 藤蔓 → 动物 → 冰层
  hit(i, delay, { into = null, popup = null, force = false } = {}) {
    const cell = this.cells[i];
    if (!cell || cell.void) return;
    if (cell.crate) { this.damageObstacle(cell, 'crate', delay, popup, force); return; }
    const p = cell.piece;
    if (p?.fresh) return;
    if (p && cell.vine) {
      this.damageObstacle(cell, 'vine', delay, popup);
      if (!force) return;
    }
    if (p && p.kind === 'acorn') return;
    if (p) {
      cell.piece = null;
      this.clr.hits.push({ id: p.id, i, delay, into });
      this.bump(delay);
      if (p.kind === 'animal') {
        this.addScore(SCORE.animal * this.clr.combo, popup);
        this.goal('collect', p.type);
        if (this.charge) this.energy = Math.min(ENERGY_MAX, this.energy + 1);
      }
      if (p.special || p.kind === 'rainbow') this.queue.push({ piece: p, i, delay: delay + 0.12 });
    }
    if (cell.ice) this.damageObstacle(cell, 'ice', delay, popup, force);
  }

  lineCells(cell, dir) {
    const out = [];
    const n = dir === 'row' ? this.cols : this.rows;
    for (let k = 0; k < n; k++) {
      const other = dir === 'row' ? this.cell(cell.r, k) : this.cell(k, cell.c);
      out.push({ i: other.i, dist: Math.abs(k - (dir === 'row' ? cell.c : cell.r)) });
    }
    return out;
  }
  areaCells(cell, radius, tips = false) {
    const out = [];
    for (let dr = -radius - 1; dr <= radius + 1; dr++) for (let dc = -radius - 1; dc <= radius + 1; dc++) {
      const inSquare = Math.abs(dr) <= radius && Math.abs(dc) <= radius;
      const tip = tips && (dr === 0 || dc === 0) && Math.abs(dr + dc) === radius + 1;
      const other = this.cell(cell.r + dr, cell.c + dc);
      if (other && (inSquare || tip)) out.push({ i: other.i, dist: Math.max(Math.abs(dr), Math.abs(dc)) });
    }
    return out;
  }
  mostCommonType() {
    const counts = Array(this.level.types).fill(0);
    for (const cell of this.cells) { const t = this.typeAt(cell); if (t >= 0 && !cell.piece.fresh) counts[t]++; }
    return counts.indexOf(Math.max(...counts));
  }

  fireLine(cell, dir, delay, popup) {
    this.clr.effects.push({ kind: dir, i: cell.i, delay });
    for (const { i, dist } of this.lineCells(cell, dir)) if (i !== cell.i) this.hit(i, delay + dist * 0.035, { popup });
  }
  fireArea(cell, radius, delay, popup, tips = true) {
    this.clr.effects.push({ kind: 'bomb', i: cell.i, delay, radius });
    for (const { i, dist } of this.areaCells(cell, radius, tips)) if (i !== cell.i) this.hit(i, delay + 0.05 + dist * 0.04, { popup });
  }
  fireRainbow(cell, type, delay, popup) {
    const targets = this.cells.filter(other => this.typeAt(other) === type && !other.piece.fresh).map(other => other.i);
    this.clr.effects.push({ kind: 'rainbow', i: cell.i, delay, targets, type });
    targets.forEach((i, k) => this.hit(i, delay + 0.3 + k * 0.025, { popup }));
  }

  processQueue() {
    let guard = 0;
    while (this.queue.length && guard++ < 500) {
      const { piece, i, delay } = this.queue.shift();
      const cell = this.cells[i];
      const popup = this.popup(i, delay);
      if (piece.kind === 'rainbow') this.fireRainbow(cell, this.mostCommonType(), delay, popup);
      else if (isLine(piece.special)) this.fireLine(cell, piece.special, delay, popup);
      else if (piece.special === 'bomb') this.fireArea(cell, 1, delay, popup);
    }
  }

  endClear() {
    for (const cell of this.cells) if (cell.piece) delete cell.piece.fresh;
    const step = this.clr;
    step.popups = step.popups.filter(p => p.amount > 0);
    step.duration += 0.32;
    this.clr = null;
    return step;
  }

  groupSpecial(group, prefer) {
    const maxRun = Math.max(...group.runs.map(r => r.cells.length));
    const hasH = group.runs.some(r => r.dir === 'h'), hasV = group.runs.some(r => r.dir === 'v');
    let special = null;
    if (maxRun >= 5) special = 'rainbow';
    else if (hasH && hasV) special = 'bomb';
    else if (maxRun === 4) special = group.runs[0].dir === 'h' ? 'col' : 'row';
    if (!special) return { special: null, anchor: null };
    const free = i => !this.cells[i].vine;
    let anchor = (prefer || []).find(i => group.cells.has(i) && free(i));
    if (anchor === undefined && special === 'bomb') {
      const counts = new Map();
      group.runs.forEach(run => run.cells.forEach(i => counts.set(i, (counts.get(i) || 0) + 1)));
      anchor = [...counts].find(([i, n]) => n > 1 && free(i))?.[0];
    }
    if (anchor === undefined) {
      const longest = group.runs.reduce((a, b) => (b.cells.length > a.cells.length ? b : a));
      anchor = longest.cells.slice(1, -1).find(free) ?? longest.cells.find(free);
    }
    return anchor === undefined ? { special: null, anchor: null } : { special, anchor };
  }

  clearGroups(groups, combo, prefer) {
    this.beginClear(combo);
    const crateHits = new Set();
    for (const group of groups) {
      const { special, anchor } = this.groupSpecial(group, prefer);
      const center = anchor ?? [...group.cells][Math.floor(group.cells.size / 2)];
      const popup = this.popup(center);
      for (const i of group.cells) this.hit(i, 0, { into: special ? anchor : null, popup });
      if (special && !this.cells[anchor].piece) {
        const piece = special === 'rainbow' ? this.newPiece(-1, 'rainbow') : this.newPiece(group.type, 'animal', special);
        piece.fresh = true;
        this.cells[anchor].piece = piece;
        this.clr.created.push({ i: anchor, piece: snapshotPiece(piece), delay: 0.2 });
        this.addScore(SCORE[special], popup);
        this.bump(0.2);
      }
      // 相邻的木箱受到一次震击
      for (const i of group.cells) {
        const cell = this.cells[i];
        for (const [dr, dc] of NEIGHBORS) {
          const n = this.cell(cell.r + dr, cell.c + dc);
          if (n && n.crate && !crateHits.has(n.i)) { crateHits.add(n.i); this.damageObstacle(n, 'crate', 0.05, popup); }
        }
      }
    }
    this.processQueue();
    return this.endClear();
  }

  // ---------- 重力与补充 ----------
  canFillFromAbove(cell) {
    let cur = cell;
    for (;;) {
      const up = this.above(cur);
      if (!up) return true;
      if (up.crate || (up.piece && up.vine)) return false;
      if (up.piece) return true;
      cur = up;
    }
  }
  spawnPiece() {
    const onBoard = this.cells.filter(c => c.piece?.kind === 'acorn').length;
    if (this.acornsPending > 0 && onBoard < (this.level.acornMax || 1)) {
      this.acornsPending--;
      return this.newPiece(-1, 'acorn');
    }
    return this.newPiece(this.randomType());
  }
  gravity() {
    const moves = new Map();
    const track = (piece, from, to, tick) => {
      let m = moves.get(piece.id);
      if (!m) { m = { id: piece.id, path: [{ t: tick - 1, r: from.r, c: from.c }] }; moves.set(piece.id, m); }
      const last = m.path[m.path.length - 1];
      if (last.t < tick - 1) m.path.push({ t: tick - 1, r: last.r, c: last.c });
      m.path.push({ t: tick, r: to.r, c: to.c });
    };
    let tick = 0;
    for (tick = 1; tick < 400; tick++) {
      let moved = false;
      const stamp = new Set();
      for (let c = 0; c < this.cols; c++) for (let r = this.rows - 1; r >= 0; r--) {
        const cell = this.cell(r, c);
        if (!this.emptyTarget(cell)) continue;
        const up = this.above(cell);
        if (!up) {
          const piece = this.spawnPiece();
          cell.piece = piece; stamp.add(piece.id);
          track(piece, { r: r - 1, c }, cell, tick);
          moves.get(piece.id).spawn = snapshotPiece(piece);
          moved = true;
        } else if (up.piece && !up.vine && !up.crate && !stamp.has(up.piece.id)) {
          const piece = up.piece;
          up.piece = null; cell.piece = piece; stamp.add(piece.id);
          track(piece, up, cell, tick);
          moved = true;
        }
      }
      // 竖直方向被挡住时，从斜上方滑入
      const order = tick % 2 ? [-1, 1] : [1, -1];
      for (let r = this.rows - 1; r >= 0; r--) for (let c = 0; c < this.cols; c++) {
        const cell = this.cell(r, c);
        if (!this.emptyTarget(cell) || this.canFillFromAbove(cell)) continue;
        for (const dc of order) {
          const src = this.cell(r - 1, c + dc);
          if (!src || src.void || src.crate || src.vine || !src.piece || stamp.has(src.piece.id)) continue;
          if (this.emptyTarget(this.below(src))) continue;
          const piece = src.piece;
          src.piece = null; cell.piece = piece; stamp.add(piece.id);
          track(piece, src, cell, tick);
          moved = true;
          break;
        }
      }
      if (!moved) break;
    }
    return { type: 'fall', moves: [...moves.values()], ticks: tick - 1 };
  }

  collectAcorns() {
    const items = [];
    for (const i of this.exits) {
      const cell = this.cells[i];
      if (cell.piece?.kind === 'acorn') {
        items.push({ id: cell.piece.id, i });
        cell.piece = null;
        this.goal('acorn');
        this.score += SCORE.acorn;
      }
    }
    return { type: 'collect', items, score: items.length * SCORE.acorn };
  }

  settle(steps, combo) {
    for (let guard = 0; guard < 60; guard++) {
      const fall = this.gravity();
      if (fall.moves.length) steps.push(fall);
      const collect = this.collectAcorns();
      if (collect.items.length) { steps.push(collect); continue; }
      const groups = this.findGroups();
      if (!groups.length) break;
      steps.push(this.clearGroups(groups, combo++, null));
    }
    return combo;
  }

  afterMove(steps) {
    if (this.goalsMet()) this.status = 'won';
    else if (this.moves <= 0) this.status = 'lost';
    else if (!this.hasMove()) steps.push(this.shuffle());
  }

  // ---------- 玩家操作 ----------
  trySwap(from, to) {
    const a = this.cell(...from), b = this.cell(...to);
    if (this.status !== 'playing' || !a || !b || Math.abs(a.r - b.r) + Math.abs(a.c - b.c) !== 1) return { valid: false, steps: [], reason: 'far' };
    if (!this.swappable(a) || !this.swappable(b)) return { valid: false, steps: [], reason: 'locked' };
    const pa = a.piece, pb = b.piece;
    const steps = [{ type: 'swap', a: from, b: to, ids: [pa.id, pb.id] }];
    a.piece = pb; b.piece = pa;
    this.charge = true;
    const rainbowCombo = (pa.kind === 'rainbow' && pb.kind !== 'acorn') || (pb.kind === 'rainbow' && pa.kind !== 'acorn');
    if (rainbowCombo || (pa.special && pb.special)) {
      this.moves--;
      steps.push(this.comboClear(pa, pb, b, a));
      this.settle(steps, 2);
    } else {
      const groups = this.findGroups();
      if (!groups.length) {
        a.piece = pa; b.piece = pb;
        steps.push({ type: 'swap', a: to, b: from, ids: [pa.id, pb.id], back: true });
        return { valid: false, steps, reason: 'nomatch' };
      }
      this.moves--;
      steps.push(this.clearGroups(groups, 1, [b.i, a.i]));
      this.settle(steps, 2);
    }
    this.afterMove(steps);
    return { valid: true, steps };
  }

  // 两个特效交换：pa 被拖到 target 格，pb 在 origin 格
  comboClear(pa, pb, target, origin) {
    this.beginClear(1);
    const popup = this.popup(target.i);
    const remove = (cell, piece, delay = 0) => {
      if (cell.piece === piece) { cell.piece = null; this.clr.hits.push({ id: piece.id, i: cell.i, delay, into: target.i }); }
    };
    if (pa.kind === 'rainbow' && pb.kind === 'rainbow') {
      remove(origin, pb); remove(target, pa);
      this.clr.effects.push({ kind: 'board', i: target.i, delay: 0 });
      for (const cell of this.cells) {
        const dist = Math.abs(cell.r - target.r) + Math.abs(cell.c - target.c);
        this.hit(cell.i, 0.15 + dist * 0.04, { popup });
      }
    } else if (pa.kind === 'rainbow' || pb.kind === 'rainbow') {
      const rainbow = pa.kind === 'rainbow' ? pa : pb;
      const other = rainbow === pa ? pb : pa;
      remove(rainbow === pa ? target : origin, rainbow);
      if (other.special) {
        const targets = this.cells.filter(cell => this.typeAt(cell) === other.type && !cell.vine);
        this.clr.effects.push({ kind: 'rainbow', i: target.i, delay: 0, targets: targets.map(t => t.i), type: other.type });
        targets.forEach((cell, k) => {
          const special = other.special === 'bomb' ? 'bomb' : (this.rng() < 0.5 ? 'row' : 'col');
          if (cell.piece !== other) cell.piece.special = special;
          this.clr.converts.push({ id: cell.piece.id, special: cell.piece.special, delay: 0.3 + k * 0.03 });
        });
        targets.forEach((cell, k) => this.hit(cell.i, 0.9 + k * 0.1, { popup }));
      } else {
        this.fireRainbow(target, other.type, 0, popup);
      }
    } else {
      // 两个特效
      remove(origin, pb); remove(target, pa, 0);
      const specials = [pa.special, pb.special];
      if (specials.every(isLine)) {
        this.fireLine(target, 'row', 0.1, popup);
        this.fireLine(target, 'col', 0.1, popup);
      } else if (specials.every(s => s === 'bomb')) {
        this.fireArea(target, 2, 0.1, popup);
      } else {
        for (const d of [-1, 0, 1]) {
          const row = this.cell(target.r + d, target.c), col = this.cell(target.r, target.c + d);
          if (row) this.fireLine(row, 'row', 0.1 + Math.abs(d) * 0.08, popup);
          if (col) this.fireLine(col, 'col', 0.1 + Math.abs(d) * 0.08, popup);
        }
      }
    }
    this.processQueue();
    return this.endClear();
  }

  useSkill(kind, r, c) {
    const skill = SKILLS[kind];
    const cell = this.cell(r, c);
    if (this.status !== 'playing' || !skill || this.energy < skill.cost) return { ok: false, steps: [] };
    if (kind !== 'shuffle' && (!cell || cell.void)) return { ok: false, steps: [] };
    if (kind === 'rainbow' && this.typeAt(cell) < 0) return { ok: false, steps: [] };
    this.energy -= skill.cost;
    const steps = [];
    this.charge = false;
    if (kind === 'shuffle') steps.push(this.shuffle());
    else {
      this.beginClear(1);
      const popup = this.popup(cell.i);
      if (kind === 'hammer') {
        this.clr.effects.push({ kind: 'hammer', i: cell.i, delay: 0 });
        this.hit(cell.i, 0.25, { popup, force: true });
      } else if (kind === 'bomb') {
        this.clr.effects.push({ kind: 'bomb', i: cell.i, delay: 0, radius: 1 });
        for (const { i, dist } of this.areaCells(cell, 1)) this.hit(i, 0.05 + dist * 0.05, { popup });
      } else {
        this.fireRainbow(cell, this.typeAt(cell), 0, popup);
      }
      this.processQueue();
      steps.push(this.endClear());
      this.settle(steps, 2);
    }
    this.charge = true;
    this.afterMove(steps);
    return { ok: true, steps };
  }

  shuffle() {
    const cells = this.cells.filter(cell => this.swappable(cell) && cell.piece.kind === 'animal');
    const pieces = cells.map(cell => cell.piece);
    for (let attempt = 0; attempt < 300; attempt++) {
      for (let k = pieces.length - 1; k > 0; k--) {
        const j = Math.floor(this.rng() * (k + 1));
        [pieces[k], pieces[j]] = [pieces[j], pieces[k]];
      }
      cells.forEach((cell, k) => { cell.piece = pieces[k]; });
      if (!this.findGroups().length && this.hasMove()) break;
      if (attempt % 50 === 49) for (const p of pieces) if (!p.special) p.type = this.randomType();
    }
    return { type: 'shuffle', moves: cells.map(cell => ({ id: cell.piece.id, r: cell.r, c: cell.c, piece: snapshotPiece(cell.piece) })) };
  }

  // 过关后剩余步数变成疾风动物并全部引爆
  finale() {
    const steps = [];
    if (this.status !== 'won') return steps;
    this.charge = false;
    const candidates = this.cells.filter(cell => this.typeAt(cell) >= 0 && !cell.piece.special && !cell.vine);
    for (let k = candidates.length - 1; k > 0; k--) {
      const j = Math.floor(this.rng() * (k + 1));
      [candidates[k], candidates[j]] = [candidates[j], candidates[k]];
    }
    const count = Math.min(this.moves, candidates.length);
    const items = candidates.slice(0, count).map((cell, k) => {
      cell.piece.special = this.rng() < 0.5 ? 'row' : 'col';
      return { id: cell.piece.id, i: cell.i, special: cell.piece.special, delay: k * 0.1 };
    });
    const bonus = this.moves * SCORE.bonusMove;
    this.score += bonus;
    this.moves = 0;
    if (items.length) steps.push({ type: 'convert', items, score: bonus });
    let combo = 1;
    for (let round = 0; round < 8; round++) {
      const specials = this.cells.filter(cell => cell.piece && (cell.piece.special || cell.piece.kind === 'rainbow') && !cell.vine && !cell.crate);
      if (!specials.length) break;
      this.beginClear(combo);
      specials.forEach((cell, k) => this.hit(cell.i, k * 0.12));
      this.processQueue();
      steps.push(this.endClear());
      combo = this.settle(steps, combo + 1);
    }
    this.charge = true;
    return steps;
  }

  snapshot() {
    return this.cells.map(cell => ({ ...cell, piece: cell.piece ? snapshotPiece(cell.piece) : null }));
  }

  clone() {
    const copy = Object.create(Game.prototype);
    Object.assign(copy, this);
    copy.cells = this.cells.map(cell => ({ ...cell, piece: cell.piece ? { ...cell.piece } : null }));
    copy.goals = this.goals.map(g => ({ ...g }));
    copy.exits = new Set(this.exits);
    return copy;
  }
}

export function snapshotPiece(p) { return { id: p.id, kind: p.kind, type: p.type, special: p.special }; }
