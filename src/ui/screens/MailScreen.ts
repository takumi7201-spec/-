import { Screen } from '../UIRoot';
import { h, button, clear } from '../dom';
import type { MailItem, SaveData } from '../../core/Save';
import { claimAll, claimMail, isClaimable, rewardLabel, unclaimedCount } from '../../game/mail';
import { revosIcon } from '../revosIcon';
import { screenHead, plate, spaced } from '../chrome';
import { audio } from '../../core/Audio';

/**
 * 受信箱。
 *
 * ログインボーナスと運営からの配布が、ここ1か所に届く。
 * 受け取り済みも残して薄く沈めるのは、「何をいつ貰ったか」を後から
 * 確かめられるようにするため——消すと配布の履歴ごと消える。
 */
export class MailScreen extends Screen {
  private data!: SaveData;
  private listEl!: HTMLElement;
  private allBtn!: HTMLButtonElement;
  private countPlate = plate('未受取', { tone: 'amber' });

  onBack?: () => void;
  /** 受け取りで所持品が変わるので、保存はゲーム側に任せる */
  onClaim?: () => void;

  constructor() { super('mail'); }

  setData(d: SaveData): void { this.data = d; this.render(); }

  build(): void {
    const head = screenHead({
      eyebrow: '受信箱', title: 'メール',
      onBack: () => this.onBack?.(),
      right: this.countPlate.el,
    });
    this.listEl = h('div', { class: 'mail-body' });
    this.allBtn = button('すべて受け取る', () => this.claimAll(), { class: 'btn--primary btn--wide' });
    const deck = h('div', { class: 'deck deck--mail' }, this.allBtn);
    this.el.append(head, this.listEl, deck);
  }

  enter(): void { this.render(); }

  private render(): void {
    if (!this.data || !this.listEl) return;
    const left = unclaimedCount(this.data);
    this.countPlate.set(String(left));
    this.allBtn.disabled = left === 0;

    clear(this.listEl);
    if (this.data.mail.length === 0) {
      this.listEl.append(
        h('div', { class: 'mail-empty' },
          h('div', { class: 'mail-empty-line', text: '受信箱は空だ。' }),
          h('div', { class: 'mail-empty-line dim', text: '日をまたぐとログインボーナスが届く。' }),
        ),
      );
      return;
    }
    for (const m of this.data.mail) this.listEl.appendChild(this.card(m));
  }

  private card(m: MailItem): HTMLElement {
    const open = isClaimable(m);
    const card = h('div', { class: `mail-card ${open ? '' : 'is-claimed'} mail-card--${m.from}` });

    card.append(
      h('div', { class: 'mail-head' },
        h('span', { class: `mail-from mail-from--${m.from}`, text: spaced(m.from === 'staff' ? '運営' : 'ログイン') }),
        h('span', { class: 'mail-date num', text: dateLabel(m.sentAt) }),
      ),
      h('div', { class: 'mail-title', text: m.title }),
      h('p', { class: 'mail-desc', text: m.body }),
      h('div', { class: 'mail-rewards' },
        ...m.rewards.map((r) => h('div', { class: `mail-reward mail-reward--${r.kind}` },
          r.kind === 'fossil'
            ? revosIcon(r.defId, 'mail-reward-icon')
            : h('i', { class: 'mail-reward-coin' }),
          h('span', { class: 'mail-reward-name', text: rewardLabel(r) }),
        )),
      ),
    );

    if (open) {
      // 札ごとの受け取りは白。琥珀は下の「すべて受け取る」1つだけに残す
      card.appendChild(button('受け取る', () => this.claim(m.id), { class: 'btn--wide mail-go' }));
    } else {
      card.appendChild(h('div', { class: 'mail-done' },
        h('span', { class: 'mail-done-mark', text: '✓' }),
        h('span', { text: m.claimedAt ? `${dateLabel(m.claimedAt)} に受け取り済み` : '期限切れ' }),
      ));
    }
    return card;
  }

  private claim(id: string): void {
    const m = this.data.mail.find((x) => x.id === id);
    if (!m || !claimMail(this.data, id)) { audio.uiError(); return; }
    audio.reward(1);
    this.ui.toast(`受け取った — ${m.rewards.map(rewardLabel).join(' / ')}`, 'info', 2600);
    this.onClaim?.();
    this.render();
  }

  private claimAll(): void {
    const n = claimAll(this.data);
    if (n === 0) { audio.uiError(); return; }
    audio.reward(2);
    this.ui.toast(`${n} 通ぶん受け取った`, 'info', 2600);
    this.onClaim?.();
    this.render();
  }
}

function dateLabel(at: number): string {
  const d = new Date(at);
  return `${d.getMonth() + 1}/${d.getDate()}`;
}
