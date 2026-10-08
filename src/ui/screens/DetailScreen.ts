import { Screen } from '../UIRoot';
import { h, button, clear } from '../dom';
import { effectRow } from '../effectIcons';
import type { OwnedRevos } from '../../core/Save';
import { RARITY_NAMES, ROLE_NAMES, getRevos } from '../../game/data/revos';
import { ELEMENT_NAMES, BIOMES } from '../../voxel/palette';
import { cleanMultiplier, cleanRank } from '../../game/battle/simulate';
import { revosIcon } from '../revosIcon';
import { spaced } from '../chrome';
import { engraveChip } from './CleanChoiceScreen';
import { OD_OVERCHARGE, odReadout, refDefenderDef } from '../../game/odInfo';
import { audio } from '../../core/Audio';

/**
 * 技レベルの粒。
 *
 * 同じ種を重ねるたびに1つ増える（5が上限）。数字で「3 / 5」と書くより、
 * 満ちていない枠が見えるほうが「あと2回重ねられる」が一目で分かる。
 */
function skillPips(level: number): HTMLElement {
  const el = h('div', { class: 'det-skill-pips' },
    h('span', { class: 'det-skill-pips-tag', text: '技' }),
  );
  for (let i = 1; i <= 5; i++) {
    el.appendChild(h('i', { class: `det-pip ${i <= level ? 'is-on' : ''}` }));
  }
  return el;
}

/** 帯の満ち具合を決める基準値。種ごとの差が読める幅に取る */
const STAT_CEIL = { hp: 1900, atk: 180, def: 170, spd: 148 } as const;

/** 刻印ぶんの色。毒の紫と同系で、精錬の緑／赤とは混ざらない */
const ENGRAVE_INK = '#8a4fa8';

interface StatRow {
  key: string;
  /** 種の基準値。レベル1・クリーン度50のときの数字 */
  base: number;
  /** レベルとクリーン度まで乗せた値 */
  scaled: number;
  /** 刻印の加算。倍率の外で足される */
  eg: number;
  ceil: number;
  color: string;
}

/**
 * 払いで行き来する1件。
 *
 * 開いた一覧がそのとき並べていた順そのままを受ける。詳細の中で並べ直すと、
 * 戻ったときの一覧と順番が食い違う——「右の次は誰か」は一覧が決める。
 */
export interface DetailEntry {
  defId: string;
  /** この個体を開いているなら、種の基準値ではなく手元の値を出す */
  unit?: OwnedRevos;
  /** 同じ種の手持ち。産出の段に出す */
  owned?: OwnedRevos[];
}

export interface DetailParams extends DetailEntry {
  /** 閉じたときの行き先 */
  back: () => void;
  /** 編成へ送る導線。図鑑から開いたときだけ出す */
  onEquip?: () => void;
  /** 開いた一覧の並び。横に払って隣の個体へ移る */
  list?: DetailEntry[];
  /** list の中で今どこを見ているか */
  at?: number;
}

/**
 * 個体の詳細。
 *
 * 下から引き出す紙ではなく、1枚の画面にする。ここで読む情報
 * （特性・必殺・産出）は編成を決める材料なので、他の面に半分隠れたまま
 * 読ませると、結局スクロールして全部出すことになる。
 */
export class DetailScreen extends Screen {
  private p: DetailParams | null = null;
  /** list の中で今どこを見ているか。払うとここが動く */
  private at = 0;
  /** 数字を「合計」で読むか「素＋加算」で読むか。タップで入れ替える */
  private mode: 'total' | 'base' = 'total';
  private rows: StatRow[] = [];

  private artEl!: HTMLElement;
  private tagEl!: HTMLElement;
  private headEl!: HTMLElement;
  private nameEl!: HTMLElement;
  private latinEl!: HTMLElement;
  private statsEl!: HTMLElement;
  private statsBtn!: HTMLButtonElement;
  private statsMode!: HTMLElement;
  private statsLegend!: HTMLElement;
  private engraveEl!: HTMLElement;
  private passiveEl!: HTMLElement;
  private odEl!: HTMLElement;
  private habitatEl!: HTMLElement;
  private habitatLabel!: HTMLElement;
  private equipBtn!: HTMLButtonElement;
  private sheetEl!: HTMLElement;
  private bodyEl!: HTMLElement;
  private navEl!: HTMLElement;
  private navPos!: HTMLElement;
  private navPrev!: HTMLButtonElement;
  private navNext!: HTMLButtonElement;

