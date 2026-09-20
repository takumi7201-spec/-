import * as THREE from 'three';
import { AV_THRESHOLD, BattleSim } from './simulate';
import type { BattleEvent, Side, TeamSetup } from './types';
import type { BattleScene } from '../../scenes/BattleScene';
import { audio } from '../../core/Audio';

/**
 * シミュレータのイベント列を「見せ物」に変換する再生機。
 *
 * 勝敗はすべてシミュレータ側で確定しており、ここは絵と音と間だけを扱う。
 *
 * 再生はターン送りではなく、1本の時計で回す。シミュレータは行動と行動の
 * あいだに流れた時間（AV の単位）を持っているので、それをそのまま実時間へ
 * 割り付ける。結果として、
 *   - 誰も動かない区間では全員が同時に溜め続ける
 *   - 溜まり方が近い個体どうしは、ほぼ同時に動く
 * という、片方が動いているあいだ相手が止まっている状態が無くなる。
 *
 * 状態（HP・撃破・バフ）の適用順はイベント列のとおりに保つ。順番を崩すと
 * HP が前後して見える。重なって見えるのは動きのほうで、攻撃モーションや
 * のけぞりは発火したら勝手に走る（再生機は待たない）。
 *
 * 倍速は時計を速く回す。モーション本体も同じ比率で詰める——早回しだけだと
 * 動きが不自然になり、露骨に安っぽく見える。
 */

export type Speed = 1 | 2 | 3;

export interface BattlePlayerEvents {
  onEvent?(e: BattleEvent): void;
  onSlotBegin?(uid: string): void;
  onEnd?(winner: Side | -1): void;
  onOdReady?(uid: string): void;
}

/** モーションの基準長。倍速ではここも同じ比率で詰める */
const SLOT: Record<Speed, number> = { 1: 1.25, 2: 0.62, 3: 0.42 };

/**
 * AV 1 単位を何秒で流すか（×1）。
 * SPD 110 の個体が 10000 溜めるのに約 5 秒——6体なら 0.8 秒に1回、
 * 誰かが動く勘定になる。
 */
const SEC_PER_AV = 0.055;
/** 倍速のときに時計を何倍で回すか */
const RATE: Record<Speed, number> = { 1: 1, 2: 2.2, 3: 3.4 };

export class BattlePlayer {
  readonly sim: BattleSim;
  readonly events: BattlePlayerEvents = {};
  speed: Speed = 1;
  paused = false;
  finished = false;

  private queue: BattleEvent[] = [];
  /** 戦闘の時計。シミュレータの clock と同じ単位で進む */
  private clock = 0;
  /** 次のイベントを出してよい時刻 */
  private cursor = 0;
  /** 開幕の間（秒） */
  private intro = 0;
  private currentActor: string | null = null;
  private pendingTarget: string | null = null;
  private maxHp = new Map<string, number>();
  private odFired = false;
  private tmpVec = new THREE.Vector3();

  /**
   * この1戦でプレイヤー側が出した記録。
   *
   * シミュレータの result() は各個体の累計を持っているが、「最大の一撃」は
   * 1発ずつのダメージを見ないと取れない。イベント列はここを必ず通るので、
   * 数えるならここ。演出には使わないので、シミュレータ側は汚さない。
   */
  readonly tally = { damage: 0, bestHit: 0, kos: 0, odFired: 0 };
  private sideOf = new Map<string, 0 | 1>();

  /*
   * 攻撃間隔の表示。
   *
   * 時計で回すようになったので、補間ではなく素の式で出せる。
   * ある step の直後を起点に、AV は実効 SPD で線形に増える——
   * シミュレータの計算そのもの。リングが満ちる瞬間＝その個体が動く瞬間に
   * ぴったり一致する。
   */
  private baseAv = new Map<string, number>();
  private baseClock = 0;
  /** 撃ち終えた個体。ここから先は実際に空いた値を映す */
  private released: string | null = null;
  /** 直前の行動を終えた時点の AV。リングの 0 をここに置く */
  private floor = new Map<string, number>();

  constructor(
    seed: number,
    teamA: TeamSetup,
    teamB: TeamSetup,
    private scene: BattleScene,
  ) {
    this.sim = new BattleSim(seed, teamA, teamB);
    for (const f of this.sim.fighters) {
      this.maxHp.set(f.uid, f.maxHp);
      this.sideOf.set(f.uid, f.side);
    }
  }

  start(): void {
    this.scene.setFighters(this.sim.fighters);
    this.scene.wideShot();
    for (const e of this.sim.startEvents()) this.events.onEvent?.(e);
    this.intro = 0.6;
    this.snapshotAv(null);
  }

