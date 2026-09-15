import { Screen } from '../UIRoot';
import { h, button, bar, clear } from '../dom';
import type { SaveData, OwnedRevos } from '../../core/Save';
import { getRevos, revosShortName } from '../../game/data/revos';
import { FORMATIONS, TARGET_PREFS, type FormationId, type TargetPref } from '../../game/battle/types';
import { ELEMENT_NAMES } from '../../voxel/palette';
import { cleanMultiplier, cleanRank } from '../../game/battle/simulate';
import { revosIcon } from '../revosIcon';
import { audio } from '../../core/Audio';

/**
 * 編成。
 *
 * スマホでドラッグ＆ドロップは使わない。掴んだ指の下にドロップ先が隠れ、
 * スクロールと競合し、長押し判定の遅延が乗る。タップ→タップで置く。
 * 合計値はスロットのすぐ下に置く——編成の目的は数値の最適化なので、
 * 結果が指の届く距離に見えていないと試行錯誤が成立しない。
 */
export class PartyScreen extends Screen {
  private data!: SaveData;
  private slotsEl!: HTMLElement;
  private rosterEl!: HTMLElement;
  private totalEl!: HTMLElement;
  private formEl!: HTMLElement;
  private tacticEl!: HTMLElement;
  private order: (string | null)[] = [null, null, null];
  private formation: FormationId = 'wedge';
  private prefs: TargetPref[] = ['front', 'front', 'front'];
  private selected: string | null = null;

  onBack?: () => void;
  onApply?: (order: [string, string, string], formation: FormationId, prefs: TargetPref[]) => void;

  constructor() { super('party'); }

  setData(d: SaveData): void {
    this.data = d;
    this.formation = d.party.formation;
    const savedPrefs = d.party.targetPrefs ?? [];
    const saved = d.party.order;
    this.order = [0, 1, 2].map((i) => {
      const uid = saved?.[i];
      return uid && d.roster.some((r) => r.uid === uid) ? uid : null;
    });
    // 未設定なら手持ちの先頭から埋める
    for (const r of d.roster) {
      if (this.order.includes(r.uid)) continue;
      const empty = this.order.indexOf(null);
      if (empty < 0) break;
      this.order[empty] = r.uid;
    }
    // 未保存のスロットは、そのリヴォスの推奨作戦から始める
    this.prefs = [0, 1, 2].map((i) => {
      if (savedPrefs[i]) return savedPrefs[i];
      const u = this.unitOf(this.order[i]);
      return u ? getRevos(u.defId).defaultPref : 'front';
    });
    this.render();
  }

  build(): void {
    const strip = h('div', { class: 'status-strip' },
      button('‹', () => { audio.uiBack(); this.onBack?.(); }, { class: 'btn--sm btn--ghost' }),
      h('div', { class: 'screen-title', text: '編成' }),
    );

    this.slotsEl = h('div', { class: 'party-field' });
    this.totalEl = h('div', { class: 'party-total' });
    this.formEl = h('div', { class: 'party-forms' });
    this.tacticEl = h('div', { class: 'party-tactics' });
    this.rosterEl = h('div', { class: 'party-roster' });

    const body = h('div', { class: 'party-body' },
      this.slotsEl,
      this.totalEl,
      h('div', { class: 'label party-label', text: '陣形' }),
      this.formEl,
      h('div', { class: 'label party-label', text: '作戦' }),
      this.tacticEl,
      h('div', { class: 'label party-label', text: '手持ち' }),
      this.rosterEl,
    );

    const deck = h('div', { class: 'deck deck--party' },
      button('決定', () => this.apply(), { class: 'btn--primary btn--wide' }),
    );

    this.el.append(strip, body, deck);
  }

  enter(): void { this.render(); }

  private unitOf(uid: string | null): OwnedRevos | undefined {
    return uid ? this.data.roster.find((r) => r.uid === uid) : undefined;
  }

