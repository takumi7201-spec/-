/**
 * 試作: 2軸シナジー（属性＝出自、役職群＝職）で、編成に TFT らしい悩みが出るかを測る。
 *
 *   1. 無作為の編成で、特性がいくつ立つか
 *   2. 特性ごとの持ち上がり（同じ編成を無し／有りで、同じ相手・乱数に当てた差）
 *   3. 編成づくり: 山登りで「その環境の最善」を何本も探し、
 *      - 答えが何通りに割れるか（同じ所へ収束するなら悩みは無い）
 *      - 素の強さをどれだけ捨てて特性を取りにいくか
 *
 *   npm run tft -- [枠数=5] [規模=1]
 */
import { Worker, isMainThread, parentPort } from 'node:worker_threads';
import { fileURLToPath } from 'node:url';
import { BattleSim } from '../src/game/battle/simulate.ts';
import { REVOS } from '../src/game/data/revos.ts';
import type { TeamSetup, BattleRules } from '../src/game/battle/types.ts';

type Mode = 'off' | 'dual';
interface Job { a: string[]; b: string[]; seed: number; mode: Mode }

const TEAM = Number(process.argv[2] ?? 5);
const SCALE = Number(process.argv[3] ?? 1);
const REAL = REVOS.filter((r) => !r.id.startsWith('exp-'));
const CLASS: Record<string, string> = {
  Tank: 'front', Guardian: 'front', Breaker: 'brawler', Apex: 'brawler',
  Sprinter: 'swift', Striker: 'swift', Finisher: 'slayer', Technical: 'slayer',
  Healer: 'support', Buffer: 'support', Debuffer: 'hex', Special: 'hex',
};
const JA: Record<string, string> = {
  flame: '火', aqua: '水', terra: '土', gale: '風', null: '無',
  front: '前衛', brawler: '闘士', swift: '迅速', slayer: '仕留', support: '支援', hex: '妨害',
};
const byId = new Map(REVOS.map((r) => [r.id, r]));
const RULES: BattleRules = { synergy: 'dual', synergySteps: [3, 5], classSteps: [2, 4] };

function mkTeam(ids: string[], tag: string): TeamSetup {
  return {
    members: ids.map((id, i) => ({ uid: `${tag}${i}`, defId: id, level: 10, clean: 60, skillLevel: 1 })),
    order: ids.map((_, i) => i),
  };
}
function fight(j: Job): number {
  const sim = new BattleSim(j.seed, mkTeam(j.a, 'a'), mkTeam(j.b, 'b'), j.mode === 'off' ? {} : RULES);
  sim.runToEnd();
  return sim.result().winner;
}
if (!isMainThread) parentPort!.on('message', (jobs: Job[]) => parentPort!.postMessage(jobs.map(fight)));

class Pool {
  private ws: Worker[] = [];
  constructor(n: number) { for (let i = 0; i < n; i++) this.ws.push(new Worker(fileURLToPath(import.meta.url))); }
  async all(jobs: Job[]): Promise<number[]> {
    const k = this.ws.length, chunk = Math.ceil(jobs.length / k);
    return (await Promise.all(this.ws.map((w, i) => new Promise<number[]>((res) => {
      w.once('message', res); w.postMessage(jobs.slice(i * chunk, (i + 1) * chunk));
    })))).flat();
  }
  close(): void { for (const w of this.ws) void w.terminate(); }
}

let rs = 13579;
const rnd = (): number => { rs = (rs * 1664525 + 1013904223) >>> 0; return rs / 0x100000000; };
function randomComp(): string[] {
  const set = new Set<string>();
  while (set.size < TEAM) set.add(REAL[Math.floor(rnd() * REAL.length)].id);
  return [...set];
}

/** 立っている特性。'flame:1' のように段つきで返す */
function traits(ids: string[]): string[] {
  const el = new Map<string, number>(), cl = new Map<string, number>();
  for (const id of ids) {
    const d = byId.get(id)!;
    el.set(d.element, (el.get(d.element) ?? 0) + 1);
    cl.set(CLASS[d.role], (cl.get(CLASS[d.role]) ?? 0) + 1);
  }
  const out: string[] = [];
  for (const [k, n] of el) if (n >= 3) out.push(`${k}:${n >= 5 ? 2 : 1}`);
  for (const [k, n] of cl) if (n >= 2) out.push(`${k}:${n >= 4 ? 2 : 1}`);
  return out.sort();
}
const showT = (t: string[]): string => (t.length ? t.map((x) => `${JA[x.split(':')[0]]}${x.endsWith(':2') ? '²' : ''}`).join(' ') : '—');
const pct = (x: number): string => `${(x * 100).toFixed(1)}%`;

