import { getRevos } from '../data/revos';
import {
  elementFactor,
  type BattleEvent, type BattleRules, type Fighter, type FighterSnapshot, type Mod, type ModKind,
  type Side, type TeamSetup,
} from './types';
import { TACTICS, isBackliner, isRanged, isWall } from './roles';

/**
 * バトルの純粋シミュレーション（リアルタイム）。
 *
 * 1/30 秒刻みの固定ステップで、全員が同時に動き、狙い、殴る。
 * 刻みが固定で乱数もシード付きなので、「同じシード ＋ 同じ入力列 →
 * 同じイベント列」はそのまま保たれる——倍速・スキップ・バランス計測は
 * 刻みを速く回すだけで済む。
 *
 * 位置もここが持つ。描画は座標を映すだけで、勝敗には一切関与しない。
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

/** 1ステップの長さ（戦闘内の秒） */
export const DT = 1 / 30;
/**
 * 行動の間隔。SPD 100 の個体が 4 秒に1回動く（間隔 = ACTION_BASE / SPD 秒）。
 * 全員が同時に動くので、6体いれば 0.7 秒に1回はどこかで何かが当たる。
 */
const ACTION_BASE = 400;
/** 火傷・毒の刻み。SPD 100 の1行動ぶん */
export const STATUS_TICK = 4;
/** 再生の刻み */
const REGEN_TICK = 1;
/** これを過ぎたら体力の割合で判定する */
const MAX_TIME = 180;
/** 狙いを選び直す間隔。毎刻み選ぶと、距離が拮抗した2体のあいだで首を振り続ける */
const RETARGET = 0.5;
/** 接敵とみなす距離。前線に立っているかどうかはこれで決まる */
const CONTACT = 2.0;
/** 壁が近接の足を止める半径 */
const ZOC = 2.6;
/**
 * 壁の持ち場。味方の本隊（壁と特攻役を除いた者）の中心から、これより遠い
 * 敵は追わない。壁が敵陣の奥まで走っていくと、前に立つ役がいなくなる
 */
const LEASH = 4.5;
/** 狙う相手が持ち場の外にいるとき、壁が立つ位置（本隊の中心から敵側へ） */
const GUARD_AHEAD = 2.2;
/** 体どうしの最小間隔（中心間）。標準の体どうしのとき */
const BODY = 1.35;
/** 標準の体の半径 */
const R0 = BODY / 2;
/** 戦場の広さ。自軍は +z 側、敵は −z 側から始まる */
const ARENA_X = 4.2;
const ARENA_Z = 7.2;
/** 構えから打点までの秒数 */
const WINDUP_MELEE = 0.2;
const WINDUP_RANGED = 0.3;
const WINDUP_OD = 0.5;
/** 射撃の通常攻撃は、踏み込まずに撃てるぶん軽い */
const RANGED_BASIC = 0.9;
/** 回復役の通常行動が癒す量（ATK × 通常攻撃の威力 × これ） */
const HEAL_BASIC = 2.4;
/** 回復役が手を回し始める体力の割合 */
const HEAL_BELOW = 0.6;
/** 崩し役が壁に、特攻役が後衛に入れる割り増し */
const BREAKER_VS_WALL = 1.4;
const RAIDER_VS_BACK = 1.2;

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
  tyrantrequiem: 0.55, forkjaw: 0.6, gazepierce: 0.5,
  crimsoncharge: 0.55, harvest: 0.55, serpentvenom: 0.5,
  hornrout: 0.8,
  // 支援：撃っても攻め手が止まらないよう隙を小さく
  rockaegis: 0.28, tideheal: 0.28, resonantlight: 0.28, grindfeed: 0.28,
};

/**
 * 表に無い技ぶんの隙。書き忘れても NaN で止まらないよう、無難な値で続かせる。
 */
const OD_RECOVERY_DEFAULT = 0.5;

/**
 * 必殺の届き方。
 *   single  … 1体を狙う。間合いに入るまで撃たない
 *   enemies … 敵全体。どこからでも撃てる
 *   allies  … 味方へ。どこからでも撃てる
 */
type OdShape = 'single' | 'enemies' | 'allies';
const OD_SHAPE: Record<string, OdShape> = {
  galerend: 'enemies', scorchring: 'enemies', erosionstorm: 'enemies', greateruption: 'enemies',
  abyssalmaw: 'enemies', hatzegwing: 'enemies', hornrout: 'enemies',
  rockaegis: 'allies', tideheal: 'allies', resonantlight: 'allies', stratarecord: 'allies',
  skyreign: 'allies', grindfeed: 'allies',
};
/** 通常の間合いより遠くから撃てる単体技 */
const OD_REACH: Record<string, number> = { faulthaul: 7, leapstrike: 6.5 };

/** 「制空覇道」の持続（秒） */
const SKYREIGN_DURATION = 10;
/** 「磨り潰し消化」の再生時間（秒） */
const GRINDFEED_DURATION = 5;
/**
 * 「磨り潰し消化」の配り方。撃った時点で半分を渡し、残りを再生の刻みで配る。
 */
const GRINDFEED_INSTANT = 0.5;
const GRINDFEED_TICK = 0.34;

/** 引き寄せた相手を動けなくしておく秒数 */
const PULL_HOLD = 2.0;
/** 「断層圧砕」で足を止める秒数 */
const CRUSH_ROOT = 1.5;

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

/** 毒1つぶんの 1刻みあたりの削り（最大体力比）と、重ねられる上限・持続 */
const POISON_PER_STACK = 0.03;
const POISON_MAX_STACK = 3;
const POISON_TURNS = 5;

/** 刻印の無い個体ぶん。毎回 0 のオブジェクトを作らない */
const NO_ENGRAVING = { atk: 0, def: 0, hp: 0, spd: 0 };

/**
 * 開戦時の横位置。並び順で中央から左右へ振り分ける。
 * 同じ列に立つ者どうしが体の間隔（BODY）より近くならないよう、1.4 ずつ空ける
 */
const LANE_X = [0, -1.4, 1.4, -2.8, 2.8];
/** 最前列の奥行きと、列ごとの間隔 */
const FRONT_Z = 3.6;
const DEPTH_STEP = 1.25;

function buildFighters(setup: TeamSetup, side: Side): Fighter[] {
  const out: Fighter[] = [];
  const back = side === 0 ? 1 : -1;
  setup.order.forEach((memberIdx, slot) => {
    const inst = setup.members[memberIdx];
    const def = getRevos(inst.defId);
    const ls = levelScale(inst.level);
    const mc = cleanMultiplier(inst.clean);
    const eg = inst.engraving ?? NO_ENGRAVING;
    const x = LANE_X[slot % LANE_X.length];
    const z = back * (FRONT_Z + TACTICS[def.role].depth * DEPTH_STEP);
    const b = inst.boost ?? {};
    const size = b.size ?? 1;
    out.push({
      uid: inst.uid,
      defId: def.id,
      name: def.name,
      element: def.element,
      role: def.role,
      passive: def.passive.id,
      odId: def.od.id,
      side,
      slot,
      level: inst.level,
      clean: inst.clean,
      skillLevel: inst.skillLevel,
      // 刻印はレベルもクリーン度も掛からない純粋な加算。最後に足す——
      // 倍率の中に入れると、育てるほど刻印の差まで広がって二重に効く
      maxHp: Math.round((Math.round(def.hp * ls * mc) + eg.hp) * (b.hp ?? 1)),
      hp: Math.round((Math.round(def.hp * ls * mc) + eg.hp) * (b.hp ?? 1)),
      atk: Math.round((Math.round(def.atk * ls * mc) + eg.atk) * (b.atk ?? 1)),
      def: Math.round((Math.round(def.def * ls * mc) + eg.def) * (b.def ?? 1)),
      spd: Math.round((Math.round(def.spd * ls) + eg.spd) * (b.spd ?? 1)),
      basicPower: def.basicPower,
      size,
      radius: R0 * size,
      anchored: b.anchored ?? false,
      x, z, px: x, pz: z,
      ready: 0,
      od: 30,
      alive: true,
      mods: [],
      statuses: [],
      shield: null,
      target: null,
      cast: null,
      rootedUntil: 0,
      stacks: {},
      dealt: 0, taken: 0, healed: 0, kills: 0,
    });
  });
  return out;
}