  private render(): void {
    if (!this.data || !this.slotsEl) return;

    // ---- スロット ----
    clear(this.slotsEl);
    const labels = ['前列', '後列', '後列'];
    this.order.forEach((uid, i) => {
      const u = this.unitOf(uid);
      const slot = button(
        '',
        () => this.tapSlot(i),
        { class: `party-slot ${u ? '' : 'is-empty'} ${i === 0 ? 'is-front' : ''}` },
      );
      slot.append(h('span', { class: 'slot-label', text: labels[i] }));
      if (u) {
        const def = getRevos(u.defId);
        const mc = cleanMultiplier(u.clean);
        slot.append(
          revosIcon(u.defId, 'slot-icon'),
          h('span', { class: `chip chip--${def.element}`, text: ELEMENT_NAMES[def.element] }),
          h('span', { class: 'slot-name', text: revosShortName(def.id) }),
          h('span', { class: 'slot-sub num', text: `Lv${u.level} / ${cleanRank(u.clean)}ランク` }),
          h('span', { class: 'slot-sub num', text: `ATK ${Math.round(def.atk * mc * (1 + 0.055 * (u.level - 1)))}` }),
        );
      } else {
        slot.append(h('span', { class: 'slot-empty', text: '＋' }));
      }
      this.slotsEl.appendChild(slot);
    });

    // ---- 合計 ----
    let atk = 0, def = 0, hp = 0;
    const elems = new Map<string, number>();
    for (const uid of this.order) {
      const u = this.unitOf(uid);
      if (!u) continue;
      const d = getRevos(u.defId);
      const ls = 1 + 0.055 * (u.level - 1);
      const mc = cleanMultiplier(u.clean);
      atk += Math.round(d.atk * ls * mc);
      def += Math.round(d.def * ls * mc);
      hp += Math.round(d.hp * ls * mc);
      elems.set(d.element, (elems.get(d.element) ?? 0) + 1);
    }
    clear(this.totalEl);
    this.totalEl.append(
      h('span', { class: 'num', text: `HP ${hp}` }),
      h('span', { class: 'num', text: `ATK ${atk}` }),
      h('span', { class: 'num', text: `DEF ${def}` }),
      h('span', { class: 'total-elems', text: [...elems].map(([e, n]) => `${ELEMENT_NAMES[e as never]}×${n}`).join(' ') }),
    );

    // ---- 作戦 ----
    // 誰を狙うかはスロットごとに決める。編成とセットで意味が出る決定なので、
    // 別画面には切らず、スロットのすぐ下に置く。
    clear(this.tacticEl);
    this.order.forEach((uid, i) => {
      const u = this.unitOf(uid);
      const row = h('div', { class: 'tactic-row' });
      const head = h('div', { class: 'tactic-head' });
      if (u) {
        head.append(revosIcon(u.defId, 'tactic-icon'), h('span', { class: 'tactic-name', text: revosShortName(u.defId) }));
      } else {
        head.append(h('span', { class: 'tactic-name dim', text: `スロット${i + 1}` }));
      }
      const opts = h('div', { class: 'tactic-opts' });
      for (const t of TARGET_PREFS) {
        const on = this.prefs[i] === t.id;
        const b = button(t.name.replace('優先', ''), () => {
          audio.uiTap();
          this.prefs[i] = t.id;
          this.render();
        }, { class: `btn--sm tactic-btn ${on ? 'is-on' : ''}` });
        b.title = t.desc;
        b.disabled = !u;
        opts.appendChild(b);
      }
      const cur = TARGET_PREFS.find((t) => t.id === this.prefs[i]);
      row.append(head, opts, h('span', { class: 'tactic-desc', text: cur?.desc ?? '' }));
      this.tacticEl.appendChild(row);
    });

    // ---- 陣形 ----
    clear(this.formEl);
    for (const f of Object.values(FORMATIONS)) {
      const b = button(f.name, () => { audio.uiTap(); this.formation = f.id; this.render(); }, {
        class: `btn--sm form-btn ${this.formation === f.id ? 'is-on' : ''}`,
        sub: f.desc,
      });
      this.formEl.appendChild(b);
    }

    // ---- 手持ち ----
    clear(this.rosterEl);
    if (this.data.roster.length === 0) {
      this.rosterEl.appendChild(h('div', { class: 'dim', text: 'まだ化石がない。発掘へ。' }));
    }
    for (const u of this.data.roster) {
      const d = getRevos(u.defId);
      const inParty = this.order.includes(u.uid);
      const card = button('', () => this.tapRoster(u.uid), {
        class: `roster-card ${inParty ? 'is-in' : ''} ${this.selected === u.uid ? 'is-sel' : ''}`,
      });
      const hpBar = bar('bar--slim', u.clean / 100);
      card.append(
        revosIcon(u.defId, 'roster-icon'),
        h('span', { class: `chip chip--${d.element}`, text: ELEMENT_NAMES[d.element] }),
        h('span', { class: 'roster-name', text: revosShortName(d.id) }),
        h('span', { class: 'roster-sub num', text: `Lv${u.level} ${cleanRank(u.clean)}` }),
        hpBar.el,
      );
      this.rosterEl.appendChild(card);
    }
  }

  private tapSlot(i: number): void {
    audio.uiTap();
    if (this.selected) {
      // 選択中のユニットを置く。既にどこかに居たら入れ替え
      const from = this.order.indexOf(this.selected);
      const prev = this.order[i];
      this.order[i] = this.selected;
      if (from >= 0) this.order[from] = prev;
      this.selected = null;
    } else if (this.order[i]) {
      // 空きスロットを作る
      this.selected = this.order[i];
      this.order[i] = null;
    }
    this.render();
  }

  private tapRoster(uid: string): void {
    audio.uiTap();
    if (this.selected === uid) { this.selected = null; this.render(); return; }
    this.selected = uid;
    // 空きがあれば即入れる。2タップを1タップに減らす
    const empty = this.order.indexOf(null);
    if (empty >= 0) {
      this.order[empty] = uid;
      this.selected = null;
    }
    this.render();
  }

  private apply(): void {
    const filled = this.order.filter((x): x is string => !!x);
    if (filled.length < Math.min(3, this.data.roster.length)) {
      audio.uiError();
      this.ui.toast('スロットを埋めてください', 'warn');
      return;
    }
    while (filled.length < 3) filled.push(filled[0]);
    audio.uiConfirm();
    this.onApply?.([filled[0], filled[1], filled[2]], this.formation, [...this.prefs]);
  }
}
