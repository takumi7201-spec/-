import { Screen } from '../UIRoot';
import { h, button, clear } from '../dom';
import { revosShortName } from '../../game/data/revos';
import { KIT_TRAIT, KIT_TRAITS } from '../../game/data/traits';
import { runDef } from '../../game/run/units';
import {
  buy, sell, move, reroll, BUY_COST, REROLL_COST, RUN_WINS, RUN_LIVES, maxTier, type RunState,
} from '../../game/run/run';
import { teamHp } from '../../game/run/battle';
import {
  unitValues, unitCooldown, shopUnit, starOf, fmt, EFFECT_GLYPH,
} from '../../game/run/describe';
import { BOARD_SIZE, rowOf, neighbors, type RunUnit } from '../../game/run/types';
import { revosIcon } from '../revosIcon';
import { ExpandCard } from '../expandCard';
import { unitSheet } from '../unitSheet';
import { screenHead, plate, spaced, coinMark } from '../chrome';
import { audio } from '../../core/Audio';

/**
 * ランの店。
 *
 * 上に盤面（横一列6枠）、下に店（5枠）。札を押すと下の欄に中身が出る。
 * 選んだ札をもう一度押すか、別の枠を押すと動かす——ドラッグは使わない
 * （指の下に置き先が隠れる。編成画面と同じ理由）。
 *
 * 選んでいるもの:
 *   盤面の札 … 別の枠を押せば入れ替え。「売る」で売る
 *   店の札   … 盤面の空き枠を押せばそこへ買う。同じユニットが居れば重なる
 */
type Pick = { from: 'board'; i: number } | { from: 'shop'; i: number } | null;

export class RunScreen extends Screen {
  private run!: RunState;
  private pick: Pick = null;

  private statusEl!: HTMLElement;
  private boardEl!: HTMLElement;
  private shopEl!: HTMLElement;
  private infoEl!: HTMLElement;
  private xcard!: ExpandCard;
  /** 押して開いたポップアップが出ているか。閉じて選んだままなら「置き先を選ぶ」状態 */
  private popup = false;
  private boardSlots: HTMLElement[] = [];
  private shopSlots: (HTMLElement | null)[] = [];
  private rerollBtn!: HTMLButtonElement;
  private goldPlate = plate('コイン', { tone: 'amber' });

  onBack?: () => void;
  onFight?: () => void;
  onChange?: () => void;

  // 遊んでいる間は専用のページ。下タブは出さず、横の払いでも他の面へ行かない
  constructor() { super('run'); }

  setRun(r: RunState): void { this.run = r; this.pick = null; this.render(); }

  build(): void {
    const head = screenHead({
      eyebrow: 'ラン', title: '店',
      onBack: () => this.onBack?.(),
      right: this.goldPlate.el,
    });
    this.statusEl = h('div', { class: 'run-status' });
    this.boardEl = h('div', { class: 'run-board' });
    this.shopEl = h('div', { class: 'run-shop' });
    this.infoEl = h('div', { class: 'run-info' });

    const body = h('div', { class: 'run-body' },
      this.statusEl,
      h('div', { class: 'label run-label', text: spaced('盤面') }),
      this.boardEl,
      h('div', { class: 'label run-label', text: spaced('店') }),
      this.shopEl,
      this.infoEl,
    );
    this.rerollBtn = button('', () => this.doReroll(), { class: 'btn--opt run-reroll' });
    const deck = h('div', { class: 'deck deck--run' },
      this.rerollBtn,
      button(spaced('戦う'), () => this.fight(), { class: 'btn--primary run-fight' }),
    );
    this.el.append(head, body, deck);
    this.xcard = new ExpandCard(this.el);
    // 背景を押したら閉じて、選んでいたものも外す
    this.xcard.onDismiss = () => { audio.uiBack(); this.pick = null; this.popup = false; this.render(); };
  }

  enter(): void { this.render(); }

