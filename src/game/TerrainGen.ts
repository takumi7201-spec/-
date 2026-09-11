import { VoxelWorld } from '../voxel/VoxelWorld';
import { T, type Biome } from '../voxel/palette';
import { fbm2, fbm3, ridged2, seedNoise } from '../voxel/Noise';
import { Rng } from '../voxel/VoxelPainter';

export interface FossilNode {
  id: number;
  /** 中心ボクセル座標 */
  cx: number;
  cy: number;
  cz: number;
  radius: number;
  speciesId: string;
  rarity: number;
  /** レーダーで位置を特定済みか */
  revealed: boolean;
  /** 掘り出し完了 */
  collected: boolean;
  /** 露出したボクセル数 / 全ボクセル数 */
  total: number;
  exposed: number;
}

export interface DigSiteData {
  world: VoxelWorld;
  nodes: FossilNode[];
  /** ボクセル座標での地表高マップ */
  heights: Int16Array;
  sizeX: number;
  sizeZ: number;
  sizeY: number;
  spawn: { x: number; z: number };
}

export interface TerrainOptions {
  biome: Biome;
  seed: number;
  /** エリアの一辺（ボクセル数）。voxelSize=0.5 なら 64 で 32m 四方 */
  sizeX?: number;
  sizeZ?: number;
  sizeY?: number;
  fossilCount?: number;
  /** 出現しうる種のプール */
  speciesPool: { id: string; rarity: number; weight: number }[];
  voxelSize: number;
  material: import('three').Material;
}

/**
 * 発掘エリアの地形と埋蔵化石を生成する。
 *
 * サイズは「走って15〜20秒で端から端まで」を基準にした。広すぎると
 * レーダーの探索が移動作業になり、狭すぎると探す楽しみが消える。
 */
