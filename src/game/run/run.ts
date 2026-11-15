import { KIT_TRAIT } from '../data/traits';
import { getRevos } from '../data/revos';
import { EFFECT_NAMES } from './describe';
import { RUN_UNITS, runDef } from './units';
import { runBattle, applyGrowth, effectValue, type RunBattleResult } from './battle';
import { BOARD_SIZE, EFFECT_KINDS, starOf, neighbors, type AbilityDef, type RunUnit, type Stat } from './types';

/**
 * ランの進み方。ショップと、勝ち負けの後始末。
 *
 *   1周 = 店で整える → 戦う。10勝で達成、ライフが尽きたら終わり。
 *   毎周 10 コイン。買う 3、売る ★の数、品替え 1。
 *   同じユニットを買うと重なる（3で★2、9で★3）。重ねても育ちは消えない。
 */

export const RUN_WINS = 10;
export const RUN_LIVES = 5;
export const GOLD_PER_ROUND = 10;
export const BUY_COST = 3;
export const REROLL_COST = 1;
export const SHOP_SIZE = 5;

export interface RunState {
  round: number;
  gold: number;
  wins: number;
  lives: number;
  board: (RunUnit | null)[];
  shop: (string | null)[];
  /** 店に並びうるユニット（図鑑で見つけたもの） */
  pool: string[];
  rng: number;
  nextUid: number;
  /** 直前の戦闘の後に起きたこと（段5の働きなど）。店の上に一度だけ出す */
  lastNotes?: string[];
}

export function rand(s: { rng: number }): number {
  s.rng = (s.rng * 1664525 + 1013904223) >>> 0;
  return s.rng / 0x100000000;
}

/** その周に店へ出る段の上限。2周ごとに1段上がる */
export function maxTier(round: number): number {
  return Math.min(5, 1 + Math.floor((round - 1) / 2));
}

export function newRun(pool: string[], seed: number): RunState {
  const s: RunState = {
    round: 1, gold: 0, wins: 0, lives: RUN_LIVES,
    board: Array(BOARD_SIZE).fill(null), shop: [],
    pool: pool.filter((id) => RUN_UNITS.some((u) => u.id === id)),
    rng: (seed >>> 0) || 1, nextUid: 1,
  };
  startRound(s);
  return s;
}

export function startRound(s: RunState): void {
  s.gold = GOLD_PER_ROUND;
  rollShop(s);
}

/** 段を先に引き、その段から1体。上限の段は少し出やすい */
function pickShopUnit(s: RunState): string | null {
  const top = maxTier(s.round);
  const tiers: number[] = [];
  for (let t = 1; t <= top; t++) {
    if (!s.pool.some((id) => runDef(id).tier === t)) continue;
    const w = t === top ? 3 : 2;
    for (let i = 0; i < w; i++) tiers.push(t);
  }
  if (tiers.length === 0) return null;
  const tier = tiers[Math.floor(rand(s) * tiers.length)];
  const ids = s.pool.filter((id) => runDef(id).tier === tier);
  return ids[Math.floor(rand(s) * ids.length)];
}

export function rollShop(s: RunState): void {
  s.shop = Array.from({ length: SHOP_SIZE }, () => pickShopUnit(s));
}

export function reroll(s: RunState): boolean {
  if (s.gold < REROLL_COST) return false;
  s.gold -= REROLL_COST;
  rollShop(s);
  return true;
}

/** 盤面の外での能力（買った・売った・戦闘の後）。育ちとして書き込む */
function applyOutside(s: RunState, slot: number, ab: AbilityDef): void {
  const self = s.board[slot];
  if (!self) return;
  const star = starOf(self);
  const scale = ab.stat === 'slow' || ab.stat === 'haste' || ab.stat === 'charge' ? 1 + 0.5 * (star - 1) : ab.stat === 'cd' ? 1 : star;
  const add = ab.add * scale;
  const at = (i: number): RunUnit | null => (i >= 0 && i < BOARD_SIZE ? s.board[i] : null);
  let targets: RunUnit[] = [];
  switch (ab.to) {
    case 'self': targets = [self]; break;
    case 'left': case 'right': case 'adj':
      targets = neighbors(slot, ab.to).map(at).filter((x): x is RunUnit => !!x); break;
    case 'allies': targets = s.board.filter((x): x is RunUnit => !!x); break;
    case 'others': targets = s.board.filter((x): x is RunUnit => !!x && x !== self); break;
    case 'kin': {
      const k = KIT_TRAIT[self.defId];
      targets = s.board.filter((x): x is RunUnit => !!x && x !== self && KIT_TRAIT[x.defId] === k);
      break;
    }
  }
  // 戦闘の外では、戦闘中だけの上乗せは意味を持たない。育ちだけを書く
  if (!ab.perm) return;
  for (const t of targets) t.perm[ab.stat] = (t.perm[ab.stat] ?? 0) + add;
}

