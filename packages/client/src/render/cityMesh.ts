// Процедурная геометрия участка карты по состоянию мира. Тайл = 1 единица, центр тайла (x+0.5, z+0.5).

import { BUILDING_BY_ID } from '@avi/data';
import { tileAt, type Tile, type World } from '@avi/sim';
import { GeoBuilder } from './builder';
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
    case 'zone': return addZoneBuilding(g, t, facing(w, x, y), cx, cz);
    case 'building': if (t.root === y * w.size + x) addBuilding(g, t, cx, cz); return;
    case 'crash': case 'none': return;
  }
}

function addRoad(g: GeoBuilder, w: World, x: number, y: number, cx: number, cz: number) {
  g.box(cx, 0, cz, 1, 0.03, 1, PALETTE.asphalt);
  // Разметка - полосы от центра к соседним дорогам, бордюр к остальным сторонам
  const dirs: [number, number][] = [[1, 0], [-1, 0], [0, 1], [0, -1]];
  let links = 0;
  for (const [dx, dy] of dirs) {
    if (tileAt(w, x + dx, y + dy)?.object !== 'road') {
      g.box(cx + dx * 0.46, 0, cz + dy * 0.46, dx ? 0.08 : 1, 0.05, dy ? 0.08 : 1, PALETTE.curb);
      continue;
    }
    links++;
    g.box(cx + dx * 0.28, 0.03, cz + dy * 0.28, dx ? 0.22 : 0.05, 0.005, dy ? 0.22 : 0.05, PALETTE.marking);
  }
  if (links === 0) g.box(cx, 0.03, cz, 0.1, 0.005, 0.1, PALETTE.marking);
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

function addZoneBuilding(g: GeoBuilder, t: Tile, face: number, cx: number, cz: number) {
  const v = t.variant;
  const o = oriented(cx, cz, face);
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
  } else if (level === 2) {
    const color = pick(PALETTE.paint, v);
    const [x, z] = o.at(0, -0.05);
    g.box(x, 0, z, 0.7, FLOOR * 2, 0.6, color, o.rot);
    windowBands(g, x, z, 0.7, 0.6, 2);
    roofGable(g, x, FLOOR * 2, z, 0.8, 0.26, 0.7, roof, color, o.rot);
    const [px, pz] = o.at(0, 0.3);
    g.box(px, FLOOR, pz, 0.5, 0.03, 0.12, PALETTE.trunk, o.rot); // балкон
  } else {
    const color = pick(PALETTE.concrete, v);
    const [x, z] = o.at(0, -0.02);
    g.box(x, 0, z, 0.82, FLOOR * 4, 0.72, color, o.rot);
    windowBands(g, x, z, 0.82, 0.72, 4);
    // Заплатки из цветных панелей и солнечные батареи - отстроенный дом
    const [qx, qz] = o.at(0.2, 0.37);
    g.box(qx, FLOOR * 1.1, qz, 0.25, FLOOR * 1.4, 0.02, pick(PALETTE.paint, v + 1), o.rot);
    const [sx, sz] = o.at(-0.15, -0.1);
    g.box(sx, FLOOR * 4, sz, 0.4, 0.04, 0.3, PALETTE.solar, o.rot);
  }
}

function commercial(g: GeoBuilder, level: number, v: number, o: Orient) {
  const sign = pick(PALETTE.signs, v);
  if (level === 1) {
    const [x, z] = o.at(0, -0.1);
    g.box(x, 0, z, 0.5, 0.3, 0.4, pick(PALETTE.planks, v), o.rot);
    const [ax, az] = o.at(0, 0.15);
    g.box(ax, 0.26, az, 0.56, 0.04, 0.2, sign, o.rot); // навес
    const [cx, cz] = o.at(0.3, 0.3);
    g.box(cx, 0, cz, 0.12, 0.12, 0.12, PALETTE.crate);
    g.box(cx, 0.12, cz, 0.09, 0.09, 0.09, PALETTE.crate, 0.4);
  } else if (level === 2) {
    const color = pick(PALETTE.paint, v);
    const [x, z] = o.at(0, -0.05);
    g.box(x, 0, z, 0.72, FLOOR * 2, 0.6, color, o.rot);
    windowBands(g, x, z, 0.72, 0.6, 2);
    const [sx, sz] = o.at(0, 0.31);
    g.box(sx, FLOOR * 1.25, sz, 0.5, 0.14, 0.03, sign, o.rot); // вывеска
    const [ax, az] = o.at(0, 0.38);
    g.box(ax, FLOOR * 0.8, az, 0.68, 0.03, 0.16, sign, o.rot);
  } else {
    const color = pick(PALETTE.concrete, v);
    const [x, z] = o.at(0, -0.02);
    g.box(x, 0, z, 0.88, FLOOR * 2.4, 0.78, color, o.rot);
    windowBands(g, x, z, 0.88, 0.78, 2);
    const [sx, sz] = o.at(0, 0.1);
    g.box(sx, FLOOR * 2.4, sz, 0.6, 0.2, 0.05, sign, o.rot); // большая вывеска на крыше
    const [ax, az] = o.at(0, 0.42);
    g.box(ax, FLOOR * 0.9, az, 0.86, 0.03, 0.12, sign, o.rot);
  }
}

function industrial(g: GeoBuilder, level: number, v: number, o: Orient) {
  const metal = pick(PALETTE.metal, v);
  if (level === 1) {
    const [x, z] = o.at(0, -0.05);
    g.box(x, 0, z, 0.66, 0.36, 0.56, metal, o.rot);
    const [cx, cz] = o.at(0.22, -0.18);
    g.box(cx, 0.36, cz, 0.08, 0.3, 0.08, PALETTE.chimney);
    const [bx, bz] = o.at(-0.3, 0.35);
    g.box(bx, 0, bz, 0.12, 0.16, 0.12, pick(PALETTE.roofRust, v));
  } else if (level === 2) {
    const [x, z] = o.at(0, -0.05);
    g.box(x, 0, z, 0.8, 0.42, 0.7, metal, o.rot);
    roofGable(g, x, 0.42, z, 0.84, 0.16, 0.74, pick(PALETTE.roofRust, v), metal, o.rot);
    for (let i = 0; i < 3; i++) {
      const [px, pz] = o.at(-0.3 + i * 0.2, 0.4);
      g.box(px, 0, pz, 0.14, 0.12 + (i % 2) * 0.1, 0.1, PALETTE.crate, i * 0.3);
    }
  } else {
    const [x, z] = o.at(0.05, -0.05);
    g.box(x, 0, z, 0.86, 0.55, 0.76, metal, o.rot);
    for (const u of [-0.25, -0.05]) {
      const [cx, cz] = o.at(u, -0.25);
      g.box(cx, 0.55, cz, 0.1, 0.55, 0.1, PALETTE.chimney);
      g.box(cx, 1.05, cz, 0.12, 0.05, 0.12, PALETTE.danger);
    }
    const [tx, tz] = o.at(0.3, 0.3);
    g.box(tx, 0, tz, 0.22, 0.4, 0.22, PALETTE.tank);
  }
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
