/**
 * メタ探索。
 *
 * 「どの1体が強いか」は balance.ts が見ている。こちらが見るのは
 * 「どの5体の組み合わせが強いか」——単体の勝率が揃っていても、
 * 噛み合う5体が1つあれば盤面はそこで固まる。
 *
 *   npm run meta            総当たりで覇権編成を探し、対抗手を測る
 *   npm run meta -- --fast  手数を減らした下見
 *
 * 進め方は山登り。無作為な編成の池を作り、池の全員と戦わせて勝ち越す
 * 候補だけを残す。相手が入れ替わり続けるので、「その時点の池に強い」
 * ではなく「何に対しても強い」編成だけが生き残る。
 */
import { Worker, isMainThread, parentPort, workerData } from 'node:worker_threads';
import { cpus } from 'node:os';
import { BattleSim } from '../src/game/battle/simulate.ts';
import { REVOS } from '../src/game/data/revos.ts';
import type { TeamSetup } from '../src/game/battle/types.ts';

const TEAM = 5;
/** 測る高さ。闘技場と同じく、両軍とも同じレベル・同じ仕上がりで揃える */
const LEVEL = 20;
const CLEAN = 75;

const IDS = REVOS.map((r) => r.id);

function mk(ids: string[], tag: string): TeamSetup {
  return {
    members: ids.map((id, i) => ({ uid: `${tag}${i}`, defId: id, level: LEVEL, clean: CLEAN, skillLevel: 1 })),
    order: ids.map((_, i) => i),
  };
}

/**
 * 2編成を n 回戦わせて、A の勝率を返す。
 *
 * 必ず左右を入れ替えて同数ずつ戦う。先手側にわずかな偏りがあるので、
 * 片側だけで測ると、噛み合いではなく席順を測ってしまう。
 */
function duel(a: string[], b: string[], n: number, seed: number): number {
  let w = 0, played = 0;
  for (let i = 0; i < n; i++) {
    const swap = i % 2 === 1;
    const s = new BattleSim(
      (seed + i * 7919 + 13) >>> 0,
      mk(swap ? b : a, 'x'), mk(swap ? a : b, 'y'),
    );
    s.runToEnd();
    const win = s.result().winner;
    if (win === -1) { played++; w += 0.5; continue; }
    played++;
    const aWon = swap ? win === 1 : win === 0;
    if (aWon) w++;
  }
  return w / Math.max(1, played);
}

// ------------------------------------------------------------- 並列の口

interface Job { a: string[]; b: string[]; n: number; seed: number }

/** 走らせるだけの殻。仕事の束を配って、返ってきた順に詰め直す */
class Pool {
  private ws: Worker[] = [];
  private idle: Worker[] = [];
  private queue: { jobs: Job[]; done: (r: number[]) => void }[] = [];

  constructor(n: number, file: string) {
    for (let i = 0; i < n; i++) {
      const w = new Worker(file, { workerData: { i } });
      w.on('message', (r: number[]) => {
        const task = (w as unknown as { task?: (r: number[]) => void }).task;
        (w as unknown as { task?: unknown }).task = undefined;
        this.idle.push(w);
        task?.(r);
        this.pump();
      });
      this.ws.push(w);
      this.idle.push(w);
    }
  }

  private pump(): void {
    while (this.idle.length > 0 && this.queue.length > 0) {
      const w = this.idle.pop()!;
      const t = this.queue.shift()!;
      (w as unknown as { task?: (r: number[]) => void }).task = t.done;
      w.postMessage(t.jobs);
    }
  }

  run(jobs: Job[]): Promise<number[]> {
    return new Promise((res) => { this.queue.push({ jobs, done: res }); this.pump(); });
  }

