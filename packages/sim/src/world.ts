// Состояние мира и генерация карты пустоши.
// Только целые числа и ГСЧ из состояния - результат зависит лишь от сида и команд.

import { ECONOMY, type SiteKind } from '@avi/data';
import { nextInt, nextU32, seedRng, type RngState } from './rng';
import { initialSquad } from './squad';
import type { Mission } from './tactical';

export type Terrain = 'wasteland' | 'soil' | 'contaminated' | 'water' | 'rock';
export type TileObject = 'none' | 'road' | 'ruin' | 'tree' | 'rubble' | 'zone' | 'building' | 'crash';
export type ZoneType = 'R' | 'C' | 'I' | 'A';

export interface Tile {
  terrain: Terrain;
  object: TileObject;
  /** Случайный вариант 0..255 для внешнего вида (этажность, цвет, поворот). */
  variant: number;
  zone: ZoneType | null;
  /** Уровень застройки зоны: 0 - пустой участок, 1..3 - здание. */
  level: number;
  /** Индекс главной клетки здания (для 2x2 - левый верхний угол), иначе -1. */
  root: number;
  /** Определение здания из @avi/data (object = 'building') или тип НЛО (object = 'crash'). */
  def: string | null;
  /** Оставшиеся попадания до разрушения здания. */
  hp: number;
  powered: boolean;
  watered: boolean;
  /** Сколько дней осталось строить (здание - на главной клетке, зона - до следующего уровня); 0 - готово. */
  build: number;
  /** Форма участка дома (только на главной клетке участка жилья/торговли, см. lots.ts); 0 - нет. */
  lot: number;
}

export interface Stats {
  population: number;
  jobs: number;
  /** Спрос -100..100 по типам зон. */
  demand: Record<ZoneType, number>;
  powerCap: number;
  powerUsed: number;
  waterCap: number;
  waterUsed: number;
  foodProd: number;
  foodUse: number;
  incomeDay: number;
  upkeepDay: number;
  happiness: number;
  researchPerDay: number;
  /** Максимальный ярус работающих лабораторий (0 - нет лабораторий). */
  labTier: number;
  metalPerDay: number;
  /** Во сколько раз быстрее обычного лечатся раненые (1 - без лазарета). */
  healRate: number;
  /** Безработные среди работников, %. */
  unemployment: number;
  /** Доля жилья (клеток), где есть и школа, и лазарет, %. */
  serviced: number;
  /** Доля жилья (клеток) в загрязнении, %. */
  polluted: number;
}

export type IncomeItem = 'taxR' | 'taxC' | 'taxI' | 'taxA' | 'metal';
export type ExpenseItem = 'buildings' | 'defense' | 'services' | 'roads' | 'squad' | 'interest';

/** Итог закрытой недели: статьи в ¢, net - на сколько изменилась казна. */
export interface WeekReport {
  week: number;
  income: Record<IncomeItem, number>;
  expense: Record<ExpenseItem, number>;
  net: number;
  unemployment: number;
  /** Сколько недель подряд долг больше предела (после этой недели). */
  debtWeeks: number;
}

export interface Budget {
  /** Ставка налога, %. */
  tax: number;
  /** Накоплено с начала недели, в сотых долях ¢; в казну переходит в первый день новой недели. */
  income: Record<IncomeItem, number>;
  expense: Record<ExpenseItem, number>;
  debtWeeks: number;
  last: WeekReport | null;
}

export interface Resources {
  metal: number;
  alloys: number;
  elerium: number;
  fragments: number;
}

export interface ResearchState {
  done: string[];
  current: string | null;
  progress: number;
  /** Найденные довоенные архивы: каждый ускоряет следующее начатое исследование. */
  archives: number;
}

export interface Ufo {
  def: string;
  /** Позиция и скорость в сотых долях клетки. */
  x: number;
  y: number;
  vx: number;
  vy: number;
  hp: number;
  maxHp: number;
  cooldown: number;
  /** Точка атаки (центр города) и текущая путевая точка, в сотых долях клетки. */
  tx: number;
  ty: number;
  wx: number;
  wy: number;
  phase: 'approach' | 'attack' | 'leave';
  /** Сколько тиков осталось кружить над городом. */
  timer: number;
}

