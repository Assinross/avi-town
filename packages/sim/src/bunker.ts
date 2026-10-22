// Бункер: казарма отряда, улучшения и гараж броневика. Броневик выезжает из гаража (бункер
// или застава) кратчайшим по времени путём - по дорогам быстро, по бездорожью медленно, вброд
// и сквозь руины ещё медленнее, сквозь дома не проезжает - и на месте начинает бой. После боя едет обратно.

import { BUILDING_BY_ID, UPGRADE_BY_ID, WASTELAND, type BunkerUpgradeDef } from '@avi/data';
import { reveal } from './explore';
import { Heap } from './heap';
import { readySoldiers } from './squad';
import { startMission } from './tactical';
import type { BunkerState, Convoy, ConvoyTarget, Soldier, Tile, World } from './world';

const DIRS: [number, number][] = [[1, 0], [-1, 0], [0, 1], [0, -1]];

/** Центральная клетка бункера 3x3. */
export function bunkerCenter(w: World): { x: number; y: number } | null {
  if (!w.bunker) return null;
  const r = w.bunker.root;
  return { x: (r % w.size) + 1, y: Math.floor(r / w.size) + 1 };
}

export const hasUpgrade = (w: World, id: string) => !!w.bunker?.upgrades.includes(id);

function upgrades(w: World): BunkerUpgradeDef[] {
  return (w.bunker?.upgrades ?? []).map((id) => UPGRADE_BY_ID[id]).filter(Boolean);
}

/** Содержание улучшений бункера в ¢ в день. */
export function bunkerUpkeep(w: World): number {
  return upgrades(w).reduce((n, u) => n + u.upkeep, 0);
}

/** Прибавка медблока к скорости лечения. */
export function bunkerHeal(w: World): number {
  return upgrades(w).reduce((n, u) => n + (u.heal ?? 0), 0);
}

/** Радар командного пункта бункера. */
export const bunkerRadar = (w: World) => upgrades(w).some((u) => u.radar);

/** Радиус тумана вокруг бункера: база плюс командный пункт. */
export function bunkerReveal(w: World): number {
  return upgrades(w).reduce((n, u) => n + (u.reveal ?? 0), WASTELAND.reveal.bunker);
}

/** Радиус убежища: 0 - убежища нет. */
export function shelterRadius(w: World): number {
  return upgrades(w).reduce((n, u) => Math.max(n, u.shelter ?? 0), 0);
}

export type UpgradeCheck = 'ok' | 'no_bunker' | 'busy' | 'nothing' | 'not_researched' | 'locked';

/** Можно ли начать улучшение (без проверки денег - её делает команда). */
export function checkUpgrade(w: World, id: string): UpgradeCheck {
  const def = UPGRADE_BY_ID[id];
  if (!w.bunker) return 'no_bunker';
  if (!def || w.bunker.upgrades.includes(id)) return 'nothing';
  if (w.bunker.work) return 'busy';
  if (def.after && !w.bunker.upgrades.includes(def.after)) return 'locked';
  if (def.tech && !w.research.done.includes(def.tech)) return 'not_researched';
  return 'ok';
}

/** День бункера: стройка улучшения. Командный пункт сразу расширяет круг разведки. */
export function bunkerDay(w: World) {
  const b = w.bunker;
  if (!b?.work) return;
  if (--b.work.days > 0) return;
  const id = b.work.id;
  b.upgrades.push(id);
  b.work = null;
  // Улучшение видно на здании: перерисовать бункер
  w.changes.push(b.root);
  w.revision++;
  w.events.push({ type: 'bunkerUpgraded', id });
  if (UPGRADE_BY_ID[id]?.reveal) {
    const c = bunkerCenter(w)!;
    reveal(w, c.x, c.y, bunkerReveal(w));
  }
}

export function newBunker(root: number): BunkerState {
  return { root, upgrades: [], work: null };
}

// --- Броневик ---------------------------------------------------------------------------------

/** Главные клетки достроенных гаражей: бункер и заставы. */
export function garages(w: World): number[] {
  const out: number[] = [];
  w.tiles.forEach((t, i) => {
    if (t.object === 'building' && t.root === i && t.build === 0 && BUILDING_BY_ID[t.def!]?.garage) out.push(i);
  });
  return out;
}

/**
 * Сколько тиков броневик едет через клетку; -1 - не проехать (дома и здания).
 * Мостов нет: реку и озеро броневик переходит вброд, сквозь руины пробирается - медленно.
 */
function cellCost(t: Tile, fast: boolean): number {
  const C = WASTELAND.convoy;
  const off = fast ? C.fastOffroadTicks : C.offroadTicks;
  if (t.terrain === 'water') return off * C.waterFactor;
  if (t.object === 'road') return fast ? C.fastRoadTicks : C.roadTicks;
  if (t.object === 'building' || (t.object === 'zone' && t.level > 0)) return -1;
  if (t.object === 'ruin') return off * C.ruinFactor;
  return off;
}

/** Клетки вокруг здания по сторонам: отсюда броневик выезжает. */
function exits(w: World, root: number): number[] {
  const size = BUILDING_BY_ID[w.tiles[root].def!]?.size ?? 1;
  const x0 = root % w.size, y0 = Math.floor(root / w.size);
  const out: number[] = [];
  for (let dy = -1; dy <= size; dy++) {
    for (let dx = -1; dx <= size; dx++) {
      const inside = dx >= 0 && dy >= 0 && dx < size && dy < size;
      const corner = (dx < 0 || dx >= size) && (dy < 0 || dy >= size);
      const x = x0 + dx, y = y0 + dy;
      if (inside || corner || x < 0 || y < 0 || x >= w.size || y >= w.size) continue;
      out.push(y * w.size + x);
    }
  }
  return out;
}

