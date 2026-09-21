import { Screen } from '../UIRoot';
import { h, button, clear } from '../dom';
import type { OwnedRevos } from '../../core/Save';
import { getRevos, revosShortName } from '../../game/data/revos';
import { cleanRank } from '../../game/battle/simulate';
import { ENGRAVE_STAT_NAMES, engraveLines, engraveName, type Engraving } from '../../game/engraving';
import { revosIcon } from '../revosIcon';
import { screenHead, plate, spaced } from '../chrome';
import { audio } from '../../core/Audio';

export interface CleanChoiceParams {
  defId: string;
  clean: number;
  engraving?: Engraving;
  /** すでに持っている同種の個体。1体以上あるときだけこの画面が出る */
  owned: OwnedRevos[];
  /** 既存の個体に重ねる。刻印を受け取るかは別に決める */
  onMerge: (targetUid: string, takeEngraving: boolean) => void;
  /** 別の個体として迎える */
  onKeep: () => void;
}

/**
 * 精錬の後始末。
 *
 * 削り上げた化石が、すでに持っている種だったときに出る。
 * 以前は問答無用で先に持っている個体へ吸わせ、クリーン度は高いほうを
 * 黙って採っていた。だが「上書きされると困る」場合がある——刻印を
 * 持っている個体に、刻印の無い石を重ねたくはない。
 *
 * 決めることは2つある。どの個体に重ねるか、刻印を付け替えるか。
 * どちらも選ばないという道（別個体として迎える）を、同じ面に並べる。
 */
export class CleanChoiceScreen extends Screen {
  private p: CleanChoiceParams | null = null;
  private targetUid: string | null = null;
  private takeEngraving = true;

  private fossilEl!: HTMLElement;
  private listEl!: HTMLElement;
  private swapEl!: HTMLElement;
  private mergeBtn!: HTMLButtonElement;
  private rankPlate = plate('クリーン度', { tone: 'amber' });

  constructor() { super('cleanChoice'); }

  build(): void {
    const head = screenHead({ eyebrow: '精錬完了', title: '削り上がった', right: this.rankPlate.el });
    this.fossilEl = h('div', { class: 'cc-fossil' });
    this.listEl = h('div', { class: 'cc-list' });
    this.swapEl = h('div', { class: 'cc-swap' });
    this.mergeBtn = button('この個体に重ねる', () => this.merge(), { class: 'btn--primary btn--wide' });

    const body = h('div', { class: 'cc-body' },
      this.fossilEl,
      h('div', { class: 'cc-label' },
        h('span', { text: spaced('重ねる先') }),
        h('span', { class: 'cc-label-note', text: 'クリーン度は高いほうが残る。技Lvが1つ上がる' }),
      ),
      this.listEl,
      this.swapEl,
    );
    const deck = h('div', { class: 'deck deck--cc' },
      button('別の個体として迎える', () => {
        audio.uiConfirm();
        this.p?.onKeep();
      }, { class: 'btn--wide cc-keep' }),
      this.mergeBtn,
    );
    this.el.append(head, body, deck);
  }

  enter(params?: unknown): void {
    const p = params as CleanChoiceParams | undefined;
    if (!p) return;
    this.p = p;
    // 既定はいちばんクリーン度の低い個体。上げ幅がいちばん大きい先を先に出す
    this.targetUid = p.owned.slice().sort((a, b) => a.clean - b.clean)[0]?.uid ?? null;
    this.takeEngraving = true;
    this.render();
  }