  constructor() { super('detail', 'unit'); }

  build(): void {
    this.artEl = h('div', { class: 'det-art' });
    this.tagEl = h('div', { class: 'det-tag' });
    this.headEl = h('div', { class: 'det-head' });
    this.nameEl = h('div', { class: 'det-name' });
    this.latinEl = h('div', { class: 'det-latin' });
    this.statsEl = h('div', { class: 'det-stats' });
    this.statsMode = h('span', { class: 'det-statbox-mode' });
    this.statsLegend = h('div', { class: 'det-statbox-legend' });
    this.statsBtn = h('button', {
      class: 'det-statbox',
      type: 'button',
      onclick: () => {
        if (this.statsBtn.disabled) return;
        audio.uiTap();
        this.mode = this.mode === 'total' ? 'base' : 'total';
        this.renderStats();
      },
    },
      h('div', { class: 'det-statbox-head' },
        h('span', { class: 'det-statbox-tag', text: spaced('能力') }),
        this.statsMode,
      ),
      this.statsEl,
      this.statsLegend,
    );
    this.engraveEl = h('div', { class: 'det-engrave' });
    this.passiveEl = h('div', { class: 'det-skill det-skill--passive' });
    this.odEl = h('div', { class: 'det-skill det-skill--od' });
    this.habitatEl = h('div', { class: 'det-habitat' });
    this.habitatLabel = h('div', { class: 'det-habitat-label' });
    this.equipBtn = button('編成する', () => { audio.uiConfirm(); this.p?.onEquip?.(); },
      { class: 'btn--primary det-equip' });

    const close = button('✕', () => { audio.uiBack(); this.p?.back(); }, { class: 'btn--rail det-close' });

    // 隣へ移る札。払えない指（PC）でも同じ順に行き来できるようにする
    this.navPrev = button('◂', () => this.step(-1), { class: 'btn--sm det-nav-btn' });
    this.navNext = button('▸', () => this.step(1), { class: 'btn--sm det-nav-btn' });
    this.navPos = h('span', { class: 'det-nav-pos num' });
    this.navEl = h('div', { class: 'det-nav' }, this.navPrev, this.navPos, this.navNext);

    this.bodyEl = h('div', { class: 'det-body' },
      h('div', { class: 'det-title' },
        h('div', { class: 'det-title-main' }, this.headEl, this.nameEl, this.latinEl),
        this.navEl,
      ),
      this.statsBtn,
      this.engraveEl,
      this.passiveEl,
      this.odEl,
      h('div', { class: 'det-foot' },
        h('div', { class: 'det-habitat-main' },
          this.habitatLabel,
          this.habitatEl,
        ),
        this.equipBtn,
      ),
    );
    /*
     * 絵・等級・本文を1枚にまとめる。
     *
     * 払いで動かすのはこの1枚だけ。地の色は面（::before）に塗ってあるので、
     * 面ごと動かすと下の3Dが覗く——動くのは中身にとどめる。閉じる札は
     * 外に置く。送っている途中でも、抜ける口はいつも同じ場所に要る。
     */
    this.sheetEl = h('div', { class: 'det-sheet' }, this.artEl, this.tagEl, this.bodyEl);
    this.el.append(this.sheetEl, close);
  }

  /** 払いで動かすのは1枚だけ。閉じる札と地の色は止めておく */
  swipeSurface(): HTMLElement | null { return this.sheetEl ?? null; }

  /**
   * 横に払われた。開いた一覧と同じ順で隣の個体へ移る。
   *
   * 端では false を返す——面ごと送られても、詳細から行ける隣の面は無い。
   * UI 層が引っ張ったぶんを戻すので、「これ以上は無い」が手触りで分かる。
   */
  swipeTab(dir: -1 | 1): boolean { return this.step(dir); }

  /** list の中を1つ動かす。動けたら true */
  private step(dir: -1 | 1): boolean {
    const list = this.p?.list;
    if (!list || list.length < 2) return false;
    const next = this.at + dir;
    if (next < 0 || next >= list.length) return false;
    this.at = next;
    audio.uiTap();
    this.paint(list[next]);
    return true;
  }

  enter(params?: unknown): void {
    const p = params as DetailParams | undefined;
    if (!p) return;
    this.p = p;
    // 渡された位置を信じない。開いた札が一覧の何番目かは、同じ個体を
    // 探し直したほうが確か——並びが変わっていても追従する
    const list = p.list ?? [];
    const found = list.findIndex((e) => (p.unit ? e.unit?.uid === p.unit.uid : e.defId === p.defId));
    this.at = found >= 0 ? found : (p.at ?? 0);
    this.paint(found >= 0 ? list[found] : p);
  }

