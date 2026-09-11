import { VoxelGrid } from './VoxelGrid';
import { VoxelPainter, Rng } from './VoxelPainter';

/**
 * ヴィヴォソーラ（復元恐竜）のプロシージャル生成。
 *
 * 外部3Dモデルを持たない方針なので、骨格パラメータ＋シードから
 * ボクセルを直接彫る。glTFを持たない分アセット転送量がほぼゼロで、
 * 個体差（体色・角の本数・体格）をタダで作れるのが利点。
 *
 * 色はパレットインデックスで塗り、実際のRGBは属性ごとに差し替える。
 */

export const SLOT = {
  EMPTY: 0,
  PRIMARY: 1,
  SECONDARY: 2,
  BELLY: 3,
  ACCENT: 4,
  CLAW: 5,
  EYE: 6,
  DARK: 7,
  GLOW: 8,
} as const;

export type Archetype =
  | 'theropod'
  | 'sauropod'
  | 'ceratopsian'
  | 'stegosaur'
  | 'ankylosaur'
  | 'pterosaur'
  | 'aquatic'
  | 'raptor';

export interface CreatureSpec {
  archetype: Archetype;
  seed: number;
  /** 全体スケール 0.75〜1.35 程度 */
  scale?: number;
  /** 太さ倍率。草食は太く、俊敏型は細く */
  bulk?: number;
  horns?: number;
  plates?: boolean;
  spikes?: boolean;
  frill?: boolean;
  crest?: boolean;
  sail?: boolean;
}

export interface CreatureModel {
  grid: VoxelGrid;
  /** 足元の接地Y（ボクセル） */
  groundY: number;
  /** 頭の中心（アニメーション・エフェクトのアンカー） */
  headAnchor: [number, number, number];
  tailAnchor: [number, number, number];
  /** 口元。ブレス・噛みつきエフェクトの発射点 */
  mouthAnchor: [number, number, number];
}

const GW = 34;
const GH = 44;
const GD = 58;
const CX = GW / 2;

export function buildCreature(spec: CreatureSpec): CreatureModel {
  const grid = new VoxelGrid(GW, GH, GD);
  const p = new VoxelPainter(grid);
  const rng = new Rng(spec.seed);
  const bulk = spec.bulk ?? 1;

  let model: CreatureModel;
  switch (spec.archetype) {
    case 'theropod': model = buildTheropod(p, rng, spec, bulk); break;
    case 'raptor': model = buildRaptor(p, rng, spec, bulk); break;
    case 'sauropod': model = buildSauropod(p, rng, spec, bulk); break;
    case 'ceratopsian': model = buildCeratopsian(p, rng, spec, bulk); break;
    case 'stegosaur': model = buildStegosaur(p, rng, spec, bulk); break;
    case 'ankylosaur': model = buildAnkylosaur(p, rng, spec, bulk); break;
    case 'pterosaur': model = buildPterosaur(p, rng, spec, bulk); break;
    case 'aquatic': model = buildAquatic(p, rng, spec, bulk); break;
  }

  applyMarkings(p, rng, spec);
  return model;
}

/** 背中側だけを二次色で塗り、腹側を明色にする定番の配色処理 */
function applyMarkings(p: VoxelPainter, rng: Rng, spec: CreatureSpec): void {
  const g = p.grid;
  const stripe = rng.chance(0.55);
  const stripePeriod = rng.int(4, 7);

  for (let z = 0; z < g.sz; z++) {
    for (let x = 0; x < g.sx; x++) {
      // 各カラムの最上面から数ボクセルを二次色に
      let top = -1;
      for (let y = g.sy - 1; y >= 0; y--) {
        if (g.get(x, y, z) === SLOT.PRIMARY) { top = y; break; }
      }
      if (top < 0) continue;
      const depth = stripe && z % stripePeriod < 2 ? 3 : 2;
      for (let y = top; y > top - depth && y >= 0; y--) {
        if (g.get(x, y, z) === SLOT.PRIMARY) g.set(x, y, z, SLOT.SECONDARY);
      }
    }
  }

  // 腹側（下から数えて最初の実体）を明色に
  for (let z = 0; z < g.sz; z++) {
    for (let x = 0; x < g.sx; x++) {
      for (let y = 0; y < g.sy; y++) {
        if (g.get(x, y, z) === SLOT.PRIMARY) {
          g.set(x, y, z, SLOT.BELLY);
          break;
        }
        if (g.isSolid(x, y, z)) break;
      }
    }
  }
  void spec;
}

