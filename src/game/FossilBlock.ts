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
  /**
   * 骨を覆っている岩。grid と同じ並びで 1 が立つ。
   *
   * 仕上がりを数えるのはこれだけ。母岩を最後の一粒まで砕く作業ではなく、
   * 「骨の上に載っているぶんを退ける」作業にする——16×16×10 の塊は
   * 1800 粒あり、骨は 30〜130 粒しかない。全部削らせると、作業の9割は
   * 化石と関係のない岩を叩いている時間になる。
   */
  cover: Uint8Array;
  coverTotal: number;
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

  // 骨の周囲を岩で埋める。レアほど硬い岩の割合が高い。
  // 上限を置かないと ★5 で母岩がほぼ全部硬岩になり、削る計画が立たなくなる
  const hardBias = Math.min(0.62, 0.18 + rarity * 0.1);
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
  const { cover, coverTotal } = markCover(grid);
  return { grid, defId, rarity, boneTotal, rockTotal, cover, coverTotal };
}

/**
 * 骨の真上・真横・真下に載っている岩に印を付ける。
 *
 * 骨の粒ごとに6方向へ外まで線を引き、通り道の岩を拾う。骨の裏に回り込んだ
 * ぶんも拾うので、どの面から覗いても化石が見える状態が「削り終わり」になる。
 * 別の骨に当たったらそこで止める——奥の骨のために、手前の骨を削る形にはしない。
 */
function markCover(grid: VoxelGrid): { cover: Uint8Array; coverTotal: number } {
  const cover = new Uint8Array(SIZE.x * SIZE.y * SIZE.z);
  const at = (x: number, y: number, z: number): number => (z * SIZE.y + y) * SIZE.x + x;
  const dirs: [number, number, number][] = [
    [1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1],
  ];
  let total = 0;
  for (let z = 0; z < SIZE.z; z++)
    for (let y = 0; y < SIZE.y; y++)
      for (let x = 0; x < SIZE.x; x++) {
        if (grid.get(x, y, z) !== F.BONE) continue;
        for (const [dx, dy, dz] of dirs) {
          let cx = x + dx, cy = y + dy, cz = z + dz;
          while (cx >= 0 && cy >= 0 && cz >= 0 && cx < SIZE.x && cy < SIZE.y && cz < SIZE.z) {
            const v = grid.get(cx, cy, cz);
            if (v === F.BONE) break;
            if (v !== F.EMPTY) {
              const i = at(cx, cy, cz);
              if (cover[i] === 0) { cover[i] = 1; total++; }
            }
            cx += dx; cy += dy; cz += dz;
          }
        }
      }
  return { cover, coverTotal: total };
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
  /** 損傷で下がった上限。作業中も同じ式で出して画面に見せる */
  cap: number;
}

/** 骨1点の損傷が上限を何点下げるか */
const CAP_PER_DAMAGE = 3;

/** 損傷から到達できる上限を出す。作業中の表示もここを通す */
export function cleanCap(boneDamage: number): number {
  return Math.max(0, Math.round(100 - CAP_PER_DAMAGE * boneDamage));
}

/**
 * 余らせていれば満点になる残り時間の割合。
 *
 * 以前は「残り時間 ÷ 制限時間」をそのまま 12 点に掛けていた。削るには
 * 時間が要るので、この値が 1 になることはない——つまり 100 点はどう
 * 削っても出ない数字だった。ここまで余らせたら時間の満点、という線を
 * 引いておく。
 */
const TIME_FULL = 0.3;

/**
 * C = min(88·Rcover + 12·Rtime, 100 − 3·Dbone)
 *
 * Rcover は「骨を覆っていた岩のうち、どれだけ退けたか」。母岩を最後まで
 * 砕く必要はない——削り終わりは、化石がどの面からも見えている状態。
 *
 * 損傷は点を引くのではなく、上限を下げる。
 *
 * 以前は別枠で引いていたので、丁寧に全部剥がしても骨を数回こすった
 * だけで下の段まで落ちた。削り切れていない側の失点と二重取りになっていて、
 * 「どちらを直せば伸びるのか」が読めない。
 * 上限として効かせれば、損傷ぶんの天井まではこれまで通り作業で埋められる。
 */
export function scoreClean(
  removedCover: number, coverTotal: number,
  remainTime: number, limitTime: number,
  boneDamage: number,
): CleanScore {
  const rockRatio = coverTotal > 0 ? Math.min(1, removedCover / coverTotal) : 1;
  const left = limitTime > 0 ? Math.max(0, remainTime / limitTime) : 0;
  const timeRatio = Math.min(1, left / TIME_FULL);
  const work = 88 * rockRatio + 12 * timeRatio;
  const cap = cleanCap(boneDamage);
  const clean = Math.max(0, Math.min(cap, Math.round(work)));
  const rank = clean >= 95 ? 'S' : clean >= 85 ? 'A' : clean >= 70 ? 'B' : clean >= 50 ? 'C' : 'D';
  return { clean, rank, rockRatio, timeRatio, boneDamage, cap };
}

/** クリーン度 → HP/ATK/DEF の倍率。SPD には掛けない */
export function cleanMultiplier(clean: number): number {
  return 0.88 + 0.0024 * clean;
}
