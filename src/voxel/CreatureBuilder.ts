import * as THREE from 'three';
import { VoxelGrid } from './VoxelGrid';
import { VoxelPainter, Rng } from './VoxelPainter';
import { greedyMesh } from './greedyMesher';

/**
 * リヴォス（復元古生物）のプロシージャル生成。
 *
 * 1体を1つのボクセルグリッドで持つとアニメーションできなくなるので、
 * 「パーツ＝ボーン」のツリーとして組む。各パーツは独立した
 * BufferGeometry になり、Object3D.rotation を動かすだけで歩行が書ける。
 * スキニングもボーンテクスチャも不要で、関節のカクつきはむしろ持ち味になる。
 *
 * 骨（BONE スロット）のボクセルは化石側と共有する。同じデータから
 * 「復元後の姿」と「発掘対象の化石」の両方が出るので、図鑑の完成形と
 * 掘り出した化石が必ず一致する。
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

/** 骨として化石に残るスロット（爪・牙・角・板は骨質） */
const BONE_SLOTS = new Set<number>([SLOT.CLAW, SLOT.ACCENT]);

export type Archetype =
  | 'theropod' | 'raptor' | 'sauropod' | 'ceratopsian'
  | 'stegosaur' | 'ankylosaur' | 'pterosaur' | 'aquatic';

export interface CreatureSpec {
  archetype: Archetype;
  seed: number;
  scale?: number;
  bulk?: number;
  horns?: number;
  sail?: boolean;
  crest?: boolean;
  spikes?: boolean;
}

export interface VoxelPart {
  name: string;
  grid: VoxelGrid;
  /** 親ローカルでのピボット位置（ボクセル単位） */
  pivot: [number, number, number];
  /** ピボットから見たグリッド原点のオフセット（ボクセル単位） */
  origin: [number, number, number];
  children: VoxelPart[];
}

export interface CreatureModel {
  root: VoxelPart;
  parts: Map<string, VoxelPart>;
  /** 1ボクセルのワールドサイズ */
  voxelSize: number;
  /** ワールド単位の全高（接地〜頭頂） */
  height: number;
  archetype: Archetype;
  /** 二足なら2、四足なら4 */
  legCount: 2 | 4;
  hasWings: boolean;
}

const VOX = 0.09;

// ---------------------------------------------------------------- 骨格定義

interface Skeleton {
  bodyLen: number;
  bodyR: number;
  bodyTilt: number;
  neckLen: number;
  neckR: number;
  neckPitch: number;
  headW: number;
  headH: number;
  headD: number;
  headType: 'jaw' | 'beak' | 'blunt' | 'long';
  tailSegs: number;
  tailLen: number;
  tailR: number;
  tailDroop: number;
  legCount: 2 | 4;
  legLen: number;
  legR: number;
  legSpread: number;
  armLen: number;
  armR: number;
  wingSpan: number;
  hipY: number;
}

