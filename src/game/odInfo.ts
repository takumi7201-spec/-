import { REVOS, type RevosDef } from './data/revos';
import { skillMultiplier } from './battle/simulate';

/**
 * 必殺技の効き目を、その個体の数字で出す。
 *
 * 説明文は「単体に大ダメージ」としか言わない。威力 128 と 185 の差も、
 * 攻撃力 96 の個体と 175 の個体の差も、文章からは読めない——育てた結果が
 * 技の側にどう出ているのかが、どこにも書いていなかった。
 *
 * ここは戦闘の計算式を、説明のためにもう一度なぞる場所になる。本物は
 * simulate.ts にあり、こちらは「いま押したら、だいたいこれくらい」を
 * 出すだけ。式を2か所に持つのは避けたいが、片方は相手も盤面も要るので、
 * 相手を1つに決めて（標準の相手）数字にする。
 */

/** ダメージの基礎係数。simulate.ts の computeDamage と同じ */
const DMG_K = 4.15;
/** 除算形の防御。150 / (150 + DEF) */
const DR_BASE = 150;
/** 会心の倍率 */
const CRIT_MUL = 1.8;

/**
 * 「標準の相手」の防御。ロスター全体の平均から取る。
 *
 * 誰に当てるかで通る量は倍ちがう。相手を決めずに「攻撃力 × 威力」を
 * 出すと実際の2倍近い数字になり、見た目ほど減らないことになる——
 * 同じレベルの平均的な相手を1つ置いて、そこへ通る量で揃える。
 */
const AVG_DEF = Math.round(REVOS.reduce((s, r) => s + r.def, 0) / REVOS.length);

const levelScale = (level: number): number => 1 + 0.055 * (level - 1);
const cleanMul = (clean: number): number => 0.88 + 0.0024 * clean;

/** 標準の相手のクリーン度。中位の仕上がりに置く */
const REF_CLEAN = 70;

export interface OdLine {
  label: string;
  value: string;
  /**
   * 技レベルで積み上がったぶん。能力の「+197」と同じ読み方をさせる——
   * 合計だけ出すと、重ねた手間がどこへ行ったのか分からない。
   * 技Lv1 なら 0 で、画面には出さない。
   */
  skillAdd?: number;
  /** 補足。条件つきで伸びるぶんなど */
  note?: string;
}

/** 効き目を出すのに要る、その個体の数字 */
export interface OdStats {
  atk: number;
  def: number;
  maxHp: number;
  level: number;
  /** 重ねた回数。必殺の重さに乗る（Lv5 で ×1.28） */
  skillLevel: number;
}

/**
 * 技の形。説明文からは読めない「何発ぶんか」だけを持つ。
 *   hits  … 1回の発動で通る回数（既定 1）
 *   all   … 敵全体に同じ量が通る
 *   crit  … 必ず会心になる
 *   upTo  … 条件つきで伸びる倍率と、その条件
 */
interface OdShape {
  hits?: number;
  all?: boolean;
  crit?: boolean;
  upTo?: [number, string];
}

const SHAPES: Record<string, OdShape> = {
  flamevolley: { hits: 2, upTo: [1.5, '相手が火傷なら3発'] },
  boundfang: { hits: 3 },
  serpentvenom: { hits: 2 },
  forkjaw: { hits: 2 },
  straightbore: { hits: 2 },
  galerend: { all: true },
  scorchring: { all: true },
  erosionstorm: { all: true },
  greateruption: { all: true },
  abyssalmaw: { all: true },
  hatzegwing: { all: true },
  hornrout: { all: true },
  falsejaw: { all: true },
  nervejam: { all: true },
  gazepierce: { crit: true },
  obsidiancut: { upTo: [230 / 175, '相手の体力が半分未満'] },
  bonesever: { upTo: [2, '相手の体力が 35% 未満'] },
  firstgust: { upTo: [2, '相手がまだ動いていない'] },
  crimsoncharge: { upTo: [2, '倒しきれたら次の1体へ'] },
};

