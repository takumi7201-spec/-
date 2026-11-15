import type { AbilityDef, RunUnitDef, Trigger, Target, Stat } from './types';

/**
 * ランでの46体の性能。
 *
 * 系統（data/traits.ts の効果特性）がそのまま「何を出すか」になる:
 *   灼熱 → 火傷、蝕毒 → 毒、守護 → 盾、癒し → 回復、弱体 → 遅延・剥がし、
 *   共鳴 → 加速、疾風 → 短いクールダウン、狩猟 → 手負いに重い・盾無視、
 *   群れ → 仲間の数で伸びる、剛力 → 重い一撃
 * 段（tier）は図鑑のレア度。
 */

const a = (when: Trigger, to: Target, stat: Stat, add: number, perm = false): AbilityDef => ({ when, to, stat, add, perm });

export const RUN_UNITS: RunUnitDef[] = [
  // ---- 段1 ----
  { id: 'xidazoon', tier: 1, cd: 4, fire: { dmg: 2 },
    abilities: [a('buy', 'kin', 'dmg', 1, true)] },
  { id: 'coelophysis', tier: 1, cd: 3, fire: { dmg: 1 },
    abilities: [a('fire', 'self', 'dmg', 1)] },
  { id: 'pikaia', tier: 1, cd: 4, fire: { dmg: 2, slow: 1 }, abilities: [] },
  { id: 'orthoceras', tier: 1, cd: 6, fire: { poison: 1 },
    abilities: [a('win', 'self', 'poison', 1, true)] },
  { id: 'dimorphodon', tier: 1, cd: 3, fire: { dmg: 2 }, execute: 1.5,
    abilities: [a('start', 'self', 'charge', 1.5)] },

  // ---- 段2 ----
  { id: 'paradoxides', tier: 2, cd: 5, fire: { shield: 3, slow: 1 }, abilities: [] },
  { id: 'anomalocaris', tier: 2, cd: 4, fire: { dmg: 4 }, execute: 1.5, abilities: [] },
  { id: 'irritator', tier: 2, cd: 5, fire: { dmg: 2, slow: 1 },
    abilities: [a('fire', 'adj', 'slow', 0.5)] },
  { id: 'microraptor', tier: 2, cd: 4, fire: { shield: 4 },
    abilities: [a('adjFire', 'self', 'charge', 0.3)] },
  { id: 'ankylosaurus', tier: 2, cd: 6, fire: { shield: 6, dmg: 2 },
    abilities: [a('end', 'self', 'shield', 1, true)] },
  // 攻撃するたびに火傷が育つ。ランの芯になる1体
  { id: 'yutyrannus', tier: 2, cd: 7, fire: { dmg: 1, burn: 1 },
    abilities: [a('fire', 'self', 'burn', 1, true)] },
  { id: 'triceratops', tier: 2, cd: 5, fire: { shield: 7, dmg: 2 },
    abilities: [a('fire', 'self', 'shield', 1)] },
  { id: 'ophthalmosaurus', tier: 2, cd: 5, fire: { dmg: 3 },
    abilities: [a('fire', 'adj', 'charge', 1)] },

  // ---- 段3 ----
  { id: 'maiasaura', tier: 3, cd: 5, fire: { heal: 5, shield: 3 }, abilities: [] },
  { id: 'archelon', tier: 3, cd: 6, fire: { shield: 8 },
    abilities: [a('start', 'self', 'charge', 3)] },
  // 隣の火傷を育てる。火傷役と並べるほど伸びる
  { id: 'dimetrodon', tier: 3, cd: 5, fire: { burn: 2 },
    abilities: [a('fire', 'adj', 'burn', 1, true)] },
  { id: 'majungasaurus', tier: 3, cd: 5, fire: { dmg: 7 },
    abilities: [a('win', 'self', 'dmg', 1, true)] },
  { id: 'kronosaurus', tier: 3, cd: 6, fire: { dmg: 6, slow: 1.5 }, abilities: [] },
  { id: 'pteranodon', tier: 3, cd: 2.5, fire: { dmg: 2 },
    abilities: [a('start', 'self', 'charge', 1)] },
  { id: 'goyocephale', tier: 3, cd: 6, fire: { shield: 4, burn: 2 }, abilities: [] },
  { id: 'shonisaurus', tier: 3, cd: 4, fire: { heal: 7, shield: 2 }, abilities: [] },
  { id: 'velociraptor', tier: 3, cd: 4, fire: { dmg: 3, strip: 3 }, abilities: [] },
  { id: 'tyrannosaurus', tier: 3, cd: 6, fire: { dmg: 10 }, execute: 1.5, abilities: [] },
  { id: 'pachycephalosaurus', tier: 3, cd: 4, fire: { dmg: 3 },
    abilities: [a('fire', 'others', 'charge', 0.5)] },
  { id: 'iguanodon', tier: 3, cd: 5, fire: { dmg: 5, slow: 1 }, abilities: [] },
  { id: 'albertaceratops', tier: 3, cd: 6, fire: { shield: 5, dmg: 3 },
    abilities: [a('end', 'adj', 'shield', 1, true)] },
  { id: 'carnotaurus', tier: 3, cd: 3, fire: { dmg: 4 },
    abilities: [a('fire', 'self', 'cd', -0.1)] },
  { id: 'stegosaurus', tier: 3, cd: 5, fire: { dmg: 4, shield: 6 },
    abilities: [a('adjFire', 'self', 'shield', 1)] },
  { id: 'diatryma', tier: 3, cd: 7, fire: { dmg: 14 }, abilities: [] },

  // ---- 段4 ----
  { id: 'smilodon', tier: 4, cd: 5, fire: { dmg: 4 }, exploit: 2, abilities: [] },
  { id: 'nipponites', tier: 4, cd: 5, fire: { heal: 8, shield: 3 },
    abilities: [a('end', 'self', 'heal', 1, true)] },
  { id: 'spinosaurus', tier: 4, cd: 6, fire: { dmg: 6, burn: 4 }, abilities: [] },
  { id: 'pliosaurus', tier: 4, cd: 4, fire: { dmg: 6 },
    abilities: [a('start', 'self', 'charge', 1)] },
  { id: 'tyrannosaurus-1915', tier: 4, cd: 4, fire: { dmg: 5 },
    abilities: [a('fire', 'self', 'cd', -0.2)] },
  { id: 'spinosaurus-1915', tier: 4, cd: 6, fire: { dmg: 3 },
    abilities: [a('fire', 'others', 'dmg', 1)] },
  { id: 'therizinosaurus', tier: 4, cd: 7, fire: { dmg: 12 }, pierce: true, abilities: [] },
  { id: 'elasmosaurus', tier: 4, cd: 4, fire: { poison: 2 },
    abilities: [a('win', 'self', 'poison', 1, true)] },
  { id: 'ornithomimus', tier: 4, cd: 4, fire: { dmg: 3 },
    abilities: [a('start', 'allies', 'charge', 1)] },
  { id: 'concavenator', tier: 4, cd: 5, fire: { dmg: 7 }, pierce: true, abilities: [] },
  { id: 'jobaria', tier: 4, cd: 6, fire: { shield: 6, poison: 2 }, abilities: [] },

  // ---- 段5 ----
  { id: 'tylosaurus', tier: 5, cd: 5, fire: { dmg: 5 }, hits: 2, abilities: [] },
  { id: 'pliosaurus-funkei', tier: 5, cd: 8, fire: { dmg: 14 },
    abilities: [a('adjFire', 'self', 'charge', 0.6)] },
  { id: 'quetzalcoatlus', tier: 5, cd: 6, fire: { dmg: 6 },
    abilities: [a('fire', 'others', 'charge', 1)] },
  { id: 'hatzegopteryx', tier: 5, cd: 6, fire: { dmg: 10 },
    abilities: [a('fire', 'self', 'dmg', 2)] },
  { id: 'tyrannosaurus-sue', tier: 5, cd: 8, fire: { dmg: 20 }, abilities: [] },
  { id: 'brachiosaurus', tier: 5, cd: 6, fire: { heal: 8 },
    abilities: [a('fire', 'allies', 'heal', 1)] },
];

const BY_ID = new Map(RUN_UNITS.map((u) => [u.id, u]));
export function runDef(id: string): RunUnitDef {
  const d = BY_ID.get(id);
  if (!d) throw new Error(`run unit not found: ${id}`);
  return d;
}
