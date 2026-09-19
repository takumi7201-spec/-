import { Screen } from '../UIRoot';
import { h, button, clear } from '../dom';
import type { SaveData } from '../../core/Save';
import { RARITY_NAMES, getRevos } from '../../game/data/revos';
import { ELEMENT_NAMES, type BiomeId } from '../../voxel/palette';
import { audio } from '../../core/Audio';
import { revosIcon } from '../revosIcon';
import { revosDetailBody } from '../revosDetail';
import { screenHead } from '../chrome';

/**
 * 未精錬の化石の一覧。
 *
 * これまでは拠点の「精錬」を押した瞬間、先頭の1個が問答無用で作業台に
 * 乗っていた。どれを削っているのか、他に何を持っているのかが分からないまま
 * 1分の作業に入ることになる。並べて、選んでから入る。
 *
 * 並びはレア度順。持ち物が増えたときに探すのは、たいてい上位のほうなので。
 */

const BIOME_NAMES: Record<string, string> = {
  canyon: 'ソルト・キャニオン',
  frostpeak: 'フロストピーク',
  emberfield: 'エンバーフィールド',
  tidehollow: 'タイドホロウ',
};

export interface StockEntry {
  defId: string;
  rarity: number;
  biome: BiomeId;
  /** data.stock 上の位置。精錬を始めるときに取り除く */
  index: number;
}

export class StockScreen extends Screen {
  private data!: SaveData;
  private listEl!: HTMLElement;
  private countEl!: HTMLElement;

  onBack?: () => void;
  onClean?: (entry: StockEntry) => void;

  constructor() { super('stock'); }

  setData(d: SaveData): void { this.data = d; this.render(); }

  build(): void {
    this.countEl = h('div', { class: 'num dex-count', text: '0' });
    const strip = screenHead({
      eyebrow: '持ち帰り', title: '未精錬',
      onBack: () => this.onBack?.(),
      right: this.countEl,
    });
    this.listEl = h('div', { class: 'stock-body' });
    this.el.append(strip, this.listEl);
  }

  enter(): void { this.render(); }

  private render(): void {
    if (!this.data || !this.listEl) return;
    clear(this.listEl);

    const rows: StockEntry[] = this.data.stock
      .map((s, index) => ({ defId: s.defId, rarity: s.rarity, biome: s.biome, index }))
      .sort((a, b) => b.rarity - a.rarity || a.index - b.index);

    this.countEl.textContent = `${rows.length} 個`;

    if (rows.length === 0) {
      this.listEl.appendChild(h('div', { class: 'stock-empty' },
        h('div', { class: 'stock-empty-line', text: '未精錬の化石がない。' }),
        h('div', { class: 'stock-empty-line dim', text: '発掘で持ち帰ったものがここに並ぶ。' }),
      ));
      return;
    }

    this.listEl.appendChild(h('div', { class: 'party-hint', text: '長押しで詳細' }));

    for (const row of rows) {
      const def = getRevos(row.defId);
      const card = button('', () => { audio.uiConfirm(); this.onClean?.(row); }, {
        class: 'stock-card',
        onLongPress: () => this.openDetail(row.defId),
      });
      card.append(
        revosIcon(row.defId, 'stock-icon'),
        h('div', { class: 'stock-main' },
          h('div', { class: 'stock-head' },
            h('span', { class: `chip chip--${def.element}`, text: ELEMENT_NAMES[def.element] }),
            h('span', { class: 'stock-name', text: def.name }),
          ),
          h('div', { class: 'stock-sub' },
            h('span', { class: 'stock-rarity', text: `${'★'.repeat(row.rarity)} ${RARITY_NAMES[row.rarity] ?? ''}` }),
            h('span', { class: 'dim', text: BIOME_NAMES[row.biome] ?? row.biome }),
          ),
        ),
        h('span', { class: 'stock-go', text: '削る' }),
      );
      this.listEl.appendChild(card);
    }
  }

  private openDetail(defId: string): void {
    audio.uiTap();
    navigator.vibrate?.(12);
    const def = getRevos(defId);
    this.ui.sheet(def.name, revosDetailBody(defId, {
      owned: this.data.roster.filter((r) => r.defId === defId),
    }));
  }
}
