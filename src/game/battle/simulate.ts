import { getRevos } from '../data/revos';
import {
  FORMATIONS, elementFactor,
  type BattleEvent, type Fighter, type FighterSnapshot, type Mod, type ModKind,
  type Row, type Side, type TeamSetup,
} from './types';

/**
 * バトルの純粋シミュレーション。
 *
 * 描画から完全に切り離し、「同じシード ＋ 同じ入力列 → 同じイベント列」を保証する。
 * これにより倍速・スキップ・リプレイ・サーバー検証がすべてタダで手に入る。
 * レンダラはイベント列を再生するだけで、勝敗の判定には一切関与しない。
 */

class Prng {
  private s: number;
  constructor(seed: number) { this.s = (seed >>> 0) || 0x2545f491; }
  next(): number {
    let x = this.s;
    x ^= x << 13; x >>>= 0;
    x ^= x >>> 17;
    x ^= x << 5; x >>>= 0;
    this.s = x;
    return x / 0x100000000;
  }
  range(a: number, b: number): number { return a + this.next() * (b - a); }
  chance(p: number): boolean { return this.next() < p; }
}

/** 行動が回る AV のしきい値 */
export const AV_THRESHOLD = 10000;

/** OD技を撃った後に空く追加の間隔（通常攻撃1回ぶんを1.0として） */
const OD_RECOVERY: Record<string, number> = {
  // 単体
  faultcrush: 0.5, flamevolley: 0.5, vortexfang: 0.5, obsidiancut: 0.5, faulthaul: 0.55,
  // 全体
  galerend: 0.9, scorchring: 0.8, erosionstorm: 0.8, greateruption: 0.85,
  crushbite: 0.5, abyssalmaw: 0.85, galemaw: 0.5,
  stratarecord: 0.28,
  spikebore: 0.5, leapstrike: 0.5,
  skyreign: 0.28,
  hatzegwing: 0.85,
  // 支援：撃っても攻め手が止まらないよう隙を小さく
  rockaegis: 0.28, tideheal: 0.28, resonantlight: 0.28, grindfeed: 0.28,
};
const MAX_TURNS = 200;

/**
 * 「制空覇道」の持続。標準速の10秒を戦闘内時刻に換算したもの。
 *
 * 再生側は 1 秒あたり 1/0.055 だけ clock を進める（BattlePlayer の
 * SEC_PER_AV）。実時間で数えると倍速・3倍速で結果が変わってしまうので、
 * 標準速の秒数を固定値として持つ。
 */
const SKYREIGN_DURATION = Math.round(10 / 0.055);
/** 「磨り潰し消化」の再生時間。5秒を戦闘内時刻へ換算する */
const GRINDFEED_DURATION = Math.round(5 / 0.055);
/**
 * 「磨り潰し消化」の配り方。
 *
 * 5秒は、この戦闘の時計ではSPD100の個体が1回動くかどうかという長さしかない。
 * 全部を再生に回すと、撃った瞬間は何も起きずに終わることが多い。
 * 撃った時点で半分を渡し、残りを5秒のあいだの行動ごとに配る。
 */
const GRINDFEED_INSTANT = 0.5;
const GRINDFEED_TICK = 0.34;
/*
 * SPD を上げる時間制のバフは、上げ幅がそのまま「その窓の中で何回動けるか」に
 * なるので、自分の持続を自分で買う。+10% では窓の中に1回も増えず、★5の
 * 切り札が何も起きないまま消えていた。倍率だけ上げ、10秒という持続は
 * ——これがロスターで唯一の「秒で切れる効果」なので——そのまま残す。
 */

/** レベル補正。Lv30 でおよそ 2.6 倍 */
function levelScale(level: number): number {
  return 1 + 0.055 * (level - 1);
}

/** クリーン度 → ステータス倍率。SPD には掛けない */
export function cleanMultiplier(clean: number): number {
  return 0.88 + 0.0024 * clean;
}

export function cleanRank(clean: number): 'S' | 'A' | 'B' | 'C' | 'D' {
  if (clean >= 95) return 'S';
  if (clean >= 85) return 'A';
  if (clean >= 70) return 'B';
  if (clean >= 50) return 'C';
  return 'D';
}

/** 刻印の無い個体ぶん。毎回 0 のオブジェクトを作らない */
const NO_ENGRAVING = { atk: 0, def: 0, hp: 0, spd: 0 };

function buildFighters(setup: TeamSetup, side: Side): Fighter[] {
  const out: Fighter[] = [];
  const form = FORMATIONS[setup.formation];
  setup.order.forEach((memberIdx, slot) => {
    const inst = setup.members[memberIdx];
    const def = getRevos(inst.defId);
    const ls = levelScale(inst.level);
    const mc = cleanMultiplier(inst.clean);
    const eg = inst.engraving ?? NO_ENGRAVING;
    const row: Row = slot === 0 ? 'front' : 'back';
    out.push({
      uid: inst.uid,
      defId: def.id,
      name: def.name,
      element: def.element,
      side,
      slot,
      row,
      level: inst.level,
      clean: inst.clean,
      skillLevel: inst.skillLevel,
      // 刻印はレベルもクリーン度も掛からない純粋な加算。最後に足す——
      // 倍率の中に入れると、育てるほど刻印の差まで広がって二重に効く
      maxHp: Math.round(def.hp * ls * mc) + eg.hp,
      hp: Math.round(def.hp * ls * mc) + eg.hp,
      atk: Math.round(def.atk * ls * mc) + eg.atk,
      def: Math.round(def.def * ls * mc * form.defMul) + eg.def,
      spd: Math.round(def.spd * ls * form.spdMul) + eg.spd,
      basicPower: def.basicPower,
      av: 0,
      od: 30 + form.startOd,
      alive: true,
      mods: [],
      statuses: [],
      shield: null,
      stance: setup.stances?.[slot] ?? 'balanced',
      targetPref: setup.targetPrefs?.[slot] ?? def.defaultPref,
      stacks: {},
      promoteDelay: 0,
      draggedTurns: 0,
      dealt: 0, taken: 0, healed: 0, kills: 0,
    });
  });
  return out;
}

