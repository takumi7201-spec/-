import * as THREE from 'three';

/**
 * エコーパルス（探知）の見た目。
 *
 * 反応マーカーは WebGL 側で描く。DOM を canvas 上に重ねてワールド座標へ
 * 追従させると、動的解像度スケーリングが働いた瞬間にズレるうえ、
 * 毎フレームのレイアウト計算がそのままコストになる。
 * 画面座標に固定するものだけが DOM、ワールドに追従するものは WebGL。
 */

export class EchoRing {
  readonly mesh: THREE.Mesh;
  private uniforms: Record<string, THREE.IUniform>;
  private t = 0;
  private duration = 1.1;
  private active = false;
  private maxRadius = 8;

  constructor(maxRadius = 8) {
    this.maxRadius = maxRadius;
    this.uniforms = {
      uProgress: { value: 0 },
      uColor: { value: new THREE.Color(0x2dc6a4) },
      uOpacity: { value: 0 },
    };
    // 1枚の円盤にリングを描く。ジオメトリを毎フレーム作り直さない
    const geo = new THREE.CircleGeometry(maxRadius, 64);
    geo.rotateX(-Math.PI / 2);
    const mat = new THREE.ShaderMaterial({
      uniforms: this.uniforms,
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      fog: false,
      vertexShader: /* glsl */ `
        varying vec2 vLocal;
        void main() {
          vLocal = position.xz;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: /* glsl */ `
        uniform float uProgress;
        uniform vec3  uColor;
        uniform float uOpacity;
        varying vec2 vLocal;
        void main() {
          float d = length(vLocal);
          float r = uProgress;
          // 進行する主リングと、内側に残る薄いトレイル
          float ring = smoothstep(0.55, 0.0, abs(d - r));
          float trail = smoothstep(r, r - 1.8, d) * 0.16 * step(d, r);
          float a = (ring * 0.85 + trail) * uOpacity;
          if (a < 0.004) discard;
          gl_FragColor = vec4(uColor, a);
        }
      `,
    });
    this.mesh = new THREE.Mesh(geo, mat);
    this.mesh.visible = false;
    this.mesh.renderOrder = 5;
    this.mesh.frustumCulled = false;
  }

  fire(position: THREE.Vector3, color: THREE.ColorRepresentation = 0x2dc6a4): void {
    this.mesh.position.copy(position);
    this.mesh.position.y += 0.12;
    (this.uniforms.uColor.value as THREE.Color).set(color);
    this.t = 0;
    this.active = true;
    this.mesh.visible = true;
  }

  update(dt: number): void {
    if (!this.active) return;
    this.t += dt;
    const p = this.t / this.duration;
    if (p >= 1) {
      this.active = false;
      this.mesh.visible = false;
      return;
    }
    // 立ち上がりを速く、終わりを緩く。等速だと機械的に見える
    const eased = 1 - Math.pow(1 - p, 2.2);
    this.uniforms.uProgress.value = eased * this.maxRadius;
    this.uniforms.uOpacity.value = Math.min(1, (1 - p) * 1.6);
  }

  dispose(): void {
    this.mesh.geometry.dispose();
    (this.mesh.material as THREE.Material).dispose();
  }
}

export type Strength = 1 | 2 | 3;

interface MarkerEntry {
  mesh: THREE.Mesh;
  strength: Strength;
  kind: 'fossil' | 'mineral';
  nodeId: number;
  phase: number;
}

/**
 * 反応マーカー。強／中／弱の3段階だけで表現する。
 * 小さい画面とボクセルの解像度では、連続的な強度差は読み取れない。
 */
export class EchoMarkers {
  readonly group = new THREE.Group();
  private entries: MarkerEntry[] = [];
  private geo: THREE.BufferGeometry;
  private t = 0;

  constructor() {
    // 上向きの菱形。ボクセル世界に馴染む直線的な形
    this.geo = new THREE.OctahedronGeometry(0.36, 0);
    this.group.renderOrder = 6;
  }

  set(
    items: { nodeId: number; position: THREE.Vector3; strength: Strength; kind: 'fossil' | 'mineral' }[],
  ): void {
    this.clear();
    // 同時表示は3件まで。画面が情報で埋まると探索が「読む作業」になる
    for (const it of items.slice(0, 3)) {
      const color = it.kind === 'mineral' ? 0x9c9086 : it.strength === 3 ? 0xf4a23c : it.strength === 2 ? 0xc98c2e : 0x8a7247;
      const mat = new THREE.MeshBasicMaterial({
        color,
        transparent: true,
        opacity: 0.9,
        depthTest: false,
        fog: false,
      });
      const mesh = new THREE.Mesh(this.geo, mat);
      mesh.position.copy(it.position);
      mesh.renderOrder = 6;
      this.group.add(mesh);
      this.entries.push({ mesh, strength: it.strength, kind: it.kind, nodeId: it.nodeId, phase: Math.random() * 6.28 });
    }
  }

  remove(nodeId: number): void {
    const i = this.entries.findIndex((e) => e.nodeId === nodeId);
    if (i < 0) return;
    const e = this.entries[i];
    this.group.remove(e.mesh);
    (e.mesh.material as THREE.Material).dispose();
    this.entries.splice(i, 1);
  }

  clear(): void {
    for (const e of this.entries) {
      this.group.remove(e.mesh);
      (e.mesh.material as THREE.Material).dispose();
    }
    this.entries.length = 0;
  }

  update(dt: number): void {
    this.t += dt;
    for (const e of this.entries) {
      // 強い反応ほど速く大きく脈打つ。数値を読ませずに強度を伝える
      const speed = 2 + e.strength * 1.6;
      const bob = Math.sin(this.t * speed + e.phase);
      e.mesh.position.y += bob * dt * 0.55;
      e.mesh.rotation.y += dt * 1.3;
      const s = 0.85 + bob * 0.12 + e.strength * 0.08;
      e.mesh.scale.setScalar(s);
      (e.mesh.material as THREE.MeshBasicMaterial).opacity = 0.62 + 0.3 * (bob * 0.5 + 0.5);
    }
  }

  dispose(): void {
    this.clear();
    this.geo.dispose();
  }
}

/** 距離から探知強度を出す。0-2m 強 / 2-5m 中 / 5-8m 弱 */
export function strengthForDistance(d: number): Strength | null {
  if (d <= 2) return 3;
  if (d <= 5) return 2;
  if (d <= 8) return 1;
  return null;
}
