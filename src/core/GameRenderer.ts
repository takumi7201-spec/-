import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { FXAAShader } from 'three/examples/jsm/shaders/FXAAShader.js';
import { GradeShader } from '../shaders/GradeShader';
import { AdaptiveQuality, detectQuality, settingsFor, type QualitySettings, type QualityTier } from './Quality';

/**
 * レンダリング層。シーンとカメラは外から差し替える前提で、
 * ポストプロセスチェーンと品質管理だけを保持する。
 */
export class GameRenderer {
  readonly renderer: THREE.WebGLRenderer;
  readonly canvas: HTMLCanvasElement;
  composer!: EffectComposer;
  quality: QualitySettings;

  private renderPass!: RenderPass;
  private bloomPass?: UnrealBloomPass;
  private gradePass!: ShaderPass;
  private fxaaPass?: ShaderPass;
  private outputPass!: OutputPass;
  private adaptive = new AdaptiveQuality();
  private elapsed = 0;
  private flashDecay = 0;
  private width = 1;
  private height = 1;
  private contextLost = false;

  onContextLost?: () => void;
  onContextRestored?: () => void;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    this.quality = detectQuality();

    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: false, // ポストプロセス経由なのでMSAAは効かない。FXAAで代替
      powerPreference: 'high-performance',
      stencil: false,
      depth: true,
      alpha: false,
    });
    this.renderer.setClearColor(0x0b0e14, 1);
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    // ボクセルの原色を保ちつつハイライトだけ丸めたいので ACES ではなく AgX 寄りの
    // Neutral を採用。ACES は彩度の高い面がくすむ。
    this.renderer.toneMapping = THREE.NeutralToneMapping;
    this.renderer.toneMappingExposure = 1.0;
    this.renderer.shadowMap.enabled = this.quality.shadows;
    this.renderer.shadowMap.type = this.quality.softShadows
      ? THREE.PCFSoftShadowMap
      : THREE.PCFShadowMap;

    canvas.addEventListener('webglcontextlost', this.handleContextLost, false);
    canvas.addEventListener('webglcontextrestored', this.handleContextRestored, false);

    this.buildComposer();
    this.resize();
  }

  private handleContextLost = (e: Event) => {
    e.preventDefault();
    this.contextLost = true;
    this.onContextLost?.();
  };

  private handleContextRestored = () => {
    this.contextLost = false;
    this.buildComposer();
    this.resize();
    this.onContextRestored?.();
  };

  private buildComposer(): void {
    const q = this.quality;
    this.composer?.dispose();

    const size = new THREE.Vector2();
    this.renderer.getSize(size);

    this.composer = new EffectComposer(this.renderer);
    this.composer.setPixelRatio(q.pixelRatio);

    // 中身は setScene で差し替える。ダミーで初期化しておく
    const dummyScene = new THREE.Scene();
    const dummyCam = new THREE.PerspectiveCamera();
    this.renderPass = new RenderPass(dummyScene, dummyCam);
    this.composer.addPass(this.renderPass);

    if (q.bloom) {
      this.bloomPass = new UnrealBloomPass(
        new THREE.Vector2(size.x, size.y),
        q.tier === 'high' ? 0.42 : 0.3, // strength
        0.72, // radius
        0.86, // threshold: 化石の輝きとレーダーの発光だけ拾う
      );
      this.composer.addPass(this.bloomPass);
    } else {
      this.bloomPass = undefined;
    }

    this.gradePass = new ShaderPass(GradeShader as never);
    this.gradePass.uniforms.uGrain.value = q.grain;
    this.gradePass.uniforms.uChroma.value = q.chroma;
    this.composer.addPass(this.gradePass);

    this.outputPass = new OutputPass();
    this.composer.addPass(this.outputPass);

    if (q.antialias) {
      this.fxaaPass = new ShaderPass(FXAAShader);
      this.composer.addPass(this.fxaaPass);
    } else {
      this.fxaaPass = undefined;
    }
  }

  setScene(scene: THREE.Scene, camera: THREE.Camera): void {
    this.renderPass.scene = scene;
    this.renderPass.camera = camera;
  }

  setQuality(tier: QualityTier): void {
    if (tier === this.quality.tier) return;
    this.quality = settingsFor(tier);
    this.renderer.shadowMap.enabled = this.quality.shadows;
    this.renderer.shadowMap.type = this.quality.softShadows
      ? THREE.PCFSoftShadowMap
      : THREE.PCFShadowMap;
    this.renderer.shadowMap.needsUpdate = true;
    this.buildComposer();
    this.resize();
  }

  /** 被弾・発見演出用の全画面フラッシュ */
  flash(color: THREE.ColorRepresentation, strength = 0.6, decay = 2.6): void {
    const c = new THREE.Color(color);
    this.gradePass.uniforms.uFlashColor.value = [c.r, c.g, c.b];
    this.gradePass.uniforms.uFlash.value = strength;
    this.flashDecay = decay;
  }

  setDesaturate(v: number): void {
    this.gradePass.uniforms.uDesaturate.value = v;
  }

  resize(): void {
    const w = Math.max(1, this.canvas.clientWidth || window.innerWidth);
    const h = Math.max(1, this.canvas.clientHeight || window.innerHeight);
    this.width = w;
    this.height = h;

    const pr = this.quality.pixelRatio * this.adaptive.scale;
    this.renderer.setPixelRatio(pr);
    this.renderer.setSize(w, h, false);
    this.composer.setPixelRatio(pr);
    this.composer.setSize(w, h);
    this.bloomPass?.setSize(w * pr, h * pr);

    if (this.fxaaPass) {
      this.fxaaPass.material.uniforms.resolution.value.set(1 / (w * pr), 1 / (h * pr));
    }
  }

  render(dt: number): void {
    if (this.contextLost) return;
    this.elapsed += dt;
    this.gradePass.uniforms.uTime.value = this.elapsed;

    const f = this.gradePass.uniforms.uFlash.value as number;
    if (f > 0) {
      this.gradePass.uniforms.uFlash.value = Math.max(0, f - dt * this.flashDecay);
    }

    this.composer.render(dt);

    if (this.adaptive.update(dt * 1000)) this.resize();
  }

  get aspect(): number {
    return this.width / this.height;
  }

  get info() {
    return {
      calls: this.renderer.info.render.calls,
      triangles: this.renderer.info.render.triangles,
      textures: this.renderer.info.memory.textures,
      geometries: this.renderer.info.memory.geometries,
      scale: this.adaptive.scale,
      tier: this.quality.tier,
    };
  }

  dispose(): void {
    this.canvas.removeEventListener('webglcontextlost', this.handleContextLost);
    this.canvas.removeEventListener('webglcontextrestored', this.handleContextRestored);
    this.composer.dispose();
    this.renderer.dispose();
  }
}
