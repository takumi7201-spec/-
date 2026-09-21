import { Screen } from '../UIRoot';
import { h, button, bar, clear } from '../dom';
import type { OwnedRevos, SaveData } from '../../core/Save';
import { ROLE_NAMES, getRevos } from '../../game/data/revos';
import { ELEMENT_NAMES } from '../../voxel/palette';
import { cleanRank } from '../../game/battle/simulate';
import { effectiveParty } from '../../game/party';
import { revosIcon } from '../revosIcon';
import { screenHead, plate, spaced } from '../chrome';
import { audio } from '../../core/Audio';

type SortKey = 'got' | 'level' | 'clean' | 'rarity' | 'element';

const SORTS: { key: SortKey; label: string }[] = [
  { key: 'got', label: '入手順' },
  { key: 'level', label: 'レベル' },
  { key: 'clean', label: 'クリーン度' },
  { key: 'rarity', label: 'レア度' },
  { key: 'element', label: '属性' },
];

const ELEMENT_ORDER = ['flame', 'aqua', 'terra', 'gale', 'null'];

/**
 * 手持ちの一覧。
 *
 * 図鑑は「種」を並べる面で、ここは「個体」を並べる面。同じ種を2体
 * 持っていることも、そのうち1体だけがよく削れていることも、図鑑からは
 * 読めない——クリーン度とレベルは個体に付く値なので、別の表が要る。
 *
 * 並べ替えの既定は入手順。開くたびに並びが変わると、さっき見た位置が消える。
 */
export class RosterScreen extends Screen {
  private data!: SaveData;
  private sortsEl!: HTMLElement;
  private listEl!: HTMLElement;
  private countPlate = plate('所持', { tone: 'amber' });
  private sort: SortKey = 'got';
  private desc = false;

  onBack?: () => void;
  onDetail?: (defId: string, unit: OwnedRevos) => void;

  constructor() { super('roster'); }

  setData(d: SaveData): void { this.data = d; this.render(); }

  build(): void {
    const head = screenHead({
      eyebrow: '個体記録', title: '一覧',
      onBack: () => this.onBack?.(),
      right: this.countPlate.el,
    });
    this.sortsEl = h('div', { class: 'dex-sorts ros-sorts' });
    this.listEl = h('div', { class: 'ros-body' });
    this.el.append(head, this.sortsEl, this.listEl);
  }

  enter(): void { this.render(); }

  private render(): void {
    if (!this.data || !this.listEl) return;
    this.countPlate.set(String(this.data.roster.length));

    // ---- 並べ替え。選択中をもう一度押すと昇降が入れ替わる ----
    clear(this.sortsEl);
    this.sortsEl.appendChild(h('span', { class: 'dex-sort-label', text: spaced('並び') }));
    for (const s of SORTS) {
      const on = this.sort === s.key;
      const b = button(s.label, () => {
        audio.uiTap();
        if (on) this.desc = !this.desc;
        else { this.sort = s.key; this.desc = s.key !== 'got'; }
        this.render();
      }, { class: `btn--sm dex-sort ${on ? 'is-on' : 'btn--opt'}` });
      if (on) b.appendChild(h('span', { class: 'dex-sort-dir', text: this.desc ? '▼' : '▲' }));
      this.sortsEl.appendChild(b);
    }

    // ---- 一覧 ----
    // 出撃時と同じ埋め方で見る。order が空でも手前の3体が実際に出る
    const inParty = new Set(effectiveParty(this.data).map((u) => u.uid));
    const list = this.data.roster.slice().sort((a, b) => this.compare(a, b));

    clear(this.listEl);
    if (list.length === 0) {
      this.listEl.appendChild(h('div', { class: 'stock-empty' },
        h('div', { class: 'stock-empty-line', text: 'まだ手持ちがない。' }),
        h('div', { class: 'stock-empty-line dim', text: '発掘して、削り上げるとここに並ぶ。' }),
      ));
      return;
    }

    for (const u of list) {
      const d = getRevos(u.defId);
      const rank = cleanRank(u.clean);
      const card = button('', () => { audio.uiTap(); this.onDetail?.(u.defId, u); }, {
        class: `ros-card ${inParty.has(u.uid) ? 'is-in' : ''}`,
      });
      const cleanBar = bar('bar--slim', u.clean / 100);
      card.append(
        revosIcon(u.defId, 'ros-icon'),
        h('span', { class: 'ros-main' },
          h('span', { class: 'ros-head' },
            h('span', { class: `chip chip--${d.element}`, text: ELEMENT_NAMES[d.element] }),
            h('span', { class: 'ros-name', text: d.name }),
            inParty.has(u.uid) ? h('span', { class: 'ros-flag', text: '出撃' }) : null,
          ),
          h('span', { class: 'ros-sub' },
            h('span', { class: 'num', text: `Lv${u.level}` }),
            h('span', { class: 'ros-role', text: ROLE_NAMES[d.role] }),
            h('span', { class: 'ros-rarity', text: '★'.repeat(d.rarity) }),
            u.skillLevel > 1 ? h('span', { class: 'ros-skill num', text: `技Lv${u.skillLevel}` }) : null,
          ),
          h('span', { class: 'ros-clean' },
            cleanBar.el,
            h('span', { class: `ros-rank ros-rank--${rank} num`, text: `${rank} ${u.clean}` }),
          ),
        ),
      );
      this.listEl.appendChild(card);
    }
  }

  /** どの軸でも最後は入手順で割る。同値の並びが毎回変わると位置が覚えられない */
  private compare(a: OwnedRevos, b: OwnedRevos): number {
    const dir = this.desc ? -1 : 1;
    const got = a.obtainedAt - b.obtainedAt;
    const da = getRevos(a.defId), db = getRevos(b.defId);
    switch (this.sort) {
      case 'level': return (a.level - b.level) * dir || got;
      case 'clean': return (a.clean - b.clean) * dir || got;
      case 'rarity': return (da.rarity - db.rarity) * dir || (b.clean - a.clean) || got;
      case 'element': {
        const d = ELEMENT_ORDER.indexOf(da.element) - ELEMENT_ORDER.indexOf(db.element);
        return d !== 0 ? d * dir : (db.rarity - da.rarity) || got;
      }
      default: return got * dir;
    }
  }
}
