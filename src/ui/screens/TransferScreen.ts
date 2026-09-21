import { Screen } from '../UIRoot';
import { h, button, clear, fmtNum } from '../dom';
import type { OwnedRevos, SaveData } from '../../core/Save';
import { getRevos, revosShortName } from '../../game/data/revos';
import { cleanRank } from '../../game/battle/simulate';
import {
  TRANSFER_MIN_CLEAN, applyTransfer, canBeTarget, coresFor, quoteTransfer,
} from '../../game/transfer';
import { revosIcon } from '../revosIcon';
import { screenHead, plate, spaced } from '../chrome';
import { audio } from '../../core/Audio';

/**
 * カセキ付け替え。
 *
 * 選ぶのは2体だけ——残るほう（移す先）と、消えるほう（核）。
 * 消えるほうを選ばせる操作なので、どちらがどちらかを画面の上で
 * 取り違えられないようにする。上段に結果を先に出し、下の2つの棚は
 * 見出しと色で役目を分ける。
 *
 * 移せるのは同じ種のあいだだけなので、順番は移す先が先。核の棚は
 * 選んだ種で絞る——全部並べてから「その種には移せない」と断るのは、
 * 選ばせてから取り消すのと同じで、二度手間になる。
 *
 * 選んだ時点では何も起きない。実行の前に必ず一度確かめる——
 * 押し間違いで消える対象が、削り上げるのに1分かかったものだから。
 */
export class TransferScreen extends Screen {
  private data!: SaveData;
  private summaryEl!: HTMLElement;
  private targetEl!: HTMLElement;
  private coreEl!: HTMLElement;
  private goBtn!: HTMLButtonElement;
  private coinPlate = plate('所持', { tone: 'amber' });

  private targetUid: string | null = null;
  private coreUid: string | null = null;

  onBack?: () => void;
  /** クリーン度と手持ちが動くので、保存はゲーム側に任せる */
  onDone?: () => void;

  constructor() { super('transfer', 'unit'); }

  setData(d: SaveData): void {
    this.data = d;
    // 消えた個体を指したままにしない
    if (!d.roster.some((r) => r.uid === this.targetUid)) this.targetUid = null;
    if (!d.roster.some((r) => r.uid === this.coreUid)) this.coreUid = null;
    this.render();
  }

  build(): void {
    const head = screenHead({
      eyebrow: '付け替え', title: 'カセキ付け替え',
      onBack: () => this.onBack?.(),
      right: this.coinPlate.el,
    });
    this.summaryEl = h('div', { class: 'tr-summary' });
    this.targetEl = h('div', { class: 'tr-grid' });
    this.coreEl = h('div', { class: 'tr-grid' });
    this.goBtn = button('付け替える', () => { void this.run(); }, { class: 'btn--primary btn--wide' });

    const body = h('div', { class: 'tr-body' },
      this.summaryEl,
      h('div', { class: 'tr-label tr-label--target' },
        h('span', { text: spaced('移す先') }),
        h('span', { class: 'tr-label-note', text: 'クリーン度を受け取る。こちらは残る' }),
      ),
      this.targetEl,
      h('div', { class: 'tr-label tr-label--core' },
        h('span', { text: spaced('核') }),
        h('span', { class: 'tr-label-note', text: `同じ種・クリーン度 ${TRANSFER_MIN_CLEAN} から。こちらは失われる` }),
      ),
      this.coreEl,
    );
    this.el.append(head, body, h('div', { class: 'deck deck--mail' }, this.goBtn));
  }

  enter(): void { this.render(); }

