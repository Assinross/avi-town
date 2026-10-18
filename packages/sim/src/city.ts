// Симуляция города по дням: сети тока/воды по дорогам, рост зон по спросу, еда, металл,
// исследования, бюджет. Налёты НЛО идут по тикам - см. raid.ts.

import { BUILDING_BY_ID, TECH_BY_ID } from '@avi/data';
import { fitLot, setLot, shrinkLot, usesLots } from './lots';
import { raidDay, raidTick } from './raid';
import { nextInt } from './rng';
import { markChanged, tileAt, type Stats, type Tile, type World, type ZoneType } from './world';

export const TICK_HZ = 20;
export const TICKS_PER_DAY = 40; // x1: 2 секунды на игровой день
export const DAYS_PER_MONTH = 30;
export const SPEED_FACTOR = [0, 1, 2, 4] as const;

/** Жители (R) или рабочие места (C/I/A) на уровень застройки 0..3. */
export const CAPACITY: Record<ZoneType, readonly number[]> = {
  R: [0, 8, 20, 40],
  C: [0, 5, 12, 24],
  I: [0, 8, 18, 34],
  A: [0, 3, 6, 9],
};
const POWER_USE: Record<ZoneType, readonly number[]> = { R: [0, 2, 4, 7], C: [0, 3, 5, 8], I: [0, 5, 9, 14], A: [0, 1, 2, 3] };
const WATER_USE: Record<ZoneType, readonly number[]> = { R: [0, 2, 4, 7], C: [0, 2, 3, 5], I: [0, 3, 6, 9], A: [0, 3, 5, 7] };
const BUILDING_POWER_USE = 12;
const FOOD_PER_LEVEL: Record<string, number> = { soil: 8, wasteland: 4, rock: 2, contaminated: 0, water: 0 };
/** Промзона - "грязное производство": на камнях и заражённой земле работает как шахта. */
const METAL_PER_INDUSTRY_LEVEL: Record<string, number> = { rock: 2, contaminated: 1 };
export const FOOD_STORAGE = 600;
const ROADS_PER_UPKEEP = 20;
const ZONE_REACH = 2; // зоны растут не дальше 2 клеток от дороги
/** Сколько дней строится зона до уровня 1..3. */
export const ZONE_BUILD_DAYS = [0, 2, 3, 4] as const;

/** Уровень, который уже работает: пока идёт стройка, действует прежний. */
export const builtLevel = (t: Tile) => (t.build > 0 ? t.level - 1 : t.level);

/** Продвинуть мир на ticks тиков; возвращает число прошедших дней. */
export function step(w: World, ticks: number): number {
  let days = 0;
  if (w.mission) return 0; // пока идёт бой, город стоит
  for (let i = 0; i < ticks; i++) {
    w.tick++;
    if (w.raid) raidTick(w);
    if (w.tick % TICKS_PER_DAY === 0) {
      simulateDay(w);
      days++;
    }
  }
  return days;
}

interface Net { power: number; water: number }

const DIRS: [number, number][] = [[1, 0], [-1, 0], [0, 1], [0, -1]];

function isNearWater(w: World, idx: number): boolean {
  const x = idx % w.size, y = Math.floor(idx / w.size);
  return DIRS.some(([dx, dy]) => tileAt(w, x + dx, y + dy)?.terrain === 'water');
}

/** Компоненты связности дорог; здания подключаются к соседним дорогам. */
function buildNetworks(w: World): { netOf: Int32Array; nets: Net[] } {
  const n = w.size * w.size;
  const netOf = new Int32Array(n).fill(-1);
  const nets: Net[] = [];
  for (let i = 0; i < n; i++) {
    if (w.tiles[i].object !== 'road' || netOf[i] >= 0) continue;
    const id = nets.length;
    nets.push({ power: 0, water: 0 });
    const queue = [i];
    netOf[i] = id;
    while (queue.length) {
      const c = queue.pop()!;
      const x = c % w.size, y = Math.floor(c / w.size);
      for (const [dx, dy] of DIRS) {
        const nx = x + dx, ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= w.size || ny >= w.size) continue;
        const ni = ny * w.size + nx;
        if (netOf[ni] < 0 && w.tiles[ni].object === 'road') {
          netOf[ni] = id;
          queue.push(ni);
        }
      }
    }
  }
  // Мощность генераторов и насосов - в сеть первой соседней дороги здания
  for (const root of buildingRoots(w)) {
    const def = BUILDING_BY_ID[w.tiles[root].def!];
    if (!def || (!def.power && !def.water) || w.tiles[root].build > 0) continue;
    const net = nearestNet(w, netOf, root, 1);
    if (net < 0) continue;
    if (def.power) nets[net].power += def.power;
    if (def.water) nets[net].water += buildingCells(w, root).some((c) => isNearWater(w, c)) ? def.water.river : def.water.well;
  }
  return { netOf, nets };
}

