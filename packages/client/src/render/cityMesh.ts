// Процедурная геометрия участка карты по состоянию мира. Тайл = 1 единица, центр тайла (x+0.5, z+0.5).

import * as THREE from 'three';
import { BUILDING_BY_ID } from '@avi/data';
import { lotCenter, tileAt, usesLots, ZONE_BUILD_DAYS, type Tile, type World } from '@avi/sim';
import { GeoBuilder } from './builder';
import { KC, KI, MODELS, NATURE, PROPS, painted, type KcName, type KiName, type Model, type ModelName, type NatureName } from './models';
import { hash01, windowGrid, type LightKind } from './nightPlan';
import { PALETTE, pick } from './palette';
import { addStreet } from './streets';
import { brickHouse, cottageHouse, detailedBuildings, shopFront, twoStoreyHouse } from './buildings';
import { apartmentYard } from './yards/apartment';

const FLOOR = 0.32;
const WATER_TOP = -0.14;

// Цвета ночных огней: тёплые окна и фонари, холодный дежурный свет промзоны, огонь и маяки
const LIGHT_WARM = 0xffcf8f;
const LIGHT_WINDOW = 0xffd9a0;
const LIGHT_SHOP = 0xfff2cc;
const LIGHT_WORK = 0xffcf6a;
const LIGHT_LAB = 0xa8e8ff;
const LIGHT_FIRE = 0xff8a3d;
const LIGHT_BEACON = 0xff4a3a;
const LIGHT_GARLAND = 0xffe0a0;
// Туман войны: неразведанная земля - тёмная ровная пелена, на ней ничего не видно
const FOG_GROUND = [0x2b2f37, 0x30343c, 0x282c33] as const;

/** skip - клетки, которые рисует слой спрайтов (?sprites): для них 3D не строится. */
export function buildChunkGeometry(w: World, x0: number, y0: number, n: number, crossings?: Set<number>, skip?: (t: Tile) => boolean) {
  const g = new GeoBuilder();
  for (let y = y0; y < Math.min(y0 + n, w.size); y++) {
    for (let x = x0; x < Math.min(x0 + n, w.size); x++) {
      const t = tileAt(w, x, y)!;
      const cx = x + 0.5, cz = y + 0.5;
      if (!w.explored[y * w.size + x]) {
        g.box(cx, -0.6, cz, 1, 0.6, 1, FOG_GROUND[0], 0, FOG_GROUND[t.variant % FOG_GROUND.length]);
        continue;
      }
      if (skip?.(t)) continue;
      const top = t.terrain === 'water' ? WATER_TOP : 0;
      g.box(cx, -0.6, cz, 1, 0.6 + top, 1, PALETTE.dirtSide, 0, groundColor(t));
      addTerrainDetail(g, t, cx, cz);
      addObject(g, w, t, x, y, cx, cz, crossings);
    }
  }
  return { geometry: g.build(), lights: g.lights };
}

function groundColor(t: Tile): number {
  if (t.object === 'zone' && t.zone) return PALETTE.zoneLot[t.zone];
  if (t.object === 'building') return PALETTE.yard;
  if (t.object === 'crash') return PALETTE.scorch;
  return pick(PALETTE.ground[t.terrain], t.variant);
}

function rnd(variant: number, salt: number): number {
  // Детерминированное псевдослучайное 0..1 из варианта тайла - только для внешнего вида
  const s = Math.sin(variant * 12.9898 + salt * 78.233) * 43758.5453;
  return s - Math.floor(s);
}

function addTerrainDetail(g: GeoBuilder, t: Tile, cx: number, cz: number) {
  if (t.object !== 'none') return;
  if (t.terrain === 'contaminated' && t.variant % 3 === 0) {
    g.box(cx + (rnd(t.variant, 1) - 0.5) * 0.5, 0, cz + (rnd(t.variant, 2) - 0.5) * 0.5, 0.35, 0.02, 0.25, PALETTE.toxic, rnd(t.variant, 3) * 3);
  }
  if (t.terrain === 'rock') {
    const n = 1 + (t.variant % 3);
    for (let i = 0; i < n; i++) {
      const s = 0.18 + rnd(t.variant, i + 10) * 0.25;
      g.box(cx + (rnd(t.variant, i + 20) - 0.5) * 0.6, 0, cz + (rnd(t.variant, i + 30) - 0.5) * 0.6, s, s * 0.8, s, pick(PALETTE.boulder, i + t.variant), rnd(t.variant, i) * 3);
    }
  }
}

/** Поворот фасада к ближайшей дороге: 0 - к +z, 1 - к +x, 2 - к -z, 3 - к -x. */
function facing(w: World, x: number, y: number): number {
  const dirs: [number, number][] = [[0, 1], [1, 0], [0, -1], [-1, 0]];
  for (let i = 0; i < 4; i++) if (tileAt(w, x + dirs[i][0], y + dirs[i][1])?.object === 'road') return i;
  return 0;
}

function addObject(g: GeoBuilder, w: World, t: Tile, x: number, y: number, cx: number, cz: number, crossings?: Set<number>) {
  const v = t.variant;
  switch (t.object) {
    case 'road': return addRoad(g, w, x, y, cx, cz, crossings);
    case 'ruin': return addRuin(g, v, cx, cz);
    case 'tree': return addTree(g, v, cx, cz);
    case 'rubble': return addRubble(g, v, cx, cz);
    case 'zone': return addZoneBuilding(g, w, t, x, y, cx, cz);
    case 'building': if (t.root === y * w.size + x) addBuilding(g, t, cx, cz, w); return;
    case 'crash': case 'none': return;
  }
}

// Тайлы KayKit 2x2 единицы, клетка у нас 1x1
const KAY = 0.5;

// Открытые стороны дорожных тайлов KayKit без поворота: бит 1 - +x, 2 - +z, 4 - -x, 8 - -z.
// Поворот на четверть оборота (как в GeoBuilder.box) сдвигает маску на бит влево.
const ROAD_PIECES: [ModelName, number][] = [['road_junction', 15], ['road_tsplit', 11], ['road_corner', 3], ['road_straight', 10]];
const rotMask = (m: number, k: number) => ((m << k) | (m >> (4 - k))) & 15;

function addRoad(g: GeoBuilder, w: World, x: number, y: number, cx: number, cz: number, crossings?: Set<number>) {
  const dirs: [number, number][] = [[1, 0], [0, 1], [-1, 0], [0, -1]];
  let mask = 0;
  dirs.forEach(([dx, dy], i) => { if (tileAt(w, x + dx, y + dy)?.object === 'road') mask |= 1 << i; });
  // Тупик и одиночная клетка - прямой участок вдоль единственной связи
  if (mask === 0) mask = 10;
  else if ((mask & (mask - 1)) === 0) mask = mask & 5 ? 5 : 10;
  // Зебра ставится вместо прямого участка: полосы на асфальте вместо разметки
  const crossing = crossings?.has(y * w.size + x) ?? false;
  // Улица лентой с тротуарами; плитки KayKit - только при ?fx=-streets
  if (addStreet(g, w, x, y, cx, cz, crossing, nearRuin(w, x, y))) return;
  for (const [name, base] of ROAD_PIECES) {
    for (let k = 0; k < 4; k++) {
      if (rotMask(base, k) !== mask) continue;
      const piece = name === 'road_straight' && crossing ? 'road_straight_crossing' : name;
      g.model(MODELS[piece], cx, 0, cz, KAY, (k * Math.PI) / 2);
      // Фонарь на тротуаре прямого участка, плечо - над дорогой; у довоенных руин фонари не горят
      if (name === 'road_straight' && (x * 7 + y * 13) % 5 === 0 && !nearRuin(w, x, y)) {
        const side = k; // закрытая сторона: у прямой без поворота это +x, дальше поворачивается вместе с ней
        const [dx, dy] = dirs[side];
        g.model(MODELS.streetlight, cx + dx * 0.46, 0.05, cz + dy * 0.46, KAY, (side * Math.PI) / 2);
        // Плечо фонаря уходит к дороге: голова лампы ближе к центру клетки, чем столб
        g.light('lamp', cx + dx * 0.34, 0.5, cz + dy * 0.34, (side * Math.PI) / 2, x * 7 + y * 13, LIGHT_WARM, 0.34, 0.34);
      }
      return;
    }
  }
}

/** Рядом руины - старая улица довоенного квартала. */
function nearRuin(w: World, x: number, y: number): boolean {
  for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) if (tileAt(w, x + dx, y + dy)?.object === 'ruin') return true;
  return false;
}

function addRuin(g: GeoBuilder, v: number, cx: number, cz: number) {
  const floors = 1 + (v % 4);
  const sx = 0.6 + rnd(v, 1) * 0.3, sz = 0.6 + rnd(v, 2) * 0.3;
  const color = pick(PALETTE.concrete, v);
  const h = floors * FLOOR;
  g.box(cx, 0, cz, sx, h, sz, color);
  if (floors > 1) g.box(cx + (rnd(v, 3) - 0.5) * 0.2, h, cz + (rnd(v, 4) - 0.5) * 0.2, sx * 0.5, FLOOR * rnd(v, 5), sz * 0.45, color);
  windowBands(g, cx, cz, sx, sz, floors);
}

function windowBands(g: GeoBuilder, cx: number, cz: number, sx: number, sz: number, floors: number, base = 0) {
  for (let f = 0; f < floors; f++) {
    const wy = base + f * FLOOR + FLOOR * 0.4;
    g.box(cx, wy, cz, sx + 0.02, FLOOR * 0.28, sz * 0.7, PALETTE.window);
    g.box(cx, wy, cz, sx * 0.7, FLOOR * 0.28, sz + 0.02, PALETTE.window);
  }
}

function addTree(g: GeoBuilder, v: number, cx: number, cz: number) {
  const h = 0.25 + rnd(v, 1) * 0.2;
  const ox = (rnd(v, 2) - 0.5) * 0.4, oz = (rnd(v, 3) - 0.5) * 0.4;
  g.box(cx + ox, 0, cz + oz, 0.07, h, 0.07, PALETTE.trunk);
  if (v % 4 !== 0) {
    const leaves = pick(PALETTE.leaves, v);
    g.box(cx + ox, h, cz + oz, 0.36, 0.2, 0.36, leaves, rnd(v, 4));
    g.box(cx + ox, h + 0.2, cz + oz, 0.22, 0.14, 0.22, leaves, rnd(v, 5));
  } else {
    g.box(cx + ox + 0.06, h * 0.7, cz + oz, 0.16, 0.04, 0.04, PALETTE.trunk, rnd(v, 6));
    g.box(cx + ox, h * 0.85, cz + oz - 0.05, 0.04, 0.04, 0.14, PALETTE.trunk, rnd(v, 7));
  }
}

function addRubble(g: GeoBuilder, v: number, cx: number, cz: number) {
  const n = 3 + (v % 3);
  for (let i = 0; i < n; i++) {
    const s = 0.08 + rnd(v, i) * 0.16;
    g.box(cx + (rnd(v, i + 10) - 0.5) * 0.7, 0, cz + (rnd(v, i + 20) - 0.5) * 0.7, s * 1.4, s * 0.6, s, pick(PALETTE.concrete, v + i), rnd(v, i + 30) * 3);
  }
}

// Локальные координаты здания поворачиваются фасадом к дороге: (u - вдоль фасада, f - к дороге)
function oriented(cx: number, cz: number, face: number) {
  const fx = [0, 1, 0, -1][face], fz = [1, 0, -1, 0][face];
  const ux = fz, uz = -fx;
  return {
    at: (u: number, f: number) => [cx + ux * u + fx * f, cz + uz * u + fz * f] as const,
    rot: [0, -Math.PI / 2, Math.PI, Math.PI / 2][face],
  };
}

