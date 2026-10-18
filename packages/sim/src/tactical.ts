// Тактический бой на месте крушения прямо на улице города (срез 5, первая версия).
// Поле - квадрат AREA x AREA клеток города вокруг тарелки, каждая клетка города = CELLS x CELLS боевых.
// До контакта бойцы ходят в реальном времени, после - пошагово по правилам XCOM.

import { ALIEN_BY_ID, SQUAD, UFO_BY_ID } from '@avi/data';
import { removeCrash } from './commands';
import { nextInt } from './rng';
import { tileAt, type World } from './world';

export const CELLS = 4;
const AREA_RADIUS = 3; // клеток города от тарелки
const EXPLORE_TICKS_PER_CELL = 3;

/** 0 - свободно, 1 - низкое укрытие (не пройти, видно), 2 - стена (не пройти, не видно). */
export type CellKind = 0 | 1 | 2;

export interface TacUnit {
  id: number;
  side: 'xcom' | 'alien';
  kind: string; // 'soldier' или id пришельца
  name: string;
  x: number;
  y: number;
  hp: number;
  maxHp: number;
  aim: number;
  mobility: number;
  damage: [number, number];
  ap: number;
  /** Путь в режиме разведки (реальное время). */
  path: [number, number][];
  moveAcc: number;
  /** Личный боец игрока. */
  personal?: boolean;
}

export interface Mission {
  ufo: string;
  /** Левый верхний угол поля в глобальных боевых клетках (клетка города * CELLS). */
  ox: number;
  oy: number;
  w: number;
  h: number;
  cells: CellKind[];
  units: TacUnit[];
  phase: 'explore' | 'turn' | 'result';
  turn: number;
  result: 'win' | 'lose' | 'retreat' | null;
  /** Последнее событие боя для журнала в интерфейсе. */
  log: string[];
}

export type TacCommand =
  | { type: 'tacMove'; unit: number; x: number; y: number }
  | { type: 'tacShoot'; unit: number; target: number }
  | { type: 'tacEndTurn' }
  | { type: 'tacRetreat' }
  | { type: 'tacFinish' };

export type TacResult = { ok: true } | { ok: false; reason: 'no_mission' | 'not_your_turn' | 'no_ap' | 'unreachable' | 'no_los' | 'dead' };

const cellAt = (m: Mission, x: number, y: number): CellKind => (x < 0 || y < 0 || x >= m.w || y >= m.h ? 2 : m.cells[y * m.w + x]);

// --- Построение поля из клеток города --------------------------------------------------------

function fillTile(w: World, m: Mission, tx: number, ty: number) {
  const t = tileAt(w, tx, ty);
  const bx = (tx - Math.floor(m.ox / CELLS)) * CELLS, by = (ty - Math.floor(m.oy / CELLS)) * CELLS;
  const set = (cx: number, cy: number, k: CellKind) => {
    const x = bx + cx, y = by + cy;
    if (x >= 0 && y >= 0 && x < m.w && y < m.h) m.cells[y * m.w + x] = Math.max(m.cells[y * m.w + x], k) as CellKind;
  };
  const rect = (x0: number, y0: number, x1: number, y1: number, k: CellKind) => {
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) set(x, y, k);
  };
  if (!t) return rect(0, 0, 3, 3, 2);
  const v = t.variant;
  if (t.terrain === 'water') return rect(0, 0, 3, 3, 1);
  switch (t.object) {
    case 'ruin': return rect(0, 0, 2, 2, 2);
    case 'building': return rect(0, 0, 3, 3, 2);
    case 'crash': return rect(0, 0, 3, 3, 2);
    case 'tree': return set(1 + (v & 1), 1 + ((v >> 1) & 1), 1);
    case 'rubble': set(v & 3, (v >> 2) & 3, 1); set((v >> 4) & 3, (v >> 6) & 3, 1); return;
    case 'road':
      // Брошенная машина - низкое укрытие посреди улицы
      if (nextInt(w.rng, 100) < 35) {
        const along = nextInt(w.rng, 2);
        if (along) { set(1, 1, 1); set(2, 1, 1); } else { set(1, 1, 1); set(1, 2, 1); }
      }
      return;
    case 'zone':
      if (t.level === 0) return;
      if (t.zone === 'A') return set(3, 0, 1);
      if (t.level === 1) { rect(1, 1, 2, 2, 2); set(0, 3, 1); return; }
      return rect(0, 0, 2, 2, 2);
    default:
      if (t.terrain === 'rock' && (v & 3) === 0) set(2, 2, 1);
  }
}

