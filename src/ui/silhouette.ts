import { buildCreature, type CreatureModel, type VoxelPart } from '../voxel/CreatureBuilder';
import { getRevos } from '../game/data/revos';
import { ELEMENT_COLORS } from '../voxel/palette';

/**
 * リヴォスの横向きシルエットを実データから起こす。
 *
 * アイコンを手で描くと 12 体ぶん＋追加のたびに絵が要る。ここでは
 * 本体のボクセルをそのまま Z-Y 平面へ投影するので、モデルを直せば
 * アイコンも一緒に直る。図鑑・インベントリ・編成で同じ絵を使い回せる。
 */

const cache = new Map<string, string>();

/** パーツツリーを辿り、ボクセルの占有を Z-Y 平面に落とす */
function project(
  part: VoxelPart,
  ox: number, oy: number,
  cells: Set<number>,
  bounds: { minZ: number; maxZ: number; minY: number; maxY: number },
): void {
  const px = ox + part.pivot[0];
  const py = oy + part.pivot[1];
  // Z は前後。pivot の Z も足して投影面の位置を決める
  const pz = part.pivot[2];
  void px;

  for (let z = 0; z < part.grid.sz; z++) {
    for (let y = 0; y < part.grid.sy; y++) {
      let solid = false;
      for (let x = 0; x < part.grid.sx; x++) {
        if (part.grid.isSolid(x, y, z)) { solid = true; break; }
      }
      if (!solid) continue;
      const wz = Math.round(pz + part.origin[2] + z + (part.parentZ ?? 0));
      const wy = Math.round(py + part.origin[1] + y);
      if (wz < bounds.minZ) bounds.minZ = wz;
      if (wz > bounds.maxZ) bounds.maxZ = wz;
      if (wy < bounds.minY) bounds.minY = wy;
      if (wy > bounds.maxY) bounds.maxY = wy;
      cells.add(((wz + 512) << 12) | (wy + 512));
    }
  }

  for (const c of part.children) {
    // 子は親のピボット位置を引き継ぐ
    (c as VoxelPart & { parentZ?: number }).parentZ = pz + (part.parentZ ?? 0);
    project(c, px, py, cells, bounds);
  }
}

function renderSilhouette(model: CreatureModel, size: number, color: string): string {
  const cells = new Set<number>();
  const bounds = { minZ: Infinity, maxZ: -Infinity, minY: Infinity, maxY: -Infinity };
  project(model.root, 0, 0, cells, bounds);
  if (bounds.minZ === Infinity) return '';

  const w = bounds.maxZ - bounds.minZ + 1;
  const h = bounds.maxY - bounds.minY + 1;
  const cv = document.createElement('canvas');
  const dpr = Math.min(2, devicePixelRatio || 1);
  cv.width = Math.round(size * dpr);
  cv.height = Math.round(size * dpr);
  const ctx = cv.getContext('2d')!;
  ctx.imageSmoothingEnabled = false;

  // 余白を残して等倍スケール。縦横比を保つ
  const pad = 0.1;
  const scale = Math.min(cv.width * (1 - pad * 2) / w, cv.height * (1 - pad * 2) / h);
  const offX = (cv.width - w * scale) / 2;
  const offY = (cv.height - h * scale) / 2;

  ctx.fillStyle = color;
  for (const key of cells) {
    const wz = (key >> 12) - 512;
    const wy = (key & 0xfff) - 512;
    // 画面のYは下向き。頭が上に来るよう反転する
    const sx = offX + (wz - bounds.minZ) * scale;
    const sy = offY + (bounds.maxY - wy) * scale;
    ctx.fillRect(Math.floor(sx), Math.floor(sy), Math.ceil(scale) + 1, Math.ceil(scale) + 1);
  }
  return cv.toDataURL('image/png');
}

/** 指定リヴォスのシルエット画像（data URL）。生成結果はキャッシュする */
export function silhouetteFor(defId: string, size = 44): string {
  const key = `${defId}@${size}`;
  const hit = cache.get(key);
  if (hit !== undefined) return hit;

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
  const color = `#${ELEMENT_COLORS[def.element].toString(16).padStart(6, '0')}`;
  const url = renderSilhouette(model, size, color);
  cache.set(key, url);
  return url;
}

/** img 要素を作って返す。未生成なら同期的に作る（1体あたり数ms） */
export function silhouetteImg(defId: string, size = 44, className = 'silho'): HTMLImageElement {
  const img = document.createElement('img');
  img.className = className;
  img.width = size;
  img.height = size;
  img.alt = '';
  img.decoding = 'async';
  img.src = silhouetteFor(defId, size);
  return img;
}
