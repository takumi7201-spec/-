import { setSwiping } from './dom';

/**
 * 横スワイプ。
 *
 * 片手で持って親指だけで触る前提の画面なので、上の札を1つずつ狙って押すより
 * 「払う」ほうが速い。縦の送りは一覧が持っているので、こちらは横だけ見る。
 *
 * 見分けは2段。まず横に 24px 滑った時点で「横の払い」と決め（この時点で
 * ボタンのタップを飲み込む）、指を離したときに 56px 以上動いていれば送る。
 * 先に決めてしまわないと、札の上で払ったときにタップとして拾われる——
 * ボタンは「指が自分の中で離れたか」だけを見ているので、幅の広い札では
 * 払い切っても中に収まってしまう。
 */

/** 横と認めるまでの滑り。これを超えた時点でタップは飲み込む */
const LOCK = 24;
/** 送りと認める距離 */
const GO = 56;
/** 縦に対して横がこれだけ勝っていること */
const RATIO = 1.4;
/**
 * これより長く触っていたら、払いではなく「掴んで動かした」。
 * ゆっくり送る指もあるので、短く取りすぎると払ったのに何も起きない
 */
const MAX_MS = 1400;

export type SwipeDir = -1 | 1;

export interface SwipeHandlers {
  /** 指が横に動いているあいだ。dx は押し始めからの横の移動量 */
  onMove?(dx: number): void;
  /** 指を離した。送るなら向き、戻すなら 0 */
  onEnd(dir: SwipeDir | 0): void;
}

/** 横に払ったら呼ぶ。-1 が右へ払う（前の面）、+1 が左へ払う（次の面） */
export function attachSwipe(el: HTMLElement, handlers: SwipeHandlers): void {
  let id: number | null = null;
  let x0 = 0, y0 = 0, t0 = 0;
  /** 最後に見えた位置。pointercancel は座標を持たないことがあるので控える */
  let lx = 0, ly = 0;
  let locked = false;

  el.addEventListener('pointerdown', (e) => {
    const pe = e as PointerEvent;
    // 2本目の指は見ない。拡大・回転の途中で面が飛ぶのを防ぐ
    if (id !== null) return;
    id = pe.pointerId;
    x0 = pe.clientX; y0 = pe.clientY; t0 = performance.now();
    lx = x0; ly = y0;
    locked = false;
  }, { passive: true });

  el.addEventListener('pointermove', (e) => {
    const pe = e as PointerEvent;
    if (id !== pe.pointerId) return;
    lx = pe.clientX; ly = pe.clientY;
    const dx = lx - x0;
    const dy = ly - y0;
    if (!locked && Math.abs(dx) >= LOCK && Math.abs(dx) > Math.abs(dy) * RATIO) {
      locked = true;
      setSwiping(true);
    }
    // 指に付いてくる。決まってから動かすのではなく、動かしながら決める
    if (locked) handlers.onMove?.(dx);
  }, { passive: true });

  /*
   * 指を離した（あるいは離す前に取り上げられた）。
   *
   * pointercancel も終わりとして扱う。絵を含む札の上で払うと、ブラウザが
   * 画像のドラッグを始めて pointerup が来ないまま cancel で終わる——
   * 払い切っているのに何も起きない、という抜けがここで生まれていた。
   * 最後に見えた位置で判定するので、どちらで終わっても結果は同じ。
   */
  const end = (e: Event): void => {
    const pe = e as PointerEvent;
    if (id !== pe.pointerId) return;
    id = null;
    if (!locked) return;
    // cancel は座標を持たないことがある。その場合は最後の move の位置を使う
    const ex = e.type === 'pointercancel' ? lx : pe.clientX;
    const ey = e.type === 'pointercancel' ? ly : pe.clientY;
    const dx = ex - x0;
    const dy = ey - y0;
    const ok = Math.abs(dx) >= GO
      && Math.abs(dx) > Math.abs(dy) * RATIO
      && performance.now() - t0 <= MAX_MS;
    // タップの判定が済んでから下ろす。同じ指の pointerup より後に回す
    setTimeout(() => setSwiping(false), 0);
    handlers.onEnd(ok ? (dx < 0 ? 1 : -1) : 0);
  };
  el.addEventListener('pointerup', end, { passive: true });
  el.addEventListener('pointercancel', end, { passive: true });
}