function freeCells(m: Mission): number[] {
  const out: number[] = [];
  m.cells.forEach((c, i) => { if (c === 0) out.push(i); });
  return out;
}

export function startMission(w: World): TacResult {
  const c = w.crash;
  if (!c) return { ok: false, reason: 'no_mission' };
  const tx0 = c.x - AREA_RADIUS, ty0 = c.y - AREA_RADIUS;
  const size = (AREA_RADIUS * 2 + 1) * CELLS;
  const m: Mission = {
    ufo: c.ufo, ox: tx0 * CELLS, oy: ty0 * CELLS, w: size, h: size, cells: new Array(size * size).fill(0),
    units: [], phase: 'explore', turn: 1, result: null, log: [],
  };
  for (let ty = ty0; ty <= c.y + AREA_RADIUS; ty++) for (let tx = tx0; tx <= c.x + AREA_RADIUS; tx++) fillTile(w, m, tx, ty);

  // Отряд высаживается с той стороны поля, что ближе к центру карты (откуда приехали)
  const center = (AREA_RADIUS * CELLS) + CELLS / 2;
  const fromLeft = c.x > w.size / 2, fromTop = c.y > w.size / 2;
  const free = freeCells(m);
  const edgeScore = (i: number) => {
    const x = i % m.w, y = Math.floor(i / m.w);
    return (fromLeft ? x : m.w - 1 - x) + (fromTop ? y : m.h - 1 - y);
  };
  const deploy = [...free].sort((a, b) => edgeScore(a) - edgeScore(b) || a - b);
  let id = 1;
  const s = SQUAD.soldier;
  for (let k = 0; k < SQUAD.size && k < deploy.length; k++) {
    const i = deploy[k];
    const name = SQUAD.names[(w.day * 7 + k * 5) % SQUAD.names.length];
    m.units.push({
      id: id++, side: 'xcom', kind: 'soldier', name: k === 0 ? `${name} (вы)` : name, x: i % m.w, y: Math.floor(i / m.w),
      hp: s.hp, maxHp: s.hp, aim: s.aim, mobility: s.mobility, damage: [...s.damage] as [number, number], ap: 2, path: [], moveAcc: 0, personal: k === 0,
    });
  }
  // Экипаж - вокруг тарелки, на свободных клетках ближе всего к центру поля
  const near = [...free].sort((a, b) => {
    const da = Math.abs((a % m.w) - center) + Math.abs(Math.floor(a / m.w) - center);
    const db = Math.abs((b % m.w) - center) + Math.abs(Math.floor(b / m.w) - center);
    return da - db || a - b;
  });
  const taken = new Set(deploy.slice(0, SQUAD.size));
  let slot = 0;
  for (const alienId of UFO_BY_ID[c.ufo]?.crew ?? ['Sectoid']) {
    const def = ALIEN_BY_ID[alienId];
    while (slot < near.length && taken.has(near[slot])) slot++;
    const i = near[Math.min(slot + nextInt(w.rng, 3), near.length - 1)];
    taken.add(i);
    slot += 2;
    m.units.push({
      id: id++, side: 'alien', kind: def.id, name: def.nameKey, x: i % m.w, y: Math.floor(i / m.w),
      hp: def.hp, maxHp: def.hp, aim: def.aim, mobility: def.mobility, damage: [...def.damage] as [number, number], ap: 2, path: [], moveAcc: 0,
    });
  }
  m.log.push('Отряд на месте. Пришельцы не замечены - осторожно продвигайтесь');
  if (contact(m)) {
    m.phase = 'turn';
    scamper(w, m);
    startXcomTurn(m);
    m.log.push('Пришельцы уже на виду и бросились в укрытия - пошаговый бой. Ход 1');
  }
  w.mission = m;
  w.speed = 0;
  w.revision++;
  return { ok: true };
}