function addEyes(p: VoxelPainter, hx: number, hy: number, hz: number, hw: number): void {
  for (const s of [1, -1]) {
    const ex = Math.round(CX + s * hw);
    p.grid.set(ex, Math.round(hy), Math.round(hz), SLOT.EYE);
    p.grid.set(ex, Math.round(hy), Math.round(hz) + 1, SLOT.EYE);
    p.grid.set(ex, Math.round(hy) + 1, Math.round(hz), SLOT.DARK);
  }
  void hx;
}

function addLeg(
  p: VoxelPainter, sign: number, hipZ: number, hipY: number, footY: number,
  thickness: number, spread: number, forward: number,
): void {
  const x = CX + sign * spread;
  const kneeY = hipY - (hipY - footY) * 0.52;
  const kneeZ = hipZ + forward;
  p.taperedTube(x, hipY, hipZ, x, kneeY, kneeZ, thickness * 1.15, thickness * 0.85, SLOT.PRIMARY);
  p.taperedTube(x, kneeY, kneeZ, x, footY + 1.2, hipZ + forward * 0.15, thickness * 0.85, thickness * 0.62, SLOT.PRIMARY);
  // 足（3本指）
  p.box(Math.round(x - thickness * 0.8), Math.round(footY), Math.round(hipZ + forward * 0.15 - 1), Math.round(thickness * 1.6), 2, 4, SLOT.PRIMARY);
  for (let i = -1; i <= 1; i++) {
    p.grid.set(Math.round(x + i * thickness * 0.6), Math.round(footY), Math.round(hipZ + forward * 0.15 + 3), SLOT.CLAW);
  }
}

// ---------------------------------------------------------------- theropod

function buildTheropod(p: VoxelPainter, rng: Rng, spec: CreatureSpec, bulk: number): CreatureModel {
  const hipY = 21;
  const tailTipZ = 3;
  const headZ = 47;
  const headY = 27;
  const r = 4.6 * bulk;

  p.spine(
    [
      [CX, 15, tailTipZ], [CX, 17.5, 10], [CX, 20, 16],
      [CX, hipY, 22], [CX, 21.5, 29], [CX, 21, 35],
      [CX, 23, 39], [CX, headY - 1, 43],
    ],
    [0.9 * bulk, 2.0 * bulk, 3.4 * bulk, r, r * 0.95, r * 0.78, 2.8 * bulk, 2.4 * bulk],
    SLOT.PRIMARY,
  );

  // 頭部: 箱型の吻＋顎で「肉食」のシルエットを出す
  const hw = 3.2 * bulk;
  p.ellipsoid(CX, headY, headZ - 2, hw, 3.0 * bulk, 4.0 * bulk, SLOT.PRIMARY);
  p.box(Math.round(CX - hw * 0.8), Math.round(headY - 2), Math.round(headZ), Math.round(hw * 1.6), 4, 6, SLOT.PRIMARY);
  p.box(Math.round(CX - hw * 0.7), Math.round(headY - 3), Math.round(headZ + 1), Math.round(hw * 1.4), 2, 5, SLOT.DARK);
  for (let i = 0; i < 5; i++) {
    p.grid.set(Math.round(CX - hw * 0.7), Math.round(headY - 2), headZ + 1 + i, SLOT.CLAW);
    p.grid.set(Math.round(CX + hw * 0.7) - 1, Math.round(headY - 2), headZ + 1 + i, SLOT.CLAW);
  }
  addEyes(p, CX, headY + 1, headZ - 3, hw * 0.85);

  if (spec.crest || rng.chance(0.4)) {
    p.box(Math.round(CX - 1), Math.round(headY + 3), headZ - 5, 2, 3, 7, SLOT.ACCENT);
  }

  // 後肢
  p.mirrorX(CX, (s) => addLeg(p, s, 22, hipY - 1, 2, 2.6 * bulk, 3.6 * bulk, 4));
  // 小さい前肢
  p.mirrorX(CX, (s) => {
    const x = CX + s * 3.4 * bulk;
    p.taperedTube(x, 22, 34, x + s * 1.2, 18, 36, 1.3, 0.9, SLOT.PRIMARY);
    p.grid.set(Math.round(x + s * 1.2), 17, 37, SLOT.CLAW);
  });

  if (spec.sail) addSail(p, 8, 34, 2.5 * bulk);
  if (spec.spikes) addSpikes(p, 6, 20, rng);

  return {
    grid: p.grid, groundY: 0,
    headAnchor: [CX, headY, headZ - 2],
    tailAnchor: [CX, 15, tailTipZ],
    mouthAnchor: [CX, headY - 2, headZ + 6],
  };
}

