import * as THREE from 'three';

/**
 * ボクセル用マテリアル。
 *
 * ゼロからShaderMaterialを書くとシャドウマップ/フォグ/トーンマッピング/
 * ライト種別を全部自前で面倒見る羽目になるので、MeshStandardMaterial を
 * onBeforeCompile で拡張する方式を採る。three.js のアップデート追従コストが
 * 劇的に安い。
 *
 * 追加している表現:
 *   - 頂点AO（greedyMesher が焼いた aAO を間接光と直接光に配分）
 *   - ボクセル単位のカラージッター（平坦な面の「のっぺり」を消す）
 *   - 面の向きによる階調（上面は空の色、側面は中間、底面は沈む）
 *   - フレネル・リムライト（シルエットを背景から分離する）
 *   - ボクセル格子のソフトエッジ（derivativesベースなので遠景で潰れない）
 */

export interface VoxelMaterialOptions {
  voxelSize?: number;
  aoIntensity?: number;
  /** 直接光にAOを掛ける割合。物理的には0だが、0.25前後が最も「立体的」に見える */
  aoDirect?: number;
  colorJitter?: number;
  edgeDarkness?: number;
  rimColor?: THREE.ColorRepresentation;
  rimStrength?: number;
  rimPower?: number;
  skyTint?: THREE.ColorRepresentation;
  groundTint?: THREE.ColorRepresentation;
  tintStrength?: number;
  flatShading?: boolean;
  transparent?: boolean;
}

export interface VoxelMaterial extends THREE.MeshStandardMaterial {
  userData: {
    uniforms: Record<string, THREE.IUniform>;
    setRim(color: THREE.ColorRepresentation, strength: number): void;
    setEmissivePulse(v: number): void;
  };
}

const COMMON_GLSL = /* glsl */ `
  float voxHash13(vec3 p) {
    p = fract(p * 0.3183099 + vec3(0.71, 0.113, 0.419));
    p *= 17.0;
    return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
  }
`;

export function createVoxelMaterial(opts: VoxelMaterialOptions = {}): VoxelMaterial {
  const uniforms: Record<string, THREE.IUniform> = {
    uVoxelSize: { value: opts.voxelSize ?? 1 },
    uAoIntensity: { value: opts.aoIntensity ?? 1 },
    uAoDirect: { value: opts.aoDirect ?? 0.28 },
    uColorJitter: { value: opts.colorJitter ?? 0.075 },
    uEdgeDarkness: { value: opts.edgeDarkness ?? 0.18 },
    uRimColor: { value: new THREE.Color(opts.rimColor ?? 0x9fd8ff) },
    uRimStrength: { value: opts.rimStrength ?? 0.3 },
    uRimPower: { value: opts.rimPower ?? 3.0 },
    uSkyTint: { value: new THREE.Color(opts.skyTint ?? 0xbfe3ff) },
    uGroundTint: { value: new THREE.Color(opts.groundTint ?? 0x4a3a2c) },
    uTintStrength: { value: opts.tintStrength ?? 0.14 },
    uHighlight: { value: 0 },
  };

  const mat = new THREE.MeshStandardMaterial({
    vertexColors: true,
    roughness: 0.94,
    metalness: 0.0,
    flatShading: opts.flatShading ?? false,
    transparent: opts.transparent ?? false,
  }) as VoxelMaterial;

  mat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);

    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        /* glsl */ `
        #include <common>
        attribute float aAO;
        varying float vVoxAO;
        varying vec2 vVoxUv;
        varying vec3 vVoxWorldPos;
        varying vec3 vVoxWorldNormal;
        `,
      )
      .replace(
        '#include <begin_vertex>',
        /* glsl */ `
        #include <begin_vertex>
        vVoxAO = aAO;
        vVoxUv = uv;
        vVoxWorldPos = (modelMatrix * vec4(transformed, 1.0)).xyz;
        vVoxWorldNormal = normalize(mat3(modelMatrix) * objectNormal);
        `,
      );

    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        /* glsl */ `
        #include <common>
        uniform float uVoxelSize;
        uniform float uAoIntensity;
        uniform float uAoDirect;
        uniform float uColorJitter;
        uniform float uEdgeDarkness;
        uniform vec3  uRimColor;
        uniform float uRimStrength;
        uniform float uRimPower;
        uniform vec3  uSkyTint;
        uniform vec3  uGroundTint;
        uniform float uTintStrength;
        uniform float uHighlight;
        varying float vVoxAO;
        varying vec2  vVoxUv;
        varying vec3  vVoxWorldPos;
        varying vec3  vVoxWorldNormal;
        ${COMMON_GLSL}
        `,
      )
      // ベースカラーにボクセル単位のジッタと面方向ティントを乗せる
      .replace(
        '#include <color_fragment>',
        /* glsl */ `
        #include <color_fragment>
        {
          vec3 cell = floor((vVoxWorldPos / uVoxelSize) - vVoxWorldNormal * 0.5);
          float jitter = voxHash13(cell) - 0.5;
          diffuseColor.rgb *= 1.0 + jitter * uColorJitter;

          float up = vVoxWorldNormal.y;
          vec3 tint = mix(uGroundTint, uSkyTint, up * 0.5 + 0.5);
          diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * tint * 2.0, uTintStrength);

          // ボクセル境界のソフトエッジ（greedy quad内部でも格子が見える）
          vec2 gw = fwidth(vVoxUv);
          vec2 gd = abs(fract(vVoxUv - 0.5) - 0.5) / max(gw, vec2(1e-5));
          float edge = 1.0 - clamp(min(gd.x, gd.y), 0.0, 1.0);
          diffuseColor.rgb *= 1.0 - edge * uEdgeDarkness;
        }
        `,
      )
      // AO: 間接光には全量、直接光には控えめに
      .replace(
        '#include <aomap_fragment>',
        /* glsl */ `
        float voxAO = mix(1.0, vVoxAO, uAoIntensity);
        reflectedLight.indirectDiffuse *= voxAO;
        reflectedLight.indirectSpecular *= voxAO;
        reflectedLight.directDiffuse *= mix(1.0, voxAO, uAoDirect);
        `,
      )
      // リムライト＋ハイライト（被弾・選択などのフラッシュ用）
      .replace(
        '#include <opaque_fragment>',
        /* glsl */ `
        {
          vec3 V = normalize(vViewPosition);
          float fres = 1.0 - clamp(dot(normalize(normal), V), 0.0, 1.0);
          outgoingLight += uRimColor * pow(fres, uRimPower) * uRimStrength;
          outgoingLight = mix(outgoingLight, vec3(1.0), uHighlight);
        }
        #include <opaque_fragment>
        `,
      );
  };

  // onBeforeCompile を差し替えたマテリアルはキャッシュキーを明示しないと
  // 同一パラメータの他マテリアルとプログラムを共有してしまう
  mat.customProgramCacheKey = () => 'voxel-v1';

  mat.userData = {
    uniforms,
    setRim(color: THREE.ColorRepresentation, strength: number) {
      (uniforms.uRimColor.value as THREE.Color).set(color);
      uniforms.uRimStrength.value = strength;
    },
    setEmissivePulse(v: number) {
      uniforms.uHighlight.value = v;
    },
  };

  return mat;
}
