import type { QualityTier } from './Quality';
import type { RunState } from '../game/run/run';

/**
 * セーブデータ。
 *
 * 遊びはランだけになった。持つのは進行中のランと記録、コイン、設定、
 * 読んだお知らせだけ。ランは店の並びごと持つので、戦闘の合間に閉じても続きから戻れる。
 */

export const SAVE_VERSION = 2;
const KEY = 'strata-core.save.v1';

export interface SaveData {
  version: number;
  createdAt: number;
  updatedAt: number;
  player: { name: string; level: number; coins: number };
  /** 進行中のラン */
  run?: RunState | null;
  /** ランの記録 */
  runRecord?: { best: number; clears: number; runs: number };
  /** 読んだお知らせの id。未読の数だけ拠点に出す */
  news: { read: string[] };
  stats: {
    /** 累計プレイ時間（秒） */
    playSeconds: number;
  };
  settings: {
    quality: QualityTier | 'auto';
    sfx: number;
    bgm: number;
  };
}

export function todayKey(at = Date.now()): string {
  // 4:00 JST 区切り。深夜プレイが「翌日扱い」にならないようにする
  const now = new Date(at + 9 * 3600_000 - 4 * 3600_000);
  return now.toISOString().slice(0, 10);
}

export function defaultSave(): SaveData {
  return {
    version: SAVE_VERSION,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    player: { name: 'ディガー', level: 1, coins: 300 },
    run: null,
    runRecord: { best: 0, clears: 0, runs: 0 },
    news: { read: [] },
    stats: { playSeconds: 0 },
    settings: { quality: 'auto', sfx: 0.8, bgm: 0.5 },
  };
}

export function load(): SaveData {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return defaultSave();
    const old = JSON.parse(raw) as Partial<SaveData> & { version?: number };
    const base = defaultSave();
    /*
     * 版1（発掘・精錬・手持ちのあった頃）から来たときは、コイン・設定・
     * お知らせの既読・プレイ時間だけを引き継ぐ。手持ちや図鑑は読み捨てる。
     * 進行中のランは版2以降のものだけを信じる（版1のランは試作の途中の形）
     */
    const keepRun = old.version === SAVE_VERSION;
    return {
      ...base,
      createdAt: old.createdAt ?? base.createdAt,
      player: {
        ...base.player,
        coins: typeof old.player?.coins === 'number' ? old.player.coins : base.player.coins,
        level: typeof old.player?.level === 'number' ? old.player.level : 1,
      },
      run: keepRun ? old.run ?? null : null,
      runRecord: { ...base.runRecord!, ...(old.runRecord ?? {}) },
      news: { read: old.news?.read ?? [] },
      stats: { playSeconds: old.stats?.playSeconds ?? 0 },
      settings: {
        quality: old.settings?.quality ?? base.settings.quality,
        sfx: old.settings?.sfx ?? base.settings.sfx,
        bgm: old.settings?.bgm ?? base.settings.bgm,
      },
    };
  } catch {
    return defaultSave();
  }
}

export function save(data: SaveData): void {
  data.updatedAt = Date.now();
  data.version = SAVE_VERSION;
  try {
    localStorage.setItem(KEY, JSON.stringify(data));
  } catch {
    // プライベートブラウズや容量超過。ゲームは続行させる
  }
}

export function clearSave(): void {
  try { localStorage.removeItem(KEY); } catch { /* noop */ }
}
