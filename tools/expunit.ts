/**
 * 1枠ぶんの効き目を測る。
 *
 * 同じ4体の土台に、ロスターを1体ずつ足して、いまの覇権編成（耐久2種）と
 * 野良に当てる。「この相手に強い」と「野良相手に壊れていない」を同じ表に
 * 並べるのが目的——片方だけ見ると、1つの編成にしか勝てない札を強いと誤る。
 *
 * 新しい特性を試すときは、revos.ts に id を 'exp-' で始まる個体として
 * 足すだけでいい。野良にも相手編成にも混ざらず、測る側の枠にだけ入る。
 *
 *   npm run expunit
 */
import { Worker, isMainThread, parentPort } from 'node:worker_threads';
import { cpus } from 'node:os';
import { BattleSim } from '../src/game/battle/simulate.ts';
import { REVOS, getRevos, registerRevos } from '../src/game/data/revos.ts';
import { EXP_DEFS } from './expDefs.ts';
import type { TeamSetup } from '../src/game/battle/types.ts';

const LEVEL = 20;
const CLEAN = 75;
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

/** 試作は野良にも相手編成にも混ぜない。測る側だけに置く */
registerRevos(EXP_DEFS);

const REAL = REVOS.filter((r) => !r.id.startsWith('exp-')).map((r) => r.id);
const EXP = REVOS.filter((r) => r.id.startsWith('exp-')).map((r) => r.id);

const META1 = ['quetzalcoatlus', 'brachiosaurus', 'pachycephalosaurus', 'velociraptor', 'shonisaurus'];
const META2 = ['nipponites', 'pikaia', 'quetzalcoatlus', 'irritator', 'stegosaurus'];
/** 土台はコマンドラインから。軸ごとに差し替えて、同じ物差しで測る */
const BASE = (process.argv[2] ?? 'archelon,shonisaurus,dimetrodon,smilodon').split(',').filter(Boolean);

let rs = 13572468;
const rnd = (): number => { rs = (rs * 1664525 + 1013904223) >>> 0; return rs / 0x100000000; };
function randomComp(): string[] {
  const set = new Set<string>();
  while (set.size < 5) set.add(REAL[Math.floor(rnd() * REAL.length)]);
  return [...set];
}

class Pool {
  private ws: Worker[] = []; private idle: Worker[] = [];
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
  const FIELD = 20, FN = 14, MN = 60;
  const field = Array.from({ length: FIELD }, () => randomComp());
  const cands = [...REAL.filter((id) => !BASE.includes(id)), ...EXP];

  const jobs: Job[] = [];
  for (const id of cands) {
    const c = [...BASE, id];
    jobs.push({ a: c, b: META1, n: MN, seed: 515 });
    jobs.push({ a: c, b: META2, n: MN, seed: 616 });
    for (const f of field) jobs.push({ a: c, b: f, n: FN, seed: 717 });
  }
  const res = await pool.all(jobs);
  const per = 2 + FIELD;
  const rows = cands.map((id, i) => {
    const s = res.slice(i * per, (i + 1) * per);
    const fieldAvg = s.slice(2).reduce((x, y) => x + y, 0) / FIELD;
    return { id, m1: s[0], m2: s[1], field: fieldAvg, score: (s[0] + s[1]) / 2 };
  }).sort((x, y) => y.score - x.score);

  console.log(`\n土台: ${BASE.map((id) => getRevos(id).name).join(' / ')} ＋ 1体`);
  console.log(`相手: 耐久1=${META1.map((id) => getRevos(id).name).join('/')}`);
  console.log(`      耐久2=${META2.map((id) => getRevos(id).name).join('/')}`);
  console.log(`\n  ${'足す1体'.padEnd(16)}耐久1   耐久2   平均   野良${FIELD}編成`);
  for (const r of rows) {
    const n = getRevos(r.id).name;
    const mark = r.id.startsWith('exp-') ? ' ★試作' : '';
    console.log(`  ${n.padEnd(20 - n.length)}${n}  ${(r.m1 * 100).toFixed(0).padStart(4)}%  ${(r.m2 * 100).toFixed(0).padStart(4)}%  ${(r.score * 100).toFixed(1).padStart(5)}%  ${(r.field * 100).toFixed(1).padStart(5)}%${mark}`);
  }
  pool.close();
}

if (!isMainThread) {
  parentPort!.on('message', (jobs: Job[]) => {
    parentPort!.postMessage(jobs.map((j) => duel(j.a, j.b, j.n, j.seed)));
  });
} else { void main(); }