// ------------------------------------------------------------------ raptor

function buildRaptor(p: VoxelPainter, rng: Rng, spec: CreatureSpec, bulk: number): CreatureModel {
  const hipY = 19;
  const headZ = 46;
  const headY = 26;
  const r = 3.4 * bulk;

  p.spine(
    [
      [CX, 12, 2], [CX, 14, 8], [CX, 16.5, 14],
      [CX, hipY, 21], [CX, 19.5, 28], [CX, 20, 34],
      [CX, 22.5, 38], [CX, headY - 1, 42],
    ],
    [0.7 * bulk, 1.3 * bulk, 2.3 * bulk, r, r * 0.92, r * 0.7, 2.0 * bulk, 1.8 * bulk],
    SLOT.PRIMARY,
  );

  const hw = 2.4 * bulk;
  p.ellipsoid(CX, headY, headZ - 2, hw, 2.2 * bulk, 3.4 * bulk, SLOT.PRIMARY);
  p.box(Math.round(CX - hw * 0.7), Math.round(headY - 2), headZ, Math.round(hw * 1.4), 3, 6, SLOT.PRIMARY);
  addEyes(p, CX, headY + 1, headZ - 3, hw * 0.85);

  p.mirrorX(CX, (s) => addLeg(p, s, 21, hipY, 2, 1.9 * bulk, 2.8 * bulk, 5));
  // 象徴的な「かま爪」
  p.mirrorX(CX, (s) => {
    const x = CX + s * 2.8 * bulk;
    p.grid.set(Math.round(x), 3, 26, SLOT.CLAW);
    p.grid.set(Math.round(x), 4, 26, SLOT.CLAW);
    p.grid.set(Math.round(x), 5, 27, SLOT.CLAW);
  });
  p.mirrorX(CX, (s) => {
    const x = CX + s * 2.6 * bulk;
    p.taperedTube(x, 20, 33, x + s * 2, 16, 36, 1.1, 0.8, SLOT.PRIMARY);
    for (let i = 0; i < 3; i++) p.grid.set(Math.round(x + s * 2), 15 - i, 36 + i, SLOT.CLAW);
  });

  // 羽毛的なアクセント（尾と腕の縁）
  for (let z = 2; z < 16; z += 2) {
    p.grid.set(Math.round(CX), Math.round(10 + z * 0.35) + 2, z, SLOT.ACCENT);
  }
  if (spec.crest || rng.chance(0.6)) {
    p.box(Math.round(CX - 1), headY + 2, headZ - 4, 2, 2, 5, SLOT.ACCENT);
  }

  return {
    grid: p.grid, groundY: 0,
    headAnchor: [CX, headY, headZ - 2],
    tailAnchor: [CX, 12, 2],
    mouthAnchor: [CX, headY - 1, headZ + 5],
  };
}

