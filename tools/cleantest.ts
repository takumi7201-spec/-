/**
 * 削りの当たり判定と、骨の傷み方を測る。
 *
 * 画面を立てずに、母岩へ道具を当てる所だけを再現する。CleanScene の
 * carve() は three.js の中に埋まっていて node からは呼べないので、同じ
 * 規則をここに書き起こす——写しなので、片方だけ直すとずれる。ずれたら
 * 困るのは「骨に当て続けたとき何秒で化石が終わるか」なので、そこを
 * 数字で押さえておく。
 *
 *   npm run cleantest
 */
import { buildFossilBlock, cleanCap, scoreClean, F, SIZE } from '../src/game/FossilBlock.ts';
import { TOOLS, type ToolSpec } from '../src/scenes/CleanScene.ts';
import { REVOS } from '../src/game/data/revos.ts';
import type { VoxelGrid } from '../src/voxel/VoxelGrid.ts';

const MAX_HIT_SCAR = 6;

/** 露出しているか（ブラシが見る条件の写し） */
function isExposed(g: VoxelGrid, x: number, y: number, z: number): boolean {
  return g.get(x + 1, y, z) === F.EMPTY || g.get(x - 1, y, z) === F.EMPTY
    || g.get(x, y + 1, z) === F.EMPTY || g.get(x, y - 1, z) === F.EMPTY
    || g.get(x, y, z + 1) === F.EMPTY || g.get(x, y, z - 1) === F.EMPTY;
}

interface CarveResult { removed: number; scarred: number }

/** CleanScene.carve の写し。1回ぶんの接触 */
function carve(g: VoxelGrid, cx: number, cy: number, cz: number, spec: ToolSpec): CarveResult {
  const r = Math.ceil(spec.radius);
  const boneR = spec.boneRadius ?? spec.radius;
  let removed = 0;
  let boneHit = 0;
  for (let dz = -r; dz <= r; dz++)
    for (let dy = -r; dy <= r; dy++)
      for (let dx = -r; dx <= r; dx++) {
        const d = Math.hypot(dx, dy, dz);
        if (d > spec.radius) continue;
        const x = cx + dx, y = cy + dy, z = cz + dz;
        const v = g.get(x, y, z);
        if (v === F.EMPTY || v === F.SCAR) continue;
        if (v === F.BONE) {
          if (spec.bonePenalty > 0 && d <= boneR) { g.set(x, y, z, F.SCAR); boneHit++; }
          continue;
        }
        if (v === F.HARD && !spec.breaksHard) continue;
        if (spec.surfaceOnly && !isExposed(g, x, y, z)) continue;
        g.set(x, y, z, F.EMPTY);
        removed++;
      }
  return { removed, scarred: boneHit > 0 ? Math.min(MAX_HIT_SCAR, boneHit) * spec.bonePenalty : 0 };
}

/** 骨のまん中。道具を押し当てる場所として、いちばん分の悪い点を選ぶ */
function boneCentre(g: VoxelGrid): [number, number, number] {
  let sx = 0, sy = 0, sz = 0, n = 0;
  for (let z = 0; z < SIZE.z; z++)
    for (let y = 0; y < SIZE.y; y++)
      for (let x = 0; x < SIZE.x; x++)
        if (g.get(x, y, z) === F.BONE) { sx += x; sy += y; sz += z; n++; }
  return n === 0 ? [8, 8, 3] : [Math.round(sx / n), Math.round(sy / n), Math.round(sz / n)];
}

let failed = 0;
function expect(label: string, ok: boolean, detail: string): void {
  console.log(`  ${ok ? '○' : '×'} ${label.padEnd(34 - label.length)}${label}  ${detail}`);
  if (!ok) failed++;
}

const SPECIES = ['yutyrannus', 'tylosaurus', 'jobaria', 'pikaia', 'ankylosaurus'];

console.log('\n=== 骨の上で止めたまま当てたとき（1秒）===');
for (const id of SPECIES) {
  const def = REVOS.find((r) => r.id === id)!;
  const blk = buildFossilBlock(id, def.rarity, 4242);
  const [cx, cy, cz] = boneCentre(blk.grid);
  const spec = TOOLS.drill;
  let scar = 0;
  for (let i = 0; i < spec.rate; i++) scar += carve(blk.grid, cx, cy, cz, spec).scarred;
  const cap = cleanCap(Math.min(1, scar / Math.max(1, blk.boneTotal)));
  expect(`${def.name} 止めて1秒`, cap >= 90,
    `骨 ${String(blk.boneTotal).padStart(3)}  傷 ${scar.toFixed(1).padStart(5)}  上限 ${String(cap).padStart(3)}`);
}

/*
 * なぞって当てたとき。
 *
 * 止めたままだと、一度傷にした骨は SCAR になって二度は数えられない——
 * 指を置きっぱなしにする試験では、いくらでも甘い数字が出る。実際に
 * 痛いのは骨の上を滑らせたときなので、1粒ずつずらしながら当てる。
 */
