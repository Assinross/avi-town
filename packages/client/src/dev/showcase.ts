// Сцена-витрина для снимков "до/после" (plan.md, этап 0): ровная площадка, главная улица
// с перекрёстком, по одному дому каждого типа зоны и по одному зданию каждого вида - в ряд.
// Только dev: main.tsx подключает модуль динамическим импортом под import.meta.env.DEV.

import type * as THREE from 'three';
import { BUILDING_BY_ID } from '@avi/data';
import { applyCommand, createWorld, DIRS, markChanged, serialize, setLot, tileAt, type World, type ZoneType } from '@avi/sim';
import type { CameraRig } from '../input/cameraRig';

const SAVE_KEY = 'avi-town.save';
const SIZE = 64;
/** Главная улица - горизонтальная, поперечная - вертикальная; перекрёсток на их пересечении. */
const MAIN_Y = 16, CROSS_X = 30;
const STREET_X0 = 4, STREET_X1 = 54;
const CROSS_Y0 = 6, CROSS_Y1 = 24;
/** Фасады северной и южной стороны главной улицы: дома стоят вплотную к дороге. */
const FRONT_NORTH = MAIN_Y - 1, FRONT_SOUTH = MAIN_Y + 1;

/**
 * Дома вдоль главной улицы: зона, уровень, главная клетка у дороги, ширина вдоль улицы, глубина.
 * Северная сторона: участок растёт вглубь (в -y) и вдоль улицы (в -x).
 */
const LOTS: [ZoneType, number, number, number, number, number][] = [
  ['R', 1, 7, FRONT_NORTH, 1, 1],
  ['R', 2, 11, FRONT_NORTH, 1, 2],
  ['R', 3, 15, FRONT_NORTH, 2, 2],
  ['C', 1, 20, FRONT_NORTH, 1, 1],
  ['C', 2, 24, FRONT_NORTH, 2, 1],
  ['C', 3, 27, FRONT_NORTH, 2, 2],
];

/** Промзона и фермы вдоль южной стороны главной улицы (растут по клеткам, без участков). */
const SINGLES: [ZoneType, number, number][] = [
  ['I', 1, 7], ['I', 2, 10], ['I', 3, 13],
  ['A', 1, 17], ['A', 2, 20], ['A', 3, 23],
];

/**
 * Службы и техника в двух рядах вдоль главной улицы к востоку от перекрёстка:
 * северный ряд - производство и лаборатории, южный - службы и ПВО.
 */
const NORTH_DEFS = ['plant', 'pump', 'mine', 'lab', 'lab2', 'lab3', 'workshop', 'radar'];
const SOUTH_DEFS = ['outpost', 'school', 'clinic', 'aa_avalanche', 'aa_phoenix', 'aa_laser', 'aa_plasma', 'aa_fusion'];
/** Исследования, без которых часть зданий не поставить (лаборатории, ПВО, выезд отряда). */
const TECHS = ['Xenobiology', 'LaserWeapons', 'AlienMaterials', 'Plasma_Cannon', 'Fusion_Launcher', 'RapidResponse'];

/** Клетки участка с главной клеткой root: форма как в lots.ts (dir - где дорога, side - куда вдоль улицы). */
function lotCells(root: number, side: number, w: number, d: number, dir = 2): number[] {
  const [dx, dy] = DIRS[dir];
  const px = -dy * side, py = dx * side;
  const x0 = root % SIZE, y0 = Math.floor(root / SIZE);
  const out: number[] = [];
  for (let f = 0; f < d; f++) {
    for (let u = 0; u < w; u++) out.push((y0 + u * py - f * dy) * SIZE + (x0 + u * px - f * dx));
  }
  return out;
}

/** Ряд зданий вдоль главной улицы: north - северная сторона, south - южная. */
function placeRow(w: World, defs: string[], north: boolean) {
  let x = CROSS_X + 2;
  for (const id of defs) {
    const size = BUILDING_BY_ID[id].size;
    const y = north ? FRONT_NORTH - size + 1 : FRONT_SOUTH;
    // Шахта ставится только на камнях или заражённой земле
    if (id === 'mine') {
      for (let dy = 0; dy < size; dy++) {
        for (let dx = 0; dx < size; dx++) {
          const t = tileAt(w, x + dx, y + dy);
          if (t) t.terrain = 'rock';
        }
      }
    }
    const res = applyCommand(w, { type: 'placeBuilding', def: id, x, y });
    if (!res.ok) console.warn(`showcase: здание ${id} не встало (${res.reason})`);
    x += size + 1;
  }
}

/**
 * Витрина: песочница 64x64 без тумана и бункера, вся земля - ровный газон; главная улица
 * с перекрёстком, у западной части улицы шесть участков (жильё и торговля уровней 1-3,
 * промзона и фермы уровней 1-3), у восточной - 16 зданий служб и техники в два ряда.
 */