// --- Обзор, укрытия, шанс попадания ----------------------------------------------------------

export function lineOfSight(m: Mission, x0: number, y0: number, x1: number, y1: number): boolean {
  let x = x0, y = y0;
  const dx = Math.abs(x1 - x0), dy = -Math.abs(y1 - y0);
  const sx = x0 < x1 ? 1 : -1, sy = y0 < y1 ? 1 : -1;
  let err = dx + dy;
  while (x !== x1 || y !== y1) {
    const e2 = 2 * err;
    if (e2 >= dy) { err += dy; x += sx; }
    if (e2 <= dx) { err += dx; y += sy; }
    if ((x !== x1 || y !== y1) && cellAt(m, x, y) === 2) return false;
  }
  return true;
}

const dist = (a: { x: number; y: number }, b: { x: number; y: number }) => Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y));

export function canSee(m: Mission, a: TacUnit, b: TacUnit): boolean {
  return dist(a, b) <= SQUAD.sightCells && lineOfSight(m, a.x, a.y, b.x, b.y);
}

/** Укрытие цели от стрелка: соседняя с целью клетка в сторону стрелка. */
export function coverOf(m: Mission, target: TacUnit, from: TacUnit): 0 | 20 | 40 {
  const sx = Math.sign(from.x - target.x), sy = Math.sign(from.y - target.y);
  let best: CellKind = 0;
  if (sx) best = Math.max(best, cellAt(m, target.x + sx, target.y)) as CellKind;
  if (sy) best = Math.max(best, cellAt(m, target.x, target.y + sy)) as CellKind;
  return best === 2 ? 40 : best === 1 ? 20 : 0;
}

export function hitChance(m: Mission, shooter: TacUnit, target: TacUnit): number {
  const d = dist(shooter, target);
  let chance = shooter.aim - coverOf(m, target, shooter);
  if (d <= 3) chance += 15;
  if (d > 10) chance -= (d - 10) * 3;
  return Math.max(5, Math.min(95, chance));
}

/** Какие клетки видит отряд (для тумана войны). */
export function visibleCells(m: Mission, side: 'xcom' | 'alien' = 'xcom'): Uint8Array {
  const vis = new Uint8Array(m.w * m.h);
  const eyes = m.units.filter((u) => u.side === side && u.hp > 0);
  for (let y = 0; y < m.h; y++) {
    for (let x = 0; x < m.w; x++) {
      for (const e of eyes) {
        if (Math.max(Math.abs(e.x - x), Math.abs(e.y - y)) <= SQUAD.sightCells && lineOfSight(m, e.x, e.y, x, y)) {
          vis[y * m.w + x] = 1;
          break;
        }
      }
    }
  }
  return vis;
}

// --- Перемещение -----------------------------------------------------------------------------

const occupied = (m: Mission, x: number, y: number, except?: TacUnit) => m.units.some((u) => u !== except && u.hp > 0 && u.x === x && u.y === y);
/** Сквозь своих проходить можно (как в XCOM), сквозь врагов - нет. */
const blockedByEnemy = (m: Mission, x: number, y: number, me: TacUnit) => m.units.some((u) => u.side !== me.side && u.hp > 0 && u.x === x && u.y === y);

