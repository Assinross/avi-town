// Симуляция города по дням: сети тока/воды по дорогам, рост зон по спросу, еда, металл,
// исследования, бюджет. Налёты НЛО идут по тикам - см. raid.ts.

import { BUILDING_BY_ID, ECONOMY, TECH_BY_ID, WASTELAND } from '@avi/data';
import { bunkerDay, bunkerHeal, bunkerUpkeep, convoyTick } from './bunker';
import { accrueDay, closeWeek, employment } from './economy';
import { expeditionsTick, exploreDay, siteNear } from './explore';
import { fitLot, setLot, shrinkLot, usesLots } from './lots';
import { landingTick, raidDay, raidTick } from './raid';
import { nextInt } from './rng';
import { squadDay, squadUpkeep } from './squad';
import { markChanged, tileAt, type Stats, type Tile, type World, type ZoneType } from './world';

export const TICK_HZ = 20;
export const TICKS_PER_DAY = 400; // x1: 20 секунд на игровой день; смена дня и ночи - отдельно, в клиенте
export const DAYS_PER_WEEK = 7;
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
const ZONE_REACH = 2; // зоны растут не дальше 2 клеток от дороги
/** Сколько дней строится зона до уровня 1..3. */
export const ZONE_BUILD_DAYS = [0, 2, 3, 4] as const;

/** Уровень, который уже работает: пока идёт стройка, действует прежний. */
export const builtLevel = (t: Tile) => (t.build > 0 ? t.level - 1 : t.level);

