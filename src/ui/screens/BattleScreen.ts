import { Screen, type LayoutKind } from '../UIRoot';
import { h, button, bar, clear } from '../dom';
import type { BattlePlayer, Speed } from '../../game/battle/BattlePlayer';
import type { BattleEvent, Side } from '../../game/battle/types';
import { getRevos } from '../../game/data/revos';
import { ELEMENT_NAMES } from '../../voxel/palette';
import { audio } from '../../core/Audio';

interface UnitCard {
  uid: string;
  el: HTMLElement;
  hp: ReturnType<typeof bar>;
  od: ReturnType<typeof bar>;
  hpText: HTMLElement;
  odBtn?: HTMLButtonElement;
  alive: boolean;
  maxHp: number;
}

/**
 * オートバトルHUD。
 *
 * 介入点はスキル（OD）発動ひとつだけに絞る。押せば得をするが、
 * 押さなくても損はしない——見ていれば報われる構造にして、
 * 義務では縛らない。
 *
 * ログは既定で畳む。4倍速のログは物理的に読めないし、
 * 体験を担うのはテキストではなく動きとダメージ数値のほう。
 */
export class BattleScreen extends Screen {
  private player!: BattlePlayer;
  private allyCards: UnitCard[] = [];
  private enemyCards: UnitCard[] = [];
  private enemyTotal = bar('bar--hp', 1);
  private orderEl!: HTMLElement;
  private logEl!: HTMLElement;
  private logLines: string[] = [];
  private speedBtn!: HTMLButtonElement;
  private roundEl!: HTMLElement;
  private bannerEl!: HTMLElement;
  private orderTimer = 0;

  onFinish?: (winner: Side | -1) => void;

  constructor() { super('battle'); }

  setPlayer(p: BattlePlayer): void {
    this.player = p;
    p.events.onEvent = (e) => this.onEvent(e);
    p.events.onEnd = (w) => this.onEnd(w);
    p.events.onOdReady = (uid) => this.onOdReady(uid);
  }

  build(): void {
    // ---- 上: 敵チーム ----
    const enemyStrip = h('div', { class: 'battle-enemy panel' },
      h('div', { class: 'battle-enemy-head' },
        h('span', { class: 'label', text: 'ENEMY' }),
        this.enemyTotal.el,
        (this.roundEl = h('span', { class: 'num round', text: 'T 0' })),
      ),
      h('div', { class: 'enemy-cards' }),
    );

    // ---- 右: 行動順 ----
    this.orderEl = h('div', { class: 'battle-order' });

    // ---- 中央バナー（開始・決着）----
    this.bannerEl = h('div', { class: 'battle-banner' });

    // ---- 下: 味方 + 操作 ----
    const allyRow = h('div', { class: 'ally-cards' });
    this.logEl = h('div', { class: 'battle-log', hidden: true });

    this.speedBtn = button('×1', () => this.cycleSpeed(), { class: 'btn--sm' });

    const deck = h('div', { class: 'deck deck--battle' },
      h('div', { class: 'battle-deck-inner' },
        this.logEl,
        allyRow,
        h('div', { class: 'battle-controls' },
          button('LOG', () => this.toggleLog(), { class: 'btn--sm btn--ghost' }),
          h('div', { class: 'spacer' }),
          this.speedBtn,
          button('スキップ', () => this.skip(), { class: 'btn--sm btn--ghost' }),
        ),
      ),
    );

    this.el.append(enemyStrip, this.orderEl, this.bannerEl, deck);
    this.allyRow = allyRow;
    this.enemyRow = enemyStrip.querySelector('.enemy-cards') as HTMLElement;
  }

  private allyRow!: HTMLElement;
  private enemyRow!: HTMLElement;

  enter(): void {
    this.buildCards();
    this.logLines = [];
    this.renderLog();
    this.banner('BATTLE START', 900);
  }