console.log('\n=== 骨の上をなぞったとき（1秒）===');
for (const id of SPECIES) {
  const def = REVOS.find((r) => r.id === id)!;
  const blk = buildFossilBlock(id, def.rarity, 4242);
  const [cx, cy, cz] = boneCentre(blk.grid);
  const spec = TOOLS.drill;
  let scar = 0;
  for (let i = 0; i < spec.rate; i++) {
    // 骨の面を横へ滑らせる。端まで行ったら1段下げて折り返す
    const x = cx - 5 + (i % 11);
    const y = cy - 1 + Math.floor(i / 11);
    scar += carve(blk.grid, x, y, cz, spec).scarred;
  }
  const cap = cleanCap(Math.min(1, scar / Math.max(1, blk.boneTotal)));
  // 軽い滑りは安く。1秒なぞっても 5点以内
  expect(`${def.name} なぞって1秒`, cap >= 95,
    `骨 ${String(blk.boneTotal).padStart(3)}  傷 ${scar.toFixed(1).padStart(5)}  上限 ${String(cap).padStart(3)}`);
}

/*
 * 擦り続けたとき。
 *
 * 狙いは「軽い滑りは安く、擦り続ければ痛い。ただし化石は潰れない」。
 * 1秒で 3〜4点、3秒で 10点強。失敗した回の仕上がりは落ちるが、
 * 重ねて直せる範囲に残る——直す前は、1秒当てただけで上限が 0 だった。
 */
console.log('\n=== 骨の上を3秒なぞり続けたとき ===');
for (const id of SPECIES.slice(0, 3)) {
  const def = REVOS.find((r) => r.id === id)!;
  const blk = buildFossilBlock(id, def.rarity, 4242);
  const [cx, cy, cz] = boneCentre(blk.grid);
  const spec = TOOLS.drill;
  let scar = 0;
  for (let i = 0; i < spec.rate * 3; i++) {
    const x = cx - 5 + (i % 11);
    const y = cy - 3 + Math.floor(i / 11) % 7;
    scar += carve(blk.grid, x, y, cz, spec).scarred;
  }
  const cap = cleanCap(Math.min(1, scar / Math.max(1, blk.boneTotal)));
  // ただで済ませない（8点以上は失う）が、化石は潰さない（60は残す）
  expect(`${def.name} なぞって3秒`, cap <= 92 && cap >= 60,
    `骨 ${String(blk.boneTotal).padStart(3)}  傷 ${scar.toFixed(1).padStart(5)}  上限 ${String(cap).padStart(3)}`);
}

console.log('\n=== 道具ごとの、1回の接触で入る傷 ===');
{
  const blk = buildFossilBlock('tylosaurus', 5, 99);
  const [cx, cy, cz] = boneCentre(blk.grid);
  for (const id of ['pick', 'drill', 'brush'] as const) {
    const g = buildFossilBlock('tylosaurus', 5, 99).grid;
    const { scarred } = carve(g, cx, cy, cz, TOOLS[id]);
    const limit = id === 'brush' ? 0.001 : id === 'drill' ? 3.1 : 6.1;
    expect(`${TOOLS[id].name} 1回`, scarred <= limit, `傷 ${scarred.toFixed(1)}（上限 ${limit}）`);
  }
  void blk;
}

console.log('\n=== 骨の脇に添えたとき（先端が骨に入らない位置）===');
for (const id of SPECIES.slice(0, 3)) {
  const def = REVOS.find((r) => r.id === id)!;
  const blk = buildFossilBlock(id, def.rarity, 4242);
  const [cx, cy, cz] = boneCentre(blk.grid);
  // 先端半径 0.9 の外、球の半径 1.5 の内。かすめても傷にならないこと
  const spec = TOOLS.drill;
  let scar = 0;
  for (let i = 0; i < spec.rate; i++) scar += carve(blk.grid, cx, cy, cz + 2, spec).scarred;
  expect(`${def.name} 2粒ずらして1秒`, scar === 0, `傷 ${scar.toFixed(1)}`);
}

console.log('\n=== 丁寧に削り切ったとき ===');
for (const id of SPECIES) {
  const def = REVOS.find((r) => r.id === id)!;
  const blk = buildFossilBlock(id, def.rarity, 4242);
  // 手前の岩だけを、骨に触れずに退ける
  let n = 0;
  for (let i = 0; i < blk.cover.length; i++) {
    if (blk.cover[i] !== 1) continue;
    const x = i % SIZE.x, y = Math.floor(i / SIZE.x) % SIZE.y, z = Math.floor(i / (SIZE.x * SIZE.y));
    blk.grid.set(x, y, z, F.EMPTY);
    n++;
  }
  const limit = Math.round(24 + blk.coverTotal * 0.16);
  const s = scoreClean(n, blk.coverTotal, limit * 0.5, limit, 0);
  expect(`${def.name} 無傷で完了`, s.clean === 100,
    `手前の岩 ${String(blk.coverTotal).padStart(3)}  持ち時間 ${String(limit).padStart(3)}秒  → ${s.clean}（${s.rank}）`);
}

console.log('\n=== 傷の割合と上限 ===');
for (const [ratio, want] of [[0, 100], [0.05, 94], [0.1, 88], [0.25, 70], [0.5, 40], [0.84, 0]] as const) {
  expect(`${(ratio * 100).toFixed(0)}% 傷`, cleanCap(ratio) === want, `上限 ${cleanCap(ratio)}（想定 ${want}）`);
}

console.log(failed === 0 ? '\nすべて通った\n' : `\n${failed} 件が外れた\n`);
process.exit(failed === 0 ? 0 : 1);
