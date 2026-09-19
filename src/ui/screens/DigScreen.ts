import { Screen, type LayoutKind } from '../UIRoot';
import { h, button, bar, clear } from '../dom';
import { InventoryPanel, type InventoryContext } from '../InventoryPanel';
import type { SaveData } from '../../core/Save';
import type { DigScene } from '../../scenes/DigScene';
import type { BuriedNode } from '../../game/TerrainGen';
import { AREA_VOX, VOXEL_SIZE } from '../../game/TerrainGen';
import { REVOS_BY_ID } from '../../game/data/revos';
import { BIOMES } from '../../voxel/palette';
import { screenHead, plate, railButton, spaced } from '../chrome';
import { audio } from '../../core/Audio';

/**
 * 発掘HUD。
 *
 * 原作の下画面ソナーを「隅の小さなレーダー」に縮小してはいけない。
 * 指の接触面は8〜10mmあり、80px四方のレーダー上で地点指定は物理的に不可能。
 * ここではミニマップは現在地把握のみに使い、位置の特定はエコーと
 * 一時的な俯瞰モードで行う。
 */
export class DigScreen extends Screen {
  private staminaBar = bar('bar--hp', 1);
  private findsEl!: HTMLElement;
  private echoBtn!: HTMLButtonElement;
  private echoFill!: HTMLElement;
  private digBtn!: HTMLButtonElement;
  private minimap!: HTMLCanvasElement;
  private mapCtx!: CanvasRenderingContext2D | null;
  private stickEl!: HTMLElement;
  private stickKnob!: HTMLElement;
  private scanFrame!: HTMLElement;
  private mapTimer = 0;
  private echoRemain = 0;
  private mapRange: { lo: number; hi: number } | null = null;
  private depthPlate = plate('深度', { tone: 'mint' });
  private siteEl!: HTMLElement;
  private echoCardEl!: HTMLElement;
  private echoHeadEl!: HTMLElement;
  private echoNoteEl!: HTMLElement;
  private staminaNumEl!: HTMLElement;
  private sweepEl!: HTMLElement;

  private inv = new InventoryPanel();
  private save: SaveData | null = null;
  private haul: { defId: string; rarity: number; kind: 'fossil' | 'mineral' }[] = [];

  onExit?: () => void;
  onFinish?: () => void;
  /**
   * 回収した埋蔵物をゲーム側へ渡す。
   * DigScene.events は単一ハンドラなので、画面とゲームの両方が
   * 直接代入すると後勝ちで一方が消える。所有は画面側に統一し、
   * ゲームへはこのコールバックで流す。
   */
  onCollectFossil?: (node: BuriedNode) => void;

  constructor(private scene: DigScene) {
    super('dig');
  }

