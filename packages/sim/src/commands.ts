// Команды игрока. Каждая команда проверяется, меняет мир и пишет запись для отмены (Ctrl+Z).

import { BUILDING_BY_ID, TECH_BY_ID, type Cost } from '@avi/data';
import { startMission } from './tactical';
import { markChanged, tileAt, type Resources, type Tile, type World, type ZoneType } from './world';

export interface Rect { x0: number; y0: number; x1: number; y1: number }

export type Command =
  | { type: 'buildRoad'; x: number; y: number }
  | { type: 'zone'; rect: Rect; zone: ZoneType }
  | { type: 'bulldoze'; rect: Rect }
  | { type: 'placeBuilding'; def: string; x: number; y: number }
  | { type: 'setSpeed'; speed: number }
  | { type: 'startResearch'; tech: string }
  | { type: 'assaultCrash' };

export type ReasonCode =
  | 'out_of_map' | 'no_money' | 'no_resources' | 'blocked' | 'no_road' | 'nothing' | 'water'
  | 'wrong_terrain' | 'not_researched' | 'no_lab' | 'busy' | 'unknown';

export type CommandResult = { ok: true; cost: number; count: number } | { ok: false; reason: ReasonCode };

export const PRICES = {
  road: 10,
  zone: 5,
  bulldoze: { road: 5, ruin: 40, rubble: 15, tree: 5, building: 50, zoneLevel: 20, crash: 0 },
  assault: 800,
} as const;

interface UndoRecord {
  tiles: [number, Tile][];
  money: number;
  resources: Resources;
}

/** Стек отмены: хранится у клиента/хоста, в сохранение не входит. */
export class History {
  private stack: UndoRecord[] = [];
  private current: UndoRecord | null = null;
  private grouped = false;

  private fresh(w: World): UndoRecord {
    return { tiles: [], money: w.money, resources: { ...w.resources } };
  }
  /** Несколько команд подряд (протянутая дорога) отменяются одним шагом. */
  beginGroup(w: World) {
    this.current = this.fresh(w);
    this.grouped = true;
  }
  endGroup() {
    this.grouped = false;
    this.commit();
  }
  begin(w: World) {
    if (!this.grouped) this.current = this.fresh(w);
  }
  touch(w: World, idx: number) {
    if (this.current && !this.current.tiles.some(([i]) => i === idx)) this.current.tiles.push([idx, { ...w.tiles[idx] }]);
  }
  commit() {
    if (this.grouped) return;
    if (this.current && this.current.tiles.length) this.stack.push(this.current);
    if (this.stack.length > 100) this.stack.shift();
    this.current = null;
  }
  /** Налёт или исследование меняют мир не через игрока - старые записи отмены становятся опасны. */
  clear() {
    this.stack = [];
  }
  get canUndo() {
    return this.stack.length > 0;
  }
  undo(w: World): boolean {
    const rec = this.stack.pop();
    if (!rec) return false;
    for (const [idx, prev] of rec.tiles) {
      w.tiles[idx] = { ...prev };
      markChanged(w, idx);
    }
    w.money = rec.money;
    w.resources = { ...rec.resources };
    return true;
  }
}

function normRect(r: Rect): Rect {
  return { x0: Math.min(r.x0, r.x1), y0: Math.min(r.y0, r.y1), x1: Math.max(r.x0, r.x1), y1: Math.max(r.y0, r.y1) };
}

function* rectTiles(w: World, r: Rect) {
  const n = normRect(r);
  for (let y = Math.max(0, n.y0); y <= Math.min(w.size - 1, n.y1); y++) {
    for (let x = Math.max(0, n.x0); x <= Math.min(w.size - 1, n.x1); x++) yield { x, y, idx: y * w.size + x };
  }
}

export function hasRoadNear(w: World, x: number, y: number, dist: number): boolean {
  for (let dy = -dist; dy <= dist; dy++) {
    for (let dx = -dist; dx <= dist; dx++) {
      if (tileAt(w, x + dx, y + dy)?.object === 'road') return true;
    }
  }
  return false;
}

const freeForBuilding = (t: Tile) => t.terrain !== 'water' && (t.object === 'none' || t.object === 'tree');