function snapshot(f: Fighter): FighterSnapshot {
  return {
    uid: f.uid, defId: f.defId, name: f.name, element: f.element,
    side: f.side, x: f.x, z: f.z, maxHp: f.maxHp, hp: f.hp,
    atk: f.atk, def: f.def, spd: f.spd, od: f.od,
  };
}

export interface BattleResult {
  winner: Side | -1;
  /** 決着までに出た行動の数 */
  turns: number;
  /** 決着までの秒数（戦闘内時刻） */
  seconds: number;
  /** 制限時間で打ち切られたか */
  timeUp: boolean;
  survivors: number;
  fighters: Fighter[];
}

export class BattleSim {
  readonly fighters: Fighter[];
  private rng: Prng;
  private turn = 0;
  /** 戦闘内の経過秒。step 1回で DT 進む */
  private clockV = 0;
  private finished = false;
  private winner: Side | -1 = -1;
  /** プレイヤーが「このユニットのODを溜めて撃つ」と指示した集合 */
  private odHold = new Set<string>();
  private odFire = new Set<string>();
  /** 次に狙いを選び直す時刻 */
  private retargetAt = new Map<string, number>();
  /** 次に火傷・毒が刻む時刻と、次に再生が刻む時刻 */
  private statusAt = new Map<string, number>();
  private regenAt = new Map<string, number>();
  private byUid = new Map<string, Fighter>();
  /** 本隊の中心。刻みごとに1度だけ出す */
  private anchors: [{ x: number; z: number } | null, { x: number; z: number } | null] = [null, null];
  private rules: BattleRules;
  private timeLimit: number;
  private timedOut = false;

  constructor(seed: number, teamA: TeamSetup, teamB: TeamSetup, rules: BattleRules = {}) {
    this.rng = new Prng(seed);
    this.rules = rules;
    this.timeLimit = rules.timeLimit ?? MAX_TIME;
    this.fighters = [...buildFighters(teamA, 0), ...buildFighters(teamB, 1)];
    this.fighters.forEach((f, i) => {
      this.byUid.set(f.uid, f);
      // 選び直しの時刻をずらす。全員が同じ刻みで選ぶと、狙いが一斉に動いて見える
      this.retargetAt.set(f.uid, (i % 6) * (RETARGET / 6));
      this.statusAt.set(f.uid, STATUS_TICK);
      this.regenAt.set(f.uid, REGEN_TICK);
      if (f.passive === 'vanguard') f.ready += 0.35;
    });
  }

  get isOver(): boolean { return this.finished; }
  get currentWinner(): Side | -1 { return this.winner; }
  get turnCount(): number { return this.turn; }
  /** 戦闘内の経過秒 */
  get clock(): number { return this.clockV; }
  /** 制限時間（秒） */
  get limit(): number { return this.timeLimit; }
  /** 場の決まりで制限時間が付いているか。付いていれば残りを数えて見せる */
  get hasLimit(): boolean { return this.rules.timeLimit !== undefined; }

  /** バフ込みの実効 SPD */
  speedOf(f: Fighter): number { return this.effSpd(f); }

  /** 行動ゲージの充填率 0..1。構え中は満ちたまま見せる */
  charge(f: Fighter): number {
    if (!f.alive) return 0;
    if (f.cast) return 1;
    return f.ready < 0 ? 0 : f.ready > 1 ? 1 : f.ready;
  }

  startEvents(): BattleEvent[] {
    return [{ t: 'start', fighters: this.fighters.map(snapshot) }];
  }

  /**
   * 必殺を自動で撃つか。false なら満ちても溜め続け、タップで撃つまで待つ
   * （150 に達したぶんは捨てずに放出する）。
   */
  autoOd = true;

  setOdHold(uid: string, hold: boolean): void {
    if (hold) this.odHold.add(uid);
    else this.odHold.delete(uid);
  }

  /** 溜めた OD を撃つ指示。間合いに入った最初の刻みで撃つ */
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

  /** 1刻みぶん進め、その間に起きたイベントを返す */
  step(): BattleEvent[] {
    if (this.finished) return [];
    const ev: BattleEvent[] = [];
    this.clockV += DT;
    for (const f of this.fighters) { f.px = f.x; f.pz = f.z; }
    this.sweepTimedMods();

    // 1) 時間で刻むもの（火傷・毒・再生）
    for (const f of this.fighters) if (f.alive) this.tickTimers(f, ev);
    if (this.checkEnd(ev)) return ev;

    // 処理の順を刻みごとに入れ替える。いつも自軍から回すと、同じ刻みで
    // 打ち合ったときに必ず自軍の一撃が先に通り、相討ちが自軍の勝ちに化ける
    const order = this.stepOrder();

    // 2) 構えていた技の打点
    for (const f of order) {
      if (f.alive && f.cast && f.cast.at <= this.clockV + 1e-9) this.resolveCast(f, ev);
    }
    if (this.checkEnd(ev)) return ev;

    // 3) 狙う・構える・動く
    this.anchors = [this.anchorOf(0), this.anchorOf(1)];
    for (const f of order) if (f.alive) this.think(f, ev);

    // 4) 押し合い。全員の移動を出してから解かないと、先に動いた個体だけが譲る
    this.separate();

    if (this.checkEnd(ev)) return ev;
    if (this.clockV >= this.timeLimit) {
      this.timedOut = true;
      // 場の決まりで時間を切られた戦い（巨獣）は時間切れ＝引き分け。
      // 通常戦の打ち切りは、決着しない編成を無限にしないための保険なので、
      // HP 割合の合計で判定する
      const a = this.teamHpRatio(0);
      const b = this.teamHpRatio(1);
      this.winner = this.rules.timeLimit !== undefined ? -1 : a === b ? -1 : a > b ? 0 : 1;
      this.finished = true;
      ev.push({ t: 'end', winner: this.winner, turns: this.turn });
    }
    return ev;
  }

  private tick = 0;
  /** 奇数の刻みは並びを逆にたどる。乱数を使わないので、再現性はそのまま */
  private stepOrder(): Fighter[] {
    this.tick++;
    return this.tick % 2 === 0 ? this.fighters : [...this.fighters].reverse();
  }

  runToEnd(): BattleEvent[] {
    const all: BattleEvent[] = [...this.startEvents()];
    const limit = Math.ceil(this.timeLimit / DT) + 8;
    let guard = 0;
    while (!this.finished && guard++ < limit) all.push(...this.step());
    return all;
  }

  result(): BattleResult {
    return {
      winner: this.winner,
      turns: this.turn,
      seconds: this.clockV,
      timeUp: this.timedOut,
      survivors: this.alive(this.winner === -1 ? undefined : (this.winner as Side)).length,
      fighters: this.fighters,
    };
  }

