/**
 * 30段のレベル・クリーン度を、目標の勝率に合わせて探す。
 *
 * 顔ぶれは stages.ts の設計のまま触らない。動かすのはレベル（粗い刻み、
 * 1段で全ステータス +5.5%）とクリーン度（細かい刻み、45〜95 で ±12%）。
 *
 * 比べる相手は「その段まで普通に進めてきた編成」。難度に依らず決まる必要が
 * あるので、1段あたり 1.6戦ぶんのEXPと1〜2体の加入を積む模型で作る——
 * 段ごとの勝率で育ち方が変わると、測るたびに基準が動いてしまう。
 *   npm run stagetune
 */
import { BattleSim } from '../src/game/battle/simulate.ts';
import { REVOS, getRevos } from '../src/game/data/revos.ts';
import { STAGES, stageEngravePattern } from '../src/game/data/stages.ts';
import { buildEngraving, ENGRAVE_PATTERNS } from '../src/game/engraving.ts';
import { expToNext } from '../src/core/Save.ts';
import type { TeamSetup } from '../src/game/battle/types.ts';
import { isWall } from '../src/game/battle/roles.ts';

function rngInt(s: { v: number }, n: number): number {
  s.v = (s.v * 1664525 + 1013904223) >>> 0;
  return Math.floor((s.v / 0x100000000) * n);
}

interface Unit { defId: string; level: number; exp: number; clean: number; eng?: ReturnType<typeof buildEngraving> }
const DIG_POOL = REVOS.filter((r) => !r.eventOnly && !r.permitOnly);

function addExp(u: Unit, amount: number): void {
  u.exp += amount;
  while (u.level < 30 && u.exp >= expToNext(u.level)) { u.exp -= expToNext(u.level); u.level++; }
  if (u.level >= 30) u.exp = 0;
}

function pickParty(roster: Unit[]): Unit[] {
  const score = (u: Unit): number => u.level * 100 + getRevos(u.defId).rarity * 10 + u.clean / 10;
  const sorted = [...roster].sort((a, b) => score(b) - score(a));
  const out: Unit[] = [];
  const take = (pred: (u: Unit) => boolean): void => {
    const u = sorted.find((x) => !out.includes(x) && pred(x));
    if (u) out.push(u);
  };
  take((u) => isWall(getRevos(u.defId).role));
  take((u) => getRevos(u.defId).role === 'Healer' || getRevos(u.defId).role === 'Buffer');
  for (const u of sorted) { if (out.length >= 5) break; if (!out.includes(u)) out.push(u); }
  return out.slice(0, 5);
}

function mine(units: Unit[]): TeamSetup {
  return {
    members: units.map((u, i) => ({
      uid: `me${i}`, defId: u.defId, level: u.level, clean: u.clean, skillLevel: 1, engraving: u.eng,
    })),
    order: units.map((_, i) => i),
  };
}

function foeTeam(n: number, power: number): TeamSetup {
  const st = STAGES[n - 1];
  return {
    members: st.foes.map((defId, i) => ({
      uid: `foe${i}`, defId, level: st.level, clean: st.clean, skillLevel: 1,
      boost: { hp: power, atk: power, def: power },
      engraving: st.grade > 0
        ? buildEngraving(
          ENGRAVE_PATTERNS.find((p) => p.id === stageEngravePattern(defId)) ?? ENGRAVE_PATTERNS[0],
          st.grade,
        )
        : undefined,
    })),
    order: st.foes.map((_, i) => i),
  };
}

/**
 * 目標の勝率。
 *
 * 5対5の削り合いは、差が出た瞬間から雪だるま式に開く——1体落ちれば
 * こちらの火力も1体ぶん減るので、素の差 16% が勝率の 90% 差になる。
 * つまり勝率は段差に対してほぼ階段で、レベルが1違うだけで総崩れになる。
 *
 * なので目標を「五分」に置いてはいけない。普通に進めてきた編成なら
 * 8割前後で勝てる高さに置き、段が上がる手応えは勝率ではなく
 * 決着までの長さと、掘って育て続けないと置いていかれる速さで出す。
 * 1〜2レベル足りない編成は、ここで初めて落ちる。
 */
function target(n: number): number {
  if (n <= 6) return 0.95;
  if (n <= 12) return 0.9;
  if (n <= 18) return 0.82;
  if (n <= 24) return 0.74;
  if (n <= 29) return 0.66;
  return 0.5;
}

const N = Number(process.argv[2] ?? 30);
const s = { v: 20260104 };

const roster: Unit[] = ['ankylosaurus', 'yutyrannus', 'shonisaurus'].map((defId) => ({
  defId, level: 3, exp: 0, clean: 62,
}));

