import * as THREE from 'three';
import type { CreatureObject } from './CreatureBuilder';

export type CreatureState = 'idle' | 'walk' | 'attack' | 'hurt' | 'ko' | 'roar' | 'guard';

/**
 * リヴォスの手続きアニメーション。
 *
 * クリップを持たず位相から直接ポーズを作る。12体×N種のモーションを
 * 作る予算はないので、骨格パラメータ（脚の数・翼の有無）から
 * 動きを導出して全種を1つのコードで動かす。
 *
 * オートバトルは「見ていて面白い」ことが全てなので、
 * タメ（anticipation）とツメ（follow-through）を明示的に持たせる。
 */
export class CreatureAnimator {
  private t = 0;
  private stateT = 0;
  private state: CreatureState = 'idle';
  private prevState: CreatureState = 'idle';
  private blend = 1;
  /** 攻撃の進行度 0..1。外から参照してヒットタイミングを取る */
  actionProgress = 0;
  private hitFired = false;
  onHit?: () => void;

  private legs: THREE.Object3D[] = [];
  private tail: THREE.Object3D[] = [];
  private arms: THREE.Object3D[] = [];
  private wings: THREE.Object3D[] = [];
  private head?: THREE.Object3D;
  private neck?: THREE.Object3D;
  private body?: THREE.Object3D;
  private baseY = 0;

  constructor(private obj: CreatureObject) {
    const p = obj.parts;
    this.body = p.get('body');
    this.neck = p.get('neck');
    this.head = p.get('head');
    for (const name of ['legL', 'legR', 'legFL', 'legFR', 'legBL', 'legBR']) {
      const o = p.get(name);
      if (o) this.legs.push(o);
    }
    for (let i = 0; i < 6; i++) {
      const o = p.get(`tail${i}`);
      if (o) this.tail.push(o);
    }
    for (const name of ['armL', 'armR']) {
      const o = p.get(name);
      if (o) this.arms.push(o);
    }
    for (const name of ['wingL', 'wingR']) {
      const o = p.get(name);
      if (o) this.wings.push(o);
    }
    this.baseY = this.body?.position.y ?? 0;
  }

  play(state: CreatureState): void {
    if (state === this.state) return;
    this.prevState = this.state;
    this.state = state;
    this.stateT = 0;
    this.blend = 0;
    this.actionProgress = 0;
    this.hitFired = false;
  }

  get current(): CreatureState { return this.state; }
  get finished(): boolean {
    if (this.state === 'attack') return this.stateT > 0.95;
    if (this.state === 'hurt') return this.stateT > 0.45;
    if (this.state === 'roar') return this.stateT > 1.3;
    return false;
  }

  update(dt: number): void {
    this.t += dt;
    this.stateT += dt;
    this.blend = Math.min(1, this.blend + dt * 8);

    const pose = this.poseFor(this.state, this.stateT);
    if (this.blend < 1) {
      const prev = this.poseFor(this.prevState, this.stateT + 0.3);
      this.apply(lerpPose(prev, pose, this.blend));
    } else {
      this.apply(pose);
    }

    if (this.state === 'attack') {
      this.actionProgress = Math.min(1, this.stateT / 0.95);
      if (!this.hitFired && this.actionProgress > 0.46) {
        this.hitFired = true;
        this.onHit?.();
      }
    }
  }