  // ------------------------------------------------------------ 立ち回り

  private think(f: Fighter, ev: BattleEvent[]): void {
    // 構えている間はゲージも足も止まる
    if (f.cast) return;
    if (f.ready < 1) f.ready = Math.min(1, f.ready + DT * this.effSpd(f) * (this.rules.tempo ?? 1) / ACTION_BASE);

    let t = f.target ? this.byUid.get(f.target) ?? null : null;
    if (!t || !t.alive || this.clockV >= (this.retargetAt.get(f.uid) ?? 0)) {
      t = this.chooseTarget(f);
      f.target = t?.uid ?? null;
      this.retargetAt.set(f.uid, this.clockV + RETARGET);
    }

    const tac = TACTICS[f.role];

    // 必殺。全体技と味方向けはどこからでも、単体技は届く距離に入ってから
    if (this.shouldFireOd(f)) {
      const shape = OD_SHAPE[f.odId] ?? 'single';
      if (shape !== 'single') { this.startCast(f, 'od', null, ev); return; }
      const ot = f.odId === 'faulthaul' ? this.haulTarget(f) : t;
      const reach = OD_REACH[f.odId] ?? tac.range;
      if (ot && gap(f, ot) <= reach + 0.2) { this.startCast(f, 'od', ot, ev); return; }
    }

    // 回復役の通常行動。傷んだ味方がいれば、殴るより先にそちらへ手を回す
    if (f.role === 'Healer' && f.ready >= 1) {
      const hurt = minBy(this.alive(f.side), (a) => a.hp / a.maxHp);
      if (hurt.hp / hurt.maxHp < HEAL_BELOW) { this.startCast(f, 'basic', hurt, ev); return; }
    }

    // 通常攻撃
    if (t && f.ready >= 1 && gap(f, t) <= tac.range + 0.2) {
      this.startCast(f, 'basic', t, ev);
      return;
    }

    if (this.clockV < f.rootedUntil || !t) return;
    this.move(f, t);
  }

  /**
   * 誰を狙うか。役職がそのまま決める。
   *
   * 近接で「足を止められる」役は、敵の壁の間合いに入った時点でその壁を
   * 殴るしかなくなる——壁役が前に立つ意味はここにある。特攻役だけは
   * これを無視して奥へ抜ける。
   */
  private chooseTarget(f: Fighter): Fighter | null {
    const enemies = this.alive(other(f.side));
    if (enemies.length === 0) return null;
    const tac = TACTICS[f.role];

    let pick: Fighter;
    switch (f.role) {
      case 'Tank': {
        // 味方（壁以外）に向かっている敵を、近い順に引き受ける。持ち場の外は後回し
        pick = minBy(enemies, (e) => {
          const onAlly = e.target ? this.byUid.get(e.target) : undefined;
          const peel = onAlly && onAlly.side === f.side && onAlly !== f && !isWall(onAlly.role) ? -2.5 : 0;
          return dist(f, e) + peel + (this.inPost(f, e) ? 0 : 6);
        });
        break;
      }
      case 'Guardian': {
        // いちばん狙われている味方を守る。その味方を狙っている敵のうち近いもの
        const ward = this.mostThreatened(f);
        const onWard = ward ? enemies.filter((e) => e.target === ward.uid) : [];
        pick = onWard.length > 0
          ? minBy(onWard, (e) => dist(f, e) + (this.inPost(f, e) ? 0 : 6))
          : minBy(enemies, (e) => dist(f, e) + (this.inPost(f, e) ? 0 : 6));
        break;
      }
      case 'Breaker':
        // 硬い相手から崩す
        pick = minBy(enemies, (e) => -e.def * clamp(1 + this.modSum(e, 'def'), 0.3, 3) + dist(f, e) * 4);
        break;
      case 'Finisher':
        pick = minBy(enemies, (e) => e.hp / e.maxHp + dist(f, e) * 0.02);
        break;
      case 'Sprinter':
        // 後衛から。後衛がいなければ柔らかい相手
        pick = minBy(enemies, (e) => (isBackliner(e.role) ? -1000 : 0) + e.def + dist(f, e) * 2);
        break;
      case 'Debuffer':
        pick = minBy(enemies, (e) => -e.atk + dist(f, e) * 6);
        break;
      case 'Technical':
        pick = minBy(enemies, (e) => e.hp / e.maxHp + (dist(f, e) > tac.range ? 1 : 0));
        break;
      default:
        pick = minBy(enemies, (e) => dist(f, e));
    }

    // 壁の間合い。近接で足を止められる役は、いちばん近い壁を殴る。
    // 仕留め役は、狙いが瀕死ならすり抜ける
    if (tac.held && !isRanged(f.role)) {
      const slip = f.role === 'Finisher' && pick.hp / pick.maxHp < 0.4;
      if (!slip) {
        const walls = enemies.filter((e) => isWall(e.role) && gap(f, e) <= ZOC);
        if (walls.length > 0 && !walls.includes(pick)) pick = minBy(walls, (e) => gap(f, e));
      }
    }
    return pick;
  }

  /** 味方のうち、いちばん多くの敵に狙われている者（自分は除く） */
  private mostThreatened(f: Fighter): Fighter | null {
    // 特攻役は自分で敵陣へ飛び込んでいる。追いかけて守ると、壁ごと持ち場を離れる
    const allies = this.alive(f.side).filter((a) => a !== f && a.role !== 'Sprinter');
    if (allies.length === 0) return null;
    const enemies = this.alive(other(f.side));
    return minBy(allies, (a) => {
      const n = enemies.filter((e) => e.target === a.uid).length;
      return -n * 10 + a.hp / a.maxHp;
    });
  }

  /** 「断層牽引」で引く相手。前に出ていない者、とくに後衛から */
  private haulTarget(f: Fighter): Fighter | null {
    const enemies = this.alive(other(f.side));
    if (enemies.length === 0) return null;
    const reach = OD_REACH.faulthaul;
    const inReach = enemies.filter((e) => gap(f, e) <= reach && !e.anchored);
    if (inReach.length === 0) return null;
    return minBy(inReach, (e) => (this.engaged(e) ? 10 : 0) + (isBackliner(e.role) ? -1 : 0) + dist(f, e) * 0.05);
  }