  /** 束を人数ぶんに割って配る。返りは元の並びに戻す */
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

// ------------------------------------------------------------- 探索

const FAST = process.argv.includes('--fast');
const ROUNDS = FAST ? 5 : 10;
const POOL = FAST ? 12 : 16;
const CANDIDATES = FAST ? 24 : 40;
const FIGHTS = FAST ? 8 : 12;

function key(c: string[]): string { return [...c].sort().join(','); }

let rs = 20260101;
function rnd(): number { rs = (rs * 1664525 + 1013904223) >>> 0; return rs / 0x100000000; }
function pick<T>(xs: T[]): T { return xs[Math.floor(rnd() * xs.length)]; }

function randomComp(): string[] {
  const set = new Set<string>();
  while (set.size < TEAM) set.add(pick(IDS));
  return [...set];
}

/** 1〜2体だけ入れ替える。全替えすると、何が効いたのか追えない */
function mutate(c: string[]): string[] {
  const out = c.slice();
  const k = rnd() < 0.72 ? 1 : 2;
  for (let i = 0; i < k; i++) {
    const at = Math.floor(rnd() * TEAM);
    let id = pick(IDS);
    let guard = 0;
    while (out.includes(id) && guard++ < 40) id = pick(IDS);
    out[at] = id;
  }
  return out;
}

const nameOf = new Map(REVOS.map((r) => [r.id, r.name]));
const show = (c: string[]): string => c.map((id) => nameOf.get(id) ?? id).join(' / ');

async function scoreAgainst(pool: Pool, cands: string[][], field: string[][], n: number): Promise<number[]> {
  const jobs: Job[] = [];
  for (const c of cands) for (const f of field) jobs.push({ a: c, b: f, n, seed: 777 });
  const res = await pool.all(jobs);
  return cands.map((_, i) => {
    const slice = res.slice(i * field.length, (i + 1) * field.length);
    return slice.reduce((s, x) => s + x, 0) / Math.max(1, slice.length);
  });
}

async function main(): Promise<void> {
  const file = new URL(import.meta.url).pathname;
  const pool = new Pool(Math.max(1, Math.min(4, cpus().length)), file);
  const t0 = Date.now();

  // ---- 1) 池を作って回す ----
  let field: string[][] = Array.from({ length: POOL }, () => randomComp());
  for (let r = 0; r < ROUNDS; r++) {
    const seen = new Set(field.map(key));
    const cands: string[][] = [];
    while (cands.length < CANDIDATES) {
      const c = rnd() < 0.82 ? mutate(pick(field)) : randomComp();
      const k = key(c);
      if (seen.has(k)) continue;
      seen.add(k);
      cands.push(c);
    }
    const all = [...field, ...cands];
    const sc = await scoreAgainst(pool, all, field, FIGHTS);
    const ranked = all.map((c, i) => ({ c, s: sc[i] })).sort((x, y) => y.s - x.s);
    field = ranked.slice(0, POOL).map((x) => x.c);
    console.log(
      `周 ${String(r + 1).padStart(2)}  首位 ${(ranked[0].s * 100).toFixed(1)}%  ` +
      `池の中央 ${(ranked[Math.floor(POOL / 2)].s * 100).toFixed(1)}%  ${show(ranked[0].c)}`,
    );
  }

  // ---- 2) 残った池で総当たり。回数を増やして順位を固める ----
  console.log(`\n=== 最終の池（総当たり ${FAST ? 40 : 80} 戦 × ${POOL - 1} 相手）===`);
  const RR = FAST ? 40 : 80;
  const jobs: Job[] = [];
  for (let i = 0; i < field.length; i++) {
    for (let j = 0; j < field.length; j++) if (i !== j) jobs.push({ a: field[i], b: field[j], n: RR, seed: 31337 });
  }
  const rr = await pool.all(jobs);
  const table: number[][] = Array.from({ length: field.length }, () => new Array(field.length).fill(0.5));
  let k = 0;
  for (let i = 0; i < field.length; i++) {
    for (let j = 0; j < field.length; j++) if (i !== j) table[i][j] = rr[k++];
  }
  const avg = field.map((_, i) => {
    let s = 0, n = 0;
    for (let j = 0; j < field.length; j++) if (i !== j) { s += table[i][j]; n++; }
    return s / n;
  });
  const order = field.map((_, i) => i).sort((x, y) => avg[y] - avg[x]);
  for (const i of order) {
    const worst = Math.min(...field.map((_, j) => (i === j ? 1 : table[i][j])));
    console.log(`  ${(avg[i] * 100).toFixed(1)}%  最悪 ${(worst * 100).toFixed(1)}%   ${show(field[i])}`);
  }

  const ci = order[0];
  const champ = field[ci];
  console.log(`\n覇権編成: ${show(champ)}`);
  // 池の中で誰に食われているか。苦手が1つでもあれば、そこが対抗手の形になる
  const foes = field.map((_, j) => ({ j, w: ci === j ? 0.5 : table[ci][j] }))
    .filter((x) => x.j !== ci).sort((x, y) => x.w - y.w).slice(0, 3);
  console.log('  苦手:');
  for (const f of foes) console.log(`    ${(f.w * 100).toFixed(1)}%  ${show(field[f.j])}`);

  // ---- 3) 無作為な野良に対して ----
  const wild = Array.from({ length: 24 }, () => randomComp());
  const vsWild = await scoreAgainst(pool, [champ], wild, FAST ? 20 : 40);
  console.log(`無作為な編成24種に対して: ${(vsWild[0] * 100).toFixed(1)}%`);

  // ---- 4) 対抗手を探す。覇権編成だけを相手に山を登る ----
  console.log(`\n=== 対抗手の探索（覇権編成のみを相手に） ===`);
  const CN = FAST ? 24 : 48;
  let anti: { c: string[]; s: number }[] = [];
  {
    const seeds = [...field.filter((_, j) => j !== ci), ...Array.from({ length: 8 }, () => randomComp())];
    const sc = await scoreAgainst(pool, seeds, [champ], CN);
    anti = seeds.map((c, i) => ({ c, s: sc[i] })).sort((x, y) => y.s - x.s).slice(0, 10);
    for (let r = 0; r < (FAST ? 4 : 8); r++) {
      const seen = new Set(anti.map((x) => key(x.c)));
      const cands: string[][] = [];
      while (cands.length < (FAST ? 20 : 36)) {
        const c = mutate(pick(anti).c);
        const k2 = key(c);
        if (seen.has(k2)) continue;
        seen.add(k2);
        cands.push(c);
      }
      const s2 = await scoreAgainst(pool, cands, [champ], CN);
      anti = [...anti, ...cands.map((c, i) => ({ c, s: s2[i] }))]
        .sort((x, y) => y.s - x.s).slice(0, 10);
      console.log(`  周 ${r + 1}  首位 ${(anti[0].s * 100).toFixed(1)}%  ${show(anti[0].c)}`);
    }
  }
  // 上位は回数を増やして測り直す。少ない回数の首位は、噛み合いではなく運のことがある
  const reS = await scoreAgainst(pool, anti.map((x) => x.c), [champ], FAST ? 80 : 200);
  const re = anti.map((x, i) => ({ c: x.c, s: reS[i] })).sort((x, y) => y.s - x.s);
  console.log('  --- 測り直し ---');
  for (const x of re.slice(0, 6)) console.log(`  ${(x.s * 100).toFixed(1)}%  ${show(x.c)}`);

  // ---- 5) 1体ずつの効き目。対抗手の1枠を総当たりで入れ替える ----
  console.log(`\n=== 枠を1つ空けて、43体を順に入れてみる（相手は覇権編成）===`);
  const base = re[0].c;
  const swapAt = 0;
  const trials = IDS.filter((id) => !base.slice(1).includes(id)).map((id) => {
    const c = base.slice();
    c[swapAt] = id;
    return c;
  });
  const tS = await scoreAgainst(pool, trials, [champ], FAST ? 40 : 100);
  const tr = trials.map((c, i) => ({ id: c[swapAt], s: tS[i] })).sort((x, y) => y.s - x.s);
  console.log(`  土台 ${show(base.slice(1))} ＋ 1体`);
  for (const x of tr.slice(0, 12)) console.log(`    ${(x.s * 100).toFixed(1)}%  ${nameOf.get(x.id)}`);
  console.log('    …');
  for (const x of tr.slice(-4)) console.log(`    ${(x.s * 100).toFixed(1)}%  ${nameOf.get(x.id)}`);

  console.log(`\n(${((Date.now() - t0) / 1000).toFixed(0)} 秒)`);
  pool.close();

  console.log(`CHAMP=${champ.join(',')}`);
  console.log(`ANTI=${re[0].c.join(',')}`);
}

/*
 * 入口。クラス宣言より前では走らせない——class は巻き上がらないので、
 * 上で呼ぶと「Pool is not a constructor」で落ちる。
 */
if (!isMainThread) {
  parentPort!.on('message', (jobs: Job[]) => {
    parentPort!.postMessage(jobs.map((j) => duel(j.a, j.b, j.n, j.seed)));
  });
  void workerData;
} else {
  void main();
}
