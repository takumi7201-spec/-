/**
 * 3Dボクセルグリッド。
 * 1ボクセル = 1バイトのパレットインデックス（0 = 空）。
 * 地形チャンク・恐竜モデル双方の共通コンテナ。
 */
export class VoxelGrid {
  readonly sx: number;
  readonly sy: number;
  readonly sz: number;
  readonly data: Uint8Array;

  constructor(sx: number, sy: number, sz: number, data?: Uint8Array) {
    this.sx = sx;
    this.sy = sy;
    this.sz = sz;
    this.data = data ?? new Uint8Array(sx * sy * sz);
  }

  /** 範囲外は 0（空）を返す。メッシャーの境界判定をブランチレスに保つため。 */
  get(x: number, y: number, z: number): number {
    if (x < 0 || y < 0 || z < 0 || x >= this.sx || y >= this.sy || z >= this.sz) return 0;
    return this.data[x + this.sx * (y + this.sy * z)];
  }

  set(x: number, y: number, z: number, v: number): void {
    if (x < 0 || y < 0 || z < 0 || x >= this.sx || y >= this.sy || z >= this.sz) return;
    this.data[x + this.sx * (y + this.sy * z)] = v;
  }

  index(x: number, y: number, z: number): number {
    return x + this.sx * (y + this.sy * z);
  }

  isSolid(x: number, y: number, z: number): boolean {
    return this.get(x, y, z) !== 0;
  }

  fill(v: number): void {
    this.data.fill(v);
  }

  clone(): VoxelGrid {
    return new VoxelGrid(this.sx, this.sy, this.sz, this.data.slice());
  }

  /** 実体のあるボクセル数。空チャンクの早期スキップ用。 */
  countSolid(): number {
    let n = 0;
    for (let i = 0; i < this.data.length; i++) if (this.data[i] !== 0) n++;
    return n;
  }

  /** 占有範囲の AABB（min/max はボクセル座標・max は inclusive）。空なら null。 */
  bounds(): { min: [number, number, number]; max: [number, number, number] } | null {
    let minX = Infinity, minY = Infinity, minZ = Infinity;
    let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
    for (let z = 0; z < this.sz; z++) {
      for (let y = 0; y < this.sy; y++) {
        for (let x = 0; x < this.sx; x++) {
          if (this.data[x + this.sx * (y + this.sy * z)] === 0) continue;
          if (x < minX) minX = x; if (x > maxX) maxX = x;
          if (y < minY) minY = y; if (y > maxY) maxY = y;
          if (z < minZ) minZ = z; if (z > maxZ) maxZ = z;
        }
      }
    }
    if (minX === Infinity) return null;
    return { min: [minX, minY, minZ], max: [maxX, maxY, maxZ] };
  }
}