/** Расстояния по клеткам (8 направлений, без срезания углов стен) от юнита. */
export function distances(m: Mission, u: TacUnit, limit = 99): Int16Array {
  const d = new Int16Array(m.w * m.h).fill(-1);
  d[u.y * m.w + u.x] = 0;
  const queue = [u.y * m.w + u.x];
  for (let qi = 0; qi < queue.length; qi++) {
    const c = queue[qi];
    const cx = c % m.w, cy = Math.floor(c / m.w);
    if (d[c] >= limit) continue;
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        if (!dx && !dy) continue;
        const nx = cx + dx, ny = cy + dy;
        if (cellAt(m, nx, ny) !== 0 || blockedByEnemy(m, nx, ny, u)) continue;
        if (dx && dy && (cellAt(m, cx + dx, cy) !== 0 || cellAt(m, cx, cy + dy) !== 0)) continue;
        const ni = ny * m.w + nx;
        if (d[ni] >= 0) continue;
        d[ni] = d[c] + 1;
        queue.push(ni);
      }
    }
  }
  return d;
}

function pathTo(m: Mission, u: TacUnit, tx: number, ty: number): [number, number][] | null {
  const d = distances(m, u);
  let c = ty * m.w + tx;
  if (d[c] < 0 || occupied(m, tx, ty, u)) return null;
  const path: [number, number][] = [];
  while (d[c] > 0) {
    const cx = c % m.w, cy = Math.floor(c / m.w);
    path.push([cx, cy]);
    let next = -1;
    for (let dy = -1; dy <= 1 && next < 0; dy++) {
      for (let dx = -1; dx <= 1 && next < 0; dx++) {
        const nx = cx + dx, ny = cy + dy;
        if (nx < 0 || ny < 0 || nx >= m.w || ny >= m.h) continue;
        if (d[ny * m.w + nx] === d[c] - 1) next = ny * m.w + nx;
      }
    }
    c = next;
  }
  return path.reverse();
}

/** Сколько очков действия стоит дойти: 1 - в пределах подвижности, 2 - рывок, -1 - не дойти. */
export function moveCost(m: Mission, u: TacUnit, x: number, y: number, d = distances(m, u)): number {
  const n = d[y * m.w + x];
  if (n <= 0 || occupied(m, x, y, u)) return -1;
  if (n <= u.mobility) return 1;
  if (n <= u.mobility * 2) return 2;
  return -1;
}

// --- Команды ---------------------------------------------------------------------------------

function log(m: Mission, text: string) {
  m.log.push(text);
  if (m.log.length > 6) m.log.shift();
}

/** Мировые координаты (сотые доли клетки города) центра боевой клетки - для эффектов. */
function fxPos(m: Mission, x: number, y: number) {
  return { x: ((m.ox + x + 0.5) * 100) / CELLS, y: ((m.oy + y + 0.5) * 100) / CELLS };
}

function shoot(w: World, m: Mission, a: TacUnit, b: TacUnit): boolean {
  const chance = hitChance(m, a, b);
  const hit = nextInt(w.rng, 100) < chance;
  const from = fxPos(m, a.x, a.y), to = fxPos(m, b.x, b.y);
  w.fx.push({ type: 'tacShot', fromX: from.x, fromY: from.y, toX: to.x, toY: to.y, hit, alien: a.side === 'alien' });
  if (hit) {
    const dmg = a.damage[0] + nextInt(w.rng, a.damage[1] - a.damage[0] + 1);
    b.hp = Math.max(0, b.hp - dmg);
    log(m, `${a.side === 'xcom' ? a.name : 'Пришелец'} попадает (${chance}%): -${dmg}${b.hp === 0 ? ', цель уничтожена' : ''}`);
    if (b.hp === 0) w.fx.push({ type: 'explosion', x: to.x, y: to.y, big: false });
  } else {
    log(m, `${a.side === 'xcom' ? a.name : 'Пришелец'} промахивается (${chance}%)`);
  }
  a.ap = 0;
  return hit;
}

