// Сцена с кольцами (plan.md 011, задача 3.2, только dev): витрина плюс участок ровной земли,
// где стоят два кольца - с четырьмя примыканиями на перекрёстке и с двумя на прямой улице.
// Открывается ссылкой ?ring; точки камеры - avi.ringShot(n).

import type * as THREE from 'three';
import { applyCommand, type World } from '@avi/sim';
import type { CameraRig } from '../input/cameraRig';
import { buildShowcase } from './showcase';

/** Перекрёсток с кольцом: горизонтальная улица y = 40 и вертикальная x = 12. */
const RING_Y = 40;
const CROSS_X = 12;
/** Второе кольцо на прямой улице - только две связи, по x. */
const TWO_X = 20;

/**
 * Витрина и на её южной окраине - два кольца: одно на перекрёстке улиц (четыре
 * примыкания), второе на прямой улице (два). Днём и ночью сцена годится для снимков.
 */
export function buildRoundaboutCity(): World {
  const w = buildShowcase();
  for (let x = 4; x <= 25; x++) applyCommand(w, { type: 'buildRoad', x, y: RING_Y });
  for (let y = 32; y <= 48; y++) applyCommand(w, { type: 'buildRoad', x: CROSS_X, y });
  for (const x of [CROSS_X, TWO_X]) applyCommand(w, { type: 'placeRoundabout', x, y: RING_Y });
  w.events.length = 0;
  return w;
}

/** Три точки камеры: 0 - кольцо с четырьмя примыканиями, 1 - оба кольца, 2 - с двумя, 3 - въезд. */
const SHOTS = [
  { name: 'перекрёсток', x: CROSS_X + 0.5, z: RING_Y + 0.5, zoom: 3.4 },
  { name: 'оба кольца', x: (CROSS_X + TWO_X) / 2 + 0.5, z: RING_Y + 0.5, zoom: 2.1 },
  { name: 'два примыкания', x: TWO_X + 0.5, z: RING_Y + 0.5, zoom: 3.4 },
  { name: 'въезд', x: CROSS_X + 0.5, z: RING_Y - 0.4, zoom: 7 },
];

/** Точка камеры n: сразу, без плавного подлёта. */
export function ringShot(rig: CameraRig, n: number) {
  const s = SHOTS[n];
  if (!s) {
    console.warn(`roundaboutCity.ringShot: точки ${n} нет, есть 0..${SHOTS.length - 1}`);
    return;
  }
  const r = rig as unknown as { target: THREE.Vector3; zoomGoal: number; azimuth: number; azimuthGoal: number };
  r.target.set(s.x, 0, s.z);
  r.zoomGoal = s.zoom;
  r.azimuth = r.azimuthGoal = Math.PI / 4;
  rig.update(0);
}

/** Подключение к игре: ?ring - сцена вместо сохранения, ?ring&shot=N - точка камеры. */
export function attach(rig: CameraRig, params: URLSearchParams) {
  Object.assign((window as unknown as { avi: object }).avi, { buildRoundaboutCity, ringShot: (n: number) => ringShot(rig, n) });
  if (!params.has('ring')) return;
  // Камера ставится последней: штатные точки сцен грузятся вторым запросом
  if (params.has('shot')) setTimeout(() => ringShot(rig, Number(params.get('shot'))), 1500);
}
