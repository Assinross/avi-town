// Дымка над туманом войны: полупрозрачные клубы над неразведанными клетками. У края разведанной
// земли клубы ниже и прозрачнее - граница мягкая, а не клетчатая. Перестраивается, только когда
// число разведанных клеток изменилось.

import * as THREE from 'three';
import type { World } from '@avi/sim';

const HAZE = 0x3a3f4a;
const HAZE_EDGE = 0x4a5160;

export class FogView {
  readonly group = new THREE.Group();
  private mesh: THREE.InstancedMesh;
  private explored = -1;
  private world: World | null = null;
  private tmp = new THREE.Object3D();
  private color = new THREE.Color();

  constructor(size: number) {
    const geo = new THREE.BoxGeometry(1, 1, 1).translate(0, 0.5, 0);
    const mat = new THREE.MeshLambertMaterial({ transparent: true, opacity: 0.72, depthWrite: false });
    this.mesh = new THREE.InstancedMesh(geo, mat, size * size);
    this.mesh.count = 0;
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 3;
    this.mesh.userData.noOutline = true;
    this.group.add(this.mesh);
  }

  /** Новый мир: дымка строится заново. */
  reset() {
    this.explored = -1;
    this.world = null;
  }

  update(w: World) {
    let n = 0;
    for (const v of w.explored) n += v;
    if (n === this.explored && w === this.world) return;
    this.explored = n;
    this.world = w;
    const s = w.size;
    let k = 0;
    for (let y = 0; y < s; y++) {
      for (let x = 0; x < s; x++) {
        if (w.explored[y * s + x]) continue;
        // Сколько разведанных клеток вокруг: у края дымка ниже
        let open = 0;
        for (let dy = -1; dy <= 1; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            const nx = x + dx, ny = y + dy;
            if (nx >= 0 && ny >= 0 && nx < s && ny < s && w.explored[ny * s + nx]) open++;
          }
        }
        const v = ((x * 73856093) ^ (y * 19349663)) >>> 0;
        const h = open ? 0.12 + (v % 5) * 0.02 : 0.32 + (v % 7) * 0.03;
        const wide = open ? 0.8 : 1.02;
        this.tmp.position.set(x + 0.5, 0, y + 0.5);
        this.tmp.scale.set(wide, h, wide);
        this.tmp.rotation.y = ((v >> 3) % 4) * 0.08;
        this.tmp.updateMatrix();
        this.mesh.setMatrixAt(k, this.tmp.matrix);
        this.mesh.setColorAt(k, this.color.setHex(open ? HAZE_EDGE : HAZE));
        k++;
      }
    }
    this.mesh.count = k;
    this.mesh.instanceMatrix.needsUpdate = true;
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
  }
}