  private buildCards(): void {
    clear(this.allyRow);
    clear(this.enemyRow);
    this.allyCards = [];
    this.enemyCards = [];

    for (const f of this.player.sim.fighters) {
      const def = getRevos(f.defId);
      const hp = bar('bar--hp', 1);
      const od = bar('bar--od bar--slim', f.od / 100);
      const hpText = h('span', { class: 'num card-hp', text: `${f.hp}` });

      if (f.side === 0) {
        // 自軍カードは OD ボタンを兼ねる。介入点をここ1箇所に集約する
        const btn = button('', () => this.tryOd(f.uid), { class: 'ally-card' });
        btn.append(
          h('div', { class: 'card-top' },
            h('span', { class: `chip chip--${def.element}`, text: ELEMENT_NAMES[def.element] }),
            h('span', { class: 'card-name', text: def.name }),
          ),
          hp.el,
          h('div', { class: 'card-row' }, hpText, h('span', { class: 'card-od-label', text: 'OD' }), od.el),
        );
        this.allyRow.appendChild(btn);
        this.allyCards.push({ uid: f.uid, el: btn, hp, od, hpText, odBtn: btn, alive: true, maxHp: f.maxHp });
      } else {
        const el = h('div', { class: 'enemy-card' },
          h('span', { class: `chip chip--${def.element}`, text: ELEMENT_NAMES[def.element] }),
          h('span', { class: 'card-name', text: def.name }),
          hp.el,
        );
        this.enemyRow.appendChild(el);
        this.enemyCards.push({ uid: f.uid, el, hp, od, hpText, alive: true, maxHp: f.maxHp });
      }
    }
  }

  private card(uid: string): UnitCard | undefined {
    return this.allyCards.find((c) => c.uid === uid) ?? this.enemyCards.find((c) => c.uid === uid);
  }

  private onEvent(e: BattleEvent): void {
    switch (e.t) {
      case 'turnBegin': {
        const c = this.card(e.uid);
        for (const x of [...this.allyCards, ...this.enemyCards]) x.el.classList.toggle('is-acting', x === c);
        this.roundEl.textContent = `T ${this.player.sim.turnCount}`;
        break;
      }
      case 'damage': {
        const c = this.card(e.uid);
        if (c) {
          c.hp.set(e.hp / c.maxHp);
          c.hpText.textContent = `${e.hp}`;
          c.el.classList.add('is-hurt');
          setTimeout(() => c.el.classList.remove('is-hurt'), 180);
        }
        this.updateEnemyTotal();
        const from = this.nameOf(e.from);
        this.pushLog(`${from} → ${this.nameOf(e.uid)} ${e.amount}${e.crit ? ' CRIT' : ''}${e.eff > 1 ? ' 効果抜群' : e.eff < 1 ? ' いまひとつ' : ''}`);
        break;
      }
      case 'heal': {
        const c = this.card(e.uid);
        if (c) { c.hp.set(e.hp / c.maxHp); c.hpText.textContent = `${e.hp}`; }
        this.updateEnemyTotal();
        this.pushLog(`${this.nameOf(e.uid)} 回復 +${e.amount}`);
        break;
      }
      case 'od': {
        const c = this.allyCards.find((x) => x.uid === e.uid);
        if (c) {
          c.od.set(e.value / 100);
          c.el.classList.toggle('is-od-ready', e.value >= 100);
        }
        break;
      }
      case 'ko': {
        const c = this.card(e.uid);
        if (c) { c.alive = false; c.el.classList.add('is-dead'); c.hp.set(0); }
        this.updateEnemyTotal();
        this.pushLog(`${this.nameOf(e.uid)} 戦闘不能`);
        break;
      }
      case 'action': {
        if (e.kind === 'od') {
          this.banner(e.name, 700);
          this.pushLog(`${this.nameOf(e.uid)} ${e.name}`);
        }
        break;
      }
      case 'promote':
        this.pushLog(`${this.nameOf(e.uid)} が${e.to === 'front' ? '前' : '後'}列へ`);
        break;
      case 'passive':
        this.pushLog(`${this.nameOf(e.uid)} 特性「${e.label}」`);
        break;
    }
  }

  private nameOf(uid: string): string {
    const f = this.player.sim.fighters.find((x) => x.uid === uid);
    return f ? f.name : '???';
  }

