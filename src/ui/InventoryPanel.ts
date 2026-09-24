import { h, clear, bar } from './dom';
import { revosIcon } from './revosIcon';
import { ROLE_NAMES, getRevos, revosShortName } from '../game/data/revos';
import { isWall } from '../game/battle/roles';
import { BIOMES, ELEMENT_NAMES, type BiomeId } from '../voxel/palette';
import type { SaveData } from '../core/Save';
import { cleanRank } from '../game/battle/simulate';

export interface InventoryContext {
  biome: BiomeId;
  /** この周回で拾ったもの */
  haul: { defId: string; rarity: number; kind: 'fossil' | 'mineral' }[];
  found: number;
  total: number;
  data: SaveData;
}

/**
 * 発掘中の持ち物パネル。
 *
 * 上から PLACE（今どこにいるか）／ITEMS（何を持っているか）／
 * FORMATION（それが誰の戦力になるか）。3D の上に左寄せで重ね、
 * 右半分はフィールドを見せたままにする——持ち物を見ている間も
 * 自分がどこに立っているかが分かるほうが、閉じたあとの復帰が速い。
 */
export class InventoryPanel {
  readonly el: HTMLElement;
  private placeName!: HTMLElement;
  private placeSub!: HTMLElement;
  private placeBar = bar('', 0);
  private placeCount!: HTMLElement;
  private grid!: HTMLElement;
  private pager!: HTMLElement;
  private formList!: HTMLElement;
  private formName!: HTMLElement;
  private page = 0;
  private pages: { defId: string; rarity: number; kind: 'fossil' | 'mineral'; count: number }[][] = [];
  private ctx: InventoryContext | null = null;

  /** 1ページあたりの枠数。モックと同じ 6×3 */
  private static readonly PER_PAGE = 18;

  constructor() {
    this.el = h('div', { class: 'inv', hidden: true },
      this.buildPlace(),
      this.buildItems(),
      this.buildFormation(),
    );
  }

  private buildPlace(): HTMLElement {
    this.placeName = h('div', { class: 'inv-title', text: '—' });
    this.placeSub = h('div', { class: 'inv-sub', text: '' });
    this.placeCount = h('div', { class: 'inv-count num', text: '0 / 0' });
    return h('section', { class: 'inv-panel' },
      h('header', { class: 'inv-head' },
        h('span', { class: 'inv-icon', text: '⛏' }),
        h('span', { class: 'inv-label', text: '現 在 地' }),
        this.placeCount,
      ),
      this.placeName,
      this.placeSub,
      this.placeBar.el,
    );
  }

  private buildItems(): HTMLElement {
    this.grid = h('div', { class: 'inv-grid' });
    this.pager = h('div', { class: 'inv-pager' });
    return h('section', { class: 'inv-panel' },
      h('header', { class: 'inv-head' },
        h('span', { class: 'inv-icon', text: '▤' }),
        h('span', { class: 'inv-label', text: '持 ち 物' }),
        this.pager,
      ),
      this.grid,
    );
  }

  private buildFormation(): HTMLElement {
    this.formList = h('div', { class: 'inv-form-list' });
    this.formName = h('div', { class: 'inv-sub', text: '' });
    return h('section', { class: 'inv-panel' },
      h('header', { class: 'inv-head' },
        h('span', { class: 'inv-icon', text: '❖' }),
        h('span', { class: 'inv-label', text: '編 成' }),
      ),
      this.formName,
      this.formList,
    );
  }

  get isOpen(): boolean { return !this.el.hidden; }

  open(ctx: InventoryContext): void {
    this.ctx = ctx;
    this.page = 0;
    this.render();
    this.el.hidden = false;
    // 開いた瞬間に下から立ち上げる。閉じるときは逆再生
    this.el.classList.remove('is-closing');
    this.el.classList.add('is-open');
  }

  close(): void {
    if (this.el.hidden) return;
    this.el.classList.remove('is-open');
    this.el.classList.add('is-closing');
    setTimeout(() => {
      this.el.hidden = true;
      this.el.classList.remove('is-closing');
    }, 200);
  }

