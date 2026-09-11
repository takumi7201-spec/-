import * as THREE from 'three';
import { VoxelWorld } from '../voxel/VoxelWorld';
import { T, BIOMES, type BiomeId } from '../voxel/palette';
import { createVoxelMaterial, type VoxelMaterial } from '../shaders/VoxelMaterial';
import { buildCharacter, buildTool, CharacterAnimator, type CharacterRig } from '../voxel/VoxelCharacter';
import { Environment } from '../fx/Environment';
import { DebrisSystem } from '../fx/Debris';
import { EchoRing, EchoMarkers, strengthForDistance, type Strength } from '../fx/Echo';
import {
  generateDigSite, hardnessOf, VOXEL_SIZE, AREA_VOX, AREA_METERS,
  type BuriedNode, type DigSiteData, type SpeciesEntry,
} from '../game/TerrainGen';
import type { InputManager } from '../core/Input';
import type { QualitySettings } from '../core/Quality';
import { audio } from '../core/Audio';

export type DigMode = 'explore' | 'scan' | 'extract';

export interface DigEvents {
  onEcho?(hits: { node: BuriedNode; strength: Strength }[]): void;
  onDig?(slot: number, worldPos: THREE.Vector3): void;
  onFossilTouched?(node: BuriedNode): void;
  onCollect?(node: BuriedNode): void;
  onDigBlocked?(): void;
  onStaminaChange?(v: number, max: number): void;
  onEchoCooldown?(remain: number, total: number): void;
  onModeChange?(mode: DigMode): void;
  onDepthChange?(meters: number): void;
}

const MOVE_SPEED = 4.5;
const ECHO_RADIUS = 8;
const ECHO_CD = 3.0;
const ECHO_CHARGE = 0.6;
const MAX_STAMINA = 45;
/** 地表からこの割合だけ岩を剥がせば回収できる */
const COLLECT_RATIO = 0.42;

export class DigScene {
  readonly scene = new THREE.Scene();
  readonly camera: THREE.PerspectiveCamera;
  readonly events: DigEvents = {};

  site!: DigSiteData;
  world!: VoxelWorld;
  mode: DigMode = 'explore';
  stamina = MAX_STAMINA;
  biomeId: BiomeId = 'canyon';

  private env: Environment;
  private material: VoxelMaterial;
  private charMaterial: VoxelMaterial;
  private rig!: CharacterRig;
  private anim!: CharacterAnimator;
  private debris: DebrisSystem;
  private echo = new EchoRing(ECHO_RADIUS);
  private markers = new EchoMarkers();

  private pos = new THREE.Vector3();
  private vel = new THREE.Vector3();
  private yaw = 0;
  private camYaw = 0;
  private camPos = new THREE.Vector3();
  private camTarget = new THREE.Vector3();
  private grounded = true;
  private fallVel = 0;

  private echoTimer = 0;
  private charging = 0;
  private digCooldown = 0;
  private digging = false;
  private shadowDirty = true;
  private lastChunkKey = '';
  private tmpV = new THREE.Vector3();
  private camHead = new THREE.Vector3();
  private camRay = new THREE.Vector3();
  private tmpDir = new THREE.Vector3();
  private scanBlend = 0;
  private lamp!: THREE.PointLight;
  private depthM = 0;

  constructor(quality: QualitySettings) {
    this.camera = new THREE.PerspectiveCamera(50, 1, 0.1, 260);
    this.env = new Environment(quality);
    this.scene.add(this.env.group);

    this.material = createVoxelMaterial({
      voxelSize: VOXEL_SIZE,
      colorJitter: 0.16,
      edgeDarkness: 0.035,
      aoDirect: 0.34,
      rimStrength: 0.14,
    });
    this.charMaterial = createVoxelMaterial({
      voxelSize: 0.055,
      colorJitter: 0.03,
      edgeDarkness: 0.1,
      aoDirect: 0.34,
      rimStrength: 0.26,
    });

    // 発掘者のヘッドランプ。地下では太陽も半球光もほとんど届かない
    this.lamp = new THREE.PointLight(0xffe4c4, 0, 14, 1.7);
    this.lamp.castShadow = false;
    this.scene.add(this.lamp);

    this.debris = new DebrisSystem(Math.min(quality.maxParticles, 320), VOXEL_SIZE);
    this.scene.add(this.debris.mesh);
    this.scene.add(this.echo.mesh);
    this.scene.add(this.markers.group);
  }