function snapshot(f: Fighter): FighterSnapshot {
  return {
    uid: f.uid, defId: f.defId, name: f.name, element: f.element,
    side: f.side, row: f.row, maxHp: f.maxHp, hp: f.hp,
    atk: f.atk, def: f.def, spd: f.spd, od: f.od,
  };
}

export interface BattleResult {
  winner: Side | -1;
  turns: number;
  survivors: number;
  fighters: Fighter[];
}

export class BattleSim {
  readonly fighters: Fighter[];
  private rng: Prng;
  private formations: [ReturnType<typeof formOf>, ReturnType<typeof formOf>];
  private turn = 0;
  /**
   * 戦闘内の経過時間（AV の単位）。
   *
   * advanceToNextActor が全員に配る量そのもの。行動と行動のあいだに
   * どれだけ「時間」が流れたかを、再生側が実時間へ割り付けるために使う。
   */
  private clockV = 0;
  private finished = false;
  private winner: Side | -1 = -1;
  /** プレイヤーが「このユニットのODを溜めて撃つ」と指示した集合 */
  private odHold = new Set<string>();
  private odFire = new Set<string>();

  constructor(seed: number, teamA: TeamSetup, teamB: TeamSetup) {
    this.rng = new Prng(seed);
    this.fighters = [...buildFighters(teamA, 0), ...buildFighters(teamB, 1)];
    this.formations = [formOf(teamA), formOf(teamB)];

    for (const f of this.fighters) {
      if (passiveOf(f) === 'vanguard') f.av += 3500;
    }
  }

  get isOver(): boolean { return this.finished; }
  get currentWinner(): Side | -1 { return this.winner; }
  get turnCount(): number { return this.turn; }
  /** 戦闘内の経過時間。step するたびに bestT ぶん進む */
  get clock(): number { return this.clockV; }

  /** 陣形とバフ込みの実効 SPD。再生側が「あと何秒で動くか」を出すのに使う */
  speedOf(f: Fighter): number { return this.effSpd(f); }

  /**
   * 次に誰かが動く時刻。clock と同じ単位で、step せずに覗くだけ。
   *
   * 再生側はこれを見て「まだ誰も動かない」区間を作る。先に step して
   * 待たせると、その行動はもう確定しているので、プレイヤーが OD を
   * 押し込む余地がそのぶん消える。
   */
  nextActorAt(): number {
    const living = this.alive();
    if (living.length === 0 || this.alive(0).length === 0 || this.alive(1).length === 0) {
      return Infinity;
    }
    let best = Infinity;
    for (const f of living) best = Math.min(best, (AV_THRESHOLD - f.av) / this.effSpd(f));
    return this.clockV + Math.max(0, best);
  }

  startEvents(): BattleEvent[] {
    return [{ t: 'start', fighters: this.fighters.map(snapshot) }];
  }

  /**
   * OD を自動発動させず溜める指示。プレイヤーがタップした瞬間に呼ぶ。
   * 溜めている間は AI が撃たないので、150 まで伸ばして最大 ×1.35 にできる。
   */
  setOdHold(uid: string, hold: boolean): void {
    if (hold) this.odHold.add(uid);
    else this.odHold.delete(uid);
  }

  /** 溜めた OD を今すぐ撃つ指示 */
  fireOd(uid: string): void {
    this.odFire.add(uid);
    this.odHold.delete(uid);
  }

  private alive(side?: Side): Fighter[] {
    return this.fighters.filter((f) => f.alive && (side === undefined || f.side === side));
  }

  private effSpd(f: Fighter): number {
    const m = this.modSum(f, 'spd');
    return Math.max(1, f.spd * clamp(1 + m, 0.4, 2.0));
  }

  private modSum(f: Fighter, kind: ModKind): number {
    let s = 0;
    for (const m of f.mods) {
      if (m.kind !== kind) continue;
      // 秒で切れるバフ。持ち主の行動を待たずに、時刻が来たら効かなくなる
      if (m.until !== undefined && this.clockV >= m.until) continue;
      s += m.value;
    }
    return s;
  }