function addZoneBuilding(g: GeoBuilder, w: World, t: Tile, x: number, y: number, cx: number, cz: number) {
  const v = t.variant;
  const o = oriented(cx, cz, facing(w, x, y));
  if (usesLots(t) && t.root >= 0) {
    // Участок рисует главная клетка целиком, остальные - только землю
    if (t.root === y * w.size + x) addLot(g, w, t.root);
    return;
  }
  if (t.build > 0) return addSite(g, 1, 1 - t.build / ZONE_BUILD_DAYS[t.level], t.level + 1, v, cx, cz);
  if (t.level === 0) {
    // Пустой участок: колышки по углам
    for (const [u, f] of [[-0.4, -0.4], [0.4, -0.4], [-0.4, 0.4], [0.4, 0.4]]) {
      const [px, pz] = o.at(u, f);
      g.box(px, 0, pz, 0.04, 0.1, 0.04, PALETTE.stake);
    }
    return;
  }
  switch (t.zone) {
    case 'R': return residential(g, t.level, v, o);
    case 'C': return commercial(g, t.level, v, o);
    case 'I': return industrial(g, t.level, v, o);
    case 'A': return farm(g, t.level, v, o);
  }
}

type Orient = ReturnType<typeof oriented>;

const CARS: ModelName[] = ['car_hatchback', 'car_sedan', 'car_stationwagon', 'car_taxi'];
/** Низ колёс машин KayKit ниже точки привязки модели (в единицах модели). */
const WHEEL_DROP = 0.061;
/** Верх плиты участка KayKit (base) - тротуар, на котором стоят здания. */
const PLOT_TOP = 0.1 * KAY;

/** Машина колёсами на поверхности высотой top. */
function car(g: GeoBuilder, name: ModelName, x: number, top: number, z: number, scale: number, rot: number) {
  g.model(MODELS[name], x, top + WHEEL_DROP * scale, z, scale, rot);
}
/** Индекс DIRS (+x, -x, +y, -y) -> фасад для oriented (0 - к +z, 1 - к +x, 2 - к -z, 3 - к -x). */
const FACE_OF_DIR = [1, 3, 0, 2];

/** Двор многоэтажки (yards/apartment.ts) для жизни двора (yardLife.ts): оси участка и сторона двора. */
export interface ApartmentYard {
  root: number;
  at(u: number, f: number): readonly [number, number];
  mirror: 1 | -1;
}

/** Дворы всех многоэтажек, нарисованных из деталей, - те же участки, что собирает addLot. */
export function apartmentYards(w: World): ApartmentYard[] {
  const out: ApartmentYard[] = [];
  if (!detailedBuildings()) return out;
  w.tiles.forEach((t, i) => {
    if (t.zone !== 'R' || t.level < 3 || t.build > 0 || !usesLots(t) || t.root !== i || !w.explored[i]) return;
    const c = lotCenter(w, i);
    if (!c) return;
    out.push({ root: i, at: oriented(c.x, c.y, FACE_OF_DIR[c.s.dir]).at, mirror: t.variant & 1 ? -1 : 1 });
  });
  return out;
}

/** Участок дома: дом у улицы, дорожка, машины, задний двор или парковка - по зоне, уровню и форме. */
function addLot(g: GeoBuilder, w: World, root: number) {
  const t = w.tiles[root];
  const c = lotCenter(w, root);
  if (!c) return;
  const v = t.variant;
  const { s } = c;
  const cx = c.x, cz = c.y;
  if (t.build > 0) return addSite(g, Math.min(s.w, s.d), 1 - t.build / ZONE_BUILD_DAYS[t.level], t.level + 1, v, cx, cz);
  const o = oriented(cx, cz, FACE_OF_DIR[s.dir]);
  // Клетка участка в локальных координатах: u - вдоль улицы, f - к улице (передний ряд f > 0)
  const cell = (u: number, f: number) => {
    const [x, z] = o.at(u, f);
    return { x, z, o: oriented(x, z, FACE_OF_DIR[s.dir]) };
  };
  const front = (s.d - 1) / 2, back = -(s.d - 1) / 2, side = (s.w - 1) / 2;
  const flip = v & 1 ? 1 : -1;
  if (t.zone === 'R') {
    if (t.level === 1) return addCottage(g, v, o);
    if (t.level === 2) {
      // Дом на передней клетке, за ним задний двор с забором
      const h = cell(0, front);
      if (detailedBuildings()) {
        g.model(MODELS.base, h.x, 0, h.z, KAY);
        twoStoreyHouse(g, h.o, v, 0, -0.06, PLOT_TOP, 0.7, 0.56);
      } else kayBuilding(g, KAY_HOUSES.R2, v, h.o, 2);
      const b = cell(0, back);
      if (v % 3 === 0) addPlayground(g, v, b.x, b.z);
      else addGarden(g, v, b.x, b.z);
      fence(g, b.o, 0.46, true);
      return;
    }
    // Многоэтажка на два участка вдоль улицы, за ней парковка жильцов
    if (detailedBuildings()) {
      for (const u of [-side, side]) { const p = cell(u, front); g.model(MODELS.base, p.x, 0, p.z, KAY); }
      brickHouse(g, o, v, 0, front - 0.05, PLOT_TOP, s.w * 0.85, 0.78);
      // За домом - парковка жильцов и двор, стороны меняются по варианту
      const m = v & 1 ? -1 : 1;
      const p = cell(m * side, back);
      addParking(g, v, p.x, p.z);
      apartmentYard(g, o, v, m);
      return;
    }
    bigBuilding(g, KAY_HOUSES.R3, v, o, 0, front - 0.1, 1.25, [cell(-side, front), cell(side, front)]);
    for (const u of [-side, side]) { const p = cell(u, back); addParking(g, v + u * 4, p.x, p.z); }
    return;
  }
  if (t.zone === 'C') {
    if (t.level === 1) {
      if (detailedBuildings() && v % 4 !== 0) detailedShop(g, v, o);
      else commercial(g, 1, v, o);
      const [px, pz] = o.at(-0.3, 0.42);
      car(g, CARS[v % CARS.length], px, PLOT_TOP, pz, KAY * 0.55, o.rot);
      return;
    }
    if (t.level === 2) {
      if (v % 3 === 1) {
        // Широкий магазин на обе клетки
        for (const u of [-side, side]) { const b = cell(u, 0); g.model(MODELS.base, b.x, 0, b.z, KAY); }
        const [wall, trim] = shopPaint(v);
        kenney(g, KC[pick(SHOP_WIDE, v >> 2)], o, 0, 0, 1.8, 0.86, wall, trim, 0, KEN, { kind: 'window', seed: v * 7.1, level: 2, shop: true });
        return;
      }
      // Магазин на одной клетке, рядом парковка у улицы
      commercial(g, 2, v, cell(flip * side, 0).o);
      const p = cell(-flip * side, 0);
      addParking(g, v, p.x, p.z);
      return;
    }
    // Здания в глубине участка, у улицы - парковка (и сквер)
    for (const u of [-side, side]) { const b = cell(u, back); g.model(MODELS.base, b.x, 0, b.z, KAY); }
    const [wall, trim] = shopPaint(v);
    const l = cell(-flip * side, back), r = cell(flip * side, back);
    let garden = false;
    switch (v % 4) {
      case 0: mall(g, v, cell(0, back).o, s.w - 0.12); break; // торговый центр во всю ширину
      case 1: kenney(g, KC[pick(OFFICE_WIDE, v >> 2)], o, 0, back, 1.86, 0.9, wall, trim, 0, KEN, { kind: 'window', seed: v * 7.3, level: 3 }); break; // офисный корпус
      case 2: { // высотка и магазин рядом, перед магазином сквер
        kenney(g, KC[pick(TOWERS, v >> 2)], l.o, 0, 0, 0.86, 0.86, wall, trim, 0, KEN, { kind: 'window', seed: v * 7.7, level: 3 });
        const [w2, t2] = shopPaint(v + 7);
        kenney(g, KC[pick(SHOP_TALL, v >> 3)], r.o, 0, 0, 0.84, 0.84, w2, t2, 0, KEN, { kind: 'window', seed: v * 8.3, level: 2, shop: true });
        garden = true;
        break;
      }
      default: // две высотки
        kenney(g, KC[pick(TOWERS, v >> 2)], l.o, 0, 0, 0.86, 0.86, wall, trim, 0, KEN, { kind: 'window', seed: v * 7.7, level: 3 });
        kenney(g, KC[pick(TOWERS, (v >> 2) + 3)], r.o, 0, 0, 0.86, 0.86, ...shopPaint(v + 11), 0, KEN, { kind: 'window', seed: v * 8.9, level: 3 });
    }
    for (const u of [-side, side]) {
      const p = cell(u, front);
      if (garden && u === flip * side) addGarden(g, v, p.x, p.z);
      else addParking(g, v + u * 4, p.x, p.z);
    }
  }
}

/** Коттедж 1x1: дом в глубине участка, подъездная дорожка с машиной сбоку, забор, кусты. */
function addCottage(g: GeoBuilder, v: number, o: Orient) {
  const walls = pick(PALETTE.planks, v);
  const roof = pick(PALETTE.roofRust, v >> 2);
  const sideU = v & 2 ? 0.3 : -0.3;
  if (detailedBuildings()) cottageHouse(g, o, v, -sideU * 0.45, -0.12, 0, 0.5, 0.42);
  else cottageModel(g, v, o, sideU, walls, roof);
  // Дорожка от улицы к дому и машина на ней
  const [rx, rz] = o.at(sideU, 0.1);
  g.box(rx, 0, rz, 0.2, 0.012, 0.78, PALETTE.concrete[1], o.rot);
  if (v % 4 !== 3) {
    const [mx, mz] = o.at(sideU, 0.18);
    car(g, CARS[(v >> 3) % CARS.length], mx, 0.012, mz, KAY * 0.5, o.rot);
  }
  const [bx, bz] = o.at(-sideU * 0.45 + 0.22, 0.32);
  g.model(MODELS.bush, bx, 0, bz, KAY);
  fence(g, o, 0.47, false);
}

/** Прежний домик (?fx=-buildings): коробка, двускатная крыша, дверь и окна. */
function cottageModel(g: GeoBuilder, v: number, o: Orient, sideU: number, walls: number, roof: number) {
  const [hx, hz] = o.at(-sideU * 0.45, -0.12);
  g.box(hx, 0, hz, 0.5, 0.32, 0.42, walls, o.rot);
  roofGable(g, hx, 0.32, hz, 0.58, 0.22, 0.52, roof, walls, o.rot);
  const [dx, dz] = o.at(-sideU * 0.45, 0.1);
  g.box(dx, 0, dz, 0.12, 0.2, 0.02, PALETTE.door, o.rot);
  // Окна: два на фасаде у двери, по одному на боках, два сзади
  const hu = -sideU * 0.45;
  let win = 0;
  for (const [u, f, nu, nf] of [[hu - 0.16, 0.09, 0, 1], [hu + 0.16, 0.09, 0, 1], [hu - 0.25, -0.12, -1, 0], [hu + 0.25, -0.12, 1, 0], [hu - 0.12, -0.33, 0, -1], [hu + 0.12, -0.33, 0, -1]]) {
    const [wx, wz] = o.at(u, f);
    cottageWindow(g, wx, wz, o, nu, nf, v * 5.7 + win++ * 2.3);
  }
}

/** Окно коттеджа: рама и стекло на стене с локальной нормалью (nu, nf). */
function cottageWindow(g: GeoBuilder, x: number, z: number, o: Orient, nu: number, nf: number, seed: number) {
  const [ox, oz] = o.at(0, 0);
  const [px, pz] = o.at(nu * 0.012, nf * 0.012);
  const dx = px - ox, dz = pz - oz;
  const side = nu !== 0;
  g.box(x + dx, 0.12, z + dz, side ? 0.014 : 0.1, 0.11, side ? 0.1 : 0.014, PALETTE.frame, o.rot);
  g.box(x + dx * 1.6, 0.135, z + dz * 1.6, side ? 0.014 : 0.072, 0.08, side ? 0.072 : 0.014, PALETTE.glassDark, o.rot);
  g.light('window', x + dx * 1.6, 0.175, z + dz * 1.6, o.rot, seed, LIGHT_WINDOW, 0.072, 0.08, 1);
}

