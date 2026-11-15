/**
 * 試作: 2軸シナジー（属性＝出自、役職群＝職）で、編成に TFT らしい悩みが出るかを測る。
 *
 *   1. 無作為の編成で、特性がいくつ立つか
 *   2. 特性ごとの伸び。その特性を段ちょうどに揃えた編成を作り、
 *      「その特性だけ有効」と「無し」を同じ相手・乱数で比べる（他の特性は混ぜない）
 *   3. 編成づくり: 山登りで「その環境の最善」を何本も探す。
 *      相手は無作為ではなく、先に選り抜いた強い編成の列——無作為が相手だと
 *      7枠では誰もが 100% に張り付いて、差が見えなかった。
 *
 *   npm run tft -- [枠数=5] [規模=1] [職の敷居=2,4] [lift で 2 まで]
 */
import { Worker, isMainThread, parentPort } from 'node:worker_threads';
import { fileURLToPath } from 'node:url';
import { BattleSim, KIT_TRAIT, kitSteps } from '../src/game/battle/simulate.ts';
import { REVOS } from '../src/game/data/revos.ts';
import type { TeamSetup, BattleRules } from '../src/game/battle/types.ts';

interface Job { a: string[]; b: string[]; seed: number; rules: BattleRules | null }

const TEAM = Number(process.argv[2] ?? 5);
const SCALE = Number(process.argv[3] ?? 1);
/** 2本目の軸。'kit' なら効果特性、それ以外は職（敷居を '2,4' の形で） */
const KIT = process.argv[4] === 'kit';
const CSTEPS = (KIT ? '2,4' : (process.argv[4] ?? '2,4')).split(',').map(Number) as [number, number];
const ESTEPS: [number, number] = [3, 5];
const REAL = REVOS.filter((r) => !r.id.startsWith('exp-'));
const CLASS: Record<string, string> = {
  Tank: 'front', Guardian: 'front', Breaker: 'brawler', Apex: 'brawler', 'All-round': 'brawler',
  Sprinter: 'swift', Striker: 'swift', Finisher: 'slayer', Technical: 'slayer',
  Healer: 'support', Buffer: 'support', Debuffer: 'hex', Special: 'hex',
};
const ELEMENTS = ['flame', 'aqua', 'terra', 'gale', 'null'];
const CLASSES = KIT ? [...new Set(Object.values(KIT_TRAIT))] : ['front', 'brawler', 'swift', 'slayer', 'support', 'hex'];
const second = (id: string): string => (KIT ? KIT_TRAIT[id] ?? '' : CLASS[byId.get(id)!.role]);
const steps2 = (k: string): [number, number] => (KIT ? kitSteps(k) : CSTEPS);
const JA: Record<string, string> = {
  flame: '火', aqua: '水', terra: '土', gale: '風', null: '無',
  burn: '灼熱', venom: '蝕毒', weaken: '弱体', guard: '守護', mend: '癒し', echo: '共鳴', rush: '疾風', hunt: '狩猟', pack: '群れ', might: '剛力',
  front: '前衛', brawler: '闘士', swift: '迅速', slayer: '仕留', support: '支援', hex: '妨害',
};
const byId = new Map(REVOS.map((r) => [r.id, r]));
/** 数の多い属性（土・水は11体）は敷居を上げる。`BIG=4,5` で指定、`BIG=` で無効 */
const BIG = (process.env.BIG ?? '4,5').split(',').map(Number) as [number, number];
const ELEMENT_STEPS: Record<string, [number, number]> = {};
if (process.env.BIG !== '') for (const e of ELEMENTS) if (REAL.filter((r) => r.element === e).length >= 10) ELEMENT_STEPS[e] = BIG;
const DUAL: BattleRules = { synergy: KIT ? 'kit' : 'dual', synergySteps: ESTEPS, classSteps: CSTEPS, elementSteps: ELEMENT_STEPS };
const esteps = (e: string): [number, number] => ELEMENT_STEPS[e] ?? ESTEPS;
const keyOf = (id: string, t: string): string => (ELEMENTS.includes(t) ? byId.get(id)!.element : second(id));

