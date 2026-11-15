import * as THREE from 'three';
import { Screen } from '../UIRoot';
import { h, button, clear } from '../dom';
import { getRevos, revosShortName } from '../../game/data/revos';
import { runDef } from '../../game/run/units';
import { DT, type RunBattleResult, type RunEvent } from '../../game/run/battle';
import { EFFECT_GLYPH, EFFECT_NAMES, fmt, starOf } from '../../game/run/describe';
import { BOARD_SIZE, type RunUnit, type Stat, type EffectKind } from '../../game/run/types';
import type { BattleScene, Fighter } from '../../scenes/BattleScene';
import type { BiomeId } from '../../voxel/palette';
import { revosIcon } from '../revosIcon';
import { spaced } from '../chrome';
import { audio } from '../../core/Audio';

/**
 * ランの戦闘を見せる。
 *
 * 結果は始まる前に決まっている（乱数を使わない）。ここは 0.1秒ごとの記録を
 * 時間どおりに再生するだけ。体は以前の 3D の舞台に立たせ、手前が自分・奥が相手の
 * 2列6体。発動すると正面の相手へ踏み込み、削りは当たった体の上に数字で出る。
 *
 * 画面の上下には体力の帯と、6体ぶんの溜まりの帯（細い列）だけを置く。
 * 真ん中は 3D に空ける——札を大きく並べると、舞台が見えなくなる。
 */
interface Row { cards: HTMLElement[]; bars: HTMLElement[]; vals: HTMLElement[] }
interface Panel { hpFill: HTMLElement; hpText: HTMLElement; shield: HTMLElement; burn: HTMLElement; poison: HTMLElement }

/** 2周ごとに舞台を変える */
const STAGES: BiomeId[] = ['canyon', 'tidehollow', 'frostpeak', 'emberfield', 'permitzone'];

