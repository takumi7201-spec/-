import type { BiomeId, ElementId } from '../../voxel/palette';
import type { BattleRules, Boost, TeamSetup } from '../battle/types';
import { REVOS, getRevos, type RevosDef } from './revos';
import { Rng } from '../../voxel/VoxelPainter';
import type { SaveData } from '../../core/Save';

/**
 * 日替わり・週替わりのイベント。
 *
 * 物語のイベント戦は一度勝てば終わる。倒した相手が同じ場所に並び続けると、
 * 進める理由がそこで尽きる。ここに置くのは「日付で勝手に入れ替わる」
 * 2本——今日の戦場は毎日、巨獣は毎週、中身が変わる。
 *
 * どちらも乱数は日付から作る。同じ日に何度開いても同じ相手が出る——
 * 負けて編成を組み替え、同じ相手にもう一度挑めないと、読み合いにならない。
 */

// ------------------------------------------------------------ 日付

/** 日付の鍵（YYYY-MM-DD）から、1970-01-01 からの日数を出す */
function dayNumber(dateKey: string): number {
  return Math.floor(Date.parse(`${dateKey}T00:00:00Z`) / 86_400_000);
}

/**
 * 週の鍵。月曜始まりで、その週の月曜の日付を返す。
 * 日付の境目は todayKey と同じ（4:00 JST）——日と週で切り替わる時刻がずれない
 */
export function weekKeyOf(dateKey: string): string {
  const d = dayNumber(dateKey);
  // 1970-01-01 は木曜。月曜を 0 に揃える
  const monday = d - ((d + 3) % 7);
  return new Date(monday * 86_400_000).toISOString().slice(0, 10);
}

/** 週の通し番号 */
function weekNumber(dateKey: string): number {
  return Math.floor(dayNumber(weekKeyOf(dateKey)) / 7);
}

/** その日の残り時間（ミリ秒）。切り替わりは 4:00 JST */
export function msUntilNextDay(now = Date.now()): number {
  const shifted = now + 9 * 3600_000 - 4 * 3600_000;
  return 86_400_000 - (shifted % 86_400_000);
}

/** その週の残り時間（ミリ秒）。切り替わりは月曜 4:00 JST */
export function msUntilNextWeek(now = Date.now()): number {
  const shifted = now + 9 * 3600_000 - 4 * 3600_000;
  const day = Math.floor(shifted / 86_400_000);
  const intoWeek = (day + 3) % 7;
  return (7 - intoWeek) * 86_400_000 - (shifted % 86_400_000);
}

