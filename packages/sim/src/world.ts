// Состояние мира и генерация карты пустоши.
// Только целые числа и ГСЧ из состояния - результат зависит лишь от сида и команд.

import { nextInt, nextU32, seedRng, type RngState } from './rng';

export type Terrain = 'wasteland' | 'soil' | 'contaminated' | 'water' | 'rock';
export type TileObject = 'none' | 'road' | 'ruin' | 'tree' | 'rubble' | 'zone' | 'plant' | 'pump';
export type ZoneType = 'R' | 'C' | 'I' | 'A';

export interface Tile {
  terrain: Terrain;
  object: TileObject;
  /** Случайный вариант 0..255 для внешнего вида (этажность, цвет, поворот). */
  variant: number;
  zone: ZoneType | null;
  /** Уровень застройки зоны: 0 - пустой участок, 1..3 - здание. */
  level: number;
  /** Индекс главной клетки многоклеточного здания (для генератора 2x2), иначе -1. */
  root: number;
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
}

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
  tiles: Tile[];
  stats: Stats;
  /** Индексы клеток, изменённых с прошлого чтения - отрисовка перестраивает только их участки. */
  changes: number[];
  /** Растёт при любом изменении - для UI и слоёв. */
  revision: number;
}

export const SAVE_VERSION = 2;

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
    foodProd: 0, foodUse: 0, incomeDay: 0, upkeepDay: 0, happiness: 60,
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
    tiles.push({ terrain, object: 'none', variant: nextU32(rng) & 255, zone: null, level: 0, root: -1, powered: false, watered: false });
  }
  const w: World = {
    version: SAVE_VERSION, seed, size, rng, tick: 0, day: 1, speed: 1,
    money: 20000, food: 300, hungerDays: 0, tiles, stats: emptyStats(), changes: [], revision: 0,
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
  for (const t of w.tiles) {
    mix(t.terrain.charCodeAt(0)); mix(t.object.charCodeAt(0) | (t.object.charCodeAt(1) << 8));
    mix(t.variant); mix(t.level); mix(t.zone ? t.zone.charCodeAt(0) : 0);
  }
  return h.toString(16);
}