  /** プレイヤーが OD を手動で撃つ。AI に任せるより最大 ×1.35 まで伸ばせる */
  fireOd(uid: string): void {
    this.sim.fireOd(uid);
    this.odFired = true;
    audio.odFire();
  }

  holdOd(uid: string, hold: boolean): void {
    this.sim.setOdHold(uid, hold);
  }

  /** 溜め中の OD があるか。UI のボタン状態に使う */
  get odCandidates(): { uid: string; od: number }[] {
    return this.sim.fighters
      .filter((f) => f.alive && f.side === 0 && f.od >= 100)
      .map((f) => ({ uid: f.uid, od: f.od }));
  }

  /** 秒 → AV 単位。倍速は時計の速さそのもの */
  private avPerSec(): number { return RATE[this.speed] / SEC_PER_AV; }

  update(dt: number): void {
    if (this.finished || this.paused) return;
    if (this.intro > 0) { this.intro -= dt; return; }

    this.clock += dt * this.avPerSec();

    // 出せるイベントは、この1フレームのうちに全部出す。
    // 「1フレーム1イベント」だと、近い時刻に重なった行動が引き伸ばされる
    let guard = 0;
    while (guard++ < 96) {
      if (this.queue.length === 0) {
        if (this.sim.isOver) { this.finish(); return; }
        // まだ誰も動かない区間。ここで全員が同時に溜めている
        if (this.sim.nextActorAt() > this.clock) break;
        this.queue = this.sim.step();
        if (this.queue.length === 0) { this.finish(); return; }
        this.snapshotAv(this.actorOf(this.queue));
        this.cursor = Math.max(this.cursor, this.sim.clock);
      }
      if (this.cursor > this.clock) break;
      const e = this.queue.shift()!;
      this.cursor += this.present(e) * this.avPerSec();
      this.events.onEvent?.(e);
      // 'end' を出した時点で終わり。ここで抜けないと onEnd が二重に飛ぶ
      if (this.finished) return;
    }
  }

  private finish(): void {
    this.finished = true;
    this.events.onEnd?.(this.sim.currentWinner);
  }

  private actorOf(evs: BattleEvent[]): string | null {
    const begin = evs.find((e) => e.t === 'turnBegin');
    return begin && begin.t === 'turnBegin' ? begin.uid : null;
  }

  /**
   * step 直後の AV を控える。行動する本人だけは、技を出すまで満杯のまま
   * 見せる——空けるのは撃った瞬間で、そうしないと「溜まる前に動いた」
   * ように読める。
   */
  private snapshotAv(actor: string | null): void {
    this.baseClock = this.sim.clock;
    this.released = null;
    for (const f of this.sim.fighters) {
      this.baseAv.set(f.uid, f.uid === actor ? AV_THRESHOLD : f.av);
    }
  }

  /** 溜めを使い切った瞬間を記録する */
  private release(uid: string): void {
    if (this.released === uid) return;
    this.released = uid;
    const f = this.sim.fighters.find((x) => x.uid === uid);
    if (!f) return;
    this.floor.set(uid, f.av);
    // いまこの瞬間に f.av を指すよう起点をずらす
    this.baseAv.set(uid, f.av - this.sim.speedOf(f) * (this.clock - this.baseClock));
  }

  /** 表示用の AV。時計の位置から素直に引く */
  displayAv(uid: string): number {
    const f = this.sim.fighters.find((x) => x.uid === uid);
    if (!f) return 0;
    const base = this.baseAv.get(uid);
    if (base === undefined) return f.av;
    const v = base + this.sim.speedOf(f) * (this.clock - this.baseClock);
    return Math.min(AV_THRESHOLD, v);
  }

  /** 攻撃間隔の充填率 0..1 */
  displayCharge(uid: string): number {
    // 追撃で AV が残っている場合は、その残りを縮めない（起点は 0 のまま）
    const floor = Math.min(0, this.floor.get(uid) ?? 0);
    const v = (this.displayAv(uid) - floor) / (AV_THRESHOLD - floor);
    return v < 0 ? 0 : v > 1 ? 1 : v;
  }