  /** 1件ぶんを描く。払いで差し替えるときもここだけを通る */
  private paint(e: DetailEntry): void {
    const r = getRevos(e.defId);
    const u = e.unit;
    // スクロールは頭へ戻す。前の個体の「必殺」の位置で新しい個体が開くと、
    // 名前も絵も見ないまま別の子の説明を読むことになる
    this.bodyEl.scrollTop = 0;
    // 手元の個体を開いているときは、その育ち方を反映した値を出す。
    // 種の基準値を見せても「この子がどれだけ強いか」は分からない
    const ls = u ? 1 + 0.055 * (u.level - 1) : 1;
    const mc = u ? cleanMultiplier(u.clean) : 1;
    // 精錬でどれだけ足された（削られた）か。クリーン度50を素の状態として、
    // そこからの差を別の色で出す——倍率のままでは、削った手間が数字に見えない
    const cleanDelta = (base: number, scaled: boolean): number =>
      u && scaled ? Math.round(base * ls * mc) - Math.round(base * ls) : 0;

    clear(this.artEl);
    this.artEl.appendChild(revosIcon(r.id, 'det-art-img'));

    clear(this.tagEl);
    this.tagEl.className = `det-tag ${r.rarity === 5 ? 'det-tag--holo' : ''}`;
    this.tagEl.appendChild(h('span', { text: spaced(RARITY_NAMES[r.rarity]) }));

    clear(this.headEl);
    this.headEl.append(
      h('span', { class: `chip chip--${r.element}` },
        h('i', { class: 'chip-dot' }),
        ELEMENT_NAMES[r.element],
      ),
      h('span', { class: 'det-role', text: spaced(ROLE_NAMES[r.role]) }),
      h('span', { class: 'det-stars', text: '★'.repeat(r.rarity) }),
    );
    this.nameEl.textContent = r.name;
    this.latinEl.textContent = r.en;

    // クリーン度が掛かるのは体力・攻撃・防御だけ。速度には乗らない。
    // 刻印は倍率の外——掛けたあとに足す（simulate.ts の buildFighters と同じ順）
    const eg = u?.engraving;
    this.rows = [
      { key: '体力', base: r.hp, scaled: Math.round(r.hp * ls * mc), eg: eg?.hp ?? 0, ceil: STAT_CEIL.hp, color: '#3fa772' },
      { key: '攻撃', base: r.atk, scaled: Math.round(r.atk * ls * mc), eg: eg?.atk ?? 0, ceil: STAT_CEIL.atk, color: '#de523c' },
      { key: '防御', base: r.def, scaled: Math.round(r.def * ls * mc), eg: eg?.def ?? 0, ceil: STAT_CEIL.def, color: '#3f97d6' },
      { key: '速度', base: r.spd, scaled: Math.round(r.spd * ls), eg: eg?.spd ?? 0, ceil: STAT_CEIL.spd, color: 'var(--hl-amber)' },
    ];
    // 種の基準値しか無い図鑑では切り替える先が無いので、合計で固定する
    this.statsBtn.disabled = !u;
    if (!u) this.mode = 'total';
    this.renderStats();

    // 刻印はこの個体だけのもの。種の性能表とは別の段に置く——
    // 同じ行に混ぜると、図鑑に並ぶ数値が個体ごとに違って見える
    clear(this.engraveEl);
    this.engraveEl.hidden = !u?.engraving;
    if (u?.engraving) {
      this.engraveEl.append(
        h('span', { class: 'det-engrave-tag', text: spaced('刻印') }),
        engraveChip(u.engraving, 'is-cur'),
      );
    }

    clear(this.passiveEl);
    this.passiveEl.append(
      h('div', { class: 'det-skill-head' },
        h('span', { class: 'det-skill-tag', text: spaced('特性') }),
        h('span', { class: 'det-skill-name', text: r.passive.name }),
      ),
      h('div', { class: 'det-skill-desc', text: r.passive.desc }),
    );
    // 上がるものは絵でも出す。説明文と同じ出どころから引く
    const pBuffs = effectRow(r.passive.desc);
    if (pBuffs) this.passiveEl.appendChild(pBuffs);
    clear(this.odEl);
    this.odEl.append(
      h('div', { class: 'det-skill-head' },
        h('span', { class: 'det-skill-tag', text: spaced('必殺') }),
        h('span', { class: 'det-skill-name', text: r.od.name }),
        // 技レベルは重ねた回数。どこにも出ていなかったので、技の名前の隣に置く
        u ? skillPips(u.skillLevel) : null,
      ),
      h('div', { class: 'det-skill-desc', text: r.od.desc }),
    );
    const oBuffs = effectRow(r.od.desc);
    if (oBuffs) this.odEl.appendChild(oBuffs);

    /*
     * 効き目を、この個体の数字で出す。
     *
     * 「単体に大ダメージ」だけでは、威力 128 と 185 の差も、攻撃力 96 と
     * 175 の差も読めない。育てたぶんが技の側にどう出ているのかを、
     * 説明文の下に数字で置く——図鑑（素の値）でも同じ式で出すので、
     * 手に入れる前と後で比べられる。
     */
    const lv = u?.level ?? 1;
    const lines = odReadout(r, {
      atk: this.rows[1].scaled + this.rows[1].eg,
      def: this.rows[2].scaled + this.rows[2].eg,
      maxHp: this.rows[0].scaled + this.rows[0].eg,
      level: lv,
      skillLevel: u?.skillLevel ?? 1,
    });
    if (lines.length > 0) {
      const box = h('div', { class: 'det-od-calc' });
      for (const line of lines) {
        box.appendChild(h('div', { class: 'det-od-row' },
          h('span', { class: 'det-od-label', text: line.label }),
          h('span', { class: 'det-od-value num', text: line.value }),
          // 能力の「1,586 +197」と同じ並び。合計を先に置き、重ねたぶんを後ろに添える
          line.skillAdd ? h('span', { class: 'det-od-add num', text: `+${line.skillAdd.toLocaleString('ja-JP')}` }) : null,
          line.note ? h('span', { class: 'det-od-note', text: line.note }) : null,
        ));
      }
      // 脚注。何に当てた値かと、溜めたぶんの伸びしろ。ダメージの無い技に
      // 「防御◯の相手に」と書いても、当てる相手が居ない
      const hitsSomething = lines.some((x) => x.label.startsWith('ダメージ'));
      if (lines.some((x) => x.skillAdd)) {
        box.appendChild(h('div', { class: 'det-od-legend' },
          h('i', null), `技Lv${u?.skillLevel ?? 1} ぶん`,
        ));
      }
      box.appendChild(h('div', { class: 'det-od-foot' },
        `Lv${lv}${u ? `・技Lv${u.skillLevel}` : '（素の値）'}で計算。`
        + (hitsSomething ? `同じLvの標準的な相手（防御 ${refDefenderDef(lv)}）に通る量。` : '')
        + `必殺ゲージを限界まで溜めると ×${OD_OVERCHARGE.toFixed(2)}。`,
      ));
      this.odEl.appendChild(box);
    }

    // 産出。手元に居るなら、居る事実のほうが先に要る
    clear(this.habitatEl);
    const owned = e.owned ?? [];
    this.habitatLabel.textContent = spaced(u || owned.length > 0 ? '手持ち' : '産出');
    if (u) {
      this.habitatEl.append(
        h('span', { class: 'num', text: `Lv${u.level}` }),
        ` · ${cleanRank(u.clean)}ランク（クリーン度 ${u.clean}）`,
      );
      // 精錬ぶんの合計を1行にまとめる。個々の +NN が何の色かを説明する
      const sum = cleanDelta(r.hp, true) + cleanDelta(r.atk, true) + cleanDelta(r.def, true);
      if (sum !== 0) {
        this.habitatEl.append(h('span', {
          class: `det-clean-sum ${sum > 0 ? 'is-up' : 'is-down'}`,
          text: `精錬 ${sum > 0 ? '+' : '−'}${Math.abs(sum)}`,
        }));
      }
    } else if (owned.length > 0) {
      this.habitatEl.append(
        '所持 ', h('span', { class: 'num', text: String(owned.length) }), ' 体 — 最高クリーン度 ',
        h('span', { class: 'num', text: String(Math.max(...owned.map((o) => o.clean))) }),
      );
    } else {
      // まだ持っていない個体。どこで出るかと、持っていない事実を並べる
      this.habitatEl.append(
        h('span', { class: 'det-nothave', text: spaced('未所持') }),
        r.habitat.map((b) => BIOMES[b]?.name ?? b).join(' / '),
      );
    }

    // 編成への導線は「持っている個体」にだけ出す。払って未所持の子へ
    // 移ったのに札が残っていると、押しても何も置けない
    this.equipBtn.hidden = !this.p?.onEquip || (!u && owned.length === 0);

    const list = this.p?.list ?? [];
    this.navEl.hidden = list.length < 2;
    if (list.length >= 2) {
      this.navPos.textContent = `${this.at + 1} / ${list.length}`;
      this.navPrev.disabled = this.at === 0;
      this.navNext.disabled = this.at === list.length - 1;
    }
  }