function mkTeam(ids: string[], tag: string): TeamSetup {
  return {
    members: ids.map((id, i) => ({ uid: `${tag}${i}`, defId: id, level: 10, clean: 60, skillLevel: 1 })),
    order: ids.map((_, i) => i),
  };
}
function fight(j: Job): number {
  const sim = new BattleSim(j.seed, mkTeam(j.a, 'a'), mkTeam(j.b, 'b'), j.rules ?? {});
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
/** 特性 t を持つ者を n 体入れ、残りは無作為 */
function seededComp(t: string, n: number): string[] {
  const own = REAL.filter((r) => keyOf(r.id, t) === t);
  const set = new Set<string>();
  while (set.size < Math.min(n, own.length)) set.add(own[Math.floor(rnd() * own.length)].id);
  while (set.size < TEAM) set.add(REAL[Math.floor(rnd() * REAL.length)].id);
  return [...set];
}
/** 立っている特性。'flame:1' のように段つきで返す */
function traits(ids: string[]): string[] {
  const el = new Map<string, number>(), cl = new Map<string, number>();
  for (const id of ids) {
    const d = byId.get(id)!;
    el.set(d.element, (el.get(d.element) ?? 0) + 1);
    const k2 = second(id);
    if (k2) cl.set(k2, (cl.get(k2) ?? 0) + 1);
  }
  const out: string[] = [];
  for (const [k, n] of el) { const st = esteps(k); if (n >= st[0]) out.push(`${k}:${n >= st[1] ? 2 : 1}`); }
  for (const [k, n] of cl) { const st = steps2(k); if (n >= st[0]) out.push(`${k}:${n >= st[1] ? 2 : 1}`); }
  return out.sort();
}
const showT = (t: string[]): string => (t.length ? t.map((x) => `${JA[x.split(':')[0]]}${x.endsWith(':2') ? '²' : ''}`).join(' ') : '—');
const pct = (x: number): string => `${(x * 100).toFixed(1)}%`;
const pt = (x: number): string => `${x >= 0 ? '+' : ''}${(x * 100).toFixed(1)}`;

async function main(): Promise<void> {
  const pool = new Pool(4);
  const t0 = Date.now();
  console.log(`枠 ${TEAM}  属性の敷居 ${ESTEPS.join('/')}（${Object.keys(ELEMENT_STEPS).map((e) => JA[e]).join('・') || 'なし'}は ${BIG.join('/')}）  2本目 ${KIT ? '効果特性（4体以上の特性は 2/4、他は 2/3）' : `職 ${CSTEPS.join('/')}`}`);

  async function evalVs(comps: string[][], gaunt: string[][], rules: BattleRules | null, seed0 = 777): Promise<number[]> {
    const js: Job[] = [];
    comps.forEach((c) => gaunt.forEach((g, gi) => js.push({ a: c, b: g, seed: seed0 + gi * 7919, rules })));
    const ws = await pool.all(js);
    const G = gaunt.length;
    return comps.map((_, ci) => {
      let s = 0;
      for (let gi = 0; gi < G; gi++) { const w = ws[ci * G + gi]; s += w === 0 ? 1 : w === -1 ? 0.5 : 0; }
      return s / G;
    });
  }
  const randGaunt = Array.from({ length: 40 }, () => randomComp());

  console.log('\n=== 1. 無作為の編成で立つ特性の数 ===');
  {
    const nh = new Map<number, number>();
    const K = 2000;
    for (let i = 0; i < K; i++) { const n = traits(randomComp()).length; nh.set(n, (nh.get(n) ?? 0) + 1); }
    console.log('  ' + [...nh.keys()].sort().map((n) => `${n}個 ${pct(nh.get(n)! / K)}`).join('  '));
  }

  console.log('\n=== 2. 特性ごとの伸び（その特性だけ有効 − 無し。相手は無作為）===');
  console.log('  目安: 1段目 +3〜6pt、2段目 +10〜15pt');
  const M = Math.round(60 * SCALE);
  const line: string[] = [];
  for (const t of [...ELEMENTS, ...CLASSES]) {
    const steps = ELEMENTS.includes(t) ? esteps(t) : steps2(t);
    const cells: string[] = [];
    for (const [tier, n] of [[1, steps[0]], [2, steps[1]]] as const) {
      if (n > TEAM) { cells.push('   —  '); continue; }
      const comps = Array.from({ length: M }, () => seededComp(t, n));
      const only: BattleRules = { ...DUAL, synergyOnly: [t] };
      const g = randGaunt.slice(0, 20);
      // 同じ worker を取り合うので、並べずに順に回す
      const on = await evalVs(comps, g, only, 31);
      const off = await evalVs(comps, g, null, 31);
      const d = on.reduce((a, b) => a + b, 0) / M - off.reduce((a, b) => a + b, 0) / M;
      cells.push(`${pt(d).padStart(6)}${tier === 2 && (d < 0.08 || d > 0.18) ? '!' : tier === 1 && (d < 0.02 || d > 0.08) ? '!' : ' '}`);
    }
    line.push(`  ${JA[t].padEnd(3)}  1段 ${cells[0]}  2段 ${cells[1]}`);
  }
  console.log(line.join('\n'));

  if (process.argv[5] === 'lift') { pool.close(); return; }
  // ---- 3. 山登り ----
  console.log('\n=== 3. 編成づくり（強い編成の列を相手に、山登りで最善を探す）===');
  const R = Math.round(10 * SCALE), STEPS = Math.round(30 * SCALE), CAND = 8;
  for (const rules of [null, DUAL]) {
    // 相手の列: 無作為 240 編成をその環境で測り、上位 24 + 無作為 16
    const pool0 = Array.from({ length: 240 }, () => randomComp());
    const sc0 = await evalVs(pool0, randGaunt.slice(0, 24), rules, 4001);
    const top = pool0.map((c, i) => [c, sc0[i]] as const).sort((a, b) => b[1] - a[1]).slice(0, 24).map(([c]) => c);
    const gaunt = [...top, ...randGaunt.slice(24, 40)];

    const finals: { comp: string[]; score: number; raw: number }[] = [];
    for (let r = 0; r < R; r++) {
      let cur = randomComp();
      let best = (await evalVs([cur], gaunt, rules))[0];
      for (let s = 0; s < STEPS; s++) {
        const cands: string[][] = [];
        for (let k = 0; k < CAND; k++) {
          const c = [...cur];
          let id: string;
          do { id = REAL[Math.floor(rnd() * REAL.length)].id; } while (c.includes(id));
          c[Math.floor(rnd() * TEAM)] = id;
          cands.push(c);
        }
        const sc = await evalVs(cands, gaunt, rules);
        const bi = sc.indexOf(Math.max(...sc));
        if (sc[bi] > best) { best = sc[bi]; cur = cands[bi]; }
      }
      finals.push({ comp: cur, score: best, raw: 0 });
    }
    // 「素」: 同じ相手の列に、シナジー抜きで当てた勝率
    const raws = await evalVs(finals.map((f) => f.comp), gaunt, null);
    finals.forEach((f, i) => { f.raw = raws[i]; });
    finals.sort((a, b) => b.score - a.score);
    console.log(`\n  [${rules ? '2軸シナジー' : 'シナジー無し'}]  ${R}本`);
    for (const f of finals) {
      const names = f.comp.map((id) => byId.get(id)!.name).join('・');
      console.log(`   ${pct(f.score).padStart(6)}  素 ${pct(f.raw).padStart(6)}  ${showT(traits(f.comp)).padEnd(16)} ${names}`);
    }
    const profiles = new Set(finals.map((f) => showT(traits(f.comp))));
    const freq = new Map<string, number>();
    for (const f of finals) for (const id of f.comp) freq.set(id, (freq.get(id) ?? 0) + 1);
    const core = [...freq.entries()].filter(([, n]) => n >= R * 0.6).map(([id]) => byId.get(id)!.name);
    const tf = new Map<string, number>();
    for (const f of finals) for (const t of traits(f.comp)) { const k = t.split(':')[0]; tf.set(k, (tf.get(k) ?? 0) + 1); }
    console.log(`   特性の形 ${profiles.size}通り / ${R}本   6割以上に居る個体: ${core.join('・') || 'なし'}   使われた個体 ${freq.size}/${REAL.length}`);
    console.log(`   特性の出現: ${[...tf.entries()].sort((a, b) => b[1] - a[1]).map(([k, n]) => `${JA[k]}${n}`).join(' ')}`);
  }
  console.log(`\n  ${((Date.now() - t0) / 1000).toFixed(0)}秒`);
  pool.close();
}
if (isMainThread) void main();
