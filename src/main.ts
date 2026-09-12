import './ui/style.css';
import './ui/screens.css';
import * as THREE from 'three';
import { GameRenderer } from './core/GameRenderer';
import { InputManager } from './core/Input';
import { UIRoot } from './ui/UIRoot';
import { TitleScreen } from './ui/screens/TitleScreen';
import { DigScreen } from './ui/screens/DigScreen';
import { DigScene } from './scenes/DigScene';
import { BattleScene } from './scenes/BattleScene';
import { CleanScene } from './scenes/CleanScene';
import { CleanScreen } from './ui/screens/CleanScreen';
import { BattleScreen } from './ui/screens/BattleScreen';
import { BattlePlayer } from './game/battle/BattlePlayer';
import { buildTeamSetup, buildEnemyTeam, grantStarters, addFossil } from './game/party';
import { REVOS } from './game/data/revos';
import { audio } from './core/Audio';
import { load as loadSave, save as writeSave, defaultSave, dropDecay, addExp, type SaveData } from './core/Save';
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
  const battle = new BattleScene(renderer.quality);
  const clean = new CleanScene(renderer.quality);
  battle.reducedShake = data.settings.reducedShake;
  let player: BattlePlayer | null = null;
  /** この周回で回収した化石 */
  let runFossils: { defId: string; rarity: number }[] = [];
  const speciesPool = REVOS.map((r) => ({ id: r.id, rarity: r.rarity, weight: r.rarity === 1 ? 10 : r.rarity === 2 ? 6 : r.rarity === 3 ? 3 : 1 }));

  const title = new TitleScreen();
  const digScreen = new DigScreen(dig);
  const battleScreen = new BattleScreen();
  const cleanScreen = new CleanScreen(clean);
  ui.register(title);
  ui.register(digScreen);
  ui.register(cleanScreen);
  ui.register(battleScreen);

  input.onStickChange = (a, ox, oy, dx, dy) => digScreen.setStick(a, ox, oy, dx, dy);

  title.onStart = (fresh) => {
    if (fresh) { data = defaultSave(); }
    grantStarters(data);
    writeSave(data);
    void startRun(data.unlockedBiomes[0] ?? 'canyon');
  };
  title.onBattle = () => {
    grantStarters(data);
    writeSave(data);
    void startBattle();
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
    if (runFossils.length === 0) {
      writeSave(data);
      ui.toast('収穫なし。拠点に戻ります', 'warn');
      setTimeout(() => { ui.show('title'); audio.startMusic('calm'); }, 1200);
      return;
    }
    // 精錬は1周につき1体だけ。残りはストックに積む
    const best = runFossils.slice().sort((a, b) => b.rarity - a.rarity)[0];
    for (const f of runFossils) {
      if (f === best) continue;
      data.stock.push({ defId: f.defId, rarity: f.rarity, biome: data.unlockedBiomes[0] ?? 'canyon' });
    }
    writeSave(data);
    void startClean(best.defId, best.rarity);
  };

  cleanScreen.onFinish = (score, defId) => {
    const { isNew } = addFossil(data, defId, score.clean);
    data.stats.fossils++;
    writeSave(data);
    ui.toast(
      `${revosLabel(defId)} — ランク ${score.rank}（クリーン度 ${score.clean}）` +
      (isNew ? ' / 新種' : ' / スキルLv上昇'),
      score.rank === 'D' ? 'warn' : 'info', 3400,
    );
    if (score.rank === 'S') ui.toast('Sランク：スキルスロット3枠目を開放', 'info', 3000);
    setTimeout(() => void startBattle(), 1800);
  };

  async function startClean(defId: string, rarity: number): Promise<void> {
    boot.classList.remove('hidden');
    await progress(0.5, '母岩を切り出しています…');
    clean.resize(renderer.aspect);
    renderer.setScene(clean.scene, clean.camera);
    await progress(1, '');
    ui.show('clean', { defId, rarity, seed: (Date.now() ^ 0x51ed) >>> 0 });
    audio.startMusic('calm');
    setTimeout(() => boot.classList.add('hidden'), 200);
  }

  battleScreen.onFinish = (winner) => {
    data.stats.battles++;
    if (winner === 0) {
      data.stats.wins++;
      data.stageProgress++;
      data.player.coins += 120 + data.stageProgress * 40;
      // EXPは前列に厚く配る。さらに未育成ユニットにはキャッチアップ補正
      const setup = buildTeamSetup(data.roster, data.party.order, data.party.formation);
      const maxLv = Math.max(...data.roster.map((r) => r.level), 1);
      setup?.members.forEach((m, i) => {
        const unit = data.roster.find((r) => r.uid === m.uid);
        if (!unit) return;
        const share = i === 0 ? 0.5 : 0.25;
        const catchUp = unit.level < maxLv - 2 ? 2.0 : 1;
        const { leveled } = addExp(unit, Math.round(1800 * share * catchUp));
        if (leveled > 0) ui.toast(`${revosLabel(unit.defId)} が Lv${unit.level} に`, 'info', 2400);
      });
    }
    writeSave(data);
    setTimeout(() => {
      ui.show('title');
      title.setHasSave(true);
      audio.startMusic('calm');
      renderer.setScene(titleScene, titleCam);
    }, 600);
  };

  function revosLabel(defId: string): string {
    return REVOS.find((r) => r.id === defId)?.name ?? defId;
  }

  async function startBattle(): Promise<void> {
    const mine = buildTeamSetup(data.roster, data.party.order, data.party.formation);
    if (!mine) { ui.toast('編成できるリヴォスがいない', 'bad'); return; }
    boot.classList.remove('hidden');
    await progress(0.4, '闘技場を生成しています…');
    const seed = (Date.now() ^ (data.stageProgress * 104729)) >>> 0;
    battle.buildArena(data.unlockedBiomes[0] ?? 'canyon', seed);
    const foes = buildEnemyTeam(data.stageProgress, seed);
    player = new BattlePlayer(seed, mine, foes, battle);
    battleScreen.setPlayer(player);
    player.speed = data.settings.battleSpeed;
    await progress(0.9, 'リヴォスを復元しています…');
    battle.resize(renderer.aspect);
    renderer.setScene(battle.scene, battle.camera);
    renderer.invalidateShadows();
    player.start();
    ui.show('battle');
    audio.startMusic('battle');
    await progress(1, '');
    setTimeout(() => boot.classList.add('hidden'), 200);
  }

  dig.events.onCollect = (n) => {
    if (n.kind === 'fossil') runFossils.push({ defId: n.speciesId, rarity: n.rarity });
  };

  async function startRun(biome: BiomeId): Promise<void> {
    runFossils = [];
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

  // 開発用の直接遷移。?screen=clean / ?screen=battle で各画面を単体確認できる
  const jump = new URLSearchParams(location.search).get('screen');
  if (jump === 'clean') {
    grantStarters(data);
    void startClean('ignirapt', 2);
  } else if (jump === 'battle') {
    grantStarters(data);
    void startBattle();
  }

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
      battle.resize(renderer.aspect);
      clean.resize(renderer.aspect);
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
    const screen = ui.currentName;
    if (screen === 'dig') {
      dig.update(dt, input, true);
      if (dig.consumeShadowDirty()) renderer.invalidateShadows();
    } else if (screen === 'battle') {
      player?.update(dt);
      battle.update(dt);
    } else if (screen === 'clean') {
      // 更新は CleanScreen.update から駆動する（入力と時間が結び付くため）
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
