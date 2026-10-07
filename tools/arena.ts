/**
 * 名前を付けた編成どうしの総当たり＋共通の野良への成績。
 *
 * meta.ts の探索は「そのときの池に強い編成」を拾う。池が偏れば答えも
 * 偏るので、探索で出てきた候補を並べ直して、同じ物差しで測る——
 * 全員が同じ60編成の野良と戦い、そのうえで互いに当たる。
 *
 *   npm run arena
 */
import { Worker, isMainThread, parentPort } from 'node:worker_threads';
import { cpus } from 'node:os';
import { BattleSim } from '../src/game/battle/simulate.ts';
import { REVOS, getRevos } from '../src/game/data/revos.ts';
import type { TeamSetup } from '../src/game/battle/types.ts';

const LEVEL = 20;
const CLEAN = 75;
const TEAM = 5;

const mk = (ids: string[], tag: string): TeamSetup => ({
  members: ids.map((id, i) => ({ uid: `${tag}${i}`, defId: id, level: LEVEL, clean: CLEAN, skillLevel: 1 })),
  order: ids.map((_, i) => i),
});

function duel(a: string[], b: string[], n: number, seed: number): number {
  let w = 0;
  for (let i = 0; i < n; i++) {
    const swap = i % 2 === 1;
    const s = new BattleSim((seed + i * 7919 + 13) >>> 0, mk(swap ? b : a, 'x'), mk(swap ? a : b, 'y'));
    s.runToEnd();
    const win = s.result().winner;
    if (win === -1) { w += 0.5; continue; }
    if (swap ? win === 1 : win === 0) w++;
  }
  return w / n;
}

interface Job { a: string[]; b: string[]; n: number; seed: number }

/** 測る編成。meta.ts の探索が別々の周で拾ってきたものを並べる */
const NAMED: [string, string[]][] = [
  ['耐久（眩ませ＋癒し）', ['nipponites', 'pikaia', 'quetzalcoatlus', 'irritator', 'stegosaurus']],
  ['耐久（癒し＋仕留め）', ['shonisaurus', 'majungasaurus', 'quetzalcoatlus', 'irritator', 'pliosaurus']],
  ['耐久（厚い回復）', ['quetzalcoatlus', 'brachiosaurus', 'pachycephalosaurus', 'velociraptor', 'shonisaurus']],
  ['速攻（出血＋特攻）', ['smilodon', 'anomalocaris', 'carnotaurus', 'microraptor', 'pteranodon']],
  ['速攻（二枚の牙）', ['smilodon', 'anomalocaris', 'dimorphodon', 'microraptor', 'pteranodon']],
  ['殴り合い（甲羅＋潮）', ['smilodon', 'archelon', 'shonisaurus', 'spinosaurus', 'majungasaurus']],
  ['殴り合い（帆＋潮）', ['smilodon', 'archelon', 'shonisaurus', 'majungasaurus', 'dimetrodon']],
  ['速攻殺し', ['smilodon', 'archelon', 'yutyrannus', 'pachycephalosaurus', 'dimetrodon']],
  ['崩し（硬いのを割る）', ['irritator', 'archelon', 'kronosaurus', 'spinosaurus', 'carnotaurus']],
  ['星5ならべ', ['tylosaurus', 'pliosaurus-funkei', 'quetzalcoatlus', 'tyrannosaurus-sue', 'brachiosaurus']],
  ['火力だけ', ['kronosaurus', 'diatryma', 'iguanodon', 'therizinosaurus', 'spinosaurus']],
];

let rs = 7654321;
const rnd = (): number => { rs = (rs * 1664525 + 1013904223) >>> 0; return rs / 0x100000000; };
function randomComp(): string[] {
  const set = new Set<string>();
  while (set.size < TEAM) set.add(REVOS[Math.floor(rnd() * REVOS.length)].id);
  return [...set];
}

