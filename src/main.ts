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
import { buildTeamSetup, buildEnemyTeam, grantStarters, addFossil, mergeFossil, teamAnchor, stagePreview } from './game/party';
import { rollEngraving, engraveName, engraveText } from './game/engraving';
import { Rng } from './voxel/VoxelPainter';
import { advanceHoloTime } from './fx/SpriteUnit';
import { buildEventTeam, type EventDef } from './game/data/events';
import { BattleSelectScreen, stageCoins } from './ui/screens/BattleSelectScreen';
import { MailScreen } from './ui/screens/MailScreen';
import { DigSelectScreen } from './ui/screens/DigSelectScreen';
import { MissionScreen } from './ui/screens/MissionScreen';
import { NewsScreen } from './ui/screens/NewsScreen';
import { ShopScreen } from './ui/screens/ShopScreen';
import { UnitScreen } from './ui/screens/UnitScreen';
import { RosterScreen } from './ui/screens/RosterScreen';
import { TransferScreen } from './ui/screens/TransferScreen';
import { SettingsScreen } from './ui/screens/SettingsScreen';
import { CleanChoiceScreen } from './ui/screens/CleanChoiceScreen';
import { grantLogin, grantStaffMail } from './game/mail';
import { DebugScreen } from './ui/screens/DebugScreen';
import { StockScreen } from './ui/screens/StockScreen';
import { ProfileScreen } from './ui/screens/ProfileScreen';
import { DetailScreen } from './ui/screens/DetailScreen';
import { REVOS } from './game/data/revos';
import { audio } from './core/Audio';
import {
  load as loadSave, save as writeSave, defaultSave, dropDecay, addExp, addPlayerExp,
  countToday, rollDaily, clearSave,
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

  /**
   * 画質。
   *
   * 保存には入っていたのに、どこからも読んでいなかった——保存されているのに
   * 変えられない値は、無いのと同じ。おまかせなら端末の判定に任せ、
   * 自分で選んだときだけその段に固定する。
   *
   * 場面を組む前に通す。粒子の上限は場面の構築時に焼き込まれるので、
   * 後から変えたぶんは描画の経路にだけ効き、粒の量は次の起動から。
   */
  const applyQuality = (): void => {
    if (data.settings.quality !== 'auto') renderer.setQuality(data.settings.quality);
  };
  applyQuality();

  await progress(0.34, '拠点を組み立てています…');
  const home = new HomeScene(renderer.quality);
  const dig = new DigScene(renderer.quality);
  const clean = new CleanScene(renderer.quality);
  const battle = new BattleScene(renderer.quality);
  battle.reducedShake = data.settings.reducedShake;

  let player: BattlePlayer | null = null;
  let runFossils: { defId: string; rarity: number }[] = [];
  /** 挑戦中のイベント。通常バトルなら null */
  let activeEvent: EventDef | null = null;
  /** 直前に挑んだイベント。リザルトの「もう一度」で同じ相手へ戻す */
  let lastEvent: EventDef | null = null;
  /**
   * 挑戦中の段。通常戦でどの段を選んだかは進行度と一致しない——
   * 到達済みの段へ戻れるようにしたので、勝っても進めない戦いがある
   */
  let activeStage = 1;
  let lastStage = 1;
  /** 直前の周回の成果。リザルトで見せる */
  let pendingResult: ResultData | null = null;

  // イベント専用の個体は地層に埋まっていない。発掘の抽選から外す
  const speciesPool = REVOS.filter((r) => !r.eventOnly).map((r) => ({
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
  const selectScreen = new BattleSelectScreen();
  const mailScreen = new MailScreen();
  const digSelectScreen = new DigSelectScreen();
  const missionScreen = new MissionScreen();
  const newsScreen = new NewsScreen();
  const shopScreen = new ShopScreen();
  const unitScreen = new UnitScreen();
  const rosterScreen = new RosterScreen();
  const transferScreen = new TransferScreen();
  const settingsScreen = new SettingsScreen();
  const cleanChoiceScreen = new CleanChoiceScreen();
  const debugScreen = new DebugScreen();
  const stockScreen = new StockScreen();
  const profileScreen = new ProfileScreen();
  const resultScreen = new ResultScreen();
  const detailScreen = new DetailScreen();
  for (const s of [title, homeScreen, digScreen, cleanScreen, battleScreen, partyScreen, dexScreen, selectScreen, mailScreen, digSelectScreen, missionScreen, newsScreen, shopScreen, unitScreen, rosterScreen, transferScreen, settingsScreen, cleanChoiceScreen, stockScreen, profileScreen, debugScreen, detailScreen, resultScreen]) {
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

  /**
   * 受信箱への配布。
   *
   * 起動時だけでなく拠点へ戻るたびに確かめる——開きっぱなしで日を
   * またいだときに、次の起動まで届かないのは事故に見える。
   */
  function deliverMail(announce: boolean): void {
    // 運営ぶんを先に積んでからログインを積む。どちらも先頭へ差し込むので、
    // この順なら「今日のぶん」が受信箱の一番上に来る
    const gotStaff = grantStaffMail(data);
    const gotLogin = grantLogin(data);
    if (gotLogin || gotStaff > 0) {
      writeSave(data);
      if (announce) {
        ui.toast(gotLogin ? `ログインボーナスが届いた（${data.login.streak} 日目）` : '運営から便りが届いた', 'info', 3000);
      }
    }
  }

  function goHome(): void {
    // 開きっぱなしで 4 時を越えることがある。起動時にしか見ていないと、
    // 日課が前日のまま止まったまま遊び続けることになる
    if (rollDaily(data)) writeSave(data);
    deliverMail(true);
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
    /*
     * 潜行した回数は、降りた時点で数える。
     *
     * 以前は「持ち帰ったとき」に数えていたので、掘ったのに何も出なかった
     * 周回が記録から丸ごと消えていた。プロフィールに出す以上、空振りも
     * 潜行のうち。一方 daily.runs はドロップ逓減の基準なので、
     * こちらは成果のある周回に紐づけたまま動かさない。
     */
    data.stats.runs++;
    data.stats.biomeRuns[biome] = (data.stats.biomeRuns[biome] ?? 0) + 1;
    countToday(data, 'dig');
    // 降りた時点で書く。周回の終わりまで待つと、途中で閉じたぶんが
    // 記録からも日課からも消える——降りた事実は成果と別に残す
    writeSave(data);
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

  async function startBattle(ev: EventDef | null = null, stage = data.stageProgress + 1): Promise<void> {
    const mine = buildTeamSetup(data.roster, data.party.order, data.party.formation, data.party.targetPrefs);
    if (!mine) { ui.toast('編成できるリヴォスがいない', 'bad'); goHome(); return; }
    activeEvent = ev;
    lastEvent = ev;
    activeStage = Math.max(1, stage);
    lastStage = activeStage;
    boot.classList.remove('hidden');
    await progress(0.4, ev ? '記録を読み出しています…' : '闘技場を生成しています…');
    const seed = (Date.now() ^ (activeStage * 104729)) >>> 0;
    // 段ごとに舞台を変える。選択画面が予告した地層と実際の闘技場を一致させる
    battle.buildArena(ev ? ev.biome : stagePreview(activeStage).biome, seed);
    const foes = ev ? buildEventTeam(ev) : buildEnemyTeam(activeStage, seed, teamAnchor(mine));
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
  // タイトルからも同じ設定の面へ。押すたびに左右が入れ替わるだけの
  // ボタンだったので、何が変わったかはトーストでしか分からなかった
  title.onSettings = () => goSettings();
  title.setHasSave(data.stats.runs > 0 || data.roster.length > 0);

  homeScreen.onGo = (where) => {
    switch (where) {
      // 掘るのと削るのはひと続きの作業。同じ面で選ばせる
      case 'dig': digSelectScreen.setData(data); ui.show('digSelect'); break;
      case 'clean': stockScreen.setData(data); ui.show('stock'); break;
      case 'mission': missionScreen.setData(data); ui.show('mission'); break;
      case 'news': newsScreen.setData(data); ui.show('news'); break;
      case 'shop': shopScreen.setData(data); ui.show('shop'); break;
      case 'battle':
        selectScreen.setData(data);
        // 明示して開く。前に見ていた側が残ると、タブの名前と中身がずれる
        ui.show('battleSelect', { mode: 'normal' });
        break;
      case 'event':
        selectScreen.setData(data);
        ui.show('battleSelect', { mode: 'event' });
        break;
      case 'mail': mailScreen.setData(data); ui.show('mail'); break;
      case 'unit': goUnit(); break;
      case 'settings': goSettings(); break;
      case 'profile': profileBack = goHome; profileScreen.setData(data); ui.show('profile'); break;
    }
  };

  /** ユニットの入口。手持ちに関わる面はすべてここから枝分かれする */
  function goUnit(): void { unitScreen.setData(data); ui.show('unit'); }
  function goSettings(): void { settingsScreen.setData(data); ui.show('settings'); }

  /** 下タブはどの根の画面からも同じ場所へ飛ぶ。画面ごとに行き先を変えない */
  const tabGo = (where: 'home' | 'dig' | 'battle' | 'unit' | 'settings'): void => {
    if (where === 'home') { goHome(); return; }
    if (where === 'dig') { digSelectScreen.setData(data); ui.show('digSelect'); return; }
    if (where === 'battle') { selectScreen.setData(data); ui.show('battleSelect', { mode: 'normal' }); return; }
    if (where === 'unit') { goUnit(); return; }
    goSettings();
  };
  unitScreen.onTab = tabGo;
  settingsScreen.onTab = tabGo;

  unitScreen.onGo = (where) => {
    switch (where) {
      case 'roster': rosterScreen.setData(data); ui.show('roster'); break;
      case 'party': partyScreen.setData(data); ui.show('party'); break;
      case 'dex': dexScreen.setData(data); ui.show('dex'); break;
      case 'transfer': transferScreen.setData(data); ui.show('transfer'); break;
    }
  };

  rosterScreen.onBack = () => goUnit();
  rosterScreen.onPrefChange = () => writeSave(data);
  rosterScreen.onDetail = (defId, unit) => {
    ui.show('detail', {
      defId,
      unit,
      owned: data.roster.filter((u) => u.defId === defId),
      back: () => { rosterScreen.setData(data); ui.show('roster'); },
    });
  };

  transferScreen.onBack = () => goUnit();
  transferScreen.onDone = () => {
    writeSave(data);
    homeScreen.setData(data);
    unitScreen.setData(data);
    partyScreen.setData(data);
  };

  settingsScreen.onChange = (key) => {
    const s = data.settings;
    if (key === 'hand') applyHand();
    else if (key === 'audio') audio.setVolumes(s.sfx, s.bgm);
    else if (key === 'quality') applyQuality();
    else if (key === 'shake') battle.reducedShake = s.reducedShake;
    else if (key === 'battle' && player) player.speed = s.battleSpeed;
    writeSave(data);
  };
  settingsScreen.onGo = (where) => {
    if (where === 'profile') { profileBack = goSettings; profileScreen.setData(data); ui.show('profile'); return; }
    if (where === 'title') { ui.show('title'); return; }
    if (where === 'debug') { openDebug(); return; }
    void wipeSave();
  };

  /**
   * セーブの消去。
   *
   * 取り返しがつかないので、確認は一度だけ、文面で何が消えるかを書く。
   * 消したあとはタイトルへ戻す——消えた手持ちを拠点で見せても仕方がない。
   */
  async function wipeSave(): Promise<void> {
    const ok = await ui.confirm(
      'セーブを消す',
      '手持ち・図鑑・記録・コインがすべて消える。元には戻せない。',
      '消す', true,
    );
    if (!ok) return;
    clearSave();
    data = defaultSave();
    writeSave(data);
    // 起動時に1度だけ渡している画面は、差し替えた保存を自分では知らない
    digScreen.setSave(data);
    applyHand();
    applyQuality();
    battle.reducedShake = data.settings.reducedShake;
    title.setHasSave(false);
    ui.toast('セーブを消した', 'warn', 2600);
    ui.show('title');
  }

  // 詳細は1枚の画面。どこから開いたかを覚えて、閉じたらそこへ戻す
  dexScreen.onDetail = (defId) => {
    const mine = data.roster.filter((u) => u.defId === defId);
    ui.show('detail', {
      defId,
      owned: mine,
      back: () => { dexScreen.setData(data); ui.show('dex'); },
      // 持っていない個体を編成へ送っても置けない。導線ごと出さない
      onEquip: mine.length > 0 ? () => { partyScreen.setData(data); ui.show('party'); } : undefined,
    });
  };
  dexScreen.onPrefChange = () => writeSave(data);
  partyScreen.onDetail = (defId, unit) => {
    ui.show('detail', {
      defId,
      unit,
      owned: data.roster.filter((u) => u.defId === defId),
      back: () => { partyScreen.setData(data); ui.show('party'); },
    });
  };

  digScreen.setSave(data);
  // 崩した量は記録だけ。保存は周回の終わりにまとめて走るので、ここでは書かない
  dig.events.onDig = (_slot, _pos, removed) => { data.stats.voxelsDug += removed; };
  digScreen.onCollectFossil = (n) => {
    if (n.kind === 'fossil') {
      runFossils.push({ defId: n.speciesId, rarity: n.rarity });
      data.stats.found++;
      data.stats.bestRarity = Math.max(data.stats.bestRarity, n.rarity);
    } else data.player.coins += 40 + n.rarity * 20;
  };
  digScreen.onExit = () => {
    audio.uiBack();
    dig.setMode('explore');
    // 途中で抜けても拾ったものは失わせない
    if (runFossils.length > 0) { digScreen.onFinish?.(); return; }
    // 手ぶらで戻る場合も、崩した量は書いておく。ここを書かずに帰ると、
    // 掘っただけで何も見つからなかった時間が記録から丸ごと消える
    writeSave(data);
    goHome();
  };
  digScreen.onFinish = () => {
    data.daily.runs++;
    addPlayerExp(data, 40 + runFossils.length * 20);
    if (runFossils.length === 0) {
      writeSave(data);
      ui.toast('収穫なし', 'warn');
      setTimeout(goHome, 1000);
      return;
    }
    // 持ち帰ったぶんはすべてストックへ。どれから削るかは一覧で選ぶ
    for (const f of runFossils) {
      data.stock.push({ defId: f.defId, rarity: f.rarity, biome: data.unlockedBiomes[0] ?? 'canyon' });
    }
    writeSave(data);
    stockScreen.setData(data);
    ui.show('stock');
  };

  /**
   * 精錬の後始末。
   *
   * 同じ種をすでに持っているなら、重ねるか別個体として迎えるかを選ばせる。
   * 黙って吸わせると、クリーン度 96 の2体目を削り上げても手元に残るのは
   * 数字が1つ動いた1体だけで、削った時間の行き先が見えない。
   */
  cleanScreen.onFinish = (score, defId) => {
    data.stats.fossils++;
    data.stats.bestClean = Math.max(data.stats.bestClean, score.clean);
    if (score.rank === 'S') data.stats.sRanks++;
    countToday(data, 'clean');
    addPlayerExp(data, 60 + Math.round(score.clean * 0.6));

    // 刻印は削り上げたこの瞬間に決まる。出るかどうかも等級もクリーン度次第
    const engraving = rollEngraving(score.clean, new Rng((Date.now() ^ (score.clean * 2654435761)) >>> 0));
    const owned = data.roster.filter((r) => r.defId === defId);

    const finish = (isNew: boolean, note: { label: string; value: string }): void => {
      writeSave(data);
      showResult({
        title: '精錬完了',
        subtitle: `${label(defId)} の化石`,
        good: score.rank !== 'D',
        rows: [
          { label: 'ランク', value: score.rank, kind: 'rank' },
          { label: 'クリーン度', value: `${score.clean}`, kind: 'exp' },
          { label: '岩の除去', value: `${Math.round(score.rockRatio * 100)}%` },
          // 損傷は点を引かず上限を下げる。引かれた点ではなく、届かなくなった天井を出す
          { label: '骨の損傷', value: score.boneDamage > 0 ? `上限 ${score.cap}` : 'なし' },
          ...(engraving
            ? [{ label: engraveName(engraving), value: engraveText(engraving), kind: 'new' as const }]
            : []),
          isNew
            ? { label: '新種を入手', value: label(defId), kind: 'new' as const }
            : { ...note, kind: 'new' as const },
          ...(data.stock.length > 0
            ? [{ label: '未精錬のストック', value: `${data.stock.length} 個` }]
            : []),
        ],
      });
    };

    if (owned.length === 0) {
      const { isNew } = addFossil(data, defId, score.clean, engraving ?? undefined);
      finish(isNew, { label: label(defId), value: '加入' });
      return;
    }

    ui.show('cleanChoice', {
      defId,
      clean: score.clean,
      engraving: engraving ?? undefined,
      owned,
      onMerge: (targetUid: string, takeEngraving: boolean) => {
        const u = mergeFossil(data, targetUid, score.clean, engraving ?? undefined, takeEngraving);
        finish(false, {
          label: `${label(defId)} に重ねた`,
          value: `技Lv ${u?.skillLevel ?? 1} · クリーン度 ${u?.clean ?? score.clean}`,
        });
      },
      onKeep: () => {
        addFossil(data, defId, score.clean, engraving ?? undefined);
        finish(false, {
          label: `${label(defId)} を迎えた`,
          value: `${data.roster.filter((r) => r.defId === defId).length} 体目`,
        });
      },
    });
  };

  battleScreen.onFinish = (winner) => {
    data.stats.battles++;
    if (player) {
      const t = player.tally;
      data.stats.damage += t.damage;
      data.stats.bestHit = Math.max(data.stats.bestHit, t.bestHit);
      data.stats.kos += t.kos;
      data.stats.odFired += t.odFired;
      countToday(data, 'od', t.odFired);
    }
    countToday(data, 'battle');
    // 出撃回数。誰を連れて行きがちかは、勝敗と別に残しておく
    for (const uid of buildTeamSetup(data.roster, data.party.order, data.party.formation)?.members.map((m) => m.defId) ?? []) {
      data.stats.sorties[uid] = (data.stats.sorties[uid] ?? 0) + 1;
    }
    const ev = activeEvent;
    activeEvent = null;
    const rows: ResultData['rows'] = [];
    if (winner === 0) {
      data.stats.wins++;
      data.stats.streak++;
      countToday(data, 'win');
      data.stats.bestStreak = Math.max(data.stats.bestStreak, data.stats.streak);
      const turns = player?.sim.turnCount ?? 0;
      // 0 は「未達成」。初回は無条件に入れないと、いつまでも 0 のまま
      if (turns > 0 && (data.stats.fastestWin === 0 || turns < data.stats.fastestWin)) {
        data.stats.fastestWin = turns;
      }
      let coins: number;
      if (ev) {
        // イベントは進行度を進めない。編成を試す場としていつでも戻れるようにする
        const first = !data.events.cleared.includes(ev.id);
        coins = first ? ev.coins : Math.round(ev.coins / 4);
        if (first) {
          data.events.cleared.push(ev.id);
          const { isNew, unit } = addFossil(data, ev.reward.defId, ev.reward.clean);
          if (isNew) {
            // 加入レベルのほうが高いことがある。報酬で下げない
            unit.level = Math.max(unit.level, ev.reward.level);
            rows.push({ label: '記録を確保', value: `${label(ev.reward.defId)} Lv${unit.level}`, kind: 'new' });
          } else {
            rows.push({ label: '記録を確保', value: `${label(ev.reward.defId)} スキルLv ${unit.skillLevel}`, kind: 'new' });
          }
        }
      } else {
        // 到達済みの段へ戻れるようにしたので、勝っても進むとは限らない。
        // 進むのは未踏の段（＝いまの進行度の1つ先）を抜いたときだけ
        const advanced = activeStage > data.stageProgress;
        if (advanced) data.stageProgress = activeStage;
        coins = stageCoins(activeStage, !advanced);
        if (!advanced) rows.push({ label: '再挑戦', value: `ステージ ${activeStage}` });
      }
      data.player.coins += coins;
      rows.push({ label: '報酬', value: `◈ ${coins}`, kind: 'coin' });
    } else {
      data.stats.streak = 0;
      rows.push({ label: '結果', value: winner === 1 ? '敗北' : '引き分け' });
      rows.push({ label: '助言', value: '編成と陣形を見直そう' });
    }
    addPlayerExp(data, winner === 0 ? 120 : 40);

    /*
     * EXP は勝敗に関わらず入る。
     *
     * 以前は勝ったときだけだった。負けた編成は何も得ないまま同じ相手に
     * 挑み続けることになり、一度差が開くと二度と埋まらない——「勝てない
     * から育たない、育たないから勝てない」で詰む。負けでも通常の4割弱を
     * 渡す。3回負ければ1つぶん近づく、という程度には動く。
     *
     * 配分も前列0.5/後列0.25をやめた。同じ戦いに出た3体なので同額。
     * 半分しか入らない後列は、いつまでも前列の半分のレベルで固定され、
     * 編成を組み替えた瞬間に壊れる。
     */
    const setup = buildTeamSetup(data.roster, data.party.order, data.party.formation, data.party.targetPrefs);
    const maxLv = Math.max(...data.roster.map((r) => r.level), 1);
    const base = winner === 0 ? 900 : 340;
    setup?.members.forEach((m) => {
      const unit = data.roster.find((r) => r.uid === m.uid);
      if (!unit) return;
      // 未育成にはキャッチアップ補正をかけないと
      // 「最初に育てた3体しか使えない」状態に固定される
      const catchUp = unit.level < maxLv - 2 ? 2.0 : 1;
      const gain = Math.round(base * catchUp);
      const { leveled } = addExp(unit, gain);
      rows.push({
        label: label(unit.defId),
        value: leveled > 0 ? `+${gain} EXP → Lv${unit.level}` : `+${gain} EXP`,
        kind: 'exp',
      });
    });
    if (winner === 0 && !ev) rows.push({ label: '進行度', value: `ステージ ${data.stageProgress}` });
    writeSave(data);
    showResult({
      eyebrow: '戦闘終了',
      title: winner === 0 ? '勝 利' : winner === 1 ? '敗 北' : '引 き 分 け',
      subtitle: ev
        ? `${ev.name} — ${player?.sim.turnCount ?? 0} 手で決着`
        : `ステージ ${activeStage} — ${player?.sim.turnCount ?? 0} 手で決着`,
      good: winner === 0,
      cast: setup?.members.map((m) => m.defId) ?? [],
      rows,
    });
  };

  // 記録は拠点の丸列と設定の両方から開く。閉じたら開いた場所へ返す
  let profileBack: () => void = goHome;
  profileScreen.onBack = () => profileBack();
  // 精錬の一覧から戻る先は発掘の面。拠点まで戻すと、
  // もう1つ削りに行くのに毎回タブを踏み直すことになる
  stockScreen.onBack = () => { digSelectScreen.setData(data); ui.show('digSelect'); };
  stockScreen.onClean = (entry) => {
    const [s] = data.stock.splice(entry.index, 1);
    if (!s) { ui.toast('その化石はもう無い', 'warn'); stockScreen.setData(data); return; }
    writeSave(data);
    void startClean(s.defId, s.rarity);
  };

  digSelectScreen.onBack = () => goHome();
  digSelectScreen.onGo = (biome) => { void startRun(biome); };
  digSelectScreen.onClean = () => { stockScreen.setData(data); ui.show('stock'); };

  missionScreen.onBack = () => goHome();
  missionScreen.onClaim = () => { writeSave(data); homeScreen.setData(data); };

  newsScreen.onBack = () => goHome();
  newsScreen.onRead = () => { writeSave(data); homeScreen.setData(data); };

  shopScreen.onBack = () => goHome();
  shopScreen.onBuy = () => { writeSave(data); homeScreen.setData(data); };

  mailScreen.onBack = () => goHome();
  mailScreen.onClaim = () => {
    writeSave(data);
    homeScreen.setData(data);
  };

  selectScreen.onBack = () => goHome();
  selectScreen.onNormal = (stage) => { void startBattle(null, stage); };
  selectScreen.onEvent = (ev) => { void startBattle(ev); };

  /**
   * デバッグモードを開く。
   *
   * 開いた事実を保存して、以後は拠点のタイルからも行けるようにする。
   * 長押しを毎回やり直させると、結局さわらなくなる。
   */
  function openDebug(): void {
    if (data.settings.debug !== true) {
      data.settings.debug = true;
      writeSave(data);
      ui.toast('デバッグモードを開いた', 'warn');
    }
    debugScreen.setData(data);
    ui.show('debug');
  }

  title.onDebug = () => openDebug();
  debugScreen.onBack = () => goHome();
  // 触った結果は即保存する。検証中にリロードして消えるのがいちばん困る
  debugScreen.onChanged = () => writeSave(data);

  partyScreen.onBack = () => goUnit();
  partyScreen.onApply = (order, formation, prefs) => {
    data.party.order = order;
    data.party.formation = formation;
    data.party.targetPrefs = prefs;
    writeSave(data);
    ui.toast('編成を保存した', 'info', 1600);
    goUnit();
  };

  dexScreen.onBack = () => goUnit();

  resultScreen.onNext = () => goHome();
  resultScreen.onAgain = () => {
    const t = pendingResult?.title ?? '';
    if (t === '精錬完了') {
      if (data.stock.length > 0) { stockScreen.setData(data); ui.show('stock'); return; }
      void startBattle();
    } else {
      void startBattle(lastEvent, lastStage);
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
    else if (jump === 'event') { selectScreen.setData(data); ui.show('battleSelect', { mode: 'event' }); }
    else if (jump === 'select') { selectScreen.setData(data); ui.show('battleSelect'); }
    else if (jump === 'mail') { deliverMail(false); mailScreen.setData(data); ui.show('mail'); }
    else if (jump === 'digSelect') { digSelectScreen.setData(data); ui.show('digSelect'); }
    else if (jump === 'mission') { missionScreen.setData(data); ui.show('mission'); }
    else if (jump === 'news') { newsScreen.setData(data); ui.show('news'); }
    else if (jump === 'shop') { shopScreen.setData(data); ui.show('shop'); }
    else if (jump === 'unit') goUnit();
    else if (jump === 'settings') goSettings();
    else if (jump === 'roster') { rosterScreen.setData(data); ui.show('roster'); }
    else if (jump === 'transfer') { transferScreen.setData(data); ui.show('transfer'); }
    else if (jump === 'cleanChoice') {
      // 削り上げた直後の状態を、精錬を回さずに作る。刻印は本番と同じ抽選を通す
      cleanScreen.onFinish?.(
        { clean: 88, rank: 'A', rockRatio: 0.94, timeRatio: 0.42, boneDamage: 1, cap: 97 },
        'yutyrannus',
      );
    }
    else if (jump === 'stock') { stockScreen.setData(data); ui.show('stock'); }
    else if (jump === 'profile') { profileScreen.setData(data); ui.show('profile'); }
    else if (jump === 'debug') openDebug();
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

    // プレイ時間。タブを離れている間は paused で止まるので、
    // 「開きっぱなし」ではなく実際に見ていた時間になる
    data.stats.playSeconds += dt;

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
    // ホロ表現の時間はシーンに属さない。どの画面でも同じ速さで流す
    advanceHoloTime(dt);
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