  /**
   * 足を運ぶ。
   *
   * 近接は相手の懐まで。ただし味方の壁が接敵するまでは、その後ろで待つ——
   * 壁より先に打撃役がぶつかると、前に立つ役がいる意味が無くなる。
   * 射撃と支援は間合いの端で止まり、寄られたら下がる。
   */
  private move(f: Fighter, t: Fighter): void {
    const tac = TACTICS[f.role];
    const speed = (1.6 + this.effSpd(f) * 0.014) * tac.move;
    const stepLen = speed * DT;

    let gx = f.x;
    let gz = f.z;
    if (tac.keepAway > 0) {
      const near = minBy(this.alive(other(f.side)), (e) => gap(f, e));
      const dn = gap(f, near);
      if (dn < tac.keepAway) {
        // 寄られた。相手から離れる向きへ下がる
        const k = 1 / Math.max(1e-4, dn);
        gx = f.x + (f.x - near.x) * k;
        gz = f.z + (f.z - near.z) * k;
      } else if (gap(f, t) > tac.range * 0.9) {
        gx = t.x; gz = t.z;
      } else {
        return;
      }
    } else if (isWall(f.role) && !this.inPost(f, t)) {
      // 狙いが持ち場の外。追わずに、本隊の前へ立つ
      const home = this.anchors[f.side]!;
      const foe = this.anchors[other(f.side)] ?? t;
      const dx = foe.x - home.x;
      const dz = foe.z - home.z;
      const d = Math.max(1e-4, Math.hypot(dx, dz));
      gx = home.x + (dx / d) * GUARD_AHEAD;
      gz = home.z + (dz / d) * GUARD_AHEAD;
      if (Math.hypot(gx - f.x, gz - f.z) < 0.15) return;
    } else {
      if (gap(f, t) <= tac.range * 0.85) return;
      gx = t.x; gz = t.z;
    }

    const dx = gx - f.x;
    const dz = gz - f.z;
    const d = Math.hypot(dx, dz);
    if (d < 1e-4) return;
    const s = Math.min(stepLen, d);
    let nx = f.x + (dx / d) * s;
    let nz = f.z + (dz / d) * s;

    // 壁の後ろで待つ。前へ出る成分だけを止め、横へは回り込ませる
    if (tac.behindWall) {
      const limit = this.wallLimit(f);
      if (limit !== null) {
        const fw = forward(f.side, nz);
        if (fw > limit && fw > forward(f.side, f.z)) nz = f.z;
      }
    }

    f.x = clamp(nx, -ARENA_X, ARENA_X);
    f.z = clamp(nz, -ARENA_Z, ARENA_Z);
  }

  /**
   * 味方の壁の前線。壁が1体でも接敵していれば、もう待つ必要はない（null）。
   * 戻り値は「前へ出てよい上限」を forward 座標で表したもの
   */
  private wallLimit(f: Fighter): number | null {
    let front = -Infinity;
    let any = false;
    for (const a of this.fighters) {
      if (!a.alive || a.side !== f.side || a === f || !isWall(a.role)) continue;
      if (this.engaged(a)) return null;
      any = true;
      front = Math.max(front, forward(a.side, a.z));
    }
    return any ? front - 0.9 : null;
  }

  /**
   * 本隊の中心。壁と特攻役を除いた生存者の重心で、居なければ null——
   * 守る相手がいない壁は、持ち場に縛られずに殴りに行く。
   */
  private anchorOf(side: Side): { x: number; z: number } | null {
    let x = 0;
    let z = 0;
    let n = 0;
    for (const a of this.fighters) {
      if (!a.alive || a.side !== side || isWall(a.role) || a.role === 'Sprinter') continue;
      x += a.x; z += a.z; n++;
    }
    return n > 0 ? { x: x / n, z: z / n } : null;
  }

  /** 壁にとって、その敵が持ち場の内側か。自分の間合いに入った敵は常に内側 */
  private inPost(f: Fighter, e: Fighter): boolean {
    const home = this.anchors[f.side];
    if (!home) return true;
    return gap(f, e) <= ZOC || Math.hypot(e.x - home.x, e.z - home.z) <= LEASH;
  }

  /** 前線に立っているか。敵が手の届く距離にいる */
  private engaged(f: Fighter): boolean {
    for (const e of this.fighters) {
      if (e.alive && e.side !== f.side && gap(f, e) <= CONTACT) return true;
    }
    return false;
  }

  /** 体どうしを押し離す。敵味方の区別なく押し合う */
  private separate(): void {
    const list = this.alive();
    for (let i = 0; i < list.length; i++) {
      for (let j = i + 1; j < list.length; j++) {
        const a = list[i];
        const b = list[j];
        const dx = b.x - a.x;
        const dz = b.z - a.z;
        const d = Math.hypot(dx, dz);
        const min = a.radius + b.radius;
        if (d >= min) continue;
        // 完全に重なったときは、並び順で決まる向きへ離す
        const ux = d < 1e-4 ? (a.side === b.side ? 1 : 0) : dx / d;
        const uz = d < 1e-4 ? (a.side === b.side ? 0 : 1) : dz / d;
        const push = (min - d) * 0.5;
        const nx = ux * push;
        const nz = uz * push;
        // 構えている者と動けない者は押されにくい。打つ瞬間に滑ると間合いが崩れる
        // 大きい体は押されにくい
        const wa = (a.cast || this.clockV < a.rootedUntil ? 0.3 : 1) / (a.size * a.size);
        const wb = (b.cast || this.clockV < b.rootedUntil ? 0.3 : 1) / (b.size * b.size);
        const sum = wa + wb;
        a.x -= nx * (2 * wa / sum); a.z -= nz * (2 * wa / sum);
        b.x += nx * (2 * wb / sum); b.z += nz * (2 * wb / sum);
        a.x = clamp(a.x, -ARENA_X, ARENA_X); a.z = clamp(a.z, -ARENA_Z, ARENA_Z);
        b.x = clamp(b.x, -ARENA_X, ARENA_X); b.z = clamp(b.z, -ARENA_Z, ARENA_Z);
      }
    }
  }

  // ------------------------------------------------------------ 行動

  /**
   * 必殺を撃つか。満ちたら撃つ。手動に切り替えているときだけ溜め、
   * 150 で自動的に放出する（上限を超えたぶんは捨てるだけなので、溜め得にはしない）。
   */
  private shouldFireOd(f: Fighter): boolean {
    if (f.od < 100) return false;
    if (this.odFire.has(f.uid)) return true;
    if (this.odHold.has(f.uid) || !this.autoOd) return f.od >= 150;
    return true;
  }

  /**
   * 構える。ここが以前の「行動の始まり」——必殺の溜め、行動のたびに
   * 動く特性はここで回す。打点は windup 秒後に resolveCast で来る。
   */
  private startCast(f: Fighter, kind: 'basic' | 'od', t: Fighter | null, ev: BattleEvent[]): void {
    this.turn++;
    this.gainOd(f, 3, ev);
    this.onActionPassives(f, ev);

    const ranged = isRanged(f.role);
    let windup: number;
    let targets: string[];
    let name: string;
    if (kind === 'od') {
      const def = getRevos(f.defId);
      const shape = OD_SHAPE[f.odId] ?? 'single';
      name = def.od.name;
      targets = shape === 'enemies' ? this.alive(other(f.side)).map((e) => e.uid)
        : shape === 'allies' ? this.alive(f.side).map((a) => a.uid)
        : t ? [t.uid] : [];
      windup = WINDUP_OD;
      // 必殺は1行動ぶんに加えて、技の重さぶんの隙を払う
      f.ready -= 1 + (OD_RECOVERY[f.odId] ?? OD_RECOVERY_DEFAULT);
      this.odFire.delete(f.uid);
    } else {
      name = t && t.side === f.side ? '手当て' : '通常攻撃';
      targets = t ? [t.uid] : [];
      windup = ranged ? WINDUP_RANGED : WINDUP_MELEE;
      f.ready -= 1;
    }
    ev.push({ t: 'action', uid: f.uid, kind, name, targets, ranged, windup });
    f.cast = { kind, target: t?.uid ?? null, at: this.clockV + windup };
  }

