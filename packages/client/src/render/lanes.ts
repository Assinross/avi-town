// Полоса машины по маршруту (plan.md 010, этап 3): правостороннее движение, повороты дугой
// внутри клетки перекрёстка (направо - малая, налево - большая), выезд от бордюра и заезд к нему
// плавной S-кривой. Полоса - ломаная из мелких отрезков с длиной пути до каждой точки:
// машина хранит пройденную длину s, по ней находит точку, а расстояния до стоп-линий
// и перекрёстков - разность длин (см. traffic.ts).

import { CAR_LANE } from './cityMap';

export interface Lane {
  /** Точки парами x, z. */
  pts: number[];
  /** Длина пути от начала до каждой точки. */
  len: number[];
  /** Длина пути до середины каждой клетки маршрута (path[k]). */
  marks: number[];
  /** Участки, которые проходят медленнее: тройки "от, до, скорость" (повороты, бордюр). */
  bends: number[];
  /** Конец выезда от бордюра на полосу. */
  merge: number;
  /** Начало заезда с полосы к бордюру. */
  park: number;
}

/** Скорость на дуге в долях полной: малая дуга направо медленнее большой налево. */
const RIGHT_TURN = 0.45;
const LEFT_TURN = 0.6;
const CURB = 0.4;
/** Где кончается выезд от бордюра и начинается заезд к нему: от середины клетки вдоль улицы. */
const CURB_REACH = 0.45;
const ARC_STEPS = 8;
const CURVE_STEPS = 10;

/** Полоса по клеткам path от точки у бордюра from до точки у бордюра to. */
export function driveLane(size: number, path: number[], from: { x: number; z: number }, to: { x: number; z: number }): Lane {
  const pts: number[] = [];
  const len: number[] = [];
  const marks: number[] = [];
  const bends: number[] = [];
  const add = (x: number, z: number) => {
    const n = pts.length;
    if (n && Math.hypot(x - pts[n - 2], z - pts[n - 1]) < 1e-6) return;
    len.push(n ? len[len.length - 1] + Math.hypot(x - pts[n - 2], z - pts[n - 1]) : 0);
    pts.push(x, z);
  };
  const at = () => len[len.length - 1];
  /** Кривая Безье от последней точки через p1, p2 к p3. */
  const curve = (x1: number, z1: number, x2: number, z2: number, x3: number, z3: number) => {
    const x0 = pts[pts.length - 2], z0 = pts[pts.length - 1];
    for (let i = 1; i <= CURVE_STEPS; i++) {
      const t = i / CURVE_STEPS, u = 1 - t;
      const a = u * u * u, b = 3 * u * u * t, c = 3 * u * t * t, d = t * t * t;
      add(a * x0 + b * x1 + c * x2 + d * x3, a * z0 + b * z1 + c * z2 + d * z3);
    }
  };

  const n = path.length;
  add(from.x, from.z);
  if (n < 2) {
    // Цель на той же клетке: просто переехать к другому бордюру
    add(to.x, to.z);
    marks.push(at() / 2);
    return { pts, len, marks, bends: [0, at(), CURB], merge: 0, park: at() };
  }
  const cx = (i: number) => (path[i] % size) + 0.5;
  const cz = (i: number) => Math.floor(path[i] / size) + 0.5;
  const dir = (i: number): [number, number] => [cx(i + 1) - cx(i), cz(i + 1) - cz(i)];
  // Правая сторона по ходу (x, z): для движения по +x это +z
  const right = ([dx, dz]: [number, number]): [number, number] => [-dz, dx];

  const straight = (i: number) => {
    const [ax, az] = dir(i - 1), [bx, bz] = dir(i);
    return ax === bx && az === bz;
  };
  // Выезд и заезд захватывают соседнюю клетку, если она прямая: кривая длиннее и положе
  const first = n >= 3 && straight(1) ? 2 : 1;
  const last = n - 2 >= first + 1 && straight(n - 2) ? n - 3 : n - 2;

  // Выезд: от бордюра вдоль улицы на свою полосу почти до края клетки first - 1
  const [fx, fz] = dir(0);
  const [rx, rz] = right(dir(0));
  const ex = cx(first - 1) + rx * CAR_LANE + fx * CURB_REACH, ez = cz(first - 1) + rz * CAR_LANE + fz * CURB_REACH;
  curve(from.x + fx * 0.25, from.z + fz * 0.25, ex - fx * 0.3, ez - fz * 0.3, ex, ez);
  const merge = at();
  for (let k = 0; k < first; k++) marks.push(Math.max(0, merge - CURB_REACH - (first - 1 - k)));
  bends.push(0, merge, CURB);

  for (let i = first; i <= last; i++) {
    const din = dir(i - 1), dout = dir(i);
    const [ax, az] = right(din), [bx, bz] = right(dout);
    if (din[0] === dout[0] && din[1] === dout[1]) {
      add(cx(i) + ax * CAR_LANE, cz(i) + az * CAR_LANE);
      marks.push(at());
      continue;
    }
    // Поворот: угол пересечения полос и дуга, касающаяся обеих на краях клетки.
    // Направо (выход = правая сторона входа) радиус 0.5 - полоса, налево 0.5 + полоса.
    const toRight = dout[0] === ax && dout[1] === az;
    const r = toRight ? 0.5 - CAR_LANE : 0.5 + CAR_LANE;
    const kx = cx(i) + (ax + bx) * CAR_LANE, kz = cz(i) + (az + bz) * CAR_LANE;
    const sx = kx - din[0] * r, sz = kz - din[1] * r;
    add(sx, sz);
    const start = at();
    // Центр дуги - от её начала в сторону выхода
    const ox = sx + dout[0] * r, oz = sz + dout[1] * r;
    for (let k = 1; k <= ARC_STEPS; k++) {
      const a = (k / ARC_STEPS) * (Math.PI / 2);
      const c = Math.cos(a), s = Math.sin(a);
      add(ox - dout[0] * r * c + din[0] * r * s, oz - dout[1] * r * c + din[1] * r * s);
    }
    marks.push((start + at()) / 2);
    bends.push(start, at(), toRight ? RIGHT_TURN : LEFT_TURN);
  }

  // Заезд: с полосы клетки last + 1 к бордюру цели
  const [lx, lz] = dir(n - 2);
  const [qx, qz] = right(dir(n - 2));
  const px = cx(last + 1) + qx * CAR_LANE - lx * CURB_REACH, pz = cz(last + 1) + qz * CAR_LANE - lz * CURB_REACH;
  add(px, pz);
  const park = at();
  for (let k = last + 1; k < n; k++) marks.push(park + CURB_REACH + (k - last - 1));
  curve(px + lx * 0.3, pz + lz * 0.3, to.x - lx * 0.25, to.z - lz * 0.25, to.x, to.z);
  bends.push(park, at(), CURB);
  return { pts, len, marks, bends, merge, park };
}