/** Низкий забор по краям клетки: задний край и бока до середины (или целиком для заднего двора). */
function fence(g: GeoBuilder, o: Orient, r: number, full: boolean) {
  const color = PALETTE.planks[2];
  const along = (u0: number, f0: number, u1: number, f1: number) => {
    const [ax, az] = o.at(u0, f0), [bx, bz] = o.at(u1, f1);
    const len = Math.hypot(bx - ax, bz - az);
    g.box((ax + bx) / 2, 0.06, (az + bz) / 2, Math.abs(bx - ax) > 0.01 ? len : 0.015, 0.02, Math.abs(bz - az) > 0.01 ? len : 0.015, color);
    const n = Math.max(2, Math.round(len / 0.16));
    for (let i = 0; i <= n; i++) g.box(ax + ((bx - ax) * i) / n, 0, az + ((bz - az) * i) / n, 0.02, 0.1, 0.02, color);
  };
  const f1 = full ? r : 0;
  along(-r, -r, r, -r);
  along(-r, -r, -r, f1);
  along(r, -r, r, f1);
}

/** Крупное здание KayKit на нескольких клетках: тротуар под каждой клеткой, модель в увеличенном масштабе. */
function bigBuilding(g: GeoBuilder, list: ModelName[], v: number, o: Orient, u: number, f: number, scale: number, cells: { x: number; z: number }[]) {
  for (const c of cells) g.model(MODELS.base, c.x, 0, c.z, KAY);
  const [x, z] = o.at(u, f);
  const name = pick(list, v);
  g.model(MODELS[name], x, 0, z, KAY * scale, o.rot);
  const e = extent(MODELS[name]);
  const k = KAY * scale;
  windowsAll(g, o, u, f, e.hw * k * 0.92, e.hd * k * 0.92, e.h * k * 0.95, 3, v * 7.9, 3);
  tvWindow(g, o, u, e.hw * k * 0.9, e.hd * k * 0.93, 3, v * 9.3);
}

function addParking(g: GeoBuilder, v: number, cx: number, cz: number) {
  g.box(cx, 0, cz, 0.92, 0.02, 0.92, PALETTE.asphalt);
  // Два ряда мест по три, разметка поперёк, проезд посередине
  for (const row of [-1, 1]) {
    for (let i = 0; i <= 3; i++) g.box(cx - 0.36 + i * 0.24, 0.02, cz + row * 0.3, 0.015, 0.004, 0.28, PALETTE.marking);
    for (let i = 0; i < 3; i++) {
      if (rnd(v, row * 7 + i) < 0.45) continue;
      const name = CARS[Math.floor(rnd(v, row * 11 + i) * CARS.length)];
      car(g, name, cx - 0.24 + i * 0.24, 0.02, cz + row * 0.3, KAY * 0.55, Math.PI / 2 + (row < 0 ? Math.PI : 0));
    }
  }
  g.model(MODELS.streetlight, cx + 0.44, 0.02, cz, KAY * 0.8, Math.PI / 2);
  g.light('lamp', cx + 0.44, 0.4, cz + 0.05, Math.PI / 2, v * 3.3, LIGHT_WARM, 0.3, 0.3);
}

function addPlayground(g: GeoBuilder, v: number, cx: number, cz: number) {
  g.box(cx, 0, cz, 0.9, 0.02, 0.9, PALETTE.lawn);
  // Песочница с бортиком
  g.box(cx - 0.22, 0.02, cz - 0.22, 0.3, 0.025, 0.3, PALETTE.sand);
  for (const [dx, dz, sx, sz] of [[0, -0.15, 0.32, 0.03], [0, 0.15, 0.32, 0.03], [-0.15, 0, 0.03, 0.32], [0.15, 0, 0.03, 0.32]]) {
    g.box(cx - 0.22 + dx, 0.02, cz - 0.22 + dz, sx, 0.04, sz, PALETTE.planks[0]);
  }
  // Горка: площадка на стойках, лесенка и скат
  const c1 = pick(PALETTE.play, v), c2 = pick(PALETTE.play, v + 1);
  for (const [dx, dz] of [[0, 0], [0.12, 0], [0, 0.12], [0.12, 0.12]]) g.box(cx + 0.14 + dx, 0.02, cz - 0.3 + dz, 0.02, 0.2, 0.02, PALETTE.metal[0]);
  g.box(cx + 0.2, 0.2, cz - 0.24, 0.16, 0.025, 0.16, c1);
  g.box(cx + 0.2, 0.02, cz - 0.04, 0.1, 0.12, 0.24, c2, 0, c2);
  // Качели: две стойки, перекладина, сиденья
  g.box(cx - 0.32, 0.02, cz + 0.2, 0.025, 0.24, 0.025, PALETTE.metal[1]);
  g.box(cx + 0.02, 0.02, cz + 0.2, 0.025, 0.24, 0.025, PALETTE.metal[1]);
  g.box(cx - 0.15, 0.24, cz + 0.2, 0.36, 0.025, 0.025, PALETTE.metal[1]);
  for (const dx of [-0.23, -0.07]) {
    g.box(cx + dx, 0.08, cz + 0.2, 0.008, 0.16, 0.008, PALETTE.metal[2]);
    g.box(cx + dx, 0.08, cz + 0.2, 0.07, 0.015, 0.05, c1);
  }
  g.model(MODELS.bench, cx + 0.3, 0.02, cz + 0.3, KAY * 0.8, Math.PI);
}

function addGarden(g: GeoBuilder, v: number, cx: number, cz: number) {
  g.box(cx, 0, cz, 0.9, 0.02, 0.9, PALETTE.lawn);
  // Дорожка крестом, лавочки, кусты по углам, дерево
  g.box(cx, 0.02, cz, 0.9, 0.006, 0.12, PALETTE.sand);
  g.box(cx, 0.02, cz, 0.12, 0.006, 0.9, PALETTE.sand);
  g.model(MODELS.bench, cx + 0.2, 0.02, cz + 0.12, KAY * 0.8, Math.PI);
  g.model(MODELS.bench, cx - 0.2, 0.02, cz - 0.12, KAY * 0.8);
  for (const [dx, dz] of [[-0.3, 0.3], [0.3, -0.3], [0.32, 0.32]]) g.model(MODELS.bush, cx + dx, 0.02, cz + dz, KAY);
  addTree(g, v | 1, cx - 0.28, cz - 0.28);
}

/** Одно окно с ровным синеватым свечением телевизора: в многоэтажках он горит дольше всех. */
function tvWindow(g: GeoBuilder, o: Orient, u: number, hw: number, hd: number, level: number, seed: number) {
  if (level < 3) return;
  const off = (hash01(seed) - 0.5) * hw * 1.4;
  const [x, z] = o.at(u + off, hd);
  g.light('tv', x, 0.62, z, o.rot, seed, 0x9fc8ff, 0.085, 0.07, level);
}

/**
 * Окна модельного дома на все четыре фасада: сетка по габаритам в мировых единицах.
 * У моделей KayKit и Kenney нет надёжной грани стекла, поэтому свет ставит сетка.
 */
function windowsAll(g: GeoBuilder, o: Orient, u: number, f: number, hw: number, hd: number, h: number, floors: number, seed: number, level: number, kind: LightKind = 'window', color = LIGHT_WINDOW) {
  windowGrid(Math.max(0.1, hw * 0.86), h, floors).forEach((w, i) => {
    for (const [df, turn, salt] of [[hd, 0, 0], [-hd, Math.PI, 91.7]] as const) {
      const [x, z] = o.at(u + w.x, f + df);
      g.light(kind, x, w.y, z, o.rot + turn, seed + i * 3.71 + salt, color, w.w, w.h, level);
    }
  });
  windowGrid(Math.max(0.1, hd * 0.86), h, floors).forEach((w, i) => {
    for (const [du, turn, salt] of [[hw, Math.PI / 2, 31.3], [-hw, -Math.PI / 2, 57.1]] as const) {
      const [x, z] = o.at(u + du, f + w.x);
      g.light(kind, x, w.y, z, o.rot + turn, seed + i * 3.71 + salt, color, w.w, w.h, level);
    }
  });
}

function residential(g: GeoBuilder, level: number, v: number, o: Orient) {
  const walls = pick(PALETTE.planks, v);
  const roof = pick(PALETTE.roofRust, v >> 2);
  if (level === 1) {
    const [x, z] = o.at(0, -0.05);
    g.box(x, 0, z, 0.62, 0.34, 0.5, walls, o.rot);
    roofGable(g, x, 0.34, z, 0.72, 0.24, 0.62, roof, walls, o.rot);
    const [dx, dz] = o.at(-0.12, 0.21);
    g.box(dx, 0, dz, 0.12, 0.22, 0.02, PALETTE.door, o.rot);
    // Лампа над дверью: горит по расписанию жильцов, как окна
    {
      const [px, pz] = o.at(-0.12, 0.222);
      g.light('window', px, 0.245, pz, o.rot, v * 6.7, LIGHT_WARM, 0.07, 0.05, 1);
    }
    // Два окна на фасаде: ночью в них горит свет
    for (const [i, u] of [0.08, 0.21].entries()) {
      const [wx, wz] = o.at(u, 0.201);
      g.box(wx, 0.12, wz, 0.09, 0.1, 0.012, PALETTE.glassDark, o.rot);
      g.light('window', wx, 0.17, wz, o.rot, v * 4.3 + i * 6.1, LIGHT_WINDOW, 0.09, 0.1, 1);
    }
    const [bx, bz] = o.at(0.33, -0.3);
    if (v % 2 === 0) g.box(bx, 0, bz, 0.1, 0.16, 0.1, pick(PALETTE.roofRust, v));
  } else {
    kayBuilding(g, KAY_HOUSES[level === 2 ? 'R2' : 'R3'], v, o, level);
  }
}

// Дома жилья KayKit по уровням. Торговля и промзона - модели Kenney в палитре игры и свои здания.
const KAY_HOUSES: Record<string, ModelName[]> = {
  R2: ['building_A_withoutBase', 'building_B_withoutBase'],
  R3: ['building_C_withoutBase', 'building_D_withoutBase'],
};

/** Дом KayKit на участке с тротуаром; фасад модели смотрит в +z, поворот - к дороге. */
function kayBuilding(g: GeoBuilder, list: ModelName[], v: number, o: Orient, level: number) {
  const [x, z] = o.at(0, 0);
  const name = pick(list, v);
  g.model(MODELS.base, x, 0, z, KAY);
  g.model(MODELS[name], x, 0, z, KAY, o.rot);
  const e = extent(MODELS[name]);
  windowsAll(g, o, 0, 0, e.hw * KAY * 0.92, e.hd * KAY * 0.92, e.h * KAY * 0.95, Math.max(1, level), v * 7.9, level);
  tvWindow(g, o, 0, e.hw * KAY * 0.9, e.hd * KAY * 0.93, level, v * 9.3);
  // Мелочи на участке: кусты вдоль задней границы, у узкого дома - по бокам, гидрант у фасада
  const put = (m: ModelName, u: number, f: number, turn = 0) => {
    const [px, pz] = o.at(u, f);
    g.model(MODELS[m], px, 0.05, pz, KAY, o.rot + turn);
  };
  for (const u of [-0.36, 0, 0.36]) if (rnd(v, u * 10 + 40) < 0.6) put('bush', u + (rnd(v, u + 41) - 0.5) * 0.08, -0.44);
  if (halfWidth(name) * KAY < 0.36) {
    if (v % 3 === 0) put('bench', 0.42, 0, Math.PI / 2);
    else put('bush', 0.42, 0.1 * (rnd(v, 42) - 0.5));
    put('bush', -0.42, 0.1 * (rnd(v, 43) - 0.5));
  }
  if (v % 4 === 1) put('firehydrant', 0.4, 0.43);
  else if (v % 4 === 2) put('trash_A', -0.4, 0.43);
}

const widths = new Map<ModelName, number>();
function halfWidth(name: ModelName): number {
  let w = widths.get(name);
  if (w === undefined) {
    w = 0;
    const p = MODELS[name].pos;
    for (let i = 0; i < p.length; i += 3) w = Math.max(w, Math.abs(p[i]));
    widths.set(name, w);
  }
  return w;
}

