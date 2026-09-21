import { Screen } from '../UIRoot';
import { h, button, clear } from '../dom';
import type { OwnedRevos } from '../../core/Save';
import { RARITY_NAMES, ROLE_NAMES, getRevos } from '../../game/data/revos';
import { ELEMENT_NAMES, BIOMES } from '../../voxel/palette';
import { cleanMultiplier, cleanRank } from '../../game/battle/simulate';
import { revosIcon } from '../revosIcon';
import { spaced } from '../chrome';
import { engraveChip } from './CleanChoiceScreen';
import { audio } from '../../core/Audio';

/** 帯の満ち具合を決める基準値。種ごとの差が読める幅に取る */
const STAT_CEIL = { hp: 1900, atk: 180, def: 170, spd: 148 } as const;

export interface DetailParams {
  defId: string;
  /** この個体を開いているなら、種の基準値ではなく手元の値を出す */
  unit?: OwnedRevos;
  owned?: OwnedRevos[];
  /** 閉じたときの行き先 */
  back: () => void;
  /** 編成へ送る導線。図鑑から開いたときだけ出す */
  onEquip?: () => void;
}

/**
 * 個体の詳細。
 *
 * 下から引き出す紙ではなく、1枚の画面にする。ここで読む情報
 * （特性・必殺・産出）は編成を決める材料なので、他の面に半分隠れたまま
 * 読ませると、結局スクロールして全部出すことになる。
 */
export class DetailScreen extends Screen {
  private p: DetailParams | null = null;

  private artEl!: HTMLElement;
  private tagEl!: HTMLElement;
  private headEl!: HTMLElement;
  private nameEl!: HTMLElement;
  private latinEl!: HTMLElement;
  private statsEl!: HTMLElement;
  private engraveEl!: HTMLElement;
  private passiveEl!: HTMLElement;
  private odEl!: HTMLElement;
  private habitatEl!: HTMLElement;
  private habitatLabel!: HTMLElement;
  private equipBtn!: HTMLButtonElement;

  constructor() { super('detail'); }

  build(): void {
    this.artEl = h('div', { class: 'det-art' });
    this.tagEl = h('div', { class: 'det-tag' });
    this.headEl = h('div', { class: 'det-head' });
    this.nameEl = h('div', { class: 'det-name' });
    this.latinEl = h('div', { class: 'det-latin' });
    this.statsEl = h('div', { class: 'det-stats' });
    this.engraveEl = h('div', { class: 'det-engrave' });
    this.passiveEl = h('div', { class: 'det-skill det-skill--passive' });
    this.odEl = h('div', { class: 'det-skill det-skill--od' });
    this.habitatEl = h('div', { class: 'det-habitat' });
    this.habitatLabel = h('div', { class: 'det-habitat-label' });
    this.equipBtn = button('編成する', () => { audio.uiConfirm(); this.p?.onEquip?.(); },
      { class: 'btn--primary det-equip' });

    const close = button('✕', () => { audio.uiBack(); this.p?.back(); }, { class: 'btn--rail det-close' });

    this.el.append(
      this.artEl,
      close,
      this.tagEl,
      h('div', { class: 'det-body' },
        h('div', { class: 'det-title' }, this.headEl, this.nameEl, this.latinEl),
        this.statsEl,
        this.engraveEl,
        this.passiveEl,
        this.odEl,
        h('div', { class: 'det-foot' },
          h('div', { class: 'det-habitat-main' },
            this.habitatLabel,
            this.habitatEl,
          ),
          this.equipBtn,
        ),
      ),
    );
  }

