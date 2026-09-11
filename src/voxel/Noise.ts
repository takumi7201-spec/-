/**
 * 依存を増やさないための自前ノイズ。
 * OpenSimplex系ではなく素直な Perlin + FBM。地形の起伏と鉱脈の
 * 分布にしか使わないので、勾配の質より決定性と速度を優先する。
 */

const PERM = new Uint8Array(512);

function buildPerm(seed: number): void {
  const p = new Uint8Array(256);
  for (let i = 0; i < 256; i++) p[i] = i;
  let s = seed >>> 0 || 1;
  for (let i = 255; i > 0; i--) {
    s ^= s << 13; s >>>= 0;
    s ^= s >>> 17;
    s ^= s << 5; s >>>= 0;
    const j = s % (i + 1);
    const t = p[i]; p[i] = p[j]; p[j] = t;
  }
  for (let i = 0; i < 512; i++) PERM[i] = p[i & 255];
}
buildPerm(1337);

export function seedNoise(seed: number): void {
  buildPerm(seed);
}

const fade = (t: number): number => t * t * t * (t * (t * 6 - 15) + 10);
const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;

function grad2(hash: number, x: number, y: number): number {
  switch (hash & 3) {
    case 0: return x + y;
    case 1: return -x + y;
    case 2: return x - y;
    default: return -x - y;
  }
}

export function perlin2(x: number, y: number): number {
  const xi = Math.floor(x) & 255;
  const yi = Math.floor(y) & 255;
  const xf = x - Math.floor(x);
  const yf = y - Math.floor(y);
  const u = fade(xf);
  const v = fade(yf);
  const aa = PERM[PERM[xi] + yi];
  const ab = PERM[PERM[xi] + yi + 1];
  const ba = PERM[PERM[xi + 1] + yi];
  const bb = PERM[PERM[xi + 1] + yi + 1];
  const x1 = lerp(grad2(aa, xf, yf), grad2(ba, xf - 1, yf), u);
  const x2 = lerp(grad2(ab, xf, yf - 1), grad2(bb, xf - 1, yf - 1), u);
  return lerp(x1, x2, v);
}

function grad3(hash: number, x: number, y: number, z: number): number {
  const h = hash & 15;
  const u = h < 8 ? x : y;
  const v = h < 4 ? y : h === 12 || h === 14 ? x : z;
  return ((h & 1) === 0 ? u : -u) + ((h & 2) === 0 ? v : -v);
}

export function perlin3(x: number, y: number, z: number): number {
  const xi = Math.floor(x) & 255;
  const yi = Math.floor(y) & 255;
  const zi = Math.floor(z) & 255;
  const xf = x - Math.floor(x);
  const yf = y - Math.floor(y);
  const zf = z - Math.floor(z);
  const u = fade(xf), v = fade(yf), w = fade(zf);

  const a = PERM[xi] + yi;
  const aa = PERM[a] + zi;
  const ab = PERM[a + 1] + zi;
  const b = PERM[xi + 1] + yi;
  const ba = PERM[b] + zi;
  const bb = PERM[b + 1] + zi;

  return lerp(
    lerp(
      lerp(grad3(PERM[aa], xf, yf, zf), grad3(PERM[ba], xf - 1, yf, zf), u),
      lerp(grad3(PERM[ab], xf, yf - 1, zf), grad3(PERM[bb], xf - 1, yf - 1, zf), u),
      v,
    ),
    lerp(
      lerp(grad3(PERM[aa + 1], xf, yf, zf - 1), grad3(PERM[ba + 1], xf - 1, yf, zf - 1), u),
      lerp(grad3(PERM[ab + 1], xf, yf - 1, zf - 1), grad3(PERM[bb + 1], xf - 1, yf - 1, zf - 1), u),
      v,
    ),
    w,
  );
}

export function fbm2(x: number, y: number, octaves = 4, lacunarity = 2, gain = 0.5): number {
  let sum = 0;
  let amp = 1;
  let freq = 1;
  let norm = 0;
  for (let i = 0; i < octaves; i++) {
    sum += perlin2(x * freq, y * freq) * amp;
    norm += amp;
    amp *= gain;
    freq *= lacunarity;
  }
  return sum / norm;
}

export function fbm3(x: number, y: number, z: number, octaves = 3, lacunarity = 2, gain = 0.5): number {
  let sum = 0;
  let amp = 1;
  let freq = 1;
  let norm = 0;
  for (let i = 0; i < octaves; i++) {
    sum += perlin3(x * freq, y * freq, z * freq) * amp;
    norm += amp;
    amp *= gain;
    freq *= lacunarity;
  }
  return sum / norm;
}

/** 尾根状の地形に使うリッジドノイズ */
export function ridged2(x: number, y: number, octaves = 4): number {
  let sum = 0;
  let amp = 0.5;
  let freq = 1;
  for (let i = 0; i < octaves; i++) {
    const n = 1 - Math.abs(perlin2(x * freq, y * freq));
    sum += n * n * amp;
    amp *= 0.5;
    freq *= 2;
  }
  return sum;
}