// --- Торговля и промзона: модели Kenney в цветах палитры и свои здания в стиле KayKit -----

/** Габариты модели: полуширина по x, полуглубина по z, высота. */
const extents = new Map<Model, { hw: number; hd: number; h: number }>();
function extent(m: Model) {
  let e = extents.get(m);
  if (!e) {
    e = { hw: 0, hd: 0, h: 0 };
    for (let i = 0; i < m.pos.length; i += 3) {
      e.hw = Math.max(e.hw, Math.abs(m.pos[i]));
      e.h = Math.max(e.h, m.pos[i + 1]);
      e.hd = Math.max(e.hd, Math.abs(m.pos[i + 2]));
    }
    extents.set(m, e);
  }
  return e;
}

/** Масштаб Kenney: этаж ~0.33 клетки, как у домов KayKit. */
const KEN = 0.78;

/**
 * Модель Kenney на участке: вписана в foot x depth клеток (вдоль улицы x вглубь), не крупнее KEN,
 * стены и крыша - в цветах wall и trim. Возвращает высоту крыши.
 */
function kenney(g: GeoBuilder, m: Model, o: Orient, u: number, f: number, foot: number, depth: number, wall: number, trim: number, turn = 0, max = KEN, lights?: { kind: LightKind; seed: number; level: number; color?: number; shop?: boolean }): number {
  const e = extent(m);
  const s = Math.min(max, foot / (2 * e.hw), depth / (2 * e.hd));
  const [x, z] = o.at(u, f);
  // Фасад моделей Kenney смотрит в -z, у KayKit и наших зданий - в +z
  g.model(painted(m, wall, trim), x, 0.02, z, s, o.rot + turn + Math.PI);
  if (lights) {
    windowsAll(g, o, u, f, e.hw * s * 0.92, e.hd * s * 0.92, e.h * s * 0.92, Math.max(1, lights.level), lights.seed, lights.level, lights.kind, lights.color);
    // Витрина у входа: тёплое пятно на первом этаже
    if (lights.shop) {
      const [sx, sz] = o.at(u, f + e.hd * s);
      g.light('shopwindow', sx, 0.13, sz, o.rot, lights.seed + 5.5, LIGHT_SHOP, Math.min(0.5, e.hw * s * 0.7), 0.13, 1);
    }
  }
  return e.h * s;
}

/** Цвет из списка по варианту: соль развязывает выбор цвета и модели. */
const tone = <T>(list: readonly T[], v: number, salt: number) => list[Math.floor(rnd(v, salt) * list.length)];

/** Плита участка KayKit с тротуаром по краям - под зданием зоны. */
function plot(g: GeoBuilder, o: Orient) {
  const [x, z] = o.at(0, 0);
  g.model(MODELS.base, x, 0, z, KAY);
}

/** Мелочь KayKit в локальных координатах участка: u - вдоль улицы, f - к улице. */
function decor(g: GeoBuilder, o: Orient, m: ModelName, u: number, f: number, turn = 0) {
  const [x, z] = o.at(u, f);
  g.model(MODELS[m], x, 0.02, z, KAY, o.rot + turn);
}

/** Деталь здания в локальных координатах: u - вдоль улицы, f - к улице. */
function part(g: GeoBuilder, o: Orient, u: number, f: number, y0: number, w: number, h: number, d: number, color: number, top = color) {
  const [x, z] = o.at(u, f);
  g.box(x, y0, z, w, h, d, color, o.rot, top);
}

/** Окно: стекло и рама в плоскости фасада; light - ночной огонь в стекле. */
function pane(g: GeoBuilder, o: Orient, u: number, f: number, y0: number, w: number, h: number, light?: { kind: LightKind; seed: number; level?: number; color?: number }) {
  part(g, o, u, f, y0, w, h, 0.02, PALETTE.glassDark);
  part(g, o, u - w / 2 - 0.01, f + 0.01, y0 - 0.01, 0.02, h + 0.02, 0.03, PALETTE.frame);
  part(g, o, u + w / 2 + 0.01, f + 0.01, y0 - 0.01, 0.02, h + 0.02, 0.03, PALETTE.frame);
  part(g, o, u, f + 0.01, y0 - 0.01, w + 0.04, 0.02, 0.03, PALETTE.frame);
  part(g, o, u, f + 0.01, y0 + h - 0.01, w + 0.04, 0.02, 0.03, PALETTE.frame);
  if (light) {
    const [x, z] = o.at(u, f + 0.012);
    g.light(light.kind, x, y0 + h / 2, z, o.rot, light.seed, light.color ?? LIGHT_WINDOW, w, h, light.level ?? 0);
  }
}

/** Витрина: стеклянная лента с рамами по фасаду. */
function vitrine(g: GeoBuilder, o: Orient, u0: number, u1: number, f: number, y0: number, h: number, light?: { seed: number; color?: number }) {
  const w = u1 - u0, u = (u0 + u1) / 2;
  part(g, o, u, f, y0, w, h, 0.02, PALETTE.shopGlass);
  const n = Math.max(2, Math.round(w / 0.18));
  for (let i = 0; i <= n; i++) part(g, o, u0 + (w * i) / n, f + 0.008, y0, 0.025, h, 0.03, PALETTE.frame);
  part(g, o, u, f + 0.008, y0, w, 0.02, 0.03, PALETTE.frame);
  part(g, o, u, f + 0.008, y0 + h - 0.02, w, 0.02, 0.03, PALETTE.frame);
  if (light) {
    const [x, z] = o.at(u, f + 0.012);
    g.light('shopwindow', x, y0 + h / 2, z, o.rot, light.seed, light.color ?? LIGHT_SHOP, w, h, 1);
  }
}

/** Навес в полоску над входом; garland - гирлянда огней по краю. */
function awning(g: GeoBuilder, o: Orient, u0: number, u1: number, f: number, y0: number, depth: number, a: number, b: number, garland = false) {
  const n = Math.max(2, Math.round((u1 - u0) / 0.08));
  for (let i = 0; i < n; i++) {
    const u = u0 + ((u1 - u0) * (i + 0.5)) / n;
    part(g, o, u, f + depth / 2, y0, (u1 - u0) / n, 0.035, depth, i % 2 ? a : b);
  }
  if (garland) {
    const n2 = Math.max(3, Math.round((u1 - u0) / 0.09));
    for (let i = 0; i <= n2; i++) {
      const [x, z] = o.at(u0 + ((u1 - u0) * i) / n2, f + depth);
      g.light('garland', x, y0 - 0.01, z, o.rot, i * 3.1 + u0 * 5.7, LIGHT_GARLAND, 0.035, 0.035, 1);
    }
  }
}

/** Вывеска: рамка и цветное поле над входом; light - ночная подсветка. */
function signboard(g: GeoBuilder, o: Orient, u: number, f: number, y0: number, w: number, h: number, color: number, light?: { seed: number }) {
  part(g, o, u, f, y0, w, h, 0.05, PALETTE.frame);
  part(g, o, u, f + 0.03, y0 + 0.015, w - 0.05, h - 0.03, 0.02, color);
  if (light) {
    const [x, z] = o.at(u, f + 0.042);
    g.light('sign', x, y0 + h / 2, z, o.rot, light.seed, color, w * 0.82, h * 0.66, 1);
  }
}

/** Крышные блоки: вентиляция и кондиционеры. */
function roofUnits(g: GeoBuilder, o: Orient, us: number[], f: number, y0: number) {
  us.forEach((u, i) => {
    part(g, o, u, f, y0, 0.16, 0.07, 0.13, pick(PALETTE.metal, i));
    part(g, o, u, f, y0 + 0.07, 0.11, 0.02, 0.09, PALETTE.chimney);
  });
}

/** Труба: ствол с полосами и оголовок. */
function stack(g: GeoBuilder, o: Orient, u: number, f: number, y0: number, h: number, r = 0.08, ring = PALETTE.danger) {
  part(g, o, u, f, y0, r * 2, h, r * 2, PALETTE.chimney);
  for (let i = 1; i <= 2; i++) part(g, o, u, f, y0 + (h * i) / 3, r * 2.3, 0.04, r * 2.3, ring);
  part(g, o, u, f, y0 + h, r * 2.7, 0.03, r * 2.7, PALETTE.metal[1]);
}

/** Торговля: ларёк или лавка (1), магазин (2), торговый центр (3). */
function commercial(g: GeoBuilder, level: number, v: number, o: Orient) {
  if (level === 1) {
    if (v % 4 === 0) kiosk(g, v, o);
    else smallShop(g, v, o);
  } else if (level === 2) {
    if (v % 3 === 0) shop(g, v, o);
    else tallShop(g, v, o);
  } else { plot(g, o); mall(g, v, o); }
}

const SHOP_SMALL: KcName[] = ['building-c', 'building-e', 'building-d', 'building-h'];
const SHOP_TALL: KcName[] = ['building-a', 'building-b', 'building-f', 'building-g', 'building-h', 'building-d'];
const SHOP_WIDE: KcName[] = ['building-e', 'building-k', 'building-j'];
const OFFICE_WIDE: KcName[] = ['building-n', 'building-j', 'building-k'];
const TOWERS: KcName[] = ['building-skyscraper-a', 'building-l', 'building-skyscraper-c', 'building-m', 'building-skyscraper-e', 'building-i', 'building-skyscraper-b'];

/** Лавка по рецепту buildings/shop.ts, у части - столики кафе под зонтиками или скамейка, как у smallShop. */
function detailedShop(g: GeoBuilder, v: number, o: Orient) {
  plot(g, o);
  const [wall, trim] = shopPaint(v);
  shopFront(g, o, v, 0, -0.1, PLOT_TOP, 0.74, 0.56, wall, trim);
  if (v % 3 === 1) {
    for (const u of [0.04, 0.32]) {
      const [x, z] = o.at(u, 0.38);
      g.model(KC[v & 2 ? 'detail-parasol-a' : 'detail-parasol-b'], x, 0.02, z, 0.45, o.rot);
    }
  } else if (v % 3 === 2) decor(g, o, 'bench', 0.3, 0.38);
}

const shopPaint = (v: number) => [tone(PALETTE.shopWalls, v, 51), tone(PALETTE.shopTrim, v, 52)] as const;

/** Лавка (уровень 1): небольшой дом, у части лавок - столики кафе под зонтиками. */
function smallShop(g: GeoBuilder, v: number, o: Orient) {
  plot(g, o);
  const [wall, trim] = shopPaint(v);
  kenney(g, KC[pick(SHOP_SMALL, v >> 2)], o, 0, -0.08, 0.8, 0.66, wall, trim, 0, KEN, { kind: 'window', seed: v * 6.3, level: 1, shop: true });
  if (v % 3 === 1) {
    for (const u of [0.04, 0.32]) { // слева у лавки паркуется машина
      const [x, z] = o.at(u, 0.36);
      g.model(KC[v & 2 ? 'detail-parasol-a' : 'detail-parasol-b'], x, 0.02, z, 0.45, o.rot);
    }
  } else if (v % 3 === 2) decor(g, o, 'bench', 0.3, 0.38);
}

/** Магазин (уровень 2): дом в три-четыре этажа с витринами внизу. */
function tallShop(g: GeoBuilder, v: number, o: Orient) {
  plot(g, o);
  const [wall, trim] = shopPaint(v);
  kenney(g, KC[pick(SHOP_TALL, v >> 2)], o, 0, 0, 0.84, 0.84, wall, trim, 0, KEN, { kind: 'window', seed: v * 6.9, level: 2, shop: true });
  if (v % 2) decor(g, o, 'firehydrant', 0.42, 0.44);
}