function dig(stage: number): void {
  const cap = stage < 3 ? 2 : stage < 6 ? 3 : stage < 10 ? 4 : 5;
  const pool = DIG_POOL.filter((r) => r.rarity <= cap);
  const def = pool[rngInt(s, pool.length)];
  const grade = stage >= 6 ? Math.max(1, Math.min(4, Math.floor(stage / 7) + 1)) : 0;
  roster.push({
    defId: def.id,
    level: Math.max(1, Math.round(roster.reduce((a, u) => a + u.level, 0) / roster.length) - 1),
    exp: 0,
    clean: Math.min(96, 60 + stage),
    eng: grade > 0 && rngInt(s, 100) < 45
      ? buildEngraving(ENGRAVE_PATTERNS[rngInt(s, ENGRAVE_PATTERNS.length)], grade)
      : undefined,
  });
}

/**
 * その段の手応え。
 *
 * 1つの編成だけで測ると、測った値がその編成のレベルに貼り付く——
 * ±1レベルで勝率が 40pt 動くので、少し遅れている編成・少し進んでいる
 * 編成も混ぜて平均する。段の値は「このくらいの編成なら」に対して決める
 */
const OFFSETS = [-1, 0, 1];

function winRate(n: number, power: number, party: Unit[]): { wr: number; secs: number } {
  const foes = foeTeam(n, power);
  let wins = 0, secs = 0, runs = 0;
  for (const off of OFFSETS) {
    const shifted = party.map((u) => ({ ...u, level: Math.max(1, Math.min(30, u.level + off)) }));
    for (let i = 0; i < N; i++) {
      const sim = new BattleSim(i * 7919 + n * 13 + 1 + off * 997, mine(shifted), foes);
      sim.runToEnd();
      const r = sim.result();
      if (r.winner === 0) wins++;
      secs += r.seconds;
      runs++;
    }
  }
  return { wr: wins / runs, secs: secs / runs };
}

const out: { n: number; power: number; wr: number; secs: number; myLv: number }[] = [];

for (const st of STAGES) {
  dig(st.n);
  if (st.n >= 10) dig(st.n);

  const party = pickParty(roster);
  const myLv = Math.round(party.reduce((a, u) => a + u.level, 0) / party.length);
  const want = target(st.n);

  /*
   * 倍率を二分で詰める。勝率は倍率に対して単調に下がるので、
   * 範囲を 0.45〜2.2 に取って 7 回割れば刻みは 0.014——
   * 1戦の勝率の揺れ（標本 N でおよそ ±5pt）より細かい
   */
  // 上は 1.15 で止める。相手を素の性能より大きく盛るのは最初の数段だけで、
  // そこは「ほぼ必ず勝てる」のが正しい——届かない目標は切り上げる
  let lo = 0.55, hi = 1.15, mid = 1, got = { wr: 0, secs: 0 };
  for (let i = 0; i < 7; i++) {
    mid = (lo + hi) / 2;
    const r = winRate(st.n, mid, party);
    if (r.wr >= want) lo = mid; else hi = mid;
    got = r;
  }
  const power = Math.round(((lo + hi) / 2) * 100) / 100;
  const fin = winRate(st.n, power, party);
  out.push({ n: st.n, power, wr: fin.wr, secs: fin.secs, myLv });
  void got;

  /*
   * 次の段へ進むぶんのEXP。固定の数を渡すのではなく、実際に戦って稼ぐ——
   * 1段あたりに貰える量は、その段を何度叩いたかで決まる。段を素通りできる
   * 編成とできない編成で育ち方が変わるので、ここを固定にすると
   * 「少し足りない編成」の手応えが測れない
   */
  const foes = foeTeam(st.n, power);
  const maxLv = Math.max(...roster.map((u) => u.level), 1);
  for (let t = 1; t <= 6; t++) {
    const sim = new BattleSim(t * 104729 + st.n * 31, mine(party), foes);
    sim.runToEnd();
    const won = sim.result().winner === 0;
    for (const u of party) addExp(u, Math.round((won ? 1800 : 680) * (u.level < maxLv - 2 ? 2 : 1)));
    if (won) break;
  }

  console.log(
    `${String(st.n).padStart(2)}  ${st.name.padEnd(12)}  Lv${String(st.level).padStart(2)} 倍率${power.toFixed(2)}`
    + `  目標${(want * 100).toFixed(0).padStart(3)}% → 実測${(fin.wr * 100).toFixed(0).padStart(3)}%`
    + `  こちらLv${String(myLv).padStart(2)}  ${fin.secs.toFixed(0).padStart(4)}s`,
  );
}

console.log('\n// stages.ts に貼る値');
console.log(out.map((o) => `${o.n}:${o.power.toFixed(2)}`).join(' '));
