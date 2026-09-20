import { Screen } from '../UIRoot';
import { h, button, clear } from '../dom';
import type { SaveData } from '../../core/Save';
import { EVENTS, type EventDef } from '../../game/data/events';
import { stagePreview } from '../../game/party';
import { FORMATIONS } from '../../game/battle/types';
import { ELEMENT_NAMES, BIOMES } from '../../voxel/palette';
import { screenHead, plate, spaced } from '../chrome';
import { eventCard } from '../eventCard';
import { audio } from '../../core/Audio';

export type BattleMode = 'normal' | 'event';

/** 通常戦の報酬。初踏破と再挑戦で分ける——同じ額だと最弱の段を回すのが最適解になる */
export function stageCoins(stage: number, replay: boolean): number {
  const base = 120 + stage * 40;
  return replay ? Math.round(base * 0.35) : base;
}

/**
 * 出撃の選択。
 *
 * 「バトル」を押した直後に、通常戦とイベント戦のどちらへ行くかを決める。
 * 以前は通常戦へ直行していたので、到達済みの段へ戻る手段が無く、
 * イベントは拠点の別の導線からしか入れなかった——戦う場所が2か所に
 * 割れていた。同じ選択として並べる。
 *
 * 通常戦は到達済みの段と、その1つ先（未踏の段）までを出す。
 * ステージが決めるのは敵のレベルではなく「誰と当たるか」なので、
 * 寄っている属性・レア度の上限・陣形を札の上で予告する。
 */
export class BattleSelectScreen extends Screen {
  private data!: SaveData;
  private mode: BattleMode = 'normal';

  private tabsEl!: HTMLElement;
  private bodyEl!: HTMLElement;
  private progPlate = plate('進行度', { tone: 'amber' });

  onBack?: () => void;
  onNormal?: (stage: number) => void;
  onEvent?: (ev: EventDef) => void;

  constructor() { super('battleSelect'); }

  setData(d: SaveData): void { this.data = d; this.render(); }

  build(): void {
    const head = screenHead({
      eyebrow: '出撃準備', title: 'バトル',
      onBack: () => this.onBack?.(),
      right: this.progPlate.el,
    });
    this.tabsEl = h('div', { class: 'sel-tabs' });
    this.bodyEl = h('div', { class: 'sel-body' });
    this.el.append(head, this.tabsEl, this.bodyEl);
  }

  enter(params?: unknown): void {
    const p = params as { mode?: BattleMode } | undefined;
    if (p?.mode) this.mode = p.mode;
    this.render();
  }

  private render(): void {
    if (!this.data || !this.bodyEl) return;
    const frontier = this.data.stageProgress + 1;
    this.progPlate.set(`ステージ ${this.data.stageProgress}`);

    const open = EVENTS.filter(
      (e) => this.data.stageProgress >= e.requires && !this.data.events.cleared.includes(e.id),
    ).length;

    // ---- 切り替え ----
    clear(this.tabsEl);
    const tab = (mode: BattleMode, label: string, badge: number): void => {
      const b = button(label, () => {
        if (this.mode === mode) return;
        audio.uiTap();
        this.mode = mode;
        this.render();
      }, { class: `sel-tab ${this.mode === mode ? 'is-on' : 'btn--opt'}` });
      if (badge > 0) b.appendChild(h('span', { class: 'sel-badge num', text: String(badge) }));
      this.tabsEl.appendChild(b);
    };
    tab('normal', '通常', 0);
    tab('event', 'イベント', open);

    // ---- 中身 ----
    clear(this.bodyEl);
    this.bodyEl.classList.toggle('sel-body--stages', this.mode === 'normal');
    if (this.mode === 'normal') this.renderStages(frontier);
    else for (const ev of EVENTS) this.bodyEl.appendChild(eventCard(ev, this.data, (e) => this.onEvent?.(e)));
  }

  private renderStages(frontier: number): void {
    // 未踏の段は1つだけ出す。10段先まで並べても、挑めないものが増えるだけ
    for (let stage = frontier; stage >= 1; stage--) {
      const isNext = stage === frontier;
      const pv = stagePreview(stage);

      const card = button('', () => { audio.uiConfirm(); this.onNormal?.(stage); }, {
        class: `stage-card ${isNext ? 'is-next' : ''}`,
      });
      card.append(
        h('span', { class: 'stage-no' },
          h('span', { class: 'stage-no-label', text: 'ステージ' }),
          h('span', { class: 'stage-no-num num', text: String(stage) }),
        ),
        h('span', { class: 'stage-main' },
          h('span', { class: 'stage-biome', text: BIOMES[pv.biome].name }),
          h('span', { class: 'stage-traits' },
            h('span', { class: 'stage-trait' },
              h('i', { class: `dot dot--${pv.theme}` }),
              `${ELEMENT_NAMES[pv.theme]}寄り`,
            ),
            h('span', { class: 'stage-trait', text: `★${pv.rarityCap} まで` }),
            h('span', { class: 'stage-trait', text: FORMATIONS[pv.formation].name }),
          ),
        ),
        h('span', { class: 'stage-right' },
          h('span', { class: 'stage-tag', text: isNext ? spaced('未踏') : spaced('踏破') }),
          h('span', { class: 'stage-coin num', text: `◈ ${stageCoins(stage, !isNext)}` }),
        ),
      );
      this.bodyEl.appendChild(card);
    }
  }
}
