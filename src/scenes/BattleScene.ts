import * as THREE from 'three';
import { VoxelGrid } from '../voxel/VoxelGrid';
import { VoxelPainter, Rng } from '../voxel/VoxelPainter';
import { greedyMesh } from '../voxel/greedyMesher';
import { ELEMENT_COLORS, BIOMES, type BiomeId, type ElementId } from '../voxel/palette';
import { createVoxelMaterial, type VoxelMaterial } from '../shaders/VoxelMaterial';
import { SpriteUnit, SpriteAnimator, type SpriteState } from '../fx/SpriteUnit';
import { Environment } from '../fx/Environment';
import { DebrisSystem } from '../fx/Debris';
import { StatAura } from '../fx/StatAura';
import { DamageNumbers } from '../fx/DamageNumbers';
import { getRevos } from '../game/data/revos';
import type { Fighter, Row, Side } from '../game/battle/types';
import type { QualitySettings } from '../core/Quality';

/**
 * オートバトルの舞台。
 *
 * 3v3 を横一列ではなく奥行きに配置する。縦持ち 9:16 で横並びにすると
 * 1体あたりの幅が足りず、ボクセルの立体感もパースも死ぬ。
 * 手前に自軍・奥に敵という配置なら縦画面でも成立し、カメラワークが効く。
 */

export interface BattleUnitView {
  uid: string;
  unit: SpriteUnit;
  anim: SpriteAnimator;
  home: THREE.Vector3;
  side: Side;
  row: Row;
  element: ElementId;
  alive: boolean;
  /** 被弾で押し戻される量 */
  knock: number;
  flash: number;
  /** 攻撃時の踏み込み先。未設定なら home へ戻る */
  lungeTarget?: THREE.Vector3;
  lungeT?: number;
}

/**
 * 自軍は左手前、敵は右奥。真正面の奥行き配置だと、横向きに描かれた
 * スプライト同士が向き合って見えない。斜めに置けば奥行きも左右の
 * 対峙も同時に成り立つ。
 */
const SLOT_POS: Record<Side, Record<number, [number, number]>> = {
  0: { 0: [-1.2, 3.4], 1: [-1.95, 5.5], 2: [0.9, 6.0] },
  1: { 0: [1.2, -3.4], 1: [1.95, -5.5], 2: [-0.9, -6.0] },
};

export class BattleScene {
  readonly scene = new THREE.Scene();
  readonly camera: THREE.PerspectiveCamera;
  readonly units = new Map<string, BattleUnitView>();

  private env: Environment;
  private arenaMaterial: VoxelMaterial;
  private debris: DebrisSystem;
  readonly numbers = new DamageNumbers(28);
  private buffAura = new StatAura('fx-buff', 12);
  private debuffAura = new StatAura('fx-debuff', 12);
  private arena?: THREE.Mesh;

  private camPos = new THREE.Vector3();
  private camLook = new THREE.Vector3();
  private camGoal = new THREE.Vector3();
  private lookGoal = new THREE.Vector3();
  private shake = 0;
  private shakeSeed = 0;
  /** ヒットストップの残り時間。全体の時間を止める */
  private hitStop = 0;
  private slowMo = 0;
  private tmp = new THREE.Vector3();
  /**
   * 画面比ごとのフレーミング補正。
   *
   * 縦長では下端をデッキ（味方カード）が占めるので、そのぶん引いて
   * 見る点を手前に送り、6体ぶんを上半分に寄せる。画角を広げるだけだと
   * 手前の味方が枠外に落ちる。
   */
  private camOffset = new THREE.Vector3();
  private lookOffset = new THREE.Vector3();
  private goalTmp = new THREE.Vector3();

  reducedShake = false;

