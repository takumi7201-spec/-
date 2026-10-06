import { REVOS, getRevos, type RevosDef } from './revos';
import type { TeamSetup } from '../battle/types';
import type { BiomeId } from '../../voxel/palette';
import { Rng } from '../../voxel/VoxelPainter';
import { ENGRAVE_PATTERNS, buildEngraving } from '../engraving';
import { stageEngravePattern } from './stages';
import { isBackliner, isWall } from '../battle/roles';
import { elementFactor } from '../battle/types';

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
  /** 何を狙って組まれた隊か。札に1行で出す */
  tactic: string;
}

/** 相手のレート。自分の前後に振る——同じ相手とばかり当たらないように */
function rivalRate(rng: Rng, mine: number): number {
  return Math.max(COLOSSEUM_FLOOR, Math.round(mine + (rng.next() - 0.5) * 160));
}

/**
 * 相手の編成を組む AI。
 *
 * 無作為に5体並べると、後衛5体のような「挑む意味のない相手」が普通に出る。
 * かといって固定表にすると、レートが上がっても同じ顔ぶれが並ぶだけになる。
 * なので候補をいくつも作って、点を付けていちばん良いものを選ぶ。
 *
 * 点の付け方は3つ。
 *   かたち  壁・支え・攻め手が揃っているか（役職の偏りを嫌う）
 *   連携    特性どうしが噛み合っているか（目眩を撒く×目眩に強い、など）
 *   対策    こちらの編成に刺さるか（属性で上を取る・壁崩し・後衛狩り）
 *
 * 効き具合は階級で変える。露頭級は「かたち」しか見ない——最初の相手が
 * 対策まで組んできたら、始めたばかりの編成は何も通らない。
 */
export interface Brain {
  /** 候補を何通り作るか。多いほど良い編成を引き当てる */
  tries: number;
  shape: number;
  synergy: number;
  counter: number;
}

function brainFor(rate: number): Brain {
  if (rate < 1250) return { tries: 1, shape: 1, synergy: 0, counter: 0 };
  if (rate < 1400) return { tries: 6, shape: 1, synergy: 0.5, counter: 0 };
  if (rate < 1500) return { tries: 12, shape: 1, synergy: 1, counter: 0.5 };
  if (rate < 1600) return { tries: 20, shape: 1, synergy: 1, counter: 1 };
  if (rate < 1700) return { tries: 28, shape: 1, synergy: 1.2, counter: 1.1 };
  return { tries: 40, shape: 1, synergy: 1.4, counter: 1.3 };
}

/** 状態異常を撒く手。撒く側と、撒かれた相手に強い側を噛み合わせる */
const BURN = ['embers', 'sailheat', 'scorchring', 'greateruption', 'flamevolley'];
const DIZZY = ['firstnerve', 'nervejam'];
const POISON = ['venomgland', 'serpentvenom'];
const BLEED = ['sabertooth', 'throatbite'];
const STATUS = [...BURN, ...DIZZY, ...POISON, ...BLEED];

/** 味方を押し上げる技。攻め手と組ませて初めて効く */
const BUFFERS = ['resonantlight', 'heatshare', 'stratarecord', 'skyreign', 'rockaegis'];

function has(team: RevosDef[], ids: string[]): boolean {
  return team.some((r) => ids.includes(r.passive.id) || ids.includes(r.od.id));
}
function count(team: RevosDef[], pred: (r: RevosDef) => boolean): number {
  return team.filter(pred).length;
}

/** かたち。壁・支え・攻め手が揃っていて、役職が偏っていないか */
function shapeScore(team: RevosDef[]): number {
  const walls = count(team, (r) => isWall(r.role));
  const heals = count(team, (r) => r.role === 'Healer' || r.role === 'Buffer');
  const backs = count(team, (r) => isBackliner(r.role));
  const dmg = team.length - walls - heals;
  let v = 0;
  v += walls === 0 ? -14 : walls <= 2 ? 10 : 2;
  v += heals === 0 ? -10 : heals === 1 ? 10 : 3;
  v += dmg >= 2 ? 10 : -8;
  v += backs >= 4 ? -16 : backs === 3 ? -4 : 0;
  // 同じ役職ばかりは嫌う。壁3枚は硬いだけで、こちらが押し切れば終わる
  const roles = new Map<string, number>();
  for (const r of team) roles.set(r.role, (roles.get(r.role) ?? 0) + 1);
  for (const n of roles.values()) if (n >= 3) v -= 10;
  return v;
}

/** 連携。特性どうしが噛み合っているか */
function synergyScore(team: RevosDef[]): number {
  let v = 0;
  // 目眩を撒く × 目眩の敵に強い
  if (has(team, DIZZY) && has(team, ['compoundeye'])) v += 14;
  // 火傷を撒く × 火傷の敵への与ダメージを配る帆
  if (has(team, BURN) && has(team, ['sailheat'])) v += 12;
  // 何かしらの状態異常 × 状態異常の相手に +40%
  if (has(team, STATUS) && has(team, ['sabertooth'])) v += 14;
  // 押し上げる技 × 殴る役。支援だけ・攻め手だけでは成立しない
  if (has(team, BUFFERS) && count(team, (r) => r.atk >= 120) >= 2) v += 12;
  // 受けを厚くする組み合わせ。暴君は与も被も 1.5 なので、支えが要る
  if (has(team, ['warlord']) && count(team, (r) => r.role === 'Healer') >= 1) v += 12;
  if (has(team, ['earthbreath']) && count(team, (r) => r.role === 'Healer') >= 1) v += 8;
  // 壁 × 狙いを集める技。壁が受けている間に後ろが撃てる
  if (count(team, (r) => isWall(r.role)) >= 1 && has(team, ['glideguard'])) v += 8;
  // 属性を散らす。同じ属性で固めると、1枚の相性で全部が止まる
  const els = new Set(team.map((r) => r.element));
  v += (els.size - 1) * 4;
  const most = Math.max(...[...els].map((e) => count(team, (r) => r.element === e)));
  if (most >= 4) v -= 10;
  return v;
}

