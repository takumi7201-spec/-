/**
 * バランス検証。描画を持たないシミュレータを大量に回して、
 * ユニットごとの勝率・戦闘の長さ・イベント密度が設計値に収まるか見る。
 *   npm run balance
 */
import { BattleSim } from '../src/game/battle/simulate.ts';
import { REVOS } from '../src/game/data/revos.ts';
import type { TeamSetup, BattleEvent } from '../src/game/battle/types.ts';

/** 1チームの数。編成の枠と揃える */
const TEAM = 5;

function mkTeam(ids: string[], level: number, clean: number, tag: string): TeamSetup {
  return {
    members: ids.map((id, i) => ({ uid: `${tag}${i}`, defId: id, level, clean, skillLevel: 1 })),
    order: ids.map((_, i) => i),
  };
}

/**
 * 線形合同法の下位ビットは周期が極端に短い（下位2ビットは周期4）。
 * `% n` で取り出すと n が 4 の倍数を含むときに標本が強く偏り、
 * ロスター数を 12→14 に変えただけで勝率が10pt単位で動いてしまう。
 * 上位ビットから取り出すこと。
 */
function rngInt(s: { v: number }, n: number): number {
  s.v = (s.v * 1664525 + 1013904223) >>> 0;
  return Math.floor((s.v / 0x100000000) * n);
}

const N = Number(process.argv[2] ?? 20000);
const wins = new Map<string, number>();
const plays = new Map<string, number>();
const kills = new Map<string, number>();
const dmg = new Map<string, number>();
const healed = new Map<string, number>();
for (const r of REVOS) { wins.set(r.id, 0); plays.set(r.id, 0); kills.set(r.id, 0); dmg.set(r.id, 0); healed.set(r.id, 0); }

let totalTurns = 0;
let totalSec = 0;
const secHist: number[] = [];
let draws = 0;
let firstWins = 0;
const turnHist: number[] = [];
let odFires = 0;
let kos = 0;
let crits = 0;
let damageEvents = 0;

const s = { v: 12345 };

for (let i = 0; i < N; i++) {
  const pickTeam = (): string[] => {
    const set = new Set<number>();
    while (set.size < TEAM) set.add(rngInt(s, REVOS.length));
    return [...set].map((k) => REVOS[k].id);
  };
  const a = pickTeam();
  const b = pickTeam();
  const sim = new BattleSim(i * 7919 + 13, mkTeam(a, 10, 60, 'a'), mkTeam(b, 10, 60, 'b'));
  const events: BattleEvent[] = sim.runToEnd();
  const res = sim.result();

  for (const id of a) plays.set(id, plays.get(id)! + 1);
  for (const id of b) plays.set(id, plays.get(id)! + 1);
  if (res.winner === 0) { for (const id of a) wins.set(id, wins.get(id)! + 1); firstWins++; }
  else if (res.winner === 1) { for (const id of b) wins.set(id, wins.get(id)! + 1); }
  else draws++;

  for (const f of res.fighters) {
    kills.set(f.defId, kills.get(f.defId)! + f.kills);
    dmg.set(f.defId, dmg.get(f.defId)! + f.dealt);
    healed.set(f.defId, healed.get(f.defId)! + f.healed);
  }

  totalTurns += res.turns;
  turnHist.push(res.turns);
  totalSec += res.seconds;
  secHist.push(res.seconds);
  for (const e of events) {
    if (e.t === 'action' && e.kind === 'od') odFires++;
    else if (e.t === 'ko') kos++;
    else if (e.t === 'damage') { damageEvents++; if (e.crit) crits++; }
  }
}

turnHist.sort((x, y) => x - y);
const p = (q: number) => turnHist[Math.floor(turnHist.length * q)];

secHist.sort((x, y) => x - y);
const q = (k: number) => secHist[Math.floor(secHist.length * k)].toFixed(1);
console.log(`\n=== ${N} 戦 / Lv10 / クリーン度60 / ランダム${TEAM}体 ===\n`);
console.log(`平均の長さ       : ${(totalSec / N).toFixed(1)} 秒  (中央値 ${q(0.5)}, p10 ${q(0.1)}, p90 ${q(0.9)}, max ${secHist[secHist.length - 1].toFixed(1)})`);
console.log(`平均行動数       : ${(totalTurns / N).toFixed(1)}  (中央値 ${p(0.5)}, p10 ${p(0.1)}, p90 ${p(0.9)}, max ${turnHist[turnHist.length - 1]})`);
console.log(`引き分け率       : ${((draws / N) * 100).toFixed(2)}%`);
console.log(`先攻側勝率       : ${((firstWins / (N - draws)) * 100).toFixed(1)}%   (50%から離れるほど編成以外の偏りがある)`);
console.log(`1戦あたりOD発動  : ${(odFires / N).toFixed(2)} 回`);
console.log(`1戦あたり撃破    : ${(kos / N).toFixed(2)} 体`);
console.log(`クリティカル率   : ${((crits / damageEvents) * 100).toFixed(1)}%`);
console.log(`\n--- ユニット別 (勝率順) ---`);
console.log('  ' + 'ユニット'.padEnd(16) + '属性  ロール'.padEnd(20) + '勝率     撃破/戦   与ダメ/戦  回復/戦');

const rows = REVOS.map((r) => ({
  r,
  wr: wins.get(r.id)! / Math.max(1, plays.get(r.id)!),
  kpb: kills.get(r.id)! / Math.max(1, plays.get(r.id)!),
  dpb: dmg.get(r.id)! / Math.max(1, plays.get(r.id)!),
  hpb: healed.get(r.id)! / Math.max(1, plays.get(r.id)!),
})).sort((x, y) => y.wr - x.wr);

for (const row of rows) {
  const flag = row.wr > 0.56 ? ' ← 強すぎ' : row.wr < 0.44 ? ' ← 弱すぎ' : '';
  console.log(
    '  ' + row.r.name.padEnd(18 - row.r.name.length) + row.r.name.padEnd(2) +
    ` ${row.r.element.padEnd(6)}${row.r.role.padEnd(12)}` +
    `${(row.wr * 100).toFixed(1)}%   ${row.kpb.toFixed(2)}      ${Math.round(row.dpb).toString().padStart(5)}    ${Math.round(row.hpb).toString().padStart(5)}${flag}`,
  );
}
const spread = rows[0].wr - rows[rows.length - 1].wr;
console.log(`\n勝率レンジ: ${(spread * 100).toFixed(1)}pt  (目標 12pt 以内)\n`);