  private updateEnemyTotal(): void {
    let hp = 0, max = 0;
    for (const f of this.player.sim.fighters) {
      if (f.side !== 1) continue;
      hp += f.hp;
      max += f.maxHp;
    }
    this.enemyTotal.set(max > 0 ? hp / max : 0);
  }

  private tryOd(uid: string): void {
    const f = this.player.sim.fighters.find((x) => x.uid === uid);
    if (!f || !f.alive) return;
    if (f.od < 100) { audio.uiError(); this.ui.toast('OD ゲージが足りない', 'warn', 1400); return; }
    this.player.fireOd(uid);
    this.ui.toast(`${f.name} の OD を解放`, 'info', 1400);
  }

  private onOdReady(uid: string): void {
    const c = this.allyCards.find((x) => x.uid === uid);
    if (!c) return;
    c.el.classList.add('is-od-ready');
    // 触覚で知らせる。押さなくても進むので、視覚だけだと気づかれない
    navigator.vibrate?.(15);
  }

  private cycleSpeed(): void {
    audio.uiTap();
    const next: Speed = this.player.speed === 1 ? 2 : this.player.speed === 2 ? 3 : 1;
    this.player.speed = next;
    this.speedBtn.querySelector('.btn-label')!.textContent = `×${next}`;
  }

  private skip(): void {
    audio.uiTap();
    this.ui.confirm('戦闘をスキップ', '結果だけを見ます。OD の手動発動による上振れは得られません。', 'スキップ')
      .then((ok) => {
        if (!ok) return;
        while (!this.player.sim.isOver) this.player.sim.step();
        this.onEnd(this.player.sim.currentWinner);
      });
  }

  private toggleLog(): void {
    audio.uiTap();
    this.logEl.hidden = !this.logEl.hidden;
  }

  private pushLog(line: string): void {
    this.logLines.push(line);
    if (this.logLines.length > 40) this.logLines.shift();
    if (!this.logEl.hidden) this.renderLog();
  }

  private renderLog(): void {
    clear(this.logEl);
    for (const l of this.logLines.slice(-8)) {
      this.logEl.appendChild(h('div', { class: 'log-line', text: l }));
    }
    this.logEl.scrollTop = this.logEl.scrollHeight;
  }

  private banner(text: string, ms: number): void {
    this.bannerEl.textContent = text;
    this.bannerEl.classList.add('is-on');
    setTimeout(() => this.bannerEl.classList.remove('is-on'), ms);
  }

  private onEnd(winner: Side | -1): void {
    this.banner(winner === 0 ? 'VICTORY' : winner === 1 ? 'DEFEAT' : 'DRAW', 1600);
    for (const x of [...this.allyCards, ...this.enemyCards]) x.el.classList.remove('is-acting');
    setTimeout(() => this.onFinish?.(winner), 1700);
  }

  update(dt: number): void {
    this.orderTimer += dt;
    if (this.orderTimer < 0.12) return;
    this.orderTimer = 0;
    this.renderOrder();
  }

  /**
   * 行動順の予告。予測できることが面白さの源で、
   * サプライズはその予測を裏切るときにだけ効く。
   */
  private renderOrder(): void {
    const list = this.player.sim.fighters
      .filter((f) => f.alive)
      .map((f) => ({ f, t: (10000 - f.av) / Math.max(1, f.spd) }))
      .sort((a, b) => a.t - b.t)
      .slice(0, 6);

    clear(this.orderEl);
    list.forEach((it, i) => {
      const def = getRevos(it.f.defId);
      this.orderEl.appendChild(
        h('div', {
          class: `order-pip order-pip--${def.element} ${it.f.side === 0 ? 'is-ally' : 'is-foe'} ${i === 0 ? 'is-next' : ''}`,
          title: def.name,
        }, h('span', { text: def.name.slice(0, 2) })),
      );
    });
  }

  onLayout(kind: LayoutKind): void {
    this.el.dataset.layout = kind;
  }

  exit(): void {
    clear(this.ui.toastArea);
  }
}
