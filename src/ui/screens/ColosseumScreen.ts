import { Screen } from '../UIRoot';
import { h, button, clear } from '../dom';
import type { SaveData } from '../../core/Save';
import {
  COLOSSEUM_FLOOR, COLOSSEUM_TIERS, colosseumCoins, nextTier, rateRange, tierOf,
} from '../../game/data/colosseum';
import { BIOMES } from '../../voxel/palette';
import { coinAmount, plate, screenHead, spaced } from '../chrome';
import { audio } from '../../core/Audio';

/**
 * コロシアム。
 *
 * バトルの札の中に置いていたが、レートは1本きりの長い数字で、段や
 * イベントとは数え方そのものが違う——同じ一覧に並べると「今日やること」の
 * 1つに見える。特設の面に移して、階級・レート・相手・動く幅だけを置く。
 */
export class ColosseumScreen extends Screen {
  private data!: SaveData;
  private bodyEl!: HTMLElement;
  private ratePlate = plate('レート', { tone: 'amber' });

  onBack?: () => void;
  onGo?: () => void;
  onRanking?: () => void;

  constructor() { super('colosseum', 'battle'); }

  setData(d: SaveData): void { this.data = d; this.render(); }

  build(): void {
    const head = screenHead({
      eyebrow: '闘技', title: 'コロシアム',
      onBack: () => this.onBack?.(),
      right: this.ratePlate.el,
    });
    this.bodyEl = h('div', { class: 'col-body' });
    this.el.append(head, this.bodyEl);
  }

  enter(): void { this.render(); }

  private render(): void {
    if (!this.data || !this.bodyEl) return;
    const st = this.data.colosseum;
    const tier = tierOf(st.rate);
    const up = nextTier(st.rate);
    const total = st.wins + st.losses;
    const win = rateRange(st.rate, true);
    const lose = rateRange(st.rate, false);
    const base = tier.at;
    const span = up ? up.tier.at - base : 200;
    const fill = Math.max(0, Math.min(1, (st.rate - base) / span));

    this.ratePlate.set(String(st.rate), tier.name);
    clear(this.bodyEl);

    this.bodyEl.append(
      // ---- いまの位置 ----
      h('div', { class: 'col-panel col-panel--rate' },
        h('div', { class: 'col-rate-main' },
          h('span', { class: 'col-tier', text: tier.name }),
          h('span', { class: 'col-rate-num num', text: String(st.rate) }),
        ),
        h('div', { class: 'col-rate-sub num' },
          h('span', { text: `最高 ${st.best}` }),
          h('span', { text: total > 0 ? `${st.wins}勝 ${st.losses}敗` : 'まだ戦っていない' }),
          st.streak > 1 ? h('span', { class: 'col-streak', text: `${st.streak} 連勝` }) : null,
          st.bestStreak > 1 ? h('span', { class: 'dim', text: `最高 ${st.bestStreak} 連勝` }) : null,
        ),
        h('div', { class: 'col-track' },
          h('i', { class: 'col-track-fill', style: `width:${(fill * 100).toFixed(1)}%` }),
        ),
        h('div', { class: 'col-next num', text: up ? `${up.tier.name} まで あと ${up.need}` : '最上級に到達している' }),
        h('div', { class: 'col-floor', text: `舞台は ${BIOMES[tier.biome].name}・レートは ${COLOSSEUM_FLOOR} より下がらない` }),
      ),

      // ---- 階級の一覧 ----
      h('div', { class: 'label col-section', text: spaced('階級') }),
      h('div', { class: 'col-ladder' },
        ...COLOSSEUM_TIERS.map((t) => h('div', {
          class: `col-rung ${t.name === tier.name ? 'is-on' : st.rate >= t.at ? 'is-past' : ''}`,
        },
        h('span', { class: 'col-rung-name', text: t.name }),
        h('span', { class: 'col-rung-at num', text: t.at === 0 ? '—' : String(t.at) }),
        h('span', { class: 'col-rung-note', text: `★${t.rarityCap} まで · 刻印 ${t.grade === 0 ? 'なし' : t.grade}` }),
        )),
      ),

      // ---- 相手 ----
      h('div', { class: 'label col-section', text: spaced('相手') }),
      h('div', { class: 'col-panel col-panel--blind' },
        h('div', { class: 'col-blind-main', text: '挑んだときに決まる' }),
        h('p', { class: 'col-blind-note', text:
          '相手はいまの編成を見て組まれる。階級が上がるほど、噛み合いと'
          + '対策まで入れてくる——誰と当たるかは出ていってから分かる。' }),
        h('div', { class: 'col-blind-tier', text: `${tier.name}の相手：★${tier.rarityCap} まで · 刻印 ${tier.grade === 0 ? 'なし' : tier.grade} · レベルはこちらに合わせる` }),
      ),

      // ---- 賭けるもの ----
      h('div', { class: 'label col-section', text: spaced('動く幅') }),
      h('div', { class: 'col-stakes' },
        h('div', { class: 'col-stake col-stake--win' },
          h('span', { class: 'col-stake-tag', text: '勝ち' }),
          h('span', { class: 'num', text: `＋${win[0]}〜＋${win[1]}` }),
          coinAmount(colosseumCoins(st.rate, true)),
        ),
        h('div', { class: 'col-stake col-stake--lose' },
          h('span', { class: 'col-stake-tag', text: '負け' }),
          h('span', { class: 'num', text: `${lose[0]}〜${lose[1]}` }),
          coinAmount(colosseumCoins(st.rate, false)),
        ),
      ),
      button('使用率ランキング', () => { audio.uiTap(); this.onRanking?.(); },
        { class: 'btn--wide btn--opt col-rank-go' }),
      h('div', { class: 'col-note', text: '相手のレートはこちらの前後 80 に振れる。幅はそのぶん' }),
    );

    const deck = h('div', { class: 'deck deck--col' },
      button('挑む', () => { audio.uiConfirm(); this.onGo?.(); }, { class: 'btn--wide btn--primary' }),
    );
    this.el.querySelector('.deck--col')?.remove();
    this.el.appendChild(deck);
  }
}