function checkEnd(w: World, m: Mission) {
  if (!m.units.some((u) => u.side === 'alien' && u.hp > 0)) {
    m.phase = 'result';
    m.result = 'win';
    log(m, 'Все пришельцы уничтожены. Место крушения под контролем');
  } else if (!m.units.some((u) => u.side === 'xcom' && u.hp > 0)) {
    m.phase = 'result';
    m.result = 'lose';
    log(m, 'Отряд погиб');
  }
}

function contact(m: Mission): boolean {
  const xcom = m.units.filter((u) => u.side === 'xcom' && u.hp > 0);
  return m.units.some((a) => a.side === 'alien' && a.hp > 0 && xcom.some((s) => canSee(m, s, a)));
}

function startXcomTurn(m: Mission) {
  for (const u of m.units) {
    u.ap = u.hp > 0 ? 2 : 0;
    u.path = [];
  }
}

export function applyTactical(w: World, cmd: TacCommand): TacResult {
  const m = w.mission;
  if (!m) return { ok: false, reason: 'no_mission' };
  w.revision++;
  switch (cmd.type) {
    case 'tacFinish':
      if (m.phase !== 'result') return { ok: false, reason: 'not_your_turn' };
      finish(w, m);
      return { ok: true };
    case 'tacRetreat':
      m.phase = 'result';
      m.result = 'retreat';
      log(m, 'Отряд отступил');
      return { ok: true };
    case 'tacEndTurn':
      if (m.phase !== 'turn') return { ok: false, reason: 'not_your_turn' };
      alienTurn(w, m);
      checkEnd(w, m);
      if (m.phase === 'turn') {
        m.turn++;
        startXcomTurn(m);
        log(m, `Ход ${m.turn}`);
      }
      return { ok: true };
    case 'tacMove': {
      const u = m.units.find((x) => x.id === cmd.unit);
      if (!u || u.side !== 'xcom' || u.hp <= 0) return { ok: false, reason: 'dead' };
      if (m.phase === 'explore') {
        const path = pathTo(m, u, cmd.x, cmd.y);
        if (!path || !path.length) return { ok: false, reason: 'unreachable' };
        u.path = path;
        u.moveAcc = 0;
        return { ok: true };
      }
      if (m.phase !== 'turn') return { ok: false, reason: 'not_your_turn' };
      const cost = moveCost(m, u, cmd.x, cmd.y);
      if (cost < 0) return { ok: false, reason: 'unreachable' };
      if (cost > u.ap) return { ok: false, reason: 'no_ap' };
      u.x = cmd.x;
      u.y = cmd.y;
      u.ap -= cost;
      return { ok: true };
    }
    case 'tacShoot': {
      if (m.phase !== 'turn') return { ok: false, reason: 'not_your_turn' };
      const a = m.units.find((x) => x.id === cmd.unit), b = m.units.find((x) => x.id === cmd.target);
      if (!a || !b || a.hp <= 0 || b.hp <= 0 || a.side !== 'xcom' || b.side !== 'alien') return { ok: false, reason: 'dead' };
      if (a.ap < 1) return { ok: false, reason: 'no_ap' };
      if (!canSee(m, a, b)) return { ok: false, reason: 'no_los' };
      shoot(w, m, a, b);
      checkEnd(w, m);
      return { ok: true };
    }
  }
}

/** Тик боя: движение в режиме разведки и переход в пошаговый режим при контакте. */
export function tacticalTick(w: World) {
  const m = w.mission;
  if (!m || m.phase !== 'explore') return;
  let moved = false;
  for (const u of m.units) {
    if (u.side !== 'xcom' || !u.path.length) continue;
    if (++u.moveAcc < EXPLORE_TICKS_PER_CELL) continue;
    u.moveAcc = 0;
    const [nx, ny] = u.path[0];
    // Конечная клетка занята (туда пришёл другой боец) - останавливаемся перед ней
    if (u.path.length === 1 && occupied(m, nx, ny, u)) {
      u.path = [];
      continue;
    }
    u.path.shift();
    u.x = nx;
    u.y = ny;
    moved = true;
  }
  if (moved) w.revision++;
  if (contact(m)) {
    m.phase = 'turn';
    scamper(w, m);
    startXcomTurn(m);
    log(m, 'Контакт! Пришельцы заметили отряд и бросились в укрытия. Ход 1');
    w.revision++;
  }
}

