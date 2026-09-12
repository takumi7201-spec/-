import * as THREE from 'three';

/**
 * 天球。HDRIを読み込まずに空気感を出すための手続き的グラデーション。
 * 太陽ディスク・地平のヘイズ・雲の帯をフラグメントで直接描く。
 * テクスチャ転送ゼロで、バイオームごとの色も uniform 差し替えで済む。
 */
export class Sky {
  readonly mesh: THREE.Mesh;
  private uniforms: Record<string, THREE.IUniform>;

  constructor(radius = 500) {
    this.uniforms = {
      uTop: { value: new THREE.Color(0x2a4a7a) },
      uHorizon: { value: new THREE.Color(0xffb877) },
      uBottom: { value: new THREE.Color(0x1a1410) },
      uSunDir: { value: new THREE.Vector3(0.4, 0.5, 0.6).normalize() },
      uSunColor: { value: new THREE.Color(0xfff0d0) },
      uSunSize: { value: 0.997 },
      uCloud: { value: 0.35 },
      uTime: { value: 0 },
      uStars: { value: 0 },
    };

    const geo = new THREE.SphereGeometry(radius, 32, 20);
    const mat = new THREE.ShaderMaterial({
      uniforms: this.uniforms,
      side: THREE.BackSide,
      depthWrite: false,
      fog: false,
      vertexShader: /* glsl */ `
        varying vec3 vDir;
        void main() {
          vDir = normalize(position);
          // 視点追従。天球は常にカメラ中心
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          gl_Position = projectionMatrix * mv;
        }
      `,
      fragmentShader: /* glsl */ `
        uniform vec3  uTop;
        uniform vec3  uHorizon;
        uniform vec3  uBottom;
        uniform vec3  uSunDir;
        uniform vec3  uSunColor;
        uniform float uSunSize;
        uniform float uCloud;
        uniform float uTime;
        uniform float uStars;
        varying vec3 vDir;

        float hash21(vec2 p) {
          p = fract(p * vec2(123.34, 456.21));
          p += dot(p, p + 45.32);
          return fract(p.x * p.y);
        }

        float noise2(vec2 p) {
          vec2 i = floor(p), f = fract(p);
          f = f * f * (3.0 - 2.0 * f);
          float a = hash21(i), b = hash21(i + vec2(1,0));
          float c = hash21(i + vec2(0,1)), d = hash21(i + vec2(1,1));
          return mix(mix(a,b,f.x), mix(c,d,f.x), f.y);
        }

        void main() {
          vec3 d = normalize(vDir);
          float h = d.y;

          // 実際の空は地平から10度ほど上でもう青い。ここを広く取ると
          // 俯瞰カメラでは画面に地平の色しか入らず、空が単色に見える
          float upper = smoothstep(-0.02, 0.22, h);
          float lower = smoothstep(0.0, -0.35, h);
          vec3 col = mix(uHorizon, uTop, pow(upper, 0.85));
          col = mix(col, uBottom, lower);

          // 太陽
          float sd = dot(d, normalize(uSunDir));
          float disk = smoothstep(uSunSize, uSunSize + 0.0016, sd);
          float glow = pow(max(sd, 0.0), 90.0) * 0.55 + pow(max(sd, 0.0), 8.0) * 0.14;
          col += uSunColor * (disk * 6.0 + glow);

          // 雲帯: 高度が低いほど引き伸ばして遠近感を出す
          if (uCloud > 0.001 && h > 0.02) {
            vec2 uv = d.xz / max(h, 0.06) * 0.6;
            float t = uTime * 0.006;
            float n = noise2(uv * 1.6 + vec2(t, t * 0.4));
            n = n * 0.6 + noise2(uv * 3.7 - vec2(t * 1.7, 0.0)) * 0.4;
            float cloud = smoothstep(0.52, 0.78, n) * smoothstep(0.02, 0.3, h) * uCloud;
            col = mix(col, mix(vec3(1.0), uSunColor, 0.35), cloud);
          }

          if (uStars > 0.001 && h > 0.0) {
            vec2 sp = floor(d.xz / max(h, 0.05) * 140.0);
            float s = hash21(sp);
            float star = step(0.9965, s) * (0.6 + 0.4 * sin(uTime * 3.0 + s * 40.0));
            col += vec3(star) * uStars * smoothstep(0.05, 0.4, h);
          }

          gl_FragColor = vec4(col, 1.0);
        }
      `,
    });

    this.mesh = new THREE.Mesh(geo, mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = -1000;
  }

  configure(o: {
    top: THREE.ColorRepresentation;
    horizon: THREE.ColorRepresentation;
    bottom: THREE.ColorRepresentation;
    sunColor: THREE.ColorRepresentation;
    cloud?: number;
    stars?: number;
  }): void {
    (this.uniforms.uTop.value as THREE.Color).set(o.top);
    (this.uniforms.uHorizon.value as THREE.Color).set(o.horizon);
    (this.uniforms.uBottom.value as THREE.Color).set(o.bottom);
    (this.uniforms.uSunColor.value as THREE.Color).set(o.sunColor);
    this.uniforms.uCloud.value = o.cloud ?? 0.35;
    this.uniforms.uStars.value = o.stars ?? 0;
  }

  setSunDirection(v: THREE.Vector3): void {
    (this.uniforms.uSunDir.value as THREE.Vector3).copy(v).normalize();
  }

  update(dt: number, cameraPos: THREE.Vector3): void {
    this.uniforms.uTime.value += dt;
    this.mesh.position.copy(cameraPos);
  }

  dispose(): void {
    this.mesh.geometry.dispose();
    (this.mesh.material as THREE.Material).dispose();
  }
}
