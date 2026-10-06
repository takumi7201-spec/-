import { REVOS, getRevos, type RevosDef } from './revos';
import type { TeamSetup } from '../battle/types';
import type { BiomeId } from '../../voxel/palette';
import { Rng } from '../../voxel/VoxelPainter';
import { ENGRAVE_PATTERNS, buildEngraving } from '../engraving';
import { stageEngravePattern } from './stages';
import { isWall } from '../battle/roles';

/**
 * コロシアム。
 *
 * 段は固定表になり、抜ければ終わる。巨獣も日替わりも1日1回で終わる。
 * 「育て切ったあとに、まだ測るものがある」場所がどこにも無かった——
 * レートはそのために置く。勝てば上がり、負ければ下がる1本の数字で、
 * 上限も終わりも無い。
 *
 * 相手は CPU。レベルはこちらの編成に合わせる——レートで測りたいのは
 * 育成量ではなく顔ぶれの噛み合いなので、そこに差を付けない。代わりに
 * レートが上がるほど相手の顔ぶれ・クリーン度・刻印が良くなる。
 */

export interface ColosseumState {
  rate: number;
  best: number;
  wins: number;
  losses: number;
  /** 連勝。負けで 0 に戻る */
  streak: number;
  bestStreak: number;
}

export const COLOSSEUM_START = 1200;
/** これより下がらない。下げ止まりが無いと、負け越した人が戻ってこられない */
export const COLOSSEUM_FLOOR = 800;
/** 1戦で動く幅の係数（Elo の K） */
const K = 32;

export interface ColosseumTier {
  at: number;
  name: string;
  biome: BiomeId;
  /** 相手に出るレア度の上限 */
  rarityCap: 1 | 2 | 3 | 4 | 5;
  /** 相手の刻印の等級。0 は刻印なし */
  grade: number;
}

/**
 * 階級。名前は地層の硬さから採る——数字だけだと、上がった実感が
 * 「数字が増えた」以外に無い。
 */
export const COLOSSEUM_TIERS: ColosseumTier[] = [
  { at: 0, name: '露頭級', biome: 'canyon', rarityCap: 2, grade: 0 },
  { at: 1250, name: '砂層級', biome: 'canyon', rarityCap: 3, grade: 1 },
  { at: 1400, name: '頁岩級', biome: 'frostpeak', rarityCap: 3, grade: 2 },
  { at: 1500, name: '石灰級', biome: 'tidehollow', rarityCap: 4, grade: 3 },
  { at: 1600, name: '玄武級', biome: 'emberfield', rarityCap: 4, grade: 4 },
  { at: 1700, name: '基盤級', biome: 'permitzone', rarityCap: 5, grade: 5 },
];

export function tierOf(rate: number): ColosseumTier {
  let hit = COLOSSEUM_TIERS[0];
  for (const t of COLOSSEUM_TIERS) if (rate >= t.at) hit = t;
  return hit;
}

/** 次の階級までの残り。頭打ちなら null */
export function nextTier(rate: number): { tier: ColosseumTier; need: number } | null {
  const t = COLOSSEUM_TIERS.find((x) => x.at > rate);
  return t ? { tier: t, need: t.at - rate } : null;
}

export function defaultColosseum(): ColosseumState {
  return { rate: COLOSSEUM_START, best: COLOSSEUM_START, wins: 0, losses: 0, streak: 0, bestStreak: 0 };
}

/**
 * 次の相手を決める種。
 *
 * レートと戦績から作るので、挑む前の予告と実際に出てくる相手が必ず一致し、
 * 1戦ごとに替わる。画面を開き直しても同じ相手が出る——「相手を見てから
 * 引き直す」ができないように、乱数ではなく状態から引く。
 */
export function matchSeed(st: ColosseumState): number {
  return ((st.rate * 7919) ^ ((st.wins + st.losses + 1) * 104729) ^ (st.best * 31)) >>> 0;
}

const RIVAL_NAMES = [
  'ドーソン', 'カルミナ', 'オルド', 'ヴェスパ', 'ギルマン', 'セラ', 'ハウエル', 'ノヴァク',
  'リーデル', 'タリス', 'バーグ', 'クレイ', 'モーガ', 'ユスティ', 'ランベル', 'シグル',
];
const RIVAL_TITLES = [
  '北嶺の', '深層の', '乾谷の', '干潟の', '灰原の', '白亜の', '裂罅の', '層序の',
];

