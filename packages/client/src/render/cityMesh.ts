// Процедурная геометрия участка карты по состоянию мира. Тайл = 1 единица, центр тайла (x+0.5, z+0.5).

import { BUILDING_BY_ID } from '@avi/data';
import { lotCenter, tileAt, usesLots, ZONE_BUILD_DAYS, type Tile, type World } from '@avi/sim';
import { GeoBuilder } from './builder';
import { MODELS, type ModelName } from './models';
import { PALETTE, pick } from './palette';

const FLOOR = 0.32;
const WATER_TOP = -0.14;

export function buildChunkGeometry(w: World, x0: number, y0: number, n: number) {
  const g = new GeoBuilder();
  for (let y = y0; y < Math.min(y0 + n, w.size); y++) {
    for (let x = x0; x < Math.min(x0 + n, w.size); x++) {
      const t = tileAt(w, x, y)!;
      const cx = x + 0.5, cz = y + 0.5;
      const top = t.terrain === 'water' ? WATER_TOP : 0;
      g.box(cx, -0.6, cz, 1, 0.6 + top, 1, PALETTE.dirtSide, 0, groundColor(t));
      addTerrainDetail(g, t, cx, cz);
      addObject(g, w, t, x, y, cx, cz);
    }
  }
  return g.build();
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

function addObject(g: GeoBuilder, w: World, t: Tile, x: number, y: number, cx: number, cz: number) {
  const v = t.variant;
  switch (t.object) {
    case 'road': return addRoad(g, w, x, y, cx, cz);
    case 'ruin': return addRuin(g, v, cx, cz);
    case 'tree': return addTree(g, v, cx, cz);
    case 'rubble': return addRubble(g, v, cx, cz);
    case 'zone': return addZoneBuilding(g, w, t, x, y, cx, cz);
    case 'building': if (t.root === y * w.size + x) addBuilding(g, t, cx, cz); return;
    case 'crash': case 'none': return;
  }
}

// Тайлы KayKit 2x2 единицы, клетка у нас 1x1
const KAY = 0.5;

// Открытые стороны дорожных тайлов KayKit без поворота: бит 1 - +x, 2 - +z, 4 - -x, 8 - -z.
// Поворот на четверть оборота (как в GeoBuilder.box) сдвигает маску на бит влево.
const ROAD_PIECES: [ModelName, number][] = [['road_junction', 15], ['road_tsplit', 11], ['road_corner', 3], ['road_straight', 10]];
const rotMask = (m: number, k: number) => ((m << k) | (m >> (4 - k))) & 15;

function addRoad(g: GeoBuilder, w: World, x: number, y: number, cx: number, cz: number) {
  const dirs: [number, number][] = [[1, 0], [0, 1], [-1, 0], [0, -1]];
  let mask = 0;
  dirs.forEach(([dx, dy], i) => { if (tileAt(w, x + dx, y + dy)?.object === 'road') mask |= 1 << i; });
  // Тупик и одиночная клетка - прямой участок вдоль единственной связи
  if (mask === 0) mask = 10;
  else if ((mask & (mask - 1)) === 0) mask = mask & 5 ? 5 : 10;
  for (const [name, base] of ROAD_PIECES) {
    for (let k = 0; k < 4; k++) {
      if (rotMask(base, k) !== mask) continue;
      g.model(MODELS[name], cx, 0, cz, KAY, (k * Math.PI) / 2);
      // Фонарь на тротуаре прямого участка, плечо - над дорогой
      if (name === 'road_straight' && (x * 7 + y * 13) % 5 === 0) {
        const side = k; // закрытая сторона: у прямой без поворота это +x, дальше поворачивается вместе с ней
        const [dx, dy] = dirs[side];
        g.model(MODELS.streetlight, cx + dx * 0.46, 0.05, cz + dy * 0.46, KAY, (side * Math.PI) / 2);
      }
      return;
    }
  }
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
    case 'A': return farm(g, t.level, v, o, cx, cz);
  }
}

type Orient = ReturnType<typeof oriented>;