function skeletonFor(a: Archetype, bulk: number): Skeleton {
  const base: Skeleton = {
    bodyLen: 16, bodyR: 5, bodyTilt: 0,
    neckLen: 7, neckR: 3, neckPitch: 0.5,
    headW: 7, headH: 6, headD: 9, headType: 'jaw',
    tailSegs: 3, tailLen: 8, tailR: 3.4, tailDroop: 0.1,
    legCount: 2, legLen: 13, legR: 2.6, legSpread: 3.6,
    armLen: 6, armR: 1.3, wingSpan: 0,
    hipY: 15,
  };
  const s = { ...base };
  switch (a) {
    case 'theropod':
      Object.assign(s, {
        bodyLen: 17, bodyR: 5.0 * bulk, neckLen: 7, neckR: 2.9 * bulk, neckPitch: 0.55,
        headW: 7, headH: 6, headD: 10, headType: 'jaw' as const,
        tailSegs: 3, tailLen: 9, tailR: 3.6 * bulk, tailDroop: 0.06,
        legCount: 2 as const, legLen: 14, legR: 2.7 * bulk, legSpread: 3.6 * bulk,
        armLen: 5, armR: 1.2, hipY: 16,
      });
      break;
    case 'raptor':
      Object.assign(s, {
        bodyLen: 14, bodyR: 3.6 * bulk, neckLen: 7, neckR: 2.1 * bulk, neckPitch: 0.75,
        headW: 5, headH: 4, headD: 8, headType: 'jaw' as const,
        tailSegs: 4, tailLen: 11, tailR: 2.2 * bulk, tailDroop: -0.05,
        legCount: 2 as const, legLen: 12, legR: 2.0 * bulk, legSpread: 2.9 * bulk,
        armLen: 6, armR: 1.1, hipY: 14,
      });
      break;
    case 'sauropod':
      Object.assign(s, {
        bodyLen: 16, bodyR: 6.4 * bulk, neckLen: 18, neckR: 2.6 * bulk, neckPitch: 1.05,
        headW: 4, headH: 4, headD: 6, headType: 'blunt' as const,
        tailSegs: 4, tailLen: 15, tailR: 3.4 * bulk, tailDroop: 0.12,
        legCount: 4 as const, legLen: 14, legR: 2.9 * bulk, legSpread: 4.4 * bulk,
        hipY: 17,
      });
      break;
    case 'ceratopsian':
      Object.assign(s, {
        bodyLen: 16, bodyR: 6.0 * bulk, neckLen: 4, neckR: 4.0 * bulk, neckPitch: 0.2,
        headW: 9, headH: 8, headD: 11, headType: 'beak' as const,
        tailSegs: 2, tailLen: 7, tailR: 3.0 * bulk, tailDroop: 0.2,
        legCount: 4 as const, legLen: 11, legR: 2.6 * bulk, legSpread: 4.2 * bulk,
        hipY: 13,
      });
      break;
    case 'stegosaur':
      Object.assign(s, {
        bodyLen: 17, bodyR: 5.4 * bulk, neckLen: 6, neckR: 2.6 * bulk, neckPitch: -0.25,
        headW: 4, headH: 4, headD: 7, headType: 'blunt' as const,
        tailSegs: 3, tailLen: 11, tailR: 3.0 * bulk, tailDroop: -0.1,
        legCount: 4 as const, legLen: 11, legR: 2.4 * bulk, legSpread: 3.8 * bulk,
        hipY: 14,
      });
      break;
    case 'ankylosaur':
      Object.assign(s, {
        bodyLen: 17, bodyR: 6.4 * bulk, bodyTilt: 0, neckLen: 4, neckR: 3.4 * bulk, neckPitch: -0.1,
        headW: 7, headH: 5, headD: 7, headType: 'blunt' as const,
        tailSegs: 3, tailLen: 10, tailR: 2.6 * bulk, tailDroop: 0.05,
        legCount: 4 as const, legLen: 8, legR: 2.4 * bulk, legSpread: 4.4 * bulk,
        hipY: 10,
      });
      break;
    case 'pterosaur':
      Object.assign(s, {
        bodyLen: 11, bodyR: 3.2 * bulk, neckLen: 6, neckR: 1.8 * bulk, neckPitch: 0.9,
        headW: 4, headH: 4, headD: 14, headType: 'long' as const,
        tailSegs: 2, tailLen: 5, tailR: 1.2, tailDroop: 0.2,
        legCount: 2 as const, legLen: 8, legR: 1.4 * bulk, legSpread: 2.4,
        armLen: 6, armR: 1.2, wingSpan: 17, hipY: 12,
      });
      break;
    case 'aquatic':
      Object.assign(s, {
        bodyLen: 18, bodyR: 5.0 * bulk, neckLen: 5, neckR: 3.0 * bulk, neckPitch: 0.15,
        headW: 6, headH: 5, headD: 10, headType: 'jaw' as const,
        tailSegs: 3, tailLen: 12, tailR: 3.0 * bulk, tailDroop: 0,
        legCount: 4 as const, legLen: 6, legR: 1.6 * bulk, legSpread: 4.6 * bulk,
        hipY: 9,
      });
      break;
  }
  return s;
}

