import { h, clear, button } from './dom';
import { audio } from '../core/Audio';

export type LayoutKind = 'tower' | 'square' | 'wide';

export interface ScreenContext {
  ui: UIRoot;
}

export abstract class Screen {
  readonly el: HTMLElement;
  protected ui!: UIRoot;
  constructor(readonly name: string) {
    this.el = h('div', { class: `screen screen--${name}`, 'data-screen': name });
  }
  attach(ui: UIRoot): void { this.ui = ui; }
  /** 初回表示前に1回だけ呼ばれる */
  build(): void {}
  enter(_params?: unknown): void { void _params; }
  exit(): void {}
  update(_dt: number): void { void _dt; }
  /** レイアウト型が変わったとき */
  onLayout(_kind: LayoutKind): void { void _kind; }
}

/**
 * UIレイヤのルート。
 *
 * 層モデル（L0ステージ / L1情報 / L2操作 / L3モーダル）を管理する。
 * L1は pointer-events:none、L2だけが触れる。この排他が最重要ルール。
 */
export class UIRoot {
  readonly el: HTMLElement;
  readonly toastArea: HTMLElement;
  readonly overlayLayer: HTMLElement;
  readonly flashEl: HTMLElement;
  layout: LayoutKind = 'tower';

  private screens = new Map<string, Screen>();
  private built = new Set<string>();
  private current: Screen | null = null;
  private toasts: HTMLElement[] = [];
  private flashTimer: number | undefined;

  constructor(root: HTMLElement) {
    this.el = root;
    this.toastArea = h('div', { class: 'toast-area' });
    this.overlayLayer = h('div', { class: 'overlay-layer' });
    this.flashEl = h('div', { id: 'flash' });
    root.appendChild(this.toastArea);
    root.appendChild(this.overlayLayer);
    root.appendChild(this.flashEl);
    root.appendChild(h('div', { id: 'vignette' }));
    root.appendChild(h('div', { id: 'grain' }));
    this.updateLayout();
    addEventListener('resize', () => this.updateLayout());
    addEventListener('orientationchange', () => setTimeout(() => this.updateLayout(), 120));
  }

  register(screen: Screen): void {
    screen.attach(this);
    this.screens.set(screen.name, screen);
    this.el.insertBefore(screen.el, this.toastArea);
  }

  get(name: string): Screen | undefined { return this.screens.get(name); }
  get currentName(): string | null { return this.current?.name ?? null; }

  show(name: string, params?: unknown): void {
    const next = this.screens.get(name);
    if (!next) throw new Error(`unknown screen: ${name}`);
    if (this.current === next) { next.enter(params); return; }

    if (this.current) {
      this.current.exit();
      this.current.el.classList.remove('is-active');
      this.current.el.style.pointerEvents = 'none';
    }
    if (!this.built.has(name)) {
      next.build();
      next.onLayout(this.layout);
      this.built.add(name);
    }
    this.current = next;
    next.el.classList.add('is-active');
    next.el.style.pointerEvents = '';
    next.enter(params);
  }

  update(dt: number): void {
    this.current?.update(dt);
  }

  /**
   * レイアウト型はアスペクト比で決める。幅だけで切ると
   * iPad縦とスマホ横が同じ扱いになって破綻する。
   */
  private updateLayout(): void {
    const a = innerWidth / Math.max(1, innerHeight);
    const kind: LayoutKind = a < 0.75 ? 'tower' : a <= 1.3 ? 'square' : 'wide';
    if (kind === this.layout && document.body.dataset.layout) return;
    this.layout = kind;
    document.body.dataset.layout = kind;
    document.body.dataset.density =
      innerWidth < 600 ? 'compact' : innerWidth < 1024 ? 'regular' : innerWidth < 1440 ? 'large' : 'xlarge';
    for (const s of this.screens.values()) s.onLayout(kind);
  }

