import { REVOS, getRevos } from './data/revos';
import type { OwnedRevos, SaveData } from '../core/Save';
import { makeUid } from '../core/Save';
import type { FormationId, TargetPref, TeamSetup } from './battle/types';
import { Rng } from '../voxel/VoxelPainter';

/** 所持ユニットから編成を作る。足りなければ先頭から埋める */
export function buildTeamSetup(
  roster: OwnedRevos[],
  order: [string, string, string] | null,
  formation: FormationId,
  prefs?: TargetPref[],
): TeamSetup | null {
  if (roster.length === 0) return null;
  const byUid = new Map(roster.map((r) => [r.uid, r]));
  const picked: OwnedRevos[] = [];
  if (order) {
    for (const uid of order) {
      const u = byUid.get(uid);
      if (u && !picked.includes(u)) picked.push(u);
    }
  }
  for (const r of roster) {
    if (picked.length >= 3) break;
    if (!picked.includes(r)) picked.push(r);
  }
  while (picked.length < 3) picked.push(picked[picked.length % Math.max(1, picked.length)]);

  const members = picked.slice(0, 3);
  return {
    members: members.map((r) => ({
      uid: r.uid,
      defId: r.defId,
      level: r.level,
      clean: r.clean,
      skillLevel: r.skillLevel,
    })),
    order: [0, 1, 2],
    formation,
    // 未設定のスロットは各リヴォスの推奨作戦で埋める
    targetPrefs: members.map((r, i) => prefs?.[i] ?? getRevos(r.defId).defaultPref),
  };
}

/**
 * 敵の強さを合わせるための、出撃する編成の基準値。
 *
 * レベルは切り捨てる。四捨五入すると Lv9/7/7 の編成が「Lv8 の相手」を
 * 引き当てて、3体中2体が格下という状態になる。レベル差は3つのステータスに
 * 同時に効くので、平均より上に置くだけで勝率が 81% → 60% まで落ちる。
 */
export function teamAnchor(setup: TeamSetup): TeamAnchor {
  const n = Math.max(1, setup.members.length);
  const avg = (f: (m: TeamSetup['members'][number]) => number): number =>
    setup.members.reduce((a, m) => a + f(m), 0) / n;
  return { level: Math.floor(avg((m) => m.level)), clean: Math.round(avg((m) => m.clean)) };
}

export interface TeamAnchor { level: number; clean: number; }

/**
 * 敵編成。
 *
 * レベルは「出撃した編成の平均」に合わせる。以前は 3 + stage*2 という
 * 絶対の階段だったが、敵が1ステージで +2 上がるのに対して、こちらは
 * 1勝でおよそ +1、しかも必要EXPが level^1.55 で伸びるので、進むほど
 * 差が開く一方だった。レベル差はHP・ATK・DEFの三方向に同時に効くので、
 * 実測で +2 差 → 勝率39%、+4 差 → 10%、+6 差 → 0%。つまり数戦で
 * 数学的に追いつけなくなる階段を登らされていた。
 *
 * ステージが担うのは「誰と当たるか」——レア度の上限・属性の寄せ方・陣形——
 * であって、素のステータス差ではない。レベルの上乗せは 0 にしてある。
 * 実測でこの置き方の勝率は 61〜81%、終盤ほど低いが、それは相手の
 * レア度が上がるからで、編成を組み替えれば戻せる範囲に収まる。
 */
export function buildEnemyTeam(stage: number, seed: number, anchor: TeamAnchor): TeamSetup {
  const rng = new Rng(seed ^ 0x9e3779b9);
  const level = Math.max(1, anchor.level);
  const themes = ['flame', 'aqua', 'terra', 'gale', 'null'] as const;
  const theme = themes[stage % themes.length];

  // ★5 は終盤まで敵にも出さない。初見で「これは別格」と分かる位置に置く。
  // イベント個体は通常戦には出さない——出会う場所を1か所に限る
  const pool = REVOS.filter(
    (r) => !r.eventOnly && r.rarity <= (stage < 3 ? 2 : stage < 6 ? 3 : stage < 10 ? 4 : 5),
  );
  const themed = pool.filter((r) => r.element === theme);
  const pick = (): string => {
    const list = rng.chance(0.55) && themed.length > 0 ? themed : pool;
    return list[Math.floor(rng.next() * list.length)].id;
  };

  const ids: string[] = [];
  while (ids.length < 3) {
    const id = pick();
    if (!ids.includes(id) || ids.length > 6) ids.push(id);
  }

  return {
    members: ids.map((defId, i) => ({
      uid: `foe${i}`,
      defId,
      level,
      // クリーン度も同じ理由で味方基準。素の育成差で殴らない
      clean: Math.max(45, Math.min(95, anchor.clean + Math.min(10, stage * 2))),
      skillLevel: 1,
    })),
    order: [0, 1, 2],
    // 進行度に応じて陣形も変える。同じ相手を延々見せない
    formation: (['wedge', 'rush', 'ring', 'metro'] as FormationId[])[stage % 4],
  };
}

/** 初回起動時の配布。属性が偏らない3体を渡す */
export function grantStarters(data: SaveData): void {
  if (data.roster.length > 0) return;
  for (const defId of ['ankylosaurus', 'yutyrannus', 'shonisaurus']) {
    data.roster.push({
      uid: makeUid(),
      defId,
      level: 3,
      exp: 0,
      clean: 62,
      skillLevel: 1,
      obtainedAt: Date.now(),
    });
    if (!data.dex.includes(defId)) data.dex.push(defId);
  }
}

/**
 * 新しく加わる個体の開始レベル。
 *
 * Lv1 で渡していたが、進行が進んだ後半に掘り当てた化石は、削り終えた
 * そばから編成に入れられない置物になる。手持ちの中央値の一歩手前から
 * 始める——追いつく手間は残しつつ、出せはする位置。
 */
export function joinLevel(data: SaveData): number {
  if (data.roster.length === 0) return 1;
  const lv = data.roster.map((r) => r.level).sort((a, b) => a - b);
  return Math.max(1, lv[Math.floor(lv.length / 2)] - 1);
}

/** 化石を所持ユニットに変換する。同種を持っていればスキルレベルに還元 */
export function addFossil(data: SaveData, defId: string, clean: number): { isNew: boolean; unit: OwnedRevos } {
  const existing = data.roster.find((r) => r.defId === defId);
  if (existing) {
    existing.skillLevel = Math.min(5, existing.skillLevel + 1);
    // 再研磨と同じ扱いで、高いほうのクリーン度だけを採る
    existing.clean = Math.max(existing.clean, clean);
    return { isNew: false, unit: existing };
  }
  const unit: OwnedRevos = {
    uid: makeUid(),
    defId,
    level: joinLevel(data),
    exp: 0,
    clean,
    skillLevel: 1,
    obtainedAt: Date.now(),
  };
  data.roster.push(unit);
  if (!data.dex.includes(defId)) data.dex.push(defId);
  return { isNew: true, unit };
}

export function revosName(defId: string): string {
  return getRevos(defId).name;
}
