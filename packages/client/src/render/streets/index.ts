// Улица лентой (plan.md 010, этапы S и 2): полотно, тротуары выше асфальта со светлой кромкой
// бордюра, скруглённые дугой углы перекрёстков и поворотов, закруглённые тупики, жёлто-белые зебры,
// осевая (на главных - двойная жёлтая, у перекрёстка - стоп-линии; streets/main.ts), фонари и деревья вдоль бордюра. Все виды клеток (прямая, поворот, Т, крест, тупик)
// собираются из четырёх углов и четырёх сторон клетки. Вместо плиток KayKit - по умолчанию
// (?fx=-streets - прежние плитки для сравнения).
// Размеры в клетках: клетка ~10 м, полотно 6 м, тротуары по 2 м. Машины едут на CAR_LANE,
// люди идут на WALK_LANE - это уже на тротуаре.

import * as THREE from 'three';
import { DIRS, tileAt, type World } from '@avi/sim';
import { fxFlags } from '../../platform/device';
import type { GeoBuilder } from '../builder';
import { roadTop, type CityMap } from '../cityMap';
import { MODELS } from '../models';
import { MAIN_X, MAIN_Z, mainStreets, signalJunction } from './main';
import type { AvenueBand, StreetGraph } from './graph';
import { BAND_TRAVEL } from '../laneGraph';
import { AVENUE_LANES } from '../lanes';

export { MAIN_X, MAIN_Z, mainStreets, signalJunction } from './main';

/** Половина ширины полотна: от оси до бордюра. */
const ROAD = 0.3;
/** Ширина светлой кромки бордюра. */
const CURB = 0.025;
/** Тротуар выше асфальта (~15 см). */
const RISE = 0.015;
/** Въезд шириной 3.2 м, с боковыми скатами по 0.8 м и кромкой высотой 2 см. */
const DRIVE_HALF = 0.16;
const DRIVE_EDGE = 0.24;
const DRIVE_RISE = 0.002;
/** Радиус скругления угла между двумя улицами - дуга бордюра заходит на соседние клетки. */
const RADIUS = 0.33;
/** Радиус, когда у соседа тоже скруглённый угол (перекрёстки вплотную): дуга внутри клетки. */
const RADIUS_TIGHT = 0.18;
/** Закругление бордюра во внешнем углу поворота и у тупика. */
const FILLET = 0.12;
/** Шагов дуги на четверть круга. */
const ARC = 8;
/** Насколько большая дуга угла укорачивает тротуар соседней клетки. */
const TRIM = RADIUS - (0.5 - ROAD);
/** Разметка: толщина над асфальтом. */
const PAINT = 0.003;

const COLOR = {
  asphalt: 0x5f5d5a,
  walk: 0xb4b1aa,
  curb: 0xd8d6cf,
  dash: 0xe9e6dc,
  axisYellow: 0xe0b63e,
  zebraYellow: 0xe6c24a,
  zebraWhite: 0xeeeae2,
  pit: 0x6e5c48,
  trunk: 0x6e5440,
  leaves: [0x6f9a4a, 0x638f42, 0x7aa352],
} as const;

const LIGHT_WARM = 0xffcf8f;
const KAY = 0.5;

let ribbon = fxFlags.streets;
/** Включить или выключить улицы лентой (по умолчанию - флаг ?fx=streets). */
export function setRibbonStreets(on: boolean) {
  ribbon = on;
}

const isRoad = (w: World, graph: StreetGraph | undefined, x: number, y: number) => {
  if (x < 0 || y < 0 || x >= w.size || y >= w.size) return false;
  return graph ? graph.isRoad(y * w.size + x) : tileAt(w, x, y)?.object === 'road';
};

const hash = (x: number, y: number, salt: number) => {
  const s = Math.sin(x * 12.9898 + y * 78.233 + salt * 37.719) * 43758.5453;
  return s - Math.floor(s);
};

/** Дуга вокруг центра (cu, cv) радиусом r от угла a0 до a1 (в осях четверти). */
const arcPts = (at: (u: number, v: number) => [number, number], cu: number, cv: number, r: number, a0: number, a1: number) =>
  Array.from({ length: ARC + 1 }, (_, i) => {
    const a = a0 + ((a1 - a0) * i) / ARC;
    return at(cu + Math.cos(a) * r, cv + Math.sin(a) * r);
  });