// ---------------------------------------------------------------- sauropod

function buildSauropod(p: VoxelPainter, rng: Rng, spec: CreatureSpec, bulk: number): CreatureModel {
  const bodyY = 22;
  const r = 6.2 * bulk;

  p.spine(
    [
      [CX, 14, 2], [CX, 17, 8], [CX, 20, 14],
      [CX, bodyY, 21], [CX, bodyY + 0.5, 28], [CX, bodyY, 34],
      [CX, 26, 39], [CX, 31, 43], [CX, 35, 47], [CX, 37, 51],
    ],
    [0.8 * bulk, 1.8 * bulk, 3.6 * bulk, r, r, r * 0.85, 3.2 * bulk, 2.4 * bulk, 2.0 * bulk, 1.8 * bulk],
    SLOT.PRIMARY,
  );

  const headY = 38;
  const headZ = 53;
  p.ellipsoid(CX, headY, headZ, 2.0, 1.8, 2.6, SLOT.PRIMARY);
  addEyes(p, CX, headY + 1, headZ - 1, 1.8);

  // 柱状の四肢
  p.mirrorX(CX, (s) => {
    const x = CX + s * 4.2 * bulk;
    p.taperedTube(x, bodyY - 2, 24, x, 2.5, 24, 2.9 * bulk, 2.4 * bulk, SLOT.PRIMARY);
    p.box(Math.round(x - 2.6 * bulk), 0, 22, Math.round(5.2 * bulk), 3, 6, SLOT.PRIMARY);
    p.taperedTube(x, bodyY - 2, 33, x, 2.5, 33, 2.7 * bulk, 2.2 * bulk, SLOT.PRIMARY);
    p.box(Math.round(x - 2.4 * bulk), 0, 31, Math.round(4.8 * bulk), 3, 6, SLOT.PRIMARY);
  });

  if (spec.spikes || rng.chance(0.4)) addSpikes(p, 4, 38, rng);

  return {
    grid: p.grid, groundY: 0,
    headAnchor: [CX, headY, headZ],
    tailAnchor: [CX, 14, 2],
    mouthAnchor: [CX, headY - 1, headZ + 3],
  };
}

// ------------------------------------------------------------- ceratopsian

