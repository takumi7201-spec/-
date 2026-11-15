import './ui/style.css';
import './ui/screens.css';
import * as THREE from 'three';
import { GameRenderer } from './core/GameRenderer';
import { UIRoot } from './ui/UIRoot';
import { TitleScreen } from './ui/screens/TitleScreen';
import { HomeScreen } from './ui/screens/HomeScreen';
import { NewsScreen } from './ui/screens/NewsScreen';
import { SettingsScreen } from './ui/screens/SettingsScreen';
import { RunScreen } from './ui/screens/RunScreen';
import { RunBattleScreen } from './ui/screens/RunBattleScreen';
import { RunLobbyScreen } from './ui/screens/RunLobbyScreen';
import { DexScreen } from './ui/screens/DexScreen';
import { HomeScene } from './scenes/HomeScene';
import { BattleScene } from './scenes/BattleScene';
import { tabBar } from './ui/chrome';
import { advanceHoloTime } from './fx/SpriteUnit';
import { audio } from './core/Audio';
import {
  load as loadSave, save as writeSave, defaultSave, clearSave, type SaveData,
} from './core/Save';
import { RUN_UNITS } from './game/run/units';
import { newRun, buildOpponent, finishBattle, isOver, RUN_WINS, type RunState } from './game/run/run';
import { runBattle, type RunBattleResult } from './game/run/battle';
import { unreadNews } from './game/news';

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
  const ui = new UIRoot(uiEl);

  renderer.onFlash = (hex, s) => ui.flash(`#${hex}`, s);
  let lostOverlay: HTMLElement | null = null;
  renderer.onContextLost = () => { lostOverlay = ui.showContextLost(); };
  renderer.onContextRestored = () => { lostOverlay?.remove(); lostOverlay = null; };

  await progress(0.2, 'セーブデータを読み込んでいます…');
  let data: SaveData = loadSave();

  // 画質。おまかせなら端末の判定に任せ、自分で選んだときだけその段に固定する
  const applyQuality = (): void => {
    if (data.settings.quality !== 'auto') renderer.setQuality(data.settings.quality);
  };
  applyQuality();

  await progress(0.4, '拠点を組み立てています…');
  const home = new HomeScene(renderer.quality);
  // 戦闘は以前の 3D の舞台に立たせる
  const stage = new BattleScene(renderer.quality);

  // ---------------------------------------------------------------- 画面

  const title = new TitleScreen();
  const homeScreen = new HomeScreen();
  const newsScreen = new NewsScreen();
  const settingsScreen = new SettingsScreen();
  const runScreen = new RunScreen();
  const runBattleScreen = new RunBattleScreen();
  const lobbyScreen = new RunLobbyScreen();
  const dexScreen = new DexScreen();
  for (const s of [title, homeScreen, newsScreen, settingsScreen, runScreen, runBattleScreen, lobbyScreen, dexScreen]) ui.register(s);
  runBattleScreen.scene3d = stage;

  // ---------------------------------------------------------------- 遷移

  function goHome(): void {
    // 拠点に立たせるのは、進行中のランの左端。ランが無ければ全体から1体
    const face = data.run?.board.find((u) => u)?.defId ?? RUN_UNITS[0].id;
    home.setGuest(face);
    home.resize(renderer.aspect);
    renderer.setScene(home.scene, home.camera);
    renderer.invalidateShadows();
    homeScreen.setData(data);
    ui.show('home');
    audio.startMusic('calm');
  }

  function goSettings(): void { settingsScreen.setData(data); ui.show('settings'); }

  // ---------------------------------------------------------------- ラン

  const RUN_ALL = RUN_UNITS.map((u) => u.id);
  let runFight: { res: RunBattleResult; foe: RunState['board'] } | null = null;

  function goRun(): void {
    if (!data.run) {
      data.run = newRun(RUN_ALL, (Date.now() >>> 0) ^ 0x5eed);
      data.runRecord = { best: 0, clears: 0, runs: 0, ...data.runRecord };
      data.runRecord.runs++;
      writeSave(data);
    }
    // 店は地で覆うので、裏は拠点のままでよい
    renderer.setScene(home.scene, home.camera);
    runScreen.setRun(data.run);
    ui.show('run');
  }

  /** ランの入口（下タブの「ラン」） */
  function goLobby(): void {
    renderer.setScene(home.scene, home.camera);
    lobbyScreen.setData(data);
    ui.show('runLobby');
  }

  /** ランを閉じる。勝ち数ぶんのコインを渡し、記録を更新する */
  function endRun(): void {
    const run = data.run;
    if (!run) return;
    const coins = run.wins * 40 + (run.wins >= RUN_WINS ? 300 : 0);
    data.player.coins += coins;
    const rec = { best: 0, clears: 0, runs: 0, ...data.runRecord };
    rec.best = Math.max(rec.best, run.wins);
    if (run.wins >= RUN_WINS) rec.clears++;
    data.runRecord = rec;
    ui.toast(run.wins >= RUN_WINS
      ? `ラン達成！ ${RUN_WINS}勝 · コイン +${coins}`
      : `ラン終了 · ${run.wins}勝 · コイン +${coins}`, 'info', 3500);
    data.run = null;
    writeSave(data);
  }

  lobbyScreen.onPlay = () => goRun();
  lobbyScreen.onAbandon = () => { endRun(); goLobby(); };

  runScreen.onBack = () => goLobby();
  runScreen.onChange = () => writeSave(data);
  runScreen.onFight = () => {
    const run = data.run;
    if (!run) return;
    const foe = buildOpponent(RUN_ALL, run.round, (run.rng ^ (run.round * 2654435761)) >>> 0);
    const res = runBattle(run.board, foe, run.round, { events: true, trace: true });
    runFight = { res, foe };
    stage.resize(renderer.aspect);
    renderer.setScene(stage.scene, stage.camera);
    renderer.invalidateShadows();
    ui.show('runBattle');
    audio.startMusic('battle');
    runBattleScreen.play(res, [run.board, foe], run.round);
  };
  runBattleScreen.onNext = () => {
    const run = data.run;
    audio.startMusic('calm');
    if (!run || !runFight) { goHome(); return; }
    finishBattle(run, runFight.res);
    runFight = null;
    if (isOver(run)) {
      endRun();
      goLobby();
      return;
    }
    writeSave(data);
    renderer.setScene(home.scene, home.camera);
    runScreen.setRun(run);
    ui.show('run');
  };

  // ---------------------------------------------------------------- 配線

  title.onStart = (fresh) => {
    if (fresh) data = defaultSave();
    writeSave(data);
    goHome();
  };
  title.onSettings = () => goSettings();
  title.setHasSave(!!data.run || (data.runRecord?.runs ?? 0) > 0 || data.stats.playSeconds > 0);

  homeScreen.onGo = (where) => {
    if (where === 'battle') goRun();
    else if (where === 'news') { newsScreen.setData(data); ui.show('news'); }
    else goSettings();
  };
  newsScreen.onBack = () => goHome();
  newsScreen.onRead = () => { writeSave(data); homeScreen.setData(data); };

  /** 下タブ。拠点・ラン・設定の3つ */
  const tabGo = (where: 'home' | 'battle' | 'dex' | 'settings'): void => {
    if (where === 'home') goHome();
    else if (where === 'battle') goLobby();
    else if (where === 'dex') { renderer.setScene(home.scene, home.camera); ui.show('dex'); }
    else goSettings();
  };
  ui.mountTabs(tabBar([
    { key: 'home', icon: '⌂', label: '拠点', onTap: () => tabGo('home') },
    { key: 'battle', icon: '⚔', label: 'ラン', onTap: () => tabGo('battle') },
    { key: 'dex', icon: '◈', label: '図鑑', onTap: () => tabGo('dex') },
    { key: 'settings', icon: '⚙', label: '設定', onTap: () => tabGo('settings') },
  ]));

  // 横に払って隣の枠へ。枠の入口にいるときだけ動かす
  const TAB_ORDER = ['home', 'battle', 'dex', 'settings'] as const;
  const TAB_ROOTS = new Set(['home', 'runLobby', 'dex', 'settings']);
  ui.onSwipeNav = (dir, tab, screen) => {
    if (!TAB_ROOTS.has(screen)) return;
    const i = TAB_ORDER.indexOf(tab as typeof TAB_ORDER[number]);
    const next = i < 0 ? undefined : TAB_ORDER[i + dir];
    if (!next) return;
    audio.uiTap();
    tabGo(next);
  };
  const refreshTabs = (): void => { ui.tabBadge('home', unreadNews(data)); };
  ui.onShow = () => refreshTabs();
  refreshTabs();

  settingsScreen.onChange = (key) => {
    const s = data.settings;
    if (key === 'audio') audio.setVolumes(s.sfx, s.bgm);
    else if (key === 'quality') applyQuality();
    writeSave(data);
  };
  settingsScreen.onGo = (where) => {
    if (where === 'title') { ui.show('title'); return; }
    void wipeSave();
  };

  /** セーブの消去。消したあとはタイトルへ戻す */
  async function wipeSave(): Promise<void> {
    const ok = await ui.confirm('セーブを消す', 'ランの記録と進行中のランが消える。元には戻せない。', '消す', true);
    if (!ok) return;
    clearSave();
    data = defaultSave();
    writeSave(data);
    applyQuality();
    title.setHasSave(false);
    ui.toast('セーブを消した', 'warn', 2600);
    ui.show('title');
  }

  // ---------------------------------------------------------------- タイトル背景

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

  // 開発用の直接遷移
  const jump = new URLSearchParams(location.search).get('screen');
  if (jump === 'home') goHome();
  else if (jump === 'run') goRun();
  else if (jump === 'lobby') goLobby();
  else if (jump === 'dex') tabGo('dex');
  else if (jump === 'news') { newsScreen.setData(data); ui.show('news'); }
  else if (jump === 'settings') goSettings();

  // ---------------------------------------------------------------- 環境

  const unlock = (): void => {
    void audio.unlock();
    audio.setVolumes(data.settings.sfx, data.settings.bgm);
    if (ui.currentName === 'title') audio.startMusic('calm');
    removeEventListener('pointerdown', unlock);
    removeEventListener('keydown', unlock);
  };
  addEventListener('pointerdown', unlock);
  addEventListener('keydown', unlock);

  let resizeTimer: number | undefined;
  const onResize = (): void => {
    if (resizeTimer !== undefined) clearTimeout(resizeTimer);
    // URLバーの出入りで resize が連発するのでデバウンスする
    resizeTimer = setTimeout(() => {
      renderer.resize();
      const a = renderer.aspect;
      home.resize(a);
      stage.resize(a);
      titleCam.aspect = a;
      titleCam.updateProjectionMatrix();
    }, 120) as unknown as number;
  };
  addEventListener('resize', onResize);
  addEventListener('orientationchange', () => setTimeout(onResize, 180));
  if (typeof ResizeObserver !== 'undefined') new ResizeObserver(onResize).observe(document.body);
  onResize();

  let paused = false;
  document.addEventListener('visibilitychange', () => {
    paused = document.hidden;
    if (paused) audio.stopMusic();
    else audio.startMusic(ui.currentName === 'runBattle' ? 'battle' : 'calm');
  });

  // ブラウザの戻る／Androidのバックジェスチャをゲーム内の戻るとして受ける
  history.pushState({ guard: true }, '');
  addEventListener('popstate', () => {
    history.pushState({ guard: true }, '');
    const s = ui.currentName;
    if (s === 'home' || s === 'title' || s === 'runBattle') return;
    if (s === 'run') { goLobby(); return; }
    goHome();
  });

  const showDebug = new URLSearchParams(location.search).has('debug');
  if (showDebug) {
    (window as unknown as { __game: unknown }).__game = { home, ui, get data() { return data; } };
  }

  // ---------------------------------------------------------------- ループ

  let last = performance.now();
  const loop = (now: number): void => {
    requestAnimationFrame(loop);
    // 低電力モードの30fps固定やタブ復帰の巨大デルタに耐える
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    if (paused) return;
    data.stats.playSeconds += dt;
    if (ui.currentName === 'title') {
      titleCam.position.x = Math.sin(now * 0.00012) * 9;
      titleCam.position.z = Math.cos(now * 0.00012) * 9;
      titleCam.lookAt(0, 1.2, 0);
    } else if (ui.currentName === 'runBattle') {
      stage.update(dt);
    } else {
      home.update(dt);
    }
    advanceHoloTime(dt);
    ui.update(dt);
    renderer.render(dt);
  };
  requestAnimationFrame(loop);

  await progress(1, '準備完了');
  boot.classList.add('hidden');
}

main().catch((err) => {
  console.error(err);
  bootStatus.textContent = `起動に失敗しました: ${err instanceof Error ? err.message : String(err)}`;
});