/** Ларёк (уровень 1): прилавок с витриной, навес в полоску, вывеска, товар на улице. */
function kiosk(g: GeoBuilder, v: number, o: Orient) {
  plot(g, o);
  const wall = pick(PALETTE.planks, v), sign = pick(PALETTE.signs, v);
  part(g, o, 0, 0, 0.02, 0.5, 0.3, 0.4, wall);
  part(g, o, 0, 0, 0.32, 0.56, 0.05, 0.46, pick(PALETTE.roofRust, v >> 1));
  vitrine(g, o, -0.22, 0.08, 0.205, 0.05, 0.16, { seed: v * 2.7 });
  part(g, o, 0.16, 0.205, 0.03, 0.1, 0.2, 0.02, PALETTE.door);
  awning(g, o, -0.26, 0.24, 0.24, 0.25, 0.2, sign, PALETTE.frame, v % 2 === 0);
  signboard(g, o, 0, 0.23, 0.37, 0.36, 0.1, sign, { seed: v * 4.1 });
  part(g, o, -0.34, 0.26, 0.02, 0.1, 0.14, 0.1, pick(PALETTE.metal, v));
  part(g, o, 0.34, 0.3, 0.02, 0.1, 0.11, 0.09, PALETTE.crate);
  part(g, o, 0.34, 0.3, 0.13, 0.08, 0.08, 0.07, PALETTE.crate);
  if (v % 2) decor(g, o, 'trash_A', -0.4, 0.34, 0.4);
}

/** Магазин (уровень 2): два этажа, витрины и вывеска внизу, окна сверху, навес, крыша. */
function shop(g: GeoBuilder, v: number, o: Orient) {
  plot(g, o);
  const wall = pick(PALETTE.plaster, v), roof = pick(PALETTE.roofRust, v >> 2), sign = pick(PALETTE.signs, v >> 1);
  part(g, o, 0, 0, 0.02, 0.72, 0.2, 0.5, wall); // 1-й этаж
  part(g, o, 0, 0, 0.24, 0.72, 0.18, 0.5, wall); // 2-й этаж
  vitrine(g, o, -0.31, 0.06, 0.256, 0.05, 0.14, { seed: v * 2.9 });
  part(g, o, 0.22, 0.256, 0.03, 0.14, 0.17, 0.02, PALETTE.door);
  signboard(g, o, 0, 0.256, 0.2, 0.52, 0.09, sign, { seed: v * 4.7 });
  awning(g, o, -0.33, 0.33, 0.26, 0.17, 0.22, sign, PALETTE.frame, v % 3 === 0);
  for (const [i, u] of [-0.2, 0, 0.2].entries()) pane(g, o, u, 0.256, 0.28, 0.12, 0.1, { kind: 'window', seed: v * 3.3 + i * 12.1, level: 2 });
  part(g, o, 0.365, 0, 0.28, 0.02, 0.1, 0.16, PALETTE.glassDark);
  part(g, o, -0.365, 0, 0.28, 0.02, 0.1, 0.16, PALETTE.glassDark);
  if (v % 2) {
    part(g, o, 0, 0, 0.42, 0.78, 0.04, 0.56, roof);
    roofUnits(g, o, [-0.22, 0.22], -0.08, 0.46);
  } else {
    const [x, z] = o.at(0, 0);
    roofGable(g, x, 0.42, z, 0.78, 0.14, 0.56, roof, wall, o.rot);
  }
  decor(g, o, 'firehydrant', 0.42, 0.44);
  if (v % 3 === 0) decor(g, o, 'trash_A', -0.42, 0.42);
}

/** Торговый центр (уровень 3): широкий корпус, сплошное остекление, козырёк, пилон. */
function mall(g: GeoBuilder, v: number, o: Orient, wide = 0.9) {
  const hw = wide / 2;
  const wall = pick(PALETTE.plaster, v), sign = pick(PALETTE.signs, v);
  part(g, o, 0, -0.04, 0.02, wide, 0.34, 0.56, wall);
  part(g, o, 0, -0.04, 0.36, wide + 0.04, 0.05, 0.6, pick(PALETTE.roofRust, v >> 1));
  vitrine(g, o, -hw + 0.05, hw - 0.05, 0.245, 0.05, 0.2, { seed: v * 3.1 });
  part(g, o, 0, 0.245, 0.04, 0.28, 0.19, 0.02, PALETTE.door);
  signboard(g, o, 0, 0.245, 0.26, wide - 0.12, 0.1, sign, { seed: v * 5.3 });
  part(g, o, 0, 0.42, 0.31, 0.6, 0.03, 0.32, sign);
  for (const u of [-0.24, 0.24]) part(g, o, u, 0.54, 0.02, 0.04, 0.29, 0.04, PALETTE.metal[0]);
  roofUnits(g, o, [-hw + 0.16, 0, hw - 0.16], -0.16, 0.41);
  part(g, o, -hw + 0.03, 0.42, 0.02, 0.05, 0.32, 0.05, PALETTE.metal[0]);
  part(g, o, -hw + 0.03, 0.42, 0.34, 0.26, 0.16, 0.04, sign);
  decor(g, o, 'bush', hw - 0.06, 0.42);
  decor(g, o, 'bush', hw - 0.06, 0.26);
  if (v % 2) decor(g, o, 'trash_B', hw - 0.14, -0.42);
}

// Модели промзоны по уровням: навесы и склады, цеха, заводы с трубами
const FACTORY: KiName[][] = [
  ['building-h', 'building-i', 'building-j', 'building-k', 'building-s'],
  ['building-g', 'building-p', 'building-q', 'building-t', 'building-r', 'building-d'],
  ['building-b', 'building-c', 'building-e', 'building-f', 'building-l', 'building-m', 'building-n', 'building-a', 'building-o'],
];

/** Промзона: мастерская (1), цех (2), завод (3) - модель Kenney или своё здание. */
function industrial(g: GeoBuilder, level: number, v: number, o: Orient) {
  plot(g, o);
  const list = FACTORY[level - 1], k = v % (list.length + 1);
  if (k < list.length) {
    kenney(g, KI[list[k]], o, 0, 0, 0.88, 0.88, tone(PALETTE.factoryWalls, v, 53), tone(PALETTE.factoryTrim, v, 54), 0, KEN, { kind: 'worklight', seed: v * 6.1, level });
    return;
  }
  if (level === 1) workshop(g, v, o);
  else if (level === 2) hall(g, v, o);
  else works(g, v, o);
}

/** Мастерская (уровень 1): ангар из металла, роллеты, труба, бочки и ящики во дворе. */
function workshop(g: GeoBuilder, v: number, o: Orient) {
  const wall = pick(PALETTE.metal, v), roof = pick(PALETTE.roofRust, v >> 1);
  part(g, o, 0, -0.02, 0.02, 0.7, 0.3, 0.56, wall);
  part(g, o, 0, -0.02, 0.02, 0.72, 0.09, 0.58, PALETTE.chimney); // цоколь
  part(g, o, 0, -0.02, 0.27, 0.72, 0.03, 0.58, pick(PALETTE.metal, v + 1)); // поясок
  part(g, o, 0, -0.02, 0.32, 0.76, 0.04, 0.62, roof);
  part(g, o, 0.16, 0.262, 0.03, 0.34, 0.22, 0.02, PALETTE.metal[1]); // роллеты
  for (let i = 0; i < 4; i++) part(g, o, 0.16, 0.275, 0.05 + i * 0.05, 0.34, 0.02, 0.02, PALETTE.chimney);
  pane(g, o, -0.24, 0.268, 0.19, 0.16, 0.11, { kind: 'worklight', seed: v * 5.1 });
  stack(g, o, 0.34, -0.22, 0.36, 0.22, 0.045);
  part(g, o, -0.4, 0.32, 0.02, 0.14, 0.16, 0.14, PALETTE.crate);
  part(g, o, -0.4, 0.32, 0.18, 0.11, 0.1, 0.11, PALETTE.crate);
  part(g, o, 0.36, 0.36, 0.02, 0.1, 0.15, 0.1, PALETTE.danger, PALETTE.metal[0]); // бочка
  {
    const [fx, fz] = o.at(0.36, 0.36);
    g.light('fire', fx, 0.19, fz, o.rot, v * 7.3, LIGHT_FIRE, 0.09, 0.13, 1);
  }
  part(g, o, 0.36, 0.2, 0.02, 0.1, 0.15, 0.1, PALETTE.metal[2], PALETTE.metal[0]);
  if (v % 2) decor(g, o, 'dumpster', -0.36, -0.4);
  else decor(g, o, 'box_A', 0.38, -0.36);
}

/** Цех (уровень 2): корпус с фонарями на крыше, окна-ленты, труба, погрузочная площадка. */
function hall(g: GeoBuilder, v: number, o: Orient) {
  const wall = pick(PALETTE.metal, v), roof = pick(PALETTE.roofRust, v >> 1);
  part(g, o, 0, -0.02, 0.02, 0.86, 0.42, 0.62, wall);
  part(g, o, 0, -0.02, 0.02, 0.88, 0.12, 0.64, PALETTE.chimney); // цоколь
  part(g, o, 0, -0.02, 0.39, 0.88, 0.03, 0.64, pick(PALETTE.metal, v + 1)); // поясок
  part(g, o, 0, -0.02, 0.44, 0.9, 0.04, 0.66, roof);
  for (let i = 0; i < 3; i++) { // фонари на крыше с остеклением
    const u = -0.28 + i * 0.28;
    part(g, o, u, -0.1, 0.48, 0.2, 0.12, 0.3, PALETTE.metal[2]);
    part(g, o, u, 0.03, 0.5, 0.2, 0.06, 0.02, PALETTE.shopGlass);
  }
  for (let i = 0; i < 3; i++) pane(g, o, -0.26 + i * 0.26, 0.295, 0.19, 0.16, 0.14, { kind: 'worklight', seed: v * 5.9 + i * 8.3 });
  part(g, o, 0, 0.295, 0.02, 0.3, 0.26, 0.02, PALETTE.metal[1]); // ворота
  stack(g, o, -0.36, -0.26, 0.02, 0.62, 0.065);
  part(g, o, 0.36, 0.34, 0.02, 0.06, 0.5, 0.06, PALETTE.metal[0]); // трубы по стене
  part(g, o, 0.36, 0.28, 0.5, 0.06, 0.06, 0.18, PALETTE.metal[0]);
  part(g, o, -0.34, 0.44, 0.02, 0.42, 0.06, 0.16, PALETTE.concrete[0]); // площадка
  for (const u of [-0.44, -0.32]) part(g, o, u, 0.44, 0.08, 0.1, 0.1, 0.14, PALETTE.crate);
  if (v % 2) decor(g, o, 'box_B', 0.42, -0.42);
  else decor(g, o, 'dumpster', 0.42, -0.42);
}

/** Завод (уровень 3): корпус, две трубы, градирня, силос, козловой кран над двором. */
function works(g: GeoBuilder, v: number, o: Orient) {
  const wall = pick(PALETTE.metal, v), roof = pick(PALETTE.roofRust, v >> 1);
  part(g, o, -0.06, -0.13, 0.02, 0.8, 0.5, 0.62, wall);
  part(g, o, -0.06, -0.13, 0.02, 0.84, 0.14, 0.66, PALETTE.chimney); // цоколь
  part(g, o, -0.06, -0.13, 0.47, 0.84, 0.03, 0.66, pick(PALETTE.metal, v + 1)); // поясок
  part(g, o, -0.06, -0.13, 0.52, 0.86, 0.05, 0.68, roof);
  pane(g, o, -0.22, 0.185, 0.24, 0.18, 0.16, { kind: 'worklight', seed: v * 6.7 });
  part(g, o, 0.06, 0.185, 0.02, 0.3, 0.4, 0.02, PALETTE.metal[1]); // ворота
  // Бочка с огнём у ворот: единственный живой огонь в промзоне
  {
    const [fx, fz] = o.at(0.34, 0.3);
    g.light('fire', fx, 0.2, fz, o.rot, v * 8.1, LIGHT_FIRE, 0.12, 0.16, 1);
  }
  stack(g, o, 0.3, -0.3, 0.02, 0.9, 0.075);
  stack(g, o, 0.1, -0.34, 0.02, 0.76, 0.075);
  part(g, o, -0.42, 0.34, 0.02, 0.32, 0.3, 0.32, PALETTE.concrete[0]); // градирня
  part(g, o, -0.42, 0.34, 0.32, 0.26, 0.24, 0.26, PALETTE.concrete[1]);
  part(g, o, -0.42, 0.34, 0.56, 0.2, 0.18, 0.2, PALETTE.concrete[2]);
  part(g, o, 0.42, -0.28, 0.02, 0.2, 0.46, 0.2, PALETTE.tank); // силос
  part(g, o, 0.42, -0.28, 0.48, 0.24, 0.04, 0.24, PALETTE.metal[0]);
  part(g, o, 0.42, -0.28, 0.52, 0.16, 0.06, 0.16, PALETTE.tank);
  part(g, o, -0.28, 0.36, 0.02, 0.05, 0.42, 0.05, PALETTE.metal[0]); // труба к градирне
  part(g, o, -0.28, 0.42, 0.42, 0.05, 0.05, 0.22, PALETTE.metal[0]);
  for (const u of [-0.44, 0.44]) part(g, o, u, 0.46, 0.02, 0.05, 0.62, 0.05, PALETTE.crane); // козловой кран
  part(g, o, 0, 0.46, 0.64, 0.94, 0.05, 0.05, PALETTE.crane);
  part(g, o, 0.12, 0.46, 0.5, 0.06, 0.12, 0.06, PALETTE.danger);
  part(g, o, -0.36, 0.46, 0.02, 0.1, 0.15, 0.1, PALETTE.hazard, PALETTE.metal[0]); // бочки
  part(g, o, 0.3, 0.46, 0.02, 0.24, 0.08, 0.18, PALETTE.crate);
  decor(g, o, 'dumpster', 0.44, 0.42);
}