  private render(): void {
    if (!this.run || !this.boardEl) return;
    const r = this.run;
    this.goldPlate.set(String(r.gold));

    // ---- 状況 ----
    clear(this.statusEl);
    const wins = h('span', { class: 'run-pips run-pips--win' });
    for (let i = 0; i < RUN_WINS; i++) wins.appendChild(h('i', { class: i < r.wins ? 'on' : '' }));
    const lives = h('span', { class: 'run-pips run-pips--life' });
    for (let i = 0; i < RUN_LIVES; i++) lives.appendChild(h('i', { class: i < r.lives ? 'on' : '' }));
    this.statusEl.append(
      h('span', { class: 'run-round' }, h('b', { class: 'num', text: String(r.round) }), ' 周目'),
      h('span', { class: 'run-stat' }, '勝利 ', wins),
      h('span', { class: 'run-stat' }, 'ライフ ', lives),
      h('span', { class: 'run-stat run-hp' }, `体力 `, h('b', { class: 'num', text: String(teamHp(r.round)) })),
    );

    // ---- 盤面 ----
    clear(this.boardEl);
    for (let i = 0; i < BOARD_SIZE; i++) {
      const u = r.board[i];
      const sel = this.pick?.from === 'board' && this.pick.i === i;
      const slot = button('', () => this.tapBoard(i), {
        class: `run-slot ${u ? '' : 'is-empty'} ${sel ? 'is-sel' : ''} ${this.dropHint(i) ? 'is-drop' : ''}`,
      });
      slot.dataset.slot = String(i);
      // 上の段が前列。どこが相手に近いかを枠に書いておく
      if (rowOf(i) === 0) slot.classList.add('is-front');
      if (u) { slot.append(...this.cardFace(u)); this.draggable(slot, { from: 'board', i }); }
      else slot.append(h('span', { class: 'run-empty', text: rowOf(i) === 0 ? '前列' : '＋' }));
      this.boardEl.appendChild(slot);
      this.boardSlots[i] = slot;
    }

    // ---- 店 ----
    clear(this.shopEl);
    this.shopSlots = [];
    r.shop.forEach((id, i) => {
      const sel = this.pick?.from === 'shop' && this.pick.i === i;
      if (!id) { this.shopEl.appendChild(h('div', { class: 'run-slot run-slot--shop is-sold' })); this.shopSlots[i] = null; return; }
      const stack = r.board.some((u) => u?.defId === id && starOf(u) < 3);
      const card = button('', () => this.tapShop(i), {
        class: `run-slot run-slot--shop ${sel ? 'is-sel' : ''} ${stack ? 'is-stack' : ''}`,
      });
      card.append(...this.cardFace(shopUnit(id)), h('span', { class: 'run-cost' }, coinMark('run-coin'), String(BUY_COST)));
      this.draggable(card, { from: 'shop', i });
      this.shopEl.appendChild(card);
      this.shopSlots[i] = card;
    });

    this.rerollBtn.textContent = '';
    this.rerollBtn.append('品替え ', coinMark('run-coin'), String(REROLL_COST));
    this.rerollBtn.disabled = r.gold < REROLL_COST;

    this.renderInfo();
  }

  /** 札の表。顔・★・クールダウン・効果の数値 */
  private cardFace(u: RunUnit): HTMLElement[] {
    const d = runDef(u.defId);
    const star = starOf(u);
    const vals = h('span', { class: 'run-vals' });
    for (const v of unitValues(u)) {
      vals.appendChild(h('span', { class: `run-val run-val--${v.kind} ${v.grown > 0 ? 'is-grown' : ''}` },
        h('i', { text: EFFECT_GLYPH[v.kind] }), fmt(v.value)));
    }
    const kit = KIT_TRAIT[u.defId];
    // 顔と中身を分けて置く。盤面（横長の札）は横に、店（縦長の札）は縦に流す
    return [
      h('span', { class: 'run-art' }, revosIcon(u.defId, 'run-icon')),
      h('span', { class: 'run-info-col' },
        h('span', { class: 'run-top' },
          h('span', { class: `run-tier tier-${d.tier}`, text: String(d.tier) }),
          h('span', { class: 'run-name', text: revosShortName(u.defId) }),
          h('span', { class: 'run-star', text: '★'.repeat(star) }),
        ),
        h('span', { class: 'run-cd num', text: `${fmt(unitCooldown(u))}秒${kit ? ` · ${KIT_TRAITS[kit].name}` : ''}` }),
        vals,
      ),
    ];
  }

