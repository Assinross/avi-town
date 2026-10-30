// Улица лентой (plan.md 010, этапы S и 2): полотно, тротуары выше асфальта со светлой кромкой
// бордюра, скруглённые дугой углы перекрёстков и поворотов, закруглённые тупики, жёлто-белые зебры,
// осевая (на главных - двойная жёлтая, у перекрёстка - стоп-линии; streets/main.ts), фонари и деревья вдоль бордюра. Все виды клеток (прямая, поворот, Т, крест, тупик)
// собираются из четырёх углов и четырёх сторон клетки. Вместо плиток KayKit - по умолчанию
// (?fx=-streets - прежние плитки для сравнения).
// Размеры в клетках: клетка ~10 м, полотно 6 м, тротуары по 2 м. Машины едут на CAR_LANE,
// люди идут на WALK_LANE - это уже на тротуаре.

import * as THREE from 'three';
import { tileAt, type World } from '@avi/sim';
import { fxFlags } from '../../platform/device';
import type { GeoBuilder } from '../builder';
import { roadTop, type CityMap } from '../cityMap';
import { MODELS } from '../models';
import { MAIN_X, MAIN_Z, mainStreets, signalJunction } from './main';

export { MAIN_X, MAIN_Z, mainStreets, signalJunction } from './main';

/** Половина ширины полотна: от оси до бордюра. */
const ROAD = 0.3;
/** Ширина светлой кромки бордюра. */
const CURB = 0.025;
/** Тротуар выше асфальта (~15 см). */
const RISE = 0.015;
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

const isRoad = (w: World, x: number, y: number) => tileAt(w, x, y)?.object === 'road';
/** Угол клетки в четверти (sx, sz) между двумя улицами - выпуклый угол тротуара, скругляется дугой. */
const convex = (w: World, x: number, y: number, sx: number, sz: number) => isRoad(w, x + sx, y) && isRoad(w, x, y + sz);
/** Большая дуга (заходит на соседей): у соседей по этим двум улицам свои углы не выпуклые. */
const bigArc = (w: World, x: number, y: number, sx: number, sz: number) =>
  convex(w, x, y, sx, sz) && !convex(w, x + sx, y, -sx, sz) && !convex(w, x, y + sz, sx, -sz);

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

/** Клетка дороги лентой. false - улицы лентой выключены, клетку рисует плитка KayKit. */
export function addStreet(g: GeoBuilder, w: World, x: number, y: number, cx: number, cz: number, crossing: boolean, ruins: boolean): boolean {
  if (!ribbon) return false;
  const top = roadTop(), walk = top + RISE;
  g.box(cx, 0, cz, 1, top, 1, COLOR.asphalt);
  let trimmed = false;
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) if (quarter(g, w, x, y, cx, cz, sx, sz, walk)) trimmed = true;
  // Сторона без улицы - тротуар между углами
  for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
    if (isRoad(w, x + dx, y + dz)) continue;
    // a - от центра наружу, b - вдоль стороны
    const pt = (a: number, b: number): [number, number] => [cx + dx * a + dz * b, cz + dz * a + dx * b];
    const rect = (a0: number, a1: number, b0: number, b1: number) => [pt(a0, b0), pt(a1, b0), pt(a1, b1), pt(a0, b1)];
    g.prism(rect(ROAD, ROAD + CURB, -ROAD, ROAD), 0, walk, COLOR.curb);
    g.prism(rect(ROAD + CURB, 0.5, -ROAD, ROAD), 0, walk, COLOR.walk);
  }
  // Разметка и убранство - только на прямой: две противоположные улицы и ни одной поперёк
  const ex = isRoad(w, x + 1, y) && isRoad(w, x - 1, y), ez = isRoad(w, x, y + 1) && isRoad(w, x, y - 1);
  const sideX = isRoad(w, x + 1, y) || isRoad(w, x - 1, y), sideZ = isRoad(w, x, y + 1) || isRoad(w, x, y - 1);
  if (!(ex && !sideZ) && !(ez && !sideX)) return true;
  const alongX = ex;
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
      const arms = [[1, 0], [-1, 0], [0, 1], [0, -1]].filter(([dx, dz]) => isRoad(w, jx + dx, jy + dz)).length;
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
  if (!ruins) {
    const s = k % 2 === 0 ? 1 : -1;
    lamp(g, at(-0.25, s * 0.44), at(-0.25, s * 0.32), s, alongX, walk, x * 7 + y * 13);
  }
  for (const s of [-1, 1]) {
    if (hash(x, y, s) < 0.2) continue;
    roundTree(g, at(0.22, s * 0.36), walk, x * 31 + y * 17 + s);
  }
  return true;
}

/**
 * Угол клетки в четверти (sx, sz), оси четверти u, v от ROAD до 0.5. Между двумя улицами -
 * тротуар со скруглённым дугой бордюром; между улицей и тротуаром - продолжение прямого тротуара
 * (укорочено, если на него заходит дуга соседа); между двумя тротуарами - угол с закруглением
 * бордюра. true - тротуар укорочен дугой соседа.
 */
function quarter(g: GeoBuilder, w: World, x: number, y: number, cx: number, cz: number, sx: number, sz: number, walk: number): boolean {
  const at = (u: number, v: number): [number, number] => [cx + sx * u, cz + sz * v];
  const rect = (u0: number, u1: number, v0: number, v1: number) => [at(u0, v0), at(u1, v0), at(u1, v1), at(u0, v1)];
  const ox = isRoad(w, x + sx, y), oz = isRoad(w, x, y + sz);
  const R = ROAD, K = R + CURB;
  if (ox && oz) {
    const r = bigArc(w, x, y, sx, sz) ? RADIUS : RADIUS_TIGHT;
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
    const end = bigArc(w, x + sx, y, -sx, sz) ? 0.5 - TRIM : 0.5;
    g.prism(rect(R, end, R, K), 0, walk, COLOR.curb);
    g.prism(rect(R, end, K, 0.5), 0, walk, COLOR.walk);
    return end < 0.5;
  }
  const end = bigArc(w, x, y + sz, sx, -sz) ? 0.5 - TRIM : 0.5;
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
  const inX = Math.abs(fz) <= ROAD && (Math.abs(fx) <= ROAD || (fx > 0 ? m & 1 : m & 2));
  const inZ = Math.abs(fx) <= ROAD && (Math.abs(fz) <= ROAD || (fz > 0 ? m & 4 : m & 8));
  return inX || inZ ? 0 : RISE;
}
