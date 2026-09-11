import * as THREE from 'three';
import { VoxelGrid } from './VoxelGrid';
import { VoxelPainter } from './VoxelPainter';
import { greedyMesh } from './greedyMesher';
import { buildPalette } from './palette';

/**
 * プレイヤー（発掘者）のボクセルモデル。
 *
 * パーツを別メッシュに分けてGroup階層でリグを組む。スキニングを使わない
 * ことで、ボクセルらしいカクついた関節がむしろ持ち味になる上に、
 * 頂点シェーダーもボーンテクスチャも不要で軽い。
 */

const S = {
  EMPTY: 0,
  SKIN: 1,
  HAIR: 2,
  SHIRT: 3,
  SHIRT_D: 4,
  PANTS: 5,
  BOOT: 6,
  HAT: 7,
  GOGGLE: 8,
  METAL: 9,
  PACK: 10,
  ACCENT: 11,
  EYE: 12,
} as const;

const CHAR_PALETTE = buildPalette([
  0x000000,
  0xe8bc94, 0x4a3327, 0x3f7d8c, 0x2f5e6b,
  0x6b5a45, 0x3a2b20, 0xd9a441, 0x8ce8ff,
  0xb8bcc4, 0x7a5a3c, 0xff9c3c, 0x1a1a1a,
]);

export interface CharacterRig {
  root: THREE.Group;
  hips: THREE.Group;
  torso: THREE.Group;
  head: THREE.Group;
  armL: THREE.Group;
  armR: THREE.Group;
  legL: THREE.Group;
  legR: THREE.Group;
  toolAnchor: THREE.Object3D;
  height: number;
}

const VOX = 0.055;

function meshFromGrid(
  grid: VoxelGrid,
  material: THREE.Material,
  origin: [number, number, number],
): THREE.Mesh {
  const data = greedyMesh(grid, CHAR_PALETTE, { voxelSize: VOX, origin });
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(data.positions, 3));
  geo.setAttribute('normal', new THREE.BufferAttribute(data.normals, 3));
  geo.setAttribute('color', new THREE.BufferAttribute(data.colors, 3));
  geo.setAttribute('aAO', new THREE.BufferAttribute(data.ao, 1));
  geo.setAttribute('uv', new THREE.BufferAttribute(data.uvs, 2));
  geo.setIndex(new THREE.BufferAttribute(data.indices, 1));
  geo.computeBoundingSphere();
  const mesh = new THREE.Mesh(geo, material);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}

export function buildCharacter(material: THREE.Material): CharacterRig {
  const root = new THREE.Group();

  // ---- 脚 ----
  const legGrid = new VoxelGrid(4, 12, 4);
  {
    const p = new VoxelPainter(legGrid);
    p.box(0, 0, 0, 4, 12, 4, S.PANTS);
    p.box(0, 0, 0, 4, 3, 4, S.BOOT);
    p.box(0, 2, 3, 4, 1, 1, S.ACCENT);
  }
  // 股関節を原点に置く（Y=上端）
  const legOrigin: [number, number, number] = [-2 * VOX, -12 * VOX, -2 * VOX];

  const legL = new THREE.Group();
  legL.add(meshFromGrid(legGrid, material, legOrigin));
  legL.position.set(-2 * VOX, 12 * VOX, 0);

  const legR = new THREE.Group();
  legR.add(meshFromGrid(legGrid, material, legOrigin));
  legR.position.set(2 * VOX, 12 * VOX, 0);

  // ---- 胴 ----
  const torsoGrid = new VoxelGrid(8, 12, 5);
  {
    const p = new VoxelPainter(torsoGrid);
    p.box(0, 0, 0, 8, 12, 5, S.SHIRT);
    p.box(0, 0, 0, 8, 2, 5, S.SHIRT_D);
    // 前身頃のベルトとポケット
    p.box(0, 3, 4, 8, 1, 1, S.PANTS);
    p.box(1, 5, 4, 2, 2, 1, S.SHIRT_D);
    p.box(5, 5, 4, 2, 2, 1, S.SHIRT_D);
    // 襟
    p.box(2, 11, 1, 4, 1, 3, S.ACCENT);
    // バックパック
    p.box(1, 3, -3, 6, 8, 3, S.PACK);
    p.box(1, 5, -4, 6, 3, 1, S.SHIRT_D);
    p.box(2, 9, -4, 4, 1, 1, S.METAL);
  }
  const torso = new THREE.Group();
  torso.add(meshFromGrid(torsoGrid, material, [-4 * VOX, 0, -2.5 * VOX]));
  torso.position.set(0, 12 * VOX, 0);

  // ---- 腕 ----
  const armGrid = new VoxelGrid(3, 12, 3);
  {
    const p = new VoxelPainter(armGrid);
    p.box(0, 0, 0, 3, 12, 3, S.SHIRT);
    p.box(0, 0, 0, 3, 3, 3, S.SKIN);
    p.box(0, 3, 0, 3, 1, 3, S.ACCENT);
  }
  const armOrigin: [number, number, number] = [-1.5 * VOX, -12 * VOX, -1.5 * VOX];

  const armL = new THREE.Group();
  armL.add(meshFromGrid(armGrid, material, armOrigin));
  armL.position.set(-5.5 * VOX, 11 * VOX, 0);

  const armR = new THREE.Group();
  armR.add(meshFromGrid(armGrid, material, armOrigin));
  armR.position.set(5.5 * VOX, 11 * VOX, 0);

  const toolAnchor = new THREE.Object3D();
  toolAnchor.position.set(0, -12 * VOX, 1.5 * VOX);
  armR.add(toolAnchor);

  // ---- 頭 ----
  const headGrid = new VoxelGrid(9, 11, 9);
  {
    const p = new VoxelPainter(headGrid);
    p.box(0, 0, 0, 8, 8, 8, S.SKIN);
    // 髪
    p.box(0, 6, 0, 8, 2, 8, S.HAIR);
    p.box(0, 3, 0, 8, 3, 1, S.HAIR);
    // ゴーグル（額に上げている＝発掘者らしさ）
    p.box(0, 7, 0, 8, 2, 9, S.METAL);
    p.box(1, 7, 8, 2, 2, 1, S.GOGGLE);
    p.box(5, 7, 8, 2, 2, 1, S.GOGGLE);
    // ハット（つば付き）
    p.box(-1, 9, -1, 10, 1, 10, S.HAT);
    p.box(1, 10, 1, 6, 1, 6, S.HAT);
    // 目
    p.box(2, 4, 8, 1, 1, 1, S.EYE);
    p.box(5, 4, 8, 1, 1, 1, S.EYE);
  }
  const head = new THREE.Group();
  head.add(meshFromGrid(headGrid, material, [-4 * VOX, 0, -4 * VOX]));
  head.position.set(0, 12 * VOX, 0);

  const hips = new THREE.Group();
  hips.add(legL, legR, torso);
  torso.add(head, armL, armR);
  root.add(hips);

  return {
    root, hips, torso, head, armL, armR, legL, legR, toolAnchor,
    height: 32 * VOX,
  };
}

