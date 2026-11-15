import type { ElementId } from '../../voxel/palette';

/**
 * 特性（シナジー）。
 *
 * 1体が2つの特性を持つ——属性と、効果特性。同じ特性の仲間が揃うと段が立つ。
 *
 *   属性     … 3体で1段、5体で2段。揃えた者に、属性ごとの開幕の効き目が乗る
 *   効果特性 … ユニットが持つ効き目の系統。1段目は持ち主の効き目を引き上げ、
 *              2段目はその効き目を仲間にも付ける
 *
 * 数字は戦闘（simulate.ts）と画面の説明の両方がここを読む。片方だけ直すと
 * 説明と実際がずれるので、効き目の数字は必ずここに置く。
 */

export type KitTraitId =
  | 'burn' | 'venom' | 'weaken' | 'guard' | 'mend'
  | 'echo' | 'rush' | 'hunt' | 'pack' | 'might';

/** 効果特性の持ち主 */
export const KIT_TRAIT: Record<string, KitTraitId> = {
  yutyrannus: 'burn', dimetrodon: 'burn', goyocephale: 'burn', spinosaurus: 'burn',
  elasmosaurus: 'venom', jobaria: 'venom', smilodon: 'venom', orthoceras: 'venom',
  pikaia: 'weaken', paradoxides: 'weaken', irritator: 'weaken', velociraptor: 'weaken', kronosaurus: 'weaken',
  archelon: 'guard', triceratops: 'guard', microraptor: 'guard', stegosaurus: 'guard', ankylosaurus: 'guard',
  // 角で押し返し、味方の防御を固める側。弱体と土の両方の芯になって偏ったので、こちらへ
  albertaceratops: 'guard',
  maiasaura: 'mend', nipponites: 'mend', shonisaurus: 'mend', brachiosaurus: 'mend',
  pachycephalosaurus: 'echo', 'spinosaurus-1915': 'echo', quetzalcoatlus: 'echo', ophthalmosaurus: 'echo', 'pliosaurus-funkei': 'echo',
  pteranodon: 'rush', pliosaurus: 'rush', 'tyrannosaurus-1915': 'rush', ornithomimus: 'rush', carnotaurus: 'rush',
  anomalocaris: 'hunt', iguanodon: 'hunt', dimorphodon: 'hunt', concavenator: 'hunt', majungasaurus: 'hunt', tyrannosaurus: 'hunt',
  xidazoon: 'pack', coelophysis: 'pack',
  'tyrannosaurus-sue': 'might', therizinosaurus: 'might', diatryma: 'might', hatzegopteryx: 'might', tylosaurus: 'might',
};

const KIT_SIZE = new Map<string, number>();
for (const k of Object.values(KIT_TRAIT)) KIT_SIZE.set(k, (KIT_SIZE.get(k) ?? 0) + 1);

/** 段の敷居。4体以上いる特性は 2/4、それより少ない特性は 2/3 */
export function kitSteps(k: string): [number, number] {
  return (KIT_SIZE.get(k) ?? 0) >= 4 ? [2, 4] : [2, 3];
}

/** 属性の段の敷居 */
export const ELEMENT_STEPS: [number, number] = [3, 5];

/** 効き目の数字。[1段目, 2段目] */
export const TRAIT_NUM = {
  // 属性
  flameDealt: [0.09, 0.20], flameUntil: 15,
  aquaRegen: [0.16, 0.30], aquaSeconds: 10,
  terraShield: [0.9, 1.9],
  galeSpd: [0.05, 0.14],
  nullOd: [6, 40],
  // 効果特性
  burnChance: 0.40, burnDeep: 0.065, burnBase: 0.04,
  venomChance: 0.65, venomCap: 5, venomPer: 2,
  weakenAmp: 1.2, weakenAtk: -0.08, weakenTurns: 3,
  guardTaken: -0.06, guardOd: 1.2, guardShield: 0.4,
  mendHeal: 1.10, mendTeam: 1.04, mendSpill: 0.6, mendSpillCap: 0.3,
  echoGain: 1.10, echoShare: 5,
  rushSpd: 0.08, rushReady: 0.2, rushKill: 0.25,
  huntOwn: 1.15, huntTeam: 1.10,
  packScale: 0.56,
  mightBasic: 1.07, mightOd: 1.05, mightTeam: 1.05,
} as const;

export interface TraitInfo {
  name: string;
  /** 1段目・2段目の説明 */
  tiers: [string, string];
}

const pct = (v: number): string => `${Math.round(v * 1000) / 10}%`;
const mul = (v: number): string => `×${v}`;
const N = TRAIT_NUM;

