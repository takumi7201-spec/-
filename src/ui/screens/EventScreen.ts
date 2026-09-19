import { Screen } from '../UIRoot';
import { h, button, clear } from '../dom';
import type { SaveData } from '../../core/Save';
import { EVENTS, type EventDef } from '../../game/data/events';
import { getRevos, revosShortName } from '../../game/data/revos';
import { ELEMENT_NAMES } from '../../voxel/palette';
import { audio } from '../../core/Audio';
import { revosIcon } from '../revosIcon';
import { screenHead } from '../chrome';

/**
 * イベント戦の一覧。
 *
 * 野帳に挟んだ「調査依頼」の束として出す。1件ぶんを1枚の紙にして、
 * 相手・条件・報酬を同じ紙の上で読み切れるようにする——別画面に
 * 分けると、挑む前に編成を決めるための情報が足りなくなる。
 */
export class EventScreen extends Screen {
  private data!: SaveData;
  private listEl!: HTMLElement;

  onBack?: () => void;
  onChallenge?: (ev: EventDef) => void;

  constructor() { super('event'); }

  setData(d: SaveData): void { this.data = d; this.render(); }

  build(): void {
    const strip = screenHead({
      eyebrow: '調査依頼', title: 'イベント',
      onBack: () => this.onBack?.(),
    });
    this.listEl = h('div', { class: 'event-body' });
    this.el.append(strip, this.listEl);
  }

  enter(): void { this.render(); }

  private render(): void {
    if (!this.data || !this.listEl) return;
    clear(this.listEl);

    for (const ev of EVENTS) {
      const cleared = this.data.events.cleared.includes(ev.id);
      const locked = this.data.stageProgress < ev.requires;
      const reward = getRevos(ev.reward.defId);

      const card = h('div', { class: `event-card ${locked ? 'is-locked' : ''} ${cleared ? 'is-cleared' : ''}` },
        h('div', { class: 'event-head' },
          h('span', { class: 'label', text: ev.subtitle }),
          cleared ? h('span', { class: 'event-stamp', text: '踏破' }) : null,
        ),
        h('div', { class: 'event-name', text: ev.name }),
        h('p', { class: 'event-desc', text: ev.desc }),

        h('div', { class: 'label event-sub', text: 'あいて' }),
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

        h('div', { class: 'label event-sub', text: 'ほうしゅう' }),
        h('div', { class: 'event-reward' },
          revosIcon(reward.id, 'event-reward-icon'),
          h('div', { class: 'event-reward-main' },
            h('div', { class: 'event-reward-name', text: `${reward.name}　${'★'.repeat(reward.rarity)}` }),
            h('div', { class: 'event-reward-sub', text: cleared ? `再挑戦は ◈ ${Math.round(ev.coins / 4)} のみ` : `Lv${ev.reward.level} で加入 ＋ ◈ ${ev.coins}` }),
          ),
        ),

        locked
          ? h('div', { class: 'event-locked', text: `ステージ ${ev.requires} 到達で挑戦できる（現在 ${this.data.stageProgress}）` })
          : button(cleared ? 'もう一度挑む' : '挑む', () => {
            audio.uiConfirm();
            this.onChallenge?.(ev);
          }, { class: `btn--wide ${cleared ? '' : 'btn--primary'} event-go` }),
      );
      this.listEl.appendChild(card);
    }
  }
}
