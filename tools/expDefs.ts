/**
 * 試作個体。ゲームの表（revos.ts）には入れず、計測のときだけ登録する。
 *
 * 新しい特性・必殺そのものは simulate.ts に実装してあるが、使う個体が
 * ここにしか居ないので、ゲームからは一度も走らない。採用が決まったら
 * 定義を revos.ts へ移すだけでいい。
 */
import type { RevosDef } from '../src/game/data/revos.ts';

export const EXP_DEFS: RevosDef[] = [
  {
    id: 'exp-plague', name: 'エクスＳ疫長', en: 'ExpS1', element: 'aqua', role: 'Debuffer',
    hp: 1240, atk: 106, def: 104, spd: 110, basicPower: 80,
    passive: {
      id: 'plaguelord', name: '蝕みの差配',
      desc: '敵が受けている状態異常の種類1つにつき、その敵への味方全体の与ダメージ +8%（最大 +32%）。',
    },
    od: {
      id: 'blight', name: '蔓延',
      desc: '敵全体に、その敵が受けている状態異常1つにつき 最大体力の 5% のダメージ。', power: 40,
    },
    sprite: 'pikaia',
    build: { archetype: 'aquatic', seed: 201, bulk: 1.0, scale: 1.0 },
    habitat: ['tidehollow'], rarity: 4, eventOnly: true, flavor: '試作。',
  },
  {
    id: 'exp-vector', name: 'エクスＳ媒介', en: 'ExpS2', element: 'flame', role: 'Sprinter',
    hp: 1090, atk: 114, def: 82, spd: 130, basicPower: 82,
    passive: {
      id: 'vector', name: '媒介',
      desc: '攻撃が当たると、その相手が受けている状態異常を1つ、最も近い別の敵へも写す。',
    },
    od: {
      id: 'contagion', name: '撒き散らす',
      desc: '単体に大ダメージ ＋ その相手が受けている状態異常を、敵全体へ写す。', power: 128,
    },
    sprite: 'velociraptor',
    build: { archetype: 'raptor', seed: 202, bulk: 1.0, scale: 1.0 },
    habitat: ['emberfield'], rarity: 4, eventOnly: true, flavor: '試作。',
  },
  {
    id: 'exp-ambush', name: 'エクスＲ奇襲', en: 'ExpR1', element: 'gale', role: 'Buffer',
    hp: 1010, atk: 98, def: 94, spd: 126, basicPower: 80,
    passive: {
      id: 'ambush', name: '奇襲',
      desc: '開戦と同時に、味方全体の行動ゲージ +25% ＋ 必殺 +25。',
    },
    od: {
      id: 'warcry', name: '畳みかけ',
      desc: '味方全体の 速度 +25% / 与ダメージ +18%（4行動）＋ 行動ゲージ +30%。', power: 0,
    },
    sprite: 'pteranodon',
    build: { archetype: 'pterosaur', seed: 203, bulk: 1.0, scale: 1.0 },
    habitat: ['canyon'], rarity: 4, eventOnly: true, flavor: '試作。',
  },
  {
    id: 'exp-gust', name: 'エクスＲ先駆', en: 'ExpR2', element: 'gale', role: 'Striker',
    hp: 1070, atk: 120, def: 86, spd: 128, basicPower: 86,
    passive: {
      id: 'headwind', name: '先駆けの風',
      desc: '戦闘開始から 30 秒のあいだ、味方全体の 与ダメージ +20% / 速度 +12%。以後は消える。',
    },
    od: {
      id: 'firstgust', name: '初手の颪',
      desc: '単体に大ダメージ。相手がまだ一度も行動していなければ威力2倍。', power: 134,
    },
    sprite: 'dimorphodon',
    build: { archetype: 'pterosaur', seed: 204, bulk: 1.0, scale: 1.0 },
    habitat: ['canyon'], rarity: 4, eventOnly: true, flavor: '試作。',
  },
  {
    id: 'exp-gustb', name: 'エクスＲ先駆B', en: 'ExpR2B', element: 'gale', role: 'Striker',
    hp: 1070, atk: 120, def: 86, spd: 128, basicPower: 86,
    passive: {
      id: 'headwindB', name: '先駆けの風',
      desc: '試作の段ちがい（20秒 +15%/+8%）。',
    },
    od: {
      id: 'firstgust', name: '初手の颪',
      desc: '単体に大ダメージ。相手がまだ一度も行動していなければ威力2倍。', power: 134,
    },
    sprite: 'dimorphodon',
    build: { archetype: 'pterosaur', seed: 204, bulk: 1.0, scale: 1.0 },
    habitat: ['canyon'], rarity: 4, eventOnly: true, flavor: '試作。',
  },
  {
    id: 'exp-gustc', name: 'エクスＲ先駆C', en: 'ExpR2C', element: 'gale', role: 'Striker',
    hp: 1070, atk: 120, def: 86, spd: 128, basicPower: 86,
    passive: {
      id: 'headwindC', name: '先駆けの風',
      desc: '試作の段ちがい（30秒 +12%/+8%）。',
    },
    od: {
      id: 'firstgust', name: '初手の颪',
      desc: '単体に大ダメージ。相手がまだ一度も行動していなければ威力2倍。', power: 134,
    },
    sprite: 'dimorphodon',
    build: { archetype: 'pterosaur', seed: 204, bulk: 1.0, scale: 1.0 },
    habitat: ['canyon'], rarity: 4, eventOnly: true, flavor: '試作。',
  },
  {
    id: 'exp-gustd', name: 'エクスＲ先駆D', en: 'ExpR2D', element: 'gale', role: 'Striker',
    hp: 1070, atk: 120, def: 86, spd: 128, basicPower: 86,
    passive: {
      id: 'headwindD', name: '先駆けの風',
      desc: '試作の段ちがい（15秒 +20%/+12%）。',
    },
    od: {
      id: 'firstgust', name: '初手の颪',
      desc: '単体に大ダメージ。相手がまだ一度も行動していなければ威力2倍。', power: 134,
    },
    sprite: 'dimorphodon',
    build: { archetype: 'pterosaur', seed: 204, bulk: 1.0, scale: 1.0 },
    habitat: ['canyon'], rarity: 4, eventOnly: true, flavor: '試作。',
  },
  {
    id: 'exp-chain', name: 'エクスＲ連鎖', en: 'ExpR3', element: 'null', role: 'Finisher',
    hp: 1100, atk: 124, def: 88, spd: 120, basicPower: 88,
    passive: {
      id: 'cascade', name: '追撃の連鎖',
      desc: '味方の誰かが敵を倒すと、味方全体の行動ゲージ +15%（自分は +40%）。',
    },
    od: {
      id: 'chainhunt', name: '狩りの連なり',
      desc: '単体に大ダメージ。倒しきれたら味方全体の 必殺 +30。', power: 146,
    },
    sprite: 'carnotaurus',
    build: { archetype: 'theropod', seed: 205, bulk: 1.0, scale: 1.0 },
    habitat: ['canyon'], rarity: 4, eventOnly: true, flavor: '試作。',
  },
];
