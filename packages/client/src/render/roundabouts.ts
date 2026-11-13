// Кольцо (plan.md 011, задача 3.2): площадь 3x3 клетки - круг асфальта, газонный
// островок с деревьями, тротуары по углам блока, въезды с примыкающих улиц,
// пунктирная линия по кругу и знаки "уступить" на въездах.
// Клетки блока - дорога с road = 2; геометрию рисует только центральная клетка,
// поэтому чанк перестраивается один раз на изменение мира.

import * as THREE from 'three';
import { DIRS, roundaboutArms, type Roundabout, type World } from '@avi/sim';
import type { GeoBuilder } from './builder';
import { roadTop } from './cityMap';
import { PALETTE } from './palette';
import { MODELS } from './models';
import { roundTree } from './streets/tree';

/** Габариты кольца в клетках: клетка ~10 м, блок 3x3 - площадь 30 м. */
export const RING = {
  /** Внешний радиус полотна - 15 м: круг вписан в квадрат блока. */
  outer: 1.5,
  /** Радиус газонного островка - 11 м. */
  island: 1.12,
  /** Половина ширины въезда - как полотно улицы (6 м). */
  entry: 0.3,
  /** Тротуар и островок выше асфальта на 15 см, как у улиц. */
  rise: 0.015,
} as const;

/** Шагов дуги на четверть круга. */
const ARC = 8;
/** Разметка: толщина над асфальтом. */
const PAINT = 0.003;
/** Радиус пунктирной линии по кольцу. */
const LINE_R = (RING.outer + RING.island) / 2;

const COLOR = {
  asphalt: 0x5f5d5a,
  walk: 0xb4b1aa,
  curb: 0xd8d6cf,
  dash: 0xe9e6dc,
  grass: PALETTE.lawn,
  pole: 0x8c9399,
  sign: 0xf2ede2,
  signRed: 0xc0392b,
} as const;

const arcPts = (cx: number, cz: number, r: number, a0: number, a1: number, steps: number): [number, number][] =>
  Array.from({ length: steps + 1 }, (_, i) => {
    const a = a0 + ((a1 - a0) * i) / steps;
    return [cx + Math.cos(a) * r, cz + Math.sin(a) * r];
  });

/** Убирает соседние повторы: круг и углы блока дают совпадающие вершины. */
function poly(pts: [number, number][]): [number, number][] {
  const out: [number, number][] = [];
  for (const p of pts) {
    const prev = out[out.length - 1];
    if (prev && Math.abs(prev[0] - p[0]) < 1e-6 && Math.abs(prev[1] - p[1]) < 1e-6) continue;
    out.push(p);
  }
  const a = out[0], b = out[out.length - 1];
  if (out.length > 2 && Math.abs(a[0] - b[0]) < 1e-6 && Math.abs(a[1] - b[1]) < 1e-6) out.pop();
  return out;
}

const LIGHT_WARM = 0xffcf8f;
const KAY = 0.5;

/** Фонарь на островке: столб у бордюра, плечо с головой над круговой полосой. */
function islandLamp(g: GeoBuilder, x: number, z: number, y: number, out: number, seed: number) {
  // Поворот модели как у улиц: при rot = 0 плечо смотрит в -x
  const rot = out + Math.PI;
  g.model(MODELS.streetlight, x, y, z, KAY, rot);
  g.light('lamp', x - Math.cos(out) * 0.12, y + 0.5, z - Math.sin(out) * 0.12, rot, seed, LIGHT_WARM, 0.34, 0.34);
}

/** Знак "уступить" на тротуаре у въезда: столб и перевёрнутый треугольник (белый в красной рамке). */function yieldSign(g: GeoBuilder, x: number, z: number, y: number, nx: number, nz: number) {
  const tx = nz, tz = -nx; // поперёк взгляда водителя: правый край знака
  const r = 0.075;
  g.box(x, y, z, 0.024, 0.24, 0.024, COLOR.pole);
  const face = (off: number, k: number, color: number) => {
    const cy = y + 0.215;
    const at = (u: number, w: number) => new THREE.Vector3(x + tx * u + nx * off, cy + w, z + tz * u + nz * off);
    const pts = [at(-r * k, r * k), at(r * k, r * k), at(0, -r * k)];
    // Щит рисуем с обеих сторон: лицевая - водителю, изнанка - для вида с круга
    g.face(pts, color);
    g.face([...pts].reverse(), color);
  };
  face(0.012, 1, COLOR.signRed);
  face(0.016, 0.74, COLOR.sign);
  // Изнанка: та же рамка с белым полем, иначе с круга виден только красный щит
  face(-0.012, 1, COLOR.signRed);
  face(-0.016, 0.74, COLOR.sign);
}

