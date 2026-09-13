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
  /** 反応の真上だがまだ浅い。残り深度（メートル） */
  onNearMiss?(node: BuriedNode, remain: number): void;
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
  /** 一時的に開いている穴。時間が来たら埋め戻す */
  private holes: { key: number; cells: { x: number; y: number; z: number; v: number }[]; t: number; life: number }[] = [];
  /** 地点ごとの掘削深度（ボクセル単位）。地形は変えずここだけを進める */
  private digDepth = new Map<number, number>();
  /** 回収済みで埋め戻してはいけない化石ボクセル */
  private collectedVoxels = new Set<string>();
  private digMarker!: THREE.Mesh;
  private markerPulse = 0;
  private shadowCullTimer = 0;
  private shadowDirty = true;
  private lastChunkKey = '';
  private tmpV = new THREE.Vector3();
  private camHead = new THREE.Vector3();
  private camRay = new THREE.Vector3();
  private tmpDir = new THREE.Vector3();
  private scanBlend = 0;
  /** 画面のどれだけ右に被写体を寄せるか 0..1。持ち物を開いたときに使う */
  private viewShift = 0;
  private viewShiftTarget = 0;
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

    // 掘る場所を常に示す。俯瞰視点では「自分の足元のどこを掘るか」が
    // 体で隠れて読み取れない
    const ringGeo = new THREE.RingGeometry(0.5, 0.72, 22);
    ringGeo.rotateX(-Math.PI / 2);
    this.digMarker = new THREE.Mesh(
      ringGeo,
      new THREE.MeshBasicMaterial({
        color: 0xf4a23c, transparent: true, opacity: 0.8,
        depthWrite: false, fog: false,
      }),
    );
    this.digMarker.renderOrder = 8;
    this.scene.add(this.digMarker);

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
    // 40m 四方を1枚で覆うと 2048px でも 2cm/texel しかなく、
    // ボクセルの角が甘くなる。プレイヤー周辺 17m に絞って追従させる
    this.env.fitShadowToArea(this.pos.clone(), 17);

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

    this.updateHoles(dt);
    const built = this.world.update();

    this.updateDigMarker(dt);

    // 影を落とすのはプレイヤー周辺だけ。遠景の影は判別できない
    this.shadowCullTimer += dt;
    if (this.shadowCullTimer > 0.3) {
      this.shadowCullTimer = 0;
      this.world.setShadowRange(this.pos, 16);
    }
    if (built > 0) this.shadowDirty = true;

    // 影はチャンクをまたいだときとメッシュが変わったときだけ焼き直す
    const key = `${Math.floor(this.pos.x / 4)}_${Math.floor(this.pos.z / 4)}`;
    if (key !== this.lastChunkKey) {
      this.lastChunkKey = key;
      this.shadowDirty = true;
      this.env.followShadow(this.pos);
    }
  }

  /** レンダラに「影を1フレームだけ焼き直す」必要があるか伝える */
  consumeShadowDirty(): boolean {
    const d = this.shadowDirty;
    this.shadowDirty = false;
    return d;
  }

  /** 掘削地点のマーカー。掘れない場所では色を落として無駄打ちを防ぐ */
  private updateDigMarker(dt: number): void {
    this.markerPulse += dt * 3.2;
    const fx = this.pos.x + Math.sin(this.yaw) * 1.05;
    const fz = this.pos.z + Math.cos(this.yaw) * 1.05;
    const gx = Math.floor(fx / VOXEL_SIZE);
    const gz = Math.floor(fz / VOXEL_SIZE);
    const inside = gx >= 1 && gz >= 1 && gx < AREA_VOX - 1 && gz < AREA_VOX - 1;
    this.digMarker.visible = inside && this.mode !== 'scan';
    if (!inside) return;

    const surface = this.site.heights[gx + gz * AREA_VOX];
    const depth = this.digDepth.get(gx + gz * AREA_VOX) ?? 0;
    const y = Math.max(1, surface - depth);
    this.digMarker.position.set((gx + 0.5) * VOXEL_SIZE, (y + 1) * VOXEL_SIZE + 0.04, (gz + 0.5) * VOXEL_SIZE);

    const mat = this.digMarker.material as THREE.MeshBasicMaterial;
    const canDig = this.stamina > 0 && surface - depth > 2;
    mat.color.set(canDig ? 0xf4a23c : 0x6e5f52);
    mat.opacity = 0.5 + (canDig ? Math.sin(this.markerPulse) * 0.16 + 0.22 : 0);
    // 掘るほどマーカーを小さくして、進んでいることを形でも伝える
    const shrink = Math.max(0.55, 1 - depth * 0.05);
    this.digMarker.scale.setScalar(shrink);
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
      // カメラ基準の移動。画面の上＝奥、画面の右＝A/D の D。
      //
      // カメラはプレイヤーの手前（-forward 側）にいるので
      //   forward = ( sin(camYaw), 0, cos(camYaw) )
      //   right   = forward × up = ( -cos(camYaw), 0, sin(camYaw) )
      // right の X 符号を落とすと左右が入れ替わる（実際そうなっていた）。
      const sin = Math.sin(this.camYaw);
      const cos = Math.cos(this.camYaw);
      const wx = -mx * cos + mz * sin;
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

    // 表示する深度は「その地点を何回掘ったか」。地形は変わらない
    const clampedX = Math.max(0, Math.min(AREA_VOX - 1, gx));
    const clampedZ = Math.max(0, Math.min(AREA_VOX - 1, gz));
    const front = {
      x: Math.floor((this.pos.x + Math.sin(this.yaw) * 1.05) / VOXEL_SIZE),
      z: Math.floor((this.pos.z + Math.cos(this.yaw) * 1.05) / VOXEL_SIZE),
    };
    this.depthM = this.depthAt(front.x, front.z);
    this.events.onDepthChange?.(this.depthM);
    void clampedX; void clampedZ;

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

    this.refreshMarkers();

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
   * 掘削1回。
   *
   * 地形は恒久的には変えない。掘った穴は数秒で埋まる。
   * 穴を残す方式だとエリアが虫食いになり、カメラが土の断面に埋まり、
   * 一度掘った場所が二度と使えなくなる。ここで管理するのは
   * 「その地点を何回掘ったか」という深度だけで、見た目の穴はその演出。
   */
  private dig(): void {
    this.digCooldown = 0.26;

    // 掘るのはプレイヤーのすぐ前。足元を掘ると自分が穴に落ちる
    const fx = this.pos.x + Math.sin(this.yaw) * 1.05;
    const fz = this.pos.z + Math.cos(this.yaw) * 1.05;
    const gx = Math.floor(fx / VOXEL_SIZE);
    const gz = Math.floor(fz / VOXEL_SIZE);
    if (gx < 1 || gz < 1 || gx >= AREA_VOX - 1 || gz >= AREA_VOX - 1) { audio.uiError(); return; }

    const surface = this.site.heights[gx + gz * AREA_VOX];
    const key = gx + gz * AREA_VOX;
    const depth = (this.digDepth.get(key) ?? 0) + 1;

    const targetY = surface - depth;
    if (targetY < 2) { audio.uiError(); this.events.onDigBlocked?.(); return; }

    // 前回の穴がまだ埋まっていないと、その地点は空洞になっている。
    // ここで「空だから掘れない」と弾くと同じ場所を2回以上掘れなくなる
    // （＝どれだけ連打しても深度が 1 で止まり、化石に永久に届かない）。
    // 空洞なら元の地層から硬さを推定して掘り進める。
    let slot = this.world.grid.get(gx, targetY, gz);
    if (slot === 0) slot = strataAt(surface - targetY);

    this.digDepth.set(key, depth);
    this.stamina = Math.max(0, this.stamina - 1);
    this.events.onStaminaChange?.(this.stamina, MAX_STAMINA);
    this.events.onDepthChange?.(depth * VOXEL_SIZE);

    const hardness = hardnessOf(slot);
    this.openHole(gx, gz, surface, depth);

    const worldPos = new THREE.Vector3(
      (gx + 0.5) * VOXEL_SIZE, (targetY + 0.5) * VOXEL_SIZE, (gz + 0.5) * VOXEL_SIZE,
    );
    this.debris.burst(worldPos, colorForSlot(slot, this.biomeId), 12, { speed: 2.8, up: 3.2, life: 0.8 });
    audio.dig(hardness);
    this.events.onDig?.(slot, worldPos);

    // --- 埋蔵物の判定 ---
    // 平面距離が近く、その地点の深度が埋蔵深度に届いたら掘り当て
    for (const n of this.site.nodes) {
      if (n.collected) continue;
      const planar = Math.hypot(n.cx - gx, n.cz - gz);
      if (planar > n.radius + 2.6) continue;
      const needed = Math.max(1, Math.round((this.site.heights[n.cx + n.cz * AREA_VOX] - n.cy)));
      if (depth + 1 < needed) {
        // 近いが浅い。手応えだけ返して「もう一掘り」を促す
        if (!n.revealed) { n.revealed = true; this.refreshMarkers(); }
        if (planar <= n.radius) this.events.onNearMiss?.(n, (needed - depth) * VOXEL_SIZE);
        continue;
      }
      this.collect(n);
      break;
    }
  }

  /** 一時的な穴を開ける。元のボクセルを控えておき、時間経過で埋め戻す */
  private openHole(gx: number, gz: number, surface: number, depth: number): void {
    const cells: { x: number; y: number; z: number; v: number }[] = [];
    const radius = 1.7;
    const r = Math.ceil(radius * 2);
    const bottom = Math.max(1, surface - depth);

    for (let dz = -r; dz <= r; dz++)
      for (let dx = -r; dx <= r; dx++) {
        for (let y = bottom; y <= surface; y++) {
          // 上へ行くほど広いすり鉢。垂直な井戸だと中が見えない
          const up = y - bottom;
          const rad = radius * (1 + up * 0.22);
          if (Math.hypot(dx, dz) > rad) continue;
          const x = gx + dx, z = gz + dz;
          const v = this.world.grid.get(x, y, z);
          if (v === 0) continue;
          cells.push({ x, y, z, v });
          this.world.set(x, y, z, 0);
        }
      }
    if (cells.length === 0) return;
    // 同じ地点を掘り続けている間は埋め戻さない。掘るたびに猶予を作り直す
    const key = gx + gz * AREA_VOX;
    const existing = this.holes.find((x) => x.key === key);
    if (existing) {
      existing.cells.push(...cells);
      existing.t = 0;
    } else {
      this.holes.push({ key, cells, t: 0, life: 2.6 });
    }
  }

  /** 穴を埋め戻す。掘った直後は見えていて、数秒で崩れて元に戻る */
  private updateHoles(dt: number): void {
    for (let i = this.holes.length - 1; i >= 0; i--) {
      const hole = this.holes[i];
      hole.t += dt;
      if (hole.t < hole.life) continue;
      for (const c of hole.cells) {
        // 掘り出し済みの化石は戻さない
        if (c.v === T.FOSSIL && this.collectedVoxels.has(`${c.x},${c.y},${c.z}`)) continue;
        this.world.set(c.x, c.y, c.z, c.v);
      }
      this.holes.splice(i, 1);
      this.digDepth.delete(hole.key);
      this.shadowDirty = true;
    }
  }

  /** 掘り返し可能かの目安。UI のヒントに使う */
  depthAt(gx: number, gz: number): number {
    return (this.digDepth.get(gx + gz * AREA_VOX) ?? 0) * VOXEL_SIZE;
  }

  private refreshMarkers(): void {
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
  }

  private collect(n: BuriedNode): void {
    n.collected = true;
    const wx = (n.cx + 0.5) * VOXEL_SIZE;
    const wy = (n.cy + 0.5) * VOXEL_SIZE;
    const wz = (n.cz + 0.5) * VOXEL_SIZE;

    // 掘り当てた化石は地中から消す。埋め戻しでも復活させない
    const r = Math.ceil(n.radius) + 2;
    for (let dz = -r; dz <= r; dz++)
      for (let dy = -r; dy <= r; dy++)
        for (let dx = -r; dx <= r; dx++) {
          const x = n.cx + dx, y = n.cy + dy, z = n.cz + dz;
          if (this.world.grid.get(x, y, z) !== T.FOSSIL) continue;
          this.collectedVoxels.add(`${x},${y},${z}`);
          this.world.set(x, y, z, 0);
        }

    this.markers.remove(n.id);
    this.debris.burst(new THREE.Vector3(wx, wy, wz), n.kind === 'fossil' ? 0xf4a23c : 0x4ba6e2, 30, {
      speed: 4.0, up: 5.2, life: 1.3, size: 1,
    });
    audio.fossilHit();
    this.events.onCollect?.(n);
  }

  /** 開発用。指定ボクセル座標へ移動する */
  teleportTo(gx: number, gz: number): void {
    const h = this.site.heights[gx + gz * AREA_VOX];
    this.pos.set((gx + 0.5) * VOXEL_SIZE, (h + 1) * VOXEL_SIZE, (gz + 0.5) * VOXEL_SIZE);
    this.camPos.copy(this.resolveCameraOcclusion(this.cameraGoal()));
  }

  get remainingFinds(): number {
    return this.site.nodes.filter((n) => !n.collected).length;
  }

  /** 化石だけの残数。鉱石は取りこぼしても発掘を終えてよい */
  get remainingFossils(): number {
    return this.site.nodes.filter((n) => !n.collected && n.kind === 'fossil').length;
  }

  // ------------------------------------------------------------ カメラ

  /** 左にパネルを出すとき、プレイヤーを画面の右へ逃がす */
  setViewShift(v: number): void { this.viewShiftTarget = v; }

  setMode(mode: DigMode): void {
    if (this.mode === mode) return;
    this.mode = mode;
    this.events.onModeChange?.(mode);
  }

  private cameraGoal(): THREE.Vector3 {
    // 俯角50°前後。エリアの約1/3が常に見えている構図
    const pitch = this.mode === 'scan' ? 1.40 : 0.86;
    const dist = this.mode === 'scan' ? 22 : 10.5;
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

    this.viewShift += (this.viewShiftTarget - this.viewShift) * Math.min(1, dt * 5);
    // 注視点をカメラの左へずらすと、被写体は画面の右に寄る
    const rx = -Math.cos(this.camYaw);
    const rz = Math.sin(this.camYaw);
    const shift = this.viewShift * 1.5;
    this.camTarget.lerp(
      this.tmpV.set(
        this.pos.x - rx * shift,
        this.pos.y + (this.mode === 'scan' ? 0.2 : 1.0),
        this.pos.z - rz * shift,
      ),
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
    this.digMarker.geometry.dispose();
    (this.digMarker.material as THREE.Material).dispose();
    this.env.dispose();
    this.material.dispose();
    this.charMaterial.dispose();
  }
}

/** 地表からの深さに対応する地層。穴の中を掘るときの硬さ推定に使う */
function strataAt(depthFromSurface: number): number {
  if (depthFromSurface < 2) return T.SAND_DARK;
  if (depthFromSurface < 5) return T.DIRT;
  if (depthFromSurface < 9) return T.CLAY;
  return T.ROCK;
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