  // ------------------------------------------------------------ 生成

  load(biomeId: BiomeId, seed: number, speciesPool: SpeciesEntry[], rarityScale = 1): void {
    this.unloadSite();
    this.biomeId = biomeId;
    const biome = BIOMES[biomeId];

    this.site = generateDigSite({ biome, seed, speciesPool, material: this.material, rarityScale });
    this.world = this.site.world;
    this.scene.add(this.world.group);

    this.env.applyBiome(biome, this.scene);
    const half = AREA_METERS / 2;
    this.env.fitShadowToArea(
      new THREE.Vector3(half, this.site.center.y, half),
      half * 1.05,
    );

    if (!this.rig) {
      this.rig = buildCharacter(this.charMaterial);
      this.anim = new CharacterAnimator(this.rig);
      const tool = buildTool(this.charMaterial);
      this.rig.toolAnchor.add(tool);
      this.scene.add(this.rig.root);
    }

    const sx = this.site.spawn.x;
    const sz = this.site.spawn.z;
    const gy = this.site.heights[sx + sz * AREA_VOX] + 1;
    this.pos.set((sx + 0.5) * VOXEL_SIZE, gy * VOXEL_SIZE, (sz + 0.5) * VOXEL_SIZE);
    this.yaw = 0;
    this.camYaw = 0;
    this.stamina = MAX_STAMINA;
    this.echoTimer = 0;
    this.charging = 0;
    this.mode = 'explore';
    this.markers.clear();
    this.debris.clear();
    this.shadowDirty = true;

    this.camPos.copy(this.resolveCameraOcclusion(this.cameraGoal()));
    this.events.onStaminaChange?.(this.stamina, MAX_STAMINA);
    this.events.onDepthChange?.(0);
  }

  private unloadSite(): void {
    if (this.world) {
      this.scene.remove(this.world.group);
      this.world.dispose();
    }
  }

  // ------------------------------------------------------------ ループ

  update(dt: number, input: InputManager, active: boolean): void {
    if (!this.world) return;

    if (active) {
      this.handleLook(input);
      this.handleMove(dt, input);
      this.handleEcho(dt, input);
      this.handleDig(dt, input);
    }

    this.updateCamera(dt);
    this.anim.update(dt, Math.min(1, this.vel.length() / MOVE_SPEED), this.digging);
    this.debris.update(dt, 0);
    this.echo.update(dt);
    this.markers.update(dt);
    this.env.update(dt, this.camera.position);

    const built = this.world.update();
    if (built > 0) this.shadowDirty = true;

    // 影はチャンクをまたいだときとメッシュが変わったときだけ焼き直す
    const key = `${Math.floor(this.pos.x / 4)}_${Math.floor(this.pos.z / 4)}`;
    if (key !== this.lastChunkKey) {
      this.lastChunkKey = key;
      this.shadowDirty = true;
    }
  }

  /** レンダラに「影を1フレームだけ焼き直す」必要があるか伝える */
  consumeShadowDirty(): boolean {
    const d = this.shadowDirty;
    this.shadowDirty = false;
    return d;
  }

  private handleLook(input: InputManager): void {
    this.camYaw -= input.look.x * 1.6;
  }

