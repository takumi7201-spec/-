import type { ElementId } from '../../voxel/palette';
import type { Archetype } from '../../voxel/CreatureBuilder';
import type { TargetPref } from '../battle/types';

/**
 * ローンチ・ロスター 12体。
 *
 * 名称は実在分類群の語根（Ignis / Abyssus / Terra / Zephyrus 等）からの
 * 合成語で、原作固有の造語は使わない。
 * 数値は Lv1・クリーン度 C=50（Mc=1.00）時の基準値。
 */

export type Role =
  | 'Tank' | 'Striker' | 'Breaker' | 'Sprinter' | 'Guardian'
  | 'Healer' | 'Debuffer' | 'All-round' | 'Buffer' | 'Technical' | 'Finisher';

export type PassiveId =
  | 'subsidence' | 'embers' | 'deeppressure' | 'vanguard' | 'sediment'
  | 'heatreflect' | 'tide' | 'shearwind' | 'immutable' | 'resonance'
  | 'traction' | 'overheat';

export type OdId =
  | 'faultcrush' | 'flamevolley' | 'vortexfang' | 'galerend' | 'rockaegis'
  | 'scorchring' | 'tideheal' | 'erosionstorm' | 'obsidiancut' | 'resonantlight'
  | 'faulthaul' | 'greateruption';

export interface RevosDef {
  id: string;
  name: string;
  en: string;
  element: ElementId;
  role: Role;
  hp: number;
  atk: number;
  def: number;
  spd: number;
  passive: { id: PassiveId; name: string; desc: string };
  od: { id: OdId; name: string; desc: string; power: number };
  /** 通常攻撃の威力 P */
  basicPower: number;
  /** スプライト画像（public/sprites/<sprite>.png） */
  sprite: string;
  /** 推奨作戦。編成に加えたときの初期値になる */
  defaultPref: TargetPref;
  /** 化石の骨格生成に使う。見た目はスプライトだが、化石は立体で掘る */
  build: {
    archetype: Archetype;
    seed: number;
    bulk: number;
    scale: number;
    horns?: number;
    sail?: boolean;
    crest?: boolean;
    spikes?: boolean;
  };
  /** 出やすいバイオーム */
  habitat: ('canyon' | 'frostpeak' | 'emberfield' | 'tidehollow')[];
  rarity: 1 | 2 | 3 | 4;
  flavor: string;
}