  enter(params?: unknown): void {
    const p = params as DetailParams | undefined;
    if (!p) return;
    this.p = p;
    const r = getRevos(p.defId);
    const u = p.unit;
    // 手元の個体を開いているときは、その育ち方を反映した値を出す。
    // 種の基準値を見せても「この子がどれだけ強いか」は分からない
    const ls = u ? 1 + 0.055 * (u.level - 1) : 1;
    const mc = u ? cleanMultiplier(u.clean) : 1;
    const val = (base: number): number => Math.round(base * ls * mc);
    // 精錬でどれだけ足された（削られた）か。クリーン度50を素の状態として、
    // そこからの差を別の色で出す——倍率のままでは、削った手間が数字に見えない
    const cleanDelta = (base: number, scaled: boolean): number =>
      u && scaled ? Math.round(base * ls * mc) - Math.round(base * ls) : 0;

    clear(this.artEl);
    this.artEl.appendChild(revosIcon(r.id, 'det-art-img'));

    clear(this.tagEl);
    this.tagEl.className = `det-tag ${r.rarity === 5 ? 'det-tag--holo' : ''}`;
    this.tagEl.appendChild(h('span', { text: spaced(RARITY_NAMES[r.rarity]) }));

    clear(this.headEl);
    this.headEl.append(
      h('span', { class: `chip chip--${r.element}` },
        h('i', { class: 'chip-dot' }),
        ELEMENT_NAMES[r.element],
      ),
      h('span', { class: 'det-role', text: spaced(ROLE_NAMES[r.role]) }),
      h('span', { class: 'det-stars', text: '★'.repeat(r.rarity) }),
    );
    this.nameEl.textContent = r.name;
    this.latinEl.textContent = r.en;

    clear(this.statsEl);
    // クリーン度が掛かるのは体力・攻撃・防御だけ。速度には乗らない
    const rows: [string, number, number, string, number][] = [
      ['体力', val(r.hp), STAT_CEIL.hp, '#3fa772', cleanDelta(r.hp, true)],
      ['攻撃', val(r.atk), STAT_CEIL.atk, '#de523c', cleanDelta(r.atk, true)],
      ['防御', val(r.def), STAT_CEIL.def, '#3f97d6', cleanDelta(r.def, true)],
      ['速度', Math.round(r.spd * ls), STAT_CEIL.spd, 'var(--hl-amber)', 0],
    ];
    for (const [k, v, ceil, c, delta] of rows) {
      this.statsEl.appendChild(h('div', { class: 'det-stat' },
        h('div', { class: 'det-stat-label', text: k }),
        h('div', { class: 'det-stat-num num', text: v.toLocaleString('ja-JP') }),
        delta !== 0
          ? h('div', {
            class: `det-stat-delta num ${delta > 0 ? 'is-up' : 'is-down'}`,
            text: `${delta > 0 ? '+' : '−'}${Math.abs(delta)}`,
          })
          : null,
        h('div', { class: 'det-stat-bar' },
          h('i', { style: `width:${Math.min(100, (v / ceil) * 100)}%;background:${c}` }),
        ),
      ));
    }

    // 刻印はこの個体だけのもの。種の性能表とは別の段に置く——
    // 同じ行に混ぜると、図鑑に並ぶ数値が個体ごとに違って見える
    clear(this.engraveEl);
    this.engraveEl.hidden = !u?.engraving;
    if (u?.engraving) {
      this.engraveEl.append(
        h('span', { class: 'det-engrave-tag', text: spaced('刻印') }),
        engraveChip(u.engraving, 'is-cur'),
      );
    }

    clear(this.passiveEl);
    this.passiveEl.append(
      h('div', { class: 'det-skill-head' },
        h('span', { class: 'det-skill-tag', text: spaced('特性') }),
        h('span', { class: 'det-skill-name', text: r.passive.name }),
      ),
      h('div', { class: 'det-skill-desc', text: r.passive.desc }),
    );
    clear(this.odEl);
    this.odEl.append(
      h('div', { class: 'det-skill-head' },
        h('span', { class: 'det-skill-tag', text: spaced('必殺') }),
        h('span', { class: 'det-skill-name', text: r.od.name }),
      ),
      h('div', { class: 'det-skill-desc', text: r.od.desc }),
    );

    // 産出。手元に居るなら、居る事実のほうが先に要る
    clear(this.habitatEl);
    const owned = p.owned ?? [];
    this.habitatLabel.textContent = spaced(u || owned.length > 0 ? '手持ち' : '産出');
    if (u) {
      this.habitatEl.append(
        h('span', { class: 'num', text: `Lv${u.level}` }),
        ` · ${cleanRank(u.clean)}ランク（クリーン度 ${u.clean}）`,
      );
      // 精錬ぶんの合計を1行にまとめる。個々の +NN が何の色かを説明する
      const sum = cleanDelta(r.hp, true) + cleanDelta(r.atk, true) + cleanDelta(r.def, true);
      if (sum !== 0) {
        this.habitatEl.append(h('span', {
          class: `det-clean-sum ${sum > 0 ? 'is-up' : 'is-down'}`,
          text: `精錬 ${sum > 0 ? '+' : '−'}${Math.abs(sum)}`,
        }));
      }
    } else if (owned.length > 0) {
      this.habitatEl.append(
        '所持 ', h('span', { class: 'num', text: String(owned.length) }), ' 体 — 最高クリーン度 ',
        h('span', { class: 'num', text: String(Math.max(...owned.map((o) => o.clean))) }),
      );
    } else {
      // まだ持っていない個体。どこで出るかと、持っていない事実を並べる
      this.habitatEl.append(
        h('span', { class: 'det-nothave', text: spaced('未所持') }),
        r.habitat.map((b) => BIOMES[b]?.name ?? b).join(' / '),
      );
    }

    this.equipBtn.hidden = !p.onEquip;
  }
}