  private handleMove(dt: number, input: InputManager): void {
    if (this.mode === 'scan') { this.vel.set(0, 0, 0); return; }

    const mx = input.move.x;
    const mz = input.move.y;
    const len = Math.hypot(mx, mz);
    // チャージ中は移動を落とす。歩きながら撃ち続けるのが最適プレイになるよう
    // CD側で調整してあるので、ここで止め切ってしまわない
    const speedMul = this.charging > 0 ? 0.6 : 1;

    if (len > 0.08) {
      // カメラ基準の移動。画面の上＝奥に進む
      const sin = Math.sin(this.camYaw);
      const cos = Math.cos(this.camYaw);
      const wx = mx * cos - mz * sin;
      const wz = mx * sin + mz * cos;
      const l = Math.hypot(wx, wz) || 1;
      this.tmpDir.set(wx / l, 0, wz / l);
      this.yaw = Math.atan2(this.tmpDir.x, this.tmpDir.z);
      const sp = MOVE_SPEED * Math.min(1, len) * speedMul;
      this.vel.set(this.tmpDir.x * sp, 0, this.tmpDir.z * sp);
    } else {
      this.vel.multiplyScalar(Math.max(0, 1 - dt * 14));
    }

    if (this.vel.lengthSq() > 1e-5) {
      this.tryMove(this.vel.x * dt, this.vel.z * dt);
    }

    // 接地。足元のボクセル上面に吸着させる
    const gx = Math.floor(this.pos.x / VOXEL_SIZE);
    const gz = Math.floor(this.pos.z / VOXEL_SIZE);
    const surface = this.surfaceHeight(gx, gz);
    const targetY = surface * VOXEL_SIZE;
    const dy = targetY - this.pos.y;
    if (dy < -0.02) {
      // 落下。掘った穴に沈むときは重力で落ちるほうが手応えが出る
      this.fallVel = Math.min(this.fallVel + 22 * dt, 14);
      this.pos.y = Math.max(targetY, this.pos.y - this.fallVel * dt);
      this.grounded = this.pos.y <= targetY + 1e-4;
      if (this.grounded) this.fallVel = 0;
    } else {
      // 上り段差は滑らかに吸い付ける。瞬間移動だとカメラが跳ねる
      this.fallVel = 0;
      this.pos.y += dy * Math.min(1, dt * 16);
      this.grounded = Math.abs(dy) < 0.05;
    }

    this.rig.root.position.copy(this.pos);
    this.rig.root.rotation.y = this.yaw;

    const groundLevel = this.site.heights[
      Math.max(0, Math.min(AREA_VOX - 1, gx)) + Math.max(0, Math.min(AREA_VOX - 1, gz)) * AREA_VOX
    ];
    const depthM = Math.max(0, (groundLevel - surface) * VOXEL_SIZE);
    this.depthM = depthM;
    this.events.onDepthChange?.(depthM);

    // 潜るほど強く灯す。地表では消えているので日中の絵を壊さない
    this.lamp.position.set(this.pos.x, this.pos.y + 1.5, this.pos.z);
    const want = THREE.MathUtils.clamp((depthM - 0.4) / 1.6, 0, 1);
    this.lamp.intensity += (want * 3.8 - this.lamp.intensity) * Math.min(1, dt * 4);
  }

  /** 軸ごとに分離して押し出す。斜めに壁へ突っ込んでも滑る */
  private tryMove(dx: number, dz: number): void {
    const r = 0.28;
    const stepUp = 1; // ボクセル1段までは自動で登る

    const canStand = (x: number, z: number): boolean => {
      const gx = Math.floor(x / VOXEL_SIZE);
      const gz = Math.floor(z / VOXEL_SIZE);
      const gy = Math.floor(this.pos.y / VOXEL_SIZE);
      for (let k = 1; k <= stepUp + 1; k++) {
        if (!this.world.grid.isSolid(gx, gy + k, gz)) return true;
      }
      return false;
    };

    for (const [ox, oz] of [[dx, 0], [0, dz]] as const) {
      const nx = this.pos.x + ox;
      const nz = this.pos.z + oz;
      const probeX = nx + Math.sign(ox) * r;
      const probeZ = nz + Math.sign(oz) * r;
      if (canStand(ox !== 0 ? probeX : nx, oz !== 0 ? probeZ : nz)) {
        this.pos.x = ox !== 0 ? nx : this.pos.x;
        this.pos.z = oz !== 0 ? nz : this.pos.z;
      }
    }
    const margin = VOXEL_SIZE * 2;
    this.pos.x = THREE.MathUtils.clamp(this.pos.x, margin, AREA_METERS - margin);
    this.pos.z = THREE.MathUtils.clamp(this.pos.z, margin, AREA_METERS - margin);
  }

  /** そのカラムで立てる最も高い面 */
  private surfaceHeight(gx: number, gz: number): number {
    for (let y = Math.min(39, Math.floor(this.pos.y / VOXEL_SIZE) + 3); y >= 0; y--) {
      if (this.world.grid.isSolid(gx, y, gz)) return y + 1;
    }
    return 1;
  }

  // ------------------------------------------------------------ エコー

  private handleEcho(dt: number, input: InputManager): void {
    if (this.echoTimer > 0) {
      this.echoTimer = Math.max(0, this.echoTimer - dt);
      this.events.onEchoCooldown?.(this.echoTimer, ECHO_CD);
    }
    if (this.charging > 0) {
      this.charging -= dt;
      if (this.charging <= 0) this.fireEcho();
      return;
    }
    if (input.justPressed('radar') && this.echoTimer <= 0 && this.mode !== 'extract') {
      this.charging = ECHO_CHARGE;
      audio.echoPing();
    }
  }

