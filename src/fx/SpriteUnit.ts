import * as THREE from 'three';

/**
 * ドット絵スプライトを3D空間に立てるユニット。
 *
 * ボクセルモデルの代わりに板ポリゴンへ貼る。ドット絵なので拡大は
 * ニアレストで、ミップも切る——線形補間をかけた瞬間に「絵の density」が
 * 失われて別物になる。
 *
 * ライティングは受けない（MeshBasic）。描き手が決めた明暗を光源で
 * 上書きすると、ドット絵の色設計が壊れるため。世界に馴染ませる調整は
 * material.color への乗算で行う。
 */

const loader = new THREE.TextureLoader();
const cache = new Map<string, THREE.Texture>();

export function spriteTexture(name: string): THREE.Texture {
  const hit = cache.get(name);
  if (hit) return hit;
  const tex = loader.load(`sprites/${name}.png`);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.magFilter = THREE.NearestFilter;
  tex.minFilter = THREE.NearestFilter;
  tex.generateMipmaps = false;
  tex.anisotropy = 1;
  cache.set(name, tex);
  return tex;
}

export function spriteUrl(name: string): string {
  return `sprites/${name}.png`;
}

/* =========================================================================
   ホログラフィックな輪郭

   ★5 だけ、黒で描かれた輪郭線を虹色に置き換える。塗りには触れない——
   描き手の色設計を上書きせず、「縁が光っている」だけで別格に見せる。

   判定は「ほぼ純黒」。この絵の輪郭は (0,0,0) 固定で、影の濃い青は
   輝度で 40 前後あるため、しきい値を 0.055 に置けば塗りを巻き込まない。
   ========================================================================= */

/** 全ホロ素材で共有する時間。フレームごとに1回だけ進める */
const holoTime = { value: 0 };

export function advanceHoloTime(dt: number): void {
  holoTime.value = (holoTime.value + dt) % 3600;
}

export function holoTimeValue(): number {
  return holoTime.value;
}

function applyHoloOutline(material: THREE.Material): void {
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uHoloTime = holoTime;
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', 'uniform float uHoloTime;\n#include <common>')
      .replace(
        '#include <map_fragment>',
        `#include <map_fragment>
        {
          // 純黒だけを輪郭とみなす。塗りの濃い影は拾わない
          float mx = max(max(diffuseColor.r, diffuseColor.g), diffuseColor.b);
          float isEdge = step(mx, 0.055) * step(0.5, diffuseColor.a);
          // 斜めに流れる分光。UV そのものを使うので反転しても縞が崩れない
          float sweep = vMapUv.x * 1.15 - vMapUv.y * 0.85 + uHoloTime * 0.16;
          // 箔の分光。彩度を上げきると虹そのものになってしまうので、
          // 白へ寄せて「光沢のある面が色を散らしている」ところで止める
          vec3 spec = 0.5 + 0.5 * cos(6.28318 * (sweep + vec3(0.0, 0.33, 0.67)));
          vec3 holo = mix(vec3(0.94, 0.96, 1.0), spec, 0.62);
          // 走査線。ホログラムは「面」ではなく「層」に見えないと嘘になる
          float scan = 0.78 + 0.22 * sin(vMapUv.y * 120.0 - uHoloTime * 5.0);
          // ときどき強く光る掃過
          float flare = pow(max(0.0, sin(6.28318 * (sweep * 0.5))), 6.0) * 0.5;
          diffuseColor.rgb = mix(diffuseColor.rgb, holo * scan + flare, isEdge);
        }`,
      );
  };
  // パッチ済みと素の MeshBasic が同じプログラムを共有しないようにする
  material.customProgramCacheKey = () => 'holo-outline-1';
}

export interface SpriteUnitOptions {
  /** ワールド単位の高さ */
  height?: number;
  /** 右を向いているか。false で左右反転 */
  facingRight?: boolean;
  /** 足元の影の濃さ */
  shadow?: number;
  /** 輪郭を虹色に光らせる（★5） */
  holo?: boolean;
}