// --- ИИ пришельцев ---------------------------------------------------------------------------

/**
 * Перебежка в клетку с лучшим укрытием от ближайшего бойца.
 * scamper - рывок при обнаружении (как в XCOM): только укрытие, не сближаясь.
 */
function coverMove(w: World, m: Mission, a: TacUnit, scamper: boolean) {
  const enemies = m.units.filter((u) => u.side === 'xcom' && u.hp > 0);
  if (!enemies.length) return;
  const d = distances(m, a, a.mobility);
  let bestCell = -1, bestScore = -1e9;
  for (let i = 0; i < d.length; i++) {
    if (d[i] < 0 || d[i] > a.mobility || occupied(m, i % m.w, Math.floor(i / m.w), a)) continue;
    const probe: TacUnit = { ...a, x: i % m.w, y: Math.floor(i / m.w) };
    const nearest = enemies.reduce((p, s) => (dist(s, probe) < dist(p, probe) ? s : p));
    const cover = enemies.reduce((c, s) => Math.min(c, coverOf(m, probe, s)), 40);
    const score = scamper
      ? cover * 3 + coverOf(m, probe, nearest) - Math.abs(dist(probe, nearest) - 8) + nextInt(w.rng, 3)
      : coverOf(m, probe, nearest) * 2 - dist(probe, nearest) + nextInt(w.rng, 4);
    if (score > bestScore) { bestScore = score; bestCell = i; }
  }
  if (bestCell >= 0) {
    a.x = bestCell % m.w;
    a.y = Math.floor(bestCell / m.w);
  }
}

/** Пришельцы при обнаружении разбегаются по укрытиям. */
function scamper(w: World, m: Mission) {
  for (const a of m.units) if (a.side === 'alien' && a.hp > 0) coverMove(w, m, a, true);
}

function alienTurn(w: World, m: Mission) {
  const xcom = () => m.units.filter((u) => u.side === 'xcom' && u.hp > 0);
  for (const a of m.units) {
    if (a.side !== 'alien' || a.hp <= 0) continue;
    a.ap = 2;
    const best = () => {
      let target: TacUnit | null = null, chance = 0;
      for (const s of xcom()) {
        if (!canSee(m, a, s)) continue;
        const c = hitChance(m, a, s);
        if (c > chance) { chance = c; target = s; }
      }
      return { target, chance };
    };
    let shot = best();
    if (shot.target && shot.chance >= 45) {
      shoot(w, m, a, shot.target);
      continue;
    }
    if (!xcom().length) break;
    coverMove(w, m, a, false);
    a.ap = 1;
    shot = best();
    if (shot.target && shot.chance >= 25) shoot(w, m, a, shot.target);
    if (!xcom().length) break;
  }
}

// --- Итог ------------------------------------------------------------------------------------

function finish(w: World, m: Mission) {
  const lost = m.units.filter((u) => u.side === 'xcom' && u.hp <= 0).length;
  const replace = lost * SQUAD.replacementCost;
  w.money -= replace;
  if (m.result === 'win') {
    const salvage = UFO_BY_ID[m.ufo]?.salvage ?? {};
    w.money += salvage.money ?? 0;
    w.resources.alloys += salvage.alloys ?? 0;
    w.resources.elerium += salvage.elerium ?? 0;
    w.resources.fragments += salvage.fragments ?? 0;
    removeCrash(w);
    w.events.push({ type: 'crashCleared', ufo: m.ufo, salvage, lost });
  } else {
    w.events.push({ type: 'missionFailed', ufo: m.ufo, lost, retreat: m.result === 'retreat' });
  }
  w.mission = null;
  w.revision++;
}
