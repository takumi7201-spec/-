import type { ElementId } from '../../voxel/palette';
import type { Archetype } from '../../voxel/CreatureBuilder';
import type { TargetPref } from '../battle/types';

/**
 * ローンチ・ロスター 19体。
 *
 * 名称は実在分類群の語根（Ignis / Abyssus / Terra / Zephyrus 等）からの
 * 合成語で、原作固有の造語は使わない。
 * 数値は Lv1・クリーン度 C=50（Mc=1.00）時の基準値。
 */

export type Role =
  | 'Tank' | 'Striker' | 'Breaker' | 'Sprinter' | 'Guardian'
  | 'Healer' | 'Debuffer' | 'All-round' | 'Buffer' | 'Technical' | 'Finisher'
  | 'Apex';

export type PassiveId =
  | 'subsidence' | 'embers' | 'deeppressure' | 'vanguard' | 'sediment'
  | 'heatreflect' | 'tide' | 'shearwind' | 'immutable' | 'resonance'
  | 'traction' | 'overheat' | 'pursuit' | 'deepreign'
  | 'oldtyrant' | 'archivesail'
  | 'skygrasp' | 'platescreen' | 'greatbeak'
  | 'islandapex' | 'earthbreath' | 'warlord';

export type OdId =
  | 'faultcrush' | 'flamevolley' | 'vortexfang' | 'galerend' | 'rockaegis'
  | 'scorchring' | 'tideheal' | 'erosionstorm' | 'obsidiancut' | 'resonantlight'
  | 'faulthaul' | 'greateruption' | 'crushbite' | 'abyssalmaw'
  | 'galemaw' | 'stratarecord'
  | 'skyreign' | 'spikebore' | 'leapstrike'
  | 'hatzegwing' | 'grindfeed' | 'tyrantrequiem';

export interface RevosDef {
  id: string;
  name: string;
  /**
   * カードや編成スロットのような幅の狭い場所で使う短縮名。
   * 省略記号で切ると「プリオサウルス …」と「プリオサウルス」が
   * 見分けられなくなるので、切るのではなく別名を持たせる。
   */
  short?: string;
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
  rarity: 1 | 2 | 3 | 4 | 5;
  /**
   * 発掘では出ない個体。イベント戦の報酬だけで手に入る。
   * 地層に埋まっていない＝図鑑の産出欄も「産出なし」になる。
   */
  eventOnly?: boolean;
  flavor: string;
}