/** Посевы рядами на участке u0..u1 x f0..f1 (локальные координаты клетки): борозда под каждым рядом. */
function cropRows(g: GeoBuilder, o: Orient, crop: NatureName, rows: number, perRow: number, u0: number, u1: number, f0: number, f1: number, scale: number, v: number) {
  for (let r = 0; r < rows; r++) {
    const u = rows > 1 ? u0 + ((u1 - u0) * r) / (rows - 1) : (u0 + u1) / 2;
    part(g, o, u, (f0 + f1) / 2, 0, 0.12, 0.014, f1 - f0 + 0.1, PALETTE.dirtSide);
    for (let i = 0; i < perRow; i++) {
      const f = perRow > 1 ? f0 + ((f1 - f0) * i) / (perRow - 1) : (f0 + f1) / 2;
      const [x, z] = o.at(u, f);
      g.model(NATURE[crop], x, 0.01, z, scale, o.rot + Math.floor(rnd(v, r * 7 + i) * 4) * (Math.PI / 2));
    }
  }
}

/** Силос: цилиндр с поясами и конусной крышей. */
function silo(g: GeoBuilder, x: number, z: number, h: number, r: number, color: number, roof: number) {
  g.cylinder(pose(x, 0, z), r, h, color, 12);
  for (const y of [h * 0.33, h * 0.66]) g.cylinder(pose(x, y, z), r + 0.008, 0.02, PALETTE.metal[1], 12);
  g.cylinder(pose(x, h, z), r + 0.01, r * 0.8, roof, 12, roof, 0);
}

/** Теплица: каркас, стеклянные стены и двускатная крыша. */
function greenhouse(g: GeoBuilder, o: Orient, u: number, f: number, w: number, d: number) {
  const [x, z] = o.at(u, f);
  g.box(x, 0, z, w, 0.02, d, PALETTE.planks[1], o.rot);
  g.box(x, 0.02, z, w, 0.12, d, PALETTE.greenhouse, o.rot);
  roofGable(g, x, 0.14, z, w + 0.02, 0.08, d + 0.02, PALETTE.greenhouse, PALETTE.greenhouse, o.rot);
  for (let i = 0; i <= 4; i++) part(g, o, u - w / 2 + (w * i) / 4, f, 0.02, 0.012, 0.13, d + 0.006, PALETTE.frame);
  cropRows(g, o, 'crops_leafsStageA', 2, 3, u - w / 4, u + w / 4, f - d / 3, f + d / 3, 0.12, 0);
}

/** Сарай или амбар: дощатые стены, двускатная крыша, ворота с белым крестом. */
function barn(g: GeoBuilder, o: Orient, u: number, f: number, w: number, h: number, d: number, wall: number, roof: number, lamp = false) {
  const [x, z] = o.at(u, f);
  g.box(x, 0, z, w, h, d, wall, o.rot);
  roofGable(g, x, h, z, d + 0.06, h * 0.6, w + 0.06, roof, wall, o.rot + Math.PI / 2);
  part(g, o, u, f + d / 2 + 0.006, 0, w * 0.45, h * 0.8, 0.012, PALETTE.door);
  part(g, o, u, f + d / 2 + 0.014, h * 0.4 - 0.008, w * 0.45, 0.016, 0.006, PALETTE.frame);
  part(g, o, u, f + d / 2 + 0.014, 0, 0.016, h * 0.8, 0.006, PALETTE.frame);
  // Лампа над воротами амбара: горит всю ночь, как дежурный свет
  if (lamp) {
    const [lx, lz] = o.at(u, f + d / 2 + 0.03);
    g.light('workshop', lx, h * 0.86, lz, o.rot, u * 9.1 + f * 3.7, LIGHT_WARM, 0.12, 0.1, 2);
  }
}

const VEGGIES: NatureName[] = ['crop_pumpkin', 'crop_melon', 'crop_carrot', 'crop_turnip', 'crops_leafsStageB'];
const GRAIN: NatureName[] = ['crops_wheatStageB', 'crops_cornStageB', 'crops_wheatStageA'];

/** Ферма: огород (1), поле (2), хозяйство с амбаром, силосами или теплицей (3). */
function farm(g: GeoBuilder, level: number, v: number, o: Orient) {
  if (level === 1) {
    // Огород за забором: грядки, сарайчик для инструмента, поленница
    cropRows(g, o, pick(VEGGIES, v), 3, 3, -0.3, 0.12, -0.3, 0.25, 0.32, v);
    barn(g, o, 0.3, -0.28, 0.2, 0.16, 0.18, pick(PALETTE.planks, v), pick(PALETTE.roofRust, v >> 2));
    const [lx, lz] = o.at(0.32, 0.08);
    g.model(NATURE.log_stack, lx, 0, lz, 0.28, o.rot);
    fence(g, o, 0.45, true);
    return;
  }
  const grain = pick(GRAIN, v >> 1);
  if (level === 2) {
    // Поле с краю участка, рядом теплица или бак с водой и пугало
    if (v % 2) {
      cropRows(g, o, grain, 3, 5, -0.36, -0.04, -0.36, 0.36, 0.32, v);
      greenhouse(g, o, 0.22, 0, 0.32, 0.7);
    } else {
      cropRows(g, o, grain, 4, 5, -0.36, 0.2, -0.36, 0.36, 0.32, v);
      const [tx, tz] = o.at(0.38, 0.3);
      g.model(PROPS.GasTank, tx, 0, tz, 0.12); // бак с водой для полива
      part(g, o, 0.38, -0.3, 0, 0.02, 0.24, 0.02, PALETTE.trunk); // пугало
      part(g, o, 0.38, -0.3, 0.16, 0.14, 0.02, 0.02, PALETTE.trunk);
      part(g, o, 0.38, -0.3, 0.12, 0.06, 0.08, 0.04, pick(PALETTE.paint, v));
    }
    return;
  }
  // Хозяйство: постройки в глубине клетки, поле у дороги
  const crop: NatureName = v & 4 ? 'crops_cornStageC' : grain;
  cropRows(g, o, crop, 4, 2, -0.36, 0.36, 0.14, 0.38, 0.28, v);
  switch (v % 3) {
    case 0: { // амбар и силос
      barn(g, o, -0.14, -0.2, 0.46, 0.26, 0.36, PALETTE.brick[v % 3], pick(PALETTE.metal, v), true);
      const [sx, sz] = o.at(0.3, -0.24);
      silo(g, sx, sz, 0.5, 0.11, PALETTE.tank, pick(PALETTE.roofRust, v));
      break;
    }
    case 1: { // два силоса и поддоны с мешками
      for (const u of [-0.28, 0.02]) {
        const [sx, sz] = o.at(u, -0.24);
        silo(g, sx, sz, 0.56, 0.12, PALETTE.tank, PALETTE.metal[0]);
      }
      const [px, pz] = o.at(0.3, -0.22);
      g.model(PROPS.Pallet, px, 0, pz, 0.12, o.rot);
      g.model(PROPS.Crate, px, 0.024, pz, 0.14, o.rot + 0.3);
      break;
    }
    default: // длинная теплица
      greenhouse(g, o, 0, -0.2, 0.8, 0.36);
  }
}

// Двускатная крыша с учётом поворота: конёк вдоль фасада
function roofGable(g: GeoBuilder, x: number, y0: number, z: number, along: number, h: number, depth: number, color: number, gableColor: number, rot: number) {
  const across = Math.abs(Math.sin(rot)) > 0.5;
  g.gable(x, y0, z, across ? depth : along, h, across ? along : depth, color, gableColor, across);
}

function addBuilding(g: GeoBuilder, t: Tile, cx: number, cz: number, w: World) {
  const def = BUILDING_BY_ID[t.def!];
  if (!def) return;
  // Центр здания: у 2x2 - угол между четырьмя клетками
  const off = (def.size - 1) / 2;
  const x = cx + off, z = cz + off;
  if (t.build > 0) return addSite(g, def.size, 1 - t.build / def.buildDays, def.size * 2, t.variant, x, z);
  switch (def.id) {
    case 'plant': addPlant(g, x, z); break;
    case 'pump': addPump(g, t.variant, x, z); break;
    case 'mine': addMine(g, x, z); break;
    case 'lab': case 'lab2': case 'lab3': addLab(g, def.labTier ?? 1, x, z); break;
    case 'workshop': addWorkshop(g, x, z); break;
    case 'clinic': addClinic(g, x, z); break;
    case 'school': addSchool(g, x, z); break;
    case 'radar': addRadar(g, x, z); break;
    case 'bunker': addBunker(g, x, z, w.bunker?.root === t.root ? w.bunker.upgrades : [], bunkerFace(w, t.root)); break;
    case 'outpost': addOutpost(g, x, z); break;
    default: if (def.aa) addAntiAir(g, def.id, x, z);
  }
  // Повреждения: копоть на крыше и обломки вокруг
  if (t.hp < def.hp) {
    const s = def.size * 0.35;
    g.box(x - s * 0.3, 0.01, z + s * 0.4, s * 0.6, 0.02, s * 0.5, PALETTE.soot, 0.3);
    g.box(x + s * 0.5, 0, z - s * 0.5, 0.14, 0.08, 0.1, PALETTE.concrete[3], 0.8);
    g.box(x - s * 0.6, 0, z - s * 0.2, 0.1, 0.06, 0.16, PALETTE.concrete[1], 0.2);
  }
}

/** Стройплощадка: плита, забор, леса растут с прогрессом 0..1 до высоты floors этажей, кран. */
function addSite(g: GeoBuilder, size: number, progress: number, floors: number, v: number, cx: number, cz: number) {
  const half = size * 0.45;
  g.box(cx, 0, cz, size * 0.9, 0.03, size * 0.9, PALETTE.site);
  // Забор по периметру: столбики через равные промежутки
  const posts = 2 + size * 2;
  for (let i = 0; i < posts; i++) {
    const k = -half + (i * 2 * half) / (posts - 1);
    for (const [px, pz] of [[k, -half], [k, half], [-half, k], [half, k]]) g.box(cx + px, 0, cz + pz, 0.03, 0.12, 0.03, PALETTE.stake);
  }
  // Растущий каркас: бетонный короб и стойки лесов по углам
  const w = size * 0.6;
  const h = Math.max(0.06, progress * floors * 0.18);
  g.box(cx, 0, cz, w, h * 0.85, w, PALETTE.concrete[(v >> 2) % 4]);
  for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) g.box(cx + (sx * w) / 2, 0, cz + (sz * w) / 2, 0.035, h + 0.08, 0.035, PALETTE.scaffold);
  g.box(cx, h, cz - w / 2, w + 0.04, 0.025, 0.06, PALETTE.scaffold);
  g.box(cx, h, cz + w / 2, w + 0.04, 0.025, 0.06, PALETTE.scaffold);
  // Кран: мачта в углу, стрела над площадкой, противовес
  const mx = cx + half * 0.8, mz = cz - half * 0.8;
  const top = h + 0.35 + size * 0.15;
  g.box(mx, 0, mz, 0.06, top, 0.06, PALETTE.crane);
  const jib = size * 0.75;
  g.box(mx - jib / 2 + 0.1, top, mz + 0.05, jib, 0.04, 0.04, PALETTE.crane, -0.6);
  g.box(mx + 0.16, top - 0.04, mz - 0.1, 0.14, 0.08, 0.1, PALETTE.metal[1], -0.6);
}

