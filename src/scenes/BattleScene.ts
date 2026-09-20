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
  /** 持ち場。スロットと列で決まる基準点。ここ自体は動かない */
  anchor: THREE.Vector3;
  /** いま立ちたい点。持ち場＋間合い＋揺らぎ＋押し合いで毎フレーム決まる */
  home: THREE.Vector3;
  side: Side;
  row: Row;
  role: Role;
  element: ElementId;
  alive: boolean;
  /** 揺らぎの位相。個体ごとにずらす——揃うと6体が同じ拍で揺れる */
  phase: number;
  /** 被弾で押し戻される量 */
  knock: number;
  flash: number;
  facingRight: boolean;
  /** 踏み込みの最中だけ入る軌跡。無ければ home を追うだけ */
  strike?: {
    from: THREE.Vector3;
    to: THREE.Vector3;
    /** 向くべき相手の横位置 */
    faceX: number;
    t: number;
    /** 踏み込みに使う秒数。打点が出る時刻に合わせる */
    in: number;
    /** 戻りに使う秒数 */
    back: number;
  };
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

/**
 * 役割ごとの立ち回り。
 *
 * 壁役は前に出たまま小さく構え、脚の速い役ほど広く動き回り、
 * 支援役は下がって間合いを取る。数値は絵だけに効く——戦闘の計算は
 * シミュレータ側で完結しているので、ここを触っても勝敗は1ミリも動かない。
 */
interface Gait {
  /** 敵へ寄る量。負なら下がる */
  lean: number;
  /** 待機中に動き回る幅 */
  sway: number;
  /** 歩調。大きいほど落ち着かない */
  rate: number;
  /** 攻撃時に詰める間合い。遠い役はその場で撃つ */
  reach: number;
}

const ROLE_GAIT: Record<Role, Gait> = {
  Tank: { lean: 1.55, sway: 0.30, rate: 0.55, reach: 1.15 },
  Guardian: { lean: 1.35, sway: 0.32, rate: 0.60, reach: 1.20 },
  Striker: { lean: 1.00, sway: 0.62, rate: 0.95, reach: 1.05 },
  Breaker: { lean: 0.90, sway: 0.56, rate: 0.88, reach: 1.10 },
  Finisher: { lean: 0.80, sway: 0.68, rate: 1.00, reach: 1.00 },
  Sprinter: { lean: 0.55, sway: 0.98, rate: 1.35, reach: 0.95 },
  Healer: { lean: -0.85, sway: 0.34, rate: 0.70, reach: 6.5 },
  Buffer: { lean: -0.70, sway: 0.38, rate: 0.75, reach: 6.0 },
  Debuffer: { lean: -0.35, sway: 0.60, rate: 0.98, reach: 4.0 },
  Technical: { lean: -0.15, sway: 0.52, rate: 0.85, reach: 4.6 },
  'All-round': { lean: 0.55, sway: 0.52, rate: 0.82, reach: 2.4 },
  Apex: { lean: 0.75, sway: 0.46, rate: 0.68, reach: 1.30 },
};

/** 踏み込みの上限。これ以上詰めると、遠い相手へ瞬間移動したように見える */
const DASH_MAX = 3.6;
/** 射程持ちでも最低これだけは前に出る。棒立ちで撃たれると当たった気がしない */
const DASH_MIN = 0.5;
/** 体どうしの最小間隔。これより近づいたら押し合う */
const SEPARATION = 1.55;
/**
 * 押し合いを測るときの奥行きの重み。
 *
 * カメラは浅く見下ろしているので、奥行きの差は画面上でほとんど潰れる。
 * 素の距離で測ると「離れているのに重なって見える」並びを許してしまうので、
 * 奥行きを軽く数えて、横へ開く方向に逃がす。
 */