  build(): void {
    // ---- L1: 頭。現場の名前と深度 ----
    this.siteEl = h('div', { class: 'scr-title' });
    this.depthPlate.set('0.0');
    const strip = screenHead({
      eyebrow: '発掘現場', title: '',
      onBack: () => this.onExit?.(),
      right: this.depthPlate.el,
    });
    strip.querySelector('.scr-title')?.replaceWith(this.siteEl);

    // ---- L1: 体力。白い板を1枚、頭のすぐ下に ----
    this.staminaNumEl = h('span', { class: 'num dig-card-num', text: '0 / 0' });
    this.findsEl = h('span', { class: 'num dig-card-num', text: '0 / 0' });
    const staminaCard = h('div', { class: 'dig-card dig-stamina' },
      h('div', { class: 'dig-card-head' },
        h('span', { class: 'dig-card-label', text: spaced('体力') }),
        this.staminaNumEl,
        h('span', { class: 'dig-card-label dig-card-label--r', text: spaced('発見') }),
        this.findsEl,
      ),
      this.staminaBar.el,
    );

    // ---- L1: 反響の結果。出るときだけ出す ----
    this.echoHeadEl = h('div', { class: 'echo-card-head' });
    this.echoNoteEl = h('div', { class: 'echo-card-note' });
    this.echoCardEl = h('div', { class: 'echo-card', hidden: true }, this.echoHeadEl, this.echoNoteEl);

    // ---- L1: レーダー。同心円と掃引線。画面の中心に置く ----
    this.sweepEl = h('i', { class: 'radar-sweep' });
    const radar = h('div', { class: 'radar' },
      h('i', { class: 'radar-ring radar-ring--1' }),
      h('i', { class: 'radar-ring radar-ring--2' }),
      h('i', { class: 'radar-ring radar-ring--3' }),
      this.sweepEl,
    );

    // ---- L1: 右レール（ミニマップ）と道具 ----
    this.minimap = h('canvas', { class: 'minimap', width: '176', height: '176' });
    this.mapCtx = this.minimap.getContext('2d');
    const rail = h('div', { class: 'rail rail--r' },
      h('div', { class: 'minimap-wrap panel panel--sunk' }, this.minimap),
      h('div', { class: 'rail-col dig-tools' },
        railButton('▤', '持ち物', () => this.toggleInventory()).el,
        railButton('◎', '俯瞰', () => this.toggleScan()).el,
        railButton('↥', '引き上げる', () => this.leave()).el,
      ),
    );

    // ---- スキャンモードの枠（モードに入ったことを隠さない）----
    this.scanFrame = h('div', { class: 'scan-frame' },
      h('div', { class: 'scan-corner scan-corner--tl' }),
      h('div', { class: 'scan-corner scan-corner--tr' }),
      h('div', { class: 'scan-corner scan-corner--bl' }),
      h('div', { class: 'scan-corner scan-corner--br' }),
      h('div', { class: 'scan-label' }, h('span', { text: '探 査 中' })),
    );

    // ---- 仮想スティック（触った場所に出る）----
    this.stickKnob = h('div', { class: 'stick-knob' });
    this.stickEl = h('div', { class: 'stick' }, h('div', { class: 'stick-ring' }), this.stickKnob);

    // ---- L2: 親指デッキ。左は移動の受け皿、右は探査と掘削 ----
    this.echoFill = h('i', { class: 'cd-fill' });
    this.echoBtn = button('反響', () => this.fireEcho(), { class: 'btn--round btn--echo' });
    this.echoBtn.appendChild(h('div', { class: 'cd-ring' }, this.echoFill));

    this.digBtn = button('掘る', () => this.scene.requestDig(), { class: 'btn--round btn--dig' });

    // 動かす指の定位置。触れば実際のスティックがそこに出るが、
    // 何も置かないと「どこを触れば動くのか」が分からない
    const moveRest = h('div', { class: 'move-rest' },
      h('i', { class: 'move-rest-knob' }),
      h('span', { class: 'move-rest-label', text: '移動' }),
    );

    const deck = h('div', { class: 'deck deck--dig' },
      moveRest,
      h('div', { class: 'deck-right' }, this.echoBtn, this.digBtn),
    );

    this.el.append(strip, staminaCard, this.echoCardEl, radar, rail, this.scanFrame, this.stickEl, this.inv.el, deck);
  }

