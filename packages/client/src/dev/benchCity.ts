// Эталонный город и фиксированные точки камеры для замеров и снимков "до/после" (plan.md, этап 0).
// Только dev: main.tsx подключает модуль динамическим импортом под import.meta.env.DEV.

import type * as THREE from 'three';
import { applyCommand, createWorld, serialize, step, tileAt, TICKS_PER_DAY, type World, type ZoneType } from '@avi/sim';
import type { CameraRig } from '../input/cameraRig';

const SAVE_KEY = 'avi-town.save';

/** Полосы зон по x внутри каждого квартала между улицами. */
const ZONES: [ZoneType, number, number][] = [['R', 6, 30], ['C', 32, 44], ['I', 46, 52], ['A', 53, 58]];
/** Здания вдоль верхней улицы: id и x. */
const BUILDINGS: [string, number][] = [['plant', 6], ['plant', 10], ['pump', 14], ['pump', 17], ['school', 20], ['clinic', 24], ['plant', 28]];

/**
 * Город 64x64 без тумана и бункера (createWorld - песочница): улицы через 6 клеток, жильё,
 * торговля, промзона, фермы, завод, насос, школа, лазарет, 300 дней роста - ~2600 жителей.
 */
export function buildBenchCity(): World {
  const w = createWorld(7, 64);
  w.money = 900000;
  for (let y = 4; y < 60; y++) {
    for (let x = 4; x < 60; x++) Object.assign(tileAt(w, x, y)!, { terrain: 'soil', object: 'none', zone: null, level: 0, root: -1, def: null });
  }
  for (let y = 6; y < 58; y += 6) for (let x = 5; x < 59; x++) applyCommand(w, { type: 'buildRoad', x, y });
  for (let x = 5; x < 59; x += 9) for (let y = 6; y < 55; y++) applyCommand(w, { type: 'buildRoad', x, y });
  for (let y = 6; y <= 48; y += 6) {
    for (let yy = y + 1; yy <= y + 5; yy++) {
      for (const [zone, x0, x1] of ZONES) {
        for (let x = x0; x <= x1; x++) {
          if (tileAt(w, x, yy)?.object === 'road') continue;
          applyCommand(w, { type: 'zone', rect: { x0: x, y0: yy, x1: x, y1: yy }, zone });
        }
      }
    }
  }
  // Здания вплотную к верхней улице: ищем первое место снизу вверх
  for (const [def, x] of BUILDINGS) {
    for (let y = 5; y >= 1; y--) if (applyCommand(w, { type: 'placeBuilding', def, x, y }).ok) break;
  }
  w.nextRaidDay = 100000;
  for (let i = 0; i < 300; i++) {
    w.money = 900000;
    step(w, TICKS_PER_DAY);
  }
  return w;
}

/** window.avi.benchCity(): собрать эталонный город, сохранить и открыть его на ?hour=13. */
export function benchCity() {
  const w = buildBenchCity();
  const data = serialize(w);
  localStorage.setItem(SAVE_KEY, data);
  // Без ?hour игра при уходе со страницы сохраняет текущий город - возвращаем эталонный после неё
  window.addEventListener('beforeunload', () => localStorage.setItem(SAVE_KEY, data));
  console.info(`Эталонный город: ${w.stats.population} жителей, ${w.stats.jobs} рабочих мест, день ${w.day}`);
  const url = new URL(location.href);
  url.searchParams.delete('seed');
  url.searchParams.delete('bench');
  url.searchParams.set('hour', '13');
  url.searchParams.set('sandbox', '');
  location.href = url.toString();
}

/** Фиксированные точки камеры: 0 - общий план, 1 - жильё, 2 - торговля, 3 - край карты. */
const SHOTS = [
  { x: 32, z: 32, zoom: 1 },
  { x: 18, z: 20, zoom: 3 },
  { x: 38, z: 26, zoom: 3 },
  { x: 58, z: 58, zoom: 2 },
];

/** window.avi.shot(n): поставить камеру в точку n сразу, без плавного подлёта. */
export function shot(rig: CameraRig, n: number) {
  const s = SHOTS[n];
  if (!s) {
    console.warn(`avi.shot: точки ${n} нет, есть 0..${SHOTS.length - 1}`);
    return;
  }
  // Поля камеры закрыты от игры - для замеров ставим их напрямую
  const r = rig as unknown as { target: THREE.Vector3; zoomGoal: number; azimuth: number; azimuthGoal: number };
  r.target.set(s.x, 0, s.z);
  r.zoomGoal = s.zoom;
  r.azimuth = r.azimuthGoal = Math.PI / 4;
  rig.update(0); // k = 1: сразу в цель
}