export const ELEMENT_TRAITS: Record<ElementId, TraitInfo> = {
  flame: { name: '火', tiers: [
    `開戦から${N.flameUntil}秒、火の者の与ダメージ +${pct(N.flameDealt[0])}`,
    `開戦から${N.flameUntil}秒、火の者の与ダメージ +${pct(N.flameDealt[1])}`] },
  aqua: { name: '水', tiers: [
    `水の者が${N.aquaSeconds}秒かけて最大体力の ${pct(N.aquaRegen[0])} を再生`,
    `水の者が${N.aquaSeconds}秒かけて最大体力の ${pct(N.aquaRegen[1])} を再生`] },
  terra: { name: '土', tiers: [
    `土の者が開戦時に 防御${mul(N.terraShield[0])} の盾を持つ`,
    `土の者が開戦時に 防御${mul(N.terraShield[1])} の盾を持つ`] },
  gale: { name: '風', tiers: [
    `風の者の 速度 +${pct(N.galeSpd[0])}`,
    `風の者の 速度 +${pct(N.galeSpd[1])}`] },
  null: { name: '無', tiers: [
    `無の者が 必殺 +${N.nullOd[0]} で開戦`,
    `無の者が 必殺 +${N.nullOd[1]} で開戦`] },
};

export const KIT_TRAITS: Record<KitTraitId, TraitInfo> = {
  burn: { name: '灼熱', tiers: [
    `持ち主の通常攻撃が ${pct(N.burnChance)} で火傷を付け、その火傷は深く焼く（毎刻み ${pct(N.burnBase)} → ${pct(N.burnDeep)}）`,
    `仲間の通常攻撃も ${pct(N.burnChance)} で火傷を付ける`] },
  venom: { name: '蝕毒', tiers: [
    `持ち主の毒は一度に${N.venomPer}つ重なり、${N.venomCap}つまで積める`,
    `仲間の通常攻撃も ${pct(N.venomChance)} で毒を重ねる`] },
  weaken: { name: '弱体', tiers: [
    `持ち主が掛ける弱体が ${mul(N.weakenAmp)} で1行動長く残る。目眩は2つずつ重なる`,
    `仲間の通常攻撃に 攻撃 ${pct(N.weakenAtk)}（${N.weakenTurns}行動）が乗る`] },
  guard: { name: '守護', tiers: [
    `持ち主の被ダメージ ${pct(N.guardTaken)}、必殺 ${mul(N.guardOd)}`,
    `全員が開戦時に 防御${mul(N.guardShield)} の盾を持つ`] },
  mend: { name: '癒し', tiers: [
    `持ち主の回復 ${mul(N.mendHeal)}`,
    `隊の受ける回復 ${mul(N.mendTeam)}。溢れた回復の ${pct(N.mendSpill)} が盾になる（最大体力の ${pct(N.mendSpillCap)} まで）`] },
  echo: { name: '共鳴', tiers: [
    `持ち主の 必殺 の溜まり ${mul(N.echoGain)}`,
    `誰かが必殺を撃つたび、仲間の 必殺 +${N.echoShare}`] },
  rush: { name: '疾風', tiers: [
    `持ち主の 速度 +${pct(N.rushSpd)}、行動ゲージ +${pct(N.rushReady)} で開戦`,
    `敵を倒した仲間は 行動ゲージ +${pct(N.rushKill)}`] },
  hunt: { name: '狩猟', tiers: [
    `持ち主は後衛か、体力が半分を切った相手に ${mul(N.huntOwn)}`,
    `全員が後衛に ${mul(N.huntTeam)}`] },
  pack: { name: '群れ', tiers: [
    `持ち主の分身が本体の ${pct(N.packScale)} になる（素は 50%）`,
    '—'] },
  might: { name: '剛力', tiers: [
    `持ち主の通常攻撃 ${mul(N.mightBasic)}、必殺 ${mul(N.mightOd)}`,
    `全員の通常攻撃 ${mul(N.mightTeam)}`] },
};

export interface ActiveTrait {
  /** 'flame' などの属性、または効果特性の id */
  id: string;
  kind: 'element' | 'kit';
  name: string;
  count: number;
  steps: [number, number];
  /** 0 = まだ立っていない */
  tier: 0 | 1 | 2;
}

/** 編成から特性の立ち方を数える。まだ段に届いていないものも返す */
export function tallyTraits(units: { defId: string; element: ElementId }[]): ActiveTrait[] {
  const el = new Map<ElementId, number>();
  const kit = new Map<KitTraitId, number>();
  for (const u of units) {
    el.set(u.element, (el.get(u.element) ?? 0) + 1);
    const k = KIT_TRAIT[u.defId];
    if (k) kit.set(k, (kit.get(k) ?? 0) + 1);
  }
  const out: ActiveTrait[] = [];
  const tierOf = (n: number, s: [number, number]): 0 | 1 | 2 => (n >= s[1] ? 2 : n >= s[0] ? 1 : 0);
  for (const [id, n] of kit) {
    const steps = kitSteps(id);
    out.push({ id, kind: 'kit', name: KIT_TRAITS[id].name, count: n, steps, tier: tierOf(n, steps) });
  }
  for (const [id, n] of el) {
    out.push({ id, kind: 'element', name: ELEMENT_TRAITS[id].name, count: n, steps: ELEMENT_STEPS, tier: tierOf(n, ELEMENT_STEPS) });
  }
  // 立っている段の高い順、次に揃っている数の多い順
  return out.sort((a, b) => b.tier - a.tier || b.count - a.count);
}
