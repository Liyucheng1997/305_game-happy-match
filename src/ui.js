// HUD 与各种界面（关卡地图、开场横幅、结算、浮动文字）
import { LEVELS, ANIMALS, SKILLS, ENERGY_MAX } from './levels.js';

const $ = id => document.getElementById(id);

export function goalIcon(goal, icons) {
  if (goal.kind === 'collect') return icons[`animal${goal.type}`];
  return icons[goal.kind] ?? null;
}
export function goalLabel(goal) {
  return { collect: ANIMALS[goal.type]?.name, ice: '冰块', crate: '木箱', vine: '藤蔓', acorn: '橡果', score: '分数' }[goal.kind];
}

function goalChip(goal, icons) {
  const el = document.createElement('div');
  el.className = 'goal';
  const src = goalIcon(goal, icons);
  if (src) {
    const img = document.createElement('img');
    img.src = src;
    img.alt = goalLabel(goal);
    el.append(img);
  } else {
    const span = document.createElement('span');
    span.className = 'ico-text';
    span.textContent = '⭐';
    el.append(span);
  }
  el.append(document.createElement('b'));
  el.title = goalLabel(goal);
  return el;
}

export function createUI(handlers) {
  let icons = {};
  let chips = [];
  let level = null;

  $('btn-map').addEventListener('click', handlers.onMap);
  $('btn-restart').addEventListener('click', handlers.onRestart);
  $('btn-sound').addEventListener('click', handlers.onSound);
  $('map-play').addEventListener('click', () => handlers.onPlay(null));
  $('map-close').addEventListener('click', handlers.onCloseMap);
  $('result-next').addEventListener('click', handlers.onNext);
  $('result-retry').addEventListener('click', handlers.onRestart);
  $('result-map').addEventListener('click', handlers.onMap);
  for (const kind of Object.keys(SKILLS)) $(`skill-${kind}`).addEventListener('click', () => handlers.onSkill(kind));
  $('banner').addEventListener('pointerdown', () => hideBanner());

  // 关卡节点之间的虚线小路
  function drawTrail() {
    const path = $('map-path');
    path.querySelector('svg')?.remove();
    // 用 offset 坐标计算，不受卡片弹出动画的缩放影响
    const box = { width: path.clientWidth, height: path.clientHeight };
    const pts = [...path.querySelectorAll('.node')].map(n => {
      const li = n.parentElement;
      return [li.offsetLeft + n.offsetLeft + n.offsetWidth / 2, li.offsetTop + n.offsetTop + n.offsetHeight / 2];
    });
    if (pts.length < 2) return;
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('class', 'trail');
    svg.setAttribute('width', box.width);
    svg.setAttribute('height', box.height);
    let d = `M${pts[0][0]},${pts[0][1]}`;
    for (let k = 1; k < pts.length; k++) {
      const [x0, y0] = pts[k - 1], [x1, y1] = pts[k];
      d += y0 === y1 ? ` L${x1},${y1}` : ` C${x0 + (x0 > box.width / 2 ? 40 : -40)},${(y0 + y1) / 2} ${x1 + (x1 > box.width / 2 ? 40 : -40)},${(y0 + y1) / 2} ${x1},${y1}`;
    }
    const line = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    line.setAttribute('d', d);
    svg.append(line);
    path.prepend(svg);
  }
  addEventListener('resize', () => { if (!$('map').classList.contains('hidden')) drawTrail(); });

  let bannerTimer = null, bannerResolve = null;
  function hideBanner() {
    clearTimeout(bannerTimer);
    $('banner').classList.add('hidden');
    bannerResolve?.();
    bannerResolve = null;
  }

  return {
    setIcons(value) {
      icons = value;
      $('parade').replaceChildren(...ANIMALS.map((a, k) => {
        const img = document.createElement('img');
        img.src = icons[`animal${k}`];
        img.alt = '';
        img.style.animationDelay = `${k * 0.12}s`;
        return img;
      }));
    },

    setLevel(lv, goals) {
      level = lv;
      $('level-num').textContent = `第 ${lv.id} 关`;
      $('level-name').textContent = lv.name;
      chips = goals.map(g => goalChip(g, icons));
      $('goals').replaceChildren(...chips);
      const max = lv.stars[1] * 1.15;
      $('star-2').style.left = `${(lv.stars[0] / max) * 100}%`;
      $('star-3').style.left = `${(lv.stars[1] / max) * 100}%`;
    },

    update({ moves, score, goals, energy, busy, playing, activeSkill }) {
      $('moves').textContent = moves;
      $('moves').parentElement.classList.toggle('low', playing && moves <= 5);
      $('score').textContent = score;
      const max = level.stars[1] * 1.15;
      $('score-fill').style.width = `${Math.min(100, (score / max) * 100)}%`;
      $('star-2').classList.toggle('lit', score >= level.stars[0]);
      $('star-3').classList.toggle('lit', score >= level.stars[1]);
      goals.forEach((g, k) => {
        const chip = chips[k];
        if (!chip) return;
        const left = Math.max(0, g.target - g.current);
        const b = chip.querySelector('b');
        const text = left ? String(left) : '✓';
        if (b.textContent !== text && b.textContent) {
          chip.classList.remove('bump');
          void chip.offsetWidth;
          chip.classList.add('bump');
        }
        b.textContent = text;
        chip.classList.toggle('done', !left);
        chip.title = `${goalLabel(g)}：还需 ${left}`;
      });
      $('energy').textContent = energy;
      $('energy-fill').style.width = `${(energy / ENERGY_MAX) * 100}%`;
      for (const [kind, skill] of Object.entries(SKILLS)) {
        const btn = $(`skill-${kind}`);
        btn.disabled = busy || !playing || energy < skill.cost;
        btn.classList.toggle('active', activeSkill === kind);
        btn.setAttribute('aria-pressed', String(activeSkill === kind));
        btn.title = `${skill.name}（${skill.cost} 能量）：${skill.description}`;
      }
      $('btn-restart').disabled = busy;
      $('btn-map').disabled = busy;
    },

    goalElement(k) { return chips[k]; },

    status(text) { $('status').textContent = text; },

    setSound(on) { $('btn-sound').textContent = on ? '🔊' : '🔇'; },

    banner(lv, goals) {
      $('banner-num').textContent = `第 ${lv.id} 关`;
      $('banner-title').textContent = lv.name;
      $('banner-goals').replaceChildren(...goals.map(g => {
        const chip = goalChip(g, icons);
        chip.querySelector('b').textContent = g.target;
        return chip;
      }));
      $('banner-tip').textContent = lv.tip;
      $('banner').classList.remove('hidden');
      return new Promise(resolve => {
        bannerResolve = resolve;
        bannerTimer = setTimeout(hideBanner, 4200);
      });
    },
    hideBanner,

    showMap(progress, currentIndex, canClose) {
      const total = progress.stars.reduce((a, b) => a + b, 0);
      $('total-stars').textContent = total;
      $('max-stars').textContent = LEVELS.length * 3;
      $('map-path').replaceChildren(...LEVELS.map((lv, i) => {
        const li = document.createElement('li');
        const btn = document.createElement('button');
        const locked = lv.id > progress.unlocked;
        btn.className = `node${locked ? ' locked' : progress.stars[i] ? ' done' : ''}${i === progress.unlocked - 1 && !progress.stars[i] ? ' current' : ''}`;
        btn.disabled = locked;
        btn.setAttribute('aria-label', `第 ${lv.id} 关 ${lv.name}${locked ? '（未解锁）' : `，${progress.stars[i]} 星`}`);
        btn.title = `${lv.id}. ${lv.name}`;
        if (locked) btn.innerHTML = '<span class="lock">🔒</span>';
        else {
          btn.textContent = lv.id;
          const stars = document.createElement('span');
          stars.className = 'stars';
          stars.innerHTML = [0, 1, 2].map(k => `<span class="${k < progress.stars[i] ? 'on' : ''}">★</span>`).join('');
          btn.append(stars);
        }
        btn.addEventListener('click', () => handlers.onPlay(i));
        li.append(btn);
        return li;
      }));
      const next = Math.min(progress.unlocked, LEVELS.length) - 1;
      $('map-play').textContent = currentIndex === null ? (total ? `继续冒险 · 第 ${next + 1} 关` : '开始冒险') : `开始第 ${next + 1} 关`;
      $('map-play').dataset.level = next;
      $('map-close').classList.toggle('hidden', !canClose);
      $('result').classList.add('hidden');
      $('map').classList.remove('hidden');
      requestAnimationFrame(drawTrail);
    },
    hideMap() { $('map').classList.add('hidden'); },
    mapOpen() { return !$('map').classList.contains('hidden'); },

    showResult({ won, stars, score, best, detail, hasNext }) {
      const card = document.querySelector('.result-card');
      card.classList.toggle('lost', !won);
      $('result-title').textContent = won ? (hasNext ? '过关啦！' : '森林冒险全部完成！') : '步数用完啦';
      $('result-detail').textContent = detail;
      $('result-score').textContent = score;
      $('result-best').textContent = best ? `最佳 ${best}` : '';
      const starEls = [...$('result-stars').children];
      starEls.forEach(el => el.classList.remove('lit'));
      $('result-stars').classList.toggle('hidden', !won);
      $('result-next').classList.toggle('hidden', !won || !hasNext);
      $('result-retry').textContent = won ? '再玩一次' : '再试一次';
      $('result-retry').className = won ? 'secondary' : 'primary big';
      $('result').classList.remove('hidden');
      return starEls;
    },
    hideResult() { $('result').classList.add('hidden'); },
    resultOpen() { return !$('result').classList.contains('hidden'); },

    popup(x, y, text, color = '#fff') {
      const el = document.createElement('div');
      el.className = 'popup';
      el.textContent = text;
      el.style.left = `${x}px`;
      el.style.top = `${y}px`;
      el.style.color = color;
      $('fx-layer').append(el);
      setTimeout(() => el.remove(), 950);
    },
    praise(text, purple = false) {
      document.querySelectorAll('.praise').forEach(el => el.remove());
      const el = document.createElement('div');
      el.className = `praise${purple ? ' purple' : ''}`;
      el.textContent = text;
      $('fx-layer').append(el);
      setTimeout(() => el.remove(), 1350);
    },
  };
}
