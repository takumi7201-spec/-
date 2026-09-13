import { Screen } from '../UIRoot';
import { h, button } from '../dom';
import { audio } from '../../core/Audio';

export class TitleScreen extends Screen {
  onStart?: (fresh: boolean) => void;
  onSettings?: () => void;
  onBattle?: () => void;
  private hasSave = false;

  constructor() { super('title'); }

  setHasSave(v: boolean): void {
    this.hasSave = v;
    if (this.continueBtn) this.continueBtn.hidden = !v;
    if (this.newBtn) this.newBtn.className = `btn interactive ${v ? 'btn--ghost' : 'btn--primary'}`;
  }

  private continueBtn?: HTMLButtonElement;
  private newBtn?: HTMLButtonElement;

  build(): void {
    this.continueBtn = button('つづきから', () => { audio.uiConfirm(); this.onStart?.(false); }, { class: 'btn--primary' });
    this.newBtn = button('はじめから', () => { audio.uiConfirm(); this.onStart?.(true); }, { class: this.hasSave ? 'btn--ghost' : 'btn--primary' });
    this.continueBtn.hidden = !this.hasSave;

    this.el.append(
      h('div', { class: 'title-logo' },
        h('div', { class: 'main', text: 'STRATA' }),
        h('div', { class: 'sub', text: 'CORE' }),
        h('div', { class: 'jp', text: 'ストラタコア' }),
      ),
      h('div', { class: 'title-actions' },
        this.continueBtn,
        this.newBtn,
        button('バトルを試す', () => { audio.uiTap(); this.onBattle?.(); }, { class: 'btn--ghost' }),
        h('div', { class: 'row' },
          button('操作を左右反転', () => { audio.uiTap(); this.onSettings?.(); }, { class: 'btn--sm btn--ghost' }),
          button('図鑑', () => { audio.uiTap(); this.ui.toast('図鑑は準備中'); }, { class: 'btn--sm btn--ghost' }),
        ),
        h('div', { class: 'title-ver', text: 'v0.1.0 — 発掘オートバトル' }),
      ),
    );
  }
}