export class SpriteUnit {
  readonly root = new THREE.Group();
  readonly mesh: THREE.Mesh;
  private shadowMesh: THREE.Mesh;
  private material: THREE.MeshBasicMaterial;
  private baseColor = new THREE.Color(1, 1, 1);
  private facing = 1;
  private height: number;
  private flash = 0;

  constructor(name: string, opts: SpriteUnitOptions = {}) {
    this.height = opts.height ?? 2.4;
    const tex = spriteTexture(name);

    this.material = new THREE.MeshBasicMaterial({
      map: tex,
      transparent: true,
      // 半端なアルファを残すと、重なったときに前後関係が崩れる
      alphaTest: 0.45,
      depthWrite: true,
      side: THREE.DoubleSide,
      toneMapped: false,
      fog: true,
    });
    if (opts.holo) applyHoloOutline(this.material);

    const geo = new THREE.PlaneGeometry(this.height, this.height);
    // 原点を足元に置く。接地やスケール演出の基準になる
    geo.translate(0, this.height / 2, 0);
    this.mesh = new THREE.Mesh(geo, this.material);
    this.mesh.renderOrder = 2;
    this.root.add(this.mesh);

    // 板ポリゴンの影はアルファを考慮しないので、足元に丸影を敷く
    const shadowGeo = new THREE.CircleGeometry(this.height * 0.28, 18);
    shadowGeo.rotateX(-Math.PI / 2);
    this.shadowMesh = new THREE.Mesh(
      shadowGeo,
      new THREE.MeshBasicMaterial({
        color: 0x000000,
        transparent: true,
        opacity: opts.shadow ?? 0.32,
        depthWrite: false,
        toneMapped: false,
      }),
    );
    this.shadowMesh.position.y = 0.02;
    this.shadowMesh.renderOrder = 1;
    this.root.add(this.shadowMesh);

    this.setFacing(opts.facingRight ?? true);
  }

  /**
   * 元絵は左向きに描かれているので、右を向かせるときに反転する。
   * 「絵がどちらを向いているか」を1か所に閉じ込め、呼び出し側は
   * 常に「相手のいる方向」だけを渡せばよいようにする。
   */
  setFacing(right: boolean): void {
    this.facing = right ? -1 : 1;
    this.mesh.scale.x = Math.abs(this.mesh.scale.x) * this.facing;
  }

  /** 被弾などの白フラッシュ 0..1 */
  setFlash(v: number): void {
    this.flash = v;
    const c = this.baseColor;
    this.material.color.setRGB(
      c.r + (1 - c.r) * v,
      c.g + (1 - c.g) * v,
      c.b + (1 - c.b) * v,
    );
  }

  /** 場に馴染ませるための基準色。夕景なら少し暖色へ寄せる */
  setTint(color: THREE.ColorRepresentation): void {
    this.baseColor.set(color);
    this.setFlash(this.flash);
  }

  setOpacity(v: number): void {
    this.material.opacity = v;
    const s = this.shadowMesh.material as THREE.MeshBasicMaterial;
    s.opacity = 0.32 * v;
  }

  /** 潰し・伸ばし。攻撃や着地の手応えはここで作る */
  setSquash(sx: number, sy: number): void {
    this.mesh.scale.set(sx * this.facing, sy, 1);
  }

  setShadowScale(v: number): void {
    this.shadowMesh.scale.setScalar(v);
  }

  /** Y軸だけカメラへ向ける。ビルボードだが寝かせない */
  faceCamera(camera: THREE.Camera): void {
    const cp = camera.position;
    const dx = cp.x - this.root.position.x;
    const dz = cp.z - this.root.position.z;
    this.mesh.rotation.y = Math.atan2(dx, dz);
  }

  get spriteHeight(): number { return this.height; }

