// Модели KayKit City Builder Bits (CC0, Kay Lousberg): загружаются один раз при старте,
// цвет из текстуры-палитры запекается в вершины - модели вклеиваются в общий меш участка
// так же, как процедурные коробки, и получают тот же контур и тени.
// Торговля и промзона - Kenney City Kit Commercial/Industrial (CC0): белые стены и серые крыши
// при загрузке помечаются, и здание получает цвета палитры игры через painted().
// Посевы ферм - Kenney Nature Kit, мешки с песком и мелочь - Quaternius (CC0): цвет из материала.

import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

export interface Model {
  pos: Float32Array;
  nrm: Float32Array;
  col: Float32Array;
  /** Перекраска вершины: > 0 - стена (множитель яркости), < 0 - крыша и отделка, 0 - родной цвет. */
  paint?: Float32Array;
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

const KC_DIR = `${import.meta.env.BASE_URL}models/kenney-commercial/`;
const KI_DIR = `${import.meta.env.BASE_URL}models/kenney-industrial/`;

const KC_NAMES = [
  'building-a', 'building-b', 'building-c', 'building-d', 'building-e', 'building-f', 'building-g',
  'building-h', 'building-i', 'building-j', 'building-k', 'building-l', 'building-m', 'building-n',
  'building-skyscraper-a', 'building-skyscraper-b', 'building-skyscraper-c', 'building-skyscraper-e',
  'detail-parasol-a', 'detail-parasol-b',
] as const;
const KI_NAMES = [
  'building-a', 'building-b', 'building-c', 'building-d', 'building-e', 'building-f', 'building-g',
  'building-h', 'building-i', 'building-j', 'building-k', 'building-l', 'building-m', 'building-n',
  'building-o', 'building-p', 'building-q', 'building-r', 'building-s', 'building-t',
  'chimney-large', 'chimney-medium', 'chimney-small', 'detail-tank', 'detail-tank-large',
  'shipping-container-a', 'shipping-container-b', 'shipping-container-c', 'water-tower',
] as const;

const NATURE_DIR = `${import.meta.env.BASE_URL}models/kenney-nature/`;
const PROPS_DIR = `${import.meta.env.BASE_URL}models/quaternius/props/`;

const NATURE_NAMES = [
  'crops_cornStageB', 'crops_cornStageC', 'crops_wheatStageA', 'crops_wheatStageB', 'crops_leafsStageA', 'crops_leafsStageB',
  'crop_pumpkin', 'crop_melon', 'crop_carrot', 'crop_turnip', 'crops_dirtRow', 'crops_dirtDoubleRow', 'log_stack',
] as const;
const PROP_NAMES = ['SackTrench', 'SackTrench_Small', 'GasTank', 'Pallet', 'Crate'] as const;

export type NatureName = (typeof NATURE_NAMES)[number];
export type PropName = (typeof PROP_NAMES)[number];

/** Посевы Kenney Nature Kit: тайл набора - 1 единица, центр основания в начале координат. */
export const NATURE = {} as Record<NatureName, Model>;
/** Пропсы Quaternius: центр основания в начале координат, размеры в единицах набора (метры). */
export const PROPS = {} as Record<PropName, Model>;

export type KcName = (typeof KC_NAMES)[number];
export type KiName = (typeof KI_NAMES)[number];

/** Kenney Commercial и Industrial: центр основания в начале координат, фасад к -z. */
export const KC = {} as Record<KcName, Model>;
export const KI = {} as Record<KiName, Model>;

async function loadPalette(url = `${DIR}citybits_texture.png`): Promise<ImageData> {
  const img = await createImageBitmap(await (await fetch(url)).blob());
  const ctx = new OffscreenCanvas(img.width, img.height).getContext('2d')!;
  ctx.drawImage(img, 0, 0);
  return ctx.getImageData(0, 0, img.width, img.height);
}

// Опорная яркость (линейная) белой стены и серой крыши Kenney - от неё считается множитель перекраски
const WALL_REF = 0.85, TRIM_REF = 0.12;

/** Множитель перекраски для цвета текстуры: светлые серые - стена, тёмные серо-синие - крыша и отделка. */
function paintOf(c: THREE.Color, r: number, g: number, b: number): number {
  const hi = Math.max(r, g, b), sat = hi > 0 ? (hi - Math.min(r, g, b)) / hi : 0;
  const lum = 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b;
  if (sat < 0.16 && hi > 0.7) return lum / WALL_REF;
  if (sat < 0.3 && hi < 0.55 && b >= r) return -lum / TRIM_REF;
  return 0;
}

// Цвета Nature Kit (бирюзовая ботва, бледные колосья) - под палитру игры, по имени материала
const NATURE_COLORS: Record<string, number> = {
  grass: 0x7fa83e, leafsDark: 0x5f8a3a, leafsFall: 0xd9822b, woodInner: 0xe8cc72, _defaultMat: 0xf0d27a, dirt: 0x9a7650, dirtDark: 0x7d5c40,
};

/**
 * tex = null - цвет из материала (модели без текстуры), recolor заменяет его по имени материала.
 * ao = false - без затенения у земли (мелкие модели вроде посевов иначе темнеют целиком).
 */
function bake(root: THREE.Object3D, tex: ImageData | null, paintable = false, centered = paintable, recolor?: Record<string, number>, ao = true): Model {
  const pos: number[] = [], nrm: number[] = [], col: number[] = [], paint: number[] = [];
  const c = new THREE.Color(), p = new THREE.Vector3(), n = new THREE.Vector3(), nm = new THREE.Matrix3();
  root.updateMatrixWorld(true);
  root.traverse((o) => {
    if (!(o as THREE.Mesh).isMesh) return;
    const g = (o as THREE.Mesh).geometry.toNonIndexed();
    const P = g.attributes.position, N = g.attributes.normal, U = g.attributes.uv;
    const mat = (o as THREE.Mesh).material as THREE.MeshStandardMaterial;
    const flat = recolor?.[mat.name] !== undefined ? new THREE.Color(recolor[mat.name]) : mat.color;
    nm.getNormalMatrix(o.matrixWorld);
    for (let i = 0; i < P.count; i++) {
      p.fromBufferAttribute(P, i).applyMatrix4(o.matrixWorld);
      n.fromBufferAttribute(N, i).applyMatrix3(nm).normalize();
      let r = 1, gr = 1, b = 1;
      if (tex) {
        // У glTF начало UV - левый верхний угол картинки
        const x = Math.min(tex.width - 1, Math.max(0, Math.floor(U.getX(i) * tex.width)));
        const y = Math.min(tex.height - 1, Math.max(0, Math.floor(U.getY(i) * tex.height)));
        const k = (y * tex.width + x) * 4;
        r = tex.data[k] / 255; gr = tex.data[k + 1] / 255; b = tex.data[k + 2] / 255;
        c.setRGB(r, gr, b, THREE.SRGBColorSpace);
      } else c.copy(flat);
      pos.push(p.x, p.y, p.z);
      nrm.push(n.x, n.y, n.z);
      col.push(c.r, c.g, c.b);
      if (paintable) paint.push(paintOf(c, r, gr, b));
    }
    g.dispose();
  });
  if (centered) center(pos);
  if (ao) ambientOcclusion(pos, col, paintable ? paint : null);
  const m: Model = { pos: new Float32Array(pos), nrm: new Float32Array(nrm), col: new Float32Array(col) };
  if (paintable) m.paint = new Float32Array(paint);
  return m;
}

/** Центр основания модели - в начало координат (у Kenney Industrial модели смещены). */
function center(pos: number[]) {
  let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
  for (let i = 0; i < pos.length; i += 3) {
    x0 = Math.min(x0, pos[i]); x1 = Math.max(x1, pos[i]);
    z0 = Math.min(z0, pos[i + 2]); z1 = Math.max(z1, pos[i + 2]);
  }
  const cx = (x0 + x1) / 2, cz = (z0 + z1) / 2;
  for (let i = 0; i < pos.length; i += 3) { pos[i] -= cx; pos[i + 2] -= cz; }
}

const paintCache = new WeakMap<Model, Map<string, Model>>();

/** Модель Kenney в цветах палитры: wall - стены, trim - крыша и отделка. Копии кэшируются. */
export function painted(m: Model, wall: number, trim: number): Model {
  if (!m.paint) return m;
  let byColor = paintCache.get(m);
  if (!byColor) paintCache.set(m, byColor = new Map());
  const key = `${wall}:${trim}`;
  let out = byColor.get(key);
  if (out) return out;
  const w = new THREE.Color(wall), t = new THREE.Color(trim);
  const col = new Float32Array(m.col);
  for (let i = 0; i < m.paint.length; i++) {
    const k = m.paint[i];
    if (k === 0) continue;
    const c = k > 0 ? w : t, f = Math.abs(k);
    col[i * 3] = Math.min(1, c.r * f); col[i * 3 + 1] = Math.min(1, c.g * f); col[i * 3 + 2] = Math.min(1, c.b * f);
  }
  out = { pos: m.pos, nrm: m.nrm, col };
  byColor.set(key, out);
  return out;
}

/** Затенение у земли: низ стен темнее, к высоте AO_HEIGHT сходит на нет. Плоские модели не трогаем. */
const AO_HEIGHT = 0.5, AO_MIN = 0.6;

function ambientOcclusion(pos: number[], col: number[], paint: number[] | null) {
  let lo = Infinity, hi = -Infinity;
  for (let i = 1; i < pos.length; i += 3) { lo = Math.min(lo, pos[i]); hi = Math.max(hi, pos[i]); }
  if (hi - lo < 0.2) return;
  for (let i = 0; i < pos.length; i += 3) {
    const k = THREE.MathUtils.smoothstep(pos[i + 1] - lo, 0, AO_HEIGHT);
    const f = AO_MIN + (1 - AO_MIN) * k;
    col[i] *= f; col[i + 1] *= f; col[i + 2] *= f;
    if (paint) paint[i / 3] *= f;
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
  const [tex, kcTex, kiTex] = await Promise.all([loadPalette(), loadPalette(`${KC_DIR}Textures/colormap.png`), loadPalette(`${KI_DIR}Textures/colormap.png`)]);
  const loader = new GLTFLoader();
  await Promise.all([
    ...NAMES.map(async (name) => {
      const gltf = await loader.loadAsync(`${DIR}${name}.gltf`);
      const m = bake(gltf.scene, tex);
      MODELS[name] = name.startsWith('building_') ? addBackFacade(m) : m;
    }),
    ...KC_NAMES.map(async (name) => { KC[name] = bake((await loader.loadAsync(`${KC_DIR}${name}.glb`)).scene, kcTex, true); }),
    ...KI_NAMES.map(async (name) => { KI[name] = bake((await loader.loadAsync(`${KI_DIR}${name}.glb`)).scene, kiTex, true); }),
    ...NATURE_NAMES.map(async (name) => { NATURE[name] = bake((await loader.loadAsync(`${NATURE_DIR}${name}.glb`)).scene, null, false, true, NATURE_COLORS, false); }),
    ...PROP_NAMES.map(async (name) => { PROPS[name] = bake((await loader.loadAsync(`${PROPS_DIR}${name}.gltf`)).scene, null, false, true); }),
  ]);
}
