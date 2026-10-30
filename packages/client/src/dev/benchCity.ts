// Эталонный город и фиксированные точки камеры для замеров и снимков "до/после" (plan.md, этап 0).
// Только dev: main.tsx подключает модуль динамическим импортом под import.meta.env.DEV.

import type * as THREE from 'three';
import { applyCommand, createWorld, newWasteland, reveal, serialize, step, tileAt, TICKS_PER_DAY, type World, type ZoneType } from '@avi/sim';
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
  w.nextBandDay = 100000;
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

/**
 * Тестовая сцена рисованных спрайтов (прототип 009): новая игра у бункера, дорога вдоль ворот
 * и съезд от неё, открытая округа. Сохранение игрока откладывается в резервную копию.
 */
export function buildSpriteDemo(): World {
  const w = newWasteland(2026, 64);
  w.money = 900000;
  const root = w.bunker!.root, x0 = root % w.size, y0 = Math.floor(root / w.size);
  reveal(w, x0 + 1, y0 + 1, 14);
  // Дорога вдоль той стороны бункера, где больше суши, и съезд от неё наружу
  const sides: [number, number][] = [[0, 1], [1, 0], [0, -1], [-1, 0]];
  const line = ([dx, dy]: [number, number], k: number, out: number) => {
    const ux = dy ? 1 : 0, uy = dx ? 1 : 0;
    return { x: x0 + 1 + dx * (2 + out) + ux * k, y: y0 + 1 + dy * (2 + out) + uy * k };
  };
  const dry = (d: [number, number]) => {
    let n = 0;
    for (let k = -7; k <= 7; k++) {
      const c = line(d, k, 0), t = tileAt(w, c.x, c.y);
      if (t && t.terrain !== 'water' && t.terrain !== 'rock') n++;
    }
    return n;
  };
  const side = sides.reduce((a, b) => (dry(b) > dry(a) ? b : a));
  for (let k = -7; k <= 7; k++) applyCommand(w, { type: 'buildRoad', ...line(side, k, 0) });
  for (let out = 1; out <= 6; out++) applyCommand(w, { type: 'buildRoad', ...line(side, 4, out) });
  w.events.length = 0;
  return w;
}

/**
 * Город вокруг бункера для сравнения с макетом Avi (прототип 009): новая игра, сетка улиц,
 * жильё и торговля у бункера, промзона и фермы с краю, службы; вокруг - пустошь с руинами.
 */
export function buildSpriteCity(): World {
  const w = newWasteland(2026, 64);
  w.money = 900000;
  const r = w.bunker!.root, bx = r % w.size, by = Math.floor(r / w.size);
  const cx = bx + 1, cy = by + 1;
  reveal(w, cx, cy, 26);
  const X0 = Math.max(3, bx - 15), X1 = Math.min(w.size - 4, bx + 17), Y0 = Math.max(3, by - 13), Y1 = Math.min(w.size - 4, by + 15);
  const inBunker = (x: number, y: number) => x >= bx && x <= bx + 2 && y >= by && y <= by + 2;
  for (let y = Y0; y <= Y1; y++) {
    for (let x = X0; x <= X1; x++) {
      if (inBunker(x, y)) continue;
      Object.assign(tileAt(w, x, y)!, { terrain: (x + y) % 5 ? 'wasteland' : 'soil', object: 'none', zone: null, level: 0, root: -1, def: null });
    }
  }
  const rows: number[] = [], cols: number[] = [];
  for (let y = by - 1; y >= Y0; y -= 6) rows.push(y);
  for (let y = by + 3; y <= Y1; y += 6) rows.push(y);
  for (let x = bx - 1; x >= X0; x -= 7) cols.push(x);
  for (let x = bx + 3; x <= X1; x += 7) cols.push(x);
  const xa = Math.min(...cols), xb = Math.max(...cols), ya = Math.min(...rows), yb = Math.max(...rows);
  for (const y of rows) for (let x = xa; x <= xb; x++) applyCommand(w, { type: 'buildRoad', x, y });
  for (const x of cols) for (let y = ya; y <= yb; y++) applyCommand(w, { type: 'buildRoad', x, y });
  // Службы - вплотную к дорогам, до разметки зон
  const place = (def: string, x: number, y: number) => {
    for (let k = 0; k < 8; k++) for (const [dx, dy] of [[0, 0], [1, 0], [0, 1], [-1, 0], [0, -1], [1, 1], [-1, -1]]) {
      if (applyCommand(w, { type: 'placeBuilding', def, x: x + dx * k, y: y + dy * k }).ok) return;
    }
  };
  place('plant', xb - 4, yb - 3);
  place('plant', xb - 4, ya + 2);
  place('plant', xa + 3, ya + 2);
  place('pump', bx + 12, by - 8);
  place('pump', bx + 5, by - 3);
  place('pump', bx - 4, by + 5);
  place('school', bx - 6, by - 4);
  place('clinic', bx + 6, by + 5);
  place('aa_phoenix', bx + 1, by - 3);
  // Зоны по сторонам от бункера: жильё ближе, торговля у главной улицы, промзона и фермы с краю
  for (let y = ya + 1; y < yb; y++) {
    for (let x = xa + 1; x < xb; x++) {
      const t = tileAt(w, x, y)!;
      if (t.object !== 'none') continue;
      const dx = x - cx, dy = y - cy, d = Math.max(Math.abs(dx), Math.abs(dy));
      let zone: ZoneType;
      if (dy > 8 && dx < -2) zone = 'A';
      else if (dx > 9 && dy > 2) zone = 'I';
      else if (d <= 5 || (Math.abs(dy) <= 2 && d <= 11)) zone = 'C';
      else zone = 'R';
      applyCommand(w, { type: 'zone', rect: { x0: x, y0: y, x1: x, y1: y }, zone });
    }
  }
  w.nextRaidDay = 100000;
  w.nextBandDay = 100000;
  for (let i = 0; i < 260; i++) {
    w.money = 900000;
    step(w, TICKS_PER_DAY);
  }
  w.events.length = 0;
  return w;
}

/** window.avi.spriteCity(): собрать город для сравнения с макетом и открыть его на ?sprites&hour=14. */
export function spriteCity() {
  openSpriteWorld(buildSpriteCity(), 'spritecity');
}

function openSpriteWorld(world: World, param: string) {
  const old = localStorage.getItem(SAVE_KEY);
  if (old) localStorage.setItem(`${SAVE_KEY}.backup-${Date.now()}`, old);
  const data = serialize(world);
  localStorage.setItem(SAVE_KEY, data);
  window.addEventListener('beforeunload', () => localStorage.setItem(SAVE_KEY, data));
  const url = new URL(location.href);
  url.searchParams.delete(param);
  url.searchParams.delete('seed');
  url.searchParams.delete('sandbox');
  url.searchParams.set('hour', '14');
  url.searchParams.set('sprites', '');
  location.href = url.toString();
}

/** window.avi.spriteDemo(): собрать тестовую сцену и открыть её на ?sprites&hour=13. */
export function spriteDemo() {
  openSpriteWorld(buildSpriteDemo(), 'spritedemo');
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
