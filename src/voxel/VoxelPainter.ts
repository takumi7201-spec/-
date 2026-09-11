import { VoxelGrid } from './VoxelGrid';

/** 決定論的PRNG（xorshift32）。同じシードなら必ず同じ個体が出る。 */
export class Rng {
  private s: number;
  constructor(seed: number) {
    this.s = (seed >>> 0) || 0x9e3779b9;
  }
  next(): number {
    let x = this.s;
    x ^= x << 13; x >>>= 0;
    x ^= x >>> 17;
    x ^= x << 5; x >>>= 0;
    this.s = x;
    return x / 0xffffffff;
  }
  range(a: number, b: number): number { return a + this.next() * (b - a); }
  int(a: number, b: number): number { return Math.floor(this.range(a, b + 1)); }
  pick<T>(arr: readonly T[]): T { return arr[Math.min(arr.length - 1, Math.floor(this.next() * arr.length))]; }
  chance(p: number): boolean { return this.next() < p; }
}

/** VoxelGrid に立体プリミティブを描くヘルパー群。 */
export class VoxelPainter {
  constructor(readonly grid: VoxelGrid) {}

  box(x0: number, y0: number, z0: number, w: number, h: number, d: number, c: number): void {
    for (let z = z0; z < z0 + d; z++)
      for (let y = y0; y < y0 + h; y++)
        for (let x = x0; x < x0 + w; x++) this.grid.set(x, y, z, c);
  }

  /** 中心と半径で指定する楕円体。体節・頭部・関節に使う。 */
  ellipsoid(cx: number, cy: number, cz: number, rx: number, ry: number, rz: number, c: number): void {
    const x0 = Math.floor(cx - rx), x1 = Math.ceil(cx + rx);
    const y0 = Math.floor(cy - ry), y1 = Math.ceil(cy + ry);
    const z0 = Math.floor(cz - rz), z1 = Math.ceil(cz + rz);
    for (let z = z0; z <= z1; z++) {
      const dz = (z + 0.5 - cz) / Math.max(rz, 1e-4);
      for (let y = y0; y <= y1; y++) {
        const dy = (y + 0.5 - cy) / Math.max(ry, 1e-4);
        for (let x = x0; x <= x1; x++) {
          const dx = (x + 0.5 - cx) / Math.max(rx, 1e-4);
          if (dx * dx + dy * dy + dz * dz <= 1) this.grid.set(x, y, z, c);
        }
      }
    }
  }

  /** 太さが線形に変わる円柱。四肢・首・尾の基本部品。 */
  taperedTube(
    x0: number, y0: number, z0: number,
    x1: number, y1: number, z1: number,
    r0: number, r1: number, c: number,
  ): void {
    const steps = Math.ceil(Math.hypot(x1 - x0, y1 - y0, z1 - z0) * 2) + 1;
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      const r = r0 + (r1 - r0) * t;
      this.ellipsoid(
        x0 + (x1 - x0) * t,
        y0 + (y1 - y0) * t,
        z0 + (z1 - z0) * t,
        r, r, r, c,
      );
    }
  }

  /** Catmull-Rom 的に点列を補間しながら太さを変える。脊椎・尾のカーブ用。 */
  spine(points: [number, number, number][], radii: number[], c: number): void {
    for (let i = 0; i < points.length - 1; i++) {
      const [ax, ay, az] = points[i];
      const [bx, by, bz] = points[i + 1];
      this.taperedTube(ax, ay, az, bx, by, bz, radii[i], radii[i + 1], c);
    }
  }

  /** 左右対称に描く（x = 中心軸で鏡像）。恐竜は必ず左右対称に作る。 */
  mirrorX(center: number, fn: (sign: number) => void): void {
    void center;
    fn(1);
    fn(-1);
  }

  /** 既存ボクセルの表面だけを別色で塗る（模様・鱗の縁取り） */
  shell(color: number, target: number, predicate?: (x: number, y: number, z: number) => boolean): void {
    const g = this.grid;
    const out = g.data.slice();
    for (let z = 0; z < g.sz; z++) {
      for (let y = 0; y < g.sy; y++) {
        for (let x = 0; x < g.sx; x++) {
          const v = g.get(x, y, z);
          if (v !== target) continue;
          const exposed =
            !g.isSolid(x + 1, y, z) || !g.isSolid(x - 1, y, z) ||
            !g.isSolid(x, y + 1, z) || !g.isSolid(x, y - 1, z) ||
            !g.isSolid(x, y, z + 1) || !g.isSolid(x, y, z - 1);
          if (!exposed) continue;
          if (predicate && !predicate(x, y, z)) continue;
          out[g.index(x, y, z)] = color;
        }
      }
    }
    g.data.set(out);
  }

  /** 上面（+Y が空いている面）だけを塗る。背中のライン・雪・苔に。 */
  paintTop(color: number, predicate?: (x: number, y: number, z: number) => boolean): void {
    const g = this.grid;
    for (let z = 0; z < g.sz; z++)
      for (let x = 0; x < g.sx; x++)
        for (let y = g.sy - 1; y >= 0; y--) {
          if (!g.isSolid(x, y, z)) continue;
          if (!predicate || predicate(x, y, z)) g.set(x, y, z, color);
          break;
        }
  }

  /** 置換（模様付け後にベース色を一括変更する用途） */
  replace(from: number, to: number): void {
    const d = this.grid.data;
    for (let i = 0; i < d.length; i++) if (d[i] === from) d[i] = to;
  }
}
