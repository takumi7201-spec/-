import { Screen } from '../UIRoot';
import { h, bar, clear, fmtNum } from '../dom';
import type { SaveData } from '../../core/Save';
import { expToNext } from '../../core/Save';
import { REVOS, getRevos } from '../../game/data/revos';
import { EVENTS } from '../../game/data/events';
import { revosIcon } from '../revosIcon';
import { screenHead } from '../chrome';

/**
 * プロフィール。野帳の巻頭に貼る、調査者の記録票。
 *
 * 回数だけを並べると、長く遊ぶほど数字が伸びるだけの表になる。最高値と
 * 最短記録を混ぜて、更新しに行く対象を作る——「最大の一撃」と「最短の
 * 勝利」は、次に戦うときの目標として機能する。
 *
 * 0 のままの項目は出さない。まだ届いていない記録を並べるのは、達成表では
 * なく未達表で、開くたびに何もしていないことを見せられる。
 */

const BIOME_NAMES: Record<string, string> = {
  canyon: 'ソルト・キャニオン',
  frostpeak: 'フロストピーク',
  emberfield: 'エンバーフィールド',
  tidehollow: 'タイドホロウ',
};

/** 称号。到達済みのうち最後のものを名乗る */
const TITLES: { need: (d: SaveData) => boolean; name: string }[] = [
  { need: () => true, name: '見習い' },
  { need: (d) => d.stats.fossils >= 1, name: '拾い屋' },
  { need: (d) => d.stats.wins >= 5, name: '調査員' },
  { need: (d) => d.dex.length >= 5, name: '記録者' },
  { need: (d) => d.stats.sRanks >= 1, name: '研磨師' },
  { need: (d) => d.stats.bestStreak >= 5, name: '常勝' },
  { need: (d) => d.dex.length >= 10, name: '層位学者' },
  { need: (d) => d.stats.bestRarity >= 5, name: '深層の目' },
  { need: (d) => d.dex.length >= REVOS.length, name: '全知' },
];

function hhmm(sec: number): string {
  const h1 = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  if (h1 > 0) return `${h1}時間 ${m}分`;
  // 1分未満を「0分」と出すと、動いていないように見える
  return m > 0 ? `${m}分` : `${Math.floor(sec)}秒`;
}

function ymd(ms: number): string {
  const d = new Date(ms);
  return `${d.getFullYear()}.${String(d.getMonth() + 1).padStart(2, '0')}.${String(d.getDate()).padStart(2, '0')}`;
}

export class ProfileScreen extends Screen {
  private data!: SaveData;
  private bodyEl!: HTMLElement;
  private expBar = bar('bar--exp bar--slim', 0);

  onBack?: () => void;

  constructor() { super('profile'); }

  setData(d: SaveData): void { this.data = d; this.render(); }

  build(): void {
    const strip = screenHead({
      eyebrow: '調査記録', title: 'プロフィール',
      onBack: () => this.onBack?.(),
    });
    this.bodyEl = h('div', { class: 'prof-body' });
    this.el.append(strip, this.bodyEl);
  }

  enter(): void { this.render(); }

  // ------------------------------------------------------------ 部品

  /** 値が 0 なら行ごと出さない。未達の項目で埋めない */
  private row(label: string, value: string | number, opts: { skipZero?: boolean; note?: string } = {}): HTMLElement | null {
    if (opts.skipZero !== false && (value === 0 || value === '0')) return null;
    return h('div', { class: 'prof-row' },
      h('span', { class: 'prof-label', text: label }),
      h('span', { class: 'prof-value num', text: typeof value === 'number' ? fmtNum(value) : value }),
      opts.note ? h('span', { class: 'prof-note', text: opts.note }) : null,
    );
  }

  private section(title: string, ...rows: (HTMLElement | null)[]): HTMLElement | null {
    const live = rows.filter((r): r is HTMLElement => r !== null);
    if (live.length === 0) return null;
    return h('div', { class: 'prof-section' },
      h('div', { class: 'prof-head', text: title }),
      ...live,
    );
  }

  // ------------------------------------------------------------ 描画

