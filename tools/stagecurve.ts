/**
 * 30段の難度曲線。
 *
 * 固定表にしたので、測るべきは「ある段に、そこまで普通に進めてきた編成で
 * 挑んだとき勝てるか」。素の勝率だけ見ても意味がない——負けてもEXPは入り、
 * 掘れば手持ちが増えるので、プレイヤーは同じ段を何度か叩いて越える。
 *
 * なので実際の輪をそのまま回す：編成を組む → 段に挑む → 勝てば次の段、
 * 負ければEXPだけ貰って再挑戦。各段で「初挑戦の勝率」と「越えるまでの
 * 挑戦回数」を出す。壁は後者に出る。
 *   npm run stagecurve
 */
import { BattleSim } from '../src/game/battle/simulate.ts';
import { REVOS, getRevos } from '../src/game/data/revos.ts';
import { STAGES } from '../src/game/data/stages.ts';
import { buildEnemyTeam } from '../src/game/party.ts';
import { buildEngraving, ENGRAVE_PATTERNS } from '../src/game/engraving.ts';
import { expToNext } from '../src/core/Save.ts';
import type { TeamSetup } from '../src/game/battle/types.ts';
import { isWall, isBackliner } from '../src/game/battle/roles.ts';

function rngInt(s: { v: number }, n: number): number {
  s.v = (s.v * 1664525 + 1013904223) >>> 0;
  return Math.floor((s.v / 0x100000000) * n);
}

interface Unit { defId: string; level: number; exp: number; clean: number; skill: number; eng?: ReturnType<typeof buildEngraving> }

/** 掘って出てくる可能性のある種。許可区とイベント限定は外す */
const DIG_POOL = REVOS.filter((r) => !r.eventOnly && !r.permitOnly);

function addExp(u: Unit, amount: number): void {
  u.exp += amount;
  while (u.level < 30 && u.exp >= expToNext(u.level)) { u.exp -= expToNext(u.level); u.level++; }
  if (u.level >= 30) u.exp = 0;
}

/**
 * 出撃する5体。プレイヤーは「壁・火力・支援が1つずつ」を選ぶ程度の
 * 腕があると見る——適当に先頭5体にすると、測っているのが編成の下手さに
 * なってしまう。レベルの高い順に、役職が偏らないように採る
 */
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

function setup(units: Unit[]): TeamSetup {
  return {
    members: units.map((u, i) => ({
      uid: `me${i}`, defId: u.defId, level: u.level, clean: u.clean, skillLevel: u.skill, engraving: u.eng,
    })),
    order: units.map((_, i) => i),
  };
}

const TRIES = Number(process.argv[2] ?? 60);
const s = { v: 20260104 };

const roster: Unit[] = ['ankylosaurus', 'yutyrannus', 'shonisaurus'].map((defId) => ({
  defId, level: 3, exp: 0, clean: 62, skill: 1,
}));

/** 1段ぶん掘る。段が進むほど良い石が出る——削りの腕も上がっていく */
function dig(stage: number): void {
  const cap = stage < 3 ? 2 : stage < 6 ? 3 : stage < 10 ? 4 : 5;
  const pool = DIG_POOL.filter((r) => r.rarity <= cap);
  const def = pool[rngInt(s, pool.length)];
  const clean = Math.min(96, 60 + stage);
  const grade = stage >= 6 ? Math.max(1, Math.min(4, Math.floor(stage / 7) + 1)) : 0;

  /*
   * すでに持っている種が出たら重ねる（mergeFossil と同じ）。技レベルが
   * 上がり、クリーン度は高いほうを採る。
   *
   * 枠が埋まるまでは体を増やすほうを採る——出撃は5体なので、6体目から
   * 先は「同じ顔がもう1体」より「いま出している1体が重くなる」ほうが効く。
   * プレイヤーもそう選ぶ。
   */
  const dup = roster.find((u) => u.defId === def.id);
  if (dup && roster.length >= 6) {
    dup.skill = Math.min(5, dup.skill + 1);
    dup.clean = Math.max(dup.clean, clean);
    return;
  }

  roster.push({
    defId: def.id,
    level: Math.max(1, Math.round(roster.reduce((a, u) => a + u.level, 0) / roster.length) - 1),
    exp: 0,
    clean,
    skill: 1,
    eng: grade > 0 && rngInt(s, 100) < 45
      ? buildEngraving(ENGRAVE_PATTERNS[rngInt(s, ENGRAVE_PATTERNS.length)], grade)
      : undefined,
  });
}

console.log('段  名前              相手  Lv  初挑戦勝率  越えるまで  こちらLv  技Lv  手持ち  決着秒');
let totalTries = 0;

for (const st of STAGES) {
  // 段と段のあいだに掘る。前の段で手に入った石が、次の段の編成に乗る
  dig(st.n);
  if (st.n >= 10) dig(st.n);

  const foes = buildEnemyTeam(st.n);
  const party = pickParty(roster);
  const myLv = Math.round(party.reduce((a, u) => a + u.level, 0) / party.length);

  // 初挑戦の勝率。種を振って何度も試すが、編成とレベルは固定のまま
  let wins = 0, secs = 0;
  for (let i = 0; i < TRIES; i++) {
    const sim = new BattleSim(i * 7919 + st.n * 13 + 1, setup(party), foes);
    sim.runToEnd();
    const r = sim.result();
    if (r.winner === 0) wins++;
    secs += r.seconds;
  }
  const wr = wins / TRIES;

  // 越えるまで。負けてもEXPは入るので、叩くほどこちらが育つ
  let tries = 0;
  let cur = party;
  for (;;) {
    tries++;
    const sim = new BattleSim(tries * 104729 + st.n * 31, setup(cur), foes);
    sim.runToEnd();
    const won = sim.result().winner === 0;
    const maxLv = Math.max(...roster.map((u) => u.level), 1);
    for (const u of cur) addExp(u, Math.round((won ? 1800 : 680) * (u.level < maxLv - 2 ? 2 : 1)));
    if (won || tries >= 40) break;
    cur = pickParty(roster);
  }
  totalTries += tries;

  console.log(
    `${String(st.n).padStart(2)}  ${st.name.padEnd(12)}  ${String(foes.members.length).padStart(2)}体  ${String(st.level).padStart(2)}`
    + `  ${(wr * 100).toFixed(0).padStart(7)}%  ${String(tries).padStart(8)}回`
    + `  ${String(myLv).padStart(6)}  ${(party.reduce((a, u) => a + u.skill, 0) / party.length).toFixed(1).padStart(4)}`
    + `  ${String(roster.length).padStart(4)}体  ${(secs / TRIES).toFixed(0).padStart(5)}s`,
  );
}
console.log(`\n総挑戦回数 ${totalTries}（30段を越えるまで）`);
void isBackliner;