  requestEcho(): void {
    if (this.echoTimer <= 0 && this.charging <= 0 && this.mode !== 'extract') {
      this.charging = ECHO_CHARGE;
      audio.echoPing();
    }
  }

  private fireEcho(): void {
    this.charging = 0;
    this.echoTimer = ECHO_CD;
    this.echo.fire(this.pos, BIOMES[this.biomeId].id === 'emberfield' ? 0xf4a23c : 0x2dc6a4);

    const hits: { node: BuriedNode; strength: Strength }[] = [];
    for (const n of this.site.nodes) {
      if (n.collected) continue;
      const wx = (n.cx + 0.5) * VOXEL_SIZE;
      const wz = (n.cz + 0.5) * VOXEL_SIZE;
      const d = Math.hypot(wx - this.pos.x, wz - this.pos.z);
      const s = strengthForDistance(d);
      if (s === null) continue;
      hits.push({ node: n, strength: s });
    }
    hits.sort((a, b) => b.strength - a.strength);

    const shown = hits.slice(0, 3);
    for (const hitItem of shown) hitItem.node.revealed = true;

    this.markers.set(
      this.site.nodes
        .filter((n) => n.revealed && !n.collected)
        .slice(0, 3)
        .map((n) => {
          const wx = (n.cx + 0.5) * VOXEL_SIZE;
          const wz = (n.cz + 0.5) * VOXEL_SIZE;
          const gy = this.site.heights[n.cx + n.cz * AREA_VOX];
          const d = Math.hypot(wx - this.pos.x, wz - this.pos.z);
          return {
            nodeId: n.id,
            position: new THREE.Vector3(wx, gy * VOXEL_SIZE + 0.9, wz),
            strength: strengthForDistance(d) ?? 1,
            kind: n.kind,
          };
        }),
    );

    if (shown.length > 0) {
      audio.echoHit(shown[0].strength);
    }
    this.events.onEcho?.(shown);
  }

  get echoCooldown(): number { return this.echoTimer; }
  get echoCharging(): boolean { return this.charging > 0; }

  // ------------------------------------------------------------ 掘削

  private handleDig(dt: number, input: InputManager): void {
    this.digCooldown = Math.max(0, this.digCooldown - dt);
    const wants = input.isDown('interact');
    this.digging = wants && this.stamina > 0;
    if (!this.digging || this.digCooldown > 0) return;
    this.dig();
  }

  requestDig(): void {
    if (this.stamina <= 0 || this.digCooldown > 0) return;
    this.digging = true;
    this.dig();
  }

