import { spriteUrl } from '../fx/SpriteUnit';
import { getRevos } from '../game/data/revos';
import { holoIconCanvas } from './holoIcon';

/**
 * UI 用のリヴォス画像。3D と同じスプライトをそのまま出す。
 * ドット絵なので拡大は nearest（CSS 側で image-rendering: pixelated）。
 *
 * ★5 だけは輪郭を虹色に流すため、img ではなくキャンバスで返す。
 * 3D と UI で片方だけ光っていると、同じ素材に見えなくなる。
 */
/**
 * どの呼び出しにも必ず付く目印。
 *
 * 縦横比と nearest 拡大は、呼び出しごとのクラスではなくこの1つで面倒を見る。
 * 以前は CSS 側に「object-fit を効かせるクラス」の一覧を手で持っていて、
 * 新しい置き場所を足すたびに書き忘れが起きた——イベントの相手アイコンが
 * 潰れていたのはそれ。
 */
const SPRITE_CLASS = 'revos-sprite';

export function revosIcon(defId: string, className = 'revos-icon'): HTMLElement {
  const def = getRevos(defId);
  const cls = `${SPRITE_CLASS} ${className}`;
  // 伏せた絵・沈めた絵に虹は流さない。未所持ぶんまでキャンバスを回すと、
  // 図鑑を開いているだけで常時アニメーションが何枚も走る
  if (def.rarity >= 5 && !className.includes('is-silhouette') && !className.includes('is-dim')) {
    return holoIconCanvas(def.sprite, cls, def.name);
  }
  const img = document.createElement('img');
  img.className = cls;
  img.src = spriteUrl(def.sprite);
  img.alt = def.name;
  img.loading = 'lazy';
  img.decoding = 'async';
  return img;
}
