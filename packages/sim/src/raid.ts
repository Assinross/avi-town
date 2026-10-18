// Налёты НЛО: подлёт к городу, атака зданий, огонь ПВО, падение или уход.
// Координаты НЛО - в сотых долях клетки, всё целочисленно и через ГСЧ мира.

import { BUILDING_BY_ID, UFO_BY_ID, UFOS } from '@avi/data';
import { buildingCells, buildingRoots } from './city';
import { clearTile, removeCrash } from './commands';
import { nextInt } from './rng';
import { markChanged, type Raid, type World } from './world';

const HOVER_TICKS = 260; // сколько НЛО кружит над городом
const HOVER_RADIUS = 5; // клеток вокруг центра города
const CRASH_DAYS = 10; // через сколько дней пришельцы покидают место крушения
const DETECT_RANGE = 10; // без радара НЛО замечают на этом расстоянии от построек

/** Ежедневная проверка: истечение места крушения и запуск следующего налёта. */
export function raidDay(w: World) {
  if (w.crash && w.day >= w.crash.expiresDay) {
    const ufo = w.crash.ufo;
    removeCrash(w);
    w.events.push({ type: 'crashExpired', ufo });
  }
  if (w.raid || w.day < w.nextRaidDay) return;
  const center = cityCenter(w);
  if (!center) {
    w.nextRaidDay = w.day + 5;
    return;
  }
  spawn(w, center.x, center.y);
}

function cityCenter(w: World): { x: number; y: number } | null {
  let sx = 0, sy = 0, n = 0;
  w.tiles.forEach((t, i) => {
    if ((t.object === 'zone' && t.level > 0) || t.object === 'building') {
      sx += i % w.size;
      sy += Math.floor(i / w.size);
      n++;
    }
  });
  return n ? { x: Math.floor(sx / n), y: Math.floor(sy / n) } : null;
}

function hasRadar(w: World): boolean {
  return buildingRoots(w).some((r) => BUILDING_BY_ID[w.tiles[r].def!]?.radar && w.tiles[r].powered);
}

function spawn(w: World, cx: number, cy: number) {
  const eligible = UFOS.filter((u) => u.fromDay <= w.day);
  const pool = eligible.length ? eligible : [UFOS[0]];
  // Чаще самый сильный из доступных, иногда - слабее
  const def = nextInt(w.rng, 100) < 60 ? pool[pool.length - 1] : pool[nextInt(w.rng, pool.length)];
  const edge = nextInt(w.rng, 4);
  const along = nextInt(w.rng, w.size) * 100;
  const max = w.size * 100;
  const [x, y] = [[along, -100], [max + 100, along], [along, max + 100], [-100, along]][edge];
  const raid: Raid = {
    ufo: {
      def: def.id, x, y, vx: 0, vy: 0, hp: def.hp, maxHp: def.hp, cooldown: def.weapon.cooldown,
      tx: cx * 100 + 50, ty: cy * 100 + 50, wx: cx * 100 + 50, wy: cy * 100 + 50, phase: 'approach', timer: HOVER_TICKS,
    },
    detected: hasRadar(w),
    aaCooldown: {},
  };
  w.raid = raid;
  if (raid.detected) {
    w.events.push({ type: 'raidDetected', ufo: def.id });
    w.speed = 0; // радар даёт время подготовиться
  }
  w.revision++;
}

/** Скорость в сотых долях клетки за тик к точке (tx, ty). */
function steer(w: World, tx: number, ty: number, slow: boolean) {
  const u = w.raid!.ufo;
  const def = UFO_BY_ID[u.def];
  const speed = Math.max(1, Math.round(100 / def.ticksPerTile / (slow ? 2 : 1)));
  const dx = tx - u.x, dy = ty - u.y;
  const len = Math.sqrt(dx * dx + dy * dy);
  if (len <= speed) {
    u.vx = dx;
    u.vy = dy;
    return true;
  }
  u.vx = Math.round((dx * speed) / len);
  u.vy = Math.round((dy * speed) / len);
  return false;
}

export function raidTick(w: World) {
  const raid = w.raid!;
  const u = raid.ufo;
  const def = UFO_BY_ID[u.def];
  const max = w.size * 100;

  // Движение по фазам
  if (u.phase === 'approach') {
    if (steer(w, u.tx, u.ty, false)) u.phase = 'attack';
  } else if (u.phase === 'attack') {
    if (steer(w, u.wx, u.wy, true)) {
      u.wx = u.tx + (nextInt(w.rng, HOVER_RADIUS * 200) - HOVER_RADIUS * 100);
      u.wy = u.ty + (nextInt(w.rng, HOVER_RADIUS * 200) - HOVER_RADIUS * 100);
    }
    if (--u.timer <= 0) {
      u.phase = 'leave';
      // Уходит в сторону, противоположную точке входа - к ближайшему краю
      u.wx = u.x < max / 2 ? -300 : max + 300;
      u.wy = u.y;
    }
  } else {
    steer(w, u.wx, u.wy, false);
  }
  u.x += u.vx;
  u.y += u.vy;
  w.revision++; // панель налёта показывает позицию и прочность НЛО

  if (u.phase === 'leave' && (u.x < -200 || u.y < -200 || u.x > max + 200 || u.y > max + 200)) {
    w.events.push({ type: 'ufoLeft', ufo: u.def });
    endRaid(w);
    return;
  }

  const tx = Math.floor(u.x / 100), ty = Math.floor(u.y / 100);
  if (!raid.detected && nearBuildings(w, tx, ty, DETECT_RANGE)) {
    raid.detected = true;
    w.events.push({ type: 'raidArrived', ufo: u.def });
  }

  // Огонь НЛО по ближайшему зданию в радиусе
  if (--u.cooldown <= 0 && u.phase !== 'approach') {
    const target = findTarget(w, tx, ty, def.weapon.range);
    if (target >= 0) {
      const x = target % w.size, y = Math.floor(target / w.size);
      w.fx.push({ type: 'ufoShot', fromX: u.x, fromY: u.y, toX: x * 100 + 50, toY: y * 100 + 50 });
      w.fx.push({ type: 'explosion', x: x * 100 + 50, y: y * 100 + 50, big: false });
      hit(w, target);
    }
    u.cooldown = def.weapon.cooldown;
  }

  // Огонь ПВО
  for (const root of buildingRoots(w)) {
    const t = w.tiles[root];
    const aa = BUILDING_BY_ID[t.def!]?.aa;
    if (!aa || !t.powered) continue;
    const cd = raid.aaCooldown[root] ?? 0;
    if (cd > 0) {
      raid.aaCooldown[root] = cd - 1;
      continue;
    }
    const bx = (root % w.size) * 100 + 50, by = Math.floor(root / w.size) * 100 + 50;
    const dx = u.x - bx, dy = u.y - by;
    if (dx * dx + dy * dy > aa.range * aa.range * 10000) continue;
    const ok = nextInt(w.rng, 100) < aa.accuracy;
    if (ok) u.hp -= aa.damage;
    w.fx.push({ type: 'aaShot', fromX: bx, fromY: by, toX: u.x, toY: u.y, hit: ok });
    raid.aaCooldown[root] = aa.cooldown;
  }

  if (u.hp <= 0) crash(w);
}