function buildCeratopsian(p: VoxelPainter, rng: Rng, spec: CreatureSpec, bulk: number): CreatureModel {
  const bodyY = 18;
  const r = 6.0 * bulk;

  p.spine(
    [
      [CX, 12, 3], [CX, 14, 8], [CX, 16, 13],
      [CX, bodyY, 19], [CX, bodyY + 1, 26], [CX, bodyY, 32],
      [CX, 19, 37],
    ],
    [1.0 * bulk, 2.2 * bulk, 4.0 * bulk, r, r, r * 0.88, 4.2 * bulk],
    SLOT.PRIMARY,
  );

  const headY = 20;
  const headZ = 44;
  p.ellipsoid(CX, headY, headZ - 2, 3.4 * bulk, 3.0 * bulk, 4.2 * bulk, SLOT.PRIMARY);
  // くちばし
  p.box(Math.round(CX - 1.6), Math.round(headY - 2), headZ + 2, 3, 3, 4, SLOT.CLAW);
  addEyes(p, CX, headY + 1, headZ - 3, 3.0 * bulk);

  // フリル（首飾り）: このアーキタイプの主役。角度をつけて後方に立てる
  const frillR = 7.5 * bulk;
  for (let dy = -2; dy <= 7; dy++) {
    for (let dx = -Math.ceil(frillR); dx <= Math.ceil(frillR); dx++) {
      const nx = dx / frillR;
      const ny = (dy - 2.5) / (frillR * 0.85);
      const d = nx * nx + ny * ny;
      if (d > 1) continue;
      const z = Math.round(headZ - 5 - dy * 0.45);
      const slot = d > 0.62 ? SLOT.ACCENT : SLOT.SECONDARY;
      p.grid.set(Math.round(CX + dx), Math.round(headY + dy), z, slot);
      p.grid.set(Math.round(CX + dx), Math.round(headY + dy), z - 1, slot);
    }
  }
  // フリル縁の突起
  const spikes = spec.horns ?? rng.int(3, 5);
  for (let i = 0; i < spikes; i++) {
    const a = Math.PI * (0.15 + (0.7 * i) / Math.max(1, spikes - 1));
    const sx = CX + Math.cos(a) * frillR * 1.02;
    const sy = headY + 2.5 + Math.sin(a) * frillR * 0.88;
    p.ellipsoid(sx, sy, headZ - 6, 1.1, 1.1, 1.1, SLOT.CLAW);
  }

  // 鼻角＋眉角
  p.taperedTube(CX, headY + 1, headZ + 2, CX, headY + 6, headZ + 3, 1.5, 0.4, SLOT.CLAW);
  for (const s of [1, -1]) {
    p.taperedTube(CX + s * 2.2, headY + 2, headZ - 2, CX + s * 2.8, headY + 7, headZ + 1, 1.2, 0.35, SLOT.CLAW);
  }

  p.mirrorX(CX, (s) => {
    const x = CX + s * 4.0 * bulk;
    p.taperedTube(x, bodyY - 2, 22, x, 2.5, 22, 2.5 * bulk, 2.1 * bulk, SLOT.PRIMARY);
    p.box(Math.round(x - 2.3 * bulk), 0, 20, Math.round(4.6 * bulk), 3, 6, SLOT.PRIMARY);
    p.taperedTube(x, bodyY - 2, 31, x, 2.5, 31, 2.4 * bulk, 2.0 * bulk, SLOT.PRIMARY);
    p.box(Math.round(x - 2.2 * bulk), 0, 29, Math.round(4.4 * bulk), 3, 6, SLOT.PRIMARY);
  });

  return {
    grid: p.grid, groundY: 0,
    headAnchor: [CX, headY, headZ - 2],
    tailAnchor: [CX, 12, 3],
    mouthAnchor: [CX, headY - 1, headZ + 5],
  };
}

// --------------------------------------------------------------- stegosaur

