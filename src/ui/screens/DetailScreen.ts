import { Screen } from '../UIRoot';
import { h, button, clear } from '../dom';
import type { OwnedRevos } from '../../core/Save';
import { RARITY_NAMES, ROLE_NAMES, getRevos } from '../../game/data/revos';
import { ELEMENT_NAMES, BIOMES } from '../../voxel/palette';
import { cleanMultiplier, cleanRank } from '../../game/battle/simulate';
import { revosIcon } from '../revosIcon';
import { spaced } from '../chrome';
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
    const rows: [string, number, number, string][] = [
      ['体力', val(r.hp), STAT_CEIL.hp, '#3fa772'],
      ['攻撃', val(r.atk), STAT_CEIL.atk, '#de523c'],
      ['防御', val(r.def), STAT_CEIL.def, '#3f97d6'],
      ['速度', val(r.spd), STAT_CEIL.spd, 'var(--hl-amber)'],
    ];
    for (const [k, v, ceil, c] of rows) {
      this.statsEl.appendChild(h('div', { class: 'det-stat' },
        h('div', { class: 'det-stat-label', text: k }),
        h('div', { class: 'det-stat-num num', text: v.toLocaleString('ja-JP') }),
        h('div', { class: 'det-stat-bar' },
          h('i', { style: `width:${Math.min(100, (v / ceil) * 100)}%;background:${c}` }),
        ),
      ));
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
