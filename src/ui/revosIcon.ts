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
export function revosIcon(defId: string, className = 'revos-icon'): HTMLElement {
  const def = getRevos(defId);
  if (def.rarity >= 5 && !className.includes('is-silhouette')) {
    return holoIconCanvas(def.sprite, className, def.name);
  }
  const img = document.createElement('img');
  img.className = className;
  img.src = spriteUrl(def.sprite);
  img.alt = def.name;
  img.loading = 'lazy';
  img.decoding = 'async';
  return img;
}
