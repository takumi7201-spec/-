import { Screen, type LayoutKind } from '../UIRoot';
import { h, button, bar } from '../dom';
import type { CleanScene, ToolId } from '../../scenes/CleanScene';
import { TOOLS } from '../../scenes/CleanScene';
import type { CleanScore } from '../../game/FossilBlock';
import { getRevos } from '../../game/data/revos';
import { audio } from '../../core/Audio';

/**
 * 精錬（クリーニング）画面。
 *
 * 全画面のうち、ここだけは「2ゾーン」を復活させる。指で岩を削っている間、
 * 画面の下2/3は手で隠れるので、進捗・タイマー・骨の損傷を下や中央に置いた
 * 瞬間に破綻する。ただし 50:50 ではなく、上端 88px の情報ストリップと
 * 残り全部の作業面という極端な非対称にする。
 *
 * タイマーは失敗条件ではなくスコアボーナスに降格させている。
 * Web は通知・タブ切替・電話で中断されるのが常態で、
 * 厳しいタイマー＋中断は理不尽にしかならない。
 */
export class CleanScreen extends Screen {
  private timeEl!: HTMLElement;
  private progressBar = bar('', 0);
  private progressText!: HTMLElement;
  private boneEl!: HTMLElement;
  private nameEl!: HTMLElement;
  private surface!: HTMLElement;
  private toolBtns = new Map<ToolId, HTMLButtonElement>();
  private rail!: HTMLElement;

  private remain = 60;
  private limit = 60;
  private running = false;
  private defId = '';
  private dragging = false;
  private rotating = false;
  private lastX = 0;
  private lastY = 0;
  private pointerNdc: { x: number; y: number } | null = null;
  private firstTouch = false;
  private idleSpin = 0;

  onFinish?: (score: CleanScore, defId: string) => void;

  constructor(private scene: CleanScene) { super('clean'); }

  build(): void {
    // ---- 情報ストリップ（手の外側に固定）----
    this.timeEl = h('div', { class: 'num clean-time', text: '1:00' });
    this.progressText = h('span', { class: 'num', text: '0%' });
    this.boneEl = h('div', { class: 'clean-bone' });
    this.nameEl = h('div', { class: 'clean-name', text: '' });

    const strip = h('div', { class: 'clean-strip panel' },
      h('div', { class: 'clean-strip-row' },
        h('div', { class: 'clean-col' },
          h('span', { class: 'label', text: '残 り' }),
          this.timeEl,
        ),
        h('div', { class: 'clean-col grow' },
          h('div', { class: 'clean-prog-head' },
            h('span', { class: 'label', text: '除去率' }),
            this.progressText,
          ),
          this.progressBar.el,
        ),
        h('div', { class: 'clean-col' },
          h('span', { class: 'label', text: '骨 の 状 態' }),
          this.boneEl,
        ),
      ),
      this.nameEl,
    );

    // ---- 作業面（ここで削る）----
    this.surface = h('div', { class: 'clean-surface interactive', 'data-ui-block': '' });
    this.bindSurface();

    // ---- 回転レール（右端／左利き設定で左へ）----
    this.rail = h('div', { class: 'clean-rail interactive', 'data-ui-block': '' },
      h('span', { class: 'rail-label', text: '回転' }),
    );
    this.bindRail();

    // ---- ツールバー ----
    const toolBar = h('div', { class: 'clean-tools' });
    (['pick', 'drill', 'brush'] as ToolId[]).forEach((id, i) => {
      const spec = TOOLS[id];
      const b = button(spec.name, () => this.selectTool(id), {
        class: 'btn--tool',
        sub: id === 'pick' ? '硬岩を一撃で' : id === 'drill' ? '細かく削る' : '骨に安全',
        key: String(i + 1),
      });
      this.toolBtns.set(id, b);
      toolBar.appendChild(b);
    });

    const deck = h('div', { class: 'deck deck--clean' },
      h('div', { class: 'clean-deck-inner' },
        h('div', { class: 'clean-dead-zone' }),
        toolBar,
        h('div', { class: 'clean-actions' },
          button('完了', () => this.finish(), { class: 'btn--primary btn--sm' }),
        ),
      ),
    );

    this.el.append(strip, this.surface, this.rail, deck);
    this.selectTool('pick');
  }

  // ------------------------------------------------------------ 入力

