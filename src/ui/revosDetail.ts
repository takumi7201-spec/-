import { h } from './dom';
import type { OwnedRevos } from '../core/Save';
import { RARITY_NAMES, ROLE_NAMES, getRevos } from '../game/data/revos';
import { ELEMENT_NAMES } from '../voxel/palette';
import { cleanRank } from '../game/battle/simulate';
import { revosIcon } from './revosIcon';

/**
 * リヴォス1体ぶんの詳細。図鑑と編成の両方から同じものを開く。
 *
 * 「どんな相手か」を確かめたい場面は図鑑だけではない——編成を組んで
 * いるときこそ知りたい。同じ紙を2か所から引けるようにしておく。
 */

const BIOME_NAMES: Record<string, string> = {
  canyon: 'ソルト・キャニオン',
  frostpeak: 'フロストピーク',
  emberfield: 'エンバーフィールド',
  tidehollow: 'タイドホロウ',
};

export interface RevosDetailOpts {
  /** 図鑑の「所持 n 体」に相当する情報。省略すると所持欄を出さない */
  owned?: OwnedRevos[];
  /** この個体を開いている場合、その個体の育成状況を先に見せる */
  unit?: OwnedRevos;
}

export function revosDetailBody(defId: string, opts: RevosDetailOpts = {}): HTMLElement {
  const r = getRevos(defId);
  const { owned, unit } = opts;

  return h('div', { class: 'dex-detail' },
    h('div', { class: 'dex-hero' }, revosIcon(r.id, 'dex-hero-img')),
    h('div', { class: 'dex-detail-head' },
      h('span', { class: `chip chip--${r.element}`, text: ELEMENT_NAMES[r.element] }),
      h('span', { class: 'dex-detail-role', text: ROLE_NAMES[r.role] }),
      h('span', { class: 'dex-detail-rarity', text: RARITY_NAMES[r.rarity] }),
    ),
    // この個体を開いているなら、種の基準値より先に手元の状態を出す
    unit
      ? h('div', { class: 'dex-unit num' },
        h('span', { text: `Lv${unit.level}` }),
        h('span', { text: `${cleanRank(unit.clean)}ランク（クリーン度 ${unit.clean}）` }),
        h('span', { text: `スキルLv ${unit.skillLevel}` }),
      )
      : null,
    h('p', { class: 'dex-flavor', text: r.flavor }),
    h('div', { class: 'dex-stats' },
      ...([['体力', r.hp], ['攻撃', r.atk], ['防御', r.def], ['速度', r.spd]] as const).map(([k, v]) =>
        h('div', { class: 'dex-stat' },
          h('span', { class: 'label', text: k }),
          h('span', { class: 'num', text: String(v) }),
        ),
      ),
    ),
    h('div', { class: 'dex-skill' },
      h('b', { text: `特性 · ${r.passive.name}` }),
      h('span', { text: r.passive.desc }),
    ),
    h('div', { class: 'dex-skill' },
      h('b', { class: 'od', text: `必殺 · ${r.od.name}` }),
      h('span', { text: r.od.desc }),
    ),
    owned
      ? h('div', { class: 'dex-owned' },
        owned.length === 0
          ? h('span', { class: 'dim', text: '未所持' })
          : h('span', { text: `所持 ${owned.length} 体 — 最高クリーン度 ${Math.max(...owned.map((u) => u.clean))}` }),
      )
      : null,
    h('div', { class: 'dex-habitat' },
      h('span', { class: 'label', text: '産出' }),
      h('span', {
        text: r.habitat.length > 0
          ? r.habitat.map((b) => BIOME_NAMES[b] ?? b).join(' / ')
          : 'イベント戦の記録から',
      }),
    ),
  );
}
