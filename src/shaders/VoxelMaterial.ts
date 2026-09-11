import * as THREE from 'three';

/**
 * ボクセル用マテリアル。
 *
 * ゼロからShaderMaterialを書くとシャドウマップ/フォグ/トーンマッピング/
 * ライト種別を全部自前で面倒見る羽目になるので、既製マテリアルを
 * onBeforeCompile で拡張する方式を採る。three.js の追従コストが劇的に安い。
 *
 * ベースは Standard ではなく Lambert。ボクセルは法線が6方向しかなく面が
 * 平坦なので、GGX スペキュラも IBL も絵に情報を足さない。計算だけ残って
 * モバイルで 20〜30% 重くなる。
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
  /** 暗部の下限。0で完全な黒まで落ちる */
  floorLight?: number;
  flatShading?: boolean;
  transparent?: boolean;
}

export interface VoxelMaterial extends THREE.MeshLambertMaterial {
  userData: {
    uniforms: Record<string, THREE.IUniform>;
    setRim(color: THREE.ColorRepresentation, strength: number): void;
    setEmissivePulse(v: number): void;
  };
}

/** three.js の更新で #include 名が変わったら、黙って無視せず起動時に落とす */
function replaceOrThrow(src: string, needle: string, next: string): string {
  if (!src.includes(needle)) throw new Error(`voxel shader chunk not found: ${needle}`);
  return src.replace(needle, next);
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
    uRimStrength: { value: opts.rimStrength ?? 0.2 },
    uRimPower: { value: opts.rimPower ?? 3.0 },
    uSkyTint: { value: new THREE.Color(opts.skyTint ?? 0xbfe3ff) },
    uGroundTint: { value: new THREE.Color(opts.groundTint ?? 0x4a3a2c) },
    uTintStrength: { value: opts.tintStrength ?? 0.14 },
    uHighlight: { value: 0 },
    uFloorLight: { value: opts.floorLight ?? 0.07 },
  };

  const mat = new THREE.MeshLambertMaterial({
    vertexColors: true,
    flatShading: opts.flatShading ?? false,
    transparent: opts.transparent ?? false,
  }) as VoxelMaterial;

  mat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);

    shader.vertexShader = replaceOrThrow(
      shader.vertexShader,
      '#include <common>',
        /* glsl */ `
        #include <common>
        attribute float aAO;
        varying float vVoxAO;
        varying vec2 vVoxUv;
        varying vec3 vVoxWorldPos;
        varying vec3 vVoxWorldNormal;
      `,
    );
    shader.vertexShader = replaceOrThrow(
      shader.vertexShader,
      '#include <begin_vertex>',
        /* glsl */ `
        #include <begin_vertex>
        vVoxAO = aAO;
        vVoxUv = uv;
        vVoxWorldPos = (modelMatrix * vec4(transformed, 1.0)).xyz;
        vVoxWorldNormal = normalize(mat3(modelMatrix) * objectNormal);
      `,
    );

    shader.fragmentShader = replaceOrThrow(
      shader.fragmentShader,
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
        uniform float uFloorLight;
        varying float vVoxAO;
        varying vec2  vVoxUv;
        varying vec3  vVoxWorldPos;
        varying vec3  vVoxWorldNormal;
        ${COMMON_GLSL}
      `,
    );
    // ベースカラーにボクセル単位のジッタと面方向ティントを乗せる
    shader.fragmentShader = replaceOrThrow(
      shader.fragmentShader,
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
    );
    // AO: 間接光には全量、直接光には控えめに
    shader.fragmentShader = replaceOrThrow(
      shader.fragmentShader,
      '#include <aomap_fragment>',
        /* glsl */ `
        float voxAO = mix(1.0, vVoxAO, uAoIntensity);
        reflectedLight.indirectDiffuse *= voxAO;
        reflectedLight.directDiffuse *= mix(1.0, voxAO, uAoDirect);
        // 完全な黒は地層が読めなくなるだけで「暗さ」を伝えない。
        // ベースカラーに比例した下限を敷いて、暗部でも素材が分かるようにする
        reflectedLight.indirectDiffuse += diffuseColor.rgb * uFloorLight * voxAO;
      `,
    );
    // リムライト＋ハイライト（被弾・選択などのフラッシュ用）
    shader.fragmentShader = replaceOrThrow(
      shader.fragmentShader,
      '#include <opaque_fragment>',
        /* glsl */ `
        {
          vec3 V = normalize(vViewPosition);
          float fres = 1.0 - clamp(dot(normalize(normal), V), 0.0, 1.0);
          // 法線が6方向しかないので素のフレネルだと面ごとにベタで光る。
          // 上向き面ほど強く出して「空からの散乱光」に見立てると破綻しない
          float skyMask = smoothstep(-0.25, 0.6, vVoxWorldNormal.y);
          outgoingLight += uRimColor * pow(fres, uRimPower) * uRimStrength * skyMask;
          outgoingLight = mix(outgoingLight, vec3(1.0), uHighlight);
        }
        #include <opaque_fragment>
      `,
    );
  };

  // onBeforeCompile を差し替えたマテリアルはキャッシュキーを明示しないと
  // 同一パラメータの他マテリアルとプログラムを共有してしまう
  mat.customProgramCacheKey = () => 'voxel-lambert-v1';

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
