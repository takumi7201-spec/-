/**
 * 仕上げの1パス。ビネット・色収差・彩度/コントラスト・粒子・全画面フラッシュを
 * まとめて処理する。パスを分けると RT 往復が増えてモバイルで効かなくなるため、
 * 「見栄えに効くが安い」ものだけを一本に束ねている。
 */
export const GradeShader = {
  name: 'GradeShader',
  uniforms: {
    tDiffuse: { value: null as unknown },
    uTime: { value: 0 },
    uVignette: { value: 0.34 },
    uChroma: { value: 0.0016 },
    uSaturation: { value: 1.12 },
    uContrast: { value: 1.04 },
    uGrain: { value: 0.022 },
    uFlashColor: { value: [1, 1, 1] },
    uFlash: { value: 0 },
    uDesaturate: { value: 0 },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform float uTime;
    uniform float uVignette;
    uniform float uChroma;
    uniform float uSaturation;
    uniform float uContrast;
    uniform float uGrain;
    uniform vec3  uFlashColor;
    uniform float uFlash;
    uniform float uDesaturate;
    varying vec2 vUv;

    float hash12(vec2 p) {
      vec3 p3 = fract(vec3(p.xyx) * 0.1031);
      p3 += dot(p3, p3.yzx + 33.33);
      return fract((p3.x + p3.y) * p3.z);
    }

    void main() {
      vec2 uv = vUv;
      vec2 toCenter = uv - 0.5;
      float r2 = dot(toCenter, toCenter);

      // 画面端ほど強い色収差。中央は完全に無収差なのでUIは滲まない
      vec2 off = toCenter * uChroma * (0.35 + r2 * 3.0);
      vec3 col;
      col.r = texture2D(tDiffuse, uv + off).r;
      col.g = texture2D(tDiffuse, uv).g;
      col.b = texture2D(tDiffuse, uv - off).b;

      float luma = dot(col, vec3(0.2126, 0.7152, 0.0722));
      col = mix(vec3(luma), col, uSaturation);
      col = (col - 0.5) * uContrast + 0.5;
      col = mix(col, vec3(luma), uDesaturate);

      float vig = smoothstep(0.86, 0.18, r2 * 2.0);
      col *= mix(1.0, vig, uVignette);

      float g = hash12(uv * 1024.0 + fract(uTime) * 91.7) - 0.5;
      col += g * uGrain;

      col = mix(col, uFlashColor, uFlash);

      gl_FragColor = vec4(max(col, 0.0), 1.0);
    }
  `,
};