  enter(): void {
    this.siteEl.textContent = BIOMES[this.scene.biomeId]?.name ?? '発掘現場';
    // 初期値はイベント待ちにしない。最初の1回が来るまで 0/0 が出てしまう
    this.staminaBar.set(this.scene.stamina / Math.max(1, this.scene.staminaMax));
    this.staminaNumEl.textContent =
      `${Math.ceil(this.scene.stamina)} / ${Math.round(this.scene.staminaMax)}`;
    this.depthPlate.set('0.0');
    this.scene.events.onStaminaChange = (v, max) => {
      this.staminaBar.set(v / max);
      this.staminaNumEl.textContent = `${Math.ceil(v)} / ${Math.round(max)}`;
      if (v === 0) {
        this.ui.toast('スタミナ切れ。引き上げます', 'warn');
        setTimeout(() => this.onFinish?.(), 1200);
      }
    };
    this.scene.events.onDepthChange = (m) => {
      this.depthPlate.set(m.toFixed(1));
    };
    // 反響の結果はトーストで流さず、画面に残す。
    // 掘る場所を決めるための情報なので、消えては使えない
    this.scene.events.onEcho = (hits) => {
      clear(this.echoHeadEl);
      if (hits.length === 0) {
        this.echoHeadEl.textContent = '反応なし';
        this.echoNoteEl.textContent = 'ここには何も無い';
      } else {
        const s = hits[0].strength;
        const word = s === 3 ? '至近' : s === 2 ? '近い' : '遠い';
        this.echoHeadEl.append(
          '反響 · ', h('span', { class: 'num', text: String(hits.length) }), ' 件',
        );
        this.echoNoteEl.textContent = `最寄りは${word}`;
      }
      this.echoCardEl.hidden = false;
    };
    this.scene.events.onFossilTouched = (n) => {
      this.ui.toast(n.kind === 'fossil' ? '化石を掘り当てた' : '鉱石を掘り当てた', 'info');
      this.ui.flash('#f4a23c', 0.3);
    };
    this.scene.events.onCollect = (n) => {
      this.haul.push({ defId: n.speciesId, rarity: n.rarity, kind: n.kind });
      this.onCollectFossil?.(n);
      this.onCollect(n);
      this.updateFinds();
      const ctx = this.invContext();
      if (ctx) this.inv.update(ctx);
    };
    this.scene.events.onDigBlocked = () => {
      this.ui.toast('岩盤に当たった。ここはもう掘れない', 'warn', 1800);
    };
    this.scene.events.onNearMiss = (_n, remain) => {
      // 深さは掘るまで分からないので、数値ではなく手応えで伝える
      this.ui.toast(remain > 1.2 ? '固い層。まだ下だ' : 'もう少し下に何かある', 'info', 1400);
    };
    this.scene.events.onEchoCooldown = (remain, total) => {
      this.echoRemain = remain;
      this.echoFill.style.transform = `scaleX(${1 - remain / total})`;
      this.echoBtn.classList.toggle('is-cooling', remain > 0);
    };
    this.mapRange = null;
    this.echoCardEl.hidden = true;
    this.haul = [];
    this.inv.close();
    this.el.classList.remove('inv-open');
    this.updateFinds();
  }

  private onCollect(n: BuriedNode): void {
    if (n.kind === 'fossil') {
      const def = REVOS_BY_ID.get(n.speciesId);
      this.ui.toast(`${def?.name ?? '化石'} の化石を回収`, 'info', 3000);
      audio.reward(n.rarity);
    } else {
      this.ui.toast('鉱石を回収（強化素材）', 'info', 2200);
    }
    this.ui.flash('#ffffff', 0.22);
    // 鉱石の取りこぼしで足止めしない。化石が尽きたら引き上げる
    if (this.scene.remainingFossils === 0) {
      this.ui.toast('化石をすべて掘り出した', 'info', 2000);
      setTimeout(() => this.onFinish?.(), 1600);
    }
  }

  private updateFinds(): void {
    const total = this.scene.site?.nodes.length ?? 0;
    const got = total - (this.scene.remainingFinds ?? 0);
    if (this.findsEl) this.findsEl.textContent = `${got} / ${total}`;
  }

  private fireEcho(): void {
    if (this.echoRemain > 0) { audio.uiError(); return; }
    this.scene.requestEcho();
  }

  /** ゲーム側の保存データを渡す。編成の表示に使う */
  setSave(d: SaveData): void { this.save = d; }

  private invContext(): InventoryContext | null {
    if (!this.save || !this.scene.site) return null;
    const total = this.scene.site.nodes.length;
    return {
      biome: this.scene.biomeId,
      haul: this.haul,
      found: total - this.scene.remainingFinds,
      total,
      data: this.save,
    };
  }

  private toggleInventory(): void {
    if (this.inv.isOpen) {
      audio.uiBack();
      this.inv.close();
      this.el.classList.remove('inv-open');
      this.scene.setViewShift(0);
      return;
    }
    const ctx = this.invContext();
    if (!ctx) return;
    audio.uiTap();
    this.inv.open(ctx);
    this.el.classList.add('inv-open');
    this.scene.setViewShift(1);
  }

  private leave(): void {
    audio.uiTap();
    void this.ui.confirm('発掘を終える', '掘り出した化石を持って引き上げます。', '引き上げる')
      .then((ok) => { if (ok) this.onExit?.(); });
  }

