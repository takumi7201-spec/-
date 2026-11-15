import { KIT_TRAIT } from '../data/traits';
import { runDef } from './units';
import {
  BOARD_SIZE, EFFECT_KINDS, starOf,
  type AbilityDef, type EffectKind, type RunUnit, type RunUnitDef, type Stat, type Target,
} from './types';

/**
 * ランの戦闘。
 *
 * 乱数を使わない。同じ盤面どうしなら必ず同じ結果になる——負けた理由を
 * 並びと育ちに求められるようにするため。
 *
 * 0.1秒刻み。各ユニットはクールダウンぶん溜まると発動し、効果を出す。
 * 体力はチームで1本。先に0にした側の勝ち。30秒を過ぎると両方に
 * 毎秒ふくらむ削り（砂嵐）が入り、決着を急がせる。
 */

export const DT = 0.1;
const BURN_TICK = 0.5;
const POISON_TICK = 2;
const STORM_AT = 30;
const TIME_CAP = 60;
/** 最短クールダウン。加速を重ねても、これより速くは回らない */
const MIN_CD = 1;

/** その周回のチームの体力 */
export function teamHp(round: number): number {
  return 40 + 12 * (round - 1);
}

export type Side = 0 | 1;

export type RunEvent =
  | { t: number; type: 'fire'; side: Side; slot: number }
  | { t: number; type: 'hit'; side: Side; amount: number; shielded: number; kind: 'dmg' | 'burn' | 'poison' | 'storm' }
  | { t: number; type: 'gain'; side: Side; kind: 'shield' | 'heal' | 'burn' | 'poison'; amount: number }
  | { t: number; type: 'grow'; side: Side; slot: number; stat: Stat; add: number; perm: boolean }
  | { t: number; type: 'end'; winner: Side | -1 };

interface Live {
  unit: RunUnit;
  def: RunUnitDef;
  slot: number;
  star: 1 | 2 | 3;
  charge: number;
  /** 戦闘中の上乗せ（育ちも、得たときに足し込む） */
  temp: Partial<Record<Stat, number>>;
}

interface Team {
  side: Side;
  units: (Live | null)[];
  hp: number;
  maxHp: number;
  shield: number;
  burn: number;
  poison: number;
}

export interface RunBattleResult {
  winner: Side | -1;
  seconds: number;
  hp: [number, number];
  /** 戦闘中に得た育ち。uid ごと。勝ち負けの後の能力は含まない */
  growth: [Map<string, Partial<Record<Stat, number>>>, Map<string, Partial<Record<Stat, number>>>];
  events: RunEvent[];
  /** uid ごとの与えたもの（削り・盾・回復の合計）。測定用 */
  output: Map<string, number>;
}

/** 効果の数値に★が掛かる割合。秒で効くもの（遅延・加速）は伸びを抑える */
function starScale(kind: Stat, star: number): number {
  if (kind === 'slow' || kind === 'haste' || kind === 'charge') return 1 + 0.5 * (star - 1);
  if (kind === 'cd') return 1;
  return star;
}

/** その個体の効果の数値。素の値×★ ＋ 育ち ＋ 戦闘中の上乗せ */
export function effectValue(def: RunUnitDef, unit: RunUnit, kind: EffectKind, temp: Partial<Record<Stat, number>> = {}): number {
  const star = starOf(unit);
  const base = (def.fire[kind] ?? 0) * starScale(kind, star);
  return Math.max(0, base + (unit.perm[kind] ?? 0) + (temp[kind] ?? 0));
}

export function cooldownOf(def: RunUnitDef, unit: RunUnit, temp: Partial<Record<Stat, number>> = {}): number {
  return Math.max(MIN_CD, def.cd + (unit.perm.cd ?? 0) + (temp.cd ?? 0));
}

