import * as THREE from 'three';
import { Sky } from './Sky';
import type { Biome } from '../voxel/palette';
import type { QualitySettings } from '../core/Quality';

/**
 * シーンのライティング一式。
 *
 * 発掘エリアは 30m 前後の閉じた空間なので、CSM を持ち込まずに
 * 単一の平行光＋エリア全体を覆う正射影シャドウで足りる。
 * 2048px で 32m をカバーすれば 1.5cm/texel あり、ボクセル1個(0.5m)に
 * 30texel 以上乗る。CSM の分割コストを払う理由がない。
 */
export class Environment {
  readonly sun: THREE.DirectionalLight;
  readonly hemi: THREE.HemisphereLight;
  readonly fill: THREE.DirectionalLight;
  readonly sky: Sky;
  readonly group = new THREE.Group();

  private sunDir = new THREE.Vector3(0.45, 0.72, 0.35).normalize();
  private shadowRadius = 22;

  constructor(quality: QualitySettings) {
    // 天球はカメラに追従するので、半径は far より内側に取る。
    // far(200〜260) より外に置くと錐台でクリップされ、空が一度も描かれない。
    this.sky = new Sky(150);
    this.group.add(this.sky.mesh);

    this.sun = new THREE.DirectionalLight(0xfff0d0, 3.0);
    this.sun.castShadow = quality.shadows;
    this.sun.shadow.mapSize.set(quality.shadowMapSize, quality.shadowMapSize);
    // ボクセルの平坦な面はシャドウアクネが出やすい。normalBias を
    // ボクセル1個分に近づけると、bias を上げずにピーターパンも避けられる
    this.sun.shadow.bias = -0.0004;
    this.sun.shadow.normalBias = 0.08;
    this.sun.shadow.camera.near = 0.5;
    this.sun.shadow.camera.far = 160;
    this.group.add(this.sun);
    this.group.add(this.sun.target);

    // 太陽の反対側からの弱い補助光。影の中が真っ黒に潰れるのを防ぐ
    this.fill = new THREE.DirectionalLight(0x7d8798, 0.16);
    this.fill.position.set(-0.4, 0.35, -0.6);
    this.group.add(this.fill);

    this.hemi = new THREE.HemisphereLight(0xbfe3ff, 0x4a3a2c, 0.9);
    this.group.add(this.hemi);
  }

  applyBiome(biome: Biome, scene: THREE.Scene): void {
    this.sun.color.set(biome.sunColor);
    this.sun.intensity = biome.sunIntensity;
    this.hemi.color.set(biome.ambientSky);
    this.hemi.groundColor.set(biome.ambientGround);
    this.hemi.intensity = biome.ambientIntensity;

    const night = biome.id === 'emberfield';
    this.sky.configure({
      top: biome.sky,
      horizon: biome.horizon,
      bottom: biome.fog,
      sunColor: biome.sunColor,
      cloud: night ? 0.5 : 0.34,
      stars: night ? 0.8 : 0,
    });

    if (biome.id === 'emberfield') this.sunDir.set(-0.35, 0.4, 0.5).normalize();
    else if (biome.id === 'frostpeak') this.sunDir.set(0.3, 0.78, -0.5).normalize();
    else this.sunDir.set(0.45, 0.72, 0.35).normalize();
    this.sky.setSunDirection(this.sunDir);
    this.fill.position.copy(this.sunDir).multiplyScalar(-1).setY(0.4);

    // 指数フォグのほうが地平の溶け方が自然で、遠クリップも隠れる
    scene.fog = new THREE.FogExp2(biome.fog, 0.0135);
  }

  /** シャドウカメラをエリアに合わせて固定する（追従不要なサイズ） */
  fitShadowToArea(center: THREE.Vector3, radius: number): void {
    this.shadowRadius = radius;
    const cam = this.sun.shadow.camera;
    cam.left = -radius;
    cam.right = radius;
    cam.top = radius;
    cam.bottom = -radius;
    cam.near = 0.5;
    cam.far = radius * 4.5;
    cam.updateProjectionMatrix();

    this.sun.target.position.copy(center);
    this.sun.position.copy(center).addScaledVector(this.sunDir, radius * 2.2);
    this.sun.target.updateMatrixWorld();
  }

  /** 広いエリアでのみ使う。中心をプレイヤーに追従させ、texel単位にスナップする */
  followShadow(target: THREE.Vector3): void {
    const texel = (this.shadowRadius * 2) / this.sun.shadow.mapSize.x;
    const snapped = target
      .clone()
      .divideScalar(texel)
      .floor()
      .multiplyScalar(texel);
    this.sun.target.position.copy(snapped);
    this.sun.position.copy(snapped).addScaledVector(this.sunDir, this.shadowRadius * 2.2);
    this.sun.target.updateMatrixWorld();
  }

  setQuality(q: QualitySettings): void {
    this.sun.castShadow = q.shadows;
    if (q.shadows) {
      this.sun.shadow.mapSize.set(q.shadowMapSize, q.shadowMapSize);
      this.sun.shadow.map?.dispose();
      this.sun.shadow.map = null;
    }
  }

  update(dt: number, cameraPos: THREE.Vector3): void {
    this.sky.update(dt, cameraPos);
  }

  dispose(): void {
    this.sky.dispose();
    this.sun.shadow.map?.dispose();
  }
}