function fireOutside(s: RunState, slot: number, when: AbilityDef['when']): void {
  const u = s.board[slot];
  if (!u) return;
  for (const ab of runDef(u.defId).abilities) if (ab.when === when) applyOutside(s, slot, ab);
}

/**
 * 店の i 番目を買う。同じユニットが盤面に居れば重ねる。居なければ slot
 * （省略時は左から最初の空き）へ置く。置けなければ false。
 */
export function buy(s: RunState, i: number, slot?: number): boolean {
  const id = s.shop[i];
  if (!id || s.gold < BUY_COST) return false;
  const same = s.board.findIndex((u) => u?.defId === id && starOf(u) < 3);
  let at: number;
  if (same >= 0) {
    at = same;
    s.board[same]!.copies++;
  } else {
    at = slot !== undefined && !s.board[slot] ? slot : s.board.indexOf(null);
    if (at < 0) return false;
    s.board[at] = { uid: `r${s.nextUid++}`, defId: id, copies: 1, perm: {} };
  }
  s.gold -= BUY_COST;
  s.shop[i] = null;
  fireOutside(s, at, 'buy');
  return true;
}

export function sell(s: RunState, slot: number): boolean {
  const u = s.board[slot];
  if (!u) return false;
  fireOutside(s, slot, 'sell');
  s.gold += starOf(u);
  s.board[slot] = null;
  return true;
}

export function move(s: RunState, from: number, to: number): void {
  const a = s.board[from];
  s.board[from] = s.board[to];
  s.board[to] = a;
}

/**
 * 段5の、戦闘の後に働くもの。
 *   大地の恵み … 回復した量の1/5を、隣の味方の盾に永続で足す
 *   喰らう     … 隣でいちばん段の低い味方を喰らい、その数値を永続で得る（喰らった味方は消える）
 * 起きたことを文で返す（画面の結果に出す）
 */
export function afterBattleSpecials(board: (RunUnit | null)[], healed: Map<string, number>): string[] {
  const notes: string[] = [];
  board.forEach((u, i) => {
    if (!u || runDef(u.defId).special !== 'bloom') return;
    const amt = Math.round((healed.get(u.uid) ?? 0) / 5);
    if (amt <= 0) return;
    for (const n of neighbors(i)) {
      const t = board[n];
      if (t) t.perm.shield = (t.perm.shield ?? 0) + amt;
    }
    notes.push(`${getRevos(u.defId).name}の大地の恵み：隣の味方の盾 +${amt}（永続）`);
  });
  board.forEach((u, i) => {
    if (!u || runDef(u.defId).special !== 'devour') return;
    let vi = -1;
    for (const n of neighbors(i)) {
      const t = board[n];
      if (!t || runDef(t.defId).special === 'devour') continue;
      if (vi < 0 || runDef(t.defId).tier < runDef(board[vi]!.defId).tier) vi = n;
    }
    if (vi < 0) return;
    const victim = board[vi]!;
    const vd = runDef(victim.defId);
    const got: string[] = [];
    for (const k of EFFECT_KINDS) {
      const v = effectValue(vd, victim, k);
      if (v > 0) { u.perm[k] = (u.perm[k] ?? 0) + v; got.push(`${EFFECT_NAMES[k]}+${Math.round(v * 10) / 10}`); }
    }
    board[vi] = null;
    notes.push(`${getRevos(u.defId).name}が${getRevos(victim.defId).name}を喰らった（${got.join('・')}、永続）`);
  });
  return notes;
}

