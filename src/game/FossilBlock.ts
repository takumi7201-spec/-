import { VoxelGrid } from '../voxel/VoxelGrid';
import { Rng } from '../voxel/VoxelPainter';
import { buildCreature, extractFossil, SLOT as CSLOT } from '../voxel/CreatureBuilder';
import { fbm3, seedNoise } from '../voxel/Noise';
import { getRevos } from './data/revos';

/**
 * 精錬（クリーニング）の対象になる化石ブロック。
 *
 * 骨の形はリヴォスの本体データから取り出す。同じデータから
 * 「復元後の姿」と「発掘対象」の両方が出るので、図鑑の完成形と
 * 掘り出した化石が必ず一致する。
 */

export const F = {
  EMPTY: 0,
  HARD: 1,
  SOFT: 2,
  /** 骨に隣接する軟岩。「あと一枚で露出する」ことを色で伝える */
  SKIN: 3,
  BONE: 4,
  /** 削ってしまった骨。傷として残す */
  SCAR: 5,
} as const;

export const SIZE = { x: 16, y: 16, z: 10 };

export interface FossilBlock {
  grid: VoxelGrid;
  defId: string;
  rarity: number;
  boneTotal: number;
  rockTotal: number;
}

/** 骨のボクセル群を 18×18×14 のブロックに収まるよう縮約する */
function fitBones(parts: Map<string, VoxelGrid>, seed: number): VoxelGrid {
  const out = new VoxelGrid(SIZE.x, SIZE.y, SIZE.z);
  const rng = new Rng(seed);

  // 頭部を主役にする。種の識別はシルエットで付くし、
  // 頭骨は「化石らしさ」が最も強い部位でもある
  const order = ['head', 'neck', 'body', 'tail0', 'legFL', 'legL'];
  const picked: VoxelGrid[] = [];
  for (const name of order) {
    const g = parts.get(name);
    if (g && g.countSolid() > 10) picked.push(g);
    if (picked.length >= 2) break;
  }
  if (picked.length === 0) {
    for (const g of parts.values()) { if (g.countSolid() > 0) { picked.push(g); break; } }
  }

  // 最大のパーツを中央に、残りを周囲に散らす
  picked.sort((a, b) => b.countSolid() - a.countSolid());
  picked.slice(0, 2).forEach((src, idx) => {
    const b = src.bounds();
    if (!b) return;
    const sw = b.max[0] - b.min[0] + 1;
    const sh = b.max[1] - b.min[1] + 1;
    const sd = b.max[2] - b.min[2] + 1;
    // 収まるように間引く
    const step = Math.max(1, Math.ceil(Math.max(sw / 11, sh / 11, sd / 7)));
    const ox = idx === 0 ? Math.floor((SIZE.x - sw / step) / 2) : rng.int(2, SIZE.x - 5);
    const oy = idx === 0 ? Math.floor((SIZE.y - sh / step) / 2) : rng.int(2, SIZE.y - 5);
    const oz = idx === 0 ? Math.floor((SIZE.z - sd / step) / 2) : rng.int(2, SIZE.z - 4);

    for (let z = b.min[2]; z <= b.max[2]; z += step)
      for (let y = b.min[1]; y <= b.max[1]; y += step)
        for (let x = b.min[0]; x <= b.max[0]; x += step) {
          if (!src.isSolid(x, y, z)) continue;
          out.set(
            ox + Math.floor((x - b.min[0]) / step),
            oy + Math.floor((y - b.min[1]) / step),
            oz + Math.floor((z - b.min[2]) / step),
            F.BONE,
          );
        }
  });
  return out;
}

