import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { GradeShader } from '../shaders/GradeShader';
import {
  AdaptiveQuality, detectQuality, settingsFor,
  type QualitySettings, type QualityTier,
} from './Quality';

/**
 * レンダリング層。シーンとカメラは外から差し替える前提で、
 * ポストプロセスチェーンと品質管理だけを保持する。
 *
 * 重要な方針:
 *  - low ティアでは EffectComposer を一切作らず renderer.render() を直接呼ぶ。
 *    タイルベースGPUではオフスクリーンRTへの往復だけで 1〜3ms 消える。
 *  - AA は FXAA ではなく MSAA。ボクセルは高コントラストの直線エッジだらけで、
 *    ポストのエッジ検出は「シャープさ」という主要な魅力を舐めてしまう。
 *  - 色収差は使わない。直線エッジに色が付くと単純に汚い。
 */
export class GameRenderer {
  readonly renderer: THREE.WebGLRenderer;
  readonly canvas: HTMLCanvasElement;
  composer: EffectComposer | null = null;
  quality: QualitySettings;

  private scene: THREE.Scene | null = null;
  private camera: THREE.Camera | null = null;
  private renderPass: RenderPass | null = null;
  private bloomPass: UnrealBloomPass | null = null;
  private gradePass: ShaderPass | null = null;
  private renderTarget: THREE.WebGLRenderTarget | null = null;
  private adaptive = new AdaptiveQuality();
  private elapsed = 0;
  private flashDecay = 0;
  private flashColor = new THREE.Color(1, 1, 1);
  private flashAmount = 0;
  private desaturate = 0;
  /** CSS px。ワールド→スクリーン投影は必ずこちらを使う（描画バッファはDRSで伸縮する） */
  private cssWidth = 1;
  private cssHeight = 1;
  private contextLost = false;

  onContextLost?: () => void;
  onContextRestored?: () => void;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    this.quality = detectQuality();

    this.renderer = new THREE.WebGLRenderer({
      canvas,
      // ポスプロ無しのときに効く。RTを使う経路では RT 側の samples が効く
      antialias: true,
      powerPreference: 'high-performance',
      stencil: false,
      depth: true,
      alpha: false,
      preserveDrawingBuffer: false, // true は iOS で致命的に遅い
    });
    this.renderer.setClearColor(0x0a0d12, 1);
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    // ACES はボクセルの原色を一律にくすませる。Neutral は中間調の
    // 色相・彩度をほぼ保存したままハイライトだけ丸める
    this.renderer.toneMapping = THREE.NeutralToneMapping;
    this.renderer.toneMappingExposure = 1.02;
    // composer は内部で複数回 render するので、自動リセットだと最後のパスの値しか残らない
    this.renderer.info.autoReset = false;
    this.renderer.shadowMap.enabled = this.quality.shadows;
    // r186 で PCFSoftShadowMap は削除された。VSM はボクセルの直角な
    // シルエットで光漏れが直線状に出るので、PCF のまま解像度で稼ぐ
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    // 太陽は動かさないので、影は必要なときだけ焼き直す
    this.renderer.shadowMap.autoUpdate = false;

    canvas.addEventListener('webglcontextlost', this.handleContextLost, false);
    canvas.addEventListener('webglcontextrestored', this.handleContextRestored, false);