/** 枠の横位置。6体を一列に並べる */
const laneX = (slot: number): number => (slot - (BOARD_SIZE - 1) / 2) * 1.12;
/** 手前（自分）と奥（相手）の列。手前を少し寄せて、画面の下側も使う */
const ROW_Z: [number, number] = [5.4, -0.4];

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
  /** 直前に発動した体。続く盾・回復の数字をそこに出す */
  private lastFirer: [string | null, string | null] = [null, null];
  /** 直前に狙われた体。続く削りの数字とのけぞりをそこに出す */
  private lastTarget: [string | null, string | null] = [null, null];
  private tmp = new THREE.Vector3();

  /** 3D の舞台。main から渡す */
  scene3d?: BattleScene;
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
    this.lastFirer = [null, null];
    this.lastTarget = [null, null];
    this.overlay.classList.remove('is-on');
    clear(this.overlay);
    clear(this.stage);
    const foe = this.mkPanel(1, `相手 · ${round}周目`);
    const me = this.mkPanel(0, 'あなた');
    const foeRow = this.mkRow(1);
    const meRow = this.mkRow(0);
    this.panels = [me.panel, foe.panel];
    this.rows = [meRow.row, foeRow.row];
    this.stage.append(
      h('div', { class: 'rb-side rb-side--foe' }, foe.el, foeRow.el),
      h('div', { class: 'rb-mid' }),
      h('div', { class: 'rb-side rb-side--me' }, meRow.el, me.el),
    );
    this.setupStage(round);
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

  /** 3D の舞台に2列6体を立てる */
  private setupStage(round: number): void {
    const s = this.scene3d;
    if (!s) return;
    s.buildArena(STAGES[Math.floor((round - 1) / 2) % STAGES.length], 7000 + round * 31);
    const fighters: Fighter[] = [];
    for (const side of [0, 1] as const) {
      this.boards[side].forEach((u, i) => {
        if (!u) return;
        const x = laneX(i), z = ROW_Z[side];
        // ★が上がるほど体を少し大きく。重ねた手応えを舞台でも見せる
        const size = 0.74 + 0.08 * (starOf(u) - 1);
        fighters.push({ uid: uidOf(side, i), defId: u.defId, side, x, z, px: x, pz: z, size });
      });
    }
    s.setFighters(fighters);
  }

  private mkPanel(side: 0 | 1, label: string): { el: HTMLElement; panel: Panel } {
    const hpFill = h('i', { class: 'rb-hp-fill' });
    const hpText = h('span', { class: 'rb-hp-text num' });
    const shield = h('span', { class: 'rb-chip rb-chip--shield' });
    const burn = h('span', { class: 'rb-chip rb-chip--burn' });
    const poison = h('span', { class: 'rb-chip rb-chip--poison' });
    const el = h('div', { class: `rb-panel rb-panel--${side === 0 ? 'me' : 'foe'}` },
      h('div', { class: 'rb-panel-top' }, h('span', { class: 'rb-who', text: label }), shield, burn, poison),
      h('div', { class: 'rb-hp' }, hpFill, hpText),
    );
    return { el, panel: { hpFill, hpText, shield, burn, poison } };
  }

  /** 6体ぶんの細い札。顔・溜まりの帯・いまの数値 */
  private mkRow(side: 0 | 1): { el: HTMLElement; row: Row } {
    const row: Row = { cards: [], bars: [], vals: [] };
    const el = h('div', { class: `rb-row rb-row--${side === 0 ? 'me' : 'foe'}` });
    for (let i = 0; i < BOARD_SIZE; i++) {
      const u = this.boards[side][i];
      const bar = h('i', { class: 'rb-bar-fill' });
      const vals = h('span', { class: 'rb-vals' });
      const card = h('div', { class: `rb-card ${u ? '' : 'is-empty'}` },
        u ? h('span', { class: 'rb-card-top' },
          revosIcon(u.defId, 'rb-icon'),
          h('span', { class: 'rb-name', text: revosShortName(u.defId) }),
          h('span', { class: 'rb-star', text: '★'.repeat(starOf(u)) }),
        ) : '',
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
    const ev = this.res.events;
    while (this.evIdx < ev.length && ev[this.evIdx].t <= f.t + 1e-9) this.show(ev[this.evIdx++]);
  }

  /** 正面の相手の枠。同じ枠が空なら、いちばん近い枠 */
  private facing(side: 0 | 1, slot: number): string | null {
    const foe = this.boards[1 - side];
    let best = -1, bd = Infinity;
    foe.forEach((u, i) => { if (u && Math.abs(i - slot) < bd) { bd = Math.abs(i - slot); best = i; } });
    return best < 0 ? null : uidOf((1 - side) as 0 | 1, best);
  }

  /** その側のまん中あたりの体。火傷・毒・砂嵐のように、誰が受けたでもない削りを出す場所 */
  private middleOf(side: 0 | 1): string | null {
    const b = this.boards[side];
    const order = [2, 3, 1, 4, 0, 5];
    for (const i of order) if (b[i]) return uidOf(side, i);
    return null;
  }

  private show(e: RunEvent): void {
    if (!this.rows) return;
    const s = this.scene3d;
    if (e.type === 'fire') {
      const card = this.rows[e.side].cards[e.slot];
      card.classList.remove('is-fire');
      void card.offsetWidth;
      card.classList.add('is-fire');
      const uid = uidOf(e.side, e.slot);
      this.lastFirer[e.side] = uid;
      const u = this.boards[e.side][e.slot];
      const d = u ? runDef(u.defId) : null;
      // 相手に何かを出す体は踏み込む。盾・回復だけの体はその場で構える
      const offensive = !!d && (d.fire.dmg || d.fire.burn || d.fire.poison || d.fire.slow || d.fire.strip);
      const target = this.facing(e.side, e.slot);
      if (offensive && target) {
        this.lastTarget[1 - e.side] = target;
        s?.attack(uid, target, 0.14 / this.speed, false, false);
      } else {
        s?.play(uid, 'attack');
      }
      return;
    }
    if (e.type === 'hit' && e.amount + e.shielded > 0) {
      const amount = Math.round(e.amount + e.shielded);
      if (e.kind === 'dmg') {
        const tgt = this.lastTarget[e.side] ?? this.middleOf(e.side);
        const from = this.lastFirer[1 - e.side] ?? tgt;
        if (tgt && from) s?.hit(tgt, from, amount, false, 1, this.res.maxHp[e.side] / 3);
        if (e.amount > 0) audio.uiTap();
      } else {
        const at = this.middleOf(e.side);
        const color = e.kind === 'burn' ? '#ff9c3c' : e.kind === 'poison' ? '#8fd14f' : '#e4d2a8';
        if (at) this.number(at, `${amount}`, color);
      }
      return;
    }
    if (e.type === 'gain' && e.amount > 0) {
      const at = this.lastFirer[e.side] ?? this.middleOf(e.side);
      if (!at) return;
      if (e.kind === 'heal') s?.heal(at, Math.round(e.amount));
      else if (e.kind === 'shield') { this.number(at, `盾+${fmt(e.amount)}`, '#7fb2ff'); s?.statChange(at, true); }
      return;
    }
    if (e.type === 'grow' && e.perm) {
      const card = this.rows[e.side].cards[e.slot];
      const tag = h('span', { class: 'rb-grow', text: `${growName(e.stat)} +${fmt(e.add)}` });
      card.appendChild(tag);
      setTimeout(() => tag.remove(), 1100);
      s?.statChange(uidOf(e.side, e.slot), true);
      return;
    }
    if (e.type === 'end' && s) {
      // 負けた側は全員倒れる。引き分けは両方
      for (const side of [0, 1] as const) {
        if (e.winner === side) continue;
        this.boards[side].forEach((u, i) => { if (u) s.ko(uidOf(side, i)); });
      }
      s.slowMotion(0.5);
    }
  }

  /** 体の頭の上に数字を浮かせる */
  private number(uid: string, text: string, color: string): void {
    const s = this.scene3d;
    if (!s || !s.worldOf(uid, this.tmp)) return;
    this.tmp.y += 2.0;
    s.numbers.spawn(this.tmp, text, { color, scale: 0.8 });
  }

  private toggleSpeed(): void {
    this.speed = this.speed === 1 ? 2 : this.speed === 2 ? 4 : 1;
    this.speedBtn.textContent = `×${this.speed}`;
    audio.uiTap();
  }

  /** 結果を出す。育った数字をここでまとめて見せる */
  private finish(): void {
    if (this.done) return;
    // とばしたときは、残りの出来事（決着の倒れ込みまで）を一気に流す
    while (this.evIdx < this.res.events.length) {
      const ev = this.res.events[this.evIdx++];
      if (ev.type === 'end') this.show(ev);
    }
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
    // 倒れ込みを見せてから結果を出す
    setTimeout(() => this.overlay.classList.add('is-on'), 700);
  }
}

function uidOf(side: 0 | 1, slot: number): string { return `${side}-${slot}`; }

function growName(s: Stat): string {
  if (s === 'cd') return 'クールダウン';
  if (s === 'charge') return '溜まり';
  return EFFECT_NAMES[s];
}