export function buildFossilBlock(defId: string, rarity: number, seed: number): FossilBlock {
  const def = getRevos(defId);
  const model = buildCreature({
    archetype: def.build.archetype,
    seed: def.build.seed,
    bulk: def.build.bulk,
    scale: def.build.scale,
    horns: def.build.horns,
    sail: def.build.sail,
    crest: def.build.crest,
    spikes: def.build.spikes,
  });
  const bones = extractFossil(model);
  // extractFossil は ACCENT スロットで返すので BONE に読み替える
  for (const g of bones.values()) {
    for (let i = 0; i < g.data.length; i++) if (g.data[i] === CSLOT.ACCENT) g.data[i] = F.BONE;
  }

  const grid = fitBones(bones, seed);
  seedNoise(seed ^ 0x1234);
  const rng = new Rng(seed ^ 0x77);

  // 骨の周囲を岩で埋める。レアほど硬い岩の割合が高い
  const hardBias = 0.18 + rarity * 0.1;
  let boneTotal = 0;
  let rockTotal = 0;
  for (let z = 0; z < SIZE.z; z++) {
    for (let y = 0; y < SIZE.y; y++) {
      for (let x = 0; x < SIZE.x; x++) {
        if (grid.get(x, y, z) === F.BONE) { boneTotal++; continue; }
        // 外周は必ず岩。ブロックの輪郭を直方体に保つ
        const n = fbm3(x * 0.3, y * 0.3, z * 0.3, 3);
        const hard = n > 0.34 - hardBias && rng.chance(0.85);
        grid.set(x, y, z, hard ? F.HARD : F.SOFT);
        rockTotal++;
      }
    }
  }

  // 角を落として母岩らしい塊にする。完全な直方体は「ブロック」に見えてしまう
  const cx = SIZE.x / 2, cy = SIZE.y / 2, cz = SIZE.z / 2;
  for (let z = 0; z < SIZE.z; z++)
    for (let y = 0; y < SIZE.y; y++)
      for (let x = 0; x < SIZE.x; x++) {
        const v = grid.get(x, y, z);
        if (v === F.EMPTY || v === F.BONE) continue;
        const nx = (x + 0.5 - cx) / cx, ny = (y + 0.5 - cy) / cy, nz = (z + 0.5 - cz) / cz;
        const d = Math.hypot(nx, ny, nz * 0.92);
        const warp = fbm3(x * 0.26, y * 0.26, z * 0.26, 2) * 0.34;
        if (d + warp > 1.12) { grid.set(x, y, z, F.EMPTY); rockTotal--; }
      }

  markSkin(grid);
  return { grid, defId, rarity, boneTotal, rockTotal };
}

/** 骨に接する軟岩を SKIN に変える。露出間近を色で伝えるための層 */
export function markSkin(grid: VoxelGrid): void {
  for (let z = 0; z < grid.sz; z++)
    for (let y = 0; y < grid.sy; y++)
      for (let x = 0; x < grid.sx; x++) {
        const v = grid.get(x, y, z);
        if (v !== F.SOFT && v !== F.SKIN) continue;
        const touching =
          grid.get(x + 1, y, z) === F.BONE || grid.get(x - 1, y, z) === F.BONE ||
          grid.get(x, y + 1, z) === F.BONE || grid.get(x, y - 1, z) === F.BONE ||
          grid.get(x, y, z + 1) === F.BONE || grid.get(x, y, z - 1) === F.BONE;
        grid.set(x, y, z, touching ? F.SKIN : F.SOFT);
      }
}

export interface CleanScore {
  /** 0-100 */
  clean: number;
  rank: 'S' | 'A' | 'B' | 'C' | 'D';
  rockRatio: number;
  timeRatio: number;
  boneDamage: number;
}

/**
 * C = clamp(88·Rrock + 12·Rtime − 2.5·Dbone, 0, 100)
 *
 * 満点は「岩100%除去・骨無傷・時間の大半を残す」でのみ到達する。
 * 上限は意図的に厳しい。
 */
export function scoreClean(
  removedRock: number, rockTotal: number,
  remainTime: number, limitTime: number,
  boneDamage: number,
): CleanScore {
  const rockRatio = rockTotal > 0 ? Math.min(1, removedRock / rockTotal) : 1;
  const timeRatio = limitTime > 0 ? Math.max(0, Math.min(1, remainTime / limitTime)) : 0;
  const raw = 88 * rockRatio + 12 * timeRatio - 2.5 * boneDamage;
  const clean = Math.max(0, Math.min(100, Math.round(raw)));
  const rank = clean >= 95 ? 'S' : clean >= 85 ? 'A' : clean >= 70 ? 'B' : clean >= 50 ? 'C' : 'D';
  return { clean, rank, rockRatio, timeRatio, boneDamage };
}

/** クリーン度 → HP/ATK/DEF の倍率。SPD には掛けない */
export function cleanMultiplier(clean: number): number {
  return 0.88 + 0.0024 * clean;
}
