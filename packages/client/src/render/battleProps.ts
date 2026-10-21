// Модели укрытий-пропсов тактического боя: Quaternius Toon Shooter Game Kit (CC0).
// Источник и лицензия - public/models/quaternius/README.md.
// Шаблоны грузятся один раз, нормализуются по габаритам (клетка боя - CELL, высота - из def),
// на каждый пропс клонируются через Object3D.clone(true): геометрии и материалы общие,
// поэтому disposePropView их не трогает.

import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { COVERS, COVER_BY_ID } from '@avi/data';
import { CELLS, type CoverProp } from '@avi/sim';

const CELL = 1 / CELLS;
const DIR = `${import.meta.env.BASE_URL}models/quaternius/props/`;

/** Нормализованные шаблоны моделей и обломков по имени файла без расширения. */
const TEMPLATES = new Map<string, THREE.Object3D>();

/** Масштаб под клетку и высоту укрытия; центр по X/Z в ноль, низ по Y в ноль. */
function normalize(scene: THREE.Object3D, height: number): THREE.Object3D {
  scene.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(scene);
  const size = box.getSize(new THREE.Vector3());
  const center = box.getCenter(new THREE.Vector3());
  const scale = Math.min(
    (CELL * 0.92) / Math.max(size.x, size.z, 0.01),
    height / Math.max(size.y, 0.01),
  );
  scene.scale.setScalar(scale);
  scene.position.set(-center.x * scale, -box.min.y * scale, -center.z * scale);
  const root = new THREE.Group();
  root.add(scene);
  return root;
}

/** Загрузить все уникальные модели и обломки укрытий. Ошибка модели - пропс нарисуется коробкой. */
export async function loadBattleProps(): Promise<void> {
  const heights = new Map<string, number>();
  for (const c of COVERS) {
    if (!heights.has(c.model)) heights.set(c.model, c.height);
    if (!heights.has(c.debris)) heights.set(c.debris, c.height);
  }
  const loader = new GLTFLoader();
  await Promise.all([...heights].map(async ([name, height]) => {
    try {
      const gltf = await loader.loadAsync(`${DIR}${name}.gltf`);
      TEMPLATES.set(name, normalize(gltf.scene, height));
    } catch (e) {
      console.warn(`Модель укрытия не загрузилась: ${name}`, e);
    }
  }));
}

/** Общие настройки мешей: без контура, без теней. */
function tuneMeshes(o: THREE.Object3D): void {
  o.traverse((n) => {
    const mesh = n as THREE.Mesh;
    if (!mesh.isMesh) return;
    mesh.userData.noOutline = true;
    mesh.castShadow = false;
    mesh.receiveShadow = false;
  });
}

/**
 * Вид укрытия в текущем состоянии. null - шаблон не загружен, тогда рисуется запасная коробка.
 * whole - целая модель; broken - наклонённая модель и обломки; collapsed - только обломки.
 */
export function createPropView(p: CoverProp): THREE.Object3D | null {
  const def = COVER_BY_ID[p.kind];
  if (!def) return null;
  const model = TEMPLATES.get(def.model);
  const debris = TEMPLATES.get(def.debris);
  const root = new THREE.Group();

  if (p.state === 'collapsed') {
    if (!debris) return null;
    const d = debris.clone(true);
    d.scale.set(1, 0.5, 1);
    root.add(d);
  } else {
    if (!model) return null;
    const m = model.clone(true);
    if (p.state === 'broken') {
      if (!debris) return null;
      m.rotation.z = 0.12;
      m.position.y = -0.02;
      const d = debris.clone(true);
      d.scale.setScalar(0.6);
      root.add(d);
    }
    root.add(m);
  }

  tuneMeshes(root);
  return root;
}

/** Убрать пропс из сцены; общие геометрии и материалы шаблонов не освобождаются. */
export function disposePropView(o: THREE.Object3D): void {
  o.removeFromParent();
}