/**
 * 攻撃力に掛かる回復・盾。
 * 値は simulate.ts の performOd から引いたもので、変えたら両方を直す。
 */
const FROM_ATK: Record<string, { k: number; label: string }> = {
  tideheal: { k: 2.6, label: '回復（最も傷んだ味方）' },
  tangledspiral: { k: 1.15, label: '回復（味方全体）' },
  nestguard: { k: 1.25, label: '回復（味方全体）' },
};

/** 防御に掛かる盾 */
const FROM_DEF: Record<string, { k: number; label: string }> = {
  rockaegis: { k: 3.0, label: 'シールド（味方全体）' },
  shellveil: { k: 2.2, label: 'シールド（味方全体／自分は2倍）' },
  miregift: { k: 2.4, label: 'シールド（味方全体）' },
};

/** 最大体力に掛かるもの */
const FROM_HP: Record<string, { k: number; label: string }> = {
  grindfeed: { k: 0.2, label: '再生の総量（味方全体）' },
};

/**
 * その個体がいま撃ったら、どれだけ効くか。
 *
 * 必殺ゲージぶんの上乗せ（100→150 で ×1.35）は入れない。ちょうど
 * 100 で撃ったときの値を基準にして、伸びしろは注記で言う——
 * 基準が溜め具合で動くと、2体を見比べられない。
 */
export function odReadout(def: RevosDef, s: OdStats): OdLine[] {
  const out: OdLine[] = [];
  const id = def.od.id;
  const shape = SHAPES[id] ?? {};
  // 重ねたぶん。威力にも、攻撃力や防御から出る量にも同じだけ乗る
  const skill = skillMultiplier(s.skillLevel);

  /** 1行ぶん。技レベルを外した値との差を、上積みとして添える */
  const line = (label: string, raw: number, note?: string): OdLine => {
    const total = Math.round(raw);
    return {
      label,
      value: total.toLocaleString('ja-JP'),
      skillAdd: total - Math.round(raw / skill),
      note,
    };
  };

  if (def.od.power > 0) {
    // 標準の相手。同じレベルまで育った、平均的な硬さの個体
    const refDef = AVG_DEF * levelScale(s.level) * cleanMul(REF_CLEAN);
    const dr = DR_BASE / (DR_BASE + refDef);
    let one = DMG_K * (def.od.power / 100) * s.atk * dr * skill;
    if (shape.crit) one *= CRIT_MUL;
    const hits = shape.hits ?? 1;
    const total = one * hits;

    out.push(line(
      shape.all ? 'ダメージ（1体あたり）' : hits > 1 ? `ダメージ ${hits}発の合計` : 'ダメージ',
      total,
      // 条件つきで伸びるぶん。「◯◯なら」は条件文の側に書いてあるので、
      // ここでは矢印でつなぐだけにする
      shape.upTo
        ? `${shape.upTo[1]} → ${Math.round(total * shape.upTo[0]).toLocaleString('ja-JP')}`
        : undefined,
    ));
  }

  const atkOne = FROM_ATK[id];
  if (atkOne) out.push(line(atkOne.label, s.atk * atkOne.k * skill));

  const defOne = FROM_DEF[id];
  if (defOne) out.push(line(defOne.label, s.def * defOne.k * skill));

  const hpOne = FROM_HP[id];
  if (hpOne) out.push(line(hpOne.label, s.maxHp * hpOne.k * skill));

  // 技ごとの、式に乗らない取り返し
  if (id === 'harvest') out.push({ label: '自分へ還す', value: '与えたダメージの 28%' });
  if (id === 'unknownancestor') out.push({ label: '自分を回復', value: 'そのときの体力の 20%' });

  return out;
}

/** 必殺ゲージを限界まで溜めたときの上乗せ。説明の足もとに一度だけ出す */
export const OD_OVERCHARGE = 1.35;

/** 標準の相手の硬さ。画面で「何に当てた値か」を言うのに使う */
export function refDefenderDef(level: number): number {
  return Math.round(AVG_DEF * levelScale(level) * cleanMul(REF_CLEAN));
}
