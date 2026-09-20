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
  /**
   * デバッグモードで配った個体。
   *
   * 掘って削って手に入れたものと区別できないと、検証用に全種を出したあと
   * 元の手持ちに戻せなくなる。印を付けておけば、まとめて外せる。
   */
  debug?: boolean;
}

/** 便りに添える品。ここに無い種類は配らない——受け取り側で分岐が増える */
export type MailReward =
  | { kind: 'coin'; amount: number }
  /** 未精錬のまま受信箱から届く。削る手間は省かない */
  | { kind: 'fossil'; defId: string; rarity: number; biome: BiomeId };

export interface MailItem {
  id: string;
  /** login: ログインボーナス / staff: 運営からの配布 */
  from: 'login' | 'staff';
  title: string;
  body: string;
  rewards: MailReward[];
  sentAt: number;
  /**
   * 受け取った時刻。受け取り済みの便りも一覧に残す——
   * 何をいつ貰ったかを後から確かめられないと、配布の履歴が消える
   */
  claimedAt?: number;
  /** 期限。過ぎたものは受け取れない。無期限は undefined */
  expiresAt?: number;
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
  /** 受信箱。新しいものが先頭 */
  mail: MailItem[];
  /**
   * ログインの記録。
   *
   * 連続日数は「昨日も来たか」で決める。1日でも空けば 1 に戻す——
   * 途切れても総日数は残すので、周回の位置（7日周期のどこか）は進み続ける。
   */
  login: { lastDate: string; streak: number; total: number; deliveredStaff: string[] };
  /**
   * 記録。
   *
   * 「何回やったか」ではなく「どこまでやったか」が残るように取る。
   * 回数だけを並べると、長く遊ぶほど数字が伸びるだけの表になる——
   * 最高値と最短記録を混ぜて、更新しに行く対象を作る。
   *
   * 増やすときは必ず加算する側も同時に書くこと。配線のない項目は
   * 永久に 0 のまま並び、プロフィールがただの飾りになる。
   */
  stats: {
    // --- 発掘 ---
    runs: number;
    /** 実際に崩したボクセル数。1掘りで十数個ぶん消える */
    voxelsDug: number;
    /** 掘り当てた埋蔵物の数（精錬前） */
    found: number;
    /** 掘り当てた最高レア度 */
    bestRarity: number;
    /** バイオームごとの潜行回数 */
    biomeRuns: Record<string, number>;

    // --- 精錬 ---
    /** 精錬を終えた化石の数 */
    fossils: number;
    /** 到達した最高クリーン度 */
    bestClean: number;
    /** Sランクの回数 */
    sRanks: number;

    // --- バトル ---
    battles: number;
    wins: number;
    /** 現在の連勝数 */
    streak: number;
    bestStreak: number;
    kos: number;
    /** 累計の与ダメージ */
    damage: number;
    /** 最大の一撃 */
    bestHit: number;
    odFired: number;
    /** 最短で決めた勝利の行動数。未達成は 0 */
    fastestWin: number;
    /** リヴォスごとの出撃回数 */
    sorties: Record<string, number>;

    // --- 時間 ---
    /** 累計プレイ時間（秒） */
    playSeconds: number;
  };
  /**
   * ミッション。
   *
   * 達成の判定は保存しない——条件はすべて stats と手持ちから引ける。
   * 持つのは「受け取ったかどうか」だけにして、条件を足したり直したりしても
   * 既存の進捗が壊れないようにする。
   */
  missions: {
    /** 実績の受取済み id */
    claimed: string[];
    /** 日課。日付が変われば claimed ごと空にする */
    daily: { date: string; claimed: string[] };
  };
  /** 読んだお知らせの id。未読の数だけ拠点に出す */
  news: { read: string[] };
  /** 商店。日ごとの購入回数を数える */
  shop: { date: string; bought: Record<string, number> };
  daily: {
    date: string;
    runs: number;
    /**
     * 日課の数取り。
     *
     * stats は累計しか持たないので、「今日やったか」が引けない。
     * 累計との差を覚えるやり方だと、日付が変わる瞬間を跨いだときに
     * ずれる——その日のぶんだけを別に数える。
     */
    counts: Record<string, number>;
  };
  settings: {
    quality: QualityTier | 'auto';
    /** true: 右半分で移動・左半分で視点（既定） */
    swapSides: boolean;
    sfx: number;
    bgm: number;
    battleSpeed: 1 | 2 | 3;
    autoOd: boolean;
    reducedShake: boolean;
    /** デバッグモードを開いたことがある。拠点にタイルを出すかどうか */
    debug?: boolean;
    /** 図鑑の並び。開くたびに選び直させない */
    dexSort?: 'index' | 'rarity' | 'element' | 'role' | 'owned';
    dexDesc?: boolean;
  };
}

