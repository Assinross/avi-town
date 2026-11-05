import { TRANSIT } from '@avi/data';
import type { World } from './world';

export interface BusStop { id: number; road: number; side: number }
export interface CityBus { id: number; depot: number; level: number; route: number[] }
export interface TransitState {
  depots: number[];
  tokens: number;
  expansion: number;
  nextId: number;
  stops: BusStop[];
  buses: CityBus[];
}
export const newTransit = (): TransitState => ({ depots: [], tokens: 0, expansion: 0, nextId: 1, stops: [], buses: [] });
export const stopLimit = (w: World) => TRANSIT.stopLimits[w.transit.expansion];
export const depotReady = (w: World) => w.transit.depots.some((i) => w.tiles[i]?.def === 'bus_depot' && w.tiles[i].build === 0);

/** Готовое депо выдаёт комплект один раз; снесённые дороги убираются из маршрутов. */
export function syncTransit(w: World) {
  const t = w.transit;
  const live = t.depots.filter((i) => w.tiles[i]?.object === 'building' && w.tiles[i].def === 'bus_depot');
  let changed = live.length !== t.depots.length;
  t.depots = live;
  t.buses = t.buses.filter((b) => live.includes(b.depot));
  w.tiles.forEach((tile, i) => {
    if (tile.object !== 'building' || tile.root !== i || tile.def !== 'bus_depot' || tile.build > 0 || live.includes(i)) return;
    t.depots.push(i);
    t.tokens += Math.min(3, Math.max(0, stopLimit(w) - t.stops.length - t.tokens));
    t.buses.push({ id: t.nextId++, depot: i, level: 1, route: [] });
    changed = true;
  });
  const stops = t.stops.filter((s) => w.tiles[s.road]?.object === 'road' && w.explored[s.road]);
  if (stops.length !== t.stops.length) {
    t.tokens += t.stops.length - stops.length;
    t.stops = stops;
    const ids = new Set(stops.map((s) => s.id));
    for (const b of t.buses) b.route = b.route.filter((id) => ids.has(id));
    changed = true;
  }
  if (changed) w.revision++;
}

export type TransitCommand =
  | { type: 'placeBusStop'; x: number; y: number }
  | { type: 'removeBusStop'; id: number }
  | { type: 'buyBusStop' }
  | { type: 'buyBus' }
  | { type: 'upgradeBus'; id: number }
  | { type: 'expandBusStops' }
  | { type: 'setBusRoute'; id: number; stops: number[] };

export function roadConnected(w: World, from: number, to: number): boolean {
  const seen = new Set([from]), todo = [from];
  for (let i = 0; i < todo.length; i++) {
    const cell = todo[i];
    if (cell === to) return true;
    const x = cell % w.size, y = Math.floor(cell / w.size);
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = x + dx, ny = y + dy, n = ny * w.size + nx;
      if (nx < 0 || ny < 0 || nx >= w.size || ny >= w.size || seen.has(n) || w.tiles[n].object !== 'road' || !w.explored[n]) continue;
      seen.add(n); todo.push(n);
    }
  }
  return false;
}

export function transitCommand(w: World, cmd: TransitCommand): { ok: true; cost: number; count: number } | { ok: false; reason: 'busy' | 'blocked' | 'no_road' | 'no_money' | 'nothing' | 'no_path' | 'not_researched' | 'no_depot' | 'stop_limit' | 'bad_stop' | 'transit_growth' } {
  syncTransit(w);
  if (!depotReady(w)) return { ok: false, reason: 'no_depot' };
  const t = w.transit;
  const buy = (price: number, apply: () => void) => {
    if (w.money < price) return { ok: false as const, reason: 'no_money' as const };
    w.money -= price; apply(); w.revision++;
    return { ok: true as const, cost: price, count: 1 };
  };
  switch (cmd.type) {
    case 'placeBusStop': {
      if (!Number.isInteger(cmd.x) || !Number.isInteger(cmd.y) || cmd.x < 0 || cmd.y < 0 || cmd.x >= w.size || cmd.y >= w.size) return { ok: false, reason: 'no_road' };
      const road = cmd.y * w.size + cmd.x;
      if (w.tiles[road].object !== 'road' || !w.explored[road]) return { ok: false, reason: 'no_road' };
      const at = (x: number, y: number) => x >= 0 && y >= 0 && x < w.size && y < w.size && w.tiles[y * w.size + x].object === 'road';
      const xRoad = at(cmd.x - 1, cmd.y) && at(cmd.x + 1, cmd.y), zRoad = at(cmd.x, cmd.y - 1) && at(cmd.x, cmd.y + 1);
      if (xRoad === zRoad || (xRoad && (at(cmd.x, cmd.y - 1) || at(cmd.x, cmd.y + 1))) || (zRoad && (at(cmd.x - 1, cmd.y) || at(cmd.x + 1, cmd.y)))) return { ok: false, reason: 'bad_stop' };
      if (t.tokens < 1 || t.stops.length >= stopLimit(w) || t.stops.some((s) => s.road === road)) return { ok: false, reason: 'stop_limit' };
      return buy(0, () => { t.tokens--; t.stops.push({ id: t.nextId++, road, side: xRoad ? 2 : 0 }); });
    }
    case 'removeBusStop': {
      if (!t.stops.some((s) => s.id === cmd.id)) return { ok: false, reason: 'nothing' };
      return buy(0, () => { t.stops = t.stops.filter((s) => s.id !== cmd.id); t.tokens++; for (const b of t.buses) b.route = b.route.filter((id) => id !== cmd.id); });
    }
    case 'buyBusStop':
      if (t.tokens + t.stops.length >= stopLimit(w)) return { ok: false, reason: 'stop_limit' };
      return buy(TRANSIT.stopPrice, () => t.tokens++);
    case 'buyBus':
      if (t.buses.length >= TRANSIT.maxBuses) return { ok: false, reason: 'stop_limit' };
      return buy(TRANSIT.busPrice, () => t.buses.push({ id: t.nextId++, depot: t.depots[0], level: 1, route: [] }));
    case 'upgradeBus': {
      const bus = t.buses.find((b) => b.id === cmd.id);
      if (!bus || bus.level >= TRANSIT.capacity.length) return { ok: false, reason: 'nothing' };
      return buy(TRANSIT.busUpgradePrices[bus.level], () => bus.level++);
    }
    case 'expandBusStops': {
      const next = t.expansion + 1;
      if (next >= TRANSIT.stopLimits.length) return { ok: false, reason: 'nothing' };
      if (w.stats.population < TRANSIT.expansionPopulation[next]) return { ok: false, reason: 'transit_growth' };
      return buy(TRANSIT.expansionPrices[next], () => t.expansion++);
    }
    case 'setBusRoute': {
      const bus = t.buses.find((b) => b.id === cmd.id);
      const stops = cmd.stops.map((id) => t.stops.find((s) => s.id === id));
      if (!bus || stops.some((s) => !s) || new Set(cmd.stops).size !== stops.length) return { ok: false, reason: 'nothing' };
      for (let i = 0; i < stops.length && stops.length > 1; i++) if (!roadConnected(w, stops[i]!.road, stops[(i + 1) % stops.length]!.road)) return { ok: false, reason: 'no_path' };
      return buy(0, () => { bus.route = [...cmd.stops]; });
    }
  }
}
