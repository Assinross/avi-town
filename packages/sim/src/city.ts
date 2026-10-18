// Симуляция города по дням: сети тока/воды по дорогам, рост зон по спросу, еда, бюджет.

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
export const PLANT_POWER = 600;
export const PUMP_WATER = { river: 400, well: 120 } as const;
const FOOD_PER_LEVEL: Record<string, number> = { soil: 8, wasteland: 4, rock: 2, contaminated: 0, water: 0 };
export const FOOD_STORAGE = 600;
const UPKEEP = { plant: 25, pump: 10, roadsPer: 20 } as const;
const ZONE_REACH = 2; // зоны растут не дальше 2 клеток от дороги

/** Продвинуть мир на ticks тиков; возвращает число прошедших дней. */
export function step(w: World, ticks: number): number {
  let days = 0;
  for (let i = 0; i < ticks; i++) {
    w.tick++;
    if (w.tick % TICKS_PER_DAY === 0) {
      simulateDay(w);
      days++;
    }
  }
  return days;
}

interface Net { power: number; water: number }

function isPumpNearWater(w: World, idx: number): boolean {
  const x = idx % w.size, y = Math.floor(idx / w.size);
  return [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) => tileAt(w, x + dx, y + dy)?.terrain === 'water');
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
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
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
  const counted = new Set<number>();
  for (let i = 0; i < n; i++) {
    const t = w.tiles[i];
    if ((t.object !== 'plant' && t.object !== 'pump') || counted.has(t.root)) continue;
    const net = nearestNet(w, netOf, i, 1);
    if (net < 0) continue;
    counted.add(t.root);
    if (t.object === 'plant') nets[net].power += PLANT_POWER;
    else nets[net].water += isPumpNearWater(w, t.root) ? PUMP_WATER.river : PUMP_WATER.well;
  }
  return { netOf, nets };
}

function nearestNet(w: World, netOf: Int32Array, idx: number, reach: number): number {
  // Для зданий 2x2 проверяем соседей всех клеток здания
  const t = w.tiles[idx];
  const cells = t.root >= 0 ? w.tiles.map((o, i) => (o.root === t.root ? i : -1)).filter((i) => i >= 0) : [idx];
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

function isPolluted(w: World, x: number, y: number): boolean {
  for (let dy = -3; dy <= 3; dy++) {
    for (let dx = -3; dx <= 3; dx++) {
      const t = tileAt(w, x + dx, y + dy);
      if (t && ((t.object === 'zone' && t.zone === 'I' && t.level > 0) || t.object === 'plant')) return true;
    }
  }
  return false;
}

/** Максимальный уровень, который клетка может держать при текущих условиях. */
export function maxLevel(w: World, t: Tile, x: number, y: number, connected: boolean): number {
  if (!connected || !t.zone) return 0;
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
  const { netOf, nets } = buildNetworks(w);
  const s: Stats = w.stats;
  let pop = 0, jobsC = 0, jobsI = 0, jobsA = 0, foodProd = 0, powerUsed = 0, waterUsed = 0, plants = 0, pumps = 0, roads = 0;
  const reach = new Int32Array(w.tiles.length).fill(-1);
  const roots = new Set<number>();

  // 1. Распределение тока и воды по сетям в порядке клеток (детерминированно)
  w.tiles.forEach((t, i) => {
    if (t.object === 'road') roads++;
    if ((t.object === 'plant' || t.object === 'pump') && !roots.has(t.root)) {
      roots.add(t.root);
      if (t.object === 'plant') plants++; else pumps++;
    }
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

  // 2. Рост и упадок зон
  const hungry = w.hungerDays > 5;
  w.tiles.forEach((t, i) => {
    if (t.object !== 'zone' || !t.zone) return;
    const x = i % w.size, y = Math.floor(i / w.size);
    const cap = maxLevel(w, t, x, y, reach[i] >= 0);
    const demand = s.demand[t.zone];
    let next = t.level;
    if (t.level > cap || demand < -50 || (hungry && t.zone === 'R')) {
      if (t.level > 0 && nextInt(w.rng, 100) < (t.level > cap ? 6 : 3)) next = t.level - 1;
    } else if (t.level < cap && demand > 0 && nextInt(w.rng, 100) < Math.max(2, demand >> 2)) {
      next = t.level + 1;
    }
    if (next !== t.level) {
      t.level = next;
      if (next > 0) t.variant = (t.variant * 31 + next * 7) & 255;
      markChanged(w, i);
    }
    const c = CAPACITY[t.zone][t.level];
    if (t.zone === 'R') pop += c;
    else if (t.zone === 'C') jobsC += c;
    else if (t.zone === 'I') jobsI += c;
    else {
      jobsA += c;
      foodProd += t.level * FOOD_PER_LEVEL[t.terrain];
    }
  });

  // 3. Еда
  const foodUse = Math.ceil(pop / 10);
  w.food += foodProd - foodUse;
  if (w.food < 0) {
    w.food = 0;
    w.hungerDays++;
  } else {
    w.hungerDays = Math.max(0, w.hungerDays - 1);
    w.food = Math.min(w.food, FOOD_STORAGE);
  }

  // 4. Спрос: жильё тянется за рабочими местами, торговля и промышленность - за жителями, фермы - за едой
  const jobs = jobsC + jobsI + jobsA;
  s.demand = {
    R: clamp(25 + ((jobs * 5) / 3 - pop) * 50 / Math.max(40, pop), -100, 100),
    C: clamp(5 + (pop * 0.25 - jobsC) * 100 / Math.max(20, pop * 0.25), -100, 100),
    I: clamp(20 + (pop * 0.35 - jobsI) * 100 / Math.max(20, pop * 0.35), -100, 100),
    A: clamp(20 + (foodUse * 1.3 - foodProd) * 100 / Math.max(5, foodUse), -100, 100),
  };

  // 5. Деньги: налоги с жителей и рабочих мест минус содержание
  const income = Math.floor((pop * 3) / 10) + Math.floor((jobs * 2) / 10);
  const upkeep = plants * UPKEEP.plant + pumps * UPKEEP.pump + Math.floor(roads / UPKEEP.roadsPer);
  w.money += income - upkeep;

  // 6. Довольство: голод и отсутствие воды снижают
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
  w.revision++;
}
