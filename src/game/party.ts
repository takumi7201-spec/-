import { getRevos } from './data/revos';
import type { OwnedRevos, SaveData } from '../core/Save';
import { makeUid } from '../core/Save';
import type { TeamSetup } from './battle/types';
import type { BiomeId, ElementId } from '../voxel/palette';
import { cleanMultiplier } from './battle/simulate';
import { ENGRAVE_PATTERNS, buildEngraving, type Engraving } from './engraving';
import { stageDef, stageEngravePattern, stageRarityCap, stageTheme } from './data/stages';

/** 出撃する枠の数 */
export const PARTY_SIZE = 5;

/**
 * 所持ユニットから編成を作る。空いた枠は手持ちの先頭から埋める。
 *
 * 手持ちが枠より少なければ、そのぶん少ないまま出す。以前は同じ個体を
 * 重ねて数を合わせていたが、同じ uid が戦場に2体立つことになる——
 * 敵の数を出撃した数に合わせるので、少ないまま出ても不利にはならない。
 */
export function buildTeamSetup(
  roster: OwnedRevos[],
  order: string[] | null,
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
    if (picked.length >= PARTY_SIZE) break;
    if (!picked.includes(r)) picked.push(r);
  }

  const members = picked.slice(0, PARTY_SIZE);
  return {
    members: members.map((r) => ({
      uid: r.uid,
      defId: r.defId,
      level: r.level,
      clean: r.clean,
      skillLevel: r.skillLevel,
      engraving: r.engraving,
    })),
    order: members.map((_, i) => i),
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
  return {
    level: Math.floor(avg((m) => m.level)),
    clean: Math.round(avg((m) => m.clean)),
    size: setup.members.length,
  };
}

/** size は出撃した数。敵はこの数に揃える——5対3で殴られる段を作らない */
export interface TeamAnchor { level: number; clean: number; size: number }

/**
 * ステージが決めるもの。
 *
 * 30段すべて固定表（stages.ts）から読む。表示も実際の相手も同じ1か所から
 * 引く——選択画面用に別の表を持つと、片方だけ直したときに嘘の予告になる。
 */
export interface StagePreview {
  name: string;
  theme: ElementId;
  rarityCap: number;
  biome: BiomeId;
  /** 相手のレベル。こちらの編成は見ない */
  level: number;
  /** 相手の数。段が進むと 2 → 5 に増える */
  size: number;
  hint: string;
  /** 席順そのままの顔ぶれ */
  foes: string[];
}

export function stagePreview(stage: number): StagePreview {
  const s = stageDef(stage);
  return {
    name: s.name,
    biome: s.biome,
    theme: stageTheme(s),
    rarityCap: stageRarityCap(s),
    level: s.level,
    size: s.foes.length,
    hint: s.hint,
    foes: s.foes,
  };
}

/**
 * 敵編成。固定表をそのまま組み立てる。
 *
 * 以前はこちらの編成の平均レベルに合わせていた。勝ってレベルが上がれば
 * 相手も上がるので、育てても掘っても相手がぴったり並んでくる——段を
 * 進めた実感が残らないうえ、育てない側も不利にならなかった。
 *
 * 今は段の番号だけで決まる。乱数も種も使わない。第11段の相手は誰が
 * 何度挑んでも同じ4体・同じレベル・同じ刻印で、勝てないなら掘って
 * 削って育てるしかない——そのための掘りが、ここでようやく意味を持つ。
 */
export function buildEnemyTeam(stage: number): TeamSetup {
  const s = stageDef(stage);
  return {
    members: s.foes.map((defId, i) => ({
      uid: `foe${i}`,
      defId,
      level: s.level,
      clean: s.clean,
      skillLevel: 1,
      // 段ごとの手応えを平らにする倍率。顔ぶれの噛み合いの差を吸う
      boost: s.power !== 1 ? { hp: s.power, atk: s.power, def: s.power } : undefined,
      // 刻印は敵にも乗せる。味方だけが別枠の加算を積めると、段が進むほど
      // 差が開く一方になる。銘は役職から引くので、同じ段は必ず同じ相手
      engraving: s.grade > 0
        ? buildEngraving(
          ENGRAVE_PATTERNS.find((p) => p.id === stageEngravePattern(defId)) ?? ENGRAVE_PATTERNS[0],
          s.grade,
        )
        : undefined,
    })),
    order: s.foes.map((_, i) => i),
  };
}

/** 初回起動時の配布。属性が偏らない3体を渡す（残りの枠は掘って埋める） */
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
 * 実際に出撃する面々（最大 PARTY_SIZE 体）。
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
    if (out.length >= PARTY_SIZE) break;
    if (!out.includes(r)) out.push(r);
  }
  return out.slice(0, PARTY_SIZE);
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
