import * as THREE from 'three';
import { VoxelGrid } from '../voxel/VoxelGrid';
import { VoxelPainter, Rng } from '../voxel/VoxelPainter';
import { greedyMesh } from '../voxel/greedyMesher';
import { buildPalette, ELEMENT_PALETTES, BIOMES } from '../voxel/palette';
import { createVoxelMaterial, type VoxelMaterial } from '../shaders/VoxelMaterial';
import { buildCreature, creatureToObject3D, type CreatureObject } from '../voxel/CreatureBuilder';
import { CreatureAnimator } from '../voxel/CreatureAnimator';
import { Environment } from '../fx/Environment';
import { getRevos } from '../game/data/revos';
import type { QualitySettings } from '../core/Quality';

/**
 * 拠点のジオラマ。
 *
 * 施設を3Dで直接タップさせる主導線にすると、モデルの当たり判定と
 * 視認性のQAが跳ね上がる。ここでは3Dは「今の手持ちが見える場所」に徹し、
 * 導線は下部のグリッドに寄せる。3Dを飾りにしないための落とし所として、
 * 先頭のリヴォスを実物大で置いて待機させる。
 */

const VOX = 0.16;

const CAMP_PALETTE = buildPalette([
  0x000000,
  0xc8a271, // 砂
  0xb08753, // 砂（暗）
  0x7d5e3c, // 土
  0x6e5f52, // 岩
  0xd9a441, // 幌
  0x8a6a45, // 木
  0xb8bcc4, // 金属
  0xff8c3c, // 火
  0x4a4038, // 影側
]);

export class HomeScene {
  readonly scene = new THREE.Scene();
  readonly camera: THREE.PerspectiveCamera;

  private env: Environment;
  private material: VoxelMaterial;
  private camp?: THREE.Mesh;
  private guest?: CreatureObject;
  private guestAnim?: CreatureAnimator;
  private guestMaterial?: VoxelMaterial;
  private fire?: THREE.PointLight;
  private t = 0;

  constructor(quality: QualitySettings) {
    this.camera = new THREE.PerspectiveCamera(42, 1, 0.1, 220);
    this.env = new Environment(quality);
    this.scene.add(this.env.group);
    this.material = createVoxelMaterial({
      voxelSize: VOX,
      colorJitter: 0.1,
      edgeDarkness: 0.05,
      aoDirect: 0.32,
      rimStrength: 0.16,
      floorLight: 0.08,
    });
    this.buildCamp();

    // 焚き火。夕景の拠点に1点だけ暖色を置くと、絵が一気に締まる
    this.fire = new THREE.PointLight(0xff9c3c, 4.5, 9, 1.8);
    this.fire.position.set(-1.1, 0.9, 1.4);
    this.scene.add(this.fire);

    this.env.applyBiome(BIOMES.canyon, this.scene);
    this.env.fitShadowToArea(new THREE.Vector3(0, 0, 0), 9);
    this.scene.fog = new THREE.FogExp2(BIOMES.canyon.fog, 0.02);
  }

  private buildCamp(): void {
    const S = 40, H = 14, D = 40;
    const g = new VoxelGrid(S, H, D);
    const p = new VoxelPainter(g);
    const rng = new Rng(4242);
    const cx = S / 2, cz = D / 2;

    // 台地
    for (let z = 0; z < D; z++)
      for (let x = 0; x < S; x++) {
        const d = Math.hypot((x - cx) / (S * 0.46), (z - cz) / (D * 0.46));
        if (d > 1) continue;
        const h = Math.round(5 - Math.pow(d, 3) * 4 + Math.sin(x * 0.4) * Math.cos(z * 0.36) * 0.7);
        for (let y = 0; y <= h; y++) {
          g.set(x, y, z, y === h ? (rng.chance(0.16) ? 2 : 1) : y > h - 3 ? 3 : 4);
        }
      }

    const topAt = (x: number, z: number): number => {
      for (let y = H - 1; y >= 0; y--) if (g.isSolid(x, y, z)) return y + 1;
      return 1;
    };

    // テント（幌）
    const tx = cx - 7, tz = cz - 4;
    const ty = topAt(tx, tz);
    for (let i = 0; i < 8; i++) {
      const w = Math.max(1, 5 - Math.floor(i / 2));
      p.box(tx - w, ty + i, tz - 4, w * 2 + 1, 1, 9, i > 5 ? 5 : 5);
    }
    p.box(tx - 5, ty, tz - 4, 11, 1, 9, 6);

    // 道具箱と発掘道具
    const bx = cx + 5, bz = cz + 3;
    const by = topAt(bx, bz);
    p.box(bx, by, bz, 4, 3, 3, 6);
    p.box(bx, by + 3, bz, 4, 1, 3, 7);
    p.taperedTube(bx + 5, by, bz + 1, bx + 5, by + 6, bz + 2, 0.5, 0.4, 6);
    p.box(bx + 4, by + 6, bz + 1, 3, 1, 2, 7);

    // 焚き火
    const fx = cx - 7, fz = cz + 9;
    const fy = topAt(fx, fz);
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2;
      p.box(Math.round(fx + Math.cos(a) * 2), fy, Math.round(fz + Math.sin(a) * 2), 1, 1, 1, 4);
    }
    p.box(fx - 1, fy, fz - 1, 3, 1, 3, 6);
    p.box(fx, fy + 1, fz, 1, 2, 1, 8);