export function generateDigSite(opts: TerrainOptions): DigSiteData {
  const sizeX = opts.sizeX ?? 64;
  const sizeZ = opts.sizeZ ?? 64;
  const sizeY = opts.sizeY ?? 32;
  const { biome, seed } = opts;

  seedNoise(seed);
  const rng = new Rng(seed ^ 0x5bf03635);

  const world = new VoxelWorld(sizeX, sizeY, sizeZ, biome.palette, {
    voxelSize: opts.voxelSize,
    material: opts.material,
    rebuildBudget: 3,
  });

  const heights = new Int16Array(sizeX * sizeZ);
  const surfaceBase = Math.floor(sizeY * 0.62);
  const relief = biome.relief;

  // --- 地表高 ---
  for (let z = 0; z < sizeZ; z++) {
    for (let x = 0; x < sizeX; x++) {
      const fx = x / sizeX;
      const fz = z / sizeZ;
      let h = fbm2(fx * 3.2, fz * 3.2, 4) * 5.5 * relief;
      h += ridged2(fx * 1.7 + 11.3, fz * 1.7 - 4.1, 3) * 3.0 * relief;
      // 外周を土手状に持ち上げて、見えない壁なしで境界を示す
      const edge = Math.min(fx, fz, 1 - fx, 1 - fz);
      const rim = edge < 0.12 ? (1 - edge / 0.12) ** 2 * 7 * relief : 0;
      h += rim;
      heights[x + z * sizeX] = Math.max(4, Math.min(sizeY - 3, Math.round(surfaceBase + h)));
    }
  }

  // --- 地層 ---
  const topsoil = biome.id === 'frostpeak' ? T.SAND : biome.id === 'emberfield' ? T.SAND_DARK : T.SAND;
  for (let z = 0; z < sizeZ; z++) {
    for (let x = 0; x < sizeX; x++) {
      const h = heights[x + z * sizeX];
      for (let y = 0; y <= h; y++) {
        const depth = h - y;
        let v: number;
        if (depth === 0) {
          v = topsoil;
        } else if (depth < 2) {
          v = T.SAND_DARK;
        } else if (depth < 5) {
          v = T.DIRT;
        } else if (depth < 9) {
          v = rng.chance(0.22) ? T.GRAVEL : T.CLAY;
        } else {
          const hard = fbm3(x * 0.08, y * 0.11, z * 0.08, 3);
          v = hard > 0.32 - biome.hardness * 0.3 ? T.HARDROCK : T.ROCK;
        }
        world.grid.set(x, y, z, v);
      }
    }
  }

  // --- 植生・苔（上面のみ） ---
  if (biome.id === 'canyon' || biome.id === 'tidehollow') {
    for (let z = 0; z < sizeZ; z++) {
      for (let x = 0; x < sizeX; x++) {
        const h = heights[x + z * sizeX];
        const n = fbm2(x * 0.11 + 31.7, z * 0.11 - 8.3, 3);
        if (n > 0.18) world.grid.set(x, h, z, T.GRASS);
        else if (n > 0.1) world.grid.set(x, h, z, T.MOSS);
      }
    }
  }

  // --- 鉱脈 ---
  const veinCount = 10 + Math.floor(rng.next() * 8);
  for (let i = 0; i < veinCount; i++) {
    const vx = rng.int(4, sizeX - 5);
    const vz = rng.int(4, sizeZ - 5);
    const h = heights[vx + vz * sizeX];
    const vy = rng.int(6, Math.max(7, h - 4));
    const r = rng.range(1.4, 2.8);
    const slot = rng.chance(0.35) ? T.CRYSTAL : T.VEIN;
    for (let dz = -3; dz <= 3; dz++)
      for (let dy = -3; dy <= 3; dy++)
        for (let dx = -3; dx <= 3; dx++) {
          if (dx * dx + dy * dy + dz * dz > r * r) continue;
          if (world.grid.get(vx + dx, vy + dy, vz + dz) === 0) continue;
          world.grid.set(vx + dx, vy + dy, vz + dz, slot);
        }
  }

  // --- 埋蔵化石 ---
  const nodes: FossilNode[] = [];
  const fossilCount = opts.fossilCount ?? 6;
  const minSep = Math.min(sizeX, sizeZ) * 0.16;

  let guard = 0;
  while (nodes.length < fossilCount && guard++ < 400) {
    const margin = 7;
    const cx = rng.int(margin, sizeX - margin - 1);
    const cz = rng.int(margin, sizeZ - margin - 1);
    // 同じ場所に固まるとレーダーが役に立たなくなるので最小間隔を強制する
    if (nodes.some((n) => Math.hypot(n.cx - cx, n.cz - cz) < minSep)) continue;

    const h = heights[cx + cz * sizeX];
    const species = pickWeighted(opts.speciesPool, rng);
    // レアほど深い。浅い＝簡単に掘れる、を素直に難度に紐づける
    const depth = 4 + Math.round(species.rarity * 2.2) + rng.int(0, 3);
    const cy = Math.max(4, h - depth);
    const radius = 2.2 + species.rarity * 0.5;

    const node: FossilNode = {
      id: nodes.length,
      cx, cy, cz, radius,
      speciesId: species.id,
      rarity: species.rarity,
      revealed: false,
      collected: false,
      total: 0,
      exposed: 0,
    };

    // 不定形の塊にする（真球だと「当たり」が見え見えになる）
    const rr = Math.ceil(radius) + 2;
    for (let dz = -rr; dz <= rr; dz++)
      for (let dy = -rr; dy <= rr; dy++)
        for (let dx = -rr; dx <= rr; dx++) {
          const d = Math.hypot(dx, dy * 1.25, dz);
          const warp = fbm3((cx + dx) * 0.25, (cy + dy) * 0.25, (cz + dz) * 0.25, 2) * 1.4;
          if (d + warp > radius) continue;
          const x = cx + dx, y = cy + dy, z = cz + dz;
          if (world.grid.get(x, y, z) === 0) continue;
          world.grid.set(x, y, z, T.FOSSIL);
          node.total++;
        }

    if (node.total > 6) nodes.push(node);
  }

  // --- スポーン地点（中央のなだらかな場所） ---
  const spawn = { x: Math.floor(sizeX / 2), z: Math.floor(sizeZ * 0.12) + 3 };

  world.buildAll();

  return { world, nodes, heights, sizeX, sizeZ, sizeY, spawn };
}

function pickWeighted<T extends { weight: number }>(pool: readonly T[], rng: Rng): T {
  const total = pool.reduce((s, p) => s + p.weight, 0);
  let r = rng.next() * total;
  for (const p of pool) {
    r -= p.weight;
    if (r <= 0) return p;
  }
  return pool[pool.length - 1];
}

/** 掘削の硬さ。硬い岩ほど多く叩く必要がある */
export function hardnessOf(slot: number): number {
  switch (slot) {
    case T.SAND: case T.SAND_DARK: case T.GRASS: case T.MOSS: return 1;
    case T.DIRT: case T.CLAY: case T.GRAVEL: return 1.6;
    case T.ROCK: return 3.0;
    case T.HARDROCK: return 5.0;
    case T.CRYSTAL: case T.VEIN: return 3.6;
    case T.FOSSIL: return 99; // 化石は掘削では壊せない（誤爆防止）
    default: return 1;
  }
}
