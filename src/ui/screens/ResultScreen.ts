import { Screen } from '../UIRoot';
import { h, button, clear } from '../dom';
import { audio } from '../../core/Audio';

export interface ResultRow {
  label: string;
  value: string;
  kind?: 'exp' | 'coin' | 'new' | 'rank';
}

export interface ResultData {
  title: string;
  subtitle?: string;
  rows: ResultRow[];
  good: boolean;
}

/**
 * リザルト。
 *
 * 報酬は順番に出すことに価値があるが、2周目以降は同じ演出を見せられる
 * 苦痛のほうが大きい。画面のどこをタップしても即座に全ステップを完了させ、
 * ボタンは演出完了まで無効化しない（「押せるのに反応しない」を作らない）。
 */
export class ResultScreen extends Screen {
  private titleEl!: HTMLElement;
  private subEl!: HTMLElement;
  private rowsEl!: HTMLElement;
  private timers: number[] = [];

  onNext?: () => void;
  onAgain?: () => void;

  constructor() { super('result'); }

  build(): void {
    this.titleEl = h('div', { class: 'result-title' });
    this.subEl = h('div', { class: 'result-sub' });
    this.rowsEl = h('div', { class: 'result-rows' });

    const card = h('div', { class: 'result-card' }, this.titleEl, this.subEl, this.rowsEl);
    const deck = h('div', { class: 'deck deck--result' },
      button('もう一度', () => { audio.uiTap(); this.onAgain?.(); }, { class: 'btn--ghost' }),
      button('拠点へ', () => { audio.uiConfirm(); this.onNext?.(); }, { class: 'btn--primary' }),
    );

    // 画面のどこでも触れたら演出を飛ばす
    const skip = h('div', { class: 'result-skip interactive', 'data-ui-block': '' });
    skip.addEventListener('pointerdown', () => this.revealAll());

    this.el.append(skip, h('div', { class: 'result-wrap' }, card), deck);
  }

  enter(params?: unknown): void {
    const d = params as ResultData | undefined;
    if (!d) return;
    this.clearTimers();
    this.titleEl.textContent = d.title;
    this.titleEl.classList.toggle('is-bad', !d.good);
    this.subEl.textContent = d.subtitle ?? '';
    clear(this.rowsEl);

    d.rows.forEach((r, i) => {
      const row = h('div', { class: `result-row result-row--${r.kind ?? 'plain'}` },
        h('span', { class: 'result-label', text: r.label }),
        h('span', { class: 'result-value num', text: r.value }),
      );
      row.style.opacity = '0';
      this.rowsEl.appendChild(row);
      // stagger 80ms。報酬は順に出すことに価値がある
      const t = setTimeout(() => {
        row.style.opacity = '';
        row.classList.add('is-in');
        audio.reward(Math.min(4, i));
      }, 260 + i * 80) as unknown as number;
      this.timers.push(t);
    });

    if (d.good) audio.victory();
  }

  private revealAll(): void {
    this.clearTimers();
    for (const row of Array.from(this.rowsEl.children) as HTMLElement[]) {
      row.style.opacity = '';
      row.classList.add('is-in');
    }
  }

  private clearTimers(): void {
    for (const t of this.timers) clearTimeout(t);
    this.timers = [];
  }

  exit(): void { this.clearTimers(); }
}
