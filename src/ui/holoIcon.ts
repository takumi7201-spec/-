import { spriteUrl } from '../fx/SpriteUnit';
import { holoTimeValue } from '../fx/SpriteUnit';

/**
 * UI 側のホログラフィック輪郭。
 *
 * 3D と同じ絵を UI でも出している以上、片方だけ光っていると別素材に
 * 見える。CSS では「黒い画素だけ」を選べないので、キャンバスで塗り替える。
 *
 * 実装上の要点:
 * - 塗り替えは1スプライトにつき1枚のオフスクリーンだけで行い、
 *   画面に出ている各アイコンはそれを drawImage でコピーする。
 *   同じ絵が6枚出ていても、走査するのは1枚ぶんで済む
 * - 元絵は 512px だが、絵のマス目は 64。その4倍の 256px で焼けば、
 *   図鑑の大きな表示（150px）まで縮小方向に収まり、粗さが出ない
 * - 15fps。ドット絵の分光は滑らかである必要がなく、むしろ少しカクつく
 *   ほうが「投影されている」ように見える
 */

const SIZE = 256;
const FPS = 15;

interface HoloSource {
  /** 塗り替え先。ここに描いたものを各アイコンへ配る */
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
  image: ImageData;
  /** 輪郭画素のバイトオフセット */
  edges: Uint32Array;
  /** 画素ごとの分光位相。毎フレーム計算し直さない */
  phase: Float32Array;
  ready: boolean;
}

const sources = new Map<string, HoloSource>();
/** 画面に出ているアイコン。描画対象がなければループごと止める */
const live = new Set<{ el: HTMLCanvasElement; sprite: string }>();
let raf = 0;
let lastDraw = 0;

function makeSource(sprite: string): HoloSource {
  const canvas = document.createElement('canvas');
  canvas.width = SIZE;
  canvas.height = SIZE;
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
  const src: HoloSource = {
    canvas, ctx,
    image: ctx.createImageData(SIZE, SIZE),
    edges: new Uint32Array(0),
    phase: new Float32Array(0),
    ready: false,
  };

  const img = new Image();
  img.decoding = 'async';
  img.src = spriteUrl(sprite);
  void img.decode().then(() => {
    ctx.imageSmoothingEnabled = false;
    ctx.clearRect(0, 0, SIZE, SIZE);
    ctx.drawImage(img, 0, 0, SIZE, SIZE);
    src.image = ctx.getImageData(0, 0, SIZE, SIZE);

    const d = src.image.data;
    const edges: number[] = [];
    const phase: number[] = [];
    for (let i = 0; i < d.length; i += 4) {
      // 3D 側と同じ判定。ほぼ純黒かつ不透明なら輪郭
      if (d[i + 3] < 128) continue;
      if (Math.max(d[i], d[i + 1], d[i + 2]) > 14) continue;
      const px = (i >> 2) % SIZE;
      const py = (i >> 2) / SIZE | 0;
      edges.push(i);
      phase.push((px / SIZE) * 1.15 - (py / SIZE) * 0.85);
    }
    src.edges = Uint32Array.from(edges);
    src.phase = Float32Array.from(phase);
    src.ready = true;
  }).catch(() => { /* 読めなければ静止画のまま */ });

  return src;
}

function sourceFor(sprite: string): HoloSource {
  let s = sources.get(sprite);
  if (!s) { s = makeSource(sprite); sources.set(sprite, s); }
  return s;
}

/** 3D シェーダと同じ式。片方だけ色が違うと同じ素材に見えない */
const WHITE: [number, number, number] = [0.94, 0.96, 1.0];

function holoRgb(out: [number, number, number], sweep: number, scan: number): void {
  const tau = Math.PI * 2;
  out[0] = 0.5 + 0.5 * Math.cos(tau * sweep);
  out[1] = 0.5 + 0.5 * Math.cos(tau * (sweep + 0.33));
  out[2] = 0.5 + 0.5 * Math.cos(tau * (sweep + 0.67));
  const flare = Math.pow(Math.max(0, Math.sin(tau * sweep * 0.5)), 6) * 0.5;
  for (let k = 0; k < 3; k++) {
    const v = WHITE[k] + (out[k] - WHITE[k]) * 0.62;
    out[k] = Math.min(1, v * scan + flare) * 255;
  }
}

const rgb: [number, number, number] = [0, 0, 0];

function paint(src: HoloSource, t: number): void {
  const d = src.image.data;
  for (let n = 0; n < src.edges.length; n++) {
    const i = src.edges[n];
    const py = (i >> 2) / SIZE;
    const scan = 0.78 + 0.22 * Math.sin(py * 0.94 - t * 5);
    holoRgb(rgb, src.phase[n] + t * 0.16, scan);
    d[i] = rgb[0];
    d[i + 1] = rgb[1];
    d[i + 2] = rgb[2];
  }
  src.ctx.putImageData(src.image, 0, 0);
}

function tick(now: number): void {
  raf = 0;
  if (live.size === 0) return;

  if (now - lastDraw >= 1000 / FPS) {
    lastDraw = now;
    const t = holoTimeValue();
    const painted = new Set<string>();
    for (const item of live) {
      if (!item.el.isConnected) { live.delete(item); continue; }
      const src = sourceFor(item.sprite);
      if (!src.ready) continue;
      if (!painted.has(item.sprite)) { paint(src, t); painted.add(item.sprite); }
      const ctx = item.el.getContext('2d');
      if (!ctx) continue;
      ctx.imageSmoothingEnabled = false;
      ctx.clearRect(0, 0, SIZE, SIZE);
      ctx.drawImage(src.canvas, 0, 0);
    }
  }
  if (live.size > 0) raf = requestAnimationFrame(tick);
}

/**
 * ホログラフィック輪郭つきのアイコンを作る。
 * DOM から外れたら自動で描画対象から落ちるので、後始末は要らない。
 */
export function holoIconCanvas(sprite: string, className: string, alt: string): HTMLCanvasElement {
  const el = document.createElement('canvas');
  el.width = SIZE;
  el.height = SIZE;
  el.className = className;
  el.setAttribute('role', 'img');
  el.setAttribute('aria-label', alt);

  const item = { el, sprite };
  live.add(item);
  sourceFor(sprite);
  if (!raf) raf = requestAnimationFrame(tick);
  return el;
}
