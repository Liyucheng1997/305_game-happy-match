// 关卡、动物、技能与存档：纯数据与纯函数，Node 测试可直接导入

export const ANIMALS = [
  { key: 'fox', name: '狐狸', color: '#f08a3c' },
  { key: 'chick', name: '小鸡', color: '#ffcf33' },
  { key: 'frog', name: '青蛙', color: '#68c34a' },
  { key: 'penguin', name: '企鹅', color: '#3f6fb8' },
  { key: 'pig', name: '小猪', color: '#ff92b1' },
  { key: 'panda', name: '熊猫', color: '#b9a6e8' },
];

export const SKILLS = {
  hammer: { name: '小木槌', cost: 12, description: '点击一格：敲碎木箱、冰层和藤蔓，并消除动物' },
  bomb: { name: '蒲公英炸弹', cost: 28, description: '点击一格：炸开周围 3×3 区域' },
  rainbow: { name: '彩虹魔法', cost: 45, description: '点击一只动物：消除全盘同类动物' },
  shuffle: { name: '洗牌', cost: 20, description: '重新排列动物，障碍留在原位' },
};

export const ENERGY_MAX = 60;
export const ENERGY_START = 12;

// 布局字符：. 空格  o 普通  1/2 冰层  c/C 木箱(1/2 层)  v 藤蔓  w 藤蔓+冰  a 橡果
// goals：collect(动物收集) / ice / crate / vine / acorn / score
// stars：二星、三星所需分数（通关即一星）
export const LEVELS = [
  {
    name: '林间起步', moves: 20, types: 5, stars: [4600, 6800],
    tip: '横竖连成 3 个就能消除。连成 4 个会得到疾风动物，可以清掉整行或整列！',
    goals: [{ kind: 'collect', type: 0, target: 24 }],
    layout: ['oooooooo', 'oooooooo', 'oooooooo', 'oooooooo', 'oooooooo', 'oooooooo', 'oooooooo', 'oooooooo'],
  },
  {
    name: '特效小课堂', moves: 20, types: 5, stars: [4700, 6700],
    tip: '连成 L 形或 T 形会得到炸弹；连成 5 个得到彩虹球。把两个特效交换会触发组合技！',
    goals: [{ kind: 'collect', type: 1, target: 24 }, { kind: 'collect', type: 2, target: 24 }],
    layout: ['.oooooo.', 'oooooooo', 'oooooooo', 'oooooooo', 'oooooooo', 'oooooooo', 'oooooooo', '.oooooo.'],
  },
  {
    name: '薄冰初现', moves: 18, types: 5, stars: [4600, 7800],
    tip: '在冰块上消除动物，冰块就会裂开。清除所有冰块即可过关。',
    goals: [{ kind: 'ice' }],
    layout: ['oooooooo', 'oooooooo', 'oo1111oo', 'o111111o', 'o111111o', 'oo1111oo', 'oooooooo', 'oooooooo'],
  },
  {
    name: '橡果回家', moves: 24, types: 5, stars: [6100, 8800],
    tip: '把橡果送到棋盘最下方，它就会掉进松鼠的篮子里。',
    goals: [{ kind: 'acorn', target: 3 }],
    layout: ['ooaooooo', 'oooooooo', 'oooooooo', 'oooooooo', 'oooooooo', 'oooooooo', '.oooooo.', '..oooo..'],
  },
  {
    name: '木箱谜阵', moves: 20, types: 5, stars: [5300, 7700],
    tip: '在木箱旁边消除即可敲开木箱，带铁箍的箱子要敲两次。特效也能直接打碎木箱。',
    goals: [{ kind: 'crate' }],
    layout: ['oooooooo', 'oooooooo', 'oooooooo', 'ooCooCoo', 'oooooooo', 'oooooooo', 'cccccccc', 'cccccccc'],
  },
  {
    name: '双层冰湖', moves: 22, types: 5, stars: [5900, 10100],
    tip: '深蓝色的厚冰要消除两次才会碎掉。',
    goals: [{ kind: 'ice' }],
    layout: ['oooooooo', 'oooooooo', 'oo2222oo', 'o211112o', 'o211112o', 'oo2222oo', 'oooooooo', 'oooooooo'],
  },
  {
    name: '藤蔓缠绕', moves: 25, types: 6, stars: [3800, 4900],
    tip: '被藤蔓缠住的动物不能移动，但可以参与消除——消除一次就能解开藤蔓。',
    goals: [{ kind: 'vine' }, { kind: 'collect', type: 4, target: 16 }],
    layout: ['oooooooo', 'ovoooovo', 'oovoovoo', 'oooooooo', 'oooooooo', 'oovoovoo', 'ovoooovo', 'oooooooo'],
  },
  {
    name: '六色森林', moves: 28, types: 6, stars: [4100, 5700],
    tip: '六种动物一起出现了，多留意特效的机会。',
    goals: [{ kind: 'collect', type: 0, target: 16 }, { kind: 'collect', type: 3, target: 16 }, { kind: 'ice' }],
    layout: ['oooooooo', 'oooooooo', 'oooooooo', 'oooooooo', 'oooooooo', 'oooooooo', '11111111', '11111111'],
  },
  {
    name: '蘑菇峡谷', moves: 24, types: 5, acornMax: 2, stars: [3300, 4500],
    tip: '峡谷中间是空的，动物会直接穿过缺口落下。',
    goals: [{ kind: 'acorn', target: 3 }],
    layout: ['oooaoooo', 'oooooooo', 'ooo..ooo', 'ooo..ooo', 'ooo..ooo', 'oooooooo', 'oooooooo', 'oooooooo'],
  },
  {
    name: '冰封木屋', moves: 24, types: 6, stars: [3500, 5100],
    tip: '木箱会挡住下落的动物，先把它们敲开吧。',
    goals: [{ kind: 'crate' }, { kind: 'ice' }],
    layout: ['oooooooo', 'oooooooo', '1o1oo1o1', 'oCocCoCo', '1o1oo1o1', 'oooooooo', 'o1o11o1o', 'oooooooo'],
  },
  {
    name: '星光小径', moves: 22, types: 6, stars: [3100, 4000],
    tip: '星形棋盘的边角空间很小，可以靠特效清理角落。',
    goals: [{ kind: 'ice' }],
    layout: ['..oooo..', '.oooooo.', 'oo2222oo', 'oo2112oo', 'oo2112oo', 'oo2222oo', '.oooooo.', '..oooo..'],
  },
  {
    name: '迷雾沼泽', moves: 28, acornMax: 2, types: 6, stars: [4100, 5800],
    tip: '藤蔓、木箱和橡果同时出现，先打通橡果的下落路线。',
    goals: [{ kind: 'acorn', target: 2 }, { kind: 'vine' }],
    layout: ['ooooaooo', 'oooooooo', 'ovooooov', 'oocoocoo', 'oooooooo', 'vooooooo', 'ooovvooo', 'oooooooo'],
  },
  {
    name: '极光湖', moves: 30, types: 6, stars: [5700, 6600],
    tip: '整片湖面都结了厚冰，组合特效会是你最好的帮手。',
    goals: [{ kind: 'ice' }, { kind: 'collect', type: 3, target: 16 }],
    layout: ['oooooooo', 'o222222o', 'o211112o', 'o2oooo2o', 'o2oooo2o', 'o211112o', 'o222222o', 'oooooooo'],
  },
  {
    name: '古树之心', moves: 26, types: 6, stars: [3500, 4700],
    tip: '古树的心被木箱和藤蔓层层包围。',
    goals: [{ kind: 'crate' }, { kind: 'vine' }],
    layout: ['oooooooo', 'oovoovoo', 'ooCooCoo', 'vooccoov', 'vooccoov', 'ooCooCoo', 'oovoovoo', 'oooooooo'],
  },
  {
    name: '森林之巅', moves: 29, types: 6, stars: [4700, 5600],
    tip: '最后的试炼！冰层、木箱、藤蔓与橡果全部登场。',
    goals: [{ kind: 'acorn', target: 2 }, { kind: 'ice' }, { kind: 'crate' }],
    layout: ['.ooaoao.', 'oooooooo', 'o1c11c1o', 'o1w22w1o', 'o1o22o1o', 'o1c11c1o', 'oooooooo', '.oooooo.'],
  },
].map((level, i) => ({ id: i + 1, ...level }));

export function starsFor(level, score) {
  return 1 + (score >= level.stars[0] ? 1 : 0) + (score >= level.stars[1] ? 1 : 0);
}

export function readProgress(raw) {
  const n = LEVELS.length;
  try {
    const data = JSON.parse(raw);
    const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, Math.floor(Number(v) || 0)));
    return {
      unlocked: clamp(data.unlocked, 1, n),
      stars: Array.from({ length: n }, (_, i) => clamp(data.stars?.[i], 0, 3)),
      best: Array.from({ length: n }, (_, i) => clamp(data.best?.[i], 0, 1e9)),
    };
  } catch {
    return { unlocked: 1, stars: Array(n).fill(0), best: Array(n).fill(0) };
  }
}
