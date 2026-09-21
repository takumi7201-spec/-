import { Screen } from '../UIRoot';
import { h, button, clear } from '../dom';
import type { SaveData } from '../../core/Save';
import type { QualityTier } from '../../core/Quality';
import { screenHead, plate, spaced } from '../chrome';
import { audio } from '../../core/Audio';

export type SettingKey = 'hand' | 'audio' | 'quality' | 'battle' | 'shake';
export type SettingsWhere = 'profile' | 'title' | 'debug' | 'wipe';

/**
 * 設定。
 *
 * これまで設定はタイトルの小さなボタン1つで、押すたびに左右が入れ替わる
 * だけだった。音量も画質もバトル速度も保存には入っているのに、
 * 触る場所が無い——保存されているのに変えられない値は、無いのと同じ。
 *
 * つまみはスライダーではなく札を並べる。指ではスライダーの端が押せず、
 * 「いまどこか」も掴んでいる指で隠れる。段が5つ以下なら並べたほうが速い。
 */
export class SettingsScreen extends Screen {
  private data!: SaveData;
  private bodyEl!: HTMLElement;
  private verPlate = plate('版', { tone: 'plain' });
  onChange?: (key: SettingKey) => void;
  onGo?: (where: SettingsWhere) => void;

  constructor() { super('settings', 'settings'); }

  setData(d: SaveData): void { this.data = d; this.render(); }

  build(): void {
    const head = screenHead({ eyebrow: '環境', title: '設定', right: this.verPlate.el });
    this.bodyEl = h('div', { class: 'set-body' });
    this.el.append(head, this.bodyEl);
  }

  enter(): void { this.render(); }

  /** 値を並べて1つ選ぶ行。いま選んでいる札だけが明るい */
  private row<T>(
    label: string,
    note: string,
    options: { value: T; label: string }[],
    current: T,
    pick: (v: T) => void,
  ): HTMLElement {
    const opts = h('div', { class: 'set-opts' });
    for (const o of options) {
      const on = o.value === current;
      opts.appendChild(button(o.label, () => {
        if (on) return;
        audio.uiTap();
        pick(o.value);
        this.render();
      }, { class: `btn--sm set-opt ${on ? 'is-on' : 'btn--opt'}` }));
    }
    return h('div', { class: 'set-row' },
      h('div', { class: 'set-row-head' },
        h('span', { class: 'set-label', text: label }),
        h('span', { class: 'set-note', text: note }),
      ),
      opts,
    );
  }

  private render(): void {
    if (!this.data || !this.bodyEl) return;
    const s = this.data.settings;
    this.verPlate.set('0.1');

    clear(this.bodyEl);
    const rows: (HTMLElement | null)[] = [
      h('div', { class: 'set-group-label', text: spaced('操作') }),
      this.row('利き手', '移動をどちらの親指に置くか', [
        { value: true, label: '右で移動' },
        { value: false, label: '左で移動' },
      ], s.swapSides, (v) => { s.swapSides = v; this.onChange?.('hand'); }),

      h('div', { class: 'set-group-label', text: spaced('音') }),
      this.row('効果音', '掘る音・当たる音', VOLUMES, round2(s.sfx), (v) => { s.sfx = v; this.onChange?.('audio'); }),
      this.row('BGM', '場面ごとの曲', VOLUMES, round2(s.bgm), (v) => { s.bgm = v; this.onChange?.('audio'); }),

      h('div', { class: 'set-group-label', text: spaced('画面') }),
      this.row<QualityTier | 'auto'>('画質', '端末に合わせるか、自分で決めるか', [
        { value: 'auto', label: 'おまかせ' },
        { value: 'low', label: '軽い' },
        { value: 'medium', label: 'ふつう' },
        { value: 'high', label: '綺麗' },
      ], s.quality, (v) => { s.quality = v; this.onChange?.('quality'); }),
      this.row('画面の揺れ', '被弾や撃破でカメラを揺らす', [
        { value: false, label: 'ふつう' },
        { value: true, label: '抑える' },
      ], s.reducedShake, (v) => { s.reducedShake = v; this.onChange?.('shake'); }),

      h('div', { class: 'set-group-label', text: spaced('バトル') }),
      this.row<1 | 2 | 3>('速度', '開くたびに選び直さない', [
        { value: 1, label: '×1' },
        { value: 2, label: '×2' },
        { value: 3, label: '×3' },
      ], s.battleSpeed, (v) => { s.battleSpeed = v; this.onChange?.('battle'); }),
      this.row('必殺技', '溜まったら自動で撃つか、自分で押すか', [
        { value: true, label: '自動' },
        { value: false, label: '手動' },
      ], s.autoOd, (v) => { s.autoOd = v; this.onChange?.('battle'); }),

      h('div', { class: 'set-group-label', text: spaced('その他') }),
      this.link('記録', '掘った数・戦績・プレイ時間', () => this.onGo?.('profile')),
      this.link('タイトルへ戻る', '進行は保存済み', () => this.onGo?.('title')),
      s.debug === true ? this.link('デバッグ', '検証用の配布と切り替え', () => this.onGo?.('debug')) : null,
      this.link('セーブを消す', '手持ち・図鑑・記録がすべて消える', () => this.onGo?.('wipe'), true),
    ];
    for (const r of rows) if (r) this.bodyEl.appendChild(r);
  }

  private link(label: string, note: string, tap: () => void, danger = false): HTMLElement {
    const b = button('', () => { audio.uiTap(); tap(); }, { class: `set-link ${danger ? 'is-danger' : ''}` });
    b.append(
      h('span', { class: 'set-row-head' },
        h('span', { class: 'set-label', text: label }),
        h('span', { class: 'set-note', text: note }),
      ),
      h('span', { class: 'set-link-go', text: '›' }),
    );
    return b;
  }
}

const VOLUMES = [
  { value: 0, label: '切' },
  { value: 0.3, label: '小' },
  { value: 0.6, label: '中' },
  { value: 0.8, label: '大' },
  { value: 1, label: '最大' },
];

/** 保存されている値が段のどれにも一致しないことがある。近い段に寄せる */
function round2(v: number): number {
  let best = VOLUMES[0].value;
  for (const o of VOLUMES) if (Math.abs(o.value - v) < Math.abs(best - v)) best = o.value;
  return best;
}