export function todayKey(at = Date.now()): string {
  // 4:00 JST 区切り。深夜プレイが「翌日扱い」にならないようにする
  const now = new Date(at + 9 * 3600_000 - 4 * 3600_000);
  return now.toISOString().slice(0, 10);
}

/** 1日前の鍵。連続ログインの判定に使う */
export function yesterdayKey(at = Date.now()): string {
  return todayKey(at - 24 * 3600_000);
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
    mail: [],
    login: { lastDate: '', streak: 0, total: 0, deliveredStaff: [] },
    stats: {
      runs: 0, voxelsDug: 0, found: 0, bestRarity: 0, biomeRuns: {},
      fossils: 0, bestClean: 0, sRanks: 0,
      battles: 0, wins: 0, streak: 0, bestStreak: 0,
      kos: 0, damage: 0, bestHit: 0, odFired: 0, fastestWin: 0, sorties: {},
      playSeconds: 0,
    },
    missions: { claimed: [], daily: { date: todayKey(), claimed: [] } },
    news: { read: [] },
    shop: { date: todayKey(), bought: {} },
    daily: { date: todayKey(), runs: 0, counts: {} },
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
    if (data.daily?.date !== t) data.daily = { date: t, runs: 0, counts: {} };
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
      mail: data.mail ?? [],
      login: { ...base.login, ...(data.login ?? {}) },
      missions: {
        claimed: data.missions?.claimed ?? [],
        daily: { ...base.missions.daily, ...(data.missions?.daily ?? {}) },
      },
      news: { read: data.news?.read ?? [] },
      shop: { ...base.shop, ...(data.shop ?? {}), bought: { ...(data.shop?.bought ?? {}) } },
      daily: { ...base.daily, ...(data.daily ?? {}), counts: { ...(data.daily?.counts ?? {}) } },
      stats: {
        ...base.stats,
        ...(data.stats ?? {}),
        // 連想配列は浅いマージで undefined のまま残る。触る側が毎回
        // 存在チェックするより、ここで1回そろえる
        biomeRuns: { ...(data.stats?.biomeRuns ?? {}) },
        sorties: { ...(data.stats?.sorties ?? {}) },
      },
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

/**
 * 日付をまたいだぶんを巻き戻す。
 *
 * 起動時にしか見ていないと、開きっぱなしで 4 時を越えたときに
 * 日課が前日のまま止まる。拠点へ戻るたびに通す。
 */
export function rollDaily(data: SaveData, at = Date.now()): boolean {
  const t = todayKey(at);
  let moved = false;
  if (data.daily.date !== t) { data.daily = { date: t, runs: 0, counts: {} }; moved = true; }
  if (data.missions.daily.date !== t) { data.missions.daily = { date: t, claimed: [] }; moved = true; }
  if (data.shop.date !== t) { data.shop = { date: t, bought: {} }; moved = true; }
  return moved;
}

/** 今日ぶんの数取り。累計（stats）を足す側と必ず対で呼ぶ */
export function countToday(data: SaveData, key: string, n = 1): void {
  rollDaily(data);
  data.daily.counts[key] = (data.daily.counts[key] ?? 0) + n;
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

/**
 * 探索者本人の経験値。
 *
 * ホームに Lv と EXP バーが出ているのに、どこからも加算していなかった。
 * 表示だけがあって動かない要素は、無いよりたちが悪い。
 * リヴォスと違って上限を置かない——遊んだぶんだけ伸びる目盛りにする。
 */
export function addPlayerExp(data: SaveData, amount: number): { leveled: number } {
  const p = data.player;
  let leveled = 0;
  p.exp += amount;
  while (p.exp >= expToNext(p.level)) {
    p.exp -= expToNext(p.level);
    p.level++;
    leveled++;
    if (leveled > 50) break; // 異常値で固まらせない
  }
  return { leveled };
}

export function makeUid(): string {
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
}
