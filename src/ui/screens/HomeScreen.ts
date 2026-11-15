import { Screen } from '../UIRoot';
import { h, bar, button, clear, fmtNum } from '../dom';
import { banner, cardButton, coinMark, identity, plate, railButton, spaced } from '../chrome';
import type { SaveData } from '../../core/Save';
import { expToNext, dropDecay } from '../../core/Save';
import { revosIcon } from '../revosIcon';
import { RUN_WINS } from '../../game/run/run';
import { unclaimedCount } from '../../game/mail';
import { missionRatio, nearestMission, readyCount } from '../../game/missions';
import { unreadNews } from '../../game/news';

const MAX_HEARTS = 5;

/**
 * 拠点。
 *
 * 画面を「読む面」と「押す面」に割る。上半分は自分の現在地（身分・帯・計器）、
 * 下半分と両端が導線。導線は3種類しか置かない——下タブ（行き先）、
 * 左の丸（設定まわり）、右の色札（いま溜まっている仕事）。
 * 3種類とも押せる見た目にすると選べなくなるので、色を持てるのは右の札だけにする。
 */
export class HomeScreen extends Screen {
  private data!: SaveData;

  private ident = identity();
  private nameEl!: HTMLElement;
  private subEl!: HTMLElement;
  private coinEl!: HTMLElement;
  private bannerEl = banner(() => this.onGo?.('event'));
  private dotsEl!: HTMLElement;
  private heartsEl!: HTMLElement;
  private effEl!: HTMLElement;
  private expBar = bar('bar--exp', 0);
  private expTextEl!: HTMLElement;
  private goalPlate = plate('次の目標', { tone: 'plain' });
  private misNameEl!: HTMLElement;
  private misCountEl!: HTMLElement;
  private misBar = bar('bar--exp', 0);
  private misMoreEl!: HTMLButtonElement;
  private misBadgeEl!: HTMLElement;
  private cards = new Map<string, ReturnType<typeof cardButton>>();
  private rails = new Map<string, ReturnType<typeof railButton>>();

  onGo?: (where: 'dig' | 'clean' | 'battle' | 'event' | 'news' | 'shop' | 'mission'
    | 'mail' | 'unit' | 'settings' | 'profile') => void;

  constructor() { super('home', 'home'); }

  setData(d: SaveData): void {
    this.data = d;
    this.refresh();
  }

