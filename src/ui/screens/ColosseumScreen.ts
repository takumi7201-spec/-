import { Screen } from '../UIRoot';
import { h, button, clear } from '../dom';
import type { SaveData } from '../../core/Save';
import {
  COLOSSEUM_FLOOR, COLOSSEUM_TIERS, buildRival, colosseumCoins, nextTier, rateDelta, tierOf,
} from '../../game/data/colosseum';
import { buildTeamSetup, effectiveParty, teamAnchor } from '../../game/party';
import { getRevos, revosShortName, ROLE_NAMES } from '../../game/data/revos';
import { BIOMES, ELEMENT_NAMES } from '../../voxel/palette';
import { revosIcon } from '../revosIcon';
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
    const setup = buildTeamSetup(this.data.roster, this.data.party.order);
    const anchor = setup ? teamAnchor(setup) : { level: 1, clean: 60, size: 1 };
    const rival = buildRival(st, anchor, effectiveParty(this.data).map((u) => u.defId));
    const total = st.wins + st.losses;
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

      // ---- つぎの相手 ----
      h('div', { class: 'label col-section', text: spaced('つぎの相手') }),
      h('div', { class: 'col-panel' },
        h('div', { class: 'col-rival' },
          h('span', { class: 'col-rival-name', text: rival.name }),
          h('span', { class: 'col-rival-rate num', text: `レート ${rival.rate}` }),
        ),
        h('div', { class: 'col-tactic', text: rival.tactic }),
        h('div', { class: 'event-foes' },
          ...rival.team.members.map((m) => {
            const d = getRevos(m.defId);
            return h('div', { class: 'event-foe' },
              revosIcon(m.defId, 'event-foe-icon'),
              h('span', { class: `chip chip--${d.element}`, text: ELEMENT_NAMES[d.element] }),
              h('span', { class: 'event-foe-name', text: revosShortName(m.defId) }),
              h('span', { class: 'col-foe-role', text: ROLE_NAMES[d.role] }),
            );
          }),
        ),
        h('div', { class: 'event-meta num', text: `Lv${rival.team.members[0]?.level ?? 1}（こちらに合わせる）· クリーン度 ${rival.team.members[0]?.clean ?? 60}` }),
      ),

      // ---- 賭けるもの ----
      h('div', { class: 'label col-section', text: spaced('動く幅') }),
      h('div', { class: 'col-stakes' },
        h('div', { class: 'col-stake col-stake--win' },
          h('span', { class: 'col-stake-tag', text: '勝ち' }),
          h('span', { class: 'num', text: `＋${rateDelta(st.rate, rival.rate, true)}` }),
          coinAmount(colosseumCoins(st.rate, true)),
        ),
        h('div', { class: 'col-stake col-stake--lose' },
          h('span', { class: 'col-stake-tag', text: '負け' }),
          h('span', { class: 'num', text: `${rateDelta(st.rate, rival.rate, false)}` }),
          coinAmount(colosseumCoins(st.rate, false)),
        ),
      ),
      h('div', { class: 'col-note', text: '相手はレートと戦績から決まる。開き直しても替わらない' }),
    );

    const deck = h('div', { class: 'deck deck--col' },
      button('挑む', () => { audio.uiConfirm(); this.onGo?.(); }, { class: 'btn--wide btn--primary' }),
    );
    this.el.querySelector('.deck--col')?.remove();
    this.el.appendChild(deck);
  }
}