const DEPTH_WEIGHT = 0.6;
/** 中線。自陣と敵陣がすれ違うと、どちらが味方か読めなくなる */
const MIDLINE = 1.6;

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
  /** いま追っている行動者と対象。位置が動くので毎フレーム構図を取り直す */
  private focusA: string | null = null;
  private focusB: string | null = null;
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
        anchor: new THREE.Vector3(px, 0, pz),
        home: new THREE.Vector3(px, 0, pz),
        side: f.side,
        row: f.row,
        role: def.role,
        element: def.element,
        alive: true,
        phase: hash01(f.uid) * Math.PI * 2,
        knock: 0,
        flash: 0,
        facingRight: f.side === 0,
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

  /**
   * 攻撃の踏み込み。対象へ寄ってから持ち場へ帰る。
   *
   * 詰める距離は役割の間合いで決まる。近接は相手の鼻先まで歩き、
   * 射程を持つ役は半歩だけ前に出る。踏み込みに使う秒数は再生機から
   * 受け取る——打点が出る時刻に着いていないと、当たる前に当たって見える。
   */
  lunge(uid: string, targetUid: string, strikeIn = 0.26): void {
    const a = this.units.get(uid);
    const b = this.units.get(targetUid);
    if (!a || !b) return;
    a.anim.play('attack');
    const from = a.unit.root.position.clone().setY(0);
    const dir = this.tmp.copy(b.unit.root.position).setY(0).sub(from);
    const dist = dir.length();
    const faceX = b.unit.root.position.x;
    if (dist < 0.01 || a === b) {
      // 自分を対象に取る技。踏み込む先が無いので、その場で構えるだけ
      a.strike = { from, to: from.clone(), faceX, t: 0, in: Math.max(0.1, strikeIn), back: 0.34 };
      return;
    }
    dir.divideScalar(dist);
    const gap = dist - ROLE_GAIT[a.role].reach;
    const travel = Math.max(DASH_MIN, Math.min(DASH_MAX, gap));
    a.strike = {
      from,
      to: from.clone().addScaledVector(dir, travel),
      faceX,
      t: 0,
      in: Math.max(0.1, strikeIn),
      back: 0.34,
    };
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
    // 倒れた体はその場に残す。持ち場へ戻ろうとすると死体が歩く
    u.strike = undefined;
    u.home.copy(u.unit.root.position).setY(0);
    u.anchor.copy(u.home);
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
    const slot = row === 'front' ? 0 : u.anchor.x < 0 ? 1 : 2;
    const [px, pz] = SLOT_POS[u.side][slot];
    u.anchor.set(px, 0, pz);
  }

  /** 行動者と対象を画面に収める。以後は毎フレーム構図を取り直す */
  focus(actorUid: string, targetUid?: string): void {
    if (!this.units.has(actorUid)) return;
    this.focusA = actorUid;
    this.focusB = targetUid && this.units.has(targetUid) ? targetUid : null;
    this.frame();
  }

  /**
   * 2体を収める構図を作る。
   *
   * 踏み込みで距離が変わるので、固定の引きでは寄りすぎたり余ったりする。
   * 2体の間隔ぶんだけ後ろへ下がって、どちらも枠に残すようにする。
   */
  private frame(): void {
    const a = this.focusA ? this.units.get(this.focusA) : undefined;
    if (!a) return;
    const t = this.focusB ? this.units.get(this.focusB) : undefined;
    const mid = this.tmp.copy(a.unit.root.position);
    let spread = 0;
    if (t) {
      spread = a.unit.root.position.distanceTo(t.unit.root.position);
      mid.add(t.unit.root.position).multiplyScalar(0.5);
    }
    // 自軍側から見る構図を保ったまま、行動者の側へ寄る
    const fromSelf = a.side === 0 ? 1 : 0.55;
    const back = Math.min(3.6, Math.max(0, spread - 4) * 0.55);
    this.camGoal.set(mid.x * 0.28, 7.8 + fromSelf * 0.7 + back * 0.22, mid.z * 0.2 + 14.0 + back);
    this.lookGoal.set(mid.x * 0.42, 1.1, mid.z * 0.45);
  }

  wideShot(): void {
    this.focusA = null;
    this.focusB = null;
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
    this.time += sdt;

    // 1) 立ち位置を決める。全員ぶん出してから押し合わせないと、
    //    先に処理した個体だけが譲る形になって並びが片側へ寄る
    for (const u of this.units.values()) if (u.alive) this.roam(u);
    this.separate();

    // 2) 向きの基準。敵陣の重心を見せる——横へ動くたびに背を向けられると、
    //    誰と戦っているのか読めなくなる
    const centre = [0, 0];
    const count = [0, 0];
    for (const u of this.units.values()) {
      if (!u.alive) continue;
      centre[u.side] += u.unit.root.position.x;
      count[u.side]++;
    }
    for (const side of [0, 1]) if (count[side] > 0) centre[side] /= count[side];

    for (const u of this.units.values()) {
      // Y はアニメーション側の持ち分。XZ だけを外から動かす
      u.anim.update(sdt);
      const animY = u.unit.root.position.y;
      const px = u.unit.root.position.x;
      const pz = u.unit.root.position.z;

      if (u.strike) {
        const k = u.strike;
        k.t += sdt;
        if (k.t < k.in) {
          // 行き。打点の出る時刻に着くよう、速く出て減速する
          const e = easeOut(k.t / k.in);
          u.unit.root.position.x = k.from.x + (k.to.x - k.from.x) * e;
          u.unit.root.position.z = k.from.z + (k.to.z - k.from.z) * e;
        } else {
          // 帰り。持ち場は揺れ続けているので、戻りきった先がそのまま待機に繋がる
          const e = smooth(Math.min(1, (k.t - k.in) / k.back));
          u.unit.root.position.x = k.to.x + (u.home.x - k.to.x) * e;
          u.unit.root.position.z = k.to.z + (u.home.z - k.to.z) * e;
          if (e >= 1) u.strike = undefined;
        }
      } else {
        // 待機。遅れて追わせる。即座に合わせると歩かずに滑る
        const f = Math.min(1, sdt * 3.0);
        u.unit.root.position.x = px + (u.home.x - px) * f;
        u.unit.root.position.z = pz + (u.home.z - pz) * f;
      }

      // のけぞりは立ち位置の上に足す。移動と取り合うと、押されたぶんが消える
      if (u.knock > 0) {
        const dir = u.side === 0 ? 1 : -1;
        u.unit.root.position.x -= 0.5 * u.knock * dir;
        u.unit.root.position.z += u.knock * dir;
        u.knock = Math.max(0, u.knock - sdt * 3.4);
      }
      u.unit.root.position.y = animY;

      // 3) 歩き・向き。動いている間だけ歩きに差し替える
      if (sdt > 0 && u.alive) {
        const moved = Math.hypot(u.unit.root.position.x - px, u.unit.root.position.z - pz) / sdt;
        const st = u.anim.current;
        if (st === 'idle' || st === 'walk'
          || ((st === 'attack' || st === 'hurt' || st === 'roar') && u.anim.finished)) {
          u.anim.play(moved > 0.55 ? 'walk' : 'idle');
        }
        const toX = u.strike ? u.strike.faceX : centre[u.side === 0 ? 1 : 0];
        const d = toX - u.unit.root.position.x;
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

    this.debris.update(sdt, -0.4);
    this.numbers.update(dt);
    this.buffAura.update(sdt);
    this.debuffAura.update(sdt);
    this.env.update(dt, this.camera.position);
    // 2体とも動き続けるので、構図は毎フレーム取り直す
    if (this.focusA) this.frame();
    this.updateCamera(dt);
  }

  /**
   * 立ち位置を決める。
   *
   * 持ち場を中心に、役割ぶんだけ敵へ寄る／下がる。そこへ周期の違う
   * 2本の正弦を重ねて、同じ間隔で往復しているようには見えないようにする。
   * ここで動かすのは絵だけで、シミュレータ側の列（front / back）には触らない。
   */
  private roam(u: BattleUnitView): void {
    const g = ROLE_GAIT[u.role];
    const fwd = u.side === 0 ? -1 : 1;
    const w = this.time * g.rate + u.phase;
    // 寄り方自体をゆっくり脈打たせる。一定だと「置かれている」ままに見える
    const lean = g.lean * (0.72 + 0.38 * Math.sin(w * 0.31));
    u.home.set(
      u.anchor.x + Math.sin(w * 0.9) * g.sway,
      0,
      u.anchor.z + fwd * lean + Math.sin(w * 0.63 + 1.7) * g.sway * 0.55,
    );
    u.home.z = u.side === 0 ? Math.max(MIDLINE, u.home.z) : Math.min(-MIDLINE, u.home.z);
  }

  /** 重なりを解く。敵味方の区別なく押し合う——重なると手前の1体しか見えない */
  private separate(): void {
    const list: BattleUnitView[] = [];
    for (const u of this.units.values()) if (u.alive) list.push(u);
    for (let i = 0; i < list.length; i++) {
      for (let j = i + 1; j < list.length; j++) {
        const a = list[i];
        const b = list[j];
        const dx = b.home.x - a.home.x;
        const dz = (b.home.z - a.home.z) * DEPTH_WEIGHT;
        const d = Math.hypot(dx, dz);
        if (d >= SEPARATION || d < 1e-4) continue;
        const push = (SEPARATION - d) * 0.5;
        const nx = (dx / d) * push;
        const nz = (dz / d) * push / DEPTH_WEIGHT;
        a.home.x -= nx; a.home.z -= nz;
        b.home.x += nx; b.home.z += nz;
      }
    }
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
const smooth = (t: number): number => t * t * (3 - 2 * t);

/** uid から 0..1 を作る。揺らぎの位相を個体ごとにずらすためだけに使う */
function hash01(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return ((h >>> 0) % 10000) / 10000;
}