  private toggleScan(): void {
    audio.uiTap();
    const next = this.scene.mode === 'scan' ? 'explore' : 'scan';
    this.scene.setMode(next);
    this.scanFrame.classList.toggle('is-on', next === 'scan');
  }

  /** InputManager から仮想スティックの状態を受ける */
  setStick(active: boolean, ox: number, oy: number, dx: number, dy: number): void {
    // 入力層は画面の構築より先に動きうる（起動時の設定適用など）
    if (!this.stickEl) return;
    this.stickEl.classList.toggle('is-on', active);
    if (!active) return;
    this.stickEl.style.left = `${ox}px`;
    this.stickEl.style.top = `${oy}px`;
    this.stickKnob.style.transform = `translate(${dx}px, ${dy}px)`;
  }

  get inventoryOpen(): boolean { return this.inv.isOpen; }

  /** キーボードからの開閉。ゲームループから毎フレーム呼ぶ */
  pollInventoryKey(pressed: boolean): void {
    if (pressed) this.toggleInventory();
  }

  update(dt: number): void {
    this.mapTimer += dt;
    if (this.mapTimer > 0.1) {
      this.mapTimer = 0;
      this.drawMinimap();
    }
  }

  private drawMinimap(): void {
    const ctx = this.mapCtx;
    if (!ctx || !this.scene.site) return;
    const S = this.minimap.width;
    ctx.clearRect(0, 0, S, S);
    ctx.fillStyle = '#14100b';
    ctx.fillRect(0, 0, S, S);

    // 地形の起伏を粗い明度で描く。詳細は3Dで見るので、ここでは方角だけ分かればいい
    const step = 4;
    const h = this.scene.site.heights;
    if (this.mapRange === null) {
      let lo = Infinity, hi = -Infinity;
      for (let i = 0; i < h.length; i++) { if (h[i] < lo) lo = h[i]; if (h[i] > hi) hi = h[i]; }
      this.mapRange = { lo, hi: Math.max(hi, lo + 1) };
    }
    const { lo, hi } = this.mapRange;
    for (let z = 0; z < AREA_VOX; z += step) {
      for (let x = 0; x < AREA_VOX; x += step) {
        const v = h[x + z * AREA_VOX];
        let t = Math.max(0, Math.min(1, (v - lo) / (hi - lo)));
        t = t * t * (3 - 2 * t); // 中間に潰れるのでS字で伸ばす
        const g = Math.round(26 + t * 132);
        ctx.fillStyle = `rgb(${g + 26},${Math.round(g * 0.86) + 10},${Math.round(g * 0.58)})`;
        ctx.fillRect((x / AREA_VOX) * S, (z / AREA_VOX) * S, (step / AREA_VOX) * S + 1, (step / AREA_VOX) * S + 1);
      }
    }

    // 判明済みの反応
    for (const n of this.scene.site.nodes) {
      if (!n.revealed || n.collected) continue;
      const px = (n.cx / AREA_VOX) * S;
      const pz = (n.cz / AREA_VOX) * S;
      ctx.fillStyle = n.kind === 'fossil' ? '#f4a23c' : '#4ba6e2';
      ctx.beginPath();
      ctx.arc(px, pz, 4, 0, Math.PI * 2);
      ctx.fill();
    }

    // 自機。向きも出す
    const p = this.scene.playerPosition;
    const px = (p.x / (AREA_VOX * VOXEL_SIZE)) * S;
    const pz = (p.z / (AREA_VOX * VOXEL_SIZE)) * S;
    ctx.fillStyle = '#f8f2e4';
    ctx.beginPath();
    ctx.arc(px, pz, 3.5, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#2dc6a4';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(px, pz, 7, 0, Math.PI * 2);
    ctx.stroke();
  }

  onLayout(kind: LayoutKind): void {
    this.el.dataset.layout = kind;
  }

  exit(): void {
    this.inv.close();
    this.el.classList.remove('inv-open');
    this.scene.setViewShift(0);
    clear(this.ui.toastArea);
  }
}
