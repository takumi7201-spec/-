import * as THREE from 'three';

/** hex配列 → リニア空間のRGBパレット（greedyMesher がそのまま頂点色に焼く） */
export function buildPalette(hexes: readonly number[]): Float32Array {
  const arr = new Float32Array(256 * 3);
  const c = new THREE.Color();
  for (let i = 0; i < hexes.length && i < 256; i++) {
    c.setHex(hexes[i], THREE.SRGBColorSpace);
    arr[i * 3] = c.r;
    arr[i * 3 + 1] = c.g;
    arr[i * 3 + 2] = c.b;
  }
  return arr;
}

/** 地形ボクセルのスロット定義 */
export const T = {
  EMPTY: 0,
  SAND: 1,
  SAND_DARK: 2,
  DIRT: 3,
  CLAY: 4,
  ROCK: 5,
  HARDROCK: 6,
  FOSSIL: 7,
  CRYSTAL: 8,
  GRASS: 9,
  MOSS: 10,
  VEIN: 11,
  GRAVEL: 12,
  ACCENT: 13,
} as const;

export type BiomeId = 'canyon' | 'frostpeak' | 'emberfield' | 'tidehollow';

export interface Biome {
  id: BiomeId;
  name: string;
  /** 一言説明。エリア選択UIに出す */
  tagline: string;
  palette: Float32Array;
  /** 空・フォグ・光の基調 */
  sky: number;
  horizon: number;
  fog: number;
  sunColor: number;
  sunIntensity: number;
  ambientSky: number;
  ambientGround: number;
  ambientIntensity: number;
  /** 地形の起伏の強さ */
  relief: number;
  /** 硬い岩の割合（掘削難度） */
  hardness: number;
  /** 推奨レベル帯 */
  level: [number, number];
}

const CANYON = buildPalette([
  0x000000,
  0xd8b483, 0xc09a68, 0x8a6a45, 0xa87f56,
  0x7d6a5c, 0x5d5049, 0xe8d9a8, 0x7fd7e8,
  0x86a05a, 0x6f8c4a, 0xc45a3a, 0x9a8a78, 0xf0e2c0,
]);

const FROST = buildPalette([
  0x000000,
  0xe6eef5, 0xc7d6e4, 0x8496a8, 0xa9bccd,
  0x6b7684, 0x4d5763, 0xdff2ff, 0x8fe4ff,
  0x9fc3b6, 0x7aa899, 0x5ea9d8, 0x8b97a3, 0xffffff,
]);

const EMBER = buildPalette([
  0x000000,
  0x5c4438, 0x47332b, 0x33241f, 0x6b4a36,
  0x3d322e, 0x2a2321, 0xffb35c, 0xff7a3c,
  0x6a5a3a, 0x4f4530, 0xff4d2e, 0x4a3f3a, 0xffd9a0,
]);

const TIDE = buildPalette([
  0x000000,
  0xcfd8b8, 0xa9b696, 0x6f7a5e, 0x8b9a77,
  0x5d6b6a, 0x44514f, 0xd8f5e0, 0x6fe8c8,
  0x6aa87a, 0x4d8a62, 0x3fb0a0, 0x7a8a88, 0xeafff4,
]);

export const BIOMES: Record<BiomeId, Biome> = {
  canyon: {
    id: 'canyon',
    name: 'ソルト・キャニオン',
    tagline: '乾いた層に浅く眠る、最初の発掘場',
    palette: CANYON,
    sky: 0xffd9a0, horizon: 0xffb877, fog: 0xe9c89a,
    sunColor: 0xfff0d0, sunIntensity: 3.1,
    ambientSky: 0xbfe0ff, ambientGround: 0x8a6a45, ambientIntensity: 0.85,
    relief: 1.0, hardness: 0.28, level: [1, 8],
  },
  frostpeak: {
    id: 'frostpeak',
    name: 'フロストピーク',
    tagline: '氷漬けの保存状態、ただし岩は硬い',
    palette: FROST,
    sky: 0xcfe6ff, horizon: 0xa9cbe8, fog: 0xc6dcee,
    sunColor: 0xe8f2ff, sunIntensity: 2.7,
    ambientSky: 0xd8ecff, ambientGround: 0x6b7684, ambientIntensity: 1.05,
    relief: 1.35, hardness: 0.52, level: [6, 16],
  },
  emberfield: {
    id: 'emberfield',
    name: 'エンバーフィールド',
    tagline: '火山灰の下、レア個体の密度が高い',
    palette: EMBER,
    sky: 0x2a1a24, horizon: 0x6b2a1e, fog: 0x39211f,
    sunColor: 0xffb070, sunIntensity: 2.2,
    ambientSky: 0x5a3040, ambientGround: 0xff5a28, ambientIntensity: 0.95,
    relief: 1.6, hardness: 0.68, level: [12, 26],
  },
  tidehollow: {
    id: 'tidehollow',
    name: 'タイドホロウ',
    tagline: '干上がった内海。水棲種の墓場',
    palette: TIDE,
    sky: 0xa8d8d0, horizon: 0x86bdb6, fog: 0x9fcfc6,
    sunColor: 0xe6fff8, sunIntensity: 2.5,
    ambientSky: 0xbfeee6, ambientGround: 0x4d6b62, ambientIntensity: 1.0,
    relief: 0.8, hardness: 0.4, level: [9, 20],
  },
};

/** 属性ごとのクリーチャー配色（CreatureBuilder の SLOT に対応） */
export type ElementId = 'flame' | 'aqua' | 'terra' | 'gale' | 'null';

export const ELEMENT_PALETTES: Record<ElementId, Float32Array> = {
  flame: buildPalette([0x000000, 0xd1503a, 0x8f2f22, 0xf0a878, 0xffb63c, 0xf5e6c8, 0x1a1012, 0x2a1512, 0xff7a2a]),
  aqua: buildPalette([0x2f7fb8, 0x2f7fb8, 0x1d5687, 0xa8dcf0, 0x64e0d8, 0xeaf6ff, 0x0c1a24, 0x10222e, 0x5ff0e0]),
  terra: buildPalette([0x000000, 0x7a9a4a, 0x4f7030, 0xd8d08a, 0xc08a3a, 0xf0e8c8, 0x14180e, 0x22260f, 0xb8f04a]),
  gale: buildPalette([0x000000, 0x8a7fc8, 0x5c4f9a, 0xd8d0f0, 0xf0e04a, 0xffffff, 0x14101f, 0x1c1830, 0xf8f060]),
  null: buildPalette([0x000000, 0x9a9088, 0x6e665f, 0xd8d0c8, 0xb8a888, 0xf0ece4, 0x181614, 0x242018, 0xd8d0b0]),
};

export const ELEMENT_COLORS: Record<ElementId, number> = {
  flame: 0xff6a3c,
  aqua: 0x3cc8ff,
  terra: 0x8ad84a,
  gale: 0xc8a4ff,
  null: 0xdcd2c0,
};

export const ELEMENT_NAMES: Record<ElementId, string> = {
  flame: '火',
  aqua: '水',
  terra: '土',
  gale: '風',
  null: '無',
};
