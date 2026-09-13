import { Screen } from '../UIRoot';
import { h, button, clear } from '../dom';
import type { SaveData } from '../../core/Save';
import { REVOS, RARITY_NAMES, getRevos } from '../../game/data/revos';
import { ELEMENT_NAMES } from '../../voxel/palette';
import { audio } from '../../core/Audio';

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
    const owned = this.data.roster.filter((u) => u.defId === id);
    const body = h('div', { class: 'dex-detail' },
      h('div', { class: 'dex-detail-head' },
        h('span', { class: `chip chip--${r.element}`, text: ELEMENT_NAMES[r.element] }),
        h('span', { class: 'dex-detail-role', text: r.role }),
        h('span', { class: 'dex-detail-rarity', text: RARITY_NAMES[r.rarity] }),
      ),
      h('p', { class: 'dex-flavor', text: r.flavor }),
      h('div', { class: 'dex-stats' },
        ...([['HP', r.hp], ['ATK', r.atk], ['DEF', r.def], ['SPD', r.spd]] as const).map(([k, v]) =>
          h('div', { class: 'dex-stat' },
            h('span', { class: 'label', text: k }),
            h('span', { class: 'num', text: String(v) }),
          ),
        ),
      ),
      h('div', { class: 'dex-skill' },
        h('b', { text: `特性 · ${r.passive.name}` }),
        h('span', { text: r.passive.desc }),
      ),
      h('div', { class: 'dex-skill' },
        h('b', { class: 'od', text: `OD · ${r.od.name}` }),
        h('span', { text: r.od.desc }),
      ),
      h('div', { class: 'dex-owned' },
        owned.length === 0
          ? h('span', { class: 'dim', text: '未所持' })
          : h('span', { text: `所持 ${owned.length} 体 — 最高クリーン度 ${Math.max(...owned.map((u) => u.clean))}` }),
      ),
      h('div', { class: 'dex-habitat' },
        h('span', { class: 'label', text: '産出' }),
        h('span', { text: r.habitat.map(habitatName).join(' / ') }),
      ),
    );
    this.ui.sheet(r.name, body);
  }
}

function habitatName(id: string): string {
  switch (id) {
    case 'canyon': return 'ソルト・キャニオン';
    case 'frostpeak': return 'フロストピーク';
    case 'emberfield': return 'エンバーフィールド';
    case 'tidehollow': return 'タイドホロウ';
    default: return id;
  }
}