export interface Raid {
  ufo: Ufo;
  detected: boolean;
  /** Перезарядка ПВО по индексу главной клетки здания. */
  aaCooldown: Record<number, number>;
}

/** Боец XCOM между миссиями. Здоровье выводится из heal (см. squad.ts). */
export interface Soldier {
  id: number;
  name: string;
  /** Сколько очков лечения осталось; 0 - здоров и готов к бою. Без лазарета - 1 очко в день. */
  heal: number;
}

export interface CrashSite {
  x: number;
  y: number;
  ufo: string;
  expiresDay: number;
  /** Десант: тарелка села целой, и пришельцы громят дома вокруг, пока не приедет отряд. */
  landed?: boolean;
  /** Тиков до следующего удара десанта. */
  timer?: number;
}

/** Находка пустоши: лежит под туманом, пока клетку не разведают. */
export interface Site {
  id: number;
  x: number;
  y: number;
  kind: SiteKind;
  /** Клетка разведана - находку видно. */
  found: boolean;
  /** Разовая находка забрана, гнездо зачищено. */
  done: boolean;
  /** Что лежит в тайнике. */
  reward: { money?: number; metal?: number };
}

/** Бункер: место, откуда вышли люди, казарма отряда и гараж броневика. */
export interface BunkerState {
  /** Главная клетка здания бункера. */
  root: number;
  upgrades: string[];
  /** Улучшение в работе и сколько дней ещё строить. */
  work: { id: string; days: number } | null;
}

/** Цель выезда: место крушения или десанта (site = -1) либо гнездо пришельцев (id находки). */
export interface ConvoyTarget {
  x: number;
  y: number;
  site: number;
}

/** Броневик отряда: едет по клеткам маршрута от гаража к цели и обратно. */
export interface Convoy {
  path: number[];
  /** Номер клетки маршрута, где броневик сейчас, и тики, проведённые в ней. */
  seg: number;
  acc: number;
  phase: 'out' | 'back';
  target: ConvoyTarget;
  /** Бойцы в броневике (Soldier.id): на это время их нет в бункере. */
  soldiers: number[];
  /** С гаражом броневик быстрее. */
  fast: boolean;
}

/** Экспедиция разведчиков: идёт от бункера к цели по прямой, открывая полосу тумана, и возвращается. */
export interface Expedition {
  id: number;
  soldiers: number[];
  path: number[];
  seg: number;
  acc: number;
  phase: 'out' | 'back';
  /** Тиков на клетку пути. */
  ticks: number;
  /** Радиус разведки у цели. */
  radius: number;
  /** Сколько находок открыто за поход. */
  found: number;
}

export type GameEvent =
  | { type: 'raidDetected'; ufo: string }
  | { type: 'raidArrived'; ufo: string }
  | { type: 'ufoDown'; ufo: string; x: number; y: number }
  | { type: 'ufoLeft'; ufo: string }
  | { type: 'buildingDestroyed'; x: number; y: number }
  | { type: 'researchDone'; tech: string }
  | { type: 'crashCleared'; ufo: string; salvage: Partial<Resources> & { money?: number }; wounded: number; down: number }
  | { type: 'missionFailed'; ufo: string; wounded: number; down: number; retreat: boolean }
  | { type: 'soldierRecovered'; name: string }
  | { type: 'weekReport'; report: WeekReport }
  | { type: 'bankrupt' }
  | { type: 'crashExpired'; ufo: string; landed?: boolean }
  | { type: 'siteFound'; kind: SiteKind; x: number; y: number; reward: { money?: number; metal?: number; soldier?: string; research?: string } }
  | { type: 'expeditionBack'; found: number; wounded: number }
  | { type: 'bunkerUpgraded'; id: string }
  | { type: 'convoyArrived' }
  | { type: 'convoyBack' }
  | { type: 'convoyTurned' }
  | { type: 'ufoLanded'; ufo: string; x: number; y: number }
  | { type: 'nestCleared'; salvage: Partial<Resources> & { money?: number }; wounded: number; down: number };