/** Высота въезда над асфальтом: от низкого бордюра к обычному тротуару и боковым краям. */
function drivewayRise(a: number, b: number): number {
  const side = Math.min(1, Math.max(0, (Math.abs(b) - DRIVE_HALF) / (DRIVE_EDGE - DRIVE_HALF)));
  const back = Math.min(1, Math.max(0, (a - ROAD - CURB) / (0.5 - ROAD - CURB)));
  return DRIVE_RISE + (RISE - DRIVE_RISE) * Math.max(side, back);
}

/** Клетка проспекта: полотно 12 м на пару клеток (6 м в каждой), тротуар 4 м по внешнему краю. */
/** Стрелка разметки: ствол и остриё вдоль хода (hx, hz), повёрнутого на angle. */
function laneArrow(g: GeoBuilder, x: number, z: number, hx: number, hz: number, angle: number, color: number) {
  const c = Math.cos(angle), s = Math.sin(angle);
  const dx = hx * c - hz * s, dz = hx * s + hz * c;
  const rx = -dz, rz = dx;
  const LEN = 0.2, WIDE = 0.03, HALF = 0.055;
  const top = roadTop();
  g.box(x - dx * 0.03, top, z - dz * 0.03, WIDE, PAINT, LEN, color, Math.atan2(dx, dz));
  g.prism([
    [x + dx * 0.09 + rx * HALF, z + dz * 0.09 + rz * HALF],
    [x + dx * 0.09 - rx * HALF, z + dz * 0.09 - rz * HALF],
    [x + dx * 0.17, z + dz * 0.17],
  ], top, PAINT, color);
}