function buildStegosaur(p: VoxelPainter, rng: Rng, spec: CreatureSpec, bulk: number): CreatureModel {
  const r = 5.4 * bulk;
  p.spine(
    [
      [CX, 11, 2], [CX, 13, 8], [CX, 16, 14],
      [CX, 20, 20], [CX, 22, 26], [CX, 20, 32],
      [CX, 17, 38], [CX, 15, 43],
    ],
    [0.8 * bulk, 1.6 * bulk, 3.2 * bulk, r, r, r * 0.85, 3.0 * bulk, 2.0 * bulk],
    SLOT.PRIMARY,
  );

  const headY = 14;
  const headZ = 47;
  p.ellipsoid(CX, headY, headZ, 2.0, 1.8, 3.0, SLOT.PRIMARY);
  p.box(Math.round(CX - 1.4), headY - 2, headZ + 2, 3, 2, 3, SLOT.CLAW);
  addEyes(p, CX, headY + 1, headZ - 1, 1.8);

  // 背板: 千鳥配置にすると立体感が出る
  const plateZs = [10, 14, 18, 22, 26, 30, 34, 38];
  plateZs.forEach((z, i) => {
    const t = 1 - Math.abs((z - 24) / 18);
    const h = Math.round(3 + t * 6);
    const off = i % 2 === 0 ? 1 : -1;
    for (let dy = 0; dy < h; dy++) {
      const w = Math.max(1, Math.round((1 - dy / h) * 3.4));
      for (let dx = -w; dx <= w; dx++) {
        p.grid.set(
          Math.round(CX + dx * 0.5 + off),
          Math.round(20 + t * 4 + dy),
          z,
          dy > h - 2 ? SLOT.CLAW : SLOT.ACCENT,
        );
      }
    }
  });

  // 尾のスパイク（サゴマイザー）
  for (const s of [1, -1]) {
    for (let i = 0; i < 2; i++) {
      p.taperedTube(CX + s * 1.2, 12 + i, 4 + i * 3, CX + s * 4.5, 15 + i * 2, 1 + i * 3, 1.0, 0.3, SLOT.CLAW);
    }
  }

  p.mirrorX(CX, (s) => {
    const x = CX + s * 3.6 * bulk;
    p.taperedTube(x, 19, 22, x, 2.5, 22, 2.4 * bulk, 2.0 * bulk, SLOT.PRIMARY);
    p.box(Math.round(x - 2.2 * bulk), 0, 20, Math.round(4.4 * bulk), 3, 5, SLOT.PRIMARY);
    p.taperedTube(x, 17, 34, x, 2.5, 34, 1.9 * bulk, 1.6 * bulk, SLOT.PRIMARY);
    p.box(Math.round(x - 1.8 * bulk), 0, 32, Math.round(3.6 * bulk), 3, 5, SLOT.PRIMARY);
  });

  void spec; void rng;
  return {
    grid: p.grid, groundY: 0,
    headAnchor: [CX, headY, headZ],
    tailAnchor: [CX, 11, 2],
    mouthAnchor: [CX, headY - 1, headZ + 4],
  };
}

// -------------------------------------------------------------- ankylosaur

function buildAnkylosaur(p: VoxelPainter, rng: Rng, spec: CreatureSpec, bulk: number): CreatureModel {
  const r = 6.4 * bulk;
  p.spine(
    [
      [CX, 9, 4], [CX, 10, 9], [CX, 12, 15],
      [CX, 14, 21], [CX, 14.5, 27], [CX, 14, 33],
      [CX, 13, 38], [CX, 12, 42],
    ],
    [2.2 * bulk, 2.0 * bulk, 3.8 * bulk, r, r, r * 0.9, 3.4 * bulk, 2.4 * bulk],
    SLOT.PRIMARY,
  );

  const headY = 11;
  const headZ = 46;
  p.ellipsoid(CX, headY, headZ, 3.0, 2.2, 3.2, SLOT.PRIMARY);
  p.box(Math.round(CX - 2.2), headY - 2, headZ + 2, 5, 2, 3, SLOT.CLAW);
  addEyes(p, CX, headY + 1, headZ - 1, 2.6);

  // 背中の装甲プレート
  p.paintTop(SLOT.ACCENT, (_x, y, z) => y > 12 && z > 12 && z < 40);
  for (let z = 14; z < 40; z += 4) {
    for (const s of [1, -1]) {
      p.ellipsoid(CX + s * (3 + (z % 8 === 0 ? 1 : 2)), 17 + (z % 8 === 0 ? 0 : -1), z, 1.5, 1.2, 1.5, SLOT.CLAW);
    }
  }
  // 側面スパイク
  for (let z = 16; z < 38; z += 6) {
    for (const s of [1, -1]) {
      p.taperedTube(CX + s * 5.5 * bulk, 13, z, CX + s * 8.5 * bulk, 14, z, 1.3, 0.3, SLOT.CLAW);
    }
  }
  // 尾のハンマー
  p.ellipsoid(CX, 9, 3, 3.6, 2.8, 3.2, SLOT.CLAW);

  p.mirrorX(CX, (s) => {
    const x = CX + s * 4.2 * bulk;
    p.taperedTube(x, 12, 22, x, 2.5, 22, 2.4 * bulk, 2.0 * bulk, SLOT.PRIMARY);
    p.box(Math.round(x - 2.3 * bulk), 0, 20, Math.round(4.6 * bulk), 3, 5, SLOT.PRIMARY);
    p.taperedTube(x, 11, 34, x, 2.5, 34, 2.2 * bulk, 1.9 * bulk, SLOT.PRIMARY);
    p.box(Math.round(x - 2.1 * bulk), 0, 32, Math.round(4.2 * bulk), 3, 5, SLOT.PRIMARY);
  });

  void spec; void rng;
  return {
    grid: p.grid, groundY: 0,
    headAnchor: [CX, headY, headZ],
    tailAnchor: [CX, 9, 3],
    mouthAnchor: [CX, headY - 1, headZ + 4],
  };
}

