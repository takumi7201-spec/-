import { h, button } from './dom';
import type { SaveData } from '../core/Save';
import {
  COLOSSEUM_FLOOR, buildRival, colosseumCoins, nextTier, rateDelta, tierOf,
} from '../game/data/colosseum';
import { buildTeamSetup, teamAnchor } from '../game/party';
import { getRevos, revosShortName, ROLE_NAMES } from '../game/data/revos';
import { BIOMES, ELEMENT_NAMES } from '../voxel/palette';
import { revosIcon } from './revosIcon';
import { coinAmount, spaced } from './chrome';
import { audio } from '../core/Audio';

/**
 * コロシアムの札。
 *
 * 出すのは4つだけ——いまのレート、階級、次の相手、動く幅。
 * 「勝ったらどれだけ上がり、負けたらどれだけ下がるか」を挑む前に
 * 見せておかないと、1本の数字が上下するだけの画面になる。
 */
export function colosseumCard(data: SaveData, onGo: () => void): HTMLElement {
  const st = data.colosseum;
  const tier = tierOf(st.rate);
  const up = nextTier(st.rate);
  const setup = buildTeamSetup(data.roster, data.party.order);
  const anchor = setup ? teamAnchor(setup) : { level: 1, clean: 60, size: 1 };
  const rival = buildRival(st, anchor);
  const total = st.wins + st.losses;

  // 進み具合の帯。階級の中でどこに居るかを出す
  const base = tier.at;
  const span = up ? up.tier.at - base : 200;
  const fill = Math.max(0, Math.min(1, (st.rate - base) / span));

  return h('div', { class: 'event-card rot-card rot-card--col' },
    h('div', { class: 'event-head' },
      h('span', { class: 'label', text: spaced('コロシアム') }),
      h('span', { class: 'rot-remain', text: `${BIOMES[tier.biome].name}` }),
    ),

    h('div', { class: 'col-rate' },
      h('div', { class: 'col-rate-main' },
        h('span', { class: 'col-tier', text: tier.name }),
        h('span', { class: 'col-rate-num num', text: String(st.rate) }),
      ),
      h('div', { class: 'col-rate-sub num' },
        h('span', { text: `最高 ${st.best}` }),
        h('span', { text: total > 0 ? `${st.wins}勝 ${st.losses}敗` : 'まだ戦っていない' }),
        st.streak > 1 ? h('span', { class: 'col-streak', text: `${st.streak} 連勝` }) : null,
      ),
    ),
    h('div', { class: 'col-track' }, h('i', { class: 'col-track-fill', style: `width:${(fill * 100).toFixed(1)}%` })),
    h('div', { class: 'col-next num', text: up ? `${up.tier.name} まで あと ${up.need}` : '最上級に到達している' }),

    h('div', { class: 'label event-sub', text: spaced('つぎの相手') }),
    h('div', { class: 'col-rival' },
      h('span', { class: 'col-rival-name', text: rival.name }),
      h('span', { class: 'col-rival-rate num', text: `レート ${rival.rate}` }),
    ),
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

    h('div', { class: 'label event-sub', text: spaced('動く幅') }),
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
    st.rate <= COLOSSEUM_FLOOR
      ? h('div', { class: 'col-floor', text: `レートは ${COLOSSEUM_FLOOR} より下がらない` })
      : null,

    button('挑む', () => { audio.uiConfirm(); onGo(); }, { class: 'btn--wide btn--primary event-go' }),
  );
}
