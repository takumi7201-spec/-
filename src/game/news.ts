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
    id: 'n-030', date: '11/15', tag: 'update',
    title: 'ランに一本化しました',
    body: '発掘・クリーニング・ユニット（手持ち・編成・図鑑・レベル）と、ステージ・コロシアム・'
      + 'イベントを外し、遊びを「ラン」1つにまとめました。'
      + '店でユニットを買い、横一列6枠に並べて戦います。体力はチームで1本。'
      + '各ユニットはクールダウンごとに発動し、攻撃・火傷・毒・盾・回復などを出します。'
      + '能力で数字が育ち、「永続」と書かれた育ちはランが終わるまで残ります。'
      + '同じユニットを3体重ねると★2、9体で★3。10勝で達成、ライフは5。'
      + 'これまでのコインと設定は引き継いでいます。',
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