/** Главные клетки всех зданий в порядке индексов (детерминированно). */
export function buildingRoots(w: World): number[] {
  const out: number[] = [];
  w.tiles.forEach((t, i) => { if (t.object === 'building' && t.root === i) out.push(i); });
  return out;
}

export function buildingCells(w: World, root: number): number[] {
  const def = BUILDING_BY_ID[w.tiles[root].def!];
  const s = def?.size ?? 1;
  const x0 = root % w.size, y0 = Math.floor(root / w.size);
  const out: number[] = [];
  for (let dy = 0; dy < s; dy++) for (let dx = 0; dx < s; dx++) out.push((y0 + dy) * w.size + x0 + dx);
  return out;
}

function nearestNet(w: World, netOf: Int32Array, idx: number, reach: number): number {
  const t = w.tiles[idx];
  const cells = t.object === 'building' ? buildingCells(w, t.root) : [idx];
  for (let r = 1; r <= reach; r++) {
    for (const c of cells) {
      const cx = c % w.size, cy = Math.floor(c / w.size);
      for (let dy = -r; dy <= r; dy++) {
        for (let dx = -r; dx <= r; dx++) {
          const nx = cx + dx, ny = cy + dy;
          if (nx < 0 || ny < 0 || nx >= w.size || ny >= w.size) continue;
          const net = netOf[ny * w.size + nx];
          if (net >= 0) return net;
        }
      }
    }
  }
  return -1;
}

function isPolluting(t: Tile): boolean {
  if (t.object === 'zone') return t.zone === 'I' && builtLevel(t) > 0;
  return t.object === 'building' && (t.def === 'plant' || t.def === 'mine');
}

function isPolluted(w: World, x: number, y: number): boolean {
  for (let dy = -3; dy <= 3; dy++) {
    for (let dx = -3; dx <= 3; dx++) {
      const t = tileAt(w, x + dx, y + dy);
      if (t && isPolluting(t)) return true;
    }
  }
  return false;
}

/** Клетка выходит фасадом на дорогу (соседняя по стороне). */
export function isFrontage(w: World, x: number, y: number): boolean {
  return DIRS.some(([dx, dy]) => tileAt(w, x + dx, y + dy)?.object === 'road');
}

/** Максимальный уровень, который клетка может держать при текущих условиях. */
export function maxLevel(w: World, t: Tile, x: number, y: number, connected: boolean): number {
  if (!connected || !t.zone) return 0;
  // Участок дома начинается от улицы; клетки в глубине квартала занимает растущий участок
  if (usesLots(t) && !isFrontage(w, x, y)) return 0;
  if (t.zone !== 'A' && !t.powered) return 0;
  let cap = 1;
  if (t.watered) cap = 2;
  if (t.watered && w.stats.happiness >= 55) cap = 3;
  if (t.terrain === 'contaminated' && (t.zone === 'R' || t.zone === 'C' || t.zone === 'A')) cap = Math.min(cap, 1);
  if (t.zone === 'R' && isPolluted(w, x, y)) cap = Math.min(cap, 2);
  return cap;
}

function clamp(v: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, Math.trunc(v)));
}

