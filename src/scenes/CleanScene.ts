import * as THREE from 'three';
import { VoxelGrid } from '../voxel/VoxelGrid';
import { greedyMesh } from '../voxel/greedyMesher';
import { voxelRaycast } from '../voxel/VoxelWorld';
import { buildPalette } from '../voxel/palette';
import { createVoxelMaterial, type VoxelMaterial } from '../shaders/VoxelMaterial';
import { DebrisSystem } from '../fx/Debris';
import { F, SIZE, markSkin, buildFossilBlock, scoreClean, type FossilBlock, type CleanScore } from '../game/FossilBlock';
import { audio } from '../core/Audio';
import type { QualitySettings } from '../core/Quality';

export type ToolId = 'pick' | 'drill' | 'brush';

export interface ToolSpec {
  id: ToolId;
  name: string;
  /** 効果半径（ボクセル） */
  radius: number;
  /** 連続使用か。false は1タップ1撃 */
  continuous: boolean;
  /** 秒あたりの除去ボクセル数（連続時） */
  rate: number;
  /** 硬岩を割れるか */
  breaksHard: boolean;
  /** 硬岩に当てたときの進みの遅さ（連続ツールのみ。1 で等速） */
  hardRate?: number;
  /** 骨に当てたときのペナルティ */
  bonePenalty: number;
  /** 表層1層だけを剥がす */
  surfaceOnly: boolean;
}

export const TOOLS: Record<ToolId, ToolSpec> = {
  /*
   * 速さと安全のトレードオフ。
   *
   * ドリルは「細い範囲を削る道具」なので、硬岩も削れる。ただし遅い。
   * 割れないことにしていた時期があったが、母岩の半分以上は硬岩なので、
   * それだと当てるたびに弾かれるだけの道具になっていた。
   * 硬岩はピックのほうが圧倒的に速い——その関係は残っている。
   */
  pick: { id: 'pick', name: 'ピック', radius: 2.4, continuous: false, rate: 0, breaksHard: true, bonePenalty: 4, surfaceOnly: false },
  drill: { id: 'drill', name: 'ドリル', radius: 1.5, continuous: true, rate: 22, breaksHard: true, hardRate: 0.34, bonePenalty: 1, surfaceOnly: false },
  brush: { id: 'brush', name: 'ブラシ', radius: 3.2, continuous: true, rate: 12, breaksHard: false, bonePenalty: 0, surfaceOnly: true },
};

const VOX = 0.052;

const CLEAN_PALETTE = buildPalette([
  0x000000,
  0x3a3733, // HARD  暗く硬そうに
  0x9b8260, // SOFT
  0xd8b878, // SKIN  骨が透けて見える層
  0xf2e6c6, // BONE
  0xa8482e, // SCAR
]);

export interface CleanEvents {
  onProgress?(removed: number, total: number): void;
  onBoneHit?(damage: number): void;
  onExposeChange?(exposed: number, boneTotal: number): void;
}

export class CleanScene {
  readonly scene = new THREE.Scene();
  readonly camera: THREE.PerspectiveCamera;
  readonly events: CleanEvents = {};

  block!: FossilBlock;
  tool: ToolId = 'pick';
  removedRock = 0;
  boneDamage = 0;

  private root = new THREE.Group();
  private mesh: THREE.Mesh | null = null;
  private material: VoxelMaterial;
  private debris: DebrisSystem;
  private cursor: THREE.Mesh;
  private dirty = false;
  private drillAccum = 0;
  /** 硬岩に弾かれた音を鳴らした時刻。連打を抑える */
  private blockedAt = 0;
  private lastHitPos: THREE.Vector3 | null = null;
  private ray = new THREE.Ray();
  private invMatrix = new THREE.Matrix4();
  private localOrigin = new THREE.Vector3();
  private localDir = new THREE.Vector3();
  private yaw = 0;
  private pitch = -0.12;
  private spin = 0.12;

  constructor(quality: QualitySettings) {
    this.camera = new THREE.PerspectiveCamera(42, 1, 0.05, 40);
    this.camera.position.set(0, 0, 2.3);
    this.scene.background = new THREE.Color(0x46352a);

    // 作業面なので、太陽の代わりに「作業灯」を3灯置く。
    // 影の落ち方より、凹凸が読めることを優先する
    const key = new THREE.DirectionalLight(0xfff0d8, 3.6);
    key.position.set(1.4, 1.8, 2.2);
    this.scene.add(key);
    const rim = new THREE.DirectionalLight(0x88a8d0, 1.2);
    rim.position.set(-1.6, 0.6, -1.4);
    this.scene.add(rim);
    this.scene.add(new THREE.HemisphereLight(0xd8e4f0, 0x4a3a28, 1.25));

    this.material = createVoxelMaterial({
      voxelSize: VOX,
      colorJitter: 0.14,
      edgeDarkness: 0.1,
      aoDirect: 0.3,
      rimColor: 0xffd9a0,
      rimStrength: 0.22,
      floorLight: 0.1,
    });

    this.debris = new DebrisSystem(Math.min(quality.maxParticles, 180), VOX);
    this.scene.add(this.debris.mesh);
    this.scene.add(this.root);

    // 十字カーソル。指の下は見えないので、実際に削れる場所を必ず描く
    const cg = new THREE.RingGeometry(0.045, 0.055, 24);
    const cm = new THREE.MeshBasicMaterial({ color: 0x2dc6a4, transparent: true, opacity: 0.9, depthTest: false });
    this.cursor = new THREE.Mesh(cg, cm);
    this.cursor.renderOrder = 30;
    this.cursor.visible = false;
    this.scene.add(this.cursor);
  }

