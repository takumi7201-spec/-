import * as THREE from 'three';
import { BattleSim, DT } from './simulate';
import type { BattleEvent, BattleRules, Side, TeamSetup } from './types';
import type { BattleScene } from '../../scenes/BattleScene';
import { audio } from '../../core/Audio';

/**
 * シミュレータを実時間で回し、起きたことを「見せ物」に変換する再生機。
 *
 * 勝敗・位置・行動はすべてシミュレータが決める。ここは時計を進めて、
 * 出てきたイベントに絵と音を付けるだけ。シミュレータは固定の刻み（DT）で
 * しか進まないので、倍速やヒットストップで実時間の流れが変わっても、
 * 戦闘の中身は1ミリも変わらない。
 */

export type Speed = 1 | 2 | 3;

export interface BattlePlayerEvents {
  onEvent?(e: BattleEvent): void;
  onEnd?(winner: Side | -1): void;
  onOdReady?(uid: string): void;
}

/** 倍速のときに時計を何倍で回すか */
const RATE: Record<Speed, number> = { 1: 1, 2: 2, 3: 3 };
/**
 * 1フレームに回してよい刻みの上限。タブが裏に回って戻った直後などに
 * 溜まった時間を一気に消化すると、数十手ぶんの演出が1フレームに重なる
 */
const MAX_STEPS_PER_FRAME = 12;
/** 開戦の合図から両陣が動き出すまでの間（秒） */
const INTRO = 0.9;

export class BattlePlayer {
  readonly sim: BattleSim;
  readonly events: BattlePlayerEvents = {};
  speed: Speed = 1;
  paused = false;
  finished = false;

  /** まだ刻みに変えていない戦闘内時間 */
  private acc = 0;
  private intro = 0;
  private maxHp = new Map<string, number>();
  private sideOf = new Map<string, 0 | 1>();
  private odFired = false;
  private tmpVec = new THREE.Vector3();

  /**
   * この1戦でプレイヤー側が出した記録。
   * 「最大の一撃」は1発ずつ見ないと取れないので、イベントを通すここで数える。
   */
  readonly tally = { damage: 0, bestHit: 0, kos: 0, odFired: 0 };

  constructor(
    seed: number,
    teamA: TeamSetup,
    teamB: TeamSetup,
    private scene: BattleScene,
    rules: BattleRules = {},
  ) {
    this.sim = new BattleSim(seed, teamA, teamB, rules);
    for (const f of this.sim.fighters) {
      this.maxHp.set(f.uid, f.maxHp);
      this.sideOf.set(f.uid, f.side);
    }
  }

  start(): void {
    this.scene.setFighters(this.sim.fighters);
    for (const e of this.sim.startEvents()) this.events.onEvent?.(e);
    this.intro = INTRO;
  }

  /** プレイヤーが OD を手動で撃つ。間合いに入った最初の刻みで出る */
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
    if (this.finished || this.paused) {
      this.scene.syncFighters(this.sim.fighters, 1);
      return;
    }
    if (this.intro > 0) {
      this.intro -= dt;
      this.scene.syncFighters(this.sim.fighters, 1);
      return;
    }

    // ヒットストップ・スローは戦闘の時計ごと止める。絵だけ止めると、
    // 止まっている間にも位置が進んで、再開した瞬間に滑って見える
    this.acc += dt * RATE[this.speed] * this.scene.timeScale();
    let n = 0;
    while (this.acc >= DT && n++ < MAX_STEPS_PER_FRAME) {
      this.acc -= DT;
      for (const e of this.sim.step()) {
        this.present(e);
        this.events.onEvent?.(e);
        if (this.finished) return;
      }
      if (this.sim.isOver && !this.finished) { this.finish(this.sim.currentWinner); return; }
    }
    // 追いつけなかったぶんは捨てる。溜め込むと次のフレームでまた詰まる
    if (this.acc > DT) this.acc = DT;
    this.scene.syncFighters(this.sim.fighters, this.acc / DT);
  }

  private finish(winner: Side | -1): void {
    if (this.finished) return;
    this.finished = true;
    if (winner === 0) audio.victory();
    else audio.defeat();
    this.scene.wideShot();
    this.events.onEnd?.(winner);
  }

  /** 攻撃間隔の充填率 0..1 */
  displayCharge(uid: string): number {
    const f = this.sim.fighters.find((x) => x.uid === uid);
    return f ? this.sim.charge(f) : 0;
  }

  /** 1イベントに絵と音を付ける。時間は取らない——時計はシミュレータが持つ */
  private present(e: BattleEvent): void {
    const rate = RATE[this.speed];
    switch (e.t) {
      case 'action': {
        this.scene.attack(e.uid, e.targets[0] ?? null, e.windup / rate, e.ranged && e.kind === 'basic', e.kind === 'od');
        if (e.kind === 'od') {
          if (this.sideOf.get(e.uid) === 0) this.tally.odFired++;
          this.odFired = true;
          this.scene.play(e.uid, 'roar');
          this.scene.addShake(0.3);
          this.scene.spotlight(e.uid, e.targets.length === 1 ? e.targets[0] : undefined, 1.1 / rate);
          audio.odFire();
        }
        break;
      }

      case 'damage': {
        const maxHp = this.maxHp.get(e.uid) ?? 1000;
        // 味方が出したぶんだけ数える。自傷（大噴火）は差し引かない
        if (this.sideOf.get(e.from) === 0 && e.from !== e.uid) {
          this.tally.damage += e.amount;
          if (e.amount > this.tally.bestHit) this.tally.bestHit = e.amount;
        }
        this.scene.hit(e.uid, e.from, e.amount, e.crit, e.eff, maxHp);
        audio.hit(Math.min(1, e.amount / (maxHp * 0.35)), e.crit);
        break;
      }

      case 'heal':
        this.scene.heal(e.uid, e.amount);
        audio.heal();
        break;

      case 'shield':
        this.scene.heal(e.uid, 0);
        break;

      case 'mod': {
        // 得か損かで絵を選ぶ。被ダメージ +25% は「弱くなった」なので向きが逆
        const good = e.kind === 'taken' ? e.value < 0 : e.value > 0;
        this.scene.statChange(e.uid, good);
        break;
      }

      case 'ko': {
        if (this.sideOf.get(e.by) === 0 && this.sideOf.get(e.uid) === 1) this.tally.kos++;
        this.scene.ko(e.uid);
        audio.ko();
        // 最後の1体を倒す瞬間だけスロー。1戦に1回だから効く
        const side = this.sideOf.get(e.uid);
        const left = this.sim.fighters.filter((f) => f.alive && f.side === side).length;
        if (left === 0) this.scene.slowMotion(0.5);
        break;
      }

      case 'pull':
        this.scene.play(e.uid, 'hurt');
        this.scene.addShake(0.2);
        break;

      case 'leap':
        this.scene.leap(e.uid);
        break;

      case 'odReady':
        audio.odReady();
        this.events.onOdReady?.(e.uid);
        break;

      case 'statusTick': {
        const at = this.scene.worldOf(e.uid, this.tmpVec);
        // 火傷は橙、毒は紫。同じ色で出すと、どちらが切れたのか読めない
        const color = e.kind === 'poison' ? '#9d6bd8' : '#ff9c3c';
        if (at) this.scene.numbers.spawn(at.clone(), `${e.amount}`, { color, scale: 0.8 });
        break;
      }

      case 'end':
        this.finish(e.winner);
        break;

      default:
        break;
    }
  }

  get didFireOd(): boolean { return this.odFired; }

  /** 結果画面用。シミュレータ側の確定値を返す */
  result() { return this.sim.result(); }
}