const CARS: ModelName[] = ['car_hatchback', 'car_sedan', 'car_stationwagon', 'car_taxi'];
/** Индекс DIRS (+x, -x, +y, -y) -> фасад для oriented (0 - к +z, 1 - к +x, 2 - к -z, 3 - к -x). */
const FACE_OF_DIR = [1, 3, 0, 2];

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
      kayBuilding(g, KAY_HOUSES.R2, v, cell(0, front).o);
      const b = cell(0, back);
      if (v % 3 === 0) addPlayground(g, v, b.x, b.z);
      else addGarden(g, v, b.x, b.z);
      fence(g, b.o, 0.46, true);
      return;
    }
    // Многоэтажка на два участка вдоль улицы, за ней парковка жильцов
    bigBuilding(g, KAY_HOUSES.R3, v, o, 0, front - 0.1, 1.25, [cell(-side, front), cell(side, front)]);
    for (const u of [-side, side]) { const p = cell(u, back); addParking(g, v + u * 4, p.x, p.z); }
    return;
  }
  if (t.zone === 'C') {
    if (t.level === 1) {
      commercial(g, 1, v, o);
      const [px, pz] = o.at(-0.3, 0.42);
      g.model(MODELS[CARS[v % CARS.length]], px, 0.02, pz, KAY * 0.55, o.rot);
      return;
    }
    if (t.level === 2) {
      // Магазин на одной клетке, рядом парковка у улицы
      commercial(g, 2, v, cell(flip * side, 0).o);
      const p = cell(-flip * side, 0);
      addParking(g, v, p.x, p.z);
      return;
    }
    // Торговый центр во всю ширину в глубине, перед ним парковка вдоль улицы
    for (const u of [-side, side]) { const b = cell(u, back); g.model(MODELS.base, b.x, 0, b.z, KAY); }
    mall(g, v, cell(0, back).o, s.w - 0.12);
    for (const u of [-side, side]) { const p = cell(u, front); addParking(g, v + u * 4, p.x, p.z); }
  }
}

/** Коттедж 1x1: дом в глубине участка, подъездная дорожка с машиной сбоку, забор, кусты. */
function addCottage(g: GeoBuilder, v: number, o: Orient) {
  const walls = pick(PALETTE.planks, v);
  const roof = pick(PALETTE.roofRust, v >> 2);
  const sideU = v & 2 ? 0.3 : -0.3;
  const [hx, hz] = o.at(-sideU * 0.45, -0.12);
  g.box(hx, 0, hz, 0.5, 0.32, 0.42, walls, o.rot);
  roofGable(g, hx, 0.32, hz, 0.58, 0.22, 0.52, roof, walls, o.rot);
  const [dx, dz] = o.at(-sideU * 0.45, 0.1);
  g.box(dx, 0, dz, 0.12, 0.2, 0.02, PALETTE.door, o.rot);
  // Окна: два на фасаде у двери, по одному на боках, два сзади
  const hu = -sideU * 0.45;
  for (const [u, f, nu, nf] of [[hu - 0.16, 0.09, 0, 1], [hu + 0.16, 0.09, 0, 1], [hu - 0.25, -0.12, -1, 0], [hu + 0.25, -0.12, 1, 0], [hu - 0.12, -0.33, 0, -1], [hu + 0.12, -0.33, 0, -1]]) {
    const [wx, wz] = o.at(u, f);
    cottageWindow(g, wx, wz, o, nu, nf);
  }
  // Дорожка от улицы к дому и машина на ней
  const [rx, rz] = o.at(sideU, 0.1);
  g.box(rx, 0, rz, 0.2, 0.012, 0.78, PALETTE.concrete[1], o.rot);
  if (v % 4 !== 3) {
    const [mx, mz] = o.at(sideU, 0.18);
    g.model(MODELS[CARS[(v >> 3) % CARS.length]], mx, 0.012, mz, KAY * 0.5, o.rot);
  }
  const [bx, bz] = o.at(-sideU * 0.45 + 0.22, 0.32);
  g.model(MODELS.bush, bx, 0, bz, KAY);
  fence(g, o, 0.47, false);
}

/** Окно коттеджа: рама и стекло на стене с локальной нормалью (nu, nf). */
function cottageWindow(g: GeoBuilder, x: number, z: number, o: Orient, nu: number, nf: number) {
  const [ox, oz] = o.at(0, 0);
  const [px, pz] = o.at(nu * 0.012, nf * 0.012);
  const dx = px - ox, dz = pz - oz;
  const side = nu !== 0;
  g.box(x + dx, 0.12, z + dz, side ? 0.014 : 0.1, 0.11, side ? 0.1 : 0.014, PALETTE.frame, o.rot);
  g.box(x + dx * 1.6, 0.135, z + dz * 1.6, side ? 0.014 : 0.072, 0.08, side ? 0.072 : 0.014, PALETTE.glassDark, o.rot);
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
  g.model(MODELS[pick(list, v)], x, 0, z, KAY * scale, o.rot);
}

