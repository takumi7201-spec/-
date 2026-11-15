/**
 * ラン（一回の挑戦）の型。
 *
 * 戦闘は横一列6枠。体力はチームで1本。各ユニットはクールダウンが回るたびに
 * 「効果」を出し、効果の数値は「素の値×★」に「育ち（永続）」と「戦闘中の上乗せ」を
 * 足したもの。育ちはランが終わるまで残る——買って、並べて、育てるのが遊びの芯。
 */

/** 効果の種類 */
export type EffectKind =
  | 'dmg'     // 攻撃: 相手の体力を削る（盾が先に受ける）
  | 'burn'    // 火傷: 相手に火傷を積む。0.5秒ごとに積んだ数ぶん削り、半分に減る
  | 'poison'  // 毒: 相手に毒を積む。2秒ごとに積んだ数ぶん削る。減らない・盾を通る
  | 'shield'  // 盾: 自分の側に盾を積む
  | 'heal'    // 回復: 自分の側の体力を戻す
  | 'slow'    // 遅延: 正面の相手の溜まりを秒で戻す
  | 'haste'   // 加速: 隣の味方の溜まりを秒で進める
  | 'strip';  // 剥がし: 相手の盾を削る

export const EFFECT_KINDS: EffectKind[] = ['dmg', 'burn', 'poison', 'shield', 'heal', 'slow', 'haste', 'strip'];

/** 能力のきっかけ */
export type Trigger =
  | 'fire'     // 自分が発動したとき
  | 'adjFire'  // 隣の味方が発動したとき
  | 'start'    // 戦闘の始まり
  | 'buy'      // 買ったとき
  | 'sell'     // 売ったとき
  | 'win'      // 勝った戦闘の後
  | 'end';     // 戦闘の後（勝ち負けによらず）

/** 能力が届く先 */
export type Target = 'self' | 'adj' | 'left' | 'right' | 'allies' | 'others' | 'kin';

/** 能力で動かすもの。効果の数値か、クールダウン（秒、負で短く）か、溜まり（秒） */
export type Stat = EffectKind | 'cd' | 'charge';

export interface AbilityDef {
  when: Trigger;
  to: Target;
  stat: Stat;
  add: number;
  /** true ならランの終わりまで残る（育ち）。false は戦闘中だけ */
  perm: boolean;
}

export interface RunUnitDef {
  id: string;
  /** ショップの段。1〜5 */
  tier: number;
  /** クールダウン（秒） */
  cd: number;
  /** 発動したときに出す効果。★で倍になる */
  fire: Partial<Record<EffectKind, number>>;
  abilities: AbilityDef[];
  /** 相手の体力が半分を切っていると攻撃が この倍率 */
  execute?: number;
  /** 攻撃が盾を無視する */
  pierce?: boolean;
  /** 1回の発動で攻撃が何回入るか */
  hits?: number;
  /** 相手に火傷か毒があると攻撃が この倍率 */
  exploit?: number;
}

/** ランの中の1体。育ちはここに残る */
export interface RunUnit {
  uid: string;
  defId: string;
  /** 重ねた数。3で★2、9で★3 */
  copies: number;
  /** 育ち。効果の数値とクールダウンへの足し込み */
  perm: Partial<Record<Stat, number>>;
}

/**
 * 盤面は横2×縦3の6マス。上の段が前列（相手の側）。
 * 隣・正面・画面の並びはすべてこの2つから決まるので、形を変えるときはここだけ直す
 */
export const BOARD_COLS = 2;
export const BOARD_ROWS = 3;
export const BOARD_SIZE = BOARD_COLS * BOARD_ROWS;

export const colOf = (slot: number): number => slot % BOARD_COLS;
export const rowOf = (slot: number): number => Math.floor(slot / BOARD_COLS);

/** 隣の枠。上下左右の4方向（斜めは隣ではない） */
export function neighbors(slot: number, to: 'adj' | 'left' | 'right' = 'adj'): number[] {
  const c = colOf(slot), r = rowOf(slot);
  const out: number[] = [];
  if ((to === 'adj' || to === 'left') && c > 0) out.push(slot - 1);
  if ((to === 'adj' || to === 'right') && c < BOARD_COLS - 1) out.push(slot + 1);
  if (to === 'adj' && r > 0) out.push(slot - BOARD_COLS);
  if (to === 'adj' && r < BOARD_ROWS - 1) out.push(slot + BOARD_COLS);
  return out;
}

/**
 * 正面の相手の枠。同じ列のいちばん前（上の段）。その列が空なら、
 * いちばん近い列の前から
 */
export function facingSlot(occupied: (i: number) => boolean, slot: number): number {
  const c = colOf(slot);
  let best = -1, bd = Infinity;
  for (let i = 0; i < BOARD_SIZE; i++) {
    if (!occupied(i)) continue;
    const d = Math.abs(colOf(i) - c) * 10 + rowOf(i);
    if (d < bd) { bd = d; best = i; }
  }
  return best;
}

export function starOf(u: RunUnit): 1 | 2 | 3 {
  return u.copies >= 9 ? 3 : u.copies >= 3 ? 2 : 1;
}
