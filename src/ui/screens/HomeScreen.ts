import { Screen } from '../UIRoot';
import { h, clear, fmtNum } from '../dom';
import { banner, cardButton, coinMark, identity, plate } from '../chrome';
import type { SaveData } from '../../core/Save';
import { revosIcon } from '../revosIcon';
import { RUN_WINS } from '../../game/run/run';
import { unreadNews } from '../../game/news';

/**
 * 拠点。
 *
 * 遊びはランだけになった。拠点が出すのは、自分の記録と、ランの入口（帯）と、
 * 外から届く知らせ（ニュース）だけ。
 */
export class HomeScreen extends Screen {
  private data!: SaveData;

  private ident = identity();
  private nameEl!: HTMLElement;
  private subEl!: HTMLElement;
  private coinEl!: HTMLElement;
  private bannerEl = banner(() => this.onGo?.('battle'));
  private goalPlate = plate('記録', { tone: 'plain' });
  private cards = new Map<string, ReturnType<typeof cardButton>>();

  onGo?: (where: 'battle' | 'news' | 'settings') => void;

  constructor() { super('home', 'home'); }

  setData(d: SaveData): void {
    this.data = d;
    this.refresh();
  }

  build(): void {
    this.nameEl = h('div', { class: 'home-name', text: 'ディガー' });
    this.subEl = h('div', { class: 'home-sub' });
    this.coinEl = h('span', { class: 'num', text: '0' });

    const head = h('div', { class: 'home-head' },
      this.ident.el,
      h('div', { class: 'home-who' },
        this.nameEl,
        this.subEl,
        h('div', { class: 'home-wallet' },
          h('div', { class: 'wallet-plate' },
            h('div', { class: 'wallet-inner' }, coinMark(), this.coinEl),
          ),
        ),
      ),
    );

    const bannerWrap = h('div', { class: 'home-banner' }, this.bannerEl.el);

    const cards = h('div', { class: 'card-col home-cards' });
    const news = cardButton('▤', 'ニュース', 'rose', () => this.onGo?.('news'));
    this.cards.set('news', news);
    cards.appendChild(news.el);

    const foot = h('div', { class: 'home-foot' }, h('div'), this.goalPlate.el);
    this.el.append(head, bannerWrap, cards, foot);
  }

  enter(): void { this.refresh(); }

  private refresh(): void {
    if (!this.data || !this.nameEl) return;
    const p = this.data.player;
    const rec = this.data.runRecord;

    this.ident.set(p.level);
    clear(this.ident.frame);
    // 顔は、進行中のランの左端。ランが無ければ空のまま
    const face = this.data.run?.board.find((u) => u)?.defId;
    if (face) this.ident.frame.appendChild(revosIcon(face, 'ident-img'));
    this.subEl.textContent = `ラン ${rec?.runs ?? 0}回 · 達成 ${rec?.clears ?? 0}回`;
    this.coinEl.textContent = fmtNum(p.coins);

    const run = this.data.run;
    if (run) {
      this.bannerEl.set('ラン進行中', `${run.round}周目 · ${run.wins}勝 · ライフ ${run.lives}`, `${run.wins}/${RUN_WINS}`);
    } else {
      this.bannerEl.set('ラン', '新しいランを始める', '開始');
    }

    this.cards.get('news')?.badge(unreadNews(this.data));
    this.goalPlate.set(`最高 ${rec?.best ?? 0}勝`, `達成 ${rec?.clears ?? 0}回`);
  }
}
