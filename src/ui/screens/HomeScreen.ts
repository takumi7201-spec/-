import { Screen } from '../UIRoot';
import { h, bar, clear, fmtNum } from '../dom';
import { banner, cardButton, identity, plate, railButton, tabBar } from '../chrome';
import type { SaveData } from '../../core/Save';
import { expToNext, dropDecay } from '../../core/Save';
import { revosIcon } from '../revosIcon';
import { BIOMES } from '../../voxel/palette';
import { EVENTS } from '../../game/data/events';

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
  private cards = new Map<string, ReturnType<typeof cardButton>>();
  private rails = new Map<string, ReturnType<typeof railButton>>();
  private tabs = tabBar([
    { key: 'home', icon: '⌂', label: '拠点', onTap: () => { /* いまここ */ } },
    { key: 'dig', icon: '⛏', label: '発掘', onTap: () => this.onGo?.('dig') },
    { key: 'battle', icon: '⚔', label: 'バトル', onTap: () => this.onGo?.('battle') },
    { key: 'party', icon: '◈', label: '編成', onTap: () => this.onGo?.('party') },
    { key: 'dex', icon: '☰', label: '図鑑', onTap: () => this.onGo?.('dex') },
  ]);

  onGo?: (where: 'dig' | 'clean' | 'battle' | 'event' | 'party' | 'dex' | 'profile' | 'title' | 'debug') => void;

  constructor() { super('home'); }

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
              h('i', { class: 'wallet-dot wallet-dot--coin' }),
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
    addRail('event', '✉', '便り', () => this.onGo?.('event'));
    addRail('title', '⌂', 'タイトルへ', () => this.onGo?.('title'));
    addRail('debug', '⚙', '検証', () => this.onGo?.('debug'));

    // ---- 右の色札 ----
    const cards = h('div', { class: 'card-col home-cards' });
    const addCard = (key: string, icon: string, label: string,
      tone: 'rose' | 'amber' | 'mint' | 'dim', go: () => void): void => {
      const c = cardButton(icon, label, tone, go);
      this.cards.set(key, c);
      cards.appendChild(c.el);
    };
    addCard('clean', '◈', '精錬', 'amber', () => this.onGo?.('clean'));
    addCard('event', '✦', '依頼', 'rose', () => this.onGo?.('event'));

    // ---- 計器。心と帯 ----
    this.heartsEl = h('div', { class: 'hearts' });
    this.effEl = h('span', { class: 'home-eff' });
    this.expTextEl = h('div', { class: 'gauge-text num' });

    const gauge = h('div', { class: 'home-gauge' },
      h('div', { class: 'home-gauge-top' }, this.heartsEl, this.effEl),
      h('div', { class: 'gauge-wrap' }, this.expBar.el, this.expTextEl),
    );

    const foot = h('div', { class: 'home-foot' }, gauge, this.goalPlate.el);

    this.tabs.select('home');
    this.el.append(head, bannerWrap, rail, cards, foot, this.tabs.el);
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

    // ---- 帯。挑めるイベントのうち先頭、無ければ次の発掘地 ----
    const open = EVENTS.filter(
      (e) => this.data.stageProgress >= e.requires && !this.data.events.cleared.includes(e.id),
    );
    const cleared = EVENTS.filter((e) => this.data.events.cleared.includes(e.id)).length;
    const pct = Math.round((cleared / Math.max(1, EVENTS.length)) * 100);
    if (open.length > 0) {
      this.bannerEl.set('記録の残響', open[0].name, `${pct}%`);
    } else {
      const next = EVENTS.find((e) => !this.data.events.cleared.includes(e.id));
      this.bannerEl.set('記録の残響', next ? `${next.name}（ステージ ${next.requires}）` : '記録は全て辿った', `${pct}%`);
    }
    // 点は「他にも控えている」の合図。1件しか無いときは出さない
    clear(this.dotsEl);
    if (open.length > 1) {
      for (let i = 0; i < Math.min(4, open.length); i++) {
        this.dotsEl.appendChild(h('i', { class: i === 0 ? 'is-on' : '' }));
      }
    }

    // ---- 右の色札 ----
    const stock = this.data.stock.length;
    this.cards.get('clean')?.badge(stock);
    this.cards.get('event')?.badge(open.length);
    // 未解放の導線は暗い札のまま置いておく。消すと「あとで増える」が伝わらない
    this.rails.get('debug')!.el.hidden = this.data.settings.debug !== true;
    this.rails.get('event')?.alert(open.length > 0);

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
    const stage = this.data.stageProgress + 1;
    const biome = Object.values(BIOMES).find((b) => stage >= b.level[0] && stage <= b.level[1])
      ?? Object.values(BIOMES)[0];
    this.goalPlate.set(`ステージ ${stage}`, biome.name);

    // ---- タブの報せ ----
    this.tabs.badge('party', this.data.roster.length === 0 ? 0 : 0);
    this.tabs.badge('dex', 0);
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