/** Можно ли зонировать клетку (для подсветки и самой команды). */
export function canZone(t: Tile, zone: ZoneType): boolean {
  if (t.terrain === 'water') return false;
  if (t.object === 'zone') return t.level === 0 && t.zone !== zone;
  return t.object === 'none' || t.object === 'tree';
}

export function canAfford(w: World, cost: Cost): boolean {
  return (cost.money ?? 0) <= w.money
    && (cost.metal ?? 0) <= w.resources.metal
    && (cost.alloys ?? 0) <= w.resources.alloys
    && (cost.elerium ?? 0) <= w.resources.elerium
    && (cost.fragments ?? 0) <= w.resources.fragments;
}

function pay(w: World, cost: Cost) {
  w.money -= cost.money ?? 0;
  w.resources.metal -= cost.metal ?? 0;
  w.resources.alloys -= cost.alloys ?? 0;
  w.resources.elerium -= cost.elerium ?? 0;
  w.resources.fragments -= cost.fragments ?? 0;
}

function bulldozeCost(t: Tile): number {
  switch (t.object) {
    case 'road': return PRICES.bulldoze.road;
    case 'ruin': return PRICES.bulldoze.ruin;
    case 'rubble': return PRICES.bulldoze.rubble;
    case 'tree': return PRICES.bulldoze.tree;
    case 'building': return PRICES.bulldoze.building;
    case 'zone': return t.level * PRICES.bulldoze.zoneLevel;
    default: return 0;
  }
}

export function clearTile(t: Tile) {
  t.object = 'none';
  t.zone = null;
  t.level = 0;
  t.root = -1;
  t.def = null;
  t.hp = 0;
  t.powered = false;
  t.watered = false;
}

/** Проверка постройки здания в точке (левый верхний угол). */
export function checkBuilding(w: World, defId: string, x: number, y: number): CommandResult {
  const def = BUILDING_BY_ID[defId];
  if (!def) return { ok: false, reason: 'unknown' };
  if (def.requires && !w.research.done.includes(def.requires)) return { ok: false, reason: 'not_researched' };
  let road = false;
  for (let dy = 0; dy < def.size; dy++) {
    for (let dx = 0; dx < def.size; dx++) {
      const t = tileAt(w, x + dx, y + dy);
      if (!t) return { ok: false, reason: 'out_of_map' };
      if (def.terrain && !def.terrain.includes(t.terrain)) return { ok: false, reason: 'wrong_terrain' };
      if (!freeForBuilding(t)) return { ok: false, reason: t.terrain === 'water' ? 'water' : 'blocked' };
      if (hasRoadNear(w, x + dx, y + dy, 1)) road = true;
    }
  }
  if (!road) return { ok: false, reason: 'no_road' };
  if (!canAfford(w, def.cost)) return { ok: false, reason: (def.cost.money ?? 0) > w.money ? 'no_money' : 'no_resources' };
  return { ok: true, cost: def.cost.money ?? 0, count: 1 };
}

/** Можно ли начать исследование: все требования изучены, артефакты на складе. */
export function checkResearch(w: World, techId: string): CommandResult {
  const tech = TECH_BY_ID[techId];
  if (!tech) return { ok: false, reason: 'unknown' };
  if (w.research.done.includes(techId)) return { ok: false, reason: 'nothing' };
  if (w.research.current) return { ok: false, reason: 'busy' };
  if (!tech.requires.every((r) => w.research.done.includes(r))) return { ok: false, reason: 'not_researched' };
  if (!canAfford(w, tech.items)) return { ok: false, reason: 'no_resources' };
  return { ok: true, cost: 0, count: 1 };
}

export function applyCommand(w: World, cmd: Command, history?: History): CommandResult {
  switch (cmd.type) {
    case 'setSpeed':
      w.speed = Math.max(0, Math.min(3, cmd.speed | 0));
      w.revision++;
      return { ok: true, cost: 0, count: 0 };
    case 'startResearch': {
      const res = checkResearch(w, cmd.tech);
      if (!res.ok) return res;
      pay(w, TECH_BY_ID[cmd.tech].items);
      w.research.current = cmd.tech;
      w.research.progress = 0;
      w.revision++;
      history?.clear();
      return res;
    }
    case 'assaultCrash':
      return assaultCrash(w, history);
  }
  history?.begin(w);
  const res = run(w, cmd, history);
  if (res.ok) history?.commit();
  return res;
}

