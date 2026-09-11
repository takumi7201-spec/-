/**
 * PC（キーボード＋マウス）とスマホ（マルチタッチ）を単一の
 * 「move / look / action」抽象に落とすレイヤー。
 *
 * タッチは固定位置のスティックではなく「触った場所に出る動的スティック」。
 * 固定スティックは画面サイズと手の大きさに依存して必ず誰かが押しづらくなる。
 */

export interface Vec2 {
  x: number;
  y: number;
}

export type ActionName = 'radar' | 'interact' | 'dash' | 'menu' | 'confirm' | 'cancel';

const KEY_MAP: Record<string, ActionName> = {
  Space: 'radar',
  KeyE: 'interact',
  KeyF: 'interact',
  ShiftLeft: 'dash',
  ShiftRight: 'dash',
  Escape: 'menu',
  Enter: 'confirm',
  Backspace: 'cancel',
};

interface TouchState {
  id: number;
  originX: number;
  originY: number;
  x: number;
  y: number;
  startedAt: number;
  moved: boolean;
  role: 'move' | 'look';
}

export class InputManager {
  readonly move: Vec2 = { x: 0, y: 0 };
  readonly look: Vec2 = { x: 0, y: 0 };
  /** タップ/クリックされたスクリーン座標（NDC）。未発生時は null */
  tapNdc: Vec2 | null = null;
  pointerNdc: Vec2 = { x: 0, y: 0 };

  private keys = new Set<string>();
  private actionsDown = new Set<ActionName>();
  private actionsPressed = new Set<ActionName>();
  private actionsReleased = new Set<ActionName>();
  private touches = new Map<number, TouchState>();
  private mouseLooking = false;
  private el: HTMLElement;
  private stickRadius = 64;
  private lookSensitivity = 1;
  private enabled = true;

  /** 仮想スティックの可視化をUI層に伝えるためのフック */
  onStickChange?: (active: boolean, originX: number, originY: number, dx: number, dy: number) => void;

  constructor(el: HTMLElement) {
    this.el = el;
    this.stickRadius = Math.min(84, Math.max(48, Math.min(innerWidth, innerHeight) * 0.13));
    this.bind();
  }

  setEnabled(v: boolean): void {
    this.enabled = v;
    if (!v) this.reset();
  }

  setLookSensitivity(v: number): void {
    this.lookSensitivity = v;
  }

