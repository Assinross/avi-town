// Улица лентой (plan.md 010, этап S): полотно, тротуары выше асфальта со светлой кромкой бордюра,
// скруглённые дугой углы перекрёстка, жёлто-белые зебры, осевая, фонари и деревья вдоль бордюра.
// Пока только прямые и крестовый перекрёсток - остальное (Т, повороты) рисуют плитки KayKit,
// поэтому новая улица включается только на срезе ?slice (setRibbonStreets). Этап 2 обобщит.
// Размеры в клетках: клетка ~10 м, полотно 6 м, тротуары по 2 м. Машины едут на CAR_LANE,
// люди идут на WALK_LANE - это уже на тротуаре.

import * as THREE from 'three';
import { tileAt, type World } from '@avi/sim';
import type { GeoBuilder } from '../builder';
import { roadTop, type CityMap } from '../cityMap';
import { MODELS } from '../models';

/** Половина ширины полотна: от оси до бордюра. */
const ROAD = 0.3;
/** Ширина светлой кромки бордюра. */
const CURB = 0.025;
/** Тротуар выше асфальта (~15 см). */
const RISE = 0.015;
/** Радиус скругления угла перекрёстка - дуга бордюра заходит на соседнюю клетку. */
const RADIUS = 0.33;
/** Шагов дуги на четверть круга. */
const ARC = 8;
/** Насколько дуга угла укорачивает тротуар соседней прямой клетки. */
const TRIM = RADIUS - (0.5 - ROAD);
/** Разметка: толщина над асфальтом. */
const PAINT = 0.003;

const COLOR = {
  asphalt: 0x5f5d5a,
  walk: 0xb4b1aa,
  curb: 0xd8d6cf,
  dash: 0xe9e6dc,
  zebraYellow: 0xe6c24a,
  zebraWhite: 0xeeeae2,
  pit: 0x6e5c48,
  trunk: 0x6e5440,
  leaves: [0x6f9a4a, 0x638f42, 0x7aa352],
} as const;

const LIGHT_WARM = 0xffcf8f;
const KAY = 0.5;

let ribbon = false;
/** Включить улицы лентой вместо плиток KayKit (срез). */
export function setRibbonStreets(on: boolean) {
  ribbon = on;
}

// Стороны как в cityMesh.addRoad: бит 1 - +x, 2 - +z, 4 - -x, 8 - -z
const DIRS4: [number, number][] = [[1, 0], [0, 1], [-1, 0], [0, -1]];

function maskAt(w: World, x: number, y: number): number {
  let mask = 0;
  DIRS4.forEach(([dx, dy], i) => { if (tileAt(w, x + dx, y + dy)?.object === 'road') mask |= 1 << i; });
  return mask;
}

const isCross = (w: World, x: number, y: number) => tileAt(w, x, y)?.object === 'road' && maskAt(w, x, y) === 15;

const hash = (x: number, y: number, salt: number) => {
  const s = Math.sin(x * 12.9898 + y * 78.233 + salt * 37.719) * 43758.5453;
  return s - Math.floor(s);
};

/**
 * Клетка дороги лентой. false - вид не поддержан (Т, поворот или улицы лентой выключены),
 * тогда клетку рисует плитка KayKit.
 */
