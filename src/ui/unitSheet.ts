import { h } from './dom';
import { getRevos } from '../game/data/revos';
import { KIT_TRAIT, KIT_TRAITS } from '../game/data/traits';
import { runDef } from '../game/run/units';
import { effectValue } from '../game/run/battle';
import {
  unitValues, unitCooldown, abilityText, traitsText, starOf, fmt,
  EFFECT_GLYPH, EFFECT_NAMES, EFFECT_HELP,
} from '../game/run/describe';
import {
  BOARD_COLS, BOARD_ROWS, BOARD_SIZE, colOf, rowOf, neighbors,
  type AbilityDef, type RunUnit,
} from '../game/run/types';
import { revosIcon } from './revosIcon';

/** 置き場所が決まっていない（店・図鑑）ときに、範囲の図で仮に置く枠。中段の左 */
export const EXAMPLE_SLOT = BOARD_COLS;

/**
 * ユニット1体ぶんの詳しい中身。店のポップアップと図鑑で同じものを出す。
 *
 *   名前・段・★・系統 → 強化後の数値（今 → 重ねた後 → ★2 → ★3）
 *   → 効果の範囲の図 → 効果の説明・性質・能力・育ち → 操作
 */
export function unitSheet(u: RunUnit, opts: {
  /** 店の札で、盤面の同じユニットに重ねられるとき。重ねた後の姿 */
  merged?: RunUnit | null;
  /** 盤面に置かれている枠。null なら仮の枠で範囲を描く */
  slot?: number | null;
  /** 範囲の図で、どの枠に味方が居るかを見せる */
  board?: (RunUnit | null)[];
  /** 見出しの右（閉じるボタンなど） */
  corner?: HTMLElement | null;
  /** いちばん下の操作 */
  actions?: HTMLElement | null;
} = {}): HTMLElement {
  const d = runDef(u.defId);
  const def = getRevos(u.defId);
  const kit = KIT_TRAIT[u.defId];
  const star = starOf(u);
  const base = opts.merged ?? u;

  const steps = [
    { label: '今', unit: u },
    ...(starOf(base) > star ? [{ label: '重ねた後', unit: base }] : []),
    ...[2, 3].filter((s) => s > starOf(base)).map((s) => ({ label: `★${s}`, unit: { ...base, copies: s === 2 ? 3 : 9 } })),
  ];
  const kinds = unitValues({ ...base, copies: 9 }).map((v) => v.kind);

  const table = h('div', { class: 'xs-table', style: `grid-template-columns: auto repeat(${steps.length}, 1fr)` });
  table.append(h('span', { class: 'xs-th' }), ...steps.map((st, i) => h('span', { class: `xs-th ${i > 0 ? 'is-up' : ''}`, text: st.label })));
  for (const k of kinds) {
    table.append(h('span', { class: `run-val run-val--${k}` }, h('i', { text: EFFECT_GLYPH[k] }), EFFECT_NAMES[k]));
    let prev = -1;
    for (const st of steps) {
      const v = effectValue(d, st.unit, k);
      table.append(h('span', { class: `xs-td num ${prev >= 0 && v > prev ? 'is-up' : ''}`, text: fmt(v) }));
      prev = v;
    }
  }
  table.append(h('span', { class: 'xs-tk', text: 'クールダウン' }),
    ...steps.map((st) => h('span', { class: 'xs-td num', text: `${fmt(unitCooldown(st.unit))}s` })));

  const need = star >= 3 ? '' : `あと${(star === 1 ? 3 : 9) - u.copies}体で★${star + 1}`;
  const grown = Object.entries(u.perm).filter(([, v]) => v);

  const lines = h('div', { class: 'xs-lines' });
  for (const k of kinds) lines.appendChild(h('div', { class: 'xs-help', text: `${EFFECT_NAMES[k]}：${EFFECT_HELP[k]}` }));
  for (const t of traitsText(u.defId)) lines.appendChild(h('div', { class: 'xs-trait', text: `◆ ${t}` }));
  for (const ab of d.abilities) lines.appendChild(h('div', { class: 'xs-ab', text: `▸ ${abilityText(u.defId, ab)}` }));
  if (grown.length) {
    lines.appendChild(h('div', { class: 'xs-grown', text: `育ち（永続）：${grown.map(([k, v]) => `${k === 'cd' ? 'クールダウン' : k === 'charge' ? '溜まり' : EFFECT_NAMES[k as keyof typeof EFFECT_NAMES]} ${(v as number) > 0 ? '+' : ''}${fmt(v as number)}`).join('、')}` }));
  }

  return h('div', { class: 'xs' },
    h('div', { class: 'xs-head' },
      revosIcon(u.defId, 'xs-icon'),
      h('div', { class: 'xs-title' },
        h('b', { text: def.name }),
        h('span', { class: 'xs-sub', text: `段${d.tier} · ${'★'.repeat(star)}${u.copies > 1 ? `（${u.copies}体）` : ''}${kit ? ` · ${KIT_TRAITS[kit].name}` : ''}${need ? ` · ${need}` : ''}` }),
      ),
      opts.corner ?? null,
    ),
    h('div', { class: 'label xs-label', text: '強化後の数値' }),
    table,
    rangeMap(u.defId, opts.slot ?? null, opts.board),
    lines,
    opts.actions ?? null,
  );
}