  /** 1イベントを演出し、次までの待ち時間を返す */
  private present(e: BattleEvent): number {
    const slot = SLOT[this.speed];
    const beat = slot / 1.25; // 倍速の詰め率

    switch (e.t) {
      case 'turnBegin': {
        this.currentActor = e.uid;
        this.pendingTarget = null;
        this.odFired = false;
        this.scene.focus(e.uid);
        this.events.onSlotBegin?.(e.uid);
        // 満ちきった状態を一拍だけ見せてから技に入る
        return 0.10 * beat;
      }

      case 'action': {
        // 技を出した＝溜めを使い切った
        this.release(e.uid);
        this.pendingTarget = e.targets[0] ?? null;
        if (this.pendingTarget) this.scene.focus(e.uid, this.pendingTarget);
        if (e.kind === 'od') {
          if (this.sideOf.get(e.uid) === 0) this.tally.odFired++;
          this.scene.play(e.uid, 'roar');
          this.scene.addShake(0.3);
          audio.odFire();
          // カットインぶんの 0.4 秒は倍速でも半分までしか詰めない。
          // ここを削ると必殺技が「ただの強い通常攻撃」に見える
          return 0.4 * Math.max(0.5, beat) + 0.24 * beat;
        }
        // 踏み込みに使える時間をそのまま渡す。打点が出る時刻に着いていないと、
        // 届く前に当たって見える。戻りの絵は再生機を待たせない——
        // 待たないぶんが、次の個体の動きと重なる
        const strikeIn = 0.26 * Math.max(0.5, beat);
        this.scene.lunge(e.uid, this.pendingTarget ?? e.uid, strikeIn);
        return strikeIn;
      }

      case 'damage': {
        const maxHp = this.maxHp.get(e.uid) ?? 1000;
        // 味方が出したぶんだけ数える。自傷（大噴火）は差し引かない——
        // 撃った本人のダメージであることに変わりはない
        if (this.sideOf.get(e.from) === 0 && e.from !== e.uid) {
          this.tally.damage += e.amount;
          if (e.amount > this.tally.bestHit) this.tally.bestHit = e.amount;
        }
        this.scene.hit(e.uid, e.amount, e.crit, e.eff, maxHp);
        audio.hit(Math.min(1, e.amount / (maxHp * 0.35)), e.crit);
        return 0.07 * Math.max(0.4, beat);
      }

      case 'heal': {
        this.scene.heal(e.uid, e.amount);
        audio.heal();
        return 0.22 * beat;
      }

      case 'shield': {
        this.scene.heal(e.uid, 0);
        return 0.1 * beat;
      }

      case 'mod': {
        /*
         * ステータスが動いたユニットに粒子を重ねる。
         *
         * 符号だけでは足りない。taken（被ダメージ）は +25% が「弱くなった」
         * を意味するので、そこだけ向きが逆になる。値の正負ではなく
         * 「このユニットにとって得か」で判定して、上下の絵を選ぶ。
         * 敵に付けたデバフは敵の体に出る——受けた側に出すのが筋。
         *
         * 間引きは BuffAura 側でユニット単位に行う。ここで止めると、
         * 同じ行動で別々の味方に乗ったぶんまで落ちる。
         */
        const good = e.kind === 'taken' ? e.value < 0 : e.value > 0;
        this.scene.statChange(e.uid, good);
        // 尺は取らない。強化も弱体も行動の一部で、それ自体が間を持つものではない
        return 0;
      }

      case 'ko': {
        if (this.sideOf.get(e.by) === 0 && this.sideOf.get(e.uid) === 1) this.tally.kos++;
        this.scene.ko(e.uid);
        audio.ko();
        // 最後の1体を倒す瞬間だけスロー。1戦に1回だから効く
        const enemiesLeft = this.sim.fighters.filter(
          (f) => f.alive && f.side === (this.sim.fighters.find((x) => x.uid === e.uid)?.side ?? 0),
        ).length;
        if (enemiesLeft === 0) this.scene.slowMotion(0.4);
        return 0.42 * Math.max(0.6, beat);
      }

      case 'promote': {
        this.scene.setRow(e.uid, e.to);
        return 0.16 * beat;
      }

      case 'odReady': {
        audio.odReady();
        this.events.onOdReady?.(e.uid);
        return 0.04;
      }

      case 'statusTick': {
        const at = this.scene.worldOf(e.uid, this.tmpVec);
        if (at) this.scene.numbers.spawn(at.clone(), `${e.amount}`, { color: '#ff9c3c', scale: 0.8 });
        return 0.10 * beat;
      }

      case 'turnEnd':
        // 技が出ないまま終わる行動（対象なしなど）の保険
        this.release(e.uid);
        this.currentActor = null;
        return 0.04 * beat;

      case 'end':
        this.finished = true;
        if (e.winner === 0) audio.victory();
        else audio.defeat();
        this.scene.wideShot();
        this.events.onEnd?.(e.winner);
        return 1.2;

      default:
        return 0.02;
    }
  }

  get actor(): string | null { return this.currentActor; }
  get didFireOd(): boolean { return this.odFired; }

  /** 結果画面用。シミュレータ側の確定値を返す */
  result() { return this.sim.result(); }
}
