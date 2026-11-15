import { h, clear } from './dom';
import { Spring, SPRINGS } from './motion';

interface Box { x: number; y: number; w: number; h: number }

/**
 * 広がるカード。
 *
 * 押した（乗せた）小さな札から、決まった置き場所（placeholder）の大きさへ
 * ばねで広がる。閉じるときは元の札へ縮んで戻る。
 *
 * 札の上に被せず、置き場所へ向かって広がる——盤面と店の札は押せたまま残る。
 * 中身は広がりきる手前から現れる（縮んだ状態の文字は潰れて読めない）。
 */
export class ExpandCard {
  readonly el: HTMLElement;
  private inner: HTMLElement;
  private spring: Spring;
  private from: Box = { x: 0, y: 0, w: 1, h: 1 };
  private to: Box = { x: 0, y: 0, w: 1, h: 1 };
  private placeholder: HTMLElement | null = null;
  private shown = false;
  /** 今の中身の持ち主（同じ札への出し直しを見分ける） */
  key: string | null = null;

  constructor(private host: HTMLElement) {
    this.inner = h('div', { class: 'xcard-inner' });
    this.el = h('div', { class: 'xcard', hidden: true }, this.inner);
    host.appendChild(this.el);
    this.spring = new Spring(0, (p) => this.paint(p), (p) => {
      if (p <= 0.001) {
        this.el.hidden = true;
        if (this.placeholder) this.placeholder.style.minHeight = '';
        this.key = null;
      }
    });
  }

  get isOpen(): boolean { return this.shown; }

  /** host の中での位置。host は自前でスクロールするので、その分を足す */
  private boxOf(el: Element): Box {
    const r = el.getBoundingClientRect();
    const hr = this.host.getBoundingClientRect();
    return { x: r.left - hr.left + this.host.scrollLeft, y: r.top - hr.top + this.host.scrollTop, w: r.width, h: r.height };
  }

  /**
   * from の札から placeholder の場所へ広げる。
   * interactive が false なら中身を押せない（乗せて見るだけのとき）
   */
  show(key: string, from: HTMLElement, content: Node, placeholder: HTMLElement, interactive: boolean): void {
    const same = this.shown && this.key === key;
    this.key = key;
    clear(this.inner);
    this.inner.appendChild(content);
    this.el.classList.toggle('is-static', !interactive);
    this.el.hidden = false;
    this.placeholder = placeholder;

    // 行き先: 置き場所の左上と幅。高さは中身で決まるので、測ってから置き場所を空ける
    const ph = this.boxOf(placeholder);
    this.el.style.left = `${ph.x}px`;
    this.el.style.top = `${ph.y}px`;
    this.el.style.width = `${ph.w}px`;
    const height = this.inner.offsetHeight;
    placeholder.style.minHeight = `${height}px`;
    this.to = { x: ph.x, y: ph.y, w: ph.w, h: height };
    this.from = this.boxOf(from);
    this.shown = true;
    if (same) { this.paint(this.spring.value); return; }
    // 別の札へ乗り換えたときは、いったん新しい札の大きさから広げ直す
    if (this.spring.value > 0.5) this.spring.value = 0.35;
    this.spring.to(1, SPRINGS.open);
  }

  /** 元の札（あれば）へ縮めて閉じる */
  hide(back?: HTMLElement | null): void {
    if (!this.shown) return;
    this.shown = false;
    if (back && back.isConnected) this.from = this.boxOf(back);
    this.spring.to(0, SPRINGS.close);
  }

  private paint(p: number): void {
    const { from: f, to: t } = this;
    const q = 1 - p;
    // 位置と大きさを札→置き場所へ。拡縮は左上を基点にする
    const dx = (f.x - t.x) * q, dy = (f.y - t.y) * q;
    const sx = Math.max(0.05, (f.w / t.w) * q + p);
    const sy = Math.max(0.05, (f.h / t.h) * q + p);
    this.el.style.transform = `translate(${dx}px, ${dy}px) scale(${sx}, ${sy})`;
    this.el.style.opacity = String(Math.min(1, Math.max(0, p * 3)));
    // 中身は大きさがほぼ揃ってから。ばねの行き過ぎ（p>1）でも 1 で止める
    this.inner.style.opacity = String(Math.min(1, Math.max(0, (p - 0.55) / 0.4)));
  }
}
