import './ui/style.css';
import './ui/screens.css';
import * as THREE from 'three';
import { GameRenderer } from './core/GameRenderer';
import { InputManager } from './core/Input';
import { UIRoot } from './ui/UIRoot';
import { TitleScreen } from './ui/screens/TitleScreen';
import { HomeScreen } from './ui/screens/HomeScreen';
import { DigScreen } from './ui/screens/DigScreen';
import { CleanScreen } from './ui/screens/CleanScreen';
import { BattleScreen } from './ui/screens/BattleScreen';
import { PartyScreen } from './ui/screens/PartyScreen';
import { DexScreen } from './ui/screens/DexScreen';
import { ResultScreen, type ResultData } from './ui/screens/ResultScreen';
import { DigScene } from './scenes/DigScene';
import { CleanScene } from './scenes/CleanScene';
import { BattleScene } from './scenes/BattleScene';
import { HomeScene } from './scenes/HomeScene';
import { BattlePlayer } from './game/battle/BattlePlayer';
import { buildTeamSetup, buildEnemyTeam, grantStarters, addFossil } from './game/party';
import { REVOS } from './game/data/revos';
import { audio } from './core/Audio';
import {
  load as loadSave, save as writeSave, defaultSave, dropDecay, addExp,
  type SaveData,
} from './core/Save';
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

