import { Screen } from '../UIRoot';
import { h, button, clear } from '../dom';
import type { SaveData } from '../../core/Save';
import { dropDecay } from '../../core/Save';
import { BIOMES, type BiomeId } from '../../voxel/palette';
import { RARITY_NAMES, REVOS, getRevos } from '../../game/data/revos';
import { revosIcon } from '../revosIcon';
import { spriteUrl } from '../../fx/SpriteUnit';
import { screenHead, plate, spaced } from '../chrome';
import { audio } from '../../core/Audio';

const MAX_HEARTS = 5;

/**
 * 発掘の入口。
 *
 * これまで「発掘」は問答無用で地層へ落としていた。だが持ち帰ったあとの
 * 精錬は、拠点の右端の小さな札からしか入れない——掘るのと削るのは
 * ひと続きの作業なのに、入口が離れた場所に2つあった。
 *
 * 同じ面に並べる。上が出発、下が精錬。どちらも「いま何ができるか」を
 * 札の上に出して、押す前に決められるようにする。
 */
export class DigSelectScreen extends Screen {
  private data!: SaveData;
  private goEl!: HTMLElement;
  private permitEl!: HTMLElement;
  private cleanEl!: HTMLElement;
  private stockPlate = plate('未精錬', { tone: 'amber' });

  onBack?: () => void;
  onGo?: (biome: BiomeId) => void;
  onClean?: () => void;

  constructor() { super('digSelect', 'dig'); }

  setData(d: SaveData): void { this.data = d; this.render(); }

  build(): void {
    const head = screenHead({
      eyebrow: '現場', title: '発掘',
      onBack: () => this.onBack?.(),
      right: this.stockPlate.el,
    });
    this.goEl = h('div', { class: 'digsel-slot' });
    this.permitEl = h('div', { class: 'digsel-slot digsel-slot--permit' });
    this.cleanEl = h('div', { class: 'digsel-slot' });
    this.el.append(head, h('div', { class: 'digsel-body' }, this.goEl, this.permitEl, this.cleanEl));
  }

  enter(): void { this.render(); }

  private render(): void {
    if (!this.data || !this.goEl) return;
    const stock = this.data.stock;
    this.stockPlate.set(String(stock.length));

    // ---- 出発 ----
    const biome = (this.data.unlockedBiomes[0] ?? 'canyon') as BiomeId;
    const b = BIOMES[biome];
    const runs = this.data.daily.runs;
    const decay = Math.round(dropDecay(runs) * 100);

    clear(this.goEl);
    const go = button('', () => { audio.uiConfirm(); this.onGo?.(biome); }, { class: 'digsel-card digsel-card--go' });
    const hearts = h('span', { class: 'hearts digsel-hearts' });
    for (let i = 0; i < MAX_HEARTS; i++) {
      hearts.appendChild(h('i', { class: `heart ${i < Math.max(0, MAX_HEARTS - runs) ? 'is-on' : ''}` }));
    }
    go.append(
      h('span', { class: 'digsel-mark', text: '⛏' }),
      h('span', { class: 'digsel-main' },
        h('span', { class: 'digsel-eyebrow', text: spaced('出発') }),
        h('span', { class: 'digsel-title', text: b.name }),
        h('span', { class: 'digsel-note', text: b.tagline }),
        h('span', { class: 'digsel-meta' },
          hearts,
          // 効率は「今日もう何周したか」の言い換え。心の粒だけでは率が読めない
          h('span', { class: `digsel-eff num ${decay < 60 ? 'is-low' : ''}`, text: `効率 ${decay}%` }),
        ),
      ),
      h('span', { class: 'digsel-go', text: '潜る' }),
    );
    this.goEl.appendChild(go);

    // ---- 特別許可区 ----
    // 券を持っているかどうかで、押せるかと文面が変わる。
    // ここにしか居ない個体の姿を札に出す——降りる理由は数字ではなく顔で示す
    clear(this.permitEl);
    const tickets = this.data.player.tickets ?? 0;
    const pz = BIOMES.permitzone;
    // ここだけの個体。★5 は全部ここなので、札には代表を3体だけ出す
    const only = REVOS.filter((r) => r.permitOnly);
    const permit = button('', () => {
      if (tickets <= 0) {
        audio.uiError();
        this.ui.toast('特別許可証が要る。ミッションの報酬か、商店で手に入る', 'warn', 2600);
        return;
      }
      audio.uiConfirm();
      this.onGo?.('permitzone');
    }, { class: `digsel-card digsel-card--permit ${tickets <= 0 ? 'is-empty' : ''}` });
    const onlyFaces = h('span', { class: 'digsel-faces' });
    for (const r of only.slice(0, 3)) onlyFaces.appendChild(revosIcon(r.id, 'digsel-face'));
    permit.append(
      h('span', { class: 'digsel-mark digsel-mark--ticket' },
        h('img', { class: 'digsel-ticket-img', src: spriteUrl('ticket'), alt: '' }),
      ),
      h('span', { class: 'digsel-main' },
        h('span', { class: 'digsel-eyebrow', text: spaced('特別発掘') }),
        h('span', { class: 'digsel-title', text: pz.name }),
        h('span', {
          class: 'digsel-note',
          text: tickets > 0 ? 'ホロタイプはここだけ。かならず ★4 以上が1点' : '許可証が無いと降りられない',
        }),
        h('span', { class: 'digsel-meta' },
          onlyFaces,
          h('span', {
            class: 'digsel-names',
            text: `ホロタイプ ${only.filter((r) => r.rarity === 5).length} 種ほか、ここだけの個体`,
          }),
        ),
      ),
      h('span', { class: 'digsel-go digsel-go--ticket' },
        h('span', { class: 'num', text: String(tickets) }),
        h('span', { class: 'digsel-go-sub', text: '枚' }),
      ),
    );
    this.permitEl.appendChild(permit);

    // ---- 精錬 ----
    clear(this.cleanEl);
    const empty = stock.length === 0;
    const clean = button('', () => {
      if (empty) { audio.uiError(); this.ui.toast('未精錬の化石がない', 'warn'); return; }
      audio.uiConfirm();
      this.onClean?.();
    }, { class: `digsel-card digsel-card--clean ${empty ? 'is-empty' : ''}` });

    // 何が待っているかを先頭3つの姿で出す。個数だけでは削りに行く理由にならない
    const top = stock.slice().sort((a, b2) => b2.rarity - a.rarity).slice(0, 3);
    const faces = h('span', { class: 'digsel-faces' });
    for (const s of top) faces.appendChild(revosIcon(s.defId, 'digsel-face'));

    const best = stock.reduce((m, s) => Math.max(m, s.rarity), 0);
    clean.append(
      h('span', { class: 'digsel-mark', text: '◈' }),
      h('span', { class: 'digsel-main' },
        h('span', { class: 'digsel-eyebrow', text: spaced('精錬') }),
        h('span', { class: 'digsel-title', text: empty ? '削る石がない' : `${stock.length} 個 待っている` }),
        h('span', {
          class: 'digsel-note',
          text: empty ? '発掘で持ち帰ったものがここに並ぶ。' : `最高 ${'★'.repeat(best)} ${RARITY_NAMES[best] ?? ''}`,
        }),
        empty ? null : h('span', { class: 'digsel-meta' },
          faces,
          h('span', { class: 'digsel-names', text: top.map((s) => getRevos(s.defId).name).join(' / ') }),
        ),
      ),
      h('span', { class: 'digsel-go', text: '削る' }),
    );
    this.cleanEl.appendChild(clean);
  }
}
