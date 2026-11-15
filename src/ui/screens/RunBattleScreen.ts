import { Screen } from '../UIRoot';
import { h, button, clear } from '../dom';
import { getRevos, revosShortName } from '../../game/data/revos';
import { DT, type RunBattleResult, type RunEvent } from '../../game/run/battle';
import { EFFECT_GLYPH, EFFECT_NAMES, fmt, starOf } from '../../game/run/describe';
import { BOARD_SIZE, type RunUnit, type Stat, type EffectKind } from '../../game/run/types';
import { revosIcon } from '../revosIcon';
import { spaced } from '../chrome';
import { audio } from '../../core/Audio';

/**
 * ランの戦闘を見せる。
 *
 * 結果は始まる前に決まっている（乱数を使わない）。ここは 0.1秒ごとの記録を
 * 時間どおりに再生するだけ。札の下の帯が溜まりで、満ちたら札が跳ねて効果が出る。
 * 削りと盾・回復は、体力の帯の脇に数字を浮かせる。
 */
interface Row { cards: HTMLElement[]; bars: HTMLElement[]; vals: HTMLElement[] }
interface Panel { hpFill: HTMLElement; hpText: HTMLElement; shield: HTMLElement; burn: HTMLElement; poison: HTMLElement; floats: HTMLElement }

export class RunBattleScreen extends Screen {
  private res!: RunBattleResult;
  private boards!: [(RunUnit | null)[], (RunUnit | null)[]];
  private rows: [Row, Row] | null = null;
  private panels: [Panel, Panel] | null = null;
  private stage!: HTMLElement;
  private timeEl!: HTMLElement;
  private speedBtn!: HTMLButtonElement;
  private overlay!: HTMLElement;
  private speed = 1;
  private raf = 0;
  private startAt = 0;
  private played = 0;
  private evIdx = 0;
  private done = false;

  onNext?: () => void;

  // 戦闘中は下タブを出さない。見ている間に別の枠へ逃げる理由が無い
  constructor() { super('runBattle'); }

  build(): void {
    this.stage = h('div', { class: 'rb-stage' });
    this.timeEl = h('span', { class: 'rb-time num' });
    this.speedBtn = button('×1', () => this.toggleSpeed(), { class: 'btn--sm btn--opt rb-speed' });
    const skip = button('とばす', () => this.finish(), { class: 'btn--sm btn--opt rb-skip' });
    this.overlay = h('div', { class: 'rb-overlay' });
    this.el.append(
      h('div', { class: 'rb-head' }, this.timeEl, this.speedBtn, skip),
      this.stage,
      this.overlay,
    );
  }

  /** 戦闘を渡して再生を始める。boards は [自分, 相手] */
  play(res: RunBattleResult, boards: [(RunUnit | null)[], (RunUnit | null)[]], round: number): void {
    this.res = res;
    this.boards = boards;
    this.done = false;
    this.played = 0;
    this.evIdx = 0;
    this.overlay.classList.remove('is-on');
    clear(this.overlay);
    clear(this.stage);
    const foe = this.mkPanel(1, `相手（${round}周目）`);
    const me = this.mkPanel(0, 'あなた');
    const foeRow = this.mkRow(1);
    const meRow = this.mkRow(0);
    this.panels = [me.panel, foe.panel];
    this.rows = [meRow.row, foeRow.row];
    this.stage.append(foe.el, foeRow.el, h('div', { class: 'rb-mid' }), meRow.el, me.el);
    this.draw(0);
    cancelAnimationFrame(this.raf);
    this.startAt = performance.now();
    const tick = (now: number): void => {
      if (this.done) return;
      this.played += ((now - this.startAt) / 1000) * this.speed;
      this.startAt = now;
      const end = this.res.frames.length * DT;
      if (this.played >= end) { this.draw(this.res.frames.length - 1); this.finish(); return; }
      this.draw(Math.floor(this.played / DT));
      this.raf = requestAnimationFrame(tick);
    };
    this.raf = requestAnimationFrame(tick);
  }

  exit(): void { cancelAnimationFrame(this.raf); }

  private mkPanel(side: 0 | 1, label: string): { el: HTMLElement; panel: Panel } {
    const hpFill = h('i', { class: 'rb-hp-fill' });
    const hpText = h('span', { class: 'rb-hp-text num' });
    const shield = h('span', { class: 'rb-chip rb-chip--shield' });
    const burn = h('span', { class: 'rb-chip rb-chip--burn' });
    const poison = h('span', { class: 'rb-chip rb-chip--poison' });
    const floats = h('div', { class: 'rb-floats' });
    const el = h('div', { class: `rb-panel rb-panel--${side === 0 ? 'me' : 'foe'}` },
      h('div', { class: 'rb-panel-top' }, h('span', { class: 'rb-who', text: label }), shield, burn, poison),
      h('div', { class: 'rb-hp' }, hpFill, hpText),
      floats,
    );
    return { el, panel: { hpFill, hpText, shield, burn, poison, floats } };
  }

  private mkRow(side: 0 | 1): { el: HTMLElement; row: Row } {
    const row: Row = { cards: [], bars: [], vals: [] };
    const el = h('div', { class: `rb-row rb-row--${side === 0 ? 'me' : 'foe'}` });
    for (let i = 0; i < BOARD_SIZE; i++) {
      const u = this.boards[side][i];
      const bar = h('i', { class: 'rb-bar-fill' });
      const vals = h('span', { class: 'rb-vals' });
      const card = h('div', { class: `rb-card ${u ? '' : 'is-empty'}` },
        u ? h('span', { class: 'rb-star', text: '★'.repeat(starOf(u)) }) : '',
        u ? revosIcon(u.defId, 'rb-icon') : '',
        u ? h('span', { class: 'rb-name', text: revosShortName(u.defId) }) : '',
        vals,
        u ? h('span', { class: 'rb-bar' }, bar) : '',
      );
      row.cards.push(card); row.bars.push(bar); row.vals.push(vals);
      el.appendChild(card);
    }
    return { el, row };
  }