  toast(message: string, kind: 'info' | 'warn' | 'bad' = 'info', ms = 2600): void {
    const el = h('div', { class: `toast toast--${kind}`, text: message });
    this.toastArea.appendChild(el);
    this.toasts.push(el);
    // 積みすぎると画面が読む作業になる
    while (this.toasts.length > 3) {
      const old = this.toasts.shift();
      old?.remove();
    }
    setTimeout(() => {
      el.classList.add('is-out');
      setTimeout(() => {
        el.remove();
        this.toasts = this.toasts.filter((t) => t !== el);
      }, 240);
    }, ms);
  }

  /** ポスプロ0パスのティアでも効くCSSフラッシュ */
  flash(hex: string, strength: number, ms = 260): void {
    this.flashEl.style.background = hex.startsWith('#') ? hex : `#${hex}`;
    this.flashEl.style.opacity = String(Math.min(0.85, strength));
    this.flashEl.style.transition = 'none';
    if (this.flashTimer !== undefined) clearTimeout(this.flashTimer);
    requestAnimationFrame(() => {
      this.flashEl.style.transition = `opacity ${ms}ms linear`;
      this.flashEl.style.opacity = '0';
    });
  }

  /** ボトムシート。閉じるまで待てる */
  sheet(title: string, body: HTMLElement, opts: { actions?: HTMLElement[] } = {}): { close(): void } {
    const scrim = h('div', { class: 'scrim' });
    const sheet = h('div', { class: 'sheet' },
      h('div', { class: 'grabber' }),
      h('div', { class: 'sheet-head' },
        h('h2', { class: 'sheet-title', text: title }),
        button('✕', () => close(), { class: 'btn--sm btn--ghost sheet-close' }),
      ),
      h('div', { class: 'sheet-body' }, body),
      opts.actions ? h('div', { class: 'sheet-actions' }, ...opts.actions) : null,
    );
    this.overlayLayer.appendChild(scrim);
    this.overlayLayer.appendChild(sheet);
    requestAnimationFrame(() => {
      scrim.classList.add('is-open');
      sheet.classList.add('is-open');
    });
    let closed = false;
    const close = () => {
      if (closed) return;
      closed = true;
      audio.uiBack();
      scrim.classList.remove('is-open');
      sheet.classList.remove('is-open');
      setTimeout(() => { scrim.remove(); sheet.remove(); }, 420);
    };
    scrim.addEventListener('pointerdown', close);
    return { close };
  }

  confirm(title: string, message: string, okLabel = 'OK', danger = false): Promise<boolean> {
    return new Promise((resolve) => {
      const scrim = h('div', { class: 'scrim' });
      let done = false;
      const finish = (v: boolean) => {
        if (done) return;
        done = true;
        scrim.classList.remove('is-open');
        dialog.classList.remove('is-open');
        setTimeout(() => { scrim.remove(); dialog.remove(); }, 260);
        resolve(v);
      };
      const dialog = h('div', { class: 'dialog panel' },
        h('h2', { class: 'dialog-title', text: title }),
        h('p', { class: 'dialog-msg', text: message }),
        h('div', { class: 'dialog-actions' },
          button('キャンセル', () => finish(false), { class: 'btn--ghost' }),
          button(okLabel, () => finish(true), { class: danger ? 'btn--danger' : 'btn--primary' }),
        ),
      );
      this.overlayLayer.appendChild(scrim);
      this.overlayLayer.appendChild(dialog);
      requestAnimationFrame(() => {
        scrim.classList.add('is-open');
        dialog.classList.add('is-open');
      });
      scrim.addEventListener('pointerdown', () => finish(false));
    });
  }

  /** WebGLコンテキストロストの復帰画面 */
  showContextLost(): HTMLElement {
    const el = h('div', { class: 'context-lost' },
      h('div', { class: 'panel context-lost-box' },
        h('h2', { text: '描画を復帰しています…' }),
        h('p', { class: 'dim', text: '端末のメモリが逼迫したため、一時的に描画が停止しました。進行状況は保存済みです。' }),
      ),
    );
    this.overlayLayer.appendChild(el);
    return el;
  }

  clearOverlays(): void { clear(this.overlayLayer); }
}
