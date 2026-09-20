import type { SaveData } from '../core/Save';
import { rollDaily } from '../core/Save';
import { REVOS } from './data/revos';
import type { BiomeId } from '../voxel/palette';

/**
 * 商店。
 *
 * 売るのは「削る前の原石」と「今日の効率」だけにする。
 * 完成した個体を直接売ると、掘る理由も削る理由も消える——
 * ここで買えるのは手間の入口であって、結果ではない。
 *
 * 原石の中身はレア度の幅でしか約束しない。中身まで選べると、
 * 図鑑を金で埋められてしまう。
 */

export type ShopKind = 'rough' | 'permit';

export interface ShopItem {
  id: string;
  name: string;
  desc: string;
  price: number;
  kind: ShopKind;
  /** 1日に買える回数。0 なら無制限 */
  dailyLimit: number;
  /** rough: 抽選するレア度の範囲（両端を含む） */
  rarity?: [number, number];
}

export const SHOP: ShopItem[] = [
  {
    id: 'rough-low', name: '並の原石', desc: '★1〜★2 の埋蔵物が1つ。未精錬のまま届く',
    price: 260, kind: 'rough', dailyLimit: 0, rarity: [1, 2],
  },
  {
    id: 'rough-mid', name: '良質な原石', desc: '★2〜★3 の埋蔵物が1つ。未精錬のまま届く',
    price: 780, kind: 'rough', dailyLimit: 0, rarity: [2, 3],
  },
  {
    id: 'rough-high', name: '特級の原石', desc: '★3〜★4 の埋蔵物が1つ。1日 2 個まで',
    price: 2100, kind: 'rough', dailyLimit: 2, rarity: [3, 4],
  },
  {
    id: 'permit', name: '調査許可証', desc: '本日の効率を 2 周ぶん戻す。1日 3 枚まで',
    price: 450, kind: 'permit', dailyLimit: 3,
  },
];

/** 今日あと何個買えるか。無制限なら Infinity */
export function stockLeft(d: SaveData, item: ShopItem): number {
  rollDaily(d);
  if (item.dailyLimit === 0) return Infinity;
  return Math.max(0, item.dailyLimit - (d.shop.bought[item.id] ?? 0));
}

export function canBuy(d: SaveData, item: ShopItem): boolean {
  return d.player.coins >= item.price && stockLeft(d, item) > 0;
}

export interface BuyResult {
  ok: boolean;
  /** トーストに出す一行 */
  message: string;
  /** rough を買ったときだけ入る。何が届いたかを名前で出す */
  got?: { defId: string; rarity: number; biome: BiomeId };
}

/**
 * 購入。
 *
 * 原石の中身は抽選する。同じ値段で同じ種が出ると、買う意味が
 * 「特定の1種を確保すること」になり、レア度の幅で売る建て付けが崩れる。
 * 抽選先は解放済みの発掘場に棲む種に限る——行ったことのない層の住人が
 * 商店に並ぶのは順序が逆になる。
 */
export function buy(d: SaveData, id: string): BuyResult {
  const item = SHOP.find((s) => s.id === id);
  if (!item) return { ok: false, message: '取り扱いがない' };
  if (stockLeft(d, item) <= 0) return { ok: false, message: '本日の分は売り切れ' };
  if (d.player.coins < item.price) return { ok: false, message: 'コインが足りない' };

  if (item.kind === 'permit') {
    if (d.daily.runs === 0) return { ok: false, message: '今日はまだ効率が落ちていない' };
    d.player.coins -= item.price;
    d.daily.runs = Math.max(0, d.daily.runs - 2);
    d.shop.bought[item.id] = (d.shop.bought[item.id] ?? 0) + 1;
    return { ok: true, message: '本日の効率を戻した' };
  }

  const [lo, hi] = item.rarity ?? [1, 2];
  const biomes = d.unlockedBiomes.length > 0 ? d.unlockedBiomes : (['canyon'] as BiomeId[]);
  // イベント専用の個体は地層に埋まっていない。商店にも並べない
  const pool = REVOS.filter(
    (r) => !r.eventOnly && r.rarity >= lo && r.rarity <= hi
      && r.habitat.some((b) => biomes.includes(b as BiomeId)),
  );
  if (pool.length === 0) return { ok: false, message: 'いまは並べられる原石がない' };

  // レア度が低いほど出やすい。幅の上限が確定で出るなら、幅で売る意味が無い
  const weights = pool.map((r) => (r.rarity <= 1 ? 8 : r.rarity === 2 ? 6 : r.rarity === 3 ? 3 : 1));
  const total = weights.reduce((a, b) => a + b, 0);
  let pick = Math.random() * total;
  let idx = 0;
  for (; idx < pool.length - 1; idx++) {
    pick -= weights[idx];
    if (pick <= 0) break;
  }
  const def = pool[idx];
  const habitat = def.habitat.filter((b) => biomes.includes(b as BiomeId));
  const biome = (habitat[Math.floor(Math.random() * habitat.length)] ?? biomes[0]) as BiomeId;

  d.player.coins -= item.price;
  d.shop.bought[item.id] = (d.shop.bought[item.id] ?? 0) + 1;
  d.stock.push({ defId: def.id, rarity: def.rarity, biome });
  return { ok: true, message: `${def.name}（★${def.rarity}）の原石を仕入れた`, got: { defId: def.id, rarity: def.rarity, biome } };
}
