import type { Role } from '../data/revos';

/**
 * 役職ごとの立ち回り。
 *
 * 戦場で「どこに立ち、誰を狙い、どこまで踏み込むか」を役職だけで決める。
 * 陣形や狙いの設定を無くしたので、編成で選ぶのは顔ぶれそのものになる——
 * 壁役を入れれば前が持ち、特攻役を入れれば後衛まで刃が届く。
 */
export interface Tactic {
  /** 攻撃が届く距離（中心間）。2 を超えるものは射撃として扱う */
  range: number;
  /** 移動の速さの倍率 */
  move: number;
  /** 開戦時の奥行き。0 が最前列、2 が最後列 */
  depth: number;
  /**
   * 敵の壁（壁役・守護役）の間合いに入ると、その壁に足を止められるか。
   * 近接で真っ直ぐ後衛へ向かう役を、壁が受け止めるための規則
   */
  held: boolean;
  /** 味方の壁が接敵するまで、その後ろから前へ出ない */
  behindWall: boolean;
  /** 最寄りの敵とこれだけの間を保つ。支援役が下がる理由 */
  keepAway: number;
}

export const TACTICS: Record<Role, Tactic> = {
  // 壁。前に立ち、近づいた敵を引き受ける
  Tank: { range: 1.65, move: 0.85, depth: 0, held: false, behindWall: false, keepAway: 0 },
  // 守り手。狙われている味方の脇へ回り、攻撃を肩代わりする
  Guardian: { range: 1.65, move: 0.95, depth: 0, held: false, behindWall: false, keepAway: 0 },
  // 前線の殴り合い。壁の後ろから、壁がぶつかったら出る
  Striker: { range: 1.65, move: 1.0, depth: 1, held: true, behindWall: true, keepAway: 0 },
  Breaker: { range: 1.65, move: 0.95, depth: 1, held: true, behindWall: true, keepAway: 0 },
  Apex: { range: 1.75, move: 0.95, depth: 1, held: true, behindWall: true, keepAway: 0 },
  'All-round': { range: 1.65, move: 1.0, depth: 1, held: true, behindWall: true, keepAway: 0 },
  // 弱った相手を追う。狙いが瀕死なら壁を抜ける（chooseTarget 側で判定）
  Finisher: { range: 1.65, move: 1.05, depth: 1, held: true, behindWall: true, keepAway: 0 },
  // 特攻。壁を無視して後衛へ突っ込む
  Sprinter: { range: 1.65, move: 1.35, depth: 1, held: false, behindWall: false, keepAway: 0 },
  // 射撃。中ほどから撃ち、寄られたら下がる
  Technical: { range: 4.8, move: 0.95, depth: 2, held: false, behindWall: false, keepAway: 2.6 },
  Debuffer: { range: 4.5, move: 1.0, depth: 2, held: false, behindWall: false, keepAway: 2.6 },
  // 支援。最後列から離れない
  Healer: { range: 5.5, move: 0.95, depth: 2, held: false, behindWall: false, keepAway: 3.6 },
  Buffer: { range: 5.5, move: 0.95, depth: 2, held: false, behindWall: false, keepAway: 3.6 },
};

/** 前に立って味方を守る役 */
export function isWall(role: Role): boolean {
  return role === 'Tank' || role === 'Guardian';
}

/** 後ろから支える役。特攻役がまず狙う相手 */
export function isBackliner(role: Role): boolean {
  return role === 'Healer' || role === 'Buffer' || role === 'Debuffer' || role === 'Technical';
}

export function isRanged(role: Role): boolean {
  return TACTICS[role].range > 2;
}

/** 立ち位置の呼び名。編成画面で「この子はどこに立つか」を先に読ませる */
export function postName(role: Role): string {
  if (role === 'Sprinter') return '特攻';
  const d = TACTICS[role].depth;
  return d === 0 ? '前衛' : d === 1 ? '中衛' : '後衛';
}

/** 戦場での動き。役職の名前だけでは、誰を狙って何をするのかが読めない */
export const ROLE_MOVES: Record<Role, string> = {
  Tank: '味方の前に立ち、寄ってきた敵を引き受ける',
  Guardian: '狙われている味方の脇につき、攻撃を肩代わりする',
  Striker: '壁の後ろから、ぶつかった前線へ斬り込む',
  Breaker: '敵の壁を狙って崩す。壁への一撃が重い',
  Apex: '壁の後ろから出て、前線を力で押し切る',
  'All-round': '壁の後ろから、いちばん近い敵と殴り合う',
  Finisher: '弱った敵を追う。瀕死の相手なら壁をすり抜ける',
  Sprinter: '壁を無視して敵の後衛へ突っ込む。後衛への一撃が重い',
  Technical: '中ほどから撃つ。寄られたら下がる',
  Debuffer: '攻撃の強い敵を撃って削ぐ。寄られたら下がる',
  Healer: '最後列から、傷んだ味方を癒す',
  Buffer: '最後列から撃ちつつ、技で味方を押し上げる',
};