function nearBuildings(w: World, x: number, y: number, r: number): boolean {
  for (let dy = -r; dy <= r; dy += 2) {
    for (let dx = -r; dx <= r; dx += 2) {
      const nx = x + dx, ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= w.size || ny >= w.size) continue;
      const t = w.tiles[ny * w.size + nx];
      if (t.object === 'building' || (t.object === 'zone' && t.level > 0)) return true;
    }
  }
  return false;
}

function findTarget(w: World, x: number, y: number, r: number): number {
  let best = -1, bestD = Infinity;
  for (let dy = -r; dy <= r; dy++) {
    for (let dx = -r; dx <= r; dx++) {
      const nx = x + dx, ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= w.size || ny >= w.size) continue;
      const t = w.tiles[ny * w.size + nx];
      if (!(t.object === 'building' || (t.object === 'zone' && t.level > 0))) continue;
      const d = dx * dx + dy * dy;
      if (d < bestD) {
        bestD = d;
        best = ny * w.size + nx;
      }
    }
  }
  return best;
}

function toRubble(w: World, idx: number) {
  clearTile(w.tiles[idx]);
  w.tiles[idx].object = 'rubble';
  markChanged(w, idx);
}

/** Попадание: жилой дом теряет уровень (на 1-м - в руины), здание теряет прочность. */
function hit(w: World, idx: number) {
  const t = w.tiles[idx];
  const x = idx % w.size, y = Math.floor(idx / w.size);
  if (t.object === 'zone') {
    if (t.level <= 1) {
      toRubble(w, idx);
      w.events.push({ type: 'buildingDestroyed', x, y });
    } else {
      t.level--;
      markChanged(w, idx);
    }
    return;
  }
  if (t.object === 'building') {
    const cells = buildingCells(w, t.root);
    const hp = t.hp - 1;
    if (hp <= 0) {
      for (const c of cells) toRubble(w, c);
      w.events.push({ type: 'buildingDestroyed', x, y });
    } else {
      for (const c of cells) w.tiles[c].hp = hp;
      markChanged(w, t.root);
    }
  }
}

function crash(w: World) {
  const u = w.raid!.ufo;
  // Падает в ближайшую к своей позиции клетку суши внутри карты
  let cx = Math.min(w.size - 1, Math.max(0, Math.floor(u.x / 100)));
  let cy = Math.min(w.size - 1, Math.max(0, Math.floor(u.y / 100)));
  for (let r = 0; r < 8 && w.tiles[cy * w.size + cx].terrain === 'water'; r++) {
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        const nx = cx + dx, ny = cy + dy;
        if (nx >= 0 && ny >= 0 && nx < w.size && ny < w.size && w.tiles[ny * w.size + nx].terrain !== 'water') {
          cx = nx;
          cy = ny;
        }
      }
    }
  }
  if (w.crash) removeCrash(w);
  // Удар о землю: соседние дома теряют уровень
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      const nx = cx + dx, ny = cy + dy;
      if ((dx || dy) && nx >= 0 && ny >= 0 && nx < w.size && ny < w.size) {
        const t = w.tiles[ny * w.size + nx];
        if (t.object === 'zone' && t.level > 0) hit(w, ny * w.size + nx);
      }
    }
  }
  const idx = cy * w.size + cx;
  const t = w.tiles[idx];
  if (t.object === 'building') for (const c of buildingCells(w, t.root)) toRubble(w, c);
  clearTile(t);
  t.object = 'crash';
  t.def = u.def;
  markChanged(w, idx);
  w.crash = { x: cx, y: cy, ufo: u.def, expiresDay: w.day + CRASH_DAYS };
  w.fx.push({ type: 'explosion', x: cx * 100 + 50, y: cy * 100 + 50, big: true });
  w.events.push({ type: 'ufoDown', ufo: u.def, x: cx, y: cy });
  w.speed = 0; // время решить, отправлять ли отряд
  endRaid(w);
}

function endRaid(w: World) {
  w.raid = null;
  w.nextRaidDay = w.day + 12 + nextInt(w.rng, 10);
  w.revision++;
}
