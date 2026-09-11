import { VoxelGrid } from './VoxelGrid';

/**
 * 頂点AO付き Greedy Meshing。
 *
 * 素朴なキューブ生成だとボクセル1個あたり最大12三角形＋24頂点になり、
 * 数万ボクセル規模でスマホが即死する。ここでは
 *   1) 露出面だけを抽出し
 *   2) 「色が同じ かつ 4頂点のAOが同じ」面だけを矩形に結合する
 * ことで、平坦な地面や恐竜の胴体が1〜数枚のquadに畳まれる。
 *
 * AOをマージ条件に含めるのが肝で、これを省くと陰影が階段状に割れる。
 */

export interface VoxelMeshData {
  positions: Float32Array;
  normals: Float32Array;
  colors: Float32Array;
  /** 頂点AO（0=最も暗い隅, 1=遮蔽なし） */
  ao: Float32Array;
  /** quadローカルUV。(0,0)-(w,h) なのでフラクショナル部でボクセル格子線が引ける */
  uvs: Float32Array;
  indices: Uint32Array;
  quadCount: number;
}

export interface MeshOptions {
  /** ボクセル1辺のワールドサイズ */
  voxelSize?: number;
  /** グリッド原点のワールドオフセット */
  origin?: [number, number, number];
  /** AOの強さ 0..1。0でAO無効 */
  aoStrength?: number;
}

const AO_LUT = [0.48, 0.7, 0.86, 1.0];

/** 標準的な頂点AO: 両サイドが埋まっていれば角は見えないので最暗値。 */
function aoLevel(s1: boolean, s2: boolean, c: boolean): number {
  if (s1 && s2) return 0;
  return 3 - ((s1 ? 1 : 0) + (s2 ? 1 : 0) + (c ? 1 : 0));
}