async function main(): Promise<void> {
  const pool = new Pool(4);
  const t0 = Date.now();
  console.log(`枠 ${TEAM}  属性の敷居 3/5  職の敷居 2/4`);

  const G = 40;
  const gaunt = Array.from({ length: G }, () => randomComp());
  /** 編成を相手の列に当てた勝率。同じ相手・同じ乱数で比べる */
  async function evalMany(comps: string[][], mode: Mode): Promise<number[]> {
    const js: Job[] = [];
    comps.forEach((c) => gaunt.forEach((g, gi) => js.push({ a: c, b: g, seed: 777 + gi * 7919, mode })));
    const ws = await pool.all(js);
    return comps.map((_, ci) => {
      let s = 0;
      for (let gi = 0; gi < G; gi++) { const w = ws[ci * G + gi]; s += w === 0 ? 1 : w === -1 ? 0.5 : 0; }
      return s / G;
    });
  }

  // ---- 1, 2 ----
  const K = Math.round(300 * SCALE);
  const comps = Array.from({ length: K }, () => randomComp());
  const off = await evalMany(comps, 'off');
  const on = await evalMany(comps, 'dual');
  console.log('\n=== 1. 無作為の編成で立つ特性の数 ===');
  const nh = new Map<number, number>();
  for (const c of comps) { const n = traits(c).length; nh.set(n, (nh.get(n) ?? 0) + 1); }
  console.log('  ' + [...nh.keys()].sort().map((n) => `${n}個 ${pct(nh.get(n)! / K)}`).join('  '));

  console.log('\n=== 2. 特性ごとの持ち上がり（その特性が立っている編成の、無し→有りの差の平均）===');
  const lift = new Map<string, number[]>();
  comps.forEach((c, i) => { for (const t of traits(c)) { (lift.get(t) ?? lift.set(t, []).get(t)!).push(on[i] - off[i]); } });
  const noneLift = comps.map((c, i) => (traits(c).length === 0 ? on[i] - off[i] : NaN)).filter((x) => !isNaN(x));
  console.log(`  特性なし  ${String(noneLift.length).padStart(4)}編成  ${(100 * noneLift.reduce((a, b) => a + b, 0) / Math.max(1, noneLift.length)).toFixed(1)}pt`);
  for (const [t, xs] of [...lift.entries()].sort()) {
    const m = xs.reduce((a, b) => a + b, 0) / xs.length;
    console.log(`  ${showT([t]).padEnd(5)}  ${String(xs.length).padStart(4)}編成  ${(m >= 0 ? '+' : '') + (m * 100).toFixed(1)}pt`);
  }

  // ---- 3. 山登り ----
  console.log('\n=== 3. 編成づくり（山登りで最善を探す）===');
  const R = Math.round(10 * SCALE), STEPS = Math.round(30 * SCALE), CAND = 8;
  for (const mode of ['off', 'dual'] as Mode[]) {
    const finals: { comp: string[]; score: number; raw: number }[] = [];
    for (let r = 0; r < R; r++) {
      let cur = randomComp();
      let best = (await evalMany([cur], mode))[0];
      for (let s = 0; s < STEPS; s++) {
        // 1枠を入れ替えた候補をまとめて測り、いちばん良いものへ動く
        const cands: string[][] = [];
        for (let k = 0; k < CAND; k++) {
          const c = [...cur];
          let id: string;
          do { id = REAL[Math.floor(rnd() * REAL.length)].id; } while (c.includes(id));
          c[Math.floor(rnd() * TEAM)] = id;
          cands.push(c);
        }
        const sc = await evalMany(cands, mode);
        const bi = sc.indexOf(Math.max(...sc));
        if (sc[bi] > best) { best = sc[bi]; cur = cands[bi]; }
      }
      finals.push({ comp: cur, score: best, raw: 0 });
    }
    const raws = await evalMany(finals.map((f) => f.comp), 'off');
    finals.forEach((f, i) => { f.raw = raws[i]; });
    finals.sort((a, b) => b.score - a.score);
    console.log(`\n  [${mode === 'off' ? 'シナジー無し' : '2軸シナジー'}]  ${R}本`);
    for (const f of finals) {
      const names = f.comp.map((id) => byId.get(id)!.name).join('・');
      console.log(`   ${pct(f.score).padStart(6)}  素 ${pct(f.raw).padStart(6)}  ${showT(traits(f.comp)).padEnd(14)} ${names}`);
    }
    const profiles = new Set(finals.map((f) => showT(traits(f.comp))));
    // 何体が答えの間で共通するか（同じユニットへ収束していないか）
    const freq = new Map<string, number>();
    for (const f of finals) for (const id of f.comp) freq.set(id, (freq.get(id) ?? 0) + 1);
    const core = [...freq.entries()].filter(([, n]) => n >= R * 0.6).map(([id]) => byId.get(id)!.name);
    console.log(`   特性の形 ${profiles.size}通り / ${R}本   6割以上の答えに居る個体: ${core.join('・') || 'なし'}   使われた個体 ${freq.size}/${REAL.length}`);
  }
  console.log(`\n  ${((Date.now() - t0) / 1000).toFixed(0)}秒`);
  pool.close();
}
if (isMainThread) void main();