function seedOf(key: string, salt: number): number {
  let h = 2166136261 ^ salt;
  for (let i = 0; i < key.length; i++) {
    h ^= key.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** 物語専用の個体は出さない。出会う場所は物語の1か所に限る */
const OPEN_POOL = REVOS.filter((r) => !r.eventOnly);

// ------------------------------------------------------------ 今日の戦場

export interface DailyRule {
  id: string;
  name: string;
  /** 見出しの上に添える一言 */
  subtitle: string;
  desc: string;
  /** 勝ち筋。場の決まりに合う編成を、札の上で先に示す */
  hint: string;
  biome: BiomeId;
  rules: BattleRules;
  /** 敵に選ぶ種の条件 */
  pick: (r: RevosDef) => boolean;
  /** 敵だけに乗る上乗せ */
  boost?: Boost;
  /** 報酬の化石を寄せる属性 */
  element?: ElementId;
}

/**
 * 7つの場。曜日ではなく日数で回すので、同じ曜日に同じ場が来るとは限らない。
 *
 * 属性の日は「その属性が敵味方の別なく通りやすい」だけで、敵もその属性で
 * 固める。こちらが同じ属性で殴り返すか、相性の良い属性で受けるかを選ばせる。
 */
export const DAILY_RULES: DailyRule[] = [
  {
    id: 'blaze', name: '灼熱の地層', subtitle: '火の日',
    desc: '地熱が噴き上がる。火の攻撃は、敵にも味方にも 35% 通りやすい。',
    hint: '水で受ければ火は半減する。火で殴り返すのも手',
    biome: 'emberfield', rules: { elementDealt: { flame: 1.35 } },
    pick: (r) => r.element === 'flame', element: 'flame',
  },
  {
    id: 'abyss', name: '深海の地層', subtitle: '水の日',
    desc: '水が満ちる。水の攻撃は、敵にも味方にも 35% 通りやすい。',
    hint: '土で受ければ水は半減する',
    biome: 'tidehollow', rules: { elementDealt: { aqua: 1.35 } },
    pick: (r) => r.element === 'aqua', element: 'aqua',
  },
  {
    id: 'bedrock', name: '岩盤の地層', subtitle: '土の日',
    desc: '足元が固まる。土の攻撃は、敵にも味方にも 35% 通りやすい。',
    hint: '風で受ければ土は半減する',
    biome: 'canyon', rules: { elementDealt: { terra: 1.35 } },
    pick: (r) => r.element === 'terra', element: 'terra',
  },
  {
    id: 'gale', name: '烈風の地層', subtitle: '風の日',
    desc: '吹きさらしの尾根。風の攻撃は、敵にも味方にも 35% 通りやすい。',
    hint: '火で受ければ風は半減する',
    biome: 'frostpeak', rules: { elementDealt: { gale: 1.35 } },
    pick: (r) => r.element === 'gale', element: 'gale',
  },
  {
    id: 'rampart', name: '城壁戦', subtitle: '守りの日',
    desc: '壁役と守護役だけの布陣。どの個体も防御 +25%・体力 +10% で待ち構える。',
    hint: '崩し役は壁に重い一撃を入れる',
    biome: 'canyon', rules: {},
    pick: (r) => r.role === 'Tank' || r.role === 'Guardian',
    boost: { def: 1.25, hp: 1.1 },
  },
  {
    id: 'ambush', name: '奇襲戦', subtitle: '速さの日',
    desc: '足の速い者ばかりが、速度 +5% で後衛へ雪崩れ込んでくる。',
    hint: '後衛が真っ先に狙われる。守護役がいれば割って入る',
    biome: 'frostpeak', rules: {},
    pick: (r) => r.role === 'Sprinter' || r.role === 'Finisher' || r.spd >= 110,
    boost: { spd: 1.05 },
  },
  {
    id: 'frenzy', name: '乱戦', subtitle: '嵐の日',
    desc: '誰もが焦っている。行動も必殺の溜まりも、敵味方とも 1.6 倍の速さで回る。',
    hint: '必殺の強い編成ほど暴れる',
    biome: 'emberfield', rules: { tempo: 1.6 },
    pick: () => true,
  },
];

export function dailyRuleFor(dateKey: string): DailyRule {
  const n = dayNumber(dateKey);
  return DAILY_RULES[((n % DAILY_RULES.length) + DAILY_RULES.length) % DAILY_RULES.length];
}

/** 進行度に応じたレア度の上限。通常戦と同じ段を使う */
function rarityCap(stageProgress: number): number {
  const s = stageProgress + 1;
  return s < 3 ? 2 : s < 6 ? 3 : s < 10 ? 4 : 5;
}

/** 出撃する編成の基準。size は出撃した数で、敵の数と巨獣の体力を合わせる */
export interface Anchor { level: number; clean: number; size: number }

/**
 * 今日の敵。日付から決めるので、その日のうちは何度挑んでも同じ3体。
 * レベルは出撃する編成の平均に揃える。難しさは場の決まりと顔ぶれが作る——
 * 決まりに合わない編成で挑めば負け越し、合わせれば勝ち越す、という高さ。
 */
export function buildDailyTeam(dateKey: string, stageProgress: number, anchor: Anchor): TeamSetup {
  const rule = dailyRuleFor(dateKey);
  const rng = new Rng(seedOf(dateKey, 0x5eed));
  const cap = rarityCap(stageProgress);
  let pool = OPEN_POOL.filter((r) => r.rarity <= cap && rule.pick(r));
  if (pool.length < 3) pool = OPEN_POOL.filter((r) => rule.pick(r));
  if (pool.length < 3) pool = OPEN_POOL.filter((r) => r.rarity <= cap);
  const want = Math.max(1, Math.min(5, anchor.size));
  const ids: string[] = [];
  let guard = 0;
  while (ids.length < want && guard++ < 64) {
    const id = pool[Math.floor(rng.next() * pool.length)].id;
    if (!ids.includes(id) || guard > 32) ids.push(id);
  }
  return {
    members: ids.map((defId, i) => ({
      uid: `day${i}`,
      defId,
      level: Math.max(1, anchor.level),
      clean: Math.max(45, Math.min(95, anchor.clean)),
      skillLevel: 1,
      boost: rule.boost,
    })),
    order: ids.map((_, i) => i),
  };
}

/** その日の初勝利の報酬 */
export function dailyReward(stageProgress: number): { coins: number; rarity: number } {
  return {
    coins: 250 + 20 * Math.min(10, stageProgress),
    rarity: stageProgress < 3 ? 2 : stageProgress < 8 ? 3 : 4,
  };
}
/** 2回目以降の勝利 */
export const DAILY_REPLAY_COINS = 60;

/** 報酬の化石を1つ選ぶ。その日の属性があればそこから */
export function rollDailyFossil(rule: DailyRule, rarity: number, rng: () => number): string {
  const byRarity = OPEN_POOL.filter((r) => r.rarity === rarity);
  const themed = rule.element ? byRarity.filter((r) => r.element === rule.element) : [];
  const list = themed.length > 0 ? themed : byRarity.length > 0 ? byRarity : OPEN_POOL;
  return list[Math.floor(rng() * list.length)].id;
}

// ------------------------------------------------------------ 巨獣討伐

export interface BossDef {
  defId: string;
  /** 見出し。種の名前ではなく、その週の呼び名 */
  title: string;
  desc: string;
  biome: BiomeId;
  /** 上乗せ。体力は種ごとに測って合わせる（下の表の注を参照） */
  boost: Boost;
}

/** 巨獣の体の大きさ。押し合いの半径にも効く */
const BOSS_SIZE = 1.75;
/** 制限時間（秒） */
export const BOSS_TIME = 60;

/**
 * 巨獣の表。
 *
 * 体力の倍率は種ごとに測って決めた（ランダムな5体・同レベルで挑んだとき、
 * 与ダメージの中央値がおよそ体力の半分になる値）。役職で戦い方が違う——
 * 回復役の巨獣は下がって自分を癒し、特攻役の巨獣は後衛へ突っ込んでくる——
 * ので、一律の倍率では週によって易しすぎたり、手も足も出なかったりする。
 */
export const BOSSES: BossDef[] = [
  {
    defId: 'tyrannosaurus-sue', title: '暴君の再臨',
    desc: '六千万年を越えて、最も完全な暴君が立ち上がる。相性を無視して、あらゆる者に重く噛みつく。',
    biome: 'canyon', boost: { hp: 29.8, atk: 1.2, def: 1.1, size: BOSS_SIZE, anchored: true },
  },
  {
    defId: 'pliosaurus-funkei', title: '深淵の顎',
    desc: '海の主が浅瀬まで上がってきた。生きている間、こちらの必殺は溜まりにくい。',
    biome: 'tidehollow', boost: { hp: 46, atk: 1.2, def: 1.1, size: BOSS_SIZE, anchored: true },
  },
  {
    defId: 'spinosaurus', title: '帆を焼く者',
    desc: '背の帆が赤く灼けている。追い詰めるほど、牙が熱を帯びる。',
    biome: 'emberfield', boost: { hp: 99, atk: 1.2, def: 1.1, size: BOSS_SIZE, anchored: true },
  },
  {
    defId: 'therizinosaurus', title: '大鎌の番人',
    desc: '三本の鎌は盾を素通りする。硬い者ほど深く裂かれる。',
    biome: 'canyon', boost: { hp: 28.2, atk: 1.2, def: 1.1, size: BOSS_SIZE, anchored: true },
  },
  {
    defId: 'hatzegopteryx', title: '島の頂点',
    desc: 'ハツェグ島を統べた巨翼。最初の一撃が通った瞬間から、手がつけられなくなる。',
    biome: 'frostpeak', boost: { hp: 45, atk: 1.2, def: 1.1, size: BOSS_SIZE, anchored: true },
  },
  {
    defId: 'kronosaurus', title: '底なしの圧',
    desc: '速い者ほど、その圧に押し潰される。',
    biome: 'tidehollow', boost: { hp: 24.8, atk: 1.2, def: 1.1, size: BOSS_SIZE, anchored: true },
  },
];

export function bossFor(dateKey: string): BossDef {
  const n = weekNumber(dateKey);
  return BOSSES[((n % BOSSES.length) + BOSSES.length) % BOSSES.length];
}

/**
 * 巨獣は1体きり。レベルは出撃する編成の平均より1つ上。
 * 体力は5体で挑んだときに合わせてあり、出撃した数に比例させる——
 * 手持ちが少ないうちに、削りきれない壁にしない
 */
export function buildBossTeam(boss: BossDef, anchor: Anchor): TeamSetup {
  const n = Math.max(1, Math.min(5, anchor.size));
  return {
    members: [{
      uid: 'boss',
      defId: boss.defId,
      level: Math.max(1, anchor.level + 1),
      clean: Math.max(50, Math.min(95, anchor.clean + 5)),
      skillLevel: 1,
      boost: { ...boss.boost, hp: (boss.boost.hp ?? 1) * (n / 5) },
    }],
    order: [0],
  };
}

/**
 * 与ダメージ（巨獣の最大体力に対する割合）の段。
 * 段ごとに週1回ずつ受け取れる。金は討伐——倒しきったときだけ。
 */
export interface BossTier {
  at: number;
  name: string;
  coins: number;
  /** 化石。'boss' ならその週の巨獣と同じ種 */
  fossil?: { rarity: number } | 'boss';
}

export const BOSS_TIERS: BossTier[] = [
  { at: 0.25, name: '銅', coins: 300 },
  { at: 0.55, name: '銀', coins: 500, fossil: { rarity: 3 } },
  { at: 1.0, name: '金', coins: 800, fossil: 'boss' },
];

/** ★3 の化石を1つ。巨獣の属性に寄せる */
export function rollBossFossil(boss: BossDef, rarity: number, rng: () => number): string {
  const el = getRevos(boss.defId).element;
  const byRarity = OPEN_POOL.filter((r) => r.rarity === rarity);
  const themed = byRarity.filter((r) => r.element === el);
  const list = themed.length > 0 ? themed : byRarity;
  return list[Math.floor(rng() * list.length)].id;
}

// ------------------------------------------------------------ 進み具合

/**
 * 今日の戦場の進み具合。保存されているのが別の日のものなら、新しい日として返す——
 * 日付が変わったことを誰かが先に知らせる必要はない。
 */
export function dailyState(data: SaveData, dateKey: string): { date: string; won: boolean } {
  const d = data.events.daily;
  if (!d || d.date !== dateKey) return { date: dateKey, won: false };
  return d;
}

export function bossState(data: SaveData, dateKey: string): { week: string; best: number; claimed: number[] } {
  const week = weekKeyOf(dateKey);
  const b = data.events.boss;
  if (!b || b.week !== week) return { week, best: 0, claimed: [] };
  return b;
}

/** まだ手を付けていないものの数。出撃の入口の札に出す */
export function rotationBadge(data: SaveData, dateKey: string): number {
  const daily = dailyState(data, dateKey).won ? 0 : 1;
  const boss = bossState(data, dateKey).claimed.length === 0 ? 1 : 0;
  return daily + boss;
}

/** 残り時間を「あと 5時間」「あと 3日」の形にする */
export function remainText(ms: number): string {
  const h = Math.floor(ms / 3_600_000);
  if (h >= 48) return `あと ${Math.floor(h / 24)}日`;
  if (h >= 1) return `あと ${h}時間`;
  return `あと ${Math.max(1, Math.floor(ms / 60_000))}分`;
}
