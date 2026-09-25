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
import { getRevos, type Role } from '../game/data/revos';
import type { Fighter, Side } from '../game/battle/types';
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
  /**
   * 足元の位置。シミュレータの座標を追う。踏み込みやのけぞりは
   * この上に足す見た目だけのずれで、ここには混ぜない
   */
  base: THREE.Vector3;
  /** シミュレータの座標を刻みのあいだで補間した、いま立つべき点 */
  goal: THREE.Vector3;
  side: Side;
  role: Role;
  element: ElementId;
  alive: boolean;
  /** のけぞりの量と向き */
  knock: number;
  knockX: number;
  knockZ: number;
  flash: number;
  facingRight: boolean;
  /** 向くべき相手の横位置。無ければ敵陣の重心を見る */
  faceX: number | null;
  /** 近接の踏み込み。位置そのものはシミュレータが持つので、前のめりの絵だけ */
  lunge?: { dx: number; dz: number; t: number; in: number; back: number };
  /** 跳躍の残り時間 */
  hop: number;
}

/** 飛び道具。射撃役の通常攻撃を、撃った側から当たる側へ運ぶ */
interface Shot {
  mesh: THREE.Mesh;
  from: THREE.Vector3;
  target: string;
  t: number;
  dur: number;
}

/** 踏み込みの深さ。必殺は大きく出る */
const LUNGE = 0.45;
const LUNGE_OD = 0.85;
/** 跳躍の長さと高さ */
const HOP_TIME = 0.45;
const HOP_HEIGHT = 1.5;
/** 位置の追い方。大きく離れた（引き寄せ・跳躍）ときは、ゆっくり引きずって見せる */
const FOLLOW_NEAR = 22;
const FOLLOW_FAR = 7;

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
  /** 揺らぎの時計。ヒットストップ中は止まる */
  private time = 0;
  /** 必殺の寄り。撃った本人と相手を、残り時間のあいだだけ大きく映す */
  private spotA: string | null = null;
  private spotB: string | null = null;
  private spotLeft = 0;
  private shots: Shot[] = [];
  private shotPool: THREE.Mesh[] = [];
  private shotGeo = new THREE.SphereGeometry(0.16, 10, 8);
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
        // 巨獣は体ごと大きい。シミュレータの押し合いの半径と同じ倍率で描く
        height: 1.95 * (def.build.scale ?? 1) * f.size,
        facingRight: f.side === 0,
        shadow: 0.3,
        holo: def.rarity >= 5,
      });
      unit.root.position.set(f.x, 0, f.z);
      this.scene.add(unit.root);

      const view: BattleUnitView = {
        uid: f.uid,
        unit,
        anim: new SpriteAnimator(unit),
        base: new THREE.Vector3(f.x, 0, f.z),
        goal: new THREE.Vector3(f.x, 0, f.z),
        side: f.side,
        role: def.role,
        element: def.element,
        alive: true,
        knock: 0, knockX: 0, knockZ: 0,
        flash: 0,
        facingRight: f.side === 0,
        faceX: null,
        hop: 0,
      };
      view.anim.play('idle');
      this.units.set(f.uid, view);
    }
    this.wideShot();
  }

  private clearUnits(): void {
    this.buffAura.clear();
    this.debuffAura.clear();
    for (const u of this.units.values()) {
      this.scene.remove(u.unit.root);
      u.unit.dispose();
    }
    this.units.clear();
    for (const s of this.shots) this.releaseShot(s);
    this.shots = [];
  }

  /**
   * シミュレータの位置を受け取る。alpha は直前の刻みから次の刻みまでの
   * 進み具合で、刻みのあいだを補間して 30Hz のカクつきを消す。
   */
  syncFighters(fighters: Fighter[], alpha: number): void {
    const k = Math.max(0, Math.min(1, alpha));
    for (const f of fighters) {
      const u = this.units.get(f.uid);
      if (!u || !u.alive) continue;
      u.goal.set(f.px + (f.x - f.px) * k, 0, f.pz + (f.z - f.pz) * k);
      const t = f.target ? this.units.get(f.target) : undefined;
      u.faceX = t ? t.base.x : null;
    }
  }

  /** 戦闘の時計の速さ。ヒットストップ中は 0、決着のスロー中は 0.25 */
  timeScale(): number {
    if (this.hitStop > 0) return 0;
    if (this.slowMo > 0) return 0.25;
    return 1;
  }

  // ------------------------------------------------------------ 演出API

  play(uid: string, state: SpriteState): void {
    this.units.get(uid)?.anim.play(state);
  }

  /**
   * 攻撃の構え。近接は相手へ前のめりに踏み込み、射撃は弾を飛ばす。
   * どちらも打点（windup 秒後）に届くように合わせる——着く前に数字が
   * 出ると、当たる前に当たって見える。
   */
  attack(uid: string, targetUid: string | null, windup: number, ranged: boolean, od: boolean): void {
    const a = this.units.get(uid);
    if (!a || !a.alive) return;
    a.anim.play('attack');
    const b = targetUid ? this.units.get(targetUid) : undefined;
    if (!b || b === a || b.side === a.side) return;
    a.faceX = b.base.x;
    if (ranged) {
      this.fire(a, b.uid, Math.max(0.12, windup));
      return;
    }
    const dx = b.base.x - a.base.x;
    const dz = b.base.z - a.base.z;
    const d = Math.hypot(dx, dz);
    if (d < 1e-3) return;
    const reach = Math.min(d * 0.6, od ? LUNGE_OD : LUNGE);
    a.lunge = { dx: (dx / d) * reach, dz: (dz / d) * reach, t: 0, in: Math.max(0.08, windup), back: 0.26 };
  }

  /** 跳ぶ。位置はシミュレータがもう動かしているので、弧だけを描く */
  leap(uid: string): void {
    const u = this.units.get(uid);
    if (!u) return;
    u.hop = HOP_TIME;
    u.anim.play('attack');
  }

  private fire(from: BattleUnitView, target: string, dur: number): void {
    const mesh = this.shotPool.pop() ?? new THREE.Mesh(
      this.shotGeo,
      new THREE.MeshBasicMaterial({ transparent: true, opacity: 0.95, depthWrite: false }),
    );
    (mesh.material as THREE.MeshBasicMaterial).color.set(ELEMENT_COLORS[from.element]);
    const start = from.unit.root.position.clone();
    start.y += from.unit.spriteHeight * 0.55;
    mesh.position.copy(start);
    mesh.visible = true;
    this.scene.add(mesh);
    this.shots.push({ mesh, from: start, target, t: 0, dur });
  }

  private releaseShot(s: Shot): void {
    this.scene.remove(s.mesh);
    s.mesh.visible = false;
    this.shotPool.push(s.mesh);
  }

  hit(uid: string, fromUid: string, amount: number, crit: boolean, eff: number, maxHp: number): void {
    const u = this.units.get(uid);
    if (!u) return;
    u.anim.play('hurt');
    u.flash = 1;
    // 打たれた向きへ押し返す。どこから殴られたかが体の動きで分かる
    const from = this.units.get(fromUid);
    let kx = u.side === 0 ? 0.5 : -0.5;
    let kz = u.side === 0 ? 1 : -1;
    if (from && from !== u) {
      kx = u.base.x - from.base.x;
      kz = u.base.z - from.base.z;
    }
    const kd = Math.max(1e-3, Math.hypot(kx, kz));
    u.knockX = kx / kd;
    u.knockZ = kz / kd;
    u.knock = Math.min(0.6, 0.18 + (amount / maxHp) * 1.4);

    const pos = u.unit.root.position.clone();
    pos.y += u.unit.spriteHeight * 0.95;
    const color = crit ? '#ffd15c' : eff > 1 ? '#ff9c3c' : eff < 1 ? '#9c9086' : '#f8f2e4';
    this.numbers.spawn(pos, crit ? `${amount}!` : `${amount}`, { color, crit, scale: 0.85 + Math.min(0.45, amount / maxHp) });

    this.debris.burst(pos, ELEMENT_COLORS[u.element], crit ? 16 : 9, { speed: 2.4, up: 2.4, life: 0.6, size: 0.8 });
    // ヒットストップ。全員が同時に殴り合うので、単発より短く取る
    this.hitStop = Math.max(this.hitStop, crit ? 0.07 : 0.035);
    this.addShake(crit ? 0.3 : 0.12);
  }

  /**
   * ステータスが動いたユニットに粒子を重ねる。up なら火の粉、
   * そうでなければ降りてくる青。数値は出さない——量ではなく「乗った」の合図。
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
    // 倒れた体はその場に残す
    u.lunge = undefined;
    u.goal.copy(u.base);
    this.hitStop = Math.max(this.hitStop, 0.12);
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

  /** 必殺の寄り。seconds のあいだだけ、撃った本人（と相手）に寄る */
  spotlight(actorUid: string, targetUid: string | undefined, seconds: number): void {
    if (!this.units.has(actorUid)) return;
    this.spotA = actorUid;
    this.spotB = targetUid && this.units.has(targetUid) ? targetUid : null;
    this.spotLeft = seconds;
  }

  wideShot(): void {
    this.spotA = null;
    this.spotB = null;
    this.spotLeft = 0;
  }

  /**
   * 構図。全員が同時に動くので、誰か1体を追うのではなく、生きている全員を
   * 収める。広がったら引き、寄り集まったら寄る。必殺の間だけ撃った本人へ寄る。
   */
  private frame(): void {
    const a = this.spotA ? this.units.get(this.spotA) : undefined;
    if (a && this.spotLeft > 0) {
      const t = this.spotB ? this.units.get(this.spotB) : undefined;
      const mid = this.tmp.copy(a.base);
      let spread = 0;
      if (t) {
        spread = a.base.distanceTo(t.base);
        mid.add(t.base).multiplyScalar(0.5);
      }
      const back = Math.min(3.6, Math.max(0, spread - 3) * 0.55);
      this.camGoal.set(mid.x * 0.3, 7.0 + back * 0.25, mid.z + 11.2 + back);
      this.lookGoal.set(mid.x * 0.5, 1.1, mid.z - 0.2);
      return;
    }
    let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity, n = 0;
    for (const u of this.units.values()) {
      if (!u.alive) continue;
      minX = Math.min(minX, u.base.x); maxX = Math.max(maxX, u.base.x);
      minZ = Math.min(minZ, u.base.z); maxZ = Math.max(maxZ, u.base.z);
      n++;
    }
    if (n === 0) return;
    const cx = (minX + maxX) / 2;
    const cz = (minZ + maxZ) / 2;
    const spanX = maxX - minX;
    const spanZ = maxZ - minZ;
    // 上から覗き込む角度にする。浅いと奥行きが画面の縦に潰れて、
    // 手前の味方と奥の敵が1列に重なって見える
    this.camGoal.set(cx * 0.35, 8.8 + spanZ * 0.42 + spanX * 0.3, cz + 5.6 + spanZ * 0.34 + spanX * 0.75);
    this.lookGoal.set(cx * 0.5, 0.6, cz - 0.9);
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
    this.time += sdt;
    if (this.spotLeft > 0) this.spotLeft -= dt;

    // 向きの基準。狙いが無いときは敵陣の重心を見る
    const centre = [0, 0];
    const count = [0, 0];
    for (const u of this.units.values()) {
      if (!u.alive) continue;
      centre[u.side] += u.base.x;
      count[u.side]++;
    }
    for (const side of [0, 1]) if (count[side] > 0) centre[side] /= count[side];

    for (const u of this.units.values()) {
      // Y はアニメーション側の持ち分。XZ だけを外から動かす
      u.anim.update(sdt);
      const animY = u.unit.root.position.y;
      const bx = u.base.x;
      const bz = u.base.z;

      if (u.alive && sdt > 0) {
        const far = Math.hypot(u.goal.x - bx, u.goal.z - bz) > 0.9;
        const f = Math.min(1, sdt * (far ? FOLLOW_FAR : FOLLOW_NEAR));
        u.base.x += (u.goal.x - bx) * f;
        u.base.z += (u.goal.z - bz) * f;
      }

      let ox = 0;
      let oz = 0;
      if (u.lunge) {
        const k = u.lunge;
        k.t += sdt;
        const e = k.t < k.in ? easeOut(k.t / k.in) : 1 - smooth(Math.min(1, (k.t - k.in) / k.back));
        ox += k.dx * e;
        oz += k.dz * e;
        if (k.t >= k.in + k.back) u.lunge = undefined;
      }
      // のけぞりは踏み込みの上に足す。取り合うと、押されたぶんが消える
      if (u.knock > 0) {
        ox += u.knockX * u.knock * 0.6;
        oz += u.knockZ * u.knock * 0.6;
        u.knock = Math.max(0, u.knock - sdt * 3.4);
      }
      let hopY = 0;
      if (u.hop > 0) {
        u.hop = Math.max(0, u.hop - sdt);
        hopY = Math.sin(Math.PI * (1 - u.hop / HOP_TIME)) * HOP_HEIGHT;
      }
      u.unit.root.position.set(u.base.x + ox, animY + hopY, u.base.z + oz);

      // 歩き・向き。動いている間だけ歩きに差し替える
      if (sdt > 0 && u.alive) {
        const moved = Math.hypot(u.base.x - bx, u.base.z - bz) / sdt;
        const st = u.anim.current;
        if (st === 'idle' || st === 'walk'
          || ((st === 'attack' || st === 'hurt' || st === 'roar') && u.anim.finished)) {
          u.anim.play(moved > 0.55 ? 'walk' : 'idle');
        }
        const toX = u.faceX ?? centre[u.side === 0 ? 1 : 0];
        const d = toX - u.base.x;
        // 死に幅を置く。真横に並んだ瞬間に絵が裏返るのを防ぐ
        if (Math.abs(d) > 0.3 && (d > 0) !== u.facingRight) {
          u.facingRight = d > 0;
          u.unit.setFacing(u.facingRight);
        }
      }
      u.unit.faceCamera(this.camera);

      if (u.flash > 0) {
        u.flash = Math.max(0, u.flash - dt * 6);
        u.unit.setFlash(u.flash * 0.85);
      }
    }

    // 飛び道具。的が動いても追いかけて当てる
    for (let i = this.shots.length - 1; i >= 0; i--) {
      const s = this.shots[i];
      s.t += sdt;
      const t = this.units.get(s.target);
      const k = Math.min(1, s.t / s.dur);
      if (t) {
        const to = this.tmp.copy(t.unit.root.position);
        to.y += t.unit.spriteHeight * 0.5;
        s.mesh.position.lerpVectors(s.from, to, k);
        s.mesh.position.y += Math.sin(Math.PI * k) * 0.6;
      }
      if (k >= 1 || !t) {
        this.releaseShot(s);
        this.shots.splice(i, 1);
      }
    }

    this.debris.update(sdt, -0.4);
    this.numbers.update(dt);
    this.buffAura.update(sdt);
    this.debuffAura.update(sdt);
    this.env.update(dt, this.camera.position);
    this.frame();
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
    for (const m of this.shotPool) (m.material as THREE.Material).dispose();
    this.shotGeo.dispose();
  }
}

const easeOut = (t: number): number => 1 - Math.pow(1 - t, 2.4);
const smooth = (t: number): number => t * t * (3 - 2 * t);