function addAvenueCell(g: GeoBuilder, w: World, graph: StreetGraph | undefined, x: number, y: number, cx: number, cz: number, band: AvenueBand, crossing: boolean, ruins: boolean): void {
  const top = roadTop(), walk = top + RISE;
  g.box(cx, 0, cz, 1, top, 1, COLOR.asphalt);
  const axis = band.axis;
  const ax = axis === 0 ? 1 : 0, az = axis === 0 ? 0 : 1;
  const nx = axis === 0 ? 0 : 1, nz = axis === 0 ? 1 : 0;
  // s - куда вторая клетка пары, o - внешний край клетки
  const s = DIRS[band.side][0] * nx + DIRS[band.side][1] * nz;
  const o = -s;
  const rect = (u0: number, u1: number, v0: number, v1: number): [number, number][] => [
    [cx + ax * u0 + nx * v0, cz + az * u0 + nz * v0],
    [cx + ax * u1 + nx * v0, cz + az * u1 + nz * v0],
    [cx + ax * u1 + nx * v1, cz + az * u1 + nz * v1],
    [cx + ax * u0 + nx * v1, cz + az * u0 + nz * v1],
  ];
  const slab = (u0: number, u1: number, v0: number, v1: number, color: number) => g.prism(rect(u0, u1, v0, v1), 0, walk, color);
  const paint = (u: number, v: number, lu: number, lv: number, color: number) => {
    g.box(cx + ax * u + nx * v, top, cz + az * u + nz * v, ax ? lu : lv, PAINT, ax ? lv : lu, color);
  };
  const road = (px: number, py: number) => isRoad(w, graph, px, py);
  // Внешний тротуар 4 м; между двумя лентами (блок 2x2) тротуара нет
  if (!band.wide) {
    slab(-0.5, 0.5, o * 0.1, o * 0.125, COLOR.curb);
    slab(-0.5, 0.5, o * 0.125, o * 0.5, COLOR.walk);
  }
  // Торцы: лента упирается не в дорогу - тротуар заворачивает за угол
  for (const e of [-1, 1]) {
    if (road(x + ax * e, y + az * e)) continue;
    const u0 = e > 0 ? 0.1 : -0.5, u1 = e > 0 ? 0.5 : -0.1;
    slab(u0, u1, o * 0.1, s * 0.5, COLOR.walk);
    slab(e > 0 ? 0.1 : -0.125, e > 0 ? 0.125 : -0.1, o * 0.1, s * 0.5, COLOR.curb);
  }
  // Разметка: двойная жёлтая у оси ленты, прерывистая между полосами
  paint(-0.5, s * 0.48, 1, 0.012, COLOR.axisYellow);
  for (let i = 0; i < 4; i++) paint(-0.375 + i * 0.25, s * 0.2, 0.12, 0.012, COLOR.dash);
  if (crossing) {
    for (let i = 0; i < 8; i++) paint(0, o * 0.05 + s * i * 0.065, 0.26, 0.05, i % 2 ? COLOR.zebraWhite : COLOR.zebraYellow);
  }
  // Стрелки полос перед перекрёстком: с правой полосы - направо или прямо, с левой - налево
  // или прямо (те же правила, что в laneGraph.ts). Клетка перед зеброй последней у узла.
  const cell = y * w.size + x;
  const edge = graph?.edgeAt(cell);
  if (!crossing && edge) {
    const travel = BAND_TRAVEL[band.side];
    const pos = edge.a === cell ? 0 : edge.cells.indexOf(cell) + 1;
    const along = travel === edge.dir ? pos : edge.length - pos;
    const node = graph!.nodes.get(travel === edge.dir ? edge.b : edge.a);
    if (along === edge.length - 2 && node && (node.kind === 'tee' || node.kind === 'cross')) {
      const [hx, hz] = DIRS[travel];
      const rx = -hz, rz = hx;
      const right = [2, 3, 1, 0][travel], left = right ^ 1;
      for (let k = 0; k < 2 && k < AVENUE_LANES.length; k++) {
        const canRight = (node.arms & (1 << right)) !== 0;
        const canLeft = (node.arms & (1 << left)) !== 0;
        const turn = k === 0 ? (canRight ? Math.PI / 4 : 0) : (canLeft ? -Math.PI / 4 : 0);
        laneArrow(g, cx + rx * AVENUE_LANES[k] + hx * 0.02, cz + rz * AVENUE_LANES[k] + hz * 0.02, hx, hz, turn, COLOR.dash);
      }
    }
  }
  if (band.wide) return;
  // Фонари и деревья - только на внешнем тротуаре (4 м)
  if (!ruins) {
    const sd = (ax ? x : y) % 2 === 0 ? 1 : -1;
    const u = sd > 0 ? 0.25 : -0.25;
    lamp(g, [cx + ax * u + nx * o * 0.44, cz + az * u + nz * o * 0.44], [cx + ax * u + nx * o * 0.32, cz + az * u + nz * o * 0.32], o, ax === 1, walk, x * 7 + y * 13);
  }
  for (const gs of [-1, 1]) {
    const u = gs > 0 ? 0.22 : -0.32;
    if (hash(x, y, gs * o) < 0.2) continue;
    roundTree(g, [cx + ax * u + nx * o * 0.36, cz + az * u + nz * o * 0.36], walk, x * 31 + y * 17 + gs);
  }
}