  private poseFor(state: CreatureState, st: number): Pose {
    const breathe = Math.sin(this.t * 1.9) * 0.5 + 0.5;
    const pose: Pose = {
      bodyRotX: 0, bodyRotY: 0, bodyRotZ: 0, bodyY: 0, bodyZ: 0,
      neckRotX: 0, headRotX: 0, headRotY: 0,
      legPhase: 0, legAmp: 0,
      tailAmp: 0.06, tailPhase: this.t * 1.6,
      armRotX: -0.2, wingRotZ: 0.1, wingRotX: 0,
    };

    switch (state) {
      case 'idle':
        pose.bodyY = breathe * 0.018;
        pose.neckRotX = -0.03 + breathe * 0.05;
        pose.headRotX = 0.04 - breathe * 0.06;
        pose.tailAmp = 0.1;
        pose.wingRotZ = 0.14 + breathe * 0.1;
        break;

      case 'walk':
        pose.legPhase = this.t * 7.5;
        pose.legAmp = 0.7;
        pose.bodyY = Math.abs(Math.sin(this.t * 7.5)) * 0.05;
        pose.bodyRotY = Math.sin(this.t * 7.5) * 0.06;
        pose.bodyRotZ = Math.sin(this.t * 7.5) * 0.045;
        pose.tailAmp = 0.22;
        pose.tailPhase = this.t * 7.5 + 0.6;
        pose.neckRotX = 0.06;
        pose.wingRotX = Math.sin(this.t * 6) * 0.25;
        pose.wingRotZ = 0.3;
        break;

      case 'attack': {
        // 0-0.35 タメ（後ろに引く）/ 0.35-0.55 打撃 / 0.55-1.0 余韻
        const p = Math.min(1, st / 0.95);
        if (p < 0.36) {
          const k = ease(p / 0.36);
          pose.bodyZ = -0.16 * k;
          pose.bodyRotX = -0.2 * k;
          pose.neckRotX = -0.34 * k;
          pose.headRotX = -0.2 * k;
          pose.armRotX = -0.9 * k;
          pose.wingRotZ = 0.1 + 0.5 * k;
        } else if (p < 0.56) {
          const k = (p - 0.36) / 0.2;
          const s = easeOutBack(k);
          pose.bodyZ = -0.16 + 0.72 * s;
          pose.bodyRotX = -0.2 + 0.52 * s;
          pose.neckRotX = -0.34 + 0.75 * s;
          pose.headRotX = -0.2 + 0.55 * s;
          pose.armRotX = -0.9 + 1.5 * s;
          pose.wingRotZ = 0.6 - 0.5 * s;
        } else {
          const k = ease((p - 0.56) / 0.44);
          pose.bodyZ = 0.56 * (1 - k);
          pose.bodyRotX = 0.32 * (1 - k);
          pose.neckRotX = 0.41 * (1 - k);
          pose.headRotX = 0.35 * (1 - k);
          pose.armRotX = 0.6 * (1 - k) - 0.2 * k;
        }
        pose.legAmp = 0.25;
        pose.legPhase = p * 6;
        pose.tailAmp = 0.35;
        break;
      }

      case 'hurt': {
        const p = Math.min(1, st / 0.45);
        const k = Math.sin(p * Math.PI) * (1 - p * 0.4);
        pose.bodyZ = -0.2 * k;
        pose.bodyRotX = 0.28 * k;
        pose.neckRotX = 0.4 * k;
        pose.headRotX = 0.3 * k;
        pose.bodyRotZ = Math.sin(p * 22) * 0.06 * (1 - p);
        pose.tailAmp = 0.3;
        break;
      }

      case 'ko': {
        const p = Math.min(1, st / 0.7);
        const k = ease(p);
        pose.bodyRotZ = 1.35 * k;
        pose.bodyY = -0.28 * k;
        pose.neckRotX = 0.5 * k;
        pose.headRotX = 0.4 * k;
        pose.legAmp = 0.1 * (1 - k);
        pose.tailAmp = 0.05;
        break;
      }

      case 'roar': {
        const p = Math.min(1, st / 1.3);
        const up = p < 0.3 ? ease(p / 0.3) : p < 0.8 ? 1 : 1 - ease((p - 0.8) / 0.2);
        pose.bodyRotX = -0.26 * up;
        pose.bodyY = 0.06 * up;
        pose.neckRotX = -0.6 * up;
        pose.headRotX = -0.45 * up;
        pose.headRotY = Math.sin(this.t * 26) * 0.05 * up;
        pose.tailAmp = 0.4;
        pose.wingRotZ = 0.1 + 0.9 * up;
        pose.armRotX = -1.1 * up;
        break;
      }

      case 'guard':
        pose.bodyRotX = 0.18;
        pose.bodyY = -0.05;
        pose.neckRotX = 0.24;
        pose.headRotX = 0.2;
        pose.legAmp = 0.12;
        pose.tailAmp = 0.05;
        break;
    }
    return pose;
  }

  private apply(p: Pose): void {
    if (this.body) {
      this.body.rotation.set(p.bodyRotX, p.bodyRotY, p.bodyRotZ);
      this.body.position.y = this.baseY + p.bodyY;
      this.body.position.z = p.bodyZ;
    }
    if (this.neck) this.neck.rotation.x = p.neckRotX;
    if (this.head) {
      this.head.rotation.x = p.headRotX;
      this.head.rotation.y = p.headRotY;
    }

    // 脚: 四足は対角同位相（トロット）、二足は逆位相
    this.legs.forEach((leg, i) => {
      const quad = this.legs.length === 4;
      const phase = quad ? (i === 0 || i === 3 ? 0 : Math.PI) : i === 0 ? 0 : Math.PI;
      leg.rotation.x = Math.sin(p.legPhase + phase) * p.legAmp;
    });

    // 尾: 根本から先端へ位相をずらして波を伝える
    this.tail.forEach((seg, i) => {
      seg.rotation.y = Math.sin(p.tailPhase - i * 0.55) * p.tailAmp;
      seg.rotation.x = Math.sin(p.tailPhase * 0.6 - i * 0.4) * p.tailAmp * 0.35;
    });

    this.arms.forEach((arm, i) => {
      arm.rotation.x = p.armRotX;
      arm.rotation.z = (i === 0 ? 1 : -1) * 0.12;
    });

    this.wings.forEach((wing, i) => {
      const s = i === 0 ? 1 : -1;
      wing.rotation.z = s * p.wingRotZ;
      wing.rotation.x = p.wingRotX;
    });
  }
}

interface Pose {
  bodyRotX: number; bodyRotY: number; bodyRotZ: number; bodyY: number; bodyZ: number;
  neckRotX: number; headRotX: number; headRotY: number;
  legPhase: number; legAmp: number;
  tailAmp: number; tailPhase: number;
  armRotX: number; wingRotZ: number; wingRotX: number;
}

function lerpPose(a: Pose, b: Pose, t: number): Pose {
  const out = {} as Pose;
  for (const k of Object.keys(b) as (keyof Pose)[]) {
    out[k] = THREE.MathUtils.lerp(a[k], b[k], t);
  }
  return out;
}

const ease = (t: number): number => t * t * (3 - 2 * t);
const easeOutBack = (t: number): number => {
  const c = 1.9;
  return 1 + (c + 1) * Math.pow(t - 1, 3) + c * Math.pow(t - 1, 2);
};
