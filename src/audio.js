// 用 Web Audio API 合成全部声音，无需外部音频文件
let ctx = null;
let master, musicGain, sfxGain;
let muted = false;
let musicTimer = null;

function ensure() {
  if (ctx) return ctx;
  ctx = new (window.AudioContext || window.webkitAudioContext)();
  master = ctx.createGain(); master.gain.value = muted ? 0 : 1; master.connect(ctx.destination);
  musicGain = ctx.createGain(); musicGain.gain.value = 0.14; musicGain.connect(master);
  sfxGain = ctx.createGain(); sfxGain.gain.value = 0.5; sfxGain.connect(master);
  return ctx;
}

/** 必须在用户手势里调用一次，浏览器才允许出声 */
export function unlock() {
  ensure();
  if (ctx.state === 'suspended') ctx.resume();
  startMusic();
}

// 页面切到后台时暂停所有声音，回到前台恢复
document.addEventListener('visibilitychange', () => {
  if (!ctx) return;
  if (document.hidden) ctx.suspend();
  else ctx.resume();
});

export function setMuted(m) {
  muted = m;
  if (master) master.gain.setTargetAtTime(m ? 0 : 1, ctx.currentTime, 0.02);
}
export function isMuted() { return muted; }

// ---------- 基础音色 ----------
function tone({ freq, type = 'sine', t = 0, dur = 0.2, vol = 0.3, dest = sfxGain, attack = 0.005, slide = null }) {
  const o = ctx.createOscillator(), g = ctx.createGain();
  o.type = type;
  const start = ctx.currentTime + t;
  o.frequency.setValueAtTime(freq, start);
  if (slide) o.frequency.exponentialRampToValueAtTime(slide, start + dur);
  g.gain.setValueAtTime(0, start);
  g.gain.linearRampToValueAtTime(vol, start + attack);
  g.gain.exponentialRampToValueAtTime(0.0001, start + dur);
  o.connect(g).connect(dest);
  o.start(start); o.stop(start + dur + 0.05);
}

function noise({ t = 0, dur = 0.15, vol = 0.2, freq = 1200 }) {
  const len = Math.floor(ctx.sampleRate * dur);
  const buf = ctx.createBuffer(1, len, ctx.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len);
  const src = ctx.createBufferSource(); src.buffer = buf;
  const f = ctx.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = freq; f.Q.value = 0.8;
  const g = ctx.createGain(); g.gain.value = vol;
  src.connect(f).connect(g).connect(sfxGain);
  src.start(ctx.currentTime + t);
}

// ---------- 音效 ----------
export const sfx = {
  select() { if (!ctx) return; tone({ freq: 880, type: 'triangle', dur: 0.08, vol: 0.2 }); },
  swap() { if (!ctx) return; noise({ dur: 0.12, vol: 0.15, freq: 2000 }); tone({ freq: 500, slide: 900, type: 'sine', dur: 0.12, vol: 0.12 }); },
  invalid() { if (!ctx) return; tone({ freq: 220, slide: 150, type: 'square', dur: 0.18, vol: 0.12 }); },
  /** 消除：连击越高音调越高，count 为消除数量 */
  pop(combo = 1, count = 3) {
    if (!ctx) return;
    const base = 523.25 * Math.pow(2, (combo - 1) / 12 * 2); // 每连击升一个全音
    const n = Math.min(count, 6);
    for (let i = 0; i < n; i++) {
      tone({ freq: base * Math.pow(2, i / 12), type: 'triangle', t: i * 0.04, dur: 0.25, vol: 0.25, attack: 0.002 });
      noise({ t: i * 0.04, dur: 0.08, vol: 0.08, freq: 3000 });
    }
    if (combo >= 2) tone({ freq: base * 2, type: 'sine', t: n * 0.04, dur: 0.4, vol: 0.15 });
  },
  land() { if (!ctx) return; noise({ dur: 0.06, vol: 0.06, freq: 400 }); },
  lose() {
    if (!ctx) return;
    const notes = [659.25, 587.33, 523.25, 392];
    notes.forEach((f, i) => tone({ freq: f, type: 'triangle', t: i * 0.25, dur: 0.5, vol: 0.25 }));
  },
  win() {
    if (!ctx) return;
    [523.25, 659.25, 783.99, 1046.5, 783.99, 1046.5, 1318.5].forEach((f, i) =>
      tone({ freq: f, type: 'triangle', t: i * 0.11, dur: i === 6 ? 0.9 : 0.25, vol: 0.24 }));
    [261.63, 329.63, 392].forEach(f => tone({ freq: f, type: 'sine', t: 0.66, dur: 1.2, vol: 0.12 }));
  },
  star(n = 0) { if (!ctx) return; tone({ freq: 880 * Math.pow(2, n * 4 / 12), type: 'triangle', dur: 0.35, vol: 0.25 }); tone({ freq: 1760 * Math.pow(2, n * 4 / 12), type: 'sine', t: 0.05, dur: 0.3, vol: 0.1 }); },
  /** 生成特效动物：上行琶音 */
  create() { if (!ctx) return; [0, 4, 7, 12].forEach((n, i) => tone({ freq: 659.25 * Math.pow(2, n / 12), type: 'sine', t: i * 0.045, dur: 0.22, vol: 0.18 })); },
  line() { if (!ctx) return; tone({ freq: 1800, slide: 300, type: 'sawtooth', dur: 0.35, vol: 0.08 }); noise({ dur: 0.35, vol: 0.18, freq: 2500 }); },
  bomb() { if (!ctx) return; tone({ freq: 160, slide: 40, type: 'sine', dur: 0.5, vol: 0.5 }); noise({ dur: 0.45, vol: 0.4, freq: 500 }); },
  rainbow() { if (!ctx) return; for (let i = 0; i < 12; i++) tone({ freq: 523.25 * Math.pow(2, i / 7), type: 'sine', t: i * 0.035, dur: 0.25, vol: 0.12 }); },
  crate() { if (!ctx) return; noise({ dur: 0.18, vol: 0.35, freq: 700 }); tone({ freq: 140, slide: 90, type: 'triangle', dur: 0.15, vol: 0.25 }); },
  ice() { if (!ctx) return; noise({ dur: 0.12, vol: 0.2, freq: 5000 }); tone({ freq: 2400, slide: 1800, type: 'sine', dur: 0.12, vol: 0.08 }); },
  vine() { if (!ctx) return; noise({ dur: 0.1, vol: 0.2, freq: 1800 }); tone({ freq: 300, slide: 500, type: 'triangle', dur: 0.1, vol: 0.12 }); },
  acorn() { if (!ctx) return; [0, 7, 12, 16].forEach((n, i) => tone({ freq: 523.25 * Math.pow(2, n / 12), type: 'triangle', t: i * 0.07, dur: 0.25, vol: 0.2 })); },
  convert(i = 0) { if (!ctx) return; tone({ freq: 880 * Math.pow(2, (i % 12) / 12), type: 'triangle', dur: 0.12, vol: 0.14 }); },
  hammer() { if (!ctx) return; tone({ freq: 220, slide: 90, type: 'square', dur: 0.12, vol: 0.18 }); noise({ dur: 0.15, vol: 0.3, freq: 900 }); },
  shuffle() { if (!ctx) return; for (let i = 0; i < 8; i++) tone({ freq: 400 + i * 120, type: 'sine', t: i * 0.05, dur: 0.12, vol: 0.12 }); },
};