  private render(): void {
    if (!this.data || !this.summaryEl) return;
    this.coinPlate.set(fmtNum(this.data.player.coins));

    const target = this.data.roster.find((r) => r.uid === this.targetUid);
    const core = this.data.roster.find((r) => r.uid === this.coreUid);
    const q = quoteTransfer(this.data, this.targetUid, this.coreUid);

    // ---- 上段。結果を先に出す ----
    clear(this.summaryEl);
    this.summaryEl.append(
      h('div', { class: 'tr-pair' },
        this.face(target, '移す先', 'target'),
        h('div', { class: 'tr-arrow', text: '◀' }),
        this.face(core, '核', 'core'),
      ),
      q.ok
        ? h('div', { class: 'tr-result' },
          h('div', { class: 'tr-result-row' },
            h('span', { class: 'tr-result-label', text: 'クリーン度' }),
            h('span', { class: 'num tr-from', text: String(q.from) }),
            h('span', { class: 'tr-to-mark', text: '→' }),
            h('span', { class: 'num tr-to', text: String(q.to) }),
            h('span', { class: 'tr-gain num', text: `+${q.gain}` }),
          ),
          h('div', { class: 'tr-result-row' },
            h('span', { class: 'tr-result-label', text: '費用' }),
            h('i', { class: 'wallet-dot wallet-dot--coin' }),
            h('span', { class: 'num tr-cost', text: fmtNum(q.cost) }),
            h('span', { class: 'tr-lose', text: core ? `${revosShortName(core.defId)} を失う` : '' }),
          ),
        )
        : h('div', { class: 'tr-reason', text: q.reason ?? '' }),
    );
    this.goBtn.disabled = !q.ok;

    // ---- 移す先の棚。核を1体も持たない個体は沈めて理由を出す ----
    clear(this.targetEl);
    const anyTarget = this.data.roster.some((u) => canBeTarget(this.data, u));
    if (!anyTarget) {
      this.targetEl.appendChild(h('div', { class: 'tr-empty' },
        `同じ種を2体以上持っていて、片方のクリーン度が ${TRANSFER_MIN_CLEAN}`
        + `（${cleanRank(TRANSFER_MIN_CLEAN)}ランク）以上のときに移せる。`,
      ));
    }
    for (const u of this.sorted()) {
      if (u.uid === this.coreUid) continue;
      const dead = !canBeTarget(this.data, u);
      this.targetEl.appendChild(this.cell(u, 'target', u.uid === this.targetUid, dead, () => {
        if (dead) { audio.uiError(); this.ui.toast('この個体へ移せる核がない', 'warn'); return; }
        this.targetUid = this.targetUid === u.uid ? null : u.uid;
        // 種が変われば核は持ち越せない。選び直させる前に外す
        this.coreUid = null;
        this.render();
      }));
    }

    // ---- 核の棚。移す先の種だけを並べる ----
    clear(this.coreEl);
    if (!target) {
      this.coreEl.appendChild(h('div', { class: 'tr-empty', text: '先に移す先を選ぶ。核は同じ種からしか選べない。' }));
      return;
    }
    const cores = coresFor(this.data, target).sort((a, b) => b.clean - a.clean);
    if (cores.length === 0) {
      this.coreEl.appendChild(h('div', { class: 'tr-empty' },
        `${revosShortName(target.defId)} の核がない。`
        + `同じ種を、いまより高いクリーン度で削り上げると並ぶ。`,
      ));
      return;
    }
    for (const u of cores) {
      this.coreEl.appendChild(this.cell(u, 'core', u.uid === this.coreUid, false, () => {
        this.coreUid = this.coreUid === u.uid ? null : u.uid;
        this.render();
      }));
    }
  }

  /** クリーン度の高い順。どちらの棚でも「良い石」を先に見せる */
  private sorted(): OwnedRevos[] {
    return this.data.roster.slice().sort((a, b) => b.clean - a.clean || a.obtainedAt - b.obtainedAt);
  }

  private face(u: OwnedRevos | undefined, label: string, kind: 'target' | 'core'): HTMLElement {
    const box = h('div', { class: `tr-face tr-face--${kind} ${u ? '' : 'is-empty'}` });
    box.append(h('div', { class: 'tr-face-label', text: spaced(label) }));
    if (u) {
      const d = getRevos(u.defId);
      box.append(
        revosIcon(u.defId, 'tr-face-img'),
        h('div', { class: 'tr-face-name', text: revosShortName(d.id) }),
        h('div', { class: 'tr-face-sub num', text: `${cleanRank(u.clean)} ${u.clean} · Lv${u.level}` }),
      );
    } else {
      box.append(h('div', { class: 'tr-face-hole', text: '未選択' }));
    }
    return box;
  }

  private cell(
    u: OwnedRevos, kind: 'target' | 'core', on: boolean, off: boolean, tap: () => void,
  ): HTMLElement {
    const d = getRevos(u.defId);
    const rank = cleanRank(u.clean);
    const cell = button('', () => { if (!off) audio.uiTap(); tap(); }, {
      class: `tr-cell tr-cell--${kind} ${on ? 'is-on' : ''} ${off ? 'is-off' : ''}`,
    });
    cell.append(
      revosIcon(u.defId, 'tr-cell-img'),
      h('span', { class: 'tr-cell-name', text: revosShortName(d.id) }),
      h('span', { class: `tr-cell-rank tr-rank--${rank} num`, text: `${rank} ${u.clean}` }),
      h('span', { class: 'tr-cell-lv num', text: `Lv${u.level}` }),
    );
    return cell;
  }

  private async run(): Promise<void> {
    const target = this.data.roster.find((r) => r.uid === this.targetUid);
    const core = this.data.roster.find((r) => r.uid === this.coreUid);
    const q = quoteTransfer(this.data, this.targetUid, this.coreUid);
    if (!target || !core || !q.ok) { audio.uiError(); return; }

    const ok = await this.ui.confirm(
      'カセキ付け替え',
      `${revosShortName(core.defId)}（${cleanRank(core.clean)} ${core.clean}）を核にして、`
      + `${revosShortName(target.defId)} のクリーン度を ${q.from} → ${q.to} にする。`
      + `核にした化石は失われ、コインを ${fmtNum(q.cost)} 使う。`,
      '付け替える', true,
    );
    if (!ok) return;

    const done = applyTransfer(this.data, target.uid, core.uid);
    if (!done.ok) { audio.uiError(); this.ui.toast(done.reason ?? '付け替えられない', 'warn'); return; }
    audio.reward(2);
    this.coreUid = null;
    this.ui.toast(`${revosShortName(target.defId)} のクリーン度が ${done.to}（${cleanRank(done.to)}）になった`, 'info', 3000);
    this.onDone?.();
    this.render();
  }
}
