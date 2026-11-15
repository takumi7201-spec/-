import { Screen } from '../UIRoot';
import { h, button, clear } from '../dom';
import { getRevos, revosShortName } from '../../game/data/revos';
import { KIT_TRAIT, KIT_TRAITS } from '../../game/data/traits';
import { runDef } from '../../game/run/units';
import {
  buy, sell, move, reroll, BUY_COST, REROLL_COST, RUN_WINS, RUN_LIVES, maxTier, type RunState,
} from '../../game/run/run';
import { teamHp } from '../../game/run/battle';
import {
  unitValues, unitCooldown, abilityText, traitsText, shopUnit, starOf, fmt,
  EFFECT_GLYPH, EFFECT_NAMES, EFFECT_HELP,
} from '../../game/run/describe';
import { BOARD_SIZE, type RunUnit } from '../../game/run/types';
import { revosIcon } from '../revosIcon';
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
  private rerollBtn!: HTMLButtonElement;
  private goldPlate = plate('コイン', { tone: 'amber' });

  onBack?: () => void;
  onFight?: () => void;
  onChange?: () => void;

  constructor() { super('run', 'battle'); }

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
      if (u) slot.append(...this.cardFace(u));
      else slot.append(h('span', { class: 'run-empty', text: '＋' }));
      this.boardEl.appendChild(slot);
    }

    // ---- 店 ----
    clear(this.shopEl);
    r.shop.forEach((id, i) => {
      const sel = this.pick?.from === 'shop' && this.pick.i === i;
      if (!id) { this.shopEl.appendChild(h('div', { class: 'run-slot run-slot--shop is-sold' })); return; }
      const stack = r.board.some((u) => u?.defId === id && starOf(u) < 3);
      const card = button('', () => this.tapShop(i), {
        class: `run-slot run-slot--shop ${sel ? 'is-sel' : ''} ${stack ? 'is-stack' : ''}`,
      });
      card.append(...this.cardFace(shopUnit(id)), h('span', { class: 'run-cost' }, coinMark('run-coin'), String(BUY_COST)));
      this.shopEl.appendChild(card);
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
    return [
      h('span', { class: 'run-top' },
        h('span', { class: `run-tier tier-${d.tier}`, text: String(d.tier) }),
        h('span', { class: 'run-star', text: '★'.repeat(star) }),
      ),
      h('span', { class: 'run-art' }, revosIcon(u.defId, 'run-icon')),
      h('span', { class: 'run-name', text: revosShortName(u.defId) }),
      h('span', { class: 'run-cd num', text: `${fmt(unitCooldown(u))}s` }),
      vals,
      kit ? h('span', { class: 'run-kit', text: KIT_TRAITS[kit].name }) : h('span'),
    ];
  }

  /** 選んだ札の中身。何をするか・何で育つかを、ここで全部読ませる */
  private renderInfo(): void {
    clear(this.infoEl);
    const r = this.run;
    let u: RunUnit | null = null;
    if (this.pick?.from === 'board') u = r.board[this.pick.i];
    else if (this.pick?.from === 'shop') { const id = r.shop[this.pick.i]; u = id ? shopUnit(id) : null; }
    if (!u) {
      this.infoEl.append(h('div', { class: 'run-hint', text:
        r.board.every((x) => !x)
          ? '店の札を押して、空いた枠へ置く。同じユニットを3体重ねると★2になる。'
          : '札を押すと中身が出る。盤面の札を選んで別の枠を押すと入れ替わる。' }));
      return;
    }
    const d = runDef(u.defId);
    const def = getRevos(u.defId);
    const kit = KIT_TRAIT[u.defId];
    const lines = h('div', { class: 'run-info-lines' });
    for (const v of unitValues(u)) {
      lines.appendChild(h('div', { class: 'run-info-line' },
        h('span', { class: `run-val run-val--${v.kind}` }, h('i', { text: EFFECT_GLYPH[v.kind] }), fmt(v.value)),
        h('span', { text: `${EFFECT_NAMES[v.kind]}：${EFFECT_HELP[v.kind]}${v.grown ? `（育ち +${fmt(v.grown)}）` : ''}` }),
      ));
    }
    for (const t of traitsText(u.defId)) lines.appendChild(h('div', { class: 'run-info-line run-info-trait', text: `◆ ${t}` }));
    for (const ab of d.abilities) lines.appendChild(h('div', { class: 'run-info-line run-info-ab', text: `▸ ${abilityText(u.defId, ab)}` }));

    const actions = h('div', { class: 'run-info-actions' });
    if (this.pick?.from === 'board') {
      const i = this.pick.i;
      actions.appendChild(button(`売る +${starOf(u)}`, () => this.doSell(i), { class: 'btn--sm btn--opt' }));
    }
    this.infoEl.append(
      h('div', { class: 'run-info-head' },
        revosIcon(u.defId, 'run-info-icon'),
        h('div', { class: 'run-info-title' },
          h('b', { text: def.name }),
          h('span', { class: 'run-info-sub', text:
            `段${d.tier} · ${'★'.repeat(starOf(u))}${u.copies > 1 ? `（${u.copies}体）` : ''} · クールダウン ${fmt(unitCooldown(u))}秒${kit ? ` · ${KIT_TRAITS[kit].name}` : ''}` }),
        ),
        actions,
      ),
      lines,
    );
  }

  /** 店の札を選んでいる間、置ける枠を光らせる */
  private dropHint(i: number): boolean {
    if (this.pick?.from !== 'shop') return false;
    const id = this.run.shop[this.pick.i];
    const u = this.run.board[i];
    return !u || (u.defId === id && starOf(u) < 3);
  }

  private tapBoard(i: number): void {
    const r = this.run;
    if (this.pick?.from === 'shop') {
      const ok = buy(r, this.pick.i, i);
      if (!ok) {
        audio.uiError();
        this.ui.toast(r.gold < BUY_COST ? 'コインが足りない' : 'その枠には置けない', 'warn');
        return;
      }
      audio.uiConfirm();
      this.pick = null;
      this.onChange?.();
      this.render();
      return;
    }
    if (this.pick?.from === 'board') {
      if (this.pick.i !== i) { move(r, this.pick.i, i); audio.uiTap(); this.onChange?.(); }
      this.pick = null;
      this.render();
      return;
    }
    if (r.board[i]) { audio.uiTap(); this.pick = { from: 'board', i }; this.render(); }
  }

  private tapShop(i: number): void {
    audio.uiTap();
    const r = this.run;
    if (this.pick?.from === 'shop' && this.pick.i === i) {
      // 2度押しは「空いている所へ買う」。重ねられるならそこへ
      const ok = buy(r, i);
      if (!ok) {
        audio.uiError();
        this.ui.toast(r.gold < BUY_COST ? 'コインが足りない' : '盤面に空きがない', 'warn');
        return;
      }
      audio.uiConfirm();
      this.pick = null;
      this.onChange?.();
    } else {
      this.pick = { from: 'shop', i };
    }
    this.render();
  }

  private doSell(i: number): void {
    sell(this.run, i);
    audio.uiConfirm();
    this.pick = null;
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