export const REVOS: RevosDef[] = [
  {
    id: 'ankylosaurus', name: 'アンキロサウルス', en: 'Ankylosaurus', element: 'terra', role: 'Tank',
    hp: 1654, atk: 100, def: 149, spd: 76, basicPower: 90,
    passive: { id: 'subsidence', name: '地盤沈下', desc: '前列にいる間、被ダメージ −15%。撃破されると味方全体の 必殺 +40。' },
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
    passive: { id: 'embers', name: '熾火', desc: '攻撃時 32% で火傷を付与（毎行動 最大体力の4%）。' },
    od: { id: 'flamevolley', name: '連焔衝', desc: '単体に2回攻撃。対象が火傷なら3回に増える。', power: 58 },
    defaultPref: 'support',
    sprite: 'yutyrannus',
    build: { archetype: 'raptor', seed: 2022, bulk: 0.92, scale: 0.92, crest: true },
    habitat: ['emberfield', 'canyon'], rarity: 2,
    flavor: '全身を羽毛で覆われた大型の肉食竜。羽の隙間に熱を溜め、走った跡の砂がガラス化する。',
  },
  {
    id: 'kronosaurus', name: 'クロノサウルス', en: 'Kronosaurus', element: 'aqua', role: 'Breaker',
    hp: 1420, atk: 142, def: 106, spd: 78, basicPower: 100,
    passive: { id: 'deeppressure', name: '深圧', desc: '自分より 速度 が 20 以上高い相手への与ダメージ +14%。' },
    od: { id: 'vortexfang', name: '渦潮牙', desc: '単体に大ダメージ ＋ 対象の 速度 −20%（3行動）。', power: 165 },
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
    hp: 1340, atk: 108, def: 122, spd: 84, basicPower: 90,
    passive: { id: 'sediment', name: '堆積', desc: '行動するたび自身の 防御 +9%（最大 +45%、戦闘中持続）。' },
    od: { id: 'rockaegis', name: '岩盾展開', desc: '味方全体に 防御 基準の厚い吸収シールド（4行動）。', power: 0 },
    defaultPref: 'front',
    sprite: 'triceratops',
    build: { archetype: 'ceratopsian', seed: 5055, bulk: 1.05, scale: 1.05, horns: 5 },
    habitat: ['canyon', 'frostpeak'], rarity: 2,
    flavor: '三本の角と巨大な襟飾り。フリルは威嚇ではなく、風化した地層そのものを盾にしている。',
  },
  {
    id: 'goyocephale', name: 'ゴヨケファレ', en: 'Goyocephale', element: 'flame', role: 'Tank',
    hp: 1500, atk: 116, def: 130, spd: 74, basicPower: 90,
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
    hp: 1370, atk: 106, def: 126, spd: 100, basicPower: 84,
    passive: { id: 'tide', name: '潮汐', desc: '行動のたび、最も傷ついた味方を 攻撃×0.46 回復。味方が撃破されたときは生存者全員を 攻撃×1.2 回復。' },
    od: { id: 'tideheal', name: '潮癒', desc: '体力割合が最も低い味方を大回復 ＋ デバフを1つ解除。', power: 0 },
    defaultPref: 'lowhp',
    sprite: 'shonisaurus',
    build: { archetype: 'sauropod', seed: 7077, bulk: 0.95, scale: 1.06 },
    habitat: ['tidehollow'], rarity: 3,
    flavor: '全長20mに達する巨大な魚竜。群れの誰かが沈むと、残りが浮かび上がる。理由はまだ分かっていない。',
  },
  {
    id: 'velociraptor', name: 'ヴェロキラプトル', en: 'Velociraptor', element: 'gale', role: 'Debuffer',
    hp: 1120, atk: 108, def: 92, spd: 132, basicPower: 82,
    passive: { id: 'shearwind', name: '削風', desc: '通常攻撃の命中時、対象の 防御 −8%（累積3回まで）。' },
    od: { id: 'erosionstorm', name: '風蝕嵐', desc: '敵全体にダメージ ＋ 全体の 防御 −25%（4行動）。', power: 70 },
    defaultPref: 'back',
    sprite: 'velociraptor',
    build: { archetype: 'raptor', seed: 8088, bulk: 0.8, scale: 0.98, crest: true },
    habitat: ['frostpeak', 'tidehollow'], rarity: 3,
    flavor: '羽毛に覆われた小型の俊足種。通り過ぎた岩に細かい傷が残る。',
  },
  {
    id: 'tyrannosaurus', name: 'ティラノサウルス', en: 'Tyrannosaurus', element: 'null', role: 'All-round',
    hp: 1250, atk: 134, def: 112, spd: 98, basicPower: 90,
    passive: { id: 'immutable', name: '不変', desc: '属性相性を受けない（与・被ともに ×1.0 固定）。基礎値 +8% 込み。' },
    od: { id: 'obsidiancut', name: '黒曜断', desc: '単体に大ダメージ。対象の体力が50%未満ならさらに威力上昇。', power: 175 },
    defaultPref: 'lowhp',
    sprite: 'tyrannosaurus',
    build: { archetype: 'theropod', seed: 9099, bulk: 1.0, scale: 1.02 },
    habitat: ['canyon', 'emberfield', 'frostpeak', 'tidehollow'], rarity: 3,
    flavor: '白亜紀末の頂点捕食者。骨が黒曜石に置換されており、どの属性の力も通り抜けていく。',
  },
  {
    id: 'pachycephalosaurus', name: 'パキケファロサウルス', short: 'パキケファロ', en: 'Pachycephalosaurus', element: 'null', role: 'Buffer',
    hp: 1160, atk: 118, def: 110, spd: 116, basicPower: 86,
    passive: { id: 'resonance', name: '共鳴', desc: '自分の行動時、味方全体の 必殺 +10。' },
    od: { id: 'resonantlight', name: '共鳴光', desc: '味方全体の 攻撃 +18%（4行動）＋ 全体の 必殺 +15。', power: 0 },
    defaultPref: 'support',
    sprite: 'pachycephalosaurus',
    build: { archetype: 'ceratopsian', seed: 10110, bulk: 0.9, scale: 1.0, horns: 3 },
    habitat: ['frostpeak', 'canyon'], rarity: 3,
    flavor: '厚さ25cmの頭蓋をもつ堅頭竜。頭骨が共鳴して低い音を出し、群れの呼吸が揃っていく。',
  },
  {
    id: 'iguanodon', name: 'イグアノドン', en: 'Iguanodon', element: 'terra', role: 'Technical',
    hp: 1448, atk: 143, def: 117, spd: 91, basicPower: 95,
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
    passive: { id: 'overheat', name: '過熱', desc: '自分の体力が低いほど与ダメージ上昇（最大 +35%）。ロスター最高火力。' },
    od: { id: 'greateruption', name: '大噴火', desc: '敵全体を焼き払い火傷を付与。自身の体力を12%消費する。', power: 112 },
    defaultPref: 'lowhp',
    sprite: 'spinosaurus',
    build: { archetype: 'theropod', seed: 12131, bulk: 1.14, scale: 1.12, sail: true, spikes: true },
    habitat: ['emberfield'], rarity: 4,
    flavor: '背の帆が体温を制御する最大級の肉食竜。瀕死になるほど熱が上がる。',
  },
  {
    id: 'pliosaurus', name: 'プリオサウルス', en: 'Pliosaurus', element: 'aqua', role: 'Striker',
    hp: 1210, atk: 134, def: 96, spd: 106, basicPower: 90,
    passive: { id: 'pursuit', name: '追い波', desc: '自分が敵を撃破すると AV +3800。倒した勢いのまま次へ入る。' },
    od: { id: 'crushbite', name: '圧砕顎', desc: '単体に大ダメージ。シールドを貫通する。', power: 168 },
    defaultPref: 'lowhp',
    sprite: 'pliosaurus',
    build: { archetype: 'aquatic', seed: 13141, bulk: 1.06, scale: 1.04 },
    habitat: ['tidehollow', 'frostpeak'], rarity: 4,
    flavor: '四枚のひれで水を掴む短首の首長竜。噛む力は顎の骨そのものを変形させるほどで、獲物の殻ごと砕く。',
  },
  {
    id: 'pliosaurus-funkei', name: 'プリオサウルス フンケイ', short: 'フンケイ', en: 'Pliosaurus funkei', element: 'aqua', role: 'Apex',
    hp: 1288, atk: 129, def: 112, spd: 98, basicPower: 88,
    passive: { id: 'deepreign', name: '制海', desc: '自分が生きている間、敵全体の 必殺 獲得 −15%。' },
    od: { id: 'abyssalmaw', name: '絶海断', desc: '敵全体に大ダメージ。シールドを貫通する。', power: 104 },
    defaultPref: 'front',
    sprite: 'pliosaurus-funkei',
    build: { archetype: 'aquatic', seed: 14151, bulk: 1.24, scale: 1.14, spikes: true },
    habitat: ['tidehollow'], rarity: 5,
    flavor: '全長12mを超える最大級の首長竜。スヴァールバルの凍った泥から2体ぶんだけ見つかっている。海に出た捕食者の到達点で、同じ海に二番手はいなかった。',
  },
  {
    id: 'tyrannosaurus-1915', name: 'ティラノサウルス 1915', short: 'ティラノ1915',
    en: 'Tyrannosaurus (1915)', element: 'gale', role: 'Striker',
    hp: 1180, atk: 128, def: 92, spd: 110, basicPower: 90,
    passive: { id: 'oldtyrant', name: '旧き暴君', desc: '自分より 体力 割合が高い敵への与ダメージ +16%。傷のない相手から順に潰す。' },
    od: { id: 'galemaw', name: '烈風顎', desc: '単体に大ダメージ ＋ 自分の次の行動を早める。', power: 160 },
    defaultPref: 'front',
    sprite: 'tyrannosaurus-1915',
    build: { archetype: 'theropod', seed: 15161, bulk: 1.02, scale: 1.04 },
    habitat: [], rarity: 4, eventOnly: true,
    flavor: '1915年に組み上げられた姿。尾を引きずり、身を起こして立つ——いまは誤りとされた復元だが、その時代の博物館ではこれが暴君の全てだった。',
  },
  {
    id: 'spinosaurus-1915', name: 'スピノサウルス 1915', short: 'スピノ1915',
    en: 'Spinosaurus (1915)', element: 'terra', role: 'Buffer',
    hp: 1380, atk: 120, def: 128, spd: 94, basicPower: 88,
    passive: { id: 'archivesail', name: '記録の帆', desc: '味方が特殊攻撃を撃つたび、その味方の 攻撃 +12%（1体につき3回まで、戦闘中持続）。' },
    od: { id: 'stratarecord', name: '古層の記録', desc: '味方全体の 必殺 +25 ＋ 全体の与ダメージ +20%（4行動）。', power: 0 },
    defaultPref: 'support',
    sprite: 'spinosaurus-1915',
    build: { archetype: 'theropod', seed: 16171, bulk: 1.1, scale: 1.08, sail: true },
    habitat: [], rarity: 4, eventOnly: true,
    flavor: '1915年、ストローマーが記載した最初の姿。原標本は戦火で焼け、残ったのは図版と記述だけ。いま復元されるどの姿より、この一枚のほうが長く生きている。',
  },
  {
    id: 'quetzalcoatlus', name: 'ケツァルコアトルス', short: 'ケツァル',
    en: 'Quetzalcoatlus', element: 'gale', role: 'Buffer',
    hp: 1160, atk: 104, def: 98, spd: 126, basicPower: 79,
    passive: {
      id: 'skygrasp', name: '掌握する空',
      desc: '味方の攻撃が奇数回目になるたび、味方全体の 攻撃 +5%（最大 +15%）。+15% の間は味方全体の 必殺 獲得 +20%。自分が倒れると効果は消える。',
    },
    od: {
      id: 'skyreign', name: '制空覇道',
      desc: '味方全体の 速度 +30% / 防御 +20%（10秒）。', power: 0,
    },
    defaultPref: 'support',
    sprite: 'quetzalcoatlus',
    build: { archetype: 'pterosaur', seed: 17181, bulk: 1.02, scale: 1.16, crest: true },
    habitat: ['canyon', 'frostpeak'], rarity: 5,
    flavor: '翼を広げれば10mを超える、空を飛んだ最大の生き物。地に降りればキリンの背丈で歩き、見上げる空には競合がいなかった。',
  },
  {
    id: 'hatzegopteryx', name: 'ハツェゴプテリクス', short: 'ハツェゴ',
    en: 'Hatzegopteryx', element: 'flame', role: 'All-round',
    hp: 1230, atk: 118, def: 100, spd: 110, basicPower: 87,
    passive: {
      id: 'islandapex', name: '島の頂点',
      desc: 'このユニットの攻撃が通ったとき、一度だけ 攻撃 +20%（戦闘中ずっと残る）。',
    },
    od: {
      id: 'hatzegwing', name: 'ハツェグの翼',
      desc: '敵全体に大ダメージ ＋ 味方全体の 速度 +10%（4行動）。', power: 83,
    },
    defaultPref: 'front',
    sprite: 'hatzegopteryx',
    build: { archetype: 'pterosaur', seed: 19191, bulk: 1.14, scale: 1.12, crest: true },
    habitat: ['emberfield', 'canyon'], rarity: 5,
    flavor: '島には大型の獣脚類がいなかった。翼を畳んで四足で歩き、地上の獲物を狩る翼竜が、そこでは頂点に立っていた。',
  },
  {
    id: 'tyrannosaurus-sue', name: 'ティラノサウルス スー', short: 'スー',
    en: 'Tyrannosaurus "Sue"', element: 'null', role: 'Apex',
    hp: 1900, atk: 140, def: 138, spd: 94, basicPower: 94,
    passive: {
      id: 'warlord', name: '歴戦の暴君',
      desc: '属性相性を使わない。自分が与えるダメージも受けるダメージも、相手の属性に関わらず ×1.5。',
    },
    od: {
      id: 'tyrantrequiem', name: '覇王鎮魂・六千万年ノ咬',
      desc: '単体に特大ダメージ ＋ 対象の被ダメージ +20%（2行動）。', power: 186,
    },
    defaultPref: 'defense',
    sprite: 'tyrannosaurus-sue',
    build: { archetype: 'theropod', seed: 20202, bulk: 1.12, scale: 1.1 },
    habitat: ['canyon', 'emberfield'], rarity: 5,
    flavor: '1990年、サウスダコタの丘で見つかった最も完全な一体。折れて癒えた肋骨、噛まれた跡の残る顎——三十年ぶんの傷を抱えたまま、六千万年を越えて掘り出された。',
  },
  {
    id: 'brachiosaurus', name: 'ブラキオサウルス', short: 'ブラキオ',
    en: 'Brachiosaurus', element: 'terra', role: 'Healer',
    hp: 2140, atk: 100, def: 150, spd: 80, basicPower: 80,
    passive: {
      id: 'earthbreath', name: '大地の伊吹',
      desc: '味方が受ける回復量 +15%（自分の回復も含む）。',
    },
    od: {
      id: 'grindfeed', name: '磨り潰し消化',
      desc: '味方全体に再生（5秒）。合計で自分の最大 体力 の 1/5 ぶんを回復する。', power: 0,
    },
    defaultPref: 'lowhp',
    sprite: 'brachiosaurus',
    build: { archetype: 'sauropod', seed: 20202, bulk: 1.3, scale: 1.24 },
    habitat: ['canyon', 'emberfield'], rarity: 5,
    flavor: '前肢が後肢より長い、傾いた体。胃石で磨り潰して呑み下す消化のために、数十キロの石を抱えて歩いていた。',
  },
  {
    id: 'stegosaurus', name: 'ステゴサウルス', en: 'Stegosaurus', element: 'flame', role: 'Guardian',
    hp: 1762, atk: 103, def: 165, spd: 81, basicPower: 91,
    passive: {
      id: 'platescreen', name: '板の放熱',
      desc: '自分が前列にいる間、後列の味方が狙われたとき 45% で肩代わりする。',
    },
    od: {
      id: 'spikebore', name: '尾棘穿孔',
      desc: '単体に大ダメージ ＋ 対象の 攻撃 −22%（4行動）。', power: 158,
    },
    defaultPref: 'front',
    sprite: 'stegosaurus',
    build: { archetype: 'stegosaur', seed: 18191, bulk: 1.2, scale: 1.12, spikes: true },
    habitat: ['emberfield', 'canyon'], rarity: 3,
    flavor: '背に二列の骨板を並べ、尾の先に四本の棘を持つ。板には血管の溝が走っていて、熱を逃がしていたと考えられている。',
  },
  {
    id: 'diatryma', name: 'ディアトリマ', en: 'Diatryma', element: 'null', role: 'Breaker',
    hp: 1170, atk: 123, def: 87, spd: 107, basicPower: 94,
    passive: {
      id: 'greatbeak', name: '大喙',
      desc: '通常攻撃の与ダメージ +22%。ただし 必殺 の溜まりが 20% 遅い。',
    },
    od: {
      id: 'leapstrike', name: '跳襲',
      desc: '単体に大ダメージ ＋ 対象の被ダメージ +25%（3行動）。', power: 150,
    },
    defaultPref: 'lowhp',
    sprite: 'diatryma',
    build: { archetype: 'raptor', seed: 19201, bulk: 1.08, scale: 1.02, crest: true },
    habitat: ['emberfield', 'tidehollow'], rarity: 3,
    flavor: '恐竜が去ったあとの森を歩いた、身長2mの飛べない鳥。斧のような嘴だけが残っていて、それで何を割っていたのかは今も決まっていない。',
  },
];

