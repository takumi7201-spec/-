import { h, clear } from './dom';
import { Spring, SPRINGS } from './motion';

interface Box { x: number; y: number; w: number; h: number }

/**
 * 広がるカード（ポップアップ）。
 *
 * 押した（乗せた）小さな札から、画面中央のカードへばねで広がる。
 * 閉じるときは元の札へ縮んで戻る。中身は広がりきる手前から現れる
 * （縮んだ状態の文字は潰れて読めない）。
 *
 * modal のときは背景を暗くし、背景を押すと閉じる。modal でないとき
 * （マウスを乗せて見ているだけ）は、カードも背景も押せない——下の札への
 * 乗せ外しを邪魔しない。
 */
export class ExpandCard {
  readonly el: HTMLElement;
  private scrim: HTMLElement;
  private inner: HTMLElement;
  private spring: Spring;
  private from: Box = { x: 0, y: 0, w: 1, h: 1 };
  private to: Box = { x: 0, y: 0, w: 1, h: 1 };
  private shown = false;
  private modal = false;
  /** 今の中身の持ち主（同じ札への出し直しを見分ける） */
  key: string | null = null;
  /** 背景を押して閉じたとき */
  onDismiss?: () => void;

  constructor(private host: HTMLElement) {
    this.scrim = h('div', { class: 'xcard-scrim', hidden: true });
    this.scrim.addEventListener('click', () => { if (this.modal) this.onDismiss?.(); });
    this.inner = h('div', { class: 'xcard-inner' });
    this.el = h('div', { class: 'xcard', hidden: true, role: 'dialog' }, this.inner);
    host.append(this.scrim, this.el);
    this.spring = new Spring(0, (p) => this.paint(p), (p) => {
      if (p <= 0.001) {
        this.el.hidden = true;
        this.scrim.hidden = true;
        this.key = null;
      }
    });
  }

  get isOpen(): boolean { return this.shown; }
  get isModal(): boolean { return this.shown && this.modal; }

  private boxOf(el: Element): Box {
    const r = el.getBoundingClientRect();
    const hr = this.host.getBoundingClientRect();
    return { x: r.left - hr.left, y: r.top - hr.top, w: r.width, h: r.height };
  }

  /** from の札から、画面中央へ広げる */
  show(key: string, from: HTMLElement, content: Node, modal: boolean): void {
    const same = this.shown && this.key === key && this.modal === modal;
    this.key = key;
    this.modal = modal;
    clear(this.inner);
    this.inner.appendChild(content);
    this.el.classList.toggle('is-static', !modal);
    this.scrim.classList.toggle('is-static', !modal);
    this.el.hidden = false;
    this.scrim.hidden = false;
    this.el.classList.remove('is-closing');
    this.scrim.classList.remove('is-closing');

    // 行き先: 横は中央・幅は画面に合わせて上限つき。縦は中身の高さで中央へ
    const hw = this.host.clientWidth, hh = this.host.clientHeight;
    const w = Math.min(380, hw - 32);
    this.el.style.width = `${w}px`;
    this.el.style.maxHeight = `${Math.round(hh * 0.8)}px`;
    this.el.style.transform = 'none';
    const height = Math.min(this.el.offsetHeight, Math.round(hh * 0.8));
    const x = Math.round((hw - w) / 2);
    const y = Math.max(16, Math.round((hh - height) / 2));
    this.el.style.left = `${x}px`;
    this.el.style.top = `${y}px`;
    this.to = { x, y, w, h: height };
    this.from = this.boxOf(from);
    this.shown = true;
    if (same) { this.paint(this.spring.value); return; }
    // 別の札へ乗り換えたときは、新しい札の大きさの近くから広げ直す
    if (this.spring.value > 0.5) this.spring.value = 0.35;
    this.spring.to(1, SPRINGS.open);
  }

  /** 元の札（あれば）へ縮めて閉じる */
  hide(back?: HTMLElement | null): void {
    if (!this.shown) return;
    this.shown = false;
    // 縮んでいる間は押させない。消えかけの背景が次のタップを吸うと、押した札が反応しない
    this.el.classList.add('is-closing');
    this.scrim.classList.add('is-closing');
    if (back && back.isConnected) this.from = this.boxOf(back);
    this.spring.to(0, SPRINGS.close);
  }

  private paint(p: number): void {
    const { from: f, to: t } = this;
    const q = 1 - p;
    const dx = (f.x - t.x) * q, dy = (f.y - t.y) * q;
    const sx = Math.max(0.05, (f.w / t.w) * q + p);
    const sy = Math.max(0.05, (f.h / t.h) * q + p);
    this.el.style.transform = `translate(${dx}px, ${dy}px) scale(${sx}, ${sy})`;
    this.el.style.opacity = String(Math.min(1, Math.max(0, p * 3)));
    this.inner.style.opacity = String(Math.min(1, Math.max(0, (p - 0.55) / 0.4)));
    this.scrim.style.opacity = String(Math.min(1, Math.max(0, p)));
  }
}