  /** 1行動分を進め、その間に起きたイベントを返す */
  step(): BattleEvent[] {
    if (this.finished) return [];
    const ev: BattleEvent[] = [];

    const actor = this.advanceToNextActor();
    if (!actor) { this.finish(ev); return ev; }

    this.sweepTimedMods();
    this.turn++;
    ev.push({ t: 'turnBegin', uid: actor.uid });

    // --- 行動開始時の持続効果 ---
    this.tickStatuses(actor, ev);
    if (!actor.alive) {
      ev.push({ t: 'turnEnd', uid: actor.uid });
      this.checkEnd(ev);
      return ev;
    }

    this.gainOd(actor, 3, ev);

    // 「堆積」: 行動のたびに DEF が伸びる
    if (passiveOf(actor) === 'sediment') {
      const st = actor.stacks.sediment ?? 0;
      if (st < 5) {
        actor.stacks.sediment = st + 1;
        this.addMod(actor, { kind: 'def', value: 0.09, turns: 999, source: 'sediment' }, ev, '堆積');
      }
    }
    // 「潮汐」: 行動のたびに、いちばん傷んだ味方へ手を回す。
    // 味方の撃破を待つだけでは、短い戦闘で回復役の出番が来ない
    if (passiveOf(actor) === 'tide') {
      const hurt = this.alive(actor.side)
        .slice()
        .sort((a, b) => a.hp / a.maxHp - b.hp / b.maxHp)[0];
      if (hurt && hurt.hp < hurt.maxHp) {
        ev.push({ t: 'passive', uid: actor.uid, label: '潮汐' });
        this.heal(actor, hurt, Math.round(actor.atk * 0.46), ev);
      }
    }
    // 「共鳴」: 味方全体の OD を押し上げる
    if (passiveOf(actor) === 'resonance') {
      ev.push({ t: 'passive', uid: actor.uid, label: '共鳴' });
      for (const a of this.alive(actor.side)) this.gainOd(a, 10, ev);
    }

    // --- OD か通常攻撃か ---
    const wantsOd = this.shouldFireOd(actor);
    if (wantsOd) {
      this.performOd(actor, ev);
      this.odFire.delete(actor.uid);
    } else {
      this.performBasic(actor, ev);
    }

    this.decayMods(actor);
    if (actor.promoteDelay > 0) actor.promoteDelay--;
    if (actor.draggedTurns > 0) {
      actor.draggedTurns--;
      if (actor.draggedTurns === 0 && actor.slot !== 0) {
        actor.row = 'back';
        ev.push({ t: 'promote', uid: actor.uid, from: 'front', to: 'back' });
      }
    }
    if (actor.shield) {
      actor.shield.turns--;
      if (actor.shield.turns <= 0) actor.shield = null;
    }

    ev.push({ t: 'turnEnd', uid: actor.uid });
    this.checkEnd(ev);
    if (this.turn >= MAX_TURNS && !this.finished) {
      // 決着しない編成は HP 割合の合計で判定する（オートバトルを無限にしない）
      const a = this.teamHpRatio(0);
      const b = this.teamHpRatio(1);
      this.winner = a === b ? -1 : a > b ? 0 : 1;
      this.finished = true;
      ev.push({ t: 'end', winner: this.winner, turns: this.turn });
    }
    return ev;
  }

  runToEnd(limit = MAX_TURNS + 8): BattleEvent[] {
    const all: BattleEvent[] = [...this.startEvents()];
    let guard = 0;
    while (!this.finished && guard++ < limit) all.push(...this.step());
    return all;
  }

  result(): BattleResult {
    return {
      winner: this.winner,
      turns: this.turn,
      survivors: this.alive(this.winner === -1 ? undefined : (this.winner as Side)).length,
      fighters: this.fighters,
    };
  }

  // ------------------------------------------------------------ 行動順

  /**
   * t_i = (10000 − AV_i) / SPD_i の解析解で次の行動者を決める。
   * ティック加算と違い O(n) で厳密、誤差の蓄積もないのでリプレイが完全に一致する。
   */
  private advanceToNextActor(): Fighter | null {
    const living = this.alive();
    if (living.length === 0) return null;
    if (this.alive(0).length === 0 || this.alive(1).length === 0) return null;

    let best: Fighter | null = null;
    let bestT = Infinity;
    for (const f of living) {
      const t = (AV_THRESHOLD - f.av) / this.effSpd(f);
      if (t < bestT - 1e-9) { bestT = t; best = f; }
      else if (Math.abs(t - bestT) < 1e-9 && best) {
        // 同値は SPD 優先、それも同じならシード付き乱数で決める
        if (f.spd > best.spd || (f.spd === best.spd && this.rng.chance(0.5))) best = f;
      }
    }
    if (!best) return null;
    for (const f of living) f.av += this.effSpd(f) * bestT;
    this.clockV += bestT;
    best.av -= AV_THRESHOLD;
    return best;
  }

  // ------------------------------------------------------------ 行動

  private shouldFireOd(actor: Fighter): boolean {
    if (actor.od < 100) return false;
    if (this.odFire.has(actor.uid)) return true;
    if (this.odHold.has(actor.uid)) return actor.od >= 150; // 上限で自動放出
    // AI: 敵が2体以上いるか、または一撃で仕留められるなら撃つ
    const enemies = this.alive(other(actor.side));
    if (enemies.length >= 2) return true;
    const target = this.pickTarget(actor);
    if (target && this.estimateDamage(actor, target, odPower(actor)) >= target.hp) return true;
    return actor.stance === 'aggressive';
  }

  /**
   * 「掌握する空」: 味方の攻撃が奇数回目になるたび、味方全体の ATK が上がる。
   *
   * 数えるのは陣営ごとの攻撃回数。1・3・5回目で1段ずつ乗り、3段（+15%）で
   * 止まる。序盤にだけ伸びて、あとは維持する形——維持のためには本体を
   * 守らなければならない。ケツァルコアトルスが落ちれば、積んだ分は全部消える。
   */
  private tickSkygrasp(actor: Fighter, ev: BattleEvent[]): void {
    const holder = this.alive(actor.side).find((a) => passiveOf(a) === 'skygrasp');
    if (!holder) return;
    const hits = (holder.stacks.skyhits ?? 0) + 1;
    holder.stacks.skyhits = hits;
    if (hits % 2 === 0) return;
    const st = holder.stacks.sky ?? 0;
    if (st >= 3) return;
    holder.stacks.sky = st + 1;
    ev.push({ t: 'passive', uid: holder.uid, label: '掌握する空' });
    for (const a of this.alive(actor.side)) {
      this.addMod(a, { kind: 'atk', value: 0.05, turns: 999, source: 'skygrasp' }, ev, 'ATK上昇');
    }
  }

  private performBasic(actor: Fighter, ev: BattleEvent[]): void {
    const target = this.pickTarget(actor);
    if (!target) return;
    ev.push({ t: 'action', uid: actor.uid, kind: 'basic', name: '通常攻撃', targets: [target.uid] });
    const dealt = this.dealDamage(actor, target, this.basicPowerOf(actor), ev);
    this.gainOd(actor, 12, ev);
    this.tickSkygrasp(actor, ev);

    if (dealt > 0) {
      const p = passiveOf(actor);
      this.tickIslandApex(actor, ev);
      if (p === 'embers' && this.rng.chance(0.32)) this.applyBurn(target, ev, actor.uid);
      if (p === 'shearwind') {
        const st = actor.stacks.shear ?? 0;
        if (st < 3) {
          actor.stacks.shear = st + 1;
          this.addMod(target, { kind: 'def', value: -0.08, turns: 999, source: 'shearwind' }, ev, '削風');
        }
      }
    }
  }