export const REVOS_BY_ID = new Map(REVOS.map((r) => [r.id, r]));

/** 幅の狭い UI 用の名前。短縮名がなければ正式名をそのまま返す */
export function revosShortName(id: string): string {
  const r = getRevos(id);
  return r.short ?? r.name;
}

export function getRevos(id: string): RevosDef {
  const r = REVOS_BY_ID.get(id);
  if (!r) throw new Error(`unknown revos: ${id}`);
  return r;
}

/** ★5 は「ホロタイプ」——その種を定義する、ただ1つの標本 */
export const RARITY_NAMES = ['', 'コモン', 'レア', 'エピック', 'レジェンド', 'ホロタイプ'] as const;

/**
 * 役割の並び順。
 *
 * 役割名の五十音でも英字順でもなく、盤面での立ち位置で並べる——
 * 守る・殴る・速い・支える・搦める、の順。図鑑を役割で並べたときに、
 * 編成のどの穴を埋める個体なのかが上から順に読める。
 */
export const ROLE_ORDER: Role[] = [
  'Tank', 'Guardian',
  'Striker', 'Breaker', 'Finisher',
  'Sprinter',
  'Healer', 'Buffer',
  'Debuffer', 'Technical',
  'All-round', 'Apex',
];

/** 役割の表示名。データ側は英語の識別子のまま、画面には日本語だけを出す */
export const ROLE_NAMES: Record<Role, string> = {
  Tank: '壁役',
  Striker: '打撃役',
  Breaker: '崩し役',
  Sprinter: '先行役',
  Guardian: '守護役',
  Healer: '回復役',
  Debuffer: '妨害役',
  'All-round': '万能役',
  Buffer: '支援役',
  Technical: '搦め手',
  Finisher: '仕留め役',
  Apex: '頂点種',
};
export const RARITY_COLORS = ['', '#c8c2b4', '#6fc8e8', '#c898f0', '#ffc84a', '#e8623c'] as const;
