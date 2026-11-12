// Полоса машины по маршруту (plan.md 010, этап 3): правостороннее движение, повороты дугой
// внутри клетки перекрёстка (направо - малая, налево - большая), выезд от бордюра и заезд к нему
// плавной S-кривой. Полоса - ломаная из мелких отрезков с длиной пути до каждой точки:
// машина хранит пройденную длину s, по ней находит точку, а расстояния до стоп-линий
// и перекрёстков - разность длин (см. traffic.ts).
// Смещение полосы задаётся по клеткам (plan.md 011, этап 2): у улицы одна полоса на 0.13,
// у проспекта две - 0.05 у внешнего тротуара и 0.35 у осевой (см. laneGraph.ts).

import { DIRS } from '@avi/sim';

/** Смещение полосы улицы от оси: движение правостороннее. */
export const STREET_LANE = 0.13;
/** Полосы проспекта: смещение от центра клетки к правой стороне по ходу. Полотно проспекта
 * лежит в сторону пары, то есть слева от хода, поэтому смещения отрицательные: -0.05 - крайняя
 * правая у внешнего тротуара, -0.35 - левая у осевой. */
export const AVENUE_LANES = [-0.05, -0.35] as const;

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
/** Шагов на плавный сдвиг в соседнюю полосу (перестроение). */
const SHIFT_STEPS = 8;

/** Правая сторона по ходу (x, z): для движения по +x это +z. */
const rightOf = ([dx, dz]: [number, number]): [number, number] => [-dz, dx];

/** Дуга поворота в клетке узла: касается линии входа (смещение oIn) и линии выхода (oOut). */
export function turnArc(cx: number, cz: number, din: number, dout: number, oIn: number, oOut: number): number[] {
  const [dx, dz] = DIRS[din], [ex, ez] = DIRS[dout];
  const rin = rightOf([dx, dz]), rout = rightOf([ex, ez]);
  // Точка пересечения линий входа и выхода: от неё и пляшем
  const kx = cx + rin[0] * oIn + rout[0] * oOut, kz = cz + rin[1] * oIn + rout[1] * oOut;
  if (dout === (din ^ 1)) return uturnArc(cx, cz, dx, dz, rin, oIn, oOut);
  const sgn = dout === RIGHT_TURN_DIR[din] ? 1 : -1;
  // Радиус дуги: касательные точки не должны выйти за клетку
  const rIn = sgn > 0 ? 0.5 - oIn : 0.5 + oIn;
  const rOut = sgn > 0 ? 0.5 - oOut : 0.5 + oOut;
  const r = Math.max(0.12, Math.min(rIn, rOut));
  const crx = kx + sgn * (rin[0] + rout[0]) * r, crz = kz + sgn * (rin[1] + rout[1]) * r;
  const v0x = -sgn * rin[0] * r, v0z = -sgn * rin[1] * r;
  const v1x = -sgn * rout[0] * r, v1z = -sgn * rout[1] * r;
  // Направление обхода - по знаку векторного произведения концов дуги
  const sweep = Math.atan2(v0x * v1z - v0z * v1x, v0x * v1x + v0z * v1z);
  // Дуга начинается в точке касания линии входа: центр плюс перпендикуляр к входу,
  // а не от точки пересечения линий - иначе первая точка уезжает на радиус назад.
  const pts = [crx + v0x, crz + v0z];
  for (let k = 1; k <= ARC_STEPS; k++) {
    const a = (sweep * k) / ARC_STEPS, c = Math.cos(a), s = Math.sin(a);
    pts.push(crx + v0x * c - v0z * s, crz + v0x * s + v0z * c);
  }
  return pts;
}

/** Разворот: петля внутрь клетки от линии входа к линии выхода того же въезда. */
function uturnArc(cx: number, cz: number, dx: number, dz: number, rin: [number, number], oIn: number, oOut: number): number[] {
  const p0x = cx - dx * 0.5 + rin[0] * oIn, p0z = cz - dz * 0.5 + rin[1] * oIn;
  const p3x = cx - dx * 0.5 - rin[0] * oOut, p3z = cz - dz * 0.5 - rin[1] * oOut;
  const p1x = p0x + dx * 0.9, p1z = p0z + dz * 0.9;
  const p2x = p3x + dx * 0.9, p2z = p3z + dz * 0.9;
  const pts: number[] = [];
  for (let i = 1; i <= CURVE_STEPS; i++) {
    const t = i / CURVE_STEPS, u = 1 - t;
    const a = u * u * u, b = 3 * u * u * t, c = 3 * u * t * t, d = t * t * t;
    pts.push(a * p0x + b * p1x + c * p2x + d * p3x, a * p0z + b * p1z + c * p2z + d * p3z);
  }
  return [p0x, p0z, ...pts];
}

