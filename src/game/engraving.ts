import type { Rng } from '../voxel/VoxelPainter';

/**
 * 刻印。
 *
 * クリーン度は全ステータスに掛かる倍率で、0.88〜1.12 の 24% ぶんしか動かない。
 * 丁寧に削った1時間と雑に削った1分の差が、その幅にしか出ないのは薄い。
 *
 * そこで、削り上げたときに稀に地の模様が出る。これは倍率とは別枠の
 * 加算で、等級と組み合わせで決まる。出るかどうかと等級はクリーン度で
 * 決まるので、削りの腕がそのまま「引ける上限」になる。
 *
 * 種そのものの強さには触らない。刻印は個体に付き、付け替えれば移る——
 * 図鑑に並ぶ性能表が個体ごとに嘘になると、編成を読めなくなる。
 */

export type EngraveStat = 'atk' | 'def' | 'hp' | 'spd';

export interface Engraving {
  /** 銘の id。表示名と組み合わせを引く */
  pattern: string;
  /** 等級 1..5 */
  grade: number;
  atk: number;
  def: number;
  hp: number;
  spd: number;
}

export interface EngravePattern {
  id: string;
  name: string;
  /** 配分の順。先頭ほど厚く乗る */
  stats: EngraveStat[];
}

export const ENGRAVE_PATTERNS: EngravePattern[] = [
  { id: 'edge', name: '鋭', stats: ['atk'] },
  { id: 'shell', name: '殻', stats: ['def'] },
  { id: 'core', name: '芯', stats: ['hp'] },
  { id: 'gale', name: '疾', stats: ['spd'] },
  { id: 'blade', name: '刃', stats: ['atk', 'def'] },
  { id: 'fang', name: '牙', stats: ['atk', 'spd'] },
  { id: 'wall', name: '壁', stats: ['def', 'hp'] },
  { id: 'drum', name: '鼓', stats: ['hp', 'atk'] },
  { id: 'flow', name: '流', stats: ['spd', 'def'] },
  { id: 'whole', name: '全', stats: ['atk', 'def', 'hp'] },
];

export const ENGRAVE_STAT_NAMES: Record<EngraveStat, string> = {
  atk: '攻撃', def: '防御', hp: '体力', spd: '速度',
};

/**
 * 等級ごとの配分点。
 *
 * 1点 = 攻撃 or 防御 +1。体力は 1点 = +8、速度は 1点 = +0.6 に換算する——
 * 体力は桁が違い、速度は行動順を直接動かすので、同じ 1 では釣り合わない。
 */
const GRADE_BUDGET = [0, 14, 30, 42, 52, 62];
const HP_PER_POINT = 8;
/**
 * 速度は 1点 = +0.18 しか買えない。
 *
 * 速度は行動順そのものを動かすので、攻撃・防御と同じ値段にすると
 * 「疾」の刻印だけが常に正解になる。SPD 110 の個体に +37 が乗ると
 * 行動回数が 1.34 倍——他の刻印が全部かすむ。
 */
const SPD_PER_POINT = 0.18;

/** 等級ごとに使える銘。三種同時は最上位だけ */
function patternsFor(grade: number): EngravePattern[] {
  const max = grade >= 5 ? 3 : grade >= 2 ? 2 : 1;
  return ENGRAVE_PATTERNS.filter((p) => p.stats.length <= max);
}

/**
 * 出るかどうか。
 *
 * クリーン度 50 でおよそ 22%、100 で 62%。下限を 0 にしないのは、
 * 雑に削った石からも稀に出てほしいから——0 にすると、腕が届くまで
 * 存在自体を知らずに遊ぶことになる。
 */
export function engraveChance(clean: number): number {
  const t = Math.max(0, Math.min(1, clean / 100));
  return 0.08 + t * t * 0.54;
}

/** 等級の期待値。クリーン度が高いほど上の目が出る */
function rollGrade(clean: number, rng: Rng): number {
  const t = Math.max(0, Math.min(1, (clean - 40) / 60));
  // 4回振って最大を採る。t が高いほど上に寄るが、天井は運のまま
  let best = 1;
  for (let i = 0; i < 4; i++) {
    const v = 1 + Math.floor(rng.next() * (1 + t * 4.2));
    if (v > best) best = v;
  }
  return Math.max(1, Math.min(5, best));
}

/** 削り上がった化石に地の模様が出たか。出なければ null */
export function rollEngraving(clean: number, rng: Rng): Engraving | null {
  if (rng.next() >= engraveChance(clean)) return null;
  const grade = rollGrade(clean, rng);
  const pool = patternsFor(grade);
  const p = pool[Math.floor(rng.next() * pool.length)];
  return buildEngraving(p, grade);
}

export function buildEngraving(p: EngravePattern, grade: number): Engraving {
  const budget = GRADE_BUDGET[Math.max(1, Math.min(5, grade))];
  // 先頭を厚く。等分すると、どの銘も「少しずつ全部」になって性格が消える
  const weights = p.stats.length === 1 ? [1] : p.stats.length === 2 ? [0.66, 0.34] : [0.44, 0.31, 0.25];
  const out: Engraving = { pattern: p.id, grade, atk: 0, def: 0, hp: 0, spd: 0 };
  p.stats.forEach((stat, i) => {
    const pt = budget * weights[i];
    if (stat === 'hp') out.hp = Math.round((pt * HP_PER_POINT) / 5) * 5;
    else if (stat === 'spd') out.spd = Math.max(1, Math.round(pt * SPD_PER_POINT));
    else out[stat] = Math.round(pt);
  });
  return out;
}

export function engravePattern(e: Engraving): EngravePattern {
  return ENGRAVE_PATTERNS.find((p) => p.id === e.pattern) ?? ENGRAVE_PATTERNS[0];
}

export function engraveName(e: Engraving): string {
  return `${engravePattern(e).name}の刻印`;
}

/** 「攻撃 +20 / 防御 +10」。0 の枠は出さない */
export function engraveLines(e: Engraving): { stat: EngraveStat; value: number }[] {
  const out: { stat: EngraveStat; value: number }[] = [];
  for (const stat of ['atk', 'def', 'hp', 'spd'] as EngraveStat[]) {
    if (e[stat] > 0) out.push({ stat, value: e[stat] });
  }
  return out;
}

export function engraveText(e: Engraving): string {
  return engraveLines(e).map((l) => `${ENGRAVE_STAT_NAMES[l.stat]} +${l.value}`).join(' / ');
}

/**
 * どちらが強いか。付け替えの判断を自分でするための目安で、
 * 実際にどちらを採るかは選ばせる——速度 +5 と体力 +160 のどちらが要るかは、
 * 編成を見ないと決まらない。
 */
export function engraveWeight(e: Engraving | undefined): number {
  if (!e) return 0;
  return e.atk + e.def + e.hp / HP_PER_POINT + e.spd / SPD_PER_POINT;
}