export function greedyMesh(
  grid: VoxelGrid,
  palette: Float32Array,
  opts: MeshOptions = {},
): VoxelMeshData {
  const voxelSize = opts.voxelSize ?? 1;
  const origin = opts.origin ?? [0, 0, 0];
  const aoStrength = opts.aoStrength ?? 1;

  const dims = [grid.sx, grid.sy, grid.sz];

  const positions: number[] = [];
  const normals: number[] = [];
  const colors: number[] = [];
  const aos: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];
  let quadCount = 0;

  const x = [0, 0, 0];
  const q = [0, 0, 0];
  const du = [0, 0, 0];
  const dv = [0, 0, 0];
  const aoTmp = [0, 0, 0, 0];

  for (let d = 0; d < 3; d++) {
    const u = (d + 1) % 3;
    const v = (d + 2) % 3;
    const maskW = dims[u];
    const maskH = dims[v];
    const mask = new Int32Array(maskW * maskH);

    q[0] = 0; q[1] = 0; q[2] = 0;
    q[d] = 1;

    // 面の外側セルから見た u/v 軸の単位ベクトル
    const ua = [0, 0, 0]; ua[u] = 1;
    const va = [0, 0, 0]; va[v] = 1;

    for (x[d] = -1; x[d] < dims[d];) {
      // --- マスク構築: 露出面を (色 + 4頂点AO) としてパック ---
      let n = 0;
      for (x[v] = 0; x[v] < dims[v]; x[v]++) {
        for (x[u] = 0; x[u] < dims[u]; x[u]++, n++) {
          const a = x[d] >= 0 ? grid.get(x[0], x[1], x[2]) : 0;
          const b =
            x[d] < dims[d] - 1 ? grid.get(x[0] + q[0], x[1] + q[1], x[2] + q[2]) : 0;

          if ((a !== 0) === (b !== 0)) {
            mask[n] = 0;
            continue;
          }

          const positive = a !== 0;
          const color = positive ? a : b;
          // 面の外側（空気側）セル
          const ox = positive ? x[0] + q[0] : x[0];
          const oy = positive ? x[1] + q[1] : x[1];
          const oz = positive ? x[2] + q[2] : x[2];

          let packed = color;
          for (let corner = 0; corner < 4; corner++) {
            const cu = corner === 1 || corner === 2 ? 1 : -1;
            const cv = corner >= 2 ? 1 : -1;
            const s1 = grid.isSolid(ox + ua[0] * cu, oy + ua[1] * cu, oz + ua[2] * cu);
            const s2 = grid.isSolid(ox + va[0] * cv, oy + va[1] * cv, oz + va[2] * cv);
            const cc = grid.isSolid(
              ox + ua[0] * cu + va[0] * cv,
              oy + ua[1] * cu + va[1] * cv,
              oz + ua[2] * cu + va[2] * cv,
            );
            packed |= aoLevel(s1, s2, cc) << (8 + corner * 2);
          }
          mask[n] = positive ? packed : -packed;
        }
      }

      x[d]++;

      // --- Greedy 矩形化 ---
      n = 0;
      for (let j = 0; j < maskH; j++) {
        for (let i = 0; i < maskW;) {
          const m = mask[n];
          if (m === 0) { i++; n++; continue; }

          // 横方向に伸ばす
          let w = 1;
          while (i + w < maskW && mask[n + w] === m) w++;

          // 縦方向に伸ばす（行全体が一致する場合のみ）
          let h = 1;
          outer: for (; j + h < maskH; h++) {
            for (let k = 0; k < w; k++) {
              if (mask[n + k + h * maskW] !== m) break outer;
            }
          }

          const positive = m > 0;
          const packed = positive ? m : -m;
          const color = packed & 0xff;
          aoTmp[0] = (packed >> 8) & 3;
          aoTmp[1] = (packed >> 10) & 3;
          aoTmp[2] = (packed >> 12) & 3;
          aoTmp[3] = (packed >> 14) & 3;

          x[u] = i; x[v] = j;
          du[0] = 0; du[1] = 0; du[2] = 0; du[u] = w;
          dv[0] = 0; dv[1] = 0; dv[2] = 0; dv[v] = h;

          const base = quadCount * 4;
          const px = origin[0] + x[0] * voxelSize;
          const py = origin[1] + x[1] * voxelSize;
          const pz = origin[2] + x[2] * voxelSize;
          const dux = du[0] * voxelSize, duy = du[1] * voxelSize, duz = du[2] * voxelSize;
          const dvx = dv[0] * voxelSize, dvy = dv[1] * voxelSize, dvz = dv[2] * voxelSize;

          positions.push(
            px, py, pz,
            px + dux, py + duy, pz + duz,
            px + dux + dvx, py + duy + dvy, pz + duz + dvz,
            px + dvx, py + dvy, pz + dvz,
          );

          const ns = positive ? 1 : -1;
          for (let k = 0; k < 4; k++) {
            normals.push(q[0] * ns, q[1] * ns, q[2] * ns);
          }

          const ci = color * 3;
          const cr = palette[ci], cg = palette[ci + 1], cb = palette[ci + 2];
          for (let k = 0; k < 4; k++) colors.push(cr, cg, cb);

          for (let k = 0; k < 4; k++) {
            const lit = AO_LUT[aoTmp[k]];
            aos.push(1 - (1 - lit) * aoStrength);
          }

          uvs.push(0, 0, w, 0, w, h, 0, h);

          // AO異方性対策: 対角の暗さが偏る側で三角形を分割する
          const flip = aoTmp[0] + aoTmp[2] > aoTmp[1] + aoTmp[3];
          if (positive) {
            if (flip) indices.push(base + 1, base + 2, base + 3, base + 1, base + 3, base + 0);
            else indices.push(base + 0, base + 1, base + 2, base + 0, base + 2, base + 3);
          } else {
            if (flip) indices.push(base + 1, base + 3, base + 2, base + 1, base + 0, base + 3);
            else indices.push(base + 0, base + 2, base + 1, base + 0, base + 3, base + 2);
          }

          quadCount++;

          // 消し込み
          for (let l = 0; l < h; l++) {
            for (let k = 0; k < w; k++) mask[n + k + l * maskW] = 0;
          }
          i += w;
          n += w;
        }
      }
    }
  }

  return {
    positions: new Float32Array(positions),
    normals: new Float32Array(normals),
    colors: new Float32Array(colors),
    ao: new Float32Array(aos),
    uvs: new Float32Array(uvs),
    indices: new Uint32Array(indices),
    quadCount,
  };
}