// --------------------------------------------------------------- pterosaur

function buildPterosaur(p: VoxelPainter, rng: Rng, spec: CreatureSpec, bulk: number): CreatureModel {
  const bodyY = 26;
  p.spine(
    [
      [CX, 20, 6], [CX, 22, 12], [CX, bodyY - 1, 18],
      [CX, bodyY, 24], [CX, bodyY, 29], [CX, bodyY + 1, 34],
    ],
    [0.6, 1.4 * bulk, 2.6 * bulk, 3.2 * bulk, 3.0 * bulk, 2.2 * bulk],
    SLOT.PRIMARY,
  );

  const headY = 29;
  const headZ = 42;
  p.ellipsoid(CX, headY, headZ - 3, 2.0, 2.0, 2.6, SLOT.PRIMARY);
  // 長い嘴
  p.taperedTube(CX, headY - 1, headZ, CX, headY - 2, headZ + 12, 1.5, 0.5, SLOT.CLAW);
  addEyes(p, CX, headY + 1, headZ - 4, 1.8);
  // 後頭部のクレスト
  p.mirrorX(CX, (s) => {
    for (let i = 0; i < 7; i++) {
      p.grid.set(Math.round(CX + s * 0.5), headY + 2 + i, Math.round(headZ - 5 - i * 0.8), SLOT.ACCENT);
    }
  });

  // 翼: 前縁の指骨＋膜。膜は1ボクセル厚で薄く
  p.mirrorX(CX, (s) => {
    const tipX = CX + s * 16;
    p.taperedTube(CX + s * 2, bodyY + 1, 28, CX + s * 7, bodyY + 4, 26, 1.4, 1.0, SLOT.PRIMARY);
    p.taperedTube(CX + s * 7, bodyY + 4, 26, tipX, bodyY + 6, 22, 1.0, 0.5, SLOT.CLAW);
    for (let i = 0; i < 16; i++) {
      const t = i / 15;
      const x = Math.round(CX + s * (2 + 14 * t));
      const yTop = Math.round(bodyY + 1 + 5 * t);
      const zFront = Math.round(28 - 6 * t);
      const span = Math.round(12 - 7 * t);
      for (let z = zFront - span; z <= zFront; z++) {
        p.grid.set(x, Math.round(yTop - (zFront - z) * 0.12), z, SLOT.SECONDARY);
      }
    }
    // 後肢は小さく
    p.taperedTube(CX + s * 2, bodyY - 2, 20, CX + s * 3, 14, 16, 1.0, 0.6, SLOT.PRIMARY);
  });

  void spec; void rng;
  return {
    grid: p.grid, groundY: 12,
    headAnchor: [CX, headY, headZ - 3],
    tailAnchor: [CX, 20, 6],
    mouthAnchor: [CX, headY - 2, headZ + 12],
  };
}

// ----------------------------------------------------------------- aquatic

