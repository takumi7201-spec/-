import { Screen } from '../UIRoot';
import { h, clear } from '../dom';
import type { SaveData } from '../../core/Save';
import { NEWS, NEWS_TAGS, isUnread, markAllRead, unreadNews } from '../../game/news';
import { screenHead, plate, spaced } from '../chrome';

/**
 * お知らせ。
 *
 * 開いた時点でまとめて既読にする。1件ずつ開かせると、読む気の無い
 * 告知を消すためだけに全部を開く手間が生まれる——未読の印は
 * 「新しいものがある」の合図であって、達成率ではない。
 *
 * 本文は畳まない。畳んだ札が並ぶと、どれを開くかを題だけで
 * 決めることになり、結局ぜんぶ開く。
 */
export class NewsScreen extends Screen {
  private data!: SaveData;
  private listEl!: HTMLElement;
  private countPlate = plate('未読', { tone: 'amber' });

  onBack?: () => void;
  /** 既読が動くので、保存はゲーム側に任せる */
  onRead?: () => void;

  constructor() { super('news'); }

  setData(d: SaveData): void { this.data = d; this.render(); }

  build(): void {
    const head = screenHead({
      eyebrow: '告知', title: 'ニュース',
      onBack: () => this.onBack?.(),
      right: this.countPlate.el,
    });
    this.listEl = h('div', { class: 'news-body' });
    this.el.append(head, this.listEl);
  }

  enter(): void {
    this.render();
    // 描いてから既読にする。先に消すと、開いた回で新着の印が見えない
    if (this.data && markAllRead(this.data) > 0) this.onRead?.();
  }

  private render(): void {
    if (!this.data || !this.listEl) return;
    this.countPlate.set(String(unreadNews(this.data)));

    clear(this.listEl);
    for (const n of NEWS) {
      const fresh = isUnread(this.data, n.id);
      this.listEl.appendChild(h('div', { class: `news-card ${fresh ? 'is-new' : ''}` },
        h('div', { class: 'news-head' },
          h('span', { class: `news-tag news-tag--${n.tag}`, text: spaced(NEWS_TAGS[n.tag]) }),
          h('span', { class: 'news-date num', text: n.date }),
          fresh ? h('span', { class: 'news-new', text: 'NEW' }) : null,
        ),
        h('div', { class: 'news-title', text: n.title }),
        h('p', { class: 'news-desc', text: n.body }),
      ));
    }
  }
}