/** Краткоживущие эффекты для отрисовки (выстрелы, взрывы); не сохраняются. */
export type Fx =
  | { type: 'aaShot'; fromX: number; fromY: number; toX: number; toY: number; hit: boolean }
  | { type: 'ufoShot'; fromX: number; fromY: number; toX: number; toY: number }
  | { type: 'explosion'; x: number; y: number; big: boolean }
  | { type: 'tacShot'; fromX: number; fromY: number; toX: number; toY: number; hit: boolean; alien: boolean; fromId: number; toId: number };

export interface World {
  version: number;
  seed: number;
  size: number;
  rng: RngState;
  tick: number;
  day: number;
  /** 0 - пауза, 1..3 - скорость. */
  speed: number;
  money: number;
  food: number;
  hungerDays: number;
  resources: Resources;
  research: ResearchState;
  raid: Raid | null;
  nextRaidDay: number;
  crash: CrashSite | null;
  budget: Budget;
  /** Итог игры: null - идёт; 'bankrupt' - город обанкротился, время стоит. */
  over: 'bankrupt' | null;
  /** Состав отряда: здоровые и раненые. */
  soldiers: Soldier[];
  /** Идущий тактический бой; пока он есть, город стоит. */
  mission: Mission | null;
  /** Разведанные клетки: 1 - видно, 0 - туман войны. В песочнице открыто всё. */
  explored: number[];
  /** Находки пустоши; в песочнице их нет. */
  sites: Site[];
  /** Бункер; null - город без бункера (песочница, старое сохранение без места под него). */
  bunker: BunkerState | null;
  /** Броневик в пути; null - стоит в гараже. */
  convoy: Convoy | null;
  expeditions: Expedition[];
  tiles: Tile[];
  stats: Stats;
  /** Индексы клеток, изменённых с прошлого чтения - отрисовка перестраивает только их участки. */
  changes: number[];
  /** Растёт при любом изменении - для UI и слоёв. */
  revision: number;
  /** События для оповещений и эффекты для отрисовки; клиент забирает и очищает, в сохранение не входят. */
  events: GameEvent[];
  fx: Fx[];
}

export const SAVE_VERSION = 11;

/** Первый налёт - примерно через год (330-390 день): год на развитие города и накопление на первую ПВО. */
export const RAID_FIRST_DAY = 330;
export const RAID_FIRST_SPREAD = 61;

export function tileAt(w: World, x: number, y: number): Tile | undefined {
  if (x < 0 || y < 0 || x >= w.size || y >= w.size) return undefined;
  return w.tiles[y * w.size + x];
}

export function markChanged(w: World, idx: number) {
  w.changes.push(idx);
  w.revision++;
}

// Целочисленный value noise: решётка случайных значений 0..1023, билинейная интерполяция.
function noiseField(rng: RngState, size: number, cell: number): number[] {
  const g = Math.ceil(size / cell) + 2;
  const lattice = Array.from({ length: g * g }, () => nextInt(rng, 1024));
  const out = new Array<number>(size * size);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const gx = Math.floor(x / cell), gy = Math.floor(y / cell);
      const fx = x % cell, fy = y % cell;
      const a = lattice[gy * g + gx], b = lattice[gy * g + gx + 1];
      const c = lattice[(gy + 1) * g + gx], d = lattice[(gy + 1) * g + gx + 1];
      const top = a * (cell - fx) + b * fx;
      const bottom = c * (cell - fx) + d * fx;
      out[y * size + x] = Math.floor((top * (cell - fy) + bottom * fy) / (cell * cell));
    }
  }
  return out;
}

export function emptyStats(): Stats {
  return {
    population: 0, jobs: 0, demand: { R: 40, C: 0, I: 20, A: 30 },
    powerCap: 0, powerUsed: 0, waterCap: 0, waterUsed: 0,
    foodProd: 0, foodUse: 0, incomeDay: 0, upkeepDay: 0, happiness: 60, researchPerDay: 0, labTier: 0, metalPerDay: 0, healRate: 1,
    unemployment: 0, serviced: 0, polluted: 0,
  };
}

export function emptyLedger(): Pick<Budget, 'income' | 'expense'> {
  return {
    income: { taxR: 0, taxC: 0, taxI: 0, taxA: 0, metal: 0 },
    expense: { buildings: 0, defense: 0, services: 0, roads: 0, squad: 0, interest: 0 },
  };
}

