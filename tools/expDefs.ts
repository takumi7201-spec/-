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
    id: 'exp-truestrike', name: 'エクスＢ必中', en: 'ExpB', element: 'null', role: 'Sprinter',
    hp: 1120, atk: 126, def: 84, spd: 134, basicPower: 86,
    passive: {
      id: 'truestrike', name: '見切り',
      desc: '自分の攻撃は外れない。肩代わりにも割り込まれず、狙った相手に届く。',
    },
    od: {
      id: 'pierceveil', name: '帳を裂く',
      desc: '奥にいる敵1体に特大ダメージ。肩代わりを無視する。', power: 164,
    },
    sprite: 'velociraptor',
    build: { archetype: 'raptor', seed: 102, bulk: 1.0, scale: 1.0 },
    habitat: ['canyon'], rarity: 4, eventOnly: true, flavor: '試作。',
  },
];
