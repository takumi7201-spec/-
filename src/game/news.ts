import type { SaveData } from '../core/Save';

/**
 * お知らせ。
 *
 * 受信箱と分ける。あちらは「受け取る物がある」画面なので、
 * 読み物を混ぜると受け取り漏れが埋もれる。こちらは読むだけで、
 * 既読にする以外の操作を置かない。
 *
 * 新しいものが先頭。日付は表示のためだけに持つ——並びは配列の順で決める。
 */

export type NewsTag = 'update' | 'event' | 'notice';

export const NEWS_TAGS: Record<NewsTag, string> = {
  update: '更新',
  event: 'イベント',
  notice: 'お知らせ',
};

export interface NewsDef {
  id: string;
  date: string;
  tag: NewsTag;
  title: string;
  body: string;
}

export const NEWS: NewsDef[] = [
  {
    id: 'n-013', date: '09/20', tag: 'update',
    title: 'ミッションと商店を開きました',
    body: '拠点にミッションの帯を追加しました。いま最もクリアに近い1件が出ます。'
      + '一覧からは日課と記録の両方を確認でき、達成したものはその場で受け取れます。'
      + 'あわせてアイテムショップを開きました。掘り出せなかった原石と調査許可証を、'
      + '発掘で貯めたコインと交換できます。',
  },
  {
    id: 'n-012', date: '09/20', tag: 'update',
    title: 'バトル中の動きを作り直しました',
    body: 'ユニットが持ち場に張り付かなくなりました。役割ごとに間合いと歩調が違い、'
      + '壁役は前に出たまま構え、脚の速い役ほど広く動き回り、支援役は下がって間合いを取ります。'
      + '攻撃はその場の踏み込みではなく、相手まで歩いて戻る動きになりました。'
      + '勝敗の計算には手を入れていないので、同じ編成の強さは変わりません。',
  },
  {
    id: 'n-011', date: '09/19', tag: 'event',
    title: '★5 ハツェゴプテリクス / ブラキオサウルス',
    body: '2種を追加しました。ハツェゴプテリクスは特性「島の頂点」で、'
      + '攻撃に成功したとき一度だけ攻撃力が永続で上がります。'
      + 'ブラキオサウルスは特性「大地の伊吹」で味方の回復量を底上げし、'
      + '必殺「磨り潰し消化」で味方全体を継続回復させます。',
  },
  {
    id: 'n-010', date: '09/19', tag: 'update',
    title: '精錬の採点を変えました',
    body: '損傷は別枠で引くのではなく、得点の上限を下げる形にしました。'
      + '骨を1つ傷つけるごとに上限が 3 点下がります。丁寧に削れば上限のまま、'
      + '荒く削れば上限そのものが落ちる——どこで損をしたかが読める採点になります。'
      + '岩と化石の色の差も広げ、真ん中の抜けも直しました。',
  },
  {
    id: 'n-009', date: '09/18', tag: 'notice',
    title: '図鑑を未所持でも開けるようにしました',
    body: '未所持の個体も姿と性能を確かめられます。'
      + '属性・レア度・役割・所持で並べ替えができ、選んだ軸をもう一度押すと昇降が入れ替わります。',
  },
  {
    id: 'n-008', date: '09/17', tag: 'notice',
    title: '受信箱を開きました',
    body: 'ログインボーナスと運営からの配布が受信箱に届きます。'
      + '受け取り済みの便りも残るので、何をいつ受け取ったかを後から確かめられます。',
  },
];

export function unreadNews(d: SaveData): number {
  return NEWS.filter((n) => !d.news.read.includes(n.id)).length;
}

export function isUnread(d: SaveData, id: string): boolean {
  return !d.news.read.includes(id);
}

/** 開いたぶんをまとめて既読にする。読んだ数を返す */
export function markAllRead(d: SaveData): number {
  const fresh = NEWS.filter((n) => !d.news.read.includes(n.id));
  d.news.read.push(...fresh.map((n) => n.id));
  return fresh.length;
}
