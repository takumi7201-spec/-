/**
 * ばね。
 *
 * 時間で決まる曲線（ease）ではなく、硬さと減衰で決まる動き。途中で行き先が
 * 変わっても速度を引き継いで滑らかに折り返す——乗せて離してまた乗せる、
 * のような細かい出入りでも動きが途切れない。
 *
 * 値はここ1か所。デザイン元の tokens.css が読めたら、その stiffness / damping に
 * 差し替える（いまの値は仮置き）。
 */
export const SPRINGS = {
  /** 開くとき。少し弾んで止まる */
  open: { stiffness: 380, damping: 30, mass: 1 },
  /** 閉じるとき。弾ませずに戻す */
  close: { stiffness: 420, damping: 40, mass: 1 },
} as const;

export interface SpringConfig { stiffness: number; damping: number; mass: number }

/**
 * 0〜1 などの1本の値をばねで動かす。onUpdate に毎フレームの値を渡し、
 * 止まったら onRest を呼ぶ。to() で行き先を変えると、いまの速度のまま向きを変える。
 */
export class Spring {
  value: number;
  private velocity = 0;
  private target: number;
  private cfg: SpringConfig;
  private raf = 0;
  private last = 0;

  constructor(
    initial: number,
    private onUpdate: (v: number) => void,
    private onRest?: (v: number) => void,
  ) {
    this.value = initial;
    this.target = initial;
    this.cfg = SPRINGS.open;
  }

  to(target: number, cfg: SpringConfig = SPRINGS.open): void {
    this.target = target;
    this.cfg = cfg;
    // 動きを減らす設定の端末では、ばねを使わずに行き先へ置く
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) {
      this.value = target; this.velocity = 0;
      this.onUpdate(target); this.onRest?.(target);
      return;
    }
    if (!this.raf) {
      this.last = performance.now();
      this.raf = requestAnimationFrame(this.step);
    }
  }

  stop(): void { cancelAnimationFrame(this.raf); this.raf = 0; }

  private step = (now: number): void => {
    // タブ復帰などの大きな飛びで発散しないよう、刻みを細かく割る
    let dt = Math.min(0.064, (now - this.last) / 1000);
    this.last = now;
    const { stiffness, damping, mass } = this.cfg;
    while (dt > 0) {
      const h = Math.min(dt, 1 / 240);
      const force = -stiffness * (this.value - this.target) - damping * this.velocity;
      this.velocity += (force / mass) * h;
      this.value += this.velocity * h;
      dt -= h;
    }
    this.onUpdate(this.value);
    if (Math.abs(this.velocity) < 0.002 && Math.abs(this.value - this.target) < 0.001) {
      this.value = this.target; this.velocity = 0; this.raf = 0;
      this.onUpdate(this.value);
      this.onRest?.(this.value);
      return;
    }
    this.raf = requestAnimationFrame(this.step);
  };
}
