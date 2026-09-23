import { Screen, type LayoutKind } from '../UIRoot';
import { h, button, bar } from '../dom';
import type { CleanScene, ToolId } from '../../scenes/CleanScene';
import { TOOLS } from '../../scenes/CleanScene';
import type { CleanScore } from '../../game/FossilBlock';
import { getRevos } from '../../game/data/revos';
import { cleanCap, scoreClean } from '../../game/FossilBlock';
import { screenHead, spaced } from '../chrome';
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
  private boneNumEl!: HTMLElement;
  private capEl!: HTMLElement;
  private nameEl!: HTMLElement;
  private surface!: HTMLElement;
  private toolBtns = new Map<ToolId, HTMLButtonElement>();
  private rail!: HTMLElement;

  private remain = 60;
  private limit = 60;
  /** 生のクリーン度を出すための、直近の除去量 */
  private removed = 0;
  private rockTotal = 0;
  private shownClean = -1;
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
    // ---- 頭。題は化石の名前、右端に残り時間 ----
    this.timeEl = h('div', { class: 'plate-value num', text: '1:00' });
    this.nameEl = h('div', { class: 'scr-title' });
    // 抜けても化石は残らない——途中で捨てる規則を作るより、
    // ここまでの出来で採点して閉じる。やめる道は必ず採点を通る
    const head = screenHead({
      eyebrow: '下ごしらえ', title: '',
      onBack: () => void this.abort(),
      right: h('div', { class: 'plate clean-time-plate' },
        h('div', { class: 'plate-inner' }, this.timeEl),
      ),
    });
    head.querySelector('.scr-title')?.replaceWith(this.nameEl);
    head.querySelector('.scr-back')?.setAttribute('aria-label', 'やめる');

    // ---- 計器。左に除去率、右に損傷。1枚の板に並べる ----
    this.progressText = h('span', { class: 'num clean-num', text: '0' });
    this.boneEl = h('i', { class: 'clean-dmg-fill' });
    this.boneNumEl = h('div', { class: 'num clean-dmg-num', text: '0.0' });

    const strip = h('div', { class: 'clean-strip' },
      h('div', { class: 'clean-col grow' },
        h('div', { class: 'clean-prog-head' },
          h('span', { class: 'clean-label', text: spaced('クリーン度') }),
          this.progressText,
        ),
        // 目盛りは評価の境目。どこまで削れば等級が上がるかを帯の上で示す
        h('div', { class: 'clean-gauge' },
          this.progressBar.el,
          // 損傷で届かなくなった天井。削った帯がここで止まる
          (this.capEl = h('i', { class: 'clean-cap' })),
          h('i', { class: 'clean-tick clean-tick--a' }),
          h('i', { class: 'clean-tick clean-tick--s' }),
        ),
        h('div', { class: 'clean-ranks' },
          h('span', { text: '乙' }),
          h('span', { class: 'clean-rank--a', text: '甲' }),
          h('span', { class: 'clean-rank--s', text: '特' }),
        ),
      ),
      h('div', { class: 'clean-col clean-col--dmg' },
        h('span', { class: 'clean-label', text: spaced('損傷') }),
        h('div', { class: 'clean-dmg' }, this.boneEl),
        this.boneNumEl,
      ),
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
    // 記号は道具の動きに寄せる。⛏は打つ、⌁は細く走る、〜は撫でる
    const FACE: Record<ToolId, { icon: string; desc: string }> = {
      pick: { icon: '⛏', desc: '硬岩を一撃で' },
      drill: { icon: '⌁', desc: '細かく削る' },
      brush: { icon: '〜', desc: '骨に安全' },
    };
    (['pick', 'drill', 'brush'] as ToolId[]).forEach((id, i) => {
      const spec = TOOLS[id];
      const b = button(spec.name, () => this.selectTool(id), {
        class: 'btn--tool',
        icon: FACE[id].icon,
        sub: FACE[id].desc,
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
          h('span', { class: 'clean-hint', text: spaced('なぞって削る') }),
          h('span', { class: 'clean-actions-rule' }),
          button('ここで終える', () => this.finish(), { class: 'clean-end' }),
        ),
      ),
    );

    this.el.append(head, strip, this.surface, this.rail, deck);
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

    this.removed = 0;
    this.rockTotal = 0;
    this.shownClean = -1;
    // 受け口は load より先に繋ぐ。load は総量を1度だけ知らせるので、
    // 後から繋ぐとその1回を取りこぼし、最初の一削りまで計器が 0 のままになる
    this.scene.events.onProgress = (removed, total) => {
      this.removed = removed;
      this.rockTotal = total;
      this.renderClean();
      if (total > 0 && removed / total >= 0.999) this.finish();
    };
    this.scene.events.onBoneHit = (dmg) => {
      this.renderBone();
      this.ui.flash('#d9512f', 0.22);
      this.ui.toast(`骨を削ってしまった −${dmg.toFixed(1)}`, 'bad', 1400);
    };
    this.scene.load(p.defId, p.rarity, p.seed);

    const def = getRevos(p.defId);
    this.nameEl.textContent = `${def.name} の化石`;
    this.renderBone();
    this.selectTool('pick');
    this.ui.toast('岩を削って骨を露出させよう', 'info', 2600);
  }

  /**
   * 計器に出すのは除去率ではなくクリーン度そのもの。
   *
   * 帯の目盛り（70 / 85）も、天井の斜線も、等級の境目もクリーン度の値で
   * 決まっている。除去率を出していた間は、85% まで削った手元と
   * 「甲」の線が指す所が別物で、線の意味が読めなかった。
   * 時間ぶんの 12 点もここに乗るので、放っておけば数字は下がる。
   */
  private renderClean(): void {
    const c = this.rockTotal > 0
      ? scoreClean(this.removed, this.rockTotal, this.remain, this.limit, this.scene.boneDamage).clean
      : 0;
    if (c === this.shownClean) return;
    this.shownClean = c;
    this.progressBar.set(c / 100);
    this.progressText.textContent = String(c);
  }

  private renderBone(): void {
    // 損傷は溜まる側の帯で出す。減っていく点だと「残り」に見えて、
    // 削ってはいけないものを削っている自覚が出ない
    const d = this.scene.boneDamage;
    // 帯は上限が0になる損傷量（100/3）を満タンとする
    this.boneEl.style.width = `${Math.min(100, (d / (100 / 3)) * 100)}%`;
    // 損傷は点を引かず上限を下げる。下がった天井を除去率の帯の上に出す
    const cap = cleanCap(d);
    this.capEl.style.left = `${cap}%`;
    this.capEl.hidden = cap >= 100;
    this.boneNumEl.textContent = d > 0 ? `−${d.toFixed(1)}` : '0.0';
    this.boneNumEl.classList.toggle('is-bad', d > 0);
    // 天井が下がればクリーン度も頭を打つ。同じ操作で両方が動く
    this.renderClean();
  }

  /** 頭の「やめる」。途中で捨てる規則は作らず、必ず採点を通して閉じる */
  private async abort(): Promise<void> {
    if (!this.running) return;
    const ok = await this.ui.confirm(
      '精錬をやめる',
      'ここまでの出来で採点して閉じる。削り残しはそのまま点に響く。',
      'やめる', true,
    );
    if (ok) this.finish();
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
      // 時間ぶんの点が減るので、削っていなくても数字は動く
      this.renderClean();
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
