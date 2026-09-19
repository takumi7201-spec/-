import { Screen } from '../UIRoot';
import { h, button, clear } from '../dom';
import type { SaveData } from '../../core/Save';
import { REVOS } from '../../game/data/revos';
import { audio } from '../../core/Audio';
import { revosIcon } from '../revosIcon';
import { screenHead, spaced } from '../chrome';

/** 図鑑。未取得はシルエットで見せ、「あと何が居るか」を常に示す */
export class DexScreen extends Screen {
  private data!: SaveData;
  private gridEl!: HTMLElement;
  private countEl!: HTMLElement;
  private filter: string = 'all';
  private chipsEl!: HTMLElement;
  private progFill!: HTMLElement;
  private footEl!: HTMLElement;

  onBack?: () => void;
  /** 詳細は下から引く紙ではなく1枚の画面。行き先はゲーム側が決める */
  onDetail?: (defId: string) => void;

  constructor() { super('dex'); }

  setData(d: SaveData): void { this.data = d; this.render(); }

  build(): void {
    // 収蔵率は数と帯の2つで出す。数だけだと全体の何割かが読めない
    this.countEl = h('div', { class: 'num dex-count' });
    this.progFill = h('i');
    const strip = screenHead({
      eyebrow: '収蔵記録', title: '図鑑',
      onBack: () => this.onBack?.(),
      right: h('div', { class: 'plate dex-plate' },
        h('div', { class: 'plate-inner' },
          this.countEl,
          h('div', { class: 'dex-prog' }, this.progFill),
        ),
      ),
    });

    this.chipsEl = h('div', { class: 'dex-filters' });
    this.gridEl = h('div', { class: 'dex-grid' });
    this.footEl = h('div', { class: 'dex-foot' });
    const body = h('div', { class: 'dex-body' }, this.chipsEl, this.gridEl);
    this.el.append(strip, body, this.footEl);
  }

  enter(): void { this.render(); }

  private render(): void {
    if (!this.data || !this.gridEl) return;
    const owned = new Set(this.data.dex);
    clear(this.countEl);
    this.countEl.append(
      String(owned.size),
      h('span', { class: 'dex-count-total', text: ` / ${REVOS.length}` }),
    );
    this.progFill.style.width = `${(owned.size / Math.max(1, REVOS.length)) * 100}%`;

    clear(this.chipsEl);
    for (const [key, label] of [
      ['all', 'すべて'], ['flame', '火'], ['aqua', '水'], ['terra', '土'], ['gale', '風'], ['null', '無'],
    ] as const) {
      this.chipsEl.appendChild(button(label, () => {
        audio.uiTap();
        this.filter = key;
        this.render();
      }, { class: `btn--sm dex-chip ${this.filter === key ? 'is-on' : 'btn--opt'}` }));
    }

    clear(this.gridEl);
    for (const r of REVOS) {
      if (this.filter !== 'all' && r.element !== this.filter) continue;
      const has = owned.has(r.id);
      const cell = button('', () => has ? this.openDetail(r.id) : audio.uiError(), {
        class: `dex-cell ${has ? '' : 'is-locked'}`,
      });
      // ★5 だけ枠の質感を変える。判定は CSS 側に持たせる
      cell.dataset.rarity = String(r.rarity);
      cell.append(
        h('span', { class: 'dex-art' }, revosIcon(r.id, `dex-icon ${has ? '' : 'is-silhouette'}`)),
        h('span', { class: 'dex-row' },
          h('i', { class: `dot dot--${has ? r.element : 'void'}` }),
          h('span', { class: 'dex-name', text: has ? r.name : '？？？' }),
        ),
        h('span', { class: 'dex-rarity', text: has ? '★'.repeat(r.rarity) : spaced('未記載') }),
      );
      cell.title = has ? r.name : '未記載';
      this.gridEl.appendChild(cell);
    }

    // 足もと。長押しの案内と、いま何を見ているかの内訳
    const holo = REVOS.filter((r) => r.rarity === 5 && owned.has(r.id)).length;
    clear(this.footEl);
    this.footEl.append(
      h('span', { class: 'dex-foot-note', text: spaced('長押しで詳細') }),
      h('span', { class: 'dex-foot-rule' }),
      h('span', { class: 'dex-foot-note' },
        '★5 は ', h('span', { class: 'num', text: String(holo) }), ' 体',
      ),
    );
  }

  private openDetail(id: string): void {
    audio.uiTap();
    this.onDetail?.(id);
  }
}
