import * as THREE from 'three';

/**
 * ダメージ数値。DOM ではなく WebGL 側で描く。
 *
 * 画面座標に固定するものは DOM、ワールド座標に追従するものは WebGL —
 * という切り分けを守る。DOM を毎フレーム追従させると、動的解像度
 * スケーリングが働いた瞬間にズレるうえ、レイアウト計算がそのまま
 * コストになる。
 *
 * 1枚のアトラスに 0-9 と記号を焼き、Sprite をプールして使い回す。
 */

const GLYPHS = '0123456789+-!×';
const CELL = 64;

interface Entry {
  sprite: THREE.Sprite;
  life: number;
  maxLife: number;
  vel: THREE.Vector3;
  base: THREE.Vector3;
  scale: number;
}

export class DamageNumbers {
  readonly group = new THREE.Group();
  private atlas: THREE.CanvasTexture;
  private pool: Entry[] = [];
  private active: Entry[] = [];
  private materials = new Map<string, THREE.SpriteMaterial>();

  constructor(private max = 24) {
    const cv = document.createElement('canvas');
    cv.width = CELL * GLYPHS.length;
    cv.height = CELL;
    const ctx = cv.getContext('2d')!;
    ctx.font = `800 ${CELL * 0.74}px ui-sans-serif, system-ui, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (let i = 0; i < GLYPHS.length; i++) {
      const x = i * CELL + CELL / 2;
      ctx.lineWidth = CELL * 0.16;
      ctx.strokeStyle = '#14100b';
      ctx.strokeText(GLYPHS[i], x, CELL / 2);
      ctx.fillStyle = '#ffffff';
      ctx.fillText(GLYPHS[i], x, CELL / 2);
    }
    this.atlas = new THREE.CanvasTexture(cv);
    this.atlas.colorSpace = THREE.SRGBColorSpace;
    this.atlas.minFilter = THREE.LinearFilter;
    this.atlas.magFilter = THREE.LinearFilter;
    this.group.renderOrder = 20;
  }

  private materialFor(color: string): THREE.SpriteMaterial {
    let m = this.materials.get(color);
    if (!m) {
      m = new THREE.SpriteMaterial({
        map: this.atlas,
        color: new THREE.Color(color),
        depthTest: false,
        depthWrite: false,
        transparent: true,
        fog: false,
      });
      this.materials.set(color, m);
    }
    return m;
  }

  /**
   * 数値を1つ飛ばす。倍速時でも読めるよう、桁数に依存しない大きさで出す。
   */
  spawn(
    position: THREE.Vector3,
    text: string,
    opts: { color?: string; scale?: number; life?: number; crit?: boolean } = {},
  ): void {
    if (this.active.length >= this.max) {
      const oldest = this.active.shift();
      if (oldest) this.recycle(oldest);
    }
    const color = opts.color ?? '#f8f2e4';
    const scale = (opts.scale ?? 1) * (opts.crit ? 1.5 : 1);

    // 文字ごとにスプライトを並べる。1枚のテクスチャを使い回すのでコストは低い
    const chars = [...text];
    const w = 0.26 * scale;
    const startX = -((chars.length - 1) * w) / 2;

    for (let i = 0; i < chars.length; i++) {
      const gi = GLYPHS.indexOf(chars[i]);
      if (gi < 0) continue;
      const e = this.take();
      const mat = this.materialFor(color);
      e.sprite.material = mat;
      // アトラスのセルを切り出す。material を共有するので map は clone する
      const map = this.atlas.clone();
      map.needsUpdate = true;
      map.repeat.set(1 / GLYPHS.length, 1);
      map.offset.set(gi / GLYPHS.length, 0);
      e.sprite.material = new THREE.SpriteMaterial({
        map,
        color: new THREE.Color(color),
        depthTest: false,
        depthWrite: false,
        transparent: true,
        fog: false,
      });
      e.base.copy(position);
      e.base.x += startX + i * w;
      e.sprite.position.copy(e.base);
      e.scale = scale * 0.46;
      e.sprite.scale.setScalar(e.scale);
      e.maxLife = opts.life ?? 0.95;
      e.life = e.maxLife;
      e.vel.set((Math.random() - 0.5) * 0.5, 2.4 + Math.random() * 0.6, 0);
      e.sprite.visible = true;
      this.active.push(e);
    }
  }

  private take(): Entry {
    const e = this.pool.pop();
    if (e) return e;
    const sprite = new THREE.Sprite();
    sprite.renderOrder = 20;
    this.group.add(sprite);
    return { sprite, life: 0, maxLife: 1, vel: new THREE.Vector3(), base: new THREE.Vector3(), scale: 1 };
  }

  private recycle(e: Entry): void {
    e.sprite.visible = false;
    (e.sprite.material as THREE.SpriteMaterial)?.map?.dispose();
    (e.sprite.material as THREE.Material)?.dispose();
    this.pool.push(e);
  }

  update(dt: number): void {
    for (let i = this.active.length - 1; i >= 0; i--) {
      const e = this.active[i];
      e.life -= dt;
      if (e.life <= 0) {
        this.active.splice(i, 1);
        this.recycle(e);
        continue;
      }
      const t = 1 - e.life / e.maxLife;
      e.vel.y -= 6.2 * dt;
      e.sprite.position.addScaledVector(e.vel, dt);
      // 出てすぐ大きく、消える直前に縮む
      const pop = t < 0.12 ? t / 0.12 : 1;
      const fade = t > 0.7 ? 1 - (t - 0.7) / 0.3 : 1;
      e.sprite.scale.setScalar(e.scale * (0.6 + pop * 0.4) * (0.85 + fade * 0.15));
      (e.sprite.material as THREE.SpriteMaterial).opacity = fade;
    }
  }

  clear(): void {
    for (const e of this.active) this.recycle(e);
    this.active.length = 0;
  }

  dispose(): void {
    this.clear();
    for (const e of this.pool) {
      this.group.remove(e.sprite);
      (e.sprite.material as THREE.Material)?.dispose();
    }
    for (const m of this.materials.values()) m.dispose();
    this.atlas.dispose();
  }
}
