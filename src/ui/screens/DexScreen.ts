import { Screen } from '../UIRoot';
import { h, button, clear } from '../dom';
import { revosShortName } from '../../game/data/revos';
import { KIT_TRAIT, KIT_TRAITS, type KitTraitId } from '../../game/data/traits';
import { RUN_UNITS } from '../../game/run/units';
import { unitValues, unitCooldown, shopUnit, fmt, EFFECT_GLYPH } from '../../game/run/describe';
import { revosIcon } from '../revosIcon';
import { ExpandCard } from '../expandCard';
import { unitSheet } from '../unitSheet';
import { screenHead, plate } from '../chrome';
import { audio } from '../../core/Audio';

/**
 * 図鑑。
 *
 * ランに出る全ユニットを、段と系統で絞って並べる。押すと店と同じ中身
 * （強化後の数値・効果の範囲・能力）がポップアップで開く。店で迷ったときに、
 * ラン の外で落ち着いて読める場所。
 */
export class DexScreen extends Screen {
  private tier = 0;
  private trait: KitTraitId | '' = '';
  private filterEl!: HTMLElement;
  private gridEl!: HTMLElement;
  private body!: HTMLElement;
  private xcard!: ExpandCard;
  private cards = new Map<string, HTMLElement>();
  private open: string | null = null;
  private countPlate = plate('収録', { tone: 'amber' });

  constructor() { super('dex', 'dex'); }

  build(): void {
    const head = screenHead({ eyebrow: 'ユニット', title: '図鑑', right: this.countPlate.el });
    this.filterEl = h('div', { class: 'dex-filters' });
    this.gridEl = h('div', { class: 'dex-grid' });
    this.body = h('div', { class: 'dex-body' }, this.filterEl, this.gridEl);
    this.el.append(head, this.body);
    this.xcard = new ExpandCard(this.el);
    this.xcard.onDismiss = () => this.close();
  }

  enter(): void { this.render(); }

  /** 絞り込みの帯は払って隣の面へ行かせない（横に流して選ぶ帯なので） */
  private render(): void {
    if (!this.gridEl) return;
    this.countPlate.set(String(RUN_UNITS.length));
    clear(this.filterEl);
    const chip = (label: string, on: boolean, tap: () => void): HTMLElement =>
      button(label, () => { audio.uiTap(); tap(); this.render(); }, { class: `dex-chip ${on ? 'is-on' : ''}` });
    const tiers = h('div', { class: 'dex-chips' },
      chip('全段', this.tier === 0, () => { this.tier = 0; }),
      ...[1, 2, 3, 4, 5].map((t) => chip(`段${t}`, this.tier === t, () => { this.tier = t; })),
    );
    const traits = h('div', { class: 'dex-chips' },
      chip('全系統', this.trait === '', () => { this.trait = ''; }),
      ...(Object.keys(KIT_TRAITS) as KitTraitId[]).map((k) => chip(KIT_TRAITS[k].name, this.trait === k, () => { this.trait = k; })),
    );
    traits.dataset.noSwipe = '';
    tiers.dataset.noSwipe = '';
    this.filterEl.append(tiers, traits);

    clear(this.gridEl);
    this.cards.clear();
    const list = RUN_UNITS
      .filter((u) => (this.tier === 0 || u.tier === this.tier) && (!this.trait || KIT_TRAIT[u.id] === this.trait))
      .sort((a, b) => a.tier - b.tier || (KIT_TRAIT[a.id] ?? '').localeCompare(KIT_TRAIT[b.id] ?? ''));
    if (list.length === 0) this.gridEl.appendChild(h('div', { class: 'run-hint', text: 'この組み合わせのユニットはいない。' }));
    for (const d of list) {
      const u = shopUnit(d.id);
      const vals = h('span', { class: 'run-vals' });
      for (const v of unitValues(u)) vals.appendChild(h('span', { class: `run-val run-val--${v.kind}` }, h('i', { text: EFFECT_GLYPH[v.kind] }), fmt(v.value)));
      const kit = KIT_TRAIT[d.id];
      const card = button('', () => this.show(d.id), { class: 'dex-card' });
      card.append(
        h('span', { class: 'dex-top' },
          h('span', { class: `run-tier tier-${d.tier}`, text: String(d.tier) }),
          kit ? h('span', { class: 'dex-kit', text: KIT_TRAITS[kit].name }) : '',
        ),
        revosIcon(d.id, 'dex-icon'),
        h('span', { class: 'run-name', text: revosShortName(d.id) }),
        h('span', { class: 'run-cd num', text: `${fmt(unitCooldown(u))}秒` }),
        vals,
      );
      this.cards.set(d.id, card);
      this.gridEl.appendChild(card);
    }
  }

  private show(id: string): void {
    audio.uiTap();
    const from = this.cards.get(id);
    if (!from) return;
    this.open = id;
    const close = button('✕', () => { audio.uiBack(); this.close(); }, { class: 'btn--sm btn--opt xs-close' });
    this.xcard.show(`dex:${id}`, from, unitSheet(shopUnit(id), { slot: null, corner: close }), true);
  }

  private close(): void {
    this.xcard.hide(this.open ? this.cards.get(this.open) : null);
    this.open = null;
  }
}