  private bind(): void {
    addEventListener('keydown', this.onKeyDown);
    addEventListener('keyup', this.onKeyUp);
    addEventListener('blur', this.onBlur);
    this.el.addEventListener('pointerdown', this.onPointerDown);
    this.el.addEventListener('pointermove', this.onPointerMove);
    this.el.addEventListener('pointerup', this.onPointerUp);
    this.el.addEventListener('pointercancel', this.onPointerUp);
    this.el.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  private onBlur = () => this.reset();

  private reset(): void {
    this.keys.clear();
    this.actionsDown.clear();
    this.touches.clear();
    this.move.x = this.move.y = 0;
    this.look.x = this.look.y = 0;
    this.mouseLooking = false;
    this.onStickChange?.(false, 0, 0, 0, 0);
  }

  private onKeyDown = (e: KeyboardEvent) => {
    if (!this.enabled) return;
    if (e.repeat) return;
    this.keys.add(e.code);
    const a = KEY_MAP[e.code];
    if (a) {
      if (!this.actionsDown.has(a)) this.actionsPressed.add(a);
      this.actionsDown.add(a);
      if (e.code === 'Space') e.preventDefault();
    }
  };

  private onKeyUp = (e: KeyboardEvent) => {
    this.keys.delete(e.code);
    const a = KEY_MAP[e.code];
    if (a) {
      this.actionsDown.delete(a);
      this.actionsReleased.add(a);
    }
  };

  private onPointerDown = (e: PointerEvent) => {
    if (!this.enabled) return;
    // UIボタン上のポインタはゲーム入力に流さない
    if ((e.target as HTMLElement)?.closest?.('[data-ui-block]')) return;

    if (e.pointerType === 'mouse') {
      this.mouseLooking = e.button === 2 || e.button === 0;
      this.updatePointerNdc(e);
      return;
    }

    const half = innerWidth * 0.5;
    const role: TouchState['role'] = e.clientX < half ? 'move' : 'look';
    this.touches.set(e.pointerId, {
      id: e.pointerId,
      originX: e.clientX,
      originY: e.clientY,
      x: e.clientX,
      y: e.clientY,
      startedAt: performance.now(),
      moved: false,
      role,
    });
    if (role === 'move') this.onStickChange?.(true, e.clientX, e.clientY, 0, 0);
  };

  private onPointerMove = (e: PointerEvent) => {
    if (!this.enabled) return;
    this.updatePointerNdc(e);

    if (e.pointerType === 'mouse') {
      if (this.mouseLooking) {
        this.look.x += e.movementX * 0.0022 * this.lookSensitivity;
        this.look.y += e.movementY * 0.0022 * this.lookSensitivity;
      }
      return;
    }

    const t = this.touches.get(e.pointerId);
    if (!t) return;
    const dx = e.clientX - t.x;
    const dy = e.clientY - t.y;
    t.x = e.clientX;
    t.y = e.clientY;
    if (Math.abs(e.clientX - t.originX) > 8 || Math.abs(e.clientY - t.originY) > 8) t.moved = true;

    if (t.role === 'look') {
      this.look.x += dx * 0.0042 * this.lookSensitivity;
      this.look.y += dy * 0.0042 * this.lookSensitivity;
    } else {
      const ox = t.x - t.originX;
      const oy = t.y - t.originY;
      const len = Math.hypot(ox, oy);
      const clamped = Math.min(len, this.stickRadius);
      const nx = len > 0 ? (ox / len) * (clamped / this.stickRadius) : 0;
      const ny = len > 0 ? (oy / len) * (clamped / this.stickRadius) : 0;
      this.move.x = nx;
      this.move.y = -ny; // スクリーンYは下が正。前進を +1 に揃える
      this.onStickChange?.(true, t.originX, t.originY, nx * this.stickRadius, ny * this.stickRadius);
    }
  };

  private onPointerUp = (e: PointerEvent) => {
    if (e.pointerType === 'mouse') {
      if (this.mouseLooking && e.button === 0) {
        // ドラッグしていなければクリック＝タップ扱い
        this.tapNdc = { ...this.pointerNdc };
      }
      this.mouseLooking = false;
      return;
    }
    const t = this.touches.get(e.pointerId);
    if (!t) return;
    this.touches.delete(e.pointerId);
    if (t.role === 'move') {
      this.move.x = this.move.y = 0;
      this.onStickChange?.(false, 0, 0, 0, 0);
    } else if (!t.moved && performance.now() - t.startedAt < 260) {
      this.tapNdc = {
        x: (t.x / innerWidth) * 2 - 1,
        y: -(t.y / innerHeight) * 2 + 1,
      };
    }
  };

  private updatePointerNdc(e: PointerEvent): void {
    this.pointerNdc.x = (e.clientX / innerWidth) * 2 - 1;
    this.pointerNdc.y = -(e.clientY / innerHeight) * 2 + 1;
  }

  /** 毎フレーム先頭で呼ぶ。キーボード移動軸を合成する */
  beginFrame(): void {
    if (this.touches.size === 0 || !this.hasTouchRole('move')) {
      let mx = 0;
      let my = 0;
      if (this.keys.has('KeyW') || this.keys.has('ArrowUp')) my += 1;
      if (this.keys.has('KeyS') || this.keys.has('ArrowDown')) my -= 1;
      if (this.keys.has('KeyD') || this.keys.has('ArrowRight')) mx += 1;
      if (this.keys.has('KeyA') || this.keys.has('ArrowLeft')) mx -= 1;
      const len = Math.hypot(mx, my);
      if (len > 1) { mx /= len; my /= len; }
      this.move.x = mx;
      this.move.y = my;
    }
  }

  private hasTouchRole(role: TouchState['role']): boolean {
    for (const t of this.touches.values()) if (t.role === role) return true;
    return false;
  }

  /** 毎フレーム末尾で呼ぶ。エッジ検出と視点デルタをクリアする */
  endFrame(): void {
    this.actionsPressed.clear();
    this.actionsReleased.clear();
    this.look.x = 0;
    this.look.y = 0;
    this.tapNdc = null;
  }

  isDown(a: ActionName): boolean { return this.actionsDown.has(a); }
  justPressed(a: ActionName): boolean { return this.actionsPressed.has(a); }
  justReleased(a: ActionName): boolean { return this.actionsReleased.has(a); }

  /** UI側のボタンからアクションを注入する */
  pressAction(a: ActionName): void {
    if (!this.actionsDown.has(a)) this.actionsPressed.add(a);
    this.actionsDown.add(a);
  }

  releaseAction(a: ActionName): void {
    this.actionsDown.delete(a);
    this.actionsReleased.add(a);
  }

  dispose(): void {
    removeEventListener('keydown', this.onKeyDown);
    removeEventListener('keyup', this.onKeyUp);
    removeEventListener('blur', this.onBlur);
  }
}