  load(defId: string, rarity: number, seed: number): void {
    this.block = buildFossilBlock(defId, rarity, seed);
    this.removedRock = 0;
    this.boneDamage = 0;
    this.yaw = 0;
    this.pitch = -0.12;
    this.debris.clear();
    this.rebuild();
    this.events.onProgress?.(0, this.block.rockTotal);
  }

  private rebuild(): void {
    if (this.mesh) {
      this.root.remove(this.mesh);
      this.mesh.geometry.dispose();
    }
    const data = greedyMesh(this.block.grid, CLEAN_PALETTE, {
      voxelSize: VOX,
      origin: [-SIZE.x * VOX / 2, -SIZE.y * VOX / 2, -SIZE.z * VOX / 2],
    });
    if (data.quadCount === 0) { this.mesh = null; return; }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(data.positions, 3));
    geo.setAttribute('normal', new THREE.BufferAttribute(data.normals, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(data.colors, 3));
    geo.setAttribute('aAO', new THREE.BufferAttribute(data.ao, 1));
    geo.setAttribute('uv', new THREE.BufferAttribute(data.uvs, 2));
    geo.setIndex(new THREE.BufferAttribute(data.indices, 1));
    geo.computeBoundingSphere();
    this.mesh = new THREE.Mesh(geo, this.material);
    this.root.add(this.mesh);
  }

  setTool(t: ToolId): void {
    this.tool = t;
    // 道具を持ち替えたら溜めは引き継がない
    this.drillAccum = 0;
  }

  rotate(dx: number, dy: number): void {
    this.yaw += dx;
    this.pitch = THREE.MathUtils.clamp(this.pitch + dy, -1.1, 1.1);
    this.spin = 0;
  }

  /** 画面NDC座標からブロックにレイを飛ばし、当たったボクセルを返す */
  private pick(ndc: { x: number; y: number }): { x: number; y: number; z: number; value: number; world: THREE.Vector3 } | null {
    if (!this.mesh) return null;
    this.ray.origin.setFromMatrixPosition(this.camera.matrixWorld);
    this.ray.direction.set(ndc.x, ndc.y, 0.5).unproject(this.camera).sub(this.ray.origin).normalize();

    this.invMatrix.copy(this.root.matrixWorld).invert();
    this.localOrigin.copy(this.ray.origin).applyMatrix4(this.invMatrix);
    this.localDir.copy(this.ray.direction).transformDirection(this.invMatrix);

    // グリッド座標系（原点が隅）へ寄せてから DDA に渡す
    const half = new THREE.Vector3(SIZE.x, SIZE.y, SIZE.z).multiplyScalar(VOX / 2);
    const origin = this.localOrigin.clone().add(half);
    const hit = voxelRaycast(this.block.grid, VOX, origin, this.localDir, 12);
    if (!hit) return null;

    const world = new THREE.Vector3(
      (hit.x + 0.5) * VOX - half.x,
      (hit.y + 0.5) * VOX - half.y,
      (hit.z + 0.5) * VOX - half.z,
    ).applyMatrix4(this.root.matrixWorld);
    return { x: hit.x, y: hit.y, z: hit.z, value: hit.value, world };
  }

  /** カーソルだけ更新する（指を置いているが削っていない状態） */
  aim(ndc: { x: number; y: number } | null): void {
    if (!ndc) { this.cursor.visible = false; return; }
    const hit = this.pick(ndc);
    if (!hit) { this.cursor.visible = false; return; }
    this.cursor.visible = true;
    this.cursor.position.copy(hit.world);
    this.cursor.lookAt(this.camera.position);
    const spec = TOOLS[this.tool];
    this.cursor.scale.setScalar(spec.radius * 1.35);
    (this.cursor.material as THREE.MeshBasicMaterial).color.set(
      hit.value === F.BONE ? 0xd9512f : spec.id === 'brush' ? 0x4ba6e2 : 0x2dc6a4,
    );
  }

  /**
   * ツールを当てる。連続ツールは dt に応じた量だけ削る。
   * @returns 削ったボクセル数
   */
  apply(ndc: { x: number; y: number }, dt: number, firstTouch: boolean): number {
    const spec = TOOLS[this.tool];
    if (!spec.continuous && !firstTouch) return 0;

    const hit = this.pick(ndc);
    if (!hit) { this.cursor.visible = false; return 0; }
    this.cursor.visible = true;
    this.cursor.position.copy(hit.world);
    this.cursor.lookAt(this.camera.position);

    if (spec.continuous) {
      // 硬岩に当てている間は進みが遅い
      const slow = hit.value === F.HARD ? (spec.hardRate ?? 1) : 1;
      this.drillAccum += spec.rate * slow * dt;
      if (this.drillAccum < 1) return 0;
      // 端数は次に持ち越す。0 に戻すと、フレーム落ちのたびに削りが目減りする
      this.drillAccum -= 1;
    }

    return this.carve(hit.x, hit.y, hit.z, spec, hit.world);
  }

