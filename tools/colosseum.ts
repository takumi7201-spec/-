/**
 * コロシアムのレートが落ち着く位置を測る。
 *
 * レートは「勝てば上がり負ければ下がる」だけの数字なので、強い編成が
 * どこで止まり、弱い編成がどこで止まるかが離れていないと意味がない。
 * 3つの編成で 400 戦ずつ回し、落ち着き先と勝率を見る。
 *   npm run colosseum
 */
import { BattleSim } from '../src/game/battle/simulate.ts';
import { buildRival, rateDelta, tierOf, defaultColosseum, COLOSSEUM_FLOOR } from '../src/game/data/colosseum.ts';
import { buildEngraving, ENGRAVE_PATTERNS } from '../src/game/engraving.ts';
import type { TeamSetup } from '../src/game/battle/types.ts';

interface Build { name: string; ids: string[]; level: number; clean: number; grade: number }

const BUILDS: Build[] = [
  {
    name: '初期の3体＋拾い物',
    ids: ['ankylosaurus', 'yutyrannus', 'shonisaurus', 'coelophysis', 'pikaia'],
    level: 20, clean: 62, grade: 0,
  },
  {
    name: '中盤の編成（★3中心・刻印2）',
    ids: ['stegosaurus', 'kronosaurus', 'maiasaura', 'carnotaurus', 'dimetrodon'],
    level: 20, clean: 80, grade: 2,
  },
  {
    name: '仕上がった編成（★4〜5・刻印4）',
    ids: ['tylosaurus', 'tyrannosaurus-sue', 'nipponites', 'smilodon', 'therizinosaurus'],
    level: 20, clean: 95, grade: 4,
  },
];

function setup(b: Build): TeamSetup {
  return {
    members: b.ids.map((defId, i) => ({
      uid: `me${i}`, defId, level: b.level, clean: b.clean, skillLevel: 3,
      engraving: b.grade > 0 ? buildEngraving(ENGRAVE_PATTERNS[i % ENGRAVE_PATTERNS.length], b.grade) : undefined,
    })),
    order: b.ids.map((_, i) => i),
  };
}

const N = Number(process.argv[2] ?? 400);

for (const b of BUILDS) {
  const st = defaultColosseum();
  const mine = setup(b);
  let wins = 0, draws = 0;
  const tail: number[] = [];
  for (let i = 0; i < N; i++) {
    const rival = buildRival(st, { level: b.level, clean: b.clean, size: 5 }, b.ids);
    const sim = new BattleSim(i * 7919 + 13, mine, rival.team);
    sim.runToEnd();
    const w = sim.result().winner;
    if (w === 0 || w === 1) {
      const won = w === 0;
      st.rate = Math.max(COLOSSEUM_FLOOR, st.rate + rateDelta(st.rate, rival.rate, won));
      st.best = Math.max(st.best, st.rate);
      if (won) { st.wins++; st.streak++; st.bestStreak = Math.max(st.bestStreak, st.streak); wins++; }
      else { st.losses++; st.streak = 0; }
    } else draws++;
    if (i >= N - 100) tail.push(st.rate);
  }
  const avg = Math.round(tail.reduce((a, x) => a + x, 0) / Math.max(1, tail.length));
  console.log(
    `${b.name.padEnd(22)} 落ち着き ${String(avg).padStart(4)}（最高 ${st.best}）`
    + `  勝率 ${(wins / N * 100).toFixed(1)}%  引分 ${draws}  階級 ${tierOf(avg).name}  最高連勝 ${st.bestStreak}`,
  );
  // 最後に組まれた相手。レートが上がったあと、何を連れてきているか
  const last = buildRival(st, { level: b.level, clean: b.clean, size: 5 }, b.ids);
  console.log(`   └ 最後の相手 ${last.team.members.map((m) => m.defId).join(' / ')}  — ${last.tactic}`);
}