/** Клетка дороги лентой. false - улицы лентой выключены, клетку рисует плитка KayKit. */
export function addStreet(g: GeoBuilder, w: World, graph: StreetGraph | undefined, x: number, y: number, cx: number, cz: number, crossing: boolean, ruins: boolean, driveways = 0): boolean {
  if (!ribbon) return false;
  // Проспект рисуется своей лентой: пара клеток, полотно 12 м, тротуары по внешним краям
  const band = graph?.bandOf(y * w.size + x);
  if (band) {
    addAvenueCell(g, w, graph, x, y, cx, cz, band, crossing, ruins);
    return true;
  }
  const road = (px: number, py: number) => isRoad(w, graph, px, py);
  const top = roadTop(), walk = top + RISE;
  g.box(cx, 0, cz, 1, top, 1, COLOR.asphalt);
  let trimmed = false;
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) if (quarter(g, road, x, y, cx, cz, sx, sz, walk)) trimmed = true;
  // Сторона без улицы - тротуар между углами
  for (const [dir, [dx, dz]] of DIRS.entries()) {
    if (road(x + dx, y + dz)) continue;
    // a - от центра наружу, b - вдоль стороны
    const pt = (a: number, b: number): [number, number] => [cx + dx * a + dz * b, cz + dz * a + dx * b];
    const rect = (a0: number, a1: number, b0: number, b1: number) => [pt(a0, b0), pt(a1, b0), pt(a1, b1), pt(a0, b1)];
    if (driveways & (1 << dir)) {
      const height = (px: number, pz: number) => top + drivewayRise((px - cx) * dx + (pz - cz) * dz, (px - cx) * dz + (pz - cz) * dx);
      const edges = [-ROAD, -DRIVE_EDGE, -DRIVE_HALF, DRIVE_HALF, DRIVE_EDGE, ROAD];
      for (let i = 1; i < edges.length; i++) {
        g.prism(rect(ROAD, ROAD + CURB, edges[i - 1], edges[i]), 0, walk, COLOR.curb, COLOR.curb, height);
        const pts = rect(ROAD + CURB, 0.5, edges[i - 1], edges[i]);
        // На боковых скатах ребро совпадает с изломом высоты side = back.
        const faces = edges[i] <= -DRIVE_HALF ? [[pts[0], pts[1], pts[2]], [pts[0], pts[2], pts[3]]]
          : [[pts[0], pts[1], pts[3]], [pts[1], pts[2], pts[3]]];
        for (const face of faces) g.prism(face, 0, walk, COLOR.walk, COLOR.walk, height);
      }
    } else {
      g.prism(rect(ROAD, ROAD + CURB, -ROAD, ROAD), 0, walk, COLOR.curb);
      g.prism(rect(ROAD + CURB, 0.5, -ROAD, ROAD), 0, walk, COLOR.walk);
    }
  }
  // Разметка и убранство - только на прямой: две противоположные улицы и ни одной поперёк
  const ex = road(x + 1, y) && road(x - 1, y), ez = road(x, y + 1) && road(x, y - 1);
  const sideX = road(x + 1, y) || road(x - 1, y), sideZ = road(x, y + 1) || road(x, y - 1);
  if (!(ex && !sideZ) && !(ez && !sideX)) return true;
  // Ось прямой берём у ребра графа: она же задаёт разметку и сторону фонарей
  const edge = graph?.edgeAt(y * w.size + x);
  const alongX = edge ? edge.axis === 0 : ex;
  const [ax, az] = alongX ? [1, 0] : [0, 1];
  const [nx, nz] = alongX ? [0, 1] : [1, 0];
  // Точка в осях клетки: u - вдоль улицы, v - поперёк
  const at = (u: number, v: number): [number, number] => [cx + ax * u + nx * v, cz + az * u + nz * v];
  const paint = (u: number, v: number, lu: number, lv: number, color: number) => {
    const [px, pz] = at(u, v);
    g.box(px, top, pz, alongX ? lu : lv, PAINT, alongX ? lv : lu, color);
  };
  const mains = mainStreets(w);
  const main = (mains[y * w.size + x] & (alongX ? MAIN_X : MAIN_Z)) !== 0;
  if (crossing) {
    // Зебра поперёк полотна: полосы вдоль улицы, жёлтая и белая через одну
    for (let i = 0; i < 7; i++) paint(0, -0.24 + i * 0.08, 0.26, 0.055, i % 2 ? COLOR.zebraWhite : COLOR.zebraYellow);
    // Стоп-линия перед зеброй на полосе к перекрёстку: на главной и у светофора
    for (const dir of [-1, 1]) {
      const jx = x + ax * dir, jy = y + az * dir;
      const j = tileAt(w, jx, jy);
      if (!j || j.object !== 'road') continue;
      const arms = [[1, 0], [-1, 0], [0, 1], [0, -1]].filter(([dx, dz]) => road(jx + dx, jy + dz)).length;
      if (arms < 3 || !(main || signalJunction(mains, jy * w.size + jx))) continue;
      // Правая сторона по ходу (dx, dz) - (-dz, dx); в осях клетки - знак по v
      const side = -az * dir * nx + ax * dir * nz;
      paint(-dir * 0.19, side * 0.155, 0.03, 0.27, COLOR.dash);
    }
  } else if (main) {
    // Главная: двойная сплошная жёлтая осевая
    for (const v of [-0.014, 0.014]) paint(0, v, 1, 0.012, COLOR.axisYellow);
  } else {
    // Осевая - белая прерывистая, четыре штриха на клетку
    for (let i = 0; i < 4; i++) paint(-0.375 + i * 0.25, 0, 0.12, 0.012, COLOR.dash);
  }
  if (crossing || trimmed) return true;
  // Фонарь на каждой клетке, стороны по очереди; деревья - между фонарями, у бордюра.
  // У довоенных руин фонари не горят и не стоят
  const k = alongX ? x : y;
  const hasDriveway = (s: number) => (driveways & (1 << (alongX ? (s > 0 ? 2 : 3) : (s > 0 ? 0 : 1)))) !== 0;
  const clear = (s: number, u: number, radius: number) => !hasDriveway(s) || Math.abs(u) - radius >= DRIVE_EDGE;
  if (!ruins) {
    const s = k % 2 === 0 ? 1 : -1;
    const u = hasDriveway(s) ? -0.32 : -0.25;
    if (clear(s, u, 0.04)) lamp(g, at(u, s * 0.44), at(u, s * 0.32), s, alongX, walk, x * 7 + y * 13);
  }
  for (const s of [-1, 1]) {
    const u = hasDriveway(s) ? 0.42 : 0.22;
    if (hash(x, y, s) < 0.2 || !clear(s, u, 0.16)) continue;
    roundTree(g, at(u, s * 0.36), walk, x * 31 + y * 17 + s);
  }
  return true;
}