export interface Rival {
  name: string;
  rate: number;
  team: TeamSetup;
}

/** 相手のレート。自分の前後に振る——同じ相手とばかり当たらないように */
function rivalRate(rng: Rng, mine: number): number {
  return Math.max(COLOSSEUM_FLOOR, Math.round(mine + (rng.next() - 0.5) * 160));
}

/**
 * 相手の編成。
 *
 * 壁・支援・攻め手を1つずつ置いてから残りを埋める。完全な無作為だと、
 * 後衛5体のような「挑む意味のない相手」が普通に出てくる。
 */
function pickTeam(rng: Rng, tier: ColosseumTier): RevosDef[] {
  const pool = REVOS.filter((r) => !r.eventOnly && r.rarity <= tier.rarityCap
    && (!r.permitOnly || tier.rarityCap >= 5));
  const out: RevosDef[] = [];
  const take = (pred: (r: RevosDef) => boolean): void => {
    const list = pool.filter((r) => pred(r) && !out.includes(r));
    if (list.length > 0) out.push(list[Math.floor(rng.next() * list.length)]);
  };
  take((r) => isWall(r.role));
  take((r) => r.role === 'Healer' || r.role === 'Buffer');
  take((r) => r.role === 'Striker' || r.role === 'Breaker' || r.role === 'Apex' || r.role === 'Finisher');
  let guard = 0;
  while (out.length < 5 && guard++ < 64) {
    const r = pool[Math.floor(rng.next() * pool.length)];
    if (!out.includes(r)) out.push(r);
  }
  return out;
}

/**
 * 最上級より上での上乗せ。
 *
 * 階級は 1700 で打ち止めなので、そこから先は相手の顔ぶれが良くならない。
 * CPU 相手のレートは、相手が強くなるのをやめた時点から青天井に上がる——
 * 1700 を超えたぶんだけ体力・攻撃・防御を盛って、止まる場所を作る。
 */
function rivalPower(rate: number): number {
  return Math.min(1.6, 1 + Math.max(0, rate - 1700) / 1800);
}

export function buildRival(
  st: ColosseumState,
  anchor: { level: number; clean: number; size: number },
): Rival {
  const seed = matchSeed(st);
  const rng = new Rng(seed);
  const tier = tierOf(st.rate);
  const rate = rivalRate(rng, st.rate);
  const name = `${RIVAL_TITLES[Math.floor(rng.next() * RIVAL_TITLES.length)]}${
    RIVAL_NAMES[Math.floor(rng.next() * RIVAL_NAMES.length)]}`;
  const picks = pickTeam(rng, tier);
  // クリーン度はレートで上がる。レベルはこちらに合わせる——
  // 測りたいのは育成量ではなく、顔ぶれの噛み合い
  const clean = Math.max(55, Math.min(95, Math.round(55 + (st.rate - COLOSSEUM_FLOOR) / 28)));
  const level = Math.max(1, anchor.level);
  const power = rivalPower(st.rate);
  return {
    name,
    rate,
    team: {
      members: picks.map((def, i) => ({
        uid: `col${i}`,
        defId: def.id,
        level,
        clean,
        skillLevel: 1,
        boost: power !== 1 ? { hp: power, atk: power, def: power } : undefined,
        engraving: tier.grade > 0
          ? buildEngraving(
            ENGRAVE_PATTERNS.find((p) => p.id === stageEngravePattern(def.id)) ?? ENGRAVE_PATTERNS[0],
            tier.grade,
          )
          : undefined,
      })),
      order: picks.map((_, i) => i),
    },
  };
}

/** 勝ったときに動く幅。Elo そのまま */
export function rateDelta(mine: number, theirs: number, won: boolean): number {
  const expected = 1 / (1 + Math.pow(10, (theirs - mine) / 400));
  const d = Math.round(K * ((won ? 1 : 0) - expected));
  // 0 で止めない。格下に勝っても1は動かないと、上を叩き続ける意味が消える
  return won ? Math.max(1, d) : Math.min(-1, d);
}

/** 1戦の報酬。勝てばレートぶん厚く、負けても手ぶらでは帰さない */
export function colosseumCoins(rate: number, won: boolean): number {
  return won ? 100 + Math.floor(rate / 6) : 50;
}

export function revosNameOf(defId: string): string {
  return getRevos(defId).name;
}
