import { Screen, type LayoutKind } from '../UIRoot';
import { h, button, bar, clear } from '../dom';
import type { BattlePlayer, Speed } from '../../game/battle/BattlePlayer';
import type { BattleEvent, Fighter, Side } from '../../game/battle/types';
import { getRevos, revosShortName } from '../../game/data/revos';
import { ELEMENT_NAMES } from '../../voxel/palette';
import { audio } from '../../core/Audio';
import { revosIcon } from '../revosIcon';
import { spriteUrl } from '../../fx/SpriteUnit';

interface UnitCard {
  uid: string;
  el: HTMLElement;
  hp: ReturnType<typeof bar>;
  od: ReturnType<typeof bar>;
  hpText: HTMLElement;
  odBtn?: HTMLButtonElement;
  alive: boolean;
  maxHp: number;
  /** 画面に出ている OD 値。判定は見えているほうに合わせる */
  odValue: number;
  /** アイコンの外枠。クールタイムのリングとスイープを持つ */
  icon: HTMLElement;
  /** 表示中の充填率。シミュレータの離散更新を補間してなめらかに見せる */
  cd: number;
  cdReady: boolean;
  /** 属性の隣に出す状態異常の枠 */
  status: HTMLElement;
  /** いま出している状態。毎フレーム作り直さないための控え */
  statusKey: string;
}

/**
 * 状態異常の札。
 *
 * 属性チップの隣に置く。名前ではなく絵で出すのは、カードが視野の端でしか
 * 読まれないから——端で読めるのは色と形だけで、2文字の熟語は読めない。
 */
function statusIcon(kind: 'burn' | 'poison'): HTMLElement {
  // 画像は CSS の url() ではなく img で置く。public/ の絶対パスは
  // サイトの根から解決されるので、下の階層に載せたときに全部落ちる——
  // スプライトの在処は spriteUrl() 1か所に寄せる
  const img = document.createElement('img');
  img.className = 'card-status-img';
  img.src = spriteUrl(kind === 'burn' ? 'fx-burn' : 'fx-poison');
  img.alt = kind === 'burn' ? '火傷' : '毒';
  img.decoding = 'async';
  return h('span', { class: `card-status-icon card-status-icon--${kind}` }, img);
}

/**
 * クールタイム表示つきのアイコン。
 *
 * 数字ではなくリングで出す。オートバトルの視線はフィールドに置かれていて、
 * カードは視野の端でしか読まれない——端で読めるのは色と角度だけ。
 */
