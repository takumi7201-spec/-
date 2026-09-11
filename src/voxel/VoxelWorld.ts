import * as THREE from 'three';
import { VoxelGrid } from './VoxelGrid';
import { greedyMesh } from './greedyMesher';

/**
 * チャンク分割された編集可能ボクセル世界。
 *
 * 掘削のたびに全体を張り直すと数万ボクセル規模で即座に破綻するので、
 * 16^3 のチャンク単位でメッシュを持ち、変更のあったチャンクだけを
 * フレーム予算内で再構築する。
 */

export const CHUNK = 16;

interface Chunk {
  cx: number;
  cy: number;
  cz: number;
  mesh: THREE.Mesh | null;
  solidCount: number;
}

export interface VoxelWorldOptions {
  voxelSize: number;
  material: THREE.Material;
  /** 1フレームあたりの再構築チャンク数上限 */
  rebuildBudget?: number;
}

export class VoxelWorld {
  readonly grid: VoxelGrid;
  readonly group = new THREE.Group();
  readonly voxelSize: number;
  readonly palette: Float32Array;

  private chunks: Chunk[] = [];
  private cxCount: number;
  private cyCount: number;
  private czCount: number;
  private dirty = new Set<number>();
  private material: THREE.Material;
  private rebuildBudget: number;

  constructor(sx: number, sy: number, sz: number, palette: Float32Array, opts: VoxelWorldOptions) {
    this.grid = new VoxelGrid(sx, sy, sz);
    this.palette = palette;
    this.voxelSize = opts.voxelSize;
    this.material = opts.material;
    this.rebuildBudget = opts.rebuildBudget ?? 2;

    this.cxCount = Math.ceil(sx / CHUNK);
    this.cyCount = Math.ceil(sy / CHUNK);
    this.czCount = Math.ceil(sz / CHUNK);

    for (let cz = 0; cz < this.czCount; cz++)
      for (let cy = 0; cy < this.cyCount; cy++)
        for (let cx = 0; cx < this.cxCount; cx++)
          this.chunks.push({ cx, cy, cz, mesh: null, solidCount: 0 });
  }

  private chunkIndex(cx: number, cy: number, cz: number): number {
    return cx + this.cxCount * (cy + this.cyCount * cz);
  }