  private performOd(actor: Fighter, ev: BattleEvent[]): void {
    const def = getRevos(actor.defId);
    const mod = 1 + 0.35 * (clamp(actor.od, 100, 150) - 100) / 50;
    const power = odPower(actor) * mod;
    const enemies = this.alive(other(actor.side));
    const allies = this.alive(actor.side);
    const id = def.od.id;

    const single = (): Fighter | null => this.pickTarget(actor);

    switch (id) {
      case 'faultcrush': {
        const t = single(); if (!t) break;
        ev.push({ t: 'action', uid: actor.uid, kind: 'od', name: def.od.name, targets: [t.uid] });
        this.dealDamage(actor, t, power, ev);
        t.promoteDelay = 1;
        break;
      }
      case 'flamevolley': {
        const t = single(); if (!t) break;
        const hits = t.statuses.some((s) => s.kind === 'burn') ? 3 : 2;
        ev.push({ t: 'action', uid: actor.uid, kind: 'od', name: def.od.name, targets: [t.uid] });
        for (let i = 0; i < hits && t.alive; i++) this.dealDamage(actor, t, power, ev);
        break;
      }
      case 'vortexfang': {
        const t = single(); if (!t) break;
        ev.push({ t: 'action', uid: actor.uid, kind: 'od', name: def.od.name, targets: [t.uid] });
        this.dealDamage(actor, t, power, ev);
        if (t.alive) this.addMod(t, { kind: 'spd', value: -0.2, turns: 3, source: 'vortexfang' }, ev, 'SPD低下');
        break;
      }
      case 'galerend': {
        ev.push({ t: 'action', uid: actor.uid, kind: 'od', name: def.od.name, targets: enemies.map((e) => e.uid) });
        for (const e of enemies) this.dealDamage(actor, e, power, ev);
        actor.av += 3200;
        break;
      }
      case 'rockaegis': {
        ev.push({ t: 'action', uid: actor.uid, kind: 'od', name: def.od.name, targets: allies.map((a) => a.uid) });
        const amount = Math.round(actor.def * 3.0 * (1 + this.modSum(actor, 'def')));
        for (const a of allies) {
          a.shield = { amount, turns: 4 };
          ev.push({ t: 'shield', uid: a.uid, amount });
        }
        break;
      }
      case 'scorchring': {
        ev.push({ t: 'action', uid: actor.uid, kind: 'od', name: def.od.name, targets: enemies.map((e) => e.uid) });
        for (const e of enemies) {
          this.dealDamage(actor, e, power, ev);
          if (e.alive && this.rng.chance(0.6)) this.applyBurn(e, ev, actor.uid);
        }
        break;
      }
      case 'tideheal': {
        const t = allies.slice().sort((a, b) => a.hp / a.maxHp - b.hp / b.maxHp)[0];
        if (!t) break;
        ev.push({ t: 'action', uid: actor.uid, kind: 'od', name: def.od.name, targets: [t.uid] });
        this.heal(actor, t, Math.round(actor.atk * 2.6 * mod), ev);
        const i = t.mods.findIndex((m) => m.value < 0);
        if (i >= 0) t.mods.splice(i, 1);
        break;
      }
      case 'erosionstorm': {
        ev.push({ t: 'action', uid: actor.uid, kind: 'od', name: def.od.name, targets: enemies.map((e) => e.uid) });
        for (const e of enemies) {
          this.dealDamage(actor, e, power, ev);
          if (e.alive) this.addMod(e, { kind: 'def', value: -0.25, turns: 4, source: 'erosionstorm' }, ev, 'DEF低下');
        }
        break;
      }
      case 'obsidiancut': {
        const t = single(); if (!t) break;
        ev.push({ t: 'action', uid: actor.uid, kind: 'od', name: def.od.name, targets: [t.uid] });
        const p = t.hp / t.maxHp < 0.5 ? power * (230 / 175) : power;
        this.dealDamage(actor, t, p, ev);
        break;
      }
      case 'resonantlight': {
        ev.push({ t: 'action', uid: actor.uid, kind: 'od', name: def.od.name, targets: allies.map((a) => a.uid) });
        for (const a of allies) {
          this.addMod(a, { kind: 'atk', value: 0.18, turns: 4, source: 'resonantlight' }, ev, 'ATK上昇');
          this.gainOd(a, 15, ev);
        }
        break;
      }
      case 'faulthaul': {
        const back = enemies.filter((e) => e.row === 'back');
        const t = back[0] ?? enemies[0];
        if (!t) break;
        ev.push({ t: 'action', uid: actor.uid, kind: 'od', name: def.od.name, targets: [t.uid] });
        this.dealDamage(actor, t, power, ev);
        if (t.alive && t.row === 'back') {
          t.row = 'front';
          t.draggedTurns = 2;
          ev.push({ t: 'promote', uid: t.uid, from: 'back', to: 'front' });
        }
        break;
      }
      case 'crushbite': {
        const t = single(); if (!t) break;
        ev.push({ t: 'action', uid: actor.uid, kind: 'od', name: def.od.name, targets: [t.uid] });
        this.dealDamage(actor, t, power, ev, true);
        break;
      }
      case 'abyssalmaw': {
        ev.push({ t: 'action', uid: actor.uid, kind: 'od', name: def.od.name, targets: enemies.map((e) => e.uid) });
        for (const e of enemies) this.dealDamage(actor, e, power, ev, true);
        break;
      }
      case 'galemaw': {
        const t = single(); if (!t) break;
        ev.push({ t: 'action', uid: actor.uid, kind: 'od', name: def.od.name, targets: [t.uid] });
        this.dealDamage(actor, t, power, ev);
        actor.av += 2200;
        break;
      }
      case 'stratarecord': {
        ev.push({ t: 'action', uid: actor.uid, kind: 'od', name: def.od.name, targets: allies.map((a) => a.uid) });
        for (const a of allies) {
          this.gainOd(a, 25, ev);
          this.addMod(a, { kind: 'dealt', value: 0.20, turns: 4, source: 'stratarecord' }, ev, '与ダメ上昇');
        }
        break;
      }
      case 'skyreign': {
        ev.push({ t: 'action', uid: actor.uid, kind: 'od', name: def.od.name, targets: allies.map((a) => a.uid) });
        // 「10秒」は標準速の実時間。戦闘内時刻に換算して持たせる
        const until = this.clockV + SKYREIGN_DURATION;
        for (const a of allies) {
          this.addMod(a, { kind: 'spd', value: 0.30, until, turns: 0, source: 'skyreign' }, ev, 'SPD上昇');
          this.addMod(a, { kind: 'def', value: 0.20, until, turns: 0, source: 'skyreign' }, ev, 'DEF上昇');
        }
        break;
      }
      case 'spikebore': {
        const t = single(); if (!t) break;
        ev.push({ t: 'action', uid: actor.uid, kind: 'od', name: def.od.name, targets: [t.uid] });
        this.dealDamage(actor, t, power, ev);
        if (t.alive) this.addMod(t, { kind: 'atk', value: -0.22, turns: 4, source: 'spikebore' }, ev, 'ATK低下');
        break;
      }
      case 'leapstrike': {
        const t = single(); if (!t) break;
        ev.push({ t: 'action', uid: actor.uid, kind: 'od', name: def.od.name, targets: [t.uid] });
        this.dealDamage(actor, t, power, ev);
        if (t.alive) this.addMod(t, { kind: 'taken', value: 0.25, turns: 3, source: 'leapstrike' }, ev, '被ダメ上昇');
        break;
      }
      case 'hatzegwing': {
        ev.push({ t: 'action', uid: actor.uid, kind: 'od', name: def.od.name, targets: enemies.map((e) => e.uid) });
        let landed = 0;
        for (const e of enemies) landed += this.dealDamage(actor, e, power, ev);
        for (const a of allies) {
          this.addMod(a, { kind: 'spd', value: 0.10, turns: 4, source: 'hatzegwing' }, ev, 'SPD上昇');
        }
        if (landed > 0) this.tickIslandApex(actor, ev);
        break;
      }
      case 'grindfeed': {
        ev.push({ t: 'action', uid: actor.uid, kind: 'od', name: def.od.name, targets: allies.map((a) => a.uid) });
        // 総量は自分の最大体力の 1/5。5秒のあいだ、行動が回るたびに分けて渡す
        const total = Math.round(actor.maxHp * 0.2 * mod);
        const instant = Math.round(total * GRINDFEED_INSTANT);
        const per = Math.max(1, Math.round(total * GRINDFEED_TICK));
        const until = this.clockV + GRINDFEED_DURATION;
        for (const a of allies) {
          this.heal(actor, a, instant, ev);
          a.statuses = a.statuses.filter((st) => !st.source.endsWith('|grindfeed'));
          a.statuses.push({
            kind: 'regen', turns: 99, value: per, pool: total - instant, until,
            source: actor.uid + '|grindfeed',
          });
        }
        break;
      }
      case 'greateruption': {
        ev.push({ t: 'action', uid: actor.uid, kind: 'od', name: def.od.name, targets: enemies.map((e) => e.uid) });
        for (const e of enemies) {
          this.dealDamage(actor, e, power, ev);
          if (e.alive) this.applyBurn(e, ev, actor.uid);
        }
        const self = Math.round(actor.maxHp * 0.12);
        actor.hp = Math.max(1, actor.hp - self);
        ev.push({ t: 'damage', uid: actor.uid, from: actor.uid, amount: self, crit: false, eff: 1, hp: actor.hp, shielded: 0 });
        break;
      }
    }
    this.tickSkygrasp(actor, ev);
    // 「記録の帆」: 誰かが特殊攻撃を撃つたび、撃った本人の一撃が重くなる。
    // 撃つほど強くなる形にして、OD を溜め込むより回す動機を作る
    for (const a of this.alive(actor.side)) {
      if (passiveOf(a) !== 'archivesail') continue;
      const key = `sail:${actor.uid}`;
      const st = a.stacks[key] ?? 0;
      if (st < 3) {
        a.stacks[key] = st + 1;
        ev.push({ t: 'passive', uid: a.uid, label: '記録の帆' });
        this.addMod(actor, { kind: 'atk', value: 0.12, turns: 999, source: 'archivesail' }, ev, 'ATK上昇');
      }
      break;
    }

    actor.od = 0;
    ev.push({ t: 'od', uid: actor.uid, value: 0 });
    // 特殊攻撃のあとは隙ができる。隙の大きさは技の重さに比例させる。
    // 一律にすると、全体攻撃と支援技が同じ代償になってしまう
    actor.av -= AV_THRESHOLD * OD_RECOVERY[id];
  }