export function simulateDay(w: World) {
  w.day++;
  advanceConstruction(w);
  const { netOf, nets } = buildNetworks(w);
  const s: Stats = w.stats;
  let pop = 0, jobsC = 0, jobsI = 0, jobsA = 0, foodProd = 0, powerUsed = 0, waterUsed = 0, roads = 0;
  let upkeep = 0, research = 0, metal = 0, labTier = 0;
  const reach = new Int32Array(w.tiles.length).fill(-1);

  // 1. Здания: ток в первую очередь (оборона и XCOM важнее жилья), содержание, производство
  let workshops = 0;
  for (const root of buildingRoots(w)) {
    const t = w.tiles[root];
    const def = BUILDING_BY_ID[t.def!];
    if (!def) continue;
    // Стройплощадка не работает и не требует содержания
    if (t.build > 0) {
      if (t.powered) for (const c of buildingCells(w, root)) w.tiles[c].powered = false;
      continue;
    }
    upkeep += def.upkeep;
    let powered = true;
    if (def.needsPower) {
      const net = nearestNet(w, netOf, root, 1);
      powered = net >= 0 && nets[net].power >= BUILDING_POWER_USE;
      if (powered) {
        nets[net].power -= BUILDING_POWER_USE;
        powerUsed += BUILDING_POWER_USE;
      }
    }
    if (powered !== t.powered) {
      for (const c of buildingCells(w, root)) w.tiles[c].powered = powered;
      w.revision++;
    }
    if (!powered) continue;
    research += def.research ?? 0;
    if ((def.labTier ?? 0) > labTier) labTier = def.labTier!;
    metal += def.metalPerDay ?? 0;
    if (def.id === 'workshop') workshops++;
  }

  // 2. Зоны: ток и вода по сетям в порядке клеток (детерминированно)
  w.tiles.forEach((t, i) => {
    if (t.object === 'road') roads++;
    if (t.object !== 'zone' || !t.zone) return;
    const net = nearestNet(w, netOf, i, ZONE_REACH);
    reach[i] = net;
    const lvl = Math.max(t.level, 1);
    const prevP = t.powered, prevW = t.watered;
    if (net >= 0 && nets[net].power >= POWER_USE[t.zone][lvl]) {
      t.powered = true;
      if (t.level > 0) { nets[net].power -= POWER_USE[t.zone][lvl]; powerUsed += POWER_USE[t.zone][lvl]; }
    } else t.powered = false;
    if (net >= 0 && nets[net].water >= WATER_USE[t.zone][lvl]) {
      t.watered = true;
      if (t.level > 0) { nets[net].water -= WATER_USE[t.zone][lvl]; waterUsed += WATER_USE[t.zone][lvl]; }
    } else t.watered = false;
    if (prevP !== t.powered || prevW !== t.watered) w.revision++;
  });

  // 3. Рост и упадок зон
  const hungry = w.hungerDays > 5;
  w.tiles.forEach((t, i) => {
    if (t.object !== 'zone' || !t.zone) return;
    // Клетки участка повторяют главную - решение о росте принимает она
    if (!(usesLots(t) && t.root >= 0 && t.root !== i)) {
      const x = i % w.size, y = Math.floor(i / w.size);
      const cap = maxLevel(w, t, x, y, reach[i] >= 0);
      const demand = s.demand[t.zone];
      let next = t.level;
      if (t.level > cap || demand < -50 || (hungry && t.zone === 'R')) {
        if (t.level > 0 && nextInt(w.rng, 100) < (t.level > cap ? 6 : 3)) next = t.level - 1;
      } else if (t.build === 0 && t.level < cap && demand > 0 && nextInt(w.rng, 100) < Math.max(2, demand >> 2)) {
        next = t.level + 1;
      }
      if (next !== t.level) changeLevel(w, i, next);
    }
    const lvl = builtLevel(t);
    const c = CAPACITY[t.zone][lvl];
    if (t.zone === 'R') pop += c;
    else if (t.zone === 'C') jobsC += c;
    else if (t.zone === 'I') {
      jobsI += c;
      metal += lvl * (METAL_PER_INDUSTRY_LEVEL[t.terrain] ?? 0);
    } else {
      jobsA += c;
      foodProd += lvl * FOOD_PER_LEVEL[t.terrain];
    }
  });

  // 4. Еда
  const foodUse = Math.ceil(pop / 10);
  w.food += foodProd - foodUse;
  if (w.food < 0) {
    w.food = 0;
    w.hungerDays++;
  } else {
    w.hungerDays = Math.max(0, w.hungerDays - 1);
    w.food = Math.min(w.food, FOOD_STORAGE);
  }

  // 5. Металл, ремонт мастерскими, исследования
  w.resources.metal += metal;
  for (let i = 0; i < workshops; i++) repairOne(w);
  if (w.research.current) {
    w.research.progress += research;
    const tech = TECH_BY_ID[w.research.current];
    if (tech && w.research.progress >= tech.cost) {
      w.research.done.push(tech.id);
      w.events.push({ type: 'researchDone', tech: tech.id });
      w.research.current = null;
      w.research.progress = 0;
    }
  }

  // 6. Спрос: жильё тянется за рабочими местами, торговля и промышленность - за жителями, фермы - за едой
  const jobs = jobsC + jobsI + jobsA;
  s.demand = {
    R: clamp(25 + ((jobs * 5) / 3 - pop) * 50 / Math.max(40, pop), -100, 100),
    C: clamp(5 + (pop * 0.25 - jobsC) * 100 / Math.max(20, pop * 0.25), -100, 100),
    I: clamp(20 + (pop * 0.35 - jobsI) * 100 / Math.max(20, pop * 0.35), -100, 100),
    A: clamp(20 + (foodUse * 1.3 - foodProd) * 100 / Math.max(5, foodUse), -100, 100),
  };

  // 7. Деньги: налоги с жителей и рабочих мест минус содержание
  const income = Math.floor((pop * 25) / 100) + Math.floor((jobs * 15) / 100);
  upkeep += Math.floor(roads / ROADS_PER_UPKEEP);
  w.money += income - upkeep;

  // 8. Довольство: голод и отсутствие воды снижают
  const zoned = w.tiles.filter((t) => t.object === 'zone' && t.level > 0);
  const dry = zoned.filter((t) => !t.watered).length;
  const dark = zoned.filter((t) => !t.powered && t.zone !== 'A').length;
  const n = Math.max(1, zoned.length);
  s.happiness = clamp(70 - Math.min(40, w.hungerDays * 4) - (dry * 20) / n - (dark * 30) / n, 0, 100);

  s.population = pop;
  s.jobs = jobs;
  s.powerCap = nets.reduce((a, nt) => a + nt.power, 0) + powerUsed;
  s.powerUsed = powerUsed;
  s.waterCap = nets.reduce((a, nt) => a + nt.water, 0) + waterUsed;
  s.waterUsed = waterUsed;
  s.foodProd = foodProd;
  s.foodUse = foodUse;
  s.incomeDay = income;
  s.upkeepDay = upkeep;
  s.researchPerDay = research;
  s.labTier = labTier;
  s.metalPerDay = metal;

  raidDay(w);
  w.revision++;
}

