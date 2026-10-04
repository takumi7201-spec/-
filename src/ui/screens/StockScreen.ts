import { Screen } from '../UIRoot';
import { h, button, clear } from '../dom';
import type { SaveData } from '../../core/Save';
import { RARITY_NAMES, getRevos } from '../../game/data/revos';
import { BIOMES, ELEMENT_NAMES, type BiomeId } from '../../voxel/palette';
import { audio } from '../../core/Audio';
import { revosIcon } from '../revosIcon';
import { revosDetailBody } from '../revosDetail';
import { screenHead, spaced } from '../chrome';
import {
  AUTO_UNLOCK_STAGE, autoCleanExpected, autoCleanLevel, autoCleanToNext,
  autoCleanUnlocked, autoCleanUses, AUTO_MAX_LEVEL,
} from '../../game/autoClean';

/**
 * 未精錬の化石の一覧。
 *
 * これまでは拠点の「精錬」を押した瞬間、先頭の1個が問答無用で作業台に
 * 乗っていた。どれを削っているのか、他に何を持っているのかが分からないまま
 * 1分の作業に入ることになる。並べて、選んでから入る。
 *
 * 並びはレア度順。持ち物が増えたときに探すのは、たいてい上位のほうなので。
 */

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
  /** おまかせで削る。削りの画面には入らず、その場で仕上げる */
  onAuto?: (entry: StockEntry) => void;

  constructor() { super('stock', 'dig'); }

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

    this.listEl.appendChild(this.autoStrip());
    this.listEl.appendChild(h('div', { class: 'party-hint', text: '長押しで詳細' }));

    const auto = autoCleanUnlocked(this.data);
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
            // 層の名前は palette の1か所から引く。手で写すと、層を足したときに
            // 書き忘れた分だけ id がそのまま出る（特別許可区がそうなっていた）
            h('span', { class: 'dim', text: BIOMES[row.biome]?.name ?? row.biome }),
          ),
        ),
        h('span', { class: 'stock-go', text: '削る' }),
      );
      /*
       * おまかせは札の外に出す。札そのものが「削る」ボタンなので、
       * 中にもう1つボタンを入れると、どちらを押したのか判定が割れる
       */
      this.listEl.appendChild(
        auto
          ? h('div', { class: 'stock-row' }, card,
            button('おまかせ', () => { audio.uiConfirm(); this.onAuto?.(row); }, { class: 'stock-auto' }),
          )
          : card,
      );
    }
  }

  /**
   * おまかせの腕前。
   *
   * 「いま任せたらどのくらいで上がるか」を数で出す。見込みが出ていないと、
   * 手で削るのと任せるのを比べられない——比べられないなら、良い石まで
   * 任せてしまう。
   */
  private autoStrip(): HTMLElement {
    if (!autoCleanUnlocked(this.data)) {
      return h('div', { class: 'stock-auto-strip is-locked' },
        h('span', { class: 'label', text: spaced('おまかせ精錬') }),
        h('span', { text: `ステージ ${AUTO_UNLOCK_STAGE} 到達で開く（現在 ${this.data.stageProgress}）` }),
      );
    }
    const uses = autoCleanUses(this.data);
    const lv = autoCleanLevel(uses);
    const next = autoCleanToNext(uses);
    return h('div', { class: 'stock-auto-strip' },
      h('span', { class: 'label', text: spaced('おまかせ精錬') }),
      h('span', { class: 'num stock-auto-lv', text: `Lv${lv} / ${AUTO_MAX_LEVEL}` }),
      h('span', { text: `仕上がり およそ クリーン度 ${autoCleanExpected(lv)}` }),
      h('span', { class: 'dim', text: next > 0 ? `あと ${next} 回で Lv${lv + 1}` : '腕は上がりきった' }),
    );
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
