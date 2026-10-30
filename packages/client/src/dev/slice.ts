// Срез одного квартала (plan.md, этап S): крестовый перекрёсток и участки вокруг - кирпичный дом
// с двором, двухэтажные дома, лавки и кафе, домики с участками, парковки; свободные клетки -
// газон и деревья, без голой земли. На нём доводятся до уровня CityRT камера, свет, улица,
// дома и дворы, прежде чем идти на весь город.
// ?slice - мир строится прямо при загрузке, сохранение игрока не трогается (как ?props).
// Только dev: main.tsx подключает модуль динамическим импортом под import.meta.env.DEV.

import type * as THREE from 'three';
import { applyCommand, createWorld, DIRS, setLot, shapeCells, type World, type ZoneType } from '@avi/sim';
import type { CameraRig } from '../input/cameraRig';
import { setRibbonStreets } from '../render/streets';

const SIZE = 64;
/** Перекрёсток - в центре карты: главная улица по x, поперечная по y. */
const CX = 32, CY = 32;
/** Улицы тянутся на ARM клеток от перекрёстка в обе стороны. */
const ARM = 17;
/** Насколько далеко от перекрёстка ставятся участки и деревья. */
const REACH = 14;

type Kind = `${'R' | 'C'}${1 | 2 | 3}`;
/** Размер участка по типу: [ширина вдоль улицы, глубина] - как LOT_SHAPES в sim. */
const SHAPE: Record<Kind, [number, number]> = { R1: [1, 1], R2: [1, 2], R3: [2, 2], C1: [1, 1], C2: [2, 1], C3: [2, 2] };

/**
 * Четыре стороны каждой улицы от перекрёстка: первая клетка у угла, шаг от угла, где дорога (DIRS)
 * и порядок участков. Камера по умолчанию смотрит с юго-востока: северо-запад - дальний план
 * (высокий кирпичный дом не закрывает остальное), юго-восток - ближний (низкие домики, парковка).
 */
const ARMS: { x: number; y: number; step: [number, number]; dir: number; kinds: Kind[] }[] = [
  // Северная сторона главной улицы: к западу - кафе на углу и кирпичный дом с двором
  { x: CX - 1, y: CY - 1, step: [-1, 0], dir: 2, kinds: ['C1', 'R3', 'R2', 'R1', 'R1', 'R2', 'C2', 'R1', 'R3'] },
  // ...к востоку - ларёк, магазин с парковкой, жильё
  { x: CX + 1, y: CY - 1, step: [1, 0], dir: 2, kinds: ['C1', 'C2', 'R2', 'R1', 'R3', 'R1', 'C1', 'R2'] },
  // Южная сторона главной улицы: к западу - кафе и двухэтажные дома, к востоку - парковка и домики
  { x: CX - 1, y: CY + 1, step: [-1, 0], dir: 3, kinds: ['C1', 'R2', 'R2', 'R1', 'R3', 'R1', 'R2', 'R1', 'C1'] },
  { x: CX + 1, y: CY + 1, step: [1, 0], dir: 3, kinds: ['C2', 'R1', 'R1', 'R2', 'R1', 'R2', 'R1', 'R1'] },
  // Поперечная улица: западная и восточная стороны, к северу и к югу от главной
  { x: CX - 1, y: CY - 1, step: [0, -1], dir: 0, kinds: ['R1', 'R2', 'R3', 'R1', 'C1', 'R2', 'R1', 'R1'] },
  { x: CX + 1, y: CY - 1, step: [0, -1], dir: 1, kinds: ['R1', 'R2', 'R3', 'C1', 'R1', 'R2', 'R1'] },
  { x: CX - 1, y: CY + 1, step: [0, 1], dir: 0, kinds: ['R1', 'R2', 'R1', 'R2', 'R1', 'R1', 'R2'] },
  { x: CX + 1, y: CY + 1, step: [0, 1], dir: 1, kinds: ['R1', 'R2', 'R1', 'R3', 'R1', 'R1'] },
];

/** Вариант дома: подобран, чтобы у угла стояли нужные виды (кафе с зонтиками, магазин с парковкой). */
const VARIANT: Partial<Record<Kind, number[]>> = {
  C1: [13, 8, 22, 25, 14],
  C2: [6, 3, 9],
  R3: [0, 1, 4],
};

const hash = (x: number, y: number) => (((x * 73856093) ^ (y * 19349663)) >>> 0) / 4294967296;

/** Сторона роста участка (side в LotShape), чтобы он шёл от угла вдоль улицы. */
function sideOf(dir: number, step: [number, number]): number {
  const [dx, dy] = DIRS[dir];
  // Как в shapeCells: вдоль улицы участок идёт на (-dy * side, dx * side)
  return dy !== 0 ? step[0] / -dy : step[1] / dx;
}