  /** ボクセル座標 → チャンクを dirty 化。境界なら隣接チャンクも巻き込む */
  markDirtyAt(x: number, y: number, z: number): void {
    const cx = Math.floor(x / CHUNK);
    const cy = Math.floor(y / CHUNK);
    const cz = Math.floor(z / CHUNK);
    for (let dz = -1; dz <= 1; dz++) {
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          // 面境界のAOは隣チャンクのボクセルを参照するため、角も含めて更新する
          const nx = cx + dx, ny = cy + dy, nz = cz + dz;
          if (nx < 0 || ny < 0 || nz < 0) continue;
          if (nx >= this.cxCount || ny >= this.cyCount || nz >= this.czCount) continue;
          const onBoundary =
            (dx !== 0 && (dx < 0 ? x % CHUNK === 0 : x % CHUNK === CHUNK - 1)) ||
            (dy !== 0 && (dy < 0 ? y % CHUNK === 0 : y % CHUNK === CHUNK - 1)) ||
            (dz !== 0 && (dz < 0 ? z % CHUNK === 0 : z % CHUNK === CHUNK - 1));
          if (dx === 0 && dy === 0 && dz === 0) {
            this.dirty.add(this.chunkIndex(nx, ny, nz));
          } else if (onBoundary) {
            this.dirty.add(this.chunkIndex(nx, ny, nz));
          }
        }
      }
    }
  }

  set(x: number, y: number, z: number, v: number): void {
    if (this.grid.get(x, y, z) === v) return;
    this.grid.set(x, y, z, v);
    this.markDirtyAt(x, y, z);
  }

  get(x: number, y: number, z: number): number {
    return this.grid.get(x, y, z);
  }

  /** 初期生成後に一括構築する（dirtyフラグを経由せず全チャンクを即時メッシュ化） */
  buildAll(): void {
    for (let i = 0; i < this.chunks.length; i++) this.rebuildChunk(i);
    this.dirty.clear();
  }

  /** 毎フレーム呼ぶ。予算内でdirtyチャンクを処理する */
  update(): number {
    if (this.dirty.size === 0) return 0;
    let done = 0;
    for (const idx of this.dirty) {
      this.rebuildChunk(idx);
      this.dirty.delete(idx);
      if (++done >= this.rebuildBudget) break;
    }
    return done;
  }

  private rebuildChunk(idx: number): void {
    const c = this.chunks[idx];
    const x0 = c.cx * CHUNK;
    const y0 = c.cy * CHUNK;
    const z0 = c.cz * CHUNK;

    // AOとオクルージョン判定のため1ボクセル分のマージンを付けて切り出す
    const pad = 1;
    const sub = new VoxelGrid(CHUNK + pad * 2, CHUNK + pad * 2, CHUNK + pad * 2);
    let solid = 0;
    for (let z = -pad; z < CHUNK + pad; z++) {
      for (let y = -pad; y < CHUNK + pad; y++) {
        for (let x = -pad; x < CHUNK + pad; x++) {
          const v = this.grid.get(x0 + x, y0 + y, z0 + z);
          sub.set(x + pad, y + pad, z + pad, v);
          if (v !== 0 && x >= 0 && x < CHUNK && y >= 0 && y < CHUNK && z >= 0 && z < CHUNK) solid++;
        }
      }
    }
    c.solidCount = solid;

    if (c.mesh) {
      this.group.remove(c.mesh);
      c.mesh.geometry.dispose();
      c.mesh = null;
    }
    if (solid === 0) return;

    const data = greedyMesh(sub, this.palette, {
      voxelSize: this.voxelSize,
      origin: [
        (x0 - pad) * this.voxelSize,
        (y0 - pad) * this.voxelSize,
        (z0 - pad) * this.voxelSize,
      ],
    });

    // マージン領域の面は隣チャンクが描くので捨てる
    const geo = cropGeometry(data, {
      min: [x0 * this.voxelSize, y0 * this.voxelSize, z0 * this.voxelSize],
      max: [(x0 + CHUNK) * this.voxelSize, (y0 + CHUNK) * this.voxelSize, (z0 + CHUNK) * this.voxelSize],
    });
    if (!geo) return;

    const mesh = new THREE.Mesh(geo, this.material);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.matrixAutoUpdate = false;
    mesh.updateMatrix();
    c.mesh = mesh;
    this.group.add(mesh);
  }

  raycast(origin: THREE.Vector3, dir: THREE.Vector3, maxDist: number): {
    x: number; y: number; z: number; value: number; nx: number; ny: number; nz: number; dist: number;
  } | null {
    return voxelRaycast(this.grid, this.voxelSize, origin, dir, maxDist);
  }

  get chunkCount(): number { return this.chunks.length; }
  get pendingRebuilds(): number { return this.dirty.size; }

  dispose(): void {
    for (const c of this.chunks) {
      if (c.mesh) {
        this.group.remove(c.mesh);
        c.mesh.geometry.dispose();
      }
    }
    this.chunks = [];
  }
}