/**
 * Угол клетки в четверти (sx, sz), оси четверти u, v от ROAD до 0.5. Между двумя улицами -
 * тротуар со скруглённым дугой бордюром; между улицей и тротуаром - продолжение прямого тротуара
 * (укорочено, если на него заходит дуга соседа); между двумя тротуарами - угол с закруглением
 * бордюра. true - тротуар укорочен дугой соседа.
 */
function quarter(g: GeoBuilder, road: (x: number, y: number) => boolean, x: number, y: number, cx: number, cz: number, sx: number, sz: number, walk: number): boolean {
  // Угол между двумя улицами - выпуклый, если у клетки есть оба выхода
  const convex = (px: number, py: number, ax: number, az: number) => road(px + ax, py) && road(px, py + az);
  // Большая дуга (заходит на соседей): у соседей по этим двум улицам свои углы не выпуклые
  const bigArc = (px: number, py: number, ax: number, az: number) =>
    convex(px, py, ax, az) && !convex(px + ax, py, -ax, az) && !convex(px, py + az, ax, -az);
  const at = (u: number, v: number): [number, number] => [cx + sx * u, cz + sz * v];
  const rect = (u0: number, u1: number, v0: number, v1: number) => [at(u0, v0), at(u1, v0), at(u1, v1), at(u0, v1)];
  const ox = road(x + sx, y), oz = road(x, y + sz);
  const R = ROAD, K = R + CURB;
  if (ox && oz) {
    const r = bigArc(x, y, sx, sz) ? RADIUS : RADIUS_TIGHT;
    const c = R + r;
    // Дуга от (c, R) к (R, c) вокруг центра (c, c)
    const outer = arcPts(at, c, c, r, -Math.PI / 2, -Math.PI);
    const inner = arcPts(at, c, c, r - CURB, -Math.PI / 2, -Math.PI);
    g.prism([...outer, ...[...inner].reverse()], 0, walk, COLOR.curb);
    if (c > 0.5) {
      g.prism([...inner, at(0.5, c), at(0.5, 0.5), at(c, 0.5)], 0, walk, COLOR.walk);
    } else {
      g.prism([...inner, at(K, 0.5), at(0.5, 0.5), at(0.5, K)], 0, walk, COLOR.walk);
      g.prism(rect(c, 0.5, R, K), 0, walk, COLOR.curb);
      g.prism(rect(R, K, c, 0.5), 0, walk, COLOR.curb);
    }
    return false;
  }
  if (!ox && !oz) {
    // Угол между двумя тротуарами (внешний угол поворота, тупик): полотна касается только точкой -
    // сплошной тротуар, бордюр сторон смыкается квадратиком, угол полотна закруглён бордюром
    g.prism(rect(R, K, R, K), 0, walk, COLOR.curb);
    g.prism([at(K, R), at(0.5, R), at(0.5, 0.5), at(R, 0.5), at(R, K), at(K, K)], 0, walk, COLOR.walk);
    g.prism([at(R, R), ...arcPts(at, R - FILLET, R - FILLET, FILLET, Math.PI / 2, 0)], 0, walk, COLOR.curb);
    return false;
  }
  // Улица вдоль одной оси, тротуар вдоль другой: дальний край укорочен, если сосед скругляет угол
  if (ox) {
    const end = bigArc(x + sx, y, -sx, sz) ? 0.5 - TRIM : 0.5;
    g.prism(rect(R, end, R, K), 0, walk, COLOR.curb);
    g.prism(rect(R, end, K, 0.5), 0, walk, COLOR.walk);
    return end < 0.5;
  }
  const end = bigArc(x, y + sz, sx, -sz) ? 0.5 - TRIM : 0.5;
  g.prism(rect(R, K, R, end), 0, walk, COLOR.curb);
  g.prism(rect(K, 0.5, R, end), 0, walk, COLOR.walk);
  return end < 0.5;
}