export function buildShowcase(): World {
  const w = createWorld(10, SIZE);
  w.money = 900000;
  // Запас на всё ПВО: лазеру и плазме нужны сплавы и элерий
  w.resources = { metal: 2000, alloys: 200, elerium: 200, fragments: 200 };
  w.research.done = [...TECHS];
  // Ровная площадка: сухая земля, ни деревьев, ни руин
  for (const t of w.tiles) {
    t.terrain = 'soil';
    t.object = 'none';
    t.zone = null;
    t.level = 0;
    t.root = -1;
    t.def = null;
    t.build = 0;
    t.lot = 0;
  }
  for (let x = STREET_X0; x <= STREET_X1; x++) applyCommand(w, { type: 'buildRoad', x, y: MAIN_Y });
  for (let y = CROSS_Y0; y <= CROSS_Y1; y++) applyCommand(w, { type: 'buildRoad', x: CROSS_X, y });
  // Дома: сперва размечаем участок зоной, потом ставим готовый дом нужного уровня
  for (const [zone, level, x, y, lw, ld] of LOTS) {
    const root = y * SIZE + x;
    const cells = lotCells(root, 1, lw, ld);
    for (const c of cells) applyCommand(w, { type: 'zone', rect: { x0: c % SIZE, y0: Math.floor(c / SIZE), x1: c % SIZE, y1: Math.floor(c / SIZE) }, zone });
    w.tiles[root].variant = (x * 17 + y * 31 + level * 7) & 255;
    setLot(w, root, level, 0, { dir: 2, side: 1, w: lw, d: ld }, cells);
  }
  for (const [zone, level, x] of SINGLES) {
    const y = FRONT_SOUTH;
    applyCommand(w, { type: 'zone', rect: { x0: x, y0: y, x1: x, y1: y }, zone });
    const t = tileAt(w, x, y)!;
    t.level = level;
    t.variant = (x * 23 + y * 41 + level * 11) & 255;
    markChanged(w, y * SIZE + x);
  }
  placeRow(w, NORTH_DEFS, true);
  placeRow(w, SOUTH_DEFS, false);
  // Витрина показывает готовые здания: без этого на месте домов стоят леса и краны
  for (const t of w.tiles) if (t.object === 'building' && t.build > 0) t.build = 0;
  // В витрине никто не нападает: она нужна только для снимков
  w.nextRaidDay = 100000;
  w.nextBandDay = 100000;
  w.events.length = 0;
  return w;
}

/**
 * ?showcase: собрать витрину, сохранить её и открыть на ?town=showcase&hour=13.
 * Параметр ?town=showcase остаётся в адресе - по нему страница отдаёт точки камеры витрины;
 * ?showcase убираем, чтобы перезагрузка не строила сцену заново.
 */
export function showcase() {
  const w = buildShowcase();
  // Город игрока - в резервную копию, как у spriteCity: витрина пишется поверх сохранения
  const old = localStorage.getItem(SAVE_KEY);
  if (old) localStorage.setItem(`${SAVE_KEY}.backup-${Date.now()}`, old);
  const data = serialize(w);
  localStorage.setItem(SAVE_KEY, data);
  // Игра на уходе со страницы сохраняет текущий город - возвращаем витрину после неё
  window.addEventListener('beforeunload', () => localStorage.setItem(SAVE_KEY, data));
  const houses = w.tiles.filter((t) => t.object === 'zone' && t.level > 0).length;
  const defs = w.tiles.filter((t, i) => t.object === 'building' && t.root === i).length;
  console.info(`Витрина: клеток зон с застройкой ${houses}, зданий ${defs}`);
  const url = new URL(location.href);
  url.searchParams.delete('showcase');
  url.searchParams.delete('seed');
  url.searchParams.delete('bench');
  url.searchParams.set('town', 'showcase');
  if (!url.searchParams.has('hour')) url.searchParams.set('hour', '13');
  url.searchParams.set('sandbox', '');
  location.href = url.toString();
}

/** Четыре точки камеры: 0 - обзор, 1 - улица, 2 - двор, 3 - перекрёсток. */
const SHOTS = [
  { name: 'обзор', x: 29, z: 15, zoom: 1.05 },
  { name: 'улица', x: 16.5, z: 16, zoom: 2.4 },
  { name: 'двор', x: 15, z: 15, zoom: 5.5 },
  { name: 'перекрёсток', x: 30.5, z: 16, zoom: 3 },
];

/** Точка камеры витрины n: сразу, без плавного подлёта. */
export function shot(rig: CameraRig, n: number) {
  const s = SHOTS[n];
  if (!s) {
    console.warn(`showcase.shot: точки ${n} нет, есть 0..${SHOTS.length - 1}`);
    return;
  }
  // Поля камеры закрыты от игры - для снимков ставим их напрямую
  const r = rig as unknown as { target: THREE.Vector3; zoomGoal: number; azimuth: number; azimuthGoal: number };
  r.target.set(s.x, 0, s.z);
  r.zoomGoal = s.zoom;
  r.azimuth = r.azimuthGoal = Math.PI / 4;
  rig.update(0); // k = 1: сразу в цель
}

/**
 * Подключение к игре: ?showcase - собрать витрину; ?town=showcase - точки камеры витрины
 * для ?shot=N. Остальные адреса модуль не трогает.
 */
export function attach(rig: CameraRig, params: URLSearchParams) {
  Object.assign((window as unknown as { avi: object }).avi, { showcase, buildShowcase, showcaseShot: (n: number) => shot(rig, n) });
  if (params.has('showcase')) {
    showcase();
    return;
  }
  if (params.get('town') !== 'showcase') return;
  Object.assign((window as unknown as { avi: object }).avi, { shot: (n: number) => shot(rig, n) });
  // Ставим камеру последней: штатные точки из benchCity отрабатывают позже (модуль грузится
  // вторым запросом), поэтому ждём, пока страница успокоится
  if (params.has('shot')) setTimeout(() => shot(rig, Number(params.get('shot'))), 1500);
}