    // 岩と柱
    for (let i = 0; i < 10; i++) {
      const a = rng.next() * Math.PI * 2;
      const r = 12 + rng.next() * 5;
      const x = Math.round(cx + Math.cos(a) * r);
      const z = Math.round(cz + Math.sin(a) * r);
      if (x < 2 || z < 2 || x > S - 3 || z > D - 3) continue;
      const y = topAt(x, z);
      p.ellipsoid(x, y + 1, z, rng.range(1.2, 2.6), rng.range(1.4, 3.4), rng.range(1.2, 2.6), 4);
    }

    const data = greedyMesh(g, CAMP_PALETTE, {
      voxelSize: VOX,
      origin: [-cx * VOX, -5 * VOX, -cz * VOX],
    });
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(data.positions, 3));
    geo.setAttribute('normal', new THREE.BufferAttribute(data.normals, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(data.colors, 3));
    geo.setAttribute('aAO', new THREE.BufferAttribute(data.ao, 1));
    geo.setAttribute('uv', new THREE.BufferAttribute(data.uvs, 2));
    geo.setIndex(new THREE.BufferAttribute(data.indices, 1));
    geo.computeBoundingSphere();
    this.camp = new THREE.Mesh(geo, this.material);
    this.camp.castShadow = true;
    this.camp.receiveShadow = true;
    this.camp.matrixAutoUpdate = false;
    this.camp.updateMatrix();
    this.scene.add(this.camp);
  }

  /** 先頭のリヴォスを拠点に立たせる。手持ちが変わったら呼び直す */
  setGuest(defId: string | null): void {
    if (this.guest) {
      this.scene.remove(this.guest.root);
      this.guest.dispose();
      this.guestMaterial?.dispose();
      this.guest = undefined;
      this.guestAnim = undefined;
    }
    if (!defId) return;
    const def = getRevos(defId);
    const model = buildCreature({
      archetype: def.build.archetype,
      seed: def.build.seed,
      bulk: def.build.bulk,
      scale: def.build.scale,
      horns: def.build.horns,
      sail: def.build.sail,
      crest: def.build.crest,
      spikes: def.build.spikes,
    });
    this.guestMaterial = createVoxelMaterial({
      voxelSize: model.voxelSize,
      colorJitter: 0.05,
      edgeDarkness: 0.05,
      aoDirect: 0.34,
      rimStrength: 0.26,
      floorLight: 0.1,
    });
    this.guest = creatureToObject3D(model, ELEMENT_PALETTES[def.element], this.guestMaterial);
    this.guest.root.position.set(1.9, 0.62, -0.5);
    this.guest.root.rotation.y = -0.9;
    this.scene.add(this.guest.root);
    this.guestAnim = new CreatureAnimator(this.guest);
    this.guestAnim.play('idle');
  }

  update(dt: number): void {
    this.t += dt;
    this.guestAnim?.update(dt);
    if (this.fire) {
      // 焚き火の揺らぎ。周期が見えないよう2つの正弦を重ねる
      this.fire.intensity = 2.6 + Math.sin(this.t * 9.1) * 0.4 + Math.sin(this.t * 4.3) * 0.28;
    }
    // ゆっくり周回。触らなくても拠点が生きて見える
    const a = this.t * 0.055;
    this.camera.position.set(Math.sin(a) * 11.5, 5.4, Math.cos(a) * 11.5);
    this.camera.lookAt(0, 1.9, 0);
    this.env.update(dt, this.camera.position);
  }

  resize(aspect: number): void {
    this.camera.aspect = aspect;
    this.camera.fov = aspect < 0.75 ? 48 : 40;
    this.camera.updateProjectionMatrix();
  }

  dispose(): void {
    if (this.camp) { this.scene.remove(this.camp); this.camp.geometry.dispose(); }
    if (this.guest) { this.scene.remove(this.guest.root); this.guest.dispose(); }
    this.guestMaterial?.dispose();
    this.material.dispose();
    this.env.dispose();
  }
}