/** 掘削ツール（ドリル/ハンマー）。手に持たせる */
export function buildTool(material: THREE.Material): THREE.Group {
  const g = new VoxelGrid(5, 14, 5);
  const p = new VoxelPainter(g);
  p.box(2, 0, 2, 1, 8, 1, S.HAIR); // 柄
  p.box(1, 8, 1, 3, 3, 3, S.METAL); // ヘッド
  p.box(0, 9, 0, 5, 1, 5, S.METAL);
  p.box(2, 11, 2, 1, 3, 1, S.ACCENT); // 先端
  const group = new THREE.Group();
  group.add(meshFromGrid(g, material, [-2.5 * VOX, 0, -2.5 * VOX]));
  return group;
}

/**
 * 手続きアニメーション。クリップを持たずに位相から直接ポーズを作る。
 * 歩き・待機・掘りの3状態をブレンドする。
 */
export class CharacterAnimator {
  private phase = 0;
  private digPhase = 0;
  private breathe = 0;
  walkBlend = 0;
  digBlend = 0;

  constructor(private rig: CharacterRig) {}

  update(dt: number, speed01: number, digging: boolean): void {
    this.phase += dt * (6 + speed01 * 5);
    this.breathe += dt * 1.6;
    this.digPhase += dt * 7.5;

    // ブレンドを時間で追従させる。瞬間切替だとポーズが飛ぶ
    const targetWalk = speed01;
    this.walkBlend += (targetWalk - this.walkBlend) * Math.min(1, dt * 12);
    this.digBlend += ((digging ? 1 : 0) - this.digBlend) * Math.min(1, dt * 10);

    const r = this.rig;
    const swing = Math.sin(this.phase) * 0.85 * this.walkBlend;
    const swing2 = Math.sin(this.phase + Math.PI) * 0.85 * this.walkBlend;

    r.legL.rotation.x = swing;
    r.legR.rotation.x = swing2;

    const idle = Math.sin(this.breathe) * 0.045;
    const armSwing = -swing * 0.7;
    const armSwing2 = -swing2 * 0.7;

    // 掘りポーズ: 右腕を振り下ろす
    const dig = Math.max(0, Math.sin(this.digPhase)) ** 1.6;
    r.armR.rotation.x = THREE.MathUtils.lerp(armSwing2 + idle, -2.2 + dig * 2.0, this.digBlend);
    r.armL.rotation.x = THREE.MathUtils.lerp(armSwing + idle, -0.9 + dig * 0.7, this.digBlend);
    r.armL.rotation.z = THREE.MathUtils.lerp(0.06, 0.25, this.digBlend);
    r.armR.rotation.z = THREE.MathUtils.lerp(-0.06, -0.18, this.digBlend);

    // 上下動。歩行の推進感はここで決まる
    const bob = Math.abs(Math.sin(this.phase)) * 0.045 * this.walkBlend;
    r.hips.position.y = bob + idle * 0.5;
    r.torso.rotation.x = THREE.MathUtils.lerp(idle * 0.4, 0.42, this.digBlend);
    r.torso.rotation.y = Math.sin(this.phase) * 0.07 * this.walkBlend;
    r.head.rotation.x = THREE.MathUtils.lerp(-idle, -0.28, this.digBlend);
  }

  /** 走行方向と体の向きのズレを頭で補う（ルックアット） */
  lookAt(yawOffset: number, pitch: number): void {
    this.rig.head.rotation.y = THREE.MathUtils.clamp(yawOffset, -0.9, 0.9);
    this.rig.head.rotation.x += THREE.MathUtils.clamp(pitch, -0.5, 0.5) * 0.5;
  }
}