// ---------------------------------------------------------------- パーツ生成

function part(
  name: string, w: number, h: number, d: number,
  pivot: [number, number, number], origin: [number, number, number],
  draw: (p: VoxelPainter, g: VoxelGrid) => void,
): VoxelPart {
  const grid = new VoxelGrid(Math.ceil(w), Math.ceil(h), Math.ceil(d));
  draw(new VoxelPainter(grid), grid);
  return { name, grid, pivot, origin, children: [] };
}

/** 背側を二次色、腹側を明色に塗り分ける。全パーツ共通の仕上げ */
function shade(grid: VoxelGrid): void {
  for (let z = 0; z < grid.sz; z++) {
    for (let x = 0; x < grid.sx; x++) {
      let top = -1;
      for (let y = grid.sy - 1; y >= 0; y--) {
        if (grid.get(x, y, z) === SLOT.PRIMARY) { top = y; break; }
      }
      if (top >= 0) {
        for (let y = top; y > top - 2 && y >= 0; y--) {
          if (grid.get(x, y, z) === SLOT.PRIMARY) grid.set(x, y, z, SLOT.SECONDARY);
        }
      }
      for (let y = 0; y < grid.sy; y++) {
        if (grid.get(x, y, z) === SLOT.PRIMARY) { grid.set(x, y, z, SLOT.BELLY); break; }
        if (grid.isSolid(x, y, z)) break;
      }
    }
  }
}