function buildAquatic(p: VoxelPainter, rng: Rng, spec: CreatureSpec, bulk: number): CreatureModel {
  const bodyY = 22;
  const r = 5.0 * bulk;
  p.spine(
    [
      [CX, bodyY, 3], [CX, bodyY, 9], [CX, bodyY, 15],
      [CX, bodyY, 21], [CX, bodyY, 27], [CX, bodyY, 33],
      [CX, bodyY + 1, 38], [CX, bodyY + 2, 43],
    ],
    [1.0, 2.4 * bulk, 4.0 * bulk, r, r * 0.95, r * 0.8, 3.0 * bulk, 2.2 * bulk],
    SLOT.PRIMARY,
  );

  const headY = bodyY + 2;
  const headZ = 47;
  p.ellipsoid(CX, headY, headZ, 2.6 * bulk, 2.2 * bulk, 3.6 * bulk, SLOT.PRIMARY);
  p.box(Math.round(CX - 2), headY - 2, headZ + 2, 4, 3, 5, SLOT.PRIMARY);
  for (let i = 0; i < 5; i++) {
    p.grid.set(Math.round(CX - 2), headY - 2, headZ + 2 + i, SLOT.CLAW);
    p.grid.set(Math.round(CX + 1), headY - 2, headZ + 2 + i, SLOT.CLAW);
  }
  addEyes(p, CX, headY + 1, headZ - 2, 2.2 * bulk);

  // 尾ビレ（縦型）
  for (let dy = -6; dy <= 6; dy++) {
    const w = Math.round(4 - Math.abs(dy) * 0.4);
    for (let dz = 0; dz < w; dz++) {
      p.grid.set(Math.round(CX), bodyY + dy, 1 + dz, SLOT.ACCENT);
      p.grid.set(Math.round(CX) - 1, bodyY + dy, 1 + dz, SLOT.ACCENT);
    }
  }
  // 4枚のヒレ
  p.mirrorX(CX, (s) => {
    for (const z of [24, 34]) {
      const len = z === 24 ? 9 : 7;
      for (let i = 0; i < len; i++) {
        const t = i / (len - 1);
        const x = Math.round(CX + s * (4 + i));
        for (let dz = -2; dz <= 2; dz++) {
          if (Math.abs(dz) > 2 - t * 1.2) continue;
          p.grid.set(x, Math.round(bodyY - 1 - t * 2), z + dz, SLOT.SECONDARY);
        }
      }
    }
  });
  // 背ビレ
  for (let z = 16; z < 36; z += 1) {
    const h = Math.round(2 + Math.sin(((z - 16) / 20) * Math.PI) * 3);
    for (let dy = 0; dy < h; dy++) p.grid.set(Math.round(CX), bodyY + 4 + dy, z, SLOT.ACCENT);
  }

  void spec; void rng;
  return {
    grid: p.grid, groundY: 10,
    headAnchor: [CX, headY, headZ],
    tailAnchor: [CX, bodyY, 3],
    mouthAnchor: [CX, headY - 2, headZ + 7],
  };
}

// -------------------------------------------------------------- decorations

function addSail(p: VoxelPainter, z0: number, z1: number, height: number): void {
  for (let z = z0; z < z1; z++) {
    const t = (z - z0) / (z1 - z0);
    const h = Math.round(height * (Math.sin(t * Math.PI) * 0.85 + 0.3) * 2.2);
    let top = -1;
    for (let y = p.grid.sy - 1; y >= 0; y--) if (p.grid.isSolid(Math.round(CX), y, z)) { top = y; break; }
    if (top < 0) continue;
    for (let dy = 1; dy <= h; dy++) {
      p.grid.set(Math.round(CX), top + dy, z, dy > h - 2 ? SLOT.CLAW : SLOT.ACCENT);
    }
  }
}

function addSpikes(p: VoxelPainter, z0: number, z1: number, rng: Rng): void {
  for (let z = z0; z < z1; z += rng.int(3, 5)) {
    let top = -1;
    for (let y = p.grid.sy - 1; y >= 0; y--) if (p.grid.isSolid(Math.round(CX), y, z)) { top = y; break; }
    if (top < 0) continue;
    const h = rng.int(2, 4);
    for (let dy = 1; dy <= h; dy++) p.grid.set(Math.round(CX), top + dy, z, SLOT.CLAW);
  }
}