  private carve(cx: number, cy: number, cz: number, spec: ToolSpec, world: THREE.Vector3): number {
    const g = this.block.grid;
    const r = Math.ceil(spec.radius);
    let removed = 0;
    let boneHit = 0;
    let hardBlocked = false;

    for (let dz = -r; dz <= r; dz++)
      for (let dy = -r; dy <= r; dy++)
        for (let dx = -r; dx <= r; dx++) {
          if (Math.hypot(dx, dy, dz) > spec.radius) continue;
          const x = cx + dx, y = cy + dy, z = cz + dz;
          const v = g.get(x, y, z);
          if (v === F.EMPTY || v === F.SCAR) continue;

          if (v === F.BONE) {
            // ブラシは骨に当てても安全。終盤の「あと少しで露出」で必ず使いたくなる
            if (spec.bonePenalty > 0) {
              g.set(x, y, z, F.SCAR);
              boneHit++;
            }
            continue;
          }
          if (v === F.HARD && !spec.breaksHard) { hardBlocked = true; continue; }
          // ブラシは表層1層だけ。露出している面しか剥がせない
          if (spec.surfaceOnly && !isExposed(g, x, y, z)) continue;

          g.set(x, y, z, F.EMPTY);
          removed++;
        }

    if (removed > 0 || boneHit > 0) {
      markSkin(g);
      this.dirty = true;
      this.removedRock += removed;
      this.events.onProgress?.(this.removedRock, this.block.rockTotal);
    }

    if (boneHit > 0) {
      this.boneDamage += boneHit * spec.bonePenalty;
      this.events.onBoneHit?.(boneHit * spec.bonePenalty);
      audio.uiError();
      this.debris.burst(world, 0xa8482e, 10, { speed: 1.2, up: 1.4, life: 0.6, size: 0.7 });
    } else if (removed > 0) {
      audio.dig(spec.breaksHard ? 3 : 1.4);
      this.debris.burst(world, spec.breaksHard ? 0x6e6560 : 0x8a7458, Math.min(12, 3 + removed), {
        speed: 1.1, up: 1.5, life: 0.55, size: 0.6,
      });
    } else if (hardBlocked) {
      // 連続ツールを硬岩の上で滑らせている間、毎フレーム鳴らさない
      if (this.blockedAt < performance.now() - 420) {
        this.blockedAt = performance.now();
        audio.uiError();
      }
    }

    this.lastHitPos = world;
    return removed;
  }

  /** 露出した骨の数。進捗表示に使う */
  countExposedBone(): number {
    const g = this.block.grid;
    let n = 0;
    for (let z = 0; z < SIZE.z; z++)
      for (let y = 0; y < SIZE.y; y++)
        for (let x = 0; x < SIZE.x; x++) {
          if (g.get(x, y, z) !== F.BONE) continue;
          if (isExposed(g, x, y, z)) n++;
        }
    return n;
  }

  score(remainTime: number, limitTime: number): CleanScore {
    return scoreClean(this.removedRock, this.block.rockTotal, remainTime, limitTime, this.boneDamage);
  }

  update(dt: number, autoSpin: boolean): void {
    if (this.dirty) {
      this.dirty = false;
      this.rebuild();
    }
    if (autoSpin) this.yaw += this.spin * dt;
    this.root.rotation.set(this.pitch, this.yaw, 0);
    this.debris.update(dt, -1.4);
    // カーソルは常にカメラを向ける
    if (this.cursor.visible) this.cursor.lookAt(this.camera.position);
  }

  resize(aspect: number): void {
    this.camera.aspect = aspect;
    this.camera.fov = aspect < 0.75 ? 50 : 40;
    this.camera.updateProjectionMatrix();
    // 縦画面では作業面が縦長になるので、少し引いて全体を収める
    // 対角がはみ出さない距離。縦画面は水平画角が狭いので更に引く
    this.camera.position.z = aspect < 0.75 ? 2.3 : 1.85;
  }

  hideCursor(): void { this.cursor.visible = false; }
  get lastHit(): THREE.Vector3 | null { return this.lastHitPos; }

  dispose(): void {
    if (this.mesh) { this.root.remove(this.mesh); this.mesh.geometry.dispose(); }
    this.debris.dispose();
    this.material.dispose();
    this.cursor.geometry.dispose();
    (this.cursor.material as THREE.Material).dispose();
  }
}

function isExposed(g: VoxelGrid, x: number, y: number, z: number): boolean {
  return (
    !g.isSolid(x + 1, y, z) || !g.isSolid(x - 1, y, z) ||
    !g.isSolid(x, y + 1, z) || !g.isSolid(x, y - 1, z) ||
    !g.isSolid(x, y, z + 1) || !g.isSolid(x, y, z - 1)
  );
}