/** 範囲の1行ぶん。どの枠に何が届くか */
interface Reach { label: string; own: number[]; foe: number[] }

/**
 * 効果の範囲の図。
 *
 * 相手の盤面（上・薄く）と自分の盤面（下）を並べ、自分の枠に「自」、
 * 届く味方の枠を緑、届く相手の枠を赤で塗る。範囲を持たない（自分だけに
 * 効く）ユニットには出さない。
 */
export function rangeMap(defId: string, slot: number | null, board?: (RunUnit | null)[]): HTMLElement | null {
  const d = runDef(defId);
  const at = slot ?? EXAMPLE_SLOT;
  const reaches: Reach[] = [];
  const all = Array.from({ length: BOARD_SIZE }, (_, i) => i);
  const kin = KIT_TRAIT[defId];
  const addAb = (ab: AbilityDef): void => {
    const what = ab.stat === 'charge' ? '溜まり' : ab.stat === 'cd' ? 'クールダウン' : EFFECT_NAMES[ab.stat];
    if (ab.to === 'adj' || ab.to === 'left' || ab.to === 'right') {
      reaches.push({ label: `${ab.when === 'adjFire' ? 'ここが発動すると届く' : what}`, own: neighbors(at, ab.to), foe: [] });
    } else if (ab.to === 'others' || ab.to === 'kin') {
      reaches.push({ label: `${what}（${ab.to === 'kin' ? `${kin ? KIT_TRAITS[kin].name : ''}の味方` : '他の味方全員'}）`, own: all.filter((i) => i !== at), foe: [] });
    } else if (ab.to === 'allies') {
      reaches.push({ label: `${what}（味方全員）`, own: all, foe: [] });
    }
  };
  for (const ab of d.abilities) {
    // 隣が発動したときに自分へ効く能力は、きっかけの範囲（隣）を見せる
    if (ab.when === 'adjFire') reaches.push({ label: '隣が発動すると、自分に効く', own: neighbors(at), foe: [] });
    else addAb(ab);
  }
  if (d.fire.haste) reaches.push({ label: '加速', own: neighbors(at), foe: [] });
  // 正面: 同じ列のいちばん前（相手の盤面は上の段が前列なので、図では下の段の側）
  if (d.fire.slow) reaches.push({ label: '遅延（正面の相手）', own: [], foe: [colOf(at)] });
  if (reaches.length === 0) return null;

  const wrap = h('div', { class: 'xs-range' });
  wrap.appendChild(h('div', { class: 'label xs-label', text: slot === null ? '効果の範囲（この枠に置いたとき）' : '効果の範囲' }));
  for (const r of reaches) {
    const own = new Set(r.own), foe = new Set(r.foe);
    const grid = (side: 'foe' | 'own'): HTMLElement => {
      const g = h('div', { class: `xs-grid xs-grid--${side}`, style: `grid-template-columns: repeat(${BOARD_COLS}, 1fr)` });
      // 相手の盤面は前列が下に来るよう、段を逆さに並べる（向かい合わせ）
      const rows = Array.from({ length: BOARD_ROWS }, (_, k) => (side === 'foe' ? BOARD_ROWS - 1 - k : k));
      for (const row of rows) {
        for (let c = 0; c < BOARD_COLS; c++) {
          const i = row * BOARD_COLS + c;
          const hit = side === 'own' ? own.has(i) : foe.has(i);
          const self = side === 'own' && i === at;
          const filled = side === 'own' && !!board?.[i];
          g.appendChild(h('span', {
            class: `xs-cell ${self ? 'is-self' : ''} ${hit ? (side === 'own' ? 'is-ally' : 'is-foe') : ''} ${filled ? 'is-filled' : ''}`,
            text: self ? '自' : hit && side === 'foe' ? '◎' : '',
          }));
        }
      }
      return g;
    };
    wrap.appendChild(h('div', { class: 'xs-reach' },
      h('div', { class: 'xs-boards' },
        r.foe.length ? grid('foe') : null,
        r.foe.length ? h('div', { class: 'xs-vs', text: '↑相手' }) : null,
        grid('own'),
      ),
      h('span', { class: 'xs-reach-label', text: r.label }),
    ));
  }
  return wrap;
}

export { rowOf };