function addParking(g: GeoBuilder, v: number, cx: number, cz: number) {
  g.box(cx, 0, cz, 0.92, 0.02, 0.92, PALETTE.asphalt);
  // Два ряда мест по три, разметка поперёк, проезд посередине
  for (const row of [-1, 1]) {
    for (let i = 0; i <= 3; i++) g.box(cx - 0.36 + i * 0.24, 0.02, cz + row * 0.3, 0.015, 0.004, 0.28, PALETTE.marking);
    for (let i = 0; i < 3; i++) {
      if (rnd(v, row * 7 + i) < 0.45) continue;
      const car = CARS[Math.floor(rnd(v, row * 11 + i) * CARS.length)];
      g.model(MODELS[car], cx - 0.24 + i * 0.24, 0.02, cz + row * 0.3, KAY * 0.55, Math.PI / 2 + (row < 0 ? Math.PI : 0));
    }
  }
  g.model(MODELS.streetlight, cx + 0.44, 0.02, cz, KAY * 0.8, Math.PI / 2);
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

function residential(g: GeoBuilder, level: number, v: number, o: Orient) {
  const walls = pick(PALETTE.planks, v);
  const roof = pick(PALETTE.roofRust, v >> 2);
  if (level === 1) {
    const [x, z] = o.at(0, -0.05);
    g.box(x, 0, z, 0.62, 0.34, 0.5, walls, o.rot);
    roofGable(g, x, 0.34, z, 0.72, 0.24, 0.62, roof, walls, o.rot);
    const [dx, dz] = o.at(-0.12, 0.21);
    g.box(dx, 0, dz, 0.12, 0.22, 0.02, PALETTE.door, o.rot);
    const [bx, bz] = o.at(0.33, -0.3);
    if (v % 2 === 0) g.box(bx, 0, bz, 0.1, 0.16, 0.1, pick(PALETTE.roofRust, v));
  } else {
    kayBuilding(g, KAY_HOUSES[level === 2 ? 'R2' : 'R3'], v, o);
  }
}

// Дома жилья KayKit по уровням. Торговля и промзона - свои здания в том же стиле и палитре.
const KAY_HOUSES: Record<string, ModelName[]> = {
  R2: ['building_A_withoutBase', 'building_B_withoutBase'],
  R3: ['building_C_withoutBase', 'building_D_withoutBase'],
};

/** Дом KayKit на участке с тротуаром; фасад модели смотрит в +z, поворот - к дороге. */
function kayBuilding(g: GeoBuilder, list: ModelName[], v: number, o: Orient) {
  const [x, z] = o.at(0, 0);
  const name = pick(list, v);
  g.model(MODELS.base, x, 0, z, KAY);
  g.model(MODELS[name], x, 0, z, KAY, o.rot);
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

// --- Торговля и промзона: свои здания в стиле домов KayKit -------------------------------

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

/** Окно: стекло и рама в плоскости фасада. */
function pane(g: GeoBuilder, o: Orient, u: number, f: number, y0: number, w: number, h: number) {
  part(g, o, u, f, y0, w, h, 0.02, PALETTE.glassDark);
  part(g, o, u - w / 2 - 0.01, f + 0.01, y0 - 0.01, 0.02, h + 0.02, 0.03, PALETTE.frame);
  part(g, o, u + w / 2 + 0.01, f + 0.01, y0 - 0.01, 0.02, h + 0.02, 0.03, PALETTE.frame);
  part(g, o, u, f + 0.01, y0 - 0.01, w + 0.04, 0.02, 0.03, PALETTE.frame);
  part(g, o, u, f + 0.01, y0 + h - 0.01, w + 0.04, 0.02, 0.03, PALETTE.frame);
}

/** Витрина: стеклянная лента с рамами по фасаду. */
function vitrine(g: GeoBuilder, o: Orient, u0: number, u1: number, f: number, y0: number, h: number) {
  const w = u1 - u0, u = (u0 + u1) / 2;
  part(g, o, u, f, y0, w, h, 0.02, PALETTE.shopGlass);
  const n = Math.max(2, Math.round(w / 0.18));
  for (let i = 0; i <= n; i++) part(g, o, u0 + (w * i) / n, f + 0.008, y0, 0.025, h, 0.03, PALETTE.frame);
  part(g, o, u, f + 0.008, y0, w, 0.02, 0.03, PALETTE.frame);
  part(g, o, u, f + 0.008, y0 + h - 0.02, w, 0.02, 0.03, PALETTE.frame);
}

/** Навес в полоску над входом. */
function awning(g: GeoBuilder, o: Orient, u0: number, u1: number, f: number, y0: number, depth: number, a: number, b: number) {
  const n = Math.max(2, Math.round((u1 - u0) / 0.08));
  for (let i = 0; i < n; i++) {
    const u = u0 + ((u1 - u0) * (i + 0.5)) / n;
    part(g, o, u, f + depth / 2, y0, (u1 - u0) / n, 0.035, depth, i % 2 ? a : b);
  }
}

/** Вывеска: рамка и цветное поле над входом. */
function signboard(g: GeoBuilder, o: Orient, u: number, f: number, y0: number, w: number, h: number, color: number) {
  part(g, o, u, f, y0, w, h, 0.05, PALETTE.frame);
  part(g, o, u, f + 0.03, y0 + 0.015, w - 0.05, h - 0.03, 0.02, color);
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

/** Торговля: ларёк (1), магазин (2), торговый центр (3). */
function commercial(g: GeoBuilder, level: number, v: number, o: Orient) {
  if (level === 1) kiosk(g, v, o);
  else if (level === 2) shop(g, v, o);
  else { plot(g, o); mall(g, v, o); }
}

/** Ларёк (уровень 1): прилавок с витриной, навес в полоску, вывеска, товар на улице. */
function kiosk(g: GeoBuilder, v: number, o: Orient) {
  plot(g, o);
  const wall = pick(PALETTE.planks, v), sign = pick(PALETTE.signs, v);
  part(g, o, 0, 0, 0.02, 0.5, 0.3, 0.4, wall);
  part(g, o, 0, 0, 0.32, 0.56, 0.05, 0.46, pick(PALETTE.roofRust, v >> 1));
  vitrine(g, o, -0.22, 0.08, 0.205, 0.05, 0.16);
  part(g, o, 0.16, 0.205, 0.03, 0.1, 0.2, 0.02, PALETTE.door);
  awning(g, o, -0.26, 0.24, 0.24, 0.25, 0.2, sign, PALETTE.frame);
  signboard(g, o, 0, 0.23, 0.37, 0.36, 0.1, sign);
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
  vitrine(g, o, -0.31, 0.06, 0.256, 0.05, 0.14);
  part(g, o, 0.22, 0.256, 0.03, 0.14, 0.17, 0.02, PALETTE.door);
  signboard(g, o, 0, 0.256, 0.2, 0.52, 0.09, sign);
  awning(g, o, -0.33, 0.33, 0.26, 0.17, 0.22, sign, PALETTE.frame);
  for (const u of [-0.2, 0, 0.2]) pane(g, o, u, 0.256, 0.28, 0.12, 0.1);
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
  vitrine(g, o, -hw + 0.05, hw - 0.05, 0.245, 0.05, 0.2);
  part(g, o, 0, 0.245, 0.04, 0.28, 0.19, 0.02, PALETTE.door);
  signboard(g, o, 0, 0.245, 0.26, wide - 0.12, 0.1, sign);
  part(g, o, 0, 0.42, 0.31, 0.6, 0.03, 0.32, sign);
  for (const u of [-0.24, 0.24]) part(g, o, u, 0.54, 0.02, 0.04, 0.29, 0.04, PALETTE.metal[0]);
  roofUnits(g, o, [-hw + 0.16, 0, hw - 0.16], -0.16, 0.41);
  part(g, o, -hw + 0.03, 0.42, 0.02, 0.05, 0.32, 0.05, PALETTE.metal[0]);
  part(g, o, -hw + 0.03, 0.42, 0.34, 0.26, 0.16, 0.04, sign);
  decor(g, o, 'bush', hw - 0.06, 0.42);
  decor(g, o, 'bush', hw - 0.06, 0.26);
  if (v % 2) decor(g, o, 'trash_B', hw - 0.14, -0.42);
}

/** Промзона: мастерская (1), цех (2), завод (3). */
function industrial(g: GeoBuilder, level: number, v: number, o: Orient) {
  plot(g, o);
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
  pane(g, o, -0.24, 0.268, 0.19, 0.16, 0.11);
  stack(g, o, 0.34, -0.22, 0.36, 0.22, 0.045);
  part(g, o, -0.4, 0.32, 0.02, 0.14, 0.16, 0.14, PALETTE.crate);
  part(g, o, -0.4, 0.32, 0.18, 0.11, 0.1, 0.11, PALETTE.crate);
  part(g, o, 0.36, 0.36, 0.02, 0.1, 0.15, 0.1, PALETTE.danger, PALETTE.metal[0]); // бочка
  part(g, o, 0.36, 0.2, 0.02, 0.1, 0.15, 0.1, PALETTE.metal[2], PALETTE.metal[0]);
  if (v % 2) decor(g, o, 'dumpster', -0.36, -0.4);
  else decor(g, o, 'box_A', 0.38, -0.36);
}

/** Цех (уровень 2): корпус с фонарями на крыше, окна-ленты, труба, погрузочная площадка. */
function hall(g: GeoBuilder, v: number, o: Orient) {
  const wall = pick(PALETTE.metal, v), roof = PALETTE.roofRust[v >> 1];
  part(g, o, 0, -0.02, 0.02, 0.86, 0.42, 0.62, wall);
  part(g, o, 0, -0.02, 0.02, 0.88, 0.12, 0.64, PALETTE.chimney); // цоколь
  part(g, o, 0, -0.02, 0.39, 0.88, 0.03, 0.64, pick(PALETTE.metal, v + 1)); // поясок
  part(g, o, 0, -0.02, 0.44, 0.9, 0.04, 0.66, roof);
  for (let i = 0; i < 3; i++) { // фонари на крыше с остеклением
    const u = -0.28 + i * 0.28;
    part(g, o, u, -0.1, 0.48, 0.2, 0.12, 0.3, PALETTE.metal[2]);
    part(g, o, u, 0.03, 0.5, 0.2, 0.06, 0.02, PALETTE.shopGlass);
  }
  for (let i = 0; i < 3; i++) pane(g, o, -0.26 + i * 0.26, 0.295, 0.19, 0.16, 0.14);
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
  const wall = pick(PALETTE.metal, v), roof = PALETTE.roofRust[v >> 1];
  part(g, o, -0.06, -0.13, 0.02, 0.8, 0.5, 0.62, wall);
  part(g, o, -0.06, -0.13, 0.02, 0.84, 0.14, 0.66, PALETTE.chimney); // цоколь
  part(g, o, -0.06, -0.13, 0.47, 0.84, 0.03, 0.66, pick(PALETTE.metal, v + 1)); // поясок
  part(g, o, -0.06, -0.13, 0.52, 0.86, 0.05, 0.68, roof);
  pane(g, o, -0.22, 0.185, 0.24, 0.18, 0.16);
  part(g, o, 0.06, 0.185, 0.02, 0.3, 0.4, 0.02, PALETTE.metal[1]); // ворота
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

function farm(g: GeoBuilder, level: number, v: number, o: Orient, cx: number, cz: number) {
  const rows = 2 + level;
  const crop = pick(PALETTE.crops, v);
  for (let i = 0; i < rows; i++) {
    const [rx, rz] = o.at(-0.38 + (i * 0.76) / Math.max(1, rows - 1), level >= 2 ? -0.12 : 0);
    g.box(rx, 0, rz, 0.08, 0.06 + level * 0.02, level >= 2 ? 0.6 : 0.82, crop, o.rot);
  }
  if (level >= 2) {
    const [hx, hz] = o.at(0.12, 0.33);
    g.box(hx, 0, hz, 0.5, 0.18, 0.22, PALETTE.greenhouse, o.rot); // теплица
  }
  if (level >= 3) {
    g.box(cx + 0.35, 0, cz - 0.35, 0.16, 0.5, 0.16, PALETTE.tank); // силос
    g.box(cx + 0.35, 0.5, cz - 0.35, 0.18, 0.05, 0.18, pick(PALETTE.roofRust, v));
  }
}

// Двускатная крыша с учётом поворота: конёк вдоль фасада
function roofGable(g: GeoBuilder, x: number, y0: number, z: number, along: number, h: number, depth: number, color: number, gableColor: number, rot: number) {
  const across = Math.abs(Math.sin(rot)) > 0.5;
  g.gable(x, y0, z, across ? depth : along, h, across ? along : depth, color, gableColor, across);
}

function addBuilding(g: GeoBuilder, t: Tile, cx: number, cz: number) {
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
    case 'lab': addLab(g, x, z); break;
    case 'workshop': addWorkshop(g, x, z); break;
    case 'radar': addRadar(g, x, z); break;
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

function addPlant(g: GeoBuilder, cx: number, cz: number) {
  // Генератор на мусоре: цех, две трубы, баки топлива, забор
  g.box(cx - 0.2, 0, cz + 0.1, 1.2, 0.6, 0.9, PALETTE.metal[1]);
  g.gable(cx - 0.2, 0.6, cz + 0.1, 1.24, 0.2, 0.94, PALETTE.roofRust[0], PALETTE.metal[1]);
  for (const dx of [0.45, 0.7]) {
    g.box(cx + dx, 0, cz - 0.55, 0.16, 1.4, 0.16, PALETTE.chimney);
    g.box(cx + dx, 1.25, cz - 0.55, 0.18, 0.08, 0.18, PALETTE.danger);
  }
  g.box(cx - 0.65, 0, cz - 0.6, 0.3, 0.32, 0.3, PALETTE.tank);
  g.box(cx - 0.25, 0, cz - 0.6, 0.3, 0.32, 0.3, PALETTE.tank);
  g.box(cx, 0, cz + 0.95, 1.9, 0.12, 0.03, PALETTE.trunk);
}

function addPump(g: GeoBuilder, v: number, cx: number, cz: number) {
  // Насосная: будка и водонапорная башня на ногах
  g.box(cx - 0.2, 0, cz + 0.15, 0.4, 0.28, 0.4, pick(PALETTE.concrete, v));
  for (const [dx, dz] of [[-0.12, -0.12], [0.12, -0.12], [-0.12, 0.12], [0.12, 0.12]]) {
    g.box(cx + 0.15 + dx, 0, cz - 0.15 + dz, 0.04, 0.7, 0.04, PALETTE.metal[0]);
  }
  g.box(cx + 0.15, 0.7, cz - 0.15, 0.42, 0.32, 0.42, PALETTE.waterTank);
  g.box(cx + 0.15, 1.02, cz - 0.15, 0.3, 0.08, 0.3, PALETTE.metal[0]);
}

function addMine(g: GeoBuilder, cx: number, cz: number) {
  // Шахта: копёр (башня с колесом), тёмный ствол, отвалы руды, вагонетка
  g.box(cx - 0.35, 0, cz - 0.3, 0.7, 0.04, 0.7, PALETTE.pit);
  for (const [dx, dz] of [[-0.6, -0.55], [-0.1, -0.55], [-0.6, -0.05], [-0.1, -0.05]]) g.box(cx + dx + 0.0, 0, cz + dz, 0.05, 1.2, 0.05, PALETTE.metal[1]);
  g.box(cx - 0.35, 1.2, cz - 0.3, 0.6, 0.06, 0.6, PALETTE.metal[1]);
  g.box(cx - 0.35, 1.26, cz - 0.3, 0.06, 0.34, 0.34, PALETTE.danger);
  g.box(cx + 0.45, 0, cz + 0.35, 0.5, 0.22, 0.45, PALETTE.ore, 0.3);
  g.box(cx + 0.5, 0.22, cz + 0.35, 0.3, 0.12, 0.28, PALETTE.ore, 0.6);
  g.box(cx - 0.4, 0, cz + 0.55, 0.7, 0.3, 0.4, PALETTE.metal[2]);
  g.box(cx + 0.1, 0, cz - 0.2, 0.22, 0.12, 0.14, PALETTE.roofRust[1]);
}

function addLab(g: GeoBuilder, cx: number, cz: number) {
  // Лаборатория XCOM: светлый корпус, стеклянный фасад, антенна на крыше
  g.box(cx, 0, cz, 1.6, 0.75, 1.3, PALETTE.labWall);
  g.box(cx, 0.15, cz + 0.66, 1.3, 0.45, 0.02, PALETTE.glass);
  g.box(cx + 0.81, 0.15, cz, 0.02, 0.45, 1.0, PALETTE.glass);
  g.box(cx, 0.75, cz, 1.0, 0.25, 0.8, PALETTE.labWall);
  g.box(cx, 1.0, cz, 1.02, 0.04, 0.82, PALETTE.xcom);
  g.box(cx + 0.35, 1.0, cz - 0.2, 0.04, 0.5, 0.04, PALETTE.metal[0]);
  g.box(cx + 0.35, 1.5, cz - 0.2, 0.18, 0.04, 0.18, PALETTE.xcom);
}

function addWorkshop(g: GeoBuilder, cx: number, cz: number) {
  // Мастерская: ангар с полукруглой крышей (ступеньками), ворота, кран, ящики
  g.box(cx - 0.1, 0, cz, 1.4, 0.55, 1.2, PALETTE.metal[2]);
  g.box(cx - 0.1, 0.55, cz, 1.4, 0.12, 0.9, PALETTE.metal[0]);
  g.box(cx - 0.1, 0.67, cz, 1.4, 0.08, 0.5, PALETTE.metal[0]);
  g.box(cx - 0.1, 0, cz + 0.61, 0.6, 0.42, 0.02, PALETTE.xcom);
  g.box(cx + 0.75, 0, cz - 0.6, 0.06, 1.1, 0.06, PALETTE.danger);
  g.box(cx + 0.45, 1.05, cz - 0.6, 0.7, 0.06, 0.06, PALETTE.danger);
  g.box(cx + 0.8, 0, cz + 0.5, 0.18, 0.18, 0.18, PALETTE.crate);
  g.box(cx + 0.6, 0, cz + 0.7, 0.14, 0.14, 0.14, PALETTE.crate, 0.5);
}

function addRadar(g: GeoBuilder, cx: number, cz: number) {
  // Радар: будка и тарелка на мачте
  g.box(cx - 0.2, 0, cz + 0.2, 0.4, 0.3, 0.35, PALETTE.labWall);
  g.box(cx + 0.15, 0, cz - 0.1, 0.06, 0.8, 0.06, PALETTE.metal[0]);
  g.box(cx + 0.15, 0.8, cz - 0.1, 0.5, 0.05, 0.5, PALETTE.dish, 0.5);
  g.box(cx + 0.15, 0.85, cz - 0.1, 0.06, 0.2, 0.06, PALETTE.xcom);
}

function addAntiAir(g: GeoBuilder, id: string, cx: number, cz: number) {
  // ПВО: бетонная площадка с мешками, поворотная башня и ствол/пусковая по типу оружия
  g.box(cx, 0, cz, 0.85, 0.12, 0.85, PALETTE.concrete[0]);
  for (const [dx, dz, sx, sz] of [[0, 0.4, 0.8, 0.08], [0, -0.4, 0.8, 0.08], [0.4, 0, 0.08, 0.8], [-0.4, 0, 0.08, 0.8]]) {
    g.box(cx + dx, 0.12, cz + dz, sx, 0.08, sz, PALETTE.sandbag);
  }
  g.box(cx, 0.12, cz, 0.4, 0.22, 0.4, PALETTE.military);
  const tip = { aa_avalanche: PALETTE.danger, aa_phoenix: PALETTE.metal[0], aa_laser: PALETTE.laser, aa_plasma: PALETTE.plasma, aa_fusion: PALETTE.fusion }[id] ?? PALETTE.danger;
  if (id === 'aa_avalanche') {
    // Пакет ракет "Лавина"
    for (const dx of [-0.08, 0.08]) for (const dy of [0, 0.09]) g.box(cx + dx, 0.36 + dy, cz - 0.05, 0.07, 0.07, 0.4, PALETTE.military, 0, tip);
  } else if (id === 'aa_phoenix') {
    for (const dx of [-0.06, 0.06]) g.box(cx + dx, 0.4, cz - 0.15, 0.04, 0.04, 0.55, PALETTE.metal[1]);
  } else {
    // Излучатель: ствол и светящийся наконечник
    const len = id === 'aa_fusion' ? 0.7 : 0.55;
    g.box(cx, 0.38, cz - 0.1, 0.1, 0.1, len, PALETTE.metal[1]);
    g.box(cx, 0.37, cz - 0.1 - len / 2, 0.14, 0.12, 0.08, tip);
    g.box(cx, 0.34, cz + 0.12, 0.22, 0.16, 0.2, tip);
  }
}
