import { Screen } from '../UIRoot';
import { h, button, clear } from '../dom';
import type { SaveData } from '../../core/Save';
import { REVOS, getRevos } from '../../game/data/revos';
import { ELEMENT_NAMES } from '../../voxel/palette';
import { audio } from '../../core/Audio';
import { revosIcon } from '../revosIcon';
import { revosDetailBody } from '../revosDetail';

/** 図鑑。未取得はシルエットで見せ、「あと何が居るか」を常に示す */
export class DexScreen extends Screen {
  private data!: SaveData;
  private gridEl!: HTMLElement;
  private countEl!: HTMLElement;
  private filter: string = 'all';
  private chipsEl!: HTMLElement;

  onBack?: () => void;

  constructor() { super('dex'); }

  setData(d: SaveData): void { this.data = d; this.render(); }

  build(): void {
    this.countEl = h('div', { class: 'num dex-count', text: '0 / 12' });
    const strip = h('div', { class: 'status-strip' },
      button('‹', () => { audio.uiBack(); this.onBack?.(); }, { class: 'btn--sm btn--ghost' }),
      h('div', { class: 'screen-title', text: '図鑑' }),
      this.countEl,
    );

    this.chipsEl = h('div', { class: 'dex-filters' });
    this.gridEl = h('div', { class: 'dex-grid' });
    const body = h('div', { class: 'dex-body' }, this.chipsEl, this.gridEl);
    this.el.append(strip, body);
  }

  enter(): void { this.render(); }

  private render(): void {
    if (!this.data || !this.gridEl) return;
    const owned = new Set(this.data.dex);
    this.countEl.textContent = `${owned.size} / ${REVOS.length}`;

    clear(this.chipsEl);
    for (const [key, label] of [
      ['all', 'すべて'], ['flame', '火'], ['aqua', '水'], ['terra', '土'], ['gale', '風'], ['null', '無'],
    ] as const) {
      this.chipsEl.appendChild(button(label, () => {
        audio.uiTap();
        this.filter = key;
        this.render();
      }, { class: `btn--sm dex-chip ${this.filter === key ? 'is-on' : ''}` }));
    }

    clear(this.gridEl);
    for (const r of REVOS) {
      if (this.filter !== 'all' && r.element !== this.filter) continue;
      const has = owned.has(r.id);
      const cell = button('', () => has ? this.openDetail(r.id) : audio.uiError(), {
        class: `dex-cell ${has ? '' : 'is-locked'}`,
      });
      cell.append(
        revosIcon(r.id, `dex-icon ${has ? '' : 'is-silhouette'}`),
        h('span', { class: `chip chip--${r.element}`, text: ELEMENT_NAMES[r.element] }),
        h('span', { class: 'dex-name', text: has ? r.name : '？？？' }),
        h('span', { class: 'dex-rarity', text: '★'.repeat(r.rarity) }),
      );
      this.gridEl.appendChild(cell);
    }
  }

  private openDetail(id: string): void {
    audio.uiTap();
    const r = getRevos(id);
    this.ui.sheet(r.name, revosDetailBody(id, {
      owned: this.data.roster.filter((u) => u.defId === id),
    }));
  }
}