/** Новый уровень клетки или участка. Рост - через стройку, упадок сворачивает идущую стройку. */
function changeLevel(w: World, i: number, next: number) {
  const t = w.tiles[i];
  if (usesLots(t)) {
    if (next < t.level) return shrinkLot(w, i);
    // Участку нужно место под дом побольше; некуда расшириться - дом не растёт
    const fit = fitLot(w, i, next);
    if (!fit) return;
    t.variant = (t.variant * 31 + next * 7) & 255;
    setLot(w, i, next, ZONE_BUILD_DAYS[next], fit.s, fit.cells);
    return;
  }
  t.build = next > t.level ? ZONE_BUILD_DAYS[next] : 0;
  t.level = next;
  if (next > 0) t.variant = (t.variant * 31 + next * 7) & 255;
  markChanged(w, i);
}

/** День стройки: у зданий срок на главной клетке, у зон - на каждой. */
function advanceConstruction(w: World) {
  w.tiles.forEach((t, i) => {
    if (t.build <= 0 || (t.object === 'building' && t.root !== i)) return;
    t.build--;
    if (t.object === 'building') {
      for (const c of buildingCells(w, i)) {
        w.tiles[c].build = t.build;
        markChanged(w, c);
      }
    } else markChanged(w, i);
  });
}

/** Мастерская за день чинит одно попадание у первого повреждённого здания. */
function repairOne(w: World) {
  for (const root of buildingRoots(w)) {
    const def = BUILDING_BY_ID[w.tiles[root].def!];
    if (def && w.tiles[root].hp < def.hp) {
      for (const c of buildingCells(w, root)) w.tiles[c].hp++;
      markChanged(w, root);
      return;
    }
  }
}