  // ------------------------------------------------------------ 計算

  private estimateDamage(atk: Fighter, def: Fighter, power: number): number {
    return this.computeDamage(atk, def, power, false).amount;
  }

  /**
   * 通常攻撃の実効威力。
   *
   * 威力はダメージ式に線形で入るので、ここを割り増せば「通常攻撃だけ重い」を
   * そのまま表現できる。computeDamage に通常／必殺の区別を持ち込まずに済む。
   */
  private basicPowerOf(f: Fighter): number {
    return passiveOf(f) === 'greatbeak' ? f.basicPower * 1.22 : f.basicPower;
  }

  private computeDamage(
    atk: Fighter, def: Fighter, power: number, roll: boolean,
  ): { amount: number; crit: boolean; eff: 1.5 | 1 | 0.7 } {
    const atkStat = atk.atk * clamp(1 + this.modSum(atk, 'atk'), 0.3, 3);
    let defStat = def.def * clamp(1 + this.modSum(def, 'def'), 0.3, 3);
    // 「硬い敵優先」は狙いを定めて継ぎ目を突く：防御を15%無視する。
    // これが無いと、通りにくい相手を選ぶだけの損な作戦になる
    if (atk.targetPref === 'defense') defStat *= 0.90;
    // 除算形の防御。減算形だと DEF を伸ばした瞬間ダメージ0になり戦闘が終わらなくなる
    const dr = 150 / (150 + defStat);
    let base = 4.15 * (power / 100) * atkStat * dr;

    let eff: 1.5 | 1 | 0.7 = elementFactor(atk.element, def.element);
    if (passiveOf(atk) === 'immutable' || passiveOf(def) === 'immutable') eff = 1;

    const posAtk = atk.row === 'front' ? 1.15 : 0.9;
    // 後列は本来 0.8 だが、「後衛優先」で狙い続けているなら軽減を緩める
    const backGuard = atk.targetPref === 'back' ? 0.95 : 0.8;
    const posDef = def.row === 'front' ? 1.0 : backGuard;

    let buff = (1 + this.modSum(atk, 'dealt')) * (1 + this.modSum(def, 'taken'));
    buff *= this.formations[atk.side].allDamageDealt;
    buff *= this.formations[def.side].allDamageTaken;
    if (atk.row === 'front') buff *= this.formations[atk.side].frontDamage;

    // 「支援役優先」は狙った相手に限り通りをよくする。
    // 支援役は後列にいることが多く、位置補正で威力が死んでいた
    if (atk.targetPref === 'support') {
      const role = getRevos(def.defId).role;
      if (role === 'Healer' || role === 'Buffer' || role === 'Debuffer') buff *= 1.22;
    }

    const pa = passiveOf(atk);
    if (pa === 'deeppressure' && def.spd >= atk.spd + 20) buff *= 1.14;
    if (pa === 'traction' && def.row === 'back') buff *= 1.34;
    if (pa === 'overheat') buff *= 1 + 0.25 * (1 - atk.hp / atk.maxHp);
    // 「旧き暴君」: まだ削れていない相手を先に潰す
    if (pa === 'oldtyrant' && def.hp / def.maxHp > atk.hp / atk.maxHp) buff *= 1.16;
    const pd = passiveOf(def);
    if (pd === 'subsidence' && def.row === 'front') buff *= 0.85;

    buff = clamp(buff, 0.4, 2.5);

    const critRate = clamp(0.05 + (atk.spd - def.spd) * 0.0015, 0.02, 0.35);
    const crit = roll ? this.rng.chance(critRate) : false;
    const rnd = roll ? this.rng.range(0.92, 1.08) : 1;

    base *= eff * posAtk * posDef * buff * (crit ? 1.8 : 1) * rnd;
    return { amount: Math.max(1, Math.round(base)), crit, eff };
  }

