// Команды игрока. Каждая команда проверяется, меняет мир и пишет запись для отмены (Ctrl+Z).

import { BUILDING_BY_ID, SQUAD, TACTICS, TECH_BY_ID, UPGRADE_BY_ID, WASTELAND, type Cost } from '@avi/data';
import { BAND_TARGET, checkUpgrade, dispatchConvoy, hasGarage } from './bunker';
import { clampTax } from './economy';
import { syncTransit, transitCommand, type TransitCommand, type TransitState } from './transit';
import { exploredAt, expeditionCost, irradiated, launchExpedition, reveal, scoutsFor } from './explore';
import { DIRS, lotCells, releaseLot } from './lots';
import { awaySoldiers, newSoldier, PERSONAL_ID, readySoldiers, rosterCap } from './squad';
import { focusFight, retreatFight, startFight } from './fight';
import { chooseDoctrine, orderProduction, useProducedKit } from './military';
import { markChanged, tileAt, type MilitaryDoctrine, type MilitaryRecipe, type Resources, type SoldierKit, type SoldierRole, type SquadStance, type Tile, type World, type ZoneType } from './world';
import { chooseOpening, openingResearchStarted } from './opening';
import { PRICES, bulldozeCost } from './prices';
import { canPlaceRoundabout, roundaboutAt, roundaboutCells, syncRoundabouts, type Roundabout } from './roundabout';

export { PRICES };

export interface Rect { x0: number; y0: number; x1: number; y1: number }

export type Command = TransitCommand
  | { type: 'buildRoad'; x: number; y: number; pair?: { x: number; y: number }; avenue?: boolean }
  | { type: 'placeRoundabout'; x: number; y: number; upgrade?: boolean }
  | { type: 'zone'; rect: Rect; zone: ZoneType }
  | { type: 'bulldoze'; rect: Rect }
  | { type: 'placeBuilding'; def: string; x: number; y: number }
  | { type: 'setSpeed'; speed: number }
  | { type: 'startResearch'; tech: string }
  | { type: 'openingChoice'; choice: 'recon' | 'fortify' }
  | { type: 'assaultCrash' }
  | { type: 'setSoldierRole'; id: number; role: SoldierRole }
  | { type: 'equipSoldier'; id: number; kit: SoldierKit }
  | { type: 'setSquadStance'; stance: SquadStance }
  | { type: 'setMilitaryDoctrine'; doctrine: MilitaryDoctrine }
  | { type: 'militaryOrder'; recipe: MilitaryRecipe }
  | { type: 'focusFire'; enemy: number }
  | { type: 'retreatSquad' }
  | { type: 'hireSoldier' }
  | { type: 'dismissSoldier'; id: number }
  | { type: 'setTax'; rate: number }
  | { type: 'upgradeBunker'; id: string }
  | { type: 'sendExpedition'; x: number; y: number; soldiers: number }
  | { type: 'assaultSite'; site: number }
  | { type: 'assaultBand' };

export type ReasonCode =
  | 'out_of_map' | 'no_money' | 'no_resources' | 'blocked' | 'no_road' | 'nothing' | 'water'
  | 'wrong_terrain' | 'not_researched' | 'no_lab' | 'busy' | 'no_squad' | 'squad_full' | 'game_over' | 'unknown'
  | 'fog' | 'radiation' | 'no_path' | 'no_bunker' | 'no_food' | 'no_depot' | 'stop_limit' | 'bad_stop' | 'transit_growth'
  | 'peaceful_mode' | 'no_workshop';

export type CommandResult = { ok: true; cost: number; count: number } | { ok: false; reason: ReasonCode };

interface UndoRecord {
  transit: TransitState;
  tiles: [number, Tile][];
  money: number;
  resources: Resources;
  roundabouts: Roundabout[];
}

/** Стек отмены: хранится у клиента/хоста, в сохранение не входит. */
export class History {
  private stack: UndoRecord[] = [];
  private current: UndoRecord | null = null;
  private grouped = false;

