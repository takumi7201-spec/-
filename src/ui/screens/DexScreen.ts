import { Screen } from '../UIRoot';
import { h, button, clear } from '../dom';
import type { SaveData } from '../../core/Save';
import { REVOS, ROLE_NAMES, ROLE_ORDER, type RevosDef } from '../../game/data/revos';
import { audio } from '../../core/Audio';
import { revosIcon } from '../revosIcon';
import { screenHead, spaced } from '../chrome';

type SortKey = 'index' | 'rarity' | 'element' | 'role' | 'owned';

/** 属性の並び順。フィルタの札の並びと揃える——2か所で順番が違うと探せない */
const ELEMENT_ORDER = ['flame', 'aqua', 'terra', 'gale', 'null'];

const SORTS: { key: SortKey; label: string }[] = [
  { key: 'index', label: '図鑑順' },
  { key: 'rarity', label: 'レア度' },
  { key: 'element', label: '属性' },
  { key: 'role', label: '役割' },
  { key: 'owned', label: '所持' },
];

/**
 * 図鑑。
 *
 * 未所持も伏せずに出す。名前も姿も隠すと「あと何が居るか」しか分からず、
 * 属性やレア度で並べ替える意味も無くなる——探す対象が ？？？ では選べない。
 * 持っているかどうかは、札の明るさと隅の印だけで示す。
 */
export class DexScreen extends Screen {
  private data!: SaveData;
  private gridEl!: HTMLElement;
  private countEl!: HTMLElement;
  private filter: string = 'all';
  private chipsEl!: HTMLElement;
  private sortsEl!: HTMLElement;
  private progFill!: HTMLElement;
  private footEl!: HTMLElement;

  onBack?: () => void;
  /** 詳細は下から引く紙ではなく1枚の画面。行き先はゲーム側が決める */
  onDetail?: (defId: string) => void;
  /** 並びは設定に残す。保存はゲーム側に任せる */
  onPrefChange?: () => void;

  constructor() { super('dex', 'unit'); }

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
    this.sortsEl = h('div', { class: 'dex-sorts' });
    this.gridEl = h('div', { class: 'dex-grid' });
    this.footEl = h('div', { class: 'dex-foot' });
    const body = h('div', { class: 'dex-body' }, this.chipsEl, this.sortsEl, this.gridEl);
    this.el.append(strip, body, this.footEl);
  }

  enter(): void { this.render(); }

  private get sort(): SortKey { return this.data.settings.dexSort ?? 'index'; }
  private get desc(): boolean { return this.data.settings.dexDesc ?? false; }

  private render(): void {
    if (!this.data || !this.gridEl) return;
    const owned = new Set(this.data.dex);

    clear(this.countEl);
    this.countEl.append(
      String(owned.size),
      h('span', { class: 'dex-count-total', text: ` / ${REVOS.length}` }),
    );
    this.progFill.style.width = `${(owned.size / Math.max(1, REVOS.length)) * 100}%`;

    // ---- 属性で絞る ----
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

    // ---- 並べ替え。選択中をもう一度押すと昇降が入れ替わる ----
    clear(this.sortsEl);
    this.sortsEl.appendChild(h('span', { class: 'dex-sort-label', text: spaced('並び') }));
    for (const s of SORTS) {
      const on = this.sort === s.key;
      const b = button(s.label, () => {
        audio.uiTap();
        if (on) this.data.settings.dexDesc = !this.desc;
        else { this.data.settings.dexSort = s.key; this.data.settings.dexDesc = false; }
        this.onPrefChange?.();
        this.render();
      }, { class: `btn--sm dex-sort ${on ? 'is-on' : 'btn--opt'}` });
      if (on) b.appendChild(h('span', { class: 'dex-sort-dir', text: this.desc ? '▼' : '▲' }));
      this.sortsEl.appendChild(b);
    }

    // ---- 格子 ----
    const list = REVOS
      .filter((r) => this.filter === 'all' || r.element === this.filter)
      .slice()
      .sort((a, b) => this.compare(a, b, owned));

    clear(this.gridEl);
    for (const r of list) {
      const has = owned.has(r.id);
      // 未所持でも開ける。姿も性能も、手に入れる前に確かめられたほうがいい
      const cell = button('', () => this.openDetail(r.id), {
        class: `dex-cell ${has ? '' : 'is-locked'}`,
      });
      // ★5 だけ枠の質感を変える。判定は CSS 側に持たせる
      cell.dataset.rarity = String(r.rarity);
      cell.append(
        h('span', { class: 'dex-art' },
          revosIcon(r.id, `dex-icon ${has ? '' : 'is-dim'}`),
          has ? null : h('span', { class: 'dex-flag', text: '未' }),
        ),
        h('span', { class: 'dex-row' },
          h('i', { class: `dot dot--${r.element}` }),
          h('span', { class: 'dex-name', text: r.name }),
        ),
        // 役割で並べたときだけ、下段をレア度から役割名に差し替える。
        // 何を軸に並んでいるのかが札の上で読めないと、並びを確かめられない
        this.sort === 'role'
          ? h('span', { class: 'dex-role', text: ROLE_NAMES[r.role] })
          : h('span', { class: 'dex-rarity', text: '★'.repeat(r.rarity) }),
      );
      cell.title = has ? r.name : `${r.name}（未所持）`;
      this.gridEl.appendChild(cell);
    }

    // ---- 足もと。案内と、いま見ている内訳 ----
    const shown = list.length;
    const got = list.filter((r) => owned.has(r.id)).length;
    clear(this.footEl);
    this.footEl.append(
      h('span', { class: 'dex-foot-note', text: spaced('タップで詳細') }),
      h('span', { class: 'dex-foot-rule' }),
      h('span', { class: 'dex-foot-note' },
        '表示 ', h('span', { class: 'num', text: String(got) }),
        ' / ', h('span', { class: 'num', text: String(shown) }), ' 種',
      ),
    );
  }

  /**
   * 並べ替え。
   *
   * どの軸でも最後は図鑑順で割る。同値の並びが毎回変わると、
   * 「さっき見た位置」が消えて探し直しになる。
   */
  private compare(a: RevosDef, b: RevosDef, owned: Set<string>): number {
    const dir = this.desc ? -1 : 1;
    const idx = REVOS.indexOf(a) - REVOS.indexOf(b);
    switch (this.sort) {
      case 'rarity': {
        const d = a.rarity - b.rarity;
        return d !== 0 ? d * dir : idx;
      }
      case 'role': {
        const d = ROLE_ORDER.indexOf(a.role) - ROLE_ORDER.indexOf(b.role);
        if (d !== 0) return d * dir;
        // 同じ役割の中はレア度の高い順。役割で絞って読むときに強い順で並ぶ
        return (b.rarity - a.rarity) || idx;
      }
      case 'element': {
        const d = ELEMENT_ORDER.indexOf(a.element) - ELEMENT_ORDER.indexOf(b.element);
        if (d !== 0) return d * dir;
        // 同じ属性の中はレア度の高い順。属性で絞ったときに強い順で読める
        return (b.rarity - a.rarity) || idx;
      }
      case 'owned': {
        const d = Number(owned.has(a.id)) - Number(owned.has(b.id));
        return d !== 0 ? -d * dir : idx;
      }
      default:
        return idx * dir;
    }
  }

  private openDetail(id: string): void {
    audio.uiTap();
    this.onDetail?.(id);
  }
}