  constructor(quality: QualitySettings) {
    this.camera = new THREE.PerspectiveCamera(46, 1, 0.1, 200);
    this.env = new Environment(quality);
    this.scene.add(this.env.group);
    this.arenaMaterial = createVoxelMaterial({
      voxelSize: 0.25,
      colorJitter: 0.13,
      edgeDarkness: 0.05,
      aoDirect: 0.32,
      rimStrength: 0.12,
      floorLight: 0.08,
    });
    this.debris = new DebrisSystem(Math.min(quality.maxParticles, 260), 0.18);
    this.scene.add(this.debris.mesh);
    this.scene.add(this.numbers.group);
    this.scene.add(this.buffAura.group);
    this.scene.add(this.debuffAura.group);

    this.camPos.set(0, 8.6, 15.8);
    this.camLook.set(0, 1.2, -0.3);
  }

  // ------------------------------------------------------------ 構築

  buildArena(biomeId: BiomeId, seed: number): void {
    if (this.arena) {
      this.scene.remove(this.arena);
      this.arena.geometry.dispose();
    }
    const biome = BIOMES[biomeId];
    this.env.applyBiome(biome, this.scene);
    this.env.fitShadowToArea(new THREE.Vector3(0, 0, 0), 13);
    // バトルは屋外の露頭。フォグは弱めて奥の敵が沈まないようにする
    this.scene.fog = new THREE.FogExp2(biome.fog, 0.014);

    const S = 96, H = 10, D = 112;
    const grid = new VoxelGrid(S, H, D);
    const p = new VoxelPainter(grid);
    const rng = new Rng(seed);
    const cx = S / 2, cz = D / 2;
    const rx = S * 0.46, rz = D * 0.46;

    for (let z = 0; z < D; z++) {
      for (let x = 0; x < S; x++) {
        const nx = (x - cx) / rx, nz = (z - cz) / rz;
        const d = Math.hypot(nx, nz);
        if (d > 1) continue;
        // 縁に向かって落ち込む台地。断面に地層が出る。
        // 完全な平面だと「板」に見えるので、うねりを少しだけ乗せる
        const ripple = Math.sin(x * 0.34) * Math.cos(z * 0.29) * 0.9 + Math.sin((x + z) * 0.17) * 0.7;
        const h = Math.round(H - 2 - Math.pow(d, 3.2) * (H - 3) + ripple * (1 - d * 0.6));
        for (let y = 0; y <= h; y++) {
          const depth = h - y;
          let slot: number;
          if (depth === 0) slot = d > 0.82 ? 5 : rng.chance(0.12) ? 2 : 1;
          else if (depth < 2) slot = 2;
          else if (depth < 4) slot = 3;
          else slot = rng.chance(0.3) ? 6 : 5;
          grid.set(x, y, z, slot);
        }
      }
    }
    // 縁に岩を散らして輪郭を締める
    for (let i = 0; i < 40; i++) {
      const a = rng.next() * Math.PI * 2;
      const r = 0.86 + rng.next() * 0.12;
      const x = Math.round(cx + Math.cos(a) * rx * r);
      const z = Math.round(cz + Math.sin(a) * rz * r);
      let top = -1;
      for (let y = H - 1; y >= 0; y--) if (grid.isSolid(x, y, z)) { top = y; break; }
      if (top < 0) continue;
      p.ellipsoid(x, top + 1, z, rng.range(1, 2.4), rng.range(1, 2.2), rng.range(1, 2.4), rng.chance(0.3) ? 6 : 5);
    }

    const data = greedyMesh(grid, biome.palette, {
      voxelSize: 0.25,
      origin: [(-cx) * 0.25, -H * 0.25 + 0.25, (-cz) * 0.25],
    });
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(data.positions, 3));
    geo.setAttribute('normal', new THREE.BufferAttribute(data.normals, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(data.colors, 3));
    geo.setAttribute('aAO', new THREE.BufferAttribute(data.ao, 1));
    geo.setAttribute('uv', new THREE.BufferAttribute(data.uvs, 2));
    geo.setIndex(new THREE.BufferAttribute(data.indices, 1));
    geo.computeBoundingSphere();
    this.arena = new THREE.Mesh(geo, this.arenaMaterial);
    this.arena.receiveShadow = true;
    this.arena.castShadow = false;
    this.arena.matrixAutoUpdate = false;
    this.arena.updateMatrix();
    this.scene.add(this.arena);
  }