/** Продвинуть мир на ticks тиков; возвращает число прошедших дней. */
export function step(w: World, ticks: number): number {
  let days = 0;
  if (w.mission || w.over) return 0; // пока идёт бой или игра окончена, город стоит
  for (let i = 0; i < ticks; i++) {
    w.tick++;
    if (w.raid) raidTick(w);
    if (w.convoy) convoyTick(w);
    if (w.expeditions.length) expeditionsTick(w);
    if (w.crash?.landed) landingTick(w);
    // Броневик доехал - начался бой, город встаёт
    if (w.mission) return days;
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
    // Насос у реки или у найденного чистого источника качает много, вдали - колодец
    const river = buildingCells(w, root).some((c) => isNearWater(w, c)) || !!siteNear(w, 'spring', root, def.size);
    if (def.water) nets[net].water += river ? def.water.river : def.water.well;
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

/** Карты города на день: загрязнение и покрытие жилья услугами (школа и лазарет).
 *  cover - по отдельности: бит 1 школа, бит 2 лазарет. */
export interface CityEnv { polluted: Uint8Array; serviced: Uint8Array; cover: Uint8Array }

/** Отметить квадрат клеток вокруг прямоугольника x0..x1, y0..y1 с отступом r. */
function markArea(w: World, map: Uint8Array, x0: number, y0: number, x1: number, y1: number, r: number, bit: number) {
  for (let y = Math.max(0, y0 - r); y <= Math.min(w.size - 1, y1 + r); y++) {
    for (let x = Math.max(0, x0 - r); x <= Math.min(w.size - 1, x1 + r); x++) map[y * w.size + x] |= bit;
  }
}

export function cityEnv(w: World): CityEnv {
  const n = w.tiles.length;
  const polluted = new Uint8Array(n);
  const cover = new Uint8Array(n);
  const r = ECONOMY.pollution.radius;
  w.tiles.forEach((t, i) => {
    const x = i % w.size, y = Math.floor(i / w.size);
    if (isPolluting(t)) markArea(w, polluted, x, y, x, y, r, 1);
    const def = t.object === 'building' && t.root === i ? BUILDING_BY_ID[t.def!] : undefined;
    // Услуга работает достроенной и с током
    if (def?.service && t.build === 0 && t.powered) {
      markArea(w, cover, x, y, x + def.size - 1, y + def.size - 1, def.service.radius, def.service.kind === 'education' ? 1 : 2);
    }
  });
  const serviced = cover.map((v) => (v === 3 ? 1 : 0));
  return { polluted, serviced, cover };
}

/** Клетка выходит фасадом на дорогу (соседняя по стороне). */
export function isFrontage(w: World, x: number, y: number): boolean {
  return DIRS.some(([dx, dy]) => tileAt(w, x + dx, y + dy)?.object === 'road');
}

/** Максимальный уровень, который клетка может держать при текущих условиях. */
export function maxLevel(w: World, t: Tile, x: number, y: number, connected: boolean, env: CityEnv = cityEnv(w)): number {
  if (!connected || !t.zone) return 0;
  const i = y * w.size + x;
  // Участок дома начинается от улицы; клетки в глубине квартала занимает растущий участок
  if (usesLots(t) && !isFrontage(w, x, y)) return 0;
  if (t.zone !== 'A' && !t.powered) return 0;
  let cap = 1;
  if (t.watered) cap = 2;
  // Дому 3-го уровня нужны школа и лазарет рядом
  if (t.watered && w.stats.happiness >= ECONOMY.happiness.level3 && (t.zone !== 'R' || env.serviced[i])) cap = 3;
  if (t.terrain === 'contaminated' && (t.zone === 'R' || t.zone === 'C' || t.zone === 'A')) cap = Math.min(cap, 1);
  if (t.zone === 'R' && env.polluted[i]) cap = Math.min(cap, 1);
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
  let upkeep = 0, defense = 0, research = 0, metal = 0, labTier = 0, healRate = 1;
  let residentBase = 0, homes = 0, homesPolluted = 0, homesServiced = 0;
  const reach = new Int32Array(w.tiles.length).fill(-1);

  // 1. Здания: ток в первую очередь (оборона и XCOM важнее жилья), содержание, производство
  let workshops = 0;
  const radars: number[] = [];
  for (const root of buildingRoots(w)) {
    const t = w.tiles[root];
    const def = BUILDING_BY_ID[t.def!];
    if (!def) continue;
    // Стройплощадка не работает и не требует содержания
    if (t.build > 0) {
      if (t.powered) for (const c of buildingCells(w, root)) w.tiles[c].powered = false;
      continue;
    }
    if (def.category === 'defense') defense += def.upkeep;
    else upkeep += def.upkeep;
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
    if ((def.heal ?? 0) > healRate) healRate = def.heal!;
    // Шахта на залежи металла добывает в несколько раз больше
    const deposit = def.metalPerDay && siteNear(w, 'metal', root, def.size) ? WASTELAND.sites.metal.multiplier : 1;
    metal += (def.metalPerDay ?? 0) * deposit;
    if (def.id === 'workshop') workshops++;
    if (def.radar) radars.push(root);
  }
  // Бункер: содержание улучшений, медблок ускоряет лечение, стройка улучшения
  upkeep += bunkerUpkeep(w);
  healRate += bunkerHeal(w);
  bunkerDay(w);
  exploreDay(w, radars);

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
  const env = cityEnv(w);
  const hungry = w.hungerDays > 5;
  w.tiles.forEach((t, i) => {
    if (t.object !== 'zone' || !t.zone) return;
    // Клетки участка повторяют главную - решение о росте принимает она
    if (!(usesLots(t) && t.root >= 0 && t.root !== i)) {
      const x = i % w.size, y = Math.floor(i / w.size);
      const cap = maxLevel(w, t, x, y, reach[i] >= 0, env);
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
    if (t.zone === 'R') {
      pop += c;
      residentBase += c * ECONOMY.residentTax[lvl];
      if (lvl > 0) {
        homes++;
        homesPolluted += env.polluted[i];
        homesServiced += env.serviced[i];
      }
    } else if (t.zone === 'C') jobsC += c;
    else if (t.zone === 'I') {
      jobsI += c;
      metal += lvl * (METAL_PER_INDUSTRY_LEVEL[t.terrain] ?? 0);
      if (lvl === 3 && nextInt(w.rng, ECONOMY.pollution.poisonChance) === 0) poisonNear(w, i);
    } else {
      jobsA += c;
      // Ферма в загрязнении даёт меньше еды
      const food = lvl * FOOD_PER_LEVEL[t.terrain];
      foodProd += env.polluted[i] ? Math.floor((food * ECONOMY.pollution.farmFood) / 100) : food;
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
  squadDay(w, healRate);

  // 6. Спрос: жильё тянется за рабочими местами, торговля и промышленность - за жителями, фермы - за едой
  const jobs = jobsC + jobsI + jobsA;
  // Жильё тянется и за довольством: высокий налог и грязь отпугивают новых жителей
  s.demand = {
    R: clamp(25 + ((jobs * 5) / 3 - pop) * 50 / Math.max(40, pop) + (s.happiness - ECONOMY.happiness.base), -100, 100),
    C: clamp(5 + (pop * 0.25 - jobsC) * 100 / Math.max(20, pop * 0.25), -100, 100),
    I: clamp(20 + (pop * 0.35 - jobsI) * 100 / Math.max(20, pop * 0.35), -100, 100),
    A: clamp(20 + (foodUse * 1.3 - foodProd) * 100 / Math.max(5, foodUse), -100, 100),
  };

  // 7. Деньги: налоги и расходы копятся в бюджет недели (economy.ts)
  const day = accrueDay(w, {
    residentBase, pop, jobs: { R: 0, C: jobsC, I: jobsI, A: jobsA },
    buildings: upkeep, defense, roads: Math.floor(roads / ECONOMY.roadsPerUpkeep), squad: squadUpkeep(w),
  });

  // 8. Довольство: голод, нехватка воды и тока, налог, безработица, загрязнение снижают; услуги повышают
  const H = ECONOMY.happiness;
  const zoned = w.tiles.filter((t) => t.object === 'zone' && t.level > 0);
  const dry = zoned.filter((t) => !t.watered).length;
  const dark = zoned.filter((t) => !t.powered && t.zone !== 'A').length;
  const n = Math.max(1, zoned.length);
  const { unemployment } = employment(pop, jobs);
  const taxMood = (w.budget.tax - ECONOMY.tax.default) * ECONOMY.tax.happinessPerPoint;
  const h = Math.max(1, homes);
  s.happiness = clamp(H.base - Math.min(40, w.hungerDays * 4) - (dry * 20) / n - (dark * 30) / n - taxMood
    - Math.min(H.unemploymentMax, unemployment / 2) - (homesPolluted * H.pollution) / h + (homesServiced * H.services) / h, 0, 100);

  s.population = pop;
  s.jobs = jobs;
  s.powerCap = nets.reduce((a, nt) => a + nt.power, 0) + powerUsed;
  s.powerUsed = powerUsed;
  s.waterCap = nets.reduce((a, nt) => a + nt.water, 0) + waterUsed;
  s.waterUsed = waterUsed;
  s.foodProd = foodProd;
  s.foodUse = foodUse;
  s.incomeDay = day.income;
  s.upkeepDay = day.upkeep;
  s.researchPerDay = research;
  s.labTier = labTier;
  s.metalPerDay = metal;
  s.healRate = healRate;
  s.unemployment = unemployment;
  s.serviced = Math.floor((homesServiced * 100) / h);
  s.polluted = Math.floor((homesPolluted * 100) / h);

  // Первый день новой недели закрывает прошлую: казна меняется вместе с надписью "неделя 2, день 1"
  if (w.day > 1 && w.day % DAYS_PER_WEEK === 1) closeWeek(w, (w.day - 1) / DAYS_PER_WEEK);
  raidDay(w);
  w.revision++;
}

/** Промзона 3-го уровня навсегда отравляет случайную соседнюю клетку плодородной земли или пустоши. */
function poisonNear(w: World, i: number) {
  const r = ECONOMY.pollution.poisonRadius;
  const x = (i % w.size) + nextInt(w.rng, r * 2 + 1) - r;
  const y = Math.floor(i / w.size) + nextInt(w.rng, r * 2 + 1) - r;
  const t = tileAt(w, x, y);
  if (!t || t.object === 'road' || (t.terrain !== 'soil' && t.terrain !== 'wasteland')) return;
  t.terrain = 'contaminated';
  markChanged(w, y * w.size + x);
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
