import type { BiomeId, ElementId } from '../../voxel/palette';
import { getRevos, type Role } from './revos';

/**
 * 30段の固定表。
 *
 * 以前の段は「こちらの編成の平均レベル」に敵を合わせていた。勝てば
 * レベルが上がり、上がったぶん敵も上がる——どれだけ掘って育てても、
 * 相手がぴったり並んでくるので、段を進めた実感がどこにも残らない。
 * 逆に育てなければ敵も弱いままなので、育てる理由も消えていた。
 *
 * なので段は固定にする。第1段の相手は誰が挑んでも同じ2体で、
 * 第30段は誰が挑んでもホロタイプ5体。こちらの編成は一切見ない。
 * 強くなったぶんはそのまま「前は負けた段に勝てる」に変わる。
 *
 * 上がり方は4つを同時に動かす——顔ぶれ（レア度と役職の噛み合い）、
 * 数（2→5体）、レベル、刻印の等級。数が増える段と、顔ぶれが跳ねる段を
 * 別に置くことで、どこで詰まったのかが読める。
 */
export interface StageDef {
  /** 段の番号 1..30 */
  n: number;
  name: string;
  biome: BiomeId;
  /** 席順そのまま。固定なので、何度挑んでも同じ並びで出てくる */
  foes: string[];
  level: number;
  clean: number;
  /** 刻印の等級。0 は刻印なし */
  grade: number;
  /**
   * 体力・攻撃・防御に掛かる倍率。
   *
   * レベルは段の階段として読ませるものなので、1段ごとに綺麗に上がる値に
   * 固定してある。ただし顔ぶれは段ごとに噛み合いが違い、同じレベルでも
   * 手応えは倍ほど変わる——4体の速攻隊と、壁2枚の守り隊では別物。
   * その差をここで平らにする。値は tools/stagetune.ts が目標勝率から探す。
   */
  power: number;
  /** 札に出す勝ち筋の一言 */
  hint: string;
}

/** 役職ごとに付く刻印の銘。固定表なので、相手の伸び方も毎回同じ */
const ROLE_ENGRAVE: Record<Role, string> = {
  Tank: 'wall', Guardian: 'wall',
  Striker: 'edge', Breaker: 'blade', Apex: 'drum', 'All-round': 'whole',
  Finisher: 'fang', Sprinter: 'gale',
  Technical: 'edge', Debuffer: 'flow', Healer: 'core', Buffer: 'core', Special: 'core',
};