/** 戦闘の結果を書き戻し、次の周へ進める */
export function finishBattle(s: RunState, res: RunBattleResult): void {
  for (const u of s.board) {
    if (!u) continue;
    const g = res.growth[0].get(u.uid);
    if (g) applyGrowth(u, g);
  }
  for (let i = 0; i < BOARD_SIZE; i++) {
    if (res.winner === 0) fireOutside(s, i, 'win');
    fireOutside(s, i, 'end');
  }
  s.lastNotes = afterBattleSpecials(s.board, res.healed);
  if (res.winner === 0) s.wins++;
  else if (res.winner === 1) s.lives--;
  s.round++;
  if (!isOver(s)) startRound(s);
}

export function isOver(s: RunState): boolean {
  return s.wins >= RUN_WINS || s.lives <= 0;
}

export function fight(s: RunState, foe: (RunUnit | null)[], events = false): RunBattleResult {
  return runBattle(s.board, foe, s.round, { events });
}

/* ------------------------------------------------------------ 相手を組む */

/**
 * 店の1枠がどれだけ欲しいか。重ねられる＞段が高い＞同じ系統が居る。
 * 好み（prefer）があれば、その系統を強く取りにいく。
 */
function want(s: RunState, id: string, prefer?: string): number {
  const d = runDef(id);
  let w = d.tier * 2;
  if (s.board.some((u) => u?.defId === id && starOf(u) < 3)) w += 6;
  const k = KIT_TRAIT[id];
  const kin = s.board.filter((u) => u && KIT_TRAIT[u.defId] === k).length;
  w += kin;
  if (prefer && k === prefer) w += 4;
  return w;
}

function unitWorth(u: RunUnit): number {
  return runDef(u.defId).tier * 2 * starOf(u) + Object.values(u.perm).reduce((a, b) => a + Math.abs(b ?? 0), 0) * 0.5;
}

/** 1周ぶんの買い物を、店の規則どおりにこなす */
export function botShop(s: RunState, prefer?: string): void {
  let rerolls = 0;
  for (let guard = 0; guard < 30; guard++) {
    // 欲しい順に並べ、買えるものを買う
    const opts = s.shop.map((id, i) => ({ id, i, w: id ? want(s, id, prefer) : -1 })).filter((o) => o.id).sort((a, b) => b.w - a.w);
    const best = opts[0];
    if (best && s.gold >= BUY_COST) {
      const canStack = s.board.some((u) => u?.defId === best.id && starOf(u) < 3);
      if (canStack || s.board.includes(null)) { buy(s, best.i); continue; }
      // 満員なら、いちばん軽い1体と入れ替える価値があるか
      let wi = -1, ww = Infinity;
      s.board.forEach((u, i) => { if (u && unitWorth(u) < ww) { ww = unitWorth(u); wi = i; } });
      if (wi >= 0 && best.w > ww + 2) { sell(s, wi); buy(s, best.i, wi); continue; }
    }
    if (s.gold >= BUY_COST + REROLL_COST && rerolls < 4) { reroll(s); rerolls++; continue; }
    break;
  }
  // 並び: 同じ系統を隣り合わせる（隣に効く能力が噛み合うように）
  const units = s.board.filter((u): u is RunUnit => !!u);
  units.sort((a, b) => (KIT_TRAIT[a.defId] ?? '').localeCompare(KIT_TRAIT[b.defId] ?? ''));
  s.board = Array.from({ length: BOARD_SIZE }, (_, i) => units[i] ?? null);
}

/**
 * その周の相手を組む。ボットが1周目から同じ店の規則で買い進め、
 * 毎周自分の写しと戦って育ちを得る。勝ち負けの後の能力は半分の確率で回す。
 */
export function buildOpponent(pool: string[], round: number, seed: number, prefer?: string): (RunUnit | null)[] {
  const s = newRun(pool, seed);
  for (let r = 1; r <= round; r++) {
    s.round = r;
    s.gold = GOLD_PER_ROUND;
    rollShop(s);
    botShop(s, prefer);
    if (r === round) break;
    const mirror = s.board.map((u) => (u ? { ...u, uid: `${u.uid}m`, perm: { ...u.perm } } : null));
    const res = runBattle(s.board, mirror, r);
    for (const u of s.board) {
      if (!u) continue;
      const g = res.growth[0].get(u.uid);
      if (g) applyGrowth(u, g);
    }
    const won = rand(s) < 0.5;
    for (let i = 0; i < BOARD_SIZE; i++) {
      if (won) fireOutside(s, i, 'win');
      fireOutside(s, i, 'end');
    }
    afterBattleSpecials(s.board, res.healed);
  }
  return s.board;
}

export type { Stat };
