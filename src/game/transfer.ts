import type { OwnedRevos, SaveData } from '../core/Save';
import { getRevos } from './data/revos';
import { cleanRank } from './battle/simulate';

/**
 * カセキ付け替え。
 *
 * 削りの成果を、別の個体へ移す。
 *
 * 精錬の腕は上がるのに、上がった腕で削れるのは「その時たまたま出た石」
 * だけだった。クリーン度 98 のアンキロサウルスが手元にあっても、
 * 戦わせたい個体のクリーン度は掘った日のまま動かない——腕を上げる意味が、
 * 手持ちの構成に左右されすぎる。
 *
 * そこで、よく削れた化石を「核」として別の個体へ移せるようにする。
 * 移せるのは B ランク（クリーン度 70）から。それ以下は結晶が残っていない。
 * 核にした個体は失われる——2体ぶんの手間で1体を仕上げる取引にしないと、
 * 削る回数だけが増えて、1回ごとの丁寧さが要らなくなる。
 *
 * 移せるのは同じ種のあいだだけ。別の種の結晶を継げるなら、掘るのは
 * いちばん出やすい1種だけでよくなり、地層ごとに棲み分けている意味が消える。
 * 同種に限れば、その種を掘り直して削り直した回数がそのまま厚みになる。
 *
 * 動くのはクリーン度だけ。レベルも経験値も移さない。
 */

/** 核にできる下限。cleanRank の B と同じ値にする——2か所で境目をずらさない */
export const TRANSFER_MIN_CLEAN = 70;

/** 上がり幅1点あたりの費用 */
const COST_PER_POINT = 14;
/** 受け取る側のレア度ぶんの費用。★5 を仕上げるのは高く付く */
const COST_PER_RARITY = 120;

export function transferCost(target: OwnedRevos, core: OwnedRevos): number {
  const gain = Math.max(0, core.clean - target.clean);
  return gain * COST_PER_POINT + getRevos(target.defId).rarity * COST_PER_RARITY;
}

export interface TransferQuote {
  ok: boolean;
  /** 断る理由。押せない札の上に出す */
  reason?: string;
  cost: number;
  /** クリーン度の上がり幅 */
  gain: number;
  from: number;
  to: number;
}

const NG = (reason: string): TransferQuote => ({ ok: false, reason, cost: 0, gain: 0, from: 0, to: 0 });

/** 成否と費用を先に出す。押してから断られるのがいちばん困る */
export function quoteTransfer(d: SaveData, targetUid: string | null, coreUid: string | null): TransferQuote {
  const target = d.roster.find((r) => r.uid === targetUid);
  const core = d.roster.find((r) => r.uid === coreUid);
  if (!target) return NG('移す先を選ぶ');
  if (!core) return NG('核を選ぶ');
  if (target.uid === core.uid) return NG('同じ個体は選べない');
  if (target.defId !== core.defId) return NG('同じ種のあいだでしか移せない');
  if (core.clean < TRANSFER_MIN_CLEAN) {
    return NG(`核はクリーン度 ${TRANSFER_MIN_CLEAN}（${cleanRank(TRANSFER_MIN_CLEAN)}ランク）から`);
  }
  if (core.clean <= target.clean) return NG('移す先のほうが高い');
  const cost = transferCost(target, core);
  if (d.player.coins < cost) return NG('コインが足りない');
  return { ok: true, cost, gain: core.clean - target.clean, from: target.clean, to: core.clean };
}

/** 核の資格。クリーン度だけの条件で、相手が決まる前の絞り込みに使う */
export function canBeCore(u: OwnedRevos): boolean {
  return u.clean >= TRANSFER_MIN_CLEAN;
}

/** この個体へ移せる核。同じ種で、いまより高いものだけ */
export function coresFor(d: SaveData, target: OwnedRevos): OwnedRevos[] {
  return d.roster.filter(
    (u) => u.uid !== target.uid && u.defId === target.defId
      && canBeCore(u) && u.clean > target.clean,
  );
}

/** 移す先になれる個体か。核が1体も無い個体を選ばせても、そこで行き止まる */
export function canBeTarget(d: SaveData, u: OwnedRevos): boolean {
  return coresFor(d, u).length > 0;
}

/**
 * いま成立する組の数。
 *
 * 核の資格を持つ個体の数ではない。同じ種の相方が居なければ核にはならないので、
 * 「クリーン度 70 以上が2体」と「別々の種で70以上が2体」を同じ数で出すと嘘になる。
 */
export function transferPairs(d: SaveData): number {
  return d.roster.filter((u) => canBeTarget(d, u)).length;
}

/**
 * 実行。
 *
 * 核は手持ちから消えるが、図鑑からは消さない。一度掘り当てた事実は
 * 手元に残っているかどうかとは別の記録なので、ここで削ると
 * 収蔵率が後ろへ戻る。
 */
export function applyTransfer(d: SaveData, targetUid: string, coreUid: string): TransferQuote {
  const q = quoteTransfer(d, targetUid, coreUid);
  if (!q.ok) return q;
  const target = d.roster.find((r) => r.uid === targetUid)!;
  const idx = d.roster.findIndex((r) => r.uid === coreUid);
  const core = d.roster[idx];

  target.clean = core.clean;
  d.player.coins -= q.cost;
  d.roster.splice(idx, 1);
  // 編成に入っていた核を残すと、出撃時に居ない個体を指したままになる
  if (d.party.order) {
    const order = d.party.order.map((uid) => (uid === coreUid ? '' : uid));
    const left = order.filter((uid) => uid !== '');
    d.party.order = left.length === 3 ? (left as [string, string, string]) : null;
  }
  return q;
}
