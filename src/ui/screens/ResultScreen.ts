import { Screen } from '../UIRoot';
import { h, button, clear } from '../dom';
import { audio } from '../../core/Audio';
import { revosIcon } from '../revosIcon';
import { spaced } from '../chrome';

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
  /** 勝敗の上に置く小札。省略すると出さない */
  eyebrow?: string;
  /** 出撃した面々。居れば題の下に並べる */
  cast?: string[];
}

/**
 * リザルト。
 *
 * 報酬は順番に出すことに価値があるが、2周目以降は同じ演出を見せられる
 * 苦痛のほうが大きい。画面のどこをタップしても即座に全ステップを完了させ、
 * ボタンは演出完了まで無効化しない（「押せるのに反応しない」を作らない）。
 */
export class ResultScreen extends Screen {
  private eyebrowEl!: HTMLElement;
  private titleEl!: HTMLElement;
  private dashEl!: HTMLElement;
  private subEl!: HTMLElement;
  private castEl!: HTMLElement;
  private rowsEl!: HTMLElement;
  private timers: number[] = [];

  onNext?: () => void;
  onAgain?: () => void;

  constructor() { super('result'); }

  build(): void {
    this.eyebrowEl = h('div', { class: 'result-eyebrow' });
    this.titleEl = h('div', { class: 'result-title' });
    // 短い線3本。勝敗の下の区切りで、意味は持たせない
    this.dashEl = h('div', { class: 'result-dash' }, h('i', { class: 'is-on' }), h('i'), h('i'));
    this.subEl = h('div', { class: 'result-sub' });
    this.castEl = h('div', { class: 'result-cast' });
    this.rowsEl = h('div', { class: 'result-rows' });

    const card = h('div', { class: 'result-card' },
      this.eyebrowEl, this.titleEl, this.dashEl, this.subEl, this.castEl, this.rowsEl,
    );
    const deck = h('div', { class: 'deck deck--result' },
      button('もう一度', () => { audio.uiTap(); this.onAgain?.(); }, { class: 'btn--ghost result-again' }),
      button('拠点へ', () => { audio.uiConfirm(); this.onNext?.(); }, { class: 'btn--primary result-next' }),
    );

    // 画面のどこでも触れたら演出を飛ばす
    const skip = h('div', { class: 'result-skip interactive', 'data-ui-block': '' });
    skip.addEventListener('pointerdown', () => this.revealAll());

    this.el.append(h('div', { class: 'result-rays' }), skip, h('div', { class: 'result-wrap' }, card), deck);
  }

  enter(params?: unknown): void {
    const d = params as ResultData | undefined;
    if (!d) return;
    this.clearTimers();
    this.eyebrowEl.textContent = spaced(d.eyebrow ?? '');
    this.eyebrowEl.hidden = !d.eyebrow;
    this.titleEl.textContent = d.title;
    this.titleEl.classList.toggle('is-bad', !d.good);
    this.el.classList.toggle('is-bad', !d.good);
    this.subEl.textContent = d.subtitle ?? '';
    // 出撃した面々。数字の列より先に、誰が戦ったかを見せる
    clear(this.castEl);
    const cast = d.cast ?? [];
    cast.slice(0, 3).forEach((id, i) => {
      this.castEl.appendChild(h('div', { class: `result-cast-slot ${i === 1 ? 'is-lead' : ''}` },
        revosIcon(id, 'result-cast-img'),
      ));
    });
    this.castEl.hidden = cast.length === 0;
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
