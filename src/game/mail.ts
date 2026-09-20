import type { MailItem, MailReward, SaveData } from '../core/Save';
import { todayKey, yesterdayKey } from '../core/Save';
import { REVOS, getRevos } from './data/revos';
import type { BiomeId } from '../voxel/palette';

/**
 * 受信箱。
 *
 * ログインボーナスと運営からの配布を、同じ1か所へ落とす。
 * 直接インベントリへ突っ込まないのは、起動直後に「何かが増えた」だけが
 * 起きて、何を貰ったのか分からなくなるのを避けるため。受け取りは手動で、
 * 受け取り済みも一覧に残す。
 */

/** 7日周期。7日目だけ品を変えて、周回の終わりが分かるようにする */
const LOGIN_CYCLE: { label: string; rewards: (day: number) => MailReward[] }[] = [
  { label: '1 日目', rewards: () => [{ kind: 'coin', amount: 300 }] },
  { label: '2 日目', rewards: () => [{ kind: 'coin', amount: 400 }] },
  { label: '3 日目', rewards: (d) => [fossil(d, 2, 'canyon')] },
  { label: '4 日目', rewards: () => [{ kind: 'coin', amount: 600 }] },
  { label: '5 日目', rewards: () => [{ kind: 'coin', amount: 800 }] },
  { label: '6 日目', rewards: (d) => [fossil(d, 3, 'frostpeak')] },
  {
    label: '7 日目',
    rewards: (d) => [{ kind: 'coin', amount: 1200 }, fossil(d, 4, 'emberfield')],
  },
];

/**
 * 配る化石の種を決める。
 *
 * 乱数を引かず通算日数から決めるのは、同じ日に2回起動しても同じものが
 * 届くようにするため。日をまたがないかぎり内容は変わらない。
 */
function fossil(day: number, rarity: number, biome: BiomeId): MailReward {
  const pool = REVOS.filter((r) => !r.eventOnly && r.rarity === rarity);
  const list = pool.length > 0 ? pool : REVOS.filter((r) => !r.eventOnly);
  const pick = list[(day * 7919) % list.length];
  return { kind: 'fossil', defId: pick.id, rarity: pick.rarity, biome };
}

/** 運営からの配布。1通につき1回だけ届く */
const STAFF_MAIL: { id: string; title: string; body: string; rewards: MailReward[] }[] = [
  {
    id: 'welcome',
    title: '発掘許可証の発行',
    body: '調査団への登録を確認しました。初期の資金を送ります。層は浅いところから読んでください。',
    rewards: [{ kind: 'coin', amount: 1000 }],
  },
  {
    id: 'exp-fix',
    title: '経験値配分の改定について',
    body: '敗北時にも経験値が入るようになりました。また後列の取り分を前列と同額に改めています。'
      + 'これまでの編成で差が付いていたぶんのお詫びを添えます。',
    rewards: [{ kind: 'coin', amount: 600 }],
  },
  {
    id: 'drill-fix',
    title: '整備報告：ドリルの不具合',
    body: '精錬中、ドリルが細かい岩を削れない状態になっていました。修理済みです。ご不便をおかけしました。',
    rewards: [{ kind: 'coin', amount: 400 }],
  },
];

/**
 * ログインボーナスを積む。
 *
 * 日付が変わっていれば1通。同じ日に何度呼んでも増えない。
 * 戻り値は「新しく届いたか」——起動直後の報せを出すかどうかの判断に使う。
 */
export function grantLogin(data: SaveData): boolean {
  const today = todayKey();
  if (data.login.lastDate === today) return false;

  data.login.streak = data.login.lastDate === yesterdayKey() ? data.login.streak + 1 : 1;
  data.login.total += 1;
  data.login.lastDate = today;

  const idx = (data.login.total - 1) % LOGIN_CYCLE.length;
  const day = LOGIN_CYCLE[idx];
  data.mail.unshift({
    id: `login-${today}`,
    from: 'login',
    title: `ログインボーナス ${day.label}`,
    body: data.login.streak > 1
      ? `${data.login.streak} 日つづけての調査です。今日のぶんを送ります。`
      : '本日の調査開始を確認しました。今日のぶんを送ります。',
    rewards: day.rewards(data.login.total),
    sentAt: Date.now(),
  });
  return true;
}

/** 運営からの未配布ぶんを積む。届いた数を返す */
export function grantStaffMail(data: SaveData): number {
  let n = 0;
  for (const m of STAFF_MAIL) {
    if (data.login.deliveredStaff.includes(m.id)) continue;
    data.login.deliveredStaff.push(m.id);
    data.mail.unshift({
      id: `staff-${m.id}`,
      from: 'staff',
      title: m.title,
      body: m.body,
      rewards: m.rewards,
      sentAt: Date.now(),
    });
    n++;
  }
  return n;
}

export function isClaimable(m: MailItem, at = Date.now()): boolean {
  return !m.claimedAt && (m.expiresAt === undefined || m.expiresAt > at);
}

export function unclaimedCount(data: SaveData): number {
  return data.mail.filter((m) => isClaimable(m)).length;
}

/** 便り1通を受け取る。受け取れない状態なら false */
export function claimMail(data: SaveData, id: string): boolean {
  const m = data.mail.find((x) => x.id === id);
  if (!m || !isClaimable(m)) return false;
  for (const r of m.rewards) {
    if (r.kind === 'coin') data.player.coins += r.amount;
    // 化石は未精錬のまま積む。削る手間を飛ばすと精錬の意味が薄れる
    else data.stock.push({ defId: r.defId, rarity: r.rarity, biome: r.biome });
  }
  m.claimedAt = Date.now();
  return true;
}

/** 受け取れるものを全部。受け取った数を返す */
export function claimAll(data: SaveData): number {
  let n = 0;
  for (const m of data.mail) if (claimMail(data, m.id)) n++;
  return n;
}

/** 品の表示名。受信箱と受取の報せで同じ文言を使う */
export function rewardLabel(r: MailReward): string {
  return r.kind === 'coin'
    ? `◈ ${r.amount.toLocaleString('ja-JP')}`
    : `${getRevos(r.defId).name} の化石`;
}