/** Участок нужного уровня с главной клеткой (x, y): зона, затем готовый дом. false - не влез. */
function placeLot(w: World, kind: Kind, x: number, y: number, dir: number, side: number, variant: number): boolean {
  const [lw, ld] = SHAPE[kind];
  const zone = kind[0] as ZoneType, level = Number(kind[1]);
  const s = { dir, side, w: lw, d: ld };
  const root = y * SIZE + x;
  const cells = shapeCells(w, root, s);
  if (!cells || cells.some((c) => w.tiles[c].object !== 'none')) return false;
  for (const c of cells) applyCommand(w, { type: 'zone', rect: { x0: c % SIZE, y0: Math.floor(c / SIZE), x1: c % SIZE, y1: Math.floor(c / SIZE) }, zone });
  w.tiles[root].variant = variant;
  setLot(w, root, level, 0, s, cells);
  return true;
}

export function buildSlice(): World {
  setRibbonStreets(true);
  const w = createWorld(7, SIZE);
  w.money = 900000;
  // Ровный газон: ни руин, ни камней, ни воды
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
  for (let d = -ARM; d <= ARM; d++) {
    applyCommand(w, { type: 'buildRoad', x: CX + d, y: CY });
    applyCommand(w, { type: 'buildRoad', x: CX, y: CY + d });
  }
  const used: Partial<Record<Kind, number>> = {};
  for (const arm of ARMS) {
    const side = sideOf(arm.dir, arm.step);
    let k = 0;
    for (let i = 0; i < REACH && k < arm.kinds.length; i++) {
      const x = arm.x + arm.step[0] * i, y = arm.y + arm.step[1] * i;
      const kind = arm.kinds[k];
      const list = VARIANT[kind];
      const n = used[kind] ?? 0;
      const variant = list ? list[n % list.length] : Math.floor(hash(x, y) * 256);
      // Не влез (угол занят соседней улицей) - домик поменьше или следующая клетка
      if (placeLot(w, kind, x, y, arm.dir, side, variant)) {
        used[kind] = n + 1;
        k++;
        i += SHAPE[kind][0] - 1;
      } else if (placeLot(w, 'R1', x, y, arm.dir, side, Math.floor(hash(x, y) * 256))) k++;
    }
  }
  // Свободная земля между участками - газон с деревьями: рощицы гуще дальше от улиц
  for (let y = CY - REACH; y <= CY + REACH; y++) {
    for (let x = CX - REACH; x <= CX + REACH; x++) {
      const t = w.tiles[y * SIZE + x];
      if (t.object !== 'none') continue;
      const far = Math.min(Math.abs(x - CX), Math.abs(y - CY));
      if (hash(x, y) < 0.25 + far * 0.04) {
        t.object = 'tree';
        t.variant = Math.floor(hash(y, x) * 256);
      }
    }
  }
  w.nextRaidDay = 100000;
  w.nextBandDay = 100000;
  w.events.length = 0;
  w.changes.length = 0;
  return w;
}

/**
 * Точки камеры среза: 0 - улица и перекрёсток крупно (как reference/renders/C-street-day.jpg),
 * 1 - квартал (как B-quarter-day.jpg), 2 - двор кирпичного дома вблизи.
 */
const SHOTS = [
  { name: 'улица C', x: CX, z: CY, zoom: 4.5 },
  { name: 'квартал B', x: CX, z: CY, zoom: 2.8 },
  { name: 'двор', x: CX - 2.5, z: CY - 2, zoom: 6 },
];

export function shot(rig: CameraRig, n: number) {
  const s = SHOTS[n];
  if (!s) {
    console.warn(`slice.shot: точки ${n} нет, есть 0..${SHOTS.length - 1}`);
    return;
  }
  // Поля камеры закрыты от игры - для снимков ставим их напрямую
  const r = rig as unknown as { target: THREE.Vector3; zoomGoal: number; azimuth: number; azimuthGoal: number };
  r.target.set(s.x, 0, s.z);
  r.zoomGoal = s.zoom;
  r.azimuth = r.azimuthGoal = Math.PI / 4;
  rig.update(0); // k = 1: сразу в цель
}

/** Подключение: avi.shot(n) - точки среза; ?shot=N - сразу в точку N (по умолчанию 0). */
export function attach(rig: CameraRig, params: URLSearchParams) {
  Object.assign((window as unknown as { avi: object }).avi, { shot: (n: number) => shot(rig, n), buildSlice });
  shot(rig, Number(params.get('shot') ?? 0));
}