  private dealDamage(
    atk: Fighter, target: Fighter, power: number, ev: BattleEvent[], pierceShield = false,
  ): number {
    if (!target.alive || !atk.alive) return 0;
    const { amount, crit, eff } = this.computeDamage(atk, target, power, true);

    let remaining = amount;
    let shielded = 0;
    if (target.shield && !pierceShield) {
      shielded = Math.min(target.shield.amount, remaining);
      target.shield.amount -= shielded;
      remaining -= shielded;
      if (target.shield.amount <= 0) target.shield = null;
    }
    target.hp = Math.max(0, target.hp - remaining);
    target.taken += remaining;
    atk.dealt += remaining;

    ev.push({
      t: 'damage', uid: target.uid, from: atk.uid,
      amount, crit, eff, hp: target.hp, shielded,
    });

    // 被弾で OD が溜まる（負けている側が巻き返せる仕組み）
    if (remaining > 0) this.gainOd(target, 24 * (remaining / target.maxHp), ev);
    if (eff === 1.5) this.gainOd(atk, 4, ev);

    // 「熱反射」
    if (passiveOf(target) === 'heatreflect' && remaining > 0 && atk.alive && atk !== target) {
      const back = Math.max(1, Math.round(remaining * 0.2));
      atk.hp = Math.max(0, atk.hp - back);
      ev.push({ t: 'passive', uid: target.uid, label: '熱反射' });
      ev.push({ t: 'damage', uid: atk.uid, from: target.uid, amount: back, crit: false, eff: 1, hp: atk.hp, shielded: 0 });
      if (atk.hp === 0) this.kill(atk, target, ev);
    }

    if (target.hp === 0) this.kill(target, atk, ev);
    return remaining;
  }

  /**
   * 「島の頂点」: 初めて攻撃を通した1回だけ、以後ずっと攻撃が上がる。
   *
   * 何度も積まないのは、頂点に立つのは一度きりだという読み方をそのまま
   * 残すため。効果は戦闘が終わるまで消えない。
   */
  private tickIslandApex(actor: Fighter, ev: BattleEvent[]): void {
    if (passiveOf(actor) !== 'islandapex') return;
    if (actor.stacks.apex) return;
    actor.stacks.apex = 1;
    this.addMod(actor, { kind: 'atk', value: 0.20, turns: 999, source: 'islandapex' }, ev, '島の頂点');
  }

