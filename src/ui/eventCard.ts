import { h, button } from './dom';
import type { SaveData } from '../core/Save';
import type { EventDef } from '../game/data/events';
import { getRevos, revosShortName } from '../game/data/revos';
import { ELEMENT_NAMES } from '../voxel/palette';
import { revosIcon } from './revosIcon';
import { spaced } from './chrome';
import { audio } from '../core/Audio';

/**
 * イベント戦1件ぶんの札。
 *
 * 相手・条件・報酬を同じ板の上で読み切れるようにする——別画面に分けると、
 * 挑む前に編成を決めるための情報が足りなくなる。
 * 一覧と出撃選択の両方から呼ぶので、描画はここ1か所に置く。
 */
export function eventCard(
  ev: EventDef,
  data: SaveData,
  onChallenge: (ev: EventDef) => void,
): HTMLElement {
  const cleared = data.events.cleared.includes(ev.id);
  const locked = data.stageProgress < ev.requires;
  const reward = getRevos(ev.reward.defId);

  return h('div', { class: `event-card ${locked ? 'is-locked' : ''} ${cleared ? 'is-cleared' : ''}` },
    h('div', { class: 'event-head' },
      h('span', { class: 'label', text: spaced(ev.subtitle) }),
      cleared ? h('span', { class: 'event-stamp' }, h('span', { text: spaced('踏破') })) : null,
    ),
    h('div', { class: 'event-name', text: ev.name }),
    h('p', { class: 'event-desc', text: ev.desc }),

    h('div', { class: 'label event-sub', text: spaced('あいて') }),
    h('div', { class: 'event-foes' },
      ...ev.enemies.map((defId) => {
        const d = getRevos(defId);
        return h('div', { class: 'event-foe' },
          revosIcon(defId, 'event-foe-icon'),
          h('span', { class: `chip chip--${d.element}`, text: ELEMENT_NAMES[d.element] }),
          h('span', { class: 'event-foe-name', text: revosShortName(defId) }),
        );
      }),
    ),
    h('div', { class: 'event-meta num', text: `Lv${ev.enemyLevel} / クリーン度 ${ev.enemyClean}` }),

    h('div', { class: 'label event-sub', text: spaced('ほうしゅう') }),
    h('div', { class: 'event-reward' },
      revosIcon(reward.id, 'event-reward-icon'),
      h('div', { class: 'event-reward-main' },
        h('div', { class: 'event-reward-name', text: `${reward.name}　${'★'.repeat(reward.rarity)}` }),
        h('div', {
          class: 'event-reward-sub',
          text: cleared
            ? `再挑戦は ◈ ${Math.round(ev.coins / 4)} のみ`
            : `Lv${ev.reward.level} で加入 ＋ ◈ ${ev.coins}`,
        }),
      ),
    ),

    locked
      ? h('div', {
        class: 'event-locked',
        text: `ステージ ${ev.requires} 到達で挑戦できる（現在 ${data.stageProgress}）`,
      })
      : button(cleared ? 'もう一度挑む' : '挑む', () => {
        audio.uiConfirm();
        onChallenge(ev);
      }, { class: `btn--wide ${cleared ? '' : 'btn--primary'} event-go` }),
  );
}
