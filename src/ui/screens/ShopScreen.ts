import { Screen } from '../UIRoot';
import { h, button, clear, fmtNum } from '../dom';
import type { SaveData } from '../../core/Save';
import { SHOP, buy, canBuy, stockLeft, type ShopItem } from '../../game/shop';
import { getRevos } from '../../game/data/revos';
import { revosIcon } from '../revosIcon';
import { screenHead, plate, spaced } from '../chrome';
import { audio } from '../../core/Audio';

/**
 * アイテムショップ。
 *
 * 売るのは原石と許可証だけ。完成した個体を並べると、掘る理由も削る理由も
 * 消える——ここで買えるのは手間の入口であって、結果ではない。
 *
 * 買えないものも暗いまま置く。棚から消すと「いま金が足りない」のか
 * 「そもそも扱いが無い」のかが読めない。
 */
export class ShopScreen extends Screen {
  private data!: SaveData;
  private listEl!: HTMLElement;
  private coinPlate = plate('所持', { tone: 'amber' });

  onBack?: () => void;
  /** コインと在庫が動くので、保存はゲーム側に任せる */
  onBuy?: () => void;

  constructor() { super('shop', 'home'); }

  setData(d: SaveData): void { this.data = d; this.render(); }

  build(): void {
    const head = screenHead({
      eyebrow: '交易', title: 'アイテムショップ',
      onBack: () => this.onBack?.(),
      right: this.coinPlate.el,
    });
    this.listEl = h('div', { class: 'shop-body' });
    this.el.append(head, this.listEl);
  }

  enter(): void { this.render(); }

  private render(): void {
    if (!this.data || !this.listEl) return;
    this.coinPlate.set(fmtNum(this.data.player.coins));

    clear(this.listEl);
    this.listEl.appendChild(h('div', { class: 'shop-note', text: '原石の中身はレア度の幅でしか約束しない。' }));
    for (const item of SHOP) this.listEl.appendChild(this.card(item));
  }

  private card(item: ShopItem): HTMLElement {
    const left = stockLeft(this.data, item);
    const ok = canBuy(this.data, item);
    const poor = this.data.player.coins < item.price;

    const card = h('div', { class: `shop-card ${ok ? '' : 'is-off'} shop-card--${item.kind}` });
    card.append(
      h('div', { class: 'shop-main' },
        h('div', { class: 'shop-head' },
          h('span', { class: `shop-kind shop-kind--${item.kind}`, text: spaced(item.kind === 'permit' ? '許可証' : '原石') }),
          h('span', { class: 'shop-name', text: item.name }),
        ),
        h('div', { class: 'shop-desc', text: item.desc }),
        Number.isFinite(left)
          ? h('div', { class: `shop-left num ${left === 0 ? 'is-out' : ''}`, text: `本日あと ${left} 個` })
          : null,
      ),
      h('div', { class: 'shop-buy' },
        h('div', { class: `shop-price num ${poor ? 'is-poor' : ''}` },
          h('i', { class: 'wallet-dot wallet-dot--coin' }),
          fmtNum(item.price),
        ),
        button('買う', () => this.purchase(item), { class: 'btn--sm shop-go', disabled: !ok }),
      ),
    );
    return card;
  }

  private purchase(item: ShopItem): void {
    const r = buy(this.data, item.id);
    if (!r.ok) { audio.uiError(); this.ui.toast(r.message, 'warn'); return; }
    audio.reward(1);
    this.onBuy?.();
    this.render();
    if (r.got) {
      // 何が出たかは札で見せる。トーストの一行だと流れて終わる
      const def = getRevos(r.got.defId);
      this.ui.sheet('仕入れた', h('div', { class: 'shop-got' },
        revosIcon(def.id, 'shop-got-icon'),
        h('div', { class: 'shop-got-name', text: def.name }),
        h('div', { class: 'shop-got-sub', text: `${'★'.repeat(r.got.rarity)} · 未精錬` }),
        h('div', { class: 'shop-got-note', text: '発掘の「精錬」から削れる。' }),
      ));
    } else {
      this.ui.toast(r.message, 'info');
    }
  }
}
