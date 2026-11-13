// Лёгкий процедурный дым от тяжело повреждённых зданий.
// Один InstancedMesh на всю карту: не создаёт частиц/материалов каждый кадр.
import * as THREE from 'three';
import { BUILDING_BY_ID } from '@avi/data';
import type { World } from '@avi/sim';

const MAX_SMOKE_SITES = 12;
const PUFFS_PER_SITE = 3;
interface DamageSite { x: number; z: number; y: number; severity: number }

/**
 * Детали ущерба доступны и на общегородском масштабе.
 * Закопчённые здания дымят, после ремонта дым исчезает без перезагрузки сцены.
 */
export class DamageView {
  readonly group = new THREE.Group();
  private smoke = new THREE.InstancedMesh(
    new THREE.IcosahedronGeometry(0.14, 0),
    new THREE.MeshLambertMaterial({
      color: 0x747578, transparent: true, opacity: 0.42, depthWrite: false,
    }),
    MAX_SMOKE_SITES * PUFFS_PER_SITE,
  );
  private dummy = new THREE.Object3D();
  private sites: DamageSite[] = [];
  private elapsed = 0;
  private scanAcc = 1;
  private lastWorld: World | null = null;

  constructor() {
    this.smoke.count = 0;
    this.smoke.frustumCulled = false;
    this.smoke.userData.noOutline = true;
    this.smoke.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.group.add(this.smoke);
  }

  reset() {
    this.sites.length = 0;
    this.smoke.count = 0;
    this.lastWorld = null;
    this.scanAcc = 1;
  }

  update(w: World, dt: number, focus: { x: number; z: number }, visible: boolean) {
    this.group.visible = visible;
    if (!visible) return;
    this.elapsed += dt;
    this.scanAcc += dt;
    if (this.lastWorld !== w || this.scanAcc >= 0.75) {
      this.lastWorld = w;
      this.scanAcc = 0;
      const around: { site: DamageSite; distance: number }[] = [];
      for (let i = 0; i < w.tiles.length; i++) {
        const t = w.tiles[i];
        if (t.object !== 'building' || t.root !== i || t.build > 0 || !w.explored[i]) continue;
        const def = BUILDING_BY_ID[t.def!];
        if (!def?.hp || t.hp <= 0 || t.hp >= def.hp * 0.62) continue;
        const x = (i % w.size) + def.size / 2, z = Math.floor(i / w.size) + def.size / 2;
        const distance = (x - focus.x) ** 2 + (z - focus.z) ** 2;
        around.push({
          site: {
            x, z, severity: Math.max(0, Math.min(1, 1 - t.hp / def.hp)),
            y: def.id === 'bunker' ? 0.48 : def.category === 'defense' ? 0.47 : def.size >= 2 ? 1.05 : 0.64,
          },
          distance,
        });
      }
      around.sort((a, b) => a.distance - b.distance);
      this.sites = around.slice(0, MAX_SMOKE_SITES).map((entry) => entry.site);
    }

    let n = 0;
    for (let i = 0; i < this.sites.length; i++) {
      const site = this.sites[i];
      for (let p = 0; p < PUFFS_PER_SITE; p++) {
        // Постоянные фазы дают без случайности несколько разнесённых объёмов дыма.
        const phase = (this.elapsed * (0.28 + p * 0.025) + i * 0.17 + p / PUFFS_PER_SITE) % 1;
        const spread = 0.08 + phase * 0.24;
        const angle = i * 2.4 + p * 2.1;
        this.dummy.position.set(
          site.x + Math.sin(angle) * spread + phase * 0.15,
          site.y + phase * (0.75 + site.severity * 0.5),
          site.z + Math.cos(angle) * spread,
        );
        const size = (0.5 + phase * 0.9) * (0.75 + site.severity * 0.5);
        this.dummy.scale.setScalar(size);
        this.dummy.rotation.set(phase * 1.6, angle, 0);
        this.dummy.updateMatrix();
        this.smoke.setMatrixAt(n++, this.dummy.matrix);
      }
    }
    this.smoke.count = n;
    if (n) this.smoke.instanceMatrix.needsUpdate = true;
  }
}
