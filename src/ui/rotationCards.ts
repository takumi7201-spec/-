import { h, button } from './dom';
import { todayKey, type SaveData } from '../core/Save';
import {
  BOSS_TIERS, BOSS_TIME, DAILY_REPLAY_COINS,
  bossFor, bossState, buildDailyTeam, dailyReward, dailyRuleFor, dailyState,
  msUntilNextDay, msUntilNextWeek, remainText,
} from '../game/data/rotation';
import { buildTeamSetup, teamAnchor } from '../game/party';
import { getRevos, revosShortName, ROLE_NAMES } from '../game/data/revos';
import { ELEMENT_NAMES } from '../voxel/palette';
import { revosIcon } from './revosIcon';
import { spaced } from './chrome';
import { audio } from '../core/Audio';

/**
 * 日替わり・週替わりの札。
 *
 * 物語のイベント札と同じ板を使う——相手・条件・報酬を1枚で読み切らせる。
 * 違うのは「いつ入れ替わるか」を必ず添えること。入れ替わる札は、
 * 残り時間が見えて初めて「今日のうちに」という理由になる。
 */

function anchorOf(data: SaveData): { level: number; clean: number; size: number } {
  const setup = buildTeamSetup(data.roster, data.party.order);
  return setup ? teamAnchor(setup) : { level: 1, clean: 60, size: 1 };
}

export function dailyCard(data: SaveData, onGo: () => void): HTMLElement {
  const date = todayKey();
  const rule = dailyRuleFor(date);
  const st = dailyState(data, date);
  const anchor = anchorOf(data);
  const foes = buildDailyTeam(date, data.stageProgress, anchor).members;
  const reward = dailyReward(data.stageProgress);
  const el = rule.element ? `（${ELEMENT_NAMES[rule.element]}）` : '';

  return h('div', { class: `event-card rot-card rot-card--daily ${st.won ? 'is-cleared' : ''}` },
    h('div', { class: 'event-head' },
      h('span', { class: 'label', text: spaced(`今日の戦場 · ${rule.subtitle}`) }),
      h('span', { class: 'rot-remain', text: remainText(msUntilNextDay()) }),
      st.won ? h('span', { class: 'event-stamp' }, h('span', { text: spaced('勝利') })) : null,
    ),
    h('div', { class: 'event-name', text: rule.name }),
    h('p', { class: 'event-desc', text: rule.desc }),
    h('div', { class: 'rot-hint' },
      h('span', { class: 'rot-hint-tag', text: '勝ち筋' }),
      h('span', { text: rule.hint }),
    ),

    h('div', { class: 'label event-sub', text: spaced('きょうの相手') }),
    h('div', { class: 'event-foes' },
      ...foes.map((m) => {
        const d = getRevos(m.defId);
        return h('div', { class: 'event-foe' },
          revosIcon(m.defId, 'event-foe-icon'),
          h('span', { class: `chip chip--${d.element}`, text: ELEMENT_NAMES[d.element] }),
          h('span', { class: 'event-foe-name', text: revosShortName(m.defId) }),
        );
      }),
    ),
    h('div', { class: 'event-meta num', text: `Lv${anchor.level}（編成の平均）· 1日のあいだ同じ相手` }),

    h('div', { class: 'label event-sub', text: spaced('ほうしゅう') }),
    h('div', { class: 'rot-rewards' },
      st.won
        ? h('div', { class: 'rot-reward is-done', text: `きょうの初勝利は受け取り済み — 再戦は ◈ ${DAILY_REPLAY_COINS}` })
        : h('div', { class: 'rot-reward' },
          h('span', { class: 'rot-reward-tag', text: '初勝利' }),
          h('span', { class: 'num', text: `◈ ${reward.coins}` }),
          h('span', { text: `＋ ${'★'.repeat(reward.rarity)} の化石${el}` }),
        ),
    ),
    button(st.won ? 'もう一度挑む' : '挑む', () => { audio.uiConfirm(); onGo(); },
      { class: `btn--wide ${st.won ? '' : 'btn--primary'} event-go` }),
  );
}

export function bossCard(data: SaveData, onGo: () => void): HTMLElement {
  const date = todayKey();
  const boss = bossFor(date);
  const st = bossState(data, date);
  const def = getRevos(boss.defId);
  const best = Math.min(1, st.best);

  const track = h('div', { class: 'rot-track' },
    h('i', { class: 'rot-track-fill', style: `width:${(best * 100).toFixed(1)}%` }),
    ...BOSS_TIERS.map((t, i) => h('span', {
      class: `rot-tick ${st.claimed.includes(i) ? 'is-got' : ''}`,
      style: `left:${t.at * 100}%`,
    })),
  );

  return h('div', { class: `event-card rot-card rot-card--boss ${st.claimed.length === BOSS_TIERS.length ? 'is-cleared' : ''}` },
    h('div', { class: 'event-head' },
      h('span', { class: 'label', text: spaced('巨獣討伐 · 今週') }),
      h('span', { class: 'rot-remain', text: remainText(msUntilNextWeek()) }),
      st.claimed.includes(BOSS_TIERS.length - 1)
        ? h('span', { class: 'event-stamp' }, h('span', { text: spaced('討伐') }))
        : null,
    ),
    h('div', { class: 'rot-boss' },
      revosIcon(boss.defId, 'rot-boss-icon'),
      h('div', { class: 'rot-boss-main' },
        h('div', { class: 'event-name', text: boss.title }),
        h('div', { class: 'rot-boss-sub' },
          h('span', { class: `chip chip--${def.element}`, text: ELEMENT_NAMES[def.element] }),
          `${def.name} · ${ROLE_NAMES[def.role]} · ${'★'.repeat(def.rarity)}`,
        ),
      ),
    ),
    h('p', { class: 'event-desc', text: boss.desc }),
    h('div', { class: 'event-meta num', text: `1体きり · 制限時間 ${BOSS_TIME} 秒 · 与えたダメージで報酬が決まる` }),

    h('div', { class: 'rot-track-head' },
      h('span', { class: 'label', text: spaced('今週の最高') }),
      h('span', { class: 'num rot-best', text: `${Math.floor(best * 100)}%` }),
    ),
    track,
    h('div', { class: 'rot-tiers' },
      ...BOSS_TIERS.map((t, i) => {
        const got = st.claimed.includes(i);
        const fossil = t.fossil === 'boss'
          ? `＋ ${revosShortName(boss.defId)}の化石`
          : t.fossil ? `＋ ${'★'.repeat(t.fossil.rarity)} の化石` : '';
        return h('div', { class: `rot-tier ${got ? 'is-got' : ''}` },
          h('span', { class: `rot-tier-name rot-tier-name--${i}`, text: t.name }),
          h('span', { class: 'rot-tier-at num', text: t.at >= 1 ? '討伐' : `${Math.round(t.at * 100)}%` }),
          h('span', { class: 'rot-tier-reward', text: `◈ ${t.coins} ${fossil}` }),
          h('span', { class: 'rot-tier-mark', text: got ? '受取済' : '' }),
        );
      }),
    ),
    button('挑む', () => { audio.uiConfirm(); onGo(); }, { class: 'btn--wide btn--primary event-go' }),
  );
}