class Pool {
  private ws: Worker[] = [];
  private idle: Worker[] = [];
  private queue: { jobs: Job[]; done: (r: number[]) => void }[] = [];
  constructor(n: number, file: string) {
    for (let i = 0; i < n; i++) {
      const w = new Worker(file);
      w.on('message', (r: number[]) => {
        const t = (w as unknown as { task?: (r: number[]) => void }).task;
        (w as unknown as { task?: unknown }).task = undefined;
        this.idle.push(w); t?.(r); this.pump();
      });
      this.ws.push(w); this.idle.push(w);
    }
  }
  private pump(): void {
    while (this.idle.length > 0 && this.queue.length > 0) {
      const w = this.idle.pop()!; const t = this.queue.shift()!;
      (w as unknown as { task?: (r: number[]) => void }).task = t.done;
      w.postMessage(t.jobs);
    }
  }
  private run(jobs: Job[]): Promise<number[]> {
    return new Promise((res) => { this.queue.push({ jobs, done: res }); this.pump(); });
  }
  async all(jobs: Job[]): Promise<number[]> {
    const k = this.ws.length;
    const parts: Job[][] = Array.from({ length: k }, () => []);
    jobs.forEach((j, i) => parts[i % k].push(j));
    const got = await Promise.all(parts.map((p) => (p.length > 0 ? this.run(p) : Promise.resolve([]))));
    const out: number[] = new Array(jobs.length);
    const cur = new Array(k).fill(0);
    jobs.forEach((_, i) => { out[i] = got[i % k][cur[i % k]++]; });
    return out;
  }
  close(): void { for (const w of this.ws) void w.terminate(); }
}

async function main(): Promise<void> {
  const pool = new Pool(Math.max(1, Math.min(4, cpus().length)), new URL(import.meta.url).pathname);
  const FIELD = Number(process.argv[2] ?? 48);
  const N = Number(process.argv[3] ?? 24);
  const field = Array.from({ length: FIELD }, () => randomComp());

  // ---- 共通の野良に対する成績 ----
  const jobs: Job[] = [];
  for (const [, c] of NAMED) for (const f of field) jobs.push({ a: c, b: f, n: N, seed: 4242 });
  const res = await pool.all(jobs);
  const rows = NAMED.map(([name, c], i) => {
    const s = res.slice(i * FIELD, (i + 1) * FIELD);
    const avg = s.reduce((x, y) => x + y, 0) / FIELD;
    const sorted = s.slice().sort((x, y) => x - y);
    return { name, c, avg, worst: sorted[0], p10: sorted[Math.floor(FIELD * 0.1)] };
  }).sort((x, y) => y.avg - x.avg);

  console.log(`\n=== 野良 ${FIELD} 編成 × ${N} 戦 ===`);
  console.log('  ' + '編成'.padEnd(20) + '平均勝率  最悪  下位1割');
  for (const r of rows) {
    console.log(`  ${r.name.padEnd(22 - r.name.length)}${r.name}  ${(r.avg * 100).toFixed(1)}%   ${(r.worst * 100).toFixed(0)}%   ${(r.p10 * 100).toFixed(0)}%`);
  }

  // ---- 互いの当たり ----
  const hh: Job[] = [];
  for (let i = 0; i < rows.length; i++) {
    for (let j = 0; j < rows.length; j++) if (i !== j) hh.push({ a: rows[i].c, b: rows[j].c, n: N * 2, seed: 99991 });
  }
  const hr = await pool.all(hh);
  const m: number[][] = Array.from({ length: rows.length }, () => new Array(rows.length).fill(0.5));
  let k = 0;
  for (let i = 0; i < rows.length; i++) for (let j = 0; j < rows.length; j++) if (i !== j) m[i][j] = hr[k++];

  console.log(`\n=== 直接対決（行が ${N * 2} 戦して勝った割合）===`);
  console.log('      ' + rows.map((_, j) => String(j + 1).padStart(5)).join(''));
  rows.forEach((r, i) => {
    console.log(`  ${String(i + 1).padStart(2)}  ` + m[i].map((v, j) => (i === j ? '    -' : `${(v * 100).toFixed(0)}%`.padStart(5))).join('') + `   ${r.name}`);
  });
  console.log('\n  行の最小値（いちばん苦手な相手に対する勝率）');
  rows.forEach((r, i) => {
    const worst = Math.min(...m[i].filter((_, j) => j !== i));
    console.log(`    ${String(i + 1).padStart(2)}  ${(worst * 100).toFixed(0)}%   ${r.name}`);
  });
  console.log(`\n  顔ぶれ`);
  rows.forEach((r, i) => console.log(`    ${String(i + 1).padStart(2)}  ${r.c.map((id) => getRevos(id).name).join(' / ')}`));
  pool.close();
}

if (!isMainThread) {
  parentPort!.on('message', (jobs: Job[]) => {
    parentPort!.postMessage(jobs.map((j) => duel(j.a, j.b, j.n, j.seed)));
  });
} else {
  void main();
}