export function newBudget(): Budget {
  return { tax: ECONOMY.tax.default, ...emptyLedger(), debtWeeks: 0, last: null };
}

export function createWorld(seed: number, size = 64): World {
  const rng = seedRng(seed);
  const wet = noiseField(rng, size, 12);
  const toxic = noiseField(rng, size, 9);
  const stone = noiseField(rng, size, 7);
  const tiles: Tile[] = [];
  for (let i = 0; i < size * size; i++) {
    let terrain: Terrain = 'wasteland';
    if (wet[i] > 700) terrain = 'water';
    else if (wet[i] > 560) terrain = 'soil';
    else if (toxic[i] > 720) terrain = 'contaminated';
    else if (stone[i] > 780) terrain = 'rock';
    tiles.push({ terrain, object: 'none', variant: nextU32(rng) & 255, zone: null, level: 0, root: -1, def: null, hp: 0, powered: false, watered: false, build: 0, lot: 0 });
  }
  const w: World = {
    version: SAVE_VERSION, seed, size, rng, tick: 0, day: 1, speed: 1,
    money: ECONOMY.startMoney, food: 300, hungerDays: 0, budget: newBudget(), over: null,
    resources: { metal: 60, alloys: 0, elerium: 0, fragments: 0 },
    research: { done: [], current: null, progress: 0, archives: 0 },
    raid: null, nextRaidDay: 0, crash: null, soldiers: initialSquad(), mission: null,
    explored: new Array(size * size).fill(1), sites: [], bunker: null, convoy: null, expeditions: [],
    tiles, stats: emptyStats(), changes: [], revision: 0, events: [], fx: [],
  };
  for (const t of tiles) {
    if (t.object === 'none' && (t.terrain === 'soil' || t.terrain === 'wasteland') && nextInt(rng, 100) < (t.terrain === 'soil' ? 18 : 3)) {
      t.object = 'tree';
    }
  }
  w.nextRaidDay = RAID_FIRST_DAY + nextInt(rng, RAID_FIRST_SPREAD);
  return w;
}

/** Хеш состояния для проверки детерминизма (FNV-1a). */
export function hashWorld(w: World): string {
  let h = 0x811c9dc5;
  const mix = (n: number) => {
    for (let k = 0; k < 4; k++) h = Math.imul(h ^ ((n >>> (k * 8)) & 0xff), 0x01000193) >>> 0;
  };
  mix(w.money); mix(w.tick); mix(w.day); mix(w.food);
  mix(w.budget.tax); mix(w.budget.debtWeeks);
  for (const v of Object.values(w.budget.income)) mix(v);
  for (const v of Object.values(w.budget.expense)) mix(v);
  mix(w.resources.metal); mix(w.resources.alloys); mix(w.resources.elerium); mix(w.resources.fragments);
  mix(w.research.progress); mix(w.research.done.length);
  if (w.raid) { mix(w.raid.ufo.x); mix(w.raid.ufo.y); mix(w.raid.ufo.hp); }
  for (const s of w.soldiers) { mix(s.id); mix(s.heal); }
  mix(w.explored.reduce((a, v, i) => (v ? a + i : a), 0));
  for (const site of w.sites) { mix(site.id); mix(site.x); mix(site.y); mix(site.found ? 1 : 0); mix(site.done ? 1 : 0); }
  if (w.bunker) { mix(w.bunker.root); mix(w.bunker.upgrades.length); mix(w.bunker.work?.days ?? -1); }
  if (w.convoy) { mix(w.convoy.seg); mix(w.convoy.acc); mix(w.convoy.path.length); }
  for (const e of w.expeditions) { mix(e.id); mix(e.seg); mix(e.acc); }
  for (const t of w.tiles) {
    mix(t.terrain.charCodeAt(0)); mix(t.object.charCodeAt(0) | (t.object.charCodeAt(1) << 8));
    mix(t.variant); mix(t.level); mix(t.zone ? t.zone.charCodeAt(0) : 0); mix(t.hp); mix(t.build); mix(t.lot); mix(t.root);
  }
  return h.toString(16);
}
