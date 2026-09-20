import { addPlayerExp, type SaveData } from '../core/Save';
import { REVOS } from './data/revos';

/**
 * ミッション。
 *
 * 達成の判定を保存しない。条件はすべて stats・図鑑・進行度から引けるので、
 * 「達成した」という状態を別に持つと、条件を足したり直したりするたびに
 * 保存側と食い違う。持つのは受け取ったかどうかだけにする。
 *
 * 日課と記録を分けるのは、報酬の桁が2つ違うから。日課は毎日拾える小銭で、
 * 記録は1回きりの区切り——同じ表に混ぜると、金額の大きいほうだけが
 * 目標に見えて、毎日の手触りが消える。
 */

export type MissionGroup = 'daily' | 'record';

export interface MissionDef {
  id: string;
  group: MissionGroup;
  name: string;
  /** 何を数えているか。名前だけでは条件が読めない */
  desc: string;
  goal: number;
  /** 進捗の後ろに置く単位 */
  unit: string;
  coins: number;
  exp: number;
  progress(d: SaveData): number;
}

const dexAll = REVOS.length;

export const MISSIONS: MissionDef[] = [
  // ---- 日課。1日で無理なく届く量に置く ----
  {
    id: 'd-dig', group: 'daily', name: '今日の潜行', desc: '発掘に 1 回出る',
    goal: 1, unit: '回', coins: 120, exp: 20,
    progress: (d) => d.daily.counts.dig ?? 0,
  },
  {
    id: 'd-clean', group: 'daily', name: '今日の精錬', desc: '化石を 2 つ削り上げる',
    goal: 2, unit: '個', coins: 180, exp: 30,
    progress: (d) => d.daily.counts.clean ?? 0,
  },
  {
    id: 'd-win', group: 'daily', name: '今日の戦果', desc: 'バトルに 3 回勝つ',
    goal: 3, unit: '勝', coins: 240, exp: 40,
    progress: (d) => d.daily.counts.win ?? 0,
  },
  {
    id: 'd-od', group: 'daily', name: '今日の一撃', desc: '必殺技を 5 回撃つ',
    goal: 5, unit: '回', coins: 150, exp: 25,
    progress: (d) => d.daily.counts.od ?? 0,
  },

  // ---- 記録。1回きりの区切り ----
  {
    id: 'r-runs20', group: 'record', name: '地層を読む', desc: '通算 20 回 潜る',
    goal: 20, unit: '回', coins: 400, exp: 70,
    progress: (d) => d.stats.runs,
  },
  {
    id: 'r-dex5', group: 'record', name: '収蔵のはじまり', desc: '図鑑に 5 種 載せる',
    goal: 5, unit: '種', coins: 300, exp: 60,
    progress: (d) => d.dex.length,
  },
  {
    id: 'r-dex12', group: 'record', name: '層を跨ぐ', desc: '図鑑に 12 種 載せる',
    goal: 12, unit: '種', coins: 800, exp: 140,
    progress: (d) => d.dex.length,
  },
  {
    id: 'r-dexall', group: 'record', name: '完本', desc: `図鑑を ${dexAll} 種すべて埋める`,
    goal: dexAll, unit: '種', coins: 2400, exp: 400,
    progress: (d) => d.dex.length,
  },
  {
    id: 'r-clean90', group: 'record', name: '削りの目', desc: 'クリーン度 90 に届く',
    goal: 90, unit: '', coins: 600, exp: 100,
    progress: (d) => d.stats.bestClean,
  },
  {
    id: 'r-srank3', group: 'record', name: '三度のS', desc: 'S ランクを 3 回 出す',
    goal: 3, unit: '回', coins: 700, exp: 120,
    progress: (d) => d.stats.sRanks,
  },
  {
    id: 'r-rare5', group: 'record', name: '特級の兆し', desc: '★5 の埋蔵物を掘り当てる',
    goal: 5, unit: '★', coins: 1500, exp: 250,
    progress: (d) => d.stats.bestRarity,
  },
  {
    id: 'r-stage5', group: 'record', name: '前線を押す', desc: 'ステージ 5 を踏破する',
    goal: 5, unit: '段', coins: 500, exp: 90,
    progress: (d) => d.stageProgress,
  },
  {
    id: 'r-stage10', group: 'record', name: '深部へ', desc: 'ステージ 10 を踏破する',
    goal: 10, unit: '段', coins: 1200, exp: 200,
    progress: (d) => d.stageProgress,
  },
  {
    id: 'r-streak5', group: 'record', name: '連勝', desc: '5 連勝する',
    goal: 5, unit: '勝', coins: 650, exp: 110,
    progress: (d) => d.stats.bestStreak,
  },
  {
    id: 'r-hit1500', group: 'record', name: '会心の一撃', desc: '1 発で 1500 ダメージ出す',
    goal: 1500, unit: '', coins: 550, exp: 90,
    progress: (d) => d.stats.bestHit,
  },
  {
    id: 'r-ko100', group: 'record', name: '百体', desc: '通算 100 体 撃破する',
    goal: 100, unit: '体', coins: 900, exp: 150,
    progress: (d) => d.stats.kos,
  },
];

export type MissionState = 'doing' | 'ready' | 'claimed';

export function isClaimed(d: SaveData, m: MissionDef): boolean {
  return m.group === 'daily'
    ? d.missions.daily.claimed.includes(m.id)
    : d.missions.claimed.includes(m.id);
}

export function missionState(d: SaveData, m: MissionDef): MissionState {
  if (isClaimed(d, m)) return 'claimed';
  return m.progress(d) >= m.goal ? 'ready' : 'doing';
}

/** 0..1。表示用に丸めない——帯の長さは端数のぶんだけ伸びていい */
export function missionRatio(d: SaveData, m: MissionDef): number {
  return Math.max(0, Math.min(1, m.progress(d) / Math.max(1, m.goal)));
}

/** 受け取れる件数。拠点の報せに出す */
export function readyCount(d: SaveData): number {
  return MISSIONS.filter((m) => missionState(d, m) === 'ready').length;
}

/**
 * いま「いちばんクリアに近い」1件。
 *
 * 受け取れるものがあれば、どれだけ進んでいるかより先にそれを出す。
 * 達成済みの札が埋もれたまま次の目標を案内されると、取り忘れる。
 * 未達のなかでは達成率で選び、同率なら報酬の小さいほうから——
 * 先に片付くものを出さないと、いつまでも同じ札が居座る。
 */
export function nearestMission(d: SaveData): MissionDef | null {
  const ready = MISSIONS.filter((m) => missionState(d, m) === 'ready');
  if (ready.length > 0) return ready.sort((a, b) => a.coins - b.coins)[0];
  const doing = MISSIONS.filter((m) => missionState(d, m) === 'doing');
  if (doing.length === 0) return null;
  return doing.sort((a, b) => missionRatio(d, b) - missionRatio(d, a) || a.coins - b.coins)[0];
}

/** 受け取り。受け取れない状態なら何もせず false */
export function claimMission(d: SaveData, id: string): MissionDef | null {
  const m = MISSIONS.find((x) => x.id === id);
  if (!m || missionState(d, m) !== 'ready') return null;
  if (m.group === 'daily') d.missions.daily.claimed.push(m.id);
  else d.missions.claimed.push(m.id);
  d.player.coins += m.coins;
  addPlayerExp(d, m.exp);
  return m;
}