export const STAGES: StageDef[] = [
  // ---- ソルト・キャニオン：2体から5体へ、役職の役割を1つずつ見せる段 ----
  { n: 1, name: '乾いた谷の斥候', biome: 'canyon', level: 3, clean: 55, grade: 0, power: 1.15,
    foes: ['coelophysis', 'dimorphodon'],
    hint: '軽い2体。殴り合えば押し切れる' },
  { n: 2, name: '浅瀬の貝', biome: 'canyon', level: 5, clean: 57, grade: 0, power: 1.15,
    foes: ['orthoceras', 'pikaia'],
    hint: '後ろから撃ってくる。前に出て潰す' },
  { n: 3, name: '三つ巴', biome: 'canyon', level: 7, clean: 60, grade: 0, power: 1.15,
    foes: ['coelophysis', 'irritator', 'dimorphodon'],
    hint: '3体に増える。こちらも3枠は埋めたい' },
  { n: 4, name: '殻を並べる', biome: 'canyon', level: 9, clean: 62, grade: 0, power: 1.15,
    foes: ['paradoxides', 'orthoceras', 'coelophysis'],
    hint: '硬い盾が前に立つ。崩す役か特攻が要る' },
  { n: 5, name: '熾火の群れ', biome: 'canyon', level: 10, clean: 64, grade: 1, power: 1.15,
    foes: ['yutyrannus', 'irritator', 'dimorphodon'],
    hint: '火傷を重ねてくる。回復役がいると楽' },
  { n: 6, name: '角の守り', biome: 'canyon', level: 11, clean: 66, grade: 1, power: 1.15,
    foes: ['triceratops', 'ophthalmosaurus', 'anomalocaris'],
    hint: '守護役が肩代わりする。後衛から削る' },
  { n: 7, name: '四枚の翼', biome: 'canyon', level: 12, clean: 68, grade: 1, power: 1.11,
    foes: ['microraptor', 'velociraptor', 'pteranodon', 'coelophysis'],
    hint: '4体、全員が速い。先に動かれる前提で組む' },

  // ---- フロストピーク：壁と回復が噛み合い始める ----
  { n: 8, name: '氷漬けの盾', biome: 'frostpeak', level: 13, clean: 70, grade: 1, power: 1.08,
    foes: ['ankylosaurus', 'paradoxides', 'yutyrannus', 'pikaia'],
    hint: '硬い前衛の後ろから焼いてくる。壁を割る役が要る' },
  { n: 9, name: '群れの狩り', biome: 'frostpeak', level: 14, clean: 71, grade: 2, power: 1.15,
    foes: ['carnotaurus', 'majungasaurus', 'velociraptor', 'anomalocaris'],
    hint: '瀕死を追ってくる。削られた味方を早く戻す' },
  { n: 10, name: '癒す壁', biome: 'frostpeak', level: 15, clean: 72, grade: 2, power: 1.15,
    foes: ['shonisaurus', 'majungasaurus', 'carnotaurus', 'irritator'],
    hint: '癒し手が後ろで戻してくる。最後列を先に落とす' },
  { n: 11, name: '深圧の顎', biome: 'frostpeak', level: 16, clean: 74, grade: 2, power: 0.96,
    foes: ['kronosaurus', 'pachycephalosaurus', 'pikaia', 'velociraptor'],
    hint: 'ロスター最大の一撃。受けるより先に落とす' },
  { n: 12, name: '五つの牙', biome: 'frostpeak', level: 17, clean: 75, grade: 2, power: 0.80,
    foes: ['diatryma', 'carnotaurus', 'majungasaurus', 'pachycephalosaurus', 'microraptor'],
    hint: 'ここから5体。枠を5つ埋めていないと数で負ける' },
  { n: 13, name: '帆を連ねる', biome: 'frostpeak', level: 18, clean: 76, grade: 2, power: 0.96,
    foes: ['dimetrodon', 'goyocephale', 'yutyrannus', 'irritator', 'carnotaurus'],
    hint: '炎で固めた5体。火傷対策と水属性が効く' },
  { n: 14, name: '氷牙の主', biome: 'frostpeak', level: 19, clean: 78, grade: 3, power: 0.79,
    foes: ['kronosaurus', 'diatryma', 'ophthalmosaurus', 'velociraptor', 'pteranodon'],
    hint: 'ロスター最大の一撃を持つ隊。受ける前に落とす' },

  // ---- タイドホロウ：水棲の層。デバフと毒が濃い ----
  { n: 15, name: '干潟の守り', biome: 'tidehollow', level: 20, clean: 79, grade: 3, power: 0.84,
    foes: ['archelon', 'elasmosaurus', 'pliosaurus', 'anomalocaris', 'pikaia'],
    hint: '硬い壁の後ろから撃ってくる。壁を1枚ずつ剥がす' },
  { n: 16, name: '潮の猛者', biome: 'tidehollow', level: 21, clean: 80, grade: 3, power: 0.84,
    foes: ['pliosaurus', 'kronosaurus', 'elasmosaurus', 'shonisaurus', 'carnotaurus'],
    hint: '★4が前に出る。殴り合いの土俵が一段上がる' },
  { n: 17, name: '毒の尾', biome: 'tidehollow', level: 21, clean: 81, grade: 3, power: 0.75,
    foes: ['elasmosaurus', 'anomalocaris', 'velociraptor', 'pikaia', 'majungasaurus'],
    hint: '毒と目眩を重ねてくる。短期戦で畳む' },
  { n: 18, name: '鎌の収穫', biome: 'tidehollow', level: 22, clean: 82, grade: 3, power: 0.81,
    foes: ['therizinosaurus', 'iguanodon', 'albertaceratops', 'maiasaura', 'pteranodon'],
    hint: '地属性で固めた重い隊。風属性が通る' },
  { n: 19, name: '追う牙', biome: 'tidehollow', level: 23, clean: 83, grade: 3, power: 0.82,
    foes: ['smilodon', 'carnotaurus', 'majungasaurus', 'pikaia', 'irritator'],
    hint: '状態異常を付けてから追ってくる。異常を切る手が要る' },
  { n: 20, name: '石の砦', biome: 'tidehollow', level: 23, clean: 84, grade: 4, power: 0.74,
    foes: ['stegosaurus', 'ankylosaurus', 'kronosaurus', 'iguanodon', 'therizinosaurus'],
    hint: '硬いうえに重い一撃を持つ。固定ダメージか出血で削る' },
  { n: 21, name: '読めぬ螺旋', biome: 'tidehollow', level: 24, clean: 85, grade: 4, power: 0.75,
    foes: ['nipponites', 'smilodon', 'carnotaurus', 'elasmosaurus', 'pliosaurus'],
    hint: '特別許可区の個体が混じる。後衛が落ちにくい' },

  // ---- エンバーフィールド：ホロタイプが1体ずつ加わる最終層 ----
  { n: 22, name: '灰の王', biome: 'emberfield', level: 25, clean: 86, grade: 4, power: 0.84,
    foes: ['spinosaurus', 'yutyrannus', 'dimetrodon', 'goyocephale', 'carnotaurus'],
    hint: '炎の全盛り。水属性と火傷無効が効く' },
  { n: 23, name: '天翔', biome: 'emberfield', level: 25, clean: 87, grade: 4, power: 0.71,
    foes: ['quetzalcoatlus', 'pteranodon', 'velociraptor', 'microraptor', 'elasmosaurus'],
    hint: 'ホロタイプが1体。速度で押してくるので先手を取る' },
  { n: 24, name: '島の頂点', biome: 'emberfield', level: 26, clean: 88, grade: 4, power: 0.80,
    foes: ['hatzegopteryx', 'tyrannosaurus', 'diatryma', 'dimetrodon', 'spinosaurus'],
    hint: '前も後ろも埋まっている。まず支援を切る' },
  { n: 25, name: '深海の統べ', biome: 'emberfield', level: 26, clean: 89, grade: 4, power: 0.85,
    foes: ['pliosaurus-funkei', 'pliosaurus', 'kronosaurus', 'elasmosaurus', 'nipponites'],
    hint: '頂点役と癒し手が揃っている。長引けば必ず負ける' },
  { n: 26, name: '鎌と鋏', biome: 'emberfield', level: 27, clean: 90, grade: 4, power: 0.74,
    foes: ['therizinosaurus', 'smilodon', 'anomalocaris', 'albertaceratops', 'maiasaura'],
    hint: '壁崩しと追い討ちの連係。壁を薄く置かない' },
  { n: 27, name: '双つの暴君', biome: 'emberfield', level: 27, clean: 91, grade: 5, power: 0.74,
    foes: ['tyrannosaurus-sue', 'tyrannosaurus', 'majungasaurus', 'diatryma', 'smilodon'],
    hint: '無属性で固めた高火力。属性相性が使えない' },
  { n: 28, name: '大地の呼吸', biome: 'emberfield', level: 28, clean: 92, grade: 5, power: 0.73,
    foes: ['brachiosaurus', 'stegosaurus', 'triceratops', 'therizinosaurus', 'iguanodon'],
    hint: '体力2000超えの癒し手。先に落とさないと削りが戻る' },
  { n: 29, name: '二重の咬', biome: 'emberfield', level: 29, clean: 93, grade: 5, power: 0.79,
    foes: ['tylosaurus', 'pliosaurus-funkei', 'elasmosaurus', 'pliosaurus', 'quetzalcoatlus'],
    hint: '束縛で足を止めてくる。射撃と回復を厚く' },
  { n: 30, name: '最奥の層', biome: 'emberfield', level: 30, clean: 95, grade: 5, power: 0.79,
    foes: ['tylosaurus', 'tyrannosaurus-sue', 'hatzegopteryx', 'pliosaurus-funkei', 'quetzalcoatlus'],
    hint: 'ホロタイプ5体。こちらも削り上げた刻印付きで挑む' },
];

export const STAGE_COUNT = STAGES.length;

/** 段の定義。範囲外は端で止める——存在しない段に挑ませない */
export function stageDef(n: number): StageDef {
  const i = Math.max(1, Math.min(STAGE_COUNT, Math.floor(n))) - 1;
  return STAGES[i];
}

/** 席に付く刻印の銘。役職から引くので、相手の伸び方は毎回同じ */
export function stageEngravePattern(defId: string): string {
  return ROLE_ENGRAVE[getRevos(defId).role];
}

/** 札に出す属性の寄り。顔ぶれから数える——表示用に別の表を持たない */
export function stageTheme(s: StageDef): ElementId {
  const count = new Map<ElementId, number>();
  for (const id of s.foes) {
    const e = getRevos(id).element;
    count.set(e, (count.get(e) ?? 0) + 1);
  }
  let best: ElementId = 'null', n = -1;
  for (const [e, c] of count) if (c > n) { best = e; n = c; }
  return best;
}

/** 札に出すレア度の上限。これも顔ぶれから数える */
export function stageRarityCap(s: StageDef): number {
  return s.foes.reduce((m, id) => Math.max(m, getRevos(id).rarity), 1);
}