/** こちらの編成への対策。相手が何に強いかを見て組み替える */
function counterScore(team: RevosDef[], foes: RevosDef[]): number {
  if (foes.length === 0) return 0;
  let v = 0;

  // 属性で上を取る。与える側だけでなく、受ける側の相性も見る
  let adv = 0;
  for (const r of team) {
    for (const f of foes) {
      adv += elementFactor(r.element, f.element) - 1;
      adv -= (elementFactor(f.element, r.element) - 1) * 0.6;
    }
  }
  v += (adv / foes.length) * 7;

  const foeWalls = count(foes, (r) => isWall(r.role));
  const foeBacks = count(foes, (r) => isBackliner(r.role));
  const foeHeals = count(foes, (r) => r.role === 'Healer');
  const foeSpd = foes.reduce((a, r) => a + r.spd, 0) / foes.length;
  const teamSpd = team.reduce((a, r) => a + r.spd, 0) / team.length;

  // 壁が厚いなら崩し役と、防御を無視して削る手を入れる
  if (foeWalls >= 2) {
    v += count(team, (r) => r.role === 'Breaker') * 10;
    v += has(team, ['scytheclaw']) ? 8 : 0;
    v += has(team, BLEED) ? 8 : 0;
  }
  // 後衛が多いなら特攻役。壁を抜けて後ろから崩す
  if (foeBacks >= 2) v += count(team, (r) => r.role === 'Sprinter') * 10;
  // 癒し手が居るなら、削り切る手数と状態異常で回復を上回る
  if (foeHeals >= 1) {
    v += count(team, (r) => r.role === 'Finisher' || r.role === 'Apex') * 6;
    v += has(team, STATUS) ? 6 : 0;
  }
  // 速い編成には目眩と速度低下。遅い編成には速度で上を取る
  if (foeSpd >= teamSpd + 6) v += has(team, DIZZY) ? 10 : 0;
  if (foeSpd + 6 <= teamSpd) v += 6;
  return v;
}

/** その編成が何を狙って組まれたか。札に1行で出す */
function tacticOf(team: RevosDef[], foes: RevosDef[], brain: Brain): string {
  if (brain.counter <= 0) return brain.synergy > 0 ? '噛み合いで組んだ隊' : '寄せ集めの隊';
  const foeWalls = count(foes, (r) => isWall(r.role));
  const foeBacks = count(foes, (r) => isBackliner(r.role));
  const foeHeals = count(foes, (r) => r.role === 'Healer');
  if (foeWalls >= 2 && count(team, (r) => r.role === 'Breaker') > 0) return 'そちらの壁を崩しに来ている';
  if (foeBacks >= 2 && count(team, (r) => r.role === 'Sprinter') > 0) return 'そちらの後衛を狙っている';
  if (foeHeals >= 1 && has(team, STATUS)) return '回復を上回る削りで来ている';
  const els = new Set(team.map((r) => r.element));
  if (els.size <= 2) return '属性でそちらの上を取りに来ている';
  return '穴の無い組み合わせ';
}

/**
 * 候補を1つ組む。
 *
 * 完全な無作為ではなく、壁・支え・攻め手の席を先に埋めてから残りを足す。
 * その上で候補を何通りも作り、点の高いものを採る。
 */
function rollTeam(rng: Rng, pool: RevosDef[]): RevosDef[] {
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

function pickTeam(rng: Rng, tier: ColosseumTier, brain: Brain, foes: RevosDef[]): {
  team: RevosDef[]; tactic: string;
} {
  const pool = REVOS.filter((r) => !r.eventOnly && r.rarity <= tier.rarityCap
    && (!r.permitOnly || tier.rarityCap >= 5));
  let best: RevosDef[] = [];
  let bestScore = -Infinity;
  for (let i = 0; i < brain.tries; i++) {
    const cand = rollTeam(rng, pool);
    const score = shapeScore(cand) * brain.shape
      + synergyScore(cand) * brain.synergy
      + counterScore(cand, foes) * brain.counter;
    if (score > bestScore) { bestScore = score; best = cand; }
  }
  return { team: best, tactic: tacticOf(best, foes, brain) };
}

export function buildRival(
  st: ColosseumState,
  anchor: { level: number; clean: number; size: number },
  /** こちらの編成。相手はこれを見て組む——レートが上がるほど強く効く */
  myParty: string[] = [],
): Rival {
  const seed = matchSeed(st);
  const rng = new Rng(seed);
  const tier = tierOf(st.rate);
  const rate = rivalRate(rng, st.rate);
  const name = `${RIVAL_TITLES[Math.floor(rng.next() * RIVAL_TITLES.length)]}${
    RIVAL_NAMES[Math.floor(rng.next() * RIVAL_NAMES.length)]}`;
  const brain = brainFor(st.rate);
  const foes = myParty.map((id) => getRevos(id));
  const { team: picks, tactic } = pickTeam(rng, tier, brain, foes);
  // クリーン度はレートで上がる。レベルはこちらに合わせる——
  // 測りたいのは育成量ではなく、顔ぶれの噛み合い
  const clean = Math.max(55, Math.min(95, Math.round(55 + (st.rate - COLOSSEUM_FLOOR) / 28)));
  const level = Math.max(1, anchor.level);
  const power = rivalPower(st.rate);
  return {
    name,
    rate,
    tactic,
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
