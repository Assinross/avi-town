// Страница ?props: все предметы render/props/ в ряд для приёмки по снимку (plan.md, этап 0).
// Только dev: main.tsx подключает модуль динамическим импортом под import.meta.env.DEV.
// Сцена - обычная SceneView (тот же свет, тени и контур, что в игре) на ровном пустыре с дорогой.

import * as THREE from 'three';
import { applyCommand, createWorld, tileAt, type World } from '@avi/sim';
import type { CameraRig } from '../input/cameraRig';
import { GeoBuilder } from '../render/builder';
import { roadTop } from '../render/cityMap';
import { MODELS } from '../render/models';
import { placeProp, propMesh, propScale, PROPS, VEHICLES, type PropDef } from '../render/props';
import type { SceneView } from '../render/sceneView';

/** Дорога для машин - ряд клеток по x на этой строке; предметы стоят на газоне севернее. */
const ROAD_Y = 33;
const ROAD_X0 = 18, ROAD_X1 = 46;
/** Первый предмет ряда; варианты идут по x с шагом под размер предмета. */
const X0 = 26;
const ROW_STEP = 0.75;
/** Легковая KayKit на улицах (traffic.ts): эталон масштаба машин. */
const KAY_CAR = 0.25, KAY_WHEEL_DROP = 0.061;

/** Ровный пустырь 64x64 с отрезком дороги, без тумана, бункера, налётов и жителей. */
export function propsWorld(): World {
  const w = createWorld(7, 64);
  w.money = 900000;
  for (let y = 0; y < w.size; y++) {
    for (let x = 0; x < w.size; x++) Object.assign(tileAt(w, x, y)!, { terrain: 'soil', object: 'none', zone: null, level: 0, root: -1, def: null });
  }
  for (let x = ROAD_X0; x <= ROAD_X1; x++) applyCommand(w, { type: 'buildRoad', x, y: ROAD_Y });
  w.nextRaidDay = 100000;
  w.nextBandDay = 100000;
  w.events.length = 0;
  return w;
}

/** Шаг между вариантами: длина предмета (по x в метрах) и зазор. */
function spacing(def: PropDef, along: 'x' | 'z'): number {
  const m = new GeoBuilder();
  placeProp(m, def, 0, 0, 0, 0, 0);
  const box = new THREE.Box3().setFromBufferAttribute(m.build().getAttribute('position') as THREE.BufferAttribute);
  const size = along === 'x' ? box.max.x - box.min.x : box.max.z - box.min.z;
  return size + Math.max(0.08, size * 0.5);
}

/** Выставить все предметы и машины в сцену, подписи над рядами, камеру - на них. */
export function showProps(view: SceneView, rig: CameraRig) {
  const material = new THREE.MeshLambertMaterial({ vertexColors: true });
  const labels: { text: string; at: THREE.Vector3 }[] = [];

  // Предметы: каждый - ряд вариантов на газоне, склейкой в один меш (как дворы участка)
  const g = new GeoBuilder();
  PROPS.forEach((def, r) => {
    const z = ROAD_Y - 0.6 - r * ROW_STEP, step = spacing(def, 'x');
    for (let v = 0; v < def.variants; v++) placeProp(g, def, v, X0 + v * step, 0, z);
    labels.push({ text: `${def.name} - ${def.variants} вар.`, at: new THREE.Vector3(X0 - 0.15, 0.25, z) });
  });
  const mesh = new THREE.Mesh(g.build(), material);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  view.scene.add(mesh);

  // Машины: по правой полосе на восток, пачками InstancedMesh (как traffic.ts)
  const top = roadTop(), lane = ROAD_Y + 0.5 + 0.16, yaw = -Math.PI / 2;
  const tmp = new THREE.Object3D();
  let x = X0;
  for (const def of VEHICLES) {
    const step = spacing(def, 'z');
    labels.push({ text: `${def.name} - ${def.variants} вар.`, at: new THREE.Vector3(x - 0.2, 0.3, lane) });
    for (let v = 0; v < def.variants; v++, x += step) {
      const m = propMesh(def, v, 1, material);
      tmp.position.set(x, top, lane);
      tmp.rotation.set(0, yaw, 0);
      tmp.updateMatrix();
      m.setMatrixAt(0, tmp.matrix);
      view.scene.add(m);
    }
    x += 0.3;
  }
  // Эталон масштаба: легковая KayKit со встречной полосы
  const ref = new GeoBuilder();
  ref.model(MODELS.car_sedan, X0, top + KAY_WHEEL_DROP * KAY_CAR, ROAD_Y + 0.5 - 0.16, KAY_CAR, Math.PI / 2);
  const refMesh = new THREE.Mesh(ref.build(), material);
  refMesh.castShadow = true;
  view.scene.add(refMesh);
  labels.push({ text: 'эталон: легковая KayKit', at: new THREE.Vector3(X0 - 0.2, 0.3, ROAD_Y + 0.34) });
  console.info(`?props: ${PROPS.length} предметов, ${VEHICLES.length} машин; масштаб машин ${propScale(VEHICLES[0] ?? PROPS[0]).toFixed(3)} на метр`);

  // Камера: крупный план над рядами, без плавного подлёта
  const r = rig as unknown as { target: THREE.Vector3; zoomGoal: number; azimuth: number; azimuthGoal: number };
  r.target.set(X0 + 0.6, 0, ROAD_Y);
  r.zoomGoal = 10;
  r.azimuth = r.azimuthGoal = Math.PI / 4;
  rig.update(0);

  // Подписи - HTML поверх холста, каждый кадр в экранные координаты
  const layer = document.createElement('div');
  layer.style.cssText = 'position:fixed;inset:0;pointer-events:none;z-index:5';
  document.body.appendChild(layer);
  const tags = labels.map(({ text }) => {
    const el = document.createElement('div');
    el.textContent = text;
    el.style.cssText = 'position:absolute;transform:translate(-100%,-50%);font:600 12px system-ui;color:#3b2f26;background:#f2e6ccd9;padding:2px 6px;border-radius:4px;white-space:nowrap';
    layer.appendChild(el);
    return el;
  });
  const p = new THREE.Vector3();
  const place = () => {
    labels.forEach(({ at }, i) => {
      p.copy(at).project(rig.camera);
      tags[i].style.left = `${((p.x + 1) / 2) * window.innerWidth}px`;
      tags[i].style.top = `${((1 - p.y) / 2) * window.innerHeight}px`;
    });
    requestAnimationFrame(place);
  };
  place();
}
