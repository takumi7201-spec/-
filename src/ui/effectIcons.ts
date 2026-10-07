import { h } from './dom';
import { spriteUrl } from '../fx/SpriteUnit';

/**
 * 技が触れる効果の札。
 *
 * これまで「攻撃 +18%」「火傷」の類は、技の説明文の中にしか無かった。
 * 文章は戦闘中には読めないし、説明欄でも他の文と同じ重さで並ぶので、
 * どの技が何に触れるのかが読み比べないと分からない。絵のある効果は
 * すべて絵で出す——戦場ではカードの上に、説明欄では文の下に、同じ札を使う。
 *
 * 下がるほう（デバフ）に札は無い。上がる側の札は矢印が上向きの絵なので、
 * 同じ絵で「下がった」を表すと、見た瞬間に逆の意味を読んでしまう。
 */
export type EffectKind =
  | 'atk' | 'def' | 'spd' | 'dealt' | 'surge'
  | 'burn' | 'poison' | 'dizzy' | 'bleed' | 'clone' | 'timed';

/** 掛かり（上がるもの）。戦場のカードにはこれだけを出す */
export type BuffKind = 'atk' | 'def' | 'spd' | 'dealt';

export const EFFECT_SPRITE: Record<EffectKind, string> = {
  atk: 'buff-atk.gif',
  def: 'buff-def.gif',
  spd: 'buff-spd.gif',
  dealt: 'buff-dealt.gif',
  surge: 'buff-surge.gif',
  burn: 'fx-burn',
  poison: 'fx-poison',
  dizzy: 'fx-dizzy',
  bleed: 'fx-bleed',
  clone: 'fx-clone.gif',
  timed: 'fx-timed.gif',
};

export const EFFECT_NAME: Record<EffectKind, string> = {
  atk: '攻撃上昇',
  def: '防御上昇',
  spd: '速度上昇',
  dealt: '与ダメージ上昇',
  surge: '会心率上昇',
  burn: '火傷',
  poison: '毒',
  dizzy: '目眩',
  bleed: '出血',
  clone: '分身',
  timed: '時間制限',
};

export function effectIcon(kind: EffectKind, className = ''): HTMLElement {
  const img = document.createElement('img');
  img.className = `buff-icon${className ? ` ${className}` : ''}`;
  img.src = spriteUrl(EFFECT_SPRITE[kind]);
  img.alt = EFFECT_NAME[kind];
  img.decoding = 'async';
  return img;
}

/** 絵＋名前。説明欄で「何に触れる技か」を文より先に読ませる */
export function effectChip(kind: EffectKind): HTMLElement {
  return h('span', { class: `buff-chip buff-chip--${kind}` },
    effectIcon(kind),
    h('span', { class: 'buff-chip-name', text: EFFECT_NAME[kind] }),
  );
}

/**
 * 説明文から、触れる効果を拾う。
 *
 * 技ごとの対応表を別に持たない。手で書いた表は、説明文を直したときだけ
 * 古いままになる——文が唯一の出どころなら、ずれようがない。
 *
 * ステータスは名前がそのまま出てくるので名前で拾う。上がり下がりは
 * 「+」が付いているものだけを拾う（「攻撃 −20%」は下がる側なので出さない）。
 * 「攻撃・防御・速度 +10%」のようにまとめて書かれた並びも拾う——
 * 名前の直後に + が来る形だけを見ていると、並びの最後の1つしか拾えない。
 */
const LIST = '(?:・(?:攻撃|防御|速度|体力|与ダメージ|会心率))*';
const upFor = (name: string): RegExp => new RegExp(`${name}${LIST}\\s*[+＋]`);

/** 並びは札の出る順。上がるもの → 付くもの、の順に読ませる */
const PATTERNS: { kind: EffectKind; re: RegExp }[] = [
  { kind: 'atk', re: upFor('攻撃') },
  { kind: 'def', re: upFor('防御') },
  { kind: 'spd', re: upFor('速度') },
  { kind: 'dealt', re: upFor('与ダメージ') },
  // 奔流は率そのものが名前になっている掛かり。名前でも拾う
  { kind: 'surge', re: /奔流|会心率\s*[+＋]/ },
  { kind: 'burn', re: /火傷/ },
  { kind: 'poison', re: /毒/ },
  { kind: 'dizzy', re: /目眩/ },
  { kind: 'bleed', re: /出血/ },
  { kind: 'clone', re: /分身/ },
  /*
   * 時間で切れるもの。
   *
   * この戦闘の掛かりはほとんどが「行動◯回ぶん」で、秒で書かれているものだけが
   * 別の時計で動いている——速くしても縮まらないし、足を止めても延びない。
   * 読み手にとっては別物なので、秒が出てきたら砂時計を添える。
   */
  { kind: 'timed', re: /\d+\s*秒/ },
];

export function effectsInText(text: string): EffectKind[] {
  return PATTERNS.filter((p) => p.re.test(text)).map((p) => p.kind);
}

/** 説明文の下に置く札の列。拾うものが無ければ何も返さない */
export function effectRow(text: string): HTMLElement | null {
  const kinds = effectsInText(text);
  if (kinds.length === 0) return null;
  return h('div', { class: 'buff-row' }, ...kinds.map(effectChip));
}

/** 戦場のカード用。上がる掛かりだけを、絵だけで出す */
export function buffIcon(kind: BuffKind, className = ''): HTMLElement {
  return effectIcon(kind, className);
}
