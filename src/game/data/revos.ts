import type { ElementId } from '../../voxel/palette';
import type { Archetype } from '../../voxel/CreatureBuilder';

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
  | 'islandapex' | 'earthbreath' | 'warlord'
  | 'firstbite' | 'greateye' | 'twinhorn' | 'runningcharge' | 'scytheclaw' | 'venomgland'
  | 'primordial' | 'carapace' | 'irritate' | 'jetwake' | 'packrun'
  | 'sailheat' | 'unreadable' | 'cannibal' | 'fourwings'
  | 'sabertooth' | 'goodmother' | 'firstnerve' | 'compoundeye' | 'twinbite';

export type OdId =
  | 'faultcrush' | 'flamevolley' | 'vortexfang' | 'galerend' | 'rockaegis'
  | 'scorchring' | 'tideheal' | 'erosionstorm' | 'obsidiancut' | 'resonantlight'
  | 'faulthaul' | 'greateruption' | 'crushbite' | 'abyssalmaw'
  | 'galemaw' | 'stratarecord'
  | 'skyreign' | 'spikebore' | 'leapstrike'
  | 'hatzegwing' | 'grindfeed' | 'tyrantrequiem'
  | 'forkjaw' | 'gazepierce' | 'hornrout' | 'crimsoncharge' | 'harvest' | 'serpentvenom'
  | 'cambrianjaw' | 'shellveil' | 'falsejaw' | 'straightbore' | 'boundfang'
  | 'heatshare' | 'tangledspiral' | 'bonesever' | 'glideguard'
  | 'throatbite' | 'nestguard' | 'nervejam' | 'trilobeshield' | 'twinsever';

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
  habitat: ('canyon' | 'frostpeak' | 'emberfield' | 'tidehollow' | 'permitzone')[];
  rarity: 1 | 2 | 3 | 4 | 5;
  /**
   * 発掘では出ない個体。イベント戦の報酬だけで手に入る。
   * 地層に埋まっていない＝図鑑の産出欄も「産出なし」になる。
   */
  eventOnly?: boolean;
  /**
   * 特別許可区だけで出る個体。通常の発掘にも商店の原石にも混ざらない。
   * チケットを切った先にしか居ない、という約束をデータ側で守る。
   * ホロタイプ（★5）は全てこれに該当する
   */
  permitOnly?: boolean;
  flavor: string;
}

