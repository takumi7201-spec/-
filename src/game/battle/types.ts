import type { ElementId } from '../../voxel/palette';
import type { Engraving } from '../engraving';
import type { Role } from '../data/revos';

export type Side = 0 | 1;

export type ModKind = 'atk' | 'def' | 'spd' | 'dealt' | 'taken';

export interface Mod {
  kind: ModKind;
  /** 乗算に使う増減率。+0.18 なら ×1.18 */
  value: number;
  /** 残り行動数。対象の行動が回るたびに1減る */
  turns: number;
  /**
   * 時間で切れるバフの失効時刻（BattleSim.clock、戦闘内の秒）。
   * 行動数ではなく「秒」で効くものにだけ使う。
   */
  until?: number;
  source: string;
}

export interface StatusEffect {
  kind: 'burn' | 'regen' | 'poison';
  /** 残りの刻み数。火傷・毒は STATUS_TICK 秒ごと、再生は 1 秒ごとに 1 減る */
  turns: number;
  /**
   * burn / poison: 1行動あたりに削る最大体力の割合 / regen: 1回あたりの回復量（実数）
   *
   * 毒は火傷と違って重なる。重ねた数はここに足し込んで持つ——
   * スタック数を別に持つと、同じ意味の値が2つになって片方だけ腐る。
   */
  value: number;
  /**
   * regen の残り回復量。これを撃ち切ると、期限前でも消える。
   *
   * 「5秒かけて総量Xを回復」を秒だけで表すと、速い個体ほど多く受け取る。
   * 総量を持たせて上限を切れば、受け取りの早さだけが速度で変わる。
   */
  pool?: number;
  /** 時間で切れるものの失効時刻（Mod.until と同じ単位） */
  until?: number;
  source: string;
}

export interface Shield {
  amount: number;
  turns: number;
}

/** 編成に入れる1体分の入力 */
export interface RevosInstance {
  uid: string;
  defId: string;
  level: number;
  /** クリーン度 C（0-100） */
  clean: number;
  /** スキルレベル（重複強化）1-5 */
  skillLevel: number;
  /** 刻印。クリーン度の倍率とは別枠で、最後に足す加算 */
  engraving?: Engraving;
}

export interface TeamSetup {
  members: RevosInstance[];
  /** members のインデックス。並びは初期の横位置にだけ使う——立ち位置は役職が決める */
  order: number[];
}

export interface Fighter {
  uid: string;
  defId: string;
  name: string;
  element: ElementId;
  role: Role;
  /** 特性と必殺の id。毎回データ表を引かないよう、組んだときに控える */
  passive: string;
  odId: string;
  side: Side;
  slot: number;
  level: number;
  clean: number;
  skillLevel: number;
  maxHp: number;
  hp: number;
  atk: number;
  def: number;
  spd: number;
  basicPower: number;
  /** 戦場の位置。x は横、z は奥行き（自軍 0 は +z 側、敵 1 は −z 側） */
  x: number;
  z: number;
  /** 1ステップ前の位置。描画はここと今の位置のあいだを補間する */
  px: number;
  pz: number;
  /** 行動ゲージ。1 に届いたら次の攻撃を出せる。追撃系の効果で 1 を超えることもある */
  ready: number;
  od: number;
  alive: boolean;
  mods: Mod[];
  statuses: StatusEffect[];
  shield: Shield | null;
  /** いま狙っている相手 */
  target: string | null;
  /** 構え中の技。打点の時刻が来たら当たる。構えている間は動かない */
  cast: Cast | null;
  /** この時刻までは自分で動けない（引き寄せ・足止め） */
  rootedUntil: number;
  /** 「堆積」など戦闘中の永続蓄積 */
  stacks: Record<string, number>;
  /** 累積の与ダメ・被ダメ（リザルト表示用） */
  dealt: number;
  taken: number;
  healed: number;
  kills: number;
}

export interface Cast {
  kind: 'basic' | 'od';
  /** 構えた時点で狙った相手。打点で倒れていれば選び直す */
  target: string | null;
  /** 打点の時刻（戦闘内の秒） */
  at: number;
}

export type BattleEvent =
  | { t: 'start'; fighters: FighterSnapshot[] }
  | { t: 'action'; uid: string; kind: 'basic' | 'od'; name: string; targets: string[]; ranged: boolean; windup: number }
  | { t: 'damage'; uid: string; from: string; amount: number; crit: boolean; eff: 1.5 | 1 | 0.7; hp: number; shielded: number }
  | { t: 'heal'; uid: string; from: string; amount: number; hp: number }
  | { t: 'shield'; uid: string; amount: number }
  | { t: 'mod'; uid: string; kind: ModKind; value: number; turns: number; label: string }
  | { t: 'status'; uid: string; kind: 'burn' | 'poison'; applied: boolean }
  | { t: 'statusTick'; uid: string; kind: 'burn' | 'regen' | 'poison'; amount: number; hp: number }
  | { t: 'od'; uid: string; value: number }
  | { t: 'odReady'; uid: string }
  | { t: 'ko'; uid: string; by: string }
  | { t: 'pull'; uid: string; by: string }
  | { t: 'leap'; uid: string; to: string }
  | { t: 'passive'; uid: string; label: string }
  | { t: 'end'; winner: Side | -1; turns: number };

export interface FighterSnapshot {
  uid: string;
  defId: string;
  name: string;
  element: ElementId;
  side: Side;
  x: number;
  z: number;
  maxHp: number;
  hp: number;
  atk: number;
  def: number;
  spd: number;
  od: number;
}

export const ELEMENT_CYCLE: Record<string, string> = {
  flame: 'gale',
  gale: 'terra',
  terra: 'aqua',
  aqua: 'flame',
};

/** 有利 1.5 / 不利 0.7 / それ以外 1.0 */
export function elementFactor(attacker: ElementId, defender: ElementId): 1.5 | 1 | 0.7 {
  if (attacker === 'null' || defender === 'null') return 1;
  if (ELEMENT_CYCLE[attacker] === defender) return 1.5;
  if (ELEMENT_CYCLE[defender] === attacker) return 0.7;
  return 1;
}
