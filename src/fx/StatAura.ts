import * as THREE from 'three';
import { spriteUrl } from './SpriteUnit';

/**
 * ステータスが動いた瞬間に重ねる粒子。
 *
 * 上がったときは立ち上がる橙の火の粉、下がったときは降りてくる青の粒。
 * 向きと色が逆なので、色が見えなくても——倍速で1コマしか見えなくても——
 * どちらが起きたのか判別できる。
 *
 * 素材は 32×32 ドットを10コマ。GIF のままでは three のテクスチャとして
 * コマが進まないので、横一列のシートに焼いて UV をずらす。ドット絵なので
 * 拡大は nearest、ミップも作らない——縮小のたびにコマの端が隣のコマと
 * 混ざる（10コマぶんが1枚の帯に並んでいる）のを避ける。
 *
 * ユニットに追従させる。数値は出た場所に置き去りでいいが、こちらは
 * 体にまとうものなので、突進中に置き去りにされると「誰に何が起きたのか」
 * が読めなくなる。
 *
 * バフとデバフで1つずつ持つ。同じ行動で両方が飛ぶことがある（風蝕嵐は
 * 味方を強化しないが、跳襲のように敵に付けるものと味方への支援が
 * 同じターンに重なる編成はある）ので、間引きも別勘定にしたい。
 */

const FRAMES = 10;
/** 元GIFと同じ 10fps。倍速でもここは変えない——変えると別の素材に見える */
const FPS = 10;
const LIFE = FRAMES / FPS;

interface Entry {
  sprite: THREE.Sprite;
  map: THREE.Texture;
  follow: THREE.Object3D | null;
  offsetY: number;
  scale: number;
  life: number;
}

export class StatAura {
  readonly group = new THREE.Group();
  private base: THREE.Texture;
  private pool: Entry[] = [];
  private active: Entry[] = [];
  /** uid ごとの最終発生時刻。同じ瞬間に何枚も重ねない */
  private lastAt = new Map<string, number>();
  private clock = 0;

  constructor(sheet: string, private max = 12) {
    this.base = new THREE.TextureLoader().load(spriteUrl(sheet));
    this.base.colorSpace = THREE.SRGBColorSpace;
    this.base.magFilter = THREE.NearestFilter;
    this.base.minFilter = THREE.NearestFilter;
    this.base.generateMipmaps = false;
    this.base.wrapS = THREE.ClampToEdgeWrapping;
    this.base.wrapT = THREE.ClampToEdgeWrapping;
    this.group.renderOrder = 18;
  }

  /**
   * 1枚出す。
   *
   * 同じユニットに同じ瞬間へ何度も要求が来る——制空覇道は SPD と DEF で
   * 2件、それが味方3体ぶん同時に飛ぶ。風蝕嵐も敵3体に同時に乗る——ので、
   * ユニット単位で間引く。重ねても濃くなるだけで、情報は増えない。
   */
  spawn(uid: string, follow: THREE.Object3D, opts: { height?: number; scale?: number } = {}): void {
    const last = this.lastAt.get(uid);
    if (last !== undefined && this.clock - last < 0.25) return;
    this.lastAt.set(uid, this.clock);

    if (this.active.length >= this.max) {
      const oldest = this.active.shift();
      if (oldest) this.recycle(oldest);
    }
    const e = this.take();
    e.follow = follow;
    e.offsetY = opts.height ?? 1;
    e.scale = opts.scale ?? 2.1;
    e.life = LIFE;
    e.sprite.scale.setScalar(e.scale);
    e.sprite.visible = true;
    this.step(e);
    this.active.push(e);
  }

  private step(e: Entry): void {
    // 経過から逆算する。コマ送りを積算にすると、フレーム落ちのたびにズレる
    const t = LIFE - e.life;
    const f = Math.min(FRAMES - 1, Math.floor(t * FPS));
    e.map.offset.x = f / FRAMES;
    if (e.follow) {
      e.sprite.position.copy(e.follow.position);
      e.sprite.position.y += e.offsetY;
    }
  }

  private take(): Entry {
    const e = this.pool.pop();
    if (e) return e;
    const map = this.base.clone();
    map.needsUpdate = true;
    map.repeat.set(1 / FRAMES, 1);
    const sprite = new THREE.Sprite(new THREE.SpriteMaterial({
      map,
      transparent: true,
      depthTest: true,
      depthWrite: false,
      fog: false,
      /*
       * 加算ではなく通常合成。
       *
       * 粒子は光なので加算が素直に見えるが、この game の地面は砂と紙の
       * 明るい色で、そこに色を足しても白へ寄るだけでほとんど見えない。
       * 元の GIF が持っている色をそのまま出したほうが、明るい背景の
       * 上で形が残る。青はとくに加算だと消し飛ぶ。
       */
      blending: THREE.NormalBlending,
    }));
    sprite.renderOrder = 18;
    this.group.add(sprite);
    return { sprite, map, follow: null, offsetY: 1, scale: 2.1, life: 0 };
  }

  private recycle(e: Entry): void {
    e.sprite.visible = false;
    e.follow = null;
    this.pool.push(e);
  }

  update(dt: number): void {
    this.clock += dt;
    for (let i = this.active.length - 1; i >= 0; i--) {
      const e = this.active[i];
      e.life -= dt;
      if (e.life <= 0) {
        this.active.splice(i, 1);
        this.recycle(e);
        continue;
      }
      this.step(e);
    }
  }

  clear(): void {
    for (const e of this.active) this.recycle(e);
    this.active.length = 0;
    this.lastAt.clear();
  }

  dispose(): void {
    this.clear();
    for (const e of this.pool) {
      e.map.dispose();
      (e.sprite.material as THREE.Material).dispose();
    }
    this.pool.length = 0;
    this.base.dispose();
  }
}
