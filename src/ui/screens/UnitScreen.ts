import { Screen } from '../UIRoot';
import { h, button, clear } from '../dom';
import type { SaveData } from '../../core/Save';
import { REVOS, getRevos } from '../../game/data/revos';
import { cleanRank } from '../../game/battle/simulate';
import { effectiveParty, partyPower } from '../../game/party';
import { canBeCore, TRANSFER_MIN_CLEAN } from '../../game/transfer';
import { revosIcon } from '../revosIcon';
import { screenHead, plate, tabBar } from '../chrome';

export type UnitWhere = 'roster' | 'party' | 'dex' | 'transfer';

/**
 * ユニット。
 *
 * 手持ちに関わる面をここ1か所に集める。以前は「編成」と「図鑑」が
 * 下タブに並んでいたが、この2つは同じ対象（持っている化石）を別の角度から
 * 見ているだけで、タブ2枠を使う理由が無かった。空いた枠は設定に回す。
 *
 * 札は4枚。それぞれ「いま何があるか」を数で出す——名前だけの入口を4つ
 * 並べても、どれを開くべきかは中を見るまで分からない。
 */
export class UnitScreen extends Screen {
  private data!: SaveData;
  private gridEl!: HTMLElement;
  private facesEl!: HTMLElement;
  private countPlate = plate('手持ち', { tone: 'amber' });
  private tabs = tabBar([
    { key: 'home', icon: '⌂', label: '拠点', onTap: () => this.onTab?.('home') },
    { key: 'dig', icon: '⛏', label: '発掘', onTap: () => this.onTab?.('dig') },
    { key: 'battle', icon: '⚔', label: 'バトル', onTap: () => this.onTab?.('battle') },
    { key: 'unit', icon: '◈', label: 'ユニット', onTap: () => { /* いまここ */ } },
    { key: 'settings', icon: '⚙', label: '設定', onTap: () => this.onTab?.('settings') },
  ]);

  onGo?: (where: UnitWhere) => void;
  onTab?: (where: 'home' | 'dig' | 'battle' | 'settings') => void;

  constructor() { super('unit'); }

  setData(d: SaveData): void { this.data = d; this.render(); }

  build(): void {
    const head = screenHead({ eyebrow: '手持ち', title: 'ユニット', right: this.countPlate.el });
    this.facesEl = h('div', { class: 'unit-faces' });
    this.gridEl = h('div', { class: 'unit-grid' });
    this.tabs.select('unit');
    this.el.append(head, h('div', { class: 'unit-body' }, this.facesEl, this.gridEl), this.tabs.el);
  }

  enter(): void { this.render(); }

  private render(): void {
    if (!this.data || !this.gridEl) return;
    const roster = this.data.roster;
    this.countPlate.set(String(roster.length));

    // ---- 編成中の3体。どの画面へ行くにも、いま誰を出しているかが起点になる ----
    clear(this.facesEl);
    // 出撃時と同じ埋め方で数える。order が空でも手前の3体が出る
    const party = effectiveParty(this.data);
    if (party.length === 0) {
      this.facesEl.appendChild(h('div', { class: 'unit-faces-empty', text: '編成がまだ決まっていない。' }));
    } else {
      for (const u of party) {
        this.facesEl.appendChild(h('div', { class: 'unit-face' },
          revosIcon(u.defId, 'unit-face-img'),
          h('span', { class: 'unit-face-name', text: getRevos(u.defId).name }),
          h('span', { class: 'unit-face-sub num', text: `Lv${u.level} · ${cleanRank(u.clean)}` }),
        ));
      }
    }

    // ---- 4枚の札 ----
    const cores = roster.filter(canBeCore).length;
    const best = roster.reduce((m, u) => Math.max(m, u.clean), 0);
    const specs: {
      key: UnitWhere; icon: string; title: string; note: string; value: string; tone: string;
    }[] = [
      {
        key: 'roster', icon: '☰', title: '一覧', tone: 'plain',
        note: roster.length > 0 ? `最高クリーン度 ${best}（${cleanRank(best)}）` : 'まだ手持ちがない',
        value: `${roster.length} 体`,
      },
      {
        key: 'party', icon: '◈', title: '編成', tone: 'amber',
        note: party.length === 3 ? `戦力 ${partyPower(this.data).toLocaleString('ja-JP')}` : 'あと少しで3体そろう',
        value: `${party.length} / 3`,
      },
      {
        key: 'dex', icon: '▤', title: '図鑑', tone: 'mint',
        note: '未所持の姿も確かめられる',
        value: `${this.data.dex.length} / ${REVOS.length}`,
      },
      {
        key: 'transfer', icon: '✦', title: 'カセキ付け替え', tone: 'rose',
        note: `クリーン度 ${TRANSFER_MIN_CLEAN} から核にできる`,
        value: `核 ${cores} 体`,
      },
    ];

    clear(this.gridEl);
    for (const s of specs) {
      const disabled = (s.key === 'transfer' && cores === 0) || (s.key === 'roster' && roster.length === 0);
      const card = button('', () => {
        if (disabled) { this.ui.toast(s.key === 'transfer' ? `クリーン度 ${TRANSFER_MIN_CLEAN} 以上の化石がまだない` : 'まだ手持ちがない', 'warn'); return; }
        this.onGo?.(s.key);
      }, { class: `unit-card unit-card--${s.tone} ${disabled ? 'is-off' : ''}` });
      card.append(
        h('span', { class: 'unit-card-mark', text: s.icon }),
        h('span', { class: 'unit-card-title', text: s.title }),
        h('span', { class: 'unit-card-value num', text: s.value }),
        h('span', { class: 'unit-card-note', text: s.note }),
      );
      this.gridEl.appendChild(card);
    }
  }
}
