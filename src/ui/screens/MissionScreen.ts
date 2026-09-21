import { Screen } from '../UIRoot';
import { h, button, clear, bar, fmtNum } from '../dom';
import type { SaveData } from '../../core/Save';
import {
  MISSIONS, claimMission, missionRatio, missionState, readyCount,
  type MissionDef, type MissionGroup,
} from '../../game/missions';
import { screenHead, plate, spaced } from '../chrome';
import { audio } from '../../core/Audio';

/**
 * ミッションの一覧。
 *
 * 日課と記録を別のタブに割る。同じ表に混ぜると、報酬の桁が2つ違うぶん
 * 記録のほうばかりが目標に見えて、毎日拾うものが背景に沈む。
 *
 * 受け取り済みも消さずに沈める。消すと「今日はもう無い」のか
 * 「まだ残っている」のかが、空の表からは読めない。
 */
export class MissionScreen extends Screen {
  private data!: SaveData;
  private tabsEl!: HTMLElement;
  private bodyEl!: HTMLElement;
  private allBtn!: HTMLButtonElement;
  private readyPlate = plate('受取可', { tone: 'amber' });
  private group: MissionGroup = 'daily';

  onBack?: () => void;
  /** 受け取りでコインと経験値が動くので、保存はゲーム側に任せる */
  onClaim?: () => void;

  constructor() { super('mission', 'home'); }

  setData(d: SaveData): void { this.data = d; this.render(); }

  build(): void {
    const head = screenHead({
      eyebrow: '任務', title: 'ミッション',
      onBack: () => this.onBack?.(),
      right: this.readyPlate.el,
    });
    this.tabsEl = h('div', { class: 'sel-tabs' });
    this.bodyEl = h('div', { class: 'mis-body' });
    this.allBtn = button('達成ぶんをまとめて受け取る', () => this.claimAll(), { class: 'btn--primary btn--wide' });
    this.el.append(head, this.tabsEl, this.bodyEl, h('div', { class: 'deck deck--mail' }, this.allBtn));
  }

  enter(params?: unknown): void {
    const p = params as { group?: MissionGroup } | undefined;
    if (p?.group) this.group = p.group;
    this.render();
  }

  private render(): void {
    if (!this.data || !this.bodyEl) return;
    const ready = readyCount(this.data);
    this.readyPlate.set(String(ready));
    this.allBtn.disabled = ready === 0;

    // ---- 切り替え。それぞれの受け取り待ちを札の肩に出す ----
    clear(this.tabsEl);
    const tab = (group: MissionGroup, label: string): void => {
      const n = MISSIONS.filter((m) => m.group === group && missionState(this.data, m) === 'ready').length;
      const b = button(label, () => {
        if (this.group === group) return;
        audio.uiTap();
        this.group = group;
        this.render();
      }, { class: `sel-tab ${this.group === group ? 'is-on' : 'btn--opt'}` });
      if (n > 0) b.appendChild(h('span', { class: 'sel-badge num', text: String(n) }));
      this.tabsEl.appendChild(b);
    };
    tab('daily', '日課');
    tab('record', '記録');

    // ---- 一覧。受け取れるものを先頭に、達成済みは末尾へ沈める ----
    const order = { ready: 0, doing: 1, claimed: 2 } as const;
    const list = MISSIONS
      .filter((m) => m.group === this.group)
      .slice()
      .sort((a, b) => {
        const d = order[missionState(this.data, a)] - order[missionState(this.data, b)];
        if (d !== 0) return d;
        return missionRatio(this.data, b) - missionRatio(this.data, a);
      });

    clear(this.bodyEl);
    if (this.group === 'daily') {
      this.bodyEl.appendChild(h('div', { class: 'mis-note', text: '日課は 4:00 に入れ替わる。' }));
    }
    for (const m of list) this.bodyEl.appendChild(this.card(m));
  }

  private card(m: MissionDef): HTMLElement {
    const state = missionState(this.data, m);
    const now = Math.min(m.goal, m.progress(this.data));
    const card = h('div', { class: `mis-card is-${state}` });

    const fill = bar('bar--exp', missionRatio(this.data, m));
    card.append(
      h('div', { class: 'mis-head' },
        h('span', { class: `mis-tag mis-tag--${m.group}`, text: spaced(m.group === 'daily' ? '日課' : '記録') }),
        h('span', { class: 'mis-name', text: m.name }),
        h('span', { class: 'mis-coin num' },
          h('i', { class: 'wallet-dot wallet-dot--coin' }),
          fmtNum(m.coins),
        ),
      ),
      h('div', { class: 'mis-desc', text: m.desc }),
      h('div', { class: 'mis-gauge' },
        fill.el,
        // 分子と分母を別の要素に割る。地の文のままだと flex の項として
        // 前後の空白が落ちて「20/ 20回」と詰まる
        h('div', { class: 'mis-count num' },
          h('span', { class: state === 'doing' ? '' : 'is-done', text: fmtNum(now) }),
          h('span', { text: `/ ${fmtNum(m.goal)}${m.unit}` }),
        ),
      ),
    );

    if (state === 'ready') {
      card.appendChild(button('受け取る', () => this.claim(m.id), { class: 'btn--wide mis-go' }));
    } else if (state === 'claimed') {
      card.appendChild(h('div', { class: 'mis-done' },
        h('span', { class: 'mis-done-mark', text: '✓' }),
        h('span', { text: `受け取り済み · 経験値 +${m.exp}` }),
      ));
    } else {
      card.appendChild(h('div', { class: 'mis-pending', text: `達成で 経験値 +${m.exp}` }));
    }
    return card;
  }

  private claim(id: string): void {
    const m = claimMission(this.data, id);
    if (!m) { audio.uiError(); return; }
    audio.reward(1);
    this.ui.toast(`${m.name} — ◈${fmtNum(m.coins)} / 経験値 +${m.exp}`, 'info', 2600);
    this.onClaim?.();
    this.render();
  }

  private claimAll(): void {
    let coins = 0;
    let n = 0;
    // 並びは変わるので、id を先に取ってから回す
    for (const id of MISSIONS.map((m) => m.id)) {
      const m = claimMission(this.data, id);
      if (m) { coins += m.coins; n++; }
    }
    if (n === 0) { audio.uiError(); return; }
    audio.reward(2);
    this.ui.toast(`${n} 件受け取った — ◈${fmtNum(coins)}`, 'info', 2600);
    this.onClaim?.();
    this.render();
  }
}