/** Вызов отряда на место крушения - как вызов пожарных; начинается тактический бой. */
function assaultCrash(w: World, history?: History): CommandResult {
  if (!w.crash || w.mission) return { ok: false, reason: 'nothing' };
  if (w.money < PRICES.assault) return { ok: false, reason: 'no_money' };
  w.money -= PRICES.assault;
  startMission(w);
  history?.clear();
  return { ok: true, cost: PRICES.assault, count: 1 };
}

export function removeCrash(w: World) {
  const c = w.crash;
  if (!c) return;
  const idx = c.y * w.size + c.x;
  clearTile(w.tiles[idx]);
  w.tiles[idx].object = 'rubble';
  markChanged(w, idx);
  w.crash = null;
}

function run(w: World, cmd: Extract<Command, { type: 'buildRoad' | 'zone' | 'bulldoze' | 'placeBuilding' }>, h?: History): CommandResult {
  const touch = (idx: number) => {
    h?.touch(w, idx);
    markChanged(w, idx);
  };
  switch (cmd.type) {
    case 'buildRoad': {
      const t = tileAt(w, cmd.x, cmd.y);
      if (!t) return { ok: false, reason: 'out_of_map' };
      if (t.terrain === 'water') return { ok: false, reason: 'water' };
      if (t.object === 'road') return { ok: false, reason: 'nothing' };
      if (!(t.object === 'none' || t.object === 'tree' || t.object === 'rubble' || (t.object === 'zone' && t.level === 0))) return { ok: false, reason: 'blocked' };
      if (w.money < PRICES.road) return { ok: false, reason: 'no_money' };
      touch(cmd.y * w.size + cmd.x);
      clearTile(t);
      t.object = 'road';
      w.money -= PRICES.road;
      return { ok: true, cost: PRICES.road, count: 1 };
    }
    case 'zone': {
      const cells = [...rectTiles(w, cmd.rect)].filter((c) => canZone(w.tiles[c.idx], cmd.zone));
      if (!cells.length) return { ok: false, reason: 'blocked' };
      const cost = cells.length * PRICES.zone;
      if (w.money < cost) return { ok: false, reason: 'no_money' };
      for (const c of cells) {
        const t = w.tiles[c.idx];
        touch(c.idx);
        clearTile(t);
        t.object = 'zone';
        t.zone = cmd.zone;
      }
      w.money -= cost;
      return { ok: true, cost, count: cells.length };
    }
    case 'bulldoze': {
      const targets = new Set<number>();
      for (const c of rectTiles(w, cmd.rect)) {
        const t = w.tiles[c.idx];
        if (t.object === 'none' || t.object === 'crash') continue;
        if (t.root >= 0) {
          // Многоклеточное здание сносится целиком
          w.tiles.forEach((o, i) => { if (o.root === t.root) targets.add(i); });
        } else targets.add(c.idx);
      }
      if (!targets.size) return { ok: false, reason: 'nothing' };
      let cost = 0;
      const roots = new Set<number>();
      for (const i of targets) {
        const t = w.tiles[i];
        if (t.root >= 0) { if (!roots.has(t.root)) { roots.add(t.root); cost += bulldozeCost(t); } }
        else cost += bulldozeCost(t);
      }
      if (w.money < cost) return { ok: false, reason: 'no_money' };
      for (const i of targets) {
        touch(i);
        clearTile(w.tiles[i]);
      }
      w.money -= cost;
      return { ok: true, cost, count: targets.size };
    }
    case 'placeBuilding': {
      const res = checkBuilding(w, cmd.def, cmd.x, cmd.y);
      if (!res.ok) return res;
      const def = BUILDING_BY_ID[cmd.def];
      const root = cmd.y * w.size + cmd.x;
      for (let dy = 0; dy < def.size; dy++) {
        for (let dx = 0; dx < def.size; dx++) {
          const idx = (cmd.y + dy) * w.size + cmd.x + dx;
          touch(idx);
          const t = w.tiles[idx];
          clearTile(t);
          t.object = 'building';
          t.def = def.id;
          t.root = root;
          t.hp = def.hp;
        }
      }
      pay(w, def.cost);
      return res;
    }
  }
}