  private render(): void {
    if (!this.data || !this.bodyEl) return;
    clear(this.bodyEl);
    const d = this.data;
    const st = d.stats;

    const title = [...TITLES].reverse().find((t) => t.need(d))?.name ?? '見習い';
    const winRate = st.battles > 0 ? Math.round((st.wins / st.battles) * 100) : 0;
    const need = expToNext(d.player.level);
    this.expBar.set(d.player.exp / Math.max(1, need));

    // よく連れて行く相手。出撃回数の1位
    const top = Object.entries(st.sorties).sort((a, b) => b[1] - a[1])[0];
    const topDef = top && REVOS.some((r) => r.id === top[0]) ? getRevos(top[0]) : null;

    const biomes = Object.entries(st.biomeRuns)
      .filter(([, n]) => n > 0)
      .sort((a, b) => b[1] - a[1]);

    // append は null を受けないので、ここで落としてから渡す
    const blocks: (HTMLElement | null)[] = [
      // --- 名札 ---
      h('div', { class: 'prof-card' },
        h('div', { class: 'prof-id' },
          h('div', { class: 'prof-avatar' },
            topDef ? revosIcon(topDef.id, 'prof-avatar-img') : h('span', { class: 'prof-avatar-empty', text: '?' }),
          ),
          h('div', { class: 'prof-who' },
            h('div', { class: 'prof-title', text: title }),
            h('div', { class: 'prof-name', text: d.player.name }),
            h('div', { class: 'prof-lv num' },
              h('span', { text: `Lv ${d.player.level}` }),
              h('span', { class: 'dim', text: `次まで ${fmtNum(Math.max(0, need - d.player.exp))}` }),
            ),
            this.expBar.el,
          ),
        ),
        h('div', { class: 'prof-since' },
          h('span', { text: `調査開始 ${ymd(d.createdAt)}` }),
          h('span', { class: 'dim', text: hhmm(st.playSeconds) }),
        ),
      ),

      // --- ひと目でわかる4つ ---
      h('div', { class: 'prof-tiles' },
        ...([
          ['図鑑', `${d.dex.length} / ${REVOS.length}`],
          ['ステージ', `${d.stageProgress}`],
          ['勝率', st.battles > 0 ? `${winRate}%` : '—'],
          ['所持', `${d.roster.length} 体`],
        ] as const).map(([k, v]) => h('div', { class: 'prof-tile' },
          h('span', { class: 'label', text: k }),
          h('span', { class: 'num', text: v }),
        )),
      ),

      this.section('発掘',
        this.row('潜行した回数', st.runs),
        this.row('崩した岩', st.voxelsDug, { note: 'ボクセル' }),
        this.row('掘り当てた化石', st.found),
        this.row('最高レア度', st.bestRarity > 0 ? '★'.repeat(st.bestRarity) : 0),
        ...biomes.map(([b, n]) => this.row(BIOME_NAMES[b] ?? b, `${n} 回`)),
      ),

      this.section('精錬',
        this.row('削り終えた化石', st.fossils),
        this.row('最高クリーン度', st.bestClean),
        this.row('Sランク', st.sRanks),
      ),

      this.section('バトル',
        this.row('戦った回数', st.battles),
        this.row('勝ち', st.wins),
        this.row('連勝記録', st.bestStreak, { note: st.streak > 1 ? `いま ${st.streak} 連勝中` : undefined }),
        this.row('撃破', st.kos),
        this.row('累計の与ダメージ', st.damage),
        this.row('最大の一撃', st.bestHit),
        this.row('OD 発動', st.odFired),
        this.row('最短の勝利', st.fastestWin > 0 ? `${st.fastestWin} 行動` : 0),
        // 1件も踏破していないうちは出さない。「0 / 2」だけが残った
        // バトル欄は、記録票ではなく未達表になる
        d.events.cleared.length > 0
          ? this.row('イベント踏破', `${d.events.cleared.length} / ${EVENTS.length}`)
          : null,
      ),

      topDef
        ? h('div', { class: 'prof-section' },
          h('div', { class: 'prof-head', text: 'よく連れて行く相手' }),
          h('div', { class: 'prof-fav' },
            revosIcon(topDef.id, 'prof-fav-icon'),
            h('div', { class: 'prof-fav-main' },
              h('div', { class: 'prof-fav-name', text: topDef.name }),
              h('div', { class: 'prof-fav-sub num', text: `${top[1]} 回の出撃` }),
            ),
          ),
        )
        : null,

      st.runs === 0 && st.battles === 0
        ? h('div', { class: 'prof-empty' },
          h('div', { text: 'まだ何も記録されていない。' }),
          h('div', { class: 'dim', text: '一度掘って、削って、戦えば埋まりはじめる。' }),
        )
        : null,
    ];
    for (const b of blocks) if (b) this.bodyEl.appendChild(b);
  }
}
