import * as THREE from 'three';
import { AV_THRESHOLD, BattleSim } from './simulate';
import type { BattleEvent, Side, TeamSetup } from './types';
import type { BattleScene } from '../../scenes/BattleScene';
import { audio } from '../../core/Audio';

/**
 * シミュレータのイベント列を「見せ物」に変換する再生機。
 *
 * 勝敗はすべてシミュレータ側で確定しており、ここは絵と音と間だけを扱う。
 * 倍速は再生速度を上げるのではなく、間（タメと余韻）を詰めることで行う。
 * モーション本体を早回しすると動きが不自然になり、露骨に安っぽく見える。
 */

export type Speed = 1 | 2 | 3;

export interface BattlePlayerEvents {
  onEvent?(e: BattleEvent): void;
  onSlotBegin?(uid: string): void;
  onEnd?(winner: Side | -1): void;
  onOdReady?(uid: string): void;
}

/** 1行動あたりのスロット長。倍速で詰めるのはここだけ */
const SLOT: Record<Speed, number> = { 1: 1.25, 2: 0.62, 3: 0.42 };

export class BattlePlayer {
  readonly sim: BattleSim;
  readonly events: BattlePlayerEvents = {};
  speed: Speed = 1;
  paused = false;
  finished = false;

  private queue: BattleEvent[] = [];
  private wait = 0;
  private currentActor: string | null = null;
  private pendingTarget: string | null = null;
  private maxHp = new Map<string, number>();
  private odFired = false;
  private tmpVec = new THREE.Vector3();

  /*
   * 表示用の AV。
   *
   * シミュレータは1行動ぶんの時間をまとめて進める（step の中で全員の AV に
   * 一気に加算する）ので、その値をそのまま UI に流すと、行動順もクール
   * タイムも「step の瞬間に全員が同時に動く」ことになる。見ている側には
   * 溜まっていく過程がなく、代わりに全部が同時に跳ねる。
   *
   * そこで step の前後を記録しておき、その行動を再生している間に割り付ける。
   * 加算量は SPD に比例するので、割り付ければ速い個体ほど速く溜まる——
   * 本来見えるべき差がそこで初めて出る。
   */
  private avFrom = new Map<string, number>();
  private avTo = new Map<string, number>();
  private avPhase = 1;
  private avSpan = 1;
  /**
   * 撃ち終えた個体。
   *
   * 溜まりきってから撃つ、という順序が見えないと「間隔が終わった直後に
   * もう一度動いた」ように読めてしまう。行動の頭までに満たしきり、
   * 技を出した瞬間に空ける——ここから先は実際の AV をそのまま映す。
   */
  private released: string | null = null;
  /**
   * 直前の行動を終えた時点の AV。リングの 0 をここに置く。
   *
   * 重い OD はしきい値を大きく割り込むので、0 で切ってしまうと
   * 「空のまま何も起きない」時間ができて、ただ固まって見える。
   * 起点をずらせば、同じ 0→1 のあいだを“ゆっくり”進むことで
   * 反動の重さが伝わる。
   */
  private floor = new Map<string, number>();

  constructor(
    seed: number,
    teamA: TeamSetup,
    teamB: TeamSetup,
    private scene: BattleScene,
  ) {
    this.sim = new BattleSim(seed, teamA, teamB);
    for (const f of this.sim.fighters) this.maxHp.set(f.uid, f.maxHp);
  }

  start(): void {
    this.scene.setFighters(this.sim.fighters);
    this.scene.wideShot();
    for (const e of this.sim.startEvents()) this.events.onEvent?.(e);
    this.wait = 0.6;
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

  update(dt: number): void {
    if (this.finished || this.paused) return;

    // 表示用の割り付けは、待ち時間の有無に関わらず進める
    this.avPhase = Math.min(1, this.avPhase + dt / this.avSpan);

    this.wait -= dt;
    if (this.wait > 0) return;

    if (this.queue.length === 0) {
      if (this.sim.isOver) {
        this.finished = true;
        this.events.onEnd?.(this.sim.currentWinner);
        return;
      }
      this.beginStep();
      if (this.queue.length === 0) {
        this.finished = true;
        this.events.onEnd?.(this.sim.currentWinner);
        return;
      }
    }

    const e = this.queue.shift()!;
    this.wait = this.present(e);
    this.events.onEvent?.(e);
  }

  /** 1行動ぶん進め、その間に配る AV の始点と終点を控える */
  private beginStep(): void {
    this.avFrom = new Map(this.sim.fighters.map((f) => [f.uid, f.av]));
    this.queue = this.sim.step();

    const begin = this.queue.find((e) => e.t === 'turnBegin');
    const actor = begin && begin.t === 'turnBegin' ? begin.uid : null;
    this.avTo = new Map(this.sim.fighters.map((f) => [
      f.uid,
      // 行動した本人は、この行動の再生中は「満ちている」ままにする。
      // OD の反動でどれだけ戻されたかは、次の行動の始点として現れる
      f.uid === actor ? AV_THRESHOLD : f.av,
    ]));
    this.avPhase = 0;
    // 行動の頭（turnBegin の間）で満ちきらせる。技が出るころには満杯で、
    // 「溜まった → 撃った → 空いた」の順に見える
    this.avSpan = Math.max(0.06, (SLOT[this.speed] / 1.25) * 0.16);
    this.released = null;
  }

  /** 溜めを使い切った瞬間を記録する */
  private release(uid: string): void {
    if (this.released === uid) return;
    this.released = uid;
    this.floor.set(uid, this.sim.fighters.find((f) => f.uid === uid)?.av ?? 0);
  }

  /** 表示用の AV。再生の進みに合わせて補間した値 */
  displayAv(uid: string): number {
    // 撃ったあとは補間をやめ、実際に空になった値へ落とす
    if (uid === this.released) {
      return this.sim.fighters.find((f) => f.uid === uid)?.av ?? 0;
    }
    const a = this.avFrom.get(uid);
    const b = this.avTo.get(uid);
    if (a === undefined || b === undefined) {
      return this.sim.fighters.find((f) => f.uid === uid)?.av ?? 0;
    }
    return a + (b - a) * this.avPhase;
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
        // 満ちきった状態を一拍見せてから技に入る
        return 0.22 * beat;
      }

      case 'action': {
        // 技を出した＝溜めを使い切った
        this.release(e.uid);
        this.pendingTarget = e.targets[0] ?? null;
        if (this.pendingTarget) this.scene.focus(e.uid, this.pendingTarget);
        if (e.kind === 'od') {
          this.scene.play(e.uid, 'roar');
          this.scene.addShake(0.3);
          audio.odFire();
          // カットインぶんの 0.4 秒は倍速でも半分までしか詰めない。
          // ここを削ると必殺技が「ただの強い通常攻撃」に見える
          return 0.4 * Math.max(0.5, beat) + 0.24 * beat;
        }
        this.scene.lunge(e.uid, this.pendingTarget ?? e.uid);
        return 0.42 * Math.max(0.62, beat);
      }

      case 'damage': {
        const maxHp = this.maxHp.get(e.uid) ?? 1000;
        this.scene.hit(e.uid, e.amount, e.crit, e.eff, maxHp);
        audio.hit(Math.min(1, e.amount / (maxHp * 0.35)), e.crit);
        return 0.2 * Math.max(0.55, beat);
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

      case 'ko': {
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
        return 0.14 * beat;
      }

      case 'turnEnd':
        // 技が出ないまま終わる行動（対象なしなど）の保険
        this.release(e.uid);
        this.currentActor = null;
        return 0.08 * beat;

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
