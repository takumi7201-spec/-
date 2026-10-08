/**
 * 試作個体。ゲームの表（revos.ts）には入れず、計測のときだけ登録する。
 *
 * 新しい特性や必殺を試すときは、simulate.ts に仕組みを足したうえで、
 * それを使う個体をここに置く。expunit が registerRevos() で差し込むので、
 * 図鑑にも発掘にも出ないまま勝率だけ測れる——採用が決まってから
 * revos.ts へ移す。
 *
 * ここが空なのは、いま試している案が無いというだけのこと。
 */
import type { RevosDef } from '../src/game/data/revos.ts';

export const EXP_DEFS: RevosDef[] = [
  {
    id: 'exp-spray', name: 'エクスＰ撒', en: 'ExpP1', element: 'aqua', role: 'Debuffer',
    hp: 1190, atk: 108, def: 96, spd: 118, basicPower: 80,
    passive: {
      id: 'venomspray', name: '散毒',
      desc: '通常攻撃の命中時 75% で毒を1つ重ねる。',
    },
    od: {
      id: 'miasma', name: '瘴気',
      desc: '敵全体にダメージ ＋ 毒を2つ重ねる。', power: 58,
    },
    sprite: 'elasmosaurus',
    build: { archetype: 'aquatic', seed: 301, bulk: 1.0, scale: 1.0 },
    habitat: ['tidehollow'], rarity: 4, eventOnly: true, flavor: '試作。',
  },
  {
    id: 'exp-mire', name: 'エクスＰ沼', en: 'ExpP4', element: 'aqua', role: 'Guardian',
    hp: 1500, atk: 98, def: 130, spd: 86, basicPower: 84,
    passive: {
      id: 'venomire', name: '毒沼',
      desc: '自分を攻撃した相手に 50% で毒を1つ重ねる。',
    },
    od: {
      id: 'miregift', name: '沼を分ける',
      desc: '味方全体にシールド ＋ 敵全体に毒を1つ重ねる。', power: 0,
    },
    sprite: 'archelon',
    build: { archetype: 'aquatic', seed: 304, bulk: 1.1, scale: 1.05 },
    habitat: ['tidehollow'], rarity: 4, eventOnly: true, flavor: '試作。',
  },
];
