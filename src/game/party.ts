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
 * 敵編成。ステージ進行に応じてレベルと構成が上がる。
 * 「次のステージを抜けるには地属性が要る」という因果を作るため、
 * 進行度ごとに寄せる属性を決めておく。
 */
export function buildEnemyTeam(stage: number, seed: number): TeamSetup {
  const rng = new Rng(seed ^ 0x9e3779b9);
  const level = Math.max(1, 3 + stage * 2);
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
      clean: 55 + Math.min(35, stage * 4),
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
    level: 1,
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
