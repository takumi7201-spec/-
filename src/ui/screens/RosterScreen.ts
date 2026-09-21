import { Screen } from '../UIRoot';
import { h, button, bar, clear } from '../dom';
import type { OwnedRevos, SaveData } from '../../core/Save';
import { ROLE_NAMES, getRevos, revosShortName } from '../../game/data/revos';
import { ELEMENT_NAMES } from '../../voxel/palette';
import { cleanRank } from '../../game/battle/simulate';
import { effectiveParty } from '../../game/party';
import { engraveName, engraveText, engravePattern, type Engraving } from '../../game/engraving';
import { revosIcon } from '../revosIcon';
import { screenHead, plate, spaced } from '../chrome';
import { audio } from '../../core/Audio';

type SortKey = 'got' | 'level' | 'clean' | 'rarity' | 'element';
type View = 'list' | 'grid';

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
 * 読めない——クリーン度・刻印・技Lvは個体に付く値なので、別の表が要る。
 *
 * 見せ方は2つ。数が少ないうちは1行ずつ読ませたほうが速く、増えてくると
 * 敷き詰めて「どこにあるか」で探すほうが速い。どちらが正しいかは
 * 持ち物の数で変わるので、切り替えを持たせて設定に覚えさせる。
 */
export class RosterScreen extends Screen {
  private data!: SaveData;
  private toolsEl!: HTMLElement;
  private listEl!: HTMLElement;
  private countPlate = plate('所持', { tone: 'amber' });

  onBack?: () => void;
  onDetail?: (defId: string, unit: OwnedRevos) => void;
  /** 並びと見せ方は設定に残す。保存はゲーム側に任せる */
  onPrefChange?: () => void;

  constructor() { super('roster'); }

  setData(d: SaveData): void { this.data = d; this.render(); }

  build(): void {
    const head = screenHead({
      eyebrow: '個体記録', title: '一覧',
      onBack: () => this.onBack?.(),
      right: this.countPlate.el,
    });
    this.toolsEl = h('div', { class: 'ros-tools' });
    this.listEl = h('div', { class: 'ros-body' });
    this.el.append(head, this.toolsEl, this.listEl);
  }

  enter(): void { this.render(); }

  private get sort(): SortKey { return this.data.settings.rosterSort ?? 'got'; }
  private get desc(): boolean { return this.data.settings.rosterDesc ?? false; }
  private get view(): View { return this.data.settings.rosterView ?? 'list'; }

  private render(): void {
    if (!this.data || !this.listEl) return;
    this.countPlate.set(String(this.data.roster.length));

    // ---- 並べ替えと見せ方 ----
    clear(this.toolsEl);
    const sorts = h('div', { class: 'dex-sorts ros-sorts' },
      h('span', { class: 'dex-sort-label', text: spaced('並び') }),
    );
    for (const s of SORTS) {
      const on = this.sort === s.key;
      const b = button(s.label, () => {
        audio.uiTap();
        if (on) this.data.settings.rosterDesc = !this.desc;
        else {
          this.data.settings.rosterSort = s.key;
          // 数の軸は大きい順から見たい。入手順だけは古いほうから
          this.data.settings.rosterDesc = s.key !== 'got';
        }
        this.onPrefChange?.();
        this.render();
      }, { class: `btn--sm dex-sort ${on ? 'is-on' : 'btn--opt'}` });
      if (on) b.appendChild(h('span', { class: 'dex-sort-dir', text: this.desc ? '▼' : '▲' }));
      sorts.appendChild(b);
    }
    const views = h('div', { class: 'ros-views' });
    for (const [v, icon, label] of [['list', '☰', 'リスト'], ['grid', '▦', 'グリッド']] as const) {
      const b = button(icon, () => {
        if (this.view === v) return;
        audio.uiTap();
        this.data.settings.rosterView = v;
        this.onPrefChange?.();
        this.render();
      }, { class: `btn--sm ros-view ${this.view === v ? 'is-on' : 'btn--opt'}` });
      b.setAttribute('aria-label', label);
      views.appendChild(b);
    }
    this.toolsEl.append(sorts, views);

    // ---- 中身 ----
    const inParty = new Set(effectiveParty(this.data).map((u) => u.uid));
    const list = this.data.roster.slice().sort((a, b) => this.compare(a, b));

    clear(this.listEl);
    this.listEl.className = this.view === 'grid' ? 'ros-body ros-body--grid' : 'ros-body';
    if (list.length === 0) {
      this.listEl.appendChild(h('div', { class: 'stock-empty' },
        h('div', { class: 'stock-empty-line', text: 'まだ手持ちがない。' }),
        h('div', { class: 'stock-empty-line dim', text: '発掘して、削り上げるとここに並ぶ。' }),
      ));
      return;
    }
    for (const u of list) {
      this.listEl.appendChild(
        this.view === 'grid' ? this.gridCell(u, inParty.has(u.uid)) : this.listCard(u, inParty.has(u.uid)),
      );
    }
  }