  private fresh(w: World): UndoRecord {
    return { tiles: [], money: w.money, resources: { ...w.resources }, transit: JSON.parse(JSON.stringify(w.transit)), roundabouts: w.roundabouts.map((r) => ({ ...r })) };
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
    w.transit = rec.transit;
    w.roundabouts = rec.roundabouts;
    syncTransit(w);
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

export function clearTile(t: Tile) {
  t.object = 'none';
  t.zone = null;
  t.level = 0;
  t.root = -1;
  t.def = null;
  t.hp = 0;
  t.powered = false;
  t.watered = false;
  t.build = 0;
  t.lot = 0;
  t.road = 0;
}

/** Проверка постройки здания в точке (левый верхний угол). */
export function checkBuilding(w: World, defId: string, x: number, y: number): CommandResult {
  const def = BUILDING_BY_ID[defId];
  if (defId === 'bus_depot' && w.tiles.some((t) => t.object === 'building' && t.def === defId)) return { ok: false, reason: 'stop_limit' };
  if (!def || def.fixed) return { ok: false, reason: 'unknown' };
  if (w.civic && (def.category === 'xcom' || def.category === 'defense')) return { ok: false, reason: 'peaceful_mode' };
  if (def.requires && !w.research.done.includes(def.requires)) return { ok: false, reason: 'not_researched' };
  let road = false;
  for (let dy = 0; dy < def.size; dy++) {
    for (let dx = 0; dx < def.size; dx++) {
      const t = tileAt(w, x + dx, y + dy);
      if (!t) return { ok: false, reason: 'out_of_map' };
      if (!exploredAt(w, x + dx, y + dy)) return { ok: false, reason: 'fog' };
      if (irradiated(w, x + dx, y + dy)) return { ok: false, reason: 'radiation' };
      if (def.terrain && !def.terrain.includes(t.terrain)) return { ok: false, reason: 'wrong_terrain' };
      if (!freeForBuilding(t)) return { ok: false, reason: t.terrain === 'water' ? 'water' : 'blocked' };
      if (hasRoadNear(w, x + dx, y + dy, 1)) road = true;
    }
  }
  if (!road) return { ok: false, reason: 'no_road' };
  if (!canAfford(w, def.cost)) return { ok: false, reason: (def.cost.money ?? 0) > w.money ? 'no_money' : 'no_resources' };
  return { ok: true, cost: def.cost.money ?? 0, count: 1 };
}

/** Максимальный ярус среди работающих (запитанных, достроенных) лабораторий. */
function maxLabTier(w: World): number {
  let tier = 0;
  w.tiles.forEach((t, i) => {
    if (t.object !== 'building' || t.root !== i || t.build > 0 || !t.powered) return;
    const lab = BUILDING_BY_ID[t.def!]?.labTier ?? 0;
    if (lab > tier) tier = lab;
  });
  return tier;
}

/** Можно ли начать исследование: есть лаборатория нужного яруса, хватает денег, все требования изучены, артефакты на складе. */
export function checkResearch(w: World, techId: string): CommandResult {
  if (w.civic) return { ok: false, reason: 'peaceful_mode' };
  const tech = TECH_BY_ID[techId];
  if (!tech) return { ok: false, reason: 'unknown' };
  if (w.research.done.includes(techId)) return { ok: false, reason: 'nothing' };
  if (w.research.current) return { ok: false, reason: 'busy' };
  if (!tech.requires.every((r) => w.research.done.includes(r))) return { ok: false, reason: 'not_researched' };
  if (maxLabTier(w) < (tech.lab ?? 1)) return { ok: false, reason: 'no_lab' };
  if (w.money < (tech.price ?? 0)) return { ok: false, reason: 'no_money' };
  if (!canAfford(w, tech.items)) return { ok: false, reason: 'no_resources' };
  return { ok: true, cost: tech.price ?? 0, count: 1 };
}

export function applyCommand(w: World, cmd: Command, history?: History): CommandResult {
  if (w.over) return { ok: false, reason: 'game_over' };
  switch (cmd.type) {
    case 'placeBusStop': case 'removeBusStop': case 'buyBusStop': case 'buyBus': case 'upgradeBus': case 'expandBusStops': case 'setBusRoute': {
      const res = transitCommand(w, cmd);
      if (res.ok) history?.clear();
      return res;
    }
    case 'openingChoice':
      if (w.civic) return { ok: false, reason: 'peaceful_mode' };
      if (!chooseOpening(w, cmd.choice)) return { ok: false, reason: 'nothing' };
      history?.clear();
      return { ok: true, cost: 0, count: 1 };
    case 'setTax':
      w.budget.tax = clampTax(cmd.rate);
      w.revision++;
      return { ok: true, cost: 0, count: 0 };
    case 'setSpeed':
      w.speed = Math.max(0, Math.min(3, cmd.speed | 0));
      w.revision++;
      return { ok: true, cost: 0, count: 0 };
    case 'startResearch': {
      const res = checkResearch(w, cmd.tech);
      if (!res.ok) return res;
      const tech = TECH_BY_ID[cmd.tech];
      w.money -= tech.price ?? 0;
      pay(w, tech.items);
      w.research.current = cmd.tech;
      w.research.progress = 0;
      openingResearchStarted(w);
      // Найденный довоенный архив: часть работы уже сделана
      if (w.research.archives > 0) {
        w.research.archives--;
        w.research.progress = Math.floor((tech.cost * WASTELAND.sites.archive.percent) / 100);
      }
      w.revision++;
      history?.clear();
      return res;
    }
    case 'assaultCrash':
      return w.civic ? { ok: false, reason: 'peaceful_mode' } : assaultCrash(w, history);
    case 'setMilitaryDoctrine': {
      const result = chooseDoctrine(w, cmd.doctrine);
      if (result !== 'ok') return { ok: false, reason: result };
      history?.clear();
      return { ok: true, cost: 0, count: 1 };
    }
    case 'militaryOrder': {
      const result = orderProduction(w, cmd.recipe);
      if (result !== 'ok') return { ok: false, reason: result };
      history?.clear();
      return { ok: true, cost: 0, count: 1 };
    }
    case 'setSoldierRole': {
      if (w.civic) return { ok: false, reason: 'peaceful_mode' };
      if (!Object.prototype.hasOwnProperty.call(TACTICS.roles, cmd.role)) return { ok: false, reason: 'unknown' };
      const s = w.soldiers.find((x) => x.id === cmd.id);
      if (!s) return { ok: false, reason: 'nothing' };
      if (w.convoy || w.fight || w.mission || awaySoldiers(w).has(s.id)) return { ok: false, reason: 'busy' };
      if (s.role === cmd.role) return { ok: false, reason: 'nothing' };
      s.role = cmd.role;
      w.revision++;
      history?.clear();
      return { ok: true, cost: 0, count: 1 };
    }
    case 'equipSoldier': {
      if (w.civic) return { ok: false, reason: 'peaceful_mode' };
      if (!Object.prototype.hasOwnProperty.call(TACTICS.kits, cmd.kit)) return { ok: false, reason: 'unknown' };
      const s = w.soldiers.find((x) => x.id === cmd.id);
      if (!s) return { ok: false, reason: 'nothing' };
      if (w.convoy || w.fight || w.mission || awaySoldiers(w).has(s.id)) return { ok: false, reason: 'busy' };
      if (s.kit === cmd.kit) return { ok: false, reason: 'nothing' };
      const kit = TACTICS.kits[cmd.kit];
      if ('requires' in kit && kit.requires && !w.research.done.includes(kit.requires)) return { ok: false, reason: 'not_researched' };
      const stocked = cmd.kit !== 'standard' && !!w.military?.stock[cmd.kit];
      const cost: Cost = stocked ? {} : kit.cost;
      if (!canAfford(w, cost)) return { ok: false, reason: (cost.money ?? 0) > w.money ? 'no_money' : 'no_resources' };
      if (stocked) useProducedKit(w, cmd.kit as Exclude<SoldierKit, 'standard'>);
      else pay(w, cost);
      s.kit = cmd.kit;
      w.revision++;
      history?.clear();
      return { ok: true, cost: cost.money ?? 0, count: 1 };
    }
    case 'setSquadStance': {
      if (w.civic) return { ok: false, reason: 'peaceful_mode' };
      if (!Object.prototype.hasOwnProperty.call(TACTICS.stances, cmd.stance)) return { ok: false, reason: 'unknown' };
      if (w.fight || w.convoy || w.mission) return { ok: false, reason: 'busy' };
      if (w.squadStance === cmd.stance) return { ok: false, reason: 'nothing' };
      w.squadStance = cmd.stance;
      w.revision++;
      history?.clear();
      return { ok: true, cost: 0, count: 1 };
    }
    case 'focusFire':
      if (w.civic) return { ok: false, reason: 'peaceful_mode' };
      if (!focusFight(w, cmd.enemy)) return { ok: false, reason: 'nothing' };
      history?.clear();
      return { ok: true, cost: 0, count: 1 };
    case 'retreatSquad':
      if (w.civic) return { ok: false, reason: 'peaceful_mode' };
      if (!retreatFight(w)) return { ok: false, reason: 'nothing' };
      history?.clear();
      return { ok: true, cost: 0, count: 1 };
    case 'hireSoldier': {
      if (w.civic) return { ok: false, reason: 'peaceful_mode' };
      if (w.mission) return { ok: false, reason: 'busy' };
      if (w.soldiers.length >= rosterCap(w)) return { ok: false, reason: 'squad_full' };
      if (w.money < SQUAD.hireCost) return { ok: false, reason: 'no_money' };
      w.money -= SQUAD.hireCost;
      w.soldiers.push(newSoldier(w));
      w.revision++;
      history?.clear();
      return { ok: true, cost: SQUAD.hireCost, count: 1 };
    }
    case 'dismissSoldier': {
      if (w.civic) return { ok: false, reason: 'peaceful_mode' };
      const i = w.soldiers.findIndex((s) => s.id === cmd.id);
      if (w.mission) return { ok: false, reason: 'busy' };
      if (i < 0 || cmd.id === PERSONAL_ID) return { ok: false, reason: 'nothing' };
      if (awaySoldiers(w).has(cmd.id)) return { ok: false, reason: 'busy' };
      w.soldiers.splice(i, 1);
      w.revision++;
      return { ok: true, cost: 0, count: 1 };
    }
    case 'upgradeBunker':
      return w.civic ? { ok: false, reason: 'peaceful_mode' } : upgradeBunker(w, cmd.id, history);
    case 'sendExpedition':
      return w.civic ? { ok: false, reason: 'peaceful_mode' } : sendExpedition(w, cmd.x, cmd.y, cmd.soldiers, history);
    case 'assaultSite':
      return w.civic ? { ok: false, reason: 'peaceful_mode' } : assaultSite(w, cmd.site, history);
    case 'assaultBand':
      return w.civic ? { ok: false, reason: 'peaceful_mode' } : assaultBand(w, history);
  }
  history?.begin(w);
  const res = run(w, cmd, history);
  if (res.ok) { history?.commit(); syncTransit(w); }
  return res;
}

/**
 * Вызов отряда на место крушения - как вызов пожарных. Есть бункер или застава - из гаража
 * выезжает броневик, и автобой начнётся, когда он доедет; нет - бой начинается сразу.
 */
function assaultCrash(w: World, history?: History): CommandResult {
  if (!w.crash || w.mission) return { ok: false, reason: 'nothing' };
  if (w.convoy || w.fight) return { ok: false, reason: 'busy' };
  if (readySoldiers(w).length < SQUAD.minSquad) return { ok: false, reason: 'no_squad' };
  if (w.money < PRICES.assault) return { ok: false, reason: 'no_money' };
  const team = readySoldiers(w).slice(0, SQUAD.size);
  if (hasGarage(w)) {
    if (!dispatchConvoy(w, { x: w.crash.x, y: w.crash.y, site: -1 }, team)) return { ok: false, reason: 'no_path' };
  } else startFight(w, 'crash', w.crash, { x: w.crash.x - 1, y: w.crash.y }, team);
  w.money -= PRICES.assault;
  history?.clear();
  return { ok: true, cost: PRICES.assault, count: 1 };
}

/** Штурм найденного гнезда пришельцев: броневик выезжает из гаража. */
function assaultSite(w: World, id: number, history?: History): CommandResult {
  const site = w.sites.find((s) => s.id === id);
  if (!site || site.kind !== 'nest' || !site.found || site.done || w.mission) return { ok: false, reason: 'nothing' };
  if (w.convoy || w.fight) return { ok: false, reason: 'busy' };
  if (!hasGarage(w)) return { ok: false, reason: 'no_bunker' };
  if (readySoldiers(w).length < SQUAD.minSquad) return { ok: false, reason: 'no_squad' };
  if (w.money < PRICES.assault) return { ok: false, reason: 'no_money' };
  if (!dispatchConvoy(w, { x: site.x, y: site.y, site: site.id }, readySoldiers(w).slice(0, SQUAD.size))) return { ok: false, reason: 'no_path' };
  w.money -= PRICES.assault;
  history?.clear();
  return { ok: true, cost: PRICES.assault, count: 1 };
}

/** Выезд на кочующую банду: броневик едет к ней по дорогам; без гаража отряд вступает в бой сразу. */
function assaultBand(w: World, history?: History): CommandResult {
  const b = w.band;
  if (!b || w.mission) return { ok: false, reason: 'nothing' };
  if (w.convoy || w.fight) return { ok: false, reason: 'busy' };
  if (readySoldiers(w).length < SQUAD.minSquad) return { ok: false, reason: 'no_squad' };
  if (w.money < PRICES.assault) return { ok: false, reason: 'no_money' };
  const x = Math.floor(b.x / 100), y = Math.floor(b.y / 100);
  const team = readySoldiers(w).slice(0, SQUAD.size);
  if (hasGarage(w)) {
    if (!dispatchConvoy(w, { x, y, site: BAND_TARGET }, team)) return { ok: false, reason: 'no_path' };
  } else startFight(w, 'band', { x, y }, { x: x - 1, y }, team);
  w.money -= PRICES.assault;
  history?.clear();
  return { ok: true, cost: PRICES.assault, count: 1 };
}

/** Улучшение бункера: деньги и ресурсы сразу, готово через несколько дней. */
function upgradeBunker(w: World, id: string, history?: History): CommandResult {
  const check = checkUpgrade(w, id);
  if (check !== 'ok') return { ok: false, reason: check === 'locked' ? 'not_researched' : check };
  const def = UPGRADE_BY_ID[id];
  if (!canAfford(w, def.cost)) return { ok: false, reason: (def.cost.money ?? 0) > w.money ? 'no_money' : 'no_resources' };
  pay(w, def.cost);
  w.bunker!.work = { id, days: def.days };
  w.revision++;
  history?.clear();
  return { ok: true, cost: def.cost.money ?? 0, count: 1 };
}

/** Экспедиция к клетке (x, y): 1-2 свободных бойца, деньги и еда по расстоянию. */
function sendExpedition(w: World, x: number, y: number, count: number, history?: History): CommandResult {
  const E = WASTELAND.expedition;
  if (!w.bunker) return { ok: false, reason: 'no_bunker' };
  if (!w.research.done.includes(E.tech)) return { ok: false, reason: 'not_researched' };
  if (!tileAt(w, x, y)) return { ok: false, reason: 'out_of_map' };
  const n = Math.max(1, Math.min(E.maxSoldiers, count | 0));
  const scouts = scoutsFor(w, n);
  if (scouts.length < n) return { ok: false, reason: 'no_squad' };
  const cost = expeditionCost(w, x, y);
  if (cost.cells < 1) return { ok: false, reason: 'nothing' };
  if (w.money < cost.money) return { ok: false, reason: 'no_money' };
  if (w.food < cost.food) return { ok: false, reason: 'no_food' };
  w.money -= cost.money;
  w.food -= cost.food;
  launchExpedition(w, x, y, scouts);
  history?.clear();
  return { ok: true, cost: cost.money, count: n };
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

function run(w: World, cmd: Extract<Command, { type: 'buildRoad' | 'placeRoundabout' | 'zone' | 'bulldoze' | 'placeBuilding' }>, h?: History): CommandResult {
  const touch = (idx: number) => {
    h?.touch(w, idx);
    markChanged(w, idx);
  };
  switch (cmd.type) {
    case 'buildRoad': {
      // Проспект ставится парой клеток (pair) или одной клеткой при достройке угла (avenue)
      const avenue = cmd.avenue === true;
      const pair = cmd.pair && (cmd.pair.x !== cmd.x || cmd.pair.y !== cmd.y) ? cmd.pair : null;
      const cells = pair ? [{ x: cmd.x, y: cmd.y }, pair] : [{ x: cmd.x, y: cmd.y }];
      const unit = avenue ? PRICES.avenue : PRICES.road;
      const targets: { x: number; y: number }[] = [];
      // Сначала проверяем все клетки: проспект встаёт целиком или не встаёт вовсе
      for (const c of cells) {
        const t = tileAt(w, c.x, c.y);
        if (!t) return { ok: false, reason: 'out_of_map' };
        if (!exploredAt(w, c.x, c.y)) return { ok: false, reason: 'fog' };
        if (t.terrain === 'water') return { ok: false, reason: 'water' };
        if (t.object === 'road') {
          // Уже проспект - эта клетка пары не мешает, деньги за неё не берём
          if (avenue && t.road === 1) continue;
          return { ok: false, reason: 'nothing' };
        }
        if (irradiated(w, c.x, c.y)) return { ok: false, reason: 'radiation' };
        if (!(t.object === 'none' || t.object === 'tree' || t.object === 'rubble' || (t.object === 'zone' && t.level === 0))) return { ok: false, reason: 'blocked' };
        targets.push(c);
      }
      if (!targets.length) return { ok: false, reason: 'nothing' };
      const price = targets.length * unit;
      if (w.money < price) return { ok: false, reason: 'no_money' };
      for (const c of targets) {
        const t = tileAt(w, c.x, c.y)!;
        touch(c.y * w.size + c.x);
        clearTile(t);
        t.object = 'road';
        t.road = avenue ? 1 : 0;
        reveal(w, c.x, c.y, WASTELAND.reveal.road);
      }
      w.money -= price;
      // Дорога рядом с кольцом меняет его въезды
      syncRoundabouts(w);
      return { ok: true, cost: price, count: targets.length };
    }
    case 'placeRoundabout': {
      const check = canPlaceRoundabout(w, cmd.x, cmd.y, cmd.upgrade === true);
      if (!check.ok) return { ok: false, reason: check.reason };
      // Сначала проверяем деньги: снос домов входит в цену
      if (w.money < check.cost) return { ok: false, reason: 'no_money' };
      // Участки сносим целиком - иначе клетки за блоком остались бы с чужой главной клеткой
      for (const root of check.lots) {
        for (const c of lotCells(w, root)) touch(c);
        releaseLot(w, root);
      }
      for (const i of check.clear) {
        touch(i);
        clearTile(w.tiles[i]);
      }
      for (const i of check.cells) {
        const t = w.tiles[i];
        t.object = 'road';
        t.road = 2;
      }
      w.money -= check.cost;
      for (const i of check.cells) reveal(w, i % w.size, (i / w.size) | 0, WASTELAND.reveal.road);
      w.roundabouts.push({ cell: cmd.y * w.size + cmd.x, arms: check.arms });
      return { ok: true, cost: check.cost, count: check.cells.length };
    }
    case 'zone': {
      const all = [...rectTiles(w, cmd.rect)];
      const cells = all.filter((c) => canZone(w.tiles[c.idx], cmd.zone) && w.explored[c.idx] && !irradiated(w, c.x, c.y));
      if (!cells.length) return { ok: false, reason: all.some((c) => !w.explored[c.idx]) ? 'fog' : all.some((c) => irradiated(w, c.x, c.y)) ? 'radiation' : 'blocked' };
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
      for (const c of cells) reveal(w, c.x, c.y, WASTELAND.reveal.build);
      return { ok: true, cost, count: cells.length };
    }
    case 'bulldoze': {
      const targets = new Set<number>();
      const lots = new Set<number>();
      for (const c of rectTiles(w, cmd.rect)) {
        const t = w.tiles[c.idx];
        if (t.object === 'none' || t.object === 'crash' || !w.explored[c.idx]) continue;
        // Бункер не сносится
        if (t.object === 'building' && BUILDING_BY_ID[t.def!]?.fixed) continue;
        if (t.object === 'zone') {
          // Дом на участке сносится целиком, разметка зоны снимается только под рамкой
          if (t.root >= 0) lots.add(t.root);
          targets.add(c.idx);
        } else if (t.root >= 0) {
          // Многоклеточное здание сносится целиком
          w.tiles.forEach((o, i) => { if (o.root === t.root) targets.add(i); });
        } else targets.add(c.idx);
      }
      if (!targets.size) return { ok: false, reason: 'nothing' };
      // Кольцо - один объект: снос любой его клетки убирает площадь целиком
      const rings = new Set<Roundabout>();
      for (const i of targets) {
        const t = w.tiles[i];
        if (t.object !== 'road' || t.road !== 2) continue;
        const ring = roundaboutAt(w, i);
        if (ring) rings.add(ring);
      }
      for (const ring of rings) {
        const cells = roundaboutCells(w, ring.cell % w.size, (ring.cell / w.size) | 0) ?? [];
        for (const i of cells) targets.add(i);
      }
      w.roundabouts = w.roundabouts.filter((r) => !rings.has(r));
      let cost = 0;
      const roots = new Set<number>();
      for (const i of targets) {
        const t = w.tiles[i];
        if (t.object === 'zone') { if (t.root < 0) cost += bulldozeCost(t); }
        else if (t.root >= 0) { if (!roots.has(t.root)) { roots.add(t.root); cost += bulldozeCost(w.tiles[t.root]); } }
        else cost += bulldozeCost(t);
      }
      for (const r of lots) cost += bulldozeCost(w.tiles[r]);
      // Ограничиваем только платный снос. Возврат за недостроенное здание
      // должен поступать в казну даже при долге, а не обнуляться из-за отрицательного баланса.
      if (cost > 0 && cost > w.money) cost = Math.max(0, w.money);
      for (const r of lots) {
        for (const c of lotCells(w, r)) h?.touch(w, c);
        releaseLot(w, r);
      }
      let metal = 0;
      for (const i of targets) {
        touch(i);
        // Довоенные руины разбирают на металл
        if (w.tiles[i].object === 'ruin') metal += WASTELAND.ruins.metal;
        clearTile(w.tiles[i]);
      }
      w.money -= cost;
      w.resources.metal += metal;
      // Оставшаяся без пары клетка проспекта снова становится улицей
      for (const i of targets) {
        const x = i % w.size, y = (i / w.size) | 0;
        for (const [dx, dy] of DIRS) {
          const nx = x + dx, ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= w.size || ny >= w.size) continue;
          const ni = ny * w.size + nx;
          const n = w.tiles[ni];
          if (n.object !== 'road' || n.road !== 1) continue;
          const pair = DIRS.some(([ax, ay]) => {
            const px = nx + ax, py = ny + ay;
            if (px < 0 || py < 0 || px >= w.size || py >= w.size) return false;
            const o = w.tiles[py * w.size + px];
            return o.object === 'road' && o.road === 1;
          });
          if (!pair) {
            touch(ni);
            n.road = 0;
          }
        }
      }
      syncRoundabouts(w);
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
          t.build = def.buildDays;
        }
      }
      pay(w, def.cost);
      reveal(w, cmd.x + (def.size >> 1), cmd.y + (def.size >> 1), WASTELAND.reveal.build);
      return res;
    }
  }
}