function unitIcon(defId: string, foe: boolean): HTMLElement {
  const wrap = h('div', { class: `unit-icon${foe ? ' unit-icon--foe' : ''}` });
  wrap.style.setProperty('--cd', '0');
  wrap.append(
    revosIcon(defId),
    h('i', { class: 'unit-cd' }),
    h('i', { class: 'unit-cd-ring' }),
  );
  return wrap;
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
  private logEl!: HTMLElement;
  private logLines: string[] = [];
  private speedBtn!: HTMLButtonElement;
  private roundEl!: HTMLElement;
  private bannerEl!: HTMLElement;
  /**
   * 決着を一度だけ通す。スキップは sim を直接回して決着させるので、
   * その後で再生側も終端に達し、onEnd が2回飛ぶ。2回目は「通常戦の勝利」
   * として処理され、ステージも報酬も二重に入る
   */
  private ended = false;

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
    const enemyStrip = h('div', { class: 'battle-enemy' },
      h('div', { class: 'battle-enemy-head' },
        h('span', { class: 'label enemy-tag' }, h('span', { text: '敵' })),
        this.enemyTotal.el,
        (this.roundEl = h('span', { class: 'num round', text: '0:00' })),
      ),
      h('div', { class: 'enemy-cards' }),
    );

    // ---- 中央バナー（開始・決着）----
    this.bannerEl = h('div', { class: 'battle-banner' });

    // ---- 下: 味方 + 操作 ----
    const allyRow = h('div', { class: 'ally-cards' });
    this.logEl = h('div', { class: 'battle-log', hidden: true });

    this.speedBtn = button('×1', () => this.cycleSpeed(), { class: 'btn--sm btn--speed' });

    const deck = h('div', { class: 'deck deck--battle' },
      h('div', { class: 'battle-deck-inner' },
        this.logEl,
        allyRow,
        h('div', { class: 'battle-controls' },
          button('記録', () => this.toggleLog(), { class: 'btn--sm btn--ghost btn--log' }),
          this.speedBtn,
          button('早送り', () => this.skip(), { class: 'btn--sm btn--ghost btn--skip' }),
        ),
      ),
    );

    this.el.append(enemyStrip, this.bannerEl, deck);
    this.allyRow = allyRow;
    this.enemyRow = enemyStrip.querySelector('.enemy-cards') as HTMLElement;
  }

  private allyRow!: HTMLElement;
  private enemyRow!: HTMLElement;

  enter(): void {
    this.ended = false;
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
    const foes = this.player.sim.fighters.filter((f) => f.side === 1).length;
    const mine = this.player.sim.fighters.filter((f) => f.side === 0).length;
    this.enemyRow.classList.toggle('is-solo', foes === 1);
    // 4体以上は札を詰める。名前と帯を残し、飾りの文字を落とす
    this.enemyRow.classList.toggle('is-many', foes > 3);
    this.allyRow.classList.toggle('is-many', mine > 3);
    this.enemyRow.style.setProperty('--cols', String(Math.max(1, foes)));
    this.allyRow.style.setProperty('--cols', String(Math.max(1, mine)));

    for (const f of this.player.sim.fighters) {
      const def = getRevos(f.defId);
      const hp = bar('bar--hp', 1);
      const od = bar('bar--od bar--slim', f.od / 100);
      const hpText = h('span', { class: 'num card-hp', text: `${f.hp}` });

      const icon = unitIcon(f.defId, f.side === 1);

      if (f.side === 0) {
        // 自軍カードは OD ボタンを兼ねる。介入点をここ1箇所に集約する
        const btn = button('', () => this.tryOd(f.uid), { class: 'ally-card' });
        // 名前は1行まるごと使う。アイコンの横に置くと3列では必ず省略が出る
        const status = h('span', { class: 'card-status' });
        btn.append(
          h('div', { class: 'card-top' },
            icon,
            h('span', { class: `chip chip--${def.element}`, text: ELEMENT_NAMES[def.element] }),
            status,
          ),
          h('span', { class: 'card-name', text: revosShortName(def.id) }),
          hp.el,
          h('div', { class: 'card-row' }, hpText, h('span', { class: 'card-od-label', text: '必殺' }), od.el),
        );
        this.allyRow.appendChild(btn);
        this.allyCards.push({ uid: f.uid, el: btn, hp, od, hpText, odBtn: btn, alive: true, maxHp: f.maxHp, odValue: f.od, icon, cd: 0, cdReady: false, status, statusKey: '' });
      } else {
        const status = h('span', { class: 'card-status' });
        const el = h('div', { class: 'enemy-card' },
          h('div', { class: 'card-top' },
            icon,
            h('span', { class: `chip chip--${def.element}`, text: ELEMENT_NAMES[def.element] }),
            status,
          ),
          h('span', { class: 'card-name', text: revosShortName(def.id) }),
          hp.el,
        );
        this.enemyRow.appendChild(el);
        this.enemyCards.push({ uid: f.uid, el, hp, od, hpText, alive: true, maxHp: f.maxHp, odValue: f.od, icon, cd: 0, cdReady: false, status, statusKey: '' });
      }
    }
  }

  private card(uid: string): UnitCard | undefined {
    return this.allyCards.find((c) => c.uid === uid) ?? this.enemyCards.find((c) => c.uid === uid);
  }

  private onEvent(e: BattleEvent): void {
    switch (e.t) {
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
          c.odValue = e.value;
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
        // 全員が同時に動くので、動いた札を一瞬だけ光らせる。
        // 「いま誰の番か」ではなく「いま誰が殴ったか」を示す
        const c = this.card(e.uid);
        if (c) {
          c.el.classList.add('is-acting');
          setTimeout(() => c.el.classList.remove('is-acting'), 380);
        }
        if (e.kind === 'od') {
          this.banner(e.name, 700);
          this.pushLog(`${this.nameOf(e.uid)} ${e.name}`);
        }
        break;
      }
      case 'pull':
        this.pushLog(`${this.nameOf(e.by)} が ${this.nameOf(e.uid)} を引きずり出した`);
        break;
      case 'leap':
        this.pushLog(`${this.nameOf(e.uid)} が跳んだ`);
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

    // 判定は「見えている値」で行う。シミュレータは再生より先に進んでいるので、
    // 光っているカードを押したのに「足りない」と言われることがあった
    const c = this.allyCards.find((x) => x.uid === uid);
    const shown = c ? c.odValue : f.od;
    if (shown < 100) { audio.uiError(); this.ui.toast('OD ゲージが足りない', 'warn', 1400); return; }
    // 見た目は満ちているが、シミュレータ側ではもう撃たれている。
    // 咎めずに受け流す——この直後に必殺技の演出が出る
    if (f.od < 100) return;

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
        // 再生側も止める。止めないと、このあと再生が終端に達して
        // もう一度 onEnd が飛ぶ
        this.player.finished = true;
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
    if (this.ended) return;
    this.ended = true;
    const timeUp = this.player.sim.hasLimit && this.player.sim.result().timeUp;
    this.banner(winner === 0 ? 'VICTORY' : winner === 1 ? 'DEFEAT' : timeUp ? 'TIME UP' : 'DRAW', 1600);
    for (const x of [...this.allyCards, ...this.enemyCards]) x.el.classList.remove('is-acting');
    setTimeout(() => this.onFinish?.(winner), 1700);
  }

  update(dt: number): void {
    this.updateCooldowns(dt);
    // 経過時間。手数ではなく時計で出す——全員が同時に動くので、手数は数えにくい。
    // 制限時間のある戦い（巨獣）では、残りを数える
    const sim = this.player.sim;
    const sec = sim.hasLimit ? Math.max(0, Math.ceil(sim.limit - sim.clock)) : Math.floor(sim.clock);
    this.roundEl.classList.toggle('is-low', sim.hasLimit && sec <= 10);
    const txt = `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`;
    if (this.roundEl.textContent !== txt) this.roundEl.textContent = txt;
  }

  /**
   * 攻撃間隔の可視化。
   *
   * 値はシミュレータの行動ゲージそのもの。刻みが 1/30 秒なので素で滑らかに
   * 伸びる。指数補間は、行動直後の落ち込みを角なく見せるためだけに残す。
   */
  private updateCooldowns(dt: number): void {
    const k = 1 - Math.exp(-dt * 7);
    for (const c of [...this.allyCards, ...this.enemyCards]) {
      const f = this.player.sim.fighters.find((x) => x.uid === c.uid);
      if (!f) continue;

      const target = f.alive ? this.player.displayCharge(f.uid) : 0;
      c.cd += (target - c.cd) * k;
      if (Math.abs(target - c.cd) < 0.002) c.cd = target;
      c.icon.style.setProperty('--cd', c.cd.toFixed(3));

      // OD が満ちていれば次は特殊攻撃。リングの色で予告する
      const ready = f.alive && f.od >= 100;
      if (ready !== c.cdReady) {
        c.cdReady = ready;
        c.icon.classList.toggle('is-charged', ready);
      }
      c.icon.classList.toggle('is-full', f.alive && c.cd > 0.97);
      this.updateStatus(c, f);
    }
  }

  /**
   * 属性の隣に出す状態異常。
   *
   * イベントで足し引きせず、毎フレームその個体の状態をそのまま映す——
   * 付与は status イベントで飛ぶが、切れるときは何も飛ばないので、
   * 足し算だけでは消し忘れる。
   *
   * 毒は重なる。重なった数だけ削る量が変わるので、2つ以上なら数も出す。
   */
  private updateStatus(c: UnitCard, f: Fighter): void {
    const on = f.alive ? f.statuses : [];
    const burn = on.some((s) => s.kind === 'burn');
    const poison = on.find((s) => s.kind === 'poison');
    const stack = poison ? Math.max(1, Math.round(poison.value / 0.03)) : 0;
    const key = `${burn ? 'b' : ''}${stack ? `p${stack}` : ''}`;
    if (key === c.statusKey) return;
    c.statusKey = key;

    clear(c.status);
    if (burn) c.status.appendChild(statusIcon('burn'));
    if (stack > 0) {
      const el = statusIcon('poison');
      if (stack > 1) el.appendChild(h('i', { class: 'card-status-n num', text: String(stack) }));
      c.status.appendChild(el);
    }
  }


  onLayout(kind: LayoutKind): void {
    this.el.dataset.layout = kind;
  }

  exit(): void {
    clear(this.ui.toastArea);
  }
}

