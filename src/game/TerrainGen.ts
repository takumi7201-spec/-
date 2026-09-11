import type * as THREE from 'three';
import { VoxelWorld } from '../voxel/VoxelWorld';
import { T, type Biome } from '../voxel/palette';
import { fbm2, fbm3, ridged2, seedNoise } from '../voxel/Noise';
import { Rng } from '../voxel/VoxelPainter';

/**
 * 発掘エリアの地形と埋蔵物を生成する。
 *
 * サイズは 40m 四方。30m だとエコー（半径8m）2〜3発で全域を覆えてしまい
 * 探索の意思決定が消え、60m だと1体あたりの移動が45秒を超えて
 * 5分ループが壊れる。40m は「エコーを4〜6発撃たないと覆えない」最小サイズ。
 *
 * ボクセルは 0.3125m。実測で 0.25m だとドローコールが 236 に達して
 * スマホ目標（≤120）を超えたため、体験を変えずに解像度だけ落としている。
 */

export const VOXEL_SIZE = 0.3125;
export const AREA_VOX = 128;
export const AREA_HEIGHT_VOX = 40;
/** 40m */
export const AREA_METERS = AREA_VOX * VOXEL_SIZE;

export type FindKind = 'fossil' | 'mineral';

export interface BuriedNode {
  id: number;
  kind: FindKind;
  /** 中心ボクセル座標 */
  cx: number;
  cy: number;
  cz: number;
  radius: number;
  /** fossil のみ */
  speciesId: string;
  rarity: 1 | 2 | 3 | 4;
  /** エコーで位置が判明済みか */
  revealed: boolean;
  collected: boolean;
  /** 地表からの深さ（メートル）。掘るまでプレイヤーには見せない */
  depth: number;
  total: number;
  exposed: number;
}

export interface DigSiteData {
  world: VoxelWorld;
  nodes: BuriedNode[];
  heights: Int16Array;
  spawn: { x: number; z: number };
  /** ワールド座標でのエリア中心 */
  center: THREE.Vector3Like;
}

export interface SpeciesEntry {
  id: string;
  rarity: 1 | 2 | 3 | 4;
  weight: number;
}

export interface TerrainOptions {
  biome: Biome;
  seed: number;
  speciesPool: SpeciesEntry[];
  material: THREE.Material;
  /** 当日周回数によるレア出現率の倍率 */
  rarityScale?: number;
  fossilCount?: number;
  mineralCount?: number;
}

const SURFACE_Y = 16;