  /**
   * 掘削1回。足元前方のボクセルを削る。
   * 化石は削れない（誤爆で割らせない）が、周囲の岩を剥がすと露出が進む。
   */
  private dig(): void {
    this.digCooldown = 0.26;

    // 掘るのは自分の真下。掘るほど沈み、壁面に地層が立ち上がる。
    // 前方を掘る方式にすると横穴になり、深度という概念が機能しなくなる。
    const gx = Math.floor(this.pos.x / VOXEL_SIZE);
    const gz = Math.floor(this.pos.z / VOXEL_SIZE);
    let gy = -1;
    const from = Math.floor(this.pos.y / VOXEL_SIZE);
    for (let y = from; y >= 0; y--) {
      if (this.world.grid.isSolid(gx, y, gz)) { gy = y; break; }
    }
    if (gy < 0) { audio.uiError(); return; }

    const slot = this.world.grid.get(gx, gy, gz);
    if (slot === T.FOSSIL) {
      // 化石そのものは削れない。周囲を剥がすよう促す
      this.events.onDigBlocked?.();
      audio.uiError();
      return;
    }

    this.stamina = Math.max(0, this.stamina - 1);
    this.events.onStaminaChange?.(this.stamina, MAX_STAMINA);

    const hardness = hardnessOf(slot);
    // 硬い岩ほど削れる範囲が狭い。同じ1タップでも進みが違うのが手応えになる
    const radius = hardness >= 4 ? 1.05 : hardness >= 2.5 ? 1.25 : 1.5;
    let removed = 0;
    let touchedFossil: BuriedNode | null = null;

    // 上へ行くほど広く削る＝すり鉢。垂直な井戸を掘ると中が一切見えなくなる
    const r = Math.ceil(radius * 2.2);
    for (let dz = -r; dz <= r; dz++)
      for (let dy = -r; dy <= r; dy++)
        for (let dx = -r; dx <= r; dx++) {
          const widen = dy > 0 ? 1 + dy * 0.46 : 1;
          if (Math.hypot(dx, dz) > radius * widen) continue;
          if (Math.abs(dy) > radius * 1.1 && dy < 0) continue;
          if (dy > radius * 2.6) continue;
          const x = gx + dx, y = gy + dy, z = gz + dz;
          const v = this.world.grid.get(x, y, z);
          if (v === 0 || v === T.FOSSIL) continue;
          this.world.set(x, y, z, 0);
          removed++;
        }

    // 剥がした結果、露出した化石ボクセルを数える
    for (const n of this.site.nodes) {
      if (n.collected) continue;
      if (Math.hypot(n.cx - gx, n.cy - gy, n.cz - gz) > n.radius + 3) continue;
      const exposed = this.countExposed(n);
      if (exposed > n.exposed) {
        if (n.exposed === 0) touchedFossil = n;
        n.exposed = exposed;
        n.revealed = true;
      }
      if (n.exposed / n.total >= COLLECT_RATIO) {
        this.collect(n);
      }
    }

    const worldPos = new THREE.Vector3((gx + 0.5) * VOXEL_SIZE, (gy + 0.5) * VOXEL_SIZE, (gz + 0.5) * VOXEL_SIZE);
    const color = colorForSlot(slot, this.biomeId);
    this.debris.burst(worldPos, color, Math.min(14, 5 + removed), { speed: 2.6, up: 3.0, life: 0.8 });
    audio.dig(hardness);
    this.events.onDig?.(slot, worldPos);

    if (touchedFossil) {
      audio.fossilHit();
      this.events.onFossilTouched?.(touchedFossil);
      this.debris.burst(worldPos, 0xf4a23c, 20, { speed: 3.4, up: 4.2, life: 1.1, size: 0.8 });
    }
  }

  private countExposed(n: BuriedNode): number {
    let c = 0;
    const r = Math.ceil(n.radius) + 2;
    for (let dz = -r; dz <= r; dz++)
      for (let dy = -r; dy <= r; dy++)
        for (let dx = -r; dx <= r; dx++) {
          const x = n.cx + dx, y = n.cy + dy, z = n.cz + dz;
          if (this.world.grid.get(x, y, z) !== T.FOSSIL) continue;
          if (
            !this.world.grid.isSolid(x + 1, y, z) || !this.world.grid.isSolid(x - 1, y, z) ||
            !this.world.grid.isSolid(x, y + 1, z) || !this.world.grid.isSolid(x, y - 1, z) ||
            !this.world.grid.isSolid(x, y, z + 1) || !this.world.grid.isSolid(x, y, z - 1)
          ) c++;
        }
    return c;
  }

  private collect(n: BuriedNode): void {
    n.collected = true;
    const wx = (n.cx + 0.5) * VOXEL_SIZE;
    const wy = (n.cy + 0.5) * VOXEL_SIZE;
    const wz = (n.cz + 0.5) * VOXEL_SIZE;
    // 残った化石ボクセルを消す
    const r = Math.ceil(n.radius) + 2;
    for (let dz = -r; dz <= r; dz++)
      for (let dy = -r; dy <= r; dy++)
        for (let dx = -r; dx <= r; dx++) {
          const x = n.cx + dx, y = n.cy + dy, z = n.cz + dz;
          if (this.world.grid.get(x, y, z) === T.FOSSIL) this.world.set(x, y, z, 0);
        }
    this.markers.remove(n.id);
    this.debris.burst(new THREE.Vector3(wx, wy, wz), n.kind === 'fossil' ? 0xf4a23c : 0x4ba6e2, 26, {
      speed: 3.8, up: 5, life: 1.2, size: 0.9,
    });
    audio.fossilHit();
    this.events.onCollect?.(n);
  }

  get remainingFinds(): number {
    return this.site.nodes.filter((n) => !n.collected).length;
  }

  // ------------------------------------------------------------ カメラ

  setMode(mode: DigMode): void {
    if (this.mode === mode) return;
    this.mode = mode;
    this.events.onModeChange?.(mode);
  }

