import { Screen } from '../UIRoot';
import { h, button, bar, clear, fmtNum } from '../dom';
import type { SaveData } from '../../core/Save';
import { expToNext, dropDecay } from '../../core/Save';
import { audio } from '../../core/Audio';
import { EVENTS } from '../../game/data/events';

/**
 * 拠点。導線は下部のグリッドに集約する。
 * バッジは数値のみにする——「3件たまっている」は行動を促すが、
 * 「何かある」は不安だけを生む。
 */
export class HomeScreen extends Screen {
  private data!: SaveData;
  private levelEl!: HTMLElement;
  private coinEl!: HTMLElement;
  private expBar = bar('bar--exp bar--slim', 0);
  private grid!: HTMLElement;
  private noticeEl!: HTMLElement;
  private tiles = new Map<string, HTMLButtonElement>();

  onGo?: (where: 'dig' | 'clean' | 'battle' | 'event' | 'party' | 'dex' | 'profile' | 'title' | 'debug') => void;

  constructor() { super('home'); }

  setData(d: SaveData): void {
    this.data = d;
    this.refresh();
  }

  build(): void {
    this.levelEl = h('div', { class: 'num', text: 'Lv 1' });
    this.coinEl = h('div', { class: 'coin num', text: '0' });

    const strip = h('div', { class: 'status-strip' },
      h('div', { class: 'home-head' },
        h('div', { class: 'who' },
          this.levelEl,
          this.expBar.el,
        ),
        this.coinEl,
      ),
    );

    this.noticeEl = h('div', { class: 'home-notice', hidden: true });
    this.grid = h('div', { class: 'home-grid' });

    const deck = h('div', { class: 'deck deck--home' },
      h('div', { class: 'home-deck-inner' }, this.noticeEl, this.grid),
    );

    const tile = (key: string, label: string, icon: string, go: () => void): void => {
      const b = button(label, () => { audio.uiTap(); go(); }, { class: 'home-tile', icon });
      // 札の色分けは CSS 側で決める。どの導線かを DOM に残しておく
      b.dataset.tile = key;
      this.tiles.set(key, b);
      this.grid.appendChild(b);
    };

    tile('dig', '発掘', '⛏', () => this.onGo?.('dig'));
    tile('clean', '精錬', '✦', () => this.onGo?.('clean'));
    tile('battle', 'バトル', '⚔', () => this.onGo?.('battle'));
    tile('event', 'イベント', '✉', () => this.onGo?.('event'));
    tile('party', '編成', '❖', () => this.onGo?.('party'));
    tile('dex', '図鑑', '☰', () => this.onGo?.('dex'));
    tile('profile', 'プロフィール', '✎', () => this.onGo?.('profile'));
    tile('title', 'タイトル', '⌂', () => this.onGo?.('title'));
    // 一度開いたら拠点からも行けるようにする。毎回タイトルへ戻って
    // 長押しし直すのは、検証のたびに払うには高い
    tile('debug', 'デバッグ', '⚙', () => this.onGo?.('debug'));

    this.el.append(strip, deck);
  }

  enter(): void { this.refresh(); }

  private refresh(): void {
    if (!this.data || !this.levelEl) return;
    const p = this.data.player;
    this.levelEl.textContent = `Lv ${p.level}`;
    this.expBar.set(p.exp / Math.max(1, expToNext(p.level)));
    this.coinEl.textContent = `◈ ${fmtNum(p.coins)}`;

    const stock = this.data.stock.length;
    const badge = (key: string, n: number): void => {
      const b = this.tiles.get(key);
      if (!b) return;
      b.querySelector('.badge')?.remove();
      if (n > 0) b.appendChild(h('span', { class: 'badge num', text: String(n) }));
    };
    badge('clean', stock);
    badge('dex', 0);
    const dbg = this.tiles.get('debug');
    if (dbg) dbg.hidden = this.data.settings.debug !== true;
    // 挑めるのに手を付けていないイベントだけ数える。
    // 「まだ届かない依頼」を数に入れると、ただの不安になる
    badge('event', EVENTS.filter(
      (e) => this.data.stageProgress >= e.requires && !this.data.events.cleared.includes(e.id),
    ).length);

    // 逓減は隠さず見せる。同じ数字でも提示の有無で体感が変わる
    const decay = dropDecay(this.data.daily.runs);
    clear(this.noticeEl);
    const lines: string[] = [];
    if (stock > 0) lines.push(`未精錬の化石が ${stock} 個`);
    if (decay < 0.999) lines.push(`本日の探索効率 ${Math.round(decay * 100)}%`);
    if (this.data.roster.length === 0) lines.push('まずは発掘へ');
    this.noticeEl.hidden = lines.length === 0;
    for (const l of lines) this.noticeEl.appendChild(h('div', { class: 'notice-line', text: l }));
  }
}