  setFighters(fighters: Fighter[]): void {
    this.clearUnits();
    for (const f of fighters) {
      const def = getRevos(f.defId);
      const unit = new SpriteUnit(def.sprite, {
        height: 1.95 * (def.build.scale ?? 1),
        facingRight: f.side === 0,
        shadow: 0.3,
        holo: def.rarity >= 5,
      });
      const [px, pz] = SLOT_POS[f.side][f.slot];
      unit.root.position.set(px, 0, pz);
      this.scene.add(unit.root);

      const view: BattleUnitView = {
        uid: f.uid,
        unit,
        anim: new SpriteAnimator(unit),
        home: new THREE.Vector3(px, 0, pz),
        side: f.side,
        row: f.row,
        element: def.element,
        alive: true,
        knock: 0,
        flash: 0,
      };
      view.anim.play('idle');
      this.units.set(f.uid, view);
    }
  }

  private clearUnits(): void {
    this.buffAura.clear();
    this.debuffAura.clear();
    for (const u of this.units.values()) {
      this.scene.remove(u.unit.root);
      u.unit.dispose();
    }
    this.units.clear();
  }

  // ------------------------------------------------------------ 演出API

  play(uid: string, state: SpriteState): void {
    this.units.get(uid)?.anim.play(state);
  }

  /** 攻撃の踏み込み。対象へ寄ってから戻る */
  lunge(uid: string, targetUid: string): void {
    const a = this.units.get(uid);
    const b = this.units.get(targetUid);
    if (!a || !b) return;
    a.anim.play('attack');
    const dir = this.tmp.copy(b.unit.root.position).sub(a.unit.root.position).setY(0).normalize();
    const dist = a.unit.root.position.distanceTo(b.unit.root.position);
    a.lungeTarget = a.home.clone().addScaledVector(dir, Math.min(2.6, dist * 0.42));
    a.lungeT = 0;
  }

  hit(uid: string, amount: number, crit: boolean, eff: number, maxHp: number): void {
    const u = this.units.get(uid);
    if (!u) return;
    u.anim.play('hurt');
    u.flash = 1;
    u.knock = Math.min(0.75, 0.22 + (amount / maxHp) * 1.6);

    const pos = u.unit.root.position.clone();
    pos.y += u.unit.spriteHeight * 0.95;
    const color = crit ? '#ffd15c' : eff > 1 ? '#ff9c3c' : eff < 1 ? '#9c9086' : '#f8f2e4';
    this.numbers.spawn(pos, crit ? `${amount}!` : `${amount}`, { color, crit, scale: 0.85 + Math.min(0.45, amount / maxHp) });

    this.debris.burst(pos, ELEMENT_COLORS[u.element], crit ? 16 : 9, { speed: 2.4, up: 2.4, life: 0.6, size: 0.8 });
    // ヒットストップ。倍速でも短縮しない。これが消えると手応えが完全に失われる
    this.hitStop = Math.max(this.hitStop, crit ? 0.09 : 0.05);
    this.addShake(crit ? 0.34 : 0.16);
  }

  /**
   * ステータスが動いたユニットに粒子を重ねる。up なら火の粉、
   * そうでなければ降りてくる青。
   *
   * 数値を出さないのは、これが「量」ではなく「乗った」を伝える合図だから。
   * 実際の増減はカードの数値が引き受ける——両方を出すと、1行動のあいだに
   * 6件のバフが飛ぶ編成（制空覇道）や、敵3体に同時に乗るデバフ（風蝕嵐）で
   * 画面が数字で埋まる。
   */
  statChange(uid: string, up: boolean): void {
    const u = this.units.get(uid);
    if (!u || !u.alive) return;
    (up ? this.buffAura : this.debuffAura).spawn(uid, u.unit.root, {
      height: u.unit.spriteHeight * 0.5,
      scale: u.unit.spriteHeight * 1.25,
    });
  }

