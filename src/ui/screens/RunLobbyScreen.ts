import { Screen } from '../UIRoot';
import { h, button, clear } from '../dom';
import type { SaveData } from '../../core/Save';
import { RUN_WINS, RUN_LIVES } from '../../game/run/run';
import { teamHp } from '../../game/run/battle';
import { revosIcon } from '../revosIcon';
import { screenHead, spaced } from '../chrome';
import { audio } from '../../core/Audio';

/**
 * ランの入口。
 *
 * 下タブの「ラン」はここに来る。遊ぶ（店と戦闘）のは別の専用ページで、
 * 下タブも横の払いも無い——盤面の札を指で運んでいる最中に、別の面へ
 * 飛ばされないようにするため。ここでは進み具合を見て、始めるか続けるかを選ぶ。
 */
export class RunLobbyScreen extends Screen {
  private data!: SaveData;
  private bodyEl!: HTMLElement;

  onPlay?: () => void;
  onAbandon?: () => void;

  constructor() { super('runLobby', 'battle'); }

  setData(d: SaveData): void { this.data = d; this.render(); }

  build(): void {
    const head = screenHead({ eyebrow: 'ラン', title: 'ラン' });
    this.bodyEl = h('div', { class: 'lobby-body' });
    this.el.append(head, this.bodyEl);
  }

  enter(): void { this.render(); }

  private render(): void {
    if (!this.data || !this.bodyEl) return;
    clear(this.bodyEl);
    const run = this.data.run;
    const rec = this.data.runRecord ?? { best: 0, clears: 0, runs: 0 };

    const pips = (n: number, max: number, cls: string): HTMLElement => {
      const el = h('span', { class: `run-pips ${cls}` });
      for (let i = 0; i < max; i++) el.appendChild(h('i', { class: i < n ? 'on' : '' }));
      return el;
    };

    if (run) {
      const faces = h('div', { class: 'lobby-faces' });
      for (const u of run.board) if (u) faces.appendChild(revosIcon(u.defId, 'lobby-face'));
      this.bodyEl.append(
        h('div', { class: 'lobby-card' },
          h('div', { class: 'lobby-eyebrow', text: spaced('進行中のラン') }),
          h('div', { class: 'lobby-round' }, h('b', { class: 'num', text: String(run.round) }), ' 周目'),
          h('div', { class: 'lobby-stats' },
            h('span', {}, '勝利 ', pips(run.wins, RUN_WINS, 'run-pips--win'), h('b', { class: 'num', text: ` ${run.wins}/${RUN_WINS}` })),
            h('span', {}, 'ライフ ', pips(run.lives, RUN_LIVES, 'run-pips--life')),
            h('span', {}, '次の体力 ', h('b', { class: 'num', text: String(teamHp(run.round)) })),
          ),
          faces.childElementCount ? faces : h('div', { class: 'lobby-note', text: '盤面はまだ空。' }),
          button(spaced('続きから'), () => { audio.uiConfirm(); this.onPlay?.(); }, { class: 'btn--primary btn--wide lobby-go' }),
          button('このランをやめる', () => this.abandon(), { class: 'btn--sm btn--ghost lobby-quit' }),
        ),
      );
    } else {
      this.bodyEl.append(
        h('div', { class: 'lobby-card' },
          h('div', { class: 'lobby-eyebrow', text: spaced('新しいラン') }),
          h('div', { class: 'lobby-lead', text: '店でユニットを買い、盤面に並べて戦う。' }),
          h('ul', { class: 'lobby-rules' },
            h('li', { text: `${RUN_WINS}勝で達成。負けるとライフが減り、${RUN_LIVES}つ失うと終わり。` }),
            h('li', { text: '同じユニットを3体重ねると★2、9体で★3。' }),
            h('li', { text: '「永続」と書かれた育ちは、ランが終わるまで残る。' }),
            h('li', { text: '盤面は横2×縦3。上の段が前列。札はドラッグで動かせる。' }),
          ),
          button(spaced('ランを始める'), () => { audio.uiConfirm(); this.onPlay?.(); }, { class: 'btn--primary btn--wide lobby-go' }),
        ),
      );
    }
    this.bodyEl.append(
      h('div', { class: 'lobby-card lobby-card--rec' },
        h('div', { class: 'lobby-eyebrow', text: spaced('記録') }),
        h('div', { class: 'lobby-recs' },
          h('span', {}, '最高 ', h('b', { class: 'num', text: `${rec.best}勝` })),
          h('span', {}, '達成 ', h('b', { class: 'num', text: `${rec.clears}回` })),
          h('span', {}, '挑戦 ', h('b', { class: 'num', text: `${rec.runs}回` })),
        ),
      ),
    );
  }

  private async abandon(): Promise<void> {
    const ok = await this.ui.confirm('ランをやめる', 'このランの盤面と育ちは消える。ここまでの勝ち数ぶんのコインは受け取れる。', 'やめる', true);
    if (!ok) return;
    this.onAbandon?.();
  }
}
