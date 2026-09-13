import { spriteUrl } from '../fx/SpriteUnit';
import { getRevos } from '../game/data/revos';

/**
 * UI 用のリヴォス画像。3D と同じスプライトをそのまま出す。
 * ドット絵なので拡大は nearest（CSS 側で image-rendering: pixelated）。
 */
export function revosIcon(defId: string, className = 'revos-icon'): HTMLImageElement {
  const def = getRevos(defId);
  const img = document.createElement('img');
  img.className = className;
  img.src = spriteUrl(def.sprite);
  img.alt = def.name;
  img.loading = 'lazy';
  img.decoding = 'async';
  return img;
}