  /**
   * ドラッグで動かす。
   *
   * 押して少し動かしたらドラッグに切り替え、札の写しを指に付ける。盤面の枠の上で
   * 離すと、盤面の札なら入れ替え、店の札ならその枠へ買う（同じユニットなら重なる）。
   * 動かさずに離したときは、ふつうのタップとして扱う（中身のポップアップ）。
   */
  private draggable(el: HTMLElement, at: NonNullable<Pick>): void {
    el.dataset.noSwipe = '';
    el.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return;
      const sx = e.clientX, sy = e.clientY;
      let ghost: HTMLElement | null = null;
      let over: HTMLElement | null = null;
      const offX = sx - el.getBoundingClientRect().left, offY = sy - el.getBoundingClientRect().top;
      const move = (ev: PointerEvent): void => {
        if (!ghost) {
          if (Math.hypot(ev.clientX - sx, ev.clientY - sy) < 8) return;
          // ドラッグ開始。ポップアップは閉じ、選択も外す
          ghost = el.cloneNode(true) as HTMLElement;
          ghost.classList.add('run-ghost');
          ghost.style.width = `${el.offsetWidth}px`;
          ghost.style.height = `${el.offsetHeight}px`;
          document.body.appendChild(ghost);
          el.classList.add('is-dragging');
          this.pick = null; this.popup = false;
          this.xcard.hide(el);
          audio.uiTap();
        }
        ghost.style.transform = `translate(${ev.clientX - offX}px, ${ev.clientY - offY}px) rotate(-3deg) scale(1.05)`;
        const under = document.elementFromPoint(ev.clientX, ev.clientY)?.closest<HTMLElement>('.run-board .run-slot') ?? null;
        if (under !== over) {
          over?.classList.remove('is-over');
          over = under;
          over?.classList.add('is-over');
          // 置こうとしている枠の隣（上下左右）を光らせる。隣に効く能力がどこへ届くかが置く前に分かる
          for (const b of this.boardSlots) b.classList.remove('is-reach');
          if (over) for (const n of neighbors(Number(over.dataset.slot))) this.boardSlots[n]?.classList.add('is-reach');
        }
      };
      const up = (): void => {
        removeEventListener('pointermove', move);
        removeEventListener('pointerup', up);
        removeEventListener('pointercancel', up);
        if (!ghost) return;
        ghost.remove();
        el.classList.remove('is-dragging');
        over?.classList.remove('is-over');
        for (const b of this.boardSlots) b.classList.remove('is-reach');
        // 直後に来るクリックは、ドラッグの終わりなので捨てる
        this.swallowClick = true;
        setTimeout(() => { this.swallowClick = false; }, 0);
        const to = over ? Number(over.dataset.slot) : NaN;
        if (Number.isNaN(to)) { this.render(); return; }
        this.dropOn(at, to);
      };
      addEventListener('pointermove', move);
      addEventListener('pointerup', up);
      addEventListener('pointercancel', up);
    });
  }
  private swallowClick = false;

  /** ドラッグを枠 to の上で離した */
  private dropOn(at: NonNullable<Pick>, to: number): void {
    const r = this.run;
    if (at.from === 'board') {
      if (at.i !== to) { move(r, at.i, to); audio.uiConfirm(); this.onChange?.(); }
    } else if (!buy(r, at.i, to)) {
      audio.uiError();
      this.ui.toast(r.gold < BUY_COST ? 'コインが足りない' : 'その枠には置けない', 'warn');
    } else {
      audio.uiConfirm();
      this.onChange?.();
    }
    this.pick = null;
    this.popup = false;
    this.render();
  }

  private slotOf(at: Pick): HTMLElement | null {
    if (!at) return null;
    return at.from === 'board' ? this.boardSlots[at.i] ?? null : this.shopSlots[at.i] ?? null;
  }

  private unitAt(at: Pick): RunUnit | null {
    if (!at) return null;
    if (at.from === 'board') return this.run.board[at.i];
    const id = this.run.shop[at.i];
    return id ? shopUnit(id) : null;
  }

  /**
   * 札の中身を広げる。選んでいる札が先、無ければ乗せている札。
   * どちらも無ければカードを元の札へ縮めて、置き場所には手引きを出す
   */
  private renderInfo(): void {
    const r = this.run;
    // 開くのはクリック・タップしたときだけ
    const at = this.pick && this.popup ? this.pick : null;
    const u = this.unitAt(at);
    const from = this.slotOf(at);
    clear(this.infoEl);
    if (at && u && from) {
      this.lastShown = at;
      const modal = true;
      this.xcard.show(`${at.from}:${at.i}:${u.defId}:${u.copies}:${modal}`, from, this.sheet(u, at, modal), modal);
    } else {
      this.xcard.hide(this.slotOf(this.lastShown));
      this.lastShown = null;
    }
    // 下の欄は手引き。置き先を選んでいる間は、何をすればいいかを言う
    const hint = this.pick && !this.popup
      ? this.pick.from === 'shop' ? '置く枠を押す（同じユニットの枠なら重なる）。もう一度店の札を押すとやめる。'
        : '動かす先の枠を押す。同じ枠を押すとやめる。'
      : r.board.every((x) => !x)
        ? '店の札を盤面へドラッグして買う（押せば中身が出る）。同じユニットを3体重ねると★2になる。'
        : '札を押すと中身が出る。盤面の札はドラッグで入れ替え、店の札は盤面へドラッグして買える。';
    this.infoEl.append(h('div', { class: 'run-hint', text: hint }));
  }
  private lastShown: Pick = null;

  /** 広げたカードの中身。いまの数値と、★2・★3 に重ねたときの数値を並べる */
  private sheet(u: RunUnit, at: NonNullable<Pick>, interactive: boolean): HTMLElement {
    const star = starOf(u);
    // 店の札なら、盤面の同じユニットに重ねたあとの姿で数える
    const onBoard = at.from === 'shop' ? this.run.board.find((b) => b?.defId === u.defId && starOf(b) < 3) : null;
    const actions = h('div', { class: 'xs-actions' });
    if (interactive && at.from === 'board') {
      actions.append(
        button(`売る +${star}`, () => this.doSell(at.i), { class: 'btn--opt' }),
        button('動かす', () => this.placeMode(), { class: 'btn--opt' }),
      );
    }
    if (interactive && at.from === 'shop') {
      actions.append(
        button('置く枠を選ぶ', () => this.placeMode(), { class: 'btn--opt' }),
        button(onBoard ? '重ねる' : '買う', () => this.buyAuto(at.i), { class: 'btn--primary' }),
      );
    }
    const close = interactive ? button('✕', () => { audio.uiBack(); this.pick = null; this.popup = false; this.render(); }, { class: 'btn--sm btn--opt xs-close' }) : null;
    return unitSheet(u, {
      merged: onBoard ? { ...onBoard, copies: onBoard.copies + 1 } : null,
      // 盤面の札はその枠で、店の札は重ねる先（あれば）の枠で範囲を描く
      slot: at.from === 'board' ? at.i : onBoard ? this.run.board.indexOf(onBoard) : null,
      board: this.run.board,
      corner: close,
      actions: interactive ? actions : null,
    });
  }

  /** 店の札を選んでいる間、置ける枠を光らせる */
  private dropHint(i: number): boolean {
    if (this.pick?.from !== 'shop') return false;
    const id = this.run.shop[this.pick.i];
    const u = this.run.board[i];
    return !u || (u.defId === id && starOf(u) < 3);
  }

  private tapBoard(i: number): void {
    if (this.swallowClick) return;
    const r = this.run;
    // 置き先を選んでいる最中（ポップアップは閉じて、選んだまま）
    if (this.pick && !this.popup) {
      if (this.pick.from === 'shop') {
        const ok = buy(r, this.pick.i, i);
        if (!ok) {
          audio.uiError();
          this.ui.toast(r.gold < BUY_COST ? 'コインが足りない' : 'その枠には置けない', 'warn');
          return;
        }
        audio.uiConfirm();
        this.onChange?.();
      } else if (this.pick.i !== i) {
        move(r, this.pick.i, i); audio.uiTap(); this.onChange?.();
      }
      this.pick = null;
      this.render();
      return;
    }
    if (r.board[i]) { audio.uiTap(); this.pick = { from: 'board', i }; this.popup = true; this.render(); }
  }

  private tapShop(i: number): void {
    if (this.swallowClick) return;
    audio.uiTap();
    // 置き先を選んでいる最中に同じ札を押したらやめる
    if (this.pick?.from === 'shop' && this.pick.i === i && !this.popup) { this.pick = null; this.render(); return; }
    this.pick = { from: 'shop', i };
    this.popup = true;
    this.render();
  }

  /** ポップアップを閉じ、選んだまま置き先（動かす先）を選ばせる */
  private placeMode(): void {
    audio.uiTap();
    this.popup = false;
    this.render();
  }

  /** 空いている所へ買う。重ねられるならそこへ */
  private buyAuto(i: number): void {
    const r = this.run;
    if (!buy(r, i)) {
      audio.uiError();
      this.ui.toast(r.gold < BUY_COST ? 'コインが足りない' : '盤面に空きがない', 'warn');
      return;
    }
    audio.uiConfirm();
    this.pick = null;
    this.popup = false;
    this.onChange?.();
    this.render();
  }

  private doSell(i: number): void {
    sell(this.run, i);
    audio.uiConfirm();
    this.pick = null;
    this.popup = false;
    this.onChange?.();
    this.render();
  }

  private doReroll(): void {
    if (!reroll(this.run)) { audio.uiError(); return; }
    audio.uiTap();
    this.pick = null;
    this.onChange?.();
    this.render();
  }

  private fight(): void {
    if (this.run.board.every((u) => !u)) {
      audio.uiError();
      this.ui.toast('盤面に1体は置く', 'warn');
      return;
    }
    audio.uiConfirm();
    this.onFight?.();
  }
}

export { maxTier };