export function addStreet(g: GeoBuilder, w: World, x: number, y: number, cx: number, cz: number, crossing: boolean, ruins: boolean): boolean {
  if (!ribbon) return false;
  const mask = maskAt(w, x, y);
  const top = roadTop();
  if (mask === 15) {
    g.box(cx, 0, cz, 1, top, 1, COLOR.asphalt);
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) corner(g, cx, cz, sx, sz, top);
    return true;
  }
  // Прямая (и тупик, и одиночная клетка): вдоль x или вдоль z
  if ((mask & 5) && (mask & 10)) return false;
  const alongX = !(mask & 10);
  const [ax, az] = alongX ? [1, 0] : [0, 1];
  const [nx, nz] = alongX ? [0, 1] : [1, 0];
  // Точка в осях клетки: u - вдоль улицы, v - поперёк
  const at = (u: number, v: number): [number, number] => [cx + ax * u + nx * v, cz + az * u + nz * v];
  const rect = (u0: number, u1: number, v0: number, v1: number) => [at(u0, v0), at(u1, v0), at(u1, v1), at(u0, v1)];
  g.box(cx, 0, cz, 1, top, 1, COLOR.asphalt);
  // У перекрёстка тротуар начинается за дугой угла: её рисует клетка перекрёстка
  const u0 = isCross(w, x - ax, y - az) ? -0.5 + TRIM : -0.5;
  const u1 = isCross(w, x + ax, y + az) ? 0.5 - TRIM : 0.5;
  for (const s of [-1, 1]) {
    const [c0, c1] = s > 0 ? [ROAD, ROAD + CURB] : [-ROAD - CURB, -ROAD];
    const [w0, w1] = s > 0 ? [ROAD + CURB, 0.5] : [-0.5, -ROAD - CURB];
    g.prism(rect(u0, u1, c0, c1), 0, top + RISE, COLOR.curb);
    g.prism(rect(u0, u1, w0, w1), 0, top + RISE, COLOR.walk);
  }
  const paint = (u: number, v: number, lu: number, lv: number, color: number) => {
    const [px, pz] = at(u, v);
    g.box(px, top, pz, alongX ? lu : lv, PAINT, alongX ? lv : lu, color);
  };
  if (crossing) {
    // Зебра поперёк полотна: полосы вдоль улицы, жёлтая и белая через одну
    for (let i = 0; i < 7; i++) paint(0, -0.24 + i * 0.08, 0.26, 0.055, i % 2 ? COLOR.zebraWhite : COLOR.zebraYellow);
  } else {
    // Осевая - белая прерывистая, четыре штриха на клетку
    for (let i = 0; i < 4; i++) paint(-0.375 + i * 0.25, 0, 0.12, 0.012, COLOR.dash);
  }
  if (crossing || u0 > -0.5 || u1 < 0.5) return true;
  // Фонарь на каждой клетке, стороны по очереди; деревья - между фонарями, у бордюра.
  // У довоенных руин фонари не горят и не стоят
  const k = alongX ? x : y;
  if (!ruins) {
    const s = k % 2 === 0 ? 1 : -1;
    lamp(g, at(-0.25, s * 0.44), at(-0.25, s * 0.32), s, alongX, top + RISE, x * 7 + y * 13);
  }
  for (const s of [-1, 1]) {
    if (hash(x, y, s) < 0.2) continue;
    roundTree(g, at(0.22, s * 0.36), top + RISE, x * 31 + y * 17 + s);
  }
  return true;
}

/**
 * Угол перекрёстка в четверти (sx, sz): тротуар с бордюром, скруглённым дугой. Захватывает край
 * соседних прямых клеток - их тротуар укорочен на TRIM.
 */
function corner(g: GeoBuilder, cx: number, cz: number, sx: number, sz: number, top: number) {
  const at = (u: number, v: number): [number, number] => [cx + sx * u, cz + sz * v];
  const c = ROAD + RADIUS;
  // Дуга от (c, ROAD) к (ROAD, c) вокруг центра (c, c) радиусом r
  const arc = (r: number) => Array.from({ length: ARC + 1 }, (_, i) => {
    const a = -Math.PI / 2 - (i / ARC) * (Math.PI / 2);
    return at(c + Math.cos(a) * r, c + Math.sin(a) * r);
  });
  const outer = arc(RADIUS), inner = arc(RADIUS - CURB);
  g.prism([...outer, ...inner.reverse()], 0, top + RISE, COLOR.curb);
  g.prism([...arc(RADIUS - CURB), at(0.5, c), at(0.5, 0.5), at(c, 0.5)], 0, top + RISE, COLOR.walk);
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
export function roundTree(g: GeoBuilder, [x, z]: [number, number], y: number, seed: number) {
  const r = 0.12 + hash(seed, 1, 2) * 0.04;
  const h = 0.13 + hash(seed, 3, 4) * 0.04;
  const leaves = COLOR.leaves[Math.floor(hash(seed, 5, 6) * COLOR.leaves.length)];
  g.box(x, y, z, 0.08, PAINT, 0.08, COLOR.pit);
  g.cylinder(m4.makeTranslation(x, y, z), 0.016, h + r * 0.4, COLOR.trunk, 6);
  g.cylinder(m4.makeTranslation(x, y + h, z), r * 0.55, r * 0.75, leaves, 7, leaves, r);
  g.cylinder(m4.makeTranslation(x, y + h + r * 0.75, z), r, r * 0.85, leaves, 7, leaves, r * 0.35);
}

/**
 * Подъём пешехода над асфальтом: на тротуаре - на высоту бордюра, на полотне (зебра) - 0.
 * Биты roadMask - по DIRS симуляции: 1 - +x, 2 - -x, 4 - +y, 8 - -y.
 */
export function walkLift(map: CityMap, x: number, z: number): number {
  if (!ribbon) return 0;
  const cx = Math.floor(x), cz = Math.floor(z);
  const i = cz * map.size + cx;
  if (!map.isRoad[i]) return 0;
  const fx = Math.abs(x - cx - 0.5), fz = Math.abs(z - cz - 0.5);
  const m = map.roadMask[i];
  if (m === 15) return fx > ROAD && fz > ROAD ? RISE : 0;
  const alongZ = (m & 12) !== 0 && (m & 3) === 0;
  return (alongZ ? fx : fz) > ROAD ? RISE : 0;
}
