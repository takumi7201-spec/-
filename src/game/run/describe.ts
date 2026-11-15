import { KIT_TRAIT, KIT_TRAITS } from '../data/traits';
import { runDef } from './units';
import { effectValue, cooldownOf } from './battle';
import { EFFECT_KINDS, starOf, type AbilityDef, type EffectKind, type RunUnit, type Stat } from './types';

/**
 * ランのユニットを言葉と数字にする。店・盤面・戦闘のどこでも同じ言い方で出す。
 */

export const EFFECT_NAMES: Record<EffectKind, string> = {
  dmg: '攻撃', burn: '火傷', poison: '毒', shield: '盾',
  heal: '回復', slow: '遅延', haste: '加速', strip: '剥がし',
};

/** 札に載せる1文字 */
export const EFFECT_GLYPH: Record<EffectKind, string> = {
  dmg: '攻', burn: '火', poison: '毒', shield: '盾',
  heal: '癒', slow: '遅', haste: '速', strip: '剥',
};

export const EFFECT_HELP: Record<EffectKind, string> = {
  dmg: '相手の体力を削る。盾が先に受ける',
  burn: '相手に火傷を積む。0.5秒ごとに積んだ数ぶん削り、半分に減る',
  poison: '相手に毒を積む。2秒ごとに積んだ数ぶん削る。減らず、盾を通る',
  shield: '自分の側に盾を積む。攻撃と火傷を先に受け止める',
  heal: '自分の側の体力を戻す',
  slow: '正面（同じ列のいちばん前）の相手の溜まりを、その秒数ぶん戻す',
  haste: '隣（上下左右）の味方の溜まりを、その秒数ぶん進める',
  strip: '相手の盾を削る',
};

const WHEN: Record<AbilityDef['when'], string> = {
  fire: '発動するたび', adjFire: '隣の味方が発動するたび', start: '開戦時',
  buy: '買ったとき', sell: '売ったとき', win: '勝った戦闘の後', end: '戦闘の後',
};

function statName(s: Stat): string {
  if (s === 'cd') return 'クールダウン';
  if (s === 'charge') return '溜まり';
  return EFFECT_NAMES[s];
}

function fmt(v: number): string {
  return Number.isInteger(v) ? String(v) : v.toFixed(1);
}

export function abilityText(defId: string, ab: AbilityDef): string {
  const kin = KIT_TRAIT[defId];
  const TO: Record<AbilityDef['to'], string> = {
    self: '自分の', adj: '隣（上下左右）の', left: '左隣の', right: '右隣の',
    allies: '味方全員の', others: '他の味方全員の',
    kin: `同じ系統（${kin ? KIT_TRAITS[kin].name : '—'}）の味方の`,
  };
  const sec = ab.stat === 'cd' || ab.stat === 'charge' || ab.stat === 'slow' || ab.stat === 'haste';
  const amount = `${ab.add > 0 ? '+' : ''}${fmt(ab.add)}${sec ? '秒' : ''}`;
  const tail = ab.perm ? '（永続）' : ab.when === 'start' || ab.when === 'fire' || ab.when === 'adjFire' ? '（この戦闘中）' : '';
  return `${WHEN[ab.when]}、${TO[ab.to]}${statName(ab.stat)} ${amount}${tail}`;
}

/** 素の性質（能力ではないもの） */
export function traitsText(defId: string): string[] {
  const d = runDef(defId);
  const out: string[] = [];
  if (d.execute) out.push(`相手の体力が半分を切ると攻撃 ×${d.execute}`);
  if (d.exploit) out.push(`相手に火傷か毒があると攻撃 ×${d.exploit}`);
  if (d.pierce) out.push('攻撃が盾を無視する');
  if (d.hits && d.hits > 1) out.push(`攻撃が${d.hits}回入る`);
  switch (d.special) {
    case 'devour': out.push('喰らう：戦闘の後、隣（上下左右）でいちばん段の低い味方を1体喰らい、その効果の数値をすべて永続で自分に足す。喰らった味方は盤面から消える'); break;
    case 'bloom': out.push('大地の恵み：戦闘の後、その戦闘で回復した量の1/5を、隣（上下左右）の味方の盾に永続で足す'); break;
    case 'chain': out.push('号令：発動すると、いちばん溜まっている他の味方がもう1回発動する（その味方の溜まりは減らない）'); break;
    case 'lonely': out.push('孤高：隣（上下左右）に味方がいないとき、攻撃×3'); break;
    case 'shieldEat': out.push('盾喰い：撃つ前に相手の盾をすべて剥がし、剥がした量をこの一撃の攻撃に足す'); break;
    case 'abyss': out.push('深淵：発動するたび、相手に積まれた火傷を2倍、毒を1.5倍にする'); break;
  }
  return out;
}

/** その個体の、いまの効果の数値（0 のものは省く） */
export function unitValues(u: RunUnit): { kind: EffectKind; value: number; grown: number }[] {
  const d = runDef(u.defId);
  const out: { kind: EffectKind; value: number; grown: number }[] = [];
  for (const k of EFFECT_KINDS) {
    const v = effectValue(d, u, k);
    if (v > 0) out.push({ kind: k, value: v, grown: u.perm[k] ?? 0 });
  }
  return out;
}

export function unitCooldown(u: RunUnit): number {
  return cooldownOf(runDef(u.defId), u);
}

/** 店に並んだときの姿（重ねる前の★1） */
export function shopUnit(defId: string): RunUnit {
  return { uid: `shop-${defId}`, defId, copies: 1, perm: {} };
}

export { starOf, fmt };