/** Фонарь KayKit на тротуаре, плечо - над дорогой; голова - якорь ночного света. */
function lamp(g: GeoBuilder, pole: [number, number], head: [number, number], s: number, alongX: boolean, y: number, seed: number) {
  // Сторона клетки, где стоит столб: индекс DIRS4; поворот как в cityMesh.addRoad
  const side = alongX ? (s > 0 ? 1 : 3) : (s > 0 ? 0 : 2);
  const rot = (side * Math.PI) / 2;
  g.model(MODELS.streetlight, pole[0], y, pole[1], KAY, rot);
  g.light('lamp', head[0], 0.5, head[1], rot, seed, LIGHT_WARM, 0.34, 0.34);
}

const m4 = new THREE.Matrix4();

/** Дерево с круглой кроной (улицы и дворы): приствольная лунка, ствол, круглая крона из двух усечённых конусов. */
export function roundTree(g: GeoBuilder, [x, z]: [number, number], y: number, seed: number, scale = 1) {
  const r = (0.12 + hash(seed, 1, 2) * 0.04) * scale;
  const h = (0.13 + hash(seed, 3, 4) * 0.04) * scale;
  const leaves = COLOR.leaves[Math.floor(hash(seed, 5, 6) * COLOR.leaves.length)];
  g.box(x, y, z, 0.08, PAINT, 0.08, COLOR.pit);
  g.cylinder(m4.makeTranslation(x, y, z), 0.016 * scale, h + r * 0.4, COLOR.trunk, 6);
  g.cylinder(m4.makeTranslation(x, y + h, z), r * 0.55, r * 0.75, leaves, 7, leaves, r);
  g.cylinder(m4.makeTranslation(x, y + h + r * 0.75, z), r, r * 0.85, leaves, 7, leaves, r * 0.35);
}

/**
 * Подъём пешехода над асфальтом: на тротуаре - на высоту бордюра, на полотне (зебра) - 0.
 * Полотно - середина клетки и рукава к соседним дорогам; скругления углов не учитываются.
 * Биты roadMask - по DIRS симуляции: 1 - +x, 2 - -x, 4 - +y, 8 - -y.
 */
export function walkLift(map: CityMap, x: number, z: number): number {
  if (!ribbon) return 0;
  const cx = Math.floor(x), cz = Math.floor(z);
  const i = cz * map.size + cx;
  if (!map.isRoad[i]) return 0;
  const fx = x - cx - 0.5, fz = z - cz - 0.5;
  const m = map.roadMask[i];
  const driveways = map.driveways[i] ?? 0;
  for (const [dir, [dx, dz]] of DIRS.entries()) {
    const a = fx * dx + fz * dz, b = fx * dz + fz * dx;
    if ((driveways & (1 << dir)) && a >= ROAD && a <= 0.5 && Math.abs(b) <= ROAD) return drivewayRise(a, b);
  }
  const inX = Math.abs(fz) <= ROAD && (Math.abs(fx) <= ROAD || (fx > 0 ? m & 1 : m & 2));
  const inZ = Math.abs(fx) <= ROAD && (Math.abs(fz) <= ROAD || (fz > 0 ? m & 4 : m & 8));
  return inX || inZ ? 0 : RISE;
}
