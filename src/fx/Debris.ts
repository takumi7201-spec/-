import * as THREE from 'three';

/**
 * 掘削の破片。InstancedMesh 1本で全部描くのでドローコールは常に1。
 *
 * ボクセルの破壊表現は破片の量で決まる。そして重要なのは、
 * ボクセルが消えた瞬間に必要なのは「消えた感触」であって
 * 「正しいメッシュ」ではないということ。破片が飛んでいる間に
 * チャンク再構築を数フレーム遅らせても誰も気づかない。
 */
export class DebrisSystem {
  readonly mesh: THREE.InstancedMesh;
  private pos: Float32Array;
  private vel: Float32Array;
  private life: Float32Array;
  private maxLife: Float32Array;
  private spin: Float32Array;
  private size: Float32Array;
  private alive: boolean[] = [];
  private cursor = 0;
  private readonly max: number;
  private dummy = new THREE.Object3D();
  private color = new THREE.Color();

  constructor(max = 300, voxelSize = 0.3) {
    this.max = max;
    const geo = new THREE.BoxGeometry(voxelSize * 0.42, voxelSize * 0.42, voxelSize * 0.42);
    const mat = new THREE.MeshLambertMaterial({ vertexColors: false });
    this.mesh = new THREE.InstancedMesh(geo, mat, max);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.castShadow = false;
    this.mesh.receiveShadow = false;
    this.mesh.frustumCulled = false;
    this.mesh.count = max;

    this.pos = new Float32Array(max * 3);
    this.vel = new Float32Array(max * 3);
    this.life = new Float32Array(max);
    this.maxLife = new Float32Array(max);
    this.spin = new Float32Array(max * 3);
    this.size = new Float32Array(max);
    for (let i = 0; i < max; i++) {
      this.alive.push(false);
      this.setMatrix(i, 0, -9999, 0, 1);
    }
    this.mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(max * 3), 3);
  }

  private setMatrix(i: number, x: number, y: number, z: number, s: number, rx = 0, ry = 0, rz = 0): void {
    this.dummy.position.set(x, y, z);
    this.dummy.rotation.set(rx, ry, rz);
    this.dummy.scale.setScalar(s);
    this.dummy.updateMatrix();
    this.mesh.setMatrixAt(i, this.dummy.matrix);
  }

  burst(
    origin: THREE.Vector3,
    color: THREE.ColorRepresentation,
    count: number,
    opts: { speed?: number; spread?: number; up?: number; life?: number; size?: number } = {},
  ): void {
    const speed = opts.speed ?? 3.2;
    const spread = opts.spread ?? 1;
    const up = opts.up ?? 2.6;
    this.color.set(color);
    for (let n = 0; n < count; n++) {
      const i = this.cursor;
      this.cursor = (this.cursor + 1) % this.max;
      const i3 = i * 3;
      this.pos[i3] = origin.x + (Math.random() - 0.5) * 0.25;
      this.pos[i3 + 1] = origin.y + (Math.random() - 0.5) * 0.25;
      this.pos[i3 + 2] = origin.z + (Math.random() - 0.5) * 0.25;
      const a = Math.random() * Math.PI * 2;
      const r = Math.random() * spread;
      this.vel[i3] = Math.cos(a) * r * speed;
      this.vel[i3 + 1] = up * (0.5 + Math.random());
      this.vel[i3 + 2] = Math.sin(a) * r * speed;
      this.spin[i3] = (Math.random() - 0.5) * 14;
      this.spin[i3 + 1] = (Math.random() - 0.5) * 14;
      this.spin[i3 + 2] = (Math.random() - 0.5) * 14;
      this.maxLife[i] = (opts.life ?? 0.85) * (0.7 + Math.random() * 0.6);
      this.life[i] = this.maxLife[i];
      this.size[i] = (opts.size ?? 1) * (0.6 + Math.random() * 0.8);
      this.alive[i] = true;
      const c = this.mesh.instanceColor!;
      const jitter = 0.85 + Math.random() * 0.3;
      c.setXYZ(i, this.color.r * jitter, this.color.g * jitter, this.color.b * jitter);
    }
    this.mesh.instanceColor!.needsUpdate = true;
  }

  update(dt: number, groundY = 0): void {
    let any = false;
    for (let i = 0; i < this.max; i++) {
      if (!this.alive[i]) continue;
      any = true;
      const i3 = i * 3;
      this.life[i] -= dt;
      if (this.life[i] <= 0) {
        this.alive[i] = false;
        this.setMatrix(i, 0, -9999, 0, 0.0001);
        continue;
      }
      this.vel[i3 + 1] -= 13 * dt;
      this.pos[i3] += this.vel[i3] * dt;
      this.pos[i3 + 1] += this.vel[i3 + 1] * dt;
      this.pos[i3 + 2] += this.vel[i3 + 2] * dt;
      if (this.pos[i3 + 1] < groundY) {
        this.pos[i3 + 1] = groundY;
        this.vel[i3 + 1] *= -0.32;
        this.vel[i3] *= 0.7;
        this.vel[i3 + 2] *= 0.7;
      }
      const t = this.life[i] / this.maxLife[i];
      const s = this.size[i] * Math.min(1, t * 2.2);
      const sp = this.spin;
      this.setMatrix(
        i, this.pos[i3], this.pos[i3 + 1], this.pos[i3 + 2], s,
        sp[i3] * this.life[i], sp[i3 + 1] * this.life[i], sp[i3 + 2] * this.life[i],
      );
    }
    if (any) this.mesh.instanceMatrix.needsUpdate = true;
  }

  clear(): void {
    for (let i = 0; i < this.max; i++) {
      this.alive[i] = false;
      this.setMatrix(i, 0, -9999, 0, 0.0001);
    }
    this.mesh.instanceMatrix.needsUpdate = true;
  }

  dispose(): void {
    this.mesh.geometry.dispose();
    (this.mesh.material as THREE.Material).dispose();
  }
}
