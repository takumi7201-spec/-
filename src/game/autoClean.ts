import type { SaveData } from '../core/Save';
import { scoreClean, type CleanScore } from './FossilBlock';
import type { Rng } from '../voxel/VoxelPainter';

/**
 * おまかせ精錬。
 *
 * 削りは1体あたり1分前後かかる。掘りで持ち帰る数が増えるほど、同じ手つきを
 * 何度も繰り返すことになり、終盤は「削るのが面倒だから掘らない」が起きる。
 * なので任せられるようにする——ただし手で削るより上には行かせない。
 *
 * 任せるたびに腕が上がる（Lv1 → Lv10）。上がるのは「任せた回数」だけで
 * 決まるので、何を任せたかは関係ない。最大でも仕上がりは A ランクの上側
 * （およそ 88）で、S ランク（95以上）には届かない——いちばん良い石は
 * 自分で削る理由を残す。
 */

/** おまかせが開く段 */
export const AUTO_UNLOCK_STAGE = 15;

export const AUTO_MAX_LEVEL = 10;

/** 1段上がるのに必要な回数 */
const PER_LEVEL = 3;

export function autoCleanUnlocked(data: SaveData): boolean {
  return data.stageProgress >= AUTO_UNLOCK_STAGE;
}

export function autoCleanUses(data: SaveData): number {
  return data.player.autoCleanUses ?? 0;
}

/** 任せた回数から出す腕前。1 から始まり 10 で頭打ち */
export function autoCleanLevel(uses: number): number {
  return Math.min(AUTO_MAX_LEVEL, 1 + Math.floor(uses / PER_LEVEL));
}

/** 次の段まであと何回か。頭打ちなら 0 */
export function autoCleanToNext(uses: number): number {
  const lv = autoCleanLevel(uses);
  if (lv >= AUTO_MAX_LEVEL) return 0;
  return PER_LEVEL - (uses % PER_LEVEL);
}

/**
 * その腕前での岩の落とし具合と手際。
 *
 * 仕上がりの数字を直に作らず、手で削ったときと同じ式（scoreClean）へ
 * 通す——別の式で作ると、同じ「クリーン度 70」が画面によって違う
 * 意味になる。
 */
function ratios(level: number): { rock: number; time: number } {
  const t = (level - 1) / (AUTO_MAX_LEVEL - 1);
  // 始まりを C ランク（50以上）に置く。開くのが第15段なので、最初の1回が
  // D ランクだと、手持ちより悪い石しか出てこない機能になってしまう
  return { rock: 0.62 + 0.33 * t, time: 0.22 + 0.18 * t };
}

/** その腕前で見込める仕上がり（ブレの中央）。画面の予告に使う */
export function autoCleanExpected(level: number): number {
  const { rock, time } = ratios(level);
  return scoreClean(rock * 1000, 1000, time * 100, 100, 0).clean;
}

/**
 * おまかせの仕上がり。
 *
 * 骨は傷めない（上限は 100 のまま）。任せた手つきは荒いが、丁寧ではある——
 * 速さではなく「どこまで落とすか」で手で削るのと差を付ける。
 */
export function autoCleanScore(level: number, rng: Rng): CleanScore {
  const { rock, time } = ratios(level);
  const jitter = (rng.next() - 0.5) * 0.04;
  const r = Math.max(0, Math.min(1, rock + jitter));
  const tm = Math.max(0, Math.min(1, time + jitter * 0.5));
  return scoreClean(r * 1000, 1000, tm * 100, 100, 0);
}