/**
 * Вся площадь кольца. Вызывается только из центральной клетки блока;
 * маска примыканий считается по живым дорогам, а не по сохранённой.
 */
export function roundaboutGeometry(g: GeoBuilder, w: World, r: Roundabout) {
  const x = r.cell % w.size, y = (r.cell / w.size) | 0;
  const cx = x + 0.5, cz = y + 0.5;
  const top = roadTop(), walk = top + RING.rise;
  const arms = roundaboutArms(w, x, y);

  // Полотно: круг асфальта, вписанный в квадрат блока
  g.prism(poly(arcPts(cx, cz, RING.outer, 0, Math.PI * 2, ARC * 4)), 0, top, COLOR.asphalt);

  // Въезды: серп между хордой стороны блока и дугой - улица переходит в круг без шва
  const half = Math.asin(Math.min(1, RING.entry / RING.outer));
  for (let d = 0; d < 4; d++) {
    if (!(arms & (1 << d))) continue;
    const [dx, dz] = DIRS[d];
    const ang = Math.atan2(dz, dx);
    const px = -dz, pz = dx;
    const mx = cx + dx * RING.outer, mz = cz + dz * RING.outer;
    const chord: [number, number][] = [[mx + px * RING.entry, mz + pz * RING.entry], [mx - px * RING.entry, mz - pz * RING.entry]];
    g.prism(poly([...chord, ...arcPts(cx, cz, RING.outer, ang + half, ang - half, 4)]), 0, top, COLOR.asphalt);
  }

  // Тротуары по углам блока: область вне круга, обрезанная въездами
  const edge = [0, 0, 0, 0];
  for (let d = 0; d < 4; d++) if (arms & (1 << d)) edge[d] = RING.entry;
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      const ex = sx > 0 ? edge[0] : edge[1];
      const ez = sz > 0 ? edge[2] : edge[3];
      const t0 = Math.PI / 2 - Math.asin(Math.min(1, ez / RING.outer));
      const t1 = Math.asin(Math.min(1, ex / RING.outer));
      const pts: [number, number][] = [
        [cx + sx * RING.outer, cz + sz * ex],
        [cx + sx * RING.outer, cz + sz * RING.outer],
        [cx + sx * ez, cz + sz * RING.outer],
      ];
      for (let i = 0; i <= ARC; i++) {
        const t = t0 + ((t1 - t0) * i) / ARC;
        pts.push([cx + sx * RING.outer * Math.cos(t), cz + sz * RING.outer * Math.sin(t)]);
      }
      // Боковины - бордюр, верх - тротуар: бортик у асфальта выходит сам собой
      g.prism(poly(pts), 0, walk, COLOR.curb, COLOR.walk);
    }
  }

  // Газонный островок: бордюр по кругу задаёт боковая грань призмы
  g.prism(poly(arcPts(cx, cz, RING.island, 0, Math.PI * 2, ARC * 4)), 0, walk, COLOR.curb, COLOR.grass);

  // Пунктирная линия по кругу
  const dashes = 20;
  for (let i = 0; i < dashes; i++) {
    const a = (i / dashes) * Math.PI * 2;
    g.box(cx + Math.cos(a) * LINE_R, top, cz + Math.sin(a) * LINE_R, 0.1, PAINT, 0.018, COLOR.dash, a + Math.PI / 2);
  }

  // Деревья на островке: кроны не выходят за бордюр
  for (const [i, [u, v]] of [[0.5, 0.42], [-0.45, 0.4], [0.05, -0.52], [-0.32, -0.12]].entries()) {
    roundTree(g, [cx + u, cz + v], walk, x * 41 + y * 27 + i, 1.2);
  }

  // Два фонаря на островке: ночью кольцо не проваливается в темноту
  for (const [i, a] of [Math.PI / 2, -Math.PI / 2].entries()) {
    const ox = Math.cos(a), oz = Math.sin(a);
    islandLamp(g, cx + ox * 0.98, cz + oz * 0.98, walk, a, x * 23 + y * 37 + i);
  }

  // Знаки "уступить" на въездах: справа по ходу движения в круг
  for (let d = 0; d < 4; d++) {
    if (!(arms & (1 << d))) continue;
    const [dx, dz] = DIRS[d];
    yieldSign(g, cx + dx * 1.62 + dz * 0.38, cz + dz * 1.62 - dx * 0.38, walk, dx, dz);
  }
}
