import './ui/style.css';
import './ui/screens.css';
import * as THREE from 'three';
import { GameRenderer } from './core/GameRenderer';
import { InputManager } from './core/Input';
import { UIRoot } from './ui/UIRoot';
import { TitleScreen } from './ui/screens/TitleScreen';
import { DigScreen } from './ui/screens/DigScreen';
import { DigScene } from './scenes/DigScene';
import { REVOS } from './game/data/revos';
import { audio } from './core/Audio';
import { load as loadSave, save as writeSave, defaultSave, dropDecay, type SaveData } from './core/Save';
import type { BiomeId } from './voxel/palette';

const boot = document.getElementById('boot')!;
const bootBar = document.getElementById('boot-bar-fill')!;
const bootStatus = document.getElementById('boot-status')!;

function progress(p: number, label: string): Promise<void> {
  bootBar.style.width = `${Math.round(p * 100)}%`;
  bootStatus.textContent = label;
  // ブラウザに描画の隙を与える。一気に走らせると進捗が一切見えない
  return new Promise((r) => requestAnimationFrame(() => setTimeout(r, 0)));
}

async function main(): Promise<void> {
  const canvas = document.getElementById('gl') as HTMLCanvasElement;
  const uiEl = document.getElementById('ui')!;

  await progress(0.08, 'レンダラを初期化しています…');
  const renderer = new GameRenderer(canvas);
  const input = new InputManager(canvas);
  const ui = new UIRoot(uiEl);

  renderer.onFlash = (hex, s) => ui.flash(`#${hex}`, s);
  let lostOverlay: HTMLElement | null = null;
  renderer.onContextLost = () => { lostOverlay = ui.showContextLost(); };
  renderer.onContextRestored = () => { lostOverlay?.remove(); lostOverlay = null; };

  await progress(0.22, '地層をスキャンしています…');
  let data: SaveData = loadSave();

  const dig = new DigScene(renderer.quality);
  const speciesPool = REVOS.map((r) => ({ id: r.id, rarity: r.rarity, weight: r.rarity === 1 ? 10 : r.rarity === 2 ? 6 : r.rarity === 3 ? 3 : 1 }));

  const title = new TitleScreen();
  const digScreen = new DigScreen(dig);
  ui.register(title);
  ui.register(digScreen);

  input.onStickChange = (a, ox, oy, dx, dy) => digScreen.setStick(a, ox, oy, dx, dy);

  title.onStart = (fresh) => {
    if (fresh) { data = defaultSave(); writeSave(data); }
    void startRun(data.unlockedBiomes[0] ?? 'canyon');
  };
  title.setHasSave(data.stats.runs > 0 || data.roster.length > 0);

  digScreen.onExit = () => {
    audio.uiBack();
    dig.setMode('explore');
    ui.show('title');
    audio.startMusic('calm');
  };
  digScreen.onFinish = () => {
    data.stats.runs++;
    data.daily.runs++;
    writeSave(data);
    ui.toast('発掘終了。拠点に戻ります', 'info');
    setTimeout(() => { ui.show('title'); audio.startMusic('calm'); }, 900);
  };

  async function startRun(biome: BiomeId): Promise<void> {
    boot.classList.remove('hidden');
    await progress(0.35, 'エリアを生成しています…');
    const seed = (Date.now() ^ (data.daily.runs * 7919)) >>> 0;
    dig.load(biome, seed, speciesPool, dropDecay(data.daily.runs));
    await progress(0.85, 'メッシュを構築しています…');
    dig.resize(renderer.aspect);
    renderer.setScene(dig.scene, dig.camera);
    renderer.invalidateShadows();
    await progress(1, '準備完了');
    ui.show('dig');
    audio.startMusic('dig');
    setTimeout(() => boot.classList.add('hidden'), 260);
  }

  // --- タイトル背景用の軽いシーン ---
  const titleScene = new THREE.Scene();
  const titleCam = new THREE.PerspectiveCamera(48, 1, 0.1, 200);
  titleCam.position.set(0, 3, 8);
  titleCam.lookAt(0, 1, 0);
  titleScene.background = new THREE.Color(0x1a140e);
  titleScene.add(new THREE.HemisphereLight(0xbfe3ff, 0x4a3a2c, 1.1));
  const keyLight = new THREE.DirectionalLight(0xfff0d0, 2.4);
  keyLight.position.set(4, 7, 5);
  titleScene.add(keyLight);

  renderer.setScene(titleScene, titleCam);
  ui.show('title');

  // --- 入力の解錠（iOSはユーザージェスチャが要る）---
  const unlock = () => {
    void audio.unlock();
    audio.setVolumes(data.settings.sfx, data.settings.bgm);
    audio.startMusic('calm');
    removeEventListener('pointerdown', unlock);
    removeEventListener('keydown', unlock);
  };
  addEventListener('pointerdown', unlock, { once: false });
  addEventListener('keydown', unlock, { once: false });

  // --- リサイズ ---
  let resizeTimer: number | undefined;
  const onResize = () => {
    if (resizeTimer !== undefined) clearTimeout(resizeTimer);
    // URLバーの出入りで resize が連発するのでデバウンスする
    resizeTimer = setTimeout(() => {
      renderer.resize();
      dig.resize(renderer.aspect);
      titleCam.aspect = renderer.aspect;
      titleCam.updateProjectionMatrix();
    }, 120) as unknown as number;
  };
  addEventListener('resize', onResize);
  addEventListener('orientationchange', () => setTimeout(onResize, 180));
  if (typeof ResizeObserver !== 'undefined') new ResizeObserver(onResize).observe(document.body);
  onResize();

  // --- 中断でポーズ ---
  let paused = false;
  document.addEventListener('visibilitychange', () => {
    paused = document.hidden;
    if (paused) audio.stopMusic();
    else if (ui.currentName === 'dig') audio.startMusic('dig');
  });

  // --- デバッグHUD ---
  const debug = document.createElement('div');
  debug.className = 'debug-hud';
  uiEl.appendChild(debug);
  const showDebug = new URLSearchParams(location.search).has('debug');
  debug.hidden = !showDebug;
  let debugTimer = 0;

  // --- ループ ---
  let last = performance.now();
  const loop = (now: number): void => {
    requestAnimationFrame(loop);
    // 低電力モードの30fps固定やタブ復帰の巨大デルタに耐える
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    if (paused) return;

    input.beginFrame();
    const inDig = ui.currentName === 'dig';
    if (inDig) {
      dig.update(dt, input, true);
      if (dig.consumeShadowDirty()) renderer.invalidateShadows();
    } else {
      titleCam.position.x = Math.sin(now * 0.00012) * 9;
      titleCam.position.z = Math.cos(now * 0.00012) * 9;
      titleCam.lookAt(0, 1.2, 0);
    }
    ui.update(dt);
    renderer.render(dt);
    input.endFrame();

    if (showDebug) {
      debugTimer += dt;
      if (debugTimer > 0.25) {
        debugTimer = 0;
        const i = renderer.info;
        const cv = renderer.canvas;
        debug.textContent =
          `${(1 / Math.max(dt, 1e-4)).toFixed(0)} fps  ${i.tier} x${i.scale.toFixed(2)}\n` +
          `calls ${i.calls}  tris ${(i.triangles / 1000).toFixed(0)}k\n` +
          `geo ${i.geometries}  prog ${i.programs}\n` +
          `css ${cv.clientWidth}x${cv.clientHeight} buf ${cv.width}x${cv.height}\n` +
          `win ${innerWidth}x${innerHeight} dpr ${devicePixelRatio}`;
      }
    }
  };
  requestAnimationFrame(loop);

  await progress(1, '準備完了');
  boot.classList.add('hidden');
}

main().catch((err) => {
  console.error(err);
  bootStatus.textContent = `起動に失敗しました: ${err instanceof Error ? err.message : String(err)}`;
});