/** マージン込みでメッシュ化した結果から、チャンク本体に属するquadだけを残す */
function cropGeometry(
  data: ReturnType<typeof greedyMesh>,
  bounds: { min: number[]; max: number[] },
): THREE.BufferGeometry | null {
  const { positions, normals, colors, ao, uvs, indices, quadCount } = data;
  const keepPos: number[] = [];
  const keepNorm: number[] = [];
  const keepCol: number[] = [];
  const keepAo: number[] = [];
  const keepUv: number[] = [];
  const keepIdx: number[] = [];
  const eps = 1e-4;
  let out = 0;

  for (let q = 0; q < quadCount; q++) {
    const base = q * 4;
    // quad中心で判定する。頂点は境界上に乗るのでズレに強い重心を使う
    let cx = 0, cy = 0, cz = 0;
    for (let k = 0; k < 4; k++) {
      cx += positions[(base + k) * 3];
      cy += positions[(base + k) * 3 + 1];
      cz += positions[(base + k) * 3 + 2];
    }
    cx /= 4; cy /= 4; cz /= 4;
    if (
      cx < bounds.min[0] - eps || cx > bounds.max[0] + eps ||
      cy < bounds.min[1] - eps || cy > bounds.max[1] + eps ||
      cz < bounds.min[2] - eps || cz > bounds.max[2] + eps
    ) continue;

    const nb = out * 4;
    for (let k = 0; k < 4; k++) {
      const s = (base + k) * 3;
      keepPos.push(positions[s], positions[s + 1], positions[s + 2]);
      keepNorm.push(normals[s], normals[s + 1], normals[s + 2]);
      keepCol.push(colors[s], colors[s + 1], colors[s + 2]);
      keepAo.push(ao[base + k]);
      keepUv.push(uvs[(base + k) * 2], uvs[(base + k) * 2 + 1]);
    }
    // 元のインデックス（三角形分割の向き）を保ったまま付け替える
    for (let t = 0; t < 6; t++) {
      keepIdx.push(nb + (indices[q * 6 + t] - base));
    }
    out++;
  }

  if (out === 0) return null;

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(keepPos, 3));
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(keepNorm, 3));
  geo.setAttribute('color', new THREE.Float32BufferAttribute(keepCol, 3));
  geo.setAttribute('aAO', new THREE.Float32BufferAttribute(keepAo, 1));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(keepUv, 2));
  geo.setIndex(keepIdx);
  geo.computeBoundingSphere();
  return geo;
}

/** Amanatides-Woo の 3D DDA。掘削・レーダーの視線判定に使う */
export function voxelRaycast(
  grid: VoxelGrid,
  voxelSize: number,
  origin: THREE.Vector3,
  dir: THREE.Vector3,
  maxDist: number,
) {
  const ox = origin.x / voxelSize;
  const oy = origin.y / voxelSize;
  const oz = origin.z / voxelSize;
  let x = Math.floor(ox);
  let y = Math.floor(oy);
  let z = Math.floor(oz);

  const dx = dir.x, dy = dir.y, dz = dir.z;
  const stepX = dx > 0 ? 1 : dx < 0 ? -1 : 0;
  const stepY = dy > 0 ? 1 : dy < 0 ? -1 : 0;
  const stepZ = dz > 0 ? 1 : dz < 0 ? -1 : 0;

  const tDeltaX = stepX !== 0 ? Math.abs(1 / dx) : Infinity;
  const tDeltaY = stepY !== 0 ? Math.abs(1 / dy) : Infinity;
  const tDeltaZ = stepZ !== 0 ? Math.abs(1 / dz) : Infinity;

  let tMaxX = stepX !== 0 ? ((stepX > 0 ? x + 1 - ox : ox - x)) * tDeltaX : Infinity;
  let tMaxY = stepY !== 0 ? ((stepY > 0 ? y + 1 - oy : oy - y)) * tDeltaY : Infinity;
  let tMaxZ = stepZ !== 0 ? ((stepZ > 0 ? z + 1 - oz : oz - z)) * tDeltaZ : Infinity;

  const maxSteps = Math.ceil(maxDist / voxelSize) * 3 + 3;
  let nx = 0, ny = 0, nz = 0;

  for (let i = 0; i < maxSteps; i++) {
    const v = grid.get(x, y, z);
    if (v !== 0) {
      const dist = Math.min(tMaxX, tMaxY, tMaxZ) * voxelSize;
      return { x, y, z, value: v, nx, ny, nz, dist };
    }
    if (tMaxX < tMaxY) {
      if (tMaxX < tMaxZ) { x += stepX; tMaxX += tDeltaX; nx = -stepX; ny = 0; nz = 0; }
      else { z += stepZ; tMaxZ += tDeltaZ; nx = 0; ny = 0; nz = -stepZ; }
    } else {
      if (tMaxY < tMaxZ) { y += stepY; tMaxY += tDeltaY; nx = 0; ny = -stepY; nz = 0; }
      else { z += stepZ; tMaxZ += tDeltaZ; nx = 0; ny = 0; nz = -stepZ; }
    }
    if (Math.min(tMaxX, tMaxY, tMaxZ) * voxelSize > maxDist) break;
  }
  return null;
}
