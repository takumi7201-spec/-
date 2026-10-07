/**
 * 覇権編成の中身を覗く。
 *
 * 勝率だけ見ても「何で勝っているのか」は分からない。時間切れで押し切って
 * いるのか、削り合って勝っているのか、どの札が仕事をしているのか——
 * 対抗手を設計するには、その内訳が要る。
 *
 *   npm run metadiag -- <編成A のid,…> <編成B のid,…> [戦数]
 */
import { BattleSim } from '../src/game/battle/simulate.ts';
import { REVOS, getRevos } from '../src/game/data/revos.ts';
import type { TeamSetup, BattleEvent } from '../src/game/battle/types.ts';

const LEVEL = 20;
const CLEAN = 75;

const mk = (ids: string[], tag: string): TeamSetup => ({
  members: ids.map((id, i) => ({ uid: `${tag}${i}`, defId: id, level: LEVEL, clean: CLEAN, skillLevel: 1 })),
  order: ids.map((_, i) => i),
});

const A = (process.argv[2] ?? '').split(',').filter(Boolean);
const B = (process.argv[3] ?? '').split(',').filter(Boolean);
const N = Number(process.argv[4] ?? 200);
if (A.length === 0 || B.length === 0) { console.log('編成を2つ渡す'); process.exit(1); }

const show = (c: string[]): string => c.map((id) => getRevos(id).name).join(' / ');

let aWin = 0, draw = 0, timeUp = 0;
let sec = 0;
const secs: number[] = [];
let miss = 0, hits = 0, burst = 0, tick = 0, odFire = 0;
const dealt = new Map<string, number>();
const healed = new Map<string, number>();
const taken = new Map<string, number>();
for (const r of REVOS) { dealt.set(r.id, 0); healed.set(r.id, 0); taken.set(r.id, 0); }

for (let i = 0; i < N; i++) {
  const swap = i % 2 === 1;
  const sim = new BattleSim((i * 7919 + 13) >>> 0, mk(swap ? B : A, 'x'), mk(swap ? A : B, 'y'));
  const ev: BattleEvent[] = sim.runToEnd();
  const res = sim.result();
  if (res.winner === -1) draw++;
  else if ((swap ? 1 : 0) === res.winner) aWin++;
  if (res.timeUp) timeUp++;
  sec += res.seconds;
  secs.push(res.seconds);
  for (const e of ev) {
    if (e.t === 'miss') miss++;
    else if (e.t === 'damage') hits++;
    else if (e.t === 'burst') burst += e.amount;
    else if (e.t === 'statusTick') tick += e.amount;
    else if (e.t === 'action' && e.kind === 'od') odFire++;
  }
  for (const f of res.fighters) {
    dealt.set(f.defId, dealt.get(f.defId)! + f.dealt);
    healed.set(f.defId, healed.get(f.defId)! + f.healed);
    taken.set(f.defId, taken.get(f.defId)! + f.taken);
  }
}

secs.sort((x, y) => x - y);
const q = (k: number): string => secs[Math.floor(secs.length * k)].toFixed(0);
console.log(`\nA: ${show(A)}`);
console.log(`B: ${show(B)}`);
console.log(`\n${N} 戦  A勝率 ${((aWin / N) * 100).toFixed(1)}%  引分 ${draw}`);
console.log(`長さ   平均 ${(sec / N).toFixed(0)}秒  中央 ${q(0.5)}  p90 ${q(0.9)}  最長 ${secs[secs.length - 1].toFixed(0)}`);
console.log(`時間切れ ${((timeUp / N) * 100).toFixed(1)}%   (180秒で打ち切り＝体力割合で判定)`);
console.log(`外れ率 ${((miss / Math.max(1, miss + hits)) * 100).toFixed(1)}%   1戦あたりOD ${(odFire / N).toFixed(1)} 回`);
console.log(`固定ダメージ（出血の弾け＋火傷/毒の刻み）: ${Math.round((burst + tick) / N)} / 戦`);
console.log(`\n--- 1戦あたりの仕事量 ---`);
const ids = [...new Set([...A, ...B])];
console.log('  ' + 'ユニット'.padEnd(14) + '与ダメ   被ダメ   回復');
for (const id of ids) {
  console.log(
    '  ' + getRevos(id).name.padEnd(16 - getRevos(id).name.length) + getRevos(id).name.padEnd(2) +
    `${Math.round(dealt.get(id)! / N).toString().padStart(7)}  ${Math.round(taken.get(id)! / N).toString().padStart(7)}  ${Math.round(healed.get(id)! / N).toString().padStart(6)}`,
  );
}