/** Спецздание смотрит фасадом к +z; u - вдоль x, f - вдоль z от центра. */
const upright = (cx: number, cz: number) => oriented(cx, cz, 0);

function addPlant(g: GeoBuilder, cx: number, cz: number) {
  // Электростанция: машинный зал с трубами, градирня, баки топлива на бетонной площадке
  const o = upright(cx, cz);
  g.box(cx, 0, cz, 1.9, 0.02, 1.9, PALETTE.concrete[1]);
  kenney(g, KI['building-m'], o, -0.35, 0.3, 1.15, 1.2, PALETTE.metal[1], PALETTE.roofRust[1], 0, 1, { kind: 'worklight', seed: cx * 3.1 + cz, level: 3 });
  kenney(g, KI['chimney-large'], o, 0.5, -0.45, 0.8, 0.8, PALETTE.concrete[2], PALETTE.danger, 0, 1);
  kenney(g, KI['detail-tank'], o, -0.55, -0.62, 0.7, 0.4, PALETTE.tank, PALETTE.metal[1]);
  kenney(g, KI['detail-tank'], o, 0.55, 0.62, 0.7, 0.4, PALETTE.tank, PALETTE.metal[1]);
}

function addPump(g: GeoBuilder, v: number, cx: number, cz: number) {
  // Насосная: будка у воды и водонапорная башня
  g.box(cx - 0.2, 0, cz + 0.15, 0.4, 0.28, 0.4, pick(PALETTE.concrete, v));
  g.box(cx - 0.2, 0.28, cz + 0.15, 0.46, 0.04, 0.46, pick(PALETTE.roofRust, v));
  g.box(cx - 0.2, 0, cz + 0.36, 0.12, 0.2, 0.02, PALETTE.door);
  g.light('worklight', cx - 0.2, 0.25, cz + 0.37, 0, v * 4.9, LIGHT_WORK, 0.16, 0.1, 2);
  kenney(g, KI['water-tower'], upright(cx, cz), 0.17, -0.17, 0.56, 0.56, PALETTE.waterTank, PALETTE.metal[1], 0, 1);
}

function addMine(g: GeoBuilder, cx: number, cz: number) {
  // Шахта: копёр (башня с колесом), тёмный ствол, отвалы руды, вагонетка
  g.box(cx - 0.35, 0, cz - 0.3, 0.7, 0.04, 0.7, PALETTE.pit);
  for (const [dx, dz] of [[-0.6, -0.55], [-0.1, -0.55], [-0.6, -0.05], [-0.1, -0.05]]) g.box(cx + dx + 0.0, 0, cz + dz, 0.05, 1.2, 0.05, PALETTE.metal[1]);
  g.box(cx - 0.35, 1.2, cz - 0.3, 0.6, 0.06, 0.6, PALETTE.metal[1]);
  g.box(cx - 0.35, 1.26, cz - 0.3, 0.06, 0.34, 0.34, PALETTE.danger);
  g.box(cx + 0.45, 0, cz + 0.35, 0.5, 0.22, 0.45, PALETTE.ore, 0.3);
  g.box(cx + 0.5, 0.22, cz + 0.35, 0.3, 0.12, 0.28, PALETTE.ore, 0.6);
  kenney(g, KI['building-k'], upright(cx, cz), -0.4, 0.55, 0.8, 0.6, PALETTE.factoryWalls[5], PALETTE.roofRust[1], 0, KEN, { kind: 'worklight', seed: cx * 5.7 + cz, level: 3 });
  g.model(KI['shipping-container-a'], cx + 0.6, 0.02, cz - 0.5, 0.7, Math.PI / 2);
  g.box(cx + 0.1, 0, cz - 0.2, 0.22, 0.12, 0.14, PALETTE.roofRust[1]);
}

function addLab(g: GeoBuilder, tier: number, cx: number, cz: number) {
  // Лаборатория XCOM: светлый корпус с синей отделкой; с ярусом растёт в высоту
  const o = upright(cx, cz);
  let roof: number;
  if (tier === 1) {
    roof = kenney(g, KC['building-e'], o, 0, 0.1, 1.8, 1.4, PALETTE.labWall, PALETTE.xcomRoof, 0, 1, { kind: 'lab', seed: cx * 2.3 + cz, level: 2, color: LIGHT_LAB });
  } else if (tier === 2) {
    roof = kenney(g, KC['building-n'], o, 0, 0, 1.86, 1.8, PALETTE.labWall, PALETTE.xcomRoof, 0, 1, { kind: 'lab', seed: cx * 2.3 + cz, level: 3, color: LIGHT_LAB });
  } else {
    // Башня исследовательского центра и корпус рядом
    kenney(g, KC['building-e'], o, 0.32, 0.45, 1.25, 0.9, PALETTE.labWall, PALETTE.xcomRoof, 0, 1, { kind: 'lab', seed: cx * 2.3 + cz, level: 2, color: LIGHT_LAB });
    roof = kenney(g, KC['building-skyscraper-c'], o, -0.45, -0.4, 0.95, 0.95, PALETTE.labWall, PALETTE.xcomRoof, 0, 1, { kind: 'lab', seed: cx * 2.9 + cz, level: 3, color: LIGHT_LAB });
    cx -= 0.45; cz -= 0.4;
  }
  // Антенна на крыше
  g.box(cx + 0.2, roof, cz - 0.15, 0.04, 0.45, 0.04, PALETTE.metal[0]);
  g.box(cx + 0.2, roof + 0.45, cz - 0.15, 0.16, 0.04, 0.16, PALETTE.xcom);
}

function addWorkshop(g: GeoBuilder, cx: number, cz: number) {
  // Мастерская: цех с воротами, кран-балка, контейнеры и ящики во дворе
  const o = upright(cx, cz);
  g.box(cx, 0, cz, 1.9, 0.02, 1.9, PALETTE.concrete[0]);
  kenney(g, KI['building-r'], o, -0.12, -0.15, 1.6, 1.3, PALETTE.metal[2], PALETTE.xcomRoof, 0, 1, { kind: 'workshop', seed: cx * 3.7 + cz, level: 2 });
  g.model(KI['shipping-container-b'], cx + 0.72, 0.02, cz + 0.45, 0.7);
  g.box(cx + 0.82, 0, cz - 0.7, 0.06, 1.1, 0.06, PALETTE.danger);
  g.box(cx + 0.5, 1.05, cz - 0.7, 0.7, 0.06, 0.06, PALETTE.danger);
  g.box(cx + 0.1, 0, cz + 0.75, 0.18, 0.18, 0.18, PALETTE.crate);
  g.box(cx - 0.12, 0, cz + 0.8, 0.14, 0.14, 0.14, PALETTE.crate, 0.5);
}

function addClinic(g: GeoBuilder, cx: number, cz: number) {
  // Лазарет: белый корпус, красный крест на крыше, скамейки и кусты у входа
  const o = upright(cx, cz);
  const roof = kenney(g, KC['building-k'], o, 0, -0.1, 1.8, 1.4, 0xeef0ec, PALETTE.paint[1], 0, 1, { kind: 'window', seed: cx * 4.3 + cz, level: 2 });
  g.box(cx, roof, cz - 0.1, 0.42, 0.03, 0.13, PALETTE.clinicCross);
  g.box(cx, roof, cz - 0.1, 0.13, 0.03, 0.42, PALETTE.clinicCross);
  decor(g, o, 'bench', -0.55, 0.75);
  decor(g, o, 'bench', 0.55, 0.75);
  for (const u of [-0.85, 0.85]) decor(g, o, 'bush', u, 0.75);
}

function addSchool(g: GeoBuilder, cx: number, cz: number) {
  // Школа (временная, до генератора зданий - этап 5 плана 010): кирпичный корпус в глубине,
  // перед ним спортплощадка с разметкой и воротами, флагшток, скамейка
  const o = upright(cx, cz);
  kenney(g, KC['building-j'], o, 0, -0.42, 1.8, 0.9, PALETTE.brick[0], PALETTE.roofRust[1], 0, 1, { kind: 'window', seed: cx * 5.7 + cz, level: 2 });
  part(g, o, -0.3, 0.45, 0.01, 1.05, 0.015, 0.7, PALETTE.lawn);
  for (const f of [0.1, 0.8]) part(g, o, -0.3, f, 0.025, 1.05, 0.004, 0.02, PALETTE.frame);
  for (const u of [-0.83, 0.23, -0.3]) part(g, o, u, 0.45, 0.025, 0.02, 0.004, 0.7, PALETTE.frame);
  for (const u of [-0.78, 0.18]) {
    part(g, o, u, 0.3, 0.025, 0.015, 0.09, 0.015, PALETTE.frame);
    part(g, o, u, 0.6, 0.025, 0.015, 0.09, 0.015, PALETTE.frame);
    part(g, o, u, 0.45, 0.115, 0.015, 0.015, 0.31, PALETTE.frame);
  }
  part(g, o, 0.6, 0.7, 0.01, 0.025, 0.55, 0.025, PALETTE.metal[0]);
  part(g, o, 0.67, 0.7, 0.44, 0.12, 0.08, 0.01, PALETTE.signs[1]);
  decor(g, o, 'bench', 0.6, 0.35);
  decor(g, o, 'bush', 0.85, 0.85);
}

function addRadar(g: GeoBuilder, cx: number, cz: number) {
  // Радар: будка и тарелка на мачте
  kenney(g, KC['building-c'], upright(cx, cz), -0.2, 0.2, 0.45, 0.45, PALETTE.labWall, PALETTE.xcomRoof, 0, 1, { kind: 'window', seed: cx * 6.1 + cz, level: 1 });
  g.light('beacon', cx + 0.15, 0.97, cz - 0.1, 0, cx * 7.7 + cz, LIGHT_BEACON, 0.06, 0.06, 1);
  g.box(cx + 0.15, 0, cz - 0.1, 0.06, 0.8, 0.06, PALETTE.metal[0]);
  g.box(cx + 0.15, 0.8, cz - 0.1, 0.5, 0.05, 0.5, PALETTE.dish, 0.5);
  g.box(cx + 0.15, 0.85, cz - 0.1, 0.06, 0.2, 0.06, PALETTE.xcom);
}

/** Сторона бункера 3x3, к которой подходит больше всего дорог (0 - +z, 1 - +x, 2 - -z, 3 - -x). */
export function bunkerFace(w: World, root: number): number {
  const x0 = root % w.size, y0 = Math.floor(root / w.size);
  const sides = [0, 0, 0, 0];
  for (let k = 0; k < 3; k++) {
    if (tileAt(w, x0 + k, y0 + 3)?.object === 'road') sides[0]++;
    if (tileAt(w, x0 + 3, y0 + k)?.object === 'road') sides[1]++;
    if (tileAt(w, x0 + k, y0 - 1)?.object === 'road') sides[2]++;
    if (tileAt(w, x0 - 1, y0 + k)?.object === 'road') sides[3]++;
  }
  return sides.indexOf(Math.max(...sides));
}

/**
 * Бункер 3x3: бетонная площадка, насыпь над убежищем, гермоворота к дороге, вентиляция, антенна.
 * Улучшения видно снаружи: гараж, радар командного пункта, крест медблока, казармы, ящики оружейной.
 * u - вдоль фасада, f - к дороге.
 */