  private bindSurface(): void {
    const ndcOf = (e: PointerEvent): { x: number; y: number } => {
      // 指の下は見えないので、実際の削り中心を接触点の 14px 上へずらす。
      // これをやらないと「削りたい所が見えない」ゲームになる
      const lift = e.pointerType === 'touch' ? 14 : 0;
      return {
        x: (e.clientX / innerWidth) * 2 - 1,
        y: -((e.clientY - lift) / innerHeight) * 2 + 1,
      };
    };

    this.surface.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      this.surface.setPointerCapture?.(e.pointerId);
      // マウス右ボタンは回転。タッチは常に削る（回転はレール）
      if (e.pointerType === 'mouse' && e.button === 2) {
        this.rotating = true;
        this.lastX = e.clientX;
        this.lastY = e.clientY;
        return;
      }
      this.dragging = true;
      this.firstTouch = true;
      this.pointerNdc = ndcOf(e);
      this.idleSpin = 0;
    }, { passive: false });

    this.surface.addEventListener('pointermove', (e) => {
      if (this.rotating) {
        this.scene.rotate((e.clientX - this.lastX) * 0.008, (e.clientY - this.lastY) * 0.006);
        this.lastX = e.clientX;
        this.lastY = e.clientY;
        return;
      }
      this.pointerNdc = ndcOf(e);
      if (!this.dragging && e.pointerType === 'mouse') this.scene.aim(this.pointerNdc);
    });

    const end = (e: PointerEvent): void => {
      this.dragging = false;
      this.rotating = false;
      if (e.pointerType === 'touch') { this.pointerNdc = null; this.scene.hideCursor(); }
    };
    this.surface.addEventListener('pointerup', end);
    this.surface.addEventListener('pointercancel', end);
    this.surface.addEventListener('pointerleave', () => { if (!this.dragging) this.scene.hideCursor(); });
    this.surface.addEventListener('contextmenu', (e) => e.preventDefault());
    this.surface.addEventListener('wheel', (e) => {
      e.preventDefault();
      this.scene.rotate(0, (e.deltaY > 0 ? 1 : -1) * 0.06);
    }, { passive: false });
  }

  private bindRail(): void {
    let active = false;
    let last = 0;
    this.rail.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      active = true;
      last = e.clientY;
      this.rail.setPointerCapture?.(e.pointerId);
    }, { passive: false });
    this.rail.addEventListener('pointermove', (e) => {
      if (!active) return;
      this.scene.rotate((e.clientY - last) * 0.012, 0);
      last = e.clientY;
    });
    const stop = (): void => { active = false; };
    this.rail.addEventListener('pointerup', stop);
    this.rail.addEventListener('pointercancel', stop);
  }

  private selectTool(id: ToolId): void {
    audio.uiTap();
    this.scene.setTool(id);
    for (const [k, b] of this.toolBtns) b.classList.toggle('is-on', k === id);
  }

  // ------------------------------------------------------------ 進行

  enter(params?: unknown): void {
    const p = params as { defId: string; rarity: number; seed: number } | undefined;
    if (!p) return;
    this.defId = p.defId;
    this.limit = p.rarity >= 5 ? 95 : p.rarity >= 3 ? 75 : 60;
    this.remain = this.limit;
    this.running = true;
    this.idleSpin = 1;

    this.scene.load(p.defId, p.rarity, p.seed);
    this.scene.events.onProgress = (removed, total) => {
      const r = total > 0 ? removed / total : 0;
      this.progressBar.set(r);
      this.progressText.textContent = `${Math.round(r * 100)}%`;
      if (r >= 0.999) this.finish();
    };
    this.scene.events.onBoneHit = (dmg) => {
      this.renderBone();
      this.ui.flash('#d9512f', 0.22);
      this.ui.toast(`骨を削ってしまった −${dmg.toFixed(1)}`, 'bad', 1400);
    };

    const def = getRevos(p.defId);
    this.nameEl.textContent = `${def.name} の化石（${'★'.repeat(p.rarity)}）`;
    this.renderBone();
    this.selectTool('pick');
    this.ui.toast('岩を削って骨を露出させよう', 'info', 2600);
  }

  private renderBone(): void {
    // 損傷は数値ではなく5段の点で出す。数字だと減点が気になりすぎて手が止まる
    const dots = Math.min(5, Math.floor(this.scene.boneDamage / 4));
    this.boneEl.textContent = '●'.repeat(5 - dots) + '○'.repeat(dots);
    this.boneEl.classList.toggle('is-bad', dots >= 3);
  }

  private finish(): void {
    if (!this.running) return;
    this.running = false;
    this.scene.hideCursor();
    const score = this.scene.score(this.remain, this.limit);
    audio.reward(score.rank === 'S' ? 3 : score.rank === 'A' ? 2 : 1);
    this.onFinish?.(score, this.defId);
  }

  update(dt: number): void {
    if (!this.running) return;

    if (!document.hidden) {
      this.remain = Math.max(0, this.remain - dt);
      const m = Math.floor(this.remain / 60);
      const s = Math.floor(this.remain % 60);
      this.timeEl.textContent = `${m}:${String(s).padStart(2, '0')}`;
      this.timeEl.classList.toggle('is-low', this.remain < 10);
    }

    if (this.dragging && this.pointerNdc) {
      this.scene.apply(this.pointerNdc, dt, this.firstTouch);
      this.firstTouch = false;
    }
    // 触っていない間だけゆっくり回す。形を把握させるため
    this.scene.update(dt, !this.dragging && !this.rotating && this.idleSpin > 0);
  }

  onLayout(kind: LayoutKind): void {
    this.el.dataset.layout = kind;
  }

  exit(): void {
    this.running = false;
    this.scene.hideCursor();
  }
}
