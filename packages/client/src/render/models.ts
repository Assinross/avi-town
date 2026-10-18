// Модели KayKit City Builder Bits (CC0, Kay Lousberg): загружаются один раз при старте,
// цвет из текстуры-палитры запекается в вершины - модели вклеиваются в общий меш участка
// так же, как процедурные коробки, и получают тот же контур и тени.

import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

export interface Model {
  pos: Float32Array;
  nrm: Float32Array;
  col: Float32Array;
}

const DIR = `${import.meta.env.BASE_URL}models/kaykit/`;

const NAMES = [
  'base', 'road_straight', 'road_corner', 'road_tsplit', 'road_junction', 'road_straight_crossing',
  'building_A_withoutBase', 'building_B_withoutBase', 'building_C_withoutBase', 'building_D_withoutBase',
  'building_E_withoutBase', 'building_F_withoutBase', 'building_G_withoutBase', 'building_H_withoutBase',
  'streetlight', 'bush', 'bench', 'dumpster', 'firehydrant', 'box_A', 'box_B', 'trash_A', 'trash_B', 'watertower',
  'car_hatchback', 'car_police', 'car_sedan', 'car_stationwagon', 'car_taxi',
] as const;

export type ModelName = (typeof NAMES)[number];

export const MODELS = {} as Record<ModelName, Model>;

async function loadPalette(): Promise<ImageData> {
  const img = await createImageBitmap(await (await fetch(`${DIR}citybits_texture.png`)).blob());
  const ctx = new OffscreenCanvas(img.width, img.height).getContext('2d')!;
  ctx.drawImage(img, 0, 0);
  return ctx.getImageData(0, 0, img.width, img.height);
}

function bake(root: THREE.Object3D, tex: ImageData): Model {
  const pos: number[] = [], nrm: number[] = [], col: number[] = [];
  const c = new THREE.Color(), p = new THREE.Vector3(), n = new THREE.Vector3(), nm = new THREE.Matrix3();
  root.updateMatrixWorld(true);
  root.traverse((o) => {
    if (!(o as THREE.Mesh).isMesh) return;
    const g = (o as THREE.Mesh).geometry.toNonIndexed();
    const P = g.attributes.position, N = g.attributes.normal, U = g.attributes.uv;
    nm.getNormalMatrix(o.matrixWorld);
    for (let i = 0; i < P.count; i++) {
      p.fromBufferAttribute(P, i).applyMatrix4(o.matrixWorld);
      n.fromBufferAttribute(N, i).applyMatrix3(nm).normalize();
      // У glTF начало UV - левый верхний угол картинки
      const x = Math.min(tex.width - 1, Math.max(0, Math.floor(U.getX(i) * tex.width)));
      const y = Math.min(tex.height - 1, Math.max(0, Math.floor(U.getY(i) * tex.height)));
      const k = (y * tex.width + x) * 4;
      c.setRGB(tex.data[k] / 255, tex.data[k + 1] / 255, tex.data[k + 2] / 255, THREE.SRGBColorSpace);
      pos.push(p.x, p.y, p.z);
      nrm.push(n.x, n.y, n.z);
      col.push(c.r, c.g, c.b);
    }
    g.dispose();
  });
  ambientOcclusion(pos, col);
  return { pos: new Float32Array(pos), nrm: new Float32Array(nrm), col: new Float32Array(col) };
}

/** Затенение у земли: низ стен темнее, к высоте AO_HEIGHT сходит на нет. Плоские модели не трогаем. */
const AO_HEIGHT = 0.5, AO_MIN = 0.6;

function ambientOcclusion(pos: number[], col: number[]) {
  let lo = Infinity, hi = -Infinity;
  for (let i = 1; i < pos.length; i += 3) { lo = Math.min(lo, pos[i]); hi = Math.max(hi, pos[i]); }
  if (hi - lo < 0.2) return;
  for (let i = 0; i < pos.length; i += 3) {
    const k = THREE.MathUtils.smoothstep(pos[i + 1] - lo, 0, AO_HEIGHT);
    const f = AO_MIN + (1 - AO_MIN) * k;
    col[i] *= f; col[i + 1] *= f; col[i + 2] *= f;
  }
}