    this.buildPipeline();
    this.resize();
  }

  private handleContextLost = (e: Event) => {
    e.preventDefault(); // これを呼ばないと restored が来ない
    this.contextLost = true;
    this.onContextLost?.();
  };

  private handleContextRestored = () => {
    this.contextLost = false;
    this.buildPipeline();
    this.resize();
    this.onContextRestored?.();
  };

  /** 影を1フレームだけ焼き直す。地形を掘った・カメラがエリアをまたいだときに呼ぶ */
  invalidateShadows(): void {
    this.renderer.shadowMap.needsUpdate = true;
  }

  private disposePipeline(): void {
    this.composer?.dispose();
    this.renderTarget?.dispose();
    this.composer = null;
    this.renderTarget = null;
    this.renderPass = null;
    this.bloomPass = null;
    this.gradePass = null;
  }

  private buildPipeline(): void {
    this.disposePipeline();
    const q = this.quality;
    if (q.postPasses === 0) return; // 直接描画。これが最大の節約

    const size = new THREE.Vector2();
    this.renderer.getSize(size);

    this.renderTarget = new THREE.WebGLRenderTarget(
      Math.max(1, size.x), Math.max(1, size.y),
      {
        samples: q.msaaSamples,
        type: q.bloom ? THREE.HalfFloatType : THREE.UnsignedByteType,
        colorSpace: THREE.LinearSRGBColorSpace,
        depthBuffer: true,
        stencilBuffer: false,
      },
    );

    this.composer = new EffectComposer(this.renderer, this.renderTarget);
    this.composer.setPixelRatio(this.renderer.getPixelRatio());

    this.renderPass = new RenderPass(
      this.scene ?? new THREE.Scene(),
      this.camera ?? new THREE.PerspectiveCamera(),
    );
    this.composer.addPass(this.renderPass);

    if (q.bloom) {
      // 閾値を高く・強度を弱く。全画面ブルームは眠い絵になる
      this.bloomPass = new UnrealBloomPass(new THREE.Vector2(size.x, size.y), 0.38, 0.7, 0.88);
      this.composer.addPass(this.bloomPass);
    }

    this.gradePass = new ShaderPass(GradeShader as never);
    this.gradePass.uniforms.uGrain.value = q.grain;
    this.gradePass.uniforms.uChroma.value = 0;
    this.composer.addPass(this.gradePass);

    this.composer.addPass(new OutputPass());
  }

  setScene(scene: THREE.Scene, camera: THREE.Camera): void {
    this.scene = scene;
    this.camera = camera;
    if (this.renderPass) {
      this.renderPass.scene = scene;
      this.renderPass.camera = camera;
    }
    this.invalidateShadows();
  }

  setQuality(tier: QualityTier): void {
    if (tier === this.quality.tier) return;
    this.quality = settingsFor(tier);
    this.renderer.shadowMap.enabled = this.quality.shadows;
    this.buildPipeline();
    this.resize();
    this.invalidateShadows();
  }

  /** 被弾・発見演出用の全画面フラッシュ。ポスプロが無い場合はCSS側で代替する */
  flash(color: THREE.ColorRepresentation, strength = 0.6, decay = 2.6): void {
    this.flashColor.set(color);
    this.flashAmount = strength;
    this.flashDecay = decay;
    if (this.gradePass) {
      this.gradePass.uniforms.uFlashColor.value = [this.flashColor.r, this.flashColor.g, this.flashColor.b];
      this.gradePass.uniforms.uFlash.value = strength;
    }
    this.onFlash?.(this.flashColor.getHexString(), strength);
  }

  /** low ティアで EffectComposer が無いとき、UI層にフラッシュを委譲する */
  onFlash?: (hex: string, strength: number) => void;

  setDesaturate(v: number): void {
    this.desaturate = v;
    if (this.gradePass) this.gradePass.uniforms.uDesaturate.value = v;
  }

  get desaturateAmount(): number { return this.desaturate; }

  resize(): void {
    const w = Math.max(1, this.canvas.clientWidth || window.innerWidth);
    const h = Math.max(1, this.canvas.clientHeight || window.innerHeight);
    this.cssWidth = w;
    this.cssHeight = h;

    const pr = this.quality.pixelRatio * this.adaptive.scale;
    this.renderer.setPixelRatio(pr);
    this.renderer.setSize(w, h, false);

    if (this.composer) {
      this.composer.setPixelRatio(pr);
      this.composer.setSize(w, h);
      this.bloomPass?.setSize(w * pr, h * pr);
    }
    this.invalidateShadows();
  }

  render(dt: number): void {
    if (this.contextLost || !this.scene || !this.camera) return;
    this.elapsed += dt;

    if (this.flashAmount > 0) {
      this.flashAmount = Math.max(0, this.flashAmount - dt * this.flashDecay);
    }

    this.renderer.info.reset();
    if (this.composer && this.gradePass) {
      this.gradePass.uniforms.uTime.value = this.elapsed;
      this.gradePass.uniforms.uFlash.value = this.flashAmount;
      this.composer.render(dt);
    } else {
      this.renderer.render(this.scene, this.camera);
    }

    if (this.adaptive.update(dt * 1000)) this.resize();
  }

  /**
   * ワールド座標 → CSS px のスクリーン座標。
   * 描画バッファは動的解像度スケーリングで伸縮するので、
   * domElement.width を基準にすると負荷が高いときだけUIがズレる。
   */
  projectToScreen(world: THREE.Vector3, out: THREE.Vector2): THREE.Vector2 {
    if (!this.camera) return out.set(0, 0);
    const v = world.clone().project(this.camera);
    out.x = (v.x * 0.5 + 0.5) * this.cssWidth;
    out.y = (-v.y * 0.5 + 0.5) * this.cssHeight;
    return out;
  }

  get size(): { width: number; height: number } {
    return { width: this.cssWidth, height: this.cssHeight };
  }

  get aspect(): number { return this.cssWidth / this.cssHeight; }
  get lost(): boolean { return this.contextLost; }

  get info() {
    return {
      calls: this.renderer.info.render.calls,
      triangles: this.renderer.info.render.triangles,
      textures: this.renderer.info.memory.textures,
      geometries: this.renderer.info.memory.geometries,
      programs: this.renderer.info.programs?.length ?? 0,
      scale: this.adaptive.scale,
      tier: this.quality.tier,
    };
  }

  dispose(): void {
    this.canvas.removeEventListener('webglcontextlost', this.handleContextLost);
    this.canvas.removeEventListener('webglcontextrestored', this.handleContextRestored);
    this.disposePipeline();
    this.renderer.dispose();
  }
}
