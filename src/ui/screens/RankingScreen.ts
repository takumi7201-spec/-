import { Screen } from '../UIRoot';
import { h, button, clear } from '../dom';
import type { SaveData } from '../../core/Save';
import { REVOS, getRevos, ROLE_NAMES } from '../../game/data/revos';
import { ELEMENT_NAMES } from '../../voxel/palette';
import { revosIcon } from '../revosIcon';
import { screenHead } from '../chrome';
import { audio } from '../../core/Audio';

/**
 * 使用率。
 *
 * 2つの数を並べる。自分が連れて行った回数と、闘技場で当たった相手に
 * 入っていた回数——どちらも実際に起きたことの記録で、作り物の統計ではない。
 *
 * 並べる理由は「自分の癖」と「刺さってくる顔ぶれ」を見比べるため。
 * 相手はこちらの編成を見て組まれるので、右の並びは、そのまま
 * 「いまの自分の編成に対して何が選ばれているか」になる。
 */
type RankTab = 'mine' | 'arena';

export class RankingScreen extends Screen {
  private data!: SaveData;
  private tabsEl!: HTMLElement;
  private bodyEl!: HTMLElement;
  /** 名前は view。Screen が持つ tab（下タブの所属）と衝突させない */
  private view: RankTab = 'mine';

  onBack?: () => void;

  constructor() { super('ranking', 'battle'); }

  setData(d: SaveData): void { this.data = d; this.render(); }

  build(): void {
    const head = screenHead({
      eyebrow: '記録', title: '使用率',
      onBack: () => this.onBack?.(),
    });
    this.tabsEl = h('div', { class: 'sel-tabs' });
    this.bodyEl = h('div', { class: 'rank-body' });
    this.el.append(head, this.tabsEl, this.bodyEl);
  }

  swipeTab(dir: 1 | -1): boolean {
    const next: RankTab = dir > 0 ? 'arena' : 'mine';
    if (next === this.view) return false;
    this.view = next;
    audio.uiTap();
    this.render();
    return true;
  }

  enter(): void { this.render(); }

  private counts(): Record<string, number> {
    return this.view === 'mine' ? this.data.stats.sorties : this.data.colosseum.met;
  }

  private render(): void {
    if (!this.data || !this.bodyEl) return;

    clear(this.tabsEl);
    const tab = (key: RankTab, label: string): void => {
      const b = button(label, () => {
        if (this.view === key) return;
        audio.uiTap();
        this.view = key;
        this.render();
      }, { class: `sel-tab ${this.view === key ? 'is-on' : 'btn--opt'}` });
      this.tabsEl.appendChild(b);
    };
    tab('mine', '自分の出撃');
    tab('arena', '闘技場の相手');

    clear(this.bodyEl);
    const counts = this.counts();
    const rows = Object.entries(counts)
      .filter(([id, n]) => n > 0 && REVOS.some((r) => r.id === id))
      .sort((a, b) => b[1] - a[1]);
    const total = rows.reduce((a, [, n]) => a + n, 0);

    if (rows.length === 0) {
      this.bodyEl.appendChild(h('div', { class: 'stock-empty' },
        h('div', { class: 'stock-empty-line', text: this.view === 'mine' ? 'まだ出撃していない。' : 'まだ闘技場で戦っていない。' }),
        h('div', { class: 'stock-empty-line dim', text: this.view === 'mine'
          ? '連れて行った回数がここに並ぶ。'
          : '当たった相手に入っていた回数がここに並ぶ。' }),
      ));
      return;
    }

    // 分母は「のべ出撃数」。1戦につき5体ぶん数えるので、率は編成の中の割合になる
    this.bodyEl.appendChild(h('div', { class: 'rank-head num' },
      h('span', { text: this.view === 'mine' ? 'のべ出撃 ' : 'のべ遭遇 ' }),
      h('span', { class: 'rank-head-num', text: String(total) }),
      h('span', { class: 'dim', text: ` · ${rows.length} 種` }),
    ));

    const top = rows[0][1];
    rows.forEach(([id, n], i) => {
      const d = getRevos(id);
      const pct = total > 0 ? (n / total) * 100 : 0;
      this.bodyEl.appendChild(h('div', { class: `rank-row ${i < 3 ? 'is-top' : ''}` },
        h('span', { class: 'rank-no num', text: String(i + 1) }),
        revosIcon(id, 'rank-icon'),
        h('div', { class: 'rank-main' },
          h('div', { class: 'rank-name-row' },
            h('span', { class: `chip chip--${d.element}`, text: ELEMENT_NAMES[d.element] }),
            h('span', { class: 'rank-name', text: d.name }),
            h('span', { class: 'rank-role', text: ROLE_NAMES[d.role] }),
          ),
          h('div', { class: 'rank-bar' },
            h('i', { class: 'rank-bar-fill', style: `width:${(n / top * 100).toFixed(1)}%` }),
          ),
        ),
        h('div', { class: 'rank-nums num' },
          h('span', { class: 'rank-pct', text: `${pct.toFixed(1)}%` }),
          h('span', { class: 'dim', text: `${n} 回` }),
        ),
      ));
    });
  }
}
