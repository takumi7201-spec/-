import { h, clear, button } from './dom';
import { attachSwipe, type SwipeDir } from './swipe';
import { audio } from '../core/Audio';

export type LayoutKind = 'tower' | 'square' | 'wide';

export interface ScreenContext {
  ui: UIRoot;
}

/** chrome.ts の tabBar() が返すもの。UIレイヤはこの形だけ知っていればいい */
export interface TabBarHandle {
  el: HTMLElement;
  select(key: string): void;
  badge(key: string, n: number): void;
}

export abstract class Screen {
  readonly el: HTMLElement;
  protected ui!: UIRoot;
  /**
   * 下タブのどの枠に属するか。
   *
   * 下タブは画面ごとに置かず、UIレイヤに1つだけ置いて出し入れする。
   * 各画面はどの枠の下に居るかだけを宣言する——たとえば図鑑も編成も
   * 一覧も「ユニット」の下なので、そこへ潜っても札は点いたままになる。
   *
   * 未設定の画面ではタブそのものを出さない。潜行中・精錬中・戦闘中と、
   * 選び終えるまで先へ進めない面（削り上げの選択・リザルト）がそれ——
   * ここで別の面へ飛べると、進行中の周回が宙に浮く。
   */
  constructor(readonly name: string, readonly tab?: string) {
    this.el = h('div', { class: `screen screen--${name}`, 'data-screen': name });
  }
  attach(ui: UIRoot): void { this.ui = ui; }
  /**
   * 横に払われた。面の中にタブがあるなら送って true を返す。
   * false（未実装を含む）なら、UI 層が下タブを隣へ送る
   */
  swipeTab?(dir: SwipeDir): boolean;
  /**
   * 払いで動かす面。タブのある画面は中身（一覧）だけを返す——
   * 見出しとタブまで動くと、同じ板が丸ごと滑って行き先が読めない
   */
  swipeSurface?(): HTMLElement | null;
  /**
   * 払いで入ってきた。入ってきた側に近いタブを選ぶ。
   *
   * 左へ払って入ったなら先頭、右へ払って入ったなら最後——「右へ払い続けたら
   * タブを逆から拾っていく」が、1本の列を戻っている感じになる
   */
  swipeEdge?(dir: SwipeDir): void;
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
  private tabs: TabBarHandle | null = null;
  /** 画面が切り替わったあとに呼ぶ。報せの数を貼り直すのに使う */
  onShow?: (name: string) => void;
  /**
   * 面の中で消化されなかった払い。下タブを隣へ送るのに使う。
   * tab は払われた面がどの枠に属していたか
   */
  onSwipeNav?: (dir: SwipeDir, tab: string, screen: string) => void;
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
    /*
     * 横の払いは層で1つだけ受ける。面ごとに付けると、面を増やすたびに
     * 付け忘れが出るし、同じ指を2か所で見ることになる。
     *
     * 受けるのは文書そのもの。UI の板より下（3D の面）を触って払うことも
     * あるので、UI 層に付けると「拠点で地面を払っても何も起きない」になる
     */
    attachSwipe(root.ownerDocument?.documentElement ?? root, {
      onMove: (dx) => this.swipeMove(dx),
      onEnd: (dir) => (dir === 0 ? this.swipeCancel() : this.swipe(dir)),
    });
    addEventListener('resize', () => this.updateLayout());
    addEventListener('orientationchange', () => setTimeout(() => this.updateLayout(), 120));
  }

  /*
   * 払いの手触り。
   *
   * 指に付いてくる → 離した先で入れ替わる、を1つながりにする。指が
   * 動いているあいだは中身を一緒に動かし（抵抗を入れて引っ張る感じにする）、
   * 送ると決まったら、新しい中身を指の進んだ向きの反対側から滑り込ませる。
   *
   * 動かすのは「中身だけ」。タブのある面では一覧だけが動き、見出しと
   * タブは止まったままになる——板ごと動くと、どこへ行くのか分からない。
   */
  private dragEl: HTMLElement | null = null;
  private reduced = matchMedia('(prefers-reduced-motion: reduce)');

  /**
   * 指と一緒に動かす中身。
   *
   * 既定は「動かさない」。面ごと動かすと、どいた先に3Dの黒い背景が覗く——
   * 地の色は面の中（::before）に塗ってあるので、面が動けば地も一緒に動く。
   * 動かしてよい中身（一覧や札の並び）を、画面側から申告してもらう。
   */
  private surfaceOf(s: Screen): HTMLElement | null {
    return s.swipeSurface?.() ?? null;
  }

  private swipeMove(dx: number): void {
    const s = this.current;
    if (!s || this.reduced.matches) return;
    if (!this.dragEl) this.dragEl = this.surfaceOf(s);
    if (!this.dragEl) return;
    // 抵抗。指の 45% しか動かさず、72px で頭打ちにする——
    // 1:1 で付いてくると、送らずに戻したときの跳ね返りが大きすぎる
    const r = Math.sign(dx) * Math.min(Math.abs(dx) * 0.45, 72);
    this.dragEl.style.transition = 'none';
    this.dragEl.style.transform = `translate3d(${r.toFixed(1)}px,0,0)`;
    this.dragEl.style.opacity = String(1 - Math.min(0.3, Math.abs(r) / 260));
  }

  /** 送らずに離した。元の位置へ戻す */
  private swipeCancel(): void {
    const el = this.dragEl;
    this.dragEl = null;
    if (!el) return;
    el.style.transition = 'transform 200ms cubic-bezier(.2,.8,.3,1), opacity 200ms linear';
    el.style.transform = '';
    el.style.opacity = '';
  }

  /** 新しい中身を、指の進んだ向きの反対側から滑り込ませる */
  private slideIn(el: HTMLElement | null, dir: SwipeDir): void {
    if (!el) return;
    if (this.reduced.matches) { el.style.transform = ''; el.style.opacity = ''; return; }
    el.style.transition = 'none';
    el.style.transform = `translate3d(${dir * 34}px,0,0)`;
    el.style.opacity = '0.35';
    /*
     * 置いた位置を「計算させて」から戻す。
     *
     * 同じフレームのうちに置いて戻すと、ブラウザは最後の値しか計算しないので、
     * 補間は指が離した位置から始まってしまう（新しい中身が反対側から入って
     * こない）。読み取りを1回挟んで、置いた位置を確定させる——結果を変数へ
     * 受けるのは、式だけだと捨てられても気付けないため。
     */
    const forced = el.getBoundingClientRect().width;
    if (forced >= 0) {
      el.style.transition = 'transform 230ms cubic-bezier(.2,.75,.25,1), opacity 180ms linear';
      el.style.transform = '';
      el.style.opacity = '';
    }
  }

  /** 払いの行き先。面の中のタブが先、消化されなければ下タブ */
  private swipe(dir: SwipeDir): void {
    const s = this.current;
    const held = this.dragEl;
    this.dragEl = null;
    if (!s) return;
    if (s.swipeTab?.(dir)) {
      // 中身は入れ替わった。同じ器を反対側から入れ直す
      this.slideIn(held ?? this.surfaceOf(s), dir);
      return;
    }
    if (s.tab) {
      this.pendingSlide = dir;
      this.onSwipeNav?.(dir, s.tab, s.name);
      // 面が変わらなかった（端だった）なら、引っ張ったぶんを戻す
      if (this.pendingSlide !== null) {
        this.pendingSlide = null;
        this.dragEl = held;
        this.swipeCancel();
      }
      return;
    }
    this.dragEl = held;
    this.swipeCancel();
  }

  /** 払いで面が変わるときだけ立つ。show() が滑り込みに使う */
  private pendingSlide: SwipeDir | null = null;

  register(screen: Screen): void {
    screen.attach(this);
    this.screens.set(screen.name, screen);
    this.el.insertBefore(screen.el, this.toastArea);
  }

  /**
   * 下タブを預かる。
   *
   * 画面の一部ではなく、画面の上に常駐する層として持つ。各画面が自前で
   * 持つと、同じ札が15枚できて選択状態も報せもそれぞれ別に腐る。
   */
  mountTabs(tabs: TabBarHandle): void {
    this.tabs = tabs;
    this.el.insertBefore(tabs.el, this.toastArea);
    this.syncTabs();
  }

  tabBadge(key: string, n: number): void { this.tabs?.badge(key, n); }

  private syncTabs(): void {
    if (!this.tabs) return;
    const key = this.current?.tab;
    this.tabs.el.hidden = !key;
    // 画面側の余白はこの印で決める。札のぶんだけ底を持ち上げる
    document.body.dataset.tabbar = key ? 'on' : 'off';
    if (key) this.tabs.select(key);
  }

  get(name: string): Screen | undefined { return this.screens.get(name); }
  get currentName(): string | null { return this.current?.name ?? null; }

  show(name: string, params?: unknown): void {
    const next = this.screens.get(name);
    if (!next) throw new Error(`unknown screen: ${name}`);
    if (this.current === next) { next.enter(params); return; }

    if (this.current) {
      // 引っ張ったまま面が変わることがある。ずらした中身をそのまま仕舞うと、
      // 次に開いたときに横へずれた状態で出てくる
      const prev = this.surfaceOf(this.current);
      if (prev) {
        prev.style.transition = '';
        prev.style.transform = '';
        prev.style.opacity = '';
      }
      this.dragEl = null;
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
    // 札の出し入れは中身を組む前に済ませる。画面側が自分の高さを
    // 測るとき、底がまだ動いていないと1フレーム分ずれる
    this.syncTabs();
    next.enter(params);
    this.onShow?.(name);
    if (this.pendingSlide !== null) {
      const dir = this.pendingSlide;
      this.pendingSlide = null;
      next.swipeEdge?.(dir);
      this.slideIn(this.surfaceOf(next), dir);
    }
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