function addBunker(g: GeoBuilder, cx: number, cz: number, ups: string[], face: number) {
  const has = (id: string) => ups.includes(id);
  const o = oriented(cx, cz, face);
  const p = (u: number, f: number, y0: number, w: number, h: number, d: number, color: number, top = color) => part(g, o, u, f, y0, w, h, d, color, top);
  const at = (u: number, f: number) => o.at(u, f);
  p(0, 0, 0, 2.9, 0.03, 2.9, PALETTE.concrete[3], PALETTE.concrete[1]);
  // Насыпь: бетонный короб, засыпанный землёй, с двускатным травяным верхом
  p(0, -0.25, 0.03, 2.3, 0.3, 1.8, PALETTE.concrete[3]);
  const [mx, mz] = at(0, -0.25);
  g.gable(mx, 0.33, mz, face % 2 ? 1.8 : 2.3, 0.28, face % 2 ? 2.3 : 1.8, 0x6d7a4f, PALETTE.concrete[3], face % 2 === 1);
  // Гермоворота: портал, створка с жёлто-чёрной полосой
  p(-0.45, 0.66, 0.03, 0.9, 0.42, 0.12, PALETTE.concrete[1]);
  p(-0.45, 0.73, 0.06, 0.62, 0.32, 0.03, PALETTE.metal[1]);
  for (let i = 0; i < 4; i++) p(-0.68 + i * 0.155, 0.75, 0.06, 0.07, 0.04, 0.02, i % 2 ? 0x222222 : PALETTE.hazard);
  const [lx, lz] = at(-0.45, 0.74);
  g.light('worklight', lx, 0.42, lz, o.rot, cx * 9.1 + cz, LIGHT_WORK, 0.12, 0.06, 2);
  // Мешки с песком у входа
  for (const u of [-1.05, 0.15]) {
    const [sx, sz] = at(u, 1.02);
    g.model(PROPS.SackTrench_Small, sx, 0.03, sz, 0.22, o.rot);
  }
  // Вентиляция и антенна на насыпи
  for (const u of [-0.75, 0.75]) {
    const [vx, vz] = at(u, -0.7);
    g.cylinder(pose(vx, 0.33, vz), 0.06, 0.32, PALETTE.metal[0], 8);
    p(u, -0.7, 0.65, 0.16, 0.04, 0.16, PALETTE.metal[1]);
  }
  p(1.05, -1.05, 0.03, 0.04, 1.2, 0.04, PALETTE.metal[0]);
  const [ax, az] = at(1.05, -1.05);
  g.light('beacon', ax, 1.24, az, 0, cx * 6.7 + cz, LIGHT_BEACON, 0.06, 0.06, 1);
  if (has('garage')) {
    // Гараж броневика: широкие ворота рядом и разметка выезда
    p(0.65, 0.62, 0.03, 0.8, 0.46, 0.2, PALETTE.concrete[0]);
    p(0.65, 0.73, 0.06, 0.64, 0.36, 0.03, PALETTE.military);
    p(0.65, 1.1, 0.031, 0.5, 0.004, 0.5, PALETTE.hazard);
  }
  if (has('command')) {
    p(-0.2, -0.25, 0.61, 0.04, 0.5, 0.04, PALETTE.metal[0]);
    const [dx, dz] = at(-0.2, -0.25);
    g.cylinder(pose(dx, 1.1, dz, 0.6 + o.rot, 0.9), 0.24, 0.03, PALETTE.dish, 14);
  }
  if (has('medbay')) {
    p(0.45, -0.1, 0.62, 0.34, 0.02, 0.1, PALETTE.clinicCross);
    p(0.45, -0.1, 0.62, 0.1, 0.02, 0.34, PALETTE.clinicCross);
  }
  if (has('barracks2')) p(-1.1, -0.3, 0.03, 0.5, 0.32, 1.2, PALETTE.military, 0x6d7a4f);
  if (has('barracks3')) p(1.1, -0.1, 0.03, 0.5, 0.32, 1.0, PALETTE.military, 0x6d7a4f);
  if (has('armory')) {
    for (const [u, f, sc] of [[-1.15, 0.55, 0.16], [-1.0, 0.7, 0.14]] as const) {
      const [bx, bz] = at(u, f);
      g.model(PROPS.Crate, bx, 0.03, bz, sc, o.rot + u);
    }
  }
  if (has('shelter')) p(1.2, 1.0, 0.03, 0.18, 0.3, 0.04, PALETTE.hazard);
}

/** Застава: ангар броневика с воротами, мешки с песком, флагшток. */
function addOutpost(g: GeoBuilder, cx: number, cz: number) {
  const o = upright(cx, cz);
  g.box(cx, 0, cz, 1.9, 0.03, 1.9, PALETTE.concrete[1]);
  kenney(g, KI['building-r'], o, 0, -0.2, 1.5, 1.1, PALETTE.military, PALETTE.xcomRoof, 0, 1, { kind: 'workshop', seed: cx * 4.1 + cz, level: 2 });
  g.box(cx, 0.03, cz + 0.38, 0.8, 0.4, 0.04, PALETTE.metal[1]);
  g.box(cx, 0.031, cz + 0.75, 0.6, 0.004, 0.3, PALETTE.hazard);
  g.model(PROPS.SackTrench_Small, cx - 0.7, 0.03, cz + 0.75, 0.2);
  g.model(PROPS.SackTrench_Small, cx + 0.7, 0.03, cz + 0.75, 0.2);
  g.box(cx + 0.8, 0.03, cz - 0.8, 0.03, 0.9, 0.03, PALETTE.metal[0]);
  g.box(cx + 0.68, 0.78, cz - 0.8, 0.22, 0.14, 0.01, PALETTE.xcom);
  g.light('beacon', cx + 0.8, 0.95, cz - 0.8, 0, cx * 5.3 + cz, LIGHT_BEACON, 0.05, 0.05, 1);
}

/** Матрица для наклонных деталей: точка (x, y, z), поворот yaw вокруг Y, наклон оси +y к -z на pitch. */
function pose(x: number, y: number, z: number, yaw = 0, pitch = 0): THREE.Matrix4 {
  const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(-pitch, yaw, 0, 'YXZ'));
  return new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), q, new THREE.Vector3(1, 1, 1));
}

/** Сдвиг в локальных координатах детали. */
const local = (m: THREE.Matrix4, x: number, y: number, z: number) => m.clone().multiply(new THREE.Matrix4().makeTranslation(x, y, z));

function addAntiAir(g: GeoBuilder, id: string, cx: number, cz: number) {
  // ПВО: бетонная площадка с разметкой, мешки с песком с трёх сторон, поворотная башня и оружие по типу
  g.box(cx, 0, cz, 0.9, 0.05, 0.9, PALETTE.concrete[1], 0, PALETTE.concrete[0]);
  for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
    g.box(cx + sx * 0.36, 0.05, cz + sz * 0.36, 0.1, 0.006, 0.03, PALETTE.hazard);
    g.box(cx + sx * 0.36, 0.05, cz + sz * 0.36, 0.03, 0.006, 0.1, PALETTE.hazard);
  }
  g.model(PROPS.SackTrench_Small, cx, 0.05, cz + 0.37, 0.2);
  g.model(PROPS.SackTrench_Small, cx - 0.37, 0.05, cz, 0.2, Math.PI / 2);
  g.model(PROPS.SackTrench_Small, cx + 0.37, 0.05, cz, 0.2, Math.PI / 2);
  // Башня: опорное кольцо, поворотный стол, щёки
  g.cylinder(pose(cx, 0.05, cz), 0.17, 0.08, PALETTE.military, 12);
  g.cylinder(pose(cx, 0.13, cz), 0.2, 0.03, PALETTE.metal[1], 12);
  for (const dx of [-0.13, 0.13]) g.box(cx + dx, 0.16, cz, 0.04, 0.14, 0.16, PALETTE.military);
  // Мачта с датчиком в дальнем углу - не загораживает башню
  g.box(cx + 0.32, 0.05, cz - 0.32, 0.025, 0.36, 0.025, PALETTE.metal[0]);
  g.cylinder(pose(cx + 0.32, 0.41, cz - 0.32, 0.6, 0.9), 0.07, 0.015, PALETTE.dish, 10);
  g.light('beacon', cx + 0.32, 0.42, cz - 0.32, 0, cx * 8.3 + cz, LIGHT_BEACON, 0.05, 0.05, 1);
  const L = pose(cx, 0.26, cz, 0, id === 'aa_avalanche' ? 0.75 : 0.85);
  switch (id) {
    case 'aa_avalanche': { // пакет ракет "Лавина": два контейнера по четыре трубы, красные носы
      for (const dx of [-0.075, 0.075]) {
        g.boxM(local(L, dx, -0.12, 0), 0.13, 0.4, 0.17, PALETTE.military);
        for (const tx of [-0.03, 0.03]) for (const tz of [-0.04, 0.04]) g.cylinder(local(L, dx + tx, 0.28, tz), 0.024, 0.04, PALETTE.danger, 6);
      }
      break;
    }
    case 'aa_phoenix': { // спаренная пушка: казённик, два длинных ствола с дульными тормозами
      g.boxM(local(L, 0, -0.1, 0), 0.2, 0.22, 0.18, PALETTE.military);
      for (const dx of [-0.05, 0.05]) {
        g.cylinder(local(L, dx, 0.12, 0), 0.02, 0.42, PALETTE.metal[1], 6);
        g.cylinder(local(L, dx, 0.5, 0), 0.032, 0.06, PALETTE.soot, 6);
      }
      g.box(cx - 0.28, 0.05, cz - 0.28, 0.14, 0.1, 0.1, PALETTE.military, 0.3, PALETTE.hazard); // ящик со снарядами
      break;
    }
    case 'aa_laser': { // лазер: корпус, светящиеся кольца фокусировки, линза
      g.cylinder(local(L, 0, -0.1, 0), 0.08, 0.3, PALETTE.metal[1], 10);
      for (const y of [0.04, 0.12]) g.cylinder(local(L, 0, y, 0), 0.1, 0.025, PALETTE.laser, 10);
      g.cylinder(local(L, 0, 0.2, 0), 0.05, 0.16, PALETTE.metal[0], 10);
      g.cylinder(local(L, 0, 0.36, 0), 0.04, 0.03, PALETTE.laser, 10);
      g.box(cx - 0.26, 0.05, cz - 0.24, 0.14, 0.16, 0.12, PALETTE.metal[2], 0, PALETTE.laser); // накопитель
      break;
    }
    case 'aa_plasma': { // плазма: массивный казённик, ствол в катушках, баки с плазмой
      g.boxM(local(L, 0, -0.14, 0), 0.22, 0.3, 0.22, PALETTE.military);
      g.cylinder(local(L, 0, 0.14, 0), 0.055, 0.32, PALETTE.metal[1], 10);
      for (const y of [0.18, 0.26, 0.34]) g.cylinder(local(L, 0, y, 0), 0.085, 0.025, PALETTE.plasma, 10);
      g.cylinder(local(L, 0, 0.46, 0), 0.07, 0.04, PALETTE.plasma, 10);
      for (const dx of [-0.27, -0.13]) {
        g.cylinder(pose(cx + dx, 0.05, cz - 0.28), 0.055, 0.18, PALETTE.tank, 10, PALETTE.plasma);
      }
      break;
    }
    default: { // фьюжн: высокий пилон, ускоритель с сияющим ядром и кольцом
      g.cylinder(pose(cx, 0.13, cz), 0.1, 0.12, PALETTE.military, 12);
      const F = pose(cx, 0.32, cz, 0, 0.8);
      g.boxM(local(F, 0, -0.16, 0), 0.28, 0.46, 0.24, PALETTE.metal[1]);
      for (const dx of [-0.145, 0.145]) g.boxM(local(F, dx, -0.1, 0), 0.012, 0.36, 0.08, PALETTE.fusion);
      g.cylinder(local(F, 0, 0.3, 0), 0.14, 0.05, PALETTE.fusion, 12);
      g.cylinder(local(F, 0, 0.35, 0), 0.07, 0.07, PALETTE.frame, 12, PALETTE.fusion, 0.04);
    }
  }
}