  private render(): void {
    const p = this.p;
    if (!p || !this.fossilEl) return;
    const def = getRevos(p.defId);
    this.rankPlate.set(String(p.clean), cleanRank(p.clean));

    // ---- 削り上がった化石 ----
    clear(this.fossilEl);
    this.fossilEl.append(
      revosIcon(p.defId, 'cc-fossil-img'),
      h('div', { class: 'cc-fossil-main' },
        h('div', { class: 'cc-fossil-name', text: def.name }),
        h('div', { class: 'cc-fossil-sub num', text: `${'★'.repeat(def.rarity)} · ${cleanRank(p.clean)} ${p.clean}` }),
        p.engraving
          ? engraveChip(p.engraving, 'is-new')
          : h('div', { class: 'cc-noeng', text: '刻印は出なかった' }),
      ),
    );

    // ---- 重ねる先 ----
    clear(this.listEl);
    for (const u of p.owned.slice().sort((a, b) => a.clean - b.clean)) {
      const on = u.uid === this.targetUid;
      const gain = Math.max(0, p.clean - u.clean);
      const row = button('', () => {
        audio.uiTap();
        this.targetUid = u.uid;
        this.render();
      }, { class: `cc-row ${on ? 'is-on' : ''}` });
      row.append(
        revosIcon(u.defId, 'cc-row-img'),
        h('span', { class: 'cc-row-main' },
          h('span', { class: 'cc-row-head' },
            h('span', { class: 'cc-row-name', text: revosShortName(u.defId) }),
            h('span', { class: 'cc-row-lv num', text: `Lv${u.level} · 技Lv${u.skillLevel}` }),
          ),
          h('span', { class: 'cc-row-line' },
            h('span', { class: 'cc-row-label', text: 'クリーン度' }),
            h('span', { class: 'num cc-row-from', text: String(u.clean) }),
            gain > 0 ? h('span', { class: 'cc-row-mark', text: '→' }) : null,
            gain > 0 ? h('span', { class: 'num cc-row-to', text: String(p.clean) }) : null,
            gain > 0
              ? h('span', { class: 'num cc-row-gain', text: `+${gain}` })
              : h('span', { class: 'cc-row-hold', text: 'このまま（下がらない）' }),
          ),
          h('span', { class: 'cc-row-line' },
            h('span', { class: 'cc-row-label', text: '刻印' }),
            u.engraving
              ? engraveChip(u.engraving, 'is-cur')
              : h('span', { class: 'cc-row-none', text: 'なし' }),
          ),
        ),
      );
      this.listEl.appendChild(row);
    }

    // ---- 刻印を付け替えるか ----
    // 選ぶ意味があるのは、両方が刻印を持っているときだけ。
    // 片方しか無ければ答えは決まっているので、問いを出さない
    const target = p.owned.find((u) => u.uid === this.targetUid);
    clear(this.swapEl);
    if (p.engraving && target?.engraving) {
      this.swapEl.append(
        h('div', { class: 'cc-label' },
          h('span', { text: spaced('刻印') }),
          h('span', { class: 'cc-label-note', text: '付け替えると、いまの刻印は失われる' }),
        ),
        h('div', { class: 'cc-swap-opts' },
          this.swapOpt('付け替える', p.engraving, true),
          this.swapOpt('いまのを残す', target.engraving, false),
        ),
      );
    } else if (p.engraving && target) {
      this.takeEngraving = true;
      this.swapEl.appendChild(h('div', { class: 'cc-swap-note' },
        `重ねると ${engraveName(p.engraving)} が付く。`,
      ));
    }

    this.mergeBtn.disabled = !this.targetUid;
  }

  private swapOpt(label: string, e: Engraving, take: boolean): HTMLElement {
    const on = this.takeEngraving === take;
    const b = button('', () => {
      audio.uiTap();
      this.takeEngraving = take;
      this.render();
    }, { class: `cc-swap-opt ${on ? 'is-on' : ''}` });
    b.append(
      h('span', { class: 'cc-swap-label', text: label }),
      engraveChip(e, take ? 'is-new' : 'is-cur'),
    );
    return b;
  }

  private merge(): void {
    if (!this.p || !this.targetUid) { audio.uiError(); return; }
    audio.uiConfirm();
    this.p.onMerge(this.targetUid, this.takeEngraving);
  }
}

/** 刻印の札。銘・等級・加算を1つの塊で出す */
export function engraveChip(e: Engraving, tone = ''): HTMLElement {
  const chip = h('span', { class: `eng-chip ${tone}` },
    h('span', { class: `eng-mark eng-mark--g${e.grade}`, text: engraveName(e).slice(0, 1) }),
    h('span', { class: 'eng-grade num', text: `☆${e.grade}` }),
  );
  for (const l of engraveLines(e)) {
    chip.appendChild(h('span', { class: 'eng-stat' },
      ENGRAVE_STAT_NAMES[l.stat],
      h('span', { class: 'num eng-val', text: `+${l.value}` }),
    ));
  }
  return chip;
}