  private heal(src: Fighter, target: Fighter, amount: number, ev: BattleEvent[]): void {
    if (!target.alive) return;
    // 「大地の伊吹」: 味方が受け取る回復を底上げする。誰が撃った回復でも効く
    const boost = this.alive(target.side).some((a) => passiveOf(a) === 'earthbreath') ? 1.15 : 1;
    const before = target.hp;
    target.hp = Math.min(target.maxHp, target.hp + Math.round(amount * boost));
    src.healed += target.hp - before;
    ev.push({ t: 'heal', uid: target.uid, from: src.uid, amount: target.hp - before, hp: target.hp });
  }

  private kill(target: Fighter, by: Fighter, ev: BattleEvent[]): void {
    if (!target.alive) return;
    target.alive = false;
    target.hp = 0;
    if (by !== target) by.kills++;
    ev.push({ t: 'ko', uid: target.uid, by: by.uid });

    // 「追い波」: 仕留めた側が、その勢いのまま次の行動に入る
    if (by !== target && by.alive && passiveOf(by) === 'pursuit') {
      by.av += 3800;
      ev.push({ t: 'passive', uid: by.uid, label: '追い波' });
    }

    // 「地盤沈下」: 倒れると味方の OD を押し上げる
    if (passiveOf(target) === 'subsidence') {
      ev.push({ t: 'passive', uid: target.uid, label: '地盤沈下' });
      for (const a of this.alive(target.side)) this.gainOd(a, 40, ev);
    }
    // 「掌握する空」: 空を握っていた本体が落ちれば、積み上げた分は残らない
    if (passiveOf(target) === 'skygrasp') {
      for (const a of this.fighters) {
        if (a.side !== target.side) continue;
        a.mods = a.mods.filter((m) => m.source !== 'skygrasp');
      }
      ev.push({ t: 'passive', uid: target.uid, label: '掌握する空' });
    }
    // 「潮汐」: 味方が倒れると生存者を癒す
    for (const a of this.alive(target.side)) {
      if (passiveOf(a) === 'tide') {
        ev.push({ t: 'passive', uid: a.uid, label: '潮汐' });
        for (const b of this.alive(target.side)) this.heal(a, b, Math.round(a.atk * 1.2), ev);
        break;
      }
    }
    // 味方全体の OD（撃破された側）
    for (const a of this.alive(target.side)) this.gainOd(a, 25, ev);

    if (target.row === 'front') this.promoteNext(target.side, ev);
  }

  /** 前列が落ちたら、編成順で次の1体を前へ出す */
  private promoteNext(side: Side, ev: BattleEvent[]): void {
    const living = this.alive(side).filter((f) => f.promoteDelay === 0);
    if (living.length === 0) return;
    if (living.some((f) => f.row === 'front')) return;
    const next = living.slice().sort((a, b) => a.slot - b.slot)[0];
    next.row = 'front';
    ev.push({ t: 'promote', uid: next.uid, from: 'back', to: 'front' });
  }

  private gainOd(f: Fighter, amount: number, ev: BattleEvent[]): void {
    if (!f.alive) return;
    let mul = this.formations[f.side].odGainMul * (f.row === 'front' ? 1.2 : 1);
    // 「制海」: 海の主が生きている間、向かいの側は必殺技が溜まらない。
    // 与ダメージを押し上げないので、盾役や回復役の居場所を潰さずに強い
    if (this.alive(other(f.side)).some((e) => passiveOf(e) === 'deepreign')) mul *= 0.8;
    // 「大喙」: 通常攻撃が重いぶん、必殺技の出番が遅い
    if (passiveOf(f) === 'greatbeak') mul *= 0.8;
    // 「掌握する空」: 空を握りきっている間、味方の必殺技が早く回る。
    // ATK を積む前半だけの特性だと、5回の攻撃で仕事を終えて
    // 残り35ターンを黙って立っていることになる。後半の仕事をここに置く
    if (this.alive(f.side).some((a) => passiveOf(a) === 'skygrasp' && (a.stacks.sky ?? 0) >= 3)) {
      mul *= 1.2;
    }
    const before = f.od;
    f.od = clamp(f.od + amount * mul, 0, 150);
    if (Math.round(f.od) !== Math.round(before)) ev.push({ t: 'od', uid: f.uid, value: f.od });
    if (before < 100 && f.od >= 100) ev.push({ t: 'odReady', uid: f.uid });
  }

  private addMod(f: Fighter, mod: Mod, ev: BattleEvent[], label: string): void {
    f.mods.push(mod);
    ev.push({ t: 'mod', uid: f.uid, kind: mod.kind, value: mod.value, turns: mod.turns, label });
  }

  private decayMods(f: Fighter): void {
    f.mods = f.mods.filter((m) => {
      if (m.until !== undefined) return this.clockV < m.until;
      if (m.turns >= 999) return true;
      m.turns--;
      return m.turns > 0;
    });
  }

  /**
   * 秒で切れたバフを全員から掃除する。
   *
   * decayMods は行動した本人にしか回らないので、それだけだと切れた効果が
   * 配列に残り、UI に「まだ乗っている」と見えてしまう。効き目は modSum が
   * 時刻で弾いているが、表示のために毎 step ここで落とす。
   */
  private sweepTimedMods(): void {
    for (const f of this.fighters) {
      // 秒で切れる再生も同じところで落とす。行動が回らないまま期限を
      // 過ぎた個体に、あとから遡って回復が入るのを防ぐ
      if (f.statuses.some((s) => s.until !== undefined && this.clockV >= s.until)) {
        f.statuses = f.statuses.filter((s) => s.until === undefined || this.clockV < s.until);
      }
      if (f.mods.some((m) => m.until !== undefined && this.clockV >= m.until)) {
        f.mods = f.mods.filter((m) => m.until === undefined || this.clockV < m.until);
      }
    }
  }