export function buildCreature(spec: CreatureSpec): CreatureModel {
  const bulk = spec.bulk ?? 1;
  const sk = skeletonFor(spec.archetype, bulk);
  const rng = new Rng(spec.seed);
  const parts = new Map<string, VoxelPart>();

  const reg = (p: VoxelPart): VoxelPart => { parts.set(p.name, p); return p; };

  // ---- 胴体（ルート）----
  const bodyW = Math.ceil(sk.bodyR * 2 + 2);
  const bodyH = Math.ceil(sk.bodyR * 2 + 2);
  const bodyD = Math.ceil(sk.bodyLen);
  const body = reg(part(
    'body', bodyW, bodyH, bodyD,
    [0, sk.hipY, 0],
    [-bodyW / 2, -bodyH / 2, -bodyD / 2],
    (p) => {
      const cx = bodyW / 2, cy = bodyH / 2;
      // 胴は前が太く後ろが細い紡錘形にすると、どの種でも生物らしく見える
      for (let z = 0; z < bodyD; z++) {
        const t = z / (bodyD - 1);
        const r = sk.bodyR * (0.78 + Math.sin(t * Math.PI) * 0.34);
        p.ellipsoid(cx, cy, z + 0.5, r, r * 0.92, 0.9, SLOT.PRIMARY);
      }
      if (spec.sail) {
        for (let z = 2; z < bodyD - 2; z++) {
          const t = (z - 2) / (bodyD - 5);
          const h = Math.round(Math.sin(t * Math.PI) * sk.bodyR * 1.7 + 1);
          for (let dy = 1; dy <= h; dy++) {
            p.grid.set(Math.round(cx), Math.round(cy + sk.bodyR * 0.75) + dy, z,
              dy > h - 2 ? SLOT.CLAW : SLOT.ACCENT);
          }
        }
      }
      if (spec.spikes) {
        for (let z = 2; z < bodyD - 2; z += rng.int(3, 5)) {
          let top = -1;
          for (let y = p.grid.sy - 1; y >= 0; y--) if (p.grid.isSolid(Math.round(cx), y, z)) { top = y; break; }
          if (top < 0) continue;
          for (let dy = 1; dy <= rng.int(2, 3); dy++) p.grid.set(Math.round(cx), top + dy, z, SLOT.CLAW);
        }
      }
    },
  ));

  // ---- 首 ----
  const neckW = Math.ceil(sk.neckR * 2 + 2);
  const neck = reg(part(
    'neck', neckW, neckW, Math.ceil(sk.neckLen),
    [0, sk.bodyR * 0.45, sk.bodyLen / 2 - 1],
    [-neckW / 2, -neckW / 2, 0],
    (p, g) => {
      const c = neckW / 2;
      for (let z = 0; z < g.sz; z++) {
        const t = z / Math.max(1, g.sz - 1);
        const r = sk.neckR * (1 - t * 0.32);
        // 首は前へ進むほど持ち上がる。これで頭の位置が自然に決まる
        const y = c + Math.sin(t * sk.neckPitch) * sk.neckLen * 0.42;
        p.ellipsoid(c, y, z + 0.5, r, r, 0.9, SLOT.PRIMARY);
      }
    },
  ));
  body.children.push(neck);

  // ---- 頭 ----
  const hw = Math.ceil(sk.headW), hh = Math.ceil(sk.headH + 4), hd = Math.ceil(sk.headD + 2);
  const neckEndY = Math.sin(sk.neckPitch) * sk.neckLen * 0.42;
  const head = reg(part(
    'head', hw + 2, hh, hd,
    [0, neckEndY, sk.neckLen],
    [-(hw + 2) / 2, -sk.headH / 2, 0],
    (p, g) => {
      const cx = (hw + 2) / 2;
      const cy = sk.headH / 2;
      p.ellipsoid(cx, cy, sk.headD * 0.36, sk.headW / 2, sk.headH / 2, sk.headD * 0.4, SLOT.PRIMARY);

      if (sk.headType === 'jaw') {
        // 吻と下顎。牙を並べて肉食のシルエットを作る
        p.box(Math.round(cx - sk.headW * 0.3), Math.round(cy - 1),
          Math.round(sk.headD * 0.5), Math.round(sk.headW * 0.6), 3, Math.round(sk.headD * 0.5), SLOT.PRIMARY);
        p.box(Math.round(cx - sk.headW * 0.26), Math.round(cy - 2),
          Math.round(sk.headD * 0.52), Math.round(sk.headW * 0.52), 1, Math.round(sk.headD * 0.44), SLOT.DARK);
        const teeth = Math.max(3, Math.round(sk.headD * 0.32));
        for (let i = 0; i < teeth; i++) {
          const z = Math.round(sk.headD * 0.52) + i;
          p.grid.set(Math.round(cx - sk.headW * 0.28), Math.round(cy - 1), z, SLOT.CLAW);
          p.grid.set(Math.round(cx + sk.headW * 0.26), Math.round(cy - 1), z, SLOT.CLAW);
        }
      } else if (sk.headType === 'beak') {
        p.box(Math.round(cx - 1.5), Math.round(cy - 2), Math.round(sk.headD * 0.6), 3, 4, 4, SLOT.CLAW);
      } else if (sk.headType === 'long') {
        p.taperedTube(cx, cy, sk.headD * 0.5, cx, cy - 1, sk.headD, 1.6, 0.5, SLOT.CLAW);
      } else {
        p.box(Math.round(cx - sk.headW * 0.25), Math.round(cy - 1.5),
          Math.round(sk.headD * 0.5), Math.round(sk.headW * 0.5), 3, 3, SLOT.PRIMARY);
      }

      // 目
      for (const s of [1, -1]) {
        const ex = Math.round(cx + s * sk.headW * 0.42);
        const ey = Math.round(cy + sk.headH * 0.18);
        const ez = Math.round(sk.headD * 0.42);
        p.grid.set(ex, ey, ez, SLOT.EYE);
        p.grid.set(ex, ey, ez + 1, SLOT.EYE);
        p.grid.set(ex, ey + 1, ez, SLOT.DARK);
      }

      // フリル（ケラトプス類の主役。頭部パーツに含める）
      if (spec.archetype === 'ceratopsian') {
        const fr = sk.headW * 1.15;
        for (let dy = -1; dy <= Math.ceil(fr); dy++) {
          for (let dx = -Math.ceil(fr); dx <= Math.ceil(fr); dx++) {
            const nx = dx / fr, ny = (dy - fr * 0.35) / (fr * 0.95);
            const d2 = nx * nx + ny * ny;
            if (d2 > 1) continue;
            const slot = d2 > 0.6 ? SLOT.ACCENT : SLOT.SECONDARY;
            p.grid.set(Math.round(cx + dx), Math.round(cy + dy + 1), 1, slot);
            p.grid.set(Math.round(cx + dx), Math.round(cy + dy + 1), 0, slot);
          }
        }
        const n = spec.horns ?? rng.int(3, 5);
        for (let i = 0; i < n; i++) {
          const a = Math.PI * (0.12 + (0.76 * i) / Math.max(1, n - 1));
          p.ellipsoid(cx + Math.cos(a) * fr, cy + fr * 0.35 + Math.sin(a) * fr * 0.95, 0.5, 1, 1, 1, SLOT.CLAW);
        }
        // 鼻角と眉角
        p.taperedTube(cx, cy + 1, sk.headD * 0.55, cx, cy + 5, sk.headD * 0.62, 1.4, 0.35, SLOT.CLAW);
        for (const s of [1, -1]) {
          p.taperedTube(cx + s * 2, cy + 2, sk.headD * 0.35, cx + s * 2.6, cy + 6, sk.headD * 0.45, 1.1, 0.3, SLOT.CLAW);
        }
      }

      if (spec.crest) {
        for (let i = 0; i < 5; i++) {
          p.grid.set(Math.round(cx), Math.round(cy + sk.headH * 0.5 + i * 0.6), Math.round(sk.headD * 0.3 - i), SLOT.ACCENT);
        }
      }
      void g;
    },
  ));
  neck.children.push(head);

  // ---- 尾 ----
  let tailParent = body;
  const segLen = sk.tailLen / sk.tailSegs;
  for (let i = 0; i < sk.tailSegs; i++) {
    const t0 = i / sk.tailSegs;
    const r0 = sk.tailR * (1 - t0 * 0.75);
    const tw = Math.ceil(r0 * 2 + 2);
    const isLast = i === sk.tailSegs - 1;
    const seg = reg(part(
      `tail${i}`, tw, tw, Math.ceil(segLen + 1),
      i === 0 ? [0, sk.bodyR * 0.2, -sk.bodyLen / 2 + 1] : [0, 0, -segLen],
      [-tw / 2, -tw / 2, -Math.ceil(segLen + 1)],
      (p, g) => {
        const c = tw / 2;
        for (let z = 0; z < g.sz; z++) {
          const t = (i + 1 - z / g.sz) / sk.tailSegs;
          const r = Math.max(0.7, sk.tailR * (1 - t * 0.8) * 1.0);
          p.ellipsoid(c, c, z + 0.5, r, r, 0.9, SLOT.PRIMARY);
        }
        if (isLast && spec.archetype === 'ankylosaur') {
          p.ellipsoid(c, c, 0.5, 3.2, 2.6, 2.8, SLOT.CLAW); // ハンマー
        }
        if (isLast && spec.archetype === 'stegosaur') {
          for (const s of [1, -1]) {
            for (let k = 0; k < 2; k++) {
              p.taperedTube(c + s * 0.8, c + 0.5, 2 + k * 2, c + s * 4, c + 1.5 + k, 0 + k * 2, 0.9, 0.3, SLOT.CLAW);
            }
          }
        }
        if (isLast && spec.archetype === 'aquatic') {
          for (let dy = -5; dy <= 5; dy++) {
            const w = Math.max(1, Math.round(3 - Math.abs(dy) * 0.35));
            for (let dz = 0; dz < w; dz++) p.grid.set(Math.round(c), Math.round(c + dy), dz, SLOT.ACCENT);
          }
        }
      },
    ));
    tailParent.children.push(seg);
    tailParent = seg;
  }

  // ---- 脚 ----
  const legNames = sk.legCount === 2
    ? [['legL', -1, 0], ['legR', 1, 0]] as const
    : [['legFL', -1, 1], ['legFR', 1, 1], ['legBL', -1, -1], ['legBR', 1, -1]] as const;

  for (const [name, side, fb] of legNames) {
    const lw = Math.ceil(sk.legR * 2 + 2);
    const zPos = sk.legCount === 2
      ? 0
      : fb > 0 ? sk.bodyLen * 0.3 : -sk.bodyLen * 0.28;
    const leg = reg(part(
      name, lw, Math.ceil(sk.legLen + 3), lw + 3,
      [side * sk.legSpread, -sk.bodyR * 0.55, zPos],
      [-lw / 2, -Math.ceil(sk.legLen + 3), -(lw + 3) / 2],
      (p, g) => {
        const c = lw / 2;
        const top = g.sy - 1;
        // 太腿→脛でテーパー。膝の位置で「走れそう」に見えるかが決まる
        for (let i = 0; i <= sk.legLen; i++) {
          const t = i / sk.legLen;
          const r = sk.legR * (1 - t * 0.42);
          const zOff = spec.archetype === 'sauropod' || spec.archetype === 'ankylosaur'
            ? 0
            : Math.sin(t * Math.PI) * sk.legR * 0.55;
          p.ellipsoid(c, top - i, (lw + 3) / 2 + zOff, r, 0.9, r, SLOT.PRIMARY);
        }
        // 足
        const fy = top - sk.legLen;
        p.box(Math.round(c - sk.legR * 0.85), Math.max(0, Math.round(fy - 1)),
          Math.round((lw + 3) / 2 - 1), Math.max(2, Math.round(sk.legR * 1.7)), 2, 4, SLOT.PRIMARY);
        if (spec.archetype !== 'aquatic' && spec.archetype !== 'sauropod') {
          for (let k = -1; k <= 1; k++) {
            p.grid.set(Math.round(c + k * sk.legR * 0.6), Math.max(0, Math.round(fy - 1)),
              Math.round((lw + 3) / 2 + 2), SLOT.CLAW);
          }
        }
        if (spec.archetype === 'aquatic') {
          // ヒレ状に広げる
          for (let i = 0; i < 5; i++) {
            p.box(Math.round(c - 2 - i * 0.4), Math.max(0, Math.round(fy + i)),
              Math.round((lw + 3) / 2 - 2), Math.round(4 + i * 0.8), 1, 5, SLOT.SECONDARY);
          }
        }
      },
    ));
    body.children.push(leg);
  }

  // ---- 前肢（二足のみ）----
  if (sk.legCount === 2 && spec.archetype !== 'pterosaur') {
    for (const [name, side] of [['armL', -1], ['armR', 1]] as const) {
      const aw = Math.ceil(sk.armR * 2 + 2);
      const arm = reg(part(
        name, aw, Math.ceil(sk.armLen + 2), aw + 2,
        [side * (sk.bodyR * 0.82), sk.bodyR * 0.1, sk.bodyLen * 0.22],
        [-aw / 2, -Math.ceil(sk.armLen + 2), -(aw + 2) / 2],
        (p, g) => {
          const c = aw / 2;
          const top = g.sy - 1;
          for (let i = 0; i <= sk.armLen; i++) {
            const t = i / sk.armLen;
            p.ellipsoid(c, top - i, (aw + 2) / 2 + t * 1.2, sk.armR * (1 - t * 0.3), 0.9, sk.armR * (1 - t * 0.3), SLOT.PRIMARY);
          }
          for (let k = -1; k <= 1; k++) {
            p.grid.set(Math.round(c + k), Math.max(0, top - sk.armLen), Math.round((aw + 2) / 2 + 2), SLOT.CLAW);
          }
        },
      ));
      body.children.push(arm);
    }
  }

  // ---- 翼 ----
  if (sk.wingSpan > 0) {
    for (const [name, side] of [['wingL', -1], ['wingR', 1]] as const) {
      const span = Math.ceil(sk.wingSpan);
      const wing = reg(part(
        name, span + 2, 8, 16,
        [side * sk.bodyR * 0.8, sk.bodyR * 0.3, 0],
        side < 0 ? [-(span + 2), -4, -8] : [0, -4, -8],
        (p, g) => {
          const xFrom = side < 0 ? span : 0;
          const dir = side < 0 ? -1 : 1;
          for (let i = 0; i <= span; i++) {
            const t = i / span;
            const x = Math.round(xFrom + dir * i);
            // 前縁の指骨
            const yLead = Math.round(4 + t * 2.4);
            const zLead = Math.round(8 + 4 - t * 5);
            p.grid.set(x, yLead, zLead, t > 0.55 ? SLOT.CLAW : SLOT.PRIMARY);
            p.grid.set(x, yLead, zLead - 1, t > 0.55 ? SLOT.CLAW : SLOT.PRIMARY);
            // 膜
            const chord = Math.round(11 - t * 7.5);
            for (let k = 1; k <= chord; k++) {
              p.grid.set(x, Math.round(yLead - k * 0.14), zLead - 1 - k, SLOT.SECONDARY);
            }
          }
          void g;
        },
      ));
      body.children.push(wing);
    }
  }

  for (const p of parts.values()) shade(p.grid);

  const height = (sk.hipY + sk.bodyR + (spec.archetype === 'sauropod' ? sk.neckLen : sk.headH)) * VOX * (spec.scale ?? 1);

  return {
    root: body,
    parts,
    voxelSize: VOX * (spec.scale ?? 1),
    height,
    archetype: spec.archetype,
    legCount: sk.legCount,
    hasWings: sk.wingSpan > 0,
  };
}