  build(): void {
    // ---- 頭。身分と通貨 ----
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
            h('div', { class: 'wallet-inner' },
              coinMark(),
              this.coinEl,
            ),
          ),
        ),
      ),
    );

    // ---- 帯。次に挑めるものを1件だけ ----
    this.dotsEl = h('div', { class: 'banner-dots' });
    const bannerWrap = h('div', { class: 'home-banner' }, this.bannerEl.el, this.dotsEl);

    // ---- 左の丸列 ----
    const rail = h('div', { class: 'rail-col home-rail' });
    const addRail = (key: string, icon: string, label: string, go: () => void): void => {
      const r = railButton(icon, label, go);
      this.rails.set(key, r);
      rail.appendChild(r.el);
    };
    addRail('profile', '◱', '記録', () => this.onGo?.('profile'));
    addRail('mail', '✉', 'メールボックス', () => this.onGo?.('mail'));

    // ---- 右の色札 ----
    const cards = h('div', { class: 'card-col home-cards' });
    const addCard = (key: string, icon: string, label: string,
      tone: 'rose' | 'amber' | 'mint' | 'dim', go: () => void): void => {
      const c = cardButton(icon, label, tone, go);
      this.cards.set(key, c);
      cards.appendChild(c.el);
    };
    // 精錬は「発掘」の中へ移した。掘るのと削るのはひと続きの作業なので、
    // 入口を2か所に割らない。空いた枠には、外から届くものを置く
    addCard('news', '▤', 'ニュース', 'rose', () => this.onGo?.('news'));
    addCard('shop', '✦', 'ショップ', 'amber', () => this.onGo?.('shop'));

    // ---- 計器。心と帯 ----
    this.heartsEl = h('div', { class: 'hearts' });
    this.effEl = h('span', { class: 'home-eff' });
    this.expTextEl = h('div', { class: 'gauge-text num' });

    const gauge = h('div', { class: 'home-gauge' },
      h('div', { class: 'home-gauge-top' }, this.heartsEl, this.effEl),
      h('div', { class: 'gauge-wrap' }, this.expBar.el, this.expTextEl),
    );

    const foot = h('div', { class: 'home-foot' }, gauge, this.goalPlate.el);

    // ---- ミッション。ステージの上に1件だけ ----
    // 一覧を常に出すと、拠点が表になる。出すのは「次に片付くもの」1件で、
    // 残りは横のボタンの向こうに畳む
    this.misNameEl = h('span', { class: 'mission-name' });
    this.misCountEl = h('span', { class: 'mission-count num' });
    this.misBadgeEl = h('span', { class: 'mission-badge num', hidden: true });
    const strip = button('', () => this.onGo?.('mission'), { class: 'mission-strip' });
    strip.append(
      h('span', { class: 'mission-eyebrow', text: spaced('ミッション') }),
      this.misNameEl,
      h('span', { class: 'mission-gauge' }, this.misBar.el, this.misCountEl),
    );
    this.misMoreEl = button('一覧', () => this.onGo?.('mission'), { class: 'btn--sm mission-more' });
    this.misMoreEl.appendChild(this.misBadgeEl);
    const mission = h('div', { class: 'home-mission' }, strip, this.misMoreEl);

    this.el.append(head, bannerWrap, rail, cards, mission, foot);
  }

  enter(): void { this.refresh(); }

  private refresh(): void {
    if (!this.data || !this.nameEl) return;
    const p = this.data.player;

    // ---- 身分 ----
    this.ident.set(p.level);
    clear(this.ident.frame);
    // 顔は手持ちの先頭。まだ居なければ空のまま——偽の個体は置かない
    const face = this.data.party.order?.find((uid) => uid)
      ?? this.data.roster[0]?.uid;
    const faceUnit = this.data.roster.find((r) => r.uid === face);
    if (faceUnit) this.ident.frame.appendChild(revosIcon(faceUnit.defId, 'ident-img'));
    this.nameEl.textContent = 'ディガー';
    this.subEl.textContent =
      `調査番号 ${String(this.data.stats.runs).padStart(4, '0')} · ${titleOf(this.data)}`;
    this.coinEl.textContent = fmtNum(p.coins);

    // ---- 帯。進行中のランか、新しいランへの誘い ----
    const run = this.data.run;
    if (run) {
      this.bannerEl.set('ラン進行中', `${run.round}周目 · ${run.wins}勝 · ライフ ${run.lives}`, `${run.wins}/${RUN_WINS}`);
    } else {
      this.bannerEl.set('ラン', '新しいランを始める', '開始');
    }
    clear(this.dotsEl);

    // ---- 右の色札 ----
    this.cards.get('news')?.badge(unreadNews(this.data));
    this.cards.get('shop')?.badge(0);
    // 受信箱だけ数を出す。何通あるかで受け取りの手間が変わる
    this.rails.get('mail')?.badge(unclaimedCount(this.data));

    // ---- 計器 ----
    // 心は「今日あと何回、目減りせずに潜れるか」。数字ではなく粒で出す
    const runs = this.data.daily.runs;
    clear(this.heartsEl);
    for (let i = 0; i < MAX_HEARTS; i++) {
      this.heartsEl.appendChild(h('i', { class: `heart ${i < Math.max(0, MAX_HEARTS - runs) ? 'is-on' : ''}` }));
    }
    const decay = dropDecay(runs);
    this.effEl.textContent = `本日の効率 ${Math.round(decay * 100)}%`;
    const need = Math.max(1, expToNext(p.level));
    this.expBar.set(p.exp / need);
    this.expTextEl.textContent = `${fmtNum(p.exp)} / ${fmtNum(need)}`;

    // ---- 次の目標 ----
    // 発掘地は、いまの到達段が入る層を出す。行き先の名前が無いと目標にならない
    const rec = this.data.runRecord;
    this.goalPlate.set(`ラン 最高 ${rec?.best ?? 0}勝`, `達成 ${rec?.clears ?? 0}回`);

    // ---- ミッション ----
    const near = nearestMission(this.data);
    const ready = readyCount(this.data);
    if (near) {
      const now = Math.min(near.goal, near.progress(this.data));
      this.misNameEl.textContent = near.name;
      this.misBar.set(missionRatio(this.data, near));
      this.misCountEl.textContent = `${fmtNum(now)} / ${fmtNum(near.goal)}${near.unit}`;
    } else {
      // すべて受け取り終えた状態。空の帯を出すより、その事実を書く
      this.misNameEl.textContent = 'すべて受け取り済み';
      this.misBar.set(1);
      this.misCountEl.textContent = '—';
    }
    // 受け取れるものがあるときだけ帯を光らせる。常時光ると合図にならない
    this.misNameEl.parentElement?.classList.toggle('is-ready', ready > 0);
    this.misBadgeEl.textContent = String(ready);
    this.misBadgeEl.hidden = ready === 0;

  }
}

/** 称号。プロフィールと同じ段を使う——画面ごとに違う呼び名にしない */
function titleOf(d: SaveData): string {
  const n = d.stats.found;
  if (n >= 120) return '深層の目';
  if (n >= 60) return '層を読む者';
  if (n >= 30) return '掘り手';
  if (n >= 10) return '見習い';
  return '新入り';
}