/** Направление поворота направо для DIRS: 0 +x -> 2 +z, 1 -x -> 3 -z, 2 +z -> 1 -x, 3 -z -> 0 +x. */
const RIGHT_TURN_DIR = [2, 3, 1, 0];

/**
 * Полоса по клеткам path от точки у бордюра from до точки у бордюра to.
 * offsets - смещение полосы от оси по клеткам маршрута (одно число - на весь путь).
 */
export function driveLane(size: number, path: number[], from: { x: number; z: number }, to: { x: number; z: number }, offsets: number | number[] = STREET_LANE): Lane {
  const pts: number[] = [];
  const len: number[] = [];
  const marks: number[] = [];
  const bends: number[] = [];
  const off = (i: number) => (typeof offsets === 'number' ? offsets : (offsets[Math.max(0, Math.min(offsets.length - 1, i))] ?? STREET_LANE));
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
  const right = rightOf;

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
  const o0 = off(first - 1);
  const ex = cx(first - 1) + rx * o0 + fx * CURB_REACH, ez = cz(first - 1) + rz * o0 + fz * CURB_REACH;
  curve(from.x + fx * 0.25, from.z + fz * 0.25, ex - fx * 0.3, ez - fz * 0.3, ex, ez);
  const merge = at();
  for (let k = 0; k < first; k++) marks.push(Math.max(0, merge - CURB_REACH - (first - 1 - k)));
  bends.push(0, merge, CURB);

  for (let i = first; i <= last; i++) {
    const din = dir(i - 1), dout = dir(i);
    const [ax, az] = right(din), [bx, bz] = right(dout);
    if (din[0] === dout[0] && din[1] === dout[1]) {
      // Прямая: точка на своей полосе; если полоса сменилась - плавный сдвиг от прошлой точки
      const o = off(i);
      const tx = cx(i) + ax * o, tz = cz(i) + az * o;
      if (Math.abs(o - off(i - 1)) < 1e-6) add(tx, tz);
      else {
        const px = pts[pts.length - 2], pz = pts[pts.length - 1];
        for (let k = 1; k <= SHIFT_STEPS; k++) {
          const t = k / SHIFT_STEPS, e = t * t * (3 - 2 * t);
          add(px + (tx - px) * e, pz + (tz - pz) * e);
        }
      }
      marks.push(at());
      continue;
    }
    // Поворот: дуга в клетке узла от линии входа к линии выхода
    const dinIdx = dirIndex(din), doutIdx = dirIndex(dout);
    const arc = turnArc(cx(i), cz(i), dinIdx, doutIdx, off(i), off(i + 1));
    const start = at();
    for (let k = 0; k < arc.length; k += 2) add(arc[k], arc[k + 1]);
    marks.push((start + at()) / 2);
    bends.push(start, at(), doutIdx === RIGHT_TURN_DIR[dinIdx] ? RIGHT_TURN : LEFT_TURN);
  }

  // Заезд: с полосы клетки last + 1 к бордюру цели
  const [lx, lz] = dir(n - 2);
  const [qx, qz] = right(dir(n - 2));
  const oLast = off(last + 1);
  const px = cx(last + 1) + qx * oLast - lx * CURB_REACH, pz = cz(last + 1) + qz * oLast - lz * CURB_REACH;
  add(px, pz);
  const park = at();
  for (let k = last + 1; k < n; k++) marks.push(park + CURB_REACH + (k - last - 1));
  curve(px + lx * 0.3, pz + lz * 0.3, to.x - lx * 0.25, to.z - lz * 0.25, to.x, to.z);
  bends.push(park, at(), CURB);
  return { pts, len, marks, bends, merge, park };
}

/** Индекс DIRS для шага [dx, dz]. */
function dirIndex([dx, dz]: [number, number]): number {
  if (dx > 0) return 0;
  if (dx < 0) return 1;
  return dz > 0 ? 2 : 3;
}