  private onActionPassives(f: Fighter, ev: BattleEvent[]): void {
    // 「堆積」: 行動のたびに DEF が伸びる
    if (f.passive === 'sediment') {
      const st = f.stacks.sediment ?? 0;
      if (st < 5) {
        f.stacks.sediment = st + 1;
        this.addMod(f, { kind: 'def', value: 0.09, turns: 999, source: 'sediment' }, ev, '堆積');
      }
    }
    // 「潮汐」: 行動のたびに、いちばん傷んだ味方へ手を回す
    if (f.passive === 'tide') {
      const hurt = minBy(this.alive(f.side), (a) => a.hp / a.maxHp);
      if (hurt && hurt.hp < hurt.maxHp) {
        ev.push({ t: 'passive', uid: f.uid, label: '潮汐' });
        this.heal(f, hurt, Math.round(f.atk * 0.46), ev);
      }
    }
    // 「共鳴」: 味方全体の OD を押し上げる
    if (f.passive === 'resonance') {
      ev.push({ t: 'passive', uid: f.uid, label: '共鳴' });
      // 5体に配るので、1体ぶんは3体のころより薄くする
      for (const a of this.alive(f.side)) this.gainOd(a, 6, ev);
    }
  }

  /** 打点。構えたあいだに狙いが倒れていれば、選び直して当てる */
  private resolveCast(f: Fighter, ev: BattleEvent[]): void {
    const c = f.cast!;
    f.cast = null;
    let t = c.target ? this.byUid.get(c.target) ?? null : null;
    if (t && !t.alive) t = null;

    if (c.kind === 'basic') {
      if (!t) t = this.chooseTarget(f);
      if (t) this.performBasic(f, t, ev);
    } else {
      this.performOd(f, t, ev);
    }

    this.decayMods(f);
    if (f.shield) {
      f.shield.turns--;
      if (f.shield.turns <= 0) f.shield = null;
    }
  }

  /**
   * 「掌握する空」: 味方の攻撃が奇数回目になるたび、味方全体の ATK が上がる。
   * 3段（+15%）で止まる。本体が落ちれば、積んだ分は全部消える。
   */
  private tickSkygrasp(actor: Fighter, ev: BattleEvent[]): void {
    const holder = this.alive(actor.side).find((a) => a.passive === 'skygrasp');
    if (!holder) return;
    const hits = (holder.stacks.skyhits ?? 0) + 1;
    holder.stacks.skyhits = hits;
    if (hits % 2 === 0) return;
    const st = holder.stacks.sky ?? 0;
    if (st >= 3) return;
    holder.stacks.sky = st + 1;
    ev.push({ t: 'passive', uid: holder.uid, label: '掌握する空' });
    for (const a of this.alive(actor.side)) {
      this.addMod(a, { kind: 'atk', value: 0.03, turns: 999, source: 'skygrasp' }, ev, 'ATK上昇');
    }
  }

  private performBasic(actor: Fighter, picked: Fighter, ev: BattleEvent[]): void {
    if (picked.side === actor.side) {
      // 回復役の手当て。攻撃ではないので、攻撃に反応する特性は回さない
      this.heal(actor, picked, Math.round(actor.atk * (actor.basicPower / 100) * HEAL_BASIC), ev);
      this.gainOd(actor, 12, ev);
      return;
    }
    const target = this.coverFor(actor, picked, ev);
    const dealt = this.dealDamage(actor, target, this.basicPowerOf(actor), ev);
    this.gainOd(actor, 12, ev);
    this.tickSkygrasp(actor, ev);

    if (dealt > 0) {
      const p = actor.passive;
      this.tickIslandApex(actor, ev);
      if (p === 'embers' && this.rng.chance(0.32)) this.applyBurn(target, ev, actor.uid);
      if (p === 'venomgland' && this.rng.chance(0.45)) this.applyPoison(target, ev, actor.uid);
      if (p === 'shearwind') {
        const st = actor.stacks.shear ?? 0;
        if (st < 3) {
          actor.stacks.shear = st + 1;
          this.addMod(target, { kind: 'def', value: -0.08, turns: 999, source: 'shearwind' }, ev, '削風');
        }
      }
    }
  }

