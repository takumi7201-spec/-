/**
 * ランの測定。
 *
 *   1. 周ごとの戦闘の長さ・砂嵐で決まった割合・引き分け
 *   2. 系統を好んで集めるボット vs 好みなしのボット（周ごとの勝率）
 *   3. ユニットごとの、居たときの勝率（周 4〜12）
 *   4. 育ちの大きさ（周ごとの、盤面の育ちの合計）
 *   5. 1本のランを通して何勝まで行くか（好みなしのボットが、毎周の相手に挑む）
 *
 *   npm run run -- [N=300]
 */
import { REVOS } from '../src/game/data/revos.ts';
import { KIT_TRAIT, KIT_TRAITS } from '../src/game/data/traits.ts';
import { RUN_UNITS } from '../src/game/run/units.ts';
import { runBattle } from '../src/game/run/battle.ts';
import { buildOpponent, newRun, botShop, finishBattle, isOver, RUN_WINS } from '../src/game/run/run.ts';
import type { RunUnit } from '../src/game/run/types.ts';

const N = Number(process.argv[2] ?? 300);
const POOL = RUN_UNITS.map((u) => u.id);
const TRAITS = [...new Set(Object.values(KIT_TRAIT))];
const name = (id: string): string => REVOS.find((r) => r.id === id)?.name ?? id;
const pct = (x: number): string => `${(x * 100).toFixed(1)}%`;
const winOf = (w: number, side: 0 | 1): number => (w === side ? 1 : w === -1 ? 0.5 : 0);

console.log('\n=== 1. 周ごとの戦闘 ===');
console.log('  周   秒(平均)  砂嵐で決着  引分   育ちの合計(平均)');
for (const r of [1, 2, 3, 5, 8, 12, 16]) {
  let sec = 0, storm = 0, draw = 0, grow = 0;
  const M = Math.max(40, Math.floor(N / 4));
  for (let i = 0; i < M; i++) {
    const a = buildOpponent(POOL, r, 1000 + i * 7);
    const b = buildOpponent(POOL, r, 5000 + i * 13);
    const res = runBattle(a, b, r);
    sec += res.seconds;
    if (res.seconds > 30) storm++;
    if (res.winner === -1) draw++;
    for (const u of a) if (u) grow += Object.values(u.perm).reduce((x, y) => x + Math.abs(y ?? 0), 0);
  }
  console.log(`  ${String(r).padStart(2)}   ${(sec / M).toFixed(1).padStart(5)}s   ${pct(storm / M).padStart(6)}   ${pct(draw / M).padStart(5)}   ${(grow / M).toFixed(1)}`);
}

console.log('\n=== 2. 系統を好んで集めるボット vs 好みなし ===');
console.log('  系統    周3     周6     周10    周14');
for (const t of TRAITS) {
  const cells: string[] = [];
  for (const r of [3, 6, 10, 14]) {
    let w = 0;
    const M = Math.max(30, Math.floor(N / 6));
    for (let i = 0; i < M; i++) {
      const a = buildOpponent(POOL, r, 20000 + i * 31, t);
      const b = buildOpponent(POOL, r, 40000 + i * 17);
      w += winOf(runBattle(a, b, r).winner, 0);
    }
    cells.push(pct(w / M).padStart(6));
  }
  console.log(`  ${KIT_TRAITS[t as keyof typeof KIT_TRAITS].name.padEnd(4)}  ${cells.join('  ')}`);
}

console.log('\n=== 3. ユニットごとの、居たときの勝率（周 4〜12、好みなし同士）===');
{
  const w = new Map<string, [number, number]>();
  const M = N * 2;
  for (let i = 0; i < M; i++) {
    const r = 4 + (i % 9);
    const prefA = i % 3 === 0 ? TRAITS[i % TRAITS.length] : undefined;
    const a = buildOpponent(POOL, r, 70000 + i * 11, prefA);
    const b = buildOpponent(POOL, r, 90000 + i * 23);
    const res = runBattle(a, b, r);
    for (const [side, board] of [[0, a], [1, b]] as const) {
      for (const u of board) {
        if (!u) continue;
        const c = w.get(u.defId) ?? [0, 0];
        c[0] += winOf(res.winner, side); c[1]++;
        w.set(u.defId, c);
      }
    }
  }
  const rows = [...w.entries()].map(([id, [a, b]]) => [id, a / b, b] as const).sort((x, y) => y[1] - x[1]);
  for (const [id, r, n] of rows) {
    const d = RUN_UNITS.find((u) => u.id === id)!;
    console.log(`  ${name(id).padEnd(14)} 段${d.tier}  ${pct(r).padStart(6)}  (${n})`);
  }
  const unseen = RUN_UNITS.filter((u) => !w.has(u.id)).map((u) => name(u.id));
  if (unseen.length) console.log(`  一度も使われなかった: ${unseen.join('・')}`);
}

console.log('\n=== 5. 1本のラン（好みなしのボットが、周ごとの相手に挑む）===');
{
  const hist = new Array(RUN_WINS + 1).fill(0);
  let rounds = 0;
  const M = Math.max(40, Math.floor(N / 3));
  for (let i = 0; i < M; i++) {
    const s = newRun(POOL, 300 + i * 101);
    while (!isOver(s)) {
      botShop(s);
      const foe = buildOpponent(POOL, s.round, 123457 + s.round * 7919 + i * 3);
      finishBattle(s, runBattle(s.board, foe, s.round));
    }
    hist[s.wins]++;
    rounds += s.round - 1;
  }
  console.log(`  勝ち数の分布: ${hist.map((n, k) => `${k}:${n}`).join(' ')}   平均の周数 ${(rounds / M).toFixed(1)}`);
  console.log(`  10勝の割合 ${pct(hist[RUN_WINS] / M)}`);
}

void ({} as RunUnit);
