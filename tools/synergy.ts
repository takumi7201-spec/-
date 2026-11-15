/**
 * 試作: 属性シナジー（TFT 風）の効きを測る。
 *
 * 同じ編成・同じ乱数で「シナジー無し / 効果型 / 倍率型」を戦わせ、差だけを見る。
 *   1. 無作為 5v5 で、どれだけの編成が段に乗るか（発動頻度）
 *   2. 段ごとの勝率の持ち上がり（無しとの差）
 *   3. 属性ごとの持ち上がり。2体・4体を揃えた編成 vs 無作為
 *   4. ユニット単体の勝率の幅が、シナジーで歪まないか
 *   5. 強い編成の上位がシナジーで塗り替わるか（揃えるのが正解になりすぎないか）
 *
 *   npm run synergy -- [N]
 */
import { Worker, isMainThread, parentPort } from 'node:worker_threads';
import { fileURLToPath } from 'node:url';
import { BattleSim } from '../src/game/battle/simulate.ts';
import { REVOS } from '../src/game/data/revos.ts';
import type { TeamSetup, BattleRules } from '../src/game/battle/types.ts';

type Mode = 'off' | 'effect' | 'flat';
interface Job { a: string[]; b: string[]; seed: number; mode: Mode }

const TEAM = 5;
/** 段の敷居。`npm run synergy -- N 3,5` */
const STEPS = (process.argv[3] ?? '2,4').split(',').map(Number) as [number, number];
const REAL = REVOS.filter((r) => !r.id.startsWith('exp-'));
const ELEMENTS = ['flame', 'aqua', 'terra', 'gale', 'null'] as const;
const EL_JA: Record<string, string> = { flame: '火', aqua: '水', terra: '土', gale: '風', null: '無' };
const elOf = new Map(REVOS.map((r) => [r.id, r.element as string]));

function mkTeam(ids: string[], tag: string): TeamSetup {
  return {
    members: ids.map((id, i) => ({ uid: `${tag}${i}`, defId: id, level: 10, clean: 60, skillLevel: 1 })),
    order: ids.map((_, i) => i),
  };
}

function fight(j: Job): number {
  const rules: BattleRules = j.mode === 'off' ? { synergy: 'off' } : { synergy: j.mode, synergySteps: STEPS };
  const sim = new BattleSim(j.seed, mkTeam(j.a, 'a'), mkTeam(j.b, 'b'), rules);
  sim.runToEnd();
  return sim.result().winner;
}

if (!isMainThread) {
  parentPort!.on('message', (jobs: Job[]) => parentPort!.postMessage(jobs.map(fight)));
}

class Pool {
  private ws: Worker[] = [];
  constructor(n: number) {
    const file = fileURLToPath(import.meta.url);
    for (let i = 0; i < n; i++) this.ws.push(new Worker(file));
  }
  async all(jobs: Job[]): Promise<number[]> {
    const k = this.ws.length;
    const chunk = Math.ceil(jobs.length / k);
    const parts = this.ws.map((w, i) => new Promise<number[]>((res) => {
      w.once('message', res);
      w.postMessage(jobs.slice(i * chunk, (i + 1) * chunk));
    }));
    return (await Promise.all(parts)).flat();
  }
  close(): void { for (const w of this.ws) void w.terminate(); }
}

let rs = 24680;
const rnd = (): number => { rs = (rs * 1664525 + 1013904223) >>> 0; return rs / 0x100000000; };
function randomComp(): string[] {
  const set = new Set<string>();
  while (set.size < TEAM) set.add(REAL[Math.floor(rnd() * REAL.length)].id);
  return [...set];
}
/** 属性 el をちょうど k 体、残りはすべて別属性（他の段は立てない） */
function stackComp(el: string, k: number): string[] {
  const own = REAL.filter((r) => r.element === el);
  const pick = new Set<string>();
  while (pick.size < k) pick.add(own[Math.floor(rnd() * own.length)].id);
  const others = ELEMENTS.filter((e) => e !== el);
  // 残りは別々の属性から1体ずつ
  const order = [...others].sort(() => rnd() - 0.5);
  for (let i = 0; pick.size < TEAM; i++) {
    const pool = REAL.filter((r) => r.element === order[i % order.length]);
    pick.add(pool[Math.floor(rnd() * pool.length)].id);
  }
  return [...pick];
}
/** 編成の段: 段に乗っている体数（2段目は4体以上） */
function tiers(ids: string[]): { covered: number; top: number } {
  const c = new Map<string, number>();
  for (const id of ids) c.set(elOf.get(id)!, (c.get(elOf.get(id)!) ?? 0) + 1);
  let covered = 0, top = 0;
  for (const n of c.values()) {
    if (n >= STEPS[0]) covered += n;
    top = Math.max(top, n >= STEPS[1] ? 2 : n >= STEPS[0] ? 1 : 0);
  }
  return { covered, top };
}

