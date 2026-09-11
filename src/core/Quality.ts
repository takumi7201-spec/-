export type QualityTier = 'low' | 'medium' | 'high';

export interface QualitySettings {
  tier: QualityTier;
  pixelRatio: number;
  shadowMapSize: number;
  shadows: boolean;
  bloom: boolean;
  antialias: boolean;
  grain: number;
  chroma: number;
  /** 発掘エリアの描画距離（ワールド単位） */
  viewDistance: number;
  /** 同時パーティクル上限 */
  maxParticles: number;
  softShadows: boolean;
}

export const isMobile = (() => {
  if (typeof navigator === 'undefined') return false;
  const ua = navigator.userAgent;
  const coarse = typeof matchMedia !== 'undefined' && matchMedia('(pointer: coarse)').matches;
  return /android|iphone|ipad|ipod|mobile/i.test(ua) || (coarse && navigator.maxTouchPoints > 1);
})();

/** iPadOS 13+ は UA 上 Mac を名乗るのでタッチ点数で判別する */
export const isIOS = (() => {
  if (typeof navigator === 'undefined') return false;
  return (
    /iphone|ipad|ipod/i.test(navigator.userAgent) ||
    (/mac/i.test(navigator.userAgent) && navigator.maxTouchPoints > 1)
  );
})();

const PRESETS: Record<QualityTier, Omit<QualitySettings, 'tier' | 'pixelRatio'>> = {
  low: {
    shadowMapSize: 1024,
    shadows: true,
    bloom: false,
    antialias: false,
    grain: 0.012,
    chroma: 0.0,
    viewDistance: 90,
    maxParticles: 120,
    softShadows: false,
  },
  medium: {
    shadowMapSize: 1536,
    shadows: true,
    bloom: true,
    antialias: false,
    grain: 0.018,
    chroma: 0.0012,
    viewDistance: 140,
    maxParticles: 300,
    softShadows: true,
  },
  high: {
    shadowMapSize: 2560,
    shadows: true,
    bloom: true,
    antialias: true,
    grain: 0.022,
    chroma: 0.0018,
    viewDistance: 220,
    maxParticles: 700,
    softShadows: true,
  },
};

/**
 * 起動時の一次判定。GPU名は取得できないことが多いので
 * 「モバイルか」「論理コア数」「メモリ」「DPR」で粗く振り分け、
 * 実走行中のフレームタイムで AdaptiveQuality が上下に補正する。
 */
export function detectQuality(): QualitySettings {
  const dpr = typeof devicePixelRatio === 'number' ? devicePixelRatio : 1;
  const cores = (navigator as Navigator & { hardwareConcurrency?: number }).hardwareConcurrency ?? 4;
  const mem = (navigator as Navigator & { deviceMemory?: number }).deviceMemory ?? 4;

  let tier: QualityTier;
  if (isMobile) {
    tier = cores >= 6 && mem >= 4 ? 'medium' : 'low';
  } else {
    tier = cores >= 8 && mem >= 8 ? 'high' : 'medium';
  }

  const forced = new URLSearchParams(location.search).get('q');
  if (forced === 'low' || forced === 'medium' || forced === 'high') tier = forced;

  return { tier, pixelRatio: pixelRatioFor(tier, dpr), ...PRESETS[tier] };
}

export function pixelRatioFor(tier: QualityTier, dpr: number): number {
  // DPR3 の端末でネイティブ解像度を出すと塗り面積が9倍になる。
  // ボクセルアートは輪郭が太いので 1.5 以上はほぼ視認差がない。
  const cap = tier === 'low' ? 1.0 : tier === 'medium' ? 1.4 : 1.8;
  return Math.min(dpr, cap);
}

export function settingsFor(tier: QualityTier): QualitySettings {
  const dpr = typeof devicePixelRatio === 'number' ? devicePixelRatio : 1;
  return { tier, pixelRatio: pixelRatioFor(tier, dpr), ...PRESETS[tier] };
}

/**
 * 実測フレームタイムによる動的解像度スケーリング。
 * ティアを落とす前に解像度を落とすほうが体感の劣化が小さい。
 */
export class AdaptiveQuality {
  private samples: number[] = [];
  private cooldown = 0;
  scale = 1;
  readonly minScale: number;

  constructor(
    private readonly targetMs = 16.7,
    minScale = 0.62,
  ) {
    this.minScale = minScale;
  }

  /** @returns 解像度スケールが変化したら true */
  update(dtMs: number): boolean {
    this.samples.push(dtMs);
    if (this.samples.length < 45) return false;

    this.cooldown -= 1;
    // 平均ではなく中央値。GC やシーン切替の単発スパイクに反応させない
    const sorted = this.samples.slice().sort((a, b) => a - b);
    const median = sorted[sorted.length >> 1];
    this.samples.length = 0;

    if (this.cooldown > 0) return false;

    const prev = this.scale;
    if (median > this.targetMs * 1.35) {
      this.scale = Math.max(this.minScale, this.scale - 0.1);
      this.cooldown = 3;
    } else if (median < this.targetMs * 0.72 && this.scale < 1) {
      this.scale = Math.min(1, this.scale + 0.05);
      this.cooldown = 6;
    }
    return this.scale !== prev;
  }
}