export const REVOS: RevosDef[] = [
  {
    id: 'ankylosaurus', name: 'アンキロサウルス', en: 'Ankylosaurus', element: 'terra', role: 'Tank',
    hp: 1610, atk: 88, def: 144, spd: 72, basicPower: 85,
    passive: { id: 'subsidence', name: '地盤沈下', desc: '前列にいる間、被ダメージ −15%。撃破されると味方全体の OD +40。' },
    od: { id: 'faultcrush', name: '断層圧壊', desc: '単体に大ダメージ。対象の昇格を1行動遅延させる。', power: 185 },
    defaultPref: 'front',
    sprite: 'ankylosaurus',
    build: { archetype: 'ankylosaur', seed: 1011, bulk: 1.18, scale: 1.1 },
    habitat: ['canyon', 'frostpeak'], rarity: 2,
    flavor: '全身を骨質の装甲で覆い、尾の先に骨の塊を備える。倒れるときの震動が仲間を奮い立たせる。',
  },
  {
    id: 'yutyrannus', name: 'ユウティラヌス', en: 'Yutyrannus', element: 'flame', role: 'Striker',
    hp: 1040, atk: 140, def: 76, spd: 128, basicPower: 92,
    passive: { id: 'embers', name: '熾火', desc: '攻撃時 32% で火傷を付与（毎行動 最大HPの4%）。' },
    od: { id: 'flamevolley', name: '連焔衝', desc: '単体に2回攻撃。対象が火傷なら3回に増える。', power: 58 },
    defaultPref: 'support',
    sprite: 'yutyrannus',
    build: { archetype: 'raptor', seed: 2022, bulk: 0.92, scale: 0.92, crest: true },
    habitat: ['emberfield', 'canyon'], rarity: 2,
    flavor: '全身を羽毛で覆われた大型の肉食竜。羽の隙間に熱を溜め、走った跡の砂がガラス化する。',
  },
  {
    id: 'kronosaurus', name: 'クロノサウルス', en: 'Kronosaurus', element: 'aqua', role: 'Breaker',
    hp: 1420, atk: 126, def: 106, spd: 68, basicPower: 96,
    passive: { id: 'deeppressure', name: '深圧', desc: '自分より SPD が 20 以上高い相手への与ダメージ +14%。' },
    od: { id: 'vortexfang', name: '渦潮牙', desc: '単体に大ダメージ ＋ 対象の SPD −20%（3行動）。', power: 165 },
    defaultPref: 'defense',
    sprite: 'kronosaurus',
    build: { archetype: 'aquatic', seed: 3033, bulk: 1.15, scale: 1.08 },
    habitat: ['tidehollow'], rarity: 3,
    flavor: '短い首と巨大な頭をもつ海の捕食者。遅いのではなく、急ぐ必要がなかった。',
  },
  {
    id: 'pteranodon', name: 'プテラノドン', en: 'Pteranodon', element: 'gale', role: 'Sprinter',
    hp: 1000, atk: 120, def: 74, spd: 146, basicPower: 84,
    passive: { id: 'vanguard', name: '先陣', desc: '戦闘開始時 AV +3500。ロスター最速。' },
    od: { id: 'galerend', name: '疾風裂波', desc: '敵全体を切り裂き、自分の次の行動を早める。', power: 70 },
    defaultPref: 'back',
    sprite: 'pteranodon',
    build: { archetype: 'pterosaur', seed: 4044, bulk: 0.85, scale: 1.0, crest: true },
    habitat: ['frostpeak', 'canyon'], rarity: 3,
    flavor: '歯を持たない大型の翼竜。風を待たない。翼で風を作る側の生き物。',
  },
  {
    id: 'triceratops', name: 'トリケラトプス', en: 'Triceratops', element: 'terra', role: 'Guardian',
    hp: 1340, atk: 108, def: 128, spd: 84, basicPower: 90,
    passive: { id: 'sediment', name: '堆積', desc: '行動するたび自身の DEF +9%（最大 +45%、戦闘中持続）。' },
    od: { id: 'rockaegis', name: '岩盾展開', desc: '味方全体に DEF 基準の厚い吸収シールド（4行動）。', power: 0 },
    defaultPref: 'front',
    sprite: 'triceratops',
    build: { archetype: 'ceratopsian', seed: 5055, bulk: 1.05, scale: 1.05, horns: 5 },
    habitat: ['canyon', 'frostpeak'], rarity: 2,
    flavor: '三本の角と巨大な襟飾り。フリルは威嚇ではなく、風化した地層そのものを盾にしている。',
  },
  {
    id: 'goyocephale', name: 'ゴヨケファレ', en: 'Goyocephale', element: 'flame', role: 'Tank',
    hp: 1440, atk: 104, def: 130, spd: 70, basicPower: 86,
    passive: { id: 'heatreflect', name: '熱反射', desc: '被物理ダメージの 15% を攻撃者に返す。' },
    od: { id: 'scorchring', name: '焦熱環', desc: '敵全体を焼き、60% で火傷を付与。', power: 95 },
    defaultPref: 'front',
    sprite: 'goyocephale',
    build: { archetype: 'stegosaur', seed: 6066, bulk: 1.12, scale: 1.08, spikes: true },
    habitat: ['emberfield'], rarity: 3,
    flavor: '分厚い頭骨をもつ小型の堅頭竜。頭蓋に血流を通して放熱する。怒ると額が赤熱する。',
  },
  {
    id: 'shonisaurus', name: 'ショニサウルス', en: 'Shonisaurus', element: 'aqua', role: 'Healer',
    hp: 1260, atk: 100, def: 114, spd: 96, basicPower: 82,
    passive: { id: 'tide', name: '潮汐', desc: '味方が撃破されたとき、生存者を ATK×1.2 回復。' },
    od: { id: 'tideheal', name: '潮癒', desc: 'HP割合が最も低い味方を大回復 ＋ デバフを1つ解除。', power: 0 },
    defaultPref: 'lowhp',
    sprite: 'shonisaurus',
    build: { archetype: 'sauropod', seed: 7077, bulk: 0.95, scale: 1.06 },
    habitat: ['tidehollow'], rarity: 3,
    flavor: '全長20mに達する巨大な魚竜。群れの誰かが沈むと、残りが浮かび上がる。理由はまだ分かっていない。',
  },
  {
    id: 'velociraptor', name: 'ヴェロキラプトル', en: 'Velociraptor', element: 'gale', role: 'Debuffer',
    hp: 1120, atk: 114, def: 92, spd: 132, basicPower: 84,
    passive: { id: 'shearwind', name: '削風', desc: '通常攻撃の命中時、対象の DEF −8%（累積3回まで）。' },
    od: { id: 'erosionstorm', name: '風蝕嵐', desc: '敵全体にダメージ ＋ 全体の DEF −25%（4行動）。', power: 70 },
    defaultPref: 'back',
    sprite: 'velociraptor',
    build: { archetype: 'raptor', seed: 8088, bulk: 0.8, scale: 0.98, crest: true },
    habitat: ['frostpeak', 'tidehollow'], rarity: 3,
    flavor: '羽毛に覆われた小型の俊足種。通り過ぎた岩に細かい傷が残る。',
  },
  {
    id: 'tyrannosaurus', name: 'ティラノサウルス', en: 'Tyrannosaurus', element: 'null', role: 'All-round',
    hp: 1250, atk: 118, def: 112, spd: 98, basicPower: 88,
    passive: { id: 'immutable', name: '不変', desc: '属性相性を受けない（与・被ともに ×1.0 固定）。基礎値 +8% 込み。' },
    od: { id: 'obsidiancut', name: '黒曜断', desc: '単体に大ダメージ。対象のHPが50%未満ならさらに威力上昇。', power: 175 },
    defaultPref: 'lowhp',
    sprite: 'tyrannosaurus',
    build: { archetype: 'theropod', seed: 9099, bulk: 1.0, scale: 1.02 },
    habitat: ['canyon', 'emberfield', 'frostpeak', 'tidehollow'], rarity: 3,
    flavor: '白亜紀末の頂点捕食者。骨が黒曜石に置換されており、どの属性の力も通り抜けていく。',
  },
  {
    id: 'pachycephalosaurus', name: 'パキケファロサウルス', en: 'Pachycephalosaurus', element: 'null', role: 'Buffer',
    hp: 1160, atk: 108, def: 110, spd: 116, basicPower: 82,
    passive: { id: 'resonance', name: '共鳴', desc: '自分の行動時、味方全体の OD +8。' },
    od: { id: 'resonantlight', name: '共鳴光', desc: '味方全体の ATK +18%（4行動）＋ 全体の OD +15。', power: 0 },
    defaultPref: 'support',
    sprite: 'pachycephalosaurus',
    build: { archetype: 'ceratopsian', seed: 10110, bulk: 0.9, scale: 1.0, horns: 3 },
    habitat: ['frostpeak', 'canyon'], rarity: 3,
    flavor: '厚さ25cmの頭蓋をもつ堅頭竜。頭骨が共鳴して低い音を出し、群れの呼吸が揃っていく。',
  },
  {
    id: 'iguanodon', name: 'イグアノドン', en: 'Iguanodon', element: 'terra', role: 'Technical',
    hp: 1400, atk: 138, def: 112, spd: 88, basicPower: 92,
    passive: { id: 'traction', name: '牽引', desc: '後列の敵への与ダメージ +34%。' },
    od: { id: 'faulthaul', name: '断層牽引', desc: '敵後列1体を強制的に前列へ引きずり出す（2行動）。', power: 120 },
    defaultPref: 'back',
    sprite: 'iguanodon',
    build: { archetype: 'theropod', seed: 11121, bulk: 1.08, scale: 1.06, sail: true },
    habitat: ['canyon', 'emberfield'], rarity: 3,
    flavor: '親指に鋭い棘をもつ大型の鳥脚類。獲物を隊列ごと引きずり、逃げ場を消してから突く。',
  },
  {
    id: 'spinosaurus', name: 'スピノサウルス', en: 'Spinosaurus', element: 'flame', role: 'Finisher',
    hp: 1180, atk: 142, def: 84, spd: 92, basicPower: 94,
    passive: { id: 'overheat', name: '過熱', desc: '自分のHPが低いほど与ダメージ上昇（最大 +35%）。ロスター最高火力。' },
    od: { id: 'greateruption', name: '大噴火', desc: '敵全体を焼き払い火傷を付与。自身のHPを12%消費する。', power: 112 },
    defaultPref: 'lowhp',
    sprite: 'spinosaurus',
    build: { archetype: 'theropod', seed: 12131, bulk: 1.14, scale: 1.12, sail: true, spikes: true },
    habitat: ['emberfield'], rarity: 4,
    flavor: '背の帆が体温を制御する最大級の肉食竜。瀕死になるほど熱が上がる。',
  },
];

export const REVOS_BY_ID = new Map(REVOS.map((r) => [r.id, r]));

export function getRevos(id: string): RevosDef {
  const r = REVOS_BY_ID.get(id);
  if (!r) throw new Error(`unknown revos: ${id}`);
  return r;
}

export const RARITY_NAMES = ['', 'コモン', 'レア', 'エピック', 'レジェンド'] as const;
export const RARITY_COLORS = ['', '#c8c2b4', '#6fc8e8', '#c898f0', '#ffc84a'] as const;