  /**
   * 能力の4枚を引き直す。
   *
   * 数字は「合計」と「素」を行き来させる。素の値だけ見せると手元の個体が
   * どれだけ強いか分からず、合計だけ見せると何がどれだけ効いたか分からない。
   * 帯はどちらの面でも同じ——素・精錬ぶん・刻印ぶんの3本に割って、
   * 数字が入れ替わっても伸びた長さは動かないようにする。
   */
  private renderStats(): void {
    const on = !this.statsBtn.disabled;
    const base = this.mode === 'base';
    this.statsMode.hidden = !on;
    this.statsMode.textContent = base ? '素の値 ⇄' : '合計 ⇄';

    // 加算が2色あるので、何の色かを1行で言っておく。下段の「精錬 +NN」は
    // クリーン度ぶんだけの数字で、札の緑（レベル込み）とは別物になる
    clear(this.statsLegend);
    this.statsLegend.hidden = !on;
    if (on) {
      // 素の帯は項目ごとに色が違う。凡例では4色を並べて「その項目の色」を指す
      const keys: [string, string][] = [
        ['素', 'linear-gradient(90deg,#3fa772,#de523c,#3f97d6,var(--hl-amber))'],
        ['育成・精錬', 'var(--pen-green)'],
      ];
      if (this.rows.some((x) => x.eg > 0)) keys.push(['刻印', ENGRAVE_INK]);
      for (const [label, c] of keys) {
        this.statsLegend.appendChild(h('span', { class: 'det-legend-key' },
          h('i', { style: `background:${c}` }), label));
      }
    }

    clear(this.statsEl);
    for (const row of this.rows) {
      const total = row.scaled + row.eg;
      const grow = row.scaled - row.base;
      const shown = base ? row.base : total;
      const adds: HTMLElement[] = [];
      if (on && grow !== 0) {
        adds.push(h('span', {
          class: `det-stat-add num ${grow > 0 ? 'is-up' : 'is-down'}`,
          text: `${grow > 0 ? '+' : '−'}${Math.abs(grow)}`,
        }));
      }
      if (row.eg > 0) {
        adds.push(h('span', { class: 'det-stat-add num is-eg', text: `+${row.eg}` }));
      }

      // 帯。左から 素 / 精錬ぶん / 刻印ぶん。減っているときは
      // 削れた側を薄い赤で残し、どこまであったはずかを見せる
      // 育て切った個体は基準値を越える。越えたぶんで割り直さないと、
      // 帯が右端で潰れて刻印ぶんが枠の外に出る
      const ceil = Math.max(row.ceil, total, row.base);
      const w = (n: number): number => Math.max(0, Math.min(100, (n / ceil) * 100));
      const solid = grow >= 0 ? row.base : row.scaled;
      const segs: [number, number, string][] = [
        [0, w(solid), row.color],
        grow > 0 ? [w(solid), w(grow), 'rgba(46,122,80,.55)'] : [0, 0, ''],
        [w(row.scaled), w(row.eg), ENGRAVE_INK],
        // 減っているぶんは合計の先に薄い赤で置く。満ちていない理由が見える
        grow < 0 ? [w(total), w(-grow), 'rgba(194,58,40,.32)'] : [0, 0, ''],
      ];

      this.statsEl.appendChild(h('div', { class: `det-stat ${base ? 'is-base' : ''}` },
        h('div', { class: 'det-stat-label', text: row.key }),
        h('div', { class: 'det-stat-num num', text: shown.toLocaleString('ja-JP') }),
        h('div', { class: 'det-stat-adds' }, ...adds),
        h('div', { class: 'det-stat-bar' },
          ...segs.map(([left, width, c]) => (width > 0
            ? h('i', { style: `left:${left}%;width:${width}%;background:${c}` })
            : null)),
        ),
      ));
    }
  }
}