// ---------------------------------------------------------------- three変換

export interface CreatureObject {
  root: THREE.Group;
  parts: Map<string, THREE.Object3D>;
  model: CreatureModel;
  dispose(): void;
}

export function creatureToObject3D(
  model: CreatureModel,
  palette: Float32Array,
  material: THREE.Material,
): CreatureObject {
  const parts = new Map<string, THREE.Object3D>();
  const geometries: THREE.BufferGeometry[] = [];
  const vs = model.voxelSize;

  const build = (p: VoxelPart): THREE.Object3D => {
    const node = new THREE.Group();
    node.name = p.name;
    node.position.set(p.pivot[0] * vs, p.pivot[1] * vs, p.pivot[2] * vs);

    const data = greedyMesh(p.grid, palette, {
      voxelSize: vs,
      origin: [p.origin[0] * vs, p.origin[1] * vs, p.origin[2] * vs],
    });
    if (data.quadCount > 0) {
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(data.positions, 3));
      geo.setAttribute('normal', new THREE.BufferAttribute(data.normals, 3));
      geo.setAttribute('color', new THREE.BufferAttribute(data.colors, 3));
      geo.setAttribute('aAO', new THREE.BufferAttribute(data.ao, 1));
      geo.setAttribute('uv', new THREE.BufferAttribute(data.uvs, 2));
      geo.setIndex(new THREE.BufferAttribute(data.indices, 1));
      geo.computeBoundingSphere();
      geometries.push(geo);
      const mesh = new THREE.Mesh(geo, material);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      node.add(mesh);
    }

    for (const c of p.children) node.add(build(c));
    parts.set(p.name, node);
    return node;
  };

  const root = new THREE.Group();
  root.add(build(model.root));

  return {
    root,
    parts,
    model,
    dispose() {
      for (const g of geometries) g.dispose();
    },
  };
}

/** 骨だけを残した化石データ。図鑑の完成形と掘り出す化石が必ず一致する */
export function extractFossil(model: CreatureModel): Map<string, VoxelGrid> {
  const out = new Map<string, VoxelGrid>();
  for (const [name, p] of model.parts) {
    const g = p.grid.clone();
    for (let i = 0; i < g.data.length; i++) {
      const v = g.data[i];
      if (v === 0) continue;
      // 外殻（皮膚）は落とし、骨質のスロットと内部構造だけを残す
      g.data[i] = BONE_SLOTS.has(v) ? SLOT.ACCENT : SLOT.EMPTY;
    }
    out.set(name, g);
  }
  return out;
}