/** Плоскость стены: координата z, на которой больше всего площади треугольников с нормалью вдоль sign*z. */
function wallPlane(pos: number[], nrm: number[], sign: number): number {
  const area = new Map<number, number>();
  for (let i = 0; i < pos.length; i += 9) {
    if (nrm[i + 2] * sign < 0.95) continue;
    const z = Math.round(pos[i + 2] * 100) / 100;
    const ax = pos[i + 3] - pos[i], ay = pos[i + 4] - pos[i + 1], bx = pos[i + 6] - pos[i], by = pos[i + 7] - pos[i + 1];
    area.set(z, (area.get(z) ?? 0) + Math.abs(ax * by - ay * bx) / 2);
  }
  let best = 0, bestA = -1;
  for (const [z, a] of area) if (a > bestA) { best = z; bestA = a; }
  return best;
}

/**
 * У домов KayKit окна на фасаде и боках, а задняя стена глухая (их ставят вплотную рядами).
 * Глухая задняя стена заменяется зеркальной копией фасада модели - те же стена с проёмами, стёкла, рамы.
 * Первый этаж фасада (дверь, витрина, навес) сзади не нужен: вместо него - копия второго этажа с окнами.
 */
const FACADE_DEPTH = 0.3; // насколько вглубь от плоскости фасада лежат его детали (утопленные стёкла, откосы)
const FLOOR_UNITS = 0.7; // высота этажа в единицах модели
function addBackFacade(m: Model): Model {
  const src = m;
  const front = wallPlane(Array.from(src.pos), Array.from(src.nrm), 1);
  const back = wallPlane(Array.from(src.pos), Array.from(src.nrm), -1);
  const pos: number[] = [], nrm: number[] = [], col: number[] = [];
  // Вершины треугольника i: dy - сдвиг по высоте, mirror - на заднюю стену, dz - дополнительный сдвиг по z
  const copy = (i: number, mirror: boolean, dy = 0, dz = 0) => {
    // Отражение по z меняет обход треугольника - вершины 2 и 3 меняются местами, чтобы грани смотрели наружу
    for (const k of mirror ? [0, 6, 3] : [0, 3, 6]) {
      const j = i + k;
      pos.push(src.pos[j], src.pos[j + 1] + dy, (mirror ? back - (src.pos[j + 2] - front) : src.pos[j + 2]) + dz);
      nrm.push(src.nrm[j], src.nrm[j + 1], mirror ? -src.nrm[j + 2] : src.nrm[j + 2]);
      col.push(src.col[j], src.col[j + 1], src.col[j + 2]);
    }
  };
  const eps = 0.01;
  for (let i = 0; i < src.pos.length; i += 9) {
    let onBack = src.nrm[i + 2] < -0.95, onFront = true, minY = Infinity, maxY = -Infinity;
    for (let k = 0; k < 9; k += 3) {
      const z = src.pos[i + k + 2], y = src.pos[i + k + 1];
      if (Math.abs(z - back) > 0.01) onBack = false;
      if (z < front - FACADE_DEPTH) onFront = false;
      minY = Math.min(minY, y);
      maxY = Math.max(maxY, y);
    }
    if (onBack) {
      // Глухая задняя стена остаётся подложкой в глубине - прикрывает щели между деталями первого этажа
      copy(i, false, 0, FACADE_DEPTH);
      continue;
    }
    copy(i, false);
    if (!onFront) continue;
    const ground = maxY <= FLOOR_UNITS + eps, second = minY >= FLOOR_UNITS - eps && maxY <= 2 * FLOOR_UNITS + eps;
    if (!ground) copy(i, true);
    if (second) copy(i, true, -FLOOR_UNITS);
  }
  return { pos: new Float32Array(pos), nrm: new Float32Array(nrm), col: new Float32Array(col) };
}

export async function loadModels() {
  const tex = await loadPalette();
  const loader = new GLTFLoader();
  await Promise.all(NAMES.map(async (name) => {
    const gltf = await loader.loadAsync(`${DIR}${name}.gltf`);
    const m = bake(gltf.scene, tex);
    MODELS[name] = name.startsWith('building_') ? addBackFacade(m) : m;
  }));
}