// ---------- 背景音乐：轻快的循环旋律 ----------
const BPM = 128;
const BEAT = 60 / BPM;
// 旋律（C 大调，单位：半音相对 C5），null 为休止
const MELODY = [
  0, 4, 7, 12, 7, 4, 0, null, 2, 5, 9, 14, 9, 5, 2, null,
  4, 7, 11, 16, 11, 7, 4, null, 5, 9, 12, 17, 12, 9, 7, 5,
  0, 4, 7, 12, 7, 4, 0, null, 2, 5, 9, 14, 9, 5, 2, null,
  4, 7, 11, 16, 11, 7, 4, null, 12, 11, 9, 7, 5, 4, 2, 0,
];
const BASS = [0, 0, 7, 7, 2, 2, 9, 9, 4, 4, 11, 11, 5, 5, 7, 7,
              0, 0, 7, 7, 2, 2, 9, 9, 4, 4, 11, 11, 5, 0, 7, 0];
const C5 = 523.25, C3 = 130.81;
const st = (base, n) => base * Math.pow(2, n / 12);

function scheduleBar(startTime, bar) {
  const step = BEAT / 2; // 八分音符
  for (let i = 0; i < 16; i++) {
    const n = MELODY[(bar * 16 + i) % MELODY.length];
    const t = startTime + i * step;
    if (n !== null) tone({ freq: st(C5, n), type: 'triangle', t: t - ctx.currentTime, dur: step * 0.9, vol: 0.16, dest: musicGain, attack: 0.01 });
    // 低音每拍一次
    if (i % 2 === 0) {
      const b = BASS[(bar * 8 + i / 2) % BASS.length];
      tone({ freq: st(C3, b), type: 'triangle', t: t - ctx.currentTime, dur: BEAT * 0.8, vol: 0.3, dest: musicGain, attack: 0.01 });
    }
    // 简单打击：每拍踩镲，2/4 拍军鼓
    if (i % 2 === 0) noiseTo(musicGain, t - ctx.currentTime, 0.04, 0.05, 6000);
    if (i === 4 || i === 12) noiseTo(musicGain, t - ctx.currentTime, 0.12, 0.12, 1500);
  }
}
function noiseTo(dest, t, dur, vol, freq) {
  const len = Math.floor(ctx.sampleRate * dur);
  const buf = ctx.createBuffer(1, len, ctx.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len);
  const src = ctx.createBufferSource(); src.buffer = buf;
  const f = ctx.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = freq;
  const g = ctx.createGain(); g.gain.value = vol;
  src.connect(f).connect(g).connect(dest);
  src.start(ctx.currentTime + Math.max(0, t));
}

function startMusic() {
  if (musicTimer) return;
  let bar = 0;
  let nextBar = ctx.currentTime + 0.1;
  const barLen = BEAT * 8;
  const tick = () => {
    // 提前调度，保证不卡顿
    while (nextBar < ctx.currentTime + 0.5) {
      scheduleBar(nextBar, bar);
      bar++;
      nextBar += barLen;
    }
  };
  tick();
  musicTimer = setInterval(tick, 200);
}