  private render(): void {
    const ctx = this.ctx;
    if (!ctx) return;

    // ---- PLACE ----
    const b = BIOMES[ctx.biome];
    this.placeName.textContent = b.name;
    this.placeSub.textContent = b.tagline;
    this.placeCount.textContent = `${ctx.found} / ${ctx.total}`;
    this.placeBar.set(ctx.total > 0 ? ctx.found / ctx.total : 0);

    // ---- ITEMS ----
    const counts = new Map<string, { defId: string; rarity: number; kind: 'fossil' | 'mineral'; count: number }>();
    for (const it of ctx.haul) {
      const key = `${it.kind}:${it.defId}`;
      const hit = counts.get(key);
      if (hit) hit.count++;
      else counts.set(key, { ...it, count: 1 });
    }
    const list = [...counts.values()].sort((x, y) => y.rarity - x.rarity);
    this.pages = [];
    for (let i = 0; i < Math.max(1, Math.ceil(list.length / InventoryPanel.PER_PAGE)); i++) {
      this.pages.push(list.slice(i * InventoryPanel.PER_PAGE, (i + 1) * InventoryPanel.PER_PAGE));
    }
    this.page = Math.min(this.page, this.pages.length - 1);
    this.renderGrid();

    // ---- 編成 ----
    // 立ち位置は役職が決める。列ではなく役職の名前を添える
    this.formName.textContent = '立ち位置は役職で決まる';
    clear(this.formList);
    const order = ctx.data.party.order;
    const members = (order ?? [])
      .map((uid) => ctx.data.roster.find((r) => r.uid === uid))
      .filter((u): u is NonNullable<typeof u> => !!u);
    const fallback = members.length > 0 ? members : ctx.data.roster.slice(0, 3);
    if (fallback.length === 0) {
      this.formList.appendChild(h('div', { class: 'inv-empty', text: '編成なし' }));
    }
    fallback.slice(0, 3).forEach((u) => {
      const def = getRevos(u.defId);
      this.formList.appendChild(
        h('div', { class: `inv-form-row ${isWall(def.role) ? 'is-front' : ''}` },
          revosIcon(u.defId, 'inv-silho'),
          h('div', { class: 'inv-form-main' },
            h('div', { class: 'inv-form-name', text: revosShortName(def.id) },
              h('span', { class: `dot dot--${def.element}`, title: ELEMENT_NAMES[def.element] }),
            ),
            h('div', { class: 'inv-form-sub num', text: `${ROLE_NAMES[def.role]} · Lv${u.level} · ${cleanRank(u.clean)}` }),
          ),
        ),
      );
    });
  }

  private renderGrid(): void {
    clear(this.grid);
    const items = this.pages[this.page] ?? [];
    for (let i = 0; i < InventoryPanel.PER_PAGE; i++) {
      const it = items[i];
      if (!it) {
        this.grid.appendChild(h('div', { class: 'inv-cell is-empty' }));
        continue;
      }
      const cell = h('div', { class: `inv-cell inv-cell--${it.kind}`, title: it.kind === 'fossil' ? getRevos(it.defId).name : '鉱石' });
      if (it.kind === 'fossil') {
        cell.appendChild(revosIcon(it.defId, 'inv-silho'));
      } else {
        cell.appendChild(h('span', { class: 'inv-mineral', text: '◈' }));
      }
      if (it.count > 1) cell.appendChild(h('span', { class: 'inv-qty num', text: String(it.count) }));
      this.grid.appendChild(cell);
    }

    clear(this.pager);
    if (this.pages.length > 1) {
      const prev = h('button', { class: 'inv-page-btn', type: 'button', text: '◀', 'data-ui-block': '' });
      prev.addEventListener('pointerdown', () => { this.page = (this.page - 1 + this.pages.length) % this.pages.length; this.renderGrid(); });
      const next = h('button', { class: 'inv-page-btn', type: 'button', text: '▶', 'data-ui-block': '' });
      next.addEventListener('pointerdown', () => { this.page = (this.page + 1) % this.pages.length; this.renderGrid(); });
      this.pager.append(prev);
      for (let i = 0; i < this.pages.length; i++) {
        this.pager.appendChild(h('span', { class: `inv-dot ${i === this.page ? 'is-on' : ''}` }));
      }
      this.pager.appendChild(next);
    }
  }

  /** 開いたまま中身だけ更新する */
  update(ctx: InventoryContext): void {
    if (!this.isOpen) return;
    this.ctx = ctx;
    this.render();
  }
}
