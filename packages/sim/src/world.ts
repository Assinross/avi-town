// Мир первого среза: карта пустоши, деньги и команды строительства.
// Только целые числа и ГСЧ из состояния - результат зависит лишь от сида и команд.

import { nextInt, nextU32, seedRng, type RngState } from './rng';

export type Terrain = 'wasteland' | 'soil' | 'contaminated' | 'water' | 'rock';
export type TileObject = 'none' | 'road' | 'house' | 'ruin' | 'tree' | 'rubble';

export interface Tile {
  terrain: Terrain;
  object: TileObject;
  /** Случайный вариант 0..255 для внешнего вида (этажность, цвет, поворот). */
  variant: number;
}

export interface World {
  size: number;
  rng: RngState;
  tick: number;
  money: number;
  tiles: Tile[];
  /** Растёт при каждом изменении тайлов - сигнал отрисовке перестроить сцену. */
  revision: number;
}

export const PRICES = { road: 10, house: 120, bulldoze: 5 } as const;

export type Command =
  | { type: 'buildRoad'; x: number; y: number }
  | { type: 'placeHouse'; x: number; y: number }
  | { type: 'bulldoze'; x: number; y: number };

export type ReasonCode = 'out_of_map' | 'no_money' | 'blocked' | 'no_road' | 'nothing';

export type CommandResult = { ok: true } | { ok: false; reason: ReasonCode };

export function tileAt(w: World, x: number, y: number): Tile | undefined {
  if (x < 0 || y < 0 || x >= w.size || y >= w.size) return undefined;
  return w.tiles[y * w.size + x];
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
    tiles.push({ terrain, object: 'none', variant: nextU32(rng) & 255 });
  }
  const w: World = { size, rng, tick: 0, money: 5000, tiles, revision: 0 };
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

function hasRoadNeighbour(w: World, x: number, y: number): boolean {
  return [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) => tileAt(w, x + dx, y + dy)?.object === 'road');
}

/** Проверка без изменения мира - для подсветки курсора. */
export function canApply(w: World, cmd: Command): CommandResult {
  const t = tileAt(w, cmd.x, cmd.y);
  if (!t) return { ok: false, reason: 'out_of_map' };
  switch (cmd.type) {
    case 'buildRoad':
      if (t.terrain === 'water' || (t.object !== 'none' && t.object !== 'rubble')) return { ok: false, reason: 'blocked' };
      if (w.money < PRICES.road) return { ok: false, reason: 'no_money' };
      return { ok: true };
    case 'placeHouse':
      if (t.terrain === 'water' || t.terrain === 'contaminated' || t.object !== 'none') return { ok: false, reason: 'blocked' };
      if (!hasRoadNeighbour(w, cmd.x, cmd.y)) return { ok: false, reason: 'no_road' };
      if (w.money < PRICES.house) return { ok: false, reason: 'no_money' };
      return { ok: true };
    case 'bulldoze':
      if (t.object === 'none') return { ok: false, reason: 'nothing' };
      if (w.money < PRICES.bulldoze) return { ok: false, reason: 'no_money' };
      return { ok: true };
  }
}

export function apply(w: World, cmd: Command): CommandResult {
  const res = canApply(w, cmd);
  if (!res.ok) return res;
  const t = tileAt(w, cmd.x, cmd.y)!;
  switch (cmd.type) {
    case 'buildRoad':
      t.object = 'road';
      w.money -= PRICES.road;
      break;
    case 'placeHouse':
      t.object = 'house';
      t.variant = nextU32(w.rng) & 255;
      w.money -= PRICES.house;
      break;
    case 'bulldoze':
      t.object = 'none';
      w.money -= PRICES.bulldoze;
      break;
  }
  w.revision++;
  return res;
}

/** Хеш состояния для проверки детерминизма (FNV-1a). */
export function hashWorld(w: World): string {
  let h = 0x811c9dc5;
  const mix = (n: number) => { h = Math.imul(h ^ (n & 0xff), 0x01000193) >>> 0; };
  mix(w.money); mix(w.money >>> 8); mix(w.tick);
  for (const t of w.tiles) {
    mix(t.terrain.charCodeAt(0)); mix(t.object.charCodeAt(0)); mix(t.object.charCodeAt(1)); mix(t.variant);
  }
  return h.toString(16);
}
