import type { ElementId } from '../../voxel/palette';

export type Row = 'front' | 'back';
export type Side = 0 | 1;
export type Stance = 'aggressive' | 'balanced' | 'conservative';
export type TargetPref = 'weakest' | 'strongest' | 'backline';
export type FormationId = 'wedge' | 'ring' | 'rush' | 'metro';

export interface Formation {
  id: FormationId;
  name: string;
  desc: string;
  frontDamage: number;
  backHitRateBonus: number;
  allDamageTaken: number;
  allDamageDealt: number;
  spdMul: number;
  defMul: number;
  startOd: number;
  odGainMul: number;
}

export const FORMATIONS: Record<FormationId, Formation> = {
  wedge: {
    id: 'wedge', name: '楔陣', desc: '前列 与ダメ +20% / 後列 被弾率 +5pt',
    frontDamage: 1.2, backHitRateBonus: 0.05, allDamageTaken: 1, allDamageDealt: 1,
    spdMul: 1, defMul: 1, startOd: 0, odGainMul: 1,
  },
  ring: {
    id: 'ring', name: '環陣', desc: '全体 被ダメ −12% / 与ダメ −8%',
    frontDamage: 1, backHitRateBonus: 0, allDamageTaken: 0.88, allDamageDealt: 0.92,
    spdMul: 1, defMul: 1, startOd: 0, odGainMul: 1,
  },
  rush: {
    id: 'rush', name: '疾陣', desc: '全体 SPD +15% / DEF −10%',
    frontDamage: 1, backHitRateBonus: 0, allDamageTaken: 1, allDamageDealt: 1,
    spdMul: 1.15, defMul: 0.9, startOd: 0, odGainMul: 1,
  },
  metro: {
    id: 'metro', name: '律陣', desc: '開始OD +40 / OD獲得 +15%',
    frontDamage: 1, backHitRateBonus: 0, allDamageTaken: 1, allDamageDealt: 1,
    spdMul: 1, defMul: 1, startOd: 40, odGainMul: 1.15,
  },
};

export type ModKind = 'atk' | 'def' | 'spd' | 'dealt' | 'taken';

export interface Mod {
  kind: ModKind;
  /** 乗算に使う増減率。+0.18 なら ×1.18 */
  value: number;
  /** 残り行動数。対象の行動が回るたびに1減る */
  turns: number;
  source: string;
}

export interface StatusEffect {
  kind: 'burn';
  turns: number;
  /** 最大HP比 */
  value: number;
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
}

export interface TeamSetup {
  members: RevosInstance[];
  /** members のインデックス。0番目が前列、以降が昇格優先順 */
  order: [number, number, number];
  formation: FormationId;
  stances?: Stance[];
  targetPrefs?: TargetPref[];
}

export interface Fighter {
  uid: string;
  defId: string;
  name: string;
  element: ElementId;
  side: Side;
  slot: number;
  row: Row;
  level: number;
  clean: number;
  skillLevel: number;
  maxHp: number;
  hp: number;
  atk: number;
  def: number;
  spd: number;
  basicPower: number;
  av: number;
  od: number;
  alive: boolean;
  mods: Mod[];
  statuses: StatusEffect[];
  shield: Shield | null;
  stance: Stance;
  targetPref: TargetPref;
  /** 「堆積」など戦闘中の永続蓄積 */
  stacks: Record<string, number>;
  /** 昇格を遅延させられている残り行動数 */
  promoteDelay: number;
  /** 「断層牽引」で強制的に前列にされている残り行動数 */
  draggedTurns: number;
  /** 累積の与ダメ・被ダメ（リザルト表示用） */
  dealt: number;
  taken: number;
  healed: number;
  kills: number;
}

export type BattleEvent =
  | { t: 'start'; fighters: FighterSnapshot[] }
  | { t: 'turnBegin'; uid: string }
  | { t: 'action'; uid: string; kind: 'basic' | 'od'; name: string; targets: string[] }
  | { t: 'damage'; uid: string; from: string; amount: number; crit: boolean; eff: 1.5 | 1 | 0.7; hp: number; shielded: number }
  | { t: 'heal'; uid: string; from: string; amount: number; hp: number }
  | { t: 'shield'; uid: string; amount: number }
  | { t: 'mod'; uid: string; kind: ModKind; value: number; turns: number; label: string }
  | { t: 'status'; uid: string; kind: 'burn'; applied: boolean }
  | { t: 'statusTick'; uid: string; kind: 'burn'; amount: number; hp: number }
  | { t: 'od'; uid: string; value: number }
  | { t: 'odReady'; uid: string }
  | { t: 'ko'; uid: string; by: string }
  | { t: 'promote'; uid: string; from: Row; to: Row }
  | { t: 'passive'; uid: string; label: string }
  | { t: 'turnEnd'; uid: string }
  | { t: 'end'; winner: Side | -1; turns: number };

export interface FighterSnapshot {
  uid: string;
  defId: string;
  name: string;
  element: ElementId;
  side: Side;
  row: Row;
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