  heal(uid: string, amount: number): void {
    const u = this.units.get(uid);
    if (!u) return;
    const pos = u.unit.root.position.clone();
    pos.y += u.unit.spriteHeight * 0.95;
    this.numbers.spawn(pos, `+${amount}`, { color: '#2dc6a4', scale: 1 });
    this.debris.burst(pos, 0x2dc6a4, 10, { speed: 1.4, up: 3.2, life: 0.9, size: 0.6 });
  }

  ko(uid: string): void {
    const u = this.units.get(uid);
    if (!u) return;
    u.alive = false;
    u.anim.play('ko');
    this.hitStop = Math.max(this.hitStop, 0.12);
    // 決着の一撃だけスローにする。1戦に1回だから効く
    this.addShake(0.5);
    const pos = u.unit.root.position.clone();
    pos.y += u.unit.spriteHeight * 0.5;
    this.debris.burst(pos, ELEMENT_COLORS[u.element], 30, { speed: 3.4, up: 4.0, life: 1.2, size: 1 });
  }

  slowMotion(duration = 0.35): void {
    this.slowMo = duration;
  }

  addShake(v: number): void {
    if (this.reducedShake) return;
    this.shake = Math.min(1.1, this.shake + v);
  }

  setRow(uid: string, row: Row): void {
    const u = this.units.get(uid);
    if (!u) return;
    u.row = row;
    // 前列へ上がるときは1歩前へ出る。位置で状態が読めるようにする
    const slot = row === 'front' ? 0 : u.home.x < 0 ? 1 : 2;
    const [px, pz] = SLOT_POS[u.side][slot];
    u.home.set(px, 0, pz);
  }

  /** 行動者と対象を画面に収める */
  focus(actorUid: string, targetUid?: string): void {
    const a = this.units.get(actorUid);
    if (!a) return;
    const t = targetUid ? this.units.get(targetUid) : undefined;
    const mid = this.tmp.copy(a.unit.root.position);
    if (t) mid.add(t.unit.root.position).multiplyScalar(0.5);

    // 自軍側から見る構図を保ったまま、行動者の側へ寄る
    const fromSelf = a.side === 0 ? 1 : 0.55;
    this.camGoal.set(mid.x * 0.28, 7.8 + fromSelf * 0.7, mid.z * 0.2 + 14.4);
    this.lookGoal.set(mid.x * 0.42, 1.1, mid.z * 0.45);
  }

  wideShot(): void {
    this.camGoal.set(0, 8.6, 15.8);
    this.lookGoal.set(0, 1.2, -0.3);
  }

  // ------------------------------------------------------------ ループ