export function generateDigSite(opts: TerrainOptions): DigSiteData {
  const { biome, seed } = opts;
  const sx = AREA_VOX, sz = AREA_VOX, sy = AREA_HEIGHT_VOX;
  seedNoise(seed);
  const rng = new Rng(seed ^ 0x5bf03635);

  const world = new VoxelWorld(sx, sy, sz, biome.palette, {
    voxelSize: VOXEL_SIZE,
    material: opts.material,
    rebuildBudget: 2,
  });

  // --- 地表高 ---
  // 平坦な砂原は「タイル床」にしか見えない。地層を視覚化するには崖が要る。
  // 大きなうねり＋尾根に段丘（メサ）を重ね、垂直面に断面を露出させる。
  const heights = new Int16Array(sx * sz);
  for (let z = 0; z < sz; z++) {
    for (let x = 0; x < sx; x++) {
      const fx = x / sx, fz = z / sz;
      let hh = fbm2(fx * 2.6, fz * 2.6, 4) * 9.5 * biome.relief;
      hh += ridged2(fx * 1.6 + 11.3, fz * 1.6 - 4.1, 4) * 7.0 * biome.relief;
      hh += fbm2(fx * 7.5 + 3.1, fz * 7.5 - 2.2, 2) * 1.6;

      // 段丘化。量子化する場所自体をノイズで選び、全面が階段にならないようにする
      const terrace = fbm2(fx * 1.4 + 40.2, fz * 1.4 - 17.5, 2);
      if (terrace > 0.02) {
        const step = 2 + Math.round(terrace * 2);
        const k = Math.min(1, (terrace - 0.02) * 5);
        hh = hh * (1 - k) + Math.round(hh / step) * step * k;
      }

      // 外周を土手状に持ち上げる。見えない壁を置かずに境界を伝える
      const edge = Math.min(fx, fz, 1 - fx, 1 - fz);
      if (edge < 0.12) hh += (1 - edge / 0.12) ** 2 * 13 * biome.relief;

      heights[x + z * sx] = Math.max(6, Math.min(sy - 3, Math.round(SURFACE_Y + hh)));
    }
  }

  // --- 地層 ---
  const topsoil = biome.id === 'emberfield' ? T.SAND_DARK : T.SAND;
  const hAt = (x: number, z: number): number =>
    heights[Math.max(0, Math.min(sx - 1, x)) + Math.max(0, Math.min(sz - 1, z)) * sx];

  for (let z = 0; z < sz; z++) {
    for (let x = 0; x < sx; x++) {
      const h = heights[x + z * sx];
      // 周囲との高低差。大きいほど「崖」なので上面にも岩を出す
      const drop = Math.max(
        h - hAt(x + 1, z), h - hAt(x - 1, z),
        h - hAt(x, z + 1), h - hAt(x, z - 1),
      );
      for (let y = 0; y <= h; y++) {
        const depth = h - y;
        let v: number;
        if (depth === 0) {
          v = drop >= 3 ? T.ROCK : drop === 2 ? T.GRAVEL : topsoil;
        } else if (depth < 2) v = drop >= 3 ? T.ROCK : T.SAND_DARK;
        else if (depth < 5) v = T.DIRT;
        else if (depth < 9) v = rng.chance(0.25) ? T.GRAVEL : T.CLAY;
        else {
          const hard = fbm3(x * 0.09, y * 0.12, z * 0.09, 3);
          v = hard > 0.3 - biome.hardness * 0.3 ? T.HARDROCK : T.ROCK;
        }
        world.grid.set(x, y, z, v);
      }
    }
  }

  // --- 植生 ---
  if (biome.id === 'canyon' || biome.id === 'tidehollow') {
    for (let z = 0; z < sz; z++) {
      for (let x = 0; x < sx; x++) {
        const h = heights[x + z * sx];
        if (world.grid.get(x, h, z) === T.ROCK) continue; // 崖の上には生えない
        const n = fbm2(x * 0.035 + 31.7, z * 0.035 - 8.3, 3);
        const fine = fbm2(x * 0.22 + 5.5, z * 0.22 + 9.1, 2);
        if (n > 0.16) world.grid.set(x, h, z, fine > 0 ? T.GRASS : T.MOSS);
      }
    }
  }

  // --- 埋蔵物 ---
  // ポアソンディスク（最小7m）。エコー半径8mの円1つに2点入りにくい距離で、
  // 「1回のエコーにつき当たり1つ」を保つ
  const minSepVox = 7 / VOXEL_SIZE;
  const marginVox = Math.ceil(3 / VOXEL_SIZE);
  const nodes: BuriedNode[] = [];
  const fossilCount = opts.fossilCount ?? 5;
  const mineralCount = opts.mineralCount ?? 3;
  const rarityScale = opts.rarityScale ?? 1;

  const placeAt = (): { x: number; z: number } | null => {
    for (let tries = 0; tries < 120; tries++) {
      const x = rng.int(marginVox, sx - marginVox - 1);
      const z = rng.int(marginVox, sz - marginVox - 1);
      if (nodes.some((n) => Math.hypot(n.cx - x, n.cz - z) < minSepVox)) continue;
      return { x, z };
    }
    return null;
  };

  for (let i = 0; i < fossilCount; i++) {
    const pos = placeAt();
    if (!pos) break;
    const rarity = rollRarity(rng, rarityScale);
    const species = pickByRarity(opts.speciesPool, rarity, rng);
    // 深いほどレア。深度は掘るまで見せないので「もう一掘り」の動機になる
    const depthM = depthForRarity(rarity, rng);
    const h = heights[pos.x + pos.z * sx];
    const cy = Math.max(4, h - Math.round(depthM / VOXEL_SIZE));
    const node = makeNode(nodes.length, 'fossil', pos.x, cy, pos.z, 2.0 + rarity * 0.35, species.id, rarity, depthM);
    if (stamp(world, node, heights, sx)) nodes.push(node);
  }

  // レア以上が1点も出なかったら最深の1点を昇格させる（体感の下振れを潰す）
  if (nodes.length > 0 && !nodes.some((n) => n.rarity >= 2)) {
    const deepest = nodes.slice().sort((a, b) => b.depth - a.depth)[0];
    deepest.rarity = 2;
    const alt = pickByRarity(opts.speciesPool, 2, rng);
    deepest.speciesId = alt.id;
  }

  for (let i = 0; i < mineralCount; i++) {
    const pos = placeAt();
    if (!pos) break;
    const h = heights[pos.x + pos.z * sx];
    const cy = Math.max(4, h - rng.int(3, 8));
    const node = makeNode(nodes.length, 'mineral', pos.x, cy, pos.z, 1.8, '', 1, (h - cy) * VOXEL_SIZE);
    if (stamp(world, node, heights, sx)) nodes.push(node);
  }

  // --- 鉱脈（拾えない装飾。地層に情報量を与える）---
  for (let i = 0; i < 12; i++) {
    const vx = rng.int(4, sx - 5);
    const vz = rng.int(4, sz - 5);
    const h = heights[vx + vz * sx];
    const vy = rng.int(6, Math.max(7, h - 4));
    const r = rng.range(1.4, 2.6);
    const slot = rng.chance(0.35) ? T.CRYSTAL : T.VEIN;
    for (let dz = -3; dz <= 3; dz++)
      for (let dy = -3; dy <= 3; dy++)
        for (let dx = -3; dx <= 3; dx++) {
          if (dx * dx + dy * dy + dz * dz > r * r) continue;
          const v = world.grid.get(vx + dx, vy + dy, vz + dz);
          if (v === 0 || v === T.FOSSIL || v === T.ACCENT) continue;
          world.grid.set(vx + dx, vy + dy, vz + dz, slot);
        }
  }

  const spawn = { x: Math.floor(sx / 2), z: Math.floor(sz * 0.14) };
  world.buildAll();

  return {
    world,
    nodes,
    heights,
    spawn,
    center: { x: (sx * VOXEL_SIZE) / 2, y: SURFACE_Y * VOXEL_SIZE, z: (sz * VOXEL_SIZE) / 2 },
  };
}

