import { h } from './dom';
import { spriteUrl } from '../fx/SpriteUnit';

/**
 * 上がっている掛かりの札。
 *
 * これまで「攻撃 +18%」の類は、技の説明文の中にしか無かった。文章は
 * 戦闘中に読めないし、説明欄でも他の文と同じ重さで並ぶので、何が
 * 上がる技なのかが一覧できない。上がるものは絵で出す——戦場では
 * カードの上に、説明欄では文の下に、同じ4枚を使う。
 *
 * 下がるほう（デバフ）はここでは扱わない。札は矢印が上向きの絵なので、
 * 同じ絵で「下がった」を表すと、見た瞬間に逆の意味を読んでしまう。
 */
export type BuffKind = 'atk' | 'def' | 'spd' | 'dealt' | 'surge';

export const BUFF_SPRITE: Record<BuffKind, string> = {
  atk: 'buff-atk.gif',
  def: 'buff-def.gif',
  spd: 'buff-spd.gif',
  dealt: 'buff-dealt.gif',
  surge: 'buff-surge.gif',
};

export const BUFF_NAME: Record<BuffKind, string> = {
  atk: '攻撃上昇',
  def: '防御上昇',
  spd: '速度上昇',
  dealt: '与ダメージ上昇',
  surge: '奔流（会心率上昇）',
};

export function buffIcon(kind: BuffKind, className = ''): HTMLElement {
  const img = document.createElement('img');
  img.className = `buff-icon${className ? ` ${className}` : ''}`;
  img.src = spriteUrl(BUFF_SPRITE[kind]);
  img.alt = BUFF_NAME[kind];
  img.decoding = 'async';
  return img;
}

/** 絵＋名前。説明欄で「何が上がるのか」を文より先に読ませる */
export function buffChip(kind: BuffKind): HTMLElement {
  return h('span', { class: `buff-chip buff-chip--${kind}` },
    buffIcon(kind),
    h('span', { class: 'buff-chip-name', text: BUFF_NAME[kind] }),
  );
}

/**
 * 説明文から、上がるものを拾う。
 *
 * 札の対応表を別に持たない。技ごとに手で書いた表は、説明文を直した
 * ときだけ古いままになる——文が唯一の出どころなら、ずれようがない。
 * 拾うのは「上がる」側だけ。下がる側（−）は読み飛ばす。
 */
const PATTERNS: { kind: BuffKind; re: RegExp }[] = [
  { kind: 'atk', re: /攻撃\s*\+/ },
  { kind: 'def', re: /防御\s*\+/ },
  { kind: 'spd', re: /速度\s*\+/ },
  { kind: 'dealt', re: /与ダメージ\s*\+/ },
  // 奔流は率そのものが名前になっている掛かり。名前で拾う
  { kind: 'surge', re: /奔流|会心率\s*\+/ },
];

export function buffsInText(text: string): BuffKind[] {
  return PATTERNS.filter((p) => p.re.test(text)).map((p) => p.kind);
}

/** 説明文の下に置く札の列。上がるものが無ければ何も返さない */
export function buffRow(text: string): HTMLElement | null {
  const kinds = buffsInText(text);
  if (kinds.length === 0) return null;
  return h('div', { class: 'buff-row' }, ...kinds.map(buffChip));
}