  update(dt: number): void {
    // ヒットストップ中は時間を止める。UI とカメラだけ動かす
    let scale = 1;
    if (this.hitStop > 0) {
      this.hitStop -= dt;
      scale = 0;
    } else if (this.slowMo > 0) {
      this.slowMo -= dt;
      scale = 0.25;
    }
    const sdt = dt * scale;

    for (const u of this.units.values()) {
      // Y はアニメーション側の持ち分。XZ だけを外から動かす
      u.anim.update(sdt);
      const animY = u.unit.root.position.y;

      if (u.lungeTarget) {
        u.lungeT = (u.lungeT ?? 0) + sdt;
        const p = Math.min(1, u.lungeT / 0.95);
        const k = p < 0.46 ? easeOut(p / 0.46) : 1 - easeIn((p - 0.46) / 0.54);
        u.unit.root.position.x = u.home.x + (u.lungeTarget.x - u.home.x) * k;
        u.unit.root.position.z = u.home.z + (u.lungeTarget.z - u.home.z) * k;
        if (p >= 1) {
          u.lungeTarget = undefined;
          u.unit.root.position.x = u.home.x;
          u.unit.root.position.z = u.home.z;
        }
      } else if (u.knock > 0) {
        const dir = u.side === 0 ? 1 : -1;
        u.unit.root.position.x = u.home.x - 0.5 * u.knock * dir;
        u.unit.root.position.z = u.home.z + u.knock * dir;
        u.knock = Math.max(0, u.knock - sdt * 3.4);
        if (u.knock === 0) {
          u.unit.root.position.x = u.home.x;
          u.unit.root.position.z = u.home.z;
        }
      } else {
        u.unit.root.position.x += (u.home.x - u.unit.root.position.x) * Math.min(1, dt * 6);
        u.unit.root.position.z += (u.home.z - u.unit.root.position.z) * Math.min(1, dt * 6);
      }
      u.unit.root.position.y = animY;
      u.unit.faceCamera(this.camera);

      if (u.flash > 0) {
        u.flash = Math.max(0, u.flash - dt * 6);
        u.unit.setFlash(u.flash * 0.85);
      }
    }

    this.debris.update(sdt, -0.4);
    this.numbers.update(dt);
    this.buffAura.update(sdt);
    this.debuffAura.update(sdt);
    this.env.update(dt, this.camera.position);
    this.updateCamera(dt);
  }

  private updateCamera(dt: number): void {
    this.camPos.lerp(this.goalTmp.copy(this.camGoal).add(this.camOffset), Math.min(1, dt * 3.4));
    this.camLook.lerp(this.goalTmp.copy(this.lookGoal).add(this.lookOffset), Math.min(1, dt * 4.2));
    this.camera.position.copy(this.camPos);

    if (this.shake > 0.001) {
      this.shakeSeed += dt * 60;
      const s = this.shake * 0.22;
      this.camera.position.x += Math.sin(this.shakeSeed * 1.7) * s;
      this.camera.position.y += Math.sin(this.shakeSeed * 2.3 + 1.1) * s;
      this.shake = Math.max(0, this.shake - dt * 3.6);
    }
    this.camera.lookAt(this.camLook);
  }

  resize(aspect: number): void {
    this.camera.aspect = aspect;
    // 縦長では画角を広げないと3体が収まらない
    this.camera.fov = aspect < 0.75 ? 50 : aspect < 1.3 ? 46 : 40;
    this.camera.updateProjectionMatrix();

    if (aspect < 0.75) {
      this.camOffset.set(0, 2.0, 4.0);
      this.lookOffset.set(0, -0.5, 2.0);
    } else if (aspect < 1.3) {
      this.camOffset.set(0, 0.9, 1.6);
      this.lookOffset.set(0, -0.2, 0.8);
    } else {
      // 横長でも下端はデッキが取る。画角が狭いぶん寄って見えるので少し引く
      this.camOffset.set(0, 0.8, 2.6);
      this.lookOffset.set(0, -0.15, 1.3);
    }
  }

  /** 画面上の位置を返す。HPバーなどをDOMで置く場合に使う */
  worldOf(uid: string, out: THREE.Vector3): THREE.Vector3 | null {
    const u = this.units.get(uid);
    if (!u) return null;
    return out.copy(u.unit.root.position).setY(u.unit.spriteHeight * 0.9);
  }

  dispose(): void {
    this.clearUnits();
    if (this.arena) {
      this.scene.remove(this.arena);
      this.arena.geometry.dispose();
    }
    this.debris.dispose();
    this.numbers.dispose();
    this.buffAura.dispose();
    this.debuffAura.dispose();
    this.env.dispose();
    this.arenaMaterial.dispose();
  }
}

const easeOut = (t: number): number => 1 - Math.pow(1 - t, 2.4);
const easeIn = (t: number): number => t * t;
