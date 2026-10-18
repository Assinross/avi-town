// Состояние мира и генерация карты пустоши.
// Только целые числа и ГСЧ из состояния - результат зависит лишь от сида и команд.

import { nextInt, nextU32, seedRng, type RngState } from './rng';
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
  metalPerDay: number;
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

export interface CrashSite {
  x: number;
  y: number;
  ufo: string;
  expiresDay: number;
}

export type GameEvent =
  | { type: 'raidDetected'; ufo: string }
  | { type: 'raidArrived'; ufo: string }
  | { type: 'ufoDown'; ufo: string; x: number; y: number }
  | { type: 'ufoLeft'; ufo: string }
  | { type: 'buildingDestroyed'; x: number; y: number }
  | { type: 'researchDone'; tech: string }
  | { type: 'crashCleared'; ufo: string; salvage: Partial<Resources> & { money?: number }; lost: number }
  | { type: 'missionFailed'; ufo: string; lost: number; retreat: boolean }
  | { type: 'crashExpired'; ufo: string };

/** Краткоживущие эффекты для отрисовки (выстрелы, взрывы); не сохраняются. */
export type Fx =
  | { type: 'aaShot'; fromX: number; fromY: number; toX: number; toY: number; hit: boolean }
  | { type: 'ufoShot'; fromX: number; fromY: number; toX: number; toY: number }
  | { type: 'explosion'; x: number; y: number; big: boolean }
  | { type: 'tacShot'; fromX: number; fromY: number; toX: number; toY: number; hit: boolean; alien: boolean };

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
  /** Идущий тактический бой; пока он есть, город стоит. */
  mission: Mission | null;
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

export const SAVE_VERSION = 3;

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
    foodProd: 0, foodUse: 0, incomeDay: 0, upkeepDay: 0, happiness: 60, researchPerDay: 0, metalPerDay: 0,
  };
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
    tiles.push({ terrain, object: 'none', variant: nextU32(rng) & 255, zone: null, level: 0, root: -1, def: null, hp: 0, powered: false, watered: false });
  }
  const w: World = {
    version: SAVE_VERSION, seed, size, rng, tick: 0, day: 1, speed: 1,
    money: 20000, food: 300, hungerDays: 0,
    resources: { metal: 60, alloys: 0, elerium: 0, fragments: 0 },
    research: { done: [], current: null, progress: 0 },
    raid: null, nextRaidDay: 14, crash: null, mission: null,
    tiles, stats: emptyStats(), changes: [], revision: 0, events: [], fx: [],
  };
  placeOldTown(w);
  for (const t of tiles) {
    if (t.object === 'none' && (t.terrain === 'soil' || t.terrain === 'wasteland') && nextInt(rng, 100) < (t.terrain === 'soil' ? 18 : 3)) {
      t.object = 'tree';
    }
  }
  return w;
}

// Руины довоенного города: сетка старых улиц, частично разрушенных, с коробками домов.
function placeOldTown(w: World) {
  const { size, rng } = w;
  const cx = Math.floor(size / 2) + nextInt(rng, 9) - 4;
  const cy = Math.floor(size / 2) + nextInt(rng, 9) - 4;
  const r = Math.floor(size / 5);
  for (let y = cy - r; y <= cy + r; y++) {
    for (let x = cx - r; x <= cx + r; x++) {
      const t = tileAt(w, x, y);
      if (!t || t.terrain === 'water') continue;
      const street = (x - cx) % 5 === 0 || (y - cy) % 5 === 0;
      const roll = nextInt(rng, 100);
      if (street) t.object = roll < 70 ? 'road' : 'rubble';
      else if (roll < 55) t.object = 'ruin';
      else if (roll < 75) t.object = 'rubble';
    }
  }
}

/** Хеш состояния для проверки детерминизма (FNV-1a). */
export function hashWorld(w: World): string {
  let h = 0x811c9dc5;
  const mix = (n: number) => {
    for (let k = 0; k < 4; k++) h = Math.imul(h ^ ((n >>> (k * 8)) & 0xff), 0x01000193) >>> 0;
  };
  mix(w.money); mix(w.tick); mix(w.day); mix(w.food);
  mix(w.resources.metal); mix(w.resources.alloys); mix(w.resources.elerium); mix(w.resources.fragments);
  mix(w.research.progress); mix(w.research.done.length);
  if (w.raid) { mix(w.raid.ufo.x); mix(w.raid.ufo.y); mix(w.raid.ufo.hp); }
  for (const t of w.tiles) {
    mix(t.terrain.charCodeAt(0)); mix(t.object.charCodeAt(0) | (t.object.charCodeAt(1) << 8));
    mix(t.variant); mix(t.level); mix(t.zone ? t.zone.charCodeAt(0) : 0); mix(t.hp);
  }
  return h.toString(16);
}
