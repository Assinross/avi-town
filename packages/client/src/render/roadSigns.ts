// Светофоры на перекрёстках: стойки KayKit City Builder Bits и свои светящиеся линзы.
// У модели одна общая текстура на все детали, поэтому цвет линзы не перекрасить - вместо этого
// поверх нарисованных линз ставится свой кружок, который горит нужным цветом по фазе оси.
// Положение линз в модели посчитано по её геометрии (trafficlight_a: передняя грань головы).

import * as THREE from 'three';
import { DIRS } from '@avi/sim';
import { CityMap, type LightAxis } from './cityMap';
import { GeoBuilder } from './builder';
import { MODELS } from './models';

/** Масштаб стойки: голова светофора получается на высоте вдвое больше человека. */
const SCALE = 0.5;
/** Линзы в координатах модели, сверху вниз: красная, жёлтая, зелёная. */
const LENS: { y: number; z: number; color: number }[] = [
  { y: 0.703, z: 0.099, color: 0xff3b30 },
  { y: 0.635, z: 0.099, color: 0xffc21a },
  { y: 0.562, z: 0.099, color: 0x35dd5e },
];
/** Диаметр линзы в модели. */
const LENS_SIZE = 0.056;
/** Стойка стоит на углу перекрёстка, у бортика - как фонарь у дороги. */
const CORNER = 0.46;
/** База стойки над землёй: чуть выше плитки, чтобы не тонула в асфальте. */
const BASE = 0.04;
/** Запас по количеству стоек: пересоздаём меши только когда он кончился. */
const SPARE = 1.6;

interface Stand {
  x: number;
  z: number;
  yaw: number;
  axis: LightAxis;
}

export class RoadSigns {
  readonly group = new THREE.Group();
  private stands: Stand[] = [];
  private posts: THREE.InstancedMesh | null = null;
  private lenses: (THREE.InstancedMesh | null)[] = [null, null, null];
  private capacity = 0;
  private postsGeo: THREE.BufferGeometry | null = null;
  private lensGeo: THREE.PlaneGeometry | null = null;
  private material = new THREE.MeshLambertMaterial({ vertexColors: true });
  private tmp = new THREE.Object3D();
  private built: Set<number> | null = null;

  /** Перестроить стойки, если изменились перекрёстки, и показать текущие фазы. */
  update(map: CityMap) {
    if (map.crossings !== this.built) {
      this.built = map.crossings;
      this.build(map);
    }
    this.draw(map);
  }

  reset() {
    this.built = null;
    this.stands = [];
    this.drawHide();
  }

  /** Стойки на подходах к перекрёсткам: по одной на каждую улицу, что в него входит. */
  private build(map: CityMap) {
    const s = map.size;
    const stands: Stand[] = [];
    for (let i = 0; i < s * s; i++) {
      const mask = map.roadMask[i];
      if (!map.isJunction(i)) continue;
      const cx = (i % s) + 0.5, cz = Math.floor(i / s) + 0.5;
      for (let d = 0; d < 4; d++) {
        if (!(mask & (1 << d))) continue;
        // Машины едут из этого подхода в перекрёсток: f - по ходу, r - правая сторона по ходу
        const fx = -DIRS[d][0], fz = -DIRS[d][1];
        const rx = -fz, rz = fx;
        stands.push({
          x: cx - fx * CORNER + rx * CORNER,
          z: cz - fz * CORNER + rz * CORNER,
          yaw: Math.atan2(-fx, -fz),
          axis: fx !== 0 ? 0 : 1,
        });
      }
    }
    this.stands = stands;
    this.ensure(stands.length);
  }

  /** Меши под нужное число стоек: растут с запасом, чтобы не пересоздавать их на каждой стройке. */
  private ensure(fit: number) {
    if (this.posts && this.capacity >= fit) return;
    const cap = Math.max(48, Math.ceil(fit * SPARE));
    this.capacity = cap;
    if (!this.postsGeo) {
      const g = new GeoBuilder();
      g.model(MODELS.trafficlight_a, 0, BASE, 0, SCALE);
      this.postsGeo = g.build();
      this.lensGeo = new THREE.PlaneGeometry(LENS_SIZE * SCALE, LENS_SIZE * SCALE);
    }
    for (const mesh of [this.posts, ...this.lenses]) if (mesh) mesh.removeFromParent();    const posts = new THREE.InstancedMesh(this.postsGeo, this.material, cap);
    posts.frustumCulled = false;
    posts.castShadow = true;
    posts.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.posts = posts;
    this.group.add(posts);
    this.lenses = LENS.map((lens) => {
      const mat = new THREE.MeshBasicMaterial({ color: lens.color, transparent: true, opacity: 0.92, depthWrite: false });
      const mesh = new THREE.InstancedMesh(this.lensGeo!, mat, cap);
      mesh.frustumCulled = false;
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      mesh.userData.noOutline = true;
      mesh.count = 0;
      this.group.add(mesh);
      return mesh;
    });
  }

  private draw(map: CityMap) {
    const posts = this.posts;
    if (!posts) return;
    const counts = [0, 0, 0];
    this.stands.forEach((st, i) => {
      this.tmp.position.set(st.x, 0, st.z);
      this.tmp.rotation.set(0, st.yaw, 0);
      this.tmp.updateMatrix();
      posts.setMatrixAt(i, this.tmp.matrix);
      const phase = map.light(st.axis);
      const k = phase === 'red' ? 0 : phase === 'yellow' ? 1 : 2;
      const lens = LENS[k];
      // Кружок линзы - в системе стойки: вперёд по её взгляду и на высоту линзы
      const ahead = lens.z * SCALE;
      this.tmp.position.set(
        st.x + Math.sin(st.yaw) * ahead,
        BASE + lens.y * SCALE,
        st.z + Math.cos(st.yaw) * ahead,
      );
      this.tmp.updateMatrix();
      this.lenses[k]!.setMatrixAt(counts[k]++, this.tmp.matrix);
    });
    posts.count = this.stands.length;
    posts.instanceMatrix.needsUpdate = true;
    this.lenses.forEach((mesh, k) => {
      if (!mesh) return;
      mesh.count = counts[k];
      mesh.instanceMatrix.needsUpdate = true;
    });
  }

  private drawHide() {
    if (this.posts) this.posts.count = 0;
    for (const mesh of this.lenses) if (mesh) mesh.count = 0;
  }
}