export function runBattle(
  boardA: (RunUnit | null)[], boardB: (RunUnit | null)[], round: number,
  opts: { events?: boolean; hp?: [number, number] } = {},
): RunBattleResult {
  const mk = (board: (RunUnit | null)[], side: Side): Team => {
    const hp = opts.hp?.[side] ?? teamHp(round);
    return {
      side, hp, maxHp: hp, shield: 0, burn: 0, poison: 0,
      units: Array.from({ length: BOARD_SIZE }, (_, i) => {
        const u = board[i];
        if (!u) return null;
        return { unit: u, def: runDef(u.defId), slot: i, star: starOf(u), charge: u.perm.charge ?? 0, temp: {} };
      }),
    };
  };
  const teams: [Team, Team] = [mk(boardA, 0), mk(boardB, 1)];
  const events: RunEvent[] = [];
  const growth: RunBattleResult['growth'] = [new Map(), new Map()];
  const output = new Map<string, number>();
  const log = opts.events ? (e: RunEvent): void => { events.push(e); } : (): void => {};
  let t = 0;

  const credit = (l: Live, v: number): void => { output.set(l.unit.uid, (output.get(l.unit.uid) ?? 0) + v); };

  const resolve = (team: Team, self: Live, to: Target): Live[] => {
    const us = team.units;
    const live = (x: Live | null | undefined): x is Live => !!x;
    switch (to) {
      case 'self': return [self];
      case 'left': return [us[self.slot - 1]].filter(live);
      case 'right': return [us[self.slot + 1]].filter(live);
      case 'adj': return [us[self.slot - 1], us[self.slot + 1]].filter(live);
      case 'allies': return us.filter(live);
      case 'others': return us.filter(live).filter((x) => x !== self);
      case 'kin': {
        const k = KIT_TRAIT[self.def.id];
        return us.filter(live).filter((x) => x !== self && KIT_TRAIT[x.def.id] === k);
      }
    }
  };

  const applyAbility = (team: Team, self: Live, ab: AbilityDef): void => {
    for (const tgt of resolve(team, self, ab.to)) {
      const add = ab.add * starScale(ab.stat, self.star);
      if (ab.stat === 'charge') { tgt.charge += add; continue; }
      tgt.temp[ab.stat] = (tgt.temp[ab.stat] ?? 0) + add;
      if (ab.perm) {
        const g = growth[team.side];
        const cur = g.get(tgt.unit.uid) ?? {};
        cur[ab.stat] = (cur[ab.stat] ?? 0) + add;
        g.set(tgt.unit.uid, cur);
      }
      log({ t, type: 'grow', side: team.side, slot: tgt.slot, stat: ab.stat, add, perm: ab.perm });
    }
  };

  const trigger = (team: Team, self: Live, when: AbilityDef['when']): void => {
    for (const ab of self.def.abilities) if (ab.when === when) applyAbility(team, self, ab);
  };

  /** 盾を先に当てて体力を削る。通ったぶんを返す */
  const strike = (to: Team, amount: number, pierce: boolean, kind: 'dmg' | 'burn' | 'storm'): number => {
    let shielded = 0;
    if (!pierce && to.shield > 0) {
      shielded = Math.min(to.shield, amount);
      to.shield -= shielded;
    }
    const through = amount - shielded;
    to.hp -= through;
    log({ t, type: 'hit', side: to.side, amount: through, shielded, kind });
    return amount;
  };

  /** 正面の相手。同じ枠が空なら、いちばん近い枠 */
  const facing = (foe: Team, slot: number): Live | null => {
    let best: Live | null = null, bd = Infinity;
    for (const u of foe.units) {
      if (!u) continue;
      const d = Math.abs(u.slot - slot);
      if (d < bd) { bd = d; best = u; }
    }
    return best;
  };

  const fire = (team: Team, foe: Team, l: Live): void => {
    log({ t, type: 'fire', side: team.side, slot: l.slot });
    const v = (k: EffectKind): number => effectValue(l.def, l.unit, k, l.temp);
    const dmg = v('dmg');
    if (dmg > 0) {
      let d = dmg;
      if (l.def.execute && foe.hp < foe.maxHp / 2) d *= l.def.execute;
      if (l.def.exploit && (foe.burn > 0 || foe.poison > 0)) d *= l.def.exploit;
      for (let i = 0; i < (l.def.hits ?? 1); i++) credit(l, strike(foe, d, !!l.def.pierce, 'dmg'));
    }
    const strip = v('strip');
    if (strip > 0) { const s = Math.min(foe.shield, strip); foe.shield -= s; credit(l, s); }
    const burn = v('burn');
    if (burn > 0) { foe.burn += burn; credit(l, burn * 2); log({ t, type: 'gain', side: foe.side, kind: 'burn', amount: burn }); }
    const poison = v('poison');
    if (poison > 0) { foe.poison += poison; credit(l, poison * 3); log({ t, type: 'gain', side: foe.side, kind: 'poison', amount: poison }); }
    const shield = v('shield');
    if (shield > 0) { team.shield += shield; credit(l, shield); log({ t, type: 'gain', side: team.side, kind: 'shield', amount: shield }); }
    const heal = v('heal');
    if (heal > 0) {
      const got = Math.min(heal, team.maxHp - team.hp);
      team.hp += got; credit(l, got);
      log({ t, type: 'gain', side: team.side, kind: 'heal', amount: got });
    }
    const slow = v('slow');
    if (slow > 0) { const f = facing(foe, l.slot); if (f) f.charge -= slow; }
    const haste = v('haste');
    if (haste > 0) for (const x of resolve(team, l, 'adj')) x.charge += haste;

    trigger(team, l, 'fire');
    for (const x of resolve(team, l, 'adj')) trigger(team, x, 'adjFire');
  };

  // 始まり
  for (const team of teams) for (const l of team.units) if (l) trigger(team, l, 'start');

  let nextBurn = BURN_TICK, nextPoison = POISON_TICK, nextStorm = STORM_AT, storm = 1;
  let winner: Side | -1 = -1;
  let step = 0;
  while (t < TIME_CAP) {
    t = Math.round((t + DT) * 1000) / 1000;
    // 刻みごとに先に動く側を入れ替える。いつも同じ側が先だと、同時の相打ちが偏る
    const order: [Team, Team] = step++ % 2 === 0 ? [teams[0], teams[1]] : [teams[1], teams[0]];
    for (const team of order) {
      const foe = teams[1 - team.side];
      for (const l of team.units) {
        if (!l) continue;
        l.charge += DT;
        const cd = cooldownOf(l.def, l.unit, l.temp);
        if (l.charge >= cd) { l.charge -= cd; fire(team, foe, l); }
      }
    }
    if (t >= nextBurn - 1e-9) {
      nextBurn += BURN_TICK;
      // 火傷は燃えるたびに半分へ減る。積んだ数のおよそ2倍ぶん削って消える——
      // 1つずつ減らすと削りが積んだ数の2乗で伸び、育てた火傷だけが桁違いになった
      for (const team of teams) if (team.burn > 0) { strike(team, team.burn, false, 'burn'); team.burn = Math.floor(team.burn / 2); }
    }
    if (t >= nextPoison - 1e-9) {
      nextPoison += POISON_TICK;
      for (const team of teams) if (team.poison > 0) {
        team.hp -= team.poison;
        log({ t, type: 'hit', side: team.side, amount: team.poison, shielded: 0, kind: 'poison' });
      }
    }
    if (t >= nextStorm - 1e-9) {
      nextStorm += 1;
      for (const team of teams) strike(team, storm, true, 'storm');
      storm = Math.ceil(storm * 1.25 + 1);
    }
    const dead0 = teams[0].hp <= 0, dead1 = teams[1].hp <= 0;
    if (dead0 || dead1) { winner = dead0 && dead1 ? -1 : dead0 ? 1 : 0; break; }
  }
  if (winner === -1 && teams[0].hp > 0 && teams[1].hp > 0) {
    const r0 = teams[0].hp / teams[0].maxHp, r1 = teams[1].hp / teams[1].maxHp;
    winner = r0 === r1 ? -1 : r0 > r1 ? 0 : 1;
  }
  log({ t, type: 'end', winner });
  return { winner, seconds: t, hp: [teams[0].hp, teams[1].hp], growth, events, output };
}

/** 育ちを個体に書き戻す */
export function applyGrowth(u: RunUnit, g: Partial<Record<Stat, number>>): void {
  for (const [k, v] of Object.entries(g) as [Stat, number][]) u.perm[k] = (u.perm[k] ?? 0) + v;
}

export { EFFECT_KINDS };