  private performOd(actor: Fighter, picked: Fighter | null, ev: BattleEvent[]): void {
    const mod = 1 + 0.35 * (clamp(actor.od, 100, 150) - 100) / 50;
    const power = odPower(actor) * mod;
    const enemies = this.alive(other(actor.side));
    const allies = this.alive(actor.side);
    const id = actor.odId;

    // 単体技の相手。構えのあいだに倒れていれば、いま届く相手に替える
    const single = (): Fighter | null => {
      const t = picked && picked.alive ? picked : this.chooseTarget(actor);
      return t ? this.coverFor(actor, t, ev) : null;
    };

    switch (id) {
      case 'faultcrush': {
        const t = single(); if (!t) break;
        this.dealDamage(actor, t, power, ev);
        // 地割れで足を取る。しばらくその場から動けない
        if (t.alive && !t.anchored) t.rootedUntil = Math.max(t.rootedUntil, this.clockV + CRUSH_ROOT);
        break;
      }
      case 'flamevolley': {
        const t = single(); if (!t) break;
        const hits = t.statuses.some((s) => s.kind === 'burn') ? 3 : 2;
        for (let i = 0; i < hits && t.alive; i++) this.dealDamage(actor, t, power, ev);
        break;
      }
      case 'vortexfang': {
        const t = single(); if (!t) break;
        this.dealDamage(actor, t, power, ev);
        if (t.alive) this.addMod(t, { kind: 'spd', value: -0.2, turns: 3, source: 'vortexfang' }, ev, 'SPD低下');
        break;
      }
      case 'galerend': {
        for (const e of enemies) this.dealDamage(actor, e, power, ev);
        actor.ready += 0.32;
        break;
      }
      case 'rockaegis': {
        const amount = Math.round(actor.def * 3.0 * (1 + this.modSum(actor, 'def')));
        for (const a of allies) {
          a.shield = { amount, turns: 4 };
          ev.push({ t: 'shield', uid: a.uid, amount });
        }
        break;
      }
      case 'scorchring': {
        for (const e of enemies) {
          this.dealDamage(actor, e, power, ev);
          if (e.alive && this.rng.chance(0.6)) this.applyBurn(e, ev, actor.uid);
        }
        break;
      }
      case 'tideheal': {
        const t = minBy(allies, (a) => a.hp / a.maxHp);
        if (!t) break;
        this.heal(actor, t, Math.round(actor.atk * 2.6 * mod), ev);
        const i = t.mods.findIndex((m) => m.value < 0);
        if (i >= 0) t.mods.splice(i, 1);
        break;
      }
      case 'erosionstorm': {
        for (const e of enemies) {
          this.dealDamage(actor, e, power, ev);
          if (e.alive) this.addMod(e, { kind: 'def', value: -0.25, turns: 4, source: 'erosionstorm' }, ev, 'DEF低下');
        }
        break;
      }
      case 'obsidiancut': {
        const t = single(); if (!t) break;
        const p = t.hp / t.maxHp < 0.5 ? power * (230 / 175) : power;
        this.dealDamage(actor, t, p, ev);
        break;
      }
      case 'resonantlight': {
        for (const a of allies) {
          this.addMod(a, { kind: 'atk', value: 0.18, turns: 4, source: 'resonantlight' }, ev, 'ATK上昇');
          this.gainOd(a, 15, ev);
        }
        break;
      }
      case 'faulthaul': {
        // 奥にいる相手を、自分の目の前まで引きずり出す
        const t = picked && picked.alive ? picked : this.haulTarget(actor);
        if (!t) break;
        this.dealDamage(actor, t, power, ev);
        // 巨体は引きずれない。当てるだけで終わる
        if (t.alive && !t.anchored) {
          const dx = t.x - actor.x;
          const dz = t.z - actor.z;
          const d = Math.max(1e-4, Math.hypot(dx, dz));
          t.x = clamp(actor.x + (dx / d) * 1.3, -ARENA_X, ARENA_X);
          t.z = clamp(actor.z + (dz / d) * 1.3, -ARENA_Z, ARENA_Z);
          t.rootedUntil = Math.max(t.rootedUntil, this.clockV + PULL_HOLD);
          ev.push({ t: 'pull', uid: t.uid, by: actor.uid });
        }
        break;
      }
      case 'forkjaw': {
        const t = single(); if (!t) break;
        // 2体目は別の個体。居なければ1体で終わる
        const rest = enemies.filter((e) => e !== t);
        const second = rest.length > 0 ? rest[Math.floor(this.rng.next() * rest.length)] : null;
        this.dealDamage(actor, t, power, ev);
        if (second) this.dealDamage(actor, second, power, ev);
        break;
      }
      case 'gazepierce': {
        const t = single(); if (!t) break;
        this.dealDamage(actor, t, power, ev, false, 'crit');
        break;
      }
      case 'hornrout': {
        for (const e of enemies) this.dealDamage(actor, e, power, ev);
        for (const e of this.alive(other(actor.side))) {
          e.od = Math.max(0, e.od - 28);
          ev.push({ t: 'od', uid: e.uid, value: e.od });
        }
        for (const a of allies) {
          this.addMod(a, { kind: 'def', value: 0.18, turns: 4, source: 'hornrout' }, ev, 'DEF上昇');
        }
        break;
      }
      case 'crimsoncharge': {
        const t = single(); if (!t) break;
        this.dealDamage(actor, t, power, ev);
        // 倒しきれたら、そのまま最寄りの次へ。連鎖は1回まで
        if (!t.alive) {
          const rest = this.alive(other(actor.side));
          if (rest.length > 0) {
            const next = minBy(rest, (e) => dist(t, e));
            ev.push({ t: 'passive', uid: actor.uid, label: '赤角突撃' });
            this.dealDamage(actor, next, power, ev);
          }
        }
        break;
      }
      case 'harvest': {
        const t = single(); if (!t) break;
        const dealt = this.dealDamage(actor, t, power, ev);
        if (dealt > 0 && actor.alive) this.heal(actor, actor, Math.round(dealt * 0.28), ev);
        break;
      }
      case 'serpentvenom': {
        const t = single(); if (!t) break;
        for (let i = 0; i < 2 && t.alive; i++) {
          this.dealDamage(actor, t, power, ev);
          if (t.alive) this.applyPoison(t, ev, actor.uid);
        }
        actor.ready += 0.3;
        break;
      }
      case 'tyrantrequiem': {
        const t = single(); if (!t) break;
        this.dealDamage(actor, t, power, ev);
        // 噛み跡は残る。倒しきれなくても、次の2行動は味方全員の攻撃が通る
        if (t.alive) {
          this.addMod(t, { kind: 'taken', value: 0.2, turns: 2, source: 'tyrantrequiem' }, ev, '被ダメ上昇');
        }
        break;
      }
      case 'crushbite': {
        const t = single(); if (!t) break;
        this.dealDamage(actor, t, power, ev, true);
        break;
      }
      case 'abyssalmaw': {
        for (const e of enemies) this.dealDamage(actor, e, power, ev, true);
        break;
      }
      case 'galemaw': {
        const t = single(); if (!t) break;
        this.dealDamage(actor, t, power, ev);
        actor.ready += 0.22;
        break;
      }
      case 'stratarecord': {
        for (const a of allies) {
          this.gainOd(a, 25, ev);
          this.addMod(a, { kind: 'dealt', value: 0.20, turns: 4, source: 'stratarecord' }, ev, '与ダメ上昇');
        }
        break;
      }
      case 'skyreign': {
        const until = this.clockV + SKYREIGN_DURATION;
        for (const a of allies) {
          this.addMod(a, { kind: 'spd', value: 0.30, until, turns: 0, source: 'skyreign' }, ev, 'SPD上昇');
          this.addMod(a, { kind: 'def', value: 0.20, until, turns: 0, source: 'skyreign' }, ev, 'DEF上昇');
        }
        break;
      }
      case 'spikebore': {
        const t = single(); if (!t) break;
        this.dealDamage(actor, t, power, ev);
        if (t.alive) this.addMod(t, { kind: 'atk', value: -0.22, turns: 4, source: 'spikebore' }, ev, 'ATK低下');
        break;
      }
      case 'leapstrike': {
        const t = single(); if (!t) break;
        // 跳んで相手の真上に降りる。着地した場所から次の殴り合いが始まる
        const dx = actor.x - t.x;
        const dz = actor.z - t.z;
        const d = Math.max(1e-4, Math.hypot(dx, dz));
        const land = 1.1 + (t.radius - R0);
        actor.x = clamp(t.x + (dx / d) * land, -ARENA_X, ARENA_X);
        actor.z = clamp(t.z + (dz / d) * land, -ARENA_Z, ARENA_Z);
        ev.push({ t: 'leap', uid: actor.uid, to: t.uid });
        this.dealDamage(actor, t, power, ev);
        if (t.alive) this.addMod(t, { kind: 'taken', value: 0.25, turns: 3, source: 'leapstrike' }, ev, '被ダメ上昇');
        break;
      }
      case 'hatzegwing': {
        let landed = 0;
        for (const e of enemies) landed += this.dealDamage(actor, e, power, ev);
        for (const a of allies) {
          this.addMod(a, { kind: 'spd', value: 0.10, turns: 4, source: 'hatzegwing' }, ev, 'SPD上昇');
        }
        if (landed > 0) this.tickIslandApex(actor, ev);
        break;
      }
      case 'grindfeed': {
        // 総量は自分の最大体力の 1/5。半分をすぐ渡し、残りを5秒かけて配る
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
    // 「記録の帆」: 誰かが特殊攻撃を撃つたび、撃った本人の一撃が重くなる
    for (const a of this.alive(actor.side)) {
      if (a.passive !== 'archivesail') continue;
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
  }

  /**
   * 身代わり。守護役は、近くの味方に向いた攻撃を肩代わりしに入る。
   *
   * 盾（岩盾展開）は量を肩代わりするが、これは相手を差し替える。
   * 「板の放熱」を持つ守護役は、より遠くから、より高い確率で割り込む。
   * 乱数は条件を満たすときだけ引く——引く回数が分岐で変わると
   * 同じシードで同じ戦闘にならなくなるため、判定の順序は固定する。
   */
  private coverFor(actor: Fighter, target: Fighter, ev: BattleEvent[]): Fighter {
    if (isWall(target.role)) return target;
    let best: Fighter | null = null;
    let bestD = Infinity;
    for (const g of this.fighters) {
      if (!g.alive || g.side !== target.side || g === target || g.role !== 'Guardian') continue;
      if (g.cast || this.clockV < g.rootedUntil) continue;
      const reach = g.passive === 'platescreen' ? 3.0 : 2.2;
      const d = dist(g, target);
      if (d <= reach && d < bestD) { best = g; bestD = d; }
    }
    if (!best) return target;
    const p = best.passive === 'platescreen' ? 0.45 : 0.3;
    if (!this.rng.chance(p)) return target;
    // 身代わりに入った本人を、打たれた味方と攻め手のあいだへ滑り込ませる
    best.x = clamp(target.x + (actor.x - target.x) * 0.35, -ARENA_X, ARENA_X);
    best.z = clamp(target.z + (actor.z - target.z) * 0.35, -ARENA_Z, ARENA_Z);
    ev.push({ t: 'passive', uid: best.uid, label: '身代わり' });
    return best;
  }

  // ------------------------------------------------------------ 計算

  /**
   * 通常攻撃の実効威力。射撃役（搦め手・妨害）は踏み込まずに撃てるぶん軽くする。
   */
  private basicPowerOf(f: Fighter): number {
    let p = f.passive === 'greatbeak' ? f.basicPower * 1.22 : f.basicPower;
    // 支援役（回復・支援）は割り引かない。後ろに下がるのは役目で、得ではない
    if (f.role === 'Technical' || f.role === 'Debuffer') p *= RANGED_BASIC;
    return p;
  }

  private computeDamage(
    atk: Fighter, def: Fighter, power: number, roll: boolean, force?: 'crit',
  ): { amount: number; crit: boolean; eff: 1.5 | 1 | 0.7 } {
    const atkStat = atk.atk * clamp(1 + this.modSum(atk, 'atk'), 0.3, 3);
    const defStat = def.def * clamp(1 + this.modSum(def, 'def'), 0.3, 3);
    // 除算形の防御。減算形だと DEF を伸ばした瞬間ダメージ0になり戦闘が終わらなくなる
    const dr = 150 / (150 + defStat);
    let base = 4.15 * (power / 100) * atkStat * dr;

    let eff: 1.5 | 1 | 0.7 = elementFactor(atk.element, def.element);
    /*
     * 相性表を書き換える2つの特性。
     * 「歴戦の暴君」は与も被も常に 1.5。「不変」と噛み合ったときは不変が勝つ——
     * 暴君に素で刺さる札を1つ残す。
     */
    if (atk.passive === 'warlord' || def.passive === 'warlord') eff = 1.5;
    if (atk.passive === 'immutable' || def.passive === 'immutable') eff = 1;

    let buff = (1 + this.modSum(atk, 'dealt')) * (1 + this.modSum(def, 'taken'));
    // 場の効果。その属性の攻撃が、敵味方の別なく通りやすくなる
    buff *= this.rules.elementDealt?.[atk.element] ?? 1;

    const pa = atk.passive;
    // 役職の噛み合わせ。崩し役は壁を割り、特攻役は後衛を刈る
    if (atk.role === 'Breaker' && isWall(def.role)) buff *= BREAKER_VS_WALL;
    if (atk.role === 'Sprinter' && isBackliner(def.role)) buff *= RAIDER_VS_BACK;

    if (pa === 'deeppressure' && def.spd >= atk.spd + 20) buff *= 1.14;
    // 「初手の牙」: まだ一度も噛んでいない相手に強い
    if (pa === 'firstbite' && !atk.stacks[`bit${def.uid}`]) buff *= 1.20;
    // 「駆ける角」: 速度差そのものが威力になる
    if (pa === 'runningcharge' && atk.spd > def.spd) {
      buff *= 1 + Math.min(0.26, (atk.spd - def.spd) * 0.0035);
    }
    // 「鎌爪」: 硬い相手ほど深く入る
    if (pa === 'scytheclaw') buff *= 1 + Math.min(0.24, Math.max(0, defStat - 90) * 0.0020);
    // 「断層牽引」: 前線に出ていない相手に強い
    if (pa === 'traction' && !this.engaged(def)) buff *= 1.34;
    if (pa === 'overheat') buff *= 1 + 0.25 * (1 - atk.hp / atk.maxHp);
    // 「旧き暴君」: まだ削れていない相手を先に潰す
    if (pa === 'oldtyrant' && def.hp / def.maxHp > atk.hp / atk.maxHp) buff *= 1.16;
    // 「地盤沈下」: 前線で受け止めている間は硬い
    if (def.passive === 'subsidence' && this.engaged(def)) buff *= 0.85;

    buff = clamp(buff, 0.4, 2.5);

    let critRate = clamp(0.05 + (atk.spd - def.spd) * 0.0015, 0.02, 0.35);
    // 「巨眼」: 見えている相手の継ぎ目を突く
    if (pa === 'greateye') critRate = clamp(critRate + 0.12, 0.02, 0.4);
    const crit = force === 'crit' ? true : roll ? this.rng.chance(critRate) : false;
    const rnd = roll ? this.rng.range(0.92, 1.08) : 1;

    base *= eff * buff * (crit ? 1.8 : 1) * rnd;
    return { amount: Math.max(1, Math.round(base)), crit, eff };
  }

  private dealDamage(
    atk: Fighter, target: Fighter, power: number, ev: BattleEvent[],
    pierceShield = false, force?: 'crit',
  ): number {
    if (!target.alive || !atk.alive) return 0;
    const pAtk = atk.passive;
    // 「鎌爪」は常にシールドを無視する
    if (pAtk === 'scytheclaw') pierceShield = true;
    const { amount, crit, eff } = this.computeDamage(atk, target, power, true, force);

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

    if (remaining > 0 || amount > 0) {
      if (pAtk === 'firstbite') atk.stacks[`bit${target.uid}`] = 1;
      if (pAtk === 'greateye' && crit) {
        ev.push({ t: 'passive', uid: atk.uid, label: '巨眼' });
        for (const a of this.alive(atk.side)) this.gainOd(a, 8, ev);
      }
      if (pAtk === 'twinhorn' && target.alive && !target.mods.some((m) => m.source === 'twinhorn')) {
        this.addMod(target, { kind: 'atk', value: -0.12, turns: 3, source: 'twinhorn' }, ev, 'ATK低下');
      }
    }

    // 「熱反射」
    if (target.passive === 'heatreflect' && remaining > 0 && atk.alive && atk !== target) {
      const back = Math.max(1, Math.round(remaining * 0.2));
      atk.hp = Math.max(0, atk.hp - back);
      ev.push({ t: 'passive', uid: target.uid, label: '熱反射' });
      ev.push({ t: 'damage', uid: atk.uid, from: target.uid, amount: back, crit: false, eff: 1, hp: atk.hp, shielded: 0 });
      if (atk.hp === 0) this.kill(atk, target, ev);
    }

    if (target.hp === 0) this.kill(target, atk, ev);
    return remaining;
  }

  /** 「島の頂点」: 初めて攻撃を通した1回だけ、以後ずっと攻撃が上がる */
  private tickIslandApex(actor: Fighter, ev: BattleEvent[]): void {
    if (actor.passive !== 'islandapex') return;
    if (actor.stacks.apex) return;
    actor.stacks.apex = 1;
    this.addMod(actor, { kind: 'atk', value: 0.20, turns: 999, source: 'islandapex' }, ev, '島の頂点');
  }

  private heal(src: Fighter, target: Fighter, amount: number, ev: BattleEvent[]): void {
    if (!target.alive) return;
    // 「大地の伊吹」: 味方が受け取る回復を底上げする。誰が撃った回復でも効く
    const boost = this.alive(target.side).some((a) => a.passive === 'earthbreath') ? 1.15 : 1;
    const before = target.hp;
    target.hp = Math.min(target.maxHp, target.hp + Math.round(amount * boost));
    src.healed += target.hp - before;
    ev.push({ t: 'heal', uid: target.uid, from: src.uid, amount: target.hp - before, hp: target.hp });
  }

  private kill(target: Fighter, by: Fighter, ev: BattleEvent[]): void {
    if (!target.alive) return;
    target.alive = false;
    target.hp = 0;
    target.cast = null;
    if (by !== target) by.kills++;
    ev.push({ t: 'ko', uid: target.uid, by: by.uid });

    // 「追い波」: 仕留めた側が、その勢いのまま次の行動に入る
    if (by !== target && by.alive && by.passive === 'pursuit') {
      by.ready += 0.38;
      ev.push({ t: 'passive', uid: by.uid, label: '追い波' });
    }
    // 「地盤沈下」: 倒れると味方の OD を押し上げる
    if (target.passive === 'subsidence') {
      ev.push({ t: 'passive', uid: target.uid, label: '地盤沈下' });
      for (const a of this.alive(target.side)) this.gainOd(a, 40, ev);
    }
    // 「掌握する空」: 空を握っていた本体が落ちれば、積み上げた分は残らない
    if (target.passive === 'skygrasp') {
      for (const a of this.fighters) {
        if (a.side !== target.side) continue;
        a.mods = a.mods.filter((m) => m.source !== 'skygrasp');
      }
      ev.push({ t: 'passive', uid: target.uid, label: '掌握する空' });
    }
    // 「潮汐」: 味方が倒れると生存者を癒す
    for (const a of this.alive(target.side)) {
      if (a.passive === 'tide') {
        ev.push({ t: 'passive', uid: a.uid, label: '潮汐' });
        for (const b of this.alive(target.side)) this.heal(a, b, Math.round(a.atk * 1.2), ev);
        break;
      }
    }
    // 味方全体の OD（撃破された側）
    for (const a of this.alive(target.side)) this.gainOd(a, 25, ev);
  }

  private gainOd(f: Fighter, amount: number, ev: BattleEvent[]): void {
    if (!f.alive) return;
    // 前線で殴り合っている者ほど早く溜まる
    let mul = (this.engaged(f) ? 1.2 : 1) * (this.rules.tempo ?? 1);
    // 「制海」: 海の主が生きている間、向かいの側は必殺技が溜まりにくい
    if (this.alive(other(f.side)).some((e) => e.passive === 'deepreign')) mul *= 0.88;
    // 「大喙」: 通常攻撃が重いぶん、必殺技の出番が遅い
    if (f.passive === 'greatbeak') mul *= 0.8;
    // 「掌握する空」: 空を握りきっている間、味方の必殺技が早く回る
    if (this.alive(f.side).some((a) => a.passive === 'skygrasp' && (a.stacks.sky ?? 0) >= 3)) {
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

  /** 秒で切れたバフと再生を全員から掃除する */
  private sweepTimedMods(): void {
    for (const f of this.fighters) {
      if (f.statuses.some((s) => s.until !== undefined && this.clockV >= s.until)) {
        f.statuses = f.statuses.filter((s) => s.until === undefined || this.clockV < s.until);
      }
      if (f.mods.some((m) => m.until !== undefined && this.clockV >= m.until)) {
        f.mods = f.mods.filter((m) => m.until === undefined || this.clockV < m.until);
      }
    }
  }

  /**
   * 毒。火傷と違って重なる。1つで 1刻みあたり最大体力の 3%、3つまで。
   * 攻撃力に一切依存しないので、硬い相手ほど殴るより効く。
   */
  private applyPoison(target: Fighter, ev: BattleEvent[], source: string): void {
    const existing = target.statuses.find((s) => s.kind === 'poison');
    if (existing) {
      existing.value = Math.min(POISON_MAX_STACK * POISON_PER_STACK, existing.value + POISON_PER_STACK);
      existing.turns = POISON_TURNS;
    } else {
      target.statuses.push({ kind: 'poison', turns: POISON_TURNS, value: POISON_PER_STACK, source });
    }
    ev.push({ t: 'status', uid: target.uid, kind: 'poison', applied: true });
  }

  private applyBurn(target: Fighter, ev: BattleEvent[], source: string): void {
    const existing = target.statuses.find((s) => s.kind === 'burn');
    if (existing) existing.turns = Math.max(existing.turns, 3);
    else target.statuses.push({ kind: 'burn', turns: 3, value: 0.04, source });
    ev.push({ t: 'status', uid: target.uid, kind: 'burn', applied: true });
  }

  /**
   * 時間で刻むもの。火傷・毒は STATUS_TICK 秒ごと、再生は 1 秒ごと。
   * 行動に紐づけると、届かずに歩いている間は毒が効かなくなる。
   */
  private tickTimers(f: Fighter, ev: BattleEvent[]): void {
    const now = this.clockV;
    if (now >= (this.regenAt.get(f.uid) ?? Infinity)) {
      this.regenAt.set(f.uid, now + REGEN_TICK);
      for (const s of f.statuses) {
        if (s.kind !== 'regen') continue;
        const left = s.pool ?? 0;
        if (left <= 0) { s.turns = 0; continue; }
        const amount = Math.min(s.value, left);
        s.pool = left - amount;
        const src = this.fighters.find((x) => s.source.startsWith(x.uid + '|')) ?? f;
        this.heal(src, f, amount, ev);
        if ((s.pool ?? 0) <= 0) s.turns = 0;
      }
      f.statuses = f.statuses.filter((s) => s.kind !== 'regen' || s.turns > 0);
    }
    if (now >= (this.statusAt.get(f.uid) ?? Infinity)) {
      this.statusAt.set(f.uid, now + STATUS_TICK);
      for (const s of f.statuses) {
        if (s.kind !== 'burn' && s.kind !== 'poison') continue;
        const dmg = Math.max(1, Math.round(f.maxHp * s.value));
        f.hp = Math.max(0, f.hp - dmg);
        ev.push({ t: 'statusTick', uid: f.uid, kind: s.kind, amount: dmg, hp: f.hp });
        if (f.hp === 0) {
          const src = this.byUid.get(s.source) ?? f;
          this.kill(f, src, ev);
          return;
        }
        s.turns--;
      }
      f.statuses = f.statuses.filter((s) => s.kind === 'regen' || s.turns > 0);
    }
  }

  private teamHpRatio(side: Side): number {
    const team = this.fighters.filter((f) => f.side === side);
    return team.reduce((s, f) => s + f.hp / f.maxHp, 0);
  }

  private checkEnd(ev: BattleEvent[]): boolean {
    if (this.finished) return true;
    const a = this.alive(0).length;
    const b = this.alive(1).length;
    if (a > 0 && b > 0) return false;
    this.winner = a > 0 ? 0 : b > 0 ? 1 : -1;
    this.finished = true;
    ev.push({ t: 'end', winner: this.winner, turns: this.turn });
    return true;
  }
}

function odPower(f: Fighter): number {
  return getRevos(f.defId).od.power;
}

function dist(a: { x: number; z: number }, b: { x: number; z: number }): number {
  return Math.hypot(a.x - b.x, a.z - b.z);
}

/**
 * 体の縁どうしの距離を、標準の体どうしに直したもの。
 * 間合い・接敵・壁の足止めはこれで測る——巨体は中心が遠くても手が届く
 */
function gap(a: Fighter, b: Fighter): number {
  return dist(a, b) - (a.radius + b.radius - 2 * R0);
}

/** 敵陣へ向かう向きで測った前進量。自軍は −z が前 */
function forward(side: Side, z: number): number {
  return side === 0 ? -z : z;
}

/** 最小の評価値を持つ要素。同値は先に並んでいるほう——並びは固定なので結果も固定 */
function minBy<T>(list: T[], score: (x: T) => number): T {
  let best = list[0];
  let bestS = score(best);
  for (let i = 1; i < list.length; i++) {
    const s = score(list[i]);
    if (s < bestS) { best = list[i]; bestS = s; }
  }
  return best;
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