  private applyBurn(target: Fighter, ev: BattleEvent[], source: string): void {
    const existing = target.statuses.find((s) => s.kind === 'burn');
    if (existing) existing.turns = Math.max(existing.turns, 3);
    else target.statuses.push({ kind: 'burn', turns: 3, value: 0.04, source });
    ev.push({ t: 'status', uid: target.uid, kind: 'burn', applied: true });
  }

  private tickStatuses(f: Fighter, ev: BattleEvent[]): void {
    for (const s of f.statuses) {
      if (s.kind === 'regen') {
        const left = s.pool ?? 0;
        if (left <= 0) { s.turns = 0; continue; }
        const amount = Math.min(s.value, left);
        s.pool = left - amount;
        const src = this.fighters.find((x) => s.source.startsWith(x.uid + '|')) ?? f;
        this.heal(src, f, amount, ev);
        if ((s.pool ?? 0) <= 0) s.turns = 0;
        continue;
      }
      if (s.kind === 'burn') {
        const dmg = Math.max(1, Math.round(f.maxHp * s.value));
        f.hp = Math.max(0, f.hp - dmg);
        ev.push({ t: 'statusTick', uid: f.uid, kind: 'burn', amount: dmg, hp: f.hp });
        if (f.hp === 0) {
          const src = this.fighters.find((x) => x.uid === s.source) ?? f;
          this.kill(f, src, ev);
          return;
        }
      }
      s.turns--;
    }
    f.statuses = f.statuses.filter((s) => s.turns > 0);
  }

  private pickTarget(actor: Fighter): Fighter | null {
    const enemies = this.alive(other(actor.side));
    if (enemies.length === 0) return null;

    // 被弾率: 前列60% / 後列各20%（前列不在なら均等に再配分）
    const weights = enemies.map((e) => {
      let w = e.row === 'front' ? 0.6 : 0.2;
      if (!enemies.some((x) => x.row === 'front')) w = 1 / enemies.length;
      if (e.row === 'back') w += this.formations[e.side].backHitRateBonus;
      return w;
    });

    // 作戦による重み付け。完全なランダムにはしない
    // （観戦しかできないプレイヤーには理不尽にしか見えない）
    const bias = enemies.map((e, i) => {
      let b = weights[i];
      const def = getRevos(e.defId);
      switch (actor.targetPref) {
        case 'front':
          b *= e.row === 'front' ? 1.7 : 1;
          break;
        case 'back':
          b *= e.row === 'back' ? 2.4 : 1;
          break;
        case 'lowhp':
          // 集中砲火は元々強いので、重みは控えめでも充分に機能する
          b *= 1 + Math.pow(1 - e.hp / e.maxHp, 1.5) * 1.6;
          break;
        case 'defense':
          b *= 1 + (e.def / 150) * 1.25;
          break;
        case 'support':
          b *= def.role === 'Healer' || def.role === 'Buffer' ? 2.4
            : def.role === 'Debuffer' ? 1.5 : 1;
          break;
      }
      if (actor.stance === 'aggressive') {
        const est = this.estimateDamage(actor, e, this.basicPowerOf(actor));
        if (est >= e.hp) b *= 3;
      }
      return b;
    });

    const total = bias.reduce((s, b) => s + b, 0);
    let r = this.rng.next() * total;
    let picked = enemies[enemies.length - 1];
    for (let i = 0; i < enemies.length; i++) {
      r -= bias[i];
      if (r <= 0) { picked = enemies[i]; break; }
    }
    return this.coverFor(picked);
  }

  /**
   * 「板の放熱」: 後列を狙った一撃を、前で立っている本人が受けに行く。
   *
   * 盾（岩盾展開）は量を肩代わりするが、これは相手を差し替える。後列の
   * 回復役・支援役が先に落ちる展開そのものを潰せるので、シールドとは
   * 役割が重ならない。乱数はここでも引く——引く回数が分岐で変わると
   * 同じシードで同じ戦闘にならなくなるため、条件を満たすときだけ引く。
   */
  private coverFor(target: Fighter): Fighter {
    if (target.row !== 'back') return target;
    const guard = this.alive(target.side).find(
      (a) => a !== target && a.row === 'front' && passiveOf(a) === 'platescreen',
    );
    if (!guard) return target;
    return this.rng.chance(0.45) ? guard : target;
  }

  private teamHpRatio(side: Side): number {
    const team = this.fighters.filter((f) => f.side === side);
    return team.reduce((s, f) => s + f.hp / f.maxHp, 0);
  }

  private checkEnd(ev: BattleEvent[]): void {
    if (this.finished) return;
    const a = this.alive(0).length;
    const b = this.alive(1).length;
    if (a > 0 && b > 0) return;
    this.winner = a > 0 ? 0 : b > 0 ? 1 : -1;
    this.finished = true;
    ev.push({ t: 'end', winner: this.winner, turns: this.turn });
  }

  private finish(ev: BattleEvent[]): void {
    if (this.finished) return;
    this.finished = true;
    this.winner = -1;
    ev.push({ t: 'end', winner: -1, turns: this.turn });
  }
}

function formOf(setup: TeamSetup) {
  return FORMATIONS[setup.formation];
}

function odPower(f: Fighter): number {
  return getRevos(f.defId).od.power;
}

function passiveOf(f: Fighter): string {
  return getRevos(f.defId).passive.id;
}

function other(s: Side): Side { return s === 0 ? 1 : 0; }
function clamp(v: number, a: number, b: number): number { return v < a ? a : v > b ? b : v; }

/** 一括実行（バランス検証・CI用） */
export function simulate(seed: number, teamA: TeamSetup, teamB: TeamSetup): {
  events: BattleEvent[];
  result: BattleResult;
} {
  const sim = new BattleSim(seed, teamA, teamB);
  const events = sim.runToEnd();
  return { events, result: sim.result() };
}