  private cameraGoal(): THREE.Vector3 {
    // 俯角50°前後。エリアの約1/3が常に見えている構図
    const deep = THREE.MathUtils.clamp((this.depthM - 0.5) / 2.4, 0, 1);
    const pitch = this.mode === 'scan' ? 1.40 : THREE.MathUtils.lerp(0.86, 1.46, deep);
    const dist = this.mode === 'scan' ? 22 : THREE.MathUtils.lerp(10.5, 8.0, deep);
    const h = Math.sin(pitch) * dist;
    const horiz = Math.cos(pitch) * dist;
    this.tmpV.set(
      this.pos.x - Math.sin(this.camYaw) * horiz,
      this.pos.y + h,
      this.pos.z - Math.cos(this.camYaw) * horiz,
    );
    // 穴に潜ってもカメラは地表より上に置く。地中に入れると周囲の土の断面で
    // 画面が埋まり、何も読めなくなる。地表から穴を覗き込む構図にする。
    const gx = THREE.MathUtils.clamp(Math.floor(this.pos.x / VOXEL_SIZE), 0, AREA_VOX - 1);
    const gz = THREE.MathUtils.clamp(Math.floor(this.pos.z / VOXEL_SIZE), 0, AREA_VOX - 1);
    const groundY = this.site.heights[gx + gz * AREA_VOX] * VOXEL_SIZE;
    this.tmpV.y = Math.max(this.tmpV.y, groundY + 4.2);
    return this.tmpV;
  }

  /**
   * カメラコリジョン。崖や掘った穴の壁がカメラとプレイヤーの間に入ると
   * 画面が土の断面で埋まる。頭の位置からカメラへレイを飛ばし、
   * 地形に当たったらその手前まで引き寄せる。
   */
  private resolveCameraOcclusion(goal: THREE.Vector3): THREE.Vector3 {
    const head = this.camHead.set(this.pos.x, this.pos.y + 1.2, this.pos.z);
    const dir = this.camRay.copy(goal).sub(head);
    const dist = dir.length();
    if (dist < 0.01) return goal;
    dir.divideScalar(dist);
    const hit = this.world.raycast(head, dir, dist);
    if (!hit) return goal;
    // 面から少し離す。ピッタリ寄せるとニアクリップで壁を貫通する
    const safe = Math.max(3.0, hit.dist - VOXEL_SIZE * 1.6);
    return goal.copy(head).addScaledVector(dir, safe);
  }

  private updateCamera(dt: number): void {
    const goal = this.resolveCameraOcclusion(this.cameraGoal());
    const target = this.mode === 'scan' ? 8 : 5.5;
    this.camPos.lerp(goal, Math.min(1, dt * target));
    this.camera.position.copy(this.camPos);

    this.camTarget.lerp(
      this.tmpV.set(this.pos.x, this.pos.y + (this.mode === 'scan' ? 0.2 : 1.0), this.pos.z),
      Math.min(1, dt * 8),
    );
    this.camera.lookAt(this.camTarget);

    this.scanBlend += ((this.mode === 'scan' ? 1 : 0) - this.scanBlend) * Math.min(1, dt * 6);
  }

  resize(aspect: number): void {
    this.camera.aspect = aspect;
    this.camera.updateProjectionMatrix();
  }

  get playerPosition(): THREE.Vector3 { return this.pos; }
  get playerGrounded(): boolean { return this.grounded; }
  get scanAmount(): number { return this.scanBlend; }

  dispose(): void {
    this.unloadSite();
    this.debris.dispose();
    this.echo.dispose();
    this.markers.dispose();
    this.env.dispose();
    this.material.dispose();
    this.charMaterial.dispose();
  }
}

function colorForSlot(slot: number, _biome: BiomeId): number {
  void _biome;
  switch (slot) {
    case T.SAND: return 0xd8b483;
    case T.SAND_DARK: return 0xc09a68;
    case T.DIRT: return 0x8a6a45;
    case T.CLAY: return 0xa87f56;
    case T.ROCK: return 0x7d6a5c;
    case T.HARDROCK: return 0x5d5049;
    case T.GRAVEL: return 0x9a8a78;
    case T.CRYSTAL: return 0x7fd7e8;
    case T.VEIN: return 0xc45a3a;
    case T.GRASS: return 0x86a05a;
    case T.MOSS: return 0x6f8c4a;
    default: return 0xb0a08a;
  }
}