function label(defId: string): string {
  return REVOS.find((r) => r.id === defId)?.name ?? defId;
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

  await progress(0.2, 'セーブデータを読み込んでいます…');
  let data: SaveData = loadSave();

  await progress(0.34, '拠点を組み立てています…');
  const home = new HomeScene(renderer.quality);
  const dig = new DigScene(renderer.quality);
  const clean = new CleanScene(renderer.quality);
  const battle = new BattleScene(renderer.quality);
  battle.reducedShake = data.settings.reducedShake;

  let player: BattlePlayer | null = null;
  let runFossils: { defId: string; rarity: number }[] = [];
  /** 直前の周回の成果。リザルトで見せる */
  let pendingResult: ResultData | null = null;

  const speciesPool = REVOS.map((r) => ({
    id: r.id,
    rarity: r.rarity,
    weight: r.rarity === 1 ? 10 : r.rarity === 2 ? 6 : r.rarity === 3 ? 3 : 1,
  }));

  // ---------------------------------------------------------------- 画面

  const title = new TitleScreen();
  const homeScreen = new HomeScreen();
  const digScreen = new DigScreen(dig);
  const cleanScreen = new CleanScreen(clean);
  const battleScreen = new BattleScreen();
  const partyScreen = new PartyScreen();
  const dexScreen = new DexScreen();
  const resultScreen = new ResultScreen();
  for (const s of [title, homeScreen, digScreen, cleanScreen, battleScreen, partyScreen, dexScreen, resultScreen]) {
    ui.register(s);
  }

  input.onStickChange = (a, ox, oy, dx, dy) => digScreen.setStick(a, ox, oy, dx, dy);

  // 右半分で移動・左半分で視点。主アクションも移動と反対側の親指へ寄せる
  const applyHand = (): void => {
    input.setSwapSides(data.settings.swapSides);
    document.body.dataset.hand = data.settings.swapSides ? 'left' : 'right';
  };
  applyHand();

  // ---------------------------------------------------------------- 遷移

  function goHome(): void {
    home.setGuest(data.party.order?.[0]
      ? data.roster.find((r) => r.uid === data.party.order?.[0])?.defId ?? data.roster[0]?.defId ?? null
      : data.roster[0]?.defId ?? null);
    home.resize(renderer.aspect);
    renderer.setScene(home.scene, home.camera);
    renderer.invalidateShadows();
    homeScreen.setData(data);
    ui.show('home');
    audio.startMusic('calm');
  }

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
    digScreen.setSave(data);
    ui.show('dig');
    audio.startMusic('dig');
    setTimeout(() => boot.classList.add('hidden'), 240);
  }

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

  async function startBattle(): Promise<void> {
    const mine = buildTeamSetup(data.roster, data.party.order, data.party.formation);
    if (!mine) { ui.toast('編成できるリヴォスがいない', 'bad'); goHome(); return; }
    boot.classList.remove('hidden');
    await progress(0.4, '闘技場を生成しています…');
    const seed = (Date.now() ^ (data.stageProgress * 104729)) >>> 0;
    battle.buildArena(data.unlockedBiomes[0] ?? 'canyon', seed);
    player = new BattlePlayer(seed, mine, buildEnemyTeam(data.stageProgress, seed), battle);
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

  function showResult(r: ResultData): void {
    pendingResult = r;
    renderer.setScene(home.scene, home.camera);
    ui.show('result', r);
  }

  // ---------------------------------------------------------------- 配線

  title.onStart = (fresh) => {
    if (fresh) data = defaultSave();
    grantStarters(data);
    writeSave(data);
    goHome();
  };
  title.onBattle = () => { grantStarters(data); writeSave(data); void startBattle(); };
  title.onSettings = () => {
    data.settings.swapSides = !data.settings.swapSides;
    applyHand();
    writeSave(data);
    ui.toast(
      data.settings.swapSides ? '操作：右で移動 / 左で視点' : '操作：左で移動 / 右で視点',
      'info', 2200,
    );
  };
  title.setHasSave(data.stats.runs > 0 || data.roster.length > 0);

  homeScreen.onGo = (where) => {
    switch (where) {
      case 'dig': void startRun(data.unlockedBiomes[0] ?? 'canyon'); break;
      case 'clean': {
        const s = data.stock.shift();
        if (!s) { ui.toast('精錬できる化石がない', 'warn'); return; }
        writeSave(data);
        void startClean(s.defId, s.rarity);
        break;
      }
      case 'battle': void startBattle(); break;
      case 'party': partyScreen.setData(data); ui.show('party'); break;
      case 'dex': dexScreen.setData(data); ui.show('dex'); break;
      case 'title': ui.show('title'); break;
    }
  };

  digScreen.setSave(data);
  digScreen.onCollectFossil = (n) => {
    if (n.kind === 'fossil') runFossils.push({ defId: n.speciesId, rarity: n.rarity });
    else data.player.coins += 40 + n.rarity * 20;
  };
  digScreen.onExit = () => {
    audio.uiBack();
    dig.setMode('explore');
    // 途中で抜けても拾ったものは失わせない
    if (runFossils.length > 0) { digScreen.onFinish?.(); return; }
    goHome();
  };
  digScreen.onFinish = () => {
    data.stats.runs++;
    data.daily.runs++;
    if (runFossils.length === 0) {
      writeSave(data);
      ui.toast('収穫なし', 'warn');
      setTimeout(goHome, 1000);
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
    const { isNew, unit } = addFossil(data, defId, score.clean);
    data.stats.fossils++;
    writeSave(data);
    showResult({
      title: '精錬完了',
      subtitle: `${label(defId)} の化石`,
      good: score.rank !== 'D',
      rows: [
        { label: 'ランク', value: score.rank, kind: 'rank' },
        { label: 'クリーン度', value: `${score.clean}`, kind: 'exp' },
        { label: '岩の除去', value: `${Math.round(score.rockRatio * 100)}%` },
        { label: '骨の損傷', value: score.boneDamage > 0 ? `-${score.boneDamage.toFixed(1)}` : 'なし' },
        ...(score.rank === 'S' ? [{ label: '解放', value: 'スキルスロット3枠目', kind: 'new' as const }] : []),
        isNew
          ? { label: '新種を入手', value: label(defId), kind: 'new' as const }
          : { label: `${label(defId)}（所持済み）`, value: `スキルLv ${unit.skillLevel}`, kind: 'new' as const },
        ...(data.stock.length > 0
          ? [{ label: '未精錬のストック', value: `${data.stock.length} 個` }]
          : []),
      ],
    });
  };

  battleScreen.onFinish = (winner) => {
    data.stats.battles++;
    const rows: ResultData['rows'] = [];
    if (winner === 0) {
      data.stats.wins++;
      data.stageProgress++;
      const coins = 120 + data.stageProgress * 40;
      data.player.coins += coins;
      rows.push({ label: '報酬', value: `◈ ${coins}`, kind: 'coin' });

      const setup = buildTeamSetup(data.roster, data.party.order, data.party.formation);
      const maxLv = Math.max(...data.roster.map((r) => r.level), 1);
      setup?.members.forEach((m, i) => {
        const unit = data.roster.find((r) => r.uid === m.uid);
        if (!unit) return;
        // 前列に厚く配る。未育成にはキャッチアップ補正をかけないと
        // 「最初に育てた3体しか使えない」状態に固定される
        const share = i === 0 ? 0.5 : 0.25;
        const catchUp = unit.level < maxLv - 2 ? 2.0 : 1;
        const gain = Math.round(1800 * share * catchUp);
        const { leveled } = addExp(unit, gain);
        rows.push({
          label: label(unit.defId),
          value: leveled > 0 ? `+${gain} EXP → Lv${unit.level}` : `+${gain} EXP`,
          kind: 'exp',
        });
      });
      rows.push({ label: '進行度', value: `ステージ ${data.stageProgress}` });
    } else {
      rows.push({ label: '結果', value: winner === 1 ? '敗北' : '引き分け' });
      rows.push({ label: '助言', value: '編成と陣形を見直そう' });
    }
    writeSave(data);
    showResult({
      title: winner === 0 ? 'VICTORY' : winner === 1 ? 'DEFEAT' : 'DRAW',
      subtitle: `${player?.sim.turnCount ?? 0} 行動`,
      good: winner === 0,
      rows,
    });
  };

  partyScreen.onBack = () => goHome();
  partyScreen.onApply = (order, formation) => {
    data.party.order = order;
    data.party.formation = formation;
    writeSave(data);
    ui.toast('編成を保存した', 'info', 1600);
    goHome();
  };

  dexScreen.onBack = () => goHome();

  resultScreen.onNext = () => goHome();
  resultScreen.onAgain = () => {
    const t = pendingResult?.title ?? '';
    if (t === '精錬完了') {
      const s = data.stock.shift();
      if (s) { writeSave(data); void startClean(s.defId, s.rarity); return; }
      void startBattle();
    } else {
      void startBattle();
    }
  };

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
  if (jump) {
    grantStarters(data);
    if (jump === 'clean') void startClean('yutyrannus', 2);
    else if (jump === 'battle') void startBattle();
    else if (jump === 'home') goHome();
    else if (jump === 'party') { partyScreen.setData(data); ui.show('party'); }
    else if (jump === 'dex') { dexScreen.setData(data); ui.show('dex'); }
    else if (jump === 'dig') void startRun('canyon');
  }

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
      dig.resize(a);
      battle.resize(a);
      clean.resize(a);
      home.resize(a);
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
    else {
      const s = ui.currentName;
      audio.startMusic(s === 'battle' ? 'battle' : s === 'dig' ? 'dig' : 'calm');
    }
  });

  // ブラウザの戻る／Androidのバックジェスチャをゲーム内の戻るとして受ける
  history.pushState({ guard: true }, '');
  addEventListener('popstate', () => {
    history.pushState({ guard: true }, '');
    const s = ui.currentName;
    if (s === 'home' || s === 'title') return;
    if (s === 'dig') { dig.setMode('explore'); goHome(); }
    else if (s === 'battle') return; // 戦闘中は抜けさせない
    else goHome();
  });

  const debug = document.createElement('div');
  debug.className = 'debug-hud';
  uiEl.appendChild(debug);
  const showDebug = new URLSearchParams(location.search).has('debug');
  if (showDebug) {
    (window as unknown as { __game: unknown }).__game = { dig, clean, battle, home, ui, get data() { return data; } };
  }
  debug.hidden = !showDebug;
  let debugTimer = 0;

  // ---------------------------------------------------------------- ループ

  let last = performance.now();
  const loop = (now: number): void => {
    requestAnimationFrame(loop);
    // 低電力モードの30fps固定やタブ復帰の巨大デルタに耐える
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    if (paused) return;

    input.beginFrame();
    switch (ui.currentName) {
      case 'dig':
        // 持ち物を開いている間はフィールド操作を止める。
        // 3D は動かし続けるので、自分がどこに立っているかは見えたまま
        digScreen.pollInventoryKey(input.justPressed('inventory'));
        dig.update(dt, input, !digScreen.inventoryOpen);
        if (dig.consumeShadowDirty()) renderer.invalidateShadows();
        break;
      case 'battle':
        player?.update(dt);
        battle.update(dt);
        break;
      case 'clean':
        // 更新は CleanScreen.update から駆動する（入力と時間が結び付くため）
        break;
      case 'home':
      case 'party':
      case 'dex':
      case 'result':
        home.update(dt);
        break;
      default:
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
          `css ${cv.clientWidth}x${cv.clientHeight} buf ${cv.width}x${cv.height}`;
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
