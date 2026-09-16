import type { FormationId, Stance, TargetPref } from '../game/battle/types';
import type { QualityTier } from './Quality';
import type { BiomeId } from '../voxel/palette';

/**
 * セーブデータ。
 *
 * フェーズ境界でのみ保存し、フェーズ途中の状態は持たない。
 * 「発掘の途中で電車を降りた」ときはそのエリアの開始状態へ戻す。
 * 実装が単純で、途中状態の改竄もできない。
 */

export const SAVE_VERSION = 1;
const KEY = 'strata-core.save.v1';

export interface OwnedRevos {
  uid: string;
  defId: string;
  level: number;
  exp: number;
  /** クリーン度 C（0-100）。再研磨では高いほうだけを採用する */
  clean: number;
  skillLevel: number;
  obtainedAt: number;
}

export interface SaveData {
  version: number;
  createdAt: number;
  updatedAt: number;
  player: { name: string; level: number; exp: number; coins: number };
  roster: OwnedRevos[];
  party: { order: [string, string, string] | null; formation: FormationId; stances: Stance[]; targetPrefs: TargetPref[] };
  /** 未精錬の化石ストック */
  stock: { defId: string; rarity: number; biome: BiomeId }[];
  dex: string[];
  unlockedBiomes: BiomeId[];
  stageProgress: number;
  /** クリア済みイベントの id。報酬のリヴォスは初回だけ配る */
  events: { cleared: string[] };
  stats: { runs: number; fossils: number; battles: number; wins: number; voxelsDug: number };
  daily: { date: string; runs: number };
  settings: {
    quality: QualityTier | 'auto';
    /** true: 右半分で移動・左半分で視点（既定） */
    swapSides: boolean;
    sfx: number;
    bgm: number;
    battleSpeed: 1 | 2 | 3;
    autoOd: boolean;
    reducedShake: boolean;
  };
}

export function todayKey(): string {
  // 4:00 JST 区切り。深夜プレイが「翌日扱い」にならないようにする
  const now = new Date(Date.now() + 9 * 3600_000 - 4 * 3600_000);
  return now.toISOString().slice(0, 10);
}

export function defaultSave(): SaveData {
  return {
    version: SAVE_VERSION,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    player: { name: 'ディガー', level: 1, exp: 0, coins: 300 },
    roster: [],
    party: {
      order: null,
      formation: 'wedge',
      stances: ['balanced', 'balanced', 'balanced'],
      targetPrefs: ['front', 'lowhp', 'support'],
    },
    stock: [],
    dex: [],
    unlockedBiomes: ['canyon'],
    stageProgress: 0,
    events: { cleared: [] },
    stats: { runs: 0, fossils: 0, battles: 0, wins: 0, voxelsDug: 0 },
    daily: { date: todayKey(), runs: 0 },
    settings: {
      quality: 'auto',
      swapSides: true,
      sfx: 0.8,
      bgm: 0.5,
      battleSpeed: 1,
      autoOd: true,
      reducedShake: false,
    },
  };
}

/** 旧オリジナル名から実在種への読み替え表 */
const DEF_ID_ALIASES: Record<string, string> = {
  gravodon: 'ankylosaurus',
  ignirapt: 'yutyrannus',
  abyssmaul: 'kronosaurus',
  cerciwing: 'pteranodon',
  terracrest: 'triceratops',
  pyroceras: 'goyocephale',
  nereidon: 'shonisaurus',
  zepharis: 'velociraptor',
  obsidon: 'tyrannosaurus',
  luminax: 'pachycephalosaurus',
  tectos: 'iguanodon',
  volcanix: 'spinosaurus',
  // スプライト差し替え時の暫定名から正式名へ
  mosasaurus: 'shonisaurus',
};

/** 既存プレイヤーの手持ち・図鑑・ストックを新IDへ移す */
function migrateDefIds(data: SaveData): void {
  const map = (id: string): string => DEF_ID_ALIASES[id] ?? id;
  for (const r of data.roster ?? []) r.defId = map(r.defId);
  for (const s of data.stock ?? []) s.defId = map(s.defId);
  data.dex = [...new Set((data.dex ?? []).map(map))];
}

export function load(): SaveData {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return defaultSave();
    const data = JSON.parse(raw) as SaveData;
    if (data.version !== SAVE_VERSION) return migrate(data);
    // 日付が変わっていたら周回数をリセット（逓減ドロップの基準）
    const t = todayKey();
    if (data.daily?.date !== t) data.daily = { date: t, runs: 0 };
    migrateDefIds(data);
    const base = defaultSave();
    // 浅いマージだと、後から足した設定キーが既存プレイヤーに一生届かない。
    // settings と party はネストしているので個別に埋める
    return {
      ...base,
      ...data,
      settings: { ...base.settings, ...(data.settings ?? {}) },
      player: { ...base.player, ...(data.player ?? {}) },
      party: { ...base.party, ...(data.party ?? {}) },
      events: { ...base.events, ...(data.events ?? {}) },
      stats: { ...base.stats, ...(data.stats ?? {}) },
    };
  } catch {
    return defaultSave();
  }
}

function migrate(old: Partial<SaveData>): SaveData {
  const base = defaultSave();
  // 将来のバージョン差分はここで吸収する。今は安全側に倒して新規扱い
  if (typeof old.player?.coins === 'number') base.player.coins = old.player.coins;
  return base;
}

let saveTimer: number | undefined;

export function save(data: SaveData): void {
  data.updatedAt = Date.now();
  try {
    localStorage.setItem(KEY, JSON.stringify(data));
  } catch {
    // プライベートブラウズや容量超過。ゲームは続行させる
  }
}

/** 連続保存を1本にまとめる。掘るたびに書くとiOSで重い */
export function saveDebounced(data: SaveData, ms = 600): void {
  if (saveTimer !== undefined) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => save(data), ms) as unknown as number;
}

export function clearSave(): void {
  try { localStorage.removeItem(KEY); } catch { /* noop */ }
}

/** 当日のN周目におけるレア以上の出現率倍率。壁ではなく勾配で止める */
export function dropDecay(runsToday: number): number {
  return Math.max(0.25, Math.pow(0.88, Math.max(0, runsToday)));
}

/** Lv n → n+1 に必要なEXP */
export function expToNext(level: number): number {
  return Math.round(38 * Math.pow(level, 1.55));
}

export function addExp(unit: OwnedRevos, amount: number, cap = 30): { leveled: number } {
  let leveled = 0;
  unit.exp += amount;
  while (unit.level < cap && unit.exp >= expToNext(unit.level)) {
    unit.exp -= expToNext(unit.level);
    unit.level++;
    leveled++;
  }
  if (unit.level >= cap) unit.exp = 0;
  return { leveled };
}

export function makeUid(): string {
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
}