const pct = (x: number): string => `${(x * 100).toFixed(1)}%`;
const sgn = (x: number): string => `${x >= 0 ? '+' : ''}${(x * 100).toFixed(1)}`;

async function main(): Promise<void> {
  const N = Number(process.argv[2] ?? 6000);
  const pool = new Pool(4);
  const MODES: Mode[] = ['off', 'effect', 'flat'];
  const t0 = Date.now();

  // ---- 1, 2, 4: 無作為 5v5 ----
  const pairs = Array.from({ length: N }, (_, i) => ({ a: randomComp(), b: randomComp(), seed: i * 7919 + 13 }));
  const res: Record<Mode, number[]> = { off: [], effect: [], flat: [] };
  for (const m of MODES) res[m] = await pool.all(pairs.map((p) => ({ ...p, mode: m })));

  console.log(`敷居 ${STEPS.join('/')}`);
  console.log(`\n=== 1. 発動頻度（無作為 ${N} 戦 × 2 チーム）===`);
  const hist = new Map<number, number>();
  let t1 = 0, t2 = 0;
  for (const p of pairs) for (const t of [p.a, p.b]) {
    const { covered, top } = tiers(t);
    hist.set(covered, (hist.get(covered) ?? 0) + 1);
    if (top >= 1) t1++;
    if (top >= 2) t2++;
  }
  console.log(`  1段以上 ${pct(t1 / (2 * N))}   2段（${STEPS[1]}体） ${pct(t2 / (2 * N))}`);
  console.log('  段に乗っている体数の分布: ' + [0, 2, 3, 4, 5].map((k) => `${k}体 ${pct((hist.get(k) ?? 0) / (2 * N))}`).join('  '));

  console.log('\n=== 2. 段に乗った体数の差と勝率（A 側から見る）===');
  console.log('  差 = A の段の体数 − B の段の体数');
  const byDiff = new Map<number, Record<Mode, [number, number]>>();
  pairs.forEach((p, i) => {
    const d = tiers(p.a).covered - tiers(p.b).covered;
    const key = Math.max(-4, Math.min(4, d));
    if (!byDiff.has(key)) byDiff.set(key, { off: [0, 0], effect: [0, 0], flat: [0, 0] });
    for (const m of MODES) {
      const w = res[m][i];
      const r = byDiff.get(key)![m];
      r[1]++;
      if (w === 0) r[0]++; else if (w === -1) r[0] += 0.5;
    }
  });
  console.log('   差    数     無し    効果型(差)        倍率型(差)');
  for (const d of [...byDiff.keys()].sort((x, y) => x - y)) {
    const r = byDiff.get(d)!;
    const off = r.off[0] / r.off[1], eff = r.effect[0] / r.effect[1], fl = r.flat[0] / r.flat[1];
    console.log(`  ${String(d).padStart(3)}  ${String(r.off[1]).padStart(5)}  ${pct(off).padStart(6)}  ${pct(eff).padStart(6)} (${sgn(eff - off).padStart(5)})  ${pct(fl).padStart(6)} (${sgn(fl - off).padStart(5)})`);
  }

  console.log('\n=== 4. ユニット単体の勝率の幅 ===');
  for (const m of MODES) {
    const w = new Map<string, [number, number]>();
    pairs.forEach((p, i) => {
      const win = res[m][i];
      for (const [side, t] of [[0, p.a], [1, p.b]] as const) for (const id of t) {
        const r = w.get(id) ?? [0, 0];
        r[1]++;
        if (win === side) r[0]++; else if (win === -1) r[0] += 0.5;
        w.set(id, r);
      }
    });
    const rates = [...w.entries()].map(([id, [a, b]]) => [id, a / b] as const).sort((x, y) => y[1] - x[1]);
    const sd = Math.sqrt(rates.reduce((s, [, r]) => s + (r - 0.5) ** 2, 0) / rates.length);
    const name = (id: string): string => REVOS.find((r) => r.id === id)!.name;
    // 属性ごとの平均
    const elAvg = ELEMENTS.map((e) => {
      const rs2 = rates.filter(([id]) => elOf.get(id) === e);
      return `${EL_JA[e]} ${pct(rs2.reduce((s, [, r]) => s + r, 0) / rs2.length)}`;
    }).join(' ');
    console.log(`  ${m.padEnd(6)} 幅 ${pct(rates[0][1] - rates[rates.length - 1][1])}  sd ${(sd * 100).toFixed(1)}pt  上 ${name(rates[0][0])} ${pct(rates[0][1])}  下 ${name(rates[rates.length - 1][0])} ${pct(rates[rates.length - 1][1])}`);
    console.log(`         属性平均: ${elAvg}`);
  }

  // ---- 3: 属性ごとの持ち上がり ----
  console.log('\n=== 3. 属性を揃えた編成 vs 無作為（同じ編成・同じ乱数で、シナジー無しとの差）===');
  const M = Math.max(400, Math.floor(N / 6));
  console.log(`  各 ${M} 戦。「無し」は揃えただけの素の強さ`);
  console.log('  属性  体数   無し     効果型(差)        倍率型(差)');
  for (const el of ELEMENTS) for (const k of [STEPS[0], Math.min(TEAM, STEPS[1])]) {
    const js = Array.from({ length: M }, (_, i) => ({ a: stackComp(el, k), b: randomComp(), seed: 900001 + i * 31 }));
    const row: Record<Mode, number> = { off: 0, effect: 0, flat: 0 };
    for (const m of MODES) {
      const ws = await pool.all(js.map((j) => ({ ...j, mode: m })));
      row[m] = ws.reduce((s, w) => s + (w === 0 ? 1 : w === -1 ? 0.5 : 0), 0) / M;
    }
    console.log(`  ${EL_JA[el]}     ${k}    ${pct(row.off).padStart(6)}  ${pct(row.effect).padStart(6)} (${sgn(row.effect - row.off).padStart(5)})  ${pct(row.flat).padStart(6)} (${sgn(row.flat - row.off).padStart(5)})`);
  }

  // ---- 5: 強い編成の上位は塗り替わるか ----
  console.log('\n=== 5. 編成の上位は塗り替わるか ===');
  const C = 160, G = 60;
  const comps = Array.from({ length: C }, (_, i) => (i < C / 2 ? randomComp() : stackComp(ELEMENTS[i % 5], STEPS[0] + (i % (TEAM - STEPS[0] + 1)))));
  const gaunt = Array.from({ length: G }, () => randomComp());
  const score: Record<Mode, number[]> = { off: [], effect: [], flat: [] };
  for (const m of MODES) {
    const js: Job[] = [];
    comps.forEach((c, ci) => gaunt.forEach((g, gi) => js.push({ a: c, b: g, seed: 5000 + ci * 977 + gi * 13, mode: m })));
    const ws = await pool.all(js);
    score[m] = comps.map((_, ci) => {
      let s = 0;
      for (let gi = 0; gi < G; gi++) { const w = ws[ci * G + gi]; s += w === 0 ? 1 : w === -1 ? 0.5 : 0; }
      return s / G;
    });
  }
  const TOP = 16;
  for (const m of MODES) {
    const idx = comps.map((_, i) => i).sort((x, y) => score[m][y] - score[m][x]).slice(0, TOP);
    const cov = idx.reduce((s, i) => s + tiers(comps[i]).covered, 0) / TOP;
    const t2n = idx.filter((i) => tiers(comps[i]).top >= 2).length;
    const offTop = comps.map((_, i) => i).sort((x, y) => score.off[y] - score.off[x]).slice(0, TOP);
    const keep = idx.filter((i) => offTop.includes(i)).length;
    const best = score[m][idx[0]];
    console.log(`  ${m.padEnd(6)} 上位${TOP}: 段の体数 平均 ${cov.toFixed(2)}  4体揃え ${t2n}  無しの上位と重なる ${keep}/${TOP}  首位 ${pct(best)}`);
  }
  const allCov = comps.reduce((s, c) => s + tiers(c).covered, 0) / C;
  console.log(`  （候補全体の段の体数 平均 ${allCov.toFixed(2)}）`);

  console.log(`\n  ${((Date.now() - t0) / 1000).toFixed(0)}秒`);
  pool.close();
}

if (isMainThread) void main();