  dispose(): void {
    this.mesh.geometry.dispose();
    this.material.dispose();
    this.shadowMesh.geometry.dispose();
    (this.shadowMesh.material as THREE.Material).dispose();
  }
}

export type SpriteState = 'idle' | 'walk' | 'attack' | 'hurt' | 'ko' | 'roar' | 'guard';

/**
 * スプライト用の手続きアニメーション。
 * 関節が無いぶん、タメ・ツメ・潰しで手応えを作る。
 */
export class SpriteAnimator {
  private t = Math.random() * 6.28;
  private stateT = 0;
  private state: SpriteState = 'idle';
  private hitFired = false;
  onHit?: () => void;
  actionProgress = 0;

  constructor(private unit: SpriteUnit) {}

  play(s: SpriteState): void {
    if (s === this.state) return;
    this.state = s;
    this.stateT = 0;
    this.hitFired = false;
    this.actionProgress = 0;
  }

  get current(): SpriteState { return this.state; }

  update(dt: number): void {
    this.t += dt;
    this.stateT += dt;
    const u = this.unit;
    const breathe = Math.sin(this.t * 1.8);

    switch (this.state) {
      case 'idle':
        u.setSquash(1 + breathe * 0.012, 1 - breathe * 0.018);
        u.root.position.y = Math.max(0, breathe * 0.03);
        u.setShadowScale(1 - breathe * 0.03);
        break;

      case 'walk': {
        const w = Math.sin(this.t * 8);
        u.setSquash(1 + w * 0.04, 1 - w * 0.05);
        u.root.position.y = Math.abs(w) * 0.1;
        break;
      }

      case 'attack': {
        const p = Math.min(1, this.stateT / 0.9);
        this.actionProgress = p;
        if (p < 0.34) {
          // タメ：縮んで後ろへ
          const k = p / 0.34;
          u.setSquash(1 + k * 0.12, 1 - k * 0.14);
          u.root.position.y = 0;
        } else if (p < 0.52) {
          // 打撃：伸びて前へ
          const k = (p - 0.34) / 0.18;
          u.setSquash(1 - k * 0.16, 1 + k * 0.2);
          u.root.position.y = k * 0.16;
          if (!this.hitFired && k > 0.6) { this.hitFired = true; this.onHit?.(); }
        } else {
          const k = (p - 0.52) / 0.48;
          u.setSquash(1 - 0.16 + k * 0.16, 1 + 0.2 - k * 0.2);
          u.root.position.y = 0.16 * (1 - k);
        }
        break;
      }

      case 'hurt': {
        const p = Math.min(1, this.stateT / 0.42);
        const k = Math.sin(p * Math.PI) * (1 - p * 0.3);
        u.setSquash(1 + k * 0.14, 1 - k * 0.16);
        u.root.position.y = k * 0.06;
        break;
      }

      case 'ko': {
        const p = Math.min(1, this.stateT / 0.75);
        const e = p * p * (3 - 2 * p);
        u.mesh.rotation.z = e * 1.5;
        u.setSquash(1, 1 - e * 0.12);
        u.setOpacity(1 - e * 0.55);
        u.setShadowScale(1 - e * 0.6);
        break;
      }

      case 'roar': {
        const p = Math.min(1, this.stateT / 1.2);
        const up = p < 0.25 ? p / 0.25 : p < 0.8 ? 1 : 1 - (p - 0.8) / 0.2;
        u.setSquash(1 + up * 0.12, 1 + up * 0.18);
        u.root.position.y = up * 0.26 + Math.sin(this.t * 34) * 0.02 * up;
        break;
      }

      case 'guard':
        u.setSquash(1.06, 0.94);
        u.root.position.y = 0;
        break;
    }
  }

  get finished(): boolean {
    if (this.state === 'attack') return this.stateT > 0.9;
    if (this.state === 'hurt') return this.stateT > 0.42;
    if (this.state === 'roar') return this.stateT > 1.2;
    return false;
  }
}