  private draw(fi: number): void {
    const f = this.res.frames[Math.max(0, Math.min(this.res.frames.length - 1, fi))];
    if (!f || !this.rows || !this.panels) return;
    this.timeEl.textContent = `${f.t.toFixed(1)}秒`;
    for (const side of [0, 1] as const) {
      const p = this.panels[side];
      const max = this.res.maxHp[side];
      const hp = Math.max(0, f.hp[side]);
      p.hpFill.style.width = `${(hp / max) * 100}%`;
      p.hpText.textContent = `${Math.ceil(hp)} / ${max}`;
      p.shield.textContent = f.shield[side] > 0 ? `盾 ${fmt(f.shield[side])}` : '';
      p.burn.textContent = f.burn[side] > 0 ? `火傷 ${fmt(f.burn[side])}` : '';
      p.poison.textContent = f.poison[side] > 0 ? `毒 ${fmt(f.poison[side])}` : '';
      const row = this.rows[side];
      for (let i = 0; i < BOARD_SIZE; i++) {
        const c = f.charge[side][i];
        if (c < 0) continue;
        row.bars[i].style.width = `${c * 100}%`;
        const vals = f.values[side][i];
        const key = Object.entries(vals).map(([k, v]) => `${k}${v}`).join('|');
        if (row.vals[i].dataset.k !== key) {
          row.vals[i].dataset.k = key;
          clear(row.vals[i]);
          for (const [k, v] of Object.entries(vals) as [EffectKind, number][]) {
            row.vals[i].appendChild(h('span', { class: `run-val run-val--${k}` }, h('i', { text: EFFECT_GLYPH[k] }), fmt(v)));
          }
        }
      }
    }
    // この刻みまでの出来事を流す
    const ev = this.res.events;
    while (this.evIdx < ev.length && ev[this.evIdx].t <= f.t + 1e-9) this.show(ev[this.evIdx++]);
  }

  private show(e: RunEvent): void {
    if (!this.rows || !this.panels) return;
    if (e.type === 'fire') {
      const card = this.rows[e.side].cards[e.slot];
      card.classList.remove('is-fire');
      void card.offsetWidth;
      card.classList.add('is-fire');
      return;
    }
    if (e.type === 'hit' && e.amount + e.shielded > 0) {
      this.float(e.side, `-${fmt(e.amount)}`, `rb-float--${e.kind}`);
      if (e.kind === 'dmg' && e.amount > 0) audio.uiTap();
      return;
    }
    if (e.type === 'gain' && e.amount > 0 && (e.kind === 'shield' || e.kind === 'heal')) {
      this.float(e.side, `+${fmt(e.amount)}`, `rb-float--${e.kind}`);
      return;
    }
    if (e.type === 'grow' && e.perm) {
      const card = this.rows[e.side].cards[e.slot];
      const tag = h('span', { class: 'rb-grow', text: `${growName(e.stat)} +${fmt(e.add)}` });
      card.appendChild(tag);
      setTimeout(() => tag.remove(), 1100);
    }
  }

  private float(side: 0 | 1, text: string, cls: string): void {
    const p = this.panels![side];
    const n = h('span', { class: `rb-float ${cls}`, text });
    n.style.left = `${20 + Math.random() * 60}%`;
    p.floats.appendChild(n);
    setTimeout(() => n.remove(), 900);
  }

  private toggleSpeed(): void {
    this.speed = this.speed === 1 ? 2 : this.speed === 2 ? 4 : 1;
    this.speedBtn.textContent = `×${this.speed}`;
    audio.uiTap();
  }

  /** 結果を出す。育った数字をここでまとめて見せる */
  private finish(): void {
    if (this.done) return;
    this.done = true;
    cancelAnimationFrame(this.raf);
    this.draw(this.res.frames.length - 1);
    const w = this.res.winner;
    const title = w === 0 ? '勝利' : w === 1 ? '敗北' : '引き分け';
    if (w === 0) audio.uiConfirm(); else audio.uiError();
    const list = h('div', { class: 'rb-growth' });
    for (const u of this.boards[0]) {
      if (!u) continue;
      const g = this.res.growth[0].get(u.uid);
      if (!g) continue;
      const txt = Object.entries(g).map(([k, v]) => `${growName(k as Stat)} +${fmt(v as number)}`).join('、');
      list.appendChild(h('div', { class: 'rb-growth-line' }, revosIcon(u.defId, 'rb-growth-icon'), h('span', { text: `${getRevos(u.defId).name}：${txt}` })));
    }
    clear(this.overlay);
    this.overlay.append(
      h('div', { class: `rb-result rb-result--${w === 0 ? 'win' : w === 1 ? 'lose' : 'draw'}` },
        h('div', { class: 'rb-result-title', text: spaced(title) }),
        h('div', { class: 'rb-result-sub', text: `${this.res.seconds.toFixed(1)}秒` }),
        list.childElementCount > 0 ? h('div', { class: 'label', text: spaced('育ち') }) : '',
        list,
        button(spaced('次へ'), () => { audio.uiConfirm(); this.onNext?.(); }, { class: 'btn--primary btn--wide' }),
      ),
    );
    this.overlay.classList.add('is-on');
  }
}

function growName(s: Stat): string {
  if (s === 'cd') return 'クールダウン';
  if (s === 'charge') return '溜まり';
  return EFFECT_NAMES[s];
}