function makeNode(
  id: number, kind: FindKind, cx: number, cy: number, cz: number,
  radius: number, speciesId: string, rarity: 1 | 2 | 3 | 4, depth: number,
): BuriedNode {
  return { id, kind, cx, cy, cz, radius, speciesId, rarity, revealed: false, collected: false, depth, total: 0, exposed: 0 };
}

/** 不定形の塊として地層に埋める。真球だと掘った瞬間に当たりが見え見えになる */
function stamp(world: VoxelWorld, node: BuriedNode, heights: Int16Array, sx: number): boolean {
  const slot = node.kind === 'fossil' ? T.FOSSIL : T.CRYSTAL;
  const rr = Math.ceil(node.radius) + 2;
  for (let dz = -rr; dz <= rr; dz++)
    for (let dy = -rr; dy <= rr; dy++)
      for (let dx = -rr; dx <= rr; dx++) {
        const d = Math.hypot(dx, dy * 1.3, dz);
        const warp = fbm3((node.cx + dx) * 0.3, (node.cy + dy) * 0.3, (node.cz + dz) * 0.3, 2) * 1.3;
        if (d + warp > node.radius) continue;
        const x = node.cx + dx, y = node.cy + dy, z = node.cz + dz;
        if (world.grid.get(x, y, z) === 0) continue;
        // 地表に露出させない。掘って初めて見えるのが原則
        if (y >= heights[x + z * sx]) continue;
        world.grid.set(x, y, z, slot);
        node.total++;
      }
  return node.total > 5;
}

/** コモン60 / レア30 / エピック9 / レジェンド1。周回数で上位だけが逓減する */
function rollRarity(rng: Rng, scale: number): 1 | 2 | 3 | 4 {
  const r = rng.next();
  const legend = 0.01 * scale;
  const epic = 0.09 * scale;
  const rare = 0.3 * scale;
  if (r < legend) return 4;
  if (r < legend + epic) return 3;
  if (r < legend + epic + rare) return 2;
  return 1;
}

function depthForRarity(rarity: number, rng: Rng): number {
  switch (rarity) {
    case 4: case 3: return rng.range(2.2, 3.0);
    case 2: return rng.range(1.2, 2.2);
    default: return rng.range(0.5, 1.2);
  }
}

function pickByRarity(pool: SpeciesEntry[], rarity: number, rng: Rng): SpeciesEntry {
  const exact = pool.filter((p) => p.rarity === rarity);
  const list = exact.length > 0 ? exact : pool.filter((p) => p.rarity <= rarity);
  const use = list.length > 0 ? list : pool;
  const total = use.reduce((s, p) => s + p.weight, 0);
  let r = rng.next() * total;
  for (const p of use) {
    r -= p.weight;
    if (r <= 0) return p;
  }
  return use[use.length - 1];
}

/** 掘削の硬さ。硬い岩ほど多く叩く必要がある */
export function hardnessOf(slot: number): number {
  switch (slot) {
    case T.SAND: case T.SAND_DARK: case T.GRASS: case T.MOSS: return 1;
    case T.DIRT: case T.CLAY: case T.GRAVEL: return 1.5;
    case T.ROCK: return 2.6;
    case T.HARDROCK: return 4.0;
    case T.VEIN: return 3.0;
    case T.CRYSTAL: return 2.2;
    case T.FOSSIL: return 99; // 掘削では壊せない。誤爆で化石を割らせない
    default: return 1;
  }
}