  private listCard(u: OwnedRevos, inParty: boolean): HTMLElement {
    const d = getRevos(u.defId);
    const rank = cleanRank(u.clean);
    const card = button('', () => { audio.uiTap(); this.onDetail?.(u.defId, u); }, {
      class: `ros-card ${inParty ? 'is-in' : ''}`,
    });
    card.append(
      revosIcon(u.defId, 'ros-icon'),
      h('span', { class: 'ros-main' },
        h('span', { class: 'ros-head' },
          h('span', { class: `chip chip--${d.element}`, text: ELEMENT_NAMES[d.element] }),
          h('span', { class: 'ros-name', text: d.name }),
          inParty ? h('span', { class: 'ros-flag', text: '出撃' }) : null,
        ),
        h('span', { class: 'ros-sub' },
          h('span', { class: 'num', text: `Lv${u.level}` }),
          h('span', { class: 'ros-role', text: ROLE_NAMES[d.role] }),
          h('span', { class: 'ros-rarity', text: '★'.repeat(d.rarity) }),
          u.skillLevel > 1 ? h('span', { class: 'ros-skill num', text: `技Lv${u.skillLevel}` }) : null,
          u.engraving ? engraveTag(u.engraving) : null,
        ),
        h('span', { class: 'ros-clean' },
          bar('bar--slim', u.clean / 100).el,
          h('span', { class: `ros-rank ros-rank--${rank} num`, text: `${rank} ${u.clean}` }),
        ),
      ),
    );
    return card;
  }

  private gridCell(u: OwnedRevos, inParty: boolean): HTMLElement {
    const d = getRevos(u.defId);
    const rank = cleanRank(u.clean);
    const cell = button('', () => { audio.uiTap(); this.onDetail?.(u.defId, u); }, {
      class: `ros-cell ${inParty ? 'is-in' : ''}`,
    });
    cell.dataset.rarity = String(d.rarity);
    cell.append(
      h('span', { class: 'ros-cell-art' },
        revosIcon(u.defId, 'ros-cell-img'),
        inParty ? h('span', { class: 'ros-cell-flag', text: '出' }) : null,
        u.engraving ? engraveTag(u.engraving, true) : null,
      ),
      h('span', { class: 'ros-cell-row' },
        h('i', { class: `dot dot--${d.element}` }),
        h('span', { class: 'ros-cell-name', text: revosShortName(u.defId) }),
      ),
      h('span', { class: 'ros-cell-sub' },
        h('span', { class: 'num', text: `Lv${u.level}` }),
        h('span', { class: `ros-rank ros-rank--${rank} num`, text: `${rank} ${u.clean}` }),
      ),
    );
    return cell;
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

/** 刻印の印。銘1文字と等級だけ——一覧で加算まで出すと行が読めなくなる */
export function engraveTag(e: Engraving, compact = false): HTMLElement {
  const el = h('span', {
    class: `eng-tag eng-tag--g${e.grade} ${compact ? 'is-compact' : ''}`,
    text: compact ? engravePattern(e).name : `${engravePattern(e).name}☆${e.grade}`,
  });
  el.title = `${engraveName(e)} ☆${e.grade} — ${engraveText(e)}`;
  return el;
}