export const REVOS: RevosDef[] = [
  {
    id: 'tylosaurus', name: 'ティロサウルス', short: 'ティロ', en: 'Tylosaurus',
    element: 'gale', role: 'Apex',
    // 2ヒットになるぶん、攻撃力は攻め役の中でいちばん低い位置に置く。
    // ★5 としての強さは、噛み付いて離さない耐久の側で持たせる
    hp: 2020, atk: 96, def: 134, spd: 104, basicPower: 86,
    passive: {
      id: 'twinbite', name: '二重捕咬',
      desc: '攻撃が当たると 35% で、相手を 1 秒 その場に縫い止める。',
    },
    od: {
      id: 'twinsever', name: '二重絶咬・内腔呑滅',
      desc: '以後 5 回の通常攻撃が 2 ヒットになる。', power: 0,
    },
    sprite: 'tylosaurus',
    build: { archetype: 'aquatic', seed: 6521, bulk: 1.22, scale: 1.12 },
    habitat: ['permitzone'], rarity: 5, permitOnly: true,
    flavor: '顎の天井にもう一列の歯を備える。一度くわえた獲物は、喉の奥へ送られるまで外れない。',
  },
  {
    id: 'smilodon', name: 'スミロドン', en: 'Smilodon', element: 'null', role: 'Finisher',
    hp: 1060, atk: 123, def: 86, spd: 116, basicPower: 90,
    passive: {
      id: 'sabertooth', name: '断牙',
      desc: '通常攻撃の命中時に 出血 を1つ重ねる。火傷・毒・目眩・出血のいずれかを受けている相手への与ダメージ +40%。',
    },
    od: {
      id: 'throatbite', name: '喉笛を裂く',
      desc: '単体に大ダメージ ＋ 出血を3つ重ねる。', power: 136,
    },
    sprite: 'smilodon',
    build: { archetype: 'theropod', seed: 6101, bulk: 0.96, scale: 0.96 },
    habitat: ['frostpeak', 'canyon'], rarity: 4,
    flavor: '恐竜の世が終わってから現れた牙。弱った獲物の喉だけを、正確に裂いていた。',
  },
  {
    id: 'maiasaura', name: 'マイアサウラ', short: 'マイア', en: 'Maiasaura',
    element: 'terra', role: 'Healer',
    hp: 1642, atk: 106, def: 140, spd: 88, basicPower: 82,
    passive: {
      id: 'goodmother', name: '良い母',
      desc: '自分が渡した回復の 30% ぶん、その相手にシールドも張る。',
    },
    od: {
      id: 'nestguard', name: '巣を囲う',
      desc: '味方全体を回復 ＋ 防御 +25%（4行動）。', power: 0,
    },
    sprite: 'maiasaura',
    build: { archetype: 'sauropod', seed: 6207, bulk: 1.12, scale: 1.05, crest: true },
    habitat: ['canyon', 'frostpeak'], rarity: 3,
    flavor: '「良い母トカゲ」。巣に卵と幼体が揃って見つかり、恐竜が子を世話したことが分かった。',
  },
  {
    id: 'pikaia', name: 'ピカイア', en: 'Pikaia', element: 'aqua', role: 'Debuffer',
    hp: 979, atk: 88, def: 92, spd: 120, basicPower: 80,
    passive: {
      id: 'firstnerve', name: '原始の神経',
      desc: '通常攻撃の命中時 50% で 目眩（命中率が下がる）。',
    },
    od: {
      id: 'nervejam', name: '神経の澱み',
      desc: '敵全体に 目眩 ＋ 速度 −20%（4行動）。', power: 58,
    },
    sprite: 'pikaia',
    build: { archetype: 'aquatic', seed: 6311, bulk: 0.68, scale: 0.78 },
    habitat: ['tidehollow'], rarity: 1,
    flavor: '背に一本の筋を通した5センチの体。脊索をもつ最初期の一群とされ、神経の束がここから始まる。',
  },
  {
    id: 'paradoxides', name: 'パラドキシデス', short: 'パラドキ', en: 'Paradoxides',
    element: 'aqua', role: 'Guardian',
    hp: 1761, atk: 112, def: 144, spd: 92, basicPower: 86,
    passive: {
      id: 'compoundeye', name: '原始の複眼',
      desc: '自分は 目眩 にならない。目眩を受けている敵への、味方全体の与ダメージ +15%。',
    },
    od: {
      id: 'trilobeshield', name: '三葉の盾',
      desc: '味方全体の被ダメージ −22%（4行動）。', power: 0,
    },
    sprite: 'paradoxides',
    build: { archetype: 'aquatic', seed: 6419, bulk: 1.08, scale: 0.98 },
    habitat: ['tidehollow', 'canyon'], rarity: 2,
    flavor: '三葉に分かれた殻と、方解石でできた複眼。見るための器官を、生き物が初めて手に入れた形。',
  },
  {
    id: 'anomalocaris', name: 'アノマロカリス', short: 'アノマロ', en: 'Anomalocaris',
    element: 'null', role: 'Sprinter',
    hp: 1029, atk: 112, def: 76, spd: 138, basicPower: 84,
    passive: {
      id: 'primordial', name: '原初の捕食者',
      desc: '後衛（回復・支援・妨害・搦め手）への与ダメージ +35%。',
    },
    od: {
      id: 'cambrianjaw', name: 'カンブリアの顎',
      desc: '奥にいる敵1体に大ダメージ ＋ しばらくその場から動けなくする。', power: 158,
    },
    sprite: 'anomalocaris',
    build: { archetype: 'aquatic', seed: 5101, bulk: 0.82, scale: 0.86 },
    habitat: ['tidehollow'], rarity: 2,
    flavor: 'どの系統にも当てはまらない。捕食という振る舞いだけが、後の五億年へ受け継がれた。',
  },
  {
    id: 'archelon', name: 'アーケロン', en: 'Archelon', element: 'aqua', role: 'Tank',
    hp: 1541, atk: 79, def: 152, spd: 70, basicPower: 88,
    passive: {
      id: 'carapace', name: '甲羅',
      desc: '体力が半分を切っている間、被ダメージ −22%。',
    },
    od: {
      id: 'shellveil', name: '潜行甲殻',
      desc: '味方全体にシールド。自分のぶんは2倍。', power: 0,
    },
    sprite: 'archelon',
    build: { archetype: 'aquatic', seed: 5203, bulk: 1.3, scale: 1.16 },
    habitat: ['tidehollow', 'frostpeak'], rarity: 3,
    flavor: '差し渡し4メートルの甲羅。砂に乗り上げたまま、波が引くのを待つ姿勢のまま残った。',
  },
  {
    id: 'irritator', name: 'イリテーター', en: 'Irritator', element: 'flame', role: 'Debuffer',
    hp: 1208, atk: 103, def: 100, spd: 116, basicPower: 82,
    passive: {
      id: 'irritate', name: '苛立たせる',
      desc: '自分を攻撃した相手の 攻撃 −10%（3回まで重なる）。',
    },
    od: {
      id: 'falsejaw', name: '偽りの顎',
      desc: '敵全体にダメージ ＋ 攻撃 −20%（4行動）。', power: 64,
    },
    sprite: 'irritator',
    build: { archetype: 'theropod', seed: 5307, bulk: 0.94, scale: 0.98 },
    habitat: ['emberfield', 'tidehollow'], rarity: 2,
    flavor: '記載者を苛立たせた贋作の吻。継ぎ足された石膏を剥がすと、本物の骨が出てきた。',
  },
  {
    id: 'orthoceras', name: 'オルソセラス', short: 'オルソ', en: 'Orthoceras',
    element: 'aqua', role: 'Technical',
    hp: 1361, atk: 125, def: 96, spd: 104, basicPower: 86,
    passive: {
      id: 'jetwake', name: '噴射',
      desc: '下がった直後の一撃 +25%。寄られるほど強く撃ち返す。',
    },
    od: {
      id: 'straightbore', name: '直角の螺旋',
      desc: '一直線上の敵を貫く（最大2体）。', power: 132,
    },
    sprite: 'orthoceras',
    build: { archetype: 'aquatic', seed: 5411, bulk: 0.76, scale: 0.82 },
    habitat: ['tidehollow', 'canyon'], rarity: 1,
    flavor: 'まっすぐな殻。巻くことを覚える前の海で、噴射だけを頼りに泳いでいた。',
  },
  {
    id: 'coelophysis', name: 'コエロフィシス', short: 'コエロ', en: 'Coelophysis',
    element: 'terra', role: 'Striker',
    hp: 907, atk: 113, def: 78, spd: 126, basicPower: 88,
    passive: {
      id: 'packrun', name: '群れの走り',
      desc: '生きている味方1体につき 速度 +4% / 与ダメージ +4%（最大 +16%）。',
    },
    od: {
      id: 'boundfang', name: '束ねた牙',
      desc: '単体に3連撃。', power: 62,
    },
    sprite: 'coelophysis',
    build: { archetype: 'raptor', seed: 5519, bulk: 0.72, scale: 0.84 },
    habitat: ['canyon', 'emberfield'], rarity: 1,
    flavor: '最初期の獣脚類。ゴーストランチの一角から、数百体が折り重なって出た。',
  },
  {
    id: 'dimetrodon', name: 'ディメトロドン', short: 'ディメト', en: 'Dimetrodon',
    element: 'flame', role: 'Buffer',
    hp: 1516, atk: 129, def: 118, spd: 106, basicPower: 84,
    passive: {
      id: 'sailheat', name: '帆の放熱',
      desc: '通常攻撃の命中時 45% で火傷。味方全体の、火傷している敵への与ダメージ +15%。',
    },
    od: {
      id: 'heatshare', name: '熱を配る帆',
      desc: '味方全体の 攻撃 +20%（4行動）＋ 火傷を1つ取り除く。', power: 0,
    },
    sprite: 'dimetrodon',
    build: { archetype: 'theropod', seed: 5623, bulk: 1.06, scale: 1.02, sail: true },
    habitat: ['emberfield', 'canyon'], rarity: 3,
    flavor: '恐竜より先に栄え、恐竜より先に消えた。背の帆は熱をやりとりするための面だったとされる。',
  },
  {
    id: 'nipponites', name: 'ニッポニテス', short: 'ニッポニ', en: 'Nipponites',
    element: 'null', role: 'Healer',
    hp: 1680, atk: 111, def: 132, spd: 94, basicPower: 80,
    passive: {
      id: 'unreadable', name: '読めない巻き',
      desc: '自分が渡す回復は、相手が傷んでいるほど厚くなる（最大 +60%）。',
    },
    od: {
      id: 'tangledspiral', name: '絡まる螺旋',
      desc: '味方全体を回復し、弱体を1つ取り除く。', power: 0,
    },
    sprite: 'nipponites',
    build: { archetype: 'aquatic', seed: 5729, bulk: 1.0, scale: 0.95 },
    habitat: ['permitzone'], rarity: 4, permitOnly: true,
    flavor: '規則を捨てたように巻く殻。長く異常とされたが、いまは三次元の規則があると分かっている。',
  },
  {
    id: 'majungasaurus', name: 'マジュンガサウルス', short: 'マジュンガ', en: 'Majungasaurus',
    element: 'terra', role: 'Finisher',
    hp: 1172, atk: 133, def: 88, spd: 110, basicPower: 90,
    passive: {
      id: 'cannibal', name: '同族喰い',
      desc: '敵を倒すと 最大体力の 12% 回復 ＋ 自分の 攻撃 +10%（累積）。',
    },
    od: {
      id: 'bonesever', name: '骨を断つ',
      desc: '単体に大ダメージ。相手の体力が 35% を切っていれば威力2倍。', power: 128,
    },
    sprite: 'majungasaurus',
    build: { archetype: 'theropod', seed: 5831, bulk: 1.0, scale: 1.0, horns: 1 },
    habitat: ['canyon', 'emberfield'], rarity: 3,
    flavor: '同種の骨に、同種の歯型が残っていた。共食いの証拠が化石で押さえられた数少ない例。',
  },
  {
    id: 'microraptor', name: 'ミクロラプトル', short: 'ミクロ', en: 'Microraptor',
    element: 'gale', role: 'Guardian',
    hp: 1590, atk: 138, def: 104, spd: 128, basicPower: 86,
    passive: {
      id: 'fourwings', name: '四枚の翼',
      desc: '広い間合いから 62% で肩代わりに入り、そのとき受けるダメージ −28%。',
    },
    od: {
      id: 'glideguard', name: '滑空の壁',
      desc: '自分への攻撃を集め、そのあいだ 防御 +40%（4行動）。', power: 0,
    },
    sprite: 'microraptor',
    build: { archetype: 'raptor', seed: 5937, bulk: 0.7, scale: 0.8, crest: true },
    habitat: ['frostpeak', 'canyon'], rarity: 2,
    flavor: '前肢にも後肢にも風切羽を持つ。四枚の面で滑り込み、狙われた者の前へ割って入る。',
  },
  {
    id: 'ankylosaurus', name: 'アンキロサウルス', en: 'Ankylosaurus', element: 'terra', role: 'Tank',
    hp: 1389, atk: 84, def: 149, spd: 76, basicPower: 90,
    passive: { id: 'subsidence', name: '地盤沈下', desc: '前線で敵と組み合っている間、被ダメージ −15%。撃破されると味方全体の 必殺 +40。' },
    od: { id: 'faultcrush', name: '断層圧壊', desc: '単体に大ダメージ。対象はしばらくその場から動けなくなる。', power: 185 },
    sprite: 'ankylosaurus',
    build: { archetype: 'ankylosaur', seed: 1011, bulk: 1.18, scale: 1.1 },
    habitat: ['canyon', 'frostpeak'], rarity: 2,
    flavor: '全身を骨質の装甲で覆い、尾の先に骨の塊を備える。倒れるときの震動が仲間を奮い立たせる。',
  },
  {
    id: 'yutyrannus', name: 'ユウティラヌス', en: 'Yutyrannus', element: 'flame', role: 'Striker',
    hp: 1066, atk: 143, def: 76, spd: 128, basicPower: 92,
    passive: { id: 'embers', name: '熾火', desc: '攻撃時 32% で火傷を付与（毎行動 最大体力の4%）。' },
    od: { id: 'flamevolley', name: '連焔衝', desc: '単体に2回攻撃。対象が火傷なら3回に増える。', power: 58 },
    sprite: 'yutyrannus',
    build: { archetype: 'raptor', seed: 2022, bulk: 0.92, scale: 0.92, crest: true },
    habitat: ['emberfield', 'canyon'], rarity: 2,
    flavor: '全身を羽毛で覆われた大型の肉食竜。羽の隙間に熱を溜め、走った跡の砂がガラス化する。',
  },
  {
    id: 'kronosaurus', name: 'クロノサウルス', en: 'Kronosaurus', element: 'aqua', role: 'Breaker',
    hp: 1754, atk: 175, def: 106, spd: 78, basicPower: 100,
    passive: { id: 'deeppressure', name: '深圧', desc: '自分より 速度 が 20 以上高い相手への与ダメージ +14%。' },
    od: { id: 'vortexfang', name: '渦潮牙', desc: '単体に大ダメージ ＋ 対象の 速度 −20%（3行動）。', power: 165 },
    sprite: 'kronosaurus',
    build: { archetype: 'aquatic', seed: 3033, bulk: 1.15, scale: 1.08 },
    habitat: ['tidehollow'], rarity: 3,
    flavor: '短い首と巨大な頭をもつ海の捕食者。遅いのではなく、急ぐ必要がなかった。',
  },
  {
    id: 'pteranodon', name: 'プテラノドン', en: 'Pteranodon', element: 'gale', role: 'Sprinter',
    hp: 1062, atk: 127, def: 74, spd: 146, basicPower: 84,
    passive: { id: 'vanguard', name: '先陣', desc: '開戦と同時に行動ゲージが 35% 溜まった状態で飛び出す。ロスター最速。' },
    od: { id: 'galerend', name: '疾風裂波', desc: '敵全体を切り裂き、自分の次の行動を早める。', power: 70 },
    sprite: 'pteranodon',
    build: { archetype: 'pterosaur', seed: 4044, bulk: 0.85, scale: 1.0, crest: true },
    habitat: ['frostpeak', 'canyon'], rarity: 3,
    flavor: '歯を持たない大型の翼竜。風を待たない。翼で風を作る側の生き物。',
  },
  {
    id: 'triceratops', name: 'トリケラトプス', en: 'Triceratops', element: 'terra', role: 'Guardian',
    hp: 1458, atk: 120, def: 126, spd: 86, basicPower: 93,
    passive: { id: 'sediment', name: '堆積', desc: '行動するたび自身の 防御 +9%（最大 +45%、戦闘中持続）。' },
    od: { id: 'rockaegis', name: '岩盾展開', desc: '味方全体に 防御 基準の厚い吸収シールド（4行動）。', power: 0 },
    sprite: 'triceratops',
    build: { archetype: 'ceratopsian', seed: 5055, bulk: 1.05, scale: 1.05, horns: 5 },
    habitat: ['canyon', 'frostpeak'], rarity: 2,
    flavor: '三本の角と巨大な襟飾り。フリルは威嚇ではなく、風化した地層そのものを盾にしている。',
  },
  {
    id: 'goyocephale', name: 'ゴヨケファレ', en: 'Goyocephale', element: 'flame', role: 'Tank',
    hp: 1403, atk: 107, def: 130, spd: 74, basicPower: 90,
    passive: { id: 'heatreflect', name: '熱反射', desc: '被物理ダメージの 15% を攻撃者に返す。' },
    od: { id: 'scorchring', name: '焦熱環', desc: '敵全体を焼き、60% で火傷を付与。', power: 95 },
    sprite: 'goyocephale',
    build: { archetype: 'stegosaur', seed: 6066, bulk: 1.12, scale: 1.08, spikes: true },
    habitat: ['emberfield'], rarity: 3,
    flavor: '分厚い頭骨をもつ小型の堅頭竜。頭蓋に血流を通して放熱する。怒ると額が赤熱する。',
  },
  {
    id: 'shonisaurus', name: 'ショニサウルス', en: 'Shonisaurus', element: 'aqua', role: 'Healer',
    hp: 1314, atk: 101, def: 126, spd: 100, basicPower: 84,
    passive: { id: 'tide', name: '潮汐', desc: '行動のたび、最も傷ついた味方を 攻撃×0.46 回復。味方が撃破されたときは生存者全員を 攻撃×1.2 回復。' },
    od: { id: 'tideheal', name: '潮癒', desc: '体力割合が最も低い味方を大回復 ＋ デバフを1つ解除。', power: 0 },
    sprite: 'shonisaurus',
    build: { archetype: 'sauropod', seed: 7077, bulk: 0.95, scale: 1.06 },
    habitat: ['tidehollow'], rarity: 3,
    flavor: '全長20mに達する巨大な魚竜。群れの誰かが沈むと、残りが浮かび上がる。理由はまだ分かっていない。',
  },
  {
    id: 'velociraptor', name: 'ヴェロキラプトル', en: 'Velociraptor', element: 'gale', role: 'Debuffer',
    hp: 1103, atk: 106, def: 92, spd: 132, basicPower: 82,
    passive: { id: 'shearwind', name: '削風', desc: '通常攻撃の命中時、対象の 防御 −8%（累積3回まで）。' },
    od: { id: 'erosionstorm', name: '風蝕嵐', desc: '敵全体にダメージ ＋ 全体の 防御 −25%（4行動）。', power: 70 },
    sprite: 'velociraptor',
    build: { archetype: 'raptor', seed: 8088, bulk: 0.8, scale: 0.98, crest: true },
    habitat: ['frostpeak', 'tidehollow'], rarity: 3,
    flavor: '羽毛に覆われた小型の俊足種。通り過ぎた岩に細かい傷が残る。',
  },
  {
    id: 'tyrannosaurus', name: 'ティラノサウルス', en: 'Tyrannosaurus', element: 'null', role: 'All-round',
    hp: 1281, atk: 139, def: 112, spd: 98, basicPower: 90,
    passive: { id: 'immutable', name: '不変', desc: '属性相性を受けない（与・被ともに ×1.0 固定）。基礎値 +8% 込み。' },
    od: { id: 'obsidiancut', name: '黒曜断', desc: '単体に大ダメージ。対象の体力が50%未満ならさらに威力上昇。', power: 175 },
    sprite: 'tyrannosaurus',
    build: { archetype: 'theropod', seed: 9099, bulk: 1.0, scale: 1.02 },
    habitat: ['canyon', 'emberfield', 'frostpeak', 'tidehollow'], rarity: 3,
    flavor: '白亜紀末の頂点捕食者。骨が黒曜石に置換されており、どの属性の力も通り抜けていく。',
  },
  {
    id: 'pachycephalosaurus', name: 'パキケファロサウルス', short: 'パキケファロ', en: 'Pachycephalosaurus', element: 'null', role: 'Buffer',
    hp: 1081, atk: 111, def: 112, spd: 116, basicPower: 88,
    passive: { id: 'resonance', name: '共鳴', desc: '自分の行動時、味方全体の 必殺 +6。' },
    od: { id: 'resonantlight', name: '共鳴光', desc: '味方全体の 攻撃 +18%（4行動）＋ 全体の 必殺 +15。', power: 0 },
    sprite: 'pachycephalosaurus',
    build: { archetype: 'ceratopsian', seed: 10110, bulk: 0.9, scale: 1.0, horns: 3 },
    habitat: ['frostpeak', 'canyon'], rarity: 3,
    flavor: '厚さ25cmの頭蓋をもつ堅頭竜。頭骨が共鳴して低い音を出し、群れの呼吸が揃っていく。',
  },
  {
    id: 'iguanodon', name: 'イグアノドン', en: 'Iguanodon', element: 'terra', role: 'Technical',
    hp: 1457, atk: 144, def: 117, spd: 91, basicPower: 95,
    passive: { id: 'traction', name: '牽引', desc: '前線に出ていない敵への与ダメージ +34%。' },
    od: { id: 'faulthaul', name: '断層牽引', desc: '奥にいる敵1体を目の前まで引きずり出し、2秒のあいだ動けなくする。', power: 120 },
    sprite: 'iguanodon',
    build: { archetype: 'theropod', seed: 11121, bulk: 1.08, scale: 1.06, sail: true },
    habitat: ['canyon', 'emberfield'], rarity: 3,
    flavor: '親指に鋭い棘をもつ大型の鳥脚類。獲物を隊列ごと引きずり、逃げ場を消してから突く。',
  },
  {
    id: 'spinosaurus', name: 'スピノサウルス', en: 'Spinosaurus', element: 'flame', role: 'Finisher',
    hp: 1019, atk: 123, def: 84, spd: 92, basicPower: 94,
    passive: { id: 'overheat', name: '過熱', desc: '自分の体力が低いほど与ダメージ上昇（最大 +35%）。ロスター最高火力。' },
    od: { id: 'greateruption', name: '大噴火', desc: '敵全体を焼き払い火傷を付与。自身の体力を12%消費する。', power: 112 },
    sprite: 'spinosaurus',
    build: { archetype: 'theropod', seed: 12131, bulk: 1.14, scale: 1.12, sail: true, spikes: true },
    habitat: ['emberfield'], rarity: 4,
    flavor: '背の帆が体温を制御する最大級の肉食竜。瀕死になるほど熱が上がる。',
  },
  {
    id: 'pliosaurus', name: 'プリオサウルス', en: 'Pliosaurus', element: 'aqua', role: 'Striker',
    hp: 1208, atk: 137, def: 98, spd: 106, basicPower: 92,
    passive: { id: 'pursuit', name: '追い波', desc: '自分が敵を撃破すると行動ゲージ +38%。倒した勢いのまま次へ入る。' },
    od: { id: 'crushbite', name: '圧砕顎', desc: '単体に大ダメージ。シールドを貫通する。', power: 168 },
    sprite: 'pliosaurus',
    build: { archetype: 'aquatic', seed: 13141, bulk: 1.06, scale: 1.04 },
    habitat: ['tidehollow', 'frostpeak'], rarity: 4,
    flavor: '四枚のひれで水を掴む短首の首長竜。噛む力は顎の骨そのものを変形させるほどで、獲物の殻ごと砕く。',
  },
  {
    id: 'pliosaurus-funkei', name: 'プリオサウルス フンケイ', short: 'フンケイ', en: 'Pliosaurus funkei', element: 'aqua', role: 'Apex',
    hp: 1051, atk: 106, def: 112, spd: 98, basicPower: 88,
    passive: { id: 'deepreign', name: '制海', desc: '自分が生きている間、敵全体の 必殺 獲得 −12%。' },
    od: { id: 'abyssalmaw', name: '絶海断', desc: '敵全体に大ダメージ。シールドを貫通する。', power: 104 },
    sprite: 'pliosaurus-funkei',
    build: { archetype: 'aquatic', seed: 14151, bulk: 1.24, scale: 1.14, spikes: true },
    habitat: ['permitzone'], rarity: 5, permitOnly: true,
    flavor: '全長12mを超える最大級の首長竜。スヴァールバルの凍った泥から2体ぶんだけ見つかっている。海に出た捕食者の到達点で、同じ海に二番手はいなかった。',
  },
  {
    id: 'tyrannosaurus-1915', name: 'ティラノサウルス 1915', short: 'ティラノ1915',
    en: 'Tyrannosaurus (1915)', element: 'gale', role: 'Striker',
    hp: 1217, atk: 131, def: 92, spd: 110, basicPower: 90,
    passive: { id: 'oldtyrant', name: '旧き暴君', desc: '自分より 体力 割合が高い敵への与ダメージ +16%。傷のない相手から順に潰す。' },
    od: { id: 'galemaw', name: '烈風顎', desc: '単体に大ダメージ ＋ 自分の次の行動を早める。', power: 160 },
    sprite: 'tyrannosaurus-1915',
    build: { archetype: 'theropod', seed: 15161, bulk: 1.02, scale: 1.04 },
    habitat: [], rarity: 4, eventOnly: true,
    flavor: '1915年に組み上げられた姿。尾を引きずり、身を起こして立つ——いまは誤りとされた復元だが、その時代の博物館ではこれが暴君の全てだった。',
  },
  {
    id: 'spinosaurus-1915', name: 'スピノサウルス 1915', short: 'スピノ1915',
    en: 'Spinosaurus (1915)', element: 'terra', role: 'Buffer',
    hp: 1357, atk: 124, def: 134, spd: 94, basicPower: 91,
    passive: { id: 'archivesail', name: '記録の帆', desc: '味方が特殊攻撃を撃つたび、その味方の 攻撃 +12%（1体につき3回まで、戦闘中持続）。' },
    od: { id: 'stratarecord', name: '古層の記録', desc: '味方全体の 必殺 +25 ＋ 全体の与ダメージ +20%（4行動）。', power: 0 },
    sprite: 'spinosaurus-1915',
    build: { archetype: 'theropod', seed: 16171, bulk: 1.1, scale: 1.08, sail: true },
    habitat: [], rarity: 4, eventOnly: true,
    flavor: '1915年、ストローマーが記載した最初の姿。原標本は戦火で焼け、残ったのは図版と記述だけ。いま復元されるどの姿より、この一枚のほうが長く生きている。',
  },
  {
    id: 'quetzalcoatlus', name: 'ケツァルコアトルス', short: 'ケツァル',
    en: 'Quetzalcoatlus', element: 'gale', role: 'Buffer',
    hp: 837, atk: 73, def: 96, spd: 124, basicPower: 78,
    passive: {
      id: 'skygrasp', name: '掌握する空',
      desc: '味方の攻撃が奇数回目になるたび、味方全体の 攻撃 +3%（最大 +9%）。+9% の間は味方全体の 必殺 獲得 +20%。自分が倒れると効果は消える。',
    },
    od: {
      id: 'skyreign', name: '制空覇道',
      desc: '味方全体の 速度 +30% / 防御 +20%（10秒）。', power: 0,
    },
    sprite: 'quetzalcoatlus',
    build: { archetype: 'pterosaur', seed: 17181, bulk: 1.02, scale: 1.16, crest: true },
    habitat: ['permitzone'], rarity: 5, permitOnly: true,
    flavor: '翼を広げれば10mを超える、空を飛んだ最大の生き物。地に降りればキリンの背丈で歩き、見上げる空には競合がいなかった。',
  },
  {
    id: 'hatzegopteryx', name: 'ハツェゴプテリクス', short: 'ハツェゴ',
    en: 'Hatzegopteryx', element: 'flame', role: 'All-round',
    hp: 1046, atk: 100, def: 100, spd: 110, basicPower: 87,
    passive: {
      id: 'islandapex', name: '島の頂点',
      desc: 'このユニットの攻撃が通ったとき、一度だけ 攻撃 +20%（戦闘中ずっと残る）。',
    },
    od: {
      id: 'hatzegwing', name: 'ハツェグの翼',
      desc: '敵全体に大ダメージ ＋ 味方全体の 速度 +10%（4行動）。', power: 83,
    },
    sprite: 'hatzegopteryx',
    build: { archetype: 'pterosaur', seed: 19191, bulk: 1.14, scale: 1.12, crest: true },
    habitat: ['permitzone'], rarity: 5, permitOnly: true,
    flavor: '島には大型の獣脚類がいなかった。翼を畳んで四足で歩き、地上の獲物を狩る翼竜が、そこでは頂点に立っていた。',
  },
  {
    id: 'dimorphodon', name: 'ディモルフォドン', short: 'ディモルフォ',
    en: 'Dimorphodon', element: 'gale', role: 'Striker',
    hp: 1082, atk: 105, def: 88, spd: 134, basicPower: 82,
    passive: {
      id: 'firstbite', name: '初手の牙',
      desc: 'まだ一度も攻撃していない相手への与ダメージ +20%。先に噛みついた者が場を決める。',
    },
    od: {
      id: 'forkjaw', name: '二叉ノ顎',
      desc: '単体に大ダメージ ＋ 別の敵1体にも同じ一撃が届く。', power: 126,
    },
    sprite: 'dimorphodon',
    build: { archetype: 'pterosaur', seed: 21212, bulk: 0.88, scale: 0.92, crest: true },
    habitat: ['canyon'], rarity: 1,
    flavor: '前に大きな牙、奥に細かい歯——一つの顎に二種類の歯が並ぶ。名前もそこから来ている。翼開長1.4m、掘り出される数だけは多い。',
  },
  {
    id: 'ophthalmosaurus', name: 'オフタルモサウルス', short: 'オフタルモ',
    en: 'Ophthalmosaurus', element: 'aqua', role: 'Technical',
    hp: 1250, atk: 112, def: 102, spd: 112, basicPower: 84,
    passive: {
      id: 'greateye', name: '巨眼',
      desc: '会心率 +12%。会心が出るたび味方全体の 必殺 +8。',
    },
    od: {
      id: 'gazepierce', name: '暗所ノ一瞥',
      desc: '単体に大ダメージ。必ず会心になる。', power: 118,
    },
    sprite: 'ophthalmosaurus',
    build: { archetype: 'aquatic', seed: 22222, bulk: 1.0, scale: 1.0 },
    habitat: ['tidehollow', 'frostpeak'], rarity: 2,
    flavor: '直径 23cm、体に対して史上最大の眼。光の届かない深さまで潜って狩るために、目だけが先に巨大化した。',
  },
  {
    id: 'albertaceratops', name: 'アルベルタケラトプス', short: 'アルベルタ',
    en: 'Albertaceratops', element: 'terra', role: 'Debuffer',
    hp: 1576, atk: 114, def: 130, spd: 92, basicPower: 82,
    passive: {
      id: 'twinhorn', name: '双角の圧',
      desc: '攻撃が通った相手の 攻撃 −12%（3行動）。角を向けられた側は前に出られない。',
    },
    od: {
      id: 'hornrout', name: '角衾',
      desc: '敵全体に中ダメージ ＋ 全体の 必殺 −28 ＋ 味方全体の 防御 +18%（4行動）。', power: 52,
    },
    sprite: 'albertaceratops',
    build: { archetype: 'ceratopsian', seed: 23232, bulk: 1.18, scale: 1.06, horns: 2 },
    habitat: ['canyon', 'frostpeak'], rarity: 3,
    flavor: '角竜のなかでも古い型で、眉の上の角が長い。フリルの縁には鉤状の骨が並ぶ——正面から見たときの大きさだけを、ひたすら盛った顔。',
  },
  {
    id: 'carnotaurus', name: 'カルノタウルス', short: 'カルノ',
    en: 'Carnotaurus', element: 'flame', role: 'Finisher',
    hp: 1118, atk: 122, def: 84, spd: 122, basicPower: 85,
    passive: {
      id: 'runningcharge', name: '駆ける角',
      desc: '自分のほうが 速度 が高いとき、差 1 につき与ダメージ +0.35%（最大 +26%）。',
    },
    od: {
      id: 'crimsoncharge', name: '赤角突撃',
      desc: '単体に大ダメージ。倒しきれたら、そのまま次の1体へ突っ込む。', power: 148,
    },
    sprite: 'carnotaurus',
    build: { archetype: 'theropod', seed: 24242, bulk: 0.96, scale: 1.0, horns: 2 },
    habitat: ['emberfield', 'canyon'], rarity: 3,
    flavor: '目の上に雄牛のような角を持つ獣脚類。前肢は退化して指先が飛び出しているだけ。代わりに尾の筋肉が異常に太く、走る速さだけに全部を寄せた体。',
  },
  {
    id: 'therizinosaurus', name: 'テリジノサウルス', short: 'テリジノ',
    en: 'Therizinosaurus', element: 'terra', role: 'Breaker',
    hp: 1473, atk: 134, def: 108, spd: 92, basicPower: 86,
    passive: {
      id: 'scytheclaw', name: '鎌爪',
      desc: 'シールドを無視して斬る。相手の 防御 が高いほど与ダメージ上昇（最大 +24%）。',
    },
    od: {
      id: 'harvest', name: '収穫',
      desc: '単体に特大ダメージ ＋ 与えたダメージの 28% を自分の体力に還す。', power: 172,
    },
    sprite: 'therizinosaurus',
    build: { archetype: 'theropod', seed: 25252, bulk: 1.14, scale: 1.12, spikes: true },
    habitat: ['frostpeak', 'canyon'], rarity: 4,
    flavor: '長さ 1m に届く爪を三本ずつ。獣脚類でありながら草を食んでいたと見られている——この爪が何のためのものだったかは、まだ誰も知らない。',
  },
  {
    id: 'elasmosaurus', name: 'エラスモサウルス', short: 'エラスモ',
    en: 'Elasmosaurus', element: 'aqua', role: 'Sprinter',
    hp: 1216, atk: 115, def: 84, spd: 136, basicPower: 79,
    passive: {
      id: 'venomgland', name: '毒腺',
      desc: '通常攻撃の命中時 45% で毒を1つ重ねる（毒は1つにつき毎行動 最大体力の 3%、3つまで）。',
    },
    od: {
      id: 'serpentvenom', name: '蛇頸毒牙',
      desc: '単体に2回攻撃し、当たるたび毒を1つ重ねる ＋ 自分の次の行動を早める。', power: 62,
    },
    sprite: 'elasmosaurus',
    build: { archetype: 'aquatic', seed: 26262, bulk: 0.94, scale: 1.16 },
    habitat: ['tidehollow', 'canyon'], rarity: 4,
    flavor: '首の骨が 72 個。全長 10m のうち半分以上が首で、胴と鰭は小さい。水の中を進むというより、首だけを伸ばして獲物の群れに差し入れる。',
  },
  {
    id: 'tyrannosaurus-sue', name: 'ティラノサウルス スー', short: 'スー',
    en: 'Tyrannosaurus "Sue"', element: 'null', role: 'Apex',
    hp: 1602, atk: 112, def: 122, spd: 92, basicPower: 85,
    passive: {
      id: 'warlord', name: '歴戦の暴君',
      desc: '属性相性を使わない。自分が与えるダメージも受けるダメージも、相手の属性に関わらず ×1.5。',
    },
    od: {
      id: 'tyrantrequiem', name: '覇王鎮魂・六千万年ノ咬',
      desc: '単体に特大ダメージ ＋ 対象の被ダメージ +20%（2行動）。', power: 186,
    },
    sprite: 'tyrannosaurus-sue',
    build: { archetype: 'theropod', seed: 20202, bulk: 1.12, scale: 1.1 },
    habitat: ['permitzone'], rarity: 5, permitOnly: true,
    flavor: '1990年、サウスダコタの丘で見つかった最も完全な一体。折れて癒えた肋骨、噛まれた跡の残る顎——三十年ぶんの傷を抱えたまま、六千万年を越えて掘り出された。',
  },
  {
    id: 'brachiosaurus', name: 'ブラキオサウルス', short: 'ブラキオ',
    en: 'Brachiosaurus', element: 'terra', role: 'Healer',
    hp: 2007, atk: 97, def: 144, spd: 80, basicPower: 80,
    passive: {
      id: 'earthbreath', name: '大地の伊吹',
      desc: '味方が受ける回復量 +15%（自分の回復も含む）。',
    },
    od: {
      id: 'grindfeed', name: '磨り潰し消化',
      desc: '味方全体に再生（5秒）。合計で自分の最大 体力 の 1/5 ぶんを回復する。', power: 0,
    },
    sprite: 'brachiosaurus',
    build: { archetype: 'sauropod', seed: 20202, bulk: 1.3, scale: 1.24 },
    habitat: ['permitzone'], rarity: 5, permitOnly: true,
    flavor: '前肢が後肢より長い、傾いた体。胃石で磨り潰して呑み下す消化のために、数十キロの石を抱えて歩いていた。',
  },
  {
    id: 'stegosaurus', name: 'ステゴサウルス', en: 'Stegosaurus', element: 'flame', role: 'Guardian',
    hp: 1757, atk: 103, def: 165, spd: 81, basicPower: 91,
    passive: {
      id: 'platescreen', name: '板の放熱',
      desc: '近くの味方が狙われたとき、遠くからでも 45% で割って入って肩代わりする。',
    },
    od: {
      id: 'spikebore', name: '尾棘穿孔',
      desc: '単体に大ダメージ ＋ 対象の 攻撃 −22%（4行動）。', power: 158,
    },
    sprite: 'stegosaurus',
    build: { archetype: 'stegosaur', seed: 18191, bulk: 1.2, scale: 1.12, spikes: true },
    habitat: ['emberfield', 'canyon'], rarity: 3,
    flavor: '背に二列の骨板を並べ、尾の先に四本の棘を持つ。板には血管の溝が走っていて、熱を逃がしていたと考えられている。',
  },
  {
    id: 'diatryma', name: 'ディアトリマ', en: 'Diatryma', element: 'null', role: 'Breaker',
    hp: 1416, atk: 149, def: 87, spd: 107, basicPower: 94,
    passive: {
      id: 'greatbeak', name: '大喙',
      desc: '通常攻撃の与ダメージ +22%。ただし 必殺 の溜まりが 20% 遅い。',
    },
    od: {
      id: 'leapstrike', name: '跳襲',
      desc: '単体に大ダメージ ＋ 対象の被ダメージ +25%（3行動）。', power: 150,
    },
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
  Sprinter: '特攻役',
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