/**
 * Маршрут броневика от ближайшего по времени гаража до цели: путь по клеткам (первая - у гаража,
 * последняя - цель) и время в тиках. null - не доехать.
 */
export function convoyRoute(w: World, target: ConvoyTarget, fast: boolean): { path: number[]; ticks: number } | null {
  const n = w.size * w.size;
  const dist = new Float64Array(n).fill(Infinity);
  const prev = new Int32Array(n).fill(-1);
  const heap = new Heap();
  const goal = target.y * w.size + target.x;
  for (const g of garages(w)) {
    for (const c of exits(w, g)) {
      const cost = cellCost(w.tiles[c], fast);
      if (cost < 0 || dist[c] <= cost) continue;
      dist[c] = cost;
      prev[c] = -1;
      heap.push(cost, c);
    }
  }
  while (heap.size) {
    const [d, c] = heap.pop();
    if (d > dist[c]) continue;
    if (c === goal) break;
    const x = c % w.size, y = Math.floor(c / w.size);
    for (const [dx, dy] of DIRS) {
      const nx = x + dx, ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= w.size || ny >= w.size) continue;
      const ni = ny * w.size + nx;
      // Цель - тарелка или гнездо: на неё броневик подъезжает, хоть клетка и занята
      const cost = ni === goal ? cellCost({ ...w.tiles[ni], object: 'none' }, fast) : cellCost(w.tiles[ni], fast);
      if (cost < 0 || d + cost >= dist[ni]) continue;
      dist[ni] = d + cost;
      prev[ni] = c;
      heap.push(d + cost, ni);
    }
  }
  if (dist[goal] === Infinity) return null;
  const path = [goal];
  while (prev[path[path.length - 1]] >= 0) path.push(prev[path[path.length - 1]]);
  return { path: path.reverse(), ticks: dist[goal] };
}

/** Есть ли откуда выезжать: без бункера и застав бой начинается сразу, как раньше. */
export const hasGarage = (w: World) => garages(w).length > 0;

/** Отправить броневик: команда уже проверила деньги и бойцов. false - не доехать. */
export function dispatchConvoy(w: World, target: ConvoyTarget, team: Soldier[]): boolean {
  const fast = upgrades(w).some((u) => u.fast);
  const route = convoyRoute(w, target, fast);
  if (!route) return false;
  w.convoy = { path: route.path, seg: 0, acc: 0, phase: 'out', target, soldiers: team.map((s) => s.id), fast };
  w.revision++;
  return true;
}

/** Сколько тиков осталось ехать до конца маршрута. */
export function convoyEta(w: World, c: Convoy): number {
  let ticks = -c.acc;
  for (let i = c.seg; i < c.path.length; i++) ticks += Math.max(1, cellCost(w.tiles[c.path[i]], c.fast));
  return Math.max(0, ticks);
}

/** Цель выезда ещё на месте: тарелка не улетела, гнездо не зачищено. */
function targetAlive(w: World, t: ConvoyTarget): boolean {
  if (t.site >= 0) return w.sites.some((s) => s.id === t.site && !s.done);
  return !!w.crash && w.crash.x === t.x && w.crash.y === t.y;
}

/** Повернуть броневик домой от того места, где он сейчас. */
export function turnBack(c: Convoy) {
  c.path = c.path.slice(0, c.seg + 1).reverse();
  c.seg = 0;
  c.acc = 0;
  c.phase = 'back';
}

/** Сколько тиков броневик проводит в текущей клетке маршрута (клетка цели - как пустая земля). */
export function convoyStepTicks(w: World, c: Convoy): number {
  const t = w.tiles[c.path[c.seg]];
  return Math.max(1, cellCost(c.phase === 'out' && c.seg === c.path.length - 1 ? { ...t, object: 'none' } : t, c.fast));
}

/** Тик броневика: клетка за клеткой; у цели - бой, дома - бойцы снова в бункере. */
export function convoyTick(w: World) {
  const c = w.convoy;
  if (!c) return;
  if (c.phase === 'out' && !targetAlive(w, c.target)) {
    turnBack(c);
    w.events.push({ type: 'convoyTurned' });
  }
  if (++c.acc < convoyStepTicks(w, c)) return;
  c.acc = 0;
  if (c.seg < c.path.length - 1) {
    c.seg++;
    // Экипаж видит дорогу вокруг: туман по пути отступает на клетку
    const cell = c.path[c.seg];
    reveal(w, cell % w.size, Math.floor(cell / w.size), WASTELAND.reveal.convoy);
    w.revision++;
    return;
  }
  if (c.phase === 'back') {
    w.convoy = null;
    w.revision++;
    w.events.push({ type: 'convoyBack' });
    return;
  }
  // Приехали: бойцы высаживаются со стороны, откуда подъехал броневик
  const from = c.path[Math.max(0, c.path.length - 2)];
  const team = w.soldiers.filter((s) => c.soldiers.includes(s.id) && s.heal <= 0);
  const t = c.target;
  const site = t.site >= 0 ? w.sites.find((s) => s.id === t.site) : undefined;
  const ufo = site ? WASTELAND.sites.nest.ufo : w.crash!.ufo;
  w.events.push({ type: 'convoyArrived' });
  startMission(w, { x: t.x, y: t.y, ufo, site: site?.id }, { x: from % w.size, y: Math.floor(from / w.size) }, team);
}

/** Свободные бойцы для выезда: здоровые и в бункере, не больше штатного отряда. */
export function convoyTeam(w: World, size: number): Soldier[] {
  return readySoldiers(w).slice(0, size);
}
