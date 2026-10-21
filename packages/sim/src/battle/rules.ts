// Обзор, укрытия, шанс попадания и перемещение по клеткам боя.

import { ALIEN_BY_ID, BATTLE, COVER_BY_ID, SQUAD } from '@avi/data';
import { cellAt, propAt, solidPropAt } from './map';
import type { CoverLevel, CoverProp, Mission, TacUnit } from './types';

/** Четыре стороны клетки; диагонали укрытия не дают. */
const SIDES: [number, number][] = [[0, -1], [1, 0], [0, 1], [-1, 0]];

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

export const dist = (a: { x: number; y: number }, b: { x: number; y: number }) => Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y));

/** Дальность обзора юнита: присевший видит вполовину меньше. */
export function sightOf(u: TacUnit): number {
  return u.hunkered ? BATTLE.hunkerSightCells : BATTLE.sightCells;
}

export function canSee(m: Mission, a: TacUnit, b: TacUnit): boolean {
  return dist(a, b) <= sightOf(a) && lineOfSight(m, a.x, a.y, b.x, b.y);
}

/** Укрытие самого пропса с учётом состояния: обломки дают на низкое укрытие меньше, разрушенный не даёт ничего. */
function propCover(p: CoverProp): number {
  const def = COVER_BY_ID[p.kind]?.cover ?? 0;
  return p.state === 'collapsed' ? 0 : p.state === 'broken' ? def - BATTLE.coverLow : def;
}

/** Укрытие одной клетки: максимум из террейна и пропса. */
function coverAt(m: Mission, x: number, y: number): number {
  const terrain = cellAt(m, x, y);
  const base = terrain === 2 ? BATTLE.coverHigh : terrain === 1 ? BATTLE.coverLow : 0;
  const p = propAt(m, x, y);
  return p ? Math.max(base, Math.max(0, propCover(p))) : base;
}

/**
 * Укрытие цели от стрелка: только клетки со стороны стрелка - с другого бока это фланг.
 * При хункере бонус удваивается. Диагональному стрелку подходит укрытие по любой из осей.
 */
export function coverOf(m: Mission, target: TacUnit, from: TacUnit): CoverLevel {
  const dx = Math.sign(from.x - target.x), dy = Math.sign(from.y - target.y);
  const sides: [number, number][] = dx || dy ? [[dx, 0], [0, dy]] : SIDES;
  let best = 0;
  for (const [sx, sy] of sides) {
    if (!sx && !sy) continue;
    best = Math.max(best, coverAt(m, target.x + sx, target.y + sy));
  }
  if (target.hunkered && best > 0) best = Math.min(80, best * BATTLE.hunkerMultiplier);
  return best as CoverLevel;
}

/**
 * Пропс, давший цели максимальное укрытие со стороны стрелка: те же стороны, что у coverOf.
 * Разрушенный пропс укрытия не даёт и не возвращается - в него и уходит урон при промахе.
 */
export function coverPropOf(m: Mission, target: TacUnit, from: TacUnit): CoverProp | undefined {
  const dx = Math.sign(from.x - target.x), dy = Math.sign(from.y - target.y);
  const sides: [number, number][] = dx || dy ? [[dx, 0], [0, dy]] : SIDES;
  let best: CoverProp | undefined, bestCover = 0;
  for (const [sx, sy] of sides) {
    if (!sx && !sy) continue;
    const p = propAt(m, target.x + sx, target.y + sy);
    if (!p) continue;
    const cover = Math.max(0, propCover(p));
    if (cover > bestCover) { bestCover = cover; best = p; }
  }
  return best;
}

/** Рядом есть укрытие (4 соседние клетки): нужно для визуального приседа. */
export function hasAdjacentCover(m: Mission, u: TacUnit): boolean {
  return SIDES.some(([dx, dy]) => {
    if (cellAt(m, u.x + dx, u.y + dy) !== 0) return true;
    const p = propAt(m, u.x + dx, u.y + dy);
    return !!p && p.state !== 'collapsed';
  });
}

export function hitChance(m: Mission, shooter: TacUnit, target: TacUnit): number {
  const d = dist(shooter, target);
  let chance = shooter.aim - coverOf(m, target, shooter);
  if (d <= 3) chance += 15;
  if (d > 10) chance -= (d - 10) * 3;
  return Math.max(5, Math.min(95, chance));
}

/**
 * Шанс реакции наблюдения: шанс попадания, урезанный множителем наблюдения
 * (по рывку - сильнее). Зажат в 1..95, чтобы реакция всегда имела шанс промахнуться.
 */
export function reactionChance(m: Mission, shooter: TacUnit, target: TacUnit, dashed = false): number {
  const chance = hitChance(m, shooter, target) * (dashed ? BATTLE.dashOverwatchAim : BATTLE.overwatchAim);
  return Math.max(1, Math.min(95, Math.round(chance)));
}

/** Какие клетки видит отряд (для тумана войны). */
export function visibleCells(m: Mission, side: 'xcom' | 'alien' = 'xcom'): Uint8Array {
  const vis = new Uint8Array(m.w * m.h);
  const eyes = m.units.filter((u) => u.side === side && u.hp > 0);
  for (let y = 0; y < m.h; y++) {
    for (let x = 0; x < m.w; x++) {
      for (const e of eyes) {
        if (Math.max(Math.abs(e.x - x), Math.abs(e.y - y)) <= sightOf(e) && lineOfSight(m, e.x, e.y, x, y)) {
          vis[y * m.w + x] = 1;
          break;
        }
      }
    }
  }
  return vis;
}

// --- Перемещение -----------------------------------------------------------------------------

/** Ёмкость магазина юнита; 0 - бесконечное оружие. */
export function magOf(u: TacUnit): number {
  return u.side === 'xcom' ? SQUAD.soldier.mag : ALIEN_BY_ID[u.kind]?.mag ?? 4;
}

/** Урон от окружения для юнита (разрушение укрытий). */
export function envDamageOf(u: TacUnit): number {
  return u.side === 'xcom' ? SQUAD.soldier.envDamage : ALIEN_BY_ID[u.kind]?.envDamage ?? 20;
}

export const occupied = (m: Mission, x: number, y: number, except?: TacUnit) => m.units.some((u) => u !== except && u.hp > 0 && u.x === x && u.y === y);
/** Сквозь своих проходить можно (как в XCOM), сквозь врагов - нет. */
const blockedByEnemy = (m: Mission, x: number, y: number, me: TacUnit) => m.units.some((u) => u.side !== me.side && u.hp > 0 && u.x === x && u.y === y);

/** Клетка не проходима: стена, низкое укрытие террейна или целый твёрдый пропс. */
const blockedCell = (m: Mission, x: number, y: number) => cellAt(m, x, y) !== 0 || solidPropAt(m, x, y);

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
        if (blockedCell(m, nx, ny) || blockedByEnemy(m, nx, ny, u)) continue;
        if (dx && dy && (blockedCell(m, cx + dx, cy) || blockedCell(m, cx, cy + dy))) continue;
        const ni = ny * m.w + nx;
        if (d[ni] >= 0) continue;
        d[ni] = d[c] + 1;
        queue.push(ni);
      }
    }
  }
  return d;
}

export function pathTo(m: Mission, u: TacUnit, tx: number, ty: number): [number, number][] | null {
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
  if (n <= u.mobility) return BATTLE.ap.move;
  if (n <= u.mobility * 2) return BATTLE.ap.dash;
  return -1;
}
