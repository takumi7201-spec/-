import { REVOS, getRevos } from './data/revos';
import type { OwnedRevos, SaveData } from '../core/Save';
import { makeUid } from '../core/Save';
import type { FormationId, TargetPref, TeamSetup } from './battle/types';
import { Rng } from '../voxel/VoxelPainter';
import { BIOMES, type BiomeId } from '../voxel/palette';
import { cleanMultiplier } from './battle/simulate';
import { ENGRAVE_PATTERNS, buildEngraving, type Engraving } from './engraving';

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
      engraving: r.engraving,
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
/**
 * ステージが決めるもの。
 *
 * レベルではなく「誰と当たるか」。選択画面もここから読む——
 * 表示用に別の表を持つと、片方だけ直したときに嘘の予告になる。
 */
export interface StagePreview {
  theme: 'flame' | 'aqua' | 'terra' | 'gale' | 'null';
  rarityCap: number;
  formation: FormationId;
  cleanBonus: number;
  /** 闘技場の地層。選択画面の表示と実際の舞台を同じ1か所から引く */
  biome: BiomeId;
}

const STAGE_THEMES = ['flame', 'aqua', 'terra', 'gale', 'null'] as const;
const STAGE_FORMATIONS = ['wedge', 'rush', 'ring', 'metro'] as FormationId[];

export function stagePreview(stage: number): StagePreview {
  const biome = Object.values(BIOMES).find((b) => stage >= b.level[0] && stage <= b.level[1])
    ?? Object.values(BIOMES)[0];
  return {
    biome: biome.id,
    theme: STAGE_THEMES[stage % STAGE_THEMES.length],
    // ★5 は終盤まで敵にも出さない。初見で「これは別格」と分かる位置に置く
    rarityCap: stage < 3 ? 2 : stage < 6 ? 3 : stage < 10 ? 4 : 5,
    formation: STAGE_FORMATIONS[stage % STAGE_FORMATIONS.length],
    cleanBonus: Math.min(10, stage * 2),
  };
}

export function buildEnemyTeam(stage: number, seed: number, anchor: TeamAnchor): TeamSetup {
  const rng = new Rng(seed ^ 0x9e3779b9);
  const level = Math.max(1, anchor.level);
  const pv = stagePreview(stage);
  const theme = pv.theme;

  // イベント個体は通常戦には出さない——出会う場所を1か所に限る
  const pool = REVOS.filter((r) => !r.eventOnly && r.rarity <= pv.rarityCap);
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
      clean: Math.max(45, Math.min(95, anchor.clean + pv.cleanBonus)),
      skillLevel: 1,
      /*
       * 刻印は敵にも乗せる。
       *
       * 味方だけが別枠の加算を積めると、段が進むほど差が開く一方になる——
       * 刻印は「掘って削る」の報酬であって、難度を素通りさせる道具ではない。
       * 等級は段から決め、銘は席ごとに固定する（同じ段は同じ相手になる）。
       */
      engraving: stage >= 4
        ? buildEngraving(
          ENGRAVE_PATTERNS[(stage * 3 + i) % ENGRAVE_PATTERNS.length],
          Math.max(1, Math.min(4, Math.floor(stage / 4))),
        )
        : undefined,
    })),
    order: [0, 1, 2],
    // 進行度に応じて陣形も変える。同じ相手を延々見せない
    formation: pv.formation,
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

/**
 * 化石を所持ユニットに変換する。
 *
 * 同じ種でも別の個体として迎える。以前は問答無用で先に持っている個体へ
 * 吸わせていたので、クリーン度 96 の2体目を削り上げても、手元に残るのは
 * 数字が1つ動いた1体だけだった——削った時間の行き先が見えない。
 *
 * どちらにするかは精錬の後に選ばせる。ここは「別個体として迎える」側で、
 * 重ねる側は mergeFossil が受け持つ。
 */
export function addFossil(
  data: SaveData, defId: string, clean: number, engraving?: Engraving,
): { isNew: boolean; unit: OwnedRevos } {
  const isNew = !data.dex.includes(defId);
  const unit: OwnedRevos = {
    uid: makeUid(),
    defId,
    level: joinLevel(data),
    exp: 0,
    clean,
    skillLevel: 1,
    engraving,
    obtainedAt: Date.now(),
  };
  data.roster.push(unit);
  if (isNew) data.dex.push(defId);
  return { isNew, unit };
}

/**
 * 削り上げた化石を、すでに持っている個体へ重ねる。
 *
 * クリーン度は高いほうだけを採る。刻印を付け替えるかは呼び出し側が決める——
 * 速度 +5 と体力 +160 のどちらが要るかは、編成を見ないと決まらない。
 */
export function mergeFossil(
  data: SaveData,
  targetUid: string,
  clean: number,
  engraving: Engraving | undefined,
  takeEngraving: boolean,
): OwnedRevos | null {
  const u = data.roster.find((r) => r.uid === targetUid);
  if (!u) return null;
  u.clean = Math.max(u.clean, clean);
  u.skillLevel = Math.min(5, u.skillLevel + 1);
  if (takeEngraving && engraving) u.engraving = engraving;
  if (!data.dex.includes(u.defId)) data.dex.push(u.defId);
  return u;
}

export function revosName(defId: string): string {
  return getRevos(defId).name;
}

/**
 * 実際に出撃する3体。
 *
 * order が未設定でも buildTeamSetup は手持ちの先頭から埋めて出撃させる。
 * 画面側が order をそのまま読むと「0 / 3」と出て、出撃できないように
 * 見える——出撃時と同じ埋め方をここに1つ置き、表示も戦力もここから引く。
 */
export function effectiveParty(data: SaveData): OwnedRevos[] {
  const byUid = new Map(data.roster.map((r) => [r.uid, r]));
  const out: OwnedRevos[] = [];
  for (const uid of data.party.order ?? []) {
    const u = byUid.get(uid);
    if (u && !out.includes(u)) out.push(u);
  }
  for (const r of data.roster) {
    if (out.length >= 3) break;
    if (!out.includes(r)) out.push(r);
  }
  return out.slice(0, 3);
}

/**
 * 編成の戦力。
 *
 * 体力と攻撃・防御を1つの数にまとめた目安。攻撃と防御を4倍で数えるのは、
 * 体力だけが桁違いに大きく、素で足すと壁役の並びが常に最強に見えるため。
 *
 * 画面ごとに違う式で出すと、どちらが本当の値か分からなくなる。
 * 編成でもユニットの入口でも、数えるのはここ1か所にする。
 */
export function partyPower(data: SaveData): number {
  let hp = 0, atk = 0, def = 0;
  for (const u of effectiveParty(data)) {
    const d = getRevos(u.defId);
    const ls = 1 + 0.055 * (u.level - 1);
    const mc = cleanMultiplier(u.clean);
    hp += Math.round(d.hp * ls * mc);
    atk += Math.round(d.atk * ls * mc);
    def += Math.round(d.def * ls * mc);
  }
  return hp + atk * 4 + def * 4;
}
